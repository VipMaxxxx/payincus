import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/instance-billing.ts'), 'utf8')

assert.ok(
  source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('Number.isSafeInteger(parsed)') &&
    source.includes('function parsePositiveIntegerInput(value: unknown): number | null'),
  'instance billing routes must define strict positive safe-integer route and body ID parsing'
)

assert.ok(
  source.includes("import type { BillingRecordType } from '@prisma/client'") &&
    source.includes('const BILLING_RECORD_TYPES = new Set<BillingRecordType>([') &&
    source.includes("'newPurchase'") &&
    source.includes("'transfer_fee'"),
  'instance billing record query filters must be typed and allowlisted'
)

assert.ok(
  source.includes('function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number') &&
    source.includes('function normalizeBillingRecordType(value: string | undefined): BillingRecordType | undefined'),
  'instance billing records route must define strict query pagination and type normalization helpers'
)

assert.equal(
  source.match(/const instanceId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  7,
  'all instance billing routes must strictly validate instance route IDs'
)

assert.equal(
  source.match(/const newPlanId = parsePositiveRouteId\(request\.query\.newPlanId\)/g)?.length ?? 0,
  1,
  'plan-change preview must strictly validate query newPlanId'
)

assert.equal(
  source.match(/const newPlanId = parsePositiveIntegerInput\(request\.body\.newPlanId\)/g)?.length ?? 0,
  1,
  'plan-change execution must strictly validate body newPlanId'
)

for (const forbiddenPattern of [
  'const instanceId = Number(request.params.id)',
  'const newPlanId = Number(request.query.newPlanId)',
  'isNaN(instanceId)',
  'isNaN(newPlanId)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `instance billing routes must not use loose ID parsing: ${forbiddenPattern}`
  )
}

const recordsRouteStart = source.indexOf("}>('/:id/billing/records'")
assert.notEqual(recordsRouteStart, -1, 'missing instance billing records route')
const recordsRouteEnd = source.indexOf('\n}', recordsRouteStart)
assert.notEqual(recordsRouteEnd, -1, 'missing instance billing records route end marker')
const recordsRoute = source.slice(recordsRouteStart, recordsRouteEnd)

assert.ok(
  recordsRoute.includes('page: parsePositiveIntegerQuery(page, 1)') &&
    recordsRoute.includes('pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100)') &&
    recordsRoute.includes('type: normalizeBillingRecordType(type)'),
  'instance billing records route must normalize pagination and type before DB reads'
)

for (const forbiddenPattern of [
  'page: Number(page)',
  'pageSize: Number(pageSize)',
  'type: type as any'
]) {
  assert.ok(
    !recordsRoute.includes(forbiddenPattern),
    `instance billing records route must not use unsafe query handling: ${forbiddenPattern}`
  )
}

console.log('instance billing route ID guard tests passed')
