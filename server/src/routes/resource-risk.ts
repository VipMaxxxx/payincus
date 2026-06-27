import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../db/prisma.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { createTicket } from '../db/tickets.js'
import {
  evaluateInstanceRisk,
  manualLimitInstanceRisk,
  manualRestrictOrdersForInstanceRisk,
  manualSuspendInstanceRisk,
  manualUnsuspendInstanceRisk,
  releaseInstanceRisk
} from '../services/resource-risk.js'
import { getActiveOrderRestriction, releaseOrderRestriction } from '../services/user-order-restrictions.js'

const POSITIVE_ID_RE = /^[1-9]\d*$/

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value !== 'string' || !POSITIVE_ID_RE.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePage(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parsePageSize(value: unknown, fallback = 20): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 100)
}

function sanitizeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim().slice(0, 500) : fallback
}

function parseScore(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return fallback
  return parsed
}

function parseQosTiers(value: unknown): Array<{ level: number; bandwidthMbps: number; score: number }> | null {
  if (!Array.isArray(value)) return null

  const tiers: Array<{ level: number; bandwidthMbps: number; score: number }> = []
  const levels = new Set<number>()
  const scores = new Set<number>()

  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    const level = Number(record.level)
    const bandwidthMbps = Number(record.bandwidthMbps)
    const score = Number(record.score)
    if (!Number.isInteger(level) || level <= 0) return null
    if (!Number.isFinite(bandwidthMbps) || bandwidthMbps <= 0) return null
    if (!Number.isInteger(score) || score < 1 || score > 100) return null
    if (levels.has(level) || scores.has(score)) return null
    levels.add(level)
    scores.add(score)
    tiers.push({ level, bandwidthMbps: Math.round(bandwidthMbps), score })
  }

  if (tiers.length === 0) return null
  return tiers.sort((a, b) => a.score - b.score)
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = request.user as { id?: number; role?: string } | undefined
  if (!user?.id || user.role !== 'admin') {
    reply.code(403).send(apiError(ErrorCode.ADMIN_REQUIRED))
    return false
  }
  return true
}

export default async function resourceRiskRoutes(fastify: FastifyInstance) {
  fastify.get('/resource-risk/my-status', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = request.user as { id: number }
    const restriction = await getActiveOrderRestriction(user.id)
    const riskStates = await prisma.instanceRiskState.findMany({
      where: { userId: user.id },
      orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
      take: 20,
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

    return {
      restricted: Boolean(restriction),
      restriction,
      riskStates
    }
  })

  fastify.post('/resource-risk/review-ticket', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user as { id: number }
    const restriction = await getActiveOrderRestriction(user.id)
    if (!restriction) {
      return reply.code(400).send(apiError(ErrorCode.NOT_FOUND, '当前账号没有待审核的下单限制'))
    }

    const body = request.body as { content?: string } | undefined
    const userContent = sanitizeText(body?.content, '')
    const instanceName = restriction.sourceInstance?.name || `#${restriction.sourceInstanceId || '-'}`
    const result = await createTicket({
      userId: user.id,
      hostId: null,
      instanceId: restriction.sourceInstanceId ?? null,
      subject: `资源风控审核申请：${instanceName}`,
      category: 'abuse',
      priority: 'high',
      content: userContent || `账号因实例 ${instanceName} 触发资源风控限制下单，申请人工审核解除。`
    })

    await prisma.userOrderRestriction.update({
      where: { id: restriction.id },
      data: { ticketId: result.ticketId }
    })

    return {
      message: '审核工单已创建',
      ticket: {
        id: result.ticketId,
        messageId: result.messageId
      }
    }
  })

  fastify.get('/admin/resource-risk/overview', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const [policy, totalStates, highRisk, activeRestrictions, recentEvents] = await Promise.all([
      prisma.resourceRiskPolicy.findFirst({ orderBy: { id: 'asc' } }),
      prisma.instanceRiskState.count(),
      prisma.instanceRiskState.count({ where: { score: { gte: 70 } } }),
      prisma.userOrderRestriction.count({ where: { status: 'active' } }),
      prisma.instanceRiskEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          instance: { select: { id: true, name: true } },
          user: { select: { id: true, username: true } },
          host: { select: { id: true, name: true } }
        }
      })
    ])

    return {
      policy,
      counters: {
        totalStates,
        highRisk,
        activeRestrictions
      },
      recentEvents
    }
  })

  fastify.get('/admin/resource-risk/policy', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    let policy = await prisma.resourceRiskPolicy.findFirst({ orderBy: { id: 'asc' } })
    if (!policy) {
      policy = await prisma.resourceRiskPolicy.create({ data: { name: '默认策略' } })
    }
    return { policy }
  })

  fastify.put('/admin/resource-risk/policy', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>
    let policy = await prisma.resourceRiskPolicy.findFirst({ orderBy: { id: 'asc' } })
    if (!policy) {
      policy = await prisma.resourceRiskPolicy.create({ data: { name: '默认策略' } })
    }
    const nextQosTiers = parseQosTiers(body.qosTiers)
    if (Array.isArray(body.qosTiers) && !nextQosTiers) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_INPUT, 'QoS 档位配置无效'))
    }

    const data = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : policy.enabled,
      bandwidthWindowMinutes: parsePage(body.bandwidthWindowMinutes, policy.bandwidthWindowMinutes),
      bandwidthActiveMinutes: parsePage(body.bandwidthActiveMinutes, policy.bandwidthActiveMinutes),
      bandwidthThresholdMbps: parsePage(body.bandwidthThresholdMbps, policy.bandwidthThresholdMbps),
      cpuWindowMinutes: parsePage(body.cpuWindowMinutes, policy.cpuWindowMinutes),
      cpuActiveMinutes: parsePage(body.cpuActiveMinutes, policy.cpuActiveMinutes),
      cpuThresholdPercent: parsePage(body.cpuThresholdPercent, policy.cpuThresholdPercent),
      ppsThreshold: parsePage(body.ppsThreshold, policy.ppsThreshold),
      orderRestrictScore: parseScore(body.orderRestrictScore, policy.orderRestrictScore),
      autoSuspendScore: parseScore(body.autoSuspendScore, policy.autoSuspendScore),
      autoSuspendEnabled: typeof body.autoSuspendEnabled === 'boolean' ? body.autoSuspendEnabled : policy.autoSuspendEnabled,
      accountOrderRestrictEnabled: typeof body.accountOrderRestrictEnabled === 'boolean' ? body.accountOrderRestrictEnabled : policy.accountOrderRestrictEnabled,
      qosTiers: nextQosTiers ?? (policy.qosTiers ?? [])
    }

    const updated = await prisma.resourceRiskPolicy.update({
      where: { id: policy.id },
      data
    })

    return { policy: updated }
  })

  fastify.get('/admin/resource-risk/instances', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; level?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const where = query.level ? { level: query.level } : {}

    const [items, total] = await Promise.all([
      prisma.instanceRiskState.findMany({
        where,
        orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          instance: { select: { id: true, name: true, status: true, incusId: true } },
          user: { select: { id: true, username: true } },
          host: { select: { id: true, name: true } }
        }
      }),
      prisma.instanceRiskState.count({ where })
    ])

    return { items, total, page, pageSize }
  })

  fastify.get('/admin/resource-risk/events', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; instanceId?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const instanceId = parsePositiveId(query.instanceId)
    const where = instanceId ? { instanceId } : {}

    const [items, total] = await Promise.all([
      prisma.instanceRiskEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          instance: { select: { id: true, name: true } },
          user: { select: { id: true, username: true } },
          host: { select: { id: true, name: true } }
        }
      }),
      prisma.instanceRiskEvent.count({ where })
    ])

    return { items, total, page, pageSize }
  })

  fastify.get('/admin/resource-risk/order-restrictions', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; status?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const where = query.status ? { status: query.status } : {}

    const [items, total] = await Promise.all([
      prisma.userOrderRestriction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, username: true } },
          sourceInstance: { select: { id: true, name: true, status: true } }
        }
      }),
      prisma.userOrderRestriction.count({ where })
    ])

    return { items, total, page, pageSize }
  })

  fastify.post('/admin/resource-risk/instances/:id/evaluate', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const state = await evaluateInstanceRisk(id)
    return { state }
  })

  fastify.post('/admin/resource-risk/instances/:id/release', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const user = request.user as { id: number }
    const body = request.body as { reason?: string } | undefined
    const state = await releaseInstanceRisk({
      instanceId: id,
      actorUserId: user.id,
      reason: sanitizeText(body?.reason, '人工解除实例资源风控')
    })
    if (!state) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    return { state }
  })

  fastify.post('/admin/resource-risk/instances/:id/manual-qos', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const user = request.user as { id: number }
    const body = request.body as { bandwidthMbps?: number; reason?: string; restrictOrders?: boolean } | undefined
    const bandwidthMbps = Number(body?.bandwidthMbps)
    const reason = sanitizeText(body?.reason, '')
    if (!Number.isFinite(bandwidthMbps) || bandwidthMbps <= 0) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_INPUT, '限速 Mbps 必须大于 0'))
    }
    if (!reason) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_INPUT, '人工处置原因不能为空'))
    }

    const state = await manualLimitInstanceRisk({
      instanceId: id,
      actorUserId: user.id,
      bandwidthMbps,
      reason,
      restrictOrders: Boolean(body?.restrictOrders)
    })
    if (!state) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    return { state }
  })

  fastify.post('/admin/resource-risk/instances/:id/manual-suspend', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const user = request.user as { id: number }
    const body = request.body as { reason?: string; restrictOrders?: boolean; notifyUser?: boolean } | undefined
    const reason = sanitizeText(body?.reason, '')
    if (!reason) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_INPUT, '人工封禁原因不能为空'))
    }

    const state = await manualSuspendInstanceRisk({
      instanceId: id,
      actorUserId: user.id,
      reason,
      restrictOrders: body?.restrictOrders !== false,
      notifyUser: body?.notifyUser !== false
    })
    if (!state) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    return { state }
  })

  fastify.post('/admin/resource-risk/instances/:id/manual-unsuspend', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const user = request.user as { id: number }
    const body = request.body as { reason?: string; notifyUser?: boolean } | undefined
    const reason = sanitizeText(body?.reason, '')
    if (!reason) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_INPUT, '解除封禁原因不能为空'))
    }

    const state = await manualUnsuspendInstanceRisk({
      instanceId: id,
      actorUserId: user.id,
      reason,
      notifyUser: body?.notifyUser !== false
    })
    if (!state) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    return { state }
  })

  fastify.post('/admin/resource-risk/instances/:id/manual-order-restrict', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const user = request.user as { id: number }
    const body = request.body as { reason?: string } | undefined
    const reason = sanitizeText(body?.reason, '')
    if (!reason) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_INPUT, '限制下单原因不能为空'))
    }
    const restriction = await manualRestrictOrdersForInstanceRisk({
      instanceId: id,
      actorUserId: user.id,
      reason
    })
    if (!restriction) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    return { restriction }
  })

  fastify.post('/admin/resource-risk/order-restrictions/:id/release', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const body = request.body as { reason?: string; ticketId?: number } | undefined
    const user = request.user as { id: number }
    const restriction = await releaseOrderRestriction({
      restrictionId: id,
      actorUserId: user.id,
      reason: sanitizeText(body?.reason, '工单人工审核通过，恢复下单'),
      ticketId: body?.ticketId ?? null
    })
    return { restriction }
  })
}
