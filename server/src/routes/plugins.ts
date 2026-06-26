import { createReadStream } from 'fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { createHash } from 'crypto'
import type { Readable } from 'stream'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import {
  applyPluginTableMigration,
  countPluginUserDataItems,
  countPluginStorageItems,
  countPluginTableRows,
  createPluginEvent,
  deletePluginStorageItem,
  deletePluginTableRow,
  deletePluginUserData,
  getPlugin,
  getPluginConfigs,
  getPluginStorageItem,
  getPluginTableRow,
  getPluginUserData,
  listPluginStorageScopeCounts,
  listPluginTableMigrationCounts,
  listPluginTableMigrations,
  listPluginTableScopeCounts,
  serializePluginStorageItem,
  serializePluginTableMigration,
  serializePluginTableRow,
  serializePluginUserData,
  upsertPluginStorageItem,
  upsertPluginTableRow,
  upsertPluginUserData
} from '../db/plugins.js'
import { prisma } from '../db/prisma.js'
import { getPluginDataDir, resolveInside } from '../lib/plugin-package.js'
import { isAccessTokenInvalidated } from '../lib/security.js'
import { executePluginAction } from '../lib/plugin-runtime.js'
import {
  dispatchPluginGatewayExtension,
  dispatchPluginServiceExtension,
  listEnabledGatewayExtensionTargets,
  listEnabledServiceExtensionTargets,
  PluginExtensionDispatchError
} from '../lib/plugin-extension-dispatch.js'
import {
  PLUGIN_GATEWAY_EXTENSION_HOOKS,
  PLUGIN_SERVICE_EXTENSION_HOOKS,
  type PayIncusPluginManifest,
  type PluginGatewayExtensionHook,
  type PluginServiceExtensionHook,
  type PluginTableManifest
} from '../lib/plugin-manifest.js'
import { getDefaultStorageConfig, getStorageConfigById } from '../db/storage-configs.js'
import { StorageFactory } from '../storage/factory.js'

interface PluginParams {
  pluginId: string
}

interface PluginConfigFileParams extends PluginParams {
  key: string
  filename: string
}

interface PluginActionParams {
  pluginId: string
  action: string
}

interface PluginActionBody {
  payload?: unknown
  idempotencyKey?: string
}

interface PluginServiceActionParams {
  pluginId: string
  hook: string
}

interface PluginServiceActionBody {
  serviceExtensionKey?: string
  payload?: unknown
  idempotencyKey?: string
}

interface PluginGatewayActionParams {
  pluginId: string
  hook: string
}

interface PluginGatewayActionBody {
  gatewayExtensionKey?: string
  payload?: unknown
  idempotencyKey?: string
}

interface PluginServiceTargetsQuery {
  productId?: string
}

interface PluginGatewayTargetsQuery {
  providerCode?: string
}

interface PluginStorageParams {
  pluginId: string
  key: string
}

interface PluginScopedStorageParams {
  pluginId: string
  scope: string
  key: string
}

interface PluginScopedStorageQuery {
  scopeId?: string
}

interface PluginStorageBody {
  value?: unknown
}

interface PluginStorageBackupBody {
  backup?: unknown
}

interface PluginStorageBackupRestoreQuery {
  dryRun?: string
}

interface PluginStorageBackupArchiveCreateQuery {
  mode?: string
}

interface PluginStorageBackupArchiveParams extends PluginParams {
  backupId: string
}

interface PluginStorageBackupRemoteArchiveParams extends PluginStorageBackupArchiveParams {
  remoteArchiveId: string
}

interface PluginStorageBackupRemoteUploadBody {
  storageConfigId?: number
}

interface PluginTableStorageParams {
  pluginId: string
  scope: string
  table: string
  rowKey: string
}

interface PluginTableMigrationParams {
  pluginId: string
  table: string
}

interface PluginTableMigrationBody {
  version?: string
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

function normalizeStorageKey(value: string): string | null {
  const trimmed = value.trim()
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(trimmed) ? trimmed : null
}

function normalizePluginTableName(value: string): string | null {
  const trimmed = value.trim()
  return /^[a-z][a-z0-9_]{1,62}$/.test(trimmed) ? trimmed : null
}

function normalizePluginTableRowKey(value: string): string | null {
  const trimmed = value.trim()
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(trimmed) ? trimmed : null
}

function normalizePluginConfigKey(value: string): string | null {
  const trimmed = value.trim()
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(trimmed) ? trimmed : null
}

function normalizePluginConfigFilename(value: string): string | null {
  const trimmed = value.trim()
  return /^[0-9]+-[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(trimmed) ? trimmed : null
}

function normalizePluginStorageBackupArchiveId(value: string): string | null {
  const trimmed = value.trim()
  return /^psb_[0-9]{17}_[a-f0-9]{16}$/.test(trimmed) ? trimmed : null
}

function normalizePluginStorageBackupRemoteFileName(pluginId: string, backupId: string): string {
  return `${pluginId}-${backupId}.json`.replace(/[^A-Za-z0-9_.-]/g, '_')
}

async function readRemotePluginStorageBackupStream(stream: Readable, maxBytes = 256 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > maxBytes) {
      throw new Error('Plugin storage remote backup exceeds download limit')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function normalizeStorageScope(value: string): 'user' | 'global' | 'service' | null {
  const trimmed = value.trim()
  if (trimmed === 'user' || trimmed === 'global' || trimmed === 'service') return trimmed
  return null
}

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
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

function getRequestUser(request: FastifyRequest): { id: number; username: string; role: 'admin' | 'user' } {
  return request.user as { id: number; username: string; role: 'admin' | 'user' }
}

function normalizeServiceExtensionHook(value: string): PluginServiceExtensionHook | null {
  const trimmed = value.trim()
  return PLUGIN_SERVICE_EXTENSION_HOOKS.includes(trimmed as PluginServiceExtensionHook)
    ? trimmed as PluginServiceExtensionHook
    : null
}

function normalizeGatewayExtensionHook(value: string): PluginGatewayExtensionHook | null {
  const trimmed = value.trim()
  return PLUGIN_GATEWAY_EXTENSION_HOOKS.includes(trimmed as PluginGatewayExtensionHook)
    ? trimmed as PluginGatewayExtensionHook
    : null
}

function hasPluginPermission(manifest: PayIncusPluginManifest, permission: string): boolean {
  return (manifest.permissions || []).includes(permission)
}

function assertPluginStorageAccess(manifest: PayIncusPluginManifest, mode: 'read' | 'write'): { ok: true } | { ok: false; code: string; status: number; message: string } {
  if (manifest.capabilities?.storage?.kind !== 'kv') {
    return { ok: false, status: 403, code: 'PLUGIN_STORAGE_NOT_DECLARED', message: 'Plugin storage is not declared in manifest capabilities' }
  }
  if (mode === 'read' && (hasPluginPermission(manifest, 'plugin-storage:read') || hasPluginPermission(manifest, 'plugin-storage:write'))) {
    return { ok: true }
  }
  if (mode === 'write' && hasPluginPermission(manifest, 'plugin-storage:write')) {
    return { ok: true }
  }
  return { ok: false, status: 403, code: 'PLUGIN_STORAGE_PERMISSION_REQUIRED', message: 'Plugin manifest does not grant storage permission' }
}

function assertPluginStorageScope(manifest: PayIncusPluginManifest, scope: 'user' | 'global' | 'service'): { ok: true } | { ok: false; code: string; status: number; message: string } {
  const scopes = manifest.capabilities?.storage?.scopes || ['user']
  if (!scopes.includes(scope)) {
    return { ok: false, status: 403, code: 'PLUGIN_STORAGE_SCOPE_NOT_DECLARED', message: 'Plugin storage scope is not declared in manifest capabilities' }
  }
  return { ok: true }
}

function resolvePluginTable(manifest: PayIncusPluginManifest, tableName: string): PluginTableManifest | null {
  return manifest.capabilities?.storage?.tables?.find(table => table.name === tableName) || null
}

function assertPluginTableScope(
  manifest: PayIncusPluginManifest,
  table: PluginTableManifest,
  scope: 'user' | 'global' | 'service'
): { ok: true } | { ok: false; code: string; status: number; message: string } {
  const tableScopes = table.scopes && table.scopes.length > 0
    ? table.scopes
    : manifest.capabilities?.storage?.scopes || ['user']
  if (!tableScopes.includes(scope)) {
    return { ok: false, status: 403, code: 'PLUGIN_TABLE_SCOPE_NOT_DECLARED', message: 'Plugin table scope is not declared in manifest capabilities' }
  }
  return { ok: true }
}

async function resolvePluginStorageScope(
  scope: 'user' | 'global' | 'service',
  query: PluginScopedStorageQuery,
  user: { id: number; role: 'admin' | 'user' }
): Promise<{ ok: true; scopeId: string } | { ok: false; status: number; code: string; message: string }> {
  if (scope === 'global') return { ok: true, scopeId: '_' }
  if (scope === 'user') return { ok: true, scopeId: String(user.id) }

  const instanceId = parsePositiveId(query.scopeId)
  if (!instanceId) {
    return { ok: false, status: 400, code: 'PLUGIN_STORAGE_SCOPE_ID_REQUIRED', message: 'service storage requires a valid scopeId' }
  }
  const instance = await prisma.instance.findFirst({
    where: { id: instanceId, userId: user.id },
    select: { id: true }
  })
  if (!instance) {
    return { ok: false, status: 404, code: 'PLUGIN_STORAGE_SERVICE_NOT_FOUND', message: 'Service scope not found for current user' }
  }
  return { ok: true, scopeId: String(instance.id) }
}

function assertStoragePayload(value: unknown): void {
  if (value === undefined) throw new Error('Plugin storage value is required')
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Plugin storage value must be JSON serializable')
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
    throw new Error('Plugin storage value exceeds 64KB')
  }
}

function jsonValueForStorage(value: unknown) {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue
}

function assertPluginTablePayload(value: unknown): void {
  if (value === undefined) throw new Error('Plugin table row value is required')
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Plugin table row value must be JSON serializable')
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
    throw new Error('Plugin table row value exceeds 64KB')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBackupString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

function normalizeBackupNullableUserId(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return parsePositiveId(value)
}

function normalizePluginStorageBackupPayload(pluginId: string, value: unknown) {
  const backup = isRecord(value) && isRecord(value.backup) ? value.backup : value
  if (!isRecord(backup)) throw new Error('Plugin storage backup must be an object')
  if (backup.schemaVersion !== 1) throw new Error('Unsupported plugin storage backup schema version')
  if (backup.pluginId !== pluginId) throw new Error('Plugin storage backup pluginId mismatch')

  const legacyInput = Array.isArray(backup.legacyUserData) ? backup.legacyUserData : []
  const scopedInput = Array.isArray(backup.scopedStorage) ? backup.scopedStorage : []
  const tableRowInput = Array.isArray(backup.tableRows) ? backup.tableRows : []
  const migrationInput = Array.isArray(backup.tableMigrations) ? backup.tableMigrations : []
  const totalItems = legacyInput.length + scopedInput.length + tableRowInput.length + migrationInput.length
  if (totalItems > 20000) throw new Error('Plugin storage backup exceeds restore item limit')

  const legacyUserData = legacyInput.map(item => {
    if (!isRecord(item)) throw new Error('Invalid legacy user storage backup item')
    const userId = parsePositiveId(item.userId)
    const key = normalizeStorageKey(String(item.key ?? ''))
    if (!userId || !key) throw new Error('Invalid legacy user storage backup key')
    assertStoragePayload(item.value)
    return { userId, key, value: item.value ?? null }
  })

  const scopedStorage = scopedInput.map(item => {
    if (!isRecord(item)) throw new Error('Invalid scoped storage backup item')
    const scopeType = normalizeStorageScope(String(item.scopeType ?? ''))
    const scopeId = normalizeBackupString(item.scopeId, 120)
    const key = normalizeStorageKey(String(item.key ?? ''))
    if (!scopeType || !scopeId || !key) throw new Error('Invalid scoped storage backup key')
    assertStoragePayload(item.value)
    return {
      scopeType,
      scopeId,
      key,
      value: item.value ?? null,
      createdByUserId: normalizeBackupNullableUserId(item.createdByUserId),
      updatedByUserId: normalizeBackupNullableUserId(item.updatedByUserId)
    }
  })

  const tableRows = tableRowInput.map(item => {
    if (!isRecord(item)) throw new Error('Invalid table storage backup item')
    const tableName = normalizePluginTableName(String(item.tableName ?? ''))
    const scopeType = normalizeStorageScope(String(item.scopeType ?? ''))
    const scopeId = normalizeBackupString(item.scopeId, 120)
    const rowKey = normalizePluginTableRowKey(String(item.rowKey ?? ''))
    if (!tableName || !scopeType || !scopeId || !rowKey) throw new Error('Invalid table storage backup key')
    assertPluginTablePayload(item.value)
    return {
      tableName,
      scopeType,
      scopeId,
      rowKey,
      value: item.value ?? null,
      createdByUserId: normalizeBackupNullableUserId(item.createdByUserId),
      updatedByUserId: normalizeBackupNullableUserId(item.updatedByUserId)
    }
  })

  const tableMigrations = migrationInput.map(item => {
    if (!isRecord(item)) throw new Error('Invalid table migration backup item')
    const tableName = normalizePluginTableName(String(item.tableName ?? ''))
    const version = normalizeBackupString(item.version, 64)
    const name = normalizeBackupString(item.name, 120)
    const appliedByUserId = parsePositiveId(item.appliedByUserId)
    if (!tableName || !version || !name || !appliedByUserId) throw new Error('Invalid table migration backup item')
    return { tableName, version, name, appliedByUserId }
  })

  return { legacyUserData, scopedStorage, tableRows, tableMigrations }
}

function buildPluginStorageBackupSummary(backup: ReturnType<typeof normalizePluginStorageBackupPayload>) {
  const counts = {
    legacyUserData: backup.legacyUserData.length,
    scopedStorage: backup.scopedStorage.length,
    tableRows: backup.tableRows.length,
    tableMigrations: backup.tableMigrations.length
  }
  return {
    ...counts,
    totalItems: counts.legacyUserData + counts.scopedStorage + counts.tableRows + counts.tableMigrations
  }
}

function buildPluginStorageBackupContentHash(backup: ReturnType<typeof normalizePluginStorageBackupPayload>): string {
  return createHash('sha256').update(JSON.stringify({
    legacyUserData: backup.legacyUserData,
    scopedStorage: backup.scopedStorage,
    tableRows: backup.tableRows,
    tableMigrations: backup.tableMigrations
  })).digest('hex')
}

function buildPluginStorageBackupDiffHash(diff: unknown): string {
  return createHash('sha256').update(JSON.stringify(diff)).digest('hex')
}

function formatPluginStorageBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/\D/g, '').slice(0, 17)
}

type NormalizedPluginStorageBackup = ReturnType<typeof normalizePluginStorageBackupPayload>

function legacyBackupKey(item: NormalizedPluginStorageBackup['legacyUserData'][number]): string {
  return `${item.userId}:${item.key}`
}

function scopedBackupKey(item: NormalizedPluginStorageBackup['scopedStorage'][number]): string {
  return `${item.scopeType}:${item.scopeId}:${item.key}`
}

function tableRowBackupKey(item: NormalizedPluginStorageBackup['tableRows'][number]): string {
  return `${item.tableName}:${item.scopeType}:${item.scopeId}:${item.rowKey}`
}

function tableMigrationBackupKey(item: NormalizedPluginStorageBackup['tableMigrations'][number]): string {
  return `${item.tableName}:${item.version}`
}

function sortNormalizedPluginStorageBackup(backup: NormalizedPluginStorageBackup): NormalizedPluginStorageBackup {
  return {
    legacyUserData: [...backup.legacyUserData].sort((left, right) => legacyBackupKey(left).localeCompare(legacyBackupKey(right))),
    scopedStorage: [...backup.scopedStorage].sort((left, right) => scopedBackupKey(left).localeCompare(scopedBackupKey(right))),
    tableRows: [...backup.tableRows].sort((left, right) => tableRowBackupKey(left).localeCompare(tableRowBackupKey(right))),
    tableMigrations: [...backup.tableMigrations].sort((left, right) => tableMigrationBackupKey(left).localeCompare(tableMigrationBackupKey(right)))
  }
}

function buildPluginStorageBackupDiff(base: NormalizedPluginStorageBackup, current: NormalizedPluginStorageBackup) {
  function diffItems<T>(baseItems: T[], currentItems: T[], keyFn: (item: T) => string) {
    const baseByKey = new Map(baseItems.map(item => [keyFn(item), item]))
    const currentByKey = new Map(currentItems.map(item => [keyFn(item), item]))
    const upsert = currentItems.filter(item => JSON.stringify(item) !== JSON.stringify(baseByKey.get(keyFn(item)) ?? null))
    const remove = baseItems
      .filter(item => !currentByKey.has(keyFn(item)))
      .map(item => keyFn(item))
      .sort()
    return { upsert, remove }
  }

  return {
    legacyUserData: diffItems(base.legacyUserData, current.legacyUserData, legacyBackupKey),
    scopedStorage: diffItems(base.scopedStorage, current.scopedStorage, scopedBackupKey),
    tableRows: diffItems(base.tableRows, current.tableRows, tableRowBackupKey),
    tableMigrations: diffItems(base.tableMigrations, current.tableMigrations, tableMigrationBackupKey)
  }
}

function parseLegacyBackupKey(key: string): { userId: number; key: string } {
  const [rawUserId, ...rest] = key.split(':')
  const userId = parsePositiveId(rawUserId)
  const storageKey = normalizeStorageKey(rest.join(':'))
  if (!userId || !storageKey) throw new Error('Invalid differential legacy user delete key')
  return { userId, key: storageKey }
}

function parseScopedBackupKey(key: string): { scopeType: 'user' | 'global' | 'service'; scopeId: string; key: string } {
  const [rawScopeType, rawScopeId, ...rest] = key.split(':')
  const scopeType = normalizeStorageScope(rawScopeType ?? '')
  const scopeId = normalizeBackupString(rawScopeId, 120)
  const storageKey = normalizeStorageKey(rest.join(':'))
  if (!scopeType || !scopeId || !storageKey) throw new Error('Invalid differential scoped storage delete key')
  return { scopeType, scopeId, key: storageKey }
}

function parseTableRowBackupKey(key: string): { tableName: string; scopeType: 'user' | 'global' | 'service'; scopeId: string; rowKey: string } {
  const [rawTableName, rawScopeType, rawScopeId, ...rest] = key.split(':')
  const tableName = normalizePluginTableName(rawTableName ?? '')
  const scopeType = normalizeStorageScope(rawScopeType ?? '')
  const scopeId = normalizeBackupString(rawScopeId, 120)
  const rowKey = normalizePluginTableRowKey(rest.join(':'))
  if (!tableName || !scopeType || !scopeId || !rowKey) throw new Error('Invalid differential table row delete key')
  return { tableName, scopeType, scopeId, rowKey }
}

function parseTableMigrationBackupKey(key: string): { tableName: string; version: string } {
  const [rawTableName, ...rest] = key.split(':')
  const tableName = normalizePluginTableName(rawTableName ?? '')
  const version = normalizeBackupString(rest.join(':'), 64)
  if (!tableName || !version) throw new Error('Invalid differential table migration delete key')
  return { tableName, version }
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map(item => {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`${label} contains an invalid key`)
    return item.trim()
  })
}

function normalizePluginStorageBackupDiff(pluginId: string, value: unknown) {
  if (!isRecord(value)) throw new Error('Plugin storage differential backup must be an object')
  const diff = isRecord(value.diff) ? value.diff : null
  if (!diff) throw new Error('Plugin storage differential backup diff is required')

  const legacy = isRecord(diff.legacyUserData) ? diff.legacyUserData : {}
  const scoped = isRecord(diff.scopedStorage) ? diff.scopedStorage : {}
  const rows = isRecord(diff.tableRows) ? diff.tableRows : {}
  const migrations = isRecord(diff.tableMigrations) ? diff.tableMigrations : {}
  const upserts = normalizePluginStorageBackupPayload(pluginId, {
    schemaVersion: 1,
    pluginId,
    legacyUserData: Array.isArray(legacy.upsert) ? legacy.upsert : [],
    scopedStorage: Array.isArray(scoped.upsert) ? scoped.upsert : [],
    tableRows: Array.isArray(rows.upsert) ? rows.upsert : [],
    tableMigrations: Array.isArray(migrations.upsert) ? migrations.upsert : []
  })

  const normalized = {
    legacyUserData: {
      upsert: upserts.legacyUserData,
      remove: normalizeStringArray(legacy.remove ?? [], 'legacyUserData.remove').map(parseLegacyBackupKey)
    },
    scopedStorage: {
      upsert: upserts.scopedStorage,
      remove: normalizeStringArray(scoped.remove ?? [], 'scopedStorage.remove').map(parseScopedBackupKey)
    },
    tableRows: {
      upsert: upserts.tableRows,
      remove: normalizeStringArray(rows.remove ?? [], 'tableRows.remove').map(parseTableRowBackupKey)
    },
    tableMigrations: {
      upsert: upserts.tableMigrations,
      remove: normalizeStringArray(migrations.remove ?? [], 'tableMigrations.remove').map(parseTableMigrationBackupKey)
    }
  }
  const totalItems =
    normalized.legacyUserData.upsert.length + normalized.legacyUserData.remove.length +
    normalized.scopedStorage.upsert.length + normalized.scopedStorage.remove.length +
    normalized.tableRows.upsert.length + normalized.tableRows.remove.length +
    normalized.tableMigrations.upsert.length + normalized.tableMigrations.remove.length
  if (totalItems > 20000) throw new Error('Plugin storage differential backup exceeds restore item limit')
  return normalized
}

function applyPluginStorageBackupDiff(base: NormalizedPluginStorageBackup, diff: ReturnType<typeof normalizePluginStorageBackupDiff>): NormalizedPluginStorageBackup {
  const legacy = new Map(base.legacyUserData.map(item => [legacyBackupKey(item), item]))
  for (const item of diff.legacyUserData.upsert) legacy.set(legacyBackupKey(item), item)
  for (const item of diff.legacyUserData.remove) legacy.delete(`${item.userId}:${item.key}`)

  const scoped = new Map(base.scopedStorage.map(item => [scopedBackupKey(item), item]))
  for (const item of diff.scopedStorage.upsert) scoped.set(scopedBackupKey(item), item)
  for (const item of diff.scopedStorage.remove) scoped.delete(`${item.scopeType}:${item.scopeId}:${item.key}`)

  const rows = new Map(base.tableRows.map(item => [tableRowBackupKey(item), item]))
  for (const item of diff.tableRows.upsert) rows.set(tableRowBackupKey(item), item)
  for (const item of diff.tableRows.remove) rows.delete(`${item.tableName}:${item.scopeType}:${item.scopeId}:${item.rowKey}`)

  const migrations = new Map(base.tableMigrations.map(item => [tableMigrationBackupKey(item), item]))
  for (const item of diff.tableMigrations.upsert) migrations.set(tableMigrationBackupKey(item), item)
  for (const item of diff.tableMigrations.remove) migrations.delete(`${item.tableName}:${item.version}`)

  return sortNormalizedPluginStorageBackup({
    legacyUserData: Array.from(legacy.values()),
    scopedStorage: Array.from(scoped.values()),
    tableRows: Array.from(rows.values()),
    tableMigrations: Array.from(migrations.values())
  })
}

function assertUniquePluginStorageBackupKeys(backup: ReturnType<typeof normalizePluginStorageBackupPayload>): void {
  const legacyKeys = new Set<string>()
  for (const item of backup.legacyUserData) {
    const key = `${item.userId}:${item.key}`
    if (legacyKeys.has(key)) throw new Error('Plugin storage backup contains duplicate legacy user keys')
    legacyKeys.add(key)
  }

  const scopedKeys = new Set<string>()
  for (const item of backup.scopedStorage) {
    const key = `${item.scopeType}:${item.scopeId}:${item.key}`
    if (scopedKeys.has(key)) throw new Error('Plugin storage backup contains duplicate scoped storage keys')
    scopedKeys.add(key)
  }

  const rowKeys = new Set<string>()
  for (const item of backup.tableRows) {
    const key = `${item.tableName}:${item.scopeType}:${item.scopeId}:${item.rowKey}`
    if (rowKeys.has(key)) throw new Error('Plugin storage backup contains duplicate table row keys')
    rowKeys.add(key)
  }

  const migrationKeys = new Set<string>()
  for (const item of backup.tableMigrations) {
    const key = `${item.tableName}:${item.version}`
    if (migrationKeys.has(key)) throw new Error('Plugin storage backup contains duplicate table migrations')
    migrationKeys.add(key)
  }
}

async function assertPluginStorageBackupRestoreReferences(backup: ReturnType<typeof normalizePluginStorageBackupPayload>): Promise<void> {
  const legacyUserIds = Array.from(new Set(backup.legacyUserData.map(item => item.userId)))
  if (legacyUserIds.length === 0) return
  const existingCount = await prisma.user.count({ where: { id: { in: legacyUserIds } } })
  if (existingCount !== legacyUserIds.length) {
    throw new Error('Plugin storage backup references missing legacy user data users')
  }
}

async function getPluginStorageBackupArchiveDir(pluginId: string): Promise<string> {
  const baseDir = resolveInside(getPluginDataDir(), 'storage-backups/plugins')
  await mkdir(baseDir, { recursive: true })
  const pluginDir = resolveInside(baseDir, pluginId)
  await mkdir(pluginDir, { recursive: true })
  return pluginDir
}

async function getPluginStorageBackupArchivePath(pluginId: string, backupId: string): Promise<string> {
  const pluginDir = await getPluginStorageBackupArchiveDir(pluginId)
  return resolveInside(pluginDir, `${backupId}.json`)
}

async function buildPluginStorageBackup(pluginId: string, pluginVersion: string) {
  const [legacyUserData, scopedStorage, tableRows, tableMigrations] = await Promise.all([
    prisma.pluginUserData.findMany({ where: { pluginId }, orderBy: [{ userId: 'asc' }, { key: 'asc' }] }),
    prisma.pluginStorageItem.findMany({ where: { pluginId }, orderBy: [{ scopeType: 'asc' }, { scopeId: 'asc' }, { key: 'asc' }] }),
    prisma.pluginTableRow.findMany({ where: { pluginId }, orderBy: [{ tableName: 'asc' }, { scopeType: 'asc' }, { scopeId: 'asc' }, { rowKey: 'asc' }] }),
    prisma.pluginTableMigration.findMany({ where: { pluginId }, orderBy: [{ tableName: 'asc' }, { appliedAt: 'asc' }] })
  ])

  const normalizedBackup = normalizePluginStorageBackupPayload(pluginId, {
    schemaVersion: 1,
    pluginId,
    legacyUserData: legacyUserData.map(item => ({
      userId: item.userId,
      key: item.key,
      value: item.valueJson
    })),
    scopedStorage: scopedStorage.map(item => ({
      scopeType: item.scopeType,
      scopeId: item.scopeId,
      key: item.key,
      value: item.valueJson,
      createdByUserId: item.createdByUserId,
      updatedByUserId: item.updatedByUserId
    })),
    tableRows: tableRows.map(item => ({
      tableName: item.tableName,
      scopeType: item.scopeType,
      scopeId: item.scopeId,
      rowKey: item.rowKey,
      value: item.valueJson,
      createdByUserId: item.createdByUserId,
      updatedByUserId: item.updatedByUserId
    })),
    tableMigrations: tableMigrations.map(item => ({
      tableName: item.tableName,
      version: item.version,
      name: item.name,
      appliedByUserId: item.appliedByUserId
    }))
  })
  const summary = buildPluginStorageBackupSummary(normalizedBackup)
  const contentSha256 = buildPluginStorageBackupContentHash(normalizedBackup)
  const exportedAt = new Date()

  return {
    schemaVersion: 1,
    pluginId,
    pluginVersion,
    exportedAt: exportedAt.toISOString(),
    backupId: `psb_${formatPluginStorageBackupTimestamp(exportedAt)}_${contentSha256.slice(0, 16)}`,
    mode: 'full',
    contentSha256,
    legacyUserData: legacyUserData.map(item => ({
      userId: item.userId,
      key: item.key,
      value: item.valueJson,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    })),
    scopedStorage: scopedStorage.map(item => ({
      scopeType: item.scopeType,
      scopeId: item.scopeId,
      key: item.key,
      value: item.valueJson,
      createdByUserId: item.createdByUserId,
      updatedByUserId: item.updatedByUserId,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    })),
    tableRows: tableRows.map(item => ({
      tableName: item.tableName,
      scopeType: item.scopeType,
      scopeId: item.scopeId,
      rowKey: item.rowKey,
      value: item.valueJson,
      createdByUserId: item.createdByUserId,
      updatedByUserId: item.updatedByUserId,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    })),
    tableMigrations: tableMigrations.map(item => ({
      tableName: item.tableName,
      version: item.version,
      name: item.name,
      appliedByUserId: item.appliedByUserId,
      appliedAt: item.appliedAt.toISOString()
    })),
    counts: {
      legacyUserData: summary.legacyUserData,
      scopedStorage: summary.scopedStorage,
      tableRows: summary.tableRows,
      tableMigrations: summary.tableMigrations,
      totalItems: summary.totalItems
    },
    restorePolicy: {
      dryRunSupported: true,
      restoreMode: 'replace_all_plugin_storage',
      modifiesBusinessData: false,
      modifiesPluginPackage: false
    }
  }
}

async function findLatestFullPluginStorageBackupArchive(pluginId: string): Promise<Awaited<ReturnType<typeof buildPluginStorageBackup>> | null> {
  const archiveDir = await getPluginStorageBackupArchiveDir(pluginId)
  const filenames = (await readdir(archiveDir))
    .filter(name => /^psb_[0-9]{17}_[a-f0-9]{16}\.json$/.test(name))
    .sort()
    .reverse()
  for (const filename of filenames) {
    const backupId = normalizePluginStorageBackupArchiveId(filename.slice(0, -'.json'.length))
    if (!backupId) continue
    try {
      const payload = JSON.parse(await readFile(resolveInside(archiveDir, filename), 'utf8')) as Awaited<ReturnType<typeof buildPluginStorageBackup>>
      if (payload.mode !== 'full') continue
      const normalized = normalizePluginStorageBackupPayload(pluginId, payload)
      const contentSha256 = buildPluginStorageBackupContentHash(normalized)
      if (payload.pluginId === pluginId && payload.backupId === backupId && payload.contentSha256 === contentSha256) {
        return payload
      }
    } catch {
      continue
    }
  }
  return null
}

function buildDifferentialPluginStorageBackup(input: {
  pluginId: string
  pluginVersion: string
  current: Awaited<ReturnType<typeof buildPluginStorageBackup>>
  base: Awaited<ReturnType<typeof buildPluginStorageBackup>>
}) {
  const baseNormalized = normalizePluginStorageBackupPayload(input.pluginId, input.base)
  const currentNormalized = normalizePluginStorageBackupPayload(input.pluginId, input.current)
  const diff = buildPluginStorageBackupDiff(baseNormalized, currentNormalized)
  const diffSha256 = buildPluginStorageBackupDiffHash(diff)
  const exportedAt = new Date()
  return {
    schemaVersion: 1,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    exportedAt: exportedAt.toISOString(),
    backupId: `psb_${formatPluginStorageBackupTimestamp(exportedAt)}_${input.current.contentSha256.slice(0, 16)}`,
    mode: 'differential',
    baseBackupId: input.base.backupId,
    baseContentSha256: input.base.contentSha256,
    contentSha256: input.current.contentSha256,
    diffSha256,
    diff,
    counts: input.current.counts,
    diffCounts: {
      legacyUserData: diff.legacyUserData.upsert.length + diff.legacyUserData.remove.length,
      scopedStorage: diff.scopedStorage.upsert.length + diff.scopedStorage.remove.length,
      tableRows: diff.tableRows.upsert.length + diff.tableRows.remove.length,
      tableMigrations: diff.tableMigrations.upsert.length + diff.tableMigrations.remove.length,
      totalItems:
        diff.legacyUserData.upsert.length + diff.legacyUserData.remove.length +
        diff.scopedStorage.upsert.length + diff.scopedStorage.remove.length +
        diff.tableRows.upsert.length + diff.tableRows.remove.length +
        diff.tableMigrations.upsert.length + diff.tableMigrations.remove.length
    },
    restorePolicy: {
      dryRunSupported: true,
      restoreMode: 'replace_all_plugin_storage',
      requiresBaseArchive: true,
      baseBackupId: input.base.backupId,
      modifiesBusinessData: false,
      modifiesPluginPackage: false
    }
  }
}

type PluginStorageArchivePayload =
  | Awaited<ReturnType<typeof buildPluginStorageBackup>>
  | ReturnType<typeof buildDifferentialPluginStorageBackup>

function serializePluginStorageBackupArchive(backup: PluginStorageArchivePayload) {
  const differential = backup.mode === 'differential' && 'baseBackupId' in backup
  return {
    backupId: backup.backupId,
    pluginId: backup.pluginId,
    pluginVersion: backup.pluginVersion,
    exportedAt: backup.exportedAt,
    mode: backup.mode,
    contentSha256: backup.contentSha256,
    baseBackupId: differential ? backup.baseBackupId : null,
    baseContentSha256: differential ? backup.baseContentSha256 : null,
    diffSha256: differential ? backup.diffSha256 : null,
    diffCounts: differential ? backup.diffCounts : null,
    counts: backup.counts,
    restorePolicy: backup.restorePolicy
  }
}

function serializePluginStorageBackupRemoteArchive(archive: {
  id: number
  pluginId: string
  backupId: string
  storageConfigId: number
  remoteFileName: string
  remotePath: string | null
  storageName: string
  storageType: string
  contentSha256: string
  fileSize: bigint
  status: string
  lastRestoredAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: archive.id,
    pluginId: archive.pluginId,
    backupId: archive.backupId,
    storageConfigId: archive.storageConfigId,
    remoteFileName: archive.remoteFileName,
    remotePath: archive.remotePath,
    storageName: archive.storageName,
    storageType: archive.storageType,
    contentSha256: archive.contentSha256,
    fileSize: archive.fileSize.toString(),
    status: archive.status,
    lastRestoredAt: archive.lastRestoredAt?.toISOString() ?? null,
    createdAt: archive.createdAt.toISOString(),
    updatedAt: archive.updatedAt.toISOString()
  }
}

async function readPluginStorageBackupArchive(pluginId: string, backupId: string) {
  const path = await getPluginStorageBackupArchivePath(pluginId, backupId)
  const backup = JSON.parse(await readFile(path, 'utf8')) as PluginStorageArchivePayload
  if (backup.pluginId !== pluginId || backup.backupId !== backupId) {
    throw new Error('Plugin storage backup archive identity mismatch')
  }

  if (backup.mode === 'differential') {
    await resolvePluginStorageBackupArchiveForRestore(pluginId, backup)
    return backup
  }

  const normalized = normalizePluginStorageBackupPayload(pluginId, backup)
  const contentSha256 = buildPluginStorageBackupContentHash(normalized)
  if (backup.contentSha256 !== contentSha256) {
    throw new Error('Plugin storage backup archive checksum mismatch')
  }
  return backup
}

async function listPluginStorageBackupDependents(pluginId: string, baseBackupId: string): Promise<string[]> {
  const archiveDir = await getPluginStorageBackupArchiveDir(pluginId)
  const filenames = (await readdir(archiveDir))
    .filter(name => /^psb_[0-9]{17}_[a-f0-9]{16}\.json$/.test(name))
    .sort()
  const dependents: string[] = []
  for (const filename of filenames) {
    try {
      const payload = JSON.parse(await readFile(resolveInside(archiveDir, filename), 'utf8')) as { backupId?: unknown; mode?: unknown; baseBackupId?: unknown }
      if (payload.mode === 'differential' && payload.baseBackupId === baseBackupId && typeof payload.backupId === 'string') {
        dependents.push(payload.backupId)
      }
    } catch {
      continue
    }
  }
  return dependents
}

async function resolvePluginStorageBackupArchiveForRestore(pluginId: string, archive: unknown): Promise<NormalizedPluginStorageBackup> {
  if (!isRecord(archive)) throw new Error('Plugin storage backup archive must be an object')
  if (archive.mode !== 'differential') {
    return normalizeAndValidatePluginStorageBackupForRestore(pluginId, archive)
  }

  const baseBackupId = typeof archive.baseBackupId === 'string' ? normalizePluginStorageBackupArchiveId(archive.baseBackupId) : null
  const baseContentSha256 = typeof archive.baseContentSha256 === 'string' && /^[a-f0-9]{64}$/.test(archive.baseContentSha256) ? archive.baseContentSha256 : null
  const expectedContentSha256 = typeof archive.contentSha256 === 'string' && /^[a-f0-9]{64}$/.test(archive.contentSha256) ? archive.contentSha256 : null
  const expectedDiffSha256 = typeof archive.diffSha256 === 'string' && /^[a-f0-9]{64}$/.test(archive.diffSha256) ? archive.diffSha256 : null
  if (!baseBackupId || !baseContentSha256 || !expectedContentSha256 || !expectedDiffSha256) {
    throw new Error('Invalid plugin storage differential backup metadata')
  }

  const baseArchive = await readPluginStorageBackupArchive(pluginId, baseBackupId)
  if (baseArchive.mode !== 'full' || baseArchive.contentSha256 !== baseContentSha256) {
    throw new Error('Plugin storage differential backup base archive mismatch')
  }
  const base = await normalizeAndValidatePluginStorageBackupForRestore(pluginId, baseArchive)
  const diff = normalizePluginStorageBackupDiff(pluginId, archive)
  const diffSha256 = buildPluginStorageBackupDiffHash((archive as { diff?: unknown }).diff)
  if (diffSha256 !== expectedDiffSha256) {
    throw new Error('Plugin storage differential backup checksum mismatch')
  }
  const resolved = applyPluginStorageBackupDiff(base, diff)
  assertUniquePluginStorageBackupKeys(resolved)
  await assertPluginStorageBackupRestoreReferences(resolved)
  const contentSha256 = buildPluginStorageBackupContentHash(resolved)
  if (contentSha256 !== expectedContentSha256) {
    throw new Error('Plugin storage differential backup content checksum mismatch')
  }
  return resolved
}

async function normalizeAndValidatePluginStorageBackupForRestore(pluginId: string, value: unknown) {
  const backup = normalizePluginStorageBackupPayload(pluginId, value)
  assertUniquePluginStorageBackupKeys(backup)
  await assertPluginStorageBackupRestoreReferences(backup)
  return backup
}

async function restorePluginStorageBackup(input: {
  pluginId: string
  userId: number
  backup: ReturnType<typeof normalizePluginStorageBackupPayload>
  dryRun: boolean
  archiveId?: string | null
}) {
  const summary = buildPluginStorageBackupSummary(input.backup)
  const contentSha256 = buildPluginStorageBackupContentHash(input.backup)
  const eventPayload = {
    archiveId: input.archiveId ?? null,
    contentSha256,
    counts: summary,
    restoreMode: 'replace_all_plugin_storage',
    modified: !input.dryRun
  }

  if (input.dryRun) {
    await createPluginEvent(input.pluginId, input.userId, 'plugin.storage.restore_dry_run', 'success', 'Validated plugin storage backup restore dry run', {
      payload: eventPayload
    })
    return {
      dryRun: {
        pluginId: input.pluginId,
        valid: true,
        contentSha256,
        counts: summary,
        restoreMode: 'replace_all_plugin_storage',
        modified: false,
        archiveId: input.archiveId ?? null
      }
    }
  }

  await prisma.$transaction(async tx => {
    await tx.pluginUserData.deleteMany({ where: { pluginId: input.pluginId } })
    await tx.pluginStorageItem.deleteMany({ where: { pluginId: input.pluginId } })
    await tx.pluginTableRow.deleteMany({ where: { pluginId: input.pluginId } })
    await tx.pluginTableMigration.deleteMany({ where: { pluginId: input.pluginId } })

    if (input.backup.legacyUserData.length > 0) {
      await tx.pluginUserData.createMany({
        data: input.backup.legacyUserData.map(item => ({
          pluginId: input.pluginId,
          userId: item.userId,
          key: item.key,
          valueJson: jsonValueForStorage(item.value)
        }))
      })
    }
    if (input.backup.scopedStorage.length > 0) {
      await tx.pluginStorageItem.createMany({
        data: input.backup.scopedStorage.map(item => ({
          pluginId: input.pluginId,
          scopeType: item.scopeType,
          scopeId: item.scopeId,
          key: item.key,
          valueJson: jsonValueForStorage(item.value),
          createdByUserId: item.createdByUserId,
          updatedByUserId: item.updatedByUserId
        }))
      })
    }
    if (input.backup.tableRows.length > 0) {
      await tx.pluginTableRow.createMany({
        data: input.backup.tableRows.map(item => ({
          pluginId: input.pluginId,
          tableName: item.tableName,
          scopeType: item.scopeType,
          scopeId: item.scopeId,
          rowKey: item.rowKey,
          valueJson: jsonValueForStorage(item.value),
          createdByUserId: item.createdByUserId,
          updatedByUserId: item.updatedByUserId
        }))
      })
    }
    if (input.backup.tableMigrations.length > 0) {
      await tx.pluginTableMigration.createMany({
        data: input.backup.tableMigrations.map(item => ({
          pluginId: input.pluginId,
          tableName: item.tableName,
          version: item.version,
          name: item.name,
          appliedByUserId: item.appliedByUserId
        }))
      })
    }
  })

  await createPluginEvent(input.pluginId, input.userId, 'plugin.storage.restore', 'success', 'Restored plugin storage backup', {
    payload: eventPayload
  })
  return {
    restored: {
      pluginId: input.pluginId,
      legacyUserData: summary.legacyUserData,
      scopedStorage: summary.scopedStorage,
      tableRows: summary.tableRows,
      tableMigrations: summary.tableMigrations,
      totalItems: summary.totalItems,
      contentSha256,
      archiveId: input.archiveId ?? null
    }
  }
}

function buildPluginStorageWarnings(input: {
  kv: Array<{ scopeType: string; keyCount: number; maxKeys: number | null; declared: boolean }>
  tables: Array<{ tableName: string; scopeType: string; rowCount: number; maxRows: number | null; declared: boolean }>
}) {
  const warnings: Array<{
    level: 'warning' | 'critical'
    kind: 'kv' | 'table'
    label: string
    count: number
    limit: number
    usageRatio: number
    message: string
  }> = []
  for (const item of input.kv) {
    if (!item.declared || !item.maxKeys || item.maxKeys <= 0) continue
    const usageRatio = item.keyCount / item.maxKeys
    if (usageRatio < 0.8) continue
    const level = usageRatio >= 1 ? 'critical' : 'warning'
    warnings.push({
      level,
      kind: 'kv',
      label: `KV / ${item.scopeType}`,
      count: item.keyCount,
      limit: item.maxKeys,
      usageRatio,
      message: level === 'critical' ? 'KV key count reached the declared limit.' : 'KV key count is above 80% of the declared limit.'
    })
  }
  for (const item of input.tables) {
    if (!item.declared || !item.maxRows || item.maxRows <= 0) continue
    const usageRatio = item.rowCount / item.maxRows
    if (usageRatio < 0.8) continue
    const level = usageRatio >= 1 ? 'critical' : 'warning'
    warnings.push({
      level,
      kind: 'table',
      label: `${item.tableName} / ${item.scopeType}`,
      count: item.rowCount,
      limit: item.maxRows,
      usageRatio,
      message: level === 'critical' ? 'Table row count reached the declared limit.' : 'Table row count is above 80% of the declared limit.'
    })
  }
  return warnings.sort((a, b) => b.usageRatio - a.usageRatio)
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

  fastify.get('/enabled-admin-client-extensions', {
    onRequest: [fastify.authenticateAdmin]
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
      for (const page of manifest?.entrypoints?.adminPages || []) {
        const path = page.slot === 'admin.sidebar.extra'
          ? `/admin/plugins/${encodeURIComponent(plugin.pluginId)}/pages/${encodeURIComponent(page.entry)}`
          : `/admin/plugins/${encodeURIComponent(plugin.pluginId)}/settings`
        extensions.push({
          pluginId: plugin.pluginId,
          pluginName: plugin.name,
          version: plugin.currentVersion,
          slot: page.slot,
          title: page.title,
          path,
          requiresAuth: true,
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

  fastify.get<{ Params: PluginConfigFileParams }>('/:pluginId/config-files/:key/:filename', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const key = normalizePluginConfigKey(request.params.key)
    const filename = normalizePluginConfigFilename(request.params.filename)
    if (!pluginId || !key || !filename) {
      return reply.code(400).send({ error: 'Invalid plugin config file path', code: 'INVALID_PLUGIN_CONFIG_FILE_PATH' })
    }
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const field = loaded.latest.manifest.configSchema?.[key]
    if (!field || field.type !== 'file') {
      return reply.code(404).send({ error: 'Plugin config file not found', code: 'PLUGIN_CONFIG_FILE_NOT_FOUND' })
    }
    const configs = await getPluginConfigs(pluginId)
    const expectedValue = `/api/plugins/${encodeURIComponent(pluginId)}/config-files/${encodeURIComponent(key)}/${encodeURIComponent(filename)}`
    const currentValue = configs.find(config => config.key === key && !config.isSecret)?.valueJson
    if (currentValue !== expectedValue) {
      return reply.code(404).send({ error: 'Plugin config file not found', code: 'PLUGIN_CONFIG_FILE_NOT_FOUND' })
    }
    try {
      const filePath = resolveInside(getPluginDataDir(), join('config-files', pluginId, key, filename))
      const body = await readFile(filePath)
      reply
        .type(contentTypeForPath(filename))
        .header('Cache-Control', 'private, max-age=60')
        .header('Referrer-Policy', 'same-origin')
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Robots-Tag', 'noindex')
        .send(body)
    } catch {
      return reply.code(404).send({ error: 'Plugin config file not found', code: 'PLUGIN_CONFIG_FILE_NOT_FOUND' })
    }
  })

  fastify.get<{ Params: PluginParams }>('/:pluginId/storage-usage', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const plugin = await getPlugin(pluginId)
    const latest = plugin ? latestManifest(plugin) : null
    if (!plugin || !latest) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })

    const storage = latest.manifest.capabilities?.storage
    const declaredScopes = storage?.scopes?.length ? storage.scopes : ['user']
    const [legacyUserKeyCount, kvCounts, tableCounts, migrationCounts] = await Promise.all([
      countPluginUserDataItems(pluginId),
      listPluginStorageScopeCounts(pluginId),
      listPluginTableScopeCounts(pluginId),
      listPluginTableMigrationCounts(pluginId)
    ])

    const kvCountByScope = new Map(kvCounts.map(item => [item.scopeType, item.count]))
    const scopeNames = Array.from(new Set([...declaredScopes, ...kvCounts.map(item => item.scopeType)])).sort()
    const kv = scopeNames.map(scopeType => ({
      scopeType,
      keyCount: kvCountByScope.get(scopeType) || 0,
      maxKeys: storage?.maxKeys ?? null,
      declared: declaredScopes.includes(scopeType as 'user' | 'global' | 'service')
    }))

    const migrationCountByTable = new Map(migrationCounts.map(item => [item.tableName, item.count]))
    const tableCountByKey = new Map(tableCounts.map(item => [`${item.tableName}:${item.scopeType}`, item.count]))
    const declaredTableKeys = new Set<string>()
    const tables = (storage?.tables || []).flatMap(table => {
      const tableScopes = table.scopes?.length ? table.scopes : declaredScopes
      return tableScopes.map(scopeType => {
        declaredTableKeys.add(`${table.name}:${scopeType}`)
        return {
          tableName: table.name,
          scopeType,
          rowCount: tableCountByKey.get(`${table.name}:${scopeType}`) || 0,
          maxRows: table.maxRows ?? null,
          migrationCount: migrationCountByTable.get(table.name) || 0,
          declared: true
        }
      })
    })

    for (const item of tableCounts) {
      const key = `${item.tableName}:${item.scopeType}`
      if (!declaredTableKeys.has(key)) {
        tables.push({
          tableName: item.tableName,
          scopeType: item.scopeType,
          rowCount: item.count,
          maxRows: null,
          migrationCount: migrationCountByTable.get(item.tableName) || 0,
          declared: false
        })
      }
    }
    const warnings = buildPluginStorageWarnings({ kv, tables })

    return {
      usage: {
        pluginId,
        storageDeclared: storage?.kind === 'kv',
        retention: storage?.retention || 'delete_on_uninstall',
        legacyUserKeyCount,
        kv,
        tables,
        warnings,
        totals: {
          kvKeys: kv.reduce((sum, item) => sum + item.keyCount, 0),
          tableRows: tables.reduce((sum, item) => sum + item.rowCount, 0),
          tableMigrations: migrationCounts.reduce((sum, item) => sum + item.count, 0)
        }
      }
    }
  })

  fastify.get<{ Params: PluginParams }>('/:pluginId/storage-backup', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const plugin = await getPlugin(pluginId)
    const latest = plugin ? latestManifest(plugin) : null
    if (!plugin || !latest) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })

    const backup = await buildPluginStorageBackup(pluginId, latest.manifest.version)

    const user = getRequestUser(request)
    await createPluginEvent(pluginId, user.id, 'plugin.storage.backup_export', 'success', 'Exported plugin storage backup', {
      payload: {
        backupId: backup.backupId,
        mode: backup.mode,
        contentSha256: backup.contentSha256,
        counts: backup.counts
      }
    })
    reply.header('Content-Disposition', `attachment; filename="${pluginId}-storage-backup.json"`)
    return { backup }
  })

  fastify.get<{ Params: PluginParams }>('/:pluginId/storage-backup/archives', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const plugin = await getPlugin(pluginId)
    if (!plugin || !latestManifest(plugin)) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })

    const archiveDir = await getPluginStorageBackupArchiveDir(pluginId)
    const filenames = await readdir(archiveDir)
    const remoteArchives = await prisma.pluginStorageBackupRemoteArchive.findMany({
      where: { pluginId, status: 'available' },
      orderBy: { createdAt: 'desc' }
    })
    const remoteByBackupId = new Map<string, ReturnType<typeof serializePluginStorageBackupRemoteArchive>[]>()
    for (const remoteArchive of remoteArchives) {
      const list = remoteByBackupId.get(remoteArchive.backupId) || []
      list.push(serializePluginStorageBackupRemoteArchive(remoteArchive))
      remoteByBackupId.set(remoteArchive.backupId, list)
    }

    const archives = []
    for (const filename of filenames.filter(name => name.endsWith('.json')).sort().reverse()) {
      const backupId = normalizePluginStorageBackupArchiveId(filename.slice(0, -'.json'.length))
      if (!backupId) continue
      try {
        const backup = await readPluginStorageBackupArchive(pluginId, backupId)
        archives.push({
          ...serializePluginStorageBackupArchive(backup),
          remoteArchives: remoteByBackupId.get(backupId) || []
        })
      } catch {
        continue
      }
    }
    return { archives }
  })

  fastify.post<{ Params: PluginParams; Querystring: PluginStorageBackupArchiveCreateQuery }>('/:pluginId/storage-backup/archives', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const plugin = await getPlugin(pluginId)
    const latest = plugin ? latestManifest(plugin) : null
    if (!plugin || !latest) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })

    const requestedMode = request.query?.mode === 'differential' ? 'differential' : 'full'
    const fullBackup = await buildPluginStorageBackup(pluginId, latest.manifest.version)
    const baseBackup = requestedMode === 'differential'
      ? await findLatestFullPluginStorageBackupArchive(pluginId)
      : null
    const backup: PluginStorageArchivePayload = requestedMode === 'differential' && baseBackup
      ? buildDifferentialPluginStorageBackup({
          pluginId,
          pluginVersion: latest.manifest.version,
          current: fullBackup,
          base: baseBackup
        })
      : fullBackup
    const archivePath = await getPluginStorageBackupArchivePath(pluginId, backup.backupId)
    await writeFile(archivePath, JSON.stringify(backup, null, 2), { flag: 'wx' })

    const user = getRequestUser(request)
    await createPluginEvent(pluginId, user.id, 'plugin.storage.backup_archive_create', 'success', 'Created plugin storage backup archive', {
      payload: {
        ...serializePluginStorageBackupArchive(backup),
        requestedMode
      }
    })
    return { archive: serializePluginStorageBackupArchive(backup) }
  })

  fastify.get<{ Params: PluginStorageBackupArchiveParams }>('/:pluginId/storage-backup/archives/:backupId', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const backupId = normalizePluginStorageBackupArchiveId(request.params.backupId)
    if (!pluginId || !backupId) return reply.code(400).send({ error: 'Invalid plugin storage backup archive', code: 'INVALID_PLUGIN_STORAGE_BACKUP_ARCHIVE' })
    const plugin = await getPlugin(pluginId)
    if (!plugin || !latestManifest(plugin)) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    try {
      const backup = await readPluginStorageBackupArchive(pluginId, backupId)
      reply.header('Content-Disposition', `attachment; filename="${pluginId}-${backupId}-storage-backup.json"`)
      return { backup }
    } catch {
      return reply.code(404).send({ error: 'Plugin storage backup archive not found', code: 'PLUGIN_STORAGE_BACKUP_ARCHIVE_NOT_FOUND' })
    }
  })

  fastify.post<{ Params: PluginStorageBackupArchiveParams; Querystring: PluginStorageBackupRestoreQuery }>('/:pluginId/storage-backup/archives/:backupId/restore', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const backupId = normalizePluginStorageBackupArchiveId(request.params.backupId)
    if (!pluginId || !backupId) return reply.code(400).send({ error: 'Invalid plugin storage backup archive', code: 'INVALID_PLUGIN_STORAGE_BACKUP_ARCHIVE' })
    const plugin = await getPlugin(pluginId)
    if (!plugin || !latestManifest(plugin)) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })

    let archivedBackup: PluginStorageArchivePayload
    try {
      archivedBackup = await readPluginStorageBackupArchive(pluginId, backupId)
    } catch {
      return reply.code(404).send({ error: 'Plugin storage backup archive not found', code: 'PLUGIN_STORAGE_BACKUP_ARCHIVE_NOT_FOUND' })
    }

    let backup: ReturnType<typeof normalizePluginStorageBackupPayload>
    try {
      backup = await resolvePluginStorageBackupArchiveForRestore(pluginId, archivedBackup)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'INVALID_PLUGIN_STORAGE_BACKUP' })
    }

    const user = getRequestUser(request)
    return restorePluginStorageBackup({
      pluginId,
      userId: user.id,
      backup,
      dryRun: request.query?.dryRun === 'true',
      archiveId: backupId
    })
  })

  fastify.post<{
    Params: PluginStorageBackupArchiveParams
    Body: PluginStorageBackupRemoteUploadBody
  }>('/:pluginId/storage-backup/archives/:backupId/upload-remote', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          storageConfigId: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const backupId = normalizePluginStorageBackupArchiveId(request.params.backupId)
    if (!pluginId || !backupId) return reply.code(400).send({ error: 'Invalid plugin storage backup archive', code: 'INVALID_PLUGIN_STORAGE_BACKUP_ARCHIVE' })
    const plugin = await getPlugin(pluginId)
    if (!plugin || !latestManifest(plugin)) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })

    let backup: PluginStorageArchivePayload
    try {
      backup = await readPluginStorageBackupArchive(pluginId, backupId)
    } catch {
      return reply.code(404).send({ error: 'Plugin storage backup archive not found', code: 'PLUGIN_STORAGE_BACKUP_ARCHIVE_NOT_FOUND' })
    }

    const user = getRequestUser(request)
    const storageConfig = request.body?.storageConfigId
      ? await getStorageConfigById(request.body.storageConfigId)
      : await getDefaultStorageConfig(user.id)
    if (!storageConfig || storageConfig.userId !== user.id) {
      return reply.code(404).send({ error: 'Storage config not found', code: 'STORAGE_CONFIG_NOT_FOUND' })
    }

    const archivePath = await getPluginStorageBackupArchivePath(pluginId, backupId)
    const remoteFileName = normalizePluginStorageBackupRemoteFileName(pluginId, backupId)
    const archiveStat = await stat(archivePath)

    try {
      const provider = StorageFactory.create(storageConfig)
      await provider.uploadStream(createReadStream(archivePath), remoteFileName)
      const remoteArchive = await prisma.pluginStorageBackupRemoteArchive.upsert({
        where: {
          pluginId_backupId_storageConfigId_remoteFileName: {
            pluginId,
            backupId,
            storageConfigId: storageConfig.id,
            remoteFileName
          }
        },
        create: {
          pluginId,
          backupId,
          storageConfigId: storageConfig.id,
          uploadedByUserId: user.id,
          remoteFileName,
          remotePath: storageConfig.basePath ? `${storageConfig.basePath.replace(/\/+$/, '')}/${remoteFileName}` : remoteFileName,
          storageName: storageConfig.name,
          storageType: storageConfig.type,
          contentSha256: backup.contentSha256,
          fileSize: BigInt(archiveStat.size),
          status: 'available'
        },
        update: {
          uploadedByUserId: user.id,
          remotePath: storageConfig.basePath ? `${storageConfig.basePath.replace(/\/+$/, '')}/${remoteFileName}` : remoteFileName,
          storageName: storageConfig.name,
          storageType: storageConfig.type,
          contentSha256: backup.contentSha256,
          fileSize: BigInt(archiveStat.size),
          status: 'available',
          lastRestoredAt: null
        }
      })
      await createPluginEvent(pluginId, user.id, 'plugin.storage.backup_remote_upload', 'success', 'Uploaded plugin storage backup archive to remote storage', {
        payload: {
          backupId,
          remoteArchiveId: remoteArchive.id,
          storageConfigId: storageConfig.id,
          storageName: storageConfig.name,
          storageType: storageConfig.type,
          remoteFileName,
          contentSha256: backup.contentSha256,
          fileSize: archiveStat.size
        }
      })
      return { remoteArchive: serializePluginStorageBackupRemoteArchive(remoteArchive) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await createPluginEvent(pluginId, user.id, 'plugin.storage.backup_remote_upload', 'failed', `Plugin storage remote backup upload failed: ${message}`)
      return reply.code(400).send({ error: message, code: 'PLUGIN_STORAGE_BACKUP_REMOTE_UPLOAD_FAILED' })
    }
  })

  fastify.post<{
    Params: PluginStorageBackupRemoteArchiveParams
    Querystring: PluginStorageBackupRestoreQuery
  }>('/:pluginId/storage-backup/archives/:backupId/remote/:remoteArchiveId/restore', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const backupId = normalizePluginStorageBackupArchiveId(request.params.backupId)
    const remoteArchiveId = parsePositiveId(request.params.remoteArchiveId)
    if (!pluginId || !backupId || !remoteArchiveId) return reply.code(400).send({ error: 'Invalid plugin storage remote backup archive', code: 'INVALID_PLUGIN_STORAGE_REMOTE_BACKUP_ARCHIVE' })
    const plugin = await getPlugin(pluginId)
    if (!plugin || !latestManifest(plugin)) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })

    const remoteArchive = await prisma.pluginStorageBackupRemoteArchive.findFirst({
      where: { id: remoteArchiveId, pluginId, backupId, status: 'available' }
    })
    if (!remoteArchive) {
      return reply.code(404).send({ error: 'Plugin storage remote backup archive not found', code: 'PLUGIN_STORAGE_REMOTE_BACKUP_ARCHIVE_NOT_FOUND' })
    }

    const user = getRequestUser(request)
    const storageConfig = await getStorageConfigById(remoteArchive.storageConfigId)
    if (!storageConfig || storageConfig.userId !== user.id) {
      return reply.code(404).send({ error: 'Storage config not found', code: 'STORAGE_CONFIG_NOT_FOUND' })
    }

    let backupPayload: unknown
    try {
      const provider = StorageFactory.create(storageConfig)
      const stream = await provider.downloadStream(remoteArchive.remoteFileName)
      const text = await readRemotePluginStorageBackupStream(stream)
      backupPayload = JSON.parse(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'PLUGIN_STORAGE_BACKUP_REMOTE_DOWNLOAD_FAILED' })
    }

    let backup: ReturnType<typeof normalizePluginStorageBackupPayload>
    try {
      const normalized = await resolvePluginStorageBackupArchiveForRestore(pluginId, backupPayload)
      const contentSha256 = buildPluginStorageBackupContentHash(normalized)
      if (contentSha256 !== remoteArchive.contentSha256) {
        throw new Error('Plugin storage remote backup checksum mismatch')
      }
      backup = normalized
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'INVALID_PLUGIN_STORAGE_BACKUP' })
    }

    const result = await restorePluginStorageBackup({
      pluginId,
      userId: user.id,
      backup,
      dryRun: request.query?.dryRun === 'true',
      archiveId: `remote:${remoteArchive.id}:${backupId}`
    })
    if (request.query?.dryRun !== 'true') {
      await prisma.pluginStorageBackupRemoteArchive.update({
        where: { id: remoteArchive.id },
        data: { lastRestoredAt: new Date() }
      })
    }
    return result
  })

  fastify.delete<{ Params: PluginStorageBackupArchiveParams }>('/:pluginId/storage-backup/archives/:backupId', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const backupId = normalizePluginStorageBackupArchiveId(request.params.backupId)
    if (!pluginId || !backupId) return reply.code(400).send({ error: 'Invalid plugin storage backup archive', code: 'INVALID_PLUGIN_STORAGE_BACKUP_ARCHIVE' })
    const plugin = await getPlugin(pluginId)
    if (!plugin || !latestManifest(plugin)) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const dependents = await listPluginStorageBackupDependents(pluginId, backupId)
    if (dependents.length > 0) {
      return reply.code(409).send({
        error: 'Plugin storage backup archive is referenced by differential archives',
        code: 'PLUGIN_STORAGE_BACKUP_ARCHIVE_HAS_DEPENDENTS',
        dependents
      })
    }
    const archivePath = await getPluginStorageBackupArchivePath(pluginId, backupId)
    await rm(archivePath, { force: true })

    const user = getRequestUser(request)
    await createPluginEvent(pluginId, user.id, 'plugin.storage.backup_archive_delete', 'success', `Deleted plugin storage backup archive ${backupId}`)
    return { message: 'Plugin storage backup archive deleted' }
  })

  fastify.post<{ Params: PluginParams; Querystring: PluginStorageBackupRestoreQuery; Body: PluginStorageBackupBody }>('/:pluginId/storage-backup/restore', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['backup'],
        additionalProperties: false,
        properties: {
          backup: {}
        }
      }
    }
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    if (!pluginId) return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    const plugin = await getPlugin(pluginId)
    if (!plugin || !latestManifest(plugin)) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    let backup: ReturnType<typeof normalizePluginStorageBackupPayload>
    try {
      backup = await normalizeAndValidatePluginStorageBackupForRestore(pluginId, request.body.backup)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'INVALID_PLUGIN_STORAGE_BACKUP' })
    }

    const user = getRequestUser(request)
    return restorePluginStorageBackup({
      pluginId,
      userId: user.id,
      backup,
      dryRun: request.query?.dryRun === 'true'
    })
  })

  fastify.get<{ Params: PluginScopedStorageParams; Querystring: PluginScopedStorageQuery }>('/:pluginId/scoped-storage/:scope/:key', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const scope = normalizeStorageScope(request.params.scope)
    const key = normalizeStorageKey(request.params.key)
    if (!pluginId || !scope || !key) return reply.code(400).send({ error: 'Invalid plugin storage key', code: 'INVALID_PLUGIN_STORAGE_KEY' })
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'read')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const scopeAccess = assertPluginStorageScope(loaded.latest.manifest, scope)
    if (!scopeAccess.ok) return reply.code(scopeAccess.status).send({ error: scopeAccess.message, code: scopeAccess.code })
    const user = getRequestUser(request)
    const resolvedScope = await resolvePluginStorageScope(scope, request.query || {}, user)
    if (!resolvedScope.ok) return reply.code(resolvedScope.status).send({ error: resolvedScope.message, code: resolvedScope.code })
    const data = await getPluginStorageItem(pluginId, scope, resolvedScope.scopeId, key)
    return { data: data ? serializePluginStorageItem(data) : null }
  })

  fastify.put<{ Params: PluginScopedStorageParams; Querystring: PluginScopedStorageQuery; Body: PluginStorageBody }>('/:pluginId/scoped-storage/:scope/:key', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: {
          value: {}
        }
      }
    }
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const scope = normalizeStorageScope(request.params.scope)
    const key = normalizeStorageKey(request.params.key)
    if (!pluginId || !scope || !key) return reply.code(400).send({ error: 'Invalid plugin storage key', code: 'INVALID_PLUGIN_STORAGE_KEY' })
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'write')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const scopeAccess = assertPluginStorageScope(loaded.latest.manifest, scope)
    if (!scopeAccess.ok) return reply.code(scopeAccess.status).send({ error: scopeAccess.message, code: scopeAccess.code })
    const user = getRequestUser(request)
    if (scope === 'global' && user.role !== 'admin') {
      return reply.code(403).send({ error: 'Global plugin storage writes require admin privileges', code: 'PLUGIN_GLOBAL_STORAGE_ADMIN_REQUIRED' })
    }
    try {
      assertStoragePayload(request.body.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'INVALID_PLUGIN_STORAGE_VALUE' })
    }
    const resolvedScope = await resolvePluginStorageScope(scope, request.query || {}, user)
    if (!resolvedScope.ok) return reply.code(resolvedScope.status).send({ error: resolvedScope.message, code: resolvedScope.code })
    const existing = await getPluginStorageItem(pluginId, scope, resolvedScope.scopeId, key)
    const maxKeys = loaded.latest.manifest.capabilities?.storage?.maxKeys
    if (!existing && maxKeys) {
      const keyCount = await countPluginStorageItems(pluginId, scope, resolvedScope.scopeId)
      if (keyCount >= maxKeys) {
        return reply.code(409).send({ error: 'Plugin storage key limit reached', code: 'PLUGIN_STORAGE_KEY_LIMIT' })
      }
    }
    const data = await upsertPluginStorageItem({
      pluginId,
      scopeType: scope,
      scopeId: resolvedScope.scopeId,
      key,
      value: request.body.value,
      actorUserId: user.id
    })
    await createPluginEvent(pluginId, user.id, 'plugin.storage.write', 'success', `Updated ${scope} storage key ${key}`)
    return { data: serializePluginStorageItem(data) }
  })

  fastify.delete<{ Params: PluginScopedStorageParams; Querystring: PluginScopedStorageQuery }>('/:pluginId/scoped-storage/:scope/:key', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const scope = normalizeStorageScope(request.params.scope)
    const key = normalizeStorageKey(request.params.key)
    if (!pluginId || !scope || !key) return reply.code(400).send({ error: 'Invalid plugin storage key', code: 'INVALID_PLUGIN_STORAGE_KEY' })
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'write')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const scopeAccess = assertPluginStorageScope(loaded.latest.manifest, scope)
    if (!scopeAccess.ok) return reply.code(scopeAccess.status).send({ error: scopeAccess.message, code: scopeAccess.code })
    const user = getRequestUser(request)
    if (scope === 'global' && user.role !== 'admin') {
      return reply.code(403).send({ error: 'Global plugin storage writes require admin privileges', code: 'PLUGIN_GLOBAL_STORAGE_ADMIN_REQUIRED' })
    }
    const resolvedScope = await resolvePluginStorageScope(scope, request.query || {}, user)
    if (!resolvedScope.ok) return reply.code(resolvedScope.status).send({ error: resolvedScope.message, code: resolvedScope.code })
    await deletePluginStorageItem(pluginId, scope, resolvedScope.scopeId, key)
    await createPluginEvent(pluginId, user.id, 'plugin.storage.delete', 'success', `Deleted ${scope} storage key ${key}`)
    return { message: 'Plugin storage key deleted' }
  })

  fastify.get<{ Params: PluginTableStorageParams; Querystring: PluginScopedStorageQuery }>('/:pluginId/table-storage/:scope/:table/:rowKey', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const scope = normalizeStorageScope(request.params.scope)
    const tableName = normalizePluginTableName(request.params.table)
    const rowKey = normalizePluginTableRowKey(request.params.rowKey)
    if (!pluginId || !scope || !tableName || !rowKey) {
      return reply.code(400).send({ error: 'Invalid plugin table row key', code: 'INVALID_PLUGIN_TABLE_ROW_KEY' })
    }

    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found or disabled', code: 'PLUGIN_NOT_ENABLED' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'read')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const table = resolvePluginTable(loaded.latest.manifest, tableName)
    if (!table) return reply.code(404).send({ error: 'Plugin table is not declared in manifest capabilities', code: 'PLUGIN_TABLE_NOT_DECLARED' })
    const scopeAccess = assertPluginTableScope(loaded.latest.manifest, table, scope)
    if (!scopeAccess.ok) return reply.code(scopeAccess.status).send({ error: scopeAccess.message, code: scopeAccess.code })
    const user = getRequestUser(request)
    const resolvedScope = await resolvePluginStorageScope(scope, request.query || {}, user)
    if (!resolvedScope.ok) return reply.code(resolvedScope.status).send({ error: resolvedScope.message, code: resolvedScope.code })

    const data = await getPluginTableRow(pluginId, tableName, scope, resolvedScope.scopeId, rowKey)
    return { data: data ? serializePluginTableRow(data) : null }
  })

  fastify.put<{ Params: PluginTableStorageParams; Querystring: PluginScopedStorageQuery; Body: PluginStorageBody }>('/:pluginId/table-storage/:scope/:table/:rowKey', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    let value: unknown
    try {
      value = request.body?.value
      assertPluginTablePayload(value)
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message, code: 'INVALID_PLUGIN_TABLE_ROW_VALUE' })
    }
    const pluginId = normalizePluginId(request.params.pluginId)
    const scope = normalizeStorageScope(request.params.scope)
    const tableName = normalizePluginTableName(request.params.table)
    const rowKey = normalizePluginTableRowKey(request.params.rowKey)
    if (!pluginId || !scope || !tableName || !rowKey) {
      return reply.code(400).send({ error: 'Invalid plugin table row key', code: 'INVALID_PLUGIN_TABLE_ROW_KEY' })
    }

    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found or disabled', code: 'PLUGIN_NOT_ENABLED' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'write')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const table = resolvePluginTable(loaded.latest.manifest, tableName)
    if (!table) return reply.code(404).send({ error: 'Plugin table is not declared in manifest capabilities', code: 'PLUGIN_TABLE_NOT_DECLARED' })
    const scopeAccess = assertPluginTableScope(loaded.latest.manifest, table, scope)
    if (!scopeAccess.ok) return reply.code(scopeAccess.status).send({ error: scopeAccess.message, code: scopeAccess.code })
    const user = getRequestUser(request)
    if (scope === 'global' && user.role !== 'admin') {
      return reply.code(403).send({ error: 'Global plugin table writes require admin privileges', code: 'PLUGIN_GLOBAL_TABLE_ADMIN_REQUIRED' })
    }
    const resolvedScope = await resolvePluginStorageScope(scope, request.query || {}, user)
    if (!resolvedScope.ok) return reply.code(resolvedScope.status).send({ error: resolvedScope.message, code: resolvedScope.code })

    const existing = await getPluginTableRow(pluginId, tableName, scope, resolvedScope.scopeId, rowKey)
    if (!existing && table.maxRows) {
      const rowCount = await countPluginTableRows(pluginId, tableName, scope, resolvedScope.scopeId)
      if (rowCount >= table.maxRows) {
        return reply.code(409).send({ error: 'Plugin table row limit reached', code: 'PLUGIN_TABLE_ROW_LIMIT' })
      }
    }

    const data = await upsertPluginTableRow({
      pluginId,
      tableName,
      scopeType: scope,
      scopeId: resolvedScope.scopeId,
      rowKey,
      value,
      actorUserId: user.id
    })
    await createPluginEvent(pluginId, user.id, 'plugin.table.write', 'success', `Updated ${scope} table ${tableName} row ${rowKey}`)
    return { data: serializePluginTableRow(data) }
  })

  fastify.delete<{ Params: PluginTableStorageParams; Querystring: PluginScopedStorageQuery }>('/:pluginId/table-storage/:scope/:table/:rowKey', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const scope = normalizeStorageScope(request.params.scope)
    const tableName = normalizePluginTableName(request.params.table)
    const rowKey = normalizePluginTableRowKey(request.params.rowKey)
    if (!pluginId || !scope || !tableName || !rowKey) {
      return reply.code(400).send({ error: 'Invalid plugin table row key', code: 'INVALID_PLUGIN_TABLE_ROW_KEY' })
    }

    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found or disabled', code: 'PLUGIN_NOT_ENABLED' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'write')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const table = resolvePluginTable(loaded.latest.manifest, tableName)
    if (!table) return reply.code(404).send({ error: 'Plugin table is not declared in manifest capabilities', code: 'PLUGIN_TABLE_NOT_DECLARED' })
    const scopeAccess = assertPluginTableScope(loaded.latest.manifest, table, scope)
    if (!scopeAccess.ok) return reply.code(scopeAccess.status).send({ error: scopeAccess.message, code: scopeAccess.code })
    const user = getRequestUser(request)
    if (scope === 'global' && user.role !== 'admin') {
      return reply.code(403).send({ error: 'Global plugin table deletes require admin privileges', code: 'PLUGIN_GLOBAL_TABLE_ADMIN_REQUIRED' })
    }
    const resolvedScope = await resolvePluginStorageScope(scope, request.query || {}, user)
    if (!resolvedScope.ok) return reply.code(resolvedScope.status).send({ error: resolvedScope.message, code: resolvedScope.code })

    await deletePluginTableRow(pluginId, tableName, scope, resolvedScope.scopeId, rowKey)
    await createPluginEvent(pluginId, user.id, 'plugin.table.delete', 'success', `Deleted ${scope} table ${tableName} row ${rowKey}`)
    return { message: 'Plugin table row deleted' }
  })

  fastify.get<{ Params: PluginTableMigrationParams }>('/:pluginId/table-storage/:table/migrations', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const tableName = normalizePluginTableName(request.params.table)
    if (!pluginId || !tableName) return reply.code(400).send({ error: 'Invalid plugin table name', code: 'INVALID_PLUGIN_TABLE_NAME' })
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found or disabled', code: 'PLUGIN_NOT_ENABLED' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'read')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const table = resolvePluginTable(loaded.latest.manifest, tableName)
    if (!table) return reply.code(404).send({ error: 'Plugin table is not declared in manifest capabilities', code: 'PLUGIN_TABLE_NOT_DECLARED' })
    const migrations = await listPluginTableMigrations(pluginId, tableName)
    return { data: migrations.map(serializePluginTableMigration) }
  })

  fastify.post<{ Params: PluginTableMigrationParams; Body: PluginTableMigrationBody }>('/:pluginId/table-storage/:table/migrations', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const tableName = normalizePluginTableName(request.params.table)
    const version = typeof request.body?.version === 'string' ? request.body.version.trim() : ''
    if (!pluginId || !tableName || !/^\d{1,8}(?:\.\d{1,8}){0,2}$/.test(version)) {
      return reply.code(400).send({ error: 'Invalid plugin table migration', code: 'INVALID_PLUGIN_TABLE_MIGRATION' })
    }
    const user = getRequestUser(request)
    if (user.role !== 'admin') {
      return reply.code(403).send({ error: 'Plugin table migrations require admin privileges', code: 'PLUGIN_TABLE_MIGRATION_ADMIN_REQUIRED' })
    }
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found or disabled', code: 'PLUGIN_NOT_ENABLED' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'write')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const table = resolvePluginTable(loaded.latest.manifest, tableName)
    if (!table) return reply.code(404).send({ error: 'Plugin table is not declared in manifest capabilities', code: 'PLUGIN_TABLE_NOT_DECLARED' })
    const migration = table.migrations?.find(item => item.version === version)
    if (!migration) {
      return reply.code(404).send({ error: 'Plugin table migration is not declared in manifest capabilities', code: 'PLUGIN_TABLE_MIGRATION_NOT_DECLARED' })
    }
    const data = await applyPluginTableMigration({
      pluginId,
      tableName,
      version,
      name: migration.name,
      actorUserId: user.id
    })
    await createPluginEvent(pluginId, user.id, 'plugin.table.migration', 'success', `Applied ${tableName} migration ${version}`)
    return { data: serializePluginTableMigration(data) }
  })

  fastify.get<{ Params: PluginStorageParams }>('/:pluginId/storage/:key', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const key = normalizeStorageKey(request.params.key)
    if (!pluginId || !key) return reply.code(400).send({ error: 'Invalid plugin storage key', code: 'INVALID_PLUGIN_STORAGE_KEY' })
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'read')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const user = getRequestUser(request)
    const data = await getPluginUserData(pluginId, user.id, key)
    return { data: data ? serializePluginUserData(data) : null }
  })

  fastify.put<{ Params: PluginStorageParams; Body: PluginStorageBody }>('/:pluginId/storage/:key', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: {
          value: {}
        }
      }
    }
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const key = normalizeStorageKey(request.params.key)
    if (!pluginId || !key) return reply.code(400).send({ error: 'Invalid plugin storage key', code: 'INVALID_PLUGIN_STORAGE_KEY' })
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'write')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    try {
      assertStoragePayload(request.body.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'INVALID_PLUGIN_STORAGE_VALUE' })
    }
    const user = getRequestUser(request)
    const existing = await getPluginUserData(pluginId, user.id, key)
    const maxKeys = loaded.latest.manifest.capabilities?.storage?.maxKeys
    if (!existing && maxKeys) {
      const keyCount = await prisma.pluginUserData.count({ where: { pluginId, userId: user.id } })
      if (keyCount >= maxKeys) {
        return reply.code(409).send({ error: 'Plugin storage key limit reached', code: 'PLUGIN_STORAGE_KEY_LIMIT' })
      }
    }
    const data = await upsertPluginUserData(pluginId, user.id, key, request.body.value)
    await createPluginEvent(pluginId, user.id, 'plugin.storage.write', 'success', `Updated user storage key ${key}`)
    return { data: serializePluginUserData(data) }
  })

  fastify.delete<{ Params: PluginStorageParams }>('/:pluginId/storage/:key', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const key = normalizeStorageKey(request.params.key)
    if (!pluginId || !key) return reply.code(400).send({ error: 'Invalid plugin storage key', code: 'INVALID_PLUGIN_STORAGE_KEY' })
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    const access = assertPluginStorageAccess(loaded.latest.manifest, 'write')
    if (!access.ok) return reply.code(access.status).send({ error: access.message, code: access.code })
    const user = getRequestUser(request)
    await deletePluginUserData(pluginId, user.id, key)
    await createPluginEvent(pluginId, user.id, 'plugin.storage.delete', 'success', `Deleted user storage key ${key}`)
    return { message: 'Plugin storage key deleted' }
  })

  fastify.get<{ Params: { hook: string }; Querystring: PluginGatewayTargetsQuery }>('/gateway-actions/:hook/targets', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const hook = normalizeGatewayExtensionHook(request.params.hook)
    if (!hook) {
      return reply.code(400).send({ error: 'Invalid plugin gateway action', code: 'INVALID_PLUGIN_GATEWAY_ACTION' })
    }
    const providerCode = typeof request.query.providerCode === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(request.query.providerCode.trim())
      ? request.query.providerCode.trim()
      : null
    if (request.query.providerCode !== undefined && !providerCode) {
      return reply.code(400).send({ error: 'Invalid provider code', code: 'INVALID_GATEWAY_PROVIDER_CODE' })
    }
    const targets = await listEnabledGatewayExtensionTargets(hook, providerCode)
    return { targets }
  })

  fastify.post<{ Params: PluginGatewayActionParams; Body: PluginGatewayActionBody }>('/:pluginId/gateway-actions/:hook', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        additionalProperties: true
      }
    }
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const hook = normalizeGatewayExtensionHook(request.params.hook)
    if (!pluginId || !hook) {
      return reply.code(400).send({ error: 'Invalid plugin gateway action', code: 'INVALID_PLUGIN_GATEWAY_ACTION' })
    }

    const body = (request.body || {}) as PluginGatewayActionBody
    const gatewayExtensionKey = typeof body.gatewayExtensionKey === 'string' ? body.gatewayExtensionKey.trim() : undefined
    if (gatewayExtensionKey !== undefined && !/^[a-z][a-z0-9_-]{1,79}$/.test(gatewayExtensionKey)) {
      return reply.code(400).send({ error: 'Invalid gateway extension key', code: 'INVALID_GATEWAY_EXTENSION_KEY' })
    }

    const user = getRequestUser(request)
    try {
      const gatewayAction = await dispatchPluginGatewayExtension({
        pluginId,
        actor: user,
        hook,
        gatewayExtensionKey,
        payload: body.payload ?? null,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
      })
      return {
        gatewayAction
      }
    } catch (error) {
      if (error instanceof PluginExtensionDispatchError) {
        return reply.code(error.status).send({ error: error.message, code: error.code })
      }
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'PLUGIN_GATEWAY_ACTION_FAILED' })
    }
  })

  fastify.get<{ Params: { hook: string }; Querystring: PluginServiceTargetsQuery }>('/service-actions/:hook/targets', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const hook = normalizeServiceExtensionHook(request.params.hook)
    if (!hook) {
      return reply.code(400).send({ error: 'Invalid plugin service action', code: 'INVALID_PLUGIN_SERVICE_ACTION' })
    }
    const productId = typeof request.query.productId === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(request.query.productId.trim())
      ? request.query.productId.trim()
      : null
    if (request.query.productId !== undefined && !productId) {
      return reply.code(400).send({ error: 'Invalid product id', code: 'INVALID_SERVICE_EXTENSION_PRODUCT_ID' })
    }
    const targets = await listEnabledServiceExtensionTargets(hook, productId)
    return { targets }
  })

  fastify.post<{ Params: PluginServiceActionParams; Body: PluginServiceActionBody }>('/:pluginId/service-actions/:hook', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        additionalProperties: true
      }
    }
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const hook = normalizeServiceExtensionHook(request.params.hook)
    if (!pluginId || !hook) {
      return reply.code(400).send({ error: 'Invalid plugin service action', code: 'INVALID_PLUGIN_SERVICE_ACTION' })
    }

    const body = (request.body || {}) as PluginServiceActionBody
    const serviceExtensionKey = typeof body.serviceExtensionKey === 'string' ? body.serviceExtensionKey.trim() : undefined
    if (serviceExtensionKey !== undefined && !/^[a-z][a-z0-9_-]{1,79}$/.test(serviceExtensionKey)) {
      return reply.code(400).send({ error: 'Invalid service extension key', code: 'INVALID_SERVICE_EXTENSION_KEY' })
    }

    const user = getRequestUser(request)
    try {
      const serviceAction = await dispatchPluginServiceExtension({
        pluginId,
        actor: user,
        hook,
        serviceExtensionKey,
        payload: body.payload ?? null,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
      })
      return {
        serviceAction
      }
    } catch (error) {
      if (error instanceof PluginExtensionDispatchError) {
        return reply.code(error.status).send({ error: error.message, code: error.code })
      }
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'PLUGIN_SERVICE_ACTION_FAILED' })
    }
  })

  fastify.post<{ Params: PluginActionParams }>('/:pluginId/actions/:action', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        additionalProperties: true
      }
    }
  }, async (request, reply) => {
    const pluginId = normalizePluginId(request.params.pluginId)
    const action = String(request.params.action || '').trim()
    if (!pluginId || !/^[A-Za-z0-9_.:-]{1,80}$/.test(action)) {
      return reply.code(400).send({ error: 'Invalid plugin action', code: 'INVALID_PLUGIN_ACTION' })
    }
    const loaded = await loadEnabledPluginManifest(pluginId)
    if (!loaded) {
      return reply.code(404).send({ error: 'Plugin not found', code: 'PLUGIN_NOT_FOUND' })
    }
    try {
      const body = (request.body || {}) as PluginActionBody
      const result = await executePluginAction({
        pluginId,
        manifest: loaded.latest.manifest,
        actionName: action,
        actor: getRequestUser(request),
        payload: body.payload ?? body,
        source: 'user',
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
      })
      return { action: result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'PLUGIN_ACTION_FAILED' })
    }
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
