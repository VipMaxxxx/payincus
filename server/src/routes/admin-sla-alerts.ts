import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type SlaAlertActionType, type SlaAlertObjectType, type SlaAlertSeverity, type SlaAlertStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { sanitizeTokensInString } from '../lib/log-sanitizer.js'

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20
const NOTE_MAX_LENGTH = 500
const SEARCH_MAX_LENGTH = 100
const AGENT_STALE_MINUTES = 30
const RECENT_LOOKBACK_HOURS = 24

const ALERT_STATUSES = new Set<SlaAlertStatus>(['open', 'investigating', 'recovered', 'ignored'])
const ALERT_SEVERITIES = new Set<SlaAlertSeverity>(['info', 'warning', 'critical'])

type AlertQuery = {
  page?: string
  pageSize?: string
  status?: string
  severity?: string
  module?: string
  search?: string
}

type RouteIdParams = { id: string }

type AlertActionBody = {
  note?: string
  status?: string
  minutes?: number
}

type RuleUpdateBody = {
  enabled?: boolean
  severity?: string
  thresholdMinutes?: number | null
  thresholdCount?: number | null
  dedupeMinutes?: number
  silenceMinutes?: number | null
}

type AlertSeed = {
  code: string
  module: string
  title: string
  description: string
  severity: SlaAlertSeverity
  thresholdMinutes?: number
  thresholdCount?: number
  dedupeMinutes?: number
}

type AlertDetection = {
  ruleCode: string
  module: string
  severity: SlaAlertSeverity
  objectType: SlaAlertObjectType
  objectId?: number | null
  objectLabel?: string | null
  fingerprint: string
  title: string
  message: string
  detail?: Prisma.InputJsonValue
}

const DEFAULT_RULES: AlertSeed[] = [
  {
    code: 'host.offline',
    module: 'host',
    title: '节点离线',
    description: '节点状态不是在线时触发。',
    severity: 'critical',
    dedupeMinutes: 30
  },
  {
    code: 'agent.offline',
    module: 'agent',
    title: 'Agent 离线',
    description: 'Agent 未启用在线状态时触发。',
    severity: 'warning',
    dedupeMinutes: 30
  },
  {
    code: 'agent.heartbeat_stale',
    module: 'agent',
    title: 'Agent 心跳过期',
    description: 'Agent 超过 30 分钟未上报心跳时触发。',
    severity: 'warning',
    thresholdMinutes: AGENT_STALE_MINUTES,
    dedupeMinutes: 30
  },
  {
    code: 'instance.task_failed',
    module: 'delivery',
    title: '实例任务失败',
    description: '最近 24 小时实例任务失败时触发。',
    severity: 'warning',
    thresholdMinutes: RECENT_LOOKBACK_HOURS * 60,
    dedupeMinutes: 30
  },
  {
    code: 'payment.order_failed',
    module: 'payment',
    title: '充值订单失败',
    description: '最近 24 小时充值订单失败时触发。',
    severity: 'critical',
    thresholdMinutes: RECENT_LOOKBACK_HOURS * 60,
    dedupeMinutes: 30
  },
  {
    code: 'notification.failed',
    module: 'notification',
    title: '通知发送失败',
    description: '最近 24 小时通知日志失败时触发。',
    severity: 'warning',
    thresholdMinutes: RECENT_LOOKBACK_HOURS * 60,
    dedupeMinutes: 30
  },
  {
    code: 'smtp.failed',
    module: 'mail',
    title: '邮件投递任务失败',
    description: '最近 24 小时节点通知邮件任务失败时触发。',
    severity: 'warning',
    thresholdMinutes: RECENT_LOOKBACK_HOURS * 60,
    dedupeMinutes: 30
  },
  {
    code: 'ota.failed',
    module: 'system_update',
    title: 'OTA 更新失败',
    description: '最近 24 小时系统更新任务失败时触发。',
    severity: 'critical',
    thresholdMinutes: RECENT_LOOKBACK_HOURS * 60,
    dedupeMinutes: 30
  }
]

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !POSITIVE_ROUTE_ID_PATTERN.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function normalizePageSize(value: string | undefined): number {
  return Math.min(parsePositiveInteger(value, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
}

function normalizeSearch(value: string | undefined): string | undefined {
  const search = value?.trim()
  return search ? search.slice(0, SEARCH_MAX_LENGTH) : undefined
}

function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('备注必须是字符串')
  const note = sanitizeTokensInString(value.trim())
  if (note.length > NOTE_MAX_LENGTH) throw new Error(`备注不能超过 ${NOTE_MAX_LENGTH} 字符`)
  return note || null
}

function normalizeStatus(value: string | undefined): SlaAlertStatus | undefined {
  if (!value || value === 'all') return undefined
  return ALERT_STATUSES.has(value as SlaAlertStatus) ? value as SlaAlertStatus : undefined
}

function normalizeSeverity(value: string | undefined): SlaAlertSeverity | undefined {
  if (!value || value === 'all') return undefined
  return ALERT_SEVERITIES.has(value as SlaAlertSeverity) ? value as SlaAlertSeverity : undefined
}

function serializeDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function serializeRule(rule: any) {
  return {
    id: rule.id,
    code: rule.code,
    module: rule.module,
    title: rule.title,
    description: rule.description,
    severity: rule.severity,
    enabled: rule.enabled,
    thresholdMinutes: rule.thresholdMinutes,
    thresholdCount: rule.thresholdCount,
    dedupeMinutes: rule.dedupeMinutes,
    notificationChannels: rule.notificationChannels,
    silenceUntil: serializeDate(rule.silenceUntil),
    createdAt: serializeDate(rule.createdAt),
    updatedAt: serializeDate(rule.updatedAt)
  }
}

function serializeAlert(event: any) {
  return {
    id: event.id,
    ruleCode: event.ruleCode,
    module: event.module,
    severity: event.severity,
    status: event.status,
    objectType: event.objectType,
    objectId: event.objectId,
    objectLabel: event.objectLabel,
    fingerprint: event.fingerprint,
    title: event.title,
    message: event.message,
    detail: event.detail,
    triggerCount: event.triggerCount,
    firstTriggeredAt: serializeDate(event.firstTriggeredAt),
    lastTriggeredAt: serializeDate(event.lastTriggeredAt),
    recoveredAt: serializeDate(event.recoveredAt),
    silencedUntil: serializeDate(event.silencedUntil),
    handledByUserId: event.handledByUserId,
    handledByUsername: event.handledByUsername,
    handledAt: serializeDate(event.handledAt),
    note: event.note,
    createdAt: serializeDate(event.createdAt),
    updatedAt: serializeDate(event.updatedAt),
    actions: event.actions?.map((action: any) => ({
      id: action.id,
      actionType: action.actionType,
      actorUserId: action.actorUserId,
      actorUsername: action.actorUsername,
      note: action.note,
      detail: action.detail,
      createdAt: serializeDate(action.createdAt)
    })) || []
  }
}

async function seedDefaultRules() {
  await Promise.all(DEFAULT_RULES.map(rule =>
    prisma.slaAlertRule.upsert({
      where: { code: rule.code },
      update: {},
      create: {
        code: rule.code,
        module: rule.module,
        title: rule.title,
        description: rule.description,
        severity: rule.severity,
        thresholdMinutes: rule.thresholdMinutes ?? null,
        thresholdCount: rule.thresholdCount ?? null,
        dedupeMinutes: rule.dedupeMinutes ?? 30
      }
    })
  ))
}

async function addAlertAction(
  eventId: number,
  actionType: SlaAlertActionType,
  actor: { id?: number | null; username?: string | null } | null,
  note?: string | null,
  detail?: Prisma.InputJsonValue
) {
  await prisma.slaAlertAction.create({
    data: {
      eventId,
      actionType,
      actorUserId: actor?.id ?? null,
      actorUsername: actor?.username ?? null,
      note: note || null,
      detail: detail ?? Prisma.JsonNull
    }
  })
}

async function upsertDetection(detection: AlertDetection, ruleMap: Map<string, any>) {
  const rule = ruleMap.get(detection.ruleCode)
  if (!rule || !rule.enabled) return { created: false, merged: false, skipped: true }
  const now = new Date()
  if (rule.silenceUntil && rule.silenceUntil > now) return { created: false, merged: false, skipped: true }

  const existing = await prisma.slaAlertEvent.findUnique({
    where: {
      ruleCode_fingerprint: {
        ruleCode: detection.ruleCode,
        fingerprint: detection.fingerprint
      }
    }
  })

  const data = {
    module: detection.module,
    severity: detection.severity,
    objectType: detection.objectType,
    objectId: detection.objectId ?? null,
    objectLabel: detection.objectLabel ?? null,
    title: sanitizeTokensInString(detection.title),
    message: sanitizeTokensInString(detection.message),
    detail: detection.detail ?? Prisma.JsonNull,
    lastTriggeredAt: now
  }

  if (!existing) {
    const created = await prisma.slaAlertEvent.create({
      data: {
        ruleCode: detection.ruleCode,
        fingerprint: detection.fingerprint,
        status: 'open',
        ...data
      }
    })
    await addAlertAction(created.id, 'detected', null, null, { ruleCode: detection.ruleCode })
    return { created: true, merged: false, skipped: false }
  }

  if (existing.status === 'ignored') return { created: false, merged: false, skipped: true }

  const updated = await prisma.slaAlertEvent.update({
    where: { id: existing.id },
    data: {
      ...data,
      status: existing.status === 'recovered' ? 'open' : existing.status,
      recoveredAt: existing.status === 'recovered' ? null : existing.recoveredAt,
      triggerCount: { increment: 1 }
    }
  })
  await addAlertAction(updated.id, 'merged', null, null, { ruleCode: detection.ruleCode, triggerCount: updated.triggerCount })
  return { created: false, merged: true, skipped: false }
}

async function collectDetections(): Promise<AlertDetection[]> {
  const now = new Date()
  const since = new Date(now.getTime() - RECENT_LOOKBACK_HOURS * 60 * 60 * 1000)
  const staleBefore = new Date(now.getTime() - AGENT_STALE_MINUTES * 60 * 1000)

  const [
    offlineHosts,
    offlineAgents,
    staleAgents,
    failedTasks,
    failedRecharges,
    failedNotifications,
    failedEmailTasks,
    failedUpdates
  ] = await Promise.all([
    prisma.host.findMany({
      where: { status: { not: 'online' } },
      select: { id: true, name: true, status: true, location: true, countryCode: true }
    }),
    prisma.hostAgent.findMany({
      where: { enabled: true, status: { not: 'online' } },
      select: { id: true, hostId: true, status: true, version: true, lastSeenAt: true, host: { select: { name: true } } }
    }),
    prisma.hostAgent.findMany({
      where: {
        enabled: true,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }]
      },
      select: { id: true, hostId: true, status: true, version: true, lastSeenAt: true, host: { select: { name: true } } }
    }),
    prisma.instanceTask.findMany({
      where: {
        status: 'FAILED',
        OR: [{ finishedAt: { gte: since } }, { createdAt: { gte: since } }]
      },
      orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        taskType: true,
        error: true,
        instanceId: true,
        hostId: true,
        userId: true,
        finishedAt: true,
        createdAt: true,
        instance: { select: { name: true } }
      }
    }),
    prisma.rechargeRecord.findMany({
      where: { status: 'failed', updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, orderNo: true, failReason: true, amount: true, updatedAt: true }
    }),
    prisma.notificationLog.findMany({
      where: { status: 'failed', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        channelId: true,
        eventType: true,
        error: true,
        createdAt: true,
        channel: { select: { type: true, name: true } }
      }
    }),
    prisma.hostNotificationEmailTask.findMany({
      where: { status: 'FAILED', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, hostId: true, hostName: true, lastError: true, createdAt: true }
    }),
    prisma.systemUpdateTask.findMany({
      where: { status: 'failed', updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, targetVersion: true, fromVersion: true, errorMessage: true, updatedAt: true }
    })
  ])

  const detections: AlertDetection[] = []

  for (const host of offlineHosts) {
    detections.push({
      ruleCode: 'host.offline',
      module: 'host',
      severity: 'critical',
      objectType: 'host',
      objectId: host.id,
      objectLabel: host.name,
      fingerprint: `host:${host.id}`,
      title: `节点离线：${host.name}`,
      message: `节点状态为 ${host.status}，请检查 Incus API、网络和 Agent。`,
      detail: { hostId: host.id, status: host.status, location: host.location, countryCode: host.countryCode }
    })
  }

  for (const agent of offlineAgents) {
    detections.push({
      ruleCode: 'agent.offline',
      module: 'agent',
      severity: 'warning',
      objectType: 'agent',
      objectId: agent.id,
      objectLabel: agent.host?.name || `Host #${agent.hostId}`,
      fingerprint: `agent:${agent.id}:offline`,
      title: `Agent 离线：${agent.host?.name || agent.hostId}`,
      message: `Agent 状态为 ${agent.status}，请检查安装、服务和网络。`,
      detail: { hostId: agent.hostId, status: agent.status, version: agent.version, lastSeenAt: agent.lastSeenAt?.toISOString() ?? null }
    })
  }

  for (const agent of staleAgents) {
    detections.push({
      ruleCode: 'agent.heartbeat_stale',
      module: 'agent',
      severity: 'warning',
      objectType: 'agent',
      objectId: agent.id,
      objectLabel: agent.host?.name || `Host #${agent.hostId}`,
      fingerprint: `agent:${agent.id}:heartbeat`,
      title: `Agent 心跳过期：${agent.host?.name || agent.hostId}`,
      message: `Agent 超过 ${AGENT_STALE_MINUTES} 分钟未上报心跳。`,
      detail: { hostId: agent.hostId, status: agent.status, version: agent.version, lastSeenAt: agent.lastSeenAt?.toISOString() ?? null }
    })
  }

  for (const task of failedTasks) {
    detections.push({
      ruleCode: 'instance.task_failed',
      module: 'delivery',
      severity: 'warning',
      objectType: 'task',
      objectId: task.id,
      objectLabel: task.instance?.name || `任务 #${task.id}`,
      fingerprint: `task:${task.id}`,
      title: `实例任务失败：${task.instance?.name || task.taskType}`,
      message: sanitizeTokensInString(task.error || `实例任务 ${task.taskType} 执行失败`),
      detail: {
        taskId: task.id,
        taskType: task.taskType,
        instanceId: task.instanceId,
        hostId: task.hostId,
        userId: task.userId,
        failedAt: task.finishedAt?.toISOString() ?? task.createdAt.toISOString()
      }
    })
  }

  for (const order of failedRecharges) {
    detections.push({
      ruleCode: 'payment.order_failed',
      module: 'payment',
      severity: 'critical',
      objectType: 'order',
      objectId: order.id,
      objectLabel: `充值订单 #${order.id}`,
      fingerprint: `recharge:${order.id}`,
      title: `充值订单失败：#${order.id}`,
      message: sanitizeTokensInString(order.failReason || '充值订单被标记为失败'),
      detail: { rechargeRecordId: order.id, amount: String(order.amount), updatedAt: order.updatedAt.toISOString() }
    })
  }

  for (const log of failedNotifications) {
    detections.push({
      ruleCode: 'notification.failed',
      module: 'notification',
      severity: 'warning',
      objectType: log.channel?.type === 'telegram' ? 'telegram' : 'notification_channel',
      objectId: log.channelId,
      objectLabel: log.channel?.name || `通知通道 #${log.channelId}`,
      fingerprint: `notification:${log.id}`,
      title: `通知发送失败：${log.channel?.name || log.eventType}`,
      message: sanitizeTokensInString(log.error || `事件 ${log.eventType} 发送失败`),
      detail: { logId: log.id, channelId: log.channelId, channelType: log.channel?.type || null, eventType: log.eventType, createdAt: log.createdAt.toISOString() }
    })
  }

  for (const task of failedEmailTasks) {
    detections.push({
      ruleCode: 'smtp.failed',
      module: 'mail',
      severity: 'warning',
      objectType: 'smtp',
      objectId: task.id,
      objectLabel: task.hostName,
      fingerprint: `smtp-task:${task.id}`,
      title: `邮件投递任务失败：${task.hostName}`,
      message: sanitizeTokensInString(task.lastError || '邮件投递任务失败'),
      detail: { taskId: task.id, hostId: task.hostId, createdAt: task.createdAt.toISOString() }
    })
  }

  for (const task of failedUpdates) {
    detections.push({
      ruleCode: 'ota.failed',
      module: 'system_update',
      severity: 'critical',
      objectType: 'system_update',
      objectId: task.id,
      objectLabel: task.targetVersion,
      fingerprint: `system-update:${task.id}`,
      title: `OTA 更新失败：${task.targetVersion}`,
      message: sanitizeTokensInString(task.errorMessage || '系统更新任务失败'),
      detail: { taskId: task.id, fromVersion: task.fromVersion, targetVersion: task.targetVersion, updatedAt: task.updatedAt.toISOString() }
    })
  }

  return detections
}

function getAlertWhere(query: AlertQuery): Prisma.SlaAlertEventWhereInput {
  const status = normalizeStatus(query.status)
  const severity = normalizeSeverity(query.severity)
  const module = query.module?.trim()
  const search = normalizeSearch(query.search)
  const where: Prisma.SlaAlertEventWhereInput = {}

  if (status) where.status = status
  if (severity) where.severity = severity
  if (module && module !== 'all') where.module = module.slice(0, 50)
  if (search) {
    const numericId = POSITIVE_ROUTE_ID_PATTERN.test(search) ? Number(search) : null
    where.OR = [
      ...(numericId && Number.isSafeInteger(numericId) ? [{ id: numericId }, { objectId: numericId }] : []),
      { title: { contains: search, mode: 'insensitive' } },
      { message: { contains: search, mode: 'insensitive' } },
      { objectLabel: { contains: search, mode: 'insensitive' } },
      { ruleCode: { contains: search, mode: 'insensitive' } }
    ]
  }

  return where
}

export default async function adminSlaAlertsRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async () => {
    await seedDefaultRules()
  })

  fastify.get('/overview', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const since = new Date(Date.now() - RECENT_LOOKBACK_HOURS * 60 * 60 * 1000)
    const [
      statusCounts,
      severityCounts,
      openCritical,
      rulesEnabled,
      recentAlerts,
      lastScanActions
    ] = await Promise.all([
      prisma.slaAlertEvent.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.slaAlertEvent.groupBy({
        by: ['severity'],
        where: { status: { in: ['open', 'investigating'] } },
        _count: { _all: true }
      }),
      prisma.slaAlertEvent.count({ where: { status: { in: ['open', 'investigating'] }, severity: 'critical' } }),
      prisma.slaAlertRule.count({ where: { enabled: true } }),
      prisma.slaAlertEvent.findMany({
        where: { status: { in: ['open', 'investigating'] } },
        orderBy: [{ severity: 'desc' }, { lastTriggeredAt: 'desc' }],
        take: 6
      }),
      prisma.slaAlertAction.findMany({
        where: { actionType: { in: ['detected', 'merged'] }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 1
      })
    ])

    const byStatus = Object.fromEntries(statusCounts.map(item => [item.status, item._count._all]))
    const bySeverity = Object.fromEntries(severityCounts.map(item => [item.severity, item._count._all]))

    return {
      summary: {
        open: byStatus.open || 0,
        investigating: byStatus.investigating || 0,
        recovered: byStatus.recovered || 0,
        ignored: byStatus.ignored || 0,
        critical: bySeverity.critical || 0,
        warning: bySeverity.warning || 0,
        info: bySeverity.info || 0,
        openCritical,
        rulesEnabled,
        lastScanAt: lastScanActions[0]?.createdAt?.toISOString() ?? null
      },
      recentAlerts: recentAlerts.map(serializeAlert)
    }
  })

  fastify.get<{ Querystring: AlertQuery }>('/alerts', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Querystring: AlertQuery }>, reply: FastifyReply) => {
    if (request.query.status && request.query.status !== 'all' && !normalizeStatus(request.query.status)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }
    if (request.query.severity && request.query.severity !== 'all' && !normalizeSeverity(request.query.severity)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const page = parsePositiveInteger(request.query.page, 1)
    const pageSize = normalizePageSize(request.query.pageSize)
    const where = getAlertWhere(request.query)
    const [alerts, total] = await Promise.all([
      prisma.slaAlertEvent.findMany({
        where,
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { lastTriggeredAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actions: { orderBy: { createdAt: 'desc' }, take: 20 } } as any
      }),
      prisma.slaAlertEvent.count({ where })
    ])

    return {
      alerts: alerts.map(serializeAlert),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  })

  fastify.get('/rules', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const rules = await prisma.slaAlertRule.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }]
    })
    return { rules: rules.map(serializeRule) }
  })

  fastify.post('/scan', {
    onRequest: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request) => {
    const actor = request.user!
    await seedDefaultRules()
    const rules = await prisma.slaAlertRule.findMany()
    const ruleMap = new Map(rules.map(rule => [rule.code, rule]))
    const detections = await collectDetections()
    const results = await Promise.all(detections.map(detection => upsertDetection(detection, ruleMap)))
    const created = results.filter(result => result.created).length
    const merged = results.filter(result => result.merged).length
    const skipped = results.filter(result => result.skipped).length
    await createLog(actor.id, 'sla_alert', 'sla_alert.scan', `执行 SLA 告警扫描，新增 ${created} 条，合并 ${merged} 条，跳过 ${skipped} 条`, 'success')
    return { scanned: detections.length, created, merged, skipped }
  })

  fastify.post<{ Params: RouteIdParams; Body: AlertActionBody }>('/alerts/:id/acknowledge', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveInteger(request.params.id, 0)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const note = normalizeNote(request.body?.note)
    const actor = request.user!
    const event = await prisma.slaAlertEvent.update({
      where: { id },
      data: {
        status: 'investigating',
        note,
        handledByUserId: actor.id,
        handledByUsername: actor.username,
        handledAt: new Date()
      }
    })
    await addAlertAction(event.id, 'acknowledge', actor, note)
    await createLog(actor.id, 'sla_alert', 'sla_alert.acknowledge', `认领 SLA 告警 #${event.id}：${event.title}`, 'success')
    return { alert: serializeAlert(event) }
  })

  fastify.post<{ Params: RouteIdParams; Body: AlertActionBody }>('/alerts/:id/resolve', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveInteger(request.params.id, 0)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const status = request.body?.status
    if (status !== 'recovered' && status !== 'ignored') return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const note = normalizeNote(request.body?.note)
    const actor = request.user!
    const event = await prisma.slaAlertEvent.update({
      where: { id },
      data: {
        status,
        note,
        recoveredAt: status === 'recovered' ? new Date() : null,
        handledByUserId: actor.id,
        handledByUsername: actor.username,
        handledAt: new Date()
      }
    })
    await addAlertAction(event.id, status === 'recovered' ? 'mark_recovered' : 'ignore', actor, note)
    await createLog(actor.id, 'sla_alert', `sla_alert.${status}`, `${status === 'recovered' ? '标记恢复' : '忽略'} SLA 告警 #${event.id}：${event.title}`, 'success')
    return { alert: serializeAlert(event) }
  })

  fastify.post<{ Params: RouteIdParams; Body: AlertActionBody }>('/alerts/:id/silence', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveInteger(request.params.id, 0)
    if (!id) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const minutes = Number(request.body?.minutes || 60)
    if (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 7 * 24 * 60) {
      return reply.code(400).send({ error: '静默时间必须在 5 分钟到 7 天之间' })
    }
    const note = normalizeNote(request.body?.note)
    const actor = request.user!
    const silencedUntil = new Date(Date.now() + minutes * 60 * 1000)
    const event = await prisma.slaAlertEvent.update({
      where: { id },
      data: {
        silencedUntil,
        note,
        handledByUserId: actor.id,
        handledByUsername: actor.username,
        handledAt: new Date()
      }
    })
    await addAlertAction(event.id, 'silence', actor, note, { minutes, silencedUntil: silencedUntil.toISOString() })
    await createLog(actor.id, 'sla_alert', 'sla_alert.silence', `静默 SLA 告警 #${event.id} ${minutes} 分钟：${event.title}`, 'success')
    return { alert: serializeAlert(event) }
  })

  fastify.patch<{ Params: { code: string }; Body: RuleUpdateBody }>('/rules/:code', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const code = request.params.code?.trim()
    if (!code || code.length > 80) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const data: Prisma.SlaAlertRuleUpdateInput = {}
    if (typeof request.body?.enabled === 'boolean') data.enabled = request.body.enabled
    if (request.body?.severity !== undefined) {
      const severity = normalizeSeverity(request.body.severity)
      if (!severity) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      data.severity = severity
    }
    if (request.body?.thresholdMinutes !== undefined) data.thresholdMinutes = request.body.thresholdMinutes
    if (request.body?.thresholdCount !== undefined) data.thresholdCount = request.body.thresholdCount
    if (request.body?.dedupeMinutes !== undefined) {
      const dedupe = Number(request.body.dedupeMinutes)
      if (!Number.isSafeInteger(dedupe) || dedupe < 5 || dedupe > 24 * 60) {
        return reply.code(400).send({ error: '合并窗口必须在 5 分钟到 24 小时之间' })
      }
      data.dedupeMinutes = dedupe
    }
    if (request.body?.silenceMinutes !== undefined) {
      const minutes = request.body.silenceMinutes === null ? null : Number(request.body.silenceMinutes)
      if (minutes === null) {
        data.silenceUntil = null
      } else {
        if (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 7 * 24 * 60) {
          return reply.code(400).send({ error: '规则静默时间必须在 5 分钟到 7 天之间' })
        }
        data.silenceUntil = new Date(Date.now() + minutes * 60 * 1000)
      }
    }

    const rule = await prisma.slaAlertRule.update({ where: { code }, data })
    const actor = request.user!
    await createLog(actor.id, 'sla_alert', 'sla_alert.rule_update', `更新 SLA 告警规则 ${rule.code}`, 'success')
    return { rule: serializeRule(rule) }
  })
}
