/**
 * 管理员全局通知渠道管理路由
 * 管理员可以创建全局 Telegram 通知渠道，供所有托管用户绑定使用
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { testNotificationChannel } from '../lib/notifier.js'
import type { NotificationChannel } from '../types/database.js'

const telegramBotTokenPattern = /^[1-9]\d{5,19}:[A-Za-z0-9_-]{20,}$/
const telegramChatIdPattern = /^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/
const maskedTelegramBotTokenPattern = /^.{1,20}\.\.\..{1,20}$/
const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function normalizeGlobalTelegramChannelInput(input: {
  name?: string
  botToken?: string
  chatId?: string
}): { valid: true; value: { name?: string; botToken?: string; chatId?: string } } | { valid: false; error: string } {
  const value: { name?: string; botToken?: string; chatId?: string } = {}

  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name || name.length > 50) {
      return { valid: false, error: 'Channel name must be 1-50 characters' }
    }
    value.name = name
  }

  if (input.botToken !== undefined) {
    const botToken = input.botToken.trim()
    if (!botToken || maskedTelegramBotTokenPattern.test(botToken) || !telegramBotTokenPattern.test(botToken)) {
      return { valid: false, error: 'Invalid Bot Token format' }
    }
    value.botToken = botToken
  }

  if (input.chatId !== undefined) {
    const chatId = input.chatId.trim()
    if (!telegramChatIdPattern.test(chatId)) {
      return { valid: false, error: 'Invalid Telegram Chat ID format' }
    }
    value.chatId = chatId
  }

  return { valid: true, value }
}

export default async function adminNotificationChannelsRoutes(fastify: FastifyInstance) {

  // 获取所有全局通知渠道（管理员视角，含完整信息）
  fastify.get('/', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const channels = await prisma.notificationChannel.findMany({
      where: { isGlobal: true } as any,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        type: true,
        config: true,
        enabled: true,
        createdAt: true,
        _count: { select: { packages: true } }
      } as any
    }) as unknown as Array<{
      id: number; name: string; type: string; config: unknown; enabled: boolean; createdAt: Date;
      _count: { packages: number }
    }>

    return {
      channels: channels.map(c => {
        const config = typeof c.config === 'string' ? JSON.parse(c.config) : c.config as Record<string, unknown>
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          enabled: c.enabled,
          boundPackages: c._count.packages,
          configPreview: getTelegramPreview(config),
          createdAt: c.createdAt
        }
      })
    }
  })

  // 获取单个全局渠道详情（含 botToken 掩码）
  fastify.get<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const channelId = parsePositiveRouteId(request.params.id)
    if (!channelId) return reply.code(400).send({ error: 'Invalid ID' })

    const channel = await prisma.notificationChannel.findFirst({
      where: { id: channelId, isGlobal: true } as any
    })
    if (!channel) return reply.code(404).send({ error: 'Channel not found' })

    const config = typeof channel.config === 'string' ? JSON.parse(channel.config) : channel.config as Record<string, unknown>

    return {
      channel: {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        enabled: channel.enabled,
        config: maskBotToken(config),
        createdAt: channel.createdAt
      }
    }
  })

  // 创建全局 Telegram 通知渠道
  fastify.post<{
    Body: { name: string; botToken: string; chatId: string; enabled?: boolean }
  }>('/', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'botToken', 'chatId'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 50 },
          botToken: { type: 'string', minLength: 1 },
          chatId: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (
    request: FastifyRequest<{ Body: { name: string; botToken: string; chatId: string; enabled?: boolean } }>,
    reply: FastifyReply
  ) => {
    const { enabled = true } = request.body
    const normalized = normalizeGlobalTelegramChannelInput(request.body)
    if (!normalized.valid || !normalized.value.name || !normalized.value.botToken || !normalized.value.chatId) {
      return reply.code(400).send({ error: normalized.valid ? 'Please provide channel name, Bot Token, and Chat ID' : normalized.error })
    }
    const { name, botToken, chatId } = normalized.value

    const channel = await prisma.notificationChannel.create({
      data: {
        userId: request.user.id,
        type: 'telegram',
        name,
        config: { botToken, chatId },
        enabled,
        isGlobal: true
      } as any
    })

    await createLog(request.user.id, 'notification', 'admin.global_channel.create',
      `Created global TG channel "${name}" (chatId: ${chatId})`, 'success')

    return reply.code(201).send({
      message: 'Global notification channel created',
      channel: { id: channel.id, name, type: 'telegram', enabled }
    })
  })

  // 更新全局通知渠道
  fastify.patch<{
    Params: { id: string }
    Body: { name?: string; botToken?: string; chatId?: string; enabled?: boolean }
  }>('/:id', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 50 },
          botToken: { type: 'string', minLength: 1 },
          chatId: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (
    request: FastifyRequest<{ Params: { id: string }; Body: { name?: string; botToken?: string; chatId?: string; enabled?: boolean } }>,
    reply: FastifyReply
  ) => {
    const channelId = parsePositiveRouteId(request.params.id)
    if (!channelId) return reply.code(400).send({ error: 'Invalid ID' })

    const existing = await prisma.notificationChannel.findFirst({
      where: { id: channelId, isGlobal: true } as any
    })
    if (!existing) return reply.code(404).send({ error: 'Channel not found' })

    const { enabled } = request.body
    const normalized = normalizeGlobalTelegramChannelInput(request.body)
    if (!normalized.valid) {
      return reply.code(400).send({ error: normalized.error })
    }
    const { name, botToken, chatId } = normalized.value
    const existingConfig = typeof existing.config === 'string' ? JSON.parse(existing.config) : existing.config as Record<string, unknown>

    // Merge config
    const newConfig = {
      botToken: botToken || existingConfig.botToken,
      chatId: chatId || existingConfig.chatId
    }

    await prisma.notificationChannel.update({
      where: { id: channelId },
      data: {
        ...(name !== undefined && { name }),
        ...(enabled !== undefined && { enabled }),
        ...(botToken || chatId ? { config: newConfig } : {})
      }
    })

    await createLog(request.user.id, 'notification', 'admin.global_channel.update',
      `Updated global TG channel "${existing.name}"`, 'success')

    return { message: 'Channel updated' }
  })

  // 删除全局通知渠道
  fastify.delete<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const channelId = parsePositiveRouteId(request.params.id)
    if (!channelId) return reply.code(400).send({ error: 'Invalid ID' })

    const channel = await prisma.notificationChannel.findFirst({
      where: { id: channelId, isGlobal: true } as any
    })
    if (!channel) return reply.code(404).send({ error: 'Channel not found' })

    await prisma.notificationChannel.delete({ where: { id: channelId } })

    await createLog(request.user.id, 'notification', 'admin.global_channel.delete',
      `Deleted global TG channel "${channel.name}"`, 'success')

    return { message: 'Channel deleted' }
  })

  // 发送测试消息
  fastify.post<{ Params: { id: string } }>('/:id/test', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const channelId = parsePositiveRouteId(request.params.id)
    if (!channelId) return reply.code(400).send({ error: 'Invalid ID' })

    const channel = await prisma.notificationChannel.findFirst({
      where: { id: channelId, isGlobal: true } as any
    })
    if (!channel) return reply.code(404).send({ error: 'Channel not found' })

    const result = await testNotificationChannel(channel as unknown as NotificationChannel)

    if (result.success) {
      return { message: 'Test notification sent successfully' }
    } else {
      return reply.code(400).send({ error: 'Test failed: ' + result.error })
    }
  })
}

/**
 * 获取 Telegram 渠道的 Chat ID 预览
 */
function getTelegramPreview(config: Record<string, unknown>): string {
  return `Chat ID: ${config.chatId || 'Not set'}`
}

/**
 * 掩码 Bot Token（保留前后部分）
 */
function maskBotToken(config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config }
  if (typeof masked.botToken === 'string' && masked.botToken) {
    masked.botToken = masked.botToken.slice(0, 8) + '...' + masked.botToken.slice(-5)
  }
  return masked
}
