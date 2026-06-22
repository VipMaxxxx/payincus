import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/admin-entertainment.ts'), 'utf8')
const lotteryDbSource = readFileSync(resolve(process.cwd(), 'src/db/lottery.ts'), 'utf8')
const pointsDbSource = readFileSync(resolve(process.cwd(), 'src/db/points.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'admin entertainment routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  routeSource.match(/const lotteryId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  5,
  'admin lottery update/delete/detail/prize-create/notification routes must strictly validate lottery IDs'
)

assert.equal(
  routeSource.match(/const prizeId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  2,
  'admin prize update/delete routes must strictly validate prize IDs'
)

assert.equal(
  routeSource.match(/const userId = parsePositiveRouteId\(request\.params\.userId\)/g)?.length ?? 0,
  3,
  'admin user points adjust/detail/log routes must strictly validate user IDs'
)

assert.ok(
  routeSource.includes('const recordId = parsePositiveRouteId(request.params.id)') &&
    routeSource.includes('const ticketId = parseOptionalPositiveBodyId(request.body.ticketId)') &&
    routeSource.includes("return reply.code(400).send({ error: 'INVALID_TICKET_ID', message: 'Invalid ticket ID' })"),
  'admin lottery prize delivery route must strictly validate record and ticket IDs'
)

assert.ok(
  routeSource.includes('function parsePositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number') &&
    routeSource.match(/page: parsePositiveIntegerQuery\(page, 1, 100000\)/g)?.length === 4 &&
    routeSource.match(/pageSize: parsePositiveIntegerQuery\(pageSize, 20, 100\)/g)?.length === 4,
  'admin entertainment list routes must clamp pagination before DB access'
)

assert.ok(
  routeSource.includes('const LOTTERY_PRIZE_TYPES = new Set<LotteryPrizeType>') &&
    routeSource.includes('function parseLotteryPrizeType(value: unknown): LotteryPrizeType | null') &&
    routeSource.includes('function parseOptionalLotteryPrizeType(value: string | undefined): LotteryPrizeType | undefined | null') &&
    routeSource.includes("return reply.code(400).send({ error: 'INVALID_PRIZE_TYPE', message: 'Invalid prize type' })"),
  'admin lottery prize routes and record filters must validate prize types'
)

assert.ok(
  routeSource.includes('const LOTTERY_RECORD_STATUSES = new Set<LotteryRecordStatus>') &&
    routeSource.includes('function parseOptionalLotteryRecordStatus(value: string | undefined): LotteryRecordStatus | undefined | null') &&
    routeSource.includes("return reply.code(400).send({ error: 'INVALID_STATUS', message: 'Invalid record status' })"),
  'admin lottery record filters must validate record status'
)

assert.ok(
  routeSource.includes('const NOTIFICATION_TYPES = new Set([\'telegram\', \'discord\', \'webhook\'])') &&
    routeSource.includes('function parseNotificationType(value: unknown): string | null') &&
    routeSource.includes('type: notificationType'),
  'admin lottery notification route must validate notification type before persistence'
)

assert.ok(
  routeSource.includes('const MAX_POINTS_ADJUST_AMOUNT = 1_000_000') &&
    routeSource.includes('const parsedAmount = parseIntegerBody(amount)') &&
    routeSource.includes('Math.abs(parsedAmount) > MAX_POINTS_ADJUST_AMOUNT') &&
    routeSource.includes('parsedAmount,') &&
    routeSource.includes('USER_POINTS_ORDER_BY_FIELDS') &&
    routeSource.includes('SORT_ORDERS'),
  'admin user points routes must validate adjustment amount and sort options'
)

assert.ok(
  routeSource.includes('parseOptionalPositiveBodyId(totalQuantity)') &&
    routeSource.includes('parseOptionalNonNegativeIntegerBody(remainQuantity)') &&
    routeSource.includes("return reply.code(400).send({ error: 'INVALID_VALUE', message: 'Prize value must be a non-negative integer' })"),
  'admin prize mutation routes must validate inventory and prize values'
)

for (const forbiddenPattern of [
  'Number(request.params.id)',
  'Number(request.params.userId)',
  'Number(request.query',
  'Number(request.body',
  'isNaN(',
  'page: Number(page)',
  'pageSize: Number(pageSize)',
  'lotteryId: lotteryId ? Number(lotteryId) : undefined',
  'prizeType: prizeType as LotteryPrizeType | undefined',
  'status: status as LotteryRecordStatus | undefined',
  "orderBy: orderBy as 'points' | 'totalEarned' | 'totalSpent'",
  "order: order as 'asc' | 'desc'"
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `admin entertainment routes must not keep loose parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  lotteryDbSource.includes('function clampPagination(') &&
    lotteryDbSource.includes('function normalizeLotteryPrizeType(type: LotteryPrizeType | undefined): LotteryPrizeType | undefined') &&
    lotteryDbSource.includes('function normalizeLotteryRecordStatus(status: LotteryRecordStatus | undefined): LotteryRecordStatus | undefined') &&
    lotteryDbSource.includes('const { page, pageSize } = clampPagination(options.page, options.pageSize)') &&
    lotteryDbSource.includes('const search = typeof options.search === \'string\' ? options.search.trim().slice(0, 128) : undefined'),
  'lottery admin DB helpers must clamp pagination and normalize filters'
)

assert.ok(
  pointsDbSource.includes('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)') &&
    pointsDbSource.includes('type: \'admin_adjust\'') &&
    pointsDbSource.includes('if (amount < 0 && userPoints.points + amount < 0)'),
  'admin points adjustment DB helper must keep the points lock and non-negative balance guard'
)

console.log('admin entertainment route guard tests passed')
