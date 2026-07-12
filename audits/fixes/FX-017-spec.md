# FX-017 规格：邮箱退款按当前标价、不看实付、无累计上限(E8 / BF-9-07)

## owner 裁决(BEHAVIOR.md E8)
邮箱退款改为按真实实付逐期计算 + "累计退款 ≤ 累计实付"上限(与实例退款一致)。

## 根因
server/src/routes/mail.ts(约 773-790 full 退款、1044-1065、1223-1241 remaining):full 退固定退当前 plan.price(非实付、非历史总额);
remaining 按当前标价×比例;套餐涨价直接抬高老订阅退款额;且无"累计退款≤累计实付"上限(实例退款则有)。

## 修法（只改 server/src/routes/mail.ts 退款计算;必要时 db/mail.ts 取数)
1. 先只读通读:邮箱订阅/续费的**实付流水**存在哪(找 mail 的账单/支付记录表或 balanceLog 关联,类似实例的 InstanceBillingRecord)。参考实例退款 getInstanceRefundableAmount(消费−已退、封顶实付)的做法。
2. full 退款金额改为基于**真实实付记录**(该订阅历史各期实付合计,减已退),而非当前 plan.price;remaining(剩余价值)按**实付**的时间比例算,而非当前标价×比例。
3. 加"累计退款 ≤ 累计实付"上限:任何退款不得使该订阅累计退款超过其累计实付。
4. 若邮箱当前没有可靠的逐期实付流水表,则以"能取到的最接近实付的记录"为准,并在交付说明数据来源与口径;绝不用会随涨价变动的 plan.price 当退款基数。

## 加守卫
在现有 server/scripts/test-mail-plan-financial-guards.ts 追加断言:退款基于实付/历史流水且有累计退款上限,不用当前 plan.price 作 full 退基数。不改 package.json。

## 不许动
- 不改续费/购买定价、不改 mail 续费月数校验(FX-018 已改,勿动)。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:mail-plan-financial-guards、test:mail-subscription-cancel-guards 通过。

## 交付
一段话:实付流水来源、full/remaining/上限如何算、守卫结果。不要 commit。
