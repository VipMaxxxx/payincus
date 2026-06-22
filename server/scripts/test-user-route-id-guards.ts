import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/users.ts'), 'utf8')

assert.ok(
  source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'user routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  source.match(/const userId = parsePositiveRouteId\(id\)/g)?.length ?? 0,
  6,
  'all destructured user route IDs must use strict positive route ID parsing'
)

assert.equal(
  source.match(/const userId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  9,
  'all direct request.params.id user routes must use strict positive route ID parsing'
)

for (const forbiddenPattern of [
  'const userId = Number(id)',
  'const userId = Number(request.params.id)',
  'const userId = parseInt(request.params.id, 10)',
  'isNaN(userId)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `user routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

console.log('user route ID guard tests passed')
