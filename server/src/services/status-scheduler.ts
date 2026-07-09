/**
 * 实例状态同步调度器 (高可用优化版)
 * 
 * 优化特性：
 * 1. 增量同步：优先同步最近有变化的实例
 * 2. 分批处理：避免一次性处理所有实例，降低宿主机压力
 * 3. 优先级队列：running 状态的实例优先同步
 * 4. 健康检查：监控宿主机响应时间，自动降级
 * 5. 连接池复用：使用统一的 Incus 连接池
 */

import { schedule } from 'node-cron'
import pLimit from 'p-limit'
import { prisma } from '../db/prisma.js'
import { getIncusClient } from '../lib/incus/incus-pool.js'
import { isHostHealthy, recordHostSuccess, recordHostError, getAllHostHealth } from '../lib/incus/host-health.js'
import { getInstanceState } from '../lib/incus/incus-instances.js'
import { mapInstanceStatus } from '../lib/incus/incus-utils.js'
import { sendNotification } from '../lib/notifier.js'
import * as db from '../db/index.js'

// ==================== 配置常量 ====================

// 每个宿主机的并发限制
const CONCURRENCY_PER_HOST = 20

// 每批处理的实例数量
const BATCH_SIZE = 50

// 任务超时时间 (5分钟)
const JOB_TIMEOUT_MS = 5 * 60 * 1000

// 单个实例同步超时 (10秒)
const INSTANCE_TIMEOUT_MS = 10 * 1000

// 同步间隔：running 实例 2 分钟，stopped 实例 10 分钟
const SYNC_INTERVAL_RUNNING_MS = 2 * 60 * 1000
const SYNC_INTERVAL_STOPPED_MS = 10 * 60 * 1000

// 任务运行状态标志
let isJobRunning = false
let schedulerStarted = false

// ==================== 性能监控 ====================

interface SyncStats {
    totalChecked: number
    totalChanged: number
    totalErrors: number
    hostStats: Map<number, { checked: number; changed: number; avgResponseTime: number }>
}

let lastSyncStats: SyncStats | null = null

export function getSyncStats(): SyncStats | null {
    return lastSyncStats
}

// ==================== 工具函数 ====================

/**
 * 带超时的 Promise
 */
async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    })

    try {
        return await Promise.race([promise, timeoutPromise])
    } finally {
        if (timeoutId) clearTimeout(timeoutId)
    }
}

// ==================== 核心同步逻辑 ====================

/**
 * 是否存在进行中的实例操作（创建/重建/迁移/恢复/备份上传等）。
 * 这些操作期间 Incus 侧会短暂删除并重建实例，incusId 可能暂时查不到，
 * 状态同步必须避免据此把实例误判为已删除，或误报意外停机。
 */
async function hasActiveInstanceOperation(instanceId: number): Promise<boolean> {
    const [instanceTask, restoreTask, uploadTask] = await Promise.all([
        prisma.instanceTask.findFirst({
            where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
            select: { id: true }
        }),
        prisma.restoreTask.findFirst({
            where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
            select: { id: true }
        }),
        prisma.backupUploadTask.findFirst({
            where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
            select: { id: true }
        })
    ])
    return Boolean(instanceTask || restoreTask || uploadTask)
}

/**
 * 获取需要同步的实例（优化版：增量 + 优先级）
 */
async function getInstancesToSync(batchSize: number) {
    const now = Date.now()

    // 获取需要同步的实例，按优先级排序：
    // 1. running 状态的实例优先
    // 2. 最近未同步的实例优先
    // 注意：不同步 creating 状态的实例，避免与超时清理和 createInstanceAsync 竞争
    const instances = await prisma.instance.findMany({
        where: {
            status: {
                in: ['running', 'stopped']  // 不包含 creating，避免竞争
            },
            host: {
                status: 'online'
            }
        },
        include: {
            host: {
                select: {
                    id: true,
                    name: true,
                    url: true,
                    certPath: true,
                    keyPath: true,
                    status: true
                }
            },
            user: {
                select: {
                    id: true
                }
            }
        },
        orderBy: [
            // running 状态优先
            { status: 'asc' },
            // 最近更新的优先（可能有状态变化）
            { updatedAt: 'desc' }
        ],
        take: batchSize * 3  // 多取一些，后面会过滤
    })

    // 根据上次同步时间过滤
    const needSync = instances.filter(instance => {
        // 优先使用 lastSyncedAt，回退到 updatedAt
        const lastSync = (instance.lastSyncedAt ?? instance.updatedAt).getTime()
        const interval = instance.status === 'running'
            ? SYNC_INTERVAL_RUNNING_MS
            : SYNC_INTERVAL_STOPPED_MS

        // 如果距离上次同步超过同步间隔，需要同步
        return now - lastSync > interval
    })

    // 返回指定数量
    return needSync.slice(0, batchSize)
}

/**
 * 同步单个实例状态
 */
async function syncInstanceStatus(
    instance: {
        id: number
        incusId: string
        name: string
        status: string
        host: {
            id: number
            name: string
            url: string
            certPath: string | null
            keyPath: string | null
        }
        user: { id: number }
    }
): Promise<{ changed: boolean; from?: string; to?: string; error?: string }> {
    const startTime = Date.now()

    try {
        // 检查宿主机健康状态
        if (!isHostHealthy(instance.host.id)) {
            return { changed: false, error: 'Host unhealthy, skipped' }
        }

        const host = await db.getHostById(instance.host.id)
        if (!host) {
            return { changed: false, error: 'Host not found' }
        }

        const client = await getIncusClient(host)

        const state = await withTimeout(
            getInstanceState(client, instance.incusId) as Promise<{ status?: string }>,
            INSTANCE_TIMEOUT_MS,
            'Instance state query timeout'
        )

        const responseTime = Date.now() - startTime
        recordHostSuccess(instance.host.id, responseTime)

        if (!state.status) {
            return { changed: false }
        }

        const incusStatus = mapInstanceStatus(state.status)

        if (incusStatus === 'unknown') {
            return { changed: false }
        }

        // 状态不一致，需要更新
        if (instance.status !== incusStatus) {
            await db.updateInstanceStatus(
                instance.id,
                incusStatus as 'creating' | 'running' | 'stopped' | 'error'
            )
            
            // 同时更新 lastSyncedAt
            await prisma.instance.updateMany({
                where: {
                    id: instance.id,
                    status: { not: 'deleted' }
                },
                data: { lastSyncedAt: new Date() }
            })

            // 如果是从 running 变为 stopped，发送意外停机通知
            // 但重建/迁移/恢复/备份上传等操作会主动停机，属正常过程，不应误报
            if (instance.status === 'running' && incusStatus === 'stopped') {
                if (await hasActiveInstanceOperation(instance.id)) {
                    console.log(`[StatusSync] Instance ${instance.id} stopped during an active operation, skip unexpected-stop notification`)
                } else {
                    try {
                        await sendNotification(instance.user.id, 'instance_unexpected_stop', {
                            instanceName: instance.name,
                            hostName: instance.host.name
                        })
                    } catch (notifyError) {
                        console.error(`[StatusSync] Failed to send notification:`, notifyError)
                    }
                }
            }

            return {
                changed: true,
                from: instance.status,
                to: incusStatus
            }
        }

        // 状态相同，更新 lastSyncedAt 记录同步时间
        await prisma.instance.updateMany({
            where: {
                id: instance.id,
                status: { not: 'deleted' }
            },
            data: { lastSyncedAt: new Date() }
        })

        return { changed: false }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        recordHostError(instance.host.id)

        // 如果实例不存在于 Incus，标记为已删除
        if (errorMessage.includes('not found') || errorMessage.includes('Instance not found')) {
            // 重建/迁移/恢复等操作过程中，Incus 会短暂删除并重建实例，此时 incusId 查不到属正常，
            // 不能据此误判为已删除，否则会导致 restore 终写被 status:'deleted' 拦截、实例记账错乱。
            if (await hasActiveInstanceOperation(instance.id)) {
                console.log(`[StatusSync] Instance ${instance.id} not found in Incus but has an active operation, skip deleted downgrade`)
                return { changed: false, error: 'Active operation in progress, delete downgrade skipped' }
            }
            console.log(`[StatusSync] Instance ${instance.id} not found in Incus, marking as deleted`)
            await db.updateInstanceStatus(instance.id, 'deleted')
            return {
                changed: true,
                from: instance.status,
                to: 'deleted'
            }
        }

        return { changed: false, error: errorMessage }
    }
}

/**
 * 执行状态同步任务
 */
async function executeStatusSyncJob(): Promise<void> {
    const startTime = Date.now()
    const stats: SyncStats = {
        totalChecked: 0,
        totalChanged: 0,
        totalErrors: 0,
        hostStats: new Map()
    }

    // 获取需要同步的实例
    const instances = await getInstancesToSync(BATCH_SIZE)

    if (instances.length === 0) {
        console.log('[StatusSync] No instances need sync')
        return
    }

    console.log(`[StatusSync] Processing ${instances.length} instances...`)

    // 按宿主机分组
    const instancesByHost = new Map<number, typeof instances>()
    for (const instance of instances) {
        const hostInstances = instancesByHost.get(instance.host.id) || []
        hostInstances.push(instance)
        instancesByHost.set(instance.host.id, hostInstances)
    }

    // 并发处理每个宿主机
    const limit = pLimit(CONCURRENCY_PER_HOST)

    await Promise.all(
        Array.from(instancesByHost.entries()).map(async ([hostId, hostInstances]) => {
            const hostStartTime = Date.now()
            let hostChecked = 0
            let hostChanged = 0

            // 并发同步该宿主机上的所有实例
            await Promise.all(
                hostInstances.map(instance =>
                    limit(async () => {
                        const result = await syncInstanceStatus(instance)
                        hostChecked++
                        if (result.changed) {
                            hostChanged++
                            console.log(`[StatusSync] Instance ${instance.id} (${instance.name}): ${result.from} → ${result.to}`)
                        }
                        if (result.error) {
                            stats.totalErrors++
                        }
                        return result
                    })
                )
            )

            const hostDuration = Date.now() - hostStartTime
            stats.hostStats.set(hostId, {
                checked: hostChecked,
                changed: hostChanged,
                avgResponseTime: hostChecked > 0 ? hostDuration / hostChecked : 0
            })

            stats.totalChecked += hostChecked
            stats.totalChanged += hostChanged
        })
    )

    const duration = Date.now() - startTime
    lastSyncStats = stats

    console.log(`[StatusSync] Completed in ${duration}ms: checked=${stats.totalChecked}, changed=${stats.totalChanged}, errors=${stats.totalErrors}`)
}

/**
 * 主状态同步任务
 */
export async function runStatusSyncJob(): Promise<void> {
    if (isJobRunning) {
        console.log('[StatusSync] Previous job still running, skipping...')
        return
    }

    isJobRunning = true

    try {
        await withTimeout(
            executeStatusSyncJob(),
            JOB_TIMEOUT_MS,
            `[StatusSync] Job timeout after ${JOB_TIMEOUT_MS}ms`
        )
    } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
            console.error(`[StatusSync] Job timed out`)
        } else {
            console.error('[StatusSync] Job failed:', error)
        }
    } finally {
        isJobRunning = false
    }
}

/**
 * 启动状态同步调度器
 */
export function startStatusScheduler(): void {
    if (schedulerStarted) {
        return
    }

    schedulerStarted = true

    // 每 1 分钟检查一次（实际同步间隔由 getInstancesToSync 控制）
    schedule('*/1 * * * *', () => {
        runStatusSyncJob().catch(console.error)
    })

    console.log('[StatusSync] Scheduler started (check interval: 1 minute, running sync: 2 min, stopped sync: 10 min)')
}

/**
 * 获取宿主机健康状态
 */
export function getHostHealthStatus(): Map<number, {
    lastResponseTime: number
    errorCount: number
    healthy: boolean
}> {
    const result = new Map()
    for (const [hostId, health] of getAllHostHealth()) {
        result.set(hostId, {
            lastResponseTime: health.lastResponseTime,
            errorCount: health.errorCount,
            healthy: isHostHealthy(hostId)
        })
    }
    return result
}
