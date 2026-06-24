import { readFile } from 'fs/promises'
import { extname } from 'path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getPlugin, getPluginConfigs } from '../db/plugins.js'
import { prisma } from '../db/prisma.js'
import { resolveInside } from '../lib/plugin-package.js'
import { isAccessTokenInvalidated } from '../lib/security.js'
import type { PayIncusPluginManifest } from '../lib/plugin-manifest.js'

interface PluginParams {
  pluginId: string
}

interface PluginActionParams {
  pluginId: string
  action: string
}

interface AssetQuery {
  assetToken?: string
}

interface AssetTokenBody {
  pluginId?: string
  assetPath?: string
}

function normalizePluginId(value: string): string | null {
  const trimmed = value.trim()
  return /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/.test(trimmed) ? trimmed : null
}

function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'application/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

function latestManifest(plugin: Awaited<ReturnType<typeof getPlugin>>): { manifest: PayIncusPluginManifest; installPath: string } | null {
  const version = plugin?.versions?.[0]
  if (!version) return null
  return {
    manifest: version.manifest as unknown as PayIncusPluginManifest,
    installPath: version.installPath
  }
}

function getProtectedAssetPolicy(manifest: PayIncusPluginManifest, assetPath: string): { requiresAuth: boolean; adminOnly: boolean } {
  for (const page of manifest.entrypoints?.adminPages || []) {
    if (page.entry === assetPath) {
      return { requiresAuth: true, adminOnly: true }
    }
  }

  for (const page of manifest.entrypoints?.userPages || []) {
    if (page.entry === assetPath && page.requiresAuth === true) {
      return { requiresAuth: true, adminOnly: false }
    }
  }

  return { requiresAuth: false, adminOnly: false }
}

function getAssetBearerToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization
  if (auth?.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim() || null
  }

  return null
}

async function authenticateProtectedAsset(
  fastify: FastifyInstance,
  request: FastifyRequest<{ Querystring: AssetQuery }>,
  reply: FastifyReply,
  pluginId: string,
  assetPath: string,
  adminOnly: boolean
): Promise<boolean> {
  const assetToken = typeof request.query.assetToken === 'string' ? request.query.assetToken.trim() : ''
  if (assetToken) {
    try {
      const decoded = fastify.jwt.verify<{
        kind?: string
        pluginId?: string
        assetPath?: string
        id?: number
        sid?: string
        iat?: number
      }>(assetToken)
      if (
        decoded.kind !== 'plugin_asset' ||
        decoded.pluginId !== pluginId ||
        decoded.assetPath !== assetPath ||
        !decoded.id ||
        !decoded.iat
      ) {
        reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
        return false
      }
      if (await isAccessTokenInvalidated(decoded.id, decoded.iat, decoded.sid)) {
        reply.code(401).send({ error: 'Session expired', code: 'SESSION_INVALIDATED' })
        return false
      }
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { role: true, status: true }
      })
      if (!user || user.status !== 'active') {
        reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
        return false
      }
      if (adminOnly && user.role !== 'admin') {
        reply.code(403).send({ error: 'Admin privileges required', code: 'ADMIN_REQUIRED' })
        return false
      }
      return true
    } catch {
      reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
      return false
    }
  }

  const token = getAssetBearerToken(request)
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return false
  }

  try {
    const decoded = fastify.jwt.verify<{
      id?: number
      sid?: string
      iat?: number
    }>(token)
    if (!decoded.id || !decoded.iat) {
      reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
      return false
    }

    if (await isAccessTokenInvalidated(decoded.id, decoded.iat, decoded.sid)) {
      reply.code(401).send({ error: 'Session expired', code: 'SESSION_INVALIDATED' })
      return false
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { role: true, status: true }
    })

    if (!user || user.status !== 'active') {
      reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
      return false
    }

    if (adminOnly && user.role !== 'admin') {
      reply.code(403).send({ error: 'Admin privileges required', code: 'ADMIN_REQUIRED' })
      return false
    }

    return true
  } catch {
    reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return false
  }
}

async function loadEnabledPluginManifest(pluginId: string) {
  const plugin = await getPlugin(pluginId)
  if (!plugin || !plugin.enabled || plugin.status !== 'enabled') return null
  const latest = latestManifest(plugin)
  return latest ? { plugin, latest } : null
}

function publicConfigValue(value: unknown): unknown {
  if (value && typeof value === 'object') return value
  return value ?? null
}

export default async function pluginRoutes(fastify: FastifyInstance) {
  fastify.get('/enabled-client-extensions', {
    onRequest: [fastify.authenticateUser]
  }, async () => {
    const plugins = await (await import('../db/prisma.js')).prisma.plugin.findMany({
      where: { enabled: true, status: 'enabled' },
      include: { versions: { orderBy: { installedAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' }
    })

    const extensions = []
    for (const plugin of plugins) {
      const version = plugin.versions[0]
      const manifest = version?.manifest as unknown as PayIncusPluginManifest | undefined
      for (const page of manifest?.entrypoints?.userPages || []) {
        extensions.push({
          pluginId: plugin.pluginId,
          pluginName: plugin.name,
          version: plugin.currentVersion,
          slot: page.slot,
          title: page.title,
          path: page.path || null,
          requiresAuth: page.requiresAuth === true,
          url: `/api/plugins/assets/${encodeURIComponent(plugin.pluginId)}/${page.entry}`
        })
      }
    }
    return { extensions }
  })

  fastify.get<{ Params: PluginParams }>('/:pluginId/config/public', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const plugin = await getPlugin(pluginId)
    if (!plugin || !plugin.enabled || plugin.status !== 'enabled') {
      return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    }
    const configs = await getPluginConfigs(pluginId)
    const publicConfig = Object.fromEntries(
      configs
        .filter(config => !config.isSecret)
        .map(config => [config.key, publicConfigValue(config.valueJson)])
    )
    return { config: publicConfig }
  })

  fastify.post<{ Params: PluginActionParams }>('/:pluginId/actions/:action', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const action = String(request.params.action || '').trim()
    if (!pluginId || !/^[A-Za-z0-9_.:-]{1,80}$/.test(action)) {
      return reply.code(400).send({ error: 'Invalid plugin action', code: 'INVALID_PLUGIN_ACTION' })
    }
    const plugin = await getPlugin(pluginId)
    if (!plugin || !plugin.enabled || plugin.status !== 'enabled') {
      return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    }
    return reply.code(501).send({
      error: 'Plugin backend actions are not enabled for this PayIncus version',
      code: 'PLUGIN_ACTION_NOT_IMPLEMENTED'
    })
  })

  fastify.post<{ Body: AssetTokenBody }>('/asset-token', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const pluginId = typeof request.body?.pluginId === 'string' ? normalizePluginId(request.body.pluginId) : null
    const assetPath = typeof request.body?.assetPath === 'string' ? request.body.assetPath.trim() : ''
    if (!pluginId || !assetPath || assetPath.startsWith('/') || assetPath.includes('..') || assetPath.includes('\\')) {
      return reply.code(400).send({ error: 'Invalid plugin asset path', code: 'INVALID_PLUGIN_ASSET_PATH' })
    }

    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) {
      return reply.code(404).send({ error: 'Plugin asset not found', code: 'PLUGIN_ASSET_NOT_FOUND' })
    }

    const assetPolicy = getProtectedAssetPolicy(loaded.latest.manifest, assetPath)
    if (assetPolicy.requiresAuth && assetPolicy.adminOnly && request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Admin privileges required', code: 'ADMIN_REQUIRED' })
    }

    const assetToken = fastify.jwt.sign({
      kind: 'plugin_asset',
      pluginId,
      assetPath,
      id: request.user.id,
      username: request.user.username,
      role: request.user.role,
      sid: request.user.sid
    } as { id: number; username: string; role: 'admin' | 'user'; sid?: string; kind: string; pluginId: string; assetPath: string }, { expiresIn: '60s' })

    return {
      assetToken,
      expiresIn: 60
    }
  })

  fastify.get('/assets/:pluginId/*', async (request: FastifyRequest<{ Querystring: AssetQuery }>, reply: FastifyReply) => {
    const params = request.params as { pluginId?: string; '*': string }
    const pluginId = params.pluginId ? normalizePluginId(params.pluginId) : null
    const assetPath = params['*'] || ''
    if (!pluginId || !assetPath || assetPath.startsWith('/') || assetPath.includes('..') || assetPath.includes('\\')) {
      return reply.code(400).send({ error: 'Invalid plugin asset path', code: 'INVALID_PLUGIN_ASSET_PATH' })
    }
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) {
      return reply.code(404).send({ error: 'Plugin asset not found', code: 'PLUGIN_ASSET_NOT_FOUND' })
    }
    const assetPolicy = getProtectedAssetPolicy(loaded.latest.manifest, assetPath)
    if (assetPolicy.requiresAuth && !await authenticateProtectedAsset(fastify, request, reply, pluginId, assetPath, assetPolicy.adminOnly)) {
      return
    }

    try {
      const filePath = resolveInside(loaded.latest.installPath, assetPath)
      const body = await readFile(filePath)
      reply
        .type(contentTypeForPath(assetPath))
        .header('Cache-Control', assetPolicy.requiresAuth ? 'private, no-store' : 'private, max-age=60')
        .header('Referrer-Policy', assetPolicy.requiresAuth ? 'no-referrer' : 'same-origin')
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Robots-Tag', 'noindex')
        .send(body)
    } catch {
      return reply.code(404).send({ error: 'Plugin asset not found', code: 'PLUGIN_ASSET_NOT_FOUND' })
    }
  })
}
