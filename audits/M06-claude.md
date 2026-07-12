# M06 审计报告

## 结论摘要
资源池申领本身在并发安全上做得扎实：withResourcePoolApplyLocks 双锁串行化 + applyResourcePoolToInstance 事务内条件扣减(AND "cpu" >= amount)+ 主机用量 increment,守卫齐全,越权校验(instance.user_id !== user.id)到位,未发现 P0。真正的风险在"资源守恒"层面:资源池申领对主机容量无上限校验(与 reserveResources 严重不对称),且申领到实例的资源在改配(performPlanChange)时被绝对覆盖而丢失、不退回资源池。交付失败补偿路径以 status='creating' 为幂等闸,设计合理。

## 发现清单

- [M06-01] P1 | 置信度 中 | server/src/db/resource-pool.ts:225-234(配合 server/src/routes/resource-pool.ts:184-193)
  - 问题:资源池申领 CPU/内存/硬盘时,主机用量是无条件 increment,全程没有"是否超过主机配额上限(cpuAllowanceMax/memoryMax)"的校验,可把宿主机超额分配(超卖)到物理/配额上限之上。
  - 证据:applyResourcePoolToInstance 直接 `cpuUsed:{increment:...}`,路由侧只校验 enable_resource_pool、KVM 倍数、VM 需停机,无容量检查。对照 reserveResources(quota-operations.ts:174-199)有条件 `reserveWhere.cpuUsed={lte:cpuLimit-cpu}`,updateMany 命中 0 即抛 Host resources exceeded。
  - 影响:用户把签到/抽奖/兑换累计的资源池 CPU/内存灌到实例上,可突破节点内存上限,触发同宿主机其他租户 OOM/KVM 启动失败,破坏隔离与稳定性。/apply 的 amount 无最大值放大风险。
  - 修复建议:申领前(同一事务内)按 reserveResources 同款条件更新校验主机剩余容量,超限即拒绝并回滚 Incus patch。

- [M06-02] P2 | 置信度 高 | server/src/db/billing-operations.ts:906-910(配合 resource-pool.ts:178 与 resource-pool.ts:214-223)
  - 问题:资源池申领把资源写进实例绝对字段(newCpu=instance.cpu+amount);而改配 performPlanChange 用 cpu:newPlan.cpu 绝对覆盖并把 Incus 也 patch 回 newPlan.cpu,申领加成被永久抹掉,且资源池已扣减记 apply 日志却不回退到资源池。
  - 影响:用户先给付费实例申领了资源池 CPU/内存/硬盘,随后升级方案,已消耗的池资源(签到/抽奖攒的、或 h- 兑换码兑换的、有真实价值)静默蒸发,无退款,属用户资产丢失。
  - 修复建议:改配时把该实例历史 apply 的池增量并入新配置(或改配前退回资源池)。

- [M06-03] P3 | 置信度 中 | server/src/routes/resource-pool.ts:176-261
  - 问题:CPU/内存/硬盘申领是"先 patch Incus 再落库 DB 事务"。patchedRollback 只能覆盖被 catch 的错误;若进程在 Incus patch 成功后、DB 提交前崩溃,则 Incus 侧资源已加但资源池未扣、主机用量与 instance.cpu 未更新,静默漂移,且无对账/修复 case(不同于改配同步失败会 recordPlanUpgradeSyncFailure)。
  - 影响:低概率下宿主机计费/账面与实际 Incus 分配不一致(偏向用户白得资源),无自动发现手段。
  - 修复建议:为资源池申领增加轻量对账(周期比对 instance 配置与 Incus 实际),或纳入可重放任务/case 体系。

- [M06-04] P3 | 置信度 低 | server/src/routes/resource-pool.ts:126、238 ; server/src/db/resource-pool.ts:32
  - 问题:/apply 的 amount 无上限;流量 trafficBytes=BigInt(amount)*1073741824n 写 bigint 列,极端值触发 bigint out of range;getUserResourcePool 用 Number(pool.traffic) 返回,超 2^53 精度丢失。
  - 影响:实践上被条件扣减与资源池余额兜住,难触达,仅健壮性缺口(与 M06-01 amount 无上限叠加放大超卖面)。
  - 修复建议:为 amount 增加合理 maximum,资源池余额展示改用字符串/BigInt 透传。

补充:GET /、/logs、/instances 均以 user.id 收敛,/apply 锁内复核归属;admin-delivery 全部 authenticateAdmin、响应安全 select 且 sanitizeTokensInString、retry 仅限幂等 start/stop/restart;前端 DeliveryCenterView 契约与守卫一致,未单列。
