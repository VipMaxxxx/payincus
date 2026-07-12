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
const balanceAdjustmentExample = read('docs-site/docs/public/sdk/examples/balance-adjustment-request.ts')
const billingRecordsExample = read('docs-site/docs/public/sdk/examples/billing-records.ts')
const oauthAuthorizationCodeExample = read('docs-site/docs/public/sdk/examples/oauth-authorization-code.ts')
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
  'updateUserStatus('
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
  '/services/${id}/migrate'
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
    sdk.includes("'notifications:send'"),
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
    sdk.includes('variables?: Record<string, string | number | boolean>') &&
    sdk.includes('template: PayIncusNotificationTemplateId | null') &&
    sdk.includes('sendNotification(input: PayIncusNotificationInput)') &&
    sdk.includes('private parsePayload(text: string)') &&
    sdk.includes('return { error: text }') &&
    sdk.includes('private errorBody(payload: unknown): PayIncusPublicApiErrorBody | null') &&
    sdk.includes('errorBody?.details ?? payload') &&
    !sdk.includes('balanceLogId') &&
    !sdk.includes("sourceType: 'public_api' | null") &&
    !sdk.includes('sourceId: number | null'),
  'public API SDK must cover the current profile, product, service, order, ticket and notification APIs'
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
    !balanceAdjustmentExample.includes('/api/admin') &&
    !billingRecordsExample.includes('/api/admin') &&
    !oauthAuthorizationCodeExample.includes('/api/admin') &&
    !serviceTaskExample.includes('/api/api-tokens') &&
    !serviceRenewExample.includes('/api/api-tokens') &&
    !balanceAdjustmentExample.includes('/api/api-tokens') &&
    !billingRecordsExample.includes('/api/api-tokens') &&
    !oauthAuthorizationCodeExample.includes('/api/api-tokens'),
  'public API SDK examples must demonstrate service task polling, service renewal, balance adjustment review requests, billing record reads, and OAuth authorization code exchange without admin or session APIs'
)



assert.ok(
  serverPackage.includes('"test:public-api-sdk-guards"') &&
    rootPackage.includes('pnpm --filter server test:public-api-sdk-guards'),
  'public API SDK guard must be wired into package scripts'
)

console.log('public API SDK guard tests passed')
