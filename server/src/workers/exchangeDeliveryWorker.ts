import { Prisma, type InstanceTaskStatus } from '@prisma/client'
import { customAlphabet } from 'nanoid'
import { prisma } from '../db/prisma.js'
import { createInstanceTask } from '../db/instance-tasks.js'
import { createLog } from '../db/logs.js'
import { getHostById } from '../db/hosts.js'
import { getIncusClient } from '../lib/incus/index.js'
import { removeDevice, stopInstance } from '../lib/incus/incus-instances.js'
import { renameInstance as renameIncusInstance } from '../lib/incus/incus-restore.js'
import { createCaddyClient } from '../lib/caddy-client.js'
import { closeInstanceSessions } from '../lib/terminal-proxy.js'
import { sendNotification } from '../lib/notifier.js'
import { releaseExchangeOrderEscrow } from '../services/exchange.js'

const POLL_INTERVAL_MS = 5000
const DELIVERY_BATCH_SIZE = 5
const exchangeInstanceSuffix = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)
const runningTaskIds = new Set<number>()
let workerInterval: ReturnType<typeof setInterval> | null = null
const DELIVERY_PROGRESS_STEPS = [
  'escrow_paid',
  'lock_instance',
  'freeze_seller_access',
  'cleanup_ssh_keys',
  'cleanup_terminal_sessions',
  'cleanup_console_tokens',
  'cleanup_network_bindings',
  'cleanup_snapshots_and_backups',
  'reinstall',
  'transfer_owner',
  'rebuild_billing',
  'reset_traffic_baseline',
  'complete'
] as const

interface DeliveryCleanupSummary extends Record<string, number> {
  terminalSessionsClosed: number
  portMappingsRemoved: number
  proxySitesRemoved: number
  snapshotsRemoved: number
  snapshotPoliciesRemoved: number
  backupPoliciesRemoved: number
  trafficSnapshotsRemoved: number
  dailyTrafficRowsRemoved: number
  resourceRiskStateRemoved: number
  resourceRiskEventsRemoved: number
  resourceRiskSamplesRemoved: number
}

function taskProgress(step: string, extra: Record<string, unknown> = {}) {
  return {
    steps: [...DELIVERY_PROGRESS_STEPS],
    current: step,
    ...extra
  }
}

async function setDeliveryProgress(
  taskId: number,
  step: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await prisma.exchangeDeliveryTask.update({
    where: { id: taskId },
    data: {
      step,
      progress: taskProgress(step, extra)
    }
  })
}

function buildBuyerIncusId(buyerUserId: number): string {
  return `u${buyerUserId}-${exchangeInstanceSuffix()}`
}

function buildExchangeDisplayName(orderNo: string): string {
  return `exchange-${orderNo.toLowerCase()}`.slice(0, 64)
}

async function cleanupLegacyAccess(instanceId: number): Promise<DeliveryCleanupSummary> {
  const terminalSessionsClosed = closeInstanceSessions(instanceId, 'Instance is being delivered through exchange')

  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: { id: true, incusId: true, hostId: true }
  })
  if (!instance) throw new Error('交割实例不存在')

  const host = await getHostById(instance.hostId)
  if (!host) throw new Error('交割节点不存在')

  const client = await getIncusClient(host)
  const portMappings = await prisma.portMapping.findMany({ where: { instanceId } })
  for (const mapping of portMappings) {
    const deviceName = `proxy-${mapping.protocol}-${mapping.publicPort}`
    await removeDevice(client, instance.incusId, deviceName)
    await removeDevice(client, instance.incusId, `${deviceName}-v6`)
  }
  const portMappingsRemoved = portMappings.length > 0
    ? (await prisma.portMapping.deleteMany({ where: { instanceId } })).count
    : 0

  const proxySites = await prisma.proxySite.findMany({
    where: { instanceId },
    include: {
      host: {
        select: {
          natPublicIp: true,
          ipAddress: true,
          caddyEnabled: true,
          caddyUsername: true,
          caddyPassword: true,
          caddyPort: true
        }
      }
    }
  })
  for (const site of proxySites) {
    if (!site.host.caddyEnabled || !site.host.caddyUsername || !site.host.caddyPassword) continue
    const targetHost = site.host.natPublicIp || site.host.ipAddress || ''
    if (!targetHost) continue
    const caddy = createCaddyClient({
      host: targetHost,
      port: site.host.caddyPort || 8444,
      username: site.host.caddyUsername,
      password: site.host.caddyPassword
    })
    await caddy.deleteSite(site.domain)
  }
  const proxySitesRemoved = proxySites.length > 0
    ? (await prisma.proxySite.deleteMany({ where: { instanceId } })).count
    : 0

  const [
    snapshotsRemoved,
    snapshotPoliciesRemoved,
    backupPoliciesRemoved,
    trafficSnapshotsRemoved,
    dailyTrafficRowsRemoved,
    resourceRiskStateRemoved,
    resourceRiskEventsRemoved,
    resourceRiskSamplesRemoved
  ] = await Promise.all([
    prisma.snapshot.deleteMany({ where: { instanceId } }),
    prisma.snapshotPolicy.deleteMany({ where: { instanceId } }),
    prisma.backupPolicy.deleteMany({ where: { instanceId } }),
    prisma.trafficSnapshot.deleteMany({ where: { instanceId } }),
    prisma.dailyTraffic.deleteMany({ where: { instanceId } }),
    prisma.instanceRiskState.deleteMany({ where: { instanceId } }),
    prisma.instanceRiskEvent.deleteMany({ where: { instanceId } }),
    prisma.instanceResourceSample.deleteMany({ where: { instanceId } })
  ])

  return {
    terminalSessionsClosed,
    portMappingsRemoved,
    proxySitesRemoved,
    snapshotsRemoved: snapshotsRemoved.count,
    snapshotPoliciesRemoved: snapshotPoliciesRemoved.count,
    backupPoliciesRemoved: backupPoliciesRemoved.count,
    trafficSnapshotsRemoved: trafficSnapshotsRemoved.count,
    dailyTrafficRowsRemoved: dailyTrafficRowsRemoved.count,
    resourceRiskStateRemoved: resourceRiskStateRemoved.count,
    resourceRiskEventsRemoved: resourceRiskEventsRemoved.count,
    resourceRiskSamplesRemoved: resourceRiskSamplesRemoved.count
  }
}

async function markDeliveryFailed(taskId: number, message: string): Promise<void> {
  const notice = await prisma.$transaction(async tx => {
    const task = await tx.exchangeDeliveryTask.findUnique({
      where: { id: taskId },
      include: { order: true, instance: { select: { name: true } } }
    })
    if (!task) return
    const alreadyFailed = task.status === 'FAILED' && task.order.status === 'manual_review'
    await tx.exchangeDeliveryTask.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        step: 'manual_review',
        progress: taskProgress('manual_review', { error: message }),
        error: message,
        finishedAt: new Date()
      }
    })
    await tx.exchangeOrder.update({
      where: { id: task.orderId },
      data: {
        status: 'manual_review',
        failureReason: message
      }
    })
    await tx.exchangeListing.update({
      where: { id: task.order.listingId },
      data: { status: 'delivery_failed' }
    })
    await tx.exchangeAuditLog.create({
      data: {
        actorUserId: null,
        action: 'delivery.failed',
        targetType: 'exchange_delivery_task',
        targetId: taskId,
        detail: {
          orderId: task.orderId,
          instanceId: task.instanceId,
          error: message,
          buyerUserId: task.buyerUserId,
          sellerUserId: task.sellerUserId,
          notificationSkipped: alreadyFailed
        }
      }
    })
    if (alreadyFailed) return null
    return {
      buyerUserId: task.buyerUserId,
      sellerUserId: task.sellerUserId,
      orderNo: task.order.orderNo,
      instanceId: task.instanceId,
      instanceName: task.instance.name,
      error: message
    }
  })
  if (!notice) return
  await createLog(notice.buyerUserId, 'exchange', 'exchange.delivery.failed', `交易所订单 ${notice.orderNo} 交割异常：${notice.error}`, 'failed', { instanceId: notice.instanceId })
  await createLog(notice.sellerUserId, 'exchange', 'exchange.delivery.failed', `交易所订单 ${notice.orderNo} 交割异常，等待平台处理`, 'failed', { instanceId: notice.instanceId })
  const notificationData = {
    orderNo: notice.orderNo,
    instanceName: notice.instanceName,
    error: notice.error
  }
  await sendNotification(notice.buyerUserId, 'exchange_delivery_failed', notificationData)
  await sendNotification(notice.sellerUserId, 'exchange_delivery_failed', notificationData)
}

async function enqueueReinstall(taskId: number): Promise<void> {
  const task = await prisma.exchangeDeliveryTask.findUnique({
    where: { id: taskId },
    include: {
      order: true,
      instance: {
        select: {
          id: true,
          userId: true,
          hostId: true,
          status: true,
          image: true,
          name: true
        }
      }
    }
  })
  if (!task) return
  if (task.order.status !== 'delivering') {
    throw new Error(`订单状态不是交割中：${task.order.status}`)
  }
  if (task.instance.userId !== task.sellerUserId) {
    throw new Error('实例归属已变化，交割需人工处理')
  }
  if (task.instance.status !== 'stopped') {
    throw new Error('上架交易所的实例必须保持暂停状态才能交割')
  }

  await setDeliveryProgress(taskId, 'freeze_seller_access')
  await setDeliveryProgress(taskId, 'cleanup_terminal_sessions')
  await setDeliveryProgress(taskId, 'cleanup_network_bindings')
  await setDeliveryProgress(taskId, 'cleanup_snapshots_and_backups')
  const cleanupSummary = await cleanupLegacyAccess(task.instanceId)
  await setDeliveryProgress(taskId, 'cleanup_ssh_keys', {
    sshAuthorizedKeysClearedByForcedReinstall: true
  })
  await setDeliveryProgress(taskId, 'cleanup_console_tokens', {
    consoleCloudInitTokensClearedByForcedReinstall: true
  })
  await prisma.exchangeAuditLog.create({
    data: {
      actorUserId: null,
      action: 'delivery.cleanup_access',
      targetType: 'exchange_delivery_task',
      targetId: taskId,
      detail: {
        orderId: task.orderId,
        instanceId: task.instanceId,
        cleanupSummary,
        closedTerminalSessions: cleanupSummary.terminalSessionsClosed,
        removedPortMappings: cleanupSummary.portMappingsRemoved,
        removedProxySites: cleanupSummary.proxySitesRemoved,
        removedSnapshots: cleanupSummary.snapshotsRemoved,
        removedSnapshotPolicies: cleanupSummary.snapshotPoliciesRemoved,
        removedBackupPolicies: cleanupSummary.backupPoliciesRemoved,
	        removedTrafficSnapshots: cleanupSummary.trafficSnapshotsRemoved,
	        removedDailyTrafficRows: cleanupSummary.dailyTrafficRowsRemoved,
	        removedResourceRiskState: cleanupSummary.resourceRiskStateRemoved,
	        removedResourceRiskEvents: cleanupSummary.resourceRiskEventsRemoved,
	        removedResourceRiskSamples: cleanupSummary.resourceRiskSamplesRemoved,
	        sellerAccessFrozen: true,
	        sshAuthorizedKeysClearedByForcedReinstall: true,
	        consoleCloudInitTokensClearedByForcedReinstall: true,
	        note: 'Seller access is frozen by the exchange lock; SSH authorized_keys, root password, and console cloud-init data are replaced by the forced reinstall task before buyer delivery'
	      }
	    }
	  })

  const instanceTask = await createInstanceTask({
    instanceId: task.instanceId,
    hostId: task.instance.hostId,
    userId: task.buyerUserId,
    taskType: 'rebuild',
    imageAlias: task.imageAlias || task.instance.image,
    sshKeyId: task.sshKeyId || undefined,
    allowExchangeLocked: true
  })

  await prisma.exchangeDeliveryTask.update({
    where: { id: taskId },
    data: {
      instanceTaskId: instanceTask.id,
      step: 'reinstall',
      progress: taskProgress('reinstall', { instanceTaskId: instanceTask.id })
    }
  })
	  await prisma.exchangeAuditLog.create({
	    data: {
	      actorUserId: null,
	      action: 'delivery.reinstall_queued',
	      targetType: 'exchange_delivery_task',
	      targetId: taskId,
	      detail: {
	        instanceTaskId: instanceTask.id,
	        instanceId: task.instanceId,
	        imageAlias: task.imageAlias || task.instance.image,
	        buyerSshKeyId: task.sshKeyId || null,
	        buyerSshKeyWillBeInjected: !!task.sshKeyId,
	        newRootPasswordWillBeGenerated: true
	      }
	    }
	  })
}

async function finalizeDelivery(taskId: number): Promise<void> {
  const renameContext = await prisma.exchangeDeliveryTask.findUnique({
    where: { id: taskId },
    include: {
      order: { select: { orderNo: true, status: true } },
      instanceTask: { select: { status: true } },
      instance: { select: { id: true, incusId: true, hostId: true } }
    }
  })
  if (!renameContext) return
  if (renameContext.status !== 'PROCESSING') return
  if (!renameContext.instanceTask || renameContext.instanceTask.status !== 'COMPLETED') {
    throw new Error('实例重装任务尚未完成')
  }
  if (!['delivering', 'manual_review'].includes(renameContext.order.status)) {
    throw new Error(`订单状态不能完成交割：${renameContext.order.status}`)
  }
  const oldIncusId = renameContext.instance.incusId
  const newIncusId = buildBuyerIncusId(renameContext.buyerUserId)
  const newDisplayName = buildExchangeDisplayName(renameContext.order.orderNo)
  const host = await getHostById(renameContext.instance.hostId)
  if (!host) throw new Error('交割节点不存在，无法重命名实例')
  const client = await getIncusClient(host)
  await stopInstance(client, oldIncusId, true)
  await renameIncusInstance(client, oldIncusId, newIncusId)

  try {
    await prisma.$transaction(async tx => {
      const task = await tx.exchangeDeliveryTask.findUnique({
        where: { id: taskId },
        include: {
          order: true,
          instanceTask: true,
          instance: { select: { expiresAt: true } }
        }
      })
      if (!task) return
      if (task.status !== 'PROCESSING') return
      if (!task.instanceTask || task.instanceTask.status !== 'COMPLETED') {
        throw new Error('实例重装任务尚未完成')
      }
      if (!['delivering', 'manual_review'].includes(task.order.status)) {
        throw new Error(`订单状态不能完成交割：${task.order.status}`)
      }

      const [
        portMappingsRemoved,
        proxySitesRemoved,
        snapshotsRemoved,
        snapshotPoliciesRemoved,
        backupPoliciesRemoved,
        trafficSnapshotsRemoved,
        dailyTrafficRowsRemoved,
        resourceRiskStateRemoved,
        resourceRiskEventsRemoved,
        resourceRiskSamplesRemoved,
        affBindingsRemoved,
        cancelledTransfers
      ] = await Promise.all([
        tx.portMapping.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.proxySite.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.snapshot.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.snapshotPolicy.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.backupPolicy.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.trafficSnapshot.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.dailyTraffic.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.instanceRiskState.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.instanceRiskEvent.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.instanceResourceSample.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.affBinding.deleteMany({ where: { instanceId: task.instanceId } }),
        tx.instanceTransfer.updateMany({
          where: { instanceId: task.instanceId, status: { in: ['pending', 'processing'] } },
          data: { status: 'cancelled', cancelledAt: new Date() }
        })
      ])

      const deliveredAt = new Date()
      await tx.instance.update({
        where: { id: task.instanceId },
        data: {
          userId: task.buyerUserId,
          incusId: newIncusId,
          name: newDisplayName,
          status: 'stopped',
          displayOrder: 0,
          monthlyTrafficUsed: 0,
          trafficStatus: 'NORMAL',
          restoredFrom: Prisma.JsonNull,
          autoRenew: false,
          autoRenewAttempts: 0,
          lastAutoRenewAttemptAt: null,
          expiryNotifiedAt: null,
          cloudInitState: null,
          cloudInitSource: null,
          cloudInitLastCheckedAt: null,
          cloudInitCompletedAt: null,
          cloudInitManualCompletedAt: null,
          cloudInitManualCompletedBy: null
        }
      })
      const buyerBillingRecord = await tx.instanceBillingRecord.create({
        data: {
          instanceId: task.instanceId,
          userId: task.buyerUserId,
          type: 'newPurchase',
          amount: task.order.price,
          months: 0,
          periodStart: deliveredAt,
          periodEnd: task.instance.expiresAt && task.instance.expiresAt > deliveredAt ? task.instance.expiresAt : deliveredAt,
          balanceLogId: task.order.buyerBalanceLogId,
          remark: `交易所购买 ${task.order.orderNo}`
        }
      })
      await tx.exchangeDeliveryTask.update({
        where: { id: taskId },
        data: {
          step: 'transfer_owner',
          progress: taskProgress('transfer_owner', { instanceTaskId: task.instanceTaskId })
        }
      })
      await tx.exchangeAuditLog.create({
        data: {
          actorUserId: null,
          action: 'delivery.transfer_owner',
          targetType: 'exchange_delivery_task',
          targetId: taskId,
          detail: {
            orderId: task.orderId,
            instanceId: task.instanceId,
            buyerUserId: task.buyerUserId,
            sellerUserId: task.sellerUserId,
            oldIncusId,
            newIncusId,
            newDisplayName,
            cleanupAfterReinstall: {
              portMappingsRemoved: portMappingsRemoved.count,
              proxySitesRemoved: proxySitesRemoved.count,
              snapshotsRemoved: snapshotsRemoved.count,
              snapshotPoliciesRemoved: snapshotPoliciesRemoved.count,
              backupPoliciesRemoved: backupPoliciesRemoved.count,
              trafficSnapshotsRemoved: trafficSnapshotsRemoved.count,
              dailyTrafficRowsRemoved: dailyTrafficRowsRemoved.count,
              resourceRiskStateRemoved: resourceRiskStateRemoved.count,
              resourceRiskEventsRemoved: resourceRiskEventsRemoved.count,
              resourceRiskSamplesRemoved: resourceRiskSamplesRemoved.count,
              affBindingsRemoved: affBindingsRemoved.count,
              cancelledTransfers: cancelledTransfers.count
            }
          }
        }
      })
      await tx.exchangeDeliveryTask.update({
        where: { id: taskId },
        data: {
          step: 'rebuild_billing',
          progress: taskProgress('rebuild_billing', { instanceTaskId: task.instanceTaskId })
        }
      })
      await tx.exchangeDeliveryTask.update({
        where: { id: taskId },
        data: {
          step: 'reset_traffic_baseline',
          progress: taskProgress('reset_traffic_baseline', { instanceTaskId: task.instanceTaskId })
        }
      })
      const policy = await tx.exchangePolicyConfig.findFirst({ orderBy: { id: 'asc' } })
      const confirmationHours = Math.max(0, policy?.confirmationHours ?? 24)
      const confirmationDueAt = new Date(Date.now() + confirmationHours * 60 * 60 * 1000)
      await tx.exchangeOrder.update({
        where: { id: task.orderId },
        data: {
          status: 'confirming',
          confirmationDueAt,
          failureReason: null
        }
      })
      await tx.exchangeListing.update({
        where: { id: task.order.listingId },
        data: { status: 'sold' }
      })
      await tx.exchangeDeliveryTask.update({
        where: { id: taskId },
        data: {
          status: 'COMPLETED',
          step: 'complete',
          progress: taskProgress('complete', { instanceTaskId: task.instanceTaskId }),
          error: null,
          finishedAt: new Date()
        }
      })
      await tx.exchangeAuditLog.create({
        data: {
          actorUserId: null,
          action: 'delivery.completed',
          targetType: 'exchange_order',
          targetId: task.orderId,
          detail: {
            deliveryTaskId: task.id,
            instanceTaskId: task.instanceTaskId,
            instanceId: task.instanceId,
            buyerUserId: task.buyerUserId,
            sellerUserId: task.sellerUserId,
            oldIncusId,
            newIncusId,
            newDisplayName,
            rootPasswordRotatedByReinstall: true,
            buyerSshKeyInjected: !!task.sshKeyId,
            buyerSshKeyId: task.sshKeyId || null,
            generatedRootPasswordForBuyer: true,
            cloudInitStateResetForBuyer: true,
            oldBillingRecordsKeptWithSeller: true,
            renewalOwnershipRebuiltForBuyer: true,
            buyerBillingRecordId: buyerBillingRecord.id,
            confirmationDueAt,
            confirmationHours
          }
        }
      })
	  })
  } catch (error) {
    try {
      await renameIncusInstance(client, newIncusId, oldIncusId)
    } catch (rollbackError) {
      console.error('[ExchangeDeliveryWorker] CRITICAL: failed to rollback exchange Incus rename:', {
        taskId,
        oldIncusId,
        newIncusId,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      })
    }
    throw error
  }

  const task = await prisma.exchangeDeliveryTask.findUnique({
    where: { id: taskId },
    include: { order: true, instance: { select: { name: true } } }
  })
  if (task) {
    const notificationData = {
      orderNo: task.order.orderNo,
      instanceName: task.instance.name,
      confirmationDueAt: task.order.confirmationDueAt?.toISOString?.() ?? null
    }
    await Promise.allSettled([
      createLog(task.buyerUserId, 'exchange', 'exchange.delivery.completed', `交易所订单 ${task.order.orderNo} 已完成交割`, 'success', { instanceId: task.instanceId }),
      createLog(task.sellerUserId, 'exchange', 'exchange.order.confirming', `交易所订单 ${task.order.orderNo} 已完成交割，等待确认期结束后结算`, 'info', { instanceId: task.instanceId }),
      sendNotification(task.buyerUserId, 'exchange_delivery_completed', notificationData),
      sendNotification(task.sellerUserId, 'exchange_sale_confirming', notificationData)
    ]).then(results => {
      const failed = results.filter(result => result.status === 'rejected')
      if (failed.length > 0) {
        console.error(`[ExchangeDeliveryWorker] delivery ${taskId} post-commit notifications/logs failed:`, failed.map(result => result.reason))
      }
    })
  }
}

async function settleDueConfirmingOrders(): Promise<void> {
  const policy = await prisma.exchangePolicyConfig.findFirst({ orderBy: { id: 'asc' } })
  if (policy && !policy.autoConfirmEnabled) {
    return
  }
  const dueOrders = await prisma.exchangeOrder.findMany({
    where: {
      status: 'confirming',
      walletLogId: null,
      confirmationDueAt: { lte: new Date() }
    },
    orderBy: [
      { confirmationDueAt: 'asc' },
      { id: 'asc' }
    ],
    take: DELIVERY_BATCH_SIZE,
    select: { id: true, orderNo: true, sellerUserId: true, instanceId: true }
  })
  for (const order of dueOrders) {
    try {
      await releaseExchangeOrderEscrow(order.id, {
        action: 'order.auto_confirm',
        remark: `交易所订单 ${order.orderNo} 确认期结束，自动放款`
      })
      await createLog(order.sellerUserId, 'exchange', 'exchange.order.completed', `交易所订单 ${order.orderNo} 已完成结算`, 'success', { instanceId: order.instanceId })
    } catch (error) {
      console.error(`[ExchangeDeliveryWorker] settle order ${order.id} failed:`, error)
    }
  }
}

async function autoDelistExpiredListings(): Promise<void> {
  const now = new Date()
  const listings = await prisma.exchangeListing.findMany({
    where: {
      status: 'active',
      autoDelistAt: { lte: now }
    },
    orderBy: [
      { autoDelistAt: 'asc' },
      { id: 'asc' }
    ],
    take: DELIVERY_BATCH_SIZE,
    select: {
      id: true,
      instanceId: true,
      sellerUserId: true,
      autoDelistAt: true
    }
  })

  for (const listing of listings) {
    try {
      await prisma.$transaction(async tx => {
        const updated = await tx.exchangeListing.updateMany({
          where: {
            id: listing.id,
            status: 'active',
            autoDelistAt: { lte: now }
          },
          data: {
            status: 'delisted',
            delistedAt: now
          }
        })
        if (updated.count !== 1) return
        await tx.exchangeAuditLog.create({
          data: {
            actorUserId: null,
            action: 'listing.auto_delist',
            targetType: 'exchange_listing',
            targetId: listing.id,
            detail: {
              instanceId: listing.instanceId,
              sellerUserId: listing.sellerUserId,
              autoDelistAt: listing.autoDelistAt?.toISOString() ?? null,
              delistedAt: now.toISOString()
            }
          }
        })
      })
      await createLog(listing.sellerUserId, 'exchange', 'exchange.listing.auto_delisted', `交易所挂牌 #${listing.id} 已按自动下架时间下架`, 'info', { instanceId: listing.instanceId })
    } catch (error) {
      console.error(`[ExchangeDeliveryWorker] auto delist listing ${listing.id} failed:`, error)
    }
  }
}

async function escalateTimedOutDisputes(): Promise<void> {
  const policy = await prisma.exchangePolicyConfig.findFirst({ orderBy: { id: 'asc' } })
  const disputeTimeoutHours = Math.max(1, policy?.disputeTimeoutHours ?? 72)
  const cutoff = new Date(Date.now() - disputeTimeoutHours * 60 * 60 * 1000)
  const disputes = await prisma.exchangeDispute.findMany({
    where: {
      status: 'open',
      createdAt: { lte: cutoff }
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' }
    ],
    take: DELIVERY_BATCH_SIZE,
    include: {
      order: {
        select: {
          id: true,
          orderNo: true,
          status: true,
          buyerUserId: true,
          sellerUserId: true,
          instanceId: true
        }
      }
    }
  })

  for (const dispute of disputes) {
    try {
      const resolution = `争议超过 ${disputeTimeoutHours} 小时未处理，已自动转入人工处理队列`
      const updated = await prisma.$transaction(async tx => {
        const claimed = await tx.exchangeDispute.updateMany({
          where: {
            id: dispute.id,
            status: 'open',
            createdAt: { lte: cutoff }
          },
          data: {
            status: 'processing',
            resolution,
            handledByUserId: null
          }
        })
        if (claimed.count !== 1) return false
        if (dispute.order.status === 'disputed') {
          await tx.exchangeOrder.update({
            where: { id: dispute.orderId },
            data: {
              status: 'manual_review',
              failureReason: resolution
            }
          })
        }
        await tx.exchangeAuditLog.create({
          data: {
            actorUserId: null,
            action: 'dispute.timeout_escalate',
            targetType: 'exchange_dispute',
            targetId: dispute.id,
            detail: {
              orderId: dispute.orderId,
              orderNo: dispute.order.orderNo,
              disputeTimeoutHours,
              createdAt: dispute.createdAt.toISOString(),
              cutoff: cutoff.toISOString(),
              previousOrderStatus: dispute.order.status
            }
          }
        })
        return true
      })
      if (!updated) continue
      await Promise.all([
        createLog(dispute.order.buyerUserId, 'exchange', 'exchange.dispute.timeout_escalated', `交易所订单 ${dispute.order.orderNo} 的争议已超时转入人工处理`, 'info', { instanceId: dispute.order.instanceId }),
        createLog(dispute.order.sellerUserId, 'exchange', 'exchange.dispute.timeout_escalated', `交易所订单 ${dispute.order.orderNo} 的争议已超时转入人工处理`, 'info', { instanceId: dispute.order.instanceId })
      ])
    } catch (error) {
      console.error(`[ExchangeDeliveryWorker] escalate dispute ${dispute.id} failed:`, error)
    }
  }
}

async function syncProcessingTask(taskId: number): Promise<void> {
  const task = await prisma.exchangeDeliveryTask.findUnique({
    where: { id: taskId },
    include: { instanceTask: true }
  })
  if (!task) return
  if (!task.instanceTaskId) {
    await enqueueReinstall(task.id)
    return
  }
  const status = task.instanceTask?.status as InstanceTaskStatus | undefined
  if (!status) {
    throw new Error('关联实例任务不存在')
  }
  if (status === 'PENDING' || status === 'PROCESSING') {
    await prisma.exchangeDeliveryTask.update({
      where: { id: taskId },
      data: {
        step: 'reinstall',
        progress: taskProgress('reinstall', {
          instanceTaskId: task.instanceTaskId,
          instanceTaskStatus: status,
          instanceTaskProgress: task.instanceTask?.progress || null
        })
      }
    })
    return
  }
  if (status === 'COMPLETED') {
    await finalizeDelivery(taskId)
    return
  }
  await markDeliveryFailed(taskId, task.instanceTask?.error || `实例重装任务失败：${status}`)
}

async function processDeliveryTask(taskId: number): Promise<void> {
  if (runningTaskIds.has(taskId)) return
  runningTaskIds.add(taskId)
  try {
    const task = await prisma.exchangeDeliveryTask.findUnique({ where: { id: taskId } })
    if (!task) return
    if (task.status === 'PENDING') {
      const claimed = await prisma.exchangeDeliveryTask.updateMany({
        where: { id: taskId, status: 'PENDING' },
        data: {
          status: 'PROCESSING',
          startedAt: new Date(),
          step: 'lock_instance',
          progress: taskProgress('lock_instance')
        }
      })
      if (claimed.count !== 1) return
      await enqueueReinstall(taskId)
      return
    }
    if (task.status === 'PROCESSING') {
      await syncProcessingTask(taskId)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[ExchangeDeliveryWorker] Task ${taskId} failed:`, message)
    await markDeliveryFailed(taskId, message)
  } finally {
    runningTaskIds.delete(taskId)
  }
}

export async function runExchangeDeliveryWorkerTick(): Promise<void> {
  await autoDelistExpiredListings()
  await escalateTimedOutDisputes()
  await settleDueConfirmingOrders()
  const tasks = await prisma.exchangeDeliveryTask.findMany({
    where: { status: { in: ['PENDING', 'PROCESSING'] } },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' }
    ],
    take: DELIVERY_BATCH_SIZE,
    select: { id: true }
  })
  for (const task of tasks) {
    await processDeliveryTask(task.id)
  }
}

export function startExchangeDeliveryWorker(): void {
  if (workerInterval) return
  workerInterval = setInterval(() => {
    runExchangeDeliveryWorkerTick().catch(error => {
      console.error('[ExchangeDeliveryWorker] tick failed:', error)
    })
  }, POLL_INTERVAL_MS)
  runExchangeDeliveryWorkerTick().catch(error => {
    console.error('[ExchangeDeliveryWorker] initial tick failed:', error)
  })
}

export function stopExchangeDeliveryWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
  }
}
