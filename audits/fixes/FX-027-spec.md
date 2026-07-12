# FX-027 规格：删 VIP 奖励级联抹领取记录致重复领取(P1 / D-024)

## 根因
删除 VipBenefitReward(权益奖励)配置时,其领取记录(VipBenefitRewardClaim,标记"某用户已领某奖励、claimLimit")被级联删除 →
删掉再重建同一奖励(或直接删)后,用户可**重复领取**已领过的奖励(余额/积分/实例),平台漏钱。

## 修法（bounded:不改 schema Cascade;改 server/src/routes/vip-benefits.ts + server/src/db 的删除奖励逻辑)
1. 先只读:VipBenefitReward 的删除接口、VipBenefitRewardClaim 与它的关系(Cascade)、领取时如何据 claim 判"已领/claimLimit"。
2. 把"删除奖励"改为**软删/停用**(而非硬删):给奖励置 disabled/archived 状态(用现有状态字段或加一个可辨识标记),使:
   - 已停用奖励**不再展示/不可领取**(领取入口过滤);
   - 但 VipBenefitRewardClaim 领取记录**保留**,防止删后重建/绕过 claimLimit 重复领。
   若已有 enabled/status 字段就复用;没有则以最小改动实现"停用"语义(不新增 schema 迁移的前提下,若必须加列则改为**阻断删除**:有领取记录的奖励不可硬删,只能停用)。
3. 若采用"阻断硬删+仅允许停用":删除接口对"已有领取记录"的奖励返回明确 4xx,提示改用停用。
4. 领取校验:确认领取时按 claim 记录判重仍有效(停用后不可领)。

## 加守卫
在现有 server/scripts/test-vip-benefit-route-guards.ts 追加断言:删除/停用 VIP 奖励不抹领取记录(软删/停用 or 阻断硬删),防重复领取。不改 package.json。

## 不许动
- 不改 schema Cascade(改它需迁移);不改领取发放逻辑本身。不做大重构。不碰 users.ts / 抽奖(并行/后续)。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:vip-benefit-route-guards 通过。

## 交付
一段话:采用软删/停用还是阻断硬删、领取记录如何保留、领取判重是否仍有效、守卫结果。不要 commit。
