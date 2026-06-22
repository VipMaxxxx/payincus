/**
 * 恢复任务队列调度器
 * 确保同一台宿主机同一时间只有一个恢复任务在执行
 */

import { prisma } from '../db/prisma.js'
import { resolveStoragePoolForExistingInstance } from '../db/storage-pools.js'
import { getIncusClient } from '../lib/incus/index.js'
import { getBackupExportStream } from '../lib/incus/incus-backups.js'
import {
    restoreFromStream,
    renameInstance
} from '../lib/incus/incus-restore.js'
import {
    stopInstance,
    startInstance,
    deleteInstance
} from '../lib/incus/incus-instances.js'
import { listBackups, deleteBackup as deleteIncusBackup } from '../lib/incus/incus-backups.js'
import { listSnapshots, deleteSnapshot as deleteIncusSnapshot } from '../lib/incus/incus-snapshots.js'
import { sendNotification } from '../lib/notifier.js'
import { createLog } from '../db/logs.js'
import { collectTrafficForRunningInstance } from '../services/instance-traffic-collector.js'
import { Readable } from 'stream'
import {
    HOST_TASK_CLAIM_LOCK_NAMESPACE,
    INSTANCE_OPERATION_LOCK_NAMESPACE,
    tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'
import { createWorkerDbBackoff } from './db-failure-backoff.js'

// 恢复任务超时时间 (10 分钟)
const RESTORE_TIMEOUT = 10 * 60 * 1000

// Worker 轮询间隔 (5 秒)
const POLL_INTERVAL = 5000

// 超时检查间隔 (1 分钟)
const TIMEOUT_CHECK_INTERVAL = 60000

let workerInterval: ReturnType<typeof setInterval> | null = null
let timeoutCheckInterval: ReturnType<typeof setInterval> | null = null
const runningRestoreTaskIds = new Set<number>()
const dbBackoff = createWorkerDbBackoff('RestoreWorker')

/**
 * 服务启动时清理僵尸任务
 * 把所有 PROCESSING 状态的任务标记为 FAILED
 */
export async function cleanupStaleTasks(): Promise<void> {
    const result = await prisma.restoreTask.updateMany({
        where: { status: 'PROCESSING' },
        data: {
            status: 'FAILED',
            error: '系统重启，任务中断',
            finishedAt: new Date()
        }
    })
    if (result.count > 0) {
        console.log(`[RestoreWorker] 清理了 ${result.count} 个僵尸任务`)
    }
}

/**
 * 运行时检查并清理超时的任务
 * 每分钟检查一次，将超过超时时间的 PROCESSING 任务标记为 FAILED
 */
async function cleanupTimeoutTasks(): Promise<void> {
    if (dbBackoff.shouldSkip()) return
    const timeoutThreshold = new Date(Date.now() - RESTORE_TIMEOUT)
    
    const timedOutTasks = await prisma.restoreTask.findMany({
        where: {
            status: 'PROCESSING',
            startedAt: { lt: timeoutThreshold }
        },
        select: { id: true }
    })
    const timedOutTaskIds = timedOutTasks
        .map(task => task.id)
        .filter(taskId => !runningRestoreTaskIds.has(taskId))

    if (timedOutTaskIds.length === 0) {
        return
    }

    const result = await prisma.restoreTask.updateMany({
        where: {
            id: { in: timedOutTaskIds },
            status: 'PROCESSING'
        },
        data: {
            status: 'FAILED',
            error: '任务执行超时 (10 分钟)',
            finishedAt: new Date()
        }
    })
    
    if (result.count > 0) {
        console.log(`[RestoreWorker] 清理了 ${result.count} 个超时任务`)
    }
}

/**
 * 检查队列并执行任务
 */
async function processQueue(): Promise<void> {
    if (dbBackoff.shouldSkip()) return
    try {
        // 1. 获取所有有 PENDING 任务的宿主机 ID (去重)
        const hostsWithPendingTasks = await prisma.restoreTask.groupBy({
            by: ['hostId'],
            where: { status: 'PENDING' }
        })

        for (const group of hostsWithPendingTasks) {
            const hostId = group.hostId

            // 使用事务原子操作：检查锁 + 获取任务 + 标记为 PROCESSING
            const claimedTask = await claimNextTask(hostId)
            
            if (claimedTask) {
                // 执行任务 (不 await，让它异步跑)
                executeRestoreTask(claimedTask.id).catch(err => {
                    console.error(`[RestoreWorker] Task ${claimedTask.id} execution error:`, err)
                })
            }
        }
    } catch (err) {
        console.error('[RestoreWorker] Queue processing error:', err)
        dbBackoff.arm(err)
    }
}

/**
 * 原子操作：获取并锁定下一个任务
 * 使用事务确保检查锁和获取任务是原子的，防止竞态条件
 */
async function claimNextTask(hostId: number) {
        return await prisma.$transaction(async (tx) => {
            const locked = await tryAdvisoryTransactionLock(tx, HOST_TASK_CLAIM_LOCK_NAMESPACE, hostId)
            if (!locked) return null

            // 1. 检查是否有正在执行的恢复任务
            const runningRestoreTask = await tx.restoreTask.findFirst({
                where: { hostId, status: 'PROCESSING' }
            })
            if (runningRestoreTask) return null

            // 2. 检查是否有正在执行的上传任务（共享锁）
            const runningUploadTask = await tx.backupUploadTask.findFirst({
                where: { hostId, status: 'PROCESSING' }
            })
            if (runningUploadTask) return null

            // 3. 检查是否有正在执行的实例任务（共享锁）
            const runningInstanceTask = await tx.instanceTask.findFirst({
                where: { hostId, status: 'PROCESSING' }
            })
            if (runningInstanceTask) return null

            // 4. 获取最早的 PENDING 任务
            const taskToRun = await tx.restoreTask.findFirst({
                where: { hostId, status: 'PENDING' },
                orderBy: { createdAt: 'asc' }
            })
            if (!taskToRun) return null

            const instanceOperationLocked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, taskToRun.instanceId)
            if (!instanceOperationLocked) return null

            const instance = await tx.instance.findUnique({
                where: { id: taskToRun.instanceId },
                select: { status: true }
            })
            if (!instance || instance.status === 'deleted') return null

            // 5. 原子标记为 PROCESSING
            const claimedTask = await tx.restoreTask.update({
                where: { id: taskToRun.id },
                data: { status: 'PROCESSING', startedAt: new Date() }
            })

            return claimedTask
        })
}


/**
 * 更新任务进度
 */
async function updateProgress(taskId: number, progress: string): Promise<void> {
    await prisma.restoreTask.updateMany({
        where: { id: taskId, status: 'PROCESSING' },
        data: { progress }
    })
}


/**
 * 执行单个恢复任务
 * 工作流: 停止原实例 -> 恢复到临时实例 -> 删除原实例 -> 重命名 -> 启动
 * 注意：任务已在 claimNextTask 中标记为 PROCESSING
 */
async function executeRestoreTask(taskId: number): Promise<void> {
    const startTime = Date.now()
    runningRestoreTaskIds.add(taskId)

    // 获取任务信息（已在事务中标记为 PROCESSING）
    const task = await prisma.restoreTask.findUnique({
        where: { id: taskId }
    })

    if (!task) {
        console.error(`[RestoreWorker] Task ${taskId} not found`)
        return
    }

    console.log(`[RestoreWorker] 开始执行任务 ${taskId}`)

    try {
        // 2. 获取相关数据
        const host = await prisma.host.findUnique({ where: { id: task.hostId } })
        if (!host) throw new Error('宿主机不存在')

        const instance = await prisma.instance.findUnique({ where: { id: task.instanceId } })
        if (!instance) throw new Error('实例不存在')
        if (instance.status === 'deleted') throw new Error('实例已删除，任务取消')

        const backup = task.backupId
            ? await prisma.backup.findUnique({ where: { id: task.backupId } })
            : null
        if (task.backupId && !backup) throw new Error('备份不存在')

        const client = await getIncusClient({
            id: host.id,
            url: host.url,
            certPath: host.certPath,
            keyPath: host.keyPath
        })

        const checkTimeout = () => {
            if (Date.now() - startTime > RESTORE_TIMEOUT) {
                throw new Error('恢复操作超时 (10 分钟)')
            }
        }

        // 3. 停止原实例
        await updateProgress(taskId, 'stopping')
        console.log(`[RestoreWorker] Task ${taskId}: 停止原实例 ${task.originalIncusId}`)
        const collectResult = await collectTrafficForRunningInstance(task.instanceId)
        if (!collectResult.success) {
            console.warn(`[RestoreWorker] Task ${taskId}: 恢复前即时采集流量失败: ${collectResult.error}`)
        }
        try {
            await stopInstance(client, task.originalIncusId, true)
        } catch (err) {
            console.warn(`[RestoreWorker] Task ${taskId}: 停止实例警告: ${err}`)
        }
        checkTimeout()

        // 4. 获取存储池配置
        // 使用宿主机的系统盘存储池，确保恢复的实例使用正确的存储池
        const storagePool = await resolveStoragePoolForExistingInstance(task.instanceId, task.hostId, {
            packageId: instance.packageId
        })
        if (!storagePool) {
            throw new Error('宿主机未配置系统盘存储池，无法恢复实例')
        }
        console.log(`[RestoreWorker] Task ${taskId}: 使用存储池 ${storagePool}`)

        // 5. 获取备份流并恢复到临时实例
        await updateProgress(taskId, 'restoring')
        if (!backup) {
            throw new Error('备份记录不存在')
        }
        console.log(`[RestoreWorker] Task ${taskId}: 恢复到临时实例 ${task.tempInstanceName}`)
        const { stream } = await getBackupExportStream(
            client,
            task.originalIncusId,
            backup.incusName
        )
        const nodeStream = Readable.fromWeb(stream as import('stream/web').ReadableStream)

        await restoreFromStream({
            client,
            backupStream: nodeStream,
            targetName: task.tempInstanceName!,
            poolName: storagePool
        })
        checkTimeout()

        // 6. 删除原实例在 Incus 中的所有备份和快照
        await updateProgress(taskId, 'cleaning')
        console.log(`[RestoreWorker] Task ${taskId}: 清理原实例的备份和快照`)
        try {
            // 删除 Incus 中的备份
            const incusBackups = await listBackups(client, task.originalIncusId)
            for (const b of incusBackups) {
                const backupName = b.name
                if (backupName) {
                    try {
                        await deleteIncusBackup(client, task.originalIncusId, backupName)
                        console.log(`[RestoreWorker] Task ${taskId}: 已删除 Incus 备份 ${backupName}`)
                    } catch (e) {
                        console.warn(`[RestoreWorker] Task ${taskId}: 删除 Incus 备份失败: ${e}`)
                    }
                }
            }
            // 删除 Incus 中的快照
            const incusSnapshots = await listSnapshots(client, task.originalIncusId)
            for (const s of incusSnapshots) {
                const snapshotName = s.name
                if (snapshotName) {
                    try {
                        await deleteIncusSnapshot(client, task.originalIncusId, snapshotName)
                        console.log(`[RestoreWorker] Task ${taskId}: 已删除 Incus 快照 ${snapshotName}`)
                    } catch (e) {
                        console.warn(`[RestoreWorker] Task ${taskId}: 删除 Incus 快照失败: ${e}`)
                    }
                }
            }
        } catch (e) {
            console.warn(`[RestoreWorker] Task ${taskId}: 清理备份/快照时出错: ${e}`)
        }

        // 7. 删除原实例
        await updateProgress(taskId, 'replacing')
        console.log(`[RestoreWorker] Task ${taskId}: 删除原实例 ${task.originalIncusId}`)
        await deleteInstance(client, task.originalIncusId)
        checkTimeout()

        // 8. 重命名临时实例为原名
        console.log(`[RestoreWorker] Task ${taskId}: 重命名 ${task.tempInstanceName} -> ${task.originalIncusId}`)
        await renameInstance(client, task.tempInstanceName!, task.originalIncusId)

        await prisma.trafficSnapshot.deleteMany({ where: { instanceId: task.instanceId } })

        // 9. 启动恢复后的实例
        await updateProgress(taskId, 'starting')
        console.log(`[RestoreWorker] Task ${taskId}: 启动实例`)
        await startInstance(client, task.originalIncusId)

        // 10. 删除数据库中原实例的备份和快照记录
        // Incus 原实例及其所有备份已被删除，恢复后的新实例没有这些旧备份。
        console.log(`[RestoreWorker] Task ${taskId}: 清理数据库中的备份和快照记录`)
        await prisma.backup.updateMany({
            where: {
                instanceId: task.instanceId
            },
            data: { status: 'deleted' }
        })
        await prisma.snapshot.deleteMany({
            where: { instanceId: task.instanceId }
        })

        // 11. 更新实例名称和恢复来源信息（在标记成功之前，确保原子性）
        // 名称格式: 原名 | restored:备份名
        const newInstanceName = `${task.originalInstanceName} | restored:${backup?.name || 'unknown'}`
        const instanceUpdateResult = await prisma.instance.updateMany({
            where: {
                id: task.instanceId,
                status: { not: 'deleted' }
            },
            data: {
                name: newInstanceName,
                storagePoolName: storagePool,
                restoredFrom: {
                    backupId: task.backupId,
                    backupName: backup?.name,
                    restoredAt: new Date().toISOString()
                }
            }
        })
        if (instanceUpdateResult.count === 0) {
            throw new Error('实例已删除，恢复结果不再写入')
        }

        // 12. 标记成功
        const completeResult = await prisma.restoreTask.updateMany({
            where: { id: taskId, status: 'PROCESSING' },
            data: { status: 'COMPLETED', finishedAt: new Date() }
        })
        if (completeResult.count === 0) {
            console.warn(`[RestoreWorker] Task ${taskId}: 已不处于 PROCESSING，跳过完成状态覆盖`)
            return
        }

        console.log(`[RestoreWorker] Task ${taskId}: 恢复完成`)

        // 发送通知
        await sendNotification(task.userId, 'backup_restored', {
            instanceName: task.originalInstanceName,
            backupName: backup?.name || '未知',
            hostName: host.name
        })

        await createLog(
            task.userId,
            'backup',
            'backup.restore',
            `Successfully restored instance "${task.originalInstanceName}" from backup "${backup?.name}"`,
            'success',
            { instanceId: task.instanceId }
        )

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(`[RestoreWorker] Task ${taskId} failed:`, errorMessage)

        // 尝试清理临时实例
        if (task.tempInstanceName) {
            try {
                const host = await prisma.host.findUnique({ where: { id: task.hostId } })
                if (host) {
                    const client = await getIncusClient({
                        id: host.id,
                        url: host.url,
                        certPath: host.certPath,
                        keyPath: host.keyPath
                    })
                    const { instanceExists } = await import('../lib/incus/incus-restore.js')
                    const tempExists = await instanceExists(client, task.tempInstanceName)
                    if (tempExists) {
                        await deleteInstance(client, task.tempInstanceName)
                        console.log(`[RestoreWorker] Task ${taskId}: 已清理临时实例 ${task.tempInstanceName}`)
                    }
                }
            } catch (cleanupErr) {
                console.warn(`[RestoreWorker] Task ${taskId}: 清理临时实例失败:`, cleanupErr)
            }
        }

        const failResult = await prisma.restoreTask.updateMany({
            where: { id: taskId, status: 'PROCESSING' },
            data: {
                status: 'FAILED',
                error: errorMessage,
                finishedAt: new Date()
            }
        })
        if (failResult.count === 0) {
            console.warn(`[RestoreWorker] Task ${taskId}: 已不处于 PROCESSING，跳过失败状态覆盖`)
            return
        }

        await createLog(
            task.userId,
            'backup',
            'backup.restore',
            `Failed to restore instance "${task.originalInstanceName}": ${errorMessage}`,
            'failed',
            { instanceId: task.instanceId }
        )
    } finally {
        runningRestoreTaskIds.delete(taskId)
    }
}

/**
 * 启动恢复任务 Worker
 */
export function startRestoreWorker(): void {
    if (workerInterval) {
        console.warn('[RestoreWorker] Worker 已在运行')
        return
    }
    console.log('[RestoreWorker] 启动恢复任务调度器')
    workerInterval = setInterval(() => {
        processQueue().catch(err => {
            console.error('[RestoreWorker] 队列处理错误:', err)
            dbBackoff.arm(err)
        })
    }, POLL_INTERVAL)
    
    // 启动超时检查定时器
    if (!timeoutCheckInterval) {
        timeoutCheckInterval = setInterval(() => {
            cleanupTimeoutTasks().catch(err => {
                console.error('[RestoreWorker] 超时检查错误:', err)
                dbBackoff.arm(err)
            })
        }, TIMEOUT_CHECK_INTERVAL)
        console.log('[RestoreWorker] 启动超时任务检查器')
    }
}

/**
 * 停止恢复任务 Worker
 */
export function stopRestoreWorker(): void {
    if (workerInterval) {
        clearInterval(workerInterval)
        workerInterval = null
        console.log('[RestoreWorker] 恢复任务调度器已停止')
    }
    if (timeoutCheckInterval) {
        clearInterval(timeoutCheckInterval)
        timeoutCheckInterval = null
        console.log('[RestoreWorker] 超时任务检查器已停止')
    }
}

/**
 * 检查实例是否有正在进行的恢复任务
 */
export async function hasActiveRestoreTask(instanceId: number): Promise<{ id: number } | null> {
    return prisma.restoreTask.findFirst({
        where: {
            instanceId,
            status: { in: ['PENDING', 'PROCESSING'] }
        },
        select: { id: true }
    })
}

/**
 * 获取任务在队列中的位置
 * 考虑共享锁：上传任务和恢复任务互斥
 */
export async function getQueuePosition(taskId: number): Promise<number> {
    const task = await prisma.restoreTask.findUnique({
        where: { id: taskId },
        select: { hostId: true, createdAt: true, status: true }
    })

    if (!task || task.status !== 'PENDING') return 0

    // 检查是否有正在执行的恢复任务
    const processingRestoreTask = await prisma.restoreTask.findFirst({
        where: {
            hostId: task.hostId,
            status: 'PROCESSING'
        },
        orderBy: { createdAt: 'asc' }
    })

    // 检查是否有正在执行的上传任务（共享锁）
    const processingUploadTask = await prisma.backupUploadTask.findFirst({
        where: {
            hostId: task.hostId,
            status: 'PROCESSING'
        },
        orderBy: { createdAt: 'asc' }
    })

    // 如果有 PROCESSING 任务（恢复或上传），且创建时间早于当前任务，则位置+1
    const hasProcessingTask =
        (processingRestoreTask && processingRestoreTask.createdAt < task.createdAt) ||
        (processingUploadTask && processingUploadTask.createdAt < task.createdAt)
    const processingCount = hasProcessingTask ? 1 : 0

    // 统计创建时间更早的 PENDING 恢复任务数量
    const pendingCount = await prisma.restoreTask.count({
        where: {
            hostId: task.hostId,
            status: 'PENDING',
            createdAt: { lt: task.createdAt }
        }
    })

    return processingCount + pendingCount + 1
}
