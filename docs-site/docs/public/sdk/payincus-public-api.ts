export type PayIncusPublicApiSort = 'createdAt' | '-createdAt' | 'updatedAt' | '-updatedAt' | 'displayOrder' | '-displayOrder'
export type PayIncusPublicApiScope =
  | 'profile:read'
  | 'profile:write'
  | 'balance:read'
  | 'balance:write'
  | 'billing:read'
  | 'products:read'
  | 'services:read'
  | 'services:operate'
  | 'services:billing'
  | 'orders:read'
  | 'tickets:read'
  | 'tickets:write'
  | 'notifications:read'
  | 'notifications:send'

export interface PayIncusPublicApiErrorBody {
  code?: string
  message?: string
  error?: string
  details?: unknown
  retryAfter?: number
}

export interface PayIncusPublicApiScopeMetadata {
  scope: PayIncusPublicApiScope
  title: string
  description: string
  risk: 'low' | 'medium' | 'high'
  access: 'read' | 'write' | 'operate'
  resources: string[]
  implemented: boolean
  notes?: string
}

export interface PayIncusListOptions {
  page?: number
  pageSize?: number
  sort?: PayIncusPublicApiSort
}

export interface PayIncusListMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
  sort?: string
}

export interface PayIncusListResponse<T> {
  data: T[]
  meta: PayIncusListMeta
}

export interface PayIncusResponse<T> {
  data: T
}

export class PayIncusPublicApiError extends Error {
  status: number
  code?: string
  details?: unknown
  retryAfter?: number

  constructor(status: number, body: PayIncusPublicApiErrorBody | null, fallback: string) {
    super(body?.message || body?.error || fallback)
    this.name = 'PayIncusPublicApiError'
    this.status = status
    this.code = body?.code
    this.details = body?.details
    this.retryAfter = body?.retryAfter
  }
}

export interface PayIncusProfile {
  id: number
  username: string
  email?: string
  role: string
  status: string
  avatarStyle?: string
}

export interface PayIncusBalance {
  balance: string
  currency?: string
}

export interface PayIncusBalanceLog {
  id: number
  type: string
  amount: string
  createdAt: string
  description?: string
}

export interface PayIncusBalanceLogOptions extends PayIncusListOptions {
  type?: string
  lotteryGift?: boolean
}

export interface PayIncusBalanceAdjustmentRequest {
  id: number
  amount: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export interface PayIncusBalanceAdjustmentRequestListOptions extends PayIncusListOptions {
  status?: 'pending' | 'approved' | 'rejected'
}

export interface PayIncusCreateBalanceAdjustmentRequestInput {
  amount: number | string
  reason: string
  externalReference?: string
}

export interface PayIncusBillingRecord {
  id: number
  serviceId?: number
  type: string
  amount: string
  status: string
  createdAt: string
}

export interface PayIncusBillingRecordListOptions extends PayIncusListOptions {
  type?: string
  serviceId?: number
}

export interface PayIncusProduct {
  id: number
  name: string
  description?: string
  plans?: unknown[]
}

export type PayIncusServiceStatus = 'running' | 'stopped' | 'suspended' | 'pending' | 'failed'
export type PayIncusServiceInclude = 'product' | 'plan'

export interface PayIncusServiceIncludeOptions {
  include?: PayIncusServiceInclude | PayIncusServiceInclude[]
}

export interface PayIncusServiceListOptions extends PayIncusListOptions, PayIncusServiceIncludeOptions {
  status?: PayIncusServiceStatus | string
}

export interface PayIncusServiceIncluded {
  product?: PayIncusProduct
  plan?: unknown
}

export interface PayIncusService {
  id: number
  name: string
  status: PayIncusServiceStatus | string
  expiresAt?: string
  included?: PayIncusServiceIncluded
}

export type PayIncusServiceListResponse = PayIncusListResponse<PayIncusService>
export type PayIncusServiceResponse = PayIncusResponse<PayIncusService>
export type PayIncusServiceAction = 'start' | 'stop' | 'restart'

export interface PayIncusServiceTask {
  id: number
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  progress?: number
  error?: string
}

export interface PayIncusServiceActionResult {
  task: PayIncusServiceTask
}

export interface PayIncusServiceRenewResult {
  service: PayIncusService
  billingRecord?: PayIncusBillingRecord
}

export interface PayIncusOrderListOptions extends PayIncusListOptions {
  status?: string
}

export interface PayIncusOrder {
  id: string
  type: string
  status: string
  amount: string
  createdAt: string
}

export interface PayIncusTicketAttachment {
  id?: number
  name: string
  url?: string
  size?: number
  mimeType?: string
}

export interface PayIncusTicketImageAttachment {
  blob: Blob
  filename: string
}

export interface PayIncusTicketListOptions extends PayIncusListOptions {
  status?: string
  category?: string
  priority?: string
}

export interface PayIncusCreateTicketInput {
  subject: string
  category?: string
  priority?: string
  content: string
  attachments?: PayIncusTicketImageAttachment[]
}

export interface PayIncusCreateTicketReplyInput {
  content: string
  attachments?: PayIncusTicketImageAttachment[]
}

export interface PayIncusTicket {
  id: number
  subject: string
  status: string
  messages?: unknown[]
  attachments?: PayIncusTicketAttachment[]
}

export type PayIncusTicketStatusAction = 'close' | 'reopen'
export interface PayIncusTicketStatusResult {
  id: number
  status: string
}

export interface PayIncusNotificationListOptions extends PayIncusListOptions {
  isRead?: boolean
}

export type PayIncusNotificationTemplateId = 'service_action_update' | 'billing_notice'

export interface PayIncusNotificationInput {
  title?: string
  message?: string
  template: PayIncusNotificationTemplateId | null
  variables?: Record<string, string | number | boolean>
  source?: string
}

export interface PayIncusPublicApiClientOptions {
  baseUrl: string
  token: string
}

export class PayIncusPublicApiClient {
  private baseUrl: string
  private token: string

  constructor(options: PayIncusPublicApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
  }

  private query(options: Record<string, unknown> = {}): string {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(options)) {
      if (value === undefined || value === null) continue
      params.set(key, Array.isArray(value) ? value.join(',') : String(value))
    }
    const text = params.toString()
    return text ? `?${text}` : ''
  }

  private parsePayload(text: string): unknown {
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return { error: text }
    }
  }

  private errorBody(payload: unknown): PayIncusPublicApiErrorBody | null {
    if (!payload || typeof payload !== 'object') return null
    return payload as PayIncusPublicApiErrorBody
  }

  private ticketFormData(input: PayIncusCreateTicketInput | PayIncusCreateTicketReplyInput): FormData {
    const form = new FormData()
    form.append('content', input.content)
    if ('subject' in input) form.append('subject', input.subject)
    if ('category' in input && input.category) form.append('category', input.category)
    if ('priority' in input && input.priority) form.append('priority', input.priority)
    for (const attachment of input.attachments || []) {
      const { blob, filename } = attachment
      form.append('images', blob, filename)
    }
    return form
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
    const headers = {
      Authorization: `Bearer ${this.token}`,
      ...(options.body === undefined || isFormData ? {} : { 'Content-Type': 'application/json' })
    }
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : isFormData ? options.body as BodyInit : JSON.stringify(options.body)
    })
    const payload = await this.parsePayload(await response.text())
    if (!response.ok) {
      const errorBody = this.errorBody(payload)
      throw new PayIncusPublicApiError(response.status, errorBody, errorBody?.details ?? payload ? String(errorBody?.details ?? 'Request failed') : 'Request failed')
    }
    return payload as T
  }

  private async oauthProviderRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/oauth-provider${path}`, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined
    })
    const payload = await this.parsePayload(await response.text())
    if (!response.ok) throw new PayIncusPublicApiError(response.status, this.errorBody(payload), 'OAuth provider request failed')
    return payload as T
  }

  listOAuthScopes() {
    return this.oauthProviderRequest('/scopes') as Promise<PayIncusResponse<PayIncusPublicApiScopeMetadata[]>>
  }

  getProfile() {
    return this.request<PayIncusResponse<PayIncusProfile>>('/me')
  }

  updateProfile(input: { avatarStyle: string }) {
    return this.request('/me', { method: 'PATCH', body: input }) as Promise<PayIncusResponse<PayIncusProfile>>
  }

  getBalance() {
    return this.request<PayIncusResponse<PayIncusBalance>>('/balance')
  }

  listBalanceLogs(options: PayIncusBalanceLogOptions = {}) {
    return this.request<PayIncusListResponse<PayIncusBalanceLog>>(`/balance/logs${this.query(options)}`)
  }

  listBalanceAdjustmentRequests(options: PayIncusBalanceAdjustmentRequestListOptions = {}) {
    return this.request(`/balance/adjustment-requests${this.query(options)}`) as Promise<PayIncusListResponse<PayIncusBalanceAdjustmentRequest>>
  }

  createBalanceAdjustmentRequest(input: PayIncusCreateBalanceAdjustmentRequestInput) {
    return this.request('/balance/adjustment-requests', { method: 'POST', body: input }) as Promise<PayIncusResponse<PayIncusBalanceAdjustmentRequest>>
  }

  listBillingRecords(options: PayIncusBillingRecordListOptions = {}) {
    return this.request(`/billing-records${this.query(options)}`) as Promise<PayIncusListResponse<PayIncusBillingRecord>>
  }

  getBillingRecord(id: number) {
    return this.request(`/billing-records/${id}`) as Promise<PayIncusResponse<PayIncusBillingRecord>>
  }

  listProducts(options: PayIncusListOptions = {}) {
    return this.request<PayIncusListResponse<PayIncusProduct>>(`/products${this.query(options)}`)
  }

  getProduct(id: number) {
    return this.request<PayIncusResponse<PayIncusProduct>>(`/products/${id}`)
  }

  listServices(options: PayIncusServiceListOptions = {}) {
    return this.request<PayIncusServiceListResponse>(`/services${this.query(options)}`)
  }

  getService(id: number, options: PayIncusServiceIncludeOptions = {}) {
    return this.request<PayIncusServiceResponse>(`/services/${id}${this.query(options)}`)
  }

  queueServiceAction(id: number, action: PayIncusServiceAction) {
    return this.request(`/services/${id}/actions`, { method: 'POST', body: { action } }) as Promise<PayIncusResponse<PayIncusServiceActionResult>>
  }

  getServiceTask(id: number, taskId: number) {
    return this.request(`/services/${id}/tasks/${taskId}`) as Promise<PayIncusResponse<PayIncusServiceTask>>
  }

  cancelServiceTask(id: number, taskId: number) {
    return this.request(`/services/${id}/tasks/${taskId}`, { method: 'DELETE' }) as Promise<PayIncusResponse<PayIncusServiceTask>>
  }

  renewService(id: number, months: number) {
    return this.request(`/services/${id}/renew`, { method: 'POST', body: { months } }) as Promise<PayIncusResponse<PayIncusServiceRenewResult>>
  }

  listOrders(options: PayIncusOrderListOptions = {}) {
    return this.request<PayIncusListResponse<PayIncusOrder>>(`/orders${this.query(options)}`)
  }

  getOrder(id: string) {
    return this.request(`/orders/${encodeURIComponent(id)}`) as Promise<PayIncusResponse<PayIncusOrder>>
  }

  listTickets(options: PayIncusTicketListOptions = {}) {
    return this.request<PayIncusListResponse<PayIncusTicket>>(`/tickets${this.query(options)}`)
  }

  createTicket(input: PayIncusCreateTicketInput) {
    const attachments = input.attachments
    return this.request('/tickets', {
      method: 'POST',
      body: attachments?.length ? this.ticketFormData(input) : input
    }) as Promise<PayIncusResponse<PayIncusTicket>>
  }

  getTicket(id: number) {
    return this.request<PayIncusResponse<PayIncusTicket>>(`/tickets/${id}`)
  }

  replyToTicket(id: number, input: string | PayIncusCreateTicketReplyInput) {
    const payload = typeof input === 'string' ? { content: input } : input
    const attachments = payload.attachments
    return this.request<PayIncusResponse<PayIncusTicket>>(`/tickets/${id}/replies`, {
      method: 'POST',
      body: attachments?.length ? this.ticketFormData(payload) : payload
    })
  }

  updateTicketStatus(id: number, action: PayIncusTicketStatusAction) {
    return this.request(`/tickets/${id}/status`, { method: 'PATCH', body: { action } }) as Promise<PayIncusResponse<PayIncusTicketStatusResult>>
  }

  listNotifications(options: PayIncusNotificationListOptions = {}) {
    return this.request<PayIncusListResponse<unknown>>(`/notifications${this.query(options)}`)
  }

  getUnreadNotificationCount() {
    return this.request<PayIncusResponse<{ count: number }>>('/notifications/unread-count')
  }

  sendNotification(input: PayIncusNotificationInput) {
    return this.request('/notifications', { method: 'POST', body: input }) as Promise<PayIncusResponse<unknown>>
  }

}
