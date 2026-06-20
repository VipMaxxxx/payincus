/**
 * 积分系统数据库操作
 */
import { prisma } from './prisma.js'
import type { PointsLogType, Prisma } from '@prisma/client'
import { getUserTotalConsume } from './balance.js'

// ==================== 用户积分 ====================

/**
 * 获取用户积分信息
 */
export async function getUserPoints(userId: number) {
  // 使用 upsert 避免并发时的唯一约束冲突
  const userPoints = await prisma.userPoints.upsert({
    where: { userId },
    update: {},
    create: { userId }
  })

  return userPoints
}

/**
 * 获取用户可兑换的消费金额
 */
export async function getConvertibleConsume(userId: number): Promise<{
  totalConsume: number
  convertedConsume: number
  convertibleAmount: number
  convertiblePoints: number
}> {
  // 获取用户积分记录
  const userPoints = await getUserPoints(userId)

  // 获取用户实际总消费额，兼容历史 consume 日志 amount 正负号不一致
  const totalConsume = await getUserTotalConsume(userId)

  // 计算可兑换金额
  const convertedConsume = parseFloat(String(userPoints.convertedConsume))
  const convertibleAmount = Math.max(0, totalConsume - convertedConsume)
  const convertiblePoints = Math.floor(convertibleAmount * 100) // 1元 = 100积分

  return {
    totalConsume,
    convertedConsume,
    convertibleAmount,
    convertiblePoints
  }
}

/**
 * 兑换积分
 */
export async function convertPointsFromConsumption(userId: number): Promise<{
  success: boolean
  converted: number
  newPoints: number
  consumeConverted: number
  message?: string
}> {
  return prisma.$transaction(async (tx) => {
    // 使用 upsert 避免并发时的唯一约束冲突
    const userPoints = await tx.userPoints.upsert({
      where: { userId },
      update: {},
      create: { userId }
    })

    // 2. 获取用户当前实际总消费额，兼容历史 consume 日志 amount 正负号不一致
    const totalConsume = await getUserTotalConsume(userId, tx)

    // 3. 计算可兑换的新积分
    const alreadyConverted = parseFloat(String(userPoints.convertedConsume))
    const newConvertableConsume = totalConsume - alreadyConverted

    if (newConvertableConsume <= 0) {
      return {
        success: false,
        converted: 0,
        newPoints: userPoints.points,
        consumeConverted: 0,
        message: '暂无可兑换的消费额'
      }
    }

    // 4. 计算新积分（1元 = 100积分）
    const newPoints = Math.floor(newConvertableConsume * 100)

    // 5. 更新用户积分
    const updatedPoints = await tx.userPoints.update({
      where: { userId },
      data: {
        points: { increment: newPoints },
        totalEarned: { increment: newPoints },
        convertedConsume: totalConsume,
        lastConvertedAt: new Date()
      }
    })

    // 6. 记录积分变动日志
    await tx.pointsLog.create({
      data: {
        userId,
        type: 'convert',
        amount: newPoints,
        pointsBefore: userPoints.points,
        pointsAfter: updatedPoints.points,
        remark: `消费兑换：¥${newConvertableConsume.toFixed(2)} → ${newPoints}积分`
      }
    })

    return {
      success: true,
      converted: newPoints,
      newPoints: updatedPoints.points,
      consumeConverted: newConvertableConsume
    }
  })
}

/**
 * 扣除用户积分（用于抽奖）
 */
export async function deductPoints(
  userId: number,
  amount: number,
  relatedId?: number,
  remark?: string
): Promise<{ success: boolean; newPoints: number; message?: string }> {
  return prisma.$transaction(async (tx) => {
    const userPoints = await tx.userPoints.findUnique({ where: { userId } })
    if (!userPoints) {
      return { success: false, newPoints: 0, message: '积分账户不存在' }
    }

    if (userPoints.points < amount) {
      return { success: false, newPoints: userPoints.points, message: '积分不足' }
    }

    const updatedPoints = await tx.userPoints.update({
      where: { userId },
      data: {
        points: { decrement: amount },
        totalSpent: { increment: amount }
      }
    })

    await tx.pointsLog.create({
      data: {
        userId,
        type: 'lottery_spend',
        amount: -amount,
        pointsBefore: userPoints.points,
        pointsAfter: updatedPoints.points,
        relatedId,
        remark: remark || `抽奖消耗 ${amount} 积分`
      }
    })

    return { success: true, newPoints: updatedPoints.points }
  })
}

/**
 * 增加用户积分（用于抽奖中奖）
 */
export async function addPoints(
  userId: number,
  amount: number,
  type: PointsLogType,
  relatedId?: number,
  remark?: string
): Promise<{ success: boolean; newPoints: number }> {
  return prisma.$transaction(async (tx) => {
    // 使用 upsert 避免并发时的唯一约束冲突
    const userPoints = await tx.userPoints.upsert({
      where: { userId },
      update: {},
      create: { userId }
    })

    const updatedPoints = await tx.userPoints.update({
      where: { userId },
      data: {
        points: { increment: amount },
        totalEarned: { increment: amount }
      }
    })

    await tx.pointsLog.create({
      data: {
        userId,
        type,
        amount,
        pointsBefore: userPoints.points,
        pointsAfter: updatedPoints.points,
        relatedId,
        remark
      }
    })

    return { success: true, newPoints: updatedPoints.points }
  })
}

/**
 * 管理员调整用户积分
 */
export async function adminAdjustPoints(
  userId: number,
  amount: number,
  remark: string
): Promise<{ success: boolean; newPoints: number; message?: string }> {
  return prisma.$transaction(async (tx) => {
    // 使用 upsert 避免并发时的唯一约束冲突
    const userPoints = await tx.userPoints.upsert({
      where: { userId },
      update: {},
      create: { userId }
    })

    // 检查扣除后是否会变成负数
    if (amount < 0 && userPoints.points + amount < 0) {
      return { success: false, newPoints: userPoints.points, message: '扣除后积分不能为负数' }
    }

    const updatedPoints = await tx.userPoints.update({
      where: { userId },
      data: {
        points: { increment: amount },
        totalEarned: amount > 0 ? { increment: amount } : undefined,
        totalSpent: amount < 0 ? { increment: Math.abs(amount) } : undefined
      }
    })

    await tx.pointsLog.create({
      data: {
        userId,
        type: 'admin_adjust',
        amount,
        pointsBefore: userPoints.points,
        pointsAfter: updatedPoints.points,
        remark
      }
    })

    return { success: true, newPoints: updatedPoints.points }
  })
}

/**
 * 获取用户积分日志
 */
export async function getPointsLogs(
  userId: number,
  options: { page?: number; pageSize?: number; type?: PointsLogType } = {}
) {
  const { page = 1, pageSize = 20, type } = options
  const skip = (page - 1) * pageSize

  const where: Prisma.PointsLogWhereInput = { userId }
  if (type) {
    where.type = type
  }

  const [logs, total] = await Promise.all([
    prisma.pointsLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip
    }),
    prisma.pointsLog.count({ where })
  ])

  return { logs, total, page, pageSize }
}

/**
 * 获取所有用户积分列表（管理端）
 */
export async function getAllUserPoints(options: {
  page?: number
  pageSize?: number
  search?: string
  orderBy?: 'points' | 'totalEarned' | 'totalSpent'
  order?: 'asc' | 'desc'
} = {}) {
  const { page = 1, pageSize = 20, search, orderBy = 'points', order = 'desc' } = options
  const skip = (page - 1) * pageSize

  const where: Prisma.UserPointsWhereInput = {}
  if (search) {
    where.user = {
      username: { contains: search, mode: 'insensitive' }
    }
  }

  const [records, total] = await Promise.all([
    prisma.userPoints.findMany({
      where,
      include: {
        user: {
          select: { id: true, username: true, avatarStyle: true }
        }
      },
      orderBy: { [orderBy]: order },
      take: pageSize,
      skip
    }),
    prisma.userPoints.count({ where })
  ])

  return { records, total, page, pageSize }
}
