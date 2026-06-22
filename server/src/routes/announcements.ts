/**
 * 公告/通知历史记录路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as announcementsDb from '../db/announcements.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import type { AnnouncementType } from '@prisma/client'

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const announcementTypes = new Set<AnnouncementType>([
  'system_broadcast',
  'host_broadcast',
  'admin_message',
  'host_message'
])

function parsePositiveInteger(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) {
    return fallback
  }

  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    return fallback
  }

  return Math.min(parsed, max)
}

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseOptionalPositiveId(value: string | undefined): number | null | undefined {
  if (value === undefined) {
    return undefined
  }
  return parsePositiveRouteId(value)
}

function parseAnnouncementType(value: string | undefined): AnnouncementType | null | undefined {
  if (value === undefined) {
    return undefined
  }
  return announcementTypes.has(value as AnnouncementType) ? value as AnnouncementType : null
}

export default async function announcementsRoutes(fastify: FastifyInstance) {
  // 所有路由都需要认证
  fastify.addHook('onRequest', fastify.authenticate)

  /**
   * 获取公告历史列表（管理员）
   * GET /api/announcements
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      type?: string
    }
  }>('/', async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      type?: string
    }
  }>, reply: FastifyReply) => {
    // 检查管理员权限
    if (request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const { type } = request.query
    const parsedType = parseAnnouncementType(type)
    if (parsedType === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid announcement type'))
    }

    const result = await announcementsDb.getAnnouncementList({
      page: parsePositiveInteger(request.query.page, 1, 100000),
      pageSize: parsePositiveInteger(request.query.pageSize, 20, 100),
      type: parsedType,
    })

    return result
  })

  /**
   * 获取宿主机所有者的公告历史
   * GET /api/announcements/my
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      hostId?: string
    }
  }>('/my', async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      hostId?: string
    }
  }>, reply: FastifyReply) => {
    const hostId = parseOptionalPositiveId(request.query.hostId)
    if (hostId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const result = await announcementsDb.getHostOwnerAnnouncementList(
      request.user.id,
      {
        page: parsePositiveInteger(request.query.page, 1, 100000),
        pageSize: parsePositiveInteger(request.query.pageSize, 20, 100),
        hostId,
      }
    )

    return result
  })

  /**
   * 获取公告详情
   * GET /api/announcements/:id
   */
  fastify.get<{
    Params: { id: string }
  }>('/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const announcementId = parsePositiveRouteId(id)

    if (!announcementId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const announcement = await announcementsDb.getAnnouncementById(announcementId)

    if (!announcement) {
      return reply.code(404).send({ error: 'ANNOUNCEMENT_NOT_FOUND', message: 'Announcement not found' })
    }

    // 检查权限：管理员可以查看所有，宿主机所有者只能查看自己发送的
    if (request.user.role !== 'admin' && announcement.senderId !== request.user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    return announcement
  })
}
