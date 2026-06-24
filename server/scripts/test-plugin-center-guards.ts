import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const app = read('server/src/app.ts')
const adminRoute = read('server/src/routes/admin-plugins.ts')
const userRoute = read('server/src/routes/plugins.ts')
const db = read('server/src/db/plugins.ts')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260623143000_add_plugin_center/migration.sql')
const adminRouter = read('client/src/router/admin.ts')
const adminNav = read('client/src/config/side-nav-items-admin.ts')
const adminApi = read('client/src/api/admin.ts')
const userApi = read('client/src/api/index.ts')
const pluginCenterView = read('client/src/views/admin/PluginCenterView.vue')
const aiTicketManifest = read('plugin-templates/ai-ticket-agent-plugin/payincus.plugin.json')

assert.ok(
  app.includes("import adminPluginRoutes from './routes/admin-plugins.js'") &&
    app.includes("fastify.register(adminPluginRoutes, { prefix: '/api/admin/plugins' })") &&
    app.includes("fastify.register(pluginRoutes, { prefix: '/api/plugins' })"),
  'plugin routes must be mounted under admin and user plugin namespaces'
)

assert.ok(
  adminRoute.includes('onRequest: [fastify.authenticateAdmin]') &&
    adminRoute.includes('SUPER_ADMIN_REQUIRED') &&
    adminRoute.includes('PLUGIN_MANAGER_ALLOWED_ADMIN_IDS') &&
    adminRoute.includes("return user.username === 'admin'") &&
    adminRoute.includes("additionalProperties: false"),
  'plugin management routes must require admin auth plus super-admin gating for mutations'
)

assert.ok(
  userRoute.includes('onRequest: [fastify.authenticateUser]') &&
    userRoute.includes('/enabled-client-extensions') &&
    userRoute.includes("status: 'enabled'") &&
    userRoute.includes('PLUGIN_ACTION_NOT_IMPLEMENTED'),
  'user plugin routes must require ordinary-user auth and only expose enabled client extensions'
)

assert.ok(
  schema.includes('model Plugin') &&
    schema.includes('model PluginVersion') &&
    schema.includes('model PluginInstallTask') &&
    schema.includes('model PluginConfig') &&
    schema.includes('model PluginMarketSource') &&
    schema.includes('model PluginEventLog') &&
    schema.includes('model PluginUserData') &&
    migration.includes('CREATE TABLE "plugins"') &&
    migration.includes('CREATE TABLE "plugin_install_tasks"'),
  'plugin center must have persisted models and migration'
)

assert.ok(
  db.includes('serializePluginConfig') &&
    db.includes('config.isSecret ? null') &&
    db.includes('encryptSensitiveData') &&
    db.includes('Prisma.JsonNull') &&
    db.includes('installValidatedPlugin') &&
    db.includes('enablePlugin') &&
    db.includes('disablePlugin') &&
    db.includes('uninstallPlugin'),
  'plugin db layer must redact secret config and cover install/enable/disable/uninstall'
)

assert.ok(
  adminRouter.includes("path: '/admin/plugins'") &&
    adminNav.includes("path: '/admin/plugins'") &&
    adminApi.includes('/admin/plugins/upload') &&
    adminApi.includes('/admin/plugins/market/install') &&
    !userApi.includes('/admin/plugins'),
  'admin frontend must expose plugin center while user API must not expose admin plugin management'
)

assert.ok(
  pluginCenterView.indexOf('插件设置页面') > 0 &&
    pluginCenterView.indexOf('插件设置页面') < pluginCenterView.indexOf('配置 JSON') &&
    pluginCenterView.includes('selectedAdminSettingsPages') &&
    pluginCenterView.includes('套用默认模板') &&
    pluginCenterView.includes('AI 工单助手') &&
    pluginCenterView.includes('读取脱敏工单上下文') &&
    !pluginCenterView.includes('{{ permission }})'),
  'plugin detail must show settings pages before raw JSON config, expose a default-template shortcut, and localize known plugin metadata'
)

assert.ok(
  aiTicketManifest.includes('"name": "AI 工单助手"') &&
    aiTicketManifest.includes('默认 AI 工单助手配置') &&
    aiTicketManifest.includes('启用 AI 工单助手') &&
    aiTicketManifest.includes('OpenAI 兼容接口地址') &&
    !aiTicketManifest.includes('AI Ticket Agent') &&
    !aiTicketManifest.includes('Enable AI ticket agent'),
  'official AI ticket plugin manifest must present Chinese metadata and config labels'
)

console.log('plugin center guard tests passed')
