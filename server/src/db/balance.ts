/**
 * 用户余额相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import { Prisma, type BalanceLog, type BalanceLogType } from '@prisma/client'

type BalanceQueryClient = typeof prisma | Prisma.TransactionClient

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

// ==================== 余额查询 ====================

/**
 * 获取用户余额
 */
export async function getUserBalance(userId: number): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { balance: true }
  })
  return user ? Number(user.balance) : 0
}

// 余额日志带实例信息的类型
export type BalanceLogWithInstance = BalanceLog & {
  instance?: { id: number; name: string } | null
}

/**
 * 获取用户余额变动日志（分页）
 * 包含关联的实例名称
 * @param lotteryGift - 'exclude' 排除抽奖赠送记录（默认）, 'only' 仅显示抽奖赠送记录, undefined 显示全部
 */
export async function getBalanceLogs(
  userId: number,
  options: {
    page?: number
    pageSize?: number
    type?: BalanceLogType
    lotteryGift?: 'exclude' | 'only'
  } = {}
): Promise<{
  logs: BalanceLogWithInstance[]
  total: number
  page: number
  pageSize: number
}> {
  const { page = 1, pageSize = 20, type, lotteryGift } = options
  const skip = (page - 1) * pageSize

  // 构建查询条件
  const where: Prisma.BalanceLogWhereInput = {
    userId,
    ...(type ? { type } : {})
  }

  // 处理抽奖赠送筛选（抽奖赠送特征：type='gift' AND remark 包含 '抽奖中奖'）
  if (lotteryGift === 'exclude') {
    // 排除抽奖赠送：NOT (type='gift' AND remark contains '抽奖中奖')
    where.NOT = {
      type: 'gift',
      remark: { contains: '抽奖中奖' }
    }
  } else if (lotteryGift === 'only') {
    // 仅抽奖赠送
    where.type = 'gift'
    where.remark = { contains: '抽奖中奖' }
  }

  const [logs, total] = await Promise.all([
    prisma.balanceLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.balanceLog.count({ where })
  ])

  // 查询关联的实例信息
  const instanceIds = logs.filter(l => l.instanceId).map(l => l.instanceId!) as number[]
  const instances = instanceIds.length > 0
    ? await prisma.instance.findMany({
        where: { id: { in: instanceIds } },
        select: { id: true, name: true }
      })
    : []
  const instanceMap = new Map(instances.map(i => [i.id, i]))

  // 合并实例信息
  const logsWithInstance: BalanceLogWithInstance[] = logs.map(log => ({
    ...log,
    instance: log.instanceId ? instanceMap.get(log.instanceId) || null : null
  }))

  return { logs: logsWithInstance, total, page, pageSize }
}

// ==================== 余额变动操作（事务安全） ====================

export interface BalanceChangeInput {
  userId: number
  type: BalanceLogType
  amount: number // 正数=增加，负数=减少
  orderId?: string
  instanceId?: number
  remark?: string
}

export interface BalanceChangeResult {
  success: boolean
  balanceLog?: BalanceLog
  newBalance?: number
  error?: string
}

/**
 * 变更用户余额（事务安全）
 * 所有余额变动都应该通过这个函数进行，确保日志记录和数据一致性
 */
export async function changeBalance(
  input: BalanceChangeInput
): Promise<BalanceChangeResult> {
  const { userId, type, amount, orderId, instanceId, remark } = input

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. 获取当前余额（加锁）
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      })

      if (!user) {
        throw new Error('用户不存在')
      }

      const balanceBefore = Number(user.balance)
      const balanceAfter = balanceBefore + amount

      // 2. 检查余额是否足够（如果是扣款）
      if (amount < 0 && balanceAfter < 0) {
        throw new Error('余额不足')
      }

      // 3. 更新用户余额
      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter }
      })

      // 4. 创建余额变动日志
      const balanceLog = await tx.balanceLog.create({
        data: {
          userId,
          type,
          amount,
          balanceBefore,
          balanceAfter,
          orderId,
          instanceId,
          remark
        }
      })

      return { balanceLog, newBalance: balanceAfter }
    })

    return {
      success: true,
      balanceLog: result.balanceLog,
      newBalance: result.newBalance
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '余额变动失败'
    }
  }
}

/**
 * 充值到账（从充值订单完成）
 */
export async function rechargeToBalance(
  userId: number,
  amount: number,
  orderId: string,
  remark?: string
): Promise<BalanceChangeResult> {
  return changeBalance({
    userId,
    type: 'recharge',
    amount,
    orderId,
    remark: remark || `充值订单 ${orderId}`
  })
}

/**
 * 消费扣款（开通/续费实例）
 */
export async function consumeBalance(
  userId: number,
  amount: number,
  instanceId: number,
  remark?: string
): Promise<BalanceChangeResult> {
  return changeBalance({
    userId,
    type: 'consume',
    amount: -Math.abs(amount), // 确保是负数
    instanceId,
    remark
  })
}

/**
 * 退款到余额
 */
export async function refundToBalance(
  userId: number,
  amount: number,
  instanceId: number,
  remark?: string
): Promise<BalanceChangeResult> {
  return changeBalance({
    userId,
    type: 'refund',
    amount: Math.abs(amount), // 确保是正数
    instanceId,
    remark
  })
}

/**
 * 管理员调整余额
 */
export async function adminAdjustBalance(
  userId: number,
  amount: number,
  remark: string
): Promise<BalanceChangeResult> {
  return changeBalance({
    userId,
    type: 'admin_adjust',
    amount,
    remark
  })
}

/**
 * 赠送余额
 */
export async function giftBalance(
  userId: number,
  amount: number,
  remark?: string
): Promise<BalanceChangeResult> {
  return changeBalance({
    userId,
    type: 'gift',
    amount: Math.abs(amount), // 确保是正数
    remark
  })
}

/**
 * 获取用户实际消费额。
 * 历史上部分业务把 consume.amount 写成正数，不能直接 SUM(amount) 再取绝对值。
 * 这里优先使用余额前后差额，兼容正负号不一致的历史日志。
 */
export async function getUsersTotalConsumeMap(
  userIds: number[],
  client: BalanceQueryClient = prisma
): Promise<Map<number, number>> {
  const validUserIds = Array.from(new Set(
    userIds.filter(id => Number.isInteger(id) && id > 0)
  ))

  if (validUserIds.length === 0) {
    return new Map()
  }

  const rows = await client.$queryRaw<Array<{ userId: number; totalConsume: unknown }>>(Prisma.sql`
    SELECT
      user_id AS "userId",
      COALESCE(SUM(
        CASE
          WHEN balance_before > balance_after THEN balance_before - balance_after
          ELSE ABS(amount)
        END
      ), 0)::numeric AS "totalConsume"
    FROM balance_logs
    WHERE user_id IN (${Prisma.join(validUserIds)})
      AND type = 'consume'
    GROUP BY user_id
  `)

  return new Map(rows.map(row => [row.userId, toNumber(row.totalConsume)]))
}

export async function getUserTotalConsume(
  userId: number,
  client: BalanceQueryClient = prisma
): Promise<number> {
  const consumeMap = await getUsersTotalConsumeMap([userId], client)
  return consumeMap.get(userId) || 0
}

// ==================== 检查操作 ====================

/**
 * 检查用户余额是否足够
 */
export async function hasEnoughBalance(
  userId: number,
  amount: number
): Promise<boolean> {
  const balance = await getUserBalance(userId)
  return balance >= amount
}

/**
 * 获取用户消费统计
 */
export async function getUserConsumeStats(userId: number): Promise<{
  totalRecharge: number
  totalConsume: number
  totalRefund: number
  totalDestroyedValue: number
}> {
  const [logs, destroyedRefund, totalConsume] = await Promise.all([
    prisma.balanceLog.groupBy({
      by: ['type'],
      where: { userId },
      _sum: { amount: true }
    }),
    prisma.balanceLog.aggregate({
      where: {
        userId,
        type: 'refund',
        amount: { gt: 0 },
        remark: { contains: '用户销毁实例退款' }
      },
      _sum: { amount: true }
    }),
    getUserTotalConsume(userId)
  ])

  const stats = {
    totalRecharge: 0,
    totalConsume,
    totalRefund: 0,
    totalDestroyedValue: destroyedRefund._sum.amount !== null && destroyedRefund._sum.amount !== undefined
      ? parseFloat(String(destroyedRefund._sum.amount))
      : 0
  }

  for (const log of logs) {
    // 注意：Prisma aggregate 返回的 Decimal 类型需要先转为字符串再转数字
    const amount = log._sum.amount !== null
      ? parseFloat(String(log._sum.amount))
      : 0
    switch (log.type) {
      case 'recharge':
        stats.totalRecharge = amount
        break
      case 'refund':
        stats.totalRefund = amount
        break
    }
  }

  return stats
}

/**
 * 获取实例的历史消费总额（用于退款上限计算）
 */
export async function getInstanceTotalConsume(instanceId: number): Promise<number> {
  const result = await prisma.balanceLog.aggregate({
    where: {
      instanceId,
      type: 'consume'
    },
    _sum: { amount: true }
  })
  // 注意：Prisma aggregate 返回的 Decimal 类型需要先转为字符串再转数字
  return result._sum.amount !== null
    ? Math.abs(parseFloat(String(result._sum.amount)))
    : 0
}

/**
 * 获取实例的历史退款总额
 */
export async function getInstanceTotalRefund(instanceId: number): Promise<number> {
  const result = await prisma.balanceLog.aggregate({
    where: {
      instanceId,
      type: 'refund'
    },
    _sum: { amount: true }
  })
  // 注意：Prisma aggregate 返回的 Decimal 类型需要先转为字符串再转数字
  return result._sum.amount !== null
    ? parseFloat(String(result._sum.amount))
    : 0
}

/**
 * 计算实例可退款金额（历史消费 - 已退款）
 */
export async function getInstanceRefundableAmount(instanceId: number): Promise<number> {
  const [totalConsume, totalRefund] = await Promise.all([
    getInstanceTotalConsume(instanceId),
    getInstanceTotalRefund(instanceId)
  ])
  return Math.max(0, totalConsume - totalRefund)
}
