已完成 BF-10-03 最小改动，未碰 exchange、schema/迁移，也未 commit：

- [hosting.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/hosting.ts:562)：`balance` 默认保持免审即时到账；`usdt` 外部提现创建为 `pending`，申请时扣减托管可用余额。
- 新增管理员 `approve/reject` 接口；均限定 `pending` 条件更新。批准置 `completed`，拒绝按原始 `amount` 全额退回并写补偿日志，重复操作返回 409。
- `/balance` 按实时 `pending` 记录统计待审核金额。
- 更新两组守卫，覆盖分流、实时统计、管理员鉴权、严格 ID、并发幂等和退回一致性。

验证结果：server type-check、`hosting-balance-guards`、`financial-reconciliation-guards` 通过；`admin-hosting-route-id-guards` 的新增提现断言通过，但随后被既有未修改的 `HostingView.vue` 横向滚动布局断言阻断。目标文件 `git diff --check` 通过；定向 ESLint 因仓库没有 ESLint 9 配置无法运行。现有 schema 脏状态属于工作区原改动，本次未修改。
