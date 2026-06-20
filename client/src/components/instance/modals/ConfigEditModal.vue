<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import type { Instance, Package, UserQuota } from '@/types/api'

const { t } = useI18n()
const themeStore = useThemeStore()

interface ResourceStats {
  memory: { usage: number; limit: number; usagePercent: number }
  disk: { usage: number; limit: number; usagePercent: number }
}

interface Props {
  show: boolean
  instance: Instance | null
  pkg: Package | null
  userQuota: UserQuota | null
  stats?: ResourceStats
  loading?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:show': [value: boolean]
  'confirm': [data: { cpu?: number; memory?: number; disk?: number; monthlyTrafficLimit?: string | null }]
}>()

// 表单数据
const formCpu = ref<string>('100')
const formMemory = ref<string>('1024')
const formDisk = ref<string>('10.0')
const formTraffic = ref<string>('')

// 初始化表单数据
watch(() => props.show, (newVal) => {
  if (newVal && props.instance) {
    formCpu.value = props.instance.cpu.toString()
    formMemory.value = props.instance.memory.toString()
    // 硬盘：从MB转换为GB显示（1024进制）
    const diskGB = props.instance.disk / 1024
    formDisk.value = diskGB.toFixed(1)
    // 流量：从 monthlyTrafficLimit 转换（Bytes -> GB）
    const instanceWithDetails = props.instance as any
    if (instanceWithDetails.monthlyTrafficLimit) {
      const bytes = BigInt(instanceWithDetails.monthlyTrafficLimit)
      const gb = Number(bytes) / (1024 * 1024 * 1024)
      formTraffic.value = Math.round(gb).toString()
    } else {
      formTraffic.value = ''
    }
  }
})

// 格式化内存
function formatMemory(mb: number | null | undefined): string {
  if (!mb) return '0 MB'
  if (mb >= 1024) return (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB'
  return mb + ' MB'
}

// 格式化磁盘（1024进制）
function formatDisk(mb: number | null | undefined): string {
  if (!mb) return '0 MB'
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb.toFixed(1) + ' GB'
  }
  return mb + ' MB'
}

// 格式化流量（GB）
function formatTraffic(gb: number | string | null | undefined): string {
  if (!gb || gb === '') return '0 GB'
  const num = typeof gb === 'string' ? parseFloat(gb) : gb
  if (isNaN(num)) return '0 GB'
  return Math.round(num) + ' GB'
}

// 获取当前流量（GB）
const currentTrafficGB = computed(() => {
  const instanceWithDetails = props.instance as any
  if (instanceWithDetails?.monthlyTrafficLimit) {
    const bytes = BigInt(instanceWithDetails.monthlyTrafficLimit)
    return Number(bytes) / (1024 * 1024 * 1024)
  }
  return 0
})

// 计算资源变化量
const cpuDelta = computed(() => {
  if (!props.instance) return 0
  const cpu = parseFloat(formCpu.value)
  if (isNaN(cpu)) return 0
  return cpu - props.instance.cpu
})
const memoryDelta = computed(() => {
  if (!props.instance) return 0
  const memory = parseFloat(formMemory.value)
  if (isNaN(memory)) return 0
  return memory - props.instance.memory
})
const diskDelta = computed(() => {
  if (!props.instance) return 0
  const diskGB = parseFloat(formDisk.value)
  if (isNaN(diskGB)) return 0
  const diskMB = diskGB * 1024  // 1024进制
  return diskMB - props.instance.disk
})
const trafficDelta = computed(() => {
  if (!formTraffic.value) return 0
  const newGB = parseFloat(formTraffic.value)
  if (isNaN(newGB)) return 0
  return newGB - currentTrafficGB.value
})

// 计算是否有变化
const hasChanges = computed(() => {
  const trafficChanged = formTraffic.value === '' 
    ? currentTrafficGB.value > 0  // 清空流量限制
    : trafficDelta.value !== 0    // 修改流量限制
  return cpuDelta.value !== 0 || 
         memoryDelta.value !== 0 || 
         diskDelta.value !== 0 || 
         trafficChanged
})

function handleCpuInput(value: string) {
  // 允许自由输入，不做实时规范化
  formCpu.value = value
}

function handleCpuBlur() {
  // 失去焦点时格式化为整数
  const num = parseFloat(formCpu.value)
  if (isNaN(num) || num <= 0) {
    formCpu.value = '1'
    return
  }
  // 四舍五入为整数
  formCpu.value = Math.round(num).toString()
}

function handleMemoryInput(value: string) {
  // 允许自由输入，不做实时规范化
  formMemory.value = value
}

function handleMemoryBlur() {
  // 失去焦点时格式化为整数
  const num = parseFloat(formMemory.value)
  if (isNaN(num) || num <= 0) {
    formMemory.value = '1'
    return
  }
  // 四舍五入为整数
  formMemory.value = Math.round(num).toString()
}

function handleDiskInput(value: string) {
  // 允许自由输入
  formDisk.value = value
}

function handleDiskBlur() {
  // 失去焦点时格式化为一位小数
  const num = parseFloat(formDisk.value)
  if (isNaN(num) || num <= 0) {
    formDisk.value = '1'
    return
  }
  // 保留一位小数
  formDisk.value = num.toFixed(1)
}

function handleTrafficInput(value: string) {
  // 允许自由输入
  formTraffic.value = value
}

function handleTrafficBlur() {
  // 失去焦点时格式化为整数
  if (formTraffic.value === '') {
    return
  }
  const num = parseFloat(formTraffic.value)
  if (isNaN(num) || num < 0) {
    formTraffic.value = ''
    return
  }
  // 四舍五入为整数
  formTraffic.value = Math.round(num).toString()
}

function handleConfirm() {
  if (!hasChanges.value) return
  
  const data: { cpu?: number; memory?: number; disk?: number; monthlyTrafficLimit?: string | null } = {}
  if (cpuDelta.value !== 0) {
    const cpu = parseFloat(formCpu.value)
    if (!isNaN(cpu)) data.cpu = cpu
  }
  if (memoryDelta.value !== 0) {
    const memory = parseFloat(formMemory.value)
    if (!isNaN(memory)) data.memory = memory
  }
  if (diskDelta.value !== 0) {
    const diskGB = parseFloat(formDisk.value)
    if (!isNaN(diskGB)) {
      data.disk = diskGB * 1024 // 转换为MB（1024进制）
    }
  }
  // 处理流量限制
  if (formTraffic.value === '') {
    // 清空流量限制（如果原来有限制）
    if (currentTrafficGB.value > 0) {
      data.monthlyTrafficLimit = null
    }
  } else {
    // 设置流量限制
    const gb = parseFloat(formTraffic.value)
    if (!isNaN(gb) && gb >= 0) {
      const bytes = BigInt(Math.floor(gb * 1024 * 1024 * 1024))
      data.monthlyTrafficLimit = bytes.toString()
    }
  }
  
  emit('confirm', data)
}

function handleClose() {
  emit('update:show', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div 
        v-if="show" 
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @click.self="handleClose"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50"></div>
        
        <!-- Modal -->
        <div 
          class="modal-content relative w-full max-w-3xl rounded-xl shadow-xl"
          :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
        >
          <!-- Header -->
          <div 
            class="flex items-center justify-between px-6 py-4 border-b"
            :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
          >
            <h3 
              class="text-lg font-medium"
              :class="themeStore.isDark ? 'text-white' : 'text-gray-900'"
            >
              {{ t('instance.configEdit.title') }}
            </h3>
            <button 
              class="p-1 rounded-lg transition-colors"
              :class="themeStore.isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
              @click="handleClose"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        
          <!-- Body -->
          <div class="px-6 py-6">
            <div class="overflow-x-auto">
              <table class="w-full">
                <thead>
                  <tr class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
                    <th class="text-left py-3 pr-4 text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                      {{ t('instance.configEdit.resourceType') }}
                    </th>
                    <th class="text-left py-3 px-4 text-sm font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                      {{ t('instance.configEdit.current') }}
                    </th>
                    <th class="text-left py-3 px-4 text-sm font-medium" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                      {{ t('instance.configEdit.modifyTo') }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <!-- CPU -->
                  <tr class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'">
                    <td class="py-4 pr-4 text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                      {{ t('instance.configEdit.cpu') }}
                    </td>
                    <td class="py-4 px-4 text-sm" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                      {{ instance?.cpu || 0 }}%
                    </td>
                    <td class="py-4 px-4">
                      <div class="flex items-center gap-2">
                        <input
                          v-model="formCpu"
                          type="number"
                          step="1"
                          placeholder=""
                          class="w-32 px-3 py-2 text-sm rounded border"
                          :class="themeStore.isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300 text-gray-900'"
                          @input="handleCpuInput(($event.target as HTMLInputElement).value)"
                          @blur="handleCpuBlur"
                        />
                        <span class="text-sm text-gray-500">%</span>
                      </div>
                    </td>
                  </tr>

                  <!-- Memory -->
                  <tr class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'">
                    <td class="py-4 pr-4 text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                      {{ t('instance.configEdit.memory') }}
                    </td>
                    <td class="py-4 px-4 text-sm" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                      {{ formatMemory(instance?.memory) }}
                    </td>
                    <td class="py-4 px-4">
                      <div class="flex items-center gap-2">
                        <input
                          v-model="formMemory"
                          type="number"
                          step="1"
                          placeholder=""
                          class="w-32 px-3 py-2 text-sm rounded border"
                          :class="themeStore.isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300 text-gray-900'"
                          @input="handleMemoryInput(($event.target as HTMLInputElement).value)"
                          @blur="handleMemoryBlur"
                        />
                        <span class="text-sm text-gray-500">MB</span>
                      </div>
                    </td>
                  </tr>

                  <!-- Disk -->
                  <tr class="border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'">
                    <td class="py-4 pr-4 text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                      {{ t('instance.configEdit.disk') }}
                    </td>
                    <td class="py-4 px-4 text-sm" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                      {{ formatDisk(instance?.disk) }}
                    </td>
                    <td class="py-4 px-4">
                      <div class="flex items-center gap-2">
                        <input
                          v-model="formDisk"
                          type="number"
                          step="0.1"
                          placeholder=""
                          class="w-32 px-3 py-2 text-sm rounded border"
                          :class="themeStore.isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300 text-gray-900'"
                          @input="handleDiskInput(($event.target as HTMLInputElement).value)"
                          @blur="handleDiskBlur"
                        />
                        <span class="text-sm text-gray-500">GB</span>
                      </div>
                    </td>
                  </tr>

                  <!-- Traffic -->
                  <tr>
                    <td class="py-4 pr-4 text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                      {{ t('instance.configEdit.traffic') }}
                    </td>
                    <td class="py-4 px-4 text-sm" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                      {{ formatTraffic(currentTrafficGB) }}
                    </td>
                    <td class="py-4 px-4">
                      <div class="flex items-center gap-2">
                        <input
                          v-model="formTraffic"
                          type="number"
                          step="1"
                          :placeholder="t('instance.configEdit.trafficHint')"
                          class="w-32 px-3 py-2 text-sm rounded border"
                          :class="themeStore.isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300 text-gray-900'"
                          @input="handleTrafficInput(($event.target as HTMLInputElement).value)"
                          @blur="handleTrafficBlur"
                        />
                        <span class="text-sm text-gray-500">GB</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        
          <!-- Footer -->
          <div 
            class="flex justify-end gap-3 px-6 py-4 border-t"
            :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
          >
            <button 
              class="btn-ghost"
              :disabled="loading"
              @click="handleClose"
            >
              {{ t('common.cancel') }}
            </button>
            <button 
              class="btn-primary"
              :disabled="!hasChanges || loading"
              @click="handleConfirm"
            >
              <svg v-if="loading" class="w-4 h-4 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              {{ loading ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
