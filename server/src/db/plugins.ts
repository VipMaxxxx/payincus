import { rename, rm, mkdir, appendFile } from 'fs/promises'
import { join } from 'path'
import { Prisma } from '@prisma/client'
import type {
  Plugin,
  PluginConfig,
  PluginEventLog,
  PluginInstallTask,
  PluginInstallTaskAction,
  PluginInstallTaskStatus,
  PluginSourceType,
  PluginStatus,
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
  installedBy?: { username: string } | null
  enabledBy?: { username: string } | null
}

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
  return {
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

export async function listPlugins() {
  return await prisma.plugin.findMany({
    orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    include: {
      installedBy: { select: { username: true } },
      enabledBy: { select: { username: true } },
      versions: { orderBy: { installedAt: 'desc' }, take: 1 }
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
      eventLogs: { orderBy: { createdAt: 'desc' }, take: 20 }
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
  await prisma.plugin.delete({ where: { pluginId } })
  await rm(resolveInside(installRoot, pluginId), { recursive: true, force: true })
  await createPluginEvent(pluginId, userId, 'plugin.uninstall', 'success', 'Uninstalled plugin').catch(() => undefined)
}

export async function createPluginEvent(pluginId: string, userId: number | null, action: string, result: string, message?: string | null) {
  return await prisma.pluginEventLog.create({
    data: {
      pluginId,
      userId,
      action,
      result,
      message: message || null
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
