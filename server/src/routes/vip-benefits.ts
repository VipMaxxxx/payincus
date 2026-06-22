import type { FastifyInstance, FastifyReply } from 'fastify'
import { VipBenefitError } from '../services/vip-benefits.js'
import {
  claimAllAvailableVipBenefitRewards,
  claimVipBenefitReward,
  createVipBenefitReward,
  deleteVipBenefitReward,
  getVipBenefitOverview,
  listAdminVipBenefitRewards,
  updateVipBenefitReward,
  type VipBenefitRewardInput
} from '../services/vip-benefits.js'

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function sendVipBenefitError(reply: FastifyReply, error: unknown) {
  if (error instanceof VipBenefitError) {
    return reply.status(error.statusCode).send({
      error: error.message,
      code: error.code
    })
  }
  throw error
}

export default async function vipBenefitRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/vip-benefits/me', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request) => {
    return getVipBenefitOverview(request.user.id)
  })

  app.post<{
    Params: { rewardId: string }
  }>('/api/vip-benefits/:rewardId/claim', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 100, timeWindow: '3 minutes' } }
  }, async (request, reply) => {
    const rewardId = parsePositiveRouteId(request.params.rewardId)
    if (!rewardId) {
      return reply.status(400).send({ error: 'Invalid VIP benefit reward ID', code: 'INVALID_REWARD_ID' })
    }

    try {
      return await claimVipBenefitReward(request.user.id, rewardId)
    } catch (error) {
      return sendVipBenefitError(reply, error)
    }
  })

  app.post('/api/vip-benefits/claim-all', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '3 minutes' } }
  }, async (request, reply) => {
    try {
      return await claimAllAvailableVipBenefitRewards(request.user.id)
    } catch (error) {
      return sendVipBenefitError(reply, error)
    }
  })

  app.get('/api/admin/vip-benefits/rewards', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async () => {
    return { rewards: await listAdminVipBenefitRewards() }
  })

  app.post<{
    Body: VipBenefitRewardInput
  }>('/api/admin/vip-benefits/rewards', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      return { reward: await createVipBenefitReward(request.body || {}) }
    } catch (error) {
      return sendVipBenefitError(reply, error)
    }
  })

  app.put<{
    Params: { id: string }
    Body: VipBenefitRewardInput
  }>('/api/admin/vip-benefits/rewards/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const id = parsePositiveRouteId(request.params.id)
    if (!id) {
      return reply.status(400).send({ error: 'Invalid VIP benefit reward ID', code: 'INVALID_REWARD_ID' })
    }

    try {
      return { reward: await updateVipBenefitReward(id, request.body || {}) }
    } catch (error) {
      return sendVipBenefitError(reply, error)
    }
  })

  app.delete<{
    Params: { id: string }
  }>('/api/admin/vip-benefits/rewards/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const id = parsePositiveRouteId(request.params.id)
    if (!id) {
      return reply.status(400).send({ error: 'Invalid VIP benefit reward ID', code: 'INVALID_REWARD_ID' })
    }

    try {
      await deleteVipBenefitReward(id)
      return { success: true }
    } catch (error) {
      return sendVipBenefitError(reply, error)
    }
  })
}
