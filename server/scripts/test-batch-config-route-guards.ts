import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/batch-config.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'batch config route must use a strict positive safe-integer host ID parser'
)

assert.ok(
  routeSource.includes('function normalizeBatchInstanceIds(instanceIds: number[]): number[] | null') &&
    routeSource.includes('!Number.isSafeInteger(instanceId) || instanceId <= 0 || uniqueIds.has(instanceId)') &&
    routeSource.includes('return [...uniqueIds]'),
  'batch config route must reject invalid, non-positive, unsafe, and duplicate instance IDs'
)

assert.ok(
  routeSource.includes("items: { type: 'integer', minimum: 1 }") &&
    routeSource.includes('uniqueItems: true'),
  'batch config schema must reject non-positive and duplicate instance IDs before handler logic'
)

assert.ok(
  routeSource.includes('const hostId = parsePositiveRouteId(id)') &&
    routeSource.includes('const normalizedInstanceIds = normalizeBatchInstanceIds(instanceIds)') &&
    routeSource.includes("return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid instance IDs'))"),
  'batch config route must validate host and instance IDs before host lookup or mutation'
)

assert.ok(
  routeSource.includes('id: { in: normalizedInstanceIds }') &&
    routeSource.includes('if (instances.length !== normalizedInstanceIds.length)') &&
    routeSource.includes("return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Some instances are not available on this host'))"),
  'batch config route must require every requested instance to be available on the target host'
)

for (const forbiddenPattern of [
  'const hostId = Number(id)',
  'isNaN(hostId)',
  'id: { in: instanceIds }',
  "if (instances.length === 0) {\n      return reply.code(400).send({ error: '没有找到可修改的实例' })"
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `batch config route must not keep loose or partial batch behavior: ${forbiddenPattern}`
  )
}

console.log('batch config route guard tests passed')
