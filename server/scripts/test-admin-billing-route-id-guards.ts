import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/admin-billing.ts'), 'utf8')
const billingOperationsSource = readFileSync(resolve(__dirname, '../src/db/billing-operations.ts'), 'utf8')
const manualRefundRoute = source.slice(
  source.indexOf("app.post('/api/admin/instances/:id/refund'"),
  source.indexOf('// ==================== 管理员删除并退款 ====================')
)
const deleteAndRefundRoute = source.slice(
  source.indexOf("app.post('/api/admin/instances/:id/delete-and-refund'"),
  source.indexOf('// ==================== 管理员应用AFF优惠码 ====================')
)
const manualExtendRoute = source.slice(
  source.indexOf("app.post('/api/admin/instances/:id/extend'"),
  source.indexOf('// ==================== 管理员退款 ====================')
)
const updatePriceRoute = source.slice(
  source.indexOf("app.post('/api/admin/instances/:id/update-price'"),
  source.indexOf("app.post('/api/admin/instances/:id/update-price/preview'")
)
const updatePricePreviewRoute = source.slice(
  source.indexOf("app.post('/api/admin/instances/:id/update-price/preview'"),
  source.indexOf('// ==================== 批量修改实例价格 ====================')
)
const priceAdjustmentQuote = billingOperationsSource.slice(
  billingOperationsSource.indexOf('export async function calculateInstancePriceAdjustmentQuote('),
  billingOperationsSource.indexOf('/**\n * 续费价格预览（前端调用）')
)

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
  source.includes("import { calculateDailyPrice } from '../lib/billing-calc.js'") &&
    manualExtendRoute.includes('const dailyPrice = calculateDailyPrice(Number(instance.billingPrice), instance.billingCycle || 1)') &&
    manualExtendRoute.includes('const extendAmount = freeExtend ? 0 : Number((dailyPrice * days).toFixed(2))'),
  'admin manual extension must use the shared 31-day daily price and round only the final amount'
)

assert.ok(
  !source.includes('monthlyPrice / 30') &&
    !manualExtendRoute.includes('dailyPrice.toFixed'),
  'admin manual extension must not use a local 30-day price or intermediate daily-price rounding'
)

assert.ok(
  source.includes('!Number.isSafeInteger(newPlanId) || newPlanId <= 0'),
  'admin plan upgrade must require a positive safe-integer target plan ID'
)

assert.ok(
  updatePriceRoute.includes('db.calculateInstancePriceAdjustmentQuote(currentInstance, roundedNewPrice, settleBalance, tx)') &&
    updatePricePreviewRoute.includes('db.calculateInstancePriceAdjustmentQuote(instance, newPrice, settleBalance)') &&
    !updatePriceRoute.includes('currentInstance.billingPrice *') &&
    !updatePricePreviewRoute.includes('instance.billingPrice *'),
  'admin price adjustment preview and execution must use the shared paid-value quote instead of nominal billingPrice'
)

assert.ok(
  priceAdjustmentQuote.includes('calculateInstanceRemainingRefundQuote(instance, tx)') &&
    priceAdjustmentQuote.includes('paidRefundQuote.remainingValue') &&
    priceAdjustmentQuote.includes('paidRefundQuote.maxRefundable') &&
    !priceAdjustmentQuote.includes('calculatePriceDiff('),
  'admin price adjustment quote must deduct paid billing-record remaining value capped by refundable paid total'
)

assert.ok(
  manualRefundRoute.includes(`await db.deductHostingBalance(
          instance.hostId,
          amount,
          instanceId,
          \`管理员退款扣除托管收入：\${instance.name}\`,
          tx
        )`),
  'admin manual instance refunds must deduct the actual refund amount from hosted income in the same transaction'
)

assert.ok(
  deleteAndRefundRoute.includes(`await db.deductHostingBalance(
              instance.hostId,
              refundAmount,
              instanceId,
              \`管理员删除托管实例退款扣除：\${instance.name}\`,
              tx
            )`),
  'admin delete-and-refund must deduct the actual refund amount from hosted income in the same transaction'
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
