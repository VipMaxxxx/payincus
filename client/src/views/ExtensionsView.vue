<script setup lang="ts">
/**
 * ExtensionsView - 扩展管理页面
 * 
 * TAB 结构：
 * - 初始化命令：用户自定义的实例初始化命令模板
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import InitCommandModal from '@/components/extensions/InitCommandModal.vue'
import InitCommandDetailModal from '@/components/extensions/InitCommandDetailModal.vue'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import type {
  DeveloperPluginEventHealth,
  PluginEventAlertPreference,
  UpdatePluginEventAlertPreferenceRequest,
  PluginMarketSubmission
} from '@/types/api'

const { t } = useI18n()
const toast = useToast()

// TAB 状态
const activeTab = ref<'init-commands' | 'developer-submissions'>('init-commands')

// 命令列表
interface InitCommand {
  id: number
  name: string
  commandPreview: string
  commandLineCount: number
  distros: string[]
  description: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

const commands = ref<InitCommand[]>([])
const loading = ref(false)
const submissionsLoading = ref(false)
const eventHealthLoading = ref(false)
const submittingPlugin = ref(false)
const uploadingSubmissionPackage = ref(false)
const submissions = ref<PluginMarketSubmission[]>([])
const eventHealth = ref<DeveloperPluginEventHealth[]>([])
const eventAlertPreferences = ref<PluginEventAlertPreference[]>([])
const savingEventAlertPreference = ref<Record<string, boolean>>({})
const selectedSubmissionPackageFile = ref<File | null>(null)
const submissionForm = ref({
  pluginId: '',
  version: '',
  name: '',
  repoUrl: '',
  releaseUrl: '',
  manifestUrl: '',
  packageUrl: '',
  sha256: '',
  developerName: '',
  developerHomepage: '',
  developerGithub: '',
  contactEmail: '',
  permissions: '',
  compatibility: '',
  pricing: '',
  notes: ''
})

// 发行版图标映射
const distroIcons: Record<string, string> = {
  ubuntu: 'ubuntu',
  debian: 'debian',
  rhel: 'almalinux',
  alpine: 'alpine',
  arch: 'arch',
  suse: 'opensuse',
  all: 'linux'
}

// 分页
const currentPage = ref(1)
const pageSize = 10

const totalPages = computed(() => Math.ceil(commands.value.length / pageSize))
const paginatedCommands = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return commands.value.slice(start, start + pageSize)
})

const submissionReviewLabels: Record<PluginMarketSubmission['reviewStatus'], string> = {
  pending: '待审核',
  listed: '已通过',
  rejected: '已拒绝',
  delisted: '已下架'
}

const submissionRiskLabels: Record<PluginMarketSubmission['riskLevel'], string> = {
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

const eventHealthByPluginId = computed(() => new Map(eventHealth.value.map(item => [item.pluginId, item])))
const eventAlertPreferenceByPluginId = computed(() => new Map(eventAlertPreferences.value.map(item => [item.pluginId, item])))
type EventHealthStatus = Pick<DeveloperPluginEventHealth, 'total' | 'failed' | 'retryPending' | 'deadLetter' | 'recentSuccessRate'>

function defaultEventAlertPreference(pluginId: string): PluginEventAlertPreference {
  return {
    pluginId,
    enabled: true,
    minimumLevel: 'warning',
    cooldownMinutes: 360,
    notifyOnDeadLetter: true,
    notifyOnDueRetry: true,
    notifyOnSuccessRateBelow: true,
    successRateThreshold: 95,
    recentWindowHours: 24,
    updatedAt: null
  }
}

function eventAlertPreference(pluginId: string): PluginEventAlertPreference {
  return eventAlertPreferenceByPluginId.value.get(pluginId) || defaultEventAlertPreference(pluginId)
}

function inputChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}

function inputNumber(event: Event): number {
  return Number((event.target as HTMLInputElement).value)
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

function inputMinimumLevel(event: Event): 'warning' | 'critical' {
  return inputValue(event) === 'critical' ? 'critical' : 'warning'
}

function goToPrevPage(): void {
  if (currentPage.value > 1) currentPage.value--
}

function goToNextPage(): void {
  if (currentPage.value < totalPages.value) currentPage.value++
}

// 加载命令列表
async function loadCommands(): Promise<void> {
  loading.value = true
  try {
    const response = await api.initCommands.list()
    commands.value = response.commands
  } catch (error: any) {
    toast.error(t('extensions.initCommands.loadFailed') + ': ' + (error?.message || String(error)))
  } finally {
    loading.value = false
  }
}

async function loadSubmissions(): Promise<void> {
  submissionsLoading.value = true
  try {
    const [response, preferenceResponse] = await Promise.all([
      api.pluginMarketSubmissions.mine(),
      api.pluginMarketSubmissions.eventAlertPreferences(),
      loadDeveloperEventHealth()
    ])
    submissions.value = response.submissions
    eventAlertPreferences.value = preferenceResponse.preferences
  } catch (error: any) {
    toast.error('加载投稿记录失败：' + (error?.message || String(error)))
  } finally {
    submissionsLoading.value = false
  }
}

async function updateEventAlertPreference(pluginId: string, patch: UpdatePluginEventAlertPreferenceRequest): Promise<void> {
  const current = eventAlertPreference(pluginId)
  savingEventAlertPreference.value = { ...savingEventAlertPreference.value, [pluginId]: true }
  try {
    const payload: UpdatePluginEventAlertPreferenceRequest = {
      enabled: current.enabled,
      minimumLevel: current.minimumLevel,
      cooldownMinutes: current.cooldownMinutes,
      notifyOnDeadLetter: current.notifyOnDeadLetter,
      notifyOnDueRetry: current.notifyOnDueRetry,
      notifyOnSuccessRateBelow: current.notifyOnSuccessRateBelow,
      successRateThreshold: current.successRateThreshold,
      recentWindowHours: current.recentWindowHours,
      ...patch
    }
    const response = await api.pluginMarketSubmissions.updateEventAlertPreference(pluginId, payload)
    const others = eventAlertPreferences.value.filter(item => item.pluginId !== pluginId)
    eventAlertPreferences.value = [...others, response.preference]
    toast.success('事件告警偏好已保存')
  } catch (error: any) {
    toast.error('保存事件告警偏好失败：' + (error?.message || String(error)))
  } finally {
    savingEventAlertPreference.value = { ...savingEventAlertPreference.value, [pluginId]: false }
  }
}

async function loadDeveloperEventHealth(): Promise<void> {
  eventHealthLoading.value = true
  try {
    const response = await api.pluginMarketSubmissions.eventHealth()
    eventHealth.value = response.plugins
  } catch (error: any) {
    toast.error('加载扩展事件健康失败：' + (error?.message || String(error)))
  } finally {
    eventHealthLoading.value = false
  }
}

function parseJsonObjectInput(value: string, fallback: Record<string, unknown>): Record<string, unknown> {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 必须是对象')
  }
  return parsed as Record<string, unknown>
}

function resetSubmissionForm(): void {
  submissionForm.value = {
    pluginId: '',
    version: '',
    name: '',
    repoUrl: '',
    releaseUrl: '',
    manifestUrl: '',
    packageUrl: '',
    sha256: '',
    developerName: '',
    developerHomepage: '',
    developerGithub: '',
    contactEmail: '',
    permissions: '{ "api": [], "events": [] }',
    compatibility: '{ "minPayincus": "0.6.0" }',
    pricing: '{ "type": "free" }',
    notes: ''
  }
}

function onSubmissionPackageSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  selectedSubmissionPackageFile.value = input.files?.[0] || null
}

async function uploadSubmissionPackage(): Promise<void> {
  if (!selectedSubmissionPackageFile.value) {
    toast.error('请先选择扩展 .tar.gz 包')
    return
  }
  uploadingSubmissionPackage.value = true
  try {
    const response = await api.pluginMarketSubmissions.uploadPackage(selectedSubmissionPackageFile.value)
    const upload = response.upload
    submissionForm.value.pluginId = upload.pluginId
    submissionForm.value.version = upload.version
    submissionForm.value.name = upload.name
    submissionForm.value.manifestUrl = upload.manifestUrl
    submissionForm.value.packageUrl = upload.packageUrl
    submissionForm.value.sha256 = upload.sha256
    submissionForm.value.permissions = JSON.stringify(upload.permissions || {}, null, 2)
    submissionForm.value.compatibility = JSON.stringify(upload.compatibility || {}, null, 2)
    toast.success(`扩展包已上传：${upload.sourceName}`)
  } catch (error: any) {
    toast.error('上传扩展包失败：' + (error?.message || String(error)))
  } finally {
    uploadingSubmissionPackage.value = false
  }
}

async function submitPluginReview(): Promise<void> {
  submittingPlugin.value = true
  try {
    const form = submissionForm.value
    await api.pluginMarketSubmissions.create({
      pluginId: form.pluginId.trim(),
      version: form.version.trim(),
      name: form.name.trim(),
      repoUrl: form.repoUrl.trim(),
      releaseUrl: form.releaseUrl.trim(),
      manifestUrl: form.manifestUrl.trim(),
      packageUrl: form.packageUrl.trim(),
      sha256: form.sha256.trim(),
      developerName: form.developerName.trim(),
      developerHomepage: form.developerHomepage.trim() || null,
      developerGithub: form.developerGithub.trim() || null,
      contactEmail: form.contactEmail.trim(),
      permissions: parseJsonObjectInput(form.permissions, {}),
      compatibility: parseJsonObjectInput(form.compatibility, {}),
      pricing: parseJsonObjectInput(form.pricing, { type: 'free' }),
      notes: form.notes.trim() || null
    })
    toast.success('扩展投稿已提交审核')
    resetSubmissionForm()
    await loadSubmissions()
  } catch (error: any) {
    toast.error('提交审核失败：' + (error?.message || String(error)))
  } finally {
    submittingPlugin.value = false
  }
}

function openDeveloperSubmissions(): void {
  activeTab.value = 'developer-submissions'
  if (!submissions.value.length && !submissionsLoading.value) void loadSubmissions()
}

function submissionStatusClass(status: PluginMarketSubmission['reviewStatus']): string {
  if (status === 'listed') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-200'
  if (status === 'delisted') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-blue-50 text-blue-700 border-blue-200'
}

function eventHealthStatusClass(health?: EventHealthStatus): string {
  if (!health || health.total === 0) return 'border-gray-200 bg-gray-50 text-gray-700'
  if (health.deadLetter > 0) return 'border-red-200 bg-red-50 text-red-700'
  if (health.retryPending > 0 || health.failed > 0) return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

function eventHealthStatusText(health?: EventHealthStatus): string {
  if (!health || health.total === 0) return '暂无事件'
  if (health.deadLetter > 0) return '存在死信'
  if (health.retryPending > 0) return '等待重试'
  if (health.failed > 0) return '存在失败'
  return '投递正常'
}

function eventHealthAlertClass(level: 'warning' | 'critical'): string {
  return level === 'critical'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-amber-200 bg-amber-50 text-amber-700'
}

function formatEventSuccessRate(value?: number | null): string {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '-'
}

function formatOptionalDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '-'
}

// 新增/编辑弹窗
const showCommandModal = ref(false)
const editingCommand = ref<InitCommand | null>(null)

function openAddModal(): void {
  editingCommand.value = null
  showCommandModal.value = true
}

function openEditModal(cmd: InitCommand): void {
  editingCommand.value = cmd
  showCommandModal.value = true
}

function onModalClose(): void {
  showCommandModal.value = false
  editingCommand.value = null
}

async function onModalSave(): Promise<void> {
  await loadCommands()
  onModalClose()
}

// 详情弹窗
const showDetailModal = ref(false)
const viewingCommand = ref<InitCommand | null>(null)

function openDetailModal(cmd: InitCommand): void {
  viewingCommand.value = cmd
  showDetailModal.value = true
}

function closeDetailModal(): void {
  showDetailModal.value = false
  viewingCommand.value = null
}

// 删除命令
async function deleteCommand(cmd: InitCommand): Promise<void> {
  if (!confirm(t('extensions.initCommands.confirmDelete', { name: cmd.name }))) return
  
  try {
    await api.initCommands.delete(cmd.id)
    toast.success(t('extensions.initCommands.deleteSuccess'))
    await loadCommands()
    // 删除后如果当前页已无数据，返回上一页
    if (paginatedCommands.value.length === 0 && currentPage.value > 1) {
      currentPage.value--
    }
  } catch (error: any) {
    toast.error(t('extensions.initCommands.deleteFailed') + ': ' + (error?.message || String(error)))
  }
}

// 切换启用状态
async function toggleEnabled(cmd: InitCommand): Promise<void> {
  try {
    await api.initCommands.update(cmd.id, { enabled: !cmd.enabled })
    cmd.enabled = !cmd.enabled
    toast.success(cmd.enabled ? t('extensions.initCommands.enabled') : t('extensions.initCommands.disabled'))
  } catch (error: any) {
    toast.error(t('extensions.initCommands.toggleFailed') + ': ' + (error?.message || String(error)))
  }
}

// 获取发行版显示名称（使用翻译键）
function getDistroName(distro: string): string {
  const key = `extensions.initCommands.distroNames.${distro}`
  const translated = t(key)
  return translated !== key ? translated : distro
}

// 挂载时加载
resetSubmissionForm()
loadCommands()
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <h1 class="page-title">{{ $t('nav.extensions') }}</h1>
      <p class="text-sm text-themed-muted mt-1">{{ $t('extensions.description') }}</p>
    </div>

    <ThemeTemplateSlot slot-name="user.extensions.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />

    <!-- TAB 导航 -->
    <div class="border-b border-themed">
      <nav class="flex -mb-px">
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
          :class="activeTab === 'init-commands' 
            ? 'border-primary-500 text-primary-600 dark:text-primary-400' 
            : 'border-transparent text-themed-muted hover:text-themed-secondary hover:border-themed'"
          @click="activeTab = 'init-commands'"
        >
          {{ $t('extensions.initCommands.title') }}
        </button>
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
          :class="activeTab === 'developer-submissions'
            ? 'border-primary-500 text-primary-600 dark:text-primary-400'
            : 'border-transparent text-themed-muted hover:text-themed-secondary hover:border-themed'"
          @click="openDeveloperSubmissions"
        >
          开发者投稿
        </button>
      </nav>
    </div>

    <!-- 初始化命令 TAB -->
    <div v-if="activeTab === 'init-commands'" class="card p-5">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <p class="text-xs text-themed-faint">{{ $t('extensions.initCommands.description') }}</p>
        <button class="btn-primary btn-sm" @click="openAddModal">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ $t('extensions.initCommands.add') }}
        </button>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="text-center py-8">
        <div class="inline-flex items-center gap-2 text-themed-muted">
          <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>{{ $t('common.loading') }}</span>
        </div>
      </div>

      <!-- 命令列表 -->
      <div v-else-if="commands.length" class="space-y-2">
        <div 
          v-for="cmd in paginatedCommands" 
          :key="cmd.id" 
          class="group flex items-center justify-between gap-3 p-3 bg-themed-tertiary border border-themed rounded-lg hover:border-themed-secondary transition-colors"
          :class="{ 'opacity-50': !cmd.enabled }"
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <!-- 图标 -->
            <div class="w-9 h-9 rounded-lg bg-themed-secondary flex items-center justify-center flex-shrink-0">
              <svg class="w-5 h-5 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <!-- 信息 -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm text-themed-secondary font-medium truncate">{{ cmd.name }}</span>
                <span v-if="!cmd.enabled" class="text-xs px-1.5 py-0.5 rounded bg-themed-secondary text-themed-muted">
                  {{ $t('extensions.initCommands.statusDisabled') }}
                </span>
              </div>
              <div class="text-xs text-themed-faint truncate mt-0.5">
                {{ cmd.commandPreview || $t('extensions.initCommands.noContent') }}
              </div>
              <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span 
                  v-for="distro in cmd.distros" 
                  :key="distro"
                  class="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-themed-secondary/80 text-themed-muted"
                >
                  <DistroIcon :distro="distroIcons[distro] || 'linux'" :size="14" />
                  {{ getDistroName(distro) }}
                </span>
                <span class="text-xs text-themed-faint">
                  · {{ $t('extensions.initCommands.lineCount', { count: cmd.commandLineCount }) }}
                </span>
              </div>
            </div>
          </div>
          <!-- 操作按钮 -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <button 
              class="text-themed-faint hover:text-themed-secondary transition-colors"
              :title="$t('extensions.initCommands.viewDetail')"
              @click="openDetailModal(cmd)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            <button 
              class="text-themed-faint hover:text-themed-secondary transition-colors"
              :title="$t('common.edit')"
              @click="openEditModal(cmd)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button 
              class="transition-colors"
              :class="cmd.enabled ? 'text-green-500 hover:text-green-600' : 'text-themed-faint hover:text-green-500'"
              :title="cmd.enabled ? $t('extensions.initCommands.clickToDisable') : $t('extensions.initCommands.clickToEnable')"
              @click="toggleEnabled(cmd)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path v-if="cmd.enabled" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button 
              class="text-themed-faint hover:text-red-400 transition-colors"
              :title="$t('common.delete')"
              @click="deleteCommand(cmd)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="text-center py-12 border border-dashed border-themed rounded-lg">
        <svg class="w-12 h-12 mx-auto mb-3 text-themed-faint opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p class="text-sm text-themed-muted mb-3">{{ $t('extensions.initCommands.empty') }}</p>
        <button class="btn-primary btn-sm" @click="openAddModal">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ $t('extensions.initCommands.addFirst') }}
        </button>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages > 1" class="flex items-center justify-between mt-4 pt-3 border-t border-themed">
        <span class="text-xs text-themed-muted">
          {{ $t('common.pageInfo', { current: currentPage, total: totalPages, count: commands.length }) }}
        </span>
        <div class="flex items-center gap-2">
          <button class="btn-ghost btn-sm" :disabled="currentPage <= 1" @click="goToPrevPage">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            {{ $t('common.prevPage') }}
          </button>
          <button class="btn-ghost btn-sm" :disabled="currentPage >= totalPages" @click="goToNextPage">
            {{ $t('common.nextPage') }}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'developer-submissions'" class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section class="card p-5">
        <div class="mb-4">
          <h2 class="text-lg font-semibold text-themed">提交扩展审核</h2>
          <p class="mt-1 text-sm text-themed-muted">可以上传扩展包由平台生成待审核下载源，也可以提交已有 HTTPS Release、manifest、包地址、SHA256 和权限说明。</p>
        </div>

        <div class="mb-5 rounded-lg border border-themed bg-themed p-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-end">
            <label class="flex-1 space-y-1">
              <span class="text-sm text-themed-muted">上传扩展包</span>
              <input class="input w-full" type="file" accept=".tar.gz,application/gzip" @change="onSubmissionPackageSelected" />
            </label>
            <button class="btn-secondary" type="button" :disabled="uploadingSubmissionPackage || !selectedSubmissionPackageFile" @click="uploadSubmissionPackage">
              {{ uploadingSubmissionPackage ? '上传中...' : '上传并解析' }}
            </button>
          </div>
          <p class="mt-2 text-xs text-themed-muted">
            平台会校验 `.tar.gz`、解析 `payincus.plugin.json`、计算 SHA256，并生成同源待审核下载地址。审核通过后仍需要管理员发布市场目录。
          </p>
        </div>

        <form class="grid gap-4 md:grid-cols-2" @submit.prevent="submitPluginReview">
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">扩展 ID</span>
            <input v-model="submissionForm.pluginId" class="input w-full" placeholder="com.example.flash-sale" required />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">版本</span>
            <input v-model="submissionForm.version" class="input w-full" placeholder="1.0.0" required />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">扩展名称</span>
            <input v-model="submissionForm.name" class="input w-full" placeholder="Flash Sale" required />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">联系邮箱</span>
            <input v-model="submissionForm.contactEmail" class="input w-full" type="email" placeholder="plugins@example.com" required />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">仓库 URL</span>
            <input v-model="submissionForm.repoUrl" class="input w-full" placeholder="https://github.com/example/plugin" required />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">Release URL</span>
            <input v-model="submissionForm.releaseUrl" class="input w-full" placeholder="https://github.com/example/plugin/releases/tag/v1.0.0" required />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">Manifest URL</span>
            <input v-model="submissionForm.manifestUrl" class="input w-full" placeholder="https://..." required />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">扩展包 URL</span>
            <input v-model="submissionForm.packageUrl" class="input w-full" placeholder="https://.../plugin.tar.gz" required />
          </label>
          <label class="space-y-1 md:col-span-2">
            <span class="text-sm text-themed-muted">SHA256</span>
            <input v-model="submissionForm.sha256" class="input w-full font-mono" placeholder="64-character-sha256" required />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">开发者名称</span>
            <input v-model="submissionForm.developerName" class="input w-full" placeholder="Example" required />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">开发者主页</span>
            <input v-model="submissionForm.developerHomepage" class="input w-full" placeholder="https://example.com" />
          </label>
          <label class="space-y-1 md:col-span-2">
            <span class="text-sm text-themed-muted">GitHub</span>
            <input v-model="submissionForm.developerGithub" class="input w-full" placeholder="https://github.com/example" />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">权限 JSON</span>
            <textarea v-model="submissionForm.permissions" class="input min-h-[110px] w-full font-mono text-xs" />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">兼容 JSON</span>
            <textarea v-model="submissionForm.compatibility" class="input min-h-[110px] w-full font-mono text-xs" />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">定价 JSON</span>
            <textarea v-model="submissionForm.pricing" class="input min-h-[90px] w-full font-mono text-xs" />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">说明</span>
            <textarea v-model="submissionForm.notes" class="input min-h-[90px] w-full" placeholder="功能说明、回滚说明、外部服务依赖等" />
          </label>
          <div class="md:col-span-2 flex justify-end">
            <button class="btn-primary" type="submit" :disabled="submittingPlugin">
              {{ submittingPlugin ? '提交中...' : '提交审核' }}
            </button>
          </div>
        </form>
      </section>

      <aside class="card p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-themed">我的投稿</h2>
            <p class="mt-1 text-sm text-themed-muted">审核通过后会由平台发布到扩展市场目录。</p>
          </div>
          <button class="btn-secondary btn-sm" :disabled="submissionsLoading || eventHealthLoading" @click="loadSubmissions">
            {{ submissionsLoading || eventHealthLoading ? '加载中...' : '刷新' }}
          </button>
        </div>

        <div v-if="submissionsLoading" class="py-8 text-center text-themed-muted">加载中...</div>
        <div v-else-if="submissions.length === 0" class="py-8 text-center text-sm text-themed-muted">暂无投稿。</div>
        <div v-else class="mt-4 space-y-3">
          <article v-for="submission in submissions" :key="submission.id" class="rounded-lg border border-themed bg-themed p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="truncate text-sm font-medium text-themed">{{ submission.name }}</h3>
                <p class="mt-1 truncate font-mono text-xs text-themed-muted">{{ submission.pluginId }}@{{ submission.version }}</p>
              </div>
              <span class="rounded border px-2 py-1 text-xs" :class="submissionStatusClass(submission.reviewStatus)">
                {{ submissionReviewLabels[submission.reviewStatus] }}
              </span>
            </div>
            <div class="mt-3 grid gap-2 text-xs text-themed-muted">
              <div>风险：{{ submissionRiskLabels[submission.riskLevel] }}</div>
              <div>扫描：{{ submissionScanLabels[submission.scanStatus] }}</div>
              <div>提交：{{ new Date(submission.createdAt).toLocaleString() }}</div>
              <div v-if="submission.reviewedAt">审核：{{ new Date(submission.reviewedAt).toLocaleString() }}</div>
              <div v-if="submission.reviewNotes" class="rounded bg-themed-hover p-2 text-themed">{{ submission.reviewNotes }}</div>
            </div>
            <div class="mt-3 rounded border border-themed bg-themed-surface p-3">
              <div class="flex items-center justify-between gap-3">
                <span class="text-xs font-medium text-themed">事件投递健康</span>
                <span class="rounded border px-2 py-1 text-xs" :class="eventHealthStatusClass(eventHealthByPluginId.get(submission.pluginId))">
                  {{ eventHealthStatusText(eventHealthByPluginId.get(submission.pluginId)) }}
                </span>
              </div>
              <div class="mt-3 rounded border border-themed bg-themed p-2 text-xs text-themed-muted">
                <div class="mb-2 flex items-center justify-between gap-3">
                  <span class="font-medium text-themed">事件告警订阅</span>
                  <span v-if="savingEventAlertPreference[submission.pluginId]" class="text-themed-muted">保存中...</span>
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      class="h-4 w-4"
                      :checked="eventAlertPreference(submission.pluginId).enabled"
                      @change="updateEventAlertPreference(submission.pluginId, { enabled: inputChecked($event) })"
                    >
                    <span>启用告警</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <span>最低级别</span>
                    <select
                      class="input h-8 flex-1 text-xs"
                      :value="eventAlertPreference(submission.pluginId).minimumLevel"
                      @change="updateEventAlertPreference(submission.pluginId, { minimumLevel: inputMinimumLevel($event) })"
                    >
                      <option value="warning">警告及以上</option>
                      <option value="critical">只看严重</option>
                    </select>
                  </label>
                  <label class="flex items-center gap-2">
                    <span>冷却</span>
                    <input
                      type="number"
                      min="15"
                      max="1440"
                      class="input h-8 w-24 text-xs"
                      :value="eventAlertPreference(submission.pluginId).cooldownMinutes"
                      @change="updateEventAlertPreference(submission.pluginId, { cooldownMinutes: inputNumber($event) })"
                    >
                    <span>分钟</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <span>窗口</span>
                    <input
                      type="number"
                      min="1"
                      max="168"
                      class="input h-8 w-20 text-xs"
                      :value="eventAlertPreference(submission.pluginId).recentWindowHours"
                      @change="updateEventAlertPreference(submission.pluginId, { recentWindowHours: inputNumber($event) })"
                    >
                    <span>小时</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      class="h-4 w-4"
                      :checked="eventAlertPreference(submission.pluginId).notifyOnDeadLetter"
                      @change="updateEventAlertPreference(submission.pluginId, { notifyOnDeadLetter: inputChecked($event) })"
                    >
                    <span>死信</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      class="h-4 w-4"
                      :checked="eventAlertPreference(submission.pluginId).notifyOnDueRetry"
                      @change="updateEventAlertPreference(submission.pluginId, { notifyOnDueRetry: inputChecked($event) })"
                    >
                    <span>到期重试</span>
                  </label>
                  <label class="flex items-center gap-2 sm:col-span-2">
                    <input
                      type="checkbox"
                      class="h-4 w-4"
                      :checked="eventAlertPreference(submission.pluginId).notifyOnSuccessRateBelow"
                      @change="updateEventAlertPreference(submission.pluginId, { notifyOnSuccessRateBelow: inputChecked($event) })"
                    >
                    <span>成功率低于</span>
                    <input
                      type="number"
                      min="50"
                      max="100"
                      class="input h-8 w-20 text-xs"
                      :value="eventAlertPreference(submission.pluginId).successRateThreshold"
                      @change="updateEventAlertPreference(submission.pluginId, { successRateThreshold: inputNumber($event) })"
                    >
                    <span>%</span>
                  </label>
                </div>
              </div>
              <div class="mt-3 grid grid-cols-3 gap-2 text-xs text-themed-muted">
                <div>成功：{{ eventHealthByPluginId.get(submission.pluginId)?.success || 0 }}</div>
                <div>待重试：{{ eventHealthByPluginId.get(submission.pluginId)?.retryPending || 0 }}</div>
                <div>死信：{{ eventHealthByPluginId.get(submission.pluginId)?.deadLetter || 0 }}</div>
                <div>去重：{{ eventHealthByPluginId.get(submission.pluginId)?.deduped || 0 }}</div>
                <div class="col-span-2">最后事件：{{ formatOptionalDate(eventHealthByPluginId.get(submission.pluginId)?.lastEventAt || null) }}</div>
              </div>
              <div class="mt-3 grid grid-cols-3 gap-2 rounded bg-themed-hover p-2 text-xs text-themed-muted">
                <div>最近 {{ eventHealthByPluginId.get(submission.pluginId)?.recentWindowHours || 24 }}h</div>
                <div>总量：{{ eventHealthByPluginId.get(submission.pluginId)?.recentTotal || 0 }}</div>
                <div>成功率：{{ formatEventSuccessRate(eventHealthByPluginId.get(submission.pluginId)?.recentSuccessRate) }}</div>
                <div>失败：{{ eventHealthByPluginId.get(submission.pluginId)?.recentFailed || 0 }}</div>
                <div>待重试：{{ eventHealthByPluginId.get(submission.pluginId)?.recentRetryPending || 0 }}</div>
                <div>死信：{{ eventHealthByPluginId.get(submission.pluginId)?.recentDeadLetter || 0 }}</div>
              </div>
              <div v-if="eventHealthByPluginId.get(submission.pluginId)?.trend?.length" class="mt-3 rounded border border-themed bg-themed-surface p-2 text-xs text-themed-muted">
                <div class="mb-2 font-medium text-themed">最近 {{ eventHealthByPluginId.get(submission.pluginId)?.trendWindowDays || 7 }} 日趋势</div>
                <div class="space-y-1">
                  <div
                    v-for="point in eventHealthByPluginId.get(submission.pluginId)?.trend || []"
                    :key="`${submission.pluginId}:trend:${point.date}`"
                    class="grid grid-cols-4 gap-2"
                  >
                    <span>{{ point.date }}</span>
                    <span>总 {{ point.total }}</span>
                    <span>成 {{ point.success }}</span>
                    <span>异 {{ point.failed + point.retryPending + point.deadLetter }}</span>
                  </div>
                </div>
              </div>
              <div v-if="eventHealthByPluginId.get(submission.pluginId)?.alerts?.length" class="mt-3 space-y-2">
                <div
                  v-for="alert in eventHealthByPluginId.get(submission.pluginId)?.alerts || []"
                  :key="`${submission.pluginId}:alert:${alert.code}`"
                  class="rounded border px-3 py-2 text-xs"
                  :class="eventHealthAlertClass(alert.level)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-medium">{{ alert.message }}</span>
                    <span class="shrink-0 tabular-nums">{{ alert.count }}</span>
                  </div>
                </div>
              </div>
              <p v-if="eventHealthByPluginId.get(submission.pluginId)?.lastError" class="mt-2 rounded bg-themed-hover p-2 text-xs text-red-600">
                {{ eventHealthByPluginId.get(submission.pluginId)?.lastError }}
              </p>
              <div v-if="eventHealthByPluginId.get(submission.pluginId)?.breakdown?.length" class="mt-3 space-y-2">
                <div
                  v-for="item in eventHealthByPluginId.get(submission.pluginId)?.breakdown || []"
                  :key="`${submission.pluginId}:${item.eventName}:${item.handler}`"
                  class="rounded border border-themed bg-themed p-2"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="truncate font-mono text-[11px] text-themed">{{ item.eventName }}</div>
                      <div class="truncate text-[11px] text-themed-muted">handler: {{ item.handler }}</div>
                    </div>
                    <span class="shrink-0 rounded border px-2 py-0.5 text-[11px]" :class="eventHealthStatusClass(item)">
                      {{ eventHealthStatusText(item) }}
                    </span>
                  </div>
                  <div class="mt-2 grid grid-cols-4 gap-1 text-[11px] text-themed-muted">
                    <div>成功 {{ item.success }}</div>
                    <div>重试 {{ item.retryPending }}</div>
                    <div>死信 {{ item.deadLetter }}</div>
                    <div>去重 {{ item.deduped }}</div>
                    <div class="col-span-2">最近 {{ item.recentWindowHours }}h {{ item.recentTotal }} 次</div>
                    <div class="col-span-2">成功率 {{ formatEventSuccessRate(item.recentSuccessRate) }}</div>
                    <div v-if="item.alerts?.length" class="col-span-4 flex flex-wrap gap-1">
                      <span
                        v-for="alert in item.alerts"
                        :key="`${submission.pluginId}:${item.eventName}:${item.handler}:alert:${alert.code}`"
                        class="rounded border px-1.5 py-0.5"
                        :class="eventHealthAlertClass(alert.level)"
                      >
                        {{ alert.message }}：{{ alert.count }}
                      </span>
                    </div>
                    <div class="col-span-4">最后事件 {{ formatOptionalDate(item.lastEventAt) }}</div>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </aside>
    </div>

    <!-- 新增/编辑弹窗 -->
    <InitCommandModal
      v-if="showCommandModal"
      :command="editingCommand"
      @close="onModalClose"
      @save="onModalSave"
    />

    <!-- 详情弹窗 -->
    <InitCommandDetailModal
      v-if="showDetailModal && viewingCommand"
      :command="viewingCommand"
      @close="closeDetailModal"
    />
  </div>
</template>
