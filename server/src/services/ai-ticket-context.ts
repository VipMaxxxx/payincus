import { prisma } from '../db/prisma.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { decryptSensitiveData } from '../lib/security.js'

export const AI_TICKET_AGENT_PLUGIN_ID = 'com.payincus.ai-ticket-agent'
export const AI_TICKET_CONTEXT_PERMISSION = 'ticket:ai:read-context'
export const AI_TICKET_DRAFT_PERMISSION = 'ticket:ai:generate-draft'
export const AI_TICKET_REPLY_PERMISSION = 'ticket:ai:reply'

const MAX_TICKET_MESSAGES = 8
const MAX_RECENT_PAYMENTS = 5
const MAX_USER_INSTANCES = 8
const MAX_PUBLIC_PACKAGES = 12
const MAX_KNOWLEDGE_ITEMS = 6
const MAX_KNOWLEDGE_EXCERPT_LENGTH = 700
const DEFAULT_AI_MODEL = 'gpt-4o-mini'
const DEFAULT_AI_TIMEOUT_MS = 20_000
const MAX_AI_DRAFT_LENGTH = 2000
const DEFAULT_AI_AUTO_REPLY_CATEGORIES = ['general', 'billing']
const DEFAULT_DAILY_AUTO_REPLY_LIMIT = 100
const DEFAULT_TICKET_AUTO_REPLY_LIMIT = 3
const DEFAULT_REPLY_COOLDOWN_SECONDS = 120
const DEFAULT_CONFIDENCE_THRESHOLD = 0.82

type AiTicketPermission =
  | typeof AI_TICKET_CONTEXT_PERMISSION
  | typeof AI_TICKET_DRAFT_PERMISSION
  | typeof AI_TICKET_REPLY_PERMISSION

export interface AiTicketContextPermissionResult {
  allowed: boolean
  code?: string
  message?: string
}

export interface AiTicketDraftResult {
  draft: string
  model: string
  safety: {
    passed: boolean
    blockedReasons: string[]
  }
}

export interface AiTicketReplyCandidate extends AiTicketDraftResult {
  mode: AiTicketAgentConfig['mode']
  confidence: number
  confidenceThreshold: number
  canSend: boolean
  sendBlockedReasons: string[]
}

export interface AiTicketAutomationStatus {
  enabled: boolean
  mode: AiTicketAgentConfig['mode']
  modelConfigured: boolean
  autoReplyCategories: string[]
  confidenceThreshold: number
  dailyAutoReplyLimit: number
  ticketAutoReplyLimit: number
  cooldownSeconds: number
  showAiIdentity: boolean
}

interface AiTicketAgentConfig {
  enabled: boolean
  mode: 'draft' | 'semi_auto' | 'auto'
  apiBaseUrl: string
  apiKey: string
  model: string
  temperature: number
  timeoutMs: number
  autoReplyCategories: string[]
  confidenceThreshold: number
  dailyAutoReplyLimit: number
  ticketAutoReplyLimit: number
  cooldownSeconds: number
  showAiIdentity: boolean
  systemPrompt: string | null
}

export interface AiTicketContext {
  policy: {
    dataScope: 'ticket_user_only'
    redaction: 'ai_safe_summary'
    forbiddenData: string[]
  }
  ticket: {
    id: number
    subject: string
    category: string
    priority: string
    status: string
    createdAt: string
    updatedAt: string
    linkedInstanceId: number | null
    recentMessages: Array<{
      role: 'customer' | 'support'
      content: string
      createdAt: string
    }>
  }
  user: {
    username: string
    accountStatus: string
    registeredAt: string
    balance: string
    counts: {
      instances: number
      rechargeRecords: number
      ticketsCreated: number
    }
  } | null
  payments: Array<{
    id: number
    orderRef: string
    amount: string
    actualAmount: string | null
    status: string
    paymentMethod: string | null
    providerName: string
    createdAt: string
    completedAt: string | null
  }>
  instances: Array<{
    id: number
    name: string
    status: string
    packageName: string | null
    planName: string | null
    cpu: number
    memory: number
    disk: number
    publicIpv4: string | null
    publicIpv6: string | null
    expiresAt: string | null
    monthlyTrafficUsed: string
    monthlyTrafficLimit: string | null
    trafficStatus: string
    portCount: number
    latestTask: {
      taskType: string
      status: string
      progress: string | null
      createdAt: string
      finishedAt: string | null
    } | null
    createdAt: string
  }>
  publicPackages: Array<{
    id: number
    name: string
    description: string | null
    networkMode: string
    instanceType: string
    isActive: boolean
    plans: Array<{
      id: number
      name: string
      description: string | null
      cpu: number
      memory: number
      disk: number
      price: string
      billingCycle: number
      setupFee: string
      isSoldOut: boolean
    }>
  }>
  knowledge: Array<{
    title: string
    slug: string
    category: string
    excerpt: string
    updatedAt: string
  }>
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    return value.toString()
  }
  return String(value)
}

function nullableValueToString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return valueToString(value)
}

function maskIdentifier(value: string | null | undefined, visible = 6): string {
  const normalized = value?.trim()
  if (!normalized) return ''
  if (normalized.length <= visible) return normalized
  return `***${normalized.slice(-visible)}`
}

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function stripMarkdown(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_\-~|]/g, ' ')
}

function tokenize(input: string): string[] {
  return Array.from(new Set(
    input
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2)
  ))
}

function scoreKnowledge(questionTokens: string[], article: { title: string; category: string; content: string }): number {
  if (questionTokens.length === 0) return 0
  const title = article.title.toLowerCase()
  const category = article.category.toLowerCase()
  const content = stripMarkdown(article.content).toLowerCase()
  let score = 0

  for (const token of questionTokens) {
    if (title.includes(token)) score += 6
    if (category.includes(token)) score += 3
    if (content.includes(token)) score += 1
  }

  return score
}

function parseJsonConfigValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseSecretConfigValue(value: string | null): unknown {
  if (!value) return null
  const decrypted = decryptSensitiveData(value)
  return parseJsonConfigValue(decrypted)
}

function getConfigString(configs: Map<string, unknown>, key: string, fallback = ''): string {
  const value = configs.get(key)
  return typeof value === 'string' ? value.trim() : fallback
}

function getConfigBoolean(configs: Map<string, unknown>, key: string, fallback: boolean): boolean {
  const value = configs.get(key)
  return typeof value === 'boolean' ? value : fallback
}

function getConfigNumber(configs: Map<string, unknown>, key: string, fallback: number): number {
  const value = configs.get(key)
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getConfigStringArray(configs: Map<string, unknown>, key: string, fallback: string[]): string[] {
  const value = configs.get(key)
  if (!Array.isArray(value)) return fallback

  const normalized = value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)

  return normalized.length > 0 ? normalized : fallback
}

function normalizeAiMode(value: string): AiTicketAgentConfig['mode'] {
  return value === 'semi_auto' || value === 'auto' ? value : 'draft'
}

function resolveChatCompletionsUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

async function loadAiTicketAgentConfig(): Promise<AiTicketAgentConfig> {
  const rows = await prisma.pluginConfig.findMany({
    where: { pluginId: AI_TICKET_AGENT_PLUGIN_ID },
    select: {
      key: true,
      valueJson: true,
      valueEncrypted: true,
      isSecret: true
    }
  })
  const configs = new Map<string, unknown>()

  for (const row of rows) {
    configs.set(row.key, row.isSecret ? parseSecretConfigValue(row.valueEncrypted) : row.valueJson)
  }

  return {
    enabled: getConfigBoolean(configs, 'enabled', false),
    mode: normalizeAiMode(getConfigString(configs, 'mode', 'draft')),
    apiBaseUrl: getConfigString(configs, 'apiBaseUrl'),
    apiKey: getConfigString(configs, 'apiKey'),
    model: getConfigString(configs, 'model', DEFAULT_AI_MODEL),
    temperature: Math.min(Math.max(getConfigNumber(configs, 'temperature', 0.2), 0), 1),
    timeoutMs: Math.min(Math.max(getConfigNumber(configs, 'timeoutMs', DEFAULT_AI_TIMEOUT_MS), 1000), 120_000),
    autoReplyCategories: getConfigStringArray(configs, 'autoReplyCategories', DEFAULT_AI_AUTO_REPLY_CATEGORIES),
    confidenceThreshold: Math.min(Math.max(getConfigNumber(configs, 'confidenceThreshold', DEFAULT_CONFIDENCE_THRESHOLD), 0), 1),
    dailyAutoReplyLimit: Math.max(Math.floor(getConfigNumber(configs, 'dailyAutoReplyLimit', DEFAULT_DAILY_AUTO_REPLY_LIMIT)), 0),
    ticketAutoReplyLimit: Math.max(Math.floor(getConfigNumber(configs, 'ticketAutoReplyLimit', DEFAULT_TICKET_AUTO_REPLY_LIMIT)), 0),
    cooldownSeconds: Math.max(Math.floor(getConfigNumber(configs, 'cooldownSeconds', DEFAULT_REPLY_COOLDOWN_SECONDS)), 0),
    showAiIdentity: getConfigBoolean(configs, 'showAiIdentity', true),
    systemPrompt: getConfigString(configs, 'systemPrompt') || null
  }
}

function buildAiTicketSystemPrompt(config: AiTicketAgentConfig): string {
  return config.systemPrompt || [
    '你是 PayIncus AI 工单客服，只能基于提供的安全上下文回答。',
    '不要编造付款、余额、实例、套餐、库存、优惠或恢复结果。',
    '不要泄露后台内部信息、管理员备注、密钥、服务器路径、风控规则或其他用户信息。',
    '涉及退款、争议、账号安全、风控、数据恢复、资源交付异常、删除或重装实例时，必须建议转人工核对。',
    '如果信息不足，明确说明需要人工核对。',
    '回复要简洁、中文优先、可执行。'
  ].join('\n')
}

function buildAiTicketUserPrompt(context: AiTicketContext, config: AiTicketAgentConfig): string {
  return JSON.stringify({
    task: '根据安全上下文生成一条工单回复草稿，只输出给用户看的回复正文。',
    replyPolicy: {
      mode: config.mode,
      showAiIdentity: config.showAiIdentity,
      noBackendDetails: true,
      noUnsafePromises: true
    },
    context
  })
}

function buildAiTicketDecisionPrompt(context: AiTicketContext, config: AiTicketAgentConfig): string {
  return JSON.stringify({
    task: '根据安全上下文生成工单回复决策。只输出 JSON 对象，不要输出 Markdown。',
    outputSchema: {
      reply: 'string，给用户看的回复正文',
      confidence: 'number，0 到 1，表示基于安全上下文直接回复的把握',
      handoffRequired: 'boolean，是否需要人工接管',
      handoffReason: 'string|null，转人工原因'
    },
    replyPolicy: {
      mode: config.mode,
      showAiIdentity: config.showAiIdentity,
      confidenceThreshold: config.confidenceThreshold,
      noBackendDetails: true,
      noUnsafePromises: true,
      handoffWhenInsufficientContext: true,
      handoffWhenSensitive: true
    },
    context
  })
}

function parseAiDecisionJson(content: string): { reply: string; confidence: number; handoffRequired: boolean; handoffReason: string | null } | null {
  const trimmed = content.trim()
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0]
  if (!jsonText) return null

  try {
    const parsed = JSON.parse(jsonText) as {
      reply?: unknown
      confidence?: unknown
      handoffRequired?: unknown
      handoffReason?: unknown
    }
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : ''
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.min(Math.max(parsed.confidence, 0), 1)
      : NaN
    const handoffRequired = typeof parsed.handoffRequired === 'boolean' ? parsed.handoffRequired : true
    const handoffReason = typeof parsed.handoffReason === 'string' && parsed.handoffReason.trim()
      ? parsed.handoffReason.trim().slice(0, 160)
      : null

    if (!reply || Number.isNaN(confidence)) return null
    return { reply, confidence, handoffRequired, handoffReason }
  } catch {
    return null
  }
}

function inspectAiDraftSafety(draft: string): { passed: boolean; blockedReasons: string[] } {
  const blockedReasons: string[] = []
  const checks: Array<[string, RegExp]> = [
    ['contains_api_key_like_text', /\b(sk-[A-Za-z0-9_-]{16,}|api[_-]?key|secret|token)\b/i],
    ['contains_database_url', /\b(postgresql|mysql|redis):\/\//i],
    ['contains_server_path', /\/(?:opt|var|etc|root|home)\/[A-Za-z0-9._/-]+/],
    ['claims_refund_completed', /(?:已|已经|为您)(?:完成|处理)?退款/],
    ['claims_instance_operation_completed', /(?:已|已经|为您)(?:删除|销毁|重装|迁移|恢复)(?:机器|实例|数据)?/],
    ['mentions_internal_note', /内部备注|管理员备注|后台备注/],
    ['mentions_risk_rule_detail', /风控规则|绕过限制|后台配置/]
  ]

  for (const [reason, pattern] of checks) {
    if (pattern.test(draft)) {
      blockedReasons.push(reason)
    }
  }

  return {
    passed: blockedReasons.length === 0,
    blockedReasons
  }
}

function inspectAiReplySendEligibility(context: AiTicketContext, config: AiTicketAgentConfig): string[] {
  const blockedReasons: string[] = []
  const searchableText = [
    context.ticket.subject,
    context.ticket.category,
    context.ticket.priority,
    ...context.ticket.recentMessages.map(message => message.content)
  ].join(' ')

  const sensitivePatterns: Array<[string, RegExp]> = [
    ['refund_or_dispute_requires_handoff', /退款|退费|争议|拒付|chargeback|dispute|refund/i],
    ['risk_or_account_security_requires_handoff', /风控|封禁|解封|冻结|盗号|账号安全|risk|abuse|ban/i],
    ['destructive_instance_operation_requires_handoff', /删除|销毁|重装|迁移|恢复数据|数据恢复|数据丢失|delete|destroy|reinstall|migrate|recovery/i],
    ['credential_or_backend_request_requires_handoff', /root|密码|ssh|密钥|后台|数据库|路径|password|secret|token/i],
    ['resource_delivery_exception_requires_handoff', /开通失败|交付失败|机器异常|实例异常|无法连接|故障|宕机|delivery failed|outage/i]
  ]

  if (context.ticket.category === 'abuse') {
    blockedReasons.push('abuse_category_requires_handoff')
  }
  if (context.ticket.priority === 'urgent') {
    blockedReasons.push('urgent_priority_requires_handoff')
  }
  if (config.mode === 'auto' && !config.autoReplyCategories.includes(context.ticket.category)) {
    blockedReasons.push('category_not_allowed_for_auto_reply')
  }

  for (const [reason, pattern] of sensitivePatterns) {
    if (pattern.test(searchableText)) {
      blockedReasons.push(reason)
    }
  }

  return Array.from(new Set(blockedReasons))
}

async function inspectAiReplySendLimits(ticketId: number, config: AiTicketAgentConfig): Promise<string[]> {
  const blockedReasons: string[] = []
  const ticketMarker = `ticket #${ticketId}`
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [dailySuccessCount, ticketSuccessCount, latestTicketSuccess] = await Promise.all([
    prisma.log.count({
      where: {
        module: LogModule.PLUGIN,
        action: 'ai_ticket.reply_send',
        result: LogResult.SUCCESS,
        createdAt: { gte: todayStart }
      }
    }),
    prisma.log.count({
      where: {
        module: LogModule.PLUGIN,
        action: 'ai_ticket.reply_send',
        result: LogResult.SUCCESS,
        content: { contains: ticketMarker }
      }
    }),
    prisma.log.findFirst({
      where: {
        module: LogModule.PLUGIN,
        action: 'ai_ticket.reply_send',
        result: LogResult.SUCCESS,
        content: { contains: ticketMarker }
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    })
  ])

  if (config.dailyAutoReplyLimit > 0 && dailySuccessCount >= config.dailyAutoReplyLimit) {
    blockedReasons.push('daily_auto_reply_limit_reached')
  }
  if (config.ticketAutoReplyLimit > 0 && ticketSuccessCount >= config.ticketAutoReplyLimit) {
    blockedReasons.push('ticket_auto_reply_limit_reached')
  }
  if (
    config.cooldownSeconds > 0 &&
    latestTicketSuccess &&
    latestTicketSuccess.createdAt.getTime() > Date.now() - (config.cooldownSeconds * 1000)
  ) {
    blockedReasons.push('ticket_auto_reply_cooldown_active')
  }

  return blockedReasons
}

async function requestAiTicketDraft(context: AiTicketContext, config: AiTicketAgentConfig): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    let response: Response
    try {
      response = await fetch(resolveChatCompletionsUrl(config.apiBaseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          temperature: config.temperature,
          messages: [
            { role: 'system', content: buildAiTicketSystemPrompt(config) },
            { role: 'user', content: buildAiTicketUserPrompt(context, config) }
          ]
        }),
        signal: controller.signal
      })
    } catch {
      throw new Error('AI_TICKET_MODEL_REQUEST_FAILED')
    }

    if (!response.ok) {
      throw new Error('AI_TICKET_MODEL_REQUEST_FAILED')
    }

    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const draft = body.choices?.[0]?.message?.content?.trim()
    if (!draft) {
      throw new Error('AI_TICKET_MODEL_EMPTY_RESPONSE')
    }

    return draft.slice(0, MAX_AI_DRAFT_LENGTH)
  } finally {
    clearTimeout(timeout)
  }
}

async function requestAiTicketDecision(
  context: AiTicketContext,
  config: AiTicketAgentConfig
): Promise<{ draft: string; confidence: number; handoffRequired: boolean; handoffReason: string | null }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    let response: Response
    try {
      response = await fetch(resolveChatCompletionsUrl(config.apiBaseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          temperature: Math.min(config.temperature, 0.2),
          messages: [
            { role: 'system', content: buildAiTicketSystemPrompt(config) },
            { role: 'user', content: buildAiTicketDecisionPrompt(context, config) }
          ]
        }),
        signal: controller.signal
      })
    } catch {
      throw new Error('AI_TICKET_MODEL_REQUEST_FAILED')
    }

    if (!response.ok) {
      throw new Error('AI_TICKET_MODEL_REQUEST_FAILED')
    }

    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = body.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new Error('AI_TICKET_MODEL_EMPTY_RESPONSE')
    }

    const decision = parseAiDecisionJson(content)
    if (!decision) {
      throw new Error('AI_TICKET_MODEL_DECISION_INVALID')
    }

    return {
      draft: decision.reply.slice(0, MAX_AI_DRAFT_LENGTH),
      confidence: decision.confidence,
      handoffRequired: decision.handoffRequired,
      handoffReason: decision.handoffReason
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function loadAiVisibleInstances(userId: number, linkedInstanceId: number | null) {
  const select = {
    id: true,
    name: true,
    status: true,
    cpu: true,
    memory: true,
    disk: true,
    ipv4: true,
    ipv6: true,
    expiresAt: true,
    monthlyTrafficUsed: true,
    monthlyTrafficLimit: true,
    trafficStatus: true,
    createdAt: true,
    package: { select: { name: true } },
    packagePlan: { select: { name: true } },
    _count: { select: { portMappings: true } },
    instanceTasks: {
      orderBy: { createdAt: 'desc' as const },
      take: 1,
      select: {
        taskType: true,
        status: true,
        progress: true,
        createdAt: true,
        finishedAt: true
      }
    }
  }

  const linkedInstance = linkedInstanceId
    ? await prisma.instance.findFirst({
        where: {
          id: linkedInstanceId,
          userId,
          status: { not: 'deleted' }
        },
        select
      })
    : null

  const recentInstances = await prisma.instance.findMany({
    where: {
      userId,
      status: { not: 'deleted' },
      ...(linkedInstanceId ? { id: { not: linkedInstanceId } } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: linkedInstance ? MAX_USER_INSTANCES - 1 : MAX_USER_INSTANCES,
    select
  })

  return linkedInstance ? [linkedInstance, ...recentInstances] : recentInstances
}

export async function getAiTicketPermission(permission: AiTicketPermission): Promise<AiTicketContextPermissionResult> {
  const plugin = await prisma.plugin.findUnique({
    where: { pluginId: AI_TICKET_AGENT_PLUGIN_ID },
    select: {
      enabled: true,
      status: true,
      versions: {
        orderBy: { installedAt: 'desc' },
        take: 1,
        select: { manifest: true }
      }
    }
  })

  if (!plugin || !plugin.enabled || plugin.status !== 'enabled') {
    return {
      allowed: false,
      code: 'AI_TICKET_PLUGIN_DISABLED',
      message: 'AI ticket agent plugin is not enabled'
    }
  }

  const manifest = plugin.versions[0]?.manifest as { permissions?: unknown } | undefined
  const permissions = Array.isArray(manifest?.permissions) ? manifest.permissions : []
  if (!permissions.includes(permission)) {
    return {
      allowed: false,
      code: 'AI_TICKET_PLUGIN_PERMISSION_MISSING',
      message: `AI ticket agent plugin is missing ${permission} permission`
    }
  }

  return { allowed: true }
}

export async function getAiTicketContextPermission(): Promise<AiTicketContextPermissionResult> {
  return getAiTicketPermission(AI_TICKET_CONTEXT_PERMISSION)
}

export async function getAiTicketAutomationStatus(): Promise<AiTicketAutomationStatus> {
  const config = await loadAiTicketAgentConfig()
  return {
    enabled: config.enabled,
    mode: config.mode,
    modelConfigured: Boolean(config.apiBaseUrl && config.apiKey),
    autoReplyCategories: config.autoReplyCategories,
    confidenceThreshold: config.confidenceThreshold,
    dailyAutoReplyLimit: config.dailyAutoReplyLimit,
    ticketAutoReplyLimit: config.ticketAutoReplyLimit,
    cooldownSeconds: config.cooldownSeconds,
    showAiIdentity: config.showAiIdentity
  }
}

export async function auditAiTicketContextRead(input: {
  actorUserId: number
  ticketId: number
  result: 'success' | 'denied' | 'not_found'
  reason?: string
}): Promise<void> {
  const detail = input.reason ? ` (${input.reason})` : ''
  await createLog(
    input.actorUserId,
    LogModule.PLUGIN,
    'ai_ticket.context_read',
    `AI ticket context ${input.result} for ticket #${input.ticketId}${detail}`,
    input.result === 'success' ? LogResult.SUCCESS : LogResult.WARNING
  )
}

export async function auditAiTicketDraft(input: {
  actorUserId: number
  ticketId: number
  result: 'success' | 'denied' | 'failed' | 'blocked'
  reason?: string
}): Promise<void> {
  const detail = input.reason ? ` (${input.reason})` : ''
  await createLog(
    input.actorUserId,
    LogModule.PLUGIN,
    'ai_ticket.draft_generate',
    `AI ticket draft ${input.result} for ticket #${input.ticketId}${detail}`,
    input.result === 'success' ? LogResult.SUCCESS : LogResult.WARNING
  )
}

export async function auditAiTicketReply(input: {
  actorUserId: number
  ticketId: number
  result: 'success' | 'denied' | 'failed' | 'blocked'
  reason?: string
}): Promise<void> {
  const detail = input.reason ? ` (${input.reason})` : ''
  await createLog(
    input.actorUserId,
    LogModule.PLUGIN,
    'ai_ticket.reply_send',
    `AI ticket reply ${input.result} for ticket #${input.ticketId}${detail}`,
    input.result === 'success' ? LogResult.SUCCESS : LogResult.WARNING
  )
}

export async function buildAiTicketContext(ticketId: number): Promise<AiTicketContext | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      userId: true,
      instanceId: true,
      subject: true,
      category: true,
      priority: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: MAX_TICKET_MESSAGES,
        select: {
          content: true,
          isFromOwner: true,
          createdAt: true
        }
      }
    }
  })

  if (!ticket) return null

  const knowledgeQuestion = [
    ticket.subject,
    ...ticket.messages.map(message => message.content)
  ].join(' ')

  const [user, payments, instances, publicPackages, helpArticles] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ticket.userId },
      select: {
        username: true,
        status: true,
        balance: true,
        createdAt: true,
        _count: {
          select: {
            instances: true,
            rechargeRecords: true,
            ticketsCreated: true
          }
        }
      }
    }),
    prisma.rechargeRecord.findMany({
      where: { userId: ticket.userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECENT_PAYMENTS,
      select: {
        id: true,
        orderNo: true,
        amount: true,
        actualAmount: true,
        status: true,
        paymentMethod: true,
        createdAt: true,
        completedAt: true,
        provider: {
          select: {
            name: true
          }
        }
      }
    }),
    loadAiVisibleInstances(ticket.userId, ticket.instanceId),
    prisma.package.findMany({
      where: {
        active: true,
        globalShared: true
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_PUBLIC_PACKAGES,
      select: {
        id: true,
        name: true,
        description: true,
        networkMode: true,
        instanceType: true,
        active: true,
        plans: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
          take: 6,
          select: {
            id: true,
            name: true,
            description: true,
            cpu: true,
            memory: true,
            disk: true,
            price: true,
            billingCycle: true,
            setupFee: true,
            isSoldOut: true
          }
        }
      }
    }),
    prisma.helpArticle.findMany({
      where: { published: true },
      orderBy: [
        { pinned: 'desc' },
        { sortOrder: 'asc' },
        { updatedAt: 'desc' }
      ],
      take: 40,
      select: {
        title: true,
        slug: true,
        category: true,
        content: true,
        updatedAt: true
      }
    })
  ])

  const questionTokens = tokenize(knowledgeQuestion)
  const knowledge = helpArticles
    .map(article => ({ article, score: scoreKnowledge(questionTokens, article) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_KNOWLEDGE_ITEMS)
    .map(({ article }) => ({
      title: article.title,
      slug: article.slug,
      category: article.category,
      excerpt: cleanText(stripMarkdown(article.content), MAX_KNOWLEDGE_EXCERPT_LENGTH),
      updatedAt: article.updatedAt.toISOString()
    }))

  return {
    policy: {
      dataScope: 'ticket_user_only',
      redaction: 'ai_safe_summary',
      forbiddenData: [
        'admin_internal_notes',
        'payment_callback_payloads',
        'provider_secret_config',
        'root_passwords',
        'ssh_keys',
        'host_certificates',
        'agent_secrets',
        'login_ip_or_user_agent',
        'server_paths',
        'other_users_data'
      ]
    },
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      linkedInstanceId: ticket.instanceId,
      recentMessages: ticket.messages
        .slice()
        .reverse()
        .map(message => ({
          role: message.isFromOwner ? 'support' : 'customer',
          content: cleanText(message.content, 2000),
          createdAt: message.createdAt.toISOString()
        }))
    },
    user: user ? {
      username: user.username,
      accountStatus: user.status,
      registeredAt: user.createdAt.toISOString(),
      balance: valueToString(user.balance),
      counts: user._count
    } : null,
    payments: payments.map(payment => ({
      id: payment.id,
      orderRef: maskIdentifier(payment.orderNo),
      amount: valueToString(payment.amount),
      actualAmount: nullableValueToString(payment.actualAmount),
      status: payment.status,
      paymentMethod: payment.paymentMethod,
      providerName: payment.provider.name,
      createdAt: payment.createdAt.toISOString(),
      completedAt: toIso(payment.completedAt)
    })),
    instances: instances
      .map(instance => {
        const latestTask = instance.instanceTasks[0] || null
        return {
          id: instance.id,
          name: instance.name,
          status: instance.status,
          packageName: instance.package?.name || null,
          planName: instance.packagePlan?.name || null,
          cpu: instance.cpu,
          memory: instance.memory,
          disk: instance.disk,
          publicIpv4: instance.ipv4,
          publicIpv6: instance.ipv6,
          expiresAt: toIso(instance.expiresAt),
          monthlyTrafficUsed: valueToString(instance.monthlyTrafficUsed),
          monthlyTrafficLimit: nullableValueToString(instance.monthlyTrafficLimit),
          trafficStatus: instance.trafficStatus,
          portCount: instance._count.portMappings,
          latestTask: latestTask ? {
            taskType: latestTask.taskType,
            status: latestTask.status,
            progress: latestTask.progress,
            createdAt: latestTask.createdAt.toISOString(),
            finishedAt: toIso(latestTask.finishedAt)
          } : null,
          createdAt: instance.createdAt.toISOString()
        }
      }),
    publicPackages: publicPackages.map(item => ({
      id: item.id,
      name: item.name,
      description: item.description,
      networkMode: item.networkMode,
      instanceType: item.instanceType,
      isActive: item.active,
      plans: item.plans.map(plan => ({
        id: plan.id,
        name: plan.name,
        description: plan.description,
        cpu: plan.cpu,
        memory: plan.memory,
        disk: plan.disk,
        price: valueToString(plan.price),
        billingCycle: plan.billingCycle,
        setupFee: valueToString(plan.setupFee),
        isSoldOut: plan.isSoldOut
      }))
    })),
    knowledge
  }
}

async function generateAiTicketReplyCandidate(ticketId: number): Promise<AiTicketReplyCandidate> {
  const config = await loadAiTicketAgentConfig()
  if (!config.enabled) {
    throw new Error('AI_TICKET_AGENT_DISABLED')
  }
  if (!config.apiBaseUrl || !config.apiKey) {
    throw new Error('AI_TICKET_AGENT_MODEL_NOT_CONFIGURED')
  }

  const context = await buildAiTicketContext(ticketId)
  if (!context) {
    throw new Error('TICKET_NOT_FOUND')
  }

  const decision = config.mode === 'draft'
    ? {
        draft: await requestAiTicketDraft(context, config),
        confidence: 1,
        handoffRequired: false,
        handoffReason: null
      }
    : await requestAiTicketDecision(context, config)
  const draft = decision.draft
  const safety = inspectAiDraftSafety(draft)
  const sendBlockedReasons = [
    ...inspectAiReplySendEligibility(context, config),
    ...(decision.handoffRequired ? [`model_handoff_required${decision.handoffReason ? `:${decision.handoffReason}` : ''}`] : []),
    ...(decision.confidence < config.confidenceThreshold ? ['confidence_below_threshold'] : []),
    ...(config.mode === 'draft' ? [] : await inspectAiReplySendLimits(ticketId, config))
  ]

  return {
    draft,
    model: config.model,
    safety,
    mode: config.mode,
    confidence: decision.confidence,
    confidenceThreshold: config.confidenceThreshold,
    canSend: (config.mode === 'semi_auto' || config.mode === 'auto') && sendBlockedReasons.length === 0,
    sendBlockedReasons
  }
}

export async function generateAiTicketDraft(ticketId: number): Promise<AiTicketDraftResult> {
  const config = await loadAiTicketAgentConfig()
  if (!config.enabled) {
    throw new Error('AI_TICKET_AGENT_DISABLED')
  }
  if (!config.apiBaseUrl || !config.apiKey) {
    throw new Error('AI_TICKET_AGENT_MODEL_NOT_CONFIGURED')
  }

  const context = await buildAiTicketContext(ticketId)
  if (!context) {
    throw new Error('TICKET_NOT_FOUND')
  }

  const draft = await requestAiTicketDraft(context, config)
  return {
    draft,
    model: config.model,
    safety: inspectAiDraftSafety(draft)
  }
}

export async function generateAiTicketReply(ticketId: number): Promise<AiTicketReplyCandidate> {
  return generateAiTicketReplyCandidate(ticketId)
}
