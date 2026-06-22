/**
 * 流量统计 API 路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as trafficDb from '../db/traffic.js'
import * as db from '../db/index.js'
import { formatBytes } from '../services/traffic-notifier.js'
import {
    calculateInstanceTrafficStatus,
    calculateUserTrafficStatus,
    formatLocalDate,
    getTrafficPeriod
} from '../services/traffic-utils.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { parseNullablePostgresBigIntInput } from '../lib/bigint-input.js'

/**
 * BigInt 序列化为字符串
 */
function serializeBigInt(value: bigint | null): string | null {
    return value === null ? null : value.toString()
}

function parsePositiveId(value: string): number | null {
    if (!/^\d+$/.test(value)) {
        return null
    }

    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * 计算百分比
 * 注意: 先转换为 Number 再计算,避免 BigInt 整数除法精度丢失
 * 例如: 160MB / 257GB 用 BigInt 整数除法会得到 0,而非 0.061%
 */
function calculatePercentage(used: bigint, limit: bigint | null): number {
    if (limit === null || limit === 0n) return 0
    // 先转换为浮点数再计算百分比,避免整数除法导致的精度丢失
    const percentage = (Number(used) / Number(limit)) * 100
    return Math.min(100, percentage)
}

export default async function trafficRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== 用户流量 API ====================

    /**
     * 获取当前用户的流量统计
     */
    fastify.get('/me/traffic', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = request.user.id

        const quota = await trafficDb.getUserTrafficQuota(userId)
        if (!quota) {
            return reply.code(404).send({ error: 'User quota not found' })
        }

        const effectiveLimit = quota.monthlyTrafficLimit !== null
            ? quota.monthlyTrafficLimit + quota.extraTrafficQuota
            : null

        return {
            monthlyUsed: serializeBigInt(quota.monthlyTrafficUsed),
            monthlyUsedFormatted: formatBytes(quota.monthlyTrafficUsed),
            monthlyLimit: serializeBigInt(effectiveLimit),
            monthlyLimitFormatted: effectiveLimit ? formatBytes(effectiveLimit) : null,
            extraQuota: serializeBigInt(quota.extraTrafficQuota),
            trafficStatus: quota.trafficStatus,
            percentage: calculatePercentage(quota.monthlyTrafficUsed, effectiveLimit)
        }
    })

    /**
     * 获取指定用户的流量统计（管理员）
     */
    fastify.get<{ Params: { userId: string } }>('/users/:userId/traffic', {
        onRequest: [fastify.authenticateAdmin]
    }, async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
        const userId = parsePositiveId(request.params.userId)
        if (userId === null) {
            return reply.code(400).send({ error: 'Invalid user ID' })
        }

        const quota = await trafficDb.getUserTrafficQuota(userId)
        if (!quota) {
            return reply.code(404).send({ error: 'User quota not found' })
        }

        const effectiveLimit = quota.monthlyTrafficLimit !== null
            ? quota.monthlyTrafficLimit + quota.extraTrafficQuota
            : null

        return {
            monthlyUsed: serializeBigInt(quota.monthlyTrafficUsed),
            monthlyUsedFormatted: formatBytes(quota.monthlyTrafficUsed),
            monthlyLimit: serializeBigInt(effectiveLimit),
            monthlyLimitFormatted: effectiveLimit ? formatBytes(effectiveLimit) : null,
            extraQuota: serializeBigInt(quota.extraTrafficQuota),
            trafficStatus: quota.trafficStatus,
            percentage: calculatePercentage(quota.monthlyTrafficUsed, effectiveLimit)
        }
    })

    /**
     * 更新用户流量限额（管理员）
     */
    fastify.put<{
        Params: { userId: string }
        Body: { monthlyLimit: unknown }
    }>('/users/:userId/traffic/limit', {
        onRequest: [fastify.authenticateAdmin]
    }, async (request: FastifyRequest<{
        Params: { userId: string }
        Body: { monthlyLimit: unknown }
    }>, reply: FastifyReply) => {
        const userId = parsePositiveId(request.params.userId)
        if (userId === null) {
            return reply.code(400).send({ error: 'Invalid user ID' })
        }

        const { monthlyLimit } = request.body
        const limit = parseNullablePostgresBigIntInput(monthlyLimit)
        if (limit === undefined) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid monthly traffic limit'))
        }

        await trafficDb.updateUserTrafficLimit(userId, limit)
        const quota = await trafficDb.getUserTrafficQuota(userId)
        if (quota) {
            const effectiveLimit = quota.monthlyTrafficLimit !== null
                ? quota.monthlyTrafficLimit + quota.extraTrafficQuota
                : null
            const status = calculateUserTrafficStatus(quota.monthlyTrafficUsed, effectiveLimit)
            await trafficDb.updateUserTrafficStatus(userId, status)
        }
        const { reconcileTrafficStateForUser } = await import('../services/traffic-scheduler.js')
        await reconcileTrafficStateForUser(userId)

        return { success: true }
    })

    // ==================== 实例流量 API ====================

    /**
     * 获取实例的流量统计
     */
    fastify.get<{ Params: { instanceId: string } }>('/instances/:instanceId/traffic', {
        onRequest: [fastify.authenticate]
    }, async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
        const instanceId = parsePositiveId(request.params.instanceId)
        if (instanceId === null) {
            return reply.code(400).send({ error: 'Invalid instance ID' })
        }

        const instance = await trafficDb.getInstanceTrafficInfo(instanceId)
        if (!instance) {
            return reply.code(404).send({ error: 'Instance not found' })
        }

        // 权限检查：管理员、实例所有者或宿主机所有者可以查看
        let host: Awaited<ReturnType<typeof db.getHostById>> = null
        // 1. 管理员有权限
        if (request.user.role === 'admin') {
            // 继续执行，稍后获取host信息
        } else if (instance.userId === request.user.id) {
            // 2. 实例所有者有权限
        } else {
            // 3. 检查是否是宿主机所有者
            if (instance.hostId) {
                host = await db.getHostById(instance.hostId)
                if (!host || host.user_id !== request.user.id) {
                    return reply.code(403).send({ error: 'Access denied' })
                }
            } else {
                return reply.code(403).send({ error: 'Access denied' })
            }
        }

        // 获取节点的流量重置日配置，用于计算周期
        if (!host && instance.hostId) {
            host = await db.getHostById(instance.hostId)
        }
        const trafficResetDay = host?.traffic_reset_day ?? 1
        const { periodStart, periodEnd } = getTrafficPeriod(trafficResetDay)

        return {
            monthlyUsed: serializeBigInt(instance.monthlyTrafficUsed),
            monthlyUsedFormatted: formatBytes(instance.monthlyTrafficUsed),
            monthlyLimit: serializeBigInt(instance.monthlyTrafficLimit),
            monthlyLimitFormatted: instance.monthlyTrafficLimit
                ? formatBytes(instance.monthlyTrafficLimit)
                : null,
            trafficStatus: instance.trafficStatus,
            percentage: calculatePercentage(instance.monthlyTrafficUsed, instance.monthlyTrafficLimit),
            trafficResetDay,
            periodStart: formatLocalDate(periodStart),
            periodEnd: formatLocalDate(periodEnd)
        }
    })

    /**
     * 获取实例的流量历史（按周期）
     */
    fastify.get<{
        Params: { instanceId: string }
        Querystring: { days?: string }
    }>('/instances/:instanceId/traffic/history', {
        onRequest: [fastify.authenticate]
    }, async (request: FastifyRequest<{
        Params: { instanceId: string }
        Querystring: { days?: string }
    }>, reply: FastifyReply) => {
        const instanceId = parsePositiveId(request.params.instanceId)
        if (instanceId === null) {
            return reply.code(400).send({ error: 'Invalid instance ID' })
        }

        const instance = await trafficDb.getInstanceTrafficInfo(instanceId)
        if (!instance) {
            return reply.code(404).send({ error: 'Instance not found' })
        }

        // 权限检查：管理员、实例所有者或宿主机所有者可以查看
        let host: Awaited<ReturnType<typeof db.getHostById>> = null
        // 1. 管理员有权限
        if (request.user.role === 'admin') {
            // 继续执行
        } else if (instance.userId === request.user.id) {
            // 2. 实例所有者有权限
        } else {
            // 3. 检查是否是宿主机所有者
            if (instance.hostId) {
                host = await db.getHostById(instance.hostId)
                if (!host || host.user_id !== request.user.id) {
                    return reply.code(403).send({ error: 'Access denied' })
                }
            } else {
                return reply.code(403).send({ error: 'Access denied' })
            }
        }

        // 获取节点的流量重置日配置，用于计算周期
        if (!host && instance.hostId) {
            host = await db.getHostById(instance.hostId)
        }
        const trafficResetDay = host?.traffic_reset_day ?? 1
        const { periodStart, periodEnd } = getTrafficPeriod(trafficResetDay)

        // 按周期获取历史数据
        const history = await trafficDb.getDailyTrafficByPeriod(instanceId, periodStart)

        return {
            trafficResetDay,
            periodStart: formatLocalDate(periodStart),
            periodEnd: formatLocalDate(periodEnd),
            data: history.map(record => ({
                date: formatLocalDate(record.date),
                rxTotal: serializeBigInt(record.rxTotal),
                txTotal: serializeBigInt(record.txTotal),
                rxFormatted: formatBytes(record.rxTotal),
                txFormatted: formatBytes(record.txTotal),
                total: serializeBigInt(record.rxTotal + record.txTotal),
                totalFormatted: formatBytes(record.rxTotal + record.txTotal)
            }))
        }
    })

    /**
     * 更新实例流量限额（管理员）
     */
    fastify.put<{
        Params: { instanceId: string }
        Body: { monthlyLimit: unknown }
    }>('/instances/:instanceId/traffic/limit', {
        onRequest: [fastify.authenticateAdmin]
    }, async (request: FastifyRequest<{
        Params: { instanceId: string }
        Body: { monthlyLimit: unknown }
    }>, reply: FastifyReply) => {
        const instanceId = parsePositiveId(request.params.instanceId)
        if (instanceId === null) {
            return reply.code(400).send({ error: 'Invalid instance ID' })
        }

        const { monthlyLimit } = request.body
        const limit = parseNullablePostgresBigIntInput(monthlyLimit)
        if (limit === undefined) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid monthly traffic limit'))
        }

        await trafficDb.updateInstanceTrafficLimit(instanceId, limit)
        const instance = await trafficDb.getInstanceTrafficInfo(instanceId)
        if (instance) {
            const status = calculateInstanceTrafficStatus(instance.monthlyTrafficUsed, instance.monthlyTrafficLimit)
            await trafficDb.updateInstanceTrafficStatus(instanceId, status)
        }
        const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
        await reconcileTrafficStateForInstanceIds([instanceId])

        return { success: true }
    })

    /**
     * 重置实例月度流量（管理员或宿主机所有者）
     */
    fastify.post<{
        Params: { instanceId: string }
    }>('/instances/:instanceId/traffic/reset', {
        onRequest: [fastify.authenticate]
    }, async (request: FastifyRequest<{
        Params: { instanceId: string }
    }>, reply: FastifyReply) => {
        const instanceId = parsePositiveId(request.params.instanceId)
        if (instanceId === null) {
            return reply.code(400).send({ error: 'Invalid instance ID' })
        }

        const instance = await trafficDb.getInstanceTrafficInfo(instanceId)
        if (!instance) {
            return reply.code(404).send({ error: 'Instance not found' })
        }

        // 权限检查：管理员或宿主机所有者可以重置实例流量
        const isAdmin = request.user.role === 'admin'
        if (!isAdmin) {
            if (instance.hostId) {
                const host = await db.getHostById(instance.hostId)
                if (!host || host.user_id !== request.user.id) {
                    return reply.code(403).send({ error: 'Only admin or host owner can reset instance traffic' })
                }
            } else {
                return reply.code(403).send({ error: 'Access denied' })
            }
        }

        await trafficDb.resetInstanceMonthlyTraffic(instanceId)
        const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
        await reconcileTrafficStateForInstanceIds([instanceId])

        return { success: true, message: 'Instance traffic reset completed' }
    })

    // ==================== 管理员操作 ======================================

    /**
     * 获取节点的流量统计（按周期）
     * 聚合该节点下所有实例的流量
     * 管理员或节点所有者可访问
     */
    fastify.get<{
        Params: { hostId: string }
    }>('/hosts/:hostId/traffic/history', {
        onRequest: [fastify.authenticate]
    }, async (request: FastifyRequest<{
        Params: { hostId: string }
    }>, reply: FastifyReply) => {
        const { user } = request as any
        const hostId = parsePositiveId(request.params.hostId)
        if (hostId === null) {
            return reply.code(400).send({ error: 'Invalid host ID' })
        }

        // 验证节点是否存在
        const host = await db.getHostById(hostId)
        if (!host) {
            return reply.code(404).send({ error: 'Host not found' })
        }

        // 权限检查：管理员或节点所有者
        if (user.role !== 'admin' && host.user_id !== user.id) {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        // 根据节点的流量重置日计算周期
        const trafficResetDay = host.traffic_reset_day ?? 1
        const { periodStart, periodEnd } = getTrafficPeriod(trafficResetDay)

        // 获取周期内每日流量历史
        const history = await trafficDb.getHostDailyTraffic(hostId, trafficResetDay)
        
        // 获取流量汇总（基于实例的 monthlyTrafficUsed/monthlyTrafficLimit）
        const summary = await trafficDb.getHostTrafficSummary(hostId)

        return {
            trafficResetDay,
            periodStart: formatLocalDate(periodStart),
            periodEnd: formatLocalDate(periodEnd),
            data: history.map(record => ({
                date: formatLocalDate(record.date),
                rxTotal: serializeBigInt(record.rxTotal),
                txTotal: serializeBigInt(record.txTotal),
                rxFormatted: formatBytes(record.rxTotal),
                txFormatted: formatBytes(record.txTotal),
                total: serializeBigInt(record.rxTotal + record.txTotal),
                totalFormatted: formatBytes(record.rxTotal + record.txTotal)
            })),
            summary: {
                totalUsed: serializeBigInt(summary.totalUsed),
                totalUsedFormatted: formatBytes(summary.totalUsed),
                totalLimit: serializeBigInt(summary.totalLimit),
                totalLimitFormatted: formatBytes(summary.totalLimit)
            }
        }
    })

    /**
     * 手动触发流量采集（管理员，用于测试）
     */
    fastify.post('/traffic/collect', {
        onRequest: [fastify.authenticateAdmin]
    }, async (_request: FastifyRequest, _reply: FastifyReply) => {
        const { runTrafficJob } = await import('../services/traffic-scheduler.js')

        // 异步执行，不等待完成
        runTrafficJob().catch(console.error)

        return { success: true, message: 'Traffic collection job started' }
    })

    /**
     * 同步套餐流量限额到所有实例（管理员）
     * 将所有实例的流量限额更新为其所属套餐的流量限额
     */
    fastify.post('/traffic/sync-package-limits', {
        onRequest: [fastify.authenticateAdmin]
    }, async (_request: FastifyRequest, _reply: FastifyReply) => {
        const result = await trafficDb.syncPackageTrafficLimitsToInstances()
        if (result.instanceIds.length > 0) {
            try {
                const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
                await reconcileTrafficStateForInstanceIds(result.instanceIds)
            } catch (err) {
                _request.log.warn(err, 'Package traffic limits synced, immediate traffic state reconciliation failed')
            }
        }

        return {
            success: true,
            message: 'Package traffic limits synced to instances',
            updatedCount: result.count
        }
    })
}
