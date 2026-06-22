/**
 * 充值相关路由
 */

import { FastifyInstance } from 'fastify'
import type { RechargeStatus } from '@prisma/client'
import * as db from '../db/index.js'
import * as crypto from 'crypto'
import { isIP } from 'net'
import { createEpayClient, type EpayConfig, type EpayConfigV1, type EpayConfigV2, type CallbackData, type EpayVersion, type VerifyResult } from '../lib/epay.js'
import {
  buildHeleketConfig,
  createHeleketClient,
  extractHeleketStatus,
  getHeleketInvoiceAmount,
  getHeleketPaymentState,
  getHeleketStatusDescription
} from '../lib/heleket.js'
import {
  buildHeleketInvoicePaymentDetails,
  extractRechargePaymentDisplayInfo,
  getRechargePayableAmount,
  mergeHeleketPaymentDetails,
  mergeRechargeAmountDetails,
  readRechargePaymentDetails
} from '../lib/recharge-payment-details.js'
import {
  buildRechargeProviderConfigSnapshot,
  resolveRechargeProviderConfigSnapshot
} from '../lib/recharge-provider-snapshot.js'
import { createLog } from '../db/logs.js'
import { prisma } from '../db/prisma.js'
import { createInboxMessage } from '../db/inbox.js'
import { sendRechargeSuccessEmail } from '../lib/mailer.js'
import { sanitizeObject } from '../lib/log-sanitizer.js'
import { isRechargeGatewayOrderNoMatch } from '../lib/recharge-order-guard.js'
import { assertSafeHttpUrl, isIpPrivateOrReserved } from '../lib/outbound-security.js'

// 金额一致性检查容差（分）
const AMOUNT_TOLERANCE_CENTS = 1
const SUPPORTED_RECHARGE_PROVIDER_TYPES = new Set(['yipay', 'heleket'])
const HELEKET_CALLBACK_IPS = ['31.133.220.8']
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/
const RECHARGE_STATUSES = new Set(['pending', 'paid', 'completed', 'failed', 'cancelled', 'refunded'])
const MAX_RECHARGE_TRADE_NO_LENGTH = 128
const MAX_RECHARGE_ADMIN_REASON_LENGTH = 500

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }

  if (typeof value !== 'string' || !POSITIVE_ID_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveJsonMoney(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return value
}

function parseOptionalPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }

  const parsed = parsePositiveId(value)
  return parsed ?? fallback
}

function parseOptionalRechargeStatus(value: string | undefined): RechargeStatus | undefined {
  if (!value || !RECHARGE_STATUSES.has(value)) {
    return undefined
  }

  return value as RechargeStatus
}

function normalizeOptionalTrimmedString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed.length <= maxLength ? trimmed : null
}

function normalizePaymentCallbackPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function isRechargeProviderTypeSupported(type: string): boolean {
  return SUPPORTED_RECHARGE_PROVIDER_TYPES.has(type)
}

function getUnsupportedProviderError(type: string): string {
  return `支付渠道类型 ${type} 当前未实现安全的充值流程，暂不支持启用`
}

/**
 * 检查回调是否已处理（数据库持久化防重放）
 * 注意：tradeNo 参数应该是已经处理过的版本（通过 getTradeNoForIndex 处理）
 */
async function isCallbackProcessed(providerId: number, orderNo: string, tradeNo: string): Promise<boolean> {
  try {
    const existing = await prisma.paymentCallback.findUnique({
      where: {
        providerId_orderNo_tradeNo: {
          providerId,
          orderNo,
          tradeNo
        }
      }
    })
    return !!existing
  } catch {
    return false
  }
}

/**
 * 生成唯一的 tradeNo 标识（用于联合索引）
 * 当 tradeNo 为空时，使用基于订单号的确定性标识，确保重复回调能命中同一唯一索引
 */
function getTradeNoForIndex(orderNo: string, tradeNo: string | null | undefined): string {
  if (tradeNo && tradeNo.trim()) {
    return tradeNo.trim()
  }
  return `__NO_TRADE_NO__${orderNo}`
}

/**
 * 记录回调已处理（数据库持久化防重放）
 */
async function markCallbackProcessed(providerId: number, orderNo: string, tradeNo: string | null, ip: string | null): Promise<void> {
  try {
    await prisma.paymentCallback.create({
      data: {
        providerId,
        orderNo,
        tradeNo: getTradeNoForIndex(orderNo, tradeNo),
        callbackIp: ip,
        processed: true
      }
    })
  } catch {
    // 忽略唯一索引冲突（并发情况）
  }
}

function normalizeCallbackIp(ip: string | null | undefined): string {
  const value = (ip || '').trim()
  if (!value) {
    return ''
  }

  if (value.startsWith('::ffff:')) {
    return value.slice(7)
  }

  return value
}

function parseConfiguredCallbackIps(): string[] {
  const configured = process.env.PAYMENT_CALLBACK_IP_WHITELIST?.trim()
  if (!configured) {
    return []
  }

  return configured
    .split(',')
    .map(ip => normalizeCallbackIp(ip))
    .filter(Boolean)
}

function getProviderCallbackIpWhitelist(providerType: string): string[] {
  const configured = parseConfiguredCallbackIps()
  if (configured.length > 0) {
    return configured
  }

  if (providerType === 'heleket') {
    return HELEKET_CALLBACK_IPS
  }

  return []
}

/**
 * 验证 IP 是否在白名单内
 */
function isIpInWhitelist(ip: string, providerType: string): boolean {
  if (process.env.PAYMENT_CALLBACK_SKIP_IP_WHITELIST === 'true') {
    return true
  }

  const whitelist = getProviderCallbackIpWhitelist(providerType)
  if (whitelist.length === 0) {
    return true
  }

  const normalizedIp = normalizeCallbackIp(ip)
  return whitelist.includes(normalizedIp)
}

/**
 * 根据配置构建易支付客户端配置
 */
function buildEpayConfig(config: Record<string, unknown>): { epayConfig: EpayConfig; valid: boolean; error?: string } {
  const version = (config.version as EpayVersion) || 'v2'
  
  if (version === 'v1') {
    // V1 版本：MD5 签名
    const v1Config: EpayConfigV1 = {
      version: 'v1',
      apiurl: config.apiurl as string || '',
      pid: config.pid as string || '',
      key: config.key as string || ''
    }
    
    if (!v1Config.apiurl || !v1Config.pid || !v1Config.key) {
      return { epayConfig: v1Config, valid: false, error: '支付渠道配置不完整（V1版本需要接口地址、商户ID、密钥）' }
    }
    
    return { epayConfig: v1Config, valid: true }
  } else {
    // V2 版本：RSA 签名
    const v2Config: EpayConfigV2 = {
      version: 'v2',
      apiurl: config.apiurl as string || '',
      pid: config.pid as string || '',
      platform_public_key: config.platform_public_key as string || '',
      merchant_private_key: config.merchant_private_key as string || ''
    }
    
    if (!v2Config.apiurl || !v2Config.pid || !v2Config.platform_public_key || !v2Config.merchant_private_key) {
      return { epayConfig: v2Config, valid: false, error: '支付渠道配置不完整（V2版本需要接口地址、商户ID、平台公钥、商户私钥）' }
    }
    
    return { epayConfig: v2Config, valid: true }
  }
}

function getProviderMethods(methods: unknown): string[] {
  if (!Array.isArray(methods)) {
    return []
  }

  return methods.filter((method): method is string => typeof method === 'string' && method.trim().length > 0)
}

function resolveRechargePaymentMethod(
  providerType: string,
  methods: string[],
  requestedMethod?: string | null
): string | undefined {
  const normalizedRequested = requestedMethod?.trim()

  if (providerType === 'yipay') {
    const availableMethods = methods.length > 0 ? methods : ['alipay']
    if (normalizedRequested && availableMethods.includes(normalizedRequested)) {
      return normalizedRequested
    }
    return availableMethods[0]
  }

  if (providerType === 'heleket') {
    return normalizedRequested || undefined
  }

  return normalizedRequested || undefined
}

function normalizePublicBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')

  if (
    !normalizedHost ||
    normalizedHost === 'localhost' ||
    normalizedHost.endsWith('.localhost') ||
    normalizedHost.endsWith('.local') ||
    normalizedHost.endsWith('.internal')
  ) {
    return true
  }

  if (isIP(normalizedHost) !== 0 && isIpPrivateOrReserved(normalizedHost)) {
    return true
  }

  return !normalizedHost.includes('.')
}

function validatePublicBaseUrl(url: string, configName: string): string {
  const normalized = normalizePublicBaseUrl(url)
  let parsed: URL

  try {
    parsed = new URL(normalized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('invalid protocol')
    }
  } catch {
    throw new Error(`${configName} must be a valid http(s) URL`)
  }

  if (process.env.NODE_ENV === 'production') {
    if (parsed.protocol !== 'https:') {
      throw new Error(`${configName} must use HTTPS in production`)
    }

    if (isLocalOrPrivateHostname(parsed.hostname)) {
      throw new Error(`${configName} must use a public frontend hostname in production`)
    }
  }

  return normalized
}

function getRechargeFrontendUrl(): string {
  const configuredUrl = process.env.FRONTEND_URL?.split(',')[0]?.trim()
  const frontendUrl = configuredUrl || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')

  if (!frontendUrl) {
    throw new Error('FRONTEND_URL must be configured in production before creating recharge orders')
  }

  return validatePublicBaseUrl(frontendUrl, 'FRONTEND_URL')
}

function getRechargeCallbackBaseUrl(): string {
  const callbackUrl = process.env.PAYMENT_CALLBACK_BASE_URL?.trim()
  if (callbackUrl) {
    return validatePublicBaseUrl(callbackUrl, 'PAYMENT_CALLBACK_BASE_URL')
  }

  return getRechargeFrontendUrl()
}

function getRechargeOrderExpiryAt(providerType: string, config: Record<string, unknown>): Date {
  if (providerType === 'heleket') {
    const { heleketConfig } = buildHeleketConfig(config)
    return new Date(Date.now() + heleketConfig.lifetimeSeconds * 1000)
  }

  return new Date(Date.now() + 30 * 60 * 1000)
}

function getHeleketStatusMessage(status: string): string {
  return getHeleketStatusDescription(status)
}

function resolveRechargeProviderConfig(
  providerType: string,
  currentConfig: Record<string, unknown>,
  snapshotValue: unknown
): { config: Record<string, unknown>; source: 'snapshot' | 'provider' } {
  return resolveRechargeProviderConfigSnapshot(providerType, currentConfig, snapshotValue)
}

function buildRechargeRecordView(record: {
  id?: number
  orderNo: string
  amount: unknown
  actualAmount?: unknown
  fee?: unknown
  status: string
  provider?: { id: number; name: string; type: string } | null
  paymentMethod?: string | null
  paymentDetails?: unknown
  tradeNo?: string | null
  failReason?: string | null
  createdAt: Date
  expiredAt?: Date | null
  completedAt?: Date | null
}) {
  const paymentInfo = extractRechargePaymentDisplayInfo(record.paymentDetails)
  const paymentDetails = readRechargePaymentDetails(record.paymentDetails)
  const amount = Number(record.amount)
  const actualAmount = record.actualAmount !== undefined && record.actualAmount !== null
    ? Number(record.actualAmount)
    : null
  const fee = record.fee !== undefined && record.fee !== null ? Number(record.fee) : 0
  const payableAmount = paymentDetails.recharge?.payableAmount !== undefined && paymentDetails.recharge.payableAmount !== null
    ? Number(paymentDetails.recharge.payableAmount)
    : amount

  return {
    id: record.id,
    orderNo: record.orderNo,
    amount,
    payableAmount,
    actualAmount,
    fee,
    status: record.status,
    provider: record.provider ? {
      id: record.provider.id,
      name: record.provider.name,
      type: record.provider.type
    } : null,
    paymentMethod: record.paymentMethod || null,
    actualPaymentMethod: paymentInfo.actualPaymentMethod,
    paymentCurrency: paymentInfo.paymentCurrency,
    paymentNetwork: paymentInfo.paymentNetwork,
    paymentUuid: paymentInfo.paymentUuid,
    paymentTxid: paymentInfo.paymentTxid,
    invoiceCurrency: paymentInfo.invoiceCurrency,
    gatewayStatus: paymentInfo.gatewayStatus,
    gatewayStatusDescription: paymentInfo.gatewayStatusDescription,
    tradeNo: record.tradeNo || null,
    failReason: record.failReason || null,
    createdAt: record.createdAt.toISOString(),
    expiredAt: record.expiredAt?.toISOString() || null,
    completedAt: record.completedAt?.toISOString() || null
  }
}

function extractRechargeOrderNoFromCallback(
  providerType: string,
  callbackData: Record<string, unknown>
): string | undefined {
  switch (providerType) {
    case 'yipay':
    case 'alipay_direct':
    case 'wechat_direct':
      return typeof callbackData.out_trade_no === 'string' ? callbackData.out_trade_no : undefined
    case 'heleket':
      return typeof callbackData.order_id === 'string' ? callbackData.order_id : undefined
    case 'stripe': {
      const data = callbackData.data as { object?: { metadata?: { orderNo?: string } } } | undefined
      return data?.object?.metadata?.orderNo
    }
    default:
      return (callbackData.orderNo || callbackData.order_no || callbackData.out_trade_no) as string | undefined
  }
}

function buildRechargeUrls(providerId: number, orderNo: string): {
  notifyUrl: string
  returnUrl: string
  successUrl: string
} {
  const frontendUrl = getRechargeFrontendUrl()
  const callbackBaseUrl = getRechargeCallbackBaseUrl()

  return {
    notifyUrl: `${callbackBaseUrl}/api/recharge/callback/${providerId}`,
    returnUrl: `${frontendUrl}/wallet`,
    successUrl: `${frontendUrl}/wallet?recharge=success&out_trade_no=${encodeURIComponent(orderNo)}`
  }
}

async function createRechargePayUrl(
  provider: { id: number; type: string; methods: unknown },
  config: Record<string, unknown>,
  orderNo: string,
  amount: number,
  paymentMethod: string | undefined,
  urls: { notifyUrl: string; returnUrl: string; successUrl: string }
): Promise<string | null> {
  if (provider.type === 'yipay') {
    const { epayConfig, valid, error } = buildEpayConfig(config)
    if (!valid) {
      throw new Error(error || '支付渠道配置不完整')
    }

    const safeApiUrl = await assertSafeHttpUrl(epayConfig.apiurl, 'Epay API URL')
    const safeEpayConfig = {
      ...epayConfig,
      apiurl: safeApiUrl.toString().replace(/\/+$/, '')
    } as EpayConfig
    const epay = createEpayClient(safeEpayConfig)
    return epay.getPayLink({
      type: paymentMethod || 'alipay',
      out_trade_no: orderNo,
      name: '账户充值',
      money: amount.toFixed(2),
      notify_url: urls.notifyUrl,
      return_url: urls.successUrl
    })
  }

  if (provider.type === 'heleket') {
    const { heleketConfig, valid, error } = buildHeleketConfig(config)
    if (!valid) {
      throw new Error(error || '支付渠道配置不完整')
    }

    const heleket = createHeleketClient(heleketConfig)
    const invoice = await heleket.createInvoice({
      amount: amount.toFixed(2),
      currency: heleketConfig.currency || 'CNY',
      lifetime: heleketConfig.lifetimeSeconds,
      order_id: orderNo,
      url_return: urls.returnUrl,
      url_success: urls.successUrl,
      url_callback: urls.notifyUrl
    })

    return typeof invoice.url === 'string' && invoice.url.trim() ? invoice.url : null
  }

  return null
}

function validateActiveRechargeProvider(
  provider: { type: string; config: Record<string, unknown> }
): { valid: boolean; error?: string } {
  if (!isRechargeProviderTypeSupported(provider.type)) {
    return { valid: false, error: getUnsupportedProviderError(provider.type) }
  }

  if (provider.type === 'yipay') {
    const { valid, error } = buildEpayConfig(provider.config)
    return { valid, error }
  }

  if (provider.type === 'heleket') {
    const { valid, error } = buildHeleketConfig(provider.config)
    return { valid, error }
  }

  return { valid: false, error: getUnsupportedProviderError(provider.type) }
}

async function validatePaymentProviderApiUrl(
  providerType: string,
  config: Record<string, unknown>
): Promise<{ valid: boolean; error?: string; config: Record<string, unknown> }> {
  if (providerType !== 'yipay' && providerType !== 'heleket') {
    return { valid: true, config }
  }

  if (typeof config.apiurl !== 'string' || !config.apiurl.trim()) {
    return { valid: true, config }
  }

  try {
    const safeApiUrl = await assertSafeHttpUrl(
      config.apiurl,
      providerType === 'heleket' ? 'Heleket API URL' : 'Epay API URL'
    )
    return {
      valid: true,
      config: {
        ...config,
        apiurl: safeApiUrl.toString().replace(/\/+$/, '')
      }
    }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : '支付渠道接口地址不合法',
      config
    }
  }
}

async function validatePaymentProviderAdminInput(
  providerType: string,
  config: Record<string, unknown>,
  status: 'active' | 'disabled' | 'testing'
): Promise<{ valid: boolean; error?: string; config: Record<string, unknown> }> {
  const apiUrlValidation = await validatePaymentProviderApiUrl(providerType, config)
  if (!apiUrlValidation.valid) {
    return apiUrlValidation
  }
  const normalizedConfig = apiUrlValidation.config

  if (providerType === 'yipay') {
    const methodFeesValidation = validateYipayMethodFees(normalizedConfig)
    if (!methodFeesValidation.valid) {
      return { ...methodFeesValidation, config: normalizedConfig }
    }
  }

  if (providerType === 'yipay') {
    const { valid, error } = buildEpayConfig(normalizedConfig)
    if (!valid) {
      return { valid: false, error, config: normalizedConfig }
    }
  }

  if (providerType === 'heleket') {
    const { valid, error } = buildHeleketConfig(normalizedConfig)
    if (!valid) {
      return { valid: false, error, config: normalizedConfig }
    }
  }

  if (status === 'active') {
    const activeValidation = validateActiveRechargeProvider({ type: providerType, config: normalizedConfig })
    return { ...activeValidation, config: normalizedConfig }
  }

  return { valid: true, config: normalizedConfig }
}

function validateYipayMethodFees(config: Record<string, unknown>): { valid: boolean; error?: string } {
  const rawMethodFees = config.methodFees
  if (rawMethodFees === undefined || rawMethodFees === null) {
    return { valid: true }
  }

  if (typeof rawMethodFees !== 'object' || Array.isArray(rawMethodFees)) {
    return { valid: false, error: '支付方式手续费配置不合法' }
  }

  for (const [method, feeConfig] of Object.entries(rawMethodFees as Record<string, unknown>)) {
    if (!method.trim()) {
      return { valid: false, error: '支付方式手续费配置不合法' }
    }

    if (!feeConfig || typeof feeConfig !== 'object' || Array.isArray(feeConfig)) {
      return { valid: false, error: '支付方式手续费配置不合法' }
    }

    const entry = feeConfig as Record<string, unknown>
    const feeRate = Number(entry.feeRate ?? 0)
    const feeFixed = Number(entry.feeFixed ?? 0)
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) {
      return { valid: false, error: '支付方式手续费费率需在 0% 到 100% 之间' }
    }
    if (!Number.isFinite(feeFixed) || feeFixed < 0) {
      return { valid: false, error: '支付方式固定手续费不能为负数' }
    }
  }

  return { valid: true }
}

/**
 * 验证支付回调签名
 * @param provider 支付渠道
 * @param data 回调数据
 * @param signature 签名
 */
function verifyCallbackSignature(
  provider: { type: string; config: Record<string, unknown> },
  data: Record<string, unknown>,
  signature: string
): boolean {
  // 易支付签名验证（支持 V1 和 V2）
  if (provider.type === 'yipay') {
    const { epayConfig, valid } = buildEpayConfig(provider.config)
    if (!valid) {
      return false
    }
    
    const epay = createEpayClient(epayConfig)
    return epay.verify(data as CallbackData)
  }

  if (provider.type === 'heleket') {
    const { heleketConfig, valid } = buildHeleketConfig(provider.config)
    if (!valid) {
      return false
    }

    const heleket = createHeleketClient(heleketConfig)
    return heleket.verifyWebhookSignature(data)
  }

  const signKey = provider.config?.signKey as string
  if (!signKey) {
    return false
  }

  // 根据不同支付渠道实现不同的签名验证算法
  switch (provider.type) {
    case 'alipay_direct': {
      return false
    }
    case 'wechat_direct': {
      // 微信支付: HMAC-SHA256 签名验证
      const sortedKeys = Object.keys(data).filter(k => k !== 'sign').sort()
      const signStr = sortedKeys.map(k => `${k}=${data[k]}`).join('&') + `&key=${signKey}`
      const computedSign = crypto.createHash('md5').update(signStr).digest('hex').toUpperCase()
      return computedSign === signature.toUpperCase()
    }
    case 'stripe': {
      return false
    }
    default: {
      // 通用 MD5 签名验证
      const sortedKeys = Object.keys(data).filter(k => k !== 'sign').sort()
      const signStr = sortedKeys.map(k => `${k}=${data[k]}`).join('&') + signKey
      const computedSign = crypto.createHash('md5').update(signStr).digest('hex')
      return computedSign.toLowerCase() === signature.toLowerCase()
    }
  }
}

// ==================== 用户接口 ====================

export default async function rechargeRoutes(app: FastifyInstance): Promise<void> {
  // 获取可用支付渠道列表
  app.get('/api/recharge/providers', {
    onRequest: [app.authenticate]
  }, async (request, reply) => {
    try {
      if (await db.getSystemConfigBoolean('free_site_mode', false)) {
        return { providers: [] }
      }

      const providers = (await db.getActivePaymentProviders()).filter(provider => {
        const config = typeof provider.config === 'string'
          ? JSON.parse(provider.config)
          : (provider.config || {}) as Record<string, unknown>
        const validation = validateActiveRechargeProvider({ type: provider.type, config })
        if (!validation.valid) {
          request.log.warn({ providerId: provider.id, type: provider.type, error: validation.error }, '忽略未安全启用的支付渠道')
        }
        return validation.valid
      })
      
      // 只返回用户需要的信息，隐藏敏感配置
      const safeProviders = providers.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        methods: p.methods,
        methodFees: db.getPaymentMethodFeeMap(p),
        minAmount: Number(p.minAmount),
        maxAmount: p.maxAmount ? Number(p.maxAmount) : null,
        feeRate: Number(p.feeRate),
        feeFixed: Number(p.feeFixed)
      }))
      
      return { providers: safeProviders }
    } catch (error) {
      request.log.error(error, '获取支付渠道列表失败')
      return reply.status(500).send({ error: '获取支付渠道列表失败' })
    }
  })

  // 创建充值订单
  app.post('/api/recharge/orders', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      if (await db.getSystemConfigBoolean('free_site_mode', false)) {
        return reply.status(403).send({ error: '白嫖站已启用，充值功能不可用' })
      }

      const user = request.user!
      const { providerId, amount, paymentMethod } = request.body as {
        providerId: unknown
        amount: unknown
        paymentMethod?: string  // 支付方式：alipay, wxpay 等
      }

      const providerIdNum = parsePositiveId(providerId)
      const rechargeAmount = parsePositiveJsonMoney(amount)

      // 参数验证
      if (!providerIdNum || amount === undefined) {
        return reply.status(400).send({ error: '参数不完整' })
      }

      if (rechargeAmount === null) {
        return reply.status(400).send({ error: '充值金额无效' })
      }

      // 规范化金额为两位小数（避免浮点数精度问题）
      const normalizedAmount = Math.round(rechargeAmount * 100) / 100
      if (normalizedAmount <= 0) {
        return reply.status(400).send({ error: '充值金额无效' })
      }

      // 获取支付渠道
      const provider = await db.getPaymentProviderById(providerIdNum)
      if (!provider || provider.status !== 'active') {
        return reply.status(400).send({ error: '支付渠道不可用' })
      }

      const providerConfig = typeof provider.config === 'string'
        ? JSON.parse(provider.config)
        : (provider.config || {}) as Record<string, unknown>
      const providerValidation = validateActiveRechargeProvider({ type: provider.type, config: providerConfig })
      if (!providerValidation.valid) {
        request.log.warn({ providerId: providerIdNum, type: provider.type, error: providerValidation.error }, '拒绝使用未安全实现的支付渠道创建订单')
        return reply.status(400).send({ error: providerValidation.error || '支付渠道不可用' })
      }

      // 验证金额范围
      const validation = db.validateRechargeAmount(provider, normalizedAmount)
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.error })
      }

      const selectedPaymentMethod = resolveRechargePaymentMethod(
        provider.type,
        getProviderMethods(provider.methods),
        paymentMethod
      )
      const feeConfig = db.getPaymentFeeConfig(provider, selectedPaymentMethod)
      const fee = db.calculatePaymentFee(provider, normalizedAmount, selectedPaymentMethod)
      const payableAmount = db.calculatePayableAmount(provider, normalizedAmount, selectedPaymentMethod)
      const actualAmount = db.calculateActualAmount(provider, normalizedAmount)
      if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
        request.log.warn(
          { providerId, amount: normalizedAmount, fee, actualAmount },
          '拒绝创建实际到账金额无效的充值订单'
        )
        return reply.status(400).send({ error: '充值金额扣除手续费后必须大于 0 元' })
      }
      const expiredAt = getRechargeOrderExpiryAt(provider.type, providerConfig)
      const orderNo = db.generateOrderNo()
      const providerConfigSnapshot = buildRechargeProviderConfigSnapshot(provider.type, providerConfig)
      const providerPaymentDetails = provider.type === 'heleket'
        ? buildHeleketInvoicePaymentDetails(orderNo, payableAmount, buildHeleketConfig(providerConfig).heleketConfig)
        : { kind: provider.type }
      const paymentDetails = mergeRechargeAmountDetails(providerPaymentDetails, {
        amount: normalizedAmount,
        payableAmount,
        fee,
        feeRate: feeConfig.feeRate,
        feeFixed: feeConfig.feeFixed,
        feeMode: provider.type === 'yipay' ? 'surcharge' : 'deduct',
        paymentMethod: selectedPaymentMethod || null
      })

      // 创建订单
      const order = await db.createRechargeOrder({
        orderNo,
        userId: user.id,
        providerId: providerIdNum,
        amount: normalizedAmount,
        actualAmount,
        paymentMethod: selectedPaymentMethod,
        fee,
        expiredAt,
        providerConfigSnapshot,
        paymentDetails: paymentDetails as Record<string, unknown> | null,
        ip: request.ip,
        userAgent: request.headers['user-agent']
      })

      // 根据支付渠道类型生成支付链接
      let payUrl: string | null = null
      const urls = buildRechargeUrls(provider.id, order.orderNo)

      try {
        payUrl = await createRechargePayUrl(
          provider,
          providerConfig,
          order.orderNo,
          payableAmount,
          selectedPaymentMethod,
          urls
        )
      } catch (payError) {
        request.log.warn({ providerId: providerIdNum, orderNo: order.orderNo, error: payError }, '生成支付链接失败')
        throw payError
      }

      return {
        order: {
          orderNo: order.orderNo,
          amount: Number(order.amount),
          payableAmount,
          actualAmount: Number(order.actualAmount),
          fee: Number(order.fee),
          status: order.status,
          expiredAt: order.expiredAt?.toISOString(),
          createdAt: order.createdAt.toISOString()
        },
        provider: {
          id: provider.id,
          name: provider.name,
          type: provider.type,
          methods: provider.methods
        },
        payUrl
      }
    } catch (error) {
      request.log.error(error, '创建充值订单失败')
      return reply.status(500).send({ error: '创建充值订单失败' })
    }
  })

  // 获取用户充值记录列表
  app.get('/api/recharge/orders', {
    onRequest: [app.authenticate]
  }, async (request, reply) => {
    try {
      if (await db.getSystemConfigBoolean('free_site_mode', false)) {
        return reply.status(403).send({ error: '白嫖站已启用，充值功能不可用' })
      }

      const user = request.user!
      const { page, pageSize, status } = request.query as {
        page?: string
        pageSize?: string
        status?: string
      }

      const result = await db.getUserRechargeRecords(user.id, {
        page: parseOptionalPositiveInteger(page, 1),
        pageSize: parseOptionalPositiveInteger(pageSize, 20),
        status: parseOptionalRechargeStatus(status)
      })

      return {
        records: result.records.map(r => buildRechargeRecordView({
          id: r.id,
          orderNo: r.orderNo,
          amount: r.amount,
          actualAmount: r.actualAmount,
          fee: r.fee,
          status: r.status,
          provider: r.provider,
          paymentMethod: (r as any).paymentMethod || null,
          paymentDetails: (r as any).paymentDetails,
          tradeNo: r.tradeNo,
          failReason: r.failReason,
          createdAt: r.createdAt,
          expiredAt: r.expiredAt,
          completedAt: r.completedAt
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize
      }
    } catch (error) {
      request.log.error(error, '获取充值记录失败')
      return reply.status(500).send({ error: '获取充值记录失败' })
    }
  })

  // 获取充值订单详情
  app.get('/api/recharge/orders/:orderNo', {
    onRequest: [app.authenticate]
  }, async (request, reply) => {
    try {
      if (await db.getSystemConfigBoolean('free_site_mode', false)) {
        return reply.status(403).send({ error: '白嫖站已启用，充值功能不可用' })
      }

      const user = request.user!
      const { orderNo } = request.params as { orderNo: string }

      const record = await db.getRechargeRecordByOrderNo(orderNo)
      if (!record) {
        return reply.status(404).send({ error: '订单不存在' })
      }

      // 验证订单所有权
      if (record.userId !== user.id) {
        return reply.status(403).send({ error: '无权查看此订单' })
      }

      return {
        order: buildRechargeRecordView({
          id: record.id,
          orderNo: record.orderNo,
          amount: record.amount,
          actualAmount: record.actualAmount,
          fee: record.fee,
          status: record.status,
          provider: record.provider,
          paymentMethod: (record as any).paymentMethod || null,
          paymentDetails: (record as any).paymentDetails,
          tradeNo: record.tradeNo,
          failReason: record.failReason,
          createdAt: record.createdAt,
          expiredAt: record.expiredAt,
          completedAt: record.completedAt
        })
      }
    } catch (error) {
      request.log.error(error, '获取订单详情失败')
      return reply.status(500).send({ error: '获取订单详情失败' })
    }
  })

  // 取消充值订单
  app.post('/api/recharge/orders/:orderNo/cancel', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const user = request.user!
      const { orderNo } = request.params as { orderNo: string }

      const record = await db.getRechargeRecordByOrderNo(orderNo)
      if (!record) {
        return reply.status(404).send({ error: '订单不存在' })
      }

      // 验证订单所有权
      if (record.userId !== user.id) {
        return reply.status(403).send({ error: '无权操作此订单' })
      }

      // 只有待支付的订单才能取消
      if (record.status !== 'pending') {
        return reply.status(400).send({ error: '当前订单状态不允许取消' })
      }

      await db.cancelRecharge(orderNo)
      return { success: true, message: '订单已取消' }
    } catch (error) {
      request.log.error(error, '取消订单失败')
      return reply.status(500).send({ error: '取消订单失败' })
    }
  })

  // 重新支付订单（获取新的支付链接）
  app.post('/api/recharge/orders/:orderNo/repay', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      if (await db.getSystemConfigBoolean('free_site_mode', false)) {
        return reply.status(403).send({ error: '白嫖站已启用，充值功能不可用' })
      }

      const user = request.user!
      const { orderNo } = request.params as { orderNo: string }
      const { paymentMethod } = request.body as { paymentMethod?: string }

      const record = await db.getRechargeRecordByOrderNo(orderNo)
      if (!record) {
        return reply.status(404).send({ error: '订单不存在' })
      }

      // 验证订单所有权
      if (record.userId !== user.id) {
        return reply.status(403).send({ error: '无权操作此订单' })
      }

      // 只有待支付的订单才能重新支付
      if (record.status !== 'pending') {
        return reply.status(400).send({ error: '当前订单状态不允许支付' })
      }

      // 检查订单是否已过期
      if (record.expiredAt && new Date(record.expiredAt) < new Date()) {
        // 自动取消过期订单
        await db.cancelRecharge(orderNo)
        return reply.status(400).send({ error: '订单已过期，请重新创建' })
      }

      // 获取支付渠道
      const provider = await db.getPaymentProviderById(record.providerId)
      if (!provider || provider.status !== 'active') {
        return reply.status(400).send({ error: '支付渠道不可用' })
      }

      const providerConfig = typeof provider.config === 'string'
        ? JSON.parse(provider.config)
        : (provider.config || {}) as Record<string, unknown>
      const { config: effectiveProviderConfig } = resolveRechargeProviderConfig(
        provider.type,
        providerConfig,
        (record as any).providerConfigSnapshot
      )
      const providerValidation = validateActiveRechargeProvider({ type: provider.type, config: effectiveProviderConfig })
      if (!providerValidation.valid) {
        request.log.warn({ orderNo, type: provider.type, error: providerValidation.error }, '拒绝使用未安全实现的支付渠道重新支付')
        return reply.status(400).send({ error: providerValidation.error || '支付渠道不可用' })
      }

      // 生成支付链接
      const selectedPaymentMethod = resolveRechargePaymentMethod(
        provider.type,
        getProviderMethods(provider.methods),
        paymentMethod || record.paymentMethod
      )
      const rechargeAmount = Number(record.amount)
      const paymentMethodChanged = selectedPaymentMethod !== (record.paymentMethod || undefined)
      let fee = Number(record.fee)
      let payableAmount = getRechargePayableAmount({
        amount: record.amount,
        fee: record.fee,
        paymentDetails: (record as any).paymentDetails
      })
      let actualAmount = record.actualAmount !== null && record.actualAmount !== undefined
        ? Number(record.actualAmount)
        : rechargeAmount
      let paymentDetails = (record as any).paymentDetails as Record<string, unknown> | null
      const existingPaymentDetails = readRechargePaymentDetails((record as any).paymentDetails)

      if (paymentMethodChanged) {
        const pricingProvider = {
          ...provider,
          config: effectiveProviderConfig,
          feeRate: existingPaymentDetails.recharge?.feeRate ?? provider.feeRate,
          feeFixed: existingPaymentDetails.recharge?.feeFixed ?? provider.feeFixed
        } as typeof provider
        const feeConfig = db.getPaymentFeeConfig(pricingProvider, selectedPaymentMethod)
        fee = db.calculatePaymentFee(pricingProvider, rechargeAmount, selectedPaymentMethod)
        payableAmount = db.calculatePayableAmount(pricingProvider, rechargeAmount, selectedPaymentMethod)
        actualAmount = db.calculateActualAmount(pricingProvider, rechargeAmount)
        if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
          request.log.warn(
            { orderNo, providerId: provider.id, amount: rechargeAmount, fee, actualAmount },
            '拒绝重新支付实际到账金额无效的充值订单'
          )
          return reply.status(400).send({ error: '充值金额扣除手续费后必须大于 0 元' })
        }
        const providerPaymentDetails = provider.type === 'heleket'
          ? buildHeleketInvoicePaymentDetails(
              record.orderNo,
              payableAmount,
              buildHeleketConfig(effectiveProviderConfig).heleketConfig
            )
          : ((record as any).paymentDetails || { kind: provider.type })
        paymentDetails = mergeRechargeAmountDetails(providerPaymentDetails, {
          amount: rechargeAmount,
          payableAmount,
          fee,
          feeRate: feeConfig.feeRate,
          feeFixed: feeConfig.feeFixed,
          feeMode: provider.type === 'yipay' ? 'surcharge' : 'deduct',
          paymentMethod: selectedPaymentMethod || null
        }) as Record<string, unknown>
      }

      let payUrl: string | null = null
      const urls = buildRechargeUrls(provider.id, record.orderNo)

      try {
        payUrl = await createRechargePayUrl(
          provider,
          effectiveProviderConfig,
          record.orderNo,
          payableAmount,
          selectedPaymentMethod,
          urls
        )
      } catch (payError) {
        request.log.warn({ orderNo, providerId: provider.id, error: payError }, '重新生成支付链接失败')
        throw payError
      }

      if (!payUrl) {
        return reply.status(400).send({ error: '不支持的支付渠道类型' })
      }

      if (paymentMethodChanged) {
        const updatedRecord = await db.updatePendingRechargePaymentSelection(orderNo, {
          paymentMethod: selectedPaymentMethod || null,
          fee,
          actualAmount,
          paymentDetails
        })
        if (!updatedRecord) {
          return reply.status(409).send({ error: '订单状态已变化，请刷新后重试' })
        }
      }

      return {
        order: {
          orderNo: record.orderNo,
          amount: rechargeAmount,
          payableAmount,
          actualAmount,
          fee,
          paymentMethod: selectedPaymentMethod || null,
          status: record.status,
          expiredAt: record.expiredAt?.toISOString() || null
        },
        payUrl
      }
    } catch (error) {
      request.log.error(error, '重新支付失败')
      return reply.status(500).send({ error: '重新支付失败' })
    }
  })

  // 获取用户充值统计
  app.get('/api/recharge/stats', {
    onRequest: [app.authenticate]
  }, async (request, reply) => {
    try {
      const user = request.user!
      const stats = await db.getUserRechargeStats(user.id)
      return { stats }
    } catch (error) {
      request.log.error(error, '获取充值统计失败')
      return reply.status(500).send({ error: '获取充值统计失败' })
    }
  })

  // 验证订单支付状态（主动查询易支付）
  // 用于支付完成后跳转回来时，前端主动确认订单状态
  app.post('/api/recharge/orders/:orderNo/verify', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const user = request.user!
      const { orderNo } = request.params as { orderNo: string }

      // 1. 查询本地订单
      const record = await db.getRechargeRecordByOrderNo(orderNo)
      if (!record) {
        return reply.status(404).send({ error: '订单不存在' })
      }

      // 2. 验证订单所有权
      if (record.userId !== user.id) {
        return reply.status(403).send({ error: '无权操作此订单' })
      }

      // 3. 如果订单已完成，直接返回
      if (record.status === 'completed') {
        return {
          success: true,
          verified: true,
          status: 'completed',
          message: '充值已到账',
          order: buildRechargeRecordView({
            id: record.id,
            orderNo: record.orderNo,
            amount: record.amount,
            actualAmount: record.actualAmount ?? record.amount,
            fee: record.fee,
            status: record.status,
            provider: record.provider,
            paymentMethod: (record as any).paymentMethod || null,
            paymentDetails: (record as any).paymentDetails,
            tradeNo: record.tradeNo,
            failReason: record.failReason,
            createdAt: record.createdAt,
            expiredAt: record.expiredAt,
            completedAt: record.completedAt
          })
        }
      }

      // 4. 如果订单已取消或失败，返回状态
      if (record.status === 'cancelled' || record.status === 'failed') {
        return {
          success: true,
          verified: false,
          status: record.status,
          message: record.status === 'cancelled' ? '订单已取消' : '支付失败',
          order: buildRechargeRecordView({
            id: record.id,
            orderNo: record.orderNo,
            amount: record.amount,
            actualAmount: record.actualAmount,
            fee: record.fee,
            status: record.status,
            provider: record.provider,
            paymentMethod: (record as any).paymentMethod || null,
            paymentDetails: (record as any).paymentDetails,
            tradeNo: record.tradeNo,
            failReason: record.failReason,
            createdAt: record.createdAt,
            expiredAt: record.expiredAt,
            completedAt: record.completedAt
          })
        }
      }

      // 5. 订单为 pending 状态，需要主动查询支付平台
      const provider = await db.getPaymentProviderById(record.providerId)
      if (!provider) {
        return reply.status(400).send({ error: '支付渠道不存在' })
      }

      if (provider.type !== 'yipay' && provider.type !== 'heleket') {
        return {
          success: true,
          verified: false,
          status: record.status,
          message: '订单待支付，请稍后重试',
          order: {
            orderNo: record.orderNo,
            amount: Number(record.amount),
            status: record.status
          }
        }
      }

      const config = typeof provider.config === 'string'
        ? JSON.parse(provider.config)
        : (provider.config || {}) as Record<string, unknown>
      const { config: effectiveConfig } = resolveRechargeProviderConfig(
        provider.type,
        config,
        (record as any).providerConfigSnapshot
      )

      const rechargeAmount = Number(record.amount)
      const orderAmount = getRechargePayableAmount({
        amount: record.amount,
        fee: record.fee,
        paymentDetails: (record as any).paymentDetails
      })
      const creditedAmount = record.actualAmount !== null && record.actualAmount !== undefined ? Number(record.actualAmount) : rechargeAmount
      let tradeNo = ''
      let tradeNoForIndex = ''
      let actualAmount = creditedAmount
      let callbackPayload: Record<string, unknown> = { source: 'verify_api' }
      let paymentDetails = (record as any).paymentDetails as Record<string, unknown> | undefined

      if (provider.type === 'yipay') {
        const { epayConfig, valid, error: configError } = buildEpayConfig(effectiveConfig)
        if (!valid) {
          request.log.warn({ orderNo, error: configError }, '支付渠道配置不完整')
          return {
            success: true,
            verified: false,
            status: record.status,
            message: '订单待支付，请稍后重试',
            order: {
              orderNo: record.orderNo,
              amount: Number(record.amount),
              status: record.status
            }
          }
        }

        const epay = createEpayClient(epayConfig)
        const queryResult = await epay.queryOrder(orderNo)

        request.log.info({ orderNo, queryResult: { success: queryResult.success, paid: queryResult.paid } }, '易支付订单查询结果')

        if (!queryResult.success) {
          return {
            success: true,
            verified: false,
            status: record.status,
            message: '订单待支付，请稍后重试',
            order: {
              orderNo: record.orderNo,
              amount: Number(record.amount),
              status: record.status
            }
          }
        }

        if (!queryResult.paid) {
          return {
            success: true,
            verified: false,
            status: 'pending',
            message: '订单待支付',
            order: {
              orderNo: record.orderNo,
              amount: Number(record.amount),
              status: record.status
            }
          }
        }

        if (!isRechargeGatewayOrderNoMatch(orderNo, queryResult.out_trade_no)) {
          request.log.warn(
            { orderNo, gatewayOrderNo: queryResult.out_trade_no },
            '易支付订单查询返回订单号不匹配，拒绝主动完成充值'
          )
          return {
            success: false,
            verified: false,
            status: 'pending',
            message: '支付订单号校验失败，请等待异步回调或联系客服',
            order: {
              orderNo: record.orderNo,
              amount: rechargeAmount,
              status: record.status
            }
          }
        }

        tradeNo = queryResult.trade_no || ''
        tradeNoForIndex = getTradeNoForIndex(orderNo, tradeNo)

        const paidAmount = queryResult.money ? parseFloat(queryResult.money) : 0
        if (paidAmount > 0 && Math.abs(paidAmount - orderAmount) > AMOUNT_TOLERANCE_CENTS / 100) {
          request.log.warn(
            { orderNo, orderAmount, paidAmount, diff: Math.abs(paidAmount - orderAmount) },
            '支付金额与订单金额不匹配，拒绝处理'
          )
          return {
            success: false,
            verified: false,
            status: 'pending',
            message: '支付金额与订单金额不匹配，请联系客服',
            order: {
              orderNo: record.orderNo,
              amount: rechargeAmount,
              status: record.status
            }
          }
        }

        actualAmount = creditedAmount
        callbackPayload = { source: 'verify_api', queryResult: sanitizeObject(queryResult.rawData) as Record<string, unknown> }
      } else {
        const { heleketConfig, valid, error: configError } = buildHeleketConfig(effectiveConfig)
        if (!valid) {
          request.log.warn({ orderNo, error: configError }, 'Heleket 支付渠道配置不完整')
          return {
            success: true,
            verified: false,
            status: record.status,
            message: '订单待支付，请稍后重试',
            order: {
              orderNo: record.orderNo,
              amount: Number(record.amount),
              status: record.status
            }
          }
        }

        const heleket = createHeleketClient(heleketConfig)
        const queryResult = await heleket.getPaymentInfo({ order_id: orderNo })
        const status = extractHeleketStatus(queryResult)
        const paymentState = getHeleketPaymentState(queryResult)
        const statusMessage = getHeleketStatusMessage(status)

        request.log.info(
          { orderNo, status, paymentState, uuid: queryResult.uuid, txid: queryResult.txid },
          'Heleket 订单查询结果'
        )

        if (!isRechargeGatewayOrderNoMatch(orderNo, queryResult.order_id)) {
          request.log.warn(
            { orderNo, gatewayOrderNo: queryResult.order_id },
            'Heleket 订单查询返回订单号不匹配，拒绝主动完成充值'
          )
          return {
            success: false,
            verified: false,
            status: record.status,
            message: '支付订单号校验失败，请等待异步回调或联系客服',
            order: {
              orderNo: record.orderNo,
              amount: rechargeAmount,
              status: record.status
            }
          }
        }

        callbackPayload = {
          source: 'verify_api',
          heleketStatus: status,
          queryResult: sanitizeObject(queryResult) as Record<string, unknown>
        }
        paymentDetails = mergeHeleketPaymentDetails(
          (record as any).paymentDetails,
          queryResult,
          heleketConfig,
          {
            orderNo,
            invoiceAmount: orderAmount
          }
        ) as Record<string, unknown>

        if (paymentState === 'pending') {
          const heleketTradeNo = (
            (typeof queryResult.uuid === 'string' && queryResult.uuid.trim() ? queryResult.uuid : '') ||
            (typeof queryResult.txid === 'string' && queryResult.txid.trim() ? queryResult.txid : '') ||
            null
          )
          await db.updateRechargeOrderMetadata(orderNo, {
            tradeNo: heleketTradeNo,
            paymentDetails
          })

          return {
            success: true,
            verified: false,
            status: 'pending',
            message: statusMessage,
            order: buildRechargeRecordView({
              id: record.id,
              orderNo: record.orderNo,
              amount: record.amount,
              actualAmount: record.actualAmount,
              fee: record.fee,
              status: record.status,
              provider: record.provider,
              paymentMethod: (record as any).paymentMethod || null,
              paymentDetails,
              tradeNo: heleketTradeNo,
              failReason: record.failReason,
              createdAt: record.createdAt,
              expiredAt: record.expiredAt,
              completedAt: record.completedAt
            })
          }
        }

        if (paymentState === 'cancelled') {
          await db.cancelRecharge(orderNo, callbackPayload, paymentDetails)

          return {
            success: true,
            verified: true,
            status: 'cancelled',
            message: statusMessage,
            order: buildRechargeRecordView({
              id: record.id,
              orderNo: record.orderNo,
              amount: record.amount,
              actualAmount: record.actualAmount,
              fee: record.fee,
              status: 'cancelled',
              provider: record.provider,
              paymentMethod: (record as any).paymentMethod || null,
              paymentDetails,
              tradeNo: record.tradeNo,
              failReason: record.failReason,
              createdAt: record.createdAt,
              expiredAt: record.expiredAt,
              completedAt: record.completedAt
            })
          }
        }

        if (paymentState === 'failed') {
          await db.failRecharge(orderNo, statusMessage, callbackPayload, paymentDetails)

          return {
            success: true,
            verified: true,
            status: 'failed',
            message: statusMessage,
            order: buildRechargeRecordView({
              id: record.id,
              orderNo: record.orderNo,
              amount: record.amount,
              actualAmount: record.actualAmount,
              fee: record.fee,
              status: 'failed',
              provider: record.provider,
              paymentMethod: (record as any).paymentMethod || null,
              paymentDetails,
              tradeNo: record.tradeNo,
              failReason: statusMessage,
              createdAt: record.createdAt,
              expiredAt: record.expiredAt,
              completedAt: record.completedAt
            })
          }
        }

        tradeNo = (
          (typeof queryResult.uuid === 'string' && queryResult.uuid.trim() ? queryResult.uuid : '') ||
          (typeof queryResult.txid === 'string' && queryResult.txid.trim() ? queryResult.txid : '') ||
          (typeof queryResult.order_id === 'string' && queryResult.order_id.trim() ? queryResult.order_id : '') ||
          orderNo
        ).trim()
        tradeNoForIndex = getTradeNoForIndex(orderNo, tradeNo)

        const invoiceAmount = getHeleketInvoiceAmount(queryResult)
        if (invoiceAmount === undefined || !Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
          request.log.warn({ orderNo, queryResult: sanitizeObject(queryResult) }, 'Heleket 返回的支付金额无效')
          return {
            success: true,
            verified: false,
            status: 'pending',
            message: '支付处理中，请稍后重试',
            order: {
              orderNo: record.orderNo,
              amount: rechargeAmount,
              status: record.status
            }
          }
        }

        if (invoiceAmount + AMOUNT_TOLERANCE_CENTS / 100 < orderAmount) {
          request.log.warn(
            { orderNo, orderAmount, invoiceAmount, diff: orderAmount - invoiceAmount },
            'Heleket 支付金额低于订单金额，拒绝处理'
          )
          return {
            success: false,
            verified: false,
            status: 'pending',
            message: '支付金额不足，请联系客服',
            order: {
              orderNo: record.orderNo,
              amount: rechargeAmount,
              status: record.status
            }
          }
        }

        actualAmount = creditedAmount
      }

      if (await isCallbackProcessed(provider.id, orderNo, tradeNoForIndex)) {
        // 已处理过，重新查询订单状态
        const updatedRecord = await db.getRechargeRecordByOrderNo(orderNo)
        return {
          success: true,
          verified: true,
          status: updatedRecord?.status || 'completed',
          message: '充值已到账',
          order: buildRechargeRecordView({
            id: updatedRecord?.id || record.id,
            orderNo: record.orderNo,
            amount: updatedRecord?.amount || record.amount,
            actualAmount: updatedRecord?.actualAmount ?? record.amount,
            fee: updatedRecord?.fee || record.fee,
            status: updatedRecord?.status || 'completed',
            provider: updatedRecord?.provider || record.provider,
            paymentMethod: ((updatedRecord as any)?.paymentMethod || (record as any).paymentMethod || null),
            paymentDetails: (updatedRecord as any)?.paymentDetails || paymentDetails || (record as any).paymentDetails,
            tradeNo: updatedRecord?.tradeNo || tradeNo || null,
            failReason: updatedRecord?.failReason || record.failReason,
            createdAt: updatedRecord?.createdAt || record.createdAt,
            expiredAt: updatedRecord?.expiredAt || record.expiredAt,
            completedAt: updatedRecord?.completedAt || new Date()
          })
        }
      }

      const displayAmount = actualAmount > 0 ? actualAmount : orderAmount

      // 10. 完成充值
      try {
        const completion = await db.completeRecharge(orderNo, {
          tradeNo,
          actualAmount,
          callbackData: callbackPayload,
          paymentDetails
        })

        // 记录已处理
        await markCallbackProcessed(provider.id, orderNo, tradeNoForIndex, request.ip)

        if (completion.completedNow) {
          // 记录充值成功日志
          await createLog(
            record.userId,
            'user',
            'recharge.completed',
            `Recharge completed via verify API: order ${orderNo}, amount ${displayAmount}, tradeNo: ${tradeNo || 'N/A'}`,
            'success'
          )

          // 发送充值成功通知（站内信）
          try {
            await createInboxMessage({
              userId: record.userId,
              eventType: 'recharge_success',
              title: '充值到账通知',
              content: `您的充值已到账！\n充值金额：￥${displayAmount.toFixed(2)}\n订单号：${orderNo}\n交易号：${tradeNo || 'N/A'}`,
              data: {
                orderNo,
                amount: displayAmount,
                tradeNo
              }
            })

            // 发送充值成功邮件通知
            try {
              const user = await db.findUserById(record.userId)
              if (user && user.email) {
                const balance = await db.getUserBalance(record.userId)
                await sendRechargeSuccessEmail(user.email, {
                  username: user.username,
                  amount: displayAmount,
                  orderNo,
                  tradeNo: tradeNo || null,
                  newBalance: balance,
                  time: new Date()
                })
              }
            } catch (emailErr) {
              request.log.warn({ orderNo, error: emailErr }, '发送充值成功邮件失败')
            }
          } catch (notifyError) {
            request.log.warn({ orderNo, error: notifyError }, '发送充值成功通知失败')
          }
        }

        request.log.info({ orderNo, tradeNo, completedNow: completion.completedNow }, '通过 verify API 完成充值')

        return {
          success: true,
          verified: true,
          status: 'completed',
          message: '充值成功！余额已到账',
          order: buildRechargeRecordView({
            id: record.id,
            orderNo: record.orderNo,
            amount: record.amount,
            actualAmount,
            fee: record.fee,
            status: 'completed',
            provider: record.provider,
            paymentMethod: (record as any).paymentMethod || null,
            paymentDetails,
            tradeNo,
            failReason: null,
            createdAt: record.createdAt,
            expiredAt: record.expiredAt,
            completedAt: new Date()
          })
        }
      } catch (completeError) {
        // 幂等性处理：如果完成失败但订单已是 completed 状态
        const currentRecord = await db.getRechargeRecordByOrderNo(orderNo)
        if (currentRecord && currentRecord.status === 'completed') {
          await markCallbackProcessed(provider.id, orderNo, tradeNoForIndex, request.ip)
          return {
            success: true,
            verified: true,
            status: 'completed',
            message: '充值已到账',
            order: buildRechargeRecordView({
              id: currentRecord.id,
              orderNo: record.orderNo,
              amount: currentRecord.amount,
              actualAmount: currentRecord.actualAmount ?? record.amount,
              fee: currentRecord.fee,
              status: 'completed',
              provider: currentRecord.provider || record.provider,
              paymentMethod: ((currentRecord as any).paymentMethod || (record as any).paymentMethod || null),
              paymentDetails: (currentRecord as any).paymentDetails || paymentDetails,
              tradeNo: currentRecord.tradeNo || tradeNo,
              failReason: currentRecord.failReason,
              createdAt: currentRecord.createdAt,
              expiredAt: currentRecord.expiredAt,
              completedAt: currentRecord.completedAt
            })
          }
        }
        throw completeError
      }
    } catch (error) {
      request.log.error(error, '验证订单状态失败')
      return reply.status(500).send({ error: '验证订单状态失败' })
    }
  })

  // ==================== 管理员接口 ====================

  // 获取所有支付渠道（管理员）
  app.get('/api/admin/payment-providers', {
    onRequest: [app.authenticate, app.requireAdmin]
  }, async (request, reply) => {
    try {
      const providers = await db.getAllPaymentProviders()
      return { providers: providers.map(provider => db.sanitizePaymentProviderForResponse(provider)) }
    } catch (error) {
      request.log.error(error, '获取支付渠道列表失败')
      return reply.status(500).send({ error: '获取支付渠道列表失败' })
    }
  })

  // 创建支付渠道（管理员）
  app.post('/api/admin/payment-providers', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const input = request.body as db.CreatePaymentProviderInput

      if (!input.name || !input.type) {
        return reply.status(400).send({ error: '参数不完整' })
      }

      const inputConfig = input.config || {}
      const inputStatus = input.status || 'disabled'
      const validation = await validatePaymentProviderAdminInput(input.type, inputConfig, inputStatus)
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.error || '支付渠道配置不合法' })
      }
      const financialValidation = db.validatePaymentProviderFinancialInput(input, { fillDefaults: true })
      if (!financialValidation.valid) {
        return reply.status(400).send({ error: financialValidation.error || '支付渠道金额配置不合法' })
      }

      const provider = await db.createPaymentProvider({
        ...input,
        ...financialValidation.data,
        config: validation.config
      })
      return { provider: db.sanitizePaymentProviderForResponse(provider) }
    } catch (error) {
      request.log.error(error, '创建支付渠道失败')
      return reply.status(500).send({ error: '创建支付渠道失败' })
    }
  })

  // 更新支付渠道（管理员）
  app.put('/api/admin/payment-providers/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const input = request.body as db.UpdatePaymentProviderInput

      const providerId = parsePositiveId(id)
      if (!providerId) {
        return reply.status(400).send({ error: '无效的渠道ID' })
      }

      const existing = await db.getPaymentProviderById(providerId)
      if (!existing) {
        return reply.status(404).send({ error: '支付渠道不存在' })
      }

      const existingConfig = (existing.config as Record<string, unknown>) ?? {}
      const mergedConfig = input.config !== undefined
        ? db.mergePaymentProviderConfigForUpdate(input.config, existingConfig)
        : existingConfig
      const mergedStatus = (input.status ?? existing.status) as 'active' | 'disabled' | 'testing'
      const validation = await validatePaymentProviderAdminInput(existing.type, mergedConfig, mergedStatus)
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.error || '支付渠道配置不合法' })
      }
      const mergedFinancialValidation = db.validatePaymentProviderFinancialInput({
        feeRate: input.feeRate ?? Number(existing.feeRate),
        feeFixed: input.feeFixed ?? Number(existing.feeFixed),
        minAmount: input.minAmount ?? Number(existing.minAmount),
        maxAmount: input.maxAmount !== undefined
          ? input.maxAmount
          : (existing.maxAmount === null ? null : Number(existing.maxAmount))
      }, { fillDefaults: true })
      if (!mergedFinancialValidation.valid) {
        return reply.status(400).send({ error: mergedFinancialValidation.error || '支付渠道金额配置不合法' })
      }
      const patchFinancialValidation = db.validatePaymentProviderFinancialInput(input, { validateRange: false })
      if (!patchFinancialValidation.valid) {
        return reply.status(400).send({ error: patchFinancialValidation.error || '支付渠道金额配置不合法' })
      }

      const provider = await db.updatePaymentProvider(providerId, {
        ...input,
        ...patchFinancialValidation.data,
        ...(input.config !== undefined ? { config: validation.config } : {})
      })
      return { provider: db.sanitizePaymentProviderForResponse(provider) }
    } catch (error) {
      request.log.error(error, '更新支付渠道失败')
      return reply.status(500).send({ error: '更新支付渠道失败' })
    }
  })

  // 更新支付渠道状态（管理员）
  app.patch('/api/admin/payment-providers/:id/status', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const { status } = request.body as { status: 'active' | 'disabled' | 'testing' }

      const providerId = parsePositiveId(id)
      if (!providerId) {
        return reply.status(400).send({ error: '无效的渠道ID' })
      }

      // 验证状态值
      if (!['active', 'disabled', 'testing'].includes(status)) {
        return reply.status(400).send({ error: '无效的状态值' })
      }

      const existing = await db.getPaymentProviderById(providerId)
      if (!existing) {
        return reply.status(404).send({ error: '支付渠道不存在' })
      }
      const financialValidation = db.validatePaymentProviderFinancialInput({
        feeRate: Number(existing.feeRate),
        feeFixed: Number(existing.feeFixed),
        minAmount: Number(existing.minAmount),
        maxAmount: existing.maxAmount === null ? null : Number(existing.maxAmount)
      }, { fillDefaults: true })
      if (!financialValidation.valid) {
        return reply.status(400).send({ error: financialValidation.error || '支付渠道金额配置不合法' })
      }

      const validation = await validatePaymentProviderAdminInput(
        existing.type,
        (existing.config as Record<string, unknown>) ?? {},
        status
      )
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.error || '支付渠道配置不合法' })
      }

      const provider = await db.updatePaymentProvider(providerId, { status })

      return { provider: db.sanitizePaymentProviderForResponse(provider) }
    } catch (error) {
      request.log.error(error, '更新支付渠道状态失败')
      return reply.status(500).send({ error: '更新支付渠道状态失败' })
    }
  })

  // 删除支付渠道（管理员）
  app.delete('/api/admin/payment-providers/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }

      const providerId = parsePositiveId(id)
      if (!providerId) {
        return reply.status(400).send({ error: '无效的渠道ID' })
      }

      const existing = await db.getPaymentProviderById(providerId)
      if (!existing) {
        return reply.status(404).send({ error: '支付渠道不存在' })
      }

      await db.deletePaymentProvider(providerId)
      return { success: true, message: '支付渠道已删除' }
    } catch (error) {
      request.log.error(error, '删除支付渠道失败')
      return reply.status(500).send({ error: '删除支付渠道失败' })
    }
  })

  // 获取所有充值记录（管理员）
  app.get('/api/admin/recharge/orders', {
    onRequest: [app.authenticate, app.requireAdmin]
  }, async (request, reply) => {
    try {
      const { page, pageSize, status, userId } = request.query as {
        page?: string
        pageSize?: string
        status?: string
        userId?: string
      }

      const result = await db.getAllRechargeRecords({
        page: parseOptionalPositiveInteger(page, 1),
        pageSize: parseOptionalPositiveInteger(pageSize, 20),
        status: parseOptionalRechargeStatus(status),
        userId: userId ? parsePositiveId(userId) ?? undefined : undefined
      })

      return {
        records: result.records.map(r => ({
          id: r.id,
          orderNo: r.orderNo,
          userId: r.userId,
          amount: Number(r.amount),
          actualAmount: r.actualAmount !== null && r.actualAmount !== undefined ? Number(r.actualAmount) : null,
          fee: Number(r.fee),
          status: r.status,
          provider: r.provider,
          createdAt: r.createdAt.toISOString(),
          completedAt: r.completedAt?.toISOString() || null
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize
      }
    } catch (error) {
      request.log.error(error, '获取充值记录失败')
      return reply.status(500).send({ error: '获取充值记录失败' })
    }
  })

  // 获取系统充值统计（管理员）
  app.get('/api/admin/recharge/stats', {
    onRequest: [app.authenticate, app.requireAdmin]
  }, async (request, reply) => {
    try {
      const { start, end } = request.query as { start?: string; end?: string }

      const dateRange = start && end
        ? { start: new Date(start), end: new Date(end) }
        : undefined

      const stats = await db.getSystemRechargeStats(dateRange)
      return { stats }
    } catch (error) {
      request.log.error(error, '获取充值统计失败')
      return reply.status(500).send({ error: '获取充值统计失败' })
    }
  })

  // 手动完成充值订单（管理员）
  app.post('/api/admin/recharge/orders/:orderNo/complete', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const { orderNo } = request.params as { orderNo: string }
      const { tradeNo: rawTradeNo, actualAmount: rawActualAmount } = request.body as {
        tradeNo?: unknown
        actualAmount?: unknown
      }
      const tradeNo = normalizeOptionalTrimmedString(rawTradeNo, MAX_RECHARGE_TRADE_NO_LENGTH)
      if (tradeNo === null) {
        return reply.status(400).send({ error: '交易号格式无效或过长' })
      }
      let actualAmount: number | undefined
      if (rawActualAmount !== undefined) {
        actualAmount = parsePositiveJsonMoney(rawActualAmount) ?? undefined
        if (actualAmount === undefined) {
          return reply.status(400).send({ error: '入账金额必须大于 0' })
        }
      }

      const record = await db.getRechargeRecordByOrderNo(orderNo)
      if (!record) {
        return reply.status(404).send({ error: '订单不存在' })
      }

      if (record.status === 'completed') {
        return reply.status(400).send({ error: '订单已完成' })
      }

      if (record.status === 'cancelled' || record.status === 'failed' || record.status === 'refunded') {
        return reply.status(400).send({ error: '订单已取消、失败或已退款' })
      }

      const completion = await db.completeRecharge(orderNo, {
        tradeNo,
        actualAmount,
        callbackData: { manual: true, operator: request.user!.username }
      })

      if (!completion.completedNow) {
        return { success: true, message: '订单已完成，无需重复处理' }
      }

      // 记录管理员操作日志
      await createLog(
        request.user!.id,
        'admin',
        'recharge.manual_complete',
        `Admin manually completed recharge order ${orderNo} for user ${record.userId}, amount: ${Number(record.amount)}`,
        'success'
      )

      return { success: true, message: '订单已手动完成' }
    } catch (error) {
      request.log.error(error, '手动完成订单失败')
      return reply.status(500).send({ error: '手动完成订单失败' })
    }
  })

  // 标记充值订单失败（管理员）
  app.post('/api/admin/recharge/orders/:orderNo/fail', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const { orderNo } = request.params as { orderNo: string }
      const { reason: rawReason } = request.body as { reason?: unknown }
      const reason = normalizeOptionalTrimmedString(rawReason, MAX_RECHARGE_ADMIN_REASON_LENGTH)
      if (reason === null) {
        return reply.status(400).send({ error: '失败原因格式无效或过长' })
      }
      const failReason = reason || '管理员标记失败'

      const record = await db.getRechargeRecordByOrderNo(orderNo)
      if (!record) {
        return reply.status(404).send({ error: '订单不存在' })
      }

      if (record.status !== 'pending' && record.status !== 'paid') {
        return reply.status(400).send({ error: '当前订单状态不允许标记失败' })
      }

      await db.failRecharge(orderNo, failReason, {
        manual: true,
        operator: request.user!.username
      })

      // 记录管理员操作日志
      await createLog(
        request.user!.id,
        'admin',
        'recharge.manual_fail',
        `Admin marked recharge order ${orderNo} as failed: ${failReason}`,
        'success'
      )

      return { success: true, message: '订单已标记失败' }
    } catch (error) {
      request.log.error(error, '标记订单失败失败')
      return reply.status(500).send({ error: '标记订单失败' })
    }
  })

  // ==================== 第三方支付回调 ====================
  // 注意：此接口不需要认证，但需要严格的安全验证

  /**
   * 通用支付回调处理函数
   * 支持 POST 和 GET 请求（V1版本使用GET）
   */
  async function handlePaymentCallback(
    request: any,
    reply: any,
    providerId: string,
    rawCallbackData: unknown
  ) {
    const clientIp = request.ip
    const callbackData = normalizePaymentCallbackPayload(rawCallbackData)
    if (!callbackData) {
      request.log.warn({ providerId }, '支付回调 payload 格式不合法')
      return reply.status(400).send({ error: '回调数据格式不合法' })
    }

    const providerIdNum = parsePositiveId(providerId)
    if (!providerIdNum) {
      request.log.warn({ providerId }, '无效的支付渠道 ID')
      return reply.status(400).send({ error: '无效的支付渠道' })
    }

    // 1. 获取支付渠道配置
    const provider = await db.getPaymentProviderById(providerIdNum)
    if (!provider) {
      request.log.warn({ providerId }, '支付渠道不存在')
      return reply.status(404).send({ error: '支付渠道不存在' })
    }

    // 2. IP 白名单验证
    if (!isIpInWhitelist(clientIp, provider.type)) {
      request.log.warn({ ip: clientIp, providerId, providerType: provider.type }, '支付回调 IP 不在白名单内')
      return reply.status(403).send({ error: '拒绝访问' })
    }

    const currentConfig = typeof provider.config === 'string' ? JSON.parse(provider.config) : (provider.config || {})
    const preliminaryOrderNo = extractRechargeOrderNoFromCallback(provider.type, callbackData)
    const preliminaryRecord = preliminaryOrderNo
      ? await db.getRechargeRecordByOrderNo(preliminaryOrderNo)
      : null
    const { config, source: configSource } = resolveRechargeProviderConfig(
      provider.type,
      currentConfig,
      (preliminaryRecord as any)?.providerConfigSnapshot
    )
    const providerValidation = validateActiveRechargeProvider({ type: provider.type, config })
    if (!providerValidation.valid) {
      request.log.error({ providerId, type: provider.type, error: providerValidation.error, configSource }, '拒绝处理未安全实现的支付回调')
      return reply.status(400).send({ error: providerValidation.error || '支付渠道未安全启用' })
    }
    const epayVersion = (config.version as EpayVersion) || 'v2'

    // 3. 易支付签名验证（使用带交易状态的验证）
    let verifyResult: VerifyResult | null = null
    let heleketPaymentStatus = ''
    let heleketPaymentState = 'pending'
    
    if (provider.type === 'yipay') {
      const { epayConfig, valid } = buildEpayConfig(config)
      if (!valid) {
        request.log.warn({ providerId }, '支付渠道配置不完整')
        return reply.status(500).send({ error: '支付渠道配置不完整' })
      }
      
      const epay = createEpayClient(epayConfig)
      verifyResult = epay.verifyWithStatus(callbackData as CallbackData)
      
      if (!verifyResult.valid) {
        request.log.warn({ providerId, ip: clientIp, error: verifyResult.error }, '支付回调签名验证失败')
        return reply.status(400).send({ error: verifyResult.error || '签名验证失败' })
      }
      
      // V1/V2 都需要检查 trade_status === 'TRADE_SUCCESS'
      if (!verifyResult.tradeSuccess) {
        request.log.info({ providerId, tradeStatus: callbackData.trade_status }, '交易未成功，跳过处理')
        // 返回成功但不处理（支付平台可能发送待支付状态的回调）
        return epayVersion === 'v1' ? 'success' : { code: 'SUCCESS', message: 'OK' }
      }
    } else if (provider.type === 'heleket') {
      const { heleketConfig, valid } = buildHeleketConfig(config)
      if (!valid) {
        request.log.warn({ providerId }, 'Heleket 支付渠道配置不完整')
        return reply.status(500).send({ error: '支付渠道配置不完整' })
      }

      const heleket = createHeleketClient(heleketConfig)
      if (!heleket.verifyWebhookSignature(callbackData)) {
        request.log.warn({ providerId, ip: clientIp }, 'Heleket 支付回调签名验证失败')
        return reply.status(400).send({ error: '签名验证失败' })
      }

      heleketPaymentStatus = extractHeleketStatus(callbackData)
      heleketPaymentState = getHeleketPaymentState(callbackData)
    } else {
      // 其他支付渠道使用原有验证
      const signature = (callbackData.sign || callbackData.signature || request.headers['x-signature'] || '') as string
      if (!verifyCallbackSignature({ type: provider.type, config }, callbackData, signature)) {
        request.log.warn({ providerId, ip: clientIp }, '支付回调签名验证失败')
        return reply.status(400).send({ error: '签名验证失败' })
      }
    }

    // 4. 提取订单信息（根据不同支付渠道适配字段名）
    let orderNo: string | undefined
    let tradeNo: string | undefined
    let actualAmount: number | undefined

    if (provider.type === 'yipay') {
      // 易支付格式
      orderNo = callbackData.out_trade_no as string
      tradeNo = callbackData.trade_no as string
      actualAmount = callbackData.money ? parseFloat(callbackData.money as string) : undefined
    } else if (provider.type === 'heleket') {
      orderNo = callbackData.order_id as string
      tradeNo = (
        (typeof callbackData.uuid === 'string' && callbackData.uuid.trim() ? callbackData.uuid : '') ||
        (typeof callbackData.txid === 'string' && callbackData.txid.trim() ? callbackData.txid : '') ||
        (typeof callbackData.order_id === 'string' && callbackData.order_id.trim() ? callbackData.order_id : '')
      )
      actualAmount = heleketPaymentState === 'paid' ? getHeleketInvoiceAmount(callbackData) : undefined
    } else if (provider.type === 'alipay_direct') {
      orderNo = callbackData.out_trade_no as string
      tradeNo = callbackData.trade_no as string
      actualAmount = callbackData.total_amount ? parseFloat(callbackData.total_amount as string) : undefined
    } else if (provider.type === 'wechat_direct') {
      orderNo = callbackData.out_trade_no as string
      tradeNo = callbackData.transaction_id as string
      actualAmount = callbackData.total_fee ? Number(callbackData.total_fee) / 100 : undefined
    } else if (provider.type === 'stripe') {
      const data = callbackData.data as { object?: { metadata?: { orderNo?: string }; id?: string; amount?: number } } | undefined
      orderNo = data?.object?.metadata?.orderNo
      tradeNo = data?.object?.id
      actualAmount = data?.object?.amount ? data.object.amount / 100 : undefined
    } else {
      orderNo = (callbackData.orderNo || callbackData.order_no || callbackData.out_trade_no) as string
      tradeNo = (callbackData.tradeNo || callbackData.trade_no || callbackData.transaction_id) as string
      actualAmount = callbackData.amount as number
    }

    if (!orderNo) {
      request.log.warn({ providerId, data: sanitizeObject(callbackData) }, '回调数据缺少订单号')
      return reply.status(400).send({ error: '缺少订单号' })
    }

    // 5. 防重放攻击检查（数据库持久化，使用处理后的 tradeNo）
    const tradeNoForIndex = getTradeNoForIndex(orderNo, tradeNo)
    if (await isCallbackProcessed(providerIdNum, orderNo, tradeNoForIndex)) {
      request.log.info({ orderNo }, '重复回调，忽略')
      // 返回成功，避免支付平台重试
      return provider.type === 'yipay' && epayVersion === 'v1' ? 'success' : { code: 'SUCCESS', message: 'OK' }
    }

    // 6. 查询订单
    const record = preliminaryRecord && preliminaryRecord.orderNo === orderNo
      ? preliminaryRecord
      : await db.getRechargeRecordByOrderNo(orderNo)
    if (!record) {
      request.log.warn({ orderNo }, '订单不存在')
      return reply.status(404).send({ error: '订单不存在' })
    }

    // 7. 验证支付渠道一致性
    if (record.providerId !== providerIdNum) {
      request.log.warn({ orderNo, expected: record.providerId, actual: providerIdNum }, '支付渠道不匹配')
      return reply.status(400).send({ error: '支付渠道不匹配' })
    }

    let paymentDetails = (record as any).paymentDetails as Record<string, unknown> | undefined

    if (record.status === 'completed') {
      await markCallbackProcessed(providerIdNum, orderNo, tradeNoForIndex, clientIp)
      request.log.info({ orderNo }, '订单已完成，幂等返回')
      return provider.type === 'yipay' && epayVersion === 'v1' ? 'success' : { code: 'SUCCESS', message: 'OK' }
    }

    const shouldValidatePaidAmount = !(provider.type === 'heleket' && heleketPaymentState !== 'paid')
    if (shouldValidatePaidAmount && (actualAmount === undefined || !Number.isFinite(actualAmount) || actualAmount <= 0)) {
      request.log.warn({ providerId, orderNo, actualAmount }, '回调数据缺少有效支付金额')
      return reply.status(400).send({ error: '缺少有效支付金额' })
    }
    const paidActualAmount = actualAmount as number

    if (provider.type === 'heleket' && heleketPaymentState !== 'paid') {
      paymentDetails = mergeHeleketPaymentDetails(
        (record as any).paymentDetails,
        callbackData,
        buildHeleketConfig(config).heleketConfig,
        {
          orderNo,
          invoiceAmount: getRechargePayableAmount({
            amount: record.amount,
            fee: record.fee,
            paymentDetails: (record as any).paymentDetails
          })
        }
      ) as Record<string, unknown>
      const heleketCallbackPayload = {
        ...callbackData,
        heleketStatus: heleketPaymentStatus
      }

      if (heleketPaymentState === 'pending') {
        await db.updateRechargeOrderMetadata(orderNo, {
          tradeNo,
          callbackData: heleketCallbackPayload,
          paymentDetails
        })
        request.log.info({ orderNo, heleketPaymentStatus }, 'Heleket 待处理回调已记录到本地订单')
        return { code: 'SUCCESS', message: 'OK' }
      }

      if (record.status === 'pending' || record.status === 'paid') {
        if (heleketPaymentState === 'cancelled') {
          await db.cancelRecharge(orderNo, heleketCallbackPayload, paymentDetails)
        } else {
          await db.failRecharge(orderNo, getHeleketStatusMessage(heleketPaymentStatus), heleketCallbackPayload, paymentDetails)
        }
      }

      await markCallbackProcessed(providerIdNum, orderNo, tradeNoForIndex, clientIp)
      request.log.info({ orderNo, heleketPaymentStatus, heleketPaymentState }, 'Heleket 终态回调已同步到本地订单')
      return { code: 'SUCCESS', message: 'OK' }
    }

    const rechargeAmount = Number(record.amount)
    const expectedAmount = getRechargePayableAmount({
      amount: record.amount,
      fee: record.fee,
      paymentDetails: (record as any).paymentDetails
    })
    const creditedAmount = record.actualAmount !== null && record.actualAmount !== undefined ? Number(record.actualAmount) : rechargeAmount
    if (provider.type === 'heleket') {
      paymentDetails = mergeHeleketPaymentDetails(
        (record as any).paymentDetails,
        callbackData,
        buildHeleketConfig(config).heleketConfig,
        {
          orderNo,
          invoiceAmount: expectedAmount
        }
      ) as Record<string, unknown>
      if (paidActualAmount + AMOUNT_TOLERANCE_CENTS / 100 < expectedAmount) {
        request.log.warn({
          orderNo,
          expected: expectedAmount,
          actual: paidActualAmount,
          diff: expectedAmount - paidActualAmount
        }, 'Heleket 支付金额低于订单金额，拒绝处理')
        await createLog(
          record.userId,
          'system',
          'recharge.amount_mismatch',
          `Underpaid recharge rejected: order ${orderNo}, expected ${expectedAmount}, actual ${paidActualAmount}`,
          'warning'
        )
        return reply.status(400).send({ error: '支付金额不足' })
      }
    } else {
      const diff = Math.abs(paidActualAmount - expectedAmount)
      if (diff > AMOUNT_TOLERANCE_CENTS / 100) {
        request.log.warn({
          orderNo,
          expected: expectedAmount,
          actual: paidActualAmount,
          diff
        }, '支付金额与订单金额不匹配，拒绝处理')
        await createLog(
          record.userId,
          'system',
          'recharge.amount_mismatch',
          `Amount mismatch rejected: order ${orderNo}, expected ${expectedAmount}, actual ${actualAmount}`,
          'warning'
        )
        return reply.status(400).send({ error: '支付金额与订单金额不匹配' })
      }
    }

    // 9. 检查订单是否已过期
    if (record.expiredAt && new Date(record.expiredAt) < new Date()) {
      request.log.warn({ orderNo, expiredAt: record.expiredAt }, '订单已过期，拒绝处理回调')
      await markCallbackProcessed(providerIdNum, orderNo, tradeNoForIndex, clientIp)
      // 过期订单不处理，但返回成功避免支付平台重试
      return provider.type === 'yipay' && epayVersion === 'v1' ? 'success' : { code: 'SUCCESS', message: 'OK' }
    }

    // 10. 检查订单状态（幂等性处理）
    if (record.status !== 'pending' && record.status !== 'paid') {
      request.log.warn({ orderNo, status: record.status }, '订单状态不允许完成')
      return reply.status(400).send({ error: '订单状态异常' })
    }

    // 11. 完成充值（带幂等性保护）
    try {
      const completion = await db.completeRecharge(orderNo, {
        tradeNo,
        actualAmount: creditedAmount,
        callbackData: callbackData,
        paymentDetails
      })

      // 记录已处理
      await markCallbackProcessed(providerIdNum, orderNo, tradeNoForIndex, clientIp)

      if (completion.completedNow) {
        // 记录充值成功日志
        await createLog(
          record.userId,
          'user',
          'recharge.completed',
          `Recharge completed: order ${orderNo}, amount ${creditedAmount}, tradeNo: ${tradeNo || 'N/A'}`,
          'success'
        )

        // 发送充值成功通知（站内信）
        try {
          await createInboxMessage({
            userId: record.userId,
            eventType: 'recharge_success',
            title: '充值到账通知',
            content: `您的充值已到账！\n充值金额：￥${creditedAmount.toFixed(2)}\n订单号：${orderNo}\n交易号：${tradeNo || 'N/A'}`,
            data: {
              orderNo,
              amount: creditedAmount,
              tradeNo
            }
          })

          // 发送充值成功邮件通知
          try {
            const user = await db.findUserById(record.userId)
            if (user && user.email) {
              const balance = await db.getUserBalance(record.userId)
              await sendRechargeSuccessEmail(user.email, {
                username: user.username,
                amount: creditedAmount,
                orderNo,
                tradeNo: tradeNo || null,
                newBalance: balance,
                time: new Date()
              })
            }
          } catch (emailErr) {
            request.log.warn({ orderNo, error: emailErr }, '发送充值成功邮件失败')
          }
        } catch (notifyError) {
          // 通知失败不影响主流程
          request.log.warn({ orderNo, error: notifyError }, '发送充值成功通知失败')
        }
      }

      request.log.info({ orderNo, tradeNo, completedNow: completion.completedNow }, '支付回调处理成功')
      
      // 根据不同支付渠道返回不同格式的成功响应
      if (provider.type === 'yipay') {
        // V1版本返回小写 'success' 字符串
        return epayVersion === 'v1' ? 'success' : { code: 'SUCCESS', message: 'OK' }
      } else if (provider.type === 'alipay_direct') {
        return 'success'
      } else if (provider.type === 'wechat_direct') {
        return { return_code: 'SUCCESS', return_msg: 'OK' }
      } else {
        return { code: 'SUCCESS', message: 'OK' }
      }
    } catch (completeError) {
      // 幂等性处理：如果完成失败但订单已是 completed 状态，仍返回成功
      const currentRecord = await db.getRechargeRecordByOrderNo(orderNo)
      if (currentRecord && currentRecord.status === 'completed') {
        await markCallbackProcessed(providerIdNum, orderNo, tradeNoForIndex, clientIp)
        return provider.type === 'yipay' && epayVersion === 'v1' ? 'success' : { code: 'SUCCESS', message: 'OK' }
      }
      throw completeError
    }
  }

  // POST 回调接口
  app.post('/api/recharge/callback/:providerId', {
    config: {
      rateLimit: { max: 100, timeWindow: '1 minute' }
    }
  }, async (request, reply) => {
    try {
      const { providerId } = request.params as { providerId: string }
      return await handlePaymentCallback(request, reply, providerId, request.body)
    } catch (error) {
      request.log.error(error, '支付回调处理失败')
      return reply.status(500).send({ error: '回调处理失败' })
    }
  })

  // GET 回调接口（V1版本易支付使用GET请求）
  app.get('/api/recharge/callback/:providerId', {
    config: {
      rateLimit: { max: 100, timeWindow: '1 minute' }
    }
  }, async (request, reply) => {
    try {
      const { providerId } = request.params as { providerId: string }
      return await handlePaymentCallback(request, reply, providerId, request.query)
    } catch (error) {
      request.log.error(error, '支付回调处理失败')
      return reply.status(500).send({ error: '回调处理失败' })
    }
  })
}
