# FX-021 规格：订单中心退款登记不校验状态、上限用名义额(D8 / BF-2-09 / BF-2-10)

## owner 裁决(BEHAVIOR.md D8"按建议")
退款上限改为实际到账 actualAmount;仅 completed(且已入账)的充值可登记退款。

## 根因
server/src/routes/orders.ts:697-716 订单中心对 recharge 发起退款审批时:
- 不校验充值订单是否 completed/已入账 → 可对 pending/failed/cancelled 登记退款,审批通过就加余额(BF-2-10);
- 退款上限用名义 order.amount 而非实际到账 actualAmount → 扣费渠道用户实收 amount−fee 却可登记退 amount(BF-2-09)。

## 修法（只改 server/src/routes/orders.ts 退款登记段;不碰 package.json)
1. 先只读通读该退款登记逻辑,弄清 recharge 订单的 status 与 actualAmount 字段。
2. 校验充值订单状态:仅当 recharge 订单 status ∈ {completed, refunded}(即已入账)才允许登记退款;pending/failed/cancelled → 返回明确 400/409 拒绝。
3. 退款上限改用**实际到账额**:refundAmount ≤ (order.actualAmount ?? order.amount)(扣费渠道用 actualAmount,历史无 actualAmount 的回退 amount)。原来用 order.amount 的上限校验改为此。
4. 账单类退款(instance_billing 来源)不在本条范围,保持不变。

## 加守卫
在现有 server/scripts/test-order-center-guards.ts 或 order-payment-operations-guards 追加断言:充值退款登记校验 completed 状态 + 上限用 actualAmount。
注:test:order-center-guards 在基线上**本就红**(FX-DISC-07,与本条无关);顺手看一眼它红在哪——若是简单断言漂移且你的改动可一并修绿就修,否则**不要强行改**、在交付里说明它红的原因(供后续单独修),不因它红而误判本条失败。不改 package.json。

## 验收
- pnpm --filter server type-check 通过;
- pnpm --filter server test:order-payment-operations-guards 通过;
- test:order-center-guards 若基线本就红则说明原因(不作为本条失败依据),若你修绿了更好。

## 交付
一段话:状态校验、actualAmount 上限、order-center-guards 红因诊断(是否顺手修绿)、守卫结果。不要 commit。
