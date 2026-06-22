import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/storage-configs.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'storage config routes must use a strict positive safe-integer route ID parser'
)

assert.equal(
  routeSource.match(/const id = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  4,
  'all storage config :id routes must strictly validate route IDs'
)

for (const forbiddenPattern of [
  'const id = Number(request.params.id)',
  'isNaN(id)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `storage config routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

console.log('storage config route ID guard tests passed')
