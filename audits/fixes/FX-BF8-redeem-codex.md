已完成，未 commit/push/发版，未改迁移、schema 列或 gift-cards。

- BF-8-14：在 [redeem-codes.ts](C:/Users/Administrator/Desktop/payinces/server/src/db/redeem-codes.ts:468) 的单删/批删 helper 内，使用事务与 advisory lock，在物理删除前查询 `RedeemCodeUsage`。存在记录则置 `enabled=false` 并返回明确 `409 REDEEM_CODE_USED`；无记录才删除。
- BF-8-13：创建及生命周期发码类型收紧为 `c/r/d/t`，DB 创建入口也防御性拒绝 `p`；移除 [checkin.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/checkin.ts:15) 中 p 名称、单位及不可达分支。Prisma 的 `p` 枚举仅标记 deprecated，未迁移。
- 守卫已补充已用 h 码禁止物理删除、批删保护及所有 p 创建/核销入口拒绝。

验证全部通过：

- `pnpm --filter server type-check`
- `test:redeem-code-management-guards`
- `test:user-lifecycle-guards`
- `test:system-redeem-consistency`
- `git diff --check`
