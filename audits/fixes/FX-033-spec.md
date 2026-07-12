# FX-033 规格：apply-aff 允许事后绑任意他人码永久续费95折(E10 / BF-3-04)

## owner 裁决(BEHAVIOR.md E10)
砍掉"事后绑他人码"——或仅允许绑**自己生成的码**。采用后者(更稳,保留端点但收紧)。

## 根因
POST /:id/apply-aff(server/src/routes/instance-billing.ts:460-572)允许任何实例主给已有实例事后绑定**任意(非自己)有效码**,
永久享受续费 95 折、无消费门槛 → 等于全站通用折扣、返利变成给随机码主的固定支出。

## 修法（只改 server/src/routes/instance-billing.ts 的 apply-aff 端点)
1. 先只读该端点,弄清它如何取码、如何校验(validateAffCode)、如何 createAffBinding。
2. 收紧:只允许绑定**当前用户自己生成的码**(affCode.userId === request.user.id)。若绑的码不属于当前用户 → 返回明确 403/400 拒绝(用现有 apiError/ErrorCode)。
   - 注意:原本 validateAffCode 里有"不能用自己的码"(下单场景防自返利)的相反规则——apply-aff 是"事后给自己实例绑自己的码享续费折扣",语义不同;本条要求的是"只能绑自己的码"。请确认这两处语义不冲突:下单用别人码(得返利给别人)、apply-aff 绑自己码(自己的实例续费打折,返利记给自己或按现有绑定佣金逻辑)。若绑自己码会触发"自返利"问题,则改为**直接停用该端点**(返回 403"该功能已下线")——二选一,以不产生自返利套利为准,并在交付说明你选了哪种及理由。
3. 不改折扣率/返利率数值。

## 加守卫
在现有 server/scripts/test-instance-billing-route-id-guards.ts 追加断言:apply-aff 端点限制为仅绑自己的码(或已停用)。不改 package.json。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:instance-billing-route-id-guards 通过;test:aff-review-ui-guards 通过。

## 交付
一段话:选了"限自己码"还是"停用端点"及理由、如何防自返利、守卫结果。不要 commit。
