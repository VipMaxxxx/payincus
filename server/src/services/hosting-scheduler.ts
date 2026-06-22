/**
 * 托管余额调度器
 * 负责定时解冻到期的托管收入
 */

import { schedule } from 'node-cron'
import { prisma } from '../db/prisma.js'
import {
  HOSTING_BALANCE_LOG_LOCK_NAMESPACE,
  tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'

let schedulerStarted = false

// ==================== 解冻任务 ====================

/**
 * 解冻到期的托管余额
 * 每小时执行一次，将已到解冻时间的冻结收入解冻并计入用户可用托管余额
 */
async function unfreezeHostingBalance(): Promise<void> {
  console.log('[Hosting] Starting unfreeze job...')
  const startTime = Date.now()

  try {
    const now = new Date()

    // 获取待解冻的记录（frozen=true 且 unfreezeAt <= now）
    const frozenRecords = await prisma.hostingBalanceLog.findMany({
      where: {
        frozen: true,
        unfreezeAt: { lte: now }
      },
      select: {
        id: true,
        userId: true,
        amount: true
      }
    })

    console.log(`[Hosting] Found ${frozenRecords.length} records to unfreeze`)

    if (frozenRecords.length === 0) {
      console.log('[Hosting] No records to unfreeze')
      return
    }

    const recordIds: number[] = []

    for (const record of frozenRecords) {
      recordIds.push(record.id)
    }

    // 执行事务：更新记录状态并增加用户可用托管余额
    await prisma.$transaction(async (tx) => {
      const lockedRecords = await tx.hostingBalanceLog.findMany({
        where: {
          id: { in: recordIds },
          frozen: true,
          unfreezeAt: { lte: now }
        },
        select: {
          id: true,
          userId: true,
          amount: true
        }
      })

      if (lockedRecords.length === 0) {
        return
      }

      const lockedAmounts = new Map<number, number>()
      const lockedRecordIds: number[] = []
      for (const record of lockedRecords) {
        lockedAmounts.set(record.userId, (lockedAmounts.get(record.userId) || 0) + Number(record.amount))
        lockedRecordIds.push(record.id)
      }

      for (const userId of [...lockedAmounts.keys()].sort((a, b) => a - b)) {
        const locked = await tryAdvisoryTransactionLock(tx, HOSTING_BALANCE_LOG_LOCK_NAMESPACE, userId)
        if (!locked) {
          throw new Error('托管余额正在处理，请稍后重试解冻')
        }
      }

      // 批量更新记录状态为已解冻。条件带上 frozen/unfreezeAt，避免和销毁抵扣
      // 同时处理同一批冻结收入时，把已被抵扣删除或改动的旧快照解冻到账。
      const updateResult = await tx.hostingBalanceLog.updateMany({
        where: {
          id: { in: lockedRecordIds },
          frozen: true,
          unfreezeAt: { lte: now }
        },
        data: { frozen: false }
      })

      if (updateResult.count !== lockedRecordIds.length) {
        throw new Error('部分托管冻结收入已被其他任务处理，请重试解冻')
      }

      // 逐用户更新托管余额
      for (const [userId, amount] of lockedAmounts) {
        await tx.user.update({
          where: { id: userId },
          data: { hostingBalance: { increment: amount } }
        })
        console.log(`[Hosting] Unfroze ${amount} for user ${userId}`)
      }
    })

    const duration = Date.now() - startTime
    console.log(`[Hosting] Unfreeze job completed in ${duration}ms, processed ${frozenRecords.length} records`)
  } catch (error) {
    console.error('[Hosting] Unfreeze job failed:', error)
  }
}

// ==================== 调度器启动 ====================

/**
 * 启动托管余额调度器
 */
export function startHostingScheduler(): void {
  if (schedulerStarted) {
    return
  }

  schedulerStarted = true

  console.log('[Hosting] Starting hosting scheduler...')

  // 每小时执行一次解冻任务（每小时第0分钟）
  schedule('0 * * * *', unfreezeHostingBalance, {
    timezone: 'Asia/Shanghai'
  })

  console.log('[Hosting] Hosting scheduler started')
  console.log('[Hosting] - Unfreeze: Every hour at minute 0')
}

/**
 * 手动执行解冻任务（用于测试或管理员手动触发）
 */
export async function runUnfreezeNow(): Promise<{ processed: number }> {
  console.log('[Hosting] Manual unfreeze triggered')
  
  const now = new Date()
  const frozenRecords = await prisma.hostingBalanceLog.findMany({
    where: {
      frozen: true,
      unfreezeAt: { lte: now }
    }
  })

  if (frozenRecords.length === 0) {
    return { processed: 0 }
  }

  await unfreezeHostingBalance()
  return { processed: frozenRecords.length }
}

/**
 * 获取待解冻的记录统计
 */
export async function getPendingUnfreezeStats(): Promise<{
  total: number
  totalAmount: number
  nextUnfreezeAt: Date | null
}> {
  // 获取所有待解冻记录
  const result = await prisma.hostingBalanceLog.aggregate({
    where: { frozen: true },
    _count: { id: true },
    _sum: { amount: true },
    _min: { unfreezeAt: true }
  })

  return {
    total: result._count.id || 0,
    totalAmount: Number(result._sum.amount || 0),
    nextUnfreezeAt: result._min.unfreezeAt
  }
}
