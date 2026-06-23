export const ADMIN_PLUGIN_SLOTS = [
  'admin.plugins.settings',
  'admin.sidebar.extra',
  'admin.dashboard.widgets',
  'admin.instance.detail.panels',
  'admin.user.detail.panels',
  'admin.billing.extra',
  'admin.ticket.extra'
] as const

export const USER_PLUGIN_SLOTS = [
  'user.sidebar.extra',
  'user.dashboard.cards',
  'user.instance.detail.panels',
  'user.instance.renew.widgets',
  'user.wallet.extra',
  'user.ticket.extra',
  'public.market.cards'
] as const

export type AdminPluginSlot = (typeof ADMIN_PLUGIN_SLOTS)[number]
export type UserPluginSlot = (typeof USER_PLUGIN_SLOTS)[number]

export interface PluginPageManifest {
  slot: string
  title: string
  entry: string
  path?: string
  requiresAuth?: boolean
}

export interface PluginTemplateManifest {
  name: string
  path: string
}

export interface PayIncusPluginManifest {
  id: string
  name: string
  version: string
  payincus: string
  description?: string
  author?: string
  homepage?: string
  entrypoints: {
    adminPages?: PluginPageManifest[]
    userPages?: PluginPageManifest[]
  }
  permissions?: string[]
  configSchema?: Record<string, unknown>
  templates?: PluginTemplateManifest[]
}

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/
export const PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const ENTRY_PATH_PATTERN = /^[A-Za-z0-9._/@-]+$/
const USER_PLUGIN_PATH_PATTERN = /^\/plugins\/[a-z0-9][a-z0-9/_-]*$/

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
  if (!ENTRY_PATH_PATTERN.test(path) || path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    throw new Error(`${label} must be a safe relative path`)
  }
}

function normalizePage(value: unknown, allowedSlots: readonly string[], label: string): PluginPageManifest {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const slot = sanitizeString(value.slot, 80)
  const title = sanitizeString(value.title, 120)
  const entry = sanitizeString(value.entry, 240)
  if (!slot || !allowedSlots.includes(slot)) throw new Error(`${label}.slot is not allowed`)
  if (!title) throw new Error(`${label}.title is required`)
  if (!entry) throw new Error(`${label}.entry is required`)
  assertSafeRelativePath(entry, `${label}.entry`)
  const page: PluginPageManifest = {
    slot,
    title,
    entry,
    requiresAuth: value.requiresAuth === true
  }
  if (value.path !== undefined) {
    const path = sanitizeString(value.path, 120)
    if (!path || !USER_PLUGIN_PATH_PATTERN.test(path)) {
      throw new Error(`${label}.path must be under /plugins/`)
    }
    page.path = path
  }
  return page
}

function normalizeTemplates(value: unknown): PluginTemplateManifest[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('templates must be an array')
  return value.slice(0, 30).map((item, index) => {
    if (!isRecord(item)) throw new Error(`templates[${index}] must be an object`)
    const name = sanitizeString(item.name, 120)
    const path = sanitizeString(item.path, 240)
    if (!name || !path) throw new Error(`templates[${index}] requires name and path`)
    assertSafeRelativePath(path, `templates[${index}].path`)
    return { name, path }
  })
}

function normalizePermissions(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('permissions must be an array')
  return Array.from(new Set(value.map(item => sanitizeString(item, 80)).filter((item): item is string => !!item))).slice(0, 80)
}

export function parsePluginManifest(raw: unknown): PayIncusPluginManifest {
  if (!isRecord(raw)) throw new Error('Plugin manifest must be an object')

  const id = sanitizeString(raw.id, 120)
  const name = sanitizeString(raw.name, 120)
  const version = sanitizeString(raw.version, 64)
  const payincus = sanitizeString(raw.payincus, 80)
  if (!id || !PLUGIN_ID_PATTERN.test(id)) throw new Error('Plugin id must use reverse-domain format')
  if (!name) throw new Error('Plugin name is required')
  if (!version || !PLUGIN_VERSION_PATTERN.test(version)) throw new Error('Plugin version must be semver')
  if (!payincus) throw new Error('PayIncus compatibility range is required')

  if (!isRecord(raw.entrypoints)) throw new Error('entrypoints is required')
  const adminPages = Array.isArray(raw.entrypoints.adminPages)
    ? raw.entrypoints.adminPages.slice(0, 30).map((page, index) => normalizePage(page, ADMIN_PLUGIN_SLOTS, `entrypoints.adminPages[${index}]`))
    : []
  const userPages = Array.isArray(raw.entrypoints.userPages)
    ? raw.entrypoints.userPages.slice(0, 30).map((page, index) => normalizePage(page, USER_PLUGIN_SLOTS, `entrypoints.userPages[${index}]`))
    : []

  for (const page of userPages) {
    if (page.entry.startsWith('dist/admin/')) {
      throw new Error('User entrypoints cannot point to admin assets')
    }
  }
  for (const page of [...adminPages, ...userPages]) {
    if (page.entry.includes('/api/admin') || page.entry.startsWith('http:') || page.entry.startsWith('https:')) {
      throw new Error('Plugin entrypoints must be local package assets')
    }
  }

  return {
    id,
    name,
    version,
    payincus,
    description: sanitizeString(raw.description, 500) ?? undefined,
    author: sanitizeString(raw.author, 120) ?? undefined,
    homepage: sanitizeString(raw.homepage, 240) ?? undefined,
    entrypoints: { adminPages, userPages },
    permissions: normalizePermissions(raw.permissions),
    configSchema: isRecord(raw.configSchema) ? raw.configSchema : {},
    templates: normalizeTemplates(raw.templates)
  }
}

export function hasClientExtension(manifest: PayIncusPluginManifest): boolean {
  return (manifest.entrypoints.userPages?.length || 0) > 0
}
