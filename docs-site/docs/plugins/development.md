# 扩展开发指南

扩展包必须是 `.tar.gz`，根目录包含：

```text
payincus.plugin.json
README.md
dist/
  admin/
  user/
templates/
docs/
```

最小打包命令：

```bash
tar -czf my-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

## 后台页面

后台页面通过 `adminPages` 声明，并在受保护的 sandbox iframe 中打开。`admin.plugins.settings` 会显示为扩展中心里的设置页；`admin.sidebar.extra` 会显示为后台侧边栏入口，平台会生成 `/admin/plugins/:pluginId/pages/<entry>` 路由并用后台权限加载对应页面。

```json
{
  "slot": "admin.plugins.settings",
  "title": "设置",
  "entry": "dist/admin/settings.html"
}
```

```json
{
  "slot": "admin.sidebar.extra",
  "title": "运营控制台",
  "entry": "dist/admin/console.html"
}
```

## 用户端页面

用户端页面通过 `userPages` 声明。启用扩展后，用户端会从 `/api/plugins/enabled-client-extensions` 获取可展示入口；后台入口会从 `/api/plugins/enabled-admin-client-extensions` 获取，仅管理员可访问。

```json
{
  "slot": "user.sidebar.extra",
  "title": "我的扩展",
  "path": "/plugins/my-plugin",
  "entry": "dist/user/index.html",
  "requiresAuth": true
}
```

页面内扩展点会直接以 sandbox iframe 挂载到对应页面。当前首批可见页面内 slot 包括：

- `user.dashboard.cards`：用户端仪表盘卡片区域。
- `admin.dashboard.widgets`：后台统计页运营概览区域。

```json
{
  "slot": "user.dashboard.cards",
  "title": "活动摘要",
  "path": "/plugins/my-plugin",
  "entry": "dist/user/dashboard-card.html",
  "requiresAuth": true
}
```

## 配置

后台扩展配置保存到扩展中心。扩展静态页可以读取非敏感公有配置：

```text
GET /api/plugins/:pluginId/config/public
```

带有 `token`、`secret`、`password`、`key` 等名称的配置会按敏感配置处理，不会在公有配置接口返回。

平台 iframe 容器会在扩展页面加载后拉取公有配置，并向扩展页面发送实时配置消息。后台保存标准配置后，同一页面内的扩展 iframe 会再次收到更新后的公有配置：

```js
window.addEventListener('message', event => {
  if (event.origin !== window.location.origin) return
  if (event.data?.type !== 'payincus:plugin-config') return
  console.log(event.data.pluginId, event.data.config, event.data.updatedAt)
})
```

扩展可以在 manifest 里声明标准 `configSchema`，后台设置页会自动生成表单。当前支持 `text`、`textarea`、`markdown`、`password`、`email`、`number`、`select`、`tags`、`checkbox`、`color`、`file` 和 `placeholder`。字段可以声明 `group` 和 `order`，后台会按分组和排序渲染配置块。

```json
{
  "configSchema": {
    "enabled": {
      "type": "checkbox",
      "label": "启用扩展",
      "group": "基础配置",
      "order": 10,
      "required": false,
      "default": true
    },
    "apiKey": {
      "type": "password",
      "label": "API Key",
      "group": "接口凭据",
      "order": 20,
      "required": true,
      "secret": true
    },
    "mode": {
      "type": "select",
      "label": "运行模式",
      "group": "基础配置",
      "order": 30,
      "required": true,
      "default": "sync",
      "options": [
        { "label": "同步", "value": "sync" },
        { "label": "异步", "value": "async" }
      ]
    }
  }
}
```

后台保存接口：

```text
PUT /api/admin/plugins/:pluginId/config
```

有 `configSchema` 的扩展只能保存 manifest 声明过的 key。服务端会按字段类型归一化 number、checkbox、tags、email、color、file 和 select，必填字段缺失会返回 `INVALID_PLUGIN_CONFIG`。`type = file` 的字段会在后台设置页提供受控上传入口；首版只允许 PNG、JPEG 和 WebP 图片，单文件不超过 2MB，文件写入 `PLUGIN_DATA_DIR/config-files`，配置值只能保存平台返回的 `/api/plugins/:pluginId/config-files/:key/:filename` URL。用户端读取该 URL 时会重新校验插件已启用、manifest 字段仍是 `file`，且当前配置值匹配该文件。`type = password` 或 `secret = true` 的字段会加密存储，后台列表和公共配置接口不会回显原值；保存时留空会保持已有密钥不变。每次后台保存扩展配置都会写入 `plugin.config_update` 审计日志，只记录 changed、created、updated、secret 和 file 字段 key 摘要，配置值固定脱敏为 `values=redacted`，不会把 token、password、secret、图片 URL 或其他字段值写入日志。

## 扩展 KV 存储

扩展可以声明受控 KV 存储，用于保存扩展自己的数据。它不是全局数据库，也不能写 PayIncus 内部业务表。当前支持旧版用户级 KV，以及 scoped KV 首版：`user`、`global` 和 `service`。

manifest 必须同时声明 storage capability 和权限：

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

可用接口：

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

Scoped KV 接口：

```text
GET /api/plugins/:pluginId/scoped-storage/:scope/:key
PUT /api/plugins/:pluginId/scoped-storage/:scope/:key
DELETE /api/plugins/:pluginId/scoped-storage/:scope/:key
```

`GET /api/plugins/:pluginId/storage-usage` 是后台只读观测接口，只允许管理员访问。它返回旧版用户 KV 总数、scoped KV 各 scope key 数、私有表各 table/scope 行数、migration 数、manifest 声明的 `maxKeys` / `maxRows`、retention 策略和只读阈值告警；当已声明的 KV key 或私有表行数达到 80% 配额时返回 `warning`，达到或超过配额时返回 `critical`。该接口不会返回任何 key 对应的 value、row payload、用户 ID 或服务 ID。

`GET /api/plugins/:pluginId/storage-backup` 和 `POST /api/plugins/:pluginId/storage-backup/restore` 是管理员备份/恢复通道。备份文件使用 `schemaVersion = 1`，绑定 `pluginId`，包含旧版用户 KV、scoped KV、私有表 JSON 行和 migration ledger。导出的备份会附带 `backupId`、`mode = full`、`contentSha256`、总项数和恢复策略摘要，用于离线归档、比对和演练记录。恢复接口会校验备份 `pluginId`、key/table/row 格式、重复恢复键、旧版用户 KV 引用用户、单项 64KB 和总项数上限，然后替换该扩展当前存储数据；不会修改扩展包文件、配置、事件日志、订单、支付、实例或用户资料。备份内容包含扩展私有 value，只适合作为管理员运维备份，不应暴露给普通用户或第三方市场目录。

恢复前可以先执行演练：

```text
POST /api/plugins/:pluginId/storage-backup/restore?dryRun=true
```

`dryRun=true` 会复用正式恢复的校验逻辑，返回 `valid`、`contentSha256`、各类数据计数、`restoreMode = replace_all_plugin_storage` 和 `modified = false`，并写入 `plugin.storage.restore_dry_run` 扩展事件日志；它不会删除或写入任何扩展存储数据。正式恢复成功会写入 `plugin.storage.restore`，导出会写入 `plugin.storage.backup_export`，三类日志共同组成恢复演练和真实恢复审计链。

服务器本地归档首版：

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

`POST /archives` 会把当前完整备份保存到 `PLUGIN_DATA_DIR/storage-backups/plugins/<pluginId>/<backupId>.json`，`backupId` 格式为 `psb_YYYYMMDDHHMMSSmmm_<sha16>`。`POST /archives?mode=differential` 会读取最近一份可校验的完整归档作为 base，保存相对 base 的差异包；如果没有可用完整归档，会自动回退创建完整归档。差异包记录 `mode = differential`、`baseBackupId`、`baseContentSha256`、最终 `contentSha256`、`diffSha256` 和 added/updated/deleted 项。恢复差异包时必须能找到匹配的 base 完整归档，服务端会先合成完整备份，再复用同一套 dry-run、重复 key、用户引用、大小、总项数和替换式事务逻辑；删除被差异包引用的 base 归档会返回 `PLUGIN_STORAGE_BACKUP_ARCHIVE_HAS_DEPENDENTS`。归档列表只返回元数据、计数、`contentSha256`、`diffCounts`、base 关系和已上传的远端副本元数据，下载单个本地归档才返回备份 value 或差异 value。归档创建、删除、演练和恢复都会写入扩展事件日志。

`POST /upload-remote` 会把已有本地归档上传到当前管理员的默认远程存储配置，也可以传 `storageConfigId` 指定当前管理员自己的配置。远端归档复用平台已有远程存储适配器，当前支持 S3-compatible 对象存储（AWS S3、Cloudflare R2、MinIO）、WEBDAV、FTP 和 SFTP。S3/R2 配置使用 `host` 作为 endpoint，`username` 作为 Access Key ID，`password` 作为 Secret Access Key，`extra.bucket`、`extra.region` 和 `extra.forcePathStyle` 保存非密钥参数；列表接口不会返回 secret。平台会在 `plugin_storage_backup_remote_archives` 记录 `backupId`、远端文件名、存储配置、`contentSha256`、文件大小、上传人和状态，并写入 `plugin.storage.backup_remote_upload` 审计事件。`/remote/:remoteArchiveId/restore?dryRun=true` 会从远端下载 JSON，校验 `pluginId`、`backupId` 和 `contentSha256`，再复用本地恢复 dry-run；正式恢复同样走替换式事务并回写 `lastRestoredAt`。远端恢复不会信任远端文件名里的内容，也不会绕过备份 schema、引用、大小和总项数校验。

定时归档首版默认关闭，可以通过环境变量启用：

```env
PLUGIN_STORAGE_BACKUP_SCHEDULE_ENABLED=true
PLUGIN_STORAGE_BACKUP_INTERVAL_HOURS=24
PLUGIN_STORAGE_BACKUP_RETENTION_COUNT=7
```

启用后，服务端启动 `plugin-storage-backup-scheduler`，按周期扫描已安装且未失败的扩展，生成同一目录下的完整归档。调度器会比较最新归档的 `contentSha256`，内容未变化时写入 `plugin.storage.backup_scheduled_skip` 事件并跳过新文件；内容变化时写入 `plugin.storage.backup_scheduled_archive` 事件。保留策略按每个扩展保留最近 `PLUGIN_STORAGE_BACKUP_RETENTION_COUNT` 个归档，超出的本地文件会被清理，但会保留仍被差异归档引用的 base 完整归档。远端归档需要管理员对具体本地归档执行上传；远端差异归档恢复同样要求本地存在匹配 base 完整归档。

私有表空间首版：

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

私有表接口：

```text
GET /api/plugins/:pluginId/table-storage/:scope/:table/:rowKey
PUT /api/plugins/:pluginId/table-storage/:scope/:table/:rowKey
DELETE /api/plugins/:pluginId/table-storage/:scope/:table/:rowKey
GET /api/plugins/:pluginId/table-storage/:table/migrations
POST /api/plugins/:pluginId/table-storage/:table/migrations
```

`scope` 支持：

- `user`：当前登录用户自己的扩展数据。
- `global`：扩展全局数据；读取允许登录用户，写入和删除只允许管理员。
- `service`：当前登录用户某个实例/服务的数据；必须带 `scopeId=<instanceId>`，且实例必须属于当前用户。

写入接口 body：

```json
{
  "value": {
    "selectedCampaign": "summer"
  }
}
```

限制：

- 只允许已启用扩展访问自己的存储。
- `key` 只能使用字母、数字、`_`、`.`、`:`、`-`，最长 120 字符。
- 单个 value 必须是 JSON，可序列化后不超过 64KB。
- 未声明 `plugin-storage:read` 不能读取。
- 未声明 `plugin-storage:write` 不能写入或删除。
- 未在 `capabilities.storage.scopes` 声明的 scope 不能访问；不声明 scopes 时仅兼容旧版 `user` scope。
- 私有表必须先在 `capabilities.storage.tables` 声明；`table` 只能使用小写字母、数字和下划线，`rowKey` 最长 160 字符。
- 私有表的 `global` 写入、删除和 migration 应用只允许管理员；`service` scope 仍要求 `scopeId=<instanceId>` 且实例属于当前用户。
- 私有表每行 value 必须是 JSON，可序列化后不超过 64KB；`maxRows` 按 `pluginId + table + scope + scopeId` 计数。
- 私有表 migration 只是平台 ledger，不执行任意 SQL。`POST /migrations` 只能应用 manifest 已声明的 migration version，用于记录扩展数据结构版本和审核追踪。
- `retention = keep` 时，卸载扩展会保留 scoped KV 和私有表数据，重新安装同 ID 扩展后可继续读取；`retention = delete_on_uninstall` 会在卸载时清理 scoped KV、私有表行和 migration ledger。旧版用户级 KV 仍随扩展记录级联清理。
- KV、私有表写入、删除和 migration 应用都会进入扩展事件日志。

## Webhook Action Runtime

扩展可以声明 webhook action，让 PayIncus 在受控边界内调用第三方服务。PayIncus 不会加载扩展包里的后端代码，也不会执行 shell 脚本。

manifest 示例：

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

用户端或扩展页面可以调用：

```text
POST /api/plugins/:pluginId/actions/:action
```

请求体：

```json
{
  "idempotencyKey": "flash-sale-123-user-456",
  "payload": {
    "campaignId": "flash-sale-123",
    "sku": "plan-basic"
  }
}
```

PayIncus 会向扩展 webhook 发送 JSON，并附带：

- `X-PayIncus-Plugin-Id`
- `X-PayIncus-Plugin-Action`
- `X-PayIncus-Plugin-Request-Id`
- `X-PayIncus-Plugin-Signature`

签名使用 `PLUGIN_WEBHOOK_SIGNING_SECRET` 对请求 body 做 HMAC-SHA256。生产环境必须配置该密钥。Webhook URL 必须是 HTTPS，执行前会做出站目标安全校验，禁止内网、保留地址和本地域名。默认超时为 `PLUGIN_WEBHOOK_TIMEOUT_MS`，严格限流 action 会使用更短超时。

`requestSchema` 和 `responseSchema` 用于声明 action 契约，方便审核、文档和 SDK 生成。schema 必须是 JSON 对象，单个 schema 不超过 16KB，不支持 `$ref`、`$id` 或原型相关危险键。首版不会执行完整 JSON Schema 运行时校验，扩展服务端仍必须自己校验 payload。

当前 action runtime 适合调用第三方扩展服务，不直接授予修改 PayIncus 内部订单、支付、余额或实例的能力。PayIncus 已提供 `/api/v1` 和 API token/scope 基础能力首版，并开放产品、订单、工单读取和受控工单回复 API；写入型订单、支付、余额和实例交付 API 会按 scope 逐步开放。

## 服务扩展类型

服务扩展用于把第三方服务端能力接入产品配置、结账配置、实例交付、暂停、恢复、终止、升级和服务详情 action。它建立在 Webhook Action Runtime 上，不执行扩展包里的后端代码，也不允许扩展直接写 PayIncus 内部实例、订单、支付或余额表。

manifest 示例：

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

当前支持的 hook：

- `checkoutConfig`
- `provision`
- `suspend`
- `unsuspend`
- `terminate`
- `upgrade`
- `servicePanel`

每个 hook 必须引用已声明的 webhook action，并且 action 的 `scopes` 必须包含对应的 `service-extension:*` scope。后台受控调用入口：

```text
GET /api/plugins/service-actions/:hook/targets?productId=vps-basic
POST /api/plugins/:pluginId/service-actions/:hook
```

请求体：

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

Discovery 入口和 dispatch 入口仅允许管理员或平台内部 lifecycle 调用。Discovery 只返回已启用扩展声明过的目标，不执行 webhook，不修改实例或订单。公开套餐目录会返回匹配当前套餐 ID 或未绑定具体套餐的 `checkoutConfig` 目标元数据，供市场页和后续创建流程识别受控结账配置候选；已登录服务详情会返回匹配当前实例套餐 ID 或未绑定具体套餐的 `servicePanel` 目标元数据，供服务页识别受控扩展面板候选；这些返回值不包含 webhook URL、secret 或 payload。PayIncus 会把 `hook`、`serviceExtensionKey`、`productId` 和业务 payload 包进 webhook 请求，并写入 `plugin.service-extension.dispatch` 审计事件。服务端已经把服务扩展 dispatch 抽成可复用的内部服务层，并提供按 `hook` 和 `productId` 发现已启用扩展目标的能力。

实例 lifecycle 首版已经自动接入 `service.provisioned -> provision`、`service.suspended -> suspend`、`service.unsuspended -> unsuspend`、`service.deleted -> terminate` 和 `service.upgraded -> upgrade`。这些 hook 在 PayIncus 内部状态机完成后异步派发，payload 会包含 `lifecycleEvent`、`instanceId`、`userId`、`hostId`、`instanceName`、`status`、`incusId`、`productId`、`reason`、`source`、`metadata` 和 `occurredAt`；升级 hook 还会包含 `oldPlan`、`newPlan`、`priceDiff`、`refundAmount`、`incusSyncSuccess` 和 `incusSyncError`，并使用 `service-lifecycle:*` 幂等键。扩展 webhook 失败只会写入扩展事件失败日志，不会回滚或覆盖 PayIncus 已完成的实例状态、套餐、余额或计费记录。首版不会根据 webhook 返回值自动创建、暂停、恢复、终止或升级实例；真实资源交付仍由 PayIncus 内部状态机负责幂等、回滚、权限和审计。

服务扩展 webhook 会收到 `contractVersion = 1` 和 `expectedResult` 提示。PayIncus 会把响应标准化为受控结果契约：

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

`status` 只接受 `accepted`、`pending`、`completed`、`failed` 或 `unsupported`。`message` 和 `externalReference` 会被限制长度，`metadata` 只保留扁平 JSON 标量字段。该契约当前只进入 dispatch 响应和扩展审计日志，用于后续 lifecycle 编排判断；它不会直接写实例状态、订单状态、余额或资源交付结果。

## 支付网关扩展类型

支付网关扩展用于声明第三方支付 provider 的可用性判断、建单、查验、退款和回调处理 hook。支付属于高风险资金链路，PayIncus 会把建单、主动验单、异步回调、管理员同步和原路退款放进内部状态机；扩展 webhook 只能返回标准化结果，不能直接写入真实入账、余额或订单状态。

manifest 示例：

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

当前支持的 hook：

- `availability`
- `createPayment`
- `verifyPayment`
- `refund`
- `webhook`

每个 hook 必须引用已声明的 webhook action，并且 action 的 `scopes` 必须包含对应的 `gateway-extension:*` scope。后台受控调用入口：

```text
GET /api/plugins/gateway-actions/:hook/targets?providerCode=custompay
POST /api/plugins/:pluginId/gateway-actions/:hook
```

请求体：

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

Discovery 入口和 dispatch 入口仅允许管理员或平台内部支付 lifecycle 调用。Discovery 只返回已启用扩展声明过的目标，不执行 webhook，不修改订单、支付、余额或退款状态。PayIncus 会把 `hook`、`gatewayExtensionKey`、`providerCode` 和业务 payload 包进 webhook 请求，并写入 `plugin.gateway-extension.dispatch` 审计事件。服务端已经把支付网关扩展 dispatch 抽成可复用的内部服务层，并提供按 `hook` 和 `providerCode` 发现已启用扩展目标的能力，支付 provider 可用性判断、建单、查验、退款和回调流程可以复用同一套 scope 校验、webhook 签名、SSRF 防护、超时、幂等键和审计链路。

支付 lifecycle 首版已经自动接入充值建单、主动验单、支付回调和管理员人工完成/失败路径：生成支付链接后异步派发 `createPayment`，主动验单终态异步派发 `verifyPayment`，支付回调终态异步派发 `webhook`，管理员人工完成或失败异步派发 `verifyPayment`。payload 会包含 `lifecycleEvent`、`providerId`、`providerCode`、`orderNo`、`rechargeId`、`userId`、金额摘要、支付方式、状态、来源、脱敏后的外部交易引用、受控支付详情摘要和 `occurredAt`；不会包含 `providerConfigSnapshot`、支付渠道密钥、原始回调 payload 或完整交易号，并使用 `gateway-lifecycle:*` 幂等键。扩展 webhook 失败只会写入扩展事件失败日志，不会回滚或覆盖 PayIncus 已完成的订单、余额、回调幂等或人工操作结果。

支付网关扩展 webhook 同样会收到 `contractVersion = 1` 和 `expectedResult`，响应会被标准化为 `{ accepted, status, message, externalReference, metadata }`。该契约可用于表达第三方支付 provider 是否接受建单、是否暂挂、是否不支持某个支付方式或返回外部交易引用；PayIncus 不会因为该响应直接入账、任意改余额或任意改订单状态。真实资金写入仍必须由 PayIncus 内部支付状态机完成金额币种校验、回调验签、幂等和审计。

插件支付渠道首版已经可以作为后台支付渠道启用：新增支付渠道时选择 `plugin_gateway`，配置 `pluginId`、`gatewayExtensionKey` 和 `providerCode`。启用时服务端会确认插件已安装启用、manifest 中存在同 `providerCode` 的 `capabilities.gatewayExtensions[]`，且声明了 `createPayment` hook。用户创建充值订单时，PayIncus 会同步调用该 hook，并只接受响应 `metadata.payUrl`、`metadata.paymentUrl`、`metadata.redirectUrl` 或 `metadata.checkoutUrl` 中的 HTTPS 公网跳转地址作为支付链接；该 URL 字段最多保留 2048 字符，其它 metadata 文本仍按短文本处理。

`plugin_gateway` 回调首版已经接入通用 `/api/recharge/callback/:providerId`。支付平台回调必须包含 PayIncus 订单号，PayIncus 会把原始回调 data、受控 header 摘要、来源 IP 和订单金额摘要交给该渠道绑定的 `webhook` hook；插件负责验签并把结果标准化为 `completed`、`pending`、`failed` 或 `cancelled`。PayIncus 不会直接信任原始回调，也不会让插件绕过资金状态机：插件返回后仍必须通过订单号匹配、providerId 匹配、金额与应付金额一致、订单未过期、状态可处理和 `payment_callbacks` 幂等校验，才会执行内部 `completeRecharge`、`failRecharge` 或 `cancelRecharge`。`cookie`、`authorization` 和 `proxy-authorization` 头不会转发给插件。

插件回调完成入账时，PayIncus 仍按订单原始 `actualAmount` 入账，插件返回的 `actualAmount` 只用于校验用户是否实付了应付金额；这样可以兼容手续费外加/内扣模型，并避免插件随意改变用户到账金额。用户主动验单也已接入同一套受控模型：`/api/recharge/orders/:orderNo/verify` 会调用绑定插件的 `verifyPayment` hook，插件同样只能返回标准化状态、订单号、交易号和实付金额；PayIncus 仍会执行订单号匹配、金额匹配、过期检查、订单状态检查和幂等校验后才会完成、失败或取消订单。管理员后台手动同步也支持 `plugin_gateway`，会以管理员身份调用同一个 `verifyPayment` hook，并复用应付金额校验、`payment_callbacks` 幂等和内部完成/失败/取消状态机。

`plugin_gateway` 原路退款已有独立状态机：后台通过 `POST /api/admin/billing/recharge-records/:id/refunds` 创建退款请求，或通过 `POST /api/admin/billing/recharge-refunds/:id/retry` 对已有请求重试/同步。平台会先创建 `RechargeRefundRequest`，状态从 `pending -> processing -> completed | failed | cancelled` 流转；进入 `processing` 前会预扣用户余额，插件 `refund` 返回 `failed`/`cancelled` 或 dispatch 失败时会返还预扣，只有插件确认 `completed` 后才记录 provider refund 信息，并按累计已完成退款金额决定是否把充值单标记为 `refunded`。扩展只能返回退款状态、外部退款号、消息和扁平 metadata，不能直接扣余额、返余额、跳过管理员权限或绕过 PayIncus 的幂等键、余额锁、金额上限和审计日志。

## 公共 API 与 API Token

第三方服务端扩展应该通过 `/api/v1` 公共 API 接入 PayIncus，不要调用内部前后台接口。API Token 由登录用户在 PayIncus 后台创建，token 只在创建时返回一次，数据库只保存 SHA256 hash。

管理接口：

```text
GET /api/api-tokens
POST /api/api-tokens
DELETE /api/api-tokens/:id
```

创建请求：

```json
{
  "name": "Flash Sale Backend",
  "scopes": ["profile:read", "profile:write", "balance:read", "balance:write", "billing:read", "products:read", "services:read", "services:operate", "services:billing", "orders:read", "tickets:read", "tickets:write", "notifications:read"],
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

首版公共 API：

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

`GET /api/v1/me` 要求 `profile:read` scope。Token 被吊销、过期、用户被封禁或缺少 scope 时会返回 401/403，并写入安全审计日志。

`PATCH /api/v1/me` 要求 `profile:write` scope。当前只允许更新低风险资料字段 `avatarStyle`，不会接受邮箱、密码、角色、状态、余额、2FA 或任何安全设置。更新成功后会写入审计日志，并触发 `user.profile.updated` 扩展事件。

```json
{
  "avatarStyle": "bigSmile"
}
```

`GET /api/v1/balance` 要求 `balance:read` scope，只返回当前 token 用户自己的账户余额、币种和更新时间。`GET /api/v1/balance/logs` 使用同一个 scope，返回当前 token 用户自己的余额流水，支持 `page`、`pageSize`、`sort = createdAt | -createdAt`、`type` 和 `lotteryGift = exclude | only` 查询；响应只包含安全流水字段和实例名称，不返回用户对象、调账申请对象、支付 provider payload、托管余额、AFF 余额或其他用户数据。这两个接口都不开放充值、扣款、退款或调账。

`GET /api/v1/balance/adjustment-requests` 和 `POST /api/v1/balance/adjustment-requests` 要求 `balance:write` scope。该 scope 不代表可以直接写余额；它只允许当前 token 用户给自己提交待审批余额调整申请，并读取自己通过 Public API 提交的申请。申请列表支持 `page`、`pageSize`、`sort = createdAt | -createdAt` 和 `status = pending | approved | rejected`。创建请求只接受正数 `amount`、`requestType = manual_adjust | refund`、10-500 字符 `reason` 和可选 `orderNo`；服务端会把内部审计来源固定为 `public_api` 和当前 token，状态固定为 `pending`，并限制同一用户最多 5 个待处理 Public API 申请。公开响应不返回 token 内部 ID、余额流水 ID、支付 provider payload 或后台审批内部对象。该接口不会创建充值订单、不会调用支付 provider、不会写余额流水、不会修改余额；真正执行仍必须由后台调账审批通过后完成。

`GET /api/v1/billing-records` 和 `GET /api/v1/billing-records/:id` 要求 `billing:read` scope，只返回当前 token 用户自己的实例计费记录。列表支持 `page`、`pageSize`、`sort = createdAt | -createdAt`、`type = newPurchase | renew | upgrade | downgrade | refund | transfer_fee` 和 `serviceId` 查询；详情同样按当前用户隔离。响应只包含账单 ID、关联公共订单 ID、服务摘要、计费类型、金额、月份、周期、备注和创建时间，不返回余额流水对象、支付回调、provider payload、内部对账数据或其他用户账单。

资源 API 首版：

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

`/products` 要求 `products:read` scope，只返回已启用套餐包和已启用套餐计划，列表支持 `sort = createdAt | -createdAt`。`/services` 要求 `services:read` scope，只返回当前 token 用户自己的实例服务摘要；支持白名单 `status = creating | running | stopped | suspended | error | deleted` 过滤，支持 `sort = displayOrder | -displayOrder | createdAt | -createdAt`，也支持受控 `include = product,plan`，只在 `included.products` 和 `included.plans` 中返回当前用户服务已关联的套餐摘要，不会返回 root 密码、Incus ID、宿主机内部配置或特权连接密钥。`POST /api/v1/services/:id/actions` 要求 `services:operate` scope，只允许当前 token 用户给自己的服务排队 `start`、`stop` 或 `restart` 任务；接口不会直接调用 Incus，也不会开放创建、暂停、恢复、重装、删除、迁移、宿主机操作或资源交付。服务被封停、已删除、正在转移、正在备份/恢复/上传或已有实例任务时会拒绝入队。`POST /api/v1/services/:id/renew` 要求 `services:billing` scope，只允许当前 token 用户续费自己的付费服务，并复用 PayIncus 内部续费事务完成余额锁、余额扣款、账单记录、AFF 折扣、用户托管节点续费限制、托管收入和到期封停解封；接口不接受任意金额、不创建充值订单、不直接暴露余额扣款接口，也不开放创建、重装、删除、迁移或宿主机操作。`GET /api/v1/services/:id/tasks/:taskId` 同样要求 `services:operate` scope，只返回当前 token 用户自己服务的 `start`、`stop`、`restart` 任务状态和队列位置，不暴露重装、克隆、迁移、删除或后台交付任务。`DELETE /api/v1/services/:id/tasks/:taskId` 只允许取消仍处于 `PENDING` 的公开电源任务；已经 `PROCESSING`、`COMPLETED` 或 `FAILED` 的任务不能取消。`/orders` 要求 `orders:read` scope，只返回当前 token 用户自己的充值和实例计费记录；支持白名单 `status = pending | completed | failed | cancelled | refunded` 过滤和 `sort = createdAt | -createdAt`，`GET /api/v1/orders/:id` 可以读取当前 token 用户自己的单条公共订单，订单 ID 形如 `recharge:123` 或 `instance_billing:456`；订单接口不会返回支付回调数据、provider 配置快照、原始查询结果或完整交易号。`/tickets` 要求 `tickets:read` scope，只返回当前 token 用户自己的工单、消息和安全附件元数据；支持白名单 `status`、`category`、`priority` 和 `sort = updatedAt | -updatedAt | createdAt | -createdAt`，不会返回内部备注或存储 provider 文件 ID。`PATCH /api/v1/tickets/:id/status` 要求 `tickets:write` scope，只允许当前 token 用户关闭自己的工单或重新打开自己的已关闭工单；body 只接受 `action = close | reopen`，不接受任意 status、优先级、分类、内部备注、负责人或跨用户状态修改。

Public API 写入型接口已经挂载独立限流：余额调整申请每 10 分钟 5 次，服务电源任务入队每分钟 10 次，服务续费每 10 分钟 5 次，服务任务状态轮询每分钟 120 次，等待中任务取消每分钟 10 次，工单创建每 5 分钟 10 次，工单回复和状态修改每分钟 20 次，自通知/模板通知每分钟 20 次，扩展 action dispatch 每分钟 30 次。扩展 action dispatch 另有数据库持久化的按 token + 扩展 + action 维度动态配额：`rateLimit = normal` 默认每分钟 30 次，`rateLimit = strict` 默认每分钟 10 次；后台扩展中心可以配置全局策略、指定扩展策略或指定扩展 action 策略，同一个 token、扩展和 action 在多后端实例之间共享计数窗口，超过后返回 `PUBLIC_PLUGIN_ACTION_RATE_LIMITED` 和 `Retry-After`，不会调用 webhook。触发限流会返回 `429 TooManyRequests`，不进入支付、余额、实例任务、通知或扩展 webhook 执行链路。

服务操作请求体：

```json
{
  "action": "restart"
}
```

成功时返回 202 和平台任务摘要：

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

随后可以轮询任务状态：

```text
GET /api/v1/services/123/tasks/456
```

响应只包含公开任务字段：

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

如果任务仍在等待队列中，可以取消：

```text
DELETE /api/v1/services/123/tasks/456
```

取消成功后会返回同一公开任务对象，`status` 为 `FAILED`，`error` 标记为用户取消。取消接口不会取消已经开始执行的任务，也不会触碰重装、克隆、迁移、删除或后台交付任务。

`POST /api/v1/tickets` 要求 `tickets:write` scope，只允许当前 token 用户给自己创建公开工单。JSON 请求创建文本工单；`multipart/form-data` 可通过 `images` 字段上传最多 6 张图片附件，单张最大 50MB，仅支持 JPG、PNG、WebP、GIF 和 AVIF。接口不接受内部备注、状态覆盖、目标用户覆盖、管理员字段、任意文件或存储 provider 文件 ID；如果传入 `instanceId`，实例必须属于当前 token 用户。服务端会复用工单通知和 `ticket.created` 事件链路，并写入审计日志。

```json
{
  "subject": "秒杀订单咨询",
  "category": "billing",
  "priority": "normal",
  "content": "我需要确认这次秒杀订单的支付状态。",
  "instanceId": 123
}
```

`POST /api/v1/tickets/:id/replies` 要求 `tickets:write` scope，只允许当前 token 用户给自己的未关闭工单追加公开回复。JSON 请求创建文本回复；`multipart/form-data` 可通过 `images` 字段上传最多 6 张图片附件，单张最大 50MB，仅支持 JPG、PNG、WebP、GIF 和 AVIF。接口不接受内部备注、状态变更、目标用户覆盖、任意通知发送、任意文件或存储 provider 文件 ID；服务端会复用工单通知和 `ticket.replied` 事件链路，并写入审计日志。

`GET /api/v1/notifications` 和 `GET /api/v1/notifications/unread-count` 要求 `notifications:read` scope，只读取当前 token 用户自己的站内信和未读数量。列表支持 `page`、`pageSize`、`sort = createdAt | -createdAt` 和 `isRead = true | false`，响应只包含 `eventType`、标题、正文、已读状态和创建时间；不会返回通知渠道配置、外部发送日志、原始事件 `data` payload、群发目标或其他用户消息。

`POST /api/v1/notifications` 要求 `notifications:send` scope，只允许给当前 token 用户自己发送短文本通知。接口会创建站内信，并复用用户已启用的外部通知渠道和 `notification.sent` 事件链路。请求可以直接传 `title`/`message`，也可以使用平台白名单模板 `flash_sale_reminder`、`service_action_update`、`billing_notice`，或使用已启用扩展在 manifest 里声明的模板 `plugin:<pluginId>:<templateId>`；模板变量最多 10 个标量值，key 必须是标识符格式，单个变量最长 120 字符。扩展模板必须来自已启用扩展的 `capabilities.notificationTemplates`，扩展 manifest 必须声明 `notifications:send` 权限，模板内容只允许纯文本 `{{variable}}` 占位符。接口不接受 `userId`、群发、任意渠道选择、任意 HTML、未声明模板、内部事件类型覆盖或管理员通知。

扩展可以声明受控通知模板：

```json
{
  "permissions": ["notifications:send"],
  "capabilities": {
    "notificationTemplates": [
      {
        "id": "reservation_reminder",
        "title": "秒杀预约提醒",
        "message": "活动「{{campaignName}}」将在 {{startsAt}} 开始。",
        "variables": ["campaignName", "startsAt"]
      }
    ]
  }
}
```

Public API 调用：

```json
{
  "template": "plugin:com.example.flash-sale:reservation_reminder",
  "variables": {
    "campaignName": "夏季秒杀",
    "startsAt": "20:00"
  },
  "source": "Flash Sale Extension"
}
```

请求体：

```json
{
  "title": "秒杀活动提醒",
  "message": "你预约的活动即将开始。",
  "source": "Flash Sale Extension"
}
```

模板请求示例：

```json
{
  "template": "flash_sale_reminder",
  "variables": {
    "campaignName": "夏季秒杀",
    "startsAt": "20:00",
    "productName": "LXC 4G 套餐"
  },
  "source": "Flash Sale Extension"
}
```

`GET /api/v1/plugins` 和 `GET /api/v1/plugins/:pluginId/actions` 要求 `plugins:action` scope，只返回已启用扩展的公开 webhook action 契约，用于第三方服务端发现可调用 action。返回字段包括扩展 ID、名称、版本、公开 action 数量、action name、method、path、scope、幂等策略、限流策略、requestSchema 和 responseSchema；接口不会返回 webhook URL、secret、扩展配置值、服务扩展 hook 或支付网关扩展 hook。

`POST /api/v1/plugins/:pluginId/actions/:action` 要求 `plugins:action` scope，用于第三方服务端通过 API token 触发已启用扩展声明过的 webhook action。该入口不会绕过扩展 manifest：扩展必须声明 action，必须配置 `runtime = webhook` 和 HTTPS URL，manifest 必须授予 `plugin-action:run` 以及该 action 声明的所有 scopes。执行仍走 SSRF 校验、HMAC 签名、超时、payload 大小限制和扩展事件审计。

公开 action dispatch 会先校验 manifest 权限，再按 token + 扩展 + action 动态配额拦截：`normal` 默认每分钟 30 次，`strict` 默认每分钟 10 次。动态配额写入 `public_plugin_action_rate_limit_buckets`，同一数据库下的多实例共享窗口；后台配置写入 `public_plugin_action_rate_limit_policies`，生效优先级为指定扩展 + 指定 action，高于指定扩展全部 action，高于全局 `*`。超过配额时返回 `429`、`PUBLIC_PLUGIN_ACTION_RATE_LIMITED` 和 `Retry-After`，不会进入扩展 webhook 调用。

请求体：

```json
{
  "idempotencyKey": "flash-sale-123-user-456",
  "payload": {
    "campaignId": "flash-sale-123",
    "sku": "plan-basic"
  }
}
```

该接口的 actor 固定为当前 token 用户。首版不允许指定其他用户、直接修改订单/支付/余额/实例状态，也不替代服务扩展和支付网关扩展的受控 lifecycle 入口。

机器可读 API 契约：

```text
GET /api/v1/openapi.json
GET /api/v1/openapi.yaml
```

当前 OpenAPI 3.1 文档同时提供 JSON 和 YAML 两种格式，并由同一份契约生成。它覆盖 `/api/v1/me` 读取和低风险头像资料写入、余额和余额流水只读、产品、服务、订单、工单、通知只读资源接口、受控工单创建/回复写入接口、自通知发送接口和 API Token 管理接口。注意 API Token 管理接口实际路径是 `/api/api-tokens`，因为它依赖登录用户的 PayIncus session JWT；公共业务资源接口挂在 `/api/v1/*`。

Public API TypeScript SDK 首版：

```text
GET https://docs.payincus.com/sdk/payincus-public-api.ts
GET https://docs.payincus.com/sdk/examples/service-power-task.ts
GET https://docs.payincus.com/sdk/examples/service-renew.ts
GET https://docs.payincus.com/sdk/examples/flash-sale-action.ts
GET https://docs.payincus.com/sdk/examples/balance-adjustment-request.ts
GET https://docs.payincus.com/sdk/examples/billing-records.ts
GET https://docs.payincus.com/sdk/examples/oauth-authorization-code.ts
```

SDK 文档页：

```text
https://docs.payincus.com/plugins/sdk
```

当前 scope 白名单：

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

`profile:write` 已对应受控低风险头像资料更新接口，只允许更新低风险资料字段 `avatarStyle`。`balance:read` 已对应当前用户账户余额和余额流水只读接口，不开放充值、扣款、退款或调账。`balance:write` 已对应当前用户自己的余额调整申请提交和申请列表读取，状态固定进入后台审批，不会直接写余额、余额流水、支付或充值订单。`billing:read` 已对应当前用户自己的实例计费记录列表和详情读取，不返回余额流水对象、支付回调、provider payload、内部对账数据或其他用户账单。`products:read`、`services:read`、`orders:read` 和 `tickets:read` 已对应只读 `/api/v1` 资源接口，其中服务、订单和工单列表已经支持白名单安全过滤，订单已支持当前用户单条详情读取，服务接口已经支持白名单 `include=product,plan`。`services:operate` 已对应受控服务电源任务入队、任务状态轮询和等待中任务取消接口，只允许 `start`、`stop`、`restart` 当前用户自己的服务，不开放创建、暂停、恢复、重装、删除、迁移或资源交付。`services:billing` 已对应受控服务续费接口，只允许当前 token 用户续费自己的付费服务，复用内部续费事务，不接受任意金额或直接余额扣款。`tickets:write` 已对应受控工单创建、公开回复、图片附件、关闭自己的工单和重新打开自己的已关闭工单接口。`notifications:read` 已对应当前用户站内信和未读数量只读接口，不返回渠道配置、发送日志或原始事件 payload。`notifications:send` 已对应受控自通知、平台白名单通知模板和已启用扩展声明的受控通知模板接口。`plugins:action` 已对应受控扩展 action 触发接口；任何 scope 都不代表可以绕过内部支付、余额、实例交付、风控或审计逻辑。

scope 元数据目录：

```text
GET /api/oauth-provider/scopes
```

该接口是 OAuth 授权页、后台 OAuth App 配置页、OpenAPI 和 Public API SDK 共用的 canonical scope catalog。每个 scope 返回：

- `scope`
- `title`
- `description`
- `risk = low | medium | high`
- `access = read | write | operate`
- `resources`
- `implemented`
- `notes`

授权确认接口 `GET /api/oauth-provider/authorize/consent` 会同时返回 `scopeMetadata`，第三方开发文档和前后台 UI 不应再硬编码 scope 描述。`resources` 只表示该 scope 当前覆盖的公开资源路径，不表示可以访问后台、支付回调、provider payload、内部审计或跨用户数据。

## 高风险 Public API 边界

以下能力不是遗漏，也不是通过 `plugins:action`、OAuth scope 或 SDK 示例可以绕开的能力。它们默认保留在 PayIncus 内部状态机、后台审核流或管理员会话接口里：

- 直接余额充值、扣款、退款、审批通过或绕过审批的调账。
- 支付建单、支付回调处理、主动验单、退款执行或 provider payload 读取。
- 服务创建、暂停、恢复、重装、删除、迁移、资源交付或宿主机操作。
- 邮箱、密码、2FA、角色、状态、封禁等敏感用户资料变更。
- 工单内部备注、负责人变更、任意状态流转或跨用户工单写入。
- 群发通知、任意通知渠道选择、HTML 通知或未声明模板发送。
- 扩展安装、启用、停用、卸载、市场发布或主题启用。

这些能力如果未来要进入 `/api/v1`，必须先补公开资源设计、独立 scope、scope 元数据、OpenAPI 契约、SDK 方法、审计日志、限流、幂等、防跨用户校验、状态机回滚和生产 proof。没有完成这些准入项之前，第三方扩展只能通过已开放的受控 action、事件和当前 token 用户自己的资源 API 参与业务流程。

## OAuth Provider

PayIncus 可以作为 OAuth Provider 给第三方应用签发 access token 和 refresh token。后台管理员在 OAuth 设置页创建 OAuth App，Client Secret 只显示一次，数据库只保存 SHA256 hash。

后台管理接口：

```text
GET /api/admin/oauth-apps
POST /api/admin/oauth-apps
PUT /api/admin/oauth-apps/:id
POST /api/admin/oauth-apps/:id/rotate-secret
DELETE /api/admin/oauth-apps/:id
GET /api/admin/oauth-apps/authorizations?appId=&user=&status=active&page=1&pageSize=20
DELETE /api/admin/oauth-apps/authorizations/:id
```

后台授权审计接口只允许管理员访问。筛选参数支持 `appId`、`user`（用户 ID、用户名或邮箱模糊搜索）、`status = all | active | revoked | disabled`、`page` 和 `pageSize`。返回内容只包含应用、用户、scope、授权时间、撤销时间和活跃 access/refresh token 数量，不返回 token hash、client secret 或授权码。

浏览器授权入口：

```text
GET /oauth/authorize?response_type=code&client_id=pocli_xxxxx&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&scope=profile%3Aread%20products%3Aread%20services%3Aread&state=opaque-state
```

用户确认授权后，PayIncus 会跳回 `redirect_uri` 并附带 `code` 和原始 `state`。如果用户拒绝授权，会跳回 `redirect_uri` 并附带 `error=access_denied`。

授权确认接口由用户端页面调用：

```text
GET /api/oauth-provider/authorize/consent
POST /api/oauth-provider/authorize/confirm
```

已授权且 scope 覆盖时，服务端可以通过 session API 直接创建授权码；缺少授权确认时会返回 `OAUTH_CONSENT_REQUIRED`。

```text
POST /api/oauth-provider/authorize
```

确认请求示例：

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

第三方后端用授权码换取 token：

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

返回的 `access_token` 使用 `poa_` 前缀，可以作为 Bearer token 调用 `/api/v1/me`：

```text
GET /api/v1/me
Authorization: Bearer poa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

返回的 `refresh_token` 使用 `por_` 前缀。第三方后端刷新 token 时必须携带 client credentials，PayIncus 会轮换 refresh token，旧 refresh token 立即失效：

```json
{
  "grantType": "refresh_token",
  "clientId": "pocli_xxxxx",
  "clientSecret": "posec_xxxxx",
  "refreshToken": "por_xxxxx"
}
```

用户授权记录接口：

```text
GET /api/oauth-provider/authorizations
DELETE /api/oauth-provider/authorizations/:id
```

撤销授权会同时撤销该授权下的 OAuth access token 和 refresh token。

撤销接口：

```text
POST /api/oauth-provider/revoke
```

OAuth access token 会执行 app 启用状态、token 过期、撤销、用户状态和 scope 校验。OAuth refresh token 只保存 SHA256 hash，并在刷新时轮换。OAuth scope 不开放高风险资源写入。

## 事件订阅

manifest 可以声明事件订阅：

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

事件 handler 必须指向同一个 manifest 中声明的 action。当前运行时已经提供事件 dispatcher 和 webhook 投递能力；扩展安装/启用/停用/卸载 lifecycle、订单、支付、服务、服务任务、资源回滚、通知、工单和用户生命周期已经完成首批接入，更多业务点会后续逐步接入 dispatcher。

## 业务事件

当前已经接入 dispatcher 的业务事件：

- `plugin.installed`：超级管理员私有上传或市场安装扩展包完成后触发；安装后的目标扩展默认未启用，因此该事件主要供其他已启用扩展做治理、审计或同步。
- `plugin.enabled`：扩展启用成功后触发，目标扩展和其他已启用订阅者都可以收到。
- `plugin.disabled`：扩展停用前触发，目标扩展仍处于启用状态，可以做外部清理；失败不会阻止停用。
- `plugin.uninstalled`：扩展卸载前触发，目标扩展仍处于启用状态，可以做外部清理；失败不会阻止卸载。
- `order.created`：充值订单创建后触发。
- `order.paid`：充值订单完成入账后触发，仅在本次状态机真正完成时触发。
- `payment.failed`：充值支付失败后触发，仅在本次状态真正切换为失败时触发。
- `service.provisioned`：实例交付成功并进入可用状态后触发。
- `service.suspended`：实例被手动封停、批量封停或到期封停后触发。
- `service.unsuspended`：实例被手动解封或批量解封后触发。
- `service.deleted`：实例被用户、管理员、宿主机所有者或到期清理删除后触发。
- `service.task.queued`：公共 API 或实例详情页为服务成功排队受控任务后触发，覆盖 `start`、`stop`、`restart`、`rebuild`、`clone`、`recreate` 和 `change_host`。
- `service.task.cancelled`：公共 API 或实例详情页成功取消仍在等待中的服务任务后触发。
- `service.task.completed`：实例任务 worker 完成受控服务任务后触发，覆盖公开电源任务和后台重装、克隆、重建、迁移等任务。
- `service.task.failed`：实例任务 worker 或超时清理把受控服务任务标记为失败后触发，不包含底层 provider 错误正文。
- `service.resource.rollback.completed`：实例交付失败后，平台成功释放已预占的宿主机资源时触发。
- `service.resource.rollback.failed`：实例交付失败后，平台释放已预占宿主机资源失败时触发；只包含泛化失败类别，不包含底层 provider 或数据库错误正文。
- `ticket.created`：用户工单创建后触发。
- `ticket.replied`：用户、宿主机所有者或管理员回复工单后触发。
- `ticket.status.changed`：Public API 或平台受控流程修改工单状态后触发，只包含前后状态，不包含内部备注或负责人。
- `user.registered`：用户注册成功后触发。
- `user.login`：用户登录成功后触发。
- `user.profile.updated`：用户资料字段更新后触发，只包含字段名，不包含字段新旧值。
- `user.status.changed`：管理员封禁或解封用户后触发，只包含状态和是否填写原因，不包含原因正文。
- `notification.sent`：站内信/外部通知发送流程完成后触发，只包含事件类型、用户 ID 和发送统计，不包含通知正文。

事件 payload 会包含业务对象 ID、当前用户、金额、状态、工单主题、附件数量、服务状态、服务任务 ID、任务类型、任务状态、资源回滚结果、用户生命周期状态或通知发送统计等最小必要上下文。扩展 lifecycle payload 只包含 `pluginId`、`version`、`sourceType`、`sourceRepo`、`occurredAt` 和去重元数据，不包含安装路径、包内文件、配置值、secret、下载密钥或 webhook URL。服务任务和资源回滚事件不会包含 root 密码、Incus ID、宿主机内部配置、特权连接密钥或原始 provider 响应；失败事件只返回泛化失败类别，不返回底层错误正文。用户生命周期事件不会包含邮箱、IP、User-Agent、密码、验证码或敏感字段值。扩展 lifecycle 事件投递失败不会回滚扩展安装、启用、停用或卸载；业务事件投递失败不会回滚支付入账、订单状态、实例状态、服务任务状态、资源回滚结果、用户资料更新、通知发送或工单回复；失败会进入扩展事件日志，自动按退避策略重试，状态为 `retry_pending`，多次失败后进入 `dead_letter` 死信。

平台已经支持受控事件去重。订单和工单等具备稳定业务 ID 的事件会携带 `dedupeKey`，同一扩展、同一事件名、同一 handler 和同一 `dedupeKey` 会先写入数据库唯一去重锁；如果已有成功、待重试、死信或正在投递中的记录，后续重复投递会被跳过并记录为 `duplicate_skipped`，不会再次调用第三方 webhook。正在投递中的锁有 30 分钟接管窗口，避免进程异常退出后永久阻塞。扩展开发者也可以在自定义事件 payload 或 `metadata.dedupeKey` 中提供稳定去重键。不要把当前时间、随机数或一次性 request id 当作去重键。

后台扩展中心的“事件投递”页可以按扩展、事件名、handler 和投递结果筛选日志，查看匹配事件、成功、待重试、到期重试、已去重和死信统计。日志会展示 `dedupeKey`、最后尝试时间、下次重试时间、死信时间和最后错误；管理员可以处理到期重试或手动重放单条可重放事件。手动重放会同步回写去重锁状态，后续重复事件仍按最终投递状态去重。

## 提交市场审核

开发完成后，第三方开发者不要把扩展包直接交给生产环境管理员覆盖安装。标准市场审核应提交：

- GitHub 仓库地址。
- GitHub Release artifact 下载地址。
- `payincus.plugin.json` manifest 地址。
- 扩展 `.tar.gz` 的 SHA256。
- 开发者名称、主页、GitHub、联系邮箱和认证信息。
- 功能说明、截图、权限说明、兼容 PayIncus 版本、更新说明和回滚说明。
- 是否免费、付费、授权限制或有外部服务依赖。
- 是否触碰订单、支付、余额、实例交付、工单、通知、认证、风控或文件上传。

审核通过前，市场条目应保持 `pending`，不会出现在默认市场列表。只有审核通过并标记为 `listed` 后，管理员才能从扩展市场安装。审核拒绝或下架后使用 `rejected` 或 `delisted`。

本地后台上传 `.tar.gz` 是超级管理员的私有安装通道，适合自用和内测。它不代表扩展已经通过公共市场审核。

## 投稿审核接口

第三方扩展投稿进入 PayIncus 审核队列，不直接写入公开市场目录。开发者可以先通过平台上传 `.tar.gz`，由 PayIncus 校验包结构、解析 `payincus.plugin.json`、计算 SHA256，并生成待审核下载地址；也可以把扩展包发布到 HTTPS 下载源，例如 GitHub Release artifact、对象存储或文档站待审核路径，然后提交元数据和 SHA256。

开发者接口：

```text
POST /api/plugin-market-submissions/upload-package
GET /api/plugin-market-submissions/uploads/plugins/:filename
POST /api/plugin-market-submissions
GET /api/plugin-market-submissions/mine
GET /api/plugin-market-submissions/mine/event-health
```

上传接口使用 `multipart/form-data`，文件字段名为 `package`，只接受有 `payincus.plugin.json` 的 `.tar.gz` 扩展包。上传成功后返回 `pluginId`、`version`、`name`、`manifestUrl`、`packageUrl`、`sha256`、`permissions` 和 `compatibility`，前台投稿表单会自动填充这些字段。生产环境应配置 `PLUGIN_SUBMISSION_PUBLIC_BASE_URL`，或确保 `SITE_URL` / `FRONTEND_URL` 是 HTTPS，这样扫描器可以下载待审核包。

提交 body 示例：

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

`GET /api/plugin-market-submissions/mine/event-health` 只返回当前登录用户提交过的插件 ID 的事件投递聚合健康，不返回 payload、actor 或原始日志，也不提供重放能力。返回字段包括插件级成功、失败、待重试、死信、去重、到期重试、最近 24 小时总量、最近 24 小时成功率、最近 7 日趋势、只读告警提示、最后事件时间、最后成功时间、最后失败时间和最后错误，并提供按 `eventName + handler` 拆分的只读 `breakdown` 明细；每个明细同样包含最近 24 小时窗口统计和只读告警提示，供开发者判断自己的 webhook 当前是否稳定。告警提示会标记死信、到期重试、近期死信、近期待重试、近期失败和近期成功率低于 95% 的情况；它只是开发者可见的只读健康提示，不会暴露事件 payload，也不会提供重放能力。

事件重试调度器会在处理到期重试后扫描仍处于 `dead_letter`、`retry_pending` 或最近成功率低于阈值的扩展事件，并向该扩展最近投稿记录对应的开发者用户发送 `plugin_event_delivery_alert` 通知。通知复用 PayIncus 现有站内信和用户已启用的外部通知渠道，不开放新的任意告警 webhook 订阅地址。通知内容只包含扩展 ID、死信数量、到期重试数量、近期失败数量以及最近的 `eventName -> handler`，不会包含事件 payload、actor、原始错误正文、webhook URL、secret 或扩展配置值。管理员 critical 升级首版会在存在死信或到期重试时，通过同一通知类型告警所有活跃管理员，并用独立 `plugin.event.alert_escalate` 日志冷却，避免开发者关闭告警或缺少投稿人时平台运营侧失明。修复 webhook 后仍需由管理员在后台事件投递页手动重放，或等待自动重试。

开发者可以维护自己投稿扩展的事件告警偏好：

```text
GET /api/plugin-market-submissions/mine/event-alert-preferences
PATCH /api/plugin-market-submissions/mine/event-alert-preferences/:pluginId
```

偏好只允许当前登录用户修改自己投稿过的插件 ID。可配置项包括 `enabled`、`minimumLevel = warning | critical`、`cooldownMinutes = 15..1440`、`notifyOnDeadLetter`、`notifyOnDueRetry`、`notifyOnSuccessRateBelow`、`successRateThreshold = 50..100` 和 `recentWindowHours = 1..168`。默认策略为启用告警、警告及以上、360 分钟冷却、关注死信、到期重试和最近 24 小时成功率低于 95%。这只是订阅/升级策略首版，不保存第三方告警 URL 或密钥。

管理员审核接口：

```text
GET /api/plugin-market-submissions/admin?reviewStatus=pending
POST /api/plugin-market-submissions/admin/:id/scan
PATCH /api/plugin-market-submissions/admin/:id/review
POST /api/plugin-market-submissions/admin/publish-market-index
```

审核 body：

```json
{
  "reviewStatus": "listed",
  "riskLevel": "medium",
  "reviewNotes": "Manifest, SHA256 and permission statement checked."
}
```

审核状态：

- `pending`：待审核。
- `listed`：审核通过，可进入公开市场目录。
- `rejected`：审核拒绝。
- `delisted`：已下架。

审核通过后仍需要发布到文档站扩展市场目录，生成或更新 `plugin-market/index.json`、manifest 文件和下载源引用。当前首版已经提供审核队列、审计记录、开发者中心投稿 UI、审核后台 UI、自动扫描和文档站市场目录发布器；发布结果仍应在文档站稳定路径和后台扩展市场读取面做最终验收。

自动扫描会由管理员在审核后台触发。扫描内容包括：

- manifest URL 和 package URL 必须是 HTTPS 公网地址，禁止内网、保留 IP 和本地域名。
- 下载大小不能超过 `PLUGIN_MAX_PACKAGE_SIZE_MB`。
- package SHA256 必须和提交值一致。
- `.tar.gz` 不能包含绝对路径、上级目录、反斜杠路径或硬/软链接。
- package 内必须包含 `payincus.plugin.json`，入口文件和模板路径必须存在。
- manifest URL 内容必须和 package 内 manifest 一致。
- 扫描会根据权限、webhook action、事件订阅和存储声明给出风险等级。

扫描失败不会自动拒绝投稿，但会记录 `scanStatus`、`scanResult`、`riskLevel` 和审计日志；审核人员应优先处理扫描失败和高风险投稿。

发布市场目录会生成 `plugin-market/index.json`：

- 只会发布 `reviewStatus = listed` 且 `scanStatus = passed` 或 `warning` 的投稿。
- 会保留现有市场索引里的官方扩展条目。
- 同一个扩展 ID 的已审核投稿会覆盖旧条目，用于发布新版本。
- 写入目录由 `PLUGIN_MARKET_PUBLISH_DIR` 控制。
- 公开 URL 前缀由 `PLUGIN_MARKET_PUBLIC_BASE_URL` 控制。
- 也可以在服务器上执行 `pnpm --filter server publish:plugin-market-index` 生成市场索引。

## 当前运行时边界

当前版本的扩展运行时只支持受控页面、配置和官方预留接口。第三方扩展不能：

- 执行扩展包里的 shell 脚本。
- 在 PayIncus 主进程加载任意后端代码。
- 直接连接生产数据库写内部表。
- 从用户端扩展访问 `/api/admin/*`。
- 绕过订单、支付、实例交付、工单和权限校验。
- 通过主题或页面扩展注入未授权远程脚本。

需要参与订单、支付、库存、实例、工单、通知等 PayIncus 内部业务流程的扩展，必须通过已开放的 `/api/v1` 受控资源、扩展 action、事件订阅、服务/支付 lifecycle hook 和插件存储进入平台。当前 API token/OAuth scope 已开放低风险资料写入、待审批余额调整申请、受控服务电源任务、受控服务续费、工单创建/回复/状态操作、自通知和扩展 action 触发；这些接口都限定当前 token 用户、已启用扩展或 PayIncus 内部状态机。直接支付建单/回调/退款、直接余额写入、服务创建/删除/迁移、敏感用户资料和扩展/主题管理等高风险写入仍不通过 Public API 开放。

## 平台 2.0 开发标准

完整第三方功能扩展应满足以下标准：

- 使用 `/api/v1` 公共 API，不依赖内部前后台接口。
- 使用 API token，并声明最小权限 scope。
- 在 manifest 声明 action、事件订阅、存储需求和 UI 扩展点。
- 后端 action 提供请求 schema、响应 schema、幂等键策略、限流策略和错误码。
- 所有高风险操作进入审计日志。
- 通过平台 SDK/API 创建订单、扣款、发货、发通知和写工单，不直接写内部表。
- 扩展私有数据保存到平台提供的扩展存储，不混用其他扩展数据。

示例：秒杀扩展需要声明后台设置页、前台活动页、库存/活动私有存储、创建订单 action、支付事件订阅、库存释放事件和通知权限。扣库存必须由后端 action 在事务里完成，并使用幂等键避免重复下单。

## 主题开发标准

主题不是普通页面扩展。真正主题包应包含：

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

主题包应声明：

- 主题 ID、名称、版本和 PayIncus 兼容范围。
- 设计 token：颜色、字体、圆角、间距、阴影、状态色和品牌资源。
- 覆盖范围：公共页面、用户端 shell、后台 shell、市场页、登录/注册页等。
- 预览截图和回滚说明。
- 静态资产路径和 SHA256 校验。

最小 `payincus.theme.json` 示例：

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
      "title": "首页首屏",
      "entry": "templates/public/home-hero.html"
    },
    {
      "slot": "public.market.banner",
      "title": "套餐市场横幅",
      "entry": "templates/public/market-banner.html"
    },
    {
      "slot": "public.auth.aside",
      "title": "认证页说明",
      "entry": "templates/public/auth-aside.html"
    },
    {
      "slot": "user.shell.brand",
      "title": "用户侧边栏品牌",
      "entry": "templates/user/shell-brand.html"
    }
  ],
  "configSchema": {
    "brandColor": {
      "type": "color",
      "label": "品牌主色",
      "group": "品牌",
      "order": 10,
      "default": "#111827"
    },
    "homepageVariant": {
      "type": "select",
      "label": "首页样式",
      "group": "首页",
      "order": 20,
      "default": "compact",
      "options": [
        { "label": "紧凑", "value": "compact" },
        { "label": "展示型", "value": "showcase" }
      ]
    }
  }
}
```

主题管理接口：

```text
GET /api/admin/themes
POST /api/admin/themes/upload
POST /api/admin/themes/:themeId/enable
PUT /api/admin/themes/:themeId/config
POST /api/admin/themes/default
DELETE /api/admin/themes/:themeId
```

用户端加载接口：

```text
GET /api/themes/active
GET /api/themes/assets/:themeId/:version/*
GET /api/themes/preview/:themeId
```

主题配置表单由 `configSchema` 声明，当前支持 `text`、`textarea`、`markdown`、`password`、`email`、`number`、`select`、`tags`、`checkbox`、`color`、`file` 和 `placeholder`。字段可以声明 `group` 和 `order`，后台主题配置会按分组和排序展示。`type = file` 的主题字段会提供受控图片上传入口；首版只允许 PNG、JPEG 和 WebP 图片，单文件不超过 2MB，文件写入 `THEME_DATA_DIR/config-files`，配置值只能保存平台返回的 `/api/themes/:themeId/config-files/:key/:filename` URL。用户端读取该 URL 时只会公开当前启用主题、manifest 字段仍为 `file`、且当前配置值匹配的文件。管理员在后台保存的配置值会写入 `configValues`，并通过 `/api/themes/active` 返回给前端；主题升级同一 `themeId` 时保留已有配置值。每次后台保存主题配置都会写入 `theme.config_update` 审计日志，只记录 changed、added、updated、removed、secret 和 file 字段 key 摘要，配置值固定脱敏为 `values=redacted`，不会把主题配置值、文件 URL 或密钥写入日志。

受控 HTML 模板片段由 `templates` 声明。`slot` 必须来自平台白名单，`entry` 必须是包内 `.html` 片段。服务端会读取片段并禁止 `<script>`、`iframe`、`form`、输入控件、内联事件属性、`javascript:` 和远程 URL。启用主题后，`GET /api/themes/active` 会返回 `templateUrls`，前端可以按 slot 读取受控片段。

主题只能通过 CSS 变量、受控模板槽、本地静态资源和受控配置值改变外观。主题不能注入未授权远程脚本，不能修改登录、支付、权限、风控和资源交付逻辑。当前首版已经支持主题包上传、主题市场安装、主题投稿审核/扫描/发布器、CSS 资产校验、预览、启用、回滚、配置表单和受控模板片段；公共首页、套餐市场页、认证页、用户/后台 shell 品牌、用户仪表盘、实例详情页、钱包页、工单页、扩展页、订单页、资料页、邀请页、节点列表页、新增节点页、后台扩展中心、后台统计页、后台计费、支付渠道、OAuth Provider 和共享页脚已经渲染 `public.home.hero`、`public.home.sections`、`public.market.banner`、`public.auth.aside`、`user.shell.brand`、`user.dashboard.banner`、`user.dashboard.cards`、`user.instance.detail.extra`、`user.wallet.banner`、`user.tickets.banner`、`user.extensions.banner`、`user.orders.banner`、`user.profile.banner`、`user.invites.banner`、`user.hosts.banner`、`user.host.create.banner`、`admin.shell.brand`、`admin.extensions.header`、`admin.extensions.market.banner`、`admin.extensions.theme.banner`、`admin.dashboard.banner`、`admin.dashboard.widgets`、`admin.billing.banner`、`admin.payment.providers.banner`、`admin.oauth.banner`、`shared.footer` 受控主题模板 slot。

生产环境可以配置稳定在线主题市场：

```env
THEME_MARKET_INDEX_URL=https://docs.payincus.com/theme-market/index.json
THEME_MARKET_TRUSTED_HOSTS=docs.payincus.com,payincus.github.io,github.com,objects.githubusercontent.com,raw.githubusercontent.com
```

后台扩展中心的“主题”页会读取 `theme-market/index.json`，默认只展示 `reviewStatus = listed` 的主题。安装市场主题时，服务端会重新下载 `.tar.gz` artifact，校验 SHA256、PayIncus 兼容范围和主题包安全规则；未上架或 SHA256 不匹配的主题不能安装。

主题投稿审核接口：

```text
POST /api/theme-market-submissions
GET /api/theme-market-submissions/mine
GET /api/theme-market-submissions/admin?reviewStatus=pending
POST /api/theme-market-submissions/admin/:id/scan
PATCH /api/theme-market-submissions/admin/:id/review
POST /api/theme-market-submissions/admin/publish-market-index
```

主题投稿需要提交 GitHub Release artifact、`payincus.theme.json` 地址、`.tar.gz` 下载地址、SHA256、开发者资料、兼容范围、设计 token 摘要、布局区块声明、联系方式和回滚说明。扫描器会下载 manifest 和主题包，执行 HTTPS/SSRF 校验、包大小限制、SHA256 校验、manifest 与提交值一致性校验、CSS 安全校验、脚本类文件拦截和路径安全校验。发布主题市场目录只会发布 `reviewStatus = listed` 且 `scanStatus = passed` 或 `warning` 的投稿。
