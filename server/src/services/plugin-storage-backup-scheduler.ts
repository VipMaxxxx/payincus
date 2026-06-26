import { createHash } from 'crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { prisma } from '../db/prisma.js'
import { createPluginEvent } from '../db/plugins.js'
import { getPluginDataDir, resolveInside } from '../lib/plugin-package.js'
import { getRuntimeConfigBoolean, getRuntimeConfigNumber } from '../lib/runtime-settings.js'

let schedulerStarted = false

const DEFAULT_INTERVAL_HOURS = 24
const DEFAULT_RETENTION_COUNT = 7

function formatPluginStorageBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/\D/g, '').slice(0, 17)
}

function buildPluginStorageBackupContentHash(input: {
  legacyUserData: Array<{ userId: number; key: string; value: unknown }>
  scopedStorage: Array<{ scopeType: string; scopeId: string; key: string; value: unknown; createdByUserId: number | null; updatedByUserId: number | null }>
  tableRows: Array<{ tableName: string; scopeType: string; scopeId: string; rowKey: string; value: unknown; createdByUserId: number | null; updatedByUserId: number | null }>
  tableMigrations: Array<{ tableName: string; version: string; name: string; appliedByUserId: number }>
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

async function getPluginStorageBackupArchiveDir(pluginId: string): Promise<string> {
  const baseDir = resolveInside(getPluginDataDir(), 'storage-backups/plugins')
  await mkdir(baseDir, { recursive: true })
  const pluginDir = resolveInside(baseDir, pluginId)
  await mkdir(pluginDir, { recursive: true })
  return pluginDir
}

async function getLatestPluginStorageArchiveHash(pluginId: string): Promise<string | null> {
  const archiveDir = await getPluginStorageBackupArchiveDir(pluginId)
  const filenames = (await readdir(archiveDir))
    .filter(name => /^psb_[0-9]{17}_[a-f0-9]{16}\.json$/.test(name))
    .sort()
    .reverse()
  for (const filename of filenames) {
    try {
      const payload = JSON.parse(await readFile(resolveInside(archiveDir, filename), 'utf8')) as { contentSha256?: unknown }
      if (typeof payload.contentSha256 === 'string' && /^[a-f0-9]{64}$/.test(payload.contentSha256)) {
        return payload.contentSha256
      }
    } catch {
      continue
    }
  }
  return null
}

async function prunePluginStorageArchives(pluginId: string, retentionCount: number): Promise<number> {
  if (retentionCount <= 0) return 0
  const archiveDir = await getPluginStorageBackupArchiveDir(pluginId)
  const filenames = (await readdir(archiveDir))
    .filter(name => /^psb_[0-9]{17}_[a-f0-9]{16}\.json$/.test(name))
    .sort()
    .reverse()
  const referencedBaseBackupIds = new Set<string>()
  for (const filename of filenames) {
    try {
      const payload = JSON.parse(await readFile(resolveInside(archiveDir, filename), 'utf8')) as { mode?: unknown; baseBackupId?: unknown }
      if (payload.mode === 'differential' && typeof payload.baseBackupId === 'string') {
        referencedBaseBackupIds.add(payload.baseBackupId)
      }
    } catch {
      continue
    }
  }
  const stale = filenames.slice(retentionCount)
  for (const filename of stale) {
    const backupId = filename.slice(0, -'.json'.length)
    if (referencedBaseBackupIds.has(backupId)) continue
    await rm(resolveInside(archiveDir, filename), { force: true })
  }
  return stale.filter(filename => !referencedBaseBackupIds.has(filename.slice(0, -'.json'.length))).length
}

async function createScheduledPluginStorageArchive(input: {
  pluginId: string
  pluginVersion: string
  retentionCount: number
}): Promise<{ archived: boolean; backupId: string | null; contentSha256: string; totalItems: number; pruned: number }> {
  const pluginId = input.pluginId
  const [legacyUserData, scopedStorage, tableRows, tableMigrations] = await Promise.all([
    prisma.pluginUserData.findMany({ where: { pluginId }, orderBy: [{ userId: 'asc' }, { key: 'asc' }] }),
    prisma.pluginStorageItem.findMany({ where: { pluginId }, orderBy: [{ scopeType: 'asc' }, { scopeId: 'asc' }, { key: 'asc' }] }),
    prisma.pluginTableRow.findMany({ where: { pluginId }, orderBy: [{ tableName: 'asc' }, { scopeType: 'asc' }, { scopeId: 'asc' }, { rowKey: 'asc' }] }),
    prisma.pluginTableMigration.findMany({ where: { pluginId }, orderBy: [{ tableName: 'asc' }, { appliedAt: 'asc' }] })
  ])

  const normalized = {
    legacyUserData: legacyUserData.map(item => ({ userId: item.userId, key: item.key, value: item.valueJson })),
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
  }
  const contentSha256 = buildPluginStorageBackupContentHash(normalized)
  const totalItems = normalized.legacyUserData.length + normalized.scopedStorage.length + normalized.tableRows.length + normalized.tableMigrations.length
  const latestHash = await getLatestPluginStorageArchiveHash(pluginId)
  if (latestHash === contentSha256) {
    const pruned = await prunePluginStorageArchives(pluginId, input.retentionCount)
    await createPluginEvent(pluginId, null, 'plugin.storage.backup_scheduled_skip', 'success', 'Skipped scheduled plugin storage archive because content is unchanged', {
      payload: { contentSha256, totalItems, pruned }
    })
    return { archived: false, backupId: null, contentSha256, totalItems, pruned }
  }

  const exportedAt = new Date()
  const backupId = `psb_${formatPluginStorageBackupTimestamp(exportedAt)}_${contentSha256.slice(0, 16)}`
  const backup = {
    schemaVersion: 1,
    pluginId,
    pluginVersion: input.pluginVersion,
    exportedAt: exportedAt.toISOString(),
    backupId,
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
      legacyUserData: normalized.legacyUserData.length,
      scopedStorage: normalized.scopedStorage.length,
      tableRows: normalized.tableRows.length,
      tableMigrations: normalized.tableMigrations.length,
      totalItems
    },
    restorePolicy: {
      dryRunSupported: true,
      restoreMode: 'replace_all_plugin_storage',
      modifiesBusinessData: false,
      modifiesPluginPackage: false
    }
  }

  const archiveDir = await getPluginStorageBackupArchiveDir(pluginId)
  await writeFile(resolveInside(archiveDir, `${backupId}.json`), JSON.stringify(backup, null, 2), { flag: 'wx' })
  const pruned = await prunePluginStorageArchives(pluginId, input.retentionCount)
  await createPluginEvent(pluginId, null, 'plugin.storage.backup_scheduled_archive', 'success', 'Created scheduled plugin storage archive', {
    payload: { backupId, contentSha256, totalItems, pruned }
  })
  return { archived: true, backupId, contentSha256, totalItems, pruned }
}

export async function runScheduledPluginStorageBackups(now = new Date()): Promise<{ scanned: number; archived: number; skipped: number; failed: number; pruned: number }> {
  const retentionCount = await getRuntimeConfigNumber(
    'plugin_storage_backup_retention_count',
    'PLUGIN_STORAGE_BACKUP_RETENTION_COUNT',
    DEFAULT_RETENTION_COUNT,
    1,
    365
  )
  const plugins = await prisma.plugin.findMany({
    where: { status: { not: 'failed' } },
    select: {
      pluginId: true,
      currentVersion: true,
      versions: {
        orderBy: { installedAt: 'desc' },
        take: 1,
        select: { version: true }
      }
    },
    orderBy: { pluginId: 'asc' }
  })

  let archived = 0
  let skipped = 0
  let failed = 0
  let pruned = 0
  for (const plugin of plugins) {
    const pluginVersion = plugin.currentVersion || plugin.versions[0]?.version
    if (!pluginVersion) {
      skipped += 1
      continue
    }
    try {
      const result = await createScheduledPluginStorageArchive({
        pluginId: plugin.pluginId,
        pluginVersion,
        retentionCount
      })
      if (result.archived) archived += 1
      else skipped += 1
      pruned += result.pruned
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      await createPluginEvent(plugin.pluginId, null, 'plugin.storage.backup_scheduled_archive', 'failed', `Scheduled plugin storage archive failed: ${message}`)
    }
  }
  if (archived > 0 || failed > 0) {
    console.log(`[PluginStorageBackup] ${now.toISOString()} scanned=${plugins.length} archived=${archived} skipped=${skipped} failed=${failed} pruned=${pruned}`)
  }
  return { scanned: plugins.length, archived, skipped, failed, pruned }
}

export function startPluginStorageBackupScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true

  void (async () => {
    const enabled = await getRuntimeConfigBoolean(
      'plugin_storage_backup_schedule_enabled',
      'PLUGIN_STORAGE_BACKUP_SCHEDULE_ENABLED',
      false
    )
    if (!enabled) {
      console.log('[PluginStorageBackup] Scheduled plugin storage backups disabled')
      return
    }

    const intervalHours = await getRuntimeConfigNumber(
      'plugin_storage_backup_interval_hours',
      'PLUGIN_STORAGE_BACKUP_INTERVAL_HOURS',
      DEFAULT_INTERVAL_HOURS,
      1,
      24 * 30
    )
    const intervalMs = intervalHours * 60 * 60 * 1000
    console.log(`[PluginStorageBackup] Starting scheduled plugin storage backups every ${intervalHours}h`)
    void runScheduledPluginStorageBackups().catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[PluginStorageBackup] Initial scheduled backup failed: ${message}`)
    })
    setInterval(() => {
      void runScheduledPluginStorageBackups().catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[PluginStorageBackup] Scheduled backup failed: ${message}`)
      })
    }, intervalMs)
  })().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[PluginStorageBackup] Failed to start scheduler: ${message}`)
  })
}
