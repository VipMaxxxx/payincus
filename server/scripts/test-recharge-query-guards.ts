import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const userListRoute = sectionBetween(
  routeSource,
  "app.get('/api/recharge/orders'",
  '// 获取充值订单详情'
)
const adminListRoute = sectionBetween(
  routeSource,
  "app.get('/api/admin/recharge/orders'",
  '// 获取系统充值统计（管理员）'
)

assert.ok(
  routeSource.includes('function parseOptionalPositiveInteger(value: string | undefined, fallback: number): number') &&
    routeSource.includes('const parsed = parsePositiveId(value)') &&
    routeSource.includes('return parsed ?? fallback'),
  'recharge routes must use a strict positive integer query parser'
)

assert.ok(
  routeSource.includes('const RECHARGE_STATUSES = new Set(') &&
    routeSource.includes('function parseOptionalRechargeStatus(value: string | undefined): RechargeStatus | undefined') &&
    routeSource.includes('RECHARGE_STATUSES.has(value)'),
  'recharge routes must allowlist recharge status filters before passing them to the DB layer'
)

for (const [name, section] of [
  ['user recharge list', userListRoute],
  ['admin recharge list', adminListRoute]
] as const) {
  assert.ok(
    section.includes('page: parseOptionalPositiveInteger(page, 1)') &&
      section.includes('pageSize: parseOptionalPositiveInteger(pageSize, 20)') &&
      section.includes('status: parseOptionalRechargeStatus(status)'),
    `${name} must sanitize pagination and status query params at the route boundary`
  )

  assert.ok(
    !section.includes('parseInt(page') &&
      !section.includes('parseInt(pageSize') &&
      !section.includes('status: status as any'),
    `${name} must not use loose parseInt or unchecked status casts`
  )
}

assert.ok(
  adminListRoute.includes('userId: userId ? parsePositiveId(userId) ?? undefined : undefined'),
  'admin recharge list must strictly parse optional userId query filter'
)

console.log('recharge query guard tests passed')
