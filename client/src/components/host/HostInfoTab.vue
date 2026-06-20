<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import type { HostAgentStatus } from '@/types/api'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

const emit = defineEmits(['refresh'])

interface Host {
  id: number
  name: string
  url: string
  location?: string
  countryCode: string
  status: 'online' | 'offline' | 'maintenance'
  instanceCount?: number
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  resources?: {
    cpuUsed: number
    memoryUsed: number
    diskTotal: number  // 计算值，来自 storage_size * 1024
    diskUsed: number
  }
  natConfig?: {
    publicIp: string | null
    publicIpv6?: string | null
    bindIp?: string | null
    bindIpv6?: string | null
    portRangeStart: number | null
    portRangeEnd: number | null
    portsUsedCount?: number
  }
  createdAt?: string
  updatedAt?: string
}

interface Props {
  host: Host
}

const props = defineProps<Props>()

// 从系统数据库获取实例统计
const instanceStats = ref({
  count: 0,
  cpuUsed: 0,
  memoryUsed: 0,
  diskUsed: 0
})

// 流量历史数据
interface TrafficHistoryItem {
  date: string
  rxTotal: string
  txTotal: string
  rxFormatted: string
  txFormatted: string
  total: string
  totalFormatted: string
}

interface TrafficSummary {
  totalUsed: string
  totalUsedFormatted: string
  totalLimit: string
  totalLimitFormatted: string
}

const trafficHistory = ref<TrafficHistoryItem[]>([])
const trafficSummary = ref<TrafficSummary | null>(null)
const trafficPeriod = ref<{ periodStart: string; periodEnd: string } | null>(null)
const trafficLoading = ref(true)

const agentStatus = ref<HostAgentStatus | null>(null)
const agentStatusLoading = ref(true)
const agentStatusRefreshing = ref(false)
const agentUpgradeRequesting = ref(false)
const agentInstallCommandLoading = ref(false)
const agentInstallCommand = ref('')
const agentInstallTokenExpiresAt = ref('')
const agentStatusError = ref('')
let agentStatusRefreshTimer: ReturnType<typeof setInterval> | null = null
let agentStatusRefreshIntervalMs = 0

const defaultAgentRefreshSeconds = 30
const minAgentRefreshSeconds = 5
const maxAgentRefreshSeconds = 3600

async function loadInstanceStats() {
  try {
    const res = await api.instances.list({
      hostId: props.host.id,
      pageSize: 1000 // 获取所有实�?
    })
    const instances = (res as any).instances || []
    instanceStats.value = {
      count: (res as any).total || instances.length,
      cpuUsed: instances.reduce((sum: number, i: any) => sum + (i.cpu || 0), 0),
      memoryUsed: instances.reduce((sum: number, i: any) => sum + (i.memory || 0), 0),
      diskUsed: instances.reduce((sum: number, i: any) => sum + (i.disk || 0), 0)
    }
  } catch (err) {
    console.error('Failed to load instance stats:', err)
  }
}

async function loadTrafficHistory() {
  trafficLoading.value = true
  try {
    const response = await api.traffic.getHostTrafficHistory(props.host.id)
    trafficHistory.value = response.data
    trafficSummary.value = response.summary
    trafficPeriod.value = {
      periodStart: response.periodStart,
      periodEnd: response.periodEnd
    }
  } catch (error) {
    console.error('Failed to load traffic history:', error)
  } finally {
    trafficLoading.value = false
  }
}

async function loadAgentStatus(showToast = false) {
  agentStatusLoading.value = !agentStatus.value
  agentStatusRefreshing.value = true
  try {
    const response = await api.hosts.getAgentStatus(props.host.id)
    agentStatus.value = response.agent
    agentStatusError.value = ''
    startAgentStatusAutoRefresh()
    if (showToast) {
      toast.success(t('admin.hosts.agentStatusRefreshSuccess'))
    }
  } catch (err: any) {
    agentStatusError.value = err?.message || String(err)
    if (showToast) {
      toast.error(t('admin.hosts.agentStatusLoadFailed') + ': ' + agentStatusError.value)
    }
  } finally {
    agentStatusLoading.value = false
    agentStatusRefreshing.value = false
  }
}

function stopAgentStatusAutoRefresh() {
  if (agentStatusRefreshTimer) {
    clearInterval(agentStatusRefreshTimer)
    agentStatusRefreshTimer = null
  }
  agentStatusRefreshIntervalMs = 0
}

function startAgentStatusAutoRefresh() {
  const refreshIntervalMs = agentHeartbeatIntervalSeconds.value * 1000
  if (agentStatusRefreshTimer && agentStatusRefreshIntervalMs === refreshIntervalMs) {
    return
  }

  stopAgentStatusAutoRefresh()
  agentStatusRefreshIntervalMs = refreshIntervalMs
  agentStatusRefreshTimer = setInterval(() => {
    loadAgentStatus()
  }, refreshIntervalMs)
}

const statusInfo = computed(() => {
  const map: Record<string, { label: string; class: string; dot: string }> = {
    online: { label: t('admin.hosts.statusOnline'), class: 'badge-success', dot: 'bg-green-500' },
    offline: { label: t('admin.hosts.statusOffline'), class: 'badge-default', dot: 'bg-gray-500' },
    maintenance: { label: t('admin.hosts.statusMaintenance'), class: 'badge-warning', dot: 'bg-yellow-500' }
  }
  return map[props.host.status] || map.offline
})

const agentStatusInfo = computed(() => {
  if (!agentStatus.value) {
    return { label: t('admin.hosts.agentNotInstalled'), class: 'badge-default', dot: 'bg-gray-500' }
  }
  if (!agentStatus.value.enabled) {
    return { label: t('admin.hosts.agentDisabled'), class: 'badge-warning', dot: 'bg-yellow-500' }
  }
  const map: Record<string, { label: string; class: string; dot: string }> = {
    online: { label: t('admin.hosts.agentOnline'), class: 'badge-success', dot: 'bg-green-500' },
    offline: { label: t('admin.hosts.agentOffline'), class: 'badge-default', dot: 'bg-gray-500' }
  }
  return map[agentStatus.value.status] || { label: t('admin.hosts.agentUnknown'), class: 'badge-default', dot: 'bg-gray-500' }
})

const agentReport = computed(() => agentStatus.value?.lastReport ?? {})
const hostResources = computed(() => agentReport.value.resources ?? {})
const hostMetrics = computed(() => agentReport.value.metrics ?? {})
const agentHeartbeatIntervalSeconds = computed(() => {
  const value = hostMetrics.value.heartbeatIntervalSeconds
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minAgentRefreshSeconds ||
    value > maxAgentRefreshSeconds
  ) {
    return defaultAgentRefreshSeconds
  }
  return value
})
const agentStatusDescription = computed(() => t('admin.hosts.agentStatusDesc', {
  seconds: agentHeartbeatIntervalSeconds.value
}))

const agentVersionInfo = computed(() => {
  const latestVersion = agentStatus.value?.latestVersion
  const status = agentStatus.value?.versionStatus ?? 'unknown'
  if (status === 'latest') {
    return {
      label: t('admin.hosts.agentVersionLatest'),
      title: latestVersion ? t('admin.hosts.agentLatestVersion', { version: latestVersion }) : '',
      class: themeStore.isDark
        ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
        : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
    }
  }
  if (status === 'outdated') {
    return {
      label: t('admin.hosts.agentVersionOutdated'),
      title: latestVersion ? t('admin.hosts.agentLatestVersion', { version: latestVersion }) : '',
      class: themeStore.isDark
        ? 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20'
        : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
    }
  }
  return {
    label: t('admin.hosts.agentVersionUnknown'),
    title: latestVersion ? t('admin.hosts.agentLatestVersion', { version: latestVersion }) : '',
    class: themeStore.isDark
      ? 'bg-gray-800 text-gray-400 ring-1 ring-gray-700'
      : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
  }
})

const canRequestAgentUpgrade = computed(() => agentStatus.value?.versionStatus === 'outdated')

watch(() => props.host.id, () => {
  agentInstallCommand.value = ''
  agentInstallTokenExpiresAt.value = ''
  loadInstanceStats()
  loadTrafficHistory()
  loadAgentStatus()
  startAgentStatusAutoRefresh()
}, { immediate: true })

onBeforeUnmount(() => {
  stopAgentStatusAutoRefresh()
})

const agentIncusStatus = computed(() => {
  const incus = agentReport.value.incus
  if (!incus) return '-'
  return incus.available ? t('admin.hosts.agentIncusAvailable') : t('admin.hosts.agentIncusUnavailable')
})

function formatMemory(mb: number | undefined): string {
  if (!mb) return '0'
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return mb + ' MB'
}

// 硬盘格式化（1024进制�?
function formatDisk(mb: number | undefined): string {
  if (!mb) return '0'
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return mb + ' MB'
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-'
  return `${value.toFixed(1)}%`
}

function percentWidth(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '0%'
  return `${Math.max(0, Math.min(100, value))}%`
}

function progressColor(value: number | undefined, fallback = 'bg-blue-500'): string {
  if (value === undefined || value === null || Number.isNaN(value)) return fallback
  if (value >= 90) return 'bg-red-500'
  if (value >= 75) return 'bg-yellow-500'
  return fallback
}

function formatMemoryPair(used: number | undefined, total: number | undefined): string {
  if (used === undefined || total === undefined) return '-'
  return `${formatMemory(used)} / ${formatMemory(total)}`
}

function formatBytesPair(used: number | undefined, total: number | undefined): string {
  if (used === undefined || total === undefined) return '-'
  return `${formatBytes(used)} / ${formatBytes(total)}`
}

function formatLoadAverage(load1: number | undefined, load5: number | undefined, load15: number | undefined): string {
  if (load1 === undefined || load5 === undefined || load15 === undefined) return '-'
  return `${load1.toFixed(2)} / ${load5.toFixed(2)} / ${load15.toFixed(2)}`
}

function formatUptime(seconds: number | undefined): string {
  if (!seconds || seconds < 0) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function refreshAgentStatus() {
  loadAgentStatus(true)
}

async function requestAgentUpgrade() {
  if (!canRequestAgentUpgrade.value || agentUpgradeRequesting.value) return
  agentUpgradeRequesting.value = true
  try {
    const result = await api.hosts.requestAgentUpgrade(props.host.id)
    const message = result.requested
      ? t('admin.hosts.agentUpgradeRequestSuccess', { seconds: result.nextHeartbeatSeconds })
      : t('admin.hosts.agentAlreadyLatest')
    toast.success(message)
    await loadAgentStatus()
  } catch (err: any) {
    toast.error(t('admin.hosts.agentUpgradeRequestFailed') + ': ' + (err?.message || String(err)))
  } finally {
    agentUpgradeRequesting.value = false
  }
}

async function generateAgentInstallCommand() {
  if (agentInstallCommandLoading.value) return
  if (!window.confirm(t('admin.hosts.agentInstallCommandConfirm'))) return
  agentInstallCommandLoading.value = true
  try {
    const result = await api.hosts.generateAgentInstallCommand(props.host.id)
    agentInstallCommand.value = result.installCommand
    agentInstallTokenExpiresAt.value = result.installTokenExpiresAt
    agentStatus.value = result.agent
    toast.success(t('admin.hosts.agentInstallCommandSuccess'))
  } catch (err: any) {
    toast.error(t('admin.hosts.agentInstallCommandFailed') + ': ' + (err?.message || String(err)))
  } finally {
    agentInstallCommandLoading.value = false
  }
}

function copyAgentInstallCommand() {
  if (!agentInstallCommand.value) return
  navigator.clipboard.writeText(agentInstallCommand.value)
  toast.success(t('admin.hosts.agentInstallCommandCopied'))
}

// 资源校对
const recalculating = ref(false)

async function recalculateResources() {
  if (recalculating.value) return
  recalculating.value = true
  try {
    const result = await api.hosts.recalculateResources(props.host.id)
    if (result.hasChanges) {
      toast.success(t('admin.hosts.recalculateSuccess'))
      // 刷新父组件数�?
      emit('refresh')
    } else {
      toast.info(t('admin.hosts.recalculateNoChanges'))
    }
  } catch (err: any) {
    toast.error(t('admin.hosts.recalculateFailed') + ': ' + (err?.message || String(err)))
  } finally {
    recalculating.value = false
  }
}

// 使用系统内实例计算的资源使用�?
// CPU 使用率：基于 CPU allowance（资源池大小�?
const cpuUsagePercent = computed(() => {
  const total = props.host.cpuAllowanceMax
  if (!total || total === 0) return 0
  return Math.min(100, Math.round((instanceStats.value.cpuUsed / total) * 100))
})

// 内存使用率：基于内存配额（资源池大小�?
const memoryUsagePercent = computed(() => {
  const total = props.host.memoryMax
  if (!total || total === 0) return 0
  return Math.min(100, Math.round((instanceStats.value.memoryUsed / total) * 100))
})

// 磁盘使用率：基于物理磁盘大小
const diskUsagePercent = computed(() => {
  const total = props.host.resources?.diskTotal || 0
  if (!total) return 0
  return Math.min(100, Math.round((instanceStats.value.diskUsed / total) * 100))
})

const chartMaxValue = computed(() => {
  if (trafficHistory.value.length === 0) return 1
  const max = Math.max(...trafficHistory.value.map(h => Number(h.total)))
  return max || 1
})

// 格式化字节数为可读字符串
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0'
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'K'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + 'M'
  return (bytes / 1073741824).toFixed(1) + 'G'
}

// Y 轴刻度标�?
const yAxisLabels = computed(() => {
  const max = chartMaxValue.value
  return {
    top: formatBytes(max),
    mid: formatBytes(max / 2),
    bottom: '0'
  }
})

// 格式化日期显�?(MM-DD)
function formatDateLabel(dateStr: string): string {
  return dateStr.slice(5) // 去掉年份，只保留 MM-DD
}

// X 轴标签（显示 5-7 个日期点�?
const xAxisLabels = computed(() => {
  const len = trafficHistory.value.length
  if (len === 0) return []
  if (len <= 7) return trafficHistory.value.map((h, index) => ({ date: formatDateLabel(h.date), index }))
  
  // 显示首、尾和中间均匀分布的点
  const step = Math.floor(len / 5)
  const labels = []
  for (let i = 0; i < len; i += step) {
    labels.push({ date: formatDateLabel(trafficHistory.value[i].date), index: i })
  }
  // 确保最后一个日期显�?
  if (labels[labels.length - 1].index !== len - 1) {
    labels.push({ date: formatDateLabel(trafficHistory.value[len - 1].date), index: len - 1 })
  }
  return labels
})
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- 基本信息 -->
    <div class="card p-5">
      <h2 class="text-sm font-medium mb-4" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
        {{ t('admin.hosts.basicInfo') }}
      </h2>
      <dl class="space-y-3 text-sm">
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.hostName') }}</dt>
          <dd class="font-medium uppercase" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            {{ host.name }}
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.status') }}</dt>
          <dd>
            <span class="inline-flex items-center gap-1.5">
              <span :class="['w-2 h-2 rounded-full', statusInfo.dot]"></span>
              <span :class="['badge', statusInfo.class]">{{ statusInfo.label }}</span>
            </span>
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.hostDesc') }}</dt>
          <dd :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            <FlagIcon v-if="host.countryCode" :code="host.countryCode" size="sm" class="mr-1.5" />
            {{ host.location || '-' }}
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.instances') }}</dt>
          <dd :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            {{ instanceStats.count }}
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.instanceTypeLabel') }}</dt>
          <dd :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            {{ host.instanceType === 'container' ? t('admin.hosts.typeContainer') : host.instanceType === 'vm' ? t('admin.hosts.typeVm') : t('admin.hosts.typeBoth') }}
          </dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('admin.hosts.apiUrl') }}</dt>
          <dd class="font-mono text-xs truncate max-w-[200px]" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'" :title="host.url">
            {{ host.url }}
          </dd>
        </div>
        <div v-if="host.createdAt" class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('common.createdAt') }}</dt>
          <dd class="text-xs" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
            {{ formatDate(host.createdAt) }}
          </dd>
        </div>
      </dl>
    </div>

    <!-- 资源使用 -->
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ t('admin.hosts.resources') }}
        </h2>
        <button
          class="btn-ghost btn-xs flex items-center gap-1"
          :disabled="recalculating"
          :title="t('admin.hosts.recalculateResourcesTip')"
          @click="recalculateResources"
        >
          <svg 
            class="w-3.5 h-3.5" 
            :class="{ 'animate-spin': recalculating }"
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="hidden sm:inline">{{ t('admin.hosts.recalculateResources') }}</span>
        </button>
      </div>
      <div class="space-y-4">
        <!-- CPU -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">{{ t('admin.hosts.cpuQuota') }}</span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              {{ instanceStats.cpuUsed }} / {{ host.cpuAllowanceMax || 0 }}
            </span>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="cpuUsagePercent > 80 ? 'bg-red-500' : cpuUsagePercent > 60 ? 'bg-yellow-500' : 'bg-blue-500'"
              :style="{ width: cpuUsagePercent + '%' }"
            ></div>
          </div>
        </div>
        <!-- Memory -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">{{ t('admin.hosts.memoryQuota') }}</span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              {{ formatMemory(instanceStats.memoryUsed) }} / {{ formatMemory(host.memoryMax) }}
            </span>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="memoryUsagePercent > 80 ? 'bg-red-500' : memoryUsagePercent > 60 ? 'bg-yellow-500' : 'bg-green-500'"
              :style="{ width: memoryUsagePercent + '%' }"
            ></div>
          </div>
        </div>
        <!-- Disk -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">{{ t('admin.hosts.diskUsage') }}</span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              {{ formatDisk(instanceStats.diskUsed) }} / {{ formatDisk(host.resources?.diskTotal) }}
            </span>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="diskUsagePercent > 80 ? 'bg-red-500' : diskUsagePercent > 60 ? 'bg-yellow-500' : 'bg-purple-500'"
              :style="{ width: diskUsagePercent + '%' }"
            ></div>
          </div>
        </div>
      </div>

      <!-- NAT 配置 -->
      <div
        v-if="host.natConfig?.publicIp || host.natConfig?.publicIpv6 || host.natConfig?.bindIp || host.natConfig?.bindIpv6"
        class="mt-6 pt-4 border-t"
        :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
      >
        <h3 class="text-xs font-medium text-gray-500 mb-3">{{ t('admin.hosts.natConfig') }}</h3>
        <dl class="space-y-2 text-sm">
          <div v-if="host.natConfig?.publicIp" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.natPublicIpv4') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.publicIp }}</dd>
          </div>
          <div v-if="host.natConfig?.publicIpv6" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.natPublicIpv6') }}</dt>
            <dd class="font-mono break-all text-right" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.publicIpv6 }}</dd>
          </div>
          <div v-if="host.natConfig?.bindIp" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.natBindIpv4') }}</dt>
            <dd class="font-mono break-all text-right" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.bindIp }}</dd>
          </div>
          <div v-if="host.natConfig?.bindIpv6" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.natBindIpv6') }}</dt>
            <dd class="font-mono break-all text-right" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.bindIpv6 }}</dd>
          </div>
          <div v-if="host.natConfig?.portRangeStart != null || host.natConfig?.portRangeEnd != null" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.portRange') }}</dt>
            <dd class="font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              {{ host.natConfig.portRangeStart }} - {{ host.natConfig.portRangeEnd }}
            </dd>
          </div>
          <div v-if="host.natConfig.portsUsedCount !== undefined" class="flex justify-between">
            <dt class="text-gray-500">{{ t('admin.hosts.portsUsed') }}</dt>
            <dd :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ host.natConfig.portsUsedCount }}</dd>
          </div>
        </dl>
      </div>
    </div>
  </div>

  <!-- 宿主机状态 -->
  <div class="card p-5 mt-4">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <div>
        <h2 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ t('admin.hosts.agentStatusTitle') }}
        </h2>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          {{ agentStatusDescription }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2 self-start sm:self-auto">
        <button
          class="btn-secondary btn-xs flex items-center gap-1"
          :disabled="agentInstallCommandLoading"
          @click="generateAgentInstallCommand"
        >
          <svg
            class="w-3.5 h-3.5"
            :class="{ 'animate-spin': agentInstallCommandLoading }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0l4-4m-4 4l-4-4M4 17v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
          </svg>
          <span>{{ t('admin.hosts.agentInstallCommand') }}</span>
        </button>
        <button
          class="btn-ghost btn-xs flex items-center gap-1"
          :disabled="agentStatusRefreshing"
          @click="refreshAgentStatus"
        >
          <svg
            class="w-3.5 h-3.5"
            :class="{ 'animate-spin': agentStatusRefreshing }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>{{ t('common.refresh') }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="agentInstallCommand"
      class="rounded-lg p-3 mb-4"
      :class="themeStore.isDark ? 'bg-gray-900/70 border border-gray-800' : 'bg-gray-50 border border-gray-200'"
    >
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div>
          <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
            {{ t('admin.hosts.agentInstallCommandTitle') }}
          </p>
          <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
            {{ t('admin.hosts.agentInstallCommandHint') }}
            <span v-if="agentInstallTokenExpiresAt">
              {{ t('admin.hosts.agentInstallTokenExpiresAt', { time: formatDate(agentInstallTokenExpiresAt) }) }}
            </span>
          </p>
        </div>
        <button class="btn-secondary btn-xs" @click="copyAgentInstallCommand">
          {{ t('admin.hosts.copyCommand') }}
        </button>
      </div>
      <pre class="rounded-md p-3 overflow-x-auto text-xs font-mono whitespace-pre-wrap break-all" :class="themeStore.isDark ? 'bg-black/40 text-green-300' : 'bg-gray-900 text-green-300'">{{ agentInstallCommand }}</pre>
    </div>

    <div v-if="agentStatusLoading" class="animate-pulse grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div
        v-for="i in 6"
        :key="i"
        class="h-20 rounded-lg"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
      ></div>
    </div>

    <div
      v-else-if="agentStatusError"
      class="rounded-lg p-3 text-sm"
      :class="themeStore.isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-600'"
    >
      {{ t('admin.hosts.agentStatusLoadFailed') }}: {{ agentStatusError }}
    </div>

    <div v-else-if="!agentStatus" class="flex items-start gap-3 rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-gray-50'">
      <span :class="['w-2.5 h-2.5 rounded-full mt-1.5', agentStatusInfo.dot]"></span>
      <div>
        <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ agentStatusInfo.label }}
        </p>
        <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          {{ t('admin.hosts.agentNoRecordHint') }}
        </p>
      </div>
    </div>

    <template v-else>
      <div
        class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 mb-4 border-b"
        :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1.5">
            <span :class="['w-2 h-2 rounded-full', agentStatusInfo.dot]"></span>
            <span :class="['badge', agentStatusInfo.class]">{{ agentStatusInfo.label }}</span>
          </span>
          <button
            v-if="canRequestAgentUpgrade"
            type="button"
            class="text-xs px-2 py-1 rounded-full font-mono inline-flex items-center gap-1.5 transition hover:brightness-105 disabled:cursor-wait disabled:opacity-70"
            :class="agentVersionInfo.class"
            :title="agentStatus.latestVersion ? t('admin.hosts.agentUpgradeClickHint', { version: agentStatus.latestVersion }) : agentVersionInfo.title"
            :disabled="agentUpgradeRequesting"
            @click="requestAgentUpgrade"
          >
            <svg
              v-if="agentUpgradeRequesting"
              class="w-3 h-3 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span v-if="agentStatus.version">{{ agentStatus.version }}</span>
            <span class="font-sans font-medium">{{ agentVersionInfo.label }}</span>
          </button>
          <span
            v-else
            class="text-xs px-2 py-1 rounded-full font-mono inline-flex items-center gap-1.5"
            :class="agentVersionInfo.class"
            :title="agentVersionInfo.title"
          >
            <span v-if="agentStatus.version">{{ agentStatus.version }}</span>
            <span class="font-sans font-medium">{{ agentVersionInfo.label }}</span>
          </span>
          <span
            v-for="capability in agentStatus.capabilities"
            :key="capability"
            class="text-xs px-2 py-1 rounded-full"
            :class="themeStore.isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-600'"
          >
            {{ capability }}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          <p>
            {{ t('admin.hosts.agentIncus') }}:
            <span :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ agentIncusStatus }}</span>
            <span
              v-if="agentReport.incus?.socket"
              class="font-mono inline-block max-w-[14rem] truncate align-bottom ml-1"
              :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
              :title="agentReport.incus.socket"
            >
              {{ agentReport.incus.socket }}
            </span>
          </p>
          <p>
            {{ t('admin.hosts.agentLastSeen') }}:
            <span :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ formatDate(agentStatus.lastSeenAt || undefined) }}</span>
          </p>
          <p>
            {{ t('admin.hosts.agentHeartbeatIp') }}:
            <span class="font-mono" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ agentStatus.lastHeartbeatIp || '-' }}</span>
          </p>
          <p>
            {{ t('admin.hosts.agentUptime') }}:
            <span :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ formatUptime(hostMetrics.uptimeSeconds) }}</span>
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-white border border-gray-200 shadow-sm'">
          <div class="flex justify-between items-start gap-3 mb-2">
            <div>
              <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentCpuUsage') }}</p>
              <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ hostResources.cpuTotal || '-' }} {{ t('admin.hosts.agentCpuCores') }}
              </p>
            </div>
            <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
              {{ formatPercent(hostResources.cpuUsagePercent) }}
            </p>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="progressColor(hostResources.cpuUsagePercent, 'bg-blue-500')"
              :style="{ width: percentWidth(hostResources.cpuUsagePercent) }"
            ></div>
          </div>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-white border border-gray-200 shadow-sm'">
          <div class="flex justify-between items-start gap-3 mb-2">
            <div>
              <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentMemoryUsage') }}</p>
              <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ formatMemoryPair(hostResources.memoryUsedMb, hostResources.memoryTotalMb) }}
              </p>
            </div>
            <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
              {{ formatPercent(hostResources.memoryUsagePercent) }}
            </p>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="progressColor(hostResources.memoryUsagePercent, 'bg-green-500')"
              :style="{ width: percentWidth(hostResources.memoryUsagePercent) }"
            ></div>
          </div>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-white border border-gray-200 shadow-sm'">
          <div class="flex justify-between items-start gap-3 mb-2">
            <div>
              <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentSwapUsage') }}</p>
              <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ formatMemoryPair(hostResources.swapUsedMb, hostResources.swapTotalMb) }}
              </p>
            </div>
            <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
              {{ formatPercent(hostResources.swapUsagePercent) }}
            </p>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="progressColor(hostResources.swapUsagePercent, 'bg-cyan-500')"
              :style="{ width: percentWidth(hostResources.swapUsagePercent) }"
            ></div>
          </div>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-800/60' : 'bg-white border border-gray-200 shadow-sm'">
          <div class="flex justify-between items-start gap-3 mb-2">
            <div>
              <p class="text-xs font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                {{ t('admin.hosts.agentDiskUsage') }}
                <span v-if="hostResources.diskMountpoint" class="font-mono">({{ hostResources.diskMountpoint }})</span>
              </p>
              <p class="text-xs mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ formatBytesPair(hostResources.diskUsedBytes, hostResources.diskTotalBytes) }}
              </p>
            </div>
            <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
              {{ formatPercent(hostResources.diskUsagePercent) }}
            </p>
          </div>
          <div class="h-2 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-200'">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="progressColor(hostResources.diskUsagePercent, 'bg-purple-500')"
              :style="{ width: percentWidth(hostResources.diskUsagePercent) }"
            ></div>
          </div>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-900/60' : 'bg-white border border-gray-200 shadow-sm'">
          <p class="text-xs font-medium mb-1" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentLoadAverage') }}</p>
          <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
            {{ formatLoadAverage(hostMetrics.load1, hostMetrics.load5, hostMetrics.load15) }}
          </p>
          <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">{{ t('admin.hosts.agentLoadAverageHint') }}</p>
        </div>

        <div class="rounded-lg p-4" :class="themeStore.isDark ? 'bg-gray-900/60' : 'bg-white border border-gray-200 shadow-sm'">
          <p class="text-xs font-medium mb-1" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ t('admin.hosts.agentProcessCount') }}</p>
          <p class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
            {{ hostResources.processCount ?? '-' }}
          </p>
        </div>
      </div>
    </template>
  </div>

  <!-- 流量统计 -->
  <div class="card p-5 mt-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
        {{ t('admin.hosts.trafficStats') }}
        <span v-if="trafficPeriod" class="text-xs font-normal ml-2" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          ({{ trafficPeriod.periodStart.slice(5) }} ~ {{ trafficPeriod.periodEnd.slice(5) }})
        </span>
      </h2>
      <span 
        v-if="!trafficLoading && trafficSummary"
        class="text-xs px-2 py-1 rounded-full"
        :class="themeStore.isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600'"
      >
        {{ t('admin.hosts.monthlyUsed') }}: {{ trafficSummary.totalUsedFormatted }} | {{ t('admin.hosts.hostTotalLimit') }}: {{ trafficSummary.totalLimitFormatted }}
      </span>
    </div>

    <!-- 加载状�?-->
    <div v-if="trafficLoading" class="animate-pulse">
      <div class="flex items-end gap-1 h-32">
        <div 
          v-for="i in 30" 
          :key="i" 
          class="flex-1 rounded-t"
          :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200'"
          :style="{ height: `${Math.random() * 100}%` }"
        ></div>
      </div>
    </div>

    <!-- 有数据显示图�?-->
    <template v-else-if="trafficHistory.length > 0">
      <div class="flex">
        <!-- Y 轴刻�?-->
        <div class="flex flex-col justify-between h-32 pr-2 text-xs w-10" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
          <span class="text-right">{{ yAxisLabels.top }}</span>
          <span class="text-right">{{ yAxisLabels.mid }}</span>
          <span class="text-right">{{ yAxisLabels.bottom }}</span>
        </div>
        
        <!-- 图表区域 -->
        <div class="flex-1">
          <!-- 背景网格�?-->
          <div class="relative h-32">
            <div 
              class="absolute inset-0 flex flex-col justify-between pointer-events-none"
            >
              <div class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"></div>
              <div class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"></div>
              <div class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"></div>
            </div>
            
            <!-- 柱状�?-->
            <div class="absolute inset-0 flex items-end gap-0.5 px-1">
              <div 
                v-for="(item, index) in trafficHistory" 
                :key="item.date"
                class="flex-1 min-w-0.5 rounded-t transition-all duration-200 cursor-pointer group relative"
                :class="[
                  themeStore.isDark 
                    ? 'bg-gradient-to-t from-blue-600 to-blue-400 hover:from-blue-500 hover:to-blue-300' 
                    : 'bg-gradient-to-t from-blue-500 to-blue-400 hover:from-blue-400 hover:to-blue-300'
                ]"
                :style="{ height: `${Math.max((Number(item.total) / chartMaxValue) * 100, 1)}%` }"
              >
                <!-- Tooltip -->
                <div 
                  class="absolute bottom-full mb-2 px-2.5 py-1.5 text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10"
                  :class="[
                    themeStore.isDark ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-gray-900 border border-gray-200 shadow-md',
                    index < 5 ? 'left-0' : index > trafficHistory.length - 5 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                  ]"
                >
                  <div class="font-medium mb-1">{{ item.date }}</div>
                  <div class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-green-500"></span>
                    <span>{{ t('traffic.download') }}: {{ item.rxFormatted }}</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-orange-500"></span>
                    <span>{{ t('traffic.upload') }}: {{ item.txFormatted }}</span>
                  </div>
                  <div 
                    class="mt-1 pt-1 font-medium"
                    :class="themeStore.isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'"
                  >
                    {{ t('traffic.total') }}: {{ item.totalFormatted }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- X轴标�?-->
          <div class="relative h-5 mt-1">
            <div 
              v-for="label in xAxisLabels" 
              :key="label.index"
              class="absolute text-xs transform -translate-x-1/2"
              :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
              :style="{ left: `${(label.index / Math.max(trafficHistory.length - 1, 1)) * 100}%` }"
            >
              {{ label.date }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 无数据状�?-->
    <div v-else class="text-center py-8">
      <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
        {{ t('traffic.noHistoryData') }}
      </span>
    </div>
  </div>
</template>
