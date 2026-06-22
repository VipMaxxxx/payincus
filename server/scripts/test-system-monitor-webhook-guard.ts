import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { assertSafeWebhookUrl, OutboundTargetValidationError } from '../src/lib/outbound-security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const monitorSource = readFileSync(resolve(__dirname, '../src/services/system-monitor.ts'), 'utf8')

assert.ok(
  monitorSource.includes("import { assertSafeWebhookUrl } from '../lib/outbound-security.js'"),
  'system monitor must import outbound webhook URL validation'
)
assert.ok(
  monitorSource.includes('await assertSafeWebhookUrl(ALERT_WEBHOOK_URL)'),
  'ALERT_WEBHOOK_URL must be validated before fetch'
)
assert.ok(
  monitorSource.includes("redirect: 'manual'"),
  'alert webhook fetch must not automatically follow redirects to unsafe targets'
)

await assert.rejects(
  () => assertSafeWebhookUrl('http://127.0.0.1:8080/alert'),
  OutboundTargetValidationError
)
await assert.rejects(
  () => assertSafeWebhookUrl('http://169.254.169.254/latest/meta-data'),
  OutboundTargetValidationError
)
await assert.rejects(
  () => assertSafeWebhookUrl('file:///etc/passwd'),
  OutboundTargetValidationError
)

console.log('system monitor webhook guard tests passed')
