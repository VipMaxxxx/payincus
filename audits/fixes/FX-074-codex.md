已按 FX-074 完成：在 [hosts.ts](C:\Users\Administrator\Desktop\payinces\server\src\db\hosts.ts) 新增事务内原子 `incrementHostResourceUsage`，CPU、内存、磁盘三个维度均使用 Prisma `increment`；[batch-config.ts](C:\Users\Administrator\Desktop\payinces\server\src\routes\batch-config.ts) 改为直接提交累计 delta，彻底移除 `host.*_used + delta` 绝对覆盖。两处守卫已追加并通过，server type-check 通过。未改 schema/package，未触碰现有 `restoreTaskWorker` 并行改动，未 commit/push/发版。工作区中的 package 和 `restoreTaskWorker` 修改为已有无关改动。

验证结果：`test:host-resource-atomic-guards` ✅、`test:batch-config-route-guards` ✅、server `type-check` ✅。
