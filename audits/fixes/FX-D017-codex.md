已完成 FX-D017，本次仅编辑 [db/traffic.ts](C:/Users/Administrator/Desktop/payinces/server/src/db/traffic.ts:31) 和 [routes/traffic.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/traffic.ts:378)。免费与付费重置均持有采集实际使用的 `traffic:instance:<id>` PG 分布式锁；付费路径原有 advisory transaction lock 和余额事务保持不变。锁内读取运行实例的 Incus 当前计数器，复用 `advanceTrafficSnapshot` 推进基线，再在同一 Prisma 事务中清零 `monthlyTrafficUsed`，避免旧窗口进入新周期；停止实例沿用最后快照作为当前基线。

验证全部通过：

- `pnpm --filter server type-check`
- `test:traffic-reset-locks`
- `test:traffic-collector-status-guard`
- `test:traffic-route-limit-guards`
- `test:traffic-notification-claim-guards`
- `test:agent-report-state-guards`
- D017 锁、推进顺序与复用机制静态检查
- `git diff --check`

因“两文件限定”，未修改现有守卫源文件；未碰 schema/package、并行文件，未 commit/push/发版。
