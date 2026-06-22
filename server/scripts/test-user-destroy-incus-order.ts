import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/instance-destroy.ts'), 'utf8')

function section(startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length
  if (endMarker) assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const helperSection = section(
  'async function deleteIncusInstanceForUserDestroy(',
  'async function settleUserDestroyBilling('
)
assert.ok(helperSection.includes('await stopInstance'), 'user destroy helper should stop running instances before delete')
assert.ok(helperSection.includes('await deleteInstance'), 'user destroy helper must require Incus instance deletion')
assert.ok(!helperSection.includes("logger.error(incusErr, 'Incus 删除实例失败')"), 'helper must not swallow Incus delete failures')

const batchSection = section(
  'async function executeDestroyForUser(',
  "fastify.post<{\n    Body: { instanceIds: number[] }"
)
const batchDeleteIndex = batchSection.indexOf('await deleteIncusInstanceForUserDestroy(instance, logger)')
const batchBillingIndex = batchSection.indexOf('await settleUserDestroyBilling({')
const batchCleanupIndex = batchSection.indexOf('await prisma.snapshot.deleteMany')
assert.ok(batchDeleteIndex !== -1, 'batch user destroy must call strict Incus delete helper')
assert.ok(batchBillingIndex !== -1, 'batch user destroy must still settle billing')
assert.ok(batchCleanupIndex !== -1, 'batch user destroy must still clean database resources')
assert.ok(batchDeleteIndex < batchBillingIndex, 'batch user destroy must delete Incus before billing/refund')
assert.ok(batchDeleteIndex < batchCleanupIndex, 'batch user destroy must delete Incus before database cleanup')
assert.ok(
  batchSection.includes('await restoreClaimedInstanceStatus(instanceId, user.id, instance.status)'),
  'batch user destroy must restore claimed DB status when Incus deletion fails'
)

const routeSection = section(
  "fastify.post<{ Params: { id: string }; Querystring: { feeWaiver?: string } }>('/:id/destroy'"
)
const routeDeleteIndex = routeSection.indexOf('await deleteIncusInstanceForUserDestroy(instance, request.log)')
const routeBillingIndex = routeSection.indexOf('await settleUserDestroyBilling({')
const routeCleanupIndex = routeSection.indexOf('await prisma.snapshot.deleteMany')
assert.ok(routeDeleteIndex !== -1, 'single user destroy must call strict Incus delete helper')
assert.ok(routeBillingIndex !== -1, 'single user destroy must still settle billing')
assert.ok(routeCleanupIndex !== -1, 'single user destroy must still clean database resources')
assert.ok(routeDeleteIndex < routeBillingIndex, 'single user destroy must delete Incus before billing/refund')
assert.ok(routeDeleteIndex < routeCleanupIndex, 'single user destroy must delete Incus before database cleanup')
assert.ok(
  routeSection.includes('await restoreClaimedInstanceStatus(instanceId, user.id, instance.status)'),
  'single user destroy must restore claimed DB status when Incus deletion fails'
)

const billingSection = section(
  'async function settleUserDestroyBilling(',
  'async function buildBatchDestroyPreviewItem('
)
assert.ok(
  billingSection.includes('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)'),
  'destroy refund should wait for the user balance lock instead of failing after Incus delete'
)
assert.ok(
  !billingSection.includes('tryAdvisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)'),
  'destroy refund should not use non-blocking balance lock'
)

console.log('user destroy Incus order tests passed')
