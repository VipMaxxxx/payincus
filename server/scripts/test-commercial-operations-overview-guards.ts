import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const route = read('server/src/routes/admin-statistics.ts')
const adminApi = read('client/src/api/admin.ts')
const userApi = read('client/src/api/index.ts')
const statisticsView = read('client/src/views/admin/StatisticsView.vue')
const zhCN = read('client/src/locales/zh-CN.ts')
const zhTW = read('client/src/locales/zh-TW.ts')
const en = read('client/src/locales/en.ts')

assert.ok(
  route.includes("app.get('/api/admin/statistics/overview'") &&
    route.includes('onRequest: [app.authenticate, app.requireAdmin]'),
  'commercial operations overview must stay behind the admin statistics route guard'
)

assert.ok(
  route.includes('operations: {') &&
    route.includes('COUNT(DISTINCT user_id)') &&
    route.includes('prisma.paymentProvider.count') &&
    route.includes('prisma.hostAgent.count') &&
    route.includes('prisma.systemUpdateTask.count') &&
    route.includes('disk_update_error') &&
    route.includes('payment_provider_missing') &&
    route.includes('delivery_failed'),
  'admin statistics route must aggregate real commercial operations and risk data'
)

assert.ok(
  adminApi.includes('operations: {') &&
    adminApi.includes("risks: Array<{") &&
    adminApi.includes("severity: 'info' | 'warning' | 'critical'") &&
    !userApi.includes('/admin/statistics/overview') &&
    !userApi.includes('operations: {'),
  'commercial operations API typing must be admin-only'
)

assert.ok(
  statisticsView.includes('operationCards') &&
    statisticsView.includes('operationRisks') &&
    statisticsView.includes('admin.statistics.operations.title') &&
    statisticsView.includes('admin.statistics.operations.risks.${risk.key}.title') &&
    statisticsView.includes('riskToneClass'),
  'admin statistics UI must render operation cards and risk list'
)

for (const locale of [zhCN, zhTW, en]) {
  assert.ok(
    locale.includes('operations: {') &&
      locale.includes('todayRevenue') &&
      locale.includes('payment_provider_missing') &&
      locale.includes('smtp_missing') &&
      locale.includes('notification_channel_missing') &&
      locale.includes('host_offline') &&
      locale.includes('agent_stale') &&
      locale.includes('delivery_failed') &&
      locale.includes('payment_attention') &&
      locale.includes('ota_failed') &&
      locale.includes('disk_update_error'),
    'all frontend locales must include commercial operations labels and risk messages'
  )
}

console.log('commercial operations overview guard tests passed')
