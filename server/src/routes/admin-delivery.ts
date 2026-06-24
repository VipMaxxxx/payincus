import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  Prisma,
  type DeliveryAssuranceActionType,
  type DeliveryAssuranceCaseStatus,
  type DeliveryAssuranceIssueType,
  type InstanceTaskStatus,
  type InstanceTaskType
} from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createInstanceTask, InstanceTaskConflictError } from '../db/instance-tasks.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { sanitizeTokensInString } from '../lib/log-sanitizer.js'
import { sendNotification } from '../lib/notifier.js'

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const TASK_STATUSES = new Set<InstanceTaskStatus>(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
const CASE_STATUSES = new Set<DeliveryAssuranceCaseStatus>(['pending_manual', 'auto_retryable', 'in_progress', 'recovered', 'closed'])
const IDEMPOTENT_RETRY_TASKS = new Set<InstanceTaskType>(['start', 'stop', 'restart'])
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20
const NOTE_MAX_LENGTH = 500
const STALE_PROCESSING_MS = 30 * 60 * 1000

type DeliveryQuery = {
  page?: string
  pageSize?: string
  status?: string
  search?: string
}

type RouteIdParams = { id: string }

type CaseActionBody = {
  note?: string
  status?: string
  mode?: string
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !POSITIVE_ROUTE_ID_PATTERN.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function normalizePageSize(value: string | undefined): number {
  return Math.min(parsePositiveInteger(value, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
}

function normalizeStatuses(value: string | undefined): InstanceTaskStatus[] | undefined {
  if (!value) return undefined
  const statuses = value
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter((item): item is InstanceTaskStatus => TASK_STATUSES.has(item as InstanceTaskStatus))
  return statuses.length > 0 ? [...new Set(statuses)] : undefined
}

function normalizeSearch(value: string | undefined): string | undefined {
  const search = value?.trim()
  if (!search) return undefined
  return search.slice(0, 80)
}

function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('备注必须是字符串')
  const note = value.trim()
  if (note.length > NOTE_MAX_LENGTH) throw new Error(`备注不能超过 ${NOTE_MAX_LENGTH} 字符`)
  return note || null
}

function isStaleTask(task: { status: string; startedAt: Date | null }): boolean {
  return task.status === 'PROCESSING' && !!task.startedAt && task.startedAt.getTime() < Date.now() - STALE_PROCESSING_MS
}

function classifyTaskIssue(task: {
  taskType: InstanceTaskType
  status: InstanceTaskStatus
  startedAt: Date | null
  error: string | null
  instance?: { name: string } | null
}): {
  issueType: DeliveryAssuranceIssueType
  status: DeliveryAssuranceCaseStatus
  severity: string
  retryable: boolean
  title: string
  lastError: string | null
} | null {
  if (task.status === 'FAILED') {
    const retryable = IDEMPOTENT_RETRY_TASKS.has(task.taskType)
    return {
      issueType: 'task_failed',
      status: retryable ? 'auto_retryable' : 'pending_manual',
      severity: retryable ? 'warning' : 'critical',
      retryable,
      title: `交付任务失败：${task.instance?.name || task.taskType}`,
      lastError: task.error ? sanitizeTokensInString(task.error) : null
    }
  }

  if (isStaleTask(task)) {
    return {
      issueType: 'task_stale',
      status: 'pending_manual',
      severity: 'warning',
      retryable: false,
      title: `交付任务疑似卡住：${task.instance?.name || task.taskType}`,
      lastError: '任务处理超过 30 分钟'
    }
  }

  return null
}

function serializeCase(deliveryCase: any) {
  if (!deliveryCase) return null
  return {
    id: deliveryCase.id,
    taskId: deliveryCase.taskId,
    instanceId: deliveryCase.instanceId,
    hostId: deliveryCase.hostId,
    userId: deliveryCase.userId,
    status: deliveryCase.status,
    issueType: deliveryCase.issueType,
    severity: deliveryCase.severity,
    retryable: deliveryCase.retryable,
    retryTaskId: deliveryCase.retryTaskId,
    title: deliveryCase.title,
    lastError: deliveryCase.lastError,
    detail: deliveryCase.detail,
    note: deliveryCase.note,
    handledByUserId: deliveryCase.handledByUserId,
    handledByUsername: deliveryCase.handledByUsername,
    handledAt: deliveryCase.handledAt?.toISOString?.() ?? null,
    createdAt: deliveryCase.createdAt?.toISOString?.() ?? null,
    updatedAt: deliveryCase.updatedAt?.toISOString?.() ?? null
  }
}

async function addCaseAction(
  caseId: number,
  actionType: DeliveryAssuranceActionType,
  actor: { id?: number | null; username?: string | null } | null,
  note?: string | null,
  detail?: Prisma.InputJsonValue
) {
  await prisma.deliveryAssuranceAction.create({
    data: {
      caseId,
      actionType,
      actorUserId: actor?.id ?? null,
      actorUsername: actor?.username ?? null,
      note: note || null,
      detail: detail ?? Prisma.JsonNull
    }
  })
}

async function ensureCaseForTask(task: {
  id: number
  instanceId: number
  hostId: number
  userId: number
  taskType: InstanceTaskType
  status: InstanceTaskStatus
  progress: string | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  instance?: { name: string; status: string; image: string } | null
}) {
  const issue = classifyTaskIssue(task)
  if (!issue) return null

  const detail = {
    taskType: task.taskType,
    taskStatus: task.status,
    progress: task.progress,
    instanceStatus: task.instance?.status || null,
    image: task.instance?.image || null,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null,
    finishedAt: task.finishedAt?.toISOString() ?? null
  }

  const existing = await prisma.deliveryAssuranceCase.findUnique({
    where: { taskId: task.id }
  })

  if (!existing) {
    const created = await prisma.deliveryAssuranceCase.create({
      data: {
        taskId: task.id,
        instanceId: task.instanceId,
        hostId: task.hostId,
        userId: task.userId,
        status: issue.status,
        issueType: issue.issueType,
        severity: issue.severity,
        retryable: issue.retryable,
        title: issue.title,
        lastError: issue.lastError,
        detail
      }
    })
    await addCaseAction(created.id, 'detected', null, null, { taskId: task.id, issueType: issue.issueType })
    return created
  }

  const status = ['recovered', 'closed', 'in_progress'].includes(existing.status) ? existing.status : issue.status
  return prisma.deliveryAssuranceCase.update({
    where: { id: existing.id },
    data: {
      status,
      issueType: issue.issueType,
      severity: issue.severity,
      retryable: issue.retryable,
      title: issue.title,
      lastError: issue.lastError,
      detail
    }
  })
}

async function loadTaskForAction(taskId: number) {
  return prisma.instanceTask.findUnique({
    where: { id: taskId },
    include: {
      instance: {
        select: { id: true, name: true, status: true, image: true }
      }
    }
  })
}

function getTaskWhere(query: DeliveryQuery): Prisma.InstanceTaskWhereInput {
  const statuses = normalizeStatuses(query.status)
  const search = normalizeSearch(query.search)
  const where: Prisma.InstanceTaskWhereInput = {}

  if (statuses) {
    where.status = { in: statuses }
  }

  if (search) {
    const numericId = POSITIVE_ROUTE_ID_PATTERN.test(search) ? Number(search) : null
    where.OR = [
      ...(numericId && Number.isSafeInteger(numericId)
        ? [
            { id: numericId },
            { instanceId: numericId }
          ]
        : []),
      {
        instance: {
          name: {
            contains: search,
            mode: 'insensitive'
          }
        }
      }
    ]
  }

  return where
}

async function attachTaskContext(tasks: Array<{
  id: number
  instanceId: number
  hostId: number
  userId: number
  taskType: InstanceTaskType
  status: InstanceTaskStatus
  progress: string | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  newInstanceId: number | null
  instance: {
    id: number
    name: string
    status: string
    incusId: string
    image: string
  } | null
}>) {
  const userIds = [...new Set(tasks.map(task => task.userId))]
  const hostIds = [...new Set(tasks.map(task => task.hostId))]
  const instanceIds = [...new Set(tasks.map(task => task.instanceId))]
  const detectedCases = await Promise.all(tasks.map(task => ensureCaseForTask(task)))
  const caseMap = new Map(detectedCases.filter(Boolean).map(deliveryCase => [deliveryCase!.taskId, deliveryCase]))

  const [users, hosts, billingRecords] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, email: true, status: true }
    }),
    prisma.host.findMany({
      where: { id: { in: hostIds } },
      select: {
        id: true,
        name: true,
        status: true,
        location: true,
        countryCode: true,
        cpuUsed: true,
        cpuAllowanceMax: true,
        memoryUsed: true,
        memoryMax: true,
        diskUsed: true,
        natPortsUsedCount: true,
        agent: {
          select: {
            status: true,
            version: true,
            lastSeenAt: true
          }
        }
      }
    }),
    prisma.instanceBillingRecord.findMany({
      where: {
        instanceId: { in: instanceIds },
        type: { in: ['newPurchase', 'renew', 'refund'] }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        instanceId: true,
        type: true,
        amount: true,
        createdAt: true,
        balanceLogId: true
      }
    })
  ])
  const userMap = new Map(users.map(user => [user.id, user]))
  const hostMap = new Map(hosts.map(host => [host.id, host]))
  const billingMap = new Map<number, typeof billingRecords[number]>()
  for (const record of billingRecords) {
    if (!billingMap.has(record.instanceId)) billingMap.set(record.instanceId, record)
  }

  return tasks.map(task => ({
    id: task.id,
    instanceId: task.instanceId,
    hostId: task.hostId,
    userId: task.userId,
    taskType: task.taskType,
    status: task.status,
    progress: task.progress,
    error: task.error,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    newInstanceId: task.newInstanceId,
    instance: task.instance
      ? {
          id: task.instance.id,
          name: task.instance.name,
          status: task.instance.status,
          incusId: task.instance.incusId,
          image: task.instance.image
        }
      : null,
    user: userMap.get(task.userId) || null,
    host: hostMap.get(task.hostId) || null,
    assuranceCase: serializeCase(caseMap.get(task.id) || null),
    billing: billingMap.get(task.instanceId)
      ? {
          id: billingMap.get(task.instanceId)!.id,
          type: billingMap.get(task.instanceId)!.type,
          amount: Number(billingMap.get(task.instanceId)!.amount),
          createdAt: billingMap.get(task.instanceId)!.createdAt,
          balanceLogId: billingMap.get(task.instanceId)!.balanceLogId
        }
      : null
  }))
}

export default async function adminDeliveryRoutes(fastify: FastifyInstance) {
  fastify.get('/overview', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [
      taskStatusCounts,
      completedLast24h,
      failedLast24h,
      staleProcessing,
      notificationStatusCounts,
      enabledUserChannels,
      enabledGlobalChannels,
      caseStatusCounts,
      recentFailures
    ] = await Promise.all([
      prisma.instanceTask.groupBy({
        by: ['status'],
        _count: { _all: true }
      }),
      prisma.instanceTask.count({
        where: { status: 'COMPLETED', finishedAt: { gte: since } }
      }),
      prisma.instanceTask.count({
        where: { status: 'FAILED', finishedAt: { gte: since } }
      }),
      prisma.instanceTask.count({
        where: {
          status: 'PROCESSING',
          startedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) }
        }
      }),
      prisma.notificationLog.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: since },
          eventType: {
            in: [
              'instance_created',
              'instance_create_failed',
              'instance_started',
              'instance_stopped',
              'instance_restarted',
              'instance_rebuilt',
              'instance_task_failed',
              'instance_deleted',
              'instance_deleted_refunded'
            ]
          }
        },
        _count: { _all: true }
      }),
      prisma.notificationChannel.count({ where: { enabled: true, isGlobal: false } }),
      prisma.notificationChannel.count({ where: { enabled: true, isGlobal: true } }),
      prisma.deliveryAssuranceCase.groupBy({
        by: ['status'],
        _count: { _all: true }
      }),
      prisma.instanceTask.findMany({
        where: { status: 'FAILED' },
        orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          instanceId: true,
          hostId: true,
          userId: true,
          taskType: true,
          status: true,
          progress: true,
          error: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          newInstanceId: true,
          instance: {
            select: {
              id: true,
              name: true,
              status: true,
              incusId: true,
              image: true
            }
          }
        }
      })
    ])

    const taskCounts = Object.fromEntries(taskStatusCounts.map(item => [item.status, item._count._all]))
    const notificationCounts = Object.fromEntries(notificationStatusCounts.map(item => [item.status, item._count._all]))
    const caseCounts = Object.fromEntries(caseStatusCounts.map(item => [item.status, item._count._all]))

    return {
      summary: {
        pending: taskCounts.PENDING || 0,
        processing: taskCounts.PROCESSING || 0,
        completed: taskCounts.COMPLETED || 0,
        failed: taskCounts.FAILED || 0,
        completedLast24h,
        failedLast24h,
        staleProcessing,
        notificationSentLast24h: notificationCounts.sent || 0,
        notificationFailedLast24h: notificationCounts.failed || 0,
        notificationPendingLast24h: notificationCounts.pending || 0,
        enabledUserChannels,
        enabledGlobalChannels,
        casesPendingManual: caseCounts.pending_manual || 0,
        casesAutoRetryable: caseCounts.auto_retryable || 0,
        casesInProgress: caseCounts.in_progress || 0,
        casesRecovered: caseCounts.recovered || 0,
        casesClosed: caseCounts.closed || 0
      },
      recentFailures: await attachTaskContext(recentFailures)
    }
  })

  fastify.get<{ Querystring: DeliveryQuery }>('/tasks', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Querystring: DeliveryQuery }>, reply: FastifyReply) => {
    const page = parsePositiveInteger(request.query.page, 1)
    const pageSize = normalizePageSize(request.query.pageSize)
    const statuses = normalizeStatuses(request.query.status)
    if (request.query.status && !statuses) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const where = getTaskWhere(request.query)
    const [tasks, total] = await Promise.all([
      prisma.instanceTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          instanceId: true,
          hostId: true,
          userId: true,
          taskType: true,
          status: true,
          progress: true,
          error: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          newInstanceId: true,
          instance: {
            select: {
              id: true,
              name: true,
              status: true,
              incusId: true,
              image: true
            }
          }
        }
      }),
      prisma.instanceTask.count({ where })
    ])

    return {
      tasks: await attachTaskContext(tasks),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  })

  fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/tasks/:id/takeover', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const taskId = parsePositiveInteger(request.params.id, 0)
    if (!taskId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    try {
      const task = await loadTaskForAction(taskId)
      if (!task) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
      const deliveryCase = await ensureCaseForTask(task)
      if (!deliveryCase) return reply.code(409).send({ error: '当前任务不需要交付保障接管' })
      const note = normalizeNote(request.body?.note)
      const actor = request.user!
      const updated = await prisma.deliveryAssuranceCase.update({
        where: { id: deliveryCase.id },
        data: {
          status: 'in_progress',
          note,
          handledByUserId: actor.id,
          handledByUsername: actor.username,
          handledAt: new Date()
        }
      })
      await addCaseAction(updated.id, 'takeover', actor, note, { taskId })
      await createLog(actor.id, 'delivery', 'delivery.takeover', `接管交付问题 #${updated.id}（任务 #${taskId}）`, 'success')
      return { case: serializeCase(updated) }
    } catch (err) {
      if (err instanceof Error && err.message.includes('备注')) return reply.code(400).send({ error: err.message })
      request.log.error(err, '接管交付问题失败')
      return reply.code(500).send({ error: '接管交付问题失败' })
    }
  })

  fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/tasks/:id/retry', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const taskId = parsePositiveInteger(request.params.id, 0)
    if (!taskId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    try {
      const task = await loadTaskForAction(taskId)
      if (!task) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
      if (task.status !== 'FAILED') return reply.code(409).send({ error: '只有失败任务可以重新入队' })
      if (!IDEMPOTENT_RETRY_TASKS.has(task.taskType)) {
        return reply.code(409).send({ error: '该任务类型不是幂等操作，必须人工接管后处理' })
      }

      const note = normalizeNote(request.body?.note)
      const deliveryCase = await ensureCaseForTask(task)
      if (!deliveryCase) return reply.code(409).send({ error: '当前任务不需要重试' })

      const retryTask = await createInstanceTask({
        instanceId: task.instanceId,
        hostId: task.hostId,
        userId: task.userId,
        taskType: task.taskType
      })
      const actor = request.user!
      await prisma.instanceTask.update({
        where: { id: task.id },
        data: { retryCount: { increment: 1 } }
      })
      const updated = await prisma.deliveryAssuranceCase.update({
        where: { id: deliveryCase.id },
        data: {
          status: 'in_progress',
          retryTaskId: retryTask.id,
          note,
          handledByUserId: actor.id,
          handledByUsername: actor.username,
          handledAt: new Date()
        }
      })
      await addCaseAction(updated.id, 'retry', actor, note, { taskId, retryTaskId: retryTask.id, taskType: task.taskType })
      await createLog(actor.id, 'delivery', 'delivery.retry', `重新入队交付任务 #${taskId} -> #${retryTask.id}`, 'success')
      return { case: serializeCase(updated), retryTaskId: retryTask.id }
    } catch (err) {
      if (err instanceof InstanceTaskConflictError) {
        return reply.code(409).send({ error: '实例已有等待中或执行中的任务，暂不能重试' })
      }
      if (err instanceof Error && err.message.includes('备注')) return reply.code(400).send({ error: err.message })
      request.log.error(err, '重新入队交付任务失败')
      return reply.code(500).send({ error: '重新入队交付任务失败' })
    }
  })

  fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/tasks/:id/notify', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const taskId = parsePositiveInteger(request.params.id, 0)
    if (!taskId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    try {
      const task = await loadTaskForAction(taskId)
      if (!task) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
      const deliveryCase = await ensureCaseForTask(task)
      if (!deliveryCase) return reply.code(409).send({ error: '当前任务不需要通知' })
      const mode = ['delayed', 'recovered', 'contact_support'].includes(request.body?.mode || '')
        ? request.body!.mode!
        : 'contact_support'
      const note = normalizeNote(request.body?.note)
      const host = await prisma.host.findUnique({
        where: { id: task.hostId },
        select: { name: true }
      })
      await sendNotification(task.userId, 'delivery_assurance_update', {
        instanceName: task.instance?.name || `#${task.instanceId}`,
        hostName: host?.name || undefined,
        status: mode,
        deliveryMessage: note || undefined
      })
      const actor = request.user!
      await addCaseAction(deliveryCase.id, 'notify_user', actor, note, { taskId, mode })
      await createLog(actor.id, 'delivery', 'delivery.notify_user', `发送交付保障通知 #${deliveryCase.id}（${mode}）`, 'success')
      return { message: '通知已提交发送', case: serializeCase(deliveryCase) }
    } catch (err) {
      if (err instanceof Error && err.message.includes('备注')) return reply.code(400).send({ error: err.message })
      request.log.error(err, '发送交付保障通知失败')
      return reply.code(500).send({ error: '发送交付保障通知失败' })
    }
  })

  fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/tasks/:id/resolve', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const taskId = parsePositiveInteger(request.params.id, 0)
    if (!taskId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    try {
      const task = await loadTaskForAction(taskId)
      if (!task) return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
      const deliveryCase = await ensureCaseForTask(task)
      if (!deliveryCase) return reply.code(409).send({ error: '当前任务不需要结案' })
      const status = CASE_STATUSES.has(request.body?.status as DeliveryAssuranceCaseStatus)
        ? request.body!.status as DeliveryAssuranceCaseStatus
        : null
      if (status !== 'recovered' && status !== 'closed') {
        return reply.code(400).send({ error: '结案状态只能是 recovered 或 closed' })
      }
      const note = normalizeNote(request.body?.note)
      const actor = request.user!
      const updated = await prisma.deliveryAssuranceCase.update({
        where: { id: deliveryCase.id },
        data: {
          status,
          note,
          handledByUserId: actor.id,
          handledByUsername: actor.username,
          handledAt: new Date()
        }
      })
      await addCaseAction(updated.id, status === 'recovered' ? 'mark_recovered' : 'close', actor, note, { taskId, status })
      await createLog(actor.id, 'delivery', status === 'recovered' ? 'delivery.mark_recovered' : 'delivery.close', `更新交付问题 #${updated.id} 为 ${status}`, 'success')
      return { case: serializeCase(updated) }
    } catch (err) {
      if (err instanceof Error && err.message.includes('备注')) return reply.code(400).send({ error: err.message })
      request.log.error(err, '更新交付问题状态失败')
      return reply.code(500).send({ error: '更新交付问题状态失败' })
    }
  })
}
