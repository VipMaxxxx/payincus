import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { RedeemCodeType, UserLifecycleTagKey } from '@prisma/client'
import { apiError, ErrorCode } from '../lib/errors.js'
import { prisma } from '../db/prisma.js'
import {
  addLifecycleTag,
  getLifecycleOverview,
  getLifecycleUserSummary,
  getUserLifecycleOffers,
  issueLifecycleRedeemCode,
  listLifecycleTags,
  listLifecycleUsers,
  refreshLifecycleSegments,
  removeLifecycleTag,
  sendLifecycleReminder,
  sendLifecycleReminderToSegment,
  syncLifecycleEvents,
  USER_LIFECYCLE_TAGS
} from '../db/user-lifecycle.js'
import { CODE_VALUE_RANGES } from '../db/redeem-codes.js'

const POSITIVE_ID_PATTERN = /^[1-9]\d*$/
const TAG_KEYS = new Set(USER_LIFECYCLE_TAGS.map(tag => tag.key))
const CODE_TYPES = new Set<RedeemCodeType>(['c', 'r', 'd', 't'])
const MAX_MESSAGE_LENGTH = 1000

function parsePositiveId(value: string): number | null {
  if (!POSITIVE_ID_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function normalizeTagKey(value: unknown): UserLifecycleTagKey | null {
  return typeof value === 'string' && TAG_KEYS.has(value as UserLifecycleTagKey)
    ? value as UserLifecycleTagKey
    : null
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001F\u007F]/.test(trimmed)) return null
  return trimmed
}

function getActor(request: FastifyRequest): { id: number; username: string } {
  const user = request.user as { id: number; username?: string }
  return { id: user.id, username: user.username || `admin#${user.id}` }
}

async function ensureTargetUser(userId: number, reply: FastifyReply): Promise<boolean> {
  const exists = await prisma.user.count({ where: { id: userId, role: 'user' } })
  if (exists === 0) {
    reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    return false
  }
  return true
}

export default async function userLifecycleRoutes(fastify: FastifyInstance) {
  fastify.get('/api/admin/user-lifecycle/overview', {
    onRequest: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async () => getLifecycleOverview())

  fastify.get('/api/admin/user-lifecycle/tags', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => ({ tags: await listLifecycleTags() }))

  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      tag?: string
      segment?: string
      minRecharge?: string
      maxRecharge?: string
      minInstances?: string
      maxInstances?: string
      registeredFrom?: string
      registeredTo?: string
      activeState?: 'active' | 'inactive'
    }
  }>('/api/admin/user-lifecycle/users', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => listLifecycleUsers({
    page: parseOptionalNumber(request.query.page),
    pageSize: parseOptionalNumber(request.query.pageSize),
    search: request.query.search,
    tag: request.query.tag,
    segment: request.query.segment,
    minRecharge: parseOptionalNumber(request.query.minRecharge),
    maxRecharge: parseOptionalNumber(request.query.maxRecharge),
    minInstances: parseOptionalNumber(request.query.minInstances),
    maxInstances: parseOptionalNumber(request.query.maxInstances),
    registeredFrom: parseOptionalDate(request.query.registeredFrom),
    registeredTo: parseOptionalDate(request.query.registeredTo),
    activeState: request.query.activeState
  }))

  fastify.get<{ Params: { userId: string } }>('/api/admin/user-lifecycle/users/:userId/summary', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const userId = parsePositiveId(request.params.userId)
    if (userId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid user ID'))
    }

    const summary = await getLifecycleUserSummary(userId)
    if (!summary) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }
    return summary
  })

  fastify.post<{ Params: { userId: string }; Body: { tagKey?: string; note?: string } }>('/api/admin/user-lifecycle/users/:userId/tags', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const userId = parsePositiveId(request.params.userId)
    const tagKey = normalizeTagKey(request.body?.tagKey)
    if (userId === null || !tagKey) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid user ID or tag key'))
    }
    if (!await ensureTargetUser(userId, reply)) return

    const note = request.body?.note === undefined ? undefined : normalizeText(request.body.note, 200)
    if (request.body?.note !== undefined && note === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid note'))
    }

    const tag = await addLifecycleTag(userId, tagKey, getActor(request), note ?? undefined)
    return { message: 'Tag added', tag }
  })

  fastify.delete<{ Params: { userId: string; tagKey: string } }>('/api/admin/user-lifecycle/users/:userId/tags/:tagKey', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const userId = parsePositiveId(request.params.userId)
    const tagKey = normalizeTagKey(request.params.tagKey)
    if (userId === null || !tagKey) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid user ID or tag key'))
    }
    if (!await ensureTargetUser(userId, reply)) return

    const tag = await removeLifecycleTag(userId, tagKey, getActor(request))
    return { message: 'Tag removed', tag }
  })

  fastify.post('/api/admin/user-lifecycle/segments/refresh', {
    onRequest: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async () => refreshLifecycleSegments())

  fastify.post('/api/admin/user-lifecycle/events/sync', {
    onRequest: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async () => syncLifecycleEvents())

  fastify.post<{
    Params: { userId: string }
    Body: {
      hostId?: number
      codeType?: RedeemCodeType
      codeValue?: number
      expiresInDays?: number
      remark?: string
    }
  }>('/api/admin/user-lifecycle/users/:userId/redeem-codes', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const userId = parsePositiveId(request.params.userId)
    const { hostId, codeType, codeValue, expiresInDays = 14, remark } = request.body ?? {}
    if (userId === null || !Number.isSafeInteger(hostId) || !codeType || !CODE_TYPES.has(codeType)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid target, host or code type'))
    }
    if (!await ensureTargetUser(userId, reply)) return

    const normalizedHostId = hostId as number
    const normalizedCodeType = codeType as RedeemCodeType
    const normalizedCodeValue = codeValue as number
    const normalizedExpiresInDays = expiresInDays as number

    const range = CODE_VALUE_RANGES[normalizedCodeType]
    if (!Number.isSafeInteger(normalizedCodeValue) || normalizedCodeValue < range.min || normalizedCodeValue > range.max) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid code value'))
    }
    if (!Number.isSafeInteger(normalizedExpiresInDays) || normalizedExpiresInDays < 1 || normalizedExpiresInDays > 365) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid expiry days'))
    }

    const host = await prisma.host.findUnique({ where: { id: normalizedHostId }, select: { id: true } })
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    const normalizedRemark = remark === undefined ? undefined : normalizeText(remark, 200)
    if (remark !== undefined && normalizedRemark === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid remark'))
    }

    const code = await issueLifecycleRedeemCode({
      userId,
      hostId: normalizedHostId,
      codeType: normalizedCodeType,
      codeValue: normalizedCodeValue,
      expiresInDays: normalizedExpiresInDays,
      remark: normalizedRemark ?? undefined,
      actor: getActor(request)
    })
    return { message: 'Redeem code issued', code }
  })

  fastify.post<{
    Body: { userIds?: number[]; title?: string; content?: string; confirm?: boolean }
  }>('/api/admin/user-lifecycle/reminders', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const { userIds, title, content, confirm } = request.body ?? {}
    const normalizedTitle = normalizeText(title, 80)
    const normalizedContent = normalizeText(content, MAX_MESSAGE_LENGTH)
    if (!confirm || !Array.isArray(userIds) || userIds.length === 0 || userIds.length > 100 || !normalizedTitle || !normalizedContent) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid reminder request'))
    }

    return sendLifecycleReminder({
      userIds,
      title: normalizedTitle,
      content: normalizedContent,
      actor: getActor(request)
    })
  })

  fastify.post<{
    Params: { segmentKey: string }
    Body: { title?: string; content?: string; confirm?: boolean }
  }>('/api/admin/user-lifecycle/segments/:segmentKey/reminders', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const normalizedTitle = normalizeText(request.body?.title, 80)
    const normalizedContent = normalizeText(request.body?.content, MAX_MESSAGE_LENGTH)
    if (!request.body?.confirm || !normalizedTitle || !normalizedContent) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid reminder request'))
    }

    return sendLifecycleReminderToSegment({
      segmentKey: request.params.segmentKey,
      title: normalizedTitle,
      content: normalizedContent,
      actor: getActor(request)
    })
  })

  fastify.get('/api/user-lifecycle/my-offers', {
    onRequest: [fastify.authenticateUser]
  }, async (request) => {
    const user = request.user as { id: number }
    return { offers: await getUserLifecycleOffers(user.id) }
  })
}
