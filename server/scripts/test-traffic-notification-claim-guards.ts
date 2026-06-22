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
  markWarningSection.includes('const currentMonthStart = new Date(sentAt.getFullYear(), sentAt.getMonth(), 1)') &&
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
  warningSection.includes('const shouldNotifyWarning = await trafficDb.markUserTrafficWarningIfNeeded(instance.userId, new Date())') &&
    warningSection.includes('if (shouldNotifyWarning)') &&
    warningSection.indexOf('markUserTrafficWarningIfNeeded(instance.userId, new Date())') <
      warningSection.indexOf('sendTrafficWarningNotification(') &&
    !warningSection.includes('await trafficDb.updateUserTrafficWarningSentAt(instance.userId, new Date())'),
  'traffic scheduler must send warning notifications only after claiming this month warning state'
)

console.log('traffic notification claim guard checks passed')
