import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const oauthSource = readFileSync(resolve(__dirname, '../src/routes/oauth.ts'), 'utf8')
const securitySource = readFileSync(resolve(__dirname, '../src/lib/security.ts'), 'utf8')

assert.ok(
  securitySource.includes('userIssuedAt?: number') &&
    securitySource.includes('userSessionId?: string') &&
    securitySource.includes("bindSession?: { userId: number; issuedAt: number; sessionId?: string }") &&
    securitySource.includes('userIssuedAt: bindSession?.issuedAt') &&
    securitySource.includes('userSessionId: bindSession?.sessionId'),
  'OAuth bind state must carry the source access-token issuance and session id'
)

assert.ok(
  oauthSource.includes('bindSession = {') &&
    oauthSource.includes('issuedAt: ticketData.issuedAt') &&
    oauthSource.includes('sessionId: ticketData.sessionId') &&
    oauthSource.includes("const state = await generateOAuthState(validMode, getSafeRedirectUrl(redirect, '/'), bindSession)"),
  'OAuth authorize bind flow must preserve the validated bind-ticket session in signed state'
)

const bindCallbackIndex = oauthSource.indexOf("if (stateData.mode === 'bind')")
const bindingLookupIndex = oauthSource.indexOf('const existingBinding = await db.findOAuthBinding(provider, oauthUser.id)')
assert.notEqual(bindCallbackIndex, -1, 'OAuth callback bind branch not found')
assert.notEqual(bindingLookupIndex, -1, 'OAuth callback binding write guard not found')

const bindCallbackGuard = oauthSource.slice(bindCallbackIndex, bindingLookupIndex)
assert.ok(
  bindCallbackGuard.includes('!userId || !stateData.userIssuedAt') &&
    bindCallbackGuard.includes('const bindSessionInvalidated = await isAccessTokenInvalidated(') &&
    bindCallbackGuard.includes('stateData.userIssuedAt') &&
    bindCallbackGuard.includes('stateData.userSessionId') &&
    bindCallbackGuard.includes("if (bindSessionInvalidated)") &&
    bindCallbackGuard.includes('const bindUser = await db.findUserById(userId)') &&
    bindCallbackGuard.includes("if (!bindUser || bindUser.status !== 'active')"),
  'OAuth callback bind flow must re-check session invalidation and active user status before writing bindings'
)

console.log('OAuth bind session guard checks passed')
