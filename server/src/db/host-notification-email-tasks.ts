import type { HostNotificationEmailTask } from '@prisma/client'
import { prisma } from './prisma.js'
import {
  HOST_NOTIFICATION_EMAIL_LOCK_KEY,
  HOST_NOTIFICATION_EMAIL_LOCK_NAMESPACE,
  tryAdvisoryTransactionLock
} from './advisory-locks.js'

export const HOST_NOTIFICATION_EMAIL_INTERVAL_MS = 60 * 1000
export const HOST_NOTIFICATION_EMAIL_RETRY_DELAY_MS = 5 * 60 * 1000
export const HOST_NOTIFICATION_EMAIL_MAX_RETRIES = 3
export const HOST_NOTIFICATION_EMAIL_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000

const ADVISORY_LOCK_RETRY_LIMIT = 20
const ADVISORY_LOCK_RETRY_DELAY_MS = 100

export interface EnqueueHostNotificationEmailTaskInput {
  userId: number
  hostId: number
  email: string
  username: string
  hostName: string
  title: string
  content: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function cleanupStaleHostNotificationEmailTasks(
  timeoutMs: number = HOST_NOTIFICATION_EMAIL_PROCESSING_TIMEOUT_MS
): Promise<number> {
  const timeoutThreshold = new Date(Date.now() - timeoutMs)

  const result = await prisma.hostNotificationEmailTask.updateMany({
    where: {
      status: 'PROCESSING',
      OR: [
        { startedAt: null },
        { startedAt: { lt: timeoutThreshold } }
      ]
    },
    data: {
      status: 'PENDING',
      scheduledFor: new Date(),
      lastError: '邮件任务处理超时，已重新入队',
      startedAt: null,
      finishedAt: null
    }
  })

  return result.count
}

export async function cleanupTimeoutHostNotificationEmailTasks(
  timeoutMs: number = HOST_NOTIFICATION_EMAIL_PROCESSING_TIMEOUT_MS
): Promise<number> {
  const timeoutThreshold = new Date(Date.now() - timeoutMs)

  const result = await prisma.hostNotificationEmailTask.updateMany({
    where: {
      status: 'PROCESSING',
      startedAt: { lt: timeoutThreshold }
    },
    data: {
      status: 'PENDING',
      scheduledFor: new Date(),
      lastError: '邮件任务处理超时，已重新入队',
      startedAt: null,
      finishedAt: null
    }
  })

  return result.count
}

export async function enqueueHostNotificationEmailTasks(
  tasks: EnqueueHostNotificationEmailTaskInput[]
): Promise<number> {
  if (tasks.length === 0) return 0

  for (let attempt = 0; attempt < ADVISORY_LOCK_RETRY_LIMIT; attempt++) {
    const queuedCount = await prisma.$transaction(async (tx) => {
        const locked = await tryAdvisoryTransactionLock(
          tx,
          HOST_NOTIFICATION_EMAIL_LOCK_NAMESPACE,
          HOST_NOTIFICATION_EMAIL_LOCK_KEY
        )

        if (!locked) return null

        const now = new Date()
        const [latestQueuedTask, latestAttemptedTask] = await Promise.all([
          tx.hostNotificationEmailTask.findFirst({
            where: {
              status: { in: ['PENDING', 'PROCESSING'] }
            },
            orderBy: [
              { scheduledFor: 'desc' },
              { id: 'desc' }
            ],
            select: { scheduledFor: true }
          }),
          tx.hostNotificationEmailTask.findFirst({
            where: {
              startedAt: { not: null }
            },
            orderBy: [
              { startedAt: 'desc' },
              { id: 'desc' }
            ],
            select: { startedAt: true }
          })
        ])

        let baseTime = now.getTime()

        if (latestQueuedTask?.scheduledFor) {
          baseTime = Math.max(
            baseTime,
            latestQueuedTask.scheduledFor.getTime() + HOST_NOTIFICATION_EMAIL_INTERVAL_MS
          )
        }

        if (latestAttemptedTask?.startedAt) {
          baseTime = Math.max(
            baseTime,
            latestAttemptedTask.startedAt.getTime() + HOST_NOTIFICATION_EMAIL_INTERVAL_MS
          )
        }

        const queuedTasks = tasks.map((task, index) => ({
          ...task,
          scheduledFor: new Date(baseTime + index * HOST_NOTIFICATION_EMAIL_INTERVAL_MS)
        }))

        const result = await tx.hostNotificationEmailTask.createMany({
          data: queuedTasks
        })

        return result.count
      })

    if (queuedCount !== null) {
      return queuedCount
    }

    await sleep(ADVISORY_LOCK_RETRY_DELAY_MS * (attempt + 1))
  }

  throw new Error('Failed to acquire host notification email queue lock')
}

export async function claimNextHostNotificationEmailTask(): Promise<HostNotificationEmailTask | null> {
  return prisma.$transaction(async (tx) => {
        const locked = await tryAdvisoryTransactionLock(
          tx,
          HOST_NOTIFICATION_EMAIL_LOCK_NAMESPACE,
          HOST_NOTIFICATION_EMAIL_LOCK_KEY
        )

        if (!locked) {
          return null
        }

        const now = new Date()
        const recentThreshold = new Date(now.getTime() - HOST_NOTIFICATION_EMAIL_INTERVAL_MS)

        const throttledTask = await tx.hostNotificationEmailTask.findFirst({
          where: {
            OR: [
              { status: 'PROCESSING' },
              { startedAt: { gte: recentThreshold } }
            ]
          },
          select: { id: true }
        })

        if (throttledTask) {
          return null
        }

        const nextTask = await tx.hostNotificationEmailTask.findFirst({
          where: {
            status: 'PENDING',
            scheduledFor: { lte: now }
          },
          orderBy: [
            { scheduledFor: 'asc' },
            { createdAt: 'asc' }
          ]
        })

        if (!nextTask) {
          return null
        }

        return tx.hostNotificationEmailTask.update({
          where: { id: nextTask.id },
          data: {
            status: 'PROCESSING',
            startedAt: now,
            finishedAt: null,
            lastError: null
          }
        })
  })
}

export async function markHostNotificationEmailTaskSent(taskId: number): Promise<void> {
  await prisma.hostNotificationEmailTask.updateMany({
    where: {
      id: taskId,
      status: 'PROCESSING'
    },
    data: {
      status: 'SENT',
      lastError: null,
      finishedAt: new Date()
    }
  })
}

export async function retryOrFailHostNotificationEmailTask(
  taskId: number,
  currentRetryCount: number,
  errorMessage: string
): Promise<void> {
  if (currentRetryCount >= HOST_NOTIFICATION_EMAIL_MAX_RETRIES) {
    await prisma.hostNotificationEmailTask.updateMany({
      where: {
        id: taskId,
        status: 'PROCESSING',
        retryCount: currentRetryCount
      },
      data: {
        status: 'FAILED',
        lastError: errorMessage,
        finishedAt: new Date()
      }
    })
    return
  }

  await prisma.hostNotificationEmailTask.updateMany({
    where: {
      id: taskId,
      status: 'PROCESSING',
      retryCount: currentRetryCount
    },
    data: {
      status: 'PENDING',
      retryCount: { increment: 1 },
      lastError: errorMessage,
      scheduledFor: new Date(Date.now() + HOST_NOTIFICATION_EMAIL_RETRY_DELAY_MS),
      finishedAt: null
    }
  })
}
