import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { OAuthAccessToken, OAuthClientApp, OAuthGrant, Prisma, User } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { PUBLIC_API_SCOPES, type PublicApiScope } from './public-api-auth.js'

export const OAUTH_CLIENT_ID_PREFIX = 'pocli_'
export const OAUTH_CLIENT_SECRET_PREFIX = 'posec_'
export const OAUTH_AUTHORIZATION_CODE_PREFIX = 'poc_'
export const OAUTH_ACCESS_TOKEN_PREFIX = 'poa_'
export const OAUTH_REFRESH_TOKEN_PREFIX = 'por_'
export const OAUTH_ACCESS_TOKEN_PREFIX_LENGTH = 16
export const OAUTH_REFRESH_TOKEN_PREFIX_LENGTH = 16
export const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export interface SerializedOAuthClientApp {
  id: number
  name: string
  clientId: string
  redirectUris: string[]
  scopes: PublicApiScope[]
  enabled: boolean
  createdByUserId: number
  createdByUsername: string | null
  createdAt: string
  updatedAt: string
}

type OAuthClientAppWithCreator = OAuthClientApp & {
  createdBy?: Pick<User, 'username'> | null
}

type OAuthGrantWithApp = OAuthGrant & {
  app: Pick<OAuthClientApp, 'id' | 'name' | 'clientId' | 'enabled'>
}

type OAuthGrantWithAppAndUser = OAuthGrant & {
  app: Pick<OAuthClientApp, 'id' | 'name' | 'clientId' | 'enabled'>
  user: Pick<User, 'id' | 'username' | 'email' | 'role' | 'status'>
}

export interface SerializedOAuthAuthorization {
  id: number
  app: {
    id: number
    name: string
    clientId: string
    enabled: boolean
  }
  scopes: PublicApiScope[]
  active: boolean
  lastAuthorizedAt: string
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SerializedAdminOAuthAuthorization extends SerializedOAuthAuthorization {
  user: {
    id: number
    username: string
    email: string | null
    role: string
    status: string
  }
  tokenStats: {
    activeAccessTokens: number
    activeRefreshTokens: number
  }
}

export type AdminOAuthAuthorizationStatusFilter = 'all' | 'active' | 'revoked' | 'disabled'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeTimingEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

export function hashOAuthSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function generateOAuthClientId(): string {
  return `${OAUTH_CLIENT_ID_PREFIX}${randomBytes(18).toString('base64url')}`
}

export function generateOAuthClientSecret(): string {
  return `${OAUTH_CLIENT_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function generateOAuthAuthorizationCode(): string {
  return `${OAUTH_AUTHORIZATION_CODE_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function generateOAuthAccessToken(): string {
  return `${OAUTH_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function generateOAuthRefreshToken(): string {
  return `${OAUTH_REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function getOAuthAccessTokenPrefix(token: string): string {
  return token.slice(0, OAUTH_ACCESS_TOKEN_PREFIX_LENGTH)
}

export function getOAuthRefreshTokenPrefix(token: string): string {
  return token.slice(0, OAUTH_REFRESH_TOKEN_PREFIX_LENGTH)
}

export function normalizeOAuthAppName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 120 ? trimmed : null
}

export function normalizeOAuthRedirectUris(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null
  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const trimmed = item.trim()
    if (!trimmed || trimmed.length > 500) return null
    try {
      const parsed = new URL(trimmed)
      const isLocalHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      if (parsed.protocol !== 'https:' && !isLocalHttp) return null
      parsed.hash = ''
      normalized.push(parsed.toString())
    } catch {
      return null
    }
  }
  return Array.from(new Set(normalized))
}

export function normalizeOAuthScopes(value: unknown): PublicApiScope[] | null {
  const raw = typeof value === 'string'
    ? value.split(/\s+/)
    : Array.isArray(value)
      ? value
      : null
  if (!raw || raw.length === 0 || raw.length > 24) return null
  const allowed = new Set<string>(PUBLIC_API_SCOPES)
  const scopes = Array.from(new Set(raw.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean)))
  if (scopes.length === 0 || scopes.some(scope => !allowed.has(scope))) return null
  return scopes as PublicApiScope[]
}

function serializeScopes(value: unknown): PublicApiScope[] {
  return normalizeOAuthScopes(value) ?? []
}

export function serializeOAuthClientApp(app: OAuthClientAppWithCreator): SerializedOAuthClientApp {
  return {
    id: app.id,
    name: app.name,
    clientId: app.clientId,
    redirectUris: Array.isArray(app.redirectUris) ? app.redirectUris.filter((item): item is string => typeof item === 'string') : [],
    scopes: serializeScopes(app.scopes),
    enabled: app.enabled,
    createdByUserId: app.createdByUserId,
    createdByUsername: app.createdBy?.username || null,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString()
  }
}

export function serializeOAuthAuthorization(grant: OAuthGrantWithApp): SerializedOAuthAuthorization {
  return {
    id: grant.id,
    app: {
      id: grant.app.id,
      name: grant.app.name,
      clientId: grant.app.clientId,
      enabled: grant.app.enabled
    },
    scopes: serializeScopes(grant.scopes),
    active: !grant.revokedAt && grant.app.enabled,
    lastAuthorizedAt: grant.lastAuthorizedAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString()
  }
}

export function serializeAdminOAuthAuthorization(
  grant: OAuthGrantWithAppAndUser,
  tokenStats: { activeAccessTokens: number; activeRefreshTokens: number }
): SerializedAdminOAuthAuthorization {
  return {
    ...serializeOAuthAuthorization(grant),
    user: {
      id: grant.user.id,
      username: grant.user.username,
      email: grant.user.email,
      role: grant.user.role,
      status: grant.user.status
    },
    tokenStats
  }
}

export async function listOAuthClientApps() {
  return await prisma.oAuthClientApp.findMany({
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { username: true } } }
  })
}

export async function listAdminOAuthAuthorizations(input: {
  appId?: number | null
  user?: string | null
  status?: AdminOAuthAuthorizationStatusFilter
  page?: number
  pageSize?: number
}) {
  const page = Math.max(1, Number.isInteger(input.page) ? input.page! : 1)
  const pageSize = Math.min(100, Math.max(1, Number.isInteger(input.pageSize) ? input.pageSize! : 20))
  const where: Prisma.OAuthGrantWhereInput = {}

  if (input.appId) {
    where.appId = input.appId
  }

  const userSearch = input.user?.trim()
  if (userSearch) {
    const numericUserId = /^[1-9]\d*$/.test(userSearch) ? Number(userSearch) : null
    where.user = {
      OR: [
        ...(numericUserId ? [{ id: numericUserId }] : []),
        { username: { contains: userSearch, mode: 'insensitive' } },
        { email: { contains: userSearch, mode: 'insensitive' } }
      ]
    }
  }

  if (input.status === 'active') {
    where.revokedAt = null
    where.app = { enabled: true }
  } else if (input.status === 'revoked') {
    where.revokedAt = { not: null }
  } else if (input.status === 'disabled') {
    where.revokedAt = null
    where.app = { enabled: false }
  }

  const [total, grants] = await Promise.all([
    prisma.oAuthGrant.count({ where }),
    prisma.oAuthGrant.findMany({
      where,
      orderBy: [{ lastAuthorizedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        app: { select: { id: true, name: true, clientId: true, enabled: true } },
        user: { select: { id: true, username: true, email: true, role: true, status: true } }
      }
    })
  ])

  const now = new Date()
  const stats = await Promise.all(grants.map(async grant => {
    const [activeAccessTokens, activeRefreshTokens] = await Promise.all([
      prisma.oAuthAccessToken.count({
        where: { grantId: grant.id, revokedAt: null, expiresAt: { gt: now } }
      }),
      prisma.oAuthRefreshToken.count({
        where: { grantId: grant.id, revokedAt: null, expiresAt: { gt: now } }
      })
    ])
    return { grantId: grant.id, activeAccessTokens, activeRefreshTokens }
  }))
  const statMap = new Map(stats.map(item => [item.grantId, item]))

  return {
    authorizations: grants.map(grant => serializeAdminOAuthAuthorization(grant, statMap.get(grant.id) || {
      activeAccessTokens: 0,
      activeRefreshTokens: 0
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  }
}

export async function createOAuthClientApp(input: {
  name: string
  redirectUris: string[]
  scopes: PublicApiScope[]
  enabled: boolean
  createdByUserId: number
}) {
  const clientId = generateOAuthClientId()
  const clientSecret = generateOAuthClientSecret()
  const app = await prisma.oAuthClientApp.create({
    data: {
      name: input.name,
      clientId,
      clientSecretHash: hashOAuthSecret(clientSecret),
      redirectUris: input.redirectUris,
      scopes: input.scopes,
      enabled: input.enabled,
      createdByUserId: input.createdByUserId
    },
    include: { createdBy: { select: { username: true } } }
  })
  return { app, clientSecret }
}

export async function updateOAuthClientApp(id: number, input: {
  name: string
  redirectUris: string[]
  scopes: PublicApiScope[]
  enabled: boolean
}) {
  return await prisma.oAuthClientApp.update({
    where: { id },
    data: {
      name: input.name,
      redirectUris: input.redirectUris,
      scopes: input.scopes,
      enabled: input.enabled
    },
    include: { createdBy: { select: { username: true } } }
  })
}

export async function rotateOAuthClientSecret(id: number) {
  const clientSecret = generateOAuthClientSecret()
  const app = await prisma.oAuthClientApp.update({
    where: { id },
    data: { clientSecretHash: hashOAuthSecret(clientSecret) },
    include: { createdBy: { select: { username: true } } }
  })
  return { app, clientSecret }
}

export async function deleteOAuthClientApp(id: number) {
  await prisma.oAuthClientApp.delete({ where: { id } })
}

export async function prepareOAuthAuthorizationRequest(input: {
  clientId: string
  redirectUri: string
  scopes: PublicApiScope[]
  userId: number
}) {
  const app = await prisma.oAuthClientApp.findUnique({ where: { clientId: input.clientId } })
  if (!app || !app.enabled) throw new Error('OAuth app is disabled or missing')
  const redirectUris = normalizeOAuthRedirectUris(app.redirectUris)
  if (!redirectUris?.includes(input.redirectUri)) throw new Error('redirect_uri is not registered for this OAuth app')
  const appScopes = new Set(serializeScopes(app.scopes))
  if (input.scopes.some(scope => !appScopes.has(scope))) throw new Error('Requested scope exceeds OAuth app grant')
  const grant = await prisma.oAuthGrant.findUnique({
    where: { appId_userId: { appId: app.id, userId: input.userId } }
  })
  const grantedScopes = grant && !grant.revokedAt ? serializeScopes(grant.scopes) : []
  const consentRequired = input.scopes.some(scope => !grantedScopes.includes(scope))
  return {
    app,
    requestedScopes: input.scopes,
    existingGrant: grant,
    consentRequired
  }
}

export async function createOAuthAuthorizationCode(input: {
  clientId: string
  redirectUri: string
  scopes: PublicApiScope[]
  userId: number
  state?: string | null
}) {
  const prepared = await prepareOAuthAuthorizationRequest(input)
  const app = prepared.app

  const code = generateOAuthAuthorizationCode()
  const expiresAt = new Date(Date.now() + OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000)
  await prisma.$transaction(async tx => {
    await tx.oAuthGrant.upsert({
      where: { appId_userId: { appId: app.id, userId: input.userId } },
      update: {
        scopes: input.scopes,
        revokedAt: null,
        lastAuthorizedAt: new Date()
      },
      create: {
        appId: app.id,
        userId: input.userId,
        scopes: input.scopes
      }
    })
    await tx.oAuthAuthorizationCode.create({
      data: {
        appId: app.id,
        userId: input.userId,
        codeHash: hashOAuthSecret(code),
        redirectUri: input.redirectUri,
        scopes: input.scopes,
        expiresAt
      }
    })
  })

  const redirect = new URL(input.redirectUri)
  redirect.searchParams.set('code', code)
  if (input.state) redirect.searchParams.set('state', input.state)

  return {
    redirectTo: redirect.toString(),
    expiresIn: OAUTH_AUTHORIZATION_CODE_TTL_SECONDS
  }
}

export async function exchangeOAuthAuthorizationCode(input: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}) {
  const app = await prisma.oAuthClientApp.findUnique({ where: { clientId: input.clientId } })
  if (!app || !app.enabled || !safeTimingEqual(app.clientSecretHash, hashOAuthSecret(input.clientSecret))) {
    throw new Error('Invalid OAuth client credentials')
  }

  const codeHash = hashOAuthSecret(input.code)
  const accessTokenRaw = generateOAuthAccessToken()
  const refreshTokenRaw = generateOAuthRefreshToken()
  const accessTokenHash = hashOAuthSecret(accessTokenRaw)
  const refreshTokenHash = hashOAuthSecret(refreshTokenRaw)
  const accessTokenExpiresAt = new Date(Date.now() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000)
  const refreshTokenExpiresAt = new Date(Date.now() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000)

  const result = await prisma.$transaction(async tx => {
    const authorizationCode = await tx.oAuthAuthorizationCode.findUnique({ where: { codeHash } })
    if (!authorizationCode || authorizationCode.appId !== app.id) throw new Error('Invalid authorization code')
    if (authorizationCode.usedAt) throw new Error('Authorization code has already been used')
    if (authorizationCode.expiresAt.getTime() <= Date.now()) throw new Error('Authorization code has expired')
    if (authorizationCode.redirectUri !== input.redirectUri) throw new Error('redirect_uri does not match authorization request')

    await tx.oAuthAuthorizationCode.update({
      where: { id: authorizationCode.id },
      data: { usedAt: new Date() }
    })

    const grant = await tx.oAuthGrant.findUnique({
      where: { appId_userId: { appId: app.id, userId: authorizationCode.userId } }
    })
    if (!grant || grant.revokedAt) throw new Error('OAuth authorization has been revoked')

    const accessToken = await tx.oAuthAccessToken.create({
      data: {
        appId: app.id,
        userId: authorizationCode.userId,
        grantId: grant.id,
        tokenPrefix: getOAuthAccessTokenPrefix(accessTokenRaw),
        tokenHash: accessTokenHash,
        scopes: serializeScopes(authorizationCode.scopes),
        expiresAt: accessTokenExpiresAt
      }
    })
    const refreshToken = await tx.oAuthRefreshToken.create({
      data: {
        appId: app.id,
        userId: authorizationCode.userId,
        grantId: grant.id,
        tokenPrefix: getOAuthRefreshTokenPrefix(refreshTokenRaw),
        tokenHash: refreshTokenHash,
        scopes: serializeScopes(authorizationCode.scopes),
        expiresAt: refreshTokenExpiresAt
      }
    })

    return { authorizationCode, accessToken, refreshToken }
  })

  return {
    accessToken: accessTokenRaw,
    refreshToken: refreshTokenRaw,
    tokenType: 'Bearer' as const,
    expiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshExpiresIn: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    scope: serializeScopes(result.accessToken.scopes).join(' '),
    accessTokenRecord: result.accessToken
  }
}

export async function exchangeOAuthRefreshToken(input: {
  clientId: string
  clientSecret: string
  refreshToken: string
}) {
  const app = await prisma.oAuthClientApp.findUnique({ where: { clientId: input.clientId } })
  if (!app || !app.enabled || !safeTimingEqual(app.clientSecretHash, hashOAuthSecret(input.clientSecret))) {
    throw new Error('Invalid OAuth client credentials')
  }

  const refreshTokenHash = hashOAuthSecret(input.refreshToken)
  const accessTokenRaw = generateOAuthAccessToken()
  const nextRefreshTokenRaw = generateOAuthRefreshToken()
  const accessTokenHash = hashOAuthSecret(accessTokenRaw)
  const nextRefreshTokenHash = hashOAuthSecret(nextRefreshTokenRaw)
  const accessTokenExpiresAt = new Date(Date.now() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000)
  const refreshTokenExpiresAt = new Date(Date.now() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000)

  const result = await prisma.$transaction(async tx => {
    const refreshToken = await tx.oAuthRefreshToken.findUnique({
      where: { tokenHash: refreshTokenHash },
      include: {
        user: { select: { status: true } },
        grant: true
      }
    })
    if (!refreshToken || refreshToken.appId !== app.id) throw new Error('Invalid refresh token')
    if (refreshToken.revokedAt) throw new Error('Refresh token has been revoked')
    if (refreshToken.expiresAt.getTime() <= Date.now()) throw new Error('Refresh token has expired')
    if (refreshToken.user.status !== 'active') throw new Error('Account is not active')
    if (!refreshToken.grant || refreshToken.grant.revokedAt) throw new Error('OAuth authorization has been revoked')

    await tx.oAuthRefreshToken.update({
      where: { id: refreshToken.id },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date()
      }
    })

    const scopes = serializeScopes(refreshToken.scopes)
    const accessToken = await tx.oAuthAccessToken.create({
      data: {
        appId: app.id,
        userId: refreshToken.userId,
        grantId: refreshToken.grantId,
        tokenPrefix: getOAuthAccessTokenPrefix(accessTokenRaw),
        tokenHash: accessTokenHash,
        scopes,
        expiresAt: accessTokenExpiresAt
      }
    })
    const nextRefreshToken = await tx.oAuthRefreshToken.create({
      data: {
        appId: app.id,
        userId: refreshToken.userId,
        grantId: refreshToken.grantId,
        tokenPrefix: getOAuthRefreshTokenPrefix(nextRefreshTokenRaw),
        tokenHash: nextRefreshTokenHash,
        scopes,
        expiresAt: refreshTokenExpiresAt
      }
    })
    return { accessToken, refreshToken: nextRefreshToken }
  })

  return {
    accessToken: accessTokenRaw,
    refreshToken: nextRefreshTokenRaw,
    tokenType: 'Bearer' as const,
    expiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshExpiresIn: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    scope: serializeScopes(result.accessToken.scopes).join(' '),
    accessTokenRecord: result.accessToken
  }
}

export async function revokeOAuthAccessToken(rawToken: string): Promise<OAuthAccessToken | null> {
  const tokenHash = hashOAuthSecret(rawToken)
  const token = await prisma.oAuthAccessToken.findUnique({ where: { tokenHash } })
  if (!token) return null
  if (token.revokedAt) return token
  return await prisma.oAuthAccessToken.update({
    where: { id: token.id },
    data: { revokedAt: new Date() }
  })
}

export async function revokeOAuthToken(rawToken: string): Promise<{ userId: number } | null> {
  const tokenHash = hashOAuthSecret(rawToken)
  const accessToken = await revokeOAuthAccessToken(rawToken)
  if (accessToken) return { userId: accessToken.userId }
  const refreshToken = await prisma.oAuthRefreshToken.findUnique({ where: { tokenHash } })
  if (!refreshToken) return null
  if (refreshToken.revokedAt) return { userId: refreshToken.userId }
  const revoked = await prisma.oAuthRefreshToken.update({
    where: { id: refreshToken.id },
    data: { revokedAt: new Date() }
  })
  return { userId: revoked.userId }
}

export async function listOAuthAuthorizations(userId: number) {
  return await prisma.oAuthGrant.findMany({
    where: { userId },
    orderBy: { lastAuthorizedAt: 'desc' },
    include: {
      app: { select: { id: true, name: true, clientId: true, enabled: true } }
    }
  })
}

export async function revokeOAuthAuthorization(userId: number, grantId: number) {
  return await prisma.$transaction(async tx => {
    const grant = await tx.oAuthGrant.findFirst({
      where: { id: grantId, userId },
      include: { app: { select: { id: true, name: true, clientId: true, enabled: true } } }
    })
    if (!grant) return null
    const revokedAt = new Date()
    const revokedGrant = await tx.oAuthGrant.update({
      where: { id: grant.id },
      data: { revokedAt },
      include: { app: { select: { id: true, name: true, clientId: true, enabled: true } } }
    })
    await tx.oAuthAccessToken.updateMany({
      where: { grantId: grant.id, revokedAt: null },
      data: { revokedAt }
    })
    await tx.oAuthRefreshToken.updateMany({
      where: { grantId: grant.id, revokedAt: null },
      data: { revokedAt }
    })
    return revokedGrant
  })
}

export async function revokeOAuthAuthorizationById(grantId: number) {
  return await prisma.$transaction(async tx => {
    const grant = await tx.oAuthGrant.findUnique({
      where: { id: grantId },
      include: {
        app: { select: { id: true, name: true, clientId: true, enabled: true } },
        user: { select: { id: true, username: true, email: true, role: true, status: true } }
      }
    })
    if (!grant) return null
    const revokedAt = new Date()
    const revokedGrant = await tx.oAuthGrant.update({
      where: { id: grant.id },
      data: { revokedAt },
      include: {
        app: { select: { id: true, name: true, clientId: true, enabled: true } },
        user: { select: { id: true, username: true, email: true, role: true, status: true } }
      }
    })
    await tx.oAuthAccessToken.updateMany({
      where: { grantId: grant.id, revokedAt: null },
      data: { revokedAt }
    })
    await tx.oAuthRefreshToken.updateMany({
      where: { grantId: grant.id, revokedAt: null },
      data: { revokedAt }
    })
    return revokedGrant
  })
}

export function readOAuthProviderRequestBody(body: unknown): Record<string, unknown> {
  return isRecord(body) ? body : {}
}
