import type { SystemUpdateTask, SystemUpdateTaskStatus } from '@prisma/client'
import { prisma } from './prisma.js'

export interface SerializedSystemUpdateTask {
  id: number
  targetVersion: string
  fromVersion: string | null
  status: SystemUpdateTaskStatus
  startedByUserId: number
  startedByUsername: string | null
  backupPath: string | null
  logPath: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

type TaskWithUser = SystemUpdateTask & {
  startedBy?: { username: string } | null
}

export function serializeSystemUpdateTask(task: TaskWithUser): SerializedSystemUpdateTask {
  return {
    id: task.id,
    targetVersion: task.targetVersion,
    fromVersion: task.fromVersion,
    status: task.status,
    startedByUserId: task.startedByUserId,
    startedByUsername: task.startedBy?.username || null,
    backupPath: task.backupPath,
    logPath: task.logPath,
    errorMessage: task.errorMessage,
    startedAt: task.startedAt?.toISOString() || null,
    finishedAt: task.finishedAt?.toISOString() || null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  }
}

export async function createSystemUpdateTask(input: {
  targetVersion: string
  fromVersion: string | null
  startedByUserId: number
  logPath: string
}) {
  return prisma.systemUpdateTask.create({
    data: {
      targetVersion: input.targetVersion,
      fromVersion: input.fromVersion,
      startedByUserId: input.startedByUserId,
      logPath: input.logPath,
      status: 'pending'
    },
    include: { startedBy: { select: { username: true } } }
  })
}

export async function getSystemUpdateTask(id: number) {
  return prisma.systemUpdateTask.findUnique({
    where: { id },
    include: { startedBy: { select: { username: true } } }
  })
}

export async function listSystemUpdateTasks(limit = 20) {
  return prisma.systemUpdateTask.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { startedBy: { select: { username: true } } }
  })
}

export async function hasRunningSystemUpdateTask(): Promise<boolean> {
  const count = await prisma.systemUpdateTask.count({
    where: { status: { in: ['pending', 'running'] } }
  })
  return count > 0
}

export async function markSystemUpdateTaskRunning(id: number) {
  await prisma.systemUpdateTask.update({
    where: { id },
    data: {
      status: 'running',
      startedAt: new Date(),
      errorMessage: null
    }
  })
}

export async function tryMarkSystemUpdateTaskRunning(
  id: number,
  allowedStatuses: SystemUpdateTaskStatus[],
  logPath?: string
): Promise<boolean> {
  const result = await prisma.systemUpdateTask.updateMany({
    where: {
      id,
      status: { in: allowedStatuses }
    },
    data: {
      status: 'running',
      startedAt: new Date(),
      errorMessage: null,
      ...(logPath ? { logPath } : {})
    }
  })
  return result.count === 1
}

export async function markSystemUpdateTaskFinished(id: number, input: {
  status: 'success' | 'failed' | 'rolled_back'
  errorMessage?: string | null
  backupPath?: string | null
}) {
  await prisma.systemUpdateTask.update({
    where: { id },
    data: {
      status: input.status,
      errorMessage: input.errorMessage || null,
      backupPath: input.backupPath,
      finishedAt: new Date()
    }
  })
}
