import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260626103000_add_plugin_market_submissions/migration.sql')
const db = read('server/src/db/plugin-market-submissions.ts')
const route = read('server/src/routes/plugin-market-submissions.ts')
const runtimeSettings = read('server/src/lib/runtime-settings.ts')
const app = read('server/src/app.ts')
const clientApi = read('client/src/api/index.ts')
const adminApi = read('client/src/api/admin.ts')
const clientTypes = read('client/src/types/api.ts')
const userExtensionsView = read('client/src/views/ExtensionsView.vue')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const envExample = read('.env.example')
const installPanel = read('scripts/install-panel.sh')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')

assert.ok(
  schema.includes('model PluginMarketSubmission') &&
    schema.includes('@@unique([pluginId, version])') &&
    schema.includes('reviewStatus      String    @default("pending")') &&
    schema.includes('riskLevel         String    @default("medium")') &&
    schema.includes('pluginMarketSubmissions PluginMarketSubmission[]') &&
    migration.includes('CREATE TABLE "plugin_market_submissions"') &&
    migration.includes('"package_url" TEXT NOT NULL') &&
    migration.includes('"sha256" TEXT NOT NULL') &&
    migration.includes('plugin_market_submissions_plugin_id_version_key') &&
    migration.includes('REFERENCES "users"("id") ON DELETE CASCADE'),
  'plugin market submissions must have a persisted review queue with unique plugin version submissions and user ownership'
)

assert.ok(
  db.includes('createPluginMarketSubmission') &&
    db.includes('listMyPluginMarketSubmissions') &&
    db.includes('listPluginMarketSubmissions') &&
    db.includes('reviewPluginMarketSubmission') &&
    db.includes('serializePluginMarketSubmission') &&
    db.includes('reviewedAt: new Date()'),
  'plugin market submission DB helpers must create, list, review, and serialize submissions'
)

assert.ok(
    route.includes("fastify.post<{") &&
    route.includes("fastify.get('/mine'") &&
    route.includes("fastify.get('/mine/event-health'") &&
    route.includes('buildDeveloperPluginEventHealth') &&
    route.includes('submittedByUserId: userId') &&
    route.includes("action: 'plugin.event.dispatch'") &&
    route.includes('interface DeveloperPluginEventHealthBreakdown') &&
    route.includes("distinct: ['eventName', 'handler']") &&
    route.includes('pairs.slice(0, 50)') &&
    route.includes('breakdown') &&
    route.includes('recentWindowHours = 24') &&
    route.includes('recentSuccessRate') &&
    route.includes('calculateSuccessRate') &&
    route.includes('trendWindowDays = 7') &&
    route.includes('buildDeveloperEventTrend') &&
    route.includes('trend: buildDeveloperEventTrend') &&
    route.includes('interface DeveloperPluginEventHealthAlert') &&
    route.includes('buildDeveloperEventAlerts') &&
    route.includes("code: 'dead_letter'") &&
    route.includes("code: 'recent_success_rate_low'") &&
    route.includes('alerts: buildDeveloperEventAlerts') &&
    route.includes('lastAttemptAt: { gte: recentSince }') &&
    route.includes('lastError') &&
    !route.includes('payload: latest') &&
    route.includes("fastify.post('/upload-package'") &&
    route.includes("fastify.get<{") &&
    route.includes("'/uploads/plugins/:filename'") &&
    route.includes('receiveUploadedPluginPackage') &&
    route.includes('validateAndExtractPluginPackage') &&
    route.includes('getPluginSubmissionUploadDir') &&
    route.includes('getPluginSubmissionPublicBaseUrl') &&
    runtimeSettings.includes('PLUGIN_SUBMISSION_PUBLIC_BASE_URL') &&
    route.includes('plugin.market_submission.upload_package') &&
    route.includes("fastify.get<{") &&
    route.includes("fastify.patch<{") &&
    route.includes('normalizeHttpsUrl') &&
    route.includes("url.protocol !== 'https:'") &&
    route.includes('SHA256_PATTERN') &&
    route.includes('PLUGIN_SUBMISSION_EXISTS') &&
    route.includes('requirePluginMarketReviewer') &&
    route.includes('getCombinedAdminIdAllowlist') &&
    route.includes('PLUGIN_MANAGER_ALLOWED_ADMIN_IDS') &&
    route.includes('plugin.market_submission.create') &&
    route.includes('plugin.market_submission.review'),
  'plugin market submission routes must validate HTTPS sources, SHA256, duplicate submissions, reviewer authorization, and audit logs'
)

assert.ok(
  app.includes("import pluginMarketSubmissionRoutes from './routes/plugin-market-submissions.js'") &&
    app.includes("await fastify.register(pluginMarketSubmissionRoutes, { prefix: '/api/plugin-market-submissions' })"),
  'plugin market submission routes must be registered'
)

assert.ok(
  clientTypes.includes('PluginMarketSubmissionReviewStatus') &&
    clientTypes.includes('PluginMarketSubmissionRiskLevel') &&
    clientTypes.includes('PluginMarketSubmission') &&
    clientTypes.includes('DeveloperPluginEventHealth') &&
    clientTypes.includes('DeveloperPluginEventHealthBreakdown') &&
    clientTypes.includes('breakdown: DeveloperPluginEventHealthBreakdown[]') &&
    clientTypes.includes('lastFailureAt: string | null') &&
    clientTypes.includes('recentWindowHours: number') &&
    clientTypes.includes('recentSuccessRate: number | null') &&
    clientTypes.includes('DeveloperPluginEventHealthTrendPoint') &&
    clientTypes.includes('trendWindowDays: number') &&
    clientTypes.includes('trend: DeveloperPluginEventHealthTrendPoint[]') &&
    clientTypes.includes('DeveloperPluginEventHealthAlert') &&
    clientTypes.includes("level: 'warning' | 'critical'") &&
    clientTypes.includes('alerts: DeveloperPluginEventHealthAlert[]') &&
    clientTypes.includes('CreatePluginMarketSubmissionRequest') &&
    clientTypes.includes('PluginMarketSubmissionUploadResult') &&
    clientTypes.includes('ReviewPluginMarketSubmissionRequest') &&
    clientApi.includes('pluginMarketSubmissions:') &&
    clientApi.includes('uploadPackage: (file: File)') &&
    clientApi.includes("http.post('/plugin-market-submissions/upload-package'") &&
    clientApi.includes("http.post('/plugin-market-submissions', data)") &&
    clientApi.includes("http.get('/plugin-market-submissions/mine')") &&
    clientApi.includes("http.get('/plugin-market-submissions/mine/event-health')") &&
    !clientApi.includes("http.get('/plugin-market-submissions/admin'") &&
    !clientApi.includes("http.patch(`/plugin-market-submissions/admin/${id}/review`, data)") &&
    adminApi.includes('pluginMarketSubmissions:') &&
    adminApi.includes("http.get('/plugin-market-submissions/admin'") &&
    adminApi.includes("http.patch(`/plugin-market-submissions/admin/${id}/review`, data)") &&
    adminApi.includes("http.post(`/plugin-market-submissions/admin/${id}/scan`") &&
    adminApi.includes("http.post('/plugin-market-submissions/admin/publish-market-index'"),
  'client API types and wrappers must expose submission and review workflows'
)

assert.ok(
  userExtensionsView.includes('selectedSubmissionPackageFile') &&
    userExtensionsView.includes('uploadSubmissionPackage') &&
    userExtensionsView.includes('onSubmissionPackageSelected') &&
    userExtensionsView.includes('上传并解析') &&
    userExtensionsView.includes('upload.manifestUrl') &&
    userExtensionsView.includes('upload.packageUrl') &&
    userExtensionsView.includes('upload.sha256') &&
    userExtensionsView.includes('eventHealthByPluginId') &&
    userExtensionsView.includes('事件投递健康') &&
    userExtensionsView.includes('EventHealthStatus') &&
    userExtensionsView.includes('formatEventSuccessRate') &&
    userExtensionsView.includes('recentSuccessRate') &&
    userExtensionsView.includes('recentWindowHours') &&
    userExtensionsView.includes('trendWindowDays') &&
    userExtensionsView.includes('point.date') &&
    userExtensionsView.includes('eventHealthAlertClass') &&
    userExtensionsView.includes('alert.message') &&
    userExtensionsView.includes('item.eventName') &&
    userExtensionsView.includes('item.handler') &&
    userExtensionsView.includes('eventHealthStatusText'),
  'developer submission UI must support uploading a plugin package and auto-filling review metadata'
)

assert.ok(
  developmentDocs.includes('## 投稿审核接口') &&
    developmentDocs.includes('POST /api/plugin-market-submissions/upload-package') &&
    developmentDocs.includes('GET /api/plugin-market-submissions/uploads/plugins/:filename') &&
    developmentDocs.includes('PLUGIN_SUBMISSION_PUBLIC_BASE_URL') &&
    developmentDocs.includes('`payincus.plugin.json` manifest 地址') &&
    !developmentDocs.includes('未来平台 2.0 manifest 地址') &&
    developmentDocs.includes('POST /api/plugin-market-submissions') &&
    developmentDocs.includes('GET /api/plugin-market-submissions/mine') &&
    developmentDocs.includes('GET /api/plugin-market-submissions/mine/event-health') &&
    developmentDocs.includes('只返回当前登录用户提交过的插件 ID 的事件投递聚合健康') &&
    developmentDocs.includes('最近 24 小时总量') &&
    developmentDocs.includes('最近 24 小时成功率') &&
    developmentDocs.includes('最近 7 日趋势') &&
    developmentDocs.includes('只读告警提示') &&
    developmentDocs.includes('近期成功率低于 95%') &&
    developmentDocs.includes('按 `eventName + handler` 拆分的只读 `breakdown` 明细') &&
    developmentDocs.includes('每个明细同样包含最近 24 小时窗口统计') &&
    developmentDocs.includes('GET /api/plugin-market-submissions/admin') &&
    developmentDocs.includes('PATCH /api/plugin-market-submissions/admin/:id/review') &&
    developmentDocs.includes('审核通过后仍需要发布到文档站扩展市场目录') &&
    developmentDocs.includes('开发者中心投稿 UI、审核后台 UI、自动扫描和文档站市场目录发布器') &&
    !developmentDocs.includes('开发者中心 UI、审核后台 UI、自动扫描和文档站市场目录自动发布仍会继续补齐') &&
    platformPlan.includes('第三方投稿审核队列首版') &&
    platformPlan.includes('第三方扩展包托管上传首版') &&
    platformPlan.includes('PLUGIN_DATA_DIR/submission-uploads/plugins') &&
    platformPlan.includes('开发者投稿入口和管理员审核后台 UI 首版') &&
    platformPlan.includes('开发者事件健康只读监控、最近 24 小时窗口、最近 7 日趋势、成功率') &&
    platformPlan.includes('开发者告警提示') &&
    platformPlan.includes('外部通知订阅和升级策略') &&
    platformPlan.includes('文档站市场目录发布首版') &&
    envExample.includes('PLUGIN_SUBMISSION_PUBLIC_BASE_URL=') &&
    installPanel.includes('PLUGIN_SUBMISSION_PUBLIC_BASE_URL'),
  'extension docs must describe the submission queue API and remaining publishing/UI work'
)

assert.ok(
  serverPackage.includes('"test:plugin-market-submission-guards"') &&
    rootPackage.includes('pnpm --filter server test:plugin-market-submission-guards'),
  'plugin market submission guard must be wired into package scripts'
)

console.log('plugin market submission guard tests passed')
