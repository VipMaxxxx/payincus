/**
 * 娱乐系统 - 用户端 API
 * 积分兑换、抽奖等功能
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { sendLotteryWinNotification } from '../lib/lottery-notifier.js'
import type { BadgeOwnershipView } from '../db/badges.js'

export default async function entertainmentRoutes(fastify: FastifyInstance) {
  function sendBadgeError(reply: FastifyReply, error: unknown) {
    const code = error instanceof Error
      ? ((error as Error & { code?: string }).code === 'P2002' ? 'BADGE_STATE_CONFLICT' : error.message)
      : 'UNKNOWN_ERROR'
    const messageMap: Record<string, string> = {
      NO_BADGES_AVAILABLE: '暂无可用徽章',
      BADGE_NOT_FOUND: '徽章不存在',
      BADGE_OWNERSHIP_NOT_FOUND: '未找到该徽章副本',
      BADGE_ALREADY_APPLIED: '该徽章副本已应用到目标位置',
      BADGE_NOT_APPLIED: '该徽章当前未应用',
      AVATAR_BADGE_ALREADY_APPLIED: '头像徽章状态冲突，请刷新后重试',
      INSTANCE_NOT_FOUND: '实例不存在',
      INSTANCE_BADGE_ALREADY_APPLIED: '实例徽章状态冲突，请刷新后重试',
      BADGE_STATE_CONFLICT: '徽章状态已变化，请刷新后重试'
    }

    return reply.code(400).send({
      error: code,
      message: messageMap[code] || '徽章操作失败'
    })
  }

  // ==================== 积分相关 API ====================

  /**
   * 获取用户积分信息
   */
  fastify.get('/points', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const userId = request.user.id

    const [userPoints, convertible] = await Promise.all([
      db.getUserPoints(userId),
      db.getConvertibleConsume(userId)
    ])

    return {
      points: userPoints.points,
      totalEarned: userPoints.totalEarned,
      totalSpent: userPoints.totalSpent,
      lastConvertedAt: userPoints.lastConvertedAt?.toISOString() || null,
      // 可兑换信息
      totalConsume: convertible.totalConsume,
      convertedConsume: convertible.convertedConsume,
      convertibleAmount: convertible.convertibleAmount,
      convertiblePoints: convertible.convertiblePoints
    }
  })

  /**
   * 兑换积分
   */
  fastify.post('/points/convert', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user.id

    const result = await db.convertPointsFromConsumption(userId)

    if (!result.success) {
      return reply.code(400).send({
        error: 'NOTHING_TO_CONVERT',
        message: result.message
      })
    }

    return {
      success: true,
      converted: result.converted,
      newPoints: result.newPoints,
      consumeConverted: result.consumeConverted
    }
  })

  /**
   * 获取积分变动日志
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      type?: string
    }
  }>('/points/logs', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; type?: string } }>) => {
    const userId = request.user.id
    const { page = '1', pageSize = '20', type } = request.query

    const result = await db.getPointsLogs(userId, {
      page: Number(page),
      pageSize: Number(pageSize),
      type: type as any
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

  // ==================== 抽奖相关 API ====================

  /**
   * 获取可用抽奖列表
   */
  fastify.get('/lotteries', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const lotteries = await db.getActiveLotteries()

    return {
      lotteries: lotteries.map(lottery => ({
        id: lottery.id,
        name: lottery.name,
        description: lottery.description,
        costPoints: lottery.costPoints,
        startAt: lottery.startAt?.toISOString() || null,
        endAt: lottery.endAt?.toISOString() || null,
        totalDraws: lottery._count.records,  // 使用实时统计
        prizes: lottery.prizes.map(prize => ({
          id: prize.id,
          name: prize.name,
          type: prize.type,
          probability: Number(prize.probability),
          remainQuantity: prize.remainQuantity,
          totalQuantity: prize.totalQuantity,
          displayOrder: prize.displayOrder,
          instanceDesc: prize.instanceDesc
        }))
      }))
    }
  })

  /**
   * 获取抽奖详情
   */
  fastify.get<{ Params: { id: string } }>('/lotteries/:id', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const lotteryId = Number(request.params.id)

    if (isNaN(lotteryId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid lottery ID' })
    }

    const lottery = await db.getLotteryById(lotteryId)

    if (!lottery) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Lottery not found' })
    }

    if (!lottery.isActive) {
      return reply.code(400).send({ error: 'LOTTERY_INACTIVE', message: 'Lottery is not active' })
    }

    return {
      lottery: {
        id: lottery.id,
        name: lottery.name,
        description: lottery.description,
        costPoints: lottery.costPoints,
        startAt: lottery.startAt?.toISOString() || null,
        endAt: lottery.endAt?.toISOString() || null,
        totalDraws: lottery._count.records,  // 使用实时统计
        prizes: lottery.prizes.map(prize => ({
          id: prize.id,
          name: prize.name,
          type: prize.type,
          probability: Number(prize.probability),
          remainQuantity: prize.remainQuantity,
          totalQuantity: prize.totalQuantity,
          displayOrder: prize.displayOrder,
          instanceDesc: prize.instanceDesc
        }))
      }
    }
  })

  /**
   * 执行抽奖
   */
  fastify.post<{ Params: { id: string } }>('/lotteries/:id/draw', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = request.user.id
    const lotteryId = Number(request.params.id)

    if (isNaN(lotteryId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid lottery ID' })
    }

    // 执行抽奖（带重试机制，处理事务冲突/死锁）
    const maxRetries = 5
    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await db.performDraw(userId, lotteryId)

        if (!result.success) {
          return reply.code(400).send({
            error: 'DRAW_FAILED',
            message: result.message
          })
        }

        const record = result.record!
        const prize = result.prize!

        // 异步发送中奖通知（不阻塞响应）
        if (prize.type === 'balance' || prize.type === 'instance') {
          const lottery = await db.getLotteryById(lotteryId)
          setImmediate(() => {
            sendLotteryWinNotification({
              lotteryId,
              recordId: record.id,
              prizeType: prize.type as 'balance' | 'instance',
              username: request.user.username,
              lotteryName: lottery?.name || '',
              prizeName: prize.name,
              amount: prize.type === 'balance' ? prize.value : undefined,
              instanceDesc: prize.type === 'instance' ? (prize.instanceDesc || undefined) : undefined
            }).catch(err => {
              console.error('[Entertainment] Failed to send win notification:', err)
            })
          })
        }

        return {
          success: true,
          currentPoints: result.currentPoints,
          record: {
            id: record.id,
            prizeId: record.prizeId,  // 添加 prizeId 用于前端定位转盘位置
            prizeType: record.prizeType,
            prizeName: record.prizeName,
            prizeValue: record.prizeValue,
            badgeOwnership: prize.badgeOwnership,
            status: record.status,
            pointsSpent: record.pointsSpent,
            createdAt: record.createdAt.toISOString()
          },
          // 告知用户需要采取的操作
          action: prize.type === 'instance' ? 'SUBMIT_TICKET' : null,
          message: prize.type === 'nothing'
            ? '再接再厉！'
            : prize.type === 'instance'
              ? '恭喜中奖！请提交工单领取您的实例奖励。'
              : prize.type === 'badge'
                ? `恭喜获得徽章！${prize.name}`
              : `恭喜中奖！${prize.name}`
        }
      } catch (err: any) {
        lastError = err
        // 检查是否为事务冲突/死锁错误
        const isRetryable = err.code === 'P2034' || // Prisma 事务冲突
          err.message?.includes('deadlock') ||
          err.message?.includes('write conflict') ||
          err.message?.includes('could not serialize')
        
        if (isRetryable && attempt < maxRetries) {
          // 指数退避 + 随机抖动（50-300ms * attempt）
          const baseDelay = Math.floor(Math.random() * 250) + 50
          const delay = baseDelay * attempt
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
        if (err instanceof Error && err.message === 'NO_BADGES_AVAILABLE') {
          return sendBadgeError(reply, err)
        }
        throw err
      }
    }

    // 所有重试都失败
    throw lastError
  })

  /**
   * 十连抽
   * 串行执行 10 次抽奖，每次复用现有的 performDraw 逻辑
   */
  fastify.post<{ Params: { id: string } }>('/lotteries/:id/draw-multi', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = request.user.id
    const lotteryId = Number(request.params.id)
    const drawCount = 10  // 固定 10 连抽

    if (isNaN(lotteryId)) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Invalid lottery ID' })
    }

    // 1. 先检查抽奖活动是否有效，以及用户积分是否足够 10 次
    const lottery = await db.getLotteryById(lotteryId)
    if (!lottery) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Lottery not found' })
    }
    if (!lottery.isActive) {
      return reply.code(400).send({ error: 'LOTTERY_INACTIVE', message: 'Lottery is not active' })
    }
    const now = new Date()
    if (lottery.startAt && lottery.startAt > now) {
      return reply.code(400).send({ error: 'LOTTERY_NOT_STARTED', message: 'Lottery has not started' })
    }
    if (lottery.endAt && lottery.endAt < now) {
      return reply.code(400).send({ error: 'LOTTERY_ENDED', message: 'Lottery has ended' })
    }

    // 检查积分是否足够 10 次
    const userPoints = await db.getUserPoints(userId)
    const totalCost = lottery.costPoints * drawCount
    if (userPoints.points < totalCost) {
      return reply.code(400).send({ 
        error: 'INSUFFICIENT_POINTS', 
        message: `积分不足，需要 ${totalCost} 积分，当前仅有 ${userPoints.points} 积分`,
        required: totalCost,
        current: userPoints.points
      })
    }

    // 2. 串行执行 10 次抽奖（复用现有的并发安全机制）
    const results: Array<{
      id: number
      prizeId: number
      prizeType: string
      prizeName: string
      prizeValue: number
      badgeOwnership: BadgeOwnershipView | null
      status: string
      pointsSpent: number
      createdAt: string
    }> = []
    const maxRetries = 5

    for (let i = 0; i < drawCount; i++) {
      let lastError: Error | null = null
      let success = false

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await db.performDraw(userId, lotteryId)

          if (!result.success) {
            // 非事务冲突类错误（如积分不足），直接返回已有结果
            return {
              success: results.length > 0,
              records: results,
              totalDraws: results.length,
              stoppedAt: i + 1,
              stopReason: result.message
            }
          }

          const record = result.record!
          const prize = result.prize!

          results.push({
            id: record.id,
            prizeId: record.prizeId,
            prizeType: record.prizeType,
            prizeName: record.prizeName,
            prizeValue: record.prizeValue,
            badgeOwnership: prize.badgeOwnership,
            status: record.status,
            pointsSpent: record.pointsSpent,
            createdAt: record.createdAt.toISOString()
          })

          // 异步发送中奖通知（不阻塞）
          if (prize.type === 'balance' || prize.type === 'instance') {
            setImmediate(() => {
              sendLotteryWinNotification({
                lotteryId,
                recordId: record.id,
                prizeType: prize.type as 'balance' | 'instance',
                username: request.user.username,
                lotteryName: lottery?.name || '',
                prizeName: prize.name,
                amount: prize.type === 'balance' ? prize.value : undefined,
                instanceDesc: prize.type === 'instance' ? (prize.instanceDesc || undefined) : undefined
              }).catch(err => {
                console.error('[Entertainment] Failed to send win notification:', err)
              })
            })
          }

          success = true
          break
        } catch (err: any) {
          lastError = err
          if (err instanceof Error && err.message === 'NO_BADGES_AVAILABLE') {
            if (results.length === 0) {
              return sendBadgeError(reply, err)
            }
            return {
              success: true,
              records: results,
              totalDraws: results.length,
              stoppedAt: i + 1,
              stopReason: '暂无可用徽章'
            }
          }
          // 检查是否为事务冲突/死锁错误
          const isRetryable = err.code === 'P2034' ||
            err.message?.includes('deadlock') ||
            err.message?.includes('write conflict') ||
            err.message?.includes('could not serialize')
          
          if (isRetryable && attempt < maxRetries) {
            const baseDelay = Math.floor(Math.random() * 250) + 50
            const delay = baseDelay * attempt
            await new Promise(resolve => setTimeout(resolve, delay))
            continue
          }
          // 非可重试错误，返回已有结果
          return {
            success: results.length > 0,
            records: results,
            totalDraws: results.length,
            stoppedAt: i + 1,
            stopReason: lastError?.message || 'Unknown error'
          }
        }
      }

      if (!success) {
        // 所有重试都失败
        return {
          success: results.length > 0,
          records: results,
          totalDraws: results.length,
          stoppedAt: i + 1,
          stopReason: lastError?.message || 'Max retries exceeded'
        }
      }
    }

    // 3. 全部抽完，返回结果
    return {
      success: true,
      records: results,
      totalDraws: results.length,
      totalPointsSpent: lottery.costPoints * results.length
    }
  })

  /**
   * 获取用户中奖记录
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      prizeType?: string
    }
  }>('/lottery-records', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; prizeType?: string } }>) => {
    const userId = request.user.id
    const { page = '1', pageSize = '20', prizeType } = request.query

    const result = await db.getUserLotteryRecords(userId, {
      page: Number(page),
      pageSize: Number(pageSize),
      prizeType: prizeType || undefined
    })

    return {
      records: result.records.map(record => ({
        id: record.id,
        lotteryId: record.lotteryId,
        lotteryName: record.lottery.name,
        prizeType: record.prizeType,
        prizeName: record.prizeName,
        prizeValue: record.prizeValue,
        instanceDesc: record.prize?.instanceDesc || null,
        status: record.status,
        pointsSpent: record.pointsSpent,
        createdAt: record.createdAt.toISOString()
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  })

  // ==================== 徽章系统 API ====================

  fastify.get('/badges/catalog', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const [series, badges] = await Promise.all([
      db.getBadgeSeriesList(),
      db.getBadgeCatalog()
    ])

    return { series, badges }
  })

  fastify.get('/badges/overview', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    return db.getBadgeOverview(request.user.id)
  })

  fastify.post('/badges/draw/random', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await db.performRandomBadgeDraw(request.user.id)
      if (!result.success) {
        return reply.code(400).send({
          error: 'INSUFFICIENT_POINTS',
          message: '积分不足',
          currentPoints: result.points
        })
      }

      return {
        success: true,
        currentPoints: result.points,
        ownership: result.ownership
      }
    } catch (error) {
      return sendBadgeError(reply, error)
    }
  })

  fastify.post('/badges/draw/random-multi', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await db.performRandomBadgeMultiDraw(request.user.id, 10)
      if (!result.success) {
        return reply.code(400).send({
          error: 'INSUFFICIENT_POINTS',
          message: '积分不足',
          currentPoints: result.points
        })
      }

      return {
        success: true,
        currentPoints: result.points,
        ownerships: result.ownerships
      }
    } catch (error) {
      return sendBadgeError(reply, error)
    }
  })

  fastify.post<{ Body: { badgeId?: string } }>('/badges/draw/select', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['badgeId'],
        properties: {
          badgeId: { type: 'string', minLength: 1, maxLength: 64 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { badgeId?: string } }>, reply: FastifyReply) => {
    const badgeId = request.body.badgeId?.trim()
    if (!badgeId) {
      return reply.code(400).send({
        error: 'BADGE_ID_REQUIRED',
        message: 'badgeId is required'
      })
    }

    try {
      const result = await db.performSelectBadge(request.user.id, badgeId)
      if (!result.success) {
        return reply.code(400).send({
          error: 'INSUFFICIENT_POINTS',
          message: '积分不足',
          currentPoints: result.points
        })
      }

      return {
        success: true,
        currentPoints: result.points,
        ownership: result.ownership
      }
    } catch (error) {
      return sendBadgeError(reply, error)
    }
  })

  fastify.post<{ Body: { ownershipId?: number } }>('/badges/apply/avatar', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['ownershipId'],
        properties: {
          ownershipId: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { ownershipId?: number } }>, reply: FastifyReply) => {
    const ownershipId = Number(request.body.ownershipId)
    if (isNaN(ownershipId) || ownershipId <= 0) {
      return reply.code(400).send({
        error: 'INVALID_OWNERSHIP_ID',
        message: 'Invalid ownershipId'
      })
    }

    try {
      const ownership = await db.applyBadgeToAvatar(request.user.id, ownershipId)
      return {
        success: true,
        ownership
      }
    } catch (error) {
      return sendBadgeError(reply, error)
    }
  })

  fastify.post<{ Body: { ownershipId?: number; instanceId?: number } }>('/badges/apply/instance', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['ownershipId', 'instanceId'],
        properties: {
          ownershipId: { type: 'integer', minimum: 1 },
          instanceId: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { ownershipId?: number; instanceId?: number } }>, reply: FastifyReply) => {
    const ownershipId = Number(request.body.ownershipId)
    const instanceId = Number(request.body.instanceId)
    if (isNaN(ownershipId) || ownershipId <= 0 || isNaN(instanceId) || instanceId <= 0) {
      return reply.code(400).send({
        error: 'INVALID_PARAMS',
        message: 'Invalid ownershipId or instanceId'
      })
    }

    try {
      const ownership = await db.applyBadgeToInstance(request.user.id, ownershipId, instanceId)
      return {
        success: true,
        ownership
      }
    } catch (error) {
      return sendBadgeError(reply, error)
    }
  })

  fastify.post<{ Body: { ownershipId?: number } }>('/badges/unapply', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['ownershipId'],
        properties: {
          ownershipId: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { ownershipId?: number } }>, reply: FastifyReply) => {
    const ownershipId = Number(request.body.ownershipId)
    if (isNaN(ownershipId) || ownershipId <= 0) {
      return reply.code(400).send({
        error: 'INVALID_OWNERSHIP_ID',
        message: 'Invalid ownershipId'
      })
    }

    try {
      const ownership = await db.unapplyBadge(request.user.id, ownershipId)
      return {
        success: true,
        ownership
      }
    } catch (error) {
      return sendBadgeError(reply, error)
    }
  })
}
