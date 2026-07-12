<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type {
  AvailableSystemUpdate,
  SystemUpdateCheckResult,
  SystemUpdateTask,
  VersionMetadata
} from '@/types/api'

const toast = useToast()

const loading = ref(true)
const checking = ref(false)
const starting = ref(false)
const rollingBackTaskId = ref<number | null>(null)
const version = ref<VersionMetadata | null>(null)
const updateCheck = ref<SystemUpdateCheckResult | null>(null)
const tasks = ref<SystemUpdateTask[]>([])
const selectedTaskId = ref<number | null>(null)
const selectedTaskLogs = ref('')
const logsLoading = ref(false)
const taskPage = ref(1)
const TASKS_PER_PAGE = 7
let pollTimer: number | null = null

const selectedTask = computed(() =>
  tasks.value.find(task => task.id === selectedTaskId.value) || null
)

const latestUpdate = computed<AvailableSystemUpdate | null>(() =>
  updateCheck.value?.latest || null
)

const displayLatestUpdate = computed<AvailableSystemUpdate | null>(() => {
  if (latestUpdate.value) return latestUpdate.value
  if (!currentVersion.value) return null
  return {
    version: currentVersion.value.version,
    commit: currentVersion.value.gitCommit,
    date: currentVersion.value.buildTime || currentVersion.value.deployedAt,
    changelog: currentVersion.value.changelog || [],
    ota: {
      manifestAvailable: false,
      manifestUrl: null,
      artifacts: [],
      error: updateCheck.value
        ? '当前版本已是最新版本，未发现新的 OTA 发行包。'
        : '检查更新后显示 OTA manifest 和包校验信息。'
    }
  }
})

const latestOtaArtifacts = computed(() =>
  displayLatestUpdate.value?.ota?.artifacts || []
)

const repositoryUnavailable = computed(() =>
  updateCheck.value?.repositoryAvailable === false
)

const hasRunningTask = computed(() =>
  tasks.value.some(task => task.status === 'pending' || task.status === 'running')
)

const currentVersion = computed(() => updateCheck.value?.current || version.value)

const canManageUpdates = computed(() => updateCheck.value?.canManageUpdates !== false)

const totalTaskPages = computed(() =>
  Math.max(1, Math.ceil(tasks.value.length / TASKS_PER_PAGE))
)

const paginatedTasks = computed(() => {
  const start = (taskPage.value - 1) * TASKS_PER_PAGE
  return tasks.value.slice(start, start + TASKS_PER_PAGE)
})

const updateActionLabel = computed(() => {
  if (starting.value) return '启动中...'
  if (hasRunningTask.value) return '已有更新任务执行中'
  if (repositoryUnavailable.value) return '无法在线更新'
  if (updateCheck.value && !updateCheck.value.updateAvailable) return '已更新至最新版本'
  if (updateCheck.value && !canManageUpdates.value) return '仅超管可更新'
  if (!updateCheck.value) return '检查更新后可操作'
  return '更新到最新版本'
})

const updateActionDisabled = computed(() =>
  repositoryUnavailable.value ||
  !canManageUpdates.value ||
  !latestUpdate.value ||
  !updateCheck.value?.updateAvailable ||
  starting.value ||
  hasRunningTask.value
)

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatBytes(value: number | null | undefined): string {
  if (!value || value < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function shortSha(value: string | null | undefined): string {
  return value ? `${value.slice(0, 12)}...` : '-'
}

function statusLabel(status: SystemUpdateTask['status']): string {
  const labels: Record<SystemUpdateTask['status'], string> = {
    pending: '等待中',
    running: '执行中',
    success: '成功',
    failed: '失败',
    rolled_back: '已回滚'
  }
  return labels[status]
}

function statusClass(status: SystemUpdateTask['status']): string {
  if (status === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30'
  if (status === 'rolled_back') return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30'
  if (status === 'running') return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30'
  return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
}

async function loadVersion() {
  const response = await api.systemUpdate.getVersion()
  version.value = response.version
}

async function loadTasks() {
  const response = await api.systemUpdate.listTasks()
  tasks.value = response.tasks
  if (selectedTaskId.value && !response.tasks.some(task => task.id === selectedTaskId.value)) {
    selectedTaskId.value = null
  }
  if (!selectedTaskId.value && response.tasks.length > 0) {
    selectedTaskId.value = response.tasks[0].id
  }
  ensureSelectedTaskVisible()
}

async function loadSelectedTaskLogs() {
  if (!selectedTaskId.value) {
    selectedTaskLogs.value = ''
    return
  }
  logsLoading.value = true
  try {
    const response = await api.systemUpdate.getTaskLogs(selectedTaskId.value)
    selectedTaskLogs.value = response.logs
  } catch (err: any) {
    selectedTaskLogs.value = ''
    toast.error('加载更新日志失败：' + (err?.message || String(err)))
  } finally {
    logsLoading.value = false
  }
}

async function refreshAll() {
  loading.value = true
  try {
    await Promise.all([loadVersion(), loadTasks(), loadUpdateCheck(false)])
    await loadSelectedTaskLogs()
  } catch (err: any) {
    toast.error('加载版本信息失败：' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function loadUpdateCheck(notify: boolean) {
  checking.value = true
  try {
    updateCheck.value = await api.systemUpdate.check()
    if (notify) {
      if (repositoryUnavailable.value) {
        toast.error(updateCheck.value.repositoryError || '当前部署目录不是 Git 工作区，无法在线更新')
      } else if (updateCheck.value.updateAvailable) {
        toast.success('发现可更新版本')
      } else {
        toast.success('当前已经是最新版本')
      }
    }
  } catch (err: any) {
    if (notify) toast.error('检查更新失败：' + (err?.message || String(err)))
  } finally {
    checking.value = false
  }
}

async function checkUpdates() {
  await loadUpdateCheck(true)
}

async function startUpdate(targetVersion: string) {
  if (!targetVersion || hasRunningTask.value) return
  const confirmed = window.confirm(`确认更新到 ${targetVersion}？更新会备份当前版本、执行数据库迁移并重启服务。`)
  if (!confirmed) return

  starting.value = true
  try {
    const response = await api.systemUpdate.start(targetVersion)
    selectedTaskId.value = response.task.id
    toast.success('更新任务已创建')
    await loadTasks()
    await loadSelectedTaskLogs()
  } catch (err: any) {
    toast.error('启动更新失败：' + (err?.message || String(err)))
  } finally {
    starting.value = false
  }
}

async function rollbackTask(task: SystemUpdateTask) {
  if (!task.backupPath || hasRunningTask.value) return
  const confirmed = window.confirm(`确认回滚任务 #${task.id} 的备份？该操作会重启服务。`)
  if (!confirmed) return

  rollingBackTaskId.value = task.id
  try {
    await api.systemUpdate.rollback(task.id)
    selectedTaskId.value = task.id
    toast.success('回滚任务已启动')
    await loadTasks()
    await loadSelectedTaskLogs()
  } catch (err: any) {
    toast.error('启动回滚失败：' + (err?.message || String(err)))
  } finally {
    rollingBackTaskId.value = null
  }
}

async function selectTask(task: SystemUpdateTask) {
  selectedTaskId.value = task.id
  ensureSelectedTaskVisible()
  await loadSelectedTaskLogs()
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

function startPolling() {
  if (pollTimer !== null) return
  pollTimer = window.setInterval(async () => {
    if (!hasRunningTask.value && !selectedTask.value) return
    await loadTasks()
    await loadSelectedTaskLogs()
  }, 5000)
}

onMounted(async () => {
  await refreshAll()
  startPolling()
})

onUnmounted(() => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
  }
})
</script>

<template>
  <div class="kawaii-page p-6 space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">版本更新</h1>
        <p class="page-description">通过 Git release tag 进行受控在线更新，更新前会自动备份并执行验证。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary" :disabled="loading" @click="refreshAll">
          <svg class="h-4 w-4" :class="loading ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          刷新
        </button>
        <button class="btn-primary" :disabled="checking || hasRunningTask" @click="checkUpdates">
          <svg v-if="checking" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 13.5V21m0 0-3.75-3.75M12 21l3.75-3.75M6.75 15a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 15h-1.5" />
          </svg>
          {{ checking ? '检查中...' : '检查更新' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-16 text-sm text-themed-muted">
      <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      加载中...
    </div>

    <template v-else>
      <section class="grid gap-4 xl:grid-cols-2">
        <div class="nimbus-card rounded-xl border border-themed bg-themed-surface p-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[11px] font-medium uppercase tracking-[0.06em] text-themed-faint">当前版本</h2>
              <p class="mt-1 text-3xl font-bold tabular-nums text-themed">{{ currentVersion?.version || '-' }}</p>
            </div>
            <span class="inline-flex shrink-0 items-center rounded-full border border-themed bg-themed-secondary px-2.5 py-1 text-xs font-medium text-themed-muted">当前运行</span>
          </div>
          <dl class="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-xs text-themed-muted">Git Tag</dt>
              <dd class="mt-1 font-mono text-themed">{{ currentVersion?.gitTag || '-' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-themed-muted">Commit</dt>
              <dd class="mt-1 truncate font-mono text-xs text-themed">{{ currentVersion?.gitCommit || '-' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-themed-muted">构建时间</dt>
              <dd class="mt-1 text-themed">{{ formatDate(currentVersion?.buildTime) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-themed-muted">部署时间</dt>
              <dd class="mt-1 text-themed">{{ formatDate(currentVersion?.deployedAt) }}</dd>
            </div>
          </dl>
          <div class="mt-6 border-t border-themed pt-4">
            <h3 class="text-sm font-medium text-themed">当前版本更新内容</h3>
            <ul v-if="currentVersion?.changelog?.length" class="mt-2 list-disc space-y-1 pl-5 text-sm text-themed-muted">
              <li v-for="item in currentVersion.changelog" :key="item">{{ item }}</li>
            </ul>
            <p v-else class="mt-2 text-sm text-themed-muted">暂无版本说明。</p>
          </div>
        </div>

        <div class="nimbus-card rounded-xl border border-themed bg-themed-surface p-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[11px] font-medium uppercase tracking-[0.06em] text-themed-faint">最新版本</h2>
              <p class="mt-1 text-3xl font-bold tabular-nums text-themed">{{ displayLatestUpdate?.version || '-' }}</p>
            </div>
            <span
              class="inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium"
              :class="updateCheck ? (updateCheck.updateAvailable ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300') : 'border-themed bg-themed-secondary text-themed-muted'"
            >
              {{ updateCheck ? (updateCheck.updateAvailable ? '可更新' : '已最新') : '未检查' }}
            </span>
          </div>
          <div
            v-if="repositoryUnavailable"
            class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {{ updateCheck?.repositoryError || '当前部署目录不是 Git 工作区，无法在线更新。' }}
          </div>
          <dl class="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-xs text-themed-muted">Commit</dt>
              <dd class="mt-1 truncate font-mono text-xs text-themed">{{ displayLatestUpdate?.commit || '-' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-themed-muted">发布时间</dt>
              <dd class="mt-1 text-themed">{{ formatDate(displayLatestUpdate?.date) }}</dd>
            </div>
          </dl>
          <div class="mt-6">
            <h3 class="text-sm font-medium text-themed">最新版本更新内容</h3>
            <ul v-if="displayLatestUpdate?.changelog?.length" class="mt-2 list-disc space-y-1 pl-5 text-sm text-themed-muted">
              <li v-for="item in displayLatestUpdate.changelog" :key="item">{{ item }}</li>
            </ul>
            <p v-else class="mt-2 text-sm text-themed-muted">检查更新后显示 release tag 说明。</p>
          </div>
          <div class="mt-6 border-t border-themed pt-4">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-medium text-themed">OTA 发行包</h3>
              <span
                class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium"
                :class="displayLatestUpdate?.ota?.manifestAvailable ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'"
              >
                {{ displayLatestUpdate?.ota?.manifestAvailable ? '已校验 manifest' : 'Git 更新兼容模式' }}
              </span>
            </div>
            <div v-if="latestOtaArtifacts.length" class="mt-3 space-y-2">
              <div
                v-for="artifact in latestOtaArtifacts"
                :key="artifact.name"
                class="rounded-lg border border-themed bg-themed-secondary px-3 py-2 text-xs text-themed-muted"
              >
                <div class="font-medium text-themed">{{ artifact.name }}</div>
                <div class="mt-1 grid gap-1 sm:grid-cols-3">
                  <span>{{ artifact.platform }}/{{ artifact.arch }}</span>
                  <span class="tabular-nums">{{ formatBytes(artifact.size) }}</span>
                  <span class="font-mono">{{ shortSha(artifact.sha256) }}</span>
                </div>
              </div>
            </div>
            <p v-else class="mt-2 text-sm text-themed-muted">
              {{ displayLatestUpdate?.ota?.error || '检查更新后显示 OTA manifest 和包校验信息。' }}
            </p>
          </div>
          <button
            class="btn-primary mt-6 w-full"
            :disabled="updateActionDisabled"
            @click="latestUpdate && startUpdate(latestUpdate.version)"
          >
            <svg v-if="starting" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5 10.5 3l-1.5 7.5h6.75L9 21l1.5-7.5H3.75Z" />
            </svg>
            {{ updateActionLabel }}
          </button>
        </div>
      </section>

      <section v-if="updateCheck?.updates?.length" class="nimbus-card rounded-xl border border-themed bg-themed-surface">
        <div class="border-b border-themed px-5 py-4">
          <h2 class="text-lg font-semibold text-themed">可更新版本</h2>
        </div>
        <div class="divide-y divide-themed">
          <div v-for="item in updateCheck.updates" :key="item.version" class="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div class="font-mono text-base font-semibold tabular-nums text-themed">{{ item.version }}</div>
              <div class="mt-1 text-xs text-themed-muted">{{ formatDate(item.date) }} · <span class="font-mono">{{ item.commit || '-' }}</span></div>
              <span
                class="mt-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                :class="item.ota.manifestAvailable ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'"
              >
                {{ item.ota.manifestAvailable ? `OTA manifest · ${item.ota.artifacts.length} 个包` : (item.ota.error || '未发现 OTA manifest') }}
              </span>
              <ul v-if="item.changelog.length" class="mt-2 list-disc space-y-1 pl-5 text-sm text-themed-muted">
                <li v-for="line in item.changelog.slice(0, 6)" :key="line">{{ line }}</li>
              </ul>
            </div>
            <button class="btn-secondary shrink-0" :disabled="starting || hasRunningTask" @click="startUpdate(item.version)">
              更新到此版本
            </button>
          </div>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-[minmax(300px,440px)_1fr]">
        <div class="nimbus-card overflow-hidden rounded-xl border border-themed bg-themed-surface">
          <div class="flex items-center justify-between gap-3 border-b border-themed px-5 py-4">
            <div>
              <h2 class="text-lg font-semibold text-themed">更新任务</h2>
              <p class="mt-1 text-xs text-themed-muted">每页最多显示 7 条，旧任务翻页查看。</p>
            </div>
            <span class="inline-flex shrink-0 items-center rounded-full border border-themed bg-themed-secondary px-2.5 py-1 text-xs font-medium tabular-nums text-themed-muted">{{ tasks.length }} 条</span>
          </div>
          <div v-if="tasks.length === 0" class="px-5 py-10 text-center text-sm text-themed-muted">暂无更新任务。</div>
          <div v-else class="divide-y divide-themed">
            <button
              v-for="task in paginatedTasks"
              :key="task.id"
              class="nimbus-task-row block h-[76px] w-full overflow-hidden border-l-2 py-3 text-left hover:bg-themed-hover"
              :class="selectedTaskId === task.id ? 'border-primary-500 bg-themed-hover pl-[18px] pr-5' : 'border-transparent px-5'"
              @click="selectTask(task)"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="truncate font-mono text-sm font-medium text-themed">#{{ task.id }} {{ task.fromVersion || '-' }} -> {{ task.targetVersion }}</span>
                <span class="shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium" :class="statusClass(task.status)">
                  {{ statusLabel(task.status) }}
                </span>
              </div>
              <div class="mt-1 text-xs text-themed-muted">
                {{ task.startedByUsername || '-' }} · {{ formatDate(task.createdAt) }}
              </div>
              <p v-if="task.errorMessage" class="mt-1 truncate text-xs text-rose-600 dark:text-rose-400">{{ task.errorMessage }}</p>
            </button>
          </div>
          <div class="flex min-h-[54px] items-center justify-between border-t border-themed px-5 py-3 text-xs text-themed-muted">
            <span>第 {{ taskPage }} / {{ totalTaskPages }} 页 · 共 {{ tasks.length }} 个任务</span>
            <div class="flex gap-2">
              <button class="btn-secondary btn-sm" :disabled="taskPage <= 1" @click="setTaskPage(taskPage - 1)">上一页</button>
              <button class="btn-secondary btn-sm" :disabled="taskPage >= totalTaskPages" @click="setTaskPage(taskPage + 1)">下一页</button>
            </div>
          </div>
        </div>

        <div class="nimbus-card overflow-hidden rounded-xl border border-themed bg-themed-surface">
          <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-themed">任务日志</h2>
              <p class="mt-1 text-xs text-themed-muted">
                {{ selectedTask ? `任务 #${selectedTask.id} · ${statusLabel(selectedTask.status)}` : '请选择任务' }}
              </p>
            </div>
            <div class="flex gap-2">
              <button class="btn-secondary" :disabled="!selectedTask || logsLoading" @click="loadSelectedTaskLogs">
                <svg class="h-4 w-4" :class="logsLoading ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                {{ logsLoading ? '加载中...' : '刷新日志' }}
              </button>
              <button
                class="btn-danger"
                :disabled="!selectedTask?.backupPath || hasRunningTask || rollingBackTaskId === selectedTask?.id"
                @click="selectedTask && rollbackTask(selectedTask)"
              >
                <svg v-if="rollingBackTaskId === selectedTask?.id" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                </svg>
                {{ rollingBackTaskId === selectedTask?.id ? '回滚中...' : '回滚' }}
              </button>
            </div>
          </div>
          <div class="p-5">
            <div class="overflow-hidden rounded-lg border border-white/10">
              <div class="flex items-center gap-1.5 bg-gray-900 px-4 py-2">
                <span class="h-2.5 w-2.5 rounded-full bg-rose-500/70"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-amber-500/70"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500/70"></span>
                <span class="ml-2 font-mono text-[11px] text-gray-500">update.log</span>
              </div>
              <pre class="min-h-[420px] max-h-[600px] overflow-auto whitespace-pre-wrap bg-gray-950 p-5 font-mono text-xs leading-5 text-gray-100">{{ selectedTaskLogs || '暂无日志。' }}</pre>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.nimbus-card,
.nimbus-task-row {
  transition: background-color 0.15s ease, border-color 0.15s ease, padding 0.15s ease;
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-card,
  .nimbus-task-row {
    transition: none;
  }
}
</style>
