<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import HostInfoTab from '@/components/host/HostInfoTab.vue'
import HostImagesTab from '@/components/host/HostImagesTab.vue'
import MyHostConfigTab from '@/components/host/MyHostConfigTab.vue'
import HostInstancesTab from '@/components/host/HostInstancesTab.vue'
import HostStorageTab from '@/components/host/HostStorageTab.vue'
import HostCaddyTab from '@/components/host/HostCaddyTab.vue'
import HostRedeemCodesTab from '@/components/host/HostRedeemCodesTab.vue'
import HostCreateInstanceTab from '@/components/host/HostCreateInstanceTab.vue'
import HostOpsTab from '@/components/host/HostOpsTab.vue'
import FlagIcon from '@/components/FlagIcon.vue'

// 为 KeepAlive exclude 匹配定义组件名称
defineOptions({
  name: 'MyHostDetailView'
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()

// 是否是管理员
const isAdmin = computed(() => authStore.user?.role === 'admin')

type TabType = 'info' | 'config' | 'images' | 'instances' | 'storage' | 'caddy' | 'redeemCodes' | 'ops' | 'create'
const activeTab = ref<TabType>('info')

interface Host {
  id: number
  name: string
  url: string
  location?: string
  countryCode: string
  status: 'online' | 'offline' | 'maintenance'
  instanceCount?: number
  certPath?: string
  keyPath?: string
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  notifyPurchase?: boolean
  notifyRenew?: boolean
  notifyDestroy?: boolean
  resources?: {
    cpuUsed: number
    memoryUsed: number
    diskTotal: number  // 计算值，来自 storage_size * 1024
    diskUsed: number
  }
  natConfig?: {
    publicIp: string | null
    publicIpv6?: string | null
    bindIp?: string | null
    bindIpv6?: string | null
    portRangeStart: number | null
    portRangeEnd: number | null
    portsUsedCount?: number
  }
  createdAt?: string
  updatedAt?: string
}

const host = ref<Host | null>(null)
const loading = ref(true)
const actionLoading = ref('')

// 删除确认弹窗
const showDeleteModal = ref(false)
const deleteConfirmName = ref('')

// 批量延期弹窗（仅管理员）
const showExtendModal = ref(false)
const extendDays = ref<number | undefined>(undefined)
const paidInstanceCount = ref(0)

// 重新安装弹窗
const showReinstallModal = ref(false)
const reinstallCommand = ref('')

const reinstallStatus = ref<'waiting' | 'verifying' | 'success' | 'error'>('waiting')
const reinstallError = ref('')

const statusInfo = computed(() => {
  if (!host.value) return { label: '', class: '', dot: '' }
  const map: Record<string, { label: string; class: string; dot: string }> = {
    online: { label: t('admin.hosts.statusOnline'), class: 'badge-success', dot: 'bg-green-500' },
    offline: { label: t('admin.hosts.statusOffline'), class: 'badge-default', dot: 'bg-gray-500' },
    maintenance: { label: t('admin.hosts.statusMaintenance'), class: 'badge-warning', dot: 'bg-yellow-500' }
  }
  return map[host.value.status] || map.offline
})

onMounted(async () => {
  await loadHost()
})

// 监听路由参数变化，重新加载数据
watch(() => route.params.id, async (newId, oldId) => {
  // 检查是否仍在节点详情页，防止路由切换到其他页面时误触发
  if (route.name !== 'my-host-detail') return
  
  if (newId && newId !== oldId) {
    // 重置所有状态
    loading.value = true
    activeTab.value = 'info'
    host.value = null
    actionLoading.value = ''
    
    // 关闭所有弹窗并重置其状态
    showDeleteModal.value = false
    deleteConfirmName.value = ''
    
    showExtendModal.value = false
    extendDays.value = undefined
    paidInstanceCount.value = 0
    
    showReinstallModal.value = false
    reinstallCommand.value = ''
    reinstallStatus.value = 'waiting'
    reinstallError.value = ''
    
    await loadHost()
  }
})

async function loadHost() {
  const hostId = parseInt(route.params.id as string)
  if (isNaN(hostId) || hostId <= 0) {
    toast.error(t('admin.hosts.invalidId'))
    router.replace('/resources/hosts')
    return
  }

  try {
    const res = await api.hosts.get(hostId)
    host.value = (res as any).host || res
  } catch (err: any) {
    toast.error(t('admin.hosts.loadFailed') + ': ' + (err?.message || String(err)))
    router.replace('/resources/hosts')
  } finally {
    loading.value = false
  }
}

async function testConnection() {
  if (!host.value) return
  actionLoading.value = 'test'
  try {
    const res = await api.hosts.test(host.value.id)
    if (res.success) {
      toast.success(t('admin.hosts.testSuccess'))
    }
    await loadHost()
  } catch (err: any) {
    toast.error(t('admin.hosts.testFailed') + ': ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

// 验证并连接宿主机（用于未完成安装的宿主机）
async function verifyHost() {
  if (!host.value) return
  actionLoading.value = 'verify'
  try {
    const res = await api.hosts.verify(host.value.id)
    if (res.success) {
      toast.success(t('admin.hosts.verifySuccess'))
    }
    await loadHost()
  } catch (err: any) {
    toast.error(t('admin.hosts.verifyFailed') + ': ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

// 是否需要验证（证书路径未配置）
const needsVerification = computed(() => !host.value?.certPath)

async function openDeleteModal() {
  if (!host.value) return
  
  actionLoading.value = 'delete'
  try {
    const res = await api.instances.list({
      hostId: host.value.id,
      pageSize: 1
    })
    const instanceCount = (res as any).total || 0
    
    if (instanceCount > 0) {
      toast.error(t('admin.hosts.hasInstances', { count: instanceCount }))
      return
    }
    
    deleteConfirmName.value = ''
    showDeleteModal.value = true
  } catch (err: any) {
    toast.error(t('admin.hosts.checkFailed') + ': ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

async function confirmDeleteHost() {
  if (!host.value) return
  if (deleteConfirmName.value !== host.value.name) {
    toast.error(t('admin.hosts.deleteNameMismatch'))
    return
  }

  actionLoading.value = 'delete'
  showDeleteModal.value = false
  try {
    await api.hosts.delete(host.value.id)
    toast.success(t('admin.hosts.hostDeleted'))
    router.push('/resources/hosts')
  } catch (err: any) {
    toast.error(t('admin.hosts.deleteFailed') + ': ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

const canDelete = computed(() => {
  return deleteConfirmName.value === host.value?.name
})

function onConfigSaved() {
  loadHost()
}

// 打开批量延期弹窗（仅管理员）
async function openExtendModal() {
  if (!host.value || !isAdmin.value) return
  
  // 查询该节点下付费实例数量
  try {
    const res = await api.admin.getBillingInstances({
      hostId: host.value.id,
      pageSize: 1
    })
    paidInstanceCount.value = (res as any).total || 0
  } catch {
    paidInstanceCount.value = 0
  }
  
  extendDays.value = undefined
  showExtendModal.value = true
}

// 确认批量延期
async function confirmExtendAll() {
  if (!host.value || !extendDays.value || extendDays.value < 1 || extendDays.value > 365) {
    toast.error(t('admin.hosts.extendDaysInvalid'))
    return
  }
  
  actionLoading.value = 'extend'
  showExtendModal.value = false
  try {
    const res = await api.hosts.batchExtendAll(host.value.id, extendDays.value)
    if (res.success) {
      toast.success(t('admin.hosts.extendSuccess', { count: res.extendedCount, days: extendDays.value }))
    } else {
      toast.info(res.message)
    }
  } catch (err: any) {
    toast.error(t('admin.hosts.extendFailed') + ': ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

// 重新安装：生成新的安装命令
async function regenerateInstall() {
  if (!host.value) return
  
  actionLoading.value = 'reinstall'
  try {
    const res = await api.hosts.regenerateInstall(host.value.id)
    reinstallCommand.value = res.installCommand
    reinstallStatus.value = 'waiting'
    reinstallError.value = ''
    showReinstallModal.value = true
  } catch (err: any) {
    toast.error(t('admin.hosts.reinstallFailed') + ': ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

// 重新安装后验证
async function verifyAfterReinstall() {
  if (!host.value) return
  reinstallStatus.value = 'verifying'
  reinstallError.value = ''
  
  try {
    const res = await api.hosts.verify(host.value.id)
    if (res.success) {
      reinstallStatus.value = 'success'
      toast.success(t('admin.hosts.verifySuccess'))
      await loadHost()
    }
  } catch (err: any) {
    reinstallStatus.value = 'error'
    reinstallError.value = err?.message || String(err)
    toast.error(t('admin.hosts.verifyFailed') + ': ' + reinstallError.value)
  }
}

// 复制重新安装命令
function copyReinstallCommand() {
  navigator.clipboard.writeText(reinstallCommand.value)
  toast.success(t('common.copied'))
}



// 关闭重新安装弹窗
function closeReinstallModal() {
  showReinstallModal.value = false
  loadHost()
}

const tabs = [
  { key: 'info', labelKey: 'admin.hosts.tabInfo', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'config', labelKey: 'admin.hosts.tabConfig', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  { key: 'images', labelKey: 'admin.hosts.tabImages', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { key: 'storage', labelKey: 'admin.hosts.tabStorage', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4' },
  { key: 'caddy', labelKey: 'host.caddy.title', icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' },
  { key: 'redeemCodes', labelKey: 'redeemCodes.title', icon: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z' },
  { key: 'instances', labelKey: 'admin.hosts.tabInstances', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { key: 'ops', labelKey: 'admin.hosts.tabOps', icon: 'M5 13l4 4L19 7M12 6v6l4 2' },
  { key: 'create', labelKey: 'admin.hosts.tabCreate', icon: 'M12 4v16m8-8H4' }
]
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div v-if="loading">
      <SkeletonLoader type="detail" />
    </div>

    <template v-else-if="host">
      <!-- Header -->
      <div class="page-header flex-col sm:flex-row gap-4">
        <div class="flex items-center gap-3">
          <RouterLink
            to="/resources/hosts"
            class="transition-colors"
            :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" />
            </svg>
          </RouterLink>
          <div>
            <div class="flex items-center gap-3">
              <FlagIcon v-if="host.countryCode" :code="host.countryCode" size="md" />
              <div :class="['w-2.5 h-2.5 rounded-full', statusInfo.dot]"></div>
              <h1 class="page-title uppercase">{{ host.name }}</h1>
              <span :class="['badge', statusInfo.class]">{{ statusInfo.label }}</span>
            </div>
            <p class="page-description mt-0.5">{{ host.location || host.url }}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <!-- 批量延期按钮（仅管理员可见） -->
          <button
            v-if="isAdmin"
            :disabled="!!actionLoading"
            class="btn-primary btn-sm sm:btn"
            @click="openExtendModal"
          >
            <svg v-if="actionLoading === 'extend'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('admin.hosts.batchExtend') }}</span>
          </button>
          <!-- 重新安装按钮：已安装和离线节点都允许重新生成安装脚本 -->
          <button
            :disabled="!!actionLoading"
            class="btn-secondary btn-sm sm:btn"
            @click="regenerateInstall"
          >
            <svg v-if="actionLoading === 'reinstall'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('admin.hosts.reinstall') }}</span>
          </button>
          <!-- 未验证的宿主机显示验证按钮 -->
          <button
            v-if="needsVerification"
            :disabled="!!actionLoading"
            class="btn-primary btn-sm sm:btn"
            @click="verifyHost"
          >
            <svg v-if="actionLoading === 'verify'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('admin.hosts.verifyAndConnect') }}</span>
          </button>
          <!-- 已验证的宿主机显示测试连接按钮 -->
          <button
            v-else
            :disabled="!!actionLoading"
            class="btn-secondary btn-sm sm:btn"
            @click="testConnection"
          >
            <svg v-if="actionLoading === 'test'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('admin.hosts.test') }}</span>
          </button>
          <button
            :disabled="!!actionLoading"
            class="btn-danger btn-sm sm:btn"
            @click="openDeleteModal"
          >
            <svg v-if="actionLoading === 'delete'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ t('common.delete') }}</span>
          </button>
        </div>
      </div>

      <!-- Tab Navigation -->
      <div class="relative">
        <!-- 滚动容器 -->
        <div
          class="flex gap-1 p-1 rounded-xl overflow-x-auto scrollbar-hide scroll-smooth"
          :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-100'"
        >
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="[
              'flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all whitespace-nowrap shrink-0',
              activeTab === tab.key
                ? (themeStore.isDark ? 'bg-gray-800 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm')
                : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50' : 'text-gray-500 hover:text-gray-900 hover:bg-white/50')
            ]"
            @click="activeTab = tab.key as TabType"
          >
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="tab.icon" />
            </svg>
            <span>{{ t(tab.labelKey) }}</span>
          </button>
        </div>
      </div>

      <!-- Tab Content -->
      <div>
        <HostInfoTab v-if="activeTab === 'info'" :host="host" @refresh="loadHost" />
        <MyHostConfigTab v-if="activeTab === 'config'" :host="host" @saved="onConfigSaved" />
        <HostImagesTab v-if="activeTab === 'images'" :host-id="host.id" :host-name="host.name" />
        <HostStorageTab v-if="activeTab === 'storage'" :host-id="host.id" />
        <HostCaddyTab v-if="activeTab === 'caddy'" :host-id="host.id" />
        <HostRedeemCodesTab v-if="activeTab === 'redeemCodes'" :host-id="host.id" />
        <HostInstancesTab v-if="activeTab === 'instances'" :host-id="host.id" :host-name="host.name" />
        <HostOpsTab v-if="activeTab === 'ops'" :host-id="host.id" :host-name="host.name" />
        <HostCreateInstanceTab v-if="activeTab === 'create'" :host-id="host.id" :host-name="host.name" :instance-type="host.instanceType" />
      </div>

      <!-- 批量延期弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showExtendModal" class="modal-overlay">
            <div class="modal-backdrop" @click="showExtendModal = false"></div>
            <div class="modal-content max-w-md">
              <div class="modal-header">
                <h3 class="modal-title">{{ t('admin.hosts.batchExtend') }}</h3>
                <button class="text-themed-muted hover:text-themed" @click="showExtendModal = false">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-blue-500/10' : 'bg-blue-50'">
                  <p class="text-sm" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'">
                    {{ t('admin.hosts.extendHint', { count: paidInstanceCount }) }}
                  </p>
                </div>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.extendDaysLabel') }}</label>
                  <input
                    v-model.number="extendDays"
                    type="number"
                    min="1"
                    max="365"
                    class="input"
                    :placeholder="t('admin.hosts.extendDaysPlaceholder')"
                  />
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" @click="showExtendModal = false">{{ t('common.cancel') }}</button>
                <button
                  class="btn-primary"
                  :disabled="!extendDays || extendDays < 1 || extendDays > 365"
                  @click="confirmExtendAll"
                >
                  {{ t('admin.hosts.confirmExtendBtn') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 删除确认弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showDeleteModal" class="modal-overlay">
            <div class="modal-backdrop" @click="showDeleteModal = false"></div>
            <div class="modal-content max-w-md">
              <div class="modal-header">
                <h3 class="modal-title text-error">{{ t('admin.hosts.deleteHost') }}</h3>
                <button class="text-themed-muted hover:text-themed" @click="showDeleteModal = false">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-red-500/10' : 'bg-red-50'">
                  <p class="text-sm text-error">{{ t('admin.hosts.deleteWarning') }}</p>
                </div>
                <p class="text-sm text-themed-secondary">
                  {{ t('admin.hosts.deleteConfirmHint', { name: host.name }) }}
                </p>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.enterHostName') }}</label>
                  <input
                    v-model="deleteConfirmName"
                    type="text"
                    class="input"
                    :placeholder="host.name"
                    autocomplete="off"
                  />
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" @click="showDeleteModal = false">{{ t('common.cancel') }}</button>
                <button
                  class="btn-danger"
                  :disabled="!canDelete"
                  @click="confirmDeleteHost"
                >
                  {{ t('admin.hosts.confirmDeleteBtn') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 重新安装弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showReinstallModal" class="modal-overlay">
            <div class="modal-backdrop" @click="closeReinstallModal"></div>
            <div class="modal-content" style="max-width: 72rem; width: 95%;">
              <div class="modal-header">
                <h3 class="modal-title">{{ t('admin.hosts.reinstallScript') }}</h3>
                <button class="text-themed-muted hover:text-themed" @click="closeReinstallModal">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body space-y-4">
                <!-- 步骤 1: 执行安装命令 -->
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <span class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium" :class="reinstallStatus === 'success' ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'">1</span>
                    <span class="text-sm font-medium text-themed">{{ t('admin.hosts.step1RunScript') }}</span>
                  </div>
                  <p class="text-xs text-themed-muted ml-8">{{ t('admin.hosts.runOnHost') }}</p>
                  <div class="bg-gray-900 rounded-lg p-4 ml-8 overflow-x-auto">
                    <code class="text-green-400 text-sm break-all whitespace-pre-wrap font-mono">{{ reinstallCommand }}</code>
                  </div>
                  <div class="ml-8 mb-4">
                    <button class="btn-secondary btn-sm" @click="copyReinstallCommand">{{ t('admin.hosts.copyCommand') }}</button>
                  </div>
                </div>

                <!-- 步骤 2: 验证并连接 -->
                <div class="space-y-2 pt-4 border-t border-themed">
                  <div class="flex items-center gap-2">
                    <span class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium" :class="reinstallStatus === 'success' ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'">2</span>
                    <span class="text-sm font-medium text-themed">{{ t('admin.hosts.step2Verify') }}</span>
                  </div>
                  <p class="text-xs text-themed-muted ml-8">{{ t('admin.hosts.verifyHint') }}</p>
                
                  <!-- 状态显示 -->
                  <div class="ml-8 flex items-center gap-3">
                    <button 
                      class="btn-secondary btn-sm" 
                      :disabled="reinstallStatus === 'verifying' || reinstallStatus === 'success'"
                      @click="verifyAfterReinstall"
                    >
                      <svg v-if="reinstallStatus === 'verifying'" class="w-4 h-4 animate-spin mr-1" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      {{ reinstallStatus === 'verifying' ? t('admin.hosts.verifying') : t('admin.hosts.verifyAndConnect') }}
                    </button>
                  
                    <!-- 成功状态 -->
                    <div v-if="reinstallStatus === 'success'" class="flex items-center gap-2 text-green-500">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      <span class="text-sm">{{ t('admin.hosts.verifySuccess') }}</span>
                    </div>
                  </div>
                
                  <!-- 错误提示 -->
                  <div v-if="reinstallStatus === 'error' && reinstallError" class="ml-8 p-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
                    {{ reinstallError }}
                  </div>
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" @click="closeReinstallModal">{{ t('common.close') }}</button>
                <button v-if="reinstallStatus === 'success'" class="btn-primary" @click="closeReinstallModal">{{ t('common.done') }}</button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>
  </div>
</template>
