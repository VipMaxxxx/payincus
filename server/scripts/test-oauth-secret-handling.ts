import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decryptSensitiveData, encryptSensitiveData, isEncrypted } from '../src/lib/security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const plaintextSecret = 'oauth-client-secret'
const encryptedSecret = encryptSensitiveData(plaintextSecret)

assert.notEqual(encryptedSecret, plaintextSecret, 'OAuth client secret must be encrypted before storage')
assert.equal(isEncrypted(encryptedSecret), true, 'encrypted OAuth client secret must be detectable')
assert.equal(decryptSensitiveData(encryptedSecret), plaintextSecret, 'encrypted OAuth client secret must decrypt')
assert.equal(decryptSensitiveData(plaintextSecret), plaintextSecret, 'legacy plaintext OAuth client secret must remain readable')

const dbSource = readFileSync(resolve(__dirname, '../src/db/oauth.ts'), 'utf8')
assert.ok(
  dbSource.includes('decryptOAuthSecret(c.clientSecret)'),
  'OAuth config list must decrypt stored secrets only for internal masking logic'
)
assert.ok(
  dbSource.includes('decryptOAuthSecret(config.clientSecret)'),
  'OAuth callback lookup must decrypt encrypted client secrets'
)
assert.ok(
  dbSource.includes('const clientSecret = encryptOAuthSecret(data.clientSecret)'),
  'OAuth upsert must encrypt client secrets before persistence'
)
assert.ok(
  dbSource.includes('clientSecret,'),
  'OAuth upsert must write the encrypted client secret variable'
)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/oauth.ts'), 'utf8')
const adminConfigsIndex = routeSource.indexOf("fastify.get('/configs'")
const adminUpdateIndex = routeSource.indexOf("fastify.put<{", adminConfigsIndex)
assert.notEqual(adminConfigsIndex, -1, 'OAuth admin config list route not found')
assert.notEqual(adminUpdateIndex, -1, 'OAuth admin config update route not found')
const listSection = routeSource.slice(adminConfigsIndex, adminUpdateIndex)
assert.ok(
  listSection.includes('clientSecretMasked'),
  'OAuth admin config list must return masked client secrets'
)
assert.ok(
  !listSection.includes('client_secret: c.client_secret'),
  'OAuth admin config list must not return raw client_secret'
)
assert.ok(
  routeSource.includes("required: ['clientId']"),
  'OAuth update schema must allow omitting clientSecret when preserving an existing config'
)
assert.ok(
  routeSource.includes('shouldKeepExistingSecret'),
  'OAuth update route must preserve existing client secrets for blank placeholder updates'
)
assert.ok(
  routeSource.includes('OAUTH_CLIENT_SECRET_REQUIRED'),
  'OAuth create route must still require a client secret'
)

const clientSource = readFileSync(resolve(__dirname, '../../client/src/views/admin/OAuthConfigView.vue'), 'utf8')
assert.ok(
  clientSource.includes('if (form.value.clientSecret)'),
  'OAuth admin UI must only send clientSecret when the admin provides a new value'
)
assert.ok(
  !clientSource.includes("clientSecret: form.value.clientSecret || 'UNCHANGED'"),
  'OAuth admin UI must not send the legacy UNCHANGED placeholder as a client secret'
)

console.log('oauth secret handling tests passed')
process.exit(0)
