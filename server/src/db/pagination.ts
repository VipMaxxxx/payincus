/**
 * 分页查询函数
 * 使用 Prisma ORM
 */

import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { getImageDisplayNames } from './images.js'
import type { Host, User, Instance } from '../types/database.js'

export const USER_SEARCH_FIELDS = ['username', 'id', 'email'] as const
export type UserSearchField = (typeof USER_SEARCH_FIELDS)[number]

export interface PaginationOptions {
  page?: number
  pageSize?: number
  search?: string
  searchFields?: UserSearchField[]
  exactMatch?: boolean
  userId?: number | null
  hostId?: number | null
  countryCode?: string | null
  status?: string | null
  sortBy?: string | null
  sortOrder?: 'asc' | 'desc' | null
  excludeUserId?: number | null  // 排除特定用户的数据
  ownerRole?: 'admin' | 'user' | null  // 按所有者角色过滤
  includeOwner?: boolean  // 是否包含所有者信息
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface PaginatedInstancesResponse<T> extends PaginatedResponse<T> {
  availableCountries: string[]
}

type UserWithQuota = Prisma.UserGetPayload<{
  include: {
    quota: true
  }
}>

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function clampPagination(
  page: number | undefined,
  pageSize: number | undefined,
  fallbackPageSize: number = 20,
  maxPageSize: number = 100
): { page: number; pageSize: number } {
  return {
    page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize !== undefined
      ? Math.min(Math.max(pageSize, 1), maxPageSize)
      : fallbackPageSize
  }
}

function joinSqlFragments(fragments: Prisma.Sql[], operator: 'AND' | 'OR'): Prisma.Sql {
  if (fragments.length === 0) {
    return Prisma.empty
  }

  let result = fragments[0]!
  for (let i = 1; i < fragments.length; i++) {
    result = Prisma.sql`${result} ${Prisma.raw(operator)} ${fragments[i]!}`
  }

  return result
}

function normalizeUserSearchFields(fields?: UserSearchField[]): UserSearchField[] {
  if (!Array.isArray(fields) || fields.length === 0) {
    return [...USER_SEARCH_FIELDS]
  }

  const validFields = new Set(USER_SEARCH_FIELDS)
  const normalized = fields.filter((field): field is UserSearchField => validFields.has(field))

  return normalized.length > 0
    ? USER_SEARCH_FIELDS.filter(field => normalized.includes(field))
    : [...USER_SEARCH_FIELDS]
}

function buildUserSearchWhereClause(
  rawSearch: string,
  searchFields?: UserSearchField[],
  exactMatch: boolean = false
): Prisma.Sql | null {
  const search = rawSearch.trim()
  if (!search) {
    return null
  }

  const fields = normalizeUserSearchFields(searchFields)
  const fuzzyPattern = `%${escapeSqlLike(search)}%`
  const fieldClauses: Prisma.Sql[] = []

  if (fields.includes('username')) {
    fieldClauses.push(
      exactMatch
        ? Prisma.sql`LOWER(u.username) = LOWER(${search})`
        : Prisma.sql`u.username ILIKE ${fuzzyPattern} ESCAPE '\'`
    )
  }

  if (fields.includes('id')) {
    fieldClauses.push(
      exactMatch
        ? Prisma.sql`CAST(u.id AS TEXT) = ${search}`
        : Prisma.sql`CAST(u.id AS TEXT) ILIKE ${fuzzyPattern} ESCAPE '\'`
    )
  }

  if (fields.includes('email')) {
    fieldClauses.push(
      exactMatch
        ? Prisma.sql`u.email IS NOT NULL AND LOWER(u.email) = LOWER(${search})`
        : Prisma.sql`u.email IS NOT NULL AND u.email ILIKE ${fuzzyPattern} ESCAPE '\'`
    )
  }

  if (fieldClauses.length === 0) {
    return null
  }

  return Prisma.sql`(${joinSqlFragments(fieldClauses, 'OR')})`
}

/**
 * 获取用户分页列表
 */
export async function getUsersPaginated(options: PaginationOptions = {}): Promise<PaginatedResponse<User>> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const { search = '', searchFields, exactMatch = false } = options
  const searchWhereClause = buildUserSearchWhereClause(search, searchFields, exactMatch)

  let total = 0
  let users: UserWithQuota[] = []

  if (searchWhereClause) {
    const totalRows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::integer AS count
      FROM "users" u
      WHERE ${searchWhereClause}
    `)
    total = totalRows[0]?.count || 0

    const userIdRows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT u.id
      FROM "users" u
      WHERE ${searchWhereClause}
      ORDER BY u.created_at DESC
      OFFSET ${(page - 1) * pageSize}
      LIMIT ${pageSize}
    `)

    const userIds = userIdRows.map(row => row.id)
    if (userIds.length > 0) {
      users = await prisma.user.findMany({
        where: {
          id: { in: userIds }
        },
        include: {
          quota: true
        }
      })

      const orderMap = new Map(userIds.map((id, index) => [id, index]))
      users.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
    }
  } else {
    total = await prisma.user.count()
    users = await prisma.user.findMany({
      include: {
        quota: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  }

  return {
    items: users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      password_hash: '', // 不返回密码哈希
      role: u.role,
      status: u.status,
      avatar_style: u.avatarStyle,
      created_at: u.createdAt.toISOString(),
      updated_at: u.updatedAt.toISOString(),
      // 配额信息（新配额系统）
      // 注意：不再限制实例配额
      ...(u.quota ? {
        host_limit: u.quota.hostLimit,
        host_used: u.quota.hostUsed,
        friend_limit: u.quota.friendLimit,
        friend_used: u.quota.friendUsed,
        package_limit: u.quota.packageLimit,
        package_used: u.quota.packageUsed,
        // 流量配额
        monthly_traffic_limit: u.quota.monthlyTrafficLimit?.toString() ?? null,
        monthly_traffic_used: u.quota.monthlyTrafficUsed.toString(),
        extra_traffic_quota: u.quota.extraTrafficQuota.toString(),
        traffic_status: u.quota.trafficStatus
      } : {})
    })) as User[],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }
}

/**
 * 获取宿主机分页列表
 * @param options.userId - 筛选指定用户的节点
 * @param options.excludeUserId - 排除指定用户的节点（用于获取托管节点）
 * @param options.ownerRole - 按所有者角色过滤节点
 * @param options.includeOwner - 是否包含所有者信息
 */
export async function getHostsPaginated(options: PaginationOptions = {}): Promise<PaginatedResponse<Host>> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const { search = '', userId = null, excludeUserId = null, ownerRole = null, includeOwner = false } = options

  const where: any = {}

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { location: { contains: search, mode: 'insensitive' } },
      { url: { contains: search, mode: 'insensitive' } }
    ]
  }

  // 如果指定了 userId，只返回该用户的宿主机（普通用户只能看到自己的宿主机）
  if (userId) {
    where.userId = userId
  }

  // 排除指定用户的节点（用于获取托管节点）
  if (excludeUserId) {
    where.userId = { not: excludeUserId }
  }

  // 按所有者角色过滤节点
  if (ownerRole) {
    where.user = { role: ownerRole }
  }

  // 获取总数
  const total = await prisma.host.count({ where })

  // 根据是否需要所有者信息，使用不同的查询
  const selectFields = {
    id: true,
    name: true,
    url: true,
    location: true,
    countryCode: true,
    status: true,
    certPath: true,
    keyPath: true,
    natPublicIp: true,
    natPortStart: true,
    natPortEnd: true,
    natPortsUsedCount: true,
    cpuUsed: true,
    memoryUsed: true,
    diskUsed: true,
    cpuAllowanceMax: true,
    memoryMax: true,
    instanceType: true,
    storageSize: true,
    tags: true,
    createdAt: true,
    updatedAt: true,
    userId: true,
  } as const

  // 获取数据
  const hosts = includeOwner
    ? await prisma.host.findMany({
        where,
        select: {
          ...selectFields,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              avatarStyle: true,
              avatarBadgeId: true
            }
          }
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    : await prisma.host.findMany({
        where,
        select: selectFields,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })

  return {
    items: hosts.map((h: any) => ({
      id: h.id,
      name: h.name,
      url: h.url,
      location: h.location,
      country_code: h.countryCode,
      architecture: h.architecture,
      status: h.status,
      cert_path: h.certPath,
      key_path: h.keyPath,
      nat_public_ip: h.natPublicIp,
      nat_port_start: h.natPortStart,
      nat_port_end: h.natPortEnd,
      nat_ports_used_count: h.natPortsUsedCount,
      cpu_used: h.cpuUsed,
      memory_used: h.memoryUsed,
      disk_total: h.storageSize ? Number(h.storageSize) * 1024 : 0, // 使用创建时输入的存储大小（GB转MB）
      disk_used: h.diskUsed,
      cpu_allowance_max: h.cpuAllowanceMax,
      memory_max: h.memoryMax,
      instance_type: h.instanceType,
      storage_size: h.storageSize,
      tags: Array.isArray(h.tags) ? (h.tags as string[]) : [],
      created_at: h.createdAt.toISOString(),
      updated_at: h.updatedAt.toISOString(),
      user_id: h.userId,
      // 所有者信息
      ...(h.user && {
        owner: {
          id: h.user.id,
          username: h.user.username,
          email: h.user.email,
          avatarStyle: h.user.avatarStyle,
          avatarBadgeId: h.user.avatarBadgeId ?? null
        }
      })
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }
}

/**
 * 获取实例分页列表
 */
export async function getInstancesPaginated(options: PaginationOptions = {}): Promise<PaginatedInstancesResponse<Instance>> {
  const { page, pageSize } = clampPagination(options.page, options.pageSize)
  const { search = '', userId = null, hostId = null, countryCode = null, status = null, sortBy = null, sortOrder = null } = options

  const baseWhere: any = {}

  // 默认排除已删除的实例（除非明确指定 status='deleted'）
  if (status === 'deleted') {
    baseWhere.status = 'deleted'
  } else if (status) {
    baseWhere.status = status
  } else {
    baseWhere.status = { not: 'deleted' }
  }

  if (search) {
    // 尝试将搜索词解析为数字（用于实例ID搜索）
    const searchNum = parseInt(search, 10)
    const isNumeric = !isNaN(searchNum) && searchNum.toString() === search.trim()
    
    const searchConditions: any[] = [
      { name: { contains: search, mode: 'insensitive' } },
      { incusId: { contains: search, mode: 'insensitive' } },
      { ipv4: { contains: search, mode: 'insensitive' } },
      { ipv6: { contains: search, mode: 'insensitive' } },
      // 关联用户表搜索用户名和邮箱
      { user: { username: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } }
    ]
    
    // 如果是数字，添加实例ID精确匹配
    if (isNumeric) {
      searchConditions.push({ id: searchNum })
    }
    
    baseWhere.OR = searchConditions
  }

  if (userId) {
    baseWhere.userId = userId
  }

  if (hostId) {
    baseWhere.hostId = hostId
  }

  const where: any = { ...baseWhere }

  if (countryCode) {
    where.host = {
      countryCode: countryCode.toLowerCase()
    }
  }

  const availableCountryRows = await prisma.host.findMany({
    where: {
      instances: {
        some: baseWhere
      }
    },
    select: {
      countryCode: true
    },
    distinct: ['countryCode'],
    orderBy: {
      countryCode: 'asc'
    }
  })
  const availableCountries = availableCountryRows
    .map(host => (host.countryCode || 'us').toLowerCase())
    .filter((code, index, array) => array.indexOf(code) === index)

  // 获取总数
  const total = await prisma.instance.count({ where })

  const orderBy: Prisma.InstanceOrderByWithRelationInput[] = sortBy === 'createdAt'
    ? [{ createdAt: sortOrder || 'desc' }, { id: 'asc' }]
    : userId
      ? [{ displayOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'asc' }]

  // 获取数据
  const instances = await prisma.instance.findMany({
    where,
    include: {
      host: {
        select: {
          name: true,
          location: true,
          countryCode: true,
          natPublicIp: true,
          natPublicIpv6: true,
          ipv6Gateway: true,
          ipAddress: true,
          url: true
        }
      },
      user: {
        select: {
          username: true,
          email: true,
          avatarStyle: true,
          avatarBadgeId: true
        }
      },
      package: {
        select: {
          name: true,
          allowInstanceDeletion: true,
          instanceType: true
        }
      }
    },
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize
  })

  // 批量获取镜像显示名称
  const imageAliases = instances.map(i => i.image)
  const imageDisplayNames = await getImageDisplayNames(imageAliases)

  return {
    items: instances.map(i => ({
      id: i.id,
      incus_id: i.incusId,
      name: i.name,
      user_id: i.userId,
      host_id: i.hostId,
      package_id: i.packageId,
      display_order: i.displayOrder,
      icon_badge_id: i.iconBadgeId,
      image: i.image,
      image_name: imageDisplayNames.get(i.image) || null,
      status: i.status,
      cpu: i.cpu,
      memory: i.memory,
      disk: i.disk,
      ipv4: i.ipv4,
      ipv6: i.ipv6,
      network_mode: i.networkMode,
      ssh_port: i.sshPort,
      root_password: i.rootPassword,
      port_limit: i.portLimit,
      snapshot_limit: i.snapshotLimit,
      backup_limit: i.backupLimit,
      site_limit: i.siteLimit,
      swap_enabled: i.swapEnabled,
      swap_size: i.swapSize,
      monthly_traffic_limit: i.monthlyTrafficLimit ? i.monthlyTrafficLimit.toString() : null,
      monthly_traffic_used: i.monthlyTrafficUsed ? i.monthlyTrafficUsed.toString() : '0',
      // 配置字段
      limits_read: i.limitsRead,
      limits_write: i.limitsWrite,
      limits_read_iops: i.limitsReadIops,
      limits_write_iops: i.limitsWriteIops,
      limits_ingress: i.limitsIngress,
      limits_egress: i.limitsEgress,
      limits_processes: i.limitsProcesses,
      limits_cpu_priority: i.limitsCpuPriority,
      boot_autostart: i.bootAutostart,
      boot_autostart_priority: i.bootAutostartPriority,
      boot_autostart_delay: i.bootAutostartDelay,
      boot_host_shutdown_timeout: i.bootHostShutdownTimeout,
      // 封停相关字段
      expires_at: i.expiresAt?.toISOString() ?? null,
      auto_renew: i.autoRenew,
      suspended_at: i.suspendedAt?.toISOString() ?? null,
      suspended_by: i.suspendedBy,
      suspend_reason: i.suspendReason,
      created_at: i.createdAt.toISOString(),
      updated_at: i.updatedAt.toISOString(),
      host_name: i.host.name,
      host_country_code: i.host.countryCode,
      host_nat_public_ip: i.host.natPublicIp,
      host_nat_public_ipv6: i.host.natPublicIpv6,
      host_ipv6_gateway: i.host.ipv6Gateway,
      host_ip_address: (() => {
        if (i.host.ipAddress) return i.host.ipAddress
        if (i.host.url) {
          try {
            const u = new URL(i.host.url)
            return u.hostname.replace(/^\[|\]$/g, '')
          } catch {
            return null
          }
        }
        return null
      })(),
      username: i.user.username,
      user_email: i.user.email,
      user_avatar_style: i.user.avatarStyle,
      user_avatar_badge_id: i.user.avatarBadgeId,
      package_name: i.package?.name || null,
      package_plan_id: i.packagePlanId,
      billing_price: i.billingPrice ? Number(i.billingPrice) : null,
      package_instance_type: i.package?.instanceType || 'container',
      allow_instance_deletion: i.package?.allowInstanceDeletion ?? true
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    availableCountries
  }
}

/**
 * 获取可用宿主机（用于创建实例时选择）
 * 根据套餐所有权过滤：
 * - 如果是自己的套餐，返回自己的节点
 * - 如果是共享的套餐，返回套餐所有者的节点（部分信息）
 */
export async function getAvailableHosts(
  packageHostIds: number[] | null = null,
  cpu: number,
  memory: number,
  _disk: number,
  options: {
    userId?: number       // 当前用户ID
    packageOwnerId?: number  // 套餐所有者ID（如果是共享套餐）
  } = {}
): Promise<any[]> {
  const { userId, packageOwnerId } = options

  // 构建查询条件
  const whereCondition: any = {
    status: 'online'
  }

  // 修复：当套餐绑定了宿主机时，直接使用绑定列表查询，不添加额外的所有权限制
  // 套餐绑定宿主机的权限已在创建/编辑套餐时验证
  if (packageHostIds && packageHostIds.length > 0) {
    // 套餐绑定了特定宿主机，只在这些宿主机中选择
    whereCondition.id = { in: packageHostIds }
  } else {
    // 套餐没有绑定宿主机时，根据所有权返回可用节点
    if (packageOwnerId) {
      // 共享套餐：返回套餐所有者的所有在线宿主机
      whereCondition.userId = packageOwnerId
    } else if (userId) {
      // 自己的套餐：返回自己的所有在线宿主机
      whereCondition.userId = userId
    }
  }

  // 获取所有在线主机
  const hosts = await prisma.host.findMany({
    where: whereCondition,
    select: {
      id: true,
      userId: true,  // 节点所有者ID
      name: true,
      url: true,
      location: true,
      countryCode: true,
      architecture: true,
      status: true,
      certPath: true,
      keyPath: true,
      natPublicIp: true,
      natPortStart: true,
      natPortEnd: true,
      natPortsUsedCount: true,
      cpuUsed: true,
      memoryUsed: true,
      diskUsed: true,
      cpuAllowanceMax: true,
      memoryMax: true,
      instanceType: true,
      storageSize: true,
      probeUrl: true,
      tags: true,
      createdAt: true,
      updatedAt: true,
      user: {  // 节点所有者信息
        select: {
          id: true,
          username: true
        }
      },
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
    }
  })

  // 计算每个主机的实际资源使用量
  // 资源使用量 = 关联该宿主机的实例的资源总和
  // 资源上限 = 用户输入的配额（cpuAllowanceMax、memoryMax、storageSize）
  const hostsWithResources = hosts.map(host => {
    // 计算实例资源总和（已使用量）
    const cpuUsed = host.instances.reduce((sum, inst) => sum + inst.cpu, 0)
    const memoryUsed = host.instances.reduce((sum, inst) => sum + inst.memory, 0)
    const diskUsed = host.instances.reduce((sum, inst) => sum + inst.disk, 0)

    return {
      ...host,
      cpuUsedCalculated: cpuUsed,
      memoryUsedCalculated: memoryUsed,
      diskUsedCalculated: diskUsed
    }
  })

  const availableHosts = hostsWithResources
    .filter(host => {
      // 检查 CPU 配额
      // 剩余量 = 用户输入的CPU配额上限 - 实例资源总和
      const cpuAllowanceMax = host.cpuAllowanceMax
      if (cpuAllowanceMax != null && cpuAllowanceMax > 0) {
        // 剩余CPU配额 = cpuAllowanceMax - cpuUsedCalculated
        // 需要满足：剩余CPU配额 >= 请求的CPU
        if ((host.cpuUsedCalculated + cpu) > cpuAllowanceMax) {
          return false // CPU配额不足
        }
      } else {
        // 如果没有设置CPU配额上限，该宿主机不可用（必须设置配额）
        return false
      }

      // 检查内存配额
      // 剩余量 = 用户输入的内存配额上限 - 实例资源总和
      const memoryMax = host.memoryMax
      if (memoryMax != null && memoryMax > 0) {
        // 剩余内存配额 = memoryMax - memoryUsedCalculated
        // 需要满足：剩余内存配额 >= 请求的内存
        if ((host.memoryUsedCalculated + memory) > memoryMax) {
          return false // 内存配额不足
        }
      } else {
        // 如果没有设置内存配额上限，该宿主机不可用（必须设置配额）
        return false
      }

      // 磁盘配额检查已移除：不再限制磁盘空间
      return true
    })
    .sort((a, b) => (b.memoryMax - b.memoryUsedCalculated) - (a.memoryMax - a.memoryUsedCalculated))

  return availableHosts.map(h => {
    const isOwn = userId ? h.userId === userId : false

    // 基础信息（所有人都能看到）
    const baseInfo = {
      id: h.id,
      user_id: h.userId,
      owner_username: h.user?.username || null,
      is_own: isOwn,
      name: h.name,
      location: h.location,
      country_code: h.countryCode,
      architecture: h.architecture,
      status: h.status,
      cpu_used: h.cpuUsedCalculated,
      cpu_allowance_max: h.cpuAllowanceMax,
      memory_used: h.memoryUsedCalculated,
      memory_max: h.memoryMax,
      disk_total: h.storageSize ? h.storageSize * 1024 : 0, // 只使用用户输入的存储大小（GB转MB），不使用实际磁盘容量
      disk_used: h.diskUsedCalculated,
      instance_type: h.instanceType,
      storage_size: h.storageSize,
      probe_url: h.probeUrl || null
    }

    // 如果是自己的节点，返回完整信息
    if (isOwn) {
      return {
        ...baseInfo,
        url: h.url,
        cert_path: h.certPath,
        key_path: h.keyPath,
        nat_public_ip: h.natPublicIp,
        nat_port_start: h.natPortStart,
        nat_port_end: h.natPortEnd,
        nat_ports_used_count: h.natPortsUsedCount,
        tags: Array.isArray(h.tags) ? h.tags as string[] : [],
        created_at: h.createdAt.toISOString(),
        updated_at: h.updatedAt.toISOString()
      }
    }

    // 共享套餐的节点，只返回基础信息
    return baseInfo
  })
}

/**
 * 获取可用宿主机（用于实例创建，支持用户指定）
 */
export async function getAvailableHostsForInstance(
  packageHostIds: number[] | null = null,
  cpu: number,
  memory: number,
  _disk: number
): Promise<any[]> {
  const where: any = {
    status: 'online'
  }

  if (packageHostIds && packageHostIds.length > 0) {
    where.id = { in: packageHostIds }
  }

  const hosts = await prisma.host.findMany({
    where,
    select: {
      id: true,
      name: true,
      url: true,
      location: true,
      countryCode: true,
      architecture: true,
      status: true,
      certPath: true,
      keyPath: true,
      natPublicIp: true,
      natPortStart: true,
      natPortEnd: true,
      natPortsUsedCount: true,
      cpuUsed: true,
      memoryUsed: true,
      diskUsed: true,
      cpuAllowanceMax: true,
      memoryMax: true,
      instanceType: true,
      storageSize: true,
      tags: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: {
      cpuAllowanceMax: 'desc'
    }
  })

  // 过滤可用主机
  const availableHosts = hosts.filter(host => {
    // 检查 CPU 配额
    const cpuAllowanceMax = host.cpuAllowanceMax
    if (cpuAllowanceMax != null && cpuAllowanceMax > 0) {
      if ((host.cpuUsed + cpu) > cpuAllowanceMax) {
        return false // CPU配额不足
      }
    } else {
      // 如果没有设置CPU配额上限，该宿主机不可用
      return false
    }

    // 检查内存配额
    const memoryMax = host.memoryMax
    if (memoryMax != null && memoryMax > 0) {
      if ((host.memoryUsed + memory) > memoryMax) {
        return false // 内存配额不足
      }
    } else {
      // 如果没有设置内存配额上限，该宿主机不可用
      return false
    }

    // 磁盘配额检查已移除：不再限制磁盘空间
    return true
  })

  return availableHosts.map(h => ({
    id: h.id,
    name: h.name,
    url: h.url,
    location: h.location,
    country_code: h.countryCode,
    architecture: h.architecture,
    status: h.status,
    cert_path: h.certPath,
    key_path: h.keyPath,
    nat_public_ip: h.natPublicIp,
    nat_port_start: h.natPortStart,
    nat_port_end: h.natPortEnd,
    cpu_used: h.cpuUsed,
    cpu_allowance_max: h.cpuAllowanceMax,
    memory_used: h.memoryUsed,
    memory_max: h.memoryMax,
    disk_total: h.storageSize ? h.storageSize * 1024 : 0,
    disk_used: h.diskUsed,
    created_at: h.createdAt.toISOString(),
    updated_at: h.updatedAt.toISOString()
  }))
}
