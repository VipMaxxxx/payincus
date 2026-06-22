import { Prisma } from '@prisma/client'
import type { BadgeApplicationTarget, PointsLogType, UserBadgeSource } from '@prisma/client'

import { BADGE_RANDOM_DRAW_COST, BADGE_SELECT_COST, DEFAULT_BADGE_CATALOG } from '../config/badges.js'
import type { BadgeCatalogItem } from '../config/badges.js'
import { USER_POINTS_LOCK_NAMESPACE, advisoryTransactionLock } from './advisory-locks.js'
import { prisma } from './prisma.js'

type BadgeClient = typeof prisma | Prisma.TransactionClient

type BadgeRow = {
  id: string
  name: string
  nameEn: string | null
  fullLabel: string
  sourceId: string | null
  sourceLabel: string | null
  seriesId: string
  assetUrl: string
  assetUrlDark: string | null
  assetUrlLight: string | null
  displayOrder: number
  isActive: boolean
  series: {
    id: string
    title: string
    nameZh: string
    nameEn: string | null
    description: string
    sourceId: string | null
    sourceLabel: string | null
    isActive: boolean
  }
}

function withoutUndefined<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}

export interface BadgeSeriesView {
  id: string
  title: string
  nameZh: string
  nameEn: string | null
  description: string
  sourceId: string | null
  sourceLabel: string | null
  displayOrder: number
  isActive: boolean
  badgeCount?: number
  activeBadgeCount?: number
  createdAt?: string
  updatedAt?: string
}

export interface BadgeOwnershipView {
  id: number
  badgeId: string
  badgeName: string
  badgeNameEn: string | null
  badgeLabel: string
  seriesId: string
  seriesTitle: string
  assetUrl: string
  assetUrlDark: string | null
  assetUrlLight: string | null
  source: UserBadgeSource
  applicationTarget: BadgeApplicationTarget | null
  appliedInstanceId: number | null
  appliedInstanceName: string | null
  appliedAt: string | null
  createdAt: string
}

function fallbackBadgeForId(id: string): BadgeCatalogItem {
  return {
    id,
    name: id,
    nameEn: null,
    fullLabel: id,
    seriesId: 'unknown',
    seriesTitle: '未知系列',
    seriesNameZh: '未知系列',
    seriesNameEn: null,
    seriesDescription: '该徽章目录记录不存在，保留占位以兼容历史数据。',
    assetUrl: `/badges/dark/${id}.svg`,
    assetUrlDark: `/badges/dark/${id}.svg`,
    assetUrlLight: `/badges/light/${id}.svg`,
    isActive: false,
    seriesIsActive: false
  }
}

function mapBadgeRow(row: BadgeRow): BadgeCatalogItem {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    fullLabel: row.fullLabel,
    sourceId: row.sourceId ?? row.series.sourceId ?? undefined,
    sourceLabel: row.sourceLabel ?? row.series.sourceLabel ?? undefined,
    seriesId: row.seriesId,
    seriesTitle: row.series.title,
    seriesNameZh: row.series.nameZh,
    seriesNameEn: row.series.nameEn,
    seriesDescription: row.series.description,
    assetUrl: row.assetUrl,
    assetUrlDark: row.assetUrlDark ?? undefined,
    assetUrlLight: row.assetUrlLight ?? undefined,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    seriesIsActive: row.series.isActive
  }
}

async function getBadgeCatalogMap(client: BadgeClient = prisma): Promise<Map<string, BadgeCatalogItem>> {
  const rows = await client.badge.findMany({
    include: { series: true }
  })

  return new Map(rows.map(row => [row.id, mapBadgeRow(row)]))
}

async function getBadgeById(
  id: string,
  client: BadgeClient = prisma,
  options: { activeOnly?: boolean } = {}
): Promise<BadgeCatalogItem | null> {
  const row = await client.badge.findFirst({
    where: {
      id,
      ...(options.activeOnly
        ? {
          isActive: true,
          series: { is: { isActive: true } }
        }
        : {})
    },
    include: { series: true }
  })

  return row ? mapBadgeRow(row) : null
}

export async function getBadgeCatalog(options: { activeOnly?: boolean } = {}): Promise<BadgeCatalogItem[]> {
  const rows = await prisma.badge.findMany({
    where: options.activeOnly
      ? {
        isActive: true,
        series: { is: { isActive: true } }
      }
      : undefined,
    include: { series: true },
    orderBy: [
      { series: { displayOrder: 'asc' } },
      { displayOrder: 'asc' },
      { id: 'asc' }
    ]
  })

  return rows.map(mapBadgeRow)
}

export async function getBadgeSeriesList(options: { activeOnly?: boolean } = {}): Promise<BadgeSeriesView[]> {
  const rows = await prisma.badgeSeries.findMany({
    where: options.activeOnly ? { isActive: true } : undefined,
    include: {
      _count: {
        select: { badges: true }
      }
    },
    orderBy: [
      { displayOrder: 'asc' },
      { id: 'asc' }
    ]
  })

  const activeCounts = rows.length === 0
    ? new Map<string, number>()
    : new Map((await prisma.badge.groupBy({
      by: ['seriesId'],
      where: {
        isActive: true,
        seriesId: { in: rows.map(row => row.id) },
        series: { is: { isActive: true } }
      },
      _count: { _all: true }
    })).map(item => [item.seriesId, item._count._all]))

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    nameZh: row.nameZh,
    nameEn: row.nameEn,
    description: row.description,
    sourceId: row.sourceId,
    sourceLabel: row.sourceLabel,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    badgeCount: row._count.badges,
    activeBadgeCount: activeCounts.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }))
}

export async function selectRandomBadgeOrThrow(client: BadgeClient = prisma) {
  const catalog = await client.badge.findMany({
    where: {
      isActive: true,
      series: { is: { isActive: true } }
    },
    include: { series: true },
    orderBy: [
      { series: { displayOrder: 'asc' } },
      { displayOrder: 'asc' },
      { id: 'asc' }
    ]
  })

  if (catalog.length === 0) {
    throw new Error('NO_BADGES_AVAILABLE')
  }

  return mapBadgeRow(catalog[Math.floor(Math.random() * catalog.length)])
}

function mapBadgeOwnership(
  record: {
    id: number
    badgeId: string
    source: UserBadgeSource
    applicationTarget: BadgeApplicationTarget | null
    appliedAt: Date | null
    createdAt: Date
    appliedInstance: { id: number; name: string } | null
  },
  badgeMap: Map<string, BadgeCatalogItem>
): BadgeOwnershipView {
  const badge = badgeMap.get(record.badgeId) ?? fallbackBadgeForId(record.badgeId)

  return {
    id: record.id,
    badgeId: badge.id,
    badgeName: badge.name,
    badgeNameEn: badge.nameEn,
    badgeLabel: badge.fullLabel,
    seriesId: badge.seriesId,
    seriesTitle: badge.seriesTitle,
    assetUrl: badge.assetUrl,
    assetUrlDark: badge.assetUrlDark ?? null,
    assetUrlLight: badge.assetUrlLight ?? null,
    source: record.source,
    applicationTarget: record.applicationTarget,
    appliedInstanceId: record.appliedInstance?.id ?? null,
    appliedInstanceName: record.appliedInstance?.name ?? null,
    appliedAt: record.appliedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString()
  }
}

export async function createBadgeOwnership(
  tx: Prisma.TransactionClient,
  userId: number,
  badgeId: string,
  source: UserBadgeSource,
  badge?: BadgeCatalogItem
) {
  const ownership = await tx.userBadgeOwnership.create({
    data: {
      userId,
      badgeId,
      source
    },
    include: {
      appliedInstance: {
        select: { id: true, name: true }
      }
    }
  })

  const resolvedBadge = badge ?? await getBadgeById(badgeId, tx) ?? fallbackBadgeForId(badgeId)
  const badgeMap = new Map([[resolvedBadge.id, resolvedBadge]])
  return mapBadgeOwnership(ownership, badgeMap)
}

async function ensureUserPoints(userId: number, tx: typeof prisma = prisma) {
  return tx.userPoints.upsert({
    where: { userId },
    update: {},
    create: { userId }
  })
}

async function spendBadgePoints(
  tx: Prisma.TransactionClient,
  userId: number,
  amount: number,
  logType: PointsLogType,
  remark: string
) {
  await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)

  await tx.userPoints.upsert({
    where: { userId },
    update: {},
    create: { userId }
  })

  const updateResult = await tx.userPoints.updateMany({
    where: {
      userId,
      points: { gte: amount }
    },
    data: {
      points: { decrement: amount },
      totalSpent: { increment: amount }
    }
  })

  if (updateResult.count === 0) {
    const currentPoints = await tx.userPoints.findUnique({
      where: { userId },
      select: { points: true }
    })
    return {
      success: false as const,
      points: currentPoints?.points ?? 0
    }
  }

  const updatedPoints = await tx.userPoints.findUnique({
    where: { userId },
    select: { points: true }
  })
  const pointsAfter = updatedPoints?.points ?? 0
  const pointsBefore = pointsAfter + amount

  await tx.pointsLog.create({
    data: {
      userId,
      type: logType,
      amount: -amount,
      pointsBefore,
      pointsAfter,
      remark
    }
  })

  return {
    success: true as const,
    points: pointsAfter
  }
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const prismaError = error as Error & { code?: string }
  return prismaError.code === 'P2034' ||
    prismaError.message.includes('deadlock') ||
    prismaError.message.includes('write conflict') ||
    prismaError.message.includes('could not serialize')
}

async function runBadgeTransaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const maxRetries = 5
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await prisma.$transaction(handler, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000
      })
    } catch (error) {
      lastError = error
      if (!isRetryableTransactionError(error) || attempt === maxRetries) {
        throw error
      }

      const baseDelay = Math.floor(Math.random() * 250) + 50
      await new Promise(resolve => setTimeout(resolve, baseDelay * attempt))
    }
  }

  throw lastError
}

export async function getBadgeOverview(userId: number) {
  const [user, userPoints, ownerships, instances, catalog, badgeMap] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { avatarBadgeId: true }
    }),
    ensureUserPoints(userId),
    prisma.userBadgeOwnership.findMany({
      where: { userId },
      include: {
        appliedInstance: {
          select: { id: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.instance.findMany({
      where: {
        userId,
        status: { not: 'deleted' }
      },
      include: {
        host: {
          select: {
            id: true,
            name: true,
            location: true,
            countryCode: true
          }
        },
        package: {
          select: {
            instanceType: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    }),
    getBadgeCatalog({ activeOnly: true }),
    getBadgeCatalogMap()
  ])

  return {
    costs: {
      randomDraw: BADGE_RANDOM_DRAW_COST,
      select: BADGE_SELECT_COST
    },
    currentPoints: userPoints.points,
    avatarBadgeId: user?.avatarBadgeId ?? null,
    catalog,
    ownerships: ownerships.map(ownership => mapBadgeOwnership(ownership, badgeMap)),
    instances: instances.map(instance => ({
      id: instance.id,
      name: instance.name,
      status: instance.status,
      iconBadgeId: instance.iconBadgeId,
      packagePlanId: instance.packagePlanId,
      instanceType: instance.package?.instanceType === 'vm' ? 'vm' as const : 'container' as const,
      host: {
        id: instance.host.id,
        name: instance.host.name,
        location: instance.host.location,
        countryCode: instance.host.countryCode
      }
    }))
  }
}

export async function performRandomBadgeDraw(userId: number) {
  const result = await runBadgeTransaction(async (tx) => {
    const selected = await selectRandomBadgeOrThrow(tx)
    const spendResult = await spendBadgePoints(
      tx,
      userId,
      BADGE_RANDOM_DRAW_COST,
      'badge_draw_spend',
      `徽章随机抽取：${selected.fullLabel}`
    )

    if (!spendResult.success) {
      return {
        success: false as const,
        points: spendResult.points
      }
    }

    return {
      success: true as const,
      points: spendResult.points,
      ownership: await createBadgeOwnership(tx, userId, selected.id, 'draw', selected)
    }
  })

  if (!result.success) {
    return result
  }

  return {
    success: true as const,
    points: result.points,
    ownership: result.ownership
  }
}

export async function performRandomBadgeMultiDraw(userId: number, drawCount = 10) {
  if (drawCount <= 0) {
    return {
      success: false as const,
      points: 0,
      ownerships: [] as BadgeOwnershipView[]
    }
  }

  const totalCost = BADGE_RANDOM_DRAW_COST * drawCount

  const result = await runBadgeTransaction(async (tx) => {
    const spendResult = await spendBadgePoints(
      tx,
      userId,
      totalCost,
      'badge_draw_spend',
      `徽章十连抽取：${drawCount} 次`
    )

    if (!spendResult.success) {
      return {
        success: false as const,
        points: spendResult.points,
        ownerships: [] as BadgeOwnershipView[]
      }
    }

    const ownerships: BadgeOwnershipView[] = []
    for (let index = 0; index < drawCount; index += 1) {
      const selected = await selectRandomBadgeOrThrow(tx)
      ownerships.push(await createBadgeOwnership(tx, userId, selected.id, 'draw', selected))
    }

    return {
      success: true as const,
      points: spendResult.points,
      ownerships
    }
  })

  if (!result.success) {
    return result
  }

  return {
    success: true as const,
    points: result.points,
    ownerships: result.ownerships
  }
}

export async function performSelectBadge(userId: number, badgeId: string) {
  const result = await runBadgeTransaction(async (tx) => {
    const badge = await getBadgeById(badgeId, tx, { activeOnly: true })
    if (!badge) {
      throw new Error('BADGE_NOT_FOUND')
    }

    const spendResult = await spendBadgePoints(
      tx,
      userId,
      BADGE_SELECT_COST,
      'badge_select_spend',
      `徽章自选领取：${badge.fullLabel}`
    )

    if (!spendResult.success) {
      return {
        success: false as const,
        points: spendResult.points
      }
    }

    return {
      success: true as const,
      points: spendResult.points,
      ownership: await createBadgeOwnership(tx, userId, badge.id, 'select', badge)
    }
  })

  if (!result.success) {
    return result
  }

  return {
    success: true as const,
    points: result.points,
    ownership: result.ownership
  }
}

export async function applyBadgeToAvatar(userId: number, ownershipId: number) {
  return runBadgeTransaction(async (tx) => {
    const [user, ownership, badgeMap] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: { avatarBadgeId: true }
      }),
      tx.userBadgeOwnership.findFirst({
        where: { id: ownershipId, userId },
        include: {
          appliedInstance: {
            select: { id: true, name: true }
          }
        }
      }),
      getBadgeCatalogMap(tx)
    ])

    if (!ownership) {
      throw new Error('BADGE_OWNERSHIP_NOT_FOUND')
    }

    if (ownership.applicationTarget === 'avatar' && user?.avatarBadgeId === ownership.badgeId) {
      return mapBadgeOwnership(ownership, badgeMap)
    }

    if (ownership.applicationTarget === 'instance' && ownership.appliedInstanceId) {
      await tx.instance.updateMany({
        where: {
          id: ownership.appliedInstanceId,
          userId,
          iconBadgeId: ownership.badgeId
        },
        data: { iconBadgeId: null }
      })
    }

    await tx.userBadgeOwnership.updateMany({
      where: {
        userId,
        applicationTarget: 'avatar',
        id: { not: ownership.id }
      },
      data: {
        applicationTarget: null,
        appliedInstanceId: null,
        appliedAt: null
      }
    })

    await tx.user.update({
      where: { id: userId },
      data: { avatarBadgeId: ownership.badgeId }
    })

    const applyOwnership = await tx.userBadgeOwnership.updateMany({
      where: {
        id: ownership.id
      },
      data: {
        applicationTarget: 'avatar',
        appliedInstanceId: null,
        appliedAt: new Date()
      }
    })

    if (applyOwnership.count === 0) {
      throw new Error('BADGE_STATE_CONFLICT')
    }

    const updatedOwnership = await tx.userBadgeOwnership.findUniqueOrThrow({
      where: { id: ownership.id },
      include: {
        appliedInstance: {
          select: { id: true, name: true }
        }
      }
    })

    return mapBadgeOwnership(updatedOwnership, badgeMap)
  })
}

export async function applyBadgeToInstance(userId: number, ownershipId: number, instanceId: number) {
  return runBadgeTransaction(async (tx) => {
    const [ownership, instance, badgeMap] = await Promise.all([
      tx.userBadgeOwnership.findFirst({
        where: { id: ownershipId, userId },
        include: {
          appliedInstance: {
            select: { id: true, name: true }
          }
        }
      }),
      tx.instance.findFirst({
        where: {
          id: instanceId,
          userId,
          status: { not: 'deleted' }
        },
        select: {
          id: true,
          name: true,
          iconBadgeId: true
        }
      }),
      getBadgeCatalogMap(tx)
    ])

    if (!ownership) {
      throw new Error('BADGE_OWNERSHIP_NOT_FOUND')
    }

    if (!instance) {
      throw new Error('INSTANCE_NOT_FOUND')
    }

    if (ownership.applicationTarget === 'instance' && ownership.appliedInstanceId === instance.id && instance.iconBadgeId === ownership.badgeId) {
      return mapBadgeOwnership(ownership, badgeMap)
    }

    if (ownership.applicationTarget === 'avatar') {
      await tx.user.updateMany({
        where: {
          id: userId,
          avatarBadgeId: ownership.badgeId
        },
        data: { avatarBadgeId: null }
      })
    }

    if (ownership.applicationTarget === 'instance' && ownership.appliedInstanceId && ownership.appliedInstanceId !== instance.id) {
      await tx.instance.updateMany({
        where: {
          id: ownership.appliedInstanceId,
          userId,
          iconBadgeId: ownership.badgeId
        },
        data: { iconBadgeId: null }
      })
    }

    await tx.userBadgeOwnership.updateMany({
      where: {
        userId,
        applicationTarget: 'instance',
        appliedInstanceId: instance.id,
        id: { not: ownership.id }
      },
      data: {
        applicationTarget: null,
        appliedInstanceId: null,
        appliedAt: null
      }
    })

    const updateInstance = await tx.instance.updateMany({
      where: {
        id: instance.id,
        userId,
        status: { not: 'deleted' }
      },
      data: { iconBadgeId: ownership.badgeId }
    })

    if (updateInstance.count === 0) {
      throw new Error('BADGE_STATE_CONFLICT')
    }

    const applyOwnership = await tx.userBadgeOwnership.updateMany({
      where: {
        id: ownership.id
      },
      data: {
        applicationTarget: 'instance',
        appliedInstanceId: instance.id,
        appliedAt: new Date()
      }
    })

    if (applyOwnership.count === 0) {
      throw new Error('BADGE_STATE_CONFLICT')
    }

    const updatedOwnership = await tx.userBadgeOwnership.findUniqueOrThrow({
      where: { id: ownership.id },
      include: {
        appliedInstance: {
          select: { id: true, name: true }
        }
      }
    })

    return mapBadgeOwnership(updatedOwnership, badgeMap)
  })
}

export async function unapplyBadge(userId: number, ownershipId: number) {
  return runBadgeTransaction(async (tx) => {
    const [ownership, badgeMap] = await Promise.all([
      tx.userBadgeOwnership.findFirst({
        where: { id: ownershipId, userId },
        include: {
          appliedInstance: {
            select: { id: true, name: true }
          }
        }
      }),
      getBadgeCatalogMap(tx)
    ])

    if (!ownership) {
      throw new Error('BADGE_OWNERSHIP_NOT_FOUND')
    }

    if (!ownership.applicationTarget) {
      throw new Error('BADGE_NOT_APPLIED')
    }

    if (ownership.applicationTarget === 'avatar') {
      const clearAvatar = await tx.user.updateMany({
        where: {
          id: userId,
          avatarBadgeId: ownership.badgeId
        },
        data: { avatarBadgeId: null }
      })
      if (clearAvatar.count === 0) {
        throw new Error('BADGE_NOT_APPLIED')
      }
    } else if (ownership.appliedInstanceId) {
      const clearInstance = await tx.instance.updateMany({
        where: {
          id: ownership.appliedInstanceId,
          userId,
          iconBadgeId: ownership.badgeId
        },
        data: { iconBadgeId: null }
      })
      if (clearInstance.count === 0) {
        throw new Error('BADGE_NOT_APPLIED')
      }
    }

    const clearOwnership = await tx.userBadgeOwnership.updateMany({
      where: {
        id: ownership.id,
        userId,
        applicationTarget: ownership.applicationTarget,
        appliedInstanceId: ownership.appliedInstanceId
      },
      data: {
        applicationTarget: null,
        appliedInstanceId: null,
        appliedAt: null
      }
    })

    if (clearOwnership.count === 0) {
      throw new Error('BADGE_NOT_APPLIED')
    }

    const updatedOwnership = await tx.userBadgeOwnership.findUniqueOrThrow({
      where: { id: ownership.id },
      include: {
        appliedInstance: {
          select: { id: true, name: true }
        }
      }
    })

    return mapBadgeOwnership(updatedOwnership, badgeMap)
  })
}

export async function seedDefaultBadges() {
  const seedState = await prisma.systemConfig.findUnique({
    where: { key: 'badge_catalog_seeded' },
    select: { value: true }
  })
  if (seedState?.value === 'true') {
    return
  }

  const existingSeriesCount = await prisma.badgeSeries.count()
  const existingBadgeCount = await prisma.badge.count()

  if (existingSeriesCount > 0 || existingBadgeCount > 0) {
    await prisma.systemConfig.upsert({
      where: { key: 'badge_catalog_seeded' },
      update: { value: 'true' },
      create: {
        key: 'badge_catalog_seeded',
        value: 'true',
        type: 'boolean',
        label: '徽章目录已初始化',
        description: '用于避免启动时重复导入默认徽章目录'
      }
    })
    return
  }

  const seriesMap = new Map<string, {
    id: string
    title: string
    nameZh: string
    nameEn: string | null
    description: string
    sourceId: string | null
    sourceLabel: string | null
    displayOrder: number
  }>()

  DEFAULT_BADGE_CATALOG.forEach((badge) => {
    if (!seriesMap.has(badge.seriesId)) {
      seriesMap.set(badge.seriesId, {
        id: badge.seriesId,
        title: badge.seriesTitle,
        nameZh: badge.seriesNameZh || badge.seriesTitle,
        nameEn: badge.seriesNameEn ?? null,
        description: badge.seriesDescription,
        sourceId: badge.sourceId ?? null,
        sourceLabel: badge.sourceLabel ?? null,
        displayOrder: (seriesMap.size + 1) * 100
      })
    }
  })

  await prisma.$transaction(async (tx) => {
    for (const series of seriesMap.values()) {
      await tx.badgeSeries.upsert({
        where: { id: series.id },
        update: {},
        create: series
      })
    }

    for (let index = 0; index < DEFAULT_BADGE_CATALOG.length; index += 1) {
      const badge = DEFAULT_BADGE_CATALOG[index]
      await tx.badge.upsert({
        where: { id: badge.id },
        update: {},
        create: {
          id: badge.id,
          name: badge.name,
          nameEn: badge.nameEn,
          fullLabel: badge.fullLabel,
          seriesId: badge.seriesId,
          sourceId: badge.sourceId ?? null,
          sourceLabel: badge.sourceLabel ?? null,
          assetUrl: badge.assetUrl,
          assetUrlDark: badge.assetUrlDark ?? null,
          assetUrlLight: badge.assetUrlLight ?? null,
          displayOrder: (index + 1) * 10
        }
      })
    }

    await tx.systemConfig.upsert({
      where: { key: 'badge_catalog_seeded' },
      update: { value: 'true' },
      create: {
        key: 'badge_catalog_seeded',
        value: 'true',
        type: 'boolean',
        label: '徽章目录已初始化',
        description: '用于避免启动时重复导入默认徽章目录'
      }
    })
  })

  if (DEFAULT_BADGE_CATALOG.length > 0) {
    console.log(`✅ 默认徽章目录已导入: ${seriesMap.size} 个系列，${DEFAULT_BADGE_CATALOG.length} 个徽章`)
  }
}

export async function getAdminBadgeCatalog() {
  const [series, badges, ownershipCounts, avatarUseCounts, instanceUseCounts] = await Promise.all([
    getBadgeSeriesList(),
    prisma.badge.findMany({
      include: { series: true },
      orderBy: [
        { series: { displayOrder: 'asc' } },
        { displayOrder: 'asc' },
        { id: 'asc' }
      ]
    }),
    prisma.userBadgeOwnership.groupBy({
      by: ['badgeId'],
      _count: { _all: true }
    }),
    prisma.user.groupBy({
      by: ['avatarBadgeId'],
      where: { avatarBadgeId: { not: null } },
      _count: { _all: true }
    }),
    prisma.instance.groupBy({
      by: ['iconBadgeId'],
      where: { iconBadgeId: { not: null } },
      _count: { _all: true }
    })
  ])

  const ownershipMap = new Map(ownershipCounts.map(item => [item.badgeId, item._count._all]))
  const avatarMap = new Map(avatarUseCounts.map(item => [item.avatarBadgeId ?? '', item._count._all]))
  const instanceMap = new Map(instanceUseCounts.map(item => [item.iconBadgeId ?? '', item._count._all]))

  return {
    series,
    badges: badges.map(row => ({
      ...mapBadgeRow(row),
      displayOrder: row.displayOrder,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ownershipCount: ownershipMap.get(row.id) ?? 0,
      avatarUseCount: avatarMap.get(row.id) ?? 0,
      instanceUseCount: instanceMap.get(row.id) ?? 0
    }))
  }
}

export async function createBadgeSeries(data: {
  id: string
  title: string
  nameZh: string
  nameEn?: string | null
  description: string
  sourceId?: string | null
  sourceLabel?: string | null
  displayOrder?: number
  isActive?: boolean
}) {
  return prisma.badgeSeries.create({
    data: {
      id: data.id,
      title: data.title,
      nameZh: data.nameZh,
      nameEn: data.nameEn ?? null,
      description: data.description,
      sourceId: data.sourceId ?? null,
      sourceLabel: data.sourceLabel ?? null,
      displayOrder: data.displayOrder ?? 0,
      isActive: data.isActive ?? true
    }
  })
}

export async function updateBadgeSeries(id: string, data: {
  title?: string
  nameZh?: string
  nameEn?: string | null
  description?: string
  sourceId?: string | null
  sourceLabel?: string | null
  displayOrder?: number
  isActive?: boolean
}) {
  return prisma.badgeSeries.update({
    where: { id },
    data: withoutUndefined(data)
  })
}

export async function deleteBadgeSeries(id: string) {
  const badgeCount = await prisma.badge.count({ where: { seriesId: id } })
  if (badgeCount > 0) {
    throw new Error('BADGE_SERIES_HAS_BADGES')
  }

  return prisma.badgeSeries.delete({ where: { id } })
}

export async function createBadge(data: {
  id: string
  name: string
  nameEn?: string | null
  fullLabel: string
  seriesId: string
  sourceId?: string | null
  sourceLabel?: string | null
  assetUrl: string
  assetUrlDark?: string | null
  assetUrlLight?: string | null
  displayOrder?: number
  isActive?: boolean
}) {
  return prisma.badge.create({
    data: {
      id: data.id,
      name: data.name,
      nameEn: data.nameEn ?? null,
      fullLabel: data.fullLabel,
      seriesId: data.seriesId,
      sourceId: data.sourceId ?? null,
      sourceLabel: data.sourceLabel ?? null,
      assetUrl: data.assetUrl,
      assetUrlDark: data.assetUrlDark ?? null,
      assetUrlLight: data.assetUrlLight ?? null,
      displayOrder: data.displayOrder ?? 0,
      isActive: data.isActive ?? true
    }
  })
}

export async function updateBadge(id: string, data: {
  name?: string
  nameEn?: string | null
  fullLabel?: string
  seriesId?: string
  sourceId?: string | null
  sourceLabel?: string | null
  assetUrl?: string
  assetUrlDark?: string | null
  assetUrlLight?: string | null
  displayOrder?: number
  isActive?: boolean
}) {
  return prisma.badge.update({
    where: { id },
    data: withoutUndefined(data)
  })
}

export async function deleteBadge(id: string) {
  const [ownershipCount, avatarUseCount, instanceUseCount] = await Promise.all([
    prisma.userBadgeOwnership.count({ where: { badgeId: id } }),
    prisma.user.count({ where: { avatarBadgeId: id } }),
    prisma.instance.count({ where: { iconBadgeId: id } })
  ])

  if (ownershipCount > 0 || avatarUseCount > 0 || instanceUseCount > 0) {
    throw new Error('BADGE_IN_USE')
  }

  return prisma.badge.delete({ where: { id } })
}
