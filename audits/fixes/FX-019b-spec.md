# FX-019b 规格：升级/改价按名义原价算剩余价值、不封顶实付(E9 另一半 / BF-1-03)

## owner 裁决(BEHAVIOR.md E9)
升级/改价剩余价值改按实付并封顶实付总额。

## 根因
销毁退款的剩余价值按**实付账单记录**时间比例算并封顶实付(安全,getInstanceRefundableAmount 口径);
而升级差价、管理员改价的剩余价值按 **instance.billingPrice(名义原价)× 剩余天数** 算,**不封顶实付**(billing-calc.ts:231-275、billing-operations.ts:420-431)。
秒杀/优惠码买家 instance.billingPrice 存的是原价(instances.ts:1859)→ 秒杀 ¥10 买名义 ¥100 的方案,升级时按 ¥100 折算剩余价值抵扣新方案费用,可能过度抵扣、少收甚至倒贴。

## 修法（改 server/src/lib/billing-calc.ts 升级剩余价值计算 + server/src/db/billing-operations.ts performPlanChange + server/src/routes/admin-billing.ts 改价;不碰 package.json)
1. 先只读:①销毁退款用的 getInstanceRefundableAmount(实付−已退、时间比例、封顶实付)在哪、怎么算;②升级/改价现在怎么算剩余价值(billing-calc.ts:231-275 名义价×剩余天数)。
2. 把升级/改价的"剩余价值"改为与**销毁退款一致的实付口径**:按该实例**实付账单**(而非 instance.billingPrice 名义价)的时间比例算,并**封顶不超过实付总额**(减已用)。优先直接复用 getInstanceRefundableAmount 或其口径,避免重造第二套。
3. 升级差价 = 新方案费用 − (按实付算的剩余价值);差价>0 扣款、<0 退款逻辑不变。管理端改价同口径。
4. 前端展示的"剩余价值/差价"若来自后端计算则自动一致;不在本条改前端。

## 加守卫
在现有 server/scripts/test-instance-billing-route-id-guards.ts 或 billing 相关守卫追加断言:升级/改价剩余价值按实付且封顶实付(不用 instance.billingPrice 名义价)。不改 package.json。

## 不许动
- 不改销毁退款(它已是实付口径);不改升级门槛(<15天)、不改差价扣/退款流程。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:instance-billing-route-id-guards、test:financial-reconciliation-guards、test:admin-billing-route-id-guards 通过。

## 交付
一段话:复用了 getInstanceRefundableAmount 还是其口径、封顶如何做、升级差价与改价两处如何改、守卫结果。不要 commit。
