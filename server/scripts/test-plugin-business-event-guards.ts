import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const manifest = read('server/src/lib/plugin-manifest.ts')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260626140000_add_plugin_event_retry_fields/migration.sql')
const dedupeMigration = read('server/prisma/migrations/20260626170000_add_plugin_event_dedupe_monitoring/migration.sql')
const alertPreferenceMigration = read('server/prisma/migrations/20260626190000_add_plugin_event_alert_preferences/migration.sql')
const dedupeLockMigration = read('server/prisma/migrations/20260626213000_add_plugin_event_dedupe_locks/migration.sql')
const runtime = read('server/src/lib/plugin-runtime.ts')
const emitter = read('server/src/lib/plugin-event-emitter.ts')
const adminRoutes = read('server/src/routes/admin-plugins.ts')
const scheduler = read('server/src/services/plugin-event-retry-scheduler.ts')
const alertPreferences = read('server/src/lib/plugin-event-alert-preferences.ts')
const app = read('server/src/app.ts')
const adminApi = read('client/src/api/admin.ts')
const apiTypes = read('client/src/types/api.ts')
const pluginCenterView = read('client/src/views/admin/PluginCenterView.vue')
const rechargeDb = read('server/src/db/recharge-records.ts')
const ticketRoutes = read('server/src/routes/tickets.ts')
const instanceRoutes = read('server/src/routes/instances.ts')
const instanceTaskWorker = read('server/src/workers/instanceTaskWorker.ts')
const hostRoutes = read('server/src/routes/hosts.ts')
const billingScheduler = read('server/src/services/billing-scheduler.ts')
const notifier = read('server/src/lib/notifier.ts')
const businessEvents = read('server/src/lib/plugin-business-events.ts')
const publicApiRoutes = read('server/src/routes/public-api.ts')
const authRoutes = read('server/src/routes/auth.ts')
const userRoutes = read('server/src/routes/users.ts')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const manifestDocs = read('docs-site/docs/plugins/manifest.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')

assert.ok(
    manifest.includes("'order.created'") &&
    manifest.includes("'order.paid'") &&
    manifest.includes("'payment.failed'") &&
    manifest.includes("'service.provisioned'") &&
    manifest.includes("'service.suspended'") &&
    manifest.includes("'service.unsuspended'") &&
    manifest.includes("'service.deleted'") &&
    manifest.includes("'service.task.queued'") &&
    manifest.includes("'service.task.cancelled'") &&
    manifest.includes("'service.task.completed'") &&
    manifest.includes("'service.task.failed'") &&
    manifest.includes("'service.resource.rollback.completed'") &&
    manifest.includes("'service.resource.rollback.failed'") &&
    manifest.includes("'ticket.created'") &&
    manifest.includes("'ticket.replied'") &&
    manifest.includes("'ticket.status.changed'") &&
    manifest.includes("'user.registered'") &&
    manifest.includes("'user.login'") &&
    manifest.includes("'user.profile.updated'") &&
    manifest.includes("'user.status.changed'") &&
    manifest.includes("'notification.sent'") &&
    runtime.includes('export async function dispatchPluginEvent') &&
    runtime.includes('source: \'event\'') &&
    runtime.includes('eventName: event'),
  'plugin event runtime must expose the allowed order, payment, and ticket events'
)

assert.ok(
  emitter.includes('export function emitPluginEvent') &&
    emitter.includes('void dispatchPluginEvent') &&
    emitter.includes('.catch(error =>') &&
    emitter.includes('console.error(`[PluginEvent] Failed to dispatch ${event}: ${message}`)'),
  'business plugin events must be emitted asynchronously so webhook failure does not block core payment or ticket flows'
)

assert.ok(
  schema.includes('eventName String?  @map("event_name")') &&
    schema.includes('retryCount Int') &&
    schema.includes('deadLetterAt DateTime? @map("dead_letter_at")') &&
    schema.includes('dedupeKey String? @map("dedupe_key")') &&
    schema.includes('lastAttemptAt DateTime? @map("last_attempt_at")') &&
    schema.includes('@@index([pluginId, eventName, handler, dedupeKey])') &&
    schema.includes('model PluginEventDedupeLock') &&
    schema.includes('@@unique([pluginId, eventName, handler, dedupeKey])') &&
    schema.includes('model PluginEventAlertPreference') &&
    schema.includes('minimumLevel             String   @default("warning")') &&
    schema.includes('cooldownMinutes          Int      @default(360)') &&
    schema.includes('successRateThreshold     Int      @default(95)') &&
    schema.includes('@@unique([userId, pluginId])') &&
    migration.includes('ADD COLUMN "event_name" TEXT') &&
    migration.includes('ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0') &&
    migration.includes('ADD COLUMN "dead_letter_at" TIMESTAMP(3)') &&
    migration.includes('plugin_event_logs_next_retry_at_idx') &&
    dedupeMigration.includes('ADD COLUMN "dedupe_key" TEXT') &&
    dedupeMigration.includes('ADD COLUMN "last_attempt_at" TIMESTAMP(3)') &&
    dedupeMigration.includes('plugin_event_logs_plugin_id_event_name_handler_dedupe_key_idx') &&
    dedupeLockMigration.includes('CREATE TABLE "plugin_event_dedupe_locks"') &&
    dedupeLockMigration.includes('plugin_event_dedupe_locks_plugin_id_event_name_handler_dedupe_key_key') &&
    alertPreferenceMigration.includes('CREATE TABLE "plugin_event_alert_preferences"') &&
    alertPreferenceMigration.includes('"cooldown_minutes" INTEGER NOT NULL DEFAULT 360') &&
    alertPreferenceMigration.includes('"success_rate_threshold" INTEGER NOT NULL DEFAULT 95'),
  'plugin event logs and alert preferences must persist replayable metadata, retry state, dedupe keys, and developer alert policy'
)

assert.ok(
    rechargeDb.includes("emitPluginEvent('order.created'") &&
    rechargeDb.includes("emitPluginEvent('order.paid'") &&
    rechargeDb.includes('result.completedNow') &&
    rechargeDb.includes("emitPluginEvent('payment.failed'") &&
    rechargeDb.includes('dedupeKey: `order.created:recharge:${record.orderNo}`') &&
    rechargeDb.includes('dedupeKey: `order.paid:recharge:${result.orderNo}`') &&
    rechargeDb.includes('dedupeKey: `payment.failed:recharge:${record.orderNo}`') &&
    rechargeDb.includes('updateResult.count > 0') &&
    rechargeDb.includes("resource: 'recharge'") &&
    rechargeDb.includes('orderNo') &&
    rechargeDb.includes('rechargeId'),
  'recharge order creation, successful completion, and failed payment transitions must emit plugin events without duplicate idempotent paid/failed delivery'
)

assert.ok(
    ticketRoutes.includes("emitPluginEvent('ticket.created'") &&
    ticketRoutes.includes("emitPluginEvent('ticket.replied'") &&
    ticketRoutes.includes('dedupeKey: `ticket.created:${result.ticketId}:${result.messageId}`') &&
    ticketRoutes.includes('dedupeKey: `ticket.replied:${ticketId}:${message.id}`') &&
    ticketRoutes.includes('attachmentCount: uploadedAttachments.length') &&
    ticketRoutes.includes('isFromOwner: access.isOwner') &&
    ticketRoutes.includes('subject: ticket.subject'),
  'ticket creation and replies must emit plugin events with useful ticket context'
)

assert.ok(
  businessEvents.includes('export function emitServicePluginEvent') &&
    businessEvents.includes('export function emitServiceTaskPluginEvent') &&
    businessEvents.includes('export function emitServiceResourceRollbackPluginEvent') &&
    businessEvents.includes('export function emitNotificationSentPluginEvent') &&
    businessEvents.includes("emitPluginEvent('notification.sent'") &&
    instanceRoutes.includes("event: 'service.provisioned'") &&
    instanceRoutes.includes("event: 'service.suspended'") &&
    instanceRoutes.includes("event: 'service.unsuspended'") &&
    instanceRoutes.includes("event: 'service.deleted'") &&
    hostRoutes.includes("event: 'service.suspended'") &&
    hostRoutes.includes("event: 'service.unsuspended'") &&
    billingScheduler.includes("event: 'service.suspended'") &&
    billingScheduler.includes("event: 'service.deleted'") &&
    publicApiRoutes.includes("event: 'service.task.queued'") &&
    publicApiRoutes.includes("event: 'service.task.cancelled'") &&
    publicApiRoutes.includes('dedupeKey: `service.task.queued:public-api:${task.id}`') &&
    publicApiRoutes.includes('dedupeKey: `service.task.cancelled:public-api:${publicTask.id}`') &&
    instanceRoutes.includes("event: 'service.task.queued'") &&
    instanceRoutes.includes("source: 'instances.route'") &&
    instanceRoutes.includes('dedupeKey: `service.task.queued:instances:${task.id}`') &&
    instanceRoutes.includes("event: 'service.task.cancelled'") &&
    instanceRoutes.includes('dedupeKey: `service.task.cancelled:instances:${cancelledTask.id}`') &&
    instanceRoutes.includes("failureType: 'user_cancelled'") &&
    instanceTaskWorker.includes("event: 'service.task.completed'") &&
    instanceTaskWorker.includes("event: 'service.task.failed'") &&
    instanceTaskWorker.includes('source: \'instance_task_worker\'') &&
    instanceTaskWorker.includes('function emitInstanceTaskResultEvent') &&
    instanceTaskWorker.includes('publicServiceTask: PUBLIC_SERVICE_TASK_NAMES.has(input.task.taskType)') &&
    instanceTaskWorker.includes("failureType: input.event === 'service.task.failed' ? 'task_failed' : null") &&
    instanceTaskWorker.includes('emitTimedOutServiceTaskFailureEvent') &&
    instanceTaskWorker.includes("'instance_task_worker.timeout_cleanup'") &&
    instanceRoutes.includes("emitServiceResourceRollbackPluginEvent({") &&
    instanceRoutes.includes("event: 'service.resource.rollback.completed'") &&
    instanceRoutes.includes("event: 'service.resource.rollback.failed'") &&
    instanceRoutes.includes("source: 'instance.provisioning.failure'") &&
    instanceRoutes.includes("reason: 'provisioning_failed'") &&
    instanceRoutes.includes("reason: 'rollback_failed'") &&
    instanceRoutes.includes('dedupeKey: `service.resource.rollback.completed:provisioning:${instanceId}`') &&
    instanceRoutes.includes('dedupeKey: `service.resource.rollback.failed:provisioning:${instanceId}`') &&
    instanceRoutes.includes("metadata: { failureType: 'resource_rollback_failed' }") &&
    notifier.includes('emitNotificationSentPluginEvent({ userId, eventType, sent, failed, channelCount: channels.length })') &&
    notifier.includes('emitNotificationSentPluginEvent({ userId, eventType, sent: 0, failed: 0, channelCount: 0 })') &&
    notifier.includes("'plugin_event_delivery_alert'") &&
    notifier.includes('扩展事件投递告警') &&
    notifier.includes('pluginEventDeadLetterCount'),
  'service lifecycle and notification flows must emit plugin events from real provisioning, suspend, unsuspend, delete, billing, host batch, and notification paths'
)

assert.ok(
    businessEvents.includes('export function emitUserPluginEvent') &&
    businessEvents.includes('event: UserPluginEventName') &&
    businessEvents.includes("metadata: input.dedupeKey ? { ...(input.metadata ?? {}), dedupeKey: input.dedupeKey } : input.metadata ?? {}") &&
    businessEvents.includes("{ dedupeKey: input.dedupeKey }") &&
    authRoutes.includes("event: 'user.login'") &&
    authRoutes.includes("source: 'auth.login'") &&
    authRoutes.includes("event: 'user.registered'") &&
    authRoutes.includes("source: 'auth.register'") &&
    userRoutes.includes("event: 'user.profile.updated'") &&
    userRoutes.includes('metadata: { fields: updateActions }') &&
    userRoutes.includes("event: 'user.status.changed'") &&
    userRoutes.includes('reasonProvided: Boolean(reason)') &&
    !businessEvents.includes('email') &&
    !businessEvents.includes('ipAddress') &&
    !businessEvents.includes('userAgent'),
  'user lifecycle plugin events must be emitted from real auth/user routes with sanitized payloads'
)

assert.ok(
  runtime.includes("result: 'retry_pending'") &&
    runtime.includes("'duplicate_skipped'") &&
    runtime.includes('PLUGIN_EVENT_DEDUPE_IN_FLIGHT_TTL_MS') &&
    runtime.includes('reservePluginEventDedupeLock') &&
    runtime.includes('pluginEventDedupeLock.create') &&
    runtime.includes('pluginId_eventName_handler_dedupeKey') &&
    runtime.includes('finalizePluginEventDedupeLock') &&
    runtime.includes("status: 'in_flight'") &&
    runtime.includes("status: 'success'") &&
    runtime.includes("status: 'retry_pending'") &&
    runtime.includes("status: shouldDeadLetter ? 'dead_letter' : 'retry_pending'") &&
    runtime.includes('extractPluginEventDedupeKey') &&
    runtime.includes('dedupeKey,') &&
    runtime.includes('lastAttemptAt: attemptAt') &&
    runtime.includes("result: shouldDeadLetter ? 'dead_letter' : 'retry_pending'") &&
    runtime.includes('deadLetterAt: shouldDeadLetter ? new Date() : null') &&
    runtime.includes('lastAttemptAt: new Date()') &&
    runtime.includes('nextPluginEventRetryAt') &&
    runtime.includes('export async function replayPluginEventLog') &&
    runtime.includes('export async function processDuePluginEventRetries') &&
    runtime.includes('idempotencyKey: `event-log-${log.id}-retry-${log.retryCount + 1}`') &&
    scheduler.includes('startPluginEventRetryScheduler') &&
    scheduler.includes('processDuePluginEventRetries()') &&
    scheduler.includes('notifyDeveloperPluginEventDeliveryAlerts') &&
    scheduler.includes("sendNotification(userId, 'plugin_event_delivery_alert'") &&
    scheduler.includes('getAllAdminUserIds') &&
    scheduler.includes('PLUGIN_EVENT_ADMIN_ESCALATION_COOLDOWN_MINUTES') &&
    scheduler.includes('notifyAdminPluginEventDeliveryEscalation') &&
    scheduler.includes("sendNotification(adminUserId, 'plugin_event_delivery_alert'") &&
    scheduler.includes('plugin.event.alert_escalate') &&
    scheduler.includes('Critical plugin event alert escalated for plugin') &&
    scheduler.includes('plugin.event.alert_notify') &&
    scheduler.includes('getPluginEventAlertPreference') &&
    scheduler.includes('preference.cooldownMinutes') &&
    scheduler.includes('preference.recentWindowHours') &&
    scheduler.includes('preference.successRateThreshold') &&
    alertPreferences.includes('normalizePluginEventAlertPreferenceInput') &&
    alertPreferences.includes('minimumLevel: normalizeMinimumLevel') &&
    alertPreferences.includes('input.cooldownMinutes, 15, 1440') &&
    alertPreferences.includes('input.successRateThreshold, 50, 100') &&
    app.includes('startPluginEventRetryScheduler()'),
  'plugin event runtime must persist retry-pending failures, retry due events, dead-letter exhausted events, start the retry scheduler, and notify developers according to developer alert preferences'
)

assert.ok(
  adminRoutes.includes("fastify.get<{ Querystring: PluginEventQuery }>('/events'") &&
    adminRoutes.includes('normalizePluginEventResult') &&
    adminRoutes.includes("'duplicate_skipped'") &&
    adminRoutes.includes('normalizePluginEventName') &&
    adminRoutes.includes('normalizePluginEventHandler') &&
    adminRoutes.includes("action: 'plugin.event.dispatch'") &&
    adminRoutes.includes('dueRetry') &&
    adminRoutes.includes('deduped') &&
    adminRoutes.includes('nextRetryAt: { lte: new Date() }') &&
    adminRoutes.includes("fastify.post('/events/retry-due'") &&
    adminRoutes.includes("fastify.post<{ Params: TaskParams }>('/events/:id/replay'") &&
    adminRoutes.includes('requirePluginManager(request, reply)') &&
    adminRoutes.includes('replayPluginEventLog') &&
    adminRoutes.includes('processDuePluginEventRetries') &&
    adminApi.includes('listEvents:') &&
    adminApi.includes('eventName?: string') &&
    adminApi.includes('handler?: string') &&
    adminApi.includes('summary: PluginEventSummary') &&
    adminApi.includes("http.get('/admin/plugins/events'") &&
    adminApi.includes('retryDueEvents:') &&
    adminApi.includes('replayEvent:') &&
    apiTypes.includes('export interface PluginEventLog') &&
    apiTypes.includes('export interface PluginEventSummary') &&
    apiTypes.includes('dedupeKey: string | null') &&
    apiTypes.includes('lastAttemptAt: string | null') &&
    apiTypes.includes('deduped: number') &&
    pluginCenterView.includes("key: 'events'") &&
    pluginCenterView.includes('事件投递') &&
    pluginCenterView.includes('eventPluginFilter') &&
    pluginCenterView.includes('pluginBusinessEventNames') &&
    pluginCenterView.includes('service.task.queued') &&
    pluginCenterView.includes('service.task.cancelled') &&
    pluginCenterView.includes('service.task.completed') &&
    pluginCenterView.includes('service.task.failed') &&
    pluginCenterView.includes('service.resource.rollback.completed') &&
    pluginCenterView.includes('service.resource.rollback.failed') &&
    pluginCenterView.includes('ticket.status.changed') &&
    pluginCenterView.includes('eventHandlerFilter') &&
    pluginCenterView.includes('到期重试') &&
    pluginCenterView.includes('已去重') &&
    pluginCenterView.includes('lastAttemptAt') &&
    pluginCenterView.includes('retryDueEvents') &&
    pluginCenterView.includes('replayPluginEvent'),
  'admin extension center must expose event delivery logs, event filters, delivery summary, due retry processing, and manual replay'
)

assert.ok(
  developmentDocs.includes('## 业务事件') &&
    developmentDocs.includes('order.created') &&
    developmentDocs.includes('order.paid') &&
    developmentDocs.includes('payment.failed') &&
    developmentDocs.includes('service.provisioned') &&
    developmentDocs.includes('service.suspended') &&
    developmentDocs.includes('service.unsuspended') &&
    developmentDocs.includes('service.deleted') &&
    developmentDocs.includes('service.task.queued') &&
    developmentDocs.includes('service.task.cancelled') &&
    developmentDocs.includes('service.task.completed') &&
    developmentDocs.includes('service.task.failed') &&
    developmentDocs.includes('service.resource.rollback.completed') &&
    developmentDocs.includes('service.resource.rollback.failed') &&
    developmentDocs.includes('平台成功释放已预占的宿主机资源') &&
    developmentDocs.includes('只包含泛化失败类别，不包含底层 provider 或数据库错误正文') &&
    developmentDocs.includes('ticket.created') &&
    developmentDocs.includes('ticket.replied') &&
    developmentDocs.includes('ticket.status.changed') &&
    developmentDocs.includes('只包含前后状态，不包含内部备注或负责人') &&
    developmentDocs.includes('user.registered') &&
    developmentDocs.includes('user.login') &&
    developmentDocs.includes('user.profile.updated') &&
    developmentDocs.includes('user.status.changed') &&
    developmentDocs.includes('notification.sent') &&
    developmentDocs.includes('不会包含邮箱、IP、User-Agent、密码、验证码或敏感字段值') &&
    developmentDocs.includes('覆盖 `start`、`stop`、`restart`、`rebuild`、`clone`、`recreate` 和 `change_host`') &&
    developmentDocs.includes('服务任务和资源回滚事件不会包含 root 密码、Incus ID、宿主机内部配置、特权连接密钥或原始 provider 响应') &&
    developmentDocs.includes('失败事件只返回泛化失败类别') &&
    developmentDocs.includes('不包含底层 provider 错误正文') &&
    developmentDocs.includes('不包含通知正文') &&
    developmentDocs.includes('业务事件投递失败不会回滚支付入账、订单状态、实例状态、服务任务状态、资源回滚结果、用户资料更新、通知发送或工单回复') &&
    developmentDocs.includes('retry_pending') &&
    platformPlan.includes('重装、克隆、重建、迁移等后台实例任务的排队、取消、完成、失败和超时清理失败，资源回滚已覆盖实例交付失败后的宿主机资源释放成功/失败') &&
    platformPlan.includes('资源回滚事件首版覆盖实例交付失败后宿主机资源释放成功/失败') &&
    developmentDocs.includes('dead_letter') &&
    developmentDocs.includes('duplicate_skipped') &&
    developmentDocs.includes('dedupeKey') &&
    developmentDocs.includes('数据库唯一去重锁') &&
    developmentDocs.includes('30 分钟接管窗口') &&
    developmentDocs.includes('手动重放会同步回写去重锁状态') &&
    developmentDocs.includes('最后尝试时间') &&
    developmentDocs.includes('按扩展、事件名、handler 和投递结果筛选日志') &&
    developmentDocs.includes('手动重放单条可重放事件') &&
    developmentDocs.includes('plugin_event_delivery_alert') &&
    developmentDocs.includes('event-alert-preferences') &&
    developmentDocs.includes('cooldownMinutes = 15..1440') &&
    developmentDocs.includes('successRateThreshold = 50..100') &&
    developmentDocs.includes('管理员 critical 升级首版') &&
    developmentDocs.includes('plugin.event.alert_escalate') &&
    developmentDocs.includes('不会包含事件 payload、actor、原始错误正文、webhook URL、secret 或扩展配置值') &&
    manifestDocs.includes('扩展安装/启用/停用/卸载 lifecycle、订单、支付、服务、服务任务、资源回滚、通知、工单、工单状态和用户生命周期业务事件已接入') &&
    manifestDocs.includes('开发者事件投递告警通知和告警偏好配置') &&
    manifestDocs.includes('`dedupeKey` 去重') &&
    platformPlan.includes('订单、支付、服务、服务任务、资源回滚、通知、工单和用户生命周期业务事件接入 dispatcher 首版') &&
    platformPlan.includes('服务任务事件首版覆盖公共 API 的 `start`、`stop`、`restart` 入队和取消') &&
    platformPlan.includes('`rebuild`、`clone`、`recreate`、`change_host` 排队、取消、worker 完成、worker 失败和超时清理失败') &&
    platformPlan.includes('事件投递可靠性和审计筛选首版') &&
    platformPlan.includes('数据库唯一锁去重') &&
    platformPlan.includes('并发投递中去重') &&
    platformPlan.includes('后台审计筛选、投递统计、最后尝试时间、手动重放和开发者事件健康只读监控首版') &&
    platformPlan.includes('开发者事件投递告警通知') &&
    platformPlan.includes('管理员 critical 升级') &&
    platformPlan.includes('成功率阈值') &&
    platformPlan.includes('冷却时间') &&
    platformPlan.includes('`dedupeKey` 数据库唯一锁去重'),
  'extension docs must describe the first connected business events and implemented delivery reliability work'
)

assert.ok(
  serverPackage.includes('"test:plugin-business-event-guards"') &&
    rootPackage.includes('pnpm --filter server test:plugin-business-event-guards'),
  'plugin business event guard must be wired into package scripts'
)

console.log('plugin business event guard tests passed')
