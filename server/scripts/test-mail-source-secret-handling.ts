import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MASKED_MAIL_SOURCE_API_KEY_VALUE, mergeMailSourceApiKeyForUpdate, sanitizeMailSourceForResponse } from '../src/db/mail.js'
import { decryptSensitiveData, encryptSensitiveData, isEncrypted } from '../src/lib/security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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
  routeSource.includes('mergeMailSourceApiKeyForUpdate(sourceInput.apiKey)'),
  'mail admin source update must preserve existing API keys for blank masked inputs'
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
