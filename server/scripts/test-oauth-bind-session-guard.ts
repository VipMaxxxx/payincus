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
    oauthSource.includes("const safeRedirectUrl = getSafeRedirectUrl(redirect, validMode === 'bind' ? '/profile' : '/')") &&
    oauthSource.includes('const state = await generateOAuthState(validMode, safeRedirectUrl, bindSession)'),
  'OAuth authorize bind flow must preserve the validated bind-ticket session in signed state'
)

assert.ok(
  oauthSource.includes('function redirectWithQuery(baseUrl: string, params: Record<string, string>): string') &&
    oauthSource.includes("const errorRedirectBase = stateData.mode === 'bind' ? redirectUrl : loginRedirectBase") &&
    oauthSource.includes('return reply.redirect(redirectWithQuery(redirectUrl, { success: `bound_${provider}` }))') &&
    !oauthSource.includes('return reply.redirect(`/profile?success=bound_${provider}`)') &&
    !oauthSource.includes('return reply.redirect(`/profile?error=already_bound_other`)'),
  'OAuth bind callback redirects must use the validated redirect URL so admin profile stays under /admin/profile'
)

assert.ok(
  oauthSource.includes('function isAdminRedirectPath(redirectUrl: string): boolean') &&
    oauthSource.includes("return redirectUrl === '/admin' || redirectUrl.startsWith('/admin/')") &&
    oauthSource.includes('function getLoginPathForRedirect(redirectUrl: string): string') &&
    oauthSource.includes("return isAdminRedirectPath(redirectUrl) ? '/admin/login' : '/login'") &&
    oauthSource.includes('process.env.ADMIN_FRONTEND_URL') &&
    oauthSource.includes('const isAdminRedirect = isAdminRedirectPath(redirectUrl)') &&
    oauthSource.includes("const requiredEnv = isAdminRedirect ? 'ADMIN_FRONTEND_URL' : 'SITE_URL or FRONTEND_URL'"),
  'OAuth callback base selection must route /admin redirects through ADMIN_FRONTEND_URL without widening state redirects'
)

assert.ok(
  oauthSource.includes('const loginRedirectBase = getLoginPathForRedirect(redirectUrl)') &&
    oauthSource.includes('const errorRedirectBase = stateData.mode === \'bind\' ? redirectUrl : loginRedirectBase') &&
    oauthSource.includes("return reply.redirect(redirectWithQuery(loginRedirectBase, { error: 'not_bound', provider }))") &&
    oauthSource.includes("return reply.redirect(redirectWithQuery(loginRedirectBase, { error: 'user_not_found' }))") &&
    oauthSource.includes("return reply.redirect(redirectWithQuery(loginRedirectBase, { error: 'account_banned' }))") &&
    !oauthSource.includes('return reply.redirect(`/login?error=not_bound&provider=${provider}`)') &&
    !oauthSource.includes('return reply.redirect(`/login?error=user_not_found`)') &&
    !oauthSource.includes('return reply.redirect(`/login?error=account_banned`)'),
  'OAuth login callback errors must return to the build-specific login page instead of hardcoded customer /login'
)

assert.ok(
  oauthSource.includes('callbackUrl = buildOAuthCallbackUrl(request, provider, safeRedirectUrl)') &&
    oauthSource.includes('const callbackUrl = buildOAuthCallbackUrl(request, provider, redirectUrl)') &&
    !oauthSource.includes('callbackUrl = buildOAuthCallbackUrl(request, provider)\n') &&
    !oauthSource.includes('const callbackUrl = buildOAuthCallbackUrl(request, provider)\n'),
  'OAuth authorize and token exchange must use the same redirect-scoped callback URL'
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
