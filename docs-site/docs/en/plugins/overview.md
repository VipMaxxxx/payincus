# Extension Center

The PayIncus Extension Center installs and manages third-party extensions. An extension can provide admin settings pages and user-facing pages through controlled extension slots.

Full platform plan: [Extension Center Plan](/en/plugins/platform-plan). Live online directory: [Extension Market](/en/plugins/market).

Extensions do not modify PayIncus source code directly. Installed runtime files are stored under:

```text
/opt/incudal/plugins
/opt/incudal/plugin-data
/opt/incudal/plugin-logs
/opt/incudal/plugin-staging
```

These directories are preserved across OTA updates and rollbacks.

## Capabilities

- Install uploaded `.tar.gz` extension packages
- Install from a governed online extension market
- Enable, disable, and uninstall extensions
- Inspect extension task logs
- Show installed extension settings entries in the admin sidebar
- Manage business configuration from standalone extension settings pages
- Render third-party admin or user extension pages in sandboxed iframes
- Declare webhook actions, event subscriptions, notification templates, service extensions, payment gateway extensions, and plugin storage from the manifest
- Build server-side integrations through the OAuth Provider, API tokens, OpenAPI 3.1, and the Public API SDK
- Install controlled themes through theme package upload, online theme market, submission review, preview, enablement, rollback, and configuration forms
- Build extensions from built-in templates, including `plugin-templates/ai-ticket-agent-plugin` for AI ticket draft assistance

## Platform Goal

The current Extension Center already provides the first version of a third-party development platform. It can install and govern extension packages, render controlled admin pages, user pages, and extension settings pages, and expose Public API, OAuth Provider, SDK, webhook actions, events, plugin storage, and the theme system. It still does not hand arbitrary backend code execution, arbitrary database writes, payment money state, or resource delivery state directly to extensions.

The PayIncus Extension Platform 2.0 goal is to let third-party developers build complete capabilities inside controlled boundaries:

- Use stable public APIs through `/api/v1` and OpenAPI 3.1.
- Use API tokens and scopes for explicit authorization.
- Create third-party apps through the OAuth Provider, exchange authorization codes for tokens, and use `poa_` Bearer tokens to access Public API resources.
- Read product catalog, current-user services, current-user orders, and current-user tickets, and enqueue controlled service start/stop/restart tasks, create tickets, and append public ticket replies.
- Execute controlled backend actions through the extension action runtime.
- React to order, payment, instance, ticket, and notification events through event subscriptions.
- Store extension business data in scoped plugin storage.
- Load controlled theme CSS through theme package install, preview, enablement, rollback, and configuration forms.

This goal protects authentication, payment, permissions, risk control, resource delivery, and audit chains first. Third-party capabilities must enter the business system through platform SDK/API surfaces instead of bypassing PayIncus internal validation.

## OAuth Provider

PayIncus already provides the first OAuth Provider version. Administrators can create OAuth apps from the OAuth settings page. Third-party apps use the browser `/oauth/authorize` consent page to obtain authorization codes, exchange codes for `poa_` access tokens and `por_` refresh tokens, and call `/api/v1` with the granted scopes. The current version covers client secret hash storage, exact redirect URI matching, scope validation, token expiry, refresh token rotation, revoke flows, and authorization record management.

## Public Resource API

PayIncus already provides the first `/api/v1` resource API version. Third-party services can use `pat_` API tokens or `poa_` OAuth access tokens to access public resources such as `/api/v1/me`, `/api/v1/balance`, `/api/v1/balance/logs`, `/api/v1/balance/adjustment-requests`, `/api/v1/billing-records`, `/api/v1/products`, `/api/v1/services`, `/api/v1/orders`, `/api/v1/tickets`, `/api/v1/notifications`, and `/api/v1/plugins`.

`profile:write` only allows updating `avatarStyle`. `balance:write` only allows submitting the current token user's own pending balance adjustment request; it does not directly write balance, balance logs, payments, or recharge orders. `services:operate` only allows enqueueing start, stop, or restart tasks for the current token user's own services, then polling public task state or canceling still-pending public power tasks. `services:billing` only allows renewing the current token user's own paid services, and renewal reuses the internal balance lock, deduction, billing, and hosted income state machines. `tickets:write` only allows creating the user's own public tickets, public replies, controlled image attachments, closing the user's own tickets, or reopening the user's own closed tickets. `notifications:send` only allows sending short text notifications to the current token user, platform allowlisted templates, or controlled notification templates declared by enabled extensions. `plugins:action` only allows discovering and triggering public webhook actions declared by enabled extensions.

Service, order, billing, ticket, notification, and extension action APIs only return data scoped to the current token user or controlled data from enabled extensions. They do not expose root passwords, Incus IDs, host internal configuration, payment callbacks, provider configuration snapshots, internal notes, raw storage file IDs, webhook URLs, secrets, or extension configuration values. The first service operation version does not expose service creation, suspend, resume, reinstall, delete, migration, or host operations. Payment creation, payment callback handling, refunds, direct balance writes, sensitive user profiles, extension install/enablement, and theme enablement are not exposed through the Public API.

## Theme System

The real theme system is independent from normal page extensions. A theme package declares compatible versions, design tokens, layout blocks, static assets, configuration forms, and supported override surfaces. The current version supports theme upload, stable online theme market install, theme submission review/scan/publish, preview, enablement, rollback to the default theme, saving theme configuration, and loading active theme CSS and configuration values through `/api/themes/active`.

Themes can override visual styling and controlled layout blocks. They cannot inject unauthorized remote scripts, bypass login/payment/permission page logic, or change backend business rules.

## Admin UI

The Extension Center is split into three internal pages:

- Installed: upload extension packages, inspect extensions, enable/disable/uninstall extensions and open extension settings.
- Extension Market: open a dedicated online market index page, refresh the market and install market extensions.
- Install Tasks: inspect upload installs, market installs, enable, disable and uninstall tasks. The task list is fixed to at most 7 rows per page, and the log panel beside it shows the selected task output.

The Extension Center handles installation, enablement, disablement, uninstall and task logs. After an extension is installed, PayIncus adds a left-sidebar settings entry when its manifest declares an `admin.plugins.settings` admin page. Operators can open the settings page before enabling the extension; the page shows the current enablement state. Settings open through a standalone route instead of being embedded in the Extension Center detail panel.

## Extension Market Governance

The market index is hosted from a stable online directory, and every extension entry must publish governance metadata. The admin UI only lists entries with `reviewStatus = listed` by default. `pending`, `delisted`, and `rejected` entries are hidden from the default market and cannot bypass the install endpoint.

The market page shows:

- Review status: pending, listed, delisted, rejected
- Trust source: official, verified developer, third party
- Developer profile: name, homepage, GitHub, verification state, contact
- Version compatibility: minimum and maximum PayIncus versions
- Permission declarations: admin pages, user pages, API capabilities, storage directories
- Security metadata: pinned SHA256, signature state, index fingerprint
- Commercial reserve fields: free/paid, price, currency, revenue share
- Operational metrics: rating, rating count, install count, upgrade notes, rollback notes

Before installation, the admin UI shows a security confirmation with source, review status, compatibility, SHA256, and permissions. The server validates the trusted download URL, SHA256, review status, and PayIncus compatibility again, so the install policy does not rely on browser-side checks.

## AI Ticket Extension Template

`plugin-templates/ai-ticket-agent-plugin` is the official template for third-party AI ticket assistant plugins. It requires PayIncus `v0.3.2` or later.

The official market can publish the `AI 工单助手` (`AI Ticket Assistant`) extension package. Administrators should configure `PLUGIN_MARKET_INDEX_URL` in production, refresh the Extension Market tab in the Extension Center, and install it from there. After installation, the admin sidebar shows the `AI 工单助手` settings entry; enable the extension from Installed when it should actually generate drafts or take over replies.

`AI 工单助手` uses a standalone Chinese settings form instead of raw JSON editing. Operators can configure enablement, takeover mode, OpenAI-compatible model endpoint, model name, API key, temperature, timeout, auto-reply categories, confidence threshold, daily limit, per-ticket limit, cooldown, AI identity disclosure and custom system prompt. The API key is encrypted after saving and is never rendered back to the page; leaving it empty keeps the existing key.

After the extension is enabled, the admin ticket detail view can generate an AI reply draft. The draft is only inserted into the reply box; an administrator must review and send it manually.

The extension also provides a controlled takeover reply endpoint. It regenerates the reply, runs safety checks, enforces sensitive-ticket handoff rules, and applies configured daily, per-ticket, and cooldown limits. It can only write one support-side message and does not change ticket status.

When the extension is configured in `auto` mode, the server scheduler scans official/system tickets every 2 minutes. It only handles tickets whose latest message is from the user, are not urgent, are not abuse-category, match `autoReplyCategories`, and do not trigger handoff rules. Third-party hosted node tickets are not auto-taken over.

The template uses guarded endpoints:

```text
POST /api/tickets/:id/ai/context
POST /api/tickets/:id/ai/draft
POST /api/tickets/:id/ai/reply
```

Both endpoints require an administrator session, the enabled `com.payincus.ai-ticket-agent` extension, and explicit extension permissions. The context is limited to a redacted summary for the ticket owner only. It does not expose internal admin notes, payment callback payloads, secrets, root passwords, or other users' data.

The extension settings page also reads a safe status endpoint:

```text
GET /api/tickets/ai/status
```

This endpoint only returns operational flags such as whether the extension is enabled, current mode, whether the model is configured, permission availability, auto-reply categories, confidence threshold, and limit settings. It does not return the model endpoint, API key, backend paths, raw ticket content, or user data.

## Security Boundary

- Only super administrators can install, enable, disable, or uninstall extensions.
- User extensions cannot access `/api/admin/*`.
- Extension packages cannot contain absolute paths, `../`, symlinks, or hard links.
- Market extensions must come from trusted artifacts and pass SHA256 verification.
- Unlisted market extensions are not shown in the default market and cannot be installed directly.
- Market installs validate the PayIncus version compatibility range.
- This version does not execute extension shell scripts or load arbitrary backend code.
- Complete backend capabilities must use controlled surfaces such as the extension action runtime, API token/scope, event system, and plugin storage instead of bypassing PayIncus payment, balance, resource delivery, permission, and audit chains.
- Theme packages are already integrated through an independent manifest, asset validation, theme market install, theme submission review/scan/publish, preview, enablement/rollback, and configuration forms; deeper template overrides continue to follow controlled boundaries.
- AI ticket takeover replies require the separate `ticket:ai:reply` permission and force human handoff for refunds, disputes, account security, risk control, destructive instance actions, credential/backend requests, and delivery exceptions.
- AI ticket endpoints cannot adjust balances, delete instances, change ticket status, or perform other resource operations.
- AI automatic replies only run in `auto` mode and are constrained by daily, per-ticket, and cooldown limits.
