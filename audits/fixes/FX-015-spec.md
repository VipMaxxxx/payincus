# FX-015 规格：用户销毁托管实例的手续费实际归节点主人而非平台(E19 / BF-10-06)

## owner 裁决(BEHAVIOR.md E19)
用户销毁托管实例产生的手续费应归平台。

## 根因
server/src/routes/instance-destroy.ts:264-318 用户自助销毁:
买家退款 = 剩余价值 R − 手续费 F;回扣节点主人时只扣 **post-fee 金额**(=退款额 R−F)。
于是节点主人净留 = 已消费部分 + 手续费 F(手续费落节点主人口袋),而非平台。

## 目标经济口径(修法核心)
手续费 F 应归平台:对托管实例,回扣节点主人应扣**剩余价值全额 R(pre-fee)**,而非 post-fee 的 R−F。
结果:节点主人被扣 R;买家拿回 R−F;平台净得 F(手续费)。非托管(官方节点)实例不涉及回扣,不受影响。

## 修法（只改 server/src/routes/instance-destroy.ts;不碰 package.json)
1. 先只读通读销毁退款段:定位剩余价值 R(pre-fee,即手续费扣除前的可退价值)、手续费 F、给买家的退款额(R−F)、以及 deductHostingBalance 当前传入的金额。
2. 把 deductHostingBalance 回扣金额从"退款额(R−F)"改为"**剩余价值 R(pre-fee)**"。买家退款额(R−F)不变;仅节点主人回扣口径改为 pre-fee 全额,使手续费差额 F 留在平台。
3. `error` 状态实例免手续费(F=0)的情形:此时 R−F=R,口径本就一致,保持。
4. 与 FX-011(管理员退款回扣,admin-billing.ts)不冲突:那条不涉及销毁手续费。本条仅动 instance-destroy 用户自助销毁。E18(扣不满记欠款)是另一条 FX,本条不实现。

## 加守卫
在现有 server/scripts/test-user-destroy-incus-order.ts 或最贴近的销毁守卫追加断言:托管实例回扣节点主人用 pre-fee 剩余价值(手续费归平台)。不改 package.json。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:user-destroy-incus-order、test:hosting-balance-guards 通过。

## 交付
一段话:R/F/退款额各是哪个变量、回扣金额如何从 R−F 改为 R、守卫结果。不要 commit。
