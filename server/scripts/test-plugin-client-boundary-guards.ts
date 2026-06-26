import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const userRouter = read('client/src/router/user.ts')
const adminRouter = read('client/src/router/admin.ts')
const pluginSlot = read('client/src/components/plugins/PluginSlot.vue')
const pluginFrame = read('client/src/components/plugins/PluginFrame.vue')
const pluginFrameSlot = read('client/src/components/plugins/PluginFrameSlot.vue')
const pluginAssets = read('client/src/utils/plugin-assets.ts')
const pluginPage = read('client/src/views/PluginPageView.vue')
const dashboardView = read('client/src/views/DashboardView.vue')
const adminPluginPage = read('client/src/views/admin/AdminPluginPageView.vue')
const pluginSettingsView = read('client/src/views/admin/PluginSettingsView.vue')
const statisticsView = read('client/src/views/admin/StatisticsView.vue')
const pluginRoutes = read('server/src/routes/plugins.ts')
const sideNav = read('client/src/components/layout/SideNav.vue')
const userApi = read('client/src/api/index.ts')
const adminApi = read('client/src/api/admin.ts')
const manifest = read('server/src/lib/plugin-manifest.ts')
const basicAdminTemplate = read('plugin-templates/basic-admin-plugin/payincus.plugin.json')
const mixedTemplate = read('plugin-templates/admin-user-mixed-plugin/payincus.plugin.json')
const updateTask = read('server/src/scripts/run-system-update-task.ts')
const installPanel = read('scripts/install-panel.sh')
const backendService = read('deploy/incudal-backend.service.example')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const clientExtensionDocs = read('docs-site/docs/plugins/client-extensions.md')
const clientExtensionDocsEn = read('docs-site/docs/en/plugins/client-extensions.md')

assert.ok(
  userRouter.includes("path: '/plugins/:pathMatch(.*)*'") &&
    userRouter.includes('requiresUser: true') &&
    adminRouter.includes("path: '/admin/plugins'"),
  'plugin pages must be split between user plugin routes and admin plugin center routes'
)

assert.ok(
  pluginFrame.includes('sandbox=') &&
    pluginFrame.includes("url.startsWith('/api/plugins/assets/')") &&
    pluginFrame.includes('requestPluginAssetToken(asset)') &&
    pluginFrame.includes('assetToken') &&
    pluginFrame.includes('encodeURIComponent(data.assetToken)') &&
    pluginFrame.includes('api.plugins.getPublicConfig(asset.pluginId)') &&
    pluginFrame.includes("type: 'payincus:plugin-config'") &&
    pluginFrame.includes('postMessage') &&
    pluginFrame.includes('window.location.origin') &&
    pluginFrame.includes("window.addEventListener('payincus:plugin-config-refresh'") &&
    pluginFrame.includes('frameClass?: string') &&
    pluginFrame.includes("frameClass || 'min-h-[560px]'") &&
    pluginSettingsView.includes('notifyPluginConfigChanged') &&
    pluginSettingsView.includes("new CustomEvent('payincus:plugin-config-refresh'") &&
    !pluginFrame.includes('token=${encodeURIComponent(token)}') &&
    pluginAssets.includes("window.localStorage.getItem('token')") &&
    pluginAssets.includes("buildApiUrl('/plugins/asset-token')") &&
    pluginAssets.includes('axios.post<PluginAssetTokenResponse>') &&
    pluginSlot.includes('getEnabledClientExtensions') &&
    pluginSlot.includes('getEnabledAdminClientExtensions') &&
    pluginSlot.includes("surface?: 'user' | 'admin'") &&
    pluginFrameSlot.includes('getEnabledClientExtensions') &&
    pluginFrameSlot.includes('getEnabledAdminClientExtensions') &&
    pluginFrameSlot.includes("surface?: 'user' | 'admin'") &&
    pluginFrameSlot.includes('extension.slot === props.slotName') &&
    pluginFrameSlot.includes('<PluginFrame') &&
    pluginFrameSlot.includes('frameClass ||') &&
    pluginPage.includes('currentExtension') &&
    adminPluginPage.includes('getEnabledAdminClientExtensions') &&
    adminPluginPage.includes('<PluginFrame') &&
    sideNav.includes('slot-name="admin.sidebar.extra"') &&
    sideNav.includes('surface="admin"') &&
    sideNav.includes('slot-name="user.sidebar.extra"') &&
    sideNav.includes('surface="user"') &&
    dashboardView.includes('PluginFrameSlot') &&
    dashboardView.includes('slot-name="user.dashboard.cards"') &&
    dashboardView.includes('surface="user"') &&
    statisticsView.includes('PluginFrameSlot') &&
    statisticsView.includes('slot-name="admin.dashboard.widgets"') &&
    statisticsView.includes('surface="admin"') &&
    adminRouter.includes("path: '/admin/plugins/:pluginId/pages/:pathMatch(.*)*'") &&
    adminRouter.includes('AdminPluginPageView.vue'),
  'client plugin rendering must use sandbox frames and inject controlled user/admin sidebar entries into their matching entrypoints'
)

assert.ok(
  pluginRoutes.includes('function getProtectedAssetPolicy') &&
    pluginRoutes.includes("fastify.post<{ Body: AssetTokenBody }>('/asset-token'") &&
    pluginRoutes.includes("kind: 'plugin_asset'") &&
    pluginRoutes.includes("expiresIn: '60s'") &&
    pluginRoutes.includes('manifest.entrypoints?.adminPages') &&
    pluginRoutes.includes('return { requiresAuth: true, adminOnly: true }') &&
    pluginRoutes.includes('page.requiresAuth === true') &&
    pluginRoutes.includes('function authenticateProtectedAsset') &&
    pluginRoutes.includes('request.query.assetToken') &&
    pluginRoutes.includes('fastify.jwt.verify') &&
    pluginRoutes.includes('isAccessTokenInvalidated') &&
    pluginRoutes.includes("user.role !== 'admin'") &&
    pluginRoutes.includes('assetPolicy.requiresAuth') &&
    pluginRoutes.includes("'private, no-store'") &&
    pluginRoutes.includes("'no-referrer'") &&
    pluginRoutes.includes("'X-Robots-Tag', 'noindex'") &&
    pluginRoutes.includes("fastify.get('/enabled-admin-client-extensions'") &&
    pluginRoutes.includes('onRequest: [fastify.authenticateAdmin]') &&
    pluginRoutes.includes("page.slot === 'admin.sidebar.extra'") &&
    pluginRoutes.includes("`/admin/plugins/${encodeURIComponent(plugin.pluginId)}/pages/${encodeURIComponent(page.entry)}`"),
  'plugin asset route must protect authenticated entry pages and enforce admin-only access for admin plugin pages'
)

assert.ok(
  userApi.includes('/plugins/enabled-client-extensions') &&
    userApi.includes('/plugins/enabled-admin-client-extensions') &&
    userApi.includes('/plugins/${pluginId}/config/public') &&
    userApi.includes('/plugins/${pluginId}/actions/${action}') &&
    !userApi.includes('/admin/plugins') &&
    adminApi.includes('/admin/plugins'),
  'user API client must not expose admin plugin management endpoints'
)

assert.ok(
  developmentDocs.includes("type !== 'payincus:plugin-config'") &&
    developmentDocs.includes('event.data.pluginId') &&
    developmentDocs.includes('event.data.config') &&
    developmentDocs.includes('admin.sidebar.extra') &&
    developmentDocs.includes('/api/plugins/enabled-admin-client-extensions') &&
    developmentDocs.includes('/admin/plugins/:pluginId/pages/<entry>') &&
    developmentDocs.includes('页面内扩展点会直接以 sandbox iframe 挂载到对应页面') &&
    developmentDocs.includes('user.dashboard.cards') &&
    developmentDocs.includes('admin.dashboard.widgets') &&
    clientExtensionDocs.includes('`user.dashboard.cards` 会挂载到用户端仪表盘') &&
    clientExtensionDocs.includes('`admin.dashboard.widgets` 会挂载到后台统计页') &&
    clientExtensionDocsEn.includes('`user.dashboard.cards` mounts into the user dashboard') &&
    clientExtensionDocsEn.includes('`admin.dashboard.widgets` mounts into the admin statistics dashboard') &&
    platformPlan.includes('后台侧边栏扩展入口') &&
    platformPlan.includes('通用后台扩展页面路由') &&
    platformPlan.includes('用户仪表盘卡片 slot 和后台统计 widget slot 首版') &&
    platformPlan.includes('扩展 iframe 公有配置实时更新'),
  'plugin development docs must describe iframe public config live updates'
)

assert.ok(
  manifest.includes('user.sidebar.extra') &&
    manifest.includes('user.dashboard.cards') &&
    manifest.includes('user.instance.detail.panels') &&
    manifest.includes('user.instance.renew.widgets') &&
    manifest.includes('admin.plugins.settings') &&
    manifest.includes('admin.user.detail.panels'),
  'plugin slot whitelist must cover the requested admin and user extension points'
)

assert.ok(
  basicAdminTemplate.includes('admin.plugins.settings') &&
    basicAdminTemplate.includes('admin.sidebar.extra') &&
    basicAdminTemplate.includes('admin.dashboard.widgets') &&
    mixedTemplate.includes('user.sidebar.extra') &&
    mixedTemplate.includes('user.dashboard.cards'),
  'official templates must demonstrate sidebar and dashboard extension slots'
)

for (const path of ['plugins', 'plugin-data', 'plugin-logs', 'plugin-staging']) {
  assert.ok(updateTask.includes(path), `online updater must preserve ${path}`)
  assert.ok(installPanel.includes(path), `install panel must create and permit ${path}`)
  assert.ok(backendService.includes(path), `systemd example must permit ${path}`)
}

console.log('plugin client boundary guard tests passed')
