# FX-028 规格：删抽奖奖品级联抹中奖记录(P1 / D-025)

## 根因
删除抽奖奖品(LotteryPrize)配置时,其中奖/发放记录被级联删除 → 影响库存/发放核算、可能重复发放或统计失真(与 FX-027 的 VIP 奖励同类问题)。

## 修法（bounded:不改 schema Cascade;参照 FX-027 做法软删/停用;改 server/src/db/lottery.ts 或 server/src/routes/admin-entertainment.ts 的删奖品逻辑)
1. 先只读:抽奖奖品的删除接口、奖品与中奖记录(LotteryRecord/发放记录)的关系(Cascade)、库存/发放如何据记录核算。
2. 把"删除奖品"改为**软删/停用**(复用现有 enabled/status 字段;删除接口置 disabled,不硬删):
   - 停用奖品不再参与抽奖(抽奖池过滤停用);
   - 中奖/发放记录**保留**(核算/审计完整,防级联抹掉)。
   若无现成状态字段,则改为**阻断硬删**:有中奖记录的奖品不可硬删,只能停用。
3. 不改抽奖运行时/发放逻辑本身、不改 FX-029 已加的配置校验。

## 加守卫
在现有 server/scripts/test-entertainment-route-guards.ts 或 admin-entertainment 守卫追加断言:删/停用抽奖奖品不抹中奖记录(软删/停用 or 阻断硬删)。不改 package.json。

## 不许动
- 不改 schema Cascade;不碰 recharge.ts(并行)、admin-entertainment 的 FX-029 校验(只加删奖品软删)。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:entertainment-route-guards、test:admin-entertainment-route-guards 通过。

## 交付
一段话:软删/停用还是阻断硬删、中奖记录如何保留、守卫结果。不要 commit。
