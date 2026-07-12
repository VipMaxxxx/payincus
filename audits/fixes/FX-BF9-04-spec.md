# BF-9-04 规格：邮箱订阅"全局一份"vs"每源一份"(G-B 裁决:每邮箱源各一份)

## 裁决
邮箱订阅改**每邮箱源各一份**(非全局仅一份)。

## 现状
前端只阻止同源重复购买、允许换源结算,后端却**禁止用户存在任意第二份订阅**(全局一份)→ 前后端矛盾,用户无法买第二个源。证据:MailView.vue:63-67、476-495、mail.ts:1095-1100。

## 修法(只改 routes/mail.ts(购买唯一性校验 1095-1100)+ 必要 db + 守卫;不碰 transfers(并行);不动 BF-9-01/02/03 自动续费/过期自救 feature 部分;不改 schema/package)
1. 先只读:mail.ts:1095-1100 的"是否已有订阅"校验、订阅与 mailSource 关联、前端 MailView 的同源判断。
2. **改为每源一份**:购买校验从"用户已有任意订阅→拒"改为"用户在**同一 mailSource** 已有 active 订阅→拒;不同源允许各一份"。与前端"每源一份"对齐。
3. 保持退款/续费/计费口径不变;不触碰过期自救/自动续费(波4 feature)逻辑。

## 加守卫
`test:mail-subscription-cancel-guards` 或 mail 相关守卫追加:订阅唯一性按 mailSource 维度(每源一份)。不改 package.json。

## 不许动
不碰 transfers(并行)。不改 BF-9-01/02/03 feature。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:mail-subscription-cancel-guards`、`test:mail-list-query-guards`、`test:mail-plan-financial-guards` 通过。交付一段话:唯一性改为按 mailSource、守卫结果。
