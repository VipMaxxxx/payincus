/**
 * 流量通知服务
 * 负责发送流量预警和限速通知
 * 包含自动重试机制
 */

import * as db from '../db/index.js'
import { formatBytes } from './traffic-utils.js'
import { assertSafeWebhookUrl } from '../lib/outbound-security.js'

// 重新导出 formatBytes 供其他模块使用
export { formatBytes }

// 重试配置
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000

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

/**
 * 发送流量预警通知 (80%)
 */
export async function sendTrafficWarningNotification(
    userId: number,
    used: bigint,
    limit: bigint
): Promise<void> {
    try {
        const channels = await db.getEnabledChannelsByUserId(userId)
        if (channels.length === 0) return

        // 先转换为浮点数再计算百分比,避免 BigInt 整数除法精度丢失
        const percentage = ((Number(used) / Number(limit)) * 100).toFixed(1)
        const title = '⚠️ 流量预警'
        const message = `您的月度流量已使用 ${percentage}%\n` +
            `已用: ${formatBytes(used)}\n` +
            `限额: ${formatBytes(limit)}\n\n` +
            `超出限额后，您的实例将被限速至 1Mbit。`

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
            } catch (err) {
                console.error(`[TrafficNotifier] Failed to send warning to channel ${channel.id}:`, err)
            }
        }
    } catch (err) {
        console.error('[TrafficNotifier] sendTrafficWarningNotification error:', err)
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

        const title = '🚫 流量限速通知'
        const message = `您的实例 ${instanceName}（节点：${hostName}）已因流量超额被限速至 1Mbit。\n\n` +
            `您仍可通过 SSH 管理实例。\n` +
            `流量将在下月 1 日自动重置，届时带宽将恢复正常。`

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
        const response = await fetch(parsedUrl.toString(), {
            method: 'POST',
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
        })

        if (!response.ok) {
            const text = await response.text()
            return { success: false, error: text || `HTTP ${response.status}` }
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
