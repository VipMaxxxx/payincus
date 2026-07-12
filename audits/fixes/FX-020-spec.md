# FX-020 规格：Hosting 冻结期"自然月 vs 精确30天"口径分叉(E22 剩余 / BF-10-05)

## owner 裁决(BEHAVIOR.md E22)
统一计费"月"口径。(退款/剩余价值按实际时间比例已由 FX-017/019b/销毁退款/FX-025 达成;本条只统一 Hosting 收入冻结期。)

## 根因
Hosting 收入冻结到期:业务侧 billing-operations.ts:1313 用 addMonths(now,1)(自然月 28~31 天),管理侧 users.ts:1725 用精确 30*24h;
文案统一称"30天"→ 2 月购买者只冻 28 天、1 月冻 31 天,与"30天"承诺有偏差、两处口径不一致。

## 修法（统一为精确 30 天,与文案一致;改 billing-operations.ts 冻结到期计算;不碰 package.json)
1. 先只读:billing-operations.ts:1313 冻结到期用 addMonths(now,1) 的上下文,以及是否有公共"冻结天数"常量。
2. 把 Hosting 收入冻结到期改为 **now + 精确 30 天**(30*24*60*60*1000,或复用 users.ts 已用的常量/或抽一个公共常量 HOSTING_FREEZE_DAYS=30),与管理侧一致、与"30天"文案一致。
3. 若已有可配的冻结天数配置就复用;没有则用常量 30。不改解冻调度器逻辑(它按 unfreezeAt 判定,只是 unfreezeAt 的计算口径统一)。

## 加守卫
在现有 server/scripts/test-hosting-balance-guards.ts 追加断言:Hosting 冻结到期用精确 30 天(不用 addMonths 自然月)。不改 package.json。

## 不许动
- 不改实例计费"月"=31天(D8 已定保持);不改退款/剩余价值(已按实付时间比例);不改解冻调度。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:hosting-balance-guards 通过。

## 交付
一段话:冻结到期如何改为精确30天、是否抽公共常量、守卫结果。不要 commit。
