import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { listPublicApiScopeMetadata } from '../lib/public-api-auth.js'
import {
  createOAuthAuthorizationCode,
  exchangeOAuthRefreshToken,
  exchangeOAuthAuthorizationCode,
  listOAuthAuthorizations,
  normalizeOAuthRedirectUris,
  normalizeOAuthScopes,
  prepareOAuthAuthorizationRequest,
  readOAuthProviderRequestBody,
  revokeOAuthAuthorization,
  revokeOAuthToken,
  serializeOAuthAuthorization
} from '../lib/oauth-provider.js'

interface AuthorizeBody {
  responseType?: unknown
  response_type?: unknown
  clientId?: unknown
  client_id?: unknown
  redirectUri?: unknown
  redirect_uri?: unknown
  scope?: unknown
  scopes?: unknown
  state?: unknown
  confirmed?: unknown
}

interface AuthorizeQuery {
  response_type?: string
  responseType?: string
  client_id?: string
  clientId?: string
  redirect_uri?: string
  redirectUri?: string
  scope?: string
  state?: string
}

interface TokenBody {
  grantType?: unknown
  grant_type?: unknown
  clientId?: unknown
  client_id?: unknown
  clientSecret?: unknown
  client_secret?: unknown
  code?: unknown
  redirectUri?: unknown
  redirect_uri?: unknown
  refreshToken?: unknown
  refresh_token?: unknown
}

interface RevokeBody {
  token?: unknown
}

interface AuthorizationParams {
  id: string
}

function getRequestUser(request: FastifyRequest): { id: number; username: string } {
  return request.user as { id: number; username: string }
}

function stringValue(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

function normalizeRedirectUri(value: unknown): string | null {
  const normalized = normalizeOAuthRedirectUris([value])
  return normalized?.[0] || null
}

function parsePositiveId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function buildAuthorizationErrorRedirect(redirectUri: string, state: string | null, error: string, description: string) {
  const redirect = new URL(redirectUri)
  redirect.searchParams.set('error', error)
  redirect.searchParams.set('error_description', description)
  if (state) redirect.searchParams.set('state', state)
  return redirect.toString()
}

function readAuthorizeInput(body: AuthorizeBody | AuthorizeQuery) {
  const responseType = stringValue(body.responseType || body.response_type || 'code', 20)
  const clientId = stringValue(body.clientId || body.client_id, 120)
  const redirectUri = normalizeRedirectUri(body.redirectUri || body.redirect_uri)
  const scopesValue = 'scopes' in body ? body.scope || body.scopes : body.scope
  const scopes = normalizeOAuthScopes(scopesValue || 'profile:read')
  const state = stringValue(body.state, 500)
  return { responseType, clientId, redirectUri, scopes, state }
}

export default async function oauthProviderRoutes(fastify: FastifyInstance) {
  fastify.get('/scopes', async () => {
    return {
      scopes: listPublicApiScopeMetadata(),
      updatedAt: new Date().toISOString()
    }
  })

  fastify.get<{ Querystring: AuthorizeQuery }>('/authorize/consent', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const input = readAuthorizeInput(request.query || {})
    if (input.responseType !== 'code') return reply.code(400).send({ error: 'Unsupported response_type', code: 'UNSUPPORTED_RESPONSE_TYPE' })
    if (!input.clientId) return reply.code(400).send({ error: 'Invalid client_id', code: 'INVALID_CLIENT_ID' })
    if (!input.redirectUri) return reply.code(400).send({ error: 'Invalid redirect_uri', code: 'INVALID_REDIRECT_URI' })
    if (!input.scopes) return reply.code(400).send({ error: 'Invalid scope', code: 'INVALID_SCOPE' })
    try {
      const user = getRequestUser(request)
      const prepared = await prepareOAuthAuthorizationRequest({
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        scopes: input.scopes,
        userId: user.id
      })
      return {
        app: {
          id: prepared.app.id,
          name: prepared.app.name,
          clientId: prepared.app.clientId
        },
        requestedScopes: prepared.requestedScopes,
        scopeMetadata: listPublicApiScopeMetadata(prepared.requestedScopes),
        existingScopes: prepared.existingGrant && !prepared.existingGrant.revokedAt
          ? normalizeOAuthScopes(prepared.existingGrant.scopes) || []
          : [],
        consentRequired: prepared.consentRequired,
        request: {
          responseType: input.responseType,
          clientId: input.clientId,
          redirectUri: input.redirectUri,
          scope: input.scopes.join(' '),
          state: input.state
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'OAUTH_CONSENT_FAILED' })
    }
  })

  fastify.post<{ Body: AuthorizeBody }>('/authorize', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const body = readOAuthProviderRequestBody(request.body)
    const input = readAuthorizeInput(body)
    if (input.responseType !== 'code') return reply.code(400).send({ error: 'Unsupported response_type', code: 'UNSUPPORTED_RESPONSE_TYPE' })
    if (!input.clientId) return reply.code(400).send({ error: 'Invalid client_id', code: 'INVALID_CLIENT_ID' })
    if (!input.redirectUri) return reply.code(400).send({ error: 'Invalid redirect_uri', code: 'INVALID_REDIRECT_URI' })
    if (!input.scopes) return reply.code(400).send({ error: 'Invalid scope', code: 'INVALID_SCOPE' })

    try {
      const user = getRequestUser(request)
      const prepared = await prepareOAuthAuthorizationRequest({
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        scopes: input.scopes,
        userId: user.id
      })
      if (prepared.consentRequired && body.confirmed !== true) {
        return reply.code(428).send({
          error: 'OAuth consent required',
          code: 'OAUTH_CONSENT_REQUIRED',
          consentUrl: `/oauth/authorize?client_id=${encodeURIComponent(input.clientId)}&redirect_uri=${encodeURIComponent(input.redirectUri)}&scope=${encodeURIComponent(input.scopes.join(' '))}${input.state ? `&state=${encodeURIComponent(input.state)}` : ''}`
        })
      }
      const authorization = await createOAuthAuthorizationCode({
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        scopes: input.scopes,
        state: input.state,
        userId: user.id
      })
      await createLog(
        user.id,
        LogModule.SECURITY,
        'oauth_provider.authorize',
        `Issued OAuth authorization code for ${input.clientId} with scopes: ${input.scopes.join(' ')}`,
        LogResult.SUCCESS
      )
      return authorization
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'OAUTH_AUTHORIZE_FAILED' })
    }
  })

  fastify.post<{ Body: AuthorizeBody }>('/authorize/confirm', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const body = readOAuthProviderRequestBody(request.body)
    const input = readAuthorizeInput(body)
    if (input.responseType !== 'code') return reply.code(400).send({ error: 'Unsupported response_type', code: 'UNSUPPORTED_RESPONSE_TYPE' })
    if (!input.clientId) return reply.code(400).send({ error: 'Invalid client_id', code: 'INVALID_CLIENT_ID' })
    if (!input.redirectUri) return reply.code(400).send({ error: 'Invalid redirect_uri', code: 'INVALID_REDIRECT_URI' })
    if (!input.scopes) return reply.code(400).send({ error: 'Invalid scope', code: 'INVALID_SCOPE' })
    if (body.confirmed !== true) {
      return { redirectTo: buildAuthorizationErrorRedirect(input.redirectUri, input.state, 'access_denied', 'The user denied the authorization request') }
    }
    try {
      const user = getRequestUser(request)
      const authorization = await createOAuthAuthorizationCode({
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        scopes: input.scopes,
        state: input.state,
        userId: user.id
      })
      await createLog(
        user.id,
        LogModule.SECURITY,
        'oauth_provider.consent_approve',
        `Approved OAuth app ${input.clientId} with scopes: ${input.scopes.join(' ')}`,
        LogResult.SUCCESS
      )
      return authorization
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'OAUTH_AUTHORIZE_FAILED' })
    }
  })

  fastify.post<{ Body: TokenBody }>('/token', async (request, reply) => {
    const body = readOAuthProviderRequestBody(request.body)
    const grantType = stringValue(body.grantType || body.grant_type, 80)
    const clientId = stringValue(body.clientId || body.client_id, 120)
    const clientSecret = stringValue(body.clientSecret || body.client_secret, 200)
    const code = stringValue(body.code, 200)
    const redirectUri = normalizeRedirectUri(body.redirectUri || body.redirect_uri)
    const refreshToken = stringValue(body.refreshToken || body.refresh_token, 200)
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') return reply.code(400).send({ error: 'Unsupported grant_type', code: 'UNSUPPORTED_GRANT_TYPE' })
    if (!clientId || !clientSecret) {
      return reply.code(400).send({ error: 'Invalid OAuth token request', code: 'INVALID_OAUTH_TOKEN_REQUEST' })
    }

    try {
      const result = grantType === 'authorization_code'
        ? (!code || !redirectUri
            ? null
            : await exchangeOAuthAuthorizationCode({
              clientId,
              clientSecret,
              code,
              redirectUri
            }))
        : (!refreshToken
            ? null
            : await exchangeOAuthRefreshToken({
              clientId,
              clientSecret,
              refreshToken
            }))
      if (!result) return reply.code(400).send({ error: 'Invalid OAuth token request', code: 'INVALID_OAUTH_TOKEN_REQUEST' })
      await createLog(
        result.accessTokenRecord.userId,
        LogModule.SECURITY,
        grantType === 'authorization_code' ? 'oauth_provider.token_exchange' : 'oauth_provider.token_refresh',
        grantType === 'authorization_code' ? `Exchanged OAuth authorization code for ${clientId}` : `Refreshed OAuth access token for ${clientId}`,
        LogResult.SUCCESS
      )
      return {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: result.tokenType,
        expires_in: result.expiresIn,
        refresh_token_expires_in: result.refreshExpiresIn,
        scope: result.scope
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'OAUTH_TOKEN_EXCHANGE_FAILED' })
    }
  })

  fastify.post<{ Body: RevokeBody }>('/revoke', async (request, reply) => {
    const body = readOAuthProviderRequestBody(request.body)
    const token = stringValue(body.token, 200)
    if (!token) return reply.code(400).send({ error: 'Invalid token', code: 'INVALID_TOKEN' })
    const revoked = await revokeOAuthToken(token)
    if (revoked) {
      await createLog(
        revoked.userId,
        LogModule.SECURITY,
        'oauth_provider.token_revoke',
        'Revoked OAuth access token',
        LogResult.SUCCESS
      )
    }
    return { message: 'Token revoked' }
  })

  fastify.get('/authorizations', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest) => {
    const user = getRequestUser(request)
    const grants = await listOAuthAuthorizations(user.id)
    return { authorizations: grants.map(serializeOAuthAuthorization) }
  })

  fastify.delete<{ Params: AuthorizationParams }>('/authorizations/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = getRequestUser(request)
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid authorization id', code: 'INVALID_AUTHORIZATION_ID' })
    const grant = await revokeOAuthAuthorization(user.id, id)
    if (!grant) return reply.code(404).send({ error: 'OAuth authorization not found', code: 'OAUTH_AUTHORIZATION_NOT_FOUND' })
    await createLog(
      user.id,
      LogModule.SECURITY,
      'oauth_provider.authorization_revoke',
      `Revoked OAuth authorization for ${grant.app.name}`,
      LogResult.SUCCESS
    )
    return { authorization: serializeOAuthAuthorization(grant) }
  })
}
