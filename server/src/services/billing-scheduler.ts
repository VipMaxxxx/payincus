/**
 * 计费调度器
 * 负责定时执行自动续费、到期封停、到期删除、到期提醒等任务
 */

import { schedule } from 'node-cron'
import pLimit from 'p-limit'
import { prisma } from '../db/prisma.js'
import * as db from '../db/index.js'
import { sendHostManagedInstanceNotification, sendNotification } from '../lib/notifier.js'
import { 
  sendExpiryReminderEmail, 
  sendAutoRenewSuccessEmail, 
  sendAutoRenewFailedEmail 
} from '../lib/mailer.js'
import { createLog } from '../db/logs.js'
import {
  performRenewal,
  calculateRenewBilling
} from '../db/billing-operations.js'
import {
  getAutoRenewInstances,
  getExpiredUnsuspendedInstances,
  getSuspendedInstancesOlderThan,
  suspendInstanceByExpiry,
  updateAutoRenewAttempt,
  updateExpiryNotifiedAt
} from '../db/instance-suspend.js'
import { deleteInstance as deleteIncusInstance, getIncusClient } from '../lib/incus/index.js'
import { rollbackResources } from '../db/index.js'
import { sendReleaseNotification } from '../lib/release-notifier.js'
import { acquireLock, releaseLock } from '../lib/distributed-lock.js'

// 并发限制
const limit = pLimit(5)

// 配置常量
const AUTO_RENEW_HOURS_BEFORE = 24 // 到期前24小时尝试自动续费
const AUTO_RENEW_MAX_ATTEMPTS = 3 // 最大自动续费尝试次数
const SUSPEND_AFTER_DELETE_DAYS = 3 // 封停后3天自动删除
const EXPIRY_NOTIFY_DAYS = [3] // 仅在到期前3天提醒一次
const INSTANCE_BILLING_JOB_LOCK_EXPIRE_MS = 30 * 60 * 1000
const INSTANCE_BILLING_JOB_LOCK_WAIT_MS = 100
let schedulerStarted = false

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withInstanceBillingJobLock(
  purpose: 'auto-renew' | 'expiry-suspend' | 'expiry-delete' | 'expiry-notify',
  instanceId: number,
  fn: () => Promise<void>
): Promise<void> {
  const lockKey = `billing:${purpose}:instance:${instanceId}`
  const lock = await acquireLock(lockKey, {
    expireMs: INSTANCE_BILLING_JOB_LOCK_EXPIRE_MS,
    waitTimeoutMs: INSTANCE_BILLING_JOB_LOCK_WAIT_MS,
    retryIntervalMs: 50
  })

  if (!lock.success || !lock.ownerId) {
    console.log(`[Billing] Skip ${purpose} for instance ${instanceId}: lock not acquired`)
    return
  }

  try {
    await fn()
  } finally {
    await releaseLock(lockKey, lock.ownerId)
  }
}

function buildAutoRenewAttemptGuard(instance: any, now: Date, expiryThreshold: Date) {
  return {
    now,
    expiryThreshold,
    version: instance.version,
    currentAttempts: instance.autoRenewAttempts || 0
  }
}

// ==================== 自动续费任务 ====================

/**
 * 执行自动续费
 */
async function executeAutoRenew(): Promise<void> {
  console.log('[Billing] Starting auto-renew job...')
  const startTime = Date.now()

  try {
    // 获取24小时内到期且开启了自动续费的实例
    const instances = await getAutoRenewInstances(AUTO_RENEW_HOURS_BEFORE)

    console.log(`[Billing] Found ${instances.length} instances for auto-renew`)

    // 并发处理
    await Promise.all(
      instances.map(instance =>
        limit(() => withInstanceBillingJobLock('auto-renew', instance.id, () => processAutoRenew(instance)))
      )
    )

    const duration = Date.now() - startTime
    console.log(`[Billing] Auto-renew job completed in ${duration}ms`)
  } catch (error) {
    console.error('[Billing] Auto-renew job failed:', error)
  }
}

/**
 * 处理单个实例的自动续费
 */
async function processAutoRenew(instance: any): Promise<void> {
  const now = new Date()
  const expiryThreshold = new Date(now.getTime() + AUTO_RENEW_HOURS_BEFORE * 60 * 60 * 1000)
  const latestInstance = await prisma.instance.findUnique({
    where: { id: instance.id }
  })
  if (
    !latestInstance ||
    !latestInstance.autoRenew ||
    !latestInstance.expiresAt ||
    latestInstance.expiresAt <= now ||
    latestInstance.expiresAt > expiryThreshold ||
    latestInstance.status === 'suspended' ||
    latestInstance.status === 'deleted'
  ) {
    console.log(`[Billing] Skip auto-renew for instance ${instance.id}: no longer eligible`)
    return
  }

  instance = latestInstance
  const attempts = (instance.autoRenewAttempts || 0) + 1
  const attemptGuard = buildAutoRenewAttemptGuard(instance, now, expiryThreshold)

  // 检查是否超过最大尝试次数
  if (attempts > AUTO_RENEW_MAX_ATTEMPTS) {
    console.log(`[Billing] Instance ${instance.id} exceeded max auto-renew attempts, disabling`)
    const attemptClaimed = await updateAutoRenewAttempt(instance.id, attempts, true, attemptGuard)
    if (!attemptClaimed) {
      console.log(`[Billing] Skip max-attempt update for instance ${instance.id}: no longer eligible`)
    }
    return
  }

  try {
    // 按原计费周期续费（如季付续3个月）
    const renewMonths = instance.billingCycle || 1
    const renewInfo = calculateRenewBilling(instance, renewMonths)

    // 获取用户信息（包括邮箱）
    const user = await prisma.user.findUnique({
      where: { id: instance.userId },
      select: { balance: true, email: true, username: true }
    })

    if (!user) {
      console.log(`[Billing] User ${instance.userId} not found for instance ${instance.id}`)
      const attemptClaimed = await updateAutoRenewAttempt(instance.id, attempts, false, attemptGuard)
      if (!attemptClaimed) {
        console.log(`[Billing] Skip auto-renew attempt update for instance ${instance.id}: no longer eligible`)
      }
      return
    }

    const balance = Number(user.balance)

    // 余额不足
    if (balance < renewInfo.amount) {
      console.log(`[Billing] Insufficient balance for instance ${instance.id}: need ${renewInfo.amount}, have ${balance}`)
      const attemptClaimed = await updateAutoRenewAttempt(instance.id, attempts, false, attemptGuard)
      if (!attemptClaimed) {
        console.log(`[Billing] Skip auto-renew failure notification for instance ${instance.id}: no longer eligible`)
        return
      }

      // 发送自动续费失败站内通知
      await sendNotification(instance.userId, 'auto_renew_failed', {
        instanceName: instance.name,
        failReason: `余额不足（需要 ¥${renewInfo.amount.toFixed(2)}，当前 ¥${balance.toFixed(2)}）`,
        renewAmount: renewInfo.amount  // 元（calculateRenewBilling 返回的是元）
      })

      // 发送自动续费失败邮件
      if (user.email) {
        try {
          await sendAutoRenewFailedEmail(user.email, {
            username: user.username,
            instanceName: instance.name,
            failReason: `余额不足（需要 ¥${renewInfo.amount.toFixed(2)}，当前 ¥${balance.toFixed(2)}）`,
            currentAttempt: attempts,
            maxAttempts: AUTO_RENEW_MAX_ATTEMPTS,
            expiresAt: instance.expiresAt
          })
        } catch (emailErr) {
          console.warn(`[Billing] Failed to send auto-renew failed email:`, emailErr)
        }
      }

      await createLog(
        instance.userId,
        'instance',
        'instance.auto_renew_failed',
        `Auto-renew failed for instance "${instance.name}": insufficient balance`,
        'failed',
        { instanceId: instance.id }
      )
      return
    }

    // 执行续费
    const result = await performRenewal(instance.userId, instance, renewMonths)

    // 发送续费成功站内通知
    await sendNotification(instance.userId, 'instance_renewed', {
      instanceName: instance.name,
      renewAmount: result.amount,  // 元（performRenewal 返回的是元）
      renewMonths: renewMonths,
      newExpiresAt: result.newExpiresAt.toISOString()
    })

    if (result.hostingIncomeResult) {
      sendHostManagedInstanceNotification(
        instance.hostId,
        'renew',
        {
          username: user.username,
          instanceName: instance.name,
          amount: result.amount
        }
      ).catch(err => {
        console.warn('[Billing] Failed to send host renew notification:', err)
      })
    }

    // 发送自动续费成功邮件
    if (user.email) {
      try {
        // 获取续费后的余额
        const userAfter = await prisma.user.findUnique({
          where: { id: instance.userId },
          select: { balance: true }
        })
        const newBalance = Number(userAfter?.balance ?? 0)

        await sendAutoRenewSuccessEmail(user.email, {
          username: user.username,
          instanceName: instance.name,
          amount: result.amount,
          months: renewMonths,
          newExpiresAt: result.newExpiresAt,
          newBalance
        })
      } catch (emailErr) {
        console.warn(`[Billing] Failed to send auto-renew success email:`, emailErr)
      }
    }

    await createLog(
      instance.userId,
      'instance',
      'instance.auto_renew',
      `Auto-renewed instance "${instance.name}" for ${renewMonths} month(s), amount: ${result.amount}`,
      'success',
      { instanceId: instance.id }
    )

    console.log(`[Billing] Auto-renewed instance ${instance.id}`)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Billing] Auto-renew failed for instance ${instance.id}:`, errorMessage)
    const attemptClaimed = await updateAutoRenewAttempt(instance.id, attempts, false, attemptGuard)
    if (!attemptClaimed) {
      console.log(`[Billing] Skip auto-renew failure notification for instance ${instance.id}: no longer eligible`)
      return
    }

    // 发送失败站内通知
    await sendNotification(instance.userId, 'auto_renew_failed', {
      instanceName: instance.name,
      failReason: errorMessage
    })

    // 发送自动续费失败邮件
    const userForEmail = await prisma.user.findUnique({
      where: { id: instance.userId },
      select: { email: true, username: true }
    })
    if (userForEmail?.email) {
      try {
        await sendAutoRenewFailedEmail(userForEmail.email, {
          username: userForEmail.username,
          instanceName: instance.name,
          failReason: errorMessage,
          currentAttempt: attempts,
          maxAttempts: AUTO_RENEW_MAX_ATTEMPTS,
          expiresAt: instance.expiresAt
        })
      } catch (emailErr) {
        console.warn(`[Billing] Failed to send auto-renew failed email:`, emailErr)
      }
    }

    await createLog(
      instance.userId,
      'instance',
      'instance.auto_renew_failed',
      `Auto-renew failed for instance "${instance.name}": ${errorMessage}`,
      'failed',
      { instanceId: instance.id }
    )
  }
}

// ==================== 到期封停任务 ====================

/**
 * 执行到期封停
 */
async function executeExpirySuspend(): Promise<void> {
  console.log('[Billing] Starting expiry suspend job...')
  const startTime = Date.now()

  try {
    // 获取已到期但未封停的实例
    const instances = await getExpiredUnsuspendedInstances()

    console.log(`[Billing] Found ${instances.length} expired instances to suspend`)

    // 并发处理
    await Promise.all(
      instances.map(instance =>
        limit(() => withInstanceBillingJobLock('expiry-suspend', instance.id, () => processExpirySuspend(instance)))
      )
    )

    const duration = Date.now() - startTime
    console.log(`[Billing] Expiry suspend job completed in ${duration}ms`)
  } catch (error) {
    console.error('[Billing] Expiry suspend job failed:', error)
  }
}

/**
 * 处理单个实例的到期封停
 */
async function processExpirySuspend(instance: any): Promise<void> {
  try {
    // 封停实例
    const suspendedInstance = await suspendInstanceByExpiry(instance.id)
    if (!suspendedInstance) {
      console.log(`[Billing] Skip expiry suspend for instance ${instance.id}: no longer expired or already processed`)
      return
    }

    // 尝试停止 Incus 实例
    try {
      const host = await db.getHostById(suspendedInstance.hostId)
      if (host) {
        const client = await getIncusClient(host)
        const { stopInstance } = await import('../lib/incus/index.js')
        await stopInstance(client, suspendedInstance.incusId, true) // force stop
      }
    } catch (stopError) {
      // 停止失败不影响封停逻辑
      console.log(`[Billing] Failed to stop Incus instance ${suspendedInstance.incusId}:`, stopError)
    }

    // 发送封停通知
    await sendNotification(suspendedInstance.userId, 'instance_suspended', {
      instanceName: suspendedInstance.name,
      suspendReason: '实例已到期'
    })

    await createLog(
      suspendedInstance.userId,
      'instance',
      'instance.suspended_expired',
      `Instance "${suspendedInstance.name}" suspended due to expiry`,
      'success',
      { instanceId: suspendedInstance.id }
    )

    console.log(`[Billing] Suspended expired instance ${suspendedInstance.id}`)

  } catch (error) {
    console.error(`[Billing] Failed to suspend instance ${instance.id}:`, error)
  }
}

// ==================== 到期删除任务 ====================

async function restoreExpiryDeleteClaim(instance: any): Promise<void> {
  await prisma.instance.updateMany({
    where: {
      id: instance.id,
      status: 'deleted'
    },
    data: {
      status: 'suspended',
      version: { increment: 1 }
    }
  })
}

/**
 * 执行到期删除（封停超过3天的实例）
 */
async function executeExpiryDelete(): Promise<void> {
  console.log('[Billing] Starting expiry delete job...')
  const startTime = Date.now()

  try {
    // 获取封停超过3天的实例（仅限到期封停的）
    const instances = await getSuspendedInstancesOlderThan(SUSPEND_AFTER_DELETE_DAYS)

    // 过滤出到期封停的（非手动封停）
    const expiredInstances = instances.filter(i => i.suspendReason === 'expired')

    console.log(`[Billing] Found ${expiredInstances.length} expired instances to delete`)

    // 串行处理删除（避免并发问题）
    for (const instance of expiredInstances) {
      await withInstanceBillingJobLock('expiry-delete', instance.id, () => processExpiryDelete(instance))
      await delay(1000) // 间隔1秒
    }

    const duration = Date.now() - startTime
    console.log(`[Billing] Expiry delete job completed in ${duration}ms`)
  } catch (error) {
    console.error('[Billing] Expiry delete job failed:', error)
  }
}

/**
 * 处理单个实例的到期删除
 */
async function processExpiryDelete(instance: any): Promise<void> {
  try {
    const deleteThreshold = new Date()
    deleteThreshold.setDate(deleteThreshold.getDate() - SUSPEND_AFTER_DELETE_DAYS)

    const claimResult = await prisma.instance.updateMany({
      where: {
        id: instance.id,
        version: instance.version,
        status: 'suspended',
        suspendReason: 'expired',
        suspendedAt: {
          not: null,
          lt: deleteThreshold
        }
      },
      data: {
        status: 'deleted',
        version: { increment: 1 }
      }
    })

    if (claimResult.count === 0) {
      console.log(`[Billing] Skip expiry delete for instance ${instance.id}: no longer eligible or already processed`)
      return
    }

    const host = await db.getHostById(instance.hostId)
    if (!host) {
      await restoreExpiryDeleteClaim(instance)
      console.log(`[Billing] Skip expiry delete for instance ${instance.id}: host not found`)
      return
    }

    try {
      const client = await getIncusClient(host)
      await deleteIncusInstance(client, instance.incusId)
    } catch (incusError) {
      await restoreExpiryDeleteClaim(instance)
      console.log(`[Billing] Failed to delete Incus instance ${instance.incusId}, restored expired suspension:`, incusError)
      return
    }

    const portMappingsCount = await prisma.portMapping.count({
      where: { instanceId: instance.id }
    })

    // 回滚实例资源
    await rollbackResources({
      hostId: instance.hostId,
      cpu: instance.cpu,
      memory: instance.memory,
      disk: instance.disk,
      portCount: portMappingsCount
    })

    // 删除数据库记录（级联删除关联数据）
    await prisma.instance.delete({
      where: { id: instance.id }
    })

    // 数据库级联删除后，以实例和端口映射事实重新校准宿主机资源计数
    const usedResources = await db.calculateHostResourcesFromInstances(instance.hostId)
    const actualPortsUsed = await prisma.portMapping.count({
      where: {
        instance: {
          hostId: instance.hostId,
          status: { not: 'deleted' }
        }
      }
    })
    await db.updateHostResources(instance.hostId, {
      cpuUsed: usedResources.cpuUsed,
      memoryUsed: usedResources.memoryUsed,
      diskUsed: usedResources.diskUsed
    })
    await prisma.host.update({
      where: { id: instance.hostId },
      data: { natPortsUsedCount: actualPortsUsed }
    })

    // 发送删除通知
    await sendNotification(instance.userId, 'instance_deleted', {
      instanceName: instance.name
    })

    await createLog(
      instance.userId,
      'instance',
      'instance.deleted_expired',
      `Instance "${instance.name}" automatically deleted after ${SUSPEND_AFTER_DELETE_DAYS} days of suspension`,
      'success'
    )

    console.log(`[Billing] Deleted expired instance ${instance.id}`)

    // 向套餐绑定的通知渠道发送"资源释放"通知
    if (instance.packageId) {
      sendReleaseNotification({
        packageId: instance.packageId,
        cpu: instance.cpu,
        memory: instance.memory,
        source: '实例过期自动删除'
      }).catch(() => {})
    }

  } catch (error) {
    console.error(`[Billing] Failed to delete instance ${instance.id}:`, error)
  }
}

// ==================== 到期提醒任务 ====================

/**
 * 执行到期提醒（邮件）
 */
async function executeExpiryNotify(): Promise<void> {
  console.log('[Billing] Starting expiry notify job...')
  const startTime = Date.now()

  try {
    // 对每个提醒时间点检查（天数）
    for (const days of EXPIRY_NOTIFY_DAYS) {
      await notifyExpiringInstances(days)
    }

    const duration = Date.now() - startTime
    console.log(`[Billing] Expiry notify job completed in ${duration}ms`)
  } catch (error) {
    console.error('[Billing] Expiry notify job failed:', error)
  }
}

/**
 * 通知指定天数内到期的实例（发送邮件）
 */
async function notifyExpiringInstances(days: number): Promise<void> {
  const now = new Date()
  // 计算天数范围（前后12小时窗口）
  const minThreshold = new Date(now.getTime() + (days * 24 - 12) * 60 * 60 * 1000)
  const maxThreshold = new Date(now.getTime() + (days * 24 + 12) * 60 * 60 * 1000)

  // 查询在指定时间窗口内到期的实例
  const instances = await prisma.instance.findMany({
    where: {
      expiresAt: {
        gte: minThreshold,
        lt: maxThreshold
      },
      autoRenew: false,
      status: { notIn: ['suspended', 'deleted'] },
      // 在过去24小时内没有发送过通知
      OR: [
        { expiryNotifiedAt: null },
        { expiryNotifiedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }
      ]
    },
    include: {
      user: {
        select: { email: true, username: true }
      }
    }
  })

  console.log(`[Billing] Found ${instances.length} instances expiring in ${days} days`)

  // 并发发送邮件通知
  await Promise.all(
    instances.map(instance =>
      limit(() => withInstanceBillingJobLock('expiry-notify', instance.id, async () => {
        try {
          const daysRemaining = days

          const latest = await prisma.instance.findUnique({
            where: { id: instance.id },
            select: {
              expiryNotifiedAt: true,
              expiresAt: true,
              autoRenew: true,
              status: true
            }
          })
          const recentNotificationCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
          if (
            !latest ||
            latest.autoRenew ||
            !latest.expiresAt ||
            latest.expiresAt < minThreshold ||
            latest.expiresAt >= maxThreshold ||
            latest.status === 'suspended' ||
            latest.status === 'deleted'
          ) {
            console.log(`[Billing] Skip expiry notification for instance ${instance.id}: no longer eligible`)
            return
          }

          if (latest?.expiryNotifiedAt && latest.expiryNotifiedAt >= recentNotificationCutoff) {
            console.log(`[Billing] Skip expiry notification for instance ${instance.id}: already notified`)
            return
          }

          const notificationClaimed = await updateExpiryNotifiedAt(instance.id, {
            minExpiresAt: minThreshold,
            maxExpiresAt: maxThreshold,
            recentNotificationCutoff
          })
          if (!notificationClaimed) {
            console.log(`[Billing] Skip expiry notification for instance ${instance.id}: notification already claimed or no longer eligible`)
            return
          }

          // 发送站内通知
          await sendNotification(instance.userId, 'instance_expiring', {
            instanceName: instance.name,
            daysRemaining,
            newExpiresAt: latest.expiresAt.toISOString()
          })

          // 发送邮件通知
          if (instance.user?.email) {
            try {
              await sendExpiryReminderEmail(instance.user.email, {
                username: instance.user.username,
                instanceName: instance.name,
                daysRemaining,
                expiresAt: latest.expiresAt
              })
            } catch (emailErr) {
              console.warn(`[Billing] Failed to send expiry email for instance ${instance.id}:`, emailErr)
            }
          }

          console.log(`[Billing] Sent expiry notification for instance ${instance.id}`)
        } catch (error) {
          console.error(`[Billing] Failed to notify instance ${instance.id}:`, error)
        }
      }))
    )
  )
}

// ==================== 充值订单清理任务 ====================

/**
 * 清理过期的充值订单（pending状态且已过期）
 * 每小时执行，将过期订单标记为 cancelled
 */
async function cleanExpiredRechargeOrders(): Promise<void> {
  console.log('[Billing] Starting expired recharge orders cleanup job...')
  const startTime = Date.now()

  try {
    const result = await prisma.rechargeRecord.updateMany({
      where: {
        status: 'pending',
        expiredAt: { lt: new Date() }
      },
      data: {
        status: 'cancelled'
      }
    })

    const duration = Date.now() - startTime
    if (result.count > 0) {
      console.log(`[Billing] Cancelled ${result.count} expired recharge orders in ${duration}ms`)
    }
  } catch (error) {
    console.error('[Billing] Expired recharge orders cleanup failed:', error)
  }
}

/**
 * 清理旧的支付回调防重放记录（30天前）
 * 每天执行，避免数据无限增长
 */
async function cleanOldPaymentCallbacks(): Promise<void> {
  console.log('[Billing] Starting old payment callbacks cleanup job...')
  const startTime = Date.now()

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const result = await prisma.paymentCallback.deleteMany({
      where: {
        createdAt: { lt: thirtyDaysAgo }
      }
    })

    const duration = Date.now() - startTime
    if (result.count > 0) {
      console.log(`[Billing] Deleted ${result.count} old payment callback records in ${duration}ms`)
    }
  } catch (error) {
    console.error('[Billing] Old payment callbacks cleanup failed:', error)
  }
}

// ==================== 调度器入口 ====================

/**
 * 启动计费调度器
 */
export function startBillingScheduler(): void {
  if (schedulerStarted) {
    return
  }

  schedulerStarted = true

  // 每小时检查自动续费（整点）
  schedule('0 * * * *', () => {
    executeAutoRenew().catch(console.error)
  })

  // 每30分钟检查到期封停
  schedule('*/30 * * * *', () => {
    executeExpirySuspend().catch(console.error)
  })

  // 每天凌暨3点检查到期删除
  schedule('0 3 * * *', () => {
    executeExpiryDelete().catch(console.error)
  })

  // 每小时检查到期提醒
  schedule('15 * * * *', () => {
    executeExpiryNotify().catch(console.error)
  })

  // 每小时清理过期的充值订单（在 :30 执行）
  schedule('30 * * * *', () => {
    cleanExpiredRechargeOrders().catch(console.error)
  })

  // 每天凌晨 4:30 清理旧的支付回调防重放记录（30天前）
  schedule('30 4 * * *', () => {
    cleanOldPaymentCallbacks().catch(console.error)
  })

  console.log('[Billing] Scheduler started')
  console.log('[Billing] - Auto-renew: hourly at :00 (24h before expiry, max 3 attempts)')
  console.log('[Billing] - Expiry suspend: every 30 minutes')
  console.log('[Billing] - Expiry delete: daily at 03:00 (3 days after suspend)')
  console.log('[Billing] - Expiry notify (email): hourly at :15 (3 days before, auto-renew instances skipped)')
  console.log('[Billing] - Expired recharge cleanup: hourly at :30')
  console.log('[Billing] - Payment callback cleanup: daily at 04:30')
}

/**
 * 手动运行所有计费任务（用于测试）
 */
export async function runAllBillingJobs(): Promise<void> {
  await executeAutoRenew()
  await executeExpirySuspend()
  await executeExpiryDelete()
  await executeExpiryNotify()
}

// 导出单独的任务函数（用于测试）
export {
  executeAutoRenew,
  executeExpirySuspend,
  executeExpiryDelete,
  executeExpiryNotify,
  cleanExpiredRechargeOrders,
  cleanOldPaymentCallbacks
}
