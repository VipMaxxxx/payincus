import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import {
  createOAuthClientApp,
  deleteOAuthClientApp,
  listAdminOAuthAuthorizations,
  listOAuthClientApps,
  normalizeOAuthAppName,
  normalizeOAuthRedirectUris,
  normalizeOAuthScopes,
  revokeOAuthAuthorizationById,
  rotateOAuthClientSecret,
  serializeAdminOAuthAuthorization,
  serializeOAuthClientApp,
  updateOAuthClientApp
} from '../lib/oauth-provider.js'

interface OAuthAppBody {
  name?: unknown
  redirectUris?: unknown
  scopes?: unknown
  enabled?: unknown
}

interface OAuthAppParams {
  id: string
}

interface AdminOAuthAuthorizationQuery {
  appId?: string
  user?: string
  status?: string
  page?: string
  pageSize?: string
}

interface OAuthAuthorizationParams {
  id: string
}

function getRequestUser(request: FastifyRequest): { id: number; username: string; role: 'admin' | 'user' } {
  return request.user as { id: number; username: string; role: 'admin' | 'user' }
}

function parsePositiveId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function normalizeAppPayload(body: OAuthAppBody) {
  const name = normalizeOAuthAppName(body.name)
  const redirectUris = normalizeOAuthRedirectUris(body.redirectUris)
  const scopes = normalizeOAuthScopes(body.scopes)
  if (!name) throw new Error('Invalid OAuth app name')
  if (!redirectUris) throw new Error('Invalid OAuth redirect URIs')
  if (!scopes) throw new Error('Invalid OAuth scopes')
  return {
    name,
    redirectUris,
    scopes,
    enabled: body.enabled !== false
  }
}

export default async function adminOAuthAppRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: AdminOAuthAuthorizationQuery }>('/authorizations', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const appId = request.query.appId ? parsePositiveId(request.query.appId) : null
    const status = ['active', 'revoked', 'disabled'].includes(request.query.status || '')
      ? request.query.status as 'active' | 'revoked' | 'disabled'
      : 'all'
    return await listAdminOAuthAuthorizations({
      appId,
      user: request.query.user || null,
      status,
      page: request.query.page ? parsePositiveId(request.query.page) || 1 : 1,
      pageSize: request.query.pageSize ? parsePositiveId(request.query.pageSize) || 20 : 20
    })
  })

  fastify.delete<{ Params: OAuthAuthorizationParams }>('/authorizations/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid OAuth authorization id', code: 'INVALID_OAUTH_AUTHORIZATION_ID' })
    const grant = await revokeOAuthAuthorizationById(id)
    if (!grant) return reply.code(404).send({ error: 'OAuth authorization not found', code: 'OAUTH_AUTHORIZATION_NOT_FOUND' })
    const user = getRequestUser(request)
    await createLog(user.id, LogModule.SECURITY, 'oauth_provider.admin_authorization_revoke', `Admin revoked OAuth authorization #${grant.id} for app "${grant.app.name}"`, LogResult.SUCCESS)
    return {
      authorization: serializeAdminOAuthAuthorization(grant, {
        activeAccessTokens: 0,
        activeRefreshTokens: 0
      })
    }
  })

  fastify.get('/', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const apps = await listOAuthClientApps()
    return { apps: apps.map(serializeOAuthClientApp) }
  })

  fastify.post<{ Body: OAuthAppBody }>('/', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const user = getRequestUser(request)
    try {
      const payload = normalizeAppPayload(request.body || {})
      const result = await createOAuthClientApp({
        ...payload,
        createdByUserId: user.id
      })
      await createLog(user.id, LogModule.SECURITY, 'oauth_provider.app_create', `Created OAuth app "${payload.name}"`, LogResult.SUCCESS)
      return reply.code(201).send({
        app: serializeOAuthClientApp(result.app),
        clientSecret: result.clientSecret
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'INVALID_OAUTH_APP' })
    }
  })

  fastify.put<{ Params: OAuthAppParams; Body: OAuthAppBody }>('/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid OAuth app id', code: 'INVALID_OAUTH_APP_ID' })
    try {
      const payload = normalizeAppPayload(request.body || {})
      const app = await updateOAuthClientApp(id, payload)
      const user = getRequestUser(request)
      await createLog(user.id, LogModule.SECURITY, 'oauth_provider.app_update', `Updated OAuth app "${payload.name}"`, LogResult.SUCCESS)
      return { app: serializeOAuthClientApp(app) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'OAUTH_APP_UPDATE_FAILED' })
    }
  })

  fastify.post<{ Params: OAuthAppParams }>('/:id/rotate-secret', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid OAuth app id', code: 'INVALID_OAUTH_APP_ID' })
    try {
      const result = await rotateOAuthClientSecret(id)
      const user = getRequestUser(request)
      await createLog(user.id, LogModule.SECURITY, 'oauth_provider.app_secret_rotate', `Rotated OAuth app secret for "${result.app.name}"`, LogResult.SUCCESS)
      return {
        app: serializeOAuthClientApp(result.app),
        clientSecret: result.clientSecret
      }
    } catch {
      return reply.code(404).send({ error: 'OAuth app not found', code: 'OAUTH_APP_NOT_FOUND' })
    }
  })

  fastify.delete<{ Params: OAuthAppParams }>('/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid OAuth app id', code: 'INVALID_OAUTH_APP_ID' })
    try {
      await deleteOAuthClientApp(id)
      const user = getRequestUser(request)
      await createLog(user.id, LogModule.SECURITY, 'oauth_provider.app_delete', `Deleted OAuth app #${id}`, LogResult.SUCCESS)
      return { message: 'OAuth app deleted' }
    } catch {
      return reply.code(404).send({ error: 'OAuth app not found', code: 'OAUTH_APP_NOT_FOUND' })
    }
  })
}
