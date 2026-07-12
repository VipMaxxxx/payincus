import { Prisma, type FlashSaleAuditAction, type FlashSaleCampaignStatus, type FlashSaleReservationStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import {
  FLASH_SALE_ITEM_LOCK_NAMESPACE,
  advisoryTransactionLock
} from '../db/advisory-locks.js'
import { getTurnstileConfig, verifyTurnstileToken } from '../lib/turnstile.js'
import { getActiveOrderRestriction } from './user-order-restrictions.js'

const ACTIVE_PURCHASE_STATUSES: FlashSaleReservationStatus[] = ['paid', 'delivering', 'delivered']
const ADMIN_LIST_PAGE_SIZE_MAX = 100

export class FlashSaleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400
  ) {
    super(message)
    this.name = 'FlashSaleError'
  }
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function assertValidFlashPrice(flashPrice: number, originalPriceSnapshot: unknown): void {
  const originalPrice = toNumber(originalPriceSnapshot)
  if (!Number.isInteger(flashPrice) || flashPrice <= 0 || flashPrice >= originalPrice) {
    throw new FlashSaleError('FLASH_SALE_INVALID_PRICE', '秒杀价必须大于 0 且低于原价')
  }
}

function getCheckoutPriceSnapshot(metadata: Prisma.InputJsonValue | undefined): {
  flashPriceCents: number
  discountAmountCents: number
} | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const snapshot = metadata as Record<string, unknown>
  const flashPriceCents = Number(snapshot.flashPriceCents)
  const discountAmount = Number(snapshot.discountAmount ?? 0)
  if (!Number.isInteger(flashPriceCents) || !Number.isFinite(discountAmount) || discountAmount < 0) return null
  return {
    flashPriceCents,
    discountAmountCents: Math.round(discountAmount * 100)
  }
}

function remainingStock(item: {
  totalStock: number
  soldCount: number
  reservedCount: number
}): number {
  return Math.max(0, item.totalStock - item.soldCount - item.reservedCount)
}

function clampPage(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function clampPageSize(value: unknown, fallback = 20): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, ADMIN_LIST_PAGE_SIZE_MAX)
}

function normalizeStatusForTime(status: FlashSaleCampaignStatus, startAt: Date, endAt: Date, now = new Date()) {
  if (status === 'cancelled' || status === 'ended' || status === 'paused' || status === 'draft') {
    return status
  }
  if (now < startAt) return 'scheduled'
  if (now > endAt) return 'ended'
  return 'active'
}

function serializePlan(plan: {
  id: number
  name: string
  description: string | null
  cpu: number
  memory: number
  disk: number
  trafficLimit: bigint
  trafficLimitSpeed: string
  price: unknown
  billingCycle: number
  isActive: boolean
  isSoldOut: boolean
  package: {
    id: number
    name: string
    networkMode: string
    instanceType: string
    monthlyTrafficLimit: bigint | null
    user?: { role: string } | null
    packageHosts?: Array<{ hostId: number }>
  }
}) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    cpu: plan.cpu,
    memory: plan.memory,
    disk: plan.disk,
    trafficLimit: plan.trafficLimit.toString(),
    trafficLimitSpeed: plan.trafficLimitSpeed,
    price: toNumber(plan.price),
    billingCycle: plan.billingCycle,
    isActive: plan.isActive,
    isSoldOut: plan.isSoldOut,
    package: {
      id: plan.package.id,
      name: plan.package.name,
      networkMode: plan.package.networkMode,
      instanceType: plan.package.instanceType,
      sourceType: plan.package.user?.role === 'admin' ? 'official' : 'market',
      monthlyTrafficLimit: plan.package.monthlyTrafficLimit?.toString() ?? null,
      hostCount: plan.package.packageHosts?.length ?? 0
    }
  }
}

function serializeItem(item: {
  id: number
  campaignId: number
  packagePlanId: number
  flashPrice: unknown
  originalPriceSnapshot: unknown
  totalStock: number
  soldCount: number
  reservedCount: number
  deliveredCount: number
  failedCount: number
  perUserLimit: number
  allowCoupon: boolean
  allowAff: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  packagePlan: Parameters<typeof serializePlan>[0]
}) {
  return {
    id: item.id,
    campaignId: item.campaignId,
    packagePlanId: item.packagePlanId,
    flashPrice: toNumber(item.flashPrice),
    originalPriceSnapshot: toNumber(item.originalPriceSnapshot),
    totalStock: item.totalStock,
    soldCount: item.soldCount,
    reservedCount: item.reservedCount,
    deliveredCount: item.deliveredCount,
    failedCount: item.failedCount,
    remainingStock: remainingStock(item),
    perUserLimit: item.perUserLimit,
    allowCoupon: item.allowCoupon,
    allowAff: item.allowAff,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    plan: serializePlan(item.packagePlan)
  }
}

function serializeCampaign(campaign: {
  id: number
  name: string
  description: string | null
  status: FlashSaleCampaignStatus
  startAt: Date
  endAt: Date
  requireTurnstile: boolean
  minAccountAgeHours: number
  requireEmail: boolean
  blockRiskRestricted: boolean
  maxPerUser: number
  notes: string | null
  createdByUserId: number
  createdAt: Date
  updatedAt: Date
  items: Array<Parameters<typeof serializeItem>[0]>
}) {
  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    status: campaign.status,
    effectiveStatus: normalizeStatusForTime(campaign.status, campaign.startAt, campaign.endAt),
    startAt: campaign.startAt.toISOString(),
    endAt: campaign.endAt.toISOString(),
    requireTurnstile: campaign.requireTurnstile,
    minAccountAgeHours: campaign.minAccountAgeHours,
    requireEmail: campaign.requireEmail,
    blockRiskRestricted: campaign.blockRiskRestricted,
    maxPerUser: campaign.maxPerUser,
    notes: campaign.notes,
    createdByUserId: campaign.createdByUserId,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    items: campaign.items.map(serializeItem)
  }
}

export function normalizeFlashSaleListParams(params: {
  page?: unknown
  pageSize?: unknown
  status?: unknown
}) {
  const status = typeof params.status === 'string' && params.status ? params.status as FlashSaleCampaignStatus : undefined
  return {
    page: clampPage(params.page),
    pageSize: clampPageSize(params.pageSize),
    status
  }
}

export async function listPublicFlashSales() {
  const now = new Date()
  const campaigns = await prisma.flashSaleCampaign.findMany({
    where: {
      status: { in: ['scheduled', 'active', 'paused'] },
      endAt: { gt: now }
    },
    include: {
      items: {
        include: {
          packagePlan: {
            include: {
              package: {
                include: {
                  user: { select: { role: true } },
                  packageHosts: { select: { hostId: true } }
                }
              }
            }
          }
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
      }
    },
    orderBy: [{ startAt: 'asc' }, { id: 'asc' }]
  })

  return { campaigns: campaigns.map(serializeCampaign) }
}

export async function listAdminFlashSales(params: ReturnType<typeof normalizeFlashSaleListParams>) {
  const where = params.status ? { status: params.status } : {}
  const [total, campaigns] = await Promise.all([
    prisma.flashSaleCampaign.count({ where }),
    prisma.flashSaleCampaign.findMany({
      where,
      include: {
        items: {
          include: {
            packagePlan: {
              include: {
                package: {
                  include: {
                    user: { select: { role: true } },
                    packageHosts: { select: { hostId: true } }
                  }
                }
              }
            }
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
        }
      },
      orderBy: [{ createdAt: 'desc' }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize
    })
  ])

  return {
    campaigns: campaigns.map(serializeCampaign),
    total,
    page: params.page,
    pageSize: params.pageSize
  }
}

export async function getAdminFlashSale(id: number) {
  const campaign = await prisma.flashSaleCampaign.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          packagePlan: {
            include: {
                package: {
                  include: {
                    user: { select: { role: true } },
                    packageHosts: { select: { hostId: true } }
                  }
                }
            }
          }
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
      }
    }
  })
  return campaign ? serializeCampaign(campaign) : null
}

export async function getAdminFlashSaleReservations(campaignId: number, params: { page?: unknown; pageSize?: unknown }) {
  const page = clampPage(params.page)
  const pageSize = clampPageSize(params.pageSize)
  const where = { campaignId }
  const [total, reservations] = await Promise.all([
    prisma.flashSaleReservation.count({ where }),
    prisma.flashSaleReservation.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, email: true, avatarStyle: true, avatarBadgeId: true } },
        instance: { select: { id: true, name: true, status: true } },
        item: {
          include: {
            packagePlan: {
              include: { package: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ])

  return {
    reservations: reservations.map((reservation) => ({
      id: reservation.id,
      campaignId: reservation.campaignId,
      itemId: reservation.itemId,
      userId: reservation.userId,
      user: reservation.user,
      instanceId: reservation.instanceId,
      instance: reservation.instance,
      status: reservation.status,
      amount: toNumber(reservation.amount),
      failureReason: reservation.failureReason,
      paidAt: toIso(reservation.paidAt),
      deliveredAt: toIso(reservation.deliveredAt),
      refundedAt: toIso(reservation.refundedAt),
      createdAt: reservation.createdAt.toISOString(),
      updatedAt: reservation.updatedAt.toISOString(),
      packageName: reservation.item.packagePlan.package.name,
      planName: reservation.item.packagePlan.name
    })),
    total,
    page,
    pageSize
  }
}

export async function createFlashSaleCampaign(input: {
  name: string
  description?: string | null
  status?: FlashSaleCampaignStatus
  startAt: Date
  endAt: Date
  requireTurnstile?: boolean
  minAccountAgeHours?: number
  requireEmail?: boolean
  blockRiskRestricted?: boolean
  maxPerUser?: number
  notes?: string | null
  items: Array<{
    packagePlanId: number
    flashPrice: number
    totalStock: number
    perUserLimit?: number
    allowCoupon?: boolean
    allowAff?: boolean
    sortOrder?: number
  }>
  actorUserId: number
}) {
  if (input.endAt <= input.startAt) {
    throw new FlashSaleError('FLASH_SALE_INVALID_TIME', '结束时间必须晚于开始时间')
  }
  if (input.items.length === 0) {
    throw new FlashSaleError('FLASH_SALE_ITEM_REQUIRED', '至少需要一个秒杀商品')
  }

  const plans = await prisma.packagePlan.findMany({
    where: { id: { in: input.items.map(item => item.packagePlanId) } },
    select: { id: true, price: true }
  })
  const planById = new Map(plans.map(plan => [plan.id, plan]))

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.flashSaleCampaign.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? 'draft',
        startAt: input.startAt,
        endAt: input.endAt,
        requireTurnstile: input.requireTurnstile ?? true,
        minAccountAgeHours: input.minAccountAgeHours ?? 0,
        requireEmail: input.requireEmail ?? false,
        blockRiskRestricted: input.blockRiskRestricted ?? true,
        maxPerUser: input.maxPerUser ?? 1,
        notes: input.notes ?? null,
        createdByUserId: input.actorUserId,
        items: {
          create: input.items.map((item) => {
            const plan = planById.get(item.packagePlanId)
            if (!plan) {
              throw new FlashSaleError('FLASH_SALE_PLAN_NOT_FOUND', `方案 #${item.packagePlanId} 不存在`)
            }
            assertValidFlashPrice(item.flashPrice, plan.price)
            if (!Number.isInteger(item.totalStock) || item.totalStock < 1) {
              throw new FlashSaleError('FLASH_SALE_INVALID_STOCK', '库存必须大于 0')
            }
            return {
              packagePlanId: item.packagePlanId,
              flashPrice: item.flashPrice,
              originalPriceSnapshot: plan.price,
              totalStock: item.totalStock,
              perUserLimit: item.perUserLimit ?? input.maxPerUser ?? 1,
              allowCoupon: item.allowCoupon ?? false,
              allowAff: item.allowAff ?? false,
              sortOrder: item.sortOrder ?? 0
            }
          })
        }
      }
    })

    await tx.flashSaleAuditLog.create({
      data: {
        campaignId: created.id,
        actorUserId: input.actorUserId,
        action: 'create',
        afterData: input as unknown as Prisma.InputJsonValue
      }
    })

    return created
  })

  return getAdminFlashSale(campaign.id)
}

export async function updateFlashSaleCampaign(id: number, input: {
  name?: string
  description?: string | null
  status?: FlashSaleCampaignStatus
  startAt?: Date
  endAt?: Date
  requireTurnstile?: boolean
  minAccountAgeHours?: number
  requireEmail?: boolean
  blockRiskRestricted?: boolean
  maxPerUser?: number
  notes?: string | null
  actorUserId: number
}) {
  const existing = await prisma.flashSaleCampaign.findUnique({ where: { id }, include: { items: true } })
  if (!existing) return null

  const nextStartAt = input.startAt ?? existing.startAt
  const nextEndAt = input.endAt ?? existing.endAt
  if (nextEndAt <= nextStartAt) {
    throw new FlashSaleError('FLASH_SALE_INVALID_TIME', '结束时间必须晚于开始时间')
  }

  const updated = await prisma.$transaction(async (tx) => {
    const campaign = await tx.flashSaleCampaign.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        startAt: input.startAt,
        endAt: input.endAt,
        requireTurnstile: input.requireTurnstile,
        minAccountAgeHours: input.minAccountAgeHours,
        requireEmail: input.requireEmail,
        blockRiskRestricted: input.blockRiskRestricted,
        maxPerUser: input.maxPerUser,
        notes: input.notes
      }
    })
    await tx.flashSaleAuditLog.create({
      data: {
        campaignId: id,
        actorUserId: input.actorUserId,
        action: 'update',
        beforeData: existing as unknown as Prisma.InputJsonValue,
        afterData: campaign as unknown as Prisma.InputJsonValue
      }
    })
    return campaign
  })

  return getAdminFlashSale(updated.id)
}

export async function changeFlashSaleStatus(id: number, status: FlashSaleCampaignStatus, actorUserId: number, reason?: string) {
  const existing = await prisma.flashSaleCampaign.findUnique({ where: { id } })
  if (!existing) return null
  const actionByStatus: Partial<Record<FlashSaleCampaignStatus, FlashSaleAuditAction>> = {
    active: existing.status === 'paused' ? 'resume' : 'start',
    paused: 'pause',
    ended: 'finish',
    cancelled: 'cancel',
    scheduled: 'update',
    draft: 'update'
  }
  const updated = await prisma.$transaction(async (tx) => {
    const campaign = await tx.flashSaleCampaign.update({
      where: { id },
      data: { status }
    })
    await tx.flashSaleAuditLog.create({
      data: {
        campaignId: id,
        actorUserId,
        action: actionByStatus[status] ?? 'update',
        beforeData: existing as unknown as Prisma.InputJsonValue,
        afterData: campaign as unknown as Prisma.InputJsonValue,
        reason
      }
    })
    return campaign
  })
  return getAdminFlashSale(updated.id)
}

export async function adjustFlashSaleItemStock(itemId: number, totalStock: number, actorUserId: number, reason?: string) {
  if (!Number.isInteger(totalStock) || totalStock < 0) {
    throw new FlashSaleError('FLASH_SALE_INVALID_STOCK', '库存不能小于 0')
  }
  const item = await prisma.flashSaleItem.findUnique({ where: { id: itemId } })
  if (!item) return null
  if (totalStock < item.soldCount + item.reservedCount) {
    throw new FlashSaleError('FLASH_SALE_STOCK_BELOW_SOLD', '库存不能小于已售和锁定数量')
  }
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.flashSaleItem.update({
      where: { id: itemId },
      data: { totalStock }
    })
    await tx.flashSaleAuditLog.create({
      data: {
        campaignId: item.campaignId,
        itemId,
        actorUserId,
        action: 'stock_adjust',
        beforeData: item as unknown as Prisma.InputJsonValue,
        afterData: next as unknown as Prisma.InputJsonValue,
        reason
      }
    })
    return next
  })
  return updated
}

export async function updateFlashSaleItemConfig(itemId: number, input: {
  flashPrice?: number
  totalStock?: number
  perUserLimit?: number
  allowCoupon?: boolean
  allowAff?: boolean
  sortOrder?: number
  actorUserId: number
  reason?: string
}) {
  if (input.flashPrice !== undefined && (!Number.isInteger(input.flashPrice) || input.flashPrice <= 0)) {
    throw new FlashSaleError('FLASH_SALE_INVALID_PRICE', '秒杀价必须大于 0 且低于原价')
  }
  if (input.totalStock !== undefined && (!Number.isInteger(input.totalStock) || input.totalStock < 0)) {
    throw new FlashSaleError('FLASH_SALE_INVALID_STOCK', '库存不能小于 0')
  }
  if (input.perUserLimit !== undefined && (!Number.isInteger(input.perUserLimit) || input.perUserLimit < 1)) {
    throw new FlashSaleError('FLASH_SALE_INVALID_LIMIT', '每人限购必须大于 0')
  }
  if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)) {
    throw new FlashSaleError('FLASH_SALE_INVALID_SORT', '排序值不能小于 0')
  }

  const updated = await prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, FLASH_SALE_ITEM_LOCK_NAMESPACE, itemId)
    const item = await tx.flashSaleItem.findUnique({ where: { id: itemId } })
    if (!item) return null
    if (input.flashPrice !== undefined) {
      assertValidFlashPrice(input.flashPrice, item.originalPriceSnapshot)
    }
    if (input.totalStock !== undefined && input.totalStock < item.soldCount + item.reservedCount) {
      throw new FlashSaleError('FLASH_SALE_STOCK_BELOW_SOLD', '库存不能小于已售和锁定数量')
    }
    const next = await tx.flashSaleItem.update({
      where: { id: itemId },
      data: {
        flashPrice: input.flashPrice,
        totalStock: input.totalStock,
        perUserLimit: input.perUserLimit,
        allowCoupon: input.allowCoupon,
        allowAff: input.allowAff,
        sortOrder: input.sortOrder
      }
    })
    await tx.flashSaleAuditLog.create({
      data: {
        campaignId: item.campaignId,
        itemId,
        actorUserId: input.actorUserId,
        action: 'update',
        beforeData: item as unknown as Prisma.InputJsonValue,
        afterData: next as unknown as Prisma.InputJsonValue,
        reason: input.reason
      }
    })
    return next
  })
  return updated
}

export async function assertFlashSaleCheckoutEligibility(input: {
  itemId: number
  userId: number
  packageId: number
  planId: number
  promoCode?: string | null
  turnstileToken?: string | null
  remoteIp?: string | null
}) {
  const item = await prisma.flashSaleItem.findUnique({
    where: { id: input.itemId },
    include: {
      campaign: true,
      packagePlan: {
        include: {
                package: {
                  include: {
                    user: { select: { role: true } },
                    packageHosts: { select: { hostId: true } }
                  }
                }
        }
      }
    }
  })

  if (!item) {
    throw new FlashSaleError('FLASH_SALE_ITEM_NOT_FOUND', '秒杀商品不存在', 404)
  }
  if (item.packagePlanId !== input.planId || item.packagePlan.packageId !== input.packageId) {
    throw new FlashSaleError('FLASH_SALE_PLAN_MISMATCH', '秒杀商品与当前套餐方案不匹配')
  }

  const now = new Date()
  if (normalizeStatusForTime(item.campaign.status, item.campaign.startAt, item.campaign.endAt, now) !== 'active') {
    throw new FlashSaleError('FLASH_SALE_NOT_ACTIVE', '秒杀活动未开始或已结束')
  }
  if (remainingStock(item) <= 0) {
    throw new FlashSaleError('FLASH_SALE_SOLD_OUT', '秒杀库存已抢完', 409)
  }
  if (input.promoCode && !item.allowAff) {
    throw new FlashSaleError('FLASH_SALE_COUPON_DISABLED', '秒杀商品不支持叠加优惠码或 AFF')
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, createdAt: true, status: true }
  })
  if (!user || user.status !== 'active') {
    throw new FlashSaleError('FLASH_SALE_USER_INVALID', '账号状态不可参与秒杀', 403)
  }
  if (item.campaign.requireEmail && !user.email) {
    throw new FlashSaleError('FLASH_SALE_EMAIL_REQUIRED', '参与秒杀需要先绑定邮箱', 403)
  }
  if (item.campaign.minAccountAgeHours > 0) {
    const ageMs = now.getTime() - user.createdAt.getTime()
    if (ageMs < item.campaign.minAccountAgeHours * 60 * 60 * 1000) {
      throw new FlashSaleError('FLASH_SALE_ACCOUNT_TOO_NEW', `账号注册满 ${item.campaign.minAccountAgeHours} 小时后才能参与`, 403)
    }
  }
  if (item.campaign.blockRiskRestricted) {
    const restriction = await getActiveOrderRestriction(input.userId)
    if (restriction) {
      throw new FlashSaleError('FLASH_SALE_ORDER_RESTRICTED', restriction.reason || '账号下单受限，无法参与秒杀', 403)
    }
  }

  const itemPerUserLimit = Math.max(1, item.perUserLimit)
  const campaignMaxPerUser = Math.max(1, item.campaign.maxPerUser || itemPerUserLimit)
  const [itemPurchasedCount, campaignPurchasedCount] = await Promise.all([
    prisma.flashSaleReservation.count({
      where: {
        itemId: item.id,
        userId: input.userId,
        status: { in: ACTIVE_PURCHASE_STATUSES }
      }
    }),
    prisma.flashSaleReservation.count({
      where: {
        campaignId: item.campaignId,
        userId: input.userId,
        status: { in: ACTIVE_PURCHASE_STATUSES }
      }
    })
  ])
  if (itemPurchasedCount >= itemPerUserLimit || campaignPurchasedCount >= campaignMaxPerUser) {
    throw new FlashSaleError('FLASH_SALE_USER_LIMIT_REACHED', `每个账号活动限购 ${campaignMaxPerUser} 台`, 409)
  }

  if (item.campaign.requireTurnstile) {
    const config = await getTurnstileConfig()
    if (config.enabled) {
      if (!input.turnstileToken) {
        throw new FlashSaleError('FLASH_SALE_TURNSTILE_REQUIRED', '请先完成人机验证', 403)
      }
      if (!config.secretKey) {
        throw new FlashSaleError('FLASH_SALE_TURNSTILE_MISCONFIGURED', '人机验证未配置密钥', 503)
      }
      const result = await verifyTurnstileToken(input.turnstileToken, config.secretKey, input.remoteIp || undefined)
      if (!result.success) {
        throw new FlashSaleError('FLASH_SALE_TURNSTILE_FAILED', result.error || '人机验证失败', 403)
      }
    }
  }

  return {
    itemId: item.id,
    campaignId: item.campaignId,
    packagePlanId: item.packagePlanId,
    flashPrice: toNumber(item.flashPrice),
    originalPriceSnapshot: toNumber(item.originalPriceSnapshot),
    allowAff: item.allowAff,
    allowCoupon: item.allowCoupon,
    campaignName: item.campaign.name,
    planName: item.packagePlan.name,
    packageName: item.packagePlan.package.name,
    remainingStock: remainingStock(item)
  }
}

export async function claimFlashSalePurchaseInTransaction(tx: Prisma.TransactionClient, input: {
  itemId: number
  userId: number
  packageId: number
  planId: number
  instanceId: number
  amount: number
  balanceLogId?: number | null
  billingRecordId?: number | null
  idempotencyKey: string
  metadata?: Prisma.InputJsonValue
}) {
  await advisoryTransactionLock(tx, FLASH_SALE_ITEM_LOCK_NAMESPACE, input.itemId)

  const item = await tx.flashSaleItem.findUnique({
    where: { id: input.itemId },
    include: {
      campaign: true,
      packagePlan: true
    }
  })
  if (!item) {
    throw new FlashSaleError('FLASH_SALE_ITEM_NOT_FOUND', '秒杀商品不存在', 404)
  }
  // 使用负 campaignId 复用秒杀锁命名空间，和正数 itemId 隔离并串行化跨商品活动限购检查。
  await advisoryTransactionLock(tx, FLASH_SALE_ITEM_LOCK_NAMESPACE, -item.campaignId)
  const now = new Date()
  if (item.packagePlanId !== input.planId || item.packagePlan.packageId !== input.packageId) {
    throw new FlashSaleError('FLASH_SALE_PLAN_MISMATCH', '秒杀商品与当前套餐方案不匹配')
  }
  if (normalizeStatusForTime(item.campaign.status, item.campaign.startAt, item.campaign.endAt, now) !== 'active') {
    throw new FlashSaleError('FLASH_SALE_NOT_ACTIVE', '秒杀活动未开始或已结束')
  }
  if (remainingStock(item) <= 0) {
    throw new FlashSaleError('FLASH_SALE_SOLD_OUT', '秒杀库存已抢完', 409)
  }

  const priceSnapshot = getCheckoutPriceSnapshot(input.metadata)
  const currentFlashPriceCents = toNumber(item.flashPrice)
  const expectedAmountCents = currentFlashPriceCents - (priceSnapshot?.discountAmountCents ?? 0)
  if (
    !priceSnapshot ||
    priceSnapshot.flashPriceCents !== currentFlashPriceCents ||
    Math.round(input.amount * 100) !== expectedAmountCents
  ) {
    throw new FlashSaleError('FLASH_SALE_PRICE_CHANGED', '秒杀价格已更新，请刷新后重试', 409)
  }

  const itemPerUserLimit = Math.max(1, item.perUserLimit)
  const campaignMaxPerUser = Math.max(1, item.campaign.maxPerUser || itemPerUserLimit)
  const [itemPurchasedCount, campaignPurchasedCount] = await Promise.all([
    tx.flashSaleReservation.count({
      where: {
        itemId: item.id,
        userId: input.userId,
        status: { in: ACTIVE_PURCHASE_STATUSES }
      }
    }),
    tx.flashSaleReservation.count({
      where: {
        campaignId: item.campaignId,
        userId: input.userId,
        status: { in: ACTIVE_PURCHASE_STATUSES }
      }
    })
  ])
  if (itemPurchasedCount >= itemPerUserLimit || campaignPurchasedCount >= campaignMaxPerUser) {
    throw new FlashSaleError('FLASH_SALE_USER_LIMIT_REACHED', `每个账号活动限购 ${campaignMaxPerUser} 台`, 409)
  }

  const reservation = await tx.flashSaleReservation.create({
    data: {
      campaignId: item.campaignId,
      itemId: item.id,
      userId: input.userId,
      instanceId: input.instanceId,
      status: 'delivering',
      amount: input.amount,
      balanceLogId: input.balanceLogId ?? null,
      billingRecordId: input.billingRecordId ?? null,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? {},
      paidAt: now
    }
  })

  await tx.flashSaleItem.update({
    where: { id: item.id },
    data: {
      soldCount: { increment: 1 }
    }
  })

  return reservation
}

export async function markFlashSaleDelivered(instanceId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.flashSaleReservation.findFirst({
      where: { instanceId, status: { in: ['paid', 'delivering'] } },
      orderBy: { createdAt: 'desc' }
    })
    if (!reservation) return
    await tx.flashSaleReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'delivered',
        deliveredAt: new Date()
      }
    })
    await tx.flashSaleItem.update({
      where: { id: reservation.itemId },
      data: {
        deliveredCount: { increment: 1 }
      }
    })
  })
}

export async function markFlashSaleFailed(instanceId: number, reason: string, refunded: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.flashSaleReservation.findFirst({
      where: { instanceId, status: { in: ['paid', 'delivering'] } },
      orderBy: { createdAt: 'desc' }
    })
    if (!reservation) return

    const updateResult = await tx.flashSaleReservation.updateMany({
      where: {
        id: reservation.id,
        status: { in: ['paid', 'delivering'] }
      },
      data: {
        status: refunded ? 'refunded' : 'failed',
        failureReason: reason.slice(0, 1000),
        refundedAt: refunded ? new Date() : null
      }
    })
    if (updateResult.count === 0) return

    await tx.flashSaleItem.update({
      where: { id: reservation.itemId },
      data: {
        failedCount: { increment: 1 },
        soldCount: { decrement: 1 }
      }
    })
  })
}
