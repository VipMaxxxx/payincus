import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeHttpUrl, OutboundTargetValidationError } from '../src/lib/outbound-security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')
assert.ok(
  routeSource.includes("import { assertSafeHttpUrl } from '../lib/outbound-security.js'"),
  'mail routes must import outbound URL validation'
)
assert.ok(
  routeSource.includes('validateMailSourceOutboundUrls({') &&
    routeSource.includes('apiUrl: sourceInput.apiUrl') &&
    routeSource.includes('smarterMailUrl: sourceInput.smarterMailUrl'),
  'mail source create/update must validate external API URLs before persistence'
)
assert.ok(
  routeSource.includes("assertSafeHttpUrl(input.apiUrl, 'CraneMail API URL')"),
  'CraneMail API URL must be validated in admin mail source routes'
)
assert.ok(
  routeSource.includes("assertSafeHttpUrl(input.smarterMailUrl, 'SmarterMail URL')"),
  'SmarterMail URL must be validated in admin mail source routes'
)

const craneSource = readFileSync(resolve(__dirname, '../src/services/cranemail.ts'), 'utf8')
assert.ok(
  craneSource.includes("await assertSafeHttpUrl(source.apiUrl, 'CraneMail API URL')"),
  'CraneMail service must validate stored API URL before fetch'
)
assert.ok(
  craneSource.includes("import { readLimitedTextResponse } from '../lib/http-response.js'"),
  'CraneMail service must use bounded response reads'
)
assert.ok(
  craneSource.includes('signal: AbortSignal.timeout(CRANEMAIL_API_TIMEOUT_MS)'),
  'CraneMail fetch must use a bounded timeout'
)
assert.ok(
  craneSource.includes("readLimitedTextResponse(response, 'CraneMail API response', CRANEMAIL_MAX_RESPONSE_BYTES)"),
  'CraneMail response bodies must be capped before parsing'
)
assert.ok(
  craneSource.includes("redirect: 'manual'"),
  'CraneMail fetch must not automatically follow redirects to unsafe targets'
)

const smarterMailSource = readFileSync(resolve(__dirname, '../src/services/smartermail.ts'), 'utf8')
assert.ok(
  smarterMailSource.includes("await assertSafeHttpUrl(source.smarterMailUrl, 'SmarterMail URL')"),
  'SmarterMail service must validate stored API URL before fetch'
)
assert.ok(
  smarterMailSource.includes("import { readLimitedTextResponse } from '../lib/http-response.js'"),
  'SmarterMail service must use bounded response reads'
)
assert.ok(
  smarterMailSource.includes("import { sanitizeTokensInString } from '../lib/log-sanitizer.js'"),
  'SmarterMail service must sanitize token-like upstream error messages'
)
assert.equal(
  (smarterMailSource.match(/signal: AbortSignal.timeout\(SMARTERMAIL_API_TIMEOUT_MS\)/g) ?? []).length,
  2,
  'SmarterMail auth and API fetches must use bounded timeouts'
)
assert.ok(
  smarterMailSource.includes("readLimitedTextResponse(response, 'SmarterMail API error response', SMARTERMAIL_MAX_RESPONSE_BYTES)"),
  'SmarterMail error responses must be capped before being thrown'
)
assert.ok(
  smarterMailSource.includes("readLimitedTextResponse(response, 'SmarterMail API response', SMARTERMAIL_MAX_RESPONSE_BYTES)"),
  'SmarterMail success responses must be capped before parsing'
)
assert.ok(
  smarterMailSource.includes("redirect: 'manual'"),
  'SmarterMail fetch must not automatically follow redirects to unsafe targets'
)

const httpResponseSource = readFileSync(resolve(__dirname, '../src/lib/http-response.ts'), 'utf8')
assert.ok(
  httpResponseSource.includes('const DEFAULT_MAX_TEXT_RESPONSE_BYTES = 1024 * 1024'),
  'bounded text response helper must default to a 1MB cap'
)
assert.ok(
  httpResponseSource.includes('response.body.getReader()'),
  'bounded text response helper must stream chunked response bodies'
)
assert.ok(
  httpResponseSource.includes('totalBytes > maxBytes'),
  'bounded text response helper must enforce the cap while reading'
)

for (const unsafeUrl of [
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'http://10.0.0.5',
  'http://169.254.169.254/latest/meta-data',
  'file:///etc/passwd'
]) {
  await assert.rejects(
    () => assertSafeHttpUrl(unsafeUrl, 'Mail source URL'),
    OutboundTargetValidationError,
    `unsafe mail source URL must be rejected: ${unsafeUrl}`
  )
}

console.log('mail source outbound guard tests passed')
