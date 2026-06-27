import { prisma } from '../db/prisma.js'
import { apiError, ErrorCode } from '../lib/errors.js'

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

export async function getActiveOrderRestriction(userId: number) {
  return prisma.userOrderRestriction.findFirst({
    where: {
      userId,
      status: 'active',
      restrictedCreate: true
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
}) {
  const existing = await getActiveOrderRestriction(input.userId)
  if (existing) {
    return existing
  }

  return prisma.userOrderRestriction.create({
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
