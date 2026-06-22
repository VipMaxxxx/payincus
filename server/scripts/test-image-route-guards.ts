import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/images.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveInteger(value: string | undefined): number | null | undefined') &&
    routeSource.includes('const POSITIVE_INTEGER_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'image routes must use strict positive safe-integer parsing'
)

assert.ok(
  routeSource.includes('const memoryNum = parsePositiveInteger(memory)') &&
    routeSource.includes('const hostIdNum = parsePositiveInteger(hostId)') &&
    routeSource.includes('if (memoryNum === null || hostIdNum === null)'),
  'image list query filters must reject malformed numeric query values'
)

assert.equal(
  routeSource.match(/const id = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  2,
  'image admin update/delete routes must strictly validate path IDs'
)

for (const forbiddenPattern of [
  'parseInt(memory, 10)',
  'parseInt(hostId, 10)',
  'parseInt(request.params.id)',
  'Number(request.params.id)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `image routes must not use loose numeric parsing: ${forbiddenPattern}`
  )
}

console.log('image route guard tests passed')
