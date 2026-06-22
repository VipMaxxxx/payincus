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

function assertStartGuard(path: string, startFunctionName: string, guardDeclaration: string): void {
  const source = readRepoFile(path)
  assert.ok(source.includes(guardDeclaration), `${path} must declare a scheduler start guard`)

  const startIndex = source.indexOf(`export function ${startFunctionName}(`)
  assert.notEqual(startIndex, -1, `${path} must export ${startFunctionName}`)

  const startBody = source.slice(startIndex)
  const guardCheckIndex = startBody.indexOf('if (schedulerStarted)')
  const guardSetIndex = startBody.indexOf('schedulerStarted = true')
  const scheduleIndex = startBody.indexOf('schedule(')
  const timerIndex = startBody.indexOf('setTimeout(')
  const firstSideEffectIndex = scheduleIndex === -1 ? timerIndex : timerIndex === -1 ? scheduleIndex : Math.min(scheduleIndex, timerIndex)

  assert.notEqual(guardCheckIndex, -1, `${startFunctionName} must return when scheduler is already started`)
  assert.notEqual(guardSetIndex, -1, `${startFunctionName} must mark scheduler as started`)
  assert.notEqual(firstSideEffectIndex, -1, `${startFunctionName} must register at least one timer`)
  assert.ok(guardCheckIndex < guardSetIndex, `${startFunctionName} must check the guard before setting it`)
  assert.ok(guardSetIndex < firstSideEffectIndex, `${startFunctionName} must set the guard before registering timers`)
}

assertStartGuard('server/src/services/auto-policy-scheduler.ts', 'startAutoPolicyScheduler', 'let schedulerStarted = false')
assertStartGuard('server/src/services/billing-scheduler.ts', 'startBillingScheduler', 'let schedulerStarted = false')
assertStartGuard('server/src/services/hosting-scheduler.ts', 'startHostingScheduler', 'let schedulerStarted = false')
assertStartGuard('server/src/services/status-scheduler.ts', 'startStatusScheduler', 'let schedulerStarted = false')
assertStartGuard('server/src/services/system-monitor.ts', 'startSystemMonitor', 'let schedulerStarted = false')
assertStartGuard('server/src/services/traffic-scheduler.ts', 'startTrafficScheduler', 'let schedulerStarted = false')

const mailExpirySource = readRepoFile('server/src/services/mail-expiry-scheduler.ts')
const mailStartIndex = mailExpirySource.indexOf('export function startMailExpiryScheduler(')
assert.notEqual(mailStartIndex, -1, 'mail expiry scheduler must export startMailExpiryScheduler')
const mailStartBody = mailExpirySource.slice(mailStartIndex)
const mailGuardIndex = mailStartBody.indexOf('if (schedulerInterval)')
const mailReturnIndex = mailStartBody.indexOf('return schedulerInterval')
const mailSetIntervalIndex = mailStartBody.indexOf('schedulerInterval = setInterval(')
assert.ok(
  mailExpirySource.includes('let schedulerInterval: NodeJS.Timeout | null = null'),
  'mail expiry scheduler must retain the created interval handle'
)
assert.notEqual(mailGuardIndex, -1, 'mail expiry scheduler must return the existing interval on repeated start')
assert.notEqual(mailReturnIndex, -1, 'mail expiry scheduler must return the existing interval handle')
assert.notEqual(mailSetIntervalIndex, -1, 'mail expiry scheduler must assign the interval handle')
assert.ok(mailGuardIndex < mailSetIntervalIndex, 'mail expiry scheduler must guard before registering a new interval')

console.log('scheduler startup idempotency checks passed')
