/**
 * 充值记录数据库操作
 */

import { prisma } from './prisma.js'
import { Prisma, type BalanceLog, type PaymentProvider, type RechargeRecord, type RechargeRefundRequest, type RechargeStatus, type User } from '@prisma/client'
import { nanoid } from 'nanoid'
import { getTodayRange } from '../lib/timezone.js'
import { USER_BALANCE_LOCK_NAMESPACE, advisoryTransactionLock } from './advisory-locks.js'
import { emitPluginEvent } from '../lib/plugin-event-emitter.js'

// ==================== 类型定义 ====================

export interface CreateRechargeOrderInput {
  orderNo?: string
  userId: number
  providerId: number
  amount: number
  actualAmount?: number
  fee?: number
  paymentMethod?: string
  ip?: string
  userAgent?: string
  expiredAt?: Date
  providerConfigSnapshot?: string | null
  paymentDetails?: Record<string, unknown> | null
}

export interface UpdateRechargePaymentSelectionInput {
  paymentMethod?: string | null
  fee: number
  actualAmount: number
  paymentDetails: Record<string, unknown> | null
}

export interface RechargeRecordWithProvider extends RechargeRecord {
  provider: {
    id: number
    name: string
    type: string
  }
}

export type CompleteRechargeResult = RechargeRecord & {
  completedNow: boolean
}

export type RechargeRefundRequestWithRelations = RechargeRefundRequest & {
  rechargeRecord: RechargeRecord
  provider: Pick<PaymentProvider, 'id' | 'name' | 'type'>
  user: Pick<User, 'id' | 'username'>
  requestedBy: Pick<User, 'id' | 'username'>
  processedBy?: Pick<User, 'id' | 'username'> | null
}

export interface CreateRechargeRefundRequestInput {
  rechargeRecordId: number
  requestedByUserId: number
  amount: number
  reason: string
}

export interface ClaimRechargeRefundResult {
  request: RechargeRefundRequestWithRelations
  balanceLog?: BalanceLog
  claimedNow: boolean
}

interface MoneySumRow {
  value: unknown
}

type RechargeDbClient = typeof prisma | Prisma.TransactionClient

const RECHARGE_STATUSES = new Set<RechargeStatus>([
  'pending',
  'paid',
  'completed',
  'failed',
  'cancelled',
  'refunded'
])

function toMoney(value: unknown): number {
  if (value === null || value === undefined) return 0
  return parseFloat(String(value)) || 0
}

function clampPagination(
  page: number | undefined,
  pageSize: number | undefined,
  fallbackPageSize: number = 20,
  maxPageSize: number = 50
): { page: number; pageSize: number } {
  return {
    page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize !== undefined
      ? Math.min(Math.max(pageSize, 1), maxPageSize)
      : fallbackPageSize
  }
}

function normalizeRechargeStatus(status: RechargeStatus | undefined): RechargeStatus | undefined {
  return status && RECHARGE_STATUSES.has(status) ? status : undefined
}

function normalizeRefundAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('退款金额无效')
  }

  const normalized = Number(value.toFixed(2))
  if (normalized <= 0 || !/^\d+(\.\d{1,2})?$/.test(String(normalized))) {
    throw new Error('退款金额无效')
  }
  return normalized
}

function getRechargeCreditAmount(record: Pick<RechargeRecord, 'amount' | 'actualAmount'>): number {
  return Number(record.actualAmount ?? record.amount)
}

function includeRechargeRefundRelations() {
  return {
    rechargeRecord: true,
    provider: { select: { id: true, name: true, type: true } },
    user: { select: { id: true, username: true } },
    requestedBy: { select: { id: true, username: true } },
    processedBy: { select: { id: true, username: true } }
  }
}

async function getRechargeRefundCommittedAmount(
  tx: RechargeDbClient,
  rechargeRecordId: number,
  excludeRefundRequestId?: number,
  statuses: Array<'pending' | 'processing' | 'completed'> = ['pending', 'processing', 'completed']
): Promise<number> {
  const aggregate = await tx.rechargeRefundRequest.aggregate({
    where: {
      rechargeRecordId,
      status: { in: statuses },
      ...(excludeRefundRequestId ? { id: { not: excludeRefundRequestId } } : {})
    },
    _sum: { amount: true }
  })
  return toMoney(aggregate._sum.amount)
}

// ==================== 订单号生成 ====================

/**
 * 生成订单号（时间戳 + 随机字符）
 */
export function generateOrderNo(): string {
  const timestamp = Date.now().toString(36)
  const random = nanoid(8)
  return `R${timestamp}${random}`.toUpperCase()
}

// ==================== 查询操作 ====================

/**
 * 根据订单号获取充值记录
 */
export async function getRechargeRecordByOrderNo(orderNo: string): Promise<RechargeRecordWithProvider | null> {
  return prisma.rechargeRecord.findUnique({
    where: { orderNo },
    include: {
      provider: {
        select: { id: true, name: true, type: true }
      }
    }
  }) as Promise<RechargeRecordWithProvider | null>
}

/**
 * 根据第三方交易号获取充值记录
 */
export async function getRechargeRecordByTradeNo(tradeNo: string): Promise<RechargeRecord | null> {
  return prisma.rechargeRecord.findFirst({
    where: { tradeNo }
  })
}

/**
 * 根据 ID 获取充值记录
 */
export async function getRechargeRecordById(id: number): Promise<RechargeRecordWithProvider | null> {
  return prisma.rechargeRecord.findUnique({
    where: { id },
    include: {
      provider: {
        select: { id: true, name: true, type: true }
      }
    }
  }) as Promise<RechargeRecordWithProvider | null>
}

/**
 * 获取用户的充值记录（分页）
 */
export async function getUserRechargeRecords(
  userId: number,
  options: { page?: number; pageSize?: number; status?: RechargeStatus } = {}
): Promise<{ records: RechargeRecordWithProvider[]; total: number; page: number; pageSize: number }> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const skip = (page - 1) * pageSize
  const status = normalizeRechargeStatus(options.status)

  const where: Record<string, unknown> = { userId }
  if (status) {
    where.status = status
  }

  const [records, total] = await Promise.all([
    prisma.rechargeRecord.findMany({
      where,
      include: {
        provider: {
          select: { id: true, name: true, type: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.rechargeRecord.count({ where })
  ])

  return {
    records: records as RechargeRecordWithProvider[],
    total,
    page,
    pageSize
  }
}

/**
 * 获取所有充值记录（管理员，分页）
 */
export async function getAllRechargeRecords(
  options: { page?: number; pageSize?: number; status?: RechargeStatus; userId?: number } = {}
): Promise<{ records: RechargeRecordWithProvider[]; total: number; page: number; pageSize: number }> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const skip = (page - 1) * pageSize
  const status = normalizeRechargeStatus(options.status)

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (Number.isInteger(options.userId) && options.userId !== undefined && options.userId > 0) {
    where.userId = options.userId
  }

  const [records, total] = await Promise.all([
    prisma.rechargeRecord.findMany({
      where,
      include: {
        provider: {
          select: { id: true, name: true, type: true }
        },
        user: {
          select: { id: true, username: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.rechargeRecord.count({ where })
  ])

  return {
    records: records as unknown as RechargeRecordWithProvider[],
    total,
    page,
    pageSize
  }
}

// ==================== 创建操作 ====================

/**
 * 创建充值订单
 */
export async function createRechargeOrder(input: CreateRechargeOrderInput): Promise<RechargeRecord> {
  const orderNo = input.orderNo || generateOrderNo()
  const expiredAt = input.expiredAt ?? new Date(Date.now() + 30 * 60 * 1000)

  const record = await prisma.rechargeRecord.create({
    data: {
      userId: input.userId,
      providerId: input.providerId,
      orderNo,
      amount: input.amount,
      actualAmount: input.actualAmount,
      fee: input.fee || 0,
      paymentMethod: input.paymentMethod,
      status: 'pending',
      ip: input.ip,
      userAgent: input.userAgent,
      expiredAt,
      providerConfigSnapshot: input.providerConfigSnapshot,
      paymentDetails: input.paymentDetails as any
    }
  })

  emitPluginEvent('order.created', {
    dedupeKey: `order.created:recharge:${record.orderNo}`,
    resource: 'recharge',
    orderNo: record.orderNo,
    rechargeId: record.id,
    userId: record.userId,
    providerId: record.providerId,
    amount: Number(record.amount),
    actualAmount: Number(record.actualAmount),
    fee: Number(record.fee),
    paymentMethod: record.paymentMethod,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    expiredAt: record.expiredAt?.toISOString() ?? null
  }, { id: record.userId, role: 'user' }, { dedupeKey: `order.created:recharge:${record.orderNo}` })

  return record
}

// ==================== 更新操作 ====================

/**
 * 更新充值订单的支付元数据，不改变订单状态
 */
export async function updateRechargeOrderMetadata(
  orderNo: string,
  data: {
    tradeNo?: string | null
    callbackData?: Record<string, unknown>
    paymentDetails?: Record<string, unknown>
  }
): Promise<RechargeRecord> {
  const updateData: Record<string, unknown> = {}

  if (data.tradeNo !== undefined) {
    updateData.tradeNo = data.tradeNo
  }

  if (data.callbackData !== undefined) {
    updateData.callbackData = data.callbackData as any
    updateData.callbackAt = new Date()
  }

  if (data.paymentDetails !== undefined) {
    updateData.paymentDetails = data.paymentDetails as any
  }

  await prisma.rechargeRecord.updateMany({
    where: {
      orderNo,
      status: { in: ['pending', 'paid'] }
    },
    data: updateData
  })

  const record = await prisma.rechargeRecord.findUnique({
    where: { orderNo }
  })

  if (!record) {
    throw new Error('订单不存在')
  }

  return record
}

/**
 * 完成充值（成功）
 * 使用状态机 + 条件更新确保幂等性和并发安全
 */
export async function completeRecharge(
  orderNo: string,
  data: {
    tradeNo?: string
    callbackData?: Record<string, unknown>
    actualAmount?: number
    paymentDetails?: Record<string, unknown>
  }
): Promise<CompleteRechargeResult> {
  const record = await prisma.rechargeRecord.findUnique({
    where: { orderNo }
  })

  if (!record) {
    throw new Error('订单不存在')
  }

  // 幂等性处理：已完成的订单直接返回，不重复处理
  if (record.status === 'completed') {
    return { ...record, completedNow: false }
  }

  // 已取消或失败的订单不能再完成
  if (record.status === 'cancelled' || record.status === 'failed') {
    throw new Error(`订单状态异常：${record.status}`)
  }

  const creditAmount = Number(data.actualAmount ?? record.actualAmount ?? record.amount)
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    throw new Error('充值入账金额无效')
  }

  // 使用事务确保原子性
  const result = await prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, record.userId)

    // 1. 使用条件更新确保并发安全（只有 pending 或 paid 状态可以变为 completed）
    const updateResult = await tx.rechargeRecord.updateMany({
      where: {
        orderNo,
        status: { in: ['pending', 'paid'] }  // 状态机：只有这两种状态可以转为 completed
      },
      data: {
        status: 'completed',
        tradeNo: data.tradeNo,
        callbackData: data.callbackData as any,
        callbackAt: new Date(),
        completedAt: new Date(),
        actualAmount: creditAmount,
        paymentDetails: (data.paymentDetails as any) ?? record.paymentDetails
      }
    })

    // 如果更新了 0 条记录，说明状态已被其他进程改变
    if (updateResult.count === 0) {
      // 重新查询订单状态
      const currentRecord = await tx.rechargeRecord.findUnique({
        where: { orderNo }
      })
      // 如果已经是 completed，说明是并发完成，返回成功（幂等）
      if (currentRecord && currentRecord.status === 'completed') {
        return { ...currentRecord, completedNow: false }
      }
      throw new Error('订单状态已变更，无法完成')
    }

    // 获取更新后的记录
    const updatedRecord = await tx.rechargeRecord.findUnique({
      where: { orderNo }
    })

    if (!updatedRecord) {
      throw new Error('订单更新异常')
    }

    // 2. 增加用户余额（使用 ?? 避免 0 值被误判为 falsy）
    const updatedUser = await tx.user.update({
      where: { id: record.userId },
      data: { balance: { increment: creditAmount } },
      select: { balance: true }
    })
    const balanceAfter = Number(updatedUser.balance)

    // 3. 记录余额日志
    await tx.balanceLog.create({
      data: {
        userId: record.userId,
        type: 'recharge',
        amount: creditAmount,
        balanceBefore: Number((balanceAfter - creditAmount).toFixed(2)),
        balanceAfter,
        orderId: record.orderNo,
        remark: `充值：${Number(record.amount)} 元`
      }
    })

    // 4. 注释掉首次充值激活 AFF 推荐计划的逻辑
    // 由于需求变更，AFF 推荐计划现在无需充值即可使用
    // const userProfile = await tx.user.findUnique({
    //   where: { id: record.userId },
    //   select: { affActivatedAt: true }
    // })
    // if (!userProfile?.affActivatedAt) {
    //   await tx.user.update({
    //     where: { id: record.userId },
    //     data: { affActivatedAt: new Date() }
    //   })
    // }

    return { ...updatedRecord, completedNow: true }
  })

  if (result.completedNow) {
    emitPluginEvent('order.paid', {
      dedupeKey: `order.paid:recharge:${result.orderNo}`,
      resource: 'recharge',
      orderNo: result.orderNo,
      rechargeId: result.id,
      userId: result.userId,
      providerId: result.providerId,
      amount: Number(result.amount),
      actualAmount: Number(result.actualAmount),
      fee: Number(result.fee),
      tradeNo: result.tradeNo,
      paymentMethod: result.paymentMethod,
      status: result.status,
      completedAt: result.completedAt?.toISOString() ?? null
    }, { id: result.userId, role: 'user' }, { dedupeKey: `order.paid:recharge:${result.orderNo}` })
  }

  return result
}

/**
 * 标记充值失败
 */
export async function failRecharge(
  orderNo: string,
  failReason: string,
  callbackData?: Record<string, unknown>,
  paymentDetails?: Record<string, unknown>
): Promise<RechargeRecord> {
  const updateResult = await prisma.rechargeRecord.updateMany({
    where: {
      orderNo,
      status: { in: ['pending', 'paid'] }
    },
    data: {
      status: 'failed',
      failReason,
      callbackData: callbackData as any,
      callbackAt: new Date(),
      paymentDetails: paymentDetails as any
    }
  })

  const record = await prisma.rechargeRecord.findUnique({
    where: { orderNo }
  })

  if (!record) {
    throw new Error('订单不存在')
  }

  if (updateResult.count > 0) {
    emitPluginEvent('payment.failed', {
      dedupeKey: `payment.failed:recharge:${record.orderNo}`,
      resource: 'recharge',
      orderNo: record.orderNo,
      rechargeId: record.id,
      userId: record.userId,
      providerId: record.providerId,
      amount: Number(record.amount),
      actualAmount: Number(record.actualAmount),
      paymentMethod: record.paymentMethod,
      status: record.status,
      failReason: record.failReason,
      callbackAt: record.callbackAt?.toISOString() ?? null
    }, { id: record.userId, role: 'user' }, { dedupeKey: `payment.failed:recharge:${record.orderNo}` })
  }

  return record
}

/**
 * 取消充值订单
 */
export async function cancelRecharge(
  orderNo: string,
  callbackData?: Record<string, unknown>,
  paymentDetails?: Record<string, unknown>
): Promise<RechargeRecord> {
  await prisma.rechargeRecord.updateMany({
    where: {
      orderNo,
      status: { in: ['pending', 'paid'] }
    },
    data: {
      status: 'cancelled',
      paymentDetails: paymentDetails as any,
      ...(callbackData
        ? {
            callbackData: callbackData as any,
            callbackAt: new Date()
          }
        : {})
    }
  })

  const record = await prisma.rechargeRecord.findUnique({
    where: { orderNo }
  })

  if (!record) {
    throw new Error('订单不存在')
  }

  return record
}

export async function getRechargeRefundRequestById(id: number): Promise<RechargeRefundRequestWithRelations | null> {
  return prisma.rechargeRefundRequest.findUnique({
    where: { id },
    include: includeRechargeRefundRelations()
  }) as Promise<RechargeRefundRequestWithRelations | null>
}

export async function createRechargeRefundRequest(
  input: CreateRechargeRefundRequestInput
): Promise<RechargeRefundRequestWithRelations> {
  const amount = normalizeRefundAmount(input.amount)
  const reason = input.reason.trim()
  if (!reason) {
    throw new Error('必须填写退款原因')
  }

  return prisma.$transaction(async (tx) => {
    const record = await tx.rechargeRecord.findUnique({
      where: { id: input.rechargeRecordId }
    })

    if (!record) {
      throw new Error('充值记录不存在')
    }
    if (record.status !== 'completed') {
      throw new Error('仅已完成充值支持原路退款')
    }

    const creditAmount = getRechargeCreditAmount(record)
    if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
      throw new Error('充值入账金额无效')
    }

    const committedAmount = await getRechargeRefundCommittedAmount(tx, record.id)
    if (Number((committedAmount + amount).toFixed(2)) > Number(creditAmount.toFixed(2))) {
      throw new Error('退款金额超过可退款余额')
    }

    return tx.rechargeRefundRequest.create({
      data: {
        rechargeRecordId: record.id,
        userId: record.userId,
        providerId: record.providerId,
        requestedByUserId: input.requestedByUserId,
        amount,
        reason,
        idempotencyKey: `recharge-refund:${record.orderNo}:${Date.now()}:${nanoid(8)}`
      },
      include: includeRechargeRefundRelations()
    }) as Promise<RechargeRefundRequestWithRelations>
  })
}

export async function claimRechargeRefundForProcessing(
  refundRequestId: number,
  processedByUserId: number
): Promise<ClaimRechargeRefundResult> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.rechargeRefundRequest.findUnique({
      where: { id: refundRequestId },
      include: includeRechargeRefundRelations()
    }) as RechargeRefundRequestWithRelations | null

    if (!request) {
      throw new Error('退款申请不存在')
    }
    if (request.status === 'completed') {
      return { request, claimedNow: false }
    }
    if (request.status === 'processing') {
      return { request, claimedNow: false }
    }
    if (request.status === 'cancelled') {
      throw new Error('退款申请已取消')
    }

    const record = request.rechargeRecord
    if (record.status !== 'completed') {
      throw new Error('仅已完成充值支持原路退款')
    }

    const refundAmount = Number(request.amount)
    const creditAmount = getRechargeCreditAmount(record)
    const committedAmount = await getRechargeRefundCommittedAmount(tx, record.id, request.id)
    if (Number((committedAmount + refundAmount).toFixed(2)) > Number(creditAmount.toFixed(2))) {
      throw new Error('退款金额超过可退款余额')
    }

    await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, request.userId)
    const user = await tx.user.findUnique({
      where: { id: request.userId },
      select: { balance: true }
    })
    if (!user) {
      throw new Error('用户不存在')
    }

    const balanceBefore = Number(user.balance)
    const balanceAfter = Number((balanceBefore - refundAmount).toFixed(2))
    if (balanceAfter < 0) {
      throw new Error('用户余额不足，无法执行原路退款预扣')
    }

    const updated = await tx.user.updateMany({
      where: { id: request.userId, balance: { gte: refundAmount } },
      data: { balance: { decrement: refundAmount } }
    })
    if (updated.count !== 1) {
      throw new Error('用户余额不足或并发冲突，无法执行原路退款预扣')
    }

    const balanceLog = await tx.balanceLog.create({
      data: {
        userId: request.userId,
        type: 'admin_adjust',
        amount: -refundAmount,
        balanceBefore,
        balanceAfter,
        orderId: record.orderNo,
        remark: `[原路退款预扣] ${request.reason}`
      }
    })

    const claimed = await tx.rechargeRefundRequest.updateMany({
      where: { id: refundRequestId, status: request.status },
      data: {
        status: 'processing',
        processedByUserId,
        processedAt: new Date(),
        failureReason: null
      }
    })
    if (claimed.count !== 1) {
      throw new Error('退款申请状态已变更')
    }

    const updatedRequest = await tx.rechargeRefundRequest.findUnique({
      where: { id: refundRequestId },
      include: includeRechargeRefundRelations()
    })
    if (!updatedRequest) {
      throw new Error('退款申请不存在')
    }

    return {
      request: updatedRequest as RechargeRefundRequestWithRelations,
      balanceLog,
      claimedNow: true
    }
  })
}

export async function markRechargeRefundProcessing(
  refundRequestId: number,
  data: {
    providerRequestId?: string | null
    providerRefundId?: string | null
    providerStatus?: string | null
    providerMessage?: string | null
    providerMetadata?: Record<string, unknown> | null
  }
): Promise<RechargeRefundRequestWithRelations> {
  const request = await prisma.rechargeRefundRequest.update({
    where: { id: refundRequestId },
    data: {
      status: 'processing',
      providerRequestId: data.providerRequestId,
      providerRefundId: data.providerRefundId,
      providerStatus: data.providerStatus,
      providerMessage: data.providerMessage,
      providerMetadata: data.providerMetadata as any
    },
    include: includeRechargeRefundRelations()
  })

  return request as RechargeRefundRequestWithRelations
}

export async function completeRechargeRefundRequest(
  refundRequestId: number,
  data: {
    providerRequestId?: string | null
    providerRefundId?: string | null
    providerStatus?: string | null
    providerMessage?: string | null
    providerMetadata?: Record<string, unknown> | null
  }
): Promise<RechargeRefundRequestWithRelations> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.rechargeRefundRequest.findUnique({
      where: { id: refundRequestId },
      include: includeRechargeRefundRelations()
    }) as RechargeRefundRequestWithRelations | null

    if (!request) {
      throw new Error('退款申请不存在')
    }
    if (request.status === 'completed') {
      return request
    }
    if (request.status !== 'processing') {
      throw new Error('退款申请未进入处理状态')
    }

    const updatedRequest = await tx.rechargeRefundRequest.update({
      where: { id: refundRequestId },
      data: {
        status: 'completed',
        providerRequestId: data.providerRequestId,
        providerRefundId: data.providerRefundId,
        providerStatus: data.providerStatus,
        providerMessage: data.providerMessage,
        providerMetadata: data.providerMetadata as any,
        completedAt: new Date(),
        failureReason: null
      },
      include: includeRechargeRefundRelations()
    })

    const completedAmount = await getRechargeRefundCommittedAmount(tx, request.rechargeRecordId, undefined, ['completed'])
    const creditAmount = getRechargeCreditAmount(request.rechargeRecord)
    if (completedAmount + 0.01 >= creditAmount) {
      await tx.rechargeRecord.updateMany({
        where: { id: request.rechargeRecordId, status: 'completed' },
        data: { status: 'refunded' }
      })
    }

    return updatedRequest as RechargeRefundRequestWithRelations
  })
}

export async function failRechargeRefundRequest(
  refundRequestId: number,
  failureReason: string,
  data: {
    providerRequestId?: string | null
    providerRefundId?: string | null
    providerStatus?: string | null
    providerMessage?: string | null
    providerMetadata?: Record<string, unknown> | null
  } = {}
): Promise<RechargeRefundRequestWithRelations> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.rechargeRefundRequest.findUnique({
      where: { id: refundRequestId },
      include: includeRechargeRefundRelations()
    }) as RechargeRefundRequestWithRelations | null

    if (!request) {
      throw new Error('退款申请不存在')
    }
    if (request.status === 'completed') {
      throw new Error('退款申请已完成')
    }
    if (request.status === 'failed') {
      return request
    }

    const refundAmount = Number(request.amount)
    if (request.status === 'processing') {
      await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, request.userId)
      const user = await tx.user.update({
        where: { id: request.userId },
        data: { balance: { increment: refundAmount } },
        select: { balance: true }
      })
      const balanceAfter = Number(user.balance)
      await tx.balanceLog.create({
        data: {
          userId: request.userId,
          type: 'admin_adjust',
          amount: refundAmount,
          balanceBefore: Number((balanceAfter - refundAmount).toFixed(2)),
          balanceAfter,
          orderId: request.rechargeRecord.orderNo,
          remark: `[原路退款失败返还预扣] ${failureReason}`
        }
      })
    }

    const updatedRequest = await tx.rechargeRefundRequest.update({
      where: { id: refundRequestId },
      data: {
        status: 'failed',
        providerRequestId: data.providerRequestId,
        providerRefundId: data.providerRefundId,
        providerStatus: data.providerStatus,
        providerMessage: data.providerMessage,
        providerMetadata: data.providerMetadata as any,
        failureReason
      },
      include: includeRechargeRefundRelations()
    })

    return updatedRequest as RechargeRefundRequestWithRelations
  })
}

/**
 * 更新订单支付方式
 */
export async function updatePendingRechargePaymentSelection(
  orderNo: string,
  data: UpdateRechargePaymentSelectionInput
): Promise<RechargeRecord | null> {
  const result = await prisma.rechargeRecord.updateMany({
    where: {
      orderNo,
      status: 'pending'
    },
    data: {
      paymentMethod: data.paymentMethod || null,
      fee: data.fee,
      actualAmount: data.actualAmount,
      paymentDetails: data.paymentDetails as any
    }
  })

  if (result.count === 0) {
    return null
  }

  return prisma.rechargeRecord.findUnique({
    where: { orderNo }
  })
}

// ==================== 过期订单处理 ====================

/**
 * 获取已过期的待处理订单
 */
export async function getExpiredPendingOrders(): Promise<RechargeRecord[]> {
  return prisma.rechargeRecord.findMany({
    where: {
      status: 'pending',
      expiredAt: { lt: new Date() }
    }
  })
}

/**
 * 批量过期订单（标记为取消）
 */
export async function expireOrders(orderNos: string[]): Promise<number> {
  const result = await prisma.rechargeRecord.updateMany({
    where: {
      orderNo: { in: orderNos },
      status: 'pending'
    },
    data: {
      status: 'cancelled'
    }
  })
  return result.count
}

// ==================== 统计查询 ====================

/**
 * 获取用户充值统计
 */
export async function getUserRechargeStats(userId: number): Promise<{
  totalRecharge: number
  totalCount: number
  pendingCount: number
}> {
  const [totalResult, totalCount, pendingCount] = await Promise.all([
    prisma.$queryRaw<MoneySumRow[]>`
      SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
      FROM recharge_records
      WHERE user_id = ${userId}
        AND status = 'completed'
    `,
    prisma.rechargeRecord.count({
      where: { userId, status: 'completed' }
    }),
    prisma.rechargeRecord.count({
      where: { userId, status: 'pending' }
    })
  ])

  return {
    totalRecharge: toMoney(totalResult[0]?.value),
    totalCount,
    pendingCount
  }
}

/**
 * 获取系统充值统计（管理员）
 */
export async function getSystemRechargeStats(dateRange?: { start: Date; end: Date }): Promise<{
  totalRecharge: number
  totalCount: number
  pendingAmount: number
  pendingCount: number
  todayRecharge: number
  todayCount: number
}> {
  // 使用业务时区（Asia/Shanghai）计算日期边界
  const { start: today, end: tomorrow } = getTodayRange()

  const whereCompleted: Record<string, unknown> = { status: 'completed' }
  if (dateRange) {
    whereCompleted.completedAt = { gte: dateRange.start, lte: dateRange.end }
  }

  const [totalResult, totalCount, pendingResult, pendingCount, todayResult, todayCount] = await Promise.all([
    dateRange
      ? prisma.$queryRaw<MoneySumRow[]>`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
            AND completed_at >= ${dateRange.start}
            AND completed_at <= ${dateRange.end}
        `
      : prisma.$queryRaw<MoneySumRow[]>`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
        `,
    prisma.rechargeRecord.count({ where: whereCompleted }),
    prisma.rechargeRecord.aggregate({
      where: { status: 'pending' },
      _sum: { amount: true }
    }),
    prisma.rechargeRecord.count({ where: { status: 'pending' } }),
    prisma.$queryRaw<MoneySumRow[]>`
      SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
      FROM recharge_records
      WHERE status = 'completed'
        AND completed_at >= ${today}
        AND completed_at < ${tomorrow}
    `,
    prisma.rechargeRecord.count({
      where: { status: 'completed', completedAt: { gte: today, lt: tomorrow } }
    })
  ])

  return {
    totalRecharge: toMoney(totalResult[0]?.value),
    totalCount,
    pendingAmount: pendingResult._sum?.amount !== null && pendingResult._sum?.amount !== undefined
      ? parseFloat(String(pendingResult._sum.amount))
      : 0,
    pendingCount,
    todayRecharge: toMoney(todayResult[0]?.value),
    todayCount
  }
}
