import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..')
const view = readFileSync(resolve(root, 'client/src/views/admin/AffReviewView.vue'), 'utf8')
const affDbSource = readFileSync(resolve(root, 'server/src/db/aff.ts'), 'utf8')
const billingOperationsSource = readFileSync(resolve(root, 'server/src/db/billing-operations.ts'), 'utf8')
const instanceDestroySource = readFileSync(resolve(root, 'server/src/routes/instance-destroy.ts'), 'utf8')
const adminBillingSource = readFileSync(resolve(root, 'server/src/routes/admin-billing.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

assert.ok(
  view.includes('class="space-y-3 p-4 lg:hidden"') &&
    view.includes('class="hidden overflow-hidden lg:block"') &&
    view.includes('table class="w-full table-fixed"') &&
    !view.includes('v-else class="overflow-x-auto"') &&
    !view.includes('table class="w-full min-w-[960px]"'),
  'AFF withdrawal review list must keep mobile cards and a fixed desktop table without broad horizontal overflow'
)

assert.ok(
  view.includes('@click="approveWithdrawal(w)"') &&
    view.includes('@click="openRejectModal(w)"') &&
    view.includes('@click="submitReject"') &&
    view.includes('v-model="rejectReason"') &&
    view.includes('@click="page--; loadWithdrawals()"') &&
    view.includes('@click="page++; loadWithdrawals()"'),
  'AFF withdrawal review responsive layout must preserve approve, reject, modal, and pagination actions'
)

const validateAffCodeSource = sectionBetween(
  affDbSource,
  'export async function validateAffCode(',
  'export async function createAffBinding('
)
assert.ok(
  validateAffCodeSource.includes('if (!affCode.enabled)') &&
    validateAffCodeSource.includes("return { valid: false, error: '优惠码已禁用' }"),
  'instance purchase AFF validation must reject disabled codes'
)

const performRenewalSource = sectionBetween(
  billingOperationsSource,
  'export async function performRenewal(',
  'export async function performPlanChange('
)
// v1.4.0 起续费改走 arbitrateVipPrice 价格仲裁：已禁用 AFF 码的折扣率强制为 0（不给折扣）。
assert.match(
  performRenewalSource,
  /affDiscountRate:\s*affBinding\?\.affCode\.enabled\s*\?\s*Number\(affBinding\.affCode\.discountRate\)\s*:\s*0/,
  'instance renewal must not apply discounts from disabled AFF codes'
)
// 佣金仅在 AFF 码启用且仲裁最终选中 AFF 价（pricingSource === 'aff'）时发放：禁用码既无折扣也无佣金。
assert.match(
  performRenewalSource,
  /if \(affBinding\?\.affCode\.enabled && pricingSource === 'aff'\) \{\s*await processAffCommission\(/,
  'instance renewal must not pay commission for disabled AFF codes'
)

const affRefundReversalSource = sectionBetween(
  instanceDestroySource,
  'export async function reverseInstanceAffCommissionForRefund(',
  'async function claimInstanceForUserDestroy('
)
assert.ok(
  affRefundReversalSource.includes('refundAmount / originalPaidAmount') &&
    affRefundReversalSource.includes('issuedCommission * refundRatio') &&
    affRefundReversalSource.includes('remainingCommission'),
  'AFF refund reversal must be proportional to the actual refund and capped by unreversed commission'
)
assert.ok(
  affRefundReversalSource.includes('affBalance: { decrement: commissionAmount }') &&
    affRefundReversalSource.includes('amount: -commissionAmount') &&
    affRefundReversalSource.includes('totalEarnings: { decrement: commissionAmount }'),
  'AFF refund reversal must allow debt and roll back AFF balance, log, and earnings statistics'
)
assert.ok(
  affRefundReversalSource.includes("type === 'new_purchase' && commissionAmount >= remainingCommission") &&
    affRefundReversalSource.includes('usedCount: { decrement: 1 }'),
  'AFF usage count must roll back once only after the new-purchase commission is fully reversed'
)

const userDestroySettlementSource = sectionBetween(
  instanceDestroySource,
  'async function settleUserDestroyBilling(',
  'async function buildBatchDestroyPreviewItem('
)
assert.ok(
  userDestroySettlementSource.includes('await reverseInstanceAffCommissionForRefund({') &&
    userDestroySettlementSource.includes('refundAmount,'),
  'user destroy refund must reverse AFF commission in the refund transaction'
)

const adminRefundSource = sectionBetween(
  adminBillingSource,
  '// ==================== 管理员退款 ====================',
  '// ==================== 管理员删除并退款 ===================='
)
assert.ok(
  adminRefundSource.includes('await reverseInstanceAffCommissionForRefund({') &&
    adminRefundSource.includes('refundAmount: amount,'),
  'admin partial refund must reverse AFF commission in the refund transaction'
)
const adminDeleteRefundSource = sectionBetween(
  adminBillingSource,
  '// ==================== 管理员删除并退款 ====================',
  '// ==================== 管理员应用AFF优惠码 ===================='
)
assert.ok(
  adminDeleteRefundSource.includes('await reverseInstanceAffCommissionForRefund({') &&
    adminDeleteRefundSource.includes('refundAmount,'),
  'admin delete-and-refund must reverse AFF commission in the refund transaction'
)

console.log('AFF review UI guard tests passed')
