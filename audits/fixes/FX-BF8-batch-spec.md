# 秒杀策略批:BF-8-01 自动开场 + BF-8-02 maxPerUser 跨活动合计 + BF-8-03 allowAff 独立生效(G-C/F-B 全同意)

## 三条裁决
- **BF-8-01**:scheduled 活动**到开始时间自动允许成交**,无需管理员手动切 active。证据:flash-sales.ts:52、202、643。
- **BF-8-02**:maxPerUser **跨活动内所有商品合计**(现按 itemId 分别计数,活动限购1含3商品可买3台)。证据:flash-sales.ts:677-678。
- **BF-8-03**:`allowAff=true` **独立允许 AFF**,不再强制 `allowCoupon`(现两开关须同开)。证据:flash-sales.ts:650、instances.ts:1236。

## 修法(只改 services/flash-sales.ts + routes/instances.ts(仅 BF-8-03 的 aff 资格处 :1236)+ 守卫;不改 schema/package;不碰 gift-cards/GiftCardsView(并行))
1. **BF-8-01**:成交资格判定把"scheduled 且 now≥startTime"视为可成交(lazy),或增轻量状态转移;下单校验不再硬要求 DB status=active(允许 scheduled+已到点)。到点前(now<startTime)仍拒。与既有秒杀库存/失败释放(FX-041)协同。
2. **BF-8-02**:`maxPerUser` 计数改为**按 flashSaleId 跨其所有 itemId 合计**用户已购数(而非逐 itemId),超过活动 maxPerUser 拒绝。
3. **BF-8-03**:AFF 资格判定改为**只看 allowAff**(allowAff=true 即允许用 AFF 码),不再要求 allowCoupon 同真;allowCoupon 仅管普通优惠码(若有独立语义则保留)。instances.ts:1236 同步。
4. 三点都保持既有成功/失败/退款路径不回归(FX-041/秒杀补偿)。

## 加守卫
`test:flash-sale-guards` 追加:scheduled 到点可成交、maxPerUser 跨商品合计、allowAff 独立生效。不改 package.json。

## 不许动
不碰 gift-cards.ts/GiftCardsView(并行)。不回退 FX-041。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:flash-sale-guards`、`test:instance-create-turnstile-guards`、`test:instance-route-id-guards`、`test:instance-create-failure-compensation` 通过。交付一段话:三点各改法、守卫结果。
