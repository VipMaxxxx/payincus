import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/vip-benefits.ts'), 'utf8')
const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/vip-benefits.ts'), 'utf8')
const schemaSource = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const instanceRouteSource = readFileSync(resolve(process.cwd(), 'src/routes/instances.ts'), 'utf8')
const billingSource = readFileSync(resolve(process.cwd(), 'src/db/billing-operations.ts'), 'utf8')
const trafficSource = readFileSync(resolve(process.cwd(), 'src/services/traffic-scheduler.ts'), 'utf8')
const resourcePoolRouteSource = readFileSync(resolve(process.cwd(), 'src/routes/resource-pool.ts'), 'utf8')

assert.ok(
  routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'VIP benefit routes must define strict positive safe-integer route ID parsing'
)

assert.ok(
  serviceSource.includes("export const VIP_BENEFITS_CONFIG_KEY = 'vip_benefits_config'") &&
    serviceSource.includes("'1': { orderDiscountPercent: 1, extraTrafficPercent: 2, resourcePoolBonusPercent: 2 }") &&
    serviceSource.includes("'5': { orderDiscountPercent: 5, extraTrafficPercent: 10, resourcePoolBonusPercent: 10 }") &&
    serviceSource.includes('value > MAX_VIP_BENEFIT_PERCENT'),
  'VIP continuous benefits must keep the conservative V1-V5 defaults and enforce 0-100 percent bounds'
)

assert.ok(
  serviceSource.includes('export function arbitrateVipPrice(') &&
    serviceSource.includes("source: 'flash_sale'") &&
    serviceSource.includes('candidate.price < best.price') &&
    instanceRouteSource.includes('const priceDecision = arbitrateVipPrice({') &&
    instanceRouteSource.includes('flashSalePrice: flashSaleCheckout ? flashSaleCheckout.flashPrice / 100 : null') &&
    billingSource.includes('const renewalPrice = arbitrateVipPrice({'),
  'new purchase and renewal pricing must use one backend arbiter, choose one best discount, and never stack VIP onto flash-sale prices'
)

assert.ok(
  trafficSource.includes('const vipExtraTrafficQuota = await getVipExtraTrafficQuota(instance.userId, instance.monthlyTrafficLimit)') &&
    trafficSource.includes('const instanceBaseWithVip = getEffectiveLimit(instance.monthlyTrafficLimit, vipExtraTrafficQuota)') &&
    resourcePoolRouteSource.includes('const poolDebitAmount = calculateVipResourcePoolCost(amount, vip.benefit.resourcePoolBonusPercent)') &&
    resourcePoolRouteSource.includes('poolDebitAmount,'),
  'VIP traffic and resource-pool bonuses must be resolved from the current level at their backend enforcement points'
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
  serviceSource.includes('export async function deleteVipBenefitReward(id: number): Promise<void>') &&
    serviceSource.includes('await prisma.vipBenefitReward.update({') &&
    serviceSource.includes('data: { enabled: false }') &&
    !serviceSource.includes('prisma.vipBenefitReward.delete('),
  'Deleting a VIP benefit reward must disable it instead of cascading deletion to claim records'
)

assert.ok(
  serviceSource.includes('prisma.vipBenefitReward.findMany({\n      where: { enabled: true },') &&
    serviceSource.includes('const reward = await tx.vipBenefitReward.findFirst({') &&
    serviceSource.includes('          enabled: true') &&
    serviceSource.includes('const existingCount = claimCounts.get(reward.id) || 0') &&
    serviceSource.includes('if (existingCount >= reward.claimLimit)') &&
    serviceSource.includes('claimNo: existingCount + 1'),
  'Disabled VIP benefit rewards must stay hidden and unclaimable while retained claims enforce claimLimit'
)

assert.ok(
  schemaSource.includes('model VipBenefitClaim') &&
    schemaSource.includes('@@unique([userId, rewardId, claimNo])') &&
    schemaSource.includes('enum VipBenefitRewardType') &&
    schemaSource.includes('enum VipBenefitClaimStatus'),
  'VIP benefit schema must keep claim idempotency and enum-backed reward/claim statuses'
)

console.log('VIP benefit route guard tests passed')
