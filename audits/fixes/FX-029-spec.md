# FX-029 规格：积分↔余额无系统级比价护栏 + 奖池概率不校验(E12 / BF-4-05)

## owner 裁决(BEHAVIOR.md E12)
加系统级硬护栏:单抽期望余额 ≤ 消耗积分对应价值 + 概率和校验 + 面值上限。

## 根因
抽奖 balance 奖品把积分直接换真实余额;prize.value 面值无上限、与 costPoints 无比价校验(admin-entertainment.ts:462-463);
全奖池概率之和不校验(admin-entertainment.ts:446-448)。整条"免费积分→抽奖→真实余额"通路的安全全靠人工配置。
积分锚:1 元 = 100 积分(points.ts:126,169)。

## 修法（改抽奖配置保存/校验入口 server/src/routes/admin-entertainment.ts;不碰 package.json)
先只读通读抽奖(lottery)配置保存逻辑:costPoints、prizes[](type、value(balance 类 value 存分)、probability)。加以下**保存时硬校验**,任一不满足拒绝(明确 400):
1. **概率和**:所有 prize.probability 之和 ≤ 100;若 < 100 必须存在 nothing(未中奖)兜底项覆盖剩余概率(否则抽奖会因抽空报错——与现有 LOTTERY_CONFIG_ERROR 行为一致,但应在配置期就拦住)。
2. **期望余额护栏**:对 balance 类奖品,单抽期望余额产出 Σ(probability/100 × prize余额元) 必须 ≤ 单抽消耗积分对应价值 = costPoints / 100(元)。即期望产出不得超过消耗价值(留出平台不亏的下限;是否留边际由 owner,先按"≤"即可)。balance value 存分则先 /100 转元再算。
3. **面值上限**:单个 balance 奖品面值设合理上限(如 ≤ costPoints/100 元 × 某倍数,或一个绝对上限如 ≤1000 元),防手滑配出巨额面值。取"≤ 单抽消耗价值的 N 倍"或一个绝对上限,择一并说明。
把这些校验做成清晰的辅助函数,拒绝时返回明确文案。

## 加守卫
在现有 server/scripts/test-entertainment-route-guards.ts 或 admin-entertainment-route-guards 追加断言:保存抽奖配置时校验概率和、期望余额≤costPoints价值、面值上限。不改 package.json。

## 不许动
- 不改签到/VIP;不改抽奖运行时逻辑(只加配置期校验)。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:admin-entertainment-route-guards、test:entertainment-route-guards 通过。

## 交付
一段话:三条校验如何实现、面值上限取了什么口径、守卫结果。不要 commit。
