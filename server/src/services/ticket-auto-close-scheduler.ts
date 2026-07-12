/**
 * 工单自动关闭调度器
 * 
 * 功能：自动关闭满足条件的已解决工单
 * 条件：
 * 1. 状态为 resolved（已解决）
 * 2. 最后一条公开消息超过配置的等待时间
 * 3. 最后一条消息来自宿主机主人（不需要管理员再回复）
 */

import { getTicketsForAutoClose, autoCloseTickets } from '../db/tickets.js'
import { sendNotification } from '../lib/notifier.js'
import { createLog } from '../db/logs.js'
import { getHostById, getSystemConfigBoolean, getSystemConfigNumber } from '../db/index.js'

// 配置常量
const TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY = 'ticket_auto_close_enabled'
const TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY = 'ticket_auto_close_hours'
const DEFAULT_TICKET_AUTO_CLOSE_HOURS = 24
const HOUR_MS = 60 * 60 * 1000
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 每小时检查一次

let schedulerInterval: ReturnType<typeof setInterval> | null = null

/**
 * 处理工单自动关闭
 */
async function processTicketAutoClose(): Promise<void> {
  try {
    const enabled = await getSystemConfigBoolean(TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY, true)
    if (!enabled) {
      return
    }

    const configuredHours = await getSystemConfigNumber(
      TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY,
      DEFAULT_TICKET_AUTO_CLOSE_HOURS
    )
    const autoCloseHours = configuredHours >= 1 ? configuredHours : DEFAULT_TICKET_AUTO_CLOSE_HOURS
    const autoCloseTimeoutMs = autoCloseHours * HOUR_MS

    // 获取需要自动关闭的工单
    const ticketsToClose = await getTicketsForAutoClose(autoCloseTimeoutMs)

    if (ticketsToClose.length === 0) {
      return
    }

    console.log(`[TicketAutoClose] 发现 ${ticketsToClose.length} 个需要自动关闭的工单`)

    // 批量关闭工单。只对本轮实际抢占并关闭成功的工单发送通知/写日志。
    const ticketIds = ticketsToClose.map(t => t.id)
    const closedTickets = await autoCloseTickets(ticketIds, autoCloseTimeoutMs)

    // 发送通知和记录日志
    for (const ticket of closedTickets) {
      try {
        // 获取宿主机信息（hostId 可能为 null，表示直接发给管理员的工单）
        const host = ticket.hostId ? await getHostById(ticket.hostId) : null

        // 通知工单创建者（用户）
        await sendNotification(ticket.userId, 'ticket_auto_closed', {
          subject: ticket.subject,
          hostName: host?.name || '系统'
        })

        // 记录日志
        await createLog(
          ticket.userId,
          'ticket',
          'ticket.auto_closed',
          `Ticket #${ticket.id} "${ticket.subject}" auto-closed after ${autoCloseHours} hours`,
          'success'
        )
      } catch (notifyErr) {
        console.error(`[TicketAutoClose] 通知/日志失败 (工单 #${ticket.id}):`, notifyErr)
      }
    }

    console.log(`[TicketAutoClose] 成功自动关闭 ${closedTickets.length} 个工单`)
  } catch (err) {
    console.error('[TicketAutoClose] 处理失败:', err)
  }
}

/**
 * 启动工单自动关闭调度器
 */
export function startTicketAutoCloseScheduler(): void {
  if (schedulerInterval) {
    console.warn('[TicketAutoClose] 调度器已在运行')
    return
  }

  // 启动时执行一次
  processTicketAutoClose()

  // 定期执行
  schedulerInterval = setInterval(processTicketAutoClose, CHECK_INTERVAL_MS)

  console.log('🎫 工单自动关闭调度器已启动（超时可配置，每小时检查）')
}

/**
 * 停止工单自动关闭调度器
 */
export function stopTicketAutoCloseScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    console.log('[TicketAutoClose] 调度器已停止')
  }
}
