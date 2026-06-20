<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import type { Instance } from '@/types/api'

const { t } = useI18n()

interface PortMapping {
  id: number
  protocol: 'tcp' | 'udp'
  publicPort?: number
  privatePort?: number
  public_port?: number
  private_port?: number
  remark?: string | null
}

// 兼容两种命名格式
function getPublicPort(m: PortMapping): number {
  return m.publicPort ?? m.public_port ?? 0
}

function getPrivatePort(m: PortMapping): number {
  return m.privatePort ?? m.private_port ?? 0
}

interface Props {
  instance: Instance
  copied: string
  canManagePorts?: boolean  // AUTH004: 节点所有者不能管理端口映射
  isInstanceOwner?: boolean  // 是否是实例所有者
  reassignIpv6Loading?: boolean  // 重新分配 IPv6 加载状态
  lastIpv6ReassignAt?: string | null  // 上次重新分配 IPv6 时间
  deletePortsLoading?: boolean  // 批量删除加载状态
}

interface Emits {
  (e: 'copy', text: string, key?: string): void
  (e: 'add-port'): void
  (e: 'delete-port', portId: number): void
  (e: 'delete-ports', portIds: number[]): void
  (e: 'reassign-ipv6'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const themeStore = useThemeStore()

function isIpv4Address(value: string | null | undefined): boolean {
  if (!value) return false
  return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(value)
}

const publicIpv4Address = computed<string | null>(() => {
  const candidate = (props.instance as any).nat_public_ip ?? props.instance.natPublicIp ?? props.instance.host?.nat_public_ip ?? null
  return isIpv4Address(candidate) ? candidate : null
})

// 宿主机公网 IPv6 地址（从 host_ip_address 中提取，仅在 IPv6 NAT 模式下使用）
function isIpv6Address(value: string | null | undefined): boolean {
  if (!value) return false
  // 简单检测是否包含冒号（IPv6 特征）
  return value.includes(':')
}

const hostPublicIpv6 = computed<string | null>(() => {
  // 优先从新增的 host_ipv6_address 字段获取（后端从 ipv6_gateway 提取）
  const hostIpv6 = (props.instance as any).host_ipv6_address
    ?? (props.instance as any).hostIpv6Address
    ?? null
  if (hostIpv6 && isIpv6Address(hostIpv6)) return hostIpv6
  // 回退：从 host_ip_address 获取（如果宿主机使用 IPv6 连接）
  const hostIp = (props.instance as any).host_ip_address 
    ?? (props.instance as any).hostIpAddress 
    ?? (props.instance as any).host?.ip_address 
    ?? null
  if (isIpv6Address(hostIp)) return hostIp
  return null
})

// 端口配额状态（如果未特别指定，放行判断交由后端）
const portLimit = computed<number | null>(() => {
  const limit = (props.instance as any)?.port_limit
  return limit === undefined ? null : limit
})

// 最终显示的公网 IPv6 地址（根据网络模式决定优先级）
const displayIpv6 = computed<string | null>(() => {
  const mode = props.instance.network_mode
  // nat_ipv6_nat / ipv6_nat 模式：容器共享宿主机 IPv6，优先显示宿主机公网 IPv6
  if (mode === 'nat_ipv6_nat' || mode === 'ipv6_nat') {
    return hostPublicIpv6.value || props.instance.ipv6 || null
  }
  // nat_ipv6 / ipv6_only 模式：容器有独立的公网 IPv6
  return props.instance.ipv6 || hostPublicIpv6.value || null
})
const networkMode = computed<string>(() => props.instance.network_mode || (props.instance as any)?.networkMode || '')
const isIpv6OnlyInstance = computed<boolean>(() => networkMode.value === 'ipv6_only')
const hasPortQuota = computed<boolean>(() => portLimit.value !== 0) // 如果设置为0则没有配额，否则认为有配额（哪怕null）
const portQuotaUsed = computed<number>(() => portMappings.value.length)
const portQuotaRemaining = computed<number>(() => {
  if (portLimit.value === null) return 999 // fallback unlimited representation
  return Math.max(0, portLimit.value - portQuotaUsed.value)
})
const isPortQuotaFull = computed<boolean>(() => portLimit.value !== null && portQuotaRemaining.value <= 0)
const canAddPorts = computed<boolean>(() => {
  if (props.canManagePorts === false) return false
  if (isIpv6OnlyInstance.value) return false
  return true
})

// 协议筛选
const protocolFilter = ref<'both' | 'tcp' | 'udp'>('both')

// 分页
const portPage = ref<number>(1)
const portPageSize = ref<number>(30)
const pageSizeOptions = [10, 20, 30, 50, 100]

// 多选
const selectedPorts = ref<Set<number>>(new Set())
const isSelectAll = computed(() => {
  if (paginatedPorts.value.length === 0) return false
  return paginatedPorts.value.every(m => selectedPorts.value.has(m.id))
})
const isPartialSelect = computed(() => {
  if (paginatedPorts.value.length === 0) return false
  const selectedInPage = paginatedPorts.value.filter(m => selectedPorts.value.has(m.id)).length
  return selectedInPage > 0 && selectedInPage < paginatedPorts.value.length
})
const hasSelection = computed(() => selectedPorts.value.size > 0)

const portMappings = computed<PortMapping[]>(() => {
  return (props.instance as any)?.port_mappings || []
})

// 根据协议筛选后的映射
const filteredPortMappings = computed<PortMapping[]>(() => {
  if (protocolFilter.value === 'both') return portMappings.value
  return portMappings.value.filter(m => m.protocol === protocolFilter.value)
})

const paginatedPorts = computed(() => {
  const start = (portPage.value - 1) * portPageSize.value
  return filteredPortMappings.value.slice(start, start + portPageSize.value)
})

const portTotalPages = computed<number>(() => {
  return Math.ceil(filteredPortMappings.value.length / portPageSize.value) || 1
})

// 筛选或每页数量变化时重置页码和选中
watch([protocolFilter, portPageSize], () => {
  portPage.value = 1
  selectedPorts.value.clear()
})

// 翻页时清空选中（避免删除不可见的端口）
watch(portPage, () => {
  selectedPorts.value.clear()
})

// 切换全选
function toggleSelectAll() {
  if (isSelectAll.value) {
    // 取消当前页的选中
    paginatedPorts.value.forEach(m => selectedPorts.value.delete(m.id))
  } else {
    // 选中当前页
    paginatedPorts.value.forEach(m => selectedPorts.value.add(m.id))
  }
}

// 切换单个选中
function toggleSelect(id: number) {
  if (selectedPorts.value.has(id)) {
    selectedPorts.value.delete(id)
  } else {
    selectedPorts.value.add(id)
  }
}

// 批量删除
function handleBatchDelete() {
  if (selectedPorts.value.size === 0) return
  emit('delete-ports', Array.from(selectedPorts.value))
}

// 删除成功后清空选中
watch(() => props.deletePortsLoading, (loading, prevLoading) => {
  if (prevLoading && !loading) {
    selectedPorts.value.clear()
  }
})

// 自动调整页码（当删除导致当前页超出范围时）
watch(portTotalPages, (newTotal) => {
  if (portPage.value > newTotal) {
    portPage.value = Math.max(1, newTotal)
  }
})

// 当端口映射数据变化时，清理不存在的选中项
watch(portMappings, (newMappings) => {
  const existingIds = new Set(newMappings.map(m => m.id))
  const toRemove: number[] = []
  selectedPorts.value.forEach(id => {
    if (!existingIds.has(id)) {
      toRemove.push(id)
    }
  })
  toRemove.forEach(id => selectedPorts.value.delete(id))
}, { deep: true })

// 计算 IPv6 重新分配冷却状态
const ipv6ReassignCooldown = computed(() => {
  if (!props.lastIpv6ReassignAt) {
    return { inCooldown: false, remainingHours: 0 }
  }
  const cooldownMs = 24 * 60 * 60 * 1000 // 24小时
  const lastReassign = new Date(props.lastIpv6ReassignAt).getTime()
  const timeSinceLastReassign = Date.now() - lastReassign
  if (timeSinceLastReassign < cooldownMs) {
    const remainingHours = Math.ceil((cooldownMs - timeSinceLastReassign) / (60 * 60 * 1000))
    return { inCooldown: true, remainingHours }
  }
  return { inCooldown: false, remainingHours: 0 }
})

// 是否可以重新分配 IPv6
const canReassignIpv6 = computed(() => {
  return props.instance.status === 'stopped' && !ipv6ReassignCooldown.value.inCooldown
})

</script>

<template>
  <div class="space-y-4">
    <!-- Network Addresses -->
    <div class="card p-5">
      <h2 
        class="text-sm font-medium mb-4"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ t('instance.detail.network.title') }}
      </h2>
      <dl class="space-y-3 text-sm">
        <!-- NAT 模式: 显示内网 IPv4 和公网 IPv4（如果有） -->
        <template v-if="['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(instance.network_mode || '')">
          <!-- 内网 IPv4 -->
          <div class="flex justify-between items-center">
            <dt class="text-gray-500">{{ t('instance.detail.network.privateIpv4') }}</dt>
            <dd v-if="instance.ipv4" class="flex items-center gap-2">
              <code 
                class="font-mono px-2 py-0.5 rounded"
                :class="themeStore.isDark ? 'text-gray-300 bg-gray-800' : 'text-gray-700 bg-gray-100'"
              >{{ instance.ipv4 }}</code>
              <button 
                class="text-gray-500 hover:text-gray-400" 
                :title="t('common.copy')"
                @click="emit('copy', instance.ipv4, 'ipv4')"
              >
                <svg v-if="copied !== 'ipv4'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <svg v-else class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </dd>
            <dd v-else class="text-gray-500">-</dd>
          </div>
          <!-- 只有真实公网 IPv4 时才显示 -->
          <div v-if="publicIpv4Address" class="flex justify-between items-center mt-3">
            <dt class="text-gray-500">{{ t('instance.detail.network.publicIpv4') }}</dt>
            <dd class="flex items-center gap-2">
              <code 
                class="font-mono px-2 py-0.5 rounded"
                :class="themeStore.isDark ? 'text-gray-300 bg-gray-800' : 'text-gray-700 bg-gray-100'"
              >{{ publicIpv4Address }}</code>
              <button 
                class="text-gray-500 hover:text-gray-400" 
                :title="t('common.copy')"
                @click="emit('copy', publicIpv4Address, 'nat_public_ip')"
              >
                <svg v-if="copied !== 'nat_public_ip'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <svg v-else class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </dd>
          </div>
          <!-- 公网 IPv6 -->
          <div v-if="['nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(instance.network_mode || '')" class="flex justify-between items-center mt-3">
            <dt class="text-gray-500">{{ t('instance.detail.network.publicIpv6') }}</dt>
            <dd v-if="displayIpv6" class="flex items-center gap-2">
              <!-- 重新获取 IPv6 按钮（仅 nat_ipv6 模式有独立 IPv6 可重新分配） -->
              <button
                v-if="props.isInstanceOwner !== false && instance.network_mode === 'nat_ipv6'"
                class="text-xs px-2 py-0.5 rounded transition-colors flex-shrink-0"
                :class="[
                  canReassignIpv6 
                    ? (themeStore.isDark 
                      ? 'bg-blue-900/30 text-blue-400 hover:bg-blue-900/50' 
                      : 'bg-blue-100 text-blue-600 hover:bg-blue-200')
                    : (themeStore.isDark 
                      ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed')
                ]"
                :disabled="!canReassignIpv6 || props.reassignIpv6Loading"
                :title="ipv6ReassignCooldown.inCooldown 
                  ? t('instance.detail.network.reassignIpv6Cooldown', { hours: ipv6ReassignCooldown.remainingHours })
                  : (instance.status !== 'stopped' 
                    ? t('instance.detail.network.reassignIpv6StopRequired') 
                    : t('instance.detail.network.reassignIpv6'))"
                @click="emit('reassign-ipv6')"
              >
                <span v-if="props.reassignIpv6Loading" class="flex items-center gap-1">
                  <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </span>
                <span v-else-if="ipv6ReassignCooldown.inCooldown">{{ t('instance.detail.network.reassignIpv6CooldownShort', { hours: ipv6ReassignCooldown.remainingHours }) }}</span>
                <span v-else>{{ t('instance.detail.network.reassignIpv6') }}</span>
              </button>
              <code 
                class="font-mono text-xs px-2 py-0.5 rounded truncate max-w-[200px] sm:max-w-[300px]"
                :class="themeStore.isDark ? 'text-gray-400 bg-gray-800/50' : 'text-gray-600 bg-gray-100'"
                :title="displayIpv6 || undefined"
              >{{ displayIpv6 }}</code>
              <button 
                class="text-gray-500 hover:text-gray-400 flex-shrink-0" 
                :title="t('common.copy')"
                @click="emit('copy', displayIpv6 || '', 'ipv6')"
              >
                <svg v-if="copied !== 'ipv6'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <svg v-else class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </dd>
            <dd v-else class="text-gray-500">-</dd>
          </div>
        </template>
        <!-- 非 NAT 模式: 显示公网 IPv4 和公网 IPv6 -->
        <template v-else>
          <div class="flex justify-between items-center">
            <dt class="text-gray-500">{{ t('instance.detail.network.publicIpv4') }}</dt>
            <dd v-if="instance.ipv4" class="flex items-center gap-2">
              <code 
                class="font-mono px-2 py-0.5 rounded"
                :class="themeStore.isDark ? 'text-gray-300 bg-gray-800' : 'text-gray-700 bg-gray-100'"
              >{{ instance.ipv4 }}</code>
              <button 
                class="text-gray-500 hover:text-gray-400" 
                :title="t('common.copy')"
                @click="emit('copy', instance.ipv4, 'ipv4')"
              >
                <svg v-if="copied !== 'ipv4'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <svg v-else class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </dd>
            <dd v-else class="text-gray-500">-</dd>
          </div>
          <div v-if="instance.ipv6" class="flex justify-between items-center mt-3">
            <dt class="text-gray-500">{{ t('instance.detail.network.publicIpv6') }}</dt>
            <dd class="flex items-center gap-2">
              <code 
                class="font-mono text-xs px-2 py-0.5 rounded truncate max-w-[300px]"
                :class="themeStore.isDark ? 'text-gray-400 bg-gray-800/50' : 'text-gray-600 bg-gray-100'"
                :title="instance.ipv6"
              >{{ instance.ipv6 }}</code>
              <button 
                class="text-gray-500 hover:text-gray-400 flex-shrink-0" 
                :title="t('common.copy')"
                @click="emit('copy', instance.ipv6, 'ipv6')"
              >
                <svg v-if="copied !== 'ipv6'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <svg v-else class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </dd>
          </div>
        </template>
      </dl>
    </div>

    <!-- Port Mappings (NAT modes) -->
    <div v-if="['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(instance.network_mode || '')" class="card p-5">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div>
          <div class="flex items-center gap-2">
            <h2 
              class="text-sm font-medium"
              :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
            >
              {{ t('instance.detail.network.portMappings') }}
            </h2>
            <span 
              v-if="!isIpv6OnlyInstance && hasPortQuota && portLimit !== null" 
              class="text-xs px-2 py-0.5 rounded border font-mono font-medium transition-colors"
              :class="isPortQuotaFull 
                ? (themeStore.isDark ? 'bg-red-900/30 text-red-500 border-red-800' : 'bg-red-50 text-red-600 border-red-200')
                : (themeStore.isDark ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-200')"
            >
              {{ portQuotaUsed }} / {{ portLimit }}
            </span>
          </div>
          <p 
            v-if="publicIpv4Address" 
            class="text-xs mt-0.5"
            :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
          >
            {{ t('instance.detail.network.publicIp') }}: {{ publicIpv4Address }}
          </p>
        </div>

        <div v-if="!isIpv6OnlyInstance" class="flex items-center gap-2 sm:gap-3">
          <div
            class="rounded-xl border p-1.5"
            :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/60' : 'border-gray-200 bg-gray-50/90'"
          >
            <div class="grid grid-cols-3 gap-1">
              <button
                v-for="option in (['both', 'tcp', 'udp'] as const)"
                :key="option"
                class="rounded-lg px-3 py-2 text-xs font-medium transition-colors"
                :class="[
                  protocolFilter === option
                    ? (themeStore.isDark ? 'bg-gray-700 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm border border-gray-200')
                    : (themeStore.isDark ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200' : 'text-gray-600 hover:bg-white hover:text-gray-900')
                ]"
                @click="protocolFilter = option"
              >
                {{ option === 'both' ? t('instance.detail.network.filterBoth') : option.toUpperCase() }}
              </button>
            </div>
          </div>

          <button
            v-if="canAddPorts && hasPortQuota && !isPortQuotaFull"
            class="hidden shrink-0 rounded-xl border p-1.5 transition-colors sm:block"
            :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/60 hover:border-gray-700' : 'border-gray-200 bg-gray-50/90 hover:border-gray-300'"
            @click="emit('add-port')"
          >
            <div
              class="flex h-[34px] items-center justify-center rounded-lg px-4"
              :class="themeStore.isDark ? 'bg-gray-700 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm border border-gray-200'"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              <span class="ml-2 text-xs font-medium">{{ t('instance.detail.network.add') }}</span>
            </div>
          </button>
        </div>
      </div>

      <!-- 批量操作栏 -->
      <div 
        v-if="hasSelection && props.canManagePorts !== false" 
        class="mb-3 flex flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-center sm:justify-between"
        :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
      >
        <span class="text-sm" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
          {{ t('instance.detail.network.selectedCount', { count: selectedPorts.size }) }}
        </span>
        <button 
          class="btn-sm flex items-center gap-1 text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          :disabled="props.deletePortsLoading"
          @click="handleBatchDelete"
        >
          <svg v-if="props.deletePortsLoading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>{{ t('instance.detail.network.batchDelete') }}</span>
        </button>
      </div>

      <div
        v-if="isIpv6OnlyInstance"
        class="rounded-2xl border border-dashed p-6 text-center"
        :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/30 text-gray-500' : 'border-gray-300 bg-gray-50 text-gray-500'"
      >
        <div
          class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
          :class="themeStore.isDark ? 'bg-gray-800/80 text-gray-500' : 'bg-white text-gray-400 shadow-sm'"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <p class="mx-auto max-w-md text-sm leading-6">
          {{ t('instance.detail.network.ipv6OnlyPortMappingHint') }}
        </p>
      </div>
      <div v-else-if="filteredPortMappings.length" class="space-y-2">
        <!-- 全选行 -->
        <div 
          v-if="props.canManagePorts !== false && paginatedPorts.length > 0"
          class="flex items-center justify-between gap-3 pb-2 border-b"
          :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
        >
          <div class="flex items-center gap-2">
            <button
              class="w-5 h-5 rounded border flex items-center justify-center transition-colors"
              :class="[
                isSelectAll || isPartialSelect
                  ? (themeStore.isDark ? 'bg-blue-600 border-blue-600' : 'bg-blue-500 border-blue-500')
                  : (themeStore.isDark ? 'border-gray-600 hover:border-gray-500' : 'border-gray-300 hover:border-gray-400')
              ]"
              @click="toggleSelectAll"
            >
              <svg v-if="isSelectAll" class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
              </svg>
              <svg v-else-if="isPartialSelect" class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 12h14" />
              </svg>
            </button>
            <span class="text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
              {{ t('instance.detail.network.selectAll') }}
            </span>
          </div>

          <button
            v-if="canAddPorts && hasPortQuota && !isPortQuotaFull"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors shadow-sm sm:hidden"
            :class="themeStore.isDark ? 'border-gray-700 bg-gray-900/70 text-gray-100 hover:border-gray-600' : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300'"
            :title="t('instance.detail.network.add')"
            @click="emit('add-port')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        <div 
          v-for="m in paginatedPorts" 
          :key="m.id" 
          class="group flex items-center justify-between text-sm p-3 border rounded-lg transition-colors"
          :class="[
            themeStore.isDark 
              ? 'bg-gray-900/50 border-gray-800 hover:border-gray-700' 
              : 'bg-gray-50 border-gray-200 hover:border-gray-300',
            selectedPorts.has(m.id) && (themeStore.isDark ? 'border-blue-800 bg-blue-900/20' : 'border-blue-300 bg-blue-50')
          ]"
        >
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <!-- 多选框 -->
            <button
              v-if="props.canManagePorts !== false"
              class="w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0"
              :class="[
                selectedPorts.has(m.id)
                  ? (themeStore.isDark ? 'bg-blue-600 border-blue-600' : 'bg-blue-500 border-blue-500')
                  : (themeStore.isDark ? 'border-gray-600 hover:border-gray-500' : 'border-gray-300 hover:border-gray-400')
              ]"
              @click="toggleSelect(m.id)"
            >
              <svg v-if="selectedPorts.has(m.id)" class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <span 
              class="text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0"
              :class="themeStore.isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-200 text-gray-600'"
            >{{ m.protocol.toUpperCase() }}</span>
            <div class="flex items-center gap-2 min-w-0">
              <code 
                class="font-mono text-xs"
                :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
              >{{ getPublicPort(m) }}</code>
              <button 
                class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                :class="themeStore.isDark ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-600'"
                :title="t('common.copy')"
                @click="emit('copy', String(getPublicPort(m)), 'port-' + m.id)"
              >
                <svg v-if="copied !== 'port-' + m.id" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <svg v-else class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <span class="text-gray-500 flex-shrink-0">→</span>
              <span class="font-mono text-xs text-gray-500">{{ getPrivatePort(m) }}</span>
              <span 
                v-if="m.remark" 
                class="text-xs px-1.5 py-0.5 rounded truncate max-w-[120px]"
                :class="themeStore.isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600'"
                :title="m.remark"
              >{{ m.remark }}</span>
            </div>
          </div>
          <button 
            v-if="props.canManagePorts !== false"
            class="text-xs text-gray-500 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0" 
            @click="emit('delete-port', m.id)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        <!-- Pagination -->
        <div class="flex flex-col gap-3 pt-3 border-t sm:flex-row sm:items-center sm:justify-between" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <div class="flex items-center gap-2">
            <span class="text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">{{ t('instance.detail.network.perPage') }}</span>
            <select 
              v-model.number="portPageSize"
              class="text-xs px-2 py-1 rounded border"
              :class="themeStore.isDark ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-white border-gray-200 text-gray-700'"
            >
              <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
            </select>
          </div>
          <div class="flex items-center justify-between gap-2 sm:justify-start">
            <button 
              :disabled="portPage === 1"
              class="btn-ghost btn-sm"
              @click="portPage = Math.max(1, portPage - 1)"
            >
              {{ t('instance.detail.network.prevPage') }}
            </button>
            <span class="text-sm text-gray-500">{{ portPage }} / {{ portTotalPages }}</span>
            <button 
              :disabled="portPage === portTotalPages"
              class="btn-ghost btn-sm"
              @click="portPage = Math.min(portTotalPages, portPage + 1)"
            >
              {{ t('instance.detail.network.nextPage') }}
            </button>
          </div>
        </div>
      </div>
      <div
        v-else
        class="rounded-2xl border border-dashed p-6 text-center"
        :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/30 text-gray-500' : 'border-gray-300 bg-gray-50 text-gray-500'"
      >
        <div
          class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
          :class="themeStore.isDark ? 'bg-gray-800/80 text-gray-500' : 'bg-white text-gray-400 shadow-sm'"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>

        <template v-if="!hasPortQuota">
          <p class="mb-1 text-sm font-medium text-yellow-500">{{ t('instance.detail.network.noPortQuota') }}</p>
          <p class="text-xs leading-6">{{ t('instance.detail.network.allocateQuotaHint') }}</p>
        </template>
        <template v-else-if="portMappings.length > 0 && filteredPortMappings.length === 0">
          <p class="text-sm font-medium">{{ t('instance.detail.network.noFilterResults') }}</p>
        </template>
        <template v-else>
          <p class="text-sm font-medium">{{ t('instance.detail.network.noPortMappings') }}</p>
          <p class="mt-1 text-xs leading-6">{{ t('instance.detail.network.addPortMapping') }}</p>
          <button
            v-if="canAddPorts && hasPortQuota && !isPortQuotaFull"
            class="btn btn-secondary btn-sm mt-4"
            @click="emit('add-port')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            {{ t('instance.detail.network.add') }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

