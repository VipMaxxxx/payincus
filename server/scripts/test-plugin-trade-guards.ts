import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260712180000_add_plugin_trade_core/migration.sql')
const service = read('server/src/services/plugin-trade.ts')
const route = read('server/src/routes/plugin-trade.ts')
const app = read('server/src/app.ts')
const adminPlugins = read('server/src/routes/admin-plugins.ts')
const userPlugins = read('server/src/routes/plugins.ts')
const submissionRoute = read('server/src/routes/plugin-market-submissions.ts')

for (const model of [
  'PluginPurchase',
  'PluginLicense',
  'PluginRefund',
  'PluginDeveloperEarning',
  'PluginDeveloperWithdrawal'
]) {
  assert.ok(schema.includes(`model ${model} {`), `schema must contain ${model}`)
}
assert.ok(
  schema.includes('@@unique([userId, idempotencyKey])') &&
    schema.includes('@@unique([userId, pluginId, version])') &&
    schema.includes('@@unique([developerId, idempotencyKey])'),
  'purchase and withdrawal writes must have database idempotency constraints'
)

assert.ok(
  migration.includes('"gross_cents" = "platform_fee_cents" + "net_cents"') &&
    migration.includes('CHECK ("currency" IN (\'CNY\', \'USD\'))') &&
    migration.includes('CHECK ("amount_cents" >= 1000)'),
  'migration must enforce accounting equality, currency whitelist and conservative withdrawal minimum'
)

assert.ok(
  service.includes('PLUGIN_MARKET_PLATFORM_REVENUE_SHARE_PERCENT') &&
    service.includes('grossCents !== platformFeeCents + netCents') &&
    service.includes('PLUGIN_REFUND_WINDOW_DAYS = 7') &&
    service.includes('availableAt: refundableUntil'),
  'trade service must use fixed market share, exact integer accounting and a seven-day settlement hold'
)

assert.ok(
  service.includes('advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE') &&
    service.includes('userId_pluginId_version') &&
    service.includes('PLUGIN_VERSION_ALREADY_PURCHASED') &&
    service.includes('balance: { gte: amount }') &&
    service.includes("where: { id: purchase.id, status: 'completed' }") &&
    service.includes("where: { id: purchase.license.id, status: 'active', revokedAt: null }") &&
    service.includes("where: { id: purchase.earning.id, status: 'pending', reversedAt: null }") &&
    service.includes("where: { id: input.withdrawalId, status: 'pending' }"),
  'balance deduction, refund reversal and withdrawal review must use locks plus conditional claims'
)

assert.ok(
  service.includes('tx.pluginLicense.create') &&
    service.includes('tx.pluginDeveloperEarning.create') &&
    service.includes("status: 'revoked'") &&
    service.includes("status: 'reversed'") &&
    service.includes("type: 'refund'") &&
    service.includes("type: 'consume'"),
  'purchase must create license and earning while refund revokes, reverses and restores wallet balance'
)

assert.ok(
  app.includes("import pluginTradeRoutes from './routes/plugin-trade.js'") &&
    app.includes("fastify.register(pluginTradeRoutes, { prefix: '/api/plugin-trade' })") &&
    route.includes("fastify.post<{\n    Body: { pluginId: string; version: string; idempotencyKey: string }\n  }>('/purchases'") &&
    route.includes("('/purchases/:id/refund'") &&
    route.includes("('/developer/withdrawals'") &&
    route.includes("('/admin/withdrawals/:id/approve'") &&
    route.includes("('/admin/withdrawals/:id/reject'"),
  'authenticated purchase, refund, earning and manual withdrawal routes must be mounted'
)

assert.ok(
  adminPlugins.includes('assertPaidPluginLicense({ userId: user.id, pluginId: entry.id, version: entry.latest, pricing: entry.pricing })') &&
    adminPlugins.includes('assertPaidPluginLicense({ userId: user.id, pluginId, version: current.currentVersion })') &&
    userPlugins.includes('await assertPaidPluginLicense({') &&
    userPlugins.includes("code: error instanceof PluginTradeError ? error.code : 'PLUGIN_ACTION_FAILED'"),
  'paid plugins must require an active version license at install, enable and runtime action gates'
)

assert.ok(
  submissionRoute.includes('PAID_MARKET_LISTING_NOT_AVAILABLE') &&
    submissionRoute.includes('!isFreePricing(submission.pricing)'),
  'paid listing gate must remain closed despite the trade core being present'
)

assert.ok(
  route.includes('target=redacted') &&
    service.includes("payoutTarget: target.length <= 8 ? '***'") &&
    !route.includes('payoutTarget=${'),
  'withdrawal audit and API serialization must not expose payout targets'
)

console.log('plugin trade guard tests passed')
