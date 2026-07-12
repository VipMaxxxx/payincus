# FX-011 规格：管理员退款不回扣托管节点主人(E5① / BF-10-02 / BF-1-02 / M04-06)

## owner 裁决(BEHAVIOR.md E5①)
管理员退款也应从托管节点主人余额回扣(与用户自助销毁一致)。

## 根因
管理员"删除并退款"(server/src/routes/admin-billing.ts:2755-2809)与"退款"(约 2546-2672)对**托管节点实例**退款时,
不调用 deductHostingBalance 回扣节点主人 → 用户拿回钱、节点主人白拿已发收入、平台承担损失。
而其它三条路径(用户自助销毁 instance-destroy.ts:312-318、节点主人/管理员通用 DELETE instances.ts:4174、整机批删 hosts.ts:3157)都正确回扣。

## 修法（改 server/src/routes/admin-billing.ts;参照现成实现,不碰 package.json)
1. 先只读 instance-destroy.ts:312-318 的回扣写法:deductHostingBalance 的签名、参数(节点主人 userId、金额、实例/备注)、以及"何时该回扣"的判定(实例所在 host 是用户自有/peer 托管节点,而非平台官方节点)——复用同一判定与调用方式。
2. 在 admin-billing.ts 的"删除并退款"退款事务中,对托管节点实例按上述判定调用 deductHostingBalance(金额=实际退给买家的 refundAmount,与自助销毁口径一致),在同一事务内完成。
3. 同理审视"退款"(manual refund)路径:owner 裁决是"管理员退款也回扣",故该路径若也用于托管实例退款,一并加回扣;若该路径不涉及托管实例则说明并跳过。
4. 金额与"扣不满"处理:遵循 instance-destroy 的现有口径(E18 已定"扣不满记欠款"属另一条 FX-014,本条只负责"把回扣调用补上",不在此重复实现 E18)。

## 加守卫
在现有 server/scripts/test-admin-billing-route-id-guards.ts(或最贴近的 admin-billing 守卫)追加断言:删除并退款/退款路径源码中,对托管实例退款包含 deductHostingBalance 调用。不改 package.json。

## 不许动
- 不改 deductHostingBalance 本身、不改 instance-destroy/instances/hosts 的既有回扣。不做大重构。

## 验收
- pnpm --filter server type-check 通过;
- pnpm --filter server test:admin-billing-route-id-guards 通过;
- pnpm --filter server test:financial-reconciliation-guards 通过(确认对账口径未破)。

## 交付
一段话:复用了 instance-destroy 的哪套判定/调用、加在哪两个退款路径、守卫结果。不要 commit。
