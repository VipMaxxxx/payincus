import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const paginationSource = readFileSync(resolve(__dirname, '../src/db/pagination.ts'), 'utf8')
const usersRouteSource = readFileSync(resolve(__dirname, '../src/routes/users.ts'), 'utf8')
const hostsRouteSource = readFileSync(resolve(__dirname, '../src/routes/hosts.ts'), 'utf8')
const instancesRouteSource = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const paginationHelper = sectionBetween(
  paginationSource,
  'function clampPagination(',
  'function joinSqlFragments'
)

assert.ok(
  paginationHelper.includes('page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1') &&
    paginationHelper.includes('Math.min(Math.max(pageSize, 1), maxPageSize)') &&
    paginationHelper.includes('fallbackPageSize') &&
    paginationHelper.includes('maxPageSize: number = 100'),
  'shared pagination helper must reject NaN, Infinity, zero, negative page values, and cap pageSize'
)

for (const helperName of ['getUsersPaginated', 'getHostsPaginated', 'getInstancesPaginated'] as const) {
  const helperSection = sectionBetween(
    paginationSource,
    `export async function ${helperName}(`,
    helperName === 'getUsersPaginated'
      ? '/**\n * 获取宿主机分页列表'
      : helperName === 'getHostsPaginated'
        ? '/**\n * 获取实例分页列表'
        : '/**\n * 获取可用宿主机'
  )

  assert.ok(
    helperSection.includes('const { page, pageSize } = clampPagination(options.page, options.pageSize)') &&
      helperSection.includes('skip: (page - 1) * pageSize') &&
      helperSection.includes('take: pageSize') &&
      helperSection.includes('page,') &&
      helperSection.includes('pageSize,'),
    `${helperName} must use sanitized page and pageSize for query offsets and response metadata`
  )
}

assert.ok(
  usersRouteSource.includes('function parsePositiveIntegerQuery(value: string | undefined, fallback: number): number') &&
    usersRouteSource.includes('function parseClampedPositiveIntegerQuery(value: string | undefined, fallback: number, max: number): number') &&
    usersRouteSource.includes('page: parsePositiveIntegerQuery(page, 1)') &&
    usersRouteSource.includes('pageSize: parseClampedPositiveIntegerQuery(pageSize, 20, 100)'),
  'admin user list route must pass strictly parsed pagination values before DB-level clamps'
)

assert.ok(
  hostsRouteSource.includes('function parseOptionalPositiveQueryInteger(value: string | undefined): number | null | undefined') &&
    hostsRouteSource.includes('function parseHostListPageSize(value: string | undefined): number | null | undefined') &&
    hostsRouteSource.includes('const HOST_LIST_MAX_PAGE_SIZE = 100') &&
    hostsRouteSource.includes('const parsedPage = parseOptionalPositiveQueryInteger(page)') &&
    hostsRouteSource.includes('const parsedPageSize = parseHostListPageSize(pageSize)') &&
    hostsRouteSource.includes('const parsedFilterUserId = parseOptionalPositiveQueryInteger(filterUserId)') &&
    hostsRouteSource.includes('parsedPage === null || parsedPageSize === null || parsedFilterUserId === null') &&
    hostsRouteSource.includes('page: parsedPage ?? 1') &&
    hostsRouteSource.includes('pageSize: parsedPageSize ?? 20'),
  'host list route must strictly parse pagination and user filters before DB-level clamps'
)

assert.ok(
  instancesRouteSource.includes('function parseOptionalPositiveQueryInteger(value: string | undefined): number | null | undefined') &&
    instancesRouteSource.includes('function parseInstanceListPageSize(value: string | undefined): number | null | undefined') &&
    instancesRouteSource.includes('const INSTANCE_LIST_MAX_PAGE_SIZE = 100') &&
    instancesRouteSource.includes('const parsedPage = parseOptionalPositiveQueryInteger(page)') &&
    instancesRouteSource.includes('const parsedPageSize = parseInstanceListPageSize(pageSize)') &&
    instancesRouteSource.includes('const parsedHostId = parseOptionalPositiveQueryInteger(hostId)') &&
    instancesRouteSource.includes('const parsedQueryUserId = parseOptionalPositiveQueryInteger(queryUserId)') &&
    instancesRouteSource.includes('const parsedStatus = parseOptionalInstanceStatus(status)') &&
    instancesRouteSource.includes('page: parsedPage ?? 1') &&
    instancesRouteSource.includes('pageSize: parsedPageSize ?? 20'),
  'instance list route must strictly parse pagination, IDs, and status filters before DB-level clamps'
)

console.log('core pagination guard tests passed')
