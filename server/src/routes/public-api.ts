import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { BalanceAdjustmentRequestStatus, BalanceAdjustmentRequestType, BalanceLogType, BillingRecordType, InstanceStatus, Prisma, RechargeStatus, TicketPriority, TicketStatus } from '@prisma/client'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { authenticatePublicApiRequest } from '../lib/public-api-auth.js'
import { buildPublicApiOpenApiDocument, stringifyPublicApiOpenApiYaml } from '../lib/public-api-openapi.js'
import { prisma } from '../db/prisma.js'
import { addTicketMessage, createTicket, type CreateTicketMessageAttachmentData } from '../db/tickets.js'
import { createBalanceAdjustmentRequest } from '../db/balance.js'
import { findUserById, getSystemConfigBoolean, performRenewal } from '../db/index.js'
import { getAllAdminUserIds } from '../db/users.js'
import { sendHostManagedInstanceNotification, sendNotification } from '../lib/notifier.js'
import { sendRenewSuccessEmail } from '../lib/mailer.js'
import { emitPluginEvent } from '../lib/plugin-event-emitter.js'
import { executePluginAction } from '../lib/plugin-runtime.js'
import type { PayIncusPluginManifest, PluginActionManifest, PluginNotificationTemplateManifest } from '../lib/plugin-manifest.js'
import { emitServiceTaskPluginEvent, emitUserPluginEvent } from '../lib/plugin-business-events.js'
import { cancelInstanceTask, createInstanceTask, getTaskQueuePosition, InstanceTaskConflictError } from '../db/instance-tasks.js'
import {
  cleanupUploadedTicketImages,
  isHandledTicketPayloadError,
  readTicketPayload,
  TICKET_UPLOAD_BODY_LIMIT,
  uploadTicketImages
} from '../lib/ticket-attachments.js'

const MAX_PAGE_SIZE = 100
const MIN_PUBLIC_TICKET_SUBJECT_LENGTH = 2
const MAX_PUBLIC_TICKET_SUBJECT_LENGTH = 200
const MIN_PUBLIC_TICKET_CREATE_CONTENT_LENGTH = 10
const MAX_PUBLIC_TICKET_REPLY_LENGTH = 5000
const MAX_PUBLIC_NOTIFICATION_TITLE_LENGTH = 120
const MAX_PUBLIC_NOTIFICATION_MESSAGE_LENGTH = 2000
const MAX_PUBLIC_NOTIFICATION_SOURCE_LENGTH = 80
const MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLES = 10
const MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLE_LENGTH = 120
const MIN_PUBLIC_BALANCE_ADJUSTMENT_REASON_LENGTH = 10
const MAX_PUBLIC_BALANCE_ADJUSTMENT_REASON_LENGTH = 500
const MAX_PUBLIC_BALANCE_ADJUSTMENT_AMOUNT = 10000
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/
const PUBLIC_API_RATE_LIMITS = {
  balanceAdjustmentWrite: { max: 5, timeWindow: '10 minutes' },
  serviceOperate: { max: 10, timeWindow: '1 minute' },
  serviceRenew: { max: 5, timeWindow: '10 minutes' },
  serviceTaskRead: { max: 120, timeWindow: '1 minute' },
  serviceTaskCancel: { max: 10, timeWindow: '1 minute' },
  ticketCreate: { max: 10, timeWindow: '5 minutes' },
  ticketReply: { max: 20, timeWindow: '1 minute' },
  ticketStatus: { max: 20, timeWindow: '1 minute' },
  notificationSend: { max: 20, timeWindow: '1 minute' },
  pluginActionDispatch: { max: 30, timeWindow: '1 minute' }
} as const
const PUBLIC_PLUGIN_ACTION_DYNAMIC_RATE_LIMITS = {
  normal: { max: 30, windowMs: 60_000 },
  strict: { max: 10, windowMs: 60_000 }
} as const
const PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE = '*'
const PUBLIC_TICKET_CATEGORIES = new Set(['general', 'billing', 'technical', 'abuse'])
const PUBLIC_TICKET_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const PUBLIC_TICKET_STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed'])
const PUBLIC_SERVICE_STATUSES = new Set(['creating', 'running', 'stopped', 'suspended', 'error', 'deleted'])
const PUBLIC_SERVICE_INCLUDES = new Set(['product', 'plan'])
const PUBLIC_CREATED_AT_SORT_FIELDS = new Set(['createdAt'])
const PUBLIC_SERVICE_SORT_FIELDS = new Set(['createdAt', 'displayOrder'])
const PUBLIC_TICKET_SORT_FIELDS = new Set(['createdAt', 'updatedAt'])
const PUBLIC_PLUGIN_SORT_FIELDS = new Set(['pluginId', 'createdAt'])
const PUBLIC_ORDER_STATUSES = new Set(['pending', 'completed', 'failed', 'cancelled', 'refunded'])
const PUBLIC_BILLING_RECORD_TYPES = new Set<BillingRecordType>(['newPurchase', 'renew', 'upgrade', 'downgrade', 'refund', 'transfer_fee'])
const PUBLIC_BALANCE_ADJUSTMENT_STATUSES = new Set<BalanceAdjustmentRequestStatus>(['pending', 'approved', 'rejected'])
const PUBLIC_BALANCE_ADJUSTMENT_TYPES = new Set<BalanceAdjustmentRequestType>(['manual_adjust', 'refund'])
const PUBLIC_BALANCE_ADJUSTMENT_ORDER_NO_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/
const PUBLIC_BALANCE_LOG_TYPES = new Set<BalanceLogType>([
  'recharge',
  'consume',
  'refund',
  'admin_adjust',
  'gift',
  'transfer_fee',
  'transfer_refund',
  'hosting_withdraw',
  'hosting_deduction',
  'invite_generate'
])
const PUBLIC_PROFILE_AVATAR_STYLES = [
  'adventurer', 'adventurerNeutral', 'avataaars', 'avataaarsNeutral',
  'bigEars', 'bigEarsNeutral', 'bigSmile', 'bottts', 'botttsNeutral',
  'croodles', 'croodlesNeutral', 'dylan', 'funEmoji', 'glass', 'icons',
  'identicon', 'initials', 'lorelei', 'loreleiNeutral', 'micah', 'miniavs',
  'notionists', 'notionistsNeutral', 'openPeeps', 'personas', 'pixelArt',
  'pixelArtNeutral', 'rings', 'shapes', 'thumbs'
] as const
const PUBLIC_PROFILE_AVATAR_STYLE_SET = new Set<string>(PUBLIC_PROFILE_AVATAR_STYLES)
const PUBLIC_NOTIFICATION_TEMPLATE_IDS = ['flash_sale_reminder', 'service_action_update', 'billing_notice'] as const
type PublicNotificationTemplateId = typeof PUBLIC_NOTIFICATION_TEMPLATE_IDS[number]
const PUBLIC_NOTIFICATION_TEMPLATE_ID_SET = new Set<string>(PUBLIC_NOTIFICATION_TEMPLATE_IDS)
const PUBLIC_PLUGIN_NOTIFICATION_TEMPLATE_PATTERN = /^plugin:([a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}):([a-z][a-z0-9_.:-]{0,79})$/
const PUBLIC_NOTIFICATION_TEMPLATE_PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,39})\s*\}\}/g

interface PublicApiListQuery {
  page?: string
  pageSize?: string
  sort?: string
}

interface PublicApiOrderListQuery extends PublicApiListQuery {
  status?: string
}

interface PublicApiOrderParams {
  id: string
}

interface PublicApiBillingRecordListQuery extends PublicApiListQuery {
  type?: string
  serviceId?: string
}

interface PublicApiServiceListQuery extends PublicApiListQuery {
  status?: string
  include?: string
}

interface PublicApiTicketListQuery extends PublicApiListQuery {
  status?: string
  category?: string
  priority?: string
}

interface PublicApiBalanceLogQuery extends PublicApiListQuery {
  type?: string
  lotteryGift?: string
}

interface PublicApiBalanceAdjustmentListQuery extends PublicApiListQuery {
  status?: string
}

interface PublicApiCreateBalanceAdjustmentBody {
  amount?: unknown
  requestType?: unknown
  reason?: unknown
  orderNo?: unknown
}

interface PublicApiIdParams {
  id: string
}

interface PublicApiTicketReplyBody {
  content?: unknown
}

interface PublicApiTicketStatusBody {
  action?: unknown
}

interface PublicApiCreateTicketBody {
  subject?: unknown
  category?: unknown
  priority?: unknown
  content?: unknown
  instanceId?: unknown
}

interface PublicApiNotificationBody {
  title?: unknown
  message?: unknown
  source?: unknown
  template?: unknown
  variables?: unknown
}

interface PublicApiNotificationListQuery extends PublicApiListQuery {
  isRead?: string
}

interface PublicApiUpdateProfileBody {
  avatarStyle?: unknown
}

interface PublicApiPluginActionParams {
  pluginId: string
  action: string
}

interface PublicApiPluginParams {
  pluginId: string
}

interface PublicApiPluginActionBody {
  payload?: unknown
  idempotencyKey?: unknown
}

interface PublicPluginActionRateLimitPolicyRow {
  maxRequests: number
  windowSeconds: number
}

interface PublicApiServiceActionBody {
  action?: unknown
}

interface PublicApiServiceRenewBody {
  months?: unknown
}

type PublicApiServiceOperation = 'start' | 'stop' | 'restart'

interface PublicApiServiceTaskParams {
  id: string
  taskId: string
}

type PublicApiServiceInclude = 'product' | 'plan'
type PublicApiSortDirection = 'asc' | 'desc'

interface PublicApiSort {
  field: string
  direction: PublicApiSortDirection
  value: string
}

const publicServiceSelect = {
  id: true,
  name: true,
  status: true,
  image: true,
  cpu: true,
  memory: true,
  disk: true,
  ipv4: true,
  ipv6: true,
  networkMode: true,
  portLimit: true,
  snapshotLimit: true,
  backupLimit: true,
  siteLimit: true,
  monthlyTrafficLimit: true,
  monthlyTrafficUsed: true,
  trafficStatus: true,
  expiresAt: true,
  suspendedAt: true,
  suspendReason: true,
  billingPrice: true,
  billingCycle: true,
  autoRenew: true,
  createdAt: true,
  updatedAt: true,
  packagePlan: {
    select: {
      id: true,
      name: true,
      billingCycle: true,
      price: true,
      package: { select: { id: true, name: true } }
    }
  }
} satisfies Prisma.InstanceSelect

type PublicServiceRecord = Prisma.InstanceGetPayload<{ select: typeof publicServiceSelect }>

const publicBillingRecordInclude = {
  instance: {
    select: {
      id: true,
      name: true,
      status: true,
      packagePlan: {
        select: {
          id: true,
          name: true,
          package: { select: { id: true, name: true } }
        }
      }
    }
  }
} satisfies Prisma.InstanceBillingRecordInclude

type PublicBillingRecord = Prisma.InstanceBillingRecordGetPayload<{ include: typeof publicBillingRecordInclude }>

function toMoney(value: unknown): number {
  if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber()
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function serializeBigInt(value: bigint | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value.toString()
}

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !POSITIVE_ID_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseOptionalPositiveId(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined
  return parsePositiveId(value)
}

function normalizeOptionalEnum(value: unknown, allowed: Set<string>): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return allowed.has(trimmed) ? trimmed : null
}

function parsePagination(query: PublicApiListQuery) {
  const page = Math.max(1, parsePositiveId(query.page) ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parsePositiveId(query.pageSize) ?? 20))
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize
  }
}

function paginationMeta(input: { page: number; pageSize: number; total: number }) {
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages: Math.max(1, Math.ceil(input.total / input.pageSize))
  }
}

function parsePublicApiSort(value: unknown, allowedFields: Set<string>, defaultSort: string): PublicApiSort | null {
  const raw = value === undefined || value === null || value === '' ? defaultSort : value
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const direction: PublicApiSortDirection = trimmed.startsWith('-') ? 'desc' : 'asc'
  const field = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed
  if (!field || !allowedFields.has(field)) return null
  return { field, direction, value: direction === 'desc' ? `-${field}` : field }
}

function publicSortMeta(input: { page: number; pageSize: number; total: number; sort: PublicApiSort }) {
  return {
    ...paginationMeta(input),
    sort: input.sort.value
  }
}

function buildPublicSortOrder(sort: PublicApiSort): Array<Record<string, Prisma.SortOrder>> {
  return [
    { [sort.field]: sort.direction },
    { id: sort.direction }
  ]
}

function buildPublicServiceSortOrder(sort: PublicApiSort): Array<Record<string, Prisma.SortOrder>> {
  if (sort.field === 'displayOrder') {
    return [
      { displayOrder: sort.direction },
      { createdAt: 'desc' },
      { id: 'desc' }
    ]
  }
  return buildPublicSortOrder(sort)
}

function parsePublicApiInclude(value: unknown, allowed: Set<string>): string[] | null {
  if (value === undefined || value === null || value === '') return []
  if (typeof value !== 'string') return null
  const includes = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  if (includes.some(item => !allowed.has(item))) return null
  return Array.from(new Set(includes))
}

function maskTradeNo(value: string | null): string | null {
  if (!value) return null
  if (value.length <= 8) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

function normalizePublicBalanceAdjustmentAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(amount)) return null
  const normalized = Number(amount.toFixed(2))
  if (normalized <= 0 || normalized > MAX_PUBLIC_BALANCE_ADJUSTMENT_AMOUNT) return null
  return normalized
}

function normalizePublicBalanceAdjustmentReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const reason = value.trim().replace(/\s+/g, ' ')
  if (reason.length < MIN_PUBLIC_BALANCE_ADJUSTMENT_REASON_LENGTH || reason.length > MAX_PUBLIC_BALANCE_ADJUSTMENT_REASON_LENGTH) return null
  return reason
}

function isPublicBalanceAdjustmentType(value: string): value is BalanceAdjustmentRequestType {
  return PUBLIC_BALANCE_ADJUSTMENT_TYPES.has(value as BalanceAdjustmentRequestType)
}

function isPublicBalanceAdjustmentStatus(value: string): value is BalanceAdjustmentRequestStatus {
  return PUBLIC_BALANCE_ADJUSTMENT_STATUSES.has(value as BalanceAdjustmentRequestStatus)
}

function normalizePublicBalanceAdjustmentType(value: unknown): BalanceAdjustmentRequestType {
  return typeof value === 'string' && isPublicBalanceAdjustmentType(value)
    ? value
    : 'manual_adjust'
}

function normalizePublicBalanceAdjustmentStatus(value: unknown): BalanceAdjustmentRequestStatus | undefined | null {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  const status = value.trim()
  return isPublicBalanceAdjustmentStatus(status) ? status : null
}

function normalizePublicBalanceAdjustmentOrderNo(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  const orderNo = value.trim()
  return PUBLIC_BALANCE_ADJUSTMENT_ORDER_NO_PATTERN.test(orderNo) ? orderNo : null
}

function serializePublicBalanceAdjustmentRequest(request: {
  id: number
  userId: number
  amount: unknown
  requestType: string
  status: string
  orderNo: string | null
  reason: string
  reviewRemark: string | null
  createdAt: Date
  updatedAt: Date
  reviewedAt: Date | null
}) {
  return {
    id: request.id,
    userId: request.userId,
    amount: toMoney(request.amount),
    requestType: request.requestType,
    status: request.status,
    orderNo: request.orderNo,
    reason: request.reason,
    reviewRemark: request.reviewRemark,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() || null
  }
}

function normalizePublicTicketSubject(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const subject = value.trim()
  if (subject.length < MIN_PUBLIC_TICKET_SUBJECT_LENGTH || subject.length > MAX_PUBLIC_TICKET_SUBJECT_LENGTH) {
    return null
  }
  return subject
}

function normalizePublicTicketMessageContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePublicTicketCategory(value: unknown): string {
  if (typeof value !== 'string') return 'general'
  const category = value.trim()
  return PUBLIC_TICKET_CATEGORIES.has(category) ? category : 'general'
}

function normalizePublicTicketPriority(value: unknown): 'low' | 'normal' | 'high' | 'urgent' {
  if (typeof value !== 'string') return 'normal'
  const priority = value.trim()
  return PUBLIC_TICKET_PRIORITIES.has(priority) ? priority as 'low' | 'normal' | 'high' | 'urgent' : 'normal'
}

function normalizePublicTicketStatusAction(value: unknown): 'close' | 'reopen' | null {
  if (typeof value !== 'string') return null
  const action = value.trim()
  return action === 'close' || action === 'reopen' ? action : null
}

function serializePublicTicketAttachment(attachment: {
  id: number
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  thumbnailUrl: string | null
  createdAt: Date
}) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    thumbnailUrl: attachment.thumbnailUrl,
    createdAt: attachment.createdAt.toISOString()
  }
}

function normalizePublicNotificationText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > maxLength) return null
  return text
}

function normalizePublicNotificationTemplate(value: unknown): PublicNotificationTemplateId | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const template = value.trim()
  return PUBLIC_NOTIFICATION_TEMPLATE_ID_SET.has(template) ? template as PublicNotificationTemplateId : null
}

function parsePublicPluginNotificationTemplateRef(value: unknown): { pluginId: string; templateId: string } | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const match = value.trim().match(PUBLIC_PLUGIN_NOTIFICATION_TEMPLATE_PATTERN)
  if (!match) return null
  return { pluginId: match[1], templateId: match[2] }
}

function normalizePublicNotificationVariables(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLES) return null

  const normalized: Record<string, string> = {}
  for (const [key, rawValue] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) return null
    if (rawValue === null || rawValue === undefined) continue
    if (!['string', 'number', 'boolean'].includes(typeof rawValue)) return null
    const text = String(rawValue).trim()
    if (!text || text.length > MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLE_LENGTH) return null
    normalized[key] = text
  }
  return normalized
}

function renderPublicNotificationTemplate(
  template: PublicNotificationTemplateId,
  variables: Record<string, string>
): { title: string; message: string } | null {
  switch (template) {
    case 'flash_sale_reminder': {
      const campaignName = variables.campaignName
      const startsAt = variables.startsAt
      if (!campaignName || !startsAt) return null
      const productName = variables.productName ? `\n商品: ${variables.productName}` : ''
      return {
        title: '秒杀活动提醒',
        message: `活动「${campaignName}」将在 ${startsAt} 开始。${productName}`
      }
    }
    case 'service_action_update': {
      const serviceName = variables.serviceName
      const statusText = variables.statusText
      if (!serviceName || !statusText) return null
      return {
        title: '服务任务更新',
        message: `服务「${serviceName}」${statusText}。`
      }
    }
    case 'billing_notice': {
      const subject = variables.subject
      const amount = variables.amount
      if (!subject || !amount) return null
      const note = variables.note ? `\n${variables.note}` : ''
      return {
        title: '账单提醒',
        message: `账单「${subject}」金额 ¥${amount}。${note}`
      }
    }
    default:
      return null
  }
}

function renderPublicPluginNotificationTemplate(
  template: PluginNotificationTemplateManifest,
  variables: Record<string, string>
): { title: string; message: string } | null {
  for (const variable of template.variables || []) {
    if (!variables[variable]) return null
  }
  const render = (source: string) => source.replace(PUBLIC_NOTIFICATION_TEMPLATE_PLACEHOLDER_PATTERN, (_match, key: string) => {
    return variables[key] ?? ''
  }).trim()
  const title = render(template.title)
  const message = render(template.message)
  if (!title || title.length > MAX_PUBLIC_NOTIFICATION_TITLE_LENGTH || title.includes('{{')) return null
  if (!message || message.length > MAX_PUBLIC_NOTIFICATION_MESSAGE_LENGTH || message.includes('{{')) return null
  return { title, message }
}

async function resolvePublicNotificationTemplate(value: unknown, variables: Record<string, string>): Promise<{
  templateId: string
  rendered: { title: string; message: string }
} | null> {
  const platformTemplate = normalizePublicNotificationTemplate(value)
  if (platformTemplate) {
    const rendered = renderPublicNotificationTemplate(platformTemplate, variables)
    return rendered ? { templateId: platformTemplate, rendered } : null
  }
  const pluginTemplateRef = parsePublicPluginNotificationTemplateRef(value)
  if (!pluginTemplateRef) return null
  const manifest = await loadEnabledPublicPluginManifest(pluginTemplateRef.pluginId)
  if (!manifest || !(manifest.permissions || []).includes('notifications:send')) return null
  const template = (manifest.capabilities?.notificationTemplates || []).find(item => item.id === pluginTemplateRef.templateId)
  if (!template) return null
  const rendered = renderPublicPluginNotificationTemplate(template, variables)
  return rendered ? {
    templateId: `plugin:${pluginTemplateRef.pluginId}:${pluginTemplateRef.templateId}`,
    rendered
  } : null
}

function parseOptionalBooleanString(value: unknown): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function normalizePublicAvatarStyle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const avatarStyle = value.trim()
  return PUBLIC_PROFILE_AVATAR_STYLE_SET.has(avatarStyle) ? avatarStyle : null
}

function normalizePublicBalanceLogType(value: unknown): BalanceLogType | undefined {
  return typeof value === 'string' && PUBLIC_BALANCE_LOG_TYPES.has(value as BalanceLogType)
    ? value as BalanceLogType
    : undefined
}

function normalizePluginId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/.test(trimmed) ? trimmed : null
}

function normalizePluginActionName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(trimmed) ? trimmed : null
}

function normalizePublicServiceOperation(value: unknown): PublicApiServiceOperation | null {
  if (typeof value !== 'string') return null
  const action = value.trim()
  return action === 'start' || action === 'stop' || action === 'restart' ? action : null
}

function normalizePublicServiceRenewMonths(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null
  return value >= 1 && value <= 24 ? value : null
}

async function assertPublicServiceOperationAllowed(
  service: { id: number; status: string; suspendReason?: string | null },
  action: PublicApiServiceOperation
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }> {
  if (service.status === 'deleted') {
    return { ok: false, status: 404, code: 'SERVICE_NOT_FOUND', message: 'Service not found' }
  }
  if (service.status === 'suspended') {
    return {
      ok: false,
      status: 403,
      code: service.suspendReason === 'expired' ? 'SERVICE_SUSPENDED_EXPIRED' : 'SERVICE_SUSPENDED',
      message: 'Suspended services cannot be operated through the public API'
    }
  }
  if (action === 'start' && service.status === 'running') {
    return { ok: false, status: 409, code: 'SERVICE_ALREADY_RUNNING', message: 'Service is already running' }
  }
  if (action === 'stop' && service.status === 'stopped') {
    return { ok: false, status: 409, code: 'SERVICE_ALREADY_STOPPED', message: 'Service is already stopped' }
  }

  const [pendingTransfer, activeRestoreTask, activeUploadTask, activeInstanceTask] = await Promise.all([
    prisma.instanceTransfer.findFirst({
      where: { instanceId: service.id, status: { in: ['pending', 'processing'] } },
      select: { id: true, status: true }
    }),
    prisma.restoreTask.findFirst({
      where: { instanceId: service.id, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true, status: true }
    }),
    prisma.backupUploadTask.findFirst({
      where: { instanceId: service.id, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true, status: true }
    }),
    prisma.instanceTask.findFirst({
      where: { instanceId: service.id, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true, taskType: true, status: true }
    })
  ])

  if (pendingTransfer) {
    return {
      ok: false,
      status: 409,
      code: 'SERVICE_TRANSFER_LOCKED',
      message: 'Service has a pending transfer',
      details: { transferId: pendingTransfer.id, transferStatus: pendingTransfer.status }
    }
  }
  if (activeRestoreTask) {
    return {
      ok: false,
      status: 409,
      code: 'SERVICE_RESTORE_IN_PROGRESS',
      message: 'Service has an active restore task',
      details: { taskId: activeRestoreTask.id, status: activeRestoreTask.status }
    }
  }
  if (activeUploadTask) {
    return {
      ok: false,
      status: 409,
      code: 'SERVICE_UPLOAD_IN_PROGRESS',
      message: 'Service has an active backup upload task',
      details: { taskId: activeUploadTask.id, status: activeUploadTask.status }
    }
  }
  if (activeInstanceTask) {
    return {
      ok: false,
      status: 409,
      code: 'SERVICE_TASK_IN_PROGRESS',
      message: 'Service has an active operation task',
      details: { taskId: activeInstanceTask.id, taskType: activeInstanceTask.taskType, status: activeInstanceTask.status }
    }
  }

  return { ok: true }
}

async function assertPublicServiceRenewAllowed(
  service: {
    id: number
    hostId: number
    packagePlanId: number | null
    expiresAt: Date | null
  },
  months: number
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }> {
  if (!service.packagePlanId) {
    return { ok: false, status: 400, code: 'FREE_SERVICE', message: 'Free services do not need renewal' }
  }

  const host = await prisma.host.findUnique({
    where: { id: service.hostId },
    select: { user: { select: { role: true } } }
  })
  const isHostedInstance = host?.user.role === 'user'
  if (!isHostedInstance) {
    return { ok: true }
  }

  if (months !== 1) {
    return {
      ok: false,
      status: 400,
      code: 'HOSTING_MONTHLY_ONLY',
      message: 'Hosted user services can only be renewed monthly'
    }
  }

  if (service.expiresAt) {
    const daysUntilExpire = Math.ceil((service.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysUntilExpire > 7) {
      return {
        ok: false,
        status: 400,
        code: 'HOSTING_RENEW_TOO_EARLY',
        message: 'Hosted user services can only be renewed within 7 days before expiry',
        details: { daysUntilExpire }
      }
    }
  }

  return { ok: true }
}

function mapRechargeStatus(status: RechargeStatus): string {
  if (status === 'completed') return 'completed'
  if (status === 'refunded') return 'refunded'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'pending'
}

function mapBillingStatus(type: BillingRecordType): string {
  return type === 'refund' ? 'refunded' : 'completed'
}

function buildPublicOrderStatusFilter(status: string | undefined): {
  rechargeStatuses: RechargeStatus[] | null
  billingTypes: BillingRecordType[] | null
} {
  switch (status) {
    case 'pending':
      return { rechargeStatuses: ['pending', 'paid'], billingTypes: [] }
    case 'completed':
      return { rechargeStatuses: ['completed'], billingTypes: ['newPurchase', 'renew', 'upgrade', 'downgrade', 'transfer_fee'] }
    case 'failed':
      return { rechargeStatuses: ['failed'], billingTypes: [] }
    case 'cancelled':
      return { rechargeStatuses: ['cancelled'], billingTypes: [] }
    case 'refunded':
      return { rechargeStatuses: ['refunded'], billingTypes: ['refund'] }
    default:
      return { rechargeStatuses: null, billingTypes: null }
  }
}

function isPublicBillingRecordType(value: string): value is BillingRecordType {
  return PUBLIC_BILLING_RECORD_TYPES.has(value as BillingRecordType)
}

function normalizePublicBillingRecordType(value: unknown): BillingRecordType | undefined | null {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  const type = value.trim()
  return isPublicBillingRecordType(type) ? type : null
}

function parsePublicOrderId(value: unknown): { sourceType: 'recharge' | 'instance_billing'; sourceId: number } | null {
  if (typeof value !== 'string') return null
  const [sourceType, rawId, ...rest] = value.split(':')
  if (rest.length > 0 || (sourceType !== 'recharge' && sourceType !== 'instance_billing')) return null
  const sourceId = parsePositiveId(rawId)
  return sourceId ? { sourceType, sourceId } : null
}

function serializePublicBillingRecord(record: PublicBillingRecord) {
  return {
    id: record.id,
    orderId: `instance_billing:${record.id}`,
    serviceId: record.instanceId,
    type: record.type,
    status: mapBillingStatus(record.type),
    amount: toMoney(record.amount),
    months: record.months,
    periodStart: record.periodStart.toISOString(),
    periodEnd: record.periodEnd.toISOString(),
    remark: record.remark,
    service: record.instance ? {
      id: record.instance.id,
      name: record.instance.name,
      status: record.instance.status,
      plan: record.instance.packagePlan ? {
        id: record.instance.packagePlan.id,
        name: record.instance.packagePlan.name,
        package: record.instance.packagePlan.package
      } : null
    } : null,
    createdAt: record.createdAt.toISOString()
  }
}

function serializePublicService(instance: PublicServiceRecord) {
  return {
    id: instance.id,
    name: instance.name,
    status: instance.status,
    image: instance.image,
    resources: {
      cpu: instance.cpu,
      memory: instance.memory,
      disk: instance.disk
    },
    network: {
      mode: instance.networkMode,
      ipv4: instance.ipv4,
      ipv6: instance.ipv6
    },
    limits: {
      ports: instance.portLimit,
      snapshots: instance.snapshotLimit,
      backups: instance.backupLimit,
      sites: instance.siteLimit,
      monthlyTrafficLimit: serializeBigInt(instance.monthlyTrafficLimit),
      monthlyTrafficUsed: serializeBigInt(instance.monthlyTrafficUsed),
      trafficStatus: instance.trafficStatus
    },
    billing: {
      expiresAt: instance.expiresAt?.toISOString() ?? null,
      suspendedAt: instance.suspendedAt?.toISOString() ?? null,
      suspendReason: instance.suspendReason,
      billingPrice: instance.billingPrice === null ? null : toMoney(instance.billingPrice),
      billingCycle: instance.billingCycle,
      autoRenew: instance.autoRenew,
      plan: instance.packagePlan ? {
        id: instance.packagePlan.id,
        name: instance.packagePlan.name,
        billingCycle: instance.packagePlan.billingCycle,
        price: toMoney(instance.packagePlan.price),
        package: instance.packagePlan.package
      } : null
    },
    createdAt: instance.createdAt.toISOString(),
    updatedAt: instance.updatedAt.toISOString()
  }
}

function buildPublicServiceIncluded(services: PublicServiceRecord[], includes: PublicApiServiceInclude[]) {
  const included: {
    products?: Array<{ id: number; name: string }>
    plans?: Array<{ id: number; name: string; billingCycle: number | null; price: number; productId: number | null }>
  } = {}
  if (includes.includes('product')) {
    const products = new Map<number, { id: number; name: string }>()
    for (const service of services) {
      const product = service.packagePlan?.package
      if (product) products.set(product.id, { id: product.id, name: product.name })
    }
    included.products = Array.from(products.values())
  }
  if (includes.includes('plan')) {
    const plans = new Map<number, { id: number; name: string; billingCycle: number | null; price: number; productId: number | null }>()
    for (const service of services) {
      const plan = service.packagePlan
      if (plan) {
        plans.set(plan.id, {
          id: plan.id,
          name: plan.name,
          billingCycle: plan.billingCycle,
          price: toMoney(plan.price),
          productId: plan.package?.id ?? null
        })
      }
    }
    included.plans = Array.from(plans.values())
  }
  return included
}

async function serializePublicServiceOperationTask(task: {
  id: number
  instanceId: number
  taskType: string
  status: string
  progress: string | null
  error: string | null
  hostId: number
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}) {
  const queuePosition = task.status === 'PENDING' ? await getTaskQueuePosition(task.id, task.hostId) : 0
  return {
    id: task.id,
    serviceId: task.instanceId,
    taskType: task.taskType,
    status: task.status,
    progress: task.progress,
    error: task.error,
    queuePosition,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null,
    finishedAt: task.finishedAt?.toISOString() ?? null
  }
}

async function loadPublicServiceOperationTask(userId: number, serviceId: number, taskId: number) {
  return prisma.instanceTask.findFirst({
    where: {
      id: taskId,
      instanceId: serviceId,
      userId,
      taskType: { in: ['start', 'stop', 'restart'] }
    },
    select: {
      id: true,
      instanceId: true,
      taskType: true,
      status: true,
      progress: true,
      error: true,
      hostId: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      instance: {
        select: { name: true }
      }
    }
  })
}

async function loadEnabledPublicPluginManifest(pluginId: string): Promise<PayIncusPluginManifest | null> {
  const plugin = await prisma.plugin.findUnique({
    where: { pluginId },
    include: { versions: { orderBy: { installedAt: 'desc' }, take: 1 } }
  })
  if (!plugin || !plugin.enabled || plugin.status !== 'enabled') return null
  return plugin.versions[0]?.manifest as unknown as PayIncusPluginManifest | null
}

function isPublicPluginAction(action: PluginActionManifest): boolean {
  if (action.runtime !== 'webhook' || !action.url) return false
  return !(action.scopes || []).some(scope => scope.startsWith('service-extension:') || scope.startsWith('gateway-extension:'))
}

function pluginManifestHasActionPermission(manifest: PayIncusPluginManifest, action: PluginActionManifest): boolean {
  const permissions = new Set(manifest.permissions || [])
  return permissions.has('plugin-action:run') && (action.scopes || []).every(scope => permissions.has(scope))
}

function serializePublicPluginAction(action: PluginActionManifest) {
  return {
    name: action.name,
    method: action.method,
    path: action.path,
    runtime: action.runtime,
    scopes: action.scopes || [],
    idempotency: action.idempotency || 'none',
    rateLimit: action.rateLimit || 'normal',
    requestSchema: action.requestSchema || null,
    responseSchema: action.responseSchema || null
  }
}

async function resolvePublicPluginActionRateLimitPolicy(input: {
  pluginId: string
  actionName: string
  rateLimit?: 'normal' | 'strict'
}): Promise<{ rateLimit: 'normal' | 'strict'; max: number; windowMs: number }> {
  const rateLimit = input.rateLimit === 'strict' ? 'strict' : 'normal'
  const fallback = PUBLIC_PLUGIN_ACTION_DYNAMIC_RATE_LIMITS[rateLimit]
  const rows = await prisma.$queryRaw<PublicPluginActionRateLimitPolicyRow[]>`
    SELECT
      "max_requests" AS "maxRequests",
      "window_seconds" AS "windowSeconds"
    FROM "public_plugin_action_rate_limit_policies"
    WHERE "enabled" = true
      AND "rate_limit" = ${rateLimit}
      AND (
        ("plugin_id" = ${input.pluginId} AND "action_name" = ${input.actionName})
        OR ("plugin_id" = ${input.pluginId} AND "action_name" = ${PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE})
        OR ("plugin_id" = ${PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE} AND "action_name" = ${PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE})
      )
    ORDER BY
      CASE
        WHEN "plugin_id" = ${input.pluginId} AND "action_name" = ${input.actionName} THEN 1
        WHEN "plugin_id" = ${input.pluginId} AND "action_name" = ${PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE} THEN 2
        ELSE 3
      END ASC
    LIMIT 1
  `
  const policy = rows[0]
  if (!policy) return { rateLimit, ...fallback }

  return {
    rateLimit,
    max: Math.max(1, Math.min(10_000, policy.maxRequests)),
    windowMs: Math.max(10, Math.min(3600, policy.windowSeconds)) * 1000
  }
}

async function checkPublicPluginActionDynamicRateLimit(input: {
  tokenSource: string
  tokenId: number
  pluginId: string
  actionName: string
  rateLimit?: 'normal' | 'strict'
}): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number; limit: number }> {
  const policy = await resolvePublicPluginActionRateLimitPolicy(input)
  const now = new Date()
  const resetAt = new Date(now.getTime() + policy.windowMs)
  const rows = await prisma.$queryRaw<Array<{ requestCount: number; resetAt: Date }>>`
    INSERT INTO "public_plugin_action_rate_limit_buckets" (
      "token_source",
      "token_id",
      "plugin_id",
      "action_name",
      "policy",
      "request_count",
      "reset_at",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${input.tokenSource},
      ${input.tokenId},
      ${input.pluginId},
      ${input.actionName},
      ${policy.rateLimit},
      1,
      ${resetAt},
      ${now},
      ${now}
    )
    ON CONFLICT ("token_source", "token_id", "plugin_id", "action_name")
    DO UPDATE SET
      "policy" = ${policy.rateLimit},
      "request_count" = CASE
        WHEN "public_plugin_action_rate_limit_buckets"."reset_at" <= ${now} THEN 1
        ELSE "public_plugin_action_rate_limit_buckets"."request_count" + 1
      END,
      "reset_at" = CASE
        WHEN "public_plugin_action_rate_limit_buckets"."reset_at" <= ${now} THEN ${resetAt}
        ELSE "public_plugin_action_rate_limit_buckets"."reset_at"
      END,
      "updated_at" = ${now}
    RETURNING
      "request_count" AS "requestCount",
      "reset_at" AS "resetAt"
  `
  const bucket = rows[0]
  if (!bucket) {
    return { allowed: true }
  }

  if (bucket.requestCount > policy.max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000)),
      limit: policy.max
    }
  }

  return { allowed: true }
}

function getPublicPluginActions(manifest: PayIncusPluginManifest) {
  return (manifest.capabilities?.actions || [])
    .filter(action => isPublicPluginAction(action) && pluginManifestHasActionPermission(manifest, action))
    .map(serializePublicPluginAction)
}

export default async function publicApiRoutes(fastify: FastifyInstance) {
  fastify.get('/openapi.json', async () => {
    return buildPublicApiOpenApiDocument()
  })

  fastify.get('/openapi.yaml', async (_request, reply) => {
    return reply
      .type('application/yaml; charset=utf-8')
      .send(stringifyPublicApiOpenApiYaml())
  })

  fastify.get('/me', async (request: FastifyRequest, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'profile:read')
    if (!apiToken) return

    await createLog(
      apiToken.userId,
      LogModule.AUTH,
      'public_api.me_read',
      `Public API token "${apiToken.name}" read profile through /api/v1/me`,
      LogResult.SUCCESS
    )

    return {
      data: {
        id: apiToken.user.id,
        username: apiToken.user.username,
        email: apiToken.user.email,
        role: apiToken.user.role,
        avatarStyle: apiToken.user.avatarStyle,
        avatarBadgeId: apiToken.user.avatarBadgeId
      },
      meta: {
        tokenId: apiToken.id,
        scopes: apiToken.scopes
      }
    }
  })

  fastify.patch<{ Body: PublicApiUpdateProfileBody }>('/me', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'profile:write')
    if (!apiToken) return

    const avatarStyle = normalizePublicAvatarStyle(request.body?.avatarStyle)
    if (!avatarStyle) {
      return reply.code(400).send({
        error: 'avatarStyle must be one of the supported DiceBear style identifiers',
        code: 'INVALID_PUBLIC_PROFILE_UPDATE'
      })
    }

    const user = await prisma.user.update({
      where: { id: apiToken.userId },
      data: { avatarStyle },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        avatarStyle: true,
        avatarBadgeId: true
      }
    })

    await createLog(
      apiToken.userId,
      LogModule.AUTH,
      'public_api.me_update',
      `Public API ${apiToken.source} updated current user profile through /api/v1/me`,
      LogResult.SUCCESS
    )

    emitUserPluginEvent({
      event: 'user.profile.updated',
      userId: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      source: 'public_api.me.update',
      actor: { id: apiToken.userId, role: apiToken.user.role, username: apiToken.user.username },
      metadata: { fields: ['avatarStyle'] }
    })

    return {
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatarStyle: user.avatarStyle,
        avatarBadgeId: user.avatarBadgeId
      },
      meta: {
        tokenId: apiToken.id,
        scopes: apiToken.scopes
      }
    }
  })

  fastify.get('/balance', async (request: FastifyRequest, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'balance:read')
    if (!apiToken) return

    const user = await prisma.user.findUnique({
      where: { id: apiToken.userId },
      select: {
        id: true,
        balance: true,
        updatedAt: true
      }
    })

    if (!user) {
      return reply.code(404).send({ error: 'User not found', code: 'PUBLIC_API_USER_NOT_FOUND' })
    }

    await createLog(
      apiToken.userId,
      LogModule.PLUGIN,
      'public_api.balance_read',
      `Public API ${apiToken.source} read current user balance`,
      LogResult.SUCCESS
    )

    return {
      data: {
        userId: user.id,
        balance: toMoney(user.balance),
        currency: 'CNY',
        updatedAt: user.updatedAt.toISOString()
      }
    }
  })

  fastify.get<{ Querystring: PublicApiBalanceLogQuery }>('/balance/logs', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'balance:read')
    if (!apiToken) return

    const pagination = parsePagination(request.query || {})
    const sort = parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')
    if (!sort) return reply.code(400).send({ error: 'Invalid sort', code: 'INVALID_PUBLIC_API_SORT' })
    const type = normalizePublicBalanceLogType(request.query?.type)
    const lotteryGift = request.query?.lotteryGift
    const where: Prisma.BalanceLogWhereInput = {
      userId: apiToken.userId,
      ...(type ? { type } : {})
    }

    if (lotteryGift === 'exclude') {
      where.NOT = {
        type: 'gift',
        remark: { contains: '抽奖中奖' }
      }
    } else if (lotteryGift === 'only') {
      where.type = 'gift'
      where.remark = { contains: '抽奖中奖' }
    }

    const [total, logs] = await Promise.all([
      prisma.balanceLog.count({ where }),
      prisma.balanceLog.findMany({
        where,
        orderBy: buildPublicSortOrder(sort) as Prisma.BalanceLogOrderByWithRelationInput[],
        skip: pagination.skip,
        take: pagination.take
      })
    ])

    const instanceIds = Array.from(new Set(logs.map(log => log.instanceId).filter((id): id is number => typeof id === 'number')))
    const instances = instanceIds.length
      ? await prisma.instance.findMany({
          where: { id: { in: instanceIds }, userId: apiToken.userId },
          select: { id: true, name: true }
        })
      : []
    const instanceMap = new Map(instances.map(instance => [instance.id, instance]))

    await createLog(
      apiToken.userId,
      LogModule.PLUGIN,
      'public_api.balance_logs_list',
      `Public API ${apiToken.source} listed current user balance logs`,
      LogResult.SUCCESS
    )

    return {
      data: logs.map(log => {
        const instance = log.instanceId ? instanceMap.get(log.instanceId) ?? null : null
        return {
          id: log.id,
          type: log.type,
          amount: toMoney(log.amount),
          balanceBefore: toMoney(log.balanceBefore),
          balanceAfter: toMoney(log.balanceAfter),
          orderId: log.orderId,
          instance: instance ? { id: instance.id, name: instance.name } : null,
          remark: log.remark,
          createdAt: log.createdAt.toISOString()
        }
      }),
      meta: publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total, sort })
    }
  })

  fastify.get<{ Querystring: PublicApiBalanceAdjustmentListQuery }>('/balance/adjustment-requests', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'balance:write')
    if (!apiToken) return

    const pagination = parsePagination(request.query || {})
    const sort = parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')
    if (!sort) return reply.code(400).send({ error: 'Invalid sort', code: 'INVALID_PUBLIC_API_SORT' })
    const status = normalizePublicBalanceAdjustmentStatus(request.query?.status)
    if (status === null) {
      return reply.code(400).send({ error: 'Invalid balance adjustment request status', code: 'INVALID_BALANCE_ADJUSTMENT_STATUS' })
    }

    const where: Prisma.BalanceAdjustmentRequestWhereInput = {
      userId: apiToken.userId,
      requestedByUserId: apiToken.userId,
      sourceType: 'public_api',
      ...(status ? { status } : {})
    }
    const [total, requests] = await Promise.all([
      prisma.balanceAdjustmentRequest.count({ where }),
      prisma.balanceAdjustmentRequest.findMany({
        where,
        orderBy: buildPublicSortOrder(sort) as Prisma.BalanceAdjustmentRequestOrderByWithRelationInput[],
        skip: pagination.skip,
        take: pagination.take
      })
    ])

    await createLog(
      apiToken.userId,
      LogModule.PLUGIN,
      'public_api.balance_adjustment_requests_list',
      `Public API ${apiToken.source} listed own balance adjustment requests`,
      LogResult.SUCCESS
    )

    return {
      data: requests.map(serializePublicBalanceAdjustmentRequest),
      meta: publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total, sort })
    }
  })

  fastify.post<{ Body: PublicApiCreateBalanceAdjustmentBody }>('/balance/adjustment-requests', {
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.balanceAdjustmentWrite }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'balance:write')
    if (!apiToken) return

    const amount = normalizePublicBalanceAdjustmentAmount(request.body?.amount)
    const reason = normalizePublicBalanceAdjustmentReason(request.body?.reason)
    const requestType = normalizePublicBalanceAdjustmentType(request.body?.requestType)
    const orderNo = normalizePublicBalanceAdjustmentOrderNo(request.body?.orderNo)
    if (amount === null) {
      return reply.code(400).send({ error: 'Invalid balance adjustment amount', code: 'INVALID_BALANCE_ADJUSTMENT_AMOUNT' })
    }
    if (!reason) {
      return reply.code(400).send({ error: 'Invalid balance adjustment reason', code: 'INVALID_BALANCE_ADJUSTMENT_REASON' })
    }
    if (orderNo === null) {
      return reply.code(400).send({ error: 'Invalid balance adjustment order number', code: 'INVALID_BALANCE_ADJUSTMENT_ORDER_NO' })
    }

    const pendingCount = await prisma.balanceAdjustmentRequest.count({
      where: {
        userId: apiToken.userId,
        requestedByUserId: apiToken.userId,
        sourceType: 'public_api',
        status: 'pending'
      }
    })
    if (pendingCount >= 5) {
      return reply.code(429).send({ error: 'Too many pending balance adjustment requests', code: 'PUBLIC_BALANCE_ADJUSTMENT_PENDING_LIMIT' })
    }

    const adjustmentRequest = await createBalanceAdjustmentRequest({
      userId: apiToken.userId,
      requestedByUserId: apiToken.userId,
      amount,
      requestType,
      reason: `[Public API] ${reason}`,
      sourceType: 'public_api',
      sourceId: apiToken.id,
      orderNo
    })

    await createLog(
      apiToken.userId,
      LogModule.PLUGIN,
      'public_api.balance_adjustment_request_create',
      `Public API ${apiToken.source} created pending balance adjustment request #${adjustmentRequest.id}`,
      LogResult.SUCCESS
    )

    return reply.code(202).send({
      data: serializePublicBalanceAdjustmentRequest(adjustmentRequest)
    })
  })

  fastify.get<{ Querystring: PublicApiListQuery }>('/products', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'products:read')
    if (!apiToken) return
    const pagination = parsePagination(request.query || {})
    const sort = parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')
    if (!sort) return reply.code(400).send({ error: 'Invalid sort', code: 'INVALID_PUBLIC_API_SORT' })
    const where = {
      active: true,
      plans: { some: { isActive: true } }
    }
    const [total, packages] = await Promise.all([
      prisma.package.count({ where }),
      prisma.package.findMany({
        where,
        orderBy: buildPublicSortOrder(sort) as Prisma.PackageOrderByWithRelationInput[],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          plans: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
          }
        }
      })
    ])

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.products_list', `Public API ${apiToken.source} listed products`, LogResult.SUCCESS)

    return {
      data: packages.map(pkg => ({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        instanceType: pkg.instanceType,
        networkMode: pkg.networkMode,
        active: pkg.active,
        limits: {
          cpuMax: pkg.cpuMax,
          memoryMax: pkg.memoryMax,
          diskMax: pkg.diskMax,
          bandwidthMax: pkg.bandwidthMax,
          portLimit: pkg.portLimit,
          snapshotLimit: pkg.snapshotLimit,
          backupLimit: pkg.backupLimit,
          siteLimit: pkg.siteLimit,
          monthlyTrafficLimit: serializeBigInt(pkg.monthlyTrafficLimit)
        },
        plans: pkg.plans.map(plan => ({
          id: plan.id,
          name: plan.name,
          description: plan.description,
          cpu: plan.cpu,
          memory: plan.memory,
          disk: plan.disk,
          price: toMoney(plan.price),
          setupFee: toMoney(plan.setupFee),
          billingCycle: plan.billingCycle,
          isSoldOut: plan.isSoldOut,
          trafficLimit: serializeBigInt(plan.trafficLimit),
          trafficLimitSpeed: plan.trafficLimitSpeed,
          slaGuarantee: plan.slaGuarantee === null ? null : toMoney(plan.slaGuarantee)
        }))
      })),
      meta: publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total, sort })
    }
  })

  fastify.get<{ Params: PublicApiIdParams }>('/products/:id', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'products:read')
    if (!apiToken) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid product id', code: 'INVALID_PRODUCT_ID' })
    const pkg = await prisma.package.findFirst({
      where: { id, active: true },
      include: {
        plans: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
        }
      }
    })
    if (!pkg) return reply.code(404).send({ error: 'Product not found', code: 'PRODUCT_NOT_FOUND' })
    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.product_read', `Public API ${apiToken.source} read product #${id}`, LogResult.SUCCESS)
    return {
      data: {
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        instanceType: pkg.instanceType,
        networkMode: pkg.networkMode,
        active: pkg.active,
        limits: {
          cpuMax: pkg.cpuMax,
          memoryMax: pkg.memoryMax,
          diskMax: pkg.diskMax,
          bandwidthMax: pkg.bandwidthMax,
          portLimit: pkg.portLimit,
          snapshotLimit: pkg.snapshotLimit,
          backupLimit: pkg.backupLimit,
          siteLimit: pkg.siteLimit,
          monthlyTrafficLimit: serializeBigInt(pkg.monthlyTrafficLimit)
        },
        plans: pkg.plans.map(plan => ({
          id: plan.id,
          name: plan.name,
          description: plan.description,
          cpu: plan.cpu,
          memory: plan.memory,
          disk: plan.disk,
          price: toMoney(plan.price),
          setupFee: toMoney(plan.setupFee),
          billingCycle: plan.billingCycle,
          isSoldOut: plan.isSoldOut,
          trafficLimit: serializeBigInt(plan.trafficLimit),
          trafficLimitSpeed: plan.trafficLimitSpeed,
          slaGuarantee: plan.slaGuarantee === null ? null : toMoney(plan.slaGuarantee)
        }))
      }
    }
  })

  fastify.get<{ Querystring: PublicApiOrderListQuery }>('/orders', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'orders:read')
    if (!apiToken) return
    const pagination = parsePagination(request.query || {})
    const sort = parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')
    if (!sort) return reply.code(400).send({ error: 'Invalid sort', code: 'INVALID_PUBLIC_API_SORT' })
    const status = normalizeOptionalEnum(request.query?.status, PUBLIC_ORDER_STATUSES)
    if (status === null) return reply.code(400).send({ error: 'Invalid order status', code: 'INVALID_ORDER_STATUS' })
    const orderStatusFilter = buildPublicOrderStatusFilter(status)
    const rechargeWhere: Prisma.RechargeRecordWhereInput = {
      userId: apiToken.userId,
      ...(orderStatusFilter.rechargeStatuses ? { status: { in: orderStatusFilter.rechargeStatuses } } : {})
    }
    const billingWhere: Prisma.InstanceBillingRecordWhereInput = {
      userId: apiToken.userId,
      ...(orderStatusFilter.billingTypes ? { type: { in: orderStatusFilter.billingTypes } } : {})
    }
    const sourceTake = Math.min(pagination.skip + pagination.take, 200)
    const [rechargeTotal, billingTotal, recharges, billings] = await Promise.all([
      orderStatusFilter.rechargeStatuses?.length === 0 ? 0 : prisma.rechargeRecord.count({ where: rechargeWhere }),
      orderStatusFilter.billingTypes?.length === 0 ? 0 : prisma.instanceBillingRecord.count({ where: billingWhere }),
      orderStatusFilter.rechargeStatuses?.length === 0 ? [] : prisma.rechargeRecord.findMany({
        where: rechargeWhere,
        orderBy: buildPublicSortOrder(sort) as Prisma.RechargeRecordOrderByWithRelationInput[],
        take: sourceTake
      }),
      orderStatusFilter.billingTypes?.length === 0 ? [] : prisma.instanceBillingRecord.findMany({
        where: billingWhere,
        orderBy: buildPublicSortOrder(sort) as Prisma.InstanceBillingRecordOrderByWithRelationInput[],
        take: sourceTake,
        include: {
          instance: {
            select: {
              id: true,
              name: true,
              status: true,
              packagePlan: {
                select: {
                  id: true,
                  name: true,
                  package: { select: { id: true, name: true } }
                }
              }
            }
          }
        }
      })
    ])

    const sortMultiplier = sort.direction === 'desc' ? -1 : 1
    const orders = [
      ...recharges.map(record => ({
        id: `recharge:${record.id}`,
        sourceType: 'recharge',
        sourceId: record.id,
        orderNo: record.orderNo,
        title: '余额充值',
        status: mapRechargeStatus(record.status),
        rawStatus: record.status,
        amount: toMoney(record.amount),
        actualAmount: record.actualAmount === null ? null : toMoney(record.actualAmount),
        fee: toMoney(record.fee),
        paymentMethod: record.paymentMethod,
        tradeNo: maskTradeNo(record.tradeNo),
        failReason: record.failReason,
        createdAt: record.createdAt.toISOString(),
        completedAt: record.completedAt?.toISOString() ?? null,
        expiredAt: record.expiredAt?.toISOString() ?? null
      })),
      ...billings.map(record => ({
        id: `instance_billing:${record.id}`,
        sourceType: 'instance_billing',
        sourceId: record.id,
        orderNo: `IB-${record.id}`,
        title: record.remark || '实例计费',
        status: mapBillingStatus(record.type),
        rawStatus: record.type,
        amount: toMoney(record.amount),
        actualAmount: toMoney(record.amount),
        fee: 0,
        paymentMethod: 'balance',
        tradeNo: null,
        failReason: null,
        instance: record.instance ? {
          id: record.instance.id,
          name: record.instance.name,
          status: record.instance.status,
          plan: record.instance.packagePlan ? {
            id: record.instance.packagePlan.id,
            name: record.instance.packagePlan.name,
            package: record.instance.packagePlan.package
          } : null
        } : null,
        months: record.months,
        periodStart: record.periodStart.toISOString(),
        periodEnd: record.periodEnd.toISOString(),
        createdAt: record.createdAt.toISOString(),
        completedAt: record.createdAt.toISOString(),
        expiredAt: null
      }))
    ]
      .sort((a, b) => {
        const createdAtCompare = a.createdAt.localeCompare(b.createdAt) * sortMultiplier
        if (createdAtCompare !== 0) return createdAtCompare
        return a.id.localeCompare(b.id) * sortMultiplier
      })
      .slice(pagination.skip, pagination.skip + pagination.take)

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.orders_list', `Public API ${apiToken.source} listed own orders`, LogResult.SUCCESS)
    return {
      data: orders,
      meta: publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total: rechargeTotal + billingTotal, sort })
    }
  })

  fastify.get<{ Params: PublicApiOrderParams }>('/orders/:id', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'orders:read')
    if (!apiToken) return
    const orderId = parsePublicOrderId(request.params.id)
    if (!orderId) return reply.code(400).send({ error: 'Invalid order id', code: 'INVALID_ORDER_ID' })

    if (orderId.sourceType === 'recharge') {
      const record = await prisma.rechargeRecord.findFirst({
        where: { id: orderId.sourceId, userId: apiToken.userId }
      })
      if (!record) return reply.code(404).send({ error: 'Order not found', code: 'ORDER_NOT_FOUND' })

      await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.order_read', `Public API ${apiToken.source} read own recharge order #${record.id}`, LogResult.SUCCESS)

      return {
        data: {
          id: `recharge:${record.id}`,
          sourceType: 'recharge',
          sourceId: record.id,
          orderNo: record.orderNo,
          title: '余额充值',
          status: mapRechargeStatus(record.status),
          rawStatus: record.status,
          amount: toMoney(record.amount),
          actualAmount: record.actualAmount === null ? null : toMoney(record.actualAmount),
          fee: toMoney(record.fee),
          paymentMethod: record.paymentMethod,
          tradeNo: maskTradeNo(record.tradeNo),
          failReason: record.failReason,
          createdAt: record.createdAt.toISOString(),
          completedAt: record.completedAt?.toISOString() ?? null,
          expiredAt: record.expiredAt?.toISOString() ?? null
        }
      }
    }

    const record = await prisma.instanceBillingRecord.findFirst({
      where: { id: orderId.sourceId, userId: apiToken.userId },
      include: {
        instance: {
          select: {
            id: true,
            name: true,
            status: true,
            packagePlan: {
              select: {
                id: true,
                name: true,
                package: { select: { id: true, name: true } }
              }
            }
          }
        }
      }
    })
    if (!record) return reply.code(404).send({ error: 'Order not found', code: 'ORDER_NOT_FOUND' })

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.order_read', `Public API ${apiToken.source} read own billing order #${record.id}`, LogResult.SUCCESS)

    return {
      data: {
        id: `instance_billing:${record.id}`,
        sourceType: 'instance_billing',
        sourceId: record.id,
        orderNo: `IB-${record.id}`,
        title: record.remark || '实例计费',
        status: mapBillingStatus(record.type),
        rawStatus: record.type,
        amount: toMoney(record.amount),
        actualAmount: toMoney(record.amount),
        fee: 0,
        paymentMethod: 'balance',
        tradeNo: null,
        failReason: null,
        instance: record.instance ? {
          id: record.instance.id,
          name: record.instance.name,
          status: record.instance.status,
          plan: record.instance.packagePlan ? {
            id: record.instance.packagePlan.id,
            name: record.instance.packagePlan.name,
            package: record.instance.packagePlan.package
          } : null
        } : null,
        months: record.months,
        periodStart: record.periodStart.toISOString(),
        periodEnd: record.periodEnd.toISOString(),
        createdAt: record.createdAt.toISOString(),
        completedAt: record.createdAt.toISOString(),
        expiredAt: null
      }
    }
  })

  fastify.get<{ Querystring: PublicApiBillingRecordListQuery }>('/billing-records', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'billing:read')
    if (!apiToken) return

    const pagination = parsePagination(request.query || {})
    const sort = parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')
    if (!sort) return reply.code(400).send({ error: 'Invalid sort', code: 'INVALID_PUBLIC_API_SORT' })
    const type = normalizePublicBillingRecordType(request.query?.type)
    const serviceId = parseOptionalPositiveId(request.query?.serviceId)
    if (type === null) return reply.code(400).send({ error: 'Invalid billing record type', code: 'INVALID_BILLING_RECORD_TYPE' })
    if (serviceId === null) return reply.code(400).send({ error: 'Invalid service id', code: 'INVALID_SERVICE_ID' })

    const where: Prisma.InstanceBillingRecordWhereInput = {
      userId: apiToken.userId,
      ...(type ? { type } : {}),
      ...(serviceId ? { instanceId: serviceId } : {})
    }

    const [total, records] = await Promise.all([
      prisma.instanceBillingRecord.count({ where }),
      prisma.instanceBillingRecord.findMany({
        where,
        include: publicBillingRecordInclude,
        orderBy: buildPublicSortOrder(sort) as Prisma.InstanceBillingRecordOrderByWithRelationInput[],
        skip: pagination.skip,
        take: pagination.take
      })
    ])

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.billing_records_list', `Public API ${apiToken.source} listed own billing records`, LogResult.SUCCESS)

    return {
      data: records.map(serializePublicBillingRecord),
      meta: publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total, sort })
    }
  })

  fastify.get<{ Params: PublicApiIdParams }>('/billing-records/:id', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'billing:read')
    if (!apiToken) return

    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid billing record id', code: 'INVALID_BILLING_RECORD_ID' })

    const record = await prisma.instanceBillingRecord.findFirst({
      where: { id, userId: apiToken.userId },
      include: publicBillingRecordInclude
    })
    if (!record) return reply.code(404).send({ error: 'Billing record not found', code: 'BILLING_RECORD_NOT_FOUND' })

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.billing_record_read', `Public API ${apiToken.source} read own billing record #${id}`, LogResult.SUCCESS)

    return {
      data: serializePublicBillingRecord(record)
    }
  })

  fastify.get<{ Querystring: PublicApiServiceListQuery }>('/services', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'services:read')
    if (!apiToken) return
    const pagination = parsePagination(request.query || {})
    const sort = parsePublicApiSort(request.query?.sort, PUBLIC_SERVICE_SORT_FIELDS, 'displayOrder')
    if (!sort) return reply.code(400).send({ error: 'Invalid sort', code: 'INVALID_PUBLIC_API_SORT' })
    const status = normalizeOptionalEnum(request.query?.status, PUBLIC_SERVICE_STATUSES)
    if (status === null) return reply.code(400).send({ error: 'Invalid service status', code: 'INVALID_SERVICE_STATUS' })
    const includes = parsePublicApiInclude(request.query?.include, PUBLIC_SERVICE_INCLUDES) as PublicApiServiceInclude[] | null
    if (includes === null) return reply.code(400).send({ error: 'Invalid service include', code: 'INVALID_SERVICE_INCLUDE' })
    const where: Prisma.InstanceWhereInput = {
      userId: apiToken.userId,
      ...(status ? { status: status as InstanceStatus } : {})
    }
    const [total, services] = await Promise.all([
      prisma.instance.count({ where }),
      prisma.instance.findMany({
        where,
        select: publicServiceSelect,
        orderBy: buildPublicServiceSortOrder(sort) as Prisma.InstanceOrderByWithRelationInput[],
        skip: pagination.skip,
        take: pagination.take
      })
    ])

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.services_list', `Public API ${apiToken.source} listed own services`, LogResult.SUCCESS)
    const included = buildPublicServiceIncluded(services, includes)
    return {
      data: services.map(serializePublicService),
      meta: publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total, sort }),
      ...(Object.keys(included).length > 0 ? { included } : {})
    }
  })

  fastify.get<{ Params: PublicApiIdParams; Querystring: Pick<PublicApiServiceListQuery, 'include'> }>('/services/:id', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'services:read')
    if (!apiToken) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid service id', code: 'INVALID_SERVICE_ID' })
    const includes = parsePublicApiInclude(request.query?.include, PUBLIC_SERVICE_INCLUDES) as PublicApiServiceInclude[] | null
    if (includes === null) return reply.code(400).send({ error: 'Invalid service include', code: 'INVALID_SERVICE_INCLUDE' })
    const service = await prisma.instance.findFirst({
      where: { id, userId: apiToken.userId },
      select: publicServiceSelect
    })
    if (!service) return reply.code(404).send({ error: 'Service not found', code: 'SERVICE_NOT_FOUND' })
    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.service_read', `Public API ${apiToken.source} read own service #${id}`, LogResult.SUCCESS)
    const included = buildPublicServiceIncluded([service], includes)
    return {
      data: serializePublicService(service),
      ...(Object.keys(included).length > 0 ? { included } : {})
    }
  })

  fastify.post<{ Params: PublicApiIdParams; Body: PublicApiServiceActionBody }>('/services/:id/actions', {
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceOperate }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'services:operate')
    if (!apiToken) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid service id', code: 'INVALID_SERVICE_ID' })

    const action = normalizePublicServiceOperation(request.body?.action)
    if (!action) {
      return reply.code(400).send({
        error: 'action must be one of start, stop, or restart',
        code: 'INVALID_SERVICE_ACTION'
      })
    }

    const service = await prisma.instance.findFirst({
      where: { id, userId: apiToken.userId },
      select: {
        id: true,
        hostId: true,
        userId: true,
        name: true,
        status: true,
        suspendReason: true
      }
    })
    if (!service) return reply.code(404).send({ error: 'Service not found', code: 'SERVICE_NOT_FOUND' })

    const allowed = await assertPublicServiceOperationAllowed(service, action)
    if (!allowed.ok) {
      return reply.code(allowed.status).send({
        error: allowed.message,
        code: allowed.code,
        ...(allowed.details ? { details: allowed.details } : {})
      })
    }

    try {
      const task = await createInstanceTask({
        instanceId: service.id,
        hostId: service.hostId,
        userId: apiToken.userId,
        taskType: action
      })

      emitServiceTaskPluginEvent({
        event: 'service.task.queued',
        instanceId: service.id,
        userId: apiToken.userId,
        hostId: service.hostId,
        instanceName: service.name,
        taskId: task.id,
        taskType: task.taskType,
        taskStatus: task.status,
        source: 'public_api.services.actions',
        actor: { id: apiToken.userId, role: apiToken.user.role, username: apiToken.user.username },
        dedupeKey: `service.task.queued:public-api:${task.id}`,
        metadata: { action, tokenSource: apiToken.source }
      })

      await createLog(
        apiToken.userId,
        LogModule.PLUGIN,
        'public_api.service_action_queued',
        `Public API ${apiToken.source} queued ${action} task #${task.id} for own service "${service.name}"`,
        LogResult.SUCCESS,
        { instanceId: service.id }
      )

      return reply.code(202).send({
        data: {
          serviceId: service.id,
          action,
          taskId: task.id,
          taskType: task.taskType,
          status: task.status
        }
      })
    } catch (error) {
      if (error instanceof InstanceTaskConflictError) {
        return reply.code(409).send({
          error: 'Service has an active operation task',
          code: 'SERVICE_TASK_IN_PROGRESS',
          ...(error.activeTask ? {
            details: {
              taskId: error.activeTask.id,
              taskType: error.activeTask.taskType,
              status: error.activeTask.status
            }
          } : {})
        })
      }
      throw error
    }
  })

  fastify.post<{ Params: PublicApiIdParams; Body: PublicApiServiceRenewBody }>('/services/:id/renew', {
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceRenew }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'services:billing')
    if (!apiToken) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid service id', code: 'INVALID_SERVICE_ID' })

    const months = normalizePublicServiceRenewMonths(request.body?.months)
    if (!months) {
      return reply.code(400).send({
        error: 'months must be an integer between 1 and 24',
        code: 'INVALID_SERVICE_RENEW_MONTHS'
      })
    }

    const service = await prisma.instance.findFirst({
      where: { id, userId: apiToken.userId }
    })
    if (!service) return reply.code(404).send({ error: 'Service not found', code: 'SERVICE_NOT_FOUND' })

    const allowed = await assertPublicServiceRenewAllowed(service, months)
    if (!allowed.ok) {
      return reply.code(allowed.status).send({
        error: allowed.message,
        code: allowed.code,
        ...(allowed.details ? { details: allowed.details } : {})
      })
    }

    try {
      const result = await performRenewal(apiToken.userId, service, months)

      await sendNotification(apiToken.userId, 'instance_renewed', {
        instanceName: service.name,
        renewAmount: result.amount,
        renewMonths: months,
        newExpiresAt: result.newExpiresAt.toISOString()
      })

      if (result.hostingIncomeResult) {
        sendHostManagedInstanceNotification(
          service.hostId,
          'renew',
          {
            username: apiToken.user.username,
            instanceName: service.name,
            amount: result.amount
          }
        ).catch(error => {
          console.warn('[Public API renew] Failed to send hosted income notification:', error)
        })
      }

      try {
        const userInfo = await findUserById(apiToken.userId)
        if (userInfo?.email) {
          await sendRenewSuccessEmail(userInfo.email, {
            username: userInfo.username,
            instanceName: service.name,
            amount: result.amount,
            months,
            newExpiresAt: result.newExpiresAt
          })
        }
      } catch (emailError) {
        console.warn('[Public API renew] Failed to send renewal email:', emailError)
      }

      await createLog(
        apiToken.userId,
        LogModule.PLUGIN,
        'public_api.service_renew',
        `Public API ${apiToken.source} renewed own service "${service.name}" for ${months} month(s), amount: ${result.amount}`,
        LogResult.SUCCESS,
        { instanceId: service.id }
      )

      return {
        data: {
          serviceId: service.id,
          months,
          amount: result.amount,
          discountAmount: result.discountAmount ?? null,
          newExpiresAt: result.newExpiresAt.toISOString()
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Service renewal failed'
      await createLog(
        apiToken.userId,
        LogModule.PLUGIN,
        'public_api.service_renew_failed',
        `Public API ${apiToken.source} failed to renew own service "${service.name}": ${message}`,
        LogResult.FAILED,
        { instanceId: service.id }
      )
      return reply.code(400).send({ error: message, code: 'SERVICE_RENEW_FAILED' })
    }
  })

  fastify.get<{ Params: PublicApiServiceTaskParams }>('/services/:id/tasks/:taskId', {
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceTaskRead }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'services:operate')
    if (!apiToken) return
    const id = parsePositiveId(request.params.id)
    const taskId = parsePositiveId(request.params.taskId)
    if (!id || !taskId) return reply.code(400).send({ error: 'Invalid service task id', code: 'INVALID_SERVICE_TASK_ID' })

    const task = await loadPublicServiceOperationTask(apiToken.userId, id, taskId)
    if (!task) {
      return reply.code(404).send({ error: 'Service task not found', code: 'SERVICE_TASK_NOT_FOUND' })
    }

    await createLog(
      apiToken.userId,
      LogModule.PLUGIN,
      'public_api.service_task_read',
      `Public API ${apiToken.source} read task #${task.id} for own service #${id}`,
      LogResult.SUCCESS,
      { instanceId: id }
    )

    return {
      data: await serializePublicServiceOperationTask(task)
    }
  })

  fastify.delete<{ Params: PublicApiServiceTaskParams }>('/services/:id/tasks/:taskId', {
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.serviceTaskCancel }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'services:operate')
    if (!apiToken) return
    const id = parsePositiveId(request.params.id)
    const taskId = parsePositiveId(request.params.taskId)
    if (!id || !taskId) return reply.code(400).send({ error: 'Invalid service task id', code: 'INVALID_SERVICE_TASK_ID' })

    const task = await loadPublicServiceOperationTask(apiToken.userId, id, taskId)
    if (!task) {
      return reply.code(404).send({ error: 'Service task not found', code: 'SERVICE_TASK_NOT_FOUND' })
    }
    if (task.status !== 'PENDING') {
      return reply.code(409).send({
        error: 'Only pending service tasks can be cancelled',
        code: 'SERVICE_TASK_CANNOT_CANCEL',
        currentStatus: task.status
      })
    }

    const cancelledTask = await cancelInstanceTask(task.id)
    if (!cancelledTask) {
      return reply.code(409).send({
        error: 'Service task can no longer be cancelled',
        code: 'SERVICE_TASK_CANNOT_CANCEL'
      })
    }

    const publicTask = await loadPublicServiceOperationTask(apiToken.userId, id, cancelledTask.id)
    if (!publicTask) {
      return reply.code(404).send({ error: 'Service task not found', code: 'SERVICE_TASK_NOT_FOUND' })
    }

    emitServiceTaskPluginEvent({
      event: 'service.task.cancelled',
      instanceId: id,
      userId: apiToken.userId,
      hostId: publicTask.hostId,
      instanceName: publicTask.instance.name,
      taskId: publicTask.id,
      taskType: publicTask.taskType,
      taskStatus: publicTask.status,
      source: 'public_api.services.tasks.cancel',
      actor: { id: apiToken.userId, role: apiToken.user.role, username: apiToken.user.username },
      dedupeKey: `service.task.cancelled:public-api:${publicTask.id}`,
      metadata: { tokenSource: apiToken.source }
    })

    await createLog(
      apiToken.userId,
      LogModule.PLUGIN,
      'public_api.service_task_cancel',
      `Public API ${apiToken.source} cancelled task #${task.id} for own service #${id}`,
      LogResult.SUCCESS,
      { instanceId: id }
    )

    return {
      data: await serializePublicServiceOperationTask(publicTask)
    }
  })

  fastify.get<{ Querystring: PublicApiTicketListQuery }>('/tickets', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'tickets:read')
    if (!apiToken) return
    const pagination = parsePagination(request.query || {})
    const sort = parsePublicApiSort(request.query?.sort, PUBLIC_TICKET_SORT_FIELDS, '-updatedAt')
    if (!sort) return reply.code(400).send({ error: 'Invalid sort', code: 'INVALID_PUBLIC_API_SORT' })
    const status = normalizeOptionalEnum(request.query?.status, PUBLIC_TICKET_STATUSES)
    if (status === null) return reply.code(400).send({ error: 'Invalid ticket status', code: 'INVALID_TICKET_STATUS' })
    const category = normalizeOptionalEnum(request.query?.category, PUBLIC_TICKET_CATEGORIES)
    if (category === null) return reply.code(400).send({ error: 'Invalid ticket category', code: 'INVALID_TICKET_CATEGORY' })
    const priority = normalizeOptionalEnum(request.query?.priority, PUBLIC_TICKET_PRIORITIES)
    if (priority === null) return reply.code(400).send({ error: 'Invalid ticket priority', code: 'INVALID_TICKET_PRIORITY' })
    const where: Prisma.TicketWhereInput = {
      userId: apiToken.userId,
      ...(status ? { status: status as TicketStatus } : {}),
      ...(category ? { category } : {}),
      ...(priority ? { priority: priority as TicketPriority } : {})
    }
    const [total, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        orderBy: buildPublicSortOrder(sort) as Prisma.TicketOrderByWithRelationInput[],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, senderId: true, content: true, isFromOwner: true, createdAt: true }
          }
        }
      })
    ])

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.tickets_list', `Public API ${apiToken.source} listed own tickets`, LogResult.SUCCESS)
    return {
      data: tickets.map(ticket => ({
        id: ticket.id,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        hostId: ticket.hostId,
        instanceId: ticket.instanceId,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
        closedAt: ticket.closedAt?.toISOString() ?? null,
        latestMessage: ticket.messages[0] ? {
          id: ticket.messages[0].id,
          senderId: ticket.messages[0].senderId,
          content: ticket.messages[0].content,
          isFromOwner: ticket.messages[0].isFromOwner,
          createdAt: ticket.messages[0].createdAt.toISOString()
        } : null
      })),
      meta: publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total, sort })
    }
  })

  fastify.post<{ Body: PublicApiCreateTicketBody }>('/tickets', {
    bodyLimit: TICKET_UPLOAD_BODY_LIMIT,
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.ticketCreate }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'tickets:write')
    if (!apiToken) return

    let uploadedAttachments: CreateTicketMessageAttachmentData[] = []

    try {
      if (!await getSystemConfigBoolean('ticket_enabled', true)) {
        return reply.code(403).send({ error: 'Ticket creation is disabled', code: 'TICKET_CREATION_DISABLED' })
      }

      const payload = await readTicketPayload(request)
      const subject = normalizePublicTicketSubject(payload.fields.subject)
      const content = normalizePublicTicketMessageContent(payload.fields.content)
      if (!subject || content.length > MAX_PUBLIC_TICKET_REPLY_LENGTH || (payload.images.length === 0 && content.length < MIN_PUBLIC_TICKET_CREATE_CONTENT_LENGTH)) {
        return reply.code(400).send({
          error: `subject must be ${MIN_PUBLIC_TICKET_SUBJECT_LENGTH}-${MAX_PUBLIC_TICKET_SUBJECT_LENGTH} characters and content must be ${MIN_PUBLIC_TICKET_CREATE_CONTENT_LENGTH}-${MAX_PUBLIC_TICKET_REPLY_LENGTH} characters when no images are attached`,
          code: 'INVALID_TICKET_CREATE_PAYLOAD'
        })
      }

      const instanceId = parseOptionalPositiveId(payload.fields.instanceId)
      if (instanceId === null) {
        return reply.code(400).send({ error: 'Invalid instance id', code: 'INVALID_INSTANCE_ID' })
      }

      let hostId: number | null = null
      let host: { id: number; name: string; userId: number; user: { role: string } } | null = null
      let instance: { id: number; name: string; hostId: number } | null = null
      if (instanceId !== undefined) {
        instance = await prisma.instance.findFirst({
          where: { id: instanceId, userId: apiToken.userId },
          select: { id: true, name: true, hostId: true }
        })
        if (!instance) return reply.code(404).send({ error: 'Instance not found', code: 'INSTANCE_NOT_FOUND' })
        hostId = instance.hostId
        host = await prisma.host.findUnique({
          where: { id: hostId },
          select: {
            id: true,
            name: true,
            userId: true,
            user: { select: { role: true } }
          }
        })
        if (!host) return reply.code(404).send({ error: 'Host not found', code: 'HOST_NOT_FOUND' })
      }

      const category = normalizePublicTicketCategory(payload.fields.category)
      const priority = normalizePublicTicketPriority(payload.fields.priority)
      if (payload.images.length > 0) {
        uploadedAttachments = await uploadTicketImages(payload.images)
      }

      const result = await createTicket({
        userId: apiToken.userId,
        hostId,
        instanceId: instanceId ?? null,
        subject,
        category,
        priority,
        content,
        attachments: uploadedAttachments
      })

      const attachments = uploadedAttachments.length > 0
        ? await prisma.ticketMessageAttachment.findMany({
          where: { ticketId: result.ticketId, messageId: result.messageId },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            filename: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            thumbnailUrl: true,
            createdAt: true
          }
        })
        : []

      try {
        if (host && host.user.role !== 'admin') {
          await sendNotification(host.userId, 'ticket_created', {
            username: apiToken.user.username,
            subject,
            hostName: host.name,
            instanceName: instance?.name || '无'
          })
        } else {
          const adminIds = await getAllAdminUserIds()
          for (const adminId of adminIds) {
            await sendNotification(adminId, 'ticket_created', {
              username: apiToken.user.username,
              subject,
              hostName: host?.name || '系统',
              instanceName: instance?.name || '无'
            })
          }
        }
      } catch (error) {
        console.error('[PublicAPI] Failed to send ticket creation notification:', error)
      }

      emitPluginEvent('ticket.created', {
        dedupeKey: `ticket.created:${result.ticketId}:${result.messageId}`,
        ticketId: result.ticketId,
        messageId: result.messageId,
        userId: apiToken.userId,
        username: apiToken.user.username,
        subject,
        category,
        priority,
        instanceId: instanceId ?? null,
        hostId,
        attachmentCount: uploadedAttachments.length,
        source: 'public_api',
        createdAt: new Date().toISOString()
      }, { id: apiToken.userId, role: apiToken.user.role, username: apiToken.user.username }, { dedupeKey: `ticket.created:${result.ticketId}:${result.messageId}` })

      await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.ticket_create', `Public API ${apiToken.source} created ticket #${result.ticketId}`, LogResult.SUCCESS)

      return reply.code(201).send({
        data: {
          id: result.ticketId,
          messageId: result.messageId,
          subject,
          category,
          priority,
          status: 'open',
          hostId,
          instanceId: instanceId ?? null,
          attachments: attachments.map(serializePublicTicketAttachment)
        }
      })
    } catch (error) {
      if (uploadedAttachments.length > 0) {
        await cleanupUploadedTicketImages(uploadedAttachments)
      }
      if (!isHandledTicketPayloadError(error)) {
        throw error
      }
      return reply.code(400).send({ error: error.message, code: 'INVALID_TICKET_ATTACHMENT' })
    }
  })

  fastify.get<{ Params: PublicApiIdParams }>('/tickets/:id', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'tickets:read')
    if (!apiToken) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid ticket id', code: 'INVALID_TICKET_ID' })
    const ticket = await prisma.ticket.findFirst({
      where: { id, userId: apiToken.userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderId: true,
            content: true,
            isFromOwner: true,
            createdAt: true,
            attachments: {
              select: {
                id: true,
                filename: true,
                originalName: true,
                mimeType: true,
                sizeBytes: true,
                thumbnailUrl: true,
                createdAt: true
              }
            }
          }
        }
      }
    })
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found', code: 'TICKET_NOT_FOUND' })
    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.ticket_read', `Public API ${apiToken.source} read own ticket #${id}`, LogResult.SUCCESS)
    return {
      data: {
        id: ticket.id,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        hostId: ticket.hostId,
        instanceId: ticket.instanceId,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
        closedAt: ticket.closedAt?.toISOString() ?? null,
        messages: ticket.messages.map(message => ({
          id: message.id,
          senderId: message.senderId,
          content: message.content,
          isFromOwner: message.isFromOwner,
          createdAt: message.createdAt.toISOString(),
          attachments: message.attachments.map(serializePublicTicketAttachment)
        }))
      }
    }
  })

  fastify.patch<{ Params: PublicApiIdParams; Body: PublicApiTicketStatusBody }>('/tickets/:id/status', {
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.ticketStatus }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'tickets:write')
    if (!apiToken) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid ticket id', code: 'INVALID_TICKET_ID' })
    const action = normalizePublicTicketStatusAction(request.body?.action)
    if (!action) {
      return reply.code(400).send({
        error: 'action must be one of close or reopen',
        code: 'INVALID_TICKET_STATUS_ACTION'
      })
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id, userId: apiToken.userId },
      select: { id: true, userId: true, subject: true, status: true }
    })
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found', code: 'TICKET_NOT_FOUND' })
    if (action === 'close' && ticket.status === 'closed') {
      return reply.code(409).send({ error: 'Ticket is already closed', code: 'TICKET_ALREADY_CLOSED' })
    }
    if (action === 'reopen' && ticket.status !== 'closed') {
      return reply.code(409).send({ error: 'Only closed tickets can be reopened', code: 'TICKET_NOT_CLOSED' })
    }

    const now = new Date()
    const nextStatus: TicketStatus = action === 'close' ? 'closed' : 'open'
    const update = await prisma.ticket.updateMany({
      where: {
        id: ticket.id,
        userId: apiToken.userId,
        ...(action === 'close' ? { status: { not: 'closed' as TicketStatus } } : { status: 'closed' as TicketStatus })
      },
      data: {
        status: nextStatus,
        resolvedAt: action === 'close' ? now : null,
        closedAt: action === 'close' ? now : null,
        updatedAt: now
      }
    })
    if (update.count === 0) {
      return reply.code(409).send({ error: 'Ticket status changed concurrently', code: 'TICKET_STATUS_CONFLICT' })
    }

    emitPluginEvent('ticket.status.changed', {
      dedupeKey: `ticket.status.changed:public-api:${ticket.id}:${nextStatus}:${now.getTime()}`,
      ticketId: ticket.id,
      userId: apiToken.userId,
      username: apiToken.user.username,
      subject: ticket.subject,
      previousStatus: ticket.status,
      status: nextStatus,
      source: 'public_api',
      changedAt: now.toISOString()
    }, { id: apiToken.userId, role: apiToken.user.role, username: apiToken.user.username }, { dedupeKey: `ticket.status.changed:public-api:${ticket.id}:${nextStatus}:${now.getTime()}` })

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.ticket_status_update', `Public API ${apiToken.source} changed own ticket #${ticket.id} status to ${nextStatus}`, LogResult.SUCCESS)

    return {
      data: {
        id: ticket.id,
        status: nextStatus,
        previousStatus: ticket.status,
        resolvedAt: action === 'close' ? now.toISOString() : null,
        closedAt: action === 'close' ? now.toISOString() : null,
        updatedAt: now.toISOString()
      }
    }
  })

  fastify.post<{ Params: PublicApiIdParams; Body: PublicApiTicketReplyBody }>('/tickets/:id/replies', {
    bodyLimit: TICKET_UPLOAD_BODY_LIMIT,
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.ticketReply }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'tickets:write')
    if (!apiToken) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid ticket id', code: 'INVALID_TICKET_ID' })

    let uploadedAttachments: CreateTicketMessageAttachmentData[] = []

    try {
      const payload = await readTicketPayload(request)
      const content = normalizePublicTicketMessageContent(payload.fields.content)
      if (content.length > MAX_PUBLIC_TICKET_REPLY_LENGTH || (payload.images.length === 0 && content.length < 1)) {
        return reply.code(400).send({
          error: `content must be non-empty when no images are attached and no longer than ${MAX_PUBLIC_TICKET_REPLY_LENGTH} characters`,
          code: 'INVALID_TICKET_REPLY_CONTENT'
        })
      }

      const ticket = await prisma.ticket.findFirst({
        where: { id, userId: apiToken.userId },
        include: {
          user: { select: { id: true, username: true } },
          host: {
            select: {
              id: true,
              name: true,
              userId: true,
              user: { select: { role: true } }
            }
          }
        }
      })
      if (!ticket) return reply.code(404).send({ error: 'Ticket not found', code: 'TICKET_NOT_FOUND' })
      if (ticket.status === 'closed') return reply.code(409).send({ error: 'Cannot reply to a closed ticket', code: 'TICKET_CLOSED' })

      if (payload.images.length > 0) {
        uploadedAttachments = await uploadTicketImages(payload.images)
      }

      const message = await addTicketMessage(ticket.id, apiToken.userId, content, false, uploadedAttachments)
      const attachments = uploadedAttachments.length > 0
        ? await prisma.ticketMessageAttachment.findMany({
          where: { ticketId: ticket.id, messageId: message.id },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            filename: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            thumbnailUrl: true,
            createdAt: true
          }
        })
        : []

      try {
        const hostedTicketHost = ticket.host?.user.role === 'user' ? ticket.host : null
        if (hostedTicketHost?.userId) {
          await sendNotification(hostedTicketHost.userId, 'ticket_replied', {
            subject: ticket.subject,
            hostName: ticket.host?.name || '系统',
            replyFrom: apiToken.user.username
          })
        } else {
          const adminIds = await getAllAdminUserIds()
          for (const adminId of adminIds) {
            await sendNotification(adminId, 'ticket_replied', {
              subject: ticket.subject,
              hostName: ticket.host?.name || '系统',
              replyFrom: apiToken.user.username
            })
          }
        }
      } catch (error) {
        console.error('[PublicAPI] Failed to send ticket reply notification:', error)
      }

      emitPluginEvent('ticket.replied', {
        dedupeKey: `ticket.replied:${ticket.id}:${message.id}`,
        ticketId: ticket.id,
        messageId: message.id,
        userId: apiToken.userId,
        username: apiToken.user.username,
        subject: ticket.subject,
        isFromOwner: false,
        status: 'in_progress',
        attachmentCount: uploadedAttachments.length,
        source: 'public_api',
        createdAt: message.createdAt
      }, { id: apiToken.userId, role: apiToken.user.role, username: apiToken.user.username }, { dedupeKey: `ticket.replied:${ticket.id}:${message.id}` })

      await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.ticket_reply_create', `Public API ${apiToken.source} replied to own ticket #${ticket.id}`, LogResult.SUCCESS)

      return reply.code(201).send({
        data: {
          id: message.id,
          ticketId: message.ticketId,
          senderId: message.senderId,
          content: message.content,
          isFromOwner: message.isFromOwner,
          createdAt: message.createdAt,
          attachments: attachments.map(serializePublicTicketAttachment)
        }
      })
    } catch (error) {
      if (uploadedAttachments.length > 0) {
        await cleanupUploadedTicketImages(uploadedAttachments)
      }
      if (!isHandledTicketPayloadError(error)) {
        throw error
      }
      return reply.code(400).send({ error: error.message, code: 'INVALID_TICKET_ATTACHMENT' })
    }
  })

  fastify.get<{ Querystring: PublicApiNotificationListQuery }>('/notifications', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'notifications:read')
    if (!apiToken) return
    const pagination = parsePagination(request.query || {})
    const sort = parsePublicApiSort(request.query?.sort, PUBLIC_CREATED_AT_SORT_FIELDS, '-createdAt')
    if (!sort) return reply.code(400).send({ error: 'Invalid sort', code: 'INVALID_PUBLIC_API_SORT' })
    const isRead = parseOptionalBooleanString(request.query?.isRead)
    const where: Prisma.InboxMessageWhereInput = {
      userId: apiToken.userId,
      ...(isRead !== undefined ? { isRead } : {})
    }

    const [total, messages] = await Promise.all([
      prisma.inboxMessage.count({ where }),
      prisma.inboxMessage.findMany({
        where,
        orderBy: buildPublicSortOrder(sort) as Prisma.InboxMessageOrderByWithRelationInput[],
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          eventType: true,
          title: true,
          content: true,
          isRead: true,
          createdAt: true
        }
      })
    ])

    await createLog(apiToken.userId, LogModule.NOTIFICATION, 'public_api.notifications_list', `Public API ${apiToken.source} listed current user notifications`, LogResult.SUCCESS)

    return {
      data: messages.map(message => ({
        id: message.id,
        eventType: message.eventType,
        title: message.title,
        content: message.content,
        isRead: message.isRead,
        createdAt: message.createdAt.toISOString()
      })),
      meta: publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total, sort })
    }
  })

  fastify.get('/notifications/unread-count', async (request: FastifyRequest, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'notifications:read')
    if (!apiToken) return

    const count = await prisma.inboxMessage.count({
      where: {
        userId: apiToken.userId,
        isRead: false
      }
    })

    await createLog(apiToken.userId, LogModule.NOTIFICATION, 'public_api.notifications_unread_count', `Public API ${apiToken.source} read current user unread notification count`, LogResult.SUCCESS)

    return { data: { count } }
  })

  fastify.post<{ Body: PublicApiNotificationBody }>('/notifications', {
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.notificationSend }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'notifications:send')
    if (!apiToken) return
    const variables = normalizePublicNotificationVariables(request.body?.variables)
    if (!variables) {
      return reply.code(400).send({
        error: `variables must be an object with up to ${MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLES} scalar values; keys must be alphanumeric identifiers and values max ${MAX_PUBLIC_NOTIFICATION_TEMPLATE_VARIABLE_LENGTH} characters`,
        code: 'INVALID_NOTIFICATION_VARIABLES'
      })
    }
    const template = request.body?.template ? await resolvePublicNotificationTemplate(request.body.template, variables) : null
    if (request.body?.template && !template) {
      return reply.code(400).send({
        error: `template must be one of ${PUBLIC_NOTIFICATION_TEMPLATE_IDS.join(', ')} or plugin:<pluginId>:<templateId>, and all required variables must be provided`,
        code: 'INVALID_NOTIFICATION_TEMPLATE'
      })
    }
    const title = template?.rendered.title ?? normalizePublicNotificationText(request.body?.title, MAX_PUBLIC_NOTIFICATION_TITLE_LENGTH)
    const message = template?.rendered.message ?? normalizePublicNotificationText(request.body?.message, MAX_PUBLIC_NOTIFICATION_MESSAGE_LENGTH)
    const source = normalizePublicNotificationText(request.body?.source, MAX_PUBLIC_NOTIFICATION_SOURCE_LENGTH) || apiToken.name
    if (!title || !message) {
      return reply.code(400).send({
        error: `title and message must be non-empty strings unless a template is used; title max ${MAX_PUBLIC_NOTIFICATION_TITLE_LENGTH}, message max ${MAX_PUBLIC_NOTIFICATION_MESSAGE_LENGTH}`,
        code: 'INVALID_NOTIFICATION_PAYLOAD'
      })
    }

    const result = await sendNotification(apiToken.userId, 'public_api_notification', {
      publicApiTitle: title,
      publicApiMessage: message,
      publicApiSource: source,
      publicApiTemplate: template?.templateId || 'custom'
    })

    await createLog(apiToken.userId, LogModule.NOTIFICATION, 'public_api.notification_send', `Public API ${apiToken.source} sent self notification through token "${apiToken.name}"`, LogResult.SUCCESS)

    return reply.code(202).send({
      data: {
        userId: apiToken.userId,
        title,
        template: template?.templateId || null,
        source,
        sent: result.sent,
        failed: result.failed
      }
    })
  })

  fastify.get<{ Querystring: PublicApiListQuery }>('/plugins', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'plugins:action')
    if (!apiToken) return
    const pagination = parsePagination(request.query || {})
    const sort = parsePublicApiSort(request.query?.sort, PUBLIC_PLUGIN_SORT_FIELDS, 'pluginId')
    if (!sort) return reply.code(400).send({ error: 'Invalid sort', code: 'INVALID_PUBLIC_API_SORT' })
    const plugins = await prisma.plugin.findMany({
      where: { enabled: true, status: 'enabled' },
      orderBy: buildPublicSortOrder(sort) as Prisma.PluginOrderByWithRelationInput[],
      include: { versions: { orderBy: { installedAt: 'desc' }, take: 1 } }
    })

    const publicPlugins = plugins
      .map(plugin => {
        const manifest = plugin.versions[0]?.manifest as unknown as PayIncusPluginManifest | null
        if (!manifest) return null
        const actions = getPublicPluginActions(manifest)
        if (actions.length === 0) return null
        return {
          pluginId: plugin.pluginId,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description || null,
          author: manifest.author || null,
          homepage: manifest.homepage || null,
          actionCount: actions.length,
          actions
        }
      })
      .filter((plugin): plugin is NonNullable<typeof plugin> => plugin !== null)

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.plugins_list', `Public API ${apiToken.source} listed enabled public plugin actions`, LogResult.SUCCESS)

    return {
      data: publicPlugins.slice(pagination.skip, pagination.skip + pagination.take),
      meta: publicSortMeta({ page: pagination.page, pageSize: pagination.pageSize, total: publicPlugins.length, sort })
    }
  })

  fastify.get<{ Params: PublicApiPluginParams }>('/plugins/:pluginId/actions', async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'plugins:action')
    if (!apiToken) return
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) {
      return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    }

    const manifest = await loadEnabledPublicPluginManifest(pluginId)
    if (!manifest) {
      return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    }
    const actions = getPublicPluginActions(manifest)

    await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.plugin_actions_list', `Public API ${apiToken.source} listed public actions for ${pluginId}`, LogResult.SUCCESS)

    return {
      data: {
        pluginId,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || null,
        actions
      }
    }
  })

  fastify.post<{ Params: PublicApiPluginActionParams; Body: PublicApiPluginActionBody }>('/plugins/:pluginId/actions/:action', {
    config: { rateLimit: PUBLIC_API_RATE_LIMITS.pluginActionDispatch }
  }, async (request, reply) => {
    const apiToken = await authenticatePublicApiRequest(request, reply, 'plugins:action')
    if (!apiToken) return
    const pluginId = normalizePluginId(request.params.pluginId)
    const actionName = normalizePluginActionName(request.params.action)
    if (!pluginId || !actionName) {
      return reply.code(400).send({ error: 'Invalid plugin action', code: 'INVALID_PLUGIN_ACTION' })
    }

    const manifest = await loadEnabledPublicPluginManifest(pluginId)
    if (!manifest) {
      return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    }
    const action = (manifest.capabilities?.actions || []).find(item => item.name === actionName)
    if (!action || !isPublicPluginAction(action) || !pluginManifestHasActionPermission(manifest, action)) {
      return reply.code(404).send({ error: 'Plugin action not found', code: 'PLUGIN_ACTION_NOT_FOUND' })
    }
    const actionRateLimit = await checkPublicPluginActionDynamicRateLimit({
      tokenSource: apiToken.source,
      tokenId: apiToken.id,
      pluginId,
      actionName,
      rateLimit: action.rateLimit
    })
    if (!actionRateLimit.allowed) {
      reply.header('Retry-After', String(actionRateLimit.retryAfterSeconds))
      return reply.code(429).send({
        error: 'Plugin action rate limit exceeded',
        code: 'PUBLIC_PLUGIN_ACTION_RATE_LIMITED',
        retryAfter: actionRateLimit.retryAfterSeconds,
        limit: actionRateLimit.limit
      })
    }

    try {
      const body = request.body || {}
      const result = await executePluginAction({
        pluginId,
        manifest,
        actionName,
        actor: {
          id: apiToken.userId,
          role: apiToken.user.role,
          username: apiToken.user.username
        },
        payload: body.payload ?? body,
        source: 'user',
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
      })
      await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.plugin_action_dispatch', `Public API ${apiToken.source} dispatched plugin action ${pluginId}:${actionName}`, LogResult.SUCCESS)
      return {
        data: {
          pluginId,
          action: actionName,
          runtime: result.runtime,
          status: result.status,
          statusCode: result.statusCode,
          requestId: result.requestId,
          result: result.result
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await createLog(apiToken.userId, LogModule.PLUGIN, 'public_api.plugin_action_dispatch', `Public API ${apiToken.source} failed plugin action ${pluginId}:${actionName}: ${message}`, LogResult.FAILED)
      return reply.code(400).send({ error: message, code: 'PUBLIC_PLUGIN_ACTION_FAILED' })
    }
  })
}
