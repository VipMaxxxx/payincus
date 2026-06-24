import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type InstanceTaskStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { apiError, ErrorCode } from '../lib/errors.js'

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const TASK_STATUSES = new Set<InstanceTaskStatus>(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20

type DeliveryQuery = {
  page?: string
  pageSize?: string
  status?: string
  search?: string
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
  taskType: string
  status: string
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
  const [users, hosts] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, email: true, status: true }
    }),
    prisma.host.findMany({
      where: { id: { in: hostIds } },
      select: { id: true, name: true, status: true, location: true, countryCode: true }
    })
  ])
  const userMap = new Map(users.map(user => [user.id, user]))
  const hostMap = new Map(hosts.map(host => [host.id, host]))

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
    host: hostMap.get(task.hostId) || null
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
        enabledGlobalChannels
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
}
