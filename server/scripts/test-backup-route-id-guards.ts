import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/backups.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'backup routes must use a strict positive safe-integer route ID parser'
)

assert.equal(
  routeSource.match(/const instanceIdNum = parsePositiveRouteId\(instanceId\)/g)?.length ?? 0,
  18,
  'all backup instance path IDs must use the strict parser'
)

assert.equal(
  routeSource.match(/const backupIdNum = parsePositiveRouteId\(backupId\)/g)?.length ?? 0,
  4,
  'all backup ID path params must use the strict parser'
)

assert.equal(
  routeSource.match(/const taskIdNum = parsePositiveRouteId\(taskId\)/g)?.length ?? 0,
  5,
  'all restore/upload task path params must use the strict parser'
)

for (const forbiddenPattern of [
  'const instanceIdNum = Number(instanceId)',
  'const backupIdNum = Number(backupId)',
  'const taskIdNum = Number(taskId)',
  'isNaN(instanceIdNum)',
  'isNaN(backupIdNum)',
  'isNaN(taskIdNum)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `backup routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  routeSource.includes('function buildBackupExportDownloadTokenResourceId(instanceId: number, taskId: string): string') &&
    routeSource.includes('return `${instanceId}:${taskId}`'),
  'backup export download tokens must bind both instance ID and task ID'
)

assert.ok(
  routeSource.includes('buildBackupExportDownloadTokenResourceId(instanceIdNum, taskId),\n        \'backup-export\'') &&
    routeSource.includes('consumeDownloadToken(\n          downloadToken,\n          buildBackupExportDownloadTokenResourceId(instanceIdNum, taskId),\n          \'backup-export\''),
  'backup export download token generation and consumption must use the same instance/task resource binding'
)

console.log('backup route ID guard tests passed')
