/**
 * 实例操作任务数据库操作
 */

import { prisma } from './prisma.js'
import type { InstanceTaskType, InstanceTaskStatus, Prisma } from '@prisma/client'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'

export interface CreateInstanceTaskData {
  instanceId: number
  hostId: number
  userId: number
  taskType: InstanceTaskType
  imageAlias?: string       // 重装使用的镜像别名
  sshKeyId?: number         // 重装使用的 SSH 密钥 ID
  customInitCommandIds?: number[]  // 重装使用的自定义初始化命令 ID 列表
  targetName?: string       // 克隆的目标名称
  targetHostId?: number     // 克隆的目标宿主机
  snapshotName?: string     // 克隆时的快照名称
}

export interface InstanceTaskWithDetails {
  id: number
  instanceId: number
  hostId: number
  userId: number
  taskType: InstanceTaskType
  status: InstanceTaskStatus
  progress: string | null
  retryCount: number
  imageAlias: string | null
  sshKeyId: number | null
  customInitCommandIds: string | null  // JSON 字符串，解析后为 number[]
  targetName: string | null
  targetHostId: number | null
  snapshotName: string | null
  newInstanceId: number | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

export class InstanceTaskConflictError extends Error {
  activeTask: InstanceTaskWithDetails | null

  constructor(activeTask: InstanceTaskWithDetails | null = null) {
    super('Instance has an active task')
    this.name = 'InstanceTaskConflictError'
    this.activeTask = activeTask
  }
}

const INSTANCE_TASK_STATUSES = new Set<InstanceTaskStatus>([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
])

function clampInstanceTaskPagination(
  page: number | undefined,
  pageSize: number | undefined
): { page: number; pageSize: number } {
  return {
    page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize !== undefined
      ? Math.min(Math.max(pageSize, 1), 100)
      : 20
  }
}

function normalizeInstanceTaskStatuses(status?: InstanceTaskStatus[]): InstanceTaskStatus[] | undefined {
  if (!Array.isArray(status)) {
    return undefined
  }

  const normalized = status.filter((value): value is InstanceTaskStatus => INSTANCE_TASK_STATUSES.has(value))
  return normalized.length > 0 ? normalized : undefined
}

/**
 * 创建实例操作任务
 */
export async function createInstanceTask(data: CreateInstanceTaskData): Promise<InstanceTaskWithDetails> {
  const result = await prisma.$transaction(async tx => {
    const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, data.instanceId)
    if (!locked) {
      throw new InstanceTaskConflictError()
    }

    const activeTask = await tx.instanceTask.findFirst({
      where: {
        instanceId: data.instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' }
      ]
    })
    if (activeTask) {
      throw new InstanceTaskConflictError(activeTask as unknown as InstanceTaskWithDetails)
    }

    // 注：使用 as any 绕过 Prisma 类型检查，因为 customInitCommandIds 字段在迁移后才会生成类型
    return tx.instanceTask.create({
      data: {
        instanceId: data.instanceId,
        hostId: data.hostId,
        userId: data.userId,
        taskType: data.taskType,
        imageAlias: data.imageAlias || null,
        sshKeyId: data.sshKeyId || null,
        customInitCommandIds: data.customInitCommandIds ? JSON.stringify(data.customInitCommandIds) : null,
        targetName: data.targetName || null,
        targetHostId: data.targetHostId || null,
        snapshotName: data.snapshotName || null,
        status: 'PENDING'
      } as any
    })
  })
  return result as unknown as InstanceTaskWithDetails
}

/**
 * 获取任务详情
 */
export async function getInstanceTaskById(taskId: number): Promise<InstanceTaskWithDetails | null> {
  const result = await prisma.instanceTask.findUnique({
    where: { id: taskId }
  })
  return result as unknown as InstanceTaskWithDetails | null
}

/**
 * 获取实例的活跃任务（PENDING 或 PROCESSING）
 */
export async function getActiveTaskForInstance(instanceId: number): Promise<InstanceTaskWithDetails | null> {
  const result = await prisma.instanceTask.findFirst({
    where: {
      instanceId,
      status: { in: ['PENDING', 'PROCESSING'] }
    },
    orderBy: { createdAt: 'desc' }
  })
  return result as unknown as InstanceTaskWithDetails | null
}

/**
 * 获取用户的任务列表
 */
export async function getUserInstanceTasks(
  userId: number,
  options: { page?: number; pageSize?: number; status?: InstanceTaskStatus[] } = {}
): Promise<{ items: InstanceTaskWithDetails[]; total: number }> {
  const { page, pageSize } = clampInstanceTaskPagination(options.page, options.pageSize)
  const status = normalizeInstanceTaskStatuses(options.status)

  const where: Prisma.InstanceTaskWhereInput = { userId }
  if (status && status.length > 0) {
    where.status = { in: status }
  }

  const [items, total] = await Promise.all([
    prisma.instanceTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.instanceTask.count({ where })
  ])

  return { items: items as unknown as InstanceTaskWithDetails[], total }
}

/**
 * 更新任务状态
 */
export async function updateInstanceTaskStatus(
  taskId: number,
  status: InstanceTaskStatus,
  updates?: {
    progress?: string
    error?: string
    startedAt?: Date
    finishedAt?: Date
    newInstanceId?: number
  }
): Promise<InstanceTaskWithDetails> {
  const result = await prisma.instanceTask.update({
    where: { id: taskId },
    data: {
      status,
      ...updates
    }
  })
  return result as unknown as InstanceTaskWithDetails
}

/**
 * 更新任务进度
 */
export async function updateInstanceTaskProgress(taskId: number, progress: string): Promise<void> {
  await prisma.instanceTask.update({
    where: { id: taskId },
    data: { progress }
  })
}

/**
 * 获取队列位置
 */
export async function getTaskQueuePosition(taskId: number, hostId: number): Promise<number> {
  const task = await prisma.instanceTask.findUnique({
    where: { id: taskId },
    select: { createdAt: true }
  })

  if (!task) return 0

  const position = await prisma.instanceTask.count({
    where: {
      hostId,
      status: 'PENDING',
      createdAt: { lte: task.createdAt }
    }
  })

  return position
}

/**
 * 清理过期的已完成任务（保疙7天）
 */
export async function cleanupOldTasks(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const result = await prisma.instanceTask.deleteMany({
    where: {
      status: { in: ['COMPLETED', 'FAILED'] },
      finishedAt: { lt: sevenDaysAgo }
    }
  })

  return result.count
}

/**
 * 取消 PENDING 状态的任务
 */
export async function cancelInstanceTask(taskId: number): Promise<InstanceTaskWithDetails | null> {
  const task = await prisma.instanceTask.findUnique({
    where: { id: taskId }
  })

  if (!task || task.status !== 'PENDING') {
    return null
  }

  const result = await prisma.$transaction(async tx => {
    const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)
    if (!locked) {
      return null
    }

    const updateResult = await tx.instanceTask.updateMany({
      where: {
        id: taskId,
        status: 'PENDING'
      },
      data: {
        status: 'FAILED',
        error: '用户取消',
        finishedAt: new Date()
      }
    })

    if (updateResult.count !== 1) {
      return null
    }

    return tx.instanceTask.findUnique({
      where: { id: taskId }
    })
  })
  return result as unknown as InstanceTaskWithDetails
}
