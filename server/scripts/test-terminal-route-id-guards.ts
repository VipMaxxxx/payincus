import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/terminal.ts'), 'utf8')

assert.ok(
  routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'terminal routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  routeSource.match(/parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  1,
  'terminal ticket route must strictly validate instance IDs before ticket issuance'
)

assert.equal(
  routeSource.match(/parsePositiveRouteId\(id\)/g)?.length ?? 0,
  1,
  'terminal WebSocket route must strictly validate instance IDs before ticket consumption'
)

for (const forbiddenPattern of [
  'const instanceId = Number(request.params.id)',
  'const instanceId = Number(id)',
  'isNaN(instanceId)',
  'Number.isNaN(instanceId)',
  'parseInt(request.params.id',
  'parseInt(id'
] as const) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `terminal routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

const invalidIdCheckIndex = routeSource.indexOf('if (instanceId === null)')
const consumeTicketIndex = routeSource.indexOf('consumeTerminalAccessTicket(ticket, instanceId)')
assert.notEqual(invalidIdCheckIndex, -1, 'terminal route must reject invalid IDs')
assert.notEqual(consumeTicketIndex, -1, 'terminal route must consume one-time tickets')
assert.ok(
  invalidIdCheckIndex < consumeTicketIndex,
  'terminal WebSocket route must reject malformed IDs before consuming one-time tickets'
)

console.log('terminal route ID guard tests passed')
