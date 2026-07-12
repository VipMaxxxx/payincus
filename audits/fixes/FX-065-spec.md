# FX-065 规格：trafficResetPrice 单位(分/元)易误配(G-A / BF-6-12)

## owner 裁决
BF-6-12:重置价格**以"元"存储**(统一后台提示)。

## 现状
`schema.prisma:1327` `trafficResetPrice Decimal @db.Decimal(10,2)` 注释"(分)",代码按**分**处理;但 Decimal(10,2) 天然是"元"(X.XX),管理员填 5.00 以为 5 元、实际被当 5 分(0.05元)。→ 定价严重偏低。

## 关键判断(数据安全)
管理员在表单填的值(如 5.00)本意是 5 元。改代码"按元处理"后,存量 5.00 → 正确的 5 元,**对齐管理员意图,无需强制数据迁移**。仅极少数"明知 bug 故意按分填"的值会变化(可忽略;字段默认 0)。交付里说明这一点。

## 修法(只改 消费 trafficResetPrice 的后端代码(db/traffic.ts 或 routes)+ schema 注释 + 管理端表单内联提示 + 守卫;**不碰 client/src/locales/*.ts**(并行 FX-064 在改 i18n 词典);不改 schema 列/类型/不迁移)
1. 先只读:trafficResetPrice 在哪被消费(用户自助重置扣费点)、当前是否 ×100 或按分算、管理端设置该价格的表单。
2. **按元处理**:扣费逻辑把 trafficResetPrice 当**元**(与用户余额/其它金额口径一致,勿再 ×100 当分);schema.prisma 该字段**注释**改"(元)"(仅注释,不改列/类型/不迁移)。
3. **后台输入提示**:管理端设置该价格的表单加**内联提示"单位:元"**(用模板内联文本或已有字段 label,**不新增 client/src/locales/*.ts 的 i18n key**,避免与并行 FX-064 冲突;若必须 i18n 可复用现有 key)。
4. 与用户余额扣费口径一致(元),不破坏 changeBalance 语义。

## 加守卫
`test:system-config-value-guards` 或流量重置守卫追加:trafficResetPrice 按元处理、不再 ×100 当分。不改 package.json。

## 不许动
不碰 client/src/locales/*.ts(并行 FX-064)。不改 schema 列/类型、不迁移。不 commit。

## 验收
type-check 通过;相关守卫 + `test:traffic-reset-locks` 通过。交付一段话:消费点怎么改成元、注释/提示、存量数据影响说明、守卫结果。
