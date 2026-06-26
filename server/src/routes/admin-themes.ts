import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  enableThemePackage,
  getThemePackage,
  installValidatedTheme,
  listThemePackages,
  rollbackDefaultTheme,
  serializeThemePackage,
  uninstallThemePackage,
  updateThemePackageConfig
} from '../db/themes.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { getThemeDataDir, getThemePackageMaxBytes, getThemeStagingDir, resolveThemeAsset, validateAndExtractThemePackage, type PayIncusThemeManifest } from '../lib/theme-package.js'
import { downloadMarketTheme, fetchThemeMarketIndex } from '../lib/theme-market.js'
import { getCombinedAdminIdAllowlist } from '../lib/runtime-settings.js'

interface ThemeParams {
  themeId: string
}

interface ThemeConfigFileParams extends ThemeParams {
  key: string
}

interface ThemeConfigBody {
  configValues?: Record<string, unknown>
}

interface ThemeMarketInstallBody {
  themeId: string
}

const THEME_CONFIG_FILE_MAX_BYTES = 2 * 1024 * 1024
const THEME_CONFIG_FILE_MIME_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp']
])

function getRequestUser(request: FastifyRequest): { id: number; username: string; role: 'admin' | 'user' } {
  return request.user as { id: number; username: string; role: 'admin' | 'user' }
}

function normalizeThemeId(value: string): string | null {
  const trimmed = value.trim()
  return /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/.test(trimmed) ? trimmed : null
}

function normalizeConfigBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const json = JSON.stringify(value)
  if (json.length > 32 * 1024) return null
  return value as Record<string, unknown>
}

function summarizeConfigKeys(keys: string[]): string {
  if (keys.length === 0) return 'none'
  const sorted = Array.from(new Set(keys)).sort()
  const visible = sorted.slice(0, 20).join(', ')
  return sorted.length > 20 ? `${visible}, +${sorted.length - 20} more` : visible
}

function stableConfigFingerprint(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value, Object.keys(value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}).sort())
  } catch {
    return String(value)
  }
}

function themeConfigAuditSummary(input: {
  themeId: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  manifest: PayIncusThemeManifest
}): string {
  const beforeKeys = new Set(Object.keys(input.before))
  const afterKeys = new Set(Object.keys(input.after))
  const addedKeys = Array.from(afterKeys).filter(key => !beforeKeys.has(key))
  const removedKeys = Array.from(beforeKeys).filter(key => !afterKeys.has(key))
  const updatedKeys = Array.from(afterKeys).filter(key => {
    if (!beforeKeys.has(key)) return false
    return stableConfigFingerprint(input.before[key]) !== stableConfigFingerprint(input.after[key])
  })
  const changedKeys = [...addedKeys, ...updatedKeys, ...removedKeys]
  const secretKeys = changedKeys.filter(key => {
    const field = input.manifest.configSchema?.[key]
    return field?.type === 'password' || (field as { secret?: boolean } | undefined)?.secret === true
  })
  const fileKeys = changedKeys.filter(key => input.manifest.configSchema?.[key]?.type === 'file')
  return [
    `Updated theme config for ${input.themeId}`,
    `changed=${changedKeys.length}`,
    `added=[${summarizeConfigKeys(addedKeys)}]`,
    `updated=[${summarizeConfigKeys(updatedKeys)}]`,
    `removed=[${summarizeConfigKeys(removedKeys)}]`,
    `secret=[${summarizeConfigKeys(secretKeys)}]`,
    `file=[${summarizeConfigKeys(fileKeys)}]`,
    'values=redacted'
  ].join('; ')
}

async function canManageThemes(user: { id: number; username: string; role: 'admin' | 'user' }): Promise<boolean> {
  if (user.role !== 'admin') return false
  const themeAllowlist = await getCombinedAdminIdAllowlist(
    'theme_manager_allowed_admin_ids',
    'THEME_MANAGER_ALLOWED_ADMIN_IDS'
  )
  const pluginAllowlist = await getCombinedAdminIdAllowlist(
    'plugin_manager_allowed_admin_ids',
    ['PLUGIN_MANAGER_ALLOWED_ADMIN_IDS', 'SYSTEM_UPDATE_ALLOWED_ADMIN_IDS']
  )
  const allowedIds = new Set([...themeAllowlist.ids, ...pluginAllowlist.ids])
  if (allowedIds.size > 0) return allowedIds.has(user.id)
  return user.username === 'admin'
}

async function requireThemeManager(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = getRequestUser(request)
  if (!(await canManageThemes(user))) {
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'theme.manager.denied',
      `Denied theme management access for ${user.username}`,
      LogResult.WARNING
    )
    reply.code(403).send({ error: 'Super administrator privileges required', code: 'SUPER_ADMIN_REQUIRED' })
    return false
  }
  return true
}

async function writeUploadPackage(request: FastifyRequest): Promise<{ packagePath: string; sourceName: string }> {
  const multipartRequest = request as FastifyRequest & {
    parts: () => AsyncIterable<any>
  }
  const uploadDir = join(getThemeStagingDir(), 'uploads')
  await mkdir(uploadDir, { recursive: true })
  const maxBytes = getThemePackageMaxBytes()

  for await (const part of multipartRequest.parts()) {
    if (part.type !== 'file') continue
    if (part.fieldname !== 'package') {
      await part.toBuffer()
      continue
    }
    const filename = String(part.filename || 'theme.tar.gz')
    if (!filename.endsWith('.tar.gz')) {
      throw new Error('Theme package must be a .tar.gz file')
    }
    const buffer = await part.toBuffer()
    if (buffer.length === 0) throw new Error('Theme package is empty')
    if (buffer.length > maxBytes) throw new Error(`Theme package exceeds ${Math.round(maxBytes / 1024 / 1024)}MB`)
    const packagePath = join(uploadDir, `${Date.now()}-${randomUUID()}.tar.gz`)
    await writeFile(packagePath, buffer, { mode: 0o600 })
    return { packagePath, sourceName: filename }
  }

  throw new Error('Missing theme package file')
}

function normalizeThemeConfigKey(value: string): string | null {
  const trimmed = value.trim()
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(trimmed) ? trimmed : null
}

function themeConfigFileContentType(filename: string): string {
  const ext = extname(filename).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

async function writeThemeConfigFileUpload(request: FastifyRequest, themeId: string, key: string): Promise<{
  filename: string
  mimeType: string
  sizeBytes: number
  value: string
}> {
  const multipartRequest = request as FastifyRequest & {
    parts: () => AsyncIterable<any>
  }
  const uploadDir = resolveThemeAsset(getThemeDataDir(), join('config-files', themeId, key))
  await mkdir(uploadDir, { recursive: true })

  for await (const part of multipartRequest.parts()) {
    if (part.type !== 'file') continue
    const mimeType = String(part.mimetype || '').toLowerCase()
    const ext = THEME_CONFIG_FILE_MIME_EXTENSIONS.get(mimeType)
    if (!ext) {
      await part.toBuffer()
      throw new Error('Theme config file must be a PNG, JPEG, or WebP image')
    }
    const buffer = await part.toBuffer()
    if (buffer.length === 0) throw new Error('Theme config file is empty')
    if (buffer.length > THEME_CONFIG_FILE_MAX_BYTES) throw new Error('Theme config file exceeds 2MB')
    const filename = `${Date.now()}-${randomUUID()}${ext}`
    const filePath = resolveThemeAsset(uploadDir, filename)
    await writeFile(filePath, buffer, { mode: 0o600 })
    return {
      filename,
      mimeType: themeConfigFileContentType(filename),
      sizeBytes: buffer.length,
      value: `/api/themes/${encodeURIComponent(themeId)}/config-files/${encodeURIComponent(key)}/${encodeURIComponent(filename)}`
    }
  }

  throw new Error('Missing theme config file')
}

export default async function adminThemeRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    const themes = await listThemePackages()
    return { themes: themes.map(serializeThemePackage) }
  })

  fastify.get('/market', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    return await fetchThemeMarketIndex()
  })

  fastify.post<{ Body: ThemeMarketInstallBody }>('/market/install', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeManager(request, reply))) return
    const user = getRequestUser(request)
    const themeId = normalizeThemeId(String(request.body?.themeId || ''))
    if (!themeId) return reply.code(400).send({ error: 'Invalid theme id', code: 'INVALID_THEME_ID' })

    try {
      const market = await fetchThemeMarketIndex()
      const entry = market.themes.find(item => item.id === themeId)
      if (!entry) return reply.code(404).send({ error: 'Theme market entry not found', code: 'THEME_MARKET_ENTRY_NOT_FOUND' })
      const packagePath = await downloadMarketTheme(entry)
      const validated = await validateAndExtractThemePackage(packagePath, `market-${user.id}-${Date.now()}`)
      if (validated.manifest.id !== entry.id || validated.manifest.version !== entry.latest) {
        return reply.code(400).send({ error: 'Theme package manifest does not match market index', code: 'THEME_MARKET_MANIFEST_MISMATCH' })
      }
      const theme = await installValidatedTheme({
        stagingDir: validated.stagingDir,
        manifest: validated.manifest,
        packageSha256: validated.sha256,
        installedByUserId: user.id
      })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'theme.market_install',
        `Installed market theme ${entry.id}@${entry.latest} from ${entry.downloadUrl}`,
        LogResult.SUCCESS
      )
      return reply.code(201).send({ theme: serializeThemePackage(theme) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await createLog(user.id, LogModule.PLUGIN, 'theme.market_install.failed', message, LogResult.FAILED).catch(() => undefined)
      return reply.code(400).send({ error: message, code: 'THEME_MARKET_INSTALL_FAILED' })
    }
  })

  fastify.post('/upload', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeManager(request, reply))) return
    const user = getRequestUser(request)
    try {
      const upload = await writeUploadPackage(request)
      const validated = await validateAndExtractThemePackage(upload.packagePath, `${user.id}-${Date.now()}`)
      const theme = await installValidatedTheme({
        stagingDir: validated.stagingDir,
        manifest: validated.manifest,
        packageSha256: validated.sha256,
        installedByUserId: user.id
      })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'theme.upload_install',
        `Installed uploaded theme ${validated.manifest.id}@${validated.manifest.version} from ${upload.sourceName}`,
        LogResult.SUCCESS
      )
      return reply.code(201).send({ theme: serializeThemePackage(theme) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await createLog(user.id, LogModule.PLUGIN, 'theme.upload_install.failed', message, LogResult.FAILED).catch(() => undefined)
      return reply.code(400).send({ error: message, code: 'THEME_UPLOAD_FAILED' })
    }
  })

  fastify.post<{ Params: ThemeConfigFileParams }>('/:themeId/config-files/:key', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeManager(request, reply))) return
    const themeId = normalizeThemeId(request.params.themeId)
    const key = normalizeThemeConfigKey(request.params.key)
    if (!themeId || !key) return reply.code(400).send({ error: 'Invalid theme config file key', code: 'INVALID_THEME_CONFIG_FILE_KEY' })
    const theme = await getThemePackage(themeId)
    if (!theme) return reply.code(404).send({ error: 'Theme not found', code: 'THEME_NOT_FOUND' })
    const manifest = theme.manifest as unknown as PayIncusThemeManifest
    const field = manifest.configSchema?.[key]
    if (!field || field.type !== 'file') {
      return reply.code(400).send({ error: 'Theme config key is not a file field', code: 'THEME_CONFIG_FILE_FIELD_REQUIRED' })
    }
    try {
      const uploaded = await writeThemeConfigFileUpload(request, themeId, key)
      const user = getRequestUser(request)
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'theme.config_file.upload',
        `Uploaded config file for ${themeId}.${key} (${uploaded.mimeType}, ${uploaded.sizeBytes} bytes)`,
        LogResult.SUCCESS
      )
      return uploaded
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'THEME_CONFIG_FILE_UPLOAD_FAILED' })
    }
  })

  fastify.post<{ Params: ThemeParams }>('/:themeId/enable', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeManager(request, reply))) return
    const themeId = normalizeThemeId(request.params.themeId)
    if (!themeId) return reply.code(400).send({ error: 'Invalid theme id', code: 'INVALID_THEME_ID' })
    try {
      const user = getRequestUser(request)
      const theme = await enableThemePackage(themeId, user.id)
      await createLog(user.id, LogModule.PLUGIN, 'theme.enable', `Enabled theme ${themeId}`, LogResult.SUCCESS)
      return { theme: serializeThemePackage(theme) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(404).send({ error: message, code: 'THEME_NOT_FOUND' })
    }
  })

  fastify.put<{ Params: ThemeParams; Body: ThemeConfigBody }>('/:themeId/config', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeManager(request, reply))) return
    const themeId = normalizeThemeId(request.params.themeId)
    if (!themeId) return reply.code(400).send({ error: 'Invalid theme id', code: 'INVALID_THEME_ID' })
    const configValues = normalizeConfigBody(request.body?.configValues)
    if (!configValues) return reply.code(400).send({ error: 'Theme config values must be an object and under 32KB', code: 'INVALID_THEME_CONFIG' })
    try {
      const user = getRequestUser(request)
      const beforeTheme = await getThemePackage(themeId)
      if (!beforeTheme) return reply.code(404).send({ error: 'Theme not found', code: 'THEME_NOT_FOUND' })
      const manifest = beforeTheme.manifest as unknown as PayIncusThemeManifest
      const beforeConfig = beforeTheme.configValues as Record<string, unknown>
      const theme = await updateThemePackageConfig(themeId, configValues)
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'theme.config_update',
        themeConfigAuditSummary({
          themeId,
          before: beforeConfig,
          after: theme.configValues as Record<string, unknown>,
          manifest
        }),
        LogResult.SUCCESS
      )
      return { theme: serializeThemePackage(theme) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await createLog(
        getRequestUser(request).id,
        LogModule.PLUGIN,
        'theme.config_update.failed',
        `Failed to update theme config for ${themeId}: ${message}`,
        LogResult.FAILED
      ).catch(() => undefined)
      const code = message === 'Theme not found' ? 'THEME_NOT_FOUND' : 'INVALID_THEME_CONFIG'
      return reply.code(message === 'Theme not found' ? 404 : 400).send({ error: message, code })
    }
  })

  fastify.post('/default', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeManager(request, reply))) return
    const user = getRequestUser(request)
    await rollbackDefaultTheme()
    await createLog(user.id, LogModule.PLUGIN, 'theme.rollback_default', 'Rolled back to default theme', LogResult.SUCCESS)
    return { message: 'Default theme enabled' }
  })

  fastify.delete<{ Params: ThemeParams }>('/:themeId', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeManager(request, reply))) return
    const themeId = normalizeThemeId(request.params.themeId)
    if (!themeId) return reply.code(400).send({ error: 'Invalid theme id', code: 'INVALID_THEME_ID' })
    const theme = await getThemePackage(themeId)
    if (!theme) return reply.code(404).send({ error: 'Theme not found', code: 'THEME_NOT_FOUND' })
    try {
      await uninstallThemePackage(themeId)
      const user = getRequestUser(request)
      await createLog(user.id, LogModule.PLUGIN, 'theme.uninstall', `Uninstalled theme ${themeId}`, LogResult.SUCCESS)
      return { message: 'Theme uninstalled' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(409).send({ error: message, code: 'THEME_UNINSTALL_FAILED' })
    }
  })
}
