# FX-041 规格：秒杀两条失败路径不释放库存、soldCount 不回滚(F-A / BF-5-02)

## 根因
秒杀商品交付存在两条失败路径——(a)**创建超时清理**、(b)**公网 IPv4 无货**——失败后**不调用 markFlashSaleFailed**,导致 `soldCount`/`reservedCount` 不回滚、库存被永久占用(幽灵占用),后续真实买家买不到。

## 修法(只改 秒杀相关失败路径 + 其守卫;优先 services/flash-sales.ts 及实例创建失败补偿路径中与秒杀相关分支;不碰 traffic.ts(并行);不改 schema/package)
1. 先只读:`services/flash-sales.ts` 的 `markFlashSaleFailed`(释放库存/回滚 soldCount 的权威函数)、实例创建的"超时清理"路径、"公网 IPv4 无货"失败分支、既有成功/失败如何标记秒杀。
2. **两条失败路径都接入 markFlashSaleFailed**:
   - 创建超时清理:判定为秒杀订单时,清理同时调用 markFlashSaleFailed 释放库存、回滚 soldCount/reservedCount。
   - 公网 IPv4 无货:该失败分支同样调用 markFlashSaleFailed。
   - 与既有失败补偿(退款/资源回滚,FX-B504/FX-040 语义)协同,不重复释放、不双减(幂等:已释放则不再释放)。
3. 状态迁移用原子条件更新(带原状态 where),避免与抢购竞态(参考 D-013 精神,但**本次只补失败释放,不重构成交路径**)。

## 加守卫
`test:flash-sale-guards`/`test:instance-create-failure-compensation` 追加:两条失败路径都释放库存并回滚 soldCount(幂等)。不改 package.json。

## 不许动
不碰 traffic.ts(并行)。不改 schema/package。不重构成交主链路。不 commit。

## 验收
type-check 通过;`test:flash-sale-guards`、`test:instance-create-failure-compensation` 通过。交付一段话:两条路径接入点、幂等如何保证、守卫结果。
