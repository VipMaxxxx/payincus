# AI客服批:BF-11-04 semi_auto发已审草稿 + BF-11-06 精确ticketId + BF-11-07 被拦截进人工队列 + BF-11-09 sensitiveHandoffRules可配(G-D 全同意)

## 四条裁决
- **BF-11-04**:semi_auto 必须**发送管理员已审/已编辑的最终正文**(现点发送重新调模型生成新内容立即发,草稿不用)。证据:TicketsView.vue:463、tickets.ts:748-784。
- **BF-11-06**:AI 单工单额度/冷却按**精确 ticketId** 统计(现 contains("ticket #<id>") 子串匹配,#1 误命中 #10/#100)。证据:ai-ticket-context.ts:473、491。
- **BF-11-07**:被判需人工/安全拦截的工单**进人工队列 + 退出后续自动扫描**(现每轮取最旧5个,被拦截的不标记不延后→永久占满批次)。证据:ai-ticket-auto-reply-scheduler.ts:53、68、115。
- **BF-11-09**:`sensitiveHandoffRules` **成为真正可配置生效项**(现默认配置含该键但加载器不读,硬编码正则)。证据:default-config.json:16、ai-ticket-context.ts:301、444。

## 修法(只改 services/ai-ticket-context.ts + services/ai-ticket-auto-reply-scheduler.ts + routes/tickets.ts + client TicketsView.vue + config 加载 + 守卫;不改 schema/package;不碰 instances(并行 FX-046))
1. **BF-11-04**:semi_auto 发送时用**前端传来的已审草稿正文**(不重新调模型);若无草稿则拒绝(要求先审)。tickets.ts:748-784 改为接收并发送 reviewed body。
2. **BF-11-06**:额度/冷却统计改**精确 ticketId**(结构化字段或精确 `ticket #<id>` 边界匹配,杜绝子串误命中)。复用 FX-067b BF-11-05 的 `[trigger=scheduler]` 标记若相关。
3. **BF-11-07**:自动扫描批次中被**敏感规则/低置信度/额度**拦截的工单→**标记进人工队列**(状态/标志)并从后续自动扫描候选**排除**,不再每轮重排最前。
4. **BF-11-09**:配置加载器**读取 sensitiveHandoffRules**;转人工规则改为**从配置读取生效**(默认值=现硬编码规则),改配置即生效。
5. 与 BF-11 系列(自动关闭/首响/队列分页)协同,勿回退。

## 加守卫
`test:ai-ticket-context-guards`/`test:ticket-query-guards`/`test:ticket-success-guards` 追加:semi_auto 发已审草稿、精确 ticketId、被拦截进人工队列退出扫描、sensitiveHandoffRules 可配。不改 package.json。

## 不许动
不碰 instances(并行)。不回退 BF-11 系列。不改 schema/package。不改锁定表格。不 commit。

## 验收
type-check/client type-check 通过;`test:ai-ticket-context-guards`、`test:ticket-query-guards`、`test:ticket-success-guards`、`test:frontend-i18n-keys` 通过。交付一段话:四点各改法、守卫结果。
