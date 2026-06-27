import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/admin-billing.ts'), 'utf8')

assert.ok(
  source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'admin billing routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  source.match(/const instanceId = parsePositiveRouteId\(id\)/g)?.length ?? 0,
  10,
  'all admin instance billing routes must strictly validate instance route IDs'
)

assert.equal(
  source.match(/const recordId = parsePositiveRouteId\(id\)/g)?.length ?? 0,
  3,
  'admin recharge-record refund and sync routes must strictly validate record route IDs'
)

assert.equal(
  source.match(/const refundRequestId = parsePositiveRouteId\(id\)/g)?.length ?? 0,
  1,
  'admin recharge refund retry route must strictly validate refund request route IDs'
)

for (const forbiddenPattern of [
  'parseInt(id, 10)',
  'isNaN(instanceId)',
  'isNaN(recordId)',
  'isNaN(refundRequestId)',
  'isNaN(newPlanId)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `admin billing routes must not use loose ID parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  source.includes('!Number.isInteger(days) || days < 1 || days > 365'),
  'admin manual extension must require integer day values'
)

assert.ok(
  source.includes('!Number.isSafeInteger(newPlanId) || newPlanId <= 0'),
  'admin plan upgrade must require a positive safe-integer target plan ID'
)

assert.ok(
  source.includes('async function assertRechargeRefundProviderSupported(recordId: number): Promise<void>') &&
    source.includes('provider.type !== PLUGIN_GATEWAY_PROVIDER_TYPE') &&
    source.includes('当前充值支付渠道不支持自动原路退款；请改用订单退款审批或人工调账'),
  'admin recharge refund must validate provider refund support before creating a refund request'
)

const refundCapabilityIndex = source.indexOf('await assertRechargeRefundProviderSupported(recordId)')
const refundCreateIndex = source.indexOf('db.createRechargeRefundRequest({')
assert.ok(
  refundCapabilityIndex !== -1 &&
    refundCreateIndex !== -1 &&
    refundCapabilityIndex < refundCreateIndex,
  'admin recharge refund route must run provider capability checks before persisting refund requests'
)

console.log('admin billing route ID guard tests passed')
