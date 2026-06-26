# API Reference

PayIncus separates same-origin internal APIs, the stable Public API, Agent APIs, OAuth Provider endpoints and WebSocket routes. Third-party developers, extension backends and automation jobs should use the `/api/v1` Public API instead of relying on user/admin internal browser APIs.

<div class="api-reference-hero">
  <div>
    <strong>OpenAPI 3.1</strong>
    <span>The Public API also ships a machine-readable contract for SDK generation, API clients and automated checks.</span>
  </div>
  <a href="/api/v1/openapi.json">Download JSON</a>
  <a href="/api/v1/openapi.yaml">Download YAML</a>
</div>

```text
https://panel.example.com/api
https://admin.example.com/api
https://panel.example.com/api/v1
```

## Authentication

| Token | Source | Purpose |
| --- | --- | --- |
| `pat_` | User-created API token | Server integrations, automation and extension backends |
| `poa_` | OAuth Provider authorization-code flow | Third-party apps acting for the authorized user |
| Session JWT | Browser login session | User portal, admin console and OAuth consent pages |

Public API uses `Authorization: Bearer <token>` and checks scope, expiry, revocation state, user state and resource ownership. Browser session JWTs should not be stored by third-party apps as long-lived credentials.

## Common Rules

| Rule | Current standard |
| --- | --- |
| Base path | `/api/v1` |
| Pagination | `page`, `pageSize`, max `pageSize = 100` |
| Sorting | Common sorts include `createdAt`, `-createdAt`; some resources support `updatedAt` and `displayOrder` |
| Response | Success responses use `data`; lists also include `meta` |
| Errors | `400`, `401`, `403`, `404`, `409`, `422`, `429` |
| High-risk writes | Service operations, renewal, ticket writes, notification sends and plugin actions have stricter limits |

Public API does not expose direct payment creation, payment callbacks, refunds, direct balance writes, service creation/deletion/migration, sensitive profile changes, admin operations or extension/theme administration. Those flows must go through PayIncus internal state machines, admin review or the controlled extension platform.

## Profile

### GET /api/v1/me {#get-api-v1-me}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/me</code></div>
  <p>Read a safe profile summary for the token owner.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>profile:read</code></td></tr>
    <tr><th>Auth</th><td><code>pat_</code> or <code>poa_</code> Bearer token</td></tr>
    <tr><th>Returns</th><td>User ID, username, safe email summary, role, status, avatar style and token metadata.</td></tr>
    <tr><th>Boundary</th><td>Returns only the token owner and excludes security settings, passwords, balance and other users.</td></tr>
  </tbody></table>
</div>

### PATCH /api/v1/me {#patch-api-v1-me}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method patch">PATCH</span><code>/api/v1/me</code></div>
  <p>Update low-risk profile presentation fields for the token owner.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>profile:write</code></td></tr>
    <tr><th>Body</th><td>Currently only <code>avatarStyle</code>.</td></tr>
    <tr><th>Boundary</th><td>Email, password, role, status, balance and 2FA settings are not writable.</td></tr>
  </tbody></table>
</div>

## Balance

### GET /api/v1/balance {#get-api-v1-balance}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/balance</code></div>
  <p>Read the current user account balance.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>balance:read</code></td></tr>
    <tr><th>Returns</th><td>Current balance in the panel settlement currency.</td></tr>
    <tr><th>Boundary</th><td>No recharge, debit, refund, adjustment or cross-user operation is exposed.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/balance/logs {#get-api-v1-balance-logs}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/balance/logs</code></div>
  <p>List safe balance ledger entries for the current user.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>balance:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>, <code>pageSize</code>, <code>sort</code>, <code>type</code>, <code>lotteryGift</code></td></tr>
    <tr><th>Boundary</th><td>No provider payloads, adjustment objects, hosting balance or other users are returned.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/balance/adjustment-requests {#get-api-v1-balance-adjustment-requests}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/balance/adjustment-requests</code></div>
  <p>List balance adjustment requests created by the token owner through Public API.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>balance:write</code></td></tr>
    <tr><th>Query</th><td><code>page</code>, <code>pageSize</code>, <code>sort</code>, <code>status</code></td></tr>
    <tr><th>Boundary</th><td>No other users, admin-only requests, provider payloads or raw approval internals are exposed.</td></tr>
  </tbody></table>
</div>

### POST /api/v1/balance/adjustment-requests {#post-api-v1-balance-adjustment-requests}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/balance/adjustment-requests</code></div>
  <p>Create a pending balance adjustment request for admin review.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>balance:write</code></td></tr>
    <tr><th>Body</th><td>Positive amount, reason and optional external reference.</td></tr>
    <tr><th>Returns</th><td><code>202</code>, request accepted for review.</td></tr>
    <tr><th>Boundary</th><td>Never mutates balance, writes balance logs, creates payments or issues refunds directly.</td></tr>
  </tbody></table>
</div>

## Products

### GET /api/v1/products {#get-api-v1-products}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/products</code></div>
  <p>List enabled public products and plans.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>products:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>, <code>pageSize</code>, <code>sort</code></td></tr>
  </tbody></table>
</div>

### GET /api/v1/products/:id {#get-api-v1-products-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/products/:id</code></div>
  <p>Read one enabled product and its enabled plans.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>products:read</code></td></tr>
    <tr><th>Path</th><td><code>id</code> is the product ID.</td></tr>
  </tbody></table>
</div>

## Services

### GET /api/v1/services {#get-api-v1-services}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/services</code></div>
  <p>List service summaries for the current user.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>, <code>pageSize</code>, <code>status</code>, <code>include=product,plan</code>, <code>sort</code></td></tr>
    <tr><th>Boundary</th><td>No root passwords, Incus IDs, host internals or privileged connection material are returned.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/services/:id {#get-api-v1-services-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/services/:id</code></div>
  <p>Read one service owned by the current user.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:read</code></td></tr>
    <tr><th>Query</th><td><code>include=product,plan</code></td></tr>
  </tbody></table>
</div>

### POST /api/v1/services/:id/actions {#post-api-v1-services-id-actions}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/services/:id/actions</code></div>
  <p>Queue a controlled power operation for a current-user service.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:operate</code></td></tr>
    <tr><th>Body</th><td><code>action</code> must be <code>start</code>, <code>stop</code> or <code>restart</code>.</td></tr>
    <tr><th>Boundary</th><td>Delete, suspend, provisioning, migration, reinstall, host operations and connection secrets are not exposed.</td></tr>
  </tbody></table>
</div>

### POST /api/v1/services/:id/renew {#post-api-v1-services-id-renew}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/services/:id/renew</code></div>
  <p>Renew a paid service through the internal billing state machine.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:billing</code></td></tr>
    <tr><th>Body</th><td>Renew period and idempotency key.</td></tr>
    <tr><th>Boundary</th><td>Balance deduction, billing records, AFF discounts and hosted-node restrictions are handled inside the transaction.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/services/:id/tasks/:taskId {#get-api-v1-services-id-tasks-taskid}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/services/:id/tasks/:taskId</code></div>
  <p>Read the status of a public start, stop or restart task.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:operate</code></td></tr>
    <tr><th>Boundary</th><td>Only Public API power tasks are returned.</td></tr>
  </tbody></table>
</div>

### DELETE /api/v1/services/:id/tasks/:taskId {#delete-api-v1-services-id-tasks-taskid}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method delete">DELETE</span><code>/api/v1/services/:id/tasks/:taskId</code></div>
  <p>Cancel a pending public service power task.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:operate</code></td></tr>
    <tr><th>Boundary</th><td>Processing, completed and non-public task types cannot be cancelled.</td></tr>
  </tbody></table>
</div>

## Orders and Billing

### GET /api/v1/orders {#get-api-v1-orders}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/orders</code></div>
  <p>List current-user recharge and instance billing orders.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>orders:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>, <code>pageSize</code>, <code>sort</code>, <code>status</code></td></tr>
    <tr><th>Boundary</th><td>Payment callbacks, provider config snapshots, raw query results and full trade numbers are omitted.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/orders/:id {#get-api-v1-orders-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/orders/:id</code></div>
  <p>Read one current-user public order.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>orders:read</code></td></tr>
    <tr><th>Path</th><td><code>recharge:123</code> or <code>instance_billing:456</code>.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/billing-records {#get-api-v1-billing-records}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/billing-records</code></div>
  <p>List service billing records owned by the current user.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>billing:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>, <code>pageSize</code>, <code>sort</code>, <code>type</code>, <code>serviceId</code></td></tr>
    <tr><th>Boundary</th><td>Balance log internals, provider payloads and reconciliation data are omitted.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/billing-records/:id {#get-api-v1-billing-records-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/billing-records/:id</code></div>
  <p>Read one billing record only when it belongs to the current user.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>billing:read</code></td></tr>
  </tbody></table>
</div>

## Tickets

### GET /api/v1/tickets {#get-api-v1-tickets}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/tickets</code></div>
  <p>List ticket summaries owned by the current user.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>, <code>pageSize</code>, <code>status</code>, <code>category</code>, <code>priority</code>, <code>sort</code></td></tr>
    <tr><th>Boundary</th><td>Internal notes and other users' tickets are not returned.</td></tr>
  </tbody></table>
</div>

### POST /api/v1/tickets {#post-api-v1-tickets}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/tickets</code></div>
  <p>Create a public support ticket for the token owner.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:write</code></td></tr>
    <tr><th>Body</th><td>JSON text ticket or <code>multipart/form-data</code> with up to 6 controlled image attachments.</td></tr>
    <tr><th>Limit</th><td>JPG, PNG, WebP, GIF or AVIF images, max 50MB per image.</td></tr>
    <tr><th>Boundary</th><td>No internal notes, status override, target user override, arbitrary files or provider file IDs.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/tickets/:id {#get-api-v1-tickets-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/tickets/:id</code></div>
  <p>Read current-user ticket messages and safe attachment metadata.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:read</code></td></tr>
  </tbody></table>
</div>

### POST /api/v1/tickets/:id/replies {#post-api-v1-tickets-id-replies}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/tickets/:id/replies</code></div>
  <p>Add a public reply to the current user's open ticket.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:write</code></td></tr>
    <tr><th>Body</th><td>Text content or up to 6 controlled image attachments.</td></tr>
  </tbody></table>
</div>

### PATCH /api/v1/tickets/:id/status {#patch-api-v1-tickets-id-status}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method patch">PATCH</span><code>/api/v1/tickets/:id/status</code></div>
  <p>Close or reopen the current user's own ticket.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:write</code></td></tr>
    <tr><th>Body</th><td><code>status</code> must be <code>close</code> or <code>reopen</code>.</td></tr>
    <tr><th>Boundary</th><td>No priority, category, assignment, internal status or cross-user changes.</td></tr>
  </tbody></table>
</div>

## Notifications

### GET /api/v1/notifications {#get-api-v1-notifications}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/notifications</code></div>
  <p>List inbox notifications for the current user.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>notifications:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>, <code>pageSize</code>, <code>status</code>, <code>sort</code></td></tr>
    <tr><th>Boundary</th><td>No channel configuration, external delivery logs, raw event payloads or broadcast targets.</td></tr>
  </tbody></table>
</div>

### POST /api/v1/notifications {#post-api-v1-notifications}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/notifications</code></div>
  <p>Send a short controlled notification to the token owner.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>notifications:send</code></td></tr>
    <tr><th>Body</th><td><code>title</code>/<code>message</code>, a platform template or an enabled plugin template such as <code>plugin:&lt;pluginId&gt;:&lt;templateId&gt;</code>.</td></tr>
    <tr><th>Boundary</th><td>No broadcast, HTML, arbitrary channel selection or internal event override.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/notifications/unread-count {#get-api-v1-notifications-unread-count}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/notifications/unread-count</code></div>
  <p>Read the current user's unread notification count.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>notifications:read</code></td></tr>
  </tbody></table>
</div>

## Plugin Actions

### GET /api/v1/plugins {#get-api-v1-plugins}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/plugins</code></div>
  <p>List enabled plugin actions callable through Public API.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>plugins:action</code></td></tr>
    <tr><th>Boundary</th><td>Webhook URLs, secrets, config values, service hooks and gateway hooks are not exposed.</td></tr>
  </tbody></table>
</div>

### GET /api/v1/plugins/:pluginId/actions {#get-api-v1-plugins-pluginid-actions}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/plugins/:pluginId/actions</code></div>
  <p>Read callable action contracts for one enabled plugin.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>plugins:action</code></td></tr>
  </tbody></table>
</div>

### POST /api/v1/plugins/:pluginId/actions/:action {#post-api-v1-plugins-pluginid-actions-action}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/plugins/:pluginId/actions/:action</code></div>
  <p>Invoke an enabled public plugin action as the token owner.</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>plugins:action</code> plus any action-required scopes.</td></tr>
    <tr><th>Body</th><td>JSON payload and optional idempotency key.</td></tr>
    <tr><th>Rate limit</th><td>Normal actions default to 30 dispatches per minute; strict actions default to 10 per minute for the same token, plugin and action.</td></tr>
    <tr><th>Boundary</th><td>Service-extension and gateway lifecycle actions cannot be dispatched through this endpoint.</td></tr>
  </tbody></table>
</div>

## OAuth

### GET /api/oauth-provider/scopes {#get-api-oauth-provider-scopes}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/oauth-provider/scopes</code></div>
  <p>Return the canonical OAuth and Public API scope metadata.</p>
  <table><tbody>
    <tr><th>Auth</th><td>Public read.</td></tr>
  </tbody></table>
</div>

### POST /api/oauth-provider/token {#post-api-oauth-provider-token}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/oauth-provider/token</code></div>
  <p>Exchange an authorization code or refresh token for OAuth tokens.</p>
  <table><tbody>
    <tr><th>Grant</th><td><code>authorization_code</code>, <code>refresh_token</code></td></tr>
    <tr><th>Returns</th><td><code>poa_</code> access token, refresh token, expiry and granted scopes.</td></tr>
    <tr><th>Boundary</th><td>Refresh tokens are rotated and stored as SHA256 hashes.</td></tr>
  </tbody></table>
</div>

### GET /api/oauth-provider/authorize/consent {#get-api-oauth-provider-authorize-consent}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/oauth-provider/authorize/consent</code></div>
  <p>Read OAuth consent details for the logged-in browser user.</p>
  <table><tbody>
    <tr><th>Auth</th><td>User session JWT.</td></tr>
  </tbody></table>
</div>

### POST /api/oauth-provider/authorize/confirm {#post-api-oauth-provider-authorize-confirm}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/oauth-provider/authorize/confirm</code></div>
  <p>Approve or deny the OAuth authorization request.</p>
  <table><tbody>
    <tr><th>Auth</th><td>User session JWT.</td></tr>
    <tr><th>Returns</th><td><code>redirectTo</code> with either a code or <code>access_denied</code>.</td></tr>
  </tbody></table>
</div>

### GET /api/oauth-provider/authorizations {#get-api-oauth-provider-authorizations}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/oauth-provider/authorizations</code></div>
  <p>List OAuth authorizations for the logged-in user.</p>
  <table><tbody>
    <tr><th>Auth</th><td>User session JWT.</td></tr>
  </tbody></table>
</div>

### DELETE /api/oauth-provider/authorizations/:id {#delete-api-oauth-provider-authorizations-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method delete">DELETE</span><code>/api/oauth-provider/authorizations/:id</code></div>
  <p>Revoke one OAuth authorization and all linked access/refresh tokens.</p>
  <table><tbody>
    <tr><th>Auth</th><td>User session JWT.</td></tr>
  </tbody></table>
</div>

## API Token Management

These routes are called by the user portal session rather than `/api/v1` Bearer tokens, but they are listed in the OpenAPI document to make token lifecycle explicit.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/api-tokens` | List API tokens for the logged-in user |
| `POST` | `/api/api-tokens` | Create an API token; the raw token is returned once |
| `DELETE` | `/api/api-tokens/:id` | Revoke an API token |

## WebSocket and Internal APIs

Terminal WebSocket uses same-origin `/api/ws`. User internal APIs, admin APIs, Agent APIs and payment callbacks have separate authentication models and should not be bypassed by third-party extensions.

```text
wss://panel.example.com/api/ws/...
wss://admin.example.com/api/ws/...
```
