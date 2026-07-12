# PayIncus 统一修复计划（FIX_PLAN.md）

> **来源合并**：`DEFECTS.md`（175 条代码缺陷 D-001…D-175 + 已修 D-176）× `BEHAVIOR.md`（12 条业务流行为审计 + owner 全部裁决：A1-A3 / E1-E24 / F-A~F-F / G-A~G-F）。
> **本文件仅为计划**：合并/去重/排波，**未改任何源码、未跑构建/测试**。执行须按 `MAINTENANCE_PLAN.md` 波次制 + `AGENTS.md §7 分工 §8 完成定义`；commit/发版/OTA 一律等 owner 明确指令。
>
> **纳入原则**：只纳入 owner 判为「要改 / 清理 / 新功能」的项。判为「保持现状 / 不改」的（D2 手续费扣到账、D4 内置渠道无原路退款、D6 销毁免费一生一次、D7 签到无递增、E7 流量双向计费、E15 转账费率、31天/月交付、E16 已由 D-176 覆盖）**不进快速修复波**，集中列在文末「已确认保持现状」。
>
> **编号**：临时编号 `FX-###`（跨来源同根因已合并）。列含：来源、类型、风险档、规模、建议执行方、守卫。
> **风险档**：A=高危（Claude 定根因+规格→codex 实现→Claude 逐行审+守卫+真机）；B=中危（codex 端到端→Claude 审）；C=低危（codex 主力快审）。
> **执行方**：A 档标 **Claude**；B/C 机械项标 **codex**；功能开发（大）标 **Claude 定规格 + codex**。

---

## 一、执行摘要（统计见文末第九节）

- **要改项（FX）总数：152**，分布：波0=8、波1=24、波2=35、波3=69、波4=7（功能开发大）、波5=9。
- **横切根因合并点**：外呼 SSRF（D-056）、apiError 泄漏（D-118）、trustProxy/XFF（D-057+D-046）、日志脱敏（D-053）、硬删除级联财务/审计（D-003/004/024/025）、check-then-act 竞态族、i18n（D-152）、内存态多进程（D-167）。
- **业务↔缺陷合并点**：E2=D-006（风险分衰减）、E5=D-063/D-071/D-083（退款漏钱）、E8=D-031/D-094（邮箱退款实付）、E9=D-068/069/072/159（计费口径+version 锁）、E21=D-033（年付续费）、E23=D-017（流量重置）、F-A BF-5-01=D-127/D-125（交付补偿）、F-C=D-030/032/034/062（邮箱上游/补偿）、F-F BF-12-03=D-038/D-042（市场发布）、G-E BF-12-08=D-102（verified）。

---

## 波次 0 — 安全阻断（A 档 · Claude）

**涉及模块**：M21 插件、M01 认证、M25 日志、M10 OTA、M27 运维、以及外呼 SSRF/trustProxy 横切覆盖的 M07/09/17/18/19/22/24。
**主要文件**：`client/.../PluginFrame.vue`、`lib/redirect-validator.ts`+`routes/oauth.ts`、`lib/outbound-security.ts`、`lib/trust-proxy-config.ts`+`deploy/nginx-*`、`lib/log-sanitizer.ts`、`lib/errors.ts`、`routes/system-config.ts`+`app.ts`、`scripts/install-panel.sh`。
**可并行子块**：{FX-001 插件域} ‖ {FX-003 外呼} ‖ {FX-004 trustProxy} ‖ {FX-005 脱敏} ‖ {FX-006 apiError} ‖ {FX-002 redirect}；FX-007/FX-008 需 owner 参与（OTA 高危门禁），单独串行。

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-001 | 插件 iframe 同源 + allow-same-origin 可接管会话 → 独立无凭证域托管 + 去 allow-same-origin + postMessage 能力桥 | D-001(P0) | 缺陷修复 | A | 大 | Claude | test:plugin-client-boundary-guards, test:frontend-route-guards, test:frontend-dist-boundary-guards |
| FX-002 | 开放重定向反斜杠绕过泄漏 OAuth 登录码致账号接管 → redirect 拒 `\`/`%5c`/`/[/\\]` 起始，前后端同步 | D-002 | 缺陷修复 | A | 小 | Claude | test:frontend-public-callback-url, server type-check |
| FX-003 | 外呼校验后未绑安全 dispatcher，连接期 DNS rebinding SSRF → 不可绕过安全 fetch + 连接期 DNS 复核 + 禁重定向 + 超时 + 响应限长（覆盖 AI/SMTP/webhook/市场扫描/图床全部外呼） | D-056(横切) | 缺陷修复 | A | 大 | Claude | test:storage-outbound-guards, test:payment-provider-outbound-guard, test:system-monitor-webhook-guard, test:telegram-webhook-url-guard |
| FX-004 | trustProxy 全链信任 + Nginx 追加转发头致 request.ip 可伪造（放大限流/风控/回调白名单） → 仅信任固定跳数/受信网段，最外层覆盖；限流键改 token/用户 ID | D-057, D-046 | 缺陷修复 | A | 中 | Claude | test:trust-proxy-config, test:split-deploy-config |
| FX-005 | 自由文本脱敏漏 pat_/poa_/Basic/深层对象进日志 → 覆盖全部凭证格式，递归超限整体替换 | D-053 | 缺陷修复 | A | 中 | Claude | test:log-sanitizer, test:agent-response-redaction |
| FX-006 | apiError 无条件返回 details 泄漏内部异常原文（10 处调用点）→ 5xx 只返错误码 + 通用文案，异常脱敏落日志 | D-118(横切) | 缺陷修复 | A | 中 | Claude | test:log-sanitizer, server type-check |
| FX-007 | 普通管理员可写高危白名单（OTA/插件/主题/礼品卡超管）自提权 → `*_allowed_admin_ids` 类键写入收敛超管级门禁 | D-007(横切I) | 缺陷修复 | A | 中 | Claude(需 owner) | test:system-config-value-guards, test:system-update-guards |
| FX-008 | root 单元执行服务用户可写 JS 形成提权链 → root helper 只执行 root 拥有且服务用户不可写的固定入口与已验证产物 | D-055 | 缺陷修复 | A | 大 | Claude(需 owner, OTA 高危) | test:agent-install-command-guards, test:host-install-script-guards, test:split-deploy-config |

---

## 波次 1 — 资金 / 计费正确性（A 档主 · Claude）

**涉及模块**：M04 计费、M19 邮箱计费、M20 Hosting、M08 交易所、M15 AFF、M16 积分/抽奖、M24 收入统计、M02 用户、M03 充值。
**主要文件**：`routes/admin-billing.ts`（延期/退款/升级集中）、`db/billing-operations.ts`、`lib/billing-calc.ts`、`services/billing-scheduler.ts`、`routes/orders.ts`、`routes/mail.ts`、`routes/hosting.ts`、`db/aff.ts`、`routes/gift-cards.ts`、`services/exchange.ts`、`routes/admin-capacity-cost.ts`、`routes/users.ts`+`schema.prisma`。
**可并行子块**：{退款方向/漏钱 FX-010~016} ‖ {邮箱退款 FX-017~018} ‖ {计费口径 FX-019~023}（同 admin-billing.ts 内串行）‖ {硬删级联 FX-025~028} ‖ {积分/礼卡护栏 FX-029~030} ‖ {收入统计 FX-024}。

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-010 | 充值来源退款由「加余额」改为「扣减」（实例退款保持加余额，A3 现状正确不动） | A3/BF-2-08, D-141 | 规则调整 | A | 中 | Claude | test:financial-reconciliation-guards, test:balance-adjustment-approval-guards |
| FX-011 | 管理员「删除并退款」不回扣托管节点主人 → 退款事务复用 deductHostingBalance 回扣 | E5①/BF-10-02, D-071 | 缺陷修复 | A | 中 | Claude | test:hosting-balance-guards, test:admin-billing-route-id-guards |
| FX-012 | 退款不冲回已发 AFF 佣金 → 退款按比例冲回 AFF 佣金及统计 | E5②/BF-9-08 | 规则调整 | A | 中 | Claude | test:invite-generation-accounting-guards, test:aff-points-query-guards |
| FX-013 | 禁用码仍发续费佣金 + AFF 入口未统一校验 enabled（含 Q-C2 真正做出禁用能力）→ 禁用码停续费佣金、所有 AFF 入口统一校验启用 | E5③/Q-C2, D-083 | 缺陷修复 | A | 中 | Claude | test:invite-generation-accounting-guards |
| FX-014 | 托管回扣不足平台默默兜底 → 扣成负数记欠款/负余额账本 | E18/BF-10-04, D-063 | 规则调整 | A | 中 | Claude | test:hosting-balance-guards |
| FX-015 | 销毁手续费落节点主人口袋 → 回扣按 pre-fee 全额扣，手续费归平台 | E19/BF-10-06 | 规则调整 | A | 小 | Claude | test:hosting-balance-guards |
| FX-016 | 管理员补发 available 计入托管收入并抬高 VIP → 改独立类型，不计入 income/VIP | E20/BF-10-08 | 规则调整 | B | 小 | codex | test:hosting-balance-guards, test:vip-benefit-route-guards |
| FX-017 | 邮箱退款按当前标价非实付、无累计上限、续费弹窗自算 AFF 折扣多扣 → 按真实实付逐期 + 累计退款≤累计实付 + 续费报价后端计算 | E8/BF-9-07, D-031, D-094 | 缺陷修复 | A | 中 | Claude | test:financial-reconciliation-guards, server type-check |
| FX-018 | 年付邮箱可按「年价÷12」单月续费 → 后端限 billingCycle，年付仅 12 月整数倍 | E21/BF-9-05, D-033 | 缺陷修复 | B | 小 | codex | server type-check |
| FX-019 | 管理端延期按 30 天、升级剩余价值按名义原价不封顶、延期/退款/升级事务外无 version 锁 → 延期统一 31 天基、升级剩余价值按实付封顶、三者入事务 + version/status 锁、降级退款计入 maxRefundable | E9/A4, D-068, D-069, D-072, D-159, D-070 | 缺陷修复+规则调整 | A | 大 | Claude | test:admin-billing-route-id-guards, test:billing-query-guards |
| FX-020 | 计费「月」退款/剩余价值口径分叉、过期续费 periodStart 记过去时间致退款低估 → 统一「实际服务时间比例」折算、periodStart 取 max(旧到期, now)（31天/月交付保持） | E22/D8/BF-10-05/BF-9-06, D-158, BF-1-08 | 规则调整 | A | 中 | Claude | test:billing-query-guards, test:financial-reconciliation-guards |
| FX-021 | 订单退款登记不校验状态/上限取请求 amount/查重竞态 + 合并分页无上限 → 限 completed 状态、上限取 actualAmount（实付）、条件唯一、深分页上限 | D8/BF-2-09/10, D-141, D-140 | 缺陷修复 | A | 中 | Claude | test:financial-reconciliation-guards, test:core-pagination-guards |
| FX-022 | 自动续费预检用原价致误判失败 + 订单页 displayName 契约缺失 → 预检统一折后价、补 select | D-142, D-143 | 缺陷修复 | B | 小 | codex | test:billing-query-guards |
| FX-023 | 到期删除窗口仍可续费 + 改配绝对覆盖抹资源池加成 → 拒 deleted 续费（version/status 条件）、改配并入历史 apply 增量 | D-067, D-073 | 缺陷修复 | A | 中 | Claude | test:billing-expiry-race-guards, test:resource-pool-apply-consistency |
| FX-024 | 套餐价「分」当「元」算收入放大 100 倍 → 进容量成本模型前分转元 + 跨单位守卫 | D-048 | 缺陷修复 | A | 小 | Claude | test:capacity-cost-guards |
| FX-025 | 到期删除硬删实例级联抹全部账单财务史 → 软删/删前归档账单，收入统计不依赖级联表 | D-004(横切F) | 缺陷修复 | A | 中 | Claude | test:billing-expiry-delete |
| FX-026 | 硬删用户级联抹资金/审计、RESTRICT 外键抛 500 → 软删/事务内清理 + 零余额校验 + 捕获外键错误 | D-003(横切F) | 缺陷修复 | A | 中 | Claude | test:admin-user-delete-resource-guards, test:user-destroy-incus-order |
| FX-027 | 删 VIP 奖励级联删领取记录致重建可重复领取 → 领取历史快照 + 禁级联删 + 奖励软删 | D-024(横切F) | 缺陷修复 | A | 中 | Claude | test:entertainment-vip-points-locks, test:vip-benefit-route-guards |
| FX-028 | 删抽奖活动/奖品级联删中奖记录 → 有记录只停用、历史快照、限制删除 | D-025(横切F) | 缺陷修复 | B | 中 | codex | test:entertainment-route-guards |
| FX-029 | 积分↔余额无比价护栏 + 奖池概率无总和约束 + 积分变动溢出 → 单抽期望余额≤消耗积分价值 + 概率和≤100% 原子校验 + 面值上限 + 统一安全 mutation | E12/D-026, D-087 | 规则调整 | A | 中 | Claude | test:points-mutation-amount-guards, test:entertainment-vip-points-locks |
| FX-030 | 礼品卡可无资金来源凭空发行、到账>面值、无撤销 → 禁无资金来源/到账>面值、允许发行人撤销未兑卡原额退回 | E4/BF-8-06/07 | 规则调整 | A | 中 | Claude | test:gift-card-guards, test:gift-card-flow |
| FX-031 | 交易所退款不补偿买家持有期消耗、抽成疑未入收入台账 → 退款计入卖家可保留款、抽成计入官方收入统计 | E24/BF-7-06/09 | 规则调整 | A | 中 | Claude | test:exchange-marketplace-guards, test:financial-reconciliation-guards |
| FX-032 | repay 重新支付不作废旧单可致网关重复扣款 → 同订单仅一有效支付单、作废旧单 | D3/BF-2-05 | 规则调整 | B | 小 | codex | test:recharge-state-transitions, test:recharge-gateway-order-guard |
| FX-033 | apply-aff 人人可事后绑他人码永久 95 折套利 → 砍掉事后绑他人码（或仅允许绑自己生成的码） | E10/BF-3-04 | 规则调整 | B | 小 | codex | test:invite-generation-accounting-guards |

---

## 波次 2 — 实例 / 交付 / 网络 / 终端 / 流量 生命周期（A/B 档）

**涉及模块**：M05 实例、M06 资源池、M13 网络流量、M14 终端、M09 风控、M24 宿主容量。
**主要文件**：`routes/instances.ts`、`app.ts`（createInstanceAsync 补偿）、`lib/managed-instance-provision.ts`、`workers/restoreTaskWorker.ts`、`services/instance-traffic-collector.ts`+`agent-instance-report.ts`、`routes/ip-addresses.ts`、`db/traffic.ts`+`routes/traffic.ts`、`lib/caddy-client.ts`、`routes/proxy-sites.ts`、`services/traffic-scheduler.ts`、`services/resource-risk.ts`、`lib/terminal-proxy.ts`+`routes/terminal.ts`、`db/resource-pool.ts`、`db/hosts.ts`。
**可并行子块**：{BF-5 交付 FX-040~046} ‖ {M05 FX-047~050} ‖ {M13 网络 FX-051~058} ‖ {G-A 流量策略 FX-059~065} ‖ {风控 FX-066~067} ‖ {M14 终端 FX-068~071} ‖ {资源池/容量 FX-072~074}。注意 caddy-client.ts 由 FX-055/057/058 串行；resource-risk.ts 由 FX-063/066/067 串行。

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-040 | 扣款成功但存储池/交付前置失败仅靠 ~10min 兜底退款、IPv4 释放分散 → 同步即时补偿退款 + 统一预留释放 | F-A BF-5-01, D-127, D-125 | 缺陷修复 | A | 中 | Claude | test:instance-create-failure-compensation |
| FX-041 | 秒杀超时清理/公网 IP 无货两条失败路径不释放库存、soldCount 不回滚 → 两路径也调 markFlashSaleFailed 释放 | F-A BF-5-02 | 缺陷修复 | A | 中 | Claude | test:flash-sale-guards, test:instance-create-failure-compensation |
| FX-042 | 静态 IP 分配失败仍标 running 交付 → 视为交付失败（退款+回收），不静默降级 | F-A BF-5-04, D-160 | 规则调整 | A | 中 | Claude | test:instance-create-failure-compensation |
| FX-043 | 托管代开通不建 IP 记录/不发通知邮件/不发插件事件/不标秒杀 → 补齐与自营一致 | F-A BF-5-05 | 缺陷修复 | B | 中 | codex | test:delivery-center-guards |
| FX-044 | 初始 createInstanceAsync 失败不产生 task、不进交付保障中心 → 自动开 DeliveryAssuranceCase | F-A BF-5-06 | 功能开发 | B | 中 | codex | test:delivery-center-guards |
| FX-045 | 实例创建失败原因不落库、详情页不展示 → 落 errorMessage + 详情页展示 | BF-5-07 | 规则调整 | B | 小 | codex | test:frontend-route-guards, test:frontend-i18n-keys |
| FX-046 | 普通付费开通无幂等键，超时重试/双击各扣款各建一台 → 加 idempotencyKey 幂等去重 | BF-5-08 | 缺陷修复 | A | 中 | Claude | test:instance-create-turnstile-guards, test:instance-task-cancel-race-guard |
| FX-047 | sync-status 可把 suspended 洗回 stopped 绕过封停 → 写库前排除 suspended | D-005 | 缺陷修复 | A | 小 | Claude | test:instance-operation-conflict-guards |
| FX-048 | 恢复流程删原实例→重命名失败即删唯一临时副本致数据全灭 → 删临时前确认原实例存在，否则保留 + 人工介入 | D-058 | 缺陷修复 | A | 中 | Claude | test:instance-recreate-consistency, test:backup-task-race-guards |
| FX-049 | 端口映射 DB 先于 Incus/结算抛错丢退款/config 计数漂移/事务后异常无补偿 → 补 checkPortInUse、结算落补偿队列、重算用量、异常纳入补偿 | D-126, D-128, D-129, D-127 | 缺陷修复 | B | 中 | codex | test:port-mapping-safety, test:instance-delete-incus-order |
| FX-050 | boost-processes 先写 DB，Incus 失败不抛致漂移 → Incus 失败回滚 DB 或返回部分失败 | D-144 | 缺陷修复 | B | 小 | codex | test:instance-route-id-guards |
| FX-051 | 流量双通道无采样版本，迟到旧上报回退快照重复计量 → 原子校验采样时间/序号，拒回退 | D-014 | 缺陷修复 | A | 中 | Claude | test:traffic-collector-status-guard |
| FX-052 | 批量端口映射 portMappings 绕过 NAT 范围与配额 → 统一校验数量/唯一/内外端口范围，按最终数计配额 | D-015 | 缺陷修复 | A | 中 | Claude | test:port-mapping-safety, test:ip-address-route-guards |
| FX-053 | IPv6 CIDR 不检子网重叠、不限前缀 → 规范化 + 起止地址重叠检查 + 强制前缀集 | D-016 | 缺陷修复 | A | 中 | Claude | test:ip-address-route-guards |
| FX-054 | 月流量重置不刷快照致串账 + 付费重置只清实例账本 + 加油包对实例级无效 → 采集锁内重建基线再原子清零、付费重置同扣用户级已用量、加油包作用实例级限额 | D-017/E23, BF-6-10, BF-6-11 | 缺陷修复+规则调整 | A | 中 | Claude | test:traffic-reset-locks, test:traffic-route-limit-guards |
| FX-055 | Caddy 新增路由把 POST 失败当不存在，PUT 覆盖全部路由致全站中断 → 仅明确 404 时创建，条件写/读合并 | D-018 | 缺陷修复 | A | 中 | Claude | test:proxy-site-route-id-guards |
| FX-056 | 证书查询直连 443 不走 outbound-security（SSRF/DNS rebinding）→ 连接前经统一出站安全组件锁定允许地址 | D-019 | 缺陷修复 | A | 小 | Claude | test:storage-outbound-guards, test:proxy-site-route-id-guards |
| FX-057 | Caddy 管理请求带 Basic Auth 却关闭 TLS 校验 → 受信 CA/指纹固定/mTLS，禁关证书校验 | D-020 | 缺陷修复 | A | 小 | Claude | test:proxy-site-route-id-guards |
| FX-058 | 流量通知占领状态失败被吞不补发 + 每 CaddyClient 建独立 Agent 泄漏 + 单天历史 X 轴 NaN → 通知 outbox 租约、复用 Agent、单条固定居中 | D-078, D-079, D-147 | 缺陷修复 | B | 小 | codex | test:traffic-notification-claim-guards, test:frontend-route-guards |
| FX-059 | trafficLimitSpeed 字段义与代码相反 → 定义为「正常线速」并改名/注释 + 另设独立超量限速值 | G-A BF-6-08 | 规则调整 | B | 中 | codex | test:plan-bandwidth-limit-guards, test:traffic-route-limit-guards |
| FX-060 | 实例级超量直接限速零预警 → 实例级加 80% 预警 | G-A BF-6-02 | 规则调整 | B | 小 | codex | test:traffic-route-limit-guards |
| FX-061 | 用户级（每月1号）与实例级（节点 resetDay）重置错位 → 用户级跟随节点重置日，或废用户级统一实例级 | G-A BF-6-03 | 规则调整 | B | 中 | codex | test:traffic-reset-locks |
| FX-062 | 流量重置/日聚合时区未固定 → 固定 Asia/Shanghai | G-A BF-6-04 | 规则调整 | B | 小 | codex | test:traffic-reset-locks |
| FX-063 | 流量超量限速与风控 QoS 两套共用带宽字段互不感知 → 统一到一个带宽仲裁点（明确优先级） | G-A BF-6-13 | 规则调整 | A | 中 | Claude | test:traffic-route-limit-guards, test:resource-risk-guards |
| FX-064 | 流量通知文案写死「限速1Mbit/下月1日重置」 → 按实际恢复带宽/节点重置日动态生成 | G-A BF-6-09 | 规则调整/清理 | C | 小 | codex | test:frontend-i18n-keys |
| FX-065 | trafficResetPrice 分/元易误配 → 统一以「元」存储 + 后台输入提示 | G-A BF-6-12 | 规则调整 | B | 小 | codex | test:system-config-value-guards |
| FX-066 | 风险分衰减恒 0 致一次异常永久限速/限单 + QoS 绝对带宽不随套餐缩放 → 衰减「距上次触发每小时-5分」按累计时长、scoreDecayPerHour 纳入可配、QoS 按套餐带宽百分比(50/30/10%) | E2/E13/D-006, BF-6-05/06/07 | 缺陷修复+规则调整 | A | 中 | Claude | test:resource-risk-guards |
| FX-067 | 风控评估 TOCTOU 无锁 + 交易所购买/受让绕过下单限制 + 下单限制无唯一约束 + 自动处置不写审计 + QoS 两步非原子 → 加锁/接入限制/唯一索引/写中心 Log/同事务落库 | D-134, D-133, D-163, D-164, D-175 | 缺陷修复 | B | 中 | codex | test:resource-risk-guards, test:risk-audit-guards |
| FX-068 | WS 初次建连期未装 close 监听致僵尸会话（约 12h） → 建连前监听关闭 + 完成后复核 OPEN 再登记 | D-021 | 缺陷修复 | A | 中 | Claude | test:terminal-route-id-guards |
| FX-069 | Incus 重连期不复核会话存在致无人管理连接 → 可取消代次标识 + 复核会话/客户端态 | D-022 | 缺陷修复 | A | 中 | Claude | test:terminal-route-id-guards |
| FX-070 | 审计日志失败被当终端连接失败并关闭正常会话（owner 反馈 "Failed to connect"） → 日志失败与连接生命周期隔离 | D-023 | 缺陷修复 | A | 小 | Claude | test:terminal-route-id-guards |
| FX-071 | 断开审计未捕获 rejection + 连接上限非原子 + 快捷命令 100 上限竞态 → 捕获异常/原子预留名额/DB 约束 | D-080, D-081, D-082 | 缺陷修复 | B | 小 | codex | test:terminal-route-id-guards, test:terminal-saved-command-route-id-guards |
| FX-072 | 资源池申领无主机容量上限校验致 OOM 超卖 → 同事务按 reserveResources 同款条件校验剩余容量，超限回滚 patch | D-059 | 缺陷修复 | A | 中 | Claude | test:resource-pool-apply-consistency, test:host-resource-atomic-guards |
| FX-073 | 改配抹池加成 + 申领无对账 + amount 无上限 bigint 溢出 → 改配并入历史 apply、轻量对账、amount maximum | D-073, D-161, D-171 | 缺陷修复 | B | 小 | codex | test:resource-pool-apply-consistency, test:resource-quota-bigint-guards |
| FX-074 | 宿主机用量绝对覆盖并发丢失更新 → 事务内原子 increment 或加锁重算 | D-051 | 缺陷修复 | A | 中 | Claude | test:host-resource-atomic-guards, test:batch-config-route-guards |

---

## 波次 3 — 各业务模块 规则调整 + 清理（B 档主 · codex；含少量 A 档安全项 Claude）

**涉及模块**：M12 秒杀/礼品卡/兑换码、M19 邮箱（非功能）、M20 Hosting（非功能）、M17 工单、M21 插件市场、M22 主题、M08 交易所/转账、M11 商城、M18 通知、M23 API/SDK、M24 运营台、M15 好友、M04 死状态清理。
**可并行子块**（不同模块互不相交，可并行；模块内串行）：{M12} ‖ {M19} ‖ {M20} ‖ {M17} ‖ {M21} ‖ {M22} ‖ {M08} ‖ {M11} ‖ {M18} ‖ {M23} ‖ {M24} ‖ {M15}。
**【安全优先】** 标注项（FX-123 插件 action 授权、FX-127/128 主题 XSS/密钥、FX-141 refresh token）为 A 档，须 Claude 先行，是本波内最高优先。

### M12 秒杀 / 礼品卡 / 兑换码 — `routes/flash-sales.ts`+`services/flash-sales.ts`、`routes/gift-cards.ts`、`routes/checkin.ts`+`db/redeem-codes.ts`

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-080 | 秒杀价无下限/可≥原价/续费恢复原价无提示 → 强制 0<秒杀价<原价 + 明示「仅首期优惠续费恢复原价」 | E11/BF-8-04/05/11 | 规则调整 | B | 中 | codex | test:flash-sale-guards |
| FX-081 | 免费套餐规格后端零上限 + h-码无容量/额度护栏且可叠加付费实例 → 免费规格强制≤套餐 max、h-码校验宿主容量、设总发行额度、禁 h-码用于付费实例 | E3/BF-5-03/BF-8-09/10 | 规则调整 | A | 中 | Claude | test:package-plan-input-guards, test:redeem-code-management-guards, test:instance-quota-zero-guards |
| FX-082 | 秒杀 maxPerUser 逐商品计数却展示为活动总限购 → 跨活动内所有商品合计 | G-C BF-8-02 | 规则调整 | B | 小 | codex | test:flash-sale-guards |
| FX-083 | allowAff 与 allowCoupon 必须同开才生效 → allowAff 独立生效 | G-C BF-8-03 | 规则调整 | B | 小 | codex | test:flash-sale-guards |
| FX-084 | scheduled 秒杀到点不自动开场（用户走死胡同）→ 到开始时间自动转 active | F-B BF-8-01 | 功能开发 | B | 小 | codex | test:flash-sale-guards |
| FX-085 | 礼品卡懒过期致后台可用数/未兑负债虚高 → 统计按 expiresAt 实时排除过期 | F-B BF-8-08 | 缺陷修复 | B | 小 | codex | test:gift-card-guards |
| FX-086 | 积分兑换码 p 是废弃概念（两套死逻辑）→ 正式取消并清理死代码（含 Q-C3 签到分层/资源池死分支） | F-B BF-8-13/Q-C3 | 清理 | C | 小 | codex | test:redeem-code-management-guards |
| FX-087 | 已用 h-码可物理删除并级联清使用记录 → 有使用记录只允许禁用/归档 | F-B BF-8-14 | 规则调整 | B | 中 | codex | test:redeem-code-management-guards |
| FX-088 | h-码用户端仍展示旧签到码文案（3小时/每日/不超上限）→ 改显每张 h-码自己的有效期/次数/「资源永久叠加」 | G-C BF-8-12 | 规则调整/清理 | C | 小 | codex | test:frontend-i18n-keys |
| FX-089 | 系统兑换未锁实例丢失更新 + 完整码写日志成 bearer + 库存事务外竞态 + 交付非原子 + 价格 TOCTOU → 实例锁覆盖整段、码值日志掩码、库存同事务锁 + 锁后复校、带原状态 updateMany、绑定价格版本 | D-010, D-011, D-012, D-013, D-060 | 缺陷修复 | A | 中 | Claude | test:system-redeem-consistency, test:flash-sale-guards |

### M19 邮箱（非功能项；过期自救/自动续费见波4） — `routes/mail.ts`、`services/cranemail`+`smartermail`

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-090 | 域名创建/批量退订无补偿（孤儿域名/半删）+ 账号创建无同域锁误删他人远端 → 可重试任务 + 逐域名状态台账 + 补偿删除 + 域名+用户名事务锁 | F-C BF-9-11, D-032, D-034, D-062 | 缺陷修复 | A | 中 | Claude | server type-check（无专用守卫，补充 mail 会计守卫） |
| FX-091 | 邮箱实际用量从不同步 → 定时同步上游域名/账号实际用量 | F-C BF-9-12 | 功能开发 | B | 中 | codex | server type-check |
| FX-092 | 前端「每地区一份」vs 后端「全局一份」 → 订阅改「每邮箱源各一份」前后端一致 | G-B BF-9-04 | 规则调整 | B | 中 | codex | test:frontend-route-guards |
| FX-093 | diskLimitGb 口径含糊（每域名/每账号各得完整空间）→ 定义为整订阅共享总空间 + 合计校验 | G-B BF-9-09 | 规则调整 | B | 中 | codex | server type-check |
| FX-094 | SmarterMail 响应无限长 + 邮箱文案「即时开通/随时退款」与实现不符 + Webmail 地址硬编码 → 限长读取、文案改人工退款、内置文档、Webmail 地址来自邮箱源配置 | D-095, BF-9-13/14/15 | 缺陷修复/清理 | B | 中 | codex | test:frontend-i18n-keys |

### M20 Hosting（非功能项；出金/审核见波4） — `routes/hosting.ts`、`services/hosting-scheduler.ts`

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-095 | 解冻任务全批同事务，单用户锁冲突回滚全部 → 按用户/有限批次独立事务 + 跳过锁冲突短周期重试 | D-035 | 缺陷修复 | A | 中 | Claude | test:hosting-balance-guards |
| FX-096 | 管理员扣 available 日志符号写反（正数像入账）→ 改负数与全站口径一致 | G-F BF-10-07 | 缺陷修复 | B | 小 | codex | test:hosting-balance-guards |
| FX-097 | 前后端手续费舍入不同差 0.01 + 拉黑候选返回他人完整邮箱 + 日志搜索无界 IN + 钱包失败吞错显零 → 统一以分舍入、邮箱脱敏、分页上限、保留失败态 | D-096, D-097, D-098, D-099 | 缺陷修复 | B | 小 | codex | test:hosting-balance-guards, test:admin-hosting-route-id-guards, test:frontend-route-guards |

### M17 工单 / AI 客服（自动关闭可配见波4） — `routes/tickets.ts`、`services/ai-ticket-*`、`lib/ticket-attachments.ts`

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-098 | 关闭 ticket_enabled 封锁整个工单中心 → 仍允许查看/回复已有工单，只禁新建 | F-E BF-11-01 | 规则调整 | B | 中 | codex | test:frontend-route-guards |
| FX-099 | semi_auto 发送时重新生成新回复、不用已审草稿 → 发管理员已审最终正文 | F-E BF-11-04 | 缺陷修复 | B | 中 | codex | test:ai-ticket-context-guards |
| FX-100 | AI 单工单额度用日志子串匹配（#1 命中 #10）→ 按精确 ticketId 统计 | F-E BF-11-06 | 缺陷修复 | B | 小 | codex | test:ai-ticket-context-guards |
| FX-101 | 被拦截工单永久占满自动扫描批次 → 进人工队列并退出后续自动扫描 | F-E BF-11-07 | 规则调整 | B | 中 | codex | test:ai-ticket-context-guards |
| FX-102 | sensitiveHandoffRules 是死配置（加载器不读）→ 改可配置生效 | F-E BF-11-09 | 规则调整 | B | 中 | codex | test:ai-ticket-context-guards |
| FX-103 | 管理队列先分页后过滤（total 错误/当前页空）→ 先全量过滤排序再分页 + 返回过滤后 total | F-E BF-11-10 | 缺陷修复 | B | 小 | codex | test:ticket-query-guards |
| FX-104 | 自动关闭从 resolvedAt 计时、客服追加回复不刷新 → 从最后一条公开消息重新计时 | F-E BF-11-03 | 缺陷修复 | B | 小 | codex | test:ticket-auto-close-guards |
| FX-105 | 客服首响不进 in_progress/SLA met 含逾期/角标统计口径错/自动上限拦手动/网页不能重开 → 客服首响进 in_progress、met 仅按时解决、角标只统计需客服回复、上限只限调度器、普通用户网页可重开 | G-D BF-11-15/12/11/05/13 | 规则调整 | B | 中 | codex | test:ticket-query-guards, test:frontend-route-guards |
| FX-106 | AI 自动回复只内存防重可重复发送 + 人工状态先读后无条件更新覆盖新回复 → 事务内原子抢占 + 幂等键、带 version/状态条件更新 | D-027, D-028 | 缺陷修复 | A | 中 | Claude | test:ai-ticket-context-guards, test:ticket-query-guards |
| FX-107 | 6×50MB 图片全量常驻内存致 OOM → 显著降上限 + 总字节预算流式上传 | D-029 | 缺陷修复 | A | 中 | Claude | test:ticket-image-security |
| FX-108 | 提示注入 + 信任模型自报 confidence 自动发送 → 客户内容标记不可信 + 服务端确定性策略决定自动发送 | D-061 | 缺陷修复 | A | 中 | Claude | test:ai-ticket-context-guards |
| FX-109 | 上传只信 MIME 不检魔数 + Lsky providerFileId null 泄漏 + setInterval 无句柄 + Lsky 未就绪不隐藏组件 → 验魔数/保存可回收标识/句柄 unref/公开配置返回附件不可用 | D-089, D-136, D-151, BF-11-14 | 缺陷修复/清理 | B | 小 | codex | test:ticket-image-security, test:lsky-production-proof-guards |

### M21 插件市场 — `routes/plugins.ts`+`admin-plugins.ts`、`lib/plugin-*`、`plugin-market-*`

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-110 | 付费无交易闭环（paid=免费直装）→ 本期禁止上架 paid 插件/主题条目（直到闭环上线，见波4 FX-165） | F-F BF-12-01/02 | 规则调整 | B | 中 | codex | test:plugin-market-governance-guards, test:extension-platform-guards |
| FX-111 | 发布器保留旧索引，delisted/rejected 不真下架（插件+主题）→ 以 DB 当前有效状态为准，无有效版本的 ID 从索引删 | F-F BF-12-03, D-038, D-042 | 缺陷修复 | B | 中 | codex | test:plugin-market-publish-guards |
| FX-112 | 扫描未过/失败也能标 listed 发布器随后静默忽略 → listed 仅在最近扫描 passed/warning 时可设 | F-F BF-12-05 | 规则调整 | B | 小 | codex | test:plugin-market-submission-scan-guards |
| FX-113 | 多版本字符串排序循环覆盖 latest 回退旧版（插件+主题）→ 每 ID 只发最高 SemVer 且审核有效的一个版本 | F-F BF-12-04, D-101, D-104 | 缺陷修复 | B | 中 | codex | test:plugin-market-publish-guards |
| FX-114 | 升级后 enabled/status 不一致（显示启用实际不加载）→ 进「待重新启用」状态，前后端统一显示 | F-F BF-12-14 | 缺陷修复 | B | 中 | codex | test:plugin-center-guards, test:frontend-route-guards |
| FX-115 | 平台上传包不固化到稳定目录（安装白名单拦截）+ 孤儿文件不清 → 发布固化审核包+manifest 到稳定市场目录 + finally 清理 | F-F BF-12-11, D-105 | 缺陷修复 | B | 中 | codex | test:plugin-market-publish-guards |
| FX-116 | 主题投稿只有 API 无用户端 UI → 补齐用户端主题投稿入口（与插件一致） | F-F BF-12-07 | 功能开发 | B | 中 | codex | test:frontend-route-guards, test:frontend-i18n-keys |
| FX-117 | 填任意 GitHub URL 即自动 verified → 改独立字段，只能管理员明确认证 | G-E BF-12-08, D-102 | 规则调整 | B | 小 | codex | test:plugin-market-governance-guards |
| FX-118 | 高风险 capability 安装后才审、不阻上架 → 公共上架前完成审核 | G-E BF-12-06 | 规则调整 | B | 中 | codex | test:plugin-runtime-capabilities-guards, test:plugin-market-governance-guards |
| FX-119 | 定价元数据无货币规范 → 统一「最小单位整数+币种白名单+固定抽成口径」拒绝不完整 paid | G-E BF-12-09 | 规则调整 | B | 中 | codex | test:plugin-market-governance-guards |
| FX-120 | 兼容性口径不统一 → 以 manifest payincus 范围为唯一兼容真源全过程统一 | G-E BF-12-10 | 规则调整 | B | 小 | codex | test:plugin-market-submission-guards |
| FX-121 | 复审无历史、下架/拒绝可不填原因 → 必填原因 + 保存不可覆盖审核历史 | G-E BF-12-13 | 规则调整 | B | 中 | codex | test:plugin-market-submission-guards |
| FX-122 | 文档夸大商业化 + 评分/安装量固定 0 无采集 → 文档改「商业字段仅预留」+ 界面移除评分/安装量待定义口径 | G-E BF-12-12, BF-12-15 | 清理/文档 | C | 小 | codex | test:plugin-center-guards |
| FX-123 | 通用 action 路由只需登录可绕管理员鉴权调支付/交付 → 按 scope/source 强制 actor 授权，禁用户入口调 gateway/service/system action 【安全优先】 | D-036 | 缺陷修复 | A | 中 | Claude | test:plugin-runtime-capabilities-guards, test:plugin-business-event-guards |
| FX-124 | 到期重试先查后执行无抢占致重复投递 → DB 原子 claim / FOR UPDATE SKIP LOCKED + 运行互斥 | D-037 | 缺陷修复 | A | 中 | Claude | test:plugin-business-event-guards, test:scheduler-startup-idempotency |
| FX-125 | 插件包解压无大小/数量/类型限制（压缩炸弹/FIFO）→ 限条目数/声明尺寸、只允许普通文件、配额流式解压 | D-039 | 缺陷修复 | A | 中 | Claude | test:plugin-package-guards |
| FX-126 | 资源鉴权只匹配入口 HTML，后台 JS 落公开 → 按 admin/user 资源根或清单保护整套依赖 | D-100 | 缺陷修复 | B | 中 | codex | test:plugin-client-boundary-guards |

### M22 主题 — `routes/themes.ts`+`admin-themes.ts`、`lib/theme-package.ts`

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-127 | 模板正则净化被 HTML 实体绕过，v-html 存储型 XSS → 白名单 HTML 净化器 + 解码后协议校验 + 实体/SVG/样式守卫用例 【安全优先】 | D-040 | 缺陷修复 | A | 大 | Claude | test:theme-system-guards |
| FX-128 | 公开 /active 返回含 password 类型 configValues → 专用 DTO 彻底移除密码/秘密字段 【安全优先】 | D-041 | 缺陷修复 | A | 小 | Claude | test:theme-system-guards |
| FX-129 | 安装先替换资源后更新 DB 绕过未启用状态 + 启用主题事务无锁多个 enabled → 版本不可变目录 + 原子状态切换 + DB 失败回滚 + 唯一约束 | D-043, D-103 | 缺陷修复 | A | 中 | Claude | test:theme-system-guards |
| FX-130 | 主题归档校验无大小/数量限制（压缩炸弹/FIFO）→ 校验条目类型/数量/声明尺寸 + 配额解压 | D-044 | 缺陷修复 | A | 中 | Claude | test:theme-system-guards |

### M08 交易所 / 转账 — `services/exchange.ts`、`routes/transfers.ts`、`services/billing-scheduler.ts`

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-131 | 挂牌中实例照常到期封停删除（删在售商品）→ 到期自动下架 + 允许续费/暂缓删除，不删挂牌实例 | E6/BF-7-03 | 规则调整 | A | 中 | Claude | test:exchange-lifecycle-guards, test:billing-expiry-delete |
| FX-132 | 0价/免费获得实例挂牌无溢价上限可套现 → 给独立价格上限 | E14/BF-7-04 | 规则调整 | B | 小 | codex | test:exchange-marketplace-guards |
| FX-133 | 系统自动取消实例转账/交易不退手续费（与「拒绝退还」文案冲突）→ 自动取消必退手续费（费率固定额/发起方承担保持） | E15/BF-7-02 | 规则调整 | B | 小 | codex | test:transfer-query-guards |
| FX-134 | 普通转账过户不重置 autoRenew/凭证（与交易所不一致）→ 默认关 autoRenew + 提示重置凭证 | G-F BF-7-07 | 规则调整 | B | 小 | codex | test:transfer-query-guards |
| FX-135 | 交易所无买家「确认收货即放款」入口 → 新增买家主动确认放款端点 | F-D BF-7-05 | 功能开发 | B | 中 | codex | test:exchange-lifecycle-guards, test:frontend-route-guards |
| FX-136 | 交易所死状态（escrowed/delivered/paused/redelivering）从不写入 → 清理占位 | F-D BF-7-08 | 清理 | C | 小 | codex | test:exchange-lifecycle-guards |
| FX-137 | 转移手续费退款与状态翻转不同事务丢退款 + executeTransfer 无条件写不复检 + 金额 JS number 精度 → 退款并入同事务、加 status:processing 条件、Decimal 层计算 | D-074, D-173, D-174, D-133 | 缺陷修复 | B | 中 | codex | test:transfer-query-guards, test:exchange-marketplace-guards |

### M11 商城 / M18 通知 / M23 API / M24 运营台 / M15 好友 / M04 死状态

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-138 | 公开商城售罄只查 CPU/内存遗漏磁盘/盘池 + 配额释放不去重 hostIds 无事务超卖 → 复用统一批量售罄检查、入口去重 + 同一事务 | D-008, D-009 | 缺陷修复 | B | 中 | codex | test:package-soldout-capacity-guards, test:plan-upgrade-capacity-guards |
| FX-139 | 非所有者可读未启用方案 + 无分页 2N+1 + 加载无请求序号 → 未启用仅所有者可读、分页+批量读、AbortController | D-075, D-076, D-077 | 缺陷修复 | B | 小 | codex | test:package-route-id-guards, test:frontend-route-guards |
| FX-140 | 通知渠道 Token 明文落库 + 广播非同事务无幂等 + 绑定 Token 不同事务 + 全站广播无界 → 字段级加密、同事务+幂等、游标分批 | D-090, D-091, D-092, D-093 | 缺陷修复 | B | 中 | codex | test:admin-notification-channel-guards, test:inbox-query-guards, test:telegram-bind-token-race-guard |
| FX-141 | refresh token 轮换非原子可并发重放 → 行锁或带 revokedAt:null 条件原子消费 【安全优先】 | D-045 | 缺陷修复 | A | 小 | Claude | test:refresh-token-storage, test:public-api-token-guards |
| FX-142 | SDK 服务操作/续费/通知模板/余额调整字段与后端/OpenAPI 漂移致示例崩溃 → 以 OpenAPI + 真实响应为准统一 | D-047, D-106, D-117, D-119 | 缺陷修复 | B | 中 | codex | test:public-api-sdk-guards, test:public-api-openapi-guards |
| FX-143 | 余额调整 5 上限 check-then-create 竞态 + PAT 无用户上限/无分页 → advisory lock 内复检、token 上限+有界分页 | D-107, D-108 | 缺陷修复 | B | 小 | codex | test:public-api-resource-guards, test:public-api-token-guards |
| FX-144 | SLA 规则阈值可保存但扫描不读取 + 单条静默不检查 → 扫描/合并以持久化规则为唯一参数 + 事件级 silencedUntil | D-052, D-109 | 缺陷修复 | B | 中 | codex | test:sla-alert-guards |
| FX-145 | 自动快照后置失败重复建快照 + 批量更新非原子状态分叉 + 容量概览 GET 含写 → 只重试幂等 Incus 阶段+幂等键、可恢复状态机、GET 只读 | D-049, D-050, D-110 | 缺陷修复 | B | 中 | codex | test:auto-policy-scheduler-guards, test:batch-config-route-guards, test:capacity-cost-guards |
| FX-146 | 好友双向请求竞态 + 状态机方向错乱 + removed 误显「已拒绝」 + N+1 + 分页解析宽松 → 唯一约束+单事务、重建方向、独立文案、聚合、严格解析 | D-084, D-085, D-148, D-149, D-150 | 缺陷修复 | B | 小 | codex | test:friend-route-guards, test:frontend-i18n-keys |
| FX-147 | 订单 paid 死状态从不写入却被前端当完成态统计 → 补齐语义或移除，前端停止统计 | Q-C5/BF-2-04 | 清理 | C | 小 | codex | test:billing-query-guards, test:frontend-route-guards |
| FX-148 | 返利转化「管理员审核」是死功能（代码自动即时到账）→ 与波4 FX-161（AFF 后台可配）一并明确自动/人工口径并清理 | Q-C1/BF-3-03 | 清理 | C | 小 | codex | test:aff-review-ui-guards |

---

## 波次 4 — 功能开发（大）· 逐个单独立项（A 档设计 · Claude 定规格 + codex 实现）

> 这些是**新功能/大改造**，需事后单独设计（数据模型、后台可配、审核流、结算），**不塞进快速修复波**。均需 owner 确认权益/费率/口径细节后落地。

| FX | 功能 | 来源 | 规模 | 执行 | 守卫 | 关联 |
|----|------|------|------|------|------|------|
| FX-160 | **VIP 四类分级持续权益**：按等级给折扣/配额/流量/费率优惠（现为纯荣誉）+ 废弃 benefitHall 死配置并轨到生效奖励体系 | A2/Q-A2/BF-4-01, Q-C4/BF-4-02 | 大 | Claude+codex | test:vip-level-rules-ui-guards, test:vip-benefit-route-guards, test:entertainment-vip-points-locks | — |
| FX-161 | **返利/佣金后台可配**：AFF 邀请返利折扣/返利%（现硬编码 5%/5%）+ Hosting 平台佣金%（现节点主人拿 100%）后台可配、收入侧按配置抽成 | A1/E1/BF-3/BF-10-01 | 大 | Claude+codex | test:invite-generation-accounting-guards, test:hosting-balance-guards | Q-C1(FX-148) |
| FX-162 | **Hosting 现金出金渠道**：真实提现通道 + 提现手续费 + 现金提现人工审核（转面板余额免审即时）；现只能转面板余额、审核是死流程 | E17/BF-10-09 + F-D BF-10-03 | 大 | Claude+codex | test:hosting-balance-guards, test:admin-hosting-route-id-guards | E18(FX-014) |
| FX-163 | **邮箱自动续费**：设置入口 + 自动扣款执行器 + 失败处理（autoRenew 现为死开关；自动续费也限每次 1 月，D5） | F-C BF-9-03, D5/BF-1-05 | 大 | Claude+codex | server type-check | — |
| FX-164 | **邮箱过期自救 + 上游暂停**：过期后允许续费恢复原订阅 + 到期同步暂停所有上游域名、续费恢复（含 D-030 P1 上游暂停部分，建议 P1 优先落地） | F-C BF-9-01/02, D-030 | 大 | Claude+codex | server type-check | D-030 P1 |
| FX-165 | **插件/主题交易闭环**：购买/授权/退款/分成/结算 + 开发者收入（数据模型全缺）；本期先只做「禁 paid 上架」（FX-110），完整闭环单独立项 | F-F BF-12(闭环) | 大 | Claude+codex | test:plugin-market-governance-guards | FX-110 |
| FX-166 | **工单自动关闭可配**：加可配置超时 + 可关开关（现固定 24h 不可配/不可关） | G-D BF-11-02 | 中 | codex | test:ticket-auto-close-guards | — |

---

## 波次 5 — P2/P3 打磨 / 低危收尾（C 档 · codex）

**涉及模块**：M26 前端基座、M01 认证残项、M03 支付纵深、M07 Agent 硬化、M25 日志、M10 配置校验、M02 用户列表、M16 游戏化可靠性、横切 i18n/内存态。
**护栏**：M26 改动**必跑** `test:frontend-route-guards`，注意表格布局守卫锁定清单（绝不改横向滚动）。

| FX | 一句话 | 来源 | 类型 | 档 | 规模 | 执行 | 守卫 |
|----|--------|------|------|----|------|------|------|
| FX-180 | 前端基座：跨标签 token 变化不清 user/quota 身份错配、恢复轮询乱序、配置失败开放、SW 越界删缓存、全局无错误边界、6天刷新登出后重写 token → 原子清身份/单飞轮询/失败安全降级/命名空间缓存/错误边界/世代校验 | D-054, D-113, D-114, D-115, D-116, D-139 | 缺陷修复 | C | 中 | codex | test:frontend-route-guards, test:frontend-dist-boundary-guards |
| FX-181 | M01 认证：正则 g 标志漏检、验证码无尝试上限、refresh 吞异常踢下线、注册先耗验证码后查重、邮箱无 DB 唯一约束、日志打 hash 前缀、恢复码双写审计、2FA 密钥可预测回退 → 逐条收紧 | D-064, D-065, D-120, D-121, D-122, D-153, D-154, D-168 | 缺陷修复 | C | 中 | codex | test:email-verification-code-storage, test:registration-concurrency-guards, test:auth-session-status-guards, test:refresh-token-storage |
| FX-182 | M03 支付纵深：verify 金额被 paidAmount>0 短路、兜底手写 MD5 死代码、V1 验签非常量时间、回调 IP 白名单空即放行、手动完成无上限、解密失败静默返原文 → 硬校验/删死分支/常量时间/独立 IP 段/上限/告警 | D-123, D-124, D-156, D-157, D-169, D-170 | 缺陷修复 | C | 中 | codex | test:recharge-callback-payload-guard, test:recharge-callback-url-guard, test:antom-payment-guards |
| FX-183 | M07 Agent 硬化：自升级允许 http 且响应无签名（MITM 投毒 root）、certPath 用户任意指定 SSRF、恶意宿主伪造流量、详情回显证书路径、一次性口令置 URL、FRONTEND_URL 缺省从转发头推导 → 强制 https+升级签名/白名单/上限/去回显/改 header/可信来源（升级签名部分 A 档由 Claude 定） | D-130, D-131, D-132, D-145, D-162, D-172 | 缺陷修复 | C(部分A) | 中 | codex | test:incus-certificate-paths, test:agent-report-state-guards, test:agent-response-redaction, test:agent-auth |
| FX-184 | M25 日志：审计写失败吞掉无告警、ss/netstat 解析错位、CSV 公式注入、CORS/Origin 未限协议 → outbox+告警/分源解析/中和转义/协议白名单 | D-111, D-112, D-137, D-138 | 缺陷修复 | C | 小 | codex | test:log-query-guards, test:cors-origin-config, test:websocket-origin-guard |
| FX-185 | M10 配置：footer_telegram_link 无协议校验存储型 XSS、telegram chat_id 脱敏不一致、OTA 允许降级、avatar_api_base 无 URL 校验客户端 SSRF → 协议/URL 白名单校验、纳入脱敏键、目标≥当前语义、长度上限 | D-135, D-146, D-165, D-166 | 缺陷修复 | C | 小 | codex | test:system-config-value-guards, test:system-update-guards |
| FX-186 | M02 用户列表 N+1/lifecycle take:1000 内存分页、M16 奖池保存非原子、中奖通知无持久重试 → 批量聚合+DB 分页、整池替换事务、通知 outbox+幂等重试 | D-066, D-155, D-086, D-088 | 缺陷修复 | C | 小 | codex | test:user-lifecycle-guards, test:entertainment-route-guards |
| FX-187 | i18n 硬编码中文/缺 key/词典不完整强制回退简中（多前端页+后端文案）→ 抽 i18n key 补齐 en/zh-TW、后端改错误码、守卫递归比对 | D-152(横切G) | 清理 | C | 中 | codex | test:frontend-i18n-keys |
| FX-188 | 内存态 Map（登录锁/nonce/交割去重/配置缓存）多进程失效 → 确认单实例部署假设并写入架构文档（横向扩容前下沉共享存储/变更失效） | D-167(横切H) | 清理/文档 | C | 小 | codex | — |

---

## 八、已确认「保持现状 / 不改」（归档，避免重复当问题）

> owner 明确裁决为「保持策略」或「已由既有修复覆盖」，**不进修复计划**。

| 项 | 来源 | 裁决 |
|----|------|------|
| 流量按「进+出双向合计」计费 | E7/BF-6-01 | 维持双向合计，不改只计出站/取较大方向 |
| 转账手续费率（固定额 / 发起方承担 / 成功归平台） | E15/BF-7-02/01 | 费率保持；仅「系统自动取消必退」是要改（→ FX-133） |
| 非易支付渠道从到账额扣手续费（用户少到账） | D2/BF-2-01 | 保持现状 |
| 内置渠道无原路退款（靠加余额兜底） | D4/BF-2-07 | 既定策略，保持 |
| 销毁免手续费「一生一次」（首次免费、此后 10%） | D6/BF-1-06 | 合理，保持 |
| 连续签到无递增奖励（streakDays 只展示） | D7/BF-4-04 | 保持，不加递增曲线 |
| 31 天/月 交付计费基准 | D8/BF-1-07 | 保持（延期口径已在 FX-019 统一到 31 天；退款/剩余价值改实际时间比例见 FX-020） |
| 实例退款 = 加到余额 | A3/BF-2-08 | 现状已正确，不动（仅充值来源退款改扣减 → FX-010） |
| 消费兑积分后退款冲减已兑积分 | E16/Q-B4/BF-4-06 | owner 改判为「退款冲减」，但其套利根因（消费→退款→再消费虚增可兑积分/VIP）**已由 D-176 净消费口径修复覆盖**（既往不咎，向前修正），本期不再单独立项；如需主动倒扣已发积分可后续单独评估 |
| 用户级「累计消费」净额口径 | D-176/M04/M16 | **✅ 已修复（2026-07-11）**：净消费=SUM(consume)−SUM(挂实例的 refund)，已过 test:recharge-accounting-guards / test:points-mutation-amount-guards + 真 PG 验证 |

---

## 九、统计

### 要改项（FX）计数

| 维度 | 明细 |
|------|------|
| **总数** | **152** |
| 按波次 | 波0=8 · 波1=24 · 波2=35 · 波3=69 · 波4=7 · 波5=9 |
| 按类型 | 缺陷修复 ≈ 96 · 规则调整 ≈ 38 · 功能开发（含补齐）≈ 11 · 清理 ≈ 7 |
| 按风险档 | A（Claude）≈ 55 · B（codex）≈ 78 · C（codex 快审）≈ 19 |
| 按执行方 | Claude 主导 ≈ 55（波0全部 + 波1/2 的 A 档 + 波3 安全优先项 + 波4 定规格）· codex 主导 ≈ 97 |

> 计数为合并后 FX 条目数（一条 FX 常合并多个 D-###/BF）。合并前：DEFECTS 175 条（P0×1/P1×62/P2×76/P3×36，D-176 已修）+ BEHAVIOR「要改/清理/新功能」裁决约 90 条。

### 功能开发（大）— 7 项

1. **FX-160** VIP 四类分级持续权益（A2）
2. **FX-161** AFF 返利% + Hosting 平台佣金% 后台可配（A1/E1）
3. **FX-162** Hosting 现金出金 + 手续费 + 提现人工审核（E17/BF-10-03）
4. **FX-163** 邮箱自动续费（BF-9-03）
5. **FX-164** 邮箱过期自救 + 上游暂停（BF-9-01/02，含 D-030 P1）
6. **FX-165** 插件/主题交易闭环（本期仅「禁 paid 上架」FX-110，闭环单独立项）
7. **FX-166** 工单自动关闭可配（BF-11-02）

### 波0 / 波1 具体编号

- **波0 安全阻断（8）**：FX-001(D-001 P0 插件会话接管) · FX-002(D-002 OAuth 开放重定向) · FX-003(D-056 外呼 SSRF) · FX-004(D-057+D-046 trustProxy/限流) · FX-005(D-053 日志脱敏) · FX-006(D-118 apiError 泄漏) · FX-007(D-007 管理员自提权 OTA) · FX-008(D-055 root 提权链)。
- **波1 资金/计费（24）**：FX-010(A3 充值退款扣减) · FX-011(E5① 删除退款回扣) · FX-012(E5② AFF 佣金冲回) · FX-013(E5③/Q-C2 禁用码停佣金) · FX-014(E18 回扣记欠款) · FX-015(E19 销毁费归平台) · FX-016(E20 补发不计收入) · FX-017(E8 邮箱退款实付) · FX-018(E21 年付12月) · FX-019(E9 延期31天+升级封顶+version锁) · FX-020(E22 计费月比例口径) · FX-021(订单退款状态/实付上限) · FX-022(续费预检折后价) · FX-023(到期删除拒续费+改配) · FX-024(D-048 收入单位×100) · FX-025(D-004 到期硬删账单) · FX-026(D-003 用户硬删) · FX-027(D-024 VIP奖励级联) · FX-028(D-025 抽奖级联) · FX-029(E12 积分护栏+奖池概率) · FX-030(E4 礼品卡资金来源) · FX-031(E24 交易所退款/抽成入账) · FX-032(D3 repay作废旧单) · FX-033(E10 apply-aff 砍事后绑码)。

---

> **护栏重申**：修复期不做大重构；表格布局守卫锁定表绝不改横向滚动；UI 只动样式/文案；每完成一条即跑对应守卫（本文每行已列）；commit / 发版 / OTA 一律等 owner 明确指令。
