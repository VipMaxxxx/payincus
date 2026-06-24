# AI 工单助手

这是 PayIncus 官方 AI 工单助手插件，用于生成工单回复草稿和受控接管回复。

核心边界：

- 插件不直接读取数据库。
- 工单上下文必须通过后端受控接口读取。
- 上下文按 `ticketId` 定位，并限制在该工单所属用户范围内。
- 支付回调、服务商密钥、root 密码、宿主机证书、内部备注、登录 IP、User-Agent 和其他用户数据不会进入 AI 上下文。
- 默认模式是 `draft`，只生成草稿，不自动发送。
- `apiKey` 应通过插件中心配置保存，会按敏感配置加密存储。

受控接口：

```text
POST /api/tickets/:id/ai/context
POST /api/tickets/:id/ai/draft
POST /api/tickets/:id/ai/reply
GET /api/tickets/ai/status
```

`reply` 接口只在 `semi_auto` 或 `auto` 模式可用，并要求独立的 `ticket:ai:reply` 权限。退款、支付争议、账号安全、风控、数据恢复、删除/重装/迁移实例、凭据或后台细节、交付异常等内容会强制转人工。

打包命令：

```bash
tar -czf ai-ticket-agent-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```
