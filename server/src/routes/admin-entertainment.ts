/**
 * 娱乐系统 - 管理端 API
 * 抽奖管理、用户积分管理等功能
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import type { LotteryPrizeType, LotteryRecordStatus } from '@prisma/client'

function normalizeOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || null
}

function requireText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function isValidCatalogId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id)
}

function isValidAssetUrl(url: string): boolean {
  return (url.startsWith('/') && !url.startsWith('//')) ||
    url.startsWith('https://') ||
    url.startsWith('http://')
}

export default async function adminEntertainmentRoutes(fastify: FastifyInstance) {
  // ==================== 抽奖管理 API ====================

  /**
   * 获取所有抽奖列表
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      isActive?: string
    }
  }>('/lotteries', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; isActive?: string } }>) => {
    const { page = '1', pageSize = '20', isActive } = request.query

    const result = await db.getAllLotteries({
      page: Number(page),
      pageSize: Number(pageSize),
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined
    })

    return {
      lotteries: result.lotteries.map(lottery => ({
        id: lottery.id,
        name: lottery.name,
        description: lottery.description,
        costPoints: lottery.costPoints,
        isActive: lottery.isActive,
        startAt: lottery.startAt?.toISOString() || null,
        endAt: lottery.endAt?.toISOString() || null,
        totalDraws: lottery._count.records,  // 使用实时统计，而非数据库存储值
        prizesCount: lottery.prizes.length,
        createdAt: lottery.createdAt.toISOString(),
        prizes: lottery.prizes.map(prize => ({
          id: prize.id,
          name: prize.name,
          type: prize.type,
          value: prize.value,
          probability: Number(prize.probability),
          totalQuantity: prize.totalQuantity,
          remainQuantity: prize.remainQuantity,
          displayOrder: prize.displayOrder,
          instanceDesc: prize.instanceDesc
        }))
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  /**
   * 创建抽奖
   */
  fastify.post<{
    Body: {
      name: string
      description?: string
      costPoints: number
      isActive?: boolean
      startAt?: string
      endAt?: string
    }
  }>('/lotteries', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Body: {
      name: string
      description?: string
      costPoints: number
      isActive?: boolean
      startAt?: string
      endAt?: string
    }
  }>, reply: FastifyReply) => {
    const { name, description, costPoints, isActive, startAt, endAt } = request.body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.code(400).send({ error: 'NAME_REQUIRED', message: 'Lottery name is required' })
    }

    if (!costPoints || costPoints < 1) {
      return reply.code(400).send({ error: 'INVALID_COST', message: 'Cost points must be at least 1' })
    }

    const lottery = await db.createLottery({
      name: name.trim(),
      description: description?.trim(),
      costPoints,
      isActive,
      startAt: startAt ? new Date(startAt) : undefined,
      endAt: endAt ? new Date(endAt) : undefined,
      createdBy: request.user.id
    })

    await createLog(
      request.user.id,
      'admin',
      'lottery.create',
      `Created lottery "${lottery.name}" (ID: ${lottery.id})`,
      'success'
    )

    return { success: true, lottery: { id: lottery.id, name: lottery.name } }
  })

  /**
   * 更新抽奖
   */
  fastify.put<{
    Params: { id: string }
    Body: {
      name?: string
      description?: string
      costPoints?: number
      isActive?: boolean
      startAt?: string | null
      endAt?: string | null
    }
  }>('/lotteries/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      name?: string
      description?: string
      costPoints?: number
      isActive?: boolean
      startAt?: string | null
      endAt?: string | null
    }
  }>, reply: FastifyReply) => {
    const lotteryId = Number(request.params.id)

    if (isNaN(lotteryId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid lottery ID' })
    }

    const existing = await db.getLotteryById(lotteryId)
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Lottery not found' })
    }

    const { name, description, costPoints, isActive, startAt, endAt } = request.body

    await db.updateLottery(lotteryId, {
      name: name?.trim(),
      description: description?.trim(),
      costPoints,
      isActive,
      startAt: startAt === null ? null : startAt ? new Date(startAt) : undefined,
      endAt: endAt === null ? null : endAt ? new Date(endAt) : undefined
    })

    await createLog(
      request.user.id,
      'admin',
      'lottery.update',
      `Updated lottery "${existing.name}" (ID: ${lotteryId})`,
      'success'
    )

    return { success: true }
  })

  /**
   * 删除抽奖
   */
  fastify.delete<{ Params: { id: string } }>('/lotteries/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const lotteryId = Number(request.params.id)

    if (isNaN(lotteryId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid lottery ID' })
    }

    const existing = await db.getLotteryById(lotteryId)
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Lottery not found' })
    }

    await db.deleteLottery(lotteryId)

    await createLog(
      request.user.id,
      'admin',
      'lottery.delete',
      `Deleted lottery "${existing.name}" (ID: ${lotteryId})`,
      'success'
    )

    return { success: true }
  })

  /**
   * 获取抽奖详情
   */
  fastify.get<{ Params: { id: string } }>('/lotteries/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const lotteryId = Number(request.params.id)

    if (isNaN(lotteryId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid lottery ID' })
    }

    const lottery = await db.getLotteryById(lotteryId)

    if (!lottery) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Lottery not found' })
    }

    const stats = await db.getLotteryStats(lotteryId)

    return {
      lottery: {
        id: lottery.id,
        name: lottery.name,
        description: lottery.description,
        costPoints: lottery.costPoints,
        isActive: lottery.isActive,
        startAt: lottery.startAt?.toISOString() || null,
        endAt: lottery.endAt?.toISOString() || null,
        totalDraws: stats.totalDraws,  // 使用实时统计，而非数据库存储值
        createdAt: lottery.createdAt.toISOString(),
        prizes: lottery.prizes.map(prize => ({
          id: prize.id,
          name: prize.name,
          type: prize.type,
          value: prize.value,
          probability: Number(prize.probability),
          totalQuantity: prize.totalQuantity,
          remainQuantity: prize.remainQuantity,
          displayOrder: prize.displayOrder,
          instanceDesc: prize.instanceDesc
        })),
        notificationConfig: lottery.notificationConfig ? {
          enabled: lottery.notificationConfig.enabled,
          type: lottery.notificationConfig.type,
          config: lottery.notificationConfig.config,
          notifyBalance: lottery.notificationConfig.notifyBalance,
          notifyInstance: lottery.notificationConfig.notifyInstance
        } : null,
        stats
      }
    }
  })

  // ==================== 奖品管理 API ====================

  /**
   * 添加奖品
   */
  fastify.post<{
    Params: { id: string }
    Body: {
      name: string
      type: LotteryPrizeType
      value?: number
      probability: number
      totalQuantity?: number
      displayOrder?: number
      instanceDesc?: string
    }
  }>('/lotteries/:id/prizes', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      name: string
      type: LotteryPrizeType
      value?: number
      probability: number
      totalQuantity?: number
      displayOrder?: number
      instanceDesc?: string
    }
  }>, reply: FastifyReply) => {
    const lotteryId = Number(request.params.id)

    if (isNaN(lotteryId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid lottery ID' })
    }

    const lottery = await db.getLotteryById(lotteryId)
    if (!lottery) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Lottery not found' })
    }

    const { name, type, value, probability, totalQuantity, displayOrder, instanceDesc } = request.body
    const normalizedValue = type === 'badge' || type === 'nothing' ? 0 : value

    if (!name || typeof name !== 'string') {
      return reply.code(400).send({ error: 'NAME_REQUIRED', message: 'Prize name is required' })
    }

    if (probability < 0 || probability > 100) {
      return reply.code(400).send({ error: 'INVALID_PROBABILITY', message: 'Probability must be between 0 and 100' })
    }

    // 只有 balance 和 instance 类型可以设置总数量，points 和 nothing 类型不能设置数量
    if ((type === 'points' || type === 'nothing') && totalQuantity !== undefined && totalQuantity !== null) {
      return reply.code(400).send({ 
        error: 'INVALID_QUANTITY', 
        message: 'Points and nothing prizes cannot have quantity limits' 
      })
    }

    const prize = await db.createPrize({
      lotteryId,
      name: name.trim(),
      type,
      value: normalizedValue,
      probability,
      totalQuantity,
      displayOrder,
      instanceDesc: instanceDesc?.trim()
    })

    await createLog(
      request.user.id,
      'admin',
      'lottery.prize.create',
      `Added prize "${prize.name}" to lottery "${lottery.name}"`,
      'success'
    )

    return { success: true, prize: { id: prize.id, name: prize.name } }
  })

  /**
   * 更新奖品
   */
  fastify.put<{
    Params: { id: string }
    Body: {
      name?: string
      type?: LotteryPrizeType
      value?: number
      probability?: number
      totalQuantity?: number | null
      remainQuantity?: number | null
      displayOrder?: number
      instanceDesc?: string | null
    }
  }>('/prizes/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      name?: string
      type?: LotteryPrizeType
      value?: number
      probability?: number
      totalQuantity?: number | null
      remainQuantity?: number | null
      displayOrder?: number
      instanceDesc?: string | null
    }
  }>, reply: FastifyReply) => {
    const prizeId = Number(request.params.id)

    if (isNaN(prizeId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid prize ID' })
    }

    const existing = await db.getPrizeById(prizeId)
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Prize not found' })
    }

    const { name, type, value, probability, totalQuantity, remainQuantity, displayOrder, instanceDesc } = request.body

    if (probability !== undefined && (probability < 0 || probability > 100)) {
      return reply.code(400).send({ error: 'INVALID_PROBABILITY', message: 'Probability must be between 0 and 100' })
    }

    // 检查奖品类型与数量限制的匹配性
    const prizeType = type ?? existing.type
    const normalizedValue = prizeType === 'badge' || prizeType === 'nothing' ? 0 : value
    if ((prizeType === 'points' || prizeType === 'nothing') && 
        (totalQuantity !== undefined && totalQuantity !== null)) {
      return reply.code(400).send({ 
        error: 'INVALID_QUANTITY', 
        message: 'Points and nothing prizes cannot have quantity limits' 
      })
    }

    await db.updatePrize(prizeId, {
      name: name?.trim(),
      type,
      value: normalizedValue,
      probability,
      totalQuantity,
      remainQuantity,
      displayOrder,
      instanceDesc
    })

    await createLog(
      request.user.id,
      'admin',
      'lottery.prize.update',
      `Updated prize "${existing.name}" (ID: ${prizeId})`,
      'success'
    )

    return { success: true }
  })

  /**
   * 删除奖品
   */
  fastify.delete<{ Params: { id: string } }>('/prizes/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prizeId = Number(request.params.id)

    if (isNaN(prizeId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid prize ID' })
    }

    const existing = await db.getPrizeById(prizeId)
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Prize not found' })
    }

    await db.deletePrize(prizeId)

    await createLog(
      request.user.id,
      'admin',
      'lottery.prize.delete',
      `Deleted prize "${existing.name}" (ID: ${prizeId})`,
      'success'
    )

    return { success: true }
  })

  // ==================== 通知配置 API ====================

  /**
   * 更新抽奖通知配置
   */
  fastify.put<{
    Params: { id: string }
    Body: {
      enabled: boolean
      type: string
      config: Record<string, unknown>
      notifyBalance: boolean
      notifyInstance: boolean
    }
  }>('/lotteries/:id/notification', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      enabled: boolean
      type: string
      config: Record<string, unknown>
      notifyBalance: boolean
      notifyInstance: boolean
    }
  }>, reply: FastifyReply) => {
    const lotteryId = Number(request.params.id)

    if (isNaN(lotteryId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid lottery ID' })
    }

    const lottery = await db.getLotteryById(lotteryId)
    if (!lottery) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Lottery not found' })
    }

    const { enabled, type, config, notifyBalance, notifyInstance } = request.body

    if (!['telegram', 'discord', 'webhook'].includes(type)) {
      return reply.code(400).send({ error: 'INVALID_TYPE', message: 'Invalid notification type' })
    }

    await db.upsertLotteryNotificationConfig(lotteryId, {
      enabled,
      type,
      config,
      notifyBalance,
      notifyInstance
    })

    await createLog(
      request.user.id,
      'admin',
      'lottery.notification.update',
      `Updated notification config for lottery "${lottery.name}"`,
      'success'
    )

    return { success: true }
  })

  // ==================== 中奖记录管理 API ====================

  /**
   * 获取所有中奖记录
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      lotteryId?: string
      prizeType?: string
      status?: string
      search?: string
    }
  }>('/lottery-records', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      lotteryId?: string
      prizeType?: string
      status?: string
      search?: string
    }
  }>) => {
    const { page = '1', pageSize = '20', lotteryId, prizeType, status, search } = request.query

    const result = await db.getAllLotteryRecords({
      page: Number(page),
      pageSize: Number(pageSize),
      lotteryId: lotteryId ? Number(lotteryId) : undefined,
      prizeType: prizeType as LotteryPrizeType | undefined,
      status: status as LotteryRecordStatus | undefined,
      search
    })

    return {
      records: result.records.map(record => ({
        id: record.id,
        lotteryId: record.lotteryId,
        lotteryName: record.lottery.name,
        userId: record.userId,
        username: record.user.username,
        userAvatar: record.user.avatarStyle,
        prizeType: record.prizeType,
        prizeName: record.prizeName,
        prizeValue: record.prizeValue,
        instanceDesc: record.prize?.instanceDesc || null,
        status: record.status,
        pointsSpent: record.pointsSpent,
        deliveredAt: record.deliveredAt?.toISOString() || null,
        deliveredBy: record.deliveredBy,
        ticketId: record.ticketId,
        createdAt: record.createdAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  /**
   * 标记实例奖励为已发放
   */
  fastify.post<{
    Params: { id: string }
    Body: {
      ticketId?: number
    }
  }>('/lottery-records/:id/deliver', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { ticketId?: number }
  }>, reply: FastifyReply) => {
    const recordId = Number(request.params.id)

    if (isNaN(recordId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid record ID' })
    }

    const record = await db.prisma.lotteryRecord.findUnique({
      where: { id: recordId },
      include: { user: { select: { username: true } } }
    })

    if (!record) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Record not found' })
    }

    if (record.prizeType !== 'instance') {
      return reply.code(400).send({ error: 'NOT_INSTANCE_PRIZE', message: 'This is not an instance prize' })
    }

    if (record.status !== 'pending') {
      return reply.code(400).send({ error: 'ALREADY_DELIVERED', message: 'Prize has already been delivered' })
    }

    await db.updateLotteryRecordStatus(
      recordId,
      'delivered',
      request.user.id,
      request.body.ticketId
    )

    await createLog(
      request.user.id,
      'admin',
      'lottery.record.deliver',
      `Delivered instance prize to user "${record.user.username}" (Record ID: ${recordId})`,
      'success'
    )

    return { success: true }
  })

  // ==================== 用户积分管理 API ====================

  /**
   * 获取所有用户积分列表
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      orderBy?: string
      order?: string
    }
  }>('/user-points', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      orderBy?: string
      order?: string
    }
  }>) => {
    const { page = '1', pageSize = '20', search, orderBy = 'points', order = 'desc' } = request.query

    const result = await db.getAllUserPoints({
      page: Number(page),
      pageSize: Number(pageSize),
      search,
      orderBy: orderBy as 'points' | 'totalEarned' | 'totalSpent',
      order: order as 'asc' | 'desc'
    })

    return {
      records: result.records.map(record => ({
        userId: record.userId,
        username: record.user.username,
        userAvatar: record.user.avatarStyle,
        points: record.points,
        totalEarned: record.totalEarned,
        totalSpent: record.totalSpent,
        convertedConsume: Number(record.convertedConsume),
        lastConvertedAt: record.lastConvertedAt?.toISOString() || null,
        updatedAt: record.updatedAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  /**
   * 调整用户积分
   */
  fastify.post<{
    Params: { userId: string }
    Body: {
      amount: number
      remark: string
    }
  }>('/user-points/:userId/adjust', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { userId: string }
    Body: { amount: number; remark: string }
  }>, reply: FastifyReply) => {
    const userId = Number(request.params.userId)

    if (isNaN(userId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid user ID' })
    }

    const { amount, remark } = request.body

    if (!amount || amount === 0) {
      return reply.code(400).send({ error: 'INVALID_AMOUNT', message: 'Amount must be non-zero' })
    }

    if (!remark || typeof remark !== 'string' || remark.trim().length === 0) {
      return reply.code(400).send({ error: 'REMARK_REQUIRED', message: 'Remark is required' })
    }

    const user = await db.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true }
    })

    if (!user) {
      return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User not found' })
    }

    const result = await db.adminAdjustPoints(
      userId,
      amount,
      `[管理员${request.user.username}] ${remark.trim()}`
    )

    if (!result.success) {
      return reply.code(400).send({ error: 'ADJUST_FAILED', message: result.message })
    }

    await createLog(
      request.user.id,
      'admin',
      'lottery.points.adjust',
      `Adjusted user "${user.username}" points by ${amount} (New: ${result.newPoints}): ${remark}`,
      'success'
    )

    return { success: true, newPoints: result.newPoints }
  })

  /**
   * 获取用户积分详情
   */
  fastify.get<{ Params: { userId: string } }>('/user-points/:userId', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
    const userId = Number(request.params.userId)

    if (isNaN(userId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid user ID' })
    }

    const [userPoints, convertible, user] = await Promise.all([
      db.getUserPoints(userId),
      db.getConvertibleConsume(userId),
      db.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, avatarStyle: true }
      })
    ])

    if (!user) {
      return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User not found' })
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        avatarStyle: user.avatarStyle
      },
      points: userPoints.points,
      totalEarned: userPoints.totalEarned,
      totalSpent: userPoints.totalSpent,
      convertedConsume: Number(userPoints.convertedConsume),
      lastConvertedAt: userPoints.lastConvertedAt?.toISOString() || null,
      // 可兑换信息
      totalConsume: convertible.totalConsume,
      convertibleAmount: convertible.convertibleAmount,
      convertiblePoints: convertible.convertiblePoints
    }
  })

  /**
   * 获取用户积分日志
   */
  fastify.get<{
    Params: { userId: string }
    Querystring: { page?: string; pageSize?: string }
  }>('/user-points/:userId/logs', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { userId: string }
    Querystring: { page?: string; pageSize?: string }
  }>, reply: FastifyReply) => {
    const userId = Number(request.params.userId)

    if (isNaN(userId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid user ID' })
    }

    const { page = '1', pageSize = '20' } = request.query

    const result = await db.getPointsLogs(userId, {
      page: Number(page),
      pageSize: Number(pageSize)
    })

    return {
      logs: result.logs.map(log => ({
        id: log.id,
        type: log.type,
        amount: log.amount,
        pointsBefore: log.pointsBefore,
        pointsAfter: log.pointsAfter,
        remark: log.remark,
        createdAt: log.createdAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  // ==================== 徽章目录管理 API ====================

  fastify.get('/badges/catalog', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async () => db.getAdminBadgeCatalog())

  fastify.post<{
    Body: {
      id?: string
      title?: string
      nameZh?: string
      nameEn?: string | null
      description?: string
      sourceId?: string | null
      sourceLabel?: string | null
      displayOrder?: number
      isActive?: boolean
    }
  }>('/badges/series', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Body: {
      id?: string
      title?: string
      nameZh?: string
      nameEn?: string | null
      description?: string
      sourceId?: string | null
      sourceLabel?: string | null
      displayOrder?: number
      isActive?: boolean
    }
  }>, reply: FastifyReply) => {
    const id = requireText(request.body.id)
    const title = requireText(request.body.title)
    const nameZh = requireText(request.body.nameZh)
    const description = requireText(request.body.description)

    if (!id || !isValidCatalogId(id)) {
      return reply.code(400).send({ error: 'INVALID_SERIES_ID', message: 'Invalid series ID' })
    }
    if (!title || !nameZh || !description) {
      return reply.code(400).send({ error: 'INVALID_SERIES_DATA', message: 'Series title, Chinese name and description are required' })
    }

    try {
      const series = await db.createBadgeSeries({
        id,
        title,
        nameZh,
        nameEn: normalizeOptionalText(request.body.nameEn),
        description,
        sourceId: normalizeOptionalText(request.body.sourceId),
        sourceLabel: normalizeOptionalText(request.body.sourceLabel),
        displayOrder: Number(request.body.displayOrder ?? 0),
        isActive: request.body.isActive ?? true
      })

      await createLog(request.user.id, 'admin', 'badge.series.create', `Created badge series "${series.title}" (${series.id})`, 'success')
      return { success: true, series }
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'P2002') {
        return reply.code(409).send({ error: 'SERIES_ID_EXISTS', message: 'Series ID already exists' })
      }
      throw error
    }
  })

  fastify.put<{
    Params: { id: string }
    Body: {
      title?: string
      nameZh?: string
      nameEn?: string | null
      description?: string
      sourceId?: string | null
      sourceLabel?: string | null
      displayOrder?: number
      isActive?: boolean
    }
  }>('/badges/series/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      title?: string
      nameZh?: string
      nameEn?: string | null
      description?: string
      sourceId?: string | null
      sourceLabel?: string | null
      displayOrder?: number
      isActive?: boolean
    }
  }>, reply: FastifyReply) => {
    const data = {
      title: request.body.title === undefined ? undefined : requireText(request.body.title),
      nameZh: request.body.nameZh === undefined ? undefined : requireText(request.body.nameZh),
      nameEn: normalizeOptionalText(request.body.nameEn),
      description: request.body.description === undefined ? undefined : requireText(request.body.description),
      sourceId: normalizeOptionalText(request.body.sourceId),
      sourceLabel: normalizeOptionalText(request.body.sourceLabel),
      displayOrder: request.body.displayOrder,
      isActive: request.body.isActive
    }

    if (data.title === null || data.nameZh === null || data.description === null) {
      return reply.code(400).send({ error: 'INVALID_SERIES_DATA', message: 'Series title, Chinese name and description cannot be empty' })
    }

    try {
      await db.updateBadgeSeries(request.params.id, data as {
        title?: string
        nameZh?: string
        nameEn?: string | null
        description?: string
        sourceId?: string | null
        sourceLabel?: string | null
        displayOrder?: number
        isActive?: boolean
      })
      await createLog(request.user.id, 'admin', 'badge.series.update', `Updated badge series "${request.params.id}"`, 'success')
      return { success: true }
    } catch (error) {
      if ((error as { code?: string }).code === 'P2025') {
        return reply.code(404).send({ error: 'SERIES_NOT_FOUND', message: 'Series not found' })
      }
      throw error
    }
  })

  fastify.delete<{ Params: { id: string } }>('/badges/series/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      await db.deleteBadgeSeries(request.params.id)
      await createLog(request.user.id, 'admin', 'badge.series.delete', `Deleted badge series "${request.params.id}"`, 'success')
      return { success: true }
    } catch (error) {
      if (error instanceof Error && error.message === 'BADGE_SERIES_HAS_BADGES') {
        return reply.code(400).send({ error: 'BADGE_SERIES_HAS_BADGES', message: 'Series still has badges; disable it instead or move/delete badges first' })
      }
      if ((error as { code?: string }).code === 'P2025') {
        return reply.code(404).send({ error: 'SERIES_NOT_FOUND', message: 'Series not found' })
      }
      throw error
    }
  })

  fastify.post<{
    Body: {
      id?: string
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
    }
  }>('/badges', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Body: {
      id?: string
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
    }
  }>, reply: FastifyReply) => {
    const id = requireText(request.body.id)
    const name = requireText(request.body.name)
    const fullLabel = requireText(request.body.fullLabel)
    const seriesId = requireText(request.body.seriesId)
    const assetUrl = requireText(request.body.assetUrl)
    const assetUrlDark = normalizeOptionalText(request.body.assetUrlDark)
    const assetUrlLight = normalizeOptionalText(request.body.assetUrlLight)

    if (!id || !isValidCatalogId(id)) {
      return reply.code(400).send({ error: 'INVALID_BADGE_ID', message: 'Invalid badge ID' })
    }
    if (!name || !fullLabel || !seriesId || !assetUrl) {
      return reply.code(400).send({ error: 'INVALID_BADGE_DATA', message: 'Badge name, label, series and asset URL are required' })
    }
    if (![assetUrl, assetUrlDark, assetUrlLight].every(url => !url || isValidAssetUrl(url))) {
      return reply.code(400).send({ error: 'INVALID_ASSET_URL', message: 'Asset URL must be a local path or http(s) URL' })
    }

    try {
      const badge = await db.createBadge({
        id,
        name,
        nameEn: normalizeOptionalText(request.body.nameEn),
        fullLabel,
        seriesId,
        sourceId: normalizeOptionalText(request.body.sourceId),
        sourceLabel: normalizeOptionalText(request.body.sourceLabel),
        assetUrl,
        assetUrlDark,
        assetUrlLight,
        displayOrder: Number(request.body.displayOrder ?? 0),
        isActive: request.body.isActive ?? true
      })

      await createLog(request.user.id, 'admin', 'badge.create', `Created badge "${badge.name}" (${badge.id})`, 'success')
      return { success: true, badge }
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'P2002') {
        return reply.code(409).send({ error: 'BADGE_ID_EXISTS', message: 'Badge ID already exists' })
      }
      if (code === 'P2003') {
        return reply.code(400).send({ error: 'SERIES_NOT_FOUND', message: 'Series not found' })
      }
      throw error
    }
  })

  fastify.put<{
    Params: { id: string }
    Body: {
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
    }
  }>('/badges/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
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
    }
  }>, reply: FastifyReply) => {
    const assetUrl = request.body.assetUrl === undefined ? undefined : requireText(request.body.assetUrl)
    const assetUrlDark = normalizeOptionalText(request.body.assetUrlDark)
    const assetUrlLight = normalizeOptionalText(request.body.assetUrlLight)
    if (assetUrl === null) {
      return reply.code(400).send({ error: 'INVALID_ASSET_URL', message: 'Asset URL cannot be empty' })
    }
    if ([assetUrl, assetUrlDark, assetUrlLight].some(url => !!url && !isValidAssetUrl(url))) {
      return reply.code(400).send({ error: 'INVALID_ASSET_URL', message: 'Asset URL must be a local path or http(s) URL' })
    }

    const data = {
      name: request.body.name === undefined ? undefined : requireText(request.body.name),
      nameEn: normalizeOptionalText(request.body.nameEn),
      fullLabel: request.body.fullLabel === undefined ? undefined : requireText(request.body.fullLabel),
      seriesId: request.body.seriesId === undefined ? undefined : requireText(request.body.seriesId),
      sourceId: normalizeOptionalText(request.body.sourceId),
      sourceLabel: normalizeOptionalText(request.body.sourceLabel),
      assetUrl,
      assetUrlDark,
      assetUrlLight,
      displayOrder: request.body.displayOrder,
      isActive: request.body.isActive
    }

    if (data.name === null || data.fullLabel === null || data.seriesId === null) {
      return reply.code(400).send({ error: 'INVALID_BADGE_DATA', message: 'Badge name, label and series cannot be empty' })
    }

    try {
      await db.updateBadge(request.params.id, data as {
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
      })
      await createLog(request.user.id, 'admin', 'badge.update', `Updated badge "${request.params.id}"`, 'success')
      return { success: true }
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'P2025') {
        return reply.code(404).send({ error: 'BADGE_NOT_FOUND', message: 'Badge not found' })
      }
      if (code === 'P2003') {
        return reply.code(400).send({ error: 'SERIES_NOT_FOUND', message: 'Series not found' })
      }
      throw error
    }
  })

  fastify.delete<{ Params: { id: string } }>('/badges/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      await db.deleteBadge(request.params.id)
      await createLog(request.user.id, 'admin', 'badge.delete', `Deleted badge "${request.params.id}"`, 'success')
      return { success: true }
    } catch (error) {
      if (error instanceof Error && error.message === 'BADGE_IN_USE') {
        return reply.code(400).send({ error: 'BADGE_IN_USE', message: 'Badge is in use; disable it instead' })
      }
      if ((error as { code?: string }).code === 'P2025') {
        return reply.code(404).send({ error: 'BADGE_NOT_FOUND', message: 'Badge not found' })
      }
      throw error
    }
  })
}
