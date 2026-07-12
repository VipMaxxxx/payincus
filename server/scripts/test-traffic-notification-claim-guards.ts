import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  assert.notEqual(start, -1, `Missing section start: ${startPattern}`)
  const end = source.indexOf(endPattern, start)
  assert.notEqual(end, -1, `Missing section end: ${endPattern}`)
  return source.slice(start, end)
}

const trafficDbSource = readRepoFile('server/src/db/traffic.ts')
const trafficSchedulerSource = readRepoFile('server/src/services/traffic-scheduler.ts')
const trafficNotifierSource = readRepoFile('server/src/services/traffic-notifier.ts')

const markInstanceWarningSection = section(
  trafficSchedulerSource,
  'async function markInstanceTrafficWarningIfNeeded(',
  '/**\n * 获取或创建主机客户端'
)
assert.ok(
  markInstanceWarningSection.includes('prisma.instance.updateMany') &&
    markInstanceWarningSection.includes("status: { not: 'deleted' }") &&
    markInstanceWarningSection.includes("trafficStatus: 'NORMAL'") &&
    markInstanceWarningSection.includes("data: { trafficStatus: 'WARNING' }") &&
    markInstanceWarningSection.includes('return result.count > 0'),
  'instance traffic warning must be claimed with a conditional NORMAL-to-WARNING update'
)

const markLimitedSection = section(
  trafficDbSource,
  'export async function markInstanceTrafficLimitedIfNeeded(',
  '/**\n * 更新用户流量状态'
)
assert.ok(
  markLimitedSection.includes('prisma.instance.updateMany') &&
    markLimitedSection.includes("status: { not: 'deleted' }") &&
    markLimitedSection.includes("trafficStatus: { not: 'LIMITED' }") &&
    markLimitedSection.includes("data: { trafficStatus: 'LIMITED' }") &&
    markLimitedSection.includes('return result.count > 0'),
  'instance throttled notification must be claimed with a conditional trafficStatus update'
)

const markWarningSection = section(
  trafficDbSource,
  'export async function markUserTrafficWarningIfNeeded(',
  '// ==================== 月度重置操作'
)
assert.ok(
  markWarningSection.includes('const currentMonthStart = startOfMonthShanghai(sentAt)') &&
    markWarningSection.includes('prisma.userQuota.updateMany') &&
    markWarningSection.includes('{ trafficWarningSentAt: null }') &&
    markWarningSection.includes('{ trafficWarningSentAt: { lt: currentMonthStart } }') &&
    markWarningSection.includes("trafficStatus: 'WARNING'") &&
    markWarningSection.includes('trafficWarningSentAt: sentAt') &&
    markWarningSection.includes('return result.count > 0'),
  'traffic warning notification must be claimed with a monthly conditional update'
)

const throttleSection = section(
  trafficSchedulerSource,
  'if (userOverLimit || instanceOverLimit) {',
  '} else {'
)
assert.ok(
  throttleSection.includes('const shouldNotifyThrottled = await trafficDb.markInstanceTrafficLimitedIfNeeded(instance.id)') &&
    throttleSection.includes('if (shouldNotifyThrottled)') &&
    throttleSection.indexOf('markInstanceTrafficLimitedIfNeeded(instance.id)') <
      throttleSection.indexOf('sendTrafficThrottledNotification(') &&
    !throttleSection.includes("await trafficDb.updateInstanceTrafficStatus(instance.id, 'LIMITED')"),
  'traffic scheduler must send throttled notifications only after claiming the LIMITED transition'
)

const warningSection = section(
  trafficSchedulerSource,
  '// 检查预警',
  '/**\n * 检查并恢复带宽'
)
assert.ok(
  warningSection.includes('const claimedAt = new Date()') &&
    warningSection.includes('const shouldNotifyWarning = await trafficDb.markUserTrafficWarningIfNeeded(instance.userId, claimedAt)') &&
    warningSection.includes('if (shouldNotifyWarning)') &&
    warningSection.indexOf('markUserTrafficWarningIfNeeded(instance.userId, claimedAt)') <
      warningSection.indexOf('sendTrafficWarningNotification(') &&
    !warningSection.includes('await trafficDb.updateUserTrafficWarningSentAt(instance.userId, new Date())'),
  'traffic scheduler must send warning notifications only after claiming this month warning state'
)

assert.ok(
  warningSection.includes('const instanceWarning = isWarningThreshold(instance.monthlyTrafficUsed, instanceLimit)') &&
    warningSection.includes("instance.trafficStatus === 'NORMAL'") &&
    warningSection.includes('const shouldNotifyWarning = await markInstanceTrafficWarningIfNeeded(instance.id)') &&
    warningSection.indexOf('markInstanceTrafficWarningIfNeeded(instance.id)') <
      warningSection.lastIndexOf('sendTrafficWarningNotification(') &&
    warningSection.includes('instance.monthlyTrafficUsed') &&
    warningSection.includes('instanceLimit!') &&
    warningSection.includes('instance.name'),
  'traffic scheduler must warn at the instance 80% threshold only after claiming its warning state'
)

const notifierWarningSection = section(
  trafficNotifierSource,
  'export async function sendTrafficWarningNotification(',
  '/**\n * 发送流量限速通知'
)
assert.ok(
  notifierWarningSection.includes('instanceName?: string') &&
    notifierWarningSection.includes('instanceName ?') &&
    notifierWarningSection.includes('${instanceName}'),
  'instance traffic warning notification must identify the affected instance'
)

assert.ok(
  notifierWarningSection.includes('): Promise<boolean>') &&
    notifierWarningSection.includes('let allChannelsSent = true') &&
    notifierWarningSection.includes('if (!result.success) allChannelsSent = false') &&
    notifierWarningSection.includes('return allChannelsSent') &&
    notifierWarningSection.includes('return false'),
  'traffic warning notifier must report delivery failure instead of swallowing it as success'
)

const notifierContextSection = section(
  trafficNotifierSource,
  'async function resolveTrafficNotificationContext(',
  '/**\n * 发送流量预警通知'
)
const notifierThrottleSection = section(
  trafficNotifierSource,
  'export async function sendTrafficThrottledNotification(',
  '/**\n * 发送 Telegram 通知'
)
assert.ok(
  notifierContextSection.includes('packagePlan:') &&
    notifierContextSection.includes('trafficLimitSpeed: true') &&
    notifierContextSection.includes('trafficResetDay: true') &&
    notifierContextSection.includes('TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY') &&
    notifierContextSection.includes('normalLineSpeed') &&
    notifierWarningSection.includes('${context.throttleSpeed}') &&
    notifierWarningSection.includes('${context.resetDay}') &&
    notifierWarningSection.includes('${context.normalLineSpeed}') &&
    notifierThrottleSection.includes('${context.throttleSpeed}') &&
    notifierThrottleSection.includes('${context.resetDay}') &&
    notifierThrottleSection.includes('${context.normalLineSpeed}'),
  'traffic notifications must use configured throttle speed, plan normal speed, and host reset day'
)
assert.ok(
  !notifierWarningSection.includes('1Mbit') &&
    !notifierThrottleSection.includes('1Mbit') &&
    !notifierThrottleSection.includes('下月 1 日') &&
    !notifierThrottleSection.includes('下月1日'),
  'traffic notifications must not hard-code 1Mbit or a first-of-next-month reset'
)

assert.ok(
  warningSection.includes('const claimedAt = new Date()') &&
    warningSection.includes('const notificationSent = await sendTrafficWarningNotification(') &&
    warningSection.includes('await releaseUserTrafficWarningLease(') &&
    warningSection.includes('await releaseInstanceTrafficWarningLease(instance.id)') &&
    warningSection.indexOf('const notificationSent = await sendTrafficWarningNotification(') <
      warningSection.indexOf('await releaseUserTrafficWarningLease('),
  'failed traffic warning delivery must release its state lease so the next scheduler run can retry'
)

const releaseUserLeaseSection = section(
  trafficSchedulerSource,
  'async function releaseUserTrafficWarningLease(',
  'async function releaseInstanceTrafficWarningLease('
)
assert.ok(
  releaseUserLeaseSection.includes('trafficWarningSentAt: claimedAt') &&
    releaseUserLeaseSection.includes("trafficStatus: 'WARNING'") &&
    releaseUserLeaseSection.includes('trafficWarningSentAt: previousSentAt') &&
    releaseUserLeaseSection.includes('trafficStatus: previousStatus'),
  'user warning lease release must only roll back the matching claim and preserve its previous state'
)

console.log('traffic notification claim guard checks passed')
