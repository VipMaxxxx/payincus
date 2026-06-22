import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const routePath = resolve(process.cwd(), 'src/routes/proxy-sites.ts')
const source = readFileSync(routePath, 'utf8')

assert.ok(
  source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'proxy site routes must use a strict positive safe-integer route ID parser'
)

assert.equal(
  source.match(/const instanceId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  8,
  'all proxy site instance path IDs must use the strict parser'
)

assert.equal(
  source.match(/const siteId = parsePositiveRouteId\(request\.params\.siteId\)/g)?.length ?? 0,
  6,
  'all proxy site path IDs must use the strict parser'
)

const forbiddenPatterns = [
  'parseInt(request.params.id, 10)',
  'parseInt(request.params.siteId, 10)',
  'isNaN(instanceId)',
  'isNaN(siteId)'
]

for (const pattern of forbiddenPatterns) {
  assert.ok(!source.includes(pattern), `proxy site route ID guard must not use ${pattern}`)
}

console.log('proxy site route ID guard tests passed')
