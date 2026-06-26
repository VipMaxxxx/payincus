import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260626100000_add_public_api_tokens/migration.sql')
const auth = read('server/src/lib/public-api-auth.ts')
const apiTokenRoutes = read('server/src/routes/api-tokens.ts')
const publicApiRoutes = read('server/src/routes/public-api.ts')
const app = read('server/src/app.ts')
const clientApi = read('client/src/api/index.ts')
const clientTypes = read('client/src/types/api.ts')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const rootPackage = read('package.json')
const serverPackage = read('server/package.json')

assert.ok(
  schema.includes('model PublicApiToken') &&
    schema.includes('tokenHash   String    @unique @map("token_hash")') &&
    schema.includes('scopes      Json      @default("[]")') &&
    schema.includes('revokedAt   DateTime? @map("revoked_at")') &&
    schema.includes('publicApiTokens      PublicApiToken[]') &&
    migration.includes('CREATE TABLE "public_api_tokens"') &&
    migration.includes('"token_hash" TEXT NOT NULL') &&
    migration.includes('"scopes" JSONB NOT NULL DEFAULT') &&
    migration.includes('public_api_tokens_token_hash_key') &&
    migration.includes('REFERENCES "users"("id") ON DELETE CASCADE'),
  'public API tokens must have a persisted model, migration, hashed token storage, scopes, revocation, expiry, and user ownership'
)

assert.ok(
  auth.includes("PUBLIC_API_TOKEN_PREFIX = 'pat_'") &&
    auth.includes('randomBytes(32)') &&
    auth.includes('hashPublicApiToken') &&
    auth.includes("createHash('sha256')") &&
    auth.includes('timingSafeEqual') &&
    auth.includes('readPublicApiBearerToken') &&
    auth.includes('authenticatePublicApiRequest') &&
    auth.includes('PUBLIC_API_SCOPES') &&
    auth.includes("'profile:read'") &&
    auth.includes("'profile:write'") &&
    auth.includes("'balance:read'") &&
    auth.includes("'balance:write'") &&
    auth.includes("'billing:read'") &&
    auth.includes("'products:read'") &&
    auth.includes("'services:read'") &&
    auth.includes("'services:operate'") &&
    auth.includes("'services:billing'") &&
    auth.includes("'orders:read'") &&
    auth.includes("'tickets:read'") &&
    auth.includes("'tickets:write'") &&
    auth.includes("'notifications:read'") &&
    auth.includes("'notifications:send'") &&
    auth.includes("'plugins:action'") &&
    auth.includes('PUBLIC_API_SCOPE_REQUIRED') &&
    auth.includes('lastUsedAt: new Date()') &&
    auth.includes('public_api.token_scope_denied'),
  'public API auth must generate one-time tokens, store only SHA256 hashes, validate bearer tokens, require scopes, and audit denied scope use'
)

assert.ok(
  apiTokenRoutes.includes("fastify.get('/',") &&
    apiTokenRoutes.includes("fastify.post<{") &&
    apiTokenRoutes.includes("fastify.delete<{") &&
    apiTokenRoutes.includes('onRequest: [fastify.authenticate]') &&
    apiTokenRoutes.includes('generatePublicApiToken()') &&
    apiTokenRoutes.includes('token: rawToken') &&
    apiTokenRoutes.includes('tokenHash') &&
    apiTokenRoutes.includes('revokedAt: new Date()') &&
    apiTokenRoutes.includes('public_api.token_create') &&
    apiTokenRoutes.includes('public_api.token_revoke'),
  'authenticated users must be able to list, create one-time-visible, and revoke their own public API tokens with audit logs'
)

assert.ok(
  publicApiRoutes.includes("fastify.get('/me'") &&
    publicApiRoutes.includes("authenticatePublicApiRequest(request, reply, 'profile:read')") &&
    publicApiRoutes.includes("fastify.patch<{ Body: PublicApiUpdateProfileBody }>('/me'") &&
    publicApiRoutes.includes("authenticatePublicApiRequest(request, reply, 'profile:write')") &&
    publicApiRoutes.includes('public_api.me_read') &&
    publicApiRoutes.includes('public_api.me_update') &&
    publicApiRoutes.includes('tokenId') &&
    publicApiRoutes.includes('scopes'),
  '/api/v1/me must be protected by public API token auth and profile read/write scopes'
)

assert.ok(
  app.includes("import apiTokenRoutes from './routes/api-tokens.js'") &&
    app.includes("import publicApiRoutes from './routes/public-api.js'") &&
    app.includes("await fastify.register(apiTokenRoutes, { prefix: '/api/api-tokens' })") &&
    app.includes("await fastify.register(publicApiRoutes, { prefix: '/api/v1' })"),
  'public API token management and /api/v1 routes must be registered'
)

assert.ok(
  clientTypes.includes('export type PublicApiScope') &&
    clientTypes.includes('export interface PublicApiToken') &&
    clientTypes.includes('CreatePublicApiTokenRequest') &&
    clientTypes.includes('CreatePublicApiTokenResponse') &&
    clientApi.includes('apiTokens:') &&
    clientApi.includes("http.get('/api-tokens')") &&
    clientApi.includes("http.post('/api-tokens', data)") &&
    clientApi.includes("http.delete(`/api-tokens/${id}`)"),
  'client API types and wrappers must expose public API token management'
)

assert.ok(
  developmentDocs.includes('## 公共 API 与 API Token') &&
    developmentDocs.includes('POST /api/api-tokens') &&
    developmentDocs.includes('Authorization: Bearer pat_') &&
    developmentDocs.includes('GET /api/v1/me') &&
    developmentDocs.includes('PATCH /api/v1/me') &&
    developmentDocs.includes('profile:read') &&
    developmentDocs.includes('profile:write') &&
    platformPlan.includes('/api/v1 公共 API 首版') &&
    platformPlan.includes('API token/scope 基础能力首版') &&
    platformPlan.includes('OpenAPI 3.1 基础契约首版') &&
    platformPlan.includes('资源 API 只读首版'),
  'extension platform docs must document the public API token foundation and remaining API work'
)

assert.ok(
  serverPackage.includes('"test:public-api-token-guards"') &&
    rootPackage.includes('pnpm --filter server test:public-api-token-guards'),
  'public API token guard must be wired into package scripts'
)

console.log('public API token guard tests passed')
