import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const suspendSource = readFileSync(resolve(__dirname, '../src/db/instance-suspend.ts'), 'utf8')
const schedulerSource = readFileSync(resolve(__dirname, '../src/services/billing-scheduler.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const suspendFunction = sectionBetween(
  suspendSource,
  'export async function suspendInstanceByExpiry(',
  '/**\n * 封停实例（管理员或宿主机所有者手动封停）'
)

assert.ok(suspendFunction.includes('prisma.instance.updateMany'), 'expiry suspend must use conditional updateMany')
assert.ok(suspendFunction.includes('packagePlanId: { not: null }'), 'expiry suspend must only process paid instances')
assert.ok(suspendFunction.includes('expiresAt:') && suspendFunction.includes('lt: new Date()'), 'expiry suspend must recheck expiresAt at update time')
assert.ok(suspendFunction.includes("status: { notIn: ['suspended', 'deleted'] }"), 'expiry suspend must not overwrite suspended or deleted instances')
assert.ok(suspendFunction.includes('version: { increment: 1 }'), 'expiry suspend must increment instance version')
assert.ok(suspendFunction.includes('if (result.count === 0) return null'), 'expiry suspend must report stale ineligible rows')

const autoRenewAttemptFunction = sectionBetween(
  suspendSource,
  'export async function updateAutoRenewAttempt(',
  '/**\n * 重置自动续费尝试记录'
)

assert.ok(autoRenewAttemptFunction.includes('prisma.instance.updateMany'), 'auto-renew attempt updates must be conditional')
assert.ok(autoRenewAttemptFunction.includes('autoRenew: true'), 'auto-renew attempt updates must require auto-renew to still be enabled')
assert.ok(autoRenewAttemptFunction.includes('gt: guard.now'), 'auto-renew attempt updates must require the instance to still be unexpired')
assert.ok(autoRenewAttemptFunction.includes('lte: guard.expiryThreshold'), 'auto-renew attempt updates must require the instance to remain in the renewal window')
assert.ok(autoRenewAttemptFunction.includes("status: { notIn: ['suspended', 'deleted'] }"), 'auto-renew attempt updates must skip suspended/deleted rows')
assert.ok(autoRenewAttemptFunction.includes('version: guard.version'), 'auto-renew attempt updates must use the locked instance version')
assert.ok(autoRenewAttemptFunction.includes('autoRenewAttempts: guard.currentAttempts'), 'auto-renew attempt updates must claim the expected attempt counter')
assert.ok(autoRenewAttemptFunction.includes('return result.count > 0'), 'auto-renew attempt updates must report stale rows to the scheduler')

const expiryNotificationClaimFunction = sectionBetween(
  suspendSource,
  'export async function updateExpiryNotifiedAt(',
  '/**\n * 获取需要自动续费的实例'
)

assert.ok(expiryNotificationClaimFunction.includes('prisma.instance.updateMany'), 'expiry notification timestamp updates must be conditional claims')
assert.ok(expiryNotificationClaimFunction.includes('gte: guard.minExpiresAt'), 'expiry notification claims must keep the lower expiry window guard')
assert.ok(expiryNotificationClaimFunction.includes('lt: guard.maxExpiresAt'), 'expiry notification claims must keep the upper expiry window guard')
assert.ok(expiryNotificationClaimFunction.includes('autoRenew: false'), 'expiry notification claims must skip instances that enabled auto-renew')
assert.ok(expiryNotificationClaimFunction.includes("status: { notIn: ['suspended', 'deleted'] }"), 'expiry notification claims must skip suspended/deleted instances')
assert.ok(expiryNotificationClaimFunction.includes('{ expiryNotifiedAt: null }'), 'expiry notification claims must allow never-notified rows')
assert.ok(expiryNotificationClaimFunction.includes('{ expiryNotifiedAt: { lt: guard.recentNotificationCutoff } }'), 'expiry notification claims must skip recently notified rows')
assert.ok(expiryNotificationClaimFunction.includes('return result.count > 0'), 'expiry notification claims must report stale rows to the scheduler')

const processSuspend = sectionBetween(
  schedulerSource,
  'async function processExpirySuspend(instance: any): Promise<void> {',
  '// ==================== 到期删除任务 ===================='
)

assert.ok(processSuspend.includes('const suspendedInstance = await suspendInstanceByExpiry'), 'scheduler must use the conditional suspend result')
assert.ok(processSuspend.includes('if (!suspendedInstance)'), 'scheduler must skip stale expiry suspend rows')
assert.ok(processSuspend.includes('return'), 'scheduler stale suspend branch must stop side effects')

const processAutoRenew = sectionBetween(
  schedulerSource,
  'async function processAutoRenew(instance: any): Promise<void> {',
  '// ==================== 到期封停任务 ===================='
)

const latestReadIndex = processAutoRenew.indexOf('const latestInstance = await prisma.instance.findUnique')
const performRenewalIndex = processAutoRenew.indexOf('const result = await performRenewal')
assert.notEqual(latestReadIndex, -1, 'auto-renew must re-read the instance inside the per-instance scheduler lock')
assert.notEqual(performRenewalIndex, -1, 'auto-renew renewal call not found')
assert.ok(latestReadIndex < performRenewalIndex, 'auto-renew eligibility must be rechecked before renewal side effects')
assert.ok(processAutoRenew.includes('!latestInstance.autoRenew'), 'auto-renew must skip when autoRenew was disabled after the initial scan')
assert.ok(processAutoRenew.includes('latestInstance.expiresAt <= now'), 'auto-renew must skip stale rows that are no longer in the pre-expiry window')
assert.ok(processAutoRenew.includes('latestInstance.expiresAt > expiryThreshold'), 'auto-renew must skip rows renewed beyond the threshold after the initial scan')
assert.ok(processAutoRenew.includes("latestInstance.status === 'suspended'") && processAutoRenew.includes("latestInstance.status === 'deleted'"), 'auto-renew must skip suspended/deleted rows after the initial scan')
assert.ok(processAutoRenew.includes('instance = latestInstance'), 'auto-renew must use the reloaded instance for attempts, pricing, and optimistic version')
assert.ok(processAutoRenew.includes('const attemptGuard = buildAutoRenewAttemptGuard(instance, now, expiryThreshold)'), 'auto-renew must build attempt guards from the locked instance snapshot')
assert.ok(processAutoRenew.includes('const attemptClaimed = await updateAutoRenewAttempt'), 'auto-renew must claim failed attempts before user-facing failure side effects')
assert.ok(processAutoRenew.includes('if (!attemptClaimed)'), 'auto-renew must skip stale failed attempts')
assert.ok(processAutoRenew.includes('Skip auto-renew failure notification'), 'auto-renew must avoid stale failure notifications after an attempt claim fails')

const processDelete = sectionBetween(
  schedulerSource,
  'async function processExpiryDelete(instance: any): Promise<void> {',
  '// ==================== 到期提醒任务 ===================='
)

const claimIndex = processDelete.indexOf('const claimResult = await prisma.instance.updateMany')
const incusDeleteIndex = processDelete.indexOf('await deleteIncusInstance')
const dbDeleteIndex = processDelete.indexOf('await prisma.instance.delete')
const restoreIndex = processDelete.indexOf('await restoreExpiryDeleteClaim(instance)')

assert.notEqual(claimIndex, -1, 'expiry delete must conditionally claim the instance before side effects')
assert.notEqual(incusDeleteIndex, -1, 'expiry delete Incus delete not found')
assert.notEqual(dbDeleteIndex, -1, 'expiry delete database delete not found')
assert.notEqual(restoreIndex, -1, 'expiry delete must restore claimed rows when Incus deletion cannot be completed')
assert.ok(claimIndex < incusDeleteIndex, 'expiry delete must claim before Incus deletion')
assert.ok(claimIndex < dbDeleteIndex, 'expiry delete must claim before database deletion')
assert.ok(incusDeleteIndex < dbDeleteIndex, 'expiry delete must delete Incus before database deletion')
assert.ok(processDelete.includes('version: instance.version'), 'expiry delete claim must use optimistic version')
assert.ok(processDelete.includes("status: 'suspended'"), 'expiry delete claim must require suspended status')
assert.ok(processDelete.includes("suspendReason: 'expired'"), 'expiry delete claim must require expired suspension')
assert.ok(processDelete.includes("status: 'deleted'"), 'expiry delete claim must mark the row deleted')
assert.ok(processDelete.includes('version: { increment: 1 }'), 'expiry delete claim must increment version')
assert.ok(processDelete.includes('if (claimResult.count === 0)'), 'expiry delete must skip stale ineligible rows')
assert.ok(
  processDelete.includes('if (!host)') && processDelete.includes('restored expired suspension'),
  'expiry delete must stop and restore when the host or Incus deletion is unavailable'
)

const processNotify = sectionBetween(
  schedulerSource,
  'async function notifyExpiringInstances(days: number): Promise<void> {',
  '// ==================== 充值订单清理任务 ===================='
)

const notifyLatestIndex = processNotify.indexOf('const latest = await prisma.instance.findUnique')
const notifySendIndex = processNotify.indexOf("await sendNotification(instance.userId, 'instance_expiring'")
const notifyClaimIndex = processNotify.indexOf('const notificationClaimed = await updateExpiryNotifiedAt(instance.id, {')
assert.notEqual(notifyLatestIndex, -1, 'expiry notify must re-read the instance inside the per-instance scheduler lock')
assert.notEqual(notifyClaimIndex, -1, 'expiry notify must conditionally claim the notification before user-facing side effects')
assert.notEqual(notifySendIndex, -1, 'expiry notification send call not found')
assert.ok(notifyLatestIndex < notifySendIndex, 'expiry notify eligibility must be rechecked before user-facing side effects')
assert.ok(notifyClaimIndex < notifySendIndex, 'expiry notify must claim before sending user-facing side effects')
assert.ok(processNotify.includes('expiryNotifiedAt: true'), 'expiry notify must recheck recent notification state')
assert.ok(processNotify.includes('expiresAt: true'), 'expiry notify must reload current expiry time')
assert.ok(processNotify.includes('autoRenew: true'), 'expiry notify must reload current auto-renew state')
assert.ok(processNotify.includes('status: true'), 'expiry notify must reload current instance status')
assert.ok(processNotify.includes('latest.autoRenew'), 'expiry notify must skip instances that enabled auto-renew after the initial scan')
assert.ok(processNotify.includes('!latest.expiresAt'), 'expiry notify must skip rows without a current expiry time')
assert.ok(processNotify.includes('latest.expiresAt < minThreshold'), 'expiry notify must skip rows renewed out of the lower notification window')
assert.ok(processNotify.includes('latest.expiresAt >= maxThreshold'), 'expiry notify must skip rows renewed out of the upper notification window')
assert.ok(
  processNotify.includes("latest.status === 'suspended'") && processNotify.includes("latest.status === 'deleted'"),
  'expiry notify must skip suspended/deleted rows after the initial scan'
)
assert.ok(processNotify.includes('if (!notificationClaimed)'), 'expiry notify must skip side effects when the notification claim fails')
assert.ok(processNotify.includes('notification already claimed or no longer eligible'), 'expiry notify must log stale notification claims')
assert.ok(processNotify.includes('newExpiresAt: latest.expiresAt.toISOString()'), 'expiry notify must send the reloaded expiry time')
assert.ok(processNotify.includes('expiresAt: latest.expiresAt'), 'expiry reminder email must use the reloaded expiry time')

console.log('billing expiry race guard tests passed')
