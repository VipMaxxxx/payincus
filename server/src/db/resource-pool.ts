/**
 * 用户资源池数据库操作
 */

import { prisma } from './prisma.js'
import type { Prisma, RedeemCodeType, ResourcePoolAction } from '@prisma/client'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, USER_RESOURCE_POOL_LOCK_NAMESPACE, advisoryTransactionLock } from './advisory-locks.js'

// 资源类型到字段的映射
const RESOURCE_FIELD_MAP: Record<string, 'cpu' | 'memory' | 'disk' | 'traffic'> = {
  c: 'cpu',
  r: 'memory',
  d: 'disk',
  t: 'traffic'
}

export const MAX_RESOURCE_POOL_APPLY_AMOUNT = 104_857_600
export const RESOURCE_POOL_INCUS_PENDING_PREFIX = '[incus-pending] '

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
    cpu: pool.cpu.toString(),
    memory: pool.memory.toString(),
    disk: pool.disk.toString(),
    traffic: pool.traffic.toString()
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
  poolDebitAmount?: number
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
}): Promise<number | null> {
  if (!Number.isSafeInteger(data.amount) || data.amount <= 0 || data.amount > MAX_RESOURCE_POOL_APPLY_AMOUNT) {
    throw new Error('Invalid resource pool apply amount')
  }
  const poolDebitAmount = data.poolDebitAmount ?? data.amount
  if (!Number.isSafeInteger(poolDebitAmount) || poolDebitAmount <= 0 || poolDebitAmount > data.amount) {
    throw new Error('Invalid resource pool debit amount')
  }

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
        SET "cpu" = "cpu" - ${poolDebitAmount}
        WHERE "user_id" = ${data.userId}
          AND "cpu" >= ${poolDebitAmount}
      `
    } else if (field === 'memory') {
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "memory" = "memory" - ${poolDebitAmount}
        WHERE "user_id" = ${data.userId}
          AND "memory" >= ${poolDebitAmount}
      `
    } else if (field === 'disk') {
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "disk" = "disk" - ${poolDebitAmount}
        WHERE "user_id" = ${data.userId}
          AND "disk" >= ${poolDebitAmount}
      `
    } else {
      const amount = BigInt(poolDebitAmount)
      decrementResult = await tx.$executeRaw`
        UPDATE "user_resource_pools"
        SET "traffic" = "traffic" - ${amount}
        WHERE "user_id" = ${data.userId}
          AND "traffic" >= ${amount}
      `
    }

    if (decrementResult === 0) {
      return null
    }

    const applyLog = await tx.resourcePoolLog.create({
      data: {
        userId: data.userId,
        action: 'apply',
        resourceType: data.resourceType,
        amount: -poolDebitAmount,
        instanceId: data.instanceId,
        remark: data.resourceType === 't'
          ? data.remark
          : `${RESOURCE_POOL_INCUS_PENDING_PREFIX}${data.remark ?? ''}`
      }
    })

    if (data.hostResourceDelta) {
      const cpuDelta = data.hostResourceDelta.cpuUsed ?? 0
      const memoryDelta = data.hostResourceDelta.memoryUsed ?? 0
      const diskDelta = data.hostResourceDelta.diskUsed ?? 0
      if (cpuDelta < 0 || memoryDelta < 0 || diskDelta < 0) {
        throw new Error('Resource amounts must be non-negative')
      }

      const host = await tx.host.findUnique({
        where: { id: data.hostId },
        select: {
          cpuAllowanceMax: true,
          memoryMax: true,
          storageSize: true
        }
      })
      if (!host) {
        throw new Error('HOST_NOT_FOUND')
      }

      const cpuLimit = host.cpuAllowanceMax || 0
      const memoryLimit = host.memoryMax || 0
      const diskLimit = host.storageSize > 0 ? host.storageSize * 1024 : 0
      if (
        (cpuLimit > 0 && cpuDelta > cpuLimit) ||
        (memoryLimit > 0 && memoryDelta > memoryLimit) ||
        (diskLimit > 0 && diskDelta > diskLimit)
      ) {
        throw new Error('HOST_RESOURCES_INSUFFICIENT')
      }

      const applyWhere: Prisma.HostWhereInput = { id: data.hostId }
      if (cpuLimit > 0) {
        applyWhere.cpuUsed = { lte: cpuLimit - cpuDelta }
      }
      if (memoryLimit > 0) {
        applyWhere.memoryUsed = { lte: memoryLimit - memoryDelta }
      }
      if (diskLimit > 0) {
        applyWhere.diskUsed = { lte: diskLimit - diskDelta }
      }

      const hostUpdate = await tx.host.updateMany({
        where: applyWhere,
        data: {
          cpuUsed: { increment: cpuDelta },
          memoryUsed: { increment: memoryDelta },
          diskUsed: { increment: diskDelta }
        }
      })
      if (hostUpdate.count === 0) {
        throw new Error('HOST_RESOURCES_INSUFFICIENT')
      }
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

    return applyLog.id
  })
}

/**
 * 获取尚未确认 Incus patch 的申领，供 DB 期望状态幂等重放。
 */
export async function getResourcePoolApplyReconciliationCandidates(): Promise<Array<{
  instanceId: number
  resourceTypes: RedeemCodeType[]
  pendingApplications: Array<{ id: number; resourceType: RedeemCodeType }>
}>> {
  const appliedResources = await prisma.resourcePoolLog.findMany({
    where: {
      action: 'apply',
      instanceId: { not: null },
      remark: { startsWith: RESOURCE_POOL_INCUS_PENDING_PREFIX },
      instance: {
        status: { in: ['running', 'stopped'] }
      }
    },
    select: {
      id: true,
      instanceId: true,
      resourceType: true
    }
  })

  const grouped = new Map<number, Array<{ id: number; resourceType: RedeemCodeType }>>()
  for (const applied of appliedResources) {
    if (applied.instanceId === null) continue
    const pendingApplications = grouped.get(applied.instanceId) ?? []
    pendingApplications.push({ id: applied.id, resourceType: applied.resourceType })
    grouped.set(applied.instanceId, pendingApplications)
  }

  return Array.from(grouped, ([instanceId, pendingApplications]) => ({
    instanceId,
    resourceTypes: Array.from(new Set(pendingApplications.map(application => application.resourceType))),
    pendingApplications
  }))
}

/** 确认 Incus 已达到 DB 期望状态，并清除可重放标记。 */
export async function markResourcePoolAppliesReconciled(logIds: number[]): Promise<void> {
  if (logIds.length === 0) return

  const logs = await prisma.resourcePoolLog.findMany({
    where: {
      id: { in: logIds },
      action: 'apply',
      remark: { startsWith: RESOURCE_POOL_INCUS_PENDING_PREFIX }
    },
    select: { id: true, remark: true }
  })
  if (logs.length === 0) return

  await prisma.$transaction(logs.map(log => prisma.resourcePoolLog.update({
    where: { id: log.id },
    data: { remark: log.remark?.slice(RESOURCE_POOL_INCUS_PENDING_PREFIX.length) || null }
  })))
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
      amount: log.amount.toString(),
      instance: log.instance ? {
        id: log.instance.id,
        name: log.instance.name
      } : null,
      remark: log.remark?.startsWith(RESOURCE_POOL_INCUS_PENDING_PREFIX)
        ? log.remark.slice(RESOURCE_POOL_INCUS_PENDING_PREFIX.length)
        : log.remark,
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
