# 工单状态批:BF-11-15 首响进 in_progress + BF-11-11 角标口径 + BF-11-12 SLA met(G-D 全同意)

## 三条裁决
- **BF-11-15**:in_progress 应在**客服首次公开回复**时自动进入(现由客户回复触发、状态名与触发方相反)。证据:db/tickets.ts:1043、1058、1070。
- **BF-11-11**:"待处理数量"角标**只统计当前轮到客服回复的**工单(needsReply,最新消息来自客户),与队列口径一致(现统计全部 open/in_progress)。证据:db/tickets.ts:1224-1240、908。
- **BF-11-12**:SLA `met` **仅表示在 resolutionDueAt 前解决**;逾期解决**保留违约记录**(写 slaBreachedAt)(现只要 resolved 即 met)。证据:db/tickets.ts:56、80、151。

## 修法(只改 db/tickets.ts(+必要 routes)+ 守卫;不改 schema/package;不碰 hosting(并行))
1. **BF-11-15**:客服**首次公开回复** open 工单时置 `in_progress`(客户回复保持既有语义或按裁决调整);状态名与触发方对齐。
2. **BF-11-11**:角标"待处理数量"查询改为 `needsReply`(最新公开消息来自客户/轮到客服)口径,与列表一致。
3. **BF-11-12**:`met` 判定改为 `resolvedAt <= resolutionDueAt`;逾期解决 → 写 `slaBreachedAt`(现有列)并保留违约;达标率不再虚高。
4. 保持工单其它逻辑(BF-11-batch 的自动关闭/重开)不回归。

## 加守卫
`test:ticket-query-guards`/`test:sla-alert-guards`/`test:ticket-success-guards` 追加:首响进 in_progress、角标按 needsReply、met 仅按时解决+逾期写 breach。不改 package.json。

## 不许动
不碰 hosting(并行)。不回退 BF-11-batch。不改 schema(用现有 slaBreachedAt 列)。不 commit。

## 验收
type-check 通过;`test:ticket-query-guards`、`test:sla-alert-guards`、`test:ticket-success-guards`、`test:ticket-auto-close-guards` 通过。交付一段话:三点各改法、守卫结果。
