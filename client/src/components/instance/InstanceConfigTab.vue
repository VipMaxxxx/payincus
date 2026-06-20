<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import type { InstanceConfigResponse, InstanceConfig } from '@/types/api'
import ChangeHostCard from '@/components/instance/ChangeHostCard.vue'

const props = defineProps<{
  instanceId: number
  canEditConfig?: boolean
  showBootSettings?: boolean
  instanceType?: 'container' | 'vm'
  instanceStatus?: string
  isInstanceOwner?: boolean  // 是否是实例所有者
}>()

const emit = defineEmits<{
  'change-host-task': [taskId: number]
}>()

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

const loading = ref(true)
const config = ref<InstanceConfigResponse | null>(null)
const editMode = ref(false)
const showSwapModal = ref(false)
const swapActionLoading = ref(false)

// 提升进程数相关
const showBoostModal = ref(false)
const boostLoading = ref(false)

// 进程数上限：LXC=1000, KVM=2000
const processLimit = computed(() => props.instanceType === 'vm' ? 2000 : 1000)
const canChangeHost = computed(() => props.isInstanceOwner === true || props.canEditConfig === true)

// 是否可以显示提升按钮（实例所有者且未达上限）
const canBoostProcesses = computed(() => {
  if (!config.value) return false
  if (!props.isInstanceOwner) return false  // 只有实例所有者可以提升
  const currentLimit = config.value.config.limits_processes ?? 500
  return currentLimit < processLimit.value
})

// Form data for editing - using snake_case to match API
interface ConfigForm {
  limits_read: string | null
  limits_write: string | null
  limits_read_iops: number | null
  limits_write_iops: number | null
  limits_ingress: string | null
  limits_egress: string | null
  limits_processes: number | null
  limits_cpu_priority: number | null
  boot_autostart: boolean | null
  boot_autostart_priority: number | null
  boot_autostart_delay: number | null
  boot_host_shutdown_timeout: number | null
}

const form = ref<ConfigForm>(getDefaultForm())

function getDefaultForm(): ConfigForm {
  return {
    limits_read: null,
    limits_write: null,
    limits_read_iops: null,
    limits_write_iops: null,
    limits_ingress: null,
    limits_egress: null,
    limits_processes: null,
    limits_cpu_priority: null,
    boot_autostart: null,
    boot_autostart_priority: null,
    boot_autostart_delay: null,
    boot_host_shutdown_timeout: null
  }
}

onMounted(async () => {
  await loadConfig()
})

watch(() => props.instanceId, async () => {
  await loadConfig()
})

async function loadConfig(): Promise<void> {
  loading.value = true
  try {
    const response = await api.instances.getConfig(props.instanceId)
    config.value = response as InstanceConfigResponse
    resetForm()
  } catch (err: any) {
    toast.error(err.message || t('common.error'))
  } finally {
    loading.value = false
  }
}

function resetForm(): void {
  if (!config.value) return
  // Check overrides to determine which fields have instance-level values
  const overrides = config.value.overrides
  const cfg = config.value.config
  
  form.value = {
    limits_read: overrides.limits_read ? cfg.limits_read : null,
    limits_write: overrides.limits_write ? cfg.limits_write : null,
    limits_read_iops: overrides.limits_read_iops ? cfg.limits_read_iops : null,
    limits_write_iops: overrides.limits_write_iops ? cfg.limits_write_iops : null,
    limits_ingress: overrides.limits_ingress ? cfg.limits_ingress : null,
    limits_egress: overrides.limits_egress ? cfg.limits_egress : null,
    limits_processes: overrides.limits_processes ? cfg.limits_processes : null,
    limits_cpu_priority: overrides.limits_cpu_priority ? cfg.limits_cpu_priority : null,
    boot_autostart: overrides.boot_autostart ? cfg.boot_autostart : null,
    boot_autostart_priority: overrides.boot_autostart_priority ? cfg.boot_autostart_priority : null,
    boot_autostart_delay: overrides.boot_autostart_delay ? cfg.boot_autostart_delay : null,
    boot_host_shutdown_timeout: overrides.boot_host_shutdown_timeout ? cfg.boot_host_shutdown_timeout : null
  }
}

function resetField(field: keyof ConfigForm): void {
  (form.value as any)[field] = null
}

function isOverridden(field: keyof InstanceConfig): boolean {
  if (!config.value) return false
  return config.value.overrides[field] === true
}

function getEffectiveValue(field: keyof InstanceConfig): any {
  if (!config.value) return '-'
  return config.value.config[field]
}

// 格式化网络带宽值（将 Mbit/Gbit 转换为 Mbps/Gbps）
function formatNetworkValue(field: keyof InstanceConfig): string {
  const value = getEffectiveValue(field)
  if (!value || value === '-') return '-'
  return String(value).replace(/Mbit/gi, 'Mbps').replace(/Gbit/gi, 'Gbps')
}

function getPackageDefault(field: keyof InstanceConfig): any {
  if (!config.value) return '-'
  return config.value.packageDefaults[field]
}

const ioLimitMode = computed<'throughput' | 'iops'>(() => config.value?.ioLimitMode || 'throughput')
const normalizedInstanceStatus = computed<string>(() => props.instanceStatus?.toLowerCase() || '')
const canEnableSwap = computed<boolean>(() => {
  if (!config.value?.swap.available || config.value.swap.enabled) return false
  if (!props.isInstanceOwner) return false
  if (!['running', 'stopped'].includes(normalizedInstanceStatus.value)) return false
  if (config.value.swap.requiresRunning && normalizedInstanceStatus.value !== 'running') return false
  return true
})
const canDisableSwap = computed<boolean>(() => {
  if (!config.value?.swap.enabled) return false
  if (!props.isInstanceOwner) return false
  if (config.value.swap.kind !== 'container') return false
  if (!['running', 'stopped'].includes(normalizedInstanceStatus.value)) return false
  return true
})
const swapAction = computed<'enable' | 'disable'>(() => config.value?.swap.enabled ? 'disable' : 'enable')

function formatSwapSize(sizeMb: number): string {
  if (sizeMb >= 1024) {
    const sizeGb = sizeMb / 1024
    return sizeGb % 1 === 0 ? `${sizeGb.toFixed(0)} GB` : `${sizeGb.toFixed(1)} GB`
  }
  return `${sizeMb} MB`
}

async function submitSwapAction(): Promise<void> {
  if (!config.value) return

  swapActionLoading.value = true
  try {
    if (config.value.swap.enabled) {
      await api.instances.disableSwap(props.instanceId)
      toast.success(t('instanceConfig.swap.disableSuccess'))
    } else {
      await api.instances.enableSwap(props.instanceId)
      toast.success(t('instanceConfig.swap.enableSuccess'))
    }
    showSwapModal.value = false
    await loadConfig()
  } catch (err: any) {
    toast.error(err.message || t(`instanceConfig.swap.${swapAction.value}Failed`))
  } finally {
    swapActionLoading.value = false
  }
}

// 提升进程数限制
async function boostProcesses(): Promise<void> {
  boostLoading.value = true
  try {
    await api.instances.boostProcesses(props.instanceId)
    toast.success(t('instanceConfig.boostProcesses.success', { limit: processLimit.value }))
    showBoostModal.value = false
    await loadConfig()
  } catch (err: any) {
    toast.error(err.message || t('instanceConfig.boostProcesses.failed'))
  } finally {
    boostLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Loading -->
    <div v-if="loading" class="card p-8 text-center">
      <div class="loading-spinner w-8 h-8 mx-auto"></div>
      <p class="text-themed-muted mt-4">{{ t('common.loading') }}</p>
    </div>

    <template v-else-if="config">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('instanceConfig.title') }}
        </h2>
      </div>

      <ChangeHostCard
        :instance-id="props.instanceId"
        :can-change-host="canChangeHost"
        :instance-status="props.instanceStatus"
        @task-created="emit('change-host-task', $event)"
      />

      <!-- SWAP Section -->
      <div v-if="config.swap.available || config.swap.enabled" class="card p-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="text-sm font-medium mb-1" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
              {{ t('instanceConfig.sections.swap') }}
            </h3>
            <p class="text-sm text-themed-muted">
              {{ t('instanceConfig.swap.size') }}: {{ formatSwapSize(config.swap.sizeMb) }}
            </p>
            <p class="text-xs text-themed-muted mt-2">
              {{ config.swap.requiresRunning ? t('instanceConfig.swap.vmHint') : t('instanceConfig.swap.containerHint') }}
            </p>
            <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-amber-400' : 'text-amber-600'">
              {{ t('instanceConfig.swap.toggleHint') }}
            </p>
          </div>
          <div class="flex flex-col items-end gap-2">
            <span
              class="px-2.5 py-1 rounded-full text-xs font-medium"
              :class="config.swap.enabled
                ? (themeStore.isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700')
                : (themeStore.isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600')"
            >
              {{ config.swap.enabled ? t('instanceConfig.swap.enabled') : t('instanceConfig.swap.disabled') }}
            </span>
            <button
              v-if="!config.swap.enabled && props.isInstanceOwner"
              class="btn-primary btn-sm"
              :disabled="!canEnableSwap"
              @click="showSwapModal = true"
            >
              {{ t('instanceConfig.swap.enableButton') }}
            </button>
            <button
              v-else-if="config.swap.enabled && props.isInstanceOwner"
              class="btn-secondary btn-sm"
              :disabled="!canDisableSwap"
              @click="showSwapModal = true"
            >
              {{ t('instanceConfig.swap.disableButton') }}
            </button>
            <p
              v-if="!config.swap.enabled && props.isInstanceOwner && config.swap.requiresRunning && normalizedInstanceStatus !== 'running'"
              class="text-xs text-themed-muted text-right max-w-48"
            >
              {{ t('instanceConfig.swap.runningRequired') }}
            </p>
          </div>
        </div>
      </div>

      <!-- Storage I/O Section -->
      <div class="card p-6">
        <h3 class="text-sm font-medium mb-4" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ t('instanceConfig.sections.storageIO') }}
        </h3>
        <div v-if="ioLimitMode === 'throughput'" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Read Limit -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.limitsRead') }}</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model="form.limits_read" type="text" class="input flex-1" :placeholder="String(getPackageDefault('limits_read'))" />
                <button v-if="form.limits_read !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('limits_read')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('limits_read') }}</span>
                <span v-if="isOverridden('limits_read')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>

          <!-- Write Limit -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.limitsWrite') }}</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model="form.limits_write" type="text" class="input flex-1" :placeholder="String(getPackageDefault('limits_write'))" />
                <button v-if="form.limits_write !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('limits_write')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('limits_write') }}</span>
                <span v-if="isOverridden('limits_write')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Read IOPS -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.limitsReadIops') }}</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model.number="form.limits_read_iops" type="number" class="input flex-1" :placeholder="String(getPackageDefault('limits_read_iops'))" />
                <button v-if="form.limits_read_iops !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('limits_read_iops')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('limits_read_iops') }}</span>
                <span v-if="isOverridden('limits_read_iops')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>

          <!-- Write IOPS -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.limitsWriteIops') }}</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model.number="form.limits_write_iops" type="number" class="input flex-1" :placeholder="String(getPackageDefault('limits_write_iops'))" />
                <button v-if="form.limits_write_iops !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('limits_write_iops')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('limits_write_iops') }}</span>
                <span v-if="isOverridden('limits_write_iops')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Network Limits Section -->
      <div class="card p-6">
        <h3 class="text-sm font-medium mb-4" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ t('instanceConfig.sections.networkLimits') }}
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Ingress -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.limitsIngress') }}</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model="form.limits_ingress" type="text" class="input flex-1" :placeholder="String(getPackageDefault('limits_ingress'))" />
                <button v-if="form.limits_ingress !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('limits_ingress')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ formatNetworkValue('limits_ingress') }}</span>
                <span v-if="isOverridden('limits_ingress')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>

          <!-- Egress -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.limitsEgress') }}</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model="form.limits_egress" type="text" class="input flex-1" :placeholder="String(getPackageDefault('limits_egress'))" />
                <button v-if="form.limits_egress !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('limits_egress')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ formatNetworkValue('limits_egress') }}</span>
                <span v-if="isOverridden('limits_egress')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Process & Scheduling Section -->
      <div class="card p-6">
        <h3 class="text-sm font-medium mb-4" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ t('instanceConfig.sections.processScheduling') }}
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Processes -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.limitsProcesses') }}</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model.number="form.limits_processes" type="number" class="input flex-1" :placeholder="String(getPackageDefault('limits_processes'))" />
                <button v-if="form.limits_processes !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('limits_processes')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('limits_processes') }}</span>
                <span v-if="isOverridden('limits_processes')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
                <!-- 提升进程数按钮 -->
                <button
                  v-if="canBoostProcesses && !editMode"
                  class="ml-2 px-2 py-1 text-xs rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors flex items-center gap-1"
                  @click="showBoostModal = true"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  {{ t('instanceConfig.boostProcesses.button') }}
                </button>
              </div>
            </template>
          </div>

          <!-- CPU Priority -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.limitsCpuPriority') }} (0-10)</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model.number="form.limits_cpu_priority" type="number" min="0" max="10" class="input flex-1" :placeholder="String(getPackageDefault('limits_cpu_priority'))" />
                <button v-if="form.limits_cpu_priority !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('limits_cpu_priority')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('limits_cpu_priority') }}</span>
                <span v-if="isOverridden('limits_cpu_priority')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Boot Settings Section -->
      <div v-if="props.showBootSettings !== false" class="card p-6">
        <h3 class="text-sm font-medium mb-4" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
          {{ t('instanceConfig.sections.bootSettings') }}
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Autostart -->
          <div class="md:col-span-2">
            <template v-if="editMode">
              <label class="flex items-center gap-2 cursor-pointer">
                <input v-model="form.boot_autostart" type="checkbox" class="w-4 h-4 rounded" />
                <span class="text-sm text-themed-secondary">{{ t('packageForm.fields.bootAutostart') }}</span>
                <button v-if="form.boot_autostart !== null" class="btn-ghost btn-sm ml-2" :title="t('instanceConfig.resetToDefault')" @click="resetField('boot_autostart')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </label>
            </template>
            <template v-else>
              <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.bootAutostart') }}</label>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('boot_autostart') ? t('common.yes') : t('common.no') }}</span>
                <span v-if="isOverridden('boot_autostart')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>

          <!-- Autostart Priority -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.bootAutostartPriority') }} (0-100)</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model.number="form.boot_autostart_priority" type="number" min="0" max="100" class="input flex-1" :placeholder="String(getPackageDefault('boot_autostart_priority'))" />
                <button v-if="form.boot_autostart_priority !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('boot_autostart_priority')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('boot_autostart_priority') }}</span>
                <span v-if="isOverridden('boot_autostart_priority')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>

          <!-- Autostart Delay -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.bootAutostartDelay') }} ({{ t('packageForm.units.seconds') }})</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model.number="form.boot_autostart_delay" type="number" min="5" max="600" class="input flex-1" :placeholder="String(getPackageDefault('boot_autostart_delay'))" />
                <button v-if="form.boot_autostart_delay !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('boot_autostart_delay')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('boot_autostart_delay') }}</span>
                <span v-if="isOverridden('boot_autostart_delay')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>

          <!-- Shutdown Timeout -->
          <div>
            <label class="block text-xs text-themed-muted mb-1">{{ t('packageForm.fields.bootHostShutdownTimeout') }} ({{ t('packageForm.units.seconds') }})</label>
            <template v-if="editMode">
              <div class="flex gap-2">
                <input v-model.number="form.boot_host_shutdown_timeout" type="number" min="30" max="600" class="input flex-1" :placeholder="String(getPackageDefault('boot_host_shutdown_timeout'))" />
                <button v-if="form.boot_host_shutdown_timeout !== null" class="btn-ghost btn-sm" :title="t('instanceConfig.resetToDefault')" @click="resetField('boot_host_shutdown_timeout')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-themed">{{ getEffectiveValue('boot_host_shutdown_timeout') }}</span>
                <span v-if="isOverridden('boot_host_shutdown_timeout')" class="badge badge-info text-xs">{{ t('instanceConfig.overridden') }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- 提升进程数确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showBoostModal" class="fixed inset-0 z-50 flex items-center justify-center">
          <!-- 背景遮罩 -->
          <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="showBoostModal = false"></div>
          <!-- 弹窗内容 -->
          <div
            class="relative w-full max-w-md mx-4 rounded-xl shadow-xl overflow-hidden"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-white'"
          >
            <!-- 头部 -->
            <div class="px-6 py-4 border-b" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-100'">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <div>
                  <h3 class="text-lg font-semibold" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                    {{ t('instanceConfig.boostProcesses.title') }}
                  </h3>
                </div>
              </div>
            </div>
            <!-- 内容 -->
            <div class="px-6 py-4">
              <p class="text-sm leading-relaxed" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'">
                {{ t('instanceConfig.boostProcesses.confirm', {
                  type: instanceType === 'vm' ? 'KVM' : 'LXC',
                  limit: processLimit
                }) }}
              </p>
              <div class="mt-4 p-3 rounded-lg" :class="themeStore.isDark ? 'bg-blue-500/10' : 'bg-blue-50'">
                <div class="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {{ t('instanceConfig.boostProcesses.hint') }}
                </div>
              </div>
            </div>
            <!-- 底部按钮 -->
            <div class="px-6 py-4 border-t flex justify-end gap-3" :class="themeStore.isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100 bg-gray-50'">
              <button
                class="px-4 py-2 text-sm rounded-lg transition-colors"
                :class="themeStore.isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-200'"
                :disabled="boostLoading"
                @click="showBoostModal = false"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                class="px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors flex items-center gap-2"
                :disabled="boostLoading"
                @click="boostProcesses"
              >
                <svg v-if="boostLoading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {{ boostLoading ? t('common.processing') : t('common.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- SWAP 操作确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showSwapModal" class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="showSwapModal = false"></div>
          <div
            class="relative w-full max-w-md mx-4 rounded-xl shadow-xl overflow-hidden"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-white'"
          >
            <div class="px-6 py-4 border-b" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-100'">
              <h3 class="text-lg font-semibold" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                {{ t(`instanceConfig.swap.${swapAction}ConfirmTitle`) }}
              </h3>
            </div>
            <div class="px-6 py-4 space-y-3">
              <p class="text-sm leading-relaxed" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'">
                {{ t(`instanceConfig.swap.${swapAction}ConfirmText`, { size: formatSwapSize(config?.swap.sizeMb || 0) }) }}
              </p>
              <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'">
                <p class="text-sm">{{ t('instanceConfig.swap.toggleHint') }}</p>
              </div>
            </div>
            <div class="px-6 py-4 border-t flex justify-end gap-3" :class="themeStore.isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100 bg-gray-50'">
              <button
                class="px-4 py-2 text-sm rounded-lg transition-colors"
                :class="themeStore.isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-200'"
                :disabled="swapActionLoading"
                @click="showSwapModal = false"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                class="px-4 py-2 text-sm rounded-lg text-white transition-colors flex items-center gap-2"
                :class="swapAction === 'enable' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-zinc-700 hover:bg-zinc-800'"
                :disabled="swapActionLoading"
                @click="submitSwapAction"
              >
                <svg v-if="swapActionLoading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {{ swapActionLoading ? t('common.processing') : t('common.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
