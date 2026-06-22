import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const rechargeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
const adminBillingSource = readFileSync(resolve(__dirname, '../src/routes/admin-billing.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const userVerifyRoute = sectionBetween(
  rechargeSource,
  "app.post('/api/recharge/orders/:orderNo/verify'",
  '// ==================== 管理员接口 ===================='
)
const adminSyncRoute = sectionBetween(
  adminBillingSource,
  "app.post('/api/admin/billing/recharge-records/:id/sync'",
  '// ==================== 管理员创建实例 ===================='
)

for (const [label, source] of [
  ['user active recharge verification', userVerifyRoute],
  ['admin recharge sync', adminSyncRoute]
] as const) {
  assert.ok(
    source.includes('queryResult: sanitizeObject(queryResult.rawData)') ||
      source.includes('queryResult: sanitizeObject(queryResult)'),
    `${label}: persisted payment query result must be sanitized before storing callbackData`
  )
  assert.equal(
    source.includes('queryResult: queryResult.rawData as Record<string, unknown>'),
    false,
    `${label}: must not store raw EPay queryResult.rawData in recharge callbackData`
  )
  assert.equal(
    source.includes('queryResult: queryResult as Record<string, unknown>'),
    false,
    `${label}: must not store raw Heleket queryResult in recharge callbackData`
  )
}

assert.ok(
  userVerifyRoute.includes("callbackPayload = { source: 'verify_api', queryResult: sanitizeObject(queryResult.rawData)") &&
    userVerifyRoute.includes('queryResult: sanitizeObject(queryResult) as Record<string, unknown>'),
  'user active verification must sanitize both EPay and Heleket query results before persistence'
)
assert.ok(
  adminSyncRoute.includes("callbackPayload = { source: 'admin_sync', queryResult: sanitizeObject(queryResult.rawData)") &&
    adminSyncRoute.includes('queryResult: sanitizeObject(queryResult) as Record<string, unknown>'),
  'admin recharge sync must sanitize both EPay and Heleket query results before persistence'
)

console.log('recharge query result storage redaction tests passed')
