import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const sdk = read('docs-site/docs/public/sdk/payincus-public-api.ts')
const serviceTaskExample = read('docs-site/docs/public/sdk/examples/service-power-task.ts')
const serviceRenewExample = read('docs-site/docs/public/sdk/examples/service-renew.ts')
const flashSaleExample = read('docs-site/docs/public/sdk/examples/flash-sale-action.ts')
const balanceAdjustmentExample = read('docs-site/docs/public/sdk/examples/balance-adjustment-request.ts')
const billingRecordsExample = read('docs-site/docs/public/sdk/examples/billing-records.ts')
const oauthAuthorizationCodeExample = read('docs-site/docs/public/sdk/examples/oauth-authorization-code.ts')
const sdkDocs = read('docs-site/docs/plugins/sdk.md')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const vitepressConfig = read('docs-site/docs/.vitepress/config.ts')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')

const forbiddenSdkMethods = [
  'createService(',
  'suspendService(',
  'unsuspendService(',
  'reinstallService(',
  'deleteService(',
  'migrateService(',
  'createPayment(',
  'verifyPayment(',
  'handlePaymentWebhook(',
  'refundPayment(',
  'rechargeBalance(',
  'deductBalance(',
  'approveBalanceAdjustment(',
  'updateEmail(',
  'updatePassword(',
  'updateTwoFactor(',
  'updateUserRole(',
  'updateUserStatus(',
  'installPlugin(',
  'enablePlugin(',
  'disablePlugin(',
  'uninstallPlugin(',
  'publishPlugin(',
  'enableTheme('
]

for (const method of forbiddenSdkMethods) {
  assert.equal(
    sdk.includes(method),
    false,
    `Public API SDK must not expose high-risk method ${method} before a reviewed public resource and state machine exist`
  )
}

const forbiddenSdkPaths = [
  '/users',
  '/payments',
  '/recharge',
  '/refunds',
  '/balance/recharge',
  '/balance/refund',
  '/balance/adjustments/',
  '/services/${id}/suspend',
  '/services/${id}/unsuspend',
  '/services/${id}/reinstall',
  '/services/${id}/delete',
  '/services/${id}/migrate',
  '/plugins/${pluginId}/install',
  '/plugins/${pluginId}/enable',
  '/plugins/${pluginId}/disable',
  '/plugins/${pluginId}/uninstall',
  '/themes/${themeId}/enable'
]

for (const path of forbiddenSdkPaths) {
  assert.equal(
    sdk.includes(path),
    false,
    `Public API SDK must not call high-risk path ${path} before the platform exposes a reviewed public API`
  )
}

assert.ok(
    sdk.includes('export class PayIncusPublicApiClient') &&
    sdk.includes('export class PayIncusPublicApiError') &&
    sdk.includes('export interface PayIncusPublicApiErrorBody') &&
    sdk.includes('export type PayIncusPublicApiSort') &&
    sdk.includes("sort?: PayIncusPublicApiSort") &&
    sdk.includes('PayIncusPublicApiScope') &&
    sdk.includes('PayIncusPublicApiScopeMetadata') &&
    sdk.includes("'profile:read'") &&
    sdk.includes("'profile:write'") &&
    sdk.includes("'balance:read'") &&
    sdk.includes("'balance:write'") &&
    sdk.includes("'billing:read'") &&
    sdk.includes("'products:read'") &&
    sdk.includes("'services:read'") &&
    sdk.includes("'services:operate'") &&
    sdk.includes("'services:billing'") &&
    sdk.includes("'orders:read'") &&
    sdk.includes("'tickets:read'") &&
    sdk.includes("'tickets:write'") &&
    sdk.includes("'notifications:read'") &&
    sdk.includes("'notifications:send'") &&
    sdk.includes("'plugins:action'"),
  'public API SDK must export a typed client, typed errors, and the current public scope allowlist'
)

assert.ok(
    sdk.includes('getProfile()') &&
    sdk.includes('listOAuthScopes()') &&
    sdk.includes('updateProfile(input: { avatarStyle: string })') &&
    sdk.includes('getBalance()') &&
    sdk.includes('listBalanceLogs(options: PayIncusBalanceLogOptions = {})') &&
    sdk.includes('PayIncusBalanceLog') &&
    sdk.includes('PayIncusBalanceAdjustmentRequest') &&
    sdk.includes('PayIncusBalanceAdjustmentRequestListOptions') &&
    sdk.includes('PayIncusCreateBalanceAdjustmentRequestInput') &&
    sdk.includes('listBalanceAdjustmentRequests(options: PayIncusBalanceAdjustmentRequestListOptions = {})') &&
    sdk.includes('createBalanceAdjustmentRequest(input: PayIncusCreateBalanceAdjustmentRequestInput)') &&
    sdk.includes('PayIncusBillingRecord') &&
    sdk.includes('PayIncusBillingRecordListOptions') &&
    sdk.includes('listBillingRecords(options: PayIncusBillingRecordListOptions = {})') &&
    sdk.includes('getBillingRecord(id: number)') &&
    sdk.includes('listProducts(options: PayIncusListOptions = {})') &&
    sdk.includes('getProduct(id: number)') &&
    sdk.includes('PayIncusServiceListOptions') &&
    sdk.includes('PayIncusServiceStatus') &&
    sdk.includes('PayIncusServiceInclude') &&
    sdk.includes('PayIncusServiceIncludeOptions') &&
    sdk.includes('PayIncusServiceIncluded') &&
    sdk.includes('PayIncusServiceListResponse') &&
    sdk.includes('PayIncusServiceResponse') &&
    sdk.includes('listServices(options: PayIncusServiceListOptions = {})') &&
    sdk.includes('getService(id: number, options: PayIncusServiceIncludeOptions = {})') &&
    sdk.includes('queueServiceAction(id: number, action: PayIncusServiceAction)') &&
    sdk.includes('getServiceTask(id: number, taskId: number)') &&
    sdk.includes('cancelServiceTask(id: number, taskId: number)') &&
    sdk.includes('PayIncusServiceActionResult') &&
    sdk.includes('PayIncusServiceTask') &&
    sdk.includes('PayIncusServiceRenewResult') &&
    sdk.includes('renewService(id: number, months: number)') &&
    sdk.includes('PayIncusOrderListOptions') &&
    sdk.includes('listOrders(options: PayIncusOrderListOptions = {})') &&
    sdk.includes('getOrder(id: string)') &&
    sdk.includes('PayIncusTicketListOptions') &&
    sdk.includes('PayIncusTicketAttachment') &&
    sdk.includes('PayIncusTicketImageAttachment') &&
    sdk.includes('PayIncusCreateTicketReplyInput') &&
    sdk.includes('listTickets(options: PayIncusTicketListOptions = {})') &&
    sdk.includes('createTicket(input: PayIncusCreateTicketInput)') &&
    sdk.includes('getTicket(id: number)') &&
    sdk.includes('replyToTicket(id: number, input: string | PayIncusCreateTicketReplyInput)') &&
    sdk.includes('PayIncusTicketStatusAction') &&
    sdk.includes('PayIncusTicketStatusResult') &&
    sdk.includes('updateTicketStatus(id: number, action: PayIncusTicketStatusAction)') &&
    sdk.includes('listNotifications(options: PayIncusNotificationListOptions = {})') &&
    sdk.includes('getUnreadNotificationCount()') &&
    sdk.includes('PayIncusNotificationTemplateId') &&
    sdk.includes("type PayIncusNotificationTemplateId = 'flash_sale_reminder' | 'service_action_update' | 'billing_notice' | `plugin:${string}:${string}`") &&
    sdk.includes('variables?: Record<string, string | number | boolean>') &&
    sdk.includes('template: PayIncusNotificationTemplateId | null') &&
    sdk.includes('sendNotification(input: PayIncusNotificationInput)') &&
    sdk.includes('PayIncusPluginActionDescriptor') &&
    sdk.includes('PayIncusPluginActionCatalogItem') &&
    sdk.includes('PayIncusPluginActionCatalog') &&
    sdk.includes('listPluginActions(options: PayIncusListOptions = {})') &&
    sdk.includes('getPluginActions(pluginId: string)') &&
    sdk.includes('dispatchPluginAction(') &&
    sdk.includes('private parsePayload(text: string)') &&
    sdk.includes('return { error: text }') &&
    sdk.includes('private errorBody(payload: unknown): PayIncusPublicApiErrorBody | null') &&
    sdk.includes('errorBody?.details ?? payload') &&
    !sdk.includes('balanceLogId') &&
    !sdk.includes("sourceType: 'public_api' | null") &&
    !sdk.includes('sourceId: number | null'),
  'public API SDK must cover the current profile, product, service, order, ticket, notification, and plugin action APIs'
)

assert.ok(
  sdk.includes('Authorization: `Bearer ${this.token}`') &&
    sdk.includes("`${this.baseUrl}/api/v1${path}`") &&
    sdk.includes('oauthProviderRequest') &&
    sdk.includes("`${this.baseUrl}/api/oauth-provider${path}`") &&
    sdk.includes("return this.oauthProviderRequest('/scopes')") &&
    sdk.includes("this.request('/me', { method: 'PATCH'") &&
    sdk.includes('this.request(`/balance/adjustment-requests${this.query(options)}`)') &&
    sdk.includes("this.request('/balance/adjustment-requests', { method: 'POST', body: input })") &&
    sdk.includes('this.request(`/billing-records${this.query(options)}`)') &&
    sdk.includes('this.request(`/billing-records/${id}`)') &&
    sdk.includes("this.request(`/services/${id}/actions`, { method: 'POST'") &&
    sdk.includes("this.request(`/services/${id}/renew`, { method: 'POST', body: { months } })") &&
    sdk.includes('this.request(`/services/${id}/tasks/${taskId}`)') &&
    sdk.includes("this.request(`/services/${id}/tasks/${taskId}`, { method: 'DELETE' })") &&
    sdk.includes('this.request(`/orders/${encodeURIComponent(id)}`)') &&
    sdk.includes("this.request('/tickets', {") &&
    sdk.includes('PayIncusTicketAttachment') &&
    sdk.includes('PayIncusTicketImageAttachment') &&
    sdk.includes('private ticketFormData') &&
    sdk.includes("form.append('images', blob, filename)") &&
    sdk.includes('attachments?.length ? this.ticketFormData') &&
    sdk.includes('const isFormData = typeof FormData') &&
    sdk.includes("options.body === undefined || isFormData ? {} : { 'Content-Type': 'application/json' }") &&
    sdk.includes("this.request(`/tickets/${id}/status`, { method: 'PATCH'") &&
    sdk.includes("this.request('/notifications', { method: 'POST'") &&
    sdk.includes('this.request(`/plugins${this.query(options)}`)') &&
    sdk.includes('this.request(`/plugins/${encodeURIComponent(pluginId)}/actions`)') &&
    !sdk.includes('/api/admin/') &&
    !sdk.includes('/api/api-tokens'),
  'public API SDK must use Bearer tokens against /api/v1 and avoid admin/session token-management APIs'
)

assert.ok(
  serviceTaskExample.includes('PayIncusPublicApiClient') &&
    serviceTaskExample.includes('listServices({') &&
    serviceTaskExample.includes("status: 'running'") &&
    serviceTaskExample.includes("include: ['product', 'plan']") &&
    serviceTaskExample.includes("queuePowerTask(service.id, 'restart')") &&
    serviceTaskExample.includes('getServiceTask(serviceId, taskId)') &&
    serviceTaskExample.includes("task.data.status !== 'PENDING'") &&
    serviceTaskExample.includes("task.data.status !== 'PROCESSING'") &&
    serviceTaskExample.includes('PayIncusPublicApiError') &&
    serviceRenewExample.includes('PayIncusPublicApiClient') &&
    serviceRenewExample.includes('PAYINCUS_SERVICE_ID') &&
    serviceRenewExample.includes('PAYINCUS_RENEW_MONTHS') &&
    serviceRenewExample.includes('renewService(serviceId, months)') &&
    serviceRenewExample.includes('PayIncusPublicApiError') &&
    flashSaleExample.includes('PayIncusPublicApiClient') &&
    flashSaleExample.includes('getProfile()') &&
    flashSaleExample.includes('dispatchPluginAction(pluginId, \'reserveStock\'') &&
    flashSaleExample.includes('idempotencyKey') &&
    flashSaleExample.includes('sendNotification({') &&
    flashSaleExample.includes('createTicket({') &&
    flashSaleExample.includes('PayIncusPublicApiError') &&
    balanceAdjustmentExample.includes('createBalanceAdjustmentRequest({') &&
    balanceAdjustmentExample.includes('listBalanceAdjustmentRequests({ status: \'pending\'') &&
    balanceAdjustmentExample.includes('PAYINCUS_ADJUSTMENT_AMOUNT') &&
    balanceAdjustmentExample.includes('PAYINCUS_ADJUSTMENT_REASON') &&
    balanceAdjustmentExample.includes('PayIncusPublicApiError') &&
    billingRecordsExample.includes('listBillingRecords({') &&
    billingRecordsExample.includes('getBillingRecord(first.id)') &&
    billingRecordsExample.includes('PAYINCUS_SERVICE_ID') &&
    billingRecordsExample.includes('PayIncusPublicApiError') &&
    oauthAuthorizationCodeExample.includes('buildAuthorizationUrl') &&
    oauthAuthorizationCodeExample.includes("new URL('/oauth/authorize', baseUrl)") &&
    oauthAuthorizationCodeExample.includes("grantType: 'authorization_code'") &&
    oauthAuthorizationCodeExample.includes("grantType: 'refresh_token'") &&
    oauthAuthorizationCodeExample.includes("new URL('/api/oauth-provider/token', baseUrl)") &&
    oauthAuthorizationCodeExample.includes('verifyOAuthState(state)') &&
    oauthAuthorizationCodeExample.includes('timingSafeEqual') &&
    oauthAuthorizationCodeExample.includes('token.access_token') &&
    oauthAuthorizationCodeExample.includes('token.refresh_token') &&
    oauthAuthorizationCodeExample.includes('refreshTokenRotated') &&
    oauthAuthorizationCodeExample.includes('PayIncusPublicApiClient') &&
    oauthAuthorizationCodeExample.includes('getProfile()') &&
    !serviceTaskExample.includes('/api/admin') &&
    !serviceRenewExample.includes('/api/admin') &&
    !flashSaleExample.includes('/api/admin') &&
    !balanceAdjustmentExample.includes('/api/admin') &&
    !billingRecordsExample.includes('/api/admin') &&
    !oauthAuthorizationCodeExample.includes('/api/admin') &&
    !serviceTaskExample.includes('/api/api-tokens') &&
    !serviceRenewExample.includes('/api/api-tokens') &&
    !flashSaleExample.includes('/api/api-tokens') &&
    !balanceAdjustmentExample.includes('/api/api-tokens') &&
    !billingRecordsExample.includes('/api/api-tokens') &&
    !oauthAuthorizationCodeExample.includes('/api/api-tokens'),
  'public API SDK examples must demonstrate service task polling, service renewal, flash-sale plugin action usage, balance adjustment review requests, billing record reads, and OAuth authorization code exchange without admin or session APIs'
)

assert.ok(
    sdkDocs.includes('# Public API SDK') &&
    sdkDocs.includes('https://payincus.com/sdk/payincus-public-api.ts') &&
    sdkDocs.includes('https://payincus.com/sdk/examples/service-power-task.ts') &&
    sdkDocs.includes('https://payincus.com/sdk/examples/service-renew.ts') &&
    sdkDocs.includes('https://payincus.com/sdk/examples/flash-sale-action.ts') &&
    sdkDocs.includes('https://payincus.com/sdk/examples/balance-adjustment-request.ts') &&
    sdkDocs.includes('https://payincus.com/sdk/examples/billing-records.ts') &&
    sdkDocs.includes('https://payincus.com/sdk/examples/oauth-authorization-code.ts') &&
    sdkDocs.includes('PayIncusPublicApiClient') &&
    sdkDocs.includes('listOAuthScopes()') &&
    sdkDocs.includes('GET /api/oauth-provider/scopes') &&
    sdkDocs.includes('不需要在客户端硬编码 scope 描述') &&
    sdkDocs.includes('pat_') &&
    sdkDocs.includes('poa_') &&
    sdkDocs.includes('getBalance()') &&
    sdkDocs.includes('listBalanceLogs()') &&
    sdkDocs.includes('listBalanceAdjustmentRequests()') &&
    sdkDocs.includes('createBalanceAdjustmentRequest(input)') &&
    sdkDocs.includes('listBillingRecords()') &&
    sdkDocs.includes('getBillingRecord(id)') &&
    sdkDocs.includes('当前 token 用户自己的账户余额和余额流水') &&
    sdkDocs.includes('只提交当前 token 用户自己的待审批余额调整申请') &&
    sdkDocs.includes('不会直接写余额、余额流水、支付或充值订单') &&
    sdkDocs.includes('只读取当前 token 用户自己的实例计费记录') &&
    sdkDocs.includes('不返回余额流水对象、支付回调、provider payload、内部对账数据或其他用户账单') &&
    sdkDocs.includes("listServices({ status, include: ['product', 'plan'], sort: 'displayOrder' })") &&
    sdkDocs.includes("getService(id, { include: 'product' })") &&
    sdkDocs.includes('include 只返回当前用户服务已关联的产品/套餐摘要') &&
    sdkDocs.includes("listOrders({ status, sort: '-createdAt' })") &&
    sdkDocs.includes('getOrder(id)') &&
    sdkDocs.includes('只读取当前 token 用户自己的单条公共订单') &&
    sdkDocs.includes('订单 ID 形如 `recharge:123` 或 `instance_billing:456`') &&
    sdkDocs.includes('不返回支付回调数据、provider 配置快照、原始查询结果或完整交易号') &&
    sdkDocs.includes("listTickets({ status, category, priority, sort: '-updatedAt' })") &&
    sdkDocs.includes('只传递平台白名单过滤参数') &&
    sdkDocs.includes('所有列表方法都支持统一 `page`、`pageSize` 和白名单 `sort`') &&
    sdkDocs.includes('响应的 `meta.sort` 会返回实际采用的排序') &&
    sdkDocs.includes('服务列表额外支持 `displayOrder` / `-displayOrder`') &&
    sdkDocs.includes('扩展 action 目录额外支持 `pluginId` / `-pluginId`') &&
    sdkDocs.includes('listNotifications()') &&
    sdkDocs.includes('getUnreadNotificationCount()') &&
    sdkDocs.includes('queueServiceAction(id, action)') &&
    sdkDocs.includes('getServiceTask(id, taskId)') &&
    sdkDocs.includes('cancelServiceTask(id, taskId)') &&
    sdkDocs.includes('renewService(id, months)') &&
    sdkDocs.includes('service-renew.ts') &&
    sdkDocs.includes('会触发真实余额扣款和续费账单') &&
    sdkDocs.includes('只允许为当前 token 用户自己的服务排队') &&
    sdkDocs.includes('只读取这些公开电源任务的状态') &&
    sdkDocs.includes('只取消仍处于 `PENDING` 的公开电源任务') &&
    sdkDocs.includes('响应不返回余额流水 ID、支付回调或 provider payload') &&
    sdkDocs.includes('当前 token 用户自己的站内信展示字段和未读数量') &&
    sdkDocs.includes('listPluginActions()') &&
    sdkDocs.includes('getPluginActions(pluginId)') &&
    sdkDocs.includes('只返回已启用扩展的公开 webhook action 契约') &&
    sdkDocs.includes('不会返回 webhook URL、secret、配置值') &&
    sdkDocs.includes('写入型 SDK 方法会受到平台 Public API 独立限流保护') &&
    sdkDocs.includes('`status = 429`') &&
    sdkDocs.includes('扩展 action dispatch 还会按 token + 扩展 + action 套用数据库持久化动态配额') &&
    sdkDocs.includes('后台可按全局、扩展或 action 覆盖策略') &&
    sdkDocs.includes('同一数据库下多实例共享计数窗口') &&
    sdkDocs.includes('错误码为 `PUBLIC_PLUGIN_ACTION_RATE_LIMITED`') &&
    sdkDocs.includes('error.details') &&
    sdkDocs.includes('createTicket(input)') &&
    sdkDocs.includes('updateTicketStatus(id, action)') &&
    sdkDocs.includes("updateTicketStatus(ticket.data.id, 'close')") &&
    sdkDocs.includes('只允许当前 token 用户关闭自己的工单或重新打开自己的已关闭工单') &&
    sdkDocs.includes('dispatchPluginAction(pluginId, action, input)') &&
    sdkDocs.includes('service-power-task.ts') &&
    sdkDocs.includes('service-renew.ts') &&
    sdkDocs.includes('flash-sale-action.ts') &&
    sdkDocs.includes('balance-adjustment-request.ts') &&
    sdkDocs.includes('billing-records.ts') &&
    sdkDocs.includes('oauth-authorization-code.ts') &&
    sdkDocs.includes('生成稳定 `idempotencyKey`') &&
    sdkDocs.includes('生成 OAuth 授权 URL、校验 `state`、用 authorization code 换取 `poa_` access token 和 `por_` refresh token') &&
    sdkDocs.includes('`PAYINCUS_OAUTH_CLIENT_SECRET` 不应放进浏览器、移动端或扩展 iframe') &&
    sdkDocs.includes('示例不会指定其他用户、不会调用 `/api/admin/*`') &&
    sdkDocs.includes('SDK 不会调用 `/api/admin/*`') &&
    sdkDocs.includes('这些不是 SDK 的遗漏，而是 Public API 的高风险准入边界') &&
    sdkDocs.includes('新增前必须先有公开资源设计、独立 scope、OpenAPI 契约、审计日志、限流、幂等、防跨用户校验、状态机回滚和生产 proof') &&
    sdkDocs.includes('扩展安装、启用、停用、卸载、市场发布或主题启用') &&
    vitepressConfig.includes("{ text: 'Public API SDK', link: '/plugins/sdk' }"),
  'docs site must expose the Public API SDK download, usage, token sources, method list, and sidebar entry'
)

assert.ok(
  developmentDocs.includes('GET https://payincus.com/sdk/payincus-public-api.ts') &&
    developmentDocs.includes('GET /api/oauth-provider/scopes') &&
    developmentDocs.includes('scopeMetadata') &&
    developmentDocs.includes('GET https://payincus.com/sdk/examples/service-power-task.ts') &&
    developmentDocs.includes('GET https://payincus.com/sdk/examples/service-renew.ts') &&
    developmentDocs.includes('GET https://payincus.com/sdk/examples/flash-sale-action.ts') &&
    developmentDocs.includes('GET https://payincus.com/sdk/examples/balance-adjustment-request.ts') &&
    developmentDocs.includes('GET https://payincus.com/sdk/examples/billing-records.ts') &&
    developmentDocs.includes('GET https://payincus.com/sdk/examples/oauth-authorization-code.ts') &&
    developmentDocs.includes('https://payincus.com/plugins/sdk') &&
    platformPlan.includes('Public API TypeScript SDK 和示例首版') &&
    platformPlan.includes('scope 元数据目录') &&
    platformPlan.includes('sdk/payincus-public-api.ts') &&
    platformPlan.includes('sdk/examples/service-power-task.ts') &&
    platformPlan.includes('sdk/examples/service-renew.ts') &&
    platformPlan.includes('sdk/examples/flash-sale-action.ts') &&
    platformPlan.includes('sdk/examples/balance-adjustment-request.ts') &&
    platformPlan.includes('sdk/examples/billing-records.ts') &&
    platformPlan.includes('sdk/examples/oauth-authorization-code.ts') &&
    platformPlan.includes('订单列表/详情') &&
    platformPlan.includes('OAuth authorization code 换 token 和 refresh token 轮换示例') &&
    platformPlan.includes('受控续费') &&
    platformPlan.includes('扩展 action 发现/触发能力') &&
    platformPlan.includes('服务/订单/账单/工单白名单过滤和列表排序') &&
    platformPlan.includes('统一分页、白名单排序、服务/订单/账单/工单列表白名单过滤') &&
    platformPlan.includes('OAuth authorization code 示例') &&
    platformPlan.includes('文档站已提供 Public API TypeScript SDK、服务电源任务轮询示例、服务续费示例、秒杀扩展 action 示例、余额调整申请示例和账单读取示例首版'),
  'extension platform docs must describe the first Public API SDK release and stable docs-site download path'
)

assert.ok(
  serverPackage.includes('"test:public-api-sdk-guards"') &&
    rootPackage.includes('pnpm --filter server test:public-api-sdk-guards'),
  'public API SDK guard must be wired into package scripts'
)

console.log('public API SDK guard tests passed')
