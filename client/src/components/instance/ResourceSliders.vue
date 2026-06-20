<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import ResourceSlider from './ResourceSlider.vue'
import type { Package, UserQuota } from '@/types/api'

const { t } = useI18n()

interface Props {
  selectedPackage: Package | null
  userQuota: UserQuota | null
  cpu: number
  memory: number
  disk: number
  stepNumber?: number  // 步骤编号，默认 2
}

const props = withDefaults(defineProps<Props>(), {
  stepNumber: 2
})
const emit = defineEmits<{
  'update:cpu': [value: number]
  'update:memory': [value: number]
  'update:disk': [value: number]
}>()

const themeStore = useThemeStore()

// CPU 配置
const cpuMin = 15
const cpuStep = 5
const cpuMax = computed(() => Math.max(15, props.selectedPackage?.cpu_max || 15))

// 内存配置
const memoryMin = 128
const memoryStep = 64
const memoryMax = computed(() => Math.max(128, props.selectedPackage?.memory_max || 128))

// 硬盘配置
const diskMin = 512
const diskStep = 102  // 约 0.1GB
const diskMax = computed(() => Math.max(512, props.selectedPackage?.disk_max || 512))

// CPU 额配转换为核心数
function allowanceToCores(allowance: number): number {
  if (allowance <= 0) return 1
  return Math.ceil(allowance / 100)
}

// 格式化 CPU 显示
function formatCpu(value: number): string {
  return `${value}%`
}

// 格式化内存显示
function formatMemory(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`
  }
  return `${mb} MB`
}

// 格式化硬盘显示（1024进制）
function formatDisk(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb % 1 === 0 ? `${gb} GB` : `${gb.toFixed(1)} GB`
  }
  return `${mb} MB`
}

// CPU 图标
const cpuIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>`

// 内存图标
const memoryIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.8V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.8Z"/></svg>`

// 硬盘图标
const diskIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`
</script>

<template>
  <div v-if="selectedPackage" class="card p-5">
    <div class="flex items-center gap-2 mb-5">
      <span 
        class="w-6 h-6 rounded-full text-sm font-bold flex items-center justify-center"
        :class="themeStore.isDark ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'"
      >{{ props.stepNumber }}</span>
      <h2 
        class="text-sm font-medium"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ t('instance.selector.configureResources') }}
      </h2>
      <span 
        class="text-xs ml-auto"
        :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
      >{{ t('instance.selector.adjustBasedOnPackage') }}</span>
    </div>
    
    <!-- 剩余配额信息 -->
    <div 
      v-if="selectedPackage?.quotaInfo"
      class="mb-5 p-3 rounded-lg"
      :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-50'"
    >
      <div class="text-xs text-gray-500 mb-2">{{ t('instance.createPage.quotaInfo.remaining') }}</div>
      <div 
        class="text-sm font-mono flex items-center flex-wrap gap-x-4 gap-y-1"
      >
        <span class="flex items-center gap-1.5">
          <span class="text-gray-500">{{ t('instance.createPage.quotaInfo.count') }}</span>
          <span 
            class="font-medium"
            :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'"
          >
            {{ selectedPackage.quotaInfo.remainingInstances === null ? '∞' : selectedPackage.quotaInfo.remainingInstances }}
          </span>
        </span>
        <span v-if="selectedPackage.quotaInfo.remainingCpu !== null" class="text-gray-400">|</span>
        <span v-if="selectedPackage.quotaInfo.remainingCpu !== null" class="flex items-center gap-1.5">
          <span class="text-gray-500">CPU</span>
          <span 
            class="font-medium"
            :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'"
          >
            {{ `${selectedPackage.quotaInfo.remainingCpu}%` }}
          </span>
        </span>
        <span v-if="selectedPackage.quotaInfo.remainingMemory !== null" class="text-gray-400">|</span>
        <span v-if="selectedPackage.quotaInfo.remainingMemory !== null" class="flex items-center gap-1.5">
          <span class="text-gray-500">{{ t('instance.createPage.quotaInfo.memory') }}</span>
          <span 
            class="font-medium"
            :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'"
          >
            {{ formatMemory(selectedPackage.quotaInfo.remainingMemory) }}
          </span>
        </span>
      </div>
    </div>
    
    <!-- 资源配置滑块 -->
    <div class="space-y-6">
      <!-- CPU -->
      <ResourceSlider
        :model-value="cpu"
        :min="cpuMin"
        :max="cpuMax"
        :step="cpuStep"
        :label="t('instance.selector.cpu')"
        :subtitle="`~${allowanceToCores(cpu)} ${t('instance.selector.cores')}`"
        :format-value="formatCpu"
        :icon="cpuIcon"
        @update:model-value="emit('update:cpu', $event)"
      />
      
      <!-- 内存 -->
      <ResourceSlider
        :model-value="memory"
        :min="memoryMin"
        :max="memoryMax"
        :step="memoryStep"
        :label="t('instance.selector.memory')"
        :format-value="formatMemory"
        :icon="memoryIcon"
        @update:model-value="emit('update:memory', $event)"
      />
      
      <!-- 硬盘 -->
      <ResourceSlider
        :model-value="disk"
        :min="diskMin"
        :max="diskMax"
        :step="diskStep"
        :label="t('instance.selector.disk')"
        :format-value="formatDisk"
        :icon="diskIcon"
        @update:model-value="emit('update:disk', $event)"
      />
    </div>
  </div>
</template>
