# BF-8-08 规格：礼品卡懒过期致后台可用数/未兑负债虚高(G-C 同意)

## 裁决
后台统计**实时按 expiresAt 排除已到期卡**。

## 现状
过期卡只有被尝试兑换才转 expired;后台 active 数与"未兑余额"只看 status 不看 expiresAt → 虚高。证据:gift-cards.ts(db):324、330、499。

## 修法(只改 server/src/db/gift-cards.ts(+必要 routes)+ 守卫;不改 schema/package;不碰 flash-sales/instances(并行);不碰 GiftCardsView 前端(已恢复))
1. 先只读:gift-cards.ts:324/330/499 的 active 计数与未兑余额聚合、expiresAt 字段、状态枚举。
2. **实时排除过期**:后台"可用数/未兑负债"等统计查询**同时按 `status=active 且 (expiresAt 为空 或 expiresAt>now)`** 过滤;已过 expiresAt 的即使 status 仍是 active 也**不计入**可用/未兑。
3. (可选)不强制把过期卡批量转 expired(懒转仍可保留),只保证**统计口径**实时正确;若顺手能在读时或调度把明显过期的转 expired 且低风险则可,但核心是统计过滤。
4. 兑换路径既有"尝试兑换转 expired"保持。

## 加守卫
`test:gift-card-guards`/`test:gift-card-flow` 追加:后台统计按 expiresAt 实时排除过期卡。不改 package.json。

## 不许动
不碰 flash-sales/instances(并行)。不碰 GiftCardsView 前端。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:gift-card-guards`、`test:gift-card-flow`、`test:financial-reconciliation-guards` 通过。交付一段话:改了哪些统计查询、过滤条件、守卫结果。
