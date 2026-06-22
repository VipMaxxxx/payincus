import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeHttpUrl, OutboundTargetValidationError } from '../src/lib/outbound-security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const rechargeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
assert.ok(
  rechargeSource.includes("import { assertSafeHttpUrl, isIpPrivateOrReserved } from '../lib/outbound-security.js'"),
  'recharge routes must import outbound URL validation'
)
assert.ok(
  rechargeSource.includes('async function validatePaymentProviderApiUrl'),
  'payment provider admin validation must validate outbound API URLs'
)
assert.ok(
  rechargeSource.includes('await validatePaymentProviderAdminInput(input.type, inputConfig, inputStatus)'),
  'payment provider create route must validate API URL before persistence'
)
assert.ok(
  rechargeSource.includes('await validatePaymentProviderAdminInput(existing.type, mergedConfig, mergedStatus)'),
  'payment provider update route must validate API URL before persistence'
)
assert.ok(
  rechargeSource.includes("apiurl: safeApiUrl.toString().replace(/\\/+$/, '')"),
  'payment provider API URL must be normalized before persistence'
)
assert.ok(
  rechargeSource.includes("await assertSafeHttpUrl(epayConfig.apiurl, 'Epay API URL')"),
  'Epay payment link creation must validate stored API URL before returning a redirect target'
)

const epaySource = readFileSync(resolve(__dirname, '../src/lib/epay.ts'), 'utf8')
assert.ok(
  epaySource.includes("await assertSafeHttpUrl(this.apiurl, 'Epay API URL')"),
  'Epay active order query must validate stored API URL before fetch'
)
assert.ok(
  epaySource.includes("redirect: 'manual'"),
  'Epay active order query must not automatically follow redirects to unsafe targets'
)

const heleketSource = readFileSync(resolve(__dirname, '../src/lib/heleket.ts'), 'utf8')
assert.ok(
  heleketSource.includes("await assertSafeHttpUrl(config.apiurl, 'Heleket API URL')"),
  'Heleket client must validate stored API URL before fetch'
)
assert.ok(
  heleketSource.includes("redirect: 'manual'"),
  'Heleket client must not automatically follow redirects to unsafe targets'
)

for (const unsafeUrl of [
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'http://10.0.0.8',
  'http://169.254.169.254/latest/meta-data',
  'file:///etc/passwd'
]) {
  await assert.rejects(
    () => assertSafeHttpUrl(unsafeUrl, 'Payment provider API URL'),
    OutboundTargetValidationError,
    `unsafe payment provider API URL must be rejected: ${unsafeUrl}`
  )
}

console.log('payment provider outbound guard tests passed')
