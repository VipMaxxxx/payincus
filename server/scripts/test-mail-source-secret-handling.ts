import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/payincus_test'

const {
  MASKED_MAIL_SOURCE_API_KEY_VALUE,
  mergeMailSourceApiKeyForUpdate,
  sanitizeMailDomainForResponse,
  sanitizeMailPlanForResponse,
  sanitizeMailSourceForResponse,
  sanitizeMailSubscriptionForResponse
} = await import('../src/db/mail.js')
const { decryptSensitiveData, encryptSensitiveData, isEncrypted } = await import('../src/lib/security.js')

const source = {
  id: 1,
  name: 'US Mail',
  code: 'us',
  apiUrl: 'https://api.example.com',
  apiKey: 'mail-source-api-key',
  smarterMailUrl: 'https://mail.example.com',
  enabled: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date()
}

const sanitized = sanitizeMailSourceForResponse(source)
assert.equal(sanitized.apiKey, '', 'mail source API key must not be returned to browser')
assert.equal(sanitized.apiKeyConfigured, true, 'mail source response must expose configured flag')
assert.equal(sanitized.apiUrl, source.apiUrl, 'non-secret mail source fields must remain visible')

const sanitizedPlan = sanitizeMailPlanForResponse({ id: 1, source })
assert.equal(sanitizedPlan.source.apiKey, '', 'admin mail plan responses must redact nested source API keys')
assert.equal(sanitizedPlan.source.apiKeyConfigured, true, 'admin mail plan responses must expose nested source configured flag')

const sanitizedSubscription = sanitizeMailSubscriptionForResponse({ id: 1, source })
assert.equal(sanitizedSubscription.source.apiKey, '', 'admin mail subscription responses must redact nested source API keys')

const sanitizedDomain = sanitizeMailDomainForResponse({ id: 1, source, adminPassword: 'mail-admin-password' })
assert.equal(sanitizedDomain.source.apiKey, '', 'admin mail domain responses must redact nested source API keys')
assert.equal(sanitizedDomain.adminPassword, '', 'admin mail domain responses must not return admin passwords')
assert.equal(sanitizedDomain.adminPasswordConfigured, true, 'admin mail domain responses must expose password configured flag')

assert.equal(mergeMailSourceApiKeyForUpdate(undefined), undefined, 'omitted API key must preserve existing secret')
assert.equal(mergeMailSourceApiKeyForUpdate(null), undefined, 'null API key must preserve existing secret')
assert.equal(mergeMailSourceApiKeyForUpdate(''), undefined, 'blank API key must preserve existing secret')
assert.equal(mergeMailSourceApiKeyForUpdate('***1234'), undefined, 'legacy masked API key must preserve existing secret')
assert.equal(mergeMailSourceApiKeyForUpdate(MASKED_MAIL_SOURCE_API_KEY_VALUE), undefined, 'placeholder API key must preserve existing secret')
assert.equal(mergeMailSourceApiKeyForUpdate('new-api-key'), 'new-api-key', 'new API key must replace existing secret')

const encrypted = encryptSensitiveData(source.apiKey)
assert.equal(isEncrypted(encrypted), true, 'mail source API key must use encrypted-at-rest format')
assert.equal(decryptSensitiveData(encrypted), source.apiKey, 'encrypted mail source API key must decrypt')
assert.equal(decryptSensitiveData(source.apiKey), source.apiKey, 'legacy plaintext mail source API key must remain readable')

const dbSource = readFileSync(resolve(__dirname, '../src/db/mail.ts'), 'utf8')
assert.ok(
  dbSource.includes('apiKey: encryptMailSecret(data.apiKey)'),
  'mail source create must encrypt API keys before persistence'
)
assert.ok(
  dbSource.includes('apiKey: encryptMailSecret(data.apiKey)'),
  'mail source update must encrypt new API keys before persistence'
)
assert.ok(
  dbSource.includes('adminPassword: data.adminPassword ? encryptMailSecret(data.adminPassword) : data.adminPassword'),
  'mail domain admin passwords must be encrypted before persistence'
)
assert.ok(
  dbSource.includes('decryptMailSource(source)'),
  'mail source reads must decrypt API keys for server-side delivery calls'
)
assert.ok(
  dbSource.includes('withDecryptedDomainSource(domain)'),
  'mail domain reads must decrypt source/API credentials for delivery calls'
)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')
assert.ok(
  routeSource.includes('sanitizeMailSourceForResponse'),
  'mail admin source responses must be sanitized'
)
assert.ok(
  routeSource.includes('plans: plans.map(db.sanitizeMailPlanForResponse)') &&
    routeSource.includes('subscriptions: result.subscriptions.map(db.sanitizeMailSubscriptionForResponse)') &&
    routeSource.includes('domains: result.domains.map(db.sanitizeMailDomainForResponse)'),
  'mail admin plan, subscription, and domain list responses must sanitize nested source secrets and domain passwords'
)
assert.ok(
  routeSource.includes('mergeMailSourceApiKeyForUpdate(sourceInput.apiKey)'),
  'mail admin source update must preserve existing API keys for blank masked inputs'
)
assert.ok(
  !routeSource.includes('adminPassword: domain.adminPassword,'),
  'mail user domain detail must not passively return domain admin passwords'
)
assert.ok(
  routeSource.includes("'/domains/:id/admin-password'") &&
    routeSource.includes('onRequest: [fastify.authenticate]') &&
    routeSource.includes('domain.subscription.userId !== request.user.id') &&
    routeSource.includes('adminPassword: domain.adminPassword ?? null'),
  'mail domain admin password must require an explicit authenticated owner-only password endpoint'
)
assert.ok(
  !routeSource.includes("apiKey: '***' + source.apiKey.slice(-4)"),
  'mail admin source list must not build API key masks from raw secrets'
)

const clientSource = readFileSync(resolve(__dirname, '../../client/src/views/admin/AdminMailView.vue'), 'utf8')
assert.ok(
  clientSource.includes('apiKey: \'\','),
  'mail admin source edit form must not prefill masked API keys'
)
assert.ok(
  !clientSource.includes('apiKey: source.apiKey ||'),
  'mail admin source edit form must not copy returned API key masks into the form'
)
assert.ok(
  clientSource.includes('delete (payload as Partial<typeof sourceForm.value>).apiKey'),
  'mail admin source update must omit blank API keys'
)

console.log('mail source secret handling tests passed')
process.exit(0)
