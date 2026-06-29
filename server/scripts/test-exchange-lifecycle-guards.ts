import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const exchangeServiceSource = readFileSync(new URL('../src/services/exchange.ts', import.meta.url), 'utf8')
const exchangeDeliveryWorkerSource = readFileSync(new URL('../src/workers/exchangeDeliveryWorker.ts', import.meta.url), 'utf8')
const adminExchangeRouteSource = readFileSync(new URL('../src/routes/admin-exchange.ts', import.meta.url), 'utf8')
const exchangeRouteSource = readFileSync(new URL('../src/routes/exchange.ts', import.meta.url), 'utf8')
const exchangeSmokeSource = readFileSync(new URL('./smoke-exchange-marketplace-e2e.ts', import.meta.url), 'utf8')
const userExchangeViewSource = readFileSync(new URL('../../client/src/views/ExchangeView.vue', import.meta.url), 'utf8')

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(message)
    process.exit(1)
  }
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  assert(startIndex >= 0, `source section must contain ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert(endIndex > startIndex, `source section ${start} must end before ${end}`)
  return source.slice(startIndex, endIndex)
}

function assertSourceOrder(source: string, markers: string[], message: string): void {
  let previousIndex = -1
  for (const marker of markers) {
    const index = source.indexOf(marker, previousIndex + 1)
    assert(index >= 0, `${message}: missing marker ${marker}`)
    assert(index > previousIndex, `${message}: marker ${marker} must appear after previous marker`)
    previousIndex = index
  }
}

const purchaseSection = sourceBetween(
  exchangeServiceSource,
  'export async function purchaseExchangeListing',
  'export async function releaseExchangeOrderEscrow'
)
const releaseSection = sourceBetween(
  exchangeServiceSource,
  'export async function releaseExchangeOrderEscrow',
  'export async function getExchangeWallet'
)
const transferSection = sourceBetween(
  exchangeServiceSource,
  'export async function transferExchangeBalanceToUserBalance',
  'export async function createExchangeWithdrawal'
)
const withdrawalSection = sourceBetween(
  exchangeServiceSource,
  'export async function createExchangeWithdrawal',
  'export async function listExchangeWithdrawals'
)
const serializePublicSection = sourceBetween(
  exchangeServiceSource,
  'function serializePublicListing',
  'function serializeOrder'
)
const serializeOrderSection = sourceBetween(
  exchangeServiceSource,
  'function serializeOrder',
  'function serializeWithdrawal'
)
const finalizeDeliverySection = sourceBetween(
  exchangeDeliveryWorkerSource,
  'async function finalizeDelivery',
  'async function settleDueConfirmingOrders'
)

for (const model of [
  'ExchangeListing',
  'ExchangeOrder',
  'ExchangeDeliveryTask',
  'ExchangeWallet',
  'ExchangeWalletLog',
  'ExchangeWithdrawal',
  'ExchangeDispute',
  'ExchangeAuditLog',
  'ExchangePolicyConfig'
]) {
  assert(schema.includes(`model ${model} `), `schema must define ${model}`)
}

assert(
  schema.includes('buyerBalanceLogId') &&
    schema.includes('walletLogId') &&
    schema.includes('escrowAmount') &&
    schema.includes('sellerReceivesAmount') &&
    schema.includes('feeAmount') &&
    schema.includes('ExchangeWalletLogType') &&
    schema.includes('escrow_hold') &&
    schema.includes('escrow_release') &&
    schema.includes('fee_charge') &&
    schema.includes('withdrawal_freeze') &&
    schema.includes('withdrawal_complete') &&
    schema.includes('withdrawal_reject') &&
    schema.includes('balance_transfer'),
  'exchange schema must model buyer balance, escrow, seller wallet, fee, withdrawal, and balance-transfer ledger links'
)

assertSourceOrder(
  purchaseSection,
  [
    'const purchaseInstance = await assertListingStillPurchasable(tx, policy, listing)',
    "if (buyer.status !== 'active')",
    'if (toNumber(buyer.balance) < price)',
    'data: { balance: { decrement: price } }',
    "type: 'exchange_purchase'",
    "status: 'delivering'",
    'escrowAmount: price',
    "type: 'escrow_hold'",
    "status: 'PENDING'",
    "step: 'escrow_paid'",
    "action: 'order.purchase'"
  ],
  'exchange purchase must recheck eligibility, deduct buyer account balance, put money into escrow, create delivery task, and write audit evidence in order'
)

assert(
  purchaseSection.includes('buyerBalanceLogId: buyerBalanceLog.id') &&
    purchaseSection.includes('balanceLogId: buyerBalanceLog.id') &&
    purchaseSection.includes('exchangeDeliveryTask.create') &&
    purchaseSection.includes('lockedOrderId: order.id') &&
    purchaseSection.includes('idempotencyKey') &&
    purchaseSection.includes('EXCHANGE_IDEMPOTENCY_KEY_CONFLICT'),
  'exchange purchase must link buyer balance log, escrow log, locked listing, delivery task, and idempotency key'
)

assertSourceOrder(
  finalizeDeliverySection,
  [
    "if (!renameContext.instanceTask || renameContext.instanceTask.status !== 'COMPLETED')",
    'await renameIncusInstance(client, oldIncusId, newIncusId)',
    'await prisma.$transaction',
    'userId: task.buyerUserId',
    'incusId: newIncusId',
    "type: 'newPurchase'",
    "step: 'preserve_traffic_usage'",
    "status: 'confirming'",
    "status: 'COMPLETED'"
  ],
  'exchange delivery must wait for forced reinstall completion before anonymous rename, owner transfer, billing rebuild, traffic preservation, and confirmation'
)

assert(
  finalizeDeliverySection.includes('await renameIncusInstance(client, newIncusId, oldIncusId)') &&
    finalizeDeliverySection.includes('CRITICAL: failed to rollback exchange Incus rename') &&
    exchangeDeliveryWorkerSource.includes('cleanupLegacyAccess') &&
    exchangeDeliveryWorkerSource.includes('cleanup_terminal_sessions') &&
    exchangeDeliveryWorkerSource.includes('cleanup_network_bindings') &&
    exchangeDeliveryWorkerSource.includes('cleanup_snapshots_and_backups') &&
    exchangeDeliveryWorkerSource.includes('cleanup_ssh_keys') &&
    exchangeDeliveryWorkerSource.includes('cleanup_console_tokens'),
  'exchange delivery must clean old access/bindings/snapshots and attempt Incus rename rollback if DB transfer fails'
)

assertSourceOrder(
  releaseSection,
  [
    "const allowedStatuses = options.allowedStatuses || ['confirming']",
    'const locked = await tryAdvisoryTransactionLock',
    "type: 'fee_charge'",
    "type: 'escrow_release'",
    'data: { availableAmount: { increment: sellerReceivesAmount } }',
    "status: 'completed'",
    "action: options.action || 'order.escrow_release'"
  ],
  'exchange escrow release must only settle allowed statuses, charge fee, release seller amount to exchange wallet, complete order, and write audit evidence'
)

assert(
  releaseSection.includes('if (order.status ===') &&
    releaseSection.includes('order.walletLogId') &&
    releaseSection.includes('EXCHANGE_ORDER_NOT_RELEASABLE') &&
    releaseSection.includes('walletLogId: walletLog.id') &&
    releaseSection.includes('completedAt: new Date()') &&
    releaseSection.includes('resolveDispute?:') &&
    releaseSection.includes('EXCHANGE_DISPUTE_STATE_CHANGED') &&
    releaseSection.includes("targetType: 'exchange_dispute'"),
  'exchange escrow release must be idempotent, refuse unreleasable order states, and atomically close a resolving dispute when requested'
)

assertSourceOrder(
  withdrawalSection,
  [
    'const method = normalizeOptionalText(input.method, 64)',
    'EXCHANGE_WITHDRAWAL_METHOD_REQUIRED',
    'EXCHANGE_WITHDRAWAL_ACCOUNT_REQUIRED',
    'EXCHANGE_WITHDRAWAL_TOO_LOW',
    'EXCHANGE_ACCOUNT_NOT_ACTIVE',
    'EXCHANGE_ACCOUNT_RESTRICTED',
    'EXCHANGE_HAS_OPEN_DISPUTE',
    'EXCHANGE_WITHDRAWAL_HAS_UNSETTLED_SALE',
    'dailyWithdrawalCountLimit',
    'dailyWithdrawalLimit',
    'availableAmount: { decrement: amount }',
    'frozenAmount: { increment: amount }',
    "type: 'withdrawal_freeze'",
    "action: 'withdrawal.create'"
  ],
  'exchange withdrawal creation must validate profile/risk/limits, keep status pending for manual review, freeze wallet funds, and write audit evidence'
)

assert(
  withdrawalSection.includes("status: 'pending'") &&
    !withdrawalSection.includes("status: 'approved'") &&
    !withdrawalSection.includes("status: 'completed'") &&
    adminExchangeRouteSource.includes('只有待审核提现可以审核通过') &&
    adminExchangeRouteSource.includes('async function assertWithdrawalStillPayable') &&
    countOccurrences(adminExchangeRouteSource, 'await assertWithdrawalStillPayable(tx, current.userId)') >= 2 &&
    adminExchangeRouteSource.includes("type: 'withdrawal_complete'") &&
    adminExchangeRouteSource.includes("type: 'withdrawal_reject'"),
  'user withdrawal must only create a pending manual-review request; approve/complete/reject must stay in admin routes with payout rechecks'
)

assertSourceOrder(
  transferSection,
  [
    'if (!policy.allowBalanceTransfer)',
    "throw new ExchangeError('EXCHANGE_TRANSFER_DISABLED'",
    "type: 'exchange_transfer'",
    "type: 'balance_transfer'",
    "action: 'wallet.balance_transfer'"
  ],
  'exchange balance transfer must honor policy, debit exchange wallet, credit user account balance, and write both ledgers'
)

for (const forbiddenIdentityField of [
  'buyerUserId',
  'sellerUserId',
  'creatorUserId',
  'userId',
  'user_id',
  'username',
  'nickname',
  'email',
  'contact',
  'phone',
  'registeredAt',
  'createdBy'
]) {
  assert(!serializePublicSection.includes(forbiddenIdentityField), `public listing serialization must not expose ${forbiddenIdentityField}`)
  assert(!serializeOrderSection.split('return {')[1]?.includes(forbiddenIdentityField), `user order serialization must not expose ${forbiddenIdentityField}`)
  assert(exchangeServiceSource.includes(`'${forbiddenIdentityField}'`), `public snapshot denylist must include ${forbiddenIdentityField}`)
}

assert(
  serializePublicSection.includes('sanitizePublicInstanceSnapshot') &&
    serializeOrderSection.includes('sanitizePublicInstanceSnapshot') &&
    serializeOrderSection.includes("privacyMode: 'anonymous'") &&
    serializeOrderSection.includes("deliveryMode: 'reinstall_required'") &&
    serializeOrderSection.includes('canViewBuyerDeliveryPreference') &&
    serializeOrderSection.includes('imageAlias: canViewBuyerDeliveryPreference') &&
    serializeOrderSection.includes('sshKeyId: canViewBuyerDeliveryPreference'),
  'public listing and participant order responses must be anonymous, reinstall-required, and must hide buyer delivery preferences from the seller'
)

assert(
  exchangeRouteSource.includes("'/market/:listingId/purchase'") &&
    exchangeRouteSource.includes("'/wallet/transfer'") &&
    exchangeRouteSource.includes("'/withdrawals'") &&
    exchangeRouteSource.includes('requireExchangeVerification') &&
    exchangeRouteSource.includes('getRequestIdempotencyKey'),
  'money-changing exchange user routes must require sensitive verification and idempotency'
)

assert(
  userExchangeViewSource.includes('确认购买交易所实例') &&
    userExchangeViewSource.includes('强制重装交割') &&
    userExchangeViewSource.includes('资金托管') &&
    userExchangeViewSource.includes('提现必须人工审核') &&
    userExchangeViewSource.includes('确认提交提现审核') &&
    userExchangeViewSource.includes('确认划转到账户余额') &&
    userExchangeViewSource.includes('买卖双方前台互不可见') &&
    userExchangeViewSource.includes('不包含卖家原系统、原数据、账号信息或历史订单'),
  'user exchange UI must disclose escrow, forced reinstall, anonymous trade, manual withdrawal review, and no seller data delivery'
)

assert(
  exchangeSmokeSource.includes("const allowDestructive = process.env.SMOKE_EXCHANGE_ALLOW_DESTRUCTIVE === '1'") &&
    exchangeSmokeSource.includes("const allowPurchase = process.env.SMOKE_EXCHANGE_ALLOW_PURCHASE === '1'") &&
    exchangeSmokeSource.includes("const allowStopForListing = process.env.SMOKE_EXCHANGE_ALLOW_STOP_FOR_LISTING === '1'") &&
    exchangeSmokeSource.includes("if (!allowDestructive)") &&
    exchangeSmokeSource.includes("destructive: false") &&
    exchangeSmokeSource.includes('SMOKE_EXCHANGE_SELLER_INSTANCE_ID') &&
    exchangeSmokeSource.includes('SMOKE_EXCHANGE_EXPECT_VERIFICATION_GATE') &&
    exchangeSmokeSource.includes('EXCHANGE_OPERATION_VERIFICATION_REQUIRED') &&
    exchangeSmokeSource.includes('assertNoIdentityLeak') &&
    exchangeSmokeSource.includes('SMOKE_EXCHANGE_WAIT_DELIVERY') &&
    exchangeSmokeSource.includes('pollOrderUntilTerminal'),
  'exchange smoke must default to read-only checks, require explicit destructive/purchase/stop gates, handle sensitive-operation verification, assert anonymity, and optionally poll delivery'
)

console.log('exchange lifecycle guards passed')
