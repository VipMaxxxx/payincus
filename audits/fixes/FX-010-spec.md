# FX-010 规格：充值退款方向应为"余额收回(扣减)"(A3 / BF-2-08 / owner 裁决)

## owner 裁决(BEHAVIOR.md A3)
充值退款 = 余额收回(扣减);实例退款 = 加到余额(现状已正确)。
现状 bug:订单中心退款审批 approveBalanceAdjustmentRequest 对所有 requestType='refund' 一律 changeBalanceInTransaction(+amount) 加余额;
对"充值来源"的退款(sourceType='recharge')也加余额 → 若同时线下原路退真钱,用户双份补偿。

## 关键事实(已核对)
- BalanceAdjustmentRequest 有 sourceType 字段('recharge' | 'instance_billing' | null),订单中心登记退款时按订单类型写入(orders.ts)。
- changeBalanceInTransaction 已有防负:扣款(amount<0)且结果<0 时抛 '余额不足'(balance.ts:229-231 + updateMany gte 原子条件)。
- 同文件 getUsersTotalConsumeMap 是 D-176 已修口径(净消费),**本次绝不改动它**。

## 修法（只改 server/src/db/balance.ts 的 approveBalanceAdjustmentRequest + 更新对应守卫）
1. 在 approveBalanceAdjustmentRequest 里判定 isRechargeRefund = (request.requestType === 'refund' && request.sourceType === 'recharge')。
2. 应用余额变动时:
   - isRechargeRefund → **扣减**:type = 'admin_adjust'(收回性质),amount = -Math.abs(Number(request.amount)),remark 里注明"充值退款收回余额"(在原 remark 基础上补一句即可)。
   - 其它(instance_billing 退款 / 无 sourceType 的退款 / 非退款调账)→ **保持现状不变**(refund 加余额 / admin_adjust 原逻辑)。
3. 余额不足:依赖 changeBalanceInTransaction 现有 '余额不足' 抛错——recharge 退款且用户已花光时,审批事务回滚、向管理员返回清晰错误(保持现有错误传播即可;若上层 catch 后消息不清晰,可在 approve 处捕获 '余额不足' 重述为"用户余额不足以收回充值,需人工处理",但不改变抛出=拒绝的行为)。**不允许余额转负**(维持非负不变量)。
4. 不改 orders.ts、不改 changeBalanceInTransaction 的防负逻辑、不改 getUsersTotalConsumeMap。

## 加/更新守卫
更新 server/scripts/test-balance-adjustment-approval-guards.ts:追加断言——approveBalanceAdjustmentRequest 源码中对 sourceType==='recharge' 的 refund 走负数扣减(含 isRechargeRefund 判定 + 负 amount + admin_adjust),而非无条件加余额。保持原有断言不变。

## 验收
- pnpm --filter server type-check 通过;
- pnpm --filter server test:balance-adjustment-approval-guards 通过;
- pnpm --filter server test:balance-change-amount-guard、test:recharge-accounting-guards 通过(确认未误伤会计口径)。

## 交付
一段话:isRechargeRefund 判定、扣减实现、余额不足处理、守卫结果。不要 commit。
