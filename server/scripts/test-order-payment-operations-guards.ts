import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const root = resolve(__dirname, '..')
const repoRoot = resolve(root, '..')

const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8')
const migration = readFileSync(resolve(root, 'prisma/migrations/20260624210000_add_order_operation_cases/migration.sql'), 'utf8')
const ordersRoute = readFileSync(resolve(root, 'src/routes/orders.ts'), 'utf8')
const balanceDb = readFileSync(resolve(root, 'src/db/balance.ts'), 'utf8')
const adminApi = readFileSync(resolve(repoRoot, 'client/src/api/admin.ts'), 'utf8')
const userApi = readFileSync(resolve(repoRoot, 'client/src/api/index.ts'), 'utf8')
const adminOrdersView = readFileSync(resolve(repoRoot, 'client/src/views/admin/OrdersView.vue'), 'utf8')
const userOrdersView = readFileSync(resolve(repoRoot, 'client/src/views/OrdersView.vue'), 'utf8')

assert.ok(schema.includes('enum OrderOperationStatus'), 'schema must define order operation status enum')
assert.ok(schema.includes('pending_review') && schema.includes('compensated') && schema.includes('closed'), 'order operation enum must include dispute lifecycle states')
assert.ok(schema.includes('model OrderOperationCase'), 'schema must define order operation case model')
assert.ok(schema.includes('balanceAdjustmentRequestId Int?                 @unique'), 'operation case must bind at most one adjustment request')
assert.ok(schema.includes('@@unique([sourceType, sourceId])'), 'operation case must be unique per order source')
assert.ok(schema.includes('providerSummary            Json?'), 'operation case must store only a structured provider summary')

assert.ok(migration.includes('CREATE TYPE "OrderOperationStatus"'), 'migration must create order operation enum')
assert.ok(migration.includes('CREATE TABLE "order_operation_cases"'), 'migration must create operation case table')
assert.ok(migration.includes('CREATE UNIQUE INDEX "order_operation_cases_source_type_source_id_key"'), 'migration must enforce one operation case per order')
assert.ok(migration.includes('balance_adjustment_request_id'), 'migration must link operation cases to adjustment approvals')
assert.ok(migration.includes('ON DELETE SET NULL'), 'approval link should not cascade-delete operation history')

assert.ok(ordersRoute.includes("'/api/admin/orders/:type/:id/operation'"), 'admin operation route missing')
assert.ok(ordersRoute.includes('preHandler: [fastify.authenticateAdmin]'), 'operation route must require admin auth')
assert.ok(ordersRoute.includes('ORDER_OPERATION_STATUSES'), 'route must validate operation statuses')
assert.ok(ordersRoute.includes('normalizeOrderOperationInput(request.body)'), 'route must validate operation request body')
assert.ok(ordersRoute.includes("requestType: 'refund'"), 'refund registration must create refund adjustment request')
assert.ok(ordersRoute.includes('createBalanceAdjustmentRequest({'), 'refund registration must use approval workflow')
assert.ok(ordersRoute.includes("status: 'pending'") && ordersRoute.includes('existingPendingRefund'), 'route must block duplicate pending refunds')
assert.ok(ordersRoute.includes('serializeOrderOperationCase(operationCase)'), 'route must return serialized operation case')
assert.ok(ordersRoute.includes('buildProviderStatusSummary'), 'route must expose a redacted provider status summary')
assert.ok(ordersRoute.includes('maskTradeNo'), 'provider trade number must be masked in summary')
assert.ok(!ordersRoute.includes('refundToBalance('), 'order operation route must not directly refund to balance')
assert.ok(!ordersRoute.includes('adminAdjustBalance('), 'order operation route must not directly adjust balance')
assert.ok(!ordersRoute.includes('callbackData'), 'order operation APIs must not expose raw callback payloads')
assert.ok(!ordersRoute.includes('providerConfigSnapshot'), 'order operation APIs must not expose provider config snapshots')

assert.ok(balanceDb.includes('approveBalanceAdjustmentRequest('), 'approval workflow must remain the balance mutation path')
assert.ok(balanceDb.includes('changeBalanceInTransaction(tx, {'), 'approval execution must mutate balance inside transaction')

assert.ok(adminApi.includes('recordOperation'), 'admin API must expose order operation action')
assert.ok(adminApi.includes("http.post(`/admin/orders/${sourceType}/${sourceId}/operation`, data)"), 'admin operation API path mismatch')
assert.ok(!userApi.includes('/admin/orders') && !userApi.includes('recordOperation'), 'user API must not expose admin order operation route')

assert.ok(adminOrdersView.includes('订单运营处理'), 'admin order detail must render operation panel')
assert.ok(adminOrdersView.includes('同时登记退款审批'), 'admin UI must expose refund registration')
assert.ok(adminOrdersView.includes('不会直接修改余额'), 'admin UI must make approval-only refund behavior explicit')
assert.ok(adminOrdersView.includes('hasPendingRefundRequest'), 'admin UI must block duplicate pending refund registration')
assert.ok(adminOrdersView.includes('keyword') && adminOrdersView.includes('createdFrom') && adminOrdersView.includes('createdTo'), 'admin order list must expose search and date filters')
assert.ok(adminOrdersView.includes('api.orders.recordOperation'), 'admin UI must call order operation API')
assert.ok(!adminOrdersView.includes('api.admin.adjustUserBalance'), 'admin order center must not directly mutate balance')

assert.ok(!userOrdersView.includes('订单运营处理'), 'user order page must not expose admin operation panel')
assert.ok(!userOrdersView.includes('退款审批'), 'user order page must not expose admin refund approval wording')

console.log('order payment operations guards passed')
