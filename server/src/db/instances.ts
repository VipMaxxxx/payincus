/**
 * 实例相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { Instance, InstanceStatus } from '../types/database.js'

/**
 * 根据用户 ID 获取实例列表
 */
export async function getInstancesByUserId(userId: number): Promise<Array<Instance & {
  host_name?: string
  host_location?: string
  host_country_code?: string
}>> {
  const instances = await prisma.instance.findMany({
    where: {
      userId,
      status: { not: 'deleted' }
    },
    include: {
      host: {
        select: {
          name: true,
          location: true,
          countryCode: true
        }
      }
    },
    orderBy: {
      id: 'desc'
    }
  })

  return instances.map(inst => ({
    id: inst.id,
    incus_id: inst.incusId,
    name: inst.name,
    user_id: inst.userId,
    host_id: inst.hostId,
    package_id: inst.packageId,
    package_plan_id: inst.packagePlanId,
    storage_pool_name: inst.storagePoolName ?? null,
    icon_badge_id: inst.iconBadgeId,
    image: inst.image,
    status: inst.status,
    cpu: inst.cpu,
    memory: inst.memory,
    disk: inst.disk,
    ipv4: inst.ipv4,
    ipv6: inst.ipv6,
    network_mode: inst.networkMode,
    ssh_port: inst.sshPort,
    root_password: inst.rootPassword,
    port_limit: inst.portLimit,
    snapshot_limit: inst.snapshotLimit,
    backup_limit: inst.backupLimit,
    site_limit: inst.siteLimit,
    swap_enabled: inst.swapEnabled,
    swap_size: inst.swapSize,
    monthly_traffic_limit: inst.monthlyTrafficLimit ? inst.monthlyTrafficLimit.toString() : null,
    // 配置字段
    limits_read: inst.limitsRead,
    limits_write: inst.limitsWrite,
    limits_read_iops: inst.limitsReadIops,
    limits_write_iops: inst.limitsWriteIops,
    limits_ingress: inst.limitsIngress,
    limits_egress: inst.limitsEgress,
    limits_processes: inst.limitsProcesses,
    limits_cpu_priority: inst.limitsCpuPriority,
    boot_autostart: inst.bootAutostart,
    boot_autostart_priority: inst.bootAutostartPriority,
    boot_autostart_delay: inst.bootAutostartDelay,
    boot_host_shutdown_timeout: inst.bootHostShutdownTimeout,
    // 封停相关字段
    expires_at: inst.expiresAt?.toISOString() ?? null,
    suspended_at: inst.suspendedAt?.toISOString() ?? null,
    suspended_by: inst.suspendedBy,
    suspend_reason: inst.suspendReason,
    created_at: inst.createdAt.toISOString(),
    updated_at: inst.updatedAt.toISOString(),
    host_name: inst.host.name,
    host_location: inst.host.location ?? undefined,
    host_country_code: inst.host.countryCode
  }))
}

/**
 * 获取所有实例
 */
export async function getAllInstances(): Promise<Array<Instance & {
  host_name?: string
  host_country_code?: string
  username?: string
}>> {
  const instances = await prisma.instance.findMany({
    where: {
      status: { not: 'deleted' }
    },
    include: {
      host: {
        select: {
          name: true,
          countryCode: true
        }
      },
      user: {
        select: {
          username: true
        }
      }
    },
    orderBy: {
      id: 'desc'
    }
  })

  return instances.map(inst => ({
    id: inst.id,
    incus_id: inst.incusId,
    name: inst.name,
    user_id: inst.userId,
    host_id: inst.hostId,
    package_id: inst.packageId,
    package_plan_id: inst.packagePlanId,
    storage_pool_name: inst.storagePoolName ?? null,
    icon_badge_id: inst.iconBadgeId,
    image: inst.image,
    status: inst.status,
    cpu: inst.cpu,
    memory: inst.memory,
    disk: inst.disk,
    ipv4: inst.ipv4,
    ipv6: inst.ipv6,
    network_mode: inst.networkMode,
    ssh_port: inst.sshPort,
    root_password: inst.rootPassword,
    port_limit: inst.portLimit,
    snapshot_limit: inst.snapshotLimit,
    backup_limit: inst.backupLimit,
    site_limit: inst.siteLimit,
    swap_enabled: inst.swapEnabled,
    swap_size: inst.swapSize,
    monthly_traffic_limit: inst.monthlyTrafficLimit ? inst.monthlyTrafficLimit.toString() : null,
    // 配置字段
    limits_read: inst.limitsRead,
    limits_write: inst.limitsWrite,
    limits_read_iops: inst.limitsReadIops,
    limits_write_iops: inst.limitsWriteIops,
    limits_ingress: inst.limitsIngress,
    limits_egress: inst.limitsEgress,
    limits_processes: inst.limitsProcesses,
    limits_cpu_priority: inst.limitsCpuPriority,
    boot_autostart: inst.bootAutostart,
    boot_autostart_priority: inst.bootAutostartPriority,
    boot_autostart_delay: inst.bootAutostartDelay,
    boot_host_shutdown_timeout: inst.bootHostShutdownTimeout,
    // 封停相关字段
    expires_at: inst.expiresAt?.toISOString() ?? null,
    suspended_at: inst.suspendedAt?.toISOString() ?? null,
    suspended_by: inst.suspendedBy,
    suspend_reason: inst.suspendReason,
    created_at: inst.createdAt.toISOString(),
    updated_at: inst.updatedAt.toISOString(),
    host_name: inst.host.name,
    host_country_code: inst.host.countryCode,
    username: inst.user.username
  }))
}

/**
 * 根据 ID 获取实例
 */
export async function getInstanceById(id: number): Promise<(Instance & {
  host_name?: string
  host_country_code?: string
  nat_public_ip?: string
  host_storage_driver?: string
  monthly_traffic_limit?: string | null
  last_ipv6_reassign_at?: string | null
  cloud_init_state?: string | null
  cloud_init_source?: string | null
  cloud_init_last_checked_at?: string | null
  cloud_init_completed_at?: string | null
  cloud_init_manual_completed_at?: string | null
  cloud_init_manual_completed_by?: number | null
  package_plan_id?: number | null
  auto_renew?: boolean
  billing_price?: number | null  // 实例专属价格（元）
  swap_enabled?: boolean
  swap_size?: number | null
  storage_pool_name?: string | null
}) | null> {
  const inst = await prisma.instance.findUnique({
    where: { id },
    include: {
      host: {
        select: {
          name: true,
          countryCode: true,
          natPublicIp: true,
          storageDriver: true
        }
      }
    }
  })

  if (!inst) return null

  return {
    id: inst.id,
    incus_id: inst.incusId,
    name: inst.name,
    user_id: inst.userId,
    host_id: inst.hostId,
    package_id: inst.packageId,
    storage_pool_name: inst.storagePoolName ?? null,
    icon_badge_id: inst.iconBadgeId,
    image: inst.image,
    status: inst.status,
    cpu: inst.cpu,
    memory: inst.memory,
    disk: inst.disk,
    ipv4: inst.ipv4,
    ipv6: inst.ipv6,
    network_mode: inst.networkMode,
    ssh_port: inst.sshPort,
    root_password: inst.rootPassword,
    port_limit: inst.portLimit,
    snapshot_limit: inst.snapshotLimit,
    backup_limit: inst.backupLimit,
    site_limit: inst.siteLimit,
    swap_enabled: inst.swapEnabled,
    swap_size: inst.swapSize,
    monthly_traffic_limit: inst.monthlyTrafficLimit ? inst.monthlyTrafficLimit.toString() : null,
    // 配置字段
    limits_read: inst.limitsRead,
    limits_write: inst.limitsWrite,
    limits_read_iops: inst.limitsReadIops,
    limits_write_iops: inst.limitsWriteIops,
    limits_ingress: inst.limitsIngress,
    limits_egress: inst.limitsEgress,
    limits_processes: inst.limitsProcesses,
    limits_cpu_priority: inst.limitsCpuPriority,
    boot_autostart: inst.bootAutostart,
    boot_autostart_priority: inst.bootAutostartPriority,
    boot_autostart_delay: inst.bootAutostartDelay,
    boot_host_shutdown_timeout: inst.bootHostShutdownTimeout,
    // 封停相关字段
    expires_at: inst.expiresAt?.toISOString() ?? null,
    suspended_at: inst.suspendedAt?.toISOString() ?? null,
    suspended_by: inst.suspendedBy,
    suspend_reason: inst.suspendReason,
    cloud_init_state: inst.cloudInitState ?? null,
    cloud_init_source: inst.cloudInitSource ?? null,
    cloud_init_last_checked_at: inst.cloudInitLastCheckedAt?.toISOString() ?? null,
    cloud_init_completed_at: inst.cloudInitCompletedAt?.toISOString() ?? null,
    cloud_init_manual_completed_at: inst.cloudInitManualCompletedAt?.toISOString() ?? null,
    cloud_init_manual_completed_by: inst.cloudInitManualCompletedBy ?? null,
    created_at: inst.createdAt.toISOString(),
    updated_at: inst.updatedAt.toISOString(),
    host_name: inst.host.name,
    host_country_code: inst.host.countryCode,
    nat_public_ip: inst.host.natPublicIp ?? undefined,
    host_storage_driver: inst.host.storageDriver,
    last_ipv6_reassign_at: inst.lastIpv6ReassignAt?.toISOString() ?? null,
    package_plan_id: inst.packagePlanId ?? null,
    auto_renew: inst.autoRenew,
    billing_price: inst.billingPrice ? Number(inst.billingPrice) : null
  }
}

/**
 * 更新实例配额
 */
export async function updateInstanceQuota(instanceId: number, data: {
  portLimit?: number | null
  snapshotLimit?: number | null
  backupLimit?: number | null
  siteLimit?: number | null
}): Promise<void> {
  return await updateInstance(instanceId, data)
}

/**
 * 创建实例记录
 */
export async function createInstance(data: {
  incusId: string
  name: string
  userId: number
  hostId: number
  packageId: number | null
  storagePoolName?: string | null
  image: string
  cpu: number
  memory: number
  disk: number
  networkMode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  snapshotSpecs?: Record<string, unknown>
  sshPort?: number | null
  rootPassword?: string | null
  monthlyTrafficLimit?: bigint | null
  // 配额字段（从套餐继承）
  portLimit?: number | null
  snapshotLimit?: number | null
  backupLimit?: number | null
  siteLimit?: number | null
  swapEnabled?: boolean
  swapSize?: number | null
}): Promise<number> {
  const instance = await prisma.instance.create({
    data: {
      incusId: data.incusId,
      name: data.name,
      userId: data.userId,
      hostId: data.hostId,
      packageId: data.packageId,
      storagePoolName: data.storagePoolName ?? null,
      image: data.image,
      cpu: data.cpu,
      memory: data.memory,
      disk: data.disk,
      networkMode: data.networkMode,
      snapshottedSpecs: (data.snapshotSpecs || {}) as unknown as any, // Prisma Json 类型
      sshPort: data.sshPort ?? null,
      rootPassword: data.rootPassword ?? null,
      status: 'creating',
      monthlyTrafficLimit: data.monthlyTrafficLimit ?? null,
      // 配额字段
      portLimit: data.portLimit ?? null,
      snapshotLimit: data.snapshotLimit ?? null,
      backupLimit: data.backupLimit ?? null,
      siteLimit: data.siteLimit ?? null,
      swapEnabled: data.swapEnabled ?? false,
      swapSize: data.swapSize ?? null
    }
  })

  return instance.id
}

/**
 * 更新实例状态
 */
export async function updateInstanceStatus(
  id: number,
  status: InstanceStatus,
  network: {
    ipv4?: string | null
    ipv6?: string | null
  } | null = null
): Promise<void> {
  const updateData: {
    status: InstanceStatus
    ipv4?: string | null
    ipv6?: string | null
  } = { status }

  if (network) {
    if (network.ipv4 !== undefined) updateData.ipv4 = network.ipv4 ?? null
    if (network.ipv6 !== undefined) updateData.ipv6 = network.ipv6 ?? null
  }

  if (status === 'deleted') {
    await prisma.instance.update({
      where: { id },
      data: updateData
    })
    return
  }

  await prisma.instance.updateMany({
    where: {
      id,
      status: { not: 'deleted' }
    },
    data: updateData
  })
}

/**
 * 更新实例
 */
export async function updateInstance(id: number, data: {
  image?: string
  name?: string
  status?: InstanceStatus
  sshPort?: number | null
  rootPassword?: string | null
  portLimit?: number | null
  snapshotLimit?: number | null
  backupLimit?: number | null
  siteLimit?: number | null
  swapEnabled?: boolean
  swapSize?: number | null
  storagePoolName?: string | null
}): Promise<void> {
  const updateData: {
    image?: string
    name?: string
    status?: InstanceStatus
    sshPort?: number | null
    rootPassword?: string | null
    portLimit?: number | null
    snapshotLimit?: number | null
    backupLimit?: number | null
    siteLimit?: number | null
    swapEnabled?: boolean
    swapSize?: number | null
    storagePoolName?: string | null
  } = {}

  if (data.image !== undefined) updateData.image = data.image
  if (data.name !== undefined) updateData.name = data.name
  if (data.status !== undefined) updateData.status = data.status
  if (data.sshPort !== undefined) updateData.sshPort = data.sshPort ?? null
  if (data.rootPassword !== undefined) updateData.rootPassword = data.rootPassword ?? null
  if (data.portLimit !== undefined) updateData.portLimit = data.portLimit ?? null
  if (data.snapshotLimit !== undefined) updateData.snapshotLimit = data.snapshotLimit ?? null
  if (data.backupLimit !== undefined) updateData.backupLimit = data.backupLimit ?? null
  if (data.siteLimit !== undefined) updateData.siteLimit = data.siteLimit ?? null
  if (data.swapEnabled !== undefined) updateData.swapEnabled = data.swapEnabled
  if (data.swapSize !== undefined) updateData.swapSize = data.swapSize ?? null
  if (data.storagePoolName !== undefined) updateData.storagePoolName = data.storagePoolName ?? null

  if (Object.keys(updateData).length === 0) return

  await prisma.instance.update({
    where: { id },
    data: updateData
  })
}

/**
 * 更新实例资源配置（CPU、内存、磁盘、流量）
 */
export async function updateInstanceResources(id: number, data: {
  cpu?: number
  memory?: number
  disk?: number
  monthlyTrafficLimit?: bigint | null
}): Promise<void> {
  const updateData: {
    cpu?: number
    memory?: number
    disk?: number
    monthlyTrafficLimit?: bigint | null
  } = {}

  if (data.cpu !== undefined) updateData.cpu = data.cpu
  if (data.memory !== undefined) updateData.memory = data.memory
  if (data.disk !== undefined) updateData.disk = data.disk
  if (data.monthlyTrafficLimit !== undefined) updateData.monthlyTrafficLimit = data.monthlyTrafficLimit

  if (Object.keys(updateData).length === 0) return

  await prisma.instance.update({
    where: { id },
    data: updateData
  })
}

/**
 * 获取实例配置（包含覆盖字段）
 */
export async function getInstanceConfig(instanceId: number): Promise<{
  limits_read: string | null
  limits_write: string | null
  limits_read_iops: number | null
  limits_write_iops: number | null
  limits_ingress: string | null
  limits_egress: string | null
  limits_processes: number | null
  limits_cpu_priority: number | null
  boot_autostart: boolean | null
  boot_autostart_priority: number | null
  boot_autostart_delay: number | null
  boot_host_shutdown_timeout: number | null
} | null> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      limitsRead: true,
      limitsWrite: true,
      limitsReadIops: true,
      limitsWriteIops: true,
      limitsIngress: true,
      limitsEgress: true,
      limitsProcesses: true,
      limitsCpuPriority: true,
      bootAutostart: true,
      bootAutostartPriority: true,
      bootAutostartDelay: true,
      bootHostShutdownTimeout: true
    }
  })

  if (!instance) return null

  return {
    limits_read: instance.limitsRead,
    limits_write: instance.limitsWrite,
    limits_read_iops: instance.limitsReadIops,
    limits_write_iops: instance.limitsWriteIops,
    limits_ingress: instance.limitsIngress,
    limits_egress: instance.limitsEgress,
    limits_processes: instance.limitsProcesses,
    limits_cpu_priority: instance.limitsCpuPriority,
    boot_autostart: instance.bootAutostart,
    boot_autostart_priority: instance.bootAutostartPriority,
    boot_autostart_delay: instance.bootAutostartDelay,
    boot_host_shutdown_timeout: instance.bootHostShutdownTimeout
  }
}

/**
 * 更新实例配置覆盖
 */
export async function updateInstanceConfig(instanceId: number, data: {
  limitsRead?: string | null
  limitsWrite?: string | null
  limitsReadIops?: number | null
  limitsWriteIops?: number | null
  limitsIngress?: string | null
  limitsEgress?: string | null
  limitsProcesses?: number | null
  limitsCpuPriority?: number | null
  bootAutostart?: boolean | null
  bootAutostartPriority?: number | null
  bootAutostartDelay?: number | null
  bootHostShutdownTimeout?: number | null
}): Promise<void> {
  const updateData: {
    limitsRead?: string | null
    limitsWrite?: string | null
    limitsReadIops?: number | null
    limitsWriteIops?: number | null
    limitsIngress?: string | null
    limitsEgress?: string | null
    limitsProcesses?: number | null
    limitsCpuPriority?: number | null
    bootAutostart?: boolean | null
    bootAutostartPriority?: number | null
    bootAutostartDelay?: number | null
    bootHostShutdownTimeout?: number | null
  } = {}

  if (data.limitsRead !== undefined) updateData.limitsRead = data.limitsRead
  if (data.limitsWrite !== undefined) updateData.limitsWrite = data.limitsWrite
  if (data.limitsReadIops !== undefined) updateData.limitsReadIops = data.limitsReadIops
  if (data.limitsWriteIops !== undefined) updateData.limitsWriteIops = data.limitsWriteIops
  if (data.limitsIngress !== undefined) updateData.limitsIngress = data.limitsIngress
  if (data.limitsEgress !== undefined) updateData.limitsEgress = data.limitsEgress
  if (data.limitsProcesses !== undefined) updateData.limitsProcesses = data.limitsProcesses
  if (data.limitsCpuPriority !== undefined) updateData.limitsCpuPriority = data.limitsCpuPriority
  if (data.bootAutostart !== undefined) updateData.bootAutostart = data.bootAutostart
  if (data.bootAutostartPriority !== undefined) updateData.bootAutostartPriority = data.bootAutostartPriority
  if (data.bootAutostartDelay !== undefined) updateData.bootAutostartDelay = data.bootAutostartDelay
  if (data.bootHostShutdownTimeout !== undefined) updateData.bootHostShutdownTimeout = data.bootHostShutdownTimeout

  if (Object.keys(updateData).length === 0) return

  await prisma.instance.update({
    where: { id: instanceId },
    data: updateData
  })
}

/**
 * 更新实例 SWAP 配置
 */
export async function updateInstanceSwap(instanceId: number, data: {
  swapEnabled?: boolean
  swapSize?: number | null
}): Promise<void> {
  const updateData: {
    swapEnabled?: boolean
    swapSize?: number | null
  } = {}

  if (data.swapEnabled !== undefined) updateData.swapEnabled = data.swapEnabled
  if (data.swapSize !== undefined) updateData.swapSize = data.swapSize ?? null

  if (Object.keys(updateData).length === 0) return

  await prisma.instance.update({
    where: { id: instanceId },
    data: updateData
  })
}

/**
 * 获取超时的创建中实例
 * 返回创建时间超过指定时间且仍处于 creating 状态的实例
 */
export async function getStuckCreatingInstances(timeoutMs: number): Promise<Array<{
  id: number
  incus_id: string
  name: string
  host_id: number
  user_id: number
  cpu: number
  memory: number
  disk: number
  network_mode: string
  port_limit: number | null
  created_at: Date
}>> {
  const threshold = new Date(Date.now() - timeoutMs)
  
  const instances = await prisma.instance.findMany({
    where: {
      status: 'creating',
      createdAt: { lt: threshold }
    },
    select: {
      id: true,
      incusId: true,
      name: true,
      hostId: true,
      userId: true,
      cpu: true,
      memory: true,
      disk: true,
      networkMode: true,
      portLimit: true,
      createdAt: true
    }
  })
  
  return instances.map(inst => ({
    id: inst.id,
    incus_id: inst.incusId,
    name: inst.name,
    host_id: inst.hostId,
    user_id: inst.userId,
    cpu: inst.cpu,
    memory: inst.memory,
    disk: inst.disk,
    network_mode: inst.networkMode,
    port_limit: inst.portLimit,
    created_at: inst.createdAt
  }))
}

/**
 * 封停实例
 */
export async function suspendInstance(instanceId: number, data: {
  suspendedBy: number | null  // null 表示系统自动封停
  suspendReason: string       // 封停原因，'expired' 表示到期封停，其他为用户填写的原因，空字符串表示未填写
}): Promise<void> {
  await prisma.instance.update({
    where: { id: instanceId },
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedBy: data.suspendedBy,
      suspendReason: data.suspendReason
    }
  })
}

/**
 * 解除封停
 */
export async function unsuspendInstance(instanceId: number): Promise<void> {
  await prisma.instance.update({
    where: { id: instanceId },
    data: {
      status: 'stopped',
      suspendedAt: null,
      suspendedBy: null,
      suspendReason: null
    }
  })
}

/**
 * 更新实例到期时间
 */
export async function updateInstanceExpiry(instanceId: number, expiresAt: Date | null): Promise<void> {
  await prisma.instance.update({
    where: { id: instanceId },
    data: { expiresAt }
  })
}

/**
 * 获取即将到期的实例（用于计费调度器）
 */
export async function getExpiringInstances(beforeDate: Date): Promise<Array<{
  id: number
  name: string
  user_id: number
  expires_at: Date
  status: string
}>> {
  const instances = await prisma.instance.findMany({
    where: {
      expiresAt: { lte: beforeDate },
      status: { notIn: ['deleted', 'suspended'] }
    },
    select: {
      id: true,
      name: true,
      userId: true,
      expiresAt: true,
      status: true
    }
  })

  return instances.map(inst => ({
    id: inst.id,
    name: inst.name,
    user_id: inst.userId,
    expires_at: inst.expiresAt!,
    status: inst.status
  }))
}

/**
 * 获取已到期未封停的实例
 */
export async function getExpiredUnsuspendedInstances(): Promise<Array<{
  id: number
  name: string
  user_id: number
  expires_at: Date
}>> {
  const now = new Date()
  const instances = await prisma.instance.findMany({
    where: {
      expiresAt: { lte: now },
      status: { notIn: ['deleted', 'suspended'] }
    },
    select: {
      id: true,
      name: true,
      userId: true,
      expiresAt: true
    }
  })

  return instances.map(inst => ({
    id: inst.id,
    name: inst.name,
    user_id: inst.userId,
    expires_at: inst.expiresAt!
  }))
}
