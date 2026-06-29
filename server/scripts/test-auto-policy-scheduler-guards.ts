import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const schedulerSource = readFileSync(resolve(__dirname, '../src/services/auto-policy-scheduler.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const lockedSnapshotSection = sectionBetween(
  schedulerSource,
  'async function executeLockedAutoSnapshot(',
  '/**\n * 运行自动快照任务'
)
const jobSection = sectionBetween(
  schedulerSource,
  'export async function runAutoSnapshotJob(): Promise<void> {',
  '/**\n * 启动自动策略调度器'
)

assert.ok(
  schedulerSource.includes("import { acquireLock, releaseLock } from '../lib/distributed-lock.js'"),
  'auto snapshot scheduler must import the distributed lock helpers'
)
assert.ok(
  schedulerSource.includes("import { getExchangeOperationLock } from './exchange-operation-lock.js'"),
  'auto snapshot scheduler must import exchange operation lock checks'
)
assert.ok(
  schedulerSource.includes('const AUTO_POLICY_LOCK_EXPIRE_MS = 30 * 60 * 1000') &&
    schedulerSource.includes('const AUTO_POLICY_LOCK_WAIT_MS = 100'),
  'auto snapshot scheduler must use explicit lock expiry and short wait constants'
)
assert.ok(
  schedulerSource.includes('function getAutoSnapshotPolicyLockKey(instanceId: number): string') &&
    schedulerSource.includes('return `auto-policy:snapshot:${instanceId}`'),
  'auto snapshot scheduler must use per-instance policy lock keys'
)

const acquireIndex = lockedSnapshotSection.indexOf('const lockResult = await acquireLock(lockKey, {')
const latestPolicyIndex = lockedSnapshotSection.indexOf('const policy = await prisma.snapshotPolicy.findUnique')
const nextRunGuardIndex = lockedSnapshotSection.indexOf('policy.nextRunAt !== null && policy.nextRunAt > now')
const eligibilityGuardIndex = lockedSnapshotSection.indexOf("!['running', 'stopped'].includes(policy.instance.status)")
const exchangeLockIndex = lockedSnapshotSection.indexOf('const exchangeLock = await getExchangeOperationLock(candidate.instanceId)')
const exchangeLockGuardIndex = lockedSnapshotSection.indexOf('if (exchangeLock.locked)')
const executeIndex = lockedSnapshotSection.indexOf('await executeAutoSnapshot({')
const releaseIndex = lockedSnapshotSection.indexOf('await releaseLock(lockKey, lockResult.ownerId)')

assert.notEqual(acquireIndex, -1, 'auto snapshot scheduler must acquire a per-instance lock')
assert.notEqual(latestPolicyIndex, -1, 'auto snapshot scheduler must re-read the policy after acquiring the lock')
assert.notEqual(nextRunGuardIndex, -1, 'auto snapshot scheduler must re-check nextRunAt after acquiring the lock')
assert.notEqual(eligibilityGuardIndex, -1, 'auto snapshot scheduler must re-check instance and host eligibility after acquiring the lock')
assert.notEqual(exchangeLockIndex, -1, 'auto snapshot scheduler must check exchange operation locks after acquiring the lock')
assert.notEqual(exchangeLockGuardIndex, -1, 'auto snapshot scheduler must skip exchange-listed or exchange-ordered instances')
assert.notEqual(executeIndex, -1, 'auto snapshot scheduler must call the snapshot side effect only after locked checks')
assert.notEqual(releaseIndex, -1, 'auto snapshot scheduler must release the per-instance lock')
assert.ok(acquireIndex < latestPolicyIndex, 'policy re-read must happen after acquiring the lock')
assert.ok(latestPolicyIndex < nextRunGuardIndex, 'latest policy must be loaded before checking nextRunAt')
assert.ok(nextRunGuardIndex < executeIndex, 'nextRunAt must be rechecked before snapshot side effects')
assert.ok(eligibilityGuardIndex < executeIndex, 'instance and host eligibility must be rechecked before snapshot side effects')
assert.ok(eligibilityGuardIndex < exchangeLockIndex, 'exchange lock check must happen after current eligibility is confirmed')
assert.ok(exchangeLockIndex < exchangeLockGuardIndex, 'exchange lock must be loaded before checking locked state')
assert.ok(exchangeLockGuardIndex < executeIndex, 'exchange lock check must run before snapshot side effects')
assert.ok(executeIndex < releaseIndex, 'lock release must happen after snapshot side effects finish')
assert.ok(
  lockedSnapshotSection.includes('if (!lockResult.success || !lockResult.ownerId)') &&
    lockedSnapshotSection.includes('lock already held'),
  'auto snapshot scheduler must skip when another worker owns the lock'
)
assert.ok(
  lockedSnapshotSection.includes('exchange locked') &&
    lockedSnapshotSection.includes('return'),
  'auto snapshot scheduler must return without snapshot side effects when exchange locked'
)

assert.ok(
  jobSection.includes('limit(() => executeLockedAutoSnapshot(policy))'),
  'auto snapshot job must execute candidates through the locked wrapper'
)
assert.ok(
  !jobSection.includes('limit(() => executeAutoSnapshot({'),
  'auto snapshot job must not call snapshot side effects directly from the stale candidate list'
)

console.log('auto policy scheduler guard tests passed')
