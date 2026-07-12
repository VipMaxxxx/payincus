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
const ticketAttachments = read('server/src/lib/ticket-attachments.ts')
const openapiSource = read('server/src/lib/public-api-openapi.ts')
const clientTypes = read('client/src/types/api.ts')
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
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.balanceAdjustmentWrite }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceOperate }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceRenew }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceTaskRead }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceTaskCancel }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.ticketCreate }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.ticketReply }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.ticketStatus }') &&
    route.includes('config: { rateLimit: PUBLIC_API_RATE_LIMITS.notificationSend }') &&
    rateLimitConfig.includes('globalRateLimit') &&
    rateLimitConfig.includes('findRateLimitRule'),
  'public API write routes must have operation-specific Fastify rate limits'
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
    !route.includes('data: { email') &&
    !route.includes('data: { balance') &&
    !route.includes('data: { role'),
  'public profile update API must require profile:write, only accept low-risk avatar style updates, and avoid sensitive profile fields'
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
    route.includes("LogModule.PLUGIN, 'public_api.ticket_create'") &&
    !route.includes('targetUserId') &&
    !route.includes('internalNotes'),
  'public ticket create API must require tickets:write, stay user-scoped, support controlled image attachments, reject internal notes/status overrides, notify recipients, and audit writes'
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
    route.includes('public_api.ticket_reply_create'),
  'public ticket reply API must require tickets:write, stay user-scoped, reject closed tickets, support controlled image attachments, avoid status overrides, notify recipients, and audit writes'
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
    route.includes("'public_api.ticket_status_update'") &&
    !route.includes('assigneeId') &&
    !route.includes('internalNotes'),
  'public ticket status API must require tickets:write, stay user-scoped, only close/reopen own tickets, and avoid arbitrary status/internal fields'
)

assert.ok(
  route.includes("fastify.post<{ Body: PublicApiNotificationBody }>('/notifications'") &&
    route.includes("authenticatePublicApiRequest(request, reply, 'notifications:send')") &&
    route.includes('MAX_PUBLIC_NOTIFICATION_TITLE_LENGTH = 120') &&
    route.includes('MAX_PUBLIC_NOTIFICATION_MESSAGE_LENGTH = 2000') &&
    route.includes("PUBLIC_NOTIFICATION_TEMPLATE_IDS = ['flash_sale_reminder', 'service_action_update', 'billing_notice']") &&
    route.includes('resolvePublicNotificationTemplate') &&
    route.includes('MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLES = 10') &&
    route.includes('MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLE_LENGTH = 120') &&
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
  '/services/{id}/provision'
]

for (const path of forbiddenOpenApiPaths) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(document.paths, path),
    false,
    `OpenAPI must not expose high-risk public path ${path} without a reviewed state machine and scope`
  )
}


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
    serializedOpenApi.includes('PublicApiTicketMessage'),
  'OpenAPI must document the products, orders, tickets, profile update, public ticket create/reply and self notification resource operations and schemas'
)


assert.ok(
  serverPackage.includes('"test:public-api-resource-guards"') &&
    rootPackage.includes('pnpm --filter server test:public-api-resource-guards'),
  'public API resource guard must be wired into package scripts'
)

console.log('public API resource guard tests passed')
