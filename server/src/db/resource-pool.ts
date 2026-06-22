/**
 * 用户资源池数据库操作
 */

import { prisma } from './prisma.js'
import type { RedeemCodeType, ResourcePoolAction } from '@prisma/client'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, USER_RESOURCE_POOL_LOCK_NAMESPACE, advisoryTransactionLock } from './advisory-locks.js'

// 资源类型到字段的映射
const RESOURCE_FIELD_MAP: Record<string, 'cpu' | 'memory' | 'disk' | 'traffic'> = {
  c: 'cpu',
  r: 'memory',
  d: 'disk',
  t: 'traffic'
}

/**
 * 获取用户资源池
 */
export async function getUserResourcePool(userId: number) {
  // 使用 upsert 避免并发时的 unique constraint 错误
  const pool = await prisma.userResourcePool.upsert({
    where: { userId },
    update: {},  // 已存在时不更新
    create: { userId }
  })

  return {
    cpu: pool.cpu,
    memory: pool.memory,
    disk: pool.disk,
    traffic: Number(pool.traffic)
  }
}

/**
 * 添加资源到资源池
 */
export async function addToResourcePool(
  userId: number,
  resourceType: RedeemCodeType,
  amount: number,
  action: ResourcePoolAction,
  remark?: string
): Promise<void> {
  const field = RESOURCE_FIELD_MAP[resourceType]
  if (!field) {
    throw new Error(`Invalid resource type: ${resourceType}`)
  }

  await prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, userId)

    // 更新资源池
    await tx.userResourcePool.upsert({
      where: { userId },
      update: {
        [field]: field === 'traffic'
          ? { increment: BigInt(amount) }
          : { increment: amount }
      },
      create: {
        userId,
        [field]: field === 'traffic' ? BigInt(amount) : amount
      }
    })

    // 记录日志
    await tx.resourcePoolLog.create({
      data: {
        userId,
        action,
        resourceType,
        amount,
        remark
      }
    })
  })
}

/**
 * 从资源池扣减资源（应用到实例前的检查和扣减）
 */
export async function deductFromResourcePool(
  userId: number,
  resourceType: RedeemCodeType,
  amount: number,
  instanceId: number,
  remark?: string
): Promise<boolean> {
  const field = RESOURCE_FIELD_MAP[resourceType]
  if (!field) {
    throw new Error(`Invalid resource type: ${resourceType}`)
  }

  return prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, userId)

    let decrementResult = 0
    if (field === 'cpu') {
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "cpu" = "cpu" - ${amount}
        WHERE "user_id" = ${userId}
          AND "cpu" >= ${amount}
      `
    } else if (field === 'memory') {
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "memory" = "memory" - ${amount}
        WHERE "user_id" = ${userId}
          AND "memory" >= ${amount}
      `
    } else if (field === 'disk') {
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "disk" = "disk" - ${amount}
        WHERE "user_id" = ${userId}
          AND "disk" >= ${amount}
      `
    } else {
      const trafficAmount = BigInt(amount)
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "traffic" = "traffic" - ${trafficAmount}
        WHERE "user_id" = ${userId}
          AND "traffic" >= ${trafficAmount}
      `
    }

    if (decrementResult === 0) {
      return false
    }

    await tx.resourcePoolLog.create({
      data: {
        userId,
        action: 'apply',
        resourceType,
        amount: -amount, // 负数表示消耗
        instanceId,
        remark
      }
    })

    return true
  })
}

export async function applyResourcePoolToInstance(data: {
  userId: number
  instanceId: number
  hostId: number
  resourceType: RedeemCodeType
  amount: number
  remark?: string
  instanceResources?: {
    cpu?: number
    memory?: number
    disk?: number
  }
  hostResourceDelta?: {
    cpuUsed?: number
    memoryUsed?: number
    diskUsed?: number
  }
  monthlyTrafficDelta?: bigint
}): Promise<boolean> {
  const field = RESOURCE_FIELD_MAP[data.resourceType]
  if (!field) {
    throw new Error(`Invalid resource type: ${data.resourceType}`)
  }

  return prisma.$transaction(async (tx) => {
    await advisoryTransactionLock(tx, USER_RESOURCE_POOL_LOCK_NAMESPACE, data.userId)
    await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, data.instanceId)

    let decrementResult = 0
    if (field === 'cpu') {
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "cpu" = "cpu" - ${data.amount}
        WHERE "user_id" = ${data.userId}
          AND "cpu" >= ${data.amount}
      `
    } else if (field === 'memory') {
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "memory" = "memory" - ${data.amount}
        WHERE "user_id" = ${data.userId}
          AND "memory" >= ${data.amount}
      `
    } else if (field === 'disk') {
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "disk" = "disk" - ${data.amount}
        WHERE "user_id" = ${data.userId}
          AND "disk" >= ${data.amount}
      `
    } else {
      const amount = BigInt(data.amount)
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "traffic" = "traffic" - ${amount}
        WHERE "user_id" = ${data.userId}
          AND "traffic" >= ${amount}
      `
    }

    if (decrementResult === 0) {
      return false
    }

    await tx.resourcePoolLog.create({
      data: {
        userId: data.userId,
        action: 'apply',
        resourceType: data.resourceType,
        amount: -data.amount,
        instanceId: data.instanceId,
        remark: data.remark
      }
    })

    if (data.hostResourceDelta) {
      await tx.host.update({
        where: { id: data.hostId },
        data: {
          ...(data.hostResourceDelta.cpuUsed !== undefined ? { cpuUsed: { increment: data.hostResourceDelta.cpuUsed } } : {}),
          ...(data.hostResourceDelta.memoryUsed !== undefined ? { memoryUsed: { increment: data.hostResourceDelta.memoryUsed } } : {}),
          ...(data.hostResourceDelta.diskUsed !== undefined ? { diskUsed: { increment: data.hostResourceDelta.diskUsed } } : {})
        }
      })
    }

    if (data.instanceResources) {
      await tx.instance.update({
        where: { id: data.instanceId },
        data: data.instanceResources
      })
    }

    if (data.monthlyTrafficDelta !== undefined) {
      await tx.$executeRaw`
        UPDATE "instances"
        SET "monthly_traffic_limit" = COALESCE("monthly_traffic_limit", 0) + ${data.monthlyTrafficDelta}
        WHERE "id" = ${data.instanceId}
      `
    }

    return true
  })
}

/**
 * 获取资源池变动记录
 */
export async function getResourcePoolLogs(
  userId: number,
  options: {
    action?: ResourcePoolAction
    resourceType?: RedeemCodeType
    limit?: number
    offset?: number
  } = {}
) {
  const { action, resourceType, limit = 20, offset = 0 } = options

  const where = {
    userId,
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {})
  }

  const [logs, total] = await Promise.all([
    prisma.resourcePoolLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        instance: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    prisma.resourcePoolLog.count({ where })
  ])

  return {
    records: logs.map(log => ({
      id: log.id,
      action: log.action,
      resourceType: log.resourceType,
      amount: log.amount,
      instance: log.instance ? {
        id: log.instance.id,
        name: log.instance.name
      } : null,
      remark: log.remark,
      createdAt: log.createdAt.toISOString()
    })),
    total
  }
}

/**
 * 管理员为用户添加资源
 */
export async function adminGrantResource(
  userId: number,
  resourceType: RedeemCodeType,
  amount: number,
  remark?: string
): Promise<void> {
  await addToResourcePool(userId, resourceType, amount, 'admin_grant', remark)
}

/**
 * 系统活动奖励资源
 */
export async function systemGrantResource(
  userId: number,
  resourceType: RedeemCodeType,
  amount: number,
  remark?: string
): Promise<void> {
  await addToResourcePool(userId, resourceType, amount, 'system_grant', remark)
}

/**
 * 抽奖获得资源
 */
export async function lotteryGrantResource(
  userId: number,
  resourceType: RedeemCodeType,
  amount: number,
  remark?: string
): Promise<void> {
  await addToResourcePool(userId, resourceType, amount, 'lottery', remark)
}

/**
 * 记录系统 h- 兑换码兑换到资源池日志（仅记录，不加资源池，因为资源直接应用到实例）
 */
export async function logSystemRedeemToInstance(
  userId: number,
  resourceType: RedeemCodeType,
  amount: number,
  instanceId: number,
  remark?: string
): Promise<void> {
  await prisma.resourcePoolLog.create({
    data: {
      userId,
      action: 'system_redeem',
      resourceType,
      amount,
      instanceId,
      remark
    }
  })
}

/**
 * 获取用户所有可用实例（用于资源池应用，包括免费和付费实例）
 * 仅返回开启资源池玩法的节点上的实例
 */
export async function getUserAllInstances(userId: number) {
  const instances = await prisma.instance.findMany({
    where: {
      userId,
      status: { in: ['running', 'stopped'] },
      host: {
        enableResourcePool: true  // 仅返回开启资源池的节点上的实例
      }
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          location: true,
          countryCode: true,
          instanceType: true
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
    monthlyTrafficLimit: inst.monthlyTrafficLimit,
    packagePlanId: inst.packagePlanId,
    host: inst.host
  }))
}
