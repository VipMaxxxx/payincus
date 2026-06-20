/**
 * 备份上传任务数据库操作
 */

import { prisma } from './prisma.js'
import type { BackupUploadTask, BackupUploadTaskStatus } from '@prisma/client'

/**
 * 创建备份上传任务
 */
export async function createBackupUploadTask(data: {
    userId: number
    instanceId: number
    backupId: number
    hostId: number
    storageConfigId: number
}): Promise<BackupUploadTask> {
    return prisma.backupUploadTask.create({
        data: {
            userId: data.userId,
            instanceId: data.instanceId,
            backupId: data.backupId,
            hostId: data.hostId,
            storageConfigId: data.storageConfigId,
            status: 'PENDING'
        }
    })
}

/**
 * 根据 ID 获取任务
 */
export async function getBackupUploadTaskById(id: number): Promise<BackupUploadTask | null> {
    return prisma.backupUploadTask.findUnique({
        where: { id }
    })
}

/**
 * 获取任务详情（包含关联数据）
 */
export async function getBackupUploadTaskWithDetails(id: number) {
    return prisma.backupUploadTask.findUnique({
        where: { id },
        include: {
            storageConfig: {
                select: {
                    id: true,
                    name: true,
                    type: true,
                    host: true
                }
            }
        }
    })
}

/**
 * 获取用户的上传任务列表
 */
export async function getBackupUploadTasksByUserId(
    userId: number,
    options?: { limit?: number; status?: BackupUploadTaskStatus }
): Promise<BackupUploadTask[]> {
    return prisma.backupUploadTask.findMany({
        where: {
            userId,
            ...(options?.status ? { status: options.status } : {})
        },
        orderBy: { createdAt: 'desc' },
        take: options?.limit || 50
    })
}

/**
 * 获取实例的上传任务列表
 */
export async function getBackupUploadTasksByInstanceId(
    instanceId: number
): Promise<BackupUploadTask[]> {
    return prisma.backupUploadTask.findMany({
        where: { instanceId },
        orderBy: { createdAt: 'desc' }
    })
}

/**
 * 更新任务状态
 */
export async function updateBackupUploadTaskStatus(
    id: number,
    status: BackupUploadTaskStatus,
    extra?: {
        remoteFileName?: string
        fileSize?: bigint
        error?: string
        startedAt?: Date
        finishedAt?: Date
    }
): Promise<BackupUploadTask> {
    return prisma.backupUploadTask.update({
        where: { id },
        data: {
            status,
            ...extra
        }
    })
}

/**
 * 检查用户是否有进行中的上传任务
 */
export async function hasActiveUploadTask(userId: number): Promise<BackupUploadTask | null> {
    return prisma.backupUploadTask.findFirst({
        where: {
            userId,
            status: { in: ['PENDING', 'PROCESSING'] }
        }
    })
}

/**
 * 检查实例是否有进行中的上传任务
 */
export async function hasActiveUploadTaskForInstance(instanceId: number): Promise<BackupUploadTask | null> {
    return prisma.backupUploadTask.findFirst({
        where: {
            instanceId,
            status: { in: ['PENDING', 'PROCESSING'] }
        }
    })
}

/**
 * 获取队列中的位置
 */
export async function getUploadTaskQueuePosition(taskId: number): Promise<number> {
    const task = await prisma.backupUploadTask.findUnique({
        where: { id: taskId },
        select: { hostId: true, createdAt: true, status: true }
    })

    if (!task || task.status !== 'PENDING') return 0

    // 检查是否有正在执行的上传或恢复任务（共享锁）
    const processingUploadTask = await prisma.backupUploadTask.findFirst({
        where: {
            hostId: task.hostId,
            status: 'PROCESSING'
        },
        orderBy: { createdAt: 'asc' }
    })
    
    const processingRestoreTask = await prisma.restoreTask.findFirst({
        where: {
            hostId: task.hostId,
            status: 'PROCESSING'
        },
        orderBy: { createdAt: 'asc' }
    })

    // 如果有 PROCESSING 任务，且创建时间早于当前任务，则位置+1
    const hasProcessingTask = 
        (processingUploadTask && processingUploadTask.createdAt < task.createdAt) ||
        (processingRestoreTask && processingRestoreTask.createdAt < task.createdAt)
    
    const processingCount = hasProcessingTask ? 1 : 0

    // 统计创建时间更早的 PENDING 任务数量
    const pendingCount = await prisma.backupUploadTask.count({
        where: {
            hostId: task.hostId,
            status: 'PENDING',
            createdAt: { lt: task.createdAt }
        }
    })

    return processingCount + pendingCount + 1
}

/**
 * 取消任务（仅 PENDING 状态）
 */
export async function cancelBackupUploadTask(id: number): Promise<BackupUploadTask> {
    return prisma.backupUploadTask.update({
        where: { id },
        data: {
            status: 'FAILED',
            error: '用户取消',
            finishedAt: new Date()
        }
    })
}

/**
 * 获取实例的活跃上传任务（用于前端状态恢复）
 */
export async function getActiveUploadTaskForInstance(instanceId: number) {
    return prisma.backupUploadTask.findFirst({
        where: {
            instanceId,
            status: { in: ['PENDING', 'PROCESSING'] }
        },
        include: {
            storageConfig: {
                select: {
                    id: true,
                    name: true,
                    type: true
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    })
}

/**
 * 获取存储配置关联的活跃任务数量
 */
export async function countActiveTasksForStorageConfig(storageConfigId: number): Promise<number> {
    return prisma.backupUploadTask.count({
        where: {
            storageConfigId,
            status: { in: ['PENDING', 'PROCESSING'] }
        }
    })
}
