# FX-031b 规格：交易所平台抽成未计入官方收入台账(E24 一部分 / BF-7-09)

## owner 裁决(BEHAVIOR.md E24)
交易所抽成计入官方收入台账。(E24 另一半"退款对买家持有期消耗做补偿/计入卖家可保留款"=FX-031a,较复杂需设计,本条只做抽成入账。)

## 根因
交易所平台抽成不落 instanceBillingRecord,只在 exchangeWalletLog 以 fee_charge 留痕(钱包前后额不变);
收入统计(admin-statistics)仅含 newPurchase/renew/upgrade/transfer_fee → 交易所手续费**未计入官方收入报表**,只能靠钱包流水反推。

## 修法（优先不改 schema:改 server/src/routes/admin-statistics.ts 收入聚合纳入交易所抽成;不碰 package.json)
1. 先只读:admin-statistics.ts 收入统计怎么算(聚合哪些来源/类型)、交易所抽成数据在哪(exchangeOrder 的 feeAmount / exchangeWalletLog 的 fee_charge / releaseExchangeOrderEscrow 结算处)。
2. 让官方收入统计(总收入、按期收入等相关口径)**纳入交易所平台抽成**:从交易所成交结算数据(已完成/已放款的订单 feeAmount 合计)加入收入。选一个稳定、不重复计数的来源(优先 exchangeOrder 上已结算的 feeAmount,而非可能重复的钱包日志);只统计**已完成结算**的订单抽成,避免把未完成/已退款的计入。
3. 若确实需要落一条正式收入记录(instanceBillingRecord)才符合台账口径且**不需新 schema 枚举**,可评估;但优先在统计聚合层纳入,避免改 schema。若非新增枚举不可,则只在统计层纳入并说明。

## 加守卫
在现有 server/scripts/test-commercial-operations-overview-guards.ts 或 admin-statistics 相关守卫追加断言:官方收入统计纳入交易所已结算抽成。不改 package.json。

## 不许动
- 不改交易所成交/结算/退款逻辑本身;不改抽成比例。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:commercial-operations-overview-guards、test:exchange-lifecycle-guards 通过。

## 交付
一段话:抽成数据取自哪、如何避免重复/未结算计入、是否新增记录、守卫结果。不要 commit。
