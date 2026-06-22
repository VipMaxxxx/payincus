import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')

assert.ok(
  source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'instance routes must define strict positive safe-integer route ID parsing'
)

assert.ok(
  source.includes('function parseOptionalPositiveQueryInteger(value: string | undefined): number | null | undefined') &&
    source.includes('function parseInstanceListPageSize(value: string | undefined): number | null | undefined') &&
    source.includes('const INSTANCE_LIST_MAX_PAGE_SIZE = 100') &&
    source.includes('function parseOptionalInstanceStatus(value: string | undefined): InstanceStatus | null | undefined'),
  'instance list route must define strict query parsing helpers for IDs, pagination, and status'
)

assert.ok(
  source.includes("id: { type: 'string', pattern: '^[1-9]\\\\d*$' }"),
  'instance order route schema must reject zero and malformed IDs'
)

assert.equal(
  source.match(/parsePositiveRouteId\(id\)/g)?.length ?? 0,
  27,
  'all instance routes that destructure id must use strict positive route ID parsing'
)

assert.equal(
  source.match(/parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  3,
  'all direct request.params.id routes must use strict positive route ID parsing'
)

assert.equal(
  source.match(/parsePositiveRouteId\(portId\)/g)?.length ?? 0,
  1,
  'port mapping delete route must strictly validate portId'
)

assert.equal(
  source.match(/parsePositiveRouteId\(taskId\)/g)?.length ?? 0,
  2,
  'task detail and cancellation routes must strictly validate taskId'
)

const listRouteStart = source.indexOf("fastify.get<{")
assert.ok(listRouteStart >= 0, 'instance list route not found')
const listRouteEnd = source.indexOf('// 获取可用宿主机列表', listRouteStart)
assert.ok(listRouteEnd > listRouteStart, 'instance list route end marker not found')
const listRoute = source.slice(listRouteStart, listRouteEnd)

assert.ok(
  listRoute.includes('const parsedPage = parseOptionalPositiveQueryInteger(page)') &&
    listRoute.includes('const parsedPageSize = parseInstanceListPageSize(pageSize)') &&
    listRoute.includes('const parsedHostId = parseOptionalPositiveQueryInteger(hostId)') &&
    listRoute.includes('const parsedQueryUserId = parseOptionalPositiveQueryInteger(queryUserId)') &&
    listRoute.includes('const parsedStatus = parseOptionalInstanceStatus(status)'),
  'instance list route must parse query IDs, pagination, and status through strict helpers'
)
assert.ok(
  listRoute.includes('return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS') &&
    listRoute.includes('parsedHostId === null') &&
    listRoute.includes('parsedQueryUserId === null') &&
    listRoute.includes('parsedStatus === null'),
  'instance list route must reject malformed query filters before DB access'
)
assert.ok(
  !listRoute.includes('parseInt(page') &&
    !listRoute.includes('parseInt(pageSize') &&
    !listRoute.includes('parseInt(queryUserId') &&
    !listRoute.includes('parseInt(hostId'),
  'instance list route must not use loose parseInt for query parameters'
)

for (const forbiddenPattern of [
  'const instanceId = Number(id)',
  'const instanceId = Number(request.params.id)',
  'const portMappingId = Number(portId)',
  'const taskIdNum = Number(taskId)',
  'parseInt(request.params.id',
  'isNaN(instanceId)',
  'isNaN(portMappingId)',
  'isNaN(taskIdNum)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `instance routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

console.log('instance route ID guard tests passed')
