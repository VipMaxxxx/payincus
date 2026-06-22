import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const balanceSource = readFileSync(resolve(__dirname, '../src/db/balance.ts'), 'utf8')
const balanceRouteSource = readFileSync(resolve(__dirname, '../src/routes/balance.ts'), 'utf8')

const changeBalanceStart = balanceSource.indexOf('export async function changeBalance(')
assert.notEqual(changeBalanceStart, -1, 'missing changeBalance function')
const changeBalanceEnd = balanceSource.indexOf('/**\n * 充值到账', changeBalanceStart)
assert.notEqual(changeBalanceEnd, -1, 'missing changeBalance end marker')
const changeBalanceSection = balanceSource.slice(changeBalanceStart, changeBalanceEnd)

assert.ok(
  balanceSource.includes("throw new Error('余额变动金额无效')"),
  'changeBalance must return a clear invalid-amount error'
)
assert.ok(
  balanceSource.includes('const MAX_BALANCE_AMOUNT = 99999999.99'),
  'balance changes must define an upper bound matching Decimal(10,2) storage'
)
assert.ok(
  balanceSource.includes('function normalizeBalanceAmount(value: number): number') &&
    balanceSource.includes('const normalized = Number(value.toFixed(2))') &&
    balanceSource.includes('normalized === 0 || Math.abs(normalized) > MAX_BALANCE_AMOUNT'),
  'balance changes must normalize to cents and reject values outside database precision before mutating'
)
assert.ok(
  changeBalanceSection.includes('const normalizedAmount = normalizeBalanceAmount(amount)'),
  'changeBalance must normalize the input amount once before the transaction'
)
assert.ok(
  changeBalanceSection.includes('const balanceAfter = Number((balanceBefore + normalizedAmount).toFixed(2))') &&
    changeBalanceSection.includes('Math.abs(balanceAfter) > MAX_BALANCE_AMOUNT'),
  'changeBalance must validate the resulting balance against Decimal(10,2) limits'
)
assert.ok(
  changeBalanceSection.includes('data: { balance: { increment: normalizedAmount } }') &&
    changeBalanceSection.includes('amount: normalizedAmount'),
  'changeBalance must use the normalized amount for both the balance mutation and balance log'
)
assert.ok(
  balanceRouteSource.includes("typeof amount !== 'number' || !Number.isFinite(amount)"),
  'admin balance routes must reject non-finite JSON numbers before calling changeBalance'
)
assert.ok(
  balanceRouteSource.includes('const ADMIN_BALANCE_REMARK_MAX_LENGTH = 500') &&
    balanceRouteSource.includes('function isPlainRecord(value: unknown): value is Record<string, unknown>') &&
    balanceRouteSource.includes('function normalizeAdminBalanceRemark(value: unknown, required: boolean, field: string): string | undefined') &&
    balanceRouteSource.includes('function normalizeAdminBalanceAdjustInput(input: unknown): AdminBalanceAdjustInput') &&
    balanceRouteSource.includes('function normalizeAdminBalanceGiftInput(input: unknown): AdminBalanceGiftInput'),
  'admin balance mutation routes must validate runtime body shape and remarks before accounting writes'
)
assert.ok(
  balanceRouteSource.includes('remark.length > ADMIN_BALANCE_REMARK_MAX_LENGTH') &&
    balanceRouteSource.includes("throw { error: `${field}必须是字符串` }") &&
    balanceRouteSource.includes("throw { error: '请求参数无效' }"),
  'admin balance remarks must be string-typed, trimmed, bounded, and guarded behind plain-object body checks'
)
assert.ok(
  !balanceRouteSource.includes("typeof amount !== 'number' || isNaN(amount)"),
  'admin balance routes must not rely on isNaN, which accepts Infinity'
)

assert.ok(
  balanceRouteSource.includes("import type { BalanceLogType, BillingRecordType } from '@prisma/client'"),
  'balance routes must type query filters against Prisma enums'
)

assert.ok(
  balanceRouteSource.includes('const BALANCE_LOG_TYPES = new Set<BalanceLogType>([') &&
  balanceRouteSource.includes("'hosting_deduction'") &&
  balanceRouteSource.includes("'invite_generate'"),
  'balance log filters must be allowlisted before DB reads'
)

assert.ok(
  balanceRouteSource.includes('const BILLING_RECORD_TYPES = new Set<BillingRecordType>([') &&
  balanceRouteSource.includes("'newPurchase'") &&
  balanceRouteSource.includes("'transfer_fee'"),
  'billing record filters must be allowlisted before DB reads'
)

assert.ok(
  balanceRouteSource.includes('function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number') &&
  balanceRouteSource.includes('function normalizeBalanceLogType(value: string | undefined): BalanceLogType | undefined') &&
  balanceRouteSource.includes('function normalizeBillingRecordType(value: string | undefined): BillingRecordType | undefined'),
  'balance routes must define strict pagination and enum-normalization helpers'
)

const userBalanceLogsStart = balanceRouteSource.indexOf("}>('/me/logs'")
assert.notEqual(userBalanceLogsStart, -1, 'missing user balance logs route')
const userBalanceLogsEnd = balanceRouteSource.indexOf('  // 获取当前用户计费记录', userBalanceLogsStart)
assert.notEqual(userBalanceLogsEnd, -1, 'missing user balance logs route end marker')
const userBalanceLogsRoute = balanceRouteSource.slice(userBalanceLogsStart, userBalanceLogsEnd)

assert.ok(
  userBalanceLogsRoute.includes('page: parsePositiveIntegerQuery(page, 1)') &&
  userBalanceLogsRoute.includes('pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100)') &&
  userBalanceLogsRoute.includes('type: normalizeBalanceLogType(type)'),
  'user balance logs route must normalize pagination and type before DB reads'
)

const userBillingStart = balanceRouteSource.indexOf("}>('/me/billing'")
assert.notEqual(userBillingStart, -1, 'missing user billing route')
const userBillingEnd = balanceRouteSource.indexOf('  // ==================== 管理员余额管理 API ====================', userBillingStart)
assert.notEqual(userBillingEnd, -1, 'missing user billing route end marker')
const userBillingRoute = balanceRouteSource.slice(userBillingStart, userBillingEnd)

assert.ok(
  userBillingRoute.includes('page: parsePositiveIntegerQuery(page, 1)') &&
  userBillingRoute.includes('pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100)') &&
  userBillingRoute.includes('type: normalizeBillingRecordType(type)'),
  'user billing route must normalize pagination and type before DB reads'
)

const adminBalanceLogsStart = balanceRouteSource.indexOf("}>('/admin/:userId/logs'")
assert.notEqual(adminBalanceLogsStart, -1, 'missing admin balance logs route')
const adminBalanceLogsEnd = balanceRouteSource.indexOf('  // 管理员调整用户余额', adminBalanceLogsStart)
assert.notEqual(adminBalanceLogsEnd, -1, 'missing admin balance logs route end marker')
const adminBalanceLogsRoute = balanceRouteSource.slice(adminBalanceLogsStart, adminBalanceLogsEnd)

assert.ok(
  adminBalanceLogsRoute.includes('page: parsePositiveIntegerQuery(page, 1)') &&
  adminBalanceLogsRoute.includes('pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100)') &&
  adminBalanceLogsRoute.includes('type: normalizeBalanceLogType(type)'),
  'admin balance logs route must normalize pagination and type before DB reads'
)

for (const [routeName, routeSource] of [
  ['user balance logs', userBalanceLogsRoute],
  ['user billing', userBillingRoute],
  ['admin balance logs', adminBalanceLogsRoute]
] as const) {
  for (const unsafePattern of [
    'Math.min(Number(pageSize) || 20, 100)',
    'page: Number(page)',
    'page: Number(page) || 1',
    'pageSize: Number(pageSize)',
    'type: type as any'
  ]) {
    assert.ok(
      !routeSource.includes(unsafePattern),
      `${routeName} route must not use unsafe query handling: ${unsafePattern}`
    )
  }
}

const adminAdjustStart = balanceRouteSource.indexOf("}>('/admin/:userId/adjust'")
assert.notEqual(adminAdjustStart, -1, 'missing admin balance adjust route')
const adminAdjustEnd = balanceRouteSource.indexOf('  // 管理员赠送余额', adminAdjustStart)
assert.notEqual(adminAdjustEnd, -1, 'missing admin balance adjust route end marker')
const adminAdjustRoute = balanceRouteSource.slice(adminAdjustStart, adminAdjustEnd)

assert.ok(
  adminAdjustRoute.includes('balanceInput = normalizeAdminBalanceAdjustInput(request.body)') &&
    adminAdjustRoute.includes('const { amount, remark } = balanceInput') &&
    adminAdjustRoute.includes('`[管理员 ${user.username}] ${remark}`'),
  'admin balance adjust route must use normalized amount and remark before accounting writes'
)
assert.ok(
  !adminAdjustRoute.includes('const { amount, remark } = request.body') &&
    !adminAdjustRoute.includes('remark.trim()'),
  'admin balance adjust route must not destructure raw typed bodies or trim remarks inline'
)

const adminGiftStart = balanceRouteSource.indexOf("}>('/admin/:userId/gift'")
assert.notEqual(adminGiftStart, -1, 'missing admin balance gift route')
const adminGiftEnd = balanceRouteSource.indexOf('\n}', adminGiftStart)
assert.notEqual(adminGiftEnd, -1, 'missing admin balance gift route end marker')
const adminGiftRoute = balanceRouteSource.slice(adminGiftStart, adminGiftEnd)

assert.ok(
  adminGiftRoute.includes('balanceInput = normalizeAdminBalanceGiftInput(request.body)') &&
    adminGiftRoute.includes('const { amount, remark } = balanceInput') &&
    adminGiftRoute.includes('remark || `管理员 ${user.username} 赠送`'),
  'admin balance gift route must use normalized amount and optional remark before accounting writes'
)
assert.ok(
  !adminGiftRoute.includes('const { amount, remark } = request.body'),
  'admin balance gift route must not destructure raw typed bodies'
)

console.log('balance change amount guard tests passed')
