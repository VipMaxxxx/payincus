/**
 * 套餐相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import { Prisma, type InstanceStatus } from '@prisma/client'
import type { Package } from '../types/database.js'
import { normalizeTrafficMultiplier } from '../lib/traffic-multiplier.js'

const NORMAL_PACKAGE_INSTANCE_STATUSES: InstanceStatus[] = ['running', 'stopped']
const PACKAGE_PREREQUISITE_LOCK_NAMESPACE = 4201

async function acquirePackagePrerequisiteLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
    WITH acquired_lock AS (
      SELECT pg_advisory_xact_lock(${PACKAGE_PREREQUISITE_LOCK_NAMESPACE}, 1)
    )
    SELECT true AS locked FROM acquired_lock
  `)
}

type PackagePrerequisiteValidationResult =
  | { valid: true }
  | { valid: false; code: string; message: string }

function buildHostStoragePoolMap(packageHosts: Array<{ hostId: number; storagePoolName: string | null }>): Record<string, string | null> {
  return Object.fromEntries(packageHosts.map(ph => [String(ph.hostId), ph.storagePoolName ?? null]))
}

function buildHostTrafficMultiplierMap(packageHosts: Array<{ hostId: number; trafficMultiplier: unknown }>): Record<string, number> {
  return Object.fromEntries(packageHosts.map(ph => [String(ph.hostId), normalizeTrafficMultiplier(ph.trafficMultiplier)]))
}

function normalizeHostStoragePools(hostStoragePools?: Record<string, string | null>): Record<number, string | null> {
  const normalized: Record<number, string | null> = {}

  if (!hostStoragePools) {
    return normalized
  }

  for (const [hostIdKey, poolName] of Object.entries(hostStoragePools)) {
    const hostId = Number(hostIdKey)
    if (Number.isNaN(hostId)) {
      throw new Error(`Invalid hostStoragePools key: ${hostIdKey}`)
    }

    const trimmedPoolName = typeof poolName === 'string' ? poolName.trim() : null
    normalized[hostId] = trimmedPoolName ? trimmedPoolName : null
  }

  return normalized
}

function normalizeHostTrafficMultipliers(hostTrafficMultipliers?: Record<string, number | string | null>): Record<number, number> {
  const normalized: Record<number, number> = {}

  if (!hostTrafficMultipliers) {
    return normalized
  }

  for (const [hostIdKey, multiplier] of Object.entries(hostTrafficMultipliers)) {
    const hostId = Number(hostIdKey)
    if (Number.isNaN(hostId)) {
      throw new Error(`Invalid hostTrafficMultipliers key: ${hostIdKey}`)
    }

    normalized[hostId] = normalizeTrafficMultiplier(multiplier)
  }

  return normalized
}

async function validateHostStoragePools(
  hostIds: number[],
  hostStoragePools: Record<number, string | null>,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  const allowedHostIds = new Set(hostIds)

  for (const hostIdKey of Object.keys(hostStoragePools)) {
    const hostId = Number(hostIdKey)
    if (!allowedHostIds.has(hostId)) {
      throw new Error(`Storage pool mapping references an unbound host: ${hostId}`)
    }
  }

  const requestedPools = Object.entries(hostStoragePools)
    .filter(([, poolName]) => !!poolName)
    .map(([hostId, poolName]) => ({
      hostId: Number(hostId),
      name: poolName as string
    }))

  if (requestedPools.length === 0) {
    return
  }

  const matchedPools = await client.storagePool.findMany({
    where: {
      OR: requestedPools.map(pool => ({
        hostId: pool.hostId,
        name: pool.name,
        purpose: 'instance_data'
      }))
    },
    select: {
      hostId: true,
      name: true
    }
  })

  const matchedPoolSet = new Set(matchedPools.map(pool => `${pool.hostId}:${pool.name}`))
  const invalidPool = requestedPools.find(pool => !matchedPoolSet.has(`${pool.hostId}:${pool.name}`))
  if (invalidPool) {
    throw new Error(`Storage pool "${invalidPool.name}" is not available as a system disk pool on host ${invalidPool.hostId}`)
  }
}

function validateHostTrafficMultipliers(
  hostIds: number[],
  hostTrafficMultipliers: Record<number, number>
): void {
  const allowedHostIds = new Set(hostIds)

  for (const hostIdKey of Object.keys(hostTrafficMultipliers)) {
    const hostId = Number(hostIdKey)
    if (!allowedHostIds.has(hostId)) {
      throw new Error(`Traffic multiplier mapping references an unbound host: ${hostId}`)
    }
  }
}

/**
 * 获取用户自己的套餐列表
 * 注意：共享套餐通过 package-shares.ts 的 getSharedToUser 获取
 * @param activeOnly - 是否只返回启用的套餐
 * @param options.userId - 如果提供，只返回用户自己的套餐
 * @param options.excludeUserId - 排除指定用户的套餐（用于获取托管套餐）
 * @param options.ownerRole - 按所有者角色过滤套餐
 * @param options.includeOwnerEmail - 是否包含所有者邮箱
 */
export async function getAllPackages(
  activeOnly: boolean = false,
  options: {
    userId?: number
    excludeUserId?: number
    ownerRole?: 'admin' | 'user'
    includeOwnerEmail?: boolean
  } = {}
): Promise<Array<Package & {
  user_id?: number
  owner_username?: string
  owner_email?: string | null
  owner_avatar_style?: string
  is_own?: boolean
  host_ids?: number[]
  host_storage_pools?: Record<string, string | null>
  host_traffic_multipliers?: Record<string, number>
}>> {
  const { userId, excludeUserId, ownerRole, includeOwnerEmail = false } = options

  // 构建查询条件
  const whereCondition: any = {}

  if (activeOnly) {
    whereCondition.active = true
  }

  // 只返回用户自己的套餐
  if (userId) {
    whereCondition.userId = userId
  }

  // 排除指定用户的套餐
  if (excludeUserId) {
    whereCondition.userId = { not: excludeUserId }
  }

  // 按所有者角色过滤套餐
  if (ownerRole) {
    whereCondition.user = { role: ownerRole }
  }

  const packages = await prisma.package.findMany({
    where: Object.keys(whereCondition).length > 0 ? whereCondition : undefined,
    include: {
      packageHosts: {
        select: {
          hostId: true,
          storagePoolName: true,
          trafficMultiplier: true
        }
      },
      user: {
        select: {
          id: true,
          username: true,
          ...(includeOwnerEmail && { email: true, avatarStyle: true, avatarBadgeId: true })
        }
      },
      requiredPackage: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      id: 'asc'
    }
  })

  return packages.map(pkg => ({
    id: pkg.id,
    user_id: pkg.userId,
    name: pkg.name,
    description: pkg.description,
    cpu_max: pkg.cpuMax,
    memory_max: pkg.memoryMax,
    disk_max: pkg.diskMax,
    bandwidth_max: pkg.bandwidthMax,
    network_mode: pkg.networkMode,
    instance_type: pkg.instanceType,
    privileged: pkg.privileged ? 1 : 0,
    nested: pkg.nested ? 1 : 0,
    active: pkg.active ? 1 : 0,
    // 套餐资源限制
    port_limit: pkg.portLimit,
    snapshot_limit: pkg.snapshotLimit,
    backup_limit: pkg.backupLimit,
    site_limit: pkg.siteLimit,
    monthly_traffic_limit: pkg.monthlyTrafficLimit?.toString() ?? null,
    // 存储 I/O 限制
    io_limit_mode: pkg.ioLimitMode,
    limits_read: pkg.limitsRead,
    limits_write: pkg.limitsWrite,
    limits_read_iops: pkg.limitsReadIops,
    limits_write_iops: pkg.limitsWriteIops,
    // 网络限制
    limits_ingress: pkg.limitsIngress,
    limits_egress: pkg.limitsEgress,
    // 进程与调度
    limits_processes: pkg.limitsProcesses,
    limits_cpu_priority: pkg.limitsCpuPriority,
    // 启动配置
    boot_autostart: pkg.bootAutostart,
    boot_autostart_priority: pkg.bootAutostartPriority,
    boot_autostart_delay: pkg.bootAutostartDelay,
    boot_host_shutdown_timeout: pkg.bootHostShutdownTimeout,
    global_shared: (pkg as any).globalShared ?? false,
    global_quota_multiplier: (pkg as any).globalQuotaMultiplier ? Number((pkg as any).globalQuotaMultiplier) : ((pkg as any).globalQuotaMultiplier === null ? null : undefined),
    global_max_instances: (pkg as any).globalMaxInstances !== null && (pkg as any).globalMaxInstances !== undefined ? (pkg as any).globalMaxInstances : undefined,
    required_package_id: (pkg as any).requiredPackageId ?? null,
    required_package_name: (pkg as any).requiredPackage?.name ?? null,
    allow_instance_deletion: (pkg as any).allowInstanceDeletion ?? true,
    created_at: pkg.createdAt.toISOString(),
    owner_username: pkg.user?.username,
    owner_email: includeOwnerEmail ? (pkg.user as any)?.email : undefined,
    owner_avatar_style: includeOwnerEmail ? (pkg.user as any)?.avatarStyle : undefined,
    owner_avatar_badge_id: includeOwnerEmail ? (pkg.user as any)?.avatarBadgeId : undefined,
    is_own: true,  // 这个函数只返回自己的套餐
    host_ids: pkg.packageHosts.map(ph => ph.hostId),  // 绑定的宿主机ID列表
    host_storage_pools: buildHostStoragePoolMap(pkg.packageHosts),
    host_traffic_multipliers: buildHostTrafficMultiplierMap(pkg.packageHosts)
  }))
}

/**
 * 根据 ID 获取套餐
 */
export async function getPackageById(id: number): Promise<(Package & { host_ids?: number[]; host_storage_pools?: Record<string, string | null>; host_traffic_multipliers?: Record<string, number> }) | null> {
  const pkg = await prisma.package.findUnique({
    where: { id },
    include: {
      packageHosts: {
        select: {
          hostId: true,
          storagePoolName: true,
          trafficMultiplier: true
        }
      },
      requiredPackage: {
        select: {
          id: true,
          name: true
        }
      }
    }
  })

  if (!pkg) return null

  return {
    id: pkg.id,
    user_id: pkg.userId,
    name: pkg.name,
    description: pkg.description,
    cpu_max: pkg.cpuMax,
    memory_max: pkg.memoryMax,
    disk_max: pkg.diskMax,
    bandwidth_max: pkg.bandwidthMax,
    network_mode: pkg.networkMode,
    instance_type: pkg.instanceType,
    privileged: pkg.privileged ? 1 : 0,
    nested: pkg.nested ? 1 : 0,
    active: pkg.active ? 1 : 0,
    // 套餐资源限制
    port_limit: pkg.portLimit,
    snapshot_limit: pkg.snapshotLimit,
    backup_limit: pkg.backupLimit,
    site_limit: pkg.siteLimit,
    monthly_traffic_limit: pkg.monthlyTrafficLimit?.toString() ?? null,
    // 存储 I/O 限制
    io_limit_mode: pkg.ioLimitMode,
    limits_read: pkg.limitsRead,
    limits_write: pkg.limitsWrite,
    limits_read_iops: pkg.limitsReadIops,
    limits_write_iops: pkg.limitsWriteIops,
    // 网络限制
    limits_ingress: pkg.limitsIngress,
    limits_egress: pkg.limitsEgress,
    // 进程与调度
    limits_processes: pkg.limitsProcesses,
    limits_cpu_priority: pkg.limitsCpuPriority,
    // 启动配置
    boot_autostart: pkg.bootAutostart,
    boot_autostart_priority: pkg.bootAutostartPriority,
    boot_autostart_delay: pkg.bootAutostartDelay,
    boot_host_shutdown_timeout: pkg.bootHostShutdownTimeout,
    global_shared: pkg.globalShared ?? false,
    global_quota_multiplier: pkg.globalQuotaMultiplier ? Number(pkg.globalQuotaMultiplier) : (pkg.globalQuotaMultiplier === null ? null : undefined),
    global_max_instances: pkg.globalMaxInstances !== null && pkg.globalMaxInstances !== undefined ? pkg.globalMaxInstances : undefined,
    required_package_id: pkg.requiredPackageId ?? null,
    required_package_name: pkg.requiredPackage?.name ?? null,
    allow_instance_deletion: pkg.allowInstanceDeletion,
    created_at: pkg.createdAt.toISOString(),
    host_ids: pkg.packageHosts.map(ph => ph.hostId),  // 绑定的宿主机ID列表
    host_storage_pools: buildHostStoragePoolMap(pkg.packageHosts),
    host_traffic_multipliers: buildHostTrafficMultiplierMap(pkg.packageHosts)
  }
}

/**
 * 根据名称获取套餐
 */
export async function getPackageByName(name: string): Promise<Package | null> {
  const pkg = await prisma.package.findFirst({
    where: { name }
  })

  if (!pkg) return null

  return {
    id: pkg.id,
    user_id: pkg.userId,
    name: pkg.name,
    description: pkg.description,
    cpu_max: pkg.cpuMax,
    memory_max: pkg.memoryMax,
    disk_max: pkg.diskMax,
    bandwidth_max: pkg.bandwidthMax,
    network_mode: pkg.networkMode,
    instance_type: pkg.instanceType,
    privileged: pkg.privileged ? 1 : 0,
    nested: pkg.nested ? 1 : 0,
    active: pkg.active ? 1 : 0,
    // 套餐资源限制
    port_limit: pkg.portLimit,
    snapshot_limit: pkg.snapshotLimit,
    backup_limit: pkg.backupLimit,
    site_limit: pkg.siteLimit,
    monthly_traffic_limit: pkg.monthlyTrafficLimit?.toString() ?? null,
    // 存储 I/O 限制
    io_limit_mode: pkg.ioLimitMode,
    limits_read: pkg.limitsRead,
    limits_write: pkg.limitsWrite,
    limits_read_iops: pkg.limitsReadIops,
    limits_write_iops: pkg.limitsWriteIops,
    // 网络限制
    limits_ingress: pkg.limitsIngress,
    limits_egress: pkg.limitsEgress,
    // 进程与调度
    limits_processes: pkg.limitsProcesses,
    limits_cpu_priority: pkg.limitsCpuPriority,
    // 启动配置
    boot_autostart: pkg.bootAutostart,
    boot_autostart_priority: pkg.bootAutostartPriority,
    boot_autostart_delay: pkg.bootAutostartDelay,
    boot_host_shutdown_timeout: pkg.bootHostShutdownTimeout,
    required_package_id: pkg.requiredPackageId ?? null,
    allow_instance_deletion: pkg.allowInstanceDeletion,
    created_at: pkg.createdAt.toISOString()
  }
}

/**
 * 根据用户ID和名称获取套餐（同一用户下名称唯一）
 */
export async function getPackageByUserAndName(userId: number, name: string): Promise<Package | null> {
  const pkg = await prisma.package.findUnique({
    where: { userId_name: { userId, name } }
  })

  if (!pkg) return null

  return {
    id: pkg.id,
    user_id: pkg.userId,
    name: pkg.name,
    description: pkg.description,
    cpu_max: pkg.cpuMax,
    memory_max: pkg.memoryMax,
    disk_max: pkg.diskMax,
    bandwidth_max: pkg.bandwidthMax,
    network_mode: pkg.networkMode,
    instance_type: pkg.instanceType,
    privileged: pkg.privileged ? 1 : 0,
    nested: pkg.nested ? 1 : 0,
    active: pkg.active ? 1 : 0,
    port_limit: pkg.portLimit,
    snapshot_limit: pkg.snapshotLimit,
    backup_limit: pkg.backupLimit,
    site_limit: pkg.siteLimit,
    monthly_traffic_limit: pkg.monthlyTrafficLimit?.toString() ?? null,
    // 存储 I/O 限制
    io_limit_mode: pkg.ioLimitMode,
    limits_read: pkg.limitsRead,
    limits_write: pkg.limitsWrite,
    limits_read_iops: pkg.limitsReadIops,
    limits_write_iops: pkg.limitsWriteIops,
    // 网络限制
    limits_ingress: pkg.limitsIngress,
    limits_egress: pkg.limitsEgress,
    // 进程与调度
    limits_processes: pkg.limitsProcesses,
    limits_cpu_priority: pkg.limitsCpuPriority,
    // 启动配置
    boot_autostart: pkg.bootAutostart,
    boot_autostart_priority: pkg.bootAutostartPriority,
    boot_autostart_delay: pkg.bootAutostartDelay,
    boot_host_shutdown_timeout: pkg.bootHostShutdownTimeout,
    required_package_id: pkg.requiredPackageId ?? null,
    allow_instance_deletion: pkg.allowInstanceDeletion,
    created_at: pkg.createdAt.toISOString()
  }
}

/**
 * 创建套餐
 * @param hostIds 必须至少绑定一个宿主机
 */
export async function createPackage(data: {
  userId: number  // 所有者
  name: string
  description?: string | null
  cpuMax: number
  memoryMax: number
  diskMax: number
  bandwidthMax?: number | null
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  instanceType?: 'container' | 'vm'  // 实例类型
  hostIds: number[]  // 必须至少绑定一个宿主机
  hostStoragePools?: Record<string, string | null>
  hostTrafficMultipliers?: Record<string, number | string | null>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  // 套餐资源限制
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  monthlyTrafficLimit?: bigint | null
  // 存储 I/O 限制
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  // 网络限制
  limitsIngress?: string
  limitsEgress?: string
  // 进程与调度
  limitsProcesses?: number
  limitsCpuPriority?: number
  // 启动配置
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  // 全局共享配置
  globalShared?: boolean
  globalQuotaMultiplier?: number | null
  globalMaxInstances?: number | null
  requiredPackageId?: number | null
  // 实例操作权限
  allowInstanceDeletion?: boolean
}, isAdmin?: boolean): Promise<number> {
  if (data.requiredPackageId !== null && data.requiredPackageId !== undefined) {
    return prisma.$transaction(async tx => {
      await acquirePackagePrerequisiteLock(tx)

      const prerequisiteValidation = await validatePackagePrerequisiteReferenceWithClient(
        tx,
        null,
        data.requiredPackageId,
        data.userId
      )
      if (!prerequisiteValidation.valid) {
        throw new Error(`${prerequisiteValidation.code}: ${prerequisiteValidation.message}`)
      }

      return createPackageUnchecked(data, isAdmin, tx)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    })
  }

  return createPackageUnchecked(data, isAdmin, prisma)
}

async function createPackageUnchecked(data: {
  userId: number
  name: string
  description?: string | null
  cpuMax: number
  memoryMax: number
  diskMax: number
  bandwidthMax?: number | null
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  instanceType?: 'container' | 'vm'
  hostIds: number[]
  hostStoragePools?: Record<string, string | null>
  hostTrafficMultipliers?: Record<string, number | string | null>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  monthlyTrafficLimit?: bigint | null
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  limitsIngress?: string
  limitsEgress?: string
  limitsProcesses?: number
  limitsCpuPriority?: number
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  globalShared?: boolean
  globalQuotaMultiplier?: number | null
  globalMaxInstances?: number | null
  requiredPackageId?: number | null
  allowInstanceDeletion?: boolean
}, isAdmin: boolean | undefined, client: Prisma.TransactionClient | typeof prisma): Promise<number> {
  // 验证必须至少绑定一个宿主机
  if (!data.hostIds || data.hostIds.length === 0) {
    throw new Error('Package must bind at least one host')
  }

  // 验证所有宿主机都存在
  // 管理员可以绑定任何节点，普通用户只能绑定自己的节点
  const hostsWhere = isAdmin 
    ? { id: { in: data.hostIds } }
    : { id: { in: data.hostIds }, userId: data.userId }
  
  const hosts = await client.host.findMany({ where: hostsWhere })

  if (hosts.length !== data.hostIds.length) {
    throw new Error(isAdmin ? 'Some hosts do not exist' : 'All hosts must belong to the package owner')
  }

  const normalizedHostStoragePools = normalizeHostStoragePools(data.hostStoragePools)
  const normalizedHostTrafficMultipliers = normalizeHostTrafficMultipliers(data.hostTrafficMultipliers)
  await validateHostStoragePools(data.hostIds, normalizedHostStoragePools, client)
  validateHostTrafficMultipliers(data.hostIds, normalizedHostTrafficMultipliers)

  const pkg = await client.package.create({
    data: {
      userId: data.userId,
      name: data.name,
      description: data.description ?? null,
      cpuMax: data.cpuMax,
      memoryMax: data.memoryMax,
      diskMax: data.diskMax,
      bandwidthMax: data.bandwidthMax ?? null,
      networkMode: data.networkMode ?? 'nat',
      instanceType: data.instanceType ?? 'container',
      privileged: data.privileged ?? false,
      nested: data.nested ?? false,
      active: data.active !== false,
      // 套餐资源限制
      portLimit: data.portLimit ?? 20,
      snapshotLimit: data.snapshotLimit ?? 5,
      backupLimit: data.backupLimit ?? 3,
      siteLimit: data.siteLimit ?? 10,
      monthlyTrafficLimit: data.monthlyTrafficLimit ?? null,
      // 存储 I/O 限制 (使用默认值如果未提供)
      ioLimitMode: data.ioLimitMode ?? 'throughput',
      limitsRead: data.limitsRead ?? '100MB',
      limitsWrite: data.limitsWrite ?? '100MB',
      limitsReadIops: data.limitsReadIops ?? 500,
      limitsWriteIops: data.limitsWriteIops ?? 500,
      // 网络限制
      limitsIngress: data.limitsIngress ?? '300Mbit',
      limitsEgress: data.limitsEgress ?? '300Mbit',
      // 进程与调度
      limitsProcesses: data.limitsProcesses ?? 500,
      limitsCpuPriority: data.limitsCpuPriority ?? 10,
      // 启动配置
      bootAutostart: data.bootAutostart ?? true,
      bootAutostartPriority: data.bootAutostartPriority ?? 20,
      bootAutostartDelay: data.bootAutostartDelay ?? 15,
      bootHostShutdownTimeout: data.bootHostShutdownTimeout ?? 30,
      // 全局共享配置
      globalShared: data.globalShared ?? false,
      globalQuotaMultiplier: data.globalQuotaMultiplier ?? null,
      globalMaxInstances: data.globalMaxInstances ?? null,
      requiredPackageId: data.requiredPackageId ?? null,
      // 实例操作权限
      allowInstanceDeletion: data.allowInstanceDeletion ?? true,
      // 绑定宿主机
      packageHosts: {
        create: data.hostIds.map(hostId => ({
          hostId,
          storagePoolName: hostId in normalizedHostStoragePools ? normalizedHostStoragePools[hostId] : null,
          trafficMultiplier: hostId in normalizedHostTrafficMultipliers ? normalizedHostTrafficMultipliers[hostId] : 1
        }))
      }
    }
  })

  return pkg.id
}

/**
 * 更新套餐
 * @param hostIds 如果提供，将更新绑定的宿主机（必须至少一个）
 */
export async function updatePackage(id: number, data: {
  name?: string
  description?: string | null
  cpuMax?: number
  memoryMax?: number
  diskMax?: number
  bandwidthMax?: number | null
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  instanceType?: 'container' | 'vm'  // 实例类型
  hostIds?: number[]  // 如果提供，将更新绑定的宿主机
  hostStoragePools?: Record<string, string | null>
  hostTrafficMultipliers?: Record<string, number | string | null>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  // 套餐资源限制
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  monthlyTrafficLimit?: bigint | null
  // 存储 I/O 限制
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  // 网络限制
  limitsIngress?: string
  limitsEgress?: string
  // 进程与调度
  limitsProcesses?: number
  limitsCpuPriority?: number
    // 启动配置
    bootAutostart?: boolean
    bootAutostartPriority?: number
    bootAutostartDelay?: number
    bootHostShutdownTimeout?: number
    // 全局共享配置
    globalShared?: boolean
    globalQuotaMultiplier?: number | null
    globalMaxInstances?: number | null
    requiredPackageId?: number | null
    // 实例操作权限
    allowInstanceDeletion?: boolean
}, isAdmin?: boolean): Promise<void> {
  if (data.requiredPackageId !== undefined) {
    await prisma.$transaction(async tx => {
      await acquirePackagePrerequisiteLock(tx)

      const pkg = await tx.package.findUnique({
        where: { id },
        select: { userId: true }
      })
      if (!pkg) {
        throw new Error('Package not found')
      }

      const prerequisiteValidation = await validatePackagePrerequisiteReferenceWithClient(
        tx,
        id,
        data.requiredPackageId,
        pkg.userId
      )
      if (!prerequisiteValidation.valid) {
        throw new Error(`${prerequisiteValidation.code}: ${prerequisiteValidation.message}`)
      }

      await updatePackageUnchecked(id, data, isAdmin, tx)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    })
    return
  }

  await updatePackageUnchecked(id, data, isAdmin, prisma)
}

async function updatePackageUnchecked(id: number, data: {
  name?: string
  description?: string | null
  cpuMax?: number
  memoryMax?: number
  diskMax?: number
  bandwidthMax?: number | null
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  instanceType?: 'container' | 'vm'
  hostIds?: number[]
  hostStoragePools?: Record<string, string | null>
  hostTrafficMultipliers?: Record<string, number | string | null>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  monthlyTrafficLimit?: bigint | null
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  limitsIngress?: string
  limitsEgress?: string
  limitsProcesses?: number
  limitsCpuPriority?: number
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  globalShared?: boolean
  globalQuotaMultiplier?: number | null
  globalMaxInstances?: number | null
  requiredPackageId?: number | null
  allowInstanceDeletion?: boolean
}, isAdmin: boolean | undefined, client: Prisma.TransactionClient | typeof prisma): Promise<void> {
  const updateData: {
    name?: string
    description?: string | null
    cpuMax?: number
    memoryMax?: number
    diskMax?: number
    bandwidthMax?: number | null
    networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
    instanceType?: 'container' | 'vm'
    privileged?: boolean
    nested?: boolean
    active?: boolean
    portLimit?: number
    snapshotLimit?: number
    backupLimit?: number
    siteLimit?: number
    monthlyTrafficLimit?: bigint | null
    // 存储 I/O 限制
    ioLimitMode?: 'throughput' | 'iops'
    limitsRead?: string
    limitsWrite?: string
    limitsReadIops?: number
    limitsWriteIops?: number
    // 网络限制
    limitsIngress?: string
    limitsEgress?: string
    // 进程与调度
    limitsProcesses?: number
    limitsCpuPriority?: number
    // 启动配置
    bootAutostart?: boolean
    bootAutostartPriority?: number
    bootAutostartDelay?: number
    bootHostShutdownTimeout?: number
    // 全局共享配置
    globalShared?: boolean
    globalQuotaMultiplier?: number | null
    globalMaxInstances?: number | null
    requiredPackageId?: number | null
    // 实例操作权限
    allowInstanceDeletion?: boolean
  } = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.description !== undefined) updateData.description = data.description ?? null
  if (data.cpuMax !== undefined) updateData.cpuMax = data.cpuMax
  if (data.memoryMax !== undefined) updateData.memoryMax = data.memoryMax
  if (data.diskMax !== undefined) updateData.diskMax = data.diskMax
  if (data.bandwidthMax !== undefined) updateData.bandwidthMax = data.bandwidthMax ?? null
  if (data.networkMode !== undefined) updateData.networkMode = data.networkMode
  if (data.instanceType !== undefined) updateData.instanceType = data.instanceType
  if (data.privileged !== undefined) updateData.privileged = data.privileged
  if (data.nested !== undefined) updateData.nested = data.nested
  if (data.active !== undefined) updateData.active = data.active
  // 套餐资源限制
  if (data.portLimit !== undefined) updateData.portLimit = data.portLimit
  if (data.snapshotLimit !== undefined) updateData.snapshotLimit = data.snapshotLimit
  if (data.backupLimit !== undefined) updateData.backupLimit = data.backupLimit
  if (data.siteLimit !== undefined) updateData.siteLimit = data.siteLimit
  if (data.monthlyTrafficLimit !== undefined) updateData.monthlyTrafficLimit = data.monthlyTrafficLimit
  // 存储 I/O 限制
  if (data.ioLimitMode !== undefined) updateData.ioLimitMode = data.ioLimitMode
  if (data.limitsRead !== undefined) updateData.limitsRead = data.limitsRead
  if (data.limitsWrite !== undefined) updateData.limitsWrite = data.limitsWrite
  if (data.limitsReadIops !== undefined) updateData.limitsReadIops = data.limitsReadIops
  if (data.limitsWriteIops !== undefined) updateData.limitsWriteIops = data.limitsWriteIops
  // 网络限制
  if (data.limitsIngress !== undefined) updateData.limitsIngress = data.limitsIngress
  if (data.limitsEgress !== undefined) updateData.limitsEgress = data.limitsEgress
  // 进程与调度
  if (data.limitsProcesses !== undefined) updateData.limitsProcesses = data.limitsProcesses
  if (data.limitsCpuPriority !== undefined) updateData.limitsCpuPriority = data.limitsCpuPriority
  // 启动配置
  if (data.bootAutostart !== undefined) updateData.bootAutostart = data.bootAutostart
  if (data.bootAutostartPriority !== undefined) updateData.bootAutostartPriority = data.bootAutostartPriority
  if (data.bootAutostartDelay !== undefined) updateData.bootAutostartDelay = data.bootAutostartDelay
  if (data.bootHostShutdownTimeout !== undefined) updateData.bootHostShutdownTimeout = data.bootHostShutdownTimeout
  if (data.globalShared !== undefined) updateData.globalShared = data.globalShared
  if (data.globalQuotaMultiplier !== undefined) updateData.globalQuotaMultiplier = data.globalQuotaMultiplier
  if (data.globalMaxInstances !== undefined) updateData.globalMaxInstances = data.globalMaxInstances
  if (data.requiredPackageId !== undefined) updateData.requiredPackageId = data.requiredPackageId
  if (data.allowInstanceDeletion !== undefined) updateData.allowInstanceDeletion = data.allowInstanceDeletion

  const needsPackageHostUpdate = data.hostIds !== undefined || data.hostStoragePools !== undefined || data.hostTrafficMultipliers !== undefined
  if (needsPackageHostUpdate) {
    const pkg = await client.package.findUnique({
      where: { id },
      select: {
        userId: true,
        packageHosts: {
          select: {
            hostId: true,
            storagePoolName: true,
            trafficMultiplier: true
          }
        }
      }
    })

    if (!pkg) {
      throw new Error('Package not found')
    }

    const currentHostStoragePools = new Map(pkg.packageHosts.map(ph => [ph.hostId, ph.storagePoolName ?? null]))
    const currentHostTrafficMultipliers = new Map(pkg.packageHosts.map(ph => [ph.hostId, normalizeTrafficMultiplier(ph.trafficMultiplier)]))
    const effectiveHostIds = data.hostIds ?? pkg.packageHosts.map(ph => ph.hostId)

    if (effectiveHostIds.length === 0) {
      throw new Error('Package must bind at least one host')
    }

    if (data.hostIds !== undefined) {
      const hostsWhere = isAdmin
        ? { id: { in: effectiveHostIds } }
        : { id: { in: effectiveHostIds }, userId: pkg.userId }

      const hosts = await client.host.findMany({ where: hostsWhere })
      if (hosts.length !== effectiveHostIds.length) {
        throw new Error(isAdmin ? 'Some hosts do not exist' : 'All hosts must belong to the package owner')
      }
    }

    const normalizedHostStoragePools = normalizeHostStoragePools(data.hostStoragePools)
    const normalizedHostTrafficMultipliers = normalizeHostTrafficMultipliers(data.hostTrafficMultipliers)
    await validateHostStoragePools(effectiveHostIds, normalizedHostStoragePools, client)
    validateHostTrafficMultipliers(effectiveHostIds, normalizedHostTrafficMultipliers)

    if (data.hostIds !== undefined) {
      await client.packageHost.deleteMany({
        where: { packageId: id }
      })

      await client.packageHost.createMany({
        data: effectiveHostIds.map(hostId => ({
          packageId: id,
          hostId,
          storagePoolName: hostId in normalizedHostStoragePools
            ? normalizedHostStoragePools[hostId]
            : (currentHostStoragePools.get(hostId) ?? null),
          trafficMultiplier: hostId in normalizedHostTrafficMultipliers
            ? normalizedHostTrafficMultipliers[hostId]
            : (currentHostTrafficMultipliers.get(hostId) ?? 1)
        }))
      })
    } else {
      for (const [hostIdKey, storagePoolName] of Object.entries(normalizedHostStoragePools)) {
        await client.packageHost.update({
          where: {
            packageId_hostId: {
              packageId: id,
              hostId: Number(hostIdKey)
            }
          },
          data: {
            storagePoolName
          }
        })
      }
      for (const [hostIdKey, trafficMultiplier] of Object.entries(normalizedHostTrafficMultipliers)) {
        await client.packageHost.update({
          where: {
            packageId_hostId: {
              packageId: id,
              hostId: Number(hostIdKey)
            }
          },
          data: {
            trafficMultiplier
          }
        })
      }
    }
  }

  if (Object.keys(updateData).length > 0) {
    await client.package.update({
      where: { id },
      data: updateData
    })
  }
}

/**
 * 获取套餐绑定的宿主机ID列表
 */
export async function getPackageHostIds(packageId: number): Promise<number[]> {
  const packageHosts = await prisma.packageHost.findMany({
    where: { packageId },
    select: { hostId: true }
  })

  return packageHosts.map(ph => ph.hostId)
}

/**
 * 删除套餐
 */
export async function deletePackage(id: number): Promise<void> {
  await prisma.package.delete({
    where: { id }
  })
}

/**
 * 获取套餐的实例数量
 */
export async function getInstanceCountByPackage(packageId: number): Promise<number> {
  const count = await prisma.instance.count({
    where: {
      packageId,
      status: { not: 'deleted' }
    }
  })

  return count
}

/**
 * 批量获取套餐下的正常实例数量。
 * 正常实例只包含 running/stopped；error/deleted/creating/suspended 不统计。
 * 统计范围包含直接绑定套餐的实例，以及历史数据中仅绑定套餐方案的实例。
 */
export async function getNormalInstanceCountsByPackages(packageIds: number[]): Promise<Map<number, number>> {
  const validPackageIds = Array.from(new Set(
    packageIds.filter(id => Number.isInteger(id) && id > 0)
  ))

  if (validPackageIds.length === 0) {
    return new Map()
  }

  const plans = await prisma.packagePlan.findMany({
    where: { packageId: { in: validPackageIds } },
    select: { id: true, packageId: true }
  })
  const planPackageMap = new Map(plans.map(plan => [plan.id, plan.packageId]))
  const planIds = plans.map(plan => plan.id)

  const [directRows, planOnlyRows] = await Promise.all([
    prisma.instance.groupBy({
      by: ['packageId'],
      where: {
        packageId: { in: validPackageIds },
        status: { in: NORMAL_PACKAGE_INSTANCE_STATUSES }
      },
      _count: { id: true }
    }),
    planIds.length > 0
      ? prisma.instance.groupBy({
          by: ['packagePlanId'],
          where: {
            packageId: null,
            packagePlanId: { in: planIds },
            status: { in: NORMAL_PACKAGE_INSTANCE_STATUSES }
          },
          _count: { id: true }
        })
      : Promise.resolve([])
  ])

  const countMap = new Map<number, number>()

  for (const row of directRows) {
    if (row.packageId !== null) {
      countMap.set(row.packageId, row._count?.id || 0)
    }
  }

  for (const row of planOnlyRows) {
    if (row.packagePlanId === null) continue
    const packageId = planPackageMap.get(row.packagePlanId)
    if (!packageId) continue
    countMap.set(packageId, (countMap.get(packageId) || 0) + (row._count?.id || 0))
  }

  return countMap
}

export async function userHasNormalInstanceForPackage(
  userId: number,
  packageId: number,
  tx?: typeof prisma
): Promise<boolean> {
  const client = tx || prisma
  const count = await client.instance.count({
    where: {
      userId,
      status: { in: NORMAL_PACKAGE_INSTANCE_STATUSES },
      OR: [
        { packageId },
        { packagePlan: { is: { packageId } } }
      ]
    }
  })

  return count > 0
}

export async function getPackagesDependingOnPackage(packageId: number): Promise<Array<{ id: number; name: string }>> {
  return await prisma.package.findMany({
    where: { requiredPackageId: packageId },
    select: { id: true, name: true },
    orderBy: { id: 'asc' }
  })
}

async function validatePackagePrerequisiteReferenceWithClient(
  client: Prisma.TransactionClient | typeof prisma,
  packageId: number | null,
  requiredPackageId: number | null | undefined,
  ownerUserId?: number
): Promise<PackagePrerequisiteValidationResult> {
  if (requiredPackageId === null || requiredPackageId === undefined) {
    return { valid: true }
  }

  if (!Number.isInteger(requiredPackageId) || requiredPackageId <= 0) {
    return {
      valid: false,
      code: 'PACKAGE_PREREQUISITE_INVALID',
      message: 'Required package is invalid'
    }
  }

  if (packageId !== null && requiredPackageId === packageId) {
    return {
      valid: false,
      code: 'PACKAGE_PREREQUISITE_SELF',
      message: 'Package cannot require itself'
    }
  }

  let cursor: number | null = requiredPackageId
  const visited = new Set<number>()

  while (cursor !== null) {
    if (packageId !== null && cursor === packageId) {
      return {
        valid: false,
        code: 'PACKAGE_PREREQUISITE_CYCLE',
        message: 'Package prerequisite cannot form a cycle'
      }
    }

    if (visited.has(cursor)) {
      return {
        valid: false,
        code: 'PACKAGE_PREREQUISITE_CYCLE',
        message: 'Package prerequisite cannot form a cycle'
      }
    }
    visited.add(cursor)

    const pkg: { requiredPackageId: number | null; userId: number } | null = await client.package.findUnique({
      where: { id: cursor },
      select: {
        requiredPackageId: true,
        userId: true
      }
    })

    if (!pkg) {
      return {
        valid: false,
        code: 'PACKAGE_PREREQUISITE_INVALID',
        message: 'Required package does not exist'
      }
    }

    if (ownerUserId !== undefined && pkg.userId !== ownerUserId) {
      return {
        valid: false,
        code: 'PACKAGE_PREREQUISITE_SCOPE',
        message: 'Required package must belong to the same owner'
      }
    }

    cursor = pkg.requiredPackageId
  }

  return { valid: true }
}

export async function validatePackagePrerequisiteReference(
  packageId: number | null,
  requiredPackageId: number | null | undefined,
  ownerUserId?: number
): Promise<PackagePrerequisiteValidationResult> {
  return validatePackagePrerequisiteReferenceWithClient(prisma, packageId, requiredPackageId, ownerUserId)
}

export async function validatePackagePrerequisiteReferenceLocked(
  packageId: number | null,
  requiredPackageId: number | null | undefined,
  ownerUserId?: number
): Promise<PackagePrerequisiteValidationResult> {
  return prisma.$transaction(async tx => {
    await acquirePackagePrerequisiteLock(tx)
    return validatePackagePrerequisiteReferenceWithClient(tx, packageId, requiredPackageId, ownerUserId)
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  })
}

/**
 * 检测节点类型变更会影响哪些套餐
 * @param hostId 节点ID
 * @param newInstanceType 新的实例类型
 * @returns 受影响的套餐列表（套餐类型与新节点类型不兼容）
 */
export async function getIncompatiblePackagesByHostTypeChange(hostId: number, newInstanceType: 'container' | 'vm' | 'both'): Promise<Array<{ id: number; name: string; instanceType: string }>> {
  // 如果新类型是 both，则所有套餐都兼容
  if (newInstanceType === 'both') {
    return []
  }

  // 查找绑定到该节点的所有套餐
  const packageHosts = await prisma.packageHost.findMany({
    where: { hostId },
    include: {
      package: {
        select: {
          id: true,
          name: true,
          instanceType: true
        }
      }
    }
  })

  // 过滤出不兼容的套餐
  // 如果节点只支持 container，则 vm 套餐不兼容
  // 如果节点只支持 vm，则 container 套餐不兼容
  return packageHosts
    .filter(ph => ph.package.instanceType !== newInstanceType && ph.package.instanceType !== 'both')
    .map(ph => ({
      id: ph.package.id,
      name: ph.package.name,
      instanceType: ph.package.instanceType
    }))
}


/**
 * 获取套餐绑定的宿主机详情列表
 */
export async function getPackageHostsDetail(packageId: number): Promise<Array<{
  id: number
  name: string
  countryCode: string
  cpuAllowanceMax: number
  memoryMax: number
  cpuUsed: number
  memoryUsed: number
}>> {
  const packageHosts = await prisma.packageHost.findMany({
    where: { packageId },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          countryCode: true,
          cpuAllowanceMax: true,
          memoryMax: true,
          cpuUsed: true,
          memoryUsed: true
        }
      }
    }
  })

  return packageHosts.map(ph => ({
    id: ph.host.id,
    name: ph.host.name,
    countryCode: ph.host.countryCode,
    cpuAllowanceMax: ph.host.cpuAllowanceMax,
    memoryMax: ph.host.memoryMax,
    cpuUsed: ph.host.cpuUsed,
    memoryUsed: ph.host.memoryUsed
  }))
}

/**
 * 为指定宿主机增加配额
 */
export async function increaseHostQuota(hostId: number, cpuAdd: number, memoryAdd: number): Promise<{
  cpuAllowanceMax: number
  memoryMax: number
}> {
  const host = await prisma.host.update({
    where: { id: hostId },
    data: {
      cpuAllowanceMax: { increment: cpuAdd },
      memoryMax: { increment: memoryAdd }
    },
    select: {
      cpuAllowanceMax: true,
      memoryMax: true
    }
  })

  return host
}

/**
 * 检查套餐是否售罄（所有绑定的宿主机都无法满足最低配置）
 * - 免费套餐：最低配置 15% CPU + 128MB 内存
 * - 付费套餐：最低配置为最低方案的 CPU/内存
 */
export async function checkPackageSoldOut(packageId: number): Promise<boolean> {
  // 1. 获取套餐绑定的宿主机以及其资源使用情况
  const packageHosts = await prisma.packageHost.findMany({
    where: { packageId },
    include: {
      host: {
        select: {
          id: true,
          status: true,
          cpuAllowanceMax: true,
          memoryMax: true,
          instances: {
            where: { status: { not: 'deleted' } },
            select: { cpu: true, memory: true }
          }
        }
      }
    }
  })

  // 没有绑定宿主机，视为售罄
  if (packageHosts.length === 0) {
    return true
  }

  // 2. 检查是否为付费套餐，并获取最低配置
  const plans = await prisma.packagePlan.findMany({
    where: { packageId, isActive: true },
    select: { cpu: true, memory: true, isSoldOut: true },
    orderBy: [{ cpu: 'asc' }, { memory: 'asc' }]
  })
  const availablePlans = plans.filter(plan => !plan.isSoldOut)

  let minCpu: number
  let minMemory: number

  if (plans.length > 0) {
    // 付费套餐：所有活跃方案都手动售罄时，套餐也视为售罄
    if (availablePlans.length === 0) {
      return true
    }
    // 付费套餐：只按可售方案计算最低可开通资源
    minCpu = Math.min(...availablePlans.map(p => p.cpu))
    minMemory = Math.min(...availablePlans.map(p => p.memory))
  } else {
    // 免费套餐：最低 15% CPU + 128MB 内存
    minCpu = 15
    minMemory = 128
  }

  // 3. 检查是否有任何一个在线宿主机可以满足最低配置
  for (const ph of packageHosts) {
    const host = ph.host
    
    // 跳过离线节点
    if (host.status !== 'online') {
      continue
    }

    // 检查是否设置了配额
    if (!host.cpuAllowanceMax || !host.memoryMax) {
      continue
    }

    // 计算实际使用量
    const cpuUsed = host.instances.reduce((sum, inst) => sum + inst.cpu, 0)
    const memoryUsed = host.instances.reduce((sum, inst) => sum + inst.memory, 0)

    // 计算剩余资源
    const cpuAvailable = host.cpuAllowanceMax - cpuUsed
    const memoryAvailable = host.memoryMax - memoryUsed

    // 如果能满足最低配置，则未售罄
    if (cpuAvailable >= minCpu && memoryAvailable >= minMemory) {
      return false
    }
  }

  // 所有宿主机都无法满足最低配置，售罄
  return true
}

/**
 * 批量检查多个套餐的售罄状态
 * 优化性能：一次性获取所有需要的数据
 */
export async function checkPackagesSoldOut(packageIds: number[]): Promise<Map<number, boolean>> {
  if (packageIds.length === 0) {
    return new Map()
  }

  // 1. 一次性获取所有套餐的宿主机绑定和资源信息
  const allPackageHosts = await prisma.packageHost.findMany({
    where: { packageId: { in: packageIds } },
    include: {
      host: {
        select: {
          id: true,
          status: true,
          cpuAllowanceMax: true,
          memoryMax: true,
          instances: {
            where: { status: { not: 'deleted' } },
            select: { cpu: true, memory: true }
          }
        }
      }
    }
  })

  // 2. 一次性获取所有套餐的活跃方案
  const allPlans = await prisma.packagePlan.findMany({
    where: { packageId: { in: packageIds }, isActive: true },
    select: { packageId: true, cpu: true, memory: true, isSoldOut: true }
  })

  // 3. 按套餐分组数据
  const hostsByPackage = new Map<number, typeof allPackageHosts>()
  for (const ph of allPackageHosts) {
    const list = hostsByPackage.get(ph.packageId) || []
    list.push(ph)
    hostsByPackage.set(ph.packageId, list)
  }

  const plansByPackage = new Map<number, typeof allPlans>()
  for (const plan of allPlans) {
    const list = plansByPackage.get(plan.packageId) || []
    list.push(plan)
    plansByPackage.set(plan.packageId, list)
  }

  // 4. 计算每个套餐的售罄状态
  const result = new Map<number, boolean>()
  
  for (const packageId of packageIds) {
    const packageHosts = hostsByPackage.get(packageId) || []
    const plans = plansByPackage.get(packageId) || []
    const availablePlans = plans.filter(plan => !plan.isSoldOut)

    // 没有绑定宿主机，视为售罄
    if (packageHosts.length === 0) {
      result.set(packageId, true)
      continue
    }

    // 确定最低配置
    let minCpu: number
    let minMemory: number

    if (plans.length > 0) {
      if (availablePlans.length === 0) {
        result.set(packageId, true)
        continue
      }
      minCpu = Math.min(...availablePlans.map(p => p.cpu))
      minMemory = Math.min(...availablePlans.map(p => p.memory))
    } else {
      minCpu = 15
      minMemory = 128
    }

    // 检查是否有任何宿主机可用
    let hasAvailableHost = false
    for (const ph of packageHosts) {
      const host = ph.host
      
      if (host.status !== 'online' || !host.cpuAllowanceMax || !host.memoryMax) {
        continue
      }

      const cpuUsed = host.instances.reduce((sum, inst) => sum + inst.cpu, 0)
      const memoryUsed = host.instances.reduce((sum, inst) => sum + inst.memory, 0)
      const cpuAvailable = host.cpuAllowanceMax - cpuUsed
      const memoryAvailable = host.memoryMax - memoryUsed

      if (cpuAvailable >= minCpu && memoryAvailable >= minMemory) {
        hasAvailableHost = true
        break
      }
    }

    result.set(packageId, !hasAvailableHost)
  }

  return result
}
