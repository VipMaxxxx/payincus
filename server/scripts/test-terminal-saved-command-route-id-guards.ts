import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/terminal-saved-commands.ts'), 'utf8')
const dbSource = readFileSync(resolve(process.cwd(), 'src/db/terminal-saved-commands.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'terminal saved command routes must use a strict positive safe-integer route ID parser'
)

assert.equal(
  routeSource.match(/const commandId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  2,
  'terminal saved command update/delete routes must strictly validate command IDs'
)

for (const forbiddenPattern of [
  'const commandId = Number(request.params.id)',
  'Number.isNaN(commandId)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `terminal saved command routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  dbSource.includes('WHERE id = $1 AND user_id = $2') &&
    dbSource.includes('DELETE FROM terminal_saved_commands') &&
    dbSource.includes('UPDATE terminal_saved_commands'),
  'terminal saved command DB helpers must keep user ownership filters on update/delete'
)

console.log('terminal saved command route ID guard tests passed')
