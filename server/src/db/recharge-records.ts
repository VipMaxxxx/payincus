/**
 * 充值记录数据库操作
 */

import { prisma } from './prisma.js'
import type { RechargeRecord, RechargeStatus } from '@prisma/client'
import { nanoid } from 'nanoid'
import { getTodayRange } from '../lib/timezone.js'
import { USER_BALANCE_LOCK_NAMESPACE, advisoryTransactionLock } from './advisory-locks.js'

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

interface MoneySumRow {
  value: unknown
}

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

  return prisma.rechargeRecord.create({
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
  await prisma.rechargeRecord.updateMany({
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
