/**
 * AI 工单自动接管调度器
 *
 * 只在 AI 工单插件启用 auto 模式时处理官方/系统工单。
 * 发送前仍复用插件权限、脱敏上下文、敏感转人工、限流和输出安全检查。
 */

import { schedule } from 'node-cron'
import { prisma } from '../db/prisma.js'
import * as ticketDb from '../db/tickets.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { sendNotification } from '../lib/notifier.js'
import {
  AI_TICKET_REPLY_PERMISSION,
  auditAiTicketReply,
  generateAiTicketReply,
  getAiTicketAutomationStatus,
  getAiTicketPermission
} from './ai-ticket-context.js'

const AUTO_REPLY_SCAN_BATCH_SIZE = 5
const AUTO_REPLY_CANDIDATE_LOOKAHEAD = 30

let schedulerStarted = false
let running = false
const processingTicketIds = new Set<number>()

async function getAiReplyActor(): Promise<{ id: number; username: string } | null> {
  return prisma.user.findFirst({
    where: {
      role: 'admin',
      status: 'active'
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      username: true
    }
  })
}

async function loadAutoReplyCandidates(allowedCategories: string[]): Promise<Array<{ id: number }>> {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: ['open', 'in_progress'] },
      category: { in: allowedCategories },
      priority: { not: 'urgent' },
      OR: [
        { hostId: null },
        { host: { user: { role: 'admin' } } }
      ]
    },
    orderBy: [
      { updatedAt: 'asc' },
      { id: 'asc' }
    ],
    take: AUTO_REPLY_CANDIDATE_LOOKAHEAD,
    select: {
      id: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { isFromOwner: true }
      }
    }
  })

  return tickets
    .filter(ticket => ticket.messages[0]?.isFromOwner === false)
    .slice(0, AUTO_REPLY_SCAN_BATCH_SIZE)
    .map(ticket => ({ id: ticket.id }))
}

async function loadTicketForAutoReply(ticketId: number) {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      userId: true,
      hostId: true,
      subject: true,
      status: true,
      host: {
        select: {
          user: { select: { role: true } },
          name: true
        }
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { isFromOwner: true }
      }
    }
  })
}

async function isStillAutoReplyEligible(ticketId: number): Promise<boolean> {
  const ticket = await loadTicketForAutoReply(ticketId)
  if (!ticket) return false
  if (ticket.status !== 'open' && ticket.status !== 'in_progress') return false
  if (ticket.hostId && ticket.host?.user.role !== 'admin') return false
  return ticket.messages[0]?.isFromOwner === false
}

async function processAutoReplyTicket(ticketId: number, actor: { id: number; username: string }): Promise<'sent' | 'skipped' | 'blocked' | 'failed'> {
  if (processingTicketIds.has(ticketId)) return 'skipped'
  processingTicketIds.add(ticketId)

  try {
    if (!await isStillAutoReplyEligible(ticketId)) {
      return 'skipped'
    }

    const result = await generateAiTicketReply(ticketId)
    if (result.mode !== 'auto' || !result.canSend) {
      await auditAiTicketReply({
        actorUserId: actor.id,
        ticketId,
        result: 'blocked',
        reason: result.sendBlockedReasons.length > 0 ? result.sendBlockedReasons.join(',') : 'AI_TICKET_AUTO_REPLY_BLOCKED'
      })
      return 'blocked'
    }
    if (!result.safety.passed) {
      await auditAiTicketReply({
        actorUserId: actor.id,
        ticketId,
        result: 'blocked',
        reason: result.safety.blockedReasons.join(',')
      })
      return 'blocked'
    }

    const ticket = await loadTicketForAutoReply(ticketId)
    if (!ticket || !await isStillAutoReplyEligible(ticketId)) {
      return 'skipped'
    }

    await ticketDb.addTicketMessage(ticketId, actor.id, result.draft, true, [])

    try {
      await sendNotification(ticket.userId, 'ticket_replied', {
        subject: ticket.subject,
        hostName: ticket.host?.name || '系统',
        replyFrom: actor.username
      })
    } catch (err) {
      console.error(`[AiTicketAutoReply] 通知失败 (工单 #${ticketId}):`, err)
    }

    await auditAiTicketReply({
      actorUserId: actor.id,
      ticketId,
      result: 'success'
    })

    return 'sent'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await auditAiTicketReply({
      actorUserId: actor.id,
      ticketId,
      result: 'failed',
      reason: message.startsWith('AI_TICKET_') ? message : 'AI_TICKET_AUTO_REPLY_FAILED'
    })
    return 'failed'
  } finally {
    processingTicketIds.delete(ticketId)
  }
}

export async function runAiTicketAutoReplyJob(): Promise<{ scanned: number; sent: number; blocked: number; skipped: number; failed: number }> {
  const summary = { scanned: 0, sent: 0, blocked: 0, skipped: 0, failed: 0 }

  if (running) {
    summary.skipped = 1
    return summary
  }

  running = true
  try {
    const permission = await getAiTicketPermission(AI_TICKET_REPLY_PERMISSION)
    if (!permission.allowed) return summary

    const status = await getAiTicketAutomationStatus()
    if (!status.enabled || status.mode !== 'auto') return summary

    const actor = await getAiReplyActor()
    if (!actor) {
      await createLog(
        null,
        LogModule.PLUGIN,
        'ai_ticket.auto_reply',
        'AI ticket auto reply skipped: no active admin actor',
        LogResult.WARNING
      )
      return summary
    }

    const candidates = await loadAutoReplyCandidates(status.autoReplyCategories)
    summary.scanned = candidates.length

    for (const candidate of candidates) {
      const result = await processAutoReplyTicket(candidate.id, actor)
      summary[result] += 1
    }

    if (summary.sent > 0 || summary.blocked > 0 || summary.failed > 0) {
      await createLog(
        actor.id,
        LogModule.PLUGIN,
        'ai_ticket.auto_reply',
        `AI ticket auto reply scanned=${summary.scanned} sent=${summary.sent} blocked=${summary.blocked} skipped=${summary.skipped} failed=${summary.failed}`,
        summary.failed > 0 ? LogResult.WARNING : LogResult.SUCCESS
      )
    }

    return summary
  } catch (error) {
    console.error('[AiTicketAutoReply] 自动接管任务失败:', error)
    summary.failed += 1
    return summary
  } finally {
    running = false
  }
}

export function startAiTicketAutoReplyScheduler(): void {
  if (schedulerStarted) {
    return
  }

  schedulerStarted = true

  schedule('*/2 * * * *', () => {
    runAiTicketAutoReplyJob().catch(error => {
      console.error('[AiTicketAutoReply] 调度执行失败:', error)
    })
  }, {
    timezone: 'Asia/Shanghai'
  })

  console.log('[AiTicketAutoReply] Scheduler started')
  console.log('[AiTicketAutoReply] - Auto reply scan: every 2 minutes')
}
