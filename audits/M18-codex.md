# M18 审计报告
## 结论摘要
通知模块的鉴权与站内信归属校验整体较完整，未发现普通用户越权读取站内信或绕过管理员鉴权群发的问题。最严重风险是用户可控 Webhook 存在 DNS rebinding SSRF 窗口；此外，通知凭证明文落库、广播非原子写入及 Telegram 绑定事务边界仍需修复。

## 发现清单
- [M18-01] P1 | 置信度 高 | server/src/lib/notifier.ts:1374
  - 问题:通用 Webhook 虽在请求前校验域名解析结果，但实际 `fetch` 未使用项目提供的连接期安全 dispatcher，存在 DNS rebinding TOCTOU。
  - 证据:`const parsedUrl = await assertSafeWebhookUrl(url)` 后直接执行 `fetch(parsedUrl.toString(), ...)`；未传入 `safeOutboundDispatcher`。
  - 影响:攻击者可配置首次解析为公网、连接时解析为内网的域名，诱导后端访问环回、内网或云元数据地址并携带通知数据。
  - 修复建议:所有通过 outbound-security 校验的 Webhook 请求都使用连接期重新校验 DNS 的安全 dispatcher。

- [M18-02] P2 | 置信度 高 | server/src/routes/admin-notification-channels.ts:150
  - 问题:全局 Telegram Bot Token 以明文 JSON 直接持久化，用户通知渠道的 Bot Token、Discord Webhook 和签名 Secret 也采用同类存储方式。
  - 证据:`prisma.notificationChannel.create({ data: { ... config: { botToken, chatId } } })`，没有调用敏感数据加密封装。
  - 影响:数据库只读泄漏、备份泄漏或误导出会直接暴露可用机器人凭证及 Webhook 凭证。
  - 修复建议:对通知渠道中的 Token、Webhook URL 密钥部分和 Secret 做字段级加密，读取发送时再解密。

- [M18-03] P2 | 置信度 高 | server/src/routes/inbox.ts:221
  - 问题:广播消息投递和公告历史记录不是同一事务，并且接口没有幂等标识。
  - 证据:先执行 `createBulkMessages(...)`，随后在第 230 行单独执行 `createAnnouncement(...)`。
  - 影响:若站内信已经全部创建、但公告记录写入失败，接口会返回错误；管理员重试后所有用户将收到重复广播。
  - 修复建议:将消息批量创建和公告记录写入纳入同一数据库事务，并为广播请求增加幂等键。

- [M18-04] P2 | 置信度 高 | server/src/lib/mailer.ts:158
  - 问题:SMTP 主机和端口未经私网、环回及保留地址校验便交给 Nodemailer 建立 TCP 连接。
  - 证据:`nodemailer.createTransport({ host: config.host, port: config.port, ... })`；测试连接和测试邮件路径也采用相同方式。
  - 影响:拥有后台配置权限的账号可借服务器探测或连接内网 TCP 服务，错误响应还可能形成端口及服务信息侧信道。
  - 修复建议:保存配置及每次连接时都校验解析结果，并采用具备 DNS rebinding 防护的 SMTP 连接策略。

- [M18-05] P2 | 置信度 高 | server/src/routes/telegram.ts:960
  - 问题:绑定 Token 的消费与 Telegram 绑定写入不在同一事务。
  - 证据:先通过 `telegramBindTokenModel.updateMany(...)` 设置 `usedAt`，之后才单独执行 `telegramBindingModel.upsert(...)`。
  - 影响:若 upsert 因并发唯一键冲突或数据库故障失败，Token 已永久失效但绑定没有完成，用户只能重新生成链接；并发绑定同一 Telegram 账号时尤为明显。
  - 修复建议:在同一数据库事务内完成 Token 条件消费、唯一绑定检查及 upsert，任一步失败时整体回滚。

- [M18-06] P2 | 置信度 高 | server/src/routes/inbox.ts:214
  - 问题:全站广播一次性读取全部活跃用户 ID，并构造单次无界 `createMany`。
  - 证据:`const userIds = await inboxDb.getAllActiveUserIds()` 后直接将完整数组传给 `createBulkMessages`，没有游标或分批上限。
  - 影响:用户规模增大后可能耗尽进程内存、超过数据库参数限制或造成长事务，从而令广播失败并拖慢数据库。
  - 修复建议:使用稳定游标分批读取用户并分批写入，记录广播任务进度以支持安全续跑。

- [M18-07] P3 | 置信度 高 | client/src/views/admin/TelegramConfigView.vue:341
  - 问题:Telegram 管理页大量用户可见文案绕过 i18n。
  - 证据:`toast.error('设置 Telegram Webhook 失败: ' + ...)`，页面标题、确认框、按钮状态和校验提示也均为硬编码中文。
  - 影响:非中文界面仍显示中文，且这些文案不受翻译 key 完整性守卫保护。
  - 修复建议:将该页面所有可见文案迁移到 i18n key，并补齐各语言资源。
