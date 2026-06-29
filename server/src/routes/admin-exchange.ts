import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { customAlphabet } from 'nanoid'
import { prisma } from '../db/prisma.js'
import { EXCHANGE_ORDER_LOCK_NAMESPACE, USER_BALANCE_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { recordExchangeDisputeWalletReleaseInTransaction, releaseExchangeOrderEscrow } from '../services/exchange.js'
import { createLog } from '../db/logs.js'
import { sendNotification } from '../lib/notifier.js'
import { getHostById } from '../db/hosts.js'
import { getIncusClient } from '../lib/incus/index.js'
import { stopInstance } from '../lib/incus/incus-instances.js'
import { instanceExists, renameInstance as renameIncusInstance } from '../lib/incus/incus-restore.js'

const MAX_PAGE_SIZE = 100
const POSITIVE_ID_RE = /^[1-9]\d*$/
const activeDisputeStatuses = ['open', 'processing', 'redelivering'] as const
const exchangeReturnSuffix = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)
const exchangeDeliveryProgressSteps = [
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
  'preserve_traffic_usage',
  'complete'
] as const

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !POSITIVE_ID_RE.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePage(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parsePageSize(value: unknown, fallback = 20): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, MAX_PAGE_SIZE)
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

function normalizeMoney(value: unknown, field: string): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${field}必须是非负金额`)
  }
  return Number(numeric.toFixed(2))
}

function normalizeInt(value: unknown, field: string, min = 0): number {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < min) {
    throw new Error(`${field}必须是不小于 ${min} 的整数`)
  }
  return numeric
}

function normalizeOptionalMoney(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null
  return normalizeMoney(value, field)
}

function normalizeIdList(value: unknown, field: string): number[] {
  if (value === null || value === undefined || value === '') return []
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,，]+/)
      : null
  if (!rawItems) {
    throw new Error(`${field}必须是 ID 数组或用逗号/空格分隔的 ID 列表`)
  }
  const ids = rawItems
    .map(item => Number(typeof item === 'string' ? item.trim() : item))
    .filter(item => Number.isSafeInteger(item) && item > 0)
  return [...new Set(ids)]
}

function normalizeText(value: unknown, fallback = '', maxLength = 500): string {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  return text ? text.slice(0, maxLength) : fallback
}

async function assertWithdrawalStillPayable(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  const account = await tx.user.findUnique({
    where: { id: userId },
    select: { status: true }
  })
  if (!account || account.status !== 'active') {
    throw new Error('用户账号状态异常，不能提现')
  }

  const [restriction, openDisputes, unsettledSales] = await Promise.all([
    tx.userOrderRestriction.findFirst({
      where: { userId, status: 'active' },
      select: { id: true }
    }),
    tx.exchangeDispute.count({
      where: {
        status: { in: [...activeDisputeStatuses] },
        order: {
          OR: [
            { buyerUserId: userId },
            { sellerUserId: userId }
          ]
        }
      }
    }),
    tx.exchangeOrder.count({
      where: {
        sellerUserId: userId,
        status: { in: ['escrowed', 'delivering', 'delivered', 'confirming', 'disputed', 'manual_review'] }
      }
    })
  ])

  if (restriction) {
    throw new Error('用户账号处于风控限制中，不能审核或完成提现')
  }
  if (openDisputes > 0) {
    throw new Error('用户存在未完结交易所争议，不能审核或完成提现')
  }
  if (unsettledSales > 0) {
    throw new Error('用户存在未结算交易或确认期未结束，不能审核或完成提现')
  }
}

function normalizePositiveMoney(value: unknown, field: string): number {
  const amount = normalizeMoney(value, field)
  if (amount <= 0) throw new Error(`${field}必须大于 0`)
  return amount
}

function normalizeSignedMoney(value: unknown, field: string): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`${field}必须是有效金额`)
  }
  return Number(numeric.toFixed(2))
}

function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize }
}

function decimalPolicy(policy: NonNullable<Awaited<ReturnType<typeof getPolicy>>>) {
  return {
    ...policy,
    forceStoppedRequired: true,
    minPrice: toNumber(policy.minPrice),
    maxPrice: policy.maxPrice === null ? null : toNumber(policy.maxPrice),
    feePercent: toNumber(policy.feePercent),
    minFee: toNumber(policy.minFee),
    maxFee: policy.maxFee === null ? null : toNumber(policy.maxFee),
    minWithdrawalAmount: toNumber(policy.minWithdrawalAmount),
    dailyWithdrawalLimit: policy.dailyWithdrawalLimit === null ? null : toNumber(policy.dailyWithdrawalLimit)
  }
}

function serializeExchangeWallet(wallet: {
  id: number
  userId: number
  availableAmount: Prisma.Decimal
  frozenAmount: Prisma.Decimal
  createdAt: Date
  updatedAt: Date
  user?: { id: number; username: string; email: string | null; status?: string } | null
}) {
  return {
    ...wallet,
    availableAmount: toNumber(wallet.availableAmount),
    frozenAmount: toNumber(wallet.frozenAmount)
  }
}

async function getPolicy() {
  const policy = await prisma.exchangePolicyConfig.findFirst({ orderBy: { id: 'asc' } })
  if (policy) return policy
  return prisma.exchangePolicyConfig.create({ data: { enabled: false } })
}

async function audit(actorUserId: number | null, action: string, targetType: string, targetId: number | null, detail: unknown = {}) {
  await prisma.exchangeAuditLog.create({
    data: {
      actorUserId,
      action,
      targetType,
      targetId,
      detail: detail as Prisma.InputJsonValue
    }
  })
}

async function auditInTransaction(
  tx: Prisma.TransactionClient,
  actorUserId: number | null,
  action: string,
  targetType: string,
  targetId: number | null,
  detail: unknown = {}
) {
  await tx.exchangeAuditLog.create({
    data: {
      actorUserId,
      action,
      targetType,
      targetId,
      detail: detail as Prisma.InputJsonValue
    }
  })
}

type ExchangeRefundInstanceReturnResult = {
  returned: boolean
  reason: string
  instanceId?: number
  previousOwnerUserId?: number
  restoredOwnerUserId?: number
  oldIncusId?: string
  restoredIncusId?: string
  restoredDisplayName?: string
  auditLogId?: number
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Prisma.JsonObject : null
}

function jsonString(value: Prisma.JsonValue | null | undefined, key: string): string | null {
  const object = jsonObject(value)
  const item = object?.[key]
  return typeof item === 'string' && item.trim() ? item.trim() : null
}

function buildSellerReturnIncusId(sellerUserId: number): string {
  return `u${sellerUserId}-${exchangeReturnSuffix()}`
}

function resolveReturnDisplayName(orderNo: string, orderSnapshot: Prisma.JsonValue, listingSnapshot: Prisma.JsonValue): string {
  const snapshotName = jsonString(orderSnapshot, 'name') || jsonString(listingSnapshot, 'name')
  if (snapshotName) return snapshotName.slice(0, 64)
  return `exchange-return-${orderNo.toLowerCase()}`.slice(0, 64)
}

function resolveOriginalSellerIncusId(auditLogs: Array<{ detail: Prisma.JsonValue }>, sellerUserId: number): string | null {
  for (const log of auditLogs) {
    const oldIncusId = jsonString(log.detail, 'oldIncusId')
    if (oldIncusId?.startsWith(`u${sellerUserId}-`)) return oldIncusId
  }
  return null
}

async function resolveAvailableReturnIncusId(
  client: Awaited<ReturnType<typeof getIncusClient>>,
  preferredIncusId: string | null,
  sellerUserId: number,
  currentIncusId: string
): Promise<string> {
  if (preferredIncusId && preferredIncusId !== currentIncusId && !await instanceExists(client, preferredIncusId)) {
    return preferredIncusId
  }
  let nextIncusId = buildSellerReturnIncusId(sellerUserId)
  while (await instanceExists(client, nextIncusId)) {
    nextIncusId = buildSellerReturnIncusId(sellerUserId)
  }
  return nextIncusId
}

async function returnDeliveredExchangeInstanceForRefund(
  orderId: number,
  actorUserId: number,
  reason: string
): Promise<ExchangeRefundInstanceReturnResult> {
  const context = await prisma.$transaction(async tx => {
    const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, orderId)
    if (!orderLocked) throw new Error('交易订单正在处理，请稍后重试')

    const order = await tx.exchangeOrder.findUnique({
      where: { id: orderId },
      include: {
        listing: { select: { snapshot: true } },
        instance: {
          select: {
            id: true,
            userId: true,
            status: true,
            incusId: true,
            name: true,
            hostId: true
          }
        }
      }
    })
    if (!order) throw new Error('交易订单不存在')
    if (['completed', 'refunded', 'cancelled'].includes(order.status)) {
      throw new Error('当前订单状态不能退款')
    }
    if (order.instance.status === 'deleted') {
      return { returned: false as const, reason: 'instance_deleted' }
    }
    if (order.instance.userId !== order.buyerUserId) {
      return { returned: false as const, reason: 'not_delivered_to_buyer' }
    }

    const claimed = await tx.exchangeOrder.updateMany({
      where: {
        id: order.id,
        status: { notIn: ['completed', 'refunded', 'cancelled'] },
        refundBalanceLogId: null
      },
      data: {
        status: 'manual_review',
        failureReason: `退款退机处理中：${reason}`
      }
    })
    if (claimed.count !== 1) {
      throw new Error('订单退款状态已变化，请刷新后重试')
    }

    const deliveryAudits = await tx.exchangeAuditLog.findMany({
      where: {
        action: 'delivery.completed',
        targetType: 'exchange_order',
        targetId: order.id
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { detail: true }
    })

    return {
      returned: true as const,
      orderNo: order.orderNo,
      instanceId: order.instanceId,
      buyerUserId: order.buyerUserId,
      sellerUserId: order.sellerUserId,
      hostId: order.instance.hostId,
      currentIncusId: order.instance.incusId,
      currentDisplayName: order.instance.name,
      preferredIncusId: resolveOriginalSellerIncusId(deliveryAudits, order.sellerUserId),
      restoredDisplayName: resolveReturnDisplayName(order.orderNo, order.snapshot, order.listing.snapshot)
    }
  })

  if (!context.returned) return context

  const host = await getHostById(context.hostId)
  if (!host) throw new Error('交割节点不存在，无法退回实例')
  const client = await getIncusClient(host)
  const restoredIncusId = await resolveAvailableReturnIncusId(
    client,
    context.preferredIncusId,
    context.sellerUserId,
    context.currentIncusId
  )

  await stopInstance(client, context.currentIncusId, true)
  await renameIncusInstance(client, context.currentIncusId, restoredIncusId)

  try {
    return await prisma.$transaction(async tx => {
      const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, orderId)
      if (!orderLocked) throw new Error('交易订单正在处理，请稍后重试')

      const updatedInstance = await tx.instance.updateMany({
        where: {
          id: context.instanceId,
          userId: context.buyerUserId,
          incusId: context.currentIncusId,
          status: { not: 'deleted' }
        },
        data: {
          userId: context.sellerUserId,
          incusId: restoredIncusId,
          name: context.restoredDisplayName,
          status: 'stopped',
          suspendedAt: null,
          suspendedBy: null,
          suspendReason: null,
          autoRenew: false,
          autoRenewAttempts: 0,
          lastAutoRenewAttemptAt: null,
          expiryNotifiedAt: null,
          displayOrder: 0,
          cloudInitState: null,
          cloudInitSource: null,
          cloudInitLastCheckedAt: null,
          cloudInitCompletedAt: null,
          cloudInitManualCompletedAt: null,
          cloudInitManualCompletedBy: null
        }
      })
      if (updatedInstance.count !== 1) {
        throw new Error('实例归属已变化，不能自动退回；请人工核对')
      }

      const auditLog = await tx.exchangeAuditLog.create({
        data: {
          actorUserId,
          action: 'order.refund_instance_return',
          targetType: 'exchange_order',
          targetId: orderId,
          detail: {
            reason,
            instanceId: context.instanceId,
            buyerUserId: context.buyerUserId,
            sellerUserId: context.sellerUserId,
            oldIncusId: context.currentIncusId,
            restoredIncusId,
            preferredIncusId: context.preferredIncusId,
            restoredDisplayName: context.restoredDisplayName,
            previousDisplayName: context.currentDisplayName,
            stoppedBeforeReturn: true,
            trafficUsagePreserved: true,
            note: 'Dispute/order refund returned the delivered instance ownership to the original seller before refunding buyer funds'
          }
        }
      })

      return {
        returned: true,
        reason: 'returned_to_seller',
        instanceId: context.instanceId,
        previousOwnerUserId: context.buyerUserId,
        restoredOwnerUserId: context.sellerUserId,
        oldIncusId: context.currentIncusId,
        restoredIncusId,
        restoredDisplayName: context.restoredDisplayName,
        auditLogId: auditLog.id
      }
    })
  } catch (error) {
    try {
      await renameIncusInstance(client, restoredIncusId, context.currentIncusId)
    } catch (rollbackError) {
      console.error('[AdminExchange] CRITICAL: failed to rollback exchange refund instance return:', {
        orderId,
        instanceId: context.instanceId,
        oldIncusId: context.currentIncusId,
        restoredIncusId,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      })
    }
    throw error
  }
}

async function refundExchangeOrder(
  orderId: number,
  actorUserId: number,
  reason: string,
  targetStatus: 'refunded' | 'cancelled' = 'refunded'
) {
  const instanceReturn = await returnDeliveredExchangeInstanceForRefund(orderId, actorUserId, reason)
  return prisma.$transaction(async tx => {
    const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, orderId)
    if (!orderLocked) throw new Error('交易订单正在处理，请稍后重试')

    const order = await tx.exchangeOrder.findUnique({
      where: { id: orderId },
      include: {
        listing: true,
        instance: { select: { id: true, userId: true, status: true } }
      }
    })
    if (!order) throw new Error('交易订单不存在')
    if (['completed', 'refunded', 'cancelled'].includes(order.status)) {
      throw new Error('当前订单状态不能退款')
    }

    const refundAmount = toNumber(order.escrowAmount || order.price)
    if (refundAmount <= 0) throw new Error('退款金额无效')

    const claimed = await tx.exchangeOrder.updateMany({
      where: {
        id: order.id,
        status: { notIn: ['completed', 'refunded', 'cancelled'] },
        refundBalanceLogId: null
      },
      data: {
        status: 'manual_review',
        failureReason: `退款处理中：${reason}`
      }
    })
    if (claimed.count !== 1) {
      throw new Error('订单退款状态已变化，请刷新后重试')
    }

    const locked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, order.buyerUserId)
    if (!locked) throw new Error('买家余额正在处理，请稍后重试')

    const buyer = await tx.user.findUnique({
      where: { id: order.buyerUserId },
      select: { balance: true }
    })
    if (!buyer) throw new Error('买家不存在')

    const balanceBefore = toNumber(buyer.balance)
    const balanceAfter = Number((balanceBefore + refundAmount).toFixed(2))
    await tx.user.update({
      where: { id: order.buyerUserId },
      data: { balance: { increment: refundAmount } }
    })
    const balanceLog = await tx.balanceLog.create({
      data: {
        userId: order.buyerUserId,
	        type: 'exchange_refund',
	        amount: refundAmount,
        balanceBefore,
        balanceAfter,
        orderId: order.orderNo,
        instanceId: order.instanceId,
        remark: `交易所订单退款：${reason}`
      }
    })
    const buyerRefundBillingRecord = await tx.instanceBillingRecord.create({
      data: {
        instanceId: order.instanceId,
        userId: order.buyerUserId,
        type: 'refund',
        amount: refundAmount,
        months: 0,
        periodStart: new Date(),
        periodEnd: new Date(),
        balanceLogId: balanceLog.id,
        remark: `交易所订单退款 ${order.orderNo}：${reason}`
      },
      select: { id: true }
    })

    let deliveredBuyerInstanceSuspended = false
    if (order.instance.userId === order.buyerUserId && order.instance.status !== 'deleted') {
      await tx.instance.update({
        where: { id: order.instanceId },
        data: {
          status: 'suspended',
          suspendedAt: new Date(),
          suspendedBy: actorUserId,
          suspendReason: `exchange_${targetStatus}`,
          autoRenew: false,
          autoRenewAttempts: 0,
          lastAutoRenewAttemptAt: null
        }
      })
      deliveredBuyerInstanceSuspended = true
    }

	    const buyerExchangeWallet = await tx.exchangeWallet.upsert({
	      where: { userId: order.buyerUserId },
	      update: {},
	      create: { userId: order.buyerUserId }
	    })
	    const refundWalletLog = await tx.exchangeWalletLog.create({
	      data: {
	        walletId: buyerExchangeWallet.id,
	        userId: order.buyerUserId,
	        type: 'escrow_refund',
	        amount: -refundAmount,
	        availableBefore: buyerExchangeWallet.availableAmount,
	        availableAfter: buyerExchangeWallet.availableAmount,
	        frozenBefore: buyerExchangeWallet.frozenAmount,
	        frozenAfter: buyerExchangeWallet.frozenAmount,
	        orderId: order.id,
	        balanceLogId: balanceLog.id,
	        remark: `交易所订单 ${order.orderNo} 托管款退回买家账户余额：${reason}`
	      }
	    })

    await tx.exchangeDeliveryTask.updateMany({
      where: {
        orderId: order.id,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      data: {
        status: 'CANCELLED',
        step: 'refunded',
        error: reason,
        finishedAt: new Date()
      }
    })
    await tx.exchangeListing.update({
      where: { id: order.listingId },
      data: {
        status: 'force_delisted',
        delistedAt: new Date()
      }
    })
    const updatedOrder = await tx.exchangeOrder.update({
      where: { id: order.id },
      data: {
        status: targetStatus,
        refundBalanceLogId: balanceLog.id,
        cancelledAt: new Date(),
        failureReason: reason
      }
    })
    await tx.exchangeAuditLog.create({
      data: {
        actorUserId,
	        action: targetStatus === 'cancelled' ? 'order.cancel' : 'order.refund',
	        targetType: 'exchange_order',
	        targetId: order.id,
	        detail: {
            reason,
            refundAmount,
            balanceLogId: balanceLog.id,
            refundWalletLogId: refundWalletLog.id,
            buyerRefundBillingRecordId: buyerRefundBillingRecord.id,
            deliveredBuyerInstanceSuspended,
            deliveredBuyerInstanceReturned: instanceReturn.returned,
            instanceReturn,
            targetStatus
          }
	      }
	    })
    return updatedOrder
  })
}

async function freezeExchangeOrder(orderId: number, actorUserId: number, reason: string) {
  return prisma.$transaction(async tx => {
    const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, orderId)
    if (!orderLocked) throw new Error('交易订单正在处理，请稍后重试')

    const order = await tx.exchangeOrder.findUnique({ where: { id: orderId } })
    if (!order) throw new Error('交易订单不存在')
    if (['completed', 'refunded', 'cancelled'].includes(order.status)) {
      throw new Error('当前订单状态不能冻结')
    }
    await tx.exchangeDeliveryTask.updateMany({
      where: {
        orderId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      data: {
        status: 'FAILED',
        step: 'manual_review',
        error: `管理员冻结订单：${reason}`,
        finishedAt: new Date()
      }
    })
    const frozen = await tx.exchangeOrder.updateMany({
      where: { id: orderId, status: { notIn: ['completed', 'refunded', 'cancelled'] } },
      data: {
        status: 'manual_review',
        failureReason: reason
      }
    })
    if (frozen.count !== 1) {
      throw new Error('订单状态已变化，请刷新后重试')
    }
    const updated = await tx.exchangeOrder.findUniqueOrThrow({ where: { id: orderId } })
    await tx.exchangeAuditLog.create({
      data: {
        actorUserId,
        action: 'order.freeze',
        targetType: 'exchange_order',
        targetId: orderId,
        detail: { reason, previousStatus: order.status }
      }
    })
    return updated
  })
}

async function markDeliveryTaskManual(
  taskId: number,
  actorUserId: number,
  reason: string,
  mode: 'manual_takeover' | 'rollback_required'
) {
  return prisma.$transaction(async tx => {
    const task = await tx.exchangeDeliveryTask.findUnique({
      where: { id: taskId },
      include: { order: true }
    })
    if (!task) throw new Error('交割任务不存在')
    if (['completed', 'refunded', 'cancelled'].includes(task.order.status)) {
      throw new Error('当前订单状态不能进入人工处理')
    }
    const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, task.orderId)
    if (!orderLocked) throw new Error('交易订单正在处理，请稍后重试')

    const now = new Date()
    const step = mode === 'rollback_required' ? 'rollback_required' : 'manual_takeover'
    const message = mode === 'rollback_required'
      ? `管理员回滚交割：${reason}`
      : `管理员人工接管交割：${reason}`

    const claimedTask = await tx.exchangeDeliveryTask.updateMany({
      where: { id: taskId, status: { in: ['PENDING', 'PROCESSING', 'FAILED', 'CANCELLED'] } },
      data: {
        status: mode === 'rollback_required' ? 'CANCELLED' : 'FAILED',
        step,
        progress: {
          step,
          reason,
          note: mode === 'rollback_required'
            ? '自动交割已停止，订单进入人工审核；如已发生 owner 转移或重装，请人工核对后再退款、重试或标记完成。'
            : '自动交割已停止，等待管理员人工核对实例、订单和资金状态。'
        },
        error: message,
        finishedAt: now
      }
    })
    if (claimedTask.count !== 1) {
      throw new Error('交割任务状态已变化，请刷新后重试')
    }
    const updatedTask = await tx.exchangeDeliveryTask.findUniqueOrThrow({ where: { id: taskId } })

    const claimedOrder = await tx.exchangeOrder.updateMany({
      where: { id: task.orderId, status: { notIn: ['completed', 'refunded', 'cancelled'] } },
      data: {
        status: 'manual_review',
        failureReason: message
      }
    })
    if (claimedOrder.count !== 1) {
      throw new Error('订单状态已变化，请刷新后重试')
    }
    await tx.exchangeListing.update({
      where: { id: task.order.listingId },
      data: { status: 'delivery_failed' }
    })
    await tx.exchangeAuditLog.create({
      data: {
        actorUserId,
        action: mode === 'rollback_required' ? 'delivery.rollback' : 'delivery.manual_takeover',
        targetType: 'exchange_delivery_task',
        targetId: taskId,
        detail: {
          reason,
          previousTaskStatus: task.status,
          previousOrderStatus: task.order.status,
          orderId: task.orderId,
          listingId: task.order.listingId
        }
      }
    })
    return updatedTask
  })
}

async function completeDeliveryTaskManually(taskId: number, actorUserId: number, reason: string) {
  const result = await prisma.$transaction(async tx => {
    const task = await tx.exchangeDeliveryTask.findUnique({
      where: { id: taskId },
      include: {
        order: true,
        instanceTask: { select: { status: true } },
        instance: { select: { id: true, name: true, incusId: true, userId: true, expiresAt: true } }
      }
    })
    if (!task) throw new Error('交割任务不存在')
    if (task.status === 'COMPLETED') throw new Error('交割任务已完成')
    if (['completed', 'refunded', 'cancelled'].includes(task.order.status)) {
      throw new Error('当前订单状态不能人工标记交割完成')
    }
    const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, task.orderId)
    if (!orderLocked) throw new Error('交易订单正在处理，请稍后重试')
    if (task.instance.userId !== task.buyerUserId) {
      throw new Error('实例尚未转移给买家，不能人工确认交割完成')
    }
    if (!task.instance.incusId.startsWith(`u${task.buyerUserId}-`) || !task.instance.name.startsWith('exchange-')) {
      throw new Error('实例尚未完成匿名交割重命名，不能人工确认交割完成')
    }
    if (task.instanceTask && task.instanceTask.status !== 'COMPLETED') {
      throw new Error('关联重装任务尚未完成，不能人工确认交割完成')
    }

    const policy = await tx.exchangePolicyConfig.findFirst({ orderBy: { id: 'asc' } })
    const confirmationHours = Math.max(0, policy?.confirmationHours ?? 24)
    const confirmationDueAt = new Date(Date.now() + confirmationHours * 60 * 60 * 1000)
    const deliveredAt = new Date()
    await tx.instance.update({
      where: { id: task.instanceId },
      data: {
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
    const existingBuyerBillingRecord = await tx.instanceBillingRecord.findFirst({
      where: {
        instanceId: task.instanceId,
        userId: task.buyerUserId,
        type: 'newPurchase',
        remark: `交易所购买 ${task.order.orderNo}`
      },
      select: { id: true }
    })
    const buyerBillingRecord = existingBuyerBillingRecord || await tx.instanceBillingRecord.create({
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
      },
      select: { id: true }
    })
    const completed = await tx.exchangeDeliveryTask.updateMany({
      where: {
        id: taskId,
        status: { not: 'COMPLETED' }
      },
      data: {
        status: 'COMPLETED',
        step: 'complete',
        progress: {
          steps: [...exchangeDeliveryProgressSteps],
          current: 'complete',
          manualCompleted: true,
          reason
        },
        error: null,
        finishedAt: new Date()
      }
    })
    if (completed.count !== 1) {
      throw new Error('交割任务状态已变化，请刷新后重试')
    }
    const claimedOrder = await tx.exchangeOrder.updateMany({
      where: {
        id: task.orderId,
        status: { notIn: ['completed', 'refunded', 'cancelled'] }
      },
      data: {
        status: 'confirming',
        confirmationDueAt,
        failureReason: null
      }
    })
    if (claimedOrder.count !== 1) {
      throw new Error('订单状态已变化，请刷新后重试')
    }
    await tx.exchangeListing.update({
      where: { id: task.order.listingId },
      data: { status: 'sold' }
    })
    const updatedTask = await tx.exchangeDeliveryTask.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        order: true,
        instance: { select: { id: true, name: true } }
      }
    })
    await tx.exchangeAuditLog.create({
      data: {
        actorUserId,
        action: 'delivery.manual_complete',
        targetType: 'exchange_delivery_task',
        targetId: taskId,
        detail: {
          reason,
          orderId: task.orderId,
          listingId: task.order.listingId,
          instanceId: task.instanceId,
          previousTaskStatus: task.status,
          previousOrderStatus: task.order.status,
          confirmationDueAt,
          confirmationHours,
          manualCompleted: true,
          manualSafetyChecks: {
            ownerTransferredToBuyer: true,
            anonymousIncusIdVerified: true,
            anonymousDisplayNameVerified: true,
            linkedRebuildTaskCompleted: task.instanceTask ? true : null,
            trafficUsagePreserved: true,
            autoRenewDisabled: true,
            buyerBillingRecordId: buyerBillingRecord.id
          }
        }
      }
    })
    return updatedTask
  })

  const notificationData = {
    orderNo: result.order.orderNo,
    instanceName: result.instance?.name || `#${result.instanceId}`,
    confirmationDueAt: result.order.confirmationDueAt?.toISOString?.() ?? null
  }
  await Promise.allSettled([
    createLog(result.buyerUserId, 'exchange', 'exchange.delivery.completed', `交易所订单 ${result.order.orderNo} 已由管理员确认完成交割`, 'success', { instanceId: result.instanceId }),
    createLog(result.sellerUserId, 'exchange', 'exchange.order.confirming', `交易所订单 ${result.order.orderNo} 已完成交割，等待确认期结束后结算`, 'info', { instanceId: result.instanceId }),
    sendNotification(result.buyerUserId, 'exchange_delivery_completed', notificationData),
    sendNotification(result.sellerUserId, 'exchange_sale_confirming', notificationData)
  ]).then(results => {
    const failed = results.filter(item => item.status === 'rejected')
    if (failed.length > 0) {
      console.error(`[AdminExchange] manual delivery ${taskId} notifications/logs failed:`, failed.map(item => item.reason))
    }
  })
  return result
}

async function claimExchangeDisputeForProcessing(
  disputeId: number,
  actorUserId: number,
  resolution: string
) {
  return prisma.$transaction(async tx => {
    const dispute = await tx.exchangeDispute.findUnique({
      where: { id: disputeId },
      include: { order: true }
    })
    if (!dispute) throw new Error('争议不存在')

    const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, dispute.orderId)
    if (!orderLocked) throw new Error('交易订单正在处理，请稍后重试')
    if (dispute.status === 'processing' && dispute.handledByUserId && dispute.handledByUserId !== actorUserId) {
      throw new Error('争议已由其他管理员处理中，请刷新后重试')
    }

    const claimed = await tx.exchangeDispute.updateMany({
      where: {
        id: disputeId,
        OR: [
          { status: 'open' },
          { status: 'processing', handledByUserId: null },
          { status: 'processing', handledByUserId: actorUserId }
        ]
      },
      data: {
        status: 'processing',
        handledByUserId: actorUserId,
        resolution,
        resolvedAt: null
      }
    })
    if (claimed.count !== 1) {
      throw new Error('争议状态已变化，请刷新后重试')
    }
    return dispute
  })
}

async function restoreProcessingDispute(disputeId: number, actorUserId: number) {
  await prisma.exchangeDispute.updateMany({
    where: {
      id: disputeId,
      status: 'processing',
      handledByUserId: actorUserId
    },
    data: {
      status: 'open',
      handledByUserId: null,
      resolution: null,
      resolvedAt: null
    }
  })
}

export default async function adminExchangeRoutes(fastify: FastifyInstance) {
  fastify.get('/overview', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const [
      activeListings,
      lockedListings,
      deliveringOrders,
      disputedOrders,
      pendingWithdrawals,
      openDisputes,
      pendingDeliveryTasks
    ] = await Promise.all([
      prisma.exchangeListing.count({ where: { status: 'active' } }),
      prisma.exchangeListing.count({ where: { status: 'locked' } }),
      prisma.exchangeOrder.count({ where: { status: { in: ['escrowed', 'delivering', 'delivered', 'confirming'] } } }),
      prisma.exchangeOrder.count({ where: { status: { in: ['disputed', 'manual_review'] } } }),
      prisma.exchangeWithdrawal.count({ where: { status: 'pending' } }),
      prisma.exchangeDispute.count({ where: { status: { in: [...activeDisputeStatuses] } } }),
      prisma.exchangeDeliveryTask.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } })
    ])
    return {
      counters: {
        activeListings,
        lockedListings,
        deliveringOrders,
        disputedOrders,
        pendingWithdrawals,
        openDisputes,
        pendingDeliveryTasks
      }
    }
  })

  fastify.get('/config', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => ({ policy: decimalPolicy(await getPolicy()) }))

  fastify.put('/config', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>
      const policy = await getPolicy()
      const nextPolicy = {
        enabled: Boolean(body.enabled),
        minRemainingDays: normalizeInt(body.minRemainingDays, '最低剩余有效期', 1),
        expiringSoonDays: normalizeInt(body.expiringSoonDays, '即将到期阈值', 1),
        minPrice: normalizeMoney(body.minPrice, '最低售价'),
        maxPrice: normalizeOptionalMoney(body.maxPrice, '最高售价'),
        maxMarkupPercent: normalizeInt(body.maxMarkupPercent, '最大溢价比例', 0),
        feePercent: normalizeMoney(body.feePercent, '手续费比例'),
        minFee: normalizeMoney(body.minFee, '最低手续费'),
        maxFee: normalizeOptionalMoney(body.maxFee, '最高手续费'),
        confirmationHours: normalizeInt(body.confirmationHours, '确认期', 1),
        autoConfirmEnabled: body.autoConfirmEnabled !== false,
        minWithdrawalAmount: normalizeMoney(body.minWithdrawalAmount, '最低提现金额'),
        dailyWithdrawalLimit: normalizeOptionalMoney(body.dailyWithdrawalLimit, '每日提现上限'),
        dailyWithdrawalCountLimit: normalizeInt(body.dailyWithdrawalCountLimit, '每日提现次数', 1),
        allowBalanceTransfer: body.allowBalanceTransfer !== false,
        allowPublicIpTransfer: body.allowPublicIpTransfer !== false,
        allowBuyerImageSelection: Boolean(body.allowBuyerImageSelection),
        maxActiveListingsPerUser: normalizeInt(body.maxActiveListingsPerUser, '每用户最大挂牌数', 1),
        maxPurchasesPerUserPerDay: normalizeInt(body.maxPurchasesPerUserPerDay, '每用户每日购买数', 1),
        disputeTimeoutHours: normalizeInt(body.disputeTimeoutHours, '争议超时', 1),
        packageAllowlist: normalizeIdList(body.packageAllowlist, '允许交易套餐'),
        hostAllowlist: normalizeIdList(body.hostAllowlist, '允许交易节点')
      }
      if (nextPolicy.maxPrice !== null && nextPolicy.maxPrice < nextPolicy.minPrice) {
        throw new Error('最高售价不能低于最低售价')
      }
      if (nextPolicy.maxFee !== null && nextPolicy.maxFee < nextPolicy.minFee) {
        throw new Error('最高手续费不能低于最低手续费')
      }
      if (nextPolicy.expiringSoonDays < nextPolicy.minRemainingDays) {
        throw new Error('即将到期阈值不能小于最低剩余有效期')
      }
      const updated = await prisma.exchangePolicyConfig.update({
        where: { id: policy.id },
        data: nextPolicy
      })
      const user = request.user as { id: number }
      await audit(user.id, 'config.update', 'exchange_policy_config', updated.id, { policy: decimalPolicy(updated) })
      return { policy: decimalPolicy(updated) }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '交易所配置无效' })
    }
  })

  fastify.get('/listings', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; status?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const where = query.status ? { status: query.status as any } : {}
    const [items, total] = await Promise.all([
      prisma.exchangeListing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          seller: { select: { id: true, username: true, email: true, status: true } },
          instance: { select: { id: true, name: true, status: true, host: { select: { id: true, name: true, status: true } } } }
        }
      }),
      prisma.exchangeListing.count({ where })
    ])
    return pageResult(items.map(item => ({
      ...item,
      price: toNumber(item.price),
      feeAmount: toNumber(item.feeAmount),
      sellerReceivesAmount: toNumber(item.sellerReceivesAmount)
    })), total, page, pageSize)
  })

  fastify.post('/listings/:id/force-delist', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '挂牌 ID 无效' })
    const body = request.body as { reason?: string } | undefined
    const reason = normalizeText(body?.reason, '管理员强制下架')
    const listing = await prisma.exchangeListing.findUnique({ where: { id } })
    if (!listing) return reply.code(404).send({ error: '挂牌不存在' })
    if (!['active', 'paused', 'delivery_failed'].includes(listing.status)) {
      return reply.code(409).send({ error: '当前挂牌已有锁定订单，不能直接强制下架；请走退款、重试交割或争议处理' })
    }
    const updated = await prisma.exchangeListing.update({
      where: { id },
      data: { status: 'force_delisted', delistedAt: new Date() }
    })
    const user = request.user as { id: number }
    await audit(user.id, 'listing.force_delist', 'exchange_listing', id, { reason })
    return { listing: updated }
  })

  fastify.get('/orders', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; status?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const where = query.status ? { status: query.status as any } : {}
    const [items, total] = await Promise.all([
      prisma.exchangeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          buyer: { select: { id: true, username: true, email: true, status: true } },
          seller: { select: { id: true, username: true, email: true, status: true } },
          instance: { select: { id: true, name: true, status: true } },
          deliveryTasks: { orderBy: { createdAt: 'desc' }, take: 1 }
        }
      }),
      prisma.exchangeOrder.count({ where })
    ])
    return pageResult(items.map(item => ({
      ...item,
      price: toNumber(item.price),
      feeAmount: toNumber(item.feeAmount),
      sellerReceivesAmount: toNumber(item.sellerReceivesAmount),
      escrowAmount: toNumber(item.escrowAmount)
    })), total, page, pageSize)
  })

  fastify.post('/orders/:id/refund', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '订单 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { reason?: string } | undefined
    const reason = normalizeText(body?.reason, '')
    if (!reason) return reply.code(400).send({ error: '退款原因不能为空' })
    try {
      const order = await refundExchangeOrder(id, user.id, reason)
      return {
        order: {
          ...order,
          price: toNumber(order.price),
          feeAmount: toNumber(order.feeAmount),
          sellerReceivesAmount: toNumber(order.sellerReceivesAmount),
          escrowAmount: toNumber(order.escrowAmount)
        }
      }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '订单退款失败' })
    }
  })

  fastify.post('/orders/:id/freeze', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '订单 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { reason?: string } | undefined
    const reason = normalizeText(body?.reason, '')
    if (!reason) return reply.code(400).send({ error: '冻结原因不能为空' })
    try {
      const order = await freezeExchangeOrder(id, user.id, reason)
      return {
        order: {
          ...order,
          price: toNumber(order.price),
          feeAmount: toNumber(order.feeAmount),
          sellerReceivesAmount: toNumber(order.sellerReceivesAmount),
          escrowAmount: toNumber(order.escrowAmount)
        }
      }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '冻结订单失败' })
    }
  })

  fastify.post('/orders/:id/cancel', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '订单 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { reason?: string } | undefined
    const reason = normalizeText(body?.reason, '')
    if (!reason) return reply.code(400).send({ error: '取消原因不能为空' })
    try {
      const order = await refundExchangeOrder(id, user.id, reason, 'cancelled')
      return {
        order: {
          ...order,
          price: toNumber(order.price),
          feeAmount: toNumber(order.feeAmount),
          sellerReceivesAmount: toNumber(order.sellerReceivesAmount),
          escrowAmount: toNumber(order.escrowAmount)
        }
      }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '取消交易失败' })
    }
  })

  fastify.get('/delivery-tasks', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; status?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const where = query.status ? { status: query.status as any } : {}
    const [items, total] = await Promise.all([
      prisma.exchangeDeliveryTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          order: { select: { id: true, orderNo: true, status: true } },
          instance: { select: { id: true, name: true, status: true } }
        }
      }),
      prisma.exchangeDeliveryTask.count({ where })
    ])
    return pageResult(items, total, page, pageSize)
  })

  fastify.post('/delivery-tasks/:id/retry', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '交割任务 ID 无效' })
    const user = request.user as { id: number }
    try {
      const task = await prisma.$transaction(async tx => {
        const current = await tx.exchangeDeliveryTask.findUnique({
          where: { id },
          include: { order: true }
        })
        if (!current) throw new Error('交割任务不存在')
        if (!['FAILED', 'CANCELLED'].includes(current.status)) {
          throw new Error('只有失败、回滚或人工接管后的交割任务可以重试')
        }
        if (['completed', 'refunded', 'cancelled'].includes(current.order.status)) {
          throw new Error('订单已完成、退款或取消，不能重试交割')
        }
        const orderLocked = await tryAdvisoryTransactionLock(tx, EXCHANGE_ORDER_LOCK_NAMESPACE, current.orderId)
        if (!orderLocked) throw new Error('交易订单正在处理，请稍后重试')
        const claimedOrder = await tx.exchangeOrder.updateMany({
          where: { id: current.orderId, status: { notIn: ['completed', 'refunded', 'cancelled'] } },
          data: {
            status: 'delivering',
            failureReason: null
          }
        })
        if (claimedOrder.count !== 1) {
          throw new Error('订单状态已变化，请刷新后重试')
        }
        await tx.exchangeListing.update({
          where: { id: current.order.listingId },
          data: { status: 'locked' }
        })
        const claimedTask = await tx.exchangeDeliveryTask.updateMany({
          where: { id, status: { in: ['FAILED', 'CANCELLED'] } },
          data: {
            status: 'PENDING',
            error: null,
            retryCount: { increment: 1 },
		            step: 'lock_instance',
		            progress: {
		              steps: [...exchangeDeliveryProgressSteps],
		              current: 'lock_instance',
	              retryFrom: current.step || current.status
	            },
            instanceTaskId: null,
            startedAt: null,
            finishedAt: null
          }
        })
        if (claimedTask.count !== 1) {
          throw new Error('交割任务状态已变化，请刷新后重试')
        }
        const updatedTask = await tx.exchangeDeliveryTask.findUniqueOrThrow({ where: { id } })
        await tx.exchangeAuditLog.create({
          data: {
            actorUserId: user.id,
            action: 'delivery.retry',
            targetType: 'exchange_delivery_task',
            targetId: id,
            detail: {
              retryCount: updatedTask.retryCount,
              previousTaskStatus: current.status,
              previousOrderStatus: current.order.status,
              orderId: current.orderId,
              listingId: current.order.listingId
            }
          }
        })
        return updatedTask
      })
      return { task }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '重试交割失败' })
    }
  })

  fastify.post('/delivery-tasks/:id/manual-takeover', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '交割任务 ID 无效' })
    const body = request.body as { reason?: string } | undefined
    const reason = normalizeText(body?.reason, '管理员人工接管交割')
    const user = request.user as { id: number }
    try {
      const task = await markDeliveryTaskManual(id, user.id, reason, 'manual_takeover')
      return { task }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '人工接管交割失败' })
    }
  })

  fastify.post('/delivery-tasks/:id/rollback', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '交割任务 ID 无效' })
    const body = request.body as { reason?: string } | undefined
    const reason = normalizeText(body?.reason, '管理员回滚交割')
    const user = request.user as { id: number }
    try {
      const task = await markDeliveryTaskManual(id, user.id, reason, 'rollback_required')
      return { task }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '回滚交割失败' })
    }
  })

  fastify.post('/delivery-tasks/:id/complete', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '交割任务 ID 无效' })
    const body = request.body as { reason?: string } | undefined
    const reason = normalizeText(body?.reason, '')
    if (!reason) return reply.code(400).send({ error: '人工完成说明不能为空' })
    const user = request.user as { id: number }
    try {
      const task = await completeDeliveryTaskManually(id, user.id, reason)
      return { task }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '人工确认交割完成失败' })
    }
  })

  fastify.get('/withdrawals', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; status?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const where = query.status ? { status: query.status as any } : {}
    const [items, total] = await Promise.all([
      prisma.exchangeWithdrawal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, username: true, email: true, status: true } } }
      }),
      prisma.exchangeWithdrawal.count({ where })
    ])
    return pageResult(items.map(item => ({ ...item, amount: toNumber(item.amount) })), total, page, pageSize)
  })

  fastify.post('/withdrawals/:id/approve', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '提现 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { remark?: string } | undefined
	    try {
      const withdrawal = await prisma.$transaction(async tx => {
        const current = await tx.exchangeWithdrawal.findUnique({ where: { id } })
        if (!current) throw new Error('提现单不存在')
        if (current.status !== 'pending') {
          throw new Error('只有待审核提现可以审核通过')
        }
        await assertWithdrawalStillPayable(tx, current.userId)
        const approved = await tx.exchangeWithdrawal.updateMany({
	          where: { id, status: 'pending' },
	          data: {
	            status: 'approved',
	            reviewerUserId: user.id,
	            reviewRemark: normalizeText(body?.remark, '人工审核通过'),
	            reviewedAt: new Date()
	          }
	        })
	        if (approved.count !== 1) {
	          throw new Error('提现状态已变化，请刷新后重试')
	        }
	        return tx.exchangeWithdrawal.findUniqueOrThrow({ where: { id } })
	      })
      await audit(user.id, 'withdrawal.approve', 'exchange_withdrawal', id)
      return { withdrawal: { ...withdrawal, amount: toNumber(withdrawal.amount) } }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '审核提现失败' })
    }
  })

  fastify.post('/withdrawals/:id/complete', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '提现 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { proofUrl?: string; remark?: string } | undefined
    try {
      const withdrawal = await prisma.$transaction(async tx => {
        const current = await tx.exchangeWithdrawal.findUnique({ where: { id }, include: { wallet: true } })
        if (!current || !['approved', 'paying'].includes(current.status)) {
          throw new Error('当前提现状态不能标记完成')
        }
        const locked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, current.userId)
        if (!locked) throw new Error('用户资金正在处理，请稍后重试')
        await assertWithdrawalStillPayable(tx, current.userId)
        const claimed = await tx.exchangeWithdrawal.updateMany({
          where: { id, status: { in: ['approved', 'paying'] } },
          data: {
            status: 'paying',
            reviewerUserId: user.id,
            reviewRemark: normalizeText(body?.remark, current.reviewRemark || '提现打款处理中'),
            reviewedAt: current.reviewedAt || new Date()
          }
        })
        if (claimed.count !== 1) {
          throw new Error('提现状态已变化，请刷新后重试')
        }
        const amount = toNumber(current.amount)
        const frozenBefore = toNumber(current.wallet.frozenAmount)
        if (frozenBefore < amount) throw new Error('冻结金额不足，不能完成提现')
        const frozenAfter = Number((frozenBefore - amount).toFixed(2))
        const debited = await tx.exchangeWallet.updateMany({
          where: { id: current.walletId, frozenAmount: { gte: amount } },
          data: { frozenAmount: { decrement: amount } }
        })
        if (debited.count !== 1) {
          throw new Error('冻结金额不足，不能完成提现')
        }
        await tx.exchangeWalletLog.create({
          data: {
            walletId: current.walletId,
            userId: current.userId,
            type: 'withdrawal_complete',
            amount: -amount,
            availableBefore: current.wallet.availableAmount,
            availableAfter: current.wallet.availableAmount,
            frozenBefore,
            frozenAfter,
            withdrawalId: current.id,
            remark: normalizeText(body?.remark, '提现已人工打款完成')
          }
        })
        return tx.exchangeWithdrawal.update({
          where: { id },
          data: {
            status: 'completed',
            reviewerUserId: user.id,
            proofUrl: normalizeText(body?.proofUrl, '', 500) || null,
            reviewRemark: normalizeText(body?.remark, current.reviewRemark || '提现已完成'),
            completedAt: new Date()
          }
        })
      })
      await audit(user.id, 'withdrawal.complete', 'exchange_withdrawal', id)
      return { withdrawal: { ...withdrawal, amount: toNumber(withdrawal.amount) } }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '完成提现失败' })
    }
  })

  fastify.post('/withdrawals/:id/reject', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '提现 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { reason?: string } | undefined
    const reason = normalizeText(body?.reason, '')
    if (!reason) return reply.code(400).send({ error: '拒绝原因不能为空' })
    try {
      const withdrawal = await prisma.$transaction(async tx => {
        const current = await tx.exchangeWithdrawal.findUnique({ where: { id }, include: { wallet: true } })
        if (!current || !['pending', 'approved'].includes(current.status)) {
          throw new Error('当前提现状态不能拒绝')
        }
        const locked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, current.userId)
        if (!locked) throw new Error('用户资金正在处理，请稍后重试')
        const claimed = await tx.exchangeWithdrawal.updateMany({
          where: { id, status: { in: ['pending', 'approved'] } },
          data: {
            status: 'rejected',
            reviewerUserId: user.id,
            reviewRemark: reason,
            reviewedAt: new Date()
          }
        })
        if (claimed.count !== 1) {
          throw new Error('提现状态已变化，请刷新后重试')
        }
        const amount = toNumber(current.amount)
        const availableBefore = toNumber(current.wallet.availableAmount)
        const frozenBefore = toNumber(current.wallet.frozenAmount)
        const availableAfter = Number((availableBefore + amount).toFixed(2))
        const frozenAfter = Number((frozenBefore - amount).toFixed(2))
        if (frozenBefore < amount) throw new Error('冻结金额不足，不能拒绝提现')
        const returned = await tx.exchangeWallet.updateMany({
          where: { id: current.walletId, frozenAmount: { gte: amount } },
          data: {
            availableAmount: { increment: amount },
            frozenAmount: { decrement: amount }
          }
        })
        if (returned.count !== 1) {
          throw new Error('冻结金额不足，不能拒绝提现')
        }
        await tx.exchangeWalletLog.create({
          data: {
            walletId: current.walletId,
            userId: current.userId,
            type: 'withdrawal_reject',
            amount,
            availableBefore,
            availableAfter,
            frozenBefore,
            frozenAfter,
            withdrawalId: current.id,
            remark: `提现拒绝退回：${reason}`
          }
        })
        return tx.exchangeWithdrawal.update({
          where: { id },
          data: {
            status: 'rejected',
            reviewerUserId: user.id,
            reviewRemark: reason,
            reviewedAt: new Date()
          }
        })
      })
      await audit(user.id, 'withdrawal.reject', 'exchange_withdrawal', id, { reason })
      return { withdrawal: { ...withdrawal, amount: toNumber(withdrawal.amount) } }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '拒绝提现失败' })
    }
  })

  fastify.get('/wallets', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; userId?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const userId = query.userId ? parsePositiveId(query.userId) : null
    const where = userId ? { userId } : {}
    const [items, total] = await Promise.all([
      prisma.exchangeWallet.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, username: true, email: true, status: true } } }
      }),
      prisma.exchangeWallet.count({ where })
    ])
    return pageResult(items.map(serializeExchangeWallet), total, page, pageSize)
  })

  fastify.post('/wallets/:userId/freeze', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const targetUserId = parsePositiveId((request.params as { userId?: string }).userId)
    if (!targetUserId) return reply.code(400).send({ error: '用户 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { amount?: unknown; remark?: string } | undefined
    try {
      const amount = normalizePositiveMoney(body?.amount, '冻结金额')
      const remark = normalizeText(body?.remark, '管理员冻结交易所余额')
      const wallet = await prisma.$transaction(async tx => {
        const locked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, targetUserId)
        if (!locked) throw new Error('用户资金正在处理，请稍后重试')
        const current = await tx.exchangeWallet.upsert({
          where: { userId: targetUserId },
          update: {},
          create: { userId: targetUserId }
        })
        const availableBefore = toNumber(current.availableAmount)
        const frozenBefore = toNumber(current.frozenAmount)
        if (availableBefore < amount) throw new Error('可用交易所余额不足，不能冻结')
        const availableAfter = Number((availableBefore - amount).toFixed(2))
        const frozenAfter = Number((frozenBefore + amount).toFixed(2))
        const updated = await tx.exchangeWallet.update({
          where: { id: current.id },
          data: {
            availableAmount: { decrement: amount },
            frozenAmount: { increment: amount }
          },
          include: { user: { select: { id: true, username: true, email: true, status: true } } }
        })
        await tx.exchangeWalletLog.create({
          data: {
            walletId: current.id,
            userId: targetUserId,
            type: 'admin_adjust',
            amount: -amount,
            availableBefore,
            availableAfter,
            frozenBefore,
            frozenAfter,
            remark
          }
        })
        return updated
      })
      await audit(user.id, 'wallet.freeze', 'exchange_wallet', wallet.id, { targetUserId, amount, remark })
      return { wallet: serializeExchangeWallet(wallet) }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '冻结交易所余额失败' })
    }
  })

  fastify.post('/wallets/:userId/unfreeze', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const targetUserId = parsePositiveId((request.params as { userId?: string }).userId)
    if (!targetUserId) return reply.code(400).send({ error: '用户 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { amount?: unknown; remark?: string } | undefined
    try {
      const amount = normalizePositiveMoney(body?.amount, '解冻金额')
      const remark = normalizeText(body?.remark, '管理员解冻交易所余额')
      const wallet = await prisma.$transaction(async tx => {
        const locked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, targetUserId)
        if (!locked) throw new Error('用户资金正在处理，请稍后重试')
        const current = await tx.exchangeWallet.upsert({
          where: { userId: targetUserId },
          update: {},
          create: { userId: targetUserId }
        })
        const availableBefore = toNumber(current.availableAmount)
        const frozenBefore = toNumber(current.frozenAmount)
        if (frozenBefore < amount) throw new Error('冻结金额不足，不能解冻')
        const availableAfter = Number((availableBefore + amount).toFixed(2))
        const frozenAfter = Number((frozenBefore - amount).toFixed(2))
        const updated = await tx.exchangeWallet.update({
          where: { id: current.id },
          data: {
            availableAmount: { increment: amount },
            frozenAmount: { decrement: amount }
          },
          include: { user: { select: { id: true, username: true, email: true, status: true } } }
        })
        await tx.exchangeWalletLog.create({
          data: {
            walletId: current.id,
            userId: targetUserId,
            type: 'admin_adjust',
            amount,
            availableBefore,
            availableAfter,
            frozenBefore,
            frozenAfter,
            remark
          }
        })
        return updated
      })
      await audit(user.id, 'wallet.unfreeze', 'exchange_wallet', wallet.id, { targetUserId, amount, remark })
      return { wallet: serializeExchangeWallet(wallet) }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '解冻交易所余额失败' })
    }
  })

  fastify.post('/wallets/:userId/adjust', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const targetUserId = parsePositiveId((request.params as { userId?: string }).userId)
    if (!targetUserId) return reply.code(400).send({ error: '用户 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { amount?: unknown; remark?: string } | undefined
    try {
      const amount = normalizeSignedMoney(body?.amount, '调整金额')
      if (amount === 0) throw new Error('调整金额不能为 0')
      const remark = normalizeText(body?.remark, '管理员人工调整交易所余额')
      const wallet = await prisma.$transaction(async tx => {
        const locked = await tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, targetUserId)
        if (!locked) throw new Error('用户资金正在处理，请稍后重试')
        const current = await tx.exchangeWallet.upsert({
          where: { userId: targetUserId },
          update: {},
          create: { userId: targetUserId }
        })
        const availableBefore = toNumber(current.availableAmount)
        const frozenBefore = toNumber(current.frozenAmount)
        const availableAfter = Number((availableBefore + amount).toFixed(2))
        if (availableAfter < 0) throw new Error('调整后可用余额不能小于 0')
        const updated = await tx.exchangeWallet.update({
          where: { id: current.id },
          data: { availableAmount: { increment: amount } },
          include: { user: { select: { id: true, username: true, email: true, status: true } } }
        })
        await tx.exchangeWalletLog.create({
          data: {
            walletId: current.id,
            userId: targetUserId,
            type: 'admin_adjust',
            amount,
            availableBefore,
            availableAfter,
            frozenBefore,
            frozenAfter: frozenBefore,
            remark
          }
        })
        return updated
      })
      await audit(user.id, 'wallet.adjust', 'exchange_wallet', wallet.id, { targetUserId, amount, remark })
      return { wallet: serializeExchangeWallet(wallet) }
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || '调整交易所余额失败' })
    }
  })

  fastify.get('/risk-records', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; status?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const where = query.status ? { status: query.status } : {}
    const [items, total] = await Promise.all([
      prisma.instanceRiskState.findMany({
        where,
        orderBy: [
          { updatedAt: 'desc' },
          { id: 'desc' }
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          instance: { select: { id: true, name: true, status: true } },
          user: { select: { id: true, username: true } },
          host: { select: { id: true, name: true, status: true } }
        }
      }),
      prisma.instanceRiskState.count({ where })
    ])
    return pageResult(items, total, page, pageSize)
  })

  fastify.get('/disputes', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; status?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const where = query.status ? { status: query.status as any } : {}
    const [items, total] = await Promise.all([
      prisma.exchangeDispute.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          creator: { select: { id: true, username: true, email: true } },
          order: { select: { id: true, orderNo: true, status: true, price: true } }
        }
      }),
      prisma.exchangeDispute.count({ where })
    ])
    return pageResult(items.map(item => ({
      ...item,
      order: { ...item.order, price: toNumber(item.order.price) }
    })), total, page, pageSize)
  })

  fastify.post('/disputes/:id/reject', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '争议 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { resolution?: string } | undefined
    const resolution = normalizeText(body?.resolution, '')
    if (!resolution) return reply.code(400).send({ error: '处理说明不能为空' })
    let claimedDispute = false
    try {
      const current = await claimExchangeDisputeForProcessing(id, user.id, resolution)
      claimedDispute = true
      const dispute = await prisma.$transaction(async tx => {
        const rejected = await tx.exchangeDispute.updateMany({
          where: { id, status: 'processing', handledByUserId: user.id },
          data: {
            status: 'rejected',
            resolution,
            resolvedAt: new Date()
          }
        })
        if (rejected.count !== 1) {
          throw new Error('争议状态已变化，请刷新后重试')
        }
        if (current.order.status === 'disputed') {
          await tx.exchangeOrder.update({
            where: { id: current.orderId },
            data: {
              status: 'manual_review',
              failureReason: `争议已驳回：${resolution}`
            }
          })
        }
        const disputeReleaseLog = await recordExchangeDisputeWalletReleaseInTransaction(tx, current.orderId, `交易所争议 ${id} 已驳回，争议冻结标记解除：${resolution}`)
        await auditInTransaction(tx, user.id, 'dispute.reject', 'exchange_dispute', id, { resolution, walletLogId: disputeReleaseLog.id })
        return tx.exchangeDispute.findUniqueOrThrow({ where: { id } })
      })
      return { dispute }
    } catch (error: any) {
      if (claimedDispute) {
        await restoreProcessingDispute(id, user.id)
      }
      return reply.code(400).send({ error: error?.message || '驳回争议失败' })
    }
  })

  fastify.post('/disputes/:id/refund', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '争议 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { resolution?: string } | undefined
    const resolution = normalizeText(body?.resolution, '')
    if (!resolution) return reply.code(400).send({ error: '退款说明不能为空' })
    let orderActionCompleted = false
    try {
      const dispute = await claimExchangeDisputeForProcessing(id, user.id, resolution)
      await refundExchangeOrder(dispute.orderId, user.id, resolution)
      orderActionCompleted = true
      const updated = await prisma.$transaction(async tx => {
        const resolved = await tx.exchangeDispute.updateMany({
          where: { id, status: 'processing', handledByUserId: user.id },
          data: {
            status: 'refunded',
            resolution,
            resolvedAt: new Date()
          }
        })
        if (resolved.count !== 1) {
          throw new Error('争议状态已变化，请刷新后重试')
        }
        const disputeReleaseLog = await recordExchangeDisputeWalletReleaseInTransaction(tx, dispute.orderId, `交易所争议 ${id} 已退款，争议冻结标记解除：${resolution}`)
        await auditInTransaction(tx, user.id, 'dispute.refund', 'exchange_dispute', id, { resolution, orderId: dispute.orderId, walletLogId: disputeReleaseLog.id })
        return tx.exchangeDispute.findUniqueOrThrow({ where: { id } })
      })
      return { dispute: updated }
    } catch (error: any) {
      if (!orderActionCompleted) {
        await restoreProcessingDispute(id, user.id)
      }
      return reply.code(400).send({ error: error?.message || '争议退款失败' })
    }
  })

  fastify.post('/disputes/:id/release', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send({ error: '争议 ID 无效' })
    const user = request.user as { id: number }
    const body = request.body as { resolution?: string } | undefined
    const resolution = normalizeText(body?.resolution, '')
    if (!resolution) return reply.code(400).send({ error: '处理说明不能为空' })
    let orderActionCompleted = false
    try {
      const dispute = await claimExchangeDisputeForProcessing(id, user.id, resolution)
      await releaseExchangeOrderEscrow(dispute.orderId, {
        actorUserId: user.id,
        action: 'dispute.release',
        remark: `交易所争议 ${id} 人工放款：${resolution}`,
        allowedStatuses: ['confirming', 'delivered', 'disputed', 'manual_review'],
        resolveDispute: {
          disputeId: id,
          resolution,
          releaseRemark: `交易所争议 ${id} 人工放款，争议冻结标记解除：${resolution}`
        }
      })
      orderActionCompleted = true
      const updated = await prisma.exchangeDispute.findUniqueOrThrow({ where: { id } })
      return { dispute: updated }
    } catch (error: any) {
      if (!orderActionCompleted) {
        await restoreProcessingDispute(id, user.id)
      }
      return reply.code(400).send({ error: error?.message || '关闭争议失败' })
    }
  })

  fastify.get('/audit-logs', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const [items, total] = await Promise.all([
      prisma.exchangeAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, username: true } } }
      }),
      prisma.exchangeAuditLog.count()
    ])
    return pageResult(items, total, page, pageSize)
  })
}
