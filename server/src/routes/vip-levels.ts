import type { FastifyInstance, FastifyReply } from 'fastify'
import type { UserVipMetric, VipRuleType, VipRuleInput } from '../services/vip-levels.js'
import {
  MAX_VIP_LEVEL,
  getVipOverview,
  getUserVipMetric,
  getVipRules,
  replaceVipRules
} from '../services/vip-levels.js'

function parseRuleType(value: string | undefined): VipRuleType | null {
  return value === 'user' || value === 'hosting' ? value : null
}

function sendInvalidType(reply: FastifyReply) {
  return reply.status(400).send({ error: 'Invalid VIP rule type' })
}

function parseUserVipMetric(value: unknown): UserVipMetric | null {
  return value === 'totalRecharge' || value === 'totalConsume' ? value : null
}

export default async function vipLevelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/vip-levels/me', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request) => {
    return getVipOverview(request.user.id)
  })

  app.get<{
    Params: { type: string }
  }>('/api/admin/vip-levels/:type', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const type = parseRuleType(request.params.type)
    if (!type) return sendInvalidType(reply)

    return {
      type,
      maxLevel: MAX_VIP_LEVEL,
      userMetric: type === 'user' ? await getUserVipMetric() : undefined,
      rules: await getVipRules(type)
    }
  })

  app.put<{
    Params: { type: string }
    Body: { rules?: VipRuleInput[], userMetric?: UserVipMetric }
  }>('/api/admin/vip-levels/:type', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const type = parseRuleType(request.params.type)
    if (!type) return sendInvalidType(reply)

    const rules = Array.isArray(request.body?.rules) ? request.body.rules : []
    let userMetric: UserVipMetric | undefined
    if (type === 'user') {
      const parsedUserMetric = parseUserVipMetric(request.body?.userMetric)
      if (!parsedUserMetric) {
        return reply.status(400).send({ error: 'Invalid user VIP metric' })
      }
      userMetric = parsedUserMetric
    }

    try {
      const savedRules = await replaceVipRules(type, rules, userMetric)
      return {
        type,
        maxLevel: MAX_VIP_LEVEL,
        userMetric,
        rules: savedRules
      }
    } catch (error: any) {
      request.log.warn({ error }, 'VIP level rule validation failed')
      return reply.status(400).send({ error: error?.message || 'Invalid VIP level rules' })
    }
  })
}
