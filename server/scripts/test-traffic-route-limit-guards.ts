import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { computeEffectiveBandwidth } from '../src/services/traffic-bandwidth.js'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function indexOfOrThrow(source: string, pattern: string, label: string): number {
  const index = source.indexOf(pattern)
  assert(index >= 0, `Missing ${label}: ${pattern}`)
  return index
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = indexOfOrThrow(source, startPattern, startPattern)
  const end = indexOfOrThrow(source.slice(start), endPattern, endPattern)
  return source.slice(start, start + end)
}

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const trafficRouteSource = readFileSync(resolve(repoRoot, 'server/src/routes/traffic.ts'), 'utf8')
const bigintInputSource = readFileSync(resolve(repoRoot, 'server/src/lib/bigint-input.ts'), 'utf8')
const trafficDbSource = readFileSync(resolve(repoRoot, 'server/src/db/traffic.ts'), 'utf8')
const trafficSchedulerSource = readFileSync(resolve(repoRoot, 'server/src/services/traffic-scheduler.ts'), 'utf8')
const trafficBandwidthSource = readFileSync(resolve(repoRoot, 'server/src/services/traffic-bandwidth.ts'), 'utf8')

assert(
  bigintInputSource.includes('export const POSTGRES_BIGINT_MAX = 9223372036854775807n'),
  'traffic limit parser must cap values to PostgreSQL bigint range'
)
assert(
  trafficRouteSource.includes('function parsePositiveId(value: string): number | null'),
  'traffic routes must use strict positive ID parsing'
)
assert(
  trafficRouteSource.includes("import { parseNullablePostgresBigIntInput } from '../lib/bigint-input.js'"),
  'traffic routes must use the shared PostgreSQL bigint input parser'
)
assert(
  !trafficRouteSource.includes('parseInt('),
  'traffic routes must not use parseInt for route params'
)
assert(
  !trafficRouteSource.includes('isNaN('),
  'traffic routes must not use isNaN for route params'
)
assert(
  !trafficRouteSource.includes('BigInt(monthlyLimit)'),
  'traffic limit routes must not call BigInt on raw request body values'
)
assert(
  !trafficRouteSource.includes('monthlyLimit: string | null'),
  'traffic limit request bodies must not assume monthlyLimit is already a string'
)

const userLimitSection = section(
  trafficRouteSource,
  "fastify.put<{\n        Params: { userId: string }\n        Body: { monthlyLimit: unknown }\n    }>('/users/:userId/traffic/limit'",
  'await trafficDb.updateUserTrafficLimit(userId, limit)'
)
assert(
  userLimitSection.includes('const userId = parsePositiveId(request.params.userId)'),
  'user traffic limit route must parse userId strictly'
)
assert(
  userLimitSection.includes('const limit = parseNullablePostgresBigIntInput(monthlyLimit)'),
  'user traffic limit route must parse monthlyLimit with the guard helper'
)
assert(
  userLimitSection.includes('if (limit === undefined)'),
  'user traffic limit route must reject invalid monthlyLimit values'
)
assert(
  userLimitSection.includes("apiError(ErrorCode.INVALID_PARAMS, 'Invalid monthly traffic limit')"),
  'user traffic limit route must return a controlled invalid-params error'
)

const instanceLimitSection = section(
  trafficRouteSource,
  "fastify.put<{\n        Params: { instanceId: string }\n        Body: { monthlyLimit: unknown }\n    }>('/instances/:instanceId/traffic/limit'",
  'await trafficDb.updateInstanceTrafficLimit(instanceId, limit)'
)
assert(
  instanceLimitSection.includes('const instanceId = parsePositiveId(request.params.instanceId)'),
  'instance traffic limit route must parse instanceId strictly'
)
assert(
  instanceLimitSection.includes('const limit = parseNullablePostgresBigIntInput(monthlyLimit)'),
  'instance traffic limit route must parse monthlyLimit with the guard helper'
)
assert(
  instanceLimitSection.includes('if (limit === undefined)'),
  'instance traffic limit route must reject invalid monthlyLimit values'
)
assert(
  instanceLimitSection.includes("apiError(ErrorCode.INVALID_PARAMS, 'Invalid monthly traffic limit')"),
  'instance traffic limit route must return a controlled invalid-params error'
)

for (const expectedParserUse of [
  'parsePositiveId(request.params.userId)',
  'parsePositiveId(request.params.instanceId)',
  'parsePositiveId(request.params.hostId)'
]) {
  assert(
    trafficRouteSource.includes(expectedParserUse),
    `traffic routes must use strict parser for ${expectedParserUse}`
  )
}

const throttleSection = section(
  trafficSchedulerSource,
  'async function checkAndThrottle(',
  '/**\n * 检查并恢复带宽'
)
assert(
  throttleSection.includes('await getVipExtraTrafficQuota(instance.userId, instance.monthlyTrafficLimit)') &&
    throttleSection.includes('getEffectiveLimit(instance.monthlyTrafficLimit, vipExtraTrafficQuota)') &&
    throttleSection.includes('getEffectiveLimit(instanceBaseWithVip, userQuota.extraTrafficQuota)') &&
    throttleSection.includes('isOverLimit(instance.monthlyTrafficUsed, instanceLimit)') &&
    throttleSection.includes('userQuota.extraTrafficUsed >= userQuota.extraTrafficQuota') &&
    throttleSection.includes('(instanceUsesExtraTraffic && extraTrafficExhausted)') &&
    throttleSection.includes('isWarningThreshold(instance.monthlyTrafficUsed, instanceLimit)'),
  'instance throttle and warning decisions must include dynamic VIP quota plus purchased and consumed extra traffic quota'
)

const restoreSection = section(
  trafficSchedulerSource,
  'async function checkAndRestore(',
  'async function reconcileTrafficState('
)
assert(
  restoreSection.includes('await getVipExtraTrafficQuota(instance.userId, instance.monthlyTrafficLimit)') &&
    restoreSection.includes('getEffectiveLimit(instance.monthlyTrafficLimit, vipExtraTrafficQuota)') &&
    restoreSection.includes('getEffectiveLimit(instanceBaseWithVip, userQuota.extraTrafficQuota)') &&
    restoreSection.includes('userQuota.extraTrafficUsed >= userQuota.extraTrafficQuota') &&
    restoreSection.includes('!(instanceUsesExtraTraffic && extraTrafficExhausted)'),
  'instance restore decisions must include dynamic VIP quota plus purchased and consumed extra traffic quota'
)
assert(
  trafficRouteSource.includes('const vipExtraTrafficQuota = await getVipExtraTrafficQuota(instance.userId, instance.monthlyTrafficLimit)') &&
    trafficRouteSource.includes('monthlyLimit: serializeBigInt(effectiveInstanceLimit)') &&
    trafficRouteSource.includes('vipExtraQuota: serializeBigInt(vipExtraTrafficQuota)'),
  'instance traffic API must expose the currently effective VIP-adjusted quota'
)
assert(
  trafficSchedulerSource.includes('trafficDb.syncUserExtraTrafficUsed(userId)') &&
    trafficDbSource.includes('instance.monthlyTrafficUsed - instance.monthlyTrafficLimit') &&
    trafficDbSource.includes('consumed > quota.extraTrafficQuota ? quota.extraTrafficQuota : consumed') &&
    trafficDbSource.includes('data: { extraTrafficUsed }'),
  'extraTrafficUsed must track instance usage beyond instance base limits and remain capped by purchased quota'
)

const arbitrationSection = section(
  trafficBandwidthSource,
  'export function computeEffectiveBandwidth(',
  '/** 按数据库中仍生效的约束重算并落地实际带宽。 */'
)
assert(
  arbitrationSection.includes('instance.packagePlan?.trafficLimitSpeed') &&
    arbitrationSection.includes("instance.trafficStatus === 'LIMITED' ? overageThrottleSpeed : null") &&
    arbitrationSection.includes('instance.resourceRiskState?.currentBandwidthLimit ?? null') &&
    arbitrationSection.includes('mostRestrictiveBandwidth') &&
    !arbitrationSection.includes('instance.limitsIngress') &&
    !arbitrationSection.includes('instance.limitsEgress'),
  'single bandwidth arbitration must choose the strictest traffic/risk constraint from a configured baseline, never a captured live limit'
)
assert(
  trafficBandwidthSource.includes('withLock(`bandwidth:instance:${instanceId}`') &&
    JSON.stringify(computeEffectiveBandwidth({
      trafficStatus: 'NORMAL',
      packagePlan: { trafficLimitSpeed: '10Mbit' },
      resourceRiskState: null
    })) === JSON.stringify({ ingress: '10Mbit', egress: '10Mbit' }) &&
    JSON.stringify(computeEffectiveBandwidth({
      trafficStatus: 'LIMITED',
      packagePlan: { trafficLimitSpeed: '10Mbit' },
      resourceRiskState: { currentBandwidthLimit: '5Mbit' }
    }, '2Mbit')) === JSON.stringify({ ingress: '2Mbit', egress: '2Mbit' }) &&
    JSON.stringify(computeEffectiveBandwidth({
      trafficStatus: 'NORMAL',
      packagePlan: { trafficLimitSpeed: '10Mbit' },
      resourceRiskState: { currentBandwidthLimit: '5Mbit' }
    })) === JSON.stringify({ ingress: '5Mbit', egress: '5Mbit' }),
  'bandwidth arbitration must serialize writers and retain the remaining strictest constraint when either system releases'
)
assert(
  trafficBandwidthSource.includes("TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY = 'traffic_overage_throttle_speed'") &&
    trafficBandwidthSource.includes("DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED = '1Mbit'") &&
    trafficBandwidthSource.includes('await getSystemConfig(TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY)') &&
    !trafficBandwidthSource.includes('THROTTLE_BANDWIDTH'),
  'traffic overage throttle must come from system config with a 1Mbit fallback, not the legacy hardcoded constant'
)
assert(
  throttleSection.indexOf('markInstanceTrafficLimitedIfNeeded(instance.id)') <
      throttleSection.indexOf('reconcileEffectiveBandwidth(instance.id, client)') &&
    restoreSection.indexOf("updateInstanceTrafficStatus(instance.id, 'NORMAL')") <
      restoreSection.indexOf('reconcileEffectiveBandwidth(instance.id, client)') &&
    !trafficSchedulerSource.includes('applyThrottle(') &&
    !trafficSchedulerSource.includes('isThrottled(') &&
    !trafficSchedulerSource.includes('resolveTrafficBandwidthLimits('),
  'traffic throttling must set or clear only its own flag before recomputing bandwidth from all remaining constraints'
)

console.log('traffic route limit guard checks passed')
