import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/admin-hosting.ts'), 'utf8')

assert.ok(
  source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'admin hosting routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  source.match(/const zoneId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  1,
  'admin hosting zone delete route must strictly validate zone route ID'
)

for (const forbiddenPattern of [
  'const zoneId = Number(request.params.id)',
  'Number.isInteger(zoneId)',
  'isNaN(zoneId)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `admin hosting routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

console.log('admin hosting route ID guard tests passed')
