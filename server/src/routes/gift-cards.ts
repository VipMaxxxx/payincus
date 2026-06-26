/**
 * 礼品卡兑换码路由
 *
 * 管理员：
 *   POST   /api/gift-cards/admin/generate    — 生成单个兑换码
 *   POST   /api/gift-cards/admin/batch       — 批量生成
 *   GET    /api/gift-cards/admin/list        — 查看列表
 *   GET    /api/gift-cards/admin/stats       — 统计
 *   PATCH  /api/gift-cards/admin/:id/enable  — 启用
 *   PATCH  /api/gift-cards/admin/:id/disable — 禁用
 *   DELETE /api/gift-cards/admin/:id         — 删除
 *   POST   /api/gift-cards/admin/batch-disable — 批量禁用
 *   POST   /api/gift-cards/admin/batch-delete  — 批量删除
 *
 * 用户：
 *   POST   /api/gift-cards/user/redeem       — 兑换码充值
 *   POST   /api/gift-cards/user/generate     — 用余额生成兑换码
 *   GET    /api/gift-cards/user/mine         — 我的兑换码
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import * as giftCardDb from '../db/gift-cards.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { createTurnstileVerifier } from '../lib/turnstile.js'
import { getCombinedAdminIdAllowlist } from '../lib/runtime-settings.js'

const turnstileRequired = createTurnstileVerifier(true)

const GIFT_CARD_CODE_REGEX = /^gc-[A-Za-z0-9_-]{24}$/
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/

function parsePositiveId(value: string): number | null {
  if (!POSITIVE_ID_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveMoney(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const normalized = Math.round(value * 100) / 100
  return normalized > giftCardDb.GIFT_CARD_CONSTANTS.MAX_FACE_VALUE ? null : normalized
}

function parseClampedPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return fallback
  return Math.min(value, max)
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001F\u007F]/.test(trimmed)) return undefined
  return trimmed
}

function normalizeGiftCardCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return GIFT_CARD_CODE_REGEX.test(trimmed) ? trimmed : null
}

function normalizeStatus(value: unknown): 'active' | 'used' | 'disabled' | 'expired' | undefined {
  return value === 'active' || value === 'used' || value === 'disabled' || value === 'expired'
    ? value
    : undefined
}

function normalizeIdList(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > giftCardDb.GIFT_CARD_CONSTANTS.MAX_BATCH_COUNT) {
    return null
  }
  const ids = new Set<number>()
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0 || ids.has(item)) {
      return null
    }
    ids.add(item)
  }
  return Array.from(ids)
}

async function requireGiftCardManager(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.user
  if (!user || user.role !== 'admin') {
    return reply.code(403).send(apiError(ErrorCode.ADMIN_REQUIRED))
  }
  const { ids: allowedIds, configured } = await getCombinedAdminIdAllowlist(
    'payincus_gift_card_admin_ids',
    'PAYINCUS_GIFT_CARD_ADMIN_IDS'
  )
  const requiresAllowlist = configured || process.env.NODE_ENV === 'production'
  if (requiresAllowlist && !allowedIds.has(user.id)) {
    return reply.code(403).send(apiError(ErrorCode.FORBIDDEN, 'Gift card management requires gift card admin allowlist'))
  }
}

function mapGiftCardError(reply: FastifyReply, message: string) {
  if (message === 'GIFT_CARD_NOT_FOUND') {
    return reply.code(404).send(apiError(ErrorCode.GIFT_CARD_NOT_FOUND))
  }
  if (message === 'GIFT_CARD_USED') {
    return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_USED))
  }
  if (message === 'GIFT_CARD_ALREADY_USED_BY_USER') {
    return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_ALREADY_USED_BY_USER))
  }
  if (message === 'GIFT_CARD_SELF_REDEEM') {
    return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_SELF_REDEEM))
  }
  if (message === 'GIFT_CARD_EXPIRED') {
    return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_EXPIRED))
  }
  if (message === 'GIFT_CARD_DISABLED') {
    return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_DISABLED))
  }
  if (message === 'GIFT_CARD_INSUFFICIENT_BALANCE') {
    return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_INSUFFICIENT_BALANCE))
  }
  if (message === 'GIFT_CARD_BATCH_TOO_LARGE') {
    return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_BATCH_TOO_LARGE))
  }
  return null
}

export default async function giftCardsRoutes(fastify: FastifyInstance) {
  // ==================== 管理员 ====================

  // 生成单个兑换码
  fastify.post('/admin/generate', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, requireGiftCardManager],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['faceValue'],
        properties: {
          faceValue: { type: 'number', minimum: 0.01, maximum: 10000 },
          balanceValue: { type: 'number', minimum: 0.01, maximum: 10000 },
          expiresAt: { type: ['string', 'null'] },
          remark: { type: 'string', maxLength: 200 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const body = request.body as Record<string, unknown>

    const faceValue = parsePositiveMoney(body.faceValue)
    if (faceValue === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid face value'))
    }

    const balanceValue = body.balanceValue !== undefined
      ? parsePositiveMoney(body.balanceValue)
      : faceValue
    if (balanceValue === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid balance value'))
    }

    const expiresAtRaw = normalizeOptionalString(body.expiresAt, 64)
    let expiresAt: Date | null = null
    if (expiresAtRaw) {
      const d = new Date(expiresAtRaw)
      if (Number.isNaN(d.getTime())) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid expiry date'))
      }
      expiresAt = d
    }

    const remark = normalizeOptionalString(body.remark, 200)

    try {
      const giftCard = await giftCardDb.createGiftCard({
        faceValue,
        balanceValue: balanceValue ?? faceValue,
        createdById: user.id,
        expiresAt,
        remark
      })

      await createLog(user.id, 'gift_card', 'admin_generate',
        `Generated gift card ${giftCard.code.substring(0, 10)}..., face=${faceValue} balance=${balanceValue ?? faceValue}`,
        'success')

      return reply.code(201).send({ giftCard })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, msg))
    }
  })

  // 批量生成兑换码
  fastify.post('/admin/batch', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, requireGiftCardManager],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['faceValue', 'count'],
        properties: {
          faceValue: { type: 'number', minimum: 0.01, maximum: 10000 },
          balanceValue: { type: 'number', minimum: 0.01, maximum: 10000 },
          count: { type: 'integer', minimum: 1, maximum: 500 },
          expiresAt: { type: ['string', 'null'] },
          remark: { type: 'string', maxLength: 200 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const body = request.body as Record<string, unknown>

    const faceValue = parsePositiveMoney(body.faceValue)
    if (faceValue === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid face value'))
    }

    const balanceValue = body.balanceValue !== undefined
      ? parsePositiveMoney(body.balanceValue)
      : faceValue
    if (balanceValue === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid balance value'))
    }

    const count = parseClampedPositiveInteger(body.count, 1, giftCardDb.GIFT_CARD_CONSTANTS.MAX_BATCH_COUNT)

    const expiresAtRaw = normalizeOptionalString(body.expiresAt, 64)
    let expiresAt: Date | null = null
    if (expiresAtRaw) {
      const d = new Date(expiresAtRaw)
      if (Number.isNaN(d.getTime())) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid expiry date'))
      }
      expiresAt = d
    }

    const remark = normalizeOptionalString(body.remark, 200)

    try {
      const result = await giftCardDb.createGiftCardBatch(count, {
        faceValue,
        balanceValue: balanceValue ?? faceValue,
        createdById: user.id,
        expiresAt,
        remark
      })

      await createLog(user.id, 'gift_card', 'admin_batch_generate',
        `Batch generated ${result.count} gift cards (${result.batchId}), face=${faceValue}`,
        'success')

      return reply.code(201).send({
        batchId: result.batchId,
        count: result.count,
        codes: result.codes.map(c => ({
          id: c.id,
          code: c.code,
          faceValue: Number(c.faceValue),
          balanceValue: Number(c.balanceValue)
        }))
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, msg))
    }
  })

  // 管理员列表
  fastify.get('/admin/list', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, requireGiftCardManager],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['active', 'used', 'disabled', 'expired'] },
          batchId: { type: 'string' },
          revealCode: { type: 'boolean', default: false }
        }
      }
    }
  }, async (request) => {
    const query = request.query as Record<string, unknown>
    return giftCardDb.listGiftCardsByAdmin({
      page: parseClampedPositiveInteger(query.page, 1, 999999),
      pageSize: parseClampedPositiveInteger(query.pageSize, 20, 100),
      status: normalizeStatus(query.status),
      batchId: normalizeOptionalString(query.batchId, 64),
      revealCode: query.revealCode === true
    })
  })

  // 管理员统计
  fastify.get('/admin/stats', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, requireGiftCardManager]
  }, async () => {
    return giftCardDb.getGiftCardStats()
  })

  // 启用兑换码
  fastify.patch('/admin/:id/enable', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, requireGiftCardManager],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id: string }).id)
    if (id === null) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const result = await giftCardDb.enableGiftCard(id)
    if (result.count === 0) return reply.code(404).send(apiError(ErrorCode.GIFT_CARD_NOT_FOUND))
    return { success: true }
  })

  // 禁用兑换码
  fastify.patch('/admin/:id/disable', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, requireGiftCardManager],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id: string }).id)
    if (id === null) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const result = await giftCardDb.disableGiftCard(id)
    if (result.count === 0) return reply.code(404).send(apiError(ErrorCode.GIFT_CARD_NOT_FOUND))
    return { success: true }
  })

  // 删除兑换码
  fastify.delete('/admin/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, requireGiftCardManager],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id: string }).id)
    if (id === null) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const result = await giftCardDb.deleteGiftCard(id)
    if (result.count === 0) return reply.code(404).send(apiError(ErrorCode.GIFT_CARD_NOT_FOUND))
    return { success: true }
  })

  // 批量禁用
  fastify.post('/admin/batch-disable', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, requireGiftCardManager],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const body = request.body as { ids: number[] }
    const ids = normalizeIdList(body.ids)
    if (!ids) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid ids'))
    }
    const result = await giftCardDb.batchDisableGiftCards(ids)
    return { success: true, count: result.count }
  })

  // 批量删除
  fastify.post('/admin/batch-delete', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, requireGiftCardManager],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const body = request.body as { ids: number[] }
    const ids = normalizeIdList(body.ids)
    if (!ids) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid ids'))
    }
    const result = await giftCardDb.batchDeleteGiftCards(ids)
    return { success: true, count: result.count }
  })

  // ==================== 用户 ====================

  // 兑换码充值
  fastify.post('/user/redeem', {
    onRequest: [fastify.authenticate],
    preHandler: [turnstileRequired],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 64 },
          turnstileToken: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const body = request.body as { code: string }

    const code = normalizeGiftCardCode(body.code)
    if (!code) {
      return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_INVALID_CODE))
    }

    try {
      const result = await giftCardDb.redeemGiftCard(code, user.id)

      await createLog(user.id, 'gift_card', 'redeem',
        `Redeemed gift card ${code.substring(0, 10)}..., +${result.balanceValue}`,
        'success')

      return {
        success: true,
        amount: result.balanceValue,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const mapped = mapGiftCardError(reply, msg)
      if (mapped) return mapped

      await createLog(user.id, 'gift_card', 'redeem.failed',
        `Failed redemption of ${code.substring(0, 10)}...: ${msg}`, 'failed')
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, msg))
    }
  })

  // 用户用余额生成兑换码
  fastify.post('/user/generate', {
    onRequest: [fastify.authenticate],
    preHandler: [turnstileRequired],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['faceValue'],
        properties: {
          faceValue: { type: 'number', minimum: 0.01, maximum: 10000 },
          remark: { type: 'string', maxLength: 200 },
          turnstileToken: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const body = request.body as Record<string, unknown>

    const faceValue = parsePositiveMoney(body.faceValue)
    if (faceValue === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid face value'))
    }

    const remark = normalizeOptionalString(body.remark, 200)

    try {
      const result = await giftCardDb.generateGiftCardFromBalance({
        userId: user.id,
        faceValue,
        remark
      })

      await createLog(user.id, 'gift_card', 'user_generate',
        `Generated gift card ${result.giftCard.code.substring(0, 10)}..., face=${faceValue}`,
        'success')

      return reply.code(201).send({
        giftCard: {
          ...result.giftCard,
          faceValue: Number(result.giftCard.faceValue),
          balanceValue: Number(result.giftCard.balanceValue)
        },
        newBalance: result.balanceAfter
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const mapped = mapGiftCardError(reply, msg)
      if (mapped) return mapped
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, msg))
    }
  })

  // 用户查看自己的兑换码
  fastify.get('/user/mine', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['active', 'used', 'disabled', 'expired'] }
        }
      }
    }
  }, async (request) => {
    const { user } = request
    const query = request.query as Record<string, unknown>
    return giftCardDb.listGiftCardsByUser(user.id, {
      page: parseClampedPositiveInteger(query.page, 1, 999999),
      pageSize: parseClampedPositiveInteger(query.pageSize, 20, 100),
      status: normalizeStatus(query.status)
    })
  })
}
