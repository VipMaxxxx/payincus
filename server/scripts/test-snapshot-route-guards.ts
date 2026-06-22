import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/snapshots.ts'), 'utf8')

function section(sourceText: string, startMarker: string, endMarker?: string): string {
  const start = sourceText.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = endMarker ? sourceText.indexOf(endMarker, start + startMarker.length) : sourceText.length
  if (endMarker) assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return sourceText.slice(start, end)
}

assert.ok(
  source.includes('const POSITIVE_INTEGER_ID_RE = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveId(value: unknown): number | null') &&
    source.includes('Number.isSafeInteger(value) && value > 0') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'snapshot routes must define a strict positive integer ID parser'
)

assert.equal(
  (source.match(/parsePositiveId\(request\.params\.instanceId\)/g) ?? []).length,
  6,
  'all snapshot instanceId route parameters must use strict positive ID parsing'
)

assert.equal(
  (source.match(/parsePositiveId\(request\.params\.snapshotId\)/g) ?? []).length,
  2,
  'snapshotId route parameters must use strict positive ID parsing'
)

for (const forbiddenPattern of [
  'Number(instanceId)',
  'Number(snapshotId)',
  'isNaN(instanceIdNum)',
  'isNaN(snapshotIdNum)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `snapshot routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

const createSnapshotRoute = section(
  source,
  "fastify.post<{",
  "  // 删除快照"
)
const lockAcquireIndex = createSnapshotRoute.indexOf('const lockResult = await acquireLock(lockKey, {')
const quotaCheckIndex = createSnapshotRoute.indexOf('const quotaCheck = await checkSnapshotQuota(instance.user_id, instanceIdNum)')
const incusCreateIndex = createSnapshotRoute.indexOf('await createSnapshot(client, instance.incus_id, incusName)')
const dbCreateIndex = createSnapshotRoute.indexOf('snapshotId = await db.createSnapshot({')
assert.ok(
  source.includes("import { acquireLock, releaseLock } from '../lib/distributed-lock.js'") &&
    source.includes('const SNAPSHOT_CREATE_LOCK_EXPIRE_MS = 30 * 60 * 1000') &&
    source.includes('const SNAPSHOT_CREATE_LOCK_WAIT_MS = 5000') &&
    source.includes('function getSnapshotCreateLockKey(instanceId: number): string') &&
    source.includes('return `auto-policy:snapshot:${instanceId}`'),
  'manual snapshot creation must use the shared per-instance snapshot distributed lock'
)
assert.ok(
  lockAcquireIndex !== -1 &&
    quotaCheckIndex !== -1 &&
    incusCreateIndex !== -1 &&
    dbCreateIndex !== -1 &&
    lockAcquireIndex < quotaCheckIndex &&
    quotaCheckIndex < incusCreateIndex &&
    incusCreateIndex < dbCreateIndex,
  'manual snapshot creation must acquire the per-instance lock before quota check, Incus creation, and DB creation'
)
assert.ok(
  createSnapshotRoute.includes("return reply.code(409).send(apiError(ErrorCode.OPERATION_NOT_ALLOWED, 'Snapshot operation is busy, please retry later'))") &&
    createSnapshotRoute.includes('} finally {') &&
    createSnapshotRoute.includes('await releaseLock(lockKey, lockResult.ownerId)'),
  'manual snapshot creation must return a conflict when the lock is busy and release the lock in finally'
)
assert.ok(
  createSnapshotRoute.includes('let snapshotId: number') &&
    createSnapshotRoute.includes('} catch (dbErr) {') &&
    createSnapshotRoute.includes('await deleteSnapshot(client, instance.incus_id, incusName)') &&
    createSnapshotRoute.includes('Failed to clean up Incus snapshot after database create failure') &&
    createSnapshotRoute.includes('throw dbErr'),
  'manual snapshot creation must clean up the Incus snapshot if database persistence fails'
)
assert.ok(
  createSnapshotRoute.includes('} catch (notifyErr) {') &&
    createSnapshotRoute.includes('Failed to send snapshot created notification') &&
    !createSnapshotRoute.includes("throw notifyErr"),
  'snapshot-created notification failures must not turn a successful snapshot create into a failed API response'
)

console.log('snapshot route guard tests passed')
