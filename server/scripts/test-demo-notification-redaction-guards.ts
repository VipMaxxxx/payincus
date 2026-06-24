import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const serverRoot = resolve(__dirname, '..')

const demoSafetySource = readFileSync(resolve(serverRoot, 'src/lib/demo-safety.ts'), 'utf8')
const inboxSource = readFileSync(resolve(serverRoot, 'src/routes/inbox.ts'), 'utf8')

assert.ok(
  demoSafetySource.includes('export function redactDemoLoginNotificationContent') &&
    demoSafetySource.includes("replace(/[\\u0001\\u0002]/g, '\\n')") &&
    demoSafetySource.includes("replace(/(^|\\n)\\s*设备:[^\\n]*(\\n|$)/g, '$1')") &&
    demoSafetySource.includes('replace(/(^|\\n)\\s*IP:[^\\n]*(\\n|$)/g, `$1IP: ${DEMO_REDACTED_IP}$2`)'),
  'demo notification content redaction must normalize separators and hide device/IP values'
)

assert.ok(
  demoSafetySource.includes('export function redactDemoLoginNotificationData') &&
    demoSafetySource.includes('deviceInfo: null') &&
    demoSafetySource.includes('ipAddress: DEMO_REDACTED_IP'),
  'demo notification data redaction must hide device and IP payload fields'
)

assert.ok(
  demoSafetySource.includes("if (message.eventType !== 'login_new_device') return message") &&
    demoSafetySource.includes('redactDemoLoginNotificationContent(message.content)') &&
    demoSafetySource.includes('redactDemoLoginNotificationData(message.data)'),
  'demo inbox redaction must only rewrite new-login-device notifications'
)

assert.ok(
  inboxSource.includes('messages: result.messages.map(redactDemoInboxMessage)'),
  'inbox list API must redact demo login notifications'
)

console.log('demo notification redaction guard tests passed')
