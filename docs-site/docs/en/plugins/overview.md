# Plugin Center

The PayIncus plugin center installs and manages third-party plugins. A plugin can provide admin settings pages and user-facing pages through controlled extension slots.

Plugins do not modify PayIncus source code directly. Installed runtime files are stored under:

```text
/opt/incudal/plugins
/opt/incudal/plugin-data
/opt/incudal/plugin-logs
/opt/incudal/plugin-staging
```

These directories are preserved across OTA updates and rollbacks.

## Capabilities

- Install uploaded `.tar.gz` plugin packages
- Install from a GitHub plugin market
- Enable, disable, and uninstall plugins
- Inspect plugin task logs
- Show installed plugin settings entries in the admin sidebar
- Manage business configuration from standalone plugin settings pages
- Render third-party admin or user plugin pages in sandboxed iframes
- Build plugins from built-in templates, including `plugin-templates/ai-ticket-agent-plugin` for AI ticket draft assistance

## Admin UI

The plugin center is split into three internal pages:

- Installed: upload plugin packages, inspect plugins, enable/disable/uninstall plugins and open plugin settings.
- Plugin Market: open a dedicated GitHub market index page, refresh the market and install market plugins.
- Install Tasks: inspect upload installs, market installs, enable, disable and uninstall tasks. The task list is fixed to at most 7 rows per page, and the log panel beside it shows the selected task output.

The plugin center handles installation, enablement, disablement, uninstall and task logs only. After a plugin is installed, PayIncus adds a left-sidebar settings entry when its manifest declares an `admin.plugins.settings` admin page. Operators can open the settings page before enabling the plugin; the page shows the current enablement state. Settings open through a standalone route instead of being embedded in the plugin center detail panel.

## AI Ticket Plugin Template

`plugin-templates/ai-ticket-agent-plugin` is the official template for third-party AI ticket assistant plugins. It requires PayIncus `v0.3.2` or later.

The official market can publish the `AI 工单助手` (`AI Ticket Assistant`) plugin package. Administrators should configure `PLUGIN_MARKET_INDEX_URL` in production, refresh the Plugin Market tab in the admin plugin center, and install it from there. After installation, the admin sidebar shows the `AI 工单助手` settings entry; enable the plugin from Installed when it should actually generate drafts or take over replies.

`AI 工单助手` uses a standalone Chinese settings form instead of raw JSON editing. Operators can configure enablement, takeover mode, OpenAI-compatible model endpoint, model name, API key, temperature, timeout, auto-reply categories, confidence threshold, daily limit, per-ticket limit, cooldown, AI identity disclosure and custom system prompt. The API key is encrypted after saving and is never rendered back to the page; leaving it empty keeps the existing key.

After the plugin is enabled, the admin ticket detail view can generate an AI reply draft. The draft is only inserted into the reply box; an administrator must review and send it manually.

The plugin also provides a controlled takeover reply endpoint. It regenerates the reply, runs safety checks, enforces sensitive-ticket handoff rules, and applies configured daily, per-ticket, and cooldown limits. It can only write one support-side message and does not change ticket status.

When the plugin is configured in `auto` mode, the server scheduler scans official/system tickets every 2 minutes. It only handles tickets whose latest message is from the user, are not urgent, are not abuse-category, match `autoReplyCategories`, and do not trigger handoff rules. Third-party hosted node tickets are not auto-taken over.

The template uses guarded endpoints:

```text
POST /api/tickets/:id/ai/context
POST /api/tickets/:id/ai/draft
POST /api/tickets/:id/ai/reply
```

Both endpoints require an administrator session, the enabled `com.payincus.ai-ticket-agent` plugin, and explicit plugin permissions. The context is limited to a redacted summary for the ticket owner only. It does not expose internal admin notes, payment callback payloads, secrets, root passwords, or other users' data.

The plugin settings page also reads a safe status endpoint:

```text
GET /api/tickets/ai/status
```

This endpoint only returns operational flags such as whether the plugin is enabled, current mode, whether the model is configured, permission availability, auto-reply categories, confidence threshold, and limit settings. It does not return the model endpoint, API key, backend paths, raw ticket content, or user data.

## Security Boundary

- Only super administrators can install, enable, disable, or uninstall plugins.
- User plugins cannot access `/api/admin/*`.
- Plugin packages cannot contain absolute paths, `../`, symlinks, or hard links.
- Market plugins must come from GitHub Release artifacts and pass SHA256 verification.
- This version does not execute plugin shell scripts or load arbitrary backend code.
- AI ticket takeover replies require the separate `ticket:ai:reply` permission and force human handoff for refunds, disputes, account security, risk control, destructive instance actions, credential/backend requests, and delivery exceptions.
- AI ticket endpoints cannot adjust balances, delete instances, change ticket status, or perform other resource operations.
- AI automatic replies only run in `auto` mode and are constrained by daily, per-ticket, and cooldown limits.
