<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { formatMemory, formatDisk, formatDate } from '@/utils/formatters'
import type { Instance } from '@/types/api'
import FlagIcon from '@/components/FlagIcon.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { getVipBadgeInlineStyle, normalizeVipBadgeStyle } from '@/utils/vipBadge'

const { t } = useI18n()

// SSH 连接帮助弹窗
const showSshHelpModal = ref(false)

// 托管者信息弹窗
const showHostOwnerModal = ref(false)

interface ResourceStats {
  memory: { usage: number; limit: number; usagePercent: number }
  disk: { usage: number; limit: number; usagePercent: number }
}

interface TrafficData {
  monthlyUsed: string
  monthlyUsedFormatted: string
  monthlyLimit: string | null
  monthlyLimitFormatted: string | null
  trafficStatus: 'NORMAL' | 'WARNING' | 'LIMITED'
  percentage: number
}

interface Props {
  instance: Instance
  stats: ResourceStats
  statsLoading: boolean
  trafficData?: TrafficData | null
  trafficLoading?: boolean
  showPassword: Record<string, boolean>
  instancePassword?: Record<string, string | null>
  canEditConfig?: boolean
  enableResourcePool?: boolean
}

interface Emits {
  (e: 'toggle-password', instanceId: number): void
  (e: 'copy', text: string): void
  (e: 'edit-config'): void
  (e: 'redeem'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const themeStore = useThemeStore()

const isRunning = computed<boolean>(() => {
  const s = props.instance?.status?.toLowerCase()
  return s === 'running'
})

// 是否可以编辑配置（只有 running 或 stopped 状态才能编辑，且需要权限）
const canEditConfig = computed<boolean>(() => {
  const s = props.instance?.status?.toLowerCase()
  const statusOk = s === 'running' || s === 'stopped'
  // 只有明确传递 true 时才允许编辑，默认 false
  const hasPermission = props.canEditConfig === true
  return statusOk && hasPermission
})

// 获取实例类型的样式类
function getInstanceTypeClass(type: string | undefined | null): string {
  const normalizedType = String(type || 'container').toLowerCase()
  switch (normalizedType) {
    case 'vm':
      return themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-600'
    case 'container':
    default:
      return themeStore.isDark ? 'bg-green-900/50 text-green-400' : 'bg-green-100 text-green-600'
  }
}

// 获取实例类型的标签文本
function getInstanceTypeLabel(type: string | undefined | null): string {
  const normalizedType = String(type || 'container').toLowerCase()
  switch (normalizedType) {
    case 'vm':
      return t('common.instanceType.vm')
    case 'container':
    default:
      return t('common.instanceType.container')
  }
}

// 获取网络模式的样式类
function getNetworkModeClass(mode: string | undefined | null): string {
  const normalizedMode = String(mode || 'nat').toLowerCase()
  switch (normalizedMode) {
    case 'nat':
      return themeStore.isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-600'
    case 'nat_ipv6':
      return themeStore.isDark ? 'bg-blue-900/50 text-blue-400' : 'bg-blue-100 text-blue-600'
    case 'nat_ipv6_nat':
      return themeStore.isDark ? 'bg-cyan-900/50 text-cyan-400' : 'bg-cyan-100 text-cyan-600'
    case 'ipv6_only':
      return themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-600'
    case 'ipv6_nat':
      return themeStore.isDark ? 'bg-teal-900/50 text-teal-400' : 'bg-teal-100 text-teal-600'
    default:
      return themeStore.isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-600'
  }
}

// 获取网络模式的标签文本
function getNetworkModeLabel(mode: string | undefined | null): string {
  const normalizedMode = String(mode || 'nat').toLowerCase()
  // 直接使用国际化 key，所有模式的 key 格式统一为 common.networkMode.<mode>
  const key = `common.networkMode.${normalizedMode}`
  const translated = t(key)
  // 如果翻译 key 不存在（返回 key 本身），回退到 nat 标签
  return translated === key ? t('common.networkMode.nat') : translated
}

// 流量进度条颜色
const trafficProgressBarClass = computed(() => {
  if (!props.trafficData) return 'bg-blue-500'
  if (props.trafficData.percentage >= 100) return 'bg-red-500'
  if (props.trafficData.percentage >= 80) return 'bg-yellow-500'
  return 'bg-blue-500'
})

// 格式化镜像名称：优先使用 imageName，否则去掉 images: 前缀
function formatImageName(image: string, imageName?: string | null): string {
  if (imageName) return imageName
  return image?.replace(/^images:/, '') || ''
}

// 获取封停原因的显示文本
function getSuspendReasonText(reason: string | null | undefined): string {
  if (!reason) return t('instance.detail.info.suspendReasonDefault')
  if (reason === 'expired') return t('instance.detail.info.suspendReasonExpired')
  return reason
}

// 格式化带宽值，统一换算成 Mbps
function formatBandwidth(bandwidth: string | null | undefined): string {
  if (!bandwidth) return t('traffic.unlimited')
  
  // 如果是带单位的字符串（如 "100Mbit"），转换显示格式
  if (/Mbit$/i.test(bandwidth)) {
    return bandwidth.replace(/Mbit$/i, ' Mbps')
  }
  if (/Gbit$/i.test(bandwidth)) {
    const value = parseFloat(bandwidth)
    return (value * 1024) + ' Mbps'
  }
  
  // 如果是纯数字（字节数表示，1GB=1Gbps），换算成 Mbps
  const bytes = BigInt(bandwidth)
  const GB = BigInt(1024 * 1024 * 1024)
  const MB = BigInt(1024 * 1024)
  
  if (bytes >= GB) {
    const gbps = Number(bytes / GB)
    return (gbps * 1024) + ' Mbps'
  } else if (bytes >= MB) {
    return Number(bytes / MB) + ' Mbps'
  }
  
  return t('traffic.unlimited')
}
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- Basic Info -->
    <div class="card p-5">
      <h2 
        class="text-sm font-medium mb-4"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ t('instance.detail.info.title') }}
      </h2>
      <dl class="space-y-3 text-sm">
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('instance.detail.info.instanceId') }}</dt>
          <dd class="flex items-center gap-2">
            <span
              class="font-mono text-xs"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >
              {{ instance.id }}
              <template v-if="instance.incus_id">
                <span :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'">/</span>
                <span>{{ instance.incus_id }}</span>
              </template>
            </span>
            <!-- 托管UID：仅托管节点实例显示 -->
            <button
              v-if="instance.hostOwnerInfo"
              class="text-xs px-1.5 py-0.5 rounded transition-colors"
              :class="themeStore.isDark 
                ? 'bg-blue-900/30 text-blue-400 hover:bg-blue-900/50' 
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'"
              @click="showHostOwnerModal = true"
            >
              {{ t('instance.detail.info.hostUid') }}:{{ instance.hostOwnerInfo.id }}
            </button>
          </dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">{{ t('instance.detail.info.image') }}</dt>
          <dd :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ formatImageName(instance.image, (instance as any).imageName) }}</dd>
        </div>
        <div class="flex justify-between items-center">
          <dt class="text-gray-500">{{ t('instance.detail.info.instanceMode') }}</dt>
          <dd class="flex items-center gap-2">
            <span
              :class="[
                'text-xs px-1.5 py-0.5 rounded',
                getInstanceTypeClass((instance as any).instance_type)
              ]"
            >
              {{ getInstanceTypeLabel((instance as any).instance_type) }}
            </span>
            <span
              :class="[
                'text-xs px-1.5 py-0.5 rounded',
                getNetworkModeClass(instance.network_mode)
              ]"
            >
              {{ getNetworkModeLabel(instance.network_mode) }}
            </span>
          </dd>
        </div>
        <div v-if="instance.ssh_port" class="flex justify-between">
          <dt class="text-gray-500">{{ t('instance.detail.info.sshPort') }}</dt>
          <dd :class="['flex items-center gap-2', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">
            <span class="font-mono">{{ instance.ssh_port }}</span>
            <button 
              class="text-blue-400/70 hover:text-blue-400"
              :title="t('instance.detail.info.sshHelpTitle')"
              @click="showSshHelpModal = true"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button 
              class="text-xs text-blue-500 hover:text-blue-400"
              @click="emit('copy', instance.ssh_port?.toString() || '')"
            >
              {{ t('instance.detail.info.copy') }}
            </button>
          </dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">{{ t('instance.detail.info.rootPassword') }}</dt>
          <dd :class="['flex items-center gap-2', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">
            <span 
              :id="'pwd-' + instance.id"
              class="font-mono"
            >{{ showPassword[instance.id] && instancePassword?.[instance.id] ? instancePassword[instance.id] : '••••••••' }}</span>
            <button 
              class="text-xs text-blue-500 hover:text-blue-400"
              @click="emit('toggle-password', instance.id)"
            >
              {{ showPassword[instance.id] ? t('instance.detail.info.hide') : t('instance.detail.info.show') }}
            </button>
            <button 
              v-if="showPassword[instance.id] && instancePassword?.[instance.id]"
              class="text-xs text-blue-500 hover:text-blue-400"
              @click="emit('copy', instancePassword[instance.id] || '')"
            >
              {{ t('instance.detail.info.copy') }}
            </button>
          </dd>
        </div>
        <!-- 节点 - 移到创建/到期时间上面 -->
        <div class="flex justify-between">
          <dt class="text-gray-500">{{ t('instance.detail.info.host') }}</dt>
          <dd :class="['flex items-center gap-2', themeStore.isDark ? 'text-gray-300' : 'text-gray-700']">
            <FlagIcon v-if="(instance as any).host?.country_code || (instance as any).hostCountryCode" :code="(instance as any).host?.country_code || (instance as any).hostCountryCode || 'us'" size="sm" />
            <span class="uppercase">{{ (instance as any).host?.name || (instance as any).host || '-' }}</span>
          </dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">{{ t('instance.detail.info.createdAt') }}</dt>
          <dd 
            class="text-xs"
            :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
          >
            {{ formatDate(instance.created_at) }}
          </dd>
        </div>
        <!-- 到期时间 -->
        <div v-if="instance.expires_at" class="flex justify-between">
          <dt class="text-gray-500">{{ t('instance.detail.info.expiresAt') }}</dt>
          <dd 
            class="text-xs"
            :class="[
              new Date(instance.expires_at) <= new Date() 
                ? (themeStore.isDark ? 'text-red-400' : 'text-red-600')
                : (themeStore.isDark ? 'text-gray-400' : 'text-gray-600')
            ]"
          >
            {{ formatDate(instance.expires_at) }}
          </dd>
        </div>
        <!-- 封停信息 -->
        <div v-if="instance.status === 'suspended'" class="p-2 rounded-lg" :class="themeStore.isDark ? 'bg-red-900/30' : 'bg-red-50'">
          <div class="flex items-center gap-2 mb-1">
            <svg class="w-4 h-4" :class="themeStore.isDark ? 'text-red-400' : 'text-red-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="text-sm font-medium" :class="themeStore.isDark ? 'text-red-400' : 'text-red-600'">{{ t('instance.detail.info.suspended') }}</span>
          </div>
          <p class="text-xs" :class="themeStore.isDark ? 'text-red-300' : 'text-red-600'">
            <span class="font-medium">{{ t('instance.detail.info.suspendReasonLabel') }}:</span>
            {{ getSuspendReasonText(instance.suspend_reason) }}
          </p>
          <p v-if="instance.suspended_at" class="text-xs mt-1" :class="themeStore.isDark ? 'text-red-400/70' : 'text-red-500/70'">
            {{ t('instance.detail.info.suspendedAt') }}: {{ formatDate(instance.suspended_at) }}
          </p>
          <p class="text-xs mt-2" :class="themeStore.isDark ? 'text-red-400/80' : 'text-red-500/80'">
            {{ t('instance.detail.info.suspendTip') }}
          </p>
        </div>
      </dl>
    </div>

    <!-- Resource Usage -->
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 
          class="text-sm font-medium"
          :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
        >
          {{ t('instance.detail.info.resourceUsage') }}
        </h2>
        <div class="flex items-center gap-2">
          <!-- 兑换按钮 -->
          <button
            v-if="props.enableResourcePool"
            class="text-xs px-2 py-1 rounded transition-colors"
            :class="themeStore.isDark ? 'bg-emerald-900/50 hover:bg-emerald-800/50 text-emerald-400' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600'"
            @click="emit('redeem')"
          >
            <svg class="w-3.5 h-3.5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
            {{ t('instance.detail.info.redeem') }}
          </button>
          <!-- 编辑按钮 -->
          <button
            class="text-xs px-2 py-1 rounded transition-colors"
            :class="[
              canEditConfig 
                ? (themeStore.isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-400' : 'bg-gray-100 hover:bg-gray-200 text-gray-600')
                : (themeStore.isDark ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed')
            ]"
            :disabled="!canEditConfig"
            :title="canEditConfig ? '' : t('instance.detail.info.cannotEditConfig')"
            @click="canEditConfig && emit('edit-config')"
          >
            <svg class="w-3.5 h-3.5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            {{ t('common.edit') }}
          </button>
          <div 
            v-if="isRunning && statsLoading" 
            class="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
            :class="themeStore.isDark ? 'border-gray-600' : 'border-gray-400'"
          ></div>
        </div>
      </div>
      <div class="space-y-4">
        <!-- CPU -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">
              <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              {{ t('instance.detail.info.cpu') }}
            </span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ instance.cpu }}%</span>
          </div>
        </div>
        <!-- Memory -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">
              <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              {{ t('instance.detail.info.memory') }}
              <span class="text-xs text-gray-400 ml-1">({{ t('instance.detail.info.includesCache') }})</span>
            </span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              <template v-if="stats.memory.usage > 0">
                {{ formatMemory(stats.memory.usage) }} / 
              </template>
              {{ formatMemory(stats.memory.limit > 0 ? stats.memory.limit : instance.memory) }}
              <span v-if="stats.memory.usagePercent > 0" class="text-xs text-gray-500 ml-1">
                ({{ stats.memory.usagePercent }}%)
              </span>
            </span>
          </div>
          <div 
            class="h-2 rounded-full overflow-hidden"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
          >
            <div 
              class="h-full rounded-full transition-all duration-500"
              :class="stats.memory.usagePercent > 80 ? 'bg-red-500' : stats.memory.usagePercent > 60 ? 'bg-yellow-500' : 'bg-green-500'"
              :style="{ width: stats.memory.usagePercent + '%' }"
            ></div>
          </div>
        </div>
        <!-- Disk -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">
              <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              {{ t('instance.detail.info.disk') }}
            </span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              <template v-if="stats.disk.usage > 0">
                {{ formatDisk(stats.disk.usage) }} / 
              </template>
              {{ formatDisk(stats.disk.limit > 0 ? stats.disk.limit : instance.disk) }}
              <span v-if="stats.disk.usagePercent > 0" class="text-xs text-gray-500 ml-1">
                ({{ stats.disk.usagePercent }}%)
              </span>
            </span>
          </div>
          <div 
            class="h-2 rounded-full overflow-hidden"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
          >
            <div 
              class="h-full rounded-full transition-all duration-500"
              :class="stats.disk.usagePercent > 80 ? 'bg-red-500' : stats.disk.usagePercent > 60 ? 'bg-yellow-500' : 'bg-purple-500'"
              :style="{ width: stats.disk.usagePercent + '%' }"
            ></div>
          </div>
        </div>
        <!-- Monthly Traffic -->
        <div>
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-500">
              <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
              {{ t('traffic.monthlyUsage') }}
            </span>
            <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              <template v-if="trafficLoading">
                <span class="text-xs text-gray-400">{{ t('common.loading') }}</span>
              </template>
              <template v-else-if="trafficData">
                {{ trafficData.monthlyUsedFormatted }}
                <template v-if="trafficData.monthlyLimitFormatted">
                  / {{ trafficData.monthlyLimitFormatted }}
                </template>
                <template v-else>
                  / {{ t('traffic.unlimited') }}
                </template>
                <span class="text-xs text-gray-500 ml-1">
                  ({{ (trafficData.percentage || 0).toFixed(1) }}%)
                </span>
              </template>
              <template v-else>
                <span class="text-xs text-gray-400">{{ t('traffic.noData') }}</span>
              </template>
            </span>
          </div>
          <div 
            class="h-2 rounded-full overflow-hidden"
            :class="[
              themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200',
              { 'opacity-0': !trafficData || trafficLoading }
            ]"
          >
            <div 
              :class="['h-full rounded-full transition-all duration-500', trafficProgressBarClass]"
              :style="{ width: Math.min(Math.max(trafficData?.percentage || 0, 0), 100) + '%' }"
            ></div>
          </div>
        </div>
        <!-- Bandwidth Limits -->
        <div class="pt-2 border-t" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <div class="flex justify-between text-xs text-gray-500">
            <span>
              <span class="inline-block w-2 h-2 bg-green-500 rounded-full mr-1"></span>
              {{ t('instance.detail.info.ingressLimit') }}: {{ formatBandwidth(instance.limitsIngress) }}
            </span>
            <span>
              <span class="inline-block w-2 h-2 bg-blue-500 rounded-full mr-1"></span>
              {{ t('instance.detail.info.egressLimit') }}: {{ formatBandwidth(instance.limitsEgress) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- SSH 连接帮助弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showSshHelpModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showSshHelpModal = false"></div>
          <div class="modal-content max-w-md">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('instance.detail.info.sshHelpTitle') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showSshHelpModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body space-y-4">
              <!-- IPv4 连接说明 -->
              <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-xs font-medium px-2 py-0.5 rounded" :class="themeStore.isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'">IPv4</span>
                </div>
                <p class="text-sm" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                  {{ t('instance.detail.info.sshHelpIpv4') }}
                </p>
              </div>
              <!-- IPv6 连接说明（仅在 nat_ipv6 模式下显示） -->
              <div 
                v-if="instance.network_mode === 'nat_ipv6'"
                class="p-3 rounded-lg" 
                :class="themeStore.isDark ? 'bg-blue-900/30' : 'bg-blue-50'"
              >
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-xs font-medium px-2 py-0.5 rounded" :class="themeStore.isDark ? 'bg-blue-800 text-blue-300' : 'bg-blue-100 text-blue-600'">IPv6</span>
                </div>
                <p class="text-sm" :class="themeStore.isDark ? 'text-blue-200' : 'text-blue-700'">
                  {{ t('instance.detail.info.sshHelpIpv6') }}
                </p>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-primary" @click="showSshHelpModal = false">
                {{ t('common.gotIt') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 托管者信息弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showHostOwnerModal && instance.hostOwnerInfo" class="modal-overlay">
          <div class="modal-backdrop" @click="showHostOwnerModal = false"></div>
          <div class="modal-content max-w-sm">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('instance.detail.info.hostOwnerTitle') }}</h3>
              <button type="button" class="text-themed-muted hover:text-themed" @click="showHostOwnerModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <!-- 用户头像区域 -->
              <div class="flex items-center gap-4 mb-6">
                <UserAvatar
                  :username="instance.hostOwnerInfo.username"
                  :email="instance.hostOwnerInfo.email"
                  :avatar-style="instance.hostOwnerInfo.avatarStyle"
                  :badge-id="instance.hostOwnerInfo.avatarBadgeId"
                  :size="56"
                />
                <div class="flex-1">
                  <p class="font-medium text-themed">{{ instance.hostOwnerInfo.username }}</p>
                  <p class="text-sm text-themed-muted">UID: {{ instance.hostOwnerInfo.id }}</p>
                </div>
                <!-- VIP徽章 -->
                <div 
                  v-if="instance.hostOwnerInfo.vipLevel > 0"
                  class="px-3 py-1.5 rounded-full border text-xs font-bold flex items-center gap-1.5 shadow-sm"
                  :style="getVipBadgeInlineStyle(normalizeVipBadgeStyle(instance.hostOwnerInfo.vipBadgeStyle, instance.hostOwnerInfo.vipLevel))"
                >
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                  </svg>
                  VIP{{ instance.hostOwnerInfo.vipLevel }}
                </div>
              </div>
              <!-- 详细信息 -->
              <div class="space-y-3">
                <div 
                  class="flex items-center justify-between p-3 rounded-lg"
                  :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
                >
                  <span class="text-sm text-themed-muted flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                    </svg>
                    {{ t('instance.detail.info.hostOwnerHostCount') }}
                  </span>
                  <span class="text-sm font-semibold" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'">
                    {{ instance.hostOwnerInfo.hostCount }}
                  </span>
                </div>
                <div 
                  class="flex items-center justify-between p-3 rounded-lg"
                  :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
                >
                  <span class="text-sm text-themed-muted flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    {{ t('instance.detail.info.hostOwnerInstanceCount') }}
                  </span>
                  <span class="text-sm font-semibold" :class="themeStore.isDark ? 'text-green-400' : 'text-green-600'">
                    {{ instance.hostOwnerInfo.instanceCount }}
                  </span>
                </div>
                <div 
                  class="flex items-center justify-between p-3 rounded-lg"
                  :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
                >
                  <span class="text-sm text-themed-muted flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {{ t('instance.detail.info.hostOwnerRegisteredDays') }}
                  </span>
                  <span class="text-sm font-semibold" :class="themeStore.isDark ? 'text-purple-400' : 'text-purple-600'">
                    {{ instance.hostOwnerInfo.registeredDays }} {{ t('common.days') }}
                  </span>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn-primary" @click="showHostOwnerModal = false">
                {{ t('common.close') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

