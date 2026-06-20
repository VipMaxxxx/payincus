/**
 * 日志管理路由
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getLogsPaginated, getLogModules } from '../db/logs.js'
import { ErrorCode, apiError } from '../lib/errors.js'

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
    const instanceIdNum = instanceId ? Number(instanceId) : undefined

    if (instanceId !== null && (!Number.isInteger(instanceIdNum) || instanceIdNum! <= 0)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const result = await getLogsPaginated({
      userId: userId || undefined,
      module: module || undefined,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      search: search || undefined,
      instanceId: instanceIdNum,
      instanceName: instanceName || undefined
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

