import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260626120000_add_oauth_provider/migration.sql')
const grantMigration = read('server/prisma/migrations/20260626133000_add_oauth_grants_refresh_tokens/migration.sql')
const oauthProviderLib = read('server/src/lib/oauth-provider.ts')
const publicApiAuth = read('server/src/lib/public-api-auth.ts')
const adminRoutes = read('server/src/routes/admin-oauth-apps.ts')
const providerRoutes = read('server/src/routes/oauth-provider.ts')
const app = read('server/src/app.ts')
const openapi = read('server/src/lib/public-api-openapi.ts')
const adminApi = read('client/src/api/admin.ts')
const clientApi = read('client/src/api/index.ts')
const apiTypes = read('client/src/types/api.ts')
const oauthView = read('client/src/views/admin/OAuthConfigView.vue')
const oauthAuthorizeView = read('client/src/views/OAuthAuthorizeView.vue')
const userRouter = read('client/src/router/user.ts')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')

assert(
  schema.includes('model OAuthClientApp') &&
    schema.includes('model OAuthAuthorizationCode') &&
    schema.includes('model OAuthAccessToken') &&
    schema.includes('model OAuthGrant') &&
    schema.includes('model OAuthRefreshToken') &&
    schema.includes('oauthAppsCreated OAuthClientApp[]') &&
    schema.includes('oauthGrants OAuthGrant[]') &&
    schema.includes('oauthRefreshTokens OAuthRefreshToken[]') &&
    migration.includes('CREATE TABLE "oauth_client_apps"') &&
    migration.includes('CREATE TABLE "oauth_authorization_codes"') &&
    migration.includes('CREATE TABLE "oauth_access_tokens"') &&
    grantMigration.includes('CREATE TABLE "oauth_grants"') &&
    grantMigration.includes('CREATE TABLE "oauth_refresh_tokens"') &&
    grantMigration.includes('ALTER TABLE "oauth_access_tokens" ADD COLUMN "grant_id"') &&
    grantMigration.includes('oauth_grants_app_id_user_id_key'),
  'OAuth Provider schema and migration must create app, code, grant, access token, and refresh token models'
)

assert(
  oauthProviderLib.includes('OAUTH_CLIENT_SECRET_PREFIX') &&
    oauthProviderLib.includes('OAUTH_AUTHORIZATION_CODE_PREFIX') &&
    oauthProviderLib.includes('OAUTH_ACCESS_TOKEN_PREFIX') &&
    oauthProviderLib.includes('OAUTH_REFRESH_TOKEN_PREFIX') &&
    oauthProviderLib.includes('hashOAuthSecret') &&
    oauthProviderLib.includes('safeTimingEqual') &&
    oauthProviderLib.includes('normalizeOAuthRedirectUris') &&
    oauthProviderLib.includes('prepareOAuthAuthorizationRequest') &&
    oauthProviderLib.includes('tx.oAuthGrant.upsert') &&
    oauthProviderLib.includes('exchangeOAuthRefreshToken') &&
    oauthProviderLib.includes('generateOAuthRefreshToken') &&
    oauthProviderLib.includes('tx.oAuthRefreshToken.update') &&
    oauthProviderLib.includes('revokeOAuthAuthorization') &&
    oauthProviderLib.includes('listAdminOAuthAuthorizations') &&
    oauthProviderLib.includes('serializeAdminOAuthAuthorization') &&
    oauthProviderLib.includes('revokeOAuthAuthorizationById') &&
    oauthProviderLib.includes('activeAccessTokens') &&
    oauthProviderLib.includes('activeRefreshTokens') &&
    oauthProviderLib.includes('tx.oAuthAccessToken.updateMany') &&
    oauthProviderLib.includes('tx.oAuthRefreshToken.updateMany') &&
    oauthProviderLib.includes('Requested scope exceeds OAuth app grant') &&
    oauthProviderLib.includes('Authorization code has already been used') &&
    oauthProviderLib.includes('Authorization code has expired') &&
    oauthProviderLib.includes('Refresh token has been revoked') &&
    oauthProviderLib.includes('OAuth authorization has been revoked'),
  'OAuth Provider library must hash secrets, enforce redirect/scope checks, use one-time expiring codes, rotate refresh tokens, and revoke grants with linked tokens'
)

assert(
  publicApiAuth.includes("source: 'oauth_access_token'") &&
    publicApiAuth.includes('PUBLIC_API_SCOPE_METADATA') &&
    publicApiAuth.includes('listPublicApiScopeMetadata') &&
    publicApiAuth.includes('OAUTH_ACCESS_TOKEN_PREFIX') &&
    publicApiAuth.includes('prisma.oAuthAccessToken.findUnique') &&
    publicApiAuth.includes('OAUTH_APP_DISABLED') &&
    publicApiAuth.includes('oauth_provider.token_scope_denied') &&
    publicApiAuth.includes('prisma.oAuthAccessToken.update'),
  'Public API auth must accept OAuth access tokens with app status, revoke, expiry, user status, scope, and last-used checks'
)

assert(
    adminRoutes.includes("fastify.post<{ Body: OAuthAppBody }>('/',") &&
    adminRoutes.includes("'/authorizations'") &&
    adminRoutes.includes("'/authorizations/:id'") &&
    adminRoutes.includes('listAdminOAuthAuthorizations') &&
    adminRoutes.includes('revokeOAuthAuthorizationById') &&
    adminRoutes.includes('oauth_provider.admin_authorization_revoke') &&
    adminRoutes.includes("'/:id/rotate-secret'") &&
    adminRoutes.includes('clientSecret: result.clientSecret') &&
    providerRoutes.includes("'/authorize/consent'") &&
    providerRoutes.includes("'/authorize/confirm'") &&
    providerRoutes.includes("'/authorize'") &&
    providerRoutes.includes("'/token'") &&
    providerRoutes.includes("'/revoke'") &&
    providerRoutes.includes("'/scopes'") &&
    providerRoutes.includes("'/authorizations'") &&
    providerRoutes.includes("'/authorizations/:id'") &&
    providerRoutes.includes('scopeMetadata: listPublicApiScopeMetadata') &&
    providerRoutes.includes('OAUTH_CONSENT_REQUIRED') &&
    providerRoutes.includes('access_denied') &&
    providerRoutes.includes('exchangeOAuthRefreshToken') &&
    app.includes("prefix: '/api/admin/oauth-apps'") &&
    app.includes("prefix: '/api/oauth-provider'"),
  'OAuth Provider admin and public routes must expose app management, consent, authorize, token refresh, revoke, authorization list, and app registration'
)

assert(
  openapi.includes('oauthAccessToken') &&
    openapi.includes('/oauth-provider/scopes') &&
    openapi.includes('listOAuthProviderScopes') &&
    openapi.includes('OAuthScopeMetadata') &&
    openapi.includes('/oauth-provider/token') &&
    openapi.includes('/oauth-provider/authorize/consent') &&
    openapi.includes('/oauth-provider/authorize/confirm') &&
    openapi.includes('/oauth-provider/authorizations') &&
    openapi.includes('OAuthTokenRequest') &&
    openapi.includes('OAuthTokenResponse') &&
    openapi.includes('OAuthConsentResponse') &&
    openapi.includes('OAuthAuthorization') &&
    openapi.includes("pattern: '^poa_'") &&
    openapi.includes("pattern: '^por_'") &&
    openapi.includes("enum: ['authorization_code', 'refresh_token']"),
  'OpenAPI document must describe OAuth bearer support, token exchange, refresh tokens, consent, and authorization management'
)

assert(
    apiTypes.includes('export interface OAuthClientApp') &&
    apiTypes.includes('export interface AdminOAuthAuthorization') &&
    apiTypes.includes('activeAccessTokens') &&
    apiTypes.includes('activeRefreshTokens') &&
    apiTypes.includes('OAuthProviderConsentResponse') &&
    apiTypes.includes('PublicApiScopeMetadata') &&
    apiTypes.includes('scopeMetadata: PublicApiScopeMetadata[]') &&
    apiTypes.includes('OAuthProviderAuthorization') &&
    clientApi.includes('oauthProvider:') &&
    clientApi.includes('listScopes') &&
    clientApi.includes("http.get('/oauth-provider/scopes')") &&
    clientApi.includes("http.get('/oauth-provider/authorize/consent'") &&
    clientApi.includes("http.post('/oauth-provider/authorize/confirm'") &&
    clientApi.includes("http.get('/oauth-provider/authorizations')") &&
    userRouter.includes("path: '/oauth/authorize'") &&
    oauthAuthorizeView.includes('api.oauthProvider.getConsent') &&
    oauthAuthorizeView.includes('api.oauthProvider.listScopes') &&
    oauthAuthorizeView.includes('scopeMetadataByScope') &&
    oauthAuthorizeView.includes('response.scopeMetadata') &&
    oauthAuthorizeView.includes('api.oauthProvider.confirm') &&
    oauthAuthorizeView.includes('access_denied') &&
    adminApi.includes('oauthApps:') &&
    adminApi.includes('listScopes') &&
    adminApi.includes('listAuthorizations') &&
    adminApi.includes("http.get('/admin/oauth-apps/authorizations'") &&
    adminApi.includes('revokeAuthorization') &&
    adminApi.includes("http.delete(`/admin/oauth-apps/authorizations/${id}`)") &&
    adminApi.includes("http.post('/admin/oauth-apps'") &&
    oauthView.includes('PayIncus OAuth 服务端') &&
    oauthView.includes('loadOAuthScopes') &&
    oauthView.includes('availableOAuthScopes') &&
    oauthView.includes('scope.resources.join') &&
    oauthView.includes('scope.risk') &&
    oauthView.includes('OAuth 授权审计') &&
    oauthView.includes('loadOAuthAuthorizations') &&
    oauthView.includes('revokeOAuthAuthorization') &&
    oauthView.includes('oauthAuthorizationFilters') &&
    oauthView.includes('activeAccessTokens') &&
    oauthView.includes('saveOAuthApp') &&
    oauthView.includes('rotateOAuthAppSecret') &&
    oauthView.includes('Client Secret 只显示一次'),
  'Admin client must expose OAuth Provider app management UI and API wrappers'
)

assert(
  oauthView.match(/class="mt-6 space-y-3 lg:hidden"/g)?.length === 2 &&
    oauthView.match(/class="mt-6 hidden overflow-hidden lg:block"/g)?.length === 2 &&
    oauthView.includes('table class="w-full table-fixed text-sm"') &&
    oauthView.includes('table class="w-full table-fixed text-sm"') &&
    !oauthView.includes('class="mt-6 overflow-x-auto"') &&
    !oauthView.includes('table class="min-w-full text-sm"'),
  'OAuth admin UI must render mobile cards and fixed desktop tables instead of horizontal table scrolling'
)

assert(
  oauthView.includes('@click="editOAuthApp(appItem)"') &&
    oauthView.includes('@click="rotateOAuthAppSecret(appItem)"') &&
    oauthView.includes('@click="deleteOAuthApp(appItem)"') &&
    oauthView.includes('@click="revokeOAuthAuthorization(authorization)"') &&
    oauthView.includes('@click="setOAuthAuthorizationPage(oauthAuthorizationFilters.page - 1)"') &&
    oauthView.includes('@click="setOAuthAuthorizationPage(oauthAuthorizationFilters.page + 1)"'),
  'OAuth responsive admin UI must preserve app management, authorization revoke, and pagination actions'
)


assert(
  serverPackage.includes('"test:oauth-provider-guards"') &&
    rootPackage.includes('pnpm --filter server test:oauth-provider-guards'),
  'OAuth Provider guard must be wired into package scripts'
)

console.log('OAuth Provider guard checks passed')
