import { Prisma } from '@prisma/client'
import {
  USER_AFF_BALANCE_LOCK_NAMESPACE,
  USER_BALANCE_LOCK_NAMESPACE,
  advisoryTransactionLock
} from './advisory-locks.js'
import { prisma } from './prisma.js'

export async function compensateFailedInstancePurchase(
  instanceId: number,
  userId: number,
  hostId: number
): Promise<{ refunded: boolean; refundAmount: number; reason?: string }> {
  return prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)

    const instance = await tx.instance.findUnique({
      where: { id: instanceId },
      select: {
        id: true,
        name: true,
        userId: true,
        hostId: true
      }
    })

    if (!instance || instance.userId !== userId || instance.hostId !== hostId) {
      return { refunded: false, refundAmount: 0, reason: 'instance_not_found_or_mismatch' }
    }

    const purchaseRecord = await tx.instanceBillingRecord.findFirst({
      where: {
        instanceId,
        userId,
        type: 'newPurchase'
      },
      orderBy: { createdAt: 'asc' }
    })

    if (!purchaseRecord) {
      return { refunded: false, refundAmount: 0, reason: 'not_paid_purchase' }
    }

    const existingFailureRefund = await tx.instanceBillingRecord.findFirst({
      where: {
        instanceId,
        userId,
        type: 'refund',
        remark: { contains: '实例创建失败自动退款' }
      },
      select: { id: true }
    })

    if (existingFailureRefund) {
      return { refunded: false, refundAmount: 0, reason: 'already_refunded' }
    }

    const refundAmount = Number(purchaseRecord.amount)
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      return { refunded: false, refundAmount: 0, reason: 'invalid_purchase_amount' }
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    })
    if (!user) {
      throw new Error('用户不存在')
    }

    const balanceBefore = Number(user.balance)
    await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: refundAmount } }
    })

    const updatedUser = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true }
    })
    const balanceAfter = Number(updatedUser.balance)

    const balanceLog = await tx.balanceLog.create({
      data: {
        userId,
        type: 'refund',
        amount: refundAmount,
        balanceBefore,
        balanceAfter,
        instanceId,
        remark: `实例创建失败自动退款：${instance.name}`
      }
    })

    const now = new Date()
    await tx.instanceBillingRecord.create({
      data: {
        instanceId,
        userId,
        type: 'refund',
        amount: -refundAmount,
        months: 0,
        periodStart: now,
        periodEnd: now,
        balanceLogId: balanceLog.id,
        remark: `实例创建失败自动退款：${instance.name}`
      }
    })

    const affLogs = await tx.affLog.findMany({
      where: {
        instanceId,
        type: 'new_purchase',
        amount: { gt: 0 }
      },
      select: {
        id: true,
        userId: true,
        affCodeId: true,
        amount: true,
        originalAmount: true
      }
    })

    for (const affLog of affLogs) {
      const commissionAmount = Number(affLog.amount)
      if (!Number.isFinite(commissionAmount) || commissionAmount <= 0) continue

      await advisoryTransactionLock(tx, USER_AFF_BALANCE_LOCK_NAMESPACE, affLog.userId)

      const affUser = await tx.user.findUnique({
        where: { id: affLog.userId },
        select: { affBalance: true }
      })
      if (!affUser) continue

      const affBalanceBefore = Number(affUser.affBalance)
      await tx.user.update({
        where: { id: affLog.userId },
        data: { affBalance: { decrement: commissionAmount } }
      })
      const updatedAffUser = await tx.user.findUniqueOrThrow({
        where: { id: affLog.userId },
        select: { affBalance: true }
      })

      await tx.affLog.create({
        data: {
          userId: affLog.userId,
          type: 'new_purchase',
          amount: -commissionAmount,
          affCodeId: affLog.affCodeId,
          instanceId,
          originalAmount: affLog.originalAmount,
          balanceBefore: affBalanceBefore,
          balanceAfter: Number(updatedAffUser.affBalance),
          remark: `实例创建失败返利冲正：${instance.name}`
        }
      })

      if (affLog.affCodeId) {
        await tx.affCode.updateMany({
          where: { id: affLog.affCodeId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } }
        })
        await tx.affCode.update({
          where: { id: affLog.affCodeId },
          data: { totalEarnings: { decrement: commissionAmount } }
        })
      }
    }

    await tx.hostingBalanceLog.deleteMany({
      where: {
        relatedId: instanceId,
        type: 'income',
        actionType: 'purchase',
        frozen: true
      }
    })

    return { refunded: true, refundAmount }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 15000
  })
}
