import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/packages.ts'), 'utf8')

assert.ok(
  source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'package routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  source.match(/const packageId = parsePositiveRouteId\(id\)/g)?.length ?? 0,
  14,
  'all package :id routes must strictly validate package route IDs'
)

assert.equal(
  source.match(/const targetUserId = parsePositiveRouteId\(userId\)/g)?.length ?? 0,
  1,
  'package share unshare route must strictly validate target user route ID'
)

assert.equal(
  source.match(/const shareIdNum = parsePositiveRouteId\(shareId\)/g)?.length ?? 0,
  1,
  'package share quota route must strictly validate share route ID'
)

assert.equal(
  source.match(/const planIdNum = parsePositiveRouteId\(planId\)/g)?.length ?? 0,
  2,
  'package plan update/delete routes must strictly validate plan route IDs'
)

assert.ok(
  source.includes('function parseOptionalPositiveQueryInteger(value: string | undefined): number | null | undefined') &&
    source.includes('const parsedFilterUserId = parseOptionalPositiveQueryInteger(filterUserId)') &&
    source.includes('parsedFilterUserId === null') &&
    source.match(/const zoneId = parseOptionalPositiveQueryInteger\(request\.query\.zoneId\)/g)?.length === 2 &&
    source.match(/zoneId === null/g)?.length === 2 &&
    source.match(/zoneId === undefined/g)?.length === 2,
  'package routes must strictly validate optional owner and hosting zone query IDs'
)

for (const forbiddenPattern of [
  'const packageId = Number(id)',
  'const targetUserId = Number(userId)',
  'const shareIdNum = Number(shareId)',
  'const planIdNum = Number(planId)',
  'const filterUid = parseInt(filterUserId, 10)',
  'Number.parseInt(request.query.zoneId || \'\', 10)',
  'isNaN(packageId)',
  'isNaN(targetUserId)',
  'isNaN(shareIdNum)',
  'isNaN(planIdNum)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `package routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

console.log('package route ID guard tests passed')
