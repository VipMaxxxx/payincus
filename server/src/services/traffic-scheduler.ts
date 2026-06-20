/**
 * 流量调度器服务
 * 负责定时采集流量数据、检查配额、执行限速/恢复
 * 
 * 高可用优化:
 * - 使用统一的 incus-pool 连接池管理
 * - 增量收集：只处理有流量变化的实例
 * - 性能监控日志
 */

import { schedule } from 'node-cron'
import pLimit from 'p-limit'
import { IncusClient } from '../lib/incus/incus-client.js'
import { getIncusClientFromPool, updateClientResponseTime, recordClientError, getPoolStatus } from '../lib/incus/incus-pool.js'
import { applyThrottle, isThrottled, restoreBandwidth } from '../lib/incus/incus-traffic.js'
import * as trafficDb from '../db/traffic.js'
import { sendTrafficWarningNotification, sendTrafficThrottledNotification } from './traffic-notifier.js'
import { collectTrafficForInstanceWithClient } from './instance-traffic-collector.js'
import { resolveTrafficBandwidthLimits } from './traffic-bandwidth.js'
import {
    calculateUserTrafficStatus,
    getEffectiveLimit,
    isOverLimit,
    isWarningThreshold,
    isWarningSentThisMonth
} from './traffic-utils.js'

// 任务超时时间（15分钟，大规模实例需要更长时间）
const JOB_TIMEOUT_MS = 15 * 60 * 1000

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// 每宿主机并发限制
// 生产事故修复：默认值从 100 降到 10，并允许通过环境变量覆盖
const CONCURRENCY_PER_HOST = parsePositiveInt(process.env.TRAFFIC_CONCURRENCY_PER_HOST, 10)

// 宿主机并行处理数量（同时采集多个宿主机）
const HOST_CONCURRENCY = parsePositiveInt(process.env.TRAFFIC_HOST_CONCURRENCY, 3)

/**
 * 流量增量数据
 */
interface TrafficDelta {
    instanceId: number
    totalDelta: bigint
}

type RunningTrafficInstance = Awaited<ReturnType<typeof trafficDb.getRunningInstancesForTraffic>>[number]

/**
 * 获取或创建主机客户端（使用统一连接池）
 */
async function getHostClient(host: {
    id: number
    url: string
    certPath: string | null
    keyPath: string | null
}): Promise<IncusClient | null> {
    if (!host.certPath || !host.keyPath) {
        return null
    }

    try {
        const startTime = Date.now()
        const client = await getIncusClientFromPool({
            id: host.id,
            url: host.url,
            certPath: host.certPath,
            keyPath: host.keyPath
        })
        const duration = Date.now() - startTime
        updateClientResponseTime(host.id, duration)
        return client
    } catch (error) {
        console.error(`[Traffic] Failed to get client for host ${host.id}:`, error)
        recordClientError(host.id)
        return null
    }
}

/**
 * 采集单个实例的流量数据
 */
async function collectInstanceTraffic(
    instance: {
        id: number
        incusId: string
        userId: number
        monthlyTrafficUsed: bigint
    },
    client: IncusClient
): Promise<TrafficDelta | null> {
    const result = await collectTrafficForInstanceWithClient({
        instanceId: instance.id,
        userId: instance.userId,
        incusId: instance.incusId,
        client,
        currentUsage: instance.monthlyTrafficUsed
    }, {
        waitTimeoutMs: 200,
        retryIntervalMs: 50,
        expireMs: 30000
    })

    if (!result.success) {
        console.error(`[Traffic] Failed to collect traffic for instance ${instance.id}: ${result.error}`)
        return null
    }

    return {
        instanceId: instance.id,
        totalDelta: result.totalDelta
    }
}

/**
 * 检查并执行限速
 */
async function checkAndThrottle(
    instance: RunningTrafficInstance,
    client: IncusClient
): Promise<void> {
    const userQuota = instance.user.quota
    if (!userQuota) return

    const userEffectiveLimit = getEffectiveLimit(userQuota.monthlyTrafficLimit, userQuota.extraTrafficQuota)
    const instanceLimit = instance.monthlyTrafficLimit

    // 检查用户级别限额
    const userOverLimit = isOverLimit(userQuota.monthlyTrafficUsed, userEffectiveLimit)
    // 检查实例级别限额
    const instanceOverLimit = isOverLimit(instance.monthlyTrafficUsed, instanceLimit)

    if (userOverLimit || instanceOverLimit) {
        const remoteThrottled = await isThrottled(client, instance.incusId)

        if (instance.trafficStatus !== 'LIMITED' || !remoteThrottled) {
            const wasMarkedLimited = instance.trafficStatus === 'LIMITED'
            try {
                await applyThrottle(client, instance.incusId)
                await trafficDb.updateInstanceTrafficStatus(instance.id, 'LIMITED')
                if (userOverLimit && userQuota.trafficStatus !== 'LIMITED') {
                    await trafficDb.updateUserTrafficStatus(instance.userId, 'LIMITED')
                }

                if (!wasMarkedLimited) {
                    await sendTrafficThrottledNotification(instance.userId, instance.name, instance.host.name)
                }

                console.log(`[Traffic] Throttled instance ${instance.id} (${instance.incusId})`)
            } catch (error) {
                console.error(`[Traffic] Failed to throttle instance ${instance.id}:`, error)
            }
        } else if (userOverLimit && userQuota.trafficStatus !== 'LIMITED') {
            await trafficDb.updateUserTrafficStatus(instance.userId, 'LIMITED')
        }
    } else {
        // 检查预警
        const userWarning = isWarningThreshold(userQuota.monthlyTrafficUsed, userEffectiveLimit)
        if (userWarning && !isWarningSentThisMonth(userQuota.trafficWarningSentAt)) {
            await trafficDb.updateUserTrafficStatus(instance.userId, 'WARNING')
            await trafficDb.updateUserTrafficWarningSentAt(instance.userId, new Date())
            await sendTrafficWarningNotification(
                instance.userId,
                userQuota.monthlyTrafficUsed,
                userEffectiveLimit!
            )
            console.log(`[Traffic] Sent warning to user ${instance.userId}`)
        }
    }
}

/**
 * 检查并恢复带宽
 */
async function checkAndRestore(
    instance: RunningTrafficInstance,
    client: IncusClient
): Promise<void> {
    const userQuota = instance.user.quota
    if (!userQuota) return

    const userEffectiveLimit = getEffectiveLimit(userQuota.monthlyTrafficLimit, userQuota.extraTrafficQuota)
    const instanceLimit = instance.monthlyTrafficLimit

    const userUnderLimit = !isOverLimit(userQuota.monthlyTrafficUsed, userEffectiveLimit)
    const instanceUnderLimit = !isOverLimit(instance.monthlyTrafficUsed, instanceLimit)
    const desiredUserStatus = calculateUserTrafficStatus(userQuota.monthlyTrafficUsed, userEffectiveLimit)

    if (userUnderLimit && instanceUnderLimit) {
        const remoteThrottled = await isThrottled(client, instance.incusId)
        if (instance.trafficStatus !== 'LIMITED' && !remoteThrottled) {
            if (userQuota.trafficStatus !== desiredUserStatus) {
                await trafficDb.updateUserTrafficStatus(instance.userId, desiredUserStatus)
            }
            return
        }

        try {
            const resolvedLimits = resolveTrafficBandwidthLimits(instance, {
                stripThrottleOverride: remoteThrottled || instance.trafficStatus === 'LIMITED'
            })

            await restoreBandwidth(
                client,
                instance.incusId,
                resolvedLimits.incusIngress,
                resolvedLimits.incusEgress
            )
            await trafficDb.updateInstanceTrafficStatus(instance.id, 'NORMAL')
            await trafficDb.updateInstanceBandwidthLimits(
                instance.id,
                resolvedLimits.dbIngress,
                resolvedLimits.dbEgress
            )

            if (userQuota.trafficStatus !== desiredUserStatus) {
                await trafficDb.updateUserTrafficStatus(instance.userId, desiredUserStatus)
            }

            console.log(`[Traffic] Restored bandwidth for instance ${instance.id}`)
        } catch (error) {
            console.error(`[Traffic] Failed to restore bandwidth for instance ${instance.id}:`, error)
        }
    }
}

async function reconcileTrafficState(instances: RunningTrafficInstance[]): Promise<void> {
    if (instances.length === 0) {
        return
    }

    const instancesByHost = new Map<number, RunningTrafficInstance[]>()
    for (const instance of instances) {
        if (instance.host.status !== 'online') continue

        const hostInstances = instancesByHost.get(instance.host.id) || []
        hostInstances.push(instance)
        instancesByHost.set(instance.host.id, hostInstances)
    }

    for (const [hostId, hostInstances] of instancesByHost) {
        const host = hostInstances[0].host
        const client = await getHostClient({
            id: hostId,
            url: host.url,
            certPath: host.certPath,
            keyPath: host.keyPath
        })

        if (!client) continue

        const hostLimit = pLimit(CONCURRENCY_PER_HOST)
        await Promise.all(
            hostInstances.map(instance =>
                hostLimit(async () => {
                    await checkAndThrottle(instance, client)
                    await checkAndRestore(instance, client)
                })
            )
        )
    }
}

export async function reconcileTrafficStateForInstanceIds(instanceIds: number[]): Promise<void> {
    const instances = await trafficDb.getRunningInstancesForTrafficByIds(instanceIds)
    await reconcileTrafficState(instances)
}

export async function reconcileTrafficStateForUser(userId: number): Promise<void> {
    const instances = await trafficDb.getRunningInstancesForTrafficByUserId(userId)
    await reconcileTrafficState(instances)
}

/**
 * 带超时的任务执行（带定时器清理，防止内存泄漏）
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

/**
 * 主流量采集任务
 */
export async function runTrafficJob(): Promise<void> {
    console.log('[Traffic] Starting traffic collection job...')
    const startTime = Date.now()

    try {
        // 使用超时包装整个任务
        await withTimeout(
            executeTrafficJob(startTime),
            JOB_TIMEOUT_MS,
            `[Traffic] Job timeout after ${JOB_TIMEOUT_MS}ms`
        )
    } catch (error) {
        const duration = Date.now() - startTime
        if (error instanceof Error && error.message.includes('timeout')) {
            console.error(`[Traffic] Job timed out after ${duration}ms`)
        } else {
            console.error('[Traffic] Job failed:', error)
        }
        throw error
    }
}

/**
 * 执行流量采集任务（实际逻辑）
 * 高可用优化：按宿主机分批处理，控制并发
 */
async function executeTrafficJob(startTime: number): Promise<void> {
    const instances = await trafficDb.getRunningInstancesForTraffic()
    console.log(`[Traffic] Found ${instances.length} running instances`)

    if (instances.length === 0) return

    // 创建实例映射表（用于后续查找）
    const instanceMap = new Map<number, typeof instances[0]>()
    for (const instance of instances) {
        instanceMap.set(instance.id, instance)
    }

    // 按主机分组
    const instancesByHost = new Map<number, typeof instances>()
    for (const instance of instances) {
        if (instance.host.status !== 'online') continue

        const hostInstances = instancesByHost.get(instance.host.id) || []
        hostInstances.push(instance)
        instancesByHost.set(instance.host.id, hostInstances)
    }

    // 收集流量数据
    const deltas: TrafficDelta[] = []
    // 性能统计
    let successCount = 0
    let errorCount = 0

    // 定义单个宿主机的采集函数
    async function collectHostTraffic(hostId: number, hostInstances: typeof instances): Promise<{
        deltas: TrafficDelta[]
        success: number
        error: number
    }> {
        const host = hostInstances[0].host
        const client = await getHostClient({
            id: hostId,
            url: host.url,
            certPath: host.certPath,
            keyPath: host.keyPath
        })

        if (!client) {
            return { deltas: [], success: 0, error: hostInstances.length }
        }

        // 每宿主机使用独立的并发限制
        const hostLimit = pLimit(CONCURRENCY_PER_HOST)
        
        // 并发采集该主机上的所有实例
        const results = await Promise.all(
            hostInstances.map(instance =>
                hostLimit(() => collectInstanceTraffic(instance, client))
            )
        )

        const hostDeltas: TrafficDelta[] = []
        let hostSuccess = 0
        let hostError = 0

        for (const delta of results) {
            if (delta) {
                hostDeltas.push(delta)
                hostSuccess++
            } else {
                hostError++
            }
        }

        return { deltas: hostDeltas, success: hostSuccess, error: hostError }
    }

    // 并行处理多个宿主机（限制并发数）
    const hostLimit = pLimit(HOST_CONCURRENCY)
    const hostEntries = Array.from(instancesByHost.entries())
    
    const hostResults = await Promise.all(
        hostEntries.map(([hostId, hostInstances]) =>
            hostLimit(() => collectHostTraffic(hostId, hostInstances))
        )
    )

    // 汇总所有宿主机的结果
    for (const result of hostResults) {
        deltas.push(...result.deltas)
        successCount += result.success
        errorCount += result.error
    }

    // 优化限速检查：检查有流量更新的实例以及当前处于限速状态的实例
    // 在内存中计算更新后的用量，避免重新查询数据库
    // 需要检查的实例：1) 有流量更新的实例 2) 当前处于限速状态的实例（可能因为配额调整而需要恢复）
    const instancesToCheckForThrottle = new Set<number>()
    
    // 添加有流量更新的实例
    for (const delta of deltas) {
        instancesToCheckForThrottle.add(delta.instanceId)
    }
    
    // 添加当前处于限速状态的实例（可能需要恢复）
    for (const instance of instances) {
        if (instance.trafficStatus === 'LIMITED' || (instance.user.quota?.trafficStatus === 'LIMITED')) {
            instancesToCheckForThrottle.add(instance.id)
        }
    }

    if (instancesToCheckForThrottle.size > 0) {
        // 计算每个实例和用户更新后的用量（在内存中）
        const instanceUpdatedUsage = new Map<number, bigint>()
        const userUpdatedUsage = new Map<number, bigint>()

        // 初始化用量（使用原始值）
        for (const instance of instances) {
            instanceUpdatedUsage.set(instance.id, instance.monthlyTrafficUsed)
            if (instance.user.quota) {
                const currentUserUsage = userUpdatedUsage.get(instance.userId) ?? instance.user.quota.monthlyTrafficUsed
                userUpdatedUsage.set(instance.userId, currentUserUsage)
            }
        }

        // 累加更新量
        for (const delta of deltas) {
            if (delta.totalDelta > 0n) {
                const instance = instanceMap.get(delta.instanceId)
                if (!instance) continue

                // 更新实例用量
                const currentInstanceUsage = instanceUpdatedUsage.get(delta.instanceId) ?? 0n
                instanceUpdatedUsage.set(delta.instanceId, currentInstanceUsage + delta.totalDelta)

                // 更新用户用量
                const currentUserUsage = userUpdatedUsage.get(instance.userId) ?? 0n
                userUpdatedUsage.set(instance.userId, currentUserUsage + delta.totalDelta)
            }
        }

        // 构建用于限速检查的实例列表
        const instancesToCheck = Array.from(instancesToCheckForThrottle)
            .map(instanceId => instanceMap.get(instanceId))
            .filter((instance): instance is NonNullable<typeof instance> => {
                if (!instance || instance.host.status !== 'online') return false
                return true
            })
            .map(instance => {
                const updatedInstanceUsage = instanceUpdatedUsage.get(instance.id) ?? instance.monthlyTrafficUsed
                const updatedUserUsage = instance.user.quota
                    ? (userUpdatedUsage.get(instance.userId) ?? instance.user.quota.monthlyTrafficUsed)
                    : 0n

                // 构建更新后的实例对象（用于限速检查）
                return {
                    ...instance,
                    monthlyTrafficUsed: updatedInstanceUsage,
                    user: {
                        ...instance.user,
                        quota: instance.user.quota ? {
                            ...instance.user.quota,
                            monthlyTrafficUsed: updatedUserUsage
                        } : null
                    }
                }
            })

        await reconcileTrafficState(instancesToCheck)
    }

    const duration = Date.now() - startTime
    
    // 输出详细的性能统计
    console.log(`[Traffic] Job completed in ${duration}ms - instances: ${deltas.length}, success: ${successCount}, errors: ${errorCount}`)
    
    // 输出连接池状态（调试用）
    if (process.env.DEBUG_TRAFFIC === 'true') {
        const poolStatus = getPoolStatus()
        console.log(`[Traffic] Connection pool status:`, Object.fromEntries(poolStatus))
    }
}

/**
 * 月度重置任务（用户级别）
 * 每月1号重置所有用户的月度流量统计
 * 注：实例级别流量改由 runDailyHostTrafficResetJob 按节点重置日重置
 */
export async function runMonthlyUserTrafficResetJob(): Promise<void> {
    console.log('[Traffic] Starting monthly user traffic reset job...')

    try {
        // 只重置用户级别的月度用量（保持自然月）
        await trafficDb.resetAllUserMonthlyTraffic()
        console.log('[Traffic] Monthly user traffic reset completed')
    } catch (error) {
        console.error('[Traffic] Monthly user traffic reset failed:', error)
    }
}

/**
 * 每日节点流量重置任务
 * 根据各节点的 trafficResetDay 配置，重置该节点下所有实例的流量
 */
export async function runDailyHostTrafficResetJob(): Promise<void> {
    const today = new Date().getDate()
    console.log(`[Traffic] Starting daily host traffic reset check (today is day ${today})...`)

    try {
        // 查找今天需要重置的节点
        const { prisma } = await import('../db/prisma.js')
        const hostsToReset = await prisma.host.findMany({
            where: { trafficResetDay: today },
            select: { id: true, name: true }
        })

        if (hostsToReset.length === 0) {
            console.log('[Traffic] No hosts need traffic reset today')
            return
        }

        console.log(`[Traffic] Found ${hostsToReset.length} hosts to reset: ${hostsToReset.map(h => h.name).join(', ')}`)

        // 重置这些节点下所有实例的流量
        const hostIds = hostsToReset.map(h => h.id)
        await trafficDb.resetHostInstancesMonthlyTraffic(hostIds)

        const instances = await trafficDb.getRunningInstancesForTraffic()
        const instancesToReconcile = instances.filter(i => hostIds.includes(i.host.id))
        await reconcileTrafficState(instancesToReconcile)

        console.log(`[Traffic] Daily host traffic reset completed for ${hostsToReset.length} hosts`)
    } catch (error) {
        console.error('[Traffic] Daily host traffic reset failed:', error)
    }
}

/**
 * 保留旧的月度重置函数名稱（兼容性）
 * @deprecated 使用 runMonthlyUserTrafficResetJob 和 runDailyHostTrafficResetJob 代替
 */
export async function runMonthlyResetJob(): Promise<void> {
    // 兼容旧代码：调用用户级别重置
    await runMonthlyUserTrafficResetJob()
}

/**
 * 清理旧数据任务
 * 清理周期改3天，确保完整周期的流量历史数据
 */
export async function runCleanupJob(): Promise<void> {
    console.log('[Traffic] Starting cleanup job...')

    try {
        // 清理周期改3天，支持最大重置日28号的完整周期
        const deleted = await trafficDb.cleanOldDailyTraffic(35)
        console.log(`[Traffic] Cleaned up ${deleted} old daily traffic records`)
    } catch (error) {
        console.error('[Traffic] Cleanup failed:', error)
    }
}

/**
 * 清理旧通知日志
 */
export async function runNotificationCleanupJob(): Promise<void> {
    console.log('[Traffic] Starting notification log cleanup job...')

    try {
        const { cleanOldNotificationLogs } = await import('../db/notifications.js')
        const deleted = await cleanOldNotificationLogs(30)
        console.log(`[Traffic] Cleaned up ${deleted} old notification logs`)
    } catch (error) {
        console.error('[Traffic] Notification log cleanup failed:', error)
    }
}

/**
 * 综合清理任务（过期 Token、验证码、分布式锁、操作验证记录）
 */
export async function runSystemCleanupJob(): Promise<void> {
    console.log('[System] Starting system cleanup job...')

    try {
        // 清理过期的 Refresh Token
        const { cleanupExpiredRefreshTokens } = await import('../lib/security.js')
        const tokensDeleted = await cleanupExpiredRefreshTokens()
        if (tokensDeleted > 0) {
            console.log(`[System] Cleaned up ${tokensDeleted} expired refresh tokens`)
        }

        // 清理过期的邮箱验证码
        const { cleanupExpiredCodes } = await import('../db/email-verification.js')
        const codesDeleted = await cleanupExpiredCodes()
        if (codesDeleted > 0) {
            console.log(`[System] Cleaned up ${codesDeleted} expired email verification codes`)
        }

        // 清理过期的分布式锁
        const { cleanupExpiredLocks } = await import('../lib/distributed-lock.js')
        const locksDeleted = await cleanupExpiredLocks()
        if (locksDeleted > 0) {
            console.log(`[System] Cleaned up ${locksDeleted} expired distributed locks`)
        }

        // 清理过期的操作验证记录
        const { cleanupExpiredVerifications } = await import('../lib/operation-verification.js')
        const verificationsDeleted = await cleanupExpiredVerifications()
        if (verificationsDeleted > 0) {
            console.log(`[System] Cleaned up ${verificationsDeleted} expired operation verifications`)
        }

        // 清理过期的 Token 失效标记
        const { cleanupExpiredTokenInvalidations } = await import('../lib/security.js')
        const tokenInvalidationsDeleted = await cleanupExpiredTokenInvalidations()
        if (tokenInvalidationsDeleted > 0) {
            console.log(`[System] Cleaned up ${tokenInvalidationsDeleted} expired token invalidations`)
        }

        // 清理旧的操作日志（90天前）
        const { cleanOldLogs } = await import('../db/logs.js')
        const logsDeleted = await cleanOldLogs(90)
        if (logsDeleted > 0) {
            console.log(`[System] Cleaned up ${logsDeleted} old operation logs`)
        }

        console.log('[System] System cleanup job completed')
    } catch (error) {
        console.error('[System] System cleanup failed:', error)
    }
}

/**
 * 启动流量调度器
 */
export function startTrafficScheduler(): void {
    // 每 3 分钟采集流量
    schedule('*/3 * * * *', () => {
        runTrafficJob().catch(console.error)
    })

    // 每月 1 日 00:05 重置用户级别流量
    schedule('5 0 1 * *', () => {
        runMonthlyUserTrafficResetJob().catch(console.error)
    })

    // 每天 00:05 检查并重置需要重置的节点实例流量
    schedule('5 0 * * *', () => {
        runDailyHostTrafficResetJob().catch(console.error)
    })

    // 每天 03:00 清理旧数据
    schedule('0 3 * * *', () => {
        runCleanupJob().catch(console.error)
    })

    // 每天 03:30 清理旧通知日志
    schedule('30 3 * * *', () => {
        runNotificationCleanupJob().catch(console.error)
    })

    // 每天 04:00 清理过期的 Token、验证码、分布式锁、操作验证记录
    schedule('0 4 * * *', () => {
        runSystemCleanupJob().catch(console.error)
    })

    console.log('[Traffic] Scheduler started')
    console.log('[Traffic] - Traffic collection: every 3 minutes')
    console.log('[Traffic] - User traffic reset: 1st of each month at 00:05')
    console.log('[Traffic] - Host instance traffic reset: daily at 00:05 (per host resetDay)')
    console.log('[Traffic] - Data cleanup: daily at 03:00 (retention: 35 days)')
}
