/**
 * 流量通知服务
 * 负责发送流量预警和限速通知
 * 包含自动重试机制
 */

import * as db from '../db/index.js'
import { formatBytes } from './traffic-utils.js'
import {
    DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED,
    TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY,
    normalizePlanTrafficLimitSpeed
} from './traffic-bandwidth.js'
import { assertSafeWebhookUrl, safeFetch } from '../lib/outbound-security.js'
import { sanitizeTokensInString } from '../lib/log-sanitizer.js'

// 重新导出 formatBytes 供其他模块使用
export { formatBytes }

// 重试配置
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
const TRAFFIC_NOTIFICATION_FETCH_TIMEOUT_MS = 15_000
const TRAFFIC_NOTIFICATION_ERROR_PREVIEW_MAX_CHARS = 2_000

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 判断是否为不可重试的错误
 */
function isNonRetryableError(error: string | null): boolean {
    if (!error) return false

    const nonRetryablePatterns = [
        'Missing botToken',
        'Missing chatId',
        'Missing webhookUrl',
        'chat not found',
        'bot was blocked',
        'CHAT_ID_INVALID',
        'BOT_TOKEN_INVALID',
        '401',
        '403',
        '404',
    ]

    return nonRetryablePatterns.some(pattern =>
        error.toLowerCase().includes(pattern.toLowerCase())
    )
}

async function readSafeNotificationError(response: Response): Promise<string> {
    const text = await response.text()
    const sanitized = sanitizeTokensInString(text)
    const preview = sanitized.slice(0, TRAFFIC_NOTIFICATION_ERROR_PREVIEW_MAX_CHARS)
    return preview || `HTTP ${response.status}`
}

/**
 * 带重试的发送函数
 */
async function sendWithRetry(
    sendFn: () => Promise<{ success: boolean; error: string | null }>,
    channelType: string
): Promise<{ success: boolean; error: string | null }> {
    let lastError: string | null = null

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await sendFn()

            if (result.success) {
                return result
            }

            if (isNonRetryableError(result.error)) {
                return result
            }

            lastError = result.error
            console.warn(`[TrafficNotifier] ${channelType} attempt ${attempt}/${MAX_RETRIES} failed: ${result.error}`)

            if (attempt < MAX_RETRIES) {
                await delay(RETRY_DELAY_MS * attempt)
            }
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err)
            console.warn(`[TrafficNotifier] ${channelType} attempt ${attempt}/${MAX_RETRIES} error: ${lastError}`)

            if (attempt < MAX_RETRIES) {
                await delay(RETRY_DELAY_MS * attempt)
            }
        }
    }

    return { success: false, error: `Failed after ${MAX_RETRIES} attempts: ${lastError}` }
}

interface TrafficNotificationContext {
    throttleSpeed: string
    normalLineSpeed: string
    resetDay: string
}

async function resolveTrafficNotificationContext(
    userId: number,
    instanceName?: string,
    hostName?: string
): Promise<TrafficNotificationContext> {
    const instances = await db.prisma.instance.findMany({
        where: {
            userId,
            status: { not: 'deleted' },
            ...(instanceName ? { name: instanceName } : {}),
            ...(hostName ? { host: { name: hostName } } : {})
        },
        select: {
            package: {
                select: { limitsIngress: true, limitsEgress: true }
            },
            packagePlan: {
                select: { trafficLimitSpeed: true }
            },
            host: {
                select: { trafficResetDay: true }
            }
        },
        orderBy: { id: 'asc' }
    })

    if (instances.length === 0) {
        throw new Error(`No active traffic notification context for user ${userId}`)
    }

    const configuredThrottleSpeed = normalizePlanTrafficLimitSpeed(
        await db.getSystemConfig(TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY)
    ) ?? DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED
    const normalLineSpeeds = new Set<string>()
    const resetDays = new Set<number>()

    for (const instance of instances) {
        const planSpeed = normalizePlanTrafficLimitSpeed(instance.packagePlan?.trafficLimitSpeed)
        const normalLineSpeed = planSpeed ?? instance.package?.limitsIngress ?? instance.package?.limitsEgress
        normalLineSpeeds.add(normalLineSpeed || '不限速')
        resetDays.add(Math.max(1, Math.min(28, instance.host.trafficResetDay)))
    }

    return {
        throttleSpeed: configuredThrottleSpeed,
        normalLineSpeed: Array.from(normalLineSpeeds).join(' / '),
        resetDay: Array.from(resetDays).sort((a, b) => a - b).join('、')
    }
}

/**
 * 发送流量预警通知 (80%)
 */
export async function sendTrafficWarningNotification(
    userId: number,
    used: bigint,
    limit: bigint,
    instanceName?: string
): Promise<boolean> {
    try {
        const channels = await db.getEnabledChannelsByUserId(userId)
        if (channels.length === 0) return true
        let allChannelsSent = true

        // 先转换为浮点数再计算百分比,避免 BigInt 整数除法精度丢失
        const percentage = ((Number(used) / Number(limit)) * 100).toFixed(1)
        const context = await resolveTrafficNotificationContext(userId, instanceName)
        const title = '⚠️ 流量预警'
        const scope = instanceName ? `您的实例 ${instanceName} 月度流量` : '您的月度流量'
        const message = `${scope}已使用 ${percentage}%\n` +
            `已用: ${formatBytes(used)}\n` +
            `限额: ${formatBytes(limit)}\n\n` +
            `超出限额后，您的实例将被限速至 ${context.throttleSpeed}。\n` +
            `流量于每月 ${context.resetDay} 日重置后，带宽将恢复至 ${context.normalLineSpeed}。`

        for (const channel of channels) {
            try {
                const config = typeof channel.config === 'string'
                    ? JSON.parse(channel.config)
                    : channel.config

                const logId = await db.createNotificationLog({
                    channelId: channel.id,
                    eventType: 'traffic_warning',
                    message,
                    status: 'pending'
                })

                let result: { success: boolean; error: string | null }

                switch (channel.type) {
                    case 'telegram':
                        result = await sendWithRetry(
                            () => sendTelegram(config, title, message),
                            'Telegram'
                        )
                        break
                    case 'discord':
                        result = await sendWithRetry(
                            () => sendDiscord(config, title, message),
                            'Discord'
                        )
                        break
                    default:
                        result = { success: false, error: `Unsupported channel type: ${channel.type}` }
                }

                await db.updateNotificationLogStatus(logId, result.success ? 'sent' : 'failed', result.error)
                if (!result.success) allChannelsSent = false
            } catch (err) {
                allChannelsSent = false
                console.error(`[TrafficNotifier] Failed to send warning to channel ${channel.id}:`, err)
            }
        }

        return allChannelsSent
    } catch (err) {
        console.error('[TrafficNotifier] sendTrafficWarningNotification error:', err)
        return false
    }
}

/**
 * 发送流量限速通知
 */
export async function sendTrafficThrottledNotification(
    userId: number,
    instanceName: string,
    hostName: string
): Promise<void> {
    try {
        const channels = await db.getEnabledChannelsByUserId(userId)
        if (channels.length === 0) return

        const context = await resolveTrafficNotificationContext(userId, instanceName, hostName)
        const title = '🚫 流量限速通知'
        const message = `您的实例 ${instanceName}（节点：${hostName}）已因流量超额被限速至 ${context.throttleSpeed}。\n\n` +
            `您仍可通过 SSH 管理实例。\n` +
            `流量将于每月 ${context.resetDay} 日自动重置，届时带宽将恢复至 ${context.normalLineSpeed}。`

        for (const channel of channels) {
            try {
                const config = typeof channel.config === 'string'
                    ? JSON.parse(channel.config)
                    : channel.config

                const logId = await db.createNotificationLog({
                    channelId: channel.id,
                    eventType: 'traffic_throttled',
                    message,
                    status: 'pending'
                })

                let result: { success: boolean; error: string | null }

                switch (channel.type) {
                    case 'telegram':
                        result = await sendWithRetry(
                            () => sendTelegram(config, title, message),
                            'Telegram'
                        )
                        break
                    case 'discord':
                        result = await sendWithRetry(
                            () => sendDiscord(config, title, message),
                            'Discord'
                        )
                        break
                    default:
                        result = { success: false, error: `Unsupported channel type: ${channel.type}` }
                }

                await db.updateNotificationLogStatus(logId, result.success ? 'sent' : 'failed', result.error)
            } catch (err) {
                console.error(`[TrafficNotifier] Failed to send throttle notification to channel ${channel.id}:`, err)
            }
        }
    } catch (err) {
        console.error('[TrafficNotifier] sendTrafficThrottledNotification error:', err)
    }
}

/**
 * 发送 Telegram 通知
 */
async function sendTelegram(
    config: { botToken: string; chatId: string },
    title: string,
    message: string
): Promise<{ success: boolean; error: string | null }> {
    const { botToken, chatId } = config

    if (!botToken || !chatId) {
        return { success: false, error: 'Missing botToken or chatId' }
    }

    try {
        const text = `*${escapeMarkdown(title)}*\n\n${escapeMarkdown(message)}`

        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            redirect: 'manual',
            signal: AbortSignal.timeout(TRAFFIC_NOTIFICATION_FETCH_TIMEOUT_MS),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'MarkdownV2'
            })
        })

        const result = await response.json() as { ok: boolean; description?: string }

        if (!result.ok) {
            return { success: false, error: result.description || 'Unknown error' }
        }

        return { success: true, error: null }
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        return { success: false, error }
    }
}

/**
 * 发送 Discord 通知
 */
async function sendDiscord(
    config: { webhookUrl: string },
    title: string,
    message: string
): Promise<{ success: boolean; error: string | null }> {
    const { webhookUrl } = config

    if (!webhookUrl) {
        return { success: false, error: 'Missing webhookUrl' }
    }

    try {
        const parsedUrl = await assertSafeWebhookUrl(webhookUrl)
        const response = await safeFetch(parsedUrl.toString(), {
            method: 'POST',
            signal: AbortSignal.timeout(TRAFFIC_NOTIFICATION_FETCH_TIMEOUT_MS),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title,
                    description: message,
                    color: title.includes('预警') ? 0xffa500 : 0xff0000,
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: 'Incudal'
                    }
                }]
            }),
            redirect: 'manual'
        }, 'Webhook URL')

        if (!response.ok) {
            return { success: false, error: await readSafeNotificationError(response) }
        }

        return { success: true, error: null }
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        return { success: false, error }
    }
}

/**
 * 转义 Telegram MarkdownV2 特殊字符
 */
function escapeMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1')
}
