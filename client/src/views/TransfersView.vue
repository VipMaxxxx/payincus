<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import FlagIcon from '@/components/FlagIcon.vue'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

// Tab state
type TabType = 'sent' | 'received'
const activeTab = ref<TabType>('sent')

// Data
interface TransferSnapshot {
  packageId?: number | null
  packageName?: string | null
  hostId?: number | null
  hostName?: string | null
  hostLocation?: string | null
  hostCountryCode?: string | null
  originalName?: string | null
  cpu?: number
  memory?: number
  disk?: number
  networkMode?: string | null
  portMappingsCount?: number
  snapshotsCount?: number
  backupsCount?: number
  ipv4?: string | null
  ipv6?: string | null
}

interface Transfer {
  id: number
  instanceId: number
  instanceName: string
  instanceStatus: string
  instanceImage: string
  fromUser: { id: number; username: string; email?: string | null; avatarStyle?: string; avatarBadgeId?: string | null } | null
  toUser: { id: number; username: string; email?: string | null; avatarStyle?: string; avatarBadgeId?: string | null } | null
  status: string
  snapshot: TransferSnapshot | null
  remark: string | null
  rejectReason: string | null
  createdAt: string
  acceptedAt: string | null
  rejectedAt: string | null
  cancelledAt: string | null
  canPush?: boolean
}

const transfers = ref<Transfer[]>([])
const loading = ref(true)      // 首次加载
const refreshing = ref(false)  // 后台刷新（不显示骨架屏）
const pendingCount = ref(0)

// Search
const searchQuery = ref('')

// Pagination
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const totalPages = computed(() => Math.ceil(total.value / pageSize.value))

// Reject modal
const showRejectModal = ref(false)
const rejectingTransferId = ref<number | null>(null)
const rejectReason = ref('')
const rejectLoading = ref(false)

// Action loading
const actionLoading = ref<number | null>(null)
const pushLoading = ref<number | null>(null)

// 配置详情弹窗
const showConfigModal = ref(false)
const selectedTransfer = ref<Transfer | null>(null)

// 备注展开状态
const expandedRemarks = ref<Set<number>>(new Set())

onMounted(async () => {
  await Promise.all([loadTransfers(), loadPendingCount()])
})

async function loadTransfers(silent = false) {
  if (!silent) loading.value = true
  else refreshing.value = true
  try {
    const response = await api.transfers.list(activeTab.value, {
      page: page.value,
      pageSize: pageSize.value,
      search: searchQuery.value.trim() || undefined
    })
    transfers.value = response.transfers
    total.value = response.total
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function loadPendingCount() {
  try {
    const response = await api.transfers.getPendingCount()
    pendingCount.value = response.count
  } catch (error) {
    console.error('Failed to load pending count:', error)
  }
}

async function switchTab(tab: TabType) {
  activeTab.value = tab
  page.value = 1
  // 使用静默刷新，避免 Tab 切换时内容闪烁
  await loadTransfers(true)
}

let searchTimeout: ReturnType<typeof setTimeout> | null = null

function handleSearch() {
  page.value = 1
  // 清除之前的定时器
  if (searchTimeout) {
    clearTimeout(searchTimeout)
    searchTimeout = null
  }
  // 防抖：延迟300ms执行搜索
  searchTimeout = setTimeout(() => {
    loadTransfers(true)
    searchTimeout = null
  }, 300)
}

function clearSearch() {
  searchQuery.value = ''
  page.value = 1
  if (searchTimeout) {
    clearTimeout(searchTimeout)
    searchTimeout = null
  }
  loadTransfers(true)
}

function handleSearchEnter() {
  if (searchTimeout) {
    clearTimeout(searchTimeout)
    searchTimeout = null
  }
  page.value = 1
  loadTransfers(true)
}

// 监听搜索框变化，自动触发搜索
watch(searchQuery, () => {
  handleSearch()
})

async function handleAccept(transfer: Transfer) {
  if (!confirm(t('transfer.actions.accept') + '?')) return
  
  actionLoading.value = transfer.id
  try {
    await api.transfers.accept(transfer.id)
    toast.success(t('transfer.messages.acceptSuccess'))
    await Promise.all([loadTransfers(true), loadPendingCount()])
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    actionLoading.value = null
  }
}

function openRejectModal(transfer: Transfer) {
  rejectingTransferId.value = transfer.id
  rejectReason.value = ''
  showRejectModal.value = true
}

async function handleReject() {
  if (!rejectingTransferId.value) return
  
  rejectLoading.value = true
  try {
    await api.transfers.reject(rejectingTransferId.value, rejectReason.value || undefined)
    toast.success(t('transfer.messages.rejectSuccess'))
    showRejectModal.value = false
    await Promise.all([loadTransfers(true), loadPendingCount()])
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    rejectLoading.value = false
  }
}

async function handleCancel(transfer: Transfer) {
  if (!confirm(t('transfer.actions.cancel') + '?')) return
  
  actionLoading.value = transfer.id
  try {
    await api.transfers.cancel(transfer.id)
    toast.success(t('transfer.messages.cancelSuccess'))
    await loadTransfers(true)
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    actionLoading.value = null
  }
}

async function handlePush(transfer: Transfer) {
  if (!confirm(t('transfer.actions.push') + '?')) return
  
  pushLoading.value = transfer.id
  try {
    await api.transfers.push(transfer.id)
    toast.success(t('transfer.messages.pushSuccess'))
    await Promise.all([loadTransfers(true), loadPendingCount()])
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    pushLoading.value = null
  }
}

function getStatusClass(status: string) {
  switch (status) {
    case 'pending': return 'badge-warning'
    case 'processing': return 'badge-info'
    case 'accepted': return 'badge-success'
    case 'rejected': return 'badge-error'
    case 'cancelled': return 'badge-default'
    default: return 'badge-default'
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

function formatMemory(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

function formatDisk(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

// 打开配置详情弹窗
function openConfigModal(transfer: Transfer) {
  selectedTransfer.value = transfer
  showConfigModal.value = true
}

// 切换备注展开状态
function toggleRemark(transferId: number) {
  if (expandedRemarks.value.has(transferId)) {
    expandedRemarks.value.delete(transferId)
  } else {
    expandedRemarks.value.add(transferId)
  }
}

// 获取网络模式显示文本
function getNetworkModeText(mode: string | null | undefined) {
  if (!mode) return '-'
  return mode === 'nat' ? 'NAT' : (mode === 'routed' ? t('instance.networkMode.routed') : mode)
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <!-- Header -->
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ $t('transfer.title') }}</h1>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
      <div 
        class="flex gap-1 p-1 rounded-lg w-full sm:w-fit"
        :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-100'"
      >
        <button 
          :class="[
            'flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm font-medium rounded-md transition-colors',
            activeTab === 'sent' 
              ? (themeStore.isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900 shadow-sm')
              : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900')
          ]"
          @click="switchTab('sent')"
        >
          {{ $t('transfer.sentTab') }}
        </button>
        <button 
          :class="[
            'relative flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm font-medium rounded-md transition-colors',
            activeTab === 'received' 
              ? (themeStore.isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900 shadow-sm')
              : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900')
          ]"
          @click="switchTab('received')"
        >
          {{ $t('transfer.receivedTab') }}
          <span 
            v-if="pendingCount > 0"
            class="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-xs font-bold text-white bg-red-500 rounded-full"
          >
            {{ pendingCount > 9 ? '9+' : pendingCount }}
          </span>
        </button>
      </div>

      <!-- Search -->
      <div class="flex-1 max-w-md w-full sm:w-auto">
        <div class="relative">
          <input
            v-model="searchQuery"
            type="text"
            class="input w-full pl-10 pr-10"
            :placeholder="$t('transfer.searchPlaceholder')"
            @keyup.enter="handleSearchEnter"
          />
          <svg 
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'"
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <button
            v-if="searchQuery"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="clearSearch"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading">
      <SkeletonLoader type="table" />
    </div>

    <!-- Transfer List -->
    <div v-else-if="transfers.length > 0" class="card overflow-x-auto">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[900px]">
          <thead :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
            <tr>
              <th class="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">{{ $t('transfer.detail.instance') }}</th>
              <th class="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">
                {{ activeTab === 'sent' ? $t('transfer.detail.toUser') : $t('transfer.detail.fromUser') }}
              </th>
              <th class="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">{{ $t('transfer.detail.snapshot') }}</th>
              <th class="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">{{ $t('transfer.modal.remark') }}</th>
              <th class="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">{{ $t('common.status') }}</th>
              <th class="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">{{ $t('common.createdAt') }}</th>
              <th class="px-4 py-3 text-right text-sm font-medium whitespace-nowrap">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y" :class="themeStore.isDark ? 'divide-gray-800' : 'divide-gray-100'">
            <tr 
              v-for="transfer in transfers" 
              :key="transfer.id"
              :class="themeStore.isDark ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'"
            >
              <!-- 实例列：名称 + ID -->
              <td class="px-4 py-3 whitespace-nowrap">
                <div class="font-medium">{{ transfer.instanceName }}</div>
                <div class="text-xs font-mono" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                  ID: {{ transfer.instanceId }}
                </div>
              </td>
              <!-- 发起方/接收方 -->
              <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex items-center gap-2">
                  <UserAvatar 
                    :username="activeTab === 'sent' ? (transfer.toUser?.username || '') : (transfer.fromUser?.username || '')" 
                    :email="activeTab === 'sent' ? (transfer.toUser?.email || null) : (transfer.fromUser?.email || null)"
                    :avatar-style="activeTab === 'sent' ? (transfer.toUser?.avatarStyle || 'bigSmile') : (transfer.fromUser?.avatarStyle || 'bigSmile')"
                    :badge-id="activeTab === 'sent' ? (transfer.toUser?.avatarBadgeId || null) : (transfer.fromUser?.avatarBadgeId || null)"
                    :size="28"
                  />
                  <span>{{ activeTab === 'sent' ? transfer.toUser?.username : transfer.fromUser?.username }}</span>
                </div>
              </td>
              <!-- 转移时配置：可点击查看详情 -->
              <td class="px-4 py-3 text-sm whitespace-nowrap">
                <button
                  v-if="transfer.snapshot"
                  class="flex items-center gap-2 hover:underline transition-colors"
                  :class="themeStore.isDark ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'"
                  @click="openConfigModal(transfer)"
                >
                  <FlagIcon :code="transfer.snapshot.hostCountryCode || 'us'" size="xs" />
                  <span>{{ (transfer.snapshot.hostName || '-').toUpperCase() }}</span>
                  <svg class="w-3.5 h-3.5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                <span v-else class="text-gray-400">-</span>
              </td>
              <!-- 备注：可展开 -->
              <td class="px-4 py-3 text-sm">
                <template v-if="transfer.remark">
                  <div v-if="!expandedRemarks.has(transfer.id)" class="flex items-center gap-1">
                    <span class="text-gray-500">{{ $t('transfer.hasRemark') }}</span>
                    <button 
                      class="text-xs hover:underline"
                      :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'"
                      @click="toggleRemark(transfer.id)"
                    >
                      {{ $t('common.expand') }}
                    </button>
                  </div>
                  <div v-else class="max-w-xs">
                    <div class="break-words" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                      {{ transfer.remark }}
                    </div>
                    <button 
                      class="text-xs hover:underline mt-1"
                      :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'"
                      @click="toggleRemark(transfer.id)"
                    >
                      {{ $t('common.collapse') }}
                    </button>
                  </div>
                </template>
                <span v-else class="text-gray-400">-</span>
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <span :class="['badge whitespace-nowrap', getStatusClass(transfer.status)]">
                  {{ $t(`transfer.status.${transfer.status}`) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                {{ formatDate(transfer.createdAt) }}
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <div class="flex items-center justify-end gap-2">
                  <!-- Sent tab actions -->
                  <template v-if="activeTab === 'sent'">
                    <template v-if="transfer.status === 'pending'">
                      <!-- 直接推送按钮（仅当发起方是宿主机所有者时显示） -->
                      <button
                        v-if="transfer.canPush"
                        class="btn-secondary"
                        :disabled="pushLoading === transfer.id || actionLoading === transfer.id"
                        @click="handlePush(transfer)"
                      >
                        {{ pushLoading === transfer.id ? $t('common.processing') : $t('transfer.actions.push') }}
                      </button>
                      <button
                        class="btn-ghost text-red-500 hover:text-red-600"
                        :disabled="actionLoading === transfer.id || pushLoading === transfer.id"
                        @click="handleCancel(transfer)"
                      >
                        {{ $t('transfer.actions.cancel') }}
                      </button>
                    </template>
                    <div v-else-if="transfer.status === 'accepted'" class="text-sm text-gray-500">
                      {{ $t('transfer.completedAt') }}: {{ formatDate(transfer.acceptedAt) }}
                    </div>
                    <div v-else-if="transfer.status === 'rejected'" class="text-sm text-gray-500 text-right max-w-xs">
                      <div>{{ $t('transfer.rejectedAt') }}: {{ formatDate(transfer.rejectedAt) }}</div>
                      <div v-if="transfer.rejectReason" class="text-xs text-gray-400 mt-1 truncate" :title="transfer.rejectReason">
                        {{ transfer.rejectReason }}
                      </div>
                    </div>
                    <div v-else-if="transfer.status === 'cancelled'" class="text-sm text-gray-500">
                      {{ $t('transfer.cancelledAt') }}: {{ formatDate(transfer.cancelledAt) }}
                    </div>
                  </template>
                  <!-- Received tab actions -->
                  <template v-else>
                    <template v-if="transfer.status === 'pending'">
                      <button
                        class="btn-secondary"
                        :disabled="actionLoading === transfer.id"
                        @click="handleAccept(transfer)"
                      >
                        {{ $t('transfer.actions.accept') }}
                      </button>
                      <button
                        class="btn-ghost text-red-500 hover:text-red-600"
                        :disabled="actionLoading === transfer.id"
                        @click="openRejectModal(transfer)"
                      >
                        {{ $t('transfer.actions.reject') }}
                      </button>
                    </template>
                    <div v-else-if="transfer.status === 'accepted'" class="text-sm text-gray-500">
                      {{ $t('transfer.completedAt') }}: {{ formatDate(transfer.acceptedAt) }}
                    </div>
                    <div v-else-if="transfer.status === 'rejected'" class="text-sm text-gray-500 text-right max-w-xs">
                      <div>{{ $t('transfer.rejectedAt') }}: {{ formatDate(transfer.rejectedAt) }}</div>
                      <div v-if="transfer.rejectReason" class="text-xs text-gray-400 mt-1 truncate" :title="transfer.rejectReason">
                        {{ transfer.rejectReason }}
                      </div>
                    </div>
                    <div v-else-if="transfer.status === 'cancelled'" class="text-sm text-gray-500">
                      {{ $t('transfer.cancelledAt') }}: {{ formatDate(transfer.cancelledAt) }}
                    </div>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Pagination -->
        <div 
          v-if="totalPages > 1"
          class="flex items-center justify-between px-4 py-3 border-t"
          :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'"
        >
          <div class="text-sm text-gray-500">
            {{ total }} {{ $t('common.total') }}
          </div>
          <div class="flex gap-2">
            <button
              class="btn-ghost"
              :disabled="page <= 1 || refreshing"
              @click="page--; loadTransfers(true)"
            >
              {{ $t('instance.prevPage') }}
            </button>
            <button
              class="btn-ghost"
              :disabled="page >= totalPages || refreshing"
              @click="page++; loadTransfers(true)"
            >
              {{ $t('instance.nextPage') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="!loading && transfers.length === 0" class="card p-8 text-center">
      <div class="text-gray-500">
        {{ activeTab === 'sent' ? $t('transfer.noTransfers') : $t('transfer.noPendingTransfers') }}
      </div>
    </div>

    <!-- Reject Modal -->
    <div 
      v-if="showRejectModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showRejectModal = false"
    >
      <div 
        class="w-full max-w-md p-6 rounded-lg shadow-xl"
        :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
      >
        <h3 class="text-lg font-medium mb-4">{{ $t('transfer.rejectModal.title') }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('transfer.rejectModal.reason') }}</label>
            <textarea
              v-model="rejectReason"
              class="input w-full h-24 resize-none"
              :placeholder="$t('transfer.rejectModal.reasonPlaceholder')"
            ></textarea>
          </div>
          <div class="flex justify-end gap-2">
            <button class="btn-ghost" @click="showRejectModal = false">
              {{ $t('common.cancel') }}
            </button>
            <button 
              class="btn-danger"
              :disabled="rejectLoading"
              @click="handleReject"
            >
              {{ rejectLoading ? $t('common.loading') : $t('transfer.actions.reject') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Config Detail Modal -->
    <div 
      v-if="showConfigModal && selectedTransfer"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showConfigModal = false"
    >
      <div 
        class="w-full max-w-lg p-6 rounded-lg shadow-xl"
        :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
      >
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-medium">{{ $t('transfer.configModal.title') }}</h3>
          <button 
            class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            @click="showConfigModal = false"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div class="space-y-4">
          <!-- 实例信息 -->
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-gray-500 mb-1">{{ $t('transfer.configModal.instanceName') }}</div>
              <div class="font-medium">{{ selectedTransfer.snapshot?.originalName || selectedTransfer.instanceName }}</div>
            </div>
            <div>
              <div class="text-gray-500 mb-1">{{ $t('instance.detail.info.instanceId') }}</div>
              <div class="font-mono">{{ selectedTransfer.instanceId }}</div>
            </div>
          </div>

          <!-- 宿主机信息 -->
          <div 
            class="p-3 rounded-lg"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
          >
            <div class="text-sm font-medium mb-2">{{ $t('transfer.configModal.hostInfo') }}</div>
            <div class="flex items-center gap-2">
              <FlagIcon :code="selectedTransfer.snapshot?.hostCountryCode || 'us'" size="sm" />
              <span class="font-medium">{{ (selectedTransfer.snapshot?.hostName || '-').toUpperCase() }}</span>
              <span v-if="selectedTransfer.snapshot?.hostLocation" class="text-gray-500">
                ({{ selectedTransfer.snapshot.hostLocation }})
              </span>
            </div>
          </div>

          <!-- 配置信息 -->
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-gray-500 mb-1">CPU</div>
              <div>{{ selectedTransfer.snapshot?.cpu ?? '-' }}%</div>
            </div>
            <div>
              <div class="text-gray-500 mb-1">{{ $t('instance.detail.info.memory') }}</div>
              <div>{{ selectedTransfer.snapshot?.memory ? formatMemory(selectedTransfer.snapshot.memory) : '-' }}</div>
            </div>
            <div>
              <div class="text-gray-500 mb-1">{{ $t('instance.detail.info.disk') }}</div>
              <div>{{ selectedTransfer.snapshot?.disk ? formatDisk(selectedTransfer.snapshot.disk) : '-' }}</div>
            </div>
            <div>
              <div class="text-gray-500 mb-1">{{ $t('transfer.configModal.networkMode') }}</div>
              <div>{{ getNetworkModeText(selectedTransfer.snapshot?.networkMode) }}</div>
            </div>
          </div>

          <!-- 网络信息 -->
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-gray-500 mb-1">IPv4</div>
              <div class="font-mono text-xs">{{ selectedTransfer.snapshot?.ipv4 || '-' }}</div>
            </div>
            <div>
              <div class="text-gray-500 mb-1">IPv6</div>
              <div class="font-mono text-xs truncate" :title="selectedTransfer.snapshot?.ipv6 || ''">
                {{ selectedTransfer.snapshot?.ipv6 || '-' }}
              </div>
            </div>
          </div>

          <!-- 套餐信息 -->
          <div v-if="selectedTransfer.snapshot?.packageName" class="text-sm">
            <div class="text-gray-500 mb-1">{{ $t('transfer.configModal.package') }}</div>
            <div>{{ selectedTransfer.snapshot.packageName }}</div>
          </div>
        </div>

        <div class="mt-6 flex justify-end">
          <button class="btn-ghost" @click="showConfigModal = false">
            {{ $t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
