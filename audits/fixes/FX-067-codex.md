已完成允许范围内的四项修复，但 D-133 受让入口存在明确的文件范围冲突，暂未越界接线。

- D-134：风险评估按 `instanceId` 使用事务 advisory lock，串行读取、决策、自动暂停及状态写入。
- D-163：限单按 `userId` 加事务 advisory lock，在同一事务内检查任意 active 记录再插入，避免重复 active。
- D-164：自动限速、暂停、限单写入中心 `Log`，`userId=null` 表示系统 actor。
- D-175：确认已被 FX-063 消解，无 original 带宽捕获；现在事务提交 `currentBandwidthLimit` 后才调用统一带宽仲裁点。
- D-133：交易所购买当前已有 active restriction 检查，并新增了统一的购买/受让检查能力；但受让入口位于 `server/src/routes/transfers.ts`，无法仅修改两个指定 service 完成接线。

改动文件仅为：

- [resource-risk.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/resource-risk.ts)
- [user-order-restrictions.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/user-order-restrictions.ts)
- [test-resource-risk-guards.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-resource-risk-guards.ts)
- [test-risk-audit-guards.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-risk-audit-guards.ts)

验证：

- server type-check：通过
- `test:risk-audit-guards`：通过
- `test:resource-risk-guards`：新增后端断言通过，随后在第 270 行既有前端表格断言失败，属于 FX-DISC-09
- 未修改 schema、package、resource-pool、`ResourceRiskView.vue`
- 未 commit/push/发布

要完整关闭 D-133，需要允许我最小修改 `server/src/routes/transfers.ts`，将受让检查接到 `/:id/accept`，并补对应守卫。
