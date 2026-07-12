# FX-067 规格：风控 TOCTOU + 下单限制绕过/非原子 + 自动处置不写审计 + QoS 两步非原子(P2-P3 / D-133,D-134,D-163,D-164,D-175 / M09)

## 五根因
- **D-134**(P2) `resource-risk.ts:429`:风险评估**先读后写夹带 Incus 调用无锁 TOCTOU** → 并发评估互相覆盖/重复处置。修:按 instanceId **advisory lock**(或版本/状态条件更新)串行。
- **D-133**(P2) `user-order-restrictions.ts:16`:下单限制**只在创建实例路径**校验,**交易所购买/受让绕过**。修:交易所购买与受让入口也接入 `user-order-restrictions` 校验。
- **D-163**(P3) `user-order-restrictions.ts:57`:下单限制**非原子、无唯一约束**致重复 active 记录。修:**advisory lock**(userId 维度)串行 check+insert(**优先免 schema**;勿加迁移)。
- **D-164**(P3) `resource-risk.ts:425`:自动风控动作**不写中心审计 Log**。修:自动处置也写中心 Log,actor 记"系统"。
- **D-175**(P3低) `resource-risk.ts:333`:applyQosLimit 两步非原子,崩溃污染 originalIngress。修:限速变更与 original 落库**同事务或先持久化**。

## 前置事实(重要)
**FX-063 已重构 resource-risk.ts 的带宽逻辑**为"只设/清 `currentBandwidthLimit` + 单一仲裁点 computeEffectiveBandwidth,不再捕获/恢复 original"。因此 **D-175 的 originalIngress 捕获问题可能已被 FX-063 消解**——请先读 FX-063 后的现状:若已无 original 捕获,D-175 改为"确保 currentBandwidthLimit 的设置原子/先持久化后再落 Incus";若仍有残留 original 逻辑则按原方向修。**勿回退 FX-063**。

## 修法(只改 services/resource-risk.ts + services/user-order-restrictions.ts + 守卫;不改 schema/package;不碰 resource-pool(并行 FX-073))
1. 先只读:resource-risk 评估/处置流程(FX-063 后)、user-order-restrictions 的 check/create、交易所购买与受让入口在哪、中心审计 Log 写法(actor 字段)。
2. **D-134**:风险评估读→(Incus 调用)→写 全程按 instanceId **advisoryTransactionLock** 串行,或写库用版本/状态条件更新,消除 TOCTOU。
3. **D-133**:交易所购买、受让两入口调用同一 `user-order-restrictions` 校验,受限用户被拒。
4. **D-163**:下单限制 create 用 userId advisory lock + 同事务 check(是否已有 active)后 insert,避免重复 active;免 schema。
5. **D-164**:自动风控处置(限速/限单)也写中心审计 Log,actor=系统。
6. **D-175**:见前置事实,按 FX-063 后现状做原子/先持久化。
7. 保留 FX-060/063/066,勿回退。

## 加守卫
`test:resource-risk-guards`/`test:risk-audit-guards` 追加:评估 TOCTOU 加锁、交易所入口接入限制、下单限制原子无重复 active、自动处置写审计、QoS 原子。**注意 resource-risk-guards 存在既有前端表格漂移 FAIL(FX-DISC-09,非你引入),你只需保证新增后端断言通过、不弱化既有断言、不改 .vue**。不改 package.json。

## 不许动
不碰 resource-pool(并行)。不回退 FX-060/063/066。不改 schema/package。不改 ResourceRiskView.vue/守卫既有断言。不 commit。

## 验收
type-check 通过;`test:risk-audit-guards` 通过;`test:resource-risk-guards` 的**后端新增断言**通过(前端表格 FAIL 属 FX-DISC-09 既有,报告里说明)。交付一段话:五点各改法、D-175 是否被 FX-063 消解、守卫结果。
