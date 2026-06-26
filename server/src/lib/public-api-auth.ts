import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PublicApiToken, User } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'

export const PUBLIC_API_TOKEN_PREFIX = 'pat_'
export const OAUTH_ACCESS_TOKEN_PREFIX = 'poa_'
export const PUBLIC_API_TOKEN_PREFIX_LENGTH = 16
export const PUBLIC_API_TOKEN_MAX_NAME_LENGTH = 80
export const PUBLIC_API_TOKEN_MAX_SCOPES = 24

export const PUBLIC_API_SCOPES = [
  'profile:read',
  'profile:write',
  'balance:read',
  'balance:write',
  'billing:read',
  'products:read',
  'services:read',
  'services:operate',
  'services:billing',
  'orders:read',
  'tickets:read',
  'tickets:write',
  'notifications:read',
  'notifications:send',
  'plugins:action'
] as const

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number]

export interface PublicApiScopeMetadata {
  scope: PublicApiScope
  title: string
  description: string
  risk: 'low' | 'medium' | 'high'
  access: 'read' | 'write' | 'operate'
  resources: string[]
  implemented: boolean
  notes: string[]
}

export const PUBLIC_API_SCOPE_METADATA: Record<PublicApiScope, PublicApiScopeMetadata> = {
  'profile:read': {
    scope: 'profile:read',
    title: 'Profile read',
    description: 'Read the authenticated user profile summary.',
    risk: 'low',
    access: 'read',
    resources: ['/api/v1/me'],
    implemented: true,
    notes: ['Returns only the token owner profile fields.']
  },
  'profile:write': {
    scope: 'profile:write',
    title: 'Profile write',
    description: 'Update low-risk profile presentation fields for the authenticated user.',
    risk: 'medium',
    access: 'write',
    resources: ['/api/v1/me'],
    implemented: true,
    notes: ['Only avatarStyle is accepted; email, password, role, status, balance, and 2FA settings are not writable.']
  },
  'balance:read': {
    scope: 'balance:read',
    title: 'Balance read',
    description: 'Read the authenticated user balance and safe balance ledger.',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/balance', '/api/v1/balance/logs'],
    implemented: true,
    notes: ['Does not expose payment provider payloads, adjustment objects, hosting balance, AFF balance, or other users.']
  },
  'balance:write': {
    scope: 'balance:write',
    title: 'Balance adjustment request',
    description: 'Submit and list pending balance adjustment requests for the authenticated user.',
    risk: 'high',
    access: 'write',
    resources: ['/api/v1/balance/adjustment-requests'],
    implemented: true,
    notes: ['Does not directly mutate balance, balance logs, payment records, or recharge orders.']
  },
  'billing:read': {
    scope: 'billing:read',
    title: 'Billing read',
    description: 'Read the authenticated user service billing records.',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/billing-records', '/api/v1/billing-records/:id'],
    implemented: true,
    notes: ['Returns billing summaries only; provider payloads and internal reconciliation data are omitted.']
  },
  'products:read': {
    scope: 'products:read',
    title: 'Products read',
    description: 'Read enabled public product and plan catalog entries.',
    risk: 'low',
    access: 'read',
    resources: ['/api/v1/products'],
    implemented: true,
    notes: ['Returns only enabled packages and enabled plans.']
  },
  'services:read': {
    scope: 'services:read',
    title: 'Services read',
    description: 'Read the authenticated user service summaries and safe includes.',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/services', '/api/v1/services/:id'],
    implemented: true,
    notes: ['Does not expose root passwords, Incus IDs, host internal configuration, or privileged connection material.']
  },
  'services:operate': {
    scope: 'services:operate',
    title: 'Service power tasks',
    description: 'Queue, poll, and cancel controlled service power tasks for the authenticated user.',
    risk: 'high',
    access: 'operate',
    resources: ['/api/v1/services/:id/actions', '/api/v1/services/:id/tasks/:taskId'],
    implemented: true,
    notes: ['Only start, stop, and restart are accepted; create, suspend, renew, reinstall, delete, migrate, and provisioning operations are not exposed.']
  },
  'services:billing': {
    scope: 'services:billing',
    title: 'Service billing operations',
    description: 'Renew authenticated user services through the internal billing state machine.',
    risk: 'high',
    access: 'write',
    resources: ['/api/v1/services/:id/renew'],
    implemented: true,
    notes: ['Only renewal is accepted; balance deduction, billing records, hosting income, and expired-service unsuspension are handled by the internal renewal transaction.']
  },
  'orders:read': {
    scope: 'orders:read',
    title: 'Orders read',
    description: 'Read the authenticated user recharge and instance billing orders.',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/orders', '/api/v1/orders/:id'],
    implemented: true,
    notes: ['Does not expose payment callbacks, provider config snapshots, raw query results, or complete trade numbers.']
  },
  'tickets:read': {
    scope: 'tickets:read',
    title: 'Tickets read',
    description: 'Read the authenticated user tickets, messages, and safe attachment metadata.',
    risk: 'medium',
    access: 'read',
    resources: ['/api/v1/tickets', '/api/v1/tickets/:id'],
    implemented: true,
    notes: ['Internal notes, storage provider IDs, and other users tickets are not exposed.']
  },
  'tickets:write': {
    scope: 'tickets:write',
    title: 'Tickets write',
    description: 'Create tickets, add public replies, upload controlled image attachments, and close or reopen own tickets.',
    risk: 'high',
    access: 'write',
    resources: ['/api/v1/tickets', '/api/v1/tickets/:id/replies', '/api/v1/tickets/:id/status'],
    implemented: true,
    notes: ['Does not allow internal notes, arbitrary status, priority/category override, assignee changes, or cross-user ticket writes.']
  },
  'notifications:read': {
    scope: 'notifications:read',
    title: 'Notifications read',
    description: 'Read the authenticated user inbox notifications and unread count.',
    risk: 'low',
    access: 'read',
    resources: ['/api/v1/notifications', '/api/v1/notifications/unread-count'],
    implemented: true,
    notes: ['Does not expose channel configuration, external delivery logs, raw event payloads, broadcast targets, or other users messages.']
  },
  'notifications:send': {
    scope: 'notifications:send',
    title: 'Self notification send',
    description: 'Send short controlled notifications to the authenticated user.',
    risk: 'medium',
    access: 'write',
    resources: ['/api/v1/notifications'],
    implemented: true,
    notes: ['Only self notifications, platform templates, and enabled plugin-declared templates are accepted; broadcast, HTML, arbitrary channels, and internal event type override are not accepted.']
  },
  'plugins:action': {
    scope: 'plugins:action',
    title: 'Plugin actions',
    description: 'Discover and invoke enabled plugin-declared public webhook actions.',
    risk: 'high',
    access: 'operate',
    resources: ['/api/v1/plugins', '/api/v1/plugins/:pluginId/actions', '/api/v1/plugins/:pluginId/actions/:action'],
    implemented: true,
    notes: ['Does not expose webhook URLs, secrets, config values, service extension hooks, or gateway extension hooks.']
  }
}

export function listPublicApiScopeMetadata(scopes: readonly PublicApiScope[] = PUBLIC_API_SCOPES): PublicApiScopeMetadata[] {
  return scopes.map(scope => PUBLIC_API_SCOPE_METADATA[scope])
}

export interface AuthenticatedPublicApiToken {
  id: number
  source: 'api_token' | 'oauth_access_token'
  userId: number
  name: string
  tokenPrefix: string
  scopes: PublicApiScope[]
  user: {
    id: number
    username: string
    email: string | null
    role: 'admin' | 'user'
    status: string
    avatarStyle: string
    avatarBadgeId: string | null
  }
}

type PublicApiTokenWithUser = PublicApiToken & {
  user: Pick<User, 'id' | 'username' | 'email' | 'role' | 'status' | 'avatarStyle' | 'avatarBadgeId'>
}

type OAuthAccessTokenWithUserAndApp = NonNullable<Awaited<ReturnType<typeof prisma.oAuthAccessToken.findUnique>>> & {
  user: Pick<User, 'id' | 'username' | 'email' | 'role' | 'status' | 'avatarStyle' | 'avatarBadgeId'>
  app: { name: string; clientId: string; enabled: boolean }
}

function safeTimingEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

export function generatePublicApiToken(): string {
  return `${PUBLIC_API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function hashPublicApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function getPublicApiTokenPrefix(token: string): string {
  return token.slice(0, PUBLIC_API_TOKEN_PREFIX_LENGTH)
}

export function normalizePublicApiTokenName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > PUBLIC_API_TOKEN_MAX_NAME_LENGTH) return null
  return trimmed
}

export function normalizePublicApiScopes(value: unknown): PublicApiScope[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > PUBLIC_API_TOKEN_MAX_SCOPES) {
    return null
  }

  const allowedScopes = new Set<string>(PUBLIC_API_SCOPES)
  const scopes = Array.from(new Set(value.map(scope => typeof scope === 'string' ? scope.trim() : '')))
    .filter((scope): scope is PublicApiScope => allowedScopes.has(scope))

  return scopes.length === value.length ? scopes : null
}

export function readPublicApiBearerToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null

  const token = auth.slice('Bearer '.length).trim()
  const isPublicApiToken = token.startsWith(PUBLIC_API_TOKEN_PREFIX)
  const isOAuthAccessToken = token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)
  if ((!isPublicApiToken && !isOAuthAccessToken) || token.length < 32) {
    return null
  }
  return token
}

function serializeScopes(value: unknown): PublicApiScope[] {
  const normalized = normalizePublicApiScopes(value)
  return normalized ?? []
}

function serializeAuthenticatedToken(token: PublicApiTokenWithUser): AuthenticatedPublicApiToken {
  return {
    id: token.id,
    source: 'api_token',
    userId: token.userId,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scopes: serializeScopes(token.scopes),
    user: {
      id: token.user.id,
      username: token.user.username,
      email: token.user.email,
      role: token.user.role as 'admin' | 'user',
      status: token.user.status,
      avatarStyle: token.user.avatarStyle,
      avatarBadgeId: token.user.avatarBadgeId
    }
  }
}

function serializeAuthenticatedOAuthToken(token: OAuthAccessTokenWithUserAndApp): AuthenticatedPublicApiToken {
  return {
    id: token.id,
    source: 'oauth_access_token',
    userId: token.userId,
    name: `OAuth app ${token.app.name}`,
    tokenPrefix: token.tokenPrefix,
    scopes: serializeScopes(token.scopes),
    user: {
      id: token.user.id,
      username: token.user.username,
      email: token.user.email,
      role: token.user.role as 'admin' | 'user',
      status: token.user.status,
      avatarStyle: token.user.avatarStyle,
      avatarBadgeId: token.user.avatarBadgeId
    }
  }
}

export async function authenticatePublicApiRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredScope: PublicApiScope
): Promise<AuthenticatedPublicApiToken | null> {
  const rawToken = readPublicApiBearerToken(request)
  if (!rawToken) {
    reply.code(401).send({ error: 'Unauthorized', code: 'PUBLIC_API_TOKEN_REQUIRED' })
    return null
  }

  if (rawToken.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
    const tokenHash = hashPublicApiToken(rawToken)
    const tokenPrefix = getPublicApiTokenPrefix(rawToken)
    const token = await prisma.oAuthAccessToken.findUnique({
      where: { tokenHash },
      include: {
        app: { select: { name: true, clientId: true, enabled: true } },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            status: true,
            avatarStyle: true,
            avatarBadgeId: true
          }
        }
      }
    })

    if (!token || !safeTimingEqual(token.tokenHash, tokenHash) || token.tokenPrefix !== tokenPrefix) {
      reply.code(401).send({ error: 'Unauthorized', code: 'PUBLIC_API_TOKEN_INVALID' })
      return null
    }

    if (!token.app.enabled) {
      reply.code(401).send({ error: 'OAuth app disabled', code: 'OAUTH_APP_DISABLED' })
      return null
    }

    if (token.revokedAt) {
      reply.code(401).send({ error: 'Token revoked', code: 'PUBLIC_API_TOKEN_REVOKED' })
      return null
    }

    if (token.expiresAt.getTime() <= Date.now()) {
      reply.code(401).send({ error: 'Token expired', code: 'PUBLIC_API_TOKEN_EXPIRED' })
      return null
    }

    if (token.user.status !== 'active') {
      reply.code(401).send({ error: 'Account banned', code: 'ACCOUNT_BANNED' })
      return null
    }

    const scopes = serializeScopes(token.scopes)
    if (!scopes.includes(requiredScope)) {
      await createLog(
        token.userId,
        LogModule.SECURITY,
        'oauth_provider.token_scope_denied',
        `OAuth app "${token.app.name}" missing required scope "${requiredScope}"`,
        LogResult.FAILED
      )
      reply.code(403).send({ error: 'Missing required API scope', code: 'PUBLIC_API_SCOPE_REQUIRED' })
      return null
    }

    await prisma.oAuthAccessToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() }
    })

    return serializeAuthenticatedOAuthToken(token)
  }

  const tokenHash = hashPublicApiToken(rawToken)
  const tokenPrefix = getPublicApiTokenPrefix(rawToken)
  const token = await prisma.publicApiToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
          avatarStyle: true,
          avatarBadgeId: true
        }
      }
    }
  })

  if (!token || !safeTimingEqual(token.tokenHash, tokenHash) || token.tokenPrefix !== tokenPrefix) {
    reply.code(401).send({ error: 'Unauthorized', code: 'PUBLIC_API_TOKEN_INVALID' })
    return null
  }

  if (token.revokedAt) {
    reply.code(401).send({ error: 'Token revoked', code: 'PUBLIC_API_TOKEN_REVOKED' })
    return null
  }

  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
    reply.code(401).send({ error: 'Token expired', code: 'PUBLIC_API_TOKEN_EXPIRED' })
    return null
  }

  if (token.user.status !== 'active') {
    reply.code(401).send({ error: 'Account banned', code: 'ACCOUNT_BANNED' })
    return null
  }

  const scopes = serializeScopes(token.scopes)
  if (!scopes.includes(requiredScope)) {
    await createLog(
      token.userId,
      LogModule.SECURITY,
      'public_api.token_scope_denied',
      `Public API token "${token.name}" missing required scope "${requiredScope}"`,
      LogResult.FAILED
    )
    reply.code(403).send({ error: 'Missing required API scope', code: 'PUBLIC_API_SCOPE_REQUIRED' })
    return null
  }

  await prisma.publicApiToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() }
  })

  return serializeAuthenticatedToken(token)
}
