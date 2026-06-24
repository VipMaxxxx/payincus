# AI Ticket Agent

This plugin is the PayIncus AI ticket takeover scaffold.

It is designed around a privacy-first backend boundary:

- The plugin does not read the database directly.
- AI context must be fetched through the authenticated backend route.
- Context is derived from `ticketId`, then scoped to `ticket.userId`.
- Payment callbacks, provider secrets, root passwords, host certificates, internal notes, login IPs, user agents, and other users' data are excluded.
- Draft mode is the default. Automatic replies should only be enabled for low-risk categories.
- Store `apiKey` through the plugin center config editor; keys are detected as secret config and are not returned in plugin config responses.

Draft generation endpoint:

```text
POST /api/tickets/:id/ai/draft
```

The draft endpoint only returns a suggested reply. It does not send a ticket message and does not change ticket status.

Controlled takeover reply endpoint:

```text
POST /api/tickets/:id/ai/reply
```

The reply endpoint requires the separate `ticket:ai:reply` permission and only works when the plugin mode is `semi_auto` or `auto`. It generates a fresh reply from the safe context, blocks unsafe output, blocks sensitive handoff cases, writes one support-side ticket message, sends the normal ticket notification, and leaves the ticket status unchanged.

Direct takeover replies are blocked when the ticket is abuse-category, urgent, outside the configured `autoReplyCategories` in `auto` mode, or mentions refunds, payment disputes, account security, risk control, destructive instance actions, credentials/backend details, data recovery, outages, or delivery exceptions.

The backend also enforces `dailyAutoReplyLimit`, `ticketAutoReplyLimit`, and `cooldownSeconds` from plugin config before sending a takeover reply. These limits are counted from successful `ai_ticket.reply_send` audit logs.

In `auto` mode, the server scheduler scans every 2 minutes for official/system tickets whose latest message is from the customer. It skips hosted-market tickets owned by non-admin hosts, urgent tickets, abuse tickets, categories outside `autoReplyCategories`, and anything that triggers the handoff rules.

Package it from this directory:

```bash
tar -czf ai-ticket-agent-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```
