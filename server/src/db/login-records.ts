/**
 * 登录记录数据库操作
 */

import { prisma } from './prisma.js'

export interface CreateLoginRecordParams {
  userId: number
  ip: string
  country?: string | null
  region?: string | null
  city?: string | null
  isp?: string | null
  timezone?: string | null
  userAgent?: string | null
}

export interface LoginRecordItem {
  id: number
  ip: string
  country: string | null
  region: string | null
  city: string | null
  isp: string | null
  timezone: string | null
  userAgent: string | null
  createdAt: Date
}

/**
 * 创建登录记录
 */
export async function createLoginRecord(params: CreateLoginRecordParams): Promise<void> {
  await prisma.loginRecord.create({
    data: {
      userId: params.userId,
      ip: params.ip,
      country: params.country || null,
      region: params.region || null,
      city: params.city || null,
      isp: params.isp || null,
      timezone: params.timezone || null,
      userAgent: params.userAgent || null
    }
  })
}

/**
 * 获取用户登录记录列表（分页）
 */
export async function getUserLoginRecords(
  userId: number,
  page: number = 1,
  pageSize: number = 20
): Promise<{ records: LoginRecordItem[]; total: number }> {
  const skip = (page - 1) * pageSize

  const [records, total] = await Promise.all([
    prisma.loginRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        ip: true,
        country: true,
        region: true,
        city: true,
        isp: true,
        timezone: true,
        userAgent: true,
        createdAt: true
      }
    }),
    prisma.loginRecord.count({ where: { userId } })
  ])

  return { records, total }
}

/**
 * 获取用户最近的登录记录（用于安全检查）
 */
export async function getRecentLoginRecords(
  userId: number,
  limit: number = 10
): Promise<LoginRecordItem[]> {
  return prisma.loginRecord.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      ip: true,
      country: true,
      region: true,
      city: true,
      isp: true,
      timezone: true,
      userAgent: true,
      createdAt: true
    }
  })
}

/**
 * 删除用户所有登录记录（用于账户注销等场景）
 */
export async function deleteUserLoginRecords(userId: number): Promise<number> {
  const result = await prisma.loginRecord.deleteMany({
    where: { userId }
  })
  return result.count
}

/**
 * 批量获取用户最后登录记录
 * 用于管理员查看用户列表时显示最后活动
 */
export async function getLastLoginRecordsForUsers(
  userIds: number[]
): Promise<Map<number, LoginRecordItem | null>> {
  if (userIds.length === 0) {
    return new Map()
  }

  // 使用 Prisma 的 findMany + distinct，按用户分组获取最新记录
  const records = await prisma.loginRecord.findMany({
    where: {
      userId: { in: userIds }
    },
    orderBy: {
      createdAt: 'desc'
    },
    select: {
      id: true,
      userId: true,
      ip: true,
      country: true,
      region: true,
      city: true,
      isp: true,
      timezone: true,
      userAgent: true,
      createdAt: true
    }
  })

  // 按用户分组，只保留每个用户的最新记录
  const lastRecordMap = new Map<number, LoginRecordItem | null>()
  for (const userId of userIds) {
    lastRecordMap.set(userId, null)
  }
  
  for (const record of records) {
    if (!lastRecordMap.get(record.userId)) {
      lastRecordMap.set(record.userId, {
        id: record.id,
        ip: record.ip,
        country: record.country,
        region: record.region,
        city: record.city,
        isp: record.isp,
        timezone: record.timezone,
        userAgent: record.userAgent,
        createdAt: record.createdAt
      })
    }
  }

  return lastRecordMap
}

/**
 * 获取被多个用户共享的IP组（用于检测关联账号）
 * @param days 查询近多少天的登录记录
 * @param minUsers 最少关联用户数（默认2）
 */
export async function getSharedIPGroups(
  days: number = 90,
  minUsers: number = 2
): Promise<{
  ip: string
  users: {
    id: number
    username: string
    email: string | null
    status: string
    loginCount: number
    lastLogin: Date
  }[]
  totalLogins: number
}[]> {
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // 步骤1：查找被多个用户使用的IP
  const sharedIPs = await prisma.loginRecord.groupBy({
    by: ['ip'],
    where: {
      createdAt: { gte: sinceDate }
    },
    _count: {
      userId: true
    },
    having: {
      userId: {
        _count: {
          gte: minUsers
        }
      }
    }
  })

  // 过滤出真正被不同用户使用的IP
  const result: {
    ip: string
    users: {
      id: number
      username: string
      email: string | null
      status: string
      loginCount: number
      lastLogin: Date
    }[]
    totalLogins: number
  }[] = []

  for (const ipGroup of sharedIPs) {
    // 查询该IP的所有用户和登录信息
    const records = await prisma.loginRecord.findMany({
      where: {
        ip: ipGroup.ip,
        createdAt: { gte: sinceDate }
      },
      select: {
        userId: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            status: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    // 按用户分组统计
    const userMap = new Map<number, {
      id: number
      username: string
      email: string | null
      status: string
      loginCount: number
      lastLogin: Date
    }>()

    for (const record of records) {
      if (!userMap.has(record.userId)) {
        userMap.set(record.userId, {
          id: record.user.id,
          username: record.user.username,
          email: record.user.email,
          status: record.user.status,
          loginCount: 1,
          lastLogin: record.createdAt
        })
      } else {
        const user = userMap.get(record.userId)!
        user.loginCount++
      }
    }

    // 只有真正被多个不同用户使用的IP才加入结果
    if (userMap.size >= minUsers) {
      result.push({
        ip: ipGroup.ip,
        users: Array.from(userMap.values()).sort((a, b) => b.lastLogin.getTime() - a.lastLogin.getTime()),
        totalLogins: records.length
      })
    }
  }

  // 按关联用户数降序排列
  return result.sort((a, b) => b.users.length - a.users.length)
}

/**
 * 获取邮箱相似的用户组（用于检测关联账号）
 * 相似规则：邮箱前缀相同，仅差数字后缀
 */
export async function getSimilarEmailGroups(): Promise<{
  pattern: string
  users: {
    id: number
    username: string
    email: string
    status: string
    createdAt: Date
  }[]
}[]> {
  // 获取所有有邮箱的用户
  const users = await prisma.user.findMany({
    where: {
      email: { not: null }
    },
    select: {
      id: true,
      username: true,
      email: true,
      status: true,
      createdAt: true
    }
  })

  // 提取邮箱前缀（去除末尾数字）
  const prefixMap = new Map<string, {
    id: number
    username: string
    email: string
    status: string
    createdAt: Date
  }[]>()

  for (const user of users) {
    if (!user.email) continue
    
    const [localPart, domain] = user.email.split('@')
    if (!localPart || !domain) continue
    
    // 提取前缀：去除末尾的数字、下划线、短横线
    const prefix = localPart.replace(/[\d_-]+$/, '').toLowerCase()
    if (prefix.length < 2) continue // 前缀太短无意义
    
    const key = `${prefix}*@${domain}`
    
    if (!prefixMap.has(key)) {
      prefixMap.set(key, [])
    }
    prefixMap.get(key)!.push({
      id: user.id,
      username: user.username,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt
    })
  }

  // 过滤出有多个用户的组
  const result: {
    pattern: string
    users: {
      id: number
      username: string
      email: string
      status: string
      createdAt: Date
    }[]
  }[] = []

  for (const [pattern, groupUsers] of prefixMap) {
    if (groupUsers.length >= 2) {
      result.push({
        pattern,
        users: groupUsers.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      })
    }
  }

  // 按用户数降序排列
  return result.sort((a, b) => b.users.length - a.users.length)
}

/**
 * 获取用户名相似的用户组（用于检测关联账号）
 * 相似规则：用户名前缀相同，仅差数字后缀
 */
export async function getSimilarUsernameGroups(): Promise<{
  pattern: string
  users: {
    id: number
    username: string
    email: string | null
    status: string
    createdAt: Date
  }[]
}[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      status: true,
      createdAt: true
    }
  })

  // 提取用户名前缀（去除末尾数字）
  const prefixMap = new Map<string, {
    id: number
    username: string
    email: string | null
    status: string
    createdAt: Date
  }[]>()

  for (const user of users) {
    // 提取前缀：去除末尾的数字、下划线、短横线
    const prefix = user.username.replace(/[\d_-]+$/, '').toLowerCase()
    if (prefix.length < 2) continue // 前缀太短无意义
    
    const key = `${prefix}*`
    
    if (!prefixMap.has(key)) {
      prefixMap.set(key, [])
    }
    prefixMap.get(key)!.push({
      id: user.id,
      username: user.username,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt
    })
  }

  // 过滤出有多个用户的组
  const result: {
    pattern: string
    users: {
      id: number
      username: string
      email: string | null
      status: string
      createdAt: Date
    }[]
  }[] = []

  for (const [pattern, groupUsers] of prefixMap) {
    if (groupUsers.length >= 2) {
      result.push({
        pattern,
        users: groupUsers.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      })
    }
  }

  // 按用户数降序排列
  return result.sort((a, b) => b.users.length - a.users.length)
}
