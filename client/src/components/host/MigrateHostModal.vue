<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import type { SystemImage } from '@/types/api'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const authStore = useAuthStore()

interface InstanceInfo {
  id: number
  name: string
  packagePlanId?: number | null
}

interface Props {
  visible: boolean
  hostId: number
  hostName?: string
  selectedIds: number[]
  instances?: InstanceInfo[]  // 实例信息，用于判断是否有付费实例
}

interface Host {
  id: number
  name: string
  status: string
  location?: string | null
  countryCode?: string
  instanceCount?: number
}

interface Plan {
  id: number
  name: string
  packageId: number
  packageName: string
  price: number
  billingCycle: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'success'): void
}>()

// 目标节点列表
const hosts = ref<Host[]>([])
const loadingHosts = ref(false)

// 目标节点的方案列表
const plans = ref<Plan[]>([])
const loadingPlans = ref(false)

// 目标系统镜像列表
const images = ref<SystemImage[]>([])
const loadingImages = ref(false)

// 选中的目标节点
const targetHostId = ref<number | null>(null)

// 选中的目标系统
const targetImage = ref<string>('')

// 选中的目标方案（付费实例必选）
const targetPlanId = ref<number | null>(null)

// 提交状态
const isSubmitting = ref(false)

// 结果状态
const showResult = ref(false)
const result = ref<{
  success: boolean
  message: string
  successCount: number
  failedCount: number
  results: Array<{ id: number; name: string; success: boolean; error?: string }>
} | null>(null)

// 计算可选节点（排除当前节点，只显示在线节点）
const availableHosts = computed(() => {
  return hosts.value.filter(h => h.id !== props.hostId && h.status === 'online')
})

// 计算是否有付费实例需要迁移
const hasPaidInstances = computed(() => {
  if (!props.instances) return false
  const selectedInstances = props.instances.filter(i => props.selectedIds.includes(i.id))
  return selectedInstances.some(i => i.packagePlanId !== null && i.packagePlanId !== undefined)
})

// 是否可以提交
const canSubmit = computed(() => {
  if (!targetHostId.value) return false
  if (!targetImage.value) return false
  if (hasPaidInstances.value && !targetPlanId.value) return false
  return true
})

// 加载节点列表
async function loadHosts() {
  loadingHosts.value = true
  try {
    // 管理员只加载官方自营节点；非管理员只加载自己的节点
    const params: any = { pageSize: 200 }
    if (authStore.isAdmin) {
      params.scope = 'official'
    } else {
      params.mine = 'true'
    }
    const res = await api.hosts.list(params) as any
    hosts.value = res.hosts || res.items || []
  } catch (err: any) {
    toast.error(t('host.migrate.loadHostsFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingHosts.value = false
  }
}

// 加载目标节点的方案列表
async function loadPlans(hostId: number) {
  loadingPlans.value = true
  plans.value = []
  targetPlanId.value = null
  try {
    const res = await api.hosts.getHostPlans(hostId)
    plans.value = res.plans || []
  } catch (err: any) {
    toast.error(t('host.migrate.loadPlansFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingPlans.value = false
  }
}

// 加载目标节点可用的系统镜像
async function loadImages(hostId: number) {
  loadingImages.value = true
  images.value = []
  targetImage.value = ''
  try {
    const res = await api.images.getSystemImages(undefined, undefined, hostId)
    images.value = res.images || []
    targetImage.value = images.value[0]?.remoteAlias || ''
  } catch (err: any) {
    toast.error(t('host.migrate.loadImagesFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingImages.value = false
  }
}

// 提交迁移
async function handleSubmit() {
  if (!targetHostId.value) {
    toast.error(t('host.migrate.selectTargetRequired'))
    return
  }

  if (!targetImage.value) {
    toast.error(t('host.migrate.selectImageRequired'))
    return
  }

  if (hasPaidInstances.value && !targetPlanId.value) {
    toast.error(t('host.migrate.selectPlanRequired'))
    return
  }

  if (props.selectedIds.length === 0) {
    toast.error(t('host.migrate.noInstancesSelected'))
    return
  }

  isSubmitting.value = true
  try {
    const res = await api.hosts.migrateInstances(
      props.hostId,
      props.selectedIds,
      targetHostId.value,
      targetImage.value,
      hasPaidInstances.value ? targetPlanId.value ?? undefined : undefined
    )
    result.value = {
      success: res.failedCount === 0,
      message: res.message,
      successCount: res.successCount,
      failedCount: res.failedCount,
      results: res.results
    }
    showResult.value = true

    if (res.successCount > 0) {
      emit('success')
    }
  } catch (err: any) {
    toast.error(t('host.migrate.failed') + ': ' + (err?.message || String(err)))
  } finally {
    isSubmitting.value = false
  }
}

// 关闭弹窗
function closeModal() {
  emit('update:visible', false)
  // 重置状态
  setTimeout(() => {
    showResult.value = false
    result.value = null
    targetHostId.value = null
    targetImage.value = ''
    targetPlanId.value = null
    plans.value = []
    images.value = []
  }, 300)
}

// 监听目标节点变化，加载方案列表
watch(targetHostId, (newHostId) => {
  if (newHostId) {
    loadImages(newHostId)
  } else {
    images.value = []
    targetImage.value = ''
  }

  if (newHostId && hasPaidInstances.value) {
    loadPlans(newHostId)
  } else {
    plans.value = []
    targetPlanId.value = null
  }
})

// 监听显示状态，显示时加载节点列表
watch(() => props.visible, (val) => {
  if (val) {
    loadHosts()
    showResult.value = false
    result.value = null
    targetHostId.value = null
    targetImage.value = ''
    targetPlanId.value = null
    plans.value = []
    images.value = []
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay">
        <div class="modal-backdrop" @click="closeModal"></div>
        <div class="modal-content max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <!-- 标题栏 -->
          <div class="modal-header">
            <h3 class="modal-title">{{ t('host.migrate.title') }}</h3>
            <button class="text-themed-muted hover:text-themed" :disabled="isSubmitting" @click="closeModal">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 内容区域 -->
          <div class="modal-body overflow-y-auto flex-1">
            <!-- 结果显示 -->
            <template v-if="showResult && result">
              <div class="text-center py-4">
                <div
                  v-if="result.failedCount === 0"
                  class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                  :class="themeStore.isDark ? 'bg-green-900/30' : 'bg-green-100'"
                >
                  <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div
                  v-else
                  class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                  :class="themeStore.isDark ? 'bg-yellow-900/30' : 'bg-yellow-100'"
                >
                  <svg class="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p class="text-lg font-medium text-themed mb-2">{{ result.message }}</p>
                <p class="text-sm text-themed-secondary">
                  {{ t('host.migrate.resultSummary', { success: result.successCount, failed: result.failedCount }) }}
                </p>

                <!-- 失败详情 -->
                <div
                  v-if="result.failedCount > 0"
                  class="mt-4 text-left rounded-lg p-3 max-h-40 overflow-y-auto"
                  :class="themeStore.isDark ? 'bg-red-900/20' : 'bg-red-50'"
                >
                  <p class="text-sm font-medium text-red-500 mb-2">{{ t('host.migrate.failedInstances') }}:</p>
                  <ul class="text-xs space-y-1">
                    <li
                      v-for="item in result.results.filter(r => !r.success)"
                      :key="item.id"
                      class="text-themed-secondary"
                    >
                      <span class="font-mono">{{ item.name }}</span>: {{ item.error }}
                    </li>
                  </ul>
                </div>
              </div>
            </template>

            <!-- 表单 -->
            <template v-else>
              <!-- 已选实例数量 -->
              <div
                class="flex items-center gap-2 p-3 rounded-lg"
                :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
              >
                <svg class="w-5 h-5 text-themed-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span class="text-sm text-themed">
                  {{ t('host.migrate.selectedCount', { count: selectedIds.length }) }}
                </span>
              </div>

              <!-- 目标节点选择 -->
              <div>
                <label class="block text-sm font-medium text-themed-secondary mb-2">
                  {{ t('host.migrate.targetNode') }}
                </label>
                <select
                  v-model="targetHostId"
                  class="input w-full"
                  :disabled="loadingHosts"
                >
                  <option :value="null" disabled>{{ t('host.migrate.selectTarget') }}</option>
                  <option
                    v-for="host in availableHosts"
                    :key="host.id"
                    :value="host.id"
                  >
                    {{ host.name }}{{ host.location ? ` (${host.location})` : '' }}
                    - {{ host.instanceCount || 0 }} {{ t('host.migrate.instances') }}
                  </option>
                </select>
                <p v-if="loadingHosts" class="text-xs text-themed-muted mt-1">
                  {{ t('common.loading') }}...
                </p>
              </div>

              <!-- 目标系统选择 -->
              <div v-if="targetHostId">
                <label class="block text-sm font-medium text-themed-secondary mb-2">
                  {{ t('host.migrate.targetImage') }} <span class="text-red-500">*</span>
                </label>
                <select
                  v-model="targetImage"
                  class="input w-full"
                  :disabled="loadingImages || images.length === 0"
                >
                  <option value="" disabled>{{ t('host.migrate.selectImage') }}</option>
                  <option
                    v-for="image in images"
                    :key="image.id"
                    :value="image.remoteAlias"
                  >
                    {{ image.name }} ({{ image.remoteAlias }})
                  </option>
                </select>
                <div v-if="targetImage" class="mt-2 flex items-center gap-2 text-xs text-themed-muted">
                  <DistroIcon
                    :distro="images.find(image => image.remoteAlias === targetImage)?.icon || targetImage"
                    :size="16"
                    class="flex-shrink-0"
                  />
                  <span>{{ t('host.migrate.imageHint') }}</span>
                </div>
                <p v-if="loadingImages" class="text-xs text-themed-muted mt-1">
                  {{ t('common.loading') }}...
                </p>
                <p v-else-if="images.length === 0" class="text-xs text-red-500 mt-1">
                  {{ t('host.migrate.noImageAvailable') }}
                </p>
              </div>

              <!-- 目标方案选择（付费实例必选） -->
              <div v-if="hasPaidInstances && targetHostId">
                <label class="block text-sm font-medium text-themed-secondary mb-2">
                  {{ t('host.migrate.targetPlan') }} <span class="text-red-500">*</span>
                </label>
                <select
                  v-model="targetPlanId"
                  class="input w-full"
                  :disabled="loadingPlans || plans.length === 0"
                >
                  <option :value="null" disabled>{{ t('host.migrate.selectPlan') }}</option>
                  <option
                    v-for="plan in plans"
                    :key="plan.id"
                    :value="plan.id"
                  >
                    {{ plan.packageName }} - {{ plan.name }} (¥{{ (plan.price / 100).toFixed(2) }}/{{ plan.billingCycle }}{{ t('common.month') }})
                  </option>
                </select>
                <p v-if="loadingPlans" class="text-xs text-themed-muted mt-1">
                  {{ t('common.loading') }}...
                </p>
                <p v-else-if="plans.length === 0" class="text-xs text-red-500 mt-1">
                  {{ t('host.migrate.noPlanAvailable') }}
                </p>
                <p v-else class="text-xs text-themed-muted mt-1">
                  {{ t('host.migrate.planHint') }}
                </p>
              </div>

              <!-- 警告提示 -->
              <div
                class="flex items-start gap-2 p-3 rounded-lg"
                :class="themeStore.isDark ? 'bg-yellow-900/20' : 'bg-yellow-50'"
              >
                <svg class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div class="text-sm text-themed-secondary">
                  <p class="font-medium text-yellow-600 dark:text-yellow-400 mb-1">
                    {{ t('host.migrate.warning') }}
                  </p>
                  <ul class="list-disc list-inside space-y-0.5 text-xs">
                    <li>{{ t('host.migrate.warningCloudInit') }}</li>
                    <li>{{ t('host.migrate.warningImage') }}</li>
                    <li>{{ t('host.migrate.warningIp') }}</li>
                    <li>{{ t('host.migrate.warningNotify') }}</li>
                  </ul>
                </div>
              </div>
            </template>
          </div>

          <!-- 底部按钮 -->
          <div class="modal-footer">
            <template v-if="showResult">
              <button class="btn-secondary" @click="closeModal">
                {{ t('common.close') }}
              </button>
            </template>
            <template v-else>
              <button class="btn-secondary" :disabled="isSubmitting" @click="closeModal">
                {{ t('common.cancel') }}
              </button>
              <button
                class="btn-primary"
                :disabled="!canSubmit || isSubmitting || loadingHosts || loadingPlans || loadingImages"
                @click="handleSubmit"
              >
                <svg v-if="isSubmitting" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ isSubmitting ? t('host.migrate.migrating') : t('host.migrate.confirm') }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 使用全局 modal 过渡动画，无需额外样式 */
</style>
