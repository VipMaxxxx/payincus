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
const pluginSettingsView = read('client/src/views/admin/PluginSettingsView.vue')
const sideNav = read('client/src/components/layout/SideNav.vue')
const aiTicketManifest = read('plugin-templates/ai-ticket-agent-plugin/payincus.plugin.json')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const zhLocale = read('client/src/locales/zh-CN.ts')
const enLocale = read('client/src/locales/en.ts')
const docsIndex = read('docs-site/docs/index.md')
const enDocsIndex = read('docs-site/docs/en/index.md')
const adminOverviewDocs = read('docs-site/docs/admin/overview.md')
const enAdminOverviewDocs = read('docs-site/docs/en/admin/overview.md')
const enPluginOverviewDocs = read('docs-site/docs/en/plugins/overview.md')
const enPluginDevelopmentDocs = read('docs-site/docs/en/plugins/development.md')
const enPluginTemplatesDocs = read('docs-site/docs/en/plugins/templates.md')
const readme = read('README.md')

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
    userRoute.includes('executePluginAction') &&
    userRoute.includes('PLUGIN_ACTION_FAILED'),
  'user plugin routes must require ordinary-user auth, expose enabled client extensions, and execute guarded plugin actions'
)

assert.ok(
  schema.includes('model Plugin') &&
    schema.includes('model PluginVersion') &&
    schema.includes('model PluginInstallTask') &&
    schema.includes('model PluginConfig') &&
    schema.includes('model PluginMarketSource') &&
    schema.includes('model PluginEventLog') &&
    schema.includes('model PluginUserData') &&
    schema.includes('model PublicPluginActionRateLimitPolicy') &&
    schema.includes('@@map("public_plugin_action_rate_limit_policies")') &&
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
  adminRoute.includes('pluginConfigAuditSummary') &&
    adminRoute.includes('previousKeys: new Set(previousConfigs.map(config => config.key))') &&
    adminRoute.includes("'plugin.config_update'") &&
    adminRoute.includes('secret=[${summarizeConfigKeys(secretKeys)}]') &&
    adminRoute.includes('file=[${summarizeConfigKeys(fileKeys)}]') &&
    adminRoute.includes('values=redacted') &&
    !adminRoute.includes('JSON.stringify(normalizedConfigs)') &&
    developmentDocs.includes('`plugin.config_update` 审计日志') &&
    developmentDocs.includes('配置值固定脱敏为 `values=redacted`') &&
    developmentDocs.includes('不会把 token、password、secret、图片 URL 或其他字段值写入日志'),
  'plugin config updates must emit value-redacted audit logs with changed/secret/file key summaries'
)

assert.ok(
  adminRouter.includes("path: '/admin/plugins'") &&
    adminRouter.includes("path: '/admin/plugins/:pluginId/settings'") &&
    adminRouter.includes("path: '/admin/plugins/:pluginId/pages/:pathMatch(.*)*'") &&
    adminRouter.includes('AdminPluginPageView.vue') &&
    adminNav.includes("path: '/admin/plugins'") &&
    adminApi.includes('/admin/plugins/upload') &&
    adminApi.includes('/admin/plugins/market/install') &&
    adminApi.includes('/admin/plugins/action-rate-limits') &&
    !userApi.includes('/admin/plugins'),
  'admin frontend must expose plugin center while user API must not expose admin plugin management'
)

assert.ok(
  pluginCenterView.includes('openPluginSettings') &&
    pluginCenterView.includes("'limits'") &&
    pluginCenterView.includes('公开 action 限流策略') &&
    pluginCenterView.includes('saveActionRateLimits') &&
    pluginCenterView.includes('api.plugins.updateActionRateLimits') &&
    pluginCenterView.includes('指定扩展 + 指定 action') &&
    pluginCenterView.includes('打开设置') &&
    pluginCenterView.includes('扩展设置会作为独立页面显示在左侧菜单') &&
    !pluginCenterView.includes('配置 JSON') &&
    !pluginCenterView.includes('套用默认模板') &&
    !pluginCenterView.includes('<PluginFrame') &&
    pluginCenterView.includes('AI 工单助手') &&
    pluginCenterView.includes('读取脱敏工单上下文') &&
    !pluginCenterView.includes('{{ permission }})'),
  'plugin center must link to standalone settings pages, avoid embedded frames/raw JSON config, and localize known plugin metadata'
)

assert.ok(
  zhLocale.includes("plugins: '扩展中心'") &&
    enLocale.includes("plugins: 'Extension Center'") &&
    enLocale.includes('Set the endpoint and key in Extension Center first') &&
    adminRouter.includes("title: '扩展设置'") &&
    pluginSettingsView.includes('← 返回扩展中心') &&
    pluginSettingsView.includes("if (!value) return '扩展设置'") &&
    pluginSettingsView.includes('加载扩展设置失败') &&
    pluginSettingsView.includes('独立扩展设置页') &&
    pluginSettingsView.includes('扩展中心维护') &&
    pluginSettingsView.includes('扩展设置页面') &&
    pluginSettingsView.includes("'扩展市场' : '上传安装'") &&
    pluginSettingsView.includes('请先在扩展中心启用扩展') &&
    pluginSettingsView.includes('返回扩展中心确认扩展是否已安装') &&
    readme.includes('plugin-templates/       扩展开发模板') &&
    readme.includes('扩展开发：`docs-site/docs/plugins/overview.md`') &&
	    docsIndex.includes('title: PayIncus') &&
	    docsIndex.includes('扩展市场、主题系统和后台 OTA') &&
	    docsIndex.includes('[扩展开发](/plugins/overview)：扩展中心') &&
	    enDocsIndex.includes('title: PayIncus') &&
	    enDocsIndex.includes('extension marketplace, themes, and admin OTA updates') &&
	    enDocsIndex.includes('[Extension Development](/en/plugins/overview): Extension Center') &&
    adminOverviewDocs.includes('| 扩展中心 | `/admin/plugins` | 已安装扩展、扩展市场') &&
    enAdminOverviewDocs.includes('## Extension Center') &&
    enAdminOverviewDocs.includes('Extension Market') &&
    enPluginOverviewDocs.includes('# Extension Center') &&
    enPluginOverviewDocs.includes('The PayIncus Extension Center installs') &&
    enPluginOverviewDocs.includes('Extensions do not modify PayIncus source code directly') &&
    enPluginOverviewDocs.includes('## Platform Goal') &&
    enPluginOverviewDocs.includes('## Extension Market Governance') &&
    enPluginOverviewDocs.includes('## AI Ticket Extension Template') &&
    enPluginDevelopmentDocs.includes('# Extension Development') &&
    enPluginDevelopmentDocs.includes('An extension package must be a `.tar.gz` archive') &&
    enPluginDevelopmentDocs.includes('After the extension is enabled') &&
    enPluginDevelopmentDocs.includes('"title": "My Extension"') &&
    enPluginDevelopmentDocs.includes('PayIncus renders them in the Extension Center') &&
    enPluginTemplatesDocs.includes('# Extension Templates') &&
    enPluginTemplatesDocs.includes('admin Extension Center') &&
    !zhLocale.includes("plugins: '插件中心'") &&
    !enLocale.includes("plugins: 'Plugin Center'") &&
    !adminRouter.includes("title: '插件设置'") &&
    !pluginSettingsView.includes('返回插件中心') &&
    !pluginSettingsView.includes('加载插件设置失败') &&
    !pluginSettingsView.includes('插件设置页面') &&
    !readme.includes('插件开发模板') &&
    !readme.includes('插件开发：`docs-site/docs/plugins/overview.md`') &&
    !docsIndex.includes('title: 插件中心') &&
    !enDocsIndex.includes('title: Plugin Center') &&
    !adminOverviewDocs.includes('| 插件中心 |') &&
    !enAdminOverviewDocs.includes('## Plugin Center') &&
    !enPluginOverviewDocs.includes('# Plugin Center') &&
    !enPluginOverviewDocs.includes('Plugins do not modify PayIncus source code directly') &&
    !enPluginOverviewDocs.includes('## AI Ticket Plugin Template') &&
    !enPluginOverviewDocs.includes('whether the plugin is enabled') &&
    !enPluginDevelopmentDocs.includes('# Plugin Development') &&
    !enPluginDevelopmentDocs.includes('A plugin package must be a `.tar.gz` archive') &&
    !enPluginDevelopmentDocs.includes('After the plugin is enabled') &&
    !enPluginDevelopmentDocs.includes('plugin center') &&
    !enPluginTemplatesDocs.includes('# Plugin Templates') &&
    !enPluginTemplatesDocs.includes('plugin center'),
  'current user-facing navigation, settings pages, and docs must use Extension Center naming while code paths keep plugins for compatibility'
)

assert.ok(
  adminRoute.includes("fastify.get('/action-rate-limits'") &&
    adminRoute.includes("fastify.put<{ Body: ActionRateLimitPolicyUpdateBody }>('/action-rate-limits'") &&
    adminRoute.includes('PUBLIC_PLUGIN_ACTION_RATE_LIMIT_DEFAULTS') &&
    adminRoute.includes('normalizePublicPluginActionRateLimitPolicy') &&
    adminRoute.includes('INSERT INTO "public_plugin_action_rate_limit_policies"') &&
    adminRoute.includes('ON CONFLICT ("plugin_id", "action_name", "rate_limit")') &&
    adminRoute.includes('DELETE FROM "public_plugin_action_rate_limit_buckets"') &&
    adminRoute.includes('public_api.plugin_action_rate_limits.update') &&
    adminRoute.includes('SUPER_ADMIN_REQUIRED'),
  'plugin center must expose super-admin managed public plugin action rate limit policies and reset active buckets on save'
)

assert.ok(
  pluginSettingsView.includes('AI 工单助手') &&
    pluginSettingsView.includes('OpenAI 兼容接口地址') &&
    pluginSettingsView.includes('模型 API Key') &&
    pluginSettingsView.includes('留空则保持不变') &&
    pluginSettingsView.includes('自动回复策略') &&
    pluginSettingsView.includes('api.plugins.updateConfig') &&
    pluginSettingsView.includes("key: 'apiKey'") &&
    !pluginSettingsView.includes('配置 JSON') &&
    !pluginSettingsView.includes('套用默认模板'),
  'standalone plugin settings page must provide a Chinese business form and must not expose JSON/template editing'
)

assert.ok(
  sideNav.includes('loadAdminPluginMenuItems') &&
    sideNav.includes("page.slot === 'admin.plugins.settings'") &&
    sideNav.includes('admin.sidebar.extra') &&
    sideNav.includes("plugin.status !== 'failed'") &&
    !sideNav.includes("plugin.enabled && plugin.status === 'enabled'") &&
    sideNav.includes("path: `/admin/plugins/${encodeURIComponent(plugin.pluginId)}/settings`") &&
    sideNav.includes('payincus:admin-plugin-nav-refresh') &&
    sideNav.includes('labelText'),
  'admin side nav must load installed plugin settings entries and controlled admin sidebar entries dynamically'
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
