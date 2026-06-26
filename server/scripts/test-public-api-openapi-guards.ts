import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildPublicApiOpenApiDocument, stringifyPublicApiOpenApiYaml } from '../src/lib/public-api-openapi.js'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const route = read('server/src/routes/public-api.ts')
const openapiSource = read('server/src/lib/public-api-openapi.ts')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')

const document = buildPublicApiOpenApiDocument()
const serialized = JSON.stringify(document)
const yaml = stringifyPublicApiOpenApiYaml(document)
const paths = document.paths as Record<string, { get?: { parameters?: Array<{ name: string; schema?: { enum?: string[] } }> } }>

function queryParamNames(path: string): string[] {
  return (paths[path]?.get?.parameters || []).map(parameter => parameter.name)
}

function queryParamEnum(path: string, name: string): string[] {
  return paths[path]?.get?.parameters?.find(parameter => parameter.name === name)?.schema?.enum || []
}

assert.equal(document.openapi, '3.1.0', 'OpenAPI document must use OpenAPI 3.1.0')
assert.ok(
  document.info.title === 'PayIncus Public API' &&
    Array.isArray(document.servers) &&
    document.servers.some(server => server.url === '/api/v1') &&
    serialized.includes('publicApiToken') &&
    serialized.includes('sessionJwt'),
  'OpenAPI document must describe the PayIncus public API server and security schemes'
)

assert.ok(
  route.includes("fastify.get('/openapi.json'") &&
    route.includes("fastify.get('/openapi.yaml'") &&
    route.includes("type('application/yaml; charset=utf-8')") &&
    route.includes('buildPublicApiOpenApiDocument()') &&
    route.includes('stringifyPublicApiOpenApiYaml()') &&
    openapiSource.includes('export function stringifyPublicApiOpenApiYaml') &&
    openapiSource.includes("'/me'") &&
    openapiSource.includes('updateCurrentPublicApiProfile') &&
    openapiSource.includes("'/api-tokens'") &&
    openapiSource.includes("'/api-tokens/{id}'") &&
    openapiSource.includes("'/oauth-provider/scopes'") &&
    openapiSource.includes('listOAuthProviderScopes') &&
    openapiSource.includes('OAuthScopeMetadata') &&
    openapiSource.includes("'/plugins'") &&
    openapiSource.includes("'/plugins/{pluginId}/actions'") &&
    openapiSource.includes("'/services/{id}/renew'") &&
    openapiSource.includes("'/balance/adjustment-requests'") &&
    openapiSource.includes("'/billing-records'") &&
    openapiSource.includes("'/billing-records/{id}'") &&
    openapiSource.includes('profile:read') &&
    openapiSource.includes('profile:write') &&
    openapiSource.includes('balance:write') &&
    openapiSource.includes('billing:read') &&
    openapiSource.includes('services:billing') &&
    openapiSource.includes('UpdatePublicApiProfileRequest') &&
    openapiSource.includes('CreatePublicApiTokenRequest') &&
    openapiSource.includes('CreatePublicApiTokenResponse') &&
    openapiSource.includes('PublicApiToken') &&
    openapiSource.includes('ErrorResponse'),
  'public API routes must expose /api/v1/openapi.json with /me and API token management contracts'
)

assert.ok(
  serialized.includes('"openapi":"3.1.0"') &&
    yaml.includes('"openapi": "3.1.0"') &&
    yaml.includes('"paths":') &&
    yaml.includes('"/services/{id}/actions":') &&
    serialized.includes('getCurrentPublicApiProfile') &&
    serialized.includes('updateCurrentPublicApiProfile') &&
    serialized.includes('getCurrentPublicApiBalance') &&
    serialized.includes('listCurrentPublicApiBalanceLogs') &&
    serialized.includes('listCurrentPublicApiBalanceAdjustmentRequests') &&
    serialized.includes('createCurrentPublicApiBalanceAdjustmentRequest') &&
    serialized.includes('CreatePublicApiBalanceAdjustmentRequest') &&
    serialized.includes('PublicApiBalanceAdjustmentRequest') &&
    !serialized.includes('balanceLogId') &&
    !serialized.includes('Public API/OAuth token id used as an audit source reference') &&
    serialized.includes('Optional machine-readable details for conflict, validation, rate-limit, or workflow lock errors.') &&
    serialized.includes('This endpoint never changes balance, creates a payment, refunds funds, or writes a balance log directly') &&
    serialized.includes('listPublicBillingRecords') &&
    serialized.includes('getPublicBillingRecord') &&
    serialized.includes('PublicApiBillingRecord') &&
    serialized.includes('Returns only instance billing records owned by the authenticated user') &&
    serialized.includes('listPublicApiTokens') &&
    serialized.includes('createPublicApiToken') &&
    serialized.includes('revokePublicApiToken') &&
    serialized.includes('listOAuthProviderScopes') &&
    serialized.includes('OAuthScopeMetadata') &&
    serialized.includes('canonical scope metadata used by OAuth consent and Public API clients') &&
    serialized.includes('listPublicProducts') &&
    serialized.includes('listPublicServices') &&
    serialized.includes('PublicApiServiceIncluded') &&
    serialized.includes('^(product|plan)(,(product|plan))*$') &&
    serialized.includes('Allowed values: product, plan.') &&
    serialized.includes('queuePublicServiceAction') &&
    serialized.includes('renewPublicService') &&
    serialized.includes('PublicApiServiceRenewRequest') &&
    serialized.includes('PublicApiServiceRenewResult') &&
    serialized.includes('getPublicServiceTask') &&
    serialized.includes('cancelPublicServiceTask') &&
    serialized.includes('stricter public API rate limit') &&
    serialized.includes('database-backed token/plugin/action dynamic quota') &&
    serialized.includes('token/plugin/action dynamic quota') &&
    serialized.includes('normal actions allow 30 dispatches per minute') &&
    serialized.includes('strict actions allow 10 dispatches per minute') &&
    serialized.includes('across backend instances') &&
    serialized.includes('Administrators can override the quota globally, per plugin, or per plugin action') &&
    serialized.includes('Polling has its own public API rate limit') &&
    serialized.includes('TooManyRequests') &&
    serialized.includes('listPublicOrders') &&
    serialized.includes('getPublicOrder') &&
    serialized.includes('^(recharge|instance_billing):[1-9]') &&
    serialized.includes('listPublicTickets') &&
    serialized.includes('createPublicTicket') &&
    serialized.includes('createPublicTicketReply') &&
    serialized.includes('multipart/form-data') &&
    serialized.includes('CreatePublicApiTicketMultipartRequest') &&
    serialized.includes('CreatePublicApiTicketReplyMultipartRequest') &&
    serialized.includes('PublicApiTicketAttachment') &&
    serialized.includes('Storage provider file IDs and raw provider URLs are never returned') &&
    serialized.includes('Optional JPG, PNG, WebP, GIF, or AVIF images') &&
    serialized.includes('updatePublicTicketStatus') &&
    serialized.includes('UpdatePublicApiTicketStatusRequest') &&
    serialized.includes('PublicApiTicketStatusResult') &&
    serialized.includes('listPublicNotifications') &&
    serialized.includes('getPublicUnreadNotificationCount') &&
    serialized.includes('flash_sale_reminder') &&
    serialized.includes('service_action_update') &&
    serialized.includes('billing_notice') &&
    serialized.includes('plugin:<pluginId>:<templateId>') &&
    serialized.includes('enabled plugin-declared template') &&
    serialized.includes('maxProperties') &&
    serialized.includes('listPublicPluginActions') &&
    serialized.includes('getPublicPluginActions') &&
    serialized.includes('PublicPluginActionDescriptor') &&
    serialized.includes('PublicPluginActionCatalogItem') &&
    serialized.includes('PublicPluginActionCatalog') &&
    serialized.includes('Webhook URLs, secrets, configuration values, service-extension hooks, and gateway-extension hooks are not exposed.') &&
    serialized.includes('profile:write') &&
    serialized.includes('balance:read') &&
    serialized.includes('balance:write') &&
    serialized.includes('billing:read') &&
    serialized.includes('products:read') &&
    serialized.includes('services:read') &&
    serialized.includes('services:operate') &&
    serialized.includes('services:billing') &&
    serialized.includes('orders:read') &&
    serialized.includes('tickets:read') &&
    serialized.includes('tickets:write') &&
    serialized.includes('notifications:read') &&
    serialized.includes('notifications:send') &&
    serialized.includes('plugins:action'),
  'OpenAPI document must include operation IDs and the current public API scope allowlist'
)

for (const path of ['/balance/logs', '/balance/adjustment-requests', '/products', '/orders', '/billing-records', '/services', '/tickets', '/notifications', '/plugins']) {
  assert.ok(queryParamNames(path).includes('sort'), `${path} must expose a whitelisted sort query parameter`)
}

assert.deepEqual(queryParamEnum('/products', 'sort'), ['createdAt', '-createdAt'], 'product list sort must be createdAt only')
assert.ok(!queryParamNames('/products').includes('status'), 'product list must not document an unsupported status filter')
assert.deepEqual(queryParamEnum('/services', 'sort'), ['displayOrder', '-displayOrder', 'createdAt', '-createdAt'], 'service list sort must be displayOrder/createdAt only')
assert.deepEqual(queryParamEnum('/tickets', 'sort'), ['updatedAt', '-updatedAt', 'createdAt', '-createdAt'], 'ticket list sort must be updatedAt/createdAt only')
assert.ok(
  ['status', 'category', 'priority'].every(name => queryParamNames('/tickets').includes(name)),
  'ticket list OpenAPI must document status, category, and priority filters'
)
assert.deepEqual(queryParamEnum('/plugins', 'sort'), ['pluginId', '-pluginId', 'createdAt', '-createdAt'], 'plugin action catalog sort must be pluginId/createdAt only')

assert.ok(
    developmentDocs.includes('GET /api/v1/openapi.json') &&
    developmentDocs.includes('GET /api/oauth-provider/scopes') &&
    developmentDocs.includes('scopeMetadata') &&
    developmentDocs.includes('GET /api/v1/openapi.yaml') &&
    developmentDocs.includes('同时提供 JSON 和 YAML 两种格式') &&
    developmentDocs.includes('OpenAPI 3.1') &&
    developmentDocs.includes('PATCH /api/v1/me') &&
    developmentDocs.includes('GET /api/v1/balance') &&
    developmentDocs.includes('GET /api/v1/balance/logs') &&
    developmentDocs.includes('GET /api/v1/balance/adjustment-requests') &&
    developmentDocs.includes('POST /api/v1/balance/adjustment-requests') &&
    developmentDocs.includes('GET /api/v1/billing-records') &&
    developmentDocs.includes('GET /api/v1/billing-records/:id') &&
    developmentDocs.includes('状态固定进入后台审批') &&
    developmentDocs.includes('服务接口已经支持白名单 `include=product,plan`') &&
    developmentDocs.includes('受控 `include = product,plan`') &&
    developmentDocs.includes('POST /api/v1/services/:id/actions') &&
    developmentDocs.includes('POST /api/v1/services/:id/renew') &&
    developmentDocs.includes('GET /api/v1/services/:id/tasks/:taskId') &&
    developmentDocs.includes('DELETE /api/v1/services/:id/tasks/:taskId') &&
    developmentDocs.includes('GET /api/v1/orders/:id') &&
    developmentDocs.includes('订单 ID 形如 `recharge:123` 或 `instance_billing:456`') &&
    developmentDocs.includes('POST /api/v1/tickets/:id/replies') &&
    developmentDocs.includes('PATCH /api/v1/tickets/:id/status') &&
    developmentDocs.includes('GET /api/v1/notifications') &&
    developmentDocs.includes('GET /api/v1/notifications/unread-count') &&
    developmentDocs.includes('GET /api/v1/plugins') &&
    developmentDocs.includes('GET /api/v1/plugins/:pluginId/actions') &&
    developmentDocs.includes('只返回已启用扩展的公开 webhook action 契约') &&
    developmentDocs.includes('API Token 管理接口实际路径是 `/api/api-tokens`') &&
    platformPlan.includes('GET /api/v1/openapi.yaml') &&
    platformPlan.includes('scope 元数据目录') &&
    platformPlan.includes('订单/账单详情读取、服务 `include=product,plan`、受控服务续费已完成首版') &&
    platformPlan.includes('写入型资源 API 首版'),
  'docs must describe the OpenAPI endpoint and distinguish the current contract from remaining resource APIs'
)

assert.ok(
  serverPackage.includes('"test:public-api-openapi-guards"') &&
    rootPackage.includes('pnpm --filter server test:public-api-openapi-guards'),
  'public API OpenAPI guard must be wired into package scripts'
)

console.log('public API OpenAPI guard tests passed')
