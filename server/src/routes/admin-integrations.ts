import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { getSystemConfig, getSystemConfigBoolean } from '../db/system-config.js'
import { getActivePaymentProviders } from '../db/payment-providers.js'
import { testSmtpConnection } from '../lib/mailer.js'
import { getTicketImageLskyConfig } from '../lib/lsky.js'
import { fetchPluginMarketIndex } from '../lib/plugin-market.js'
import { fetchThemeMarketIndex } from '../lib/theme-market.js'
import { checkForUpdates } from '../lib/system-version.js'
import { StorageFactory } from '../storage/factory.js'
import { assertSafeHttpUrl, safeOutboundDispatcher } from '../lib/outbound-security.js'

type IntegrationHealthStatus = 'ok' | 'warning' | 'error' | 'skipped'

interface IntegrationHealthItem {
  key: string
  title: string
  status: IntegrationHealthStatus
  message: string
  detail?: string
  checkedAt: string
  durationMs: number
}

interface IntegrationHealthRecord {
  id: number
  key: string
  title: string
  status: IntegrationHealthStatus
  message: string
  detail?: string | null
  durationMs: number
  checkedAt: string
}

interface IntegrationHealthSummary {
  key: string
  title: string
  total: number
  ok: number
  warning: number
  error: number
  skipped: number
  successRate: number
  lastStatus: IntegrationHealthStatus
  lastMessage: string
  lastCheckedAt: string
}

const telegramApiTimeoutMs = 15_000
const integrationProbeTimeoutMs = 15_000
const healthHistoryWindowDays = 7
const supportedRechargeProviderTypes = new Set(['yipay', 'heleket', 'manual', 'plugin_gateway'])
const hostAgentOfflineThresholdMs = 2 * 60 * 1000

function nowIso(): string {
  return new Date().toISOString()
}

function durationSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

function normalizeHealthStatus(value: string): IntegrationHealthStatus {
  return value === 'ok' || value === 'warning' || value === 'error' || value === 'skipped'
    ? value
    : 'error'
}

function serializeHealthRecord(record: {
  id: number
  key: string
  title: string
  status: string
  message: string
  detail: string | null
  durationMs: number
  checkedAt: Date
}): IntegrationHealthRecord {
  return {
    id: record.id,
    key: record.key,
    title: record.title,
    status: normalizeHealthStatus(record.status),
    message: record.message,
    detail: record.detail,
    durationMs: record.durationMs,
    checkedAt: record.checkedAt.toISOString()
  }
}

async function recordIntegrationHealthItems(items: IntegrationHealthItem[], checkedByUserId: number): Promise<void> {
  await prisma.integrationHealthCheck.createMany({
    data: items.map(item => ({
      key: item.key,
      title: item.title,
      status: item.status,
      message: item.message,
      detail: item.detail || null,
      durationMs: item.durationMs,
      checkedAt: new Date(item.checkedAt),
      checkedByUserId
    }))
  })
}

async function getIntegrationHealthHistory() {
  const since = new Date(Date.now() - healthHistoryWindowDays * 24 * 60 * 60 * 1000)
  const [windowRecords, recentFailures] = await Promise.all([
    prisma.integrationHealthCheck.findMany({
      where: { checkedAt: { gte: since } },
      orderBy: { checkedAt: 'desc' },
      take: 500
    }),
    prisma.integrationHealthCheck.findMany({
      where: {
        status: { in: ['warning', 'error'] }
      },
      orderBy: { checkedAt: 'desc' },
      take: 10
    })
  ])

  const grouped = new Map<string, typeof windowRecords>()
  for (const record of windowRecords) {
    grouped.set(record.key, [...(grouped.get(record.key) || []), record])
  }

  const summaries: IntegrationHealthSummary[] = Array.from(grouped.entries()).map(([key, records]) => {
    const last = records[0]
    const ok = records.filter(record => record.status === 'ok').length
    const warning = records.filter(record => record.status === 'warning').length
    const error = records.filter(record => record.status === 'error').length
    const skipped = records.filter(record => record.status === 'skipped').length
    const actionableTotal = Math.max(0, records.length - skipped)
    const successRate = actionableTotal > 0 ? Math.round((ok / actionableTotal) * 1000) / 10 : 0

    return {
      key,
      title: last.title,
      total: records.length,
      ok,
      warning,
      error,
      skipped,
      successRate,
      lastStatus: normalizeHealthStatus(last.status),
      lastMessage: last.message,
      lastCheckedAt: last.checkedAt.toISOString()
    }
  })

  summaries.sort((left, right) => right.lastCheckedAt.localeCompare(left.lastCheckedAt))

  return {
    windowDays: healthHistoryWindowDays,
    summaries,
    recentFailures: recentFailures.map(serializeHealthRecord)
  }
}

function hostnameOf(value: string | null | undefined): string {
  if (!value) return '-'
  try {
    return new URL(value).hostname
  } catch {
    return '-'
  }
}

function lskyApiBase(baseUrl: string, apiVersion: 'v1' | 'v2'): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  const apiPrefix = apiVersion === 'v2' ? '/api/v2' : '/api/v1'
  return normalized.toLowerCase().endsWith(apiPrefix) ? normalized : `${normalized}${apiPrefix}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatAge(value: Date | null | undefined): string {
  if (!value) return '从未上报'
  const ageSeconds = Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000))
  if (ageSeconds < 60) return `${ageSeconds} 秒前`
  const ageMinutes = Math.floor(ageSeconds / 60)
  if (ageMinutes < 60) return `${ageMinutes} 分钟前`
  const ageHours = Math.floor(ageMinutes / 60)
  if (ageHours < 24) return `${ageHours} 小时前`
  return `${Math.floor(ageHours / 24)} 天前`
}

async function withProbeTimeout<T>(promise: Promise<T>, label: string, ms = integrationProbeTimeoutMs): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时（${Math.round(ms / 1000)} 秒）`)), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function probe(
  key: string,
  title: string,
  run: () => Promise<Omit<IntegrationHealthItem, 'key' | 'title' | 'checkedAt' | 'durationMs'>>
): Promise<IntegrationHealthItem> {
  const startedAt = Date.now()
  try {
    const result = await run()
    return {
      key,
      title,
      ...result,
      checkedAt: nowIso(),
      durationMs: durationSince(startedAt)
    }
  } catch (error: any) {
    return {
      key,
      title,
      status: 'error',
      message: error?.message || String(error),
      checkedAt: nowIso(),
      durationMs: durationSince(startedAt)
    }
  }
}

async function checkSmtp() {
  const enabled = await getSystemConfigBoolean('smtp_enabled', false)
  if (!enabled) {
    return { status: 'skipped' as const, message: 'SMTP 未启用' }
  }

  const result = await testSmtpConnection()
  if (!result.success) {
    return { status: 'error' as const, message: result.error || 'SMTP 连接失败' }
  }
  return { status: 'ok' as const, message: 'SMTP 连接成功' }
}

async function checkLsky() {
  const config = await getTicketImageLskyConfig()
  if (!config) {
    return { status: 'skipped' as const, message: 'Lsky 未配置' }
  }

  const apiBase = lskyApiBase(config.baseUrl, config.apiVersion)
  const endpoint = config.apiVersion === 'v2' ? `${apiBase}/group` : `${apiBase}/profile`
  // 管理员配置的 baseUrl 可能指向内网，探测前做 SSRF 校验，并用连接期再校验的 dispatcher 防 DNS rebinding
  await assertSafeHttpUrl(endpoint, 'Lsky endpoint')
  const response = await fetch(endpoint, {
    method: 'GET',
    redirect: 'manual',
    dispatcher: safeOutboundDispatcher,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.token}`
    }
  } as RequestInit)

  if (!response.ok) {
    return {
      status: 'error' as const,
      message: `Lsky 只读探测失败：HTTP ${response.status}`,
      detail: `${config.apiVersion} / ${hostnameOf(config.baseUrl)}`
    }
  }

  return {
    status: 'ok' as const,
    message: 'Lsky API 可访问',
    detail: `${config.apiVersion} / ${hostnameOf(config.baseUrl)}`
  }
}

async function checkTelegram() {
  const enabled = await getSystemConfigBoolean('telegram_bot_enabled', false)
  const botToken = await getSystemConfig('telegram_bot_token')
  if (!enabled || !botToken) {
    return { status: 'skipped' as const, message: 'Telegram Bot 未启用或 token 未配置' }
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(telegramApiTimeoutMs)
  })
  const payload: any = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    return {
      status: 'error' as const,
      message: payload?.description || `Telegram getWebhookInfo failed: HTTP ${response.status}`
    }
  }

  const info = payload.result || {}
  if (info.last_error_message) {
    return {
      status: 'warning' as const,
      message: info.last_error_message,
      detail: info.url ? `Webhook 已配置，待处理 ${info.pending_update_count ?? 0}` : 'Webhook 未配置'
    }
  }

  return {
    status: info.url ? 'ok' as const : 'warning' as const,
    message: info.url ? 'Telegram Webhook 正常' : 'Telegram Bot 可访问但 Webhook 未配置',
    detail: info.url ? `待处理 ${info.pending_update_count ?? 0}` : undefined
  }
}

async function checkPaymentProviders() {
  const providers = await getActivePaymentProviders()
  if (providers.length === 0) {
    return { status: 'warning' as const, message: '未启用任何充值支付渠道' }
  }

  const unsupported = providers.filter(provider => !supportedRechargeProviderTypes.has(String(provider.type)))
  if (unsupported.length > 0) {
    return {
      status: 'warning' as const,
      message: `存在 ${unsupported.length} 个尚未接入充值下单流程的启用支付渠道`,
      detail: unsupported.map(provider => `${provider.name}(${provider.type})`).join(', ')
    }
  }

  const manualWithoutInstructions = providers.filter(provider => {
    if (provider.type !== 'manual') return false
    const config = asRecord(provider.config)
    return !trimString(config.instructions)
  })
  if (manualWithoutInstructions.length > 0) {
    return {
      status: 'error' as const,
      message: '人工充值渠道已启用但未填写收款说明',
      detail: manualWithoutInstructions.map(provider => provider.name).join(', ')
    }
  }

  const counts = providers.reduce<Record<string, number>>((acc, provider) => {
    const type = String(provider.type)
    acc[type] = (acc[type] || 0) + 1
    return acc
  }, {})

  return {
    status: 'ok' as const,
    message: `已启用 ${providers.length} 个可用于充值的支付渠道`,
    detail: Object.entries(counts).map(([type, count]) => `${type} x${count}`).join(', ')
  }
}

async function checkNotificationChannels() {
  const channels = await prisma.notificationChannel.findMany({
    where: { isGlobal: true },
    select: { id: true, name: true, type: true, enabled: true }
  })
  const enabled = channels.filter(channel => channel.enabled)
  if (channels.length === 0) {
    return { status: 'warning' as const, message: '未配置全局通知渠道' }
  }
  if (enabled.length === 0) {
    return { status: 'warning' as const, message: '全局通知渠道均未启用', detail: `共 ${channels.length} 个渠道` }
  }

  const typeCounts = enabled.reduce<Record<string, number>>((acc, channel) => {
    acc[channel.type] = (acc[channel.type] || 0) + 1
    return acc
  }, {})

  return {
    status: 'ok' as const,
    message: `已启用 ${enabled.length}/${channels.length} 个全局通知渠道`,
    detail: Object.entries(typeCounts).map(([type, count]) => `${type} x${count}`).join(', ')
  }
}

async function checkRemoteStorage() {
  const defaultConfig = await prisma.storageConfig.findFirst({
    where: { isDefault: true },
    orderBy: { updatedAt: 'desc' }
  })
  if (!defaultConfig) {
    return { status: 'skipped' as const, message: '未配置默认远程存储' }
  }

  await withProbeTimeout(StorageFactory.create(defaultConfig).testConnection(), '远程存储连接测试')

  return {
    status: 'ok' as const,
    message: '默认远程存储连接成功',
    detail: `${defaultConfig.name} / ${defaultConfig.type} / ${hostnameOf(defaultConfig.host)}`
  }
}

async function checkHostAgent() {
  const hosts = await prisma.host.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      isInstalled: true,
      agent: {
        select: {
          enabled: true,
          status: true,
          version: true,
          lastSeenAt: true
        }
      }
    },
    orderBy: { id: 'asc' }
  })
  const installedHosts = hosts.filter(host => host.isInstalled)
  if (hosts.length === 0) {
    return { status: 'skipped' as const, message: '暂无节点' }
  }
  if (installedHosts.length === 0) {
    return { status: 'warning' as const, message: '暂无已安装节点' }
  }

  const missingAgent = installedHosts.filter(host => !host.agent)
  const enabledAgents = installedHosts.filter(host => host.agent?.enabled)
  const now = Date.now()
  const offlineAgents = enabledAgents.filter(host => {
    const agent = host.agent
    if (!agent) return true
    if (agent.status !== 'online') return true
    if (!agent.lastSeenAt) return true
    return now - agent.lastSeenAt.getTime() > hostAgentOfflineThresholdMs
  })

  if (missingAgent.length > 0 || offlineAgents.length > 0) {
    return {
      status: 'warning' as const,
      message: `Agent 需要复核：缺失 ${missingAgent.length} 台，离线/过期 ${offlineAgents.length} 台`,
      detail: [...missingAgent, ...offlineAgents]
        .slice(0, 5)
        .map(host => `${host.name}(${host.agent?.status || 'missing'} / ${formatAge(host.agent?.lastSeenAt)})`)
        .join(', ')
    }
  }

  return {
    status: 'ok' as const,
    message: `Agent 心跳正常：${enabledAgents.length}/${installedHosts.length} 台已安装节点在线`,
    detail: enabledAgents
      .slice(0, 5)
      .map(host => `${host.name} ${host.agent?.version || 'unknown'} / ${formatAge(host.agent?.lastSeenAt)}`)
      .join(', ')
  }
}

async function checkOtaRelease() {
  const result = await withProbeTimeout(checkForUpdates(), 'OTA 更新源检测')
  if (!result.repositoryAvailable) {
    return {
      status: 'warning' as const,
      message: result.repositoryError || '当前部署目录无法读取 Git release tag',
      detail: result.current.version
    }
  }

  const latestVersion = result.latest?.version || '未读取到 release tag'
  return {
    status: result.updateAvailable ? 'warning' as const : 'ok' as const,
    message: result.updateAvailable
      ? `检测到 ${result.updates.length} 个可用 OTA 更新`
      : 'OTA 更新源可访问，当前已是最新 release tag',
    detail: `当前 ${result.current.version} / 最新 ${latestVersion}`
  }
}

async function checkPluginMarket() {
  const index = await fetchPluginMarketIndex()
  return {
    status: 'ok' as const,
    message: `扩展市场可访问：${index.governance.visibleEntries}/${index.governance.totalEntries} 个可见`,
    detail: `${index.governance.indexHost || 'local'} / ${index.governance.fingerprint}`
  }
}

async function checkThemeMarket() {
  const index = await fetchThemeMarketIndex()
  return {
    status: 'ok' as const,
    message: `主题市场可访问：${index.governance.visibleEntries}/${index.governance.totalEntries} 个可见`,
    detail: `${index.governance.indexHost || 'local'} / ${index.governance.fingerprint}`
  }
}

export default async function adminIntegrationsRoutes(fastify: FastifyInstance) {
  fastify.get('/health/history', {
    onRequest: [fastify.authenticateAdmin]
  }, async () => {
    return getIntegrationHealthHistory()
  })

  fastify.post('/health', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request) => {
    const items = await Promise.all([
      probe('smtp', 'SMTP 邮件', checkSmtp),
      probe('lsky', 'Lsky 工单附件', checkLsky),
      probe('telegram', 'Telegram Bot', checkTelegram),
      probe('payment-providers', '充值支付渠道', checkPaymentProviders),
      probe('notification-channels', '全局通知渠道', checkNotificationChannels),
      probe('remote-storage', '远程存储', checkRemoteStorage),
      probe('host-agent', 'Agent / Incus 节点', checkHostAgent),
      probe('ota-release', 'OTA 更新源', checkOtaRelease),
      probe('plugin-market', '扩展市场源', checkPluginMarket),
      probe('theme-market', '主题市场源', checkThemeMarket)
    ])

    await createLog(
      request.user.id,
      'system',
      'integrations.health_check',
      `Checked integration health: ${items.map(item => `${item.key}=${item.status}`).join(', ')}`,
      items.some(item => item.status === 'error') ? 'warning' : 'success'
    )

    await recordIntegrationHealthItems(items, request.user.id)
    const history = await getIntegrationHealthHistory()

    return {
      checkedAt: nowIso(),
      items,
      history
    }
  })
}
