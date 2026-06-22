/**
 * 站内信路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as inboxDb from '../db/inbox.js'
import * as db from '../db/index.js'
import * as announcementsDb from '../db/announcements.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { isSmtpEnabled, sendHostAnnouncementEmail } from '../lib/mailer.js'

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !POSITIVE_INTEGER_PATTERN.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function parsePositiveId(value: string): number | null {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveIdArray(value: number[] | undefined): number[] | undefined | null {
  if (value === undefined) return undefined
  const ids: number[] = []
  const seenIds = new Set<number>()
  for (const item of value) {
    if (!Number.isSafeInteger(item) || item <= 0) return null
    if (!seenIds.has(item)) {
      seenIds.add(item)
      ids.push(item)
    }
  }
  return ids
}

function normalizeInboxMessageInput(body: unknown): { title: string; content: string } | { error: { error: string; message: string } } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { error: 'TITLE_REQUIRED', message: 'Title is required' } }
  }

  const { title, content } = body as { title?: unknown; content?: unknown }
  if (typeof title !== 'string' || title.trim().length === 0) {
    return { error: { error: 'TITLE_REQUIRED', message: 'Title is required' } }
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { error: { error: 'CONTENT_REQUIRED', message: 'Content is required' } }
  }

  const trimmedTitle = title.trim()
  const trimmedContent = content.trim()
  if (trimmedTitle.length > 200) {
    return { error: { error: 'TITLE_TOO_LONG', message: 'Title is too long' } }
  }
  if (trimmedContent.length > 5000) {
    return { error: { error: 'CONTENT_TOO_LONG', message: 'Content is too long' } }
  }

  return { title: trimmedTitle, content: trimmedContent }
}

export default async function inboxRoutes(fastify: FastifyInstance) {

  // 所有路由都需要认证
  fastify.addHook('onRequest', fastify.authenticate)

  /**
   * 获取站内信列表
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      isRead?: string
    }
  }>('/', async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      isRead?: string
    }
  }>) => {
    const { isRead } = request.query
    const userId = request.user.id

    // 解析 isRead 参数
    let isReadFilter: boolean | undefined
    if (isRead === 'true') {
      isReadFilter = true
    } else if (isRead === 'false') {
      isReadFilter = false
    }

    const result = await inboxDb.getInboxMessages(userId, {
      page: parsePositiveInteger(request.query.page, 1),
      pageSize: Math.min(100, parsePositiveInteger(request.query.pageSize, 20)),
      isRead: isReadFilter
    })

    return result
  })

  /**
   * 获取未读消息数量
   */
  fastify.get('/unread-count', async (request: FastifyRequest) => {
    const userId = request.user.id
    const count = await inboxDb.getUnreadCount(userId)
    return { count }
  })

  /**
   * 标记单条消息为已读
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/read', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const messageId = parsePositiveId(id)
    const userId = request.user.id

    if (messageId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const success = await inboxDb.markAsRead(messageId, userId)
    if (!success) {
      return reply.code(404).send(apiError(ErrorCode.MESSAGE_NOT_FOUND))
    }

    return { success: true }
  })

  /**
   * 标记所有消息为已读
   */
  fastify.post('/read-all', async (request: FastifyRequest) => {
    const userId = request.user.id
    const count = await inboxDb.markAllAsRead(userId)
    return { success: true, count }
  })

  /**
   * 删除单条消息
   */
  fastify.delete<{
    Params: { id: string }
  }>('/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const messageId = parsePositiveId(id)
    const userId = request.user.id

    if (messageId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const success = await inboxDb.deleteMessage(messageId, userId)
    if (!success) {
      return reply.code(404).send(apiError(ErrorCode.MESSAGE_NOT_FOUND))
    }

    return { success: true }
  })

  /**
   * 删除所有已读消息
   */
  fastify.delete('/read', async (request: FastifyRequest) => {
    const userId = request.user.id
    const count = await inboxDb.deleteReadMessages(userId)
    return { success: true, count }
  })

  /**
   * 管理员发送全站站内信
   */
  fastify.post<{
    Body: {
      title: string
      content: string
    }
  }>('/admin/broadcast', async (request: FastifyRequest<{
    Body: {
      title: string
      content: string
    }
  }>, reply: FastifyReply) => {
    // 检查管理员权限
    if (request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const messageInput = normalizeInboxMessageInput(request.body)
    if ('error' in messageInput) {
      return reply.code(400).send(messageInput.error)
    }

    // 获取所有活跃用户
    const userIds = await inboxDb.getAllActiveUserIds()
    
    if (userIds.length === 0) {
      return { success: true, count: 0 }
    }

    // 批量发送
    const count = await inboxDb.createBulkMessages({
      userIds,
      eventType: 'system_announcement',
      title: messageInput.title,
      content: messageInput.content,
      data: { senderId: request.user.id }
    })

    // 保存公告记录
    await announcementsDb.createAnnouncement({
      type: 'system_broadcast',
      senderId: request.user.id,
      title: messageInput.title,
      content: messageInput.content,
      recipientCount: count,
    })

    return { success: true, count }
  })

  /**
   * 节点所有者通知实例用户（站内信，可选附带邮件）
   */
  fastify.post<{
    Params: { hostId: string }
    Body: {
      title: string
      content: string
      instanceIds?: number[]
      sendEmail?: boolean
    }
  }>('/hosts/:hostId/notify', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          content: { type: 'string', minLength: 1, maxLength: 5000 },
          instanceIds: {
            type: 'array',
            items: { type: 'integer', minimum: 1 },
            minItems: 1,
            maxItems: 100
          },
          sendEmail: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { hostId: string }
    Body: {
      title: string
      content: string
      instanceIds?: number[]
      sendEmail?: boolean
    }
  }>, reply: FastifyReply) => {
    const hostId = parsePositiveId(request.params.hostId)
    const userId = request.user.id
    const { instanceIds, sendEmail = false } = request.body

    if (hostId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }
    const normalizedInstanceIds = parsePositiveIdArray(instanceIds)
    if (normalizedInstanceIds === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 检查节点是否存在
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 检查是否是节点所有者或管理员
    if (host.user_id !== userId && request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const messageInput = normalizeInboxMessageInput(request.body)
    if ('error' in messageInput) {
      return reply.code(400).send(messageInput.error)
    }

    const trimmedTitle = messageInput.title
    const trimmedContent = messageInput.content

    // 获取目标用户（去重）：如果指定了 instanceIds 则只通知这些实例的用户，否则通知全部
    const recipients = await inboxDb.getUniqueRecipientsByHostId(hostId, normalizedInstanceIds)
    const userIds = recipients.map(recipient => recipient.userId)
    const emailRecipients = sendEmail
      ? recipients.filter(recipient => typeof recipient.email === 'string' && recipient.email.trim().length > 0)
      : []

    if (sendEmail && emailRecipients.length > 0) {
      const smtpEnabled = await isSmtpEnabled()
      if (!smtpEnabled) {
        return reply.code(400).send({
          error: 'SMTP_NOT_CONFIGURED',
          message: 'SMTP is not configured'
        })
      }
    }

    if (userIds.length === 0) {
      return {
        success: true,
        count: 0,
        ...(sendEmail ? {
          email: {
            requested: true,
            mode: 'none',
            sentCount: 0,
            queuedCount: 0,
            skippedCount: 0,
            failedCount: 0
          }
        } : {})
      }
    }

    // 构建带节点署名的消息内容
    const messageContent = `${trimmedContent}\n\n来自节点：${host.name}`

    // 批量发送
    const count = await inboxDb.createBulkMessages({
      userIds,
      eventType: 'host_announcement',
      title: trimmedTitle,
      content: messageContent,
      data: { hostId, hostName: host.name, senderId: userId }
    })

    // 保存公告记录
    await announcementsDb.createAnnouncement({
      type: 'host_broadcast',
      senderId: userId,
      title: trimmedTitle,
      content: trimmedContent,
      recipientCount: count,
      hostId,
    })

    if (!sendEmail) {
      return { success: true, count }
    }

    const emailSummary = {
      requested: true,
      mode: 'none' as 'none' | 'direct' | 'queued',
      sentCount: 0,
      queuedCount: 0,
      skippedCount: recipients.length - emailRecipients.length,
      failedCount: 0
    }

    if (recipients.length === 1 && emailRecipients.length === 1) {
      const recipient = emailRecipients[0]
      emailSummary.mode = 'direct'

      const directSendResult = await sendHostAnnouncementEmail(recipient.email!.trim(), {
        username: recipient.username,
        hostName: host.name,
        title: trimmedTitle,
        content: trimmedContent
      })

      if (directSendResult.success) {
        emailSummary.sentCount = 1
      } else {
        emailSummary.failedCount = 1
        fastify.log.error(
          `[Inbox] Failed to send direct host announcement email to user ${recipient.userId}: ${directSendResult.error}`
        )
      }
    } else if (emailRecipients.length > 0) {
      emailSummary.mode = 'queued'

      try {
        emailSummary.queuedCount = await db.enqueueHostNotificationEmailTasks(
          emailRecipients.map(recipient => ({
            userId: recipient.userId,
            hostId,
            email: recipient.email!.trim(),
            username: recipient.username,
            hostName: host.name,
            title: trimmedTitle,
            content: trimmedContent
          }))
        )
        emailSummary.failedCount = Math.max(0, emailRecipients.length - emailSummary.queuedCount)
      } catch (error) {
        emailSummary.failedCount = emailRecipients.length
        fastify.log.error(`[Inbox] Failed to enqueue host announcement emails for host ${hostId}: ${error}`)
      }
    }

    return {
      success: true,
      count,
      email: emailSummary
    }
  })

  /**
   * 管理员发送站内信给特定用户
   */
  fastify.post<{
    Params: { userId: string }
    Body: {
      title: string
      content: string
    }
  }>('/admin/send/:userId', async (request: FastifyRequest<{
    Params: { userId: string }
    Body: {
      title: string
      content: string
    }
  }>, reply: FastifyReply) => {
    // 检查管理员权限
    if (request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const targetUserId = parsePositiveId(request.params.userId)
    if (targetUserId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 检查目标用户是否存在
    const targetUser = await db.findUserById(targetUserId)
    if (!targetUser) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    // 不允许给自己发消息
    if (targetUserId === request.user.id) {
      return reply.code(400).send({ error: 'CANNOT_MESSAGE_SELF', message: 'Cannot send message to yourself' })
    }

    const messageInput = normalizeInboxMessageInput(request.body)
    if ('error' in messageInput) {
      return reply.code(400).send(messageInput.error)
    }

    // 创建消息
    await inboxDb.createInboxMessage({
      userId: targetUserId,
      eventType: 'admin_message',
      title: messageInput.title,
      content: messageInput.content,
      data: { senderId: request.user.id }
    })

    // 保存通知记录
    await announcementsDb.createAnnouncement({
      type: 'admin_message',
      senderId: request.user.id,
      title: messageInput.title,
      content: messageInput.content,
      recipientCount: 1,
      targetUserId,
    })

    return { success: true }
  })

  /**
   * 宿主机所有者发送站内信给特定实例用户
   */
  fastify.post<{
    Params: { instanceId: string }
    Body: {
      title: string
      content: string
    }
  }>('/instances/:instanceId/notify', async (request: FastifyRequest<{
    Params: { instanceId: string }
    Body: {
      title: string
      content: string
    }
  }>, reply: FastifyReply) => {
    const instanceId = parsePositiveId(request.params.instanceId)
    const userId = request.user.id

    if (instanceId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取实例信息
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 检查实例是否已删除
    if (instance.status === 'deleted') {
      return reply.code(400).send({ error: 'INSTANCE_DELETED', message: 'Instance has been deleted' })
    }

    // 获取宿主机信息
    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 检查是否是宿主机所有者或管理员
    if (host.user_id !== userId && request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 不允许给自己发消息
    if (instance.user_id === userId) {
      return reply.code(400).send({ error: 'CANNOT_MESSAGE_SELF', message: 'Cannot send message to yourself' })
    }

    const messageInput = normalizeInboxMessageInput(request.body)
    if ('error' in messageInput) {
      return reply.code(400).send(messageInput.error)
    }

    // 构建带节点署名的消息内容
    const messageContent = `${messageInput.content}\n\n来自节点：${host.name}`

    // 创建消息给实例用户
    await inboxDb.createInboxMessage({
      userId: instance.user_id,
      eventType: 'host_message',
      title: messageInput.title,
      content: messageContent,
      data: {
        hostId: host.id,
        hostName: host.name,
        instanceId: instance.id,
        instanceName: instance.name,
        senderId: userId
      }
    })

    // 保存通知记录
    await announcementsDb.createAnnouncement({
      type: 'host_message',
      senderId: userId,
      title: messageInput.title,
      content: messageInput.content,
      recipientCount: 1,
      hostId: host.id,
      targetUserId: instance.user_id,
      instanceId: instance.id,
    })

    return { success: true }
  })
}
