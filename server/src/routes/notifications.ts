/**
 * 通知渠道管理路由
 * 用户可以添加、管理通知渠道（Telegram、Discord、Webhook等）
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { testNotificationChannel } from '../lib/notifier.js'
import type { NotificationChannel } from '../types/database.js'
import { assertSafeWebhookUrl, OutboundTargetValidationError } from '../lib/outbound-security.js'

export default async function notificationRoutes(fastify: FastifyInstance) {
  async function validateOutboundConfig(
    type: 'telegram' | 'discord' | 'webhook' | 'email',
    config: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> {
    if (type !== 'webhook' || typeof config.url !== 'string') {
      return { valid: true }
    }

    try {
      await assertSafeWebhookUrl(config.url)
      return { valid: true }
    } catch (error) {
      if (error instanceof OutboundTargetValidationError) {
        return { valid: false, error: error.message }
      }
      throw error
    }
  }

  // 获取用户的通知渠道列表
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const channels = await db.getNotificationChannelsByUserId(request.user.id)

    return {
      channels: channels.map(c => ({
        id: c.id,
        type: c.type,
        name: c.name,
        enabled: Boolean(c.enabled),
        // 隐藏敏感配置信息
        configPreview: getConfigPreview(c.type, c.config),
        createdAt: c.created_at
      }))
    }
  })

  // 获取单个通知渠道详情
  fastify.get<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const channelId = Number(id)

    if (isNaN(channelId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const channel = await db.getNotificationChannelById(channelId)
    if (!channel) {
      return reply.code(404).send(apiError(ErrorCode.NOTIFICATION_CHANNEL_NOT_FOUND))
    }

    // 管理员只管理系统层面，不参与用户通知渠道操作
    if (channel.user_id !== request.user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const config = typeof channel.config === 'string'
      ? JSON.parse(channel.config)
      : channel.config

    return {
      channel: {
        id: channel.id,
        type: channel.type,
        name: channel.name,
        config: maskSensitiveConfig(channel.type, config as Record<string, unknown>),
        enabled: Boolean(channel.enabled),
        createdAt: channel.created_at
      }
    }
  })

  // 添加通知渠道
  fastify.post<{ Body: { type: 'telegram' | 'discord' | 'webhook' | 'email'; name: string; config: Record<string, unknown>; enabled?: boolean } }>('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['type', 'name', 'config'],
        properties: {
          type: { type: 'string', enum: ['telegram', 'discord', 'webhook', 'email'] },
          name: { type: 'string', minLength: 1, maxLength: 50 },
          config: { type: 'object' },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { type: 'telegram' | 'discord' | 'webhook' | 'email'; name: string; config: Record<string, unknown>; enabled?: boolean } }>, reply: FastifyReply) => {
    const { type, name, config, enabled = true } = request.body

    // 验证配置
    const validation = validateConfig(type, config)
    if (!validation.valid) {
      return reply.code(400).send({ error: validation.error })
    }

    const outboundValidation = await validateOutboundConfig(type, config)
    if (!outboundValidation.valid) {
      return reply.code(400).send({ error: outboundValidation.error })
    }

    // 保存到数据库
    const channelId = await db.createNotificationChannel({
      userId: request.user.id,
      type,
      name,
      config,
      enabled
    })

    await createLog(request.user.id, 'notification', 'notification.add', `Added ${type} notification channel "${name}"`, 'success')

    reply.code(201).send({
      message: 'Notification channel added',
      channel: {
        id: channelId,
        type,
        name,
        enabled
      }
    })
  })

  // 更新通知渠道
  fastify.patch<{
    Params: { id: string }
    Body: { name?: string; config?: Record<string, unknown>; enabled?: boolean }
  }>('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 50 },
          config: { type: 'object' },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { name?: string; config?: Record<string, unknown>; enabled?: boolean }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const channelId = Number(id)

    if (isNaN(channelId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { name, config, enabled } = request.body

    const channel = await db.getNotificationChannelById(channelId)
    if (!channel) {
      return reply.code(404).send(apiError(ErrorCode.NOTIFICATION_CHANNEL_NOT_FOUND))
    }

    // 管理员只管理系统层面，不参与用户通知渠道操作
    if (channel.user_id !== request.user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 如果更新配置，验证配置
    if (config) {
      const validation = validateConfig(channel.type, config)
      if (!validation.valid) {
        return reply.code(400).send({ error: validation.error })
      }

      const outboundValidation = await validateOutboundConfig(channel.type, config)
      if (!outboundValidation.valid) {
        return reply.code(400).send({ error: outboundValidation.error })
      }
    }

    await db.updateNotificationChannel(channelId, { name, config, enabled })

    // 构建变更详情
    const changes: string[] = []
    if (name !== undefined) changes.push(`name -> "${name}"`)
    if (config !== undefined) changes.push('config updated')
    if (enabled !== undefined) changes.push(`enabled -> ${enabled}`)

    await createLog(
      request.user.id,
      'notification',
      'notification.update',
      `Updated ${channel.type} notification channel "${channel.name}": ${changes.join(', ')}`,
      'success'
    )

    return { message: 'Notification channel updated' }
  })

  // 删除通知渠道
  fastify.delete<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const channelId = Number(id)

    if (isNaN(channelId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const channel = await db.getNotificationChannelById(channelId)
    if (!channel) {
      return reply.code(404).send(apiError(ErrorCode.NOTIFICATION_CHANNEL_NOT_FOUND))
    }

    // 管理员只管理系统层面，不参与用户通知渠道操作
    if (channel.user_id !== request.user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    await db.deleteNotificationChannel(channelId)

    await createLog(request.user.id, 'notification', 'notification.delete', `Deleted ${channel.type} notification channel "${channel.name}"`, 'success')

    return { message: 'Notification channel deleted' }
  })

  // 测试通知渠道
  fastify.post<{ Params: { id: string } }>('/:id/test', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const channelId = Number(id)

    if (isNaN(channelId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const channel = await db.getNotificationChannelById(channelId)
    if (!channel) {
      return reply.code(404).send(apiError(ErrorCode.NOTIFICATION_CHANNEL_NOT_FOUND))
    }

    // 管理员只管理系统层面，不参与用户通知渠道操作
    if (channel.user_id !== request.user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const result = await testNotificationChannel(channel as NotificationChannel)

    if (result.success) {
      return { message: 'Test notification sent' }
    } else {
      return reply.code(400).send({ error: 'Test failed: ' + result.error, code: 'TEST_FAILED' })
    }
  })

  // 切换启用/禁用
  fastify.post<{ Params: { id: string } }>('/:id/toggle', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const channelId = Number(id)

    if (isNaN(channelId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const channel = await db.getNotificationChannelById(channelId)
    if (!channel) {
      return reply.code(404).send(apiError(ErrorCode.NOTIFICATION_CHANNEL_NOT_FOUND))
    }

    // 管理员只管理系统层面，不参与用户通知渠道操作
    if (channel.user_id !== request.user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const newEnabled = !channel.enabled
    await db.updateNotificationChannel(channelId, { enabled: newEnabled })

    await createLog(
      request.user.id,
      'notification',
      newEnabled ? 'notification.enable' : 'notification.disable',
      `${newEnabled ? 'Enabled' : 'Disabled'} ${channel.type} notification channel "${channel.name}"`,
      'success'
    )

    return {
      message: newEnabled ? 'Notification channel enabled' : 'Notification channel disabled',
      enabled: newEnabled
    }
  })

  // 获取通知历史记录
  fastify.get<{
    Querystring: { page?: string; pageSize?: string; status?: 'pending' | 'sent' | 'failed' }
  }>('/logs', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { page?: string; pageSize?: string; status?: 'pending' | 'sent' | 'failed' }
  }>) => {
    const page = parseInt(request.query.page || '1', 10)
    const pageSize = Math.min(parseInt(request.query.pageSize || '20', 10), 100)
    const status = request.query.status

    const result = await db.getNotificationLogsByUserId(request.user.id, {
      page,
      pageSize,
      status
    })

    return result
  })

  // 获取通知统计
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const stats = await db.getNotificationStats(request.user.id)
    return { stats }
  })

  // 获取所有全局通知渠道（托管用户用于绑定套餐）
  fastify.get('/global-channels', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const { prisma } = await import('../db/prisma.js')
    const channels = await prisma.notificationChannel.findMany({
      where: { isGlobal: true, enabled: true } as any,
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, type: true, config: true }
    })
    return {
      channels: channels.map(c => {
        const config = typeof c.config === 'string' ? JSON.parse(c.config) : c.config as Record<string, unknown>
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          configPreview: `Chat ID: ${config.chatId || 'N/A'}`
        }
      })
    }
  })
}

/**
 * 验证配置
 */
function validateConfig(
  type: 'telegram' | 'discord' | 'webhook' | 'email',
  config: Record<string, unknown>
): { valid: boolean; error?: string } {
  switch (type) {
    case 'telegram':
      if (!config.botToken || !config.chatId) {
        return { valid: false, error: 'Please provide Bot Token and Chat ID' }
      }
      break
    case 'discord':
      if (!config.webhookUrl || typeof config.webhookUrl !== 'string') {
        return { valid: false, error: 'Please provide Discord Webhook URL' }
      }
      if (!config.webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        return { valid: false, error: 'Invalid Discord Webhook URL' }
      }
      break
    case 'webhook':
      if (!config.url || typeof config.url !== 'string') {
        return { valid: false, error: 'Please provide Webhook URL' }
      }
      if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
        return { valid: false, error: 'Invalid Webhook URL' }
      }
      break
    case 'email':
      if (!config.email) {
        return { valid: false, error: 'Please provide email address' }
      }
      break
  }

  return { valid: true }
}

/**
 * 获取配置预览（隐藏敏感信息）
 */
function getConfigPreview(type: string, configStr: string | Record<string, unknown>): string {
  try {
    const config = typeof configStr === 'string' ? JSON.parse(configStr) : configStr as Record<string, unknown>

    switch (type) {
      case 'telegram':
        return `Chat ID: ${config.chatId || 'Not set'}`
      case 'discord':
        return typeof config.webhookUrl === 'string' && config.webhookUrl
          ? `Webhook: ...${config.webhookUrl.slice(-20)}`
          : 'Not set'
      case 'webhook':
        if (typeof config.url === 'string' && config.url) {
          try {
            return `URL: ${new URL(config.url).hostname}`
          } catch {
            return 'URL: Invalid'
          }
        }
        return 'Not set'
      case 'email':
        return typeof config.email === 'string' ? config.email : 'Not set'
      default:
        return 'Unknown type'
    }
  } catch {
    return 'Config error'
  }
}

/**
 * 隐藏敏感配置信息
 */
function maskSensitiveConfig(
  type: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  const masked = { ...config }

  switch (type) {
    case 'telegram':
      if (typeof masked.botToken === 'string' && masked.botToken) {
        masked.botToken = masked.botToken.slice(0, 10) + '...' + masked.botToken.slice(-5)
      }
      break
    case 'discord':
      if (typeof masked.webhookUrl === 'string' && masked.webhookUrl) {
        masked.webhookUrl = masked.webhookUrl.slice(0, 50) + '...'
      }
      break
    case 'webhook':
      if (masked.secret) {
        masked.secret = '***已设置***'
      }
      break
  }

  return masked
}

