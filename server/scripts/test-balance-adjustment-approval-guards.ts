import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const root = resolve(__dirname, '..')

const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8')
const migration = readFileSync(resolve(root, 'prisma/migrations/20260624193000_add_balance_adjustment_requests/migration.sql'), 'utf8')
const balanceDb = readFileSync(resolve(root, 'src/db/balance.ts'), 'utf8')
const balanceRoute = readFileSync(resolve(root, 'src/routes/balance.ts'), 'utf8')
const adminApi = readFileSync(resolve(root, '../client/src/api/admin.ts'), 'utf8')
const adminOrdersView = readFileSync(resolve(root, '../client/src/views/admin/OrdersView.vue'), 'utf8')

assert.ok(schema.includes('enum BalanceAdjustmentRequestStatus'), 'schema must define adjustment request status enum')
assert.ok(schema.includes('model BalanceAdjustmentRequest'), 'schema must define adjustment request model')
assert.ok(schema.includes('@relation("BalanceAdjustmentTarget"'), 'target user relation missing')
assert.ok(schema.includes('balanceLogId      Int?                           @unique'), 'approval request must bind at most one balance log')

assert.ok(migration.includes('CREATE TYPE "BalanceAdjustmentRequestStatus"'), 'migration must create status enum')
assert.ok(migration.includes('CREATE TABLE "balance_adjustment_requests"'), 'migration must create approval table')
assert.ok(migration.includes('CREATE UNIQUE INDEX "balance_adjustment_requests_balance_log_id_key"'), 'migration must enforce one balance log per request')

assert.ok(balanceDb.includes('async function changeBalanceInTransaction('), 'balance mutation must be reusable inside approval transaction')
assert.ok(balanceDb.includes('export async function createBalanceAdjustmentRequest('), 'missing create approval request db function')
assert.ok(balanceDb.includes('export async function getBalanceAdjustmentRequests('), 'missing approval request list db function')
assert.ok(balanceDb.includes('export async function approveBalanceAdjustmentRequest('), 'missing approval execution db function')
assert.ok(balanceDb.includes('export async function rejectBalanceAdjustmentRequest('), 'missing reject db function')
assert.ok(
  balanceDb.includes("where: { id: requestId, status: 'pending' }") &&
    balanceDb.includes("status: 'approved'") &&
    balanceDb.includes('changeBalanceInTransaction(tx, {') &&
    balanceDb.includes('balanceLogId: balanceResult.balanceLog.id'),
  'approval must atomically claim pending request, mutate balance, and bind balance log'
)
assert.ok(
  balanceDb.includes("status: 'rejected'") &&
    balanceDb.includes("where: { id: requestId, status: 'pending' }"),
  'rejection must only update pending requests'
)

assert.ok(balanceRoute.includes("'/admin/adjustment-requests'"), 'missing approval list route')
assert.ok(balanceRoute.includes("'/admin/:userId/adjustment-requests'"), 'missing approval create route')
assert.ok(balanceRoute.includes("'/admin/adjustment-requests/:requestId/approve'"), 'missing approval execute route')
assert.ok(balanceRoute.includes("'/admin/adjustment-requests/:requestId/reject'"), 'missing approval reject route')
assert.ok(balanceRoute.includes('normalizeAdminBalanceAdjustmentRequestInput(request.body)'), 'approval create route must validate request body')
assert.ok(balanceRoute.includes('normalizeAdminBalanceAdjustmentReviewInput(request.body, true)'), 'reject route must require review remark')
assert.ok(balanceRoute.includes('sendBalanceAdjustedEmail'), 'approval execution should notify user when email exists')

assert.ok(adminApi.includes('createBalanceAdjustmentRequest'), 'admin api must expose approval create')
assert.ok(adminApi.includes('getBalanceAdjustmentRequests'), 'admin api must expose approval list')
assert.ok(adminApi.includes('approveBalanceAdjustmentRequest'), 'admin api must expose approval execute')
assert.ok(adminApi.includes('rejectBalanceAdjustmentRequest'), 'admin api must expose approval reject')

assert.ok(adminOrdersView.includes('调账审批'), 'admin order center must render approval task list')
assert.ok(adminOrdersView.includes('requestPageSize = 7'), 'approval task list must be capped to seven rows per page')
assert.ok(adminOrdersView.includes('提交调账审批'), 'order detail must submit approval request')
assert.ok(adminOrdersView.includes('通过并执行'), 'approval list must expose execute action')
assert.ok(!adminOrdersView.includes('api.admin.adjustUserBalance'), 'order center must not directly mutate balance')

console.log('balance adjustment approval guards passed')
