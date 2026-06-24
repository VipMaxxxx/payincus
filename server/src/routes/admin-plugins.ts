import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  appendPluginTaskLog,
  createPluginTask,
  disablePlugin,
  enablePlugin,
  getPlugin,
  getPluginConfigs,
  getPluginTask,
  installValidatedPlugin,
  listPluginTasks,
  listPlugins,
  markPluginTaskFinished,
  markPluginTaskRunning,
  serializePlugin,
  serializePluginConfig,
  serializePluginTask,
  uninstallPlugin,
  updatePluginConfigs
} from '../db/plugins.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { assertMarketEntryInstallable, downloadMarketPlugin, fetchPluginMarketIndex } from '../lib/plugin-market.js'
import { getPluginLogDir, getPluginPackageMaxBytes, getPluginStagingDir, validateAndExtractPluginPackage } from '../lib/plugin-package.js'

interface PluginParams {
  pluginId: string
}

interface TaskParams {
  id: string
}

interface MarketInstallBody {
  pluginId: string
}

interface ConfigUpdateBody {
  configs: Array<{ key: string; value: unknown; isSecret?: boolean }>
}

function getRequestUser(request: FastifyRequest): { id: number; username: string; role: 'admin' | 'user' } {
  return request.user as { id: number; username: string; role: 'admin' | 'user' }
}

function parsePositiveId(value: string): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizePluginId(value: string): string | null {
  const trimmed = value.trim()
  return /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/.test(trimmed) ? trimmed : null
}

function getAllowedPluginManagerAdminIds(): Set<number> {
  return new Set(
    (process.env.PLUGIN_MANAGER_ALLOWED_ADMIN_IDS || process.env.SYSTEM_UPDATE_ALLOWED_ADMIN_IDS || '')
      .split(',')
      .map(item => Number(item.trim()))
      .filter(id => Number.isSafeInteger(id) && id > 0)
  )
}

function canManagePlugins(user: { id: number; username: string; role: 'admin' | 'user' }): boolean {
  if (user.role !== 'admin') return false
  const allowedIds = getAllowedPluginManagerAdminIds()
  if (allowedIds.size > 0) return allowedIds.has(user.id)
  return user.username === 'admin'
}

async function requirePluginManager(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = getRequestUser(request)
  if (!canManagePlugins(user)) {
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'plugin.manager.denied',
      `Denied plugin management access for ${user.username}`,
      LogResult.WARNING
    )
    reply.code(403).send({ error: 'Super administrator privileges required', code: 'SUPER_ADMIN_REQUIRED' })
    return false
  }
  return true
}

function validateLogPath(taskLogPath: string): string {
  const logDir = resolve(getPluginLogDir())
  const logPath = resolve(taskLogPath)
  if (logPath !== logDir && !logPath.startsWith(`${logDir}${sep}`)) {
    throw new Error('Plugin task log path is outside plugin log directory')
  }
  return logPath
}

async function writeUploadPackage(request: FastifyRequest): Promise<{ packagePath: string; sourceName: string }> {
  const multipartRequest = request as FastifyRequest & {
    parts: () => AsyncIterable<any>
  }
  const uploadDir = join(getPluginStagingDir(), 'uploads')
  await mkdir(uploadDir, { recursive: true })
  const maxBytes = getPluginPackageMaxBytes()

  for await (const part of multipartRequest.parts()) {
    if (part.type !== 'file') continue
    if (part.fieldname !== 'package') {
      await part.toBuffer()
      continue
    }
    const filename = String(part.filename || 'plugin.tar.gz')
    if (!filename.endsWith('.tar.gz')) {
      throw new Error('Plugin package must be a .tar.gz file')
    }
    const buffer = await part.toBuffer()
    if (buffer.length === 0) throw new Error('Plugin package is empty')
    if (buffer.length > maxBytes) throw new Error(`Plugin package exceeds ${Math.round(maxBytes / 1024 / 1024)}MB`)
    const packagePath = join(uploadDir, `${Date.now()}-${randomUUID()}.tar.gz`)
    await writeFile(packagePath, buffer, { mode: 0o600 })
    return { packagePath, sourceName: filename }
  }

  throw new Error('Missing plugin package file')
}

async function installPackage(input: {
  packagePath: string
  sourceType: 'upload' | 'market'
  sourceUrl?: string | null
  sourceRepo?: string | null
  userId: number
}) {
  const task = await createPluginTask({
    action: input.sourceType === 'market' ? 'market_install' : 'upload_install',
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl || null,
    startedByUserId: input.userId
  })
  const logPath = join(getPluginLogDir(), `plugin-task-${task.id}.log`)
  await markPluginTaskRunning(task.id, logPath)
  try {
    await appendPluginTaskLog(logPath, `Validating ${input.sourceType} plugin package`)
    const validated = await validateAndExtractPluginPackage(input.packagePath, task.id)
    await appendPluginTaskLog(logPath, `Validated plugin ${validated.manifest.id}@${validated.manifest.version}`)
    await installValidatedPlugin({
      taskId: task.id,
      stagingDir: validated.stagingDir,
      manifest: validated.manifest,
      packageSha256: validated.sha256,
      sourceType: input.sourceType,
      sourceRepo: input.sourceRepo || null,
      installedByUserId: input.userId,
      logPath
    })
    await markPluginTaskFinished(task.id, 'success')
    return await getPluginTask(task.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendPluginTaskLog(logPath, `FAILED: ${message}`).catch(() => undefined)
    await markPluginTaskFinished(task.id, 'failed', message)
    throw error
  }
}

function normalizeConfigUpdates(body: ConfigUpdateBody): Array<{ key: string; value: unknown; isSecret?: boolean }> {
  if (!Array.isArray(body.configs)) throw new Error('configs must be an array')
  return body.configs.slice(0, 100).map(item => {
    const key = String(item.key || '').trim()
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(key)) throw new Error('Invalid plugin config key')
    return { key, value: item.value ?? null, isSecret: item.isSecret === true }
  })
}

export default async function adminPluginRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const plugins = await listPlugins()
    return { plugins: plugins.map(serializePlugin) }
  })

  fastify.get('/market', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    return await fetchPluginMarketIndex()
  })

  fastify.get('/tasks', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const tasks = await listPluginTasks(50)
    return { tasks: tasks.map(serializePluginTask) }
  })

  fastify.get<{ Params: TaskParams }>('/tasks/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid task id', code: 'INVALID_TASK_ID' })
    const task = await getPluginTask(id)
    if (!task) return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    return { task: serializePluginTask(task) }
  })

  fastify.get<{ Params: TaskParams }>('/tasks/:id/logs', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid task id', code: 'INVALID_TASK_ID' })
    const task = await getPluginTask(id)
    if (!task) return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    if (!task.logPath) return { logs: '' }
    const logPath = validateLogPath(task.logPath)
    try {
      const logs = await readFile(logPath, 'utf8')
      return { logs: logs.slice(-200000) }
    } catch {
      return { logs: '' }
    }
  })

  fastify.post('/upload', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    try {
      const upload = await writeUploadPackage(request)
      const user = getRequestUser(request)
      const task = await installPackage({
        packagePath: upload.packagePath,
        sourceType: 'upload',
        sourceUrl: upload.sourceName,
        userId: user.id
      })
      await createLog(user.id, LogModule.PLUGIN, 'plugin.upload_install', `Installed uploaded plugin package ${upload.sourceName}`, LogResult.SUCCESS)
      return reply.code(202).send({ task: task ? serializePluginTask(task) : null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'PLUGIN_UPLOAD_FAILED' })
    }
  })

  fastify.post<{ Body: MarketInstallBody }>('/market/install', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['pluginId'],
        additionalProperties: false,
        properties: {
          pluginId: { type: 'string', minLength: 5, maxLength: 120 }
        }
      }
    }
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const pluginId = normalizePluginId(request.body.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const market = await fetchPluginMarketIndex()
    const entry = market.plugins.find(item => item.id === pluginId)
    if (!entry) return reply.code(404).send({ error: 'Plugin not found in market', code: 'PLUGIN_MARKET_ENTRY_NOT_FOUND' })
    try {
      await assertMarketEntryInstallable(entry)
      const packagePath = await downloadMarketPlugin(entry)
      const user = getRequestUser(request)
      const task = await installPackage({
        packagePath,
        sourceType: 'market',
        sourceUrl: entry.downloadUrl,
        sourceRepo: entry.repo,
        userId: user.id
      })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'plugin.market_install',
        `Installed market plugin ${entry.id} (${entry.reviewStatus}/${entry.trustLevel}, sha256 ${entry.sha256.slice(0, 12)})`,
        LogResult.SUCCESS
      )
      return reply.code(202).send({ task: task ? serializePluginTask(task) : null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'PLUGIN_MARKET_INSTALL_FAILED' })
    }
  })

  fastify.get<{ Params: PluginParams }>('/:pluginId', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const plugin = await getPlugin(pluginId)
    if (!plugin) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    return {
      plugin: serializePlugin(plugin),
      versions: plugin.versions.map(version => ({
        id: version.id,
        version: version.version,
        manifest: version.manifest,
        packageSha256: version.packageSha256,
        installPath: version.installPath,
        installedAt: version.installedAt.toISOString()
      })),
      configs: plugin.configs.map(serializePluginConfig),
      tasks: plugin.tasks.map(serializePluginTask),
      eventLogs: plugin.eventLogs.map(log => ({
        id: log.id,
        pluginId: log.pluginId,
        userId: log.userId,
        action: log.action,
        result: log.result,
        message: log.message,
        createdAt: log.createdAt.toISOString()
      }))
    }
  })

  fastify.post<{ Params: PluginParams }>('/:pluginId/enable', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const user = getRequestUser(request)
    const plugin = await enablePlugin(pluginId, user.id)
    return { plugin: serializePlugin(plugin) }
  })

  fastify.post<{ Params: PluginParams }>('/:pluginId/disable', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const user = getRequestUser(request)
    const plugin = await disablePlugin(pluginId, user.id)
    return { plugin: serializePlugin(plugin) }
  })

  fastify.delete<{ Params: PluginParams }>('/:pluginId', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const user = getRequestUser(request)
    await uninstallPlugin(pluginId, user.id)
    return { message: 'Plugin uninstalled' }
  })

  fastify.get<{ Params: PluginParams }>('/:pluginId/config', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const plugin = await getPlugin(pluginId)
    if (!plugin) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const configs = await getPluginConfigs(pluginId)
    return { configs: configs.map(serializePluginConfig) }
  })

  fastify.put<{ Params: PluginParams; Body: ConfigUpdateBody }>('/:pluginId/config', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['configs'],
        additionalProperties: false,
        properties: {
          configs: { type: 'array', maxItems: 100 }
        }
      }
    }
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const plugin = await getPlugin(pluginId)
    if (!plugin) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const configs = await updatePluginConfigs(pluginId, normalizeConfigUpdates(request.body))
    return { configs: configs.map(serializePluginConfig) }
  })
}
