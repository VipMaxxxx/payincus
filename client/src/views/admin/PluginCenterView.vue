<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api/admin'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import { useToast } from '@/stores/toast'
import type { PayIncusThemeConfigField, PluginEventLog, PluginEventSummary, PluginMarketEntry, PluginMarketGovernance, PluginMarketSubmission, PluginMarketSubmissionReviewStatus, PluginRecord, PluginStorageBackupArchive, PluginStorageBackupRemoteArchive, PluginStorageUsage, PluginTask, PublicPluginActionRateLimitDefault, PublicPluginActionRateLimitPolicy, ThemeMarketEntry, ThemeMarketGovernance, ThemeMarketSubmission, ThemeMarketSubmissionReviewStatus, ThemePackageRecord } from '@/types/api'

const toast = useToast()
const route = useRoute()
const router = useRouter()
type ThemeConfigDraftValue = string | number | boolean | string[]
type ThemeConfigFieldEntry = [string, PayIncusThemeConfigField]
type PluginCenterTab = 'installed' | 'market' | 'submissions' | 'themes' | 'limits' | 'events' | 'tasks'
const pluginCenterTabKeys: PluginCenterTab[] = ['installed', 'market', 'submissions', 'themes', 'limits', 'events', 'tasks']

function normalizePluginCenterTab(value: unknown): PluginCenterTab {
  return typeof value === 'string' && pluginCenterTabKeys.includes(value as PluginCenterTab)
    ? value as PluginCenterTab
    : 'installed'
}

interface ActionRateLimitDraft {
  pluginId: string
  actionName: string
  rateLimit: 'normal' | 'strict'
  maxRequests: number
  windowSeconds: number
  enabled: boolean
}

interface ThemeConfigGroup {
  name: string
  fields: ThemeConfigFieldEntry[]
}

const DEFAULT_THEME_CONFIG_GROUP = '基础配置'

const loading = ref(true)
const marketLoading = ref(false)
const submissionsLoading = ref(false)
const scanningSubmissionId = ref<number | null>(null)
const publishingMarketIndex = ref(false)
const uploading = ref(false)
const themesLoading = ref(false)
const themeMarketLoading = ref(false)
const installingThemeMarketId = ref<string | null>(null)
const themeUploading = ref(false)
const themeSubmissionsLoading = ref(false)
const scanningThemeSubmissionId = ref<number | null>(null)
const publishingThemeMarketIndex = ref(false)
const taskLogsLoading = ref(false)
const eventsLoading = ref(false)
const retryingEvents = ref(false)
const actionRateLimitsLoading = ref(false)
const savingActionRateLimits = ref(false)
const activeTab = ref<PluginCenterTab>(normalizePluginCenterTab(route.query.tab))
const selectedPluginId = ref<string | null>(null)
const pluginStorageUsage = ref<PluginStorageUsage | null>(null)
const pluginStorageBackupArchives = ref<PluginStorageBackupArchive[]>([])
const pluginStorageUsageLoading = ref(false)
const pluginStorageBackupArchivesLoading = ref(false)
const pluginStorageBackupArchiveActionId = ref<string | null>(null)
const pluginStorageUsageError = ref('')
const selectedPluginStorageBackupFile = ref<File | null>(null)
const selectedFile = ref<File | null>(null)
const selectedThemeFile = ref<File | null>(null)
const plugins = ref<PluginRecord[]>([])
const market = ref<PluginMarketEntry[]>([])
const marketGovernance = ref<PluginMarketGovernance | null>(null)
const submissions = ref<PluginMarketSubmission[]>([])
const themes = ref<ThemePackageRecord[]>([])
const themeMarket = ref<ThemeMarketEntry[]>([])
const themeMarketGovernance = ref<ThemeMarketGovernance | null>(null)
const themeSubmissions = ref<ThemeMarketSubmission[]>([])
const editingThemeConfigId = ref<string | null>(null)
const savingThemeConfigId = ref<string | null>(null)
const uploadingThemeConfigFileKey = ref<string | null>(null)
const themeConfigDraft = ref<Record<string, ThemeConfigDraftValue>>({})
const pluginEvents = ref<PluginEventLog[]>([])
const pluginEventSummary = ref<PluginEventSummary | null>(null)
const actionRateLimitDefaults = ref<PublicPluginActionRateLimitDefault[]>([])
const actionRateLimitPolicies = ref<PublicPluginActionRateLimitPolicy[]>([])
const actionRateLimitDrafts = ref<ActionRateLimitDraft[]>([])
const eventResultFilter = ref<'retry_pending' | 'dead_letter' | 'duplicate_skipped' | 'success' | 'all'>('retry_pending')
const eventPluginFilter = ref('all')
const eventNameFilter = ref('all')
const eventHandlerFilter = ref('')
const submissionStatusFilter = ref<PluginMarketSubmissionReviewStatus>('pending')
const themeSubmissionStatusFilter = ref<ThemeMarketSubmissionReviewStatus>('pending')
const tasks = ref<PluginTask[]>([])
const taskLogs = ref('')
const selectedTaskId = ref<number | null>(null)
const taskPage = ref(1)
const TASKS_PER_PAGE = 7
const tabs = [
  { key: 'installed', label: '已安装', description: '上传扩展包、启用停用和查看扩展详情。扩展设置会作为独立页面显示在左侧菜单。' },
  { key: 'market', label: '扩展市场', description: '从已配置的在线市场索引读取扩展并安装。' },
  { key: 'submissions', label: '投稿审核', description: '审核第三方提交的扩展包来源、SHA256、权限说明和兼容范围。' },
  { key: 'themes', label: '主题', description: '上传主题包、预览视觉效果、启用主题或回滚到默认主题。' },
  { key: 'limits', label: '限流策略', description: '配置公开扩展 action 的全局和按扩展覆盖配额。' },
  { key: 'events', label: '事件投递', description: '查看扩展事件投递、重试队列、死信和手动重放结果。' },
  { key: 'tasks', label: '安装任务', description: '查看上传安装、市场安装、启用、禁用和卸载任务日志。' }
] as const

const pluginBusinessEventNames = [
  'order.created',
  'order.paid',
  'payment.failed',
  'service.provisioned',
  'service.suspended',
  'service.unsuspended',
  'service.deleted',
  'service.task.queued',
  'service.task.cancelled',
  'service.task.completed',
  'service.task.failed',
  'service.resource.rollback.completed',
  'service.resource.rollback.failed',
  'ticket.created',
  'ticket.replied',
  'ticket.status.changed',
  'user.registered',
  'user.login',
  'user.profile.updated',
  'user.status.changed',
  'notification.sent'
] as const

const selectedPlugin = computed(() =>
  plugins.value.find(plugin => plugin.pluginId === selectedPluginId.value) || plugins.value[0] || null
)

const selectedPluginStorageRows = computed(() => {
  const usage = pluginStorageUsage.value
  if (!usage) return []
  return [
    ...usage.kv.map(item => ({
      key: `kv:${item.scopeType}`,
      label: `KV / ${item.scopeType}`,
      count: item.keyCount,
      limit: item.maxKeys,
      declared: item.declared
    })),
    ...usage.tables.map(item => ({
      key: `table:${item.tableName}:${item.scopeType}`,
      label: `${item.tableName} / ${item.scopeType}`,
      count: item.rowCount,
      limit: item.maxRows,
      declared: item.declared
    }))
  ]
})

const selectedTask = computed(() =>
  tasks.value.find(task => task.id === selectedTaskId.value) || null
)

const stats = computed(() => ({
  installed: plugins.value.length,
  enabled: plugins.value.filter(plugin => plugin.enabled).length,
  failed: plugins.value.filter(plugin => plugin.status === 'failed').length,
  market: market.value.length,
  themes: themes.value.length,
  activeTheme: themes.value.filter(theme => theme.enabled).length,
  themeMarket: themeMarket.value.length
}))

const eventSummary = computed(() => {
  const summary = pluginEventSummary.value
  if (summary) {
    return {
      total: summary.total,
      success: summary.success,
      failed: summary.failed,
      retryPending: summary.retryPending,
      deadLetter: summary.deadLetter,
      deduped: summary.deduped,
      dueRetry: summary.dueRetry
    }
  }
  return {
    total: pluginEvents.value.length,
    success: pluginEvents.value.filter(event => event.result === 'success').length,
    failed: pluginEvents.value.filter(event => event.result === 'failed').length,
    retryPending: pluginEvents.value.filter(event => event.result === 'retry_pending').length,
    deadLetter: pluginEvents.value.filter(event => event.result === 'dead_letter').length,
    deduped: pluginEvents.value.filter(event => event.result === 'duplicate_skipped').length,
    dueRetry: pluginEvents.value.filter(event => event.result === 'retry_pending' && event.nextRetryAt && new Date(event.nextRetryAt).getTime() <= Date.now()).length
  }
})

const taskSummary = computed(() => ({
  total: tasks.value.length,
  running: tasks.value.filter(task => task.status === 'pending' || task.status === 'running').length,
  failed: tasks.value.filter(task => task.status === 'failed').length
}))

const submissionSummary = computed(() => ({
  total: submissions.value.length,
  pending: submissions.value.filter(item => item.reviewStatus === 'pending').length,
  highRisk: submissions.value.filter(item => item.riskLevel === 'high' || item.riskLevel === 'critical').length
}))

const themeSubmissionSummary = computed(() => ({
  total: themeSubmissions.value.length,
  pending: themeSubmissions.value.filter(item => item.reviewStatus === 'pending').length,
  highRisk: themeSubmissions.value.filter(item => item.riskLevel === 'high' || item.riskLevel === 'critical').length
}))

const activeTabMeta = computed(() =>
  tabs.find(tab => tab.key === activeTab.value) || tabs[0]
)

const totalTaskPages = computed(() =>
  Math.max(1, Math.ceil(tasks.value.length / TASKS_PER_PAGE))
)

const paginatedTasks = computed(() => {
  const start = (taskPage.value - 1) * TASKS_PER_PAGE
  return tasks.value.slice(start, start + TASKS_PER_PAGE)
})

const pluginPermissionLabels: Record<string, string> = {
  'ticket:ai:read-context': '读取脱敏工单上下文',
  'ticket:ai:generate-draft': '生成 AI 回复草稿',
  'ticket:ai:reply': '发送受控接管回复',
  'ticket:ai:handoff': '触发人工接管',
  'plugin:config:read': '读取扩展配置',
  'plugin:config:write': '写入扩展配置'
}

const marketReviewLabels: Record<PluginMarketEntry['reviewStatus'], string> = {
  pending: '待审核',
  listed: '已上架',
  delisted: '已下架',
  rejected: '已拒绝'
}

const marketTrustLabels: Record<PluginMarketEntry['trustLevel'], string> = {
  official: '官方来源',
  verified: '认证开发者',
  third_party: '第三方'
}

const marketPricingLabels: Record<PluginMarketEntry['pricing']['type'], string> = {
  free: '免费',
  paid: '付费预留'
}

const submissionReviewLabels: Record<PluginMarketSubmissionReviewStatus, string> = {
  pending: '待审核',
  listed: '通过上架',
  rejected: '拒绝',
  delisted: '下架'
}

const themeSubmissionReviewLabels: Record<ThemeMarketSubmissionReviewStatus, string> = {
  pending: '待审核',
  listed: '通过上架',
  rejected: '拒绝',
  delisted: '下架'
}

const submissionRiskLabels: Record<PluginMarketSubmission['riskLevel'], string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '严重风险'
}

const themeSubmissionRiskLabels: Record<ThemeMarketSubmission['riskLevel'], string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '严重风险'
}

const submissionScanLabels: Record<PluginMarketSubmission['scanStatus'], string> = {
  pending: '未扫描',
  passed: '扫描通过',
  warning: '有警告',
  failed: '扫描失败'
}

const themeSubmissionScanLabels: Record<ThemeMarketSubmission['scanStatus'], string> = {
  pending: '未扫描',
  passed: '扫描通过',
  warning: '有警告',
  failed: '扫描失败'
}

function displayPluginName(plugin: PluginRecord): string {
  if (plugin.pluginId === 'com.payincus.ai-ticket-agent') return 'AI 工单助手'
  return plugin.name
}

function displayPluginDescription(plugin: PluginRecord): string {
  if (plugin.pluginId === 'com.payincus.ai-ticket-agent') {
    return '用于工单草稿生成和受控接管回复的 AI 插件，默认人工审核，按最小脱敏上下文工作。'
  }
  return plugin.latestVersion?.manifest.description || '-'
}

function formatPermission(permission: string): string {
  return pluginPermissionLabels[permission] || permission
}

function formatMarketPermission(permission: string): string {
  return formatPermission(permission)
}

function formatCompatibility(entry: PluginMarketEntry): string {
  const min = entry.compatibility.minPayincus || '不限'
  const max = entry.compatibility.maxPayincus || '不限'
  return `${min} - ${max}`
}

function formatRating(entry: PluginMarketEntry): string {
  if (!entry.rating.count) return '暂无评分'
  return `${entry.rating.average.toFixed(1)} / 5 · ${entry.rating.count} 条`
}

function marketBadgeClass(entry: PluginMarketEntry): string {
  if (entry.trustLevel === 'official') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (entry.trustLevel === 'verified') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function themeMarketBadgeClass(entry: ThemeMarketEntry): string {
  if (entry.trustLevel === 'official') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (entry.trustLevel === 'verified') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function reviewBadgeClass(entry: PluginMarketEntry): string {
  if (entry.reviewStatus === 'listed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (entry.reviewStatus === 'rejected') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-gray-200 bg-gray-50 text-gray-700'
}

function submissionReviewClass(status: PluginMarketSubmissionReviewStatus): string {
  if (status === 'listed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'rejected') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'delisted') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-blue-200 bg-blue-50 text-blue-700'
}

function themeSubmissionReviewClass(status: ThemeMarketSubmissionReviewStatus): string {
  if (status === 'listed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'rejected') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'delisted') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-blue-200 bg-blue-50 text-blue-700'
}

function submissionRiskClass(riskLevel: PluginMarketSubmission['riskLevel']): string {
  if (riskLevel === 'critical') return 'border-red-300 bg-red-50 text-red-800'
  if (riskLevel === 'high') return 'border-orange-200 bg-orange-50 text-orange-700'
  if (riskLevel === 'low') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-gray-200 bg-gray-50 text-gray-700'
}

function submissionScanClass(status: PluginMarketSubmission['scanStatus']): string {
  if (status === 'passed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-gray-200 bg-gray-50 text-gray-700'
}

function themeSubmissionRiskClass(riskLevel: ThemeMarketSubmission['riskLevel']): string {
  if (riskLevel === 'critical') return 'border-red-300 bg-red-50 text-red-800'
  if (riskLevel === 'high') return 'border-orange-200 bg-orange-50 text-orange-700'
  if (riskLevel === 'low') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-gray-200 bg-gray-50 text-gray-700'
}

function themeSubmissionScanClass(status: ThemeMarketSubmission['scanStatus']): string {
  if (status === 'passed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-gray-200 bg-gray-50 text-gray-700'
}

function submissionScanFindings(submission: PluginMarketSubmission): Array<{ severity: string; code: string; message: string }> {
  const result = submission.scanResult
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  const findings = (result as { findings?: unknown }).findings
  if (!Array.isArray(findings)) return []
  return findings
    .map(item => item && typeof item === 'object' ? item as { severity?: unknown; code?: unknown; message?: unknown } : null)
    .filter((item): item is { severity?: unknown; code?: unknown; message?: unknown } => !!item)
    .map(item => ({
      severity: typeof item.severity === 'string' ? item.severity : 'info',
      code: typeof item.code === 'string' ? item.code : 'unknown',
      message: typeof item.message === 'string' ? item.message : ''
    }))
}

function themeSubmissionScanFindings(submission: ThemeMarketSubmission): Array<{ severity: string; code: string; message: string }> {
  const result = submission.scanResult
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  const findings = (result as { findings?: unknown }).findings
  if (!Array.isArray(findings)) return []
  return findings
    .map(item => item && typeof item === 'object' ? item as { severity?: unknown; code?: unknown; message?: unknown } : null)
    .filter((item): item is { severity?: unknown; code?: unknown; message?: unknown } => !!item)
    .map(item => ({
      severity: typeof item.severity === 'string' ? item.severity : 'info',
      code: typeof item.code === 'string' ? item.code : 'unknown',
      message: typeof item.message === 'string' ? item.message : ''
    }))
}

function canInstallMarketEntry(entry: PluginMarketEntry): boolean {
  return entry.reviewStatus === 'listed' && entry.security.checksumPinned
}

function buildMarketInstallConfirmation(entry: PluginMarketEntry): string {
  const permissions = [
    ...entry.permissions.adminPages.map(item => `后台页面：${item}`),
    ...entry.permissions.userPages.map(item => `用户页面：${item}`),
    ...entry.permissions.api.map(item => `接口权限：${formatMarketPermission(item)}`),
    ...entry.permissions.storage.map(item => `存储目录：${item}`)
  ]
  return [
    `确认安装 ${entry.name} ${entry.latest}？`,
    `审核状态：${marketReviewLabels[entry.reviewStatus]}`,
    `可信来源：${marketTrustLabels[entry.trustLevel]}`,
    `兼容范围：${formatCompatibility(entry)}`,
    `包校验：SHA256 ${entry.sha256.slice(0, 16)}...`,
    `权限声明：${permissions.length ? permissions.join('；') : '无'}`
  ].join('\n')
}

function hasAdminSettingsPage(plugin: PluginRecord): boolean {
  return Boolean(plugin.latestVersion?.manifest.entrypoints.adminPages?.some(page => page.slot === 'admin.plugins.settings'))
}

function openPluginSettings(plugin: PluginRecord) {
  router.push(`/admin/plugins/${encodeURIComponent(plugin.pluginId)}/settings`)
}

function formatStorageLimit(limit: number | null): string {
  return limit === null ? '不限' : String(limit)
}

function formatStorageUsageRatio(value: number): string {
  return `${Math.round(value * 100)}%`
}

function storageWarningClass(level: 'warning' | 'critical'): string {
  return level === 'critical'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-amber-200 bg-amber-50 text-amber-700'
}

async function loadPluginStorageUsage(pluginId = selectedPluginId.value) {
  if (!pluginId) {
    pluginStorageUsage.value = null
    pluginStorageUsageError.value = ''
    return
  }
  pluginStorageUsageLoading.value = true
  pluginStorageUsageError.value = ''
  try {
    const response = await api.plugins.getStorageUsage(pluginId)
    if (selectedPluginId.value === pluginId) {
      pluginStorageUsage.value = response.usage
    }
  } catch (err: any) {
    if (selectedPluginId.value === pluginId) {
      pluginStorageUsage.value = null
      pluginStorageUsageError.value = err?.message || String(err)
    }
  } finally {
    if (selectedPluginId.value === pluginId) {
      pluginStorageUsageLoading.value = false
    }
  }
}

async function loadPluginStorageBackupArchives(pluginId = selectedPluginId.value) {
  if (!pluginId) {
    pluginStorageBackupArchives.value = []
    return
  }
  pluginStorageBackupArchivesLoading.value = true
  try {
    const response = await api.plugins.listStorageBackupArchives(pluginId)
    if (selectedPluginId.value === pluginId) {
      pluginStorageBackupArchives.value = response.archives
    }
  } catch (error) {
    if (selectedPluginId.value === pluginId) {
      pluginStorageBackupArchives.value = []
      pluginStorageUsageError.value = error instanceof Error ? error.message : '加载扩展存储归档失败'
    }
  } finally {
    if (selectedPluginId.value === pluginId) {
      pluginStorageBackupArchivesLoading.value = false
    }
  }
}

function downloadJsonFile(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function exportPluginStorageBackup(pluginId = selectedPluginId.value) {
  if (!pluginId) return
  try {
    const response = await api.plugins.exportStorageBackup(pluginId)
    downloadJsonFile(`${pluginId}-storage-backup.json`, response.backup)
    toast.success('扩展存储备份已导出')
  } catch (error) {
    pluginStorageUsageError.value = error instanceof Error ? error.message : '导出扩展存储备份失败'
  }
}

async function createPluginStorageBackupArchive(pluginId = selectedPluginId.value) {
  if (!pluginId) return
  pluginStorageBackupArchiveActionId.value = 'create'
  try {
    await api.plugins.createStorageBackupArchive(pluginId)
    await loadPluginStorageBackupArchives(pluginId)
    toast.success('扩展存储归档已创建')
  } catch (error) {
    pluginStorageUsageError.value = error instanceof Error ? error.message : '创建扩展存储归档失败'
  } finally {
    pluginStorageBackupArchiveActionId.value = null
  }
}

async function downloadPluginStorageBackupArchive(archive: PluginStorageBackupArchive) {
  pluginStorageBackupArchiveActionId.value = archive.backupId
  try {
    const response = await api.plugins.downloadStorageBackupArchive(archive.pluginId, archive.backupId)
    downloadJsonFile(`${archive.pluginId}-${archive.backupId}-storage-backup.json`, response.backup)
    toast.success('扩展存储归档已下载')
  } catch (error) {
    pluginStorageUsageError.value = error instanceof Error ? error.message : '下载扩展存储归档失败'
  } finally {
    pluginStorageBackupArchiveActionId.value = null
  }
}

async function validatePluginStorageBackupArchiveRestore(archive: PluginStorageBackupArchive) {
  pluginStorageBackupArchiveActionId.value = archive.backupId
  try {
    await api.plugins.validateStorageBackupArchiveRestore(archive.pluginId, archive.backupId)
    toast.success('扩展存储归档恢复演练通过')
  } catch (error) {
    pluginStorageUsageError.value = error instanceof Error ? error.message : '扩展存储归档演练失败'
  } finally {
    pluginStorageBackupArchiveActionId.value = null
  }
}

async function restorePluginStorageBackupArchive(archive: PluginStorageBackupArchive) {
  if (!window.confirm('从归档恢复会替换该扩展当前所有 KV、私有表和 migration ledger。确认继续？')) return
  pluginStorageBackupArchiveActionId.value = archive.backupId
  try {
    await api.plugins.restoreStorageBackupArchive(archive.pluginId, archive.backupId)
    await loadPluginStorageUsage(archive.pluginId)
    await loadPluginStorageBackupArchives(archive.pluginId)
    toast.success('扩展存储归档已恢复')
  } catch (error) {
    pluginStorageUsageError.value = error instanceof Error ? error.message : '恢复扩展存储归档失败'
  } finally {
    pluginStorageBackupArchiveActionId.value = null
  }
}

async function uploadPluginStorageBackupArchiveRemote(archive: PluginStorageBackupArchive) {
  pluginStorageBackupArchiveActionId.value = `remote-upload:${archive.backupId}`
  try {
    await api.plugins.uploadStorageBackupArchiveRemote(archive.pluginId, archive.backupId)
    await loadPluginStorageBackupArchives(archive.pluginId)
    toast.success('扩展存储归档已上传到远端存储')
  } catch (error) {
    pluginStorageUsageError.value = error instanceof Error ? error.message : '上传扩展存储远端归档失败'
  } finally {
    pluginStorageBackupArchiveActionId.value = null
  }
}

async function validatePluginStorageRemoteBackupArchiveRestore(archive: PluginStorageBackupArchive, remoteArchive: PluginStorageBackupRemoteArchive) {
  pluginStorageBackupArchiveActionId.value = `remote-validate:${remoteArchive.id}`
  try {
    await api.plugins.validateRemoteStorageBackupArchiveRestore(archive.pluginId, archive.backupId, remoteArchive.id)
    toast.success('扩展存储远端归档恢复演练通过')
  } catch (error) {
    pluginStorageUsageError.value = error instanceof Error ? error.message : '扩展存储远端归档演练失败'
  } finally {
    pluginStorageBackupArchiveActionId.value = null
  }
}

async function restorePluginStorageRemoteBackupArchive(archive: PluginStorageBackupArchive, remoteArchive: PluginStorageBackupRemoteArchive) {
  if (!window.confirm(`从远端归档 ${remoteArchive.remoteFileName} 恢复会替换该扩展当前所有 KV、私有表和 migration ledger。确认继续？`)) return
  pluginStorageBackupArchiveActionId.value = `remote-restore:${remoteArchive.id}`
  try {
    await api.plugins.restoreRemoteStorageBackupArchive(archive.pluginId, archive.backupId, remoteArchive.id)
    await loadPluginStorageUsage(archive.pluginId)
    await loadPluginStorageBackupArchives(archive.pluginId)
    toast.success('扩展存储远端归档已恢复')
  } catch (error) {
    pluginStorageUsageError.value = error instanceof Error ? error.message : '恢复扩展存储远端归档失败'
  } finally {
    pluginStorageBackupArchiveActionId.value = null
  }
}

async function deletePluginStorageBackupArchive(archive: PluginStorageBackupArchive) {
  if (!window.confirm(`删除归档 ${archive.backupId} 后无法从后台恢复。确认删除？`)) return
  pluginStorageBackupArchiveActionId.value = archive.backupId
  try {
    await api.plugins.deleteStorageBackupArchive(archive.pluginId, archive.backupId)
    await loadPluginStorageBackupArchives(archive.pluginId)
    toast.success('扩展存储归档已删除')
  } catch (error) {
    pluginStorageUsageError.value = error instanceof Error ? error.message : '删除扩展存储归档失败'
  } finally {
    pluginStorageBackupArchiveActionId.value = null
  }
}

async function onPluginStorageBackupSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  selectedPluginStorageBackupFile.value = file
  input.value = ''
  if (!file || !selectedPluginId.value) return
  if (!window.confirm('恢复备份会替换该扩展当前所有 KV、私有表和 migration ledger。确认继续？')) {
    selectedPluginStorageBackupFile.value = null
    return
  }
  try {
    const backup = JSON.parse(await file.text())
    await api.plugins.validateStorageBackupRestore(selectedPluginId.value, backup)
    await api.plugins.restoreStorageBackup(selectedPluginId.value, backup)
    selectedPluginStorageBackupFile.value = null
    await loadPluginStorageUsage(selectedPluginId.value)
    await loadPluginStorageBackupArchives(selectedPluginId.value)
    toast.success('扩展存储备份已恢复')
  } catch (error) {
    selectedPluginStorageBackupFile.value = null
    pluginStorageUsageError.value = error instanceof Error ? error.message : '恢复扩展存储备份失败'
  }
}

function refreshPluginNav() {
  window.dispatchEvent(new Event('payincus:admin-plugin-nav-refresh'))
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusClass(plugin: PluginRecord): string {
  if (plugin.enabled) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (plugin.status === 'failed') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function statusText(plugin: PluginRecord): string {
  if (plugin.enabled) return '已启用'
  if (plugin.status === 'failed') return '异常'
  return '未启用'
}

function themeStatusClass(theme: ThemePackageRecord): string {
  if (theme.enabled) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (theme.status === 'failed') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function themeStatusText(theme: ThemePackageRecord): string {
  if (theme.enabled) return '当前主题'
  if (theme.status === 'failed') return '异常'
  return '未启用'
}

function themeTokenCount(theme: ThemePackageRecord): number {
  return Object.keys(theme.tokens || {}).length
}

function themeConfigFieldOrder([, field]: ThemeConfigFieldEntry): number {
  return typeof field.order === 'number' && Number.isFinite(field.order) ? field.order : 1000
}

function themeConfigGroupName(field: PayIncusThemeConfigField): string {
  return field.group?.trim() || DEFAULT_THEME_CONFIG_GROUP
}

function sortThemeConfigFields(fields: ThemeConfigFieldEntry[]): ThemeConfigFieldEntry[] {
  return fields.sort((left, right) => {
    const leftOrder = themeConfigFieldOrder(left)
    const rightOrder = themeConfigFieldOrder(right)
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return left[0].localeCompare(right[0])
  })
}

function themeConfigFields(theme: ThemePackageRecord): ThemeConfigFieldEntry[] {
  return sortThemeConfigFields(Object.entries(theme.manifest.configSchema || {}))
}

function themeConfigGroups(theme: ThemePackageRecord): ThemeConfigGroup[] {
  const groups = new Map<string, ThemeConfigFieldEntry[]>()
  for (const entry of themeConfigFields(theme)) {
    const groupName = themeConfigGroupName(entry[1])
    const fields = groups.get(groupName) || []
    fields.push(entry)
    groups.set(groupName, fields)
  }
  return Array.from(groups.entries())
    .map(([name, fields]) => ({ name, fields }))
    .sort((left, right) => {
      const leftOrder = themeConfigFieldOrder(left.fields[0])
      const rightOrder = themeConfigFieldOrder(right.fields[0])
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.name.localeCompare(right.name)
    })
}

function themeConfigFieldCount(theme: ThemePackageRecord): number {
  return themeConfigFields(theme).filter(([, field]) => field.type !== 'placeholder').length
}

function isEditingThemeConfig(theme: ThemePackageRecord): boolean {
  return editingThemeConfigId.value === theme.themeId
}

function normalizeThemeConfigDraftValue(value: unknown, fallback: ThemeConfigDraftValue): ThemeConfigDraftValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return fallback
}

function buildThemeConfigDraft(theme: ThemePackageRecord): Record<string, ThemeConfigDraftValue> {
  const draft: Record<string, ThemeConfigDraftValue> = {}
  for (const [key, field] of themeConfigFields(theme)) {
    if (field.type === 'placeholder') continue
    const currentValue = theme.configValues?.[key]
    const fallback: ThemeConfigDraftValue = field.type === 'checkbox'
      ? false
      : field.type === 'tags'
        ? []
        : typeof field.default === 'number' || typeof field.default === 'boolean' || typeof field.default === 'string'
          ? field.default
          : ''
    if (currentValue !== undefined) {
      draft[key] = normalizeThemeConfigDraftValue(currentValue, fallback)
    } else if (field.default !== undefined) {
      draft[key] = normalizeThemeConfigDraftValue(field.default, fallback)
    } else if (field.type === 'checkbox') {
      draft[key] = false
    } else if (field.type === 'tags') {
      draft[key] = []
    } else {
      draft[key] = ''
    }
  }
  return draft
}

function openThemeConfig(theme: ThemePackageRecord) {
  if (isEditingThemeConfig(theme)) {
    editingThemeConfigId.value = null
    themeConfigDraft.value = {}
    return
  }
  editingThemeConfigId.value = theme.themeId
  themeConfigDraft.value = buildThemeConfigDraft(theme)
}

function themeConfigInputType(type: string): string {
  if (type === 'email') return 'email'
  if (type === 'password') return 'password'
  if (type === 'color') return 'color'
  return 'text'
}

function themeTagsValue(key: string): string {
  const value = themeConfigDraft.value[key]
  return Array.isArray(value) ? value.join(', ') : ''
}

function themeStringValue(key: string): string {
  const value = themeConfigDraft.value[key]
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'true' : ''
  return value === undefined ? '' : String(value)
}

function themeNumberValue(key: string): number | string {
  const value = themeConfigDraft.value[key]
  return typeof value === 'number' ? value : ''
}

function themeBooleanValue(key: string): boolean {
  return themeConfigDraft.value[key] === true
}

function onThemeStringInput(key: string, event: Event) {
  themeConfigDraft.value[key] = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    ? event.target.value
    : ''
}

function onThemeSelectChange(key: string, event: Event) {
  themeConfigDraft.value[key] = event.target instanceof HTMLSelectElement ? event.target.value : ''
}

function onThemeNumberInput(key: string, event: Event) {
  const value = event.target instanceof HTMLInputElement ? event.target.value : ''
  themeConfigDraft.value[key] = value === '' ? '' : Number(value)
}

function onThemeCheckboxChange(key: string, event: Event) {
  themeConfigDraft.value[key] = event.target instanceof HTMLInputElement ? event.target.checked : false
}

function updateThemeTagsValue(key: string, value: string) {
  themeConfigDraft.value[key] = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function onThemeTagsInput(key: string, event: Event) {
  updateThemeTagsValue(key, event.target instanceof HTMLInputElement ? event.target.value : '')
}

async function uploadThemeConfigFile(theme: ThemePackageRecord, key: string, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadingThemeConfigFileKey.value = `${theme.themeId}:${key}`
  try {
    const result = await api.themes.uploadConfigFile(theme.themeId, key, file)
    themeConfigDraft.value[key] = result.value
    toast.success('文件已上传，请保存主题配置使其生效')
  } catch (err: any) {
    toast.error('主题配置文件上传失败：' + (err?.response?.data?.error || err?.message || String(err)))
  } finally {
    uploadingThemeConfigFileKey.value = null
    input.value = ''
  }
}

async function saveThemeConfig(theme: ThemePackageRecord) {
  savingThemeConfigId.value = theme.themeId
  try {
    const response = await api.themes.updateConfig(theme.themeId, themeConfigDraft.value)
    themes.value = themes.value.map(item => item.themeId === theme.themeId ? response.theme : item)
    themeConfigDraft.value = buildThemeConfigDraft(response.theme)
    toast.success('主题配置已保存')
  } catch (err: any) {
    toast.error('保存主题配置失败：' + (err?.message || String(err)))
  } finally {
    savingThemeConfigId.value = null
  }
}

function openThemePreview(theme: ThemePackageRecord) {
  window.open(theme.previewUrl, '_blank', 'noopener,noreferrer')
}

function isThemeMarketEntryInstalled(entry: ThemeMarketEntry): boolean {
  return themes.value.some(theme => theme.themeId === entry.id && theme.version === entry.latest)
}

function canInstallThemeMarketEntry(entry: ThemeMarketEntry): boolean {
  return entry.reviewStatus === 'listed' && entry.security.checksumPinned
}

function buildThemeMarketInstallSummary(entry: ThemeMarketEntry): string {
  return [
    `主题：${entry.name} ${entry.latest}`,
    `审核状态：${marketReviewLabels[entry.reviewStatus]}`,
    `可信来源：${marketTrustLabels[entry.trustLevel]}`,
    `开发者：${entry.developer.name}`,
    `兼容：${entry.compatibility.minPayincus || '-'} ~ ${entry.compatibility.maxPayincus || '-'}`,
    `SHA256：${entry.sha256}`,
    `Token：${entry.tokens.length ? entry.tokens.join(', ') : '未声明'}`,
    `布局区块：${entry.layoutSlots.length ? entry.layoutSlots.join(', ') : '未声明'}`
  ].join('\n')
}

async function loadThemeMarket() {
  activeTab.value = 'themes'
  themeMarketLoading.value = true
  try {
    const response = await api.themes.market()
    themeMarket.value = response.themes
    themeMarketGovernance.value = response.governance
    if (themeMarket.value.length === 0) toast.success('主题市场暂无可安装主题')
  } catch (err: any) {
    toast.error('加载主题市场失败：' + (err?.message || String(err)))
  } finally {
    themeMarketLoading.value = false
  }
}

async function refreshThemesTab() {
  await Promise.all([loadThemes(), loadThemeMarket(), loadThemeSubmissions(themeSubmissionStatusFilter.value)])
}

async function loadThemeSubmissions(status: ThemeMarketSubmissionReviewStatus = themeSubmissionStatusFilter.value) {
  activeTab.value = 'themes'
  themeSubmissionsLoading.value = true
  themeSubmissionStatusFilter.value = status
  try {
    const response = await api.themeMarketSubmissions.listForReview({ reviewStatus: status, limit: 100 })
    themeSubmissions.value = response.submissions
  } catch (err: any) {
    toast.error('加载主题投稿失败：' + (err?.message || String(err)))
  } finally {
    themeSubmissionsLoading.value = false
  }
}

async function scanThemeSubmission(submission: ThemeMarketSubmission) {
  scanningThemeSubmissionId.value = submission.id
  try {
    const response = await api.themeMarketSubmissions.scan(submission.id)
    themeSubmissions.value = themeSubmissions.value.map(item => item.id === submission.id ? response.submission : item)
    toast.success(`主题扫描完成：${response.scan.status}/${response.scan.riskLevel}`)
  } catch (err: any) {
    toast.error('扫描主题投稿失败：' + (err?.message || String(err)))
  } finally {
    scanningThemeSubmissionId.value = null
  }
}

async function reviewThemeSubmission(submission: ThemeMarketSubmission, reviewStatus: ThemeMarketSubmissionReviewStatus) {
  const riskLevel = submission.riskLevel || 'medium'
  const reviewNotes = window.prompt(`审核主题 ${submission.themeId}@${submission.version} 为 ${themeSubmissionReviewLabels[reviewStatus]}，请输入备注：`, submission.reviewNotes || '')
  if (reviewNotes === null) return
  try {
    const response = await api.themeMarketSubmissions.review(submission.id, {
      reviewStatus,
      riskLevel,
      reviewNotes
    })
    themeSubmissions.value = themeSubmissions.value.map(item => item.id === submission.id ? response.submission : item)
    toast.success('主题审核已保存')
  } catch (err: any) {
    toast.error('保存主题审核失败：' + (err?.message || String(err)))
  }
}

async function publishThemeMarketIndex() {
  if (!window.confirm('确认发布主题市场目录？只会发布已上架且扫描通过或警告的主题投稿。')) return
  publishingThemeMarketIndex.value = true
  try {
    const response = await api.themeMarketSubmissions.publishMarketIndex()
    toast.success(`主题市场目录已发布：${response.result.publishedEntries}/${response.result.totalEntries}`)
    await loadThemeMarket()
  } catch (err: any) {
    toast.error('发布主题市场目录失败：' + (err?.message || String(err)))
  } finally {
    publishingThemeMarketIndex.value = false
  }
}

function taskStatusText(status: PluginTask['status']): string {
  const labels: Record<PluginTask['status'], string> = {
    pending: '等待中',
    running: '执行中',
    success: '成功',
    failed: '失败'
  }
  return labels[status]
}

function taskActionText(action: PluginTask['action']): string {
  const labels: Record<PluginTask['action'], string> = {
    upload_install: '上传安装',
    market_install: '市场安装',
    enable: '启用',
    disable: '禁用',
    uninstall: '卸载'
  }
  return labels[action]
}

function taskStatusClass(status: PluginTask['status']): string {
  if (status === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'failed') return 'bg-red-50 text-red-700 border-red-200'
  if (status === 'running') return 'bg-blue-50 text-blue-700 border-blue-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function eventResultText(result: string): string {
  if (result === 'retry_pending') return '待重试'
  if (result === 'dead_letter') return '死信'
  if (result === 'duplicate_skipped') return '已去重'
  if (result === 'success') return '成功'
  if (result === 'failed') return '失败'
  return result
}

function eventResultClass(result: string): string {
  if (result === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (result === 'retry_pending') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (result === 'duplicate_skipped') return 'bg-sky-50 text-sky-700 border-sky-200'
  if (result === 'dead_letter' || result === 'failed') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

async function refreshAll() {
  loading.value = true
  try {
    const [pluginResponse, taskResponse, themeResponse] = await Promise.all([
      api.plugins.list(),
      api.plugins.listTasks(),
      api.themes.list()
    ])
    plugins.value = pluginResponse.plugins
    tasks.value = taskResponse.tasks
    themes.value = themeResponse.themes
    if (!selectedPluginId.value && plugins.value.length > 0) selectedPluginId.value = plugins.value[0].pluginId
    if (selectedTaskId.value && !tasks.value.some(task => task.id === selectedTaskId.value)) selectedTaskId.value = null
    if (!selectedTaskId.value && tasks.value.length > 0) selectedTaskId.value = tasks.value[0].id
    ensureSelectedTaskVisible()
  } catch (err: any) {
    toast.error('加载扩展中心失败：' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function loadThemes() {
  activeTab.value = 'themes'
  themesLoading.value = true
  try {
    const response = await api.themes.list()
    themes.value = response.themes
  } catch (err: any) {
    toast.error('加载主题失败：' + (err?.message || String(err)))
  } finally {
    themesLoading.value = false
  }
}

async function loadPluginEvents(result: typeof eventResultFilter.value = eventResultFilter.value) {
  activeTab.value = 'events'
  eventsLoading.value = true
  eventResultFilter.value = result
  try {
    const response = await api.plugins.listEvents({
      result: result === 'all' ? undefined : result,
      pluginId: eventPluginFilter.value === 'all' ? undefined : eventPluginFilter.value,
      eventName: eventNameFilter.value === 'all' ? undefined : eventNameFilter.value,
      handler: eventHandlerFilter.value.trim() || undefined,
      limit: 100
    })
    pluginEvents.value = response.events
    pluginEventSummary.value = response.summary
  } catch (err: any) {
    toast.error('加载事件投递日志失败：' + (err?.message || String(err)))
  } finally {
    eventsLoading.value = false
  }
}

async function retryDueEvents() {
  retryingEvents.value = true
  try {
    const result = await api.plugins.retryDueEvents()
    toast.success(`已处理 ${result.processed} 条，到达成功 ${result.succeeded} 条，死信 ${result.deadLettered} 条`)
    await loadPluginEvents(eventResultFilter.value)
  } catch (err: any) {
    toast.error('处理到期重试失败：' + (err?.message || String(err)))
  } finally {
    retryingEvents.value = false
  }
}

async function replayPluginEvent(event: PluginEventLog) {
  if (!window.confirm(`确认重放事件 #${event.id}？`)) return
  try {
    const response = await api.plugins.replayEvent(event.id)
    toast.success(`重放结果：${eventResultText(response.result.result)}`)
    await loadPluginEvents(eventResultFilter.value)
  } catch (err: any) {
    toast.error('重放事件失败：' + (err?.message || String(err)))
  }
}

function actionRateLimitDefaultDraft(item: PublicPluginActionRateLimitDefault): ActionRateLimitDraft {
  return {
    pluginId: '*',
    actionName: '*',
    rateLimit: item.rateLimit,
    maxRequests: item.maxRequests,
    windowSeconds: item.windowSeconds,
    enabled: true
  }
}

function syncActionRateLimitDrafts(defaults: PublicPluginActionRateLimitDefault[], policies: PublicPluginActionRateLimitPolicy[]) {
  actionRateLimitDefaults.value = defaults
  actionRateLimitPolicies.value = policies
  actionRateLimitDrafts.value = policies.length > 0
    ? policies.map(policy => ({
        pluginId: policy.pluginId,
        actionName: policy.actionName,
        rateLimit: policy.rateLimit,
        maxRequests: policy.maxRequests,
        windowSeconds: policy.windowSeconds,
        enabled: policy.enabled
      }))
    : defaults.map(actionRateLimitDefaultDraft)
}

async function loadActionRateLimits() {
  activeTab.value = 'limits'
  actionRateLimitsLoading.value = true
  try {
    const response = await api.plugins.listActionRateLimits()
    syncActionRateLimitDrafts(response.defaults, response.policies)
  } catch (err: any) {
    toast.error('加载限流策略失败：' + (err?.message || String(err)))
  } finally {
    actionRateLimitsLoading.value = false
  }
}

function addActionRateLimitDraft() {
  actionRateLimitDrafts.value.push({
    pluginId: '*',
    actionName: '*',
    rateLimit: 'normal',
    maxRequests: 30,
    windowSeconds: 60,
    enabled: true
  })
}

function removeActionRateLimitDraft(index: number) {
  actionRateLimitDrafts.value.splice(index, 1)
}

async function saveActionRateLimits() {
  savingActionRateLimits.value = true
  try {
    const response = await api.plugins.updateActionRateLimits(actionRateLimitDrafts.value.map(policy => ({
      pluginId: policy.pluginId.trim() || '*',
      actionName: policy.actionName.trim() || '*',
      rateLimit: policy.rateLimit,
      maxRequests: Number(policy.maxRequests),
      windowSeconds: Number(policy.windowSeconds),
      enabled: policy.enabled
    })))
    syncActionRateLimitDrafts(response.defaults, response.policies)
    toast.success('扩展 action 限流策略已保存')
  } catch (err: any) {
    toast.error('保存限流策略失败：' + (err?.message || String(err)))
  } finally {
    savingActionRateLimits.value = false
  }
}

async function loadMarket() {
  activeTab.value = 'market'
  marketLoading.value = true
  try {
    const response = await api.plugins.market()
    market.value = response.plugins
    marketGovernance.value = response.governance || null
    if (market.value.length === 0) toast.success('扩展市场暂无可安装扩展')
  } catch (err: any) {
    toast.error('加载扩展市场失败：' + (err?.message || String(err)))
  } finally {
    marketLoading.value = false
  }
}

async function loadSubmissions(status: PluginMarketSubmissionReviewStatus = submissionStatusFilter.value) {
  activeTab.value = 'submissions'
  submissionsLoading.value = true
  submissionStatusFilter.value = status
  try {
    const response = await api.pluginMarketSubmissions.listForReview({
      reviewStatus: status,
      limit: 100
    })
    submissions.value = response.submissions
  } catch (err: any) {
    toast.error('加载投稿审核队列失败：' + (err?.message || String(err)))
  } finally {
    submissionsLoading.value = false
  }
}

async function reviewSubmission(
  submission: PluginMarketSubmission,
  reviewStatus: PluginMarketSubmissionReviewStatus,
  riskLevel: PluginMarketSubmission['riskLevel'] = submission.riskLevel
) {
  const defaultNote = reviewStatus === 'listed'
    ? 'Manifest、SHA256、来源和权限说明已审核。'
    : reviewStatus === 'rejected'
      ? '不符合当前扩展市场审核要求。'
      : '按运营或安全要求下架。'
  const reviewNotes = window.prompt(`审核 ${submission.pluginId}@${submission.version}`, defaultNote)
  if (reviewNotes === null) return
  try {
    await api.pluginMarketSubmissions.review(submission.id, {
      reviewStatus,
      riskLevel,
      reviewNotes
    })
    toast.success('投稿审核状态已更新')
    await loadSubmissions(submissionStatusFilter.value)
  } catch (err: any) {
    toast.error('审核提交失败：' + (err?.message || String(err)))
  }
}

async function scanSubmission(submission: PluginMarketSubmission) {
  scanningSubmissionId.value = submission.id
  try {
    await api.pluginMarketSubmissions.scan(submission.id)
    toast.success('投稿扫描完成')
    await loadSubmissions(submissionStatusFilter.value)
  } catch (err: any) {
    toast.error('投稿扫描失败：' + (err?.message || String(err)))
  } finally {
    scanningSubmissionId.value = null
  }
}

async function publishMarketIndex() {
  publishingMarketIndex.value = true
  try {
    const response = await api.pluginMarketSubmissions.publishMarketIndex()
    toast.success(`市场目录已发布：${response.result.totalEntries} 个条目`)
  } catch (err: any) {
    toast.error('发布市场目录失败：' + (err?.message || String(err)))
  } finally {
    publishingMarketIndex.value = false
  }
}

function selectPlugin(plugin: PluginRecord) {
  selectedPluginId.value = plugin.pluginId
}

async function uploadPlugin() {
  if (!selectedFile.value) return
  uploading.value = true
  try {
    const response = await api.plugins.upload(selectedFile.value)
    toast.success('扩展安装任务已完成')
    selectedFile.value = null
    if (response.task?.id) selectedTaskId.value = response.task.id
    activeTab.value = 'tasks'
    await refreshAll()
    refreshPluginNav()
    await loadSelectedTaskLogs()
  } catch (err: any) {
    toast.error('上传安装失败：' + (err?.message || String(err)))
  } finally {
    uploading.value = false
  }
}

async function uploadTheme() {
  if (!selectedThemeFile.value) return
  themeUploading.value = true
  try {
    await api.themes.upload(selectedThemeFile.value)
    toast.success('主题包已安装')
    selectedThemeFile.value = null
    await loadThemes()
  } catch (err: any) {
    toast.error('主题上传失败：' + (err?.message || String(err)))
  } finally {
    themeUploading.value = false
  }
}

async function installMarketTheme(entry: ThemeMarketEntry) {
  if (!canInstallThemeMarketEntry(entry)) {
    toast.error('该主题未满足市场安装策略，不能安装')
    return
  }
  if (!window.confirm(`确认从主题市场安装？\n\n${buildThemeMarketInstallSummary(entry)}`)) return
  installingThemeMarketId.value = entry.id
  try {
    await api.themes.installMarket(entry.id)
    toast.success('主题已从市场安装')
    await loadThemes()
  } catch (err: any) {
    toast.error('主题市场安装失败：' + (err?.message || String(err)))
  } finally {
    installingThemeMarketId.value = null
  }
}

async function enableTheme(theme: ThemePackageRecord) {
  if (!window.confirm(`确认启用主题 ${theme.name}？当前用户端会加载该主题 CSS。`)) return
  try {
    await api.themes.enable(theme.themeId)
    toast.success('主题已启用')
    await loadThemes()
  } catch (err: any) {
    toast.error('启用主题失败：' + (err?.message || String(err)))
  }
}

async function rollbackDefaultTheme() {
  if (!window.confirm('确认回滚到默认主题？用户端将停止加载第三方主题 CSS。')) return
  try {
    await api.themes.rollbackDefault()
    toast.success('已回滚到默认主题')
    await loadThemes()
  } catch (err: any) {
    toast.error('回滚默认主题失败：' + (err?.message || String(err)))
  }
}

async function uninstallTheme(theme: ThemePackageRecord) {
  if (theme.enabled) {
    toast.error('当前启用主题需要先回滚默认主题后才能卸载')
    return
  }
  if (!window.confirm(`确认卸载主题 ${theme.name}？`)) return
  try {
    await api.themes.uninstall(theme.themeId)
    toast.success('主题已卸载')
    await loadThemes()
  } catch (err: any) {
    toast.error('卸载主题失败：' + (err?.message || String(err)))
  }
}

async function installMarketPlugin(entry: PluginMarketEntry) {
  if (!canInstallMarketEntry(entry)) {
    toast.error('该扩展未满足市场安装策略，不能安装')
    return
  }
  if (!window.confirm(buildMarketInstallConfirmation(entry))) return
  try {
    const response = await api.plugins.installFromMarket(entry.id)
    toast.success('市场扩展安装完成')
    if (response.task?.id) selectedTaskId.value = response.task.id
    activeTab.value = 'tasks'
    await refreshAll()
    refreshPluginNav()
    await loadSelectedTaskLogs()
  } catch (err: any) {
    toast.error('市场安装失败：' + (err?.message || String(err)))
  }
}

async function togglePlugin(plugin: PluginRecord) {
  try {
    if (plugin.enabled) {
      await api.plugins.disable(plugin.pluginId)
      toast.success('扩展已禁用')
    } else {
      await api.plugins.enable(plugin.pluginId)
      toast.success('扩展已启用')
    }
    await refreshAll()
    refreshPluginNav()
  } catch (err: any) {
    toast.error('扩展状态更新失败：' + (err?.message || String(err)))
  }
}

async function uninstallSelectedPlugin() {
  if (!selectedPlugin.value) return
  if (!window.confirm(`确认卸载 ${selectedPlugin.value.name}？卸载后静态资源将不可访问。`)) return
  try {
    await api.plugins.uninstall(selectedPlugin.value.pluginId)
    toast.success('扩展已卸载')
    selectedPluginId.value = null
    await refreshAll()
    refreshPluginNav()
  } catch (err: any) {
    toast.error('卸载失败：' + (err?.message || String(err)))
  }
}

async function selectTask(task: PluginTask) {
  selectedTaskId.value = task.id
  activateTab('tasks')
  ensureSelectedTaskVisible()
  await loadSelectedTaskLogs()
}

async function loadSelectedTaskLogs() {
  if (!selectedTaskId.value) {
    taskLogs.value = ''
    return
  }
  taskLogsLoading.value = true
  try {
    const response = await api.plugins.getTaskLogs(selectedTaskId.value)
    taskLogs.value = response.logs
  } catch {
    taskLogs.value = ''
  } finally {
    taskLogsLoading.value = false
  }
}

function setTaskPage(page: number) {
  taskPage.value = Math.min(Math.max(page, 1), totalTaskPages.value)
}

function ensureSelectedTaskVisible() {
  if (!selectedTaskId.value) {
    setTaskPage(taskPage.value)
    return
  }
  const index = tasks.value.findIndex(task => task.id === selectedTaskId.value)
  if (index >= 0) {
    taskPage.value = Math.floor(index / TASKS_PER_PAGE) + 1
  } else {
    setTaskPage(taskPage.value)
  }
}

function activateTab(tab: PluginCenterTab): void {
  activeTab.value = tab
  if (route.query.tab !== tab) {
    void router.replace({
      query: {
        ...route.query,
        tab: tab === 'installed' ? undefined : tab
      }
    })
  }
}

function openMarketTab() {
  activateTab('market')
  if (market.value.length === 0 && !marketLoading.value) {
    void loadMarket()
  }
}

function openTasksTab() {
  activateTab('tasks')
  void loadSelectedTaskLogs()
}

function openSubmissionsTab() {
  activateTab('submissions')
  if (submissions.value.length === 0 && !submissionsLoading.value) {
    void loadSubmissions()
  }
}

function openThemesTab() {
  activateTab('themes')
  if (themes.value.length === 0 && !themesLoading.value) void loadThemes()
  if (themeMarket.value.length === 0 && !themeMarketLoading.value) void loadThemeMarket()
  if (themeSubmissions.value.length === 0 && !themeSubmissionsLoading.value) void loadThemeSubmissions()
}

function openEventsTab() {
  activateTab('events')
  if (pluginEvents.value.length === 0 && !eventsLoading.value) {
    void loadPluginEvents()
  }
}

function openActionRateLimitsTab() {
  activateTab('limits')
  if (actionRateLimitDrafts.value.length === 0 && !actionRateLimitsLoading.value) {
    void loadActionRateLimits()
  }
}

function setActiveTab(tab: typeof activeTab.value) {
  if (tab === 'market') {
    openMarketTab()
    return
  }
  if (tab === 'submissions') {
    openSubmissionsTab()
    return
  }
  if (tab === 'tasks') {
    openTasksTab()
    return
  }
  if (tab === 'themes') {
    openThemesTab()
    return
  }
  if (tab === 'events') {
    openEventsTab()
    return
  }
  if (tab === 'limits') {
    openActionRateLimitsTab()
    return
  }
  activateTab(tab)
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] || null
}

function onThemeFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedThemeFile.value = input.files?.[0] || null
}

onMounted(async () => {
  await refreshAll()
  if (activeTab.value !== 'installed') {
    setActiveTab(activeTab.value)
  }
})

watch(selectedPluginId, pluginId => {
  if (pluginId) {
    void loadPluginStorageUsage(pluginId)
    void loadPluginStorageBackupArchives(pluginId)
  } else {
    pluginStorageUsage.value = null
    pluginStorageBackupArchives.value = []
    pluginStorageUsageError.value = ''
  }
})

watch(() => route.query.tab, tab => {
  const normalized = normalizePluginCenterTab(tab)
  if (normalized !== activeTab.value) {
    setActiveTab(normalized)
  }
})
</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-themed">扩展中心</h1>
        <p class="mt-1 text-sm text-themed-muted">上传、安装、启用和管理 PayIncus 扩展。扩展通过受控扩展点接入后台和用户端。</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="refreshAll">刷新</button>
        <button
          v-if="activeTab === 'market'"
          class="btn-primary"
          :disabled="marketLoading"
          @click="loadMarket"
        >
          {{ marketLoading ? '加载中...' : '刷新市场' }}
        </button>
        <button
          v-else-if="activeTab === 'submissions'"
          class="btn-primary"
          :disabled="submissionsLoading"
          @click="loadSubmissions(submissionStatusFilter)"
        >
          {{ submissionsLoading ? '加载中...' : '刷新审核' }}
        </button>
        <button
          v-else-if="activeTab === 'themes'"
          class="btn-primary"
          :disabled="themesLoading || themeMarketLoading"
          @click="refreshThemesTab"
        >
          {{ themesLoading || themeMarketLoading ? '加载中...' : '刷新主题' }}
        </button>
        <button
          v-else-if="activeTab === 'tasks'"
          class="btn-primary"
          :disabled="!selectedTask || taskLogsLoading"
          @click="loadSelectedTaskLogs"
        >
          {{ taskLogsLoading ? '加载中...' : '刷新日志' }}
        </button>
        <button
          v-else-if="activeTab === 'events'"
          class="btn-primary"
          :disabled="eventsLoading"
          @click="loadPluginEvents(eventResultFilter)"
        >
          {{ eventsLoading ? '加载中...' : '刷新事件' }}
        </button>
        <button
          v-else-if="activeTab === 'limits'"
          class="btn-primary"
          :disabled="actionRateLimitsLoading"
          @click="loadActionRateLimits"
        >
          {{ actionRateLimitsLoading ? '加载中...' : '刷新策略' }}
        </button>
      </div>
    </div>

    <ThemeTemplateSlot slot-name="admin.extensions.header" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />

    <div class="grid gap-4 md:grid-cols-6">
      <div class="card p-4">
        <div class="text-sm text-themed-muted">已安装</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.installed }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">已启用</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.enabled }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">异常</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.failed }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">市场扩展</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.market }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">待审投稿</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ submissionSummary.pending }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">主题</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.themes }}</div>
      </div>
    </div>

    <div v-if="loading" class="py-16 text-center text-themed-muted">加载中...</div>

    <template v-else>
      <div class="sticky top-0 z-10 overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-col gap-4 border-b border-themed px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-themed">{{ activeTabMeta.label }}</h2>
            <p class="mt-1 text-sm text-themed-muted">{{ activeTabMeta.description }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="rounded border px-3 py-2 text-sm font-medium transition"
              :class="activeTab === tab.key ? 'border-accent bg-accent text-white' : 'border-themed text-themed-muted hover:bg-themed-hover hover:text-themed'"
              @click="setActiveTab(tab.key)"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
      </div>

      <section v-if="activeTab === 'installed'" class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div class="rounded-lg border border-themed bg-themed-surface p-5">
          <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h2 class="text-lg font-semibold text-themed">已安装扩展</h2>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="file" accept=".tar.gz" class="max-w-full text-sm" @change="onFileChange" />
              <button class="btn-primary" :disabled="!selectedFile || uploading" @click="uploadPlugin">{{ uploading ? '安装中...' : '上传安装' }}</button>
            </div>
          </div>
          <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="text-left text-themed-muted">
                <tr>
                  <th class="py-2 pr-4">扩展</th>
                  <th class="py-2 pr-4">版本</th>
                  <th class="py-2 pr-4">来源</th>
                  <th class="py-2 pr-4">状态</th>
                  <th class="py-2 pr-4">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="plugin in plugins" :key="plugin.pluginId" class="border-t border-themed">
                  <td class="py-3 pr-4">
                    <button class="text-left font-medium text-themed hover:underline" @click="selectPlugin(plugin)">{{ displayPluginName(plugin) }}</button>
                    <div class="font-mono text-xs text-themed-muted">{{ plugin.pluginId }}</div>
                  </td>
                  <td class="py-3 pr-4 text-themed">{{ plugin.currentVersion || '-' }}</td>
                  <td class="py-3 pr-4 text-themed">{{ plugin.sourceType === 'market' ? '市场' : '上传' }}</td>
                  <td class="py-3 pr-4">
                    <span class="rounded border px-2 py-1 text-xs" :class="statusClass(plugin)">{{ statusText(plugin) }}</span>
                  </td>
                  <td class="py-3 pr-4">
                    <button class="btn-secondary mr-2" @click="togglePlugin(plugin)">{{ plugin.enabled ? '禁用' : '启用' }}</button>
                    <button
                      v-if="plugin.enabled && hasAdminSettingsPage(plugin)"
                      class="btn-secondary mr-2"
                      @click="openPluginSettings(plugin)"
                    >
                      设置
                    </button>
                    <button class="btn-secondary" @click="selectPlugin(plugin)">详情</button>
                  </td>
                </tr>
                <tr v-if="plugins.length === 0">
                  <td colspan="5" class="py-8 text-center text-themed-muted">暂无扩展</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <aside class="rounded-lg border border-themed bg-themed-surface p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold text-themed">扩展详情</h2>
              <p class="mt-1 text-sm text-themed-muted">{{ selectedPlugin?.pluginId || '未选择扩展' }}</p>
            </div>
            <button v-if="selectedPlugin" class="btn-secondary" @click="uninstallSelectedPlugin">卸载</button>
          </div>

          <template v-if="selectedPlugin?.latestVersion">
            <dl class="mt-4 space-y-3 text-sm">
              <div>
                <dt class="text-themed-muted">描述</dt>
                <dd class="text-themed">{{ displayPluginDescription(selectedPlugin) }}</dd>
              </div>
              <div>
                <dt class="text-themed-muted">权限</dt>
                <dd class="space-y-1 text-themed">
                  <div v-for="permission in selectedPlugin.latestVersion.manifest.permissions || []" :key="permission">
                    {{ formatPermission(permission) }}
                  </div>
                  <span v-if="!(selectedPlugin.latestVersion.manifest.permissions || []).length">无</span>
                </dd>
              </div>
              <div>
                <dt class="text-themed-muted">客户端影响</dt>
                <dd class="space-y-1 text-themed">
                  <div v-for="page in selectedPlugin.latestVersion.manifest.entrypoints.userPages || []" :key="page.slot">
                    {{ page.slot }} · {{ page.title }}
                  </div>
                  <span v-if="!(selectedPlugin.latestVersion.manifest.entrypoints.userPages || []).length">无</span>
                </dd>
              </div>
            </dl>

            <div class="mt-5 rounded border border-themed bg-themed p-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-sm font-medium text-themed">存储用量</h3>
                  <p class="mt-1 text-xs text-themed-muted">后台只读统计，不展示 key/value 或业务对象 ID。</p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <button class="btn-secondary btn-sm" :disabled="!selectedPluginId" @click="exportPluginStorageBackup()">导出备份</button>
                  <button
                    class="btn-secondary btn-sm"
                    :disabled="!selectedPluginId || pluginStorageBackupArchiveActionId === 'create'"
                    @click="createPluginStorageBackupArchive()"
                  >
                    {{ pluginStorageBackupArchiveActionId === 'create' ? '创建中...' : '创建归档' }}
                  </button>
                  <label class="btn-secondary btn-sm cursor-pointer">
                    恢复备份
                    <input class="hidden" type="file" accept="application/json,.json" @change="onPluginStorageBackupSelected" />
                  </label>
                  <span
                    v-if="pluginStorageUsage"
                    class="rounded border border-themed px-2 py-0.5 text-xs text-themed-muted"
                  >
                    {{ pluginStorageUsage.retention === 'keep' ? '卸载保留' : '卸载清理' }}
                  </span>
                </div>
              </div>

              <div v-if="pluginStorageUsageLoading" class="mt-4 text-sm text-themed-muted">正在加载存储用量...</div>
              <div v-else-if="pluginStorageUsageError" class="mt-4 text-sm text-red-600">{{ pluginStorageUsageError }}</div>
              <div v-else-if="pluginStorageUsage" class="mt-4 space-y-4">
                <div class="grid grid-cols-3 gap-2 text-center text-xs">
                  <div class="rounded border border-themed bg-themed-surface p-2">
                    <div class="text-themed-muted">KV keys</div>
                    <div class="mt-1 text-base font-semibold text-themed">{{ pluginStorageUsage.totals.kvKeys + pluginStorageUsage.legacyUserKeyCount }}</div>
                  </div>
                  <div class="rounded border border-themed bg-themed-surface p-2">
                    <div class="text-themed-muted">表行</div>
                    <div class="mt-1 text-base font-semibold text-themed">{{ pluginStorageUsage.totals.tableRows }}</div>
                  </div>
                  <div class="rounded border border-themed bg-themed-surface p-2">
                    <div class="text-themed-muted">迁移</div>
                    <div class="mt-1 text-base font-semibold text-themed">{{ pluginStorageUsage.totals.tableMigrations }}</div>
                  </div>
                </div>

                <div v-if="pluginStorageUsage.warnings.length" class="space-y-2 text-xs">
                  <div
                    v-for="warning in pluginStorageUsage.warnings"
                    :key="`${warning.kind}:${warning.label}`"
                    class="rounded border px-3 py-2"
                    :class="storageWarningClass(warning.level)"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <span class="font-medium">{{ warning.label }}</span>
                      <span>{{ formatStorageUsageRatio(warning.usageRatio) }}</span>
                    </div>
                    <div class="mt-1">
                      {{ warning.count }} / {{ warning.limit }} · {{ warning.message }}
                    </div>
                  </div>
                </div>

                <div class="space-y-2 text-xs">
                  <div
                    v-for="row in selectedPluginStorageRows"
                    :key="row.key"
                    class="flex items-center justify-between gap-3 rounded border border-themed bg-themed-surface px-3 py-2"
                  >
                    <div class="min-w-0">
                      <div class="truncate font-medium text-themed">{{ row.label }}</div>
                      <div class="text-themed-muted">{{ row.declared ? 'manifest 已声明' : '历史遗留数据' }}</div>
                    </div>
                    <div class="shrink-0 text-right text-themed">
                      {{ row.count }} / {{ formatStorageLimit(row.limit) }}
                    </div>
                  </div>
                  <div v-if="pluginStorageUsage.legacyUserKeyCount" class="rounded border border-themed bg-themed-surface px-3 py-2 text-themed-muted">
                    旧版用户 KV：{{ pluginStorageUsage.legacyUserKeyCount }} 个 key
                  </div>
                  <div v-if="selectedPluginStorageRows.length === 0 && !pluginStorageUsage.legacyUserKeyCount" class="text-themed-muted">
                    暂无扩展存储数据。
                  </div>
                </div>

                <div class="space-y-2 border-t border-themed pt-4 text-xs">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="font-medium text-themed">归档备份</div>
                      <div class="mt-1 text-themed-muted">保存在服务器 `PLUGIN_DATA_DIR`，用于恢复演练和运维保留。</div>
                    </div>
                    <button class="btn-secondary btn-sm" :disabled="pluginStorageBackupArchivesLoading" @click="loadPluginStorageBackupArchives()">
                      {{ pluginStorageBackupArchivesLoading ? '加载中...' : '刷新' }}
                    </button>
                  </div>
                  <div v-if="pluginStorageBackupArchivesLoading" class="text-themed-muted">正在加载归档...</div>
                  <div v-else-if="pluginStorageBackupArchives.length === 0" class="text-themed-muted">暂无归档备份。</div>
                  <template v-else>
                    <div
                      v-for="archive in pluginStorageBackupArchives"
                      :key="archive.backupId"
                      class="rounded border border-themed bg-themed-surface px-3 py-2"
                    >
                      <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div class="min-w-0">
                          <div class="truncate font-medium text-themed">{{ archive.backupId }}</div>
                          <div class="mt-1 text-themed-muted">
                            {{ formatDate(archive.exportedAt) }} · {{ archive.pluginVersion }} · {{ archive.counts.totalItems }} 项
                          </div>
                          <div class="mt-1 truncate text-themed-muted">sha256 {{ archive.contentSha256 }}</div>
                          <div v-if="archive.remoteArchives?.length" class="mt-2 space-y-1">
                            <div
                              v-for="remoteArchive in archive.remoteArchives"
                              :key="remoteArchive.id"
                              class="flex flex-col gap-2 rounded border border-themed px-2 py-1 text-[11px] lg:flex-row lg:items-center lg:justify-between"
                            >
                              <div class="min-w-0">
                                <div class="truncate text-themed">
                                  远端 {{ remoteArchive.storageName }} / {{ remoteArchive.storageType }} · {{ remoteArchive.remoteFileName }}
                                </div>
                                <div class="truncate text-themed-muted">
                                  上传 {{ formatDate(remoteArchive.createdAt) }} · {{ remoteArchive.fileSize }} bytes
                                  <span v-if="remoteArchive.lastRestoredAt"> · 最近恢复 {{ formatDate(remoteArchive.lastRestoredAt) }}</span>
                                </div>
                              </div>
                              <div class="flex shrink-0 flex-wrap items-center gap-1">
                                <button class="btn-secondary btn-xs" :disabled="pluginStorageBackupArchiveActionId === `remote-validate:${remoteArchive.id}`" @click="validatePluginStorageRemoteBackupArchiveRestore(archive, remoteArchive)">远端演练</button>
                                <button class="btn-secondary btn-xs" :disabled="pluginStorageBackupArchiveActionId === `remote-restore:${remoteArchive.id}`" @click="restorePluginStorageRemoteBackupArchive(archive, remoteArchive)">远端恢复</button>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div class="flex shrink-0 flex-wrap items-center gap-2">
                          <button class="btn-secondary btn-sm" :disabled="pluginStorageBackupArchiveActionId === archive.backupId" @click="downloadPluginStorageBackupArchive(archive)">下载</button>
                          <button class="btn-secondary btn-sm" :disabled="pluginStorageBackupArchiveActionId === archive.backupId" @click="validatePluginStorageBackupArchiveRestore(archive)">演练</button>
                          <button class="btn-secondary btn-sm" :disabled="pluginStorageBackupArchiveActionId === archive.backupId" @click="restorePluginStorageBackupArchive(archive)">恢复</button>
                          <button class="btn-secondary btn-sm" :disabled="pluginStorageBackupArchiveActionId === `remote-upload:${archive.backupId}`" @click="uploadPluginStorageBackupArchiveRemote(archive)">上传远端</button>
                          <button class="btn-danger btn-sm" :disabled="pluginStorageBackupArchiveActionId === archive.backupId" @click="deletePluginStorageBackupArchive(archive)">删除</button>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
              <div v-else class="mt-4 text-sm text-themed-muted">选择扩展后显示存储用量。</div>
            </div>

            <div v-if="selectedPlugin.enabled && hasAdminSettingsPage(selectedPlugin)" class="mt-5 rounded border border-themed bg-themed p-4">
              <h3 class="text-sm font-medium text-themed">扩展设置</h3>
              <p class="mt-2 text-sm leading-6 text-themed-muted">
                该扩展的设置入口会显示在左侧菜单中，也可以从这里打开独立设置页。
              </p>
              <button class="btn-primary mt-3" @click="openPluginSettings(selectedPlugin)">打开设置</button>
            </div>
            <div v-else-if="selectedPlugin.enabled" class="mt-5 rounded border border-themed bg-themed p-4 text-sm text-themed-muted">
              该扩展未声明后台设置页。
            </div>
            <div v-else class="mt-5 rounded border border-themed bg-themed p-4 text-sm text-themed-muted">
              启用扩展后，声明了后台设置页的扩展会出现在左侧菜单。
            </div>
          </template>
        </aside>
      </section>

      <section v-else-if="activeTab === 'market'" class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-themed">扩展市场</h2>
            <p class="mt-1 text-sm text-themed-muted">仅展示已上架扩展；安装前会校验受信下载源、SHA256 和 PayIncus 兼容范围。</p>
          </div>
          <button class="btn-primary" :disabled="marketLoading" @click="loadMarket">{{ marketLoading ? '加载中...' : '刷新市场' }}</button>
        </div>

        <div class="border-b border-themed px-5 py-4">
          <ThemeTemplateSlot slot-name="admin.extensions.market.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed" />
        </div>

        <div class="grid gap-3 border-b border-themed px-5 py-4 text-sm md:grid-cols-4">
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">已上架</div>
            <div class="mt-1 font-semibold text-themed">{{ marketGovernance?.visibleEntries ?? market.length }} 个</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">已隐藏</div>
            <div class="mt-1 font-semibold text-themed">{{ marketGovernance?.hiddenEntries ?? 0 }} 个</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">索引来源</div>
            <div class="mt-1 truncate font-semibold text-themed">{{ marketGovernance?.indexHost || '-' }}</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">索引指纹</div>
            <div class="mt-1 truncate font-mono text-xs font-semibold text-themed">{{ marketGovernance?.fingerprint?.slice(0, 16) || '-' }}</div>
          </div>
        </div>

        <div v-if="market.length === 0" class="px-5 py-16 text-center">
          <div class="mx-auto max-w-md">
            <h3 class="text-base font-semibold text-themed">暂无市场扩展</h3>
            <p class="mt-2 text-sm leading-6 text-themed-muted">请确认已配置扩展市场索引地址，然后刷新市场读取受信扩展包。</p>
            <button class="btn-secondary mt-4" :disabled="marketLoading" @click="loadMarket">{{ marketLoading ? '加载中...' : '刷新市场' }}</button>
          </div>
        </div>
        <div v-else class="grid gap-4 p-5 xl:grid-cols-2">
          <article v-for="entry in market" :key="entry.id" class="flex min-h-[420px] flex-col rounded border border-themed bg-themed p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="font-medium text-themed">{{ entry.name }}</h3>
                <p class="mt-1 truncate font-mono text-xs text-themed-muted">{{ entry.id }}</p>
              </div>
              <span class="rounded border border-themed px-2 py-1 text-xs text-themed-muted">{{ entry.latest }}</span>
            </div>

            <div class="mt-3 flex flex-wrap gap-2">
              <span class="rounded border px-2 py-1 text-xs" :class="reviewBadgeClass(entry)">{{ marketReviewLabels[entry.reviewStatus] }}</span>
              <span class="rounded border px-2 py-1 text-xs" :class="marketBadgeClass(entry)">{{ marketTrustLabels[entry.trustLevel] }}</span>
              <span class="rounded border border-themed px-2 py-1 text-xs text-themed-muted">{{ marketPricingLabels[entry.pricing.type] }}</span>
              <span class="rounded border border-themed px-2 py-1 text-xs text-themed-muted">{{ formatRating(entry) }}</span>
              <span class="rounded border border-themed px-2 py-1 text-xs text-themed-muted">安装 {{ entry.installCount }}</span>
            </div>

            <p class="mt-3 line-clamp-2 min-h-[48px] text-sm leading-6 text-themed-muted">{{ entry.description || entry.repo }}</p>
            <dl class="mt-4 grid gap-3 text-xs text-themed-muted sm:grid-cols-2">
              <div>
                <dt>开发者</dt>
                <dd class="mt-1 text-themed">{{ entry.developer.name }}{{ entry.developer.verified ? ' · 已认证' : '' }}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd class="mt-1 truncate text-themed">{{ entry.repo }}</dd>
              </div>
              <div>
                <dt>兼容范围</dt>
                <dd class="mt-1 text-themed">{{ formatCompatibility(entry) }}</dd>
              </div>
              <div>
                <dt>签名状态</dt>
                <dd class="mt-1 text-themed">{{ entry.security.signature?.status || 'unsigned' }}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt>SHA256</dt>
                <dd class="mt-1 font-mono text-themed">{{ entry.sha256.slice(0, 16) }}...</dd>
              </div>
              <div class="sm:col-span-2">
                <dt>权限声明</dt>
                <dd class="mt-1 flex flex-wrap gap-1 text-themed">
                  <span
                    v-for="permission in entry.permissions.api"
                    :key="`api-${permission}`"
                    class="rounded bg-themed-hover px-2 py-1 text-xs"
                  >
                    {{ formatMarketPermission(permission) }}
                  </span>
                  <span
                    v-for="page in entry.permissions.adminPages"
                    :key="`admin-${page}`"
                    class="rounded bg-themed-hover px-2 py-1 text-xs"
                  >
                    后台 {{ page }}
                  </span>
                  <span
                    v-for="page in entry.permissions.userPages"
                    :key="`user-${page}`"
                    class="rounded bg-themed-hover px-2 py-1 text-xs"
                  >
                    用户端 {{ page }}
                  </span>
                  <span
                    v-for="path in entry.permissions.storage"
                    :key="`storage-${path}`"
                    class="rounded bg-themed-hover px-2 py-1 text-xs"
                  >
                    存储 {{ path }}
                  </span>
                  <span v-if="!entry.permissions.api.length && !entry.permissions.adminPages.length && !entry.permissions.userPages.length && !entry.permissions.storage.length">无</span>
                </dd>
              </div>
              <div v-if="entry.upgradeNotes || entry.rollbackNotes" class="sm:col-span-2">
                <dt>升级与回滚</dt>
                <dd class="mt-1 space-y-1 text-themed">
                  <p v-if="entry.upgradeNotes">{{ entry.upgradeNotes }}</p>
                  <p v-if="entry.rollbackNotes">{{ entry.rollbackNotes }}</p>
                </dd>
              </div>
            </dl>
            <button class="btn-primary mt-auto w-full" :disabled="!canInstallMarketEntry(entry)" @click="installMarketPlugin(entry)">
              {{ canInstallMarketEntry(entry) ? '安装' : '不可安装' }}
            </button>
          </article>
        </div>
      </section>

      <section v-else-if="activeTab === 'submissions'" class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-themed">投稿审核</h2>
            <p class="mt-1 text-sm text-themed-muted">审核第三方扩展的来源、SHA256、权限、兼容范围和风险等级。通过后仍需要发布到文档站市场目录。</p>
          </div>
          <div class="flex flex-col gap-2 sm:items-end">
            <button class="btn-primary" :disabled="publishingMarketIndex" @click="publishMarketIndex">
              {{ publishingMarketIndex ? '发布中...' : '发布市场目录' }}
            </button>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="status in (['pending', 'listed', 'rejected', 'delisted'] as const)"
                :key="status"
                class="rounded border px-3 py-2 text-sm font-medium transition"
                :class="submissionStatusFilter === status ? 'border-gray-900 bg-gray-900 text-white' : 'border-themed text-themed-muted hover:bg-themed-hover hover:text-themed'"
                @click="loadSubmissions(status)"
              >
                {{ submissionReviewLabels[status] }}
              </button>
            </div>
          </div>
        </div>

        <div class="grid gap-3 border-b border-themed px-5 py-4 text-sm md:grid-cols-3">
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">当前列表</div>
            <div class="mt-1 font-semibold text-themed">{{ submissionSummary.total }} 条</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">待审核</div>
            <div class="mt-1 font-semibold text-themed">{{ submissionSummary.pending }} 条</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">高风险</div>
            <div class="mt-1 font-semibold text-themed">{{ submissionSummary.highRisk }} 条</div>
          </div>
        </div>

        <div v-if="submissionsLoading" class="px-5 py-16 text-center text-themed-muted">加载中...</div>
        <div v-else-if="submissions.length === 0" class="px-5 py-16 text-center text-sm text-themed-muted">当前状态下暂无投稿。</div>
        <div v-else class="divide-y divide-themed">
          <article v-for="submission in submissions" :key="submission.id" class="px-5 py-5">
            <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="font-medium text-themed">{{ submission.name }}</h3>
                  <span class="rounded border px-2 py-1 text-xs" :class="submissionReviewClass(submission.reviewStatus)">
                    {{ submissionReviewLabels[submission.reviewStatus] }}
                  </span>
                  <span class="rounded border px-2 py-1 text-xs" :class="submissionRiskClass(submission.riskLevel)">
                    {{ submissionRiskLabels[submission.riskLevel] }}
                  </span>
                  <span class="rounded border px-2 py-1 text-xs" :class="submissionScanClass(submission.scanStatus)">
                    {{ submissionScanLabels[submission.scanStatus] }}
                  </span>
                </div>
                <p class="mt-1 font-mono text-xs text-themed-muted">{{ submission.pluginId }}@{{ submission.version }}</p>
                <p class="mt-2 text-sm text-themed-muted">
                  {{ submission.developerName }} · {{ submission.contactEmail }} · 提交人 {{ submission.submittedByUsername || submission.submittedByUserId }}
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button class="btn-secondary" :disabled="scanningSubmissionId === submission.id" @click="scanSubmission(submission)">
                  {{ scanningSubmissionId === submission.id ? '扫描中...' : '扫描' }}
                </button>
                <button class="btn-secondary" @click="reviewSubmission(submission, 'listed', submission.riskLevel)">通过</button>
                <button class="btn-secondary" @click="reviewSubmission(submission, 'rejected', 'high')">拒绝</button>
                <button class="btn-secondary" @click="reviewSubmission(submission, 'delisted', 'high')">下架</button>
              </div>
            </div>

            <dl class="mt-4 grid gap-3 text-xs text-themed-muted md:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt>仓库</dt>
                <dd class="mt-1 truncate text-themed">
                  <a :href="submission.repoUrl" target="_blank" rel="noopener noreferrer" class="hover:underline">{{ submission.repoUrl }}</a>
                </dd>
              </div>
              <div>
                <dt>Release</dt>
                <dd class="mt-1 truncate text-themed">
                  <a :href="submission.releaseUrl" target="_blank" rel="noopener noreferrer" class="hover:underline">{{ submission.releaseUrl }}</a>
                </dd>
              </div>
              <div>
                <dt>Manifest</dt>
                <dd class="mt-1 truncate text-themed">
                  <a :href="submission.manifestUrl" target="_blank" rel="noopener noreferrer" class="hover:underline">{{ submission.manifestUrl }}</a>
                </dd>
              </div>
              <div>
                <dt>下载包</dt>
                <dd class="mt-1 truncate text-themed">
                  <a :href="submission.packageUrl" target="_blank" rel="noopener noreferrer" class="hover:underline">{{ submission.packageUrl }}</a>
                </dd>
              </div>
              <div class="md:col-span-2">
                <dt>SHA256</dt>
                <dd class="mt-1 break-all font-mono text-themed">{{ submission.sha256 }}</dd>
              </div>
              <div>
                <dt>兼容</dt>
                <dd class="mt-1 font-mono text-themed">{{ JSON.stringify(submission.compatibility) }}</dd>
              </div>
              <div>
                <dt>权限</dt>
                <dd class="mt-1 font-mono text-themed">{{ JSON.stringify(submission.permissions) }}</dd>
              </div>
              <div v-if="submission.reviewNotes" class="md:col-span-2 xl:col-span-4">
                <dt>审核备注</dt>
                <dd class="mt-1 text-themed">{{ submission.reviewNotes }}</dd>
              </div>
              <div v-if="submission.scannedAt" class="md:col-span-2 xl:col-span-4">
                <dt>扫描结果</dt>
                <dd class="mt-2 space-y-2">
                  <div class="text-themed">扫描时间：{{ formatDate(submission.scannedAt) }}</div>
                  <div v-if="submissionScanFindings(submission).length === 0" class="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">
                    未发现阻断项。
                  </div>
                  <div
                    v-for="finding in submissionScanFindings(submission)"
                    :key="`${submission.id}-${finding.code}-${finding.message}`"
                    class="rounded border border-themed bg-themed-hover p-2 text-themed"
                  >
                    <span class="font-mono text-[11px] uppercase text-themed-muted">{{ finding.severity }} · {{ finding.code }}</span>
                    <p class="mt-1">{{ finding.message }}</p>
                  </div>
                </dd>
              </div>
            </dl>
          </article>
        </div>
      </section>

      <section v-else-if="activeTab === 'themes'" class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-col gap-4 border-b border-themed px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-themed">主题系统</h2>
            <p class="mt-1 text-sm text-themed-muted">主题包只允许 CSS、设计 token 和本地静态资源；启用后用户端会加载当前主题 CSS。</p>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="file" accept=".tar.gz" class="max-w-full text-sm" @change="onThemeFileChange" />
            <button class="btn-primary" :disabled="!selectedThemeFile || themeUploading" @click="uploadTheme">{{ themeUploading ? '安装中...' : '上传主题' }}</button>
            <button class="btn-secondary" :disabled="!themes.some(theme => theme.enabled)" @click="rollbackDefaultTheme">回滚默认</button>
          </div>
        </div>

        <div class="border-b border-themed px-5 py-4">
          <ThemeTemplateSlot slot-name="admin.extensions.theme.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed" />
        </div>

        <div class="grid gap-3 border-b border-themed px-5 py-4 text-sm md:grid-cols-4">
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">已安装主题</div>
            <div class="mt-1 font-semibold text-themed">{{ themes.length }} 个</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">当前主题</div>
            <div class="mt-1 truncate font-semibold text-themed">{{ themes.find(theme => theme.enabled)?.name || '默认主题' }}</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">加载状态</div>
            <div class="mt-1 font-semibold text-themed">{{ themes.some(theme => theme.enabled) ? '第三方主题 CSS' : '内置默认主题' }}</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">可配置主题</div>
            <div class="mt-1 font-semibold text-themed">{{ themes.filter(theme => themeConfigFieldCount(theme) > 0).length }} 个</div>
          </div>
        </div>

        <div class="border-b border-themed px-5 py-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 class="text-base font-semibold text-themed">主题市场</h3>
              <p class="mt-1 text-xs text-themed-muted">
                只展示已上架并固定 SHA256 的主题；安装后仍会执行 payincus.theme.json、CSS 和包路径校验。
              </p>
              <p v-if="themeMarketGovernance" class="mt-1 font-mono text-[11px] text-themed-muted">
                {{ themeMarketGovernance.indexHost || '未配置市场地址' }} · {{ themeMarketGovernance.visibleEntries }} / {{ themeMarketGovernance.totalEntries }} listed · {{ themeMarketGovernance.fingerprint.slice(0, 12) }}
              </p>
            </div>
            <button class="btn-secondary" :disabled="themeMarketLoading" @click="loadThemeMarket">
              {{ themeMarketLoading ? '加载中...' : '刷新主题市场' }}
            </button>
          </div>

          <div v-if="themeMarketLoading" class="mt-4 rounded border border-themed bg-themed p-4 text-sm text-themed-muted">主题市场加载中...</div>
          <div v-else-if="themeMarket.length === 0" class="mt-4 rounded border border-themed bg-themed p-4 text-sm text-themed-muted">
            当前主题市场暂无可安装主题。
          </div>
          <div v-else class="mt-4 grid gap-3 xl:grid-cols-2">
            <article
              v-for="entry in themeMarket"
              :key="entry.id"
              class="rounded border border-themed bg-themed p-4"
            >
              <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h4 class="font-semibold text-themed">{{ entry.name }}</h4>
                  <div class="mt-1 font-mono text-xs text-themed-muted">{{ entry.id }}@{{ entry.latest }}</div>
                  <p class="mt-2 text-xs leading-5 text-themed-muted">{{ entry.description || '无描述' }}</p>
                </div>
                <span class="w-fit rounded border px-2 py-1 text-xs" :class="themeMarketBadgeClass(entry)">{{ marketTrustLabels[entry.trustLevel] }}</span>
              </div>
              <div class="mt-3 grid gap-2 text-xs text-themed-muted md:grid-cols-2">
                <div>开发者：{{ entry.developer.name }}</div>
                <div>安装量：{{ entry.installCount }}</div>
                <div>Token：{{ entry.tokens.length }}</div>
                <div>布局区块：{{ entry.layoutSlots.length }}</div>
                <div class="md:col-span-2">兼容：{{ entry.compatibility.minPayincus || '-' }} ~ {{ entry.compatibility.maxPayincus || '-' }}</div>
                <div class="md:col-span-2 truncate font-mono">SHA256 {{ entry.sha256 }}</div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  class="btn-primary"
                  :disabled="!canInstallThemeMarketEntry(entry) || installingThemeMarketId === entry.id || isThemeMarketEntryInstalled(entry)"
                  @click="installMarketTheme(entry)"
                >
                  {{ installingThemeMarketId === entry.id ? '安装中...' : isThemeMarketEntryInstalled(entry) ? '已安装' : '安装主题' }}
                </button>
                <a v-if="entry.previewImageUrl" class="btn-secondary" :href="entry.previewImageUrl" target="_blank" rel="noreferrer">预览图</a>
              </div>
            </article>
          </div>
        </div>

        <div class="border-b border-themed px-5 py-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 class="text-base font-semibold text-themed">主题投稿审核</h3>
              <p class="mt-1 text-xs text-themed-muted">审核第三方主题包来源、SHA256、兼容范围、token、布局区块和扫描结果；通过后可发布到主题市场索引。</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="status in (['pending', 'listed', 'rejected', 'delisted'] as const)"
                :key="status"
                class="rounded border px-3 py-2 text-xs font-medium transition"
                :class="themeSubmissionStatusFilter === status ? 'border-gray-900 bg-gray-900 text-white' : 'border-themed text-themed-muted hover:bg-themed-hover hover:text-themed'"
                @click="loadThemeSubmissions(status)"
              >
                {{ themeSubmissionReviewLabels[status] }}
              </button>
              <button class="btn-secondary" :disabled="themeSubmissionsLoading" @click="loadThemeSubmissions(themeSubmissionStatusFilter)">
                {{ themeSubmissionsLoading ? '加载中...' : '刷新投稿' }}
              </button>
              <button class="btn-primary" :disabled="publishingThemeMarketIndex" @click="publishThemeMarketIndex">
                {{ publishingThemeMarketIndex ? '发布中...' : '发布主题市场' }}
              </button>
            </div>
          </div>

          <div class="mt-3 grid gap-3 text-sm md:grid-cols-3">
            <div class="rounded border border-themed bg-themed p-3">
              <div class="text-xs text-themed-muted">当前筛选</div>
              <div class="mt-1 font-semibold text-themed">{{ themeSubmissionSummary.total }} 条</div>
            </div>
            <div class="rounded border border-themed bg-themed p-3">
              <div class="text-xs text-themed-muted">待审核</div>
              <div class="mt-1 font-semibold text-themed">{{ themeSubmissionSummary.pending }} 条</div>
            </div>
            <div class="rounded border border-themed bg-themed p-3">
              <div class="text-xs text-themed-muted">高风险</div>
              <div class="mt-1 font-semibold text-themed">{{ themeSubmissionSummary.highRisk }} 条</div>
            </div>
          </div>

          <div v-if="themeSubmissionsLoading" class="mt-4 rounded border border-themed bg-themed p-4 text-sm text-themed-muted">主题投稿加载中...</div>
          <div v-else-if="themeSubmissions.length === 0" class="mt-4 rounded border border-themed bg-themed p-4 text-sm text-themed-muted">
            当前筛选下暂无主题投稿。
          </div>
          <div v-else class="mt-4 grid gap-3">
            <article
              v-for="submission in themeSubmissions"
              :key="submission.id"
              class="rounded border border-themed bg-themed p-4 text-sm"
            >
              <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h4 class="font-semibold text-themed">#{{ submission.id }} {{ submission.name }}</h4>
                  <div class="mt-1 font-mono text-xs text-themed-muted">{{ submission.themeId }}@{{ submission.version }}</div>
                  <p class="mt-2 text-xs leading-5 text-themed-muted">{{ submission.notes || '无说明' }}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <span class="rounded border px-2 py-1 text-xs" :class="themeSubmissionReviewClass(submission.reviewStatus)">{{ themeSubmissionReviewLabels[submission.reviewStatus] }}</span>
                  <span class="rounded border px-2 py-1 text-xs" :class="themeSubmissionRiskClass(submission.riskLevel)">{{ themeSubmissionRiskLabels[submission.riskLevel] }}</span>
                  <span class="rounded border px-2 py-1 text-xs" :class="themeSubmissionScanClass(submission.scanStatus)">{{ themeSubmissionScanLabels[submission.scanStatus] }}</span>
                </div>
              </div>
              <div class="mt-3 grid gap-2 text-xs text-themed-muted md:grid-cols-2">
                <div>开发者：{{ submission.developerName }} · {{ submission.contactEmail }}</div>
                <div>提交者：{{ submission.submittedByUsername || submission.submittedByUserId }}</div>
                <div class="truncate">Release：{{ submission.releaseUrl }}</div>
                <div class="truncate">Package：{{ submission.packageUrl }}</div>
                <div class="truncate font-mono md:col-span-2">SHA256 {{ submission.sha256 }}</div>
              </div>
              <div v-if="themeSubmissionScanFindings(submission).length" class="mt-3 grid gap-2">
                <div
                  v-for="finding in themeSubmissionScanFindings(submission)"
                  :key="`${submission.id}-${finding.code}-${finding.message}`"
                  class="rounded border border-themed bg-themed-surface p-2 text-xs text-themed"
                >
                  <span class="font-mono uppercase text-themed-muted">{{ finding.severity }} · {{ finding.code }}</span>
                  <p class="mt-1">{{ finding.message }}</p>
                </div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button class="btn-secondary" :disabled="scanningThemeSubmissionId === submission.id" @click="scanThemeSubmission(submission)">
                  {{ scanningThemeSubmissionId === submission.id ? '扫描中...' : '扫描' }}
                </button>
                <button class="btn-primary" @click="reviewThemeSubmission(submission, 'listed')">通过上架</button>
                <button class="btn-secondary" @click="reviewThemeSubmission(submission, 'rejected')">拒绝</button>
                <button class="btn-secondary" @click="reviewThemeSubmission(submission, 'delisted')">下架</button>
              </div>
            </article>
          </div>
        </div>

        <div v-if="themesLoading" class="px-5 py-16 text-center text-themed-muted">加载中...</div>
        <div v-else-if="themes.length === 0" class="px-5 py-16 text-center">
          <h3 class="text-base font-semibold text-themed">暂无主题包</h3>
          <p class="mt-2 text-sm text-themed-muted">上传包含 payincus.theme.json 和 dist/theme.css 的 .tar.gz 主题包后，可以先预览再启用。</p>
        </div>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="border-b border-themed text-left text-themed-muted">
              <tr>
                <th class="px-5 py-3">主题</th>
                <th class="px-5 py-3">版本</th>
                <th class="px-5 py-3">状态</th>
                <th class="px-5 py-3">Token</th>
                <th class="px-5 py-3">配置</th>
                <th class="px-5 py-3">SHA256</th>
                <th class="px-5 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="theme in themes" :key="theme.themeId">
                <tr class="border-b border-themed">
                  <td class="px-5 py-4">
                    <div class="font-medium text-themed">{{ theme.name }}</div>
                    <div class="font-mono text-xs text-themed-muted">{{ theme.themeId }}</div>
                    <p class="mt-1 max-w-xl text-xs leading-5 text-themed-muted">{{ theme.description || '无描述' }}</p>
                    <div class="mt-2 flex flex-wrap gap-1 text-xs text-themed-muted">
                      <span class="rounded bg-themed-hover px-2 py-1">CSS {{ theme.cssPath }}</span>
                      <span v-if="theme.author" class="rounded bg-themed-hover px-2 py-1">{{ theme.author }}</span>
                      <span class="rounded bg-themed-hover px-2 py-1">兼容 {{ theme.manifest.payincus }}</span>
                    </div>
                  </td>
                  <td class="px-5 py-4 text-themed">{{ theme.version }}</td>
                  <td class="px-5 py-4">
                    <span class="rounded border px-2 py-1 text-xs" :class="themeStatusClass(theme)">{{ themeStatusText(theme) }}</span>
                    <div v-if="theme.enabledAt" class="mt-2 text-xs text-themed-muted">{{ formatDate(theme.enabledAt) }}</div>
                  </td>
                  <td class="px-5 py-4 text-themed">{{ themeTokenCount(theme) }}</td>
                  <td class="px-5 py-4 text-themed">{{ themeConfigFieldCount(theme) }}</td>
                  <td class="max-w-[180px] truncate px-5 py-4 font-mono text-xs text-themed">{{ theme.packageSha256 }}</td>
                  <td class="px-5 py-4">
                    <div class="flex flex-wrap gap-2">
                      <button class="btn-secondary" @click="openThemePreview(theme)">预览</button>
                      <button class="btn-secondary" :disabled="themeConfigFieldCount(theme) === 0" @click="openThemeConfig(theme)">
                        {{ isEditingThemeConfig(theme) ? '收起配置' : '配置' }}
                      </button>
                      <button class="btn-primary" :disabled="theme.enabled" @click="enableTheme(theme)">启用</button>
                      <button class="btn-secondary" :disabled="theme.enabled" @click="uninstallTheme(theme)">卸载</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="isEditingThemeConfig(theme)" class="border-b border-themed bg-themed">
                  <td colspan="7" class="px-5 py-5">
                    <div class="space-y-5">
                      <div v-for="group in themeConfigGroups(theme)" :key="group.name">
                        <h4 class="text-sm font-semibold text-themed">{{ group.name }}</h4>
                        <div class="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                          <div
                            v-for="[key, field] in group.fields"
                            :key="key"
                            class="block rounded border border-themed bg-themed-surface p-4 text-sm"
                          >
                            <span class="font-medium text-themed">{{ field.label }}</span>
                            <span v-if="field.required" class="ml-1 text-red-600">*</span>
                            <p v-if="field.description" class="mt-1 text-xs leading-5 text-themed-muted">{{ field.description }}</p>

                            <p v-if="field.type === 'placeholder'" class="mt-3 text-xs leading-5 text-themed-muted">{{ field.placeholder || field.label }}</p>
                            <select
                              v-else-if="field.type === 'select'"
                              :value="themeStringValue(key)"
                              class="mt-3 w-full rounded border border-themed bg-themed-surface px-3 py-2 text-sm text-themed"
                              @change="onThemeSelectChange(key, $event)"
                            >
                              <option value="">请选择</option>
                              <option v-for="option in field.options || []" :key="option.value" :value="option.value">{{ option.label }}</option>
                            </select>
                            <textarea
                              v-else-if="field.type === 'textarea' || field.type === 'markdown'"
                              :value="themeStringValue(key)"
                              class="mt-3 min-h-[104px] w-full rounded border border-themed bg-themed-surface px-3 py-2 text-sm text-themed"
                              :placeholder="field.placeholder"
                              @input="onThemeStringInput(key, $event)"
                            />
                            <label v-else-if="field.type === 'checkbox'" class="mt-3 flex items-center gap-2 text-sm text-themed">
                              <input :checked="themeBooleanValue(key)" type="checkbox" class="h-4 w-4 rounded border-themed" @change="onThemeCheckboxChange(key, $event)" />
                              <span>启用</span>
                            </label>
                            <div v-else-if="field.type === 'file'" class="mt-3 space-y-2">
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                class="block w-full text-xs text-themed file:mr-3 file:rounded file:border-0 file:bg-primary-600 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-primary-700"
                                :disabled="uploadingThemeConfigFileKey === `${theme.themeId}:${key}`"
                                @change="uploadThemeConfigFile(theme, key, $event)"
                              />
                              <div class="flex flex-wrap items-center gap-3 text-xs text-themed-muted">
                                <span v-if="uploadingThemeConfigFileKey === `${theme.themeId}:${key}`">上传中...</span>
                                <a
                                  v-if="themeStringValue(key)"
                                  class="text-primary-600 hover:underline"
                                  :href="themeStringValue(key)"
                                  target="_blank"
                                  rel="noreferrer"
                                >查看当前文件</a>
                              </div>
                            </div>
                            <input
                              v-else-if="field.type === 'number'"
                              :value="themeNumberValue(key)"
                              type="number"
                              class="mt-3 w-full rounded border border-themed bg-themed-surface px-3 py-2 text-sm text-themed"
                              :min="field.min"
                              :max="field.max"
                              :step="field.step || 1"
                              :placeholder="field.placeholder"
                              @input="onThemeNumberInput(key, $event)"
                            />
                            <input
                              v-else-if="field.type === 'tags'"
                              :value="themeTagsValue(key)"
                              type="text"
                              class="mt-3 w-full rounded border border-themed bg-themed-surface px-3 py-2 text-sm text-themed"
                              :placeholder="field.placeholder || '用逗号分隔多个值'"
                              @input="onThemeTagsInput(key, $event)"
                            />
                            <input
                              v-else
                              :value="themeStringValue(key)"
                              :type="themeConfigInputType(field.type)"
                              class="mt-3 w-full rounded border border-themed bg-themed-surface px-3 py-2 text-sm text-themed"
                              :placeholder="field.placeholder"
                              @input="onThemeStringInput(key, $event)"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="mt-4 flex justify-end gap-2">
                      <button class="btn-secondary" @click="openThemeConfig(theme)">取消</button>
                      <button class="btn-primary" :disabled="savingThemeConfigId === theme.themeId" @click="saveThemeConfig(theme)">
                        {{ savingThemeConfigId === theme.themeId ? '保存中...' : '保存配置' }}
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="activeTab === 'limits'" class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-themed">公开 action 限流策略</h2>
            <p class="mt-1 text-sm text-themed-muted">`*` 表示全局或全部 action；具体扩展和 action 会覆盖全局策略。</p>
          </div>
          <div class="flex gap-2">
            <button class="btn-secondary" :disabled="actionRateLimitsLoading" @click="addActionRateLimitDraft">添加策略</button>
            <button class="btn-primary" :disabled="savingActionRateLimits || actionRateLimitsLoading" @click="saveActionRateLimits">
              {{ savingActionRateLimits ? '保存中...' : '保存策略' }}
            </button>
          </div>
        </div>

        <div v-if="actionRateLimitsLoading" class="px-5 py-16 text-center text-themed-muted">加载中...</div>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full table-fixed text-sm">
            <thead class="border-b border-themed text-left text-themed-muted">
              <tr>
                <th class="w-[240px] px-5 py-3">扩展 ID</th>
                <th class="w-[180px] px-5 py-3">Action</th>
                <th class="w-[140px] px-5 py-3">策略</th>
                <th class="w-[140px] px-5 py-3">窗口请求数</th>
                <th class="w-[140px] px-5 py-3">窗口秒数</th>
                <th class="w-[100px] px-5 py-3">启用</th>
                <th class="w-[100px] px-5 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(policy, index) in actionRateLimitDrafts" :key="index" class="border-b border-themed">
                <td class="px-5 py-4">
                  <input
                    v-model="policy.pluginId"
                    class="w-full rounded border border-themed bg-themed px-3 py-2 font-mono text-xs text-themed"
                    placeholder="* 或 com.example.plugin"
                  >
                </td>
                <td class="px-5 py-4">
                  <input
                    v-model="policy.actionName"
                    class="w-full rounded border border-themed bg-themed px-3 py-2 font-mono text-xs text-themed"
                    placeholder="* 或 reserveStock"
                  >
                </td>
                <td class="px-5 py-4">
                  <select v-model="policy.rateLimit" class="w-full rounded border border-themed bg-themed px-3 py-2 text-themed">
                    <option value="normal">normal</option>
                    <option value="strict">strict</option>
                  </select>
                </td>
                <td class="px-5 py-4">
                  <input
                    v-model.number="policy.maxRequests"
                    type="number"
                    min="1"
                    max="10000"
                    class="w-full rounded border border-themed bg-themed px-3 py-2 text-themed"
                  >
                </td>
                <td class="px-5 py-4">
                  <input
                    v-model.number="policy.windowSeconds"
                    type="number"
                    min="10"
                    max="3600"
                    class="w-full rounded border border-themed bg-themed px-3 py-2 text-themed"
                  >
                </td>
                <td class="px-5 py-4">
                  <label class="inline-flex h-10 items-center gap-2 text-themed">
                    <input v-model="policy.enabled" type="checkbox" class="h-4 w-4 rounded border-themed">
                    <span>{{ policy.enabled ? '启用' : '停用' }}</span>
                  </label>
                </td>
                <td class="px-5 py-4">
                  <button class="btn-secondary" :disabled="actionRateLimitDrafts.length <= 1" @click="removeActionRateLimitDraft(index)">移除</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="border-t border-themed px-5 py-4 text-xs leading-5 text-themed-muted">
            生效优先级：指定扩展 + 指定 action，高于指定扩展全部 action，高于全局 `*`。保存策略会清理当前对应窗口，下一次 dispatch 按新策略重新计数。
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'events'" class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-themed">事件投递</h2>
            <p class="mt-1 text-sm text-themed-muted">扩展事件投递失败会进入重试队列，多次失败后进入死信；可手动处理到期重试或重放单条事件。</p>
          </div>
          <div class="flex flex-col gap-2 sm:items-end">
            <button class="btn-primary" :disabled="retryingEvents" @click="retryDueEvents">
              {{ retryingEvents ? '处理中...' : '处理到期重试' }}
            </button>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="result in (['retry_pending', 'dead_letter', 'duplicate_skipped', 'success', 'all'] as const)"
                :key="result"
                class="rounded border px-3 py-2 text-sm font-medium transition"
                :class="eventResultFilter === result ? 'border-gray-900 bg-gray-900 text-white' : 'border-themed text-themed-muted hover:bg-themed-hover hover:text-themed'"
                @click="loadPluginEvents(result)"
              >
                {{ result === 'all' ? '全部' : eventResultText(result) }}
              </button>
            </div>
          </div>
        </div>

        <div class="grid gap-3 border-b border-themed px-5 py-4 text-sm lg:grid-cols-[minmax(160px,1fr)_minmax(180px,1fr)_minmax(220px,1.5fr)_auto]">
          <label class="block">
            <span class="text-xs font-medium text-themed-muted">扩展</span>
            <select v-model="eventPluginFilter" class="mt-1 w-full rounded border border-themed bg-themed px-3 py-2 text-themed" @change="loadPluginEvents(eventResultFilter)">
              <option value="all">全部扩展</option>
              <option v-for="plugin in plugins" :key="plugin.pluginId" :value="plugin.pluginId">{{ plugin.name }}</option>
            </select>
          </label>
          <label class="block">
            <span class="text-xs font-medium text-themed-muted">事件名</span>
            <select v-model="eventNameFilter" class="mt-1 w-full rounded border border-themed bg-themed px-3 py-2 text-themed" @change="loadPluginEvents(eventResultFilter)">
              <option value="all">全部事件</option>
              <option v-for="eventName in pluginBusinessEventNames" :key="eventName" :value="eventName">{{ eventName }}</option>
            </select>
          </label>
          <label class="block">
            <span class="text-xs font-medium text-themed-muted">Handler</span>
            <input
              v-model="eventHandlerFilter"
              class="mt-1 w-full rounded border border-themed bg-themed px-3 py-2 text-themed"
              placeholder="https://example.com/webhook"
              @keyup.enter="loadPluginEvents(eventResultFilter)"
            >
          </label>
          <div class="flex items-end">
            <button class="btn-secondary w-full" :disabled="eventsLoading" @click="loadPluginEvents(eventResultFilter)">应用筛选</button>
          </div>
        </div>

        <div class="grid gap-3 border-b border-themed px-5 py-4 text-sm md:grid-cols-5">
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">匹配事件</div>
            <div class="mt-1 font-semibold text-themed">{{ eventSummary.total }} 条</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">待重试</div>
            <div class="mt-1 font-semibold text-themed">{{ eventSummary.retryPending }} 条</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">到期重试</div>
            <div class="mt-1 font-semibold text-themed">{{ eventSummary.dueRetry }} 条</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">已去重</div>
            <div class="mt-1 font-semibold text-themed">{{ eventSummary.deduped }} 条</div>
          </div>
          <div class="rounded border border-themed bg-themed p-3">
            <div class="text-xs text-themed-muted">死信</div>
            <div class="mt-1 font-semibold text-themed">{{ eventSummary.deadLetter }} 条</div>
          </div>
        </div>

        <div v-if="eventsLoading" class="px-5 py-16 text-center text-themed-muted">加载中...</div>
        <div v-else-if="pluginEvents.length === 0" class="px-5 py-16 text-center text-sm text-themed-muted">当前筛选下暂无事件投递日志。</div>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="border-b border-themed text-left text-themed-muted">
              <tr>
                <th class="px-5 py-3">事件</th>
                <th class="px-5 py-3">扩展</th>
                <th class="px-5 py-3">状态</th>
                <th class="px-5 py-3">重试</th>
                <th class="px-5 py-3">时间</th>
                <th class="px-5 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in pluginEvents" :key="event.id" class="border-b border-themed">
                <td class="px-5 py-4">
                  <div class="font-medium text-themed">#{{ event.id }} {{ event.eventName || event.action }}</div>
                  <div class="mt-1 font-mono text-xs text-themed-muted">{{ event.handler || '-' }}</div>
                  <div v-if="event.dedupeKey" class="mt-1 font-mono text-xs text-sky-700 dark:text-sky-300">dedupe {{ event.dedupeKey }}</div>
                  <p v-if="event.message" class="mt-2 max-w-xl text-xs leading-5 text-themed-muted">{{ event.message }}</p>
                  <p v-if="event.lastError" class="mt-1 max-w-xl text-xs text-red-600">{{ event.lastError }}</p>
                </td>
                <td class="px-5 py-4 font-mono text-xs text-themed">{{ event.pluginId }}</td>
                <td class="px-5 py-4">
                  <span class="rounded border px-2 py-1 text-xs" :class="eventResultClass(event.result)">
                    {{ eventResultText(event.result) }}
                  </span>
                </td>
                <td class="px-5 py-4 text-themed">
                  <div>{{ event.retryCount }} / {{ event.maxRetries }}</div>
                  <div v-if="event.nextRetryAt" class="mt-1 text-xs text-themed-muted">下次 {{ formatDate(event.nextRetryAt) }}</div>
                  <div v-if="event.deadLetterAt" class="mt-1 text-xs text-red-600">死信 {{ formatDate(event.deadLetterAt) }}</div>
                </td>
                <td class="px-5 py-4 text-themed">
                  <div>{{ formatDate(event.createdAt) }}</div>
                  <div v-if="event.lastAttemptAt" class="mt-1 text-xs text-themed-muted">最后尝试 {{ formatDate(event.lastAttemptAt) }}</div>
                </td>
                <td class="px-5 py-4">
                  <button
                    class="btn-secondary"
                    :disabled="event.result === 'success' || event.result === 'duplicate_skipped'"
                    @click="replayPluginEvent(event)"
                  >
                    重放
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else class="grid gap-6 xl:grid-cols-[minmax(300px,440px)_1fr]">
        <div class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
          <div class="flex items-center justify-between gap-3 border-b border-themed px-5 py-4">
            <div>
              <h2 class="text-lg font-semibold text-themed">安装任务</h2>
              <p class="mt-1 text-xs text-themed-muted">每页最多显示 7 条，选择任务后查看右侧日志。</p>
            </div>
            <div class="flex gap-2 text-xs">
              <span class="rounded border border-themed px-2 py-1 text-themed-muted">{{ taskSummary.total }} 条</span>
              <span v-if="taskSummary.running" class="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">{{ taskSummary.running }} 运行中</span>
              <span v-if="taskSummary.failed" class="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">{{ taskSummary.failed }} 失败</span>
            </div>
          </div>
          <div v-if="tasks.length === 0" class="px-5 py-10 text-center text-sm text-themed-muted">暂无安装任务。</div>
          <div v-else class="divide-y divide-themed">
            <button
              v-for="task in paginatedTasks"
              :key="task.id"
              class="block h-[76px] w-full overflow-hidden px-5 py-3 text-left transition hover:bg-themed-hover"
              :class="task.id === selectedTaskId ? 'bg-themed-hover' : ''"
              @click="selectTask(task)"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="truncate font-medium text-themed">#{{ task.id }} {{ taskActionText(task.action) }}</span>
                <span class="rounded border px-2 py-0.5 text-xs" :class="taskStatusClass(task.status)">
                  {{ taskStatusText(task.status) }}
                </span>
              </div>
              <div class="mt-1 text-xs text-themed-muted">{{ task.pluginId || '-' }} · {{ formatDate(task.createdAt) }}</div>
              <p v-if="task.errorMessage" class="mt-1 truncate text-xs text-red-600">{{ task.errorMessage }}</p>
            </button>
          </div>
          <div class="flex min-h-[54px] items-center justify-between border-t border-themed px-5 py-3 text-xs text-themed-muted">
            <span>第 {{ taskPage }} / {{ totalTaskPages }} 页 · 共 {{ tasks.length }} 个任务</span>
            <div class="flex gap-2">
              <button class="btn-secondary" :disabled="taskPage <= 1" @click="setTaskPage(taskPage - 1)">上一页</button>
              <button class="btn-secondary" :disabled="taskPage >= totalTaskPages" @click="setTaskPage(taskPage + 1)">下一页</button>
            </div>
          </div>
        </div>

        <div class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
          <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-themed">任务日志</h2>
              <p class="mt-1 text-xs text-themed-muted">{{ selectedTask ? `任务 #${selectedTask.id} · ${taskStatusText(selectedTask.status)}` : '请选择任务' }}</p>
            </div>
            <button class="btn-secondary" :disabled="!selectedTask || taskLogsLoading" @click="loadSelectedTaskLogs">
              {{ taskLogsLoading ? '加载中...' : '刷新日志' }}
            </button>
          </div>
          <pre class="min-h-[460px] max-h-[620px] overflow-auto whitespace-pre-wrap bg-gray-950 p-5 text-xs leading-5 text-gray-100">{{ taskLogs || '暂无日志。' }}</pre>
        </div>
      </section>
    </template>
  </div>
</template>
