import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const logsDbSource = readFileSync(resolve(__dirname, '../src/db/logs.ts'), 'utf8')
const logsRouteSource = readFileSync(resolve(__dirname, '../src/routes/logs.ts'), 'utf8')

assert.ok(
  logsRouteSource.includes('onRequest: [fastify.authenticate]') &&
    logsRouteSource.includes("const userId = request.user.role === 'admin' ? null : request.user.id") &&
    logsRouteSource.includes('userId: userId || undefined'),
  'logs route must authenticate callers and scope ordinary users to their own logs'
)

assert.ok(
  logsRouteSource.includes('const POSITIVE_INTEGER_PATTERN = /^[1-9]\\d*$/') &&
    logsRouteSource.includes('function parsePositiveInteger(value: string | null | undefined): number | null') &&
    logsRouteSource.includes('Number.isSafeInteger(parsed)'),
  'logs route must strictly parse positive integer query values'
)

assert.ok(
  logsRouteSource.includes('function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number') &&
    logsRouteSource.includes('function normalizeLogFilter(value: string | null | undefined, maxLength: number): string | undefined'),
  'logs route must normalize pagination and string filters before DB reads'
)

assert.ok(
  logsRouteSource.includes('const instanceIdNum = parsePositiveInteger(instanceId)') &&
    logsRouteSource.includes('if (instanceId !== null && !instanceIdNum)') &&
    logsRouteSource.includes('reply.code(400).send(apiError(ErrorCode.INVALID_ID))'),
  'logs route must reject malformed instanceId filters before DB reads'
)

assert.ok(
  logsRouteSource.includes('page: parsePositiveIntegerQuery(page, 1)') &&
    logsRouteSource.includes('pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100)') &&
    logsRouteSource.includes('module: normalizeLogFilter(module, LOG_MODULE_FILTER_MAX_LENGTH)') &&
    logsRouteSource.includes('search: normalizeLogFilter(search, LOG_SEARCH_FILTER_MAX_LENGTH)') &&
    logsRouteSource.includes('instanceName: normalizeLogFilter(instanceName, LOG_INSTANCE_NAME_FILTER_MAX_LENGTH)'),
  'logs route must pass normalized query values into the DB helper'
)

for (const forbiddenPattern of [
  'Number(instanceId)',
  'parseInt(page, 10)',
  'parseInt(pageSize, 10)',
  'module: module || undefined',
  'search: search || undefined',
  'instanceName: instanceName || undefined'
]) {
  assert.ok(
    !logsRouteSource.includes(forbiddenPattern),
    `logs route must not use unsafe query handling: ${forbiddenPattern}`
  )
}

assert.ok(
  logsDbSource.includes('const safePage = Number.isInteger(page) && page > 0 ? page : 1') &&
    logsDbSource.includes('const safePageSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 20') &&
    logsDbSource.includes('skip: (safePage - 1) * safePageSize') &&
    logsDbSource.includes('take: safePageSize'),
  'log pagination must clamp invalid or excessive page/pageSize values before querying'
)

assert.ok(
  logsDbSource.includes('const LOG_MODULE_FILTER_MAX_LENGTH = 64') &&
    logsDbSource.includes('const LOG_SEARCH_FILTER_MAX_LENGTH = 128') &&
    logsDbSource.includes('const LOG_INSTANCE_NAME_FILTER_MAX_LENGTH = 128') &&
    logsDbSource.includes('function normalizeLogFilterValue') &&
    logsDbSource.includes('return trimmed.slice(0, maxLength)'),
  'log query string filters must be trimmed and capped before Prisma contains filters'
)

assert.ok(
  logsDbSource.includes('const safeSearch = normalizeLogFilterValue(search, LOG_SEARCH_FILTER_MAX_LENGTH)') &&
    logsDbSource.includes('contains: safeSearch') &&
    logsDbSource.includes('const safeInstanceName = normalizeLogFilterValue(instanceName, LOG_INSTANCE_NAME_FILTER_MAX_LENGTH)') &&
    logsDbSource.includes('`instance "${safeInstanceName}"`'),
  'log search and instance-name filters must use capped values in database filters'
)

assert.ok(
  logsDbSource.includes('function parseValidDateFilter') &&
    logsDbSource.includes('return Number.isNaN(date.getTime()) ? undefined : date') &&
    logsDbSource.includes('const safeStartDate = parseValidDateFilter(startDate)') &&
    logsDbSource.includes('const safeEndDate = parseValidDateFilter(endDate)'),
  'log date filters must ignore invalid dates before building Prisma filters'
)

console.log('log query guard checks passed')
