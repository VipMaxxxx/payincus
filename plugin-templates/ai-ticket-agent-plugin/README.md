# AI Ticket Agent

AI-assisted ticket takeover plugin for PayIncus.

The first supported backend capability is a guarded AI context endpoint:

```text
POST /api/tickets/:id/ai/context
```

The endpoint requires an admin session, an enabled `com.payincus.ai-ticket-agent` plugin, and the `ticket:ai:read-context` permission.

Draft generation is available through:

```text
POST /api/tickets/:id/ai/draft
```

The draft endpoint requires `ticket:ai:generate-draft`, reads the encrypted `apiKey` plugin config server-side, and does not write to the ticket thread.

Controlled AI takeover replies are available through:

```text
POST /api/tickets/:id/ai/reply
```

The reply endpoint requires `ticket:ai:reply`, refuses pure `draft` mode, requires a structured model decision with confidence above `confidenceThreshold`, reuses the same safety checks, blocks sensitive handoff cases such as refunds, disputes, account security, risk control, destructive instance actions, credential/backend requests, and delivery exceptions, enforces configured daily/per-ticket/cooldown limits from audit logs, writes one support message only after the checks pass, notifies the user, and does not change ticket status.

When the plugin is enabled in `auto` mode, the backend scheduler scans every 2 minutes for official/system tickets whose latest message is from the customer. It still requires `ticket:ai:reply`, the configured `autoReplyCategories`, confidence threshold, safety checks, handoff rules, and reply limits before sending.

The settings page reads `GET /api/tickets/ai/status` for a safe operational summary. That status endpoint is admin-only and does not return the model endpoint, API key, backend paths, or user data.
