# FX-019a 规格：管理员延期日价用30天基、与全站31天口径分叉(E9 一部分 / BF-1-01 / D-068)

## owner 裁决(BEHAVIOR.md E9)
延期统一改 31 天基。(E9 的另一半"升级剩余价值按实付封顶"由 FX-019b 单独做,本条只做延期日价口径。)

## 根因
server/src/routes/admin-billing.ts:796-799、2384-2385 管理员"延期"用本地 calculateDailyPrice = (billingPrice/cycle)/30(30 天基),
而全站续费/退款/升级都用 31 天基(server/src/lib/billing-calc.ts:CYCLE_DAYS=31)。且双重 toFixed 放大误差。
→ 同一实例延期 30 天付整月钱只得 30 天、日价比续费高 ~3.3%,口径不一致、用户吃亏。

## 修法（只改 server/src/routes/admin-billing.ts 延期日价计算;不碰 package.json)
1. 先只读 admin-billing.ts:796-799 的本地 calculateDailyPrice 与 billing-calc.ts 的公共日价函数(31 天基,如 calculateDailyPrice/CYCLE_DAYS)。
2. 把延期的日价改用公共 billing-calc 的 31 天基口径(复用公共函数,不再本地 /30);只对最终金额做一次两位小数舍入(去掉双重 toFixed 的中间舍入)。
3. 延期加的时间仍按 days 个自然日(本条只统一"日价口径",不改"加几天"的语义,除非 owner 另有说明——保持 days×24h)。
4. 不改续费/升级/退款(它们已是 31 天基)。

## 加守卫
在现有 server/scripts/test-admin-billing-route-id-guards.ts 追加断言:延期日价复用公共 31 天基口径(不再本地 /30)。不改 package.json。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:admin-billing-route-id-guards、test:financial-reconciliation-guards 通过。

## 交付
一段话:复用了哪个公共日价函数、如何去双重舍入、守卫结果。不要 commit。
