# FX-D017 规格：月流量重置只清累计不刷计数器快照,重置窗口重复计入(P1 / D-017 / M13-04)

## 根因
`server/src/db/traffic.ts:600` + `server/src/routes/traffic.ts:451`:月流量重置只把累计用量清零,**不刷新原始计数器快照(基线)**。下次采样的增量 = 当前计数器 − 重置前的旧基线,把"重置前到重置时"整个窗口计入**新周期**;付费重置还**未持采集锁**,并发重置误计窗口更大。

## 前置事实
FX-D014 已落地:`server/src/services/traffic-utils.ts` 有 `advanceTrafficSnapshot`(原子推进快照/带采样时间)。本修**必须复用**同一快照机制重建基线,勿另起一套。

## 修法(只改 db/traffic.ts + routes/traffic.ts;可只读复用 traffic-utils.ts 的 advanceTrafficSnapshot;不碰 ip-addresses/ipv6-subnets(并行)、不改 schema/package)
1. 先只读:重置逻辑(免费月度重置 + 付费重置)、采集锁(PG advisory lock)如何加、快照如何存、advanceTrafficSnapshot 签名。
2. **同一采集锁内做重置**:重置(免费/付费)必须在与采集相同的 advisory lock 保护下执行,避免与正在跑的采集/上报竞态。
3. **先重建基线,再清零周期用量**:
   - 重置时把该实例快照基线推进到"当前计数器"(即让下个采样窗口的增量从重置点算起,不把旧窗口计入新周期);用 advanceTrafficSnapshot 或等价原子写,保证不回退。
   - 然后原子清零本周期累计用量(rx/tx 周期字段)。
   - 顺序与原子性:重建基线与清零应在同一事务/锁内,避免中间态被采集看到导致漏计或重复。
4. 不改变"计费口径/双向计费"(E7);只修重置的基线与锁。

## 加守卫
在流量重置相关现有守卫(如 traffic-reset-locks)追加:重置持采集锁、重置刷新基线不把旧窗口计入新周期。不改 package.json。

## 不许动
不碰 ip-addresses.ts/ipv6-subnets.ts(并行)。不改 schema/package。不 commit。

## 验收
pnpm --filter server type-check 通过;`test:traffic-reset-locks` 及相关流量守卫通过。交付一段话:锁怎么持、基线怎么重建(是否复用 advanceTrafficSnapshot)、清零原子性、守卫结果。
