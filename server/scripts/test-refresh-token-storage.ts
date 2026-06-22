import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRefreshTokenSessionId, getRefreshTokenStorageKey } from '../src/lib/security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const rawToken = 'rt_plain-refresh-token-for-storage-test'
const storageKey = getRefreshTokenStorageKey(rawToken)
const sessionId = getRefreshTokenSessionId(rawToken)

assert.notEqual(storageKey, rawToken, 'refresh token storage key must not equal raw token')
assert.match(storageKey, /^sha256:[a-f0-9]{64}$/, 'refresh token storage key must be a sha256 digest')
assert.equal(getRefreshTokenStorageKey(storageKey), storageKey, 'hashed refresh token storage key must be idempotent')
assert.match(sessionId, /^[a-f0-9]{32}$/, 'refresh token session id must be derived from the digest')
assert.equal(rawToken.startsWith(sessionId), false, 'session id must not expose the raw token prefix')

const securitySource = readFileSync(resolve(__dirname, '../src/lib/security.ts'), 'utf8')
assert.ok(
  securitySource.includes('token: tokenHash'),
  'generateRefreshToken must persist the hashed storage key, not the raw token'
)
assert.ok(
  securitySource.includes('where: { token: storageKey }'),
  'verifyRefreshToken must look up hashed refresh tokens first'
)
assert.ok(
  securitySource.includes('where: { token }'),
  'verifyRefreshToken must retain legacy plaintext token lookup for compatibility'
)
assert.ok(
  securitySource.includes('data: { token: storageKey }'),
  'legacy plaintext refresh tokens must be upgraded to hashed storage keys after verification'
)
assert.ok(
  securitySource.includes('getRefreshTokenLookupKeys(token)'),
  'refresh token revocation/activity updates must handle hashed and legacy plaintext keys'
)

for (const relativePath of ['../src/routes/auth.ts', '../src/routes/oauth.ts']) {
  const routeSource = readFileSync(resolve(__dirname, relativePath), 'utf8')
  assert.ok(
    routeSource.includes('getRefreshTokenSessionId(refreshToken)'),
    `${relativePath} must derive session ids from the refresh token digest`
  )
  assert.ok(
    !routeSource.includes('refreshToken.substring(0, 20)'),
    `${relativePath} must not expose raw refresh token prefixes as session ids`
  )
}

console.log('refresh token storage tests passed')
process.exit(0)
