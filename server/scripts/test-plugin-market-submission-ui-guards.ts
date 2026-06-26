import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const userExtensionsView = read('client/src/views/ExtensionsView.vue')
const adminPluginCenterView = read('client/src/views/admin/PluginCenterView.vue')
const userApi = read('client/src/api/index.ts')
const adminApi = read('client/src/api/admin.ts')
const routerUser = read('client/src/router/user.ts')
const routerAdmin = read('client/src/router/admin.ts')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')

assert.ok(
  routerUser.includes("path: '/extensions'") &&
    userExtensionsView.includes("activeTab = ref<'init-commands' | 'developer-submissions'>") &&
    userExtensionsView.includes('开发者投稿') &&
    userExtensionsView.includes('selectedSubmissionPackageFile') &&
    userExtensionsView.includes('uploadSubmissionPackage') &&
    userExtensionsView.includes('上传并解析') &&
    userExtensionsView.includes('submitPluginReview') &&
    userExtensionsView.includes('api.pluginMarketSubmissions.uploadPackage') &&
    userExtensionsView.includes('api.pluginMarketSubmissions.create') &&
    userExtensionsView.includes('api.pluginMarketSubmissions.mine') &&
    userExtensionsView.includes('permissions: parseJsonObjectInput') &&
    userExtensionsView.includes('compatibility: parseJsonObjectInput') &&
    userExtensionsView.includes('我的投稿') &&
    userExtensionsView.includes('submissionStatusClass') &&
    userExtensionsView.includes('breakdown') &&
    userExtensionsView.includes('recentWindowHours') &&
    userExtensionsView.includes('recentSuccessRate') &&
    userExtensionsView.includes('formatEventSuccessRate') &&
    userExtensionsView.includes('trendWindowDays') &&
    userExtensionsView.includes('point.date') &&
    userExtensionsView.includes('eventHealthAlertClass') &&
    userExtensionsView.includes('alert.message') &&
    userExtensionsView.includes('alerts') &&
    userExtensionsView.includes('eventAlertPreferences') &&
    userExtensionsView.includes('updateEventAlertPreference') &&
    userExtensionsView.includes('事件告警订阅') &&
    userExtensionsView.includes('最低级别') &&
    userExtensionsView.includes('成功率低于') &&
    userExtensionsView.includes('notifyOnDeadLetter') &&
    userExtensionsView.includes('notifyOnDueRetry') &&
    userExtensionsView.includes('notifyOnSuccessRateBelow') &&
    userExtensionsView.includes('item.eventName') &&
    userExtensionsView.includes('item.handler'),
  'user extensions view must expose a developer submission form, personal submission history, event health, and alert preferences'
)

assert.ok(
  routerAdmin.includes("path: '/admin/plugins'") &&
    adminPluginCenterView.includes("type PluginCenterTab = 'installed' | 'market' | 'submissions' | 'themes' | 'limits' | 'events' | 'tasks'") &&
    adminPluginCenterView.includes("label: '投稿审核'") &&
    adminPluginCenterView.includes('loadSubmissions') &&
    adminPluginCenterView.includes('reviewSubmission') &&
    adminPluginCenterView.includes('api.pluginMarketSubmissions.listForReview') &&
    adminPluginCenterView.includes('api.pluginMarketSubmissions.review') &&
    adminPluginCenterView.includes('submissionStatusFilter') &&
    adminPluginCenterView.includes('通过') &&
    adminPluginCenterView.includes('拒绝') &&
    adminPluginCenterView.includes('下架'),
  'admin plugin center must expose the submission review queue and review actions'
)

assert.ok(
  userApi.includes('pluginMarketSubmissions:') &&
    userApi.includes("http.post('/plugin-market-submissions/upload-package'") &&
    userApi.includes("http.post('/plugin-market-submissions', data)") &&
    userApi.includes("http.get('/plugin-market-submissions/mine')") &&
    userApi.includes("http.get('/plugin-market-submissions/mine/event-alert-preferences')") &&
    userApi.includes("http.patch(`/plugin-market-submissions/mine/event-alert-preferences/${encodeURIComponent(pluginId)}`") &&
    adminApi.includes('pluginMarketSubmissions:') &&
    adminApi.includes("http.get('/plugin-market-submissions/admin'") &&
    adminApi.includes("http.patch(`/plugin-market-submissions/admin/${id}/review`, data)"),
  'user and admin API wrappers must expose submission and review endpoints'
)

assert.ok(
    platformPlan.includes('开发者投稿入口和管理员审核后台 UI 首版') &&
    platformPlan.includes('第三方扩展包托管上传首版') &&
    platformPlan.includes('投稿自动扫描首版') &&
    platformPlan.includes('文档站市场目录发布首版') &&
    platformPlan.includes('主题包安装、市场安装、投稿审核/扫描/发布器、预览、启用、回滚、配置表单和受控模板片段首版') &&
    platformPlan.includes('CSS/HTML 资产校验'),
  'platform plan must distinguish implemented submission UI, scanning, publishing, and theme market/template work'
)

assert.ok(
  serverPackage.includes('"test:plugin-market-submission-ui-guards"') &&
    rootPackage.includes('pnpm --filter server test:plugin-market-submission-ui-guards'),
  'plugin market submission UI guard must be wired into package scripts'
)

console.log('plugin market submission UI guard tests passed')
