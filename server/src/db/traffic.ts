/**
 * 流量统计相关数据库操作
 * 
 * 安全改进：批量操作使用事务隔离级别配置
 */

import { prisma } from './prisma.js'
import { applyTrafficMultiplier } from '../lib/traffic-multiplier.js'
import { calculateInstanceTrafficStatus } from '../services/traffic-utils.js'
import type { TrafficStatus } from '@prisma/client'

// 批量更新分片大小（避免单次 SQL 语句过大，支持大规模实例）
const BATCH_SIZE = 1000

/**
 * 验证并清理 SQL 值（防止 SQL 注入，虽然输入是受控的数字类型）
 */
function sanitizeNumber(value: number | bigint): string {
    if (typeof value === 'bigint') {
        // bigint 值确保是有效数字
        if (value < 0n) {
            throw new Error(`Invalid bigint value: ${value}`)
        }
        return value.toString()
    }
    // number 值验证
    if (!Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
        throw new Error(`Invalid number value: ${value}`)
    }
    return value.toString()
}

/**
 * 验证并清理日期字符串
 */
function sanitizeDate(date: Date): string {
    const dateStr = date.toISOString().split('T')[0] // YYYY-MM-DD
    // 验证格式：YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new Error(`Invalid date format: ${dateStr}`)
    }
    return dateStr
}

// ==================== 快照操作 ====================

/**
 * 获取实例的流量快照
 */
export async function getTrafficSnapshot(instanceId: number) {
    return prisma.trafficSnapshot.findUnique({
        where: { instanceId }
    })
}

/**
 * 更新或创建流量快照
 */
export async function upsertTrafficSnapshot(
    instanceId: number,
    rxRaw: bigint,
    txRaw: bigint
) {
    return prisma.trafficSnapshot.upsert({
        where: { instanceId },
        update: { rxRaw, txRaw },
        create: { instanceId, rxRaw, txRaw }
    })
}

/**
 * 批量更新流量快照
 * 使用 PostgreSQL 的 INSERT ... ON CONFLICT 进行高效的批量更新
 * 支持大规模实例（10000+），使用分片处理避免事务过大
 */
export async function bulkUpsertSnapshots(
    snapshots: Array<{ instanceId: number; rxRaw: bigint; txRaw: bigint }>
) {
    if (snapshots.length === 0) return

    // 分批处理，避免单次事务过大
    for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
        const batch = snapshots.slice(i, i + BATCH_SIZE)
        
        // 使用 PostgreSQL 的 INSERT ... ON CONFLICT (upsert) 语法进行批量更新
        // 构建 VALUES 子句（验证并清理所有值）
        const valuesClause = batch
            .map(s => {
                const instanceId = sanitizeNumber(s.instanceId)
                const rxRaw = sanitizeNumber(s.rxRaw)
                const txRaw = sanitizeNumber(s.txRaw)
                return `(${instanceId}, ${rxRaw}, ${txRaw}, NOW())`
            })
            .join(', ')
        
        // 使用原生 SQL 批量 upsert
        try {
            await prisma.$executeRawUnsafe(`
                INSERT INTO traffic_snapshots (instance_id, rx_raw, tx_raw, updated_at)
                VALUES ${valuesClause}
                ON CONFLICT (instance_id)
                DO UPDATE SET
                    rx_raw = EXCLUDED.rx_raw,
                    tx_raw = EXCLUDED.tx_raw,
                    updated_at = NOW()
            `)
        } catch (error) {
            console.error(`[Traffic] Failed to bulk upsert snapshots (batch ${i}-${i + batch.length}):`, error)
            throw error
        }
    }
}

// ==================== 每日聚合操作 ====================

/**
 * 更新或创建每日流量记录
 */
export async function upsertDailyTraffic(
    instanceId: number,
    date: Date,
    rxIncrement: bigint,
    txIncrement: bigint
) {
    // 标准化日期为当天 00:00:00
    const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    const existing = await prisma.dailyTraffic.findUnique({
        where: {
            instanceId_date: { instanceId, date: normalizedDate }
        }
    })

    if (existing) {
        return prisma.dailyTraffic.update({
            where: { id: existing.id },
            data: {
                rxTotal: existing.rxTotal + rxIncrement,
                txTotal: existing.txTotal + txIncrement
            }
        })
    }

    return prisma.dailyTraffic.create({
        data: {
            instanceId,
            date: normalizedDate,
            rxTotal: rxIncrement,
            txTotal: txIncrement
        }
    })
}

/**
 * 批量更新或创建每日流量记录
 * 使用 PostgreSQL 的 INSERT ... ON CONFLICT 进行高效的批量更新
 * 支持大规模实例（10000+），使用分片处理避免事务过大
 */
export async function bulkUpsertDailyTraffic(
    updates: Array<{ instanceId: number; date: Date; rxIncrement: bigint; txIncrement: bigint }>
) {
    if (updates.length === 0) return

    // 标准化日期并分组（按 instanceId + date）
    const normalizedUpdates = updates.map(u => ({
        instanceId: u.instanceId,
        date: new Date(u.date.getFullYear(), u.date.getMonth(), u.date.getDate()),
        rxIncrement: u.rxIncrement,
        txIncrement: u.txIncrement
    }))

    // 合并同一个实例同一天的增量
    const dailyMap = new Map<string, { instanceId: number; date: Date; rxTotal: bigint; txTotal: bigint }>()
    for (const u of normalizedUpdates) {
        const key = `${u.instanceId}-${u.date.getTime()}`
        const existing = dailyMap.get(key)
        if (existing) {
            existing.rxTotal += u.rxIncrement
            existing.txTotal += u.txIncrement
        } else {
            dailyMap.set(key, {
                instanceId: u.instanceId,
                date: u.date,
                rxTotal: u.rxIncrement,
                txTotal: u.txIncrement
            })
        }
    }

    const dailyArray = Array.from(dailyMap.values())
    
    // 分批处理，避免单次事务过大
    for (let i = 0; i < dailyArray.length; i += BATCH_SIZE) {
        const batch = dailyArray.slice(i, i + BATCH_SIZE)
        
        // 使用 PostgreSQL 的 INSERT ... ON CONFLICT (upsert) 语法进行批量更新
        // 构建 VALUES 子句（验证并清理所有值）
        const valuesClause = batch
            .map(({ instanceId, date, rxTotal, txTotal }) => {
                const instanceIdStr = sanitizeNumber(instanceId)
                const dateStr = sanitizeDate(date)
                const rxTotalStr = sanitizeNumber(rxTotal)
                const txTotalStr = sanitizeNumber(txTotal)
                return `(${instanceIdStr}, '${dateStr}'::date, ${rxTotalStr}, ${txTotalStr})`
            })
            .join(', ')
        
        // 使用原生 SQL 批量 upsert
        try {
            await prisma.$executeRawUnsafe(`
                INSERT INTO daily_traffic (instance_id, date, rx_total, tx_total)
                VALUES ${valuesClause}
                ON CONFLICT (instance_id, date)
                DO UPDATE SET
                    rx_total = daily_traffic.rx_total + EXCLUDED.rx_total,
                    tx_total = daily_traffic.tx_total + EXCLUDED.tx_total
            `)
        } catch (error) {
            console.error(`[Traffic] Failed to bulk upsert daily traffic (batch ${i}-${i + batch.length}):`, error)
            throw error
        }
    }
}

/**
 * 获取实例的每日流量历史
 */
export async function getDailyTraffic(instanceId: number, days: number = 30) {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    startDate.setHours(0, 0, 0, 0)

    return prisma.dailyTraffic.findMany({
        where: {
            instanceId,
            date: { gte: startDate }
        },
        orderBy: { date: 'asc' }
    })
}

/**
 * 获取实例的每日流量历史（按周期）
 * @param instanceId 实例 ID
 * @param periodStart 周期开始日期
 */
export async function getDailyTrafficByPeriod(instanceId: number, periodStart: Date) {
    return prisma.dailyTraffic.findMany({
        where: {
            instanceId,
            date: { gte: periodStart }
        },
        orderBy: { date: 'asc' }
    })
}

/**
 * 获取节点的每日流量历史（聚合该节点下所有实例的流量）
 * 根据节点的 trafficResetDay 计算周期起始日期
 * @param hostId 节点 ID
 * @param trafficResetDay 流量重置日（默认 1）
 */
export async function getHostDailyTraffic(hostId: number, trafficResetDay: number = 1) {
    // 导入周期计算函数
    const { getTrafficPeriod } = await import('../services/traffic-utils.js')
    const { periodStart } = getTrafficPeriod(trafficResetDay)

    // 使用原生 SQL 进行聚合查询
    // 按日期分组，聚合节点下所有当前存在的实例的流量
    // 注意：SUM() 返回 numeric 类型，必须显式转换为 bigint，否则 Prisma 返回 Decimal 对象
    const result = await prisma.$queryRaw<Array<{
        date: Date
        rx_total: bigint
        tx_total: bigint
    }>>`
        SELECT 
            dt.date,
            COALESCE(SUM(dt.rx_total), 0)::bigint as rx_total,
            COALESCE(SUM(dt.tx_total), 0)::bigint as tx_total
        FROM daily_traffic dt
        INNER JOIN instances i ON dt.instance_id = i.id
        WHERE i.host_id = ${hostId}
          AND i.status != 'deleted'
          AND dt.date >= ${periodStart}
        GROUP BY dt.date
        ORDER BY dt.date ASC
    `

    return result.map(row => ({
        date: row.date,
        rxTotal: row.rx_total,
        txTotal: row.tx_total
    }))
}

/**
 * 获取节点的流量汇总（基于实例当前的 monthlyTrafficUsed）
 * @param hostId 节点 ID
 */
export async function getHostTrafficSummary(hostId: number) {
    // 聚合节点下所有活跃实例的流量使用和流量限制
    const result = await prisma.instance.aggregate({
        where: {
            hostId,
            status: { notIn: ['deleted'] }
        },
        _sum: {
            monthlyTrafficUsed: true,
            monthlyTrafficLimit: true
        }
    })

    return {
        totalUsed: result._sum.monthlyTrafficUsed || 0n,
        totalLimit: result._sum.monthlyTrafficLimit || 0n
    }
}

/**
 * 清理过期的每日流量记录
 */
export async function cleanOldDailyTraffic(retentionDays: number = 30) {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    cutoffDate.setHours(0, 0, 0, 0)

    const result = await prisma.dailyTraffic.deleteMany({
        where: {
            date: { lt: cutoffDate }
        }
    })

    return result.count
}

// ==================== 用量更新操作 ====================

/**
 * 增加实例流量用量
 */
export async function incrementInstanceTrafficUsage(instanceId: number, delta: bigint) {
    return prisma.instance.update({
        where: { id: instanceId },
        data: {
            monthlyTrafficUsed: { increment: delta }
        }
    })
}

/**
 * 批量增加实例流量用量
 * 使用 PostgreSQL 的 UPDATE ... FROM VALUES 进行高效的批量更新
 * 支持大规模实例（10000+），使用分片处理避免事务过大
 */
export async function bulkIncrementInstanceTrafficUsage(
    updates: Array<{ instanceId: number; delta: bigint }>
) {
    if (updates.length === 0) return

    // 按实例 ID 分组，累加同一个实例的增量（理论上不应该出现，但为了安全）
    const instanceDeltas = new Map<number, bigint>()
    for (const { instanceId, delta } of updates) {
        const current = instanceDeltas.get(instanceId) || 0n
        instanceDeltas.set(instanceId, current + delta)
    }

    // 转换为数组并按分片大小分批处理
    const deltasArray = Array.from(instanceDeltas.entries())
    
    // 分批处理，避免单次事务过大
    for (let i = 0; i < deltasArray.length; i += BATCH_SIZE) {
        const batch = deltasArray.slice(i, i + BATCH_SIZE)
        
        // 使用 PostgreSQL 的 UPDATE ... FROM VALUES 语法进行批量更新
        // 构建 VALUES 子句（验证并清理所有值）
        const valuesClause = batch
            .map(([instanceId, delta]) => {
                const instanceIdStr = sanitizeNumber(instanceId)
                const deltaStr = sanitizeNumber(delta)
                return `(${instanceIdStr}, ${deltaStr})`
            })
            .join(', ')
        
        // 使用原生 SQL 批量更新
        try {
            await prisma.$executeRawUnsafe(`
                UPDATE instances AS i
                SET monthly_traffic_used = i.monthly_traffic_used + v.delta::bigint
                FROM (VALUES ${valuesClause}) AS v(id, delta)
                WHERE i.id = v.id
            `)
        } catch (error) {
            console.error(`[Traffic] Failed to bulk increment instance traffic usage (batch ${i}-${i + batch.length}):`, error)
            throw error
        }
    }
}

/**
 * 增加用户流量用量
 */
export async function incrementUserTrafficUsage(userId: number, delta: bigint) {
    return prisma.userQuota.update({
        where: { userId },
        data: {
            monthlyTrafficUsed: { increment: delta }
        }
    })
}

/**
 * 批量增加用户流量用量
 * 使用 PostgreSQL 的 UPDATE ... FROM VALUES 进行高效的批量更新
 * 支持大规模用户（10000+），使用分片处理避免事务过大
 */
export async function bulkIncrementUserTrafficUsage(
    updates: Array<{ userId: number; delta: bigint }>
) {
    if (updates.length === 0) return

    // 按用户 ID 分组，累加同一个用户的增量
    const userDeltas = new Map<number, bigint>()
    for (const { userId, delta } of updates) {
        const current = userDeltas.get(userId) || 0n
        userDeltas.set(userId, current + delta)
    }

    // 转换为数组并按分片大小分批处理
    const deltasArray = Array.from(userDeltas.entries())
    
    // 分批处理，避免单次事务过大
    for (let i = 0; i < deltasArray.length; i += BATCH_SIZE) {
        const batch = deltasArray.slice(i, i + BATCH_SIZE)
        
        // 使用 PostgreSQL 的 UPDATE ... FROM VALUES 语法进行批量更新
        // 构建 VALUES 子句（验证并清理所有值）
        const valuesClause = batch
            .map(([userId, delta]) => {
                const userIdStr = sanitizeNumber(userId)
                const deltaStr = sanitizeNumber(delta)
                return `(${userIdStr}, ${deltaStr})`
            })
            .join(', ')
        
        // 使用原生 SQL 批量更新
        try {
            await prisma.$executeRawUnsafe(`
                UPDATE user_quotas AS uq
                SET monthly_traffic_used = uq.monthly_traffic_used + v.delta::bigint
                FROM (VALUES ${valuesClause}) AS v(user_id, delta)
                WHERE uq.user_id = v.user_id
            `)
        } catch (error) {
            console.error(`[Traffic] Failed to bulk increment user traffic usage (batch ${i}-${i + batch.length}):`, error)
            throw error
        }
    }
}

/**
 * 更新实例流量状态
 */
export async function updateInstanceTrafficStatus(instanceId: number, status: TrafficStatus) {
    return prisma.instance.update({
        where: { id: instanceId },
        data: { trafficStatus: status }
    })
}

/**
 * 更新用户流量状态
 */
export async function updateUserTrafficStatus(userId: number, status: TrafficStatus) {
    return prisma.userQuota.update({
        where: { userId },
        data: { trafficStatus: status }
    })
}

/**
 * 更新用户流量预警发送时间
 */
export async function updateUserTrafficWarningSentAt(userId: number, sentAt: Date) {
    return prisma.userQuota.update({
        where: { userId },
        data: { trafficWarningSentAt: sentAt }
    })
}

// ==================== 月度重置操作 ====================

/**
 * 重置所有用户的月度流量用量
 */
export async function resetAllUserMonthlyTraffic() {
    return prisma.userQuota.updateMany({
        data: {
            monthlyTrafficUsed: 0n,
            trafficStatus: 'NORMAL',
            trafficWarningSentAt: null
        }
    })
}

/**
 * 重置所有实例的月度流量用量
 */
export async function resetAllInstanceMonthlyTraffic() {
    return prisma.instance.updateMany({
        where: {
            status: { not: 'deleted' }
        },
        data: {
            monthlyTrafficUsed: 0n,
            trafficStatus: 'NORMAL'
        }
    })
}

/**
 * 重置单个实例的月度流量用量
 */
export async function resetInstanceMonthlyTraffic(instanceId: number) {
    return prisma.instance.update({
        where: { id: instanceId },
        data: {
            monthlyTrafficUsed: 0n,
            trafficStatus: 'NORMAL'
        }
    })
}

/**
 * 更新实例的带宽限制配置（用于流量限速/恢复时同步数据库）
 */
export async function updateInstanceBandwidthLimits(
    instanceId: number,
    limitsIngress: string | null,
    limitsEgress: string | null
) {
    return prisma.instance.update({
        where: { id: instanceId },
        data: {
            limitsIngress,
            limitsEgress
        }
    })
}

/**
 * 重置指定节点下所有实例的月度流量用量
 * @param hostIds 节点 ID 数组
 */
export async function resetHostInstancesMonthlyTraffic(hostIds: number[]) {
    return prisma.instance.updateMany({
        where: {
            hostId: { in: hostIds },
            status: { not: 'deleted' }
        },
        data: {
            monthlyTrafficUsed: 0n,
            trafficStatus: 'NORMAL'
        }
    })
}

// ==================== 查询操作 ====================

/**
 * 获取所有运行中的实例（用于流量采集）
 */
export async function getRunningInstancesForTraffic() {
    return prisma.instance.findMany({
        where: {
            status: 'running'
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
                    id: true,
                    quota: true
                }
            },
            package: {
                select: {
                    bandwidthMax: true,
                    limitsIngress: true,
                    limitsEgress: true
                }
            },
            packagePlan: {
                select: {
                    trafficLimitSpeed: true
                }
            },
            trafficSnapshot: true
        }
    })
}

/**
 * 获取指定实例中所有运行中的实例（用于即时流量状态重算）
 */
export async function getRunningInstancesForTrafficByIds(instanceIds: number[]) {
    if (instanceIds.length === 0) {
        return []
    }

    return prisma.instance.findMany({
        where: {
            id: { in: instanceIds },
            status: 'running'
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
                    id: true,
                    quota: true
                }
            },
            package: {
                select: {
                    bandwidthMax: true,
                    limitsIngress: true,
                    limitsEgress: true
                }
            },
            packagePlan: {
                select: {
                    trafficLimitSpeed: true
                }
            },
            trafficSnapshot: true
        }
    })
}

/**
 * 获取指定用户的所有运行中实例（用于用户级流量状态重算）
 */
export async function getRunningInstancesForTrafficByUserId(userId: number) {
    return prisma.instance.findMany({
        where: {
            userId,
            status: 'running'
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
                    id: true,
                    quota: true
                }
            },
            package: {
                select: {
                    bandwidthMax: true,
                    limitsIngress: true,
                    limitsEgress: true
                }
            },
            packagePlan: {
                select: {
                    trafficLimitSpeed: true
                }
            },
            trafficSnapshot: true
        }
    })
}

/**
 * 获取用户流量配额信息
 */
export async function getUserTrafficQuota(userId: number) {
    return prisma.userQuota.findUnique({
        where: { userId },
        select: {
            monthlyTrafficLimit: true,
            monthlyTrafficUsed: true,
            extraTrafficQuota: true,
            extraTrafficUsed: true,
            trafficStatus: true,
            trafficWarningSentAt: true
        }
    })
}

/**
 * 获取实例流量信息
 */
export async function getInstanceTrafficInfo(instanceId: number) {
    return prisma.instance.findUnique({
        where: { id: instanceId },
        select: {
            id: true,
            name: true,
            userId: true,
            hostId: true,
            monthlyTrafficLimit: true,
            monthlyTrafficUsed: true,
            trafficStatus: true
        }
    })
}

/**
 * 获取用户所有实例的 ID 列表
 */
export async function getUserInstanceIds(userId: number) {
    const instances = await prisma.instance.findMany({
        where: {
            userId,
            status: { not: 'deleted' }
        },
        select: { id: true }
    })
    return instances.map(i => i.id)
}

/**
 * 批量更新实例流量状态
 */
export async function batchUpdateInstanceTrafficStatus(instanceIds: number[], status: TrafficStatus) {
    return prisma.instance.updateMany({
        where: {
            id: { in: instanceIds }
        },
        data: { trafficStatus: status }
    })
}

/**
 * 更新用户流量限额
 */
export async function updateUserTrafficLimit(userId: number, limit: bigint | null) {
    return prisma.userQuota.update({
        where: { userId },
        data: { monthlyTrafficLimit: limit }
    })
}

/**
 * 更新实例流量限额
 */
export async function updateInstanceTrafficLimit(instanceId: number, limit: bigint | null) {
    return prisma.instance.update({
        where: { id: instanceId },
        data: { monthlyTrafficLimit: limit }
    })
}


/**
 * 同步套餐流量限额到所有实例
 * 将所有实例的流量限额更新为其所属套餐的流量限额
 */
export async function syncPackageTrafficLimitsToInstances(packageId?: number): Promise<{ count: number; instanceIds: number[] }> {
    const instances = await prisma.instance.findMany({
        where: {
            status: { not: 'deleted' },
            packageId: packageId ?? { not: null }
        },
        select: {
            id: true,
            hostId: true,
            packageId: true,
            monthlyTrafficUsed: true,
            package: {
                select: {
                    monthlyTrafficLimit: true
                }
            },
            packagePlan: {
                select: {
                    trafficLimit: true
                }
            }
        }
    })

    const packageIds = [...new Set(instances.map(instance => instance.packageId).filter((id): id is number => id !== null))]
    if (packageIds.length === 0) {
        return { count: 0, instanceIds: [] }
    }

    const bindings = await prisma.packageHost.findMany({
        where: {
            packageId: { in: packageIds }
        },
        select: {
            packageId: true,
            hostId: true,
            trafficMultiplier: true
        }
    })
    const multiplierByPackageHost = new Map(bindings.map(binding => [
        `${binding.packageId}:${binding.hostId}`,
        binding.trafficMultiplier
    ]))

    const updatedInstanceIds: number[] = []
    await Promise.all(instances.map(instance => {
        const baseTrafficLimit = instance.packagePlan?.trafficLimit ?? instance.package?.monthlyTrafficLimit ?? null
        const monthlyTrafficLimit = applyTrafficMultiplier(
            baseTrafficLimit,
            multiplierByPackageHost.get(`${instance.packageId}:${instance.hostId}`) ?? 1
        )
        updatedInstanceIds.push(instance.id)

        return prisma.instance.update({
            where: { id: instance.id },
            data: {
                monthlyTrafficLimit,
                trafficStatus: calculateInstanceTrafficStatus(instance.monthlyTrafficUsed, monthlyTrafficLimit)
            }
        })
    }))

    return { count: instances.length, instanceIds: updatedInstanceIds }
}
