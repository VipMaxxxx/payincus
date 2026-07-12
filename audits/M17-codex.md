# M17 审计报告
## 结论摘要
工单归属校验和自动关闭的条件更新整体较稳健，但 AI 外呼、自动回复幂等性和人工状态更新仍存在高风险缺口。最严重的问题是可配置 AI 地址未经过 outbound-security，以及并发请求可能重复发送 AI 回复或把刚收到回复的工单错误关闭。

## 发现清单
- [M17-01] P1 | 置信度 高 | server/src/services/ai-ticket-context.ts:523、530、568、578
  - 问题:AI 模型地址直接由插件配置拼接后传给 `fetch`，未调用 `assertSafeHttpUrl`，也未使用 `safeOutboundDispatcher`，且默认允许重定向。
  - 证据:`response = await fetch(resolveChatCompletionsUrl(config.apiBaseUrl), { ... })`
  - 影响:恶意或误配的模型地址可让后端访问本机、内网或云元数据服务；公共地址还可通过重定向扩大 SSRF 攻击面。
  - 修复建议:AI 外呼统一经过 outbound-security 校验、连接期 DNS 复验并禁止自动重定向。

- [M17-02] P1 | 置信度 高 | server/src/services/ai-ticket-auto-reply-scheduler.ts:24-26、98-140
  - 问题:AI 自动回复只通过进程内 `running`、`Set` 和发送前查询防重，没有数据库抢占、最新客户消息条件写入或幂等键。
  - 证据:`const processingTicketIds = new Set<number>()`；最终检查后直接执行 `await ticketDb.addTicketMessage(ticketId, actor.id, result.draft, true, [])`。
  - 影响:多进程部署、调度器与管理员手工 AI 回复并发、或两个直接 API 请求并发时，均可能向同一工单发送多条 AI 回复；预先统计日志实现的每日、单工单和冷却限制也会被同时穿透。
  - 修复建议:在数据库事务中以“最新消息仍为客户消息”条件原子抢占，并为一次客户消息建立唯一幂等标识。

- [M17-03] P1 | 置信度 高 | server/src/routes/tickets.ts:1179-1186、1229-1240
  - 问题:人工状态更新和关闭采用“先读取状态、后无条件更新”的分离流程，没有比较旧状态或最新消息版本。
  - 证据:`if (ticket.status === 'closed') ...` 后直接 `await ticketDb.updateTicketStatus(ticketId, 'closed')`。
  - 影响:客服读取工单后，若客户恰好提交新回复使工单恢复为 `in_progress`，较晚执行的关闭操作仍会覆盖为 `closed`，造成新回复留在已关闭工单中；并发关闭还会重复发送通知。
  - 修复建议:使用带预期状态或版本号的条件更新，并只对实际完成状态迁移的请求发送通知。

- [M17-04] P1 | 置信度 高 | server/src/routes/tickets.ts:178-180、984-988；server/src/lib/ticket-attachments.ts:5-7、48-79
  - 问题:单次请求允许最多 6 个、每个 50MB 的图片，并通过 `toBuffer()` 将全部文件长期保存在 `images` 数组中。
  - 证据:`TICKET_UPLOAD_BODY_LIMIT = (6 * 50MB) + 4MB`；`const buffer = await part.toBuffer()`；随后 `images.push({ buffer, ... })`。
  - 影响:一个已登录用户即可让单请求占用约 300MB 以上内存；少量并发上传可能触发进程 OOM，导致整个 API 服务不可用。
  - 修复建议:显著降低单图和总请求上限，并改为有总字节预算的流式上传。

- [M17-05] P1 | 置信度 中 | server/src/services/ai-ticket-context.ts:346-378、381-420、1038-1063
  - 问题:客户消息作为普通 JSON 字段直接进入模型提示，模型返回的 `confidence` 和 `handoffRequired` 被直接作为自动发送依据；输出安全检查仅覆盖少量正则关键字。
  - 证据:`context` 被直接放入用户提示；随后使用 `decision.confidence`、`decision.handoffRequired` 决定 `canSend`；`inspectAiDraftSafety` 只检查密钥样式、路径及少数危险承诺。
  - 影响:客户可构造提示注入内容，诱导模型声明高置信度且无需转人工，并自动发送钓鱼链接、错误操作指引或其他未命中正则的危险回复。
  - 修复建议:将客户内容明确标记为不可信数据，并以服务端确定性策略和严格输出结构决定是否允许自动发送，不能信任模型自报的安全结论。

- [M17-06] P2 | 置信度 高 | server/src/lib/ticket-attachments.ts:51-79；server/src/lib/lsky.ts:369-385
  - 问题:上传校验只信任 multipart 声明的 MIME 类型，没有检查文件魔数或实际解码结果；Lsky 返回 MIME 缺失时又回退到该客户端声明值。
  - 证据:`ALLOWED_IMAGE_MIME_TYPES.has(part.mimetype)` 后直接 `part.toBuffer()`；`normalizeAllowedImageMimeType(... input.contentType) ?? normalizeAllowedImageMimeType(input.contentType)`。
  - 影响:任意内容可伪装成 JPEG/PNG 被上传并占用图床存储，也可能向后续图片处理链路输入畸形或非图片数据。
  - 修复建议:上传前验证文件签名并用受控图片解码器确认格式、尺寸和像素上限。

- [M17-07] P2 | 置信度 高 | server/src/routes/tickets.ts:379-385；server/src/lib/lsky.ts:260、299-305、415-423
  - 问题:附件代理和 Lsky 外呼虽然先调用了 URL 安全校验，但实际 `fetch` 没有使用连接期 DNS 复验的安全 dispatcher。
  - 证据:`const safeImageUrl = await assertSafeHttpUrl(...)` 后执行普通 `fetch(safeImageUrl.toString(), ...)`；Lsky 的上传、查询和删除同样使用普通 `fetch`。
  - 影响:攻击者控制相关域名或图床响应 URL 时，可利用校验与连接之间的 DNS rebinding 将请求导向内网地址。
  - 修复建议:所有通过 `assertSafeHttpUrl` 的 HTTP 请求同时绑定 `safeOutboundDispatcher`。

- [M17-08] P2 | 置信度 中 | server/src/lib/lsky.ts:376-389、393-407
  - 问题:上传成功时允许 `providerFileId` 为 `null`，但清理接口遇到空 ID 会直接返回失败，附件仍可正常入库。
  - 证据:`providerFileId: ... pickProviderFileId(...)` 的返回类型可空；删除时 `if (!providerFileId) { return false }`。
  - 影响:部分 Lsky 响应只返回图片 URL 时，工单创建失败、消息删除或管理员删图均无法回收对应文件，长期形成不可追踪的存储泄漏。
  - 修复建议:无法取得可删除文件标识时拒绝确认上传成功，或保存并实现可靠的替代删除标识。

- [M17-09] P3 | 置信度 高 | server/src/lib/action-ticket.ts:27-41
  - 问题:模块加载时创建永久 `setInterval`，没有保存句柄、`unref()` 或停止函数。
  - 证据:`setInterval(() => { ... }, 60 * 1000)` 的返回值被直接丢弃。
  - 影响:独立脚本、测试进程或热重载环境仅导入该模块也可能无法自然退出，并可能积累重复清理定时器。
  - 修复建议:保存定时器句柄，提供生命周期停止方法，并在适用环境调用 `unref()`。
