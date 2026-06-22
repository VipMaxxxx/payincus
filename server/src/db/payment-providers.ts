/**
 * 支付渠道管理数据库操作
 */

import { prisma } from './prisma.js'
import type { PaymentProvider, PaymentProviderType, PaymentProviderStatus } from '@prisma/client'
import { encryptSensitiveData, decryptSensitiveData } from '../lib/security.js'

// ==================== 类型定义 ====================

export interface CreatePaymentProviderInput {
  name: string
  type: PaymentProviderType
  status?: PaymentProviderStatus
  config?: Record<string, unknown>
  methods?: string[]
  feeRate?: number
  feeFixed?: number
  minAmount?: number
  maxAmount?: number | null
  sortOrder?: number
}

export interface UpdatePaymentProviderInput {
  name?: string
  status?: PaymentProviderStatus
  config?: Record<string, unknown>
  methods?: string[]
  feeRate?: number
  feeFixed?: number
  minAmount?: number
  maxAmount?: number | null
  sortOrder?: number
}

export interface PaymentMethodFeeConfig {
  feeRate: number
  feeFixed: number
}

export type PaymentMethodFeeMap = Record<string, PaymentMethodFeeConfig>

export interface PaymentProviderFinancialInput {
  feeRate?: unknown
  feeFixed?: unknown
  minAmount?: unknown
  maxAmount?: unknown
}

export interface NormalizedPaymentProviderFinancialInput {
  feeRate?: number
  feeFixed?: number
  minAmount?: number
  maxAmount?: number | null
}

export const MASKED_PAYMENT_SECRET_VALUE = '__SECRET_SET__'

const PAYMENT_PROVIDER_SECRET_KEYS = new Set([
  'key',
  'api_key',
  'secret_key',
  'webhook_secret',
  'merchant_private_key',
  'private_key',
  'signKey',
  'sign_key'
])

function hasOwnField(input: PaymentProviderFinancialInput, field: keyof PaymentProviderFinancialInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, field)
}

function normalizeMoneyNumber(
  value: unknown,
  label: string,
  options: { min: number; max?: number; allowEqualMin?: boolean; precision?: number }
): number {
  const amount = Number(value)
  const minOk = options.allowEqualMin ? amount >= options.min : amount > options.min
  const precision = options.precision ?? 2

  if (!Number.isFinite(amount) || !minOk) {
    throw new Error(`${label}不合法`)
  }

  if (options.max !== undefined && amount > options.max) {
    throw new Error(`${label}不合法`)
  }

  const normalizedAmount = Number(amount.toFixed(precision))
  const normalizedMinOk = options.allowEqualMin
    ? normalizedAmount >= options.min
    : normalizedAmount > options.min
  if (!normalizedMinOk) {
    throw new Error(`${label}不合法`)
  }

  return normalizedAmount
}

export function normalizePaymentProviderFinancialInput(
  input: PaymentProviderFinancialInput,
  options: { fillDefaults?: boolean; validateRange?: boolean } = {}
): NormalizedPaymentProviderFinancialInput {
  const data: NormalizedPaymentProviderFinancialInput = {}
  const fillDefaults = options.fillDefaults === true
  const validateRange = options.validateRange !== false

  if (hasOwnField(input, 'feeRate') || fillDefaults) {
    data.feeRate = normalizeMoneyNumber(input.feeRate ?? 0, '手续费费率', {
      min: 0,
      max: 1,
      allowEqualMin: true,
      precision: 4
    })
  }

  if (hasOwnField(input, 'feeFixed') || fillDefaults) {
    data.feeFixed = normalizeMoneyNumber(input.feeFixed ?? 0, '固定手续费', {
      min: 0,
      allowEqualMin: true
    })
  }

  if (hasOwnField(input, 'minAmount') || fillDefaults) {
    data.minAmount = normalizeMoneyNumber(input.minAmount ?? 1, '最小充值金额', {
      min: 0
    })
  }

  if (hasOwnField(input, 'maxAmount') || fillDefaults) {
    const maxAmount = input.maxAmount
    if (maxAmount === undefined || maxAmount === null || maxAmount === '') {
      data.maxAmount = null
    } else {
      data.maxAmount = normalizeMoneyNumber(maxAmount, '最大充值金额', {
        min: 0
      })
    }
  }

  const effectiveMinAmount = data.minAmount ?? (fillDefaults ? 1 : undefined)
  if (
    validateRange &&
    data.maxAmount !== undefined &&
    data.maxAmount !== null &&
    effectiveMinAmount !== undefined &&
    data.maxAmount < effectiveMinAmount
  ) {
    throw new Error('最大充值金额不能小于最小充值金额')
  }

  return data
}

export function validatePaymentProviderFinancialInput(
  input: PaymentProviderFinancialInput,
  options: { fillDefaults?: boolean; validateRange?: boolean } = {}
): { valid: boolean; error?: string; data: NormalizedPaymentProviderFinancialInput } {
  try {
    return {
      valid: true,
      data: normalizePaymentProviderFinancialInput(input, options)
    }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : '支付渠道金额配置不合法',
      data: {}
    }
  }
}

// ==================== 配置加密工具函数 ====================

/**
 * 加密支付渠道配置（包含密钥、私钥等敏感信息）
 */
function encryptProviderConfig(config: Record<string, unknown>): string {
  const configJson = JSON.stringify(config)
  return encryptSensitiveData(configJson)
}

/**
 * 解密支付渠道配置
 */
function decryptProviderConfig(encryptedConfig: unknown): Record<string, unknown> {
  if (!encryptedConfig) {
    return {}
  }

  // 如果是字符串（加密数据）
  if (typeof encryptedConfig === 'string') {
    // 检查是否是加密格式 (iv:tag:encrypted)
    if (encryptedConfig.includes(':')) {
      try {
        const decrypted = decryptSensitiveData(encryptedConfig)
        if (decrypted) {
          return JSON.parse(decrypted)
        }
      } catch {
        // 解密失败，尝试作为 JSON 解析
      }
    }
    // 可能是未加密的旧数据 (JSON字符串)
    try {
      return JSON.parse(encryptedConfig)
    } catch {
      return {}
    }
  }

  // 如果已经是对象（未加密的旧数据）
  if (typeof encryptedConfig === 'object') {
    return encryptedConfig as Record<string, unknown>
  }

  return {}
}

/**
 * 解密单个 Provider 的配置
 */
function decryptProvider<T extends { config: unknown }>(provider: T): T & { config: Record<string, unknown> } {
  return {
    ...provider,
    config: decryptProviderConfig(provider.config)
  }
}

function hasExistingSecretValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function shouldPreserveSecretValue(value: unknown): boolean {
  return value === undefined || value === null || value === '' || value === MASKED_PAYMENT_SECRET_VALUE
}

function maskProviderConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(config)) {
    if (PAYMENT_PROVIDER_SECRET_KEYS.has(key) && hasExistingSecretValue(value)) {
      masked[key] = ''
      masked[`${key}Configured`] = true
      continue
    }

    masked[key] = value
  }

  return masked
}

export function mergePaymentProviderConfigForUpdate(
  nextConfig: Record<string, unknown>,
  existingConfig: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...nextConfig }

  for (const key of PAYMENT_PROVIDER_SECRET_KEYS) {
    if (shouldPreserveSecretValue(nextConfig[key]) && hasExistingSecretValue(existingConfig[key])) {
      merged[key] = existingConfig[key]
    }

    delete merged[`${key}Configured`]
  }

  return merged
}

export function sanitizePaymentProviderForResponse<T extends { config: unknown }>(
  provider: T
): T & { config: Record<string, unknown> } {
  const config = provider.config && typeof provider.config === 'object' && !Array.isArray(provider.config)
    ? provider.config as Record<string, unknown>
    : decryptProviderConfig(provider.config)

  return {
    ...provider,
    config: maskProviderConfig(config)
  }
}

// ==================== 查询操作 ====================

/**
 * 获取所有支付渠道（管理员）
 * 返回解密后的配置
 */
export async function getAllPaymentProviders(): Promise<PaymentProvider[]> {
  const providers = await prisma.paymentProvider.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
  })
  return providers.map(p => decryptProvider(p)) as PaymentProvider[]
}

/**
 * 获取已启用的支付渠道（用户可见）
 * 返回解密后的配置
 */
export async function getActivePaymentProviders(): Promise<PaymentProvider[]> {
  const providers = await prisma.paymentProvider.findMany({
    where: { status: 'active' },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
  })
  return providers.map(p => decryptProvider(p)) as PaymentProvider[]
}

/**
 * 根据 ID 获取支付渠道
 * 返回解密后的配置
 */
export async function getPaymentProviderById(id: number): Promise<PaymentProvider | null> {
  const provider = await prisma.paymentProvider.findUnique({
    where: { id }
  })
  return provider ? decryptProvider(provider) as PaymentProvider : null
}

/**
 * 根据类型获取支付渠道
 * 返回解密后的配置
 */
export async function getPaymentProviderByType(type: PaymentProviderType): Promise<PaymentProvider | null> {
  const provider = await prisma.paymentProvider.findFirst({
    where: { type, status: 'active' }
  })
  return provider ? decryptProvider(provider) as PaymentProvider : null
}

// ==================== 创建操作 ====================

/**
 * 创建支付渠道
 * 配置会被加密存储
 */
export async function createPaymentProvider(input: CreatePaymentProviderInput): Promise<PaymentProvider> {
  // 加密配置
  const encryptedConfig = input.config ? encryptProviderConfig(input.config) : encryptProviderConfig({})
  const financial = normalizePaymentProviderFinancialInput(input, { fillDefaults: true })
  
  const provider = await prisma.paymentProvider.create({
    data: {
      name: input.name,
      type: input.type,
      status: input.status || 'disabled',
      config: encryptedConfig,
      methods: input.methods || [],
      feeRate: financial.feeRate ?? 0,
      feeFixed: financial.feeFixed ?? 0,
      minAmount: financial.minAmount ?? 1,
      maxAmount: financial.maxAmount,
      sortOrder: input.sortOrder || 0
    }
  })
  
  // 返回解密后的数据
  return decryptProvider(provider) as PaymentProvider
}

// ==================== 更新操作 ====================

/**
 * 更新支付渠道
 * 如果提供了 config，会被加密存储
 */
export async function updatePaymentProvider(
  id: number,
  input: UpdatePaymentProviderInput
): Promise<PaymentProvider> {
  const data: Record<string, unknown> = {}

  if (input.name !== undefined) data.name = input.name
  if (input.status !== undefined) data.status = input.status
  if (input.config !== undefined) {
    // 加密配置
    data.config = encryptProviderConfig(input.config)
  }
  if (input.methods !== undefined) data.methods = input.methods
  const financial = normalizePaymentProviderFinancialInput(input, { validateRange: false })
  if (financial.feeRate !== undefined) data.feeRate = financial.feeRate
  if (financial.feeFixed !== undefined) data.feeFixed = financial.feeFixed
  if (financial.minAmount !== undefined) data.minAmount = financial.minAmount
  if (financial.maxAmount !== undefined) data.maxAmount = financial.maxAmount
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder

  const provider = await prisma.paymentProvider.update({
    where: { id },
    data
  })
  
  // 返回解密后的数据
  return decryptProvider(provider) as PaymentProvider
}

/**
 * 启用支付渠道
 */
export async function enablePaymentProvider(id: number): Promise<PaymentProvider> {
  return prisma.paymentProvider.update({
    where: { id },
    data: { status: 'active' }
  })
}

/**
 * 禁用支付渠道
 */
export async function disablePaymentProvider(id: number): Promise<PaymentProvider> {
  return prisma.paymentProvider.update({
    where: { id },
    data: { status: 'disabled' }
  })
}

// ==================== 删除操作 ====================

/**
 * 删除支付渠道
 */
export async function deletePaymentProvider(id: number): Promise<void> {
  await prisma.paymentProvider.delete({
    where: { id }
  })
}

// ==================== 辅助函数 ====================

/**
 * 计算手续费
 */
export function calculateFee(provider: PaymentProvider, amount: number): number {
  const feeRate = Number(provider.feeRate)
  const feeFixed = Number(provider.feeFixed)
  return Number((amount * feeRate + feeFixed).toFixed(2))
}

function normalizeMethodFeeEntry(entry: unknown): PaymentMethodFeeConfig {
  if (typeof entry === 'number') {
    return {
      feeRate: Number.isFinite(entry) && entry > 0 ? entry : 0,
      feeFixed: 0
    }
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { feeRate: 0, feeFixed: 0 }
  }

  const data = entry as Record<string, unknown>
  const feeRate = Number(data.feeRate ?? 0)
  const feeFixed = Number(data.feeFixed ?? 0)

  return {
    feeRate: Number.isFinite(feeRate) && feeRate > 0 && feeRate <= 1 ? feeRate : 0,
    feeFixed: Number.isFinite(feeFixed) && feeFixed > 0 ? feeFixed : 0
  }
}

/**
 * 获取支付方式级手续费配置。
 *
 * methodFees 存在于 provider.config 中，格式：
 * { alipay: { feeRate: 0.03, feeFixed: 0 }, wxpay: { feeRate: 0.04 } }
 */
export function getPaymentMethodFeeMap(provider: PaymentProvider): PaymentMethodFeeMap {
  const config = provider.config && typeof provider.config === 'object' && !Array.isArray(provider.config)
    ? provider.config as Record<string, unknown>
    : {}
  const rawMethodFees = config.methodFees

  if (!rawMethodFees || typeof rawMethodFees !== 'object' || Array.isArray(rawMethodFees)) {
    return {}
  }

  const result: PaymentMethodFeeMap = {}
  for (const [method, entry] of Object.entries(rawMethodFees as Record<string, unknown>)) {
    const normalizedMethod = method.trim()
    if (!normalizedMethod) continue
    result[normalizedMethod] = normalizeMethodFeeEntry(entry)
  }

  return result
}

export function getPaymentFeeConfig(
  provider: PaymentProvider,
  paymentMethod?: string | null
): PaymentMethodFeeConfig {
  const method = provider.type === 'yipay' ? paymentMethod?.trim() : ''
  if (method) {
    const methodFee = getPaymentMethodFeeMap(provider)[method]
    if (methodFee) {
      return methodFee
    }
  }

  return {
    feeRate: Number(provider.feeRate) || 0,
    feeFixed: Number(provider.feeFixed) || 0
  }
}

function isSurchargeFeeProvider(provider: PaymentProvider): boolean {
  return provider.type === 'yipay'
}

/**
 * 计算充值手续费。
 */
export function calculatePaymentFee(
  provider: PaymentProvider,
  amount: number,
  paymentMethod?: string | null
): number {
  const feeConfig = getPaymentFeeConfig(provider, paymentMethod)
  return Number((amount * feeConfig.feeRate + feeConfig.feeFixed).toFixed(2))
}

/**
 * 计算用户实际需要支付给支付平台的金额。易支付为手续费外加，其它渠道沿用原始充值金额。
 */
export function calculatePayableAmount(
  provider: PaymentProvider,
  amount: number,
  paymentMethod?: string | null
): number {
  if (!isSurchargeFeeProvider(provider)) {
    return Number(amount.toFixed(2))
  }

  const fee = calculatePaymentFee(provider, amount, paymentMethod)
  return Number((amount + fee).toFixed(2))
}

/**
 * 计算实际到账金额
 */
export function calculateActualAmount(provider: PaymentProvider, amount: number): number {
  if (!isSurchargeFeeProvider(provider)) {
    const fee = calculateFee(provider, amount)
    return Number((amount - fee).toFixed(2))
  }

  return Number(amount.toFixed(2))
}

/**
 * 验证充值金额是否在渠道允许范围内
 */
export function validateRechargeAmount(provider: PaymentProvider, amount: number): { valid: boolean; error?: string } {
  const minAmount = Number(provider.minAmount)
  const maxAmount = provider.maxAmount ? Number(provider.maxAmount) : null

  if (amount < minAmount) {
    return { valid: false, error: `充值金额不能低于 ${minAmount} 元` }
  }

  if (maxAmount && amount > maxAmount) {
    return { valid: false, error: `充值金额不能超过 ${maxAmount} 元` }
  }

  return { valid: true }
}

/**
 * 获取支付渠道支持的支付方式
 */
export function getProviderMethods(provider: PaymentProvider): string[] {
  return (provider.methods as string[]) || []
}
