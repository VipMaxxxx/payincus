import { createHmac, randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { createPluginEvent } from '../db/plugins.js'
import { prisma } from '../db/prisma.js'
import { assertSafeWebhookUrl } from './outbound-security.js'
import { PLUGIN_EVENT_NAMES, type PayIncusPluginManifest, type PluginActionManifest } from './plugin-manifest.js'

const PLUGIN_ACTION_PAYLOAD_MAX_BYTES = 64 * 1024
const PLUGIN_ACTION_RESPONSE_MAX_BYTES = 256 * 1024
const DEFAULT_PLUGIN_WEBHOOK_TIMEOUT_MS = 10_000
const PLUGIN_EVENT_MAX_RETRIES = 3
const PLUGIN_EVENT_RETRY_BASE_MS = 60_000
const PLUGIN_EVENT_DEDUPE_IN_FLIGHT_TTL_MS = 30 * 60_000

export interface PluginRuntimeActor {
  id: number | null
  role: 'admin' | 'user' | 'system'
  username?: string | null
}

export interface PluginActionExecutionInput {
  pluginId: string
  manifest: PayIncusPluginManifest
  actionName: string
  actor: PluginRuntimeActor
  payload: unknown
  source: 'user' | 'event' | 'system'
  eventName?: string
  idempotencyKey?: string | null
}

export interface PluginActionExecutionResult {
  pluginId: string
  action: string
  runtime: 'webhook'
  status: 'success'
  statusCode: number
  requestId: string
  result: unknown
}

export interface PluginEventDispatchResult {
  event: string
  matched: number
  delivered: number
  failed: number
  deduped: number
}

export interface PluginEventDispatchOptions {
  dedupeKey?: string | null
}

export interface PluginEventReplayResult {
  id: number
  pluginId: string
  eventName: string
  handler: string
  result: 'success' | 'retry_pending' | 'dead_letter'
  retryCount: number
}

function assertJsonPayload(value: unknown, label: string, maxBytes: number): string {
  const serialized = JSON.stringify(value ?? null)
  if (serialized === undefined) throw new Error(`${label} must be JSON serializable`)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds ${Math.round(maxBytes / 1024)}KB`)
  }
  return serialized
}

function nextPluginEventRetryAt(retryCount: number): Date {
  const delay = PLUGIN_EVENT_RETRY_BASE_MS * Math.max(1, 2 ** Math.max(0, retryCount - 1))
  return new Date(Date.now() + delay)
}

function normalizeRuntimeActor(value: unknown): PluginRuntimeActor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { id: null, role: 'system' }
  const record = value as Record<string, unknown>
  const role = record.role === 'admin' || record.role === 'user' || record.role === 'system' ? record.role : 'system'
  const id = typeof record.id === 'number' && Number.isSafeInteger(record.id) ? record.id : null
  const username = typeof record.username === 'string' ? record.username : null
  return { id, role, username }
}

function normalizePluginEventDedupeKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > 240 ? trimmed.slice(0, 240) : trimmed
}

function extractPluginEventDedupeKey(payload: unknown, options?: PluginEventDispatchOptions): string | null {
  const explicit = normalizePluginEventDedupeKey(options?.dedupeKey)
  if (explicit) return explicit
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const topLevel = normalizePluginEventDedupeKey(record.dedupeKey)
  if (topLevel) return topLevel
  if (record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)) {
    return normalizePluginEventDedupeKey((record.metadata as Record<string, unknown>).dedupeKey)
  }
  return null
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function reservePluginEventDedupeLock(input: {
  pluginId: string
  eventName: string
  handler: string
  dedupeKey: string | null
  now: Date
}): Promise<{ reserved: true } | { reserved: false; eventLogId: number | null; status: string }> {
  if (!input.dedupeKey) return { reserved: true }
  const expiresAt = new Date(input.now.getTime() + PLUGIN_EVENT_DEDUPE_IN_FLIGHT_TTL_MS)
  const lockKey = {
    pluginId: input.pluginId,
    eventName: input.eventName,
    handler: input.handler,
    dedupeKey: input.dedupeKey
  }
  try {
    await prisma.pluginEventDedupeLock.create({
      data: {
        ...lockKey,
        status: 'in_flight',
        expiresAt
      }
    })
    return { reserved: true }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
  }

  const existing = await prisma.pluginEventDedupeLock.findUnique({
    where: { pluginId_eventName_handler_dedupeKey: lockKey }
  })
  if (!existing) throw new Error('Plugin event dedupe lock conflict could not be resolved')

  if (existing.status === 'in_flight' && existing.expiresAt && existing.expiresAt <= input.now) {
    const refreshed = await prisma.pluginEventDedupeLock.updateMany({
      where: { id: existing.id, status: 'in_flight', expiresAt: { lte: input.now } },
      data: {
        eventLogId: null,
        expiresAt
      }
    })
    if (refreshed.count > 0) return { reserved: true }
  }

  return {
    reserved: false,
    eventLogId: existing.eventLogId,
    status: existing.status
  }
}

async function finalizePluginEventDedupeLock(input: {
  pluginId: string
  eventName: string
  handler: string
  dedupeKey: string | null
  eventLogId: number
  status: 'success' | 'retry_pending' | 'dead_letter'
}): Promise<void> {
  if (!input.dedupeKey) return
  await prisma.pluginEventDedupeLock.updateMany({
    where: {
      pluginId: input.pluginId,
      eventName: input.eventName,
      handler: input.handler,
      dedupeKey: input.dedupeKey
    },
    data: {
      status: input.status,
      eventLogId: input.eventLogId,
      expiresAt: null
    }
  })
}

function getPluginWebhookSigningSecret(): string {
  const secret = process.env.PLUGIN_WEBHOOK_SIGNING_SECRET || (process.env.NODE_ENV === 'production' ? '' : process.env.JWT_SECRET || 'dev-plugin-webhook-secret')
  if (!secret || secret.length < 32) {
    throw new Error('PLUGIN_WEBHOOK_SIGNING_SECRET must be configured with at least 32 characters before executing plugin webhooks')
  }
  return secret
}

function getPluginWebhookTimeoutMs(action: PluginActionManifest): number {
  const configured = Number(process.env.PLUGIN_WEBHOOK_TIMEOUT_MS || '')
  const fallback = Number.isSafeInteger(configured) && configured >= 1000 && configured <= 30000
    ? configured
    : DEFAULT_PLUGIN_WEBHOOK_TIMEOUT_MS
  return action.rateLimit === 'strict' ? Math.min(fallback, 5000) : fallback
}

function findDeclaredAction(manifest: PayIncusPluginManifest, actionName: string): PluginActionManifest | null {
  return (manifest.capabilities?.actions || []).find(action => action.name === actionName) || null
}

function assertActionPermissions(manifest: PayIncusPluginManifest, action: PluginActionManifest): void {
  const permissions = new Set(manifest.permissions || [])
  if (!permissions.has('plugin-action:run')) {
    throw new Error('Plugin manifest must grant plugin-action:run before actions can execute')
  }
  for (const scope of action.scopes || []) {
    if (!permissions.has(scope)) {
      throw new Error(`Plugin manifest must grant action scope ${scope}`)
    }
  }
}

async function readBoundedResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > PLUGIN_ACTION_RESPONSE_MAX_BYTES) {
    throw new Error('Plugin webhook response exceeds 256KB')
  }
  if (!text) return null
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return { text }
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Plugin webhook returned invalid JSON')
  }
}

export async function executePluginAction(input: PluginActionExecutionInput): Promise<PluginActionExecutionResult> {
  const action = findDeclaredAction(input.manifest, input.actionName)
  if (!action) throw new Error('Plugin action is not declared in manifest capabilities')
  if (action.runtime !== 'webhook' || !action.url) {
    throw new Error('Plugin action runtime is not configured')
  }
  assertActionPermissions(input.manifest, action)

  const webhookUrl = await assertSafeWebhookUrl(action.url)
  if (webhookUrl.protocol !== 'https:') {
    throw new Error('Plugin webhook URL must use HTTPS')
  }
  const requestId = randomUUID()
  const body = {
    pluginId: input.pluginId,
    action: action.name,
    path: action.path,
    source: input.source,
    eventName: input.eventName ?? null,
    actor: input.actor,
    idempotencyKey: input.idempotencyKey ?? requestId,
    payload: input.payload ?? null,
    requestedAt: new Date().toISOString()
  }
  const serializedBody = assertJsonPayload(body, 'Plugin action payload', PLUGIN_ACTION_PAYLOAD_MAX_BYTES)
  const signature = createHmac('sha256', getPluginWebhookSigningSecret())
    .update(serializedBody)
    .digest('hex')

  await createPluginEvent(input.pluginId, input.actor.id, 'plugin.action.dispatch', 'pending', `${action.name} -> ${webhookUrl.hostname}`)

  const response = await fetch(webhookUrl, {
    method: action.method,
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'user-agent': 'PayIncus-Plugin-Runtime/1.0',
      'x-payincus-plugin-id': input.pluginId,
      'x-payincus-plugin-action': action.name,
      'x-payincus-plugin-request-id': requestId,
      'x-payincus-plugin-signature': `sha256=${signature}`
    },
    body: action.method === 'GET' ? undefined : serializedBody,
    redirect: 'manual',
    signal: AbortSignal.timeout(getPluginWebhookTimeoutMs(action))
  })

  const result = await readBoundedResponse(response)
  if (!response.ok) {
    await createPluginEvent(input.pluginId, input.actor.id, 'plugin.action.dispatch', 'failed', `${action.name} returned HTTP ${response.status}`)
    throw new Error(`Plugin webhook returned HTTP ${response.status}`)
  }

  await createPluginEvent(input.pluginId, input.actor.id, 'plugin.action.dispatch', 'success', `${action.name} request ${requestId}`)
  return {
    pluginId: input.pluginId,
    action: action.name,
    runtime: 'webhook',
    status: 'success',
    statusCode: response.status,
    requestId,
    result
  }
}

export async function dispatchPluginEvent(
  event: string,
  payload: unknown,
  actor: PluginRuntimeActor = { id: null, role: 'system' },
  options: PluginEventDispatchOptions = {}
): Promise<PluginEventDispatchResult> {
  if (!PLUGIN_EVENT_NAMES.includes(event as (typeof PLUGIN_EVENT_NAMES)[number])) {
    throw new Error('Plugin event is not allowed')
  }
  assertJsonPayload(payload, 'Plugin event payload', PLUGIN_ACTION_PAYLOAD_MAX_BYTES)
  const dedupeKey = extractPluginEventDedupeKey(payload, options)

  const plugins = await prisma.plugin.findMany({
    where: { enabled: true, status: 'enabled' },
    include: { versions: { orderBy: { installedAt: 'desc' }, take: 1 } }
  })

  let matched = 0
  let delivered = 0
  let failed = 0
  let deduped = 0

  for (const plugin of plugins) {
    const manifest = plugin.versions[0]?.manifest as unknown as PayIncusPluginManifest | undefined
    if (!manifest) continue
    const subscriptions = (manifest.capabilities?.events || []).filter(subscription => subscription.event === event)
    for (const subscription of subscriptions) {
      matched += 1
      const attemptAt = new Date()
      if (dedupeKey) {
        const reservation = await reservePluginEventDedupeLock({
          pluginId: plugin.pluginId,
          eventName: event,
          handler: subscription.handler,
          dedupeKey,
          now: attemptAt
        })
        if (!reservation.reserved) {
          deduped += 1
          await createPluginEvent(
            plugin.pluginId,
            actor.id,
            'plugin.event.dispatch',
            'duplicate_skipped',
            `${event} -> ${subscription.handler}: duplicate of ${reservation.eventLogId ? `event log #${reservation.eventLogId}` : `${reservation.status} delivery`}`,
            {
              eventName: event,
              handler: subscription.handler,
              payload,
              actor,
              dedupeKey,
              maxRetries: PLUGIN_EVENT_MAX_RETRIES,
              lastAttemptAt: attemptAt
            }
          ).catch(() => undefined)
          continue
        }
      }
      try {
        await executePluginAction({
          pluginId: plugin.pluginId,
          manifest,
          actionName: subscription.handler,
          actor,
          payload,
          source: 'event',
          eventName: event
        })
        const log = await createPluginEvent(plugin.pluginId, actor.id, 'plugin.event.dispatch', 'success', `${event} -> ${subscription.handler}: delivered`, {
          eventName: event,
          handler: subscription.handler,
          payload,
          actor,
          dedupeKey,
          retryCount: 0,
          maxRetries: PLUGIN_EVENT_MAX_RETRIES,
          lastAttemptAt: attemptAt
        }).catch(() => null)
        if (log) {
          await finalizePluginEventDedupeLock({
            pluginId: plugin.pluginId,
            eventName: event,
            handler: subscription.handler,
            dedupeKey,
            eventLogId: log.id,
            status: 'success'
          }).catch(() => undefined)
        }
        delivered += 1
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        const log = await createPluginEvent(plugin.pluginId, actor.id, 'plugin.event.dispatch', 'retry_pending', `${event} -> ${subscription.handler}: ${message}`, {
          eventName: event,
          handler: subscription.handler,
          payload,
          actor,
          retryCount: 0,
          maxRetries: PLUGIN_EVENT_MAX_RETRIES,
          nextRetryAt: nextPluginEventRetryAt(1),
          dedupeKey,
          lastAttemptAt: attemptAt,
          lastError: message
        }).catch(() => null)
        if (log) {
          await finalizePluginEventDedupeLock({
            pluginId: plugin.pluginId,
            eventName: event,
            handler: subscription.handler,
            dedupeKey,
            eventLogId: log.id,
            status: 'retry_pending'
          }).catch(() => undefined)
        }
      }
    }
  }

  return { event, matched, delivered, failed, deduped }
}

export async function replayPluginEventLog(logId: number, actorOverride?: PluginRuntimeActor): Promise<PluginEventReplayResult> {
  const log = await prisma.pluginEventLog.findUnique({ where: { id: logId } })
  if (!log || log.action !== 'plugin.event.dispatch' || !log.eventName || !log.handler) {
    throw new Error('Plugin event log is not replayable')
  }
  if (log.result === 'duplicate_skipped') {
    throw new Error('Deduplicated plugin event log is not replayable')
  }

  const plugin = await prisma.plugin.findUnique({
    where: { pluginId: log.pluginId },
    include: { versions: { orderBy: { installedAt: 'desc' }, take: 1 } }
  })
  if (!plugin || !plugin.enabled || plugin.status !== 'enabled') {
    throw new Error('Plugin is not enabled')
  }
  const manifest = plugin.versions[0]?.manifest as unknown as PayIncusPluginManifest | undefined
  if (!manifest) throw new Error('Plugin manifest is missing')

  const actor = actorOverride || normalizeRuntimeActor(log.actor)
  const payload = log.payload ?? {}
  try {
    await executePluginAction({
      pluginId: log.pluginId,
      manifest,
      actionName: log.handler,
      actor,
      payload,
      source: 'event',
      eventName: log.eventName,
      idempotencyKey: `event-log-${log.id}-retry-${log.retryCount + 1}`
    })
    const updated = await prisma.pluginEventLog.update({
      where: { id: log.id },
      data: {
        result: 'success',
        message: `${log.eventName} -> ${log.handler}: replayed successfully`,
        nextRetryAt: null,
        deadLetterAt: null,
        lastError: null,
        lastAttemptAt: new Date(),
        retryCount: { increment: 1 }
      }
    })
    await finalizePluginEventDedupeLock({
      pluginId: updated.pluginId,
      eventName: log.eventName,
      handler: log.handler,
      dedupeKey: updated.dedupeKey,
      eventLogId: updated.id,
      status: 'success'
    }).catch(() => undefined)
    return {
      id: updated.id,
      pluginId: updated.pluginId,
      eventName: log.eventName,
      handler: log.handler,
      result: 'success',
      retryCount: updated.retryCount
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryCount = log.retryCount + 1
    const shouldDeadLetter = retryCount >= log.maxRetries
    const updated = await prisma.pluginEventLog.update({
      where: { id: log.id },
      data: {
        result: shouldDeadLetter ? 'dead_letter' : 'retry_pending',
        message: `${log.eventName} -> ${log.handler}: ${message}`,
        retryCount,
        nextRetryAt: shouldDeadLetter ? null : nextPluginEventRetryAt(retryCount + 1),
        deadLetterAt: shouldDeadLetter ? new Date() : null,
        lastAttemptAt: new Date(),
        lastError: message
      }
    })
    await finalizePluginEventDedupeLock({
      pluginId: updated.pluginId,
      eventName: log.eventName,
      handler: log.handler,
      dedupeKey: updated.dedupeKey,
      eventLogId: updated.id,
      status: shouldDeadLetter ? 'dead_letter' : 'retry_pending'
    }).catch(() => undefined)
    return {
      id: updated.id,
      pluginId: updated.pluginId,
      eventName: log.eventName,
      handler: log.handler,
      result: shouldDeadLetter ? 'dead_letter' : 'retry_pending',
      retryCount: updated.retryCount
    }
  }
}

export async function processDuePluginEventRetries(limit = 20): Promise<{ processed: number; succeeded: number; failed: number; deadLettered: number }> {
  const logs = await prisma.pluginEventLog.findMany({
    where: {
      action: 'plugin.event.dispatch',
      result: 'retry_pending',
      nextRetryAt: { lte: new Date() },
      deadLetterAt: null
    },
    orderBy: { nextRetryAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 100)
  })

  let succeeded = 0
  let failed = 0
  let deadLettered = 0
  for (const log of logs) {
    const result = await replayPluginEventLog(log.id).catch(() => null)
    if (!result) {
      failed += 1
      continue
    }
    if (result.result === 'success') succeeded += 1
    if (result.result === 'retry_pending') failed += 1
    if (result.result === 'dead_letter') deadLettered += 1
  }
  return { processed: logs.length, succeeded, failed, deadLettered }
}
