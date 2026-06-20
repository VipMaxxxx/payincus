/**
 * 工单自动关闭调度器
 * 
 * 功能：自动关闭满足条件的已解决工单
 * 条件：
 * 1. 状态为 resolved（已解决）
 * 2. 超过24小时未更新
 * 3. 最后一条消息来自宿主机主人（不需要管理员再回复）
 */

import { getTicketsForAutoClose, autoCloseTickets } from '../db/tickets.js'
import { sendNotification } from '../lib/notifier.js'
import { createLog } from '../db/logs.js'
import { getHostById } from '../db/index.js'

// 配置常量
const AUTO_CLOSE_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24小时
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 每小时检查一次

let schedulerInterval: ReturnType<typeof setInterval> | null = null

/**
 * 处理工单自动关闭
 */
async function processTicketAutoClose(): Promise<void> {
  try {
    // 获取需要自动关闭的工单
    const ticketsToClose = await getTicketsForAutoClose(AUTO_CLOSE_TIMEOUT_MS)

    if (ticketsToClose.length === 0) {
      return
    }

    console.log(`[TicketAutoClose] 发现 ${ticketsToClose.length} 个需要自动关闭的工单`)

    // 批量关闭工单
    const ticketIds = ticketsToClose.map(t => t.id)
    const closedCount = await autoCloseTickets(ticketIds)

    // 发送通知和记录日志
    for (const ticket of ticketsToClose) {
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
          `Ticket #${ticket.id} "${ticket.subject}" auto-closed after 24 hours`,
          'success'
        )
      } catch (notifyErr) {
        console.error(`[TicketAutoClose] 通知/日志失败 (工单 #${ticket.id}):`, notifyErr)
      }
    }

    console.log(`[TicketAutoClose] 成功自动关闭 ${closedCount} 个工单`)
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

  console.log('🎫 工单自动关闭调度器已启动（24小时超时，每小时检查）')
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
