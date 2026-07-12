已完成 BF-8-08，未 commit。

- [gift-cards.ts](C:/Users/Administrator/Desktop/payinces/server/src/db/gift-cards.ts:627)：后台 `active` 数量和 `outstandingValue` 聚合统一按 `status = active AND (expiresAt IS NULL OR expiresAt > now)` 实时过滤。
- [test-gift-card-guards.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-gift-card-guards.ts:105)：增加统计口径静态守卫。
- [test-gift-card-flow.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-gift-card-flow.ts:164)：增加懒过期卡不计入可用数和未兑余额的数据库流程验证。

验证全部通过：server type-check、`test:gift-card-guards`、`test:gift-card-flow`、`test:financial-reconciliation-guards`、`git diff --check`。

未修改 routes、schema、package、GiftCardsView、flash-sales 或 instances；这些文件中已有的工作树变更均为本次开始前的并行改动。
