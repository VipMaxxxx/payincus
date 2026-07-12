当前规格与代码事实冲突，不能在“不改 schema”的前提下按指定方案安全实现，因此我没有写入任何文件。

核对结果：

- `schema.prisma:2231` 的 `idempotencyKey @unique` 属于 `ExchangeListing`，不是 `InstanceTask`。
- `InstanceTask` 没有 `idempotencyKey` 字段，历史迁移中也没有对应列或唯一索引。
- `InstanceTaskType` 不包含实例创建任务；普通付费开通当前在 `instances.ts` 的 Prisma 事务内直接创建实例、扣款，事务后异步交付。
- `createInstanceTaskOrConflict` 仅用于 start/stop/rebuild 等已有实例操作，无法承载普通开通门控。
- 秒杀去重实际依赖 `FlashSaleReservation.idempotencyKey`，不能复用于普通订单。

继续需要 owner/规格方二选一：

1. 允许给普通开通增加专用幂等字段/表及 unique 迁移，再按 unique 冲突原子返回既有实例。
2. 保持不改 schema，改用“用户级 advisory transaction lock + 在实例快照持久化幂等键并先查后扣”的串行门控方案；能防同键双扣双建，但不属于“经现有 unique 约束”。

工作树原本已有大量未提交改动，包括 `instances.ts` 和并行修改的 `caddy-client.ts`；我未触碰或覆盖它们，也未 commit。
