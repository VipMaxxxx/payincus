# BF-5 实例创建与交付 · 业务行为说明书 + 疑点清单

## 一、现状行为(代码实际怎么跑)

**入口:用户自助下单** `POST /api/instances`(`instances.ts:1177`),202 异步交付。

**阶段一 校验(1246-1471)**:Turnstile(秒杀跳过)→ 下单限制 assertUserCanCreateInstance → SSH 公钥必填 → 套餐存在/启用/有权访问 + 前置套餐校验 → 共享套餐"实例数/CPU/内存"配额初筛 → 付费必带 planId 且校验属该套餐/上架/未售罄,**禁止用自己的付费套餐给自己开**(节点主在自己节点开免费实例可绕过)→ 秒杀资格 → 费用 calculateCreateBilling(开通费固定0,price=plan.price/100)+ 优惠码折扣 + 预校验余额。

**资源确定(1444-1446)关键公式**:付费=selectedPlan.cpu/memory/disk(方案固定);免费=cpu||15/memory||128/disk||512(用户传入),注释明说**只看宿主机资源,不校验套餐包资源上限**。

**阶段二 预筛主机(1476-1554)**:selectAvailableHost 快速失败;校验镜像/节点实例类型兼容;KVM 禁 nat_ipv6_nat/ipv6_nat。

**阶段五 原子事务(1667-1953,Serializable)**:付费 advisory 锁余额→selectAndReserveHostWithLock(FOR UPDATE 行锁,校验 CPU/内存配额、磁盘、存储池、routed IPv6 需 ipv6_subnet+parent_interface、public_ipv4 需空闲独立IP>0、NAT 端口配额,当场累加 host 用量)→ 条件扣款 updateMany where balance>=actualPrice → 建 instance(status='creating')→ 付费写 newPurchase → 秒杀 claim → 优惠码 createAffBinding+processAffCommission(**返利基数=下单价 billing.price,非折后价**)→ processHostingIncome(节点主冻结30天)。

**事务后(2065-2293,不在 try/catch 内)**:NAT 内网IPv4 随机试50次;public_ipv4 走 reservePublicIpv4ForInstance,失败→回滚+退款+503;routed IPv6 从子网随机试50次 → 用最终 IP 重生成 cloud-init → 存储池解析**为空直接 throw** → createInstanceAsync fire-and-forget → 立即 202 返回 id/incusId/rootPassword。

**异步交付 createInstanceAsync(6593-7007)**:建 Incus→启动→原子 creating→running→标记秒杀交付→建 ip_addresses→通知/邮件/插件事件。失败 catch(6882):改 error→回滚资源→释放 public IPv4→compensateFailedInstancePurchase 退款→markFlashSaleFailed→删残留→通知。

**兜底**:app.ts:901-1010 每2分钟扫 creating 且 createdAt<now-10min 的实例→改 error→回滚→退款→删容器→通知。

**托管/自营对比**:自助购(含 peer 托管节点)走 createInstanceAsync;"管理员/节点主替用户开通"走 provisionManagedInstanceAsync(更简:建实例→回写真实IP→改 running;失败也回滚+退款,但**不建 ip_addresses、不发通知/邮件/插件事件、不标记秒杀**)。

**admin 交付中心**:DeliveryAssuranceCase **绑定 taskId**,只覆盖 recreate/换机/克隆等 task 型交付;初始开通不产生 task、不进此系统。

---

## 二、业务疑点清单

- **[BF-5-01] 经济倒挂/功能残缺 | instances.ts:2216-2227(及 hosts.ts:6735)** — 事务(扣款+资源预占+可能已预留公网IP)提交后,存储池为空/后续 update 失败直接 throw 且**不在 try/catch 内**,返回500;补偿靠10分钟后 CreateTimeout 兜底。用户已扣款+生成 creating 幽灵实例,需等约10-12分钟才退款。需确认:**"扣款成功但交付前置(存储池)失败→延迟约10分钟才退款"可接受吗?**
- **[BF-5-02] 秒杀库存泄漏 | app.ts:910-1010、instances.ts:2108-2129、services/flash-sales.ts:816** — markFlashSaleFailed(减 soldCount)**只在 createInstanceAsync catch 里调**;另两条失败路径(公网IPv4无货同步补偿、CreateTimeout超时清理)都不调。这两条下秒杀 reservation 永远停在 paid、soldCount 不回滚→库存被占死(即使钱已退)。需确认:**秒杀实例在超时清理/公网IP无货失败时是否也应释放库存?**
- **[BF-5-03] 资源守恒破坏 | instances.ts:1444-1449、1734-1747** — 免费套餐 requestedCpu=cpu||15 直接采用用户输入,**后端从不校验套餐 cpu_max/memory_max/disk_max**;仅共享套餐且设了 quotaMultiplier 才卡 CPU/内存(磁盘任何情况都不卡)。约束只剩 host 资源与 JSON schema 上限(CPU≤10000%/内存≤512GB/盘≤100GB)。前端有 clamp 但绕过 API 即失效。用户可用小规格免费套餐直接调 API 申请远超规格的资源。需确认:**免费套餐是否应在后端强制 requestedCpu/Memory/Disk ≤ 套餐 max?**
- **[BF-5-04] 拿到不通网的实例 | instances.ts:2081-2107、2137-2162** — NAT 内网IPv4 分配50次失败→staticIPv4=null 仅打日志"使用动态IP",实例照常交付 running;routed IPv6 子网耗尽→staticIPv6=null 仅告警。二者都**无硬失败、无退款、无回收**。NAT 端口映射以内网IP为转发目标,null 时端口转发无法可靠建立;ipv6_only 套餐拿不到 IPv6 则实例完全无可用地址——但用户已付费且标记 running。需确认:**静态IP分配失败是否应视为交付失败(退款+回收),而非静默降级仍交付?**
- **[BF-5-05] 托管≠自营 | lib/managed-instance-provision.ts:139-158 vs instances.ts:6759-6879** — provisionManagedInstanceAsync 交付成功后**不建 ip_addresses、不发实例创建站内信/邮件、不发插件 service.provisioned 事件、不标记秒杀**;自营全做。托管开通用户收不到任何创建通知/邮件。需确认:**托管/代开通是否也应给目标用户发实例创建通知与邮件?**
- **[BF-5-06] 初始开通无交付保障 | admin-delivery.ts:163-213、instances.ts:2253** — DeliveryAssuranceCase 绑定 taskId,只有 task 型(recreate/换机/克隆)失败才开修复工单;初始 createInstanceAsync fire-and-forget、不产生 InstanceTask,**失败不进 admin 交付中心**;若退款也抛错仅 console.error,无人工接管入口。用户最先经历的"首次开通"恰是交付保障盲区。需确认:**初始开通失败(尤其退款也失败)是否应自动开交付保障 case?**
- **[BF-5-07] 看不到失败原因 | InstancesView.vue:859-860、InstanceDetailView.vue:488-491** — 实例 error 前端只显红字状态;失败原因仅通过站内信/邮件下发,实例表未存 errorMessage,详情页不展示。需确认:**是否把创建失败原因落库并在实例详情页展示?**
- **[BF-5-08] 非秒杀无幂等 | instances.ts:1906** — idempotencyKey 仅用于秒杀 claim;普通付费开通无幂等键,前端超时重试/双击会各自扣款各建一台。需确认:**普通付费开通是否需要 idempotencyKey 幂等去重?**

---

## 三、给 owner 的 TOP5 必答确认问题
1. **免费套餐规格上限该不该后端强制?** 后端对免费套餐完全不校验 cpu_max/memory_max/disk_max(instances.ts:1444-1449),绕过前端即可超额领资源——资源守恒/防滥用关键红线。
2. **静态IP分配失败该退款还是静默降级?** 现状 NAT-IPv4/routed-IPv6 分配失败仍标 running 交付(instances.ts:2081-2162),ipv6_only 甚至可能无任何可用地址——用户付了费却可能拿到不通网的机器。
3. **秒杀库存在"超时清理/公网IP无货"路径是否要回滚?** markFlashSaleFailed 只在 createInstanceAsync 内调用,另两条退款路径不减 soldCount,导致库存泄漏、状态永久停在 paid。
4. **托管/代开通是否补齐通知/邮件?** provisionManagedInstanceAsync 不发实例创建通知/邮件/插件事件(对比自营),托管用户体验与自营不一致。
5. **事务后失败(存储池不可用)"延迟10分钟退款"是否可接受?** 存储池为空直接 throw 且不在补偿 try/catch 内(instances.ts:2217),扣款后要等 CreateTimeout 约10-12分钟才退款;是否改为同步即时补偿?

说明:核心付费链路"配额扣减=实际交付=账单"在**付费方案**下守恒(三者均用 selectedPlan);主机选择已按网络模式过滤 IPv6/公网IPv4 能力,"配了拿不到主机"在选机层已挡。疑点集中在**免费套餐规格失控、IP分配失败后静默交付、三条失败路径补偿/库存不对齐**。只读,未改任何文件。
