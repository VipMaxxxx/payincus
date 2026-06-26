import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { extname, join, resolve, sep } from 'path'
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
  serializePluginEventLog,
  serializePluginConfig,
  serializePluginTask,
  uninstallPlugin,
  updatePluginConfigs
} from '../db/plugins.js'
import { prisma } from '../db/prisma.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { assertMarketEntryInstallable, downloadMarketPlugin, fetchPluginMarketIndex } from '../lib/plugin-market.js'
import { getPluginDataDir, getPluginLogDir, getPluginPackageMaxBytes, getPluginStagingDir, resolveInside, validateAndExtractPluginPackage } from '../lib/plugin-package.js'
import { processDuePluginEventRetries, replayPluginEventLog } from '../lib/plugin-runtime.js'
import type { PayIncusPluginManifest, PluginConfigFieldManifest } from '../lib/plugin-manifest.js'
import { dispatchPluginLifecycleEvent } from '../lib/plugin-business-events.js'
import { getCombinedAdminIdAllowlist } from '../lib/runtime-settings.js'

interface PluginParams {
  pluginId: string
}

interface PluginConfigFileParams extends PluginParams {
  key: string
}

interface TaskParams {
  id: string
}

interface PluginEventQuery {
  result?: string
  pluginId?: string
  eventName?: string
  handler?: string
  limit?: string
}

interface MarketInstallBody {
  pluginId: string
}

interface ConfigUpdateBody {
  configs: Array<{ key: string; value: unknown; isSecret?: boolean }>
}

interface ActionRateLimitPolicyUpdateBody {
  policies: Array<{
    pluginId?: unknown
    actionName?: unknown
    rateLimit?: unknown
    maxRequests?: unknown
    windowSeconds?: unknown
    enabled?: unknown
  }>
}

interface PublicPluginActionRateLimitPolicyInput {
  pluginId: string
  actionName: string
  rateLimit: 'normal' | 'strict'
  maxRequests: number
  windowSeconds: number
  enabled: boolean
}

interface PublicPluginActionRateLimitPolicyRow extends PublicPluginActionRateLimitPolicyInput {
  id: number
  updatedByUserId: number | null
  createdAt: Date
  updatedAt: Date
}

const PLUGIN_CONFIG_FILE_MAX_BYTES = 2 * 1024 * 1024
const PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE = '*'
const PUBLIC_PLUGIN_ACTION_RATE_LIMIT_DEFAULTS = [
  { rateLimit: 'normal' as const, maxRequests: 30, windowSeconds: 60 },
  { rateLimit: 'strict' as const, maxRequests: 10, windowSeconds: 60 }
]
const PLUGIN_CONFIG_FILE_MIME_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp']
])

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

function normalizePluginEventName(value: string): string | null {
  const trimmed = value.trim()
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(trimmed) ? trimmed : null
}

function normalizePluginEventResult(value: string): string | null {
  const trimmed = value.trim()
  return ['pending', 'success', 'failed', 'retry_pending', 'dead_letter', 'duplicate_skipped'].includes(trimmed) ? trimmed : null
}

function normalizePluginEventHandler(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length <= 300 ? trimmed : null
}

function normalizePluginActionName(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE) return PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(trimmed) ? trimmed : null
}

function normalizePublicPluginActionRateLimitPolicy(input: ActionRateLimitPolicyUpdateBody['policies'][number]): PublicPluginActionRateLimitPolicyInput {
  const pluginId = input.pluginId === undefined || input.pluginId === null || input.pluginId === ''
    ? PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE
    : typeof input.pluginId === 'string' && input.pluginId.trim() === PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE
      ? PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE
      : typeof input.pluginId === 'string'
        ? normalizePluginId(input.pluginId)
        : null
  if (!pluginId) throw new Error('Invalid plugin rate limit pluginId')

  const actionName = normalizePluginActionName(input.actionName)
  if (!actionName) throw new Error('Invalid plugin rate limit actionName')

  const rateLimit = input.rateLimit === 'strict' ? 'strict' : input.rateLimit === 'normal' ? 'normal' : null
  if (!rateLimit) throw new Error('Invalid plugin rate limit policy')

  const maxRequests = Number(input.maxRequests)
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 10_000) {
    throw new Error('Plugin action rate limit maxRequests must be between 1 and 10000')
  }

  const windowSeconds = input.windowSeconds === undefined || input.windowSeconds === null || input.windowSeconds === ''
    ? 60
    : Number(input.windowSeconds)
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 10 || windowSeconds > 3600) {
    throw new Error('Plugin action rate limit windowSeconds must be between 10 and 3600')
  }

  return {
    pluginId,
    actionName,
    rateLimit,
    maxRequests,
    windowSeconds,
    enabled: input.enabled !== false
  }
}

function serializePublicPluginActionRateLimitPolicy(row: PublicPluginActionRateLimitPolicyRow) {
  return {
    id: row.id,
    pluginId: row.pluginId,
    actionName: row.actionName,
    rateLimit: row.rateLimit,
    maxRequests: row.maxRequests,
    windowSeconds: row.windowSeconds,
    enabled: row.enabled,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

async function listPublicPluginActionRateLimitPolicies(): Promise<PublicPluginActionRateLimitPolicyRow[]> {
  return prisma.$queryRaw<PublicPluginActionRateLimitPolicyRow[]>`
    SELECT
      "id",
      "plugin_id" AS "pluginId",
      "action_name" AS "actionName",
      "rate_limit" AS "rateLimit",
      "max_requests" AS "maxRequests",
      "window_seconds" AS "windowSeconds",
      "enabled",
      "updated_by_user_id" AS "updatedByUserId",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
    FROM "public_plugin_action_rate_limit_policies"
    ORDER BY
      CASE WHEN "plugin_id" = ${PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE} THEN 0 ELSE 1 END,
      "plugin_id" ASC,
      CASE WHEN "action_name" = ${PUBLIC_PLUGIN_ACTION_RATE_LIMIT_GLOBAL_SCOPE} THEN 0 ELSE 1 END,
      "action_name" ASC,
      "rate_limit" ASC
  `
}

async function canManagePlugins(user: { id: number; username: string; role: 'admin' | 'user' }): Promise<boolean> {
  if (user.role !== 'admin') return false
  const { ids: allowedIds } = await getCombinedAdminIdAllowlist(
    'plugin_manager_allowed_admin_ids',
    ['PLUGIN_MANAGER_ALLOWED_ADMIN_IDS', 'SYSTEM_UPDATE_ALLOWED_ADMIN_IDS']
  )
  if (allowedIds.size > 0) return allowedIds.has(user.id)
  return user.username === 'admin'
}

async function requirePluginManager(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = getRequestUser(request)
  if (!(await canManagePlugins(user))) {
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

function normalizePluginConfigKey(value: string): string | null {
  const trimmed = value.trim()
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(trimmed) ? trimmed : null
}

function pluginConfigFileContentType(filename: string): string {
  const ext = extname(filename).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

async function writePluginConfigFileUpload(request: FastifyRequest, pluginId: string, key: string): Promise<{
  filename: string
  mimeType: string
  sizeBytes: number
  value: string
}> {
  const multipartRequest = request as FastifyRequest & {
    parts: () => AsyncIterable<any>
  }
  const uploadDir = resolveInside(getPluginDataDir(), join('config-files', pluginId, key))
  await mkdir(uploadDir, { recursive: true })

  for await (const part of multipartRequest.parts()) {
    if (part.type !== 'file') continue
    const mimeType = String(part.mimetype || '').toLowerCase()
    const ext = PLUGIN_CONFIG_FILE_MIME_EXTENSIONS.get(mimeType)
    if (!ext) {
      await part.toBuffer()
      throw new Error('Plugin config file must be a PNG, JPEG, or WebP image')
    }
    const buffer = await part.toBuffer()
    if (buffer.length === 0) throw new Error('Plugin config file is empty')
    if (buffer.length > PLUGIN_CONFIG_FILE_MAX_BYTES) throw new Error('Plugin config file exceeds 2MB')
    const filename = `${Date.now()}-${randomUUID()}${ext}`
    const filePath = resolveInside(uploadDir, filename)
    await writeFile(filePath, buffer, { mode: 0o600 })
    return {
      filename,
      mimeType: pluginConfigFileContentType(filename),
      sizeBytes: buffer.length,
      value: `/api/plugins/${encodeURIComponent(pluginId)}/config-files/${encodeURIComponent(key)}/${encodeURIComponent(filename)}`
    }
  }

  throw new Error('Missing plugin config file')
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
    await dispatchPluginLifecycleEvent({
      event: 'plugin.installed',
      pluginId: validated.manifest.id,
      version: validated.manifest.version,
      sourceType: input.sourceType,
      sourceRepo: input.sourceRepo || null,
      actor: { id: input.userId, role: 'admin' },
      dedupeKey: `plugin.installed:${validated.manifest.id}:${validated.manifest.version}:${task.id}`
    }).catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      void appendPluginTaskLog(logPath, `Lifecycle event plugin.installed failed: ${message}`).catch(() => undefined)
    })
    return await getPluginTask(task.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendPluginTaskLog(logPath, `FAILED: ${message}`).catch(() => undefined)
    await markPluginTaskFinished(task.id, 'failed', message)
    throw error
  }
}

function sanitizeConfigString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
}

function normalizePluginConfigValue(field: PluginConfigFieldManifest, rawValue: unknown, key: string): unknown {
  const value = rawValue === undefined ? field.default : rawValue
  if (field.type === 'placeholder') return undefined
  if (field.secret && (value === undefined || value === null || value === '')) return undefined
  if (value === undefined || value === null || value === '') {
    if (field.required) throw new Error(`${key} is required`)
    return undefined
  }

  if (field.type === 'checkbox') return value === true

  if (field.type === 'number') {
    const numericValue = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numericValue)) throw new Error(`${key} must be a number`)
    if (field.min !== undefined && numericValue < field.min) throw new Error(`${key} is below the minimum`)
    if (field.max !== undefined && numericValue > field.max) throw new Error(`${key} exceeds the maximum`)
    return numericValue
  }

  if (field.type === 'tags') {
    if (!Array.isArray(value)) throw new Error(`${key} must be an array`)
    return Array.from(new Set(
      value
        .map(item => sanitizeConfigString(item, 80))
        .filter((item): item is string => !!item)
    )).slice(0, 60)
  }

  const stringValue = sanitizeConfigString(value, field.type === 'textarea' || field.type === 'markdown' ? 4000 : 500)
  if (!stringValue) {
    if (field.required) throw new Error(`${key} is required`)
    return undefined
  }
  if (field.type === 'select' && field.options?.length && !field.options.some(option => option.value === stringValue)) {
    throw new Error(`${key} must match one of the configured options`)
  }
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue)) {
    throw new Error(`${key} must be a valid email`)
  }
  if (field.type === 'color' && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(stringValue)) {
    throw new Error(`${key} must be a hex color`)
  }
  if (field.type === 'file' && !/^\/api\/plugins\/[A-Za-z0-9.%_-]+\/config-files\/[A-Za-z0-9_.%-]+\/[0-9]+-[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(stringValue)) {
    throw new Error(`${key} must be an uploaded plugin config file URL`)
  }
  return stringValue
}

function normalizeConfigUpdates(body: ConfigUpdateBody, manifest?: PayIncusPluginManifest | null): Array<{ key: string; value: unknown; isSecret?: boolean }> {
  if (!Array.isArray(body.configs)) throw new Error('configs must be an array')
  const schema = manifest?.configSchema || {}
  const schemaEntries = Object.entries(schema)
  if (schemaEntries.length === 0) {
    return body.configs.slice(0, 100).map(item => {
      const key = String(item.key || '').trim()
      if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(key)) throw new Error('Invalid plugin config key')
      return { key, value: item.value ?? null, isSecret: item.isSecret === true }
    })
  }

  const submitted = new Map<string, { value: unknown; isSecret?: boolean }>()
  for (const item of body.configs.slice(0, 100)) {
    const key = String(item.key || '').trim()
    if (!schema[key]) throw new Error(`Plugin config key is not declared in manifest: ${key}`)
    submitted.set(key, { value: item.value, isSecret: item.isSecret })
  }

  const normalized: Array<{ key: string; value: unknown; isSecret?: boolean }> = []
  for (const [key, field] of schemaEntries) {
    const item = submitted.get(key)
    const value = normalizePluginConfigValue(field, item?.value, key)
    if (value === undefined) continue
    normalized.push({
      key,
      value,
      isSecret: field.secret === true || field.type === 'password' || item?.isSecret === true
    })
  }
  return normalized
}

function summarizeConfigKeys(keys: string[]): string {
  if (keys.length === 0) return 'none'
  const sorted = Array.from(new Set(keys)).sort()
  const visible = sorted.slice(0, 20).join(', ')
  return sorted.length > 20 ? `${visible}, +${sorted.length - 20} more` : visible
}

function pluginConfigAuditSummary(input: {
  pluginId: string
  previousKeys: Set<string>
  configs: Array<{ key: string; isSecret?: boolean }>
  manifest?: PayIncusPluginManifest | null
}): string {
  const changedKeys = input.configs.map(config => config.key)
  const createdKeys = changedKeys.filter(key => !input.previousKeys.has(key))
  const updatedKeys = changedKeys.filter(key => input.previousKeys.has(key))
  const secretKeys = input.configs.filter(config => config.isSecret === true).map(config => config.key)
  const fileKeys = input.configs
    .filter(config => input.manifest?.configSchema?.[config.key]?.type === 'file')
    .map(config => config.key)
  return [
    `Updated plugin config for ${input.pluginId}`,
    `changed=${changedKeys.length}`,
    `created=[${summarizeConfigKeys(createdKeys)}]`,
    `updated=[${summarizeConfigKeys(updatedKeys)}]`,
    `secret=[${summarizeConfigKeys(secretKeys)}]`,
    `file=[${summarizeConfigKeys(fileKeys)}]`,
    'values=redacted'
  ].join('; ')
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

  fastify.get<{ Querystring: PluginEventQuery }>('/events', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 50), 1), 100)
    const result = typeof request.query.result === 'string' && request.query.result.trim()
      ? normalizePluginEventResult(request.query.result)
      : undefined
    if (request.query.result && !result) return reply.code(400).send({ error: 'Invalid event result', code: 'INVALID_EVENT_RESULT' })

    const pluginId = typeof request.query.pluginId === 'string' && request.query.pluginId.trim()
      ? normalizePluginId(request.query.pluginId)
      : undefined
    if (request.query.pluginId && !pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })

    const eventName = typeof request.query.eventName === 'string' && request.query.eventName.trim()
      ? normalizePluginEventName(request.query.eventName)
      : undefined
    if (request.query.eventName && !eventName) return reply.code(400).send({ error: 'Invalid event name', code: 'INVALID_EVENT_NAME' })

    const handler = typeof request.query.handler === 'string' && request.query.handler.trim()
      ? normalizePluginEventHandler(request.query.handler)
      : undefined
    if (request.query.handler && !handler) return reply.code(400).send({ error: 'Invalid event handler filter', code: 'INVALID_EVENT_HANDLER' })

    const baseWhere = {
      action: 'plugin.event.dispatch',
      ...(pluginId ? { pluginId } : {}),
      ...(eventName ? { eventName } : {}),
      ...(handler ? { handler: { contains: handler } } : {})
    }
    const where = {
      ...baseWhere,
      ...(result ? { result } : {})
    }

    const [logs, total, success, failed, retryPending, deadLetter, deduped, dueRetry] = await Promise.all([
      prisma.pluginEventLog.findMany({
        where,
        orderBy: [{ lastAttemptAt: 'desc' }, { createdAt: 'desc' }],
        take: limit
      }),
      prisma.pluginEventLog.count({ where: baseWhere }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'success' } }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'failed' } }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'retry_pending' } }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'dead_letter' } }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'duplicate_skipped' } }),
      prisma.pluginEventLog.count({
        where: {
          ...baseWhere,
          result: 'retry_pending',
          deadLetterAt: null,
          nextRetryAt: { lte: new Date() }
        }
      })
    ])
    return {
      events: logs.map(serializePluginEventLog),
      summary: {
        total,
        success,
        failed,
        retryPending,
        deadLetter,
        deduped,
        dueRetry,
        updatedAt: new Date().toISOString()
      }
    }
  })

  fastify.post('/events/retry-due', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const result = await processDuePluginEventRetries()
    const user = getRequestUser(request)
    await createLog(user.id, LogModule.PLUGIN, 'plugin.event.retry_due', `Processed ${result.processed} due plugin event retries`, LogResult.SUCCESS)
    return result
  })

  fastify.post<{ Params: TaskParams }>('/events/:id/replay', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid event id', code: 'INVALID_EVENT_ID' })
    try {
      const user = getRequestUser(request)
      const result = await replayPluginEventLog(id, { id: user.id, role: 'admin', username: user.username })
      await createLog(user.id, LogModule.PLUGIN, 'plugin.event.replay', `Replayed plugin event log #${id}: ${result.result}`, LogResult.SUCCESS)
      const event = await prisma.pluginEventLog.findUnique({ where: { id } })
      return { result, event: event ? serializePluginEventLog(event) : null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'PLUGIN_EVENT_REPLAY_FAILED' })
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

  fastify.get('/action-rate-limits', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const policies = await listPublicPluginActionRateLimitPolicies()
    return {
      defaults: PUBLIC_PLUGIN_ACTION_RATE_LIMIT_DEFAULTS,
      policies: policies.map(serializePublicPluginActionRateLimitPolicy)
    }
  })

  fastify.put<{ Body: ActionRateLimitPolicyUpdateBody }>('/action-rate-limits', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['policies'],
        properties: {
          policies: {
            type: 'array',
            maxItems: 100,
            items: {
              type: 'object',
              required: ['rateLimit', 'maxRequests'],
              properties: {
                pluginId: { type: 'string' },
                actionName: { type: 'string' },
                rateLimit: { type: 'string', enum: ['normal', 'strict'] },
                maxRequests: { type: 'integer', minimum: 1, maximum: 10000 },
                windowSeconds: { type: 'integer', minimum: 10, maximum: 3600 },
                enabled: { type: 'boolean' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    if (!Array.isArray(request.body?.policies)) {
      return reply.code(400).send({ error: 'policies must be an array', code: 'INVALID_PLUGIN_ACTION_RATE_LIMIT_POLICIES' })
    }

    let policies: PublicPluginActionRateLimitPolicyInput[]
    try {
      policies = request.body.policies.slice(0, 100).map(normalizePublicPluginActionRateLimitPolicy)
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Invalid plugin action rate limit policy',
        code: 'INVALID_PLUGIN_ACTION_RATE_LIMIT_POLICY'
      })
    }

    const user = getRequestUser(request)
    await prisma.$transaction(async tx => {
      for (const policy of policies) {
        await tx.$executeRaw`
          INSERT INTO "public_plugin_action_rate_limit_policies" (
            "plugin_id",
            "action_name",
            "rate_limit",
            "max_requests",
            "window_seconds",
            "enabled",
            "updated_by_user_id",
            "created_at",
            "updated_at"
          )
          VALUES (
            ${policy.pluginId},
            ${policy.actionName},
            ${policy.rateLimit},
            ${policy.maxRequests},
            ${policy.windowSeconds},
            ${policy.enabled},
            ${user.id},
            NOW(),
            NOW()
          )
          ON CONFLICT ("plugin_id", "action_name", "rate_limit")
          DO UPDATE SET
            "max_requests" = ${policy.maxRequests},
            "window_seconds" = ${policy.windowSeconds},
            "enabled" = ${policy.enabled},
            "updated_by_user_id" = ${user.id},
            "updated_at" = NOW()
        `
      }

      if (policies.length > 0) {
        await tx.$executeRaw`
          DELETE FROM "public_plugin_action_rate_limit_buckets"
          WHERE "policy" IN (
            ${policies.some(policy => policy.rateLimit === 'normal') ? 'normal' : '__none__'},
            ${policies.some(policy => policy.rateLimit === 'strict') ? 'strict' : '__none__'}
          )
        `
      }
    })

    await createLog(
      user.id,
      LogModule.PLUGIN,
      'public_api.plugin_action_rate_limits.update',
      `Updated ${policies.length} public plugin action rate limit policies`,
      LogResult.SUCCESS
    )
    const updatedPolicies = await listPublicPluginActionRateLimitPolicies()
    return {
      defaults: PUBLIC_PLUGIN_ACTION_RATE_LIMIT_DEFAULTS,
      policies: updatedPolicies.map(serializePublicPluginActionRateLimitPolicy)
    }
  })

  fastify.post<{ Params: PluginConfigFileParams }>('/:pluginId/config-files/:key', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const pluginId = normalizePluginId(request.params.pluginId)
    const key = normalizePluginConfigKey(request.params.key)
    if (!pluginId || !key) return reply.code(400).send({ error: 'Invalid plugin config file key', code: 'INVALID_PLUGIN_CONFIG_FILE_KEY' })
    const plugin = await getPlugin(pluginId)
    if (!plugin) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const manifest = plugin.versions?.[0]?.manifest as unknown as PayIncusPluginManifest | undefined
    const field = manifest?.configSchema?.[key]
    if (!field || field.type !== 'file') {
      return reply.code(400).send({ error: 'Plugin config key is not a file field', code: 'PLUGIN_CONFIG_FILE_FIELD_REQUIRED' })
    }
    try {
      const uploaded = await writePluginConfigFileUpload(request, pluginId, key)
      const user = getRequestUser(request)
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'plugin.config_file.upload',
        `Uploaded config file for ${pluginId}.${key} (${uploaded.mimeType}, ${uploaded.sizeBytes} bytes)`,
        LogResult.SUCCESS
      )
      return uploaded
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'PLUGIN_CONFIG_FILE_UPLOAD_FAILED' })
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
    await dispatchPluginLifecycleEvent({
      event: 'plugin.enabled',
      pluginId,
      version: plugin.currentVersion,
      sourceType: plugin.sourceType,
      sourceRepo: plugin.sourceRepo,
      actor: { id: user.id, role: 'admin', username: user.username },
      dedupeKey: `plugin.enabled:${pluginId}:${plugin.currentVersion}:${plugin.enabledAt?.getTime() || Date.now()}`
    }).catch(() => undefined)
    return { plugin: serializePlugin(plugin) }
  })

  fastify.post<{ Params: PluginParams }>('/:pluginId/disable', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginManager(request, reply))) return
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const user = getRequestUser(request)
    const before = await getPlugin(pluginId)
    if (!before) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    await dispatchPluginLifecycleEvent({
      event: 'plugin.disabled',
      pluginId,
      version: before.currentVersion,
      sourceType: before.sourceType,
      sourceRepo: before.sourceRepo,
      actor: { id: user.id, role: 'admin', username: user.username },
      dedupeKey: `plugin.disabled:${pluginId}:${before.currentVersion}:${Date.now()}`
    }).catch(() => undefined)
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
    const before = await getPlugin(pluginId)
    if (!before) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    await dispatchPluginLifecycleEvent({
      event: 'plugin.uninstalled',
      pluginId,
      version: before.currentVersion,
      sourceType: before.sourceType,
      sourceRepo: before.sourceRepo,
      actor: { id: user.id, role: 'admin', username: user.username },
      dedupeKey: `plugin.uninstalled:${pluginId}:${before.currentVersion}:${Date.now()}`
    }).catch(() => undefined)
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
    const manifest = plugin.versions?.[0]?.manifest as unknown as PayIncusPluginManifest | undefined
    let normalizedConfigs: Array<{ key: string; value: unknown; isSecret?: boolean }>
    try {
      normalizedConfigs = normalizeConfigUpdates(request.body, manifest)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'INVALID_PLUGIN_CONFIG' })
    }
    const previousConfigs = await getPluginConfigs(pluginId)
    const configs = await updatePluginConfigs(pluginId, normalizedConfigs)
    const user = getRequestUser(request)
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'plugin.config_update',
      pluginConfigAuditSummary({
        pluginId,
        previousKeys: new Set(previousConfigs.map(config => config.key)),
        configs: normalizedConfigs,
        manifest
      }),
      LogResult.SUCCESS
    )
    return { configs: configs.map(serializePluginConfig) }
  })
}
