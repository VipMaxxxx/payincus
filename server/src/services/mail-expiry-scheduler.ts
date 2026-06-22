/**
 * 邮箱订阅过期检查定时任务
 * 检查并处理已过期的邮箱订阅
 */

import { prisma } from '../db/prisma.js'

let schedulerInterval: NodeJS.Timeout | null = null

/**
 * 检查并更新过期的邮箱订阅
 */
export async function checkMailSubscriptionExpiry(): Promise<void> {
  const now = new Date()
  
  try {
    // 查找所有已过期但状态仍为 active 的订阅
    const expiredSubscriptions = await prisma.mailSubscription.findMany({
      where: {
        status: 'active',
        expiresAt: { lt: now }
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        user: { select: { username: true } }
      }
    })

    if (expiredSubscriptions.length === 0) {
      return
    }

    console.log(`[Mail] Found ${expiredSubscriptions.length} expired mail subscription candidate(s)`)

    // 批量更新状态为 expired。续费可能在 findMany 后发生，所以更新时必须重查 expiresAt。
    const result = await prisma.mailSubscription.updateMany({
      where: {
        id: { in: expiredSubscriptions.map(s => s.id) },
        status: 'active',
        expiresAt: { lt: now }
      },
      data: { status: 'expired' }
    })

    console.log(`[Mail] Updated ${result.count} mail subscriptions to expired status`)
  } catch (error) {
    console.error('[Mail] Error checking mail subscription expiry:', error)
    throw error
  }
}

/**
 * 启动邮箱订阅过期检查定时任务
 * 每小时执行一次
 */
export function startMailExpiryScheduler(): NodeJS.Timeout {
  if (schedulerInterval) {
    return schedulerInterval
  }

  const INTERVAL = 60 * 60 * 1000 // 1 小时

  console.log('[Mail] Starting mail subscription expiry scheduler')

  // 启动时立即执行一次
  checkMailSubscriptionExpiry().catch(err => {
    console.error('[Mail] Initial mail expiry check failed:', err)
  })

  // 设置定时执行
  schedulerInterval = setInterval(() => {
    checkMailSubscriptionExpiry().catch(err => {
      console.error('[Mail] Scheduled mail expiry check failed:', err)
    })
  }, INTERVAL)

  return schedulerInterval
}
