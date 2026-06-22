import crypto from 'crypto'
import { assertSafeHttpUrl } from './outbound-security.js'

export interface HeleketConfig {
  apiurl: string
  merchant_uuid: string
  api_key: string
  currency?: string
  lifetimeSeconds: number
}

export interface HeleketInvoiceRequest extends Record<string, unknown> {
  amount: string
  currency: string
  order_id: string
  lifetime?: number
  network?: string
  to_currency?: string
  url_return?: string
  url_success?: string
  url_callback?: string
  additional_data?: string | null
  is_refresh?: boolean
}

export interface HeleketPaymentInfoRequest extends Record<string, unknown> {
  uuid?: string
  order_id?: string
}

export interface HeleketPayment {
  uuid?: string
  order_id?: string
  amount?: string
  payment_amount?: string | null
  payment_amount_usd?: string | null
  payer_amount?: string | null
  payer_currency?: string | null
  merchant_amount?: string | null
  network?: string | null
  address?: string | null
  from?: string | null
  txid?: string | null
  status?: string | null
  payment_status?: string | null
  url?: string | null
  is_final?: boolean
  additional_data?: string | null
  sign?: string
  [key: string]: unknown
}

export interface HeleketPaymentService {
  network: string
  currency: string
  is_available: boolean
  is_enabled: boolean
  limit?: {
    min_amount?: string
    max_amount?: string
  }
  commission?: {
    fee_amount?: string
    percent?: string
  }
}

export interface HeleketStructuredPaymentDetails {
  status: string
  statusDescription: string
  uuid: string | null
  txid: string | null
  payerCurrency: string | null
  network: string | null
  paymentMethodCode: string | null
  paymentAmount: string | null
  paymentAmountUsd: string | null
  merchantAmount: string | null
  address: string | null
  from: string | null
}

interface HeleketApiResponse<T> {
  state: number
  result?: T
  message?: string
  errors?: Record<string, string[]>
}

export interface HeleketClient {
  createInvoice(input: HeleketInvoiceRequest): Promise<HeleketPayment>
  getPaymentInfo(input: HeleketPaymentInfoRequest): Promise<HeleketPayment>
  listServices(): Promise<HeleketPaymentService[]>
  verifyWebhookSignature(payload: Record<string, unknown>): boolean
}

const HELEKET_PAID_STATUSES = new Set(['paid', 'paid_over'])
const HELEKET_PENDING_STATUSES = new Set(['process', 'confirm_check', 'wrong_amount_waiting', 'check'])
const HELEKET_CANCELLED_STATUSES = new Set(['cancel'])
const HELEKET_FAILED_STATUSES = new Set(['wrong_amount', 'fail', 'system_fail', 'refund_process', 'refund_fail', 'refund_paid', 'locked'])
const HELEKET_DEFAULT_LIFETIME_SECONDS = 3600
const HELEKET_MIN_LIFETIME_SECONDS = 300
const HELEKET_MAX_LIFETIME_SECONDS = 43200

export type HeleketPaymentState = 'paid' | 'pending' | 'cancelled' | 'failed'

function normalizeApiUrl(apiurl: string): string {
  const trimmed = apiurl.trim()
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

function parseHeleketLifetimeSeconds(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number.parseInt(value.trim(), 10)
      : NaN

  if (!Number.isFinite(parsed)) {
    return HELEKET_DEFAULT_LIFETIME_SECONDS
  }

  return Math.min(
    HELEKET_MAX_LIFETIME_SECONDS,
    Math.max(HELEKET_MIN_LIFETIME_SECONDS, Math.trunc(parsed))
  )
}

export function buildHeleketConfig(
  config: Record<string, unknown>
): { heleketConfig: HeleketConfig; valid: boolean; error?: string } {
  const heleketConfig: HeleketConfig = {
    apiurl: typeof config.apiurl === 'string' && config.apiurl.trim()
      ? config.apiurl.trim()
      : 'https://api.heleket.com',
    merchant_uuid: typeof config.merchant_uuid === 'string' ? config.merchant_uuid.trim() : '',
    api_key: typeof config.api_key === 'string' ? config.api_key.trim() : '',
    currency: typeof config.currency === 'string' && config.currency.trim()
      ? config.currency.trim().toUpperCase()
      : 'CNY',
    lifetimeSeconds: parseHeleketLifetimeSeconds(config.lifetime ?? config.lifetime_seconds)
  }

  if (!heleketConfig.apiurl || !heleketConfig.merchant_uuid || !heleketConfig.api_key) {
    return {
      heleketConfig,
      valid: false,
      error: '支付渠道配置不完整（Heleket 需要接口地址、商户 UUID 和 API Key）'
    }
  }

  return { heleketConfig, valid: true }
}

export function serializeHeleketPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/\//g, '\\/')
}

export function signHeleketPayload(payload: Record<string, unknown>, apiKey: string): string {
  const serialized = serializeHeleketPayload(payload)
  return crypto.createHash('md5').update(Buffer.from(serialized).toString('base64') + apiKey).digest('hex')
}

export function verifyHeleketWebhookSignature(
  payload: Record<string, unknown>,
  apiKey: string
): boolean {
  const sign = typeof payload.sign === 'string' ? payload.sign : ''
  if (!sign) {
    return false
  }

  const dataWithoutSign = { ...payload }
  delete dataWithoutSign.sign

  const expected = signHeleketPayload(dataWithoutSign, apiKey)
  if (expected.length !== sign.length) {
    return false
  }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sign))
}

export function extractHeleketStatus(payment: HeleketPayment | Record<string, unknown>): string {
  const status = payment.status ?? payment.payment_status
  return typeof status === 'string' ? status : ''
}

export function isHeleketPaidStatus(status: string): boolean {
  return HELEKET_PAID_STATUSES.has(status)
}

export function getHeleketPaymentState(payment: HeleketPayment | Record<string, unknown>): HeleketPaymentState {
  const status = extractHeleketStatus(payment)
  const isFinal = (payment as { is_final?: unknown }).is_final === true

  if (HELEKET_PAID_STATUSES.has(status)) {
    return 'paid'
  }

  if (HELEKET_CANCELLED_STATUSES.has(status)) {
    return 'cancelled'
  }

  if (HELEKET_FAILED_STATUSES.has(status)) {
    return 'failed'
  }

  if (HELEKET_PENDING_STATUSES.has(status)) {
    return 'pending'
  }

  return isFinal ? 'failed' : 'pending'
}

export function getHeleketStatusDescription(status: string): string {
  switch (status) {
    case 'paid':
      return '支付成功，金额与账单一致'
    case 'paid_over':
      return '支付成功，用户超额付款'
    case 'wrong_amount':
      return '支付金额不足'
    case 'process':
      return '支付处理中'
    case 'confirm_check':
      return '链上已发现交易，等待确认数'
    case 'wrong_amount_waiting':
      return '支付金额不足，等待补付'
    case 'check':
      return '等待链上出现交易'
    case 'fail':
      return '支付失败'
    case 'cancel':
      return '支付已取消'
    case 'system_fail':
      return '支付系统异常'
    case 'refund_process':
      return '退款处理中'
    case 'refund_fail':
      return '退款失败'
    case 'refund_paid':
      return '已退款'
    case 'locked':
      return '资金因 AML 风控被锁定'
    default:
      return status || '未知支付状态'
  }
}

export function extractHeleketPaymentDetails(
  payment: HeleketPayment | Record<string, unknown>
): HeleketStructuredPaymentDetails {
  const status = extractHeleketStatus(payment)
  const payerCurrency = typeof payment.payer_currency === 'string' && payment.payer_currency.trim()
    ? payment.payer_currency.trim().toUpperCase()
    : null
  const network = typeof payment.network === 'string' && payment.network.trim()
    ? payment.network.trim().toUpperCase()
    : null

  return {
    status,
    statusDescription: getHeleketStatusDescription(status),
    uuid: typeof payment.uuid === 'string' && payment.uuid.trim() ? payment.uuid.trim() : null,
    txid: typeof payment.txid === 'string' && payment.txid.trim() ? payment.txid.trim() : null,
    payerCurrency,
    network,
    paymentMethodCode: payerCurrency ? (network ? `${payerCurrency}@${network}` : payerCurrency) : null,
    paymentAmount: typeof payment.payment_amount === 'string' && payment.payment_amount.trim() ? payment.payment_amount.trim() : null,
    paymentAmountUsd: typeof payment.payment_amount_usd === 'string' && payment.payment_amount_usd.trim() ? payment.payment_amount_usd.trim() : null,
    merchantAmount: typeof payment.merchant_amount === 'string' && payment.merchant_amount.trim() ? payment.merchant_amount.trim() : null,
    address: typeof payment.address === 'string' && payment.address.trim() ? payment.address.trim() : null,
    from: typeof payment.from === 'string' && payment.from.trim() ? payment.from.trim() : null
  }
}

export function getHeleketInvoiceAmount(payment: HeleketPayment | Record<string, unknown>): number | undefined {
  const invoiceAmount = payment.amount
  if (typeof invoiceAmount === 'string' && invoiceAmount.trim()) {
    const parsed = parseFloat(invoiceAmount)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return undefined
}
function formatHeleketError(data: HeleketApiResponse<unknown>, fallback: string): string {
  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message
  }

  if (data.errors && typeof data.errors === 'object') {
    const firstEntry = Object.values(data.errors)[0]
    if (Array.isArray(firstEntry) && firstEntry[0]) {
      return firstEntry[0]
    }
  }

  return fallback
}

async function heleketRequest<T>(
  config: HeleketConfig,
  path: string,
  payload: Record<string, unknown>
): Promise<T> {
  const body = serializeHeleketPayload(payload)
  const safeBaseUrl = await assertSafeHttpUrl(config.apiurl, 'Heleket API URL')
  const response = await fetch(`${normalizeApiUrl(safeBaseUrl.toString())}${path}`, {
    method: 'POST',
    headers: {
      merchant: config.merchant_uuid,
      sign: signHeleketPayload(payload, config.api_key),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body,
    signal: AbortSignal.timeout(15000),
    redirect: 'manual'
  })

  let data: HeleketApiResponse<T>
  try {
    data = await response.json() as HeleketApiResponse<T>
  } catch {
    throw new Error(`Heleket 返回了无法解析的响应（HTTP ${response.status}）`)
  }

  if (!response.ok || data.state !== 0 || data.result === undefined) {
    throw new Error(formatHeleketError(data, `Heleket 请求失败（HTTP ${response.status}）`))
  }

  return data.result
}

export function createHeleketClient(config: HeleketConfig): HeleketClient {
  return {
    async createInvoice(input) {
      return heleketRequest<HeleketPayment>(config, '/v1/payment', input)
    },

    async getPaymentInfo(input) {
      return heleketRequest<HeleketPayment>(config, '/v1/payment/info', input)
    },

    async listServices() {
      return heleketRequest<HeleketPaymentService[]>(config, '/v1/payment/services', {})
    },

    verifyWebhookSignature(payload) {
      return verifyHeleketWebhookSignature(payload, config.api_key)
    }
  }
}
