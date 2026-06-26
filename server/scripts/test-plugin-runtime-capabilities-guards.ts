import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const manifest = read('server/src/lib/plugin-manifest.ts')
const runtime = read('server/src/lib/plugin-runtime.ts')
const extensionDispatch = read('server/src/lib/plugin-extension-dispatch.ts')
const extensionContracts = read('server/src/lib/plugin-extension-contracts.ts')
const pluginBusinessEvents = read('server/src/lib/plugin-business-events.ts')
const pluginPaymentLifecycle = read('server/src/lib/plugin-payment-lifecycle.ts')
const userRoute = read('server/src/routes/plugins.ts')
const rechargeRoute = read('server/src/routes/recharge.ts')
const adminBillingRoute = read('server/src/routes/admin-billing.ts')
const rechargeDb = read('server/src/db/recharge-records.ts')
const app = read('server/src/app.ts')
const storageBackupScheduler = read('server/src/services/plugin-storage-backup-scheduler.ts')
const storageTypes = read('server/src/storage/types.ts')
const webDavProvider = read('server/src/storage/providers/WebDavProvider.ts')
const ftpProvider = read('server/src/storage/providers/FtpProvider.ts')
const sftpProvider = read('server/src/storage/providers/SftpProvider.ts')
const s3Provider = read('server/src/storage/providers/S3Provider.ts')
const packageRoute = read('server/src/routes/packages.ts')
const instanceRoute = read('server/src/routes/instances.ts')
const instanceBillingRoute = read('server/src/routes/instance-billing.ts')
const db = read('server/src/db/plugins.ts')
const schema = read('server/prisma/schema.prisma')
const scopedStorageMigration = read('server/prisma/migrations/20260626150000_add_plugin_scoped_storage/migration.sql')
const tableStorageMigration = read('server/prisma/migrations/20260626180000_add_plugin_table_storage/migration.sql')
const remoteStorageBackupMigration = read('server/prisma/migrations/20260626220000_add_plugin_storage_backup_remote_archives/migration.sql')
const rechargeRefundMigration = read('server/prisma/migrations/20260626230000_add_recharge_refund_requests/migration.sql')
const clientApi = read('client/src/api/index.ts')
const adminClientApi = read('client/src/api/admin.ts')
const clientTypes = read('client/src/types/api.ts')
const publicCatalog = read('client/src/utils/publicCatalog.ts')
const marketView = read('client/src/views/MarketView.vue')
const instanceDetailView = read('client/src/views/InstanceDetailView.vue')
const pluginCenter = read('client/src/views/admin/PluginCenterView.vue')
const pluginSettingsView = read('client/src/views/admin/PluginSettingsView.vue')
const adminPluginRoute = read('server/src/routes/admin-plugins.ts')
const envExample = read('.env.example')
const installPanel = read('scripts/install-panel.sh')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const manifestDocs = read('docs-site/docs/plugins/manifest.md')
const enManifestDocs = read('docs-site/docs/en/plugins/manifest.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const rootPackage = read('package.json')
const serverPackage = read('server/package.json')

assert.ok(
    manifest.includes('PluginActionManifest') &&
    manifest.includes('PluginConfigFieldManifest') &&
    manifest.includes('PluginEventSubscriptionManifest') &&
    manifest.includes('PluginNotificationTemplateManifest') &&
    manifest.includes('PluginServiceExtensionManifest') &&
    manifest.includes('PluginGatewayExtensionManifest') &&
    manifest.includes('PluginStorageManifest') &&
    manifest.includes('PluginTableManifest') &&
    manifest.includes('PluginTableMigrationManifest') &&
    manifest.includes('PluginCapabilitiesManifest') &&
    manifest.includes('PLUGIN_EVENT_NAMES') &&
    manifest.includes("'plugin.installed'") &&
    manifest.includes("'plugin.enabled'") &&
    manifest.includes("'plugin.disabled'") &&
    manifest.includes("'plugin.uninstalled'") &&
    manifest.includes('PLUGIN_SERVICE_EXTENSION_HOOKS') &&
    manifest.includes('PLUGIN_SERVICE_EXTENSION_HOOK_SCOPES') &&
    manifest.includes('PLUGIN_GATEWAY_EXTENSION_HOOKS') &&
    manifest.includes('PLUGIN_GATEWAY_EXTENSION_HOOK_SCOPES') &&
    manifest.includes('PLUGIN_CONFIG_FIELD_TYPES') &&
    manifest.includes('group: sanitizeString(rawField.group, 80)') &&
    manifest.includes('order: typeof rawField.order ===') &&
    manifest.includes('normalizeConfigSchema(raw.configSchema)') &&
    manifest.includes('ACTION_SCHEMA_MAX_BYTES') &&
    manifest.includes('normalizeActionSchema(value.requestSchema') &&
    manifest.includes('normalizeActionSchema(value.responseSchema') &&
    manifest.includes("key === '$ref'") &&
    manifest.includes('capabilities.actions') &&
    manifest.includes('capabilities.events') &&
    manifest.includes('capabilities.notificationTemplates') &&
    manifest.includes('normalizeNotificationTemplate') &&
    manifest.includes('NOTIFICATION_TEMPLATE_ID_PATTERN') &&
    manifest.includes('NOTIFICATION_TEMPLATE_VARIABLE_PATTERN') &&
    manifest.includes('must be plain text') &&
    manifest.includes('capabilities.serviceExtensions') &&
    manifest.includes('capabilities.gatewayExtensions') &&
    manifest.includes('must reference a declared action') &&
    manifest.includes('action must declare') &&
    manifest.includes('service-extension:provision') &&
    manifest.includes('gateway-extension:create-payment') &&
    manifest.includes('capabilities.storage.kind must be kv') &&
    manifest.includes('normalizeStorageScopes(value.storage.scopes') &&
    manifest.includes('contains an invalid scope') &&
    manifest.includes('capabilities.storage.tables') &&
    manifest.includes('PLUGIN_TABLE_NAME_PATTERN') &&
    manifest.includes('PLUGIN_TABLE_MIGRATION_VERSION_PATTERN') &&
    manifest.includes('capabilities.storage.retention is invalid') &&
    manifest.includes('ACTION_PATH_PATTERN') &&
    manifest.includes('SCOPE_PATTERN') &&
    manifest.includes('WEBHOOK_URL_PATTERN') &&
    manifest.includes("runtime !== undefined && runtime !== 'webhook'") &&
    manifest.includes('url must be an HTTPS webhook URL') &&
    manifest.includes('normalizeCapabilities(raw.capabilities)'),
  'plugin manifest parser must validate declared actions, events, scopes, and storage capabilities'
)

assert.ok(
  pluginBusinessEvents.includes('PluginLifecycleEventName') &&
    pluginBusinessEvents.includes('dispatchPluginLifecycleEvent') &&
    pluginBusinessEvents.includes("'plugin.installed'") &&
    pluginBusinessEvents.includes("'plugin.enabled'") &&
    pluginBusinessEvents.includes("'plugin.disabled'") &&
    pluginBusinessEvents.includes("'plugin.uninstalled'") &&
    adminPluginRoute.includes('dispatchPluginLifecycleEvent') &&
    adminPluginRoute.includes("event: 'plugin.installed'") &&
    adminPluginRoute.includes("event: 'plugin.enabled'") &&
    adminPluginRoute.includes("event: 'plugin.disabled'") &&
    adminPluginRoute.includes("event: 'plugin.uninstalled'") &&
    adminPluginRoute.includes('Lifecycle event plugin.installed failed') &&
    developmentDocs.includes('`plugin.installed`') &&
    developmentDocs.includes('`plugin.enabled`') &&
    developmentDocs.includes('`plugin.disabled`') &&
    developmentDocs.includes('`plugin.uninstalled`') &&
    developmentDocs.includes('不包含安装路径、包内文件、配置值、secret、下载密钥或 webhook URL') &&
    manifestDocs.includes('扩展安装/启用/停用/卸载 lifecycle') &&
    platformPlan.includes('扩展安装、启用、停用和卸载 lifecycle 事件自动接入 dispatcher 首版'),
  'plugin lifecycle events must be allowlisted, dispatched, and documented without leaking install paths or secrets'
)

assert.ok(
  schema.includes('model PluginUserData') &&
    schema.includes('@@unique([pluginId, userId, key])') &&
    schema.includes('model PluginStorageItem') &&
    schema.includes('@@unique([pluginId, scopeType, scopeId, key])') &&
    schema.includes('model PluginTableRow') &&
    schema.includes('@@unique([pluginId, tableName, scopeType, scopeId, rowKey])') &&
    schema.includes('model PluginTableMigration') &&
    schema.includes('@@unique([pluginId, tableName, version])') &&
    schema.includes('model PluginStorageBackupRemoteArchive') &&
    schema.includes('@@unique([pluginId, backupId, storageConfigId, remoteFileName])') &&
    scopedStorageMigration.includes('CREATE TABLE "plugin_storage_items"') &&
    tableStorageMigration.includes('CREATE TABLE "plugin_table_rows"') &&
    tableStorageMigration.includes('CREATE TABLE "plugin_table_migrations"') &&
    remoteStorageBackupMigration.includes('CREATE TABLE "plugin_storage_backup_remote_archives"') &&
    remoteStorageBackupMigration.includes('plugin_storage_backup_remote_archives_plugin_id_backup_id_storage_config_id_remote_file_name_key') &&
    db.includes('serializePluginUserData') &&
    db.includes('serializePluginStorageItem') &&
    db.includes('serializePluginTableRow') &&
    db.includes('serializePluginTableMigration') &&
    db.includes('getPluginUserData') &&
    db.includes('getPluginStorageItem') &&
    db.includes('getPluginTableRow') &&
    db.includes('applyPluginTableMigration') &&
    db.includes('countPluginUserDataItems') &&
    db.includes('listPluginStorageScopeCounts') &&
    db.includes('listPluginTableScopeCounts') &&
    db.includes('listPluginTableMigrationCounts') &&
    db.includes('upsertPluginStorageItem') &&
    db.includes('upsertPluginTableRow') &&
    db.includes('deletePluginStorageItems') &&
    db.includes('deletePluginTableRows') &&
    db.includes('upsertPluginUserData') &&
    db.includes('deletePluginUserData') &&
    db.includes('Prisma.JsonNull'),
  'plugin KV storage must use persisted user and scoped models, JSON-safe upserts, and uninstall cleanup helpers'
)

assert.ok(
    userRoute.includes('/:pluginId/storage/:key') &&
    userRoute.includes('/:pluginId/storage-usage') &&
    userRoute.includes('buildPluginStorageWarnings') &&
    userRoute.includes('usageRatio < 0.8') &&
    userRoute.includes("usageRatio >= 1 ? 'critical' : 'warning'") &&
    userRoute.includes('/:pluginId/storage-backup') &&
    userRoute.includes('/:pluginId/storage-backup/restore') &&
    userRoute.includes('PluginStorageBackupRestoreQuery') &&
    userRoute.includes('normalizePluginStorageBackupPayload') &&
    userRoute.includes('buildPluginStorageBackupSummary') &&
    userRoute.includes('buildPluginStorageBackupContentHash') &&
    userRoute.includes('normalizePluginStorageBackupArchiveId') &&
    userRoute.includes('getPluginStorageBackupArchiveDir') &&
    userRoute.includes("resolveInside(getPluginDataDir(), 'storage-backups/plugins')") &&
    userRoute.includes('buildPluginStorageBackup') &&
    userRoute.includes('buildDifferentialPluginStorageBackup') &&
    userRoute.includes('buildPluginStorageBackupDiff') &&
    userRoute.includes('applyPluginStorageBackupDiff') &&
    userRoute.includes('resolvePluginStorageBackupArchiveForRestore') &&
    userRoute.includes("request.query?.mode === 'differential'") &&
    userRoute.includes('baseBackupId') &&
    userRoute.includes('baseContentSha256') &&
    userRoute.includes('diffSha256') &&
    userRoute.includes('diffCounts') &&
    userRoute.includes('PLUGIN_STORAGE_BACKUP_ARCHIVE_HAS_DEPENDENTS') &&
    userRoute.includes('serializePluginStorageBackupArchive') &&
    userRoute.includes('readPluginStorageBackupArchive') &&
    userRoute.includes('Plugin storage backup archive checksum mismatch') &&
    userRoute.includes('normalizeAndValidatePluginStorageBackupForRestore') &&
    userRoute.includes('restorePluginStorageBackup') &&
    userRoute.includes('assertUniquePluginStorageBackupKeys') &&
    userRoute.includes('assertPluginStorageBackupRestoreReferences') &&
    userRoute.includes('duplicate legacy user keys') &&
    userRoute.includes('references missing legacy user data users') &&
    userRoute.includes('contentSha256') &&
    userRoute.includes("mode: 'full'") &&
    userRoute.includes('restorePolicy') &&
    userRoute.includes('/:pluginId/storage-backup/archives') &&
    userRoute.includes('/:pluginId/storage-backup/archives/:backupId') &&
    userRoute.includes('/:pluginId/storage-backup/archives/:backupId/restore') &&
    userRoute.includes('/:pluginId/storage-backup/archives/:backupId/upload-remote') &&
    userRoute.includes('/:pluginId/storage-backup/archives/:backupId/remote/:remoteArchiveId/restore') &&
    userRoute.includes('pluginStorageBackupRemoteArchive.findMany') &&
    userRoute.includes('pluginStorageBackupRemoteArchive.upsert') &&
    userRoute.includes('StorageFactory.create(storageConfig)') &&
    userRoute.includes('provider.uploadStream(createReadStream(archivePath), remoteFileName)') &&
    userRoute.includes('provider.downloadStream(remoteArchive.remoteFileName)') &&
    userRoute.includes('Plugin storage remote backup checksum mismatch') &&
    userRoute.includes("plugin.storage.backup_remote_upload") &&
    userRoute.includes('lastRestoredAt: new Date()') &&
    userRoute.includes('plugin.storage.backup_archive_create') &&
    userRoute.includes('plugin.storage.backup_archive_delete') &&
    userRoute.includes("request.query?.dryRun === 'true'") &&
    userRoute.includes('plugin.storage.restore_dry_run') &&
    userRoute.includes('modified: false') &&
    app.includes('startPluginStorageBackupScheduler') &&
    storageBackupScheduler.includes('PLUGIN_STORAGE_BACKUP_SCHEDULE_ENABLED') &&
    storageBackupScheduler.includes('PLUGIN_STORAGE_BACKUP_INTERVAL_HOURS') &&
    storageBackupScheduler.includes('PLUGIN_STORAGE_BACKUP_RETENTION_COUNT') &&
    storageBackupScheduler.includes('Scheduled plugin storage backups disabled') &&
    storageBackupScheduler.includes('runScheduledPluginStorageBackups') &&
    storageBackupScheduler.includes('startPluginStorageBackupScheduler') &&
    storageBackupScheduler.includes('getLatestPluginStorageArchiveHash') &&
    storageBackupScheduler.includes("plugin.storage.backup_scheduled_skip") &&
    storageBackupScheduler.includes("plugin.storage.backup_scheduled_archive") &&
    storageBackupScheduler.includes('prunePluginStorageArchives') &&
    storageBackupScheduler.includes('content is unchanged') &&
    storageBackupScheduler.includes('retentionCount') &&
    storageBackupScheduler.includes('referencedBaseBackupIds') &&
    storageBackupScheduler.includes("resolveInside(getPluginDataDir(), 'storage-backups/plugins')") &&
    !storageBackupScheduler.includes('payload: backup') &&
    storageTypes.includes('downloadStream(filename: string): Promise<Readable>') &&
    webDavProvider.includes('createReadStream(remotePath)') &&
    ftpProvider.includes('downloadTo(stream') &&
    sftpProvider.includes('client.get(remotePath)') &&
    s3Provider.includes('GetObjectCommand') &&
    s3Provider.includes('PutObjectCommand') &&
    s3Provider.includes('DeleteObjectCommand') &&
    s3Provider.includes('assertSafeStorageTarget') &&
    userRoute.includes('schemaVersion !== 1') &&
    userRoute.includes('Plugin storage backup pluginId mismatch') &&
    userRoute.includes('Plugin storage backup exceeds restore item limit') &&
    userRoute.includes('plugin.storage.backup_export') &&
    userRoute.includes('plugin.storage.restore') &&
    userRoute.includes('/:pluginId/scoped-storage/:scope/:key') &&
    userRoute.includes('/:pluginId/table-storage/:scope/:table/:rowKey') &&
    userRoute.includes('/:pluginId/table-storage/:table/migrations') &&
    userRoute.includes('normalizeStorageKey') &&
    userRoute.includes('normalizePluginTableName') &&
    userRoute.includes('normalizePluginTableRowKey') &&
    userRoute.includes('normalizeStorageScope') &&
    userRoute.includes('assertPluginStorageScope') &&
    userRoute.includes('assertPluginTableScope') &&
    userRoute.includes('resolvePluginTable') &&
    userRoute.includes('resolvePluginStorageScope') &&
    userRoute.includes('assertPluginStorageAccess') &&
    userRoute.includes("manifest.capabilities?.storage?.kind !== 'kv'") &&
    userRoute.includes("hasPluginPermission(manifest, 'plugin-storage:read')") &&
    userRoute.includes("hasPluginPermission(manifest, 'plugin-storage:write')") &&
    userRoute.includes('PLUGIN_GLOBAL_STORAGE_ADMIN_REQUIRED') &&
    userRoute.includes('PLUGIN_GLOBAL_TABLE_ADMIN_REQUIRED') &&
    userRoute.includes('PLUGIN_TABLE_MIGRATION_ADMIN_REQUIRED') &&
    userRoute.includes('PLUGIN_STORAGE_SERVICE_NOT_FOUND') &&
    userRoute.includes('Plugin storage value exceeds 64KB') &&
    userRoute.includes('Plugin table row value exceeds 64KB') &&
    userRoute.includes('PLUGIN_STORAGE_KEY_LIMIT') &&
    userRoute.includes('PLUGIN_TABLE_ROW_LIMIT') &&
    userRoute.includes('fastify.authenticateAdmin') &&
    userRoute.includes('legacyUserKeyCount') &&
    userRoute.includes('storageDeclared') &&
    userRoute.includes('warnings,') &&
    userRoute.includes('maxRows') &&
    userRoute.includes("createPluginEvent(pluginId, user.id, 'plugin.storage.write'") &&
    userRoute.includes("createPluginEvent(pluginId, user.id, 'plugin.storage.delete'") &&
    userRoute.includes("createPluginEvent(pluginId, user.id, 'plugin.table.write'") &&
    userRoute.includes("createPluginEvent(pluginId, user.id, 'plugin.table.delete'") &&
    userRoute.includes("createPluginEvent(pluginId, user.id, 'plugin.table.migration'"),
  'plugin storage routes must require enabled plugins, declared storage capability, explicit permissions, payload limits, and audit events'
)

assert.ok(
  runtime.includes("import { assertSafeWebhookUrl } from './outbound-security.js'") &&
    runtime.includes('PLUGIN_ACTION_PAYLOAD_MAX_BYTES') &&
    runtime.includes('PLUGIN_ACTION_RESPONSE_MAX_BYTES') &&
    runtime.includes('PLUGIN_WEBHOOK_SIGNING_SECRET') &&
    runtime.includes('PLUGIN_WEBHOOK_TIMEOUT_MS') &&
    runtime.includes('createHmac') &&
    runtime.includes("permissions.has('plugin-action:run')") &&
    runtime.includes('assertSafeWebhookUrl(action.url)') &&
    runtime.includes("webhookUrl.protocol !== 'https:'") &&
    runtime.includes("redirect: 'manual'") &&
    runtime.includes('AbortSignal.timeout') &&
    runtime.includes("'x-payincus-plugin-signature'") &&
    runtime.includes('export async function dispatchPluginEvent') &&
    runtime.includes("createPluginEvent(input.pluginId, input.actor.id, 'plugin.action.dispatch'"),
  'plugin action runtime must execute signed, bounded, SSRF-guarded webhook actions and expose an event dispatcher'
)

assert.ok(
  userRoute.includes("fastify.post<{ Params: PluginActionParams }>('/:pluginId/actions/:action'") &&
    userRoute.includes('executePluginAction({') &&
    userRoute.includes("source: 'user'") &&
    userRoute.includes('idempotencyKey') &&
    userRoute.includes('PLUGIN_ACTION_FAILED'),
  'plugin action route must call the guarded action runtime instead of returning a placeholder'
)

assert.ok(
  adminPluginRoute.includes('normalizePluginConfigValue') &&
    adminPluginRoute.includes('PluginConfigFieldManifest') &&
    adminPluginRoute.includes('Plugin config key is not declared in manifest') &&
    adminPluginRoute.includes('INVALID_PLUGIN_CONFIG') &&
    adminPluginRoute.includes('/:pluginId/config-files/:key') &&
    adminPluginRoute.includes('PLUGIN_CONFIG_FILE_FIELD_REQUIRED') &&
    adminPluginRoute.includes('Plugin config file must be a PNG, JPEG, or WebP image') &&
    adminPluginRoute.includes('Plugin config file exceeds 2MB') &&
    adminPluginRoute.includes('plugin.config_file.upload') &&
    adminPluginRoute.includes('must be an uploaded plugin config file URL') &&
    adminPluginRoute.includes("field.secret === true || field.type === 'password'") &&
    adminPluginRoute.includes('must match one of the configured options') &&
    adminPluginRoute.includes('must be a valid email') &&
    adminPluginRoute.includes('must be a hex color'),
  'admin plugin config route must validate standard configSchema fields and secret/password storage'
)

assert.ok(
  userRoute.includes('/:pluginId/config-files/:key/:filename') &&
    userRoute.includes('PLUGIN_CONFIG_FILE_NOT_FOUND') &&
    userRoute.includes("field.type !== 'file'") &&
    userRoute.includes('currentValue !== expectedValue') &&
    userRoute.includes("join('config-files', pluginId, key, filename)") &&
    userRoute.includes("header('X-Content-Type-Options', 'nosniff')"),
  'user plugin route must serve uploaded config files only when enabled plugin config currently references the file'
)

assert.ok(
  userRoute.includes("fastify.post<{ Params: PluginGatewayActionParams; Body: PluginGatewayActionBody }>('/:pluginId/gateway-actions/:hook'") &&
    userRoute.includes("fastify.get<{ Params: { hook: string }; Querystring: PluginGatewayTargetsQuery }>('/gateway-actions/:hook/targets'") &&
    userRoute.includes('listEnabledGatewayExtensionTargets') &&
    userRoute.includes('dispatchPluginGatewayExtension') &&
    extensionDispatch.includes('PLUGIN_GATEWAY_EXTENSION_NOT_DECLARED') &&
    extensionDispatch.includes('PLUGIN_GATEWAY_EXTENSION_AMBIGUOUS') &&
    extensionDispatch.includes('export async function dispatchPluginGatewayExtension') &&
    extensionDispatch.includes('export async function listEnabledGatewayExtensionTargets') &&
    extensionDispatch.includes('buildPluginGatewayExtensionContractPayload') &&
    extensionDispatch.includes('normalizePluginExtensionContractResult(action.result)') &&
    extensionDispatch.includes('contract.accepted ?') &&
    extensionContracts.includes('contractKind: \'gateway-extension\'') &&
    extensionContracts.includes("status: ['accepted', 'pending', 'completed', 'failed', 'unsupported']") &&
    extensionContracts.includes('normalizePluginExtensionContractResult') &&
    extensionDispatch.includes('providerCode') &&
    extensionDispatch.includes("createPluginEvent(input.pluginId, input.actor.id, 'plugin.gateway-extension.dispatch'") &&
    pluginPaymentLifecycle.includes('export function dispatchGatewayPaymentLifecycle') &&
    pluginPaymentLifecycle.includes('listEnabledGatewayExtensionTargets(input.hook, providerCode)') &&
    pluginPaymentLifecycle.includes('dispatchPluginGatewayExtension({') &&
    pluginPaymentLifecycle.includes('gateway-lifecycle:') &&
    pluginPaymentLifecycle.includes('maskExternalReference(input.tradeNo)') &&
    pluginPaymentLifecycle.includes('payment state is never rolled back here') &&
    !pluginPaymentLifecycle.includes('providerConfigSnapshot') &&
    !pluginPaymentLifecycle.includes('callbackData') &&
    schema.includes('plugin_gateway // 插件支付网关') &&
    schema.includes('enum RechargeRefundStatus') &&
    schema.includes('model RechargeRefundRequest') &&
    schema.includes('@@map("recharge_refund_requests")') &&
    rechargeRefundMigration.includes('CREATE TYPE "RechargeRefundStatus"') &&
    rechargeRefundMigration.includes('CREATE TABLE "recharge_refund_requests"') &&
    rechargeRoute.includes("const PLUGIN_GATEWAY_PROVIDER_TYPE = 'plugin_gateway'") &&
    rechargeRoute.includes("SUPPORTED_RECHARGE_PROVIDER_TYPES = new Set(['yipay', 'heleket', PLUGIN_GATEWAY_PROVIDER_TYPE])") &&
    rechargeRoute.includes('validatePluginGatewayProviderTarget') &&
    rechargeRoute.includes('listEnabledGatewayExtensionTargets(hook, parsed.pluginConfig.providerCode)') &&
    rechargeRoute.includes('createPluginGatewayRechargePayUrl') &&
    rechargeRoute.includes("hook: 'createPayment'") &&
    rechargeRoute.includes("['payUrl', 'paymentUrl', 'redirectUrl', 'checkoutUrl']") &&
    rechargeRoute.includes('插件支付跳转地址必须使用 HTTPS') &&
    rechargeRoute.includes('provider.type !== PLUGIN_GATEWAY_PROVIDER_TYPE') &&
    rechargeRoute.includes('handlePluginGatewayPaymentCallback') &&
    rechargeRoute.includes('dispatchPluginGatewayPaymentHook') &&
    rechargeRoute.includes("hook: 'webhook'") &&
    rechargeRoute.includes("hook: 'verifyPayment'") &&
    rechargeRoute.includes("source: 'plugin_gateway_verify'") &&
    rechargeRoute.includes('buildPluginGatewayCallbackHeaders') &&
    rechargeRoute.includes('PLUGIN_GATEWAY_CALLBACK_HEADER_BLOCKLIST') &&
    rechargeRoute.includes('normalizePluginGatewayDispatchResult') &&
    rechargeRoute.includes('isRechargeGatewayOrderNoMatch(record.orderNo, pluginResult.orderNo)') &&
    rechargeRoute.includes('Math.abs(pluginResult.actualAmount - expectedAmount)') &&
    rechargeRoute.includes('插件支付主动验单金额与订单金额不匹配') &&
    rechargeRoute.includes('markCallbackProcessed(providerIdNum, record.orderNo, tradeNoForIndex, clientIp)') &&
    rechargeRoute.includes('Plugin gateway amount mismatch rejected') &&
    rechargeRoute.includes('completeRecharge(record.orderNo') &&
    adminBillingRoute.includes("const PLUGIN_GATEWAY_PROVIDER_TYPE = 'plugin_gateway'") &&
    adminBillingRoute.includes('dispatchPluginGatewayExtension') &&
    adminBillingRoute.includes("hook: 'verifyPayment'") &&
    adminBillingRoute.includes("source: 'plugin_gateway_admin_sync'") &&
    adminBillingRoute.includes('validatePluginGatewayProviderTarget') &&
    adminBillingRoute.includes('插件支付渠道未找到已启用且 providerCode 匹配的 ${hook} 网关扩展') &&
    adminBillingRoute.includes("validatePluginGatewayProviderTarget(effectiveConfig, 'refund')") &&
    adminBillingRoute.includes("hook: 'refund'") &&
    adminBillingRoute.includes("idempotencyKey: `plugin-gateway-refund:") &&
    adminBillingRoute.includes('/api/admin/billing/recharge-records/:id/refunds') &&
    adminBillingRoute.includes('/api/admin/billing/recharge-refunds/:id/retry') &&
    adminBillingRoute.includes('processPluginGatewayRechargeRefund') &&
    adminBillingRoute.includes('normalizePluginGatewayRefundDispatchResult') &&
    adminBillingRoute.includes('claimRechargeRefundForProcessing') &&
    adminBillingRoute.includes('completeRechargeRefundRequest') &&
    adminBillingRoute.includes('failRechargeRefundRequest') &&
    adminBillingRoute.includes('Math.abs(pluginResult.actualAmount - orderAmount)') &&
    adminBillingRoute.includes('管理员同步-插件支付金额不匹配') &&
    adminBillingRoute.includes('providerId: provider.id') &&
    rechargeDb.includes('export async function createRechargeRefundRequest') &&
    rechargeDb.includes('export async function claimRechargeRefundForProcessing') &&
    rechargeDb.includes('export async function completeRechargeRefundRequest') &&
    rechargeDb.includes('export async function failRechargeRefundRequest') &&
    rechargeDb.includes("status: { in: statuses }") &&
    rechargeDb.includes("status: 'processing'") &&
    rechargeDb.includes("status: 'completed'") &&
    rechargeDb.includes("status: 'refunded'") &&
    rechargeDb.includes("balance: { decrement: refundAmount }") &&
    rechargeDb.includes("balance: { increment: refundAmount }") &&
    rechargeDb.includes('[原路退款预扣]') &&
    rechargeDb.includes('[原路退款失败返还预扣]') &&
    extensionContracts.includes('EXTENSION_CONTRACT_URL_MAX_LENGTH = 2048') &&
    extensionContracts.includes("['payUrl', 'paymentUrl', 'redirectUrl', 'checkoutUrl']") &&
    rechargeRoute.includes("hook: 'createPayment'") &&
    rechargeRoute.includes("hook: 'verifyPayment'") &&
    rechargeRoute.includes("hook: 'webhook'") &&
    rechargeRoute.includes("source: 'recharge.create'") &&
    rechargeRoute.includes("source: 'recharge.verify'") &&
    rechargeRoute.includes("source: 'recharge.callback'") &&
    rechargeRoute.includes("source: 'admin.recharge.manual_complete'") &&
    rechargeRoute.includes("source: 'admin.recharge.manual_fail'") &&
    userRoute.includes('PLUGIN_GATEWAY_ACTION_FAILED'),
  'plugin gateway extension route and payment lifecycle bridge must require admin access, declared hooks, guarded runtime dispatch, standard result contracts, sanitized payloads, and audit events'
)

assert.ok(
  userRoute.includes("fastify.post<{ Params: PluginServiceActionParams; Body: PluginServiceActionBody }>('/:pluginId/service-actions/:hook'") &&
    userRoute.includes("fastify.get<{ Params: { hook: string }; Querystring: PluginServiceTargetsQuery }>('/service-actions/:hook/targets'") &&
    userRoute.includes('fastify.authenticateAdmin') &&
    userRoute.includes('listEnabledServiceExtensionTargets') &&
    userRoute.includes('dispatchPluginServiceExtension') &&
    extensionDispatch.includes('PLUGIN_SERVICE_EXTENSION_NOT_DECLARED') &&
    extensionDispatch.includes('PLUGIN_SERVICE_EXTENSION_AMBIGUOUS') &&
    extensionDispatch.includes('export async function dispatchPluginServiceExtension') &&
    extensionDispatch.includes('export async function listEnabledServiceExtensionTargets') &&
    extensionDispatch.includes('buildPluginServiceExtensionContractPayload') &&
    extensionDispatch.includes('normalizePluginExtensionContractResult(action.result)') &&
    extensionDispatch.includes('contract.accepted ?') &&
    extensionContracts.includes('contractKind: \'service-extension\'') &&
    extensionContracts.includes('externalReference') &&
    extensionContracts.includes('EXTENSION_CONTRACT_METADATA_MAX_KEYS') &&
    extensionDispatch.includes('productId') &&
    extensionDispatch.includes("source: 'system'") &&
    extensionDispatch.includes("createPluginEvent(input.pluginId, input.actor.id, 'plugin.service-extension.dispatch'") &&
    pluginBusinessEvents.includes('SERVICE_EVENT_EXTENSION_HOOKS') &&
    pluginBusinessEvents.includes("'service.provisioned': 'provision'") &&
    pluginBusinessEvents.includes("'service.suspended': 'suspend'") &&
    pluginBusinessEvents.includes("'service.unsuspended': 'unsuspend'") &&
    pluginBusinessEvents.includes("'service.deleted': 'terminate'") &&
    pluginBusinessEvents.includes('dispatchServiceLifecycleExtensionHooks(input)') &&
    pluginBusinessEvents.includes('listEnabledServiceExtensionTargets(hook, productId)') &&
    pluginBusinessEvents.includes('dispatchPluginServiceExtension({') &&
    pluginBusinessEvents.includes('service-lifecycle:') &&
    pluginBusinessEvents.includes('lifecycle state is never rolled back here') &&
    instanceBillingRoute.includes('dispatchInstanceUpgradeServiceExtensions') &&
    instanceBillingRoute.includes("listEnabledServiceExtensionTargets('upgrade'") &&
    instanceBillingRoute.includes("lifecycleEvent: 'service.upgraded'") &&
    instanceBillingRoute.includes('billing and resource changes are not rolled back here') &&
    userRoute.includes('PLUGIN_SERVICE_ACTION_FAILED'),
  'plugin service extension route and lifecycle bridge must require admin access, declared hooks, guarded runtime dispatch, standard result contracts, and audit events'
)

assert.ok(
  envExample.includes('PLUGIN_WEBHOOK_SIGNING_SECRET=') &&
    envExample.includes('PLUGIN_WEBHOOK_TIMEOUT_MS=10000') &&
    envExample.includes('PLUGIN_STORAGE_BACKUP_SCHEDULE_ENABLED=false') &&
    envExample.includes('PLUGIN_STORAGE_BACKUP_INTERVAL_HOURS=24') &&
    envExample.includes('PLUGIN_STORAGE_BACKUP_RETENTION_COUNT=7') &&
    installPanel.includes('PLUGIN_WEBHOOK_SIGNING_SECRET') &&
    installPanel.includes('PLUGIN_WEBHOOK_TIMEOUT_MS'),
  'plugin webhook runtime environment must be documented and provisioned by install script'
)

assert.ok(
  packageRoute.includes("listEnabledServiceExtensionTargets('checkoutConfig'") &&
    packageRoute.includes('checkoutExtensions') &&
    packageRoute.includes('target.productId === null || target.productId === String(pkg.id)') &&
    publicCatalog.includes('PublicPackageCheckoutExtension') &&
    publicCatalog.includes('checkoutExtensions?: PublicPackageCheckoutExtension[]') &&
    marketView.includes('selectedPackage.checkoutExtensions?.length') &&
    marketView.includes('publicSite.market.checkoutExtensionTitle'),
  'public package catalog must expose low-risk checkoutConfig extension targets without executing plugin hooks'
)

assert.ok(
  instanceRoute.includes("listEnabledServiceExtensionTargets('servicePanel'") &&
    instanceRoute.includes('servicePanelExtensions') &&
    instanceRoute.includes('target.productId === null || target.productId === String(instance.package_id)') &&
    clientTypes.includes("servicePanelExtensions?: Array<PluginServiceExtensionTarget & { hook: 'servicePanel' }>") &&
    instanceDetailView.includes('instance.servicePanelExtensions?.length') &&
    instanceDetailView.includes('instance.servicePanelExtensionTitle'),
  'instance detail must expose low-risk servicePanel extension targets without executing plugin hooks'
)

assert.ok(
    clientTypes.includes('PluginCapabilitiesManifest') &&
    clientTypes.includes('PluginConfigFieldManifest') &&
    clientTypes.includes('PluginConfigOptionManifest') &&
    clientTypes.includes('group?: string') &&
    clientTypes.includes('order?: number') &&
    clientTypes.includes('requestSchema?: Record<string, unknown>') &&
    clientTypes.includes('responseSchema?: Record<string, unknown>') &&
    clientTypes.includes('PluginServiceExtensionManifest') &&
    clientTypes.includes('PluginServiceExtensionHook') &&
    clientTypes.includes('PluginGatewayExtensionManifest') &&
    clientTypes.includes('PluginGatewayExtensionHook') &&
    clientTypes.includes("runtime?: 'webhook'") &&
    clientTypes.includes('url?: string') &&
    clientTypes.includes('PluginUserData') &&
    clientTypes.includes('PluginStorageItem') &&
    clientTypes.includes("scopes?: Array<'user' | 'global' | 'service'>") &&
    clientTypes.includes("retention?: 'keep' | 'delete_on_uninstall'") &&
    clientApi.includes('getStorage: (pluginId: string, key: string)') &&
    clientApi.includes('setStorage: (pluginId: string, key: string, value: unknown)') &&
    clientApi.includes('deleteStorage: (pluginId: string, key: string)') &&
    clientApi.includes('getScopedStorage:') &&
    clientApi.includes('setScopedStorage:') &&
    clientApi.includes('deleteScopedStorage:') &&
    clientApi.includes('getTableRow:') &&
    clientApi.includes('setTableRow:') &&
    clientApi.includes('deleteTableRow:') &&
    clientApi.includes('listTableMigrations:') &&
    clientApi.includes('applyTableMigration:') &&
    clientApi.includes('exportStorageBackup:') &&
    clientApi.includes('restoreStorageBackup:') &&
    clientApi.includes('validateStorageBackupRestore:') &&
    clientTypes.includes('PluginTableRow') &&
    clientTypes.includes('PluginTableMigration') &&
    clientTypes.includes('PluginStorageUsage') &&
    clientTypes.includes('PluginStorageBackup') &&
    clientTypes.includes('backupId?: string') &&
    clientTypes.includes('contentSha256?: string') &&
    clientTypes.includes('PluginStorageRestoreResult') &&
    clientTypes.includes('PluginStorageRestoreDryRunResult') &&
    clientTypes.includes('PluginStorageBackupArchive') &&
    clientTypes.includes('remoteArchives?: PluginStorageBackupRemoteArchive[]') &&
    clientTypes.includes('export interface PluginStorageBackupRemoteArchive') &&
    clientTypes.includes('warnings: Array<{') &&
    clientTypes.includes("level: 'warning' | 'critical'") &&
    clientTypes.includes('PluginServiceExtensionTarget') &&
    clientTypes.includes('PluginGatewayExtensionTarget') &&
    adminClientApi.includes('getStorageUsage') &&
    adminClientApi.includes('/storage-usage') &&
    adminClientApi.includes('exportStorageBackup') &&
    adminClientApi.includes('/storage-backup') &&
    adminClientApi.includes('restoreStorageBackup') &&
    adminClientApi.includes('/storage-backup/restore') &&
    adminClientApi.includes('validateStorageBackupRestore') &&
    adminClientApi.includes('listStorageBackupArchives') &&
    adminClientApi.includes('createStorageBackupArchive') &&
    adminClientApi.includes('downloadStorageBackupArchive') &&
    adminClientApi.includes('validateStorageBackupArchiveRestore') &&
    adminClientApi.includes('restoreStorageBackupArchive') &&
    adminClientApi.includes('uploadStorageBackupArchiveRemote') &&
    adminClientApi.includes('validateRemoteStorageBackupArchiveRestore') &&
    adminClientApi.includes('restoreRemoteStorageBackupArchive') &&
    adminClientApi.includes('deleteStorageBackupArchive') &&
    adminClientApi.includes('/storage-backup/archives') &&
    pluginCenter.includes('pluginStorageUsage') &&
    pluginCenter.includes('pluginStorageBackupArchives') &&
    pluginCenter.includes('getStorageUsage') &&
    pluginCenter.includes('存储用量') &&
    pluginCenter.includes('exportPluginStorageBackup') &&
    pluginCenter.includes('uploadPluginStorageBackupArchiveRemote') &&
    pluginCenter.includes('validatePluginStorageRemoteBackupArchiveRestore') &&
    pluginCenter.includes('restorePluginStorageRemoteBackupArchive') &&
    pluginCenter.includes('远端恢复') &&
    pluginCenter.includes('createPluginStorageBackupArchive') &&
    pluginCenter.includes('downloadPluginStorageBackupArchive') &&
    pluginCenter.includes('validatePluginStorageBackupArchiveRestore') &&
    pluginCenter.includes('restorePluginStorageBackupArchive') &&
    pluginCenter.includes('deletePluginStorageBackupArchive') &&
    pluginCenter.includes('归档备份') &&
    pluginCenter.includes('onPluginStorageBackupSelected') &&
    pluginCenter.includes('validateStorageBackupRestore') &&
    pluginCenter.includes('恢复备份会替换该扩展当前所有 KV、私有表和 migration ledger') &&
    pluginCenter.includes('storageWarningClass') &&
    pluginCenter.includes('formatStorageUsageRatio') &&
    pluginCenter.includes('pluginStorageUsage.warnings') &&
    adminClientApi.includes('listServiceExtensionTargets') &&
    adminClientApi.includes('/plugins/service-actions/') &&
    adminClientApi.includes('listGatewayExtensionTargets') &&
    adminClientApi.includes('/plugins/gateway-actions/') &&
    adminClientApi.includes('uploadConfigFile:') &&
    adminClientApi.includes('/config-files/') &&
    pluginSettingsView.includes('standardConfigFields') &&
    pluginSettingsView.includes('standardConfigGroups') &&
    pluginSettingsView.includes('configGroupName') &&
    pluginSettingsView.includes('uploadStandardConfigFile') &&
    pluginSettingsView.includes('accept="image/png,image/jpeg,image/webp"') &&
    pluginSettingsView.includes('saveStandardSettings') &&
    pluginSettingsView.includes("field.type === 'password'") &&
    pluginSettingsView.includes('PluginConfigFieldManifest'),
  'client API types must expose plugin storage helpers, capability metadata, and standard config schema UI'
)

assert.ok(
    developmentDocs.includes('GET /api/plugins/:pluginId/storage/:key') &&
    developmentDocs.includes('标准 `configSchema`') &&
    developmentDocs.includes('`group` 和 `order`') &&
    developmentDocs.includes('PLUGIN_DATA_DIR/config-files') &&
    developmentDocs.includes('/api/plugins/:pluginId/config-files/:key/:filename') &&
    developmentDocs.includes('PUT /api/admin/plugins/:pluginId/config') &&
    developmentDocs.includes('INVALID_PLUGIN_CONFIG') &&
    developmentDocs.includes('PUT /api/plugins/:pluginId/storage/:key') &&
    developmentDocs.includes('GET /api/plugins/:pluginId/storage-usage') &&
    developmentDocs.includes('GET /api/plugins/:pluginId/storage-backup') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/storage-backup/restore') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/storage-backup/restore?dryRun=true') &&
    developmentDocs.includes('GET /api/plugins/:pluginId/storage-backup/archives') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/storage-backup/archives?mode=differential') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/storage-backup/archives/:backupId/restore?dryRun=true') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/storage-backup/archives/:backupId/upload-remote') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/storage-backup/archives/:backupId/remote/:remoteArchiveId/restore?dryRun=true') &&
    developmentDocs.includes('PLUGIN_DATA_DIR/storage-backups/plugins/<pluginId>/<backupId>.json') &&
    developmentDocs.includes('远端归档复用平台已有远程存储适配器') &&
    developmentDocs.includes('当前支持 S3-compatible 对象存储') &&
    developmentDocs.includes('列表接口不会返回 secret') &&
    developmentDocs.includes('plugin_storage_backup_remote_archives') &&
    developmentDocs.includes('PLUGIN_STORAGE_BACKUP_SCHEDULE_ENABLED=true') &&
    developmentDocs.includes('plugin-storage-backup-scheduler') &&
    developmentDocs.includes('plugin.storage.backup_scheduled_skip') &&
    developmentDocs.includes('plugin.storage.backup_scheduled_archive') &&
    developmentDocs.includes('mode = differential') &&
    developmentDocs.includes('baseBackupId') &&
    developmentDocs.includes('baseContentSha256') &&
    developmentDocs.includes('diffSha256') &&
    developmentDocs.includes('PLUGIN_STORAGE_BACKUP_ARCHIVE_HAS_DEPENDENTS') &&
    developmentDocs.includes('PLUGIN_STORAGE_BACKUP_RETENTION_COUNT') &&
    developmentDocs.includes('`contentSha256`') &&
    developmentDocs.includes('`plugin.storage.restore_dry_run`') &&
    developmentDocs.includes('`modified = false`') &&
    developmentDocs.includes('后台只读观测接口，只允许管理员访问') &&
    developmentDocs.includes('只读阈值告警') &&
    developmentDocs.includes('达到 80% 配额时返回 `warning`') &&
    developmentDocs.includes('达到或超过配额时返回 `critical`') &&
    developmentDocs.includes('管理员备份/恢复通道') &&
    developmentDocs.includes('替换该扩展当前存储数据') &&
    developmentDocs.includes('备份内容包含扩展私有 value') &&
    developmentDocs.includes('GET /api/plugins/:pluginId/scoped-storage/:scope/:key') &&
    developmentDocs.includes('GET /api/plugins/:pluginId/table-storage/:scope/:table/:rowKey') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/table-storage/:table/migrations') &&
    developmentDocs.includes('capabilities.storage.tables') &&
    developmentDocs.includes('migration ledger') &&
    developmentDocs.includes('retention = keep') &&
    developmentDocs.includes('plugin-storage:read') &&
    developmentDocs.includes('plugin-storage:write') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/actions/:action') &&
    developmentDocs.includes('服务扩展类型') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/service-actions/:hook') &&
    developmentDocs.includes('GET /api/plugins/service-actions/:hook/targets?productId=vps-basic') &&
    developmentDocs.includes('Discovery 只返回已启用扩展声明过的目标，不执行 webhook，不修改实例或订单') &&
    developmentDocs.includes('公开套餐目录会返回匹配当前套餐 ID 或未绑定具体套餐的 `checkoutConfig` 目标元数据') &&
    developmentDocs.includes('已登录服务详情会返回匹配当前实例套餐 ID 或未绑定具体套餐的 `servicePanel` 目标元数据') &&
    developmentDocs.includes('按 `hook` 和 `productId` 发现已启用扩展目标') &&
    developmentDocs.includes('实例 lifecycle 首版已经自动接入 `service.provisioned -> provision`') &&
    developmentDocs.includes('`service.suspended -> suspend`') &&
    developmentDocs.includes('`service.unsuspended -> unsuspend`') &&
    developmentDocs.includes('`service.deleted -> terminate`') &&
    developmentDocs.includes('`service.upgraded -> upgrade`') &&
    developmentDocs.includes('不会回滚或覆盖 PayIncus 已完成的实例状态、套餐、余额或计费记录') &&
    developmentDocs.includes('扩展 webhook 失败只会写入扩展事件失败日志') &&
    developmentDocs.includes('contractVersion = 1') &&
    developmentDocs.includes('"externalReference": "ticket-1001"') &&
    developmentDocs.includes('不会直接写实例状态、订单状态、余额或资源交付结果') &&
    developmentDocs.includes('service-extension:provision') &&
    developmentDocs.includes('plugin.service-extension.dispatch') &&
    developmentDocs.includes('支付网关扩展类型') &&
    developmentDocs.includes('POST /api/plugins/:pluginId/gateway-actions/:hook') &&
    developmentDocs.includes('GET /api/plugins/gateway-actions/:hook/targets?providerCode=custompay') &&
    developmentDocs.includes('Discovery 只返回已启用扩展声明过的目标，不执行 webhook，不修改订单、支付、余额或退款状态') &&
    developmentDocs.includes('按 `hook` 和 `providerCode` 发现已启用扩展目标') &&
    developmentDocs.includes('支付 lifecycle 首版已经自动接入充值建单、主动验单、支付回调和管理员人工完成/失败路径') &&
    developmentDocs.includes('不会包含 `providerConfigSnapshot`、支付渠道密钥、原始回调 payload 或完整交易号') &&
    developmentDocs.includes('`gateway-lifecycle:*` 幂等键') &&
    developmentDocs.includes('不会回滚或覆盖 PayIncus 已完成的订单、余额、回调幂等或人工操作结果') &&
    developmentDocs.includes('响应会被标准化为 `{ accepted, status, message, externalReference, metadata }`') &&
    developmentDocs.includes('PayIncus 不会因为该响应直接入账、任意改余额或任意改订单状态') &&
    developmentDocs.includes('只有插件确认 `completed` 后才记录 provider refund 信息') &&
    developmentDocs.includes('gateway-extension:create-payment') &&
    developmentDocs.includes('plugin.gateway-extension.dispatch') &&
    developmentDocs.includes('PLUGIN_WEBHOOK_SIGNING_SECRET') &&
    manifestDocs.includes('"capabilities"') &&
    manifestDocs.includes('## Manifest 当前能力') &&
    manifestDocs.includes('PayIncus manifest 已经是 capability-driven 格式') &&
    !manifestDocs.includes('现有 manifest 只描述页面、配置、权限文本和模板') &&
    !manifestDocs.includes('后续 manifest 需要升级为 capability-driven 格式') &&
    enManifestDocs.includes('# Extension Manifest') &&
    enManifestDocs.includes('## Current Capability Manifest') &&
    enManifestDocs.includes('The PayIncus manifest is already capability-driven') &&
    enManifestDocs.includes('"actions"') &&
    enManifestDocs.includes('"serviceExtensions"') &&
    enManifestDocs.includes('"gatewayExtensions"') &&
    enManifestDocs.includes('"notificationTemplates"') &&
    enManifestDocs.includes('"scopes": ["user", "global", "service"]') &&
    enManifestDocs.includes('/api/plugins/:pluginId/table-storage/:scope/:table/:rowKey') &&
    enManifestDocs.includes('This is not arbitrary SQL execution') &&
    enManifestDocs.includes('## Theme Manifest') &&
    enManifestDocs.includes('payincus.theme.json') &&
    enManifestDocs.includes('Themes cannot declare scripts, backend runtimes, capabilities, entrypoints or backend actions') &&
    !enManifestDocs.includes('# Plugin Manifest') &&
    manifestDocs.includes('"configSchema"') &&
    manifestDocs.includes('"tables"') &&
    manifestDocs.includes('"campaign_reservations"') &&
    manifestDocs.includes('/api/plugins/:pluginId/table-storage/:scope/:table/:rowKey') &&
    manifestDocs.includes('"group": "基础配置"') &&
    manifestDocs.includes('"order": 10') &&
    manifestDocs.includes('`file` 字段首版') &&
    manifestDocs.includes('"type": "password"') &&
    manifestDocs.includes('"secret": true') &&
    manifestDocs.includes('"requestSchema"') &&
    manifestDocs.includes('"responseSchema"') &&
    manifestDocs.includes('不能包含 `$ref`') &&
    manifestDocs.includes('"runtime": "webhook"') &&
    manifestDocs.includes('"url": "https://extension.example.com/payincus/actions/reserve-stock"') &&
    manifestDocs.includes('"serviceExtensions"') &&
    manifestDocs.includes('"provision": "reserveStock"') &&
    manifestDocs.includes('"gatewayExtensions"') &&
    manifestDocs.includes('"createPayment": "createGatewayPayment"') &&
    manifestDocs.includes('"notificationTemplates"') &&
    manifestDocs.includes('plugin:<pluginId>:<templateId>') &&
    manifestDocs.includes('notifications:send') &&
    manifestDocs.includes('"storage":') &&
    manifestDocs.includes('"scopes": ["user", "global", "service"]') &&
    manifestDocs.includes('## 主题 Manifest') &&
    manifestDocs.includes('主题包已经使用独立 `payincus.theme.json`') &&
    !manifestDocs.includes('## 主题 Manifest 方向') &&
    platformPlan.includes('用户级 KV 存储首版') &&
    platformPlan.includes('全局/服务级 scoped KV 存储、平台托管私有表空间、migration ledger、后台只读存储用量/配额观测、卸载保留/清理策略、带 `contentSha256` 的完整备份导出、服务器本地归档、差异归档、S3-compatible/WEBDAV/FTP/SFTP 远端归档、定时归档调度器、替换式恢复和恢复 dry-run 演练记录首版') &&
    platformPlan.includes('远端归档上传') &&
    platformPlan.includes('远端归档 dry-run/恢复') &&
    platformPlan.includes('plugin_storage_backup_remote_archives') &&
    platformPlan.includes('S3-compatible/WEBDAV/FTP/SFTP 远端归档') &&
    platformPlan.includes('差异归档需要匹配 base 完整归档') &&
    platformPlan.includes('本地完整归档、本地差异归档') &&
    platformPlan.includes('`POST /archives?mode=differential` 会基于最近完整归档生成差异包') &&
    platformPlan.includes('/storage-backup/archives') &&
    platformPlan.includes('PLUGIN_STORAGE_BACKUP_SCHEDULE_ENABLED=true') &&
    platformPlan.includes('后台只读存储用量/配额观测') &&
    platformPlan.includes('80%/100% 阈值告警') &&
    platformPlan.includes('GET /api/plugins/:pluginId/storage-backup') &&
    platformPlan.includes('POST /api/plugins/:pluginId/storage-backup/restore') &&
    platformPlan.includes('Webhook action runtime 首版') &&
    platformPlan.includes('Action request/response schema 契约声明首版') &&
    platformPlan.includes('标准扩展 `configSchema` 校验') &&
    platformPlan.includes('字段分组排序') &&
    platformPlan.includes('扩展和主题 file 图片受控上传') &&
    platformPlan.includes('服务扩展') &&
    platformPlan.includes('capabilities.serviceExtensions') &&
    platformPlan.includes('可复用内部 dispatch 服务层') &&
    platformPlan.includes('标准结果契约') &&
    platformPlan.includes('{ accepted, status, message, externalReference, metadata }') &&
    platformPlan.includes('公开套餐 `checkoutConfig` 目标展示') &&
    platformPlan.includes('服务详情 `servicePanel` 目标展示') &&
    platformPlan.includes('实例交付成功、封停、解封、删除和套餐升级后已自动异步派发') &&
    platformPlan.includes('`service-lifecycle:*` 幂等键') &&
    platformPlan.includes('暂未让扩展返回值直接驱动实例创建/暂停/恢复/终止/升级状态机') &&
    platformPlan.includes('支付网关扩展') &&
    platformPlan.includes('capabilities.gatewayExtensions') &&
    platformPlan.includes('Gateway Extension 支付 lifecycle 自动派发首版') &&
    platformPlan.includes('后台支付渠道已支持 `plugin_gateway` 首版') &&
    platformPlan.includes('同步执行 `createPayment` 并只接受 HTTPS 支付跳转 URL') &&
    platformPlan.includes('通过受控 `webhook` 回调归一化支付结果') &&
    platformPlan.includes('支付回调会调用绑定插件的 `webhook` hook 归一化结果，用户主动验单和管理员后台手动同步会调用绑定插件的 `verifyPayment` hook 归一化结果') &&
    platformPlan.includes('插件返回的金额只用于实付校验') &&
    developmentDocs.includes('新增支付渠道时选择 `plugin_gateway`') &&
    developmentDocs.includes('metadata.payUrl') &&
    developmentDocs.includes('最多保留 2048 字符') &&
    developmentDocs.includes('`plugin_gateway` 回调首版已经接入通用 `/api/recharge/callback/:providerId`') &&
    developmentDocs.includes('订单号匹配、providerId 匹配、金额与应付金额一致') &&
    developmentDocs.includes('`cookie`、`authorization` 和 `proxy-authorization` 头不会转发给插件') &&
    developmentDocs.includes('用户主动验单也已接入同一套受控模型') &&
    developmentDocs.includes('会调用绑定插件的 `verifyPayment` hook') &&
    developmentDocs.includes('管理员后台手动同步也支持 `plugin_gateway`') &&
    developmentDocs.includes('`plugin_gateway` 原路退款已有独立状态机') &&
    developmentDocs.includes('POST /api/admin/billing/recharge-records/:id/refunds') &&
    developmentDocs.includes('POST /api/admin/billing/recharge-refunds/:id/retry') &&
    platformPlan.includes('`gateway-lifecycle:*` 幂等键') &&
    platformPlan.includes('原路退款已有独立 `RechargeRefundRequest` 状态机') &&
    platformPlan.includes('`plugin-gateway-refund:*` 幂等键') &&
    platformPlan.includes('事件 dispatcher 首版'),
  'plugin development docs must describe current storage runtime and manifest capability declarations'
)

assert.ok(
  rootPackage.includes('"test:extension-platform"') &&
    rootPackage.includes('pnpm --filter server test:extension-platform-guards') &&
    rootPackage.includes('"verify:extension-platform"') &&
    rootPackage.includes('pnpm test:extension-platform && pnpm --filter server type-check && pnpm --filter client build') &&
    rootPackage.includes('pnpm --filter server test:frontend-dist-boundary-guards && pnpm --filter server build') &&
    rootPackage.includes('pnpm --dir docs-site --ignore-workspace build') &&
    rootPackage.includes('pnpm --filter server test:plugin-template-guards') &&
    rootPackage.includes('pnpm --filter server test:oauth-provider-guards') &&
    rootPackage.includes('pnpm --filter server test:public-api-sdk-guards') &&
    serverPackage.includes('"test:extension-platform-guards"') &&
    serverPackage.includes('pnpm test:plugin-center-guards') &&
    serverPackage.includes('pnpm test:plugin-market-submission-scan-guards') &&
    serverPackage.includes('pnpm test:plugin-runtime-capabilities-guards') &&
    serverPackage.includes('pnpm test:theme-system-guards') &&
    serverPackage.includes('pnpm test:oauth-provider-guards') &&
    serverPackage.includes('pnpm test:public-api-sdk-guards') &&
    platformPlan.includes('pnpm verify:extension-platform') &&
    platformPlan.includes('git diff --check'),
  'extension platform acceptance scripts must aggregate plugin, market, theme, OAuth, Public API, SDK, builds, docs, and diff checks for final pre-OTA verification'
)

console.log('plugin runtime capability guard tests passed')
