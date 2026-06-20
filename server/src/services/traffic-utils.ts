/**
 * 流量统计工具函数
 * 包含增量计算、格式化等纯函数
 */

/**
 * 计算流量增量
 * 计数器归零或统计口径变化时只重建基线，不追补当前原始值。
 * 这样会少计一次采样窗口，但能避免把历史累计值误算进本期配额。
 */
export function calculateIncrement(current: bigint, last: bigint): bigint {
    if (current < last) {
        return 0n
    }
    return current - last
}

/**
 * 计算有效流量限额
 * 基础限额 + 额外配额
 */
export function getEffectiveLimit(limit: bigint | null, extraQuota: bigint): bigint | null {
    if (limit === null) return null
    return limit + extraQuota
}

/**
 * 检查是否超过限额
 */
export function isOverLimit(used: bigint, limit: bigint | null): boolean {
    if (limit === null) return false
    return used >= limit
}

/**
 * 检查是否达到预警阈值 (80%)
 */
export function isWarningThreshold(used: bigint, limit: bigint | null): boolean {
    if (limit === null) return false
    return used >= (limit * 80n) / 100n
}

/**
 * 检查预警是否在当月已发送
 */
export function isWarningSentThisMonth(sentAt: Date | null): boolean {
    if (!sentAt) return false
    const now = new Date()
    return sentAt.getMonth() === now.getMonth() && sentAt.getFullYear() === now.getFullYear()
}

/**
 * 计算用户当前应有的流量状态
 */
export function calculateUserTrafficStatus(used: bigint, limit: bigint | null): 'NORMAL' | 'WARNING' | 'LIMITED' {
    if (isOverLimit(used, limit)) {
        return 'LIMITED'
    }
    if (isWarningThreshold(used, limit)) {
        return 'WARNING'
    }
    return 'NORMAL'
}

/**
 * 计算实例当前应有的流量状态
 */
export function calculateInstanceTrafficStatus(used: bigint, limit: bigint | null): 'NORMAL' | 'LIMITED' {
    return isOverLimit(used, limit) ? 'LIMITED' : 'NORMAL'
}

/**
 * 格式化字节数为人类可读格式
 */
export function formatBytes(bytes: bigint): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = Number(bytes)
    let unitIndex = 0

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex++
    }

    return `${value.toFixed(2)} ${units[unitIndex]}`
}

/**
 * 解析字节字符串为 BigInt
 * 支持格式: "100GB", "1.5TB", "500MB" 等
 */
export function parseBytes(str: string): bigint {
    const match = str.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i)
    if (!match) {
        throw new Error(`Invalid byte string: ${str}`)
    }

    const value = parseFloat(match[1])
    const unit = match[2].toUpperCase()

    const multipliers: Record<string, bigint> = {
        'B': 1n,
        'KB': 1024n,
        'MB': 1024n * 1024n,
        'GB': 1024n * 1024n * 1024n,
        'TB': 1024n * 1024n * 1024n * 1024n
    }

    return BigInt(Math.floor(value * Number(multipliers[unit])))
}

/**
 * 计算百分比
 * 注意: 先转换为 Number 再计算,避免 BigInt 整数除法精度丢失
 * 例如: 160MB / 257GB 用 BigInt 整数除法会得到 0,而非 0.061%
 */
export function calculatePercentage(used: bigint, limit: bigint | null): number {
    if (limit === null || limit === 0n) return 0
    // 先转换为浮点数再计算百分比,避免整数除法导致的精度丢失
    const percentage = (Number(used) / Number(limit)) * 100
    return Math.min(100, percentage)
}

/**
 * 计算流量统计周期
 * 根据节点的重置日计算当前周期的起止日期
 * 
 * @param resetDay 重置日（1-28）
 * @param referenceDate 参考日期（默认当前时间）
 * @returns 周期起止日期
 */
export function getTrafficPeriod(resetDay: number, referenceDate: Date = new Date()): {
    periodStart: Date
    periodEnd: Date
} {
    // 限制 resetDay 在 1-28 范围内
    const day = Math.max(1, Math.min(28, resetDay))
    
    const year = referenceDate.getFullYear()
    const month = referenceDate.getMonth()
    const currentDay = referenceDate.getDate()
    
    let periodStart: Date
    let periodEnd: Date
    
    if (currentDay >= day) {
        // 当前日期 >= 重置日：周期为本月resetDay ~ 下月resetDay
        periodStart = new Date(year, month, day, 0, 0, 0, 0)
        periodEnd = new Date(year, month + 1, day, 0, 0, 0, 0)
    } else {
        // 当前日期 < 重置日：周期为上月resetDay ~ 本月resetDay
        periodStart = new Date(year, month - 1, day, 0, 0, 0, 0)
        periodEnd = new Date(year, month, day, 0, 0, 0, 0)
    }
    
    return { periodStart, periodEnd }
}

/**
 * 检查今天是否是指定的重置日
 */
export function isTodayResetDay(resetDay: number): boolean {
    const today = new Date().getDate()
    return today === resetDay
}

/**
 * 将 Date 对象格式化为本地日期字符串 (YYYY-MM-DD)
 * 避免 toISOString() 导致的 UTC 时区偏移问题
 */
export function formatLocalDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}
