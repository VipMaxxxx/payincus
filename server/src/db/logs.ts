/**
 * 日志相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { Log } from '../types/database.js'
import type { Prisma } from '@prisma/client'

// ==================== 日志模块常量 ====================

const LOG_MODULE_FILTER_MAX_LENGTH = 64
const LOG_SEARCH_FILTER_MAX_LENGTH = 128
const LOG_INSTANCE_NAME_FILTER_MAX_LENGTH = 128

function normalizeLogFilterValue(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed.slice(0, maxLength)
}

function parseValidDateFilter(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export const LogModule = {
  SECURITY: 'security',
  INSTANCE: 'instance',
  SNAPSHOT: 'snapshot',
  BACKUP: 'backup',
  IMAGE: 'image',
  HOST: 'host',
  PACKAGE: 'package',
  USER: 'user',
  PERSONAL: 'personal',
  SSH_KEY: 'ssh_key',
  NOTIFICATION: 'notification',
  SYSTEM: 'system',
  AUTH: 'auth'
} as const

// 日志操作常量
export const LogAction = {
  // 实例操作
  INSTANCE_CREATE: 'instance.create',
  INSTANCE_DELETE: 'instance.delete',
  INSTANCE_START: 'instance.start',
  INSTANCE_STOP: 'instance.stop',
  INSTANCE_RESTART: 'instance.restart',
  INSTANCE_REBUILD: 'instance.rebuild',
  INSTANCE_UPDATE_QUOTA: 'instance.update_quota',
  // 端口映射
  PORT_ADD: 'port.add',
  PORT_DELETE: 'port.delete',
  // 快照操作
  SNAPSHOT_CREATE: 'snapshot.create',
  SNAPSHOT_DELETE: 'snapshot.delete',
  SNAPSHOT_RESTORE: 'snapshot.restore',
  // 备份操作
  BACKUP_CREATE: 'backup.create',
  BACKUP_DELETE: 'backup.delete',
  BACKUP_EXPORT: 'backup.export',
  // 镜像操作
  IMAGE_SYNC: 'image.sync',
  IMAGE_DELETE: 'image.delete',
  IMAGE_CREATE: 'image.create',
  IMAGE_UPDATE: 'image.update',
  // 节点操作
  HOST_CREATE: 'host.create',
  HOST_UPDATE: 'host.update',
  HOST_DELETE: 'host.delete',
  HOST_TEST: 'host.test',
  // 套餐操作
  PACKAGE_CREATE: 'package.create',
  PACKAGE_UPDATE: 'package.update',
  PACKAGE_DELETE: 'package.delete',
  // 用户管理
  USER_BAN: 'user.ban',
  USER_UNBAN: 'user.unban',
  USER_DELETE: 'user.delete',
  USER_UPDATE_QUOTA: 'user.update_quota',
  USER_REVOKE_SESSIONS: 'user.revoke_sessions',
  // 个人设置
  PROFILE_UPDATE: 'profile.update',
  PASSWORD_CHANGE: 'password.change',
  // SSH 密钥
  SSH_KEY_ADD: 'ssh_key.add',
  SSH_KEY_DELETE: 'ssh_key.delete',
  // 通知设置
  NOTIFICATION_ADD: 'notification.add',
  NOTIFICATION_DELETE: 'notification.delete',
  // 安全设置
  TWO_FA_SETUP: '2fa.setup',
  TWO_FA_ENABLE: '2fa.enable',
  TWO_FA_DISABLE: '2fa.disable',
  TWO_FA_RECOVERY_RESET: '2fa.recovery_reset',
  // 认证操作
  SESSION_REVOKE: 'session.revoke',
  SESSION_REVOKE_ALL: 'session.revoke_all',
  // 系统配置
  SYSTEM_CONFIG_UPDATE: 'system.config_update'
} as const

// 日志结果常量
export const LogResult = {
  SUCCESS: 'success',
  FAILED: 'failed',
  WARNING: 'warning'
} as const

export type CreateLogOptions = {
  instanceId?: number | null
}

const INSTANCE_NAME_PATTERN = /instance\s+"([^"]+)"/gi
const INSTANCE_ID_PATTERNS = [
  /instance\s*#(\d+)/gi,
  /instance:\s*[^()]*\(#(\d+)\)/gi,
  /new instance ID:\s*(\d+)/gi
]

function extractLogInstanceIds(content: string): number[] {
  const ids = new Set<number>()

  for (const pattern of INSTANCE_ID_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of content.matchAll(pattern)) {
      const id = Number(match[1])
      if (Number.isSafeInteger(id) && id > 0) {
        ids.add(id)
      }
    }
  }

  return Array.from(ids)
}

async function inferLogInstanceId(userId: number | null, content: string): Promise<number | null> {
  const instanceIds = extractLogInstanceIds(content)
  if (instanceIds.length === 1) {
    const instance = await prisma.instance.findUnique({
      where: { id: instanceIds[0] },
      select: { id: true, userId: true }
    })

    if (instance && (userId === null || instance.userId === userId)) {
      return instance.id
    }
  }

  const names = Array.from(content.matchAll(INSTANCE_NAME_PATTERN))
    .map(match => match[1]?.trim())
    .filter((name): name is string => Boolean(name))

  const uniqueNames = Array.from(new Set(names))
  if (uniqueNames.length !== 1) return null

  const matches = await prisma.instance.findMany({
    where: {
      name: uniqueNames[0],
      ...(userId !== null ? { userId } : {})
    },
    select: { id: true },
    take: 2
  })

  return matches.length === 1 ? matches[0].id : null
}

// ==================== 基础日志函数 ====================

/**
 * 创建日志记录（基础函数）
 */
export async function createLog(
  userId: number | null,
  module: string,
  action: string,
  content: string,
  result: string,
  options: CreateLogOptions = {}
): Promise<void> {
  try {
    const instanceId = options.instanceId !== undefined
      ? options.instanceId
      : await inferLogInstanceId(userId, content)

    await prisma.log.create({
      data: {
        userId: userId ?? null,
        instanceId: instanceId ?? null,
        module,
        action,
        content,
        result
      }
    })
  } catch (error) {
    // 日志记录失败不应该影响主业务流程，只打印错误
    console.error('日志记录失败:', error)
  }
}

// ==================== 便捷日志函数 ====================

/**
 * 记录成功操作日志
 */
export async function logSuccess(
  userId: number | null,
  module: string,
  action: string,
  content: string,
  options?: CreateLogOptions
): Promise<void> {
  await createLog(userId, module, action, content, LogResult.SUCCESS, options)
}

/**
 * 记录失败操作日志
 */
export async function logFailure(
  userId: number | null,
  module: string,
  action: string,
  content: string,
  options?: CreateLogOptions
): Promise<void> {
  await createLog(userId, module, action, content, LogResult.FAILED, options)
}

/**
 * 记录警告日志
 */
export async function logWarning(
  userId: number | null,
  module: string,
  action: string,
  content: string,
  options?: CreateLogOptions
): Promise<void> {
  await createLog(userId, module, action, content, LogResult.WARNING, options)
}

function combineWhereWithAnd(where: Prisma.LogWhereInput, condition: Prisma.LogWhereInput): void {
  const existingAnd = Array.isArray(where.AND) ? where.AND : []
  const base: Prisma.LogWhereInput = { ...where }
  delete base.AND

  const nextAnd: Prisma.LogWhereInput[] = []
  if (Object.keys(base).length > 0) nextAnd.push(base)
  nextAnd.push(...existingAnd, condition)

  const mutableWhere = where as Record<string, unknown>
  for (const key of Object.keys(mutableWhere)) {
    delete mutableWhere[key]
  }

  if (nextAnd.length === 1) {
    Object.assign(where, nextAnd[0])
  } else {
    where.AND = nextAnd
  }
}

/**
 * 分页获取日志
 */
export async function getLogsPaginated(options: {
  page?: number
  pageSize?: number
  module?: string
  userId?: number
  startDate?: string
  endDate?: string
  search?: string
  instanceId?: number
  instanceName?: string
} = {}): Promise<{
  items: Log[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const {
    page = 1,
    pageSize = 20,
    module,
    userId,
    startDate,
    endDate,
    search,
    instanceId,
    instanceName
  } = options
  const safePage = Number.isInteger(page) && page > 0 ? page : 1
  const safePageSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 20
  const safeModule = normalizeLogFilterValue(module, LOG_MODULE_FILTER_MAX_LENGTH)
  const safeSearch = normalizeLogFilterValue(search, LOG_SEARCH_FILTER_MAX_LENGTH)
  const safeInstanceName = normalizeLogFilterValue(instanceName, LOG_INSTANCE_NAME_FILTER_MAX_LENGTH)
  const safeStartDate = parseValidDateFilter(startDate)
  const safeEndDate = parseValidDateFilter(endDate)

  const where: Prisma.LogWhereInput = {}

  if (safeModule) {
    where.module = safeModule
  }

  if (userId !== undefined) {
    where.userId = userId
  }

  if (safeStartDate || safeEndDate) {
    where.createdAt = {
      ...(safeStartDate ? { gte: safeStartDate } : {}),
      ...(safeEndDate ? { lte: safeEndDate } : {})
    }
  }

  if (safeSearch) {
    where.OR = [
      { content: { contains: safeSearch, mode: 'insensitive' } },
      { action: { contains: safeSearch, mode: 'insensitive' } },
      { user: { username: { contains: safeSearch, mode: 'insensitive' } } }
    ]
  }

  if (instanceId !== undefined) {
    combineWhereWithAnd(where, { instanceId })
  } else if (safeInstanceName) {
    combineWhereWithAnd(where, { content: { contains: `instance "${safeInstanceName}"`, mode: 'insensitive' } })
  }

  // 获取总数
  const total = await prisma.log.count({ where })

  // 获取数据（包含用户名）
  const logs = await prisma.log.findMany({
    where,
    include: {
      user: {
        select: {
          username: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    skip: (safePage - 1) * safePageSize,
    take: safePageSize
  })

  return {
    items: logs.map(log => ({
      id: log.id,
      user_id: log.userId,
      instance_id: log.instanceId,
      username: log.user?.username || null,
      module: log.module,
      action: log.action,
      content: log.content,
      result: log.result,
      created_at: log.createdAt.toISOString()
    })),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.ceil(total / safePageSize)
  }
}

/**
 * 获取日志模块列表
 */
export async function getLogModules(): Promise<string[]> {
  const modules = await prisma.log.findMany({
    select: {
      module: true
    },
    distinct: ['module'],
    orderBy: {
      module: 'asc'
    }
  })

  return modules.map(m => m.module)
}

/**
 * 清理旧的操作日志（保留最近 N 天）
 * 默认保留 90 天用于审计
 */
export async function cleanOldLogs(days: number = 90): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  const result = await prisma.log.deleteMany({
    where: {
      createdAt: { lt: cutoffDate }
    }
  })

  return result.count
}
