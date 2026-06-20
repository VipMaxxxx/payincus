/**
 * 通用格式化工具函数
 */

/**
 * 格式化内存大小 (MB -> 可读格式，1024进制)
 */
export function formatMemory(mb: number | null | undefined): string {
    if (!mb) return '0'
    if (mb >= 1024) {
        const gb = mb / 1024
        return gb % 1 === 0 ? gb.toFixed(0) + ' GB' : gb.toFixed(1) + ' GB'
    }
    return mb + ' MB'
}

/**
 * 格式化硬盘大小 (MB -> 可读格式，1024进制)
 */
export function formatDisk(mb: number | null | undefined): string {
    if (!mb) return '0'
    if (mb >= 1024) {
        const gb = mb / 1024
        return gb % 1 === 0 ? gb.toFixed(0) + ' GB' : gb.toFixed(1) + ' GB'
    }
    return mb + ' MB'
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i]
}

/**
 * 格式化日期
 */
export function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('zh-CN')
}

/**
 * 格式化日期（简短格式）
 */
export function formatDateShort(dateStr: string | null | undefined): string {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    })
}

/**
 * 计算百分比
 */
export function getPercent(used: number | null | undefined, limit: number | null | undefined): number {
    if (!limit || !used) return 0
    return Math.min(100, Math.round((used / limit) * 100))
}

/**
 * 根据百分比获取进度条颜色
 */
export function getProgressColor(percent: number): string {
    if (percent >= 90) return 'bg-red-500'
    if (percent >= 70) return 'bg-yellow-500'
    return 'bg-green-500'
}

export interface StatusInfo {
    label: string
    class: string
    dot: string
}

type TranslateFunction = (key: string) => string

/**
 * 获取实例状态信息
 * @param status 状态字符串
 * @param t 翻译函数（可选，不传则返回状态键名）
 */
export function getStatusInfo(status: string, t?: TranslateFunction): StatusInfo {
    const normalizedStatus = status?.toLowerCase() || 'stopped'
    
    const statusMap: Record<string, { labelKey: string; class: string; dot: string }> = {
        running: { labelKey: 'instance.status.running', class: 'badge-success', dot: 'bg-green-500' },
        stopped: { labelKey: 'instance.status.stopped', class: 'badge-default', dot: 'bg-gray-500' },
        suspended: { labelKey: 'instance.status.suspended', class: 'badge-error', dot: 'bg-red-500' },
        starting: { labelKey: 'instance.status.starting', class: 'badge-warning', dot: 'bg-yellow-500 animate-pulse' },
        stopping: { labelKey: 'instance.status.stopping', class: 'badge-warning', dot: 'bg-yellow-500 animate-pulse' },
        restarting: { labelKey: 'instance.status.restarting', class: 'badge-warning', dot: 'bg-yellow-500 animate-pulse' },
        creating: { labelKey: 'instance.status.creating', class: 'badge-warning', dot: 'bg-yellow-500 animate-pulse' },
        error: { labelKey: 'instance.status.error', class: 'badge-error', dot: 'bg-red-500' }
    }
    
    const info = statusMap[normalizedStatus] || statusMap.stopped
    return {
        label: t ? t(info.labelKey) : info.labelKey,
        class: info.class,
        dot: info.dot
    }
}

/**
 * 获取时间问候语
 */
export function getTimeGreeting(): string {
    const hour = new Date().getHours()
    if (hour < 6) return '夜深了'
    if (hour < 12) return '早上好'
    if (hour < 18) return '下午好'
    return '晚上好'
}

/**
 * 格式化时长（秒 -> 可读格式）
 */
export function formatDuration(seconds: number | null | undefined): string {
    if (!seconds && seconds !== 0) return '-'
    if (seconds < 60) return `${seconds}秒`
    if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60)
        const secs = seconds % 60
        return secs > 0 ? `${minutes}分${secs}秒` : `${minutes}分钟`
    }
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (minutes === 0 && secs === 0) return `${hours}小时`
    if (secs === 0) return `${hours}小时${minutes}分钟`
    return `${hours}小时${minutes}分${secs}秒`
}

/**
 * 格式化相对时间（用于站内信等场景）
 * @param dateStr ISO 时间字符串
 * @param t 翻译函数，接受 key 和参数
 * @returns 格式化后的相对时间字符串
 */
export function formatRelativeTime(
    dateStr: string,
    t: (key: string, params?: Record<string, unknown>) => string
): string {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return t('inbox.justNow')
    if (diffMins < 60) return t('inbox.minutesAgo', { n: diffMins })
    if (diffHours < 24) return t('inbox.hoursAgo', { n: diffHours })
    if (diffDays < 7) return t('inbox.daysAgo', { n: diffDays })

    return date.toLocaleDateString()
}