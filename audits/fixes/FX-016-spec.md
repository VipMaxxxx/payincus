# FX-016 规格：管理员手动补发托管余额计入历史收入并抬高托管 VIP(E20 / BF-10-08)

## owner 裁决(BEHAVIOR.md E20)
管理员手动补发的余额不计入托管累计收入、不影响 VIP。

## 根因
users.ts:1697-1706 管理员手动补发 available 托管余额时写 hostingBalanceLog type:'income';
totalIncome / 托管 VIP 等级(hosting.ts:822-829)按 ∑(type='income')统计 → 行政补偿抬高机主"累计收入"和托管 VIP。

## 修法（改 server/src/routes/users.ts + 必要时 hosting.ts 聚合;不碰 package.json、尽量不改 schema)
1. 先只读:hostingBalanceLog 的 type 枚举有哪些(income/deduction/withdraw/...)?管理员补发目前用 income。
2. 让管理员手动补发**不计入经营收入/VIP**,二选一(优先不改 schema 的方案):
   - 优先:若枚举里已有中性类型(如 'admin_adjust' 或类似),管理员补发改用该类型;
   - 否则:给管理员补发的日志打可辨识标记(如固定 remark 前缀 '管理员调整-'),并在 totalIncome / VIP 的收入聚合(hosting.ts:822-829 及相关)里**排除**该标记的记录(WHERE remark NOT startsWith / type 过滤)。保证"累计收入""VIP 判级"只统计真实经营收入。
   - 若非改 schema 不可(枚举没有中性类型且无法用 remark 排除),**不要擅自迁移**——改用 remark 排除法;并在交付说明。
3. 保证补发仍正确增加机主 available 余额(可用余额不变逻辑),只是不计入收入统计口径。

## 加守卫
在现有 server/scripts/test-hosting-balance-guards.ts 追加断言:管理员手动补发不计入 totalIncome/VIP 收入聚合(用中性类型或被 remark 排除)。不改 package.json。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:hosting-balance-guards、test:vip-level-rules-ui-guards 通过。

## 交付
一段话:选了中性类型还是 remark 排除、聚合处如何改、守卫结果。不要 commit。
