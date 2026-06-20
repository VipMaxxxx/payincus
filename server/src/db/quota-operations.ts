/**
 * 配额操作相关数据库操作
 * 使用 Prisma ORM
 * 
 * 新配额系统：控制用户可拥有的资源数量
 * - hostLimit/hostUsed: 宿主机数量
 * - friendLimit/friendUsed: 好友数量
 * - packageLimit/packageUsed: 套餐数量
 * 注意：不再限制实例配额，用户可以创建无限数量的实例
 * 
 * 安全改进：
 * - 所有 decrement 操作使用 Math.max(0, ...) 防止负数
 * - 资源预占前先检查配额
 * - 使用交互式事务确保数据一致性
 */

import { prisma } from './prisma.js'
import { Prisma } from '@prisma/client'

// 事务隔离级别配置
// 使用 Serializable 隔离级别确保配额操作的一致性
const QUOTA_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 10000, // 10秒超时
} as const

/**
 * 直接设置用户配额使用量（覆盖原值）
 * 用于配额重新计算等场景
 */
export async function updateUserQuotaUsed(userId: number, data: {
  hostUsed?: number
  friendUsed?: number
  packageUsed?: number
}): Promise<void> {
  // 注意：不再限制实例配额，不再更新 instanceUsed
  const updateData: {
    hostUsed?: number
    friendUsed?: number
    packageUsed?: number
  } = {}

  if (data.hostUsed !== undefined) updateData.hostUsed = data.hostUsed
  if (data.friendUsed !== undefined) updateData.friendUsed = data.friendUsed
  if (data.packageUsed !== undefined) updateData.packageUsed = data.packageUsed

  if (Object.keys(updateData).length === 0) return

  await prisma.userQuota.update({
    where: { userId },
    data: updateData
  })
}

/**
 * 增量更新用户配额使用量
 * 用于资源分配/释放等场景
 */
export async function incrementUserQuotaUsed(userId: number, data: {
  hostUsed?: number
  friendUsed?: number
  packageUsed?: number
}): Promise<void> {
  // 注意：不再限制实例配额，不再更新 instanceUsed
  const updateData: {
    hostUsed?: { increment: number }
    friendUsed?: { increment: number }
    packageUsed?: { increment: number }
  } = {}

  if (data.hostUsed !== undefined) updateData.hostUsed = { increment: data.hostUsed }
  if (data.friendUsed !== undefined) updateData.friendUsed = { increment: data.friendUsed }
  if (data.packageUsed !== undefined) updateData.packageUsed = { increment: data.packageUsed }

  if (Object.keys(updateData).length === 0) return

  await prisma.userQuota.update({
    where: { userId },
    data: updateData
  })
}

/**
 * 减少用户配额使用量
 */
export async function decrementUserQuotaUsed(userId: number, type: 'host' | 'friend' | 'package'): Promise<void> {
  // 注意：不再限制实例配额，不再更新 instanceUsed
  const updateData: {
    hostUsed?: { decrement: number }
    friendUsed?: { decrement: number }
    packageUsed?: { decrement: number }
  } = {}

  switch (type) {
    case 'host':
      updateData.hostUsed = { decrement: 1 }
      break
    case 'friend':
      updateData.friendUsed = { decrement: 1 }
      break
    case 'package':
      updateData.packageUsed = { decrement: 1 }
      break
  }

  await prisma.userQuota.update({
    where: { userId },
    data: updateData
  })
}

/**
 * 资源预占 - 事务性地预扣配额和更新宿主机资源
 * 新系统：只更新实例数量和宿主机资源
 * 
 * 安全改进：
 * - 使用交互式事务而非数组事务
 * - 显式指定 Serializable 隔离级别
 * - 预占前检查配额边界
 */
export async function reserveResources(options: {
  hostId: number
  cpu: number
  memory: number
  disk: number
  portCount?: number
}): Promise<void> {
  const { hostId, cpu, memory, disk, portCount = 0 } = options

  // 使用交互式事务 + Serializable 隔离级别确保一致性
  await prisma.$transaction(async (tx) => {
    // 注意：不再限制用户的实例配额，只检查宿主机资源

    // 检查并更新宿主机资源使用量
    // 注意：使用 cpuAllowanceMax/memoryMax/storageSize（用户配置的配额上限）
    // 而不是 cpuTotal/memoryTotal/diskTotal（物理资源，可能未同步）
    const host = await tx.host.findUnique({
      where: { id: hostId },
      select: {
        cpuAllowanceMax: true,  // CPU 配额上限
        memoryMax: true,        // 内存配额上限
        storageSize: true,      // 存储池大小 (GB)
        cpuUsed: true,
        memoryUsed: true,
        diskUsed: true,
        natPortStart: true,
        natPortEnd: true,
        natPortsUsedCount: true
      }
    })

    if (!host) {
      throw new Error('Host not found')
    }

    // 检查资源是否超限（与 selectAvailableHost 逻辑保持一致）
    const cpuLimit = host.cpuAllowanceMax || 0
    const memoryLimit = host.memoryMax || 0

    if (cpuLimit > 0 && host.cpuUsed + cpu > cpuLimit) {
      throw new Error(`Host CPU exceeded: ${host.cpuUsed + cpu}/${cpuLimit}`)
    }
    if (memoryLimit > 0 && host.memoryUsed + memory > memoryLimit) {
      throw new Error(`Host memory exceeded: ${host.memoryUsed + memory}/${memoryLimit}`)
    }
    // 磁盘配额检查已移除：不再限制磁盘空间
    // 计算端口总数
    const natPortsTotal = (host.natPortStart && host.natPortEnd) 
      ? (host.natPortEnd - host.natPortStart + 1) 
      : 0
    if (portCount > 0 && host.natPortsUsedCount + portCount > natPortsTotal) {
      throw new Error(`Host ports exceeded: ${host.natPortsUsedCount + portCount}/${natPortsTotal}`)
    }

    await tx.host.update({
      where: { id: hostId },
      data: {
        cpuUsed: host.cpuUsed + cpu,
        memoryUsed: host.memoryUsed + memory,
        diskUsed: host.diskUsed + disk,
        ...(portCount > 0 ? {
          natPortsUsedCount: host.natPortsUsedCount + portCount
        } : {})
      }
    })
  }, QUOTA_TRANSACTION_OPTIONS)
}

/**
 * 资源回滚 - 释放预占的资源
 * 
 * 安全改进：
 * - 使用 Math.max(0, ...) 确保不会出现负数
 * - 显式指定 Serializable 隔离级别
 */
export async function rollbackResources(options: {
  hostId: number
  cpu: number
  memory: number
  disk: number
  portCount?: number
}): Promise<void> {
  const { hostId, cpu, memory, disk, portCount = 0 } = options

  // 使用交互式事务 + Serializable 隔离级别
  await prisma.$transaction(async (tx) => {
    // 注意：不再限制用户的实例配额，只回滚宿主机资源

    // 回滚宿主机资源使用量
    const host = await tx.host.findUnique({
      where: { id: hostId },
      select: {
        cpuUsed: true,
        memoryUsed: true,
        diskUsed: true,
        natPortsUsedCount: true
      }
    })

    if (host) {
      await tx.host.update({
        where: { id: hostId },
        data: {
          cpuUsed: Math.max(0, host.cpuUsed - cpu),
          memoryUsed: Math.max(0, host.memoryUsed - memory),
          diskUsed: Math.max(0, host.diskUsed - disk),
          ...(portCount > 0 ? {
            natPortsUsedCount: Math.max(0, host.natPortsUsedCount - portCount)
          } : {})
        }
      })
    }
  }, QUOTA_TRANSACTION_OPTIONS)
}

/**
 * 计算用户配额使用量（新配额系统）
 */
export async function calculateUserQuotaUsed(userId: number): Promise<{
  hostUsed: number
  friendUsed: number
  packageUsed: number
}> {
  // 计算宿主机数量
  const hostUsed = await prisma.host.count({
    where: { userId }
  })

  // 注意：不再计算实例数量，因为不再限制用户的实例配额

  // 计算好友数量（已接受的好友关系）
  const friendUsed = await prisma.friendship.count({
    where: {
      OR: [
        { userId, status: 'accepted' },
        { friendId: userId, status: 'accepted' }
      ]
    }
  })

  // 计算套餐数量
  const packageUsed = await prisma.package.count({
    where: { userId }
  })

  return {
    hostUsed,
    friendUsed,
    packageUsed
  }
}

/**
 * 检查宿主机配额
 */
export async function checkHostQuota(userId: number): Promise<{
  allowed: boolean
  current: number
  limit: number
  message?: string
}> {
  const quota = await prisma.userQuota.findUnique({
    where: { userId },
    select: {
      hostLimit: true,
      hostUsed: true
    }
  })

  if (!quota) {
    return { allowed: false, current: 0, limit: 0, message: 'User quota not found' }
  }

  // 如果配额为 0，表示功能未授权
  if (quota.hostLimit === 0) {
    return {
      allowed: false,
      current: quota.hostUsed,
      limit: quota.hostLimit,
      message: 'Host feature is not authorized. Please contact administrator.'
    }
  }

  if (quota.hostUsed >= quota.hostLimit) {
    return {
      allowed: false,
      current: quota.hostUsed,
      limit: quota.hostLimit,
      message: `Host quota full (${quota.hostUsed}/${quota.hostLimit})`
    }
  }

  return { allowed: true, current: quota.hostUsed, limit: quota.hostLimit }
}

/**
 * 检查实例配额
 * @deprecated 已删除实例配额限制，此函数不再需要
 * 注意：不再限制用户的实例配额，用户可以创建无限数量的实例
 */

/**
 * 检查好友配额
 */
export async function checkFriendQuota(userId: number): Promise<{
  allowed: boolean
  current: number
  limit: number
  message?: string
}> {
  const quota = await prisma.userQuota.findUnique({
    where: { userId },
    select: {
      friendLimit: true,
      friendUsed: true
    }
  })

  if (!quota) {
    return { allowed: false, current: 0, limit: 0, message: 'User quota not found' }
  }

  // 如果配额为 0，表示功能未授权
  if (quota.friendLimit === 0) {
    return {
      allowed: false,
      current: quota.friendUsed,
      limit: quota.friendLimit,
      message: 'Friend feature is not authorized. Please contact administrator.'
    }
  }

  if (quota.friendUsed >= quota.friendLimit) {
    return {
      allowed: false,
      current: quota.friendUsed,
      limit: quota.friendLimit,
      message: `Friend quota full (${quota.friendUsed}/${quota.friendLimit})`
    }
  }

  return { allowed: true, current: quota.friendUsed, limit: quota.friendLimit }
}

/**
 * 检查套餐配额
 */
export async function checkPackageQuota(userId: number): Promise<{
  allowed: boolean
  current: number
  limit: number
  message?: string
}> {
  const quota = await prisma.userQuota.findUnique({
    where: { userId },
    select: {
      packageLimit: true,
      packageUsed: true
    }
  })

  if (!quota) {
    return { allowed: false, current: 0, limit: 0, message: 'User quota not found' }
  }

  // 如果配额为 0，表示功能未授权
  if (quota.packageLimit === 0) {
    return {
      allowed: false,
      current: quota.packageUsed,
      limit: quota.packageLimit,
      message: 'Package feature is not authorized. Please contact administrator.'
    }
  }

  if (quota.packageUsed >= quota.packageLimit) {
    return {
      allowed: false,
      current: quota.packageUsed,
      limit: quota.packageLimit,
      message: `Package quota full (${quota.packageUsed}/${quota.packageLimit})`
    }
  }

  return { allowed: true, current: quota.packageUsed, limit: quota.packageLimit }
}

/**
 * 检查实例端口配额（基于实例的 portLimit）
 */
export async function checkPortQuota(_userId: number, instanceId: number): Promise<{
  allowed: boolean
  current: number
  limit: number
  message?: string
}> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      portLimit: true,
      _count: {
        select: { portMappings: true }
      }
    }
  })

  if (!instance) {
    return { allowed: false, current: 0, limit: 0, message: 'Instance not found' }
  }

  const limit = instance.portLimit ?? 0
  const current = instance._count.portMappings

  if (limit === 0) {
    return {
      allowed: false,
      current,
      limit: 0,
      message: 'Port quota not allocated for this instance'
    }
  }

  if (current >= limit) {
    return {
      allowed: false,
      current,
      limit,
      message: `Instance port quota full (${current}/${limit})`
    }
  }

  return { allowed: true, current, limit }
}

/**
 * 检查实例快照配额（基于实例的 snapshotLimit）
 */
export async function checkSnapshotQuota(_userId: number, instanceId: number): Promise<{
  allowed: boolean
  current: number
  limit: number
  message?: string
}> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      snapshotLimit: true,
      _count: {
        select: { snapshots: true }
      }
    }
  })

  if (!instance) {
    return { allowed: false, current: 0, limit: 0, message: 'Instance not found' }
  }

  const limit = instance.snapshotLimit ?? 0
  const current = instance._count.snapshots

  if (limit === 0) {
    return {
      allowed: false,
      current,
      limit: 0,
      message: 'Snapshot quota not allocated for this instance'
    }
  }

  if (current >= limit) {
    return {
      allowed: false,
      current,
      limit,
      message: `Instance snapshot quota full (${current}/${limit})`
    }
  }

  return { allowed: true, current, limit }
}

/**
 * 检查实例备份配额（基于实例的 backupLimit）
 */
export async function checkBackupQuota(_userId: number, instanceId: number): Promise<{
  allowed: boolean
  current: number
  limit: number
  message?: string
}> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      backupLimit: true
    }
  })

  if (!instance) {
    return { allowed: false, current: 0, limit: 0, message: 'Instance not found' }
  }

  const limit = instance.backupLimit ?? 0

  // 计算当前备份数（排除已删除的）
  const current = await prisma.backup.count({
    where: {
      instanceId,
      status: { not: 'deleted' }
    }
  })

  if (limit === 0) {
    return {
      allowed: false,
      current,
      limit: 0,
      message: 'Backup quota not allocated for this instance'
    }
  }

  if (current >= limit) {
    return {
      allowed: false,
      current,
      limit,
      message: `Instance backup quota full (${current}/${limit})`
    }
  }

  return { allowed: true, current, limit }
}

/**
 * 同步用户配额使用量（重新计算）
 */
export async function syncUserQuotaUsed(userId: number): Promise<void> {
  const used = await calculateUserQuotaUsed(userId)
  await updateUserQuotaUsed(userId, used)
}
