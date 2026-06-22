import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')

assert.ok(
  routeSource.includes('function normalizePaymentCallbackPayload(value: unknown): Record<string, unknown> | null') &&
    routeSource.includes("typeof value !== 'object'") &&
    routeSource.includes('Array.isArray(value)'),
  'payment callback payloads must reject null, primitive, and array inputs before processing'
)

assert.ok(
  routeSource.includes('rawCallbackData: unknown') &&
    routeSource.includes('const callbackData = normalizePaymentCallbackPayload(rawCallbackData)') &&
    routeSource.includes("return reply.status(400).send({ error: '回调数据格式不合法' })"),
  'payment callback handler must return 400 for malformed payloads instead of falling through to 500'
)

assert.ok(
  routeSource.includes('return await handlePaymentCallback(request, reply, providerId, request.body)') &&
    routeSource.includes('return await handlePaymentCallback(request, reply, providerId, request.query)'),
  'payment callback routes must pass raw request payloads through the shared payload guard'
)

console.log('recharge callback payload guard tests passed')
