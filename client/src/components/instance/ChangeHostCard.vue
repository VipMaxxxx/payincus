<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import FlagIcon from '@/components/FlagIcon.vue'
import type { ChangeHostOption, ChangeHostOptionsResponse, ChangeHostUnavailableReason } from '@/types/api'

const props = defineProps<{
  instanceId: number
  canChangeHost: boolean
  instanceStatus?: string
}>()

const emit = defineEmits<{
  'task-created': [taskId: number]
}>()

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

const loading = ref(false)
const submitting = ref(false)
const showModal = ref(false)
const options = ref<ChangeHostOptionsResponse | null>(null)
const selectedHostId = ref<number | null>(null)
const selectedSshKeyId = ref<number | null>(null)

const statusAllowsChange = computed(() => ['running', 'stopped', 'error'].includes((props.instanceStatus || '').toLowerCase()))
const shouldRender = computed(() => props.canChangeHost && statusAllowsChange.value && (loading.value || (options.value?.hosts.length || 0) > 1))
const currentHost = computed(() => options.value?.hosts.find(host => host.isCurrent) || null)
const selectableHosts = computed(() => options.value?.hosts.filter(host => host.canChange) || [])
const selectedHost = computed(() => options.value?.hosts.find(host => host.id === selectedHostId.value) || null)
const canSubmit = computed(() => Boolean(selectedHost.value?.canChange && selectedSshKeyId.value && !submitting.value))

function formatMemory(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb % 1 === 0 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`
  }
  return `${mb} MB`
}

function usagePercent(used: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(100, Math.round((used / max) * 100))
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

function reasonLabel(reason: ChangeHostUnavailableReason | null): string {
  if (!reason) return t('instanceConfig.changeHost.available')
  return t(`instanceConfig.changeHost.reasons.${reason}`)
}

function hostBadgeClass(host: ChangeHostOption): string {
  if (host.isCurrent) {
    return themeStore.isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-700'
  }
  if (host.canChange) {
    return themeStore.isDark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
  }
  return themeStore.isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
}

function selectDefaults(): void {
  selectedHostId.value = selectableHosts.value[0]?.id ?? null
  selectedSshKeyId.value = options.value?.sshKeys[0]?.id ?? null
}

async function loadOptions(): Promise<void> {
  if (!props.canChangeHost || !statusAllowsChange.value) {
    options.value = null
    return
  }

  loading.value = true
  try {
    options.value = await api.instances.getChangeHostOptions(props.instanceId)
    selectDefaults()
  } catch (err: any) {
    options.value = null
    toast.error(err?.message || t('instanceConfig.changeHost.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function openModal(): Promise<void> {
  await loadOptions()
  if (!options.value) return
  selectDefaults()
  showModal.value = true
}

function closeModal(): void {
  if (submitting.value) return
  showModal.value = false
}

async function submit(): Promise<void> {
  if (!selectedHost.value?.canChange || !selectedSshKeyId.value) return

  submitting.value = true
  try {
    const response = await api.instances.changeHost(props.instanceId, {
      targetHostId: selectedHost.value.id,
      sshKeyId: selectedSshKeyId.value
    })
    toast.success(t('instanceConfig.changeHost.taskQueued'))
    showModal.value = false
    emit('task-created', response.taskId)
    await loadOptions()
  } catch (err: any) {
    toast.error(err?.message || t('instanceConfig.changeHost.submitFailed'))
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  void loadOptions()
})

watch(() => [props.instanceId, props.canChangeHost, props.instanceStatus], () => {
  void loadOptions()
})
</script>

<template>
  <div v-if="shouldRender" class="card p-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex min-w-0 items-start gap-4">
        <div
          class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
          :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h10m0 0-3-3m3 3-3 3M17 17H7m0 0 3 3m-3-3 3-3" />
          </svg>
        </div>
        <div class="min-w-0">
          <h3 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
            {{ t('instanceConfig.changeHost.title') }}
          </h3>
          <p class="mt-1 text-sm text-themed-muted">
            {{ t('instanceConfig.changeHost.description') }}
          </p>
          <div v-if="currentHost" class="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span class="text-themed-muted">{{ t('instanceConfig.changeHost.currentHost') }}</span>
            <span class="inline-flex items-center gap-1.5 rounded-md px-2 py-1" :class="themeStore.isDark ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'">
              <FlagIcon :code="currentHost.countryCode || 'us'" size="xs" />
              {{ currentHost.name }}
            </span>
            <span class="text-themed-muted">
              {{ t('instanceConfig.changeHost.availableCount', { count: selectableHosts.length }) }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center lg:flex-shrink-0">
        <span
          v-if="options?.unavailableReason === 'no_ssh_key'"
          class="rounded-md px-2.5 py-1.5 text-xs"
          :class="themeStore.isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'"
        >
          {{ t('instanceConfig.changeHost.noSshKey') }}
        </span>
        <button
          class="btn-secondary"
          :disabled="loading"
          @click="openModal"
        >
          <span v-if="loading" class="loading-spinner h-4 w-4"></span>
          <span>{{ t('instanceConfig.changeHost.button') }}</span>
        </button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="modal">
      <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="closeModal"></div>
        <div
          class="relative flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl shadow-xl"
          :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
        >
          <div class="flex items-start justify-between gap-4 border-b px-5 py-4" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'">
            <div>
              <h3 class="text-base font-semibold" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                {{ t('instanceConfig.changeHost.modalTitle') }}
              </h3>
              <p class="mt-1 text-sm text-themed-muted">
                {{ t('instanceConfig.changeHost.modalSubtitle') }}
              </p>
            </div>
            <button
              class="rounded-lg p-2 transition-colors"
              :class="themeStore.isDark ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'"
              :disabled="submitting"
              @click="closeModal"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="overflow-y-auto px-5 py-4">
            <div
              class="mb-4 rounded-lg border p-3 text-sm"
              :class="themeStore.isDark ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'"
            >
              {{ t('instanceConfig.changeHost.warning') }}
            </div>

            <div class="mb-4">
              <label class="mb-1.5 block text-xs text-themed-muted">{{ t('instanceConfig.changeHost.selectSshKey') }}</label>
              <select v-model.number="selectedSshKeyId" class="input" :disabled="(options?.sshKeys.length || 0) === 0 || submitting">
                <option v-if="(options?.sshKeys.length || 0) === 0" :value="null">
                  {{ t('instanceConfig.changeHost.noSshKey') }}
                </option>
                <option v-for="key in options?.sshKeys || []" :key="key.id" :value="key.id">
                  {{ key.name }}
                </option>
              </select>
            </div>

            <div v-if="loading" class="flex items-center justify-center py-10">
              <div class="loading-spinner h-8 w-8"></div>
            </div>

            <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                v-for="host in options?.hosts || []"
                :key="host.id"
                type="button"
                class="min-w-0 rounded-lg border p-4 text-left transition-all"
                :class="[
                  selectedHostId === host.id
                    ? (themeStore.isDark ? 'border-white bg-gray-800' : 'border-gray-900 bg-gray-50')
                    : (themeStore.isDark ? 'border-gray-800 hover:border-gray-700' : 'border-gray-200 hover:border-gray-300'),
                  host.canChange ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'
                ]"
                :disabled="!host.canChange || submitting"
                :aria-pressed="selectedHostId === host.id"
                @click="selectedHostId = host.id"
              >
                <div class="mb-3 flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-center gap-2">
                      <FlagIcon :code="host.countryCode || 'us'" size="sm" class="flex-shrink-0" />
                      <span class="truncate text-sm font-medium" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                        {{ host.name }}
                      </span>
                    </div>
                    <p v-if="host.effectiveTrafficLimit !== undefined" class="mt-1 truncate text-xs text-themed-muted">
                      {{ t('instance.selector.hostTraffic') }} {{ formatTraffic(host.effectiveTrafficLimit) }}
                      <span v-if="host.effectiveTrafficLimit && host.trafficMultiplier && host.trafficMultiplier !== 1" class="opacity-70">({{ host.trafficMultiplier }}x)</span>
                    </p>
                    <p v-else class="mt-1 truncate text-xs text-themed-muted">{{ host.location || '-' }}</p>
                  </div>
                  <span class="flex-shrink-0 rounded-full px-2 py-1 text-xs font-medium" :class="hostBadgeClass(host)">
                    {{ host.isCurrent ? t('instanceConfig.changeHost.current') : reasonLabel(host.unavailableReason) }}
                  </span>
                </div>

                <div class="space-y-3">
                  <div>
                    <div class="mb-1 flex items-center justify-between text-xs">
                      <span class="text-themed-muted">CPU</span>
                      <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                        {{ host.resources.cpuAvailable }}% / {{ host.resources.cpuAllowanceMax }}%
                      </span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                      <div class="h-full rounded-full bg-blue-500" :style="{ width: `${usagePercent(host.resources.cpuUsed, host.resources.cpuAllowanceMax)}%` }"></div>
                    </div>
                  </div>

                  <div>
                    <div class="mb-1 flex items-center justify-between text-xs">
                      <span class="text-themed-muted">{{ t('instanceConfig.changeHost.memory') }}</span>
                      <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                        {{ formatMemory(host.resources.memoryAvailable) }} / {{ formatMemory(host.resources.memoryMax) }}
                      </span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                      <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${usagePercent(host.resources.memoryUsed, host.resources.memoryMax)}%` }"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div class="flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/80' : 'border-gray-100 bg-gray-50'">
            <button class="btn-secondary" :disabled="submitting" @click="closeModal">
              {{ t('common.cancel') }}
            </button>
            <button class="btn-primary" :disabled="!canSubmit" @click="submit">
              <span v-if="submitting" class="loading-spinner h-4 w-4"></span>
              <span>{{ submitting ? t('common.processing') : t('instanceConfig.changeHost.confirm') }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
