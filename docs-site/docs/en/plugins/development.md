# Extension Development Guide

An extension package must be a `.tar.gz` archive with this root structure:

```text
payincus.plugin.json
README.md
dist/
  admin/
  user/
templates/
docs/
```

Minimal packaging command:

```bash
tar -czf my-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

## Admin Pages

Declare admin pages with `adminPages`. PayIncus opens them in protected sandbox iframes. `admin.plugins.settings` appears as an extension settings entry in the admin sidebar and opens the standalone plugin settings route. `admin.sidebar.extra` appears as an admin sidebar entry; PayIncus generates `/admin/plugins/:pluginId/pages/<entry>` and loads the page with admin permissions.

```json
{
  "slot": "admin.plugins.settings",
  "title": "Settings",
  "entry": "dist/admin/settings.html"
}
```

```json
{
  "slot": "admin.sidebar.extra",
  "title": "Operations Console",
  "entry": "dist/admin/console.html"
}
```

## User Pages

Declare user-facing pages with `userPages`. After an extension is enabled, the user portal reads visible entries from `/api/plugins/enabled-client-extensions`; admin entries are read from `/api/plugins/enabled-admin-client-extensions` and are only available to administrators.

After the extension is enabled, PayIncus renders them in the Extension Center and in the declared user or admin extension slots according to the manifest.

```json
{
  "slot": "user.sidebar.extra",
  "title": "My Extension",
  "path": "/plugins/my-plugin",
  "entry": "dist/user/index.html",
  "requiresAuth": true
}
```

Page-level extension slots mount sandboxed iframes directly into the host page. The first visible page slots include:

- `user.dashboard.cards`: card area on the user dashboard.
- `admin.dashboard.widgets`: operations summary area on the admin statistics page.

```json
{
  "slot": "user.dashboard.cards",
  "title": "Campaign Summary",
  "path": "/plugins/my-plugin",
  "entry": "dist/user/dashboard-card.html",
  "requiresAuth": true
}
```

## Configuration

Admin extension configuration is managed through standalone admin extension settings pages. Config data is still persisted through the extension config APIs. Static extension pages can read non-secret public config:

```text
GET /api/plugins/:pluginId/config/public
```

Config keys whose names contain `token`, `secret`, `password`, `key`, and similar sensitive words are treated as secret config and are not returned by the public config API.

The platform iframe container fetches public config after the extension page loads and posts a live config message to the extension page. After an admin saves standard config, extension iframes on the same page receive the updated public config again:

```js
window.addEventListener('message', event => {
  if (event.origin !== window.location.origin) return
  if (event.data?.type !== 'payincus:plugin-config') return
  console.log(event.data.pluginId, event.data.config, event.data.updatedAt)
})
```

Extensions can declare a standard `configSchema` in the manifest, and the admin settings page will generate the form automatically. Current field types are `text`, `textarea`, `markdown`, `password`, `email`, `number`, `select`, `tags`, `checkbox`, `color`, `file`, and `placeholder`. Fields can declare `group` and `order`; the admin UI renders grouped and ordered config blocks.

```json
{
  "configSchema": {
    "enabled": {
      "type": "checkbox",
      "label": "Enable extension",
      "group": "General",
      "order": 10,
      "required": false,
      "default": true
    },
    "apiKey": {
      "type": "password",
      "label": "API Key",
      "group": "Credentials",
      "order": 20,
      "required": true,
      "secret": true
    },
    "mode": {
      "type": "select",
      "label": "Run mode",
      "group": "General",
      "order": 30,
      "required": true,
      "default": "sync",
      "options": [
        { "label": "Sync", "value": "sync" },
        { "label": "Async", "value": "async" }
      ]
    }
  }
}
```

Admin save endpoint:

```text
PUT /api/admin/plugins/:pluginId/config
```

When an extension has `configSchema`, it can only save keys declared by the manifest. The server normalizes `number`, `checkbox`, `tags`, `email`, `color`, `file`, and `select` fields by type, and missing required fields return `INVALID_PLUGIN_CONFIG`. `type = file` fields show a controlled upload input in the admin settings page. The first version only allows PNG, JPEG, and WebP images, one file up to 2MB. Files are written to `PLUGIN_DATA_DIR/config-files`, and the config value can only store the platform-returned `/api/plugins/:pluginId/config-files/:key/:filename` URL. When the user portal reads that URL, the server verifies that the plugin is enabled, the manifest field is still `file`, and the current config value matches the file. `type = password` or `secret = true` fields are stored encrypted. Admin lists and the public config API do not echo the original value; saving an empty value keeps the existing secret unchanged. Every admin config save writes a `plugin.config_update` audit log. The log only records changed, created, updated, secret, and file key summaries. Config values are always redacted as `values=redacted`; token, password, secret, image URL, and other field values are never written into the log.

## Extension KV Storage

Extensions can declare controlled KV storage for their own data. It is not a global database, and it cannot write PayIncus internal business tables. The current runtime supports the legacy user-level KV plus the first scoped KV version: `user`, `global`, and `service`.

The manifest must declare both storage capability and permissions:

```json
{
  "permissions": ["plugin-storage:read", "plugin-storage:write"],
  "capabilities": {
    "storage": {
      "kind": "kv",
      "maxKeys": 100,
      "scopes": ["user", "global", "service"],
      "retention": "keep"
    }
  }
}
```

Available endpoints:

```text
GET /api/plugins/:pluginId/storage/:key
PUT /api/plugins/:pluginId/storage/:key
DELETE /api/plugins/:pluginId/storage/:key
GET /api/plugins/:pluginId/storage-usage
GET /api/plugins/:pluginId/storage-backup
POST /api/plugins/:pluginId/storage-backup/restore
GET /api/plugins/:pluginId/storage-backup/archives
POST /api/plugins/:pluginId/storage-backup/archives
POST /api/plugins/:pluginId/storage-backup/archives?mode=differential
GET /api/plugins/:pluginId/storage-backup/archives/:backupId
POST /api/plugins/:pluginId/storage-backup/archives/:backupId/restore
POST /api/plugins/:pluginId/storage-backup/archives/:backupId/upload-remote
POST /api/plugins/:pluginId/storage-backup/archives/:backupId/remote/:remoteArchiveId/restore
DELETE /api/plugins/:pluginId/storage-backup/archives/:backupId
```

Scoped KV endpoints:

```text
GET /api/plugins/:pluginId/scoped-storage/:scope/:key
PUT /api/plugins/:pluginId/scoped-storage/:scope/:key
DELETE /api/plugins/:pluginId/scoped-storage/:scope/:key
```

`GET /api/plugins/:pluginId/storage-usage` is an admin-only read endpoint for operations visibility. It returns legacy user KV totals, scoped KV key counts by scope, private table row counts by table and scope, migration counts, declared `maxKeys` / `maxRows`, retention policy, and read-only quota warnings. When declared KV keys or private table rows reach 80% of quota it returns `warning`; when they reach or exceed quota it returns `critical`. It never returns values, row payloads, user IDs, or service IDs.

`GET /api/plugins/:pluginId/storage-backup` and `POST /api/plugins/:pluginId/storage-backup/restore` are admin backup and restore channels. Backup files use `schemaVersion = 1`, are bound to `pluginId`, and include legacy user KV, scoped KV, private table JSON rows, and the migration ledger. Exported backups include `backupId`, `mode = full`, `contentSha256`, total item counts, and a restore strategy summary for offline archiving, comparison, and restore drills. Restore validates backup `pluginId`, key/table/row format, duplicate restore keys, referenced users for legacy user KV, 64KB per item, and total item limits, then replaces only the current storage data for that extension. It does not modify extension package files, config, event logs, orders, payments, instances, or user profiles. Backup content contains private extension values, so it is an admin operations artifact and should not be exposed to ordinary users or third-party marketplace directories.

Run a restore drill before applying a restore:

```text
POST /api/plugins/:pluginId/storage-backup/restore?dryRun=true
```

`dryRun=true` reuses the same validation path as a real restore and returns `valid`, `contentSha256`, data counts, `restoreMode = replace_all_plugin_storage`, and `modified = false`. It writes a `plugin.storage.restore_dry_run` extension event log but does not delete or write extension storage data. A successful real restore writes `plugin.storage.restore`; backup export writes `plugin.storage.backup_export`. These three log types form the audit chain for restore drills and real restores.

First local server archive version:

```text
GET /api/plugins/:pluginId/storage-backup/archives
POST /api/plugins/:pluginId/storage-backup/archives
POST /api/plugins/:pluginId/storage-backup/archives?mode=differential
GET /api/plugins/:pluginId/storage-backup/archives/:backupId
POST /api/plugins/:pluginId/storage-backup/archives/:backupId/restore?dryRun=true
POST /api/plugins/:pluginId/storage-backup/archives/:backupId/restore
POST /api/plugins/:pluginId/storage-backup/archives/:backupId/upload-remote
POST /api/plugins/:pluginId/storage-backup/archives/:backupId/remote/:remoteArchiveId/restore?dryRun=true
POST /api/plugins/:pluginId/storage-backup/archives/:backupId/remote/:remoteArchiveId/restore
DELETE /api/plugins/:pluginId/storage-backup/archives/:backupId
```

`POST /archives` saves a full backup to `PLUGIN_DATA_DIR/storage-backups/plugins/<pluginId>/<backupId>.json`. `backupId` uses `psb_YYYYMMDDHHMMSSmmm_<sha16>`. `POST /archives?mode=differential` reads the most recent verifiable full archive as the base and stores a diff relative to it. If no usable full archive exists, it falls back to a full archive. Diff archives record `mode = differential`, `baseBackupId`, `baseContentSha256`, final `contentSha256`, `diffSha256`, and added/updated/deleted counts. Restoring a diff archive requires the matching base full archive. The server first composes a full backup, then reuses the same dry-run, duplicate key, user reference, size, total item, and replace-in-transaction logic. Deleting a base archive referenced by a diff archive returns `PLUGIN_STORAGE_BACKUP_ARCHIVE_HAS_DEPENDENTS`. Archive lists only return metadata, counts, `contentSha256`, `diffCounts`, base relationships, and uploaded remote replica metadata. Downloading a single local archive is the only local endpoint that returns backup values or diff values. Archive creation, deletion, dry-run, and restore all write extension event logs.

`POST /upload-remote` uploads an existing local archive to the current admin's default remote storage config, or to `storageConfigId` when explicitly provided. Remote archives reuse the platform remote storage adapters. The current supported targets are S3-compatible object storage (AWS S3, Cloudflare R2, MinIO), WEBDAV, FTP, and SFTP. For S3/R2, `host` is the endpoint, `username` is the Access Key ID, `password` is the Secret Access Key, and `extra.bucket`, `extra.region`, and `extra.forcePathStyle` store non-secret parameters; list APIs never return secrets. PayIncus records `backupId`, remote filename, storage config, `contentSha256`, file size, uploader, and status in `plugin_storage_backup_remote_archives`, and writes a `plugin.storage.backup_remote_upload` audit event. `/remote/:remoteArchiveId/restore?dryRun=true` downloads JSON from remote storage, validates `pluginId`, `backupId`, and `contentSha256`, then reuses the local restore dry-run path. A real remote restore also uses a replace-in-transaction flow and updates `lastRestoredAt`. Remote restore never trusts the remote filename and never bypasses backup schema, reference, size, or total item validation.

Scheduled archive creation is disabled by default and can be enabled through environment variables:

```env
PLUGIN_STORAGE_BACKUP_SCHEDULE_ENABLED=true
PLUGIN_STORAGE_BACKUP_INTERVAL_HOURS=24
PLUGIN_STORAGE_BACKUP_RETENTION_COUNT=7
```

When enabled, the server starts `plugin-storage-backup-scheduler`. It scans installed, non-failed extensions on the configured interval and writes full archives into the same directory. The scheduler compares the latest archive `contentSha256`; if content did not change, it writes `plugin.storage.backup_scheduled_skip` and skips a new file. If content changed, it writes `plugin.storage.backup_scheduled_archive`. Retention keeps the latest `PLUGIN_STORAGE_BACKUP_RETENTION_COUNT` archives per extension. Extra local files are cleaned up, except base full archives still referenced by diff archives. Remote archives still require an admin to upload a specific local archive. Restoring a remote diff archive also requires the matching base full archive to exist locally.

First private table space version:

```json
{
  "capabilities": {
    "storage": {
      "kind": "kv",
      "scopes": ["user", "global", "service"],
      "tables": [
        {
          "name": "campaign_reservations",
          "description": "Reservation rows for flash sale campaigns.",
          "scopes": ["global", "user"],
          "maxRows": 100000,
          "migrations": [
            {
              "version": "1.0.0",
              "name": "Create reservation row shape"
            }
          ]
        }
      ]
    }
  }
}
```

Private table endpoints:

```text
GET /api/plugins/:pluginId/table-storage/:scope/:table/:rowKey
PUT /api/plugins/:pluginId/table-storage/:scope/:table/:rowKey
DELETE /api/plugins/:pluginId/table-storage/:scope/:table/:rowKey
GET /api/plugins/:pluginId/table-storage/:table/migrations
POST /api/plugins/:pluginId/table-storage/:table/migrations
```

Supported `scope` values:

- `user`: extension data for the current logged-in user.
- `global`: extension-wide data; logged-in users may read, only admins may write or delete.
- `service`: data for a current user's instance/service; `scopeId=<instanceId>` is required, and the instance must belong to the current user.

Write body:

```json
{
  "value": {
    "selectedCampaign": "summer"
  }
}
```

Limits:

- Only enabled extensions can access their own storage.
- `key` can only contain letters, numbers, `_`, `.`, `:`, and `-`, up to 120 characters.
- Each value must be JSON and no larger than 64KB after serialization.
- Reading requires `plugin-storage:read`.
- Writing or deleting requires `plugin-storage:write`.
- A scope that is not declared in `capabilities.storage.scopes` cannot be accessed. When `scopes` is omitted, only the legacy `user` scope is compatible.
- Private tables must be declared in `capabilities.storage.tables`; `table` can only use lowercase letters, numbers, and underscores, and `rowKey` is up to 160 characters.
- Private table `global` writes, deletes, and migration applies are admin-only. `service` scope still requires `scopeId=<instanceId>` and an instance that belongs to the current user.
- Each private table row value must be JSON and no larger than 64KB after serialization. `maxRows` is counted by `pluginId + table + scope + scopeId`.
- Private table migrations are only a platform ledger. They do not execute arbitrary SQL. `POST /migrations` can only apply a migration version declared in the manifest, and is used to record extension data shape versions and review traceability.
- When `retention = keep`, uninstalling the extension keeps scoped KV and private table data, and reinstalling an extension with the same ID can read it again. `retention = delete_on_uninstall` cleans scoped KV, private table rows, and migration ledger on uninstall. Legacy user-level KV is still removed through extension record cascading.
- KV writes, private table writes/deletes, and migration applies all enter the extension event log.

## Webhook Action Runtime

Extensions can declare webhook actions so PayIncus can call third-party services inside a controlled boundary. PayIncus does not load backend code from extension packages and does not execute shell scripts.

Manifest example:

```json
{
  "permissions": ["plugin-action:run", "orders:create"],
  "capabilities": {
    "actions": [
      {
        "name": "reserveStock",
        "method": "POST",
        "path": "/reserve-stock",
        "runtime": "webhook",
        "url": "https://extension.example.com/payincus/actions/reserve-stock",
        "scopes": ["orders:create"],
        "requestSchema": {
          "type": "object",
          "required": ["campaignId", "sku"],
          "properties": {
            "campaignId": { "type": "string" },
            "sku": { "type": "string" }
          }
        },
        "responseSchema": {
          "type": "object",
          "required": ["reserved"],
          "properties": {
            "reserved": { "type": "boolean" }
          }
        },
        "idempotency": "required",
        "rateLimit": "strict"
      }
    ]
  }
}
```

User-side or extension pages can call:

```text
POST /api/plugins/:pluginId/actions/:action
```

Request body:

```json
{
  "idempotencyKey": "flash-sale-123-user-456",
  "payload": {
    "campaignId": "flash-sale-123",
    "sku": "plan-basic"
  }
}
```

PayIncus sends JSON to the extension webhook with:

- `X-PayIncus-Plugin-Id`
- `X-PayIncus-Plugin-Action`
- `X-PayIncus-Plugin-Request-Id`
- `X-PayIncus-Plugin-Signature`

The signature is HMAC-SHA256 over the request body using `PLUGIN_WEBHOOK_SIGNING_SECRET`. Production must configure this secret. Webhook URLs must use HTTPS. Before dispatch, PayIncus validates outbound targets and blocks private networks, reserved addresses, and local domains. Default timeout is `PLUGIN_WEBHOOK_TIMEOUT_MS`; strict-rate-limit actions use a shorter timeout.

`requestSchema` and `responseSchema` declare the action contract for review, documentation, and SDK generation. Schemas must be JSON objects, no larger than 16KB each, and cannot use `$ref`, `$id`, or dangerous prototype-related keys. The first version does not perform full JSON Schema runtime validation; the extension service must still validate payloads itself.

The current action runtime is designed for calling third-party extension services. It does not directly grant the ability to mutate PayIncus internal orders, payments, balances, or instances. PayIncus already provides the first `/api/v1` and API token/scope surface, and exposes products, orders, tickets, and controlled ticket reply APIs. Write APIs for orders, payments, balances, and instance delivery are opened gradually by scope.

## Service Extension Types

Service extensions connect third-party server capabilities to product config, checkout config, instance provisioning, suspend, unsuspend, terminate, upgrade, and service-detail actions. They are built on the Webhook Action Runtime. PayIncus does not execute backend code from extension packages, and extensions cannot write PayIncus internal instance, order, payment, or balance tables directly.

Manifest example:

```json
{
  "permissions": [
    "plugin-action:run",
    "service-extension:checkout-config",
    "service-extension:provision",
    "service-extension:suspend",
    "service-extension:unsuspend",
    "service-extension:terminate",
    "service-extension:upgrade",
    "service-extension:service-panel"
  ],
  "capabilities": {
    "actions": [
      {
        "name": "provisionVps",
        "method": "POST",
        "path": "/service/provision",
        "runtime": "webhook",
        "url": "https://extension.example.com/payincus/service/provision",
        "scopes": ["service-extension:provision"],
        "idempotency": "required",
        "rateLimit": "strict"
      }
    ],
    "serviceExtensions": [
      {
        "key": "custom-vps",
        "name": "Custom VPS",
        "productId": "vps-basic",
        "hooks": {
          "provision": "provisionVps"
        }
      }
    ]
  }
}
```

Supported hooks:

- `checkoutConfig`
- `provision`
- `suspend`
- `unsuspend`
- `terminate`
- `upgrade`
- `servicePanel`

Each hook must reference a declared webhook action, and the action `scopes` must include the matching `service-extension:*` scope. Controlled admin/internal endpoints:

```text
GET /api/plugins/service-actions/:hook/targets?productId=vps-basic
POST /api/plugins/:pluginId/service-actions/:hook
```

Request body:

```json
{
  "serviceExtensionKey": "custom-vps",
  "idempotencyKey": "provision-order-1001",
  "payload": {
    "orderId": 1001,
    "serviceId": 2001,
    "productId": "vps-basic"
  }
}
```

Discovery and dispatch endpoints are only available to admins or platform internal lifecycle calls. Discovery only returns targets declared by enabled extensions; it does not call webhooks or mutate instances or orders. The public product catalog returns `checkoutConfig` target metadata that matches the current product ID, or targets not bound to a specific product, so market and future create flows can identify controlled checkout candidates. Logged-in service detail pages return `servicePanel` target metadata that matches the current instance product ID, or targets not bound to a specific product, so service pages can identify controlled extension panels. These responses never include webhook URLs, secrets, or payloads. PayIncus wraps `hook`, `serviceExtensionKey`, `productId`, and business payload into the webhook request and writes a `plugin.service-extension.dispatch` audit event. The server has extracted service extension dispatch into a reusable internal service layer and supports discovering enabled extension targets by `hook` and `productId`.

The first instance lifecycle integration automatically dispatches `service.provisioned -> provision`, `service.suspended -> suspend`, `service.unsuspended -> unsuspend`, `service.deleted -> terminate`, and `service.upgraded -> upgrade`. These hooks are dispatched asynchronously after the PayIncus internal state machine completes. Payload includes `lifecycleEvent`, `instanceId`, `userId`, `hostId`, `instanceName`, `status`, `incusId`, `productId`, `reason`, `source`, `metadata`, and `occurredAt`; upgrade hooks also include `oldPlan`, `newPlan`, `priceDiff`, `refundAmount`, `incusSyncSuccess`, and `incusSyncError`, and use `service-lifecycle:*` idempotency keys. Extension webhook failures only write failed extension event logs. They do not roll back or overwrite completed PayIncus instance state, plan, balance, or billing records. The first version does not automatically create, suspend, unsuspend, terminate, or upgrade instances based on webhook responses. Real resource delivery remains owned by the PayIncus internal state machine for idempotency, rollback, permissions, and audit.

Service extension webhooks receive `contractVersion = 1` and an `expectedResult` hint. PayIncus normalizes responses into a controlled result contract:

```json
{
  "accepted": true,
  "status": "pending",
  "message": "Provision request accepted.",
  "externalReference": "ticket-1001",
  "metadata": {
    "region": "sg"
  }
}
```

`status` only accepts `accepted`, `pending`, `completed`, `failed`, or `unsupported`. `message` and `externalReference` are length-limited. `metadata` only keeps flat JSON scalar fields. This contract currently appears only in dispatch responses and extension audit logs for later lifecycle orchestration decisions. It does not directly write instance status, order status, balance, or resource delivery results.

## Gateway Extension Types

Gateway extensions declare third-party payment provider hooks for availability, payment creation, verification, refund, and callback handling. Payments are a high-risk money flow. PayIncus keeps payment creation, active verification, async callbacks, admin sync, and original-channel refunds inside internal state machines. Extension webhooks can only return normalized results; they cannot directly write real balance credit, balance state, or order status.

Manifest example:

```json
{
  "permissions": [
    "plugin-action:run",
    "gateway-extension:availability",
    "gateway-extension:create-payment",
    "gateway-extension:verify-payment",
    "gateway-extension:refund",
    "gateway-extension:webhook"
  ],
  "capabilities": {
    "actions": [
      {
        "name": "createGatewayPayment",
        "method": "POST",
        "path": "/gateway/create-payment",
        "runtime": "webhook",
        "url": "https://extension.example.com/payincus/gateway/create-payment",
        "scopes": ["gateway-extension:create-payment"],
        "idempotency": "required",
        "rateLimit": "strict"
      }
    ],
    "gatewayExtensions": [
      {
        "key": "custom-gateway",
        "name": "Custom Gateway",
        "providerCode": "custompay",
        "hooks": {
          "createPayment": "createGatewayPayment"
        }
      }
    ]
  }
}
```

Supported hooks:

- `availability`
- `createPayment`
- `verifyPayment`
- `refund`
- `webhook`

Each hook must reference a declared webhook action, and the action `scopes` must include the matching `gateway-extension:*` scope. Controlled admin/internal endpoints:

```text
GET /api/plugins/gateway-actions/:hook/targets?providerCode=custompay
POST /api/plugins/:pluginId/gateway-actions/:hook
```

Request body:

```json
{
  "gatewayExtensionKey": "custom-gateway",
  "idempotencyKey": "gateway-order-1001",
  "payload": {
    "orderId": 1001,
    "amount": "19.90",
    "currency": "USD"
  }
}
```

Discovery and dispatch endpoints are only available to admins or platform internal payment lifecycle calls. Discovery only returns targets declared by enabled extensions; it does not call webhooks or mutate order, payment, balance, or refund state. PayIncus wraps `hook`, `gatewayExtensionKey`, `providerCode`, and business payload into the webhook request and writes a `plugin.gateway-extension.dispatch` audit event. The server has extracted payment gateway extension dispatch into a reusable internal service layer and can discover enabled extension targets by `hook` and `providerCode`. Payment provider availability, creation, verification, refund, and callback flows can reuse the same scope checks, webhook signatures, SSRF protection, timeout, idempotency keys, and audit chain.

The first payment lifecycle integration automatically dispatches on top-up payment creation, active verification, payment callback, and admin manual complete/fail paths. After a payment link is generated, PayIncus dispatches `createPayment` asynchronously. Terminal active verification dispatches `verifyPayment`. Terminal payment callback dispatches `webhook`. Admin manual completion or failure dispatches `verifyPayment`. Payload contains `lifecycleEvent`, `providerId`, `providerCode`, `orderNo`, `rechargeId`, `userId`, amount summary, payment method, status, source, redacted external transaction reference, controlled payment detail summary, and `occurredAt`. It never contains `providerConfigSnapshot`, payment channel secrets, raw callback payload, or full transaction number, and it uses `gateway-lifecycle:*` idempotency keys. Extension webhook failures only write failed extension event logs and do not roll back or overwrite completed PayIncus order, balance, callback idempotency, or manual operation results.

Gateway extension webhooks also receive `contractVersion = 1` and `expectedResult`; responses are normalized into `{ accepted, status, message, externalReference, metadata }`. The contract can express whether a third-party payment provider accepted a payment creation request, is pending, does not support a payment method, or returned an external transaction reference. PayIncus does not credit balance, arbitrarily change balance, or arbitrarily change order state because of this response. Real money writes must still pass the internal payment state machine for amount/currency validation, callback signature verification, idempotency, and audit.

The first plugin payment provider version can be enabled as an admin payment channel. When adding a payment channel, choose `plugin_gateway` and configure `pluginId`, `gatewayExtensionKey`, and `providerCode`. When enabling the provider, the server verifies that the plugin is installed and enabled, the manifest contains a `capabilities.gatewayExtensions[]` entry with the same `providerCode`, and a `createPayment` hook is declared. When a user creates a top-up order, PayIncus synchronously calls that hook and only accepts a public HTTPS redirect URL from `metadata.payUrl`, `metadata.paymentUrl`, `metadata.redirectUrl`, or `metadata.checkoutUrl` as the payment link. The URL field is limited to 2048 characters; other metadata strings are still treated as short text.

`plugin_gateway` callbacks are connected to the shared `/api/recharge/callback/:providerId` endpoint. Payment platform callbacks must include the PayIncus order number. PayIncus sends the raw callback data, controlled header summary, source IP, and order amount summary to the `webhook` hook bound to the provider. The plugin verifies its own signature and returns a normalized result: `completed`, `pending`, `failed`, or `cancelled`. PayIncus never directly trusts the raw callback and never lets the plugin bypass the money state machine. After the plugin returns, PayIncus still enforces order number match, providerId match, amount equals payable amount, order not expired, processable status, and `payment_callbacks` idempotency before it runs internal `completeRecharge`, `failRecharge`, or `cancelRecharge`. `cookie`, `authorization`, and `proxy-authorization` headers are not forwarded to plugins.

When plugin callback completion credits balance, PayIncus still credits by the original order `actualAmount`. The plugin-returned `actualAmount` is only used to verify that the user paid the payable amount. This supports fee-added and fee-deducted models while preventing plugins from arbitrarily changing the amount credited to the user. User active verification uses the same controlled model: `/api/recharge/orders/:orderNo/verify` calls the bound plugin `verifyPayment` hook. The plugin can only return normalized status, order number, transaction number, and paid amount. PayIncus still enforces order number match, amount match, expiration check, order status check, and idempotency before completing, failing, or cancelling the order. Admin manual sync also supports `plugin_gateway`; it calls the same `verifyPayment` hook as an admin and reuses payable amount validation, `payment_callbacks` idempotency, and internal completion/failure/cancellation state machines.

`plugin_gateway` original-channel refunds have an independent state machine. Admins create refund requests with `POST /api/admin/billing/recharge-records/:id/refunds`, or retry/sync an existing request with `POST /api/admin/billing/recharge-refunds/:id/retry`. PayIncus first creates a `RechargeRefundRequest`, then transitions `pending -> processing -> completed | failed | cancelled`. Before entering `processing`, it pre-deducts the user's balance. If the plugin `refund` returns `failed`/`cancelled` or dispatch fails, the pre-deducted balance is returned. Only after the plugin confirms `completed` does PayIncus record provider refund information and decide whether to mark the recharge record as `refunded` based on cumulative completed refund amount. Extensions can only return refund status, external refund number, message, and flat metadata. They cannot directly deduct balance, return balance, skip admin permissions, or bypass PayIncus idempotency keys, balance locks, amount caps, and audit logs.

## Public API And API Token

Third-party server-side extensions should integrate with PayIncus through the `/api/v1` Public API instead of internal frontend/admin endpoints. API tokens are created by logged-in users in PayIncus. A token is returned only once at creation time; the database stores only its SHA256 hash.

Management endpoints:

```text
GET /api/api-tokens
POST /api/api-tokens
DELETE /api/api-tokens/:id
```

Create request:

```json
{
  "name": "Flash Sale Backend",
  "scopes": ["profile:read", "profile:write", "balance:read", "balance:write", "billing:read", "products:read", "services:read", "services:operate", "services:billing", "orders:read", "tickets:read", "tickets:write", "notifications:read"],
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

First Public API endpoints:

```text
GET /api/v1/me
PATCH /api/v1/me
GET /api/v1/balance
GET /api/v1/balance/logs
GET /api/v1/balance/adjustment-requests
POST /api/v1/balance/adjustment-requests
GET /api/v1/billing-records
GET /api/v1/billing-records/:id
Authorization: Bearer pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`GET /api/v1/me` requires `profile:read`. Revoked tokens, expired tokens, banned users, and missing scopes return 401/403 and write security audit logs.

`PATCH /api/v1/me` requires `profile:write`. It currently only allows low-risk profile presentation field `avatarStyle`. It does not accept email, password, role, status, balance, 2FA, or any security setting. Successful updates write audit logs and trigger the `user.profile.updated` extension event.

```json
{
  "avatarStyle": "bigSmile"
}
```

`GET /api/v1/balance` requires `balance:read` and returns only the current token user's balance, currency, and update time. `GET /api/v1/balance/logs` uses the same scope and returns only that user's balance ledger. It supports `page`, `pageSize`, `sort = createdAt | -createdAt`, `type`, and `lotteryGift = exclude | only`. Responses only include safe ledger fields and instance names. They do not return user objects, balance adjustment request objects, payment provider payloads, hosted balance, AFF balance, or other users' data. These two endpoints do not expose top-up, deduction, refund, or direct adjustment.

`GET /api/v1/balance/adjustment-requests` and `POST /api/v1/balance/adjustment-requests` require `balance:write`. This scope does not mean direct balance write. It only lets the current token user submit pending balance adjustment requests for themselves and read requests they submitted through the Public API. The list supports `page`, `pageSize`, `sort = createdAt | -createdAt`, and `status = pending | approved | rejected`. Create requests only accept positive `amount`, `requestType = manual_adjust | refund`, a 10-500 character `reason`, and optional `orderNo`. The server fixes the internal audit source to `public_api`, binds it to the current token, fixes status to `pending`, and limits each user to at most 5 pending Public API requests. Public responses do not return token internal IDs, balance log IDs, payment provider payloads, or admin approval internals. This endpoint does not create top-up orders, call payment providers, write balance logs, or mutate balance. Real execution still requires admin approval.

`GET /api/v1/billing-records` and `GET /api/v1/billing-records/:id` require `billing:read` and only return the current token user's instance billing records. The list supports `page`, `pageSize`, `sort = createdAt | -createdAt`, `type = newPurchase | renew | upgrade | downgrade | refund | transfer_fee`, and `serviceId`. Details are isolated by current user. Responses only include billing ID, related public order ID, service summary, billing type, amount, months, cycle, note, and created time. They do not return balance log objects, payment callbacks, provider payloads, internal reconciliation data, or other users' bills.

First resource API:

```text
GET /api/v1/balance
GET /api/v1/balance/logs
GET /api/v1/balance/adjustment-requests
POST /api/v1/balance/adjustment-requests
GET /api/v1/billing-records
GET /api/v1/billing-records/:id
GET /api/v1/products
GET /api/v1/products/:id
GET /api/v1/services
GET /api/v1/services/:id
POST /api/v1/services/:id/actions
POST /api/v1/services/:id/renew
GET /api/v1/services/:id/tasks/:taskId
DELETE /api/v1/services/:id/tasks/:taskId
GET /api/v1/orders
GET /api/v1/orders/:id
GET /api/v1/tickets
POST /api/v1/tickets
GET /api/v1/tickets/:id
POST /api/v1/tickets/:id/replies
PATCH /api/v1/tickets/:id/status
GET /api/v1/notifications
GET /api/v1/notifications/unread-count
POST /api/v1/notifications
GET /api/v1/plugins
GET /api/v1/plugins/:pluginId/actions
POST /api/v1/plugins/:pluginId/actions/:action
```

`/products` requires `products:read` and only returns enabled product packages and enabled plans. Lists support `sort = createdAt | -createdAt`. `/services` requires `services:read` and only returns the current token user's service summaries. It supports allowlisted `status = creating | running | stopped | suspended | error | deleted`, `sort = displayOrder | -displayOrder | createdAt | -createdAt`, and controlled `include = product,plan`. Included products and plans only return summaries related to the current user's services. Responses never include root passwords, Incus IDs, host internal config, or privileged connection secrets. `POST /api/v1/services/:id/actions` requires `services:operate` and only lets the current token user queue `start`, `stop`, or `restart` tasks for their own service. It does not call Incus directly and does not expose create, suspend, unsuspend, rebuild, delete, migrate, host operations, or resource delivery. Services that are suspended, deleted, transferring, backing up/restoring/uploading, or already have an instance task are rejected. `POST /api/v1/services/:id/renew` requires `services:billing` and only lets the current token user renew their own paid service. It reuses the PayIncus internal renewal transaction for balance lock, balance deduction, billing record, AFF discount, hosted node renewal restrictions, hosted income, and expiration suspend/unblock. It does not accept arbitrary amounts, create top-up orders, expose direct balance deduction, or expose create/rebuild/delete/migrate/host operations. `GET /api/v1/services/:id/tasks/:taskId` also requires `services:operate` and only returns status and queue position for the current token user's `start`, `stop`, or `restart` tasks. It does not expose rebuild, clone, migration, deletion, or admin delivery tasks. `DELETE /api/v1/services/:id/tasks/:taskId` only cancels public power tasks still in `PENDING`. Tasks already `PROCESSING`, `COMPLETED`, or `FAILED` cannot be cancelled. `/orders` requires `orders:read` and only returns the current token user's top-up and instance billing records. It supports allowlisted `status = pending | completed | failed | cancelled | refunded` and `sort = createdAt | -createdAt`. `GET /api/v1/orders/:id` reads one current-user public order whose ID is shaped like `recharge:123` or `instance_billing:456`. Order endpoints do not return payment callback data, provider config snapshots, raw query results, or full transaction numbers. `/tickets` requires `tickets:read` and only returns the current token user's tickets, messages, and safe attachment metadata. It supports allowlisted `status`, `category`, `priority`, and `sort = updatedAt | -updatedAt | createdAt | -createdAt`, and never returns internal notes or storage provider file IDs. `PATCH /api/v1/tickets/:id/status` requires `tickets:write` and only lets the current token user close their own ticket or reopen their own closed ticket. Body only accepts `action = close | reopen`; it does not accept arbitrary status, priority, category, internal note, assignee, or cross-user state changes.

Public API write endpoints have independent rate limits: balance adjustment requests 5 per 10 minutes, service power task queueing 10 per minute, service renewal 5 per 10 minutes, service task polling 120 per minute, pending task cancellation 10 per minute, ticket creation 10 per 5 minutes, ticket replies and status changes 20 per minute, self-notification/template notification 20 per minute, and extension action dispatch 30 per minute. Extension action dispatch also has database-persisted dynamic quotas by token + extension + action: `rateLimit = normal` defaults to 30 per minute, and `rateLimit = strict` defaults to 10 per minute. The admin Extension Center can configure global policies, per-extension policies, or per-extension-action policies. The same token, extension, and action share the count window across multiple backend instances. Exceeding quota returns `PUBLIC_PLUGIN_ACTION_RATE_LIMITED` and `Retry-After`, and does not call the webhook. Rate limit hits return `429 TooManyRequests` and never enter payment, balance, instance task, notification, or extension webhook execution chains.

Service action request body:

```json
{
  "action": "restart"
}
```

Success returns 202 and a platform task summary:

```json
{
  "data": {
    "serviceId": 123,
    "action": "restart",
    "taskId": 456,
    "taskType": "restart",
    "status": "PENDING"
  }
}
```

Poll task status:

```text
GET /api/v1/services/123/tasks/456
```

Response only includes public task fields:

```json
{
  "data": {
    "id": 456,
    "serviceId": 123,
    "taskType": "restart",
    "status": "PROCESSING",
    "progress": "starting",
    "error": null,
    "queuePosition": 0,
    "createdAt": "2026-06-26T08:00:00.000Z",
    "startedAt": "2026-06-26T08:00:03.000Z",
    "finishedAt": null
  }
}
```

If the task is still waiting in the queue, it can be cancelled:

```text
DELETE /api/v1/services/123/tasks/456
```

A successful cancellation returns the same public task object with `status = FAILED` and an error marked as user-cancelled. Cancellation does not stop already started tasks and does not touch rebuild, clone, migration, delete, or admin delivery tasks.

`POST /api/v1/tickets` requires `tickets:write` and only lets the current token user create a public ticket for themselves. JSON requests create text tickets; `multipart/form-data` can upload up to 6 image attachments through the `images` field, each up to 50MB. Supported formats are JPG, PNG, WebP, GIF, and AVIF. The endpoint does not accept internal notes, status override, target user override, admin fields, arbitrary files, or storage provider file IDs. If `instanceId` is provided, the instance must belong to the current token user. The server reuses ticket notification and `ticket.created` event chains, and writes audit logs.

```json
{
  "subject": "Flash sale order question",
  "category": "billing",
  "priority": "normal",
  "content": "I need to confirm the payment status of this flash sale order.",
  "instanceId": 123
}
```

`POST /api/v1/tickets/:id/replies` requires `tickets:write` and only lets the current token user add public replies to their own open tickets. JSON requests create text replies; `multipart/form-data` can upload up to 6 image attachments through the `images` field, each up to 50MB. Supported formats are JPG, PNG, WebP, GIF, and AVIF. The endpoint does not accept internal notes, status changes, target user override, arbitrary notification sends, arbitrary files, or storage provider file IDs. The server reuses ticket notification and `ticket.replied` event chains, and writes audit logs.

`GET /api/v1/notifications` and `GET /api/v1/notifications/unread-count` require `notifications:read` and only read the current token user's in-app messages and unread count. Lists support `page`, `pageSize`, `sort = createdAt | -createdAt`, and `isRead = true | false`. Responses only include `eventType`, title, message, read status, and created time. They do not return notification channel config, external send logs, raw event `data` payload, broadcast targets, or other users' messages.

`POST /api/v1/notifications` requires `notifications:send` and only sends short text notifications to the current token user. It creates an in-app message and reuses the user's enabled external notification channels and `notification.sent` event chain. The request can pass `title`/`message` directly, use platform allowlisted templates `flash_sale_reminder`, `service_action_update`, `billing_notice`, or use enabled extension-declared templates `plugin:<pluginId>:<templateId>`. Template variables are limited to 10 scalar values; keys must use identifier format, and each variable is up to 120 characters. Extension templates must come from enabled extensions' `capabilities.notificationTemplates`, the manifest must declare `notifications:send`, and template content only allows plain-text `{{variable}}` placeholders. The endpoint does not accept `userId`, broadcast, arbitrary channel selection, arbitrary HTML, undeclared templates, internal event type override, or admin notification.

Extensions can declare controlled notification templates:

```json
{
  "permissions": ["notifications:send"],
  "capabilities": {
    "notificationTemplates": [
      {
        "id": "reservation_reminder",
        "title": "Flash sale reservation reminder",
        "message": "Campaign {{campaignName}} starts at {{startsAt}}.",
        "variables": ["campaignName", "startsAt"]
      }
    ]
  }
}
```

Public API call:

```json
{
  "template": "plugin:com.example.flash-sale:reservation_reminder",
  "variables": {
    "campaignName": "Summer Flash Sale",
    "startsAt": "20:00"
  },
  "source": "Flash Sale Extension"
}
```

Plain request body:

```json
{
  "title": "Flash sale reminder",
  "message": "Your reserved campaign is about to start.",
  "source": "Flash Sale Extension"
}
```

Template request example:

```json
{
  "template": "flash_sale_reminder",
  "variables": {
    "campaignName": "Summer Flash Sale",
    "startsAt": "20:00",
    "productName": "LXC 4G Plan"
  },
  "source": "Flash Sale Extension"
}
```

`GET /api/v1/plugins` and `GET /api/v1/plugins/:pluginId/actions` require `plugins:action` and only return public webhook action contracts from enabled extensions, for third-party server discovery. Returned fields include extension ID, name, version, public action count, action name, method, path, scope, idempotency policy, rate limit policy, requestSchema, and responseSchema. The endpoints do not return webhook URLs, secrets, extension config values, service extension hooks, or gateway extension hooks.

`POST /api/v1/plugins/:pluginId/actions/:action` requires `plugins:action` and lets a third-party server trigger a declared webhook action on an enabled extension through an API token. This entrypoint does not bypass the manifest. The extension must declare the action, use `runtime = webhook`, provide an HTTPS URL, and grant `plugin-action:run` plus all scopes declared by that action. Execution still goes through SSRF validation, HMAC signature, timeout, payload size limits, and extension event audit.

Public action dispatch first checks manifest permissions, then enforces dynamic quota by token + extension + action: `normal` defaults to 30 per minute and `strict` defaults to 10 per minute. Dynamic quotas are stored in `public_plugin_action_rate_limit_buckets`, so multiple instances sharing the same database share the same window. Admin policies are stored in `public_plugin_action_rate_limit_policies`; precedence is extension + action, then extension all actions, then global `*`. Exceeding quota returns `429`, `PUBLIC_PLUGIN_ACTION_RATE_LIMITED`, and `Retry-After`, without calling the extension webhook.

Request body:

```json
{
  "idempotencyKey": "flash-sale-123-user-456",
  "payload": {
    "campaignId": "flash-sale-123",
    "sku": "plan-basic"
  }
}
```

The actor is always the current token user. The first version does not allow targeting other users, directly mutating order/payment/balance/instance state, or replacing the controlled lifecycle entrypoints for service extensions and payment gateway extensions.

Machine-readable API contract:

```text
GET /api/v1/openapi.json
GET /api/v1/openapi.yaml
```

The current OpenAPI 3.1 document is available as JSON and YAML from the same contract. It covers `/api/v1/me` read and low-risk avatar profile write, balance and balance ledger read models, products, services, orders, tickets, notification read resources, controlled ticket create/reply write APIs, self-notification send API, and API token management. Note that API token management paths are actually `/api/api-tokens` because they rely on the logged-in user's PayIncus session JWT; public business resource APIs are under `/api/v1/*`.

First Public API TypeScript SDK:

```text
GET https://payincus.com/sdk/payincus-public-api.ts
GET https://payincus.com/sdk/examples/service-power-task.ts
GET https://payincus.com/sdk/examples/service-renew.ts
GET https://payincus.com/sdk/examples/flash-sale-action.ts
GET https://payincus.com/sdk/examples/balance-adjustment-request.ts
GET https://payincus.com/sdk/examples/billing-records.ts
GET https://payincus.com/sdk/examples/oauth-authorization-code.ts
```

SDK documentation page:

```text
https://payincus.com/plugins/sdk
```

Current scope allowlist:

- `profile:read`
- `profile:write`
- `balance:read`
- `balance:write`
- `billing:read`
- `products:read`
- `services:read`
- `services:operate`
- `services:billing`
- `orders:read`
- `tickets:read`
- `tickets:write`
- `notifications:read`
- `notifications:send`
- `plugins:action`

`profile:write` maps to controlled low-risk avatar profile updates and only allows `avatarStyle`. `balance:read` maps to current-user balance and balance ledger read APIs, without top-up, deduction, refund, or adjustment. `balance:write` maps to current-user pending balance adjustment request creation and list reading; it always enters admin approval and never writes balances, balance logs, payments, or top-up orders directly. `billing:read` maps to current-user instance billing record list and detail reads, without balance log objects, payment callbacks, provider payloads, internal reconciliation data, or other users' bills. `products:read`, `services:read`, `orders:read`, and `tickets:read` map to read-only `/api/v1` resources. Services, orders, and tickets already support allowlisted safe filters. Orders support current-user single detail reads. Services support allowlisted `include=product,plan`. `services:operate` maps to controlled service power task queueing, status polling, and pending task cancellation for the current user's services, limited to `start`, `stop`, and `restart`; it does not expose create, suspend, unsuspend, rebuild, delete, migrate, or resource delivery. `services:billing` maps to controlled service renewal for the current token user's own paid services, reusing internal renewal transactions and not accepting arbitrary amounts or direct balance deduction. `tickets:write` maps to controlled ticket creation, public replies, image attachments, closing own tickets, and reopening own closed tickets. `notifications:read` maps to current-user in-app messages and unread count, without channel config, send logs, or raw event payload. `notifications:send` maps to controlled self-notification, platform allowlisted templates, and enabled extension-declared templates. `plugins:action` maps to controlled extension action dispatch. No scope allows bypassing internal payment, balance, instance delivery, fraud control, or audit logic.

Scope metadata catalog:

```text
GET /api/oauth-provider/scopes
```

This endpoint is the canonical scope catalog shared by the OAuth consent page, admin OAuth App config page, OpenAPI, and Public API SDK. Each scope returns:

- `scope`
- `title`
- `description`
- `risk = low | medium | high`
- `access = read | write | operate`
- `resources`
- `implemented`
- `notes`

The consent endpoint `GET /api/oauth-provider/authorize/consent` also returns `scopeMetadata`. Third-party developer docs and frontend/admin UI should not hard-code scope descriptions anymore. `resources` only describes currently covered public resource paths for the scope. It does not mean access to admin APIs, payment callbacks, provider payloads, internal audits, or cross-user data.

## High-Risk Public API Boundaries

The following capabilities are intentionally not omissions and cannot be bypassed through `plugins:action`, OAuth scopes, or SDK examples. They stay inside PayIncus internal state machines, backend review flows, or admin session APIs by default:

- Direct balance top-up, deduction, refund, approval, or adjustment that bypasses approval.
- Payment creation, payment callback handling, active verification, refund execution, or provider payload reading.
- Service creation, suspend, unsuspend, rebuild, delete, migration, resource delivery, or host operations.
- Sensitive user profile changes such as email, password, 2FA, role, status, and bans.
- Ticket internal notes, assignee changes, arbitrary status transitions, or cross-user ticket writes.
- Broadcast notifications, arbitrary notification channel selection, HTML notifications, or undeclared template sending.
- Extension install, enable, disable, uninstall, market publishing, or theme enablement.

If any of these capabilities are opened under `/api/v1` later, they must first gain a public resource design, independent scope, scope metadata, OpenAPI contract, SDK method, audit log, rate limit, idempotency, cross-user protection, state-machine rollback, and production proof. Until those gates are complete, third-party extensions can only participate through opened controlled actions, events, and current-token-user resource APIs.

## OAuth Provider

PayIncus can act as an OAuth Provider and issue access tokens and refresh tokens to third-party applications. Admins create OAuth Apps on the OAuth settings page. Client Secret is shown only once, and the database stores only its SHA256 hash.

Admin management endpoints:

```text
GET /api/admin/oauth-apps
POST /api/admin/oauth-apps
PUT /api/admin/oauth-apps/:id
POST /api/admin/oauth-apps/:id/rotate-secret
DELETE /api/admin/oauth-apps/:id
GET /api/admin/oauth-apps/authorizations?appId=&user=&status=active&page=1&pageSize=20
DELETE /api/admin/oauth-apps/authorizations/:id
```

The admin authorization audit endpoint is admin-only. Filters support `appId`, `user` (fuzzy search by user ID, username, or email), `status = all | active | revoked | disabled`, `page`, and `pageSize`. Responses only include app, user, scope, authorized time, revoked time, and active access/refresh token counts. They do not return token hashes, client secrets, or authorization codes.

Browser authorization entry:

```text
GET /oauth/authorize?response_type=code&client_id=pocli_xxxxx&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&scope=profile%3Aread%20products%3Aread%20services%3Aread&state=opaque-state
```

After the user confirms authorization, PayIncus redirects back to `redirect_uri` with `code` and original `state`. If the user denies authorization, PayIncus redirects back with `error=access_denied`.

Consent endpoints called by the user portal:

```text
GET /api/oauth-provider/authorize/consent
POST /api/oauth-provider/authorize/confirm
```

When an existing authorization covers the requested scopes, the server can create an authorization code through the session API directly. If confirmation is missing, it returns `OAUTH_CONSENT_REQUIRED`.

```text
POST /api/oauth-provider/authorize
```

Confirm request example:

```json
{
  "responseType": "code",
  "clientId": "pocli_xxxxx",
  "redirectUri": "https://example.com/oauth/callback",
  "scope": "profile:read products:read services:read",
  "state": "opaque-state",
  "confirmed": true
}
```

Third-party backend exchanges the authorization code for tokens:

```text
POST /api/oauth-provider/token
```

```json
{
  "grantType": "authorization_code",
  "clientId": "pocli_xxxxx",
  "clientSecret": "posec_xxxxx",
  "code": "poc_xxxxx",
  "redirectUri": "https://example.com/oauth/callback"
}
```

Returned `access_token` values use the `poa_` prefix and can call `/api/v1/me` as Bearer tokens:

```text
GET /api/v1/me
Authorization: Bearer poa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Returned `refresh_token` values use the `por_` prefix. Third-party backends must send client credentials when refreshing. PayIncus rotates refresh tokens, and the old refresh token becomes invalid immediately:

```json
{
  "grantType": "refresh_token",
  "clientId": "pocli_xxxxx",
  "clientSecret": "posec_xxxxx",
  "refreshToken": "por_xxxxx"
}
```

User authorization record endpoints:

```text
GET /api/oauth-provider/authorizations
DELETE /api/oauth-provider/authorizations/:id
```

Revoking an authorization also revokes all OAuth access tokens and refresh tokens under that authorization.

Revoke endpoint:

```text
POST /api/oauth-provider/revoke
```

OAuth access tokens enforce app enabled status, token expiry, revocation, user status, and scope checks. OAuth refresh tokens only store SHA256 hashes and are rotated on refresh. OAuth scopes do not open high-risk resource writes.

## Event Subscriptions

The manifest can declare event subscriptions:

```json
{
  "capabilities": {
    "events": [
      {
        "event": "payment.failed",
        "handler": "releaseStock"
      }
    ]
  }
}
```

The event handler must point to an action declared in the same manifest. The current runtime already provides an event dispatcher and webhook delivery capability. Extension install/enable/disable/uninstall lifecycle, orders, payments, services, service tasks, resource rollback, notifications, tickets, and user lifecycle have been connected in the first batch. More business points will be connected gradually.

## Business Events

Business events currently connected to the dispatcher:

- `plugin.installed`: fired after a super admin private upload or marketplace install completes. The target extension is disabled by default after installation, so this event is mainly for other enabled extensions to run governance, audit, or sync.
- `plugin.enabled`: fired after an extension is enabled; the target extension and other enabled subscribers can receive it.
- `plugin.disabled`: fired before disabling an extension. The target extension is still enabled and can do external cleanup. Failure does not block disabling.
- `plugin.uninstalled`: fired before uninstalling an extension. The target extension is still enabled and can do external cleanup. Failure does not block uninstalling.
- `order.created`: fired after a top-up order is created.
- `order.paid`: fired after a top-up order is credited, only when the state machine really completes this time.
- `payment.failed`: fired after top-up payment fails, only when the state actually transitions to failed.
- `service.provisioned`: fired after instance delivery succeeds and becomes available.
- `service.suspended`: fired after an instance is manually suspended, batch suspended, or suspended on expiration.
- `service.unsuspended`: fired after an instance is manually or batch unsuspended.
- `service.deleted`: fired after an instance is deleted by a user, admin, host owner, or expiration cleanup.
- `service.task.queued`: fired after the Public API or instance detail page successfully queues a controlled service task, covering `start`, `stop`, `restart`, `rebuild`, `clone`, `recreate`, and `change_host`.
- `service.task.cancelled`: fired after the Public API or instance detail page successfully cancels a pending service task.
- `service.task.completed`: fired after the instance task worker completes a controlled service task, covering public power tasks and admin rebuild, clone, recreate, migration, and similar tasks.
- `service.task.failed`: fired after the instance task worker or timeout cleanup marks a controlled service task failed. It does not include raw provider error text.
- `service.resource.rollback.completed`: fired after platform successfully releases pre-reserved host resources after instance delivery failure.
- `service.resource.rollback.failed`: fired after platform fails to release pre-reserved host resources after instance delivery failure. It only includes a generalized failure class, not raw provider or database error text.
- `ticket.created`: fired after a user ticket is created.
- `ticket.replied`: fired after a user, host owner, or admin replies to a ticket.
- `ticket.status.changed`: fired after the Public API or controlled platform flow changes ticket status. It only includes previous and next status, not internal notes or assignees.
- `user.registered`: fired after successful user registration.
- `user.login`: fired after successful user login.
- `user.profile.updated`: fired after user profile fields are updated. It only includes field names, not old or new values.
- `user.status.changed`: fired after an admin bans or unbans a user. It only includes status and whether a reason was filled, not the reason body.
- `notification.sent`: fired after the in-app/external notification send flow completes. It only includes event type, user ID, and send counts, not notification content.

Event payloads include the minimum necessary context such as business object IDs, current user, amount, status, ticket subject, attachment count, service status, service task ID, task type, task status, resource rollback result, user lifecycle status, or notification send counts. Extension lifecycle payloads only include `pluginId`, `version`, `sourceType`, `sourceRepo`, `occurredAt`, and dedupe metadata. They do not include install paths, package files, config values, secrets, download keys, or webhook URLs. Service task and resource rollback events do not include root passwords, Incus IDs, host internal config, privileged connection secrets, or raw provider responses. Failure events only return generalized failure classes, not low-level error bodies. User lifecycle events do not include email, IP, User-Agent, password, verification code, or sensitive field values. Extension lifecycle event delivery failure does not roll back extension install, enable, disable, or uninstall. Business event delivery failure does not roll back payment credit, order status, instance status, service task status, resource rollback result, user profile update, notification send, or ticket reply. Failures enter extension event logs, automatically retry with backoff as `retry_pending`, and eventually enter `dead_letter` after repeated failures.

The platform supports controlled event deduplication. Events with stable business IDs, such as orders and tickets, carry `dedupeKey`. The same extension, event name, handler, and `dedupeKey` first write a unique dedupe lock into the database. If an existing successful, retry-pending, dead-letter, or in-delivery record exists, later duplicate delivery is skipped and logged as `duplicate_skipped`; no third-party webhook is called again. In-delivery locks have a 30-minute takeover window to avoid permanent blocking after process crashes. Extension developers can also provide a stable dedupe key in custom event payload or `metadata.dedupeKey`. Do not use current time, random numbers, or one-off request IDs as dedupe keys.

The Extension Center "Event Delivery" page can filter logs by extension, event name, handler, and delivery result. It shows matched events, success, pending retry, due retry, deduped, and dead-letter counts. Logs show `dedupeKey`, last attempt time, next retry time, dead-letter time, and last error. Admins can process due retries or manually replay one replayable event. Manual replay also updates dedupe lock state, so later duplicate events still dedupe by the final delivery state.

## Marketplace Submission

After development, third-party developers should not give `.tar.gz` packages directly to production admins for override installs. Standard marketplace review should submit:

- GitHub repository URL.
- GitHub Release artifact download URL.
- `payincus.plugin.json` manifest URL.
- SHA256 for the extension `.tar.gz`.
- Developer name, homepage, GitHub, contact email, and verification information.
- Feature description, screenshots, permission explanation, compatible PayIncus version, update notes, and rollback notes.
- Whether it is free, paid, license-restricted, or depends on external services.
- Whether it touches orders, payments, balances, instance delivery, tickets, notifications, authentication, fraud controls, or file uploads.

Before approval, marketplace entries should remain `pending` and should not appear in the default marketplace list. Only after approval and `listed` status can admins install from the Extension Marketplace. Rejected or delisted entries use `rejected` or `delisted`.

Local admin `.tar.gz` upload is a super-admin private install channel for self-use and internal testing. It does not mean the extension passed public marketplace review.

## Submission Review API

Third-party extension submissions enter the PayIncus review queue and do not directly write the public marketplace directory. Developers can upload a `.tar.gz` package to the platform first, letting PayIncus validate package structure, parse `payincus.plugin.json`, calculate SHA256, and generate a pending-review download URL. They can also publish the package to an HTTPS download source such as GitHub Release artifact, object storage, or a docs-site pending-review path, then submit metadata and SHA256.

Developer endpoints:

```text
POST /api/plugin-market-submissions/upload-package
GET /api/plugin-market-submissions/uploads/plugins/:filename
POST /api/plugin-market-submissions
GET /api/plugin-market-submissions/mine
GET /api/plugin-market-submissions/mine/event-health
```

The upload endpoint uses `multipart/form-data`, with file field `package`, and only accepts `.tar.gz` extension packages containing `payincus.plugin.json`. Successful upload returns `pluginId`, `version`, `name`, `manifestUrl`, `packageUrl`, `sha256`, `permissions`, and `compatibility`; the frontend submission form fills these fields automatically. Production should configure `PLUGIN_SUBMISSION_PUBLIC_BASE_URL`, or ensure `SITE_URL` / `FRONTEND_URL` is HTTPS, so the scanner can download pending-review packages.

Submission body example:

```json
{
  "pluginId": "com.example.flash-sale",
  "version": "1.0.0",
  "name": "Flash Sale",
  "repoUrl": "https://github.com/example/payincus-flash-sale",
  "releaseUrl": "https://github.com/example/payincus-flash-sale/releases/tag/v1.0.0",
  "manifestUrl": "https://github.com/example/payincus-flash-sale/releases/download/v1.0.0/payincus.plugin.json",
  "packageUrl": "https://github.com/example/payincus-flash-sale/releases/download/v1.0.0/plugin.tar.gz",
  "sha256": "64-character-sha256",
  "developerName": "Example",
  "developerHomepage": "https://example.com",
  "developerGithub": "https://github.com/example",
  "contactEmail": "plugins@example.com",
  "permissions": {
    "api": ["orders:read"],
    "events": ["order.paid"]
  },
  "compatibility": {
    "minPayincus": "0.6.0"
  },
  "pricing": {
    "type": "free"
  },
  "notes": "First public review."
}
```

`GET /api/plugin-market-submissions/mine/event-health` only returns aggregated event delivery health for plugin IDs submitted by the current logged-in user. It does not return payloads, actors, raw logs, or replay capability. Returned fields include plugin-level success, failure, pending retry, dead letter, dedupe, due retry, last 24-hour total, last 24-hour success rate, last 7-day trend, read-only warning hints, last event time, last success time, last failure time, and last error. It also provides read-only `breakdown` details by `eventName + handler`; each detail includes the same recent 24-hour window metrics and read-only warning hints so developers can judge webhook stability. Warning hints mark dead letters, due retries, recent dead letters, recent pending retries, recent failures, and recent success rate below 95%. This is only developer-visible read-only health. It does not expose event payloads and does not provide replay capability.

After processing due retries, the event retry scheduler scans extension events still in `dead_letter`, `retry_pending`, or below recent success-rate thresholds, then sends a `plugin_event_delivery_alert` notification to the developer user from the latest submission record for that extension. Notifications reuse PayIncus in-app messages and the user's enabled external notification channels. They do not open arbitrary alert webhook subscription URLs. Notification content only includes extension ID, dead-letter count, due retry count, recent failure count, and recent `eventName -> handler`. It never includes event payloads, actors, raw error bodies, webhook URLs, secrets, or extension config values. The first admin critical escalation version alerts all active admins through the same notification type when dead letters or due retries exist, and uses an independent `plugin.event.alert_escalate` log cooldown. This prevents platform operations from going blind if a developer disables alerts or there is no submitter. After fixing a webhook, an admin must manually replay from the Event Delivery page or wait for automatic retry.

Developers can maintain event alert preferences for extensions they submitted:

```text
GET /api/plugin-market-submissions/mine/event-alert-preferences
PATCH /api/plugin-market-submissions/mine/event-alert-preferences/:pluginId
```

Preferences can only be changed by the logged-in user for plugin IDs they submitted. Configurable fields are `enabled`, `minimumLevel = warning | critical`, `cooldownMinutes = 15..1440`, `notifyOnDeadLetter`, `notifyOnDueRetry`, `notifyOnSuccessRateBelow`, `successRateThreshold = 50..100`, and `recentWindowHours = 1..168`. Default policy enables alerts, warning and above, 360-minute cooldown, and watches dead letters, due retries, and success rate below 95% in the last 24 hours. This is only the first subscription/escalation strategy version. It does not store third-party alert URLs or secrets.

Admin review endpoints:

```text
GET /api/plugin-market-submissions/admin?reviewStatus=pending
POST /api/plugin-market-submissions/admin/:id/scan
PATCH /api/plugin-market-submissions/admin/:id/review
POST /api/plugin-market-submissions/admin/publish-market-index
```

Review body:

```json
{
  "reviewStatus": "listed",
  "riskLevel": "medium",
  "reviewNotes": "Manifest, SHA256 and permission statement checked."
}
```

Review statuses:

- `pending`: waiting for review.
- `listed`: approved and eligible for the public marketplace directory.
- `rejected`: rejected.
- `delisted`: delisted.

After approval, entries still need to be published to the docs-site marketplace directory by generating or updating `plugin-market/index.json`, manifest files, and download-source references. The first version already provides review queue, audit records, developer center submission UI, admin review UI, automatic scanner, and docs-site marketplace index publisher. Final acceptance should still verify the stable docs-site path and the admin Extension Marketplace read surface.

Automatic scanning is triggered by admins in the review backend. It checks:

- Manifest URL and package URL must be public HTTPS URLs; private networks, reserved IPs, and local domains are forbidden.
- Download size cannot exceed `PLUGIN_MAX_PACKAGE_SIZE_MB`.
- Package SHA256 must match the submitted value.
- `.tar.gz` cannot contain absolute paths, parent-directory paths, backslash paths, hard links, or symlinks.
- Package must contain `payincus.plugin.json`, and entry files and template paths must exist.
- Manifest URL content must match the manifest inside the package.
- Scanner estimates risk level from permissions, webhook actions, event subscriptions, and storage declarations.

Scan failure does not automatically reject a submission, but it records `scanStatus`, `scanResult`, `riskLevel`, and audit logs. Reviewers should prioritize failed scans and high-risk submissions.

Publishing the marketplace directory generates `plugin-market/index.json`:

- Only submissions with `reviewStatus = listed` and `scanStatus = passed` or `warning` are published.
- Existing official entries in the marketplace index are retained.
- A reviewed submission with the same extension ID overrides the old entry, which is how new versions are published.
- Output directory is controlled by `PLUGIN_MARKET_PUBLISH_DIR`.
- Public URL prefix is controlled by `PLUGIN_MARKET_PUBLIC_BASE_URL`.
- On the server, `pnpm --filter server publish:plugin-market-index` can also generate the marketplace index.

## Current Runtime Boundaries

The current extension runtime only supports controlled pages, config, and official reserved APIs. Third-party extensions cannot:

- Execute shell scripts from extension packages.
- Load arbitrary backend code into the PayIncus main process.
- Connect directly to the production database and write internal tables.
- Access `/api/admin/*` from user-facing extensions.
- Bypass order, payment, instance delivery, ticket, or permission checks.
- Inject unauthorized remote scripts through themes or page extensions.

Extensions that need to participate in PayIncus internal business flows such as orders, payments, inventory, instances, tickets, notifications, and similar areas must enter through opened `/api/v1` controlled resources, extension actions, event subscriptions, service/payment lifecycle hooks, and plugin storage. Current API token/OAuth scopes already open low-risk profile writes, pending balance adjustment requests, controlled service power tasks, controlled service renewal, ticket creation/reply/status operations, self-notifications, and extension action dispatch. These APIs are constrained to the current token user, enabled extensions, or PayIncus internal state machines. Direct payment creation/callback/refund, direct balance writes, service create/delete/migration, sensitive user profile changes, and extension/theme management remain closed through the Public API.

## Platform 2.0 Development Standard

A complete third-party feature extension should satisfy these standards:

- Use the `/api/v1` Public API and avoid internal frontend/admin endpoints.
- Use API tokens and declare the minimum required scopes.
- Declare actions, event subscriptions, storage needs, and UI extension points in the manifest.
- Backend actions provide request schema, response schema, idempotency-key strategy, rate-limit strategy, and error codes.
- All high-risk operations enter audit logs.
- Create orders, deduct funds, deliver resources, send notifications, and write tickets through platform SDK/API rather than writing internal tables directly.
- Store extension-private data in platform-provided extension storage and do not mix data with other extensions.

Example: a flash-sale extension should declare an admin settings page, user campaign page, private campaign/inventory storage, order creation action, payment event subscription, inventory release event, and notification permissions. Inventory deduction must run inside the extension backend action transaction and use idempotency keys to avoid duplicate purchases.

## Theme Development Standard

Themes are not ordinary page extensions. A real theme package should contain:

```text
payincus.theme.json
README.md
dist/
  theme.css
  assets/
templates/
  public/
  user/
  admin/
```

Theme packages should declare:

- Theme ID, name, version, and PayIncus compatibility range.
- Design tokens: colors, fonts, radius, spacing, shadows, state colors, and brand assets.
- Coverage: public pages, user shell, admin shell, marketplace page, login/register pages, and similar surfaces.
- Preview screenshots and rollback notes.
- Static asset paths and SHA256 validation.

Minimal `payincus.theme.json` example:

```json
{
  "id": "com.example.theme.clean",
  "name": "Clean Theme",
  "version": "1.0.0",
  "payincus": ">=0.6.0",
  "description": "A clean PayIncus theme.",
  "author": "Example Studio",
  "css": "dist/theme.css",
  "previewImage": "dist/assets/preview.png",
  "tokens": {
    "colorPrimary": "#111827",
    "radius": "8px"
  },
  "layoutSlots": [
    "public.home.hero",
    "public.home.sections",
    "public.market.banner",
    "public.auth.aside",
    "user.shell.brand",
    "user.dashboard.banner",
    "user.dashboard.cards",
    "user.instance.detail.extra",
    "user.wallet.banner",
    "user.tickets.banner",
    "user.extensions.banner",
    "user.orders.banner",
    "user.profile.banner",
    "user.invites.banner",
    "user.hosts.banner",
    "user.host.create.banner",
    "admin.shell.brand",
    "admin.extensions.header",
    "admin.extensions.market.banner",
    "admin.extensions.theme.banner",
    "admin.dashboard.banner",
    "admin.dashboard.widgets",
    "shared.footer"
  ],
  "templates": [
    {
      "slot": "public.home.hero",
      "title": "Homepage hero",
      "entry": "templates/public/home-hero.html"
    },
    {
      "slot": "public.market.banner",
      "title": "Market banner",
      "entry": "templates/public/market-banner.html"
    },
    {
      "slot": "public.auth.aside",
      "title": "Auth page aside",
      "entry": "templates/public/auth-aside.html"
    },
    {
      "slot": "user.shell.brand",
      "title": "User sidebar brand",
      "entry": "templates/user/shell-brand.html"
    }
  ],
  "configSchema": {
    "brandColor": {
      "type": "color",
      "label": "Brand color",
      "group": "Brand",
      "order": 10,
      "default": "#111827"
    },
    "homepageVariant": {
      "type": "select",
      "label": "Homepage style",
      "group": "Homepage",
      "order": 20,
      "default": "compact",
      "options": [
        { "label": "Compact", "value": "compact" },
        { "label": "Showcase", "value": "showcase" }
      ]
    }
  }
}
```

Theme management endpoints:

```text
GET /api/admin/themes
POST /api/admin/themes/upload
POST /api/admin/themes/:themeId/enable
PUT /api/admin/themes/:themeId/config
POST /api/admin/themes/default
DELETE /api/admin/themes/:themeId
```

User-side loading endpoints:

```text
GET /api/themes/active
GET /api/themes/assets/:themeId/:version/*
GET /api/themes/preview/:themeId
```

Theme config forms are declared by `configSchema`. Current supported fields are `text`, `textarea`, `markdown`, `password`, `email`, `number`, `select`, `tags`, `checkbox`, `color`, `file`, and `placeholder`. Fields can declare `group` and `order`; admin theme config renders them by group and order. `type = file` theme fields show controlled image upload. The first version only allows PNG, JPEG, and WebP images up to 2MB each. Files are written to `THEME_DATA_DIR/config-files`, and config values can only store platform-returned `/api/themes/:themeId/config-files/:key/:filename` URLs. User-side reads only expose files for the currently enabled theme when the manifest field is still `file` and the current config value matches the file. Admin-saved config values are written to `configValues` and returned to the frontend by `/api/themes/active`; upgrading the same `themeId` keeps existing config values. Every admin theme config save writes a `theme.config_update` audit log. The log only records changed, added, updated, removed, secret, and file key summaries. Config values are always redacted as `values=redacted`; theme config values, file URLs, and secrets are never written into the log.

Controlled HTML template fragments are declared by `templates`. `slot` must be from the platform allowlist, and `entry` must be an in-package `.html` fragment. The server reads fragments and blocks `<script>`, `iframe`, `form`, input controls, inline event attributes, `javascript:`, and remote URLs. After a theme is enabled, `GET /api/themes/active` returns `templateUrls`, and the frontend can fetch controlled fragments by slot.

Themes can only change appearance through CSS variables, controlled template slots, local static assets, and controlled config values. They cannot inject unauthorized remote scripts or change login, payment, permission, fraud-control, or resource-delivery logic. The current first version supports theme package upload, theme marketplace install, theme submission review/scanning/publisher, CSS asset validation, preview, enable, rollback, config forms, and controlled template fragments. Public homepage, package marketplace, auth page, user/admin shell branding, user dashboard, instance detail, wallet, tickets, extensions, orders, profile, invites, host list, host create, admin Extension Center, admin statistics, admin billing, payment providers, OAuth Provider, and shared footer already render controlled theme slots: `public.home.hero`, `public.home.sections`, `public.market.banner`, `public.auth.aside`, `user.shell.brand`, `user.dashboard.banner`, `user.dashboard.cards`, `user.instance.detail.extra`, `user.wallet.banner`, `user.tickets.banner`, `user.extensions.banner`, `user.orders.banner`, `user.profile.banner`, `user.invites.banner`, `user.hosts.banner`, `user.host.create.banner`, `admin.shell.brand`, `admin.extensions.header`, `admin.extensions.market.banner`, `admin.extensions.theme.banner`, `admin.dashboard.banner`, `admin.dashboard.widgets`, `admin.billing.banner`, `admin.payment.providers.banner`, `admin.oauth.banner`, and `shared.footer`.

Production can configure a stable online theme marketplace:

```env
THEME_MARKET_INDEX_URL=https://payincus.com/theme-market/index.json
THEME_MARKET_TRUSTED_HOSTS=payincus.com,payincus.github.io,github.com,objects.githubusercontent.com,raw.githubusercontent.com
```

The admin Extension Center "Themes" page reads `theme-market/index.json` and only shows themes with `reviewStatus = listed` by default. When installing a market theme, the server downloads the `.tar.gz` artifact again and validates SHA256, PayIncus compatibility range, and theme package safety rules. Unlisted themes or SHA256 mismatches cannot be installed.

Theme submission review endpoints:

```text
POST /api/theme-market-submissions
GET /api/theme-market-submissions/mine
GET /api/theme-market-submissions/admin?reviewStatus=pending
POST /api/theme-market-submissions/admin/:id/scan
PATCH /api/theme-market-submissions/admin/:id/review
POST /api/theme-market-submissions/admin/publish-market-index
```

Theme submissions must include GitHub Release artifact, `payincus.theme.json` URL, `.tar.gz` download URL, SHA256, developer profile, compatibility range, design token summary, layout slot declaration, contact information, and rollback notes. The scanner downloads the manifest and theme package, then runs HTTPS/SSRF validation, package size limit, SHA256 validation, manifest/submission consistency check, CSS safety validation, script-file blocking, and path safety validation. Publishing the theme marketplace directory only publishes submissions with `reviewStatus = listed` and `scanStatus = passed` or `warning`.
