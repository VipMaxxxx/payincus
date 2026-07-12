# BF-11-05 规格：自动回复上限也拦截手动 semi_auto(G-D 同意)

## 裁决
"每日/单工单自动回复上限"**只限调度器全自动、不限管理员手动触发**。

## 现状
手动 semi_auto 与调度器 auto **共用同一额度与冷却** → 人工主动处理可能因当天自动额度用尽而无法发。证据:ai-ticket-context.ts:477、1048。

## 修法(只改 services/ai-ticket-context.ts(+必要 routes)+ 守卫;不改 schema/package;不碰前端(并行 FX-DISC-12))
1. 先只读:ai-ticket-context.ts:477、1048 的额度/冷却校验、区分"调度器 auto"与"管理员手动 semi_auto/手动触发"的调用来源。
2. **上限只限调度器**:每日/单工单自动回复上限与冷却**仅对调度器全自动路径生效**;**管理员手动触发**(semi_auto 确认发送、手动 AI 回复)**不计入/不受该上限与冷却限制**(手动仍可正常发)。
3. 保持调度器自动路径的上限/冷却不变(防滥用),AI 总额度等其它风控保持。

## 加守卫
`test:ai-ticket-context-guards` 追加:自动回复上限/冷却只限调度器、手动触发不受限。不改 package.json。

## 不许动
不碰前端(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:ai-ticket-context-guards`、`test:ticket-query-guards` 通过。交付一段话:如何区分调度器 vs 手动、上限只作用调度器、守卫结果。
