# FX-054-rest 规格：付费重置不扣用户级 + 加油包对实例级限额无效(E23 / BF-6-11 / BF-6-10)

## owner 裁决(BEHAVIOR.md E23)
**都做**——① 付费流量重置**同时扣减用户级已用量**;② 流量加油包**作用于实例级限额**。

## 现状
- BF-6-11:付费重置(扣 trafficResetPrice)只清实例 `monthlyTrafficUsed`,不清用户级已用量/当日 `dailyTraffic`;设了用户级限额者付费后仍超限被限速(traffic.ts:451-462)。
- BF-6-10:`extraTrafficQuota` 只加进**用户级**有效限额,`extraTrafficUsed` 全程无写入;限速主要看**实例级**→买了加油包常规场景不解限(traffic-scheduler.ts:130、187;schema.prisma:910-911 字段已存在,**勿改 schema**)。

## 修法(只改 db/traffic.ts + routes/traffic.ts + services/traffic-scheduler.ts + 守卫;不碰 flash-sales/instances(并行);不改 schema/package)
1. 先只读:付费重置路径、用户级已用量字段(monthlyTrafficUsed/dailyTraffic 用户维度)、实例级限额与限速判定(traffic-scheduler.ts)、extraTrafficQuota/extraTrafficUsed 现有读写。
2. **① 付费重置扣用户级**:付费重置成功时,在 FX-D017 的同一采集锁+事务内,同步扣减/重置该用户的用户级已用量口径(与实例级一致地把本实例这段用量从用户级已用量中扣除或重置),使付费后用户级不再误判超限。保持免费重置行为不变(除非 owner 口径要求)。按"扣减本实例贡献"而非"清零整个用户"来做,避免影响该用户其它实例的用量。
3. **② 加油包作用实例级**:实例级有效限额计算并入 `extraTrafficQuota`(实例级),限速判定用 `getEffectiveLimit(instanceLimit, extraTrafficQuota)`;并正确写入/累加 `extraTrafficUsed`(不再是死字段)。确保买加油包能在实例级解限。
4. 复用既有 `getEffectiveLimit`/`advanceTrafficSnapshot` 等工具,不另造。改动最小。

## 加守卫
`test:traffic-reset-locks`/`test:traffic-route-limit-guards` 追加:付费重置扣用户级已用量、加油包并入实例级有效限额且 extraTrafficUsed 参与判定。不改 package.json。

## 不许动
不碰 flash-sales.ts/instances.ts(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:traffic-reset-locks`、`test:traffic-route-limit-guards`、`test:traffic-collector-status-guard` 通过。交付一段话:用户级扣减口径(扣本实例贡献)、加油包如何并入实例级、守卫结果。
