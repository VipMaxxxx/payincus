已完成诊断和最小修复，未 commit。

逐条 bisect 复合断言的 95 个子条件后，仅第 409 行失败：

- 旧字面：`isRechargeGatewayOrderNoMatch(record.orderNo, pluginResult.orderNo)`
- 新字面：`isRechargeGatewayOrderNoMatch(gatewayOrderNo, pluginResult.orderNo)`

根因是 **(a) 代码漂移**：支付重试机制引入当前有效支付尝试的 `gatewayOrderNo`。实现仍严格拒绝插件返回的订单号不匹配，且比使用基础 `record.orderNo` 更准确，可阻止旧支付链接对应的结果入账。其余 94 条 admin 鉴权、hooks、dispatch、契约、脱敏负向条件及审计断言均为真，安全语义未弱化。

仅修改：[test-plugin-runtime-capabilities-guards.ts](/C:/Users/Administrator/Desktop/payinces/server/scripts/test-plugin-runtime-capabilities-guards.ts:409)

验证全部通过：

- `test:plugin-runtime-capabilities-guards`
- `test:plugin-center-guards`
- `test:plugin-market-guards`
- `pnpm --filter server type-check`
- `git diff --check`
