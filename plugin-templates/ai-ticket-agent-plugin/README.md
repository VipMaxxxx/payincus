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

The reply endpoint requires `ticket:ai:reply`, refuses pure `draft` mode, reuses the same safety checks, writes one support message only after the checks pass, notifies the user, and does not change ticket status.
