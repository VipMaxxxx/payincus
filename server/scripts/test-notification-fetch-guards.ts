import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const notifierSource = readFileSync(resolve(__dirname, '../src/lib/notifier.ts'), 'utf8')
const trafficNotifierSource = readFileSync(resolve(__dirname, '../src/services/traffic-notifier.ts'), 'utf8')
const lotteryNotifierSource = readFileSync(resolve(__dirname, '../src/lib/lottery-notifier.ts'), 'utf8')

assert.ok(
  notifierSource.includes('const NOTIFICATION_FETCH_TIMEOUT_MS = 15_000'),
  'main notifier outbound fetches must define a bounded timeout'
)
assert.ok(
  notifierSource.includes('const NOTIFICATION_ERROR_PREVIEW_MAX_CHARS = 2_000'),
  'main notifier must cap upstream error response previews before logging'
)
assert.ok(
  notifierSource.includes("import { sanitizeTokensInString } from './log-sanitizer.js'"),
  'main notifier must sanitize token-like upstream error responses'
)
assert.equal(
  (notifierSource.match(/signal: AbortSignal.timeout\(NOTIFICATION_FETCH_TIMEOUT_MS\)/g) ?? []).length,
  4,
  'main notifier Telegram, Discord, Webhook, and quota-release Telegram fetches must use the timeout'
)
assert.ok(
  notifierSource.includes('return { success: false, error: await readSafeNotificationError(response) }'),
  'main Discord notifier must log a bounded sanitized upstream error preview'
)
assert.ok(
  notifierSource.includes("await assertSafeWebhookUrl(webhookUrl)"),
  'main Discord notifier must validate webhook URLs before fetch'
)
assert.ok(
  notifierSource.includes("await assertSafeWebhookUrl(url)"),
  'main generic webhook notifier must validate webhook URLs before fetch'
)

assert.ok(
  trafficNotifierSource.includes('const TRAFFIC_NOTIFICATION_FETCH_TIMEOUT_MS = 15_000'),
  'traffic notifier outbound fetches must define a bounded timeout'
)
assert.ok(
  trafficNotifierSource.includes('const TRAFFIC_NOTIFICATION_ERROR_PREVIEW_MAX_CHARS = 2_000'),
  'traffic notifier must cap upstream error response previews before logging'
)
assert.ok(
  trafficNotifierSource.includes("import { sanitizeTokensInString } from '../lib/log-sanitizer.js'"),
  'traffic notifier must sanitize token-like upstream error responses'
)
assert.equal(
  (trafficNotifierSource.match(/signal: AbortSignal.timeout\(TRAFFIC_NOTIFICATION_FETCH_TIMEOUT_MS\)/g) ?? []).length,
  2,
  'traffic notifier Telegram and Discord fetches must use the timeout'
)
assert.ok(
  trafficNotifierSource.includes('return { success: false, error: await readSafeNotificationError(response) }'),
  'traffic Discord notifier must log a bounded sanitized upstream error preview'
)
assert.ok(
  trafficNotifierSource.includes("await assertSafeWebhookUrl(webhookUrl)"),
  'traffic Discord notifier must validate webhook URLs before fetch'
)

assert.ok(
  lotteryNotifierSource.includes('const LOTTERY_NOTIFICATION_FETCH_TIMEOUT_MS = 15_000'),
  'lottery notifier outbound fetches must define a bounded timeout'
)
assert.ok(
  lotteryNotifierSource.includes('const LOTTERY_NOTIFICATION_ERROR_PREVIEW_MAX_CHARS = 2_000'),
  'lottery notifier must cap upstream error response previews before logging'
)
assert.ok(
  lotteryNotifierSource.includes("import { sanitizeTokensInString } from './log-sanitizer.js'"),
  'lottery notifier must sanitize token-like upstream error responses'
)
assert.equal(
  (lotteryNotifierSource.match(/signal: AbortSignal.timeout\(LOTTERY_NOTIFICATION_FETCH_TIMEOUT_MS\)/g) ?? []).length,
  3,
  'lottery notifier Telegram, Discord, and Webhook fetches must use the timeout'
)
assert.ok(
  lotteryNotifierSource.includes('throw new Error(await readSafeNotificationError(response))'),
  'lottery Discord notifier must throw a bounded sanitized upstream error preview'
)
assert.equal(
  (lotteryNotifierSource.match(/await assertSafeWebhookUrl/g) ?? []).length,
  2,
  'lottery Discord and generic webhook notifiers must validate webhook URLs before fetch'
)

for (const [label, source] of [
  ['main notifier', notifierSource],
  ['traffic notifier', trafficNotifierSource],
  ['lottery notifier', lotteryNotifierSource]
] as const) {
  assert.ok(
    source.includes("redirect: 'manual'"),
    `${label} must avoid automatic redirect following on outbound notification requests`
  )
}

console.log('notification fetch guard tests passed')
