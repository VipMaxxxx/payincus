import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const agentRouteSource = readFileSync(resolve(__dirname, '../src/routes/agent.ts'), 'utf8')

const parserStart = agentRouteSource.indexOf('function parsePositiveId(value: string): number | null')
assert.notEqual(parserStart, -1, 'Agent route positive ID parser not found')
const parserEnd = agentRouteSource.indexOf('function sanitizeShortString', parserStart)
assert.notEqual(parserEnd, -1, 'Agent route positive ID parser end marker not found')
const parserSection = agentRouteSource.slice(parserStart, parserEnd)

assert.ok(
  agentRouteSource.includes('const positiveRouteIdPattern = /^[1-9]\\d*$/'),
  'Agent route path IDs must use a strict positive integer regex'
)
assert.ok(
  parserSection.includes('positiveRouteIdPattern.test(value)') &&
    parserSection.includes('const id = Number(value)'),
  'Agent route path ID parser must reject malformed values before numeric conversion'
)
assert.ok(
  !parserSection.includes('Number.parseInt') && !parserSection.includes('parseInt'),
  'Agent route path ID parser must not use loose parseInt semantics'
)

const hostIdParseCount = (agentRouteSource.match(/parsePositiveId\(request\.params\.hostId\)/g) ?? []).length
assert.equal(
  hostIdParseCount,
  6,
  'all Agent host status/install/credential route IDs must use strict positive parsing'
)

console.log('agent route ID guard tests passed')
