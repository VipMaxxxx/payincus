<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import api from '@/api'
import InstanceDisplayIcon from '@/components/InstanceDisplayIcon.vue'
import TerminalModal from '@/components/instance/TerminalModal.vue'
import { useToast } from '@/stores/toast'
import type { InstanceConfigResponse, InstanceWithDetails } from '@/types/api'
import { translateError } from '@/utils/errorHandler'
import { formatBytes, formatDisk, formatMemory, getStatusInfo } from '@/utils/formatters'

interface TicketInstanceSummary {
  id: number
  name: string
  status?: string
  iconBadgeId?: string | null
  incusId?: string | null
  ipv4?: string | null
  ipv6?: string | null
  cpu?: number
  memory?: number
  disk?: number
  image?: string
  imageName?: string | null
  packageName?: string | null
}

interface InstanceTask {
  id: number
  taskType: string
  status: string
  progress?: string | null
  error?: string | null
  queuePosition: number
}

interface TicketCardStats {
  memory: {
    usage: number
    limit: number
    usagePercent: number
  }
  disk: {
    usage: number
    limit: number
    usagePercent: number
  }
  network: {
    bytesReceived: number
    bytesSent: number
  }
}

type ActionType = 'start' | 'stop' | 'restart' | 'sync' | 'suspend' | 'unsuspend' | 'delete' | ''

const props = defineProps<{
  instanceSummary: TicketInstanceSummary
}>()

const { t, te } = useI18n()
const router = useRouter()
const toast = useToast()

const instance = ref<InstanceWithDetails | null>(null)
const detailConfig = ref<InstanceConfigResponse | null>(null)
const stats = ref<TicketCardStats | null>(null)
const activeTask = ref<InstanceTask | null>(null)
const loading = ref(false)
const detailError = ref('')
const actionLoading = ref<ActionType>('')
const optimisticStatus = ref<string | null>(null)
const showDetails = ref(false)

const showTerminalModal = ref(false)
const terminalForceDisconnect = ref(false)

let refreshInterval: ReturnType<typeof setInterval> | null = null
let statsInterval: ReturnType<typeof setInterval> | null = null
let taskPollingInterval: ReturnType<typeof setInterval> | null = null
let latestRequestId = 0

const mergedInstance = computed(() => {
  return {
    ...props.instanceSummary,
    ...(instance.value ?? {})
  } as TicketInstanceSummary & Partial<InstanceWithDetails> & { incusId?: string | null }
})

const displayStatus = computed(() => optimisticStatus.value || mergedInstance.value.status || 'stopped')
const statusInfo = computed(() => getStatusInfo(displayStatus.value, t))
const networkMode = computed(() => {
  const mode = (mergedInstance.value.network_mode || (mergedInstance.value as { networkMode?: string }).networkMode || null) as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | null
  return mode
})
const networkModeLabel = computed(() => {
  if (!networkMode.value) return '-'
  const key = `common.networkMode.${networkMode.value}`
  return te(key) ? t(key) : networkMode.value
})
const instanceType = computed(() => {
  const type = ((mergedInstance.value as { instanceType?: 'container' | 'vm'; instance_type?: 'container' | 'vm' }).instanceType
    || (mergedInstance.value as { instance_type?: 'container' | 'vm' }).instance_type
    || null)
  if (!type) return '-'
  const key = `common.instanceType.${type}`
  return te(key) ? t(key) : type
})
const imageLabel = computed(() => {
  return mergedInstance.value.imageName || mergedInstance.value.image?.replace(/^images:/, '') || '-'
})
const planLabel = computed(() => {
  return (mergedInstance.value as { planName?: string | null }).planName || mergedInstance.value.packageName || '-'
})
const priceLabel = computed(() => {
  const price = Number((mergedInstance.value as { billingPrice?: number | null }).billingPrice)
  return Number.isFinite(price) && price > 0 ? `¥${price.toFixed(2)}` : null
})
const displayIp = computed(() => ({
  ipv4: mergedInstance.value.ipv4 || null,
  ipv6: ['nat_ipv6', 'ipv6_only'].includes(networkMode.value || '') ? mergedInstance.value.ipv6 || null : null
}))
const isRunning = computed(() => displayStatus.value.toLowerCase() === 'running')
const isSuspended = computed(() => displayStatus.value.toLowerCase() === 'suspended')
const isDeleted = computed(() => displayStatus.value.toLowerCase() === 'deleted')
const hasActiveTask = computed(() => !!activeTask.value && !['COMPLETED', 'FAILED'].includes(activeTask.value.status))
const isBusy = computed(() => loading.value || actionLoading.value !== '' || hasActiveTask.value)
const canStart = computed(() => !!instance.value && !isBusy.value && !isRunning.value && !isSuspended.value && !isDeleted.value)
const canStop = computed(() => !!instance.value && !isBusy.value && isRunning.value)
const canRestart = computed(() => !!instance.value && !isBusy.value && isRunning.value)
const hasSyncPermission = computed(() => {
  const inst = instance.value
  return !!inst && (inst.isHostOwner === true || inst.isInstanceOwner === true)
})
const canSync = computed(() => hasSyncPermission.value && actionLoading.value !== 'sync' && !loading.value)
const canOpenTerminal = computed(() => !!instance.value && isRunning.value && !isDeleted.value)
const canSuspend = computed(() => !!instance.value && !isBusy.value && !isSuspended.value && !isDeleted.value)
const canUnsuspend = computed(() => !!instance.value && !isBusy.value && isSuspended.value)
const canDeleteWithRefund = computed(() => !!instance.value && !isBusy.value && !isDeleted.value && instance.value.isHostOwner === true)
const hostName = computed(() => (mergedInstance.value as { host?: { name?: string | null } }).host?.name || '-')
const expiryValue = computed(() => ((mergedInstance.value as { expires_at?: string | null }).expires_at || null))
const detailToggleLabel = computed(() => `${showDetails.value ? t('common.collapse') : t('common.expand')} ${t('common.details')}`)

const activeTaskLabel = computed(() => {
  const taskType = activeTask.value?.taskType
  if (!taskType) return '-'
  const key = `instance.detail.actions.${taskType}`
  return te(key) ? t(key) : taskType
})

const activeTaskHint = computed(() => {
  if (!activeTask.value) return ''
  if (activeTask.value.progress) return activeTask.value.progress
  if (activeTask.value.queuePosition > 0) {
    return t('instance.detail.task.queuePosition', { position: activeTask.value.queuePosition })
  }
  return activeTask.value.status
})

const memoryUsagePercent = computed(() => {
  return stats.value ? Math.min(Math.max(stats.value.memory.usagePercent || 0, 0), 100) : 0
})
const diskUsagePercent = computed(() => {
  return stats.value ? Math.min(Math.max(stats.value.disk.usagePercent || 0, 0), 100) : 0
})

function normalizeInstanceResponse(payload: unknown): InstanceWithDetails | null {
  const wrapped = payload as { instance?: InstanceWithDetails } | null
  if (wrapped?.instance) return wrapped.instance
  return (payload as InstanceWithDetails | null) ?? null
}

function clearRefreshInterval(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

function clearStatsInterval(): void {
  if (statsInterval) {
    clearInterval(statsInterval)
    statsInterval = null
  }
}

function clearTaskPollingInterval(): void {
  if (taskPollingInterval) {
    clearInterval(taskPollingInterval)
    taskPollingInterval = null
  }
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function formatBooleanValue(value?: boolean | null): string {
  if (value === null || value === undefined) return '-'
  return value ? t('common.enabled') : t('common.disabled')
}

function getMetricBarClass(percent: number): string {
  if (percent >= 90) return 'bg-red-500'
  if (percent >= 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function getSwapDisplay(): string {
  if (!detailConfig.value?.swap.available) return '-'
  if (!detailConfig.value.swap.enabled) return t('common.disabled')
  return `${formatMemory(detailConfig.value.swap.sizeMb)}`
}

function getQuotaLimit(key: 'port' | 'snapshot' | 'backup' | 'site'): number | null {
  const detailLimit = mergedInstance.value.effective_quota_limit?.[key]
  if (detailLimit !== undefined && detailLimit !== null) {
    return detailLimit
  }

  if (key === 'port') return mergedInstance.value.port_limit ?? 20
  if (key === 'snapshot') return mergedInstance.value.snapshot_limit ?? 5
  if (key === 'backup') return mergedInstance.value.backup_limit ?? 3
  return mergedInstance.value.site_limit ?? null
}

function getQuotaUsage(key: 'port' | 'snapshot' | 'backup' | 'site'): number | null {
  const detailUsage = mergedInstance.value.quota_usage?.[key]
  if (detailUsage !== undefined && detailUsage !== null) {
    return detailUsage
  }

  const limit = getQuotaLimit(key)
  const remaining = mergedInstance.value.remaining_quota?.[key]
  if (limit === null || limit === undefined || remaining === null || remaining === undefined) {
    return null
  }
  if (limit === 0) {
    return null
  }
  return Math.max(0, limit - remaining)
}

function formatQuotaPair(used: number | null, limit: number | null): string {
  if (used === null || used === undefined || limit === null || limit === undefined) {
    return '-'
  }
  if (limit === 0) {
    return `${used} / ∞`
  }
  return `${used} / ${limit}`
}

const quotaCards = computed(() => [
  { key: 'port', label: t('host.batchConfig.portLimit'), value: formatQuotaPair(getQuotaUsage('port'), getQuotaLimit('port')) },
  { key: 'snapshot', label: t('host.batchConfig.snapshotLimit'), value: formatQuotaPair(getQuotaUsage('snapshot'), getQuotaLimit('snapshot')) },
  { key: 'site', label: t('host.batchConfig.siteLimit'), value: formatQuotaPair(getQuotaUsage('site'), getQuotaLimit('site')) },
  { key: 'backup', label: t('host.batchConfig.backupLimit'), value: formatQuotaPair(getQuotaUsage('backup'), getQuotaLimit('backup')) }
])

const expirySummary = computed(() => {
  if (!expiryValue.value) return t('billing.neverExpires')
  const date = new Date(expiryValue.value)
  if (Number.isNaN(date.getTime())) return '-'

  const dateLabel = date.toLocaleDateString()
  const diffDays = Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return `${t('billing.expired')} · ${dateLabel}`
  }

  return `${diffDays}${t('common.days')} · ${dateLabel}`
})

function normalizeStatsResponse(payload: unknown): { stats: TicketCardStats | null; status: string | null } {
  const wrapped = payload as { stats?: Partial<TicketCardStats>; status?: string } | null
  const flat = payload as Partial<TicketCardStats> & { status?: string } | null
  const rawStats = wrapped?.stats || (flat?.memory && flat?.disk && flat?.network ? flat : null)
  const nextStats = rawStats ? {
    memory: {
      usage: rawStats.memory?.usage ?? 0,
      limit: rawStats.memory?.limit ?? 0,
      usagePercent: rawStats.memory?.usagePercent ?? 0
    },
    disk: {
      usage: rawStats.disk?.usage ?? 0,
      limit: rawStats.disk?.limit ?? 0,
      usagePercent: rawStats.disk?.usagePercent ?? 0
    },
    network: {
      bytesReceived: rawStats.network?.bytesReceived ?? 0,
      bytesSent: rawStats.network?.bytesSent ?? 0
    }
  } : null

  return {
    stats: nextStats,
    status: wrapped?.status || flat?.status || null
  }
}

function startRefreshPolling(): void {
  clearRefreshInterval()
  if (!props.instanceSummary.id || !instance.value) return

  refreshInterval = setInterval(() => {
    if (!hasActiveTask.value) {
      void loadInstanceContext(true)
    }
  }, 15000)
}

function syncStatsPolling(): void {
  clearStatsInterval()
  if (!props.instanceSummary.id || !instance.value || !isRunning.value) return

  statsInterval = setInterval(() => {
    void loadStats(true)
  }, 3000)
}

async function loadStats(silent = true): Promise<void> {
  if (!props.instanceSummary.id || !instance.value || !isRunning.value) {
    stats.value = null
    return
  }

  try {
    const response = await api.instances.getStats(props.instanceSummary.id)
    const { stats: nextStats, status: nextStatus } = normalizeStatsResponse(response)
    stats.value = nextStats

    if (nextStatus && instance.value) {
      instance.value.status = nextStatus.toLowerCase() as InstanceWithDetails['status']
    }
  } catch (error) {
    if (!silent) {
      toast.error(`${t('common.loadFailed')}: ${translateError(error)}`)
    }
  }
}

async function pollActiveTask(): Promise<void> {
  const instanceId = props.instanceSummary.id
  if (!instanceId) {
    clearTaskPollingInterval()
    return
  }

  try {
    const response = await api.instances.getActiveTask(instanceId)
    const nextTask = response.task
    activeTask.value = nextTask

    if (!nextTask || nextTask.status === 'COMPLETED' || nextTask.status === 'FAILED') {
      clearTaskPollingInterval()
      if (nextTask?.status === 'FAILED' && nextTask.error) {
        toast.error(`${t('instance.detail.actions.actionFailed')}: ${nextTask.error}`)
      }
      optimisticStatus.value = null
      await loadInstanceContext(true)
    }
  } catch {
    clearTaskPollingInterval()
  }
}

function startTaskPolling(): void {
  clearTaskPollingInterval()
  taskPollingInterval = setInterval(() => {
    void pollActiveTask()
  }, 2000)
}

async function loadInstanceContext(silent = false): Promise<void> {
  const instanceId = props.instanceSummary.id
  if (!instanceId) return

  const requestId = ++latestRequestId

  if (!silent) {
    loading.value = true
  }

  detailError.value = ''

  const [detailResult, configResult, taskResult] = await Promise.allSettled([
    api.instances.get(instanceId),
    api.instances.getConfig(instanceId),
    api.instances.getActiveTask(instanceId)
  ])

  if (requestId !== latestRequestId) return

  if (detailResult.status === 'fulfilled') {
    instance.value = normalizeInstanceResponse(detailResult.value)
    optimisticStatus.value = null
  } else {
    instance.value = null
    detailError.value = translateError(detailResult.reason)
  }

  detailConfig.value = configResult.status === 'fulfilled' ? configResult.value : null
  activeTask.value = taskResult.status === 'fulfilled' ? taskResult.value.task : null

  if (instance.value && instance.value.status?.toLowerCase() === 'running') {
    await loadStats(true)
  } else {
    stats.value = null
  }

  if (activeTask.value && !['COMPLETED', 'FAILED'].includes(activeTask.value.status)) {
    startTaskPolling()
  } else {
    clearTaskPollingInterval()
  }

  syncStatsPolling()
  startRefreshPolling()
  loading.value = false
}

async function handleInstanceAction(action: 'start' | 'stop' | 'restart'): Promise<void> {
  if (!instance.value) return

  actionLoading.value = action
  try {
    const response = action === 'start'
      ? await api.instances.start(instance.value.id)
      : action === 'stop'
        ? await api.instances.stop(instance.value.id)
        : await api.instances.restart(instance.value.id)

    optimisticStatus.value = action === 'start'
      ? 'starting'
      : action === 'stop'
        ? 'stopping'
        : 'restarting'

    toast.success(t('instance.detail.actions.taskQueued'))
    await loadInstanceContext(true)
    startTaskPolling()
    void response.taskId
  } catch (error: any) {
    if (error?.code === 'TASK_IN_PROGRESS') {
      toast.warning(t('instance.detail.actions.taskInProgress'))
      await loadInstanceContext(true)
      startTaskPolling()
    } else {
      toast.error(`${t('instance.detail.actions.actionFailed')}: ${translateError(error)}`)
    }
    optimisticStatus.value = null
  } finally {
    actionLoading.value = ''
  }
}

async function syncInstanceStatus(): Promise<void> {
  if (!instance.value) return

  actionLoading.value = 'sync'
  try {
    const result = await api.instances.syncStatus(instance.value.id)
    if (result.statusChanged || result.ipv4Changed) {
      toast.success(t('admin.hosts.batchSyncSuccess', {
        synced: 1,
        changed: result.statusChanged ? 1 : 0
      }))
    } else {
      toast.info(t('admin.hosts.batchSyncNoChange', { synced: 1 }))
    }
    await loadInstanceContext(true)
  } catch (error) {
    toast.error(`${t('admin.hosts.batchSyncFailed')}: ${translateError(error)}`)
  } finally {
    actionLoading.value = ''
  }
}

async function suspendInstance(): Promise<void> {
  if (!instance.value) return
  if (!window.confirm(t('instance.detail.actions.confirmSuspend', { name: mergedInstance.value.name }))) return

  const reason = window.prompt(t('instance.detail.actions.suspendReasonPlaceholder'), '')
  if (reason === null) return

  actionLoading.value = 'suspend'
  try {
    await api.instances.suspend(instance.value.id, reason.trim() || undefined)
    toast.success(t('instance.detail.actions.suspendSuccess'))
    optimisticStatus.value = 'suspended'
    await loadInstanceContext(true)
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    actionLoading.value = ''
  }
}

async function unsuspendInstance(): Promise<void> {
  if (!instance.value) return
  if (!window.confirm(t('instance.detail.actions.confirmUnsuspend', { name: mergedInstance.value.name }))) return

  actionLoading.value = 'unsuspend'
  try {
    await api.instances.unsuspend(instance.value.id)
    toast.success(t('instance.detail.actions.unsuspendSuccess'))
    optimisticStatus.value = 'stopped'
    await loadInstanceContext(true)
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    actionLoading.value = ''
  }
}

async function deleteInstanceWithRefund(): Promise<void> {
  if (!instance.value || !canDeleteWithRefund.value) return

  const isPaidInstance = !!mergedInstance.value.packagePlanId
  const confirmMessage = isPaidInstance
    ? t('admin.billing.deleteRefundWarning')
    : t('instance.confirmDelete', { name: mergedInstance.value.name })

  if (!window.confirm(confirmMessage)) return

  const reasonInput = window.prompt(t('admin.billing.deleteRefundReasonPlaceholder'), '')
  if (reasonInput === null) return

  const reason = reasonInput.trim()
  if (isPaidInstance && !reason) {
    toast.warning(t('admin.billing.deleteRefundReasonRequired'))
    return
  }

  actionLoading.value = 'delete'
  try {
    const result = await api.instances.delete(instance.value.id, reason || undefined)
    optimisticStatus.value = 'deleted'
    toast.success(result.refundAmount && result.refundAmount > 0 ? t('admin.billing.deleteRefundSuccess') : t('common.deleteSuccess'))
    await loadInstanceContext(true)
  } catch (error) {
    toast.error(`${t('instance.detail.actions.actionFailed')}: ${translateError(error)}`)
  } finally {
    actionLoading.value = ''
  }
}

function openInstanceDetail(): void {
  void router.push({
    name: 'instance-detail',
    params: { id: props.instanceSummary.id }
  })
}

watch(
  () => props.instanceSummary.id,
  () => {
    latestRequestId += 1
    clearRefreshInterval()
    clearStatsInterval()
    clearTaskPollingInterval()
    instance.value = null
    detailConfig.value = null
    stats.value = null
    activeTask.value = null
    detailError.value = ''
    actionLoading.value = ''
    optimisticStatus.value = null
    terminalForceDisconnect.value = false
    showDetails.value = false

    if (props.instanceSummary.id) {
      void loadInstanceContext()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearRefreshInterval()
  clearStatsInterval()
  clearTaskPollingInterval()
})
</script>

<template>
  <div class="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/40">
    <div class="px-4 py-4 sm:px-5">
      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.95fr)]">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <InstanceDisplayIcon
              v-if="mergedInstance.iconBadgeId"
              :badge-id="mergedInstance.iconBadgeId"
              :alt="mergedInstance.name"
              :size="36"
            />
            <button class="text-left text-sm font-semibold text-gray-900 transition-colors hover:text-black dark:text-white dark:hover:text-gray-100" @click="openInstanceDetail">
              {{ mergedInstance.name }}
            </button>
            <span :class="['badge whitespace-nowrap', statusInfo.class]">{{ statusInfo.label }}</span>
            <span class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {{ instanceType }}
            </span>
            <span v-if="planLabel !== '-'" class="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {{ planLabel }}
            </span>
            <span v-if="priceLabel" class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {{ priceLabel }}
            </span>
          </div>

          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span>#{{ mergedInstance.id }}</span>
            <span>Incus {{ mergedInstance.incusId || '-' }}</span>
            <span>{{ imageLabel }}</span>
            <span>{{ hostName }}</span>
            <span>{{ formatDateTime((mergedInstance as any).created_at || null) }}</span>
          </div>

          <div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-xl border border-gray-200 bg-white/85 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/60">
              <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('admin.hosts.resources') }}</div>
              <div class="mt-1 space-y-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                <div>CPU {{ mergedInstance.cpu || 0 }}%</div>
                <div>{{ formatMemory(mergedInstance.memory) }}</div>
                <div>{{ formatDisk(mergedInstance.disk) }}</div>
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-white/85 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/60">
              <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('tickets.host') }}</div>
              <div class="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{{ hostName }}</div>
              <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ networkModeLabel }}</div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-white/85 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/60">
              <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('instance.quotaLabel') }}</div>
              <div class="mt-1 space-y-1 text-xs font-medium text-gray-900 dark:text-gray-100">
                <div v-for="item in quotaCards.filter(card => card.key !== 'backup')" :key="item.key" class="flex items-center justify-between gap-2">
                  <span class="text-gray-500 dark:text-gray-400">{{ item.label }}</span>
                  <span>{{ item.value }}</span>
                </div>
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-white/85 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/60">
              <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('billing.expiresAt') }}</div>
              <div class="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{{ expirySummary }}</div>
              <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ priceLabel || '-' }}</div>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950/60">
          <div v-if="hasActiveTask" class="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 dark:border-blue-900/30 dark:bg-blue-950/30">
            <div class="flex items-center justify-between gap-3 text-xs text-blue-700 dark:text-blue-300">
              <span class="font-medium">{{ activeTaskLabel }}</span>
              <span>{{ activeTask?.status }}</span>
            </div>
            <div class="mt-1 text-xs text-blue-700/80 dark:text-blue-300/80">
              {{ activeTaskHint }}
            </div>
          </div>

          <div class="grid gap-2" :class="hasActiveTask ? 'mt-3' : ''">
            <div class="grid gap-2 sm:grid-cols-2">
              <div class="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-black/30">
                <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{{ t('tickets.memory') }}</span>
                  <span>{{ stats ? `${formatMemory(stats.memory.usage)} / ${formatMemory(stats.memory.limit)}` : formatMemory(mergedInstance.memory) }}</span>
                </div>
                <div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div class="h-full rounded-full transition-all" :class="getMetricBarClass(memoryUsagePercent)" :style="{ width: `${stats ? memoryUsagePercent : 0}%` }"></div>
                </div>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-black/30">
                <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{{ t('tickets.disk') }}</span>
                  <span>{{ stats ? `${formatDisk(stats.disk.usage)} / ${formatDisk(stats.disk.limit)}` : formatDisk(mergedInstance.disk) }}</span>
                </div>
                <div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div class="h-full rounded-full transition-all" :class="getMetricBarClass(diskUsagePercent)" :style="{ width: `${stats ? diskUsagePercent : 0}%` }"></div>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div class="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-black/30">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">IP</div>
                <div class="mt-1 space-y-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                  <div class="font-mono text-xs">{{ displayIp.ipv4 || '-' }}</div>
                  <div class="truncate font-mono text-xs" :title="displayIp.ipv6 || ''">{{ displayIp.ipv6 || '-' }}</div>
                </div>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-black/30">
                <div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('billing.expiresAt') }}</div>
                <div class="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {{ formatDateTime(expiryValue) }}
                </div>
                <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ stats ? `${formatBytes(stats.network.bytesReceived)} / ${formatBytes(stats.network.bytesSent)}` : '-' }}
                </div>
              </div>
            </div>

            <div class="flex flex-wrap justify-end gap-2">
              <button class="btn-secondary btn-sm" @click="showDetails = !showDetails">
                {{ detailToggleLabel }}
              </button>
              <button v-if="hasSyncPermission" class="btn-ghost btn-sm" :disabled="!canSync" :title="t('admin.hosts.batchSyncStatus')" @click="syncInstanceStatus">
                <svg v-if="actionLoading === 'sync'" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button class="btn-secondary btn-sm" :disabled="!canOpenTerminal" @click="showTerminalModal = true">
                {{ t('terminal.title') }}
              </button>
              <button v-if="canStart" class="btn-secondary btn-sm" :disabled="actionLoading === 'start'" @click="handleInstanceAction('start')">
                {{ actionLoading === 'start' ? t('common.processing') : t('instance.actions.start') }}
              </button>
              <button v-if="canStop" class="btn-secondary btn-sm" :disabled="actionLoading === 'stop'" @click="handleInstanceAction('stop')">
                {{ actionLoading === 'stop' ? t('common.processing') : t('instance.actions.stop') }}
              </button>
              <button v-if="canRestart" class="btn-secondary btn-sm" :disabled="actionLoading === 'restart'" @click="handleInstanceAction('restart')">
                {{ actionLoading === 'restart' ? t('common.processing') : t('instance.actions.restart') }}
              </button>
              <button v-if="canSuspend" class="btn-secondary btn-sm" :disabled="actionLoading === 'suspend'" @click="suspendInstance">
                {{ actionLoading === 'suspend' ? t('instance.detail.actions.suspending') : t('instance.detail.actions.suspend') }}
              </button>
              <button v-if="canUnsuspend" class="btn-secondary btn-sm" :disabled="actionLoading === 'unsuspend'" @click="unsuspendInstance">
                {{ actionLoading === 'unsuspend' ? t('instance.detail.actions.unsuspending') : t('instance.detail.actions.unsuspend') }}
              </button>
              <button v-if="canDeleteWithRefund" class="btn-danger btn-sm" :disabled="actionLoading === 'delete'" @click="deleteInstanceWithRefund">
                {{ actionLoading === 'delete' ? t('common.deleting') : (mergedInstance.packagePlanId ? t('admin.billing.deleteRefund') : t('common.delete')) }}
              </button>
              <button class="btn-primary btn-sm" @click="openInstanceDetail">
                {{ t('common.details') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showDetails" class="border-t border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-5">
      <div v-if="loading" class="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-5 text-gray-500 dark:border-gray-800 dark:bg-gray-950/60 dark:text-gray-400">
        <svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="text-sm">{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="detailError" class="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 dark:border-red-500/20 dark:bg-red-500/10 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <div class="text-sm font-medium text-red-500">{{ t('common.loadFailed') }}</div>
          <div class="mt-1 break-all text-xs text-red-700/80 dark:text-red-300/80">{{ detailError }}</div>
        </div>
        <button class="btn-secondary btn-sm" @click="loadInstanceContext()">{{ t('common.retry') }}</button>
      </div>

      <div v-else class="grid gap-3 xl:grid-cols-2">
        <div class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/60">
          <div class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">{{ t('common.details') }}</div>
          <dl class="grid gap-3 text-sm sm:grid-cols-2">
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('tickets.instanceId') }}</dt>
              <dd class="font-mono text-gray-900 dark:text-gray-100">{{ mergedInstance.id }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('tickets.incusId') }}</dt>
              <dd class="break-all font-mono text-gray-900 dark:text-gray-100">{{ mergedInstance.incusId || '-' }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('tickets.packageName') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ planLabel }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('tickets.host') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ hostName }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('packageForm.fields.networkMode') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ networkModeLabel }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('packageForm.fields.instanceType') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ instanceType }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('instance.createdAt') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ formatDateTime((mergedInstance as any).created_at || null) }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('billing.expiresAt') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ formatDateTime(expiryValue) }}</dd>
            </div>
            <div v-if="(mergedInstance as any).suspend_reason" class="space-y-1 sm:col-span-2">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('admin.hosts.suspendReason') }}</dt>
              <dd class="break-all text-gray-900 dark:text-gray-100">{{ (mergedInstance as any).suspend_reason }}</dd>
            </div>
          </dl>
        </div>

        <div class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/60">
          <div class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">{{ t('admin.hosts.resources') }}</div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div v-for="item in quotaCards" :key="item.key" class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-black/20">
              <div class="text-[11px] text-gray-500 dark:text-gray-400">{{ item.label }}</div>
              <div class="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{{ item.value }}</div>
            </div>
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-black/20">
              <div class="text-[11px] text-gray-500 dark:text-gray-400">CPU</div>
              <div class="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{{ `${mergedInstance.cpu || 0}%` }}</div>
            </div>
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-black/20">
              <div class="text-[11px] text-gray-500 dark:text-gray-400">SWAP</div>
              <div class="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{{ getSwapDisplay() }}</div>
            </div>
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-black/20">
              <div class="text-[11px] text-gray-500 dark:text-gray-400">RX / TX</div>
              <div class="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{{ stats ? `${formatBytes(stats.network.bytesReceived)} / ${formatBytes(stats.network.bytesSent)}` : '-' }}</div>
            </div>
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-black/20">
              <div class="text-[11px] text-gray-500 dark:text-gray-400">IPv4</div>
              <div class="mt-1 break-all font-mono text-sm text-gray-900 dark:text-gray-100">{{ displayIp.ipv4 || '-' }}</div>
            </div>
            <div class="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-black/20">
              <div class="text-[11px] text-gray-500 dark:text-gray-400">IPv6</div>
              <div class="mt-1 break-all font-mono text-sm text-gray-900 dark:text-gray-100">{{ displayIp.ipv6 || '-' }}</div>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/60 xl:col-span-2">
          <div class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">{{ t('instanceConfig.title') }}</div>
          <dl class="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('packageForm.fields.limitsIngress') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ detailConfig?.config.limits_ingress || '-' }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('packageForm.fields.limitsEgress') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ detailConfig?.config.limits_egress || '-' }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('packageForm.fields.limitsProcesses') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ detailConfig?.config.limits_processes ?? '-' }}</dd>
            </div>
            <div class="space-y-1">
              <dt class="text-gray-500 dark:text-gray-400">{{ t('packageForm.fields.bootAutostart') }}</dt>
              <dd class="text-gray-900 dark:text-gray-100">{{ formatBooleanValue(detailConfig?.config.boot_autostart) }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>

    <TerminalModal
      v-model:visible="showTerminalModal"
      v-model:force-disconnect="terminalForceDisconnect"
      :instance-id="instance?.id || null"
      :instance-name="mergedInstance.name"
      :allow-manual-cloud-init-complete="false"
    />
  </div>
</template>
