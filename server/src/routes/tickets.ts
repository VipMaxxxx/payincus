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
import { deleteTicketImageFromLsky, uploadTicketImageToLsky } from '../lib/lsky.js'
import { sendNotification } from '../lib/notifier.js'

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

const MAX_TICKET_IMAGES = 6
const MAX_TICKET_IMAGE_SIZE = 50 * 1024 * 1024
const TICKET_UPLOAD_BODY_LIMIT = (MAX_TICKET_IMAGES * MAX_TICKET_IMAGE_SIZE) + (4 * 1024 * 1024)
const TICKET_PROXY_FETCH_TIMEOUT_MS = 15_000
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
])

interface ParsedTicketPayload {
  fields: Record<string, string>
  images: Array<{
    buffer: Buffer
    filename: string
    contentType: string
    sizeBytes: number
  }>
}

function isMultipartRequest(request: FastifyRequest): boolean {
  return typeof (request as FastifyRequest & { isMultipart?: () => boolean }).isMultipart === 'function'
    && (request as FastifyRequest & { isMultipart: () => boolean }).isMultipart()
}

function parseInteger(value: string | undefined): number | null {
  if (!value || !value.trim()) {
    return null
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function sanitizeContent(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function readTicketPayload(request: FastifyRequest): Promise<ParsedTicketPayload> {
  if (!isMultipartRequest(request)) {
    const body = (request.body ?? {}) as Record<string, unknown>
    const fields: Record<string, string> = {}

    for (const [key, value] of Object.entries(body)) {
      if (value !== null && value !== undefined) {
        fields[key] = String(value)
      }
    }

    return { fields, images: [] }
  }

  const multipartRequest = request as FastifyRequest & {
    parts: () => AsyncIterable<any>
  }
  const fields: Record<string, string> = {}
  const images: ParsedTicketPayload['images'] = []

  for await (const part of multipartRequest.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'images') {
        await part.toBuffer()
        continue
      }

      if (!part.mimetype || !ALLOWED_IMAGE_MIME_TYPES.has(part.mimetype)) {
        throw new Error('Only JPG, PNG, WebP, GIF and AVIF images are supported')
      }

      if (images.length >= MAX_TICKET_IMAGES) {
        throw new Error(`A ticket message can contain at most ${MAX_TICKET_IMAGES} images`)
      }

      const buffer = await part.toBuffer()
      if (buffer.length === 0) {
        continue
      }

      if (buffer.length > MAX_TICKET_IMAGE_SIZE) {
        throw new Error(`Each image must be no larger than ${MAX_TICKET_IMAGE_SIZE / (1024 * 1024)}MB`)
      }

      images.push({
        buffer,
        filename: part.filename || `ticket-image-${Date.now()}`,
        contentType: part.mimetype,
        sizeBytes: buffer.length
      })
      continue
    }

    fields[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value ?? '')
  }

  return { fields, images }
}

async function uploadTicketImages(
  images: ParsedTicketPayload['images']
): Promise<ticketDb.CreateTicketMessageAttachmentData[]> {
  const uploaded: ticketDb.CreateTicketMessageAttachmentData[] = []

  try {
    for (const image of images) {
      const result = await uploadTicketImageToLsky(image)
      uploaded.push({
        provider: result.provider,
        providerVersion: result.providerVersion,
        providerFileId: result.providerFileId,
        filename: result.filename,
        originalName: result.originalName,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        width: result.width,
        height: result.height,
        url: result.url,
        thumbnailUrl: result.thumbnailUrl
      })
    }
  } catch (error) {
    if (uploaded.length > 0) {
      await cleanupUploadedTicketImages(uploaded)
    }
    throw error
  }

  return uploaded
}

async function cleanupUploadedTicketImages(
  attachments: Array<{ providerVersion: string; providerFileId?: string | null }>
): Promise<void> {
  await Promise.allSettled(
    attachments.map(attachment => deleteTicketImageFromLsky(attachment.providerVersion, attachment.providerFileId ?? null))
  )
}

function isHandledTicketPayloadError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false
  }

  return [
    'Only JPG',
    'A ticket message can contain at most',
    'Each image must be no larger than',
    'Lsky',
    'image bed'
  ].some(fragment => error.message.includes(fragment))
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
      const instanceId = parseInteger(payload.fields.instanceId)
      const subject = sanitizeContent(payload.fields.subject)
      const category = sanitizeContent(payload.fields.category)
      const priority = sanitizeContent(payload.fields.priority) as TicketPriority
      const content = sanitizeContent(payload.fields.content)

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
      if (instanceId && typeof instanceId === 'number') {
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
        instanceId: instanceId || null,
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
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize), 100) : 10
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
    const attachmentId = Number(request.params.attachmentId)

    if (isNaN(attachmentId)) {
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
      upstream = await fetch(attachment.url, {
        signal: AbortSignal.timeout(TICKET_PROXY_FETCH_TIMEOUT_MS)
      })
    } catch {
      return reply.code(502).send(apiError(ErrorCode.INTERNAL_ERROR, 'Failed to load remote image'))
    }

    if (!upstream.ok) {
      return reply.code(502).send(apiError(ErrorCode.INTERNAL_ERROR, 'Failed to load remote image'))
    }

    const imageBuffer = Buffer.from(await upstream.arrayBuffer())

    reply.header('Cache-Control', 'private, max-age=300')
    reply.header('Content-Type', attachment.mimeType)
    return reply.send(imageBuffer)
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
    const ticketId = Number(request.params.id)

    if (isNaN(ticketId)) {
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
    const ticketId = Number(request.params.id)
    const { page, pageSize } = request.query

    if (isNaN(ticketId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 权限检查
    const access = await ticketDb.canUserAccessTicket(user.id, ticketId, user.role)
    if (!access.canAccess) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    const result = await ticketDb.getTicketMessages(ticketId, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize), 100) : 50
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
    const ticketId = Number(request.params.id)

    if (isNaN(ticketId)) {
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
    const ticketId = Number(request.params.id)
    const messageId = Number(request.params.messageId)

    if (isNaN(ticketId) || isNaN(messageId)) {
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
    const ticketId = Number(request.params.id)
    const { status } = request.body

    if (isNaN(ticketId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证状态
    if (!status || !VALID_STATUSES.includes(status)) {
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
    const ticketId = Number(request.params.id)

    if (isNaN(ticketId)) {
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
    const hostId = Number(request.params.hostId)
    const { status, search, page, pageSize } = request.query

    if (isNaN(hostId)) {
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
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize), 100) : 10
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
      search?: string
      page?: number
      pageSize?: number
    }
  }>, reply: FastifyReply) => {
    const { user } = request
    const { status, hostId, sourceType, search, page, pageSize } = request.query
    const isAdmin = user.role === 'admin'

    // 验证状态
    if (status && status !== 'active' && !VALID_STATUSES.includes(status as TicketStatus)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid status'))
    }

    if (sourceType && !['all', 'user', 'official', 'hosted'].includes(sourceType)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid source type'))
    }

    if (!isAdmin && sourceType && sourceType !== 'all' && sourceType !== 'hosted') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (hostId && sourceType === 'user') {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'User tickets cannot be filtered by host'))
    }

    // 如果指定了 hostId，验证所有权（管理员跳过验证）
    if (hostId && !isAdmin) {
      const host = await db.getHostById(Number(hostId))
      if (!host || host.user_id !== user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }
    }

    // 管理员查看所有工单，普通用户只查看自己节点的工单
    const result = await ticketDb.getOwnerAllTickets(isAdmin ? undefined : user.id, {
      status: status as TicketStatus | 'active' | undefined,
      hostId: hostId ? Number(hostId) : undefined,
      sourceType: sourceType && sourceType !== 'all' ? sourceType : undefined,
      search,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize), 100) : 10
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
