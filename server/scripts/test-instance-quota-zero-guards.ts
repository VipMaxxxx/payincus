import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')

const routeStart = source.indexOf("}>('/:id/quota'")
assert.notEqual(routeStart, -1, 'missing instance quota update route')
const routeEnd = source.indexOf('// ==================== 修改实例资源配置 ====================', routeStart)
assert.notEqual(routeEnd, -1, 'missing instance quota update route end marker')
const quotaRoute = source.slice(routeStart, routeEnd)

for (const [field, existingColumn] of [
  ['portLimit', 'port_limit'],
  ['snapshotLimit', 'snapshot_limit'],
  ['backupLimit', 'backup_limit'],
  ['siteLimit', 'site_limit']
] as const) {
  assert.ok(
    quotaRoute.includes(`const new${field[0].toUpperCase()}${field.slice(1)} = ${field} !== undefined ? ${field} : instance.${existingColumn}`),
    `quota route must preserve explicit ${field}=0/null instead of using truthy fallback`
  )
}

for (const unsafePattern of [
  'portLimit || null',
  'snapshotLimit || null',
  'backupLimit || null',
  'siteLimit || null',
  'siteLimit === 0 ? 0 :'
] as const) {
  assert.ok(
    !quotaRoute.includes(unsafePattern),
    `quota route must not collapse explicit zero through ${unsafePattern}`
  )
}

assert.ok(
  quotaRoute.includes("snapshotLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 }") &&
    quotaRoute.includes("backupLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 }") &&
    quotaRoute.includes("siteLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 }"),
  'snapshot, backup, and site quota schemas must allow explicit zero as no quota'
)

assert.ok(
  quotaRoute.includes('if (newSnapshotLimit !== null && newSnapshotLimit < currentSnapshotUsed)') &&
    quotaRoute.includes('if (newBackupLimit !== null && newBackupLimit < currentBackupUsed)'),
  'snapshot and backup explicit zero must participate in below-used validation'
)

assert.ok(
  quotaRoute.includes('newSnapshotLimit !== null && (newSnapshotLimit < 0 || newSnapshotLimit > 1000)') &&
    quotaRoute.includes('newBackupLimit !== null && (newBackupLimit < 0 || newBackupLimit > 1000)') &&
    quotaRoute.includes('newSiteLimit !== null && (newSiteLimit < 0 || newSiteLimit > 1000)'),
  'snapshot, backup, and site range checks must allow zero but cap values at 1000'
)

assert.ok(
  quotaRoute.includes('snapshotLimit !== undefined ? (snapshotLimit ?? undefined) : undefined') &&
    quotaRoute.includes('backupLimit !== undefined ? (backupLimit ?? undefined) : undefined') &&
    quotaRoute.includes('siteLimit !== undefined ? (siteLimit ?? undefined) : undefined'),
  'quota persistence must keep explicit zero while still allowing null to clear the override'
)

console.log('instance quota zero guard tests passed')
