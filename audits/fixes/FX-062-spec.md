# FX-062 规格：流量重置/日聚合时区未固定(G-A / BF-6-04)

## owner 裁决
BF-6-04:重置/日聚合**固定 Asia/Shanghai**。

## 根因
`traffic-scheduler.ts:667-694`(重置调度)+ `db/traffic.ts`(日聚合 normalizedDate 225/266、月初 654 用 `getFullYear/getMonth/getDate`)全走**服务器本地时区**;systemd/cron 未固定 TZ → UTC 服务器上"月初00:05"实为北京08:05,日/月边界错位。

## 修法(只改 db/traffic.ts + services/traffic-scheduler.ts + 守卫;不改 schema/package;不碰 instances(并行 FX-044))
1. 先只读:所有用本地 TZ 算日/月边界的点(daily-traffic 归一化日期、月初、重置调度触发时刻、resetDay 判定)。
2. **统一按 Asia/Shanghai(UTC+8,无 DST)计算日/月边界**:
   - 加一个共享 helper(如 `startOfDayShanghai(date)`/`startOfMonthShanghai(date)`/`shanghaiDateParts(date)`),用**固定 +08:00 偏移**(Asia/Shanghai 无夏令时,固定偏移即正确;或用 `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'})` 取年月日)。
   - daily-traffic 归一化日期、月初计算、重置调度的"当天/当月"判定、resetDay 比较,全部改用该 helper,保证无论服务器 TZ 如何,边界都按北京时间。
   - 存库的 date 字段口径保持一致(避免混用本地/UTC 导致重复行)。
3. 不改流量计费口径/重置金额;只固定时区。与 FX-D017/FX-054-rest 的重置逻辑协同,勿回退。

## 加守卫
`test:traffic-reset-locks` 追加:日/月边界按 Asia/Shanghai 固定(不裸用服务器本地 getFullYear/getMonth 算业务边界)。不改 package.json。

## 不许动
不碰 instances(并行)。不回退 FX-D017/FX-054-rest。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:traffic-reset-locks`、`test:traffic-route-limit-guards`、`test:traffic-collector-status-guard` 通过。交付一段话:helper 怎么实现(固定偏移/Intl)、改了哪些边界点、守卫结果。
