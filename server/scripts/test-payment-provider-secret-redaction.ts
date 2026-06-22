import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  MASKED_PAYMENT_SECRET_VALUE,
  mergePaymentProviderConfigForUpdate,
  sanitizePaymentProviderForResponse,
  validatePaymentProviderFinancialInput
} from '../src/db/payment-providers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const rawConfig = {
  version: 'v2',
  apiurl: 'https://pay.example.com',
  pid: '1000',
  key: 'md5-secret',
  merchant_private_key: 'rsa-private-secret',
  platform_public_key: 'platform-public',
  api_key: 'heleket-secret',
  methodFees: {
    alipay: { feeRate: 0.03 }
  }
}

const provider = {
  id: 1,
  name: 'Test Pay',
  type: 'yipay',
  config: rawConfig
}

const sanitized = sanitizePaymentProviderForResponse(provider)
assert.equal(sanitized.config.key, '', 'merchant key must be redacted')
assert.equal(sanitized.config.keyConfigured, true, 'merchant key configured flag missing')
assert.equal(sanitized.config.merchant_private_key, '', 'merchant private key must be redacted')
assert.equal(sanitized.config.merchant_private_keyConfigured, true, 'merchant private key configured flag missing')
assert.equal(sanitized.config.api_key, '', 'API key must be redacted')
assert.equal(sanitized.config.api_keyConfigured, true, 'API key configured flag missing')
assert.equal(sanitized.config.platform_public_key, 'platform-public', 'public keys should remain visible')
assert.deepEqual(sanitized.config.methodFees, rawConfig.methodFees, 'non-secret config must remain visible')

const mergedFromEmpty = mergePaymentProviderConfigForUpdate(
  {
    version: 'v2',
    apiurl: 'https://new-pay.example.com',
    pid: '2000',
    key: '',
    merchant_private_key: '',
    api_key: '',
    keyConfigured: true,
    merchant_private_keyConfigured: true,
    api_keyConfigured: true
  },
  rawConfig
)
assert.equal(mergedFromEmpty.key, rawConfig.key, 'empty merchant key must preserve existing secret')
assert.equal(mergedFromEmpty.merchant_private_key, rawConfig.merchant_private_key, 'empty private key must preserve existing secret')
assert.equal(mergedFromEmpty.api_key, rawConfig.api_key, 'empty API key must preserve existing secret')
assert.equal(mergedFromEmpty.keyConfigured, undefined, 'configured marker must not be persisted')
assert.equal(mergedFromEmpty.merchant_private_keyConfigured, undefined, 'configured marker must not be persisted')
assert.equal(mergedFromEmpty.api_keyConfigured, undefined, 'configured marker must not be persisted')

const mergedFromPlaceholder = mergePaymentProviderConfigForUpdate(
  {
    key: MASKED_PAYMENT_SECRET_VALUE,
    merchant_private_key: MASKED_PAYMENT_SECRET_VALUE,
    api_key: MASKED_PAYMENT_SECRET_VALUE
  },
  rawConfig
)
assert.equal(mergedFromPlaceholder.key, rawConfig.key, 'placeholder merchant key must preserve existing secret')
assert.equal(mergedFromPlaceholder.merchant_private_key, rawConfig.merchant_private_key, 'placeholder private key must preserve existing secret')
assert.equal(mergedFromPlaceholder.api_key, rawConfig.api_key, 'placeholder API key must preserve existing secret')

const mergedFromRotation = mergePaymentProviderConfigForUpdate(
  {
    key: 'new-md5-secret',
    merchant_private_key: 'new-rsa-private-secret',
    api_key: 'new-heleket-secret'
  },
  rawConfig
)
assert.equal(mergedFromRotation.key, 'new-md5-secret', 'new merchant key must replace existing secret')
assert.equal(mergedFromRotation.merchant_private_key, 'new-rsa-private-secret', 'new private key must replace existing secret')
assert.equal(mergedFromRotation.api_key, 'new-heleket-secret', 'new API key must replace existing secret')

const validFinancialInput = validatePaymentProviderFinancialInput({
  feeRate: '0.03554',
  feeFixed: '0.344',
  minAmount: '10.124',
  maxAmount: '200.124'
}, { fillDefaults: true })
assert.equal(validFinancialInput.valid, true, 'valid payment provider financial config should pass')
assert.deepEqual(
  validFinancialInput.data,
  { feeRate: 0.0355, feeFixed: 0.34, minAmount: 10.12, maxAmount: 200.12 },
  'payment provider financial config must be normalized to database precision'
)

const invalidFeeRate = validatePaymentProviderFinancialInput({ feeRate: 1.01 }, { fillDefaults: true })
assert.equal(invalidFeeRate.valid, false, 'feeRate over 100% must be rejected')

const invalidFeeFixed = validatePaymentProviderFinancialInput({ feeFixed: -0.01 }, { fillDefaults: true })
assert.equal(invalidFeeFixed.valid, false, 'negative fixed fee must be rejected')

const invalidMinAmount = validatePaymentProviderFinancialInput({ minAmount: 0 }, { fillDefaults: true })
assert.equal(invalidMinAmount.valid, false, 'non-positive minAmount must be rejected')

const roundedToZeroMinAmount = validatePaymentProviderFinancialInput({ minAmount: 0.004 }, { fillDefaults: true })
assert.equal(roundedToZeroMinAmount.valid, false, 'minAmount rounded to zero at database precision must be rejected')

const invalidMaxAmount = validatePaymentProviderFinancialInput({
  minAmount: 100,
  maxAmount: 10
}, { fillDefaults: true })
assert.equal(invalidMaxAmount.valid, false, 'maxAmount below minAmount must be rejected')

const routeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
const adminProviderListIndex = routeSource.indexOf("app.get('/api/admin/payment-providers'")
assert.notEqual(adminProviderListIndex, -1, 'admin payment provider list route not found')
const nextRouteIndex = routeSource.indexOf("app.post('/api/admin/payment-providers'", adminProviderListIndex)
assert.notEqual(nextRouteIndex, -1, 'admin payment provider create route marker not found')
const listSection = routeSource.slice(adminProviderListIndex, nextRouteIndex)
assert.ok(
  listSection.includes('sanitizePaymentProviderForResponse'),
  'admin payment provider list must sanitize provider configs before responding'
)
assert.ok(
  routeSource.includes('mergePaymentProviderConfigForUpdate'),
  'admin payment provider update must preserve existing secrets for blank masked inputs'
)
assert.ok(
  routeSource.includes('validatePaymentProviderFinancialInput(input, { fillDefaults: true })'),
  'admin payment provider create must validate and normalize financial config'
)
assert.ok(
  routeSource.includes('const mergedFinancialValidation = db.validatePaymentProviderFinancialInput'),
  'admin payment provider update must validate merged financial config before persistence'
)
assert.ok(
  routeSource.includes('const patchFinancialValidation = db.validatePaymentProviderFinancialInput(input, { validateRange: false })'),
  'admin payment provider update must normalize only submitted financial fields before persistence'
)
assert.ok(
  routeSource.includes('const financialValidation = db.validatePaymentProviderFinancialInput({') &&
    routeSource.includes("app.patch('/api/admin/payment-providers/:id/status'"),
  'admin payment provider status change must reject existing invalid financial config before enabling'
)

console.log('payment provider secret redaction tests passed')
process.exit(0)
