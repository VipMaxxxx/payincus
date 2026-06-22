import { readFileSync } from 'fs'
import { resolve } from 'path'

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

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const trafficRouteSource = readFileSync(resolve(repoRoot, 'server/src/routes/traffic.ts'), 'utf8')
const bigintInputSource = readFileSync(resolve(repoRoot, 'server/src/lib/bigint-input.ts'), 'utf8')

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

console.log('traffic route limit guard checks passed')
