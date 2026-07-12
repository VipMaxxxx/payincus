import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  antomMinorAmountToCny,
  antomNotificationResponse,
  buildAntomConfig,
  calculateAntomMinorAmount,
  signAntomContent,
  verifyAntomWebhook
} from '../src/lib/antom.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const platformKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
const merchantKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

const built = buildAntomConfig({
  environment: 'sandbox',
  apiurl: 'https://open-sea-global.alipay.com',
  clientId: 'SANDBOX_PAYINCUS',
  antom_public_key: platformKeys.publicKey,
  merchant_private_key: merchantKeys.privateKey,
  currency: 'USD',
  currencyRate: 0.14,
  currencyExponent: 2,
  sessionExpiryMinutes: 30
})
assert.equal(built.valid, true, built.error)
assert.equal(calculateAntomMinorAmount(100, built.config), '1400')
assert.equal(antomMinorAmountToCny('1400', built.config), 100)
assert.equal(antomMinorAmountToCny('-1', built.config), null)

for (const apiurl of [
  'http://open-sea-global.alipay.com',
  'https://example.com',
  'https://open-sea-global.alipay.com/ams/api',
  'https://open-sea-global.alipay.com.evil.example'
]) {
  const invalid = buildAntomConfig({
    ...built.config,
    apiurl,
    antom_public_key: platformKeys.publicKey,
    merchant_private_key: merchantKeys.privateKey
  })
  assert.equal(invalid.valid, false, `unsafe or path-bearing Antom endpoint must be rejected: ${apiurl}`)
}

const requestUri = '/api/recharge/callback/12'
const requestTime = '1783576800000'
const rawBody = JSON.stringify({
  notifyType: 'PAYMENT_RESULT',
  paymentRequestId: 'R202607100001',
  paymentAmount: { currency: 'USD', value: '1400' },
  result: { resultCode: 'SUCCESS', resultStatus: 'S', resultMessage: 'success' }
})
const content = `POST ${requestUri}\n${built.config.clientId}.${requestTime}.${rawBody}`
const signature = encodeURIComponent(signAntomContent(content, platformKeys.privateKey))
const signatureHeader = `algorithm=RSA256, keyVersion=1, signature=${signature}`

assert.equal(verifyAntomWebhook({
  config: built.config,
  method: 'POST',
  requestUri,
  requestTime,
  clientId: built.config.clientId,
  signature: signatureHeader,
  rawBody
}), true)
assert.equal(verifyAntomWebhook({
  config: built.config,
  method: 'POST',
  requestUri,
  requestTime,
  clientId: built.config.clientId,
  signature: signatureHeader,
  rawBody: `${rawBody} `
}), false, 'signature verification must use the exact raw request body')
assert.deepEqual(antomNotificationResponse(true), {
  result: { resultCode: 'SUCCESS', resultStatus: 'S', resultMessage: 'Success' }
})

const antomSource = readFileSync(resolve(__dirname, '../src/lib/antom.ts'), 'utf8')
assert.ok(antomSource.includes("const prefix = config.environment === 'sandbox' ? '/ams/sandbox/api' : '/ams/api'"))
assert.ok(antomSource.includes("redirect: 'manual'"), 'Antom API calls must not follow redirects')
assert.ok(antomSource.includes('safeOutboundDispatcher'), 'Antom API calls must pin validated outbound DNS results')
assert.ok(antomSource.includes('Antom API 响应签名验证失败'), 'Antom API responses must be signature verified')

const rechargeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
assert.ok(rechargeSource.includes('preParsing: capturePaymentCallbackRawBody'), 'Antom webhooks require exact raw-body capture')
assert.ok(rechargeSource.includes('verifyAntomWebhook({'), 'Antom webhook signatures must be verified')
assert.ok(rechargeSource.includes("paidAmount.currency !== antomConfig.currency || paidAmount.value !== expectedMinor"))
assert.ok(
  rechargeSource.includes("} else if (provider.type !== 'antom') {\n      const diff = Math.abs(paidActualAmount - expectedAmount)"),
  'Antom must not be rejected by a second lossy CNY conversion after exact minor-unit validation'
)
assert.ok(rechargeSource.includes('isCallbackProcessed(providerIdNum, orderNo, tradeNoForIndex)'))
assert.ok(rechargeSource.includes('await markCallbackProcessed(providerIdNum, orderNo, tradeNoForIndex, clientIp)'))
// v1.4.0 起充值支持重试/repay，查询须用当前支付尝试的网关单号 gatewayOrderNo（首次==orderNo，重试为 orderNo--PA-<id>）。
assert.ok(rechargeSource.includes('new AntomClient(antomConfig).inquiryPayment(gatewayOrderNo)'))

const migration = readFileSync(
  resolve(__dirname, '../prisma/migrations/20260710000000_add_antom_payment_provider_type/migration.sql'),
  'utf8'
)
assert.ok(migration.includes("ADD VALUE IF NOT EXISTS 'antom'"))

console.log('Antom payment guard tests passed')
