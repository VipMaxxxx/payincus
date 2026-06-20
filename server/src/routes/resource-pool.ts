/**
 * 资源池路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { getIncusClient } from '../lib/incus/index.js'
import { patchInstanceResources } from '../lib/incus/incus-instances.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { createLog } from '../db/logs.js'
import type { RedeemCodeType } from '@prisma/client'

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

    // 获取实例
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 检查实例所有权
    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查实例状态
    if (!['running', 'stopped'].includes(instance.status)) {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID))
    }

    // 获取宿主机信息（用于判断是否为 KVM）
    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // KVM 实例 CPU 必须整百
    if (resourceType === 'c' && host.instance_type === 'vm') {
      if (amount % 100 !== 0) {
        return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_KVM_CPU_MULTIPLE))
      }
    }

    // KVM 实例内存必须是 128MB 的倍数
    if (resourceType === 'r' && host.instance_type === 'vm') {
      if (amount % 128 !== 0) {
        return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_KVM_MEMORY_MULTIPLE))
      }
    }

    // KVM 实例硬盘必须是 1GB(1024MB) 的倍数
    if (resourceType === 'd' && host.instance_type === 'vm') {
      if (amount % 1024 !== 0) {
        return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_KVM_DISK_MULTIPLE))
      }
    }

    // KVM 实例内存/硬盘调整需要停止状态（热调整容易失败）
    if ((resourceType === 'r' || resourceType === 'd') && host.instance_type === 'vm') {
      if (instance.status !== 'stopped') {
        return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_VM_MUST_STOP))
      }
    }

    // 从资源池扣减资源
    const success = await db.deductFromResourcePool(
      user.id,
      resourceType as RedeemCodeType,
      amount,
      instanceId,
      `应用到实例 ${instance.name}`
    )

    if (!success) {
      return reply.code(400).send(apiError(ErrorCode.RESOURCE_POOL_INSUFFICIENT))
    }

    try {
      // 获取宿主机
      const host = await db.getHostById(instance.host_id)
      if (!host) {
        throw new Error('Host not found')
      }

      // 应用资源到实例
      if (resourceType === 'c') {
        // CPU
        const newCpu = instance.cpu + amount
        await db.updateHostResources(instance.host_id, { cpuUsed: host.cpu_used + amount })
        const client = await getIncusClient(host)
        await patchInstanceResources(client, instance.incus_id, { cpu: newCpu })
        await db.updateInstanceResources(instanceId, { cpu: newCpu })
      } else if (resourceType === 'r') {
        // 内存
        const newMemory = instance.memory + amount
        await db.updateHostResources(instance.host_id, { memoryUsed: host.memory_used + amount })
        const client = await getIncusClient(host)
        await patchInstanceResources(client, instance.incus_id, { memory: newMemory })
        await db.updateInstanceResources(instanceId, { memory: newMemory })
      } else if (resourceType === 'd') {
        // 硬盘
        const newDisk = instance.disk + amount
        await db.updateHostResources(instance.host_id, { diskUsed: host.disk_used + amount })
        const client = await getIncusClient(host)
        await patchInstanceResources(client, instance.incus_id, { disk: newDisk })
        await db.updateInstanceResources(instanceId, { disk: newDisk })
      } else if (resourceType === 't') {
        // 流量
        const trafficBytes = BigInt(amount) * BigInt(1024 * 1024 * 1024) // GB to Bytes
        const currentLimit = instance.monthly_traffic_limit ? BigInt(instance.monthly_traffic_limit) : BigInt(0)
        const newLimit = currentLimit + trafficBytes
        await db.updateInstanceResources(instanceId, { monthlyTrafficLimit: newLimit })
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await createLog(
        user.id,
        'resource_pool',
        'apply.failed',
        `Failed to apply resource to instance ${instance.name}: ${errorMessage}`,
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
      action: action as any,
      resourceType: resourceType as RedeemCodeType,
      limit: limit ? Number(limit) : 20,
      offset: offset ? Number(offset) : 0
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
