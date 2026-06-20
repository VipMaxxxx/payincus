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
  
  const provider = await prisma.paymentProvider.create({
    data: {
      name: input.name,
      type: input.type,
      status: input.status || 'disabled',
      config: encryptedConfig,
      methods: input.methods || [],
      feeRate: input.feeRate || 0,
      feeFixed: input.feeFixed || 0,
      minAmount: input.minAmount || 1,
      maxAmount: input.maxAmount,
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
  if (input.feeRate !== undefined) data.feeRate = input.feeRate
  if (input.feeFixed !== undefined) data.feeFixed = input.feeFixed
  if (input.minAmount !== undefined) data.minAmount = input.minAmount
  if (input.maxAmount !== undefined) data.maxAmount = input.maxAmount
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
