/**
 * 数据库查询优化工具
 * PERF002: N+1 查询优化
 * 
 * 提供优化的查询方法，避免 N+1 问题
 * 
 * 优化策略：
 * 1. 使用 Prisma include 预加载关系数据
 * 2. 使用 select 只获取需要的字段
 * 3. 批量查询代替循环单条查询
 * 4. 游标分页代替 offset 分页（大数据集）
 * 5. 事务批量更新代替多次单独更新
 * 
 * 安全改进：批量操作使用显式事务隔离级别
 */

import { prisma } from './prisma.js'
import { Prisma } from '@prisma/client'

// 事务隔离级别配置 - 配额更新使用 Serializable
const QUOTA_UPDATE_TRANSACTION_OPTIONS = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 10000,
} as const

/**
 * 批量获取用户配额（避免 N+1 问题）
 */
export async function getUsersWithQuotasBatch(userIds: number[]) {
  if (userIds.length === 0) return []
  
  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds }
    },
    include: {
      quota: true
    }
  })
  
  return users
}

/**
 * 批量获取实例的主机信息（避免 N+1 问题）
 */
export async function getInstancesWithHostsBatch(instanceIds: number[]) {
  if (instanceIds.length === 0) return []
  
  const instances = await prisma.instance.findMany({
    where: {
      id: { in: instanceIds }
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          location: true,
          countryCode: true,
          status: true
        }
      }
    }
  })
  
  return instances
}

/**
 * 优化的分页查询（使用游标分页，适合大数据集）
 */
export async function getInstancesCursorPaginated(cursor: number | null, limit: number = 20) {
  const instances = await prisma.instance.findMany({
    take: limit + 1, // 多取一条用于判断是否有下一页
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    where: {
      status: { not: 'deleted' }
    },
    include: {
      host: {
        select: {
          name: true,
          location: true,
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
      id: 'asc'
    }
  })
  
  const hasNextPage = instances.length > limit
  const items = hasNextPage ? instances.slice(0, limit) : instances
  const nextCursor = hasNextPage ? items[items.length - 1].id : null
  
  return {
    items,
    nextCursor,
    hasNextPage
  }
}

/**
 * 使用 select 优化查询（只获取需要的字段）
 */
export async function getInstancesLightweight(limit: number = 20) {
  return await prisma.instance.findMany({
    take: limit,
    where: {
      status: { not: 'deleted' }
    },
    select: {
      id: true,
      incusId: true,
      name: true,
      status: true,
      cpu: true,
      memory: true,
      disk: true,
      ipv4: true,
      ipv6: true,
      createdAt: true,
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
      createdAt: 'desc'
    }
  })
}

/**
 * 批量更新（使用事务优化）
 * 安全改进：显式指定 Serializable 隔离级别，确保配额更新一致性
 */
export async function batchUpdateUserQuotas(updates: Array<{
  userId: number
  cpuUsed?: number
  memoryUsed?: number
  diskUsed?: number
}>) {
  return await prisma.$transaction(
    updates.map(update => {
      const data: any = {}
      if (update.cpuUsed !== undefined) data.cpuUsed = { increment: update.cpuUsed }
      if (update.memoryUsed !== undefined) data.memoryUsed = { increment: update.memoryUsed }
      if (update.diskUsed !== undefined) data.diskUsed = { increment: update.diskUsed }
      
      return prisma.userQuota.update({
        where: { userId: update.userId },
        data
      })
    }),
    QUOTA_UPDATE_TRANSACTION_OPTIONS
  )
}

/**
 * PERF002: 批量获取实例的完整信息（包含主机和用户）
 * 避免在循环中单独查询主机或用户信息
 */
export async function getInstancesWithDetailsBatch(instanceIds: number[]) {
  if (instanceIds.length === 0) return []
  
  return await prisma.instance.findMany({
    where: {
      id: { in: instanceIds }
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          location: true,
          countryCode: true,
          status: true,
          url: true
        }
      },
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          avatarStyle: true
        }
      }
    }
  })
}

/**
 * PERF002: 批量获取备份信息（包含实例）
 */
export async function getBackupsWithDetailsBatch(backupIds: number[]) {
  if (backupIds.length === 0) return []
  
  return await prisma.backup.findMany({
    where: {
      id: { in: backupIds }
    },
    include: {
      instance: {
        select: {
          id: true,
          name: true,
          status: true
        }
      }
    }
  })
}

/**
 * PERF002: 并行查询多个 count（避免串行等待）
 */
export async function getMultipleCounts(queries: {
  instances?: { where?: any }
  users?: { where?: any }
  hosts?: { where?: any }
  backups?: { where?: any }
}) {
  const countPromises: Promise<number>[] = []
  const keys: string[] = []

  if (queries.instances) {
    keys.push('instances')
    countPromises.push(prisma.instance.count({ where: queries.instances.where }))
  }
  if (queries.users) {
    keys.push('users')
    countPromises.push(prisma.user.count({ where: queries.users.where }))
  }
  if (queries.hosts) {
    keys.push('hosts')
    countPromises.push(prisma.host.count({ where: queries.hosts.where }))
  }
  if (queries.backups) {
    keys.push('backups')
    countPromises.push(prisma.backup.count({ where: queries.backups.where }))
  }

  const counts = await Promise.all(countPromises)
  
  const result: Record<string, number> = {}
  keys.forEach((key, index) => {
    result[key] = counts[index]
  })
  
  return result
}

/**
 * PERF002: 使用 Map 结构的批量获取（方便快速查找）
 */
export async function getUsersMapByIds(userIds: number[]): Promise<Map<number, {
  id: number
  username: string
  email: string | null
  avatarStyle: string | null
}>> {
  if (userIds.length === 0) return new Map()
  
  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds }
    },
    select: {
      id: true,
      username: true,
      email: true,
      avatarStyle: true
    }
  })
  
  return new Map(users.map(u => [u.id, u]))
}

/**
 * PERF002: 使用 Map 结构的主机批量获取
 */
export async function getHostsMapByIds(hostIds: number[]): Promise<Map<number, {
  id: number
  name: string
  location: string | null
  countryCode: string | null
  status: string
}>> {
  if (hostIds.length === 0) return new Map()
  
  const hosts = await prisma.host.findMany({
    where: {
      id: { in: hostIds }
    },
    select: {
      id: true,
      name: true,
      location: true,
      countryCode: true,
      status: true
    }
  })
  
  return new Map(hosts.map(h => [h.id, h]))
}
