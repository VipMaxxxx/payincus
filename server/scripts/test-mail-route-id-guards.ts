import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')

assert.ok(
  routeSource.includes('const POSITIVE_ROUTE_ID_RE = /^[1-9]\\d*$/') &&
    routeSource.includes('function parsePositiveRouteId(value: unknown): number') &&
    routeSource.includes('Number.isSafeInteger(value) && value > 0') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'mail routes must define a strict positive route ID parser'
)

assert.equal(
  (routeSource.match(/parsePositiveRouteId\(request\.params\.id\)/g) ?? []).length,
  9,
  'mail source, plan, subscription, and domain :id routes must use strict positive ID parsing'
)

assert.equal(
  (routeSource.match(/parsePositiveRouteId\(request\.params\.domainId\)/g) ?? []).length,
  5,
  'mail account routes must parse domainId with strict positive ID parsing'
)

assert.equal(
  (routeSource.match(/parsePositiveRouteId\(request\.params\.accountId\)/g) ?? []).length,
  3,
  'mail account item routes must parse accountId with strict positive ID parsing'
)

for (const forbiddenPattern of [
  'parseInt(request.params.id',
  'parseInt(request.params.domainId',
  'parseInt(request.params.accountId',
  'Number(request.params.id)',
  'Number(request.params.domainId)',
  'Number(request.params.accountId)'
] as const) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `mail routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

console.log('mail route ID guard tests passed')
