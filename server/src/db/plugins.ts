import { rename, rm, mkdir, appendFile } from 'fs/promises'
import { join } from 'path'
import { Prisma } from '@prisma/client'
import type {
  Plugin,
  PluginCapabilityReview,
  PluginConfig,
  PluginEventLog,
  PluginInstallTask,
  PluginInstallTaskAction,
  PluginInstallTaskStatus,
  PluginSourceType,
  PluginStatus,
  PluginStorageItem,
  PluginTableMigration,
  PluginTableRow,
  PluginUserData,
  PluginVersion
} from '@prisma/client'
import { prisma } from './prisma.js'
import type { PayIncusPluginManifest } from '../lib/plugin-manifest.js'
import { getPluginInstallDir, getPluginLogDir, resolveInside } from '../lib/plugin-package.js'
import { encryptSensitiveData } from '../lib/security.js'

type PluginWithRelations = Plugin & {
  versions?: PluginVersion[]
  configs?: PluginConfig[]
  tasks?: PluginInstallTask[]
  eventLogs?: PluginEventLog[]
  capabilityReviews?: PluginCapabilityReview[]
  installedBy?: { username: string } | null
  enabledBy?: { username: string } | null
}

type PluginCapabilityReviewWithPlugin = PluginCapabilityReview & {
  plugin?: Pick<Plugin, 'name' | 'status' | 'enabled' | 'currentVersion'> | null
}

export type PluginCapabilityReviewStatus = 'pending' | 'approved' | 'rejected' | 'revoked'
export type PluginCapabilityRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface SerializedPlugin {
  id: number
  pluginId: string
  name: string
  status: PluginStatus
  enabled: boolean
  currentVersion: string | null
  sourceType: PluginSourceType
  sourceRepo: string | null
  installedByUsername: string | null
  enabledByUsername: string | null
  enabledAt: string | null
  createdAt: string
  updatedAt: string
  latestVersion: SerializedPluginVersion | null
  capabilityReviews?: SerializedPluginCapabilityReview[]
}

export interface SerializedPluginCapabilityReview {
  id: number
  pluginId: string
  pluginName: string | null
  pluginStatus: PluginStatus | null
  pluginEnabled: boolean | null
  pluginCurrentVersion: string | null
  manifestVersion: string
  capabilityKey: string
  capabilityType: string
  title: string
  description: string | null
  riskLevel: string
  status: string
  scopes: string[]
  hooks: string[]
  reviewNotes: string | null
  reviewedByUserId: number | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SerializedPluginVersion {
  id: number
  pluginId: string
  version: string
  manifest: PayIncusPluginManifest
  packageSha256: string
  installPath: string
  installedAt: string
}

export interface SerializedPluginTask {
  id: number
  pluginId: string | null
  action: PluginInstallTaskAction
  status: PluginInstallTaskStatus
  sourceType: PluginSourceType
  sourceUrl: string | null
  logPath: string | null
  errorMessage: string | null
  startedByUserId: number
  startedByUsername: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SerializedPluginEventLog {
  id: number
  pluginId: string
  userId: number | null
  action: string
  result: string
  message: string | null
  eventName: string | null
  handler: string | null
  payload: unknown
  actor: unknown
  retryCount: number
  maxRetries: number
  nextRetryAt: string | null
  deadLetterAt: string | null
  dedupeKey: string | null
  lastAttemptAt: string | null
  lastError: string | null
  createdAt: string
}

export interface SerializedPluginStorageItem {
  id: number
  pluginId: string
  scopeType: string
  scopeId: string
  key: string
  value: unknown
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

export interface SerializedPluginTableRow {
  id: number
  pluginId: string
  tableName: string
  scopeType: string
  scopeId: string
  rowKey: string
  value: unknown
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

export interface SerializedPluginTableMigration {
  id: number
  pluginId: string
  tableName: string
  version: string
  name: string
  appliedByUserId: number
  appliedAt: string
}

export interface PluginStorageScopeCount {
  scopeType: string
  count: number
}

export interface PluginTableScopeCount {
  tableName: string
  scopeType: string
  count: number
}

export interface PluginTableMigrationCount {
  tableName: string
  count: number
}

export function serializePluginVersion(version: PluginVersion): SerializedPluginVersion {
  return {
    id: version.id,
    pluginId: version.pluginId,
    version: version.version,
    manifest: version.manifest as unknown as PayIncusPluginManifest,
    packageSha256: version.packageSha256,
    installPath: version.installPath,
    installedAt: version.installedAt.toISOString()
  }
}

export function serializePlugin(plugin: PluginWithRelations): SerializedPlugin {
  const latestVersion = plugin.versions?.[0] || null
  const serialized: SerializedPlugin = {
    id: plugin.id,
    pluginId: plugin.pluginId,
    name: plugin.name,
    status: plugin.status,
    enabled: plugin.enabled,
    currentVersion: plugin.currentVersion,
    sourceType: plugin.sourceType,
    sourceRepo: plugin.sourceRepo,
    installedByUsername: plugin.installedBy?.username || null,
    enabledByUsername: plugin.enabledBy?.username || null,
    enabledAt: plugin.enabledAt?.toISOString() || null,
    createdAt: plugin.createdAt.toISOString(),
    updatedAt: plugin.updatedAt.toISOString(),
    latestVersion: latestVersion ? serializePluginVersion(latestVersion) : null
  }
  if (plugin.capabilityReviews) {
    serialized.capabilityReviews = plugin.capabilityReviews.map(serializePluginCapabilityReview)
  }
  return serialized
}

function jsonStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function serializePluginCapabilityReview(review: PluginCapabilityReviewWithPlugin): SerializedPluginCapabilityReview {
  return {
    id: review.id,
    pluginId: review.pluginId,
    pluginName: review.plugin?.name ?? null,
    pluginStatus: review.plugin?.status ?? null,
    pluginEnabled: review.plugin?.enabled ?? null,
    pluginCurrentVersion: review.plugin?.currentVersion ?? null,
    manifestVersion: review.manifestVersion,
    capabilityKey: review.capabilityKey,
    capabilityType: review.capabilityType,
    title: review.title,
    description: review.description,
    riskLevel: review.riskLevel,
    status: review.status,
    scopes: jsonStringArray(review.scopes),
    hooks: jsonStringArray(review.hooks),
    reviewNotes: review.reviewNotes,
    reviewedByUserId: review.reviewedByUserId,
    reviewedAt: review.reviewedAt?.toISOString() || null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString()
  }
}

interface ManifestCapabilityReviewInput {
  capabilityKey: string
  capabilityType: string
  title: string
  description?: string | null
  riskLevel: PluginCapabilityRiskLevel
  scopes: string[]
  hooks: string[]
}

function highestRisk(...levels: PluginCapabilityRiskLevel[]): PluginCapabilityRiskLevel {
  const order: Record<PluginCapabilityRiskLevel, number> = { low: 1, medium: 2, high: 3, critical: 4 }
  return levels.reduce((best, level) => order[level] > order[best] ? level : best, 'low' as PluginCapabilityRiskLevel)
}

function classifyActionRisk(action: { name: string; method: string; path: string; scopes?: string[] }): PluginCapabilityRiskLevel {
  const text = `${action.name} ${action.method} ${action.path} ${(action.scopes || []).join(' ')}`.toLowerCase()
  if (/(payment|refund|recharge|billing|balance|wallet|order|admin|user:write|users:write)/.test(text)) return 'critical'
  if (/(write|delete|create|operate|services:operate|tickets:write|notifications:send)/.test(text)) return 'high'
  if (action.method !== 'GET') return 'medium'
  return 'low'
}

function classifyServiceExtensionRisk(hooks: string[]): PluginCapabilityRiskLevel {
  if (hooks.some(hook => ['provision', 'terminate'].includes(hook))) return 'critical'
  if (hooks.some(hook => ['suspend', 'unsuspend', 'upgrade'].includes(hook))) return 'high'
  return 'medium'
}

function classifyGatewayExtensionRisk(hooks: string[]): PluginCapabilityRiskLevel {
  if (hooks.some(hook => ['createPayment', 'verifyPayment', 'refund', 'webhook'].includes(hook))) return 'critical'
  return 'high'
}

function classifyStorageRisk(scopes: string[], tableCount: number): PluginCapabilityRiskLevel {
  if (scopes.includes('global') || tableCount > 0) return 'high'
  if (scopes.includes('service')) return 'medium'
  return 'low'
}

export function extractManifestCapabilityReviews(manifest: PayIncusPluginManifest): ManifestCapabilityReviewInput[] {
  const capabilities = manifest.capabilities || {}
  const reviews: ManifestCapabilityReviewInput[] = []

  for (const action of capabilities.actions || []) {
    reviews.push({
      capabilityKey: `action:${action.name}`,
      capabilityType: 'action',
      title: `Action ${action.name}`,
      description: `${action.method} ${action.path}`,
      riskLevel: classifyActionRisk(action),
      scopes: action.scopes || [],
      hooks: []
    })
  }

  for (const event of capabilities.events || []) {
    reviews.push({
      capabilityKey: `event:${event.event}:${event.handler}`,
      capabilityType: 'event',
      title: `Event ${event.event}`,
      description: event.handler,
      riskLevel: /paid|payment|billing|refund|deleted|failed/i.test(event.event) ? 'medium' : 'low',
      scopes: [],
      hooks: [event.event]
    })
  }

  for (const template of capabilities.notificationTemplates || []) {
    reviews.push({
      capabilityKey: `notification-template:${template.id}`,
      capabilityType: 'notification_template',
      title: template.title || template.id,
      description: template.message,
      riskLevel: 'medium',
      scopes: [],
      hooks: []
    })
  }

  for (const extension of capabilities.serviceExtensions || []) {
    const hooks = Object.keys(extension.hooks || {}).filter(hook => typeof extension.hooks?.[hook as keyof typeof extension.hooks] === 'string')
    reviews.push({
      capabilityKey: `service-extension:${extension.key}`,
      capabilityType: 'service_extension',
      title: extension.name || extension.key,
      description: extension.productId ? `Product ${extension.productId}` : null,
      riskLevel: classifyServiceExtensionRisk(hooks),
      scopes: [],
      hooks
    })
  }

  for (const extension of capabilities.gatewayExtensions || []) {
    const hooks = Object.keys(extension.hooks || {}).filter(hook => typeof extension.hooks?.[hook as keyof typeof extension.hooks] === 'string')
    reviews.push({
      capabilityKey: `gateway-extension:${extension.key}`,
      capabilityType: 'gateway_extension',
      title: extension.name || extension.key,
      description: extension.providerCode ? `Provider ${extension.providerCode}` : null,
      riskLevel: classifyGatewayExtensionRisk(hooks),
      scopes: [],
      hooks
    })
  }

  if (capabilities.storage) {
    const scopes = capabilities.storage.scopes || ['user']
    const tables = capabilities.storage.tables || []
    const tableScopes = tables.flatMap(table => table.scopes || [])
    reviews.push({
      capabilityKey: 'storage:kv',
      capabilityType: 'storage',
      title: 'Extension storage',
      description: tables.length ? `Tables: ${tables.map(table => table.name).join(', ')}` : 'Scoped KV storage',
      riskLevel: highestRisk(classifyStorageRisk(scopes, tables.length), classifyStorageRisk(tableScopes, tables.length)),
      scopes: Array.from(new Set([...scopes, ...tableScopes])),
      hooks: tables.map(table => table.name)
    })
  }

  const byKey = new Map<string, ManifestCapabilityReviewInput>()
  for (const review of reviews) byKey.set(review.capabilityKey, review)
  return Array.from(byKey.values())
}

export async function syncPluginCapabilityReviews(manifest: PayIncusPluginManifest): Promise<number> {
  const desired = extractManifestCapabilityReviews(manifest)
  const desiredKeys = desired.map(review => review.capabilityKey)
  await prisma.$transaction(async tx => {
    if (desiredKeys.length > 0) {
      await tx.pluginCapabilityReview.deleteMany({
        where: {
          pluginId: manifest.id,
          manifestVersion: manifest.version,
          capabilityKey: { notIn: desiredKeys }
        }
      })
    } else {
      await tx.pluginCapabilityReview.deleteMany({
        where: { pluginId: manifest.id, manifestVersion: manifest.version }
      })
    }

    for (const review of desired) {
      await tx.pluginCapabilityReview.upsert({
        where: {
          pluginId_manifestVersion_capabilityKey: {
            pluginId: manifest.id,
            manifestVersion: manifest.version,
            capabilityKey: review.capabilityKey
          }
        },
        create: {
          pluginId: manifest.id,
          manifestVersion: manifest.version,
          capabilityKey: review.capabilityKey,
          capabilityType: review.capabilityType,
          title: review.title,
          description: review.description || null,
          riskLevel: review.riskLevel,
          status: 'pending',
          scopes: review.scopes as Prisma.InputJsonValue,
          hooks: review.hooks as Prisma.InputJsonValue
        },
        update: {
          capabilityType: review.capabilityType,
          title: review.title,
          description: review.description || null,
          riskLevel: review.riskLevel,
          scopes: review.scopes as Prisma.InputJsonValue,
          hooks: review.hooks as Prisma.InputJsonValue
        }
      })
    }
  })
  return desired.length
}

export async function listPluginCapabilityReviews(input: { pluginId?: string; status?: string } = {}) {
  return await prisma.pluginCapabilityReview.findMany({
    where: {
      ...(input.pluginId ? { pluginId: input.pluginId } : {}),
      ...(input.status ? { status: input.status } : {})
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    include: {
      plugin: { select: { name: true, status: true, enabled: true, currentVersion: true } }
    }
  })
}

export async function updatePluginCapabilityReview(input: {
  id: number
  status: PluginCapabilityReviewStatus
  reviewNotes?: string | null
  reviewedByUserId: number
}) {
  return await prisma.pluginCapabilityReview.update({
    where: { id: input.id },
    data: {
      status: input.status,
      reviewNotes: input.reviewNotes || null,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: new Date()
    },
    include: {
      plugin: { select: { name: true, status: true, enabled: true, currentVersion: true } }
    }
  })
}

export async function assertPluginCapabilitiesApprovedForEnable(pluginId: string): Promise<{
  ok: true
} | {
  ok: false
  reviews: SerializedPluginCapabilityReview[]
}> {
  const plugin = await prisma.plugin.findUnique({
    where: { pluginId },
    select: { currentVersion: true }
  })
  if (!plugin?.currentVersion) return { ok: true }

  const blocking = await prisma.pluginCapabilityReview.findMany({
    where: {
      pluginId,
      manifestVersion: plugin.currentVersion,
      riskLevel: { in: ['high', 'critical'] },
      status: { not: 'approved' }
    },
    include: {
      plugin: { select: { name: true, status: true, enabled: true, currentVersion: true } }
    },
    orderBy: [{ riskLevel: 'desc' }, { capabilityType: 'asc' }, { id: 'asc' }]
  })
  if (blocking.length === 0) return { ok: true }
  return { ok: false, reviews: blocking.map(serializePluginCapabilityReview) }
}

export function serializePluginTask(task: PluginInstallTask & { startedBy?: { username: string } | null }): SerializedPluginTask {
  return {
    id: task.id,
    pluginId: task.pluginId,
    action: task.action,
    status: task.status,
    sourceType: task.sourceType,
    sourceUrl: task.sourceUrl,
    logPath: task.logPath,
    errorMessage: task.errorMessage,
    startedByUserId: task.startedByUserId,
    startedByUsername: task.startedBy?.username || null,
    startedAt: task.startedAt?.toISOString() || null,
    finishedAt: task.finishedAt?.toISOString() || null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  }
}

export function serializePluginEventLog(log: PluginEventLog): SerializedPluginEventLog {
  return {
    id: log.id,
    pluginId: log.pluginId,
    userId: log.userId,
    action: log.action,
    result: log.result,
    message: log.message,
    eventName: log.eventName,
    handler: log.handler,
    payload: log.payload,
    actor: log.actor,
    retryCount: log.retryCount,
    maxRetries: log.maxRetries,
    nextRetryAt: log.nextRetryAt?.toISOString() || null,
    deadLetterAt: log.deadLetterAt?.toISOString() || null,
    dedupeKey: log.dedupeKey,
    lastAttemptAt: log.lastAttemptAt?.toISOString() || null,
    lastError: log.lastError,
    createdAt: log.createdAt.toISOString()
  }
}

export async function listPlugins() {
  return await prisma.plugin.findMany({
    orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    include: {
      installedBy: { select: { username: true } },
      enabledBy: { select: { username: true } },
      versions: { orderBy: { installedAt: 'desc' }, take: 1 },
      capabilityReviews: { orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 20 }
    }
  })
}

export async function getPlugin(pluginId: string) {
  return await prisma.plugin.findUnique({
    where: { pluginId },
    include: {
      installedBy: { select: { username: true } },
      enabledBy: { select: { username: true } },
      versions: { orderBy: { installedAt: 'desc' } },
      configs: { orderBy: { key: 'asc' } },
      tasks: { orderBy: { createdAt: 'desc' }, take: 10 },
      eventLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      capabilityReviews: { orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] }
    }
  })
}

export async function listPluginTasks(limit = 30) {
  return await prisma.pluginInstallTask.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { startedBy: { select: { username: true } } }
  })
}

export async function getPluginTask(id: number) {
  return await prisma.pluginInstallTask.findUnique({
    where: { id },
    include: { startedBy: { select: { username: true } } }
  })
}

export async function createPluginTask(input: {
  pluginId?: string | null
  action: PluginInstallTaskAction
  sourceType: PluginSourceType
  sourceUrl?: string | null
  startedByUserId: number
}) {
  const logDir = getPluginLogDir()
  await mkdir(logDir, { recursive: true })
  return await prisma.pluginInstallTask.create({
    data: {
      pluginId: input.pluginId || null,
      action: input.action,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl || null,
      startedByUserId: input.startedByUserId,
      status: 'pending',
      logPath: join(logDir, `plugin-task-pending-${Date.now()}.log`)
    },
    include: { startedBy: { select: { username: true } } }
  })
}

export async function markPluginTaskRunning(id: number, logPath: string) {
  return await prisma.pluginInstallTask.update({
    where: { id },
    data: { status: 'running', startedAt: new Date(), logPath, errorMessage: null }
  })
}

export async function markPluginTaskFinished(id: number, status: 'success' | 'failed', errorMessage?: string | null) {
  return await prisma.pluginInstallTask.update({
    where: { id },
    data: { status, errorMessage: errorMessage || null, finishedAt: new Date() }
  })
}

export async function appendPluginTaskLog(logPath: string, message: string) {
  await mkdir(getPluginLogDir(), { recursive: true })
  await appendFile(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8')
}

export async function installValidatedPlugin(input: {
  taskId: number
  stagingDir: string
  manifest: PayIncusPluginManifest
  packageSha256: string
  sourceType: PluginSourceType
  sourceRepo?: string | null
  installedByUserId: number
  logPath: string
}) {
  const installRoot = getPluginInstallDir()
  await mkdir(installRoot, { recursive: true })
  const pluginRoot = resolveInside(installRoot, input.manifest.id)
  await mkdir(pluginRoot, { recursive: true })
  const finalPath = resolveInside(pluginRoot, input.manifest.version)
  await rm(finalPath, { recursive: true, force: true })
  await rename(input.stagingDir, finalPath)
  await appendPluginTaskLog(input.logPath, `Installed package files to ${finalPath}`)

  const plugin = await prisma.plugin.upsert({
    where: { pluginId: input.manifest.id },
    create: {
      pluginId: input.manifest.id,
      name: input.manifest.name,
      status: 'installed',
      enabled: false,
      currentVersion: input.manifest.version,
      sourceType: input.sourceType,
      sourceRepo: input.sourceRepo || null,
      installedByUserId: input.installedByUserId
    },
    update: {
      name: input.manifest.name,
      status: 'installed',
      currentVersion: input.manifest.version,
      sourceType: input.sourceType,
      sourceRepo: input.sourceRepo || null
    }
  })

  await prisma.pluginVersion.upsert({
    where: { pluginId_version: { pluginId: input.manifest.id, version: input.manifest.version } },
    create: {
      pluginId: input.manifest.id,
      version: input.manifest.version,
      manifest: input.manifest as any,
      packageSha256: input.packageSha256,
      installPath: finalPath
    },
    update: {
      manifest: input.manifest as any,
      packageSha256: input.packageSha256,
      installPath: finalPath
    }
  })

  const capabilityReviewCount = await syncPluginCapabilityReviews(input.manifest)
  await appendPluginTaskLog(input.logPath, `Synced ${capabilityReviewCount} capability review record(s)`)

  await prisma.pluginInstallTask.update({
    where: { id: input.taskId },
    data: { pluginId: input.manifest.id }
  })
  await createPluginEvent(input.manifest.id, input.installedByUserId, 'plugin.install', 'success', `Installed ${input.manifest.version}`)
  return plugin
}

export async function enablePlugin(pluginId: string, userId: number) {
  const plugin = await prisma.plugin.update({
    where: { pluginId },
    data: {
      enabled: true,
      status: 'enabled',
      enabledByUserId: userId,
      enabledAt: new Date()
    }
  })
  await createPluginEvent(pluginId, userId, 'plugin.enable', 'success', 'Enabled plugin')
  return plugin
}

export async function disablePlugin(pluginId: string, userId: number) {
  const plugin = await prisma.plugin.update({
    where: { pluginId },
    data: {
      enabled: false,
      status: 'disabled',
      enabledByUserId: null,
      enabledAt: null
    }
  })
  await createPluginEvent(pluginId, userId, 'plugin.disable', 'success', 'Disabled plugin')
  return plugin
}

export async function uninstallPlugin(pluginId: string, userId: number) {
  const installRoot = getPluginInstallDir()
  const plugin = await getPlugin(pluginId)
  const manifest = plugin?.versions?.[0]?.manifest as unknown as PayIncusPluginManifest | undefined
  if (manifest?.capabilities?.storage?.retention === 'delete_on_uninstall') {
    await deletePluginStorageItems(pluginId)
    await deletePluginTableRows(pluginId)
  }
  await prisma.plugin.delete({ where: { pluginId } })
  await rm(resolveInside(installRoot, pluginId), { recursive: true, force: true })
  await createPluginEvent(pluginId, userId, 'plugin.uninstall', 'success', 'Uninstalled plugin').catch(() => undefined)
}

export async function createPluginEvent(
  pluginId: string,
  userId: number | null,
  action: string,
  result: string,
  message?: string | null,
  delivery?: {
    eventName?: string | null
    handler?: string | null
    payload?: unknown
    actor?: unknown
    retryCount?: number
    maxRetries?: number
    nextRetryAt?: Date | null
    deadLetterAt?: Date | null
    dedupeKey?: string | null
    lastAttemptAt?: Date | null
    lastError?: string | null
  }
) {
  return await prisma.pluginEventLog.create({
    data: {
      pluginId,
      userId,
      action,
      result,
      message: message || null,
      eventName: delivery?.eventName || null,
      handler: delivery?.handler || null,
      payload: delivery?.payload === undefined ? undefined : delivery.payload as Prisma.InputJsonValue,
      actor: delivery?.actor === undefined ? undefined : delivery.actor as Prisma.InputJsonValue,
      retryCount: delivery?.retryCount ?? 0,
      maxRetries: delivery?.maxRetries ?? 3,
      nextRetryAt: delivery?.nextRetryAt || null,
      deadLetterAt: delivery?.deadLetterAt || null,
      dedupeKey: delivery?.dedupeKey || null,
      lastAttemptAt: delivery?.lastAttemptAt || null,
      lastError: delivery?.lastError || null
    }
  })
}

export function serializePluginConfig(config: PluginConfig) {
  return {
    id: config.id,
    pluginId: config.pluginId,
    key: config.key,
    value: config.isSecret ? null : config.valueJson,
    isSecret: config.isSecret,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  }
}

export async function getPluginConfigs(pluginId: string) {
  return await prisma.pluginConfig.findMany({
    where: { pluginId },
    orderBy: { key: 'asc' }
  })
}

export async function updatePluginConfigs(pluginId: string, configs: Array<{ key: string; value: unknown; isSecret?: boolean }>) {
  const updated: PluginConfig[] = []
  for (const config of configs) {
    const isSecret = config.isSecret === true
    const valueJson = isSecret ? Prisma.JsonNull : config.value as any
    const valueEncrypted = isSecret ? encryptSensitiveData(JSON.stringify(config.value ?? null)) : null
    updated.push(await prisma.pluginConfig.upsert({
      where: { pluginId_key: { pluginId, key: config.key } },
      create: {
        pluginId,
        key: config.key,
        valueJson,
        valueEncrypted,
        isSecret
      },
      update: {
        valueJson,
        valueEncrypted,
        isSecret
      }
    }))
  }
  return updated
}

export function serializePluginUserData(data: PluginUserData) {
  return {
    id: data.id,
    pluginId: data.pluginId,
    userId: data.userId,
    key: data.key,
    value: data.valueJson,
    createdAt: data.createdAt.toISOString(),
    updatedAt: data.updatedAt.toISOString()
  }
}

export function serializePluginStorageItem(data: PluginStorageItem): SerializedPluginStorageItem {
  return {
    id: data.id,
    pluginId: data.pluginId,
    scopeType: data.scopeType,
    scopeId: data.scopeId,
    key: data.key,
    value: data.valueJson,
    createdByUserId: data.createdByUserId,
    updatedByUserId: data.updatedByUserId,
    createdAt: data.createdAt.toISOString(),
    updatedAt: data.updatedAt.toISOString()
  }
}

export function serializePluginTableRow(data: PluginTableRow): SerializedPluginTableRow {
  return {
    id: data.id,
    pluginId: data.pluginId,
    tableName: data.tableName,
    scopeType: data.scopeType,
    scopeId: data.scopeId,
    rowKey: data.rowKey,
    value: data.valueJson,
    createdByUserId: data.createdByUserId,
    updatedByUserId: data.updatedByUserId,
    createdAt: data.createdAt.toISOString(),
    updatedAt: data.updatedAt.toISOString()
  }
}

export function serializePluginTableMigration(data: PluginTableMigration): SerializedPluginTableMigration {
  return {
    id: data.id,
    pluginId: data.pluginId,
    tableName: data.tableName,
    version: data.version,
    name: data.name,
    appliedByUserId: data.appliedByUserId,
    appliedAt: data.appliedAt.toISOString()
  }
}

export async function getPluginUserData(pluginId: string, userId: number, key: string) {
  return await prisma.pluginUserData.findUnique({
    where: { pluginId_userId_key: { pluginId, userId, key } }
  })
}

export async function upsertPluginUserData(pluginId: string, userId: number, key: string, value: unknown) {
  const valueJson = value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue
  return await prisma.pluginUserData.upsert({
    where: { pluginId_userId_key: { pluginId, userId, key } },
    create: {
      pluginId,
      userId,
      key,
      valueJson
    },
    update: {
      valueJson
    }
  })
}

export async function deletePluginUserData(pluginId: string, userId: number, key: string) {
  await prisma.pluginUserData.deleteMany({
    where: { pluginId, userId, key }
  })
}

export async function countPluginUserDataItems(pluginId: string) {
  return await prisma.pluginUserData.count({ where: { pluginId } })
}

export async function getPluginStorageItem(pluginId: string, scopeType: string, scopeId: string, key: string) {
  return await prisma.pluginStorageItem.findUnique({
    where: {
      pluginId_scopeType_scopeId_key: { pluginId, scopeType, scopeId, key }
    }
  })
}

export async function countPluginStorageItems(pluginId: string, scopeType: string, scopeId: string) {
  return await prisma.pluginStorageItem.count({
    where: { pluginId, scopeType, scopeId }
  })
}

export async function listPluginStorageScopeCounts(pluginId: string): Promise<PluginStorageScopeCount[]> {
  const rows = await prisma.pluginStorageItem.groupBy({
    by: ['scopeType'],
    where: { pluginId },
    _count: { id: true }
  })
  return rows.map(row => ({
    scopeType: row.scopeType,
    count: row._count.id
  }))
}

export async function upsertPluginStorageItem(input: {
  pluginId: string
  scopeType: string
  scopeId: string
  key: string
  value: unknown
  actorUserId: number
}) {
  const valueJson = input.value === null ? Prisma.JsonNull : input.value as Prisma.InputJsonValue
  return await prisma.pluginStorageItem.upsert({
    where: {
      pluginId_scopeType_scopeId_key: {
        pluginId: input.pluginId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        key: input.key
      }
    },
    create: {
      pluginId: input.pluginId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      key: input.key,
      valueJson,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId
    },
    update: {
      valueJson,
      updatedByUserId: input.actorUserId
    }
  })
}

export async function deletePluginStorageItem(pluginId: string, scopeType: string, scopeId: string, key: string) {
  await prisma.pluginStorageItem.deleteMany({
    where: { pluginId, scopeType, scopeId, key }
  })
}

export async function deletePluginStorageItems(pluginId: string) {
  await prisma.pluginStorageItem.deleteMany({ where: { pluginId } })
}

export async function getPluginTableRow(pluginId: string, tableName: string, scopeType: string, scopeId: string, rowKey: string) {
  return await prisma.pluginTableRow.findUnique({
    where: {
      pluginId_tableName_scopeType_scopeId_rowKey: {
        pluginId,
        tableName,
        scopeType,
        scopeId,
        rowKey
      }
    }
  })
}

export async function countPluginTableRows(pluginId: string, tableName: string, scopeType: string, scopeId: string) {
  return await prisma.pluginTableRow.count({
    where: { pluginId, tableName, scopeType, scopeId }
  })
}

export async function listPluginTableScopeCounts(pluginId: string): Promise<PluginTableScopeCount[]> {
  const rows = await prisma.pluginTableRow.groupBy({
    by: ['tableName', 'scopeType'],
    where: { pluginId },
    _count: { id: true }
  })
  return rows.map(row => ({
    tableName: row.tableName,
    scopeType: row.scopeType,
    count: row._count.id
  }))
}

export async function upsertPluginTableRow(input: {
  pluginId: string
  tableName: string
  scopeType: string
  scopeId: string
  rowKey: string
  value: unknown
  actorUserId: number
}) {
  const valueJson = input.value === null ? Prisma.JsonNull : input.value as Prisma.InputJsonValue
  return await prisma.pluginTableRow.upsert({
    where: {
      pluginId_tableName_scopeType_scopeId_rowKey: {
        pluginId: input.pluginId,
        tableName: input.tableName,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        rowKey: input.rowKey
      }
    },
    create: {
      pluginId: input.pluginId,
      tableName: input.tableName,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      rowKey: input.rowKey,
      valueJson,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId
    },
    update: {
      valueJson,
      updatedByUserId: input.actorUserId
    }
  })
}

export async function deletePluginTableRow(pluginId: string, tableName: string, scopeType: string, scopeId: string, rowKey: string) {
  await prisma.pluginTableRow.deleteMany({
    where: { pluginId, tableName, scopeType, scopeId, rowKey }
  })
}

export async function deletePluginTableRows(pluginId: string) {
  await prisma.pluginTableRow.deleteMany({ where: { pluginId } })
  await prisma.pluginTableMigration.deleteMany({ where: { pluginId } })
}

export async function listPluginTableMigrations(pluginId: string, tableName: string) {
  return await prisma.pluginTableMigration.findMany({
    where: { pluginId, tableName },
    orderBy: { appliedAt: 'asc' }
  })
}

export async function listPluginTableMigrationCounts(pluginId: string): Promise<PluginTableMigrationCount[]> {
  const rows = await prisma.pluginTableMigration.groupBy({
    by: ['tableName'],
    where: { pluginId },
    _count: { id: true }
  })
  return rows.map(row => ({
    tableName: row.tableName,
    count: row._count.id
  }))
}

export async function applyPluginTableMigration(input: {
  pluginId: string
  tableName: string
  version: string
  name: string
  actorUserId: number
}) {
  return await prisma.pluginTableMigration.upsert({
    where: {
      pluginId_tableName_version: {
        pluginId: input.pluginId,
        tableName: input.tableName,
        version: input.version
      }
    },
    create: {
      pluginId: input.pluginId,
      tableName: input.tableName,
      version: input.version,
      name: input.name,
      appliedByUserId: input.actorUserId
    },
    update: {}
  })
}
