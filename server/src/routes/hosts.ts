/**
 * 宿主机管理路由 (管理员)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { Agent, request as undiciRequest } from 'undici'
import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { checkHostingAccess } from '../lib/hosting-access.js'
import { createInboxMessage } from '../db/inbox.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode, type ErrorCodeType } from '../lib/errors.js'
import { createInstanceTask, getActiveTaskForInstance, InstanceTaskConflictError } from '../db/instance-tasks.js'
import type { CreateInstanceTaskData, InstanceTaskWithDetails } from '../db/instance-tasks.js'
import { getSSHKeyById, getSSHKeysByUserId } from '../db/ssh-keys.js'
import { getEnabledCommandsByDistro, validateCommandsOwnership } from '../db/custom-init-commands.js'
import {
  INSTANCE_OPERATION_LOCK_NAMESPACE,
  USER_BALANCE_LOCK_NAMESPACE,
  advisoryTransactionLock,
  tryAdvisoryTransactionLock
} from '../db/advisory-locks.js'
import { IncusClient, getIncusClient, removeIncusClient } from '../lib/incus/index.js'
import { listStoragePools, getStoragePoolResources, createStoragePool, deleteStoragePool, updateStoragePool } from '../lib/incus/incus-storage.js'
import type { CreateHostRequest, UpdateHostRequest } from '../types/api.js'
import type { Host } from '../types/database.js'
import { validateName, validateUrl, validateIpAddress, validateIdentifier, validateIpOrDomain, encryptSensitiveData, getJwtSigningSecret } from '../lib/security.js'
import { sendNotification } from '../lib/notifier.js'
import { sendReleaseNotification } from '../lib/release-notifier.js'
import { createCaddyClient } from '../lib/caddy-client.js'
import { normalizeArchitecture } from '../lib/architecture.js'
import { generateIncusConfig } from '../lib/incus-config-generator.js'
import { sendAdminInstanceCreatedEmail, sendRenewalPriceUpdatedEmail } from '../lib/mailer.js'
import { generateRandomIPv4, generateRandomIPv6 } from '../lib/ip-calculator.js'
import { calculateCreateBilling } from '../db/billing-operations.js'
import { getDnsRecordType } from '../lib/network-address.js'
import { resolveInstanceTrafficLimitForHost } from '../lib/traffic-multiplier.js'
import { normalizePlanTrafficLimitSpeed } from '../services/traffic-bandwidth.js'
import { issueHostAgentInstallToken } from '../lib/host-agent-credentials.js'
import {
  persistResolvedInstanceNetworkAddresses,
  resolveInstanceNetworkAddresses
} from '../lib/instance-network-sync.js'
import {
  HostAddressRegistryError,
  logHostAddressResolutionFailure,
  persistHostAddressSnapshot,
  prepareHostAddressSnapshotForWrite,
  withHostAddressRegistryLock
} from '../services/host-address-monitor.js'
import {
  getSystemImageAvailabilityForHost,
  isImageCompatibleWithInstanceType,
  isImageCompatibleWithMemory,
  isValidSystemImage
} from '../db/images.js'
import {
  BUILTIN_AUDIT_RULES,
  type AuditFindingTarget,
  type AuditRuleDefinition,
  type AuditRuleMatchType,
  type AuditRuleTarget,
  type AuditSeverity,
  analyzeAuditData,
  buildConnectionAuditCommand,
  buildProcessAuditCommand,
  buildStartupAuditCommand,
  parseConnections,
  parseProcesses,
  parseStartupItems
} from '../lib/instance-audit.js'
import { provisionManagedInstanceAsync } from '../lib/managed-instance-provision.js'
import crypto from 'crypto'
import type { InstanceStatus } from '@prisma/client'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const AUDIT_SEVERITIES = new Set<AuditSeverity>(['info', 'low', 'medium', 'high'])
const AUDIT_TARGETS = new Set<AuditRuleTarget>(['process', 'network', 'startup'])
const AUDIT_MATCH_TYPES = new Set<AuditRuleMatchType>(['contains', 'regex', 'exact'])
const AUDIT_FINDING_TARGETS = new Set<AuditFindingTarget>(['process', 'network', 'startup', 'capability'])
const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/
const HOST_LIST_MAX_PAGE_SIZE = 100
const HOST_AUDIT_HISTORY_MAX_PAGE_SIZE = 50
const AUDIT_IGNORE_MAX_EXPIRES_DAYS = 365
const AUDIT_KILL_PROCESS_MIN_PID = 2
const AUDIT_KILL_PROCESS_MAX_PID = 4194304
const HOST_BATCH_MIGRATE_MAX_INSTANCES = 30
const HOST_BATCH_INSTANCE_MAX_ITEMS = 100
const HOST_GIFT_DAYS_MAX = 365
const HOST_RENEWAL_PRICE_MAX = 99999

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseIntegerBody(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    return null
  }

  return value
}

function parsePositiveIntegerArrayBody(value: unknown, maxItems: number): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    return null
  }

  const parsed: number[] = []
  const seen = new Set<number>()

  for (const item of value) {
    const id = parseIntegerBody(item)
    if (!id || seen.has(id)) {
      return null
    }

    parsed.push(id)
    seen.add(id)
  }

  return parsed
}

function parseOptionalIntegerBody(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number | null | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  return parseIntegerBody(value, min, max)
}

function parseFiniteNumberBody(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return null
  }

  return value
}

function parseOptionalPositiveQueryInteger(value: string | undefined): number | null | undefined {
  if (value === undefined || value === '') return undefined
  return parsePositiveRouteId(value)
}

function parseHostListPageSize(value: string | undefined): number | null | undefined {
  const parsed = parseOptionalPositiveQueryInteger(value)
  if (parsed === null || parsed === undefined) return parsed
  return Math.min(parsed, HOST_LIST_MAX_PAGE_SIZE)
}

function parseHostAuditHistoryPageSize(value: string | undefined): number | null | undefined {
  const parsed = parseOptionalPositiveQueryInteger(value)
  if (parsed === null || parsed === undefined) return parsed
  return Math.min(parsed, HOST_AUDIT_HISTORY_MAX_PAGE_SIZE)
}

async function claimHostBatchInstanceForDelete(instanceId: number, currentStatus: InstanceStatus): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)
    if (!locked) return false

    const [activeRestoreTask, activeUploadTask, activeInstanceTask] = await Promise.all([
      tx.restoreTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.backupUploadTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.instanceTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      })
    ])
    if (activeRestoreTask || activeUploadTask || activeInstanceTask) return false

    const result = await tx.instance.updateMany({
      where: {
        id: instanceId,
        status: currentStatus
      },
      data: { status: 'deleted' }
    })

    return result.count === 1
  })
}

function sendHostActiveTaskConflict(reply: FastifyReply, activeTask?: Pick<InstanceTaskWithDetails, 'id' | 'taskType' | 'status'> | null) {
  return reply.code(409).send({
    error: 'Instance has an active task',
    code: 'TASK_IN_PROGRESS',
    ...(activeTask
      ? {
          taskId: activeTask.id,
          taskType: activeTask.taskType,
          status: activeTask.status
        }
      : {})
  })
}

async function rejectActiveHostInstanceWorkflowConflict(reply: FastifyReply, instanceId: number): Promise<boolean> {
  const [activeRestoreTask, activeUploadTask, activeInstanceTask] = await Promise.all([
    prisma.restoreTask.findFirst({
      where: {
        instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      select: { id: true, status: true }
    }),
    prisma.backupUploadTask.findFirst({
      where: {
        instanceId,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      select: { id: true, status: true }
    }),
    getActiveTaskForInstance(instanceId)
  ])

  if (activeRestoreTask) {
    reply.code(409).send({
      error: 'Instance has an active restore task',
      code: 'RESTORE_IN_PROGRESS',
      taskId: activeRestoreTask.id,
      status: activeRestoreTask.status
    })
    return true
  }

  if (activeUploadTask) {
    reply.code(409).send({
      error: 'Instance has an active backup upload task',
      code: 'UPLOAD_IN_PROGRESS',
      taskId: activeUploadTask.id,
      status: activeUploadTask.status
    })
    return true
  }

  if (activeInstanceTask) {
    sendHostActiveTaskConflict(reply, activeInstanceTask)
    return true
  }

  return false
}

async function createHostInstanceTaskOrConflict(
  reply: FastifyReply,
  data: CreateInstanceTaskData
): Promise<InstanceTaskWithDetails | null> {
  try {
    return await createInstanceTask(data)
  } catch (error) {
    if (error instanceof InstanceTaskConflictError) {
      sendHostActiveTaskConflict(reply, error.activeTask)
      return null
    }
    throw error
  }
}

async function restoreHostBatchDeleteClaim(instanceId: number, originalStatus: InstanceStatus): Promise<void> {
  await prisma.instance.updateMany({
    where: {
      id: instanceId,
      status: 'deleted'
    },
    data: { status: originalStatus }
  })
}

async function deleteIncusInstanceForHostBatch(
  client: IncusClient,
  operations: {
    stopInstance: (client: IncusClient, name: string, force?: boolean) => Promise<unknown>
    deleteInstance: (client: IncusClient, name: string) => Promise<unknown>
  },
  instance: { incusId: string; status: string },
  logger: { warn: (...args: any[]) => void }
): Promise<void> {
  if (instance.status === 'running') {
    try {
      await operations.stopInstance(client, instance.incusId, true)
    } catch (err) {
      logger.warn(err, '停止实例失败，继续尝试删除')
    }
  }

  await operations.deleteInstance(client, instance.incusId)
}

async function deleteIncusInstanceForMigration(
  client: IncusClient,
  operations: {
    stopInstance: (client: IncusClient, name: string, force?: boolean) => Promise<unknown>
    deleteInstance: (client: IncusClient, name: string) => Promise<unknown>
  },
  instance: { incusId: string; status: string },
  logger: { warn: (...args: any[]) => void }
): Promise<void> {
  if (instance.status === 'running') {
    try {
      await operations.stopInstance(client, instance.incusId, true)
    } catch (err) {
      logger.warn(err, '停止源实例失败，继续尝试删除')
    }
  }

  await operations.deleteInstance(client, instance.incusId)
}

function normalizeAuditSeverity(value: unknown): AuditSeverity {
  return AUDIT_SEVERITIES.has(value as AuditSeverity) ? value as AuditSeverity : 'medium'
}

function normalizeAuditMatchType(value: unknown): AuditRuleMatchType {
  return AUDIT_MATCH_TYPES.has(value as AuditRuleMatchType) ? value as AuditRuleMatchType : 'contains'
}

function normalizeAuditTargetTypes(value: unknown): AuditRuleTarget[] {
  const items = Array.isArray(value) ? value : []
  const targets = items.filter(item => AUDIT_TARGETS.has(item as AuditRuleTarget)) as AuditRuleTarget[]
  return targets.length > 0 ? Array.from(new Set(targets)) : ['process']
}

function normalizeAuditFindingTarget(value: unknown): AuditFindingTarget | null {
  return AUDIT_FINDING_TARGETS.has(value as AuditFindingTarget) ? value as AuditFindingTarget : null
}

function validateAuditRegex(matchType: AuditRuleMatchType, pattern: string): void {
  if (matchType !== 'regex') return
  new RegExp(pattern)
}

function toCustomAuditRuleDefinition(rule: any): AuditRuleDefinition {
  return {
    id: `custom:${rule.id}`,
    severity: normalizeAuditSeverity(rule.severity),
    category: rule.category || 'custom',
    name: rule.name,
    description: rule.description || null,
    targetTypes: normalizeAuditTargetTypes(rule.targetTypes),
    matchType: normalizeAuditMatchType(rule.matchType),
    patternText: rule.pattern,
    caseSensitive: Boolean(rule.caseSensitive),
    source: 'custom',
    enabled: Boolean(rule.enabled),
    recommendation: rule.recommendation || null
  }
}

function findBuiltinAuditRule(ruleId: string): AuditRuleDefinition | undefined {
  return BUILTIN_AUDIT_RULES.find(rule => rule.id === ruleId)
}

function applyBuiltinAuditRuleOverride(rule: AuditRuleDefinition, override?: any): AuditRuleDefinition {
  if (!override) return rule
  return {
    ...rule,
    severity: normalizeAuditSeverity(override.severity),
    category: override.category || rule.category,
    name: override.name || rule.name,
    description: override.description ?? rule.description ?? null,
    targetTypes: normalizeAuditTargetTypes(override.targetTypes),
    matchType: normalizeAuditMatchType(override.matchType),
    patternText: override.pattern || rule.patternText,
    caseSensitive: Boolean(override.caseSensitive),
    enabled: Boolean(override.enabled),
    recommendation: override.recommendation ?? rule.recommendation ?? null
  }
}

function toAuditRuleResponse(rule: any, hostId: number) {
  if (rule.source === 'builtin') {
    const override = rule.override || null
    const { original, override: _override, patternText, ...publicRule } = rule
    return {
      ...publicRule,
      pattern: patternText,
      readOnly: true,
      scope: 'builtin',
      originalName: original?.name || rule.name,
      originalSeverity: original?.severity || rule.severity,
      originalCategory: original?.category || rule.category,
      originalTargetTypes: original?.targetTypes || rule.targetTypes,
      originalMatchType: original?.matchType || rule.matchType,
      originalPattern: original?.patternText || patternText,
      originalCaseSensitive: original?.caseSensitive ?? rule.caseSensitive,
      originalRecommendation: original?.recommendation ?? rule.recommendation ?? null,
      overridden: Boolean(override),
      overrideId: override?.id || null,
      overrideUpdatedAt: override?.updatedAt || null
    }
  }

  return {
    id: rule.id,
    ruleId: `custom:${rule.id}`,
    source: 'custom',
    readOnly: false,
    scope: rule.hostId === null ? 'global' : (rule.hostId === hostId ? 'host' : 'global'),
    hostId: rule.hostId,
    name: rule.name,
    description: rule.description,
    severity: rule.severity,
    category: rule.category,
    targetTypes: normalizeAuditTargetTypes(rule.targetTypes),
    matchType: rule.matchType,
    pattern: rule.pattern,
    caseSensitive: rule.caseSensitive,
    recommendation: rule.recommendation,
    enabled: rule.enabled,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
  }
}

async function getAuthorizedOpsHost(hostId: number, user: { id: number; role: string }) {
  const host = await db.getHostById(hostId)
  if (!host) return { host: null, error: apiError(ErrorCode.HOST_NOT_FOUND), status: 404 }
  if (host.user_id !== user.id && user.role !== 'admin') {
    return { host: null, error: apiError(ErrorCode.FORBIDDEN), status: 403 }
  }
  return { host, error: null, status: 200 }
}

async function getAuditRuleDefinitions(hostId: number): Promise<AuditRuleDefinition[]> {
  const [customRules, builtinOverrides] = await Promise.all([
    prisma.instanceAuditRule.findMany({
      where: {
        enabled: true,
        OR: [
          { hostId: null },
          { hostId }
        ]
      },
      orderBy: [
        { hostId: 'asc' },
        { id: 'asc' }
      ]
    }),
    prisma.instanceAuditBuiltinRuleOverride.findMany({
      where: { hostId }
    })
  ])
  const overrideByRuleId = new Map(builtinOverrides.map(override => [override.builtinRuleId, override]))
  const builtinRules = BUILTIN_AUDIT_RULES
    .map(rule => applyBuiltinAuditRuleOverride(rule, overrideByRuleId.get(rule.id)))
    .filter(rule => rule.enabled)

  return [
    ...builtinRules,
    ...customRules.map(toCustomAuditRuleDefinition)
  ]
}

async function getAuditRuleResponses(hostId: number) {
  const [customRules, builtinOverrides] = await Promise.all([
    prisma.instanceAuditRule.findMany({
      where: {
        OR: [
          { hostId: null },
          { hostId }
        ]
      },
      orderBy: [
        { hostId: 'asc' },
        { id: 'desc' }
      ]
    }),
    prisma.instanceAuditBuiltinRuleOverride.findMany({
      where: { hostId }
    })
  ])
  const overrideByRuleId = new Map(builtinOverrides.map(override => [override.builtinRuleId, override]))
  const builtin = BUILTIN_AUDIT_RULES.map(rule => {
    const override = overrideByRuleId.get(rule.id)
    const applied = applyBuiltinAuditRuleOverride(rule, override)
    return toAuditRuleResponse({
      ...applied,
      original: rule,
      override
    }, hostId)
  })

  return {
    builtin,
    custom: customRules.map(rule => toAuditRuleResponse(rule, hostId))
  }
}

async function getAuditIgnores(hostId: number, instanceId: number) {
  return prisma.instanceAuditIgnore.findMany({
    where: {
      hostId,
      enabled: true,
      OR: [
        { instanceId: null },
        { instanceId }
      ]
    },
    select: {
      id: true,
      ruleId: true,
      targetType: true,
      matchText: true,
      reason: true,
      expiresAt: true
    }
  })
}

function normalizeProcessText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

async function generateUniqueOwnedName(
  tx: any,
  model: 'host' | 'package',
  userId: number,
  baseName: string
): Promise<string> {
  const MAX_OWNED_NAME_LENGTH = 64

  const findExisting = async (candidate: string) => {
    if (model === 'host') {
      return tx.host.findFirst({
        where: { userId, name: candidate },
        select: { id: true }
      })
    }

    return tx.package.findFirst({
      where: { userId, name: candidate },
      select: { id: true }
    })
  }

  const normalizedBaseName = String(baseName || '').trim()
  const truncateWithSuffix = (suffixText = '') => {
    if (!suffixText) {
      return normalizedBaseName.slice(0, MAX_OWNED_NAME_LENGTH)
    }

    const baseMaxLength = Math.max(1, MAX_OWNED_NAME_LENGTH - suffixText.length)
    return `${normalizedBaseName.slice(0, baseMaxLength)}${suffixText}`
  }

  const currentCandidate = truncateWithSuffix()
  const currentNameTaken = await findExisting(currentCandidate)
  if (!currentNameTaken) {
    return currentCandidate
  }

  let suffix = 1
  while (true) {
    const suffixText = suffix === 1 ? '-official' : `-official-${suffix}`
    const candidate = truncateWithSuffix(suffixText)
    const existing = await findExisting(candidate)
    if (!existing) {
      return candidate
    }
    suffix++
  }
}

/**
 * 从 Incus resources 数据中提取宿主机的公网 IPv6 地址
 * 遍历网卡的地址列表，查找 scope=global 的 IPv6 地址
 * 排除 link-local (fe80::) 和 unique-local (fd/fc) 地址
 */
function extractHostPublicIpv6FromResources(resources: Record<string, unknown>): string | null {
  try {
    const network = resources.network as { cards?: Array<{ addresses?: Array<{ address?: string; family?: string; scope?: string }>; ports?: Array<{ addresses?: Array<{ address?: string; family?: string; scope?: string }> }> }> } | undefined
    if (!network?.cards) return null

    for (const card of network.cards) {
      // 直接检查网卡地址
      const addresses = card.addresses || []
      for (const addr of addresses) {
        if (addr.family === 'inet6' && addr.scope === 'global' && addr.address) {
          const ip = addr.address
          // 排除 link-local、unique-local 地址
          if (!ip.startsWith('fe80:') && !ip.startsWith('fd') && !ip.startsWith('fc')) {
            return ip
          }
        }
      }
      // 检查端口上的地址
      if (card.ports) {
        for (const port of card.ports) {
          const portAddresses = port.addresses || []
          for (const addr of portAddresses) {
            if (addr.family === 'inet6' && addr.scope === 'global' && addr.address) {
              const ip = addr.address
              if (!ip.startsWith('fe80:') && !ip.startsWith('fd') && !ip.startsWith('fc')) {
                return ip
              }
            }
          }
        }
      }
    }
  } catch {
    // 忽略解析失败
  }
  return null
}

/**
 * 从请求上下文推导面板访问地址
 * 优先级：SITE_URL/FRONTEND_URL 环境变量 > Origin/Referer 头 > Host 头拼接
 */
function derivePanelUrl(request: FastifyRequest): string {
  // 1. 优先使用公开站点环境变量（管理员显式配置的）
  const configuredUrl = process.env.SITE_URL?.trim() || process.env.FRONTEND_URL?.split(',')[0]?.trim()
  if (configuredUrl) {
    let envUrl = configuredUrl
    // 清理可能误填的双协议头例如 https://https://
    envUrl = envUrl.replace(/^https?:\/\/(https?:\/\/)/, '$1')
    // 移除末尾的斜杠
    envUrl = envUrl.replace(/\/+$/, '')

    try {
      const parsed = new URL(envUrl)
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && envUrl !== 'https://incudal.com') {
        return `${parsed.protocol}//${parsed.host}`
      }
    } catch { /* 忽略解析失败，继续从请求推导 */ }
    
    if (process.env.NODE_ENV === 'production') {
      request.log.warn({ configuredUrl: envUrl }, 'Invalid SITE_URL/FRONTEND_URL for host install URL derivation')
    }
  }

  // 2. 从 Referer 头推导（用户通过面板页面下载时会带上）
  const referer = request.headers.referer || request.headers.origin
  if (referer) {
    try {
      const url = new URL(Array.isArray(referer) ? referer[0] : referer)
      return `${url.protocol}//${url.host}`
    } catch { /* 忽略解析失败 */ }
  }

  // 3. 从 Host 头拼接（curl 直接下载时会有）
  const host = request.headers.host
  if (host) {
    let proto = request.headers['x-forwarded-proto'] || 'http'
    let protocol = Array.isArray(proto) ? proto[0] : proto
    protocol = protocol.replace(/:\/\/$/, '') // 清理可能的畸形协议头
    return `${protocol}://${host}`
  }

  // 4. 兑底默认值
  return 'https://incudal.com'
}

function shellDoubleQuote(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
}

function injectInstallVariable(script: string, name: string, value: string): string {
  return script.replace(
    new RegExp(`^${name}=""`, 'm'),
    () => `${name}="${shellDoubleQuote(value)}"`
  )
}

function buildHostInstallCommand(panelUrl: string, installToken: string): string {
  return `curl -sL ${panelUrl}/api/hosts/install.sh/${installToken} -o incudal.sh && sudo bash incudal.sh`
}

export default async function hostRoutes(fastify: FastifyInstance) {
  // 获取宿主机列表（支持分页和搜索）
  // 管理员可以看所有节点，普通用户只能看自己的节点 (mine=true)
  // 管理员可用参数：
  //   - scope: mine(我的) / official(自营) / hosted(托管的)
  //   - userId: 筛选特定用户（仅 scope=hosted 时有效）
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      mine?: string
      scope?: string  // mine | official | hosted
      userId?: string // 筛选特定用户
    }
  }>('/', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      mine?: string
      scope?: string
      userId?: string
    }
  }>, reply: FastifyReply) => {
    const { user } = request
    const { page, pageSize, search = '', mine, scope, userId: filterUserId } = request.query
    const parsedPage = parseOptionalPositiveQueryInteger(page)
    const parsedPageSize = parseHostListPageSize(pageSize)
    const parsedFilterUserId = parseOptionalPositiveQueryInteger(filterUserId)

    if (parsedPage === null || parsedPageSize === null || parsedFilterUserId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid host list query'))
    }

    // 管理员可以查看系统内所有节点
    // 普通用户只能查看自己的节点（必须传 mine=true）
    const isAdmin = user.role === 'admin'
    
    if (!isAdmin && mine !== 'true') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 管理员专用：scope 参数处理
    let queryUserId: number | undefined = undefined
    let ownerRole: 'admin' | 'user' | undefined = undefined
    let includeOwner = false

    if (isAdmin && scope === 'hosted') {
      // 查看托管节点：仅显示普通用户的节点
      ownerRole = 'user'
      includeOwner = true
      // 如果指定了筛选用户
      if (parsedFilterUserId && parsedFilterUserId !== user.id) {
        queryUserId = parsedFilterUserId
      }
    } else if (isAdmin && scope === 'official') {
      // 查看自营节点：所有管理员账号名下的节点都视为官方自营
      ownerRole = 'admin'
    } else if (isAdmin && scope === 'mine') {
      // 管理员查看自己账号名下的节点
      queryUserId = user.id
    } else if (!isAdmin) {
      // 普通用户只能看自己的
      queryUserId = user.id
    }
    // 管理员不传 scope 时，默认查看所有节点（向后兼容）

    const result = await db.getHostsPaginated({
      page: parsedPage ?? 1,
      pageSize: parsedPageSize ?? 20,
      search,
      userId: queryUserId,
      ownerRole,
      includeOwner
    })

    // 获取每个宿主机的实例数量
    const hostsWithCount = await Promise.all(result.items.map(async (h: unknown) => {
      const host = h as {
        id: number
        name: string
        url: string
        status: string
        location: string | null
        country_code: string
        architecture?: 'x86_64' | 'aarch64'
        tags?: string
        cert_path?: string | null
        key_path?: string | null
        cpu_used: number
        memory_used: number
        disk_total: number // 计算值
        disk_used: number
        cpu_allowance_max?: number
        memory_max?: number
        instance_type?: string
        storage_size?: number
        nat_public_ip?: string | null
        nat_public_ipv6?: string | null
        nat_bind_ip?: string | null
        nat_bind_ipv6?: string | null
        nat_port_start?: number | null
        nat_port_end?: number | null
        nat_ports_used_count?: number
        user_id?: number
        owner?: {
          id: number
          username: string
          email: string | null
          avatarStyle: string
          avatarBadgeId?: string | null
        }
      }
      const instanceCount = await db.getInstanceCountByHost(host.id)
      return {
        id: host.id,
        name: host.name,
        url: host.url,
        status: host.status,
        maintenance: host.status === 'maintenance',
        location: host.location,
        countryCode: host.country_code || 'us',
        architecture: host.architecture || 'x86_64',
        tags: typeof host.tags === 'string' ? JSON.parse(host.tags || '[]') : (host.tags || []),
        // certPath and keyPath are sensitive - removed from response
        resources: {
          cpuUsed: host.cpu_used,
          memoryUsed: host.memory_used,
          diskTotal: host.disk_total, // 计算值，来自 storage_size * 1024
          diskUsed: host.disk_used
        },
        cpuAllowanceMax: host.cpu_allowance_max || 0,
        memoryMax: host.memory_max || 0,
        instanceType: host.instance_type || 'container',
        instanceCount,
        natConfig: {
          publicIp: host.nat_public_ip,
          publicIpv6: host.nat_public_ipv6,
          bindIp: (host as any).nat_bind_ip || null,
          bindIpv6: (host as any).nat_bind_ipv6 || null,
          portRangeStart: host.nat_port_start,
          portRangeEnd: host.nat_port_end,
          portsUsedCount: host.nat_ports_used_count || 0
        },
        // 托管节点所有者信息
        ...(host.owner && {
          owner: {
            id: host.owner.id,
            username: host.owner.username,
            email: host.owner.email,
            avatarStyle: host.owner.avatarStyle,
            avatarBadgeId: host.owner.avatarBadgeId ?? null
          }
        })
      }
    }))

    return {
      hosts: hostsWithCount,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    }
  })

  // 添加宿主机（管理员或满足准入条件的用户）
  fastify.post<{
    Body: CreateHostRequest & {
      tags?: string[]
      natConfig?: { publicIp?: string; publicIpv6?: string; bindIp?: string; bindIpv6?: string; portRangeStart?: number; portRangeEnd?: number }
      ipAddress?: string
      storageDriver?: 'zfs' | 'lvm'
      storageType?: 'loop' | 'disk'
      storagePath?: string
      storageSize?: number
      ipv6Mode?: number
      ipv6Subnet?: string
      ipv6Gateway?: string
      ipv6ParentInterface?: string
      cpuAllowanceMax?: number
      memoryMax?: number
      instanceType?: 'container' | 'vm' | 'both'
    }
  }>('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'url'],
        properties: {
          name: { type: 'string', minLength: 2 },
          url: { type: 'string' },
          location: { type: 'string' },
          countryCode: { type: 'string', minLength: 2, maxLength: 2 },
          tags: { type: 'array', items: { type: 'string' } },
          certPath: { type: 'string' },
          keyPath: { type: 'string' },
          natConfig: {
            type: 'object',
            properties: {
              publicIp: { type: 'string' },
              publicIpv6: { type: 'string' },
              bindIp: { type: 'string' },
              bindIpv6: { type: 'string' },
              portRangeStart: { type: 'integer' },
              portRangeEnd: { type: 'integer' }
            }
          },
          ipAddress: { type: 'string' },
          storageDriver: { type: 'string', enum: ['zfs', 'lvm'] },
          storageType: { type: 'string', enum: ['loop', 'disk'] },
          storagePath: { type: 'string' },
          storageSize: { type: 'integer' },
          ipv6Mode: { type: 'integer' },
          ipv6Subnet: { type: 'string' },
          ipv6Gateway: { type: 'string' },
          ipv6ParentInterface: { type: 'string' },
          cpuAllowanceMax: { type: 'integer' },
          memoryMax: { type: 'integer' },
          instanceType: { type: 'string', enum: ['container', 'vm', 'both'] }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Body: CreateHostRequest & {
      tags?: string[]
      natConfig?: { publicIp?: string; publicIpv6?: string; bindIp?: string; bindIpv6?: string; portRangeStart?: number; portRangeEnd?: number }
      ipAddress?: string
      storageDriver?: 'zfs' | 'lvm'
      storageType?: 'loop' | 'disk'
      storagePath?: string
      storageSize?: number
      ipv6Mode?: number
      ipv6Subnet?: string
      ipv6Gateway?: string
      ipv6ParentInterface?: string
      cpuAllowanceMax?: number
      memoryMax?: number
      instanceType?: 'container' | 'vm' | 'both'
    }
  }>, reply: FastifyReply) => {
    const {
      name, url, location, countryCode, tags, certPath, keyPath, natConfig,
      ipAddress, storageDriver, storageType, storagePath, storageSize, ipv6Mode, ipv6Subnet, ipv6Gateway, ipv6ParentInterface,
      cpuAllowanceMax, memoryMax, instanceType
    } = request.body

    // Validate input (prevent dangerous character injection)
    // 使用 validateIdentifier 确保主机名只包含安全字符 [a-zA-Z0-9_-]
    const nameValidation = validateIdentifier(name, 'Host name', 2, 64)
    if (!nameValidation.valid) {
      return reply.code(400).send({ error: nameValidation.message })
    }

    // 普通用户节点名称必须以 PEER{userId} 开头（格式：PEER{userId}-xxx 或 PEER{userId}_xxx）
    if (request.user.role !== 'admin') {
      const userIdPrefix = `PEER${request.user.id}`
      // 检查名称是否以 PEER{userId} 开头，后面跟 - 或 _ 分隔符
      const validPrefixPattern = new RegExp(`^${userIdPrefix}[-_]`, 'i')
      if (!validPrefixPattern.test(name)) {
        return reply.code(400).send({
          error: `Node name must start with your user ID prefix: ${userIdPrefix}-`,
          code: 'INVALID_HOST_NAME_PREFIX'
        })
      }
    }

    const existingHost = await db.getHostByUserAndName(request.user.id, name)
    if (existingHost) {
      return reply.code(400).send(apiError(ErrorCode.HOST_NAME_EXISTS))
    }

    // 检查托管准入条件（管理员不受限制）
    if (request.user.role !== 'admin') {
      const accessCheck = await checkHostingAccess(request.user.id)
      if (!accessCheck.allowed) {
        return reply.code(403).send({
          error: accessCheck.reason,
          code: 'HOSTING_ACCESS_DENIED'
        })
      }
    }

    const urlValidation = validateUrl(url, 'Host URL')
    if (!urlValidation.valid) {
      return reply.code(400).send({ error: urlValidation.message })
    }

    const hostAddressValidation = validateIpOrDomain(new URL(urlValidation.sanitized || url).hostname, 'Host address')
    if (!hostAddressValidation.valid) {
      return reply.code(400).send({ error: hostAddressValidation.message })
    }

    if (location) {
      const locationValidation = validateName(location, 'Location', 1, 100)
      if (!locationValidation.valid) {
        return reply.code(400).send({ error: locationValidation.message })
      }
    }

    let normalizedNatPublicIp: string | null = null
    let normalizedNatPublicIpv6: string | null = null
    let normalizedNatBindIp: string | null = null
    let normalizedNatBindIpv6: string | null = null
    const normalizedIpv6Subnet = ipv6Subnet?.trim() || null
    const normalizedIpv6ParentInterface = ipv6ParentInterface?.trim() || null
    if (natConfig?.publicIp) {
      const ipValidation = validateIpAddress(natConfig.publicIp, 'NAT public IP')
      if (!ipValidation.valid) {
        return reply.code(400).send({ error: ipValidation.message })
      }
      normalizedNatPublicIp = ipValidation.sanitized || natConfig.publicIp.trim()
    }
    if (natConfig?.bindIp) {
      const ipValidation = validateIpAddress(natConfig.bindIp, 'NAT bind IP')
      if (!ipValidation.valid) {
        return reply.code(400).send({ error: ipValidation.message })
      }
      normalizedNatBindIp = ipValidation.sanitized || natConfig.bindIp.trim()
    }
    if (natConfig?.bindIpv6) {
      const ipValidation = validateIpAddress(natConfig.bindIpv6, 'NAT bind IPv6')
      if (!ipValidation.valid || !(ipValidation.sanitized || natConfig.bindIpv6).includes(':')) {
        return reply.code(400).send({ error: 'Invalid NAT bind IPv6 address format' })
      }
      normalizedNatBindIpv6 = ipValidation.sanitized || natConfig.bindIpv6.trim()
    }
    if (natConfig?.publicIpv6) {
      const ipValidation = validateIpAddress(natConfig.publicIpv6, 'NAT public IPv6')
      if (!ipValidation.valid || !(ipValidation.sanitized || natConfig.publicIpv6).includes(':')) {
        return reply.code(400).send({ error: 'Invalid NAT public IPv6 address format' })
      }
      normalizedNatPublicIpv6 = ipValidation.sanitized || natConfig.publicIpv6.trim()
    }

    // 端口范围校验：结束端口不能小于起始端口
    if (natConfig?.portRangeStart != null && natConfig?.portRangeEnd != null) {
      if (natConfig.portRangeEnd < natConfig.portRangeStart) {
        return reply.code(400).send({ error: 'Port range end must be greater than or equal to start', code: 'INVALID_PORT_RANGE' })
      }
    }



    // 判断是否需要初始化：如果没有提供证书路径，则需要运行安装脚本
    const needsInitialization = !certPath || !keyPath

    // 验证资源上限配置（如果提供）
    if (cpuAllowanceMax !== undefined && cpuAllowanceMax < 0) {
      return reply.code(400).send(apiError(ErrorCode.HOST_INVALID_CPU_MAX))
    }

    if (memoryMax !== undefined && memoryMax < 0) {
      return reply.code(400).send(apiError(ErrorCode.HOST_INVALID_MEMORY_MAX))
    }

    if (memoryMax !== undefined && memoryMax > 0 && memoryMax < 256) {
      return reply.code(400).send(apiError(ErrorCode.HOST_INVALID_MEMORY_MAX))
    }

    // 只有在需要初始化时才验证初始化配置
    if (needsInitialization) {
      // 存储驱动验证
      if (storageDriver && !['zfs', 'lvm'].includes(storageDriver)) {
        return reply.code(400).send({ error: 'Invalid storage driver, must be zfs or lvm' })
      }

      // 存储类型验证
      if (storageType && !['loop', 'disk'].includes(storageType)) {
        return reply.code(400).send({ error: 'Invalid storage type, must be loop or disk' })
      }

      // 存储路径验证 (防止命令注入)
      if (storagePath) {
        // 只允许 /dev/ 开头的设备路径，支持分区号、NVMe设备等
        // 例如: /dev/sdb, /dev/sda1, /dev/nvme0n1, /dev/vda
        if (!/^\/dev\/[a-zA-Z0-9_-]+$/.test(storagePath)) {
          return reply.code(400).send({ error: 'Invalid storage path, must be a valid device path like /dev/sdb or /dev/nvme0n1' })
        }
      }

      // 存储大小验证
      if (storageSize !== undefined && (storageSize < 10 || storageSize > 10000)) {
        return reply.code(400).send({ error: 'Storage size must be between 10 and 10000 GB' })
      }

      // IPv6 模式验证
      if (ipv6Mode !== undefined && (ipv6Mode < 1 || ipv6Mode > 3)) {
        return reply.code(400).send(apiError(ErrorCode.HOST_INVALID_IPV6_MODE))
      }

      // IPv6 路由模式 (1)：子网和接口为选填，用户可先创建节点后再编辑补充
      // （实际创建实例时如果子网为空，会自动回退到 NAT 模式）
      if (ipv6Mode === 1 && normalizedIpv6Subnet && !normalizedIpv6ParentInterface) {
        return reply.code(400).send({ error: 'IPv6 subnet and parent interface must be provided together' })
      }
      if (ipv6Mode === 1 && !normalizedIpv6Subnet && normalizedIpv6ParentInterface) {
        return reply.code(400).send({ error: 'IPv6 subnet and parent interface must be provided together' })
      }

    }

    // 如果需要初始化，生成安装 Token 和证书下载有效期
    let installToken: string | null = null
    let certDownloadExpire: Date | null = null
    if (needsInitialization) {
      // 生成 UUID 作为 installToken
      installToken = randomUUID()
      // 证书下载有效期 15 分钟
      certDownloadExpire = new Date(Date.now() + 15 * 60 * 1000)
    }

    let hostId: number
    try {
      hostId = await withHostAddressRegistryLock(async () => {
        const lockedSnapshot = await prepareHostAddressSnapshotForWrite(url)

        return prisma.$transaction(async tx => {
          const createdHostId = await db.createHost({
            userId: request.user.id,  // 所有者为当前用户
            name,
            url,
            location,
            countryCode: countryCode || 'us',
            tags: tags || [],
            certPath: certPath || null,
            keyPath: keyPath || null,
            natPublicIp: normalizedNatPublicIp,
            natPublicIpv6: normalizedNatPublicIpv6,
            natBindIp: normalizedNatBindIp,
            natBindIpv6: normalizedNatBindIpv6,
            natPortStart: natConfig?.portRangeStart || null,
            natPortEnd: natConfig?.portRangeEnd || null,
            ipAddress: ipAddress || null,
            storageDriver: storageDriver || 'zfs',
            storageType: storageType || 'loop',
            storagePath: storagePath || null,
            storageSize: storageSize || 60,
            ipv6Mode: ipv6Mode || 1,
            ipv6Subnet: normalizedIpv6Subnet,
            ipv6Gateway: ipv6Gateway || null,
            ipv6ParentInterface: normalizedIpv6ParentInterface,
            enableApi: true,  // 脚本已自动启用 API（core.https_address）
            sysctlConfig: null,  // 脚本已根据网络模式自动配置内核参数
            installToken: installToken,  // UUID Token，用于证书下载验证
            installTokenExpire: needsInitialization ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
            isInstalled: !needsInitialization, // 如果不需要初始化，则标记为已安装
            certDownloadCount: 0,  // 证书下载次数初始为 0
            certDownloadExpire: certDownloadExpire,  // 证书下载有效期 15 分钟
            cpuAllowanceMax: cpuAllowanceMax,
            memoryMax: memoryMax,
            instanceType: instanceType
          }, tx)

          if (request.user.role !== 'admin') {
            await tx.user.update({
              where: { id: request.user.id },
              data: { hasCreatedHostBefore: true }
            })
          }

          await persistHostAddressSnapshot(createdHostId, lockedSnapshot, 'create', tx)
          return createdHostId
        })
      })
    } catch (error) {
      if (error instanceof HostAddressRegistryError) {
        if (error.errorCode === ErrorCode.HOST_ADDRESS_UNRESOLVABLE) {
          await logHostAddressResolutionFailure(request.user.id, `${name}(create)`, url, 'create', error)
        }
        return reply.code(400).send(apiError(error.errorCode as ErrorCodeType, error.details))
      }
      throw error
    }

    // 注意：已取消配额限制，不再更新 hostUsed

    // 如果不需要初始化（已安装Incus），尝试自动连接并同步资源
    let autoConnected = false
    let resourceInfo: { cpuTotal: number; memoryTotalGB: number; diskTotalGB: number } | null = null
    let detectedArchitecture: 'x86_64' | 'aarch64' = 'x86_64'

    if (!needsInitialization && certPath && keyPath) {
      try {
        const client = new IncusClient({
          url,
          certPath,
          keyPath
        })

        const serverInfo = await client.connect() as {
          environment?: {
            kernel_architecture?: string
            architectures?: string[]
          }
        }
        detectedArchitecture = normalizeArchitecture(
          serverInfo.environment?.kernel_architecture ||
          serverInfo.environment?.architectures?.[0]
        )
        const resources = await client.getResources() as {
          cpu?: { total?: number }
          memory?: { total?: number }
          storage?: {
            disks?: Array<{ size?: number }>
            pools?: Record<string, { space?: { total?: number } }>
            total?: number
          }
        }

        // 获取磁盘大小
        let diskTotalBytes = 0
        if (resources.storage?.disks && Array.isArray(resources.storage.disks) && resources.storage.disks.length > 0) {
          diskTotalBytes = resources.storage.disks.reduce((sum: number, disk: { size?: number }) => sum + (disk.size || 0), 0)
        }
        if (diskTotalBytes === 0 && resources.storage?.pools) {
          for (const pool of Object.values(resources.storage.pools)) {
            const poolData = pool as { space?: { total?: number } }
            diskTotalBytes += poolData.space?.total || 0
          }
        }
        if (diskTotalBytes === 0) {
          diskTotalBytes = 1024 * 1024 * 1024 * 1024 // 默认 1TB
        }

        const cpuTotal = resources.cpu?.total || 0
        const memoryTotalMB = Math.round((resources.memory?.total || 0) / 1024 / 1024)
        const diskTotalMB = Math.round(diskTotalBytes / 1024 / 1024)

        // 只更新宿主机状态为在线，不覆盖任何用户输入的信息
        await db.updateHostStatus(hostId, 'online')

        // 只在用户明确提供了资源上限配置时才设置
        if (cpuAllowanceMax !== undefined || memoryMax !== undefined || instanceType !== undefined || detectedArchitecture !== 'x86_64') {
          await db.updateHostResources(hostId, {
            cpuAllowanceMax,
            memoryMax,
            instanceType,
            architecture: detectedArchitecture
          })
        }

        await client.close()
        autoConnected = true
        resourceInfo = {
          cpuTotal,
          memoryTotalGB: Math.round(memoryTotalMB / 1024),
          diskTotalGB: Math.round(diskTotalMB / 1024)
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.warn(`自动连接节点 ${name} 失败: ${errorMessage}`)
      }
    } else {
      // 如果不需要初始化，也需要设置资源上限配置（如果用户提供了）
      if (cpuAllowanceMax !== undefined || memoryMax !== undefined || instanceType !== undefined) {
        await db.updateHostResources(hostId, {
          cpuAllowanceMax,
          memoryMax,
          instanceType
        })
      }
    }

    await createLog(
      request.user.id,
      'host',
      'host.create',
      `Created host "${name}" [url: ${url}, location: ${location || 'N/A'}, country: ${countryCode || 'us'}, storage: ${storageDriver || 'zfs'}/${storageType || 'loop'} ${storageSize || 60}GB, instanceType: ${instanceType || 'container'}]`,
      'success'
    )

    // 检查宿主机配额使用率，超过 80% 时发送警告通知
    try {
      const userQuota = await db.getUserQuota(request.user.id)
      if (userQuota && userQuota.host_limit > 0) {
        const usagePercent = (userQuota.host_used / userQuota.host_limit) * 100
        if (usagePercent >= 80) {
          await sendNotification(request.user.id, 'quota_warning', {
            instanceName: '',
            quotaType: '宿主机',
            currentUsed: userQuota.host_used,
            maxLimit: userQuota.host_limit,
            usagePercent: Math.round(usagePercent)
          })
        }
      }
    } catch (quotaCheckError) {
      console.warn('[Host] 配额警告检查失败:', quotaCheckError)
    }

    // 如果需要初始化，生成安装命令（面板地址和 token 自动注入脚本）
    let installCommand: string | undefined
    if (needsInitialization && installToken) {
      const panelUrl = derivePanelUrl(request)
      installCommand = buildHostInstallCommand(panelUrl, installToken)
    }

    reply.code(201).send({
      message: needsInitialization
        ? 'Host added, please run install script to complete initialization'
        : (autoConnected ? 'Host added and connected' : 'Host added, please test connection manually'),
      host: {
        id: hostId,
        name,
        url,
        architecture: detectedArchitecture,
        status: autoConnected ? 'online' : 'offline',
        location,
        resources: resourceInfo
      },
      installCommand: installCommand || undefined,
      installToken: installToken || undefined
    })
  })

  // 通用安装脚本下载接口（无需鉴权，直接返回脚本模板，让用户在执行时输入 token）
  fastify.get('/install.sh', async (request, reply) => {
    try {
      const scriptPath = join(__dirname, '../../templates/install.sh')
      let script: string
      try {
        script = readFileSync(scriptPath, 'utf-8')
      } catch (err) {
        request.log.error(err, 'Failed to read install script file')
        return reply.code(500).send('# Error: Install script file not found')
      }

      // 注入面板地址（与 INJECT_TOKEN 使用相同的行锚定注入方式）
      const frontendUrl = derivePanelUrl(request)
      script = injectInstallVariable(script, 'INJECT_PANEL_URL', frontendUrl)

      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(script)
    } catch (err) {
      request.log.error(err, 'Failed to generate generic install script')
      return reply.code(500).send('# Error: Internal server error')
    }
  })

  // 安装脚本下载接口（基于 installToken 鉴权，保留给老版本兼容）
  fastify.get<{ Params: { token: string } }>('/install.sh/:token', async (request, reply) => {
    const { token } = request.params

    if (!token || token.length < 10) {
      request.log.warn('Invalid install script download token format')
      return reply.code(400).send('# Error: Invalid token format')
    }

    try {
      // 通过 installToken 查找宿主机
      const host = await prisma.host.findUnique({
        where: { installToken: token },
        select: {
          id: true,
          name: true,
          isInstalled: true,
          installTokenExpire: true
        }
      })

      if (!host) {
        request.log.warn(`Install script download failed: invalid token`)
        return reply.code(404).send('# Error: Invalid or expired token')
      }

      // 检查是否已安装
      if (host.isInstalled) {
        request.log.warn(`Install script download failed: host ${host.name} already installed`)
        return reply.code(403).send('# Error: Host already installed')
      }

      // 检查有效期（24 小时）
      if (!host.installTokenExpire) {
        request.log.warn(`Install script download failed: no expiration time set for host ${host.name}`)
        return reply.code(403).send('# Error: Invalid install token')
      }
      if (new Date() > host.installTokenExpire) {
        request.log.warn(`Install script download failed: token expired for host ${host.name}`)
        return reply.code(403).send('# Error: Install token has expired (24 hours)')
      }

      // 读取安装脚本
      const scriptPath = join(__dirname, '../../templates/install.sh')
      let script: string
      try {
        script = readFileSync(scriptPath, 'utf-8')
      } catch (err) {
        request.log.error(err, 'Failed to read install script file')
        return reply.code(500).send('# Error: Install script file not found')
      }

      // 注入面板地址（与 INJECT_TOKEN 使用相同的行锚定注入方式）
      const frontendUrl = derivePanelUrl(request)
      script = injectInstallVariable(script, 'INJECT_PANEL_URL', frontendUrl)

      // 将 token 注入脚本，用户无需手动输入
      script = injectInstallVariable(script, 'INJECT_TOKEN', token)

      const agentBinaryUrl = process.env.INCUDAL_AGENT_BINARY_URL?.trim()
      const agentBinarySha256 = process.env.INCUDAL_AGENT_BINARY_SHA256?.trim()
      if (agentBinaryUrl && (!agentBinarySha256 || !/^[a-f0-9]{64}$/i.test(agentBinarySha256))) {
        request.log.error(
          { hostId: host.id },
          'INCUDAL_AGENT_BINARY_SHA256 is required when INCUDAL_AGENT_BINARY_URL is configured'
        )
        return reply.code(500).send('# Error: Agent binary checksum is required when custom Agent binary URL is configured')
      }

      try {
        const agentInstall = await issueHostAgentInstallToken(host.id, true)
        script = injectInstallVariable(script, 'INJECT_AGENT_INSTALL_TOKEN', agentInstall.installToken)
        script = injectInstallVariable(script, 'INJECT_AGENT_ENABLED', 'true')

        if (agentBinaryUrl && agentBinarySha256) {
          script = injectInstallVariable(script, 'INJECT_AGENT_BINARY_URL', agentBinaryUrl)
          script = injectInstallVariable(script, 'INJECT_AGENT_BINARY_SHA256', agentBinarySha256)
        }

        request.log.info(
          {
            hostId: host.id,
            agentId: agentInstall.agent.agentId,
            installTokenExpiresAt: agentInstall.installTokenExpiresAt
          },
          'Host install script prepared with one-time Agent install token'
        )
        await createLog(
          null,
          'host',
          'host.agent_install_token_issue',
          `为宿主机安装脚本生成 Agent 一次性安装 token: ${host.name} (#${host.id})`,
          'success'
        )
      } catch (error) {
        request.log.error(
          { err: error, hostId: host.id },
          'Failed to prepare Host Agent bootstrap credentials'
        )
      }

      request.log.info(`Install script downloaded for host ${host.name}`)

      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(script)
    } catch (err) {
      request.log.error(err, 'Install script download error')
      return reply.code(500).send('# Error: Internal server error')
    }
  })

  // 证书下载接口（基于 installToken 鉴权）
  fastify.get<{ Params: { token: string } }>('/cert/:token', async (request, reply) => {
    const { token } = request.params

    if (!token || token.length < 10) {
      request.log.warn('Invalid certificate download token format')
      return reply.code(400).send('# Error: Invalid token format')
    }

    try {
      // 通过 installToken 查找宿主机
      const host = await prisma.host.findUnique({
        where: { installToken: token },
        select: {
          id: true,
          name: true,
          isInstalled: true,
          installTokenExpire: true
        }
      })

      if (!host) {
        request.log.warn(`Certificate download failed: invalid token`)
        return reply.code(404).send('# Error: Invalid or expired token')
      }

      // 检查是否已安装
      if (host.isInstalled) {
        request.log.warn(`Certificate download failed: host ${host.name} already installed`)
        return reply.code(403).send('# Error: Host already installed')
      }

      if (!host.installTokenExpire) {
        request.log.warn(`Certificate download failed: no expiration time set for host ${host.name}`)
        return reply.code(403).send('# Error: Invalid install token')
      }
      if (new Date() > host.installTokenExpire) {
        request.log.warn(`Certificate download failed: token expired for host ${host.name}`)
        return reply.code(403).send('# Error: Install token has expired (24 hours)')
      }

      // 读取证书文件
      const certPath = process.env.PANEL_CRT_PATH || join(__dirname, '../../certs/client.crt')
      let certContent: string
      try {
        certContent = readFileSync(certPath, 'utf-8')
      } catch (err) {
        request.log.error(err, 'Failed to read certificate file')
        return reply.code(500).send('# Error: Certificate file not found')
      }

      request.log.info(`Certificate downloaded for host ${host.name}`)

      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(certContent)
    } catch (err) {
      request.log.error(err, 'Certificate download error')
      return reply.code(500).send('# Error: Internal server error')
    }
  })

  // 验证并连接宿主机（Trust Password 握手）
  fastify.post<{ Params: { id: string } }>('/:id/verify', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取宿主机信息
    const host = await db.getHostById(hostId)

    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或节点所有者
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查是否有待验证的安装会话（证书模式不再需要 installToken，但保留过期检查）
    const fullHost = await prisma.host.findUnique({
      where: { id: hostId },
      select: { installTokenExpire: true, url: true, isInstalled: true }
    })

    if (fullHost?.isInstalled) {
      return reply.code(400).send({ error: '该宿主机已完成安装，无需再次验证' })
    }

    // 检查是否过期
    if (fullHost?.installTokenExpire && new Date() > fullHost.installTokenExpire) {
      return reply.code(400).send({ error: '安装会话已过期，请删除宿主机后重新创建' })
    }

    // 直接使用存储的 url 字段，无需重新拼接（避免 IPv6 地址丢失方括号的问题）
    const urlObj = new URL(host.url)
    const hostPort = urlObj.port || '8443'
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`

    // 准备证书路径
    const certPath = process.env.PANEL_CRT_PATH || join(__dirname, '../../certs/client.crt')
    const keyPath = process.env.PANEL_KEY_PATH || join(__dirname, '../../certs/client.key')

    let cert: Buffer
    let key: Buffer

    try {
      cert = readFileSync(certPath)
      key = readFileSync(keyPath)
    } catch (err) {
      request.log.error(err, 'Failed to read panel certificate files')
      return reply.code(500).send({ error: '面板证书文件读取失败，请检查服务器配置' })
    }

    // 创建 undici Agent（携带面板的 Client 证书）
    const panelAgent = new Agent({
      connect: {
        cert,
        key,
        rejectUnauthorized: false  // 首次连接必须忽略宿主机的自签名证书错误
      }
    })

    try {
      // 证书模式：证书已在安装脚本中导入，直接测试连接
      request.log.info(`Attempting to verify host at ${baseUrl}`)

      // 直接获取资源信息（测试连接）
      const resourcesUrl = `${baseUrl}/1.0/resources`
      const serverInfoUrl = `${baseUrl}/1.0`
      
      const resourcesRes = await undiciRequest(resourcesUrl, {
        method: 'GET',
        dispatcher: panelAgent
      })
      const resourcesText = await resourcesRes.body.text()
      
      // 只在解析失败时记录错误日志
      let resourcesData
      try {
        resourcesData = JSON.parse(resourcesText)
      } catch {
        console.error('[Incus API Error]', {
          method: 'GET',
          url: resourcesUrl,
          statusCode: resourcesRes.statusCode,
          error: `解析响应失败: ${resourcesText.substring(0, 200)}`
        })
        throw new Error(`无效的响应: ${resourcesText.substring(0, 100)}`)
      }
      const resources = resourcesData?.metadata || {}

      const serverInfoRes = await undiciRequest(serverInfoUrl, {
        method: 'GET',
        dispatcher: panelAgent
      })
      const serverInfoText = await serverInfoRes.body.text()
      let serverInfoData
      try {
        serverInfoData = JSON.parse(serverInfoText)
      } catch {
        console.error('[Incus API Error]', {
          method: 'GET',
          url: serverInfoUrl,
          statusCode: serverInfoRes.statusCode,
          error: `解析响应失败: ${serverInfoText.substring(0, 200)}`
        })
        throw new Error(`无效的服务器信息响应: ${serverInfoText.substring(0, 100)}`)
      }
      const hostArchitecture = normalizeArchitecture(
        serverInfoData?.metadata?.environment?.kernel_architecture ||
        serverInfoData?.metadata?.environment?.architectures?.[0]
      )

      // 获取磁盘大小
      let diskTotalBytes = 0
      if (resources.storage?.disks && Array.isArray(resources.storage.disks)) {
        diskTotalBytes = resources.storage.disks.reduce((sum: number, disk: { size?: number }) => sum + (disk.size || 0), 0)
      }
      if (diskTotalBytes === 0 && resources.storage?.pools) {
        for (const pool of Object.values(resources.storage.pools)) {
          const poolData = pool as { space?: { total?: number } }
          diskTotalBytes += poolData.space?.total || 0
        }
      }
      if (diskTotalBytes === 0) {
        diskTotalBytes = 1024 * 1024 * 1024 * 1024 // 默认 1TB
      }

      const cpuTotal = resources.cpu?.total || 0
      const memoryTotalMB = Math.round((resources.memory?.total || 0) / 1024 / 1024)
      const diskTotalMB = Math.round(diskTotalBytes / 1024 / 1024)

      // 自动检测宿主机公网 IPv6 地址
      const detectedIpv6 = extractHostPublicIpv6FromResources(resources)

      // 只更新连接状态和证书路径，不覆盖任何用户输入的信息
      const updateData: Record<string, unknown> = {
        status: 'online',
        isInstalled: true,
        installToken: null,  // 清空 installToken（已不再需要）
        installTokenExpire: null,
        certDownloadCount: 0,  // 重置下载次数
        certDownloadExpire: null,  // 清空证书下载有效期
        certPath: certPath,
        keyPath: keyPath,
        architecture: hostArchitecture
      }
      // 仅在检测到 IPv6 且当前未手动配置时自动填入
      if (detectedIpv6) {
        const currentHost = await prisma.host.findUnique({
          where: { id: hostId },
          select: { natPublicIpv6: true }
        })
        if (!currentHost?.natPublicIpv6) {
          updateData.natPublicIpv6 = detectedIpv6
          request.log.info(`Auto-detected host IPv6: ${detectedIpv6} for host ${host.name}`)
        }
      }
      await prisma.host.update({
        where: { id: hostId },
        data: updateData
      })

      await createLog(
        user.id,
        'host',
        'host.verify',
        `Verified and connected host "${host.name}" [arch: ${hostArchitecture}, CPU: ${cpuTotal} cores, Memory: ${Math.round(memoryTotalMB / 1024)}GB, Disk: ${Math.round(diskTotalMB / 1024)}GB]`,
        'success'
      )

      return {
        success: true,
        message: '纳管成功',
        resources: {
          cpuTotal,
          memoryTotalGB: Math.round(memoryTotalMB / 1024),
          diskTotalGB: Math.round(diskTotalMB / 1024)
        },
        architecture: hostArchitecture
      }

    } catch (err: any) {
      const errorMessage = err.message || String(err)
      request.log.error({ err, baseUrl }, 'Host verification failed')

      // 根据错误类型返回友好提示
      if (errorMessage.includes('ECONNREFUSED')) {
        return reply.code(400).send({
          error: `连接被拒绝：请检查宿主机防火墙是否放行 TCP ${hostPort} 端口，以及 Incus 服务是否正在运行`
        })
      }
      if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNRESET')) {
        return reply.code(400).send({
          error: '连接超时：请检查网络连通性和防火墙设置'
        })
      }
      if (errorMessage.includes('not authorized') || errorMessage.includes('certificate') || errorMessage.includes('unauthorized')) {
        return reply.code(400).send({
          error: '认证失败：证书未正确导入，请确认安装脚本已正确执行并成功导入面板证书'
        })
      }

      return reply.code(400).send({
        error: `连接失败：${errorMessage}`
      })
    } finally {
      // 关闭 agent
      await panelAgent.close()
    }
  })

  // 重新生成安装命令（在线/离线节点均可重新安装）
  fastify.post<{ Params: { id: string } }>('/:id/regenerate-install', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取宿主机信息
    const host = await prisma.host.findUnique({
      where: { id: hostId },
      select: {
        id: true,
        name: true,
        url: true,
        status: true,
        userId: true,
        ipv6Mode: true
      }
    })

    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或节点所有者
    if (host.userId !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 生成新的 installToken
    const installToken = randomUUID()
    const installTokenExpire = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24小时有效

    // 更新数据库
    await prisma.host.update({
      where: { id: hostId },
      data: {
        installToken,
        installTokenExpire,
        isInstalled: false,
        certPath: null,
        keyPath: null
      }
    })

    // 生成安装命令（面板地址和 token 自动注入脚本）
    const panelUrl = derivePanelUrl(request)
    const installCommand = buildHostInstallCommand(panelUrl, installToken)

    await createLog(
      user.id,
      'host',
      'host.regenerate_install',
      `Regenerated install command for host "${host.name}"`,
      'success'
    )

    return {
      success: true,
      installCommand,
      installToken,
      message: '安装命令已重新生成，请在24小时内完成安装'
    }
  })

  // 测试宿主机连接（支持节点所有者）
  fastify.post<{ Params: { id: string } }>('/:id/test', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)

    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或节点所有者
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (!host.cert_path || !host.key_path) {
      return reply.code(400).send(apiError(ErrorCode.HOST_CERT_NOT_CONFIGURED))
    }

    try {
      const client = new IncusClient({
        url: host.url,
        certPath: host.cert_path,
        keyPath: host.key_path
      })

      // 仅测试连通性：尝试连接并获取服务器信息
      const serverInfo = await client.connect() as {
        api_version?: string
        environment?: {
          server_name?: string
          kernel_architecture?: string
          architectures?: string[]
        }
      }

      const hostArchitecture = normalizeArchitecture(
        serverInfo.environment?.kernel_architecture ||
        serverInfo.environment?.architectures?.[0]
      )

      await db.updateHostResources(hostId, {
        architecture: hostArchitecture
      })

      await client.close()

      return {
        success: true,
        message: 'Connection successful',
        serverInfo: {
          apiVersion: serverInfo.api_version,
          environment: serverInfo.environment?.server_name,
          architecture: hostArchitecture
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      return reply.code(400).send({
        success: false,
        error: errorMessage
      })
    }
  })

  // 获取宿主机详情（支持节点所有者）
  fastify.get<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)

    if (!host) {
      // 添加调试日志，帮助排查 HOST_NOT_FOUND 问题
      console.warn(`[HOST_NOT_FOUND] GET /hosts/${id} - hostId=${hostId}, userId=${user.id}, username=${user.username}`)
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或节点所有者
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取该宿主机上的实例列表
    const instances = await db.getInstancesByHost(hostId)

    // 计算 diskTotal：优先使用存储池的实际大小
    let diskTotalMB = host.storage_size ? host.storage_size * 1024 : (host.disk_total || 0) // 默认值：使用创建时输入的存储大小（GB转MB）
    
    // 如果宿主机在线，尝试从存储池获取实际大小
    if (host.status === 'online' && host.cert_path && host.key_path) {
      try {
        const client = await getIncusClient(host)
        // 获取所有系统盘存储池（purpose = 'instance_data'）
        const systemPools = await db.getSystemDiskPoolsByHostId(hostId)
        
        if (systemPools.length > 0) {
          let totalBytes = 0
          // 从 Incus API 获取每个存储池的大小并累加
          for (const pool of systemPools) {
            try {
              const poolResources = await getStoragePoolResources(client, pool.name)
              if (poolResources.space?.total) {
                totalBytes += poolResources.space.total
              }
            } catch (err) {
              // 单个存储池获取失败，跳过
              console.warn(`Failed to get resources for storage pool ${pool.name}:`, err)
            }
          }
          
          // 如果成功获取到存储池大小，使用实际值（字节转MB）
          if (totalBytes > 0) {
            diskTotalMB = Math.round(totalBytes / 1024 / 1024)
          }
        }
      } catch (err) {
        // 无法连接宿主机或获取存储池信息，使用默认值
        console.warn(`Failed to get storage pool sizes for host ${hostId}:`, err)
      }
    }

    // 获取节点组信息
    return {
      host: {
        id: host.id,
        name: host.name,
        url: host.url,
        status: host.status,
        maintenance: host.status === 'maintenance',
        location: host.location,
        countryCode: host.country_code || 'us',
        architecture: host.architecture || 'x86_64',
        certPath: host.cert_path || '',
        keyPath: host.key_path || '',
        resources: {
          cpuUsed: host.cpu_used,
          memoryUsed: host.memory_used,
          diskTotal: diskTotalMB, // 使用存储池的实际大小，如果无法获取则使用默认值
          diskUsed: host.disk_used
        },
        cpuAllowanceMax: host.cpu_allowance_max || 0,
        memoryMax: host.memory_max || 0,
        instanceType: host.instance_type || 'container',
        natConfig: {
          publicIp: host.nat_public_ip,
          publicIpv6: host.nat_public_ipv6,
          bindIp: (host as any).nat_bind_ip || null,
          bindIpv6: (host as any).nat_bind_ipv6 || null,
          portRangeStart: host.nat_port_start,
          portRangeEnd: host.nat_port_end
        },
        // 初始化配置字段
        ipAddress: host.ip_address || undefined,
        storageDriver: host.storage_driver || undefined,
        storageType: host.storage_type || undefined,
        storagePath: host.storage_path || undefined,
        storageSize: host.storage_size || undefined,
        ipv6Mode: host.ipv6_mode || undefined,
        ipv6Subnet: host.ipv6_subnet || undefined,
        ipv6Gateway: host.ipv6_gateway || undefined,
        ipv6ParentInterface: host.ipv6_parent_interface || undefined,
        enableApi: host.enable_api !== undefined ? host.enable_api : undefined,
        sysctlConfig: host.sysctl_config || undefined,
        transferEnabled: host.transfer_enabled !== undefined ? host.transfer_enabled : true,
        trafficResetDay: host.traffic_reset_day ?? 1,
        notifyPurchase: host.notify_purchase !== undefined ? host.notify_purchase : true,
        notifyRenew: host.notify_renew !== undefined ? host.notify_renew : true,
        notifyDestroy: host.notify_destroy !== undefined ? host.notify_destroy : false,
        enableResourcePool: host.enable_resource_pool !== undefined ? host.enable_resource_pool : true,
        announcement: host.announcement || null,
        probeUrl: host.probe_url || null,
        instances: instances.map((i: unknown) => {
          const instance = i as { id: number; name: string; status: string }
          return {
            id: instance.id,
            name: instance.name,
            status: instance.status
          }
        })
      }
    }
  })

  // 获取节点镜像白名单配置（管理员或节点所有者）
  fastify.get<{ Params: { id: string } }>('/:id/images', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const selection = await db.getHostImageSelectionState(hostId)
    if (!selection) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    return {
      success: true,
      host: {
        id: selection.hostId,
        name: selection.hostName,
        architecture: selection.architecture,
        instanceType: selection.instanceType
      },
      useDefault: selection.useDefault,
      allowedImageIds: selection.allowedImageIds,
      images: selection.images.map(image => ({
        id: image.id,
        name: image.name,
        remoteAlias: image.remoteAlias,
        osType: image.osType,
        architecture: image.architecture,
        instanceType: image.instanceType,
        icon: image.icon,
        sortOrder: image.sortOrder,
        hidden: image.hidden
      }))
    }
  })

  // 保存节点镜像白名单配置（管理员或节点所有者）
  fastify.put<{
    Params: { id: string }
    Body: {
      useDefault: boolean
      imageIds?: number[]
    }
  }>('/:id/images', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['useDefault'],
        properties: {
          useDefault: { type: 'boolean' },
          imageIds: {
            type: 'array',
            items: { type: 'integer' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const selection = await db.saveHostAllowedImages(hostId, request.body.useDefault, request.body.imageIds || [])
      if (!selection) {
        return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
      }

      await createLog(
        user.id,
        'host',
        'host.image_policy',
        selection.useDefault
          ? `Reset image policy for host "${selection.hostName}" to default`
          : `Updated image policy for host "${selection.hostName}" with ${selection.allowedImageIds.length} image(s)`,
        'success'
      )

      return {
        success: true,
        message: selection.useDefault ? 'Host image policy reset to default' : 'Host image policy updated',
        host: {
          id: selection.hostId,
          name: selection.hostName,
          architecture: selection.architecture,
          instanceType: selection.instanceType
        },
        useDefault: selection.useDefault,
        allowedImageIds: selection.allowedImageIds,
        images: selection.images.map(image => ({
          id: image.id,
          name: image.name,
          remoteAlias: image.remoteAlias,
          osType: image.osType,
          architecture: image.architecture,
          instanceType: image.instanceType,
          icon: image.icon,
          sortOrder: image.sortOrder,
          hidden: image.hidden
        }))
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('INVALID_IMAGE_FOR_HOST:')) {
        return reply.code(400).send(apiError(ErrorCode.IMAGE_INVALID_HOST_ID))
      }
      throw error
    }
  })

  // 更新宿主机配置（管理员或节点所有者）
  fastify.patch<{
    Params: { id: string }
    Body: UpdateHostRequest & {
      tags?: string[]
      natConfig?: { publicIp?: string; publicIpv6?: string; bindIp?: string; bindIpv6?: string; portRangeStart?: number; portRangeEnd?: number }
      cpuAllowanceMax?: number
      memoryMax?: number
      instanceType?: 'container' | 'vm' | 'both'
      ipv6ParentInterface?: string
      ipv6Subnet?: string
      transferEnabled?: boolean
      trafficResetDay?: number
      enableResourcePool?: boolean
      announcement?: string | null
      probeUrl?: string | null
    }
  }>('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          url: { type: 'string' },
          location: { type: 'string' },
          countryCode: { type: 'string', minLength: 2, maxLength: 2 },
          certPath: { type: 'string' },
          keyPath: { type: 'string' },
          natConfig: { type: 'object' },
          cpuAllowanceMax: { type: 'integer' },
          memoryMax: { type: 'integer' },
          instanceType: { type: 'string', enum: ['container', 'vm', 'both'] },
          ipv6ParentInterface: { type: 'string' },
          ipv6Subnet: { type: 'string' },
          transferEnabled: { type: 'boolean' },
          trafficResetDay: { type: 'integer', minimum: 1, maximum: 28 },
          notifyPurchase: { type: 'boolean' },
          notifyRenew: { type: 'boolean' },
          notifyDestroy: { type: 'boolean' },
          enableResourcePool: { type: 'boolean' },
          announcement: { type: ['string', 'null'], maxLength: 1000 },
          probeUrl: { type: ['string', 'null'], maxLength: 500 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: UpdateHostRequest & {
      tags?: string[]
      natConfig?: { publicIp?: string; publicIpv6?: string; bindIp?: string; bindIpv6?: string; portRangeStart?: number; portRangeEnd?: number }
      cpuAllowanceMax?: number
      memoryMax?: number
      instanceType?: 'container' | 'vm' | 'both'
      ipv6ParentInterface?: string
      ipv6Subnet?: string
      transferEnabled?: boolean
      trafficResetDay?: number
      notifyPurchase?: boolean
      notifyRenew?: boolean
      notifyDestroy?: boolean
      enableResourcePool?: boolean
      announcement?: string | null
      probeUrl?: string | null
    }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const updates = request.body

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或节点所有者
    if (host.user_id !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (updates.name !== undefined) {
      const nameValidation = validateIdentifier(updates.name, 'Host name', 2, 64)
      if (!nameValidation.valid) {
        return reply.code(400).send({ error: nameValidation.message })
      }

      if (request.user.role !== 'admin') {
        const userIdPrefix = `PEER${request.user.id}`
        const validPrefixPattern = new RegExp(`^${userIdPrefix}[-_]`, 'i')
        if (!validPrefixPattern.test(updates.name)) {
          return reply.code(400).send({
            error: `Node name must start with your user ID prefix: ${userIdPrefix}-`,
            code: 'INVALID_HOST_NAME_PREFIX'
          })
        }
      }

      const duplicateHost = await db.getHostByUserAndName(host.user_id!, updates.name)
      if (duplicateHost && duplicateHost.id !== hostId) {
        return reply.code(400).send(apiError(ErrorCode.HOST_NAME_EXISTS))
      }
    }

    if (updates.url !== undefined) {
      const urlValidation = validateUrl(updates.url, 'Host URL')
      if (!urlValidation.valid) {
        return reply.code(400).send({ error: urlValidation.message })
      }

      const hostAddressValidation = validateIpOrDomain(new URL(urlValidation.sanitized || updates.url).hostname, 'Host address')
      if (!hostAddressValidation.valid) {
        return reply.code(400).send({ error: hostAddressValidation.message })
      }
    }

    if (updates.location !== undefined && updates.location) {
      const locationValidation = validateName(updates.location, 'Location', 1, 100)
      if (!locationValidation.valid) {
        return reply.code(400).send({ error: locationValidation.message })
      }
    }

    // 验证最小值限制 - 由于 cpu_total 字段已删除，不再检查 CPU 最小值限制
    // 用户可以自由设置 CPU 配额上限

    if (updates.memoryMax !== undefined) {
      const minMemory = 256
      if (updates.memoryMax > 0 && updates.memoryMax < minMemory) {
        return reply.code(400).send({
          error: `内存最大值不能低于256MB`
        })
      }
    }

    // 检查新配置是否低于实例已使用的资源
    const usedResources = await db.calculateHostResourcesFromInstances(hostId)

    if (updates.cpuAllowanceMax !== undefined && updates.cpuAllowanceMax > 0) {
      if (updates.cpuAllowanceMax < usedResources.cpuUsed) {
        return reply.code(400).send(apiError(ErrorCode.HOST_CPU_BELOW_USED, `当前已使用: ${usedResources.cpuUsed}%`))
      }
    }

    if (updates.memoryMax !== undefined && updates.memoryMax > 0) {
      if (updates.memoryMax < usedResources.memoryUsed) {
        return reply.code(400).send(apiError(ErrorCode.HOST_MEMORY_BELOW_USED, `当前已使用: ${usedResources.memoryUsed}MB`))
      }
    }

    let normalizedNatPublicIp: string | null | undefined = undefined
    let normalizedNatBindIp: string | null | undefined = undefined
    let normalizedNatBindIpv6: string | null | undefined = undefined
    const normalizedIpv6ParentInterface = updates.ipv6ParentInterface === undefined
      ? undefined
      : (updates.ipv6ParentInterface.trim() || null)
    const normalizedIpv6Subnet = updates.ipv6Subnet === undefined
      ? undefined
      : (updates.ipv6Subnet.trim() || null)
    if (updates.natConfig && 'publicIp' in updates.natConfig) {
      const nextNatPublicIp = updates.natConfig.publicIp?.trim()
      if (nextNatPublicIp) {
        const ipValidation = validateIpAddress(nextNatPublicIp, 'NAT public IP')
        if (!ipValidation.valid) {
          return reply.code(400).send({ error: ipValidation.message })
        }
        normalizedNatPublicIp = ipValidation.sanitized || nextNatPublicIp
      } else {
        normalizedNatPublicIp = null
      }
    }
    if (updates.natConfig && 'bindIp' in updates.natConfig) {
      const nextNatBindIp = updates.natConfig.bindIp?.trim()
      if (nextNatBindIp) {
        const ipValidation = validateIpAddress(nextNatBindIp, 'NAT bind IP')
        if (!ipValidation.valid) {
          return reply.code(400).send({ error: ipValidation.message })
        }
        normalizedNatBindIp = ipValidation.sanitized || nextNatBindIp
      } else {
        normalizedNatBindIp = null
      }
    }

    // 处理 NAT 公网 IPv6
    let normalizedNatPublicIpv6: string | null | undefined = undefined
    if (updates.natConfig && 'publicIpv6' in updates.natConfig) {
      const nextNatPublicIpv6 = updates.natConfig.publicIpv6?.trim()
      if (nextNatPublicIpv6) {
        const ipValidation = validateIpAddress(nextNatPublicIpv6, 'NAT public IPv6')
        if (!ipValidation.valid || !(ipValidation.sanitized || nextNatPublicIpv6).includes(':')) {
          return reply.code(400).send({ error: 'Invalid NAT public IPv6 address format' })
        }
        normalizedNatPublicIpv6 = ipValidation.sanitized || nextNatPublicIpv6
      } else {
        normalizedNatPublicIpv6 = null
      }
    }
    if (updates.natConfig && 'bindIpv6' in updates.natConfig) {
      const nextNatBindIpv6 = updates.natConfig.bindIpv6?.trim()
      if (nextNatBindIpv6) {
        const ipValidation = validateIpAddress(nextNatBindIpv6, 'NAT bind IPv6')
        if (!ipValidation.valid || !(ipValidation.sanitized || nextNatBindIpv6).includes(':')) {
          return reply.code(400).send({ error: 'Invalid NAT bind IPv6 address format' })
        }
        normalizedNatBindIpv6 = ipValidation.sanitized || nextNatBindIpv6
      } else {
        normalizedNatBindIpv6 = null
      }
    }

    // 端口范围校验：结束端口不能小于起始端口
    if (updates.natConfig?.portRangeStart != null && updates.natConfig?.portRangeEnd != null) {
      if (updates.natConfig.portRangeEnd < updates.natConfig.portRangeStart) {
        return reply.code(400).send({ error: 'Port range end must be greater than or equal to start', code: 'INVALID_PORT_RANGE' })
      }
    }

    const nextIpv6Mode = host.ipv6_mode ?? 1
    const nextIpv6Subnet = normalizedIpv6Subnet !== undefined ? normalizedIpv6Subnet : (host.ipv6_subnet ?? null)
    const nextIpv6ParentInterface = normalizedIpv6ParentInterface !== undefined
      ? normalizedIpv6ParentInterface
      : (host.ipv6_parent_interface ?? null)

    if (nextIpv6Mode === 1 && (!nextIpv6Subnet || !nextIpv6ParentInterface)) {
      return reply.code(400).send(apiError(ErrorCode.HOST_IPV6_ROUTE_REQUIRES_CONFIG))
    }

    try {
      if (updates.url !== undefined) {
        await withHostAddressRegistryLock(async () => {
          const lockedSnapshot = await prepareHostAddressSnapshotForWrite(updates.url!, hostId)

          await prisma.$transaction(async tx => {
            await db.updateHost(hostId, {
              name: updates.name,
              url: updates.url,
              location: updates.location,
              countryCode: updates.countryCode,
              certPath: updates.certPath,
              keyPath: updates.keyPath,
              natPublicIp: normalizedNatPublicIp,
              natBindIp: normalizedNatBindIp,
              natBindIpv6: normalizedNatBindIpv6,
              natPortStart: updates.natConfig?.portRangeStart,
              natPortEnd: updates.natConfig?.portRangeEnd,
              ipv6ParentInterface: normalizedIpv6ParentInterface,
              ipv6Subnet: normalizedIpv6Subnet,
              trafficResetDay: updates.trafficResetDay,
              notifyPurchase: updates.notifyPurchase,
              notifyRenew: updates.notifyRenew,
              notifyDestroy: updates.notifyDestroy
            }, tx)

            if (updates.cpuAllowanceMax !== undefined || updates.memoryMax !== undefined || updates.instanceType !== undefined) {
              await db.updateHostResources(hostId, {
                cpuAllowanceMax: updates.cpuAllowanceMax,
                memoryMax: updates.memoryMax,
                instanceType: updates.instanceType
              }, tx)
            }

            if (updates.transferEnabled !== undefined) {
              await tx.host.update({
                where: { id: hostId },
                data: { transferEnabled: updates.transferEnabled }
              })
            }

            if (updates.enableResourcePool !== undefined) {
              await tx.host.update({
                where: { id: hostId },
                data: { enableResourcePool: updates.enableResourcePool }
              })
            }

            if (updates.announcement !== undefined) {
              await tx.host.update({
                where: { id: hostId },
                data: { announcement: updates.announcement || null }
              })
            }

            if (updates.probeUrl !== undefined) {
              await tx.host.update({
                where: { id: hostId },
                data: { probeUrl: updates.probeUrl || null }
              })
            }

            // 更新 NAT 公网 IPv6
            if (normalizedNatPublicIpv6 !== undefined) {
              await tx.host.update({
                where: { id: hostId },
                data: { natPublicIpv6: normalizedNatPublicIpv6 }
              })
            }
            if (normalizedNatBindIp !== undefined || normalizedNatBindIpv6 !== undefined) {
              await tx.host.update({
                where: { id: hostId },
                data: {
                  ...(normalizedNatBindIp !== undefined ? { natBindIp: normalizedNatBindIp } : {}),
                  ...(normalizedNatBindIpv6 !== undefined ? { natBindIpv6: normalizedNatBindIpv6 } : {})
                }
              })
            }

            await persistHostAddressSnapshot(hostId, lockedSnapshot, 'update', tx)
          })
        })
      } else {
        await prisma.$transaction(async tx => {
          await db.updateHost(hostId, {
            name: updates.name,
            url: updates.url,
            location: updates.location,
            countryCode: updates.countryCode,
            certPath: updates.certPath,
            keyPath: updates.keyPath,
            natPublicIp: normalizedNatPublicIp,
            natBindIp: normalizedNatBindIp,
            natBindIpv6: normalizedNatBindIpv6,
            natPortStart: updates.natConfig?.portRangeStart,
            natPortEnd: updates.natConfig?.portRangeEnd,
            ipv6ParentInterface: normalizedIpv6ParentInterface,
            ipv6Subnet: normalizedIpv6Subnet,
            trafficResetDay: updates.trafficResetDay,
            notifyPurchase: updates.notifyPurchase,
            notifyRenew: updates.notifyRenew,
            notifyDestroy: updates.notifyDestroy
          }, tx)

          if (updates.cpuAllowanceMax !== undefined || updates.memoryMax !== undefined || updates.instanceType !== undefined) {
            await db.updateHostResources(hostId, {
              cpuAllowanceMax: updates.cpuAllowanceMax,
              memoryMax: updates.memoryMax,
              instanceType: updates.instanceType
            }, tx)
          }

          if (updates.transferEnabled !== undefined) {
            await tx.host.update({
              where: { id: hostId },
              data: { transferEnabled: updates.transferEnabled }
            })
          }

          if (updates.enableResourcePool !== undefined) {
            await tx.host.update({
              where: { id: hostId },
              data: { enableResourcePool: updates.enableResourcePool }
            })
          }

          if (updates.announcement !== undefined) {
            await tx.host.update({
              where: { id: hostId },
              data: { announcement: updates.announcement || null }
            })
          }

          if (updates.probeUrl !== undefined) {
            await tx.host.update({
              where: { id: hostId },
              data: { probeUrl: updates.probeUrl || null }
            })
          }

          // 更新 NAT 公网 IPv6
          if (normalizedNatPublicIpv6 !== undefined) {
            await tx.host.update({
              where: { id: hostId },
              data: { natPublicIpv6: normalizedNatPublicIpv6 }
            })
          }
          if (normalizedNatBindIp !== undefined || normalizedNatBindIpv6 !== undefined) {
            await tx.host.update({
              where: { id: hostId },
              data: {
                ...(normalizedNatBindIp !== undefined ? { natBindIp: normalizedNatBindIp } : {}),
                ...(normalizedNatBindIpv6 !== undefined ? { natBindIpv6: normalizedNatBindIpv6 } : {})
              }
            })
          }

        })
      }
    } catch (error) {
      if (error instanceof HostAddressRegistryError) {
        if (error.errorCode === ErrorCode.HOST_ADDRESS_UNRESOLVABLE) {
          await logHostAddressResolutionFailure(request.user.id, `${host.name}(#${hostId})`, updates.url || host.url, 'update', error)
        }
        return reply.code(400).send(apiError(error.errorCode as ErrorCodeType, error.details))
      }
      throw error
    }

    // 检测节点类型变更影响的套餐
    let incompatiblePackages: Array<{ id: number; name: string; instanceType: string }> = []
    if (updates.instanceType !== undefined && updates.instanceType !== host.instance_type) {
      incompatiblePackages = await db.getIncompatiblePackagesByHostTypeChange(hostId, updates.instanceType)
    }

    // 如果证书配置或 URL 变更，移除旧连接
    if (updates.certPath || updates.keyPath || updates.url) {
      await removeIncusClient(hostId)
    }

    // 构建变更详情
    const changes: string[] = []
    if (updates.name) changes.push(`name -> "${updates.name}"`)
    if (updates.url) changes.push(`url -> ${updates.url}`)
    if (updates.location) changes.push(`location -> ${updates.location}`)
    if (updates.cpuAllowanceMax !== undefined) changes.push(`cpuMax -> ${updates.cpuAllowanceMax}%`)
    if (updates.memoryMax !== undefined) changes.push(`memoryMax -> ${updates.memoryMax}MB`)
    if (updates.instanceType) changes.push(`instanceType -> ${updates.instanceType}`)
    if (updates.natConfig?.publicIp) changes.push(`natPublicIp -> ${updates.natConfig.publicIp}`)
    if (updates.transferEnabled !== undefined) changes.push(`transferEnabled -> ${updates.transferEnabled}`)
    if (updates.trafficResetDay !== undefined) changes.push(`trafficResetDay -> ${updates.trafficResetDay}`)
    if (updates.notifyPurchase !== undefined) changes.push(`notifyPurchase -> ${updates.notifyPurchase}`)
    if (updates.notifyRenew !== undefined) changes.push(`notifyRenew -> ${updates.notifyRenew}`)
    if (updates.notifyDestroy !== undefined) changes.push(`notifyDestroy -> ${updates.notifyDestroy}`)

    await createLog(
      request.user.id,
      'host',
      'host.update',
      `Updated host "${host.name}" [${changes.length > 0 ? changes.join(', ') : 'no major changes'}]`,
      'success'
    )

    // 返回结果，如果有不兼容的套餐，返回警告
    if (incompatiblePackages.length > 0) {
      return {
        message: 'Host config updated',
        warnings: [{
          code: 'INCOMPATIBLE_PACKAGES',
          message: `节点类型变更后，以下套餐可能无法使用该节点创建实例`,
          packages: incompatiblePackages
        }]
      }
    }

    return { message: 'Host config updated' }
  })

  // 设置维护模式（管理员或节点所有者）
  fastify.post<{
    Params: { id: string }
    Body: { enabled: boolean }
  }>('/:id/maintenance', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { enabled: boolean }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { enabled } = request.body

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或节点所有者
    if (host.user_id !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const newStatus = enabled ? 'maintenance' : 'online'
    await db.updateHostStatus(hostId, newStatus)

    await createLog(
      request.user.id,
      'host',
      enabled ? 'host.maintenance.enable' : 'host.maintenance.disable',
      `${enabled ? 'Enabled' : 'Disabled'} maintenance mode for host "${host.name}"`,
      'success'
    )

    return {
      message: enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled'
    }
  })

  // 同步宿主机资源使用情况（管理员或节点所有者）
  fastify.post<{ Params: { id: string } }>('/:id/sync', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)

    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或节点所有者
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const client = await getIncusClient(host)

      // 获取资源信息（物理资源）
      const resources = await client.getResources() as {
        cpu?: { total?: number }
        memory?: { total?: number }
        storage?: {
          disks?: Array<{ size?: number }>
          pools?: Record<string, { space?: { total?: number } }>
          total?: number
        }
      }

      // 获取磁盘大小
      let diskTotalBytes = 0
      if (resources.storage?.disks && Array.isArray(resources.storage.disks) && resources.storage.disks.length > 0) {
        diskTotalBytes = resources.storage.disks.reduce((sum: number, disk: { size?: number }) => sum + (disk.size || 0), 0)
      }
      if (diskTotalBytes === 0 && resources.storage?.pools) {
        for (const pool of Object.values(resources.storage.pools)) {
          const poolData = pool as { space?: { total?: number } }
          diskTotalBytes += poolData.space?.total || 0
        }
      }
      if (diskTotalBytes === 0) {
        diskTotalBytes = 1024 * 1024 * 1024 * 1024 // 默认 1TB
      }

      // 只更新宿主机状态为在线，不覆盖任何用户输入的信息
      await db.updateHostStatus(hostId, 'online')

      // 自动检测宿主机公网 IPv6（仅在未手动配置时自动填入）
      const detectedIpv6 = extractHostPublicIpv6FromResources(resources as Record<string, unknown>)
      if (detectedIpv6 && !host.nat_public_ipv6) {
        await prisma.host.update({
          where: { id: hostId },
          data: { natPublicIpv6: detectedIpv6 }
        })
        request.log.info(`[sync] Auto-detected host IPv6: ${detectedIpv6} for host ${host.name}`)
      }

      // 基于数据库实例统计已用资源（排除已删除的实例）
      const usedResources = await db.calculateHostResourcesFromInstances(hostId)

      // 只更新资源使用情况（已用资源），不修改用户设置的上限
      await db.updateHostResources(hostId, {
        cpuUsed: usedResources.cpuUsed,
        memoryUsed: usedResources.memoryUsed,
        diskUsed: usedResources.diskUsed
      })

      // 获取实例数量（用于返回）
      const instanceCount = await db.getInstanceCountByHost(hostId)

      return {
        message: 'Sync completed',
        instances: instanceCount,
        resources: {
          cpuUsed: usedResources.cpuUsed,
          memoryUsed: usedResources.memoryUsed,
          diskUsed: usedResources.diskUsed
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return reply.code(500).send({ error: errorMessage })
    }
  })

  // 批量删除实例预览（计算退款信息）
  fastify.post<{
    Params: { id: string }
    Body: { instanceIds: number[] }
  }>('/:id/instances/batch-delete-preview', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const { instanceIds } = request.body
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证节点存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以操作
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取所有实例
    const instances = await prisma.instance.findMany({
      where: {
        id: { in: instanceIds },
        hostId: hostId,
        status: { not: 'deleted' }
      },
      include: {
        user: {
          select: { id: true, username: true }
        }
      }
    })

    // 计算每个实例的退款信息
    const instancePreviews = await Promise.all(instances.map(async (instance) => {
      const refundInfo = await db.calculateInstanceRefund({
        id: instance.id,
        billingPrice: instance.billingPrice,
        billingCycle: instance.billingCycle,
        expiresAt: instance.expiresAt,
        packagePlanId: instance.packagePlanId
      })
      
      return {
        id: instance.id,
        name: instance.name,
        username: instance.user.username,
        userId: instance.user.id,
        isOwnInstance: instance.userId === host.user_id,
        isPaid: refundInfo.isPaid,
        remainingDays: refundInfo.remainingDays,
        refundAmount: refundInfo.refundAmount
      }
    }))

    // 计算总退款金额（仅计算他人的付费实例）
    const totalRefundAmount = instancePreviews
      .filter(p => !p.isOwnInstance && p.isPaid)
      .reduce((sum, p) => sum + p.refundAmount, 0)

    return {
      instances: instancePreviews,
      totalRefundAmount: Number(totalRefundAmount.toFixed(2))
    }
  })

  // 批量删除宿主机上的实例（管理员或节点所有者）
  fastify.delete<{
    Params: { id: string }
    Body: { instanceIds: number[]; reason?: string; databaseOnly?: boolean }
  }>('/:id/instances/batch', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          },
          reason: { type: 'string', maxLength: 500 },
          databaseOnly: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const { instanceIds, reason, databaseOnly } = request.body
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证节点存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以批量删除
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取所有实例并验证它们属于该节点
    const instances = await prisma.instance.findMany({
      where: {
        id: { in: instanceIds },
        hostId: hostId,
        status: { not: 'deleted' }
      }
    })

    if (instances.length === 0) {
      return reply.code(400).send({ error: '没有找到可删除的实例' })
    }

    const results: { id: number; name: string; success: boolean; error?: string; refundAmount?: number }[] = []
    let totalRefundAmount = 0
    let client: IncusClient | null = null
    const deferredNotifications: Array<() => Promise<void>> = []

    if (!databaseOnly) {
      try {
        client = await getIncusClient(host)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        fastify.log.error(`获取 Incus 客户端失败: ${errorMessage}`)
        return reply.code(502).send({
          error: `获取 Incus 客户端失败: ${errorMessage}`,
          code: 'INCUS_CLIENT_UNAVAILABLE'
        })
      }
    }

    // 导入必要的函数
    const incusInstanceOperations = databaseOnly
      ? null
      : await import('../lib/incus/index.js')
    const { getProxySitesByInstanceId, deleteProxySite } = await import('../db/proxy-sites.js')
    const incusSnapshotOperations = databaseOnly
      ? null
      : await import('../lib/incus/incus-snapshots.js')
    const incusBackupOperations = databaseOnly
      ? null
      : await import('../lib/incus/incus-backups.js')

    for (const instance of instances) {
      try {
        // ===== 0. 检查转移锁定、恢复任务和上传任务 =====
        // 注意：批量删除接口只允许宿主机拥有者调用，所以不需要检查套餐限制
        const hasPendingTransfer = await db.hasPendingTransfer(instance.id)
        if (hasPendingTransfer) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '实例有待处理的转移请求' })
          continue
        }

        const activeRestoreTask = await prisma.restoreTask.findFirst({
          where: { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] } }
        })
        if (activeRestoreTask) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '实例有正在进行的恢复任务' })
          continue
        }

        const activeUploadTask = await prisma.backupUploadTask.findFirst({
          where: { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] } }
        })
        if (activeUploadTask) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '实例有正在进行的上传任务' })
          continue
        }

        if (!databaseOnly) {
          const claimed = await claimHostBatchInstanceForDelete(instance.id, instance.status as InstanceStatus)
          if (!claimed) {
            results.push({ id: instance.id, name: instance.name, success: false, error: '实例正在删除或有正在进行的任务' })
            continue
          }
        }

        // ===== 1. 删除反代站点（完整删除清 Caddy，DB-only 只清数据库）=====
        const proxySites = await getProxySitesByInstanceId(instance.id)
        if (proxySites.length > 0) {
          // 仅完整删除模式尝试删除 Caddy 远程配置；DB-only 无论宿主机是否在线都不碰远端。
          if (!databaseOnly && host.caddy_enabled && host.caddy_username && host.caddy_password) {
            const targetHost = host.nat_public_ip || host.ip_address
            if (targetHost) {
              const caddyClient = createCaddyClient({
                host: targetHost,
                port: host.caddy_port || 8444,
                username: host.caddy_username,
                password: host.caddy_password
              })
              for (const site of proxySites) {
                try {
                  await caddyClient.deleteSite(site.domain)
                } catch (caddyError) {
                  // 忽略 Caddy 删除错误
                }
              }
            }
          }
        }

        // ===== 2. 删除端口映射（完整删除清 Incus 设备，DB-only 只清数据库）=====
        const portMappings = await db.getPortMappings(instance.id)
        if (portMappings && portMappings.length > 0) {
          for (const mapping of portMappings) {
            const map = mapping as { id: number; protocol: string; public_port: number }
            // 仅完整删除模式尝试删除 Incus 设备；DB-only 无论宿主机是否在线都不碰远端。
            if (client && incusInstanceOperations) {
              const deviceName = `proxy-${map.protocol}-${map.public_port}`
              try {
                await incusInstanceOperations.removeDevice(client, instance.incusId, deviceName)
              } catch (deviceError) {
                // 忽略设备删除错误
              }
            }
          }
        }

        // ===== 3. 删除快照（完整删除清 Incus 快照，DB-only 只清数据库）=====
        const snapshots = await db.getSnapshotsByInstanceId(instance.id)
        if (snapshots.length > 0) {
          for (const snapshot of snapshots) {
            // 仅完整删除模式尝试删除 Incus 快照；DB-only 无论宿主机是否在线都不碰远端。
            if (client && incusSnapshotOperations) {
              try {
                await incusSnapshotOperations.deleteSnapshot(client, instance.incusId, snapshot.incus_name)
              } catch (snapshotError) {
                // 忽略快照删除错误
              }
            }
          }
        }

        // ===== 4. 删除备份（完整删除清 Incus 备份，DB-only 只清数据库）=====
        const backups = await db.getBackupsByInstanceId(instance.id)
        if (backups.length > 0) {
          for (const backup of backups) {
            // 仅完整删除模式尝试删除 Incus 备份；DB-only 无论宿主机是否在线都不碰远端。
            if (client && incusBackupOperations) {
              try {
                await incusBackupOperations.deleteBackup(client, instance.incusId, backup.incus_name)
              } catch (backupError) {
                // 忽略备份删除错误
              }
            }
          }
        }

        // ===== 5. 停止并删除 Incus 实例（完整删除模式专属）=====
        if (!databaseOnly && client && incusInstanceOperations) {
          try {
            await deleteIncusInstanceForHostBatch(client, incusInstanceOperations, instance, fastify.log)
          } catch (incusError) {
            await restoreHostBatchDeleteClaim(instance.id, instance.status as InstanceStatus)
            throw incusError
          }
        }

        // ===== 6. 处理退款（节点所有者删除他人的付费实例时）=====
        let refundAmount = 0
        if (instance.userId !== host.user_id) {
          // 删除的是他人的实例，检查是否需要退款
          const refundInfo = await db.calculateInstanceRefund({
            id: instance.id,
            billingPrice: instance.billingPrice,
            billingCycle: instance.billingCycle,
            expiresAt: instance.expiresAt,
            packagePlanId: instance.packagePlanId
          })

          if (refundInfo.isPaid && refundInfo.refundAmount > 0) {
            refundAmount = refundInfo.refundAmount

            // 执行退款事务
            await prisma.$transaction(async (tx) => {
              await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)

              // 获取用户当前余额
              const instanceOwner = await tx.user.findUnique({
                where: { id: instance.userId },
                select: { balance: true }
              })
              const oldBalance = Number(instanceOwner?.balance || 0)

              // 退款给实例所有者
              const updatedUser = await tx.user.update({
                where: { id: instance.userId },
                data: { balance: { increment: refundAmount } },
                select: { balance: true }
              })
              const newBalance = Number(updatedUser.balance)

              // 记录余额日志
              await tx.balanceLog.create({
                data: {
                  userId: instance.userId,
                  type: 'refund',
                  amount: refundAmount,
                  balanceBefore: oldBalance,
                  balanceAfter: newBalance,
                  instanceId: instance.id,
                  remark: `托管实例被删除退款：${instance.name}`
                }
              })

              // 从节点所有者托管余额扣除
              await db.deductHostingBalance(
                hostId,
                refundAmount,
                instance.id,
                `删除托管实例退款扣除：${instance.name}`,
                tx
              )
            })

            totalRefundAmount += refundAmount
          }
        }

        // ===== 7. 删除数据库附属记录 =====
        for (const site of proxySites) {
          await deleteProxySite(site.id)
        }
        for (const mapping of portMappings || []) {
          await db.deletePortMapping((mapping as { id: number }).id)
        }
        for (const snapshot of snapshots) {
          await db.deleteSnapshot(snapshot.id)
        }
        for (const backup of backups) {
          await db.deleteBackup(backup.id)
        }

        // ===== 7.1 删除快照策略和备份策略 =====
        try {
          await prisma.snapshotPolicy.deleteMany({ where: { instanceId: instance.id } })
          await prisma.backupPolicy.deleteMany({ where: { instanceId: instance.id } })
        } catch (policyError) {
          // 忽略策略删除错误
        }

        // ===== 7.2 删除流量相关记录 =====
        try {
          await prisma.trafficSnapshot.deleteMany({ where: { instanceId: instance.id } })
          await prisma.dailyTraffic.deleteMany({ where: { instanceId: instance.id } })
        } catch (trafficError) {
          // 忽略流量记录删除错误
        }

        // ===== 7.3 删除 IP 地址和 IPv6 网段记录 =====
        try {
          await prisma.ipAddress.deleteMany({ where: { instanceId: instance.id } })
          await prisma.ipv6Subnet.deleteMany({ where: { instanceId: instance.id } })
        } catch (ipError) {
          // 忽略 IP 记录删除错误
        }

        // ===== 7.4 删除历史任务记录（已完成/失败的恢复任务和上传任务）=====
        try {
          await prisma.restoreTask.deleteMany({ 
            where: { instanceId: instance.id, status: { in: ['COMPLETED', 'FAILED'] } } 
          })
          await prisma.backupUploadTask.deleteMany({ 
            where: { instanceId: instance.id, status: { in: ['COMPLETED', 'FAILED'] } } 
          })
        } catch (taskError) {
          // 忽略任务记录删除错误
        }

        // ===== 7.5 取消待处理的转移请求 =====
        try {
          await prisma.instanceTransfer.updateMany({
            where: { instanceId: instance.id, status: 'pending' },
            data: { status: 'cancelled', cancelledAt: new Date() }
          })
        } catch (transferError) {
          // 忽略转移请求取消错误
        }

        // ===== 8. 更新实例状态为 deleted =====
        await db.updateInstanceStatus(instance.id, 'deleted')

        // ===== 9. 释放资源配额 =====
        const portMappingsCount = portMappings?.length || 0
        await db.rollbackResources({
          hostId: instance.hostId,
          cpu: instance.cpu,
          memory: instance.memory,
          disk: instance.disk,
          portCount: portMappingsCount
        })

        // ===== 10. 发送删除通知给实例所有者 =====
        // 如果提供了删除原因，发送特定通知
        const deleteReason = reason?.trim()
        const sendDeleteNotification = () => deleteReason
          ? sendNotification(instance.userId, 'instance_deleted_by_host_owner', {
              instanceName: instance.name,
              hostName: host.name,
              deleteReason
            })
          : sendNotification(instance.userId, 'instance_deleted', {
              instanceName: instance.name,
              hostName: host.name
            })

        // DB-only 是强制仅数据库模式，无论宿主机是否在线都不等待外部通知渠道。
        if (databaseOnly) {
          deferredNotifications.push(async () => {
            try {
              await sendDeleteNotification()
            } catch (notifyError) {
              const errorMessage = notifyError instanceof Error ? notifyError.message : String(notifyError)
              fastify.log.warn(`异步发送删除通知失败 (${instance.name}): ${errorMessage}`)
            }
          })
        } else {
          await sendDeleteNotification()
        }

        results.push({ id: instance.id, name: instance.name, success: true, refundAmount: refundAmount > 0 ? refundAmount : undefined })

        await createLog(
          user.id,
          'instance',
          'instance.batch_delete',
          `Batch deleted instance "${instance.name}" on host "${host.name}"${refundAmount > 0 ? ` (refund: ¥${refundAmount.toFixed(2)})` : ''}`,
          'success'
        )
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        results.push({ id: instance.id, name: instance.name, success: false, error: errorMessage })
        fastify.log.error(`批量删除实例失败 (${instance.name}): ${errorMessage}`)
      }
    }

    // ===== 批量删除完成后，按 packageId 汇总发送资源释放通知 =====
    const releaseMap = new Map<number, { cpu: number; memory: number; count: number }>()
    for (const instance of instances) {
      const result = results.find(r => r.id === instance.id)
      if (result?.success && instance.packageId) {
        const existing = releaseMap.get(instance.packageId) || { cpu: 0, memory: 0, count: 0 }
        existing.cpu += instance.cpu
        existing.memory += instance.memory
        existing.count += 1
        releaseMap.set(instance.packageId, existing)
      }
    }
    for (const [packageId, released] of releaseMap) {
      sendReleaseNotification({
        packageId,
        cpu: released.cpu,
        memory: released.memory,
        source: `节点所有者批量删除 ${released.count} 个实例`
      }).catch(() => {})
    }

    // 重新计算宿主机资源使用量（包括端口）
    try {
      const usedResources = await db.calculateHostResourcesFromInstances(hostId)
      // 重新计算端口映射使用量
      const actualPortsUsed = await prisma.portMapping.count({
        where: {
          instance: {
            hostId: hostId,
            status: { not: 'deleted' }
          }
        }
      })
      await db.updateHostResources(hostId, {
        cpuUsed: usedResources.cpuUsed,
        memoryUsed: usedResources.memoryUsed,
        diskUsed: usedResources.diskUsed
      })
      // 更新端口使用量
      await prisma.host.update({
        where: { id: hostId },
        data: { natPortsUsedCount: actualPortsUsed }
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      fastify.log.error(`更新宿主机资源失败: ${errMsg}`)
    }

    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length

    if (deferredNotifications.length > 0) {
      setImmediate(() => {
        for (const sendDeferredNotification of deferredNotifications) {
          void sendDeferredNotification()
        }
      })
    }

    return {
      message: `成功删除 ${successCount} 个实例${failedCount > 0 ? `，${failedCount} 个失败` : ''}${totalRefundAmount > 0 ? `，共退款 ¥${totalRefundAmount.toFixed(2)}` : ''}`,
      results,
      successCount,
      failedCount,
      totalRefundAmount: Number(totalRefundAmount.toFixed(2))
    }
  })

  // 删除宿主机（管理员或节点所有者）
  fastify.delete<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或节点所有者
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查是否有运行中的实例
    const instanceCount = await db.getInstanceCountByHost(hostId)
    if (instanceCount > 0) {
      return reply.code(400).send({
        error: `该宿主机上还有 ${instanceCount} 个实例，请先删除或迁移实例`
      })
    }

    // 移除连接
    await removeIncusClient(hostId)

    // 删除记录
    await db.deleteHost(hostId)

    // 注意：已取消配额限制，不再更新 hostUsed

    await createLog(
      request.user.id,
      'host',
      'host.delete',
      `Deleted host "${host.name}" [url: ${host.url}, location: ${host.location || 'N/A'}]`,
      'success'
    )

    return { message: 'Host deleted' }
  })

  // ============ 存储池管理 API ============

  // 获取宿主机存储池列表
  fastify.get<{ Params: { id: string } }>('/:id/storage-pools', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      // 添加调试日志，帮助排查 HOST_NOT_FOUND 问题
      console.warn(`[HOST_NOT_FOUND] GET /hosts/${request.params.id}/storage-pools - hostId=${hostId}, userId=${user.id}, username=${user.username}`)
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以查看
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const client = await getIncusClient(host)
      const pools = await listStoragePools(client)

      // 从数据库获取存储池的用途信息
      const dbPools = await db.getStoragePoolsByHostId(hostId)
      const purposeMap = new Map(dbPools.map(p => [p.name, p.purpose]))

      // 获取每个存储池的资源使用情况
      const poolsWithResources = await Promise.all(
        pools.map(async (pool) => {
          try {
            const resources = await getStoragePoolResources(client, pool.name)
            return {
              name: pool.name,
              driver: pool.driver,
              status: pool.status || 'Created',
              description: pool.description || '',
              purpose: purposeMap.get(pool.name) || null,
              config: pool.config || {},
              usedBy: pool.used_by?.length || 0,
              space: resources.space || null
            }
          } catch {
            return {
              name: pool.name,
              driver: pool.driver,
              status: pool.status || 'Created',
              description: pool.description || '',
              purpose: purposeMap.get(pool.name) || null,
              config: pool.config || {},
              usedBy: pool.used_by?.length || 0,
              space: null
            }
          }
        })
      )

      return { pools: poolsWithResources }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      request.log.error(err, 'Failed to get storage pools')
      return reply.code(500).send({ error: `获取存储池列表失败: ${errorMessage}` })
    }
  })

  // 创建存储池
  // 支持三种模式：
  // 1. 创建新存储池：需要提供 source（物理盘/路径）或 size（Loop 文件大小）
  // 2. 关联已有存储池：useExisting=true，Incus 已知的存储池，直接关联到数据库
  // 3. 导入底层已有存储池：useExisting=true + driver + existingSource，Incus 未知但底层已存在的存储池
  //    例如：用户手动创建了 ZFS 池，但 Incus 还不知道它的存在
  fastify.post<{
    Params: { id: string }
    Body: {
      name: string
      driver?: 'zfs' | 'lvm' | 'btrfs' | 'dir'
      source?: string
      size?: string
      zfsPoolName?: string
      lvmVgName?: string
      lvmThinpoolName?: string
      lvmUseThinpool?: boolean
      description?: string
      purpose?: 'instance_data' | 'instance_storage'
      useExisting?: boolean
      existingSource?: string  // 底层已存在的存储源名称（如 ZFS 池名、LVM VG 名）
    }
  }>('/:id/storage-pools', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 64 },
          driver: { type: 'string', enum: ['zfs', 'lvm', 'btrfs', 'dir'] },
          source: { type: 'string' },
          size: { type: 'string' },
          zfsPoolName: { type: 'string' },
          lvmVgName: { type: 'string' },
          lvmThinpoolName: { type: 'string' },
          lvmUseThinpool: { type: 'boolean' },
          description: { type: 'string' },
          purpose: { type: 'string', enum: ['instance_data', 'instance_storage'] },
          useExisting: { type: 'boolean' },
          existingSource: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const { name, driver, source, size, zfsPoolName, lvmVgName, lvmThinpoolName, lvmUseThinpool, description, purpose, useExisting, existingSource } = request.body

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以创建
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const client = await getIncusClient(host)

      // 模式2/3：使用/导入已有存储池
      if (useExisting) {
        // 检查数据库中是否已关联
        const existingInDb = await prisma.storagePool.findFirst({
          where: { hostId, name }
        })
        if (existingInDb) {
          return reply.code(400).send({ error: `存储池 "${name}" 已在系统中关联` })
        }

        // 尝试从 Incus 获取已有存储池信息
        const { getStoragePool } = await import('../lib/incus/incus-storage.js')
        let poolInfo
        try {
          poolInfo = await getStoragePool(client, name)
        } catch {
          // Incus 不知道这个存储池，尝试导入底层已有的存储池
          poolInfo = null
        }

        if (poolInfo) {
          // 模式2：Incus 已知的存储池，直接关联
          await db.createStoragePool({
            hostId,
            name,
            driver: poolInfo.driver,
            purpose: purpose || 'instance_data',
            description: description || poolInfo.description || null,
            config: poolInfo.config || {}
          })

          await createLog(
            user.id,
            'host',
            'storage.link',
            `Linked existing storage pool "${name}" (${poolInfo.driver}) on host "${host.name}"`,
            'success'
          )

          return reply.code(201).send({ message: '存储池关联成功', name, driver: poolInfo.driver })
        }

        // 模式3：Incus 未知但底层已存在的存储池，需要导入
        // 需要用户提供驱动类型和底层存储源名称
        if (!driver) {
          return reply.code(400).send({ 
            error: `存储池 "${name}" 在 Incus 中不存在。如需导入底层已有的存储池，请选择驱动类型并提供存储源名称。` 
          })
        }

        // Btrfs 和 DIR 类型必须提供有效的存储源路径
        if ((driver === 'btrfs' || driver === 'dir') && !existingSource) {
          return reply.code(400).send({ 
            error: `${driver.toUpperCase()} 类型必须提供底层存储源路径` 
          })
        }

        // 根据驱动类型构建导入配置
        const importConfig: Record<string, string> = {}
        let sourceValue = existingSource || name  // 默认使用存储池名称作为源

        switch (driver) {
          case 'zfs':
            // source 是 ZFS 池名称
            importConfig['source'] = sourceValue
            break
          case 'lvm':
            // source 是 VG 名称
            importConfig['source'] = sourceValue
            importConfig['lvm.use_thinpool'] = 'false'  // 导入时默认不使用 thinpool
            break
          case 'btrfs':
            // source 是设备路径或子卷路径
            importConfig['source'] = sourceValue
            break
          case 'dir':
            // source 是目录路径
            importConfig['source'] = sourceValue
            break
        }

        // 使用 source 参数在 Incus 中创建存储池（实际是导入已有的）
        await createStoragePool(client, { name, driver, config: importConfig })

        // 重新获取存储池信息
        const importedPoolInfo = await getStoragePool(client, name)

        // 保存到数据库
        await db.createStoragePool({
          hostId,
          name,
          driver,
          purpose: purpose || 'instance_data',
          description: description || null,
          config: importedPoolInfo.config || importConfig
        })

        await createLog(
          user.id,
          'host',
          'storage.import',
          `Imported existing ${driver.toUpperCase()} storage "${sourceValue}" as pool "${name}" on host "${host.name}"`,
          'success'
        )

        return reply.code(201).send({ 
          message: '存储池导入成功', 
          name, 
          driver,
          imported: true 
        })
      }

      // 模式1：创建新存储池
      if (!driver) {
        return reply.code(400).send({ error: '创建新存储池需要指定驱动类型' })
      }

      // 根据驱动类型构建配置
      const config: Record<string, string> = {}

      switch (driver) {
        case 'zfs':
          if (source) {
            config['source'] = source
          } else if (size) {
            config['size'] = size
          } else {
            return reply.code(400).send({ error: 'ZFS 需要指定 source（物理盘）或 size（Loop 文件）' })
          }
          // zfs.pool_name 在两种模式下都应该生效
          if (zfsPoolName) config['zfs.pool_name'] = zfsPoolName
          break

        case 'lvm':
          if (source) {
            config['source'] = source
          } else if (size) {
            config['size'] = size
          } else {
            return reply.code(400).send({ error: 'LVM 需要指定 source（物理盘）或 size（Loop 文件）' })
          }
          if (lvmVgName) config['lvm.vg_name'] = lvmVgName
          if (lvmThinpoolName) config['lvm.thinpool_name'] = lvmThinpoolName
          config['lvm.use_thinpool'] = lvmUseThinpool !== false ? 'true' : 'false'
          break

        case 'btrfs':
          if (source) {
            config['source'] = source
          } else if (size) {
            config['size'] = size
          } else {
            return reply.code(400).send({ error: 'Btrfs 需要指定 source（物理盘）或 size（Loop 文件）' })
          }
          break

        case 'dir':
          if (!source) {
            return reply.code(400).send({ error: 'DIR 需要指定 source（目录路径）' })
          }
          config['source'] = source
          break
      }

      await createStoragePool(client, { name, driver, config })

      // 保存到数据库
      await db.createStoragePool({
        hostId,
        name,
        driver,
        purpose: purpose || 'instance_data',
        description: description || null,
        config
      })

      await createLog(
        user.id,
        'host',
        'storage.create',
        `Created storage pool "${name}" (${driver}) on host "${host.name}"`,
        'success'
      )

      return reply.code(201).send({ message: '存储池创建成功', name })
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      request.log.error(err, 'Failed to create storage pool')
      return reply.code(500).send({ error: `创建存储池失败: ${errorMessage}` })
    }
  })

  // 删除存储池
  fastify.delete<{ Params: { id: string; poolName: string } }>('/:id/storage-pools/:poolName', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const { poolName } = request.params

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以删除
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const client = await getIncusClient(host)
      await deleteStoragePool(client, poolName)

      // 从数据库删除
      await db.deleteStoragePool(hostId, poolName)

      await createLog(
        user.id,
        'host',
        'storage.delete',
        `Deleted storage pool "${poolName}" from host "${host.name}"`,
        'success'
      )

      return { message: '存储池删除成功' }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      request.log.error(err, 'Failed to delete storage pool')
      return reply.code(500).send({ error: `删除存储池失败: ${errorMessage}` })
    }
  })

  // 修改存储池配置
  fastify.patch<{
    Params: { id: string; poolName: string }
    Body: {
      size?: string
      description?: string
      purpose?: 'instance_data' | 'instance_storage'
    }
  }>('/:id/storage-pools/:poolName', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          size: { type: 'string' },
          description: { type: 'string' },
          purpose: { type: 'string', enum: ['instance_data', 'instance_storage'] }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const { poolName } = request.params
    const { size, description, purpose } = request.body

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以修改
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 至少要有一个修改项
    if (!size && description === undefined && purpose === undefined) {
      return reply.code(400).send({ error: '请提供要修改的内容' })
    }

    try {
      const client = await getIncusClient(host)
      
      // 构建更新配置
      const config: Record<string, string> = {}
      if (size) {
        config['size'] = size
      }

      await updateStoragePool(client, poolName, {
        config: Object.keys(config).length > 0 ? config : undefined,
        description: description
      })

      // 更新数据库中的描述和用途（如果有）
      if (description !== undefined || purpose !== undefined) {
        const updateData: any = {}
        if (description !== undefined) updateData.description = description
        if (purpose !== undefined) updateData.purpose = purpose
        await db.updateStoragePool(hostId, poolName, updateData)
      }

      await createLog(
        user.id,
        'host',
        'storage.update',
        `Updated storage pool "${poolName}" on host "${host.name}"`,
        'success'
      )

      return { message: '存储池修改成功' }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      request.log.error(err, 'Failed to update storage pool')
      return reply.code(500).send({ error: `修改存储池失败: ${errorMessage}` })
    }
  })

  // ==================== Caddy 反代管理路由 ====================

  /**
   * 生成随机字符串
   */
  function generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    const randomBytes = crypto.randomBytes(length)
    for (let i = 0; i < length; i++) {
      result += chars[randomBytes[i] % chars.length]
    }
    return result
  }

  /**
   * 生成 Caddy 脚本下载 token（有效期 30 分钟）
   * 使用 HMAC-SHA256 签名，包含 hostId 和过期时间
   */
  function generateCaddyScriptToken(hostId: number): string {
    const secret = getJwtSigningSecret('Caddy script token signing')
    const expireAt = Date.now() + 30 * 60 * 1000 // 30 分钟有效期
    const payload = `${hostId}:${expireAt}`
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    // 返回 base64url 编码的 token: hostId:expireAt:signature
    return Buffer.from(`${payload}:${signature}`).toString('base64url')
  }

  /**
   * 验证 Caddy 脚本下载 token
   * @returns hostId 如果验证成功，否则返回 null
   */
  function verifyCaddyScriptToken(token: string): number | null {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf-8')
      const parts = decoded.split(':')
      if (parts.length !== 3) return null
      
      const [hostIdStr, expireAtStr, signature] = parts
      const hostId = parseInt(hostIdStr, 10)
      const expireAt = parseInt(expireAtStr, 10)
      
      if (isNaN(hostId) || isNaN(expireAt)) return null
      if (hostId <= 0) return null // hostId 必须是正整数
      
      // 检查是否过期
      if (Date.now() > expireAt) return null
      
      // 验证签名（使用常量时间比较防止时序攻击）
      const secret = getJwtSigningSecret('Caddy script token verification')
      const payload = `${hostId}:${expireAt}`
      const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
      
      // 使用 timingSafeEqual 防止时序攻击
      const signatureBuffer = Buffer.from(signature, 'utf-8')
      const expectedBuffer = Buffer.from(expectedSignature, 'utf-8')
      if (signatureBuffer.length !== expectedBuffer.length) return null
      if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null
      
      return hostId
    } catch {
      return null
    }
  }

  /**
   * 获取宿主机 Caddy 状态和安装命令
   * GET /hosts/:id/caddy
   */
  fastify.get<{
    Params: { id: string }
  }>('/:id/caddy', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以查看
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 统计该宿主机的站点数量（从数据库）
    const { getProxySiteCountByHost } = await import('../db/proxy-sites.js')
    const sitesCount = await getProxySiteCountByHost(hostId)

    return {
      enabled: host.caddy_enabled || false,
      username: host.caddy_username || null,
      port: host.caddy_port || 8444,
      // 不返回密码，只返回是否已配置
      hasPassword: !!host.caddy_password,
      natPublicIp: host.nat_public_ip || host.ip_address || null,
      sitesCount
    }
  })

  /**
   * 生成 Caddy 安装命令（生成账号密码）
   * POST /hosts/:id/caddy/generate
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/caddy/generate', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以操作
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 如果已有凭据，复用现有的；否则生成新的
    let username = host.caddy_username
    let password = host.caddy_password
    const port = host.caddy_port || 8444
    let isNewCredentials = false

    if (!username || !password) {
      // 生成新凭据
      username = 'caddy_' + generateRandomString(8)
      password = generateRandomString(24)
      isNewCredentials = true

      // 更新数据库
      await prisma.host.update({
        where: { id: hostId },
        data: {
          caddyUsername: username,
          caddyPassword: password,
          caddyPort: port
        }
      })

      await createLog(
        user.id,
        'host',
        'caddy.generate',
        `Generated Caddy credentials for host "${host.name}"`,
        'success'
      )
    }

    // 构建安装命令
    // 使用FRONTEND_URL，如果包含多个URL（逗号分隔），使用第一个
    const panelUrl = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',')[0].trim()
      : 'https://incudal.com'
    // 生成带鉴权 token 的脚本下载 URL
    const scriptToken = generateCaddyScriptToken(hostId)
    const installCommand = `curl -sSL "${panelUrl}/api/hosts/caddy-script/${scriptToken}" | sudo bash -s -- --username "${username}" --password "${password}" --port ${port}`

    return {
      installCommand,
      username,
      password,
      port,
      isNewCredentials
    }
  })

  /**
   * 重置 Caddy 凭据
   * POST /hosts/:id/caddy/reset
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/caddy/reset', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 强制生成新凭据
    const username = 'caddy_' + generateRandomString(8)
    const password = generateRandomString(24)
    const port = host.caddy_port || 8444

    // 更新数据库，同时禁用 Caddy（需要重新安装）
    await prisma.host.update({
      where: { id: hostId },
      data: {
        caddyUsername: username,
        caddyPassword: password,
        caddyPort: port,
        caddyEnabled: false
      }
    })

    // 使用FRONTEND_URL，如果包含多个URL（逗号分隔），使用第一个
    const panelUrl = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',')[0].trim()
      : 'https://incudal.com'
    // 生成带鉴权 token 的脚本下载 URL
    const scriptToken = generateCaddyScriptToken(hostId)
    const installCommand = `curl -sSL "${panelUrl}/api/hosts/caddy-script/${scriptToken}" | sudo bash -s -- --username "${username}" --password "${password}" --port ${port}`

    await createLog(
      user.id,
      'host',
      'caddy.reset',
      `Reset Caddy credentials for host "${host.name}"`,
      'success'
    )

    return {
      installCommand,
      username,
      password,
      port
    }
  })

  /**
   * 确认 Caddy 已安装
   * POST /hosts/:id/caddy/confirm
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/caddy/confirm', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (!host.caddy_username || !host.caddy_password) {
      request.log.warn({ hostId, hostName: host.name }, '[Caddy Confirm] 缺少凭据，请先生成安装命令')
      return reply.code(400).send({ error: '请先生成安装命令' })
    }

    // 尝试连接测试
    const targetHost = host.nat_public_ip || host.ip_address
    if (!targetHost) {
      request.log.warn({ hostId, hostName: host.name }, '[Caddy Confirm] 宿主机未配置公网 IP')
      return reply.code(400).send({ error: '宿主机未配置公网 IP' })
    }

    request.log.info({
      hostId,
      hostName: host.name,
      targetHost,
      port: host.caddy_port || 8444,
      username: host.caddy_username
    }, '[Caddy Confirm] 开始测试连接')

    const client = createCaddyClient({
      host: targetHost,
      port: host.caddy_port || 8444,
      username: host.caddy_username,
      password: host.caddy_password
    })

    const connected = await client.testConnection()
    
    request.log.info({
      hostId,
      hostName: host.name,
      targetHost,
      connected
    }, '[Caddy Confirm] 连接测试结果')

    if (!connected) {
      request.log.warn({ hostId, hostName: host.name, targetHost }, '[Caddy Confirm] 无法连接到 Caddy')
      return reply.code(400).send({ error: '无法连接到 Caddy，请确认已执行安装命令' })
    }

    // 更新状态
    await prisma.host.update({
      where: { id: hostId },
      data: { caddyEnabled: true }
    })

    await createLog(
      user.id,
      'host',
      'caddy.confirm',
      `Confirmed Caddy installation for host "${host.name}"`,
      'success'
    )

    return { message: 'Caddy 已确认安装' }
  })

  /**
   * 获取 Caddy 安装脚本（需要 token 鉴权）
   * GET /hosts/caddy-script/:token
   */
  fastify.get<{ Params: { token: string } }>('/caddy-script/:token', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = request.params

    // 验证 token
    const hostId = verifyCaddyScriptToken(token)
    if (hostId === null) {
      request.log.warn('Invalid or expired caddy script token')
      return reply.code(403).send('# Error: Invalid or expired token')
    }

    // 验证宿主机存在
    const host = await prisma.host.findUnique({
      where: { id: hostId },
      select: { id: true, name: true }
    })
    if (!host) {
      request.log.warn(`Caddy script download failed: host ${hostId} not found`)
      return reply.code(404).send('# Error: Host not found')
    }

    try {
      const scriptPath = join(__dirname, '../../templates/caddy.sh')
      const scriptContent = readFileSync(scriptPath, 'utf-8')
      request.log.info(`Caddy script downloaded for host ${host.name}`)
      reply.type('text/plain').send(scriptContent)
    } catch (err) {
      request.log.error(err, 'Failed to read caddy.sh')
      return reply.code(500).send('# Error: Failed to read script')
    }
  })

  /**
   * 测试 Caddy 连接
   * POST /hosts/:id/caddy/test
   */
  fastify.post<{
    Params: { id: string }
  }>('/:id/caddy/test', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (!host.caddy_enabled || !host.caddy_username || !host.caddy_password) {
      return reply.code(400).send({ error: 'Caddy 未启用' })
    }

    const targetHost = host.nat_public_ip || host.ip_address
    if (!targetHost) {
      return reply.code(400).send({ error: '宿主机未配置公网 IP' })
    }

    const client = createCaddyClient({
      host: targetHost,
      port: host.caddy_port || 8444,
      username: host.caddy_username,
      password: host.caddy_password
    })

    const connected = await client.testConnection()
    
    // 获取已配置的站点数量
    const sites = connected ? await client.getSites() : []

    return {
      connected,
      sitesCount: sites.length,
      // 返回 DNS 解析类型提示
      dnsRecordType: getDnsRecordType(targetHost),
      dnsRecordValue: targetHost
    }
  })

  /**
   * 获取宿主机的所有反代站点列表
   * GET /hosts/:id/caddy/sites
   */
  fastify.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string }
  }>('/:id/caddy/sites', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    // 分页参数边界验证：page >= 1, pageSize 在 1-100 之间
    const rawPage = parseInt(request.query.page || '1', 10)
    const rawPageSize = parseInt(request.query.pageSize || '10', 10)
    const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage
    const pageSize = isNaN(rawPageSize) ? 10 : Math.min(100, Math.max(1, rawPageSize))

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以查看
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取该宿主机上的所有反代站点
    const { getProxySitesByHostId } = await import('../db/proxy-sites.js')
    const allSites = await getProxySitesByHostId(hostId)

    // 分页
    const total = allSites.length
    const totalPages = Math.ceil(total / pageSize)
    const startIndex = (page - 1) * pageSize
    const paginatedSites = allSites.slice(startIndex, startIndex + pageSize)

    return {
      sites: paginatedSites.map(site => ({
        id: site.id,
        domain: site.domain,
        targetPort: site.targetPort,
        httpsEnabled: site.httpsEnabled,
        status: site.status,
        enabled: site.enabled,
        error: site.error,
        createdAt: site.createdAt,
        // 实例信息
        instance: site.instance ? {
          id: site.instance.id,
          name: site.instance.name,
          ipv4: site.instance.ipv4,
          status: site.instance.status
        } : null
      })),
      total,
      page,
      pageSize,
      totalPages
    }
  })

  // 批量同步实例状态（仅节点所有者）
  fastify.post<{
    Params: { id: string }
    Body: { instanceIds: number[] }
  }>('/:id/instances/sync-status', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const { instanceIds } = request.body
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证节点存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以同步状态
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取所有实例并验证它们属于该节点
    const instances = await prisma.instance.findMany({
      where: {
        id: { in: instanceIds },
        hostId: hostId,
        status: { notIn: ['deleted', 'creating'] } // 排除已删除和创建中的实例
      }
    })

    if (instances.length === 0) {
      return reply.code(400).send({ error: '没有找到可同步的实例' })
    }

    // 获取 Incus 客户端
    let client: IncusClient | null = null
    try {
      client = await getIncusClient(host)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return reply.code(503).send({ error: `无法连接到节点: ${errorMessage}` })
    }

    // 导入状态同步相关函数
    const { getInstance, getInstanceState } = await import('../lib/incus/incus-instances.js')
    const { mapInstanceStatus } = await import('../lib/incus/incus-utils.js')
    const { getProxySitesByInstanceId } = await import('../db/proxy-sites.js')

    // 从 Incus state.network 中提取 IPv4 地址
    // 优先选择 eth0 接口的 IP（这是我们配置的主网卡）
    const results: { id: number; name: string; success: boolean; from?: string; to?: string; ipv4Changed?: boolean; oldIpv4?: string | null; newIpv4?: string | null; ipv6Changed?: boolean; oldIpv6?: string | null; newIpv6?: string | null; proxySitesUpdated?: number; error?: string }[] = []
    let syncedCount = 0
    let changedCount = 0
    let ipv4ChangedCount = 0
    let ipv6ChangedCount = 0

    for (const instance of instances) {
      try {
        // 从 Incus 获取实例状态
        const [state, incusInstance] = await Promise.all([
          getInstanceState(client!, instance.incusId),
          getInstance(client!, instance.incusId)
        ]) as [{
          status?: string
          network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
        }, {
          devices?: Record<string, Record<string, unknown>>
          expanded_devices?: Record<string, Record<string, unknown>>
        }]

        if (!state.status) {
          results.push({
            id: instance.id,
            name: instance.name,
            success: false,
            error: '无法获取实例状态'
          })
          continue
        }

        const incusStatus = mapInstanceStatus(state.status)

        if (incusStatus === 'unknown') {
          results.push({
            id: instance.id,
            name: instance.name,
            success: false,
            error: `未知状态: ${state.status}`
          })
          continue
        }

        // 更新数据库状态
        const currentStatus = instance.status
        let statusChanged = false
        let ipv4Changed = false
        let oldIpv4: string | null = null
        let newIpv4: string | null = null
        let ipv6Changed = false
        let oldIpv6: string | null = null
        let newIpv6: string | null = null
        let proxySitesUpdated = 0

        if (currentStatus !== incusStatus) {
          await db.updateInstanceStatus(
            instance.id,
            incusStatus as 'creating' | 'running' | 'stopped' | 'error'
          )
          statusChanged = true
          changedCount++
        }

        // 同步内网 IPv4（仅当实例正在运行时才能获取）
        const persistedNetwork = await persistResolvedInstanceNetworkAddresses(
          {
            id: instance.id,
            name: instance.name,
            hostId: host.id,
            networkMode: instance.networkMode,
            ipv4: instance.ipv4,
            ipv6: instance.ipv6
          },
          resolveInstanceNetworkAddresses(
            {
              id: instance.id,
              name: instance.name,
              hostId: host.id,
              networkMode: instance.networkMode,
              ipv4: instance.ipv4,
              ipv6: instance.ipv6
            },
            incusInstance,
            state
          ),
          { updateLastSyncedAt: true }
        )

        ipv4Changed = persistedNetwork.ipv4Changed
        oldIpv4 = persistedNetwork.oldIpv4
        newIpv4 = persistedNetwork.newIpv4
        ipv6Changed = persistedNetwork.ipv6Changed
        oldIpv6 = persistedNetwork.oldIpv6
        newIpv6 = persistedNetwork.newIpv6

        if (ipv4Changed) {
          ipv4ChangedCount++
        }
        if (ipv6Changed) {
          ipv6ChangedCount++
        }

        if (ipv4Changed && newIpv4) {
          console.log(`[BatchSyncStatus] Instance ${instance.id} IPv4 changed: ${oldIpv4} -> ${newIpv4}`)

          const proxySites = await getProxySitesByInstanceId(instance.id)
          if (proxySites.length > 0 && host.caddy_enabled && host.caddy_username && host.caddy_password) {
            const targetHost = host.nat_public_ip || host.ip_address
            if (targetHost) {
              const caddyClient = createCaddyClient({
                host: targetHost,
                port: host.caddy_port || 8444,
                username: host.caddy_username,
                password: host.caddy_password
              })

              for (const site of proxySites) {
                if (site.status === 'active' && site.enabled) {
                  try {
                    await caddyClient.deleteSite(site.domain)
                    await caddyClient.addSite(site.domain, newIpv4, site.targetPort, site.httpsEnabled)
                    proxySitesUpdated++
                    console.log(`[BatchSyncStatus] Updated proxy site "${site.domain}" to new IP ${newIpv4}`)
                  } catch (caddyErr) {
                    console.error(`[BatchSyncStatus] Failed to update proxy site "${site.domain}":`, caddyErr)
                  }
                }
              }
            }
          }
        }
        results.push({
          id: instance.id,
          name: instance.name,
          success: true,
          from: statusChanged ? currentStatus : undefined,
          to: statusChanged ? incusStatus : undefined,
          ipv4Changed: ipv4Changed || undefined,
          oldIpv4: ipv4Changed ? oldIpv4 : undefined,
          newIpv4: ipv4Changed ? newIpv4 : undefined,
          ipv6Changed: ipv6Changed || undefined,
          oldIpv6: ipv6Changed ? oldIpv6 : undefined,
          newIpv6: ipv6Changed ? newIpv6 : undefined,
          proxySitesUpdated: ipv4Changed ? proxySitesUpdated : undefined
        })
        syncedCount++
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        
        // 如果实例在 Incus 中不存在，标记为已删除并回滚资源
        if (errorMessage.includes('not found') || errorMessage.includes('Instance not found')) {
          // 1. 更新实例状态为已删除
          await db.updateInstanceStatus(instance.id, 'deleted')
          
          // 2. 获取端口映射数量并回滚资源
          const portMappings = await db.getPortMappings(instance.id)
          const portMappingsCount = portMappings?.length || 0
          await db.rollbackResources({
            hostId: instance.hostId,
            cpu: instance.cpu,
            memory: instance.memory,
            disk: instance.disk,
            portCount: portMappingsCount
          })
          
          changedCount++
          results.push({
            id: instance.id,
            name: instance.name,
            success: true,
            from: instance.status,
            to: 'deleted'
          })
        } else {
          results.push({
            id: instance.id,
            name: instance.name,
            success: false,
            error: errorMessage
          })
        }
      }
    }

    // 如果有实例被标记为删除，重新计算宿主机资源使用量以确保一致性
    const hasDeletedInstances = results.some(r => r.to === 'deleted')
    if (hasDeletedInstances) {
      try {
        const usedResources = await db.calculateHostResourcesFromInstances(hostId)
        // 重新计算端口映射使用量
        const actualPortsUsed = await prisma.portMapping.count({
          where: {
            instance: {
              hostId: hostId,
              status: { not: 'deleted' }
            }
          }
        })
        await db.updateHostResources(hostId, {
          cpuUsed: usedResources.cpuUsed,
          memoryUsed: usedResources.memoryUsed,
          diskUsed: usedResources.diskUsed
        })
        // 更新端口使用量
        await prisma.host.update({
          where: { id: hostId },
          data: { natPortsUsedCount: actualPortsUsed }
        })
      } catch (recalcError) {
        fastify.log.error(`重新计算宿主机资源失败: ${recalcError}`)
      }
    }

    await createLog(
      user.id,
      'host',
      'host.sync_instance_status',
      `Synced ${syncedCount} instances on host "${host.name}", ${changedCount} status changed, ${ipv4ChangedCount} IPv4 changed, ${ipv6ChangedCount} IPv6 changed`,
      'success'
    )

    return {
      message: `同步完成`,
      results,
      syncedCount,
      changedCount,
      ipv4ChangedCount,
      ipv6ChangedCount,
      failedCount: instances.length - syncedCount
    }
  })

  // ==================== 资源校对 ====================
  // POST /hosts/:id/recalculate-resources - 重新计算宿主机资源使用量
  fastify.post<{
    Params: { id: string }
  }>('/:id/recalculate-resources', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证节点存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以校对资源
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取校对前的资源使用量
    const before = {
      cpuUsed: host.cpu_used || 0,
      memoryUsed: host.memory_used || 0,
      diskUsed: host.disk_used || 0,
      natPortsUsedCount: host.nat_ports_used_count || 0,
      cpuAllowanceMax: host.cpu_allowance_max || 0,
      memoryMax: host.memory_max || 0
    }

    // 重新计算资源使用量（基于所有非 deleted 状态的实例）
    const usedResources = await db.calculateHostResourcesFromInstances(hostId)

    // 重新计算端口映射使用量
    const portMappingsCount = await prisma.portMapping.count({
      where: {
        instance: {
          hostId: hostId,
          status: { not: 'deleted' }
        }
      }
    })

    // 更新宿主机资源使用量
    await db.updateHostResources(hostId, {
      cpuUsed: usedResources.cpuUsed,
      memoryUsed: usedResources.memoryUsed,
      diskUsed: usedResources.diskUsed
    })

    // 更新端口使用量，同时将配额对齐到已用配额
    await prisma.host.update({
      where: { id: hostId },
      data: {
        natPortsUsedCount: portMappingsCount,
        // 将配额对齐到已用配额
        cpuAllowanceMax: usedResources.cpuUsed,
        memoryMax: usedResources.memoryUsed
      }
    })

    const after = {
      cpuUsed: usedResources.cpuUsed,
      memoryUsed: usedResources.memoryUsed,
      diskUsed: usedResources.diskUsed,
      natPortsUsedCount: portMappingsCount,
      cpuAllowanceMax: usedResources.cpuUsed,
      memoryMax: usedResources.memoryUsed
    }

    // 计算差异
    const diff = {
      cpuUsed: after.cpuUsed - before.cpuUsed,
      memoryUsed: after.memoryUsed - before.memoryUsed,
      diskUsed: after.diskUsed - before.diskUsed,
      natPortsUsedCount: after.natPortsUsedCount - before.natPortsUsedCount,
      cpuAllowanceMax: after.cpuAllowanceMax - before.cpuAllowanceMax,
      memoryMax: after.memoryMax - before.memoryMax
    }

    const hasChanges = diff.cpuUsed !== 0 || diff.memoryUsed !== 0 || diff.diskUsed !== 0 || diff.natPortsUsedCount !== 0 || diff.cpuAllowanceMax !== 0 || diff.memoryMax !== 0

    await createLog(
      user.id,
      'host',
      'host.recalculate_resources',
      `Recalculated resources for host "${host.name}": CPU ${before.cpuUsed}→${after.cpuUsed}, Memory ${before.memoryUsed}→${after.memoryUsed}, Disk ${before.diskUsed}→${after.diskUsed}, Ports ${before.natPortsUsedCount}→${after.natPortsUsedCount}, CPUMax ${before.cpuAllowanceMax}→${after.cpuAllowanceMax}, MemMax ${before.memoryMax}→${after.memoryMax}`,
      'success'
    )

    return {
      message: hasChanges ? '资源校对完成，已修正差异' : '资源校对完成，无差异',
      hasChanges,
      before,
      after,
      diff
    }
  })

  // 批量封停实例（仅节点所有者）
  fastify.post<{
    Params: { id: string }
    Body: { instanceIds: number[]; reason?: string }
  }>('/:id/instances/suspend', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          },
          reason: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const { instanceIds, reason } = request.body
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证节点存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以批量封停
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取所有实例并验证它们属于该节点，且未被封停
    const instances = await prisma.instance.findMany({
      where: {
        id: { in: instanceIds },
        hostId: hostId,
        status: { notIn: ['deleted', 'suspended'] }
      }
    })

    if (instances.length === 0) {
      return reply.code(400).send({ error: '没有找到可封停的实例' })
    }

    const results: { id: number; name: string; success: boolean; error?: string }[] = []
    let client: IncusClient | null = null

    try {
      client = await getIncusClient(host)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      fastify.log.error(`获取 Incus 客户端失败: ${errorMessage}`)
    }

    // 导入停止实例函数
    const { stopInstance } = await import('../lib/incus/index.js')

    for (const instance of instances) {
      try {
        // 如果实例正在运行，先关机
        if (instance.status === 'running' && client) {
          try {
            await stopInstance(client, instance.incusId, true)
          } catch (stopErr) {
            const stopErrMsg = stopErr instanceof Error ? stopErr.message : String(stopErr)
            fastify.log.error(`[BatchSuspend] Failed to stop instance ${instance.id}: ${stopErrMsg}`)
            // 继续封停流程，即使关机失败
          }
        }

        // 执行封停
        await db.suspendInstance(instance.id, {
          suspendedBy: user.id,
          suspendReason: reason || ''
        })

        await createLog(
          user.id,
          'instance',
          'instance.suspend',
          `Batch suspended instance "${instance.name}"${reason ? ` (reason: ${reason})` : ''}`,
          'success',
          { instanceId: instance.id }
        )

        // 发送站内信通知给实例所有者
        if (instance.userId !== user.id) {
          await sendNotification(instance.userId, 'instance_suspended', {
            instanceName: instance.name,
            hostName: host.name || '',
            suspendReason: reason || ''
          })
        }

        results.push({ id: instance.id, name: instance.name, success: true })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        fastify.log.error(`封停实例 ${instance.id} 失败: ${errorMessage}`)
        results.push({ id: instance.id, name: instance.name, success: false, error: errorMessage })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length

    return {
      message: `批量封停完成`,
      results,
      successCount,
      failedCount
    }
  })

  // 批量解封实例（仅节点所有者）
  fastify.post<{
    Params: { id: string }
    Body: { instanceIds: number[] }
  }>('/:id/instances/unsuspend', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const { instanceIds } = request.body
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证节点存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以批量解封
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取所有实例并验证它们属于该节点，且已被封停
    const instances = await prisma.instance.findMany({
      where: {
        id: { in: instanceIds },
        hostId: hostId,
        status: 'suspended'
      }
    })

    if (instances.length === 0) {
      return reply.code(400).send({ error: '没有找到可解封的实例' })
    }

    const results: { id: number; name: string; success: boolean; error?: string }[] = []

    for (const instance of instances) {
      try {
        // 执行解封
        await db.unsuspendInstance(instance.id)

        await createLog(
          user.id,
          'instance',
          'instance.unsuspend',
          `Batch unsuspended instance "${instance.name}"`,
          'success',
          { instanceId: instance.id }
        )

        // 发送站内信通知给实例所有者
        if (instance.userId !== user.id) {
          await sendNotification(instance.userId, 'instance_unsuspended', {
            instanceName: instance.name,
            hostName: host.name || ''
          })
        }

        results.push({ id: instance.id, name: instance.name, success: true })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        fastify.log.error(`解封实例 ${instance.id} 失败: ${errorMessage}`)
        results.push({ id: instance.id, name: instance.name, success: false, error: errorMessage })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length

    return {
      message: `批量解封完成`,
      results,
      successCount,
      failedCount
    }
  })

  // 批量为节点下所有付费实例免费延期（仅管理员）
  fastify.post<{
    Params: { id: string }
    Body: { days: number }
  }>('/:id/extend-all', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['days'],
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const { days } = request.body
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 检查宿主机是否存在
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 查询该节点下所有付费实例（packagePlanId 不为 null 且未删除）
    const paidInstances = await prisma.instance.findMany({
      where: {
        hostId,
        packagePlanId: { not: null },
        status: { not: 'deleted' },
        expiresAt: { not: null }  // 必须有到期时间才能延期
      },
      select: {
        id: true,
        name: true,
        expiresAt: true,
        userId: true
      }
    })

    if (paidInstances.length === 0) {
      return {
        success: true,
        message: '该节点下没有可延期的付费实例',
        extendedCount: 0
      }
    }

    // 批量更新 expiresAt
    const daysMs = days * 24 * 60 * 60 * 1000
    let extendedCount = 0
    const affectedUserIds = new Set<number>()

    for (const instance of paidInstances) {
      if (!instance.expiresAt) continue

      const newExpiresAt = new Date(instance.expiresAt.getTime() + daysMs)
      
      await prisma.instance.update({
        where: { id: instance.id },
        data: { expiresAt: newExpiresAt }
      })

      affectedUserIds.add(instance.userId)
      extendedCount++
    }

    // 记录操作日志
    await createLog(
      user.id,
      'host',
      'host.batch_extend',
      `Batch extended ${extendedCount} paid instances on host "${host.name}" by ${days} days`,
      'success'
    )

    // 给受影响的用户发送通知
    for (const userId of affectedUserIds) {
      await sendNotification(userId, 'instances_batch_extended', {
        hostName: host.name || '',
        days: days
      })
    }

    return {
      success: true,
      message: `成功为 ${extendedCount} 个付费实例延期 ${days} 天`,
      extendedCount
    }
  })

  // 接管托管节点为自营（仅管理员）
  fastify.post<{
    Params: { id: string }
  }>('/:id/takeover-official', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const officialAdminId = user.id

    try {
      const summary = await prisma.$transaction(async (tx) => {
        const host = await tx.host.findUnique({
          where: { id: hostId },
          select: {
            id: true,
            name: true,
            userId: true,
            user: {
              select: {
                id: true,
                username: true,
                role: true
              }
            }
          }
        })

        if (!host) {
          throw new Error('HOST_NOT_FOUND')
        }

        if (host.user.role === 'admin') {
          throw new Error('HOST_ALREADY_OFFICIAL')
        }

        const instanceCount = await tx.instance.count({
          where: {
            hostId,
            status: { not: 'deleted' }
          }
        })

        const hostPackages = await tx.package.findMany({
          where: {
            packageHosts: {
              some: { hostId }
            }
          },
          select: {
            id: true,
            name: true,
            userId: true,
            user: {
              select: {
                id: true,
                role: true
              }
            },
            packageHosts: {
              select: {
                hostId: true,
                host: {
                  select: {
                    userId: true,
                    user: {
                      select: {
                        role: true
                      }
                    }
                  }
                }
              }
            }
          }
        })

        const packageActions = hostPackages.map((pkg) => {
          const otherBindings = pkg.packageHosts.filter(binding => binding.hostId !== hostId)
          const hasOtherHostedBindings = otherBindings.some(binding => binding.host.user.role !== 'admin')
          const canTransferPackage = pkg.user.role !== 'admin' &&
            pkg.userId === host.userId &&
            !hasOtherHostedBindings

          return {
            pkg,
            otherBindings,
            canTransferPackage
          }
        })

        const blockedPackageNames = packageActions
          .filter(({ pkg, otherBindings, canTransferPackage }) =>
            pkg.user.role !== 'admin' &&
            !canTransferPackage &&
            otherBindings.length === 0
          )
          .map(({ pkg }) => pkg.name)

        if (blockedPackageNames.length > 0) {
          throw Object.assign(new Error('HOST_TAKEOVER_PACKAGE_BINDING_CONFLICT'), {
            packageNames: blockedPackageNames
          })
        }

        const newHostName = await generateUniqueOwnedName(tx, 'host', officialAdminId, host.name)
        await tx.host.update({
          where: { id: hostId },
          data: {
            userId: officialAdminId,
            name: newHostName
          }
        })

        const transferredPackageNames: string[] = []
        const detachedPackageNames: string[] = []

        for (const { pkg, otherBindings, canTransferPackage } of packageActions) {
          if (pkg.user.role === 'admin') {
            continue
          }

          if (canTransferPackage) {
            const newPackageName = await generateUniqueOwnedName(tx, 'package', officialAdminId, pkg.name)
            await tx.package.update({
              where: { id: pkg.id },
              data: {
                userId: officialAdminId,
                name: newPackageName,
                releaseChannelId: null
              }
            })
            await tx.packageShare.updateMany({
              where: { packageId: pkg.id },
              data: { ownerId: officialAdminId }
            })
            transferredPackageNames.push(pkg.name)
            continue
          }

          if (otherBindings.length > 0) {
            await tx.packageHost.deleteMany({
              where: {
                packageId: pkg.id,
                hostId
              }
            })
            detachedPackageNames.push(pkg.name)
          }
        }

        return {
          hostId: host.id,
          previousOwnerId: host.user.id,
          previousOwnerUsername: host.user.username,
          instanceCount,
          transferredPackageCount: transferredPackageNames.length,
          detachedPackageCount: detachedPackageNames.length,
          transferredPackageNames,
          detachedPackageNames,
          hostRenamed: newHostName !== host.name,
          oldHostName: host.name,
          newHostName
        }
      })

      await createLog(
        user.id,
        'host',
        'host.takeover_official',
        `Take over hosted host #${summary.hostId} from user #${summary.previousOwnerId}: transferredPackages=${summary.transferredPackageCount}, detachedPackages=${summary.detachedPackageCount}, instances=${summary.instanceCount}`,
        'success'
      )

      return {
        success: true,
        summary
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'HOST_NOT_FOUND') {
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        }
        if (error.message === 'HOST_ALREADY_OFFICIAL') {
          return reply.code(400).send(apiError(ErrorCode.HOST_ALREADY_OFFICIAL))
        }
        if (error.message === 'HOST_TAKEOVER_PACKAGE_BINDING_CONFLICT') {
          const packageNames = Array.isArray((error as Error & { packageNames?: string[] }).packageNames)
            ? (error as Error & { packageNames: string[] }).packageNames
            : []
          return reply.code(409).send({
            ...apiError(ErrorCode.HOST_TAKEOVER_PACKAGE_BINDING_CONFLICT),
            packageNames,
            count: packageNames.length
          })
        }
      }
      throw error
    }
  })

  // 获取节点绑定的套餐及其方案（管理员或节点所有者，用于改节点时选择方案）
  fastify.get<{ Params: { id: string } }>('/:id/plans', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 获取节点信息并检查权限
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：管理员或节点所有者
    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取绑定了该节点的套餐
    const { getHostPackages } = await import('../db/package-hosts.js')
    const packageIds = await getHostPackages(hostId)

    if (packageIds.length === 0) {
      return { plans: [] }
    }

    // 获取套餐详情和其活跃方案
    const packagesWithPlans = await prisma.package.findMany({
      where: {
        id: { in: packageIds },
        active: true
      },
      select: {
        id: true,
        name: true,
        plans: {
          where: { isActive: true, isSoldOut: false },
          select: {
            id: true,
            name: true,
            price: true,
            billingCycle: true,
            sortOrder: true
          },
          orderBy: { sortOrder: 'asc' }
        }
      }
    })

    // 展平为方案列表，带上套餐信息
    const plans = packagesWithPlans.flatMap(pkg =>
      pkg.plans.map(plan => ({
        id: plan.id,
        name: plan.name,
        packageId: pkg.id,
        packageName: pkg.name,
        price: Number(plan.price),
        billingCycle: plan.billingCycle
      }))
    )

    return { plans }
  })

  // 批量迁移实例到其他节点（管理员或节点所有者）
  fastify.post<{
    Params: { id: string }
    Body: { instanceIds: number[]; targetHostId: number; targetImage: string; targetPlanId?: number }
  }>('/:id/instances/migrate', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds', 'targetHostId', 'targetImage'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 30
          },
          targetHostId: { type: 'integer' },
          targetImage: { type: 'string', minLength: 1 },
          targetPlanId: { type: 'integer' }  // 付费实例迁移时的目标方案
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const { targetImage } = request.body
    const sourceHostId = parsePositiveRouteId(id)
    const instanceIds = parsePositiveIntegerArrayBody(request.body.instanceIds, HOST_BATCH_MIGRATE_MAX_INSTANCES)
    const targetHostId = parseIntegerBody(request.body.targetHostId)
    const targetPlanId = parseOptionalIntegerBody(request.body.targetPlanId)

    if (!sourceHostId || !instanceIds || !targetHostId || targetPlanId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证源节点存在
    const sourceHost = await db.getHostById(sourceHostId)
    if (!sourceHost) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 验证目标节点存在
    const targetHost = await db.getHostById(targetHostId)
    if (!targetHost) {
      return reply.code(404).send({ error: '目标节点不存在' })
    }

    // 权限检查：管理员只能迁移到官方自营节点；非管理员必须同时拥有源节点和目标节点
    if (user.role === 'admin') {
      const targetHostOwnership = await prisma.host.findUnique({
        where: { id: targetHostId },
        select: { user: { select: { role: true } } }
      })
      if (targetHostOwnership?.user.role !== 'admin') {
        return reply.code(400).send({ error: '管理员迁移目标节点只能选择自营节点' })
      }
    } else {
      if (sourceHost.user_id !== user.id) {
        return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
      }
      if (targetHost.user_id !== user.id) {
        return reply.code(403).send({ error: '目标节点不属于当前用户' })
      }
    }

    // 验证源节点和目标节点不同
    if (sourceHostId === targetHostId) {
      return reply.code(400).send({ error: '源节点和目标节点不能相同' })
    }

    // 验证目标节点在线
    if (targetHost.status !== 'online') {
      return reply.code(400).send({ error: '目标节点不在线' })
    }

    if (!await isValidSystemImage(targetImage)) {
      return reply.code(400).send({ error: '目标系统镜像不存在或已隐藏' })
    }

    // 获取所有实例并验证它们属于源节点
    const instances = await prisma.instance.findMany({
      where: {
        id: { in: instanceIds },
        hostId: sourceHostId,
        status: { not: 'deleted' }
      },
      include: {
        package: true
      }
    })

    if (instances.length === 0) {
      return reply.code(400).send({ error: '没有找到可迁移的实例' })
    }
    if (instances.length !== instanceIds.length) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Some instances are not available on this host'))
    }

    // 检查是否有付费实例
    const paidInstances = instances.filter(i => i.packagePlanId !== null)
    
    // 如果有付费实例，必须提供目标方案
    let targetPlan: Awaited<ReturnType<typeof db.getPlanById>> | null = null
    let targetPackage: Awaited<ReturnType<typeof db.getPackageById>> | null = null
    
    if (paidInstances.length > 0) {
      if (!targetPlanId) {
        return reply.code(400).send({ error: '有付费实例需要迁移，请选择目标方案' })
      }
      
      // 验证目标方案存在
      targetPlan = await db.getPlanById(targetPlanId)
      if (!targetPlan) {
        return reply.code(404).send({ error: '目标方案不存在' })
      }
      
      // 验证方案是否激活
      if (!targetPlan.isActive) {
        return reply.code(400).send({ error: '目标方案已下架' })
      }
      if (targetPlan.isSoldOut) {
        return reply.code(400).send({ error: '目标方案已售罄', code: 'PLAN_SOLD_OUT' })
      }
      
      // 获取方案对应的套餐
      targetPackage = await db.getPackageById(targetPlan.packageId)
      if (!targetPackage) {
        return reply.code(404).send({ error: '目标方案的套餐不存在' })
      }
      
      // 验证套餐是否绑定了目标节点
      const { getPackageHostIds } = await import('../db/package-hosts.js')
      const packageHostIds = await getPackageHostIds(targetPackage.id)
      if (!packageHostIds.includes(targetHostId)) {
        return reply.code(400).send({ error: '目标方案的套餐未绑定目标节点' })
      }
    }

    const results: { id: number; name: string; success: boolean; error?: string; newInstanceId?: number }[] = []
    let sourceClient: IncusClient | null = null
    let targetClient: IncusClient | null = null

    // 获取源节点和目标节点的 Incus 客户端
    try {
      sourceClient = await getIncusClient(sourceHost)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      fastify.log.error(`获取源节点 Incus 客户端失败: ${errorMessage}`)
      return reply.code(500).send({ error: `无法连接源节点: ${errorMessage}` })
    }

    try {
      targetClient = await getIncusClient(targetHost)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `无法连接目标节点: ${errorMessage}` })
    }

    // 导入必要的模块
    const { stopInstance, deleteInstance, createInstance, startInstance } = await import('../lib/incus/index.js')
    const { buildInstanceConfig } = await import('../lib/incus/incus-instances.js')
    const { generateIncusConfig, generateRandomPassword } = await import('../lib/incus-config-generator.js')
    const { generateVmConfig } = await import('../lib/incus-config-vm.js')
    const { generateRandomIPv4, generateRandomIPv6 } = await import('../lib/ip-calculator.js')
    const { decryptSensitiveData, encryptSensitiveData } = await import('../lib/security.js')
    const { getInstanceAffBinding, createAffBinding } = await import('../db/aff.js')
    const { createInboxMessage } = await import('../db/inbox.js')
    const { customAlphabet } = await import('nanoid')
    // 自定义 nanoid，只使用小写字母和数字（Incus 不允许下划线）
    const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

    for (const instance of instances) {
      let targetResourcesReserved = false
      let targetIncusCreated = false
      let targetIncusId: string | null = null
      let newDbInstanceId: number | null = null
      let sourceIncusDeleted = false
      const originalInstanceStatus = instance.status as InstanceStatus

      try {
        // 1. 检查转移锁定、恢复任务和上传任务
        const hasPendingTransfer = await db.hasPendingTransfer(instance.id)
        if (hasPendingTransfer) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '实例有待处理的转移请求' })
          continue
        }

        const activeRestoreTask = await prisma.restoreTask.findFirst({
          where: { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] } }
        })
        if (activeRestoreTask) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '实例有正在进行的恢复任务' })
          continue
        }

        const activeUploadTask = await prisma.backupUploadTask.findFirst({
          where: { instanceId: instance.id, status: { in: ['PENDING', 'PROCESSING'] } }
        })
        if (activeUploadTask) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '实例有正在进行的上传任务' })
          continue
        }

        // 2. 获取用户 SSH 密钥
        const userSshKeys = await db.getSSHKeysByUserId(instance.userId)
        if (userSshKeys.length === 0) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '用户没有 SSH 密钥' })
          continue
        }
        const sshKey = userSshKeys[0].public_key

        // 3. 解密原实例密码
        let rootPassword: string
        if (instance.rootPassword) {
          const decrypted = decryptSensitiveData(instance.rootPassword)
          rootPassword = decrypted || generateRandomPassword(16)
        } else {
          rootPassword = generateRandomPassword(16)
        }

        // 4. 获取套餐信息
        const pkg = instance.package
        if (!pkg) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '实例套餐不存在' })
          continue
        }

        // 5. 获取管理员选择的目标镜像和实例类型
        const imageAlias = targetImage
        // 实例类型从套餐获取
        const instanceType = (pkg as any).instanceType === 'vm' ? 'vm' : 'container'
        const effectiveInstanceType = instanceType === 'vm' ? 'virtual-machine' : 'container'
        if (!await isImageCompatibleWithInstanceType(imageAlias, instanceType)) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '目标系统与实例类型不兼容' })
          continue
        }
        if (!await isImageCompatibleWithMemory(imageAlias, instance.memory)) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '目标系统与实例内存不兼容' })
          continue
        }
        const imageAvailability = await getSystemImageAvailabilityForHost(imageAlias, targetHostId, {
          instanceType,
          memory: instance.memory
        })
        if (!imageAvailability.ok) {
          results.push({ id: instance.id, name: instance.name, success: false, error: `目标节点不可用该系统: ${imageAvailability.reason}` })
          continue
        }

        // 6. 生成 cloud-init 配置
        const { configPayload, metaData } = generateIncusConfig({
          instanceName: instance.name,
          imageAlias,
          rootPassword,
          sshKey,
          networkMode: instance.networkMode,
          type: effectiveInstanceType
        })

        // 7. 生成新的 incusId
        const shortId = nanoid()
        const newIncusId = `u${instance.userId}-${shortId}`
        targetIncusId = newIncusId

        // 8. 分配 IP 地址
        let staticIPv4: string | null = null
        let staticIPv6: string | null = null

        // 分配 IPv4
        for (let attempts = 0; attempts < 50; attempts++) {
          staticIPv4 = generateRandomIPv4()
          const exists = await db.isIpAddressExistsOnHost(staticIPv4, targetHostId)
          if (!exists) break
          staticIPv4 = null
        }
        if (!staticIPv4) {
          results.push({ id: instance.id, name: instance.name, success: false, error: '无法分配 IPv4 地址' })
          continue
        }

        // 分配 IPv6（如果目标节点支持）
        const targetHostWithIpv6 = targetHost as typeof targetHost & {
          ipv6_subnet?: string | null
          ipv6_gateway?: string | null
          ipv6_parent_interface?: string | null
        }
        if (targetHostWithIpv6.ipv6_subnet) {
          for (let attempts = 0; attempts < 50; attempts++) {
            staticIPv6 = generateRandomIPv6(targetHostWithIpv6.ipv6_subnet)
            const exists = await db.isIpAddressExists(staticIPv6)
            if (!exists) break
            staticIPv6 = null
          }
        }

        // 9. VM 和容器都需要重新生成包含静态 IP 的 network-config
        let finalConfigPayload = configPayload
        if (effectiveInstanceType === 'virtual-machine') {
          const vmResult = generateVmConfig({
            instanceName: instance.name,
            instanceIdSeed: newIncusId,
            imageAlias,
            rootPassword,
            sshKey,
            network: staticIPv4 ? {
              ipAddress: `${staticIPv4}/22`,
              gateway: '10.10.0.1',
              dns: ['8.8.8.8', '1.1.1.1'],
              ipv6Address: staticIPv6 ? `${staticIPv6}` : undefined,
              ipv6Gateway: staticIPv6 ? (targetHostWithIpv6.ipv6_gateway || undefined) : undefined
            } : undefined
          })
          finalConfigPayload = vmResult.configPayload
        } else if (staticIPv4) {
          // 容器类型：重新生成包含静态 IP 的 cloud-init 配置
          const containerResult = generateIncusConfig({
            instanceName: instance.name,
            imageAlias,
            rootPassword,
            sshKey,
            networkMode: instance.networkMode,
            type: 'container',
            network: {
              ipAddress: `${staticIPv4}/22`,
              gateway: '10.10.0.1',
              dns: ['8.8.8.8', '1.1.1.1'],
              ipv6Address: staticIPv6 ? `${staticIPv6}/128` : undefined,
              ipv6Gateway: staticIPv6 ? 'fe80::1' : undefined
            }
          })
          finalConfigPayload = containerResult.configPayload
        }

        // 10. 选择存储池
        let selectedStoragePool = await db.resolveStoragePoolForNewInstance(targetHostId, { packageId: targetPackage?.id ?? instance.packageId })
        if (!selectedStoragePool) selectedStoragePool = 'default'

        // 11. 获取套餐配置
        const pkgConfig = pkg as typeof pkg & {
          nested?: boolean
          privileged?: boolean
          io_limit_mode?: string
          limitsRead?: string | null
          limitsWrite?: string | null
          limitsReadIops?: number | null
          limitsWriteIops?: number | null
          limitsIngress?: string | null
          limitsEgress?: string | null
          limitsProcesses?: number | null
          limitsCpuPriority?: number | null
          bootAutostart?: boolean | null
          bootAutostartPriority?: number | null
          bootAutostartDelay?: number | null
          bootHostShutdownTimeout?: number | null
        }

        // 根据 ioLimitMode 选择性传入 IO 限制参数
        const ioMode = (pkgConfig as any).io_limit_mode || 'throughput'

        // 12. 构建 Incus 配置
        const ipv6Config = staticIPv6 ? { primaryIp: staticIPv6 } : null
        const incusConfig = buildInstanceConfig({
          name: newIncusId,
          image: imageAlias,
          cpu: instance.cpu,
          memory: instance.memory,
          disk: instance.disk,
          swapEnabled: (instance as any).swapEnabled === true,
          swapSize: (instance as any).swapSize ?? null,
          sshKey: '',
          password: '',
          cloudInitConfig: finalConfigPayload as { 'user.user-data': string; 'user.network-config'?: string } | undefined,
          networkMode: (instance.networkMode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
          nested: Boolean(pkgConfig.nested),
          privileged: Boolean(pkgConfig.privileged),
          instanceType: instanceType === 'vm' ? 'vm' : 'container',
          storagePool: selectedStoragePool,
          ipv4Address: staticIPv4,
          ipv6Config,
          hostInterface: targetHostWithIpv6.ipv6_parent_interface || 'eth0',
          ipv6Address: staticIPv6,
          ipv6Gateway: targetHostWithIpv6.ipv6_gateway,
          limitsRead: ioMode === 'throughput' ? ((instance as any).limitsRead || pkgConfig.limitsRead) : null,
          limitsWrite: ioMode === 'throughput' ? ((instance as any).limitsWrite || pkgConfig.limitsWrite) : null,
          limitsReadIops: ioMode === 'iops' ? ((instance as any).limitsReadIops || pkgConfig.limitsReadIops) : null,
          limitsWriteIops: ioMode === 'iops' ? ((instance as any).limitsWriteIops || pkgConfig.limitsWriteIops) : null,
          limitsIngress: (instance as any).limitsIngress || pkgConfig.limitsIngress,
          limitsEgress: (instance as any).limitsEgress || pkgConfig.limitsEgress,
          limitsProcesses: (instance as any).limitsProcesses || pkgConfig.limitsProcesses,
          limitsCpuPriority: (instance as any).limitsCpuPriority || pkgConfig.limitsCpuPriority,
          bootAutostart: (instance as any).bootAutostart ?? pkgConfig.bootAutostart,
          bootAutostartPriority: (instance as any).bootAutostartPriority ?? pkgConfig.bootAutostartPriority,
          bootAutostartDelay: (instance as any).bootAutostartDelay ?? pkgConfig.bootAutostartDelay,
          bootHostShutdownTimeout: (instance as any).bootHostShutdownTimeout ?? pkgConfig.bootHostShutdownTimeout
        })

        // 13. 预占目标节点资源
        await db.reserveResources({
          hostId: targetHostId,
          cpu: instance.cpu,
          memory: instance.memory,
          disk: instance.disk,
          portCount: 0
        })
        targetResourcesReserved = true

        // 14. 在目标节点创建实例
        console.log(`[Migrate] 在目标节点创建实例 ${newIncusId}...`)
        await createInstance(targetClient, incusConfig)
        targetIncusCreated = true

        // 15. 启动新实例
        console.log(`[Migrate] 启动新实例 ${newIncusId}...`)
        await startInstance(targetClient, newIncusId)

        // 16. 获取原实例的 AFF 绑定信息
        const affBinding = await getInstanceAffBinding(instance.id)

        // 17. 判断是否为付费实例，决定使用哪个套餐/方案
        const isPaidInstance = instance.packagePlanId !== null
        const finalPackageId = isPaidInstance && targetPackage ? targetPackage.id : instance.packageId
        const finalPlanId = isPaidInstance && targetPlan ? targetPlan.id : instance.packagePlanId
        const finalBillingPrice = isPaidInstance && targetPlan ? Number(targetPlan.price) / 100 : instance.billingPrice
        const finalBillingCycle = isPaidInstance && targetPlan ? targetPlan.billingCycle : instance.billingCycle

        // 18. 在数据库中创建新实例记录，并暂时标记源实例 deleted
        const { createdInstance: newInstance, migratedBillingRecordCount } = await prisma.$transaction(async tx => {
          const createdInstance = await tx.instance.create({
            data: {
              incusId: newIncusId,
              name: instance.name,
              userId: instance.userId,
              hostId: targetHostId,
              packageId: finalPackageId,
              packagePlanId: finalPlanId,
              storagePoolName: selectedStoragePool,
              image: imageAlias,
              cpu: instance.cpu,
              memory: instance.memory,
              disk: instance.disk,
              networkMode: instance.networkMode,
              snapshottedSpecs: instance.snapshottedSpecs as any,
              sshPort: metaData.sshPort,
              rootPassword: encryptSensitiveData(rootPassword),
              status: 'running',
              ipv4: staticIPv4,
              ipv6: staticIPv6,
              monthlyTrafficLimit: instance.monthlyTrafficLimit,
              portLimit: instance.portLimit,
              snapshotLimit: instance.snapshotLimit,
              backupLimit: instance.backupLimit,
              siteLimit: instance.siteLimit,
              // 保留原到期时间，更新续费价格为新方案
              expiresAt: instance.expiresAt,
              billingPrice: finalBillingPrice,
              billingCycle: finalBillingCycle,
              autoRenew: instance.autoRenew,
              // 存储 I/O 限制
              limitsRead: (instance as any).limitsRead,
              limitsWrite: (instance as any).limitsWrite,
              limitsReadIops: (instance as any).limitsReadIops,
              limitsWriteIops: (instance as any).limitsWriteIops,
              // 网络限制
              limitsIngress: (instance as any).limitsIngress,
              limitsEgress: (instance as any).limitsEgress,
              // 进程与调度
              limitsProcesses: (instance as any).limitsProcesses,
              limitsCpuPriority: (instance as any).limitsCpuPriority,
              // 启动配置
              bootAutostart: (instance as any).bootAutostart,
              bootAutostartPriority: (instance as any).bootAutostartPriority,
              bootAutostartDelay: (instance as any).bootAutostartDelay,
              bootHostShutdownTimeout: (instance as any).bootHostShutdownTimeout
            }
          })
          newDbInstanceId = createdInstance.id

          const movedCount = await db.reassignInstanceBillingRecords(instance.id, createdInstance.id, tx)
          if (affBinding) {
            await createAffBinding(createdInstance.id, affBinding.affCode.id, tx)
          }

          const sourceUpdate = await tx.instance.updateMany({
            where: {
              id: instance.id,
              status: originalInstanceStatus
            },
            data: { status: 'deleted' }
          })
          if (sourceUpdate.count !== 1) {
            throw new Error('源实例状态已变化，无法完成迁移')
          }

          return {
            createdInstance,
            migratedBillingRecordCount: movedCount
          }
        })

        if (isPaidInstance && migratedBillingRecordCount === 0) {
          fastify.log.warn({
            oldInstanceId: instance.id,
            newInstanceId: newInstance.id,
            instanceName: instance.name
          }, '[Migrate] 付费实例迁移时未迁移到任何计费记录')
        }

        // 19. 删除源节点的实例
        await deleteIncusInstanceForMigration(
          sourceClient,
          { stopInstance, deleteInstance },
          { incusId: instance.incusId, status: instance.status },
          fastify.log
        )
        sourceIncusDeleted = true

        // 20. 释放源节点资源
        await db.rollbackResources({
          hostId: sourceHostId,
          cpu: instance.cpu,
          memory: instance.memory,
          disk: instance.disk,
          portCount: 0
        })

        // 22. 发送站内信通知用户
        await createInboxMessage({
          userId: instance.userId,
          eventType: 'instance_migrated',
          title: '实例已迁移',
          content: `您的实例 ${instance.name} 已被管理员迁移到新节点。\n\n新的连接信息：\n- IPv4: ${staticIPv4}\n${staticIPv6 ? `- IPv6: ${staticIPv6}\n` : ''}- 密码保持不变\n- SSH 密钥保持不变`,
          data: {
            oldHostId: sourceHostId,
            newHostId: targetHostId,
            oldHostName: sourceHost.name,
            newHostName: targetHost.name,
            instanceId: newInstance.id,
            instanceName: instance.name
          }
        })

        results.push({ 
          id: instance.id, 
          name: instance.name, 
          success: true, 
          newInstanceId: newInstance.id 
        })

        await createLog(
          user.id,
          'instance',
          'instance.migrate',
          `Migrated instance "${instance.name}" from host "${sourceHost.name}" to "${targetHost.name}"`,
          'success'
        )
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        if (!sourceIncusDeleted) {
          if (newDbInstanceId !== null) {
            try {
              await prisma.$transaction(async tx => {
                await db.reassignInstanceBillingRecords(newDbInstanceId!, instance.id, tx)
                await tx.affBinding.deleteMany({ where: { instanceId: newDbInstanceId! } })
                await tx.instance.deleteMany({ where: { id: newDbInstanceId! } })
                await tx.instance.updateMany({
                  where: {
                    id: instance.id,
                    status: 'deleted'
                  },
                  data: { status: originalInstanceStatus }
                })
              })
            } catch (compensationErr) {
              const compensationMessage = compensationErr instanceof Error ? compensationErr.message : String(compensationErr)
              fastify.log.warn(`迁移失败后回滚数据库记录失败 (${instance.name}): ${compensationMessage}`)
            }
          }

          if (targetIncusCreated && targetIncusId) {
            try {
              await deleteIncusInstanceForMigration(
                targetClient,
                { stopInstance, deleteInstance },
                { incusId: targetIncusId, status: 'running' },
                fastify.log
              )
            } catch (compensationErr) {
              const compensationMessage = compensationErr instanceof Error ? compensationErr.message : String(compensationErr)
              fastify.log.warn(`迁移失败后删除目标实例失败 (${targetIncusId}): ${compensationMessage}`)
            }
          }

          if (targetResourcesReserved) {
            try {
              await db.rollbackResources({
                hostId: targetHostId,
                cpu: instance.cpu,
                memory: instance.memory,
                disk: instance.disk,
                portCount: 0
              })
            } catch (compensationErr) {
              const compensationMessage = compensationErr instanceof Error ? compensationErr.message : String(compensationErr)
              fastify.log.warn(`迁移失败后回滚目标节点资源失败 (${instance.name}): ${compensationMessage}`)
            }
          }
        }

        results.push({ id: instance.id, name: instance.name, success: false, error: errorMessage })
        fastify.log.error(`迁移实例失败 (${instance.name}): ${errorMessage}`)
      }
    }

    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length

    return {
      message: `成功迁移 ${successCount} 个实例${failedCount > 0 ? `，${failedCount} 个失败` : ''}`,
      results,
      successCount,
      failedCount
    }
  })

  // ==================== 批量赠送时长 ====================

  fastify.get<{
    Params: { id: string }
    Querystring: { username: string }
  }>('/:id/users/lookup', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const hostId = parsePositiveRouteId(request.params.id)
    const username = request.query.username?.trim()

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    if (!username) {
      return reply.code(400).send({ error: 'Username is required' })
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const targetUser = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        status: true
      }
    })

    if (!targetUser) {
      return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
    }

    const sshKeyCount = await prisma.sshKey.count({
      where: { userId: targetUser.id }
    })

    return {
      user: {
        id: targetUser.id,
        username: targetUser.username,
        status: targetUser.status,
        hasSshKey: sshKeyCount > 0
      }
    }
  })

  fastify.post<{
    Params: { id: string }
    Body: {
      username: string
      name: string
      packageId: number
      planId?: number
      giftDays?: number
      image: string
      cpu?: number
      memory?: number
      disk?: number
    }
  }>('/:id/instances/create-for-user', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['username', 'name', 'packageId', 'image'],
        properties: {
          username: { type: 'string', minLength: 2, maxLength: 32 },
          name: { type: 'string', minLength: 2, maxLength: 64 },
          packageId: { type: 'integer', minimum: 1 },
          planId: { type: 'integer', minimum: 1 },
          giftDays: { type: 'integer', minimum: 1, maximum: 365 },
          image: { type: 'string', minLength: 1 },
          cpu: { type: 'integer', minimum: 15, maximum: 10000 },
          memory: { type: 'integer', minimum: 128, maximum: 524288 },
          disk: { type: 'integer', minimum: 512, maximum: 104857600 }
        }
      }
    }
  }, async (request, reply) => {
    const hostId = parsePositiveRouteId(request.params.id)
    const operator = request.user
    const {
      username,
      name,
      packageId,
      planId,
      giftDays = 30,
      image,
      cpu,
      memory,
      disk
    } = request.body

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    const isAdmin = operator.role === 'admin'

    if (host.user_id !== operator.id && !isAdmin) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const nameValidation = validateName(name, 'Instance name', 2, 64)
    if (!nameValidation.valid) {
      return reply.code(400).send({ error: nameValidation.message })
    }

    const targetUser = await prisma.user.findUnique({
      where: { username: username.trim() },
      select: {
        id: true,
        username: true,
        email: true,
        status: true
      }
    })

    if (!targetUser) {
      return reply.code(400).send({ error: `用户 "${username}" 不存在` })
    }

    if (targetUser.id === operator.id && !isAdmin) {
      return reply.code(400).send({ error: '不能给自己赠送实例，请使用当前节点的普通创建功能' })
    }

    if (targetUser.status !== 'active') {
      return reply.code(400).send({ error: `用户 "${username}" 状态异常，无法创建实例` })
    }

    const targetUserSshKeys = await db.getSSHKeysByUserId(targetUser.id)
    if (targetUserSshKeys.length === 0) {
      return reply.code(400).send({ error: `用户 "${username}" 没有 SSH 密钥，请先让用户添加 SSH 密钥` })
    }

    const sshKey = targetUserSshKeys[0].public_key
    const pkg = await db.getPackageById(packageId)
    if (!pkg || !pkg.active) {
      return reply.code(400).send({ error: '套餐不存在或已禁用' })
    }

    if (pkg.user_id !== operator.id && !isAdmin) {
      return reply.code(403).send({ error: '只能使用您自己的套餐为其他用户创建实例' })
    }

    const packageHostIds = (pkg as { host_ids?: number[] }).host_ids || []
    if (packageHostIds.length > 0 && !packageHostIds.includes(hostId)) {
      return reply.code(400).send({ error: '该套餐未绑定到当前节点' })
    }
    if (packageHostIds.length === 0 && host.user_id !== pkg.user_id) {
      return reply.code(400).send({ error: '未绑定节点的套餐只能在套餐所有者的节点上创建实例' })
    }

    let selectedPlan: Awaited<ReturnType<typeof db.getPlanById>> = null
    let billing: ReturnType<typeof calculateCreateBilling> | null = null
    let planTrafficSpeed: string | null = null
    const paidGiftDays = planId ? Math.max(1, Math.min(365, Math.floor(giftDays))) : null

    if (planId) {
      selectedPlan = await db.getPlanById(planId)
      if (!selectedPlan || selectedPlan.packageId !== packageId) {
        return reply.code(400).send({ error: '方案不存在或不属于该套餐' })
      }
      if (!selectedPlan.isActive) {
        return reply.code(400).send({ error: '方案已下架' })
      }
      if (selectedPlan.isSoldOut) {
        return reply.code(400).send({ error: '方案已售罄', code: 'PLAN_SOLD_OUT' })
      }

      billing = calculateCreateBilling(selectedPlan)
      const normalizedPlanTrafficSpeed = normalizePlanTrafficLimitSpeed(selectedPlan.trafficLimitSpeed)
      if (normalizedPlanTrafficSpeed === undefined) {
        return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid plan traffic limit speed'))
      }
      planTrafficSpeed = normalizedPlanTrafficSpeed
    }

    const requestedCpu = selectedPlan ? selectedPlan.cpu : (cpu || 15)
    const requestedMemory = selectedPlan ? selectedPlan.memory : (memory || 128)
    const requestedDisk = selectedPlan ? selectedPlan.disk : (disk || 512)

    if (!await isValidSystemImage(image)) {
      return reply.code(400).send({ error: '镜像不存在' })
    }

    const pkgInstanceType = (pkg as typeof pkg & { instance_type?: 'container' | 'vm' }).instance_type || 'container'
    if (!await isImageCompatibleWithInstanceType(image, pkgInstanceType)) {
      return reply.code(400).send({ error: '镜像类型与套餐类型不兼容' })
    }

    if (!await isImageCompatibleWithMemory(image, requestedMemory)) {
      return reply.code(400).send({ error: '128MB 内存只能使用 Alpine/Debian 镜像' })
    }

    const pkgWithExtras = pkg as typeof pkg & {
      node_selectors?: string
      port_limit?: number
      snapshot_limit?: number
      backup_limit?: number
      site_limit?: number
      monthly_traffic_limit?: string | null
      io_limit_mode?: string
      limits_read?: string | null
      limits_write?: string | null
      limits_read_iops?: number | null
      limits_write_iops?: number | null
      limits_ingress?: string | null
      limits_egress?: string | null
      limits_processes?: number | null
      limits_cpu_priority?: number | null
      boot_autostart?: boolean | null
      boot_autostart_priority?: number | null
      boot_autostart_delay?: number | null
      boot_host_shutdown_timeout?: number | null
    }

    const preCheckHost = await db.selectAvailableHost({
      packageHostIds: packageHostIds.length > 0 ? packageHostIds : undefined,
      nodeSelectors: JSON.parse(pkgWithExtras.node_selectors || '[]'),
      cpu: requestedCpu,
      memory: requestedMemory,
      disk: requestedDisk,
      hostId,
      ownerId: pkg.user_id!
    })

    if (!preCheckHost) {
      return reply.code(400).send({ error: '当前节点资源不足或不可用' })
    }

    const hostInstanceType = preCheckHost.instance_type || 'container'
    if (pkgInstanceType === 'vm' && hostInstanceType === 'container') {
      return reply.code(400).send({ error: '套餐要求虚拟机，但当前节点只支持容器' })
    }
    if (pkgInstanceType === 'container' && hostInstanceType === 'vm') {
      return reply.code(400).send({ error: '套餐要求容器，但当前节点只支持虚拟机' })
    }

    const hostImageAvailability = await getSystemImageAvailabilityForHost(image, preCheckHost.id, {
      instanceType: pkgInstanceType,
      memory: requestedMemory
    })
    if (!hostImageAvailability.ok) {
      switch (hostImageAvailability.reason) {
        case 'host_not_found':
          return reply.code(404).send({ error: '节点不存在' })
        case 'image_not_found':
          return reply.code(400).send({ error: '镜像不存在' })
        case 'memory_incompatible':
          return reply.code(400).send({ error: '128MB 内存只能使用 Alpine/Debian 镜像' })
        case 'instance_type_mismatch':
          return reply.code(400).send({ error: '镜像类型与套餐类型不兼容' })
        case 'host_instance_type_mismatch':
          return reply.code(400).send({ error: '套餐类型与宿主机不兼容' })
        default:
          return reply.code(400).send({ error: '当前节点不可用该镜像' })
      }
    }

    const networkMode = (pkg.network_mode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
    if (pkgInstanceType === 'vm' && ['nat_ipv6_nat', 'ipv6_nat'].includes(networkMode)) {
      return reply.code(400).send({ error: 'KVM packages do not support IPv4 NAT & IPv6 NAT or IPv6 NAT network modes' })
    }
    const autoPassword = randomUUID().replace(/-/g, '').slice(0, 16)
    const { configPayload, metaData } = generateIncusConfig({
      instanceName: name,
      imageAlias: image,
      rootPassword: autoPassword,
      sshKey,
      networkMode,
      type: pkgInstanceType === 'vm' ? 'virtual-machine' : 'container'
    })

    const incusId = `u${targetUser.id}-${randomUUID().replace(/-/g, '').slice(0, 8)}`
    const packageTrafficLimit = pkgWithExtras.monthly_traffic_limit ? BigInt(pkgWithExtras.monthly_traffic_limit) : null

    let instanceId = 0
    let lockedHost: Awaited<ReturnType<typeof db.selectAndReserveHostWithLock>> | null = null

    try {
      const { Prisma } = await import('@prisma/client')
      const paidGiftExpiresAt = selectedPlan && paidGiftDays
        ? new Date(Date.now() + paidGiftDays * 24 * 60 * 60 * 1000)
        : null

      const txResult = await prisma.$transaction(async (tx) => {
        const reservedHost = await db.selectAndReserveHostWithLock(tx, {
          packageHostIds: packageHostIds.length > 0 ? packageHostIds : undefined,
          nodeSelectors: JSON.parse(pkgWithExtras.node_selectors || '[]'),
          cpu: requestedCpu,
          memory: requestedMemory,
          disk: requestedDisk,
          hostId,
          ownerId: pkg.user_id!,
          portCount: ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(networkMode) ? (selectedPlan?.portLimit || pkgWithExtras.port_limit || 0) : 0
        })

        if (!reservedHost) {
          throw new Error('HOST_RESOURCES_INSUFFICIENT')
        }

        const baseMonthlyTrafficLimit = selectedPlan ? selectedPlan.trafficLimit : packageTrafficLimit
        const effectiveMonthlyTrafficLimit = await resolveInstanceTrafficLimitForHost(tx as any, {
          packageId,
          hostId: reservedHost.id,
          baseTrafficLimit: baseMonthlyTrafficLimit
        })

        const instanceQuota = selectedPlan ? {
          portLimit: selectedPlan.portLimit,
          snapshotLimit: selectedPlan.snapshotLimit,
          backupLimit: selectedPlan.backupLimit,
          siteLimit: selectedPlan.siteLimit,
          swapSize: pkgInstanceType === 'container' ? selectedPlan.swapSize : null,
          monthlyTrafficLimit: effectiveMonthlyTrafficLimit,
          limitsIngress: planTrafficSpeed,
          limitsEgress: planTrafficSpeed
        } : {
          portLimit: pkgWithExtras.port_limit ?? null,
          snapshotLimit: pkgWithExtras.snapshot_limit ?? null,
          backupLimit: pkgWithExtras.backup_limit ?? null,
          siteLimit: pkgWithExtras.site_limit ?? null,
          swapSize: null as number | null,
          monthlyTrafficLimit: effectiveMonthlyTrafficLimit,
          limitsIngress: null as string | null,
          limitsEgress: null as string | null
        }

        const snapshotSpecs = {
          packageId: pkg.id,
          packageName: pkg.name,
          planId: selectedPlan?.id ?? null,
          planName: selectedPlan?.name ?? null,
          cpuMax: pkg.cpu_max,
          memoryMax: pkg.memory_max,
          diskMax: pkg.disk_max,
          networkMode,
          portLimit: selectedPlan?.portLimit || pkgWithExtras.port_limit || 20,
          nested: Boolean(pkg.nested),
          privileged: Boolean(pkg.privileged),
          nodeSelectors: JSON.parse(pkgWithExtras.node_selectors || '[]'),
          createdAt: new Date().toISOString(),
          hostOwnerGift: !isAdmin,
          adminGift: isAdmin,
          giftBy: operator.id,
          giftByType: isAdmin ? 'admin' : 'host_owner',
          isPaidInstance: !!selectedPlan,
          chargedFirstMonth: false,
          giftDays: paidGiftDays
        }

        const instance = await tx.instance.create({
          data: {
            incusId,
            name,
            userId: targetUser.id,
            hostId: reservedHost.id,
            packageId,
            packagePlanId: selectedPlan?.id ?? null,
            image,
            cpu: requestedCpu,
            memory: requestedMemory,
            disk: requestedDisk,
            networkMode,
            snapshottedSpecs: snapshotSpecs as any,
            sshPort: metaData.sshPort,
            rootPassword: encryptSensitiveData(metaData.rootPassword),
            status: 'creating',
            monthlyTrafficLimit: instanceQuota.monthlyTrafficLimit,
            portLimit: instanceQuota.portLimit,
            snapshotLimit: instanceQuota.snapshotLimit,
            backupLimit: instanceQuota.backupLimit,
            siteLimit: instanceQuota.siteLimit,
            swapEnabled: false,
            swapSize: instanceQuota.swapSize,
            limitsIngress: instanceQuota.limitsIngress,
            limitsEgress: instanceQuota.limitsEgress,
            expiresAt: paidGiftExpiresAt,
            billingPrice: billing?.price ?? null,
            billingCycle: billing?.billingCycle ?? null,
            autoRenew: false
          }
        })

        if (selectedPlan && billing && paidGiftExpiresAt && paidGiftDays) {
          await tx.instanceBillingRecord.create({
            data: {
              instanceId: instance.id,
              userId: targetUser.id,
              type: 'newPurchase',
              amount: 0,
              months: 0,
              periodStart: new Date(),
              periodEnd: paidGiftExpiresAt,
              balanceLogId: null,
              remark: `${isAdmin ? '管理员' : '节点所有者'}赠送付费实例免费时长 ${paidGiftDays} 天`
            }
          })
        }

        return {
          instanceId: instance.id,
          reservedHost
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000
      })

      instanceId = txResult.instanceId
      lockedHost = txResult.reservedHost
      if (!lockedHost) {
        throw new Error('HOST_NOT_FOUND')
      }

      let staticIPv4: string | null = null
      let staticIPv6: string | null = null

      try {
        let attempts = 0
        while (attempts < 50) {
          staticIPv4 = generateRandomIPv4()
          const exists = await db.isIpAddressExistsOnHost(staticIPv4, lockedHost.id)
          if (!exists) break
          attempts++
          staticIPv4 = null
        }
      } catch (error) {
        fastify.log.warn(error, '[Host Create For User] failed to allocate IPv4')
      }

      const lockedHostWithIpv6 = lockedHost as typeof lockedHost & {
        ipv6_mode?: number
        ipv6_subnet?: string | null
        ipv6_gateway?: string | null
        ipv6_parent_interface?: string | null
      }

      // 仅 Routed 模式（需要独立 IPv6 地址）才从子网分配
      const needsRoutedIPv6 = ['nat_ipv6', 'ipv6_only'].includes(networkMode)
      if (lockedHostWithIpv6.ipv6_subnet && needsRoutedIPv6) {
        try {
          let attempts = 0
          while (attempts < 50) {
            staticIPv6 = generateRandomIPv6(lockedHostWithIpv6.ipv6_subnet)
            const exists = await db.isIpAddressExists(staticIPv6)
            if (!exists) break
            attempts++
            staticIPv6 = null
          }
        } catch (error) {
          fastify.log.warn(error, '[Host Create For User] failed to allocate IPv6')
        }
      }

      let finalConfigPayload = configPayload
      if (pkgInstanceType === 'vm') {
        const { generateVmConfig } = await import('../lib/incus-config-vm.js')
        const vmResult = generateVmConfig({
          instanceName: name,
          instanceIdSeed: incusId,
          imageAlias: image,
          rootPassword: metaData.rootPassword,
          sshKey,
          network: staticIPv4 ? {
            ipAddress: `${staticIPv4}/22`,
            gateway: '10.10.0.1',
            dns: ['8.8.8.8', '1.1.1.1'],
            ipv6Address: staticIPv6 || undefined,
            ipv6Gateway: staticIPv6 ? (lockedHostWithIpv6.ipv6_gateway || undefined) : undefined
          } : undefined
        })
        finalConfigPayload = vmResult.configPayload
      } else if (staticIPv4) {
        // 容器类型：重新生成包含静态 IP 的 cloud-init 配置
        const containerResult = generateIncusConfig({
          instanceName: name,
          imageAlias: image,
          rootPassword: metaData.rootPassword,
          sshKey,
          networkMode,
          type: 'container',
          network: {
            ipAddress: `${staticIPv4}/22`,
            gateway: '10.10.0.1',
            dns: ['8.8.8.8', '1.1.1.1'],
            ipv6Address: staticIPv6 ? `${staticIPv6}/128` : undefined,
            ipv6Gateway: staticIPv6 ? 'fe80::1' : undefined
          }
        })
        finalConfigPayload = containerResult.configPayload
      }

      let selectedStoragePool = await db.resolveStoragePoolForNewInstance(lockedHost.id, { packageId })
      if (!selectedStoragePool) {
        selectedStoragePool = 'default'
      }

      await prisma.instance.update({
        where: { id: instanceId },
        data: {
          storagePoolName: selectedStoragePool
        }
      })

      const ioMode = pkgWithExtras.io_limit_mode || 'throughput'

      provisionManagedInstanceAsync(instanceId, lockedHost as unknown as Host, {
        name: incusId,
        image,
        cpu: requestedCpu,
        memory: requestedMemory,
        disk: requestedDisk,
        cloudInitConfig: finalConfigPayload,
        networkMode,
        nested: Boolean(pkg.nested),
        privileged: Boolean(pkg.privileged),
        portLimit: pkgWithExtras.port_limit || 20,
        instanceType: pkgInstanceType,
        sshPort: metaData.sshPort,
        storagePool: selectedStoragePool,
        ipv4Address: staticIPv4,
        ipv6Address: staticIPv6,
        ipv6Gateway: lockedHostWithIpv6.ipv6_gateway || null,
        hostInterface: lockedHostWithIpv6.ipv6_parent_interface || 'eth0',
        limitsRead: ioMode === 'throughput' ? pkgWithExtras.limits_read : null,
        limitsWrite: ioMode === 'throughput' ? pkgWithExtras.limits_write : null,
        limitsReadIops: ioMode === 'iops' ? pkgWithExtras.limits_read_iops : null,
        limitsWriteIops: ioMode === 'iops' ? pkgWithExtras.limits_write_iops : null,
        limitsIngress: planTrafficSpeed || pkgWithExtras.limits_ingress,
        limitsEgress: planTrafficSpeed || pkgWithExtras.limits_egress,
        limitsProcesses: pkgWithExtras.limits_processes,
        limitsCpuPriority: pkgWithExtras.limits_cpu_priority,
        bootAutostart: pkgWithExtras.boot_autostart,
        bootAutostartPriority: pkgWithExtras.boot_autostart_priority,
        bootAutostartDelay: pkgWithExtras.boot_autostart_delay,
        bootHostShutdownTimeout: pkgWithExtras.boot_host_shutdown_timeout
      }).catch(error => {
        fastify.log.error(error, `[Host Create For User] instance ${instanceId} provisioning failed`)
      })

      const logDetail = selectedPlan
        ? `${isAdmin ? 'Admin' : 'Host owner'} created paid instance "${name}" for user ${targetUser.username} on host "${lockedHost.name}" (Package: ${pkg.name}, Plan: ${selectedPlan.name}, Gift: ${paidGiftDays} days free)`
        : `${isAdmin ? 'Admin' : 'Host owner'} created free instance "${name}" for user ${targetUser.username} on host "${lockedHost.name}" (Package: ${pkg.name})`

      await createLog(
        operator.id,
        'host',
        'host.instance_create_for_user',
        logDetail,
        'success',
        { instanceId }
      )

      const formatMemory = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
      const formatDiskSize = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`
      const resourceInfo = `CPU ${requestedCpu}% | 内存 ${formatMemory(requestedMemory)} | 磁盘 ${formatDiskSize(requestedDisk)}`

      let notifyTitle: string
      let notifyContent: string
      if (selectedPlan) {
        notifyTitle = isAdmin ? '收到管理员赠送的付费实例' : '收到节点所有者赠送的付费实例'
        notifyContent = `${isAdmin ? '管理员' : '节点所有者'} ${operator.username} 为您赠送了一台付费实例：${name}
套餐：${pkg.name}
方案：${selectedPlan.name}
配置：${resourceInfo}
节点：${lockedHost.name}
免费时长：${paidGiftDays} 天
到期时间：${paidGiftExpiresAt!.toLocaleDateString()}
到期后将按方案价格正常计费`
      } else {
        notifyTitle = isAdmin ? '收到管理员赠送的实例' : '收到节点所有者赠送的实例'
        notifyContent = `${isAdmin ? '管理员' : '节点所有者'} ${operator.username} 为您创建了一台实例：${name}
套餐：${pkg.name}
配置：${resourceInfo}
节点：${lockedHost.name}`
      }

      await createInboxMessage({
        userId: targetUser.id,
        eventType: selectedPlan ? 'instance_paid_created' : 'instance_gift',
        title: notifyTitle,
        content: notifyContent,
        data: {
          instanceId,
          instanceName: name,
          packageName: pkg.name,
          planName: selectedPlan?.name ?? null,
          cpu: requestedCpu,
          memory: requestedMemory,
          disk: requestedDisk,
          hostName: lockedHost.name,
          isPaid: !!selectedPlan,
          charged: false,
          amount: 0,
          expiresAt: paidGiftExpiresAt?.toISOString() ?? null,
          giftDays: paidGiftDays ?? null,
          createdBy: operator.username,
          creatorType: isAdmin ? 'admin' : 'host_owner'
        }
      })

      if (targetUser.email) {
        try {
          await sendAdminInstanceCreatedEmail(targetUser.email, {
            username: targetUser.username,
            instanceName: name,
            packageName: pkg.name,
            planName: selectedPlan?.name,
            hostName: lockedHost.name,
            cpu: requestedCpu,
            memory: requestedMemory,
            disk: requestedDisk,
            isPaid: !!selectedPlan,
            charged: false,
            amount: 0,
            expiresAt: paidGiftExpiresAt || undefined,
            giftDays: paidGiftDays || undefined,
            creatorType: isAdmin ? 'admin' : 'host_owner',
            creatorName: operator.username
          })
        } catch (error) {
          fastify.log.warn(error, '[Host Create For User] failed to send email')
        }
      }

      return reply.status(202).send({
        message: '实例创建中',
        instance: {
          id: instanceId,
          name,
          incusId,
          host: lockedHost.name,
          status: 'creating',
          user: { id: targetUser.id, username: targetUser.username },
          isPaid: !!selectedPlan,
          planName: selectedPlan?.name ?? null,
          charged: false,
          amount: 0,
          expiresAt: paidGiftExpiresAt?.toISOString() ?? null,
          giftDays: paidGiftDays ?? null
        }
      })
    } catch (error: any) {
      fastify.log.error(error, '[Host Create For User] failed')

      if (error.message?.includes('HOST_RESOURCES_INSUFFICIENT')) {
        return reply.status(503).send({ error: '当前节点资源不足或已被占用' })
      }
      if (error.message?.includes('USER_NOT_FOUND')) {
        return reply.status(400).send({ error: '用户不存在' })
      }

      return reply.status(500).send({ error: '创建实例失败，请稍后重试' })
    }
  })

  // POST /api/hosts/:id/instances/gift-days - 节点所有者为实例赠送时长（免费）
  fastify.post<{
    Params: { id: string }
    Body: { instanceIds: number[]; days: number }
  }>('/:id/instances/gift-days', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['instanceIds', 'days'],
        properties: {
          instanceIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 100
          },
          days: { type: 'integer', minimum: 1, maximum: 365 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)
    const instanceIds = parsePositiveIntegerArrayBody(request.body.instanceIds, HOST_BATCH_INSTANCE_MAX_ITEMS)
    const days = parseIntegerBody(request.body.days, 1, HOST_GIFT_DAYS_MAX)

    if (!hostId || !instanceIds || !days) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证节点存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以赠送时长
    if (host.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取该节点下的付费实例（package_plan_id 不为 null）
    const instances = await prisma.instance.findMany({
      where: {
        id: { in: instanceIds },
        hostId: hostId,
        status: { not: 'deleted' },
        packagePlanId: { not: null }  // 只处理付费实例
      },
      include: {
        user: { select: { id: true, username: true } }
      }
    })

    if (instances.length === 0) {
      return reply.code(400).send({ error: '没有找到可赠送时长的付费实例' })
    }

    const results: { instanceId: number; instanceName: string; success: boolean; error?: string; newExpiresAt?: string }[] = []
    const now = new Date()
    const msPerDay = 24 * 60 * 60 * 1000

    for (const instance of instances) {
      try {
        // 计算新的到期时间
        let baseDate: Date
        if (instance.expiresAt && instance.expiresAt > now) {
          // 未过期：从当前到期时间延长
          baseDate = instance.expiresAt
        } else {
          // 已过期或无到期时间：从当前时间开始
          baseDate = now
        }
        const newExpiresAt = new Date(baseDate.getTime() + days * msPerDay)

        // 更新实例到期时间
        await prisma.instance.update({
          where: { id: instance.id },
          data: {
            expiresAt: newExpiresAt,
            // 如果实例是因过期被封停的，自动解封
            status: instance.status === 'suspended' && instance.suspendReason === 'expired' ? 'stopped' : instance.status,
            suspendedAt: instance.status === 'suspended' && instance.suspendReason === 'expired' ? null : instance.suspendedAt,
            suspendedBy: instance.status === 'suspended' && instance.suspendReason === 'expired' ? null : instance.suspendedBy,
            suspendReason: instance.status === 'suspended' && instance.suspendReason === 'expired' ? null : instance.suspendReason
          }
        })

        results.push({
          instanceId: instance.id,
          instanceName: instance.name,
          success: true,
          newExpiresAt: newExpiresAt.toISOString()
        })

        // 记录日志
        fastify.log.info(`[GiftDays] Host owner ${user.username} gifted ${days} days to instance ${instance.name} (ID: ${instance.id}), new expires_at: ${newExpiresAt.toISOString()}`)
      } catch (err: any) {
        const errorMessage = err?.message || String(err)
        results.push({
          instanceId: instance.id,
          instanceName: instance.name,
          success: false,
          error: errorMessage
        })
        fastify.log.error(`[GiftDays] Failed to gift days to instance ${instance.name}: ${errorMessage}`)
      }
    }

    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length

    return {
      message: `成功为 ${successCount} 个实例赠送 ${days} 天${failedCount > 0 ? `，${failedCount} 个失败` : ''}`,
      results,
      successCount,
      failedCount,
      skippedCount: instanceIds.length - instances.length  // 跳过的免费实例数
    }
  })

  // PATCH /api/hosts/:id/instances/:instanceId/renewal-price - 节点所有者修改付费实例的续费价格
  fastify.patch<{
    Params: { id: string; instanceId: string }
    Body: { newPrice: number }
  }>('/:id/instances/:instanceId/renewal-price', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['newPrice'],
        properties: {
          newPrice: { type: 'number', minimum: 0, maximum: 99999 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parsePositiveRouteId(request.params.instanceId)
    const newPrice = parseFiniteNumberBody(request.body.newPrice, 0, HOST_RENEWAL_PRICE_MAX)

    if (!hostId || !instanceId || newPrice === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证节点存在且属于当前用户
    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 权限检查：只有节点所有者可以修改价格
    if (host.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取实例并验证
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        user: { select: { id: true, username: true, email: true } }
      }
    })

    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 验证实例属于该节点
    if (instance.hostId !== hostId) {
      return reply.code(400).send({ error: '实例不属于该节点' })
    }

    // 验证是付费实例
    if (!instance.packagePlanId) {
      return reply.code(400).send({ error: '只能修改付费实例的续费价格' })
    }

    // 验证实例未删除
    if (instance.status === 'deleted') {
      return reply.code(400).send({ error: '实例已删除' })
    }

    const oldPrice = instance.billingPrice ? Number(instance.billingPrice) : 0

    // 检查价格是否有变化
    if (Math.abs(oldPrice - newPrice) < 0.001) {
      return reply.code(400).send({ error: '新价格与原价格相同，无需修改' })
    }

    // 更新实例续费价格
    await prisma.instance.update({
      where: { id: instanceId },
      data: {
        billingPrice: newPrice
      }
    })

    // 发送通知给用户
    try {
      await sendNotification(instance.userId, 'instance_renewal_price_updated', {
        instanceName: instance.name,
        oldPrice,
        newPrice,
        hostName: host.name
      })
    } catch (err) {
      fastify.log.error(`[UpdateRenewalPrice] Failed to send notification: ${err}`)
    }

    if (instance.user?.email) {
      try {
        await sendRenewalPriceUpdatedEmail(instance.user.email, {
          username: instance.user.username,
          instanceName: instance.name,
          hostName: host.name,
          oldPrice,
          newPrice
        })
      } catch (err) {
        fastify.log.error(`[UpdateRenewalPrice] Failed to send email: ${err}`)
      }
    }

    // 记录日志
    await createLog(
      user.id,
      'host',
      'host.update_instance_renewal_price',
      `Updated renewal price for instance "${instance.name}" (ID: ${instanceId}): ¥${oldPrice.toFixed(2)} -> ¥${newPrice.toFixed(2)}`,
      'success'
    )

    fastify.log.info(`[UpdateRenewalPrice] Host owner ${user.username} updated renewal price for instance ${instance.name}: ¥${oldPrice.toFixed(2)} -> ¥${newPrice.toFixed(2)}`)

    return {
      message: '续费价格已更新',
      instanceId,
      instanceName: instance.name,
      oldPrice,
      newPrice
    }
  })

  // ========== 宿主机运维中心 ==========

  // 宿主机实例盘点：读取 Incus 实例并与数据库对账
  fastify.post<{ Params: { id: string } }>('/:id/ops/discover', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const client = await getIncusClient(host)
      const { listInstances } = await import('../lib/incus/incus-instances.js')

      // 从 Incus 读取宿主机上真实存在的所有实例
      const incusInstances = await listInstances(client) as Array<{
        name: string
        type: string
        status: string
        config?: Record<string, unknown>
        devices?: Record<string, unknown>
      }>

      // 从数据库读取该节点下所有非已删除实例
      const dbInstances = await prisma.instance.findMany({
        where: { hostId, status: { not: 'deleted' } },
        select: { id: true, name: true, incusId: true, status: true, networkMode: true, ipv4: true, ipv6: true, userId: true }
      })

      // 建立 incusId -> db实例 映射
      const dbByIncusId = new Map(dbInstances.map(i => [i.incusId, i]))
      const incusByName = new Map(incusInstances.map(i => [i.name, i]))

      // 分类
      const managed: Array<{ incusName: string; incusType: string; incusStatus: string; dbId: number; dbStatus: string; userId: number }> = []
      const orphaned: Array<{ incusName: string; incusType: string; incusStatus: string }> = []
      const missing: Array<{ dbId: number; dbName: string; incusId: string; dbStatus: string }> = []

      for (const inst of incusInstances) {
        const dbInst = dbByIncusId.get(inst.name)
        if (dbInst) {
          managed.push({
            incusName: inst.name,
            incusType: inst.type,
            incusStatus: inst.status,
            dbId: dbInst.id,
            dbStatus: dbInst.status,
            userId: dbInst.userId
          })
        } else {
          orphaned.push({
            incusName: inst.name,
            incusType: inst.type,
            incusStatus: inst.status
          })
        }
      }

      for (const dbInst of dbInstances) {
        if (!incusByName.has(dbInst.incusId)) {
          missing.push({
            dbId: dbInst.id,
            dbName: dbInst.name,
            incusId: dbInst.incusId,
            dbStatus: dbInst.status
          })
        }
      }

      request.log.info(`[ops/discover] host=${host.name} managed=${managed.length} orphaned=${orphaned.length} missing=${missing.length}`)

      return {
        managed,
        orphaned,
        missing,
        summary: {
          totalIncus: incusInstances.length,
          totalDb: dbInstances.length,
          managedCount: managed.length,
          orphanedCount: orphaned.length,
          missingCount: missing.length
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      request.log.error(`[ops/discover] host=${host.name} error=${errorMessage}`)
      return reply.code(500).send({ error: errorMessage })
    }
  })

  // 宿主机基线同步：同步资源信息 + 批量同步实例状态/IP
  fastify.post<{ Params: { id: string } }>('/:id/ops/baseline-sync', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    try {
      const client = await getIncusClient(host)

      // 1. 同步宿主机资源信息（复用 sync 逻辑）
      const resources = await client.getResources() as {
        cpu?: { total?: number }
        memory?: { total?: number }
        storage?: { disks?: Array<{ size?: number }>; pools?: Record<string, { space?: { total?: number } }> }
      }

      await db.updateHostStatus(hostId, 'online')

      const detectedIpv6 = extractHostPublicIpv6FromResources(resources as Record<string, unknown>)
      if (detectedIpv6 && !host.nat_public_ipv6) {
        await prisma.host.update({
          where: { id: hostId },
          data: { natPublicIpv6: detectedIpv6 }
        })
      }

      const usedResources = await db.calculateHostResourcesFromInstances(hostId)
      await db.updateHostResources(hostId, {
        cpuUsed: usedResources.cpuUsed,
        memoryUsed: usedResources.memoryUsed,
        diskUsed: usedResources.diskUsed
      })

      // 2. 获取节点下所有 running 状态实例
      const instances = await prisma.instance.findMany({
        where: { hostId, status: 'running' }
      })

      request.log.info(`[ops/baseline-sync] host=${host.name} syncing ${instances.length} running instances`)

      let syncedCount = 0
      let ipChangedCount = 0

      if (instances.length > 0) {
        const { getInstance, getInstanceState } = await import('../lib/incus/incus-instances.js')
        const { mapInstanceStatus } = await import('../lib/incus/incus-utils.js')

        for (const instance of instances) {
          try {
            const [state, incusInstance] = await Promise.all([
              getInstanceState(client, instance.incusId),
              getInstance(client, instance.incusId)
            ]) as [{
              status?: string
              network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
            }, {
              devices?: Record<string, Record<string, unknown>>
              expanded_devices?: Record<string, Record<string, unknown>>
            }]

            if (state.status) {
              const newStatus = mapInstanceStatus(state.status)
              if (newStatus !== 'unknown' && newStatus !== instance.status) {
                await db.updateInstanceStatus(instance.id, newStatus as 'creating' | 'running' | 'stopped' | 'error')
              }
            }

            const persistedNetwork = await persistResolvedInstanceNetworkAddresses(
              { id: instance.id, name: instance.name, hostId: host.id, networkMode: instance.networkMode, ipv4: instance.ipv4, ipv6: instance.ipv6 },
              resolveInstanceNetworkAddresses(
                { id: instance.id, name: instance.name, hostId: host.id, networkMode: instance.networkMode, ipv4: instance.ipv4, ipv6: instance.ipv6 },
                incusInstance,
                state
              ),
              { updateLastSyncedAt: true }
            )

            if (persistedNetwork.ipv4Changed || persistedNetwork.ipv6Changed) {
              ipChangedCount++
            }
            syncedCount++
          } catch (err) {
            request.log.warn(`[ops/baseline-sync] instance ${instance.incusId} sync failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }

      request.log.info(`[ops/baseline-sync] host=${host.name} done. synced=${syncedCount} ipChanged=${ipChangedCount}`)

      return {
        message: 'Baseline sync completed',
        resources: {
          cpuUsed: usedResources.cpuUsed,
          memoryUsed: usedResources.memoryUsed,
          diskUsed: usedResources.diskUsed
        },
        instanceSync: {
          total: instances.length,
          synced: syncedCount,
          ipChanged: ipChangedCount
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      request.log.error(`[ops/baseline-sync] host=${host.name} error=${errorMessage}`)
      return reply.code(500).send({ error: errorMessage })
    }
  })

  // 宿主机网络修复：对所有实例批量同步 IP/状态
  fastify.post<{ Params: { id: string } }>('/:id/ops/network-repair', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const { id } = request.params
    const hostId = parsePositiveRouteId(id)

    if (!hostId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    let client: IncusClient
    try {
      client = await getIncusClient(host)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return reply.code(503).send({ error: `无法连接到节点: ${errorMessage}` })
    }

    // 获取所有非删除状态实例
    const instances = await prisma.instance.findMany({
      where: { hostId, status: { notIn: ['deleted', 'creating'] } }
    })

    const { getInstance, getInstanceState } = await import('../lib/incus/incus-instances.js')
    const { mapInstanceStatus } = await import('../lib/incus/incus-utils.js')

    const results: Array<{
      id: number
      name: string
      success: boolean
      statusChanged?: boolean
      oldStatus?: string
      newStatus?: string
      ipv4Changed?: boolean
      oldIpv4?: string | null
      newIpv4?: string | null
      ipv6Changed?: boolean
      oldIpv6?: string | null
      newIpv6?: string | null
      error?: string
    }> = []

    let successCount = 0
    let changedCount = 0

    for (const instance of instances) {
      try {
        const [state, incusInstance] = await Promise.all([
          getInstanceState(client!, instance.incusId),
          getInstance(client!, instance.incusId)
        ]) as [{
          status?: string
          network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
        }, {
          devices?: Record<string, Record<string, unknown>>
          expanded_devices?: Record<string, Record<string, unknown>>
        }]

        let statusChanged = false
        const oldStatus = instance.status
        let newStatus: string = instance.status

        if (state.status) {
          const mapped = mapInstanceStatus(state.status)
          if (mapped !== 'unknown' && mapped !== instance.status) {
            await db.updateInstanceStatus(instance.id, mapped as 'creating' | 'running' | 'stopped' | 'error')
            statusChanged = true
            newStatus = mapped
            changedCount++
          }
        }

        const persistedNetwork = await persistResolvedInstanceNetworkAddresses(
          { id: instance.id, name: instance.name, hostId: host.id, networkMode: instance.networkMode, ipv4: instance.ipv4, ipv6: instance.ipv6 },
          resolveInstanceNetworkAddresses(
            { id: instance.id, name: instance.name, hostId: host.id, networkMode: instance.networkMode, ipv4: instance.ipv4, ipv6: instance.ipv6 },
            incusInstance,
            state
          ),
          { updateLastSyncedAt: true }
        )

        if (persistedNetwork.ipv4Changed || persistedNetwork.ipv6Changed) {
          changedCount++
        }

        results.push({
          id: instance.id,
          name: instance.name,
          success: true,
          statusChanged: statusChanged || undefined,
          oldStatus: statusChanged ? oldStatus : undefined,
          newStatus: statusChanged ? newStatus : undefined,
          ipv4Changed: persistedNetwork.ipv4Changed || undefined,
          oldIpv4: persistedNetwork.ipv4Changed ? persistedNetwork.oldIpv4 : undefined,
          newIpv4: persistedNetwork.ipv4Changed ? persistedNetwork.newIpv4 : undefined,
          ipv6Changed: persistedNetwork.ipv6Changed || undefined,
          oldIpv6: persistedNetwork.ipv6Changed ? persistedNetwork.oldIpv6 : undefined,
          newIpv6: persistedNetwork.ipv6Changed ? persistedNetwork.newIpv6 : undefined
        })
        successCount++
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        results.push({
          id: instance.id,
          name: instance.name,
          success: false,
          error: errorMessage
        })
      }
    }

    request.log.info(`[ops/network-repair] host=${host.name} total=${instances.length} success=${successCount} changed=${changedCount}`)

    return {
      message: 'Network repair completed',
      results,
      summary: {
        total: instances.length,
        success: successCount,
        failed: instances.length - successCount,
        changed: changedCount
      }
    }
  })

  fastify.post<{
    Params: { id: string; instanceId: string }
  }>('/:id/ops/instances/:instanceId/preview', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parsePositiveRouteId(request.params.instanceId)

    if (!hostId || !instanceId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.host_id !== hostId) {
      return reply.code(400).send({ error: '实例不属于该节点' })
    }

    const activeTask = await getActiveTaskForInstance(instanceId)
    const isStopped = instance.status === 'stopped'
    const isSuspended = instance.status === 'suspended'
    const canSync = !activeTask
    const canRestart = !activeTask && !isSuspended
    const canForceRestart = !activeTask && !isSuspended
    const canRebuild = !activeTask && !isSuspended && isStopped
    const canRecreate = !activeTask && !isSuspended

    const notes: string[] = []
    if (activeTask) {
      notes.push(`当前存在进行中的 ${activeTask.taskType} 任务 #${activeTask.id}`)
    }
    if (isSuspended) {
      notes.push(instance.suspend_reason === 'expired' ? '实例处于到期封停状态，不允许高风险操作' : '实例处于封停状态，不允许高风险操作')
    }
    if (!isStopped) {
      notes.push('实例当前不是 stopped，高风险重装需先停机')
    }

    let suggestedAction: 'rebuild' | 'recreate' | 'sync' | 'restart' | 'none' = 'none'
    if (activeTask || isSuspended) {
      suggestedAction = 'none'
    } else if (!isStopped) {
      suggestedAction = 'sync'
    } else {
      suggestedAction = 'rebuild'
    }

    return {
      instanceId: instance.id,
      instanceName: instance.name,
      incusId: instance.incus_id,
      instanceStatus: instance.status,
      hostName: host.name,
      hostId: host.id,
      imageAlias: instance.image || null,
      canSync,
      canRestart,
      canForceRestart,
      canRebuild,
      canRecreate,
      activeTask: activeTask
        ? {
            id: activeTask.id,
            taskType: activeTask.taskType,
            status: activeTask.status
          }
        : null,
      risk: {
        status: instance.status,
        isStopped,
        hasActiveTask: !!activeTask,
        suggestedAction,
        notes
      }
    }
  })

  fastify.get<{
    Params: { id: string; instanceId: string }
  }>('/:id/ops/instances/:instanceId/ssh-keys', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parsePositiveRouteId(request.params.instanceId)

    if (!hostId || !instanceId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.host_id !== hostId) {
      return reply.code(400).send({ error: '实例不属于该节点' })
    }

    const keys = await getSSHKeysByUserId(instance.user_id)
    return {
      keys: keys.map(key => ({
        id: key.id,
        name: key.name,
        fingerprint: key.fingerprint,
        created_at: key.created_at
      }))
    }
  })

  fastify.get<{
    Params: { id: string; instanceId: string }
    Querystring: { distro?: string }
  }>('/:id/ops/instances/:instanceId/init-commands', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parsePositiveRouteId(request.params.instanceId)
    const distro = (request.query.distro || 'linux').trim()

    if (!hostId || !instanceId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.host_id !== hostId) {
      return reply.code(400).send({ error: '实例不属于该节点' })
    }

    const commands = await getEnabledCommandsByDistro(instance.user_id, distro)
    return {
      commands: commands.map(cmd => ({
        id: cmd.id,
        name: cmd.name,
        commandLineCount: cmd.command.split(/\r?\n/).filter(line => line.trim().length > 0).length,
        distros: cmd.distros,
        description: cmd.description
      }))
    }
  })

  fastify.get<{
    Params: { id: string }
  }>('/:id/ops/audit/rules', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    if (!hostId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const rules = await getAuditRuleResponses(hostId)

    return {
      ...rules,
      canCreateGlobal: user.role === 'admin'
    }
  })

  fastify.patch<{
    Params: { id: string; ruleId: string }
    Body: Partial<{
      name: string
      description: string | null
      severity: AuditSeverity
      category: string
      targetTypes: AuditRuleTarget[]
      matchType: AuditRuleMatchType
      pattern: string
      caseSensitive: boolean
      recommendation: string | null
      enabled: boolean
    }>
  }>('/:id/ops/audit/builtin-rules/:ruleId', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 80 },
          description: { type: ['string', 'null'], maxLength: 500 },
          severity: { type: 'string', enum: ['info', 'low', 'medium', 'high'] },
          category: { type: 'string', maxLength: 64 },
          targetTypes: { type: 'array', items: { type: 'string', enum: ['process', 'network', 'startup'] } },
          matchType: { type: 'string', enum: ['contains', 'regex', 'exact'] },
          pattern: { type: 'string', minLength: 1, maxLength: 500 },
          caseSensitive: { type: 'boolean' },
          recommendation: { type: ['string', 'null'], maxLength: 1000 },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    if (!hostId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const baseRule = findBuiltinAuditRule(request.params.ruleId)
    if (!baseRule) return reply.code(404).send({ error: '系统内置规则不存在' })

    const matchType = request.body.matchType !== undefined ? normalizeAuditMatchType(request.body.matchType) : baseRule.matchType
    const pattern = request.body.pattern !== undefined ? request.body.pattern.trim() : baseRule.patternText
    try {
      validateAuditRegex(matchType, pattern)
    } catch {
      return reply.code(400).send({ error: '正则表达式无效' })
    }

    const data = {
      createdById: user.id,
      name: request.body.name?.trim() || baseRule.name,
      description: request.body.description === undefined ? (baseRule.description || null) : (request.body.description?.trim() || null),
      severity: request.body.severity !== undefined ? normalizeAuditSeverity(request.body.severity) : baseRule.severity,
      category: request.body.category?.trim() || baseRule.category,
      targetTypes: request.body.targetTypes !== undefined ? normalizeAuditTargetTypes(request.body.targetTypes) : baseRule.targetTypes,
      matchType,
      pattern,
      caseSensitive: request.body.caseSensitive !== undefined ? Boolean(request.body.caseSensitive) : baseRule.caseSensitive,
      recommendation: request.body.recommendation === undefined ? (baseRule.recommendation || null) : (request.body.recommendation?.trim() || null),
      enabled: request.body.enabled !== undefined ? Boolean(request.body.enabled) : baseRule.enabled
    }

    const override = await prisma.instanceAuditBuiltinRuleOverride.upsert({
      where: {
        hostId_builtinRuleId: {
          hostId,
          builtinRuleId: baseRule.id
        }
      },
      create: {
        hostId,
        builtinRuleId: baseRule.id,
        ...data
      },
      update: data
    })

    await createLog(user.id, 'host', 'host.ops.audit.builtin_rule.override', `Updated builtin audit rule override "${baseRule.id}" on host "${auth.host.name}"`, 'success')
    return toAuditRuleResponse({
      ...applyBuiltinAuditRuleOverride(baseRule, override),
      original: baseRule,
      override
    }, hostId)
  })

  fastify.delete<{
    Params: { id: string; ruleId: string }
  }>('/:id/ops/audit/builtin-rules/:ruleId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    if (!hostId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const baseRule = findBuiltinAuditRule(request.params.ruleId)
    if (!baseRule) return reply.code(404).send({ error: '系统内置规则不存在' })

    await prisma.instanceAuditBuiltinRuleOverride.deleteMany({
      where: {
        hostId,
        builtinRuleId: baseRule.id
      }
    })
    await createLog(user.id, 'host', 'host.ops.audit.builtin_rule.reset', `Reset builtin audit rule override "${baseRule.id}" on host "${auth.host.name}"`, 'warning')
    return { success: true }
  })

  fastify.post<{
    Params: { id: string }
    Body: {
      scope?: 'host' | 'global'
      name: string
      description?: string
      severity?: AuditSeverity
      category?: string
      targetTypes?: AuditRuleTarget[]
      matchType?: AuditRuleMatchType
      pattern: string
      caseSensitive?: boolean
      recommendation?: string
      enabled?: boolean
    }
  }>('/:id/ops/audit/rules', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'pattern'],
        properties: {
          scope: { type: 'string', enum: ['host', 'global'] },
          name: { type: 'string', minLength: 2, maxLength: 80 },
          description: { type: 'string', maxLength: 500 },
          severity: { type: 'string', enum: ['info', 'low', 'medium', 'high'] },
          category: { type: 'string', maxLength: 64 },
          targetTypes: { type: 'array', items: { type: 'string', enum: ['process', 'network', 'startup'] } },
          matchType: { type: 'string', enum: ['contains', 'regex', 'exact'] },
          pattern: { type: 'string', minLength: 1, maxLength: 500 },
          caseSensitive: { type: 'boolean' },
          recommendation: { type: 'string', maxLength: 1000 },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    if (!hostId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const scope = request.body.scope === 'global' ? 'global' : 'host'
    if (scope === 'global' && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const matchType = normalizeAuditMatchType(request.body.matchType)
    const pattern = request.body.pattern.trim()
    try {
      validateAuditRegex(matchType, pattern)
    } catch {
      return reply.code(400).send({ error: '正则表达式无效' })
    }

    const rule = await prisma.instanceAuditRule.create({
      data: {
        hostId: scope === 'global' ? null : hostId,
        createdById: user.id,
        name: request.body.name.trim(),
        description: request.body.description?.trim() || null,
        severity: normalizeAuditSeverity(request.body.severity),
        category: request.body.category?.trim() || 'custom',
        targetTypes: normalizeAuditTargetTypes(request.body.targetTypes),
        matchType,
        pattern,
        caseSensitive: Boolean(request.body.caseSensitive),
        recommendation: request.body.recommendation?.trim() || null,
        enabled: request.body.enabled ?? true
      }
    })

    await createLog(user.id, 'host', 'host.ops.audit.rule.create', `Created ${scope} audit rule "${rule.name}" on host "${auth.host.name}"`, 'success')
    return toAuditRuleResponse(rule, hostId)
  })

  fastify.patch<{
    Params: { id: string; ruleId: string }
    Body: Partial<{
      name: string
      description: string | null
      severity: AuditSeverity
      category: string
      targetTypes: AuditRuleTarget[]
      matchType: AuditRuleMatchType
      pattern: string
      caseSensitive: boolean
      recommendation: string | null
      enabled: boolean
    }>
  }>('/:id/ops/audit/rules/:ruleId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const ruleId = parsePositiveRouteId(request.params.ruleId)
    if (!hostId || !ruleId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const existing = await prisma.instanceAuditRule.findUnique({ where: { id: ruleId } })
    if (!existing || (existing.hostId !== null && existing.hostId !== hostId)) {
      return reply.code(404).send({ error: '审查规则不存在' })
    }
    if (existing.hostId === null && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const data: any = {}
    if (request.body.name !== undefined) data.name = request.body.name.trim()
    if (request.body.description !== undefined) data.description = request.body.description?.trim() || null
    if (request.body.severity !== undefined) data.severity = normalizeAuditSeverity(request.body.severity)
    if (request.body.category !== undefined) data.category = request.body.category.trim() || 'custom'
    if (request.body.targetTypes !== undefined) data.targetTypes = normalizeAuditTargetTypes(request.body.targetTypes)
    if (request.body.matchType !== undefined) data.matchType = normalizeAuditMatchType(request.body.matchType)
    if (request.body.pattern !== undefined) data.pattern = request.body.pattern.trim()
    if (request.body.caseSensitive !== undefined) data.caseSensitive = Boolean(request.body.caseSensitive)
    if (request.body.recommendation !== undefined) data.recommendation = request.body.recommendation?.trim() || null
    if (request.body.enabled !== undefined) data.enabled = Boolean(request.body.enabled)

    try {
      validateAuditRegex(data.matchType || existing.matchType, data.pattern || existing.pattern)
    } catch {
      return reply.code(400).send({ error: '正则表达式无效' })
    }

    const updated = await prisma.instanceAuditRule.update({ where: { id: ruleId }, data })
    await createLog(user.id, 'host', 'host.ops.audit.rule.update', `Updated audit rule "${updated.name}" on host "${auth.host.name}"`, 'success')
    return toAuditRuleResponse(updated, hostId)
  })

  fastify.delete<{
    Params: { id: string; ruleId: string }
  }>('/:id/ops/audit/rules/:ruleId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const ruleId = parsePositiveRouteId(request.params.ruleId)
    if (!hostId || !ruleId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const existing = await prisma.instanceAuditRule.findUnique({ where: { id: ruleId } })
    if (!existing || (existing.hostId !== null && existing.hostId !== hostId)) {
      return reply.code(404).send({ error: '审查规则不存在' })
    }
    if (existing.hostId === null && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    await prisma.instanceAuditRule.delete({ where: { id: ruleId } })
    await createLog(user.id, 'host', 'host.ops.audit.rule.delete', `Deleted audit rule "${existing.name}" on host "${auth.host.name}"`, 'warning')
    return { success: true }
  })

  fastify.get<{
    Params: { id: string }
    Querystring: { instanceId?: string }
  }>('/:id/ops/audit/ignores', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parseOptionalPositiveQueryInteger(request.query.instanceId)
    if (!hostId || instanceId === null) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const ignores = await prisma.instanceAuditIgnore.findMany({
      where: {
        hostId,
        enabled: true,
        ...(instanceId !== undefined ? { OR: [{ instanceId: null }, { instanceId }] } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    })
    return { ignores }
  })

  fastify.post<{
    Params: { id: string }
    Body: {
      scope?: 'host' | 'instance'
      instanceId?: number
      ruleId?: string
      targetType?: AuditFindingTarget
      matchText?: string
      reason?: string
      expiresInDays?: number
    }
  }>('/:id/ops/audit/ignores', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    if (!hostId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const scope = request.body.scope === 'host' ? 'host' : 'instance'
    const instanceId = scope === 'instance' ? parseIntegerBody(request.body.instanceId) : null
    if (scope === 'instance') {
      if (!instanceId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
      const instance = await db.getInstanceById(instanceId!)
      if (!instance || instance.host_id !== hostId) return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    const ruleId = request.body.ruleId?.trim() || null
    const matchText = request.body.matchText?.trim() || null
    if (!ruleId && !matchText) {
      return reply.code(400).send({ error: '白名单至少需要规则 ID 或匹配文本' })
    }

    const expiresInDays = parseOptionalIntegerBody(request.body.expiresInDays, 1, AUDIT_IGNORE_MAX_EXPIRES_DAYS)
    if (expiresInDays === null) return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))
    const expiresAt = expiresInDays !== undefined
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null

    const ignore = await prisma.instanceAuditIgnore.create({
      data: {
        hostId,
        instanceId: scope === 'instance' ? instanceId : null,
        createdById: user.id,
        ruleId,
        targetType: normalizeAuditFindingTarget(request.body.targetType),
        matchText,
        scope,
        reason: request.body.reason?.trim() || null,
        expiresAt
      }
    })

    await createLog(user.id, 'host', 'host.ops.audit.ignore.create', `Created ${scope} audit whitelist on host "${auth.host.name}"`, 'success')
    return ignore
  })

  fastify.delete<{
    Params: { id: string; ignoreId: string }
  }>('/:id/ops/audit/ignores/:ignoreId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const ignoreId = parsePositiveRouteId(request.params.ignoreId)
    if (!hostId || !ignoreId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const ignore = await prisma.instanceAuditIgnore.findUnique({ where: { id: ignoreId } })
    if (!ignore || ignore.hostId !== hostId) return reply.code(404).send({ error: '白名单不存在' })

    await prisma.instanceAuditIgnore.update({ where: { id: ignoreId }, data: { enabled: false } })
    await createLog(user.id, 'host', 'host.ops.audit.ignore.delete', `Disabled audit whitelist #${ignoreId} on host "${auth.host.name}"`, 'warning')
    return { success: true }
  })

  fastify.get<{
    Params: { id: string }
    Querystring: { instanceId?: string; pageSize?: string }
  }>('/:id/ops/audit/history', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parseOptionalPositiveQueryInteger(request.query.instanceId)
    const pageSize = parseHostAuditHistoryPageSize(request.query.pageSize)
    if (!hostId || instanceId === null || pageSize === null) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))

    const auth = await getAuthorizedOpsHost(hostId, user)
    if (!auth.host) return reply.code(auth.status).send(auth.error)

    const scans = await prisma.instanceAuditScan.findMany({
      where: {
        hostId,
        ...(instanceId !== undefined ? { instanceId } : {})
      },
      include: {
        user: { select: { id: true, username: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize ?? 20
    })
    const actions = await prisma.instanceAuditAction.findMany({
      where: {
        hostId,
        ...(instanceId !== undefined ? { instanceId } : {})
      },
      include: {
        user: { select: { id: true, username: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize ?? 20
    })
    return { scans, actions }
  })

  fastify.post<{
    Params: { id: string; instanceId: string }
  }>('/:id/ops/instances/:instanceId/audit/scan', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parsePositiveRouteId(request.params.instanceId)

    if (!hostId || !instanceId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.host_id !== hostId) {
      return reply.code(400).send({ error: '实例不属于该节点' })
    }

    try {
      const client = await getIncusClient(host as Host)
      const { getInstance, getInstanceState, execWithOutput } = await import('../lib/incus/incus-instances.js')
      const [state, incusInstance] = await Promise.all([
        getInstanceState(client, instance.incus_id),
        getInstance(client, instance.incus_id)
      ]) as [{ status?: string }, { type?: string; status?: string }]

      const incusStatus = state.status || incusInstance.status || ''
      if (incusStatus !== 'Running') {
        return reply.code(400).send({
          error: '实例未运行，无法执行审查扫描',
          status: incusStatus || instance.status
        })
      }

      let processOutput = ''
      let connectionOutput = ''
      let startupOutput = ''
      const stderr: string[] = []

      try {
        const [processResult, connectionResult, startupResult] = await Promise.all([
          execWithOutput(client, instance.incus_id, buildProcessAuditCommand(), {}, 45000),
          execWithOutput(client, instance.incus_id, buildConnectionAuditCommand(), {}, 45000),
          execWithOutput(client, instance.incus_id, buildStartupAuditCommand(), {}, 45000)
        ])
        processOutput = processResult.stdout
        connectionOutput = connectionResult.stdout
        startupOutput = startupResult.stdout
        for (const item of [processResult.stderr, connectionResult.stderr, startupResult.stderr]) {
          if (item.trim()) stderr.push(item.trim().slice(0, 1000))
        }
      } catch (execError) {
        const errorMessage = execError instanceof Error ? execError.message : String(execError)
        await prisma.instanceAuditScan.create({
          data: {
            hostId,
            instanceId: instance.id,
            userId: user.id,
            status: 'failed',
            capability: 'unavailable',
            riskLevel: 'info',
            error: errorMessage.slice(0, 2000)
          }
        })
        await createLog(user.id, 'host', 'host.ops.audit.scan', `Audit scan unavailable for instance "${instance.name}" on host "${host.name}": ${errorMessage}`, 'failed', { instanceId: instance.id })
        return reply.code(503).send({
          success: false,
          capability: 'unavailable',
          error: `无法在实例内执行审查命令: ${errorMessage}`,
          instance: {
            id: instance.id,
            name: instance.name,
            incusId: instance.incus_id,
            type: incusInstance.type || 'unknown',
            status: incusStatus
          }
        })
      }

      const processes = parseProcesses(processOutput)
      const connections = parseConnections(connectionOutput)
      const startupItems = parseStartupItems(startupOutput)
      const [rules, ignores] = await Promise.all([
        getAuditRuleDefinitions(hostId),
        getAuditIgnores(hostId, instance.id)
      ])
      const analysis = analyzeAuditData({
        processes,
        connections,
        startupItems,
        rules,
        ignores: ignores.map(ignore => ({
          ...ignore,
          targetType: normalizeAuditFindingTarget(ignore.targetType)
        }))
      })
      const ignoredCount = analysis.findings.filter(finding => finding.ignored).length
      const scan = await prisma.instanceAuditScan.create({
        data: {
          hostId,
          instanceId: instance.id,
          userId: user.id,
          status: 'success',
          capability: incusInstance.type === 'virtual-machine' ? 'guest-agent' : 'container-exec',
          riskLevel: analysis.summary.riskLevel,
          findingCount: analysis.summary.findingCount,
          ignoredCount,
          processCount: analysis.summary.processCount,
          connectionCount: analysis.summary.connectionCount,
          listeningCount: analysis.summary.listeningCount,
          startupItemCount: analysis.summary.startupItemCount,
          findings: analysis.findings.slice(0, 80) as any
        }
      })

      await createLog(
        user.id,
        'host',
        'host.ops.audit.scan',
        `Ran manual audit scan for instance "${instance.name}" on host "${host.name}" (${analysis.summary.findingCount} finding(s))`,
        'success',
        { instanceId: instance.id }
      )

      return {
        success: true,
        scanId: scan.id,
        scannedAt: new Date().toISOString(),
        capability: incusInstance.type === 'virtual-machine' ? 'guest-agent' : 'container-exec',
        instance: {
          id: instance.id,
          name: instance.name,
          incusId: instance.incus_id,
          type: incusInstance.type || 'unknown',
          status: incusStatus
        },
        summary: analysis.summary,
        ignoredCount,
        rules: rules.map(rule => ({
          id: rule.id,
          source: rule.source,
          name: rule.name,
          category: rule.category,
          severity: rule.severity,
          targetTypes: rule.targetTypes,
          matchType: rule.matchType,
          pattern: rule.patternText,
          caseSensitive: rule.caseSensitive,
          enabled: rule.enabled,
          recommendation: rule.recommendation || null
        })),
        findings: analysis.findings,
        processes: processes
          .sort((a, b) => b.findings.length - a.findings.length || (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0))
          .slice(0, 200),
        connections: connections.slice(0, 200),
        startupItems: startupItems
          .sort((a, b) => b.findings.length - a.findings.length)
          .slice(0, 120),
        stderr
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `审查扫描失败: ${errorMessage}` })
    }
  })

  fastify.post<{
    Params: { id: string; instanceId: string }
    Body: {
      pid: number
      signal?: 'TERM' | 'KILL'
      reason: string
      confirmationText: string
      scanId?: number
      expectedCommand?: string
    }
  }>('/:id/ops/instances/:instanceId/audit/kill-process', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['pid', 'reason', 'confirmationText'],
        properties: {
          pid: { type: 'integer', minimum: 2, maximum: 4194304 },
          signal: { type: 'string', enum: ['TERM', 'KILL'] },
          reason: { type: 'string', minLength: 3, maxLength: 500 },
          confirmationText: { type: 'string' },
          scanId: { type: 'integer' },
          expectedCommand: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parsePositiveRouteId(request.params.instanceId)
    const pid = parseIntegerBody(request.body.pid, AUDIT_KILL_PROCESS_MIN_PID, AUDIT_KILL_PROCESS_MAX_PID)
    const signal = request.body.signal === 'KILL' ? 'KILL' : 'TERM'
    const reason = (request.body.reason || '').trim()
    const confirmationText = (request.body.confirmationText || '').trim()
    const parsedScanId = parseOptionalIntegerBody(request.body.scanId)
    const scanId = parsedScanId ?? null
    const expectedCommand = normalizeProcessText(request.body.expectedCommand || '')

    if (!hostId || !instanceId || !pid || parsedScanId === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.host_id !== hostId) {
      return reply.code(400).send({ error: '实例不属于该节点' })
    }

    if (confirmationText !== instance.incus_id) {
      return reply.code(400).send({ error: '确认文本不匹配实例名称' })
    }

    if (reason.length < 3) {
      return reply.code(400).send({ error: '请填写处置原因' })
    }

    try {
      const client = await getIncusClient(host as Host)
      const { getInstanceState, execWithOutput } = await import('../lib/incus/incus-instances.js')
      const state = await getInstanceState(client, instance.incus_id) as { status?: string }
      if (state.status !== 'Running') {
        return reply.code(400).send({ error: '实例未运行，无法停止进程', status: state.status || instance.status })
      }

      const processCheck = await execWithOutput(client, instance.incus_id, `ps -p ${pid} -o pid=,comm=,args= 2>/dev/null || true`, {}, 30000)
      const currentProcessText = normalizeProcessText(processCheck.stdout)
      if (!currentProcessText) {
        return reply.code(409).send({ error: '该 PID 当前不存在，请重新扫描后再操作' })
      }
      if (expectedCommand && !currentProcessText.toLowerCase().includes(expectedCommand.toLowerCase())) {
        return reply.code(409).send({
          error: 'PID 当前进程与扫描时不一致，请重新扫描确认后再操作',
          currentProcess: currentProcessText
        })
      }

      const result = await execWithOutput(client, instance.incus_id, `kill -${signal} -- ${pid}`, {}, 30000)
      await prisma.instanceAuditAction.create({
        data: {
          scanId,
          hostId,
          instanceId: instance.id,
          userId: user.id,
          actionType: 'kill_process',
          pid,
          signal,
          processCommand: currentProcessText.slice(0, 2000),
          reason,
          result: 'success',
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 2000)
        }
      })
      await createLog(
        user.id,
        'host',
        'host.ops.audit.kill_process',
        `Sent SIG${signal} to PID ${pid} in instance "${instance.name}" on host "${host.name}". Reason: ${reason}`,
        'warning',
        { instanceId: instance.id }
      )

      return {
        success: true,
        message: `已向 PID ${pid} 发送 SIG${signal}`,
        pid,
        signal,
        stdout: result.stdout,
        stderr: result.stderr
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      await prisma.instanceAuditAction.create({
        data: {
          scanId,
          hostId,
          instanceId: instance.id,
          userId: user.id,
          actionType: 'kill_process',
          pid,
          signal,
          reason,
          result: 'failed',
          stderr: errorMessage.slice(0, 2000)
        }
      }).catch(() => undefined)
      await createLog(
        user.id,
        'host',
        'host.ops.audit.kill_process',
        `Failed to send SIG${signal} to PID ${pid} in instance "${instance.name}" on host "${host.name}": ${errorMessage}`,
        'failed',
        { instanceId: instance.id }
      )
      return reply.code(500).send({ error: `停止进程失败: ${errorMessage}` })
    }
  })

  fastify.post<{
    Params: { id: string; instanceId: string }
  }>('/:id/ops/instances/:instanceId/sync', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parsePositiveRouteId(request.params.instanceId)

    if (!hostId || !instanceId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.host_id !== hostId) {
      return reply.code(400).send({ error: '实例不属于该节点' })
    }

    try {
      const client = await getIncusClient(host as Host)
      const { getInstance, getInstanceState } = await import('../lib/incus/incus-instances.js')
      const { mapInstanceStatus } = await import('../lib/incus/incus-utils.js')

      const [state, incusInstance] = await Promise.all([
        getInstanceState(client, instance.incus_id),
        getInstance(client, instance.incus_id)
      ]) as [{
        status?: string
        network?: Record<string, { addresses?: Array<{ family: string; address: string; scope?: string }> }>
      }, {
        devices?: Record<string, Record<string, unknown>>
        expanded_devices?: Record<string, Record<string, unknown>>
      }]

      if (!state.status) {
        return reply.code(500).send({ error: '无法获取实例状态' })
      }

      const incusStatus = mapInstanceStatus(state.status)
      if (incusStatus === 'unknown') {
        return reply.code(500).send({ error: `未知状态: ${state.status}` })
      }

      const currentStatus = instance.status
      let statusChanged = false
      let from: string | undefined
      let to: string | undefined

      if (currentStatus !== incusStatus) {
        await db.updateInstanceStatus(instanceId, incusStatus as 'creating' | 'running' | 'stopped' | 'error')
        statusChanged = true
        from = currentStatus
        to = incusStatus
      }

      const persistedNetwork = await persistResolvedInstanceNetworkAddresses(
        {
          id: instanceId,
          name: instance.name,
          hostId: instance.host_id,
          networkMode: instance.network_mode,
          ipv4: instance.ipv4,
          ipv6: instance.ipv6
        },
        resolveInstanceNetworkAddresses(
          {
            id: instanceId,
            name: instance.name,
            hostId: instance.host_id,
            networkMode: instance.network_mode,
            ipv4: instance.ipv4,
            ipv6: instance.ipv6
          },
          incusInstance,
          state
        ),
        { updateLastSyncedAt: true }
      )

      return {
        success: true,
        message: '实例状态/IP 已同步',
        statusChanged,
        from,
        to,
        currentStatus: incusStatus,
        ipv4Changed: persistedNetwork.ipv4Changed,
        oldIpv4: persistedNetwork.ipv4Changed ? persistedNetwork.oldIpv4 : undefined,
        newIpv4: persistedNetwork.ipv4Changed ? persistedNetwork.newIpv4 : undefined,
        ipv6Changed: persistedNetwork.ipv6Changed,
        oldIpv6: persistedNetwork.ipv6Changed ? persistedNetwork.oldIpv6 : undefined,
        newIpv6: persistedNetwork.ipv6Changed ? persistedNetwork.newIpv6 : undefined
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      if (errorMessage.includes('not found') || errorMessage.includes('Instance not found')) {
        return reply.code(404).send({ error: '实例在节点上不存在' })
      }
      return reply.code(500).send({ error: `同步失败: ${errorMessage}` })
    }
  })

  fastify.post<{
    Params: { id: string; instanceId: string }
    Body: { force?: boolean }
  }>('/:id/ops/instances/:instanceId/restart', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          force: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parsePositiveRouteId(request.params.instanceId)
    const force = !!request.body?.force

    if (!hostId || !instanceId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.host_id !== hostId) {
      return reply.code(400).send({ error: '实例不属于该节点' })
    }

    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (await rejectActiveHostInstanceWorkflowConflict(reply, instanceId)) return

    try {
      const client = await getIncusClient(host as Host)
      const { restartInstance } = await import('../lib/incus/incus-instances.js')
      await restartInstance(client, instance.incus_id, force)
      return {
        success: true,
        message: force ? '实例已强制重启' : '实例已安全重启'
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `重启失败: ${errorMessage}` })
    }
  })

  fastify.post<{
    Params: { id: string; instanceId: string }
    Body: {
      action: 'rebuild' | 'recreate'
      imageAlias: string
      sshKeyId?: number
      customInitCommandIds?: number[]
      confirmationText: string
      riskConfirmed: boolean
    }
  }>('/:id/ops/instances/:instanceId/dangerous-action', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['action', 'imageAlias', 'confirmationText', 'riskConfirmed'],
        properties: {
          action: { type: 'string', enum: ['rebuild', 'recreate'] },
          imageAlias: { type: 'string' },
          sshKeyId: { type: 'integer' },
          customInitCommandIds: { type: 'array', items: { type: 'integer' }, maxItems: 20 },
          confirmationText: { type: 'string' },
          riskConfirmed: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { user } = request
    const hostId = parsePositiveRouteId(request.params.id)
    const instanceId = parsePositiveRouteId(request.params.instanceId)
    const { action, imageAlias, sshKeyId, customInitCommandIds, confirmationText, riskConfirmed } = request.body

    if (!hostId || !instanceId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const host = await db.getHostById(hostId)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    if (host.user_id !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    if (instance.host_id !== hostId) {
      return reply.code(400).send({ error: '实例不属于该节点' })
    }

    if (!riskConfirmed) {
      return reply.code(400).send({ error: '请先确认风险提示' })
    }

    if ((confirmationText || '').trim() !== instance.incus_id) {
      return reply.code(400).send({ error: '确认文本不匹配实例名称' })
    }

    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (action === 'rebuild' && instance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STOP_REQUIRED))
    }

    if (await rejectActiveHostInstanceWorkflowConflict(reply, instanceId)) return

    if (!await isValidSystemImage(imageAlias)) {
      return reply.code(400).send(apiError(ErrorCode.IMAGE_NOT_FOUND))
    }

    if (!await isImageCompatibleWithMemory(imageAlias, instance.memory)) {
      return reply.code(400).send(apiError(ErrorCode.IMAGE_MEMORY_INCOMPATIBLE))
    }

    const packageRecord = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const instanceType = (packageRecord as { instance_type?: 'container' | 'vm' } | null)?.instance_type || 'container'
    const imageAvailability = await getSystemImageAvailabilityForHost(imageAlias, instance.host_id, {
      instanceType,
      memory: instance.memory
    })
    if (!imageAvailability.ok) {
      switch (imageAvailability.reason) {
        case 'host_not_found':
          return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
        case 'image_not_found':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_NOT_FOUND))
        case 'memory_incompatible':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_MEMORY_INCOMPATIBLE))
        case 'instance_type_mismatch':
          return reply.code(400).send(apiError(ErrorCode.IMAGE_TYPE_MISMATCH))
        case 'host_instance_type_mismatch':
          return reply.code(400).send(apiError(ErrorCode.HOST_INSTANCE_TYPE_MISMATCH))
        default:
          return reply.code(400).send(apiError(ErrorCode.INSTANCE_IMAGE_UNAVAILABLE))
      }
    }

    if (sshKeyId) {
      const keyRecord = await getSSHKeyById(sshKeyId)
      if (!keyRecord || keyRecord.user_id !== instance.user_id) {
        return reply.code(400).send(apiError(ErrorCode.SSH_KEY_NOT_OWNED))
      }
    }

    if (customInitCommandIds && customInitCommandIds.length > 0) {
      const cmdValidation = await validateCommandsOwnership(customInitCommandIds, instance.user_id)
      if (!cmdValidation.valid) {
        return reply.code(400).send({ error: 'Invalid custom init command IDs', code: 'INVALID_COMMAND_IDS' })
      }
    }

    const task = await createHostInstanceTaskOrConflict(reply, {
      instanceId,
      hostId: instance.host_id,
      userId: user.id,
      taskType: action,
      imageAlias,
      sshKeyId,
      customInitCommandIds
    })
    if (!task) return

    await createLog(user.id, 'host', `host.ops.${action}`, `Queued ${action} task for instance "${instance.name}" on host "${host.name}" with image ${imageAlias}`, 'success', { instanceId })

    return reply.code(202).send({
      success: true,
      message: action === 'rebuild' ? '实例重装任务已排队' : '实例重建任务已排队',
      taskId: task.id,
      status: task.status
    })
  })
}
