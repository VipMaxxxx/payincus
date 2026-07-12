/**
 * 邮箱订阅过期检查定时任务
 * 检查并处理已过期的邮箱订阅
 */

import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { getMailSourceById } from '../db/mail.js'
import * as craneMailService from './cranemail.js'

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

    if (expiredSubscriptions.length > 0) {
      console.log(`[Mail] Found ${expiredSubscriptions.length} expired mail subscription candidate(s)`)
    }

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

    // 同时重试历史 expired 订阅：上游 suspend 是幂等操作，本地 expired 状态即待重试依据。
    const subscriptionsToSuspend = await prisma.mailSubscription.findMany({
      where: {
        status: 'expired',
        expiresAt: { lt: now }
      },
      select: {
        id: true,
        userId: true,
        sourceId: true,
        domains: {
          where: { status: { not: 'suspended' } },
          select: { id: true, domain: true, verifiedAt: true }
        }
      }
    })

    for (const subscription of subscriptionsToSuspend) {
      let source
      try {
        source = await getMailSourceById(subscription.sourceId)
      } catch (error) {
        console.error(`[Mail] Cannot load source for expired subscription #${subscription.id}:`, error)
        await createLog(subscription.userId, 'mail', 'mail_upstream_suspend_pending_retry', `Mail subscription #${subscription.id} source could not be loaded; upstream suspend pending retry`, 'failed')
        continue
      }
      if (!source) {
        console.error(`[Mail] Cannot suspend expired subscription #${subscription.id}: source not found`)
        await createLog(subscription.userId, 'mail', 'mail_upstream_suspend_pending_retry', `Mail subscription #${subscription.id} source is unavailable; upstream suspend pending retry`, 'failed')
        continue
      }

      for (const domain of subscription.domains) {
        // 续费可能与调度并发；每次外呼前重新确认仍然过期。
        const stillExpired = await prisma.mailSubscription.findFirst({
          where: { id: subscription.id, status: 'expired', expiresAt: { lt: now } },
          select: { id: true }
        })
        if (!stillExpired) break

        try {
          await craneMailService.suspendDomain(source, domain.domain)
        } catch (error) {
          console.error(`[Mail] Failed to suspend expired mail domain ${domain.domain}; pending retry:`, error)
          await createLog(subscription.userId, 'mail', 'mail_upstream_suspend_pending_retry', `Upstream suspend pending retry for mail domain ${domain.domain}`, 'failed')
          continue
        }

        const markedSuspended = await prisma.mailDomain.updateMany({
          where: {
            id: domain.id,
            subscription: { status: 'expired', expiresAt: { lt: now } }
          },
          data: { status: 'suspended' }
        })

        // 若续费恰好发生在 suspend 外呼期间，立即补偿恢复，最终以上游可用为准。
        if (markedSuspended.count === 0) {
          const renewed = await prisma.mailSubscription.findFirst({
            where: { id: subscription.id, status: 'active', expiresAt: { gt: new Date() } },
            select: { id: true }
          })
          if (!renewed) continue

          try {
            await craneMailService.resumeDomain(source, domain.domain)
            await prisma.mailDomain.updateMany({
              where: {
                id: domain.id,
                subscription: { status: 'active', expiresAt: { gt: new Date() } }
              },
              data: { status: domain.verifiedAt ? 'verified' : 'pending' }
            })
          } catch (error) {
            console.error(`[Mail] Failed to compensate resumed mail domain ${domain.domain}; pending retry:`, error)
            await prisma.mailDomain.updateMany({
              where: {
                id: domain.id,
                subscription: { status: 'active', expiresAt: { gt: new Date() } }
              },
              data: { status: 'suspended' }
            })
            await createLog(subscription.userId, 'mail', 'mail_upstream_resume_pending_retry', `Upstream resume pending retry for mail domain ${domain.domain}`, 'failed')
          }
        }
      }
    }

    // 续费恢复失败的域名以 suspended 作为持久待重试标记；成功后按 verifiedAt 还原状态。
    const subscriptionsToResume = await prisma.mailSubscription.findMany({
      where: {
        status: 'active',
        expiresAt: { gt: new Date() },
        domains: { some: { status: 'suspended' } }
      },
      select: {
        id: true,
        userId: true,
        sourceId: true,
        domains: {
          where: { status: 'suspended' },
          select: { id: true, domain: true, verifiedAt: true }
        }
      }
    })

    for (const subscription of subscriptionsToResume) {
      let source
      try {
        source = await getMailSourceById(subscription.sourceId)
      } catch (error) {
        console.error(`[Mail] Cannot load source for renewed subscription #${subscription.id}:`, error)
        await createLog(subscription.userId, 'mail', 'mail_upstream_resume_pending_retry', `Mail subscription #${subscription.id} source could not be loaded; upstream resume pending retry`, 'failed')
        continue
      }
      if (!source) continue

      for (const domain of subscription.domains) {
        try {
          await craneMailService.resumeDomain(source, domain.domain)
          await prisma.mailDomain.updateMany({
            where: {
              id: domain.id,
              status: 'suspended',
              subscription: { status: 'active', expiresAt: { gt: new Date() } }
            },
            data: { status: domain.verifiedAt ? 'verified' : 'pending' }
          })
        } catch (error) {
          console.error(`[Mail] Failed to resume renewed mail domain ${domain.domain}; pending retry:`, error)
          await createLog(subscription.userId, 'mail', 'mail_upstream_resume_pending_retry', `Upstream resume pending retry for mail domain ${domain.domain}`, 'failed')
        }
      }
    }
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
