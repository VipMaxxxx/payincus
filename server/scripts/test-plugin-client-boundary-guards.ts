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
const pluginPage = read('client/src/views/PluginPageView.vue')
const sideNav = read('client/src/components/layout/SideNav.vue')
const userApi = read('client/src/api/index.ts')
const adminApi = read('client/src/api/admin.ts')
const manifest = read('server/src/lib/plugin-manifest.ts')
const updateTask = read('server/src/scripts/run-system-update-task.ts')
const installPanel = read('scripts/install-panel.sh')
const backendService = read('deploy/incudal-backend.service.example')

assert.ok(
  userRouter.includes("path: '/plugins/:pathMatch(.*)*'") &&
    userRouter.includes('requiresUser: true') &&
    adminRouter.includes("path: '/admin/plugins'"),
  'plugin pages must be split between user plugin routes and admin plugin center routes'
)

assert.ok(
  pluginFrame.includes('sandbox=') &&
    pluginSlot.includes('getEnabledClientExtensions') &&
    pluginPage.includes('currentExtension') &&
    sideNav.includes('v-if="!isAdminEntry"') &&
    sideNav.includes('slot-name="user.sidebar.extra"'),
  'client plugin rendering must use sandbox frames and only inject user sidebar entries in the user entry'
)

assert.ok(
  userApi.includes('/plugins/enabled-client-extensions') &&
    userApi.includes('/plugins/${pluginId}/config/public') &&
    userApi.includes('/plugins/${pluginId}/actions/${action}') &&
    !userApi.includes('/admin/plugins') &&
    adminApi.includes('/admin/plugins'),
  'user API client must not expose admin plugin management endpoints'
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

for (const path of ['plugins', 'plugin-data', 'plugin-logs', 'plugin-staging']) {
  assert.ok(updateTask.includes(path), `online updater must preserve ${path}`)
  assert.ok(installPanel.includes(path), `install panel must create and permit ${path}`)
  assert.ok(backendService.includes(path), `systemd example must permit ${path}`)
}

console.log('plugin client boundary guard tests passed')
