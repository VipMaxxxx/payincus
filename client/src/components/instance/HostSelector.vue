<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import type { AvailableHost, Package } from '@/types/api'
import FlagIcon from '@/components/FlagIcon.vue'

const { t } = useI18n()

interface Props {
  availableHosts: AvailableHost[]
  selectedHostId: number | null
  hostsLoading: boolean
  hostsInsufficient: boolean
  cpu: number
  memory: number
  selectedPackage: Package | null
  showDeduction?: boolean  // 是否显示资源扣减部分，默认 true
  title?: string
  autoSelectedLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  showDeduction: true,
  title: undefined,
  autoSelectedLabel: undefined
})
const emit = defineEmits<{
  'update:selectedHostId': [value: number | null]
}>()

const themeStore = useThemeStore()

// 格式化资源显示（可选显示扣减部分）
function formatResourceDisplay(available: number, selected: number, unit: string): string {
  if (props.showDeduction) {
    return `${available}${unit}（-${selected}${unit}）`
  }
  return `${available}${unit}`
}

function formatMemoryDisplay(availableMB: number, selectedMB: number): string {
  const formatMB = (mb: number) => {
    if (mb >= 1024) return (mb / 1024).toFixed(1) + 'GB'
    return mb + 'MB'
  }
  
  if (props.showDeduction) {
    return `${formatMB(availableMB)}（-${formatMB(selectedMB)}）`
  }
  return formatMB(availableMB)
}

function formatTraffic(bytes: string | null | undefined): string {
  if (!bytes) return t('common.unlimited')
  const b = BigInt(bytes || '0')
  if (b === BigInt(0)) return t('common.unlimited')
  if (b >= BigInt(1024 * 1024 * 1024 * 1024)) {
    return (Number(b) / (1024 * 1024 * 1024 * 1024)).toFixed(1) + ' TB'
  }
  if (b >= BigInt(1024 * 1024 * 1024)) {
    return (Number(b) / (1024 * 1024 * 1024)).toFixed(0) + ' GB'
  }
  return (Number(b) / (1024 * 1024)).toFixed(0) + ' MB'
}
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center gap-2 mb-4">
      <span 
        class="w-6 h-6 rounded-full text-sm font-bold flex items-center justify-center"
        :class="themeStore.isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-200 text-gray-600'"
      >*</span>
      <h2 
        class="text-sm font-medium"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ props.title || t('instance.selector.selectHost') }}
      </h2>
      <span 
        class="text-xs ml-auto"
        :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
      >{{ props.autoSelectedLabel || t('instance.selector.hostAutoSelected') }}</span>
    </div>
    
    <div v-if="hostsLoading" class="flex items-center justify-center py-4">
      <svg class="w-5 h-5 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
    </div>
    
    <!-- 资源不足提示 -->
    <div v-else-if="hostsInsufficient" class="p-4 rounded-lg border border-yellow-400/50 bg-yellow-50 dark:bg-yellow-900/20">
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <p class="text-sm font-medium text-yellow-800 dark:text-yellow-300">{{ t('instance.selector.hostInsufficient') }}</p>
          <p v-if="selectedPackage" class="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
            {{ t('instance.selector.hostInsufficientDesc', { cpu: props.cpu, memory: (props.memory / 1024).toFixed(1) }) }}
          </p>
          <p class="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
            {{ t('instance.selector.hostInsufficientSuggest') }}
          </p>
        </div>
      </div>
    </div>
    
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div
        v-for="host in availableHosts"
        :key="host.id"
        :class="[
          'p-3 rounded-lg border cursor-pointer transition-all',
          selectedHostId === host.id 
            ? (themeStore.isDark ? 'border-white bg-gray-900' : 'border-gray-900 bg-gray-50')
            : (themeStore.isDark ? 'border-gray-800 hover:border-gray-700' : 'border-gray-200 hover:border-gray-300')
        ]"
        @click="emit('update:selectedHostId', host.id)"
      >
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <FlagIcon :code="host.countryCode || 'us'" size="sm" />
            <span 
              class="text-sm"
              :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
            >{{ host.name?.toUpperCase() || host.name }}</span>
            <span
              v-if="host.architecture"
              class="px-1.5 py-0.5 rounded text-2xs font-medium"
              :class="themeStore.isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600'"
            >
              {{ host.architecture }}
            </span>
          </div>
          <div 
            v-if="selectedHostId === host.id" 
            class="w-4 h-4 rounded-full flex items-center justify-center"
            :class="themeStore.isDark ? 'bg-white' : 'bg-gray-900'"
          >
            <svg 
              class="w-2.5 h-2.5" 
              :class="themeStore.isDark ? 'text-gray-900' : 'text-white'"
              fill="currentColor" viewBox="0 0 20 20"
            >
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          </div>
        </div>
        <p v-if="host.effectiveTrafficLimit !== undefined" class="truncate text-2xs text-themed-muted">
          {{ t('instance.selector.hostTraffic') }} {{ formatTraffic(host.effectiveTrafficLimit) }}
          <span v-if="host.effectiveTrafficLimit && host.trafficMultiplier && host.trafficMultiplier !== 1" class="opacity-70">({{ host.trafficMultiplier }}x)</span>
        </p>
        <p v-else class="truncate text-2xs text-themed-muted">{{ host.location }}</p>
        <div class="mt-2 flex items-center justify-between">
          <span
            class="text-2xs"
            :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
          >
            {{ t('instance.selector.available') }}: {{ formatResourceDisplay(host.resources?.cpuAvailable, props.cpu, '%') }} / {{ formatMemoryDisplay(host.resources?.memoryAvailable, props.memory) }}
          </span>
          <!-- 探针图标 -->
          <a
            v-if="host.probeUrl"
            :href="host.probeUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="flex-shrink-0 ml-2 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            :title="t('instance.selector.viewProbe')"
            @click.stop
          >
            <svg class="w-4 h-4" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-500'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  </div>
</template>
