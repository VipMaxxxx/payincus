/**
 * 资源池路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { getIncusClient } from '../lib/incus/index.js'
import { patchInstanceResources } from '../lib/incus/incus-instances.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { createLog } from '../db/logs.js'
import type { RedeemCodeType, ResourcePoolAction } from '@prisma/client'
import { acquireLock, releaseLock } from '../lib/distributed-lock.js'

// 资源类型名称
const RESOURCE_TYPE_NAMES: Record<string, { zh: string; en: string }> = {
  c: { zh: 'CPU', en: 'CPU' },
  r: { zh: '内存', en: 'Memory' },
  d: { zh: '硬盘', en: 'Disk' },
  t: { zh: '流量', en: 'Traffic' }
}

// 资源类型单位
const RESOURCE_TYPE_UNITS: Record<string, string> = {
  c: '%',
  r: 'MB',
  d: 'MB',
  t: 'GB'
}

const POSITIVE_INTEGER_QUERY_PATTERN = /^[1-9]\d*$/
const NON_NEGATIVE_INTEGER_QUERY_PATTERN = /^(0|[1-9]\d*)$/
const RESOURCE_POOL_ACTIONS = new Set<ResourcePoolAction>([
  'checkin',
  'redeem',
  'admin_grant',
  'system_grant',
  'lottery',
  'apply',
  'system_redeem'
])
const RESOURCE_POOL_RESOURCE_TYPES = new Set<RedeemCodeType>(['c', 'r', 'd', 't'])

function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number {
  if (!value || !POSITIVE_INTEGER_QUERY_PATTERN.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.min(parsed, max) : fallback
}

function parseNonNegativeIntegerQuery(value: string | undefined, fallback: number): number {
  if (!value || !NON_NEGATIVE_INTEGER_QUERY_PATTERN.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function normalizeResourcePoolAction(value: string | undefined): ResourcePoolAction | undefined {
  return value && RESOURCE_POOL_ACTIONS.has(value as ResourcePoolAction)
    ? value as ResourcePoolAction
    : undefined
}

function normalizeResourcePoolType(value: string | undefined): RedeemCodeType | undefined {
  return value && RESOURCE_POOL_RESOURCE_TYPES.has(value as RedeemCodeType)
    ? value as RedeemCodeType
    : undefined
}

async function withResourcePoolApplyLocks<T>(
  userId: number,
  instanceId: number,
  resourceType: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockKeys = [
    `resource-pool:${userId}:${resourceType}`,
    `instance:${instanceId}:resource-pool-apply`
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
        throw new Error('RESOURCE_POOL_BUSY')
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

export default async function resourcePoolRoutes(fastify: FastifyInstance) {
  // ==================== 获取用户资源池 ====================
  fastify.get('/', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { user } = request
    const pool = await db.getUserResourcePool(user.id)
    return pool
  })

  // ==================== 应用资源到实例 ====================
  fastify.post<{
    Body: {
      instanceId: number
      resourceType: string
      amount: number
    }
  }>('/apply', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['instanceId', 'resourceType', 'amount'],
        properties: {
          instanceId: { type: 'integer', minimum: 1 },
          resourceType: { type: 'string', enum: ['c', 'r', 'd', 't'] },
          amount: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { instanceId: number; resourceType: string; amount: number } }>, reply: FastifyReply) => {
    const { user } = request
    const { instanceId, resourceType, amount } = request.body

    try {
      const response = await withResourcePoolApplyLocks(user.id, instanceId, resourceType, async () => {
        const instance = await db.getInstanceById(instanceId)
        if (!instance) {
          throw new Error('INSTANCE_NOT_FOUND')
        }

        if (instance.user_id !== user.id) {
          throw new Error('FORBIDDEN')
        }

        if (!['running', 'stopped'].includes(instance.status)) {
          throw new Error('INSTANCE_STATUS_INVALID')
        }

        const host = await db.getHostById(instance.host_id)
        if (!host) {
          throw new Error('HOST_NOT_FOUND')
        }

        if (!host.enable_resource_pool) {
          throw new Error('RESOURCE_POOL_DISABLED')
        }

        if (resourceType === 'c' && host.instance_type === 'vm' && amount % 100 !== 0) {
          throw new Error('RESOURCE_POOL_KVM_CPU_MULTIPLE')
        }

        if (resourceType === 'r' && host.instance_type === 'vm' && amount % 128 !== 0) {
          throw new Error('RESOURCE_POOL_KVM_MEMORY_MULTIPLE')
        }

        if (resourceType === 'd' && host.instance_type === 'vm' && amount % 1024 !== 0) {
          throw new Error('RESOURCE_POOL_KVM_DISK_MULTIPLE')
        }

        if ((resourceType === 'r' || resourceType === 'd') && host.instance_type === 'vm' && instance.status !== 'stopped') {
          throw new Error('RESOURCE_POOL_VM_MUST_STOP')
        }

        let patchedRollback: (() => Promise<void>) | null = null

        try {
          if (resourceType === 'c') {
            const newCpu = instance.cpu + amount
            const client = await getIncusClient(host)
            await patchInstanceResources(client, instance.incus_id, { cpu: newCpu })
            patchedRollback = async () => {
              await patchInstanceResources(client, instance.incus_id, { cpu: instance.cpu })
            }
            const applied = await db.applyResourcePoolToInstance({
              userId: user.id,
              instanceId,
              hostId: instance.host_id,
              resourceType: resourceType as RedeemCodeType,
              amount,
              remark: `应用到实例 ${instance.name}`,
              instanceResources: { cpu: newCpu },
              hostResourceDelta: { cpuUsed: amount }
            })
            if (!applied) {
              throw new Error('RESOURCE_POOL_INSUFFICIENT')
            }
          } else if (resourceType === 'r') {
            const newMemory = instance.memory + amount
            const client = await getIncusClient(host)
            await patchInstanceResources(client, instance.incus_id, { memory: newMemory })
            patchedRollback = async () => {
              await patchInstanceResources(client, instance.incus_id, { memory: instance.memory })
            }
            const applied = await db.applyResourcePoolToInstance({
              userId: user.id,
              instanceId,
              hostId: instance.host_id,
              resourceType: resourceType as RedeemCodeType,
              amount,
              remark: `应用到实例 ${instance.name}`,
              instanceResources: { memory: newMemory },
              hostResourceDelta: { memoryUsed: amount }
            })
            if (!applied) {
              throw new Error('RESOURCE_POOL_INSUFFICIENT')
            }
          } else if (resourceType === 'd') {
            const newDisk = instance.disk + amount
            const client = await getIncusClient(host)
            await patchInstanceResources(client, instance.incus_id, { disk: newDisk })
            patchedRollback = async () => {
              await patchInstanceResources(client, instance.incus_id, { disk: instance.disk })
            }
            const applied = await db.applyResourcePoolToInstance({
              userId: user.id,
              instanceId,
              hostId: instance.host_id,
              resourceType: resourceType as RedeemCodeType,
              amount,
              remark: `应用到实例 ${instance.name}`,
              instanceResources: { disk: newDisk },
              hostResourceDelta: { diskUsed: amount }
            })
            if (!applied) {
              throw new Error('RESOURCE_POOL_INSUFFICIENT')
            }
          } else if (resourceType === 't') {
            const trafficBytes = BigInt(amount) * BigInt(1024 * 1024 * 1024)
            const applied = await db.applyResourcePoolToInstance({
              userId: user.id,
              instanceId,
              hostId: instance.host_id,
              resourceType: resourceType as RedeemCodeType,
              amount,
              remark: `应用到实例 ${instance.name}`,
              monthlyTrafficDelta: trafficBytes
            })
            if (!applied) {
              throw new Error('RESOURCE_POOL_INSUFFICIENT')
            }
          }
        } catch (error) {
          if (patchedRollback) {
            try {
              await patchedRollback()
            } catch (rollbackError) {
              request.log.error({ err: rollbackError, instanceId }, 'Failed to roll back Incus resource patch after resource-pool DB failure')
            }
          }
          throw error
        }

        const typeName = RESOURCE_TYPE_NAMES[resourceType]?.zh || resourceType
        const unit = RESOURCE_TYPE_UNITS[resourceType] || ''

        await createLog(
          user.id,
          'resource_pool',
          'apply.success',
          `Applied ${amount}${unit} ${typeName} to instance ${instance.name}`,
          'success',
          { instanceId }
        )

        return {
          message: 'Resource applied successfully',
          resourceType,
          amount,
          instanceId,
          instanceName: instance.name
        }
      })

      return response
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage === 'INSTANCE_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
      }
      if (errorMessage === 'FORBIDDEN') {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }
      if (errorMessage === 'INSTANCE_STATUS_INVALID') {
        return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID))
      }
      if (errorMessage === 'HOST_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
      }
      if (errorMessage === 'RESOURCE_POOL_DISABLED') {
        return reply.code(403).send(apiError(ErrorCode.FEATURE_DISABLED, '该节点未开启资源池玩法'))
      }
      if (errorMessage === 'RESOURCE_POOL_KVM_CPU_MULTIPLE') {
        return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_KVM_CPU_MULTIPLE))
      }
      if (errorMessage === 'RESOURCE_POOL_KVM_MEMORY_MULTIPLE') {
        return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_KVM_MEMORY_MULTIPLE))
      }
      if (errorMessage === 'RESOURCE_POOL_KVM_DISK_MULTIPLE') {
        return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_KVM_DISK_MULTIPLE))
      }
      if (errorMessage === 'RESOURCE_POOL_VM_MUST_STOP') {
        return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_VM_MUST_STOP))
      }
      if (errorMessage === 'RESOURCE_POOL_INSUFFICIENT') {
        return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_INSUFFICIENT))
      }
      if (errorMessage === 'RESOURCE_POOL_BUSY') {
        return reply.code(409).send({ error: 'RESOURCE_POOL_BUSY', message: 'Resource pool apply is busy, please retry' })
      }
      await createLog(
        user.id,
        'resource_pool',
        'apply.failed',
        `Failed to apply resource to instance ${instanceId}: ${errorMessage}`,
        'failed',
        { instanceId }
      )
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, errorMessage))
    }
  })

  // ==================== 获取资源池变动记录 ====================
  fastify.get<{
    Querystring: {
      action?: string
      resourceType?: string
      limit?: string
      offset?: string
    }
  }>('/logs', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Querystring: { action?: string; resourceType?: string; limit?: string; offset?: string } }>, _reply: FastifyReply) => {
    const { user } = request
    const { action, resourceType, limit, offset } = request.query

    const logs = await db.getResourcePoolLogs(user.id, {
      action: normalizeResourcePoolAction(action),
      resourceType: normalizeResourcePoolType(resourceType),
      limit: parseClampedPositiveIntegerQuery(limit, 20, 100),
      offset: parseNonNegativeIntegerQuery(offset, 0)
    })

    return logs
  })

  // ==================== 获取用户可应用资源的实例列表 ====================
  fastify.get('/instances', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { user } = request
    
    // 获取用户所有可用实例（包括免费和付费）
    const instances = await db.getUserAllInstances(user.id)
    
    return {
      instances: instances.map(inst => ({
        id: inst.id,
        name: inst.name,
        status: inst.status,
        cpu: inst.cpu,
        memory: inst.memory,
        disk: inst.disk,
        monthlyTrafficLimit: inst.monthlyTrafficLimit?.toString() ?? null,
        isPaid: inst.packagePlanId !== null,
        instanceType: inst.host.instanceType, // 'vm' | 'container'
        host: {
          id: inst.host.id,
          name: inst.host.name,
          location: inst.host.location,
          countryCode: inst.host.countryCode
        }
      }))
    }
  })
}
