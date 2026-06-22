import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/notifications.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/notifications.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const logRoute = sectionBetween(
  routeSource,
  "}>('/logs', {",
  '  // 获取通知统计'
)

const logHelper = sectionBetween(
  dbSource,
  'export async function getNotificationLogsByUserId(',
  '/**\n * 获取通知统计'
)

assert.ok(
  routeSource.includes("const notificationLogStatuses = new Set(['pending', 'sent', 'failed'])") &&
    routeSource.includes('function parsePositiveInteger(value: string | undefined, fallback: number): number') &&
    routeSource.includes('function parseNotificationLogStatus(value: string | undefined)'),
  'notification log route must define NaN-safe pagination and status parsers'
)

assert.ok(
  logRoute.includes('const page = parsePositiveInteger(request.query.page, 1)') &&
    logRoute.includes('const pageSize = Math.min(100, parsePositiveInteger(request.query.pageSize, 20))') &&
    logRoute.includes('const status = parseNotificationLogStatus(request.query.status)'),
  'notification log route must sanitize page, pageSize, and status before calling the DB helper'
)

assert.ok(
  !logRoute.includes('parseInt(request.query.page') &&
    !logRoute.includes('const status = request.query.status'),
  'notification log route must not pass raw parsed pagination or raw status to the DB helper'
)

assert.ok(
  dbSource.includes('function clampNotificationLogPagination(page: number | undefined, pageSize: number | undefined)') &&
    dbSource.includes('page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1') &&
    dbSource.includes('Math.min(Math.max(pageSize, 1), 100)') &&
    dbSource.includes('function normalizeNotificationLogStatus(status: string | undefined)'),
  'notification log DB helper must defensively clamp pagination and normalize status'
)

assert.ok(
  logHelper.includes('const { page, pageSize } = clampNotificationLogPagination(options.page, options.pageSize)') &&
    logHelper.includes('const status = normalizeNotificationLogStatus(options.status)') &&
    logHelper.includes('if (status) {') &&
    logHelper.includes('where.status = status') &&
    logHelper.includes('skip,') &&
    logHelper.includes('take: pageSize'),
  'notification log DB helper must use sanitized pagination and status values for Prisma queries'
)

console.log('notification log query guard tests passed')
