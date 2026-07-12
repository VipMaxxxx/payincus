# 秒杀价格完整性:FX-080 价下限+续费提示 + D-060 价格 TOCTOU(BF-8 / D-060 P1)

## 两点
- **FX-080**:秒杀价**无下限/可≥原价**、续费恢复原价无提示 → 强制 `0<秒杀价<原价`;用户端**明示"仅首期优惠,续费恢复原价"**。
- **D-060**(P1,flash-sales.ts:720):秒杀价格 **TOCTOU**——资格检查得到的价格与最终库存申领间价格可变,申领事务重读商品后**不验证成交金额是否仍符当前秒杀价** → 价改后可按旧价成交。修:**价改与申领共用锁 + 绑定价格版本**。

## 修法(只改 services/flash-sales.ts + 秒杀管理端表单/用户端提示(client)+ 守卫;不改 schema/package;不碰 tickets(并行))
1. **FX-080 价下限**:管理端创建/编辑秒杀商品时校验 `0 < salePrice < originalPriceSnapshot(原价)`,否则拒绝(后端强校验,前端提示)。
2. **FX-080 续费提示**:用户端秒杀购买处**明示"仅首期秒杀价,续费按原价"**(i18n 三语),避免用户误以为长期低价。
3. **D-060 价格版本 + 共用锁**:
   - 价改(管理端改秒杀价)与申领**共用同一商品锁**(advisory lock by itemId/campaignId),串行化。
   - 申领事务**重读商品后校验成交金额=当前秒杀价**(或绑定 price 版本号/快照:资格检查时记录 price 版本,申领时比对,不一致则拒绝重试),杜绝按旧价成交。
4. 与 BF-8-batch(已合并的 scheduled/maxPerUser/allowAff)、FX-041 补偿协同,勿回退。

## 加守卫
`test:flash-sale-guards` 追加:秒杀价 0<价<原价、续费提示存在、申领校验成交价=当前价(价格版本/共用锁)。不改 package.json。

## 不许动
不碰 tickets(并行)。不回退 BF-8-batch/FX-041。不改 schema/package。不改锁定表格。不 commit。

## 验收
type-check/client type-check 通过;`test:flash-sale-guards`、`test:frontend-i18n-keys`、`test:instance-create-turnstile-guards` 通过。交付一段话:价下限校验、续费提示、TOCTOU 如何绑定价格版本/共用锁、守卫结果。
