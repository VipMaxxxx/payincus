import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactDemoJsonPayload } from '../src/lib/demo-safety.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const serverRoot = resolve(__dirname, '..')

const appSource = readFileSync(resolve(serverRoot, 'src/app.ts'), 'utf8')
const demoSafetySource = readFileSync(resolve(serverRoot, 'src/lib/demo-safety.ts'), 'utf8')

assert.ok(
  appSource.includes("fastify.addHook('onRequest'") &&
    appSource.includes('shouldBlockDemoMutation(request)') &&
    appSource.includes("code: 'DEMO_READ_ONLY'"),
  'app must globally block demo API mutations'
)

assert.ok(
  appSource.includes("fastify.addHook('onSend'") &&
    appSource.includes('redactDemoJsonPayload(JSON.parse(body))') &&
    appSource.includes("path === '/api/auth/login' || path === '/api/auth/refresh'"),
  'app must globally redact demo JSON responses while preserving login token responses'
)

assert.ok(
  demoSafetySource.includes("'POST /api/auth/login'") &&
    demoSafetySource.includes("'POST /api/auth/logout'") &&
    demoSafetySource.includes("'POST /api/auth/refresh'") &&
    demoSafetySource.includes('export function shouldBlockDemoMutation'),
  'demo safety helper must allow only auth session mutations'
)

const redacted = redactDemoJsonPayload({
  ip: '82.152.90.37',
  email: 'customer@example.com',
  nested: {
    webhookUrl: 'https://example.com/hook/secret',
    publicIp: '147.125.252.115',
    normal: 'connect from 8.8.8.8'
  },
  list: [{ token: 'abc' }, { title: 'ok' }]
}) as {
  ip: string
  email: string
  nested: { webhookUrl: string; publicIp: string; normal: string }
  list: Array<{ token?: string; title?: string }>
}

assert.equal(redacted.ip, '已隐藏')
assert.equal(redacted.email, '已隐藏')
assert.equal(redacted.nested.webhookUrl, '已隐藏')
assert.equal(redacted.nested.publicIp, '已隐藏')
assert.equal(redacted.nested.normal, 'connect from 已隐藏')
assert.equal(redacted.list[0].token, '已隐藏')
assert.equal(redacted.list[1].title, 'ok')

console.log('demo read-only redaction guard tests passed')
