/**
 * 签到系统数据库操作
 * 使用 Prisma ORM
 */

import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import type { RedeemCodeType } from '@prisma/client'
import { getSystemConfigBoolean, getSystemConfigNumber, updateSystemConfigs } from './system-config.js'
import {
  USER_POINTS_LOCK_NAMESPACE,
  USER_RESOURCE_POOL_LOCK_NAMESPACE,
  advisoryTransactionLock
} from './advisory-locks.js'

// 各类型可选数值
const CODE_VALUES: Record<RedeemCodeType, number[]> = {
  c: [1, 2, 3, 5],             // CPU: 1-5%
  r: [2, 4, 6, 12],            // 内存: 2/4/6/12 MB
  d: [16, 32, 64, 128],        // 硬盘: 16/32/64/128 MB
  t: [1, 2, 3, 5],             // 流量: 1/2/3/5 GB
  p: [100, 300, 500, 1000]     // 积分: 100/300/500/1000
}

// 资源类型列表（积分通过固定奖励发放，不走随机）
const CODE_TYPES: RedeemCodeType[] = ['c', 'r', 'd', 't']
const CHECKIN_MIN_POINTS_DEFAULT = 1
const CHECKIN_MAX_POINTS_DEFAULT = 500
const CHECKIN_MAX_POINTS_LIMIT = 100_000

export interface DailyCheckinSettings {
  enabled: boolean
  minPoints: number
  maxPoints: number
  requireInstance: boolean
}

export interface DailyCheckinMeta {
  ipAddress?: string | null
  userAgent?: string | null
}

function clampCheckinPoints(value: number, fallback: number): number {
  if (!Number.isSafeInteger(value)) return fallback
  return Math.min(Math.max(value, 1), CHECKIN_MAX_POINTS_LIMIT)
}

function normalizeCheckinSettings(settings: DailyCheckinSettings): DailyCheckinSettings {
  const minPoints = clampCheckinPoints(settings.minPoints, CHECKIN_MIN_POINTS_DEFAULT)
  const maxPoints = Math.max(
    minPoints,
    clampCheckinPoints(settings.maxPoints, CHECKIN_MAX_POINTS_DEFAULT)
  )

  return {
    enabled: settings.enabled,
    minPoints,
    maxPoints,
    requireInstance: settings.requireInstance
  }
}

function randomizePoints(minPoints: number, maxPoints: number): number {
  return Math.floor(Math.random() * (maxPoints - minPoints + 1)) + minPoints
}

/**
 * 随机选择资源类型和数值
 */
function randomizeReward(): { type: RedeemCodeType; value: number } {
  const type = CODE_TYPES[Math.floor(Math.random() * CODE_TYPES.length)]
  const values = CODE_VALUES[type]
  const value = values[Math.floor(Math.random() * values.length)]
  return { type, value }
}

/**
 * 检查用户是否拥有实例
 */
export async function userHasInstances(userId: number): Promise<boolean> {
  const count = await prisma.instance.count({
    where: {
      userId,
      status: { notIn: ['deleted', 'error'] }
    }
  })
  return count > 0
}

/**
 * 获取北京时间当天 0 点的 UTC 时间戳
 */
function getBeijingMidnight(): Date {
  const now = new Date()
  // 获取北京时间的日期字符串 (YYYY-MM-DD)
  const beijingDateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  // 构建北京时间 0 点对应的 UTC 时间 (北京 00:00 = UTC 前一天 16:00)
  return new Date(`${beijingDateStr}T00:00:00+08:00`)
}

/**
 * 获取日期在北京时间的当天 0 点 UTC 时间戳
 */
function toBeijingMidnight(date: Date): Date {
  const beijingDateStr = date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  return new Date(`${beijingDateStr}T00:00:00+08:00`)
}

function getBeijingDateKey(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

function getYesterdayDateKey(dateKey: string): string {
  const current = new Date(`${dateKey}T00:00:00+08:00`)
  current.setUTCDate(current.getUTCDate() - 1)
  return current.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

export async function getDailyCheckinSettings(): Promise<DailyCheckinSettings> {
  const [enabled, minPoints, maxPoints, requireInstance] = await Promise.all([
    getSystemConfigBoolean('checkin_enabled', true),
    getSystemConfigNumber('checkin_min_points', CHECKIN_MIN_POINTS_DEFAULT),
    getSystemConfigNumber('checkin_max_points', CHECKIN_MAX_POINTS_DEFAULT),
    getSystemConfigBoolean('checkin_require_instance', false)
  ])

  return normalizeCheckinSettings({ enabled, minPoints, maxPoints, requireInstance })
}

export async function updateDailyCheckinSettings(input: Partial<DailyCheckinSettings>): Promise<DailyCheckinSettings> {
  const current = await getDailyCheckinSettings()
  const next = normalizeCheckinSettings({
    enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
    minPoints: typeof input.minPoints === 'number' ? Math.trunc(input.minPoints) : current.minPoints,
    maxPoints: typeof input.maxPoints === 'number' ? Math.trunc(input.maxPoints) : current.maxPoints,
    requireInstance: typeof input.requireInstance === 'boolean' ? input.requireInstance : current.requireInstance
  })

  await updateSystemConfigs([
    { key: 'checkin_enabled', value: String(next.enabled) },
    { key: 'checkin_min_points', value: String(next.minPoints) },
    { key: 'checkin_max_points', value: String(next.maxPoints) },
    { key: 'checkin_require_instance', value: String(next.requireInstance) }
  ])

  return next
}

/**
 * 检查用户今日是否已签到（使用北京时间 0 点刷新）
 */
export async function hasCheckedInToday(userId: number): Promise<boolean> {
  const dateKey = getBeijingDateKey()
  const daily = await prisma.dailyCheckin.findUnique({
    where: { userId_dateKey: { userId, dateKey } },
    select: { id: true }
  })
  if (daily) return true

  const stats = await prisma.checkinStats.findUnique({
    where: { userId }
  })
  
  if (!stats?.lastCheckinDate) return false
  
  const todayMidnight = getBeijingMidnight()
  const lastCheckinMidnight = toBeijingMidnight(stats.lastCheckinDate)
  
  return lastCheckinMidnight.getTime() >= todayMidnight.getTime()
}

/**
 * 检查用户今日是否已兑换（使用北京时间 0 点刷新）
 */
export async function hasRedeemedToday(userId: number): Promise<boolean> {
  const stats = await prisma.checkinStats.findUnique({
    where: { userId }
  })
  
  if (!stats?.lastRedeemDate) return false
  
  const todayMidnight = getBeijingMidnight()
  const lastRedeemMidnight = toBeijingMidnight(stats.lastRedeemDate)
  
  return lastRedeemMidnight.getTime() >= todayMidnight.getTime()
}

/**
 * 获取用户签到统计
 */
export async function getCheckinStats(userId: number) {
  return prisma.checkinStats.findUnique({
    where: { userId }
  })
}

/**
 * 创建或更新用户签到统计
 */
export async function upsertCheckinStats(userId: number, data: {
  lastCheckinDate?: Date
  lastRedeemDate?: Date
  consecutiveOthersUse?: number
  selfOnlyMode?: boolean
}) {
  return prisma.checkinStats.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      ...data
    }
  })
}

/**
 * 执行签到，资源直接存入资源池
 */
export async function performCheckin(userId: number): Promise<{
  codeType: RedeemCodeType
  codeValue: number
}> {
  const { type, value } = randomizeReward()
  const now = new Date()

  // 资源类型到字段的映射
  const fieldMap: Record<string, 'cpu' | 'memory' | 'disk' | 'traffic'> = {
    c: 'cpu', r: 'memory', d: 'disk', t: 'traffic'
  }
  const field = fieldMap[type]

  await prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, userId)

    const currentStats = await tx.checkinStats.findUnique({
      where: { userId },
      select: { lastCheckinDate: true }
    })
    if (currentStats?.lastCheckinDate) {
      const todayMidnight = getBeijingMidnight()
      const lastCheckinMidnight = toBeijingMidnight(currentStats.lastCheckinDate)
      if (lastCheckinMidnight.getTime() >= todayMidnight.getTime()) {
        throw new Error('CHECKIN_ALREADY_TODAY')
      }
    }

    // 更新资源池
    await tx.userResourcePool.upsert({
      where: { userId },
      update: {
        [field]: field === 'traffic'
          ? { increment: BigInt(value) }
          : { increment: value }
      },
      create: {
        userId,
        [field]: field === 'traffic' ? BigInt(value) : value
      }
    })

    // 记录资源池日志
    await tx.resourcePoolLog.create({
      data: {
        userId,
        action: 'checkin',
        resourceType: type,
        amount: value,
        remark: '签到获得'
      }
    })

    // 更新签到统计
    await tx.checkinStats.upsert({
      where: { userId },
      update: { lastCheckinDate: now },
      create: {
        userId,
        lastCheckinDate: now
      }
    })
  })

  return { codeType: type, codeValue: value }
}

export async function performDailyPointsCheckin(
  userId: number,
  meta: DailyCheckinMeta = {}
): Promise<{
  id: number
  dateKey: string
  points: number
  streakDays: number
  currentPoints: number
}> {
  const settings = await getDailyCheckinSettings()
  if (!settings.enabled) {
    throw new Error('CHECKIN_DISABLED')
  }

  const [user, hasInstances] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { status: true } }),
    settings.requireInstance ? userHasInstances(userId) : Promise.resolve(true)
  ])

  if (!user || user.status !== 'active') {
    throw new Error('CHECKIN_USER_BLOCKED')
  }
  if (settings.requireInstance && !hasInstances) {
    throw new Error('CHECKIN_NO_INSTANCE')
  }

  const now = new Date()
  const dateKey = getBeijingDateKey(now)
  const yesterdayKey = getYesterdayDateKey(dateKey)
  const points = randomizePoints(settings.minPoints, settings.maxPoints)

  try {
    return await prisma.$transaction(async (tx) => {
      await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)

      const existing = await tx.dailyCheckin.findUnique({
        where: { userId_dateKey: { userId, dateKey } },
        select: { id: true }
      })
      if (existing) {
        throw new Error('CHECKIN_ALREADY_TODAY')
      }

      const lastRecord = await tx.dailyCheckin.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { dateKey: true, streakDays: true }
      })
      const streakDays = lastRecord?.dateKey === yesterdayKey
        ? lastRecord.streakDays + 1
        : 1

      const userPoints = await tx.userPoints.upsert({
        where: { userId },
        update: {},
        create: { userId }
      })
      const currentPoints = userPoints.points + points
      if (currentPoints > 2_147_483_647) {
        throw new Error('CHECKIN_POINTS_LIMIT_EXCEEDED')
      }

      const record = await tx.dailyCheckin.create({
        data: {
          userId,
          dateKey,
          points,
          streakDays,
          ipAddress: meta.ipAddress?.slice(0, 255) || null,
          userAgent: meta.userAgent?.slice(0, 500) || null
        }
      })

      const updatedPoints = await tx.userPoints.update({
        where: { userId },
        data: {
          points: { increment: points },
          totalEarned: { increment: points }
        }
      })

      await tx.pointsLog.create({
        data: {
          userId,
          type: 'checkin',
          amount: points,
          pointsBefore: userPoints.points,
          pointsAfter: updatedPoints.points,
          relatedId: record.id,
          remark: `每日签到奖励 ${points} 积分`
        }
      })

      await tx.checkinStats.upsert({
        where: { userId },
        update: { lastCheckinDate: now },
        create: {
          userId,
          lastCheckinDate: now
        }
      })

      return {
        id: record.id,
        dateKey,
        points,
        streakDays,
        currentPoints: updatedPoints.points
      }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('CHECKIN_ALREADY_TODAY')
    }
    throw error
  }
}

/**
 * 根据兑换码获取签到记录
 */
export async function getCheckinRecordByCode(redeemCode: string) {
  return prisma.checkinRecord.findUnique({
    where: { redeemCode },
    include: {
      user: {
        select: {
          id: true,
          username: true
        }
      }
    }
  })
}

/**
 * 使用兑换码
 * @param usedFor 实例ID，null 表示存入资源池
 */
export async function useRedeemCode(
  recordId: number,
  usedBy: number,
  usedFor: number | null
): Promise<void> {
  const now = new Date()
  
  await prisma.$transaction([
    // 标记兑换码已使用
    prisma.checkinRecord.update({
      where: { id: recordId },
      data: {
        usedAt: now,
        usedBy,
        usedFor: usedFor // null 表示存入资源池
      }
    }),
    // 更新兑换者的最后兑换日期
    prisma.checkinStats.upsert({
      where: { userId: usedBy },
      update: { lastRedeemDate: now },
      create: {
        userId: usedBy,
        lastRedeemDate: now
      }
    })
  ])
}

/**
 * 更新兑换码所有者的分享状态
 */
export async function updateOwnerShareStatus(
  ownerId: number,
  usedBySelf: boolean
): Promise<void> {
  const stats = await prisma.checkinStats.findUnique({
    where: { userId: ownerId }
  })

  if (usedBySelf) {
    // 自己使用了兑换码，重置连续计数和限制模式
    await prisma.checkinStats.upsert({
      where: { userId: ownerId },
      update: {
        consecutiveOthersUse: 0,
        selfOnlyMode: false
      },
      create: {
        userId: ownerId,
        consecutiveOthersUse: 0,
        selfOnlyMode: false
      }
    })
  } else {
    // 他人使用了兑换码
    const currentCount = stats?.consecutiveOthersUse ?? 0
    const newCount = currentCount + 1
    const selfOnlyMode = newCount >= 2

    await prisma.checkinStats.upsert({
      where: { userId: ownerId },
      update: {
        consecutiveOthersUse: newCount,
        selfOnlyMode
      },
      create: {
        userId: ownerId,
        consecutiveOthersUse: newCount,
        selfOnlyMode
      }
    })
  }
}

/**
 * 获取用户签到记录列表
 */
export async function getCheckinRecords(
  userId: number,
  limit: number = 20,
  offset: number = 0
) {
  const [records, total] = await Promise.all([
    prisma.checkinRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        usedByUser: {
          select: {
            id: true,
            username: true
          }
        },
        instance: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    prisma.checkinRecord.count({ where: { userId } })
  ])

  return {
    records: records.map(r => ({
      id: r.id,
      redeemCode: r.redeemCode,
      codeType: r.codeType,
      codeValue: r.codeValue,
      expiresAt: r.expiresAt.toISOString(),
      usedAt: r.usedAt?.toISOString() ?? null,
      usedBy: r.usedByUser ? {
        id: r.usedByUser.id,
        username: r.usedByUser.username
      } : null,
      usedFor: r.instance ? {
        id: r.instance.id,
        name: r.instance.name
      } : null,
      createdAt: r.createdAt.toISOString()
    })),
    total
  }
}

/**
 * 获取用户兑换记录列表（包含签到兑换码和系统兑换码的使用记录）
 */
export async function getRedeemRecords(
  userId: number,
  limit: number = 20,
  offset: number = 0
) {
  // 并行查询两种兑换记录
  const [checkinRecords, checkinTotal, systemRecords, systemTotal] = await Promise.all([
    // 1. 签到兑换码使用记录
    prisma.checkinRecord.findMany({
      where: { usedBy: userId },
      orderBy: { usedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            username: true
          }
        },
        instance: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    prisma.checkinRecord.count({ where: { usedBy: userId } }),
    // 2. 系统兑换码使用记录
    prisma.redeemCodeUsage.findMany({
      where: { userId },
      orderBy: { usedAt: 'desc' },
      include: {
        redeemCode: {
          select: {
            code: true,
            codeType: true,
            codeValue: true,
            createdBy: {
              select: {
                id: true,
                username: true
              }
            }
          }
        },
        instance: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    prisma.redeemCodeUsage.count({ where: { userId } })
  ])

  // 转换签到兑换码记录为统一格式
  const checkinMapped = checkinRecords.map(r => ({
    id: r.id,
    redeemCode: r.redeemCode,
    codeType: r.codeType,
    codeValue: r.codeValue,
    owner: {
      id: r.user.id,
      username: r.user.username
    },
    usedFor: r.instance ? {
      id: r.instance.id,
      name: r.instance.name
    } : null,
    usedAt: r.usedAt?.toISOString() ?? null,
    isSystemCode: false
  }))

  // 转换系统兑换码记录为统一格式
  const systemMapped = systemRecords.map(r => ({
    id: r.id + 1000000, // 避免 ID 冲突
    redeemCode: r.redeemCode.code,
    codeType: r.redeemCode.codeType,
    codeValue: r.redeemCode.codeValue,
    owner: {
      id: r.redeemCode.createdBy.id,
      username: r.redeemCode.createdBy.username
    },
    usedFor: r.instance ? {
      id: r.instance.id,
      name: r.instance.name
    } : null,
    usedAt: r.usedAt.toISOString(),
    isSystemCode: true
  }))

  // 合并并按使用时间排序
  const allRecords = [...checkinMapped, ...systemMapped]
    .sort((a, b) => {
      const timeA = a.usedAt ? new Date(a.usedAt).getTime() : 0
      const timeB = b.usedAt ? new Date(b.usedAt).getTime() : 0
      return timeB - timeA // 降序
    })
    .slice(offset, offset + limit)

  return {
    records: allRecords,
    total: checkinTotal + systemTotal
  }
}

/**
 * 获取今日签到状态
 */
export async function getCheckinStatus(userId: number) {
  const now = new Date()
  const dateKey = getBeijingDateKey(now)
  const monthKey = dateKey.slice(0, 7)
  const [settings, stats, today, hasInstances, points, totalCheckins, monthCheckins, recentRecords] = await Promise.all([
    getDailyCheckinSettings(),
    getCheckinStats(userId),
    prisma.dailyCheckin.findUnique({
      where: { userId_dateKey: { userId, dateKey } },
      select: { id: true, dateKey: true, points: true, streakDays: true, createdAt: true }
    }),
    userHasInstances(userId),
    prisma.userPoints.findUnique({
      where: { userId },
      select: { points: true, totalEarned: true, totalSpent: true }
    }),
    prisma.dailyCheckin.count({ where: { userId } }),
    prisma.dailyCheckin.count({ where: { userId, dateKey: { startsWith: monthKey } } }),
    prisma.dailyCheckin.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 7,
      select: { id: true, dateKey: true, points: true, streakDays: true, createdAt: true }
    })
  ])

  return {
    enabled: settings.enabled,
    hasCheckedIn: Boolean(today),
    hasInstances,
    requireInstance: settings.requireInstance,
    minPoints: settings.minPoints,
    maxPoints: settings.maxPoints,
    currentPoints: points?.points ?? 0,
    totalEarned: points?.totalEarned ?? 0,
    totalSpent: points?.totalSpent ?? 0,
    today: today ? {
      id: today.id,
      dateKey: today.dateKey,
      points: today.points,
      streakDays: today.streakDays,
      createdAt: today.createdAt.toISOString()
    } : null,
    streakDays: today?.streakDays ?? recentRecords[0]?.streakDays ?? 0,
    totalCheckins,
    monthCheckins,
    recentRecords: recentRecords.map(record => ({
      id: record.id,
      dateKey: record.dateKey,
      points: record.points,
      streakDays: record.streakDays,
      createdAt: record.createdAt.toISOString()
    })),
    selfOnlyMode: stats?.selfOnlyMode ?? false,
    consecutiveOthersUse: stats?.consecutiveOthersUse ?? 0
  }
}

export async function getAdminDailyCheckinLogs(options: {
  page?: number
  pageSize?: number
  search?: string
  dateKey?: string
} = {}) {
  const page = Number.isSafeInteger(options.page) && options.page && options.page > 0 ? options.page : 1
  const pageSize = Number.isSafeInteger(options.pageSize) && options.pageSize
    ? Math.min(Math.max(options.pageSize, 1), 100)
    : 20
  const where: Prisma.DailyCheckinWhereInput = {}
  const search = options.search?.trim()
  const dateKey = options.dateKey?.trim()

  if (dateKey) {
    where.dateKey = dateKey
  }
  if (search) {
    where.user = {
      username: {
        contains: search,
        mode: 'insensitive'
      }
    }
  }

  const [records, total] = await Promise.all([
    prisma.dailyCheckin.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarStyle: true
          }
        }
      }
    }),
    prisma.dailyCheckin.count({ where })
  ])

  return {
    records: records.map(record => ({
      id: record.id,
      userId: record.userId,
      username: record.user.username,
      userAvatar: record.user.avatarStyle,
      dateKey: record.dateKey,
      points: record.points,
      streakDays: record.streakDays,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      createdAt: record.createdAt.toISOString()
    })),
    total,
    page,
    pageSize
  }
}

/**
 * 获取用户可用实例列表（用于兑换选择）
 * 签到兑换码只能用于免费实例，因此只返回 packagePlanId 为 null 的实例
 */
export async function getUserInstancesForRedeem(userId: number) {
  const instances = await prisma.instance.findMany({
    where: {
      userId,
      status: { in: ['running', 'stopped'] },
      packagePlanId: null  // 只返回免费实例
    },
    include: {
      package: {
        select: {
          id: true,
          name: true,
          cpuMax: true,
          memoryMax: true,
          diskMax: true,
          monthlyTrafficLimit: true
        }
      },
      host: {
        select: {
          id: true,
          name: true,
          location: true,
          countryCode: true
        }
      }
    },
    orderBy: { name: 'asc' }
  })

  return instances.map(inst => ({
    id: inst.id,
    name: inst.name,
    status: inst.status,
    cpu: inst.cpu,
    memory: inst.memory,
    disk: inst.disk,
    monthlyTrafficLimit: inst.monthlyTrafficLimit?.toString() ?? null,
    package: inst.package ? {
      id: inst.package.id,
      name: inst.package.name,
      cpuMax: inst.package.cpuMax,
      memoryMax: inst.package.memoryMax,
      diskMax: inst.package.diskMax,
      monthlyTrafficLimit: inst.package.monthlyTrafficLimit?.toString() ?? null
    } : null,
    host: {
      id: inst.host.id,
      name: inst.host.name,
      location: inst.host.location,
      countryCode: inst.host.countryCode
    }
  }))
}

/**
 * 检查用户是否购买过付费实例
 * 用于签到积分分层发放：有付费实例=500积分，无付费实例=100积分
 */
export async function userHasPaidInstance(userId: number): Promise<boolean> {
  const count = await prisma.instance.count({
    where: {
      userId,
      packagePlanId: { not: null }  // packagePlanId 不为空表示付费实例
    }
  })
  return count > 0
}
