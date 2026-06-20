/**
 * 用户邀请码管理
 */

import { nanoid } from 'nanoid'
import type { Prisma } from '@prisma/client'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../db/prisma.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import {
  chargeInviteGenerationCost,
  getInviteCostOptions,
  getInviteCostQuotes,
  getInviteExpiryDays,
  getUserInviteBalances
} from '../lib/invite-pricing.js'

interface GenerateInviteBody {
  costResource: string
  count?: number
}

function toInviteCodePayload(invite: {
  id: number
  code: string
  createdBy: number
  usedBy: number | null
  usedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  costSnapshot: unknown
  user?: {
    id: number
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId: string | null
    createdAt: Date
  } | null
}) {
  return {
    id: invite.id,
    code: invite.code,
    createdBy: invite.createdBy,
    usedBy: invite.usedBy,
    usedAt: invite.usedAt?.toISOString() ?? null,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
    costSnapshot: invite.costSnapshot,
    registerUrl: `/register/${invite.code}`,
    usedByUser: invite.user
      ? {
          id: invite.user.id,
          username: invite.user.username,
          email: invite.user.email,
          avatarStyle: invite.user.avatarStyle,
          avatarBadgeId: invite.user.avatarBadgeId,
          createdAt: invite.user.createdAt.toISOString()
        }
      : null
  }
}

export default async function userInviteRoutes(fastify: FastifyInstance) {
  fastify.get('/summary', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest) => {
    const userId = request.user.id
    const [costOptions, balances, total, used] = await Promise.all([
      getInviteCostQuotes(),
      getUserInviteBalances(userId),
      prisma.inviteCode.count({ where: { createdBy: userId } }),
      prisma.inviteCode.count({ where: { createdBy: userId, usedBy: { not: null } } })
    ])

    return {
      costOptions,
      balances,
      stats: {
        total,
        used,
        unused: total - used,
        usageRate: total > 0 ? Math.round((used / total) * 1000) / 10 : 0
      }
    }
  })

  fastify.get<{
    Querystring: { page?: string; pageSize?: string }
  }>('/', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string } }>) => {
    const page = Math.max(1, parseInt(request.query.page || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(request.query.pageSize || '20', 10)))
    const userId = request.user.id

    const [total, invites] = await Promise.all([
      prisma.inviteCode.count({ where: { createdBy: userId } }),
      prisma.inviteCode.findMany({
        where: { createdBy: userId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              avatarStyle: true,
              avatarBadgeId: true,
              createdAt: true
            }
          }
        },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])

    return {
      invites: invites.map(toInviteCodePayload),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  })

  fastify.post<{ Body: GenerateInviteBody }>('/', {
    onRequest: [fastify.authenticateUser],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['costResource'],
        properties: {
          costResource: { type: 'string', minLength: 1, maxLength: 64 },
          count: { type: 'integer', minimum: 1, maximum: 10 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: GenerateInviteBody }>, reply: FastifyReply) => {
    const userId = request.user.id
    const count = request.body.count ?? 1
    const costResource = request.body.costResource
    const [expiryDays, costOptions] = await Promise.all([
      getInviteExpiryDays(),
      getInviteCostOptions()
    ])
    const expiresAt = expiryDays > 0
      ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
      : null

    try {
      const createdInvites = await prisma.$transaction(async (tx) => {
        const results: Awaited<ReturnType<typeof tx.inviteCode.create>>[] = []

        for (let index = 0; index < count; index++) {
          const code = nanoid(12)
          const costSnapshot = await chargeInviteGenerationCost(tx, userId, code, costResource, costOptions)
          const invite = await tx.inviteCode.create({
            data: {
              code,
              createdBy: userId,
              expiresAt,
              costSnapshot: costSnapshot as unknown as Prisma.InputJsonObject
            }
          })
          results.push(invite)
        }

        return results
      })

      return {
        invites: createdInvites.map(invite => toInviteCodePayload({ ...invite, user: null })),
        count: createdInvites.length
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'INVITE_COST_OPTION_UNAVAILABLE') {
        return reply.code(400).send({ error: '当前邀请码生成方式不可用', code: 'INVITE_COST_OPTION_UNAVAILABLE' })
      }
      if (message === 'INVITE_COST_RESOURCE_UNSUPPORTED') {
        return reply.code(400).send({ error: '暂不支持该生成方式', code: 'INVITE_COST_RESOURCE_UNSUPPORTED' })
      }
      if (message === 'INSUFFICIENT_BALANCE') {
        return reply.code(400).send({ error: '余额不足', code: 'INSUFFICIENT_BALANCE' })
      }
      if (message === 'INSUFFICIENT_POINTS') {
        return reply.code(400).send({ error: '积分不足', code: 'INSUFFICIENT_POINTS' })
      }
      if (message === 'USER_NOT_FOUND') {
        return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
      }
      throw err
    }
  })
}
