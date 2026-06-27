import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const rechargeRoute = read('server/src/routes/recharge.ts')
const paymentDetails = read('server/src/lib/recharge-payment-details.ts')
const walletView = read('client/src/views/WalletView.vue')
const paymentProvidersView = read('client/src/views/admin/PaymentProvidersView.vue')
const userApi = read('client/src/api/index.ts')
const zhCN = read('client/src/locales/zh-CN.ts')
const en = read('client/src/locales/en.ts')
const zhTW = read('client/src/locales/zh-TW.ts')

assert.ok(
  rechargeRoute.includes("const MANUAL_PROVIDER_TYPE = 'manual'") &&
    rechargeRoute.includes('SUPPORTED_RECHARGE_PROVIDER_TYPES') &&
    rechargeRoute.includes('MANUAL_PROVIDER_TYPE') &&
    rechargeRoute.includes('normalizeManualRechargeInstructions') &&
    rechargeRoute.includes('人工充值渠道必须填写付款说明'),
  'manual payment providers must be a supported, validated recharge provider type'
)

assert.ok(
  paymentDetails.includes('buildManualRechargePaymentDetails') &&
    paymentDetails.includes("kind: 'manual'") &&
    rechargeRoute.includes('buildManualRechargePaymentDetails(normalizeManualRechargeInstructions(providerConfig.instructions)') &&
    rechargeRoute.includes('buildManualRechargeResponse(paymentDetails)'),
  'manual payment instructions must be captured in recharge payment details and returned from order creation'
)

assert.ok(
  rechargeRoute.includes('provider.type !== MANUAL_PROVIDER_TYPE') &&
    rechargeRoute.includes('manualPayment: provider.type === MANUAL_PROVIDER_TYPE') &&
    userApi.includes('manualPayment?:') &&
    userApi.includes('instructions: string'),
  'manual recharge orders must not require a payUrl and must expose safe payment instructions to the client'
)

assert.ok(
  paymentProvidersView.includes("new Set(['yipay', 'heleket', 'plugin_gateway', 'manual'])") &&
    paymentProvidersView.includes("formData.type === 'manual'") &&
    paymentProvidersView.includes('instructionsPlaceholder'),
  'admin payment provider UI must allow configuring manual payment instructions'
)

assert.ok(
  walletView.includes('showManualPaymentModal') &&
    walletView.includes('manualPaymentInfo') &&
    walletView.includes('res.manualPayment?.instructions') &&
    walletView.includes('wallet.manualPaymentInstructions') &&
    walletView.includes('wallet.manualPaymentPendingHint'),
  'wallet UI must show manual payment instructions for created and repaid manual orders'
)

for (const locale of [zhCN, en, zhTW]) {
  assert.ok(
    locale.includes('manualPaymentCreated') &&
      locale.includes('manualPaymentTitle') &&
      locale.includes('manualPaymentDesc') &&
      locale.includes('manualPaymentInstructions') &&
      locale.includes('manualPaymentPendingHint'),
    'all frontend locales must include manual payment messages'
  )
}

console.log('manual payment provider guards passed')
