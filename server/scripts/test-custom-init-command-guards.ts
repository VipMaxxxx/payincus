import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/custom-init-commands.ts'), 'utf8')
const dbSource = readFileSync(resolve(process.cwd(), 'src/db/custom-init-commands.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'custom init command routes must use a strict positive safe-integer route ID parser'
)

assert.equal(
  routeSource.match(/const cmdId = parsePositiveRouteId\(id\)/g)?.length ?? 0,
  3,
  'custom init command detail/update/delete routes must strictly validate command IDs'
)

assert.ok(
  routeSource.includes("const VALID_QUERY_DISTROS = [...VALID_DISTROS, 'other']") &&
    routeSource.includes('if (!VALID_QUERY_DISTROS.includes(distro))') &&
    routeSource.includes("return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid distro'))"),
  'custom init command available route must reject malformed distro filters while allowing other'
)

for (const forbiddenPattern of [
  'const cmdId = Number(id)',
  'isNaN(cmdId)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `custom init command routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  dbSource.includes('where: {\n      id: { in: commandIds },\n      userId,\n      enabled: true') &&
    dbSource.includes('if (commands.length !== commandIds.length)'),
  'custom init command use during provisioning must validate ownership and enabled state'
)

console.log('custom init command guard tests passed')
