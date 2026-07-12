# BF-11 工单 / AI 客服 · 业务行为说明书 + 疑点清单

## 一、现状行为

### 1. 工单入口与总开关

1. 系统配置 `ticket_enabled` 默认开启，后台语义写的是“关闭后普通用户无法发起工单，用户端隐藏工单入口”。`server/src/db/system-config.ts:72`
2. 后端只在“创建工单”时检查该开关；关闭后，已有工单的查询、回复、关闭接口仍可调用。`server/src/routes/tickets.ts:178` `server/src/routes/tickets.ts:186`
3. 但用户前端不仅隐藏入口，还会在访问 `/tickets` 时直接跳回仪表盘，因此普通用户无法通过网页查看、回复或关闭已有工单。`client/src/components/layout/SideNav.vue:84` `client/src/router/user.ts:373`
4. Public API 创建工单同样受 `ticket_enabled` 限制。`server/src/routes/public-api.ts:2252` `server/src/routes/public-api.ts:2262`

### 2. 用户创建工单

1. 用户可选择自己名下实例，也可不选实例：

   - 选择实例：工单绑定实例及其宿主机。
   - 不选实例：`hostId=null`，作为系统工单交给管理员。`server/src/routes/tickets.ts:218` `server/src/routes/tickets.ts:241`

2. 创建规则：

   - 标题：2～200 字符。
   - 正文：最多 5000 字符。
   - 无图片时正文至少 10 字符。
   - 有图片时正文允许为空。
   - 分类：`general`、`billing`、`technical`、`abuse`，默认 `general`。
   - 优先级：`low`、`normal`、`high`、`urgent`，默认 `normal`。`server/src/routes/tickets.ts:201` `server/src/routes/tickets.ts:208` `server/src/routes/tickets.ts:211` `server/src/routes/tickets.ts:247`

3. 新工单初始状态固定为 `open`，首条消息标记为客户消息。`server/src/db/tickets.ts:298` `server/src/db/tickets.ts:306` `server/src/db/tickets.ts:313`
4. 通知对象：

   - 第三方托管节点：通知节点所有者。
   - 官方节点或无实例系统工单：通知全部管理员。`server/src/routes/tickets.ts:253` `server/src/routes/tickets.ts:264`

### 3. SLA 规则

创建时按优先级写入两个绝对截止时间：

| 优先级 | 首次回复期限 | 解决期限 |
| --- | ---: | ---: |
| urgent | 30 分钟 | 4 小时 |
| high | 2 小时 | 12 小时 |
| normal | 8 小时 | 48 小时 |
| low | 24 小时 | 96 小时 |

代码按自然时间连续计算，没有工作时间、节假日或“等待用户时暂停”的处理。`server/src/db/tickets.ts:56` `server/src/db/tickets.ts:307`

SLA 展示规则：

1. 任意客服侧公开回复都会首次写入 `firstRespondedAt`。`server/src/db/tickets.ts:1070`
2. 未首响且超过首响期限，或未解决且超过解决期限，显示 `overdue`。
3. 距任一适用期限不超过 1 小时，显示 `due_soon`。
4. 最后消息来自客服显示 `waiting_user`，来自客户显示 `waiting_internal`。
5. 只要状态为 `resolved` 或存在 `resolvedAt`，直接显示 `met`，不判断是否逾期解决。`server/src/db/tickets.ts:70` `server/src/db/tickets.ts:80`
6. 数据模型有 `slaBreachedAt`，但本流程未发现任何写入逻辑，只在返回结果时读取。`server/src/db/tickets.ts:151` `server/prisma/schema.prisma:3604`

### 4. 回复与状态流转

1. 状态集合为：`open → in_progress → resolved → closed`，但后端没有强制该顺序。`server/src/routes/tickets.ts:74`
2. 客户、节点所有者和管理员都能在未关闭工单中发送公开回复。`server/src/routes/tickets.ts:982` `server/src/routes/tickets.ts:1025`
3. 客户回复会无条件把工单改为 `in_progress`，并清空 `resolvedAt`、`closedAt`。`server/src/db/tickets.ts:1051` `server/src/db/tickets.ts:1058`
4. 客服、节点所有者或 AI 回复只更新时间和首响时间，不自动把 `open` 改成 `in_progress`，也不会改变 `resolved` 状态。`server/src/db/tickets.ts:1056` `server/src/db/tickets.ts:1070`
5. 节点所有者或管理员可调用状态接口，把工单直接设置为四种状态中的任意一种；后端没有状态转换矩阵。`server/src/routes/tickets.ts:1151` `server/src/routes/tickets.ts:1173`
6. 用户、节点所有者或管理员都可直接关闭未关闭工单。关闭后网页端不再显示回复框。`server/src/routes/tickets.ts:1205` `client/src/views/TicketsView.vue:1526`
7. 用户网页端没有重新打开入口；Public API 却允许工单创建者把已关闭工单重新设为 `open`。`client/src/views/TicketsView.vue:1277` `server/src/routes/public-api.ts:2466` `server/src/routes/public-api.ts:2482`
8. 管理员可删除任意公开消息，包括首条或最后一条消息；删除消息不会重新计算工单状态、SLA 或 `resolvedAt`。`server/src/routes/tickets.ts:1109` `server/src/routes/tickets.ts:1135`

### 5. 管理员/节点所有者工作队列

1. `needsReply` 的口径：

   - 客户视角：最后一条消息来自客服，即认为客户需要回复。
   - 客服视角：最后一条消息来自客户，即认为客服需要回复。`server/src/db/tickets.ts:567` `server/src/db/tickets.ts:717`

2. 管理端支持 `pending`、`due_soon`、`overdue`、`waiting_user`、`waiting_internal` 队列。`server/src/routes/tickets.ts:1345`
3. 数据库先按未过滤总集合执行分页，再在当前页内过滤队列并排序；返回的 `total` 和 `totalPages` 仍是过滤前数量。`server/src/db/tickets.ts:856` `server/src/db/tickets.ts:897` `server/src/db/tickets.ts:950` `server/src/db/tickets.ts:974`
4. “待处理数量”并不按 `needsReply` 统计，而是统计全部 `open`、`in_progress` 工单，包括正在等待客户回复的工单。`server/src/db/tickets.ts:1224` `server/src/db/tickets.ts:1240`

### 6. AI 插件启用条件

AI 能力存在两层开关：

1. 插件记录必须存在、`enabled=true`、状态为 `enabled`，且最新插件 manifest 声明相应权限。`server/src/services/ai-ticket-context.ts:682`
2. 插件配置中的 `enabled` 也必须为真，且必须配置模型地址和 API Key。`server/src/services/ai-ticket-context.ts:301` `server/src/services/ai-ticket-context.ts:1024`

默认配置：

- 模式：`draft`
- 模型：`gpt-4o-mini`
- 温度：0.2
- 模型超时：20 秒
- 自动分类：`general`、`billing`
- 置信度阈值：0.82
- 每日回复上限：100
- 单工单回复上限：3
- 冷却时间：120 秒
- 展示 AI 身份：开启。`server/src/services/ai-ticket-context.ts:16` `server/src/services/ai-ticket-context.ts:19` `plugin-templates/ai-ticket-agent-plugin/templates/default-config.json:1`

### 7. AI 上下文与安全判断

1. AI 上下文最多包含：

   - 最近 8 条工单消息；
   - 最近 5 笔充值记录；
   - 用户最多 8 个实例；
   - 最多 12 个公开套餐；
   - 最多 6 篇帮助文章，每篇最多 700 字。`server/src/services/ai-ticket-context.ts:10` `server/src/services/ai-ticket-context.ts:784`

2. 上下文不包含内部备注、支付回调、密钥、SSH Key、Agent secret 等后台敏感信息。`server/src/services/ai-ticket-context.ts:918`
3. 以下内容会强制转人工：

   - 退款、争议、拒付；
   - 风控、封禁、账号安全；
   - 删除、销毁、重装、迁移、数据恢复；
   - 密码、SSH、密钥、后台、数据库、路径；
   - 交付失败、实例异常、无法连接、故障、宕机；
   - `abuse` 分类或 `urgent` 优先级。`server/src/services/ai-ticket-context.ts:435`
4. 输出还会拦截疑似密钥、数据库 URL、服务器路径、声称已退款或已完成实例破坏性操作等内容。`server/src/services/ai-ticket-context.ts:411`

### 8. AI 草稿、半自动与人工发送

1. `draft` 模式只生成草稿，草稿会放入普通回复输入框，管理员可编辑后按普通回复发送。`client/src/views/TicketsView.vue:435`
2. `semi_auto` 和 `auto` 模式允许调用 AI 回复接口。
3. “发送 AI 回复”按钮只要求管理员确认一次；之后后端重新调用模型生成新内容，执行检查后立即发送。它不会发送输入框中已生成、已审阅或已编辑的草稿。`client/src/views/TicketsView.vue:463` `server/src/routes/tickets.ts:748` `server/src/routes/tickets.ts:784`
4. AI 回复使用数据库中 ID 最小的活跃管理员作为发件人，通知中也显示该管理员用户名。`server/src/services/ai-ticket-auto-reply-scheduler.ts:28` `server/src/services/ai-ticket-auto-reply-scheduler.ts:142`
5. `showAiIdentity` 仅传给模型作为提示参数，代码不会强制增加“AI 回复”标签或固定署名。`server/src/services/ai-ticket-context.ts:346` `server/src/services/ai-ticket-context.ts:370`

### 9. AI 自动回复调度

1. 调度器随服务启动，每 2 分钟扫描一次。`server/src/app.ts:1063` `server/src/services/ai-ticket-auto-reply-scheduler.ts:229`
2. 只有 `auto` 模式会自动处理。候选条件：

   - 状态为 `open` 或 `in_progress`；
   - 分类在允许列表；
   - 非 `urgent`；
   - 系统工单或官方管理员节点工单；
   - 最新消息必须来自客户。`server/src/services/ai-ticket-auto-reply-scheduler.ts:42`

3. 每轮最多预读 30 个最久未更新候选，再取前 5 个实际处理。`server/src/services/ai-ticket-auto-reply-scheduler.ts:21` `server/src/services/ai-ticket-auto-reply-scheduler.ts:53`
4. 回复成功后只增加客服消息，不修改工单状态。`server/src/services/ai-ticket-auto-reply-scheduler.ts:140`
5. 转人工、低置信度、额度耗尽或安全检查失败时只写审计日志；不会给工单写入“已转人工”状态、跳过截止时间或下一次重试时间。`server/src/services/ai-ticket-auto-reply-scheduler.ts:115`
6. 额度依据 `ai_ticket.reply_send` 成功日志计算：

   - 当天所有成功 AI 回复总数；
   - 日志正文中包含 `ticket #<id>` 的成功数；
   - 同样通过日志正文查找最近一次成功时间。`server/src/services/ai-ticket-context.ts:471`

7. 手动 `semi_auto` 发送和调度器 `auto` 发送使用同一套额度和同一种成功日志。`server/src/services/ai-ticket-context.ts:1048` `server/src/services/ai-ticket-context.ts:768`

### 10. 自动关闭

1. 自动关闭调度器没有业务配置开关，服务启动时立即执行一次，之后每小时执行。`server/src/app.ts:1059` `server/src/services/ticket-auto-close-scheduler.ts:74`
2. 固定条件：

   - 状态为 `resolved`；
   - `resolvedAt` 已超过 24 小时；
   - 最新一条公开消息来自客服。`server/src/db/tickets.ts:1249`

3. 调度器执行间隔为 1 小时，因此实际关闭时间通常为解决后约 24～25 小时。`server/src/services/ticket-auto-close-scheduler.ts:17`
4. 客服在工单已 `resolved` 后继续回复时，只更新 `updatedAt`，不会刷新 `resolvedAt`；因此新回复后可能不足 24 小时就被关闭。`server/src/db/tickets.ts:1056` `server/src/db/tickets.ts:1155`
5. 客户在 `resolved` 后回复会把状态改回 `in_progress`，从而取消本轮自动关闭资格。`server/src/db/tickets.ts:1058`
6. 用户会收到“超过24小时无新回复而自动关闭”的通知，但 docs-site 未说明该自动关闭规则。`server/src/lib/notifier.ts:712`

### 11. 工单图片

1. 创建和回复均支持图片；最多 6 张，单张最大 50MB。请求体上限约为 `6 × 50MB + 4MB = 304MB`。`server/src/lib/ticket-attachments.ts:5`
2. 支持 JPG、PNG、WebP、GIF、AVIF。前后端限制一致。`server/src/lib/ticket-attachments.ts:8` `client/src/components/tickets/TicketImageUploader.vue:24`
3. 图片必须上传至 Lsky；没有本地存储降级。未配置 Lsky 时，纯文本工单正常，但任何带图片的创建或回复都会失败。`server/src/lib/lsky.ts:245` `server/src/lib/lsky.ts:270`
4. 用户端不知道 Lsky 是否就绪，上传组件始终展示；公开系统配置只返回 `ticketEnabled`，不返回附件可用状态。`server/src/routes/system-config.ts:124` `client/src/views/TicketsView.vue:1538`
5. docs-site 只笼统说明支持上传附件及 Lsky 用于工单图片，没有向用户说明“附件功能取决于 Lsky 配置”。`docs-site/docs/features/communication.md:7` `docs-site/docs/features/communication.md:29`
6. `server/src/lib/action-ticket.ts` 中的 “ticket” 是 OAuth/终端的一次性动作凭证，仅支持 `oauth-bind`、`terminal`，不参与 BF-11 客服工单流程。`server/src/lib/action-ticket.ts:3` `server/src/lib/action-ticket.ts:25`

## 二、业务疑点清单

- [BF-11-01] 功能残缺 | `server/src/db/system-config.ts:72` `client/src/router/user.ts:373`
  - 现状：`ticket_enabled=false` 的后台文案是“禁止发起工单”，后端也只禁止创建；但用户前端会阻止进入整个工单中心。
  - 疑点：关闭新建功能会同时切断用户查看客服回复、补充材料和关闭历史工单的网页路径，已有处理中用户会被卡住。
  - 需 owner 确认：**关闭 `ticket_enabled` 时，是否仍应允许普通用户进入工单中心查看和回复已有工单？**

- [BF-11-02] 规则可疑 | `server/src/db/tickets.ts:1256` `server/src/services/ticket-auto-close-scheduler.ts:17`
  - 现状：自动关闭固定为解决后 24 小时、每小时扫描，且没有后台开关或超时配置。
  - 疑点：不同业务、节假日或人工处理阶段无法暂停或延长；docs-site 也未向用户披露该规则。
  - 需 owner 确认：**是否确认所有 `resolved` 工单都必须使用不可配置、不可关闭的 24 小时自动关闭规则？**

- [BF-11-03] 文档-代码不符 | `server/src/db/tickets.ts:1056` `server/src/db/tickets.ts:1268` `server/src/lib/notifier.ts:715`
  - 现状：通知称“超过24小时无新回复”，实际计时锚点是 `resolvedAt`；客服在已解决工单中追加回复不会刷新计时。
  - 疑点：工单可在客服最新回复后不足 24 小时被关闭，通知描述与实际行为不符。
  - 需 owner 确认：**自动关闭的 24 小时是否应从“最后一条公开消息时间”重新计算，而不是固定从 `resolvedAt` 计算？**

- [BF-11-04] 文档-代码不符 | `plugin-templates/ai-ticket-agent-plugin/payincus.plugin.json:51` `client/src/views/TicketsView.vue:463` `server/src/routes/tickets.ts:748`
  - 现状：插件把 `semi_auto` 标为“人工审核后接管”，但管理员点击发送时，后端重新生成一份未展示的新回复并立即发送；输入框中已审核、已编辑的草稿不会被使用。
  - 疑点：管理员确认的是“执行生成并发送”，并没有审核最终实际发送内容。
  - 需 owner 确认：**`semi_auto` 是否必须让管理员看到并确认最终正文后才能发送？**

- [BF-11-05] 内部矛盾 | `plugin-templates/ai-ticket-agent-plugin/payincus.plugin.json:121` `server/src/services/ai-ticket-context.ts:477` `server/src/services/ai-ticket-context.ts:1048`
  - 现状：配置名称是“每日自动回复上限/单工单自动回复上限”，但手动触发的 `semi_auto` 回复也消耗同一额度，并会被单工单上限和冷却时间拦截。
  - 疑点：人工主动处理可能因当天自动回复用尽额度而无法发送 AI 回复，配置名称与实际口径不一致。
  - 需 owner 确认：**这两项“自动回复上限”是否应只限制调度器的全自动回复，不限制管理员手动触发的回复？**

- [BF-11-06] 规则可疑 | `server/src/services/ai-ticket-context.ts:473` `server/src/services/ai-ticket-context.ts:491`
  - 现状：单工单次数和冷却通过日志正文 `contains("ticket #<id>")` 统计。
  - 疑点：这是子串匹配，例如查询 `ticket #1` 也会匹配 `ticket #10`、`ticket #11`、`ticket #100`，可能错误消耗其他工单额度。
  - 需 owner 确认：**单工单 AI 次数和冷却是否必须按精确 `ticketId` 统计，不允许日志文本子串匹配？**

- [BF-11-07] 功能残缺 | `server/src/services/ai-ticket-auto-reply-scheduler.ts:53` `server/src/services/ai-ticket-auto-reply-scheduler.ts:68` `server/src/services/ai-ticket-auto-reply-scheduler.ts:115`
  - 现状：每轮按最旧顺序只处理前 5 个；被敏感规则、低置信度或额度拦截的工单不会被标记或延后，下一轮仍排在最前。
  - 疑点：5 个永久需要人工的旧工单可以每 2 分钟反复占满批次，使其后的可自动回复工单长期得不到处理。
  - 需 owner 确认：**被判定需人工或安全拦截的工单，是否应进入明确的人工队列并退出后续自动扫描？**

- [BF-11-08] 功能残缺 | `plugin-templates/ai-ticket-agent-plugin/payincus.plugin.json:154` `server/src/services/ai-ticket-context.ts:346` `server/src/services/ai-ticket-auto-reply-scheduler.ts:28`
  - 现状：`showAiIdentity=true` 只是提示模型自行体现；消息真实发送者是系统选出的第一个活跃管理员，通知也显示该管理员用户名。
  - 疑点：模型可能不展示 AI 身份，用户反而会认为是具体管理员人工回复。
  - 需 owner 确认：**开启 `showAiIdentity` 时，是否必须由系统强制增加确定性的 AI 标识，而不能只依赖模型遵从提示？**

- [BF-11-09] 配了但没生效 | `plugin-templates/ai-ticket-agent-plugin/templates/default-config.json:16` `server/src/services/ai-ticket-context.ts:301` `server/src/services/ai-ticket-context.ts:444`
  - 现状：默认配置包含 `sensitiveHandoffRules`，但配置加载器完全不读取该键，实际转人工规则是代码内硬编码正则。
  - 疑点：该配置看似可控制敏感转人工规则，实际修改不会生效。
  - 需 owner 确认：**`sensitiveHandoffRules` 是否应成为真正可配置并生效的业务项？**

- [BF-11-10] 功能残缺 | `server/src/db/tickets.ts:856` `server/src/db/tickets.ts:950` `server/src/db/tickets.ts:974`
  - 现状：管理队列先分页后过滤，`total` 仍为过滤前数量。
  - 疑点：“逾期/待处理”等页面可能当前页为空、总数错误，符合条件的工单可能在其他原始分页中，不能形成真实全局队列。
  - 需 owner 确认：**管理端队列筛选是否必须先对全量数据过滤和排序，再执行分页并返回过滤后的总数？**

- [BF-11-11] 内部矛盾 | `server/src/db/tickets.ts:1224` `server/src/db/tickets.ts:1234` `server/src/db/tickets.ts:908`
  - 现状：“待处理数量”统计全部 `open/in_progress`，而列表的“待处理”定义是最新消息来自客户、即 `needsReply=true`。
  - 疑点：正在等待客户回复的工单也计入待处理角标，角标与队列数量口径不一致。
  - 需 owner 确认：**“待处理数量”是否应只统计当前轮到客服回复的工单？**

- [BF-11-12] 规则可疑 | `server/src/db/tickets.ts:56` `server/src/db/tickets.ts:80`
  - 现状：SLA 使用连续自然时间，等待客户期间不暂停；无论解决是否逾期，只要进入 `resolved` 就显示 `met`。
  - 疑点：`met` 实际表达“已经解决”，不是“按 SLA 准时解决”，会使运营数据把逾期结案算成达标。
  - 需 owner 确认：**SLA 的 `met` 是否必须仅表示在 `resolutionDueAt` 之前解决，逾期解决仍应保留违约记录？**

- [BF-11-13] 内部矛盾 | `server/src/routes/tickets.ts:1205` `client/src/views/TicketsView.vue:1277` `server/src/routes/public-api.ts:2482`
  - 现状：普通用户网页端关闭后不能重开；同一用户通过 Public API 可以重开为 `open`。
  - 疑点：同一业务能力因入口不同而不同，网页用户只能另建工单，API 用户可延续原工单。
  - 需 owner 确认：**是否确认普通用户应当可以重开已关闭工单，但该能力只提供给 Public API、不提供网页入口？**

- [BF-11-14] 功能残缺 | `server/src/lib/lsky.ts:273` `server/src/routes/system-config.ts:128` `client/src/components/tickets/TicketImageUploader.vue:98`
  - 现状：图片完全依赖 Lsky；Lsky 未配置时上传必然失败，但用户端始终展示图片上传组件，也不知道附件服务是否可用。
  - 疑点：用户可以选择并预览最多 300MB 图片，提交后才发现系统根本未启用附件服务。
  - 需 owner 确认：**Lsky 未就绪时，是否应在公开配置中明确返回“附件不可用”并隐藏或禁用上传组件？**

- [BF-11-15] 规则可疑 | `server/src/db/tickets.ts:1043` `server/src/db/tickets.ts:1058` `server/src/db/tickets.ts:1070`
  - 现状：客户回复会自动把工单设为 `in_progress`；客服首次回复却不会自动进入 `in_progress`，`open` 工单可在客服回复后继续保持 `open`。
  - 疑点：`in_progress` 当前更像“客户追加过消息”，而不是“客服已开始处理”，状态名称与触发方可能相反。
  - 需 owner 确认：**`in_progress` 是否应在客服首次公开回复时自动进入，而不是由客户回复自动触发？**

## 三、给 owner 的 TOP5 必答确认问题

1. **关闭 `ticket_enabled` 时，是否仍允许用户查看和回复已有工单？** 当前前端会封锁整个工单中心，而后端和配置文案只表示禁止新建。`client/src/router/user.ts:373`
2. **自动关闭是否必须从最后一条公开消息重新计时 24 小时？** 当前从 `resolvedAt` 计时，客服后续回复不会延期。`server/src/db/tickets.ts:1268`
3. **`semi_auto` 是否必须审核最终实际发送正文？** 当前点击后重新生成并直接发送，不使用管理员已查看或编辑的草稿。`server/src/routes/tickets.ts:748`
4. **被 AI 判定需人工的工单是否应退出自动扫描并进入人工队列？** 当前最旧的 5 个被拦截工单可能永久占满每轮扫描名额。`server/src/services/ai-ticket-auto-reply-scheduler.ts:53`
5. **SLA 的 `met` 是否必须代表按时解决？** 当前任何 `resolved` 工单，包括逾期解决，都直接显示 `met`。`server/src/db/tickets.ts:80`
