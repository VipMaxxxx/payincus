<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type { DeliveryAssuranceCaseStatus, DeliveryOverview, DeliveryTaskContext, InstanceTaskStatus } from '@/types/api'

const toast = useToast()

const loading = ref(true)
const refreshing = ref(false)
const overview = ref<DeliveryOverview | null>(null)
const tasks = ref<DeliveryTaskContext[]>([])
const selectedTaskId = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const totalPages = ref(1)
const statusFilter = ref<'all' | InstanceTaskStatus>('all')
const search = ref('')
const actionLoading = ref<string | null>(null)
const actionNote = ref('')
const notifyMode = ref<'delayed' | 'recovered' | 'contact_support'>('contact_support')

const statusOptions: Array<{ value: 'all' | InstanceTaskStatus; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'PENDING', label: '等待中' },
  { value: 'PROCESSING', label: '处理中' },
  { value: 'FAILED', label: '失败' },
  { value: 'COMPLETED', label: '成功' }
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
  if (status === 'auto_retryable') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'pending_manual') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'in_progress') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'recovered') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'closed') return 'border-themed bg-themed-tertiary text-themed-muted'
  return 'border-themed bg-themed-secondary text-themed-muted'
}

function badgeClass(status: string): string {
  if (status === 'COMPLETED') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'FAILED') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'PROCESSING') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
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

function toneClass(tone: string): string {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-700'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (tone === 'info') return 'border-blue-200 bg-blue-50 text-blue-700'
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

async function refreshAll(silent = false) {
  if (silent) refreshing.value = true
  else loading.value = true
  try {
    await Promise.all([loadOverview(), loadTasks()])
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

function goPage(nextPage: number) {
  page.value = Math.min(Math.max(nextPage, 1), totalPages.value)
  void refreshAll()
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <div class="space-y-6 p-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-themed">交付保障</h1>
        <p class="mt-1 text-sm text-themed-muted">跟踪实例交付任务、失败原因和通知投递状态。</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary" :disabled="refreshing" @click="refreshAll(true)">
          {{ refreshing ? '刷新中...' : '刷新' }}
        </button>
        <RouterLink class="btn-secondary" to="/admin/logs">查看日志</RouterLink>
      </div>
    </div>

    <div v-if="loading" class="rounded-lg border border-themed bg-themed-secondary p-6 text-sm text-themed-muted">
      加载中...
    </div>

    <template v-else>
      <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="item in taskRiskItems"
          :key="item.label"
          class="rounded-lg border border-themed bg-themed-secondary p-4"
        >
          <div class="text-sm text-themed-muted">{{ item.label }}</div>
          <div class="mt-2 text-3xl font-semibold text-themed">{{ item.value }}</div>
          <div class="mt-3 inline-flex rounded-md border px-2 py-1 text-xs" :class="toneClass(item.tone)">
            {{ item.caption }}
          </div>
        </div>
      </section>

      <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="item in caseItems"
          :key="item.label"
          class="flex items-center justify-between rounded-lg border border-themed bg-themed-secondary p-4"
        >
          <span class="text-sm text-themed-muted">{{ item.label }}</span>
          <span class="rounded-md border px-2 py-1 text-sm font-semibold" :class="toneClass(item.tone)">
            {{ item.value }}
          </span>
        </div>
      </section>

      <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="item in notificationItems"
          :key="item.label"
          class="flex items-center justify-between rounded-lg border border-themed bg-themed-secondary p-4"
        >
          <span class="text-sm text-themed-muted">{{ item.label }}</span>
          <span class="rounded-md border px-2 py-1 text-sm font-semibold" :class="toneClass(item.tone)">
            {{ item.value }}
          </span>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div class="rounded-lg border border-themed bg-themed-secondary">
          <div class="border-b border-themed p-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div class="min-w-[180px]">
                <label class="mb-1 block text-sm text-themed-muted">状态</label>
                <select v-model="statusFilter" class="input w-full" @change="applyFilters">
                  <option v-for="option in statusOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </div>
              <div class="flex-1">
                <label class="mb-1 block text-sm text-themed-muted">搜索</label>
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

          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="border-b border-themed text-xs uppercase text-themed-muted">
                <tr>
                  <th class="px-4 py-3 font-medium">任务</th>
                  <th class="px-4 py-3 font-medium">实例</th>
                  <th class="px-4 py-3 font-medium">用户</th>
                  <th class="px-4 py-3 font-medium">节点</th>
                  <th class="px-4 py-3 font-medium">状态</th>
                  <th class="px-4 py-3 font-medium">保障</th>
                  <th class="px-4 py-3 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="task in tasks"
                  :key="task.id"
                  class="cursor-pointer border-b border-themed last:border-b-0 hover:bg-themed-tertiary"
                  :class="selectedTaskId === task.id ? 'bg-themed-tertiary' : ''"
                  @click="selectedTaskId = task.id"
                >
                  <td class="px-4 py-3">
                    <div class="font-medium text-themed">#{{ task.id }} {{ taskTypeLabel(task.taskType) }}</div>
                    <div class="text-xs text-themed-muted">{{ task.progress || '暂无进度' }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <div class="font-medium text-themed">{{ task.instance?.name || `#${task.instanceId}` }}</div>
                    <div class="text-xs text-themed-muted">{{ task.instance?.image || '-' }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <div class="text-themed">{{ task.user?.username || `#${task.userId}` }}</div>
                    <div class="max-w-[180px] truncate text-xs text-themed-muted">{{ task.user?.email || '-' }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <div class="text-themed">{{ task.host?.name || `#${task.hostId}` }}</div>
                    <div class="text-xs text-themed-muted">{{ task.host?.location || task.host?.countryCode || '-' }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <span class="rounded-md border px-2 py-1 text-xs" :class="badgeClass(task.status)">
                      {{ statusLabel(task.status) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span class="rounded-md border px-2 py-1 text-xs" :class="caseStatusClass(task.assuranceCase?.status)">
                      {{ caseStatusLabel(task.assuranceCase?.status) }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 text-xs text-themed-muted">
                    {{ formatDate(task.createdAt) }}
                  </td>
                </tr>
                <tr v-if="tasks.length === 0">
                  <td colspan="7" class="px-4 py-10 text-center text-sm text-themed-muted">
                    暂无交付任务
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex items-center justify-between border-t border-themed p-4 text-sm text-themed-muted">
            <span>共 {{ total }} 条</span>
            <div class="flex items-center gap-2">
              <button class="btn-secondary" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
              <span>{{ page }} / {{ totalPages }}</span>
              <button class="btn-secondary" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
            </div>
          </div>
        </div>

        <aside class="rounded-lg border border-themed bg-themed-secondary p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-themed">任务详情</h2>
            <span v-if="selectedTask" class="rounded-md border px-2 py-1 text-xs" :class="badgeClass(selectedTask.status)">
              {{ statusLabel(selectedTask.status) }}
            </span>
          </div>

          <div v-if="selectedTask" class="mt-4 space-y-4">
            <div>
              <div class="text-xl font-semibold text-themed">#{{ selectedTask.id }} {{ taskTypeLabel(selectedTask.taskType) }}</div>
              <div class="mt-1 text-sm text-themed-muted">
                {{ selectedTask.instance?.name || `实例 #${selectedTask.instanceId}` }}
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="rounded-lg border border-themed p-3">
                <div class="text-themed-muted">创建时间</div>
                <div class="mt-1 text-themed">{{ formatDate(selectedTask.createdAt) }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-themed-muted">完成时间</div>
                <div class="mt-1 text-themed">{{ formatDate(selectedTask.finishedAt) }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-themed-muted">用户</div>
                <div class="mt-1 text-themed">{{ selectedTask.user?.username || `#${selectedTask.userId}` }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-themed-muted">节点</div>
                <div class="mt-1 text-themed">{{ selectedTask.host?.name || `#${selectedTask.hostId}` }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-themed-muted">Agent</div>
                <div class="mt-1 text-themed">{{ formatAgent(selectedTask) }}</div>
              </div>
              <div class="rounded-lg border border-themed p-3">
                <div class="text-themed-muted">最近扣费</div>
                <div class="mt-1 text-themed">{{ formatAmount(selectedTask.billing?.amount) }}</div>
              </div>
            </div>

            <div class="rounded-lg border border-themed p-3 text-sm">
              <div class="flex items-center justify-between">
                <div class="text-themed-muted">保障状态</div>
                <span class="rounded-md border px-2 py-1 text-xs" :class="caseStatusClass(selectedTask.assuranceCase?.status)">
                  {{ caseStatusLabel(selectedTask.assuranceCase?.status) }}
                </span>
              </div>
              <div class="mt-2 text-themed">
                {{ selectedTask.assuranceCase?.title || '当前任务未生成交付保障问题' }}
              </div>
              <div v-if="selectedTask.assuranceCase?.handledByUsername" class="mt-1 text-xs text-themed-muted">
                处理人：{{ selectedTask.assuranceCase.handledByUsername }} · {{ formatDate(selectedTask.assuranceCase.handledAt) }}
              </div>
              <div v-if="selectedTask.assuranceCase?.note" class="mt-2 rounded-md bg-themed-tertiary p-2 text-xs text-themed-muted">
                {{ selectedTask.assuranceCase.note }}
              </div>
            </div>

            <div class="rounded-lg border border-themed p-3 text-sm">
              <div class="text-themed-muted">失败原因 / 当前进度</div>
              <pre class="mt-2 whitespace-pre-wrap break-words rounded-md bg-black p-3 text-xs text-white">{{ selectedTask.assuranceCase?.lastError || selectedTask.error || selectedTask.progress || '暂无异常信息' }}</pre>
            </div>

            <div class="rounded-lg border border-themed p-3 text-sm">
              <label class="mb-1 block text-themed-muted">处理备注</label>
              <textarea
                v-model="actionNote"
                class="input min-h-[84px] w-full resize-y"
                maxlength="500"
                placeholder="填写处理说明，最多 500 字"
              />
              <div class="mt-3 flex flex-wrap gap-2">
                <button class="btn-secondary" :disabled="!!actionLoading || !selectedTask.assuranceCase" @click="runCaseAction('takeover')">
                  {{ actionLoading === 'takeover' ? '处理中...' : '人工接管' }}
                </button>
                <button
                  class="btn-primary"
                  :disabled="!!actionLoading || !selectedTask.assuranceCase?.retryable"
                  @click="runCaseAction('retry')"
                >
                  {{ actionLoading === 'retry' ? '入队中...' : '自动重试' }}
                </button>
                <button class="btn-secondary" :disabled="!!actionLoading || !selectedTask.assuranceCase" @click="runCaseAction('recovered')">
                  标记恢复
                </button>
                <button class="btn-secondary" :disabled="!!actionLoading || !selectedTask.assuranceCase" @click="runCaseAction('closed')">
                  关闭
                </button>
              </div>
              <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                <select v-model="notifyMode" class="input sm:w-44">
                  <option value="delayed">交付延迟</option>
                  <option value="recovered">已恢复</option>
                  <option value="contact_support">需联系客服</option>
                </select>
                <button class="btn-secondary" :disabled="!!actionLoading || !selectedTask.assuranceCase" @click="runCaseAction('notify')">
                  {{ actionLoading === 'notify' ? '发送中...' : '通知用户' }}
                </button>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <RouterLink class="btn-primary" :to="`/admin/instances/${selectedTask.instanceId}`">查看实例</RouterLink>
              <RouterLink class="btn-secondary" :to="`/admin/resources/hosts/${selectedTask.hostId}?tab=instances`">查看节点</RouterLink>
              <RouterLink class="btn-secondary" to="/admin/users">查看用户</RouterLink>
              <RouterLink class="btn-secondary" to="/admin/logs">查看日志</RouterLink>
            </div>
          </div>

          <div v-else class="mt-8 text-center text-sm text-themed-muted">
            选择任务查看详情
          </div>
        </aside>
      </section>
    </template>
  </div>
</template>
