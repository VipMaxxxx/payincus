import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../db/prisma.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import {
  generatePublicApiToken,
  getPublicApiTokenPrefix,
  hashPublicApiToken,
  normalizePublicApiScopes,
  normalizePublicApiTokenName,
  PUBLIC_API_SCOPES
} from '../lib/public-api-auth.js'

interface CreateApiTokenBody {
  name?: unknown
  scopes?: unknown
  expiresAt?: unknown
}

interface TokenParams {
  id: string
}

function serializePublicApiToken(token: {
  id: number
  name: string
  tokenPrefix: string
  scopes: unknown
  lastUsedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: token.id,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scopes: Array.isArray(token.scopes) ? token.scopes : [],
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    expiresAt: token.expiresAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
    updatedAt: token.updatedAt.toISOString()
  }
}

function parseTokenId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function normalizeExpiresAt(value: unknown): Date | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return 'invalid'
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return 'invalid'
  return date
}

function getRequestUser(request: FastifyRequest): { id: number; username: string } {
  return request.user as { id: number; username: string }
}

export default async function apiTokenRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const user = getRequestUser(request)
    const tokens = await prisma.publicApiToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        scopes: true,
        lastUsedAt: true,
        revokedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true
      }
    })

    return {
      scopes: PUBLIC_API_SCOPES,
      tokens: tokens.map(serializePublicApiToken)
    }
  })

  fastify.post<{
    Body: CreateApiTokenBody
  }>('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = getRequestUser(request)
    const name = normalizePublicApiTokenName(request.body?.name)
    const scopes = normalizePublicApiScopes(request.body?.scopes)
    const expiresAt = normalizeExpiresAt(request.body?.expiresAt)

    if (!name) {
      return reply.code(400).send({ error: 'Invalid token name', code: 'INVALID_TOKEN_NAME' })
    }
    if (!scopes) {
      return reply.code(400).send({ error: 'Invalid API scopes', code: 'INVALID_API_SCOPES' })
    }
    if (expiresAt === 'invalid') {
      return reply.code(400).send({ error: 'Invalid expiry time', code: 'INVALID_EXPIRES_AT' })
    }

    const rawToken = generatePublicApiToken()
    const tokenHash = hashPublicApiToken(rawToken)
    const record = await prisma.publicApiToken.create({
      data: {
        userId: user.id,
        name,
        tokenPrefix: getPublicApiTokenPrefix(rawToken),
        tokenHash,
        scopes,
        expiresAt
      }
    })

    await createLog(
      user.id,
      LogModule.SECURITY,
      'public_api.token_create',
      `Created public API token "${name}" with scopes: ${scopes.join(', ')}`,
      LogResult.SUCCESS
    )

    return reply.code(201).send({
      token: rawToken,
      apiToken: serializePublicApiToken(record)
    })
  })

  fastify.delete<{
    Params: TokenParams
  }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = getRequestUser(request)
    const tokenId = parseTokenId(request.params.id)
    if (!tokenId) {
      return reply.code(400).send({ error: 'Invalid token id', code: 'INVALID_TOKEN_ID' })
    }

    const token = await prisma.publicApiToken.findFirst({
      where: {
        id: tokenId,
        userId: user.id
      }
    })

    if (!token) {
      return reply.code(404).send({ error: 'API token not found', code: 'API_TOKEN_NOT_FOUND' })
    }

    if (!token.revokedAt) {
      await prisma.publicApiToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() }
      })

      await createLog(
        user.id,
        LogModule.SECURITY,
        'public_api.token_revoke',
        `Revoked public API token "${token.name}"`,
        LogResult.SUCCESS
      )
    }

    return { message: 'API token revoked' }
  })
}
