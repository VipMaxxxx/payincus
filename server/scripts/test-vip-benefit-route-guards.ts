import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/vip-benefits.ts'), 'utf8')
const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/vip-benefits.ts'), 'utf8')
const schemaSource = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')

assert.ok(
  routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'VIP benefit routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  routeSource.match(/const rewardId = parsePositiveRouteId\(request\.params\.rewardId\)/g)?.length ?? 0,
  1,
  'VIP benefit claim route must strictly validate reward IDs'
)

assert.equal(
  routeSource.match(/const id = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  2,
  'VIP benefit admin update/delete routes must strictly validate reward IDs'
)

for (const forbiddenPattern of [
  'function parseId(value: unknown)',
  'Number(request.params'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `VIP benefit routes must not keep loose route ID parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  serviceSource.includes('function requireSafeInteger(value: unknown, field: string): number') &&
    serviceSource.includes("typeof value !== 'number' || !Number.isSafeInteger(value)") &&
    serviceSource.includes('function requireFiniteNumber(value: unknown, field: string): number') &&
    serviceSource.includes("typeof value !== 'number' || !Number.isFinite(value)"),
  'VIP benefit reward normalization must require JSON number inputs instead of string coercion'
)

assert.ok(
  serviceSource.includes("const level = requireSafeInteger(value, 'VIP level')") &&
    serviceSource.includes('const parsed = requireSafeInteger(value, field)') &&
    serviceSource.includes('const parsed = requireFiniteNumber(value, field)') &&
    serviceSource.includes("const parsed = requireSafeInteger(value, 'Sort order')"),
  'VIP benefit level, integer, money, and sort-order normalizers must use strict numeric helpers'
)

for (const forbiddenPattern of [
  'const level = Number(value)',
  'const parsed = Number(value)',
  'const parsed = Number(value ?? 0)',
  'const parsedRewardId = Number(rewardId)'
]) {
  assert.ok(
    !serviceSource.includes(forbiddenPattern),
    `VIP benefit service must not keep loose reward config parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  serviceSource.includes('if (!Number.isSafeInteger(rewardId) || rewardId <= 0)') &&
    serviceSource.includes('await advisoryTransactionLock(tx, USER_VIP_BENEFIT_CLAIM_LOCK_NAMESPACE, userId)') &&
    serviceSource.includes('tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)') &&
    serviceSource.includes('await advisoryTransactionLock(tx, USER_POINTS_LOCK_NAMESPACE, userId)') &&
    serviceSource.includes("if (error?.code === 'P2002')"),
  'VIP benefit claim path must keep safe reward IDs, user claim lock, accounting locks, and unique-conflict handling'
)

assert.ok(
  schemaSource.includes('model VipBenefitClaim') &&
    schemaSource.includes('@@unique([userId, rewardId, claimNo])') &&
    schemaSource.includes('enum VipBenefitRewardType') &&
    schemaSource.includes('enum VipBenefitClaimStatus'),
  'VIP benefit schema must keep claim idempotency and enum-backed reward/claim statuses'
)

console.log('VIP benefit route guard tests passed')
