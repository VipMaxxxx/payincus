/**
 * 恢复任务数据库操作
 */

import { prisma } from './prisma.js'

export interface CreateRestoreTaskData {
    instanceId: number
    backupId: number | null
    hostId: number
    userId: number
    tempInstanceName: string
    originalInstanceName: string
    originalIncusId: string
}

/**
 * 创建恢复任务
 */
export async function createRestoreTask(data: CreateRestoreTaskData): Promise<number> {
    const task = await prisma.restoreTask.create({
        data: {
            instanceId: data.instanceId,
            backupId: data.backupId,
            hostId: data.hostId,
            userId: data.userId,
            tempInstanceName: data.tempInstanceName,
            originalInstanceName: data.originalInstanceName,
            originalIncusId: data.originalIncusId,
            status: 'PENDING'
        }
    })
    return task.id
}

/**
 * 获取恢复任务
 */
export async function getRestoreTaskById(id: number) {
    return prisma.restoreTask.findUnique({ where: { id } })
}

/**
 * 获取实例的恢复任务列表
 */
export async function getRestoreTasksByInstanceId(instanceId: number) {
    return prisma.restoreTask.findMany({
        where: { instanceId },
        orderBy: { createdAt: 'desc' },
        take: 20
    })
}

/**
 * 更新恢复任务状态
 */
export async function updateRestoreTaskStatus(
    id: number,
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
    error?: string
) {
    return prisma.restoreTask.update({
        where: { id },
        data: {
            status,
            error: error ?? null,
            finishedAt: ['COMPLETED', 'FAILED'].includes(status) ? new Date() : undefined
        }
    })
}

// hasActiveRestoreTask 和 getQueuePosition 在 workers/restoreTaskWorker.ts 中定义
