/**
 * 实例销毁相关路由
 * 处理用户端实例销毁功能（带退款）
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { InstanceStatus } from '@prisma/client'
import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { sendHostManagedInstanceNotification, sendNotification } from '../lib/notifier.js'
import { sendInstanceDestroyRefundEmail } from '../lib/mailer.js'
import { sendReleaseNotification } from '../lib/release-notifier.js'
import { collectTrafficForRunningInstance } from '../services/instance-traffic-collector.js'
import {
  INSTANCE_OPERATION_LOCK_NAMESPACE,
  USER_DESTROY_BILLING_LOCK_NAMESPACE,
  advisoryTransactionLock,
  tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'

// 销毁业务规则常量
const DESTROY_RULES = {
  FEE_RATE: 0.10,                // 手续费率 10%（首次免手续费）
  MAX_PAID_DESTROY_MONTHLY_TRAFFIC: 5n * 1024n * 1024n * 1024n // 5 GiB
}

const DESTROY_TRAFFIC_LIMIT_REASON = '当前月流量周期无法销毁，已用流量达到或超过 5G'

interface BatchDestroyPreviewItem {
  id: number
  name: string
  canDestroy: boolean
  cannotDestroyReason: string
  isFreeInstance: boolean
  isFirstTime: boolean
  feeWaiverEligible: boolean
  refund: {
    remainingDays: number
    remainingValue: number
    feeRate: number
    feeAmount: number
    refundAmount: number
    destroyCount: number
    maxRefundable: number
  }
  instance: {
    id: number
    name: string
    hostName: string
    planName: string | null
  }
}

interface BatchDestroyResultItem {
  id: number
  name: string
  success: boolean
  skipped?: boolean
  reason?: string
  refundAmount?: number
  feeAmount?: number
  isFirstTime?: boolean
  isFreeInstance?: boolean
}

const BATCH_HIDDEN_REASON = '实例不存在或无权操作'

function isExpiredAt(expiresAt: Date | null | undefined): boolean {
  return !!expiresAt && expiresAt.getTime() <= Date.now()
}

function canUserDestroyExpiredSuspendedPaidInstance(instance: {
  status: string
  suspendReason?: string | null
  packagePlanId?: number | null
  expiresAt?: Date | null
}): boolean {
  return instance.status === 'suspended'
    && instance.suspendReason === 'expired'
    && !!instance.packagePlanId
    && isExpiredAt(instance.expiresAt)
}

/**
 * 计算手续费率
 * 第1次：0%（首次免手续费）
 * 第2次及以后：10%
 */
function calculateFeeRate(destroyCount: number): number {
  if (destroyCount === 0) return 0 // 首次免手续费
  return DESTROY_RULES.FEE_RATE
}

function exceedsPaidDestroyTrafficLimit(monthlyTrafficUsed: bigint): boolean {
  return monthlyTrafficUsed >= DESTROY_RULES.MAX_PAID_DESTROY_MONTHLY_TRAFFIC
}

async function getDestroyBlockingTask(instanceId: number, client: any = prisma): Promise<{
  code: 'RESTORE_IN_PROGRESS' | 'UPLOAD_IN_PROGRESS' | 'TASK_IN_PROGRESS'
  reason: string
} | null> {
  const [activeRestoreTask, activeUploadTask, activeInstanceTask] = await Promise.all([
    client.restoreTask.findFirst({
      where: {
        instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      select: { id: true }
    }),
    client.backupUploadTask.findFirst({
      where: {
        instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      select: { id: true }
    }),
    client.instanceTask.findFirst({
      where: {
        instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      select: { id: true }
    })
  ])

  if (activeRestoreTask) {
    return { code: 'RESTORE_IN_PROGRESS', reason: '该实例有正在进行的恢复任务，请等待完成或取消' }
  }
  if (activeUploadTask) {
    return { code: 'UPLOAD_IN_PROGRESS', reason: '该实例有正在进行的备份上传任务，请等待完成或取消' }
  }
  if (activeInstanceTask) {
    return { code: 'TASK_IN_PROGRESS', reason: '该实例有正在进行的操作任务，请等待完成' }
  }
  return null
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

async function claimInstanceForUserDestroy(
  instanceId: number,
  userId: number,
  currentStatus: InstanceStatus
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)
    if (!locked) return false

    const blockingTask = await getDestroyBlockingTask(instanceId, tx)
    if (blockingTask) return false

    const result = await tx.instance.updateMany({
      where: {
        id: instanceId,
        userId,
        status: currentStatus
      },
      data: { status: 'deleted' }
    })

    return result.count === 1
  })
}

async function restoreClaimedInstanceStatus(
  instanceId: number,
  userId: number,
  originalStatus: InstanceStatus
): Promise<void> {
  await prisma.instance.updateMany({
    where: {
      id: instanceId,
      userId,
      status: 'deleted'
    },
    data: { status: originalStatus }
  })
}

async function settleUserDestroyBilling(params: {
  requestUserId: number
  instance: {
    id: number
    userId: number
    hostId: number
    name: string
  }
  refundableValue: number
  feeWaiver: boolean
}): Promise<{ refundAmount: number; feeAmount: number; isFirstTime: boolean }> {
  const { requestUserId, instance, refundableValue, feeWaiver } = params
  const instanceId = instance.id

  return await prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, USER_DESTROY_BILLING_LOCK_NAMESPACE, requestUserId)

    const destroyCount = await tx.userDestroyRecord.count({
      where: { userId: requestUserId }
    })
    const isFirstTime = destroyCount === 0
    let feeAmount = 0
    if (!feeWaiver && !isFirstTime) {
      feeAmount = roundMoney(refundableValue * calculateFeeRate(destroyCount))
    }
    const refundAmount = roundMoney(Math.max(0, refundableValue - feeAmount))

    if (refundAmount > 0) {
      const currentUser = await tx.user.findUnique({
        where: { id: instance.userId },
        select: { balance: true }
      })
      const oldBalance = Number(currentUser?.balance || 0)
      const newBalance = roundMoney(oldBalance + refundAmount)

      await tx.user.update({
        where: { id: instance.userId },
        data: { balance: { increment: refundAmount } }
      })

      const balanceLog = await tx.balanceLog.create({
        data: {
          userId: instance.userId,
          type: 'refund',
          amount: refundAmount,
          balanceBefore: oldBalance,
          balanceAfter: newBalance,
          instanceId,
          remark: `用户销毁实例退款：${instance.name}${feeWaiver ? '（异常实例免手续费）' : feeAmount > 0 ? `（手续费 ¥${feeAmount.toFixed(2)}）` : '（首次销毁免手续费）'}`
        }
      })

      await tx.instanceBillingRecord.create({
        data: {
          instanceId,
          userId: instance.userId,
          type: 'refund',
          amount: -refundAmount,
          months: 0,
          periodStart: new Date(),
          periodEnd: new Date(),
          balanceLogId: balanceLog.id,
          remark: `用户销毁实例退款${feeWaiver ? '（异常实例免手续费）' : feeAmount > 0 ? `（手续费 ¥${feeAmount.toFixed(2)}）` : '（首次销毁免手续费）'}`
        }
      })

      await db.deductHostingBalance(
        instance.hostId,
        refundAmount,
        instanceId,
        `用户销毁托管实例退款扣除：${instance.name}`,
        tx
      )
    }

    await tx.userDestroyRecord.create({
      data: {
        userId: requestUserId,
        hostId: instance.hostId,
        instanceId,
        instanceName: instance.name,
        refundAmount,
        feeAmount,
        isFirstTime
      }
    })

    return { refundAmount, feeAmount, isFirstTime }
  })
}

async function buildBatchDestroyPreviewItem(userId: number, instanceId: number): Promise<BatchDestroyPreviewItem> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    include: {
      host: { select: { id: true, name: true, userId: true } },
      packagePlan: { select: { id: true, name: true } }
    }
  })

  if (!instance) {
    return {
      id: instanceId,
      name: `#${instanceId}`,
      canDestroy: false,
      cannotDestroyReason: BATCH_HIDDEN_REASON,
      isFreeInstance: true,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instanceId,
        name: `#${instanceId}`,
        hostName: '-',
        planName: null
      }
    }
  }

  if (instance.userId !== userId) {
    return {
      id: instanceId,
      name: `#${instanceId}`,
      canDestroy: false,
      cannotDestroyReason: BATCH_HIDDEN_REASON,
      isFreeInstance: true,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instanceId,
        name: `#${instanceId}`,
        hostName: '-',
        planName: null
      }
    }
  }

  if (instance.status === 'deleted') {
    return {
      id: instance.id,
      name: instance.name,
      canDestroy: false,
      cannotDestroyReason: '实例已删除',
      isFreeInstance: !instance.packagePlanId,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instance.id,
        name: instance.name,
        hostName: instance.host.name,
        planName: instance.packagePlan?.name || null
      }
    }
  }

  if (instance.status === 'creating') {
    return {
      id: instance.id,
      name: instance.name,
      canDestroy: false,
      cannotDestroyReason: '实例正在创建中，无法销毁',
      isFreeInstance: !instance.packagePlanId,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instance.id,
        name: instance.name,
        hostName: instance.host.name,
        planName: instance.packagePlan?.name || null
      }
    }
  }

  if (instance.status === 'suspended' && !canUserDestroyExpiredSuspendedPaidInstance(instance)) {
    return {
      id: instance.id,
      name: instance.name,
      canDestroy: false,
      cannotDestroyReason: '实例已被封停，无法销毁，请先联系管理员解封',
      isFreeInstance: !instance.packagePlanId,
      isFirstTime: false,
      feeWaiverEligible: false,
      refund: {
        remainingDays: 0,
        remainingValue: 0,
        feeRate: 0,
        feeAmount: 0,
        refundAmount: 0,
        destroyCount: 0,
        maxRefundable: 0
      },
      instance: {
        id: instance.id,
        name: instance.name,
        hostName: instance.host.name,
        planName: instance.packagePlan?.name || null
      }
    }
  }

  const isErrorState = instance.status === 'error'
  const feeWaiver = isErrorState
  const isFreeInstance = !instance.packagePlanId
  const destroyRecords = await prisma.userDestroyRecord.findMany({
    where: { userId },
    orderBy: { destroyedAt: 'desc' }
  })
  let isFirstTime = destroyRecords.length === 0

  let remainingValue = 0
  let feeAmount = 0
  let refundAmount = 0
  let remainingDays = 0
  let maxRefundable = 0
  let refundableValue = 0
  let currentFeeRate = feeWaiver ? 0 : calculateFeeRate(destroyRecords.length)
  let canDestroy = true
  let cannotDestroyReason = ''

  if (!isFreeInstance && instance.expiresAt && instance.billingPrice && instance.billingCycle) {
    const refundQuote = await db.calculateInstanceRemainingRefundQuote({
      id: instance.id,
      billingPrice: instance.billingPrice,
      billingCycle: instance.billingCycle,
      expiresAt: instance.expiresAt,
      packagePlanId: instance.packagePlanId
    })

    if (refundQuote.isPaid) {
      remainingDays = refundQuote.remainingDays
      remainingValue = refundQuote.remainingValue
      refundableValue = refundQuote.refundableValue
      maxRefundable = refundQuote.maxRefundable
      currentFeeRate = feeWaiver ? 0 : calculateFeeRate(destroyRecords.length)
      if (!isFirstTime && !feeWaiver) {
        feeAmount = Number((refundableValue * currentFeeRate).toFixed(2))
      }
      refundAmount = Number((refundableValue - feeAmount).toFixed(2))
    }

    if (
      !canUserDestroyExpiredSuspendedPaidInstance(instance)
      && exceedsPaidDestroyTrafficLimit(instance.monthlyTrafficUsed)
    ) {
      canDestroy = false
      cannotDestroyReason = DESTROY_TRAFFIC_LIMIT_REASON
    }
  }

  return {
    id: instance.id,
    name: instance.name,
    canDestroy,
    cannotDestroyReason,
    isFreeInstance,
    isFirstTime,
    feeWaiverEligible: isErrorState,
    refund: {
      remainingDays,
      remainingValue,
      feeRate: currentFeeRate,
      feeAmount,
      refundAmount,
      destroyCount: destroyRecords.length,
      maxRefundable
    },
    instance: {
      id: instance.id,
      name: instance.name,
      hostName: instance.host.name,
      planName: instance.packagePlan?.name || null
    }
  }
}

async function executeDestroyForUser(
  user: { id: number; username: string },
  instanceId: number,
  logger: { warn: (...args: any[]) => void; error: (...args: any[]) => void }
): Promise<BatchDestroyResultItem> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    include: {
      user: { select: { id: true, username: true, balance: true, email: true } },
      host: { select: { id: true, name: true, userId: true } }
    }
  })

  if (!instance) {
    return { id: instanceId, name: `#${instanceId}`, success: false, reason: BATCH_HIDDEN_REASON }
  }

  if (instance.userId !== user.id) {
    return { id: instanceId, name: `#${instanceId}`, success: false, reason: BATCH_HIDDEN_REASON }
  }

  if (instance.status === 'deleted') {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: '实例已删除' }
  }

  if (instance.status === 'creating') {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: '实例正在创建中，无法销毁' }
  }

  if (instance.status === 'suspended' && !canUserDestroyExpiredSuspendedPaidInstance(instance)) {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: '实例已被封停，无法销毁，请先联系管理员解封' }
  }

  const blockingTask = await getDestroyBlockingTask(instanceId)
  if (blockingTask) {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: blockingTask.reason }
  }

  const isFreeInstance = !instance.packagePlanId
  const destroyRecords = await prisma.userDestroyRecord.findMany({
    where: { userId: user.id },
    orderBy: { destroyedAt: 'desc' }
  })
  let isFirstTime = destroyRecords.length === 0
  const feeWaiver = instance.status === 'error'

  let currentMonthlyTrafficUsed = instance.monthlyTrafficUsed
  if (!isFreeInstance && instance.status === 'running') {
    const collectResult = await collectTrafficForRunningInstance(instanceId)
    if (!collectResult.success) {
      logger.warn({ instanceId, error: collectResult.error }, '销毁前即时采集流量失败')
    } else {
      currentMonthlyTrafficUsed = collectResult.currentUsage
    }
  }

  if (
    !isFreeInstance
    && !canUserDestroyExpiredSuspendedPaidInstance(instance)
    && exceedsPaidDestroyTrafficLimit(currentMonthlyTrafficUsed)
  ) {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: DESTROY_TRAFFIC_LIMIT_REASON }
  }

  let feeAmount = 0
  let refundAmount = 0
  let refundableValue = 0

  if (!isFreeInstance && instance.expiresAt && instance.billingPrice && instance.billingCycle) {
    const refundQuote = await db.calculateInstanceRemainingRefundQuote({
      id: instanceId,
      billingPrice: instance.billingPrice,
      billingCycle: instance.billingCycle,
      expiresAt: instance.expiresAt,
      packagePlanId: instance.packagePlanId
    })

    if (refundQuote.isPaid) {
      refundableValue = refundQuote.refundableValue
      if (!feeWaiver) {
        const currentFeeRate = calculateFeeRate(destroyRecords.length)
        if (!isFirstTime) {
          feeAmount = roundMoney(refundableValue * currentFeeRate)
        }
      }
      refundAmount = roundMoney(Math.max(0, refundableValue - feeAmount))
    }
  }

  const claimed = await claimInstanceForUserDestroy(instanceId, user.id, instance.status)
  if (!claimed) {
    return { id: instance.id, name: instance.name, success: false, skipped: true, reason: '实例正在销毁或已删除' }
  }

  try {
    if (!isFreeInstance) {
      try {
        const billingResult = await settleUserDestroyBilling({
          requestUserId: user.id,
          instance,
          refundableValue,
          feeWaiver
        })
        refundAmount = billingResult.refundAmount
        feeAmount = billingResult.feeAmount
        isFirstTime = billingResult.isFirstTime
      } catch (settleError) {
        await restoreClaimedInstanceStatus(instanceId, user.id, instance.status)
        throw settleError
      }
    }

    if (instance.status === 'running') {
      try {
        const host = await db.getHostById(instance.hostId)
        if (host) {
          const { getIncusClient, stopInstance } = await import('../lib/incus/index.js')
          const client = await getIncusClient(host)
          await stopInstance(client, instance.incusId, true)
        }
      } catch (err) {
        logger.warn(err, '停止实例失败')
      }
    }

    const portMappings = await prisma.portMapping.findMany({ where: { instanceId } })

    try {
      await prisma.snapshot.deleteMany({ where: { instanceId } })
      await prisma.backup.deleteMany({ where: { instanceId } })
      await prisma.portMapping.deleteMany({ where: { instanceId } })
      await prisma.proxySite.deleteMany({ where: { instanceId } })
      await prisma.dailyTraffic.deleteMany({ where: { instanceId } })
      await prisma.ipAddress.deleteMany({ where: { instanceId } })
      await prisma.ipv6Subnet.deleteMany({ where: { instanceId } })
      await prisma.restoreTask.deleteMany({ where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } } })
      await prisma.backupUploadTask.deleteMany({ where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } } })
      await prisma.instanceTask.deleteMany({ where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } } })
      await prisma.instanceTransfer.updateMany({
        where: { instanceId, status: 'pending' },
        data: { status: 'cancelled', cancelledAt: new Date() }
      })
    } catch (cleanupErr) {
      logger.warn(cleanupErr, '清理关联数据失败')
    }

    try {
      const host = await db.getHostById(instance.hostId)
      if (host) {
        const { getIncusClient, deleteInstance } = await import('../lib/incus/index.js')
        const client = await getIncusClient(host)
        await deleteInstance(client, instance.incusId)
      }
    } catch (incusErr) {
      logger.error(incusErr, 'Incus 删除实例失败')
    }

    const portMappingsCount = portMappings?.length || 0
    await db.rollbackResources({
      hostId: instance.hostId,
      cpu: instance.cpu,
      memory: instance.memory,
      disk: instance.disk,
      portCount: portMappingsCount
    })

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

    await createLog(
      user.id,
      'billing',
      'instance.user_destroy',
      `User destroyed instance "${instance.name}" (Host: ${instance.host.name}, Refund: ¥${refundAmount.toFixed(2)}, Fee: ¥${feeAmount.toFixed(2)})`,
      'success'
    )

    await sendNotification(user.id, 'instance_deleted_refunded', {
      instanceName: instance.name,
      refundAmount,
      feeAmount,
      isFreeInstance
    })

    if (!isFreeInstance && instance.user?.email) {
      try {
        await sendInstanceDestroyRefundEmail(instance.user.email, {
          username: instance.user.username,
          instanceName: instance.name,
          refundAmount,
          feeAmount,
          refundType: '余额退款',
          isUserDestroy: true
        })
      } catch (emailErr) {
        logger.warn(emailErr, '发送销毁退款邮件失败')
      }
    }

    sendHostManagedInstanceNotification(
      instance.hostId,
      'destroy',
      {
        username: user.username,
        instanceName: instance.name,
        refundAmount,
        feeAmount
      }
    ).catch(err => {
      logger.warn(err, '发送节点销毁通知失败')
    })

    if (instance.packageId) {
      sendReleaseNotification({
        packageId: instance.packageId,
        cpu: instance.cpu,
        memory: instance.memory,
        source: '用户销毁实例'
      }).catch(() => {})
    }

    return {
      id: instance.id,
      name: instance.name,
      success: true,
      refundAmount,
      feeAmount,
      isFirstTime,
      isFreeInstance
    }
  } catch (error) {
    logger.error(error, '销毁实例失败')
    return {
      id: instance.id,
      name: instance.name,
      success: false,
      reason: '销毁实例失败'
    }
  }
}

export default async function instanceDestroyRoutes(fastify: FastifyInstance) {

  fastify.post<{
    Body: { instanceIds: number[] }
  }>('/batch/destroy-info', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const uniqueIds = Array.from(new Set(request.body.instanceIds)).filter(id => Number.isInteger(id))
    if (uniqueIds.length === 0) {
      return reply.code(400).send({ error: '请选择至少一个实例' })
    }

    const items = await Promise.all(uniqueIds.map(id => buildBatchDestroyPreviewItem(request.user.id, id)))
    return { items }
  })

  fastify.post<{
    Body: { instanceIds: number[] }
  }>('/batch/destroy', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const uniqueIds = Array.from(new Set(request.body.instanceIds)).filter(id => Number.isInteger(id))
    if (uniqueIds.length === 0) {
      return reply.code(400).send({ error: '请选择至少一个实例' })
    }

    const userMeta = {
      id: request.user.id,
      username: request.user.username
    }

    const results: BatchDestroyResultItem[] = []
    for (const instanceId of uniqueIds) {
      const result = await executeDestroyForUser(userMeta, instanceId, request.log)
      results.push(result)
    }

    const successCount = results.filter(item => item.success).length
    const skippedCount = results.filter(item => item.skipped).length
    const failedCount = results.length - successCount - skippedCount

    await createLog(
      request.user.id,
      'billing',
      'instance.batch_destroy',
      `Batch destroy processed ${results.length} instance(s): success=${successCount}, skipped=${skippedCount}, failed=${failedCount}`,
      failedCount > 0 ? 'warning' : 'success'
    )

    return {
      message: successCount > 0 ? '批量销毁已处理' : '没有实例完成销毁',
      successCount,
      skippedCount,
      failedCount,
      results
    }
  })

  // ==================== 获取销毁预览信息 ====================
  // GET /api/instances/:id/destroy-info
  fastify.get<{ Params: { id: string }; Querystring: { feeWaiver?: string } }>('/:id/destroy-info', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { feeWaiver?: string } }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = Number(request.params.id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        host: { select: { id: true, name: true, userId: true } },
        packagePlan: { select: { id: true, name: true } }
      }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 只有实例所有者可以销毁
    if (instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查实例状态
    if (instance.status === 'deleted') {
      return reply.code(400).send({ error: '实例已删除', canDestroy: false })
    }

    if (instance.status === 'creating') {
      return reply.code(400).send({ error: '实例正在创建中，无法销毁', canDestroy: false })
    }

    if (instance.status === 'suspended' && !canUserDestroyExpiredSuspendedPaidInstance(instance)) {
      return reply.code(400).send({ error: '实例已被封停，无法销毁，请先联系管理员解封', canDestroy: false })
    }

    // 异常实例免手续费
    const isErrorState = instance.status === 'error'
    const feeWaiver = request.query.feeWaiver === 'error' && isErrorState

    // 免费实例检查
    const isFreeInstance = !instance.packagePlanId

    // 查询用户销毁记录（仅付费实例销毁计入）
    const destroyRecords = await prisma.userDestroyRecord.findMany({
      where: { userId: user.id },
      orderBy: { destroyedAt: 'desc' }
    })

    // 检查是否首次销毁
    let isFirstTime = destroyRecords.length === 0

    // 计算剩余价值和退款金额
    let remainingValue = 0
    let feeAmount = 0
    let refundAmount = 0
    let remainingDays = 0
    let maxRefundable = 0
    let refundableValue = 0
    let currentFeeRate = feeWaiver ? 0 : calculateFeeRate(destroyRecords.length)

    if (!isFreeInstance && instance.expiresAt && instance.billingPrice && instance.billingCycle) {
      const refundQuote = await db.calculateInstanceRemainingRefundQuote({
        id: instanceId,
        billingPrice: instance.billingPrice,
        billingCycle: instance.billingCycle,
        expiresAt: instance.expiresAt,
        packagePlanId: instance.packagePlanId
      })

      if (refundQuote.isPaid) {
        remainingDays = refundQuote.remainingDays
        remainingValue = refundQuote.remainingValue
        refundableValue = refundQuote.refundableValue
        maxRefundable = refundQuote.maxRefundable

        // 计算手续费（首次免手续费，后续固定 10%；异常实例免手续费）
        currentFeeRate = feeWaiver ? 0 : calculateFeeRate(destroyRecords.length)
        if (!isFirstTime && !feeWaiver) {
          feeAmount = Number((refundableValue * currentFeeRate).toFixed(2))
        }

        // 实际退款金额
        refundAmount = Number((refundableValue - feeAmount).toFixed(2))
      }
    }

    // 判断是否可以销毁（已移除冷却期限制，付费实例随时可销毁）
    let canDestroy = true
    let cannotDestroyReason = ''

    if (
      !isFreeInstance
      && !canUserDestroyExpiredSuspendedPaidInstance(instance)
      && exceedsPaidDestroyTrafficLimit(instance.monthlyTrafficUsed)
    ) {
      canDestroy = false
      cannotDestroyReason = DESTROY_TRAFFIC_LIMIT_REASON
    }

    return {
      canDestroy,
      cannotDestroyReason,
      isFreeInstance,
      isFirstTime,
      isErrorState,
      feeWaiverEligible: isErrorState,
      // 销毁规则
      rules: {
        feeRate: feeWaiver ? 0 : DESTROY_RULES.FEE_RATE
      },
      // 退款预览
      refund: {
        remainingDays,
        remainingValue,
        feeRate: currentFeeRate,
        feeAmount,
        refundAmount,
        destroyCount: destroyRecords.length,  // 已销毁次数
        maxRefundable  // 退款上限（基于历史账单）
      },
      // 实例信息
      instance: {
        id: instance.id,
        name: instance.name,
        hostName: instance.host.name,
        planName: instance.packagePlan?.name || null
      }
    }
  })

  // ==================== 执行销毁 ====================
  // POST /api/instances/:id/destroy
  fastify.post<{ Params: { id: string }; Querystring: { feeWaiver?: string } }>('/:id/destroy', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { feeWaiver?: string } }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = Number(request.params.id)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取实例信息
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        user: { select: { id: true, username: true, balance: true, email: true } },
        host: { select: { id: true, name: true, userId: true } }
      }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 只有实例所有者可以销毁
    if (instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查实例状态
    if (instance.status === 'deleted') {
      return reply.code(400).send({ error: '实例已删除' })
    }

    if (instance.status === 'creating') {
      return reply.code(400).send({ error: '实例正在创建中，无法销毁' })
    }

    if (instance.status === 'suspended' && !canUserDestroyExpiredSuspendedPaidInstance(instance)) {
      return reply.code(400).send({ error: '实例已被封停，无法销毁，请先联系管理员解封' })
    }

    const blockingTask = await getDestroyBlockingTask(instanceId)
    if (blockingTask) {
      return reply.code(409).send({
        error: blockingTask.reason,
        code: blockingTask.code
      })
    }

    // 免费实例检查
    const isFreeInstance = !instance.packagePlanId

    // 查询用户销毁记录
    const destroyRecords = await prisma.userDestroyRecord.findMany({
      where: { userId: user.id },
      orderBy: { destroyedAt: 'desc' }
    })

    let isFirstTime = destroyRecords.length === 0
    // 已移除冷却期限制，付费实例可随时销毁

    // 异常实例免手续费
    const isErrorState = instance.status === 'error'
    const feeWaiver = request.query.feeWaiver === 'error' && isErrorState

    let currentMonthlyTrafficUsed = instance.monthlyTrafficUsed

    if (!isFreeInstance && instance.status === 'running') {
      const collectResult = await collectTrafficForRunningInstance(instanceId)
      if (!collectResult.success) {
        request.log.warn({ instanceId, error: collectResult.error }, '销毁前即时采集流量失败')
      } else {
        currentMonthlyTrafficUsed = collectResult.currentUsage
      }
    }

    if (
      !isFreeInstance
      && !canUserDestroyExpiredSuspendedPaidInstance(instance)
      && exceedsPaidDestroyTrafficLimit(currentMonthlyTrafficUsed)
    ) {
      return reply.code(400).send(apiError(
        ErrorCode.INSTANCE_DESTROY_TRAFFIC_LIMIT_EXCEEDED,
        DESTROY_TRAFFIC_LIMIT_REASON
      ))
    }

    // 计算退款金额
    let feeAmount = 0
    let refundAmount = 0
    let refundableValue = 0

    if (!isFreeInstance && instance.expiresAt && instance.billingPrice && instance.billingCycle) {
      const refundQuote = await db.calculateInstanceRemainingRefundQuote({
        id: instanceId,
        billingPrice: instance.billingPrice,
        billingCycle: instance.billingCycle,
        expiresAt: instance.expiresAt,
        packagePlanId: instance.packagePlanId
      })

      if (refundQuote.isPaid) {
        refundableValue = refundQuote.refundableValue

        // 异常实例免手续费，否则按正常规则计算
        if (!feeWaiver) {
          const currentFeeRate = calculateFeeRate(destroyRecords.length)
          if (!isFirstTime) {
            feeAmount = roundMoney(refundableValue * currentFeeRate)
          }
        }

        refundAmount = roundMoney(Math.max(0, refundableValue - feeAmount))
      }
    }

    const claimed = await claimInstanceForUserDestroy(instanceId, user.id, instance.status)
    if (!claimed) {
      return reply.code(409).send({
        error: '实例正在销毁或已删除',
        code: 'INSTANCE_DESTROY_IN_PROGRESS'
      })
    }

    try {
      if (!isFreeInstance) {
        try {
          const billingResult = await settleUserDestroyBilling({
            requestUserId: user.id,
            instance,
            refundableValue,
            feeWaiver
          })
          refundAmount = billingResult.refundAmount
          feeAmount = billingResult.feeAmount
          isFirstTime = billingResult.isFirstTime
        } catch (settleError) {
          await restoreClaimedInstanceStatus(instanceId, user.id, instance.status)
          throw settleError
        }
      }

      // 1. 停止实例
      if (instance.status === 'running') {
        try {
          const host = await db.getHostById(instance.hostId)
          if (host) {
            const { getIncusClient, stopInstance } = await import('../lib/incus/index.js')
            const client = await getIncusClient(host)
            await stopInstance(client, instance.incusId, true)
          }
        } catch (err) {
          request.log.warn(err, '停止实例失败')
        }
      }

      // 2. 获取端口映射数量（用于释放资源）
      const portMappings = await prisma.portMapping.findMany({ where: { instanceId } })

      // 3. 清理关联数据
      try {
        await prisma.snapshot.deleteMany({ where: { instanceId } })
        await prisma.backup.deleteMany({ where: { instanceId } })
        await prisma.portMapping.deleteMany({ where: { instanceId } })
        await prisma.proxySite.deleteMany({ where: { instanceId } })
        await prisma.dailyTraffic.deleteMany({ where: { instanceId } })
        await prisma.ipAddress.deleteMany({ where: { instanceId } })
        await prisma.ipv6Subnet.deleteMany({ where: { instanceId } })
        await prisma.restoreTask.deleteMany({ where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } } })
        await prisma.backupUploadTask.deleteMany({ where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } } })
        await prisma.instanceTask.deleteMany({ where: { instanceId, status: { in: ['COMPLETED', 'FAILED'] } } })
        await prisma.instanceTransfer.updateMany({
          where: { instanceId, status: 'pending' },
          data: { status: 'cancelled', cancelledAt: new Date() }
        })
      } catch (cleanupErr) {
        request.log.warn(cleanupErr, '清理关联数据失败')
      }

      // 4. 从 Incus 删除实例
      try {
        const host = await db.getHostById(instance.hostId)
        if (host) {
          const { getIncusClient, deleteInstance } = await import('../lib/incus/index.js')
          const client = await getIncusClient(host)
          await deleteInstance(client, instance.incusId)
        }
      } catch (incusErr) {
        request.log.error(incusErr, 'Incus 删除实例失败')
      }

      // 6. 释放宿主机资源
      const portMappingsCount = portMappings?.length || 0
      await db.rollbackResources({
        hostId: instance.hostId,
        cpu: instance.cpu,
        memory: instance.memory,
        disk: instance.disk,
        portCount: portMappingsCount
      })

      // 重新计算宿主机资源使用量
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

      // 8. 记录操作日志
      await createLog(
        user.id,
        'billing',
        'instance.user_destroy',
        `User destroyed instance "${instance.name}" (Host: ${instance.host.name}, Refund: ¥${refundAmount.toFixed(2)}, Fee: ¥${feeAmount.toFixed(2)})`,
        'success'
      )

      // 9. 通知用户
      await sendNotification(user.id, 'instance_deleted_refunded', {
        instanceName: instance.name,
        refundAmount,
        feeAmount,
        isFreeInstance
      })

      if (!isFreeInstance && instance.user?.email) {
        try {
          await sendInstanceDestroyRefundEmail(instance.user.email, {
            username: instance.user.username,
            instanceName: instance.name,
            refundAmount,
            feeAmount,
            refundType: '余额退款',
            isUserDestroy: true
          })
        } catch (emailErr) {
          request.log.warn(emailErr, '发送销毁退款邮件失败')
        }
      }

      sendHostManagedInstanceNotification(
        instance.hostId,
        'destroy',
        {
          username: user.username,
          instanceName: instance.name,
          refundAmount,
          feeAmount
        }
      ).catch(err => {
        request.log.warn(err, '发送节点销毁通知失败')
      })

      // 10. 向套餐绑定的通知渠道发送"资源释放"通知
      if (instance.packageId) {
        sendReleaseNotification({
          packageId: instance.packageId,
          cpu: instance.cpu,
          memory: instance.memory,
          source: '用户销毁实例'
        }).catch(() => {})
      }

      return {
        success: true,
        message: isFreeInstance
          ? '实例已销毁'
          : `实例已销毁${refundAmount > 0 ? `，已退款 ¥${refundAmount.toFixed(2)}` : ''}${feeAmount > 0 ? `（手续费 ¥${feeAmount.toFixed(2)}）` : ''}`,
        refundAmount,
        feeAmount,
        isFirstTime,
        isFreeInstance
      }
    } catch (error) {
      request.log.error(error, '销毁实例失败')
      return reply.code(500).send({ error: '销毁实例失败' })
    }
  })
}
