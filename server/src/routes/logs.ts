/**
 * 日志管理路由
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getLogsPaginated, getLogModules } from '../db/logs.js'
import { ErrorCode, apiError } from '../lib/errors.js'

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/
const LOG_MODULE_FILTER_MAX_LENGTH = 64
const LOG_SEARCH_FILTER_MAX_LENGTH = 128
const LOG_INSTANCE_NAME_FILTER_MAX_LENGTH = 128

function parsePositiveInteger(value: string | null | undefined): number | null {
  if (!value || !POSITIVE_INTEGER_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveIntegerQuery(value: string | undefined, fallback: number): number {
  return parsePositiveInteger(value) ?? fallback
}

function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number {
  return Math.min(parsePositiveIntegerQuery(value, fallback), max)
}

function normalizeLogFilter(value: string | null | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

export default async function logRoutes(fastify: FastifyInstance) {
  /**
   * 获取日志列表（分页、筛选、搜索）
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      module?: string | null
      search?: string | null
      instanceId?: string | null
      instanceName?: string | null
    }
  }>('/', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      module?: string | null
      search?: string | null
      instanceId?: string | null
      instanceName?: string | null
    }
  }>, reply: FastifyReply) => {
    const { page = '1', pageSize = '20', module = null, search = null, instanceId = null, instanceName = null } = request.query
    const userId = request.user.role === 'admin' ? null : request.user.id
    const instanceIdNum = parsePositiveInteger(instanceId)

    if (instanceId !== null && !instanceIdNum) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const result = await getLogsPaginated({
      userId: userId || undefined,
      module: normalizeLogFilter(module, LOG_MODULE_FILTER_MAX_LENGTH),
      page: parsePositiveIntegerQuery(page, 1),
      pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100),
      search: normalizeLogFilter(search, LOG_SEARCH_FILTER_MAX_LENGTH),
      instanceId: instanceIdNum ?? undefined,
      instanceName: normalizeLogFilter(instanceName, LOG_INSTANCE_NAME_FILTER_MAX_LENGTH)
    })

    return {
      success: true,
      logs: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    }
  })

  /**
   * 获取可用的模块列表（用于筛选）
   * 普通用户只能看到与自己相关的模块
   */
  fastify.get('/modules', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    // 管理员可以看到所有模块
    if (request.user.role === 'admin') {
      const modules = await getLogModules()
      return { success: true, modules }
    }

    // 普通用户只能看到与自己相关的模块
    const userModules = [
      'security',
      'instance',
      'snapshot',
      'backup',
      'personal',
      'ssh_key',
      'notification'
    ]

    return { success: true, modules: userModules }
  })
}
