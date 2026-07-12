# BF-11-10 规格：工单队列分页口径(G-D 同意:先全量过滤排序再分页)

## 裁决
队列**先全量过滤排序再分页**(现分页与过滤/排序次序错致页码错乱/漏项)。

## 现状(需 codex 只读确认)
AI 客服/工单队列(被拦截/待处理/优先级排序)存在"先分页后过滤"或"过滤在内存分页后"导致每页数量不稳、漏项。相关:db/tickets.ts 队列查询、ai-ticket 队列。

## 修法(只改 db/tickets.ts(+必要 ai-ticket 队列查询)+ 守卫;不改 schema/package;不碰 plugin(并行))
1. 先只读:工单/AI 队列查询如何过滤(needsReply/优先级/被拦截)、排序、分页;确认是否存在"先分页后过滤"。
2. **先全量过滤+排序,再分页**:把过滤条件(状态/needsReply/被拦截等)与排序放进 DB 查询(where+orderBy)或在完整结果集上先算,再 skip/take 分页;保证每页数量稳定、无漏项、total 正确。
3. 保持队列语义(BF-11-batch/status 的 needsReply/in_progress)不回归。

## 加守卫
`test:ticket-query-guards` 追加:队列先过滤排序再分页、total 正确。不改 package.json。

## 不许动
不碰 plugin(并行)。不回退 BF-11 系列。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:ticket-query-guards`、`test:ai-ticket-context-guards` 通过。交付一段话:过滤/排序/分页次序怎么改、守卫结果。
