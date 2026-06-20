/**
 * 抽奖系统数据库操作
 */
import { prisma } from './prisma.js'
import { Prisma } from '@prisma/client'
import type { LotteryPrizeType, LotteryRecordStatus } from '@prisma/client'
import { createBadgeOwnership, selectRandomBadgeOrThrow } from './badges.js'
import type { BadgeOwnershipView } from './badges.js'

// ==================== 抽奖活动 ====================

/**
 * 创建抽奖活动
 */
export async function createLottery(data: {
  name: string
  description?: string
  costPoints: number
  isActive?: boolean
  startAt?: Date
  endAt?: Date
  createdBy: number
}) {
  return prisma.lottery.create({
    data: {
      name: data.name,
      description: data.description,
      costPoints: data.costPoints,
      isActive: data.isActive ?? true,
      startAt: data.startAt,
      endAt: data.endAt,
      createdBy: data.createdBy
    }
  })
}

/**
 * 更新抽奖活动
 */
export async function updateLottery(id: number, data: {
  name?: string
  description?: string
  costPoints?: number
  isActive?: boolean
  startAt?: Date | null
  endAt?: Date | null
}) {
  return prisma.lottery.update({
    where: { id },
    data
  })
}

/**
 * 删除抽奖活动
 */
export async function deleteLottery(id: number) {
  return prisma.lottery.delete({ where: { id } })
}

/**
 * 获取抽奖活动详情
 */
export async function getLotteryById(id: number) {
  return prisma.lottery.findUnique({
    where: { id },
    include: {
      prizes: {
        orderBy: { displayOrder: 'asc' }
      },
      notificationConfig: true,
      _count: {
        select: { records: true }
      }
    }
  })
}

/**
 * 获取所有抽奖活动（管理端）
 */
export async function getAllLotteries(options: {
  page?: number
  pageSize?: number
  isActive?: boolean
} = {}) {
  const { page = 1, pageSize = 20, isActive } = options
  const skip = (page - 1) * pageSize

  const where: Prisma.LotteryWhereInput = {}
  if (isActive !== undefined) {
    where.isActive = isActive
  }

  const [lotteries, total] = await Promise.all([
    prisma.lottery.findMany({
      where,
      include: {
        prizes: {
          orderBy: { displayOrder: 'asc' }
        },
        _count: {
          select: { records: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip
    }),
    prisma.lottery.count({ where })
  ])

  return { lotteries, total, page, pageSize }
}

/**
 * 获取可用抽奖活动（用户端）
 */
export async function getActiveLotteries() {
  const now = new Date()

  return prisma.lottery.findMany({
    where: {
      isActive: true,
      OR: [
        { startAt: null },
        { startAt: { lte: now } }
      ],
      AND: [
        {
          OR: [
            { endAt: null },
            { endAt: { gte: now } }
          ]
        }
      ]
    },
    include: {
      prizes: {
        orderBy: { displayOrder: 'asc' }
      },
      _count: {
        select: { records: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
}

// ==================== 奖品管理 ====================

/**
 * 添加奖品
 */
export async function createPrize(data: {
  lotteryId: number
  name: string
  type: LotteryPrizeType
  value?: number
  probability: number
  totalQuantity?: number
  displayOrder?: number
  instanceDesc?: string
}) {
  return prisma.lotteryPrize.create({
    data: {
      lotteryId: data.lotteryId,
      name: data.name,
      type: data.type,
      value: data.value ?? 0,
      probability: data.probability,
      totalQuantity: data.totalQuantity,
      remainQuantity: data.totalQuantity, // 初始剩余等于总数
      displayOrder: data.displayOrder ?? 0,
      instanceDesc: data.instanceDesc
    }
  })
}

/**
 * 更新奖品
 */
export async function updatePrize(id: number, data: {
  name?: string
  type?: LotteryPrizeType
  value?: number
  probability?: number
  totalQuantity?: number | null
  remainQuantity?: number | null
  displayOrder?: number
  instanceDesc?: string | null
}) {
  return prisma.lotteryPrize.update({
    where: { id },
    data
  })
}

/**
 * 删除奖品
 */
export async function deletePrize(id: number) {
  return prisma.lotteryPrize.delete({ where: { id } })
}

/**
 * 获取奖品详情
 */
export async function getPrizeById(id: number) {
  return prisma.lotteryPrize.findUnique({
    where: { id },
    include: { lottery: true }
  })
}

// ==================== 抽奖通知配置 ====================

/**
 * 更新或创建抽奖通知配置
 */
export async function upsertLotteryNotificationConfig(
  lotteryId: number,
  data: {
    enabled: boolean
    type: string
    config: Record<string, unknown>
    notifyBalance: boolean
    notifyInstance: boolean
  }
) {
  return prisma.lotteryNotificationConfig.upsert({
    where: { lotteryId },
    update: {
      enabled: data.enabled,
      type: data.type,
      config: data.config as Prisma.JsonObject,
      notifyBalance: data.notifyBalance,
      notifyInstance: data.notifyInstance
    },
    create: {
      lotteryId,
      enabled: data.enabled,
      type: data.type,
      config: data.config as Prisma.JsonObject,
      notifyBalance: data.notifyBalance,
      notifyInstance: data.notifyInstance
    }
  })
}

/**
 * 获取抽奖通知配置
 */
export async function getLotteryNotificationConfig(lotteryId: number) {
  return prisma.lotteryNotificationConfig.findUnique({
    where: { lotteryId }
  })
}

// ==================== 中奖记录 ====================

/**
 * 创建中奖记录
 */
export async function createLotteryRecord(data: {
  lotteryId: number
  prizeId: number
  userId: number
  prizeType: LotteryPrizeType
  prizeValue: number
  prizeName: string
  status: LotteryRecordStatus
  pointsSpent: number
  deliveredAt?: Date
}) {
  return prisma.lotteryRecord.create({
    data: {
      lotteryId: data.lotteryId,
      prizeId: data.prizeId,
      userId: data.userId,
      prizeType: data.prizeType,
      prizeValue: data.prizeValue,
      prizeName: data.prizeName,
      status: data.status,
      pointsSpent: data.pointsSpent,
      deliveredAt: data.deliveredAt
    }
  })
}

/**
 * 更新中奖记录状态
 */
export async function updateLotteryRecordStatus(
  id: number,
  status: LotteryRecordStatus,
  deliveredBy?: number,
  ticketId?: number
) {
  return prisma.lotteryRecord.update({
    where: { id },
    data: {
      status,
      deliveredAt: status === 'delivered' || status === 'claimed' ? new Date() : undefined,
      deliveredBy,
      ticketId
    }
  })
}

/**
 * 标记通知已发送
 */
export async function markRecordNotificationSent(id: number) {
  return prisma.lotteryRecord.update({
    where: { id },
    data: { notificationSent: true }
  })
}

/**
 * 获取用户中奖记录
 */
export async function getUserLotteryRecords(
  userId: number,
  options: { page?: number; pageSize?: number; prizeType?: string } = {}
) {
  const { page = 1, pageSize = 20, prizeType } = options
  const skip = (page - 1) * pageSize

  const where: any = { userId }
  if (prizeType) {
    where.prizeType = prizeType
  }

  const [records, total] = await Promise.all([
    prisma.lotteryRecord.findMany({
      where,
      include: {
        lottery: {
          select: { id: true, name: true }
        },
        prize: {
          select: { instanceDesc: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip
    }),
    prisma.lotteryRecord.count({ where })
  ])

  return { records, total, page, pageSize }
}

/**
 * 获取所有中奖记录（管理端）
 */
export async function getAllLotteryRecords(options: {
  page?: number
  pageSize?: number
  lotteryId?: number
  prizeType?: LotteryPrizeType
  status?: LotteryRecordStatus
  search?: string
} = {}) {
  const { page = 1, pageSize = 20, lotteryId, prizeType, status, search } = options
  const skip = (page - 1) * pageSize

  const where: Prisma.LotteryRecordWhereInput = {}
  if (lotteryId) where.lotteryId = lotteryId
  if (prizeType) where.prizeType = prizeType
  if (status) where.status = status
  if (search) {
    where.user = {
      username: { contains: search, mode: 'insensitive' }
    }
  }

  const [records, total] = await Promise.all([
    prisma.lotteryRecord.findMany({
      where,
      include: {
        lottery: {
          select: { id: true, name: true }
        },
        user: {
          select: { id: true, username: true, avatarStyle: true }
        },
        prize: {
          select: { instanceDesc: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip
    }),
    prisma.lotteryRecord.count({ where })
  ])

  return { records, total, page, pageSize }
}

/**
 * 获取待发放的实例奖励记录
 */
export async function getPendingInstancePrizes() {
  return prisma.lotteryRecord.findMany({
    where: {
      prizeType: 'instance',
      status: 'pending'
    },
    include: {
      lottery: {
        select: { id: true, name: true }
      },
      user: {
        select: { id: true, username: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  })
}

// ==================== 抽奖核心逻辑 ====================

/**
 * 加权随机选择奖品（绝对概率模式）
 * 概率值按实际设定值计算，不足100%的部分自动归入"谢谢参与"
 * 
 * 关键设计：遍历所有奖品计算概率区间，而不是只遍历available
 * 这样即使某奖品库存耗尽，其概率区间也被保留，命中该区间时回退到nothing
 */
export function weightedRandomSelect(prizes: Array<{
  id: number
  type: LotteryPrizeType
  probability: number | Prisma.Decimal
  remainQuantity: number | null
}>) {
  // 找到"谢谢参与"奖品（作为兜底）
  const nothingPrize = prizes.find(p => p.type === 'nothing')
  
  // 检查是否有任何可用奖品
  const hasAvailable = prizes.some(p =>
    p.remainQuantity === null || p.remainQuantity > 0
  )
  if (!hasAvailable) {
    throw new Error('NO_AVAILABLE_PRIZES')
  }

  // 使用绝对概率（基于100%）
  const random = Math.random() * 100
  let cumulative = 0

  // 遍历所有奖品（包括已抽完的），保持概率区间不变
  for (const prize of prizes) {
    cumulative += Number(prize.probability)
    if (random < cumulative) {
      // 检查该奖品是否有库存
      if (prize.remainQuantity === null || prize.remainQuantity > 0) {
        return prize
      }
      // 库存已空，回退到"谢谢参与"
      if (nothingPrize) return nothingPrize
      // 如果没有nothing奖品，继续检查下一个
    }
  }

  // 随机数超出所有概率之和，返回"谢谢参与"
  if (nothingPrize) return nothingPrize

  // 没有"谢谢参与"奖品且概率总和不足100%，这是配置错误
  // 抛出明确错误，避免意外将剩余概率分配给其他奖品
  throw new Error('LOTTERY_CONFIG_ERROR: 奖品概率总和不足100%且缺少"谢谢参与"奖品，请添加一个type为nothing的奖品来补足剩余概率')
}

/**
 * 执行抽奖
 */
export async function performDraw(userId: number, lotteryId: number): Promise<{
  success: boolean
  record?: Awaited<ReturnType<typeof createLotteryRecord>>
  prize?: {
    id: number
    name: string
    type: LotteryPrizeType
    value: number
    instanceDesc: string | null
    badgeOwnership: BadgeOwnershipView | null
  }
  currentPoints?: number
  message?: string
}> {
  // 使用 RepeatableRead + 乐观锁确保并发安全，防止奖品超发
  // 事务冲突会在路由层通过指数退避重试机制处理
  return prisma.$transaction(
    async (tx) => {
    // 1. 检查抽奖是否有效
    const lottery = await tx.lottery.findUnique({
      where: { id: lotteryId },
      include: { prizes: true }
    })

    if (!lottery) {
      return { success: false, message: '抽奖活动不存在' }
    }

    if (!lottery.isActive) {
      return { success: false, message: '抽奖活动已关闭' }
    }

    const now = new Date()
    if (lottery.startAt && lottery.startAt > now) {
      return { success: false, message: '抽奖活动尚未开始' }
    }
    if (lottery.endAt && lottery.endAt < now) {
      return { success: false, message: '抽奖活动已结束' }
    }

    if (lottery.prizes.length === 0) {
      return { success: false, message: '奖池为空' }
    }

    // 2. 检查用户积分（使用 upsert 避免并发时的唯一约束冲突）
    const userPoints = await tx.userPoints.upsert({
      where: { userId },
      update: {},
      create: { userId }
    })

    if (userPoints.points < lottery.costPoints) {
      return { success: false, message: '积分不足' }
    }

    // 3. 扣除积分
    await tx.userPoints.update({
      where: { userId },
      data: {
        points: { decrement: lottery.costPoints },
        totalSpent: { increment: lottery.costPoints }
      }
    })

    // 4. 随机抽取奖品
    const selectedPrize = weightedRandomSelect(lottery.prizes.map(p => ({
      id: p.id,
      type: p.type,
      probability: p.probability,
      remainQuantity: p.remainQuantity
    })))

    let prize = lottery.prizes.find(p => p.id === selectedPrize.id)!

    // 5. 使用乐观锁扣减库存（防止超发）
    if (prize.remainQuantity !== null) {
      const updateResult = await tx.lotteryPrize.updateMany({
        where: { 
          id: prize.id,
          remainQuantity: { gt: 0 }  // 只有库存 > 0 才扣减
        },
        data: { remainQuantity: { decrement: 1 } }
      })
      
      // 如果扣减失败（库存已空），回退到"谢谢参与"奖品
      if (updateResult.count === 0) {
        const nothingPrize = lottery.prizes.find(p => p.type === 'nothing')
        if (nothingPrize) {
          prize = nothingPrize
        } else {
          // 没有谢谢参与奖品，返回失败
          return { success: false, message: '奖品库存不足，请稍后再试' }
        }
      }
    }

    // 6. 处理奖品发放
    let status: LotteryRecordStatus = 'delivered'
    let currentPoints = userPoints.points - lottery.costPoints
    let resolvedPrizeName = prize.name
    const resolvedPrizeValue = prize.type === 'badge' ? 0 : prize.value
    let badgeOwnership: BadgeOwnershipView | null = null

    if (prize.type === 'balance') {
      // 自动发放余额（value 存储分，转换为元）
      const balanceAmount = prize.value / 100
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      })
      if (user) {
        const balanceBefore = Number(user.balance)
        const balanceAfter = balanceBefore + balanceAmount
        await tx.user.update({
          where: { id: userId },
          data: { balance: balanceAfter }
        })
        // 记录余额日志
        await tx.balanceLog.create({
          data: {
            userId,
            type: 'gift',
            amount: balanceAmount,
            balanceBefore,
            balanceAfter,
            remark: `抽奖中奖：${prize.name}`
          }
        })
      }
    } else if (prize.type === 'points') {
      // 自动发放积分
      await tx.userPoints.update({
        where: { userId },
        data: {
          points: { increment: prize.value },
          totalEarned: { increment: prize.value }
        }
      })
      currentPoints += prize.value
    } else if (prize.type === 'badge') {
      const selectedBadge = await selectRandomBadgeOrThrow(tx)
      badgeOwnership = await createBadgeOwnership(tx, userId, selectedBadge.id, 'lottery', selectedBadge)
      resolvedPrizeName = selectedBadge.fullLabel
    } else if (prize.type === 'instance') {
      // 实例奖励需手动发放
      status = 'pending'
    } else if (prize.type === 'cpu' || prize.type === 'memory' || prize.type === 'disk' || prize.type === 'traffic') {
      // 资源奖品：存入用户资源池
      const resourceFieldMap: Record<string, 'cpu' | 'memory' | 'disk' | 'traffic'> = {
        cpu: 'cpu',
        memory: 'memory',
        disk: 'disk',
        traffic: 'traffic'
      }
      const field = resourceFieldMap[prize.type]
      const resourceTypeMap: Record<string, 'c' | 'r' | 'd' | 't'> = {
        cpu: 'c',
        memory: 'r',
        disk: 'd',
        traffic: 't'
      }
      const resourceType = resourceTypeMap[prize.type]

      // 更新资源池
      await tx.userResourcePool.upsert({
        where: { userId },
        update: {
          [field]: field === 'traffic'
            ? { increment: BigInt(prize.value) }
            : { increment: prize.value }
        },
        create: {
          userId,
          [field]: field === 'traffic' ? BigInt(prize.value) : prize.value
        }
      })

      // 记录资源池日志
      await tx.resourcePoolLog.create({
        data: {
          userId,
          action: 'lottery',
          resourceType,
          amount: prize.value,
          remark: `抽奖中奖：${prize.name}`
        }
      })
    }
    // nothing 类型不需要任何操作

    // 7. 创建中奖记录
    const record = await tx.lotteryRecord.create({
      data: {
        lotteryId,
        prizeId: prize.id,
        userId,
        prizeType: prize.type,
        prizeValue: resolvedPrizeValue,
        prizeName: resolvedPrizeName,
        status,
        pointsSpent: lottery.costPoints,
        deliveredAt: status === 'delivered' ? new Date() : null
      }
    })

    // 8. 记录积分日志
    await tx.pointsLog.create({
      data: {
        userId,
        type: 'lottery_spend',
        amount: -lottery.costPoints,
        pointsBefore: userPoints.points,
        pointsAfter: userPoints.points - lottery.costPoints,
        relatedId: record.id,
        remark: `抽奖消耗：${lottery.name}`
      }
    })

    // 如果中了积分奖励，再记一条获得日志
    if (prize.type === 'points') {
      await tx.pointsLog.create({
        data: {
          userId,
          type: 'lottery_win',
          amount: prize.value,
          pointsBefore: userPoints.points - lottery.costPoints,
          pointsAfter: userPoints.points - lottery.costPoints + prize.value,
          relatedId: record.id,
          remark: `抽奖中奖：${prize.name}`
        }
      })
    }

    // 注意：totalDraws 不在事务中更新，避免热点数据冲突导致死锁
    // 统计数据可通过 count(lotteryRecord) 实时计算

    return {
      success: true,
      record,
      prize: {
        id: prize.id,
        name: resolvedPrizeName,
        type: prize.type,
        value: resolvedPrizeValue,
        instanceDesc: prize.instanceDesc,
        badgeOwnership
      },
      currentPoints
    }
  },
  {
    // RepeatableRead 比 Serializable 冲突更少，配合乐观锁防超发
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 5000,
    timeout: 10000
  })
}

/**
 * 获取抽奖统计（管理端）
 */
export async function getLotteryStats(lotteryId: number) {
  const [totalRecords, prizeStats] = await Promise.all([
    prisma.lotteryRecord.count({ where: { lotteryId } }),
    prisma.lotteryRecord.groupBy({
      by: ['prizeType'],
      where: { lotteryId },
      _count: true
    })
  ])

  return {
    totalDraws: totalRecords,
    prizeStats: prizeStats.map(s => ({
      type: s.prizeType,
      count: s._count
    }))
  }
}
