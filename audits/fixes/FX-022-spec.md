# FX-022 规格：自动续费余额预检用原价、实际扣折后价致误判失败(P3 / M04-10 / D-...)

## 根因
server/src/services/billing-scheduler.ts:162-195 自动续费预检 `if (balance < renewInfo.amount)` 用**原价** calculateRenewBilling().amount 判"余额不足";
而实际扣款 performRenewal 用 **AFF 折后价**(calculateDiscountedPrice)。
→ 绑了优惠码、余额介于"折后价"与"原价"之间的用户,自动续费被误判失败(计 1 次失败,3 次后关自动续费),实例可能因此到期封停——其实付得起。

## 修法（只改 server/src/services/billing-scheduler.ts 自动续费预检段;不碰 package.json)
1. 先只读该段,弄清 renewInfo 从哪来、折后价怎么算(performRenewal 里 calculateDiscountedPrice / affBinding discountRate)。
2. 让**预检金额与实际扣款口径一致**:预检改用折后价(把该实例 affBinding 的折扣应用到 renewInfo.amount 后再比 balance);或**直接去掉预检**、完全依赖 performRenewal 的条件扣款(其内部已有余额不足处理)——二选一,以"绑码用户不再被误判失败"为准。推荐:预检用折后价(保留"余额确实不足时不必发起扣款事务"的优化)。
3. 不改扣款逻辑本身、不改失败计数/关自动续费的阈值。

## 加守卫
在现有 server/scripts/test-billing-query-guards.ts 或最贴近的 billing/scheduler 守卫追加断言:自动续费预检使用折后价(与实际扣款口径一致)。不改 package.json。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:billing-query-guards、test:billing-expiry-race-guards 通过。

## 交付
一段话:选了"预检用折后价"还是"去预检"及理由、折扣如何取、守卫结果。不要 commit。
