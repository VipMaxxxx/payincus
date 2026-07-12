# FX-067b 规格：交易所受让入口未接入下单限制(D-133 余项)

## 背景
FX-067 已让交易所**购买**入口接入 `user-order-restrictions` 校验,但**受让入口**在 `server/src/routes/transfers.ts` 的 `/:id/accept`(超出 FX-067 指定文件),未接入 → 受限用户仍可通过受让获得实例绕过下单限制。

## 修法(只改 routes/transfers.ts + 守卫;不改 schema/package;不碰 resource-risk/user-order-restrictions(FX-067 已定)/instances(并行 FX-044))
1. 先只读:transfers.ts `/:id/accept`(受让)处理器、FX-067 在 user-order-restrictions 暴露的统一购买/受让校验函数(`getActiveOrderRestriction` 或等价)。
2. **受让入口接入限制校验**:受让方(accept 的用户)在获得实例前,调用同一 `user-order-restrictions` 校验;若受让方处于 `restrictedPurchase` 等限制态 → 拒绝受让,返回明确错误。
3. 与购买入口校验语义一致,不重复造轮子。

## 加守卫
`test:risk-audit-guards` 或 transfers 相关守卫追加:受让入口接入下单限制校验。不改 package.json。

## 不许动
不碰 resource-risk/user-order-restrictions/instances(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:risk-audit-guards`、`test:transfer-query-guards`(若相关)通过。交付一段话:接入点、拒绝行为、守卫结果。
