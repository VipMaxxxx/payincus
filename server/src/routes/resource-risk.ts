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
  releaseInstanceRisk,
  simulateResourceRiskPolicy,
  type RiskPolicy
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

function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

function bigintToString(value: bigint | number | string | null | undefined): string {
  if (value === null || value === undefined) return '0'
  return value.toString()
}

type ResourceTrendGranularity = 'hour' | 'day'

interface ResourceTrendSample {
  sampledAt: Date
  totalMbps: unknown
  pps: unknown
  cpuPercent: unknown
  totalBytesDelta: bigint | number | string | null
}

function getTrendBucketKey(date: Date, granularity: ResourceTrendGranularity): string {
  const bucket = new Date(date)
  if (granularity === 'hour') {
    bucket.setUTCMinutes(0, 0, 0)
  } else {
    bucket.setUTCHours(0, 0, 0, 0)
  }
  return bucket.toISOString()
}

function buildResourceTrend(samples: ResourceTrendSample[], granularity: ResourceTrendGranularity) {
  const buckets = new Map<string, {
    sampleCount: number
    totalMbpsSum: number
    totalMbpsMax: number
    ppsSum: number
    ppsMax: number
    cpuSum: number
    cpuCount: number
    cpuMax: number
    totalBytes: bigint
  }>()

  for (const sample of samples) {
    const key = getTrendBucketKey(sample.sampledAt, granularity)
    const bucket = buckets.get(key) || {
      sampleCount: 0,
      totalMbpsSum: 0,
      totalMbpsMax: 0,
      ppsSum: 0,
      ppsMax: 0,
      cpuSum: 0,
      cpuCount: 0,
      cpuMax: 0,
      totalBytes: 0n
    }
    const totalMbps = decimalToNumber(sample.totalMbps)
    const pps = decimalToNumber(sample.pps)
    const cpu = sample.cpuPercent === null || sample.cpuPercent === undefined ? null : decimalToNumber(sample.cpuPercent)

    bucket.sampleCount += 1
    bucket.totalMbpsSum += totalMbps
    bucket.totalMbpsMax = Math.max(bucket.totalMbpsMax, totalMbps)
    bucket.ppsSum += pps
    bucket.ppsMax = Math.max(bucket.ppsMax, pps)
    if (cpu !== null && Number.isFinite(cpu)) {
      bucket.cpuSum += cpu
      bucket.cpuCount += 1
      bucket.cpuMax = Math.max(bucket.cpuMax, cpu)
    }
    try {
      bucket.totalBytes += BigInt(sample.totalBytesDelta || 0)
    } catch {
      bucket.totalBytes += 0n
    }
    buckets.set(key, bucket)
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketStart, bucket]) => ({
      bucketStart,
      sampleCount: bucket.sampleCount,
      avgTotalMbps: bucket.sampleCount > 0 ? Number((bucket.totalMbpsSum / bucket.sampleCount).toFixed(2)) : 0,
      maxTotalMbps: Number(bucket.totalMbpsMax.toFixed(2)),
      avgPps: bucket.sampleCount > 0 ? Number((bucket.ppsSum / bucket.sampleCount).toFixed(2)) : 0,
      maxPps: Number(bucket.ppsMax.toFixed(2)),
      avgCpuPercent: bucket.cpuCount > 0 ? Number((bucket.cpuSum / bucket.cpuCount).toFixed(2)) : null,
      maxCpuPercent: bucket.cpuCount > 0 ? Number(bucket.cpuMax.toFixed(2)) : null,
      totalBytes: bucket.totalBytes.toString()
    }))
}

function parseScore(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return fallback
  return parsed
}

function parseBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseQosTiers(value: unknown): Array<{
  level: number
  bandwidthMbps: number
  score: number
  recoverScore: number
  minDurationMinutes: number
  cooldownMinutes: number
  allowFurtherDowngrade: boolean
  notifyUser: boolean
  restrictOrders: boolean
}> | null {
  if (!Array.isArray(value)) return null

  const tiers: Array<{
    level: number
    bandwidthMbps: number
    score: number
    recoverScore: number
    minDurationMinutes: number
    cooldownMinutes: number
    allowFurtherDowngrade: boolean
    notifyUser: boolean
    restrictOrders: boolean
  }> = []
  const levels = new Set<number>()
  const scores = new Set<number>()

  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    const level = Number(record.level)
    const bandwidthMbps = Number(record.bandwidthMbps)
    const score = Number(record.score)
    const recoverScore = Number(record.recoverScore)
    const minDurationMinutes = Number(record.minDurationMinutes)
    const cooldownMinutes = Number(record.cooldownMinutes)
    if (!Number.isInteger(level) || level <= 0) return null
    if (!Number.isFinite(bandwidthMbps) || bandwidthMbps <= 0) return null
    if (!Number.isInteger(score) || score < 1 || score > 100) return null
    if (!Number.isInteger(recoverScore) || recoverScore < 0 || recoverScore >= score) return null
    if (!Number.isInteger(minDurationMinutes) || minDurationMinutes <= 0) return null
    if (!Number.isInteger(cooldownMinutes) || cooldownMinutes <= 0) return null
    if (levels.has(level) || scores.has(score)) return null
    levels.add(level)
    scores.add(score)
    tiers.push({
      level,
      bandwidthMbps: Math.round(bandwidthMbps),
      score,
      recoverScore,
      minDurationMinutes,
      cooldownMinutes,
      allowFurtherDowngrade: parseBoolean(record.allowFurtherDowngrade, true),
      notifyUser: parseBoolean(record.notifyUser),
      restrictOrders: parseBoolean(record.restrictOrders)
    })
  }

  if (tiers.length === 0) return null
  return tiers.sort((a, b) => a.score - b.score)
}

function buildPolicyUpdate(body: Record<string, unknown>, policy: RiskPolicy, nextQosTiers: ReturnType<typeof parseQosTiers>) {
  return {
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

    const data = buildPolicyUpdate(body, policy, nextQosTiers)

    const updated = await prisma.resourceRiskPolicy.update({
      where: { id: policy.id },
      data
    })

    return { policy: updated }
  })

  fastify.post('/admin/resource-risk/policy/simulate', {
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

    const data = buildPolicyUpdate(body, policy, nextQosTiers)
    const result = await simulateResourceRiskPolicy({
      ...policy,
      ...data
    })

    return { result }
  })

  fastify.get('/admin/resource-risk/instances', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string; level?: string }
    const page = parsePage(query.page)
    const pageSize = parsePageSize(query.pageSize)
    const where = query.level ? { level: query.level } : {}

    const [rawItems, total] = await Promise.all([
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

    const userIds = Array.from(new Set(rawItems.map(item => item.userId)))
    const activeRestrictions = userIds.length > 0
      ? await prisma.userOrderRestriction.findMany({
        where: {
          userId: { in: userIds },
          status: 'active',
          restrictedCreate: true
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          status: true,
          reason: true,
          sourceInstanceId: true,
          ticketId: true,
          createdAt: true
        }
      })
      : []
    const restrictionByUserId = new Map<number, (typeof activeRestrictions)[number]>()
    for (const restriction of activeRestrictions) {
      if (!restrictionByUserId.has(restriction.userId)) {
        restrictionByUserId.set(restriction.userId, restriction)
      }
    }
    const items = rawItems.map(item => ({
      ...item,
      activeOrderRestriction: activeRestrictions.find(restriction => restriction.sourceInstanceId === item.instanceId) ?? null,
      activeAccountOrderRestriction: restrictionByUserId.get(item.userId) ?? null
    }))

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

  fastify.get('/admin/resource-risk/instances/:id/evidence', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const state = await prisma.instanceRiskState.findUnique({
      where: { instanceId: id },
      include: {
        instance: { select: { id: true, name: true, status: true, incusId: true } },
        user: { select: { id: true, username: true, status: true } },
        host: { select: { id: true, name: true, status: true } }
      }
    })
    if (!state) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '该实例没有资源风控状态'))

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [events, samples, trendSamples, restrictions, logs] = await Promise.all([
      prisma.instanceRiskEvent.findMany({
        where: { instanceId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          instance: { select: { id: true, name: true } },
          user: { select: { id: true, username: true } },
          host: { select: { id: true, name: true } }
        }
      }),
      prisma.instanceResourceSample.findMany({
        where: { instanceId: id },
        orderBy: { sampledAt: 'desc' },
        take: 48,
        select: {
          id: true,
          sampledAt: true,
          rxBytesDelta: true,
          txBytesDelta: true,
          totalBytesDelta: true,
          totalPacketsDelta: true,
          rxMbps: true,
          txMbps: true,
          totalMbps: true,
          pps: true,
          cpuPercent: true,
          source: true
        }
      }),
      prisma.instanceResourceSample.findMany({
        where: {
          instanceId: id,
          sampledAt: { gte: since7d }
        },
        orderBy: { sampledAt: 'desc' },
        take: 2000,
        select: {
          sampledAt: true,
          totalBytesDelta: true,
          totalMbps: true,
          pps: true,
          cpuPercent: true
        }
      }),
      prisma.userOrderRestriction.findMany({
        where: { sourceInstanceId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          user: { select: { id: true, username: true } },
          sourceInstance: { select: { id: true, name: true, status: true } }
        }
      }),
      prisma.log.findMany({
        where: {
          instanceId: id,
          action: { startsWith: 'resource_risk.' }
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          user: { select: { id: true, username: true } }
        }
      })
    ])

    return {
      state,
      events,
      samples: samples.map(sample => ({
        id: sample.id,
        sampledAt: sample.sampledAt,
        rxBytesDelta: bigintToString(sample.rxBytesDelta),
        txBytesDelta: bigintToString(sample.txBytesDelta),
        totalBytesDelta: bigintToString(sample.totalBytesDelta),
        totalPacketsDelta: bigintToString(sample.totalPacketsDelta),
        rxMbps: decimalToNumber(sample.rxMbps),
        txMbps: decimalToNumber(sample.txMbps),
        totalMbps: decimalToNumber(sample.totalMbps),
        pps: decimalToNumber(sample.pps),
        cpuPercent: sample.cpuPercent === null ? null : decimalToNumber(sample.cpuPercent),
        source: sample.source
      })),
      trends: {
        hourly24h: buildResourceTrend(
          trendSamples.filter(sample => sample.sampledAt >= since24h),
          'hour'
        ),
        daily7d: buildResourceTrend(trendSamples, 'day')
      },
      restrictions,
      auditLogs: logs.map(log => ({
        id: log.id,
        action: log.action,
        content: log.content,
        result: log.result,
        createdAt: log.createdAt,
        actor: log.user ? { id: log.user.id, username: log.user.username } : null
      }))
    }
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
