import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '../src/scripts/production-proof-snapshot.ts'), 'utf8')

const forbiddenSelections = [
  'url: true',
  'certPath: true',
  'keyPath: true',
  'installToken: true',
  'agentId: true',
  'secretHash: true',
  'secretEncrypted: true',
  'lastHeartbeatIp: true',
  'orderNo: true',
  'callbackData: true',
  'providerConfigSnapshot: true',
  'config: true',
  'rootPassword: true',
  'content: true',
  'error: true'
]

for (const selection of forbiddenSelections) {
  assert.equal(
    source.includes(selection),
    false,
    `production proof snapshot must not select sensitive field pattern: ${selection}`
  )
}

assert.match(source, /omittedFields:\s*\[/, 'snapshot must document omitted sensitive fields')
assert.match(source, /safeToShare:\s*true/, 'snapshot must explicitly mark output as safe to share')
assert.match(source, /missingActions:/, 'snapshot must report missing lifecycle actions')
assert.match(source, /paymentDetailsKeys/, 'snapshot may expose payment details keys, not raw values')
assert.equal(source.includes('paymentDetails: record.paymentDetails'), false, 'snapshot must not expose raw payment details')
assert.match(source, /hasCallbackIp:\s*hasText\(callback\.callbackIp\)/, 'snapshot may expose callback IP presence only')
assert.equal(source.includes('callbackIp: callback.callbackIp'), false, 'snapshot must not expose raw callback IP')

console.log('production proof snapshot redaction guards passed')
