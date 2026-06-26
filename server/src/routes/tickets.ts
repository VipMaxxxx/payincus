/**
 * 工单系统 API 路由
 * 
 * 安全措施：
 * - 身份认证：所有接口需要登录
 * - 权限校验：用户只能访问自己的工单或自己宿主机收到的工单
 * - 输入验证：验证所有用户输入
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as ticketDb from '../db/tickets.js'
import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { getAllAdminUserIds } from '../db/users.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { sendNotification } from '../lib/notifier.js'
import { assertSafeHttpUrl } from '../lib/outbound-security.js'
import { emitPluginEvent } from '../lib/plugin-event-emitter.js'
import {
  cleanupUploadedTicketImages,
  isHandledTicketPayloadError,
  normalizeAllowedImageMimeType,
  readTicketPayload,
  TICKET_UPLOAD_BODY_LIMIT,
  uploadTicketImages,
  MAX_TICKET_IMAGE_SIZE
} from '../lib/ticket-attachments.js'
import {
  AI_TICKET_CONTEXT_PERMISSION,
  AI_TICKET_DRAFT_PERMISSION,
  AI_TICKET_REPLY_PERMISSION,
  auditAiTicketContextRead,
  auditAiTicketDraft,
  auditAiTicketReply,
  buildAiTicketContext,
  generateAiTicketDraft,
  generateAiTicketReply,
  getAiTicketAutomationStatus,
  getAiTicketPermission,
  getAiTicketContextPermission
} from '../services/ai-ticket-context.js'

// 工单状态类型
type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

// 工单优先级类型
type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

async function getTicketHostOwnership(hostId: number | null | undefined) {
  if (!hostId) return null

  return prisma.host.findUnique({
    where: { id: hostId },
    select: {
      id: true,
      name: true,
      userId: true,
      user: {
        select: {
          role: true
        }
      }
    }
  })
}

// 工单分类
const VALID_CATEGORIES = ['general', 'billing', 'technical', 'abuse']

// 工单优先级
const VALID_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent']

// 工单状态
const VALID_STATUSES: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed']

// 扩展的状态类型（包含 active）
type ExtendedTicketStatus = TicketStatus | 'active'

const TICKET_PROXY_FETCH_TIMEOUT_MS = 15_000
const POSITIVE_INTEGER_ID_RE = /^[1-9]\d*$/

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }

  if (typeof value !== 'string' || !POSITIVE_INTEGER_ID_RE.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseOptionalPositiveId(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return parsePositiveId(value)
}

function parsePositiveInteger(value: unknown, fallback: number, max?: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }

  return max === undefined ? parsed : Math.min(parsed, max)
}

function sanitizeContent(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTicketStatusBody(body: unknown): TicketStatus | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }

  const { status } = body as { status?: unknown }
  return typeof status === 'string' && VALID_STATUSES.includes(status as TicketStatus)
    ? status as TicketStatus
    : null
}

async function readRemoteImageBody(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length') || '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_TICKET_IMAGE_SIZE) {
    throw new Error('Remote image is too large')
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_TICKET_IMAGE_SIZE) {
      throw new Error('Remote image is too large')
    }
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      totalBytes += chunk.length
      if (totalBytes > MAX_TICKET_IMAGE_SIZE) {
        throw new Error('Remote image is too large')
      }
      chunks.push(chunk)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }

  return Buffer.concat(chunks, totalBytes)
}

export default async function ticketsRoutes(fastify: FastifyInstance) {

  // ==================== 用户端 API ====================

  /**
   * 创建工单
   * POST /tickets
   * instanceId 可选：如果不选实例，工单直接发给管理员
   */
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    bodyLimit: TICKET_UPLOAD_BODY_LIMIT
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { user } = request
    let uploadedAttachments: ticketDb.CreateTicketMessageAttachmentData[] = []

    try {
      if (!await db.getSystemConfigBoolean('ticket_enabled', true)) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN, 'Ticket creation is disabled'))
      }

      const payload = await readTicketPayload(request)
      const instanceId = parseOptionalPositiveId(payload.fields.instanceId)
      const subject = sanitizeContent(payload.fields.subject)
      const category = sanitizeContent(payload.fields.category)
      const priority = sanitizeContent(payload.fields.priority) as TicketPriority
      const content = sanitizeContent(payload.fields.content)

      if (instanceId === null) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      }

      // 输入验证
      if (!subject || subject.length < 2 || subject.length > 200) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Subject must be 2-200 characters'))
      }
      if (content.length > 5000) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Content must be 0-5000 characters'))
      }
      if (payload.images.length === 0 && content.length < 10) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Content must be 10-5000 characters when no images are attached'))
      }
      if (category && !VALID_CATEGORIES.includes(category)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid category'))
      }
      if (priority && !VALID_PRIORITIES.includes(priority)) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid priority'))
      }

      let hostId: number | null = null
      let instance: Awaited<ReturnType<typeof db.getInstanceById>> | null = null
      let host: Awaited<ReturnType<typeof getTicketHostOwnership>> | null = null

      // 如果选择了实例，验证实例存在且属于该用户
      if (instanceId !== undefined) {
        instance = await db.getInstanceById(instanceId)
        if (!instance || instance.user_id !== user.id) {
          return reply.code(400).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
        }
        hostId = instance.host_id

        // 检查宿主机是否存在
        host = await getTicketHostOwnership(hostId)
        if (!host) {
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        }
      }

      if (payload.images.length > 0) {
        uploadedAttachments = await uploadTicketImages(payload.images)
      }

      // 创建工单（instanceId 和 hostId 可以为 null，表示直接发给管理员）
      const result = await ticketDb.createTicket({
        userId: user.id,
        hostId,
        instanceId: instanceId ?? null,
        subject,
        category: category || 'general',
        priority: priority || 'normal',
        content,
        attachments: uploadedAttachments
      })

      // 发送通知：如果是用户托管节点的实例，发送给节点所有者；否则发送给管理员
      try {
        if (host && host.user.role !== 'admin') {
          // 用户托管节点：发送通知给节点所有者
          await sendNotification(host.userId, 'ticket_created', {
            username: user.username,
            subject,
            hostName: host.name,
            instanceName: instance?.name || '无'
          })
        } else {
          // 官方节点或未选择实例：发送通知给所有管理员
          const adminIds = await getAllAdminUserIds()
          for (const adminId of adminIds) {
            await sendNotification(adminId, 'ticket_created', {
              username: user.username,
              subject,
              hostName: host?.name || '系统',
              instanceName: instance?.name || '无'
            })
          }
        }
      } catch (err) {
        console.error('[Tickets] Failed to send notification:', err)
      }

      emitPluginEvent('ticket.created', {
        dedupeKey: `ticket.created:${result.ticketId}:${result.messageId}`,
        ticketId: result.ticketId,
        messageId: result.messageId,
        userId: user.id,
        username: user.username,
        subject,
        category: category || 'general',
        priority: priority || 'normal',
        instanceId: instanceId ?? null,
        hostId,
        attachmentCount: uploadedAttachments.length
      }, { id: user.id, role: user.role, username: user.username }, { dedupeKey: `ticket.created:${result.ticketId}:${result.messageId}` })

      return reply.code(201).send({
        message: 'Ticket created successfully',
        ticket: {
          id: result.ticketId,
          messageId: result.messageId
        }
      })
    } catch (error: any) {
      if (uploadedAttachments.length > 0) {
        await cleanupUploadedTicketImages(uploadedAttachments)
      }
      if (!isHandledTicketPayloadError(error)) {
        throw error
      }
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, error?.message || 'Invalid ticket payload'))
    }
  })

  /**
   * 获取我的工单列表
   * GET /tickets
   * 支持 active 状态筛选（排除已关闭）、搜索
   */
  fastify.get<{
    Querystring: {
      status?: ExtendedTicketStatus
      search?: string
      page?: number
      pageSize?: number
    }
  }>('/', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: {
      status?: ExtendedTicketStatus
      search?: string
      page?: number
      pageSize?: number
    }
  }>, reply: FastifyReply) => {
    const { user } = request
    const { status, search, page, pageSize } = request.query

    // 验证状态
    if (status && status !== 'active' && !VALID_STATUSES.includes(status as TicketStatus)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid status'))
    }

    const result = await ticketDb.getUserTickets(user.id, {
      status: status as TicketStatus | 'active' | undefined,
      search,
      page: parsePositiveInteger(page, 1),
      pageSize: parsePositiveInteger(pageSize, 10, 100)
    })

    return reply.send(result)
  })

  /**
   * 读取工单图片内容（鉴权代理）
   * GET /tickets/attachments/:attachmentId/content
   */
  fastify.get<{
    Params: { attachmentId: string }
  }>('/attachments/:attachmentId/content', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { attachmentId: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const attachmentId = parsePositiveId(request.params.attachmentId)

    if (attachmentId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const attachment = await ticketDb.getTicketMessageAttachmentById(attachmentId)
    if (!attachment) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    const access = await ticketDb.canUserAccessTicket(user.id, attachment.ticketId, user.role)
    if (!access.canAccess) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    let upstream: Response
    try {
      const safeImageUrl = await assertSafeHttpUrl(attachment.url, 'Ticket attachment image URL')
      upstream = await fetch(safeImageUrl.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(TICKET_PROXY_FETCH_TIMEOUT_MS)
      })
    } catch {
      return reply.code(502).send(apiError(ErrorCode.INTERNAL_ERROR, 'Failed to load remote image'))
    }

    if (!upstream.ok) {
      return reply.code(502).send(apiError(ErrorCode.INTERNAL_ERROR, 'Failed to load remote image'))
    }

    const upstreamMimeType = normalizeAllowedImageMimeType(upstream.headers.get('content-type'))
    const storedMimeType = normalizeAllowedImageMimeType(attachment.mimeType)
    if (upstream.headers.get('content-type') && !upstreamMimeType) {
      return reply.code(502).send(apiError(ErrorCode.INTERNAL_ERROR, 'Remote file is not an allowed image type'))
    }
    const responseMimeType = upstreamMimeType ?? storedMimeType
    if (!responseMimeType) {
      return reply.code(502).send(apiError(ErrorCode.INTERNAL_ERROR, 'Attachment image type is not allowed'))
    }

    let imageBuffer: Buffer
    try {
      imageBuffer = await readRemoteImageBody(upstream)
    } catch {
      return reply.code(502).send(apiError(ErrorCode.INTERNAL_ERROR, 'Remote image is too large'))
    }

    reply.header('Cache-Control', 'private, max-age=300')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Content-Type', responseMimeType)
    return reply.send(imageBuffer)
  })

  /**
   * 获取 AI 工单插件安全状态（仅管理员，不返回模型地址或密钥）
   * GET /tickets/ai/status
   */
  fastify.get('/ai/status', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async () => {
    const [contextPermission, draftPermission, replyPermission, automation] = await Promise.all([
      getAiTicketPermission(AI_TICKET_CONTEXT_PERMISSION),
      getAiTicketPermission(AI_TICKET_DRAFT_PERMISSION),
      getAiTicketPermission(AI_TICKET_REPLY_PERMISSION),
      getAiTicketAutomationStatus()
    ])

    const autoReplyActive = automation.enabled &&
      automation.mode === 'auto' &&
      automation.modelConfigured &&
      replyPermission.allowed

    return {
      pluginId: 'com.payincus.ai-ticket-agent',
      permissions: {
        readContext: contextPermission.allowed,
        generateDraft: draftPermission.allowed,
        reply: replyPermission.allowed
      },
      config: {
        enabled: automation.enabled,
        mode: automation.mode,
        modelConfigured: automation.modelConfigured,
        autoReplyCategories: automation.autoReplyCategories,
        confidenceThreshold: automation.confidenceThreshold,
        dailyAutoReplyLimit: automation.dailyAutoReplyLimit,
        ticketAutoReplyLimit: automation.ticketAutoReplyLimit,
        cooldownSeconds: automation.cooldownSeconds,
        showAiIdentity: automation.showAiIdentity
      },
      automation: {
        autoReplyActive,
        scanIntervalSeconds: 120,
        scope: 'official_system_tickets_only',
        requiresLatestCustomerMessage: true,
        safeguards: [
          'admin_only_status',
          'plugin_permission_required',
          'ticket_user_scoped_context',
          'confidence_threshold',
          'sensitive_handoff_rules',
          'daily_and_per_ticket_limits',
          'cooldown',
          'no_ticket_status_mutation'
        ]
      }
    }
  })

  /**
   * 获取工单详情
   * GET /tickets/:id
   */
  fastify.get<{
    Params: { id: string }
  }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 权限检查
    const access = await ticketDb.canUserAccessTicket(user.id, ticketId, user.role)
    if (!access.canAccess) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    const ticket = await ticketDb.getTicketById(ticketId)
    if (!ticket) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    return reply.send({
      ticket,
      isOwner: access.isOwner,
      isCreator: access.isCreator
    })
  })

  /**
   * 获取后台客服工作台上下文（仅管理员）
   * GET /tickets/:id/support-context
   */
  fastify.get<{
    Params: { id: string }
  }>('/:id/support-context', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const ticketId = parsePositiveId(request.params.id)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const context = await ticketDb.getAdminTicketSuccessContext(ticketId)
    if (!context) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    return reply.send(context)
  })

  /**
   * 获取 AI 工单安全上下文（仅管理员 + 已启用 AI 工单插件）
   * POST /tickets/:id/ai/context
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/ai/context', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', pattern: '^[1-9]\\d*$' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const permission = await getAiTicketContextPermission()
    if (!permission.allowed) {
      await auditAiTicketContextRead({
        actorUserId: user.id,
        ticketId,
        result: 'denied',
        reason: permission.code
      })
      return reply.code(403).send({
        error: permission.message || 'AI ticket context is not available',
        code: permission.code || 'AI_TICKET_CONTEXT_DENIED'
      })
    }

    const context = await buildAiTicketContext(ticketId)
    if (!context) {
      await auditAiTicketContextRead({
        actorUserId: user.id,
        ticketId,
        result: 'not_found',
        reason: 'TICKET_NOT_FOUND'
      })
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    await auditAiTicketContextRead({
      actorUserId: user.id,
      ticketId,
      result: 'success'
    })

    return reply.send({ context })
  })

  /**
   * 生成 AI 工单回复草稿（仅管理员 + 已启用 AI 工单插件）
   * POST /tickets/:id/ai/draft
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/ai/draft', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', pattern: '^[1-9]\\d*$' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const permission = await getAiTicketPermission(AI_TICKET_DRAFT_PERMISSION)
    if (!permission.allowed) {
      await auditAiTicketDraft({
        actorUserId: user.id,
        ticketId,
        result: 'denied',
        reason: permission.code
      })
      return reply.code(403).send({
        error: permission.message || 'AI ticket draft is not available',
        code: permission.code || 'AI_TICKET_DRAFT_DENIED'
      })
    }

    try {
      const result = await generateAiTicketDraft(ticketId)
      if (!result.safety.passed) {
        await auditAiTicketDraft({
          actorUserId: user.id,
          ticketId,
          result: 'blocked',
          reason: result.safety.blockedReasons.join(',')
        })
        return reply.code(422).send({
          error: 'AI draft failed safety checks',
          code: 'AI_TICKET_DRAFT_BLOCKED',
          safety: result.safety
        })
      }

      await auditAiTicketDraft({
        actorUserId: user.id,
        ticketId,
        result: 'success'
      })
      return reply.send(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const knownStatus: Record<string, number> = {
        AI_TICKET_AGENT_DISABLED: 403,
        AI_TICKET_AGENT_MODEL_NOT_CONFIGURED: 400,
        TICKET_NOT_FOUND: 404
      }
      const statusCode = knownStatus[message] || 502
      await auditAiTicketDraft({
        actorUserId: user.id,
        ticketId,
        result: 'failed',
        reason: message
      })

      if (message === 'TICKET_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
      }

      return reply.code(statusCode).send({
        error: statusCode === 502 ? 'AI draft generation failed' : message,
        code: message.startsWith('AI_TICKET_') ? message : 'AI_TICKET_DRAFT_FAILED'
      })
    }
  })

  /**
   * 由 AI 工单插件生成并发送一条客服回复（仅管理员 + 已启用 AI 工单插件 + reply 权限）
   * POST /tickets/:id/ai/reply
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/ai/reply', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', pattern: '^[1-9]\\d*$' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const permission = await getAiTicketPermission(AI_TICKET_REPLY_PERMISSION)
    if (!permission.allowed) {
      await auditAiTicketReply({
        actorUserId: user.id,
        ticketId,
        result: 'denied',
        reason: permission.code
      })
      return reply.code(403).send({
        error: permission.message || 'AI ticket reply is not available',
        code: permission.code || 'AI_TICKET_REPLY_DENIED'
      })
    }

    const ticket = await ticketDb.getTicketById(ticketId)
    if (!ticket) {
      await auditAiTicketReply({
        actorUserId: user.id,
        ticketId,
        result: 'failed',
        reason: 'TICKET_NOT_FOUND'
      })
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }
    if (ticket.status === 'closed') {
      await auditAiTicketReply({
        actorUserId: user.id,
        ticketId,
        result: 'denied',
        reason: 'AI_TICKET_CLOSED'
      })
      return reply.code(400).send({
        error: 'Cannot reply to a closed ticket',
        code: 'AI_TICKET_CLOSED'
      })
    }

    try {
      const result = await generateAiTicketReply(ticketId)
      if (!result.canSend) {
        const code = result.mode === 'draft'
          ? 'AI_TICKET_AGENT_REPLY_MODE_DISABLED'
          : 'AI_TICKET_REPLY_HANDOFF_REQUIRED'
        await auditAiTicketReply({
          actorUserId: user.id,
          ticketId,
          result: 'denied',
          reason: result.sendBlockedReasons.length > 0 ? result.sendBlockedReasons.join(',') : code
        })
        return reply.code(code === 'AI_TICKET_AGENT_REPLY_MODE_DISABLED' ? 409 : 422).send({
          error: code === 'AI_TICKET_AGENT_REPLY_MODE_DISABLED'
            ? 'AI ticket agent is in draft mode'
            : 'AI reply requires human handling',
          code,
          confidence: result.confidence,
          confidenceThreshold: result.confidenceThreshold,
          blockedReasons: result.sendBlockedReasons
        })
      }
      if (!result.safety.passed) {
        await auditAiTicketReply({
          actorUserId: user.id,
          ticketId,
          result: 'blocked',
          reason: result.safety.blockedReasons.join(',')
        })
        return reply.code(422).send({
          error: 'AI reply failed safety checks',
          code: 'AI_TICKET_REPLY_BLOCKED',
          safety: result.safety
        })
      }

      const message = await ticketDb.addTicketMessage(ticketId, user.id, result.draft, true, [])

      try {
        await sendNotification(ticket.userId, 'ticket_replied', {
          subject: ticket.subject,
          hostName: ticket.host?.name || '系统',
          replyFrom: user.username
        })
      } catch (err) {
        console.error('[Tickets] Failed to send AI ticket reply notification:', err)
      }

      await auditAiTicketReply({
        actorUserId: user.id,
        ticketId,
        result: 'success'
      })

      return reply.code(201).send({
        message: 'AI reply sent successfully',
        data: message,
        model: result.model,
        safety: result.safety,
        confidence: result.confidence,
        confidenceThreshold: result.confidenceThreshold
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const knownStatus: Record<string, number> = {
        AI_TICKET_AGENT_DISABLED: 403,
        AI_TICKET_AGENT_MODEL_NOT_CONFIGURED: 400,
        AI_TICKET_MODEL_REQUEST_FAILED: 502,
        AI_TICKET_MODEL_EMPTY_RESPONSE: 502,
        AI_TICKET_MODEL_DECISION_INVALID: 502,
        TICKET_NOT_FOUND: 404
      }
      const statusCode = knownStatus[message] || 502
      await auditAiTicketReply({
        actorUserId: user.id,
        ticketId,
        result: 'failed',
        reason: message
      })

      if (message === 'TICKET_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
      }

      return reply.code(statusCode).send({
        error: statusCode === 502 ? 'AI reply generation failed' : message,
        code: message.startsWith('AI_TICKET_') ? message : 'AI_TICKET_REPLY_FAILED'
      })
    }
  })

  /**
   * 创建内部备注（仅管理员，用户端不可见）
   * POST /tickets/:id/internal-notes
   */
  fastify.post<{
    Params: { id: string }
    Body: { content?: string }
  }>('/:id/internal-notes', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { content?: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)
    const content = sanitizeContent(request.body?.content)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }
    if (content.length < 1 || content.length > 3000) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Internal note must be 1-3000 characters'))
    }

    const ticket = await ticketDb.getTicketById(ticketId)
    if (!ticket) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    const note = await ticketDb.createTicketInternalNote(ticketId, user.id, user.username, content)
    return reply.code(201).send({ note })
  })

  /**
   * 关联客服处理对象（仅管理员）
   * POST /tickets/:id/links
   */
  fastify.post<{
    Params: { id: string }
    Body: { objectType?: string; objectId?: number | string }
  }>('/:id/links', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { objectType?: string; objectId?: number | string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)
    const objectId = parsePositiveId(request.body?.objectId)
    const objectType = ticketDb.normalizeTicketObjectLinkType(request.body?.objectType)

    if (ticketId === null || objectId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }
    if (!objectType) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid object type'))
    }

    const link = await ticketDb.createTicketObjectLink(ticketId, objectType, objectId, user.id, user.username)
    if (!link) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    return reply.code(201).send({ link })
  })

  /**
   * 从客服工作台发送一条站内通知（仅管理员）
   * POST /tickets/:id/notify
   */
  fastify.post<{
    Params: { id: string }
    Body: { content?: string }
  }>('/:id/notify', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { content?: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)
    const content = sanitizeContent(request.body?.content)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }
    if (content.length < 1 || content.length > 1000) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Notification must be 1-1000 characters'))
    }

    const ticket = await ticketDb.getTicketById(ticketId)
    if (!ticket) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    await sendNotification(ticket.userId, 'ticket_replied', {
      subject: ticket.subject,
      hostName: ticket.host?.name || '系统',
      message: content,
      replyFrom: user.username
    })
    await ticketDb.createTicketInternalNote(ticketId, user.id, user.username, `已向用户发送通知：${content}`)

    return reply.send({ message: 'Notification sent successfully' })
  })

  /**
   * 获取工单消息列表
   * GET /tickets/:id/messages
   */
  fastify.get<{
    Params: { id: string }
    Querystring: { page?: number; pageSize?: number }
  }>('/:id/messages', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Querystring: { page?: number; pageSize?: number }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)
    const { page, pageSize } = request.query

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 权限检查
    const access = await ticketDb.canUserAccessTicket(user.id, ticketId, user.role)
    if (!access.canAccess) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    const result = await ticketDb.getTicketMessages(ticketId, {
      page: parsePositiveInteger(page, 1),
      pageSize: parsePositiveInteger(pageSize, 50, 100)
    })

    return reply.send(result)
  })

  /**
   * 回复工单（用户或管理员）
   * POST /tickets/:id/messages
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/messages', {
    onRequest: [fastify.authenticate],
    bodyLimit: TICKET_UPLOAD_BODY_LIMIT
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    let uploadedAttachments: ticketDb.CreateTicketMessageAttachmentData[] = []

    try {
      const payload = await readTicketPayload(request)
      const content = sanitizeContent(payload.fields.content)

      // 输入验证
      if (content.length > 5000) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Content must be 0-5000 characters'))
      }
      if (payload.images.length === 0 && content.length < 1) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Content must be 1-5000 characters when no images are attached'))
      }

      // 权限检查
      const access = await ticketDb.canUserAccessTicket(user.id, ticketId, user.role)
      if (!access.canAccess) {
        return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
      }

      // 获取工单详情
      const ticket = await ticketDb.getTicketById(ticketId)
      if (!ticket) {
        return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
      }

      // 检查工单状态
      if (ticket.status === 'closed') {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Cannot reply to a closed ticket'))
      }

      if (payload.images.length > 0) {
        uploadedAttachments = await uploadTicketImages(payload.images)
      }

      // 添加消息
      const message = await ticketDb.addTicketMessage(
        ticketId,
        user.id,
        content,
        access.isOwner,
        uploadedAttachments
      )

      // 发送通知
      // 判断是否是托管实例的工单（宿主机有所有者且不是管理员账号）
      const hostedTicketHost = await getTicketHostOwnership(ticket.host?.id)
      const isHostedTicket = hostedTicketHost?.user.role === 'user'

      try {
        if (access.isOwner) {
          // 宿主机所有者或管理员回复，通知工单创建用户
          await sendNotification(ticket.userId, 'ticket_replied', {
            subject: ticket.subject,
            hostName: ticket.host?.name || '系统',
            replyFrom: user.username
          })
        } else {
          // 用户回复工单
          if (isHostedTicket) {
            // 托管实例的工单：通知宿主机所有者
            await sendNotification(hostedTicketHost!.userId, 'ticket_replied', {
              subject: ticket.subject,
              hostName: ticket.host?.name || '系统',
              replyFrom: user.username
            })
          } else {
            // 官方节点或无实例的工单：通知所有管理员
            const adminIds = await getAllAdminUserIds()
            for (const adminId of adminIds) {
              await sendNotification(adminId, 'ticket_replied', {
                subject: ticket.subject,
                hostName: ticket.host?.name || '系统',
                replyFrom: user.username
              })
            }
          }
        }
      } catch (err) {
        console.error('[Tickets] Failed to send notification:', err)
      }

      emitPluginEvent('ticket.replied', {
        dedupeKey: `ticket.replied:${ticketId}:${message.id}`,
        ticketId,
        messageId: message.id,
        userId: user.id,
        username: user.username,
        subject: ticket.subject,
        isFromOwner: access.isOwner,
        status: ticket.status,
        attachmentCount: uploadedAttachments.length,
        createdAt: message.createdAt
      }, { id: user.id, role: user.role, username: user.username }, { dedupeKey: `ticket.replied:${ticketId}:${message.id}` })

      return reply.code(201).send({
        message: 'Message added successfully',
        data: message
      })
    } catch (error: any) {
      if (uploadedAttachments.length > 0) {
        await cleanupUploadedTicketImages(uploadedAttachments)
      }
      if (!isHandledTicketPayloadError(error)) {
        throw error
      }
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, error?.message || 'Invalid ticket reply payload'))
    }
  })

  /**
   * 删除工单消息（仅管理员）
   * DELETE /tickets/:id/messages/:messageId
   */
  fastify.delete<{
    Params: { id: string; messageId: string }
  }>('/:id/messages/:messageId', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async (request: FastifyRequest<{
    Params: { id: string; messageId: string }
  }>, reply: FastifyReply) => {
    const ticketId = parsePositiveId(request.params.id)
    const messageId = parsePositiveId(request.params.messageId)

    if (ticketId === null || messageId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 检查消息是否存在且属于该工单
    const message = await ticketDb.getTicketMessageById(messageId)
    if (!message || message.ticketId !== ticketId) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    const attachments = await ticketDb.getTicketMessageAttachments(messageId)

    // 删除消息
    await ticketDb.deleteTicketMessage(messageId)

    if (attachments.length > 0) {
      await cleanupUploadedTicketImages(attachments)
    }

    return reply.send({
      message: 'Message deleted successfully'
    })
  })

  /**
   * 更新工单状态（管理员）
   * PATCH /tickets/:id/status
   */
  fastify.patch<{
    Params: { id: string }
    Body: { status: TicketStatus }
  }>('/:id/status', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { status: TicketStatus }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)
    const status = normalizeTicketStatusBody(request.body)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证状态
    if (!status) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid status'))
    }

    // 权限检查：必须是管理员
    const access = await ticketDb.canUserAccessTicket(user.id, ticketId, user.role)
    if (!access.canAccess || !access.isOwner) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取工单详情
    const ticket = await ticketDb.getTicketById(ticketId)
    if (!ticket) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    // 更新状态
    await ticketDb.updateTicketStatus(ticketId, status)

    // 发送通知给用户
    try {
      await sendNotification(ticket.userId, 'ticket_status_changed', {
        subject: ticket.subject,
        hostName: ticket.host?.name || '系统',
        newStatus: status
      })
    } catch (err) {
      console.error('[Tickets] Failed to send notification:', err)
    }

    return reply.send({
      message: 'Status updated successfully',
      status
    })
  })

  /**
   * 关闭工单（用户或管理员）
   * POST /tickets/:id/close
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/close', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const ticketId = parsePositiveId(request.params.id)

    if (ticketId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 权限检查
    const access = await ticketDb.canUserAccessTicket(user.id, ticketId, user.role)
    if (!access.canAccess) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    // 获取工单详情
    const ticket = await ticketDb.getTicketById(ticketId)
    if (!ticket) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    if (ticket.status === 'closed') {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Ticket is already closed'))
    }

    // 更新状态
    await ticketDb.updateTicketStatus(ticketId, 'closed')

    // 发送通知
    // 判断是否是托管实例的工单（宿主机有所有者且不是管理员账号）
    const hostedTicketHost = await getTicketHostOwnership(ticket.host?.id)
    const isHostedTicket = hostedTicketHost?.user.role === 'user'
    
    try {
      if (access.isCreator) {
        // 用户关闭工单
        if (isHostedTicket) {
          // 托管实例的工单：通知宿主机所有者
          await sendNotification(hostedTicketHost!.userId, 'ticket_closed', {
            subject: ticket.subject,
            hostName: ticket.host?.name || '系统',
            closedBy: user.username
          })
        } else {
          // 官方节点或无实例的工单：通知所有管理员
          const adminIds = await getAllAdminUserIds()
          for (const adminId of adminIds) {
            await sendNotification(adminId, 'ticket_closed', {
              subject: ticket.subject,
              hostName: ticket.host?.name || '系统',
              closedBy: user.username
            })
          }
        }
      } else {
        // 宿主机所有者或管理员关闭工单，通知工单创建用户
        await sendNotification(ticket.userId, 'ticket_closed', {
          subject: ticket.subject,
          hostName: ticket.host?.name || '系统',
          closedBy: user.username
        })
      }
    } catch (err) {
      console.error('[Tickets] Failed to send notification:', err)
    }

    return reply.send({
      message: 'Ticket closed successfully'
    })
  })

  // ==================== 宿主机所有者 API ====================

  /**
   * 获取宿主机收到的工单列表
   * GET /tickets/hosts/:hostId
   * 支持 active 状态筛选、搜索
   */
  fastify.get<{
    Params: { hostId: string }
    Querystring: {
      status?: ExtendedTicketStatus
      search?: string
      page?: number
      pageSize?: number
    }
  }>('/hosts/:hostId', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { hostId: string }
    Querystring: {
      status?: ExtendedTicketStatus
      search?: string
      page?: number
      pageSize?: number
    }
  }>, reply: FastifyReply) => {
    const { user } = request
    const hostId = parsePositiveId(request.params.hostId)
    const { status, search, page, pageSize } = request.query

    if (hostId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证宿主机所有权
    const host = await db.getHostById(hostId)
    if (!host || host.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 验证状态
    if (status && status !== 'active' && !VALID_STATUSES.includes(status as TicketStatus)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid status'))
    }

    const result = await ticketDb.getHostTickets(hostId, {
      status: status as TicketStatus | 'active' | undefined,
      search,
      page: parsePositiveInteger(page, 1),
      pageSize: parsePositiveInteger(pageSize, 10, 100)
    })

    return reply.send(result)
  })

  /**
   * 获取所有宿主机的工单（汇总视图）
   * GET /tickets/my-hosts
   * 支持 active 状态筛选、搜索
   */
  fastify.get<{
    Querystring: {
      status?: ExtendedTicketStatus
      hostId?: number
      sourceType?: 'all' | 'user' | 'official' | 'hosted'
      queue?: 'pending' | 'due_soon' | 'overdue' | 'waiting_user' | 'waiting_internal'
      search?: string
      page?: number
      pageSize?: number
    }
  }>('/my-hosts', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: {
      status?: ExtendedTicketStatus
      hostId?: number
      sourceType?: 'all' | 'user' | 'official' | 'hosted'
      queue?: 'pending' | 'due_soon' | 'overdue' | 'waiting_user' | 'waiting_internal'
      search?: string
      page?: number
      pageSize?: number
    }
  }>, reply: FastifyReply) => {
    const { user } = request
    const { status, hostId, sourceType, queue, search, page, pageSize } = request.query
    const isAdmin = user.role === 'admin'
    const parsedHostId = parseOptionalPositiveId(hostId)

    // 验证状态
    if (status && status !== 'active' && !VALID_STATUSES.includes(status as TicketStatus)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid status'))
    }

    if (parsedHostId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    if (sourceType && !['all', 'user', 'official', 'hosted'].includes(sourceType)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid source type'))
    }
    if (queue && !['pending', 'due_soon', 'overdue', 'waiting_user', 'waiting_internal'].includes(queue)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid queue'))
    }
    if (queue && !isAdmin) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (!isAdmin && sourceType && sourceType !== 'all' && sourceType !== 'hosted') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (parsedHostId !== undefined && sourceType === 'user') {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'User tickets cannot be filtered by host'))
    }

    // 如果指定了 hostId，验证所有权（管理员跳过验证）
    if (parsedHostId !== undefined && !isAdmin) {
      const host = await db.getHostById(parsedHostId)
      if (!host || host.user_id !== user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }
    }

    // 管理员查看所有工单，普通用户只查看自己节点的工单
    const result = await ticketDb.getOwnerAllTickets(isAdmin ? undefined : user.id, {
      status: status as TicketStatus | 'active' | undefined,
      hostId: parsedHostId,
      sourceType: sourceType && sourceType !== 'all' ? sourceType : undefined,
      queue,
      search,
      page: parsePositiveInteger(page, 1),
      pageSize: parsePositiveInteger(pageSize, 10, 100)
    })

    return reply.send(result)
  })

  /**
   * 获取待处理工单数量
   * GET /tickets/pending-count
   */
  fastify.get('/pending-count', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { user } = request
    const isAdmin = user.role === 'admin'

    // 检查用户是否拥有节点
    const userHostCount = isAdmin ? 0 : await db.prisma.host.count({
      where: { userId: user.id }
    })

    // 管理员不显示"我的工单"数量（前端已隐藏该标签）
    const [userCount, ownerCount] = await Promise.all([
      isAdmin ? Promise.resolve(0) : ticketDb.getUserOpenTicketCount(user.id),
      ticketDb.getOwnerPendingTicketCount(isAdmin ? undefined : user.id)
    ])

    return reply.send({
      userTickets: userCount,
      hostTickets: ownerCount,
      total: userCount + ownerCount,
      isHostOwner: isAdmin || userHostCount > 0  // 管理员或拥有节点的用户
    })
  })
}
