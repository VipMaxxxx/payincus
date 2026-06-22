import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/entertainment.ts'), 'utf8')
const lotteryDbSource = readFileSync(resolve(process.cwd(), 'src/db/lottery.ts'), 'utf8')
const badgesDbSource = readFileSync(resolve(process.cwd(), 'src/db/badges.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'entertainment routes must use a strict positive safe-integer route ID parser'
)

assert.equal(
  routeSource.match(/const lotteryId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  3,
  'lottery detail, draw, and multi-draw routes must strictly validate lottery IDs'
)

assert.ok(
  routeSource.includes('function parsePositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number') &&
    routeSource.includes('page: parsePositiveIntegerQuery(page, 1, 100000)') &&
    routeSource.includes('pageSize: parsePositiveIntegerQuery(pageSize, 20, 100)'),
  'entertainment list routes must clamp pagination before DB access'
)

assert.ok(
  routeSource.includes('const POINTS_LOG_TYPES = new Set<PointsLogType>') &&
    routeSource.includes('function parsePointsLogType(value: string | undefined): PointsLogType | undefined | null') &&
    routeSource.includes("return reply.code(400).send({ error: 'INVALID_POINTS_LOG_TYPE', message: 'Invalid points log type' })"),
  'points log route must reject unsupported log types'
)

assert.ok(
  routeSource.includes('const LOTTERY_PRIZE_TYPES = new Set<LotteryPrizeType>') &&
    routeSource.includes('function parseLotteryPrizeType(value: string | undefined): LotteryPrizeType | undefined | null') &&
    routeSource.includes("return reply.code(400).send({ error: 'INVALID_PRIZE_TYPE', message: 'Invalid prize type' })"),
  'lottery record route must reject unsupported prize types'
)

assert.ok(
  routeSource.includes('function parsePositiveBodyId(value: unknown): number | null') &&
    routeSource.includes('Number.isSafeInteger(value)'),
  'badge apply routes must strictly validate body IDs'
)

assert.equal(
  routeSource.match(/const ownershipId = parsePositiveBodyId\(request\.body\.ownershipId\)/g)?.length ?? 0,
  3,
  'badge avatar apply, instance apply, and unapply routes must validate ownership IDs'
)

assert.equal(
  routeSource.match(/const instanceId = parsePositiveBodyId\(request\.body\.instanceId\)/g)?.length ?? 0,
  1,
  'badge instance apply route must validate instance IDs'
)

for (const forbiddenPattern of [
  'Number(request.params.id)',
  'isNaN(lotteryId)',
  'page: Number(page)',
  'pageSize: Number(pageSize)',
  'type: type as any',
  'prizeType: prizeType || undefined',
  'Number(request.body.ownershipId)',
  'Number(request.body.instanceId)',
  'isNaN(ownershipId)',
  'isNaN(instanceId)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `entertainment routes must not keep loose parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  lotteryDbSource.includes('function clampPagination(') &&
    lotteryDbSource.includes('function normalizeLotteryPrizeType(type: LotteryPrizeType | undefined): LotteryPrizeType | undefined') &&
    lotteryDbSource.includes('const where: Prisma.LotteryRecordWhereInput = { userId }'),
  'lottery record DB helper must keep pagination and prize-type defense in depth'
)

assert.ok(
  badgesDbSource.includes('where: { id: ownershipId, userId }') &&
    badgesDbSource.includes('where: {') &&
    badgesDbSource.includes('id: instanceId,') &&
    badgesDbSource.includes('userId,') &&
    badgesDbSource.includes('status: { not: \'deleted\' }'),
  'badge DB helpers must keep ownership and instance ownership filters'
)

console.log('entertainment route guard tests passed')
