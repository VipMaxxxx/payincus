import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/hosts.ts'), 'utf8')

assert.ok(
  source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('function parseIntegerBody(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number | null') &&
    source.includes('function parsePositiveIntegerArrayBody(value: unknown, maxItems: number): number[] | null') &&
    source.includes('function parseOptionalIntegerBody(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number | null | undefined') &&
    source.includes('function parseFiniteNumberBody(value: unknown, min: number, max: number): number | null') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'host routes must define strict positive safe-integer route/body ID parsing'
)

assert.equal(
  source.match(/parsePositiveRouteId\(id\)/g)?.length ?? 0,
  21,
  'all destructured host route IDs must use strict positive route ID parsing'
)

assert.equal(
  source.match(/parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  34,
  'all direct request.params.id host routes must use strict positive route ID parsing'
)

assert.equal(
  source.match(/parsePositiveRouteId\(request\.params\.instanceId\)/g)?.length ?? 0,
  9,
  'all host instance sub-routes must strictly validate instance route IDs'
)

assert.equal(
  source.match(/parsePositiveRouteId\(request\.params\.ruleId\)/g)?.length ?? 0,
  2,
  'all host audit rule routes must strictly validate rule route IDs'
)

assert.equal(
  source.match(/parsePositiveRouteId\(request\.params\.ignoreId\)/g)?.length ?? 0,
  1,
  'host audit ignore delete route must strictly validate ignore route IDs'
)

assert.ok(
  source.includes('const HOST_AUDIT_HISTORY_MAX_PAGE_SIZE = 50') &&
    source.includes('function parseHostAuditHistoryPageSize(value: string | undefined): number | null | undefined') &&
    source.match(/const instanceId = parseOptionalPositiveQueryInteger\(request\.query\.instanceId\)/g)?.length === 2 &&
    source.includes('const pageSize = parseHostAuditHistoryPageSize(request.query.pageSize)') &&
    source.includes('instanceId === null || pageSize === null') &&
    source.includes('take: pageSize ?? 20'),
  'host ops audit query routes must strictly validate optional instanceId and pageSize filters'
)

assert.ok(
  source.includes('const AUDIT_IGNORE_MAX_EXPIRES_DAYS = 365') &&
    source.includes('const instanceId = scope === \'instance\' ? parseIntegerBody(request.body.instanceId) : null') &&
    source.includes('const expiresInDays = parseOptionalIntegerBody(request.body.expiresInDays, 1, AUDIT_IGNORE_MAX_EXPIRES_DAYS)') &&
    source.includes('if (expiresInDays === null) return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))'),
  'host audit ignore creation must strictly validate instanceId and expiresInDays body values'
)

assert.ok(
  source.includes('const AUDIT_KILL_PROCESS_MIN_PID = 2') &&
    source.includes('const AUDIT_KILL_PROCESS_MAX_PID = 4194304') &&
    source.includes('const pid = parseIntegerBody(request.body.pid, AUDIT_KILL_PROCESS_MIN_PID, AUDIT_KILL_PROCESS_MAX_PID)') &&
    source.includes('const parsedScanId = parseOptionalIntegerBody(request.body.scanId)') &&
    source.includes('if (!hostId || !instanceId || !pid || parsedScanId === null)'),
  'host audit kill-process must strictly validate pid and optional scanId body values'
)

assert.ok(
  source.includes('const HOST_BATCH_MIGRATE_MAX_INSTANCES = 30') &&
    source.includes('const instanceIds = parsePositiveIntegerArrayBody(request.body.instanceIds, HOST_BATCH_MIGRATE_MAX_INSTANCES)') &&
    source.includes('const targetHostId = parseIntegerBody(request.body.targetHostId)') &&
    source.includes('const targetPlanId = parseOptionalIntegerBody(request.body.targetPlanId)') &&
    source.includes('if (!sourceHostId || !instanceIds || !targetHostId || targetPlanId === null)') &&
    source.includes('if (instances.length !== instanceIds.length)') &&
    source.includes("apiError(ErrorCode.INVALID_PARAMS, 'Some instances are not available on this host')"),
  'host batch migrate must strictly validate target IDs and reject partial instance selections'
)

assert.ok(
  source.includes('const HOST_BATCH_INSTANCE_MAX_ITEMS = 100') &&
    source.includes('const HOST_GIFT_DAYS_MAX = 365') &&
    source.includes('const instanceIds = parsePositiveIntegerArrayBody(request.body.instanceIds, HOST_BATCH_INSTANCE_MAX_ITEMS)') &&
    source.includes('const days = parseIntegerBody(request.body.days, 1, HOST_GIFT_DAYS_MAX)') &&
    source.includes('if (!hostId || !instanceIds || !days)'),
  'host gift-days must strictly validate instanceIds and days body values'
)

assert.ok(
  source.includes('const HOST_RENEWAL_PRICE_MAX = 99999') &&
    source.includes('const newPrice = parseFiniteNumberBody(request.body.newPrice, 0, HOST_RENEWAL_PRICE_MAX)') &&
    source.includes('if (!hostId || !instanceId || newPrice === null)'),
  'host renewal price must reject non-finite and out-of-range body values at route boundary'
)

for (const forbiddenPattern of [
  'const hostId = Number(id)',
  'const sourceHostId = Number(id)',
  'const hostId = Number(request.params.id)',
  'const instanceId = Number(request.params.instanceId)',
  'const ruleId = Number(request.params.ruleId)',
  'const ignoreId = Number(request.params.ignoreId)',
  'const hostId = parseInt(request.params.id, 10)',
  'request.query.instanceId ? Number(request.query.instanceId)',
  'Number(request.query.pageSize || 20)',
  'Number(request.body.instanceId)',
  'Number(request.body.expiresInDays || 0)',
  'Number(request.body.pid)',
  'Number(request.body.scanId || 0)',
  'const { instanceIds, targetHostId, targetImage, targetPlanId } = request.body',
  'const { instanceIds, days } = request.body',
  'const { newPrice } = request.body'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `host routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

console.log('host route ID guard tests passed')
