import type { FastifyInstance } from 'fastify'
import { Prisma, type BillingRecordType, type OrderOperationStatus, type RechargeStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createBalanceAdjustmentRequest } from '../db/balance.js'
import { createLog } from '../db/logs.js'

const POSITIVE_ID_PATTERN = /^[1-9]\d*$/
const ORDER_TYPES = new Set(['recharge', 'instance_billing'])
const RECHARGE_STATUSES = new Set(['pending', 'paid', 'completed', 'failed', 'cancelled', 'refunded'])
const BILLING_TYPES = new Set(['newPurchase', 'renew', 'upgrade', 'downgrade', 'refund', 'transfer_fee'])
const ORDER_OPERATION_STATUSES = new Set<OrderOperationStatus>(['pending_review', 'confirmed', 'compensated', 'closed'])
const MAX_PAGE_SIZE = 100
const SEARCH_MAX_LENGTH = 128
const OPERATION_TEXT_MAX_LENGTH = 500
const MAX_REFUND_AMOUNT = 99999999.99

type OrderType = 'recharge' | 'instance_billing'

interface OrderQuery {
  page?: string
  pageSize?: string
  type?: string
  status?: string
  userId?: string
  keyword?: string
  createdFrom?: string
  createdTo?: string
}

interface OrderOperationInput {
  status?: string
  reason?: string
  result?: string
  refundAmount?: number
  createRefundRequest?: boolean
}

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }

  if (typeof value !== 'string' || !POSITIVE_ID_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveQuery(value: string | undefined, fallback: number): number {
  const parsed = parsePositiveId(value)
  return parsed ?? fallback
}

function parsePageSize(value: string | undefined): number {
  return Math.min(parsePositiveQuery(value, 20), MAX_PAGE_SIZE)
}

function normalizeOrderType(value: string | undefined): OrderType | undefined {
  return value && ORDER_TYPES.has(value) ? value as OrderType : undefined
}

function normalizeRechargeStatus(value: string | undefined): RechargeStatus | undefined {
  return value && RECHARGE_STATUSES.has(value) ? value as RechargeStatus : undefined
}

function normalizeBillingType(value: string | undefined): BillingRecordType | undefined {
  return value && BILLING_TYPES.has(value) ? value as BillingRecordType : undefined
}

function normalizeOrderOperationStatus(value: unknown): OrderOperationStatus {
  return typeof value === 'string' && ORDER_OPERATION_STATUSES.has(value as OrderOperationStatus)
    ? value as OrderOperationStatus
    : 'pending_review'
}

function normalizeSearch(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const keyword = value.trim()
  return keyword ? keyword.slice(0, SEARCH_MAX_LENGTH) : undefined
}

function parseDateQuery(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeOperationText(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw { error: `必须填写${field}` }
    return undefined
  }
  if (typeof value !== 'string') {
    throw { error: `${field}必须是字符串` }
  }
  const text = value.trim()
  if (!text) {
    if (required) throw { error: `必须填写${field}` }
    return undefined
  }
  if (text.length > OPERATION_TEXT_MAX_LENGTH) {
    throw { error: `${field}不能超过 ${OPERATION_TEXT_MAX_LENGTH} 字符` }
  }
  return text
}

function normalizeRefundAmount(value: unknown, required: boolean): number | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw { error: '必须填写退款金额' }
    return undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw { error: '退款金额必须是有效数字' }
  }
  if (value <= 0 || value > MAX_REFUND_AMOUNT || !/^\d+(\.\d{1,2})?$/.test(String(value))) {
    throw { error: '退款金额必须大于 0，最多两位小数' }
  }
  return Number(value.toFixed(2))
}

function normalizeOrderOperationInput(input: unknown): {
  status: OrderOperationStatus
  reason: string
  createRefundRequest: boolean
  result?: string
  refundAmount?: number
} {
  if (!isPlainRecord(input)) {
    throw { error: '请求参数无效' }
  }
  const createRefundRequest = input.createRefundRequest === true
  return {
    status: normalizeOrderOperationStatus(input.status),
    reason: normalizeOperationText(input.reason, '处理原因', true)!,
    result: normalizeOperationText(input.result, '处理结果', false),
    refundAmount: normalizeRefundAmount(input.refundAmount, createRefundRequest),
    createRefundRequest
  }
}

function toMoney(value: unknown): number {
  if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber()
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function maskTradeNo(value: string | null): string | null {
  if (!value) return null
  if (value.length <= 8) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

function buildProviderStatusSummary(record: {
  status: RechargeStatus
  callbackAt?: Date | null
  provider?: { id: number; name: string; type: string } | null
  paymentMethod?: string | null
  tradeNo?: string | null
}) {
  return {
    provider: record.provider ? {
      id: record.provider.id,
      name: record.provider.name,
      type: record.provider.type
    } : null,
    rawStatus: record.status,
    paymentMethod: record.paymentMethod ?? null,
    tradeNo: maskTradeNo(record.tradeNo ?? null),
    callbackAt: record.callbackAt?.toISOString() ?? null
  }
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

function buildRechargeOrder(record: {
  id: number
  userId: number
  orderNo: string
  amount: unknown
  actualAmount: unknown
  fee: unknown
  status: RechargeStatus
  paymentMethod: string | null
  tradeNo: string | null
  failReason: string | null
  callbackAt?: Date | null
  createdAt: Date
  completedAt: Date | null
  expiredAt: Date | null
  provider?: { id: number; name: string; type: string } | null
  user?: { id: number; username: string; email: string | null } | null
}) {
  return {
    id: `recharge:${record.id}`,
    sourceType: 'recharge' as const,
    sourceId: record.id,
    orderNo: record.orderNo,
    title: '余额充值',
    status: mapRechargeStatus(record.status),
    rawStatus: record.status,
    amount: toMoney(record.amount),
    actualAmount: record.actualAmount === null ? null : toMoney(record.actualAmount),
    fee: toMoney(record.fee),
    userId: record.userId,
    user: record.user ?? null,
    provider: record.provider ?? null,
    providerStatusSummary: buildProviderStatusSummary(record),
    paymentMethod: record.paymentMethod,
    tradeNo: record.tradeNo,
    failReason: record.failReason,
    instance: null,
    months: null,
    periodStart: null,
    periodEnd: null,
    remark: null,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    expiredAt: record.expiredAt?.toISOString() ?? null
  }
}

function buildBillingOrder(record: {
  id: number
  userId: number
  type: BillingRecordType
  amount: unknown
  months: number
  periodStart: Date
  periodEnd: Date
  remark: string | null
  createdAt: Date
  instance?: {
    id: number
    name: string
    packagePlan?: {
      id: number
      name: string
      package?: { id: number; name: string } | null
    } | null
  } | null
  user?: { id: number; username: string; email: string | null } | null
}) {
  const titleByType: Record<BillingRecordType, string> = {
    newPurchase: '实例新购',
    renew: '实例续费',
    upgrade: '实例升级',
    downgrade: '实例降级',
    refund: '实例退款',
    transfer_fee: '转移手续费'
  }

  return {
    id: `instance_billing:${record.id}`,
    sourceType: 'instance_billing' as const,
    sourceId: record.id,
    orderNo: `BILL-${record.id}`,
    title: titleByType[record.type] ?? '实例账单',
    status: mapBillingStatus(record.type),
    rawStatus: record.type,
    amount: toMoney(record.amount),
    actualAmount: toMoney(record.amount),
    fee: 0,
    userId: record.userId,
    user: record.user ?? null,
    provider: null,
    providerStatusSummary: null,
    paymentMethod: 'balance',
    tradeNo: null,
    failReason: null,
    instance: record.instance ?? null,
    months: record.months,
    periodStart: record.periodStart.toISOString(),
    periodEnd: record.periodEnd.toISOString(),
    remark: record.remark,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.createdAt.toISOString(),
    expiredAt: null
  }
}

function serializeBalanceAdjustmentRequest(request: any) {
  if (!request) return null
  return {
    id: request.id,
    userId: request.userId,
    user: request.user ?? null,
    requestedBy: request.requestedBy ?? null,
    reviewedBy: request.reviewedBy ?? null,
    amount: Number(request.amount),
    requestType: request.requestType,
    status: request.status,
    sourceType: request.sourceType,
    sourceId: request.sourceId,
    orderNo: request.orderNo,
    reason: request.reason,
    reviewRemark: request.reviewRemark,
    balanceLogId: request.balanceLogId,
    balanceLog: request.balanceLog ? {
      id: request.balanceLog.id,
      type: request.balanceLog.type,
      amount: Number(request.balanceLog.amount),
      balanceBefore: Number(request.balanceLog.balanceBefore),
      balanceAfter: Number(request.balanceLog.balanceAfter)
    } : null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null
  }
}

function includeOrderOperationCaseRelations() {
  return {
    createdBy: { select: { id: true, username: true } },
    updatedBy: { select: { id: true, username: true } },
    balanceAdjustmentRequest: {
      include: {
        user: { select: { id: true, username: true, email: true } },
        requestedBy: { select: { id: true, username: true } },
        reviewedBy: { select: { id: true, username: true } },
        balanceLog: true
      }
    }
  } satisfies Prisma.OrderOperationCaseInclude
}

function serializeOrderOperationCase(record: any) {
  if (!record) return null
  return {
    id: record.id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    orderNo: record.orderNo,
    userId: record.userId,
    status: record.status,
    reason: record.reason,
    result: record.result,
    refundAmount: record.refundAmount === null ? null : Number(record.refundAmount),
    providerSummary: record.providerSummary ?? null,
    createdBy: record.createdBy ?? null,
    updatedBy: record.updatedBy ?? null,
    balanceAdjustmentRequestId: record.balanceAdjustmentRequestId,
    balanceAdjustmentRequest: serializeBalanceAdjustmentRequest(record.balanceAdjustmentRequest),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  }
}

async function getOrderOperationCase(sourceType: OrderType, sourceId: number) {
  return prisma.orderOperationCase.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    include: includeOrderOperationCaseRelations()
  })
}

function buildCreatedAtWhere(createdFrom?: Date, createdTo?: Date): Prisma.DateTimeFilter | undefined {
  if (!createdFrom && !createdTo) return undefined
  return {
    ...(createdFrom ? { gte: createdFrom } : {}),
    ...(createdTo ? { lte: createdTo } : {})
  }
}

function parseBillingOrderKeyword(keyword: string | undefined): number | undefined {
  if (!keyword) return undefined
  const billMatch = keyword.match(/^BILL-(\d+)$/i)
  const raw = billMatch?.[1] ?? (/^\d+$/.test(keyword) ? keyword : undefined)
  if (!raw) return undefined
  return parsePositiveId(raw) ?? undefined
}

async function listOrders(options: {
  userId?: number
  page: number
  pageSize: number
  type?: OrderType
  status?: RechargeStatus
  billingType?: BillingRecordType
  includeUser: boolean
  keyword?: string
  createdFrom?: Date
  createdTo?: Date
}) {
  const take = options.page * options.pageSize
  const includeRecharge = !options.type || options.type === 'recharge'
  const includeBilling = !options.type || options.type === 'instance_billing'
  const createdAt = buildCreatedAtWhere(options.createdFrom, options.createdTo)
  const billingOrderId = parseBillingOrderKeyword(options.keyword)
  const keywordUserIds = options.keyword && options.includeUser
    ? await prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: options.keyword, mode: 'insensitive' } },
            { email: { contains: options.keyword, mode: 'insensitive' } }
          ]
        },
        select: { id: true },
        take: 100
      })
    : []
  const keywordUserIdValues = keywordUserIds.map(user => user.id)
  const rechargeWhere: Prisma.RechargeRecordWhereInput = {
    userId: options.userId,
    status: options.status,
    createdAt,
    ...(options.keyword ? {
      OR: [
        { orderNo: { contains: options.keyword, mode: 'insensitive' } },
        { tradeNo: { contains: options.keyword, mode: 'insensitive' } },
        ...(keywordUserIdValues.length > 0 ? [{ userId: { in: keywordUserIdValues } }] : [])
      ]
    } : {})
  }
  const billingWhere: Prisma.InstanceBillingRecordWhereInput = {
    userId: options.userId,
    type: options.billingType,
    createdAt,
    ...(options.keyword ? {
      OR: [
        ...(billingOrderId ? [{ id: billingOrderId }] : []),
        { remark: { contains: options.keyword, mode: 'insensitive' } },
        { instance: { name: { contains: options.keyword, mode: 'insensitive' } } },
        ...(keywordUserIdValues.length > 0 ? [{ userId: { in: keywordUserIdValues } }] : [])
      ]
    } : {})
  }

  const [rechargeTotal, billingTotal, rechargeRecords, billingRecords] = await Promise.all([
    includeRecharge
      ? prisma.rechargeRecord.count({
          where: rechargeWhere
        })
      : Promise.resolve(0),
    includeBilling
      ? prisma.instanceBillingRecord.count({
          where: billingWhere
        })
      : Promise.resolve(0),
    includeRecharge
      ? prisma.rechargeRecord.findMany({
          where: rechargeWhere,
          orderBy: { createdAt: 'desc' },
          take,
          include: {
            provider: { select: { id: true, name: true, type: true } },
            user: options.includeUser ? { select: { id: true, username: true, email: true } } : false
          }
        })
      : Promise.resolve([]),
    includeBilling
      ? prisma.instanceBillingRecord.findMany({
          where: billingWhere,
          orderBy: { createdAt: 'desc' },
          take,
          include: {
            instance: {
              select: {
                id: true,
                name: true,
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
      : Promise.resolve([])
  ])

  const billingUsers = options.includeUser && billingRecords.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: Array.from(new Set(billingRecords.map(record => record.userId))) } },
        select: { id: true, username: true, email: true }
      })
    : []
  const billingUserById = new Map(billingUsers.map(user => [user.id, user]))

  const combined = [
    ...rechargeRecords.map(record => buildRechargeOrder(record)),
    ...billingRecords.map(record => buildBillingOrder({
      ...record,
      user: billingUserById.get(record.userId) ?? null
    }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const start = (options.page - 1) * options.pageSize
  const pageOrders = combined.slice(start, start + options.pageSize)
  const operationCases = pageOrders.length > 0
    ? await prisma.orderOperationCase.findMany({
        where: {
          OR: pageOrders.map(order => ({
            sourceType: order.sourceType,
            sourceId: order.sourceId
          }))
        },
        include: includeOrderOperationCaseRelations()
      })
    : []
  const operationCaseByKey = new Map(
    operationCases.map(record => [`${record.sourceType}:${record.sourceId}`, serializeOrderOperationCase(record)])
  )

  return {
    orders: pageOrders.map(order => ({
      ...order,
      operationCase: operationCaseByKey.get(`${order.sourceType}:${order.sourceId}`) ?? null
    })),
    total: rechargeTotal + billingTotal,
    page: options.page,
    pageSize: options.pageSize
  }
}

export default async function orderRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: OrderQuery }>('/api/orders', {
    preHandler: [fastify.authenticateUser]
  }, async (request) => {
    const page = parsePositiveQuery(request.query.page, 1)
    const pageSize = parsePageSize(request.query.pageSize)
    const type = normalizeOrderType(request.query.type)
    const keyword = normalizeSearch(request.query.keyword)

    return listOrders({
      userId: request.user.id,
      page,
      pageSize,
      type,
      status: type === 'instance_billing' ? undefined : normalizeRechargeStatus(request.query.status),
      billingType: type === 'recharge' ? undefined : normalizeBillingType(request.query.status),
      includeUser: false,
      keyword,
      createdFrom: parseDateQuery(request.query.createdFrom),
      createdTo: parseDateQuery(request.query.createdTo)
    })
  })

  fastify.get<{ Params: { type: string; id: string } }>('/api/orders/:type/:id', {
    preHandler: [fastify.authenticateUser]
  }, async (request, reply) => {
    const type = normalizeOrderType(request.params.type)
    const id = parsePositiveId(request.params.id)
    if (!type || !id) {
      return reply.code(400).send({ error: 'Invalid order id', code: 'INVALID_ORDER_ID' })
    }

    if (type === 'recharge') {
      const record = await prisma.rechargeRecord.findFirst({
        where: { id, userId: request.user.id },
        include: { provider: { select: { id: true, name: true, type: true } } }
      })
      if (!record) return reply.code(404).send({ error: 'Order not found', code: 'ORDER_NOT_FOUND' })
      return { order: buildRechargeOrder(record) }
    }

    const record = await prisma.instanceBillingRecord.findFirst({
      where: { id, userId: request.user.id },
      include: {
        instance: {
          select: {
            id: true,
            name: true,
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
    return { order: buildBillingOrder(record) }
  })

  fastify.get<{ Querystring: OrderQuery }>('/api/admin/orders', {
    preHandler: [fastify.authenticateAdmin]
  }, async (request) => {
    const page = parsePositiveQuery(request.query.page, 1)
    const pageSize = parsePageSize(request.query.pageSize)
    const type = normalizeOrderType(request.query.type)
    const userId = parsePositiveId(request.query.userId)
    const keyword = normalizeSearch(request.query.keyword)

    return listOrders({
      userId: userId ?? undefined,
      page,
      pageSize,
      type,
      status: type === 'instance_billing' ? undefined : normalizeRechargeStatus(request.query.status),
      billingType: type === 'recharge' ? undefined : normalizeBillingType(request.query.status),
      includeUser: true,
      keyword,
      createdFrom: parseDateQuery(request.query.createdFrom),
      createdTo: parseDateQuery(request.query.createdTo)
    })
  })

  fastify.get<{ Params: { type: string; id: string } }>('/api/admin/orders/:type/:id', {
    preHandler: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const type = normalizeOrderType(request.params.type)
    const id = parsePositiveId(request.params.id)
    if (!type || !id) {
      return reply.code(400).send({ error: 'Invalid order id', code: 'INVALID_ORDER_ID' })
    }

    if (type === 'recharge') {
      const record = await prisma.rechargeRecord.findUnique({
        where: { id },
        include: {
          provider: { select: { id: true, name: true, type: true } },
          user: { select: { id: true, username: true, email: true } }
        }
      })
      if (!record) return reply.code(404).send({ error: 'Order not found', code: 'ORDER_NOT_FOUND' })
      const operationCase = await getOrderOperationCase(type, id)
      return {
        order: {
          ...buildRechargeOrder(record),
          operationCase: serializeOrderOperationCase(operationCase)
        }
      }
    }

    const record = await prisma.instanceBillingRecord.findUnique({
      where: { id },
      include: {
        instance: {
          select: {
            id: true,
            name: true,
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
    const user = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { id: true, username: true, email: true }
    })
    const operationCase = await getOrderOperationCase(type, id)
    return {
      order: {
        ...buildBillingOrder({ ...record, user }),
        operationCase: serializeOrderOperationCase(operationCase)
      }
    }
  })

  fastify.post<{ Params: { type: string; id: string }; Body: OrderOperationInput }>('/api/admin/orders/:type/:id/operation', {
    preHandler: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const type = normalizeOrderType(request.params.type)
    const id = parsePositiveId(request.params.id)
    if (!type || !id) {
      return reply.code(400).send({ error: '订单 ID 无效', code: 'INVALID_ORDER_ID' })
    }

    let input: ReturnType<typeof normalizeOrderOperationInput>
    try {
      input = normalizeOrderOperationInput(request.body)
    } catch (error) {
      return reply.code(400).send(error)
    }

    const rechargeOrder = type === 'recharge'
      ? await prisma.rechargeRecord.findUnique({
          where: { id },
          include: { provider: { select: { id: true, name: true, type: true } } }
        })
      : null
    const billingOrder = type === 'instance_billing'
      ? await prisma.instanceBillingRecord.findUnique({
          where: { id }
        })
      : null
    const order = rechargeOrder ?? billingOrder

    if (!order) {
      return reply.code(404).send({ error: '订单不存在', code: 'ORDER_NOT_FOUND' })
    }

    if (input.refundAmount !== undefined && input.refundAmount > toMoney(order.amount)) {
      return reply.code(400).send({ error: '退款金额不能超过订单金额' })
    }

    const existingPendingRefund = input.createRefundRequest
      ? await prisma.balanceAdjustmentRequest.findFirst({
          where: {
            requestType: 'refund',
            status: 'pending',
            sourceType: type,
            sourceId: id
          },
          select: { id: true }
        })
      : null

    if (existingPendingRefund) {
      return reply.code(409).send({ error: `该订单已有待审核退款审批 #${existingPendingRefund.id}` })
    }

    const orderNo = rechargeOrder ? rechargeOrder.orderNo : `BILL-${order.id}`
    const providerSummary = rechargeOrder
      ? buildProviderStatusSummary(rechargeOrder)
      : Prisma.JsonNull
    const adjustmentRequest = input.createRefundRequest
      ? await createBalanceAdjustmentRequest({
          userId: order.userId,
          requestedByUserId: request.user.id,
          amount: input.refundAmount!,
          requestType: 'refund',
          sourceType: type,
          sourceId: id,
          orderNo,
          reason: input.reason
        })
      : null

    const operationCase = await prisma.orderOperationCase.upsert({
      where: { sourceType_sourceId: { sourceType: type, sourceId: id } },
      create: {
        sourceType: type,
        sourceId: id,
        orderNo,
        userId: order.userId,
        createdByUserId: request.user.id,
        updatedByUserId: request.user.id,
        status: input.status,
        reason: input.reason,
        result: input.result,
        refundAmount: input.refundAmount,
        providerSummary,
        balanceAdjustmentRequestId: adjustmentRequest?.id
      },
      update: {
        status: input.status,
        reason: input.reason,
        result: input.result,
        refundAmount: input.refundAmount ?? null,
        providerSummary,
        updatedByUserId: request.user.id,
        ...(adjustmentRequest ? { balanceAdjustmentRequestId: adjustmentRequest.id } : {})
      },
      include: includeOrderOperationCaseRelations()
    })

    await createLog(
      request.user.id,
      'admin',
      adjustmentRequest ? 'order.operation.refund_request' : 'order.operation.update',
      adjustmentRequest
        ? `登记订单 ${orderNo} 退款审批 #${adjustmentRequest.id}，金额 ${input.refundAmount}，状态 ${input.status}`
        : `更新订单 ${orderNo} 运营处理状态为 ${input.status}`,
      'success'
    )

    return reply.code(adjustmentRequest ? 201 : 200).send({
      message: adjustmentRequest
        ? '退款登记已提交调账审批，等待审核执行'
        : '订单运营处理记录已保存',
      operationCase: serializeOrderOperationCase(operationCase),
      adjustmentRequest: serializeBalanceAdjustmentRequest(adjustmentRequest)
    })
  })
}
