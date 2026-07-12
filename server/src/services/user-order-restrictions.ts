import type { Prisma } from '@prisma/client'
import { advisoryTransactionLock } from '../db/advisory-locks.js'
import { prisma } from '../db/prisma.js'
import { apiError, ErrorCode } from '../lib/errors.js'

const USER_ORDER_RESTRICTION_LOCK_NAMESPACE = 62067
type OrderRestrictionClient = Prisma.TransactionClient | typeof prisma

export class OrderRestrictedError extends Error {
  restrictionId: number
  reason: string

  constructor(restrictionId: number, reason: string) {
    super(reason)
    this.name = 'OrderRestrictedError'
    this.restrictionId = restrictionId
    this.reason = reason
  }
}

export async function getActiveOrderRestriction(
  userId: number,
  client: OrderRestrictionClient = prisma,
  restrictedField: 'restrictedCreate' | 'restrictedPurchase' | null = 'restrictedCreate'
) {
  return client.userOrderRestriction.findFirst({
    where: {
      userId,
      status: 'active',
      ...(restrictedField ? { [restrictedField]: true } : {})
    },
    orderBy: { createdAt: 'desc' },
    include: {
      sourceInstance: {
        select: {
          id: true,
          name: true,
          status: true
        }
      }
    }
  })
}

export async function assertUserCanCreateInstance(userId: number): Promise<void> {
  const restriction = await getActiveOrderRestriction(userId)
  if (restriction) {
    throw new OrderRestrictedError(restriction.id, restriction.reason)
  }
}

export async function assertUserCanPurchaseOrReceiveInstance(
  userId: number,
  client: OrderRestrictionClient = prisma
): Promise<void> {
  const restriction = await getActiveOrderRestriction(userId, client, 'restrictedPurchase')
  if (restriction) {
    throw new OrderRestrictedError(restriction.id, restriction.reason)
  }
}

export function orderRestrictionApiError(error: OrderRestrictedError) {
  return {
    ...apiError(ErrorCode.ORDER_RESTRICTED_BY_RISK, error.reason),
    restrictionId: error.restrictionId,
    reviewRequired: true
  }
}

export async function restrictUserOrdersForRisk(input: {
  userId: number
  sourceInstanceId: number
  sourceRiskEventId?: number | null
  reason: string
}, transaction?: Prisma.TransactionClient) {
  const createUnderLock = async (tx: Prisma.TransactionClient) => {
    await advisoryTransactionLock(tx, USER_ORDER_RESTRICTION_LOCK_NAMESPACE, input.userId)
    const existing = await getActiveOrderRestriction(input.userId, tx, null)
    if (existing) {
      return existing
    }

    return tx.userOrderRestriction.create({
      data: {
        userId: input.userId,
        sourceInstanceId: input.sourceInstanceId,
        sourceRiskEventId: input.sourceRiskEventId ?? null,
        reason: input.reason,
        restrictedCreate: true,
        restrictedPurchase: true,
        restrictedRenew: false,
        reviewRequired: true
      }
    })
  }

  if (transaction) {
    return createUnderLock(transaction)
  }

  return prisma.$transaction(createUnderLock)
}

export async function releaseOrderRestriction(input: {
  restrictionId: number
  actorUserId: number
  reason: string
  ticketId?: number | null
}) {
  return prisma.userOrderRestriction.update({
    where: { id: input.restrictionId },
    data: {
      status: 'released',
      ticketId: input.ticketId ?? undefined,
      releasedByUserId: input.actorUserId,
      releasedAt: new Date(),
      releaseReason: input.reason || '人工审核解除'
    }
  })
}
