import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const affDbSource = readFileSync(resolve(__dirname, '../src/db/aff.ts'), 'utf8')
const pointsDbSource = readFileSync(resolve(__dirname, '../src/db/points.ts'), 'utf8')
const affRouteSource = readFileSync(resolve(__dirname, '../src/routes/aff.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

function sectionFrom(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  return source.slice(start)
}

for (const [name, source] of [
  ['AFF', affDbSource],
  ['points', pointsDbSource]
] as const) {
  assert.ok(
    source.includes('function clampPagination(') &&
      source.includes('page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1') &&
      source.includes('Math.min(Math.max(pageSize, 1), maxPageSize)'),
    `${name} helpers must clamp invalid page/pageSize values`
  )
}

assert.ok(
  affDbSource.includes('const AFF_LOG_TYPES = new Set<AffLogType>') &&
    affDbSource.includes('function normalizeAffLogType(type: AffLogType | undefined): AffLogType | undefined') &&
    affDbSource.includes('const AFF_WITHDRAWAL_STATUSES = new Set<AffWithdrawalStatus>') &&
    affDbSource.includes('function normalizeAffWithdrawalStatus(status: AffWithdrawalStatus | undefined): AffWithdrawalStatus | undefined'),
  'AFF helpers must allowlist log types and withdrawal statuses before Prisma filters'
)

assert.ok(
  affRouteSource.includes('const AFF_ROUTE_MAX_PAGE_SIZE = 100') &&
    affRouteSource.includes('const AFF_REJECT_REASON_MAX_LENGTH = 500') &&
    affRouteSource.includes('function parseClampedPositiveQueryInteger(value: string | undefined, fallback: number, max: number): number | null') &&
    affRouteSource.includes('function parseOptionalAffLogType(value: string | undefined): AffLogType | null | undefined') &&
    affRouteSource.includes('function parseOptionalAffWithdrawalStatus(value: string | undefined): AffWithdrawalStatus | null | undefined') &&
    affRouteSource.includes('function normalizeRequiredText(value: unknown, maxLength: number): string | null'),
  'AFF routes must parse pagination, enum filters, and required text bodies before DB calls'
)

for (const [name, route, enumVariable] of [
  ['AFF log list', sectionBetween(affRouteSource, "}>('/me/logs'", '// 获取 AFF 收益榜单 TOP 10'), 'parsedType'],
  ['user AFF withdrawal list', sectionBetween(affRouteSource, "}>('/me/withdrawals'", '// ==================== 管理员 API'), 'parsedStatus'],
  ['admin AFF withdrawal list', sectionBetween(affRouteSource, "}>('/admin/withdrawals'", '// 审核通过转化申请'), 'parsedStatus']
] as const) {
  assert.ok(
    route.includes('const parsedPage = parseClampedPositiveQueryInteger(page, 1, Number.MAX_SAFE_INTEGER)') &&
      route.includes('const parsedPageSize = parseClampedPositiveQueryInteger(pageSize, 20, AFF_ROUTE_MAX_PAGE_SIZE)') &&
      route.includes(`${enumVariable} === null`) &&
      route.includes('return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))') &&
      route.includes('page: parsedPage') &&
      route.includes('pageSize: parsedPageSize'),
    `${name} must reject malformed pagination and enum filters at the route boundary`
  )
}

assert.ok(
  !affRouteSource.includes('page: Number(page)') &&
    !affRouteSource.includes('pageSize: Number(pageSize)') &&
    !affRouteSource.includes('type: type as any') &&
    !affRouteSource.includes('status: status as any'),
  'AFF routes must not rely on loose Number parsing or any-cast enum filters'
)

const rejectWithdrawalRoute = sectionFrom(affRouteSource, "}>('/admin/withdrawals/:withdrawalId/reject'")
assert.ok(
  rejectWithdrawalRoute.includes('const { reason: rawReason } = request.body') &&
    rejectWithdrawalRoute.includes('const reason = normalizeRequiredText(rawReason, AFF_REJECT_REASON_MAX_LENGTH)') &&
    rejectWithdrawalRoute.includes('if (!reason)') &&
    rejectWithdrawalRoute.includes('return reply.code(400).send({ error: \'请填写拒绝原因\' })'),
  'AFF withdrawal rejection must reject missing, non-string, blank, or oversized reasons before DB writes'
)
assert.ok(
  rejectWithdrawalRoute.includes('db.rejectAffWithdrawal(withdrawalId, user.id, reason)') &&
    rejectWithdrawalRoute.includes('reason }') &&
    !rejectWithdrawalRoute.includes('reason.trim()'),
  'AFF withdrawal rejection must persist, notify, and log only the normalized reason'
)

assert.ok(
  pointsDbSource.includes('const POINTS_LOG_TYPES = new Set<PointsLogType>') &&
    pointsDbSource.includes('function normalizePointsLogType(type: PointsLogType | undefined): PointsLogType | undefined') &&
    pointsDbSource.includes('const USER_POINTS_ORDER_BY_FIELDS = new Set') &&
    pointsDbSource.includes('function normalizeUserPointsOrderBy(orderBy: string | undefined)') &&
    pointsDbSource.includes('function normalizeSortOrder(order: string | undefined)'),
  'points helpers must allowlist log types, orderBy fields, and sort directions before Prisma queries'
)

for (const [helperName, source, endMarker] of [
  ['getAffLogs', affDbSource, '/**\n * 获取用户 AFF 统计'],
  ['getUserAffWithdrawals', affDbSource, '// ==================== 管理员操作'],
  ['getPendingAffWithdrawals', affDbSource, '/**\n * 审核通过转化申请'],
  ['getPointsLogs', pointsDbSource, '/**\n * 获取所有用户积分列表'],
  ['getAllUserPoints', pointsDbSource, null]
] as const) {
  const helperSection = endMarker === null
    ? sectionFrom(source, `export async function ${helperName}(`)
    : sectionBetween(source, `export async function ${helperName}(`, endMarker)

  assert.ok(
    helperSection.includes('const { page, pageSize } = clampPagination(options.page, options.pageSize)') &&
      helperSection.includes('const skip = (page - 1) * pageSize') &&
      helperSection.includes('take: pageSize') &&
      helperSection.includes('page') &&
      helperSection.includes('pageSize'),
    `${helperName} must query with sanitized pagination values and return sanitized metadata`
  )
}

assert.ok(
  sectionBetween(affDbSource, 'export async function getAffLogs(', '/**\n * 获取用户 AFF 统计')
    .includes('const type = normalizeAffLogType(options.type)'),
  'getAffLogs must normalize invalid AFF log types'
)

for (const helperName of ['getUserAffWithdrawals', 'getPendingAffWithdrawals'] as const) {
  assert.ok(
    sectionBetween(
      affDbSource,
      `export async function ${helperName}(`,
      helperName === 'getUserAffWithdrawals'
        ? '// ==================== 管理员操作'
        : '/**\n * 审核通过转化申请'
    ).includes('const status = normalizeAffWithdrawalStatus(options.status)'),
    `${helperName} must normalize invalid withdrawal statuses`
  )
}

assert.ok(
  sectionBetween(pointsDbSource, 'export async function getPointsLogs(', '/**\n * 获取所有用户积分列表')
    .includes('const type = normalizePointsLogType(options.type)'),
  'getPointsLogs must normalize invalid points log types'
)

assert.ok(
  sectionFrom(pointsDbSource, 'export async function getAllUserPoints(')
    .includes('const orderBy = normalizeUserPointsOrderBy(options.orderBy)') &&
    sectionFrom(pointsDbSource, 'export async function getAllUserPoints(')
      .includes('const order = normalizeSortOrder(options.order)') &&
    sectionFrom(pointsDbSource, 'export async function getAllUserPoints(')
      .includes('const keyword = search.trim().slice(0, 128)'),
  'getAllUserPoints must normalize sorting and cap search input'
)

assert.ok(
  affDbSource.includes('if (!Number.isFinite(amount) || amount < 0.1)') &&
    affRouteSource.includes("if (!amount || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0)"),
  'AFF conversion must reject non-finite amounts before balance mutation'
)

console.log('AFF and points query guard tests passed')
