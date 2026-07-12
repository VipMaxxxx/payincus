# FX-066 规格：风险分衰减恒0→一次异常永久限速+可能永久限单(E2 / D-006 / BF-6-05/06)

## owner 裁决(BEHAVIOR.md E2)
衰减每小时 -5 分(无触发时按累计时长扣),使限速/限单能自动回落;并把 scoreDecayPerHour 纳入策略可编辑项。

## 根因
resource-risk.ts:255-258 衰减 decay = floor(elapsedHours × scoreDecayPerHour);风控每 5 分钟跑一次,elapsedHours≈0.083,
且 lastEvaluatedAt 每轮刷成 now → 时间差不累积、floor(0.083×N)=0(默认3)→ **衰减恒为0**;QoS 自动恢复条件 nextScore≤recoverScore 永不满足,只能人工 release。
scoreDecayPerHour 不在 admin 策略更新白名单(buildPolicyUpdate,resource-risk.ts:208-224)→ 改不了。

## 修法（只改 server/src/services/resource-risk.ts;尽量不改 schema,复用现有时间字段)
1. 先只读:评估函数里 lastEvaluatedAt / 上次触发时间 / 分数状态怎么存,scoreDecayPerHour 默认值(schema:2092)与 buildPolicyUpdate。
2. **衰减按"距上次有效触发的累计时长"算**,而非每轮重置的 lastEvaluatedAt:
   - 需要一个"上次分数上升/上次触发"的时间锚(优先复用现有字段,如记录最近一次 trigger 的时间;若只有 lastEvaluatedAt 被每轮刷新,则**新增逻辑:仅在本轮有触发(分数上升)时才更新该锚,无触发时不动**,使 elapsed 能跨轮累积)。
   - decay = floor((now − 锚) 的小时数 × scoreDecayPerHour)。默认 scoreDecayPerHour 用 owner 定的 **5**(把 schema 默认或代码默认从 3 改为 5;若改 schema 默认需迁移则在代码层用 5 兜底并说明)。
   - 无触发时,随时间累积 decay,分数逐步回落,直到 ≤ recoverScore 触发 QoS 自动恢复。
3. **纳入可编辑**:把 scoreDecayPerHour 加进 buildPolicyUpdate 的策略可编辑白名单(BF-6-06),让 admin 能调。
4. 不改触发加分逻辑、不改 QoS 档位数值(E13 QoS 缩放是另一条)。

## 加守卫
在现有 server/scripts/test-resource-risk-guards.ts 追加断言:衰减按累计时长(不每轮重置锚)、scoreDecayPerHour 可配、默认5。
注:test:resource-risk-guards 在基线本就红(FX-DISC-09);顺手看红因——若你的改动可一并修绿就修,否则说明、不强改、不让它更红。不改 package.json。

## 不许动
- 不改触发加分、不改 QoS 档位数值、不改自动封停阈值。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:resource-risk-guards 若基线本就红则说明(不作为本条失败依据),尽量修绿。

## 交付
一段话:衰减锚如何改、默认5如何落、纳入可编辑、resource-risk-guards 红因/是否修绿、守卫结果。不要 commit。
