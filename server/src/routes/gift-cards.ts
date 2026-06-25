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

import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import * as giftCardDb from '../db/gift-cards.js'
import { createLog } from '../db/logs.js'
import { prisma } from '../db/prisma.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { createTurnstileVerifier } from '../lib/turnstile.js'

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
  return Math.round(value * 100) / 100
}

function parseClampedPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return fallback
  return Math.min(value, max)
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return undefined
  return trimmed
}

function normalizeGiftCardCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return GIFT_CARD_CODE_REGEX.test(trimmed) ? trimmed : null
}

export default async function giftCardsRoutes(fastify: FastifyInstance) {
  // ==================== 管理员 ====================

  // 生成单个兑换码
  fastify.post('/admin/generate', {
    onRequest: [fastify.authenticate, fastify.requireAdmin, turnstileRequired],
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
    onRequest: [fastify.authenticate, fastify.requireAdmin, turnstileRequired],
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

    const count = parseClampedPositiveInteger(body.count, 1, 500)

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
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['active', 'used', 'disabled', 'expired'] },
          batchId: { type: 'string' }
        }
      }
    }
  }, async (request) => {
    const query = request.query as Record<string, unknown>
    return giftCardDb.listGiftCardsByAdmin({
      page: parseClampedPositiveInteger(query.page, 1, 999999),
      pageSize: parseClampedPositiveInteger(query.pageSize, 20, 100),
      status: query.status as 'active' | 'used' | 'disabled' | 'expired' | undefined,
      batchId: normalizeOptionalString(query.batchId, 64)
    })
  })

  // 管理员统计
  fastify.get('/admin/stats', {
    onRequest: [fastify.authenticate, fastify.requireAdmin]
  }, async () => {
    return giftCardDb.getGiftCardStats()
  })

  // 启用兑换码
  fastify.patch('/admin/:id/enable', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
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
    onRequest: [fastify.authenticate, fastify.requireAdmin],
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
    onRequest: [fastify.authenticate, fastify.requireAdmin],
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
    onRequest: [fastify.authenticate, fastify.requireAdmin],
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
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 500) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid ids'))
    }
    const result = await giftCardDb.batchDisableGiftCards(body.ids)
    return { success: true, count: result.count }
  })

  // 批量删除
  fastify.post('/admin/batch-delete', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
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
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 500) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid ids'))
    }
    const result = await giftCardDb.batchDeleteGiftCards(body.ids)
    return { success: true, count: result.count }
  })

  // ==================== 用户 ====================

  // 兑换码充值
  fastify.post('/user/redeem', {
    onRequest: [fastify.authenticate, turnstileRequired],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 64 }
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

      if (msg === 'GIFT_CARD_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.GIFT_CARD_NOT_FOUND))
      }
      if (msg === 'GIFT_CARD_USED') {
        return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_USED))
      }
      if (msg === 'GIFT_CARD_ALREADY_USED_BY_USER') {
        return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_ALREADY_USED_BY_USER))
      }
      if (msg === 'GIFT_CARD_EXPIRED') {
        return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_EXPIRED))
      }
      if (msg === 'GIFT_CARD_DISABLED') {
        return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_DISABLED))
      }

      await createLog(user.id, 'gift_card', 'redeem.failed',
        `Failed redemption of ${code.substring(0, 10)}...: ${msg}`, 'failed')
      return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, msg))
    }
  })

  // 用户用余额生成兑换码
  fastify.post('/user/generate', {
    onRequest: [fastify.authenticate, turnstileRequired],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['faceValue'],
        properties: {
          faceValue: { type: 'number', minimum: 0.01, maximum: 10000 },
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

    const remark = normalizeOptionalString(body.remark, 200)

    try {
      const result = await prisma.$transaction(async (tx) => {
        const currentUser = await tx.user.findUnique({
          where: { id: user.id },
          select: { balance: true }
        })

        if (!currentUser || Number(currentUser.balance) < faceValue) {
          throw new Error('GIFT_CARD_INSUFFICIENT_BALANCE')
        }

        const balanceBefore = Number(currentUser.balance)
        const balanceAfter = balanceBefore - faceValue

        await tx.user.update({
          where: { id: user.id },
          data: { balance: { decrement: faceValue } }
        })

        await tx.balanceLog.create({
          data: {
            userId: user.id,
            type: 'consume',
            amount: -faceValue,
            balanceBefore,
            balanceAfter,
            remark: remark || 'Generate gift card'
          }
        })

        const giftCard = await tx.giftCard.create({
          data: {
            code: generateCode(),
            faceValue,
            balanceValue: faceValue,
            status: 'active',
            createdById: user.id,
            ownerId: user.id,
            remark: remark || `User generated gift card`
          },
          select: { id: true, code: true, faceValue: true, balanceValue: true }
        })

        return { giftCard, balanceBefore, balanceAfter }
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
      if (msg === 'GIFT_CARD_INSUFFICIENT_BALANCE') {
        return reply.code(400).send(apiError(ErrorCode.GIFT_CARD_INSUFFICIENT_BALANCE))
      }
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
      status: query.status as 'active' | 'used' | 'disabled' | 'expired' | undefined
    })
  })
}

function generateCode(): string {
  const encoded = crypto.randomBytes(16).toString('base64url')
  return 'gc-' + encoded.substring(0, 24)
}
