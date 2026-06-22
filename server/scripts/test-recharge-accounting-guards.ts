import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
const providerDbSource = readFileSync(resolve(__dirname, '../src/db/payment-providers.ts'), 'utf8')
const rechargeDbSource = readFileSync(resolve(__dirname, '../src/db/recharge-records.ts'), 'utf8')
const vipSource = readFileSync(resolve(__dirname, '../src/services/vip-levels.ts'), 'utf8')
const adminStatisticsSource = readFileSync(resolve(__dirname, '../src/routes/admin-statistics.ts'), 'utf8')
const adminBillingSource = readFileSync(resolve(__dirname, '../src/routes/admin-billing.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const createOrderRoute = sectionBetween(
  routeSource,
  "app.post('/api/recharge/orders'",
  "// 获取用户充值记录列表"
)

assert.ok(
  createOrderRoute.includes('const actualAmount = db.calculateActualAmount(provider, normalizedAmount)'),
  'recharge order creation must compute the real credited amount before persistence'
)
assert.ok(
  routeSource.includes('function parsePositiveJsonMoney(value: unknown): number | null') &&
    routeSource.includes("typeof value !== 'number' || !Number.isFinite(value) || value <= 0"),
  'recharge routes must define a strict JSON number guard for money inputs'
)
assert.ok(
  routeSource.includes('function normalizeOptionalTrimmedString(value: unknown, maxLength: number): string | null | undefined') &&
    routeSource.includes("if (typeof value !== 'string')") &&
    routeSource.includes('return trimmed.length <= maxLength ? trimmed : null'),
  'recharge routes must define a strict runtime guard for optional admin string inputs'
)
assert.ok(
  createOrderRoute.includes('const rechargeAmount = parsePositiveJsonMoney(amount)') &&
    createOrderRoute.includes('if (rechargeAmount === null)') &&
    createOrderRoute.includes('const normalizedAmount = Math.round(rechargeAmount * 100) / 100'),
  'recharge order creation must reject string, non-finite, and non-positive amounts before normalization'
)
assert.ok(
  createOrderRoute.includes('!Number.isFinite(actualAmount) || actualAmount <= 0'),
  'recharge order creation must reject non-finite or non-positive credited amounts'
)
assert.ok(
  createOrderRoute.indexOf('!Number.isFinite(actualAmount) || actualAmount <= 0') <
    createOrderRoute.indexOf('await db.createRechargeOrder'),
  'credited amount guard must run before creating the recharge order'
)

const manualCompleteRoute = sectionBetween(
  routeSource,
  "app.post('/api/admin/recharge/orders/:orderNo/complete'",
  "// 标记充值订单失败（管理员）"
)
assert.ok(
  manualCompleteRoute.includes('actualAmount = parsePositiveJsonMoney(rawActualAmount) ?? undefined') &&
    manualCompleteRoute.includes('if (actualAmount === undefined)'),
  'admin manual recharge completion must reject non-number actualAmount values instead of coercing them'
)
assert.ok(
  manualCompleteRoute.includes('const tradeNo = normalizeOptionalTrimmedString(rawTradeNo, MAX_RECHARGE_TRADE_NO_LENGTH)') &&
    manualCompleteRoute.includes("if (tradeNo === null)") &&
    manualCompleteRoute.includes("return reply.status(400).send({ error: '交易号格式无效或过长' })"),
  'admin manual recharge completion must reject malformed or oversized tradeNo values before persistence'
)
assert.ok(
  manualCompleteRoute.indexOf("if (tradeNo === null)") < manualCompleteRoute.indexOf('db.completeRecharge'),
  'admin manual recharge completion must validate tradeNo before calling completeRecharge'
)
assert.ok(
  !manualCompleteRoute.includes('actualAmount = Number(rawActualAmount)'),
  'admin manual recharge completion must not coerce actualAmount with Number()'
)

const manualFailRoute = sectionBetween(
  routeSource,
  "app.post('/api/admin/recharge/orders/:orderNo/fail'",
  '// ==================== 第三方支付回调 ===================='
)
assert.ok(
  manualFailRoute.includes('const reason = normalizeOptionalTrimmedString(rawReason, MAX_RECHARGE_ADMIN_REASON_LENGTH)') &&
    manualFailRoute.includes("if (reason === null)") &&
    manualFailRoute.includes("const failReason = reason || '管理员标记失败'"),
  'admin manual recharge failure must normalize and bound the reason before persistence/logging'
)
assert.ok(
  manualFailRoute.indexOf("if (reason === null)") < manualFailRoute.indexOf('db.failRecharge'),
  'admin manual recharge failure must validate reason before calling failRecharge'
)
assert.ok(
  manualFailRoute.includes('db.failRecharge(orderNo, failReason') &&
    manualFailRoute.includes('as failed: ${failReason}'),
  'admin manual recharge failure must persist and log only the normalized reason'
)

const repayRoute = sectionBetween(
  routeSource,
  "app.post('/api/recharge/orders/:orderNo/repay'",
  '// 获取用户充值统计'
)
assert.ok(
  repayRoute.includes('const paymentMethodChanged = selectedPaymentMethod !== (record.paymentMethod || undefined)'),
  'recharge repay must detect payment method changes explicitly'
)
assert.ok(
  repayRoute.includes('db.getPaymentFeeConfig(pricingProvider, selectedPaymentMethod)') &&
    repayRoute.includes('db.calculatePaymentFee(pricingProvider, rechargeAmount, selectedPaymentMethod)') &&
    repayRoute.includes('db.calculatePayableAmount(pricingProvider, rechargeAmount, selectedPaymentMethod)') &&
    repayRoute.includes('db.calculateActualAmount(pricingProvider, rechargeAmount)'),
  'recharge repay must recalculate fee, payable amount, and actual credited amount for the selected method'
)
assert.ok(
  repayRoute.includes('const existingPaymentDetails = readRechargePaymentDetails') &&
    repayRoute.includes('feeRate: existingPaymentDetails.recharge?.feeRate ?? provider.feeRate') &&
    repayRoute.includes('feeFixed: existingPaymentDetails.recharge?.feeFixed ?? provider.feeFixed'),
  'recharge repay pricing must keep the order-created base fee snapshot when no method-specific fee applies'
)
assert.ok(
  repayRoute.includes('mergeRechargeAmountDetails(providerPaymentDetails') &&
    repayRoute.includes('payableAmount') &&
    repayRoute.includes('feeRate: feeConfig.feeRate') &&
    repayRoute.includes('paymentMethod: selectedPaymentMethod || null'),
  'recharge repay must persist refreshed payment amount metadata when the method changes'
)
assert.ok(
  repayRoute.includes('await db.updatePendingRechargePaymentSelection(orderNo') &&
    !repayRoute.includes('updateRechargePaymentMethod'),
  'recharge repay must update payment method and amount metadata together through a pending-only helper'
)
assert.ok(
  repayRoute.indexOf('await db.updatePendingRechargePaymentSelection(orderNo') <
    repayRoute.indexOf('return {'),
  'recharge repay must persist refreshed payment metadata before returning the new pay URL to the client'
)

assert.ok(
  rechargeDbSource.includes('export async function updatePendingRechargePaymentSelection(') &&
    rechargeDbSource.includes("status: 'pending'") &&
    rechargeDbSource.includes('paymentDetails: data.paymentDetails as any') &&
    rechargeDbSource.includes('actualAmount: data.actualAmount') &&
    rechargeDbSource.includes('fee: data.fee'),
  'recharge DB layer must conditionally update pending payment selection with refreshed accounting fields'
)
assert.ok(
  !rechargeDbSource.includes('export async function updateRechargePaymentMethod('),
  'recharge DB layer must not expose the old unconditional payment-method-only update helper'
)

const actualAmountHelper = sectionBetween(
  providerDbSource,
  'export function calculateActualAmount(',
  '/**\n * 验证充值金额是否在渠道允许范围内'
)
assert.ok(
  actualAmountHelper.includes('return Number((amount - fee).toFixed(2))'),
  'deduct-fee providers can produce non-positive credited amounts that must be guarded at order creation'
)

for (const [label, source] of [
  ['user/system recharge stats', rechargeDbSource],
  ['VIP totalRecharge stats', vipSource],
  ['admin statistics recharge stats', adminStatisticsSource],
  ['admin billing recharge stats', adminBillingSource]
] as const) {
  assert.ok(
    source.includes('COALESCE(actual_amount, amount)'),
    `${label}: completed recharge sums must use actual credited amount with legacy amount fallback`
  )
  assert.ok(
    !source.includes("_sum: { amount: true }\n    })\n  ])\n\n  return {\n    totalConsume"),
    `${label}: must not keep the old completed-recharge amount aggregate pattern`
  )
}

console.log('recharge accounting guard tests passed')
