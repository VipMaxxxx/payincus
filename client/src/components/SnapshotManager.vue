<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { formatDate } from '@/utils/formatters'
import type { Snapshot, SnapshotPolicy, CreateSnapshotRequest, UpdateSnapshotPolicyRequest } from '@/types/api'

const { t } = useI18n()

interface Props {
  instanceId: string | number
  instanceName?: string
  instanceStatus?: string
  snapshotLimit?: number | null
}

const props = withDefaults(defineProps<Props>(), {
  instanceName: '',
  instanceStatus: '',
  snapshotLimit: null
})

// 配额状态
const hasQuota = computed<boolean>(() => props.snapshotLimit !== null && props.snapshotLimit !== undefined)
const quotaUsed = computed<number>(() => snapshots.value.length)
const quotaRemaining = computed<number>(() => hasQuota.value ? Math.max(0, (props.snapshotLimit || 0) - quotaUsed.value) : 0)
const isQuotaFull = computed<boolean>(() => hasQuota.value && quotaRemaining.value <= 0)

const toast = useToast()
const themeStore = useThemeStore()

// 快照列表
const snapshots = ref<Snapshot[]>([])
const loading = ref<boolean>(true)

// 创建快照弹窗
const showCreateModal = ref<boolean>(false)
interface CreateForm {
  name: string
  description: string
}
const createForm = ref<CreateForm>({ name: '', description: '' })
const createLoading = ref<boolean>(false)

// 自动快照策略
const policy = ref<SnapshotPolicy | null>(null)
const showPolicyModal = ref<boolean>(false)
const policyForm = ref<UpdateSnapshotPolicyRequest>({ enabled: false, intervalMinutes: 360 })
const policyLoading = ref<boolean>(false)



const canRestore = computed<boolean>(() => {
  const s = props.instanceStatus?.toLowerCase()
  return s === 'stopped'
})

onMounted(async () => {
  await Promise.all([loadSnapshots(), loadPolicy()])
})

const instanceIdNum = computed<number>(() => Number(props.instanceId))

async function loadSnapshots(): Promise<void> {
  loading.value = true
  try {
    const res = await api.instances.getSnapshots(instanceIdNum.value)
    snapshots.value = Array.isArray(res) ? res : []
  } catch (err) {
    console.error('Failed to load snapshots:', err)
  } finally {
    loading.value = false
  }
}

async function loadPolicy(): Promise<void> {
  try {
    const res = await api.instances.getSnapshotPolicy(instanceIdNum.value)
    policy.value = res
    if (res) {
      policyForm.value = {
        enabled: res.enabled === 1,
        intervalMinutes: res.interval_minutes
      }
    }
  } catch (err) {
    console.error('Failed to load policy:', err)
  }
}

async function createSnapshot(): Promise<void> {
  if (!createForm.value.name) return
  
  createLoading.value = true
  try {
    const payload: CreateSnapshotRequest = {
      name: createForm.value.name,
      description: createForm.value.description || undefined
    }
    await api.instances.createSnapshot(instanceIdNum.value, payload)
    toast.success(t('snapshot.messages.createSuccess'))
    showCreateModal.value = false
    createForm.value = { name: '', description: '' }
    await loadSnapshots()
  } catch (err: any) {
    toast.error(t('snapshot.messages.createFailed') + ': ' + (err?.message || String(err)))
  } finally {
    createLoading.value = false
  }
}

async function deleteSnapshot(snapshot: Snapshot): Promise<void> {
  if (!confirm(t('snapshot.messages.deleteConfirm', { name: snapshot.name }))) return
  
  try {
    await api.instances.deleteSnapshot(instanceIdNum.value, snapshot.id)
    snapshots.value = snapshots.value.filter(s => s.id !== snapshot.id)
    toast.success(t('snapshot.messages.deleteSuccess'))
  } catch (err: any) {
    toast.error(t('snapshot.messages.deleteFailed') + ': ' + (err?.message || String(err)))
    await loadSnapshots()
  }
}


async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  if (!canRestore.value) {
    toast.warning(t('snapshot.messages.stopInstanceFirst'))
    return
  }
  
  if (!confirm(t('snapshot.messages.restoreConfirm', { name: snapshot.name }))) return
  
  try {
    await api.instances.restoreSnapshot(instanceIdNum.value, snapshot.id)
    toast.success(t('snapshot.messages.restoreSuccess'))
  } catch (err: any) {
    toast.error(t('snapshot.messages.restoreFailed') + ': ' + (err?.message || String(err)))
  }
}

async function savePolicy(): Promise<void> {
  policyLoading.value = true
  try {
    await api.instances.updateSnapshotPolicy(instanceIdNum.value, policyForm.value)
    toast.success(t('snapshot.messages.policySaved'))
    showPolicyModal.value = false
    await loadPolicy()
  } catch (err: any) {
    toast.error(t('snapshot.messages.policySaveFailed') + ': ' + (err?.message || String(err)))
  } finally {
    policyLoading.value = false
  }
}

// 取消自动快照策略
async function disableAutoPolicy(): Promise<void> {
  policyLoading.value = true
  try {
    await api.instances.updateSnapshotPolicy(instanceIdNum.value, { enabled: false, intervalMinutes: policyForm.value.intervalMinutes })
    toast.success(t('snapshot.messages.policyDisabled'))
    await loadPolicy()
  } catch (err: any) {
    toast.error(t('snapshot.messages.policySaveFailed') + ': ' + (err?.message || String(err)))
  } finally {
    policyLoading.value = false
  }
}

// 获取间隔时间的显示文本
function getIntervalLabel(minutes: number): string {
  const intervalMap: Record<number, string> = {
    10: t('snapshot.policyModal.intervalOptions.min10'),
    60: t('snapshot.policyModal.intervalOptions.hour1'),
    360: t('snapshot.policyModal.intervalOptions.hour6'),
    1440: t('snapshot.policyModal.intervalOptions.hour24')
  }
  return intervalMap[minutes] || `${minutes} ${t('snapshot.minutes')}`
}
</script>

<template>
  <div class="card">
    <div 
      class="flex items-center justify-between p-4 border-b"
      :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
    >
      <div>
        <h2 
          class="text-sm font-medium"
          :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
        >
          {{ t('snapshot.title') }}
        </h2>
        <p 
          class="text-xs mt-0.5"
          :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
        >
          {{ policy?.enabled ? t('snapshot.autoPolicy') : t('snapshot.manual') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="hasQuota" class="text-xs text-themed-muted">
          {{ quotaUsed }}/{{ snapshotLimit }}
        </span>
        <button class="btn-ghost btn-sm" :title="t('snapshot.autoSettings')" @click="showPolicyModal = true">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <button 
          :disabled="!hasQuota || isQuotaFull" 
          :class="['btn-ghost btn-sm', (!hasQuota || isQuotaFull) && 'opacity-50 cursor-not-allowed']"
          :title="!hasQuota ? t('snapshot.noQuota') : isQuotaFull ? t('snapshot.quotaFull') : t('snapshot.createSnapshot')"
          @click="showCreateModal = true"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('snapshot.create') }}
        </button>
      </div>
    </div>

    <!-- 自动快照策略提醒横幅 -->
    <div 
      v-if="policy?.enabled" 
      class="mx-4 mt-4 p-3 rounded-lg flex items-center justify-between gap-3"
      :class="themeStore.isDark ? 'bg-green-500/10 border border-green-500/20' : 'bg-green-50 border border-green-200'"
    >
      <div class="flex items-center gap-3">
        <div 
          class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          :class="themeStore.isDark ? 'bg-green-500/20' : 'bg-green-100'"
        >
          <svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-green-400' : 'text-green-700'">
            {{ t('snapshot.autoPolicyEnabled') }}
          </p>
          <p class="text-xs" :class="themeStore.isDark ? 'text-green-500/70' : 'text-green-600'">
            {{ t('snapshot.currentPolicy') }}: {{ getIntervalLabel(policy.interval_minutes) }}
          </p>
        </div>
      </div>
      <button 
        class="btn-ghost btn-sm flex-shrink-0"
        :class="themeStore.isDark ? 'text-green-400 hover:bg-green-500/20' : 'text-green-600 hover:bg-green-100'"
        :disabled="policyLoading"
        @click="disableAutoPolicy"
      >
        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
        {{ t('snapshot.disableAutoPolicy') }}
      </button>
    </div>

    <div v-if="loading" class="p-4 animate-pulse">
      <div v-for="i in 2" :key="i" class="flex items-center gap-3 py-3">
        <div 
          class="w-8 h-8 rounded"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div class="flex-1 space-y-2">
          <div 
            class="h-3 rounded w-1/3"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
          ></div>
          <div 
            class="h-2 rounded w-1/4"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-200/50'"
          ></div>
        </div>
      </div>
    </div>

    <div 
      v-else-if="snapshots.length === 0" 
      class="p-8 text-center text-sm"
      :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
    >
      <svg 
        class="w-10 h-10 mx-auto mb-2 opacity-50" 
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <template v-if="!hasQuota">
        <p class="text-yellow-500 mb-1">{{ t('snapshot.noQuotaAllocated') }}</p>
        <p class="text-xs">{{ t('snapshot.allocateQuotaHint') }}</p>
      </template>
      <template v-else>
        {{ t('snapshot.noSnapshots') }}
      </template>
    </div>

    <div 
      v-else 
      class="divide-y"
      :class="themeStore.isDark ? 'divide-gray-800' : 'divide-gray-100'"
    >
      <div 
        v-for="snapshot in snapshots" 
        :key="snapshot.id"
        class="flex items-center justify-between p-4 transition-colors"
        :class="themeStore.isDark ? 'hover:bg-gray-900/50' : 'hover:bg-gray-50'"
      >
        <div class="flex items-center gap-3">
          <div 
            class="w-8 h-8 rounded-lg flex items-center justify-center"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
          >
            <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <div 
              class="text-sm"
              :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
            >
              {{ snapshot.name }}
            </div>
            <div 
              class="text-xs"
              :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
            >
              {{ formatDate(snapshot.created_at) }}
              <span v-if="snapshot.stateful" class="ml-2 text-yellow-500">{{ t('snapshot.statefulSnapshot') }}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button 
            :disabled="!canRestore" 
            :class="['btn-ghost btn-sm', !canRestore && 'opacity-50 cursor-not-allowed']"
            :title="canRestore ? t('snapshot.restore') : t('snapshot.stopInstanceFirst')"
            @click="restoreSnapshot(snapshot)"
          >
            {{ t('snapshot.restore') }}
          </button>
          <button class="btn-ghost btn-sm text-error" @click="deleteSnapshot(snapshot)">
            {{ t('snapshot.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 创建快照弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCreateModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showCreateModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('snapshot.createModal.title') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showCreateModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" @submit.prevent="createSnapshot">
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('snapshot.createModal.name') }} <span class="text-error">{{ t('snapshot.createModal.nameRequired') }}</span></label>
                <input v-model="createForm.name" type="text" class="input" :placeholder="t('snapshot.createModal.namePlaceholder')" required />
              </div>
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('snapshot.createModal.description') }}</label>
                <input v-model="createForm.description" type="text" class="input" :placeholder="t('snapshot.createModal.descriptionPlaceholder')" />
              </div>
            </form>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showCreateModal = false">{{ t('snapshot.createModal.cancel') }}</button>
              <button :disabled="createLoading || !createForm.name" class="btn-primary" @click="createSnapshot">
                {{ createLoading ? t('snapshot.createModal.creating') : t('snapshot.createModal.create') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 自动快照策略弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showPolicyModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showPolicyModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('snapshot.policyModal.title') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showPolicyModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" @submit.prevent="savePolicy">
              <label class="flex items-center gap-2 cursor-pointer">
                <input 
                  v-model="policyForm.enabled" 
                  type="checkbox" 
                  class="w-4 h-4 rounded"
                  :class="themeStore.isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'"
                />
                <span class="text-sm text-themed">{{ t('snapshot.policyModal.enable') }}</span>
              </label>
            
              <div v-if="policyForm.enabled" class="space-y-4 pt-2">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('snapshot.policyModal.interval') }}</label>
                  <select v-model="policyForm.intervalMinutes" class="input">
                    <option :value="10">{{ t('snapshot.policyModal.intervalOptions.min10') }}</option>
                    <option :value="60">{{ t('snapshot.policyModal.intervalOptions.hour1') }}</option>
                    <option :value="360">{{ t('snapshot.policyModal.intervalOptions.hour6') }}</option>
                    <option :value="1440">{{ t('snapshot.policyModal.intervalOptions.hour24') }}</option>
                  </select>
                </div>
                <p class="text-xs text-themed-muted">
                  {{ t('snapshot.policyModal.quotaFromPackage', { limit: snapshotLimit || 0 }) }}
                </p>
              </div>
            </form>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showPolicyModal = false">{{ t('snapshot.policyModal.cancel') }}</button>
              <button :disabled="policyLoading" class="btn-primary" @click="savePolicy">
                {{ policyLoading ? t('snapshot.policyModal.saving') : t('snapshot.policyModal.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

