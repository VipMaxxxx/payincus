import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { mkdir, readFile, rm } from 'fs/promises'
import { createReadStream } from 'fs'
import { join, resolve, sep } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const THEME_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/
const THEME_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/@-]+$/
const BLOCKED_THEME_FILE_PATTERN = /\.(?:cjs|mjs|js|jsx|ts|tsx|vue|php|py|rb|sh|bash|zsh|pl|cgi)$/i
const THEME_CONFIG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/
const THEME_CONFIG_FIELD_TYPES = new Set([
  'text',
  'textarea',
  'markdown',
  'password',
  'email',
  'number',
  'select',
  'tags',
  'checkbox',
  'color',
  'file',
  'placeholder'
])
export const THEME_TEMPLATE_SLOTS = [
  'public.home.hero',
  'public.home.sections',
  'public.market.banner',
  'public.auth.aside',
  'user.shell.brand',
  'user.dashboard.banner',
  'user.dashboard.cards',
  'user.instance.detail.extra',
  'user.wallet.banner',
  'user.tickets.banner',
  'user.extensions.banner',
  'user.orders.banner',
  'user.profile.banner',
  'user.invites.banner',
  'user.hosts.banner',
  'user.host.create.banner',
  'admin.shell.brand',
  'admin.extensions.header',
  'admin.extensions.market.banner',
  'admin.extensions.theme.banner',
  'admin.dashboard.banner',
  'admin.dashboard.widgets',
  'admin.billing.banner',
  'admin.payment.providers.banner',
  'admin.oauth.banner',
  'shared.footer'
] as const

export type ThemeTemplateSlot = (typeof THEME_TEMPLATE_SLOTS)[number]

export interface PayIncusThemeTemplate {
  slot: ThemeTemplateSlot
  title: string
  entry: string
}

export interface PayIncusThemeConfigOption {
  label: string
  value: string
}

export interface PayIncusThemeConfigField {
  type: string
  label: string
  description?: string
  placeholder?: string
  group?: string
  order?: number
  required: boolean
  default?: unknown
  options?: PayIncusThemeConfigOption[]
  min?: number
  max?: number
  step?: number
}

export interface PayIncusThemeManifest {
  id: string
  name: string
  version: string
  payincus: string
  description?: string
  author?: string
  homepage?: string
  css: string
  previewImage?: string
  tokens: Record<string, unknown>
  layoutSlots: string[]
  templates: PayIncusThemeTemplate[]
  configSchema: Record<string, PayIncusThemeConfigField>
}

export interface ValidatedThemePackage {
  manifest: PayIncusThemeManifest
  sha256: string
  stagingDir: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
}

function assertSafeRelativePath(path: string, label: string): void {
  if (!SAFE_PATH_PATTERN.test(path) || path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    throw new Error(`${label} must be a safe relative path`)
  }
}

function normalizeStringArray(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return Array.from(new Set(
    value
      .map(item => sanitizeString(item, maxLength))
      .filter((item): item is string => !!item)
  )).slice(0, maxItems)
}

function normalizeThemeTemplates(value: unknown): PayIncusThemeTemplate[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('templates must be an array')
  const allowedSlots = new Set<string>(THEME_TEMPLATE_SLOTS)
  return value.slice(0, 30).map((item, index) => {
    if (!isRecord(item)) throw new Error(`templates[${index}] must be an object`)
    const slot = sanitizeString(item.slot, 80)
    const title = sanitizeString(item.title, 120) || slot || `template-${index}`
    const entry = sanitizeString(item.entry, 240)
    if (!slot || !allowedSlots.has(slot)) throw new Error(`templates[${index}].slot is not allowed`)
    if (!entry) throw new Error(`templates[${index}].entry is required`)
    assertSafeRelativePath(entry, `templates[${index}].entry`)
    if (!entry.endsWith('.html')) throw new Error(`templates[${index}].entry must point to an HTML fragment`)
    return { slot: slot as ThemeTemplateSlot, title, entry }
  })
}

function normalizeConfigOptions(value: unknown, label: string): PayIncusThemeConfigOption[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${label}.options must be an array`)
  const options = value.slice(0, 80).map((item, index) => {
    if (typeof item === 'string') {
      const optionValue = sanitizeString(item, 120)
      if (!optionValue) throw new Error(`${label}.options[${index}] must not be empty`)
      return { label: optionValue, value: optionValue }
    }
    if (!isRecord(item)) throw new Error(`${label}.options[${index}] must be a string or object`)
    const optionLabel = sanitizeString(item.label, 120)
    const optionValue = sanitizeString(item.value, 120)
    if (!optionLabel || !optionValue) throw new Error(`${label}.options[${index}] must include label and value`)
    return { label: optionLabel, value: optionValue }
  })
  return options
}

function normalizeThemeConfigSchema(value: unknown): Record<string, PayIncusThemeConfigField> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('configSchema must be an object')

  const schema: Record<string, PayIncusThemeConfigField> = {}
  for (const [key, rawField] of Object.entries(value).slice(0, 80)) {
    if (!THEME_CONFIG_KEY_PATTERN.test(key)) throw new Error(`Invalid theme config key: ${key}`)
    if (!isRecord(rawField)) throw new Error(`configSchema.${key} must be an object`)
    const type = sanitizeString(rawField.type, 40) || 'text'
    if (!THEME_CONFIG_FIELD_TYPES.has(type)) throw new Error(`Unsupported theme config field type: ${type}`)
    const min = typeof rawField.min === 'number' && Number.isFinite(rawField.min) ? rawField.min : undefined
    const max = typeof rawField.max === 'number' && Number.isFinite(rawField.max) ? rawField.max : undefined
    const step = typeof rawField.step === 'number' && Number.isFinite(rawField.step) ? rawField.step : undefined
    schema[key] = {
      type,
      label: sanitizeString(rawField.label, 120) || key,
      description: sanitizeString(rawField.description, 300) || undefined,
      placeholder: sanitizeString(rawField.placeholder, 160) || undefined,
      group: sanitizeString(rawField.group, 80) || undefined,
      order: typeof rawField.order === 'number' && Number.isFinite(rawField.order) ? rawField.order : undefined,
      required: rawField.required === true,
      default: rawField.default,
      options: normalizeConfigOptions(rawField.options, `configSchema.${key}`),
      min,
      max,
      step
    }
  }
  return schema
}

function normalizeThemeConfigValue(field: PayIncusThemeConfigField, rawValue: unknown, key: string): unknown {
  const value = rawValue === undefined ? field.default : rawValue
  if (field.type === 'placeholder') return undefined
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
        .map(item => sanitizeString(item, 80))
        .filter((item): item is string => !!item)
    )).slice(0, 60)
  }

  const stringValue = sanitizeString(value, field.type === 'textarea' || field.type === 'markdown' ? 4000 : 500)
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
  if (field.type === 'file' && !/^\/api\/themes\/[A-Za-z0-9.%_-]+\/config-files\/[A-Za-z0-9_.%-]+\/[0-9]+-[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(stringValue)) {
    throw new Error(`${key} must be an uploaded theme config file URL`)
  }
  return stringValue
}

export function normalizeThemeConfigValues(
  schema: Record<string, PayIncusThemeConfigField>,
  rawValues: unknown
): Record<string, unknown> {
  if (rawValues !== undefined && rawValues !== null && !isRecord(rawValues)) {
    throw new Error('Theme config values must be an object')
  }
  const values = isRecord(rawValues) ? rawValues : {}
  const normalized: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema)) {
    const value = normalizeThemeConfigValue(field, values[key], key)
    if (value !== undefined) normalized[key] = value
  }
  return normalized
}

export function parseThemeManifest(raw: unknown): PayIncusThemeManifest {
  if (!isRecord(raw)) throw new Error('Theme manifest must be an object')

  if (
    raw.scripts !== undefined ||
    raw.actions !== undefined ||
    raw.backend !== undefined ||
    raw.capabilities !== undefined ||
    raw.entrypoints !== undefined
  ) {
    throw new Error('Theme manifest cannot declare scripts, actions, backend code, capabilities, or plugin entrypoints')
  }

  const id = sanitizeString(raw.id, 120)
  const name = sanitizeString(raw.name, 120)
  const version = sanitizeString(raw.version, 64)
  const payincus = sanitizeString(raw.payincus, 80)
  const css = sanitizeString(raw.css, 240) || 'dist/theme.css'
  const previewImage = sanitizeString(raw.previewImage, 240) || undefined

  if (!id || !THEME_ID_PATTERN.test(id)) throw new Error('Theme id must use reverse-domain format')
  if (!name) throw new Error('Theme name is required')
  if (!version || !THEME_VERSION_PATTERN.test(version)) throw new Error('Theme version must be semver')
  if (!payincus) throw new Error('PayIncus compatibility range is required')
  assertSafeRelativePath(css, 'theme.css')
  if (!css.endsWith('.css')) throw new Error('theme.css must point to a CSS file')
  if (previewImage) assertSafeRelativePath(previewImage, 'theme.previewImage')

  return {
    id,
    name,
    version,
    payincus,
    description: sanitizeString(raw.description, 500) ?? undefined,
    author: sanitizeString(raw.author, 120) ?? undefined,
    homepage: sanitizeString(raw.homepage, 240) ?? undefined,
    css,
    previewImage,
    tokens: isRecord(raw.tokens) ? raw.tokens : {},
    layoutSlots: normalizeStringArray(raw.layoutSlots, 'layoutSlots', 40, 80),
    templates: normalizeThemeTemplates(raw.templates),
    configSchema: normalizeThemeConfigSchema(raw.configSchema)
  }
}

export function getThemeInstallDir(): string {
  return resolve(process.env.THEME_INSTALL_DIR || join(process.env.INCUDAL_APP_DIR || process.cwd(), 'themes'))
}

export function getThemeDataDir(): string {
  return resolve(process.env.THEME_DATA_DIR || join(process.env.INCUDAL_APP_DIR || process.cwd(), 'theme-data'))
}

export function getThemeStagingDir(): string {
  return resolve(process.env.THEME_STAGING_DIR || join(process.env.INCUDAL_APP_DIR || process.cwd(), 'theme-staging'))
}

export function getThemePackageMaxBytes(): number {
  const mb = Number(process.env.THEME_MAX_PACKAGE_SIZE_MB || '10')
  return (Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024
}

export function resolveThemeAsset(baseDir: string, relativePath: string): string {
  const resolvedBase = resolve(baseDir)
  const resolved = resolve(resolvedBase, relativePath)
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${sep}`)) {
    throw new Error('Resolved theme path escapes base directory')
  }
  return resolved
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolvePromise())
  })
  return hash.digest('hex')
}

function parseTarEntryName(line: string): string {
  return line.trim().split(/\s+/).slice(5).join(' ')
}

function validateTarEntryLine(line: string): void {
  const trimmed = line.trim()
  if (!trimmed) return
  const name = parseTarEntryName(trimmed)
  const type = trimmed[0]
  if (!name) throw new Error('Theme package contains an unreadable tar entry')
  if (type === 'l' || type === 'h') throw new Error('Theme package cannot contain links')
  if (name.startsWith('/') || name.includes('../') || name === '..' || name.includes('\\')) {
    throw new Error(`Theme package contains unsafe path: ${name}`)
  }
  if (BLOCKED_THEME_FILE_PATTERN.test(name)) {
    throw new Error(`Theme package cannot contain executable or script file: ${name}`)
  }
}

async function validateTarball(path: string): Promise<void> {
  const { stdout } = await execFileAsync('tar', ['-tvf', path], { timeout: 30000, maxBuffer: 1024 * 1024 * 4 })
  const lines = stdout.split(/\r?\n/).filter(Boolean)
  if (!lines.some(line => line.endsWith(' payincus.theme.json') || line.endsWith('/payincus.theme.json'))) {
    throw new Error('Theme package is missing payincus.theme.json')
  }
  for (const line of lines) validateTarEntryLine(line)
}

function assertSafeThemeCss(css: string): void {
  if (/<script[\s>]/i.test(css)) throw new Error('Theme CSS cannot contain script tags')
  if (/@import\s+(?:url\()?['"]?https?:\/\//i.test(css)) {
    throw new Error('Theme CSS cannot import remote stylesheets')
  }
  if (/javascript:/i.test(css)) throw new Error('Theme CSS cannot contain javascript URLs')
}

function assertSafeThemeTemplateHtml(html: string, label: string): void {
  if (Buffer.byteLength(html, 'utf8') > 64 * 1024) throw new Error(`${label} exceeds 64KB`)
  if (/<\s*(script|iframe|object|embed|form|input|button|textarea|select|link|meta|style)\b/i.test(html)) {
    throw new Error(`${label} contains a blocked element`)
  }
  if (/\son[a-z]+\s*=/i.test(html)) throw new Error(`${label} contains inline event handlers`)
  if (/javascript:/i.test(html)) throw new Error(`${label} contains javascript URLs`)
  if (/\b(src|href)\s*=\s*["']?https?:\/\//i.test(html)) throw new Error(`${label} contains remote URLs`)
}

export async function validateAndExtractThemePackage(packagePath: string, taskId: string | number): Promise<ValidatedThemePackage> {
  await validateTarball(packagePath)

  const sha256 = await sha256File(packagePath)
  const stagingRoot = getThemeStagingDir()
  await mkdir(stagingRoot, { recursive: true })
  const stagingDir = join(stagingRoot, `theme-task-${taskId}`)
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })
  await execFileAsync('tar', ['-xzf', packagePath, '-C', stagingDir], { timeout: 30000 })

  const manifestPath = resolveThemeAsset(stagingDir, 'payincus.theme.json')
  const manifest = parseThemeManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const css = await readFile(resolveThemeAsset(stagingDir, manifest.css), 'utf8')
  assertSafeThemeCss(css)
  if (manifest.previewImage) {
    await readFile(resolveThemeAsset(stagingDir, manifest.previewImage))
  }
  for (const template of manifest.templates) {
    const html = await readFile(resolveThemeAsset(stagingDir, template.entry), 'utf8')
    assertSafeThemeTemplateHtml(html, `templates.${template.slot}`)
  }

  return { manifest, sha256, stagingDir }
}
