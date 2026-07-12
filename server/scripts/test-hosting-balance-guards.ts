import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const billingSource = readFileSync(resolve(__dirname, '../src/db/billing-operations.ts'), 'utf8')
const schedulerSource = readFileSync(resolve(__dirname, '../src/services/hosting-scheduler.ts'), 'utf8')
const hostingRouteSource = readFileSync(resolve(__dirname, '../src/routes/hosting.ts'), 'utf8')
const usersRouteSource = readFileSync(resolve(__dirname, '../src/routes/users.ts'), 'utf8')

assert.ok(
  usersRouteSource.includes('!Number.isFinite(amount)') &&
    usersRouteSource.includes('Amount must be a finite non-zero number') &&
    usersRouteSource.includes('const MAX_HOSTING_BALANCE_ADJUST_AMOUNT = 99999999.99') &&
    usersRouteSource.includes('Math.abs(amount) > MAX_HOSTING_BALANCE_ADJUST_AMOUNT'),
  'admin hosting-balance adjustment must reject non-finite and oversized amounts'
)

assert.ok(
  usersRouteSource.includes('const MAX_HOSTING_BALANCE_ADJUST_REASON_LENGTH = 500') &&
    usersRouteSource.includes("const normalizedReason = typeof reason === 'string' ? reason.trim() : ''") &&
    usersRouteSource.includes('normalizedReason.length > MAX_HOSTING_BALANCE_ADJUST_REASON_LENGTH') &&
    usersRouteSource.includes("const ADMIN_HOSTING_BALANCE_ADJUST_REMARK_PREFIX = '[Admin]'") &&
    usersRouteSource.includes('remark: `${ADMIN_HOSTING_BALANCE_ADJUST_REMARK_PREFIX} ${normalizedReason}`') &&
    usersRouteSource.includes('remark: `[Admin Frozen] ${normalizedReason}`') &&
    usersRouteSource.includes('remark: `[Admin Frozen Deduct] ${normalizedReason} (¥${absAmount.toFixed(2)})`') &&
    usersRouteSource.includes('reason=${normalizedReason}'),
  'admin hosting-balance adjustment must trim and bound audit reasons before persistence/logging'
)

assert.ok(
  hostingRouteSource.includes("const ADMIN_HOSTING_BALANCE_ADJUST_REMARK_PREFIX = '[Admin]'") &&
    hostingRouteSource.includes('const OPERATING_HOSTING_INCOME_WHERE = {') &&
    hostingRouteSource.includes('{ remark: null }') &&
    hostingRouteSource.includes('{ NOT: { remark: { startsWith: ADMIN_HOSTING_BALANCE_ADJUST_REMARK_PREFIX } } }') &&
    (hostingRouteSource.match(/\.\.\.OPERATING_HOSTING_INCOME_WHERE/g) || []).length === 4,
  'admin available hosting-balance grants must be excluded from total income, VIP income, and operating-income history'
)

const hostingBalanceLogsStart = usersRouteSource.indexOf("}>('/:id/hosting-balance/logs'")
assert.notEqual(hostingBalanceLogsStart, -1, 'hosting-balance logs route not found')
const hostingBalanceLogsEnd = usersRouteSource.indexOf('// 调整用户托管余额（管理员）', hostingBalanceLogsStart)
assert.notEqual(hostingBalanceLogsEnd, -1, 'hosting-balance logs route end marker not found')
const hostingBalanceLogsRoute = usersRouteSource.slice(hostingBalanceLogsStart, hostingBalanceLogsEnd)

assert.ok(
  hostingBalanceLogsRoute.includes('const pageNum = parsePositiveIntegerQuery(page, 1)') &&
    hostingBalanceLogsRoute.includes('const size = parseClampedPositiveIntegerQuery(pageSize, 20, 100)') &&
    hostingBalanceLogsRoute.includes('const skip = (pageNum - 1) * size') &&
    !hostingBalanceLogsRoute.includes('parseInt('),
  'admin hosting-balance logs route must strictly parse pagination before Prisma skip/take'
)

assert.ok(
  hostingRouteSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    hostingRouteSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    hostingRouteSource.includes('Number.isSafeInteger(parsed)') &&
    hostingRouteSource.includes('const blockedUserId = parsePositiveRouteId(request.params.userId)'),
  'hosting block delete route must reject malformed, zero, and unsafe user IDs'
)

assert.ok(
  hostingRouteSource.includes('function parsePositiveIntegerQuery(value: string | undefined, fallback: number): number') &&
    hostingRouteSource.includes('function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number') &&
    hostingRouteSource.includes('const safePageSize = parseClampedPositiveIntegerQuery(pageSize, 30, 100)') &&
    hostingRouteSource.includes('const pageNum = parsePositiveIntegerQuery(page, 1)') &&
    hostingRouteSource.includes('const safePageSize = parseClampedPositiveIntegerQuery(pageSize, 20, 100)') &&
    hostingRouteSource.includes('const safeStatus = normalizeWithdrawalStatus(status)') &&
    hostingRouteSource.includes('const safeActionType = normalizeHostingActionType(actionType)') &&
    hostingRouteSource.includes('const searchTerm = normalizeSearch(search, 128)'),
  'hosting logs and withdrawal routes must strictly parse pagination, cap search, and allowlist filters'
)

assert.ok(
  hostingRouteSource.includes("const { amount, target = 'balance' } = request.body") &&
    hostingRouteSource.includes("const isBalanceTransfer = target === 'balance'") &&
    hostingRouteSource.includes("status: isBalanceTransfer ? 'completed' : 'pending'") &&
    hostingRouteSource.includes("data: { balance: { increment: actualAmount } }") &&
    hostingRouteSource.includes("usdtAddress: isBalanceTransfer ? null : usdtAddress"),
  'hosting withdrawals must keep balance transfers immediate while cash withdrawals enter pending review'
)

assert.ok(
  hostingRouteSource.includes("status: 'pending'") &&
    hostingRouteSource.includes('pendingWithdrawal: Number(pendingWithdrawalResult._sum.amount || 0)'),
  'hosting balance must calculate pending withdrawals from live pending records'
)

assert.ok(
  hostingRouteSource.includes("where: { id: withdrawalId, target: 'usdt', status: 'pending' }") &&
    hostingRouteSource.includes("status: 'rejected'") &&
    hostingRouteSource.includes('data: { hostingBalance: { increment: refundAmount } }') &&
    hostingRouteSource.includes('amount: refundAmount') &&
    hostingRouteSource.includes('relatedId: withdrawal.id') &&
    hostingRouteSource.includes('if (rejected.count !== 1) return null'),
  'cash withdrawal rejection must be conditionally claimed and refund the exact frozen amount once'
)

for (const forbiddenPattern of [
  'Number(request.params.userId)',
  'Number.isNaN(blockedUserId)',
  'Number(page) || 1',
  'Number(pageSize) ||',
  'baseWhere.actionType = actionType',
  'where.status = status'
] as const) {
  assert.ok(
    !hostingRouteSource.includes(forbiddenPattern),
    `hosting routes must not use loose parsing or raw enum filters: ${forbiddenPattern}`
  )
}

assert.ok(
  schedulerSource.includes('[...lockedAmounts.keys()].sort((a, b) => a - b)') &&
    schedulerSource.includes('tryAdvisoryTransactionLock(tx, HOSTING_BALANCE_LOG_LOCK_NAMESPACE, userId)'),
  'hosting unfreeze job must acquire per-user hosting-balance locks in deterministic order'
)

assert.ok(
  billingSource.includes('const HOSTING_FREEZE_DAYS = 30') &&
    (billingSource.match(/new Date\(Date\.now\(\) \+ HOSTING_FREEZE_DAYS \* 24 \* 60 \* 60 \* 1000\)/g) || []).length === 3 &&
    !billingSource.includes('const unfreezeAt = addMonths(new Date(), 1)'),
  'hosting income must freeze for exactly 30 days instead of one calendar month'
)

assert.ok(
  billingSource.includes('tryAdvisoryTransactionLock(client, HOSTING_BALANCE_LOG_LOCK_NAMESPACE, hostOwnerId)') &&
    billingSource.includes('tryAdvisoryTransactionLock(client, USER_BALANCE_LOCK_NAMESPACE, hostOwnerId)'),
  'hosted instance destruction must lock both hosting balance and panel balance before deductions'
)

assert.ok(
  billingSource.includes('const hostingBalanceUpdateResult = await client.user.updateMany({') &&
    billingSource.includes('hostingBalance: { gte: deductFromAvailable }') &&
    billingSource.includes("throw new Error('托管余额不足，请稍后重试')"),
  'hosted instance destruction must conditionally decrement available hosting balance'
)

assert.ok(
  billingSource.includes('const balanceUpdateResult = await client.user.updateMany({') &&
    billingSource.includes('balance: { gte: deductFromBalance }') &&
    billingSource.includes("throw new Error('余额不足，请稍后重试')") &&
    billingSource.includes('const updatedUser = await client.user.findUniqueOrThrow({'),
  'hosted instance destruction must conditionally decrement panel balance before writing balance logs'
)

const shortfallDebtStart = billingSource.indexOf('const shortfall = remainingToDeduct')
assert.notEqual(shortfallDebtStart, -1, 'hosting-balance shortfall debt block not found')
const shortfallDebtEnd = billingSource.indexOf('const totalDeducted =', shortfallDebtStart)
assert.notEqual(shortfallDebtEnd, -1, 'hosting-balance total deduction calculation not found')
const shortfallDebtBlock = billingSource.slice(shortfallDebtStart, shortfallDebtEnd)

assert.ok(
  shortfallDebtBlock.includes('data: { hostingBalance: { decrement: shortfall } }') &&
    shortfallDebtBlock.includes('shortfallDebt = shortfall') &&
    !shortfallDebtBlock.includes('gte:') &&
    billingSource.includes('const totalDeducted = fromFrozen + fromAvailable + fromBalance + shortfallDebt') &&
    billingSource.includes('amount: -totalDeducted') &&
    billingSource.includes('回扣缺口记欠款 ¥${shortfallDebt.toFixed(2)}'),
  'hosted instance deduction shortfall must become host-owner hosting-balance debt instead of a platform loss'
)

console.log('hosting balance guard checks passed')
