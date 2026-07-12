# FX-018 规格：年付邮箱套餐可绕前端按"年价÷12"单月续费(E21 / BF-9-05)

## owner 裁决(BEHAVIOR.md E21)
年付套餐必须只允许 12 个月整数倍续费。

## 根因
server/src/routes/mail.ts(约 291-296、1223-1228)续费接受 1–12 任意月数,按年度月均价收费;
若年价含折扣,用户可只续 1 月享年度优惠月价,破坏价格梯度。

## 修法（只改 server/src/routes/mail.ts 续费入口;不碰 package.json)
1. 先只读通读 mail.ts 续费相关(291-296 报价、1223-1228 结算),弄清套餐"计费周期/是否年付"如何判定(找 plan 的 billingCycle / period / 年付标识字段)。
2. 对**年付类套餐**(billingCycle=12 或等价年付),续费 months 必须是 **12 的整数倍**(1年=12月、2年=24月…);非整数倍 → 返回明确的 400 校验错误(用现有 apiError/ErrorCode 体系,文案如"年付套餐只能按年续费")。月付类套餐维持现状。
3. 若存在其它周期(季付/半年),按同样原则:续费月数必须是该套餐周期的整数倍(季付=3的倍数、半年=6的倍数)。以套餐自身 billingCycle 为基准做整除校验最通用。
4. 前后端一致:后端强制,前端若也有月数选择器不在本条范围(前端调整归后续)。

## 加守卫
在现有 server/scripts/test-mail-renewal-month-guards.ts 追加断言:年付/多月套餐续费月数须为套餐周期整数倍,非整数倍被拒。不改 package.json。

## 不许动
- 不改月付续费、不改报价公式本身(仅加月数合法性校验)。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:mail-renewal-month-guards 通过;test:mail-plan-financial-guards 通过。

## 交付
一段话:年付判定字段、整除校验实现、守卫结果。不要 commit。
