import { readFile } from 'fs/promises'
import { extname } from 'path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getPlugin, getPluginConfigs } from '../db/plugins.js'
import { resolveInside } from '../lib/plugin-package.js'
import type { PayIncusPluginManifest } from '../lib/plugin-manifest.js'

interface PluginParams {
  pluginId: string
}

interface PluginActionParams {
  pluginId: string
  action: string
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

  fastify.get('/assets/:pluginId/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { pluginId?: string; '*': string }
    const pluginId = params.pluginId ? normalizePluginId(params.pluginId) : null
    const assetPath = params['*'] || ''
    if (!pluginId || !assetPath || assetPath.startsWith('/') || assetPath.includes('..') || assetPath.includes('\\')) {
      return reply.code(400).send({ error: 'Invalid plugin asset path', code: 'INVALID_PLUGIN_ASSET_PATH' })
    }
    const plugin = await getPlugin(pluginId)
    if (!plugin || !plugin.enabled || plugin.status !== 'enabled') {
      return reply.code(404).send({ error: 'Plugin asset not found', code: 'PLUGIN_ASSET_NOT_FOUND' })
    }
    const latest = latestManifest(plugin)
    if (!latest) return reply.code(404).send({ error: 'Plugin asset not found', code: 'PLUGIN_ASSET_NOT_FOUND' })

    try {
      const filePath = resolveInside(latest.installPath, assetPath)
      const body = await readFile(filePath)
      reply
        .type(contentTypeForPath(assetPath))
        .header('Cache-Control', 'private, max-age=60')
        .header('X-Content-Type-Options', 'nosniff')
        .send(body)
    } catch {
      return reply.code(404).send({ error: 'Plugin asset not found', code: 'PLUGIN_ASSET_NOT_FOUND' })
    }
  })
}
