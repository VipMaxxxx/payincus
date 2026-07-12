# BF-11-ai 补全:上会话被杀,4 项未全部落地,补完(G-D 全同意)

## 当前工作树状态(你只读确认)
上一次尝试被中断,已有部分改动(ai-ticket-context.ts / ai-ticket-auto-reply-scheduler.ts 部分改)。**未完成/需核实**:
- **BF-11-06 未修**:ai-ticket-context.ts:475/497 仍用 `contains(ticketMarker='ticket #<id>')` **子串匹配**,`ticket #1` 仍误命中 `#10/#100`。
- **BF-11-09 未修**:代码里**完全没读** `sensitiveHandoffRules`(转人工规则仍硬编码正则)。
- **BF-11-04 疑未修**:tickets.ts:749 send 仍 `generateAiTicketReply(ticketId)` **重新生成**,未用管理员已审草稿。
- **BF-11-07 需核实**:scheduler 是否真把被拦截工单**排除后续扫描**(不只记 reason)。

## 补法(只改 ai-ticket-context.ts + ai-ticket-auto-reply-scheduler.ts + routes/tickets.ts + client TicketsView.vue + config 加载 + 守卫;不改 schema/package;不碰 instances/traffic(并行))
1. **BF-11-06 精确 ticketId**:额度/冷却统计**杜绝子串误命中**——把 `contains('ticket #<id>')` 改为**边界安全精确匹配**(如日志正文用 `ticket #<id>` 后接非数字/行尾的精确判断,或改为结构化按 ticketId 精确过滤——优先结构化;至少保证 #1 不命中 #10/#100)。scheduler marker(`[trigger=scheduler]`)保留。
2. **BF-11-09 sensitiveHandoffRules 可配**:配置加载器**读取** `sensitiveHandoffRules`;转人工规则改为**从配置读取生效**(默认值=现硬编码规则),改配置即生效;容错(配置非法回退默认)。
3. **BF-11-04 semi_auto 发已审草稿**:send 路径改为**发送管理员已审/已编辑的最终正文**(前端传 reviewed body),**不重新调模型生成**;无草稿则拒绝要求先审。区分"生成草稿"(596 端点)与"发送已审"(749)。
4. **BF-11-07 核实/补齐**:被敏感规则/低置信/额度拦截的工单→**标记 needs-human 并从后续自动扫描候选排除**(不再每轮重排最前);仅记 reason 不够,必须真排除。
5. 与 BF-11 系列(自动关闭/首响/队列分页/BF-11-05 手动不限)协同,勿回退。

## 加守卫(务必真加断言)
`test:ai-ticket-context-guards`/`test:ticket-query-guards`/`test:ticket-success-guards` 追加:精确 ticketId(#1 不命中 #10)、sensitiveHandoffRules 从配置读、semi_auto 发已审草稿不重生成、被拦截工单排除扫描。

## 不许动
不碰 instances/traffic(并行)。不回退 BF-11 系列。不改 schema/package。不改锁定表格。不 commit。

## 验收
type-check/client type-check 通过;`test:ai-ticket-context-guards`、`test:ticket-query-guards`、`test:ticket-success-guards`、`test:frontend-i18n-keys` 通过(且守卫含上述新断言)。交付一段话:四点各最终改法+新加了哪些断言、守卫结果。
