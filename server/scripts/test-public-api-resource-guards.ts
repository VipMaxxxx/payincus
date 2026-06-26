import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildPublicApiOpenApiDocument } from '../src/lib/public-api-openapi.js'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const auth = read('server/src/lib/public-api-auth.ts')
const route = read('server/src/routes/public-api.ts')
const rateLimitConfig = read('server/src/config/rate-limit.ts')
const prismaSchema = read('server/prisma/schema.prisma')
const rateLimitMigration = read('server/prisma/migrations/20260626203000_add_public_plugin_action_rate_limit_buckets/migration.sql')
const rateLimitPolicyMigration = read('server/prisma/migrations/20260626210000_add_public_plugin_action_rate_limit_policies/migration.sql')
const ticketAttachments = read('server/src/lib/ticket-attachments.ts')
const openapiSource = read('server/src/lib/public-api-openapi.ts')
const clientTypes = read('client/src/types/api.ts')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const overviewDocs = read('docs-site/docs/plugins/overview.md')
const enOverviewDocs = read('docs-site/docs/en/plugins/overview.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')

const document = buildPublicApiOpenApiDocument()
const serializedOpenApi = JSON.stringify(document)

const publicApiRouteDeclarations = Array.from(
  route.matchAll(/fastify\.(get|post|patch|put|delete)(?:<[\s\S]*?>)?\('([^']+)'/g),
  match => `${match[1].toUpperCase()} ${match[2]}`
).sort()

const allowedPublicApiRouteDeclarations = [
  'DELETE /services/:id/tasks/:taskId',
  'GET /balance',
  'GET /balance/adjustment-requests',
  'GET /balance/logs',
  'GET /billing-records',
  'GET /billing-records/:id',
  'GET /me',
  'GET /notifications',
  'GET /notifications/unread-count',
  'GET /openapi.json',
  'GET /openapi.yaml',
  'GET /orders',
  'GET /orders/:id',
  'GET /plugins',
  'GET /plugins/:pluginId/actions',
  'GET /products',
  'GET /products/:id',
  'GET /services',
  'GET /services/:id',
  'GET /services/:id/tasks/:taskId',
  'GET /tickets',
  'GET /tickets/:id',
  'PATCH /me',
  'PATCH /tickets/:id/status',
  'POST /balance/adjustment-requests',
  'POST /notifications',
  'POST /plugins/:pluginId/actions/:action',
  'POST /services/:id/actions',
  'POST /services/:id/renew',
  'POST /tickets',
  'POST /tickets/:id/replies'
].sort()

assert.deepEqual(
  publicApiRouteDeclarations,
  allowedPublicApiRouteDeclarations,
  'public API route surface must stay pinned to the reviewed allowlist before exposing new high-risk resources'
)

assert.ok(
    auth.includes("'products:read'") &&
    auth.includes("'profile:write'") &&
    auth.includes("'balance:read'") &&
    auth.includes("'balance:write'") &&
    auth.includes("'billing:read'") &&
    auth.includes("'services:read'") &&
    auth.includes("'services:operate'") &&
    auth.includes("'services:billing'") &&
    auth.includes("'orders:read'") &&
    auth.includes("'tickets:read'") &&
    auth.includes("'tickets:write'") &&
    auth.includes("'notifications:read'") &&
    auth.includes("'notifications:send'") &&
    auth.includes("'plugins:action'") &&
    clientTypes.includes("| 'products:read'") &&
    clientTypes.includes("| 'profile:write'") &&
    clientTypes.includes("| 'balance:read'") &&
    clientTypes.includes("| 'balance:write'") &&
    clientTypes.includes("| 'billing:read'") &&
    clientTypes.includes("| 'services:read'") &&
    clientTypes.includes("| 'services:operate'") &&
    clientTypes.includes("| 'services:billing'") &&
    clientTypes.includes("| 'orders:read'") &&
    clientTypes.includes("| 'tickets:read'") &&
    clientTypes.includes("| 'tickets:write'") &&
    clientTypes.includes("| 'notifications:read'") &&
    clientTypes.includes("| 'notifications:send'") &&
    clientTypes.includes("| 'plugins:action'") &&
    openapiSource.includes("'products:read'") &&
    openapiSource.includes("'profile:write'") &&
    openapiSource.includes("'balance:read'") &&
    openapiSource.includes("'balance:write'") &&
    openapiSource.includes("'billing:read'") &&
    openapiSource.includes("'services:read'") &&
    openapiSource.includes("'services:operate'") &&
    openapiSource.includes("'services:billing'") &&
    openapiSource.includes("'tickets:write'") &&
    openapiSource.includes("'notifications:read'") &&
    openapiSource.includes("'notifications:send'") &&
    openapiSource.includes("'plugins:action'") &&
    serializedOpenApi.includes('products:read'),
  'public API resource scopes must be exposed consistently in auth, client types, and OpenAPI'
)

assert.ok(
  route.includes("fastify.get('/balance'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'balance:read')") &&
    route.includes('select: {') &&
    route.includes('balance: true') &&
    route.includes("currency: 'CNY'") &&
    route.includes('public_api.balance_read') &&
    route.includes('toMoney(user.balance)') &&
    !route.includes('hostingBalance: true') &&
    !route.includes('affBalance: true'),
  'public balance API must require balance:read, return only the token user account balance, and avoid hosted/AFF/payment write surfaces'
)

assert.ok(
  route.includes("fastify.get<{ Querystring: PublicApiBalanceLogQuery }>('/balance/logs'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'balance:read')") &&
    route.includes('PUBLIC_BALANCE_LOG_TYPES') &&
    route.includes("parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')") &&
    route.includes('buildPublicSortOrder(sort)') &&
    route.includes('Prisma.BalanceLogWhereInput') &&
    route.includes('userId: apiToken.userId') &&
    route.includes("lotteryGift === 'exclude'") &&
    route.includes("lotteryGift === 'only'") &&
    route.includes("where: { id: { in: instanceIds }, userId: apiToken.userId }") &&
    route.includes('public_api.balance_logs_list') &&
    route.includes('balanceBefore: toMoney(log.balanceBefore)') &&
    route.includes('balanceAfter: toMoney(log.balanceAfter)') &&
    route.includes('publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total, sort })') &&
    !route.includes('adjustmentRequest: true') &&
    !route.includes('user: true') &&
    !route.includes('providerPayload'),
  'public balance log API must require balance:read, stay scoped to the token user, support safe filters, and avoid adjustment/user/provider payload exposure'
)

assert.ok(
  route.includes('PUBLIC_API_RATE_LIMITS') &&
    route.includes("balanceAdjustmentWrite: { max: 5, timeWindow: '10 minutes' }") &&
    route.includes("serviceOperate: { max: 10, timeWindow: '1 minute' }") &&
    route.includes("serviceRenew: { max: 5, timeWindow: '10 minutes' }") &&
    route.includes("serviceTaskRead: { max: 120, timeWindow: '1 minute' }") &&
    route.includes("serviceTaskCancel: { max: 10, timeWindow: '1 minute' }") &&
    route.includes("ticketCreate: { max: 10, timeWindow: '5 minutes' }") &&
    route.includes("ticketReply: { max: 20, timeWindow: '1 minute' }") &&
    route.includes("ticketStatus: { max: 20, timeWindow: '1 minute' }") &&
    route.includes("notificationSend: { max: 20, timeWindow: '1 minute' }") &&
    route.includes("pluginActionDispatch: { max: 30, timeWindow: '1 minute' }") &&
    route.includes('PUBLIC_PLUGIN_ACTION_DYNAMIC_RATE_LIMITS') &&
    route.includes('normal: { max: 30, windowMs: 60_000 }') &&
    route.includes('strict: { max: 10, windowMs: 60_000 }') &&
    route.includes('resolvePublicPluginActionRateLimitPolicy') &&
    route.includes('FROM "public_plugin_action_rate_limit_policies"') &&
    route.includes('"plugin_id" = ${input.pluginId} AND "action_name" = ${input.actionName}') &&
    route.includes('"plugin_id" = ${input.pluginId} AND "action_name" = ${PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE}') &&
    route.includes('"plugin_id" = ${PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE} AND "action_name" = ${PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE}') &&
    route.includes('checkPublicPluginActionDynamicRateLimit') &&
    route.includes('INSERT INTO "public_plugin_action_rate_limit_buckets"') &&
    route.includes('ON CONFLICT ("token_source", "token_id", "plugin_id", "action_name")') &&
    route.includes('"request_count" + 1') &&
    route.includes('bucket.requestCount > policy.max') &&
    route.includes("code: 'PUBLIC_PLUGIN_ACTION_RATE_LIMITED'") &&
    route.includes("reply.header('Retry-After'") &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.balanceAdjustmentWrite }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceOperate }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceRenew }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceTaskRead }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceTaskCancel }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.ticketCreate }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.ticketReply }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.ticketStatus }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.notificationSend }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.pluginActionDispatch }') &&
    rateLimitConfig.includes('globalRateLimit') &&
    rateLimitConfig.includes('findRateLimitRule') &&
    prismaSchema.includes('model PublicPluginActionRateLimitBucket') &&
    prismaSchema.includes('model PublicPluginActionRateLimitPolicy') &&
    prismaSchema.includes('@@unique([tokenSource, tokenId, pluginId, actionName])') &&
    prismaSchema.includes('@@unique([pluginId, actionName, rateLimit])') &&
    prismaSchema.includes('@@map("public_plugin_action_rate_limit_buckets")') &&
    prismaSchema.includes('@@map("public_plugin_action_rate_limit_policies")') &&
    rateLimitMigration.includes('CREATE TABLE "public_plugin_action_rate_limit_buckets"') &&
    rateLimitMigration.includes('CREATE UNIQUE INDEX "public_plugin_action_rate_limit_buckets_token_source_token_id_plugin_id_action_name_key"') &&
    rateLimitMigration.includes('FOREIGN KEY ("plugin_id")') &&
    rateLimitPolicyMigration.includes('CREATE TABLE "public_plugin_action_rate_limit_policies"') &&
    rateLimitPolicyMigration.includes('CHECK ("rate_limit" IN') &&
    rateLimitPolicyMigration.includes('CHECK ("max_requests" BETWEEN 1 AND 10000)') &&
    rateLimitPolicyMigration.includes('CHECK ("window_seconds" BETWEEN 10 AND 3600)'),
  'public API write routes must have operation-specific Fastify rate limits and database-backed public plugin action dynamic quota buckets'
)

assert.ok(
  route.includes("fastify.get<{ Querystring: PublicApiBalanceAdjustmentListQuery }>('/balance/adjustment-requests'") &&
    route.includes("fastify.post<{ Body: PublicApiCreateBalanceAdjustmentBody }>('/balance/adjustment-requests'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'balance:write')") &&
    route.includes('normalizePublicBalanceAdjustmentAmount(request.body?.amount)') &&
    route.includes('normalizePublicBalanceAdjustmentReason(request.body?.reason)') &&
    route.includes('normalizePublicBalanceAdjustmentType(request.body?.requestType)') &&
    route.includes('normalizePublicBalanceAdjustmentStatus(request.query?.status)') &&
    route.includes("PUBLIC_BALANCE_ADJUSTMENT_STATUSES = new Set<BalanceAdjustmentRequestStatus>(['pending', 'approved', 'rejected'])") &&
    route.includes("PUBLIC_BALANCE_ADJUSTMENT_TYPES = new Set<BalanceAdjustmentRequestType>(['manual_adjust', 'refund'])") &&
    route.includes('PUBLIC_BALANCE_ADJUSTMENT_ORDER_NO_PATTERN') &&
    route.includes('MAX_PUBLIC_BALANCE_ADJUSTMENT_AMOUNT = 10000') &&
    route.includes('userId: apiToken.userId') &&
    route.includes('requestedByUserId: apiToken.userId') &&
    route.includes("sourceType: 'public_api'") &&
    route.includes('sourceId: apiToken.id') &&
    route.includes("status: 'pending'") &&
    route.includes('pendingCount >= 5') &&
    route.includes('createBalanceAdjustmentRequest({') &&
    route.includes("reason: `[Public API] ${reason}`") &&
    route.includes('return reply.code(202).send') &&
    route.includes('serializePublicBalanceAdjustmentRequest') &&
    route.includes('public_api.balance_adjustment_requests_list') &&
    route.includes('public_api.balance_adjustment_request_create') &&
    !route.includes('approveBalanceAdjustmentRequest(') &&
    !route.includes('adminAdjustBalance('),
  'public balance adjustment request APIs must require balance:write, stay scoped to the token user, create only pending public_api review requests, enforce limits, and avoid direct approval or balance mutation'
)

assert.ok(
  route.includes("fastify.patch<{ Body: PublicApiUpdateProfileBody }>('/me'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'profile:write')") &&
    route.includes('normalizePublicAvatarStyle(request.body?.avatarStyle)') &&
    route.includes('PUBLIC_PROFILE_AVATAR_STYLE_SET') &&
    route.includes("data: { avatarStyle }") &&
    route.includes('LogModule.AUTH') &&
    route.includes("'public_api.me_update'") &&
    route.includes("event: 'user.profile.updated'") &&
    route.includes("source: 'public_api.me.update'") &&
    !route.includes('data: { email') &&
    !route.includes('data: { balance') &&
    !route.includes('data: { role'),
  'public profile update API must require profile:write, only accept low-risk avatar style updates, emit events, and avoid sensitive profile fields'
)

assert.ok(
  route.includes("fastify.get<{ Querystring: PublicApiListQuery }>('/products'") &&
    route.includes("fastify.get<{ Params: PublicApiIdParams }>('/products/:id'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'products:read')") &&
    route.includes("parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')") &&
    route.includes('plans: { some: { isActive: true } }') &&
    route.includes('where: { id, active: true }') &&
    route.includes('where: { isActive: true }') &&
    route.includes('public_api.products_list') &&
    route.includes('public_api.product_read'),
  'public product APIs must require products:read and expose only active packages/plans'
)

assert.ok(
  route.includes("fastify.get<{ Querystring: PublicApiServiceListQuery }>('/services'") &&
    route.includes("fastify.get<{ Params: PublicApiIdParams; Querystring: Pick<PublicApiServiceListQuery, 'include'> }>('/services/:id'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'services:read')") &&
    route.includes('PUBLIC_SERVICE_STATUSES') &&
    route.includes('PUBLIC_SERVICE_INCLUDES') &&
    route.includes('PUBLIC_SERVICE_SORT_FIELDS') &&
    route.includes("parsePublicApiSort(request.query?.sort, PUBLIC_SERVICE_SORT_FIELDS, 'displayOrder')") &&
    route.includes("code: 'INVALID_PUBLIC_API_SORT'") &&
    route.includes("type PublicApiServiceInclude = 'product' | 'plan'") &&
    route.includes('parsePublicApiInclude(request.query?.include, PUBLIC_SERVICE_INCLUDES)') &&
    route.includes("code: 'INVALID_SERVICE_INCLUDE'") &&
    route.includes('buildPublicServiceIncluded(services, includes)') &&
    route.includes('buildPublicServiceIncluded([service], includes)') &&
    route.includes('...(Object.keys(included).length > 0 ? { included } : {})') &&
    route.includes('buildPublicServiceSortOrder(sort)') &&
    route.includes('publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total, sort })') &&
    route.includes("code: 'INVALID_SERVICE_STATUS'") &&
    route.includes('status: status as InstanceStatus') &&
    route.includes('select: publicServiceSelect') &&
    route.includes('where: { id, userId: apiToken.userId }') &&
    route.includes('serializePublicService') &&
    route.includes('public_api.services_list') &&
    route.includes('public_api.service_read') &&
    route.includes('rootPassword') === false,
  'public service APIs must require services:read, scope data to the token user, and avoid root password exposure'
)

assert.ok(
  route.includes("fastify.post<{ Params: PublicApiIdParams; Body: PublicApiServiceActionBody }>('/services/:id/actions'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'services:operate')") &&
    route.includes('normalizePublicServiceOperation(request.body?.action)') &&
    route.includes("action === 'start' || action === 'stop' || action === 'restart'") &&
    route.includes('where: { id, userId: apiToken.userId }') &&
    route.includes('assertPublicServiceOperationAllowed(service, action)') &&
    route.includes("status: { in: ['pending', 'processing'] }") &&
    route.includes("status: { in: ['PENDING', 'PROCESSING'] }") &&
    route.includes("code: 'SERVICE_TRANSFER_LOCKED'") &&
    route.includes("code: 'SERVICE_RESTORE_IN_PROGRESS'") &&
    route.includes("code: 'SERVICE_UPLOAD_IN_PROGRESS'") &&
    route.includes("code: 'SERVICE_TASK_IN_PROGRESS'") &&
    route.includes('createInstanceTask({') &&
    route.includes('taskType: action') &&
    route.includes("'public_api.service_action_queued'") &&
    route.includes('InstanceTaskConflictError') &&
    !route.includes('deleteInstance(') &&
    !route.includes('createInstance(') &&
    !route.includes('balance: {'),
  'public service action API must require services:operate, stay user-scoped, only queue start/stop/restart tasks, block active workflows, and avoid direct Incus, delete, refund, or balance writes'
)

assert.ok(
  route.includes("fastify.post<{ Params: PublicApiIdParams; Body: PublicApiServiceRenewBody }>('/services/:id/renew'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'services:billing')") &&
    route.includes('normalizePublicServiceRenewMonths(request.body?.months)') &&
    route.includes('assertPublicServiceRenewAllowed(service, months)') &&
    route.includes('performRenewal(apiToken.userId, service, months)') &&
    route.includes("sendNotification(apiToken.userId, 'instance_renewed'") &&
    route.includes('sendHostManagedInstanceNotification(') &&
    route.includes('sendRenewSuccessEmail(') &&
    route.includes("'public_api.service_renew'") &&
    route.includes("'public_api.service_renew_failed'") &&
    route.includes("code: 'SERVICE_RENEW_FAILED'") &&
    route.includes("code: 'HOSTING_RENEW_TOO_EARLY'") &&
    route.includes("code: 'HOSTING_MONTHLY_ONLY'") &&
    !route.includes('balanceLogId: result.balanceLogId') &&
    !route.includes('balance: { decrement'),
  'public service renew API must require services:billing, stay user-scoped, reuse the internal renewal transaction, enforce hosted-node limits, notify users, and avoid exposing balance-log internals or direct balance writes'
)

assert.ok(
  route.includes("fastify.get<{ Params: PublicApiServiceTaskParams }>('/services/:id/tasks/:taskId'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'services:operate')") &&
    route.includes('loadPublicServiceOperationTask(apiToken.userId, id, taskId)') &&
    route.includes("taskType: { in: ['start', 'stop', 'restart'] }") &&
    route.includes('serializePublicServiceOperationTask(task)') &&
    route.includes('getTaskQueuePosition(task.id, task.hostId)') &&
    route.includes("'public_api.service_task_read'") &&
    route.includes("code: 'SERVICE_TASK_NOT_FOUND'") &&
    !route.includes('newInstanceId: task.newInstanceId'),
  'public service task API must require services:operate, stay user-scoped, expose only start/stop/restart task status, include queue position, and avoid clone/recreate metadata'
)

assert.ok(
  route.includes("fastify.delete<{ Params: PublicApiServiceTaskParams }>('/services/:id/tasks/:taskId'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'services:operate')") &&
    route.includes('loadPublicServiceOperationTask(apiToken.userId, id, taskId)') &&
    route.includes("task.status !== 'PENDING'") &&
    route.includes("code: 'SERVICE_TASK_CANNOT_CANCEL'") &&
    route.includes('cancelInstanceTask(task.id)') &&
    route.includes('loadPublicServiceOperationTask(apiToken.userId, id, cancelledTask.id)') &&
    route.includes("'public_api.service_task_cancel'") &&
    route.includes('serializePublicServiceOperationTask(publicTask)') &&
    !route.includes('cancelInstanceTask(taskId)'),
  'public service task cancel API must require services:operate, re-check user/service/public-task ownership, cancel only pending public power tasks, audit cancellation, and avoid raw task-id cancellation'
)

assert.ok(
  route.includes("fastify.get<{ Querystring: PublicApiOrderListQuery }>('/orders'") &&
    route.includes("fastify.get<{ Params: PublicApiOrderParams }>('/orders/:id'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'orders:read')") &&
    route.includes('PUBLIC_ORDER_STATUSES') &&
    route.includes("parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')") &&
    route.includes('parsePublicOrderId(request.params.id)') &&
    route.includes("code: 'INVALID_ORDER_ID'") &&
    route.includes("code: 'ORDER_NOT_FOUND'") &&
    route.includes('buildPublicOrderStatusFilter(status)') &&
    route.includes("code: 'INVALID_ORDER_STATUS'") &&
    route.includes("rechargeStatuses: ['pending', 'paid']") &&
    route.includes("billingTypes: ['refund']") &&
    route.includes('userId: apiToken.userId') &&
    route.includes('maskTradeNo(record.tradeNo)') &&
    route.includes('const sortMultiplier = sort.direction === \'desc\' ? -1 : 1') &&
    route.includes('sourceTake = Math.min(pagination.skip + pagination.take, 200)') &&
    route.includes('public_api.orders_list') &&
    route.includes('public_api.order_read'),
  'public order APIs must require orders:read, scope list/detail data to the token user, validate public order ids, mask trade numbers, and fetch enough source rows for merged pagination'
)

assert.ok(
  route.includes("fastify.get<{ Querystring: PublicApiBillingRecordListQuery }>('/billing-records'") &&
    route.includes("fastify.get<{ Params: PublicApiIdParams }>('/billing-records/:id'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'billing:read')") &&
    route.includes("PUBLIC_BILLING_RECORD_TYPES = new Set<BillingRecordType>(['newPurchase', 'renew', 'upgrade', 'downgrade', 'refund', 'transfer_fee'])") &&
    route.includes("parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')") &&
    route.includes('normalizePublicBillingRecordType(request.query?.type)') &&
    route.includes('parseOptionalPositiveId(request.query?.serviceId)') &&
    route.includes("code: 'INVALID_BILLING_RECORD_TYPE'") &&
    route.includes("code: 'BILLING_RECORD_NOT_FOUND'") &&
    route.includes('userId: apiToken.userId') &&
    route.includes('...(serviceId ? { instanceId: serviceId } : {})') &&
    route.includes('include: publicBillingRecordInclude') &&
    route.includes('serializePublicBillingRecord') &&
    route.includes('orderId: `instance_billing:${record.id}`') &&
    route.includes('public_api.billing_records_list') &&
    route.includes('public_api.billing_record_read') &&
    !route.includes('balanceLog: true') &&
    !route.includes('balanceLogId: record.balanceLogId'),
  'public billing record APIs must require billing:read, stay scoped to the token user, support safe type/service filters, expose public billing fields, and avoid balance log/payment internals'
)

assert.ok(
  route.includes("fastify.get<{ Querystring: PublicApiTicketListQuery }>('/tickets'") &&
    route.includes("fastify.get<{ Params: PublicApiIdParams }>('/tickets/:id'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'tickets:read')") &&
    route.includes('PUBLIC_TICKET_STATUSES') &&
    route.includes('PUBLIC_TICKET_SORT_FIELDS') &&
    route.includes("parsePublicApiSort(request.query?.sort, PUBLIC_TICKET_SORT_FIELDS, '-updatedAt')") &&
    route.includes("code: 'INVALID_TICKET_STATUS'") &&
    route.includes("code: 'INVALID_TICKET_CATEGORY'") &&
    route.includes("code: 'INVALID_TICKET_PRIORITY'") &&
    route.includes('priority: priority as TicketPriority') &&
    route.includes('where: { id, userId: apiToken.userId }') &&
    route.includes('thumbnailUrl: true') &&
    route.includes('public_api.tickets_list') &&
    route.includes('public_api.ticket_read'),
  'public ticket APIs must require tickets:read, scope data to the token user, and return safe attachment metadata'
)

assert.ok(
  route.includes("fastify.post<{ Body: PublicApiCreateTicketBody }>('/tickets'") &&
    route.includes('bodyLimit: TICKET_UPLOAD_BODY_LIMIT') &&
    route.includes("authenticatePublicApiRequest(request, reply, 'tickets:write')") &&
    route.includes("getSystemConfigBoolean('ticket_enabled', true)") &&
    route.includes('const payload = await readTicketPayload(request)') &&
    route.includes('normalizePublicTicketSubject(payload.fields.subject)') &&
    route.includes('normalizePublicTicketMessageContent(payload.fields.content)') &&
    route.includes('payload.images.length === 0') &&
    route.includes('parseOptionalPositiveId(payload.fields.instanceId)') &&
    route.includes('where: { id: instanceId, userId: apiToken.userId }') &&
    route.includes('uploadedAttachments = await uploadTicketImages(payload.images)') &&
    route.includes('createTicket({') &&
    route.includes('attachments: uploadedAttachments') &&
    route.includes('attachments.map(serializePublicTicketAttachment)') &&
    route.includes('cleanupUploadedTicketImages(uploadedAttachments)') &&
    route.includes("code: 'INVALID_TICKET_ATTACHMENT'") &&
    route.includes("sendNotification(adminId, 'ticket_created'") &&
    route.includes("emitPluginEvent('ticket.created'") &&
    route.includes('attachmentCount: uploadedAttachments.length') &&
    route.includes("source: 'public_api'") &&
    route.includes("LogModule.PLUGIN, 'public_api.ticket_create'") &&
    !route.includes('targetUserId') &&
    !route.includes('internalNotes'),
  'public ticket create API must require tickets:write, stay user-scoped, support controlled image attachments, reject internal notes/status overrides, notify recipients, emit events, and audit writes'
)

assert.ok(
  route.includes("fastify.post<{ Params: PublicApiIdParams; Body: PublicApiTicketReplyBody }>('/tickets/:id/replies'") &&
    route.includes('bodyLimit: TICKET_UPLOAD_BODY_LIMIT') &&
    route.includes("authenticatePublicApiRequest(request, reply, 'tickets:write')") &&
    route.includes("where: { id, userId: apiToken.userId }") &&
    route.includes("code: 'TICKET_CLOSED'") &&
    route.includes('MAX_PUBLIC_TICKET_REPLY_LENGTH = 5000') &&
    route.includes('const payload = await readTicketPayload(request)') &&
    route.includes('payload.images.length === 0') &&
    route.includes('uploadedAttachments = await uploadTicketImages(payload.images)') &&
    route.includes('addTicketMessage(ticket.id, apiToken.userId, content, false, uploadedAttachments)') &&
    route.includes('attachments.map(serializePublicTicketAttachment)') &&
    route.includes('cleanupUploadedTicketImages(uploadedAttachments)') &&
    route.includes('getAllAdminUserIds') &&
    route.includes("sendNotification(adminId, 'ticket_replied'") &&
    route.includes("emitPluginEvent('ticket.replied'") &&
    route.includes('attachmentCount: uploadedAttachments.length') &&
    route.includes("source: 'public_api'") &&
    route.includes('public_api.ticket_reply_create'),
  'public ticket reply API must require tickets:write, stay user-scoped, reject closed tickets, support controlled image attachments, avoid status overrides, notify recipients, emit events, and audit writes'
)

assert.ok(
  ticketAttachments.includes('export const MAX_TICKET_IMAGES = 6') &&
    ticketAttachments.includes('export const MAX_TICKET_IMAGE_SIZE = 50 * 1024 * 1024') &&
    ticketAttachments.includes("'image/jpeg'") &&
    ticketAttachments.includes("'image/png'") &&
    ticketAttachments.includes("'image/webp'") &&
    ticketAttachments.includes("'image/gif'") &&
    ticketAttachments.includes("'image/avif'") &&
    ticketAttachments.includes("part.fieldname !== 'images'") &&
    ticketAttachments.includes('uploadTicketImageToLsky(image)') &&
    ticketAttachments.includes('deleteTicketImageFromLsky') &&
    !ticketAttachments.includes('http://') &&
    !ticketAttachments.includes('https://'),
  'public ticket attachments must reuse controlled image upload limits, allowed MIME types, images field, Lsky upload, and cleanup without remote URL ingestion'
)

assert.ok(
  route.includes("fastify.patch<{ Params: PublicApiIdParams; Body: PublicApiTicketStatusBody }>('/tickets/:id/status'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'tickets:write')") &&
    route.includes('normalizePublicTicketStatusAction(request.body?.action)') &&
    route.includes("action must be one of close or reopen") &&
    route.includes('where: { id, userId: apiToken.userId }') &&
    route.includes("code: 'TICKET_ALREADY_CLOSED'") &&
    route.includes("code: 'TICKET_NOT_CLOSED'") &&
    route.includes("const nextStatus: TicketStatus = action === 'close' ? 'closed' : 'open'") &&
    route.includes("emitPluginEvent('ticket.status.changed'") &&
    route.includes("'public_api.ticket_status_update'") &&
    !route.includes('assigneeId') &&
    !route.includes('internalNotes'),
  'public ticket status API must require tickets:write, stay user-scoped, only close/reopen own tickets, emit sanitized status events, and avoid arbitrary status/internal fields'
)

assert.ok(
  route.includes("fastify.post<{ Body: PublicApiNotificationBody }>('/notifications'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'notifications:send')") &&
    route.includes('MAX_PUBLIC_NOTIFICATION_TITLE_LENGTH = 120') &&
    route.includes('MAX_PUBLIC_NOTIFICATION_MESSAGE_LENGTH = 2000') &&
    route.includes("PUBLIC_NOTIFICATION_TEMPLATE_IDS = ['flash_sale_reminder', 'service_action_update', 'billing_notice']") &&
    route.includes('PUBLIC_PLUGIN_NOTIFICATION_TEMPLATE_PATTERN') &&
    route.includes('plugin:<pluginId>:<templateId>') &&
    route.includes('renderPublicPluginNotificationTemplate') &&
    route.includes('resolvePublicNotificationTemplate') &&
    route.includes('loadEnabledPublicPluginManifest(pluginTemplateRef.pluginId)') &&
    route.includes("includes('notifications:send')") &&
    route.includes('manifest.capabilities?.notificationTemplates') &&
    route.includes('MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLES = 10') &&
    route.includes('MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLE_LENGTH = 120') &&
    route.includes('parsePublicPluginNotificationTemplateRef') &&
    route.includes('normalizePublicNotificationVariables(request.body?.variables)') &&
    route.includes('await resolvePublicNotificationTemplate(request.body.template, variables)') &&
    route.includes("code: 'INVALID_NOTIFICATION_TEMPLATE'") &&
    route.includes("code: 'INVALID_NOTIFICATION_VARIABLES'") &&
    route.includes("sendNotification(apiToken.userId, 'public_api_notification'") &&
    route.includes("code: 'INVALID_NOTIFICATION_PAYLOAD'") &&
    route.includes("LogModule.NOTIFICATION, 'public_api.notification_send'") &&
    !route.includes('targetUserId') &&
    !route.includes('channelId'),
  'public notification API must require notifications:send, send only to the token user, enforce text/template limits, reuse notifier, and audit writes'
)

assert.ok(
  route.includes("fastify.get<{ Querystring: PublicApiNotificationListQuery }>('/notifications'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'notifications:read')") &&
    route.includes('Prisma.InboxMessageWhereInput') &&
    route.includes('userId: apiToken.userId') &&
    route.includes('parseOptionalBooleanString(request.query?.isRead)') &&
    route.includes("parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')") &&
    route.includes('public_api.notifications_list') &&
    route.includes('fastify.get(\'/notifications/unread-count\'') &&
    route.includes('public_api.notifications_unread_count') &&
    !route.includes('data: true') &&
    !route.includes('config: true') &&
    !route.includes('channelId'),
  'public notification read APIs must require notifications:read, stay scoped to the token user, support safe read filters, and avoid raw data/channel exposure'
)

assert.ok(
  route.includes("fastify.get<{ Querystring: PublicApiListQuery }>('/plugins'") &&
    route.includes("fastify.get<{ Params: PublicApiPluginParams }>('/plugins/:pluginId/actions'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'plugins:action')") &&
    route.includes('PUBLIC_PLUGIN_SORT_FIELDS') &&
    route.includes("parsePublicApiSort(request.query?.sort, PUBLIC_PLUGIN_SORT_FIELDS, 'pluginId')") &&
    route.includes('getPublicPluginActions(manifest)') &&
    route.includes('serializePublicPluginAction') &&
    route.includes('!action.url') &&
    route.includes("scope.startsWith('service-extension:')") &&
    route.includes("scope.startsWith('gateway-extension:')") &&
    route.includes('requestSchema: action.requestSchema || null') &&
    route.includes('responseSchema: action.responseSchema || null') &&
    route.includes('public_api.plugins_list') &&
    route.includes('public_api.plugin_actions_list') &&
    !route.includes('url: action.url') &&
    !route.includes('secret:') &&
    !route.includes('configValues') &&
    route.includes("fastify.post<{ Params: PublicApiPluginActionParams; Body: PublicApiPluginActionBody }>('/plugins/:pluginId/actions/:action'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'plugins:action')") &&
    route.includes('normalizePluginId(request.params.pluginId)') &&
    route.includes('normalizePluginActionName(request.params.action)') &&
    route.includes('loadEnabledPublicPluginManifest(pluginId)') &&
    route.includes("code: 'PLUGIN_ACTION_NOT_FOUND'") &&
    route.includes('!pluginManifestHasActionPermission(manifest, action)') &&
    route.includes('await checkPublicPluginActionDynamicRateLimit({') &&
    route.includes('executePluginAction({') &&
    route.includes("source: 'user'") &&
    route.includes("LogModule.PLUGIN, 'public_api.plugin_action_dispatch'") &&
    route.includes("code: 'PUBLIC_PLUGIN_ACTION_FAILED'") &&
    !route.includes('targetUserId') &&
    !route.includes('adminOverride'),
  'public plugin action APIs must require plugins:action, discover only enabled public action contracts, hide webhook/config internals, reject lifecycle hooks, and audit dispatches'
)

assert.ok(
  !route.includes('callbackData') &&
    !route.includes('providerConfigSnapshot') &&
    !route.includes('paymentDetails') &&
    !route.includes('queryResult') &&
    !route.includes('internalNotes') &&
    !route.includes('storageProviderFileId') &&
    !route.includes('balanceLogId'),
  'public resource routes must not expose payment provider payloads, query results, internal notes, balance log IDs, or storage provider file IDs'
)

const forbiddenOpenApiPaths = [
  '/users',
  '/users/{id}',
  '/payments',
  '/payments/{id}',
  '/recharge',
  '/refunds',
  '/balance/recharge',
  '/balance/refund',
  '/balance/adjustments/{id}/approve',
  '/services/{id}/suspend',
  '/services/{id}/unsuspend',
  '/services/{id}/reinstall',
  '/services/{id}/delete',
  '/services/{id}/migrate',
  '/services/{id}/provision',
  '/plugins/{pluginId}/install',
  '/plugins/{pluginId}/enable',
  '/plugins/{pluginId}/disable',
  '/plugins/{pluginId}/uninstall'
]

for (const path of forbiddenOpenApiPaths) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(document.paths, path),
    false,
    `OpenAPI must not expose high-risk public path ${path} without a reviewed state machine and scope`
  )
}

assert.ok(
  developmentDocs.includes('## 高风险 Public API 边界') &&
    developmentDocs.includes('以下能力不是遗漏，也不是通过 `plugins:action`、OAuth scope 或 SDK 示例可以绕开的能力') &&
    developmentDocs.includes('直接余额充值、扣款、退款、审批通过或绕过审批的调账') &&
    developmentDocs.includes('支付建单、支付回调处理、主动验单、退款执行或 provider payload 读取') &&
    developmentDocs.includes('服务创建、暂停、恢复、重装、删除、迁移、资源交付或宿主机操作') &&
    developmentDocs.includes('扩展安装、启用、停用、卸载、市场发布或主题启用') &&
    platformPlan.includes('这些项目是有意保留在 PayIncus 内部状态机或后台审核流里的高风险边界') &&
    platformPlan.includes('不是当前 Public API 首版未完成的阻塞项') &&
    platformPlan.includes('新增前必须先补 scope 元数据、OpenAPI、SDK、审计日志、限流、幂等、状态机回滚和生产 proof'),
  'extension docs must define the high-risk Public API boundary as an intentional guardrail, not an accidental gap'
)

assert.ok(
    serializedOpenApi.includes('listPublicProducts') &&
    serializedOpenApi.includes('updateCurrentPublicApiProfile') &&
    serializedOpenApi.includes('getPublicProduct') &&
    serializedOpenApi.includes('getCurrentPublicApiBalance') &&
    serializedOpenApi.includes('listCurrentPublicApiBalanceLogs') &&
    serializedOpenApi.includes('listCurrentPublicApiBalanceAdjustmentRequests') &&
    serializedOpenApi.includes('createCurrentPublicApiBalanceAdjustmentRequest') &&
    serializedOpenApi.includes('listPublicServices') &&
    serializedOpenApi.includes('getPublicService') &&
    serializedOpenApi.includes('queuePublicServiceAction') &&
    serializedOpenApi.includes('renewPublicService') &&
    serializedOpenApi.includes('PublicApiServiceRenewRequest') &&
    serializedOpenApi.includes('PublicApiServiceRenewResult') &&
    serializedOpenApi.includes('getPublicServiceTask') &&
    serializedOpenApi.includes('cancelPublicServiceTask') &&
    serializedOpenApi.includes('listPublicOrders') &&
    serializedOpenApi.includes('getPublicOrder') &&
    serializedOpenApi.includes('^(recharge|instance_billing):[1-9]') &&
    serializedOpenApi.includes('listPublicBillingRecords') &&
    serializedOpenApi.includes('getPublicBillingRecord') &&
    serializedOpenApi.includes('listPublicTickets') &&
    serializedOpenApi.includes('getPublicTicket') &&
    serializedOpenApi.includes('createPublicTicket') &&
    serializedOpenApi.includes('createPublicTicketReply') &&
    serializedOpenApi.includes('listPublicNotifications') &&
    serializedOpenApi.includes('getPublicUnreadNotificationCount') &&
    serializedOpenApi.includes('sendPublicNotification') &&
    serializedOpenApi.includes('listPublicPluginActions') &&
    serializedOpenApi.includes('getPublicPluginActions') &&
    serializedOpenApi.includes('dispatchPublicPluginAction') &&
    serializedOpenApi.includes('PublicApiProduct') &&
    serializedOpenApi.includes('PublicApiBalance') &&
    serializedOpenApi.includes('PublicApiBalanceLog') &&
    serializedOpenApi.includes('CreatePublicApiBalanceAdjustmentRequest') &&
    serializedOpenApi.includes('PublicApiBalanceAdjustmentRequest') &&
    !serializedOpenApi.includes('Public API/OAuth token id used as an audit source reference') &&
    serializedOpenApi.includes('PublicApiService') &&
    serializedOpenApi.includes('PublicApiServiceIncluded') &&
    serializedOpenApi.includes('^(product|plan)(,(product|plan))*$') &&
    serializedOpenApi.includes('PublicApiServiceActionRequest') &&
    serializedOpenApi.includes('PublicApiServiceActionResult') &&
    serializedOpenApi.includes('PublicApiServiceTask') &&
    serializedOpenApi.includes('PublicApiOrder') &&
    serializedOpenApi.includes('PublicApiBillingRecord') &&
    serializedOpenApi.includes('PublicApiTicket') &&
    serializedOpenApi.includes('PublicApiTicketAttachment') &&
    serializedOpenApi.includes('CreatePublicApiTicketMultipartRequest') &&
    !serializedOpenApi.includes('balanceLogId') &&
    serializedOpenApi.includes('CreatePublicApiTicketReplyMultipartRequest') &&
    serializedOpenApi.includes('multipart/form-data') &&
    serializedOpenApi.includes('UpdatePublicApiProfileRequest') &&
    serializedOpenApi.includes('CreatePublicApiTicketRequest') &&
    serializedOpenApi.includes('PublicApiTicketCreateResult') &&
    serializedOpenApi.includes('CreatePublicApiTicketReplyRequest') &&
    serializedOpenApi.includes('UpdatePublicApiTicketStatusRequest') &&
    serializedOpenApi.includes('PublicApiTicketStatusResult') &&
    serializedOpenApi.includes('PublicApiNotification') &&
    serializedOpenApi.includes('PublicApiUnreadNotificationCount') &&
    serializedOpenApi.includes('CreatePublicApiNotificationRequest') &&
    serializedOpenApi.includes('PublicApiNotificationResult') &&
    serializedOpenApi.includes('flash_sale_reminder') &&
    serializedOpenApi.includes('plugin:<pluginId>:<templateId>') &&
    serializedOpenApi.includes('enabled plugin-declared template') &&
    serializedOpenApi.includes('PublicPluginActionDescriptor') &&
    serializedOpenApi.includes('PublicPluginActionCatalogItem') &&
    serializedOpenApi.includes('PublicPluginActionCatalog') &&
    serializedOpenApi.includes('DispatchPublicPluginActionRequest') &&
    serializedOpenApi.includes('PublicPluginActionResult') &&
    serializedOpenApi.includes('PublicApiTicketMessage'),
  'OpenAPI must document the products, orders, tickets, profile update, public ticket create/reply, self notification, and plugin action resource operations and schemas'
)

assert.ok(
    developmentDocs.includes('GET /api/v1/products') &&
    developmentDocs.includes('PATCH /api/v1/me') &&
    developmentDocs.includes('GET /api/v1/balance') &&
    developmentDocs.includes('GET /api/v1/balance/logs') &&
    developmentDocs.includes('GET /api/v1/balance/adjustment-requests') &&
    developmentDocs.includes('POST /api/v1/balance/adjustment-requests') &&
    developmentDocs.includes('GET /api/v1/billing-records') &&
    developmentDocs.includes('GET /api/v1/billing-records/:id') &&
    developmentDocs.includes('`balance:read` 已对应当前用户账户余额和余额流水只读接口') &&
    developmentDocs.includes('余额流水只读接口') &&
    developmentDocs.includes('`balance:write` 已对应当前用户自己的余额调整申请提交和申请列表读取') &&
    developmentDocs.includes('不会直接写余额、余额流水、支付或充值订单') &&
    developmentDocs.includes('`billing:read` 已对应当前用户自己的实例计费记录列表和详情读取') &&
    developmentDocs.includes('不返回余额流水对象、支付回调、provider payload、内部对账数据或其他用户账单') &&
    developmentDocs.includes('服务、订单和工单列表已经支持白名单安全过滤') &&
    developmentDocs.includes('服务接口已经支持白名单 `include=product,plan`') &&
    developmentDocs.includes('受控 `include = product,plan`') &&
    developmentDocs.includes('`included.products` 和 `included.plans`') &&
    developmentDocs.includes('GET /api/v1/services') &&
    developmentDocs.includes('POST /api/v1/services/:id/actions') &&
    developmentDocs.includes('POST /api/v1/services/:id/renew') &&
    developmentDocs.includes('GET /api/v1/services/:id/tasks/:taskId') &&
    developmentDocs.includes('DELETE /api/v1/services/:id/tasks/:taskId') &&
    developmentDocs.includes('GET /api/v1/orders') &&
    developmentDocs.includes('GET /api/v1/orders/:id') &&
    developmentDocs.includes('订单已支持当前用户单条详情读取') &&
    developmentDocs.includes('订单 ID 形如 `recharge:123` 或 `instance_billing:456`') &&
    developmentDocs.includes('GET /api/v1/tickets') &&
    developmentDocs.includes('POST /api/v1/tickets') &&
    developmentDocs.includes('POST /api/v1/tickets/:id/replies') &&
    developmentDocs.includes('PATCH /api/v1/tickets/:id/status') &&
    developmentDocs.includes('GET /api/v1/notifications') &&
    developmentDocs.includes('GET /api/v1/notifications/unread-count') &&
    developmentDocs.includes('POST /api/v1/notifications') &&
    developmentDocs.includes('GET /api/v1/plugins') &&
    developmentDocs.includes('GET /api/v1/plugins/:pluginId/actions') &&
    developmentDocs.includes('POST /api/v1/plugins/:pluginId/actions/:action') &&
    developmentDocs.includes('`tickets:write` 已对应受控工单创建、公开回复、图片附件、关闭自己的工单和重新打开自己的已关闭工单接口') &&
    developmentDocs.includes('`multipart/form-data` 可通过 `images` 字段上传最多 6 张图片附件') &&
    developmentDocs.includes('`services:operate` 已对应受控服务电源任务入队') &&
    developmentDocs.includes('`services:billing` 已对应受控服务续费接口') &&
    developmentDocs.includes('复用内部续费事务，不接受任意金额或直接余额扣款') &&
    developmentDocs.includes('任务状态轮询和等待中任务取消接口') &&
    developmentDocs.includes('只允许 `start`、`stop`、`restart` 当前用户自己的服务') &&
    developmentDocs.includes('`profile:write`') &&
    developmentDocs.includes('只允许更新低风险资料字段 `avatarStyle`') &&
    developmentDocs.includes('受控工单创建、公开回复、图片附件、关闭自己的工单和重新打开自己的已关闭工单接口') &&
    developmentDocs.includes('接口不接受内部备注、状态覆盖、目标用户覆盖、管理员字段、任意文件或存储 provider 文件 ID') &&
    developmentDocs.includes('`notifications:read` 已对应当前用户站内信和未读数量只读接口') &&
    developmentDocs.includes('不返回渠道配置、发送日志或原始事件 payload') &&
    developmentDocs.includes('`notifications:send` 已对应受控自通知、平台白名单通知模板和已启用扩展声明的受控通知模板接口') &&
    developmentDocs.includes('已启用扩展在 manifest 里声明的模板 `plugin:<pluginId>:<templateId>`') &&
    developmentDocs.includes('capabilities.notificationTemplates') &&
    developmentDocs.includes('平台白名单模板 `flash_sale_reminder`、`service_action_update`、`billing_notice`') &&
    developmentDocs.includes('必须通过已开放的 `/api/v1` 受控资源、扩展 action、事件订阅、服务/支付 lifecycle hook 和插件存储进入平台') &&
    developmentDocs.includes('已开放低风险资料写入、待审批余额调整申请、受控服务电源任务、受控服务续费、工单创建/回复/状态操作、自通知和扩展 action 触发') &&
    developmentDocs.includes('直接支付建单/回调/退款、直接余额写入、服务创建/删除/迁移、敏感用户资料和扩展/主题管理等高风险写入仍不通过 Public API 开放') &&
    !developmentDocs.includes('API token/scope 只允许按已开放 scope 访问只读资源') &&
    developmentDocs.includes('Public API 写入型接口已经挂载独立限流') &&
    developmentDocs.includes('扩展 action dispatch 另有数据库持久化的按 token + 扩展 + action 维度动态配额') &&
    developmentDocs.includes('后台扩展中心可以配置全局策略、指定扩展策略或指定扩展 action 策略') &&
    developmentDocs.includes('同一个 token、扩展和 action 在多后端实例之间共享计数窗口') &&
    developmentDocs.includes('超过后返回 `PUBLIC_PLUGIN_ACTION_RATE_LIMITED` 和 `Retry-After`') &&
    developmentDocs.includes('触发限流会返回 `429 TooManyRequests`') &&
    developmentDocs.includes('`plugins:action` 已对应受控扩展 action 触发接口') &&
    developmentDocs.includes('只返回已启用扩展的公开 webhook action 契约') &&
    developmentDocs.includes('不会返回 webhook URL、secret、扩展配置值、服务扩展 hook 或支付网关扩展 hook') &&
    developmentDocs.includes('不会绕过扩展 manifest') &&
    developmentDocs.includes('不接受 `userId`、群发、任意渠道选择') &&
    developmentDocs.includes('不会返回 root 密码、Incus ID、宿主机内部配置或特权连接密钥') &&
    developmentDocs.includes('不会返回支付回调数据') &&
    developmentDocs.includes('不会返回内部备注') &&
    overviewDocs.includes('公共资源 API') &&
    overviewDocs.includes('/api/v1/balance') &&
    overviewDocs.includes('/api/v1/balance/logs') &&
    overviewDocs.includes('/api/v1/balance/adjustment-requests') &&
    overviewDocs.includes('/api/v1/billing-records') &&
    overviewDocs.includes('/api/v1/notifications') &&
    overviewDocs.includes('/api/v1/plugins') &&
    overviewDocs.includes('`profile:write` 只允许更新 `avatarStyle`') &&
    overviewDocs.includes('`balance:write` 只允许提交当前 token 用户自己的待审批余额调整申请') &&
    overviewDocs.includes('services:operate') &&
    overviewDocs.includes('services:billing') &&
    overviewDocs.includes('`notifications:send` 只允许给当前 token 用户自己发送短文本通知') &&
    overviewDocs.includes('`plugins:action` 只允许发现和触发已启用扩展声明过的公开 webhook action') &&
    overviewDocs.includes('再轮询公开任务状态') &&
    overviewDocs.includes('取消仍在等待中的公开电源任务') &&
    overviewDocs.includes('支付建单、支付回调、退款、直接余额写入、敏感用户资料、扩展安装启停和主题启用也不通过 Public API 开放') &&
    overviewDocs.includes('服务操作首版不开放创建、暂停、恢复、重装、删除、迁移或宿主机操作') &&
    overviewDocs.includes('完整后端功能必须通过扩展 action runtime、API token/scope、事件系统和扩展存储等受控接口实现') &&
    !overviewDocs.includes('完整后端功能必须等待扩展 action runtime') &&
    enOverviewDocs.includes('## Public Resource API') &&
    enOverviewDocs.includes('/api/v1/balance') &&
    enOverviewDocs.includes('/api/v1/balance/logs') &&
    enOverviewDocs.includes('/api/v1/balance/adjustment-requests') &&
    enOverviewDocs.includes('/api/v1/billing-records') &&
    enOverviewDocs.includes('/api/v1/notifications') &&
    enOverviewDocs.includes('/api/v1/plugins') &&
    enOverviewDocs.includes('`profile:write` only allows updating `avatarStyle`') &&
    enOverviewDocs.includes('`balance:write` only allows submitting the current token user') &&
    enOverviewDocs.includes('services:operate') &&
    enOverviewDocs.includes('services:billing') &&
    enOverviewDocs.includes('`notifications:send` only allows sending short text notifications') &&
    enOverviewDocs.includes('`plugins:action` only allows discovering and triggering public webhook actions') &&
    enOverviewDocs.includes('polling public task state') &&
    enOverviewDocs.includes('canceling still-pending public power tasks') &&
    enOverviewDocs.includes('Payment creation, payment callback handling, refunds, direct balance writes, sensitive user profiles, extension install/enablement, and theme enablement are not exposed through the Public API') &&
    enOverviewDocs.includes('does not expose service creation, suspend, resume, reinstall, delete, migration, or host operations') &&
    enOverviewDocs.includes('Complete backend capabilities must use controlled surfaces such as the extension action runtime, API token/scope, event system, and plugin storage') &&
    platformPlan.includes('资源 API 只读首版') &&
    platformPlan.includes('所有公开列表已支持统一 `page`、`pageSize` 和白名单 `sort`') &&
    platformPlan.includes('统一分页、白名单排序、服务/订单/账单/工单列表白名单过滤') &&
    platformPlan.includes('写入型资源 API 首版') &&
    platformPlan.includes('服务 `start`/`stop`/`restart` 任务入队、状态轮询和等待中任务取消') &&
    platformPlan.includes('受控服务续费') &&
    platformPlan.includes('扩展 action 发现/触发') &&
    platformPlan.includes('Public API 写入面已按操作类型挂载独立限流') &&
    platformPlan.includes('扩展 action dispatch 另有数据库持久化、后台可配置、按 token + 扩展 + action 维度共享的动态配额') &&
    platformPlan.includes('余额/余额流水读取、余额调整申请提交和申请列表读取、账单读取、服务读取、服务 `start`/`stop`/`restart` 任务入队、状态轮询和等待中任务取消、受控服务续费、工单创建/回复/关闭/重新打开、工单图片附件上传、站内信读取、自通知发送、白名单通知模板、扩展 manifest 受控通知模板、Public API 写入面独立限流和扩展 action 按 token/扩展/action 数据库持久化动态配额、后台全局/扩展/action 覆盖策略已完成受控首版') &&
    platformPlan.includes('直接余额充值/扣款/退款或绕过审批的调账'),
  'extension docs must describe the resource API, public profile update, public ticket create/reply, self notification, and plugin action write APIs, and remaining high-risk write APIs'
)

assert.ok(
  serverPackage.includes('"test:public-api-resource-guards"') &&
    rootPackage.includes('pnpm --filter server test:public-api-resource-guards'),
  'public API resource guard must be wired into package scripts'
)

console.log('public API resource guard tests passed')
