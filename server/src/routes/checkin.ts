/**
 * 签到系统路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getIncusClient } from '../lib/incus/index.js'
import { patchInstanceResources } from '../lib/incus/incus-instances.js'

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
      // 先执行原子操作确认可用
      await db.useSystemRedeemCode(systemCodeRecord.id, user.id, instanceId, systemCodeRecord.batchId)

      // 资源应用逻辑（不再截断到套餐上限）
      if (codeType === 'c') {
        const newCpu = instance.cpu + codeValue
        const host = await db.getHostById(instance.host_id)
        if (!host) {
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        }
        await db.updateHostResources(instance.host_id, { cpuUsed: host.cpu_used + actualAdded })
        const client = await getIncusClient(host)
        await patchInstanceResources(client, instance.incus_id, { cpu: newCpu })
        await db.updateInstanceResources(instanceId, { cpu: newCpu })
      } else if (codeType === 'r') {
        const newMemory = instance.memory + codeValue
        const host = await db.getHostById(instance.host_id)
        if (!host) {
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        }
        await db.updateHostResources(instance.host_id, { memoryUsed: host.memory_used + actualAdded })
        const client = await getIncusClient(host)
        await patchInstanceResources(client, instance.incus_id, { memory: newMemory })
        await db.updateInstanceResources(instanceId, { memory: newMemory })
      } else if (codeType === 'd') {
        const newDisk = instance.disk + codeValue
        const host = await db.getHostById(instance.host_id)
        if (!host) {
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        }
        await db.updateHostResources(instance.host_id, { diskUsed: host.disk_used + actualAdded })
        const client = await getIncusClient(host)
        await patchInstanceResources(client, instance.incus_id, { disk: newDisk })
        await db.updateInstanceResources(instanceId, { disk: newDisk })
      } else if (codeType === 't') {
        const trafficBytes = BigInt(codeValue) * BigInt(1024 * 1024 * 1024)
        const currentLimit = instance.monthly_traffic_limit ? BigInt(instance.monthly_traffic_limit) : BigInt(0)
        const newLimit = currentLimit + trafficBytes
        await db.updateInstanceResources(instanceId, { monthlyTrafficLimit: newLimit })
      } else if (codeType === 'p') {
        await db.addPoints(user.id, codeValue, 'checkin', undefined, '兑换码奖励')
      }

      const typeName = CODE_TYPE_NAMES[codeType]?.en || codeType
      const unit = CODE_TYPE_UNITS[codeType] || ''
      await createLog(
        user.id,
        'checkin',
        'redeem.success',
        `Redeemed system code ${trimmedCode} for instance "${instance.name}": ${typeName} +${actualAdded}${unit}`,
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
          `系统兑换码 ${trimmedCode} 应用到 ${instance.name}`
        )
      }

      return {
        message: 'Redeem successful',
        codeType,
        codeValue,
        actualAdded,
        instanceId,
        instanceName: instance.name,
        isSystemCode: true,
        toResourcePool: false
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
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
