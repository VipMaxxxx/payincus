/**
 * 资源池路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { getIncusClient } from '../lib/incus/index.js'
import { getInstance, patchInstanceResources } from '../lib/incus/incus-instances.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { createLog } from '../db/logs.js'
import type { RedeemCodeType, ResourcePoolAction } from '@prisma/client'
import { acquireLock, releaseLock } from '../lib/distributed-lock.js'
import { calculateVipResourcePoolCost, getUserContinuousVipBenefit } from '../services/vip-benefits.js'

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
const RESOURCE_POOL_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000

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

async function reconcileResourcePoolApplies(fastify: FastifyInstance): Promise<void> {
  const candidates = await db.getResourcePoolApplyReconciliationCandidates()

  for (const candidate of candidates) {
    const lockKey = `instance:${candidate.instanceId}:resource-pool-apply`
    const lock = await acquireLock(lockKey, {
      expireMs: 120_000,
      waitTimeoutMs: 1_000,
      retryIntervalMs: 100
    })
    if (!lock.success || !lock.ownerId) continue

    try {
      const instance = await db.getInstanceById(candidate.instanceId)
      if (!instance || !['running', 'stopped'].includes(instance.status)) continue

      const host = await db.getHostById(instance.host_id)
      if (!host || !host.enable_resource_pool) continue

      const client = await getIncusClient(host)
      const incusInstance = await getInstance(client, instance.incus_id)
      const resources: { cpu?: number; memory?: number; disk?: number } = {}
      const reconciledTypes = new Set<RedeemCodeType>()

      if (candidate.resourceTypes.includes('c')) {
        reconciledTypes.add('c')
        if (incusInstance.config?.['limits.cpu.allowance'] !== `${instance.cpu}%`) {
          resources.cpu = instance.cpu
        }
      }

      const canReconcileStoppedOnlyResources = host.instance_type !== 'vm' || instance.status === 'stopped'
      if (canReconcileStoppedOnlyResources && candidate.resourceTypes.includes('r')) {
        reconciledTypes.add('r')
        if (incusInstance.config?.['limits.memory'] !== `${instance.memory}MB`) {
          resources.memory = instance.memory
        }
      }

      const rootDevice = incusInstance.devices?.root
      const incusDiskSize = rootDevice && typeof rootDevice === 'object'
        ? (rootDevice as Record<string, unknown>).size
        : undefined
      if (canReconcileStoppedOnlyResources && candidate.resourceTypes.includes('d')) {
        reconciledTypes.add('d')
        if (incusDiskSize !== `${instance.disk}MB`) {
          resources.disk = instance.disk
        }
      }

      if (Object.keys(resources).length > 0) {
        await patchInstanceResources(client, instance.incus_id, resources)
        fastify.log.info({ instanceId: instance.id, resources }, 'Reconciled resource-pool Incus configuration from DB state')
      }
      await db.markResourcePoolAppliesReconciled(
        candidate.pendingApplications
          .filter(application => reconciledTypes.has(application.resourceType))
          .map(application => application.id)
      )
    } catch (error) {
      fastify.log.warn({ err: error, instanceId: candidate.instanceId }, 'Resource-pool Incus reconciliation failed; will retry')
    } finally {
      await releaseLock(lockKey, lock.ownerId)
    }
  }
}

export default async function resourcePoolRoutes(fastify: FastifyInstance) {
  let reconciliationRunning = false
  const runReconciliation = async () => {
    if (reconciliationRunning) return
    reconciliationRunning = true
    try {
      await reconcileResourcePoolApplies(fastify)
    } catch (error) {
      fastify.log.warn({ err: error }, 'Resource-pool reconciliation scan failed; will retry')
    } finally {
      reconciliationRunning = false
    }
  }
  const reconciliationStartupTimer = setTimeout(() => void runReconciliation(), 10_000)
  const reconciliationTimer = setInterval(() => void runReconciliation(), RESOURCE_POOL_RECONCILIATION_INTERVAL_MS)
  reconciliationStartupTimer.unref()
  reconciliationTimer.unref()
  fastify.addHook('onClose', async () => {
    clearTimeout(reconciliationStartupTimer)
    clearInterval(reconciliationTimer)
  })

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
          amount: { type: 'integer', minimum: 1, maximum: db.MAX_RESOURCE_POOL_APPLY_AMOUNT }
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

        const vip = await getUserContinuousVipBenefit(user.id)
        const poolDebitAmount = calculateVipResourcePoolCost(amount, vip.benefit.resourcePoolBonusPercent)

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

        let resourcesToPatch: { cpu?: number; memory?: number; disk?: number } | null = null
        let applyLogId: number | null = null

        if (resourceType === 'c') {
          const newCpu = instance.cpu + amount
          applyLogId = await db.applyResourcePoolToInstance({
            userId: user.id,
            instanceId,
            hostId: instance.host_id,
            resourceType: resourceType as RedeemCodeType,
            amount,
            poolDebitAmount,
            remark: `应用到实例 ${instance.name}`,
            instanceResources: { cpu: newCpu },
            hostResourceDelta: { cpuUsed: amount }
          })
          if (applyLogId === null) {
            throw new Error('RESOURCE_POOL_INSUFFICIENT')
          }
          resourcesToPatch = { cpu: newCpu }
        } else if (resourceType === 'r') {
          const newMemory = instance.memory + amount
          applyLogId = await db.applyResourcePoolToInstance({
            userId: user.id,
            instanceId,
            hostId: instance.host_id,
            resourceType: resourceType as RedeemCodeType,
            amount,
            poolDebitAmount,
            remark: `应用到实例 ${instance.name}`,
            instanceResources: { memory: newMemory },
            hostResourceDelta: { memoryUsed: amount }
          })
          if (applyLogId === null) {
            throw new Error('RESOURCE_POOL_INSUFFICIENT')
          }
          resourcesToPatch = { memory: newMemory }
        } else if (resourceType === 'd') {
          const newDisk = instance.disk + amount
          applyLogId = await db.applyResourcePoolToInstance({
            userId: user.id,
            instanceId,
            hostId: instance.host_id,
            resourceType: resourceType as RedeemCodeType,
            amount,
            poolDebitAmount,
            remark: `应用到实例 ${instance.name}`,
            instanceResources: { disk: newDisk },
            hostResourceDelta: { diskUsed: amount }
          })
          if (applyLogId === null) {
            throw new Error('RESOURCE_POOL_INSUFFICIENT')
          }
          resourcesToPatch = { disk: newDisk }
        } else if (resourceType === 't') {
          const trafficBytes = BigInt(amount) * BigInt(1024 * 1024 * 1024)
          applyLogId = await db.applyResourcePoolToInstance({
            userId: user.id,
            instanceId,
            hostId: instance.host_id,
            resourceType: resourceType as RedeemCodeType,
            amount,
            poolDebitAmount,
            remark: `应用到实例 ${instance.name}`,
            monthlyTrafficDelta: trafficBytes
          })
          if (applyLogId === null) {
            throw new Error('RESOURCE_POOL_INSUFFICIENT')
          }
        }

        let reconciliationPending = false
        if (resourcesToPatch) {
          try {
            const client = await getIncusClient(host)
            await patchInstanceResources(client, instance.incus_id, resourcesToPatch)
            await db.markResourcePoolAppliesReconciled([applyLogId!])
          } catch (patchError) {
            reconciliationPending = true
            request.log.error({ err: patchError, instanceId }, 'Resource-pool DB apply committed but Incus patch confirmation failed; reconciliation will retry')
          }
        }

        const typeName = RESOURCE_TYPE_NAMES[resourceType]?.zh || resourceType
        const unit = RESOURCE_TYPE_UNITS[resourceType] || ''

        try {
          await createLog(
            user.id,
            'resource_pool',
            'apply.success',
            `Applied ${amount}${unit} ${typeName} to instance ${instance.name}`,
            'success',
            { instanceId }
          )
        } catch (logError) {
          request.log.warn({ err: logError, instanceId }, 'Resource-pool apply succeeded but audit log write failed')
        }

        return {
          message: 'Resource applied successfully',
          resourceType,
          amount: amount.toString(),
          poolDebitAmount: poolDebitAmount.toString(),
          vipResourcePoolBonusPercent: vip.benefit.resourcePoolBonusPercent,
          instanceId,
          instanceName: instance.name,
          reconciliationPending
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
      if (errorMessage === 'HOST_RESOURCES_INSUFFICIENT') {
        return reply.code(400).send(apiError(ErrorCode.HOST_RESOURCES_INSUFFICIENT, 'Host capacity is insufficient for this resource claim'))
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
