import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PluginDeveloperWithdrawalStatus } from '@prisma/client'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import {
  PLUGIN_DEVELOPER_WITHDRAWAL_MIN_CENTS,
  PluginTradeError,
  createDeveloperWithdrawal,
  getDeveloperEarnings,
  hasActivePluginLicense,
  listDeveloperWithdrawals,
  purchasePlugin,
  refundPluginPurchase,
  reviewDeveloperWithdrawal,
  serializeWithdrawal
} from '../services/plugin-trade.js'

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/
const PAYOUT_METHOD_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/
const WITHDRAWAL_STATUSES = new Set<PluginDeveloperWithdrawalStatus>(['pending', 'completed', 'rejected'])

function requestUser(request: FastifyRequest): { id: number; username: string; role: 'admin' | 'user' } {
  return request.user as { id: number; username: string; role: 'admin' | 'user' }
}

function positiveRouteId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

function sendTradeError(reply: FastifyReply, error: unknown) {
  if (error instanceof PluginTradeError) {
    return reply.code(error.statusCode).send({ error: error.message, code: error.code })
  }
  throw error
}

export default async function pluginTradeRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Body: { pluginId: string; version: string; idempotencyKey: string }
  }>('/purchases', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['pluginId', 'version', 'idempotencyKey'],
        additionalProperties: false,
        properties: {
          pluginId: { type: 'string', minLength: 5, maxLength: 120 },
          version: { type: 'string', minLength: 1, maxLength: 64 },
          idempotencyKey: { type: 'string', minLength: 8, maxLength: 120 }
        }
      }
    }
  }, async (request, reply) => {
    const { pluginId, version, idempotencyKey } = request.body
    if (!PLUGIN_ID_PATTERN.test(pluginId) || !VERSION_PATTERN.test(version) || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return reply.code(400).send({ error: 'Invalid plugin purchase input', code: 'PLUGIN_PURCHASE_INPUT_INVALID' })
    }
    const user = requestUser(request)
    try {
      const purchase = await purchasePlugin({ userId: user.id, pluginId, version, idempotencyKey })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'plugin.trade.purchase',
        `Purchased plugin ${pluginId}@${version}; trade=${purchase.tradeNo}; gross=${purchase.grossCents}; fee=${purchase.platformFeeCents}; net=${purchase.netCents}; currency=${purchase.currency}`,
        LogResult.SUCCESS
      )
      return reply.code(201).send({ purchase })
    } catch (error) {
      return sendTradeError(reply, error)
    }
  })

  fastify.get<{ Params: { pluginId: string; version: string } }>('/licenses/:pluginId/:version', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const { pluginId, version } = request.params
    if (!PLUGIN_ID_PATTERN.test(pluginId) || !VERSION_PATTERN.test(version)) {
      return reply.code(400).send({ error: 'Invalid plugin license input', code: 'PLUGIN_LICENSE_INPUT_INVALID' })
    }
    return { licensed: await hasActivePluginLicense(requestUser(request).id, pluginId, version), pluginId, version }
  })

  fastify.post<{
    Params: { id: string }
    Body: { reason?: string }
  }>('/purchases/:id/refund', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { reason: { type: 'string', maxLength: 500 } }
      }
    }
  }, async (request, reply) => {
    const purchaseId = positiveRouteId(request.params.id)
    if (!purchaseId) return reply.code(400).send({ error: 'Invalid purchase id', code: 'PLUGIN_PURCHASE_ID_INVALID' })
    const user = requestUser(request)
    try {
      const result = await refundPluginPurchase({ userId: user.id, purchaseId, reason: request.body?.reason })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'plugin.trade.refund',
        `Refunded plugin purchase #${purchaseId}; amount=${result.refund.amountCents}; currency=${result.refund.currency}; idempotent=${result.idempotent}`,
        LogResult.SUCCESS
      )
      return { refund: result.refund, idempotent: result.idempotent }
    } catch (error) {
      return sendTradeError(reply, error)
    }
  })

  fastify.get<{ Querystring: { currency?: string } }>('/developer/earnings', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    try {
      return await getDeveloperEarnings(requestUser(request).id, request.query.currency)
    } catch (error) {
      return sendTradeError(reply, error)
    }
  })

  fastify.post<{
    Body: {
      amountCents: number
      currency: string
      payoutMethod: string
      payoutTarget: string
      idempotencyKey: string
    }
  }>('/developer/withdrawals', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['amountCents', 'currency', 'payoutMethod', 'payoutTarget', 'idempotencyKey'],
        additionalProperties: false,
        properties: {
          amountCents: { type: 'integer', minimum: PLUGIN_DEVELOPER_WITHDRAWAL_MIN_CENTS },
          currency: { type: 'string', enum: ['CNY', 'USD'] },
          payoutMethod: { type: 'string', minLength: 2, maxLength: 32 },
          payoutTarget: { type: 'string', minLength: 3, maxLength: 256 },
          idempotencyKey: { type: 'string', minLength: 8, maxLength: 120 }
        }
      }
    }
  }, async (request, reply) => {
    const user = requestUser(request)
    const body = request.body
    const payoutMethod = body.payoutMethod.trim().toLowerCase()
    const payoutTarget = body.payoutTarget.trim()
    if (!PAYOUT_METHOD_PATTERN.test(payoutMethod) || !payoutTarget || !IDEMPOTENCY_KEY_PATTERN.test(body.idempotencyKey)) {
      return reply.code(400).send({ error: 'Invalid withdrawal input', code: 'PLUGIN_WITHDRAWAL_INPUT_INVALID' })
    }
    try {
      const withdrawal = await createDeveloperWithdrawal({
        developerId: user.id,
        amountCents: body.amountCents,
        currency: body.currency,
        payoutMethod,
        payoutTarget,
        idempotencyKey: body.idempotencyKey
      })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'plugin.trade.withdrawal.create',
        `Requested plugin earning withdrawal #${withdrawal.id}; amount=${withdrawal.amountCents}; currency=${withdrawal.currency}; method=${withdrawal.payoutMethod}; target=redacted`,
        LogResult.SUCCESS
      )
      return reply.code(201).send({ withdrawal: serializeWithdrawal(withdrawal) })
    } catch (error) {
      return sendTradeError(reply, error)
    }
  })

  fastify.get<{ Querystring: { status?: string } }>('/admin/withdrawals', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const status = request.query.status
    if (status && !WITHDRAWAL_STATUSES.has(status as PluginDeveloperWithdrawalStatus)) {
      return reply.code(400).send({ error: 'Invalid withdrawal status', code: 'PLUGIN_WITHDRAWAL_STATUS_INVALID' })
    }
    const withdrawals = await listDeveloperWithdrawals(status as PluginDeveloperWithdrawalStatus | undefined)
    return { withdrawals: withdrawals.map(serializeWithdrawal) }
  })

  fastify.post<{ Params: { id: string } }>('/admin/withdrawals/:id/approve', {
    onRequest: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const withdrawalId = positiveRouteId(request.params.id)
    if (!withdrawalId) return reply.code(400).send({ error: 'Invalid withdrawal id', code: 'PLUGIN_WITHDRAWAL_ID_INVALID' })
    const user = requestUser(request)
    try {
      const withdrawal = await reviewDeveloperWithdrawal({ withdrawalId, reviewerUserId: user.id, decision: 'approve' })
      await createLog(user.id, LogModule.PLUGIN, 'plugin.trade.withdrawal.approve', `Approved plugin earning withdrawal #${withdrawalId}`, LogResult.SUCCESS)
      return { withdrawal: serializeWithdrawal(withdrawal) }
    } catch (error) {
      return sendTradeError(reply, error)
    }
  })

  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>('/admin/withdrawals/:id/reject', {
    onRequest: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { reason: { type: 'string', maxLength: 500 } }
      }
    }
  }, async (request, reply) => {
    const withdrawalId = positiveRouteId(request.params.id)
    if (!withdrawalId) return reply.code(400).send({ error: 'Invalid withdrawal id', code: 'PLUGIN_WITHDRAWAL_ID_INVALID' })
    const user = requestUser(request)
    try {
      const withdrawal = await reviewDeveloperWithdrawal({
        withdrawalId,
        reviewerUserId: user.id,
        decision: 'reject',
        reason: request.body?.reason
      })
      await createLog(user.id, LogModule.PLUGIN, 'plugin.trade.withdrawal.reject', `Rejected plugin earning withdrawal #${withdrawalId}`, LogResult.SUCCESS)
      return { withdrawal: serializeWithdrawal(withdrawal) }
    } catch (error) {
      return sendTradeError(reply, error)
    }
  })

}
