import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { calculatePlanChangeDetails } from '../src/lib/billing-calc.js'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/instance-billing.ts'), 'utf8')
const billingOperationsSource = readFileSync(resolve(__dirname, '../src/db/billing-operations.ts'), 'utf8')
const bulkSeedSource = readFileSync(resolve(__dirname, './seed-bulk-local-data.ts'), 'utf8')

function sectionBetween(sourceText: string, startMarker: string, endMarker: string): string {
  const start = sourceText.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = sourceText.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return sourceText.slice(start, end)
}

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

const applyAffRouteStart = source.indexOf("}>('/:id/apply-aff'")
assert.notEqual(applyAffRouteStart, -1, 'missing apply-aff route')
const applyAffRouteEnd = source.indexOf('\n  // ====================', applyAffRouteStart)
assert.notEqual(applyAffRouteEnd, -1, 'missing apply-aff route end marker')
const applyAffRoute = source.slice(applyAffRouteStart, applyAffRouteEnd)

assert.ok(
  applyAffRoute.includes("return reply.code(403).send(apiError(ErrorCode.FORBIDDEN, '该功能已下线'))") &&
    !applyAffRoute.includes('validateAffCode(') &&
    !applyAffRoute.includes('createAffBinding('),
  'apply-aff must remain disabled to prevent post-purchase self-referral discount and commission abuse'
)

const renewRoute = sectionBetween(
  source,
  "}>('/:id/renew'",
  "}>('/batch/renew-preview'"
)
const changePlanRoute = sectionBetween(
  source,
  "}>('/:id/change-plan'",
  '\n}'
)
const performRenewal = sectionBetween(
  billingOperationsSource,
  'export async function performRenewal(',
  'export async function performPlanChange('
)
const performPlanChange = billingOperationsSource.slice(
  billingOperationsSource.indexOf('export async function performPlanChange(')
)

const paidValuePlanChange = calculatePlanChangeDetails(100, 1, 200, 1, 31, 0, 12, 10)
assert.equal(paidValuePlanChange.remainingValue, 10, 'plan change remaining value must be capped by paid amount')
assert.equal(paidValuePlanChange.priceDiff, 190, 'plan change difference must deduct capped paid remaining value')

assert.ok(
  billingOperationsSource.includes('const paidRefundQuote = await calculateInstanceRemainingRefundQuote(instance)') &&
    billingOperationsSource.includes('paidRefundQuote.remainingValue') &&
    billingOperationsSource.includes('paidRefundQuote.maxRefundable'),
  'plan-change quote must reuse paid billing-record remaining value and refundable cap'
)

assert.ok(
  renewRoute.includes("instance.status === 'deleted'") &&
    renewRoute.includes("error: '实例已删除，无法续费'") &&
    renewRoute.indexOf("instance.status === 'deleted'") < renewRoute.indexOf('db.performRenewal('),
  'renew route must reject deleted instances before performing renewal'
)
assert.ok(
  changePlanRoute.includes("instance.status === 'deleted'") &&
    changePlanRoute.includes("error: '实例已删除，无法改配'") &&
    changePlanRoute.indexOf("instance.status === 'deleted'") < changePlanRoute.indexOf('db.performPlanChange('),
  'plan-change route must reject deleted instances before performing plan change'
)
assert.ok(
  performRenewal.includes("instance.status === 'deleted'") &&
    performRenewal.includes("status: { not: 'deleted' }") &&
    performRenewal.includes('version: instance.version'),
  'performRenewal must reject deleted snapshots and conditionally update only non-deleted instances'
)
assert.ok(
  performPlanChange.includes("instance.status === 'deleted'") &&
    performPlanChange.includes("status: { not: 'deleted' }") &&
    performPlanChange.includes('version: instance.version'),
  'performPlanChange must reject deleted snapshots and conditionally update only non-deleted instances'
)

assert.ok(
  recordsRoute.includes('page: parsePositiveIntegerQuery(page, 1)') &&
    recordsRoute.includes('pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100)') &&
    recordsRoute.includes('type: normalizeBillingRecordType(type)'),
  'instance billing records route must normalize pagination and type before DB reads'
)

assert.ok(
  source.includes('function serializePlanPriceYuan(price: unknown): number') &&
    source.includes('function serializeInstanceBillingPriceYuan(price: unknown, fallbackPlanPrice: unknown): number') &&
    source.includes('price: serializeInstanceBillingPriceYuan(instance.billingPrice, preview.oldPlan.price)') &&
    source.includes('price: serializePlanPriceYuan(preview.newPlan.price)') &&
    !source.includes('price: Number(preview.newPlan.price)'),
  'plan-change preview must serialize PackagePlan.price from cents to yuan before returning prices to clients'
)

assert.ok(
  bulkSeedSource.includes('billingPrice: plan.price / 100') &&
    !bulkSeedSource.includes('billingPrice: plan.price,'),
  'bulk local seed must store instance billingPrice in yuan, matching production create/change-plan billing logic'
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
