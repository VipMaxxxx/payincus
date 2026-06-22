/**
 * 签到系统路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getIncusClient } from '../lib/incus/index.js'
import { patchInstanceResources } from '../lib/incus/incus-instances.js'
import { acquireLock, releaseLock } from '../lib/distributed-lock.js'

// 资源类型名称映射
const CODE_TYPE_NAMES: Record<string, { zh: string; en: string }> = {
  c: { zh: 'CPU', en: 'CPU' },
  r: { zh: '内存', en: 'Memory' },
  d: { zh: '硬盘', en: 'Disk' },
  t: { zh: '流量', en: 'Traffic' },
  p: { zh: '积分', en: 'Points' }
}

// 资源单位映射
const CODE_TYPE_UNITS: Record<string, string> = {
  c: '%',
  r: 'MB',
  d: 'MB',
  t: 'GB',
  p: ''  // 积分无单位
}

function isDailyCheckinEnabled(): boolean {
  return false
}

async function withSystemRedeemLocks<T>(
  redeemCodeId: number,
  userId: number,
  batchId: string | null,
  fn: () => Promise<T>
): Promise<T> {
  const lockKeys = [
    `redeem-code:${redeemCodeId}`,
    ...(batchId ? [`redeem-batch:${batchId}:user:${userId}`] : [])
  ]
  const acquired: Array<{ lockKey: string; ownerId: string }> = []

  try {
    for (const lockKey of lockKeys) {
      const lock = await acquireLock(lockKey, {
        expireMs: 120_000,
        waitTimeoutMs: 10_000,
        retryIntervalMs: 100
      })
      if (!lock.success || !lock.ownerId) {
        throw new Error('REDEEM_CODE_BUSY')
      }
      acquired.push({ lockKey, ownerId: lock.ownerId })
    }

    return await fn()
  } finally {
    for (const lock of acquired.reverse()) {
      await releaseLock(lock.lockKey, lock.ownerId)
    }
  }
}

export default async function checkinRoutes(fastify: FastifyInstance) {
  // ==================== 获取签到状态 ====================
  fastify.get('/status', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { user } = request
    const status = await db.getCheckinStatus(user.id)
    return status
  })

  // ==================== 执行签到 ====================
  fastify.post('/checkin', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { user } = request

    if (!isDailyCheckinEnabled()) {
      await createLog(
        user.id,
        'checkin',
        'checkin.disabled',
        'Daily check-in is temporarily disabled',
        'failed'
      )
      return reply.code(403).send(apiError(ErrorCode.FEATURE_DISABLED, '签到功能暂时下线，后续改版后再开放'))
    }

    // 检查用户是否拥有实例
    const hasInstances = await db.userHasInstances(user.id)
    if (!hasInstances) {
      return reply.code(400).send(apiError(ErrorCode.CHECKIN_NO_INSTANCE))
    }

    // 检查今日是否已签到
    const hasCheckedIn = await db.hasCheckedInToday(user.id)
    if (hasCheckedIn) {
      return reply.code(400).send(apiError(ErrorCode.CHECKIN_ALREADY_TODAY))
    }

    try {
      // 执行签到，资源直接存入资源池
      const result = await db.performCheckin(user.id)

      // 发放签到积分奖励：有付费实例=500积分，无付费实例=100积分
      const hasPaid = await db.userHasPaidInstance(user.id)
      const bonusPoints = hasPaid ? 500 : 100
      await db.addPoints(user.id, bonusPoints, 'checkin', undefined, '签到奖励')

      // 记录日志
      const typeName = CODE_TYPE_NAMES[result.codeType]?.en || result.codeType
      const unit = CODE_TYPE_UNITS[result.codeType] || ''
      await createLog(
        user.id,
        'checkin',
        'checkin.success',
        `Daily check-in successful. ${typeName} +${result.codeValue}${unit} added to resource pool, bonus points: +${bonusPoints}`,
        'success'
      )

      return {
        message: 'Check-in successful',
        codeType: result.codeType,
        codeValue: result.codeValue,
        toResourcePool: true,
        bonusPoints
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage === 'CHECKIN_ALREADY_TODAY') {
        return reply.code(400).send(apiError(ErrorCode.CHECKIN_ALREADY_TODAY))
      }
      await createLog(
        user.id,
        'checkin',
        'checkin.failed',
        `Daily check-in failed: ${errorMessage}`,
        'failed'
      )
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, errorMessage))
    }
  })

  // ==================== 兑换兑换码 ====================
  // 仅支持系统码（h-前缀）：必须指定 instanceId，直接应用到实例
  fastify.post<{
    Body: {
      redeemCode: string
      instanceId: number
    }
  }>('/redeem', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['redeemCode', 'instanceId'],
        properties: {
          redeemCode: { type: 'string', minLength: 5, maxLength: 30 },
          instanceId: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { redeemCode: string; instanceId: number } }>, reply: FastifyReply) => {
    const { user } = request
    const { redeemCode, instanceId } = request.body
    const trimmedCode = redeemCode.trim()

    // 仅支持系统码（h-前缀）
    if (!db.isSystemCode(trimmedCode)) {
      return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_INVALID_FORMAT))
    }

    let codeType: string
    let codeValue: number

    // 获取系统兑换码记录
    const systemCodeRecord = await db.getRedeemCodeByCode(trimmedCode)
    if (!systemCodeRecord) {
      return reply.code(404).send(apiError(ErrorCode.REDEEM_CODE_NOT_FOUND))
    }

    // 检查兑换码是否启用
    if (!systemCodeRecord.enabled) {
      return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_DISABLED))
    }

    // 检查兑换码是否过期
    if (systemCodeRecord.expiresAt && systemCodeRecord.expiresAt < new Date()) {
      return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_EXPIRED))
    }

    // 检查兑换码是否已达到最大使用次数
    if (systemCodeRecord.usedCount >= systemCodeRecord.maxUses) {
      return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_EXHAUSTED))
    }

    // 检查用户是否已使用过该兑换码
    const hasUsed = await db.hasUserUsedCode(systemCodeRecord.id, user.id)
    if (hasUsed) {
      return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_ALREADY_USED_BY_USER))
    }

    // 检查用户是否已使用过同批次的其他兑换码
    if (systemCodeRecord.batchId) {
      const hasUsedBatch = await db.hasUserUsedBatch(systemCodeRecord.batchId, user.id)
      if (hasUsedBatch) {
        return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_BATCH_LIMIT))
      }
    }

    codeType = systemCodeRecord.codeType
    codeValue = systemCodeRecord.codeValue

    // 获取目标实例
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 检查实例是否属于当前用户
    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查实例状态
    if (instance.status !== 'running' && instance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID))
    }

    // 检查实例是否属于该宿主机
    if (instance.host_id !== systemCodeRecord.hostId) {
      return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_HOST_MISMATCH))
    }

    // 不再检查套餐上限，允许资源无限叠加

    let actualAdded = codeValue

    try {
      const response = await withSystemRedeemLocks(systemCodeRecord.id, user.id, systemCodeRecord.batchId, async () => {
        const currentCodeRecord = await db.getRedeemCodeByCode(trimmedCode)
        if (!currentCodeRecord) {
          throw new Error('REDEEM_CODE_NOT_FOUND')
        }
        if (!currentCodeRecord.enabled) {
          throw new Error('REDEEM_CODE_DISABLED')
        }
        if (currentCodeRecord.expiresAt && currentCodeRecord.expiresAt < new Date()) {
          throw new Error('REDEEM_CODE_EXPIRED')
        }
        if (currentCodeRecord.usedCount >= currentCodeRecord.maxUses) {
          throw new Error('REDEEM_CODE_EXHAUSTED')
        }
        if (await db.hasUserUsedCode(currentCodeRecord.id, user.id)) {
          throw new Error('REDEEM_CODE_ALREADY_USED_BY_USER')
        }
        if (currentCodeRecord.batchId && await db.hasUserUsedBatch(currentCodeRecord.batchId, user.id)) {
          throw new Error('REDEEM_CODE_BATCH_LIMIT')
        }

        const currentInstance = await db.getInstanceById(instanceId)
        if (!currentInstance) {
          throw new Error('INSTANCE_NOT_FOUND')
        }
        if (currentInstance.user_id !== user.id) {
          throw new Error('FORBIDDEN')
        }
        if (currentInstance.status !== 'running' && currentInstance.status !== 'stopped') {
          throw new Error('INSTANCE_STATUS_INVALID')
        }
        if (currentInstance.host_id !== currentCodeRecord.hostId) {
          throw new Error('REDEEM_CODE_HOST_MISMATCH')
        }

        codeType = currentCodeRecord.codeType
        codeValue = currentCodeRecord.codeValue
        actualAdded = codeValue
        if (!['c', 'r', 'd', 't'].includes(codeType)) {
          throw new Error('REDEEM_CODE_INVALID_FORMAT')
        }

        let patchedRollback: (() => Promise<void>) | null = null

        try {
          if (codeType === 'c') {
            const newCpu = currentInstance.cpu + codeValue
            const host = await db.getHostById(currentInstance.host_id)
            if (!host) {
              throw new Error('HOST_NOT_FOUND')
            }
            const client = await getIncusClient(host)
            await patchInstanceResources(client, currentInstance.incus_id, { cpu: newCpu })
            patchedRollback = async () => {
              await patchInstanceResources(client, currentInstance.incus_id, { cpu: currentInstance.cpu })
            }
            await db.applySystemRedeemCodeToInstance({
              redeemCodeId: currentCodeRecord.id,
              userId: user.id,
              instanceId,
              hostId: currentInstance.host_id,
              batchId: currentCodeRecord.batchId,
              instanceResources: { cpu: newCpu },
              hostResourceDelta: { cpuUsed: actualAdded }
            })
          } else if (codeType === 'r') {
            const newMemory = currentInstance.memory + codeValue
            const host = await db.getHostById(currentInstance.host_id)
            if (!host) {
              throw new Error('HOST_NOT_FOUND')
            }
            const client = await getIncusClient(host)
            await patchInstanceResources(client, currentInstance.incus_id, { memory: newMemory })
            patchedRollback = async () => {
              await patchInstanceResources(client, currentInstance.incus_id, { memory: currentInstance.memory })
            }
            await db.applySystemRedeemCodeToInstance({
              redeemCodeId: currentCodeRecord.id,
              userId: user.id,
              instanceId,
              hostId: currentInstance.host_id,
              batchId: currentCodeRecord.batchId,
              instanceResources: { memory: newMemory },
              hostResourceDelta: { memoryUsed: actualAdded }
            })
          } else if (codeType === 'd') {
            const newDisk = currentInstance.disk + codeValue
            const host = await db.getHostById(currentInstance.host_id)
            if (!host) {
              throw new Error('HOST_NOT_FOUND')
            }
            const client = await getIncusClient(host)
            await patchInstanceResources(client, currentInstance.incus_id, { disk: newDisk })
            patchedRollback = async () => {
              await patchInstanceResources(client, currentInstance.incus_id, { disk: currentInstance.disk })
            }
            await db.applySystemRedeemCodeToInstance({
              redeemCodeId: currentCodeRecord.id,
              userId: user.id,
              instanceId,
              hostId: currentInstance.host_id,
              batchId: currentCodeRecord.batchId,
              instanceResources: { disk: newDisk },
              hostResourceDelta: { diskUsed: actualAdded }
            })
          } else if (codeType === 't') {
            const trafficBytes = BigInt(codeValue) * BigInt(1024 * 1024 * 1024)
            await db.applySystemRedeemCodeToInstance({
              redeemCodeId: currentCodeRecord.id,
              userId: user.id,
              instanceId,
              hostId: currentInstance.host_id,
              batchId: currentCodeRecord.batchId,
              monthlyTrafficDelta: trafficBytes
            })
          }
        } catch (error) {
          if (patchedRollback) {
            try {
              await patchedRollback()
            } catch (rollbackError) {
              request.log.error({ err: rollbackError, instanceId }, 'Failed to roll back Incus resource patch after redeem DB failure')
            }
          }
          throw error
        }

        const typeName = CODE_TYPE_NAMES[codeType]?.en || codeType
        const unit = CODE_TYPE_UNITS[codeType] || ''
        await createLog(
          user.id,
          'checkin',
          'redeem.success',
          `Redeemed system code ${trimmedCode} for instance "${currentInstance.name}": ${typeName} +${actualAdded}${unit}`,
          'success',
          { instanceId }
        )

        // 记录到资源池日志（不加资源池，因为资源直接应用到实例）
        if (codeType !== 'p') {
          await db.logSystemRedeemToInstance(
            user.id,
            codeType as any,
            actualAdded,
            instanceId,
            `系统兑换码 ${trimmedCode} 应用到 ${currentInstance.name}`
          )
        }

        return {
          message: 'Redeem successful',
          codeType,
          codeValue,
          actualAdded,
          instanceId,
          instanceName: currentInstance.name,
          isSystemCode: true,
          toResourcePool: false
        }
      })

      return response
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage === 'REDEEM_CODE_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.REDEEM_CODE_NOT_FOUND))
      }
      if (errorMessage === 'REDEEM_CODE_DISABLED') {
        return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_DISABLED))
      }
      if (errorMessage === 'REDEEM_CODE_EXPIRED') {
        return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_EXPIRED))
      }
      if (errorMessage === 'REDEEM_CODE_INVALID_FORMAT') {
        return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_INVALID_FORMAT))
      }
      if (errorMessage === 'REDEEM_CODE_EXHAUSTED') {
        return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_EXHAUSTED))
      }
      if (errorMessage === 'REDEEM_CODE_ALREADY_USED_BY_USER') {
        return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_ALREADY_USED_BY_USER))
      }
      if (errorMessage === 'REDEEM_CODE_BATCH_LIMIT') {
        return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_BATCH_LIMIT))
      }
      if (errorMessage === 'REDEEM_CODE_BUSY') {
        return reply.code(409).send({
          error: 'REDEEM_CODE_BUSY',
          message: 'Redeem code is busy, please retry'
        })
      }
      if (errorMessage === 'INSTANCE_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }
      if (errorMessage === 'FORBIDDEN') {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }
      if (errorMessage === 'INSTANCE_STATUS_INVALID') {
        return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID))
      }
      if (errorMessage === 'REDEEM_CODE_HOST_MISMATCH') {
        return reply.code(400).send(apiError(ErrorCode.REDEEM_CODE_HOST_MISMATCH))
      }
      if (errorMessage === 'HOST_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
      }
      await createLog(user.id, 'checkin', 'redeem.failed', `Failed to redeem code ${trimmedCode}: ${errorMessage}`, 'failed', { instanceId })
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, errorMessage))
    }
  })

  // ==================== 获取用户可用实例列表 ====================
  fastify.get('/instances', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { user } = request
    const instances = await db.getUserInstancesForRedeem(user.id)
    return { instances }
  })

  // ==================== 获取签到记录 ====================
  fastify.get<{
    Querystring: {
      limit?: number
      offset?: number
    }
  }>('/records', {
    onRequest: [fastify.authenticateUser],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: { limit?: number; offset?: number } }>, _reply: FastifyReply) => {
    const { user } = request
    const { limit = 20, offset = 0 } = request.query
    const result = await db.getCheckinRecords(user.id, limit, offset)
    return result
  })

  // ==================== 获取兑换记录 ====================
  fastify.get<{
    Querystring: {
      limit?: number
      offset?: number
    }
  }>('/redeems', {
    onRequest: [fastify.authenticateUser],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: { limit?: number; offset?: number } }>, _reply: FastifyReply) => {
    const { user } = request
    const { limit = 20, offset = 0 } = request.query
    const result = await db.getRedeemRecords(user.id, limit, offset)
    return result
  })
}
