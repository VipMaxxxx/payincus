import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const balanceDbSource = readFileSync(resolve(__dirname, '../src/db/balance.ts'), 'utf8')
const billingRecordsDbSource = readFileSync(resolve(__dirname, '../src/db/billing-records.ts'), 'utf8')
const rechargeRecordsDbSource = readFileSync(resolve(__dirname, '../src/db/recharge-records.ts'), 'utf8')
const adminBillingRouteSource = readFileSync(resolve(__dirname, '../src/routes/admin-billing.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

for (const [name, source, normalizer] of [
  ['balance logs', balanceDbSource, 'normalizeBalanceLogType(options.type)'],
  ['billing records', billingRecordsDbSource, 'normalizeBillingRecordType(options.type)'],
  ['recharge records', rechargeRecordsDbSource, 'normalizeRechargeStatus(options.status)']
] as const) {
  assert.ok(
    source.includes('function clampPagination(') &&
      source.includes('page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1') &&
      source.includes('Math.min(Math.max(pageSize, 1), maxPageSize)'),
    `${name} DB helper must clamp invalid page/pageSize values`
  )

  assert.ok(
    source.includes(normalizer) &&
      source.includes('new Set') &&
      !source.includes('const { page = 1, pageSize = 20'),
    `${name} DB helper must allowlist enum filters before building Prisma where clauses`
  )
}

for (const [helperName, source] of [
  ['getBalanceLogs', balanceDbSource],
  ['getInstanceBillingRecords', billingRecordsDbSource],
  ['getUserBillingRecords', billingRecordsDbSource],
  ['getUserRechargeRecords', rechargeRecordsDbSource],
  ['getAllRechargeRecords', rechargeRecordsDbSource]
] as const) {
  const helperSection = sectionBetween(
    source,
    `export async function ${helperName}(`,
    helperName === 'getBalanceLogs'
      ? '// ==================== 余额变动操作'
      : helperName === 'getInstanceBillingRecords'
        ? '/**\n * 获取用户的所有计费记录'
        : helperName === 'getUserBillingRecords'
          ? '// ==================== 创建操作'
          : helperName === 'getUserRechargeRecords'
            ? '/**\n * 获取所有充值记录'
            : '// ==================== 创建操作'
  )

  assert.ok(
    helperSection.includes('const { page, pageSize } = clampPagination(options.page, options.pageSize)') &&
      helperSection.includes('const skip = (page - 1) * pageSize') &&
      helperSection.includes('take: pageSize') &&
      helperSection.includes('page,') &&
      helperSection.includes('pageSize'),
    `${helperName} must query with sanitized pagination values and return sanitized metadata`
  )
}

assert.ok(
  adminBillingRouteSource.includes('function parsePositiveInteger(value: string | undefined, fallback: number, max?: number): number') &&
    adminBillingRouteSource.includes('function parseOptionalPositiveInteger(value: string | undefined): number | undefined') &&
    adminBillingRouteSource.includes('function normalizeStringFilter(value: string | undefined, allowedValues: Set<string>): string | undefined') &&
    adminBillingRouteSource.includes('const BILLING_RECORD_TYPES = new Set') &&
    adminBillingRouteSource.includes('const INSTANCE_STATUSES = new Set') &&
    adminBillingRouteSource.includes('const RECHARGE_STATUSES = new Set'),
  'admin billing routes must define shared safe parsers and enum allowlists'
)

const adminRecordsRoute = sectionBetween(
  adminBillingRouteSource,
  "app.get('/api/admin/billing/records'",
  '  // ==================== 管理员封停/解封'
)
const paidInstancesRoute = sectionBetween(
  adminBillingRouteSource,
  "app.get('/api/admin/billing/instances'",
  '  // ==================== 充值记录管理'
)
const rechargeRecordsRoute = sectionBetween(
  adminBillingRouteSource,
  "app.get('/api/admin/billing/recharge-records'",
  "  // POST /api/admin/billing/recharge-records/:id/sync"
)

assert.ok(
  adminRecordsRoute.includes('const pageNum = parsePositiveInteger(page, 1)') &&
    adminRecordsRoute.includes('const size = parsePositiveInteger(pageSize, 20, 100)') &&
    adminRecordsRoute.includes('const normalizedType = normalizeStringFilter(type, BILLING_RECORD_TYPES)') &&
    adminRecordsRoute.includes('const parsedUserId = parseOptionalPositiveInteger(userId)') &&
    adminRecordsRoute.includes('const parsedInstanceId = parseOptionalPositiveInteger(instanceId)'),
  'admin billing records route must sanitize pagination, enum type, userId, and instanceId filters'
)

assert.ok(
  paidInstancesRoute.includes('const pageNum = parsePositiveInteger(page, 1)') &&
    paidInstancesRoute.includes('const size = parsePositiveInteger(pageSize, 20, 100)') &&
    paidInstancesRoute.includes('const normalizedStatus = normalizeStringFilter(status, INSTANCE_STATUSES)') &&
    paidInstancesRoute.includes('const hostIdNum = parseOptionalPositiveInteger(hostId)') &&
    paidInstancesRoute.includes('const keyword = search.trim().slice(0, 128)'),
  'admin paid instances route must sanitize pagination, status, hostId, and search filters'
)

assert.ok(
  rechargeRecordsRoute.includes('const pageNum = parsePositiveInteger(page, 1)') &&
    rechargeRecordsRoute.includes('const size = parsePositiveInteger(pageSize, 20, 100)') &&
    rechargeRecordsRoute.includes('const normalizedStatus = normalizeStringFilter(status, RECHARGE_STATUSES)') &&
    rechargeRecordsRoute.includes('const parsedUserId = parseOptionalPositiveInteger(userId)'),
  'admin recharge records route must sanitize pagination, status, and userId filters'
)

console.log('billing query guard tests passed')
