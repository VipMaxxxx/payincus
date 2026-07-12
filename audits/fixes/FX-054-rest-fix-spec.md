# FX-054-rest 打回修正:加油包整合破坏 FX-067 守卫结构(不放宽守卫)

## 问题(我方独立复验)
`test:traffic-notification-claim-guards` **失败**:断言 "traffic scheduler must warn at the instance 80% threshold only after claiming its warning state"(见 server/scripts/test-traffic-notification-claim-guards.ts:98-107)。
根因:你把 traffic-scheduler.ts 实例级预警/限速判定里的变量 **`instanceLimit` 改名为 `instanceEffectiveLimit`**,而该守卫**逐字**要求:
- `const instanceWarning = isWarningThreshold(instance.monthlyTrafficUsed, instanceLimit)`
- 传参 `instanceLimit!`
守卫钉的是**结构不变量**(先原子抢占 NORMAL→WARNING 再发预警、阈值用实例限额变量),**并不禁止加油包**。

## 修法(最小、只改 server/src/services/traffic-scheduler.ts;不动守卫;不碰 instances.ts(并行 FX-040)/schema/package)
1. 把实例级预警**与**限速/恢复路径中新引入的 `instanceEffectiveLimit` **改回变量名 `instanceLimit`**,但其值保持 = `getEffectiveLimit(instance.monthlyTrafficLimit, userQuota.extraTrafficQuota)`(**加油包整合保留**)。即:`const instanceLimit = getEffectiveLimit(instance.monthlyTrafficLimit, userQuota.extraTrafficQuota)`,后续 `isWarningThreshold(instance.monthlyTrafficUsed, instanceLimit)`、`isOverLimit(instance.monthlyTrafficUsed, instanceLimit)`、`sendTrafficWarningNotification(..., instanceLimit!, ...)` 全用 `instanceLimit`。
2. 复核 `markInstanceTrafficWarningIfNeeded(...)` 函数体**逐字**满足守卫 32-36:含 `prisma.instance.updateMany`、`status: { not: 'deleted' }`、`trafficStatus: 'NORMAL'`(where)、`data: { trafficStatus: 'WARNING' }`、`return result.count > 0`。缺则补齐。
3. 不改用户级扣减逻辑(db/traffic.ts / routes/traffic.ts 已完成部分保持不动)。

## 验收
`pnpm --filter server test:traffic-notification-claim-guards` 通过;`test:traffic-route-limit-guards`、`test:traffic-reset-locks`、`test:traffic-collector-status-guard` 仍通过。**注意**:全项目 type-check 目前因并行 FX-040 改 instances.ts 处于半成品,可忽略 instances.ts 的报错,但你改的 traffic-scheduler.ts 本身须无类型错误。交付一段话:改了哪些变量、守卫结果。不 commit。
