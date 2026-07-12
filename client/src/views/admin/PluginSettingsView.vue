<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import PluginFrame from '@/components/plugins/PluginFrame.vue'
import type { PluginConfigFieldManifest, PluginConfigValue, PluginPageManifest, PluginRecord, TicketAiStatusResponse } from '@/types/api'

type AiMode = 'draft' | 'semi_auto' | 'auto'
type StandardConfigValue = string | number | boolean | string[]
type StandardConfigFieldEntry = [string, PluginConfigFieldManifest]

interface StandardConfigGroup {
  name: string
  fields: StandardConfigFieldEntry[]
}

interface AiTicketSettingsForm {
  enabled: boolean
  mode: AiMode
  model: string
  apiBaseUrl: string
  apiKey: string
  temperature: number
  timeoutMs: number
  autoReplyCategories: string[]
  confidenceThreshold: number
  dailyAutoReplyLimit: number
  ticketAutoReplyLimit: number
  cooldownSeconds: number
  showAiIdentity: boolean
  systemPrompt: string
}

const AI_TICKET_PLUGIN_ID = 'com.payincus.ai-ticket-agent'
const DEFAULT_CONFIG_GROUP = '基础配置'
const toast = useToast()
const route = useRoute()
const router = useRouter()

const loading = ref(true)
const saving = ref(false)
const statusLoading = ref(false)
const plugin = ref<PluginRecord | null>(null)
const configs = ref<PluginConfigValue[]>([])
const aiStatus = ref<TicketAiStatusResponse | null>(null)
const standardConfigForm = ref<Record<string, StandardConfigValue>>({})
const uploadingStandardConfigFileKey = ref<string | null>(null)
const form = ref<AiTicketSettingsForm>({
  enabled: false,
  mode: 'draft',
  model: 'gpt-4o-mini',
  apiBaseUrl: '',
  apiKey: '',
  temperature: 0.2,
  timeoutMs: 20000,
  autoReplyCategories: ['general', 'billing'],
  confidenceThreshold: 0.82,
  dailyAutoReplyLimit: 100,
  ticketAutoReplyLimit: 3,
  cooldownSeconds: 120,
  showAiIdentity: true,
  systemPrompt: ''
})

const modeOptions: Array<{ value: AiMode; label: string; description: string }> = [
  { value: 'draft', label: '只生成草稿', description: 'AI 只生成建议回复，不会发送。' },
  { value: 'semi_auto', label: '人工审核后接管', description: '管理员确认后由 AI 生成并发送回复。' },
  { value: 'auto', label: '自动接管低风险工单', description: '仅处理低风险、用户最后回复的官方/系统工单。' }
]

const categoryOptions = [
  { value: 'general', label: '通用咨询' },
  { value: 'billing', label: '账单计费' },
  { value: 'technical', label: '技术支持' },
  { value: 'abuse', label: '滥用与风控' }
]

const pluginId = computed(() => String(route.params.pluginId || ''))
const isAiTicketPlugin = computed(() => pluginId.value === AI_TICKET_PLUGIN_ID)
const hasStoredApiKey = computed(() => configs.value.some(config => config.key === 'apiKey' && config.isSecret))
const settingsPages = computed<PluginPageManifest[]>(() =>
  (plugin.value?.latestVersion?.manifest.entrypoints.adminPages || []).filter(page => page.slot === 'admin.plugins.settings')
)

function configFieldOrder([, field]: StandardConfigFieldEntry): number {
  return typeof field.order === 'number' && Number.isFinite(field.order) ? field.order : 1000
}

function configGroupName(field: PluginConfigFieldManifest): string {
  return field.group?.trim() || DEFAULT_CONFIG_GROUP
}

function sortConfigFields(fields: StandardConfigFieldEntry[]): StandardConfigFieldEntry[] {
  return fields.sort((left, right) => {
    const leftOrder = configFieldOrder(left)
    const rightOrder = configFieldOrder(right)
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return left[0].localeCompare(right[0])
  })
}

const standardConfigFields = computed<StandardConfigFieldEntry[]>(() =>
  sortConfigFields(Object.entries(plugin.value?.latestVersion?.manifest.configSchema || {}))
)
const standardConfigGroups = computed<StandardConfigGroup[]>(() => {
  const groups = new Map<string, StandardConfigFieldEntry[]>()
  for (const entry of standardConfigFields.value) {
    const groupName = configGroupName(entry[1])
    const fields = groups.get(groupName) || []
    fields.push(entry)
    groups.set(groupName, fields)
  }
  return Array.from(groups.entries())
    .map(([name, fields]) => ({ name, fields }))
    .sort((left, right) => {
      const leftOrder = configFieldOrder(left.fields[0])
      const rightOrder = configFieldOrder(right.fields[0])
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.name.localeCompare(right.name)
    })
})
const hasStandardConfigSchema = computed(() => standardConfigFields.value.length > 0)

function displayPluginName(value: PluginRecord | null): string {
  if (!value) return '扩展设置'
  if (value.pluginId === AI_TICKET_PLUGIN_ID) return 'AI 工单助手'
  return value.latestVersion?.manifest.name || value.name
}

function statusText(value: PluginRecord | null): string {
  if (!value) return '-'
  if (value.enabled) return '已启用'
  if (value.status === 'failed') return '异常'
  return '未启用'
}

function configValue(key: string): unknown {
  return configs.value.find(config => config.key === key)?.value
}

function booleanConfig(key: string, fallback: boolean): boolean {
  const value = configValue(key)
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase())
  return fallback
}

function stringConfig(key: string, fallback = ''): string {
  const value = configValue(key)
  return typeof value === 'string' ? value : fallback
}

function numberConfig(key: string, fallback: number): number {
  const value = configValue(key)
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function stringArrayConfig(key: string, fallback: string[]): string[] {
  const value = configValue(key)
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean)
  if (typeof value === 'string') {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }
  return fallback
}

function defaultStandardConfigValue(field: PluginConfigFieldManifest): StandardConfigValue {
  if (field.type === 'number') return field.min ?? 0
  if (field.type === 'checkbox') return field.default === true
  if (field.type === 'tags') return Array.isArray(field.default) ? field.default.map(item => String(item)).filter(Boolean) : []
  if (field.default === undefined || field.default === null) return ''
  return String(field.default)
}

function normalizeStandardConfigFormValue(field: PluginConfigFieldManifest, value: unknown): StandardConfigValue {
  if (field.type === 'checkbox') return value === true
  if (field.type === 'tags') return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
  if (field.type === 'number') {
    const numericValue = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numericValue) ? numericValue : Number(defaultStandardConfigValue(field))
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : String(defaultStandardConfigValue(field))
}

function syncStandardConfigForm(): void {
  const next: Record<string, StandardConfigValue> = {}
  for (const [key, field] of standardConfigFields.value) {
    if (field.type === 'placeholder') continue
    const stored = configs.value.find(config => config.key === key)
    if (stored?.isSecret) {
      next[key] = ''
    } else if (stored && stored.value !== null && stored.value !== undefined) {
      next[key] = normalizeStandardConfigFormValue(field, stored.value)
    } else {
      next[key] = defaultStandardConfigValue(field)
    }
  }
  standardConfigForm.value = next
}

function updateStandardTags(key: string, value: string): void {
  standardConfigForm.value[key] = value.split(',').map(item => item.trim()).filter(Boolean)
}

function updateStandardValue(key: string, field: PluginConfigFieldManifest, value: string): void {
  standardConfigForm.value[key] = field.type === 'number' ? Number(value) : value
}

async function uploadStandardConfigFile(key: string, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !plugin.value) return
  uploadingStandardConfigFileKey.value = key
  try {
    const result = await api.plugins.uploadConfigFile(plugin.value.pluginId, key, file)
    standardConfigForm.value[key] = result.value
    toast.success('文件已上传，请保存配置使其生效')
  } catch (error: any) {
    toast.error(error?.response?.data?.error || '文件上传失败')
  } finally {
    uploadingStandardConfigFileKey.value = null
    input.value = ''
  }
}

function standardStringValue(value: StandardConfigValue | undefined): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'true' : ''
  return value === undefined ? '' : String(value)
}

function standardTagsText(value: unknown): string {
  return Array.isArray(value) ? value.map(item => String(item)).join(', ') : ''
}

function notifyPluginConfigChanged(pluginId: string): void {
  window.dispatchEvent(new CustomEvent('payincus:plugin-config-refresh', {
    detail: { pluginId }
  }))
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function syncAiForm(): void {
  const mode = stringConfig('mode', 'draft')
  form.value = {
    enabled: booleanConfig('enabled', false),
    mode: mode === 'semi_auto' || mode === 'auto' ? mode : 'draft',
    model: stringConfig('model', 'gpt-4o-mini'),
    apiBaseUrl: stringConfig('apiBaseUrl', ''),
    apiKey: '',
    temperature: clampNumber(numberConfig('temperature', 0.2), 0, 2),
    timeoutMs: Math.max(Math.floor(numberConfig('timeoutMs', 20000)), 1000),
    autoReplyCategories: stringArrayConfig('autoReplyCategories', ['general', 'billing']),
    confidenceThreshold: clampNumber(numberConfig('confidenceThreshold', 0.82), 0, 1),
    dailyAutoReplyLimit: Math.max(Math.floor(numberConfig('dailyAutoReplyLimit', 100)), 0),
    ticketAutoReplyLimit: Math.max(Math.floor(numberConfig('ticketAutoReplyLimit', 3)), 0),
    cooldownSeconds: Math.max(Math.floor(numberConfig('cooldownSeconds', 120)), 0),
    showAiIdentity: booleanConfig('showAiIdentity', true),
    systemPrompt: stringConfig('systemPrompt', '')
  }
}

function toggleCategory(category: string, checked: boolean): void {
  const next = new Set(form.value.autoReplyCategories)
  if (checked) next.add(category)
  else next.delete(category)
  form.value.autoReplyCategories = Array.from(next)
}

function handleCategoryChange(category: string, event: Event): void {
  toggleCategory(category, (event.target as HTMLInputElement).checked)
}

async function loadAiStatus(): Promise<void> {
  if (!isAiTicketPlugin.value) return
  statusLoading.value = true
  try {
    aiStatus.value = await api.tickets.getAiStatus()
  } catch {
    aiStatus.value = null
  } finally {
    statusLoading.value = false
  }
}

async function loadPage(): Promise<void> {
  loading.value = true
  try {
    const response = await api.plugins.get(pluginId.value)
    plugin.value = response.plugin
    configs.value = response.configs
    if (isAiTicketPlugin.value) {
      syncAiForm()
      await loadAiStatus()
    }
    syncStandardConfigForm()
  } catch (err: any) {
    toast.error('加载扩展设置失败：' + (err?.message || String(err)))
    plugin.value = null
    configs.value = []
  } finally {
    loading.value = false
  }
}

async function saveStandardSettings(): Promise<void> {
  if (!plugin.value || !hasStandardConfigSchema.value) return
  saving.value = true
  try {
    const updates = standardConfigFields.value
      .filter(([, field]) => field.type !== 'placeholder')
      .map(([key, field]) => ({
        key,
        value: standardConfigForm.value[key],
        isSecret: field.secret === true || field.type === 'password'
      }))
    const response = await api.plugins.updateConfig(plugin.value.pluginId, updates)
    configs.value = response.configs
    syncStandardConfigForm()
    notifyPluginConfigChanged(plugin.value.pluginId)
    toast.success('扩展配置已保存')
  } catch (err: any) {
    toast.error('保存扩展配置失败：' + (err?.message || String(err)))
  } finally {
    saving.value = false
  }
}

async function saveAiSettings(): Promise<void> {
  if (!plugin.value || !isAiTicketPlugin.value) return
  saving.value = true
  try {
    const updates: Array<{ key: string; value: unknown; isSecret?: boolean }> = [
      { key: 'enabled', value: form.value.enabled },
      { key: 'mode', value: form.value.mode },
      { key: 'model', value: form.value.model.trim() || 'gpt-4o-mini' },
      { key: 'apiBaseUrl', value: form.value.apiBaseUrl.trim() },
      { key: 'temperature', value: clampNumber(Number(form.value.temperature), 0, 2) },
      { key: 'timeoutMs', value: Math.max(Math.floor(Number(form.value.timeoutMs)), 1000) },
      { key: 'autoReplyCategories', value: form.value.autoReplyCategories },
      { key: 'confidenceThreshold', value: clampNumber(Number(form.value.confidenceThreshold), 0, 1) },
      { key: 'dailyAutoReplyLimit', value: Math.max(Math.floor(Number(form.value.dailyAutoReplyLimit)), 0) },
      { key: 'ticketAutoReplyLimit', value: Math.max(Math.floor(Number(form.value.ticketAutoReplyLimit)), 0) },
      { key: 'cooldownSeconds', value: Math.max(Math.floor(Number(form.value.cooldownSeconds)), 0) },
      { key: 'showAiIdentity', value: form.value.showAiIdentity },
      { key: 'systemPrompt', value: form.value.systemPrompt.trim() }
    ]

    const nextApiKey = form.value.apiKey.trim()
    if (nextApiKey) {
      updates.push({ key: 'apiKey', value: nextApiKey, isSecret: true })
    }

    const response = await api.plugins.updateConfig(plugin.value.pluginId, updates)
    configs.value = response.configs
    syncAiForm()
    await loadAiStatus()
    notifyPluginConfigChanged(plugin.value.pluginId)
    toast.success('AI 工单助手设置已保存')
  } catch (err: any) {
    toast.error('保存 AI 工单助手设置失败：' + (err?.message || String(err)))
  } finally {
    saving.value = false
  }
}

watch(pluginId, () => {
  void loadPage()
})

onMounted(() => {
  void loadPage()
})
</script>

<template>
  <div class="kawaii-page p-6 space-y-6 animate-fade-in">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div class="min-w-0">
        <button class="nimbus-back" @click="router.push('/admin/plugins')">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          返回扩展中心
        </button>
        <div class="mt-3 flex items-center gap-3">
          <span class="nimbus-title-icon">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
            </svg>
          </span>
          <div class="min-w-0">
            <h1 class="page-title">{{ displayPluginName(plugin) }}</h1>
            <p class="page-description">独立扩展设置页。扩展安装、启用和卸载仍在扩展中心维护。</p>
          </div>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-secondary" :disabled="loading" @click="loadPage">
          <svg class="h-4 w-4" :class="{ 'animate-spin': loading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          {{ loading ? '加载中...' : '刷新' }}
        </button>
        <button
          v-if="isAiTicketPlugin && plugin"
          class="btn btn-primary"
          :disabled="saving || loading"
          @click="saveAiSettings"
        >
          {{ saving ? '保存中...' : '保存设置' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="py-16 text-center text-themed-muted">加载中...</div>

    <template v-else-if="plugin">
      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="card nimbus-stat p-4">
          <div class="nimbus-stat-label">插件状态</div>
          <div class="nimbus-stat-value">{{ statusText(plugin) }}</div>
        </div>
        <div class="card nimbus-stat p-4">
          <div class="nimbus-stat-label">插件版本</div>
          <div class="nimbus-stat-value">{{ plugin.currentVersion || '-' }}</div>
        </div>
        <div class="card nimbus-stat p-4">
          <div class="nimbus-stat-label">来源</div>
          <div class="nimbus-stat-value">{{ plugin.sourceType === 'market' ? '扩展市场' : '上传安装' }}</div>
        </div>
        <div class="card nimbus-stat p-4">
          <div class="nimbus-stat-label">插件 ID</div>
          <div class="mt-2 truncate font-mono text-sm text-themed">{{ plugin.pluginId }}</div>
        </div>
      </section>

      <section v-if="isAiTicketPlugin" class="space-y-6">
        <div class="card p-6">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-themed pb-4">
            <div class="flex items-center gap-2">
              <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
              <h2 class="text-base font-semibold text-themed">运行状态</h2>
            </div>
            <button class="btn btn-secondary btn-sm" :disabled="statusLoading" @click="loadAiStatus">{{ statusLoading ? '读取中...' : '刷新状态' }}</button>
          </div>
          <p class="mb-4 text-sm text-themed-muted">状态接口不会返回模型地址、密钥、后台路径或用户数据。</p>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div class="nimbus-metric">
              <div class="nimbus-metric-label">模型配置</div>
              <div class="nimbus-metric-value">{{ aiStatus?.config.modelConfigured ? '已配置' : '未配置' }}</div>
            </div>
            <div class="nimbus-metric">
              <div class="nimbus-metric-label">自动接管</div>
              <div class="nimbus-metric-value">{{ aiStatus?.automation.autoReplyActive ? '已激活' : '未激活' }}</div>
            </div>
            <div class="nimbus-metric">
              <div class="nimbus-metric-label">回复权限</div>
              <div class="nimbus-metric-value">{{ aiStatus?.permissions.reply ? '允许' : '未允许' }}</div>
            </div>
            <div class="nimbus-metric">
              <div class="nimbus-metric-label">扫描间隔</div>
              <div class="nimbus-metric-value">{{ aiStatus?.automation.scanIntervalSeconds || 120 }} 秒</div>
            </div>
          </div>
        </div>

        <div v-if="!plugin.enabled" class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span>扩展当前未启用。请先在扩展中心启用扩展，然后再保存和使用 AI 工单助手配置。</span>
        </div>

        <form class="space-y-6" @submit.prevent="saveAiSettings">
          <section class="card p-6">
            <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
              <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M6 13.5V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 9.75V10.5" />
              </svg>
              <h2 class="text-base font-semibold text-themed">基础设置</h2>
            </div>
            <div class="grid gap-4 lg:grid-cols-2">
              <label class="flex items-start gap-3 rounded-xl border border-themed bg-themed-surface p-4 transition-colors hover:border-themed-secondary">
                <input v-model="form.enabled" type="checkbox" class="mt-1 rounded border-themed text-primary-600 focus:ring-primary-500" />
                <span>
                  <span class="block text-sm font-medium text-themed">启用 AI 工单助手</span>
                  <span class="mt-1 block text-xs text-themed-muted">关闭后不会生成草稿，也不会执行自动接管。</span>
                </span>
              </label>
              <label class="flex items-start gap-3 rounded-xl border border-themed bg-themed-surface p-4 transition-colors hover:border-themed-secondary">
                <input v-model="form.showAiIdentity" type="checkbox" class="mt-1 rounded border-themed text-primary-600 focus:ring-primary-500" />
                <span>
                  <span class="block text-sm font-medium text-themed">回复中展示 AI 身份</span>
                  <span class="mt-1 block text-xs text-themed-muted">开启后，AI 回复会明确说明由 AI 助手生成。</span>
                </span>
              </label>
            </div>

            <div class="mt-5">
              <span class="nimbus-field-label">接管模式</span>
              <div class="mt-2 grid gap-3 lg:grid-cols-3">
                <label
                  v-for="option in modeOptions"
                  :key="option.value"
                  class="cursor-pointer rounded-xl border p-4 transition-colors"
                  :class="form.mode === option.value ? 'border-primary-500 bg-themed-hover dark:border-primary-400' : 'border-themed bg-themed-surface hover:border-themed-secondary'"
                >
                  <input v-model="form.mode" class="sr-only" type="radio" :value="option.value" />
                  <span class="block text-sm font-medium text-themed">{{ option.label }}</span>
                  <span class="mt-1 block text-xs leading-6 text-themed-muted">{{ option.description }}</span>
                </label>
              </div>
            </div>
          </section>

          <section class="card p-6">
            <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
              <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z" />
              </svg>
              <h2 class="text-base font-semibold text-themed">模型配置</h2>
            </div>
            <div class="grid gap-4 lg:grid-cols-2">
              <label class="space-y-1.5">
                <span class="nimbus-field-label">OpenAI 兼容接口地址</span>
                <input v-model.trim="form.apiBaseUrl" class="input" placeholder="https://api.openai.com/v1" />
              </label>
              <label class="space-y-1.5">
                <span class="nimbus-field-label">模型名称</span>
                <input v-model.trim="form.model" class="input" placeholder="gpt-4o-mini" />
              </label>
              <label class="space-y-1.5">
                <span class="nimbus-field-label">模型 API Key</span>
                <input
                  v-model.trim="form.apiKey"
                  type="password"
                  class="input font-mono"
                  :placeholder="hasStoredApiKey ? '已保存密钥，留空则保持不变' : '请输入模型 API Key'"
                />
                <span class="block text-xs text-themed-muted">保存后密钥会加密存储，页面不会回显。</span>
              </label>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">模型温度</span>
                  <input v-model.number="form.temperature" type="number" min="0" max="2" step="0.1" class="input" />
                </label>
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">请求超时（毫秒）</span>
                  <input v-model.number="form.timeoutMs" type="number" min="1000" step="1000" class="input" />
                </label>
              </div>
            </div>
          </section>

          <section class="card p-6">
            <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
              <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
              <h2 class="text-base font-semibold text-themed">自动回复策略</h2>
            </div>
            <div class="grid gap-4 lg:grid-cols-2">
              <div>
                <div class="nimbus-field-label">允许自动回复的工单分类</div>
                <div class="mt-2 grid gap-2 sm:grid-cols-2">
                  <label v-for="category in categoryOptions" :key="category.value" class="flex items-center gap-2 rounded-xl border border-themed bg-themed-surface p-3">
                    <input
                      type="checkbox"
                      class="rounded border-themed text-primary-600 focus:ring-primary-500"
                      :checked="form.autoReplyCategories.includes(category.value)"
                      @change="handleCategoryChange(category.value, $event)"
                    />
                    <span class="text-sm text-themed">{{ category.label }}</span>
                  </label>
                </div>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">自动回复置信度阈值</span>
                  <input v-model.number="form.confidenceThreshold" type="number" min="0" max="1" step="0.01" class="input" />
                </label>
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">每日自动回复上限</span>
                  <input v-model.number="form.dailyAutoReplyLimit" type="number" min="0" step="1" class="input" />
                </label>
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">单工单自动回复上限</span>
                  <input v-model.number="form.ticketAutoReplyLimit" type="number" min="0" step="1" class="input" />
                </label>
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">冷却时间（秒）</span>
                  <input v-model.number="form.cooldownSeconds" type="number" min="0" step="1" class="input" />
                </label>
              </div>
            </div>
            <p class="mt-4 rounded-xl border border-themed bg-themed-surface p-3 text-sm leading-6 text-themed-muted">
              自动模式仍会强制转人工处理退款、争议、账号安全、风控、数据恢复、删除/重装/迁移实例、凭据、后台细节和交付异常。
            </p>
          </section>

          <section class="card p-6">
            <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
              <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
              </svg>
              <h2 class="text-base font-semibold text-themed">自定义提示词</h2>
            </div>
            <textarea
              v-model="form.systemPrompt"
              class="input min-h-36 resize-y"
              placeholder="留空则使用系统默认安全提示词。"
            ></textarea>
            <div class="mt-4 flex justify-end">
              <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存设置' }}</button>
            </div>
          </section>
        </form>
      </section>

      <section v-else class="space-y-6">
        <form v-if="hasStandardConfigSchema" class="card p-6" @submit.prevent="saveStandardSettings">
          <div class="mb-5 flex flex-col gap-3 border-b border-themed pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="flex items-start gap-2">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
              </svg>
              <div>
                <h2 class="text-base font-semibold text-themed">标准配置</h2>
                <p class="mt-0.5 text-sm text-themed-muted">这些字段由扩展 manifest 的 configSchema 声明，保存时会按字段类型和必填规则校验。</p>
              </div>
            </div>
            <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存配置' }}</button>
          </div>

          <div class="space-y-6">
            <div
              v-for="group in standardConfigGroups"
              :key="group.name"
            >
              <h3 class="text-sm font-semibold text-themed">{{ group.name }}</h3>
              <div class="mt-3 grid gap-4 lg:grid-cols-2">
                <div
                  v-for="[key, field] in group.fields"
                  :key="key"
                  class="rounded-xl border border-themed bg-themed-surface p-4"
                  :class="field.type === 'placeholder' ? 'lg:col-span-2' : ''"
                >
                  <div v-if="field.type === 'placeholder'" class="text-sm leading-6 text-themed-muted">
                    <div class="font-medium text-themed">{{ field.label }}</div>
                    <p v-if="field.description" class="mt-1">{{ field.description }}</p>
                  </div>

                  <label v-else-if="field.type === 'checkbox'" class="flex items-start gap-3">
                    <input v-model="standardConfigForm[key]" type="checkbox" class="mt-1 rounded border-themed text-primary-600 focus:ring-primary-500" />
                    <span>
                      <span class="block font-medium text-themed">{{ field.label }}<span v-if="field.required" class="text-rose-600 dark:text-rose-400"> *</span></span>
                      <span v-if="field.description" class="mt-1 block text-sm text-themed-muted">{{ field.description }}</span>
                    </span>
                  </label>

                  <label v-else class="block space-y-1.5">
                    <span class="nimbus-field-label">{{ field.label }}<span v-if="field.required" class="text-rose-600 dark:text-rose-400"> *</span></span>
                    <textarea
                      v-if="field.type === 'textarea' || field.type === 'markdown'"
                      :value="standardStringValue(standardConfigForm[key])"
                      class="input min-h-28 resize-y"
                      :placeholder="field.placeholder"
                      @input="updateStandardValue(key, field, ($event.target as HTMLTextAreaElement).value)"
                    ></textarea>
                    <select
                      v-else-if="field.type === 'select'"
                      :value="standardStringValue(standardConfigForm[key])"
                      class="input"
                      @change="updateStandardValue(key, field, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">请选择</option>
                      <option v-for="option in field.options || []" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <input
                      v-else-if="field.type === 'tags'"
                      class="input"
                      :value="standardTagsText(standardConfigForm[key])"
                      :placeholder="field.placeholder || '用英文逗号分隔'"
                      @input="updateStandardTags(key, ($event.target as HTMLInputElement).value)"
                    />
                    <div v-else-if="field.type === 'file'" class="space-y-2">
                      <input
                        class="block w-full text-sm text-themed file:mr-3 file:rounded file:border-0 file:bg-primary-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-primary-700"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        :disabled="uploadingStandardConfigFileKey === key"
                        @change="uploadStandardConfigFile(key, $event)"
                      />
                      <div class="flex flex-wrap items-center gap-3 text-xs text-themed-muted">
                        <span v-if="uploadingStandardConfigFileKey === key">上传中...</span>
                        <a
                          v-if="standardStringValue(standardConfigForm[key])"
                          class="text-primary-600 hover:underline"
                          :href="standardStringValue(standardConfigForm[key])"
                          target="_blank"
                          rel="noreferrer"
                        >查看当前文件</a>
                      </div>
                    </div>
                    <input
                      v-else
                      :value="standardStringValue(standardConfigForm[key])"
                      class="input"
                      :type="field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : field.type === 'color' ? 'color' : 'text'"
                      :min="field.min"
                      :max="field.max"
                      :step="field.step"
                      :placeholder="field.type === 'password' ? '留空则保持已有密钥' : field.placeholder"
                      @input="updateStandardValue(key, field, ($event.target as HTMLInputElement).value)"
                    />
                    <span v-if="field.description" class="block text-xs text-themed-muted">{{ field.description }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </form>

        <section class="card p-6">
          <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
            <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M14.25 9.75 16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z" />
            </svg>
            <h2 class="text-base font-semibold text-themed">扩展设置页面</h2>
          </div>
          <p class="text-sm text-themed-muted">扩展也可以继续提供自定义后台设置页。</p>
          <div v-if="!plugin.enabled" class="mt-4 rounded-xl border border-themed bg-themed-surface p-4 text-sm text-themed-muted">
            插件启用后可以打开设置页面。
          </div>
          <div v-else-if="settingsPages.length" class="mt-5 space-y-4">
            <PluginFrame
              v-for="page in settingsPages"
              :key="page.entry"
              :title="page.title"
              :url="`/api/plugins/assets/${encodeURIComponent(plugin.pluginId)}/${page.entry}`"
            />
          </div>
          <div v-else class="mt-4 rounded-xl border border-themed bg-themed-surface p-4 text-sm text-themed-muted">
            该扩展没有声明自定义后台设置页面。
          </div>
        </section>
      </section>
    </template>

    <div v-else class="card p-10 text-center">
      <div class="nimbus-empty-icon mx-auto mb-4">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
        </svg>
      </div>
      <h2 class="text-lg font-semibold text-themed">插件不存在</h2>
      <p class="mt-2 text-sm text-themed-muted">请返回扩展中心确认扩展是否已安装。</p>
      <button class="btn btn-primary mt-4" @click="router.push('/admin/plugins')">返回扩展中心</button>
    </div>
  </div>
</template>

<style scoped>
.nimbus-back {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--kawaii-muted);
  transition: color 0.12s ease;
}

.nimbus-back:hover {
  color: var(--kawaii-text);
}

.nimbus-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kawaii-primary) 28%, transparent);
}

.nimbus-stat {
  position: relative;
  overflow: hidden;
}

.nimbus-stat::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 2.25rem;
  height: 2px;
  background: var(--kawaii-primary);
  border-radius: 0 0 2px 0;
}

.nimbus-stat-label {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
}

.nimbus-stat-value {
  margin-top: 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.1;
  color: var(--kawaii-text);
  font-variant-numeric: tabular-nums;
}

.nimbus-metric {
  border-radius: 0.625rem;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface-soft);
  padding: 0.75rem 0.875rem;
}

.nimbus-metric-label {
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
}

.nimbus-metric-value {
  margin-top: 0.35rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--kawaii-text);
}

.nimbus-field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--kawaii-muted);
}

.nimbus-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  border-radius: 9999px;
  color: var(--kawaii-muted);
  background: color-mix(in srgb, var(--kawaii-muted) 12%, transparent);
}
</style>
