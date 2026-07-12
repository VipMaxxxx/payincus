# M09 审计报告

## 结论摘要
M09 风控在鉴权/参数校验/证据留存上做得比较扎实(geoip 有 isIP 校验 + encodeURIComponent + 队列硬上限,路由全部 authenticateAdmin,守卫覆盖面广)。但存在一个高危逻辑缺陷:风险分自动衰减在现有调度节奏下恒为 0,导致自动降级/恢复整条链路失效、正常用户被永久限速/限单(误伤)。此外还有下单限制可经交易所购买绕过、评估与人工处置之间无并发锁的竞态、以及 request.ip 可被 XFF 伪造等问题。

## 发现清单

- [M09-01] P1 | 置信度 高 | server/src/services/resource-risk.ts:255-258(配合 492-496、schema 2092)
  - 问题:风险分自动衰减在实际调度节奏下永远等于 0,自动降级/QoS 自动恢复/风险回落整体失效,触发过风控的实例被永久限速、永久停留高分区。
  - 证据:调度器每 5 分钟跑一次,每次评估把 lastEvaluatedAt 刷成 now。衰减 elapsedHours=5/60≈0.083,decay=Math.floor(elapsedHours*scoreDecayPerHour);默认 scoreDecayPerHour=3,Math.floor(0.083*3)=Math.floor(0.25)=0。只要衰减率≤11,decay 恒为 0。无新触发时 nextScore=previousScore,分数冻结;QoS 恢复条件 nextScore<=recoverScore 永不满足。
  - 影响:一次瞬时流量/CPU 峰值把分数抬到限速档后,用户带宽被永久压到 QoS 档(如 10Mbit)且可能长期限单,只能靠管理员手工 release——对线上付费 VPS 是持续性误伤。
  - 修复建议:衰减应基于自上次"有效变化/触发"的累计时长而非每轮重置的 lastEvaluatedAt,或改为按无触发次数累积扣分。

- [M09-02] P2 | 置信度 中 | server/src/services/user-order-restrictions.ts:16-41、68-70 ; server/src/routes/instances.ts:1256
  - 问题:下单限制只在"创建实例"一条路径强制执行;restrictedPurchase/restrictedRenew 标志被写入但从未被读取,被限单用户仍可通过交易所购买/受让获得可用实例,绕过限制。
  - 证据:assertUserCanCreateInstance 仅出现在 instances.ts:1256(getActiveOrderRestriction 只筛 restrictedCreate:true);restrictUserOrdersForRisk 设 restrictedPurchase:true 但全 server 无读取点;交易所购买与转让均未调用限制校验。
  - 影响:被标记高风险账号无法自建实例,却可在二级市场买入或接收转让获得新实例,削弱风控惩戒。
  - 修复建议:在交易所购买与实例受让入口同样接入下单限制校验,让 restrictedPurchase/restrictedRenew 真正生效或从模型移除。

- [M09-03] P2 | 置信度 中 | server/src/services/resource-risk.ts:429-483 与 597-630(对比人工路径 1000、979)
  - 问题:evaluateInstanceRisk"先读后写"且中间夹带耗时 Incus 远程调用,对 InstanceRiskState 无并发锁或乐观版本校验,与人工处置/管理员手动 /evaluate 存在 TOCTOU 竞态。
  - 影响:并发窗口内人工封禁/限速可能被自动评估覆盖,出现"状态显示正常但实例实际已停机"的不一致,甚至自动把人工封禁的实例恢复限速。
  - 修复建议:对单实例评估加 PG advisory lock(按 instanceId),或 upsert 引入版本/状态条件,人工态与自动态互斥更新。

- [M09-04] P2 | 置信度 中 | server/src/app.ts:136 ; server/src/lib/geoip.ts(消费方 security.ts detectNewLoginLocation、oauth.ts:540)
  - 问题:request.ip 在 trustProxy 且生产设 TRUST_PROXY=true 时信任整条代理链,取 X-Forwarded-For 最左值——完全客户端可控,可伪造。geoip 判定与"新登录地"告警据此进行,失败时 fail-open。
  - 影响:攻击者可伪造 XFF 让"异地登录"告警失效或指向任意国家;同一 request.ip 还被支付回调 IP 白名单复用,风险外溢。M09 内以告警型为主,非直接拦截失效。
  - 修复建议:改用固定跳数/受信代理网段的 XFF 解析(仅信任 Nginx 出口地址),不 trustProxy:true 全链信任。

- [M09-05] P3 | 置信度 中 | server/src/services/user-order-restrictions.ts:57-73(schema:2191-2216 无 @@unique(userId))
  - 问题:restrictUserOrdersForRisk 是"查存在→无则创建"非原子操作,且 UserOrderRestriction 无按用户唯一约束,并发下给同一用户创建多条 active 限制。
  - 影响:重复 active 限制不影响拦截正确性,但污染数据、增加人工解除成本(解一条仍受另一条限制)。
  - 修复建议:创建前用 advisory lock/唯一部分索引兜底,或对 (userId,status='active') 建唯一约束。

- [M09-06] P3 | 置信度 中 | server/src/services/resource-risk.ts:425-661(evaluateInstanceRisk 全程无 createLog)
  - 问题:自动风控动作(auto-suspend、auto-QoS 限速、自动限单)只写 InstanceRiskEvent,不落中心审计 Log 表;仅人工动作调 createLog。
  - 影响:自动停机/限速这类高影响动作不进入统一审计流水与 CSV 导出,审计完整性盲区。
  - 修复建议:自动处置动作也写入中心 Log(actor 记为系统),与人工口径一致。

- [M09-07] P3 | 置信度 低 | server/src/services/resource-risk.ts:333-375、618-623
  - 问题:applyQosLimit 先把 instance.limitsIngress/Egress 改成限速值,再在外层 upsert 落状态,两步非原子。若两步之间进程崩溃且无既有状态行,下次评估 originalIngress 取到已被限速的值,原始限速丢失。
  - 影响:极端崩溃时机下 originalIngress 被污染为限速值,恢复只会"恢复"到限速档,永久限速无法还原。
  - 修复建议:把限速的 Incus 变更与 originalIngress 落库放入同一事务,或先持久化 original 再改限速。
