/**
 * 抽奖中奖通知模块
 * 向管理员配置的通知渠道发送中奖通知
 */
import * as db from '../db/index.js'
import { assertSafeWebhookUrl } from './outbound-security.js'

// ==================== 通知内容模板 ====================

const LOTTERY_ADMIN_NOTIFICATIONS = {
  balance_win: {
    title: '💰 余额中奖通知',
    message: (data: {
      username: string
      lotteryName: string
      prizeName: string
      amount: number // 分
    }) => `用户 ${data.username} 在「${data.lotteryName}」抽中了「${data.prizeName}」\n` +
      `奖励金额：¥${(data.amount / 100).toFixed(2)}\n` +
      `已自动发放到用户余额`
  },

  instance_win: {
    title: '🎁 实例中奖通知',
    message: (data: {
      username: string
      lotteryName: string
      prizeName: string
      instanceDesc?: string
    }) => `用户 ${data.username} 在「${data.lotteryName}」抽中了「${data.prizeName}」\n` +
      (data.instanceDesc ? `奖励内容：${data.instanceDesc}\n` : '') +
      `请等待用户提交工单后手动发放`
  }
}

// ==================== 通知发送函数 ====================

interface LotteryWinNotification {
  lotteryId: number
  recordId: number
  prizeType: 'balance' | 'instance'
  username: string
  lotteryName: string
  prizeName: string
  amount?: number       // 余额奖励金额（分）
  instanceDesc?: string // 实例描述
}

/**
 * 发送抽奖中奖通知到管理员配置的渠道
 */
export async function sendLotteryWinNotification(data: LotteryWinNotification): Promise<void> {
  try {
    // 1. 获取该抽奖的通知配置
    const notifyConfig = await db.getLotteryNotificationConfig(data.lotteryId)

    if (!notifyConfig || !notifyConfig.enabled) {
      console.log(`[LotteryNotifier] Lottery ${data.lotteryId} notification disabled or not configured`)
      return
    }

    // 2. 检查是否需要通知该类型
    if (data.prizeType === 'balance' && !notifyConfig.notifyBalance) {
      console.log(`[LotteryNotifier] Balance notification disabled for lottery ${data.lotteryId}`)
      return
    }
    if (data.prizeType === 'instance' && !notifyConfig.notifyInstance) {
      console.log(`[LotteryNotifier] Instance notification disabled for lottery ${data.lotteryId}`)
      return
    }

    // 3. 构建通知内容
    let title: string
    let message: string

    if (data.prizeType === 'balance') {
      title = LOTTERY_ADMIN_NOTIFICATIONS.balance_win.title
      message = LOTTERY_ADMIN_NOTIFICATIONS.balance_win.message({
        username: data.username,
        lotteryName: data.lotteryName,
        prizeName: data.prizeName,
        amount: data.amount || 0
      })
    } else {
      title = LOTTERY_ADMIN_NOTIFICATIONS.instance_win.title
      message = LOTTERY_ADMIN_NOTIFICATIONS.instance_win.message({
        username: data.username,
        lotteryName: data.lotteryName,
        prizeName: data.prizeName,
        instanceDesc: data.instanceDesc
      })
    }

    // 4. 根据配置的渠道发送
    const config = notifyConfig.config as Record<string, string>

    switch (notifyConfig.type) {
      case 'telegram':
        await sendTelegram(config.botToken, config.chatId, title, message)
        break
      case 'discord':
        await sendDiscord(config.webhookUrl, title, message)
        break
      case 'webhook':
        await sendWebhook(config.url, config.secret, {
          event: `lottery_win_${data.prizeType}`,
          title,
          message,
          data
        })
        break
      default:
        console.warn(`[LotteryNotifier] Unknown channel type: ${notifyConfig.type}`)
    }

    // 5. 标记通知已发送
    await db.markRecordNotificationSent(data.recordId)

    console.log(`[LotteryNotifier] Sent ${data.prizeType} win notification for lottery ${data.lotteryId}, user ${data.username}`)
  } catch (err) {
    console.error(`[LotteryNotifier] Failed to send notification:`, err)
  }
}

// ==================== 通知渠道发送函数 ====================

/**
 * 转义 Markdown 特殊字符
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
}

/**
 * 发送 Telegram 通知
 */
async function sendTelegram(
  botToken: string,
  chatId: string,
  title: string,
  message: string
): Promise<void> {
  if (!botToken || !chatId) {
    throw new Error('Missing botToken or chatId')
  }

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
    throw new Error(result.description || 'Unknown Telegram error')
  }
}

/**
 * 发送 Discord 通知
 */
async function sendDiscord(
  webhookUrl: string,
  title: string,
  message: string
): Promise<void> {
  if (!webhookUrl) {
    throw new Error('Missing webhookUrl')
  }

  // 根据标题选择颜色
  let color = 0x00ff00 // 默认绿色
  if (title.includes('余额')) {
    color = 0xffd700 // 金色
  } else if (title.includes('实例')) {
    color = 0x9b59b6 // 紫色
  }

  const parsedUrl = await assertSafeWebhookUrl(webhookUrl)
  const response = await fetch(parsedUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title,
        description: message,
        color,
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Incudal 抽奖系统'
        }
      }]
    }),
    redirect: 'manual'
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `HTTP ${response.status}`)
  }
}

/**
 * 发送 Webhook 通知
 */
async function sendWebhook(
  url: string,
  secret: string | undefined,
  payload: Record<string, unknown>
): Promise<void> {
  if (!url) {
    throw new Error('Missing webhook URL')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  // 如果有 secret，添加签名
  if (secret) {
    const crypto = await import('crypto')
    const signature = crypto.createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex')
    headers['X-Signature'] = signature
  }

  const parsedUrl = await assertSafeWebhookUrl(url)
  const response = await fetch(parsedUrl.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString()
    }),
    redirect: 'manual'
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
}
