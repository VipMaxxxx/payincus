import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

const route = read('server/src/routes/admin-integrations.ts')
const app = read('server/src/app.ts')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260627094500_add_integration_health_checks/migration.sql')
const adminApi = read('client/src/api/admin.ts')
const integrationsView = read('client/src/views/admin/IntegrationsView.vue')
const matrix = read('docs-site/docs/guide/capability-matrix.md')
const enMatrix = read('docs-site/docs/en/guide/capability-matrix.md')
const adminOverview = read('docs-site/docs/admin/overview.md')
const enAdminOverview = read('docs-site/docs/en/admin/overview.md')

assert(
  route.includes("fastify.post('/health'") &&
    route.includes('fastify.authenticateAdmin') &&
    route.includes('testSmtpConnection') &&
    route.includes('getTicketImageLskyConfig') &&
    route.includes('getWebhookInfo') &&
    route.includes('getActivePaymentProviders') &&
    route.includes('StorageFactory') &&
    route.includes('checkForUpdates') &&
    route.includes('hostAgentOfflineThresholdMs') &&
    route.includes('notificationChannel.findMany') &&
    route.includes('fetchPluginMarketIndex') &&
    route.includes('fetchThemeMarketIndex') &&
    route.includes("probe('payment-providers'") &&
    route.includes("probe('notification-channels'") &&
    route.includes("probe('remote-storage'") &&
    route.includes("probe('host-agent'") &&
    route.includes("probe('ota-release'") &&
    route.includes("status: 'ok'") &&
    route.includes("status: 'warning'") &&
    route.includes("status: 'error'") &&
    route.includes("status: 'skipped'"),
  'admin integrations route must expose authenticated SMTP/Lsky/Telegram/payment/notification/storage/Agent/OTA/market health probes'
)

assert(
  schema.includes('model IntegrationHealthCheck') &&
    schema.includes('@@map("integration_health_checks")') &&
    migration.includes('CREATE TABLE "integration_health_checks"') &&
    migration.includes('"checked_at"') &&
    migration.includes('"duration_ms"'),
  'integration health checks must persist redacted history in a dedicated table'
)

assert(
  route.includes("fastify.get('/health/history'") &&
    route.includes('recordIntegrationHealthItems') &&
    route.includes('integrationHealthCheck.createMany') &&
    route.includes('getIntegrationHealthHistory') &&
    route.includes('recentFailures') &&
    route.includes('successRate') &&
    route.includes('history'),
  'admin integrations route must expose stored health history, recent failures, and success-rate summaries'
)

assert(
  !route.includes('token:') &&
    !route.includes('botToken:') &&
    !route.includes('responseText') &&
    route.includes('hostnameOf(config.baseUrl)') &&
    route.includes('hostnameOf(defaultConfig.host)') &&
    route.includes('Checked integration health: ${items.map'),
  'integration health response and logs must stay redacted and avoid raw token/body exposure'
)

assert(
  app.includes("import adminIntegrationsRoutes from './routes/admin-integrations.js'") &&
    app.includes("await fastify.register(adminIntegrationsRoutes, { prefix: '/api/admin/integrations' })"),
  'admin integrations route must be registered under /api/admin/integrations'
)

assert(
  adminApi.includes('export type IntegrationHealthStatus') &&
    adminApi.includes('export interface IntegrationHealthItem') &&
    adminApi.includes('export interface IntegrationHealthHistoryResponse') &&
    adminApi.includes('integrations:') &&
    adminApi.includes("http.post('/admin/integrations/health')") &&
    adminApi.includes("http.get('/admin/integrations/health/history')"),
  'admin API client must expose integration health response types and helper'
)

assert(
  integrationsView.includes('runHealthCheck') &&
    integrationsView.includes('api.integrations.health()') &&
    integrationsView.includes('api.integrations.history()') &&
    integrationsView.includes('api.admin.getPaymentProviders()') &&
    integrationsView.includes('一键检测') &&
    integrationsView.includes('充值支付渠道') &&
    integrationsView.includes('Agent / Incus 节点') &&
    integrationsView.includes('OTA 更新源') &&
    integrationsView.includes('healthByKey[item.key]') &&
    integrationsView.includes('healthSummaryByKey[item.key]') &&
    integrationsView.includes('最近异常') &&
    integrationsView.includes('7 天成功率') &&
    integrationsView.includes('healthStatusLabel') &&
    integrationsView.includes('formatDuration'),
  'admin Integration Center must expose one-click health checks, history summaries, and recent failures'
)

assert(
  matrix.includes('一键测试') &&
    matrix.includes('真实外部健康探测') &&
    enMatrix.includes('one-click tests') &&
    enMatrix.includes('live external health probes') &&
    adminOverview.includes('健康检测') &&
    enAdminOverview.includes('health checks'),
  'docs must describe Integration Center health probes and one-click tests'
)

console.log('integration health guards passed')
