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

export interface PluginConfigOptionManifest {
  label: string
  value: string
}

export interface PluginConfigFieldManifest {
  type: 'text' | 'textarea' | 'markdown' | 'password' | 'email' | 'number' | 'select' | 'tags' | 'checkbox' | 'color' | 'file' | 'placeholder'
  label: string
  description?: string
  placeholder?: string
  group?: string
  order?: number
  required: boolean
  default?: unknown
  options?: PluginConfigOptionManifest[]
  min?: number
  max?: number
  step?: number
  secret?: boolean
}

export interface PluginActionManifest {
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  runtime?: 'webhook'
  url?: string
  scopes: string[]
  requestSchema?: Record<string, unknown>
  responseSchema?: Record<string, unknown>
  idempotency?: 'none' | 'optional' | 'required'
  rateLimit?: 'normal' | 'strict'
}

export interface PluginEventSubscriptionManifest {
  event: string
  handler: string
}

export interface PluginNotificationTemplateManifest {
  id: string
  title: string
  message: string
  variables?: string[]
}

export const PLUGIN_SERVICE_EXTENSION_HOOKS = [
  'checkoutConfig',
  'provision',
  'suspend',
  'unsuspend',
  'terminate',
  'upgrade',
  'servicePanel'
] as const

export const PLUGIN_SERVICE_EXTENSION_HOOK_SCOPES: Record<(typeof PLUGIN_SERVICE_EXTENSION_HOOKS)[number], string> = {
  checkoutConfig: 'service-extension:checkout-config',
  provision: 'service-extension:provision',
  suspend: 'service-extension:suspend',
  unsuspend: 'service-extension:unsuspend',
  terminate: 'service-extension:terminate',
  upgrade: 'service-extension:upgrade',
  servicePanel: 'service-extension:service-panel'
}

export type PluginServiceExtensionHook = (typeof PLUGIN_SERVICE_EXTENSION_HOOKS)[number]

export interface PluginServiceExtensionManifest {
  key: string
  name: string
  productId?: string
  hooks: Partial<Record<PluginServiceExtensionHook, string>>
}

export const PLUGIN_GATEWAY_EXTENSION_HOOKS = [
  'availability',
  'createPayment',
  'verifyPayment',
  'refund',
  'webhook'
] as const

export const PLUGIN_GATEWAY_EXTENSION_HOOK_SCOPES: Record<(typeof PLUGIN_GATEWAY_EXTENSION_HOOKS)[number], string> = {
  availability: 'gateway-extension:availability',
  createPayment: 'gateway-extension:create-payment',
  verifyPayment: 'gateway-extension:verify-payment',
  refund: 'gateway-extension:refund',
  webhook: 'gateway-extension:webhook'
}

export type PluginGatewayExtensionHook = (typeof PLUGIN_GATEWAY_EXTENSION_HOOKS)[number]

export interface PluginGatewayExtensionManifest {
  key: string
  name: string
  providerCode?: string
  hooks: Partial<Record<PluginGatewayExtensionHook, string>>
}

export interface PluginStorageManifest {
  kind: 'kv'
  maxKeys?: number
  scopes?: Array<'user' | 'global' | 'service'>
  retention?: 'keep' | 'delete_on_uninstall'
  tables?: PluginTableManifest[]
}

export interface PluginTableMigrationManifest {
  version: string
  name: string
}

export interface PluginTableManifest {
  name: string
  description?: string
  scopes?: Array<'user' | 'global' | 'service'>
  maxRows?: number
  migrations?: PluginTableMigrationManifest[]
}

export interface PluginCapabilitiesManifest {
  actions?: PluginActionManifest[]
  events?: PluginEventSubscriptionManifest[]
  notificationTemplates?: PluginNotificationTemplateManifest[]
  serviceExtensions?: PluginServiceExtensionManifest[]
  gatewayExtensions?: PluginGatewayExtensionManifest[]
  storage?: PluginStorageManifest
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
  configSchema?: Record<string, PluginConfigFieldManifest>
  templates?: PluginTemplateManifest[]
  capabilities?: PluginCapabilitiesManifest
}

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/
export const PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const ENTRY_PATH_PATTERN = /^[A-Za-z0-9._/@-]+$/
const USER_PLUGIN_PATH_PATTERN = /^\/plugins\/[a-z0-9][a-z0-9/_-]*$/
const ACTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/
const NOTIFICATION_TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9_.:-]{0,79}$/
const NOTIFICATION_TEMPLATE_VARIABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const ACTION_PATH_PATTERN = /^\/[a-z0-9][a-z0-9/_:-]*$/
const SCOPE_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*){1,3}$/
const WEBHOOK_URL_PATTERN = /^https:\/\/[^\s]+$/i
const ACTION_SCHEMA_MAX_BYTES = 16 * 1024
const CONFIG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/
const SERVICE_EXTENSION_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,79}$/
const SERVICE_EXTENSION_PRODUCT_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/
const GATEWAY_EXTENSION_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,79}$/
const GATEWAY_EXTENSION_PROVIDER_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/
const PLUGIN_TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]{1,62}$/
const PLUGIN_TABLE_MIGRATION_VERSION_PATTERN = /^\d{1,8}(?:\.\d{1,8}){0,2}$/
const PLUGIN_CONFIG_FIELD_TYPES = new Set([
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

export const PLUGIN_EVENT_NAMES = [
  'plugin.installed',
  'plugin.enabled',
  'plugin.disabled',
  'plugin.uninstalled',
  'order.created',
  'order.paid',
  'payment.failed',
  'service.provisioned',
  'service.suspended',
  'service.unsuspended',
  'service.deleted',
  'service.task.queued',
  'service.task.cancelled',
  'service.task.completed',
  'service.task.failed',
  'service.resource.rollback.completed',
  'service.resource.rollback.failed',
  'ticket.created',
  'ticket.replied',
  'ticket.status.changed',
  'user.registered',
  'user.login',
  'user.profile.updated',
  'user.status.changed',
  'notification.sent'
] as const

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

function normalizeConfigOptions(value: unknown, label: string): PluginConfigOptionManifest[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${label}.options must be an array`)
  return value.slice(0, 80).map((item, index) => {
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
}

function normalizeConfigSchema(value: unknown): Record<string, PluginConfigFieldManifest> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('configSchema must be an object')

  const schema: Record<string, PluginConfigFieldManifest> = {}
  for (const [key, rawField] of Object.entries(value).slice(0, 80)) {
    if (!CONFIG_KEY_PATTERN.test(key)) throw new Error(`Invalid plugin config key: ${key}`)
    if (!isRecord(rawField)) throw new Error(`configSchema.${key} must be an object`)
    const type = sanitizeString(rawField.type, 40) || 'text'
    if (!PLUGIN_CONFIG_FIELD_TYPES.has(type)) throw new Error(`Unsupported plugin config field type: ${type}`)
    const min = typeof rawField.min === 'number' && Number.isFinite(rawField.min) ? rawField.min : undefined
    const max = typeof rawField.max === 'number' && Number.isFinite(rawField.max) ? rawField.max : undefined
    const step = typeof rawField.step === 'number' && Number.isFinite(rawField.step) ? rawField.step : undefined
    schema[key] = {
      type: type as PluginConfigFieldManifest['type'],
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
      step,
      secret: rawField.secret === true || type === 'password'
    }
  }
  return schema
}

function normalizeScopes(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return Array.from(new Set(value.map(item => sanitizeString(item, 80)).filter((item): item is string => !!item))).slice(0, 40).map(scope => {
    if (!SCOPE_PATTERN.test(scope)) throw new Error(`${label} contains an invalid scope`)
    return scope
  })
}

function assertSafeActionSchemaObject(value: unknown, label: string, depth = 0): void {
  if (depth > 12) throw new Error(`${label} is too deeply nested`)
  if (Array.isArray(value)) {
    for (const item of value) assertSafeActionSchemaObject(item, label, depth + 1)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$ref' || key === '$id' || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`${label} contains an unsupported key`)
    }
    assertSafeActionSchemaObject(nestedValue, label, depth + 1)
  }
}

function normalizeActionSchema(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  assertSafeActionSchemaObject(value, label)
  const serialized = JSON.stringify(value)
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > ACTION_SCHEMA_MAX_BYTES) {
    throw new Error(`${label} exceeds 16KB`)
  }
  return value
}

function normalizeAction(value: unknown, index: number): PluginActionManifest {
  if (!isRecord(value)) throw new Error(`capabilities.actions[${index}] must be an object`)
  const name = sanitizeString(value.name, 80)
  const method = sanitizeString(value.method, 12)?.toUpperCase()
  const path = sanitizeString(value.path, 160)
  const runtime = sanitizeString(value.runtime, 20)
  const url = sanitizeString(value.url, 500) ?? undefined
  if (!name || !ACTION_NAME_PATTERN.test(name)) throw new Error(`capabilities.actions[${index}].name is invalid`)
  if (!method || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error(`capabilities.actions[${index}].method is invalid`)
  if (!path || !ACTION_PATH_PATTERN.test(path) || path.includes('..') || path.includes('//')) throw new Error(`capabilities.actions[${index}].path is invalid`)
  if (runtime !== undefined && runtime !== 'webhook') throw new Error(`capabilities.actions[${index}].runtime is invalid`)
  if (url !== undefined && !WEBHOOK_URL_PATTERN.test(url)) throw new Error(`capabilities.actions[${index}].url must be an HTTPS webhook URL`)
  const idempotency = sanitizeString(value.idempotency, 20)
  const rateLimit = sanitizeString(value.rateLimit, 20)
  const requestSchema = normalizeActionSchema(value.requestSchema, `capabilities.actions[${index}].requestSchema`)
  const responseSchema = normalizeActionSchema(value.responseSchema, `capabilities.actions[${index}].responseSchema`)
  return {
    name,
    method: method as PluginActionManifest['method'],
    path,
    runtime: runtime === 'webhook' ? 'webhook' : undefined,
    url,
    scopes: normalizeScopes(value.scopes, `capabilities.actions[${index}].scopes`),
    ...(requestSchema ? { requestSchema } : {}),
    ...(responseSchema ? { responseSchema } : {}),
    idempotency: idempotency === 'optional' || idempotency === 'required' ? idempotency : idempotency === 'none' ? 'none' : undefined,
    rateLimit: rateLimit === 'strict' ? 'strict' : rateLimit === 'normal' ? 'normal' : undefined
  }
}

function normalizeEvent(value: unknown, index: number): PluginEventSubscriptionManifest {
  if (!isRecord(value)) throw new Error(`capabilities.events[${index}] must be an object`)
  const event = sanitizeString(value.event, 120)
  const handler = sanitizeString(value.handler, 120)
  if (!event || !PLUGIN_EVENT_NAMES.includes(event as (typeof PLUGIN_EVENT_NAMES)[number])) {
    throw new Error(`capabilities.events[${index}].event is not allowed`)
  }
  if (!handler || !ACTION_NAME_PATTERN.test(handler)) throw new Error(`capabilities.events[${index}].handler is invalid`)
  return { event, handler }
}

function normalizeNotificationTemplate(value: unknown, index: number): PluginNotificationTemplateManifest {
  if (!isRecord(value)) throw new Error(`capabilities.notificationTemplates[${index}] must be an object`)
  const id = sanitizeString(value.id, 80)
  const title = sanitizeString(value.title, 120)
  const message = sanitizeString(value.message, 2000)
  if (!id || !NOTIFICATION_TEMPLATE_ID_PATTERN.test(id)) {
    throw new Error(`capabilities.notificationTemplates[${index}].id is invalid`)
  }
  if (!title || title.includes('<') || title.includes('>')) {
    throw new Error(`capabilities.notificationTemplates[${index}].title must be plain text`)
  }
  if (!message || message.includes('<') || message.includes('>')) {
    throw new Error(`capabilities.notificationTemplates[${index}].message must be plain text`)
  }
  let variables: string[] = []
  if (value.variables !== undefined) {
    if (!Array.isArray(value.variables)) throw new Error(`capabilities.notificationTemplates[${index}].variables must be an array`)
    variables = Array.from(new Set(value.variables.slice(0, 10).map(item => sanitizeString(item, 40) || '')))
      .filter(Boolean)
    if (variables.length !== value.variables.length || variables.some(variable => !NOTIFICATION_TEMPLATE_VARIABLE_PATTERN.test(variable))) {
      throw new Error(`capabilities.notificationTemplates[${index}].variables contains invalid names`)
    }
  }
  return {
    id,
    title,
    message,
    ...(variables.length > 0 ? { variables } : {})
  }
}

function normalizeStorageScopes(value: unknown, label: string): Array<'user' | 'global' | 'service'> {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const scopes = Array.from(
    new Set(
      value
        .map(item => sanitizeString(item, 20))
        .filter((item): item is 'user' | 'global' | 'service' => item === 'user' || item === 'global' || item === 'service')
    )
  ).slice(0, 3)
  if (scopes.length !== value.length) throw new Error(`${label} contains an invalid scope`)
  return scopes
}

function normalizeStorageMigration(value: unknown, label: string): PluginTableMigrationManifest {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const version = sanitizeString(value.version, 32)
  const name = sanitizeString(value.name, 120)
  if (!version || !PLUGIN_TABLE_MIGRATION_VERSION_PATTERN.test(version)) {
    throw new Error(`${label}.version must be a numeric migration version`)
  }
  if (!name) throw new Error(`${label}.name is required`)
  return { version, name }
}

function normalizeStorageTable(value: unknown, index: number): PluginTableManifest {
  if (!isRecord(value)) throw new Error(`capabilities.storage.tables[${index}] must be an object`)
  const name = sanitizeString(value.name, 64)
  if (!name || !PLUGIN_TABLE_NAME_PATTERN.test(name)) {
    throw new Error(`capabilities.storage.tables[${index}].name must use lower-case letters, digits, and underscores`)
  }
  const description = sanitizeString(value.description, 240) ?? undefined
  const scopes = normalizeStorageScopes(value.scopes, `capabilities.storage.tables[${index}].scopes`)
  const maxRows = Number(value.maxRows)
  const migrations = Array.isArray(value.migrations)
    ? value.migrations.slice(0, 50).map((item, migrationIndex) =>
        normalizeStorageMigration(item, `capabilities.storage.tables[${index}].migrations[${migrationIndex}]`)
      )
    : []
  if (value.migrations !== undefined && !Array.isArray(value.migrations)) {
    throw new Error(`capabilities.storage.tables[${index}].migrations must be an array`)
  }
  if (new Set(migrations.map(item => item.version)).size !== migrations.length) {
    throw new Error(`capabilities.storage.tables[${index}].migrations contains duplicate versions`)
  }
  return {
    name,
    ...(description ? { description } : {}),
    ...(scopes.length > 0 ? { scopes } : {}),
    ...(Number.isSafeInteger(maxRows) && maxRows > 0 && maxRows <= 100000 ? { maxRows } : {}),
    ...(migrations.length > 0 ? { migrations } : {})
  }
}

function normalizeServiceExtension(value: unknown, index: number, actions: PluginActionManifest[]): PluginServiceExtensionManifest {
  if (!isRecord(value)) throw new Error(`capabilities.serviceExtensions[${index}] must be an object`)
  const key = sanitizeString(value.key, 80)
  const name = sanitizeString(value.name, 120)
  const productId = sanitizeString(value.productId, 120) ?? undefined
  if (!key || !SERVICE_EXTENSION_KEY_PATTERN.test(key)) throw new Error(`capabilities.serviceExtensions[${index}].key is invalid`)
  if (!name) throw new Error(`capabilities.serviceExtensions[${index}].name is required`)
  if (productId !== undefined && !SERVICE_EXTENSION_PRODUCT_PATTERN.test(productId)) {
    throw new Error(`capabilities.serviceExtensions[${index}].productId is invalid`)
  }
  if (!isRecord(value.hooks)) throw new Error(`capabilities.serviceExtensions[${index}].hooks must be an object`)

  const allowedHooks = new Set<string>(PLUGIN_SERVICE_EXTENSION_HOOKS)
  for (const hookName of Object.keys(value.hooks)) {
    if (!allowedHooks.has(hookName)) {
      throw new Error(`capabilities.serviceExtensions[${index}].hooks contains an invalid hook`)
    }
  }

  const declaredActions = new Map(actions.map(action => [action.name, action]))
  const hooks: Partial<Record<PluginServiceExtensionHook, string>> = {}
  for (const hook of PLUGIN_SERVICE_EXTENSION_HOOKS) {
    const actionName = sanitizeString(value.hooks[hook], 80)
    if (actionName === null) continue
    if (!ACTION_NAME_PATTERN.test(actionName)) {
      throw new Error(`capabilities.serviceExtensions[${index}].hooks.${hook} is invalid`)
    }
    const action = declaredActions.get(actionName)
    if (!action) {
      throw new Error(`capabilities.serviceExtensions[${index}].hooks.${hook} must reference a declared action`)
    }
    const requiredScope = PLUGIN_SERVICE_EXTENSION_HOOK_SCOPES[hook]
    if (!action.scopes.includes(requiredScope)) {
      throw new Error(`capabilities.serviceExtensions[${index}].hooks.${hook} action must declare ${requiredScope}`)
    }
    hooks[hook] = actionName
  }

  if (Object.keys(hooks).length === 0) {
    throw new Error(`capabilities.serviceExtensions[${index}].hooks must declare at least one hook`)
  }

  return {
    key,
    name,
    ...(productId ? { productId } : {}),
    hooks
  }
}

function normalizeGatewayExtension(value: unknown, index: number, actions: PluginActionManifest[]): PluginGatewayExtensionManifest {
  if (!isRecord(value)) throw new Error(`capabilities.gatewayExtensions[${index}] must be an object`)
  const key = sanitizeString(value.key, 80)
  const name = sanitizeString(value.name, 120)
  const providerCode = sanitizeString(value.providerCode, 120) ?? undefined
  if (!key || !GATEWAY_EXTENSION_KEY_PATTERN.test(key)) throw new Error(`capabilities.gatewayExtensions[${index}].key is invalid`)
  if (!name) throw new Error(`capabilities.gatewayExtensions[${index}].name is required`)
  if (providerCode !== undefined && !GATEWAY_EXTENSION_PROVIDER_PATTERN.test(providerCode)) {
    throw new Error(`capabilities.gatewayExtensions[${index}].providerCode is invalid`)
  }
  if (!isRecord(value.hooks)) throw new Error(`capabilities.gatewayExtensions[${index}].hooks must be an object`)

  const allowedHooks = new Set<string>(PLUGIN_GATEWAY_EXTENSION_HOOKS)
  for (const hookName of Object.keys(value.hooks)) {
    if (!allowedHooks.has(hookName)) {
      throw new Error(`capabilities.gatewayExtensions[${index}].hooks contains an invalid hook`)
    }
  }

  const declaredActions = new Map(actions.map(action => [action.name, action]))
  const hooks: Partial<Record<PluginGatewayExtensionHook, string>> = {}
  for (const hook of PLUGIN_GATEWAY_EXTENSION_HOOKS) {
    const actionName = sanitizeString(value.hooks[hook], 80)
    if (actionName === null) continue
    if (!ACTION_NAME_PATTERN.test(actionName)) {
      throw new Error(`capabilities.gatewayExtensions[${index}].hooks.${hook} is invalid`)
    }
    const action = declaredActions.get(actionName)
    if (!action) {
      throw new Error(`capabilities.gatewayExtensions[${index}].hooks.${hook} must reference a declared action`)
    }
    const requiredScope = PLUGIN_GATEWAY_EXTENSION_HOOK_SCOPES[hook]
    if (!action.scopes.includes(requiredScope)) {
      throw new Error(`capabilities.gatewayExtensions[${index}].hooks.${hook} action must declare ${requiredScope}`)
    }
    hooks[hook] = actionName
  }

  if (Object.keys(hooks).length === 0) {
    throw new Error(`capabilities.gatewayExtensions[${index}].hooks must declare at least one hook`)
  }

  return {
    key,
    name,
    ...(providerCode ? { providerCode } : {}),
    hooks
  }
}

function normalizeCapabilities(value: unknown): PluginCapabilitiesManifest | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('capabilities must be an object')
  const actions = Array.isArray(value.actions)
    ? value.actions.slice(0, 50).map((item, index) => normalizeAction(item, index))
    : []
  const events = Array.isArray(value.events)
    ? value.events.slice(0, 50).map((item, index) => normalizeEvent(item, index))
    : []
  const notificationTemplates = Array.isArray(value.notificationTemplates)
    ? value.notificationTemplates.slice(0, 20).map((item, index) => normalizeNotificationTemplate(item, index))
    : []
  if (new Set(notificationTemplates.map(item => item.id)).size !== notificationTemplates.length) {
    throw new Error('capabilities.notificationTemplates contains duplicate ids')
  }
  const serviceExtensions = Array.isArray(value.serviceExtensions)
    ? value.serviceExtensions.slice(0, 20).map((item, index) => normalizeServiceExtension(item, index, actions))
    : []
  const gatewayExtensions = Array.isArray(value.gatewayExtensions)
    ? value.gatewayExtensions.slice(0, 20).map((item, index) => normalizeGatewayExtension(item, index, actions))
    : []
  let storage: PluginStorageManifest | undefined
  if (value.storage !== undefined) {
    if (!isRecord(value.storage)) throw new Error('capabilities.storage must be an object')
    const kind = sanitizeString(value.storage.kind, 20)
    if (kind !== 'kv') throw new Error('capabilities.storage.kind must be kv')
    const maxKeys = Number(value.storage.maxKeys)
    const scopes = normalizeStorageScopes(value.storage.scopes, 'capabilities.storage.scopes')
    const retention = sanitizeString(value.storage.retention, 40)
    if (retention !== undefined && retention !== 'keep' && retention !== 'delete_on_uninstall') {
      throw new Error('capabilities.storage.retention is invalid')
    }
    const tables = Array.isArray(value.storage.tables)
      ? value.storage.tables.slice(0, 30).map((item, index) => normalizeStorageTable(item, index))
      : []
    if (value.storage.tables !== undefined && !Array.isArray(value.storage.tables)) {
      throw new Error('capabilities.storage.tables must be an array')
    }
    if (new Set(tables.map(item => item.name)).size !== tables.length) {
      throw new Error('capabilities.storage.tables contains duplicate names')
    }
    storage = {
      kind,
      ...(Number.isSafeInteger(maxKeys) && maxKeys > 0 && maxKeys <= 1000 ? { maxKeys } : {}),
      ...(scopes.length > 0 ? { scopes } : {}),
      ...(retention === 'keep' || retention === 'delete_on_uninstall' ? { retention } : {}),
      ...(tables.length > 0 ? { tables } : {})
    }
  }
  return {
    ...(actions.length > 0 ? { actions } : {}),
    ...(events.length > 0 ? { events } : {}),
    ...(notificationTemplates.length > 0 ? { notificationTemplates } : {}),
    ...(serviceExtensions.length > 0 ? { serviceExtensions } : {}),
    ...(gatewayExtensions.length > 0 ? { gatewayExtensions } : {}),
    ...(storage ? { storage } : {})
  }
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
    configSchema: normalizeConfigSchema(raw.configSchema),
    templates: normalizeTemplates(raw.templates),
    capabilities: normalizeCapabilities(raw.capabilities)
  }
}

export function hasClientExtension(manifest: PayIncusPluginManifest): boolean {
  return (manifest.entrypoints.userPages?.length || 0) > 0
}
