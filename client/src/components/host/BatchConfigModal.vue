<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import api from '@/api'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

interface Props {
  visible: boolean
  hostId: number
  selectedIds: number[]
  totalInstanceCount: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'success'): void
}>()

// 表单数据
const form = ref({
  // 资源配置
  cpu: '',
  memory: '',
  disk: '',
  monthlyTrafficLimit: '',
  swapEnabled: null as boolean | null,
  swapSize: '',
  // 配额限制
  portLimit: '',
  snapshotLimit: '',
  siteLimit: '',
  // 容器权限
  nested: null as boolean | null,
  privileged: null as boolean | null,
  // 高级配置 - 存储IO
  limitsRead: '',
  limitsWrite: '',
  // 高级配置 - 网络限制
  limitsIngress: null as number | null,
  limitsEgress: null as number | null,
  // 高级配置 - 进程与调度
  limitsProcesses: '',
  limitsCpuPriority: '',
  // 高级配置 - 启动设置
  bootAutostart: null as boolean | null,
  bootAutostartPriority: '',
  bootAutostartDelay: '',
  bootHostShutdownTimeout: ''
})

// 控制哪些配置项启用修改
const enabledFields = ref({
  cpu: false,
  memory: false,
  disk: false,
  monthlyTrafficLimit: false,
  swapEnabled: false,
  swapSize: false,
  portLimit: false,
  snapshotLimit: false,
  siteLimit: false,
  nested: false,
  privileged: false,
  limitsRead: false,
  limitsWrite: false,
  limitsIngress: false,
  limitsEgress: false,
  limitsProcesses: false,
  limitsCpuPriority: false,
  bootAutostart: false,
  bootAutostartPriority: false,
  bootAutostartDelay: false,
  bootHostShutdownTimeout: false
})

// 当前展开的配置分类
const expandedSections = ref({
  resources: true,
  quota: false,
  permissions: false,
  io: false,
  network: false,
  process: false,
  boot: false
})

// 提交状态
const isSubmitting = ref(false)
const progress = ref({ current: 0, total: 0 })

// 结果状态
const showResult = ref(false)
const result = ref<{
  success: boolean
  totalCount: number
  successCount: number
  failedCount: number
  failedItems: Array<{
    instanceId: number
    incusId: string
    name: string
    error?: string
  }>
  retryPayload?: {
    instanceIds: number[]
    config: Record<string, unknown>
  }
} | null>(null)

// 计算目标实例数量
const targetCount = computed(() => {
  return props.selectedIds.length > 0 ? props.selectedIds.length : props.totalInstanceCount
})

// 计算是否有任何启用的字段
const hasEnabledFields = computed(() => {
  return Object.values(enabledFields.value).some(v => v)
})

// 切换分类展开状态
function toggleSection(section: keyof typeof expandedSections.value) {
  expandedSections.value[section] = !expandedSections.value[section]
}

// 构建配置对象
function buildConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {}

  if (enabledFields.value.cpu && form.value.cpu) {
    config.cpu = parseInt(form.value.cpu, 10)
  }
  if (enabledFields.value.memory && form.value.memory) {
    config.memory = parseInt(form.value.memory, 10)
  }
  if (enabledFields.value.disk && form.value.disk) {
    // disk 以 GB 为单位输入，转换为 MB（1024进制）
    config.disk = parseFloat(form.value.disk) * 1024
  }
  if (enabledFields.value.monthlyTrafficLimit) {
    if (form.value.monthlyTrafficLimit === '' || form.value.monthlyTrafficLimit === '0') {
      config.monthlyTrafficLimit = null
    } else {
      // 以 GB 为单位输入，转换为字节
      const gb = parseFloat(form.value.monthlyTrafficLimit)
      config.monthlyTrafficLimit = String(Math.round(gb * 1024 * 1024 * 1024))
    }
  }
  if (enabledFields.value.swapEnabled && form.value.swapEnabled !== null) {
    config.swapEnabled = form.value.swapEnabled
  }
  if (enabledFields.value.swapSize && form.value.swapSize !== '') {
    config.swapSize = Math.max(0, parseInt(form.value.swapSize, 10))
  }
  if (enabledFields.value.portLimit) {
    config.portLimit = form.value.portLimit ? parseInt(form.value.portLimit, 10) : null
  }
  if (enabledFields.value.snapshotLimit) {
    config.snapshotLimit = form.value.snapshotLimit ? parseInt(form.value.snapshotLimit, 10) : null
  }
  if (enabledFields.value.siteLimit) {
    config.siteLimit = form.value.siteLimit ? parseInt(form.value.siteLimit, 10) : null
  }
  if (enabledFields.value.nested) {
    config.nested = form.value.nested
  }
  if (enabledFields.value.privileged) {
    config.privileged = form.value.privileged
  }
  if (enabledFields.value.limitsRead) {
    config.limitsRead = normalizeStorageLimit(form.value.limitsRead)
  }
  if (enabledFields.value.limitsWrite) {
    config.limitsWrite = normalizeStorageLimit(form.value.limitsWrite)
  }
  if (enabledFields.value.limitsIngress) {
    config.limitsIngress = form.value.limitsIngress ? `${form.value.limitsIngress}Mbit` : null
  }
  if (enabledFields.value.limitsEgress) {
    config.limitsEgress = form.value.limitsEgress ? `${form.value.limitsEgress}Mbit` : null
  }
  if (enabledFields.value.limitsProcesses) {
    config.limitsProcesses = form.value.limitsProcesses ? parseInt(form.value.limitsProcesses, 10) : null
  }
  if (enabledFields.value.limitsCpuPriority) {
    config.limitsCpuPriority = form.value.limitsCpuPriority ? parseInt(form.value.limitsCpuPriority, 10) : null
  }
  if (enabledFields.value.bootAutostart) {
    config.bootAutostart = form.value.bootAutostart
  }
  if (enabledFields.value.bootAutostartPriority) {
    config.bootAutostartPriority = form.value.bootAutostartPriority ? parseInt(form.value.bootAutostartPriority, 10) : null
  }
  if (enabledFields.value.bootAutostartDelay) {
    config.bootAutostartDelay = form.value.bootAutostartDelay ? parseInt(form.value.bootAutostartDelay, 10) : null
  }
  if (enabledFields.value.bootHostShutdownTimeout) {
    config.bootHostShutdownTimeout = form.value.bootHostShutdownTimeout ? parseInt(form.value.bootHostShutdownTimeout, 10) : null
  }

  return config
}

// 提交批量修改
async function handleSubmit() {
  if (!hasEnabledFields.value) {
    toast.error(t('host.batchConfig.noFieldsEnabled'))
    return
  }

  const config = buildConfig()
  if (Object.keys(config).length === 0) {
    toast.error(t('host.batchConfig.noChanges'))
    return
  }

  isSubmitting.value = true
  progress.value = { current: 0, total: targetCount.value }

  try {
    // 确定目标实例 ID
    let instanceIds: number[]
    if (props.selectedIds.length > 0) {
      instanceIds = props.selectedIds
    } else {
      // 获取宿主机下所有实例 ID
      const res = await api.instances.list({
        hostId: props.hostId,
        pageSize: 1000 // 获取足够多
      }) as unknown as { instances: Array<{ id: number }> }
      instanceIds = res.instances.map((i: { id: number }) => i.id)
    }

    progress.value.total = instanceIds.length

    const res = await api.hosts.batchUpdateConfig(props.hostId, {
      instanceIds,
      config
    })

    result.value = res
    showResult.value = true

    if (res.failedCount === 0) {
      toast.success(t('host.batchConfig.successAll', { count: res.successCount }))
    } else if (res.successCount > 0) {
      toast.warning(t('host.batchConfig.partial', { success: res.successCount, failed: res.failedCount }))
    } else {
      toast.error(t('host.batchConfig.allFailed'))
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    toast.error(t('host.batchConfig.submitFailed') + ': ' + (error?.message || String(err)))
  } finally {
    isSubmitting.value = false
  }
}

// 重试失败项
async function handleRetry() {
  if (!result.value?.retryPayload) return

  isSubmitting.value = true
  try {
    const res = await api.hosts.batchUpdateConfig(props.hostId, {
      instanceIds: result.value.retryPayload.instanceIds,
      config: result.value.retryPayload.config
    })

    result.value = res
    
    if (res.failedCount === 0) {
      toast.success(t('host.batchConfig.retrySuccess', { count: res.successCount }))
    } else {
      toast.warning(t('host.batchConfig.retryPartial', { success: res.successCount, failed: res.failedCount }))
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    toast.error(t('host.batchConfig.retryFailed') + ': ' + (error?.message || String(err)))
  } finally {
    isSubmitting.value = false
  }
}

// 复制失败的 Incus ID
function copyFailedIncusIds() {
  if (!result.value?.failedItems) return
  const ids = result.value.failedItems.map(item => item.incusId).join('\n')
  navigator.clipboard.writeText(ids).then(() => {
    toast.success(t('host.batchConfig.copiedIncusIds', { count: result.value!.failedItems.length }))
  }).catch(() => {
    toast.error(t('common.copyFailed'))
  })
}

// 关闭弹窗
function handleClose() {
  if (isSubmitting.value) return
  emit('update:visible', false)
  if (result.value && result.value.successCount > 0) {
    emit('success')
  }
}

// 完成并关闭
function handleDone() {
  showResult.value = false
  result.value = null
  handleClose()
}

// 重置表单
function resetForm() {
  Object.keys(form.value).forEach(key => {
    const k = key as keyof typeof form.value
    if (typeof form.value[k] === 'boolean' || form.value[k] === null) {
      (form.value[k] as boolean | null) = null
    } else {
      (form.value[k] as string) = ''
    }
  })
  Object.keys(enabledFields.value).forEach(key => {
    enabledFields.value[key as keyof typeof enabledFields.value] = false
  })
  showResult.value = false
  result.value = null
}

// 监听弹窗关闭时重置
watch(() => props.visible, (newVal) => {
  if (!newVal) {
    resetForm()
  }
})

// CPU/内存 blur 时格式化为整数
function handleCpuBlur() {
  if (!form.value.cpu) return
  const num = parseFloat(form.value.cpu)
  if (isNaN(num) || num <= 0) {
    form.value.cpu = '1'
    return
  }
  form.value.cpu = Math.round(num).toString()
}

function handleMemoryBlur() {
  if (!form.value.memory) return
  const num = parseFloat(form.value.memory)
  if (isNaN(num) || num <= 0) {
    form.value.memory = '1'
    return
  }
  form.value.memory = Math.round(num).toString()
}

function normalizeStorageLimit(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d+(?:\.\d+)?$/i.test(trimmed)) {
    return `${trimmed}MB`
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(B|kB|MB|GB|TB|PB)$/i)
  if (match) {
    return `${match[1]}${match[2]}`
  }

  return trimmed
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay">
        <div class="modal-backdrop" @click="handleClose"></div>
        <div class="modal-content max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <!-- 标题栏 -->
          <div class="modal-header">
            <h3 class="modal-title">{{ t('host.batchConfig.title') }}</h3>
            <button class="text-themed-muted hover:text-themed" :disabled="isSubmitting" @click="handleClose">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 内容区域 -->
          <div class="modal-body overflow-y-auto flex-1">
            <!-- 结果展示 -->
            <template v-if="showResult && result">
              <div class="space-y-4">
                <!-- 统计信息 -->
                <div class="flex items-center gap-4 p-4 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                  <div class="flex-1 text-center">
                    <div class="text-2xl font-bold text-green-500">{{ result.successCount }}</div>
                    <div class="text-sm text-themed-secondary">{{ t('host.batchConfig.success') }}</div>
                  </div>
                  <div class="w-px h-10" :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-300'"></div>
                  <div class="flex-1 text-center">
                    <div class="text-2xl font-bold text-red-500">{{ result.failedCount }}</div>
                    <div class="text-sm text-themed-secondary">{{ t('host.batchConfig.failed') }}</div>
                  </div>
                </div>

                <!-- 失败列表 -->
                <div v-if="result.failedItems.length > 0" class="space-y-2">
                  <div class="text-sm font-medium text-themed">{{ t('host.batchConfig.failedDetails') }}</div>
                  <div class="max-h-48 overflow-y-auto rounded-lg border" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
                    <table class="w-full text-sm">
                      <thead class="sticky top-0" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
                        <tr>
                          <th class="text-left px-3 py-2 text-themed-muted">Incus ID</th>
                          <th class="text-left px-3 py-2 text-themed-muted">{{ t('instance.name') }}</th>
                          <th class="text-left px-3 py-2 text-themed-muted">{{ t('host.batchConfig.errorReason') }}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y" :class="themeStore.isDark ? 'divide-gray-700' : 'divide-gray-200'">
                        <tr v-for="item in result.failedItems" :key="item.instanceId">
                          <td class="px-3 py-2 font-mono text-xs" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">{{ item.incusId }}</td>
                          <td class="px-3 py-2 text-themed">{{ item.name }}</td>
                          <td class="px-3 py-2 text-red-500 text-xs">{{ item.error || '-' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </template>

            <!-- 配置表单 -->
            <template v-else>
              <!-- 目标提示 -->
              <div class="p-3 mb-4 rounded-lg" :class="themeStore.isDark ? 'bg-blue-500/10' : 'bg-blue-50'">
                <p class="text-sm" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'">
                  {{ selectedIds.length > 0 
                    ? t('host.batchConfig.targetSelected', { count: selectedIds.length })
                    : t('host.batchConfig.targetAll', { count: totalInstanceCount })
                  }}
                </p>
              </div>

              <!-- 配置分类 -->
              <div class="space-y-3">
                <!-- 资源配置 -->
                <div class="border rounded-lg" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
                  <button 
                    class="w-full flex items-center justify-between px-4 py-3 text-left"
                    :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                    @click="toggleSection('resources')"
                  >
                    <span class="font-medium text-themed">{{ t('host.batchConfig.section.resources') }}</span>
                    <svg class="w-4 h-4 transition-transform" :class="expandedSections.resources ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div v-show="expandedSections.resources" class="px-4 pb-4 space-y-3">
                    <!-- CPU -->
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.cpu" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">CPU (%)</label>
                      <input 
                        v-model="form.cpu" 
                        type="number" 
                        min="1" 
                        :disabled="!enabledFields.cpu"
                        :placeholder="t('host.batchConfig.placeholder.cpu')"
                        class="input flex-1"
                        @blur="handleCpuBlur"
                      />
                    </div>
                    <!-- 内存 -->
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.memory" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.memory') }} (MB)</label>
                      <input 
                        v-model="form.memory" 
                        type="number" 
                        min="1" 
                        :disabled="!enabledFields.memory"
                        :placeholder="t('host.batchConfig.placeholder.memory')"
                        class="input flex-1"
                        @blur="handleMemoryBlur"
                      />
                    </div>
                    <!-- 硬盘 -->
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.disk" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.disk') }} (GB)</label>
                      <input 
                        v-model="form.disk" 
                        type="number" 
                        min="0.1" 
                        step="0.1"
                        :disabled="!enabledFields.disk"
                        :placeholder="t('host.batchConfig.placeholder.disk')"
                        class="input flex-1"
                      />
                    </div>
                    <!-- 流量 -->
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.monthlyTrafficLimit" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.traffic') }} (GB)</label>
                      <input 
                        v-model="form.monthlyTrafficLimit" 
                        type="number" 
                        min="0" 
                        :disabled="!enabledFields.monthlyTrafficLimit"
                        :placeholder="t('host.batchConfig.placeholder.traffic')"
                        class="input flex-1"
                      />
                    </div>
                    <!-- SWAP 开关 -->
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.swapEnabled" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.swapEnabled') }}</label>
                      <select v-model="form.swapEnabled" :disabled="!enabledFields.swapEnabled" class="input flex-1">
                        <option :value="null">-</option>
                        <option :value="true">{{ t('common.enabled') }}</option>
                        <option :value="false">{{ t('common.disabled') }}</option>
                      </select>
                    </div>
                    <!-- SWAP 大小 -->
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.swapSize" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.swapSize') }} (MB)</label>
                      <input 
                        v-model="form.swapSize" 
                        type="number" 
                        min="0"
                        max="1048576"
                        step="128"
                        :disabled="!enabledFields.swapSize"
                        :placeholder="t('host.batchConfig.placeholder.swapSize')"
                        class="input flex-1"
                      />
                    </div>
                  </div>
                </div>

                <!-- 配额限制 -->
                <div class="border rounded-lg" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
                  <button 
                    class="w-full flex items-center justify-between px-4 py-3 text-left"
                    :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                    @click="toggleSection('quota')"
                  >
                    <span class="font-medium text-themed">{{ t('host.batchConfig.section.quota') }}</span>
                    <svg class="w-4 h-4 transition-transform" :class="expandedSections.quota ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div v-show="expandedSections.quota" class="px-4 pb-4 space-y-3">
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.portLimit" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.portLimit') }}</label>
                      <input v-model="form.portLimit" type="number" min="1" :disabled="!enabledFields.portLimit" :placeholder="t('host.batchConfig.placeholder.limit')" class="input flex-1" />
                    </div>
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.snapshotLimit" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.snapshotLimit') }}</label>
                      <input v-model="form.snapshotLimit" type="number" min="0" :disabled="!enabledFields.snapshotLimit" :placeholder="t('host.batchConfig.placeholder.limit')" class="input flex-1" />
                    </div>
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.siteLimit" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.siteLimit') }}</label>
                      <input v-model="form.siteLimit" type="number" min="0" :disabled="!enabledFields.siteLimit" :placeholder="t('host.batchConfig.placeholder.limit')" class="input flex-1" />
                    </div>
                  </div>
                </div>

                <!-- 容器权限 (已隐藏) -->
                <div v-if="false" class="border rounded-lg" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
                  <button 
                    class="w-full flex items-center justify-between px-4 py-3 text-left"
                    :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                    @click="toggleSection('permissions')"
                  >
                    <span class="font-medium text-themed">{{ t('host.batchConfig.section.permissions') }}</span>
                    <svg class="w-4 h-4 transition-transform" :class="expandedSections.permissions ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div v-show="expandedSections.permissions" class="px-4 pb-4 space-y-3">
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.nested" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.nested') }}</label>
                      <select v-model="form.nested" :disabled="!enabledFields.nested" class="input flex-1">
                        <option :value="null">-</option>
                        <option :value="true">{{ t('common.enabled') }}</option>
                        <option :value="false">{{ t('common.disabled') }}</option>
                      </select>
                    </div>
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.privileged" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.privileged') }}</label>
                      <select v-model="form.privileged" :disabled="!enabledFields.privileged" class="input flex-1">
                        <option :value="null">-</option>
                        <option :value="true">{{ t('common.enabled') }}</option>
                        <option :value="false">{{ t('common.disabled') }}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <!-- 存储IO限制 -->
                <div class="border rounded-lg" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
                  <button 
                    class="w-full flex items-center justify-between px-4 py-3 text-left"
                    :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                    @click="toggleSection('io')"
                  >
                    <span class="font-medium text-themed">{{ t('host.batchConfig.section.io') }}</span>
                    <svg class="w-4 h-4 transition-transform" :class="expandedSections.io ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div v-show="expandedSections.io" class="px-4 pb-4 space-y-3">
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.limitsRead" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.limitsRead') }}</label>
                      <input v-model="form.limitsRead" :disabled="!enabledFields.limitsRead" :placeholder="t('host.batchConfig.placeholder.ioLimit')" class="input flex-1" />
                    </div>
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.limitsWrite" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.limitsWrite') }}</label>
                      <input v-model="form.limitsWrite" :disabled="!enabledFields.limitsWrite" :placeholder="t('host.batchConfig.placeholder.ioLimit')" class="input flex-1" />
                    </div>
                  </div>
                </div>

                <!-- 网络限制 -->
                <div class="border rounded-lg" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
                  <button 
                    class="w-full flex items-center justify-between px-4 py-3 text-left"
                    :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                    @click="toggleSection('network')"
                  >
                    <span class="font-medium text-themed">{{ t('host.batchConfig.section.network') }}</span>
                    <svg class="w-4 h-4 transition-transform" :class="expandedSections.network ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div v-show="expandedSections.network" class="px-4 pb-4 space-y-3">
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.limitsIngress" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.limitsIngress') }}</label>
                      <div class="flex items-center gap-2 flex-1">
                        <input v-model.number="form.limitsIngress" type="number" min="1" :disabled="!enabledFields.limitsIngress" placeholder="300" class="input flex-1" />
                        <span class="text-themed-muted text-sm">Mbit</span>
                      </div>
                    </div>
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.limitsEgress" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.limitsEgress') }}</label>
                      <div class="flex items-center gap-2 flex-1">
                        <input v-model.number="form.limitsEgress" type="number" min="1" :disabled="!enabledFields.limitsEgress" placeholder="300" class="input flex-1" />
                        <span class="text-themed-muted text-sm">Mbit</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 进程与调度 -->
                <div class="border rounded-lg" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
                  <button 
                    class="w-full flex items-center justify-between px-4 py-3 text-left"
                    :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                    @click="toggleSection('process')"
                  >
                    <span class="font-medium text-themed">{{ t('host.batchConfig.section.process') }}</span>
                    <svg class="w-4 h-4 transition-transform" :class="expandedSections.process ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div v-show="expandedSections.process" class="px-4 pb-4 space-y-3">
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.limitsProcesses" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.limitsProcesses') }}</label>
                      <input v-model="form.limitsProcesses" type="number" min="0" :disabled="!enabledFields.limitsProcesses" placeholder="500" class="input flex-1" />
                    </div>
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.limitsCpuPriority" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.limitsCpuPriority') }}</label>
                      <input v-model="form.limitsCpuPriority" type="number" min="0" max="10" :disabled="!enabledFields.limitsCpuPriority" placeholder="0-10" class="input flex-1" />
                    </div>
                  </div>
                </div>

                <!-- 启动设置 -->
                <div class="border rounded-lg" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
                  <button 
                    class="w-full flex items-center justify-between px-4 py-3 text-left"
                    :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                    @click="toggleSection('boot')"
                  >
                    <span class="font-medium text-themed">{{ t('host.batchConfig.section.boot') }}</span>
                    <svg class="w-4 h-4 transition-transform" :class="expandedSections.boot ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div v-show="expandedSections.boot" class="px-4 pb-4 space-y-3">
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.bootAutostart" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.bootAutostart') }}</label>
                      <select v-model="form.bootAutostart" :disabled="!enabledFields.bootAutostart" class="input flex-1">
                        <option :value="null">-</option>
                        <option :value="true">{{ t('common.enabled') }}</option>
                        <option :value="false">{{ t('common.disabled') }}</option>
                      </select>
                    </div>
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.bootAutostartPriority" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.bootPriority') }}</label>
                      <input v-model="form.bootAutostartPriority" type="number" min="0" max="100" :disabled="!enabledFields.bootAutostartPriority" placeholder="0-100" class="input flex-1" />
                    </div>
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.bootAutostartDelay" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.bootDelay') }}</label>
                      <input v-model="form.bootAutostartDelay" type="number" min="5" max="600" :disabled="!enabledFields.bootAutostartDelay" :placeholder="t('common.seconds')" class="input flex-1" />
                    </div>
                    <div class="flex items-center gap-3">
                      <input v-model="enabledFields.bootHostShutdownTimeout" type="checkbox" class="rounded" />
                      <label class="w-24 text-sm text-themed-secondary">{{ t('host.batchConfig.shutdownTimeout') }}</label>
                      <input v-model="form.bootHostShutdownTimeout" type="number" min="30" max="600" :disabled="!enabledFields.bootHostShutdownTimeout" :placeholder="t('common.seconds')" class="input flex-1" />
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- 底部操作栏 -->
          <div class="modal-footer">
            <template v-if="showResult && result">
              <button 
                v-if="result.failedItems.length > 0"
                class="btn-secondary"
                @click="copyFailedIncusIds"
              >
                <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {{ t('host.batchConfig.copyIncusIds') }}
              </button>
              <button 
                v-if="result.retryPayload && result.failedCount > 0"
                class="btn-secondary"
                :disabled="isSubmitting"
                @click="handleRetry"
              >
                <svg v-if="isSubmitting" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <svg v-else class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {{ t('host.batchConfig.retryFailed') }}
              </button>
              <button class="btn-primary" @click="handleDone">
                {{ t('common.done') }}
              </button>
            </template>
            <template v-else>
              <button class="btn-secondary" :disabled="isSubmitting" @click="handleClose">
                {{ t('common.cancel') }}
              </button>
              <button 
                class="btn-primary" 
                :disabled="isSubmitting || !hasEnabledFields"
                @click="handleSubmit"
              >
                <svg v-if="isSubmitting" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ isSubmitting ? t('common.processing') : t('host.batchConfig.submit', { count: targetCount }) }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
