/**
 * 主机相关数据库操�?
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { Instance, PackagePlan, Prisma } from '@prisma/client'
import type { Host } from '../types/database.js'
import { resolveStoragePoolForNewInstance } from './storage-pools.js'

type DbClient = Prisma.TransactionClient | typeof prisma

export type PlanUpgradeCapacityReason =
  | 'host_not_found'
  | 'host_not_online'
  | 'cpu_insufficient'
  | 'memory_insufficient'
  | 'disk_insufficient'

export interface PlanUpgradeCapacityCheck {
  canUpgrade: boolean
  reason: PlanUpgradeCapacityReason | null
  message: string | null
  hostId: number
  deltas: {
    cpu: number
    memory: number
    disk: number
  }
  currentUsage: {
    cpu: number
    memory: number
    disk: number
  }
  projectedUsage: {
    cpu: number
    memory: number
    disk: number
  }
  limits: {
    cpu: number | null
    memory: number | null
    disk: number | null
  }
  available: {
    cpu: number | null
    memory: number | null
    disk: number | null
  }
}

/**
 * 获取所有主�?
 */
export async function getAllHosts(): Promise<Host[]> {
  const hosts = await prisma.host.findMany({
    orderBy: {
      id: 'asc'
    }
  })

  return hosts.map(host => ({
    id: host.id,
    name: host.name,
    url: host.url,
    location: host.location,
    country_code: host.countryCode,
    architecture: host.architecture as 'x86_64' | 'aarch64',
    status: host.status,
    cert_path: host.certPath,
    key_path: host.keyPath,
    nat_public_ip: host.natPublicIp,
    nat_public_ipv6: host.natPublicIpv6,
    nat_bind_ip: host.natBindIp,
    nat_bind_ipv6: host.natBindIpv6,
    nat_port_start: host.natPortStart,
    nat_port_end: host.natPortEnd,
    cpu_used: host.cpuUsed,
    memory_used: host.memoryUsed,
    disk_used: host.diskUsed,
    cpu_allowance_max: host.cpuAllowanceMax,
    memory_max: host.memoryMax,
    storage_size: host.storageSize,
    created_at: host.createdAt.toISOString(),
    updated_at: host.updatedAt.toISOString()
  }))
}

/**
 * 检查是否有可用的节点（非离线状态）
 * @param userId 可选，指定用户 ID 则只检查该用户的节�?
 */
export async function hasAvailableHosts(userId?: number): Promise<boolean> {
  const count = await prisma.host.count({
    where: {
      status: { not: 'offline' as const },
      ...(userId !== undefined ? { userId } : {})
    }
  })
  return count > 0
}

/**
 * 根据 ID 获取主机
 */
export async function getHostById(id: number): Promise<Host | null> {
  const host = await prisma.host.findUnique({
    where: { id }
  })

  if (!host) return null

  return {
    id: host.id,
    user_id: host.userId,
    name: host.name,
    url: host.url,
    location: host.location,
    country_code: host.countryCode,
    architecture: host.architecture as 'x86_64' | 'aarch64',
    status: host.status,
    cert_path: host.certPath,
    key_path: host.keyPath,
    nat_public_ip: host.natPublicIp,
    nat_public_ipv6: host.natPublicIpv6,
    nat_bind_ip: host.natBindIp,
    nat_bind_ipv6: host.natBindIpv6,
    nat_port_start: host.natPortStart,
    nat_port_end: host.natPortEnd,
    cpu_used: host.cpuUsed,
    memory_used: host.memoryUsed,
    disk_used: host.diskUsed,
    ip_address: host.ipAddress,
    storage_driver: host.storageDriver,
    storage_type: host.storageType,
    storage_path: host.storagePath,
    storage_size: host.storageSize,
    ipv6_mode: host.ipv6Mode,
    ipv6_subnet: host.ipv6Subnet,
    ipv6_gateway: host.ipv6Gateway,
    ipv6_parent_interface: host.ipv6ParentInterface,
    enable_api: host.enableApi,
    sysctl_config: host.sysctlConfig,
    cpu_allowance_max: host.cpuAllowanceMax,
    memory_max: host.memoryMax,
    instance_type: host.instanceType,
    // Caddy 反代配置
    caddy_enabled: host.caddyEnabled,
    caddy_username: host.caddyUsername,
    caddy_password: host.caddyPassword,
    caddy_port: host.caddyPort,
    // 转移控制
    transfer_enabled: host.transferEnabled,
    // 流量配置
    traffic_reset_day: host.trafficResetDay,
    // 节点通知设置
    notify_purchase: host.notifyPurchase,
    notify_renew: host.notifyRenew,
    notify_destroy: host.notifyDestroy,
    // 资源池玩�?
    enable_resource_pool: host.enableResourcePool,
    // 节点公告
    announcement: host.announcement,
    // 探针地址
    probe_url: host.probeUrl,
    created_at: host.createdAt.toISOString(),
    updated_at: host.updatedAt.toISOString()
  }
}

/**
 * 根据用户ID和名称获取主�?
 */
export async function getHostByUserAndName(userId: number, name: string): Promise<Host | null> {
  const host = await prisma.host.findUnique({
    where: { userId_name: { userId, name } }
  })

  if (!host) return null

  return {
    id: host.id,
    user_id: host.userId,
    name: host.name,
    url: host.url,
    location: host.location,
    country_code: host.countryCode,
    architecture: host.architecture as 'x86_64' | 'aarch64',
    status: host.status,
    cert_path: host.certPath,
    key_path: host.keyPath,
    nat_public_ip: host.natPublicIp,
    nat_public_ipv6: host.natPublicIpv6,
    nat_bind_ip: host.natBindIp,
    nat_bind_ipv6: host.natBindIpv6,
    nat_port_start: host.natPortStart,
    nat_port_end: host.natPortEnd,
    cpu_used: host.cpuUsed,
    memory_used: host.memoryUsed,
    disk_used: host.diskUsed,
    created_at: host.createdAt.toISOString(),
    updated_at: host.updatedAt.toISOString()
  }
}

/**
 * 根据安装token获取主机
 */
export async function getHostByInstallToken(token: string): Promise<{
  id: number
  name: string
  storage_driver: string
  storage_type: string
  storage_path: string | null
  storage_size: number
  ipv6_mode: number
  ipv6_subnet: string | null
  ipv6_gateway: string | null
  enable_api: boolean
  sysctl_config: string | null
  install_token_expire: Date | null
} | null> {
  const host = await prisma.host.findUnique({
    where: { installToken: token },
    select: {
      id: true,
      name: true,
      storageDriver: true,
      storageType: true,
      storagePath: true,
      storageSize: true,
      ipv6Mode: true,
      ipv6Subnet: true,
      ipv6Gateway: true,
      enableApi: true,
      sysctlConfig: true,
      installTokenExpire: true
    }
  })

  if (!host) return null

  return {
    id: host.id,
    name: host.name,
    storage_driver: host.storageDriver,
    storage_type: host.storageType,
    storage_path: host.storagePath,
    storage_size: host.storageSize,
    ipv6_mode: host.ipv6Mode,
    ipv6_subnet: host.ipv6Subnet,
    ipv6_gateway: host.ipv6Gateway,
    enable_api: host.enableApi,
    sysctl_config: host.sysctlConfig,
    install_token_expire: host.installTokenExpire
  }
}

/**
 * 创建主机
 */
export async function createHost(data: {
  userId: number  // 所有�?
  name: string
  url: string
  location?: string | null
  countryCode?: string
  architecture?: 'x86_64' | 'aarch64'
  tags?: string[]
  certPath?: string | null
  keyPath?: string | null
  natPublicIp?: string | null
  natPublicIpv6?: string | null
  natBindIp?: string | null
  natBindIpv6?: string | null
  natPortStart?: number | null
  natPortEnd?: number | null
  ipAddress?: string | null
  storageDriver?: string
  storageType?: string
  storagePath?: string | null
  storageSize?: number
  ipv6Mode?: number
  ipv6Subnet?: string | null
  ipv6Gateway?: string | null
  ipv6ParentInterface?: string | null
  enableApi?: boolean
  sysctlConfig?: string | null
  installToken?: string | null
  installTokenExpire?: Date | null
  isInstalled?: boolean
  certDownloadCount?: number
  certDownloadExpire?: Date | null
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
}, client: DbClient = prisma): Promise<number> {
  const createData: any = {
    userId: data.userId,
    name: data.name,
    url: data.url,
    location: data.location ?? null,
    countryCode: data.countryCode ?? 'us',
    architecture: data.architecture ?? 'x86_64',
    tags: (data.tags || []) as unknown as any,
    certPath: data.certPath ?? null,
    keyPath: data.keyPath ?? null,
    natPublicIp: data.natPublicIp ?? null,
    natPublicIpv6: data.natPublicIpv6 ?? null,
    natBindIp: data.natBindIp ?? null,
    natBindIpv6: data.natBindIpv6 ?? null,
    natPortStart: data.natPortStart ?? null,
    natPortEnd: data.natPortEnd ?? null,
    ipAddress: data.ipAddress ?? null,
    storageDriver: data.storageDriver ?? 'zfs',
    storageType: data.storageType ?? 'loop',
    storagePath: data.storagePath ?? null,
    storageSize: data.storageSize ?? 60,
    ipv6Mode: data.ipv6Mode ?? 1,
    ipv6Subnet: data.ipv6Subnet ?? null,
    ipv6Gateway: data.ipv6Gateway ?? null,
    ipv6ParentInterface: data.ipv6ParentInterface ?? null,
    enableApi: data.enableApi !== undefined ? data.enableApi : true,
    sysctlConfig: data.sysctlConfig ?? null,
    installToken: data.installToken ?? null,
    installTokenExpire: data.installTokenExpire ?? null,
    isInstalled: data.isInstalled ?? false,
    certDownloadCount: data.certDownloadCount ?? 0,
    certDownloadExpire: data.certDownloadExpire ?? null,
    cpuAllowanceMax: data.cpuAllowanceMax ?? 0,
    memoryMax: data.memoryMax ?? 0,
    instanceType: data.instanceType ?? 'container',
    status: 'offline'
  }

  const host = await client.host.create({
    data: createData
  })

  return host.id
}

/**
 * 更新主机
 */
export async function updateHost(id: number, data: {
  name?: string
  url?: string
  location?: string | null
  countryCode?: string
  tags?: string[]
  certPath?: string | null
  keyPath?: string | null
  natPublicIp?: string | null
  natPublicIpv6?: string | null
  natBindIp?: string | null
  natBindIpv6?: string | null
  natPortStart?: number | null
  natPortEnd?: number | null
  ipv6ParentInterface?: string | null
  ipv6Subnet?: string | null
  trafficResetDay?: number
  notifyPurchase?: boolean
  notifyRenew?: boolean
  notifyDestroy?: boolean
}, client: DbClient = prisma): Promise<void> {
  const updateData: {
    name?: string
    url?: string
    location?: string | null
    countryCode?: string
    tags?: any
    certPath?: string | null
    keyPath?: string | null
    natPublicIp?: string | null
    natPublicIpv6?: string | null
    natBindIp?: string | null
    natBindIpv6?: string | null
    natPortStart?: number | null
    natPortEnd?: number | null
    ipv6ParentInterface?: string | null
    ipv6Subnet?: string | null
    trafficResetDay?: number
    notifyPurchase?: boolean
    notifyRenew?: boolean
    notifyDestroy?: boolean
  } = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.url !== undefined) updateData.url = data.url
  if (data.location !== undefined) updateData.location = data.location ?? null
  if (data.countryCode !== undefined) updateData.countryCode = data.countryCode
  if (data.tags !== undefined) updateData.tags = data.tags as unknown as any
  if (data.certPath !== undefined) updateData.certPath = data.certPath ?? null
  if (data.keyPath !== undefined) updateData.keyPath = data.keyPath ?? null
  if (data.natPublicIp !== undefined) updateData.natPublicIp = data.natPublicIp ?? null
  if (data.natPublicIpv6 !== undefined) updateData.natPublicIpv6 = data.natPublicIpv6 ?? null
  if (data.natBindIp !== undefined) updateData.natBindIp = data.natBindIp ?? null
  if (data.natBindIpv6 !== undefined) updateData.natBindIpv6 = data.natBindIpv6 ?? null
  if (data.natPortStart !== undefined) updateData.natPortStart = data.natPortStart ?? null
  if (data.natPortEnd !== undefined) updateData.natPortEnd = data.natPortEnd ?? null
  if (data.ipv6ParentInterface !== undefined) updateData.ipv6ParentInterface = data.ipv6ParentInterface ?? null
  if (data.ipv6Subnet !== undefined) updateData.ipv6Subnet = data.ipv6Subnet ?? null
  if (data.trafficResetDay !== undefined) updateData.trafficResetDay = data.trafficResetDay
  if (data.notifyPurchase !== undefined) updateData.notifyPurchase = data.notifyPurchase
  if (data.notifyRenew !== undefined) updateData.notifyRenew = data.notifyRenew
  if (data.notifyDestroy !== undefined) updateData.notifyDestroy = data.notifyDestroy

  if (Object.keys(updateData).length === 0) return

  await client.host.update({
    where: { id },
    data: updateData
  })
}

/**
 * 更新主机状�?
 */
export async function updateHostStatus(
  id: number,
  status: 'online' | 'offline' | 'maintenance'
): Promise<void> {
  await prisma.host.update({
    where: { id },
    data: { status }
  })
}

/**
 * 基于数据库实例统计节点的已用资源（排除已删除的实例）
 */
export async function calculateHostResourcesFromInstances(hostId: number): Promise<{
  cpuUsed: number
  memoryUsed: number
  diskUsed: number
}> {
  const result = await prisma.instance.aggregate({
    where: {
      hostId,
      status: { not: 'deleted' }
    },
    _sum: {
      cpu: true,
      memory: true,
      disk: true
    }
  })

  return {
    cpuUsed: result._sum.cpu ?? 0,
    memoryUsed: result._sum.memory ?? 0,
    diskUsed: result._sum.disk ?? 0
  }
}

/**
 * 更新主机资源
 */
export async function updateHostResources(id: number, resources: {
  cpuUsed?: number
  memoryUsed?: number
  diskUsed?: number
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: string
  architecture?: 'x86_64' | 'aarch64'
}, client: DbClient = prisma): Promise<void> {
  const updateData: {
    cpuUsed?: number
    memoryUsed?: number
    diskUsed?: number
    cpuAllowanceMax?: number
    memoryMax?: number
    instanceType?: 'container' | 'vm' | 'both'
    architecture?: 'x86_64' | 'aarch64'
  } = {}

  if (resources.cpuUsed !== undefined) updateData.cpuUsed = resources.cpuUsed
  if (resources.memoryUsed !== undefined) updateData.memoryUsed = resources.memoryUsed
  if (resources.diskUsed !== undefined) updateData.diskUsed = resources.diskUsed
  if (resources.cpuAllowanceMax !== undefined) updateData.cpuAllowanceMax = resources.cpuAllowanceMax
  if (resources.memoryMax !== undefined) updateData.memoryMax = resources.memoryMax
  if (resources.instanceType !== undefined) {
    updateData.instanceType = resources.instanceType as 'container' | 'vm' | 'both'
  }
  if (resources.architecture !== undefined) updateData.architecture = resources.architecture

  if (Object.keys(updateData).length === 0) return

  await client.host.update({
    where: { id },
    data: updateData
  })
}

function buildPlanUpgradeCapacityResult(input: {
  instance: Pick<Instance, 'hostId' | 'cpu' | 'memory' | 'disk'>
  newPlan: Pick<PackagePlan, 'cpu' | 'memory' | 'disk'>
  host: {
    id: number
    status: string
    cpuUsed: number
    memoryUsed: number
    diskUsed: number
    cpuAllowanceMax: number | null
    memoryMax: number | null
    storageSize: number | null
  } | null
  aggregate: { cpuUsed: number; memoryUsed: number; diskUsed: number }
}): PlanUpgradeCapacityCheck {
  const { instance, newPlan, host, aggregate } = input
  const deltas = {
    cpu: newPlan.cpu - instance.cpu,
    memory: newPlan.memory - instance.memory,
    disk: newPlan.disk - instance.disk
  }

  const zeroUsage = { cpu: 0, memory: 0, disk: 0 }
  const emptyLimits = { cpu: null, memory: null, disk: null }
  const emptyAvailable = { cpu: null, memory: null, disk: null }

  if (!host) {
    return {
      canUpgrade: false,
      reason: 'host_not_found',
      message: 'HOST_NOT_FOUND',
      hostId: instance.hostId,
      deltas,
      currentUsage: zeroUsage,
      projectedUsage: zeroUsage,
      limits: emptyLimits,
      available: emptyAvailable
    }
  }

  const currentUsage = {
    cpu: Math.max(aggregate.cpuUsed, host.cpuUsed ?? 0),
    memory: Math.max(aggregate.memoryUsed, host.memoryUsed ?? 0),
    disk: Math.max(aggregate.diskUsed, host.diskUsed ?? 0)
  }
  const projectedUsage = {
    cpu: currentUsage.cpu + deltas.cpu,
    memory: currentUsage.memory + deltas.memory,
    disk: currentUsage.disk + deltas.disk
  }
  const limits = {
    cpu: host.cpuAllowanceMax && host.cpuAllowanceMax > 0 ? host.cpuAllowanceMax : null,
    memory: host.memoryMax && host.memoryMax > 0 ? host.memoryMax : null,
    disk: host.storageSize && host.storageSize > 0 ? host.storageSize * 1024 : null
  }
  const available = {
    cpu: limits.cpu === null ? null : Math.max(0, limits.cpu - currentUsage.cpu),
    memory: limits.memory === null ? null : Math.max(0, limits.memory - currentUsage.memory),
    disk: limits.disk === null ? null : Math.max(0, limits.disk - currentUsage.disk)
  }

  if (host.status !== 'online') {
    return { canUpgrade: false, reason: 'host_not_online', message: 'HOST_NOT_ONLINE', hostId: host.id, deltas, currentUsage, projectedUsage, limits, available }
  }

  if (deltas.cpu > 0 && (limits.cpu === null || projectedUsage.cpu > limits.cpu)) {
    return { canUpgrade: false, reason: 'cpu_insufficient', message: 'CPU_INSUFFICIENT', hostId: host.id, deltas, currentUsage, projectedUsage, limits, available }
  }

  if (deltas.memory > 0 && (limits.memory === null || projectedUsage.memory > limits.memory)) {
    return { canUpgrade: false, reason: 'memory_insufficient', message: 'MEMORY_INSUFFICIENT', hostId: host.id, deltas, currentUsage, projectedUsage, limits, available }
  }

  if (deltas.disk > 0 && (limits.disk === null || projectedUsage.disk > limits.disk)) {
    return { canUpgrade: false, reason: 'disk_insufficient', message: 'DISK_INSUFFICIENT', hostId: host.id, deltas, currentUsage, projectedUsage, limits, available }
  }

  return { canUpgrade: true, reason: null, message: null, hostId: host.id, deltas, currentUsage, projectedUsage, limits, available }
}

export async function checkPlanUpgradeCapacity(
  instance: Pick<Instance, 'hostId' | 'cpu' | 'memory' | 'disk'>,
  newPlan: Pick<PackagePlan, 'cpu' | 'memory' | 'disk'>,
  client: DbClient = prisma
): Promise<PlanUpgradeCapacityCheck> {
  const [host, resourceSum] = await Promise.all([
    client.host.findUnique({
      where: { id: instance.hostId },
      select: {
        id: true,
        status: true,
        cpuUsed: true,
        memoryUsed: true,
        diskUsed: true,
        cpuAllowanceMax: true,
        memoryMax: true,
        storageSize: true
      }
    }),
    client.instance.aggregate({
      where: { hostId: instance.hostId, status: { not: 'deleted' } },
      _sum: { cpu: true, memory: true, disk: true }
    })
  ])

  return buildPlanUpgradeCapacityResult({
    instance,
    newPlan,
    host,
    aggregate: {
      cpuUsed: resourceSum._sum.cpu ?? 0,
      memoryUsed: resourceSum._sum.memory ?? 0,
      diskUsed: resourceSum._sum.disk ?? 0
    }
  })
}

export async function reservePlanUpgradeCapacityWithLock(
  tx: Prisma.TransactionClient,
  instance: Pick<Instance, 'hostId' | 'cpu' | 'memory' | 'disk'>,
  newPlan: Pick<PackagePlan, 'cpu' | 'memory' | 'disk'>
): Promise<PlanUpgradeCapacityCheck> {
  const hosts = await tx.$queryRaw<Array<{
    id: number
    status: string
    cpuUsed: number
    memoryUsed: number
    diskUsed: number
    cpuAllowanceMax: number | null
    memoryMax: number | null
    storageSize: number | null
  }>>`
    SELECT id, status, cpu_used AS "cpuUsed", memory_used AS "memoryUsed", disk_used AS "diskUsed",
           cpu_allowance_max AS "cpuAllowanceMax", memory_max AS "memoryMax", storage_size AS "storageSize"
    FROM hosts
    WHERE id = ${instance.hostId}
    FOR UPDATE
  `
  const resourceSum = await tx.instance.aggregate({
    where: { hostId: instance.hostId, status: { not: 'deleted' } },
    _sum: { cpu: true, memory: true, disk: true }
  })

  const capacity = buildPlanUpgradeCapacityResult({
    instance,
    newPlan,
    host: hosts[0] ?? null,
    aggregate: {
      cpuUsed: resourceSum._sum.cpu ?? 0,
      memoryUsed: resourceSum._sum.memory ?? 0,
      diskUsed: resourceSum._sum.disk ?? 0
    }
  })

  if (!capacity.canUpgrade) return capacity

  if (capacity.deltas.cpu !== 0 || capacity.deltas.memory !== 0 || capacity.deltas.disk !== 0) {
    await tx.host.update({
      where: { id: instance.hostId },
      data: {
        cpuUsed: Math.max(0, capacity.projectedUsage.cpu),
        memoryUsed: Math.max(0, capacity.projectedUsage.memory),
        diskUsed: Math.max(0, capacity.projectedUsage.disk)
      }
    })
  }

  return capacity
}

/**
 * 删除主机
 * 注意：在删除宿主机之前，必须先删除所有关联的记录以解除外键约�?
 */
export async function deleteHost(id: number): Promise<void> {
  // 1. 先删除所有端口映射（PortMapping 的外键到 Host �?RESTRICT�?
  await prisma.portMapping.deleteMany({
    where: { hostId: id }
  })
  
  // 2. 删除所有关联的实例记录（包括已删除状态的�?
  // 这会自动删除关联的快照、备份、端口映射等（通过 Cascade�?
  await prisma.instance.deleteMany({
    where: { hostId: id }
  })
  
  // 3. 删除宿主机（会自动删除关联的 PackageHost，因为它�?Cascade�?
  await prisma.host.delete({
    where: { id }
  })
}

/**
 * 获取主机的实例数�?
 */
export async function getInstanceCountByHost(hostId: number): Promise<number> {
  const count = await prisma.instance.count({
    where: {
      hostId,
      status: { not: 'deleted' }
    }
  })

  return count
}

/**
 * 获取主机的所有实�?
 */
export async function getInstancesByHost(hostId: number): Promise<unknown[]> {
  const instances = await prisma.instance.findMany({
    where: {
      hostId,
      status: { not: 'deleted' }
    },
    orderBy: {
      id: 'asc'
    }
  })

  return instances as unknown[]
}

/**
 * 增加宿主�?NAT 端口使用计数
 */
export async function incrementHostPortCount(hostId: number, count: number = 1): Promise<void> {
  await prisma.host.update({
    where: { id: hostId },
    data: {
      natPortsUsedCount: {
        increment: count
      }
    }
  })
}

/**
 * 减少宿主�?NAT 端口使用计数
 */
export async function decrementHostPortCount(hostId: number, count: number = 1): Promise<void> {
  // 先获取当前值，确保不会小于 0
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { natPortsUsedCount: true }
  })

  if (!host) return

  const newCount = Math.max(0, host.natPortsUsedCount - count)

  await prisma.host.update({
    where: { id: hostId },
    data: {
      natPortsUsedCount: newCount
    }
  })
}


/**
 * 智能选择可用宿主�?
 * 考虑节点组、标签选择器、资源容�?
 * 
 * 安全说明�?
 * - ownerId 参数用于限制只能在指定用户的宿主机上创建实例
 * - 当使用共享套餐时，必须传入套餐所有者的ID，确保实例只能创建在套餐所有者的宿主机上
 * 
 * 注意：NAT端口检查已移除，系统使用独立的端口映射表记录端口分�?
 */
export async function selectAvailableHost(options: {
  packageHostIds?: number[]  // 套餐绑定的宿主机ID列表
  nodeSelectors?: string[]
  cpu: number
  memory: number
  disk: number
  hostId?: number | null
  ownerId?: number  // 套餐所有者ID，用于限制只能在该用户的宿主机上创建实例
  packageId?: number | null
}): Promise<(Host & { cpu_allowance_max?: number; memory_max?: number }) | null> {
  const { packageHostIds, nodeSelectors = [], cpu, memory, disk, hostId, ownerId, packageId } = options

  // 构建查询条件
  const where: {
    status: 'online'
    id?: number | { in: number[] }
    userId?: number
    tags?: { path: string[]; array_contains: string }
  } = {
    status: 'online'
  }

  // 安全检查：用户指定�?hostId 必须在套餐绑定的宿主机列表中
  if (hostId) {
    // 如果套餐绑定了宿主机，用户指定的 hostId 必须在列表中
    if (packageHostIds && packageHostIds.length > 0) {
      if (!packageHostIds.includes(hostId)) {
        console.log(`[selectAvailableHost] 安全拒绝: hostId=${hostId} 不在套餐绑定的宿主机列表 [${packageHostIds.join(', ')}] 中`)
        return null  // 拒绝不在套餐绑定列表中的宿主�?
      }
    }
    where.id = hostId
  } else if (packageHostIds && packageHostIds.length > 0) {
    // 如果套餐绑定了宿主机，只在这些宿主机中选择
    where.id = { in: packageHostIds }
  } else if (ownerId) {
    // 套餐没有绑定宿主机时，限制只能在套餐所有者的宿主机上创建实例
    where.userId = ownerId
  }

  // 获取候选宿主机（包含实例信息用于实时计算资源使用量�?
  const hosts = await prisma.host.findMany({
    where,
    include: {
      instances: {
        where: {
          status: { not: 'deleted' }
        },
        select: {
          cpu: true,
          memory: true,
          disk: true
        }
      }
    },
    orderBy: [
      { memoryUsed: 'asc' }, // 优先选择负载较低�?
      { cpuUsed: 'asc' }
    ]
  })

  // 过滤和评�?
  for (const host of hosts) {
    // 检查标签选择�?
    if (nodeSelectors.length > 0) {
      const hostTags = (host.tags as string[]) || []
      const hasAllTags = nodeSelectors.every(tag => hostTags.includes(tag))
      if (!hasAllTags) {
        console.log(`[selectAvailableHost] 宿主�?${host.name} 不满足标签选择器要求`)
        continue
      }
    }

    // 计算资源使用�?= 关联该宿主机的实例的资源总和
    const cpuUsedCalculated = host.instances.reduce((sum, inst) => sum + inst.cpu, 0)
    const memoryUsedCalculated = host.instances.reduce((sum, inst) => sum + inst.memory, 0)
    const diskUsedCalculated = host.instances.reduce((sum, inst) => sum + inst.disk, 0)
    const cpuUsedEffective = Math.max(cpuUsedCalculated, host.cpuUsed ?? 0)
    const memoryUsedEffective = Math.max(memoryUsedCalculated, host.memoryUsed ?? 0)
    const diskUsedEffective = Math.max(diskUsedCalculated, host.diskUsed ?? 0)

    console.log(`[selectAvailableHost] 检查宿主机 ${host.name} (ID: ${host.id})`)
    console.log(`  资源使用�? CPU=${cpuUsedCalculated}%, Memory=${memoryUsedCalculated}MB, Disk=${diskUsedCalculated}MB`)
    console.log(`  请求资源: CPU=${cpu}%, Memory=${memory}MB, Disk=${disk}MB`)
    console.log(`  配额配置: cpuAllowanceMax=${host.cpuAllowanceMax}, memoryMax=${host.memoryMax}, storageSize=${host.storageSize}GB`)

    // 检�?CPU 配额
    // 剩余�?= 用户输入的CPU配额上限 - 实例资源总和
    const cpuAllowanceMax = host.cpuAllowanceMax
    if (cpuAllowanceMax != null && cpuAllowanceMax > 0) {
      // 剩余CPU配额 = cpuAllowanceMax - cpuUsedCalculated
      // 需要满足：剩余CPU配额 >= 请求的CPU
      if ((cpuUsedEffective + cpu) > cpuAllowanceMax) {
        console.log(`[selectAvailableHost] 宿主�?${host.name} CPU配额不足: ${cpuUsedEffective} + ${cpu} > ${cpuAllowanceMax}`)
        continue // CPU配额不足
      }
    } else {
      // 如果没有设置CPU配额上限，该宿主机不可用（必须设置配额）
      console.log(`[selectAvailableHost] 宿主�?${host.name} 未设置CPU配额上限`)
      continue
    }

    // 检查内存配�?
    // 剩余�?= 用户输入的内存配额上�?- 实例资源总和
    const memoryMax = host.memoryMax
    if (memoryMax != null && memoryMax > 0) {
      // 剩余内存配额 = memoryMax - memoryUsedCalculated
      // 需要满足：剩余内存配额 >= 请求的内�?
      if ((memoryUsedEffective + memory) > memoryMax) {
        console.log(`[selectAvailableHost] 宿主�?${host.name} 内存配额不足: ${memoryUsedEffective} + ${memory} > ${memoryMax}`)
        continue // 内存配额不足
      }
    } else {
      // 如果没有设置内存配额上限，该宿主机不可用（必须设置配额）
      console.log(`[selectAvailableHost] 宿主�?${host.name} 未设置内存配额上限`)
      continue
    }

    const diskTotal = host.storageSize ? host.storageSize * 1024 : 0
    if (diskTotal <= 0 || (diskUsedEffective + disk) > diskTotal) {
      console.log(`[selectAvailableHost] Host ${host.name} disk insufficient: ${diskUsedEffective} + ${disk} > ${diskTotal}`)
      continue
    }

    const storagePoolName = await resolveStoragePoolForNewInstance(host.id, { packageId })
    if (!storagePoolName) {
      console.log(`[selectAvailableHost] 宿主机 ${host.name} 未配置可用于实例系统盘的存储池`)
      continue
    }


    // NAT端口检查已移除：系统使用独立的端口映射表记录端口分配，不再限制NAT端口数量
    console.log(`[selectAvailableHost] 宿主�?${host.name} 通过所有检查，可以使用`)

    // 找到合适的宿主�?
    return {
      id: host.id,
      name: host.name,
      url: host.url,
      location: host.location,
      country_code: host.countryCode,
      status: host.status,
      cert_path: host.certPath,
      key_path: host.keyPath,
      nat_public_ip: host.natPublicIp,
      nat_port_start: host.natPortStart,
      nat_port_end: host.natPortEnd,
      cpu_used: cpuUsedEffective,  // 实例资源总和
      memory_used: memoryUsedEffective,  // 实例资源总和
      disk_total: host.storageSize ? host.storageSize * 1024 : 0,  // 只使�?storageSize（GB转MB�?
      disk_used: diskUsedEffective,  // 实例资源总和
      created_at: host.createdAt.toISOString(),
      updated_at: host.updatedAt.toISOString(),
      cpu_allowance_max: host.cpuAllowanceMax,
      memory_max: host.memoryMax,
      ipv6_mode: host.ipv6Mode,
      ipv6_subnet: host.ipv6Subnet,
      ipv6_gateway: host.ipv6Gateway,
      ipv6_parent_interface: host.ipv6ParentInterface,
      instance_type: host.instanceType  // 添加实例类型字段
    }
  }

  return null
}

/**
 * 带行锁的宿主机选择和资源预占（原子操作�?
 * 解决并发创建实例时的资源超额问题
 * 
 * 关键改进�?
 * - 使用 FOR UPDATE 行锁防止并发资源分配
 * - 在同一事务中完成资源检查和预占
 * - 基于实时计算的实例资源总和进行检�?
 * 
 * @param tx - Prisma 事务客户�?
 * @param options - 选择条件和请求的资源
 * @returns 选中的宿主机�?null
 */
export async function selectAndReserveHostWithLock(
  tx: Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
  options: {
    packageHostIds?: number[]
    nodeSelectors?: string[]
    cpu: number
    memory: number
    disk: number
    hostId?: number | null
    ownerId?: number
    portCount?: number
    packageId?: number | null
  }
): Promise<(Host & { cpu_allowance_max?: number; memory_max?: number }) | null> {
  const { packageHostIds, nodeSelectors = [], cpu, memory, disk, hostId, ownerId, portCount = 0, packageId } = options

  // 构建候选宿主机查询条件
  const whereConditions: string[] = ["status = 'online'"]
  const params: unknown[] = []
  
  if (hostId) {
    // 用户指定了特定宿主机
    if (packageHostIds && packageHostIds.length > 0 && !packageHostIds.includes(hostId)) {
      console.log(`[selectAndReserveHostWithLock] 安全拒绝: hostId=${hostId} 不在套餐绑定列表中`)
      return null
    }
    whereConditions.push(`id = $${params.length + 1}`)
    params.push(hostId)
  } else if (packageHostIds && packageHostIds.length > 0) {
    whereConditions.push(`id = ANY($${params.length + 1}::int[])`)
    params.push(packageHostIds)
  } else if (ownerId) {
    // 套餐没有绑定宿主机时，限制只能在套餐所有者的宿主机上创建实例
    whereConditions.push(`user_id = $${params.length + 1}`)
    params.push(ownerId)
  }

  // 使用 FOR UPDATE 锁定候选宿主机记录
  // 按负载排序，优先选择低负载的节点
  const lockQuery = `
    SELECT id, name, url, location, country_code, status, cert_path, key_path,
           nat_public_ip, nat_port_start, nat_port_end, 
           cpu_used, memory_used, disk_used,
           cpu_allowance_max, memory_max, storage_size,
           ipv6_mode, ipv6_subnet, ipv6_gateway, ipv6_parent_interface,
           instance_type, tags, nat_ports_used_count,
           created_at, updated_at
    FROM hosts
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY memory_used ASC, cpu_used ASC
    FOR UPDATE
  `
  
  const hosts = await tx.$queryRawUnsafe<Array<{
    id: number
    name: string
    url: string
    location: string | null
    country_code: string
    status: 'online' | 'offline' | 'maintenance'
    cert_path: string | null
    key_path: string | null
    nat_public_ip: string | null
    nat_port_start: number | null
    nat_port_end: number | null
    cpu_used: number
    memory_used: number
    disk_used: number
    cpu_allowance_max: number | null
    memory_max: number | null
    storage_size: number | null
    ipv6_mode: number
    ipv6_subnet: string | null
    ipv6_gateway: string | null
    ipv6_parent_interface: string | null
    instance_type: string
    tags: unknown
    nat_ports_used_count: number
    created_at: Date
    updated_at: Date
  }>>(lockQuery, ...params)

  console.log(`[selectAndReserveHostWithLock] 锁定 ${hosts.length} 个候选宿主机`)

  // 遍历候选宿主机，检查资源并预占
  for (const host of hosts) {
    // 检查标签选择�?
    if (nodeSelectors.length > 0) {
      const hostTags = (host.tags as string[]) || []
      const hasAllTags = nodeSelectors.every(tag => hostTags.includes(tag))
      if (!hasAllTags) {
        console.log(`[selectAndReserveHostWithLock] 宿主�?${host.name} 不满足标签选择器要求`)
        continue
      }
    }

    // 实时计算该宿主机上所有活跃实例的资源总和
    const resourceSum = await tx.instance.aggregate({
      where: {
        hostId: host.id,
        status: { not: 'deleted' }
      },
      _sum: {
        cpu: true,
        memory: true,
        disk: true
      }
    })

    const cpuUsedCalculated = resourceSum._sum.cpu ?? 0
    const memoryUsedCalculated = resourceSum._sum.memory ?? 0
    const diskUsedCalculated = resourceSum._sum.disk ?? 0
    const cpuUsedEffective = Math.max(cpuUsedCalculated, host.cpu_used ?? 0)
    const memoryUsedEffective = Math.max(memoryUsedCalculated, host.memory_used ?? 0)
    const diskUsedEffective = Math.max(diskUsedCalculated, host.disk_used ?? 0)

    console.log(`[selectAndReserveHostWithLock] 检查宿主机 ${host.name} (ID: ${host.id})`)
    console.log(`  实时资源使用�? CPU=${cpuUsedCalculated}%, Memory=${memoryUsedCalculated}MB, Disk=${diskUsedCalculated}MB`)
    console.log(`  请求资源: CPU=${cpu}%, Memory=${memory}MB, Disk=${disk}MB`)
    console.log(`  配额配置: cpuAllowanceMax=${host.cpu_allowance_max}, memoryMax=${host.memory_max}`)

    // 检�?CPU 配额
    const cpuAllowanceMax = host.cpu_allowance_max ?? 0
    if (cpuAllowanceMax <= 0) {
      console.log(`[selectAndReserveHostWithLock] 宿主�?${host.name} 未设置CPU配额上限`)
      continue
    }
    if ((cpuUsedEffective + cpu) > cpuAllowanceMax) {
      console.log(`[selectAndReserveHostWithLock] 宿主�?${host.name} CPU配额不足: ${cpuUsedEffective} + ${cpu} > ${cpuAllowanceMax}`)
      continue
    }

    // 检查内存配�?
    const memoryMax = host.memory_max ?? 0
    if (memoryMax <= 0) {
      console.log(`[selectAndReserveHostWithLock] 宿主�?${host.name} 未设置内存配额上限`)
      continue
    }
    if ((memoryUsedEffective + memory) > memoryMax) {
      console.log(`[selectAndReserveHostWithLock] 宿主�?${host.name} 内存配额不足: ${memoryUsedEffective} + ${memory} > ${memoryMax}`)
      continue
    }

    const diskTotal = host.storage_size ? host.storage_size * 1024 : 0
    if (diskTotal <= 0 || (diskUsedEffective + disk) > diskTotal) {
      console.log(`[selectAndReserveHostWithLock] Host ${host.name} disk insufficient: ${diskUsedEffective} + ${disk} > ${diskTotal}`)
      continue
    }

    const storagePoolName = await resolveStoragePoolForNewInstance(host.id, {
      packageId,
      client: tx
    })
    if (!storagePoolName) {
      console.log(`[selectAndReserveHostWithLock] 宿主机 ${host.name} 未配置可用于实例系统盘的存储池`)
      continue
    }

    // 检�?NAT 端口配额（如果需要）
    if (portCount > 0) {
      const natPortsTotal = (host.nat_port_start && host.nat_port_end) 
        ? (host.nat_port_end - host.nat_port_start + 1) 
        : 0
      if (host.nat_ports_used_count + portCount > natPortsTotal) {
        console.log(`[selectAndReserveHostWithLock] 宿主�?${host.name} NAT端口不足`)
        continue
      }
    }

    console.log(`[selectAndReserveHostWithLock] 宿主�?${host.name} 通过检查，执行资源预占`)

    // 资源检查通过，更新宿主机资源使用量（在同一事务中原子执行）
    await tx.host.update({
      where: { id: host.id },
      data: {
        cpuUsed: cpuUsedEffective + cpu,
        memoryUsed: memoryUsedEffective + memory,
        diskUsed: diskUsedEffective + disk,
        ...(portCount > 0 ? { natPortsUsedCount: host.nat_ports_used_count + portCount } : {})
      }
    })

    console.log(`[selectAndReserveHostWithLock] 资源预占成功: ${host.name}`)

    // 返回选中的宿主机
    return {
      id: host.id,
      name: host.name,
      url: host.url,
      location: host.location,
      country_code: host.country_code,
      status: host.status,
      cert_path: host.cert_path,
      key_path: host.key_path,
      nat_public_ip: host.nat_public_ip,
      nat_port_start: host.nat_port_start,
      nat_port_end: host.nat_port_end,
      cpu_used: cpuUsedEffective + cpu,
      memory_used: memoryUsedEffective + memory,
      disk_used: diskUsedEffective + disk,
      created_at: host.created_at.toISOString(),
      updated_at: host.updated_at.toISOString(),
      cpu_allowance_max: host.cpu_allowance_max ?? undefined,
      memory_max: host.memory_max ?? undefined,
      ipv6_mode: host.ipv6_mode,
      ipv6_subnet: host.ipv6_subnet,
      ipv6_gateway: host.ipv6_gateway,
      ipv6_parent_interface: host.ipv6_parent_interface,
      instance_type: host.instance_type as 'container' | 'vm' | 'both'
    }
  }

  console.log(`[selectAndReserveHostWithLock] 没有可用的宿主机`)
  return null
}
