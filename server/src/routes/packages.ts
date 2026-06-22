/**
 * 套餐管理路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import * as packageShares from '../db/package-shares.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import type { CreatePackageRequest, UpdatePackageRequest } from '../types/api.js'
import { removeDangerousChars, validateName, validateText } from '../lib/security.js'
import { sendToChannel } from '../lib/notifier.js'
import { prisma } from '../db/prisma.js'
import { normalizeTrafficMultiplier } from '../lib/traffic-multiplier.js'
import { parseNullablePostgresBigIntInput, parseRequiredPostgresBigIntInput } from '../lib/bigint-input.js'
import { normalizePlanTrafficLimitSpeed } from '../services/traffic-bandwidth.js'
import { calculateVipLevel, getVipBadgeStyleForLevel, getVipRules } from '../services/vip-levels.js'

const KVM_UNSUPPORTED_NETWORK_MODES = new Set(['nat_ipv6_nat', 'ipv6_nat'])
const MAX_PACKAGE_PLAN_NAME_LENGTH = 50
const PUBLIC_PACKAGE_MAX_INSTANCES_MIN = 1
const PUBLIC_PACKAGE_MAX_INSTANCES_MAX = 5
const MAX_PACKAGE_PLAN_PRICE_CENTS = 99999999
const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const POSTGRES_INT_MAX = 2147483647
const MAX_PACKAGE_PLAN_BILLING_CYCLE_MONTHS = 120
const MAX_PACKAGE_PLAN_SORT_ORDER = 1000000
const MAX_PACKAGE_HOST_BINDINGS = 1000
const MAX_PACKAGE_LIMIT_STRING_LENGTH = 64
const MAX_PACKAGE_STORAGE_POOL_NAME_LENGTH = 64

type NormalizedPackagePlanInput = {
  name?: string
  description?: string
  cpu?: number
  memory?: number
  disk?: number
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  swapSize?: number
  trafficLimit?: unknown
  trafficLimitSpeed?: unknown
  price?: number
  billingCycle?: number
  isActive?: boolean
  isSoldOut?: boolean
  sortOrder?: number
  slaGuarantee?: number | null
}

type NormalizedPackageInput = {
  name?: string
  description?: string
  cpuMax?: number
  memoryMax?: number
  diskMax?: number
  bandwidthMax?: number
  networkMode?: CreatePackageRequest['networkMode']
  instanceType?: CreatePackageRequest['instanceType']
  hostIds?: number[]
  hostStoragePools?: Record<string, string | null>
  hostTrafficMultipliers?: Record<string, number>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  monthlyTrafficLimit?: string | null
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  ioLimitMode?: CreatePackageRequest['ioLimitMode']
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  limitsIngress?: string
  limitsEgress?: string
  limitsProcesses?: number
  limitsCpuPriority?: number
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  globalShared?: boolean
  globalQuotaMultiplier?: number | null
  globalMaxInstances?: number | null
  requiredPackageId?: number | null
}

type NormalizedPackageShareInput = {
  friendId?: number
  quotaMultiplier?: number | null
  maxInstances?: number | null
}

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseOptionalPositiveQueryInteger(value: string | undefined): number | null | undefined {
  if (value === undefined || value === '') return undefined
  return parsePositiveRouteId(value)
}

function validatePackagePlanName(value: unknown): { valid: boolean; message?: string; sanitized?: string } {
  if (typeof value !== 'string') {
    return { valid: false, message: '方案名称不能为空' }
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return { valid: false, message: '方案名称不能为空' }
  }
  if (Array.from(trimmed).length > MAX_PACKAGE_PLAN_NAME_LENGTH) {
    return { valid: false, message: `方案名称不能超过 ${MAX_PACKAGE_PLAN_NAME_LENGTH} 个字符` }
  }
  if (/[\u0000-\u001F\u007F]/.test(trimmed) || removeDangerousChars(trimmed) !== trimmed) {
    return { valid: false, message: '方案名称包含非法字符' }
  }

  return { valid: true, sanitized: trimmed }
}

function validatePackageNetworkModeForInstanceType(
  instanceType: string | undefined,
  networkMode: string | undefined
): string | null {
  if (instanceType === 'vm' && networkMode && KVM_UNSUPPORTED_NETWORK_MODES.has(networkMode)) {
    return 'KVM packages do not support IPv4 NAT & IPv6 NAT or IPv6 NAT network modes'
  }
  return null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requirePlanInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 必须为整数`)
  }
  if (value < min || value > max) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 必须在 ${min}-${max} 之间`)
  }
  return value
}

function optionalPlanInteger(
  input: Record<string, unknown>,
  key: string,
  field: string,
  min: number,
  max: number
): number | undefined {
  return input[key] === undefined
    ? undefined
    : requirePlanInteger(input[key], field, min, max)
}

function optionalPlanBoolean(input: Record<string, unknown>, key: string, field: string): boolean | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 必须为布尔值`)
  }
  return value
}

function normalizePackagePlanDescription(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw apiError(ErrorCode.VALIDATION_ERROR, '方案描述无效')
  }
  const trimmed = value.trim()
  if (Array.from(trimmed).length > 500) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '方案描述不能超过 500 个字符')
  }
  return trimmed
}

function normalizePackagePlanSlaGuarantee(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, 'SLA保证必须为数字')
  }
  if (value < 1 || value > 100) {
    throw apiError(ErrorCode.VALIDATION_ERROR, 'SLA保证必须在 1-100 之间')
  }
  const rounded = Math.round(value * 100) / 100
  if (Math.abs(value - rounded) > 1e-8) {
    throw apiError(ErrorCode.VALIDATION_ERROR, 'SLA保证最多支持两位小数')
  }
  return rounded
}

function normalizePackagePlanInput(input: unknown, options: {
  requireAll: boolean
  isVm: boolean
}): NormalizedPackagePlanInput {
  if (!isPlainRecord(input)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')
  }

  const normalized: NormalizedPackagePlanInput = {}

  if (options.requireAll) {
    for (const field of ['name', 'cpu', 'memory', 'disk', 'portLimit', 'snapshotLimit', 'backupLimit', 'siteLimit', 'trafficLimit', 'price'] as const) {
      if (input[field] === undefined) {
        throw apiError(ErrorCode.VALIDATION_ERROR, '请填写所有必填字段')
      }
    }
    if (!options.isVm && input.swapSize === undefined) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '请填写所有必填字段')
    }
  }

  if (input.name !== undefined) {
    const nameValidation = validatePackagePlanName(input.name)
    if (!nameValidation.valid) {
      throw apiError(ErrorCode.VALIDATION_ERROR, nameValidation.message)
    }
    normalized.name = nameValidation.sanitized!
  }

  normalized.description = normalizePackagePlanDescription(input.description)
  normalized.cpu = optionalPlanInteger(input, 'cpu', 'CPU', 15, 10000)
  normalized.memory = optionalPlanInteger(input, 'memory', '内存', 128, 62144)
  normalized.disk = optionalPlanInteger(input, 'disk', '磁盘', 512, 104857600)
  normalized.portLimit = optionalPlanInteger(input, 'portLimit', '端口映射数', 0, POSTGRES_INT_MAX)
  normalized.snapshotLimit = optionalPlanInteger(input, 'snapshotLimit', '快照数', 0, POSTGRES_INT_MAX)
  normalized.backupLimit = optionalPlanInteger(input, 'backupLimit', '备份数', 0, POSTGRES_INT_MAX)
  normalized.siteLimit = optionalPlanInteger(input, 'siteLimit', '反代站点数', 0, POSTGRES_INT_MAX)
  normalized.swapSize = options.isVm
    ? 0
    : optionalPlanInteger(input, 'swapSize', 'SWAP', 0, 1048576)
  normalized.price = optionalPlanInteger(input, 'price', '价格', 0, MAX_PACKAGE_PLAN_PRICE_CENTS)
  normalized.billingCycle = optionalPlanInteger(input, 'billingCycle', '计费周期', 1, MAX_PACKAGE_PLAN_BILLING_CYCLE_MONTHS)
  normalized.sortOrder = optionalPlanInteger(input, 'sortOrder', '排序值', -MAX_PACKAGE_PLAN_SORT_ORDER, MAX_PACKAGE_PLAN_SORT_ORDER)
  normalized.isActive = optionalPlanBoolean(input, 'isActive', 'isActive')
  normalized.isSoldOut = optionalPlanBoolean(input, 'isSoldOut', 'isSoldOut')
  normalized.slaGuarantee = normalizePackagePlanSlaGuarantee(input.slaGuarantee)

  if (input.trafficLimit !== undefined) {
    normalized.trafficLimit = input.trafficLimit
  }
  if (input.trafficLimitSpeed !== undefined) {
    normalized.trafficLimitSpeed = input.trafficLimitSpeed
  }

  return normalized
}

function requirePackageInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 必须为整数`)
  }
  if (value < min || value > max) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 必须在 ${min}-${max} 之间`)
  }
  return value
}

function optionalPackageInteger(
  input: Record<string, unknown>,
  key: string,
  field: string,
  min: number,
  max: number
): number | undefined {
  return input[key] === undefined
    ? undefined
    : requirePackageInteger(input[key], field, min, max)
}

function optionalPackageBoolean(input: Record<string, unknown>, key: string, field: string): boolean | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 必须为布尔值`)
  }
  return value
}

function optionalPackageEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  field: string,
  allowed: readonly T[]
): T | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 无效`)
  }
  return value as T
}

function optionalPackageText(
  input: Record<string, unknown>,
  key: string,
  field: string,
  maxLength: number
): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 无效`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength || removeDangerousChars(trimmed) !== trimmed) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 无效`)
  }
  return trimmed
}

function optionalPackageNullableString(
  input: Record<string, unknown>,
  key: string,
  field: string,
  maxLength: number
): string | null | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 无效`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength || removeDangerousChars(trimmed) !== trimmed) {
    throw apiError(ErrorCode.VALIDATION_ERROR, `${field} 无效`)
  }
  return trimmed
}

function normalizePackageRequiredId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return requirePackageInteger(value, '前置套餐', 1, Number.MAX_SAFE_INTEGER)
}

function normalizePackageHostIds(input: Record<string, unknown>, requireHostIds: boolean): number[] | undefined {
  const value = input.hostIds
  if (value === undefined) {
    if (requireHostIds) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'Package must bind at least one host')
    }
    return undefined
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PACKAGE_HOST_BINDINGS) {
    throw apiError(ErrorCode.VALIDATION_ERROR, 'Package must bind at least one host')
  }

  const uniqueIds = new Set<number>()
  for (const hostId of value) {
    if (typeof hostId !== 'number' || !Number.isSafeInteger(hostId) || hostId <= 0 || uniqueIds.has(hostId)) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'Invalid package host IDs')
    }
    uniqueIds.add(hostId)
  }
  return [...uniqueIds]
}

function normalizePackageHostStoragePools(input: Record<string, unknown>): Record<string, string | null> | undefined {
  const value = input.hostStoragePools
  if (value === undefined) return undefined
  if (!isPlainRecord(value)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, 'hostStoragePools 无效')
  }

  const normalized: Record<string, string | null> = {}
  for (const [hostIdKey, poolName] of Object.entries(value)) {
    if (!POSITIVE_ROUTE_ID_PATTERN.test(hostIdKey)) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'hostStoragePools 包含无效宿主机 ID')
    }
    const hostId = Number(hostIdKey)
    if (!Number.isSafeInteger(hostId)) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'hostStoragePools 包含无效宿主机 ID')
    }
    if (poolName === null) {
      normalized[String(hostId)] = null
      continue
    }
    if (typeof poolName !== 'string') {
      throw apiError(ErrorCode.VALIDATION_ERROR, '存储池名称无效')
    }
    const trimmed = poolName.trim()
    if (
      trimmed.length > MAX_PACKAGE_STORAGE_POOL_NAME_LENGTH ||
      removeDangerousChars(trimmed) !== trimmed
    ) {
      throw apiError(ErrorCode.VALIDATION_ERROR, '存储池名称无效')
    }
    normalized[String(hostId)] = trimmed || null
  }
  return normalized
}

function normalizePackageHostTrafficMultipliers(input: Record<string, unknown>): Record<string, number> | undefined {
  const value = input.hostTrafficMultipliers
  if (value === undefined) return undefined
  if (!isPlainRecord(value)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, 'hostTrafficMultipliers 无效')
  }

  const normalized: Record<string, number> = {}
  for (const [hostIdKey, multiplier] of Object.entries(value)) {
    if (!POSITIVE_ROUTE_ID_PATTERN.test(hostIdKey)) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'hostTrafficMultipliers 包含无效宿主机 ID')
    }
    const hostId = Number(hostIdKey)
    if (!Number.isSafeInteger(hostId)) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'hostTrafficMultipliers 包含无效宿主机 ID')
    }
    try {
      normalized[String(hostId)] = normalizeTrafficMultiplier(multiplier)
    } catch {
      throw apiError(ErrorCode.VALIDATION_ERROR, '流量倍率必须在 0.001-100 之间')
    }
  }
  return normalized
}

function normalizePackageInput(input: unknown, options: { requireAll: boolean }): NormalizedPackageInput {
  if (!isPlainRecord(input)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')
  }

  if (options.requireAll) {
    for (const field of ['name', 'cpuMax', 'memoryMax', 'diskMax'] as const) {
      if (input[field] === undefined) {
        throw apiError(ErrorCode.VALIDATION_ERROR, '请填写所有必填字段')
      }
    }
  }

  const normalized: NormalizedPackageInput = {}

  if (input.name !== undefined) {
    const nameValidation = validateName(input.name as string, 'Package name', 2, 64)
    if (!nameValidation.valid) {
      throw apiError(ErrorCode.VALIDATION_ERROR, nameValidation.message)
    }
    normalized.name = nameValidation.sanitized!
  }

  if (input.description !== undefined) {
    if (typeof input.description !== 'string') {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'Package description 无效')
    }
    const descValidation = validateText(input.description as string, 'Package description', 500)
    if (!descValidation.valid) {
      throw apiError(ErrorCode.VALIDATION_ERROR, descValidation.message)
    }
    normalized.description = descValidation.sanitized ?? ''
  }

  normalized.cpuMax = optionalPackageInteger(input, 'cpuMax', 'CPU', 15, 10000)
  normalized.memoryMax = optionalPackageInteger(input, 'memoryMax', '内存', 128, 1048576)
  normalized.diskMax = optionalPackageInteger(input, 'diskMax', '磁盘', 512, 104857600)
  normalized.bandwidthMax = optionalPackageInteger(input, 'bandwidthMax', '带宽', 0, POSTGRES_INT_MAX)
  normalized.networkMode = optionalPackageEnum(input, 'networkMode', '网络模式', ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_only', 'ipv6_nat'])
  normalized.instanceType = optionalPackageEnum(input, 'instanceType', '实例类型', ['container', 'vm'])
  normalized.hostIds = normalizePackageHostIds(input, options.requireAll)
  normalized.hostStoragePools = normalizePackageHostStoragePools(input)
  normalized.hostTrafficMultipliers = normalizePackageHostTrafficMultipliers(input)
  normalized.privileged = optionalPackageBoolean(input, 'privileged', 'privileged')
  normalized.nested = optionalPackageBoolean(input, 'nested', 'nested')
  normalized.active = optionalPackageBoolean(input, 'active', 'active')
  normalized.monthlyTrafficLimit = optionalPackageNullableString(input, 'monthlyTrafficLimit', '月流量限制', 64)
  normalized.portLimit = optionalPackageInteger(input, 'portLimit', '端口映射数', 1, POSTGRES_INT_MAX)
  normalized.snapshotLimit = optionalPackageInteger(input, 'snapshotLimit', '快照数', 0, POSTGRES_INT_MAX)
  normalized.backupLimit = optionalPackageInteger(input, 'backupLimit', '备份数', 0, POSTGRES_INT_MAX)
  normalized.siteLimit = optionalPackageInteger(input, 'siteLimit', '反代站点数', 0, POSTGRES_INT_MAX)
  normalized.ioLimitMode = optionalPackageEnum(input, 'ioLimitMode', 'I/O限制模式', ['throughput', 'iops'])
  normalized.limitsRead = optionalPackageText(input, 'limitsRead', '读取限制', MAX_PACKAGE_LIMIT_STRING_LENGTH)
  normalized.limitsWrite = optionalPackageText(input, 'limitsWrite', '写入限制', MAX_PACKAGE_LIMIT_STRING_LENGTH)
  normalized.limitsReadIops = optionalPackageInteger(input, 'limitsReadIops', '读取 IOPS', 0, POSTGRES_INT_MAX)
  normalized.limitsWriteIops = optionalPackageInteger(input, 'limitsWriteIops', '写入 IOPS', 0, POSTGRES_INT_MAX)
  normalized.limitsIngress = optionalPackageText(input, 'limitsIngress', '入站带宽限制', MAX_PACKAGE_LIMIT_STRING_LENGTH)
  normalized.limitsEgress = optionalPackageText(input, 'limitsEgress', '出站带宽限制', MAX_PACKAGE_LIMIT_STRING_LENGTH)
  normalized.limitsProcesses = optionalPackageInteger(input, 'limitsProcesses', '进程限制', 0, POSTGRES_INT_MAX)
  normalized.limitsCpuPriority = optionalPackageInteger(input, 'limitsCpuPriority', 'CPU优先级', 0, 10)
  normalized.bootAutostart = optionalPackageBoolean(input, 'bootAutostart', 'bootAutostart')
  normalized.bootAutostartPriority = optionalPackageInteger(input, 'bootAutostartPriority', '启动优先级', 0, 100)
  normalized.bootAutostartDelay = optionalPackageInteger(input, 'bootAutostartDelay', '启动延迟', 5, 600)
  normalized.bootHostShutdownTimeout = optionalPackageInteger(input, 'bootHostShutdownTimeout', '关机超时', 30, 600)
  normalized.globalShared = optionalPackageBoolean(input, 'globalShared', 'globalShared')
  if (input.globalQuotaMultiplier !== undefined) {
    if (input.globalQuotaMultiplier !== null && typeof input.globalQuotaMultiplier !== 'number') {
      throw apiError(ErrorCode.VALIDATION_ERROR, '全局配额倍数无效')
    }
    normalized.globalQuotaMultiplier = null
  }
  normalized.globalMaxInstances = input.globalMaxInstances === undefined
    ? undefined
    : input.globalMaxInstances === null
      ? null
      : requirePackageInteger(input.globalMaxInstances, '公开套餐最大实例数', PUBLIC_PACKAGE_MAX_INSTANCES_MIN, PUBLIC_PACKAGE_MAX_INSTANCES_MAX)
  normalized.requiredPackageId = normalizePackageRequiredId(input.requiredPackageId)

  return normalized
}

function normalizePackageShareQuotaMultiplier(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '配额倍数必须为数字')
  }
  if (value < 0.1 || value > 99.9) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '配额倍数必须在 0.1-99.9 之间')
  }
  const rounded = Math.round(value * 10) / 10
  if (Math.abs(value - rounded) > 1e-8) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '配额倍数最多支持一位小数')
  }
  return rounded
}

function normalizePackageShareMaxInstances(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return requirePackageInteger(value, '共享最大实例数', 0, MAX_PACKAGE_HOST_BINDINGS)
}

function normalizePackageShareInput(input: unknown, options: { requireFriendId: boolean }): NormalizedPackageShareInput {
  if (!isPlainRecord(input)) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')
  }

  const normalized: NormalizedPackageShareInput = {}
  if (options.requireFriendId) {
    normalized.friendId = requirePackageInteger(input.friendId, '好友 ID', 1, Number.MAX_SAFE_INTEGER)
  } else if (input.friendId !== undefined) {
    throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')
  }

  normalized.quotaMultiplier = normalizePackageShareQuotaMultiplier(input.quotaMultiplier)
  normalized.maxInstances = normalizePackageShareMaxInstances(input.maxInstances)
  return normalized
}

function validatePublicPackageMaxInstances(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= PUBLIC_PACKAGE_MAX_INSTANCES_MIN &&
    value <= PUBLIC_PACKAGE_MAX_INSTANCES_MAX
}

function normalizePublicPackageMaxInstances(value: unknown): number {
  return validatePublicPackageMaxInstances(value) ? value : PUBLIC_PACKAGE_MAX_INSTANCES_MIN
}

function getPackagePrerequisiteFields(pkg: { requiredPackageId?: number | null; requiredPackageName?: string | null; required_package_id?: number | null; required_package_name?: string | null }) {
  return {
    required_package_id: pkg.requiredPackageId ?? pkg.required_package_id ?? null,
    required_package_name: pkg.requiredPackageName ?? pkg.required_package_name ?? null
  }
}

const PACKAGE_PREREQUISITE_ERROR_CODES = new Set([
  'PACKAGE_PREREQUISITE_INVALID',
  'PACKAGE_PREREQUISITE_SELF',
  'PACKAGE_PREREQUISITE_CYCLE',
  'PACKAGE_PREREQUISITE_SCOPE'
])

function getPackagePrerequisiteError(error: unknown): { code: string; message: string } | null {
  const message = error instanceof Error ? error.message : String(error)
  const separatorIndex = message.indexOf(':')
  if (separatorIndex <= 0) return null

  const code = message.slice(0, separatorIndex)
  if (!PACKAGE_PREREQUISITE_ERROR_CODES.has(code)) return null

  return {
    code,
    message: message.slice(separatorIndex + 1).trim() || code
  }
}

async function shouldSyncPackageTrafficLimitsAfterUpdate(
  packageId: number,
  currentPackage: {
    monthly_traffic_limit?: string | null
    host_ids?: number[]
    host_traffic_multipliers?: Record<string, number>
  },
  updates: {
    monthlyTrafficLimit?: bigint | null
    hostIds?: number[]
    hostTrafficMultipliers?: Record<string, number | string | null>
  }
): Promise<boolean> {
  if (updates.monthlyTrafficLimit !== undefined) {
    const currentLimit = currentPackage.monthly_traffic_limit ? BigInt(currentPackage.monthly_traffic_limit) : null
    const nextLimit = updates.monthlyTrafficLimit
    if (currentLimit !== nextLimit) {
      return true
    }
  }

  if (updates.hostIds === undefined && updates.hostTrafficMultipliers === undefined) {
    return false
  }

  const instanceHosts = await prisma.instance.findMany({
    where: {
      packageId,
      status: { not: 'deleted' }
    },
    select: { hostId: true },
    distinct: ['hostId']
  })
  if (instanceHosts.length === 0) {
    return false
  }

  const currentHostIds = new Set(currentPackage.host_ids || [])
  const nextHostIds = updates.hostIds !== undefined ? new Set(updates.hostIds) : currentHostIds
  const currentMultipliers = currentPackage.host_traffic_multipliers || {}
  const nextMultipliers = updates.hostTrafficMultipliers || {}

  for (const { hostId } of instanceHosts) {
    const explicitMultiplierUpdate = Object.prototype.hasOwnProperty.call(nextMultipliers, String(hostId))
    if (!explicitMultiplierUpdate && (updates.hostIds === undefined || !nextHostIds.has(hostId))) {
      continue
    }

    const currentMultiplier = currentHostIds.has(hostId)
      ? normalizeTrafficMultiplier(currentMultipliers[String(hostId)] ?? 1)
      : 1
    const nextMultiplier = explicitMultiplierUpdate
      ? normalizeTrafficMultiplier(nextMultipliers[String(hostId)])
      : currentMultiplier

    if (currentMultiplier !== nextMultiplier) {
      return true
    }
  }

  return false
}

export default async function packageRoutes(fastify: FastifyInstance) {
  // ==================== 公开 API（无需登录） ====================
  
  /**
   * 公开获取套餐列表（用于门户市场页面，未登录用户可访问）
   * 只返回已启用的公开套餐（官方直营 + 托管市场）
   */
  fastify.get<{ Querystring: { source?: string } }>('/public', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }  // 公开接口需要限流
  }, async (request: FastifyRequest<{ Querystring: { source?: string } }>) => {
    const source = request.query.source || 'all'
    const zoneOwnerIds = await packageShares.getActiveHostingZoneOwnerIds()
    
    // 构建查询条件
    const where: any = {
      active: true,        // 只返回已启用的套餐
      globalShared: true   // 只返回公开套餐
    }
    
    // 根据 source 过滤
    if (source === 'official') {
      where.user = { role: 'admin' }  // 管理员创建的套餐为官方直营
    } else if (source === 'market') {
      where.user = { role: { not: 'admin' } }  // 普通用户的套餐为托管市场
      if (zoneOwnerIds.length > 0) {
        where.userId = { notIn: zoneOwnerIds }
      }
    } else if (zoneOwnerIds.length > 0) {
      where.userId = { notIn: zoneOwnerIds }
    }
    
    const packages = await prisma.package.findMany({
      where,
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        cpuMax: true,
        memoryMax: true,
        diskMax: true,
        monthlyTrafficLimit: true,
        networkMode: true,
        instanceType: true,
        privileged: true,
        nested: true,
        // 公开套餐的额外配置
        globalMaxInstances: true,
        user: {
          select: {
            role: true
          }
        },
        // 获取绑定的宿主机关系
        packageHosts: {
          select: {
            hostId: true
          }
        }
        // 不返回敏感字段：I/O限制、起动参数等
      },
      orderBy: { name: 'asc' }
    })
    
    // 查询每个套餐是否有定价方案，并计算售罄状态
    const packagesWithDetails = await Promise.all(packages.map(async (pkg) => {
      // 获取套餐的定价方案
      const plans = await prisma.packagePlan.findMany({
        where: { packageId: pkg.id, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          cpu: true,
          memory: true,
          disk: true,
          portLimit: true,
          snapshotLimit: true,
          backupLimit: true,
          siteLimit: true,
          swapSize: true,
          trafficLimit: true,
          trafficLimitSpeed: true,
          price: true,
          billingCycle: true,
          setupFee: true,
          isSoldOut: true,
          slaGuarantee: true,
          sortOrder: true
        },
        orderBy: { sortOrder: 'asc' }
      })
      
      const isPaid = plans.length > 0
      const availablePlans = plans.filter(plan => !plan.isSoldOut)
      const hostIds = pkg.packageHosts.map(ph => ph.hostId)
      
      // 检查是否售罄（所有绑定的宿主机资源不足）
      let soldOut = isPaid && availablePlans.length === 0
      if (hostIds.length > 0) {
        const hosts = await prisma.host.findMany({
          where: { id: { in: hostIds }, status: 'online' },
          select: { id: true, cpuAllowanceMax: true, memoryMax: true, cpuUsed: true, memoryUsed: true }
        })
        
        // 如果没有在线的宿主机，则售罄
        if (hosts.length === 0) {
          soldOut = true
        } else if (!soldOut) {
          // 检查是否所有宿主机资源都不足
          const minCpu = isPaid ? Math.min(...availablePlans.map(plan => plan.cpu)) : 15
          const minMemory = isPaid ? Math.min(...availablePlans.map(plan => plan.memory)) : 128
          
          const hasAvailable = hosts.some(h => {
            const cpuAvailable = (h.cpuAllowanceMax || 0) - (h.cpuUsed || 0) >= minCpu
            const memoryAvailable = (h.memoryMax || 0) - (h.memoryUsed || 0) >= minMemory
            return cpuAvailable && memoryAvailable
          })
          
          soldOut = !hasAvailable
        }
      } else {
        // 没有绑定宿主机，视为售罄
        soldOut = true
      }
      
      // 判断是否为托管市场套餐
      const sourceType = pkg.user.role === 'admin' ? 'official' : 'market'
      
      return {
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        cpu_max: pkg.cpuMax,
        memory_max: pkg.memoryMax,
        disk_max: pkg.diskMax,
        monthly_traffic_limit: pkg.monthlyTrafficLimit?.toString() || null,
        network_mode: pkg.networkMode,
        instance_type: pkg.instanceType,
        host_ids: hostIds,
        privileged: pkg.privileged,
        nested: pkg.nested,
        global_quota_multiplier: null,
        global_max_instances: normalizePublicPackageMaxInstances(pkg.globalMaxInstances),
        required_package_id: null,
        required_package_name: null,
        sourceType,
        soldOut,
        isPaid,
        plans: plans.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          cpu: p.cpu,
          memory: p.memory,
          disk: p.disk,
          portLimit: p.portLimit,
          snapshotLimit: p.snapshotLimit,
          backupLimit: p.backupLimit,
          siteLimit: p.siteLimit,
          swapSize: pkg.instanceType === 'vm' ? 0 : p.swapSize,
          trafficLimit: p.trafficLimit?.toString() || null,
          trafficLimitSpeed: p.trafficLimitSpeed,
          price: p.price,
          billingCycle: p.billingCycle,
          setupFee: p.setupFee,
          isSoldOut: p.isSoldOut,
          slaGuarantee: p.slaGuarantee,
          monthlyPrice: Number(p.price) / (p.billingCycle || 1)
        }))
      }
    }))
    
    // 售罄的套餐排在最后
    packagesWithDetails.sort((a, b) => {
      if (a.soldOut === b.soldOut) return 0
      return a.soldOut ? 1 : -1
    })
    
    return {
      packages: packagesWithDetails,
      total: packagesWithDetails.length
    }
  })

  /**
   * 公开获取地区列表（用于门户市场页面）
   */
  fastify.get<{ Querystring: { source?: string } }>('/public/regions', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest<{ Querystring: { source?: string } }>) => {
    const source = request.query.source || 'all'
    const zoneOwnerIds = await packageShares.getActiveHostingZoneOwnerIds()
    
    // 构建查询条件
    const where: any = {
      active: true,
      globalShared: true
    }
    
    if (source === 'official') {
      where.user = { role: 'admin' }
    } else if (source === 'market') {
      where.user = { role: { not: 'admin' } }
      if (zoneOwnerIds.length > 0) {
        where.userId = { notIn: zoneOwnerIds }
      }
    } else if (zoneOwnerIds.length > 0) {
      where.userId = { notIn: zoneOwnerIds }
    }
    
    // 获取所有符合条件的套餐及其绑定的宿主机
    const packages = await prisma.package.findMany({
      where,
      select: {
        id: true,
        packageHosts: {
          select: {
            hostId: true
          }
        }
      }
    })
    
    // 收集所有宿主机 ID
    const allHostIds = new Set<number>()
    packages.forEach(pkg => {
      pkg.packageHosts.forEach(ph => allHostIds.add(ph.hostId))
    })
    
    // 获取宿主机信息
    const hosts = await prisma.host.findMany({
      where: { id: { in: Array.from(allHostIds) }, status: 'online' },
      select: {
        id: true,
        countryCode: true,
        location: true
      }
    })
    
    // 按地区分组
    const regionMap = new Map<string, { name: string; packageIds: Set<number>; hostIds: Set<number> }>()
    
    packages.forEach(pkg => {
      pkg.packageHosts.forEach(ph => {
        const host = hosts.find(h => h.id === ph.hostId)
        if (host) {
          const code = host.countryCode?.toUpperCase() || 'UNKNOWN'
          if (!regionMap.has(code)) {
            regionMap.set(code, {
              name: host.location || code,
              packageIds: new Set(),
              hostIds: new Set()
            })
          }
          const region = regionMap.get(code)!
          region.packageIds.add(pkg.id)
          region.hostIds.add(ph.hostId)
        }
      })
    })
    
    // 转换为数组格式
    const regions = Array.from(regionMap.entries()).map(([code, data]) => ({
      code,
      name: data.name,
      packageIds: Array.from(data.packageIds),
      hostCount: data.hostIds.size
    }))
    
    // 按名称排序
    regions.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    
    return { regions }
  })

  // ==================== 需要登录的 API ====================

  // 获取套餐列表
  // 查询参数：
  // - all=true: 返回所有套餐（包括停用/归档的），用于套餐管理页面
  // - source: 套餐来源过滤，可选值：official（面板直营）、zone（托管专区）、market（托管市场）、friends（好友共享）
  // - zoneId: source=zone 时指定托管专区 ID
  //           不传或传 all 时返回全部（保持向后兼容）
  // - scope: 管理员专用，mine(我的) / official(自营) / hosted(托管的)
  // - userId: 管理员专用，筛选特定用户（仅 scope=hosted 时有效）
  fastify.get<{ Querystring: { all?: string; source?: string; zoneId?: string; scope?: string; userId?: string } }>('/', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Querystring: { all?: string; source?: string; zoneId?: string; scope?: string; userId?: string } }>, reply: FastifyReply) => {
    const { user } = request
    // all=true 时返回所有套餐（用于套餐管理页面），否则只返回启用的套餐（用于创建实例页面）
    const activeOnly = request.query.all !== 'true'
    const source = request.query.source || 'all'
    const scope = request.query.scope
    const filterUserId = request.query.userId
    const isAdmin = user.role === 'admin'

    // 管理员专用：scope 参数处理
    if (isAdmin && scope) {
      if (scope === 'mine') {
        // 查看自己的套餐
        const ownPackages = await db.getAllPackages(activeOnly, { userId: user.id })
        const packageIds = ownPackages.map(p => p.id)
        const [soldOutMap, instanceCountMap] = await Promise.all([
          db.checkPackagesSoldOut(packageIds),
          db.getNormalInstanceCountsByPackages(packageIds)
        ])
        return {
          packages: ownPackages.map(p => ({
            ...p,
            sourceType: 'own',
            isOwn: true,
            isShared: false,
            soldOut: soldOutMap.get(p.id) ?? false,
            instance_count: instanceCountMap.get(p.id) ?? 0
          })),
          total: ownPackages.length
        }
      } else if (scope === 'official') {
        // 查看自营套餐：仅显示管理员创建的套餐
        const officialPackages = await db.getAllPackages(activeOnly, { ownerRole: 'admin' })
        const officialPackageIds = officialPackages.map(p => p.id)
        const [officialSoldOutMap, officialInstanceCountMap] = await Promise.all([
          db.checkPackagesSoldOut(officialPackageIds),
          db.getNormalInstanceCountsByPackages(officialPackageIds)
        ])
        return {
          packages: officialPackages.map(p => ({
            ...p,
            sourceType: 'official',
            isOwn: p.user_id === user.id,
            isShared: false,
            soldOut: officialSoldOutMap.get(p.id) ?? false,
            instance_count: officialInstanceCountMap.get(p.id) ?? 0
          })),
          total: officialPackages.length
        }
      } else if (scope === 'hosted') {
        // 查看托管套餐：仅显示普通用户的套餐
        let queryOptions: { userId?: number; ownerRole?: 'admin' | 'user'; includeOwnerEmail: boolean } = {
          includeOwnerEmail: true,
          ownerRole: 'user'
        }
        
        const parsedFilterUserId = parseOptionalPositiveQueryInteger(filterUserId)
        if (parsedFilterUserId === null) {
          return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid package owner filter'))
        }
        if (parsedFilterUserId && parsedFilterUserId !== user.id) {
          queryOptions.userId = parsedFilterUserId
        }
        
        const hostedPackages = await db.getAllPackages(activeOnly, queryOptions)
        const hostedPackageIds = hostedPackages.map(p => p.id)
        const [hostedSoldOutMap, hostedInstanceCountMap] = await Promise.all([
          db.checkPackagesSoldOut(hostedPackageIds),
          db.getNormalInstanceCountsByPackages(hostedPackageIds)
        ])
        return {
          packages: hostedPackages.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            cpu_max: p.cpu_max,
            memory_max: p.memory_max,
            disk_max: p.disk_max,
            bandwidth_max: p.bandwidth_max,
            network_mode: p.network_mode,
            instance_type: p.instance_type,
            host_ids: p.host_ids || [],
            host_storage_pools: (p as any).host_storage_pools || {},
            host_traffic_multipliers: (p as any).host_traffic_multipliers || {},
            privileged: p.privileged,
            nested: p.nested,
            active: p.active,
            monthly_traffic_limit: p.monthly_traffic_limit,
            port_limit: p.port_limit,
            snapshot_limit: p.snapshot_limit,
            backup_limit: p.backup_limit,
            site_limit: p.site_limit,
            global_shared: p.global_shared,
            allow_instance_deletion: p.allow_instance_deletion,
            required_package_id: (p as any).required_package_id ?? null,
            required_package_name: (p as any).required_package_name ?? null,
            sourceType: 'hosted',
            isOwn: false,
            isShared: false,
            soldOut: hostedSoldOutMap.get(p.id) ?? false,
            instance_count: hostedInstanceCountMap.get(p.id) ?? 0,
            // 所有者信息
            owner: {
              id: p.user_id,
              username: p.owner_username,
              email: p.owner_email,
              avatarStyle: p.owner_avatar_style || 'bigSmile',
              avatarBadgeId: (p as any).owner_avatar_badge_id || null
            }
          })),
          total: hostedPackages.length
        }
      }
    }
    // 用于转换共享套餐为响应格式的辅助函数
    const formatSharedPackage = async (p: any, isGlobalShared: boolean, sourceType: 'official' | 'market' | 'friends' | 'zone', zone?: packageShares.HostingZoneInfo) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      cpu_max: p.cpuMax,
      memory_max: p.memoryMax,
      disk_max: p.diskMax,
      bandwidth_max: p.bandwidthMax,
      network_mode: p.networkMode,
      instance_type: p.instanceType,
      host_ids: p.hostIds || [],
      privileged: p.privileged,
      nested: p.nested,
      active: 1,
      monthly_traffic_limit: p.monthlyTrafficLimit,
      port_limit: p.portLimit,
      snapshot_limit: p.snapshotLimit,
      backup_limit: p.backupLimit,
      site_limit: p.siteLimit,
      // 存储 I/O 限制
      io_limit_mode: p.ioLimitMode || p.io_limit_mode || 'throughput',
      limits_read: p.limitsRead || p.limits_read || '100MB',
      limits_write: p.limitsWrite || p.limits_write || '100MB',
      limits_read_iops: p.limitsReadIops || p.limits_read_iops || 500,
      limits_write_iops: p.limitsWriteIops || p.limits_write_iops || 500,
      limits_ingress: '300Mbit',
      limits_egress: '300Mbit',
      limits_processes: 500,
      limits_cpu_priority: 10,
      boot_autostart: true,
      boot_autostart_priority: 20,
      boot_autostart_delay: 15,
      boot_host_shutdown_timeout: 30,
      // 实例操作权限
      allow_instance_deletion: p.allowInstanceDeletion ?? true,
      ...getPackagePrerequisiteFields(p),
      // 所有者信息
      ownerId: p.ownerId,
      ownerUsername: p.ownerUsername,
      isOwn: false,
      isShared: true,
      isGlobalShared,
      sharedAt: p.sharedAt,
      // 新增：套餐来源类型
      sourceType,
      has_required_package_instance: p.requiredPackageId
        ? await db.userHasNormalInstanceForPackage(user.id, p.requiredPackageId)
        : true,
      ...(zone ? {
        hostingZoneId: zone.id,
        hostingZoneName: zone.name,
        hostingZoneLogoUrl: zone.logoUrl
      } : {})
    })

    // 根据 source 参数返回对应的套餐
    if (source === 'official') {
      // 面板直营：仅返回管理员创建的全局共享套餐
      const globalPackages = await packageShares.getGlobalSharedPackages()
      const officialIds = globalPackages.map(p => p.id)
      const officialSoldOutMap = await db.checkPackagesSoldOut(officialIds)
      return {
        packages: await Promise.all(globalPackages.map(async p => ({
          ...await formatSharedPackage(p, true, 'official'),
          soldOut: officialSoldOutMap.get(p.id) ?? false
        }))),
        total: globalPackages.length
      }
    }

    if (source === 'market') {
      // 托管市场：仅返回用户托管的全局共享套餐
      const zoneOwnerIds = await packageShares.getActiveHostingZoneOwnerIds()
      const marketPackages = await packageShares.getHostedMarketPackages(user.id, {
        excludeOwnerIds: zoneOwnerIds
      })
      const marketIds = marketPackages.map(p => p.id)
      const marketSoldOutMap = await db.checkPackagesSoldOut(marketIds)
      return {
        packages: await Promise.all(marketPackages.map(async p => ({
          ...await formatSharedPackage(p, true, 'market'),
          soldOut: marketSoldOutMap.get(p.id) ?? false
        }))),
        total: marketPackages.length
      }
    }

    if (source === 'zone') {
      const zoneId = parseOptionalPositiveQueryInteger(request.query.zoneId)
      if (zoneId === null) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid hosting zone filter'))
      }
      if (zoneId === undefined) {
        return { packages: [], total: 0 }
      }

      const zone = await packageShares.getActiveHostingZoneById(zoneId, user.id)
      if (!zone) {
        return { packages: [], total: 0 }
      }

      const zonePackages = await packageShares.getHostedMarketPackages(user.id, {
        ownerId: zone.ownerId
      })
      const zonePackageIds = zonePackages.map(p => p.id)
      const zoneSoldOutMap = await db.checkPackagesSoldOut(zonePackageIds)

      return {
        packages: await Promise.all(zonePackages.map(async p => ({
          ...await formatSharedPackage(p, true, 'zone', zone),
          soldOut: zoneSoldOutMap.get(p.id) ?? false
        }))),
        total: zonePackages.length
      }
    }

    if (source === 'friends') {
      // 好友共享：仅返回好友共享的套餐
      const friendPackages = await packageShares.getSharedToUser(user.id)
      const friendIds = friendPackages.map(p => p.id)
      const friendSoldOutMap = await db.checkPackagesSoldOut(friendIds)
      return {
        packages: await Promise.all(friendPackages.map(async p => ({
          ...await formatSharedPackage(p, false, 'friends'),
          soldOut: friendSoldOutMap.get(p.id) ?? false
        }))),
        total: friendPackages.length
      }
    }

    // source=all 或不传：返回全部（保持向后兼容）
    // 获取套餐：管理员查看系统所有套餐，普通用户查看自己的套餐
    const ownPackages = await db.getAllPackages(activeOnly, {
      userId: isAdmin ? undefined : user.id
    })
    const ownPackageIds = ownPackages.map(p => p.id)
    const ownInstanceCountMap = await db.getNormalInstanceCountsByPackages(ownPackageIds)

    // 获取共享给用户的套餐（好友共享）
    const sharedPackages = await packageShares.getSharedToUser(user.id)

    // 获取全局共享的套餐（官方）
    const globalPackages = await packageShares.getGlobalSharedPackages()

    // 获取托管市场套餐
    const hostingZones = await packageShares.getHostingZonesForViewer(user.id)
    const zoneOwnerIds = hostingZones.map(zone => zone.ownerId)
    const marketPackages = await packageShares.getHostedMarketPackages(user.id, {
      excludeOwnerIds: zoneOwnerIds
    })

    const zonePackagesByZone = await Promise.all(
      hostingZones.map(async zone => ({
        zone,
        packages: await packageShares.getHostedMarketPackages(user.id, {
          ownerId: zone.ownerId
        })
      }))
    )

    // 合并并去重，优先级：自己的 > 好友分享 > 托管专区 > 托管市场 > 官方直营
    // 使用 Set 记录已添加的套餐 ID，避免重复
    const addedPackageIds = new Set<number>()
    const allPackages: any[] = []

    // 1. 首先添加自己的套餐（最高优先级）
    for (const p of ownPackages) {
      addedPackageIds.add(p.id)
      allPackages.push({
        id: p.id,
        name: p.name,
        description: p.description,
        cpu_max: p.cpu_max,
        memory_max: p.memory_max,
        disk_max: p.disk_max,
        bandwidth_max: p.bandwidth_max,
        network_mode: p.network_mode,
        instance_type: p.instance_type,
        host_ids: (p as { host_ids?: number[] }).host_ids || [],
        host_storage_pools: (p as any).host_storage_pools || {},
        host_traffic_multipliers: (p as any).host_traffic_multipliers || {},
        privileged: p.privileged,
        nested: p.nested,
        active: p.active,
        monthly_traffic_limit: p.monthly_traffic_limit,
        port_limit: p.port_limit,
        snapshot_limit: p.snapshot_limit,
        backup_limit: p.backup_limit,
        site_limit: p.site_limit,
        global_shared: p.global_shared,
        // 存储 I/O 限制
        io_limit_mode: (p as any).io_limit_mode ?? 'throughput',
        limits_read: p.limits_read,
        limits_write: p.limits_write,
        limits_read_iops: p.limits_read_iops,
        limits_write_iops: p.limits_write_iops,
        // 网络限制
        limits_ingress: p.limits_ingress,
        limits_egress: p.limits_egress,
        // 进程与调度
        limits_processes: p.limits_processes,
        limits_cpu_priority: p.limits_cpu_priority,
        // 启动配置
        boot_autostart: p.boot_autostart,
        boot_autostart_priority: p.boot_autostart_priority,
        boot_autostart_delay: p.boot_autostart_delay,
        boot_host_shutdown_timeout: p.boot_host_shutdown_timeout,
        // 实例操作权限
        allow_instance_deletion: (p as any).allow_instance_deletion ?? true,
        required_package_id: (p as any).required_package_id ?? null,
        required_package_name: (p as any).required_package_name ?? null,
        has_required_package_instance: (p as any).required_package_id
          ? await db.userHasNormalInstanceForPackage(user.id, (p as any).required_package_id)
          : true,
        // 所有者信息
        ownerId: p.user_id,
        ownerUsername: p.owner_username,
        isOwn: true,
        isShared: false,
        sourceType: 'own',
        instance_count: ownInstanceCountMap.get(p.id) ?? 0
      })
    }

    // 2. 添加好友分享的套餐（跳过已有的）
    for (const p of sharedPackages) {
      if (addedPackageIds.has(p.id)) continue
      addedPackageIds.add(p.id)
      allPackages.push(await formatSharedPackage(p, false, 'friends'))
    }

    // 3. 添加托管专区套餐（跳过已有的）
    for (const group of zonePackagesByZone) {
      for (const p of group.packages) {
        if (addedPackageIds.has(p.id)) continue
        addedPackageIds.add(p.id)
        allPackages.push(await formatSharedPackage(p, true, 'zone', group.zone))
      }
    }

    // 4. 添加托管市场套餐（跳过已有的）
    for (const p of marketPackages) {
      if (addedPackageIds.has(p.id)) continue
      addedPackageIds.add(p.id)
      allPackages.push(await formatSharedPackage(p, true, 'market'))
    }

    // 5. 添加官方直营套餐（跳过已有的）
    for (const p of globalPackages) {
      if (addedPackageIds.has(p.id)) continue
      addedPackageIds.add(p.id)
      allPackages.push(await formatSharedPackage(p, true, 'official'))
    }

    // 6. 批量计算售罄状态
    const packageIds = allPackages.map(p => p.id)
    const soldOutMap = await db.checkPackagesSoldOut(packageIds)

    // 7. 添加 soldOut 字段到每个套餐
    const packagesWithSoldOut = allPackages.map(p => ({
      ...p,
      soldOut: soldOutMap.get(p.id) ?? false
    }))

    return {
      packages: packagesWithSoldOut,
      total: packagesWithSoldOut.length
    }
  })

  // 获取当前用户可见的托管专区列表
  fastify.get('/hosting-zones', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const zones = await packageShares.getHostingZonesForViewer(request.user.id)
    return { zones }
  })

  // 获取套餐详情
  fastify.get<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const pkg = await db.getPackageById(packageId)

    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }

    // 检查访问权限：自己的套餐、共享给自己的套餐、或者自己的实例绑定了这个套餐
    const canAccess = await packageShares.canUserAccessPackage(user.id, packageId)

    // 额外检查：用户是否有实例绑定了这个套餐（用于修改配置时查看套餐限制）
    let hasInstanceWithPackage = false
    if (!canAccess) {
      const userInstances = await db.getInstancesByUserId(user.id)
      hasInstanceWithPackage = userInstances.some(inst => inst.package_id === packageId)
    }

    // 管理员可以访问任何套餐
    const isAdmin = user.role === 'admin'
    if (!canAccess && !hasInstanceWithPackage && !isAdmin) {
      // 添加调试日志，帮助排查套餐访问权限问题
      console.warn(`[PACKAGE_ACCESS_DENIED] GET /packages/${id} - packageId=${packageId}, userId=${user.id}, username=${user.username}, pkgOwnerId=${pkg.user_id}, canAccess=${canAccess}, hasInstanceWithPackage=${hasInstanceWithPackage}, isAdmin=${isAdmin}`)
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const isOwn = pkg.user_id === user.id

    // 计算剩余配额信息
    // 安全注意：只有在用户有权限访问套餐（canAccess）时才计算配额信息
    // 如果只是通过hasInstanceWithPackage获得访问权限，不计算配额（因为不能创建新实例）
    let quotaInfo: {
      maxInstances: number | null
      remainingInstances: number | null
      maxCpu: number | null
      remainingCpu: number | null
      maxMemory: number | null
      remainingMemory: number | null
      ownerUsername: string | null
    } = {
      maxInstances: null,
      remainingInstances: null,
      maxCpu: null,
      remainingCpu: null,
      maxMemory: null,
      remainingMemory: null,
      ownerUsername: null
    }

    // 只有在用户有权限访问套餐时才计算配额信息
    if (canAccess) {
      if (!isOwn) {
        // 如果是共享套餐，计算剩余配额
        const shareInfo = await packageShares.getPackageShareForUser(packageId, user.id)
        if (shareInfo) {
          const usage = await packageShares.getSharedPackageUsage(packageId, user.id)
          
          // 获取套餐所有者用户名
          if (pkg.user_id) {
            const owner = await db.findUserById(pkg.user_id)
            quotaInfo.ownerUsername = owner?.username || null
          }

          // 实例数量配额
          if (shareInfo.maxInstances !== null) {
            quotaInfo.maxInstances = shareInfo.maxInstances
            quotaInfo.remainingInstances = Math.max(0, shareInfo.maxInstances - usage.instanceCount)
          } else {
            quotaInfo.maxInstances = null
            quotaInfo.remainingInstances = null // 无限制
          }

          // CPU/内存配额
          if (shareInfo.quotaMultiplier !== null) {
            quotaInfo.maxCpu = Math.floor(pkg.cpu_max * shareInfo.quotaMultiplier)
            quotaInfo.remainingCpu = Math.max(0, quotaInfo.maxCpu - usage.totalCpu)
            quotaInfo.maxMemory = Math.floor(pkg.memory_max * shareInfo.quotaMultiplier)
            quotaInfo.remainingMemory = Math.max(0, quotaInfo.maxMemory - usage.totalMemory)
          } else {
            quotaInfo.maxCpu = null
            quotaInfo.remainingCpu = null // 无限制
            quotaInfo.maxMemory = null
            quotaInfo.remainingMemory = null // 无限制
          }
        }
      } else {
        // 自己的套餐，获取所有者用户名
        quotaInfo.ownerUsername = user.username
        // 自己的套餐无限制
        quotaInfo.maxInstances = null
        quotaInfo.remainingInstances = null
        quotaInfo.maxCpu = null
        quotaInfo.remainingCpu = null
        quotaInfo.maxMemory = null
        quotaInfo.remainingMemory = null
      }
    } else if (hasInstanceWithPackage) {
      // 用户只是有实例绑定了这个套餐，但没有访问权限（不能创建新实例）
      // 这种情况下，不计算配额信息，但可以显示套餐所有者用户名（用于显示）
      if (pkg.user_id) {
        const owner = await db.findUserById(pkg.user_id)
        quotaInfo.ownerUsername = owner?.username || null
      }
      // 配额信息保持为null，前端会不显示
    }

    const requiredPackageId = (pkg as any).required_package_id ?? null
    const hasRequiredPackageInstance = requiredPackageId !== null
      ? await db.userHasNormalInstanceForPackage(user.id, requiredPackageId)
      : true

    return {
      package: {
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        cpu_max: pkg.cpu_max,
        memory_max: pkg.memory_max,
        disk_max: pkg.disk_max,
        bandwidth_max: pkg.bandwidth_max,
        network_mode: pkg.network_mode,
        instance_type: pkg.instance_type,  // 实例类型
        host_ids: (pkg as { host_ids?: number[] }).host_ids || [],
        host_storage_pools: isOwn || isAdmin ? ((pkg as any).host_storage_pools || {}) : undefined,
        host_traffic_multipliers: isOwn || isAdmin ? ((pkg as any).host_traffic_multipliers || {}) : undefined,
        privileged: isOwn ? pkg.privileged : 0,
        nested: isOwn ? pkg.nested : 0,
        active: pkg.active,
        monthly_traffic_limit: pkg.monthly_traffic_limit,
        port_limit: pkg.port_limit,
        snapshot_limit: pkg.snapshot_limit,
        backup_limit: pkg.backup_limit,
        site_limit: pkg.site_limit,
        // 存储 I/O 限制
        io_limit_mode: (pkg as any).io_limit_mode ?? 'throughput',
        limits_read: pkg.limits_read,
        limits_write: pkg.limits_write,
        limits_read_iops: pkg.limits_read_iops,
        limits_write_iops: pkg.limits_write_iops,
        // 网络限制
        limits_ingress: pkg.limits_ingress,
        limits_egress: pkg.limits_egress,
        // 进程与调度
        limits_processes: pkg.limits_processes,
        limits_cpu_priority: pkg.limits_cpu_priority,
        // 启动配置
        boot_autostart: pkg.boot_autostart,
        boot_autostart_priority: pkg.boot_autostart_priority,
        boot_autostart_delay: pkg.boot_autostart_delay,
        boot_host_shutdown_timeout: pkg.boot_host_shutdown_timeout,
        // 全局共享配置（仅套餐所有者查看时返回）
        global_shared: isOwn ? ((pkg as any).global_shared ?? false) : undefined,
        global_quota_multiplier: isOwn ? null : undefined,
        global_max_instances: isOwn
          ? (((pkg as any).global_shared ?? false) ? normalizePublicPackageMaxInstances((pkg as any).global_max_instances) : null)
          : undefined,
        // 实例操作权限（所有用户都需要知道是否可以删除）
        allow_instance_deletion: (pkg as any).allow_instance_deletion ?? true,
        required_package_id: (pkg as any).required_package_id ?? null,
        required_package_name: (pkg as any).required_package_name ?? null,
        has_required_package_instance: hasRequiredPackageInstance,
        ownerId: pkg.user_id,
        isOwn,
        // 剩余配额信息
        quotaInfo
      }
    }
  })

  // 创建套餐（管理员或满足准入条件的用户）
  fastify.post<{ Body: CreatePackageRequest }>('/', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['name', 'cpuMax', 'memoryMax', 'diskMax'],
        properties: {
          name: { type: 'string', minLength: 2 },
          description: { type: 'string' },
          cpuMax: { type: 'integer', minimum: 15 },
          memoryMax: { type: 'integer', minimum: 128 },
          diskMax: { type: 'integer', minimum: 512 },
          bandwidthMax: { type: 'integer' },
          networkMode: { type: 'string', enum: ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_only', 'ipv6_nat'] },
          instanceType: { type: 'string', enum: ['container', 'vm'] },
          hostIds: { type: 'array', items: { type: 'integer' }, minItems: 1 },
          hostStoragePools: {
            type: 'object',
            additionalProperties: { type: ['string', 'null'] }
          },
          hostTrafficMultipliers: {
            type: 'object',
            additionalProperties: { type: ['number', 'string', 'null'] }
          },
          privileged: { type: 'boolean' },
          nested: { type: 'boolean' },
          active: { type: 'boolean' },
          monthlyTrafficLimit: { type: 'string' },
          portLimit: { type: 'integer', minimum: 1 },
          snapshotLimit: { type: 'integer', minimum: 0 },
          backupLimit: { type: 'integer', minimum: 0 },
          siteLimit: { type: 'integer', minimum: 0 },
          // 存储 I/O 限制
          ioLimitMode: { type: 'string', enum: ['throughput', 'iops'] },
          limitsRead: { type: 'string' },
          limitsWrite: { type: 'string' },
          limitsReadIops: { type: 'integer', minimum: 0 },
          limitsWriteIops: { type: 'integer', minimum: 0 },
          // 网络限制
          limitsIngress: { type: 'string' },
          limitsEgress: { type: 'string' },
          // 进程与调度
          limitsProcesses: { type: 'integer', minimum: 0 },
          limitsCpuPriority: { type: 'integer', minimum: 0, maximum: 10 },
          // 启动配置
          bootAutostart: { type: 'boolean' },
          bootAutostartPriority: { type: 'integer', minimum: 0, maximum: 100 },
          bootAutostartDelay: { type: 'integer', minimum: 5, maximum: 600 },
          bootHostShutdownTimeout: { type: 'integer', minimum: 30, maximum: 600 },
          // 全局共享配置
          globalShared: { type: 'boolean' },
          globalQuotaMultiplier: { type: ['number', 'null'] },
          globalMaxInstances: { type: ['integer', 'null'] },
          requiredPackageId: { type: ['integer', 'null'], minimum: 1 },
          // 实例操作权限
          allowInstanceDeletion: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: CreatePackageRequest }>, reply: FastifyReply) => {
    let packageInput: NormalizedPackageInput
    try {
      packageInput = normalizePackageInput(request.body, { requireAll: true })
    } catch (error) {
      return reply.code(400).send(error)
    }
    const {
      name, description, cpuMax, memoryMax, diskMax, bandwidthMax, networkMode, instanceType, hostIds, privileged, nested, active,
      monthlyTrafficLimit, portLimit, snapshotLimit, backupLimit, siteLimit,
      ioLimitMode, limitsRead, limitsWrite, limitsReadIops, limitsWriteIops,
      limitsIngress, limitsEgress, limitsProcesses, limitsCpuPriority,
      bootAutostart, bootAutostartPriority, bootHostShutdownTimeout,
      globalShared, globalMaxInstances, hostStoragePools, hostTrafficMultipliers, requiredPackageId
    } = packageInput

    // 验证必须至少绑定一个宿主机
    if (!hostIds || hostIds.length === 0) {
      return reply.code(400).send({ error: 'Package must bind at least one host', code: 'NO_HOSTS' })
    }

    // 验证套餐名称（防止危险字符注入）
    const packageNetworkModeError = validatePackageNetworkModeForInstanceType(instanceType, networkMode)
    if (packageNetworkModeError) {
      return reply.code(400).send({ error: packageNetworkModeError, code: 'KVM_NETWORK_MODE_UNSUPPORTED' })
    }

    // 检查名称是否已存在（同一用户下）
    const existing = await db.getPackageByUserAndName(request.user.id, name!)
    if (existing) {
      return reply.code(400).send({ error: 'Package name already exists', code: 'NAME_EXISTS' })
    }

    const prerequisiteValidation = await db.validatePackagePrerequisiteReferenceLocked(null, requiredPackageId, request.user.id)
    if (!prerequisiteValidation.valid) {
      return reply.code(400).send({ error: prerequisiteValidation.message, code: prerequisiteValidation.code })
    }
    if (globalShared && !validatePublicPackageMaxInstances(globalMaxInstances)) {
      return reply.code(400).send({
        error: '公开套餐最大实例数必须是 1-5 之间的整数',
        code: 'INVALID_MAX_INSTANCES'
      })
    }

    const trafficLimit = parseNullablePostgresBigIntInput(monthlyTrafficLimit)
    if (trafficLimit === undefined) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid monthly traffic limit'))
    }

    let id: number
    try {
      id = await db.createPackage({
        userId: request.user.id,  // 所有者为当前用户
        name: name!,
        description,
        cpuMax: cpuMax!,
        memoryMax: memoryMax!,
        diskMax: diskMax!,
        bandwidthMax,
        networkMode: networkMode || 'nat',
        instanceType: instanceType || 'container',
        hostIds,
        hostStoragePools,
        hostTrafficMultipliers,
        privileged,
        nested,
        active,
        portLimit,
        snapshotLimit,
        backupLimit,
        siteLimit,
        monthlyTrafficLimit: trafficLimit,
        // 存储 I/O 限制
        ioLimitMode,
        limitsRead,
        limitsWrite,
        limitsReadIops,
        limitsWriteIops,
        // 网络限制
        limitsIngress,
        limitsEgress,
        // 进程与调度
        limitsProcesses,
        limitsCpuPriority,
        // 启动配置
        bootAutostart,
        bootAutostartPriority,
        bootAutostartDelay: packageInput.bootAutostartDelay,
        bootHostShutdownTimeout,
        // 全局共享配置
        globalShared,
        globalQuotaMultiplier: null,
        globalMaxInstances: globalShared ? globalMaxInstances : null,
        requiredPackageId: requiredPackageId ?? null,
        // 实例操作权限不再暴露配置入口，新套餐默认允许删除
        allowInstanceDeletion: true
      }, request.user.role === 'admin')  // 管理员可以绑定任何节点
    } catch (error) {
      const prerequisiteError = getPackagePrerequisiteError(error)
      if (prerequisiteError) {
        return reply.code(400).send({ error: prerequisiteError.message, code: prerequisiteError.code })
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: errorMessage, code: 'INVALID_PACKAGE_CONFIG' })
    }

    // 注意：已取消配额限制，不再更新 packageUsed

    await createLog(request.user.id, 'package', 'package.create', `Created package "${name}" [CPU: ${cpuMax}%, Memory: ${memoryMax}MB, Disk: ${diskMax}MB, instanceType: ${instanceType || 'container'}, network: ${networkMode || 'nat'}, hosts: ${hostIds.join(',')}]`, 'success')

    reply.code(201).send({
      message: 'Package created',
      package: { id, name: name! }
    })
  })

  // 更新套餐（管理员或套餐所有者）
  fastify.patch<{
    Params: { id: string }
    Body: UpdatePackageRequest
  }>('/:id', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 2 },
          description: { type: 'string' },
          cpuMax: { type: 'integer', minimum: 15 },
          memoryMax: { type: 'integer', minimum: 128 },
          diskMax: { type: 'integer', minimum: 512 },
          bandwidthMax: { type: 'integer' },
          networkMode: { type: 'string', enum: ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_only', 'ipv6_nat'] },
          instanceType: { type: 'string', enum: ['container', 'vm'] },
          hostIds: { type: 'array', items: { type: 'integer' }, minItems: 1 },
          hostStoragePools: {
            type: 'object',
            additionalProperties: { type: ['string', 'null'] }
          },
          hostTrafficMultipliers: {
            type: 'object',
            additionalProperties: { type: ['number', 'string', 'null'] }
          },
          privileged: { type: 'boolean' },
          nested: { type: 'boolean' },
          active: { type: 'boolean' },
          monthlyTrafficLimit: { type: ['string', 'null'] },
          portLimit: { type: 'integer', minimum: 1 },
          snapshotLimit: { type: 'integer', minimum: 0 },
          backupLimit: { type: 'integer', minimum: 0 },
          siteLimit: { type: 'integer', minimum: 0 },
          // 存储 I/O 限制
          ioLimitMode: { type: 'string', enum: ['throughput', 'iops'] },
          limitsRead: { type: 'string' },
          limitsWrite: { type: 'string' },
          limitsReadIops: { type: 'integer', minimum: 0 },
          limitsWriteIops: { type: 'integer', minimum: 0 },
          // 网络限制
          limitsIngress: { type: 'string' },
          limitsEgress: { type: 'string' },
          // 进程与调度
          limitsProcesses: { type: 'integer', minimum: 0 },
          limitsCpuPriority: { type: 'integer', minimum: 0, maximum: 10 },
          // 启动配置
          bootAutostart: { type: 'boolean' },
          bootAutostartPriority: { type: 'integer', minimum: 0, maximum: 100 },
          bootAutostartDelay: { type: 'integer', minimum: 5, maximum: 600 },
          bootHostShutdownTimeout: { type: 'integer', minimum: 30, maximum: 600 },
          // 全局共享配置
          globalShared: { type: 'boolean' },
          globalQuotaMultiplier: { type: ['number', 'null'] },
          globalMaxInstances: { type: ['integer', 'null'] },
          requiredPackageId: { type: ['integer', 'null'], minimum: 1 },
          // 实例操作权限
          allowInstanceDeletion: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: UpdatePackageRequest
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const packageId = parsePositiveRouteId(id)

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }

    // 权限检查：只有管理员或套餐所有者可以更新
    if (pkg.user_id !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    let packageInput: NormalizedPackageInput
    try {
      packageInput = normalizePackageInput(request.body, { requireAll: false })
    } catch (error) {
      return reply.code(400).send(error)
    }

    // 如果更新名称，检查是否冲突（同一用户下）
    if (packageInput.name && packageInput.name !== pkg.name) {
      const existing = await db.getPackageByUserAndName(pkg.user_id!, packageInput.name)
      if (existing) {
        return reply.code(400).send({ error: 'Package name already exists', code: 'NAME_EXISTS' })
      }
    }

    // 处理流量限额和套餐资源限制
    const {
      monthlyTrafficLimit, portLimit, snapshotLimit, backupLimit, siteLimit, hostIds, hostStoragePools, hostTrafficMultipliers,
      ioLimitMode, limitsRead, limitsWrite, limitsReadIops, limitsWriteIops,
      limitsIngress, limitsEgress, limitsProcesses, limitsCpuPriority,
      bootAutostart, bootAutostartPriority, bootAutostartDelay, bootHostShutdownTimeout,
      globalShared, globalQuotaMultiplier, globalMaxInstances,
      requiredPackageId
    } = packageInput
    const updateData: Parameters<typeof db.updatePackage>[1] = {}
    if (packageInput.name !== undefined) updateData.name = packageInput.name
    if (packageInput.description !== undefined) updateData.description = packageInput.description
    if (packageInput.cpuMax !== undefined) updateData.cpuMax = packageInput.cpuMax
    if (packageInput.memoryMax !== undefined) updateData.memoryMax = packageInput.memoryMax
    if (packageInput.diskMax !== undefined) updateData.diskMax = packageInput.diskMax
    if (packageInput.bandwidthMax !== undefined) updateData.bandwidthMax = packageInput.bandwidthMax
    if (packageInput.networkMode !== undefined) updateData.networkMode = packageInput.networkMode
    if (packageInput.instanceType !== undefined) updateData.instanceType = packageInput.instanceType
    if (packageInput.privileged !== undefined) updateData.privileged = packageInput.privileged
    if (packageInput.nested !== undefined) updateData.nested = packageInput.nested
    if (packageInput.active !== undefined) updateData.active = packageInput.active
    updateData.allowInstanceDeletion = true
    const nextInstanceType = packageInput.instanceType ?? pkg.instance_type ?? 'container'
    const nextNetworkMode = packageInput.networkMode ?? pkg.network_mode ?? 'nat'

    const packageNetworkModeError = validatePackageNetworkModeForInstanceType(nextInstanceType, nextNetworkMode)
    if (packageNetworkModeError) {
      return reply.code(400).send({ error: packageNetworkModeError, code: 'KVM_NETWORK_MODE_UNSUPPORTED' })
    }

    // 如果提供了 hostIds，验证必须至少绑定一个宿主机
    if (hostIds !== undefined) {
      if (hostIds.length === 0) {
        return reply.code(400).send({ error: 'Package must bind at least one host', code: 'NO_HOSTS' })
      }
      updateData.hostIds = hostIds
    }
    if (hostStoragePools !== undefined) updateData.hostStoragePools = hostStoragePools
    if (hostTrafficMultipliers !== undefined) updateData.hostTrafficMultipliers = hostTrafficMultipliers

    let parsedMonthlyTrafficLimit: bigint | null | undefined
    if (monthlyTrafficLimit !== undefined) {
      parsedMonthlyTrafficLimit = parseNullablePostgresBigIntInput(monthlyTrafficLimit)
      if (parsedMonthlyTrafficLimit === undefined) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid monthly traffic limit'))
      }
      updateData.monthlyTrafficLimit = parsedMonthlyTrafficLimit
    }
    if (portLimit !== undefined) updateData.portLimit = portLimit
    if (snapshotLimit !== undefined) updateData.snapshotLimit = snapshotLimit
    if (backupLimit !== undefined) updateData.backupLimit = backupLimit
    if (siteLimit !== undefined) updateData.siteLimit = siteLimit

    // 存储 I/O 限制
    if (ioLimitMode !== undefined) updateData.ioLimitMode = ioLimitMode
    if (limitsRead !== undefined) updateData.limitsRead = limitsRead
    if (limitsWrite !== undefined) updateData.limitsWrite = limitsWrite
    if (limitsReadIops !== undefined) updateData.limitsReadIops = limitsReadIops
    if (limitsWriteIops !== undefined) updateData.limitsWriteIops = limitsWriteIops

    // 网络限制
    if (limitsIngress !== undefined) updateData.limitsIngress = limitsIngress
    if (limitsEgress !== undefined) updateData.limitsEgress = limitsEgress

    // 进程与调度
    if (limitsProcesses !== undefined) updateData.limitsProcesses = limitsProcesses
    if (limitsCpuPriority !== undefined) updateData.limitsCpuPriority = limitsCpuPriority

    // 启动配置
    if (bootAutostart !== undefined) updateData.bootAutostart = bootAutostart
    if (bootAutostartPriority !== undefined) updateData.bootAutostartPriority = bootAutostartPriority
    if (bootAutostartDelay !== undefined) updateData.bootAutostartDelay = bootAutostartDelay
    if (bootHostShutdownTimeout !== undefined) updateData.bootHostShutdownTimeout = bootHostShutdownTimeout
    
    // 验证全局共享配置的数值有效性（Fastify schema 已经验证，这里做额外检查以防万一）
    const currentGlobalShared = (pkg as any).global_shared ?? false
    if (globalShared !== undefined) {
      updateData.globalShared = globalShared
      // 如果 globalShared 被设置为 false，确保相关字段为 null
      if (globalShared === false) {
        updateData.globalQuotaMultiplier = null
        updateData.globalMaxInstances = null
      }
    }
    
    // 只有在 globalShared 不为 false 时才处理这两个字段
    // 如果 globalShared 未提供，但当前套餐是全局共享的，允许更新这两个字段
    const willBeGlobalShared = globalShared !== undefined ? globalShared : currentGlobalShared
    if (willBeGlobalShared !== false) {
      updateData.globalQuotaMultiplier = null
      const nextMaxInstances = globalMaxInstances !== undefined
        ? globalMaxInstances
        : normalizePublicPackageMaxInstances((pkg as any).global_max_instances)
      if (!validatePublicPackageMaxInstances(nextMaxInstances)) {
        return reply.code(400).send({
          error: '公开套餐最大实例数必须是 1-5 之间的整数',
          code: 'INVALID_MAX_INSTANCES'
        })
      }
      updateData.globalMaxInstances = nextMaxInstances
    } else if ((globalQuotaMultiplier !== undefined || globalMaxInstances !== undefined) && globalShared === undefined) {
      // 如果当前套餐不是全局共享的，但用户试图更新这些字段，应该拒绝
      return reply.code(400).send({ 
        error: 'Cannot update globalQuotaMultiplier or globalMaxInstances when globalShared is false', 
        code: 'INVALID_GLOBAL_SHARED_STATE' 
      })
    }

    if (requiredPackageId !== undefined) {
      const prerequisiteValidation = await db.validatePackagePrerequisiteReferenceLocked(packageId, requiredPackageId, pkg.user_id!)
      if (!prerequisiteValidation.valid) {
        return reply.code(400).send({ error: prerequisiteValidation.message, code: prerequisiteValidation.code })
      }
      updateData.requiredPackageId = requiredPackageId
    }

    try {
      const shouldSyncTrafficLimits = await shouldSyncPackageTrafficLimitsAfterUpdate(packageId, pkg, {
        monthlyTrafficLimit: parsedMonthlyTrafficLimit,
        hostIds,
        hostTrafficMultipliers
      })
      await db.updatePackage(packageId, updateData, request.user.role === 'admin')  // 管理员可以绑定任何节点
      if (shouldSyncTrafficLimits) {
        const syncResult = await db.syncPackageTrafficLimitsToInstances(packageId)
        if (syncResult.instanceIds.length > 0) {
          try {
            const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
            await reconcileTrafficStateForInstanceIds(syncResult.instanceIds)
          } catch (err) {
            request.log.warn(err, '套餐流量限额已同步，流量状态即时复核失败')
          }
        }
      }
    } catch (error) {
      const prerequisiteError = getPackagePrerequisiteError(error)
      if (prerequisiteError) {
        return reply.code(400).send({ error: prerequisiteError.message, code: prerequisiteError.code })
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: errorMessage, code: 'INVALID_PACKAGE_CONFIG' })
    }


    // 构建变更详情
    const pkgChanges: string[] = []
    if (packageInput.name && packageInput.name !== pkg.name) pkgChanges.push(`name -> "${packageInput.name}"`)
    if (packageInput.cpuMax !== undefined) pkgChanges.push(`cpuMax -> ${packageInput.cpuMax}%`)
    if (packageInput.memoryMax !== undefined) pkgChanges.push(`memoryMax -> ${packageInput.memoryMax}MB`)
    if (packageInput.diskMax !== undefined) pkgChanges.push(`diskMax -> ${packageInput.diskMax}MB`)
    if (packageInput.instanceType) pkgChanges.push(`instanceType -> ${packageInput.instanceType}`)
    if (packageInput.active !== undefined) pkgChanges.push(`active -> ${packageInput.active}`)
    if (hostIds !== undefined) pkgChanges.push(`hosts -> [${hostIds.join(',')}]`)

    await createLog(request.user.id, 'package', 'package.update', `Updated package "${pkg.name}" [${pkgChanges.length > 0 ? pkgChanges.join(', ') : 'minor changes'}]`, 'success')

    return { message: 'Package updated' }
  })

  // 删除套餐（管理员或套餐所有者）
  fastify.delete<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }  // 高危操作，更严格限制
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const packageId = parsePositiveRouteId(id)

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }

    // 权限检查：只有管理员或套餐所有者可以删除
    if (pkg.user_id !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const dependentPackages = await db.getPackagesDependingOnPackage(packageId)
    if (dependentPackages.length > 0) {
      return reply.code(400).send({
        error: `Package is required by other packages: ${dependentPackages.map(p => p.name).join(', ')}`,
        code: 'PACKAGE_PREREQUISITE_IN_USE',
        details: `请先删除后置套餐：${dependentPackages.map(p => p.name).join('、')}`
      })
    }

    // 检查是否有实例使用此套餐
    const instanceCount = await db.getInstanceCountByPackage(packageId)
    if (instanceCount > 0) {
      return reply.code(400).send(apiError(ErrorCode.PACKAGE_HAS_INSTANCES, `${instanceCount}`))
    }

    // 删除套餐会自动删除所有共享记录（级联删除）
    await db.deletePackage(packageId)

    // 更新套餐配额使用量（减少）
    const { decrementUserQuotaUsed } = await import('../db/quota-operations.js')
    await decrementUserQuotaUsed(request.user.id, 'package')

    await createLog(request.user.id, 'package', 'package.delete', `Deleted package "${pkg.name}" [CPU: ${pkg.cpu_max}%, Memory: ${pkg.memory_max}MB]`, 'success')

    return { message: 'Package deleted' }
  })

  // ==================== 套餐共享 API（已禁用 - 好友系统已移除） ====================

  // 共享套餐给好友
  fastify.post<{
    Params: { id: string }
    Body: { friendId: number; quotaMultiplier?: number | null; maxInstances?: number | null }
  }>('/:id/share', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply: FastifyReply) => {
    const { id } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)
    let shareInput: NormalizedPackageShareInput
    try {
      shareInput = normalizePackageShareInput(request.body, { requireFriendId: true })
    } catch (error) {
      return reply.code(400).send(error)
    }
    const { friendId, quotaMultiplier, maxInstances } = shareInput

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取套餐并验证所有权
    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }
    if (pkg.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 验证好友关系
    const areFriends = await db.areFriends(user.id, friendId!)
    if (!areFriends) {
      return reply.code(400).send(apiError(ErrorCode.NOT_FRIENDS))
    }

    // 检查是否已共享
    const existingShare = await packageShares.isPackageSharedTo(packageId, friendId!)
    if (existingShare) {
      return reply.code(400).send(apiError(ErrorCode.PACKAGE_ALREADY_SHARED))
    }

    // 创建共享
    const shareId = await packageShares.sharePackage(packageId, user.id, friendId!, quotaMultiplier, maxInstances)
    return { success: true, shareId }
  })

  // 取消套餐共享
  fastify.delete<{
    Params: { id: string; userId: string }
  }>('/:id/share/:userId', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply: FastifyReply) => {
    const { id, userId } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)
    const targetUserId = parsePositiveRouteId(userId)

    if (!packageId || !targetUserId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取套餐并验证所有权
    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }
    if (pkg.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 取消共享
    const success = await packageShares.unsharePackage(packageId, targetUserId)
    return { success }
  })

  // 修改共享配额限制
  fastify.patch<{
    Params: { id: string; shareId: string }
    Body: { quotaMultiplier?: number | null; maxInstances?: number | null }
  }>('/:id/shares/:shareId', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply: FastifyReply) => {
    const { id, shareId } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)
    const shareIdNum = parsePositiveRouteId(shareId)
    let shareInput: NormalizedPackageShareInput
    try {
      shareInput = normalizePackageShareInput(request.body, { requireFriendId: false })
    } catch (error) {
      return reply.code(400).send(error)
    }
    const { quotaMultiplier, maxInstances } = shareInput

    if (!packageId || !shareIdNum) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取套餐并验证所有权
    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }
    if (pkg.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 更新共享配额
    const success = await packageShares.updateShareQuota(shareIdNum, packageId, quotaMultiplier, maxInstances)
    if (!success) {
      return reply.code(404).send(apiError(ErrorCode.SHARE_NOT_FOUND))
    }
    return { success: true }
  })

  // 获取套餐的共享列表
  fastify.get<{ Params: { id: string } }>('/:id/shares', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply: FastifyReply) => {
    const { id } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取套餐并验证所有权
    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }
    if (pkg.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取共享列表
    const shares = await packageShares.getPackageShares(packageId)
    return { shares }
  })

  // 获取用户共享出去的所有套餐
  fastify.get('/my-shares', {
    onRequest: [fastify.authenticateUser]
  }, async (request) => {
    const { user } = request
    const shares = await packageShares.getSharedByUser(user.id)
    return { shares }
  })

  // ==================== 资源释放功能 ====================

  // 获取套餐绑定的宿主机详情（用于释放配额界面）
  fastify.get<{ Params: { id: string } }>('/:id/hosts-detail', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }
    if (pkg.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const hosts = await db.getPackageHostsDetail(packageId)

    return {
      hosts,
      packageName: pkg.name,
      cpuMax: pkg.cpu_max,
      memoryMax: pkg.memory_max
    }
  })

  // 获取套餐所有者的托管信息（用于创建实例页面显示托管者详情）
  fastify.get<{ Params: { id: string } }>('/:id/owner-info', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }

    // 套餐必须有所有者，且必须是普通用户的托管套餐
    if (!pkg.user_id) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '该套餐不是托管套餐'))
    }

    if (pkg.user_id !== user.id && await db.isUserBlockedFromPackage(user.id, packageId)) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const owner = await prisma.user.findUnique({
      where: { id: pkg.user_id },
      select: {
        id: true,
        username: true,
        email: true,
        avatarStyle: true,
        avatarBadgeId: true,
        createdAt: true,
        role: true
      }
    })

    if (!owner || !owner.email || owner.role === 'admin') {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND, '该套餐不是托管套餐'))
    }

    // 获取所有者详细信息
    const [hostCount, instanceCount, totalHostingIncome] = await Promise.all([
      // 该用户持有的托管节点数
      prisma.host.count({
        where: { userId: pkg.user_id }
      }),
      // 该用户托管节点的总实例数（不含已删除）
      prisma.instance.count({
        where: {
          host: { userId: pkg.user_id },
          status: { not: 'deleted' }
        }
      }),
      // 计算历史托管总收入（用于VIP等级）
      prisma.hostingBalanceLog.aggregate({
        where: {
          userId: pkg.user_id,
          type: 'income'  // 只计算收入记录
        },
        _sum: { amount: true }
      })
    ])

    // 计算注册天数
    const registeredDays = Math.floor((Date.now() - owner.createdAt.getTime()) / (1000 * 60 * 60 * 24))

    // 计算VIP等级（基于后台配置的托管 VIP 规则）
    const totalIncome = Number(totalHostingIncome._sum.amount || 0)
    const vipRules = await getVipRules('hosting')
    const vipLevel = calculateVipLevel('hosting', vipRules, {
      totalHostingIncome: totalIncome,
      instanceCount
    })
    const vipBadgeStyle = getVipBadgeStyleForLevel(vipRules, 'hosting', vipLevel)

    return {
      id: owner.id,
      username: owner.username,
      email: owner.email,
      avatarStyle: owner.avatarStyle,
      avatarBadgeId: owner.avatarBadgeId,
      hostCount,
      instanceCount,
      registeredDays,
      vipLevel,
      vipBadgeStyle
    }
  })


  // 释放配额
  fastify.post<{
    Params: { id: string }
    Body: {
      hostIds: number[]
      cpuAdd: number
      memoryAdd: number
      notify?: boolean
    }
  }>('/:id/release-quota', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },  // 修改资源配额，严格限制
    schema: {
      body: {
        type: 'object',
        required: ['hostIds', 'cpuAdd', 'memoryAdd'],
        properties: {
          hostIds: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 100 },
          cpuAdd: { type: 'integer', minimum: 0, maximum: 10000 },
          memoryAdd: { type: 'integer', minimum: 0, maximum: 1048576 },
          notify: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      hostIds: number[]
      cpuAdd: number
      memoryAdd: number
      notify?: boolean
    }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const { hostIds, cpuAdd, memoryAdd, notify } = request.body
    const { user } = request
    const packageId = parsePositiveRouteId(id)

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证至少有一个配额大于 0
    if (cpuAdd <= 0 && memoryAdd <= 0) {
      return reply.code(400).send({ error: 'At least one quota must be greater than 0' })
    }

    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }
    if (pkg.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 验证所有 hostIds 都属于该套餐
    const packageHostIds = pkg.host_ids || []
    const invalidHosts = hostIds.filter(hid => !packageHostIds.includes(hid))
    if (invalidHosts.length > 0) {
      return reply.code(400).send({ error: 'Some hosts are not bound to this package' })
    }

    // 为每个宿主机增加配额
    const results: Array<{
      hostId: number
      hostName: string
      countryCode: string
      cpuAllowanceMax: number
      memoryMax: number
      cpuAvailable: number
      memoryAvailable: number
    }> = []

    for (const hostId of hostIds) {
      const host = await db.getHostById(hostId)
      if (!host) continue

      const updated = await db.increaseHostQuota(hostId, cpuAdd, memoryAdd)
      results.push({
        hostId: host.id,
        hostName: host.name,
        countryCode: host.country_code || 'us',
        cpuAllowanceMax: updated.cpuAllowanceMax,
        memoryMax: updated.memoryMax,
        cpuAvailable: updated.cpuAllowanceMax - (host.cpu_used || 0),
        memoryAvailable: updated.memoryMax - (host.memory_used || 0)
      })
    }

    // 记录日志
    await createLog(
      user.id,
      'package',
      'package.release_quota',
      `Released quota for package "${pkg.name}": CPU +${cpuAdd}%, Memory +${memoryAdd}MB on ${hostIds.length} host(s)`,
      'success'
    )

    // 发送通知（仅当 notify=true 且全局渠道存在时）
    if (notify) {
      const globalChannel = await prisma.notificationChannel.findFirst({
        where: { isGlobal: true },
        select: { id: true }
      })
      if (globalChannel) {
        // 构建通知消息
        const hostDetails = results.map(r => 
          `• ${r.hostName.toUpperCase()}: CPU ${r.cpuAvailable}% | 内存 ${formatMemory(r.memoryAvailable)}`
        ).join('\n')

        const notifyTitle = `📦 资源释放 - ${pkg.name}`
        // 判断套餐来源：管理员创建的套餐为 official，普通用户创建的为 market
        const pkgOwner = await prisma.user.findUnique({ where: { id: pkg.user_id }, select: { role: true } })
        const pkgSource = pkgOwner?.role === 'admin' ? 'official' : 'market'
        const buyLink = process.env.SITE_URL
          ? { label: '🛒 立即开通', url: `${process.env.SITE_URL}/instances/create?source=${pkgSource}&package=${packageId}` }
          : undefined
        const notifyMessage = [
          `+${cpuAdd}% CPU / +${formatMemory(memoryAdd)} 内存`,
          '',
          '当前可用配额：',
          hostDetails,
          '',
          `⏰ ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
        ].join('\n')

        try {
          await sendToChannel(globalChannel.id, notifyTitle, notifyMessage, buyLink)
        } catch {
          // 通知发送失败不影响主流程
        }
      }
    }

    return {
      message: 'Quota released successfully',
      results
    }
  })

  // ==================== 套餐方案管理 API ====================

  // 获取套餐下的所有方案
  fastify.get<{ Params: { id: string }; Querystring: { activeOnly?: string } }>('/:id/plans', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { activeOnly?: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)
    const activeOnly = request.query.activeOnly === 'true'

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }

    if (pkg.user_id !== user.id && user.role !== 'admin') {
      const canAccess = await packageShares.canUserAccessPackage(user.id, packageId)
      if (!canAccess) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }
    }

    const plans = await db.getPlansByPackageId(packageId, { activeOnly })

    return {
      plans: plans.map(plan => ({
        id: plan.id,
        name: plan.name,
        description: plan.description,
        cpu: plan.cpu,
        memory: plan.memory,
        disk: plan.disk,
        portLimit: plan.portLimit,
        snapshotLimit: plan.snapshotLimit,
        backupLimit: plan.backupLimit,
        siteLimit: plan.siteLimit,
        swapSize: pkg.instance_type === 'vm' ? 0 : plan.swapSize,
        trafficLimit: plan.trafficLimit.toString(),
        trafficLimitSpeed: plan.trafficLimitSpeed,
        price: Number(plan.price),
        billingCycle: plan.billingCycle,
        setupFee: Number(plan.setupFee),
        monthlyPrice: db.calculateMonthlyPrice(plan),
        isActive: plan.isActive,
        isSoldOut: plan.isSoldOut,
        sortOrder: plan.sortOrder,
        slaGuarantee: plan.slaGuarantee ? Number(plan.slaGuarantee) : null
      }))
    }
  })

  // 创建套餐方案
  fastify.post<{
    Params: { id: string }
    Body: {
      name: string
      description?: string
      cpu: number
      memory: number
      disk: number
      portLimit: number
      snapshotLimit: number
      backupLimit: number
      siteLimit: number
      swapSize: number
      trafficLimit: string // BigInt 作为字符串传输
      trafficLimitSpeed?: string
      price: number
      billingCycle?: number
      setupFee?: number
      isActive?: boolean
      isSoldOut?: boolean
      sortOrder?: number
      slaGuarantee?: number | null
    }
  }>('/:id/plans', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { id } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)

    if (!packageId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证套餐存在且属于当前用户
    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }
    if (pkg.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    let planInput: NormalizedPackagePlanInput
    try {
      planInput = normalizePackagePlanInput(request.body, {
        requireAll: true,
        isVm: pkg.instance_type === 'vm'
      })
    } catch (error) {
      return reply.code(400).send(error)
    }
    const planName = planInput.name!

    // 验证名称唯一性
    const isUnique = await db.isPlanNameUnique(packageId, planName)
    if (!isUnique) {
      return reply.code(400).send({ error: '该套餐下已存在同名方案' })
    }

    // 用户托管节点的方案只能按月计费
    if (user.role !== 'admin') {
      const actualBillingCycle = planInput.billingCycle ?? 1
      if (actualBillingCycle !== 1) {
        return reply.code(400).send({
          error: '用户托管节点的方案仅支持按月计费',
          code: 'HOSTING_MONTHLY_ONLY'
        })
      }
    }

    try {
      const parsedTrafficLimit = parseRequiredPostgresBigIntInput(planInput.trafficLimit)
      if (parsedTrafficLimit === undefined) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid plan traffic limit'))
      }
      let normalizedTrafficLimitSpeed: string | undefined
      if (planInput.trafficLimitSpeed !== undefined) {
        const parsedTrafficLimitSpeed = normalizePlanTrafficLimitSpeed(planInput.trafficLimitSpeed)
        if (parsedTrafficLimitSpeed === undefined) {
          return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid plan traffic limit speed'))
        }
        normalizedTrafficLimitSpeed = parsedTrafficLimitSpeed ?? '0'
      }

      const plan = await db.createPlan({
        packageId,
        name: planName,
        description: planInput.description,
        cpu: planInput.cpu!,
        memory: planInput.memory!,
        disk: planInput.disk!,
        portLimit: planInput.portLimit!,
        snapshotLimit: planInput.snapshotLimit!,
        backupLimit: planInput.backupLimit!,
        siteLimit: planInput.siteLimit!,
        swapSize: planInput.swapSize!,
        trafficLimit: parsedTrafficLimit,
        trafficLimitSpeed: normalizedTrafficLimitSpeed,
        price: planInput.price!,
        billingCycle: planInput.billingCycle,
        setupFee: 0,  // 开通费固定为0
        isActive: planInput.isActive,
        isSoldOut: planInput.isSoldOut,
        sortOrder: planInput.sortOrder,
        slaGuarantee: planInput.slaGuarantee
      })

      await createLog(
        user.id,
        'package',
        'plan.create',
        `Created plan "${planName}" for package "${pkg.name}"`,
        'success'
      )

      return {
        id: plan.id,
        name: plan.name,
        message: '方案创建成功'
      }
    } catch (error) {
      return reply.code(500).send({ error: '创建方案失败' })
    }
  })

  // 更新套餐方案
  fastify.put<{
    Params: { id: string; planId: string }
    Body: {
      name?: string
      description?: string
      cpu?: number
      memory?: number
      disk?: number
      portLimit?: number
      snapshotLimit?: number
      backupLimit?: number
      siteLimit?: number
      swapSize?: number
      trafficLimit?: string
      trafficLimitSpeed?: string
      price?: number
      billingCycle?: number
      setupFee?: number
      isActive?: boolean
      isSoldOut?: boolean
      sortOrder?: number
      slaGuarantee?: number | null
    }
  }>('/:id/plans/:planId', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { id, planId } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)
    const planIdNum = parsePositiveRouteId(planId)

    if (!packageId || !planIdNum) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证套餐存在且属于当前用户
    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }
    if (pkg.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 验证方案存在且属于该套餐
    const existingPlan = await db.getPlanById(planIdNum)
    if (!existingPlan || existingPlan.packageId !== packageId) {
      return reply.code(404).send({ error: '方案不存在' })
    }

    let planInput: NormalizedPackagePlanInput
    try {
      planInput = normalizePackagePlanInput(request.body, {
        requireAll: false,
        isVm: pkg.instance_type === 'vm'
      })
    } catch (error) {
      return reply.code(400).send(error)
    }
    const planName = planInput.name

    // 如果修改了名称，验证唯一性
    if (planName !== undefined && planName !== existingPlan.name) {
      const isUnique = await db.isPlanNameUnique(packageId, planName, planIdNum)
      if (!isUnique) {
        return reply.code(400).send({ error: '该套餐下已存在同名方案' })
      }
    }

    // 用户托管节点的方案只能按月计费
    if (user.role !== 'admin' && planInput.billingCycle !== undefined && planInput.billingCycle !== 1) {
      return reply.code(400).send({
        error: '用户托管节点的方案仅支持按月计费',
        code: 'HOSTING_MONTHLY_ONLY'
      })
    }

    try {
      const updateData: any = {}
      if (planName !== undefined) updateData.name = planName
      if (planInput.description !== undefined) updateData.description = planInput.description
      if (planInput.cpu !== undefined) updateData.cpu = planInput.cpu
      if (planInput.memory !== undefined) updateData.memory = planInput.memory
      if (planInput.disk !== undefined) updateData.disk = planInput.disk
      if (planInput.portLimit !== undefined) updateData.portLimit = planInput.portLimit
      if (planInput.snapshotLimit !== undefined) updateData.snapshotLimit = planInput.snapshotLimit
      if (planInput.backupLimit !== undefined) updateData.backupLimit = planInput.backupLimit
      if (planInput.siteLimit !== undefined) updateData.siteLimit = planInput.siteLimit
      if (pkg.instance_type === 'vm') {
        updateData.swapSize = 0
      } else if (planInput.swapSize !== undefined) {
        updateData.swapSize = planInput.swapSize
      }
      if (planInput.trafficLimit !== undefined) {
        const parsedTrafficLimit = parseRequiredPostgresBigIntInput(planInput.trafficLimit)
        if (parsedTrafficLimit === undefined) {
          return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid plan traffic limit'))
        }
        updateData.trafficLimit = parsedTrafficLimit
      }
      if (planInput.trafficLimitSpeed !== undefined) {
        const parsedTrafficLimitSpeed = normalizePlanTrafficLimitSpeed(planInput.trafficLimitSpeed)
        if (parsedTrafficLimitSpeed === undefined) {
          return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid plan traffic limit speed'))
        }
        updateData.trafficLimitSpeed = parsedTrafficLimitSpeed ?? '0'
      }
      if (planInput.price !== undefined) updateData.price = planInput.price
      if (planInput.billingCycle !== undefined) updateData.billingCycle = planInput.billingCycle
      // setupFee 已废弃，不再接受更新
      if (planInput.isActive !== undefined) updateData.isActive = planInput.isActive
      if (planInput.isSoldOut !== undefined) updateData.isSoldOut = planInput.isSoldOut
      if (planInput.sortOrder !== undefined) updateData.sortOrder = planInput.sortOrder
      if (planInput.slaGuarantee !== undefined) updateData.slaGuarantee = planInput.slaGuarantee

      const updatedPlan = await db.updatePlan(planIdNum, updateData)

      // 如果修改了配额相关字段，同步到所有关联实例
      const quotaFields = ['portLimit', 'snapshotLimit', 'backupLimit', 'siteLimit', 'swapSize', 'trafficLimit']
      const hasQuotaChange = quotaFields.some(f => updateData[f] !== undefined)
      if (hasQuotaChange) {
        const syncResult = await db.syncPlanQuotaToInstances(planIdNum, updatedPlan, existingPlan.swapSize)
        if (syncResult.count > 0) {
          if (syncResult.instanceIds.length > 0) {
            try {
              const { reconcileTrafficStateForInstanceIds } = await import('../services/traffic-scheduler.js')
              await reconcileTrafficStateForInstanceIds(syncResult.instanceIds)
            } catch (err) {
              request.log.warn(err, '方案配额已同步，流量状态即时复核失败')
            }
          }
          await createLog(
            user.id,
            'package',
            'plan.sync_quota',
            `Synced quota to ${syncResult.count} instance(s) for plan "${updatedPlan.name}"`,
            'success'
          )
        }
      }

      await createLog(
        user.id,
        'package',
        'plan.update',
        `Updated plan "${updatedPlan.name}" for package "${pkg.name}"`,
        'success'
      )

      return {
        id: updatedPlan.id,
        name: updatedPlan.name,
        message: '方案更新成功'
      }
    } catch (error) {
      return reply.code(500).send({ error: '更新方案失败' })
    }
  })

  // 删除套餐方案
  fastify.delete<{ Params: { id: string; planId: string } }>('/:id/plans/:planId', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }  // 删除操作，更严格限制
  }, async (request, reply) => {
    const { id, planId } = request.params
    const { user } = request
    const packageId = parsePositiveRouteId(id)
    const planIdNum = parsePositiveRouteId(planId)

    if (!packageId || !planIdNum) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证套餐存在且属于当前用户
    const pkg = await db.getPackageById(packageId)
    if (!pkg) {
      return reply.code(404).send(apiError(ErrorCode.PACKAGE_NOT_FOUND))
    }
    if (pkg.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 验证方案存在且属于该套餐
    const existingPlan = await db.getPlanById(planIdNum)
    if (!existingPlan || existingPlan.packageId !== packageId) {
      return reply.code(404).send({ error: '方案不存在' })
    }

    // 检查是否可以删除
    const canDelete = await db.canDeletePlan(planIdNum)
    if (!canDelete.canDelete) {
      return reply.code(400).send({ error: canDelete.reason })
    }

    try {
      await db.deletePlan(planIdNum)

      await createLog(
        user.id,
        'package',
        'plan.delete',
        `Deleted plan "${existingPlan.name}" from package "${pkg.name}"`,
        'success'
      )

      return { message: '方案删除成功' }
    } catch (error) {
      return reply.code(500).send({ error: '删除方案失败' })
    }
  })

  // 获取可用地区列表（拥有付费方案的公开套餐所在的国家/地区）
  fastify.get<{
    Querystring: { source?: 'official' | 'market' | 'friends' | 'zone'; zoneId?: string }
  }>('/regions', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { source = 'official' } = request.query
    const user = request.user
    
    // 好友共享需要特殊处理：从好友共享套餐中提取地区
    if (source === 'friends') {
      // 获取好友共享给当前用户的套餐
      const friendPackages = await packageShares.getSharedToUser(user.id)
      
      if (friendPackages.length === 0) {
        return { regions: [] }
      }
      
      // 获取这些套餐绑定的宿主机信息
      const hostIds = [...new Set(friendPackages.flatMap(p => p.hostIds))]
      const hosts = await db.prisma.host.findMany({
        where: {
          id: { in: hostIds },
          status: 'online'
        },
        select: {
          id: true,
          countryCode: true,
          packageHosts: {
            select: { packageId: true }
          }
        }
      })
      
      // 按国家分组统计套餐数量
      const regionPackages = new Map<string, Set<number>>()
      const friendPackageIds = new Set(friendPackages.map(p => p.id))
      
      for (const host of hosts) {
        const countryCode = (host.countryCode || 'us').toLowerCase()
        for (const ph of host.packageHosts) {
          // 只统计属于好友共享的套餐
          if (!friendPackageIds.has(ph.packageId)) continue
          
          if (!regionPackages.has(countryCode)) {
            regionPackages.set(countryCode, new Set())
          }
          regionPackages.get(countryCode)!.add(ph.packageId)
        }
      }
      
      const regions = Array.from(regionPackages.entries()).map(([code, packageIds]) => ({
        code,
        name: getCountryName(code),
        packageCount: packageIds.size,
        packageIds: Array.from(packageIds)
      }))
      
      regions.sort((a, b) => b.packageCount - a.packageCount)
      return { regions }
    }
    
    // 官方/托管市场/托管专区：使用统一公开套餐逻辑
    let whereCondition: any = {
      active: true,
      plans: {
        some: {
          isActive: true
        }
      }
    }
    
    if (source === 'official') {
      // 官方套餐：管理员创建的公开套餐（不再排除用户自己的，与套餐列表保持一致）
      whereCondition.globalShared = true
      whereCondition.user = { role: 'admin' }
    } else if (source === 'market') {
      // 托管市场：非管理员创建的公开套餐（不再排除用户自己的，与套餐列表保持一致）
      const blockerIds = await db.getBlockerIdsForUser(user.id)
      const zoneOwnerIds = await packageShares.getActiveHostingZoneOwnerIds()
      const excludedOwnerIds = Array.from(new Set([...blockerIds, ...zoneOwnerIds]))
      whereCondition.globalShared = true
      whereCondition.user = { role: { not: 'admin' } }
      if (excludedOwnerIds.length > 0) {
        whereCondition.userId = { notIn: excludedOwnerIds }
      }
    } else if (source === 'zone') {
      const zoneId = parseOptionalPositiveQueryInteger(request.query.zoneId)
      if (zoneId === null) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid hosting zone filter'))
      }
      if (zoneId === undefined) {
        return { regions: [] }
      }

      const zone = await packageShares.getActiveHostingZoneById(zoneId, user.id)
      if (!zone) {
        return { regions: [] }
      }

      whereCondition.globalShared = true
      whereCondition.userId = zone.ownerId
      whereCondition.user = { role: { not: 'admin' } }
    }
    
    // 1. 获取所有有活跃方案的套餐，并包含它们绑定的宿主机信息
    const packagesWithPlans = await db.prisma.package.findMany({
      where: whereCondition,
      select: {
        id: true,
        packageHosts: {
          select: {
            host: {
              select: {
                id: true,
                countryCode: true,
                status: true
              }
            }
          }
        }
      }
    })

    // 2. 按国家分组统计套餐数量
    const regionPackages = new Map<string, Set<number>>()  // countryCode -> packageIds
    
    for (const pkg of packagesWithPlans) {
      for (const ph of pkg.packageHosts) {
        // 只计算在线的宿主机
        if (ph.host.status !== 'online') continue
        
        const countryCode = (ph.host.countryCode || 'us').toLowerCase()
        if (!regionPackages.has(countryCode)) {
          regionPackages.set(countryCode, new Set())
        }
        regionPackages.get(countryCode)!.add(pkg.id)
      }
    }

    // 3. 构建地区列表
    const regions = Array.from(regionPackages.entries()).map(([code, packageIds]) => ({
      code,
      name: getCountryName(code),
      packageCount: packageIds.size,
      packageIds: Array.from(packageIds)  // 返回该地区包含的套餐 ID 列表
    }))

    // 按套餐数量降序排列
    regions.sort((a, b) => b.packageCount - a.packageCount)

    return { regions }
  })
}

const englishRegionDisplayNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null

const intlRegionCodePattern = /^([a-z]{2}|\d{3})$/i

const specialCountryNames: Record<string, string> = {
  pc: 'Pacific Community',
  xx: 'Unknown'
}

// 获取国家名称
function getCountryName(code: string): string {
  const normalizedCode = code.toLowerCase()
  const upperCode = normalizedCode.toUpperCase()

  if (intlRegionCodePattern.test(normalizedCode)) {
    const displayName = englishRegionDisplayNames?.of(upperCode)
    if (displayName && displayName !== upperCode) {
      return displayName
    }
  }

  return specialCountryNames[normalizedCode] || upperCode
}

// 格式化内存显示
function formatMemory(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb} MB`
}
