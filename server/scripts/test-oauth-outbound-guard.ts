import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const oauthSource = readFileSync(resolve(__dirname, '../src/routes/oauth.ts'), 'utf8')

assert.ok(
  oauthSource.includes("import { readLimitedTextResponse } from '../lib/http-response.js'"),
  'OAuth callback must use bounded response reads for provider responses'
)

assert.ok(
  oauthSource.includes('const OAUTH_PROVIDER_FETCH_TIMEOUT_MS = 15_000'),
  'OAuth provider fetches must have a bounded timeout'
)

assert.ok(
  oauthSource.includes('const OAUTH_PROVIDER_MAX_RESPONSE_BYTES = 128 * 1024'),
  'OAuth provider response bodies must be capped before JSON parsing'
)

const fetchSections = oauthSource.match(/await fetch\(providerConfig\.(?:tokenUrl|userUrl), \{[\s\S]*?\n      \}\)/g) ?? []
assert.equal(fetchSections.length, 2, 'OAuth callback must guard both token and userinfo fetches')

for (const section of fetchSections) {
  assert.ok(
    section.includes('signal: AbortSignal.timeout(OAUTH_PROVIDER_FETCH_TIMEOUT_MS)'),
    'OAuth provider fetches must use AbortSignal timeout'
  )
  assert.ok(
    section.includes("redirect: 'manual'"),
    'OAuth provider fetches must not automatically follow redirects'
  )
}

assert.ok(
  oauthSource.includes('readOAuthJsonResponse<{ access_token?: string; refresh_token?: string; error?: string; error_description?: string }>('),
  'OAuth token response must be parsed through the bounded JSON helper'
)

assert.ok(
  oauthSource.includes('readOAuthJsonResponse<Record<string, unknown>>('),
  'OAuth userinfo response must be parsed through the bounded JSON helper'
)

assert.ok(
  oauthSource.includes('if (!tokenRes.ok || !tokenData.access_token)'),
  'OAuth token exchange must reject non-2xx provider responses'
)

assert.ok(
  oauthSource.includes('if (!userRes.ok)'),
  'OAuth userinfo must reject non-2xx provider responses'
)

assert.ok(
  oauthSource.includes('if (!oauthUser.id)'),
  'OAuth callback must reject userinfo responses without a provider user id'
)

assert.ok(
  oauthSource.includes('sanitizeTokensInString(JSON.stringify(userData).slice(0, 2048))'),
  'OAuth userinfo failure previews must be bounded and token-sanitized'
)

console.log('OAuth outbound guard checks passed')
