import type { FastifyInstance } from 'fastify'
import type { BillingRecordType, RechargeStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'

const POSITIVE_ID_PATTERN = /^[1-9]\d*$/
const ORDER_TYPES = new Set(['recharge', 'instance_billing'])
const RECHARGE_STATUSES = new Set(['pending', 'paid', 'completed', 'failed', 'cancelled', 'refunded'])
const BILLING_TYPES = new Set(['newPurchase', 'renew', 'upgrade', 'downgrade', 'refund', 'transfer_fee'])
const MAX_PAGE_SIZE = 100

type OrderType = 'recharge' | 'instance_billing'

interface OrderQuery {
  page?: string
  pageSize?: string
  type?: string
  status?: string
  userId?: string
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

function toMoney(value: unknown): number {
  if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber()
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
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

async function listOrders(options: {
  userId?: number
  page: number
  pageSize: number
  type?: OrderType
  status?: RechargeStatus
  billingType?: BillingRecordType
  includeUser: boolean
}) {
  const take = options.page * options.pageSize
  const includeRecharge = !options.type || options.type === 'recharge'
  const includeBilling = !options.type || options.type === 'instance_billing'

  const [rechargeTotal, billingTotal, rechargeRecords, billingRecords] = await Promise.all([
    includeRecharge
      ? prisma.rechargeRecord.count({
          where: {
            userId: options.userId,
            status: options.status
          }
        })
      : Promise.resolve(0),
    includeBilling
      ? prisma.instanceBillingRecord.count({
          where: {
            userId: options.userId,
            type: options.billingType
          }
        })
      : Promise.resolve(0),
    includeRecharge
      ? prisma.rechargeRecord.findMany({
          where: {
            userId: options.userId,
            status: options.status
          },
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
          where: {
            userId: options.userId,
            type: options.billingType
          },
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
  return {
    orders: combined.slice(start, start + options.pageSize),
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

    return listOrders({
      userId: request.user.id,
      page,
      pageSize,
      type,
      status: type === 'instance_billing' ? undefined : normalizeRechargeStatus(request.query.status),
      billingType: type === 'recharge' ? undefined : normalizeBillingType(request.query.status),
      includeUser: false
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

    return listOrders({
      userId: userId ?? undefined,
      page,
      pageSize,
      type,
      status: type === 'instance_billing' ? undefined : normalizeRechargeStatus(request.query.status),
      billingType: type === 'recharge' ? undefined : normalizeBillingType(request.query.status),
      includeUser: true
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
      return { order: buildRechargeOrder(record) }
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
    return { order: buildBillingOrder({ ...record, user }) }
  })
}
