<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type { DeliveryAssuranceCaseStatus, DeliveryCaseContext, DeliveryOverview, DeliveryTaskContext, InstanceTaskStatus } from '@/types/api'

const toast = useToast()

const loading = ref(true)
const refreshing = ref(false)
const overview = ref<DeliveryOverview | null>(null)
const tasks = ref<DeliveryTaskContext[]>([])
const repairCases = ref<DeliveryCaseContext[]>([])
const selectedTaskId = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const totalPages = ref(1)
const repairPage = ref(1)
const repairPageSize = ref(10)
const repairTotal = ref(0)
const repairTotalPages = ref(1)
const statusFilter = ref<'all' | InstanceTaskStatus>('all')
const repairStatusFilter = ref<'all' | DeliveryAssuranceCaseStatus>('all')
const search = ref('')
const repairSearch = ref('')
const actionLoading = ref<string | null>(null)
const caseActionLoading = ref<string | null>(null)
const actionNote = ref('')
const caseActionNote = ref('')
const notifyMode = ref<'delayed' | 'recovered' | 'contact_support'>('contact_support')

const statusOptions: Array<{ value: 'all' | InstanceTaskStatus; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'PENDING', label: '等待中' },
  { value: 'PROCESSING', label: '处理中' },
  { value: 'FAILED', label: '失败' },
  { value: 'COMPLETED', label: '成功' }
]

const caseStatusOptions: Array<{ value: 'all' | DeliveryAssuranceCaseStatus; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'pending_manual', label: '待人工处理' },
  { value: 'auto_retryable', label: '可自动重试' },
  { value: 'in_progress', label: '处理中' },
  { value: 'recovered', label: '已恢复' },
  { value: 'closed', label: '已关闭' }
]

const summary = computed(() => overview.value?.summary)
const selectedTask = computed(() =>
  tasks.value.find(task => task.id === selectedTaskId.value) ||
  overview.value?.recentFailures.find(task => task.id === selectedTaskId.value) ||
  tasks.value[0] ||
  overview.value?.recentFailures[0] ||
  null
)

const taskRiskItems = computed(() => {
  const data = summary.value
  if (!data) return []
  return [
    {
      label: '等待交付',
      value: data.pending,
      caption: '排队中的实例任务',
      tone: data.pending > 0 ? 'warning' : 'neutral'
    },
    {
      label: '正在交付',
      value: data.processing,
      caption: '执行中的实例任务',
      tone: data.processing > 0 ? 'info' : 'neutral'
    },
    {
      label: '24h 失败',
      value: data.failedLast24h,
      caption: '需要人工关注',
      tone: data.failedLast24h > 0 ? 'danger' : 'success'
    },
    {
      label: '疑似卡住',
      value: data.staleProcessing,
      caption: '处理超过 30 分钟',
      tone: data.staleProcessing > 0 ? 'danger' : 'success'
    }
  ]
})

const notificationItems = computed(() => {
  const data = summary.value
  if (!data) return []
  return [
    { label: '24h 通知成功', value: data.notificationSentLast24h, tone: 'success' },
    { label: '24h 通知失败', value: data.notificationFailedLast24h, tone: data.notificationFailedLast24h > 0 ? 'danger' : 'neutral' },
    { label: '用户通知通道', value: data.enabledUserChannels, tone: 'info' },
    { label: '全局通知通道', value: data.enabledGlobalChannels, tone: 'info' }
  ]
})

const caseItems = computed(() => {
  const data = summary.value
  if (!data) return []
  return [
    { label: '待人工处理', value: data.casesPendingManual, tone: data.casesPendingManual > 0 ? 'danger' : 'success' },
    { label: '可自动重试', value: data.casesAutoRetryable, tone: data.casesAutoRetryable > 0 ? 'warning' : 'success' },
    { label: '处理中', value: data.casesInProgress, tone: data.casesInProgress > 0 ? 'info' : 'neutral' },
    { label: '已恢复 / 已关闭', value: data.casesRecovered + data.casesClosed, tone: 'neutral' }
  ]
})

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function taskTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    start: '启动',
    stop: '停止',
    restart: '重启',
    rebuild: '重装',
    clone: '克隆',
    recreate: '重建',
    change_host: '改节点'
  }
  return labels[type] || type
}

function issueTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    task_failed: '任务失败',
    task_stale: '任务卡住',
    host_offline: '节点离线',
    agent_offline: 'Agent 离线',
    resource_pressure: '资源压力',
    plan_upgrade_sync_failed: '升级同步失败'
  }
  return labels[type] || type
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: '等待中',
    PROCESSING: '处理中',
    COMPLETED: '成功',
    FAILED: '失败'
  }
  return labels[status] || status
}

function caseStatusLabel(status: DeliveryAssuranceCaseStatus | null | undefined): string {
  const labels: Record<DeliveryAssuranceCaseStatus, string> = {
    pending_manual: '待人工处理',
    auto_retryable: '可自动重试',
    in_progress: '处理中',
    recovered: '已恢复',
    closed: '已关闭'
  }
  return status ? labels[status] || status : '未生成'
}

function caseStatusClass(status: DeliveryAssuranceCaseStatus | null | undefined): string {
  if (status === 'auto_retryable') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
  if (status === 'pending_manual') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
  if (status === 'in_progress') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300'
  if (status === 'recovered') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
  if (status === 'closed') return 'border-themed bg-themed-tertiary text-themed-muted'
  return 'border-themed bg-themed-secondary text-themed-muted'
}

function badgeClass(status: string): string {
  if (status === 'COMPLETED') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
  if (status === 'FAILED') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
  if (status === 'PROCESSING') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300'
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
}

function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return `¥${Number(value).toFixed(2)}`
}

function formatAgent(task: DeliveryTaskContext): string {
  const agent = task.host?.agent
  if (!agent) return '未安装'
  const lastSeen = agent.lastSeenAt ? formatDate(agent.lastSeenAt) : '无心跳'
  return `${agent.status}${agent.version ? ` · ${agent.version}` : ''} · ${lastSeen}`
}

function updateSelectedCase(updatedCase: NonNullable<DeliveryTaskContext['assuranceCase']>) {
  const update = (task: DeliveryTaskContext) => {
    if (task.id === updatedCase.taskId) task.assuranceCase = updatedCase
  }
  tasks.value.forEach(update)
  overview.value?.recentFailures.forEach(update)
}

async function runCaseAction(action: 'takeover' | 'retry' | 'notify' | 'recovered' | 'closed') {
  if (!selectedTask.value || actionLoading.value) return
  const task = selectedTask.value
  actionLoading.value = action
  try {
    if (action === 'takeover') {
      const res = await api.delivery.takeover(task.id, actionNote.value || null)
      updateSelectedCase(res.case)
      toast.success('已接管交付问题')
    } else if (action === 'retry') {
      const res = await api.delivery.retry(task.id, actionNote.value || null)
      updateSelectedCase(res.case)
      toast.success(`已重新入队任务 #${res.retryTaskId}`)
    } else if (action === 'notify') {
      const res = await api.delivery.notifyUser(task.id, notifyMode.value, actionNote.value || null)
      updateSelectedCase(res.case)
      toast.success(res.message || '通知已提交')
    } else {
      const res = await api.delivery.resolve(task.id, action, actionNote.value || null)
      updateSelectedCase(res.case)
      toast.success(action === 'recovered' ? '已标记恢复' : '已关闭交付问题')
    }
    actionNote.value = ''
    await loadOverview()
  } catch (err: any) {
    toast.error('交付保障操作失败：' + (err?.message || String(err)))
  } finally {
    actionLoading.value = null
  }
}

function updateRepairCase(updatedCase: NonNullable<DeliveryCaseContext['assuranceCase']>) {
  repairCases.value.forEach(item => {
    if (item.assuranceCase.id === updatedCase.id) {
      item.assuranceCase = updatedCase
    }
  })
}

async function runRepairCaseAction(item: DeliveryCaseContext, action: 'retry-sync' | 'recovered' | 'closed') {
  if (caseActionLoading.value) return
  const actionKey = `${action}:${item.id}`
  caseActionLoading.value = actionKey
  try {
    if (action === 'retry-sync') {
      const res = await api.delivery.retrySyncCase(item.id, caseActionNote.value || null)
      updateRepairCase(res.case)
      toast.success('已重试同步 Incus 资源配置')
    } else {
      const res = await api.delivery.resolveCase(item.id, action, caseActionNote.value || null)
      updateRepairCase(res.case)
      toast.success(action === 'recovered' ? '已标记恢复' : '已关闭修复任务')
    }
    caseActionNote.value = ''
    await Promise.all([loadOverview(), loadRepairCases()])
  } catch (err: any) {
    toast.error('升级同步修复操作失败：' + (err?.message || String(err)))
    await loadRepairCases()
  } finally {
    caseActionLoading.value = null
  }
}

function toneClass(tone: string): string {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
  if (tone === 'info') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300'
  return 'border-themed bg-themed-secondary text-themed'
}

async function loadOverview() {
  overview.value = await api.delivery.overview()
}

async function loadTasks() {
  const response = await api.delivery.tasks({
    page: page.value,
    pageSize: pageSize.value,
    status: statusFilter.value === 'all' ? undefined : statusFilter.value,
    search: search.value.trim() || undefined
  })
  tasks.value = response.tasks
  total.value = response.total
  totalPages.value = response.totalPages || 1
  if (selectedTaskId.value && !tasks.value.some(task => task.id === selectedTaskId.value)) {
    selectedTaskId.value = null
  }
  if (!selectedTaskId.value && tasks.value.length > 0) {
    selectedTaskId.value = tasks.value[0].id
  }
}

async function loadRepairCases() {
  const response = await api.delivery.cases({
    page: repairPage.value,
    pageSize: repairPageSize.value,
    status: repairStatusFilter.value === 'all' ? undefined : repairStatusFilter.value,
    search: repairSearch.value.trim() || undefined
  })
  repairCases.value = response.cases
  repairTotal.value = response.total
  repairTotalPages.value = response.totalPages || 1
}

async function refreshAll(silent = false) {
  if (silent) refreshing.value = true
  else loading.value = true
  try {
    await Promise.all([loadOverview(), loadTasks(), loadRepairCases()])
  } catch (err: any) {
    toast.error('加载交付保障中心失败：' + (err?.message || String(err)))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function applyFilters() {
  page.value = 1
  void refreshAll()
}

function resetFilters() {
  statusFilter.value = 'all'
  search.value = ''
  applyFilters()
}

function applyRepairFilters() {
  repairPage.value = 1
  void refreshAll()
}

function resetRepairFilters() {
  repairStatusFilter.value = 'all'
  repairSearch.value = ''
  applyRepairFilters()
}

function goPage(nextPage: number) {
  page.value = Math.min(Math.max(nextPage, 1), totalPages.value)
  void refreshAll()
}

function goRepairPage(nextPage: number) {
  repairPage.value = Math.min(Math.max(nextPage, 1), repairTotalPages.value)
  void refreshAll()
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <div class="kawaii-page nimbus-view space-y-6 p-6 animate-fade-in">
    <header class="flex flex-col gap-4 border-b border-themed pb-5 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex items-start gap-3">
        <span class="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500 sm:flex">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
        </span>
        <div>
          <h1 class="text-xl font-semibold text-themed sm:text-2xl">交付保障</h1>
          <p class="mt-1 text-sm text-themed-muted">跟踪实例交付任务、失败原因和通知投递状态。</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary" :disabled="refreshing" @click="refreshAll(true)">
          <svg class="h-4 w-4" :class="refreshing ? 'animate-spin' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          {{ refreshing ? '刷新中...' : '刷新' }}
        </button>
        <RouterLink class="btn-secondary" to="/admin/logs">查看日志</RouterLink>
      </div>
    </header>

    <div v-if="loading" class="rounded-xl border border-themed bg-themed-surface p-10 text-center text-sm text-themed-muted">
      加载中...
    </div>

    <template v-else>
      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="item in taskRiskItems"
          :key="item.label"
          class="nimbus-stat rounded-xl border border-themed bg-themed-surface p-5"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs font-medium uppercase tracking-wide text-themed-muted">{{ item.label }}</span>
            <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            </span>
          </div>
          <div class="mt-3 font-mono text-3xl font-semibold tabular-nums text-themed">{{ item.value }}</div>
          <div class="mt-3 inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium" :class="toneClass(item.tone)">
            {{ item.caption }}
          </div>
        </div>
      </section>

      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="item in caseItems"
          :key="item.label"
          class="flex items-center justify-between gap-3 rounded-xl border border-themed bg-themed-surface px-4 py-3.5"
        >
          <span class="text-sm text-themed-secondary">{{ item.label }}</span>
          <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-sm font-semibold tabular-nums" :class="toneClass(item.tone)">
            {{ item.value }}
          </span>
        </div>
      </section>

      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="item in notificationItems"
          :key="item.label"
          class="flex items-center justify-between gap-3 rounded-xl border border-themed bg-themed-surface px-4 py-3.5"
        >
          <span class="text-sm text-themed-secondary">{{ item.label }}</span>
          <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-sm font-semibold tabular-nums" :class="toneClass(item.tone)">
            {{ item.value }}
          </span>
        </div>
      </section>

      <section class="overflow-hidden rounded-xl border border-themed bg-themed-surface">
        <div class="border-b border-themed p-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div class="min-w-[220px]">
              <h2 class="text-base font-semibold text-themed">升级同步修复</h2>
              <p class="mt-1 text-sm text-themed-muted">处理方案升级已扣费但 Incus 资源或带宽未同步的实例。</p>
            </div>
            <div class="min-w-[180px] lg:ml-auto">
              <label class="mb-1 block text-2xs uppercase tracking-wide text-themed-muted">状态</label>
              <select v-model="repairStatusFilter" class="input w-full" @change="applyRepairFilters">
                <option v-for="option in caseStatusOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
            <div class="min-w-[240px] flex-1">
              <label class="mb-1 block text-2xs uppercase tracking-wide text-themed-muted">搜索</label>
              <input
                v-model.trim="repairSearch"
                class="input w-full"
                placeholder="Case ID、实例 ID 或标题"
                @keyup.enter="applyRepairFilters"
              />
            </div>
            <button class="btn-primary" @click="applyRepairFilters">搜索</button>
            <button class="btn-secondary" @click="resetRepairFilters">重置</button>
          </div>
          <textarea
            v-model="caseActionNote"
            class="input mt-3 min-h-[64px] w-full resize-y"
            maxlength="500"
            placeholder="可选：填写本次同步修复或人工结案备注"
          />
        </div>

        <div class="space-y-3 p-4 lg:hidden">
          <div v-if="repairCases.length === 0" class="rounded-xl border border-dashed border-themed p-10 text-center text-sm text-themed-muted">
            <span class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </span>
            暂无升级同步修复任务
          </div>
          <div
            v-for="item in repairCases"
            :key="item.id"
            class="rounded-xl border border-themed bg-themed-surface p-4 text-sm"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-semibold text-themed"><span class="font-mono">#{{ item.id }}</span> {{ issueTypeLabel(item.assuranceCase.issueType) }}</div>
                <div class="mt-1 text-xs text-themed-muted">
                  {{ item.instance?.name || `#${item.instanceId}` }} · {{ item.user?.username || `用户 #${item.userId}` }}
                </div>
              </div>
              <span class="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium" :class="caseStatusClass(item.assuranceCase.status)">
                {{ caseStatusLabel(item.assuranceCase.status) }}
              </span>
            </div>
            <div class="mt-3 grid gap-2 text-xs text-themed-muted sm:grid-cols-2">
              <div class="rounded-lg bg-themed-tertiary p-2.5">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">节点</div>
                <div class="mt-1 text-themed">{{ item.host?.name || `节点 #${item.hostId}` }}</div>
              </div>
              <div class="rounded-lg bg-themed-tertiary p-2.5">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">最近扣费</div>
                <div class="mt-1 font-mono tabular-nums text-themed">{{ formatAmount(item.billing?.amount) }} · {{ formatDate(item.billing?.createdAt) }}</div>
              </div>
              <div class="rounded-lg bg-themed-tertiary p-2.5 sm:col-span-2">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">目标资源</div>
                <div class="mt-1 font-mono tabular-nums text-themed">
                  CPU {{ item.instance?.cpu ?? '-' }}% / 内存 {{ item.instance?.memory ?? '-' }} MB / 磁盘 {{ item.instance?.disk ?? '-' }} MB
                </div>
                <div class="mt-1 font-mono tabular-nums text-themed">带宽 {{ item.instance?.limitsIngress || '不限速' }} / {{ item.instance?.limitsEgress || '不限速' }}</div>
              </div>
              <div class="rounded-lg bg-themed-tertiary p-2.5 sm:col-span-2">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">错误</div>
                <div class="mt-1 break-words text-themed">{{ item.assuranceCase.lastError || item.assuranceCase.title }}</div>
                <div v-if="item.assuranceCase.handledByUsername" class="mt-1 text-themed-muted">
                  {{ item.assuranceCase.handledByUsername }} · {{ formatDate(item.assuranceCase.handledAt) }}
                </div>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                class="btn-primary btn-sm"
                :disabled="!!caseActionLoading || item.assuranceCase.status === 'recovered' || item.assuranceCase.status === 'closed'"
                @click="runRepairCaseAction(item, 'retry-sync')"
              >
                {{ caseActionLoading === `retry-sync:${item.id}` ? '同步中...' : '重试同步' }}
              </button>
              <button
                class="btn-secondary btn-sm"
                :disabled="!!caseActionLoading || item.assuranceCase.status === 'recovered'"
                @click="runRepairCaseAction(item, 'recovered')"
              >
                标记恢复
              </button>
              <button
                class="btn-secondary btn-sm"
                :disabled="!!caseActionLoading || item.assuranceCase.status === 'closed'"
                @click="runRepairCaseAction(item, 'closed')"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
        <div class="hidden overflow-hidden lg:block">
          <table class="w-full table-fixed text-left text-sm">
            <thead>
              <tr class="border-b border-themed text-2xs font-medium uppercase tracking-wide text-themed-muted">
                <th class="w-[10%] px-4 py-3">Case</th>
                <th class="w-[15%] px-4 py-3">实例</th>
                <th class="w-[16%] px-4 py-3">目标资源</th>
                <th class="w-[12%] px-4 py-3">最近扣费</th>
                <th class="w-[10%] px-4 py-3">状态</th>
                <th class="w-[17%] px-4 py-3">错误</th>
                <th class="w-[20%] px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in repairCases" :key="item.id" class="border-b border-themed transition-colors last:border-b-0 hover:bg-themed-hover">
                <td class="break-words px-4 py-3">
                  <div class="font-mono font-medium text-themed">#{{ item.id }}</div>
                  <div class="text-xs text-themed-muted">{{ issueTypeLabel(item.assuranceCase.issueType) }}</div>
                </td>
                <td class="px-4 py-3">
                  <div class="font-medium text-themed">{{ item.instance?.name || `#${item.instanceId}` }}</div>
                  <div class="text-xs text-themed-muted">{{ item.user?.username || `用户 #${item.userId}` }} · {{ item.host?.name || `节点 #${item.hostId}` }}</div>
                </td>
                <td class="px-4 py-3 font-mono text-xs tabular-nums text-themed-muted">
                  <div>CPU {{ item.instance?.cpu ?? '-' }}%</div>
                  <div>内存 {{ item.instance?.memory ?? '-' }} MB</div>
                  <div>磁盘 {{ item.instance?.disk ?? '-' }} MB</div>
                  <div>带宽 {{ item.instance?.limitsIngress || '不限速' }} / {{ item.instance?.limitsEgress || '不限速' }}</div>
                </td>
                <td class="px-4 py-3">
                  <div class="font-mono tabular-nums text-themed">{{ formatAmount(item.billing?.amount) }}</div>
                  <div class="font-mono text-xs tabular-nums text-themed-muted">{{ formatDate(item.billing?.createdAt) }}</div>
                </td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium" :class="caseStatusClass(item.assuranceCase.status)">
                    {{ caseStatusLabel(item.assuranceCase.status) }}
                  </span>
                </td>
                <td class="break-words px-4 py-3">
                  <div class="text-xs text-themed-muted" :title="item.assuranceCase.lastError || ''">
                    {{ item.assuranceCase.lastError || item.assuranceCase.title }}
                  </div>
                  <div v-if="item.assuranceCase.handledByUsername" class="mt-1 text-xs text-themed-muted">
                    {{ item.assuranceCase.handledByUsername }} · {{ formatDate(item.assuranceCase.handledAt) }}
                  </div>
                </td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap gap-2">
                    <button
                      class="btn-primary btn-sm"
                      :disabled="!!caseActionLoading || item.assuranceCase.status === 'recovered' || item.assuranceCase.status === 'closed'"
                      @click="runRepairCaseAction(item, 'retry-sync')"
                    >
                      {{ caseActionLoading === `retry-sync:${item.id}` ? '同步中...' : '重试同步' }}
                    </button>
                    <button
                      class="btn-secondary btn-sm"
                      :disabled="!!caseActionLoading || item.assuranceCase.status === 'recovered'"
                      @click="runRepairCaseAction(item, 'recovered')"
                    >
                      标记恢复
                    </button>
                    <button
                      class="btn-secondary btn-sm"
                      :disabled="!!caseActionLoading || item.assuranceCase.status === 'closed'"
                      @click="runRepairCaseAction(item, 'closed')"
                    >
                      关闭
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="repairCases.length === 0">
                <td colspan="7" class="px-4 py-12 text-center text-sm text-themed-muted">
                  <span class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                    </svg>
                  </span>
                  暂无升级同步修复任务
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between border-t border-themed p-4 text-sm text-themed-muted">
          <span class="font-mono text-xs tabular-nums">共 {{ repairTotal }} 条</span>
          <div class="flex items-center gap-2">
            <button class="btn-secondary btn-sm" :disabled="repairPage <= 1" @click="goRepairPage(repairPage - 1)">上一页</button>
            <span class="font-mono text-xs tabular-nums">{{ repairPage }} / {{ repairTotalPages }}</span>
            <button class="btn-secondary btn-sm" :disabled="repairPage >= repairTotalPages" @click="goRepairPage(repairPage + 1)">下一页</button>
          </div>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div class="overflow-hidden rounded-xl border border-themed bg-themed-surface">
          <div class="border-b border-themed p-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div class="min-w-[180px]">
                <label class="mb-1 block text-2xs uppercase tracking-wide text-themed-muted">状态</label>
                <select v-model="statusFilter" class="input w-full" @change="applyFilters">
                  <option v-for="option in statusOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </div>
              <div class="flex-1">
                <label class="mb-1 block text-2xs uppercase tracking-wide text-themed-muted">搜索</label>
                <input
                  v-model.trim="search"
                  class="input w-full"
                  placeholder="任务 ID、实例 ID 或实例名称"
                  @keyup.enter="applyFilters"
                />
              </div>
              <button class="btn-primary" @click="applyFilters">搜索</button>
              <button class="btn-secondary" @click="resetFilters">重置</button>
            </div>
          </div>

        <div class="space-y-3 p-4 lg:hidden">
          <div v-if="tasks.length === 0" class="rounded-xl border border-dashed border-themed p-10 text-center text-sm text-themed-muted">
            <span class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
              </svg>
            </span>
            暂无交付任务
          </div>
          <button
            v-for="task in tasks"
            :key="task.id"
            type="button"
            class="block w-full rounded-xl border bg-themed-surface p-4 text-left text-sm transition-colors"
            :class="selectedTaskId === task.id ? 'border-primary-500 ring-1 ring-primary-500/30' : 'border-themed hover:bg-themed-hover'"
            @click="selectedTaskId = task.id"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-semibold text-themed"><span class="font-mono">#{{ task.id }}</span> {{ taskTypeLabel(task.taskType) }}</div>
                <div class="mt-1 text-xs text-themed-muted">{{ task.progress || '暂无进度' }}</div>
              </div>
              <span class="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium" :class="badgeClass(task.status)">
                {{ statusLabel(task.status) }}
              </span>
            </div>
            <div class="mt-3 grid gap-2 text-xs text-themed-muted sm:grid-cols-2">
              <div class="rounded-lg bg-themed-tertiary p-2.5">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">实例</div>
                <div class="mt-1 text-themed">{{ task.instance?.name || `#${task.instanceId}` }}</div>
                <div class="mt-1 truncate">{{ task.instance?.image || '-' }}</div>
              </div>
              <div class="rounded-lg bg-themed-tertiary p-2.5">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">用户</div>
                <div class="mt-1 text-themed">{{ task.user?.username || `#${task.userId}` }}</div>
                <div class="mt-1 truncate">{{ task.user?.email || '-' }}</div>
              </div>
              <div class="rounded-lg bg-themed-tertiary p-2.5">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">节点</div>
                <div class="mt-1 text-themed">{{ task.host?.name || `#${task.hostId}` }}</div>
                <div class="mt-1">{{ task.host?.location || task.host?.countryCode || '-' }}</div>
              </div>
              <div class="rounded-lg bg-themed-tertiary p-2.5">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">保障</div>
                <span class="mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium" :class="caseStatusClass(task.assuranceCase?.status)">
                  {{ caseStatusLabel(task.assuranceCase?.status) }}
                </span>
              </div>
              <div class="rounded-lg bg-themed-tertiary p-2.5 sm:col-span-2">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">创建时间</div>
                <div class="mt-1 font-mono tabular-nums text-themed">{{ formatDate(task.createdAt) }}</div>
              </div>
            </div>
          </button>
        </div>
        <div class="hidden overflow-hidden lg:block">
          <table class="w-full table-fixed text-left text-sm">
              <thead>
                <tr class="border-b border-themed text-2xs font-medium uppercase tracking-wide text-themed-muted">
                  <th class="w-[18%] px-4 py-3">任务</th>
                  <th class="w-[18%] px-4 py-3">实例</th>
                  <th class="w-[17%] px-4 py-3">用户</th>
                  <th class="w-[15%] px-4 py-3">节点</th>
                  <th class="w-[10%] px-4 py-3">状态</th>
                  <th class="w-[10%] px-4 py-3">保障</th>
                  <th class="w-[12%] px-4 py-3">时间</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="task in tasks"
                  :key="task.id"
                  class="cursor-pointer border-b border-themed transition-colors last:border-b-0 hover:bg-themed-hover"
                  :class="selectedTaskId === task.id ? 'bg-primary-500/5' : ''"
                  @click="selectedTaskId = task.id"
                >
                  <td class="break-words px-4 py-3">
                    <div class="font-medium text-themed"><span class="font-mono">#{{ task.id }}</span> {{ taskTypeLabel(task.taskType) }}</div>
                    <div class="text-xs text-themed-muted">{{ task.progress || '暂无进度' }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <div class="font-medium text-themed">{{ task.instance?.name || `#${task.instanceId}` }}</div>
                    <div class="text-xs text-themed-muted">{{ task.instance?.image || '-' }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <div class="text-themed">{{ task.user?.username || `#${task.userId}` }}</div>
                    <div class="break-words text-xs text-themed-muted">{{ task.user?.email || '-' }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <div class="text-themed">{{ task.host?.name || `#${task.hostId}` }}</div>
                    <div class="text-xs text-themed-muted">{{ task.host?.location || task.host?.countryCode || '-' }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium" :class="badgeClass(task.status)">
                      {{ statusLabel(task.status) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium" :class="caseStatusClass(task.assuranceCase?.status)">
                      {{ caseStatusLabel(task.assuranceCase?.status) }}
                    </span>
                  </td>
                  <td class="break-words px-4 py-3 font-mono text-xs tabular-nums text-themed-muted">
                    {{ formatDate(task.createdAt) }}
                  </td>
                </tr>
                <tr v-if="tasks.length === 0">
                  <td colspan="7" class="px-4 py-12 text-center text-sm text-themed-muted">
                    <span class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
                      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
                      </svg>
                    </span>
                    暂无交付任务
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex items-center justify-between border-t border-themed p-4 text-sm text-themed-muted">
            <span class="font-mono text-xs tabular-nums">共 {{ total }} 条</span>
            <div class="flex items-center gap-2">
              <button class="btn-secondary btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
              <span class="font-mono text-xs tabular-nums">{{ page }} / {{ totalPages }}</span>
              <button class="btn-secondary btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
            </div>
          </div>
        </div>

        <aside class="rounded-xl border border-themed bg-themed-surface p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold text-themed">任务详情</h2>
            <span v-if="selectedTask" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium" :class="badgeClass(selectedTask.status)">
              {{ statusLabel(selectedTask.status) }}
            </span>
          </div>

          <div v-if="selectedTask" class="mt-4 space-y-4">
            <div>
              <div class="text-lg font-semibold text-themed"><span class="font-mono">#{{ selectedTask.id }}</span> {{ taskTypeLabel(selectedTask.taskType) }}</div>
              <div class="mt-1 text-sm text-themed-muted">
                {{ selectedTask.instance?.name || `实例 #${selectedTask.instanceId}` }}
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="rounded-lg border border-themed p-3">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">创建时间</div>
                <div class="mt-1 font-mono text-xs tabular-nums text-themed">{{ formatDate(selectedTask.createdAt) }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">完成时间</div>
                <div class="mt-1 font-mono text-xs tabular-nums text-themed">{{ formatDate(selectedTask.finishedAt) }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">用户</div>
                <div class="mt-1 text-themed">{{ selectedTask.user?.username || `#${selectedTask.userId}` }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">节点</div>
                <div class="mt-1 text-themed">{{ selectedTask.host?.name || `#${selectedTask.hostId}` }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">Agent</div>
                <div class="mt-1 text-themed">{{ formatAgent(selectedTask) }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">最近扣费</div>
                <div class="mt-1 font-mono tabular-nums text-themed">{{ formatAmount(selectedTask.billing?.amount) }}</div>
              </div>
            </div>

            <div class="rounded-lg border border-themed p-3 text-sm">
              <div class="flex items-center justify-between">
                <div class="text-2xs uppercase tracking-wide text-themed-muted">保障状态</div>
                <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium" :class="caseStatusClass(selectedTask.assuranceCase?.status)">
                  {{ caseStatusLabel(selectedTask.assuranceCase?.status) }}
                </span>
              </div>
              <div class="mt-2 text-themed">
                {{ selectedTask.assuranceCase?.title || '当前任务未生成交付保障问题' }}
              </div>
              <div v-if="selectedTask.assuranceCase?.handledByUsername" class="mt-1 text-xs text-themed-muted">
                处理人：{{ selectedTask.assuranceCase.handledByUsername }} · {{ formatDate(selectedTask.assuranceCase.handledAt) }}
              </div>
              <div v-if="selectedTask.assuranceCase?.note" class="mt-2 rounded-lg bg-themed-tertiary p-2 text-xs text-themed-muted">
                {{ selectedTask.assuranceCase.note }}
              </div>
            </div>

            <div class="rounded-lg border border-themed p-3 text-sm">
              <div class="text-2xs uppercase tracking-wide text-themed-muted">失败原因 / 当前进度</div>
              <pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-gray-950 p-3 font-mono text-xs text-gray-300">{{ selectedTask.assuranceCase?.lastError || selectedTask.error || selectedTask.progress || '暂无异常信息' }}</pre>
            </div>

            <div class="rounded-lg border border-themed p-3 text-sm">
              <label class="mb-1 block text-2xs uppercase tracking-wide text-themed-muted">处理备注</label>
              <textarea
                v-model="actionNote"
                class="input min-h-[84px] w-full resize-y"
                maxlength="500"
                placeholder="填写处理说明，最多 500 字"
              />
              <div class="mt-3 flex flex-wrap gap-2">
                <button class="btn-secondary btn-sm" :disabled="!!actionLoading || !selectedTask.assuranceCase" @click="runCaseAction('takeover')">
                  {{ actionLoading === 'takeover' ? '处理中...' : '人工接管' }}
                </button>
                <button
                  class="btn-primary btn-sm"
                  :disabled="!!actionLoading || !selectedTask.assuranceCase?.retryable"
                  @click="runCaseAction('retry')"
                >
                  {{ actionLoading === 'retry' ? '入队中...' : '自动重试' }}
                </button>
                <button class="btn-secondary btn-sm" :disabled="!!actionLoading || !selectedTask.assuranceCase" @click="runCaseAction('recovered')">
                  标记恢复
                </button>
                <button class="btn-secondary btn-sm" :disabled="!!actionLoading || !selectedTask.assuranceCase" @click="runCaseAction('closed')">
                  关闭
                </button>
              </div>
              <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                <select v-model="notifyMode" class="input sm:w-44">
                  <option value="delayed">交付延迟</option>
                  <option value="recovered">已恢复</option>
                  <option value="contact_support">需联系客服</option>
                </select>
                <button class="btn-secondary btn-sm" :disabled="!!actionLoading || !selectedTask.assuranceCase" @click="runCaseAction('notify')">
                  {{ actionLoading === 'notify' ? '发送中...' : '通知用户' }}
                </button>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <RouterLink class="btn-primary btn-sm" :to="`/admin/instances/${selectedTask.instanceId}`">查看实例</RouterLink>
              <RouterLink class="btn-secondary btn-sm" :to="`/admin/resources/hosts/${selectedTask.hostId}?tab=instances`">查看节点</RouterLink>
              <RouterLink class="btn-secondary btn-sm" to="/admin/users">查看用户</RouterLink>
              <RouterLink class="btn-secondary btn-sm" to="/admin/logs">查看日志</RouterLink>
            </div>
          </div>

          <div v-else class="mt-8 flex flex-col items-center rounded-lg border border-dashed border-themed p-10 text-center text-sm text-themed-muted">
            <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
              </svg>
            </span>
            选择任务查看详情
          </div>
        </aside>
      </section>
    </template>
  </div>
</template>

<style scoped>
.nimbus-stat {
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-view *,
  .nimbus-view *::before,
  .nimbus-view *::after {
    transition-duration: 0.001ms !important;
    animation-duration: 0.001ms !important;
  }
}
</style>
