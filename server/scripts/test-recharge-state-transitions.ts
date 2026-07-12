import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const source = readFileSync(resolve(__dirname, '../src/db/recharge-records.ts'), 'utf8')
const routeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

function assertPendingPaidTransitionGuard(section: string, label: string): void {
  assert.ok(section.includes('prisma.rechargeRecord.updateMany'), `${label}: must use conditional updateMany`)
  assert.ok(section.includes("status: { in: ['pending', 'paid'] }"), `${label}: must only mutate pending/paid orders`)
  assert.ok(!section.includes('prisma.rechargeRecord.update({'), `${label}: must not use unconditional update`)
  assert.ok(section.includes('prisma.rechargeRecord.findUnique'), `${label}: must return the current row after a stale transition`)
}

function routeSectionBetween(startMarker: string, endMarker: string): string {
  const start = routeSource.indexOf(startMarker)
  assert.notEqual(start, -1, `missing route start marker: ${startMarker}`)
  const end = routeSource.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing route end marker: ${endMarker}`)
  return routeSource.slice(start, end)
}

const updateMetadataSection = sectionBetween(
  'export async function updateRechargeOrderMetadata(',
  '/**\n * 完成充值（成功）'
)
assertPendingPaidTransitionGuard(updateMetadataSection, 'updateRechargeOrderMetadata')
assert.ok(
  !source.includes('export async function markRechargePaid('),
  'recharge DB layer must not expose the old unconditional pending-to-paid helper'
)

const completeSection = sectionBetween(
  'export async function completeRecharge(',
  '/**\n * 标记充值失败'
)
assert.ok(
  completeSection.includes('const creditAmount = Number(data.actualAmount ?? record.actualAmount ?? record.amount)'),
  'completeRecharge: must derive one explicit credit amount'
)
assert.ok(
  completeSection.includes('!Number.isFinite(creditAmount) || creditAmount <= 0'),
  'completeRecharge: must reject non-finite or non-positive credit amounts'
)
assert.ok(
  completeSection.includes('data: { balance: { increment: creditAmount } }'),
  'completeRecharge: balance increment must use the validated credit amount'
)
assert.ok(
  completeSection.includes('amount: creditAmount'),
  'completeRecharge: balance log must use the validated credit amount'
)

const failSection = sectionBetween(
  'export async function failRecharge(',
  '/**\n * 取消充值订单'
)
assertPendingPaidTransitionGuard(failSection, 'failRecharge')
assert.ok(failSection.includes("status: 'failed'"), 'failRecharge: failed status update not found')

const cancelSection = sectionBetween(
  'export async function cancelRecharge(',
  '/**\n * 更新订单支付方式'
)
assertPendingPaidTransitionGuard(cancelSection, 'cancelRecharge')
assert.ok(cancelSection.includes("status: 'cancelled'"), 'cancelRecharge: cancelled status update not found')

const manualCompleteRoute = routeSectionBetween(
  "app.post('/api/admin/recharge/orders/:orderNo/complete'",
  '// 标记充值订单失败（管理员）'
)
assert.ok(
  manualCompleteRoute.includes("record.status === 'failed'"),
  'manual complete route must reject failed orders before calling completeRecharge'
)
assert.ok(
  manualCompleteRoute.indexOf("record.status === 'failed'") < manualCompleteRoute.indexOf('db.completeRecharge'),
  'manual complete route must reject failed orders before db.completeRecharge'
)

const callbackHandler = routeSectionBetween(
  'async function handlePaymentCallback(',
  '// POST 回调接口'
)
const repayRoute = routeSectionBetween(
  "app.post('/api/recharge/orders/:orderNo/repay'",
  '// 获取用户充值统计'
)
assert.ok(
  repayRoute.includes('buildNextRechargePaymentAttempt') &&
    repayRoute.includes('mergeRechargePaymentAttempt') &&
    repayRoute.includes('previousPaymentLinkInvalidated: paymentAttempt !== null'),
  'recharge repay must supersede the previous payment attempt, persist the new active attempt, and notify the client'
)
assert.ok(
  repayRoute.includes('gatewayOrderNo') &&
    repayRoute.indexOf('await db.updatePendingRechargePaymentSelection(orderNo') < repayRoute.indexOf('return {'),
  'recharge repay must persist the active gateway order before returning its payment URL'
)

const completedCallbackCheckIndex = callbackHandler.indexOf("record.status === 'completed'")
const paidAmountValidationIndex = callbackHandler.indexOf('const shouldValidatePaidAmount')
const activeAttemptCheckIndex = callbackHandler.indexOf('isCurrentRechargePaymentAttempt')
assert.ok(
  completedCallbackCheckIndex !== -1,
  'payment callback handler must explicitly handle already-completed orders'
)
assert.ok(
  completedCallbackCheckIndex < paidAmountValidationIndex,
  'payment callback handler must idempotently accept completed orders before validating callback amount'
)
assert.ok(
  callbackHandler.includes('resolveRechargeOrderNoFromGatewayOrderNo') &&
    activeAttemptCheckIndex !== -1 &&
    activeAttemptCheckIndex < callbackHandler.indexOf('db.completeRecharge'),
  'payment callback handler must resolve attempt-scoped gateway orders and reject superseded attempts before crediting'
)
// 迟到但已验签验额的回调不再因本地过期被静默丢弃，而是继续走幂等入账（completeRecharge 只对 pending/paid 入账一次）。
assert.ok(
  callbackHandler.includes('按真实到账继续入账') &&
    !callbackHandler.includes('订单已过期，拒绝处理回调'),
  'expired but signature/amount-verified callbacks must not be silently dropped; they must fall through to idempotent crediting'
)

const verifyRoute = routeSectionBetween(
  "app.post('/api/recharge/orders/:orderNo/verify'",
  '// ==================== 管理员接口 ===================='
)
assert.ok(
  verifyRoute.includes('const gatewayOrderNo = getCurrentRechargeGatewayOrderNo') &&
    verifyRoute.includes('epay.queryOrder(gatewayOrderNo)') &&
    verifyRoute.includes('heleket.getPaymentInfo({ order_id: gatewayOrderNo })') &&
    verifyRoute.includes('inquiryPayment(gatewayOrderNo)'),
  'active recharge verification must query only the current payment attempt for each built-in gateway'
)

console.log('recharge state transition tests passed')
