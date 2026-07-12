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
  <div class="kawaii-page space-y-6 animate-fade-in">
    <!-- Header -->
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ $t('transfer.title') }}</h1>
      </div>
    </div>

    <!-- Tabs + Search -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <!-- In-page underline tabs -->
      <div class="nimbus-tabs border-b border-themed">
        <button
          class="nimbus-tab"
          :class="activeTab === 'sent'
            ? 'text-primary-600 dark:text-primary-400 border-primary-500'
            : 'text-themed-muted border-transparent hover:text-themed'"
          @click="switchTab('sent')"
        >
          {{ $t('transfer.sentTab') }}
        </button>
        <button
          class="nimbus-tab"
          :class="activeTab === 'received'
            ? 'text-primary-600 dark:text-primary-400 border-primary-500'
            : 'text-themed-muted border-transparent hover:text-themed'"
          @click="switchTab('received')"
        >
          {{ $t('transfer.receivedTab') }}
          <span
            v-if="pendingCount > 0"
            class="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-500 px-1.5 text-[11px] font-semibold tabular-nums text-white"
          >
            {{ pendingCount > 9 ? '9+' : pendingCount }}
          </span>
        </button>
      </div>

      <!-- Search -->
      <div class="w-full sm:w-72">
        <div class="relative">
          <input
            v-model="searchQuery"
            type="text"
            class="input w-full rounded-lg border-themed pl-10 pr-10"
            :placeholder="$t('transfer.searchPlaceholder')"
            @keyup.enter="handleSearchEnter"
          />
          <svg
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-themed-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <button
            v-if="searchQuery"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-themed-muted transition-colors hover:text-themed"
            @click="clearSearch"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    <template v-else-if="transfers.length > 0">
      <div class="space-y-3 lg:hidden">
        <div
          v-for="transfer in transfers"
          :key="transfer.id"
          class="nimbus-lift rounded-xl border border-themed bg-themed-surface p-4 shadow-sm"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-themed">{{ transfer.instanceName }}</div>
              <div class="mt-1 text-xs font-mono text-themed-muted tabular-nums">ID: {{ transfer.instanceId }}</div>
            </div>
            <span :class="['badge shrink-0 whitespace-nowrap', getStatusClass(transfer.status)]">
              {{ $t(`transfer.status.${transfer.status}`) }}
            </span>
          </div>

          <div class="mt-4 flex items-center gap-2">
            <UserAvatar
              :username="activeTab === 'sent' ? (transfer.toUser?.username || '') : (transfer.fromUser?.username || '')"
              :email="activeTab === 'sent' ? (transfer.toUser?.email || null) : (transfer.fromUser?.email || null)"
              :avatar-style="activeTab === 'sent' ? (transfer.toUser?.avatarStyle || 'bigSmile') : (transfer.fromUser?.avatarStyle || 'bigSmile')"
              :badge-id="activeTab === 'sent' ? (transfer.toUser?.avatarBadgeId || null) : (transfer.fromUser?.avatarBadgeId || null)"
              :size="28"
            />
            <div class="min-w-0">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">
                {{ activeTab === 'sent' ? $t('transfer.detail.toUser') : $t('transfer.detail.fromUser') }}
              </div>
              <div class="truncate text-sm text-themed">
                {{ activeTab === 'sent' ? transfer.toUser?.username : transfer.fromUser?.username }}
              </div>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
            <button
              v-if="transfer.snapshot"
              type="button"
              class="rounded-lg bg-themed-secondary px-3 py-2 text-left"
              @click="openConfigModal(transfer)"
            >
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ $t('transfer.detail.snapshot') }}</div>
              <div class="mt-1 flex min-w-0 items-center gap-2 font-medium text-themed">
                <FlagIcon :code="transfer.snapshot.hostCountryCode || 'us'" size="xs" />
                <span class="truncate">{{ (transfer.snapshot.hostName || '-').toUpperCase() }}</span>
              </div>
            </button>
            <div v-else class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ $t('transfer.detail.snapshot') }}</div>
              <div class="mt-1 text-themed-muted">-</div>
            </div>

            <div class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ $t('common.createdAt') }}</div>
              <div class="mt-1 text-xs text-themed">{{ formatDate(transfer.createdAt) }}</div>
            </div>
          </div>

          <div v-if="transfer.remark" class="mt-3 rounded-lg bg-themed-secondary px-3 py-2 text-sm">
            <div class="mb-1 text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ $t('transfer.modal.remark') }}</div>
            <div v-if="!expandedRemarks.has(transfer.id)" class="flex items-center gap-2">
              <span class="text-themed-muted">{{ $t('transfer.hasRemark') }}</span>
              <button
                type="button"
                class="text-xs text-themed-secondary hover:underline"
                @click="toggleRemark(transfer.id)"
              >
                {{ $t('common.expand') }}
              </button>
            </div>
            <div v-else>
              <div class="break-words text-themed">{{ transfer.remark }}</div>
              <button
                type="button"
                class="mt-1 text-xs text-themed-secondary hover:underline"
                @click="toggleRemark(transfer.id)"
              >
                {{ $t('common.collapse') }}
              </button>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
            <template v-if="activeTab === 'sent'">
              <template v-if="transfer.status === 'pending'">
                <button
                  v-if="transfer.canPush"
                  type="button"
                  class="btn btn-sm btn-secondary"
                  :disabled="pushLoading === transfer.id || actionLoading === transfer.id"
                  @click="handlePush(transfer)"
                >
                  {{ pushLoading === transfer.id ? $t('common.processing') : $t('transfer.actions.push') }}
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost text-rose-600 hover:text-rose-700 dark:text-rose-400"
                  :disabled="actionLoading === transfer.id || pushLoading === transfer.id"
                  @click="handleCancel(transfer)"
                >
                  {{ $t('transfer.actions.cancel') }}
                </button>
              </template>
              <div v-else-if="transfer.status === 'accepted'" class="text-sm text-themed-muted">
                {{ $t('transfer.completedAt') }}: {{ formatDate(transfer.acceptedAt) }}
              </div>
              <div v-else-if="transfer.status === 'rejected'" class="min-w-0 text-right text-sm text-themed-muted">
                <div>{{ $t('transfer.rejectedAt') }}: {{ formatDate(transfer.rejectedAt) }}</div>
                <div v-if="transfer.rejectReason" class="mt-1 truncate text-xs text-themed-muted" :title="transfer.rejectReason">
                  {{ transfer.rejectReason }}
                </div>
              </div>
              <div v-else-if="transfer.status === 'cancelled'" class="text-sm text-themed-muted">
                {{ $t('transfer.cancelledAt') }}: {{ formatDate(transfer.cancelledAt) }}
              </div>
            </template>
            <template v-else>
              <template v-if="transfer.status === 'pending'">
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  :disabled="actionLoading === transfer.id"
                  @click="handleAccept(transfer)"
                >
                  {{ $t('transfer.actions.accept') }}
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost text-rose-600 hover:text-rose-700 dark:text-rose-400"
                  :disabled="actionLoading === transfer.id"
                  @click="openRejectModal(transfer)"
                >
                  {{ $t('transfer.actions.reject') }}
                </button>
              </template>
              <div v-else-if="transfer.status === 'accepted'" class="text-sm text-themed-muted">
                {{ $t('transfer.completedAt') }}: {{ formatDate(transfer.acceptedAt) }}
              </div>
              <div v-else-if="transfer.status === 'rejected'" class="min-w-0 text-right text-sm text-themed-muted">
                <div>{{ $t('transfer.rejectedAt') }}: {{ formatDate(transfer.rejectedAt) }}</div>
                <div v-if="transfer.rejectReason" class="mt-1 truncate text-xs text-themed-muted" :title="transfer.rejectReason">
                  {{ transfer.rejectReason }}
                </div>
              </div>
              <div v-else-if="transfer.status === 'cancelled'" class="text-sm text-themed-muted">
                {{ $t('transfer.cancelledAt') }}: {{ formatDate(transfer.cancelledAt) }}
              </div>
            </template>
          </div>
        </div>

        <div
          v-if="totalPages > 1"
          class="flex items-center justify-between rounded-lg border border-themed bg-themed-surface px-4 py-3"
        >
          <div class="text-sm text-themed-muted">
            {{ total }} {{ $t('common.total') }}
          </div>
          <div class="flex gap-2">
            <button
              class="btn btn-sm btn-ghost"
              :disabled="page <= 1 || refreshing"
              @click="page--; loadTransfers(true)"
            >
              {{ $t('instance.prevPage') }}
            </button>
            <button
              class="btn btn-sm btn-ghost"
              :disabled="page >= totalPages || refreshing"
              @click="page++; loadTransfers(true)"
            >
              {{ $t('instance.nextPage') }}
            </button>
          </div>
        </div>
      </div>

      <div class="card hidden overflow-hidden lg:block">
        <table class="w-full table-fixed">
          <thead :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted whitespace-nowrap">{{ $t('transfer.detail.instance') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted whitespace-nowrap">
                {{ activeTab === 'sent' ? $t('transfer.detail.toUser') : $t('transfer.detail.fromUser') }}
              </th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted whitespace-nowrap">{{ $t('transfer.detail.snapshot') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted whitespace-nowrap">{{ $t('transfer.modal.remark') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted whitespace-nowrap">{{ $t('common.status') }}</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted whitespace-nowrap">{{ $t('common.createdAt') }}</th>
              <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-themed-muted whitespace-nowrap">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y" :class="themeStore.isDark ? 'divide-gray-800' : 'divide-gray-100'">
            <tr
              v-for="transfer in transfers"
              :key="transfer.id"
              class="transition-colors hover:bg-themed-hover"
            >
              <!-- 实例列：名称 + ID -->
              <td class="px-4 py-3">
                <div class="truncate font-medium" :title="transfer.instanceName">{{ transfer.instanceName }}</div>
                <div class="truncate text-xs font-mono text-themed-muted tabular-nums" :title="String(transfer.instanceId)">
                  ID: {{ transfer.instanceId }}
                </div>
              </td>
              <!-- 发起方/接收方 -->
              <td class="px-4 py-3">
                <div class="flex min-w-0 items-center gap-2">
                  <UserAvatar 
                    :username="activeTab === 'sent' ? (transfer.toUser?.username || '') : (transfer.fromUser?.username || '')" 
                    :email="activeTab === 'sent' ? (transfer.toUser?.email || null) : (transfer.fromUser?.email || null)"
                    :avatar-style="activeTab === 'sent' ? (transfer.toUser?.avatarStyle || 'bigSmile') : (transfer.fromUser?.avatarStyle || 'bigSmile')"
                    :badge-id="activeTab === 'sent' ? (transfer.toUser?.avatarBadgeId || null) : (transfer.fromUser?.avatarBadgeId || null)"
                    :size="28"
                  />
                  <span class="min-w-0 truncate" :title="activeTab === 'sent' ? transfer.toUser?.username : transfer.fromUser?.username">
                    {{ activeTab === 'sent' ? transfer.toUser?.username : transfer.fromUser?.username }}
                  </span>
                </div>
              </td>
              <!-- 转移时配置：可点击查看详情 -->
              <td class="px-4 py-3 text-sm">
                <button
                  v-if="transfer.snapshot"
                  class="flex min-w-0 items-center gap-2 font-medium text-themed-secondary transition-colors hover:text-primary-600 dark:hover:text-primary-400"
                  @click="openConfigModal(transfer)"
                >
                  <FlagIcon :code="transfer.snapshot.hostCountryCode || 'us'" size="xs" />
                  <span class="truncate" :title="(transfer.snapshot.hostName || '-').toUpperCase()">
                    {{ (transfer.snapshot.hostName || '-').toUpperCase() }}
                  </span>
                  <svg class="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                <span v-else class="text-themed-muted">-</span>
              </td>
              <!-- 备注：可展开 -->
              <td class="px-4 py-3 text-sm">
                <template v-if="transfer.remark">
                  <div v-if="!expandedRemarks.has(transfer.id)" class="flex items-center gap-1">
                    <span class="text-themed-muted">{{ $t('transfer.hasRemark') }}</span>
                    <button
                      class="text-xs text-themed-secondary hover:underline"
                      @click="toggleRemark(transfer.id)"
                    >
                      {{ $t('common.expand') }}
                    </button>
                  </div>
                  <div v-else class="max-w-full">
                    <div class="break-words text-themed">
                      {{ transfer.remark }}
                    </div>
                    <button
                      class="mt-1 text-xs text-themed-secondary hover:underline"
                      @click="toggleRemark(transfer.id)"
                    >
                      {{ $t('common.collapse') }}
                    </button>
                  </div>
                </template>
                <span v-else class="text-themed-muted">-</span>
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <span :class="['badge whitespace-nowrap', getStatusClass(transfer.status)]">
                  {{ $t(`transfer.status.${transfer.status}`) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-themed-muted whitespace-nowrap tabular-nums">
                {{ formatDate(transfer.createdAt) }}
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <div class="flex flex-wrap items-center justify-end gap-2">
                  <!-- Sent tab actions -->
                  <template v-if="activeTab === 'sent'">
                    <template v-if="transfer.status === 'pending'">
                      <!-- 直接推送按钮（仅当发起方是宿主机所有者时显示） -->
                      <button
                        v-if="transfer.canPush"
                        class="btn btn-sm btn-secondary"
                        :disabled="pushLoading === transfer.id || actionLoading === transfer.id"
                        @click="handlePush(transfer)"
                      >
                        {{ pushLoading === transfer.id ? $t('common.processing') : $t('transfer.actions.push') }}
                      </button>
                      <button
                        class="btn btn-sm btn-ghost text-rose-600 hover:text-rose-700 dark:text-rose-400"
                        :disabled="actionLoading === transfer.id || pushLoading === transfer.id"
                        @click="handleCancel(transfer)"
                      >
                        {{ $t('transfer.actions.cancel') }}
                      </button>
                    </template>
                    <div v-else-if="transfer.status === 'accepted'" class="text-sm text-themed-muted tabular-nums">
                      {{ $t('transfer.completedAt') }}: {{ formatDate(transfer.acceptedAt) }}
                    </div>
                    <div v-else-if="transfer.status === 'rejected'" class="text-sm text-themed-muted text-right max-w-xs tabular-nums">
                      <div>{{ $t('transfer.rejectedAt') }}: {{ formatDate(transfer.rejectedAt) }}</div>
                      <div v-if="transfer.rejectReason" class="text-xs text-themed-muted mt-1 truncate" :title="transfer.rejectReason">
                        {{ transfer.rejectReason }}
                      </div>
                    </div>
                    <div v-else-if="transfer.status === 'cancelled'" class="text-sm text-themed-muted tabular-nums">
                      {{ $t('transfer.cancelledAt') }}: {{ formatDate(transfer.cancelledAt) }}
                    </div>
                  </template>
                  <!-- Received tab actions -->
                  <template v-else>
                    <template v-if="transfer.status === 'pending'">
                      <button
                        class="btn btn-sm btn-primary"
                        :disabled="actionLoading === transfer.id"
                        @click="handleAccept(transfer)"
                      >
                        {{ $t('transfer.actions.accept') }}
                      </button>
                      <button
                        class="btn btn-sm btn-ghost text-rose-600 hover:text-rose-700 dark:text-rose-400"
                        :disabled="actionLoading === transfer.id"
                        @click="openRejectModal(transfer)"
                      >
                        {{ $t('transfer.actions.reject') }}
                      </button>
                    </template>
                    <div v-else-if="transfer.status === 'accepted'" class="text-sm text-themed-muted tabular-nums">
                      {{ $t('transfer.completedAt') }}: {{ formatDate(transfer.acceptedAt) }}
                    </div>
                    <div v-else-if="transfer.status === 'rejected'" class="text-sm text-themed-muted text-right max-w-xs tabular-nums">
                      <div>{{ $t('transfer.rejectedAt') }}: {{ formatDate(transfer.rejectedAt) }}</div>
                      <div v-if="transfer.rejectReason" class="text-xs text-themed-muted mt-1 truncate" :title="transfer.rejectReason">
                        {{ transfer.rejectReason }}
                      </div>
                    </div>
                    <div v-else-if="transfer.status === 'cancelled'" class="text-sm text-themed-muted tabular-nums">
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
          <div class="text-sm text-themed-muted tabular-nums">
            {{ total }} {{ $t('common.total') }}
          </div>
          <div class="flex gap-2">
            <button
              class="btn btn-sm btn-ghost"
              :disabled="page <= 1 || refreshing"
              @click="page--; loadTransfers(true)"
            >
              {{ $t('instance.prevPage') }}
            </button>
            <button
              class="btn btn-sm btn-ghost"
              :disabled="page >= totalPages || refreshing"
              @click="page++; loadTransfers(true)"
            >
              {{ $t('instance.nextPage') }}
            </button>
          </div>
      </div>
    </div>
    </template>

    <!-- Empty State -->
    <div v-else-if="!loading && transfers.length === 0" class="card flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-themed-secondary text-themed-muted">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m4 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      </div>
      <div class="text-sm text-themed-muted">
        {{ activeTab === 'sent' ? $t('transfer.noTransfers') : $t('transfer.noPendingTransfers') }}
      </div>
    </div>

    <!-- Reject Modal -->
    <div
      v-if="showRejectModal"
      class="modal-overlay bg-black/50 backdrop-blur-sm"
      @click.self="showRejectModal = false"
    >
      <div class="modal-content max-w-md">
        <div class="modal-header">
          <h3 class="modal-title">{{ $t('transfer.rejectModal.title') }}</h3>
          <button class="btn btn-sm btn-ghost" @click="showRejectModal = false">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div>
            <label class="mb-1 block text-sm font-medium text-themed">{{ $t('transfer.rejectModal.reason') }}</label>
            <textarea
              v-model="rejectReason"
              class="input h-24 w-full resize-none"
              :placeholder="$t('transfer.rejectModal.reasonPlaceholder')"
            ></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showRejectModal = false">
            {{ $t('common.cancel') }}
          </button>
          <button
            class="btn btn-danger"
            :disabled="rejectLoading"
            @click="handleReject"
          >
            {{ rejectLoading ? $t('common.loading') : $t('transfer.actions.reject') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Config Detail Modal -->
    <div
      v-if="showConfigModal && selectedTransfer"
      class="modal-overlay bg-black/50 backdrop-blur-sm"
      @click.self="showConfigModal = false"
    >
      <div class="modal-content max-w-lg">
        <div class="modal-header">
          <h3 class="modal-title">{{ $t('transfer.configModal.title') }}</h3>
          <button class="btn btn-sm btn-ghost" @click="showConfigModal = false">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- 实例信息 -->
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="mb-1 text-xs font-medium uppercase tracking-wide text-themed-muted">{{ $t('transfer.configModal.instanceName') }}</div>
              <div class="font-medium text-themed">{{ selectedTransfer.snapshot?.originalName || selectedTransfer.instanceName }}</div>
            </div>
            <div>
              <div class="mb-1 text-xs font-medium uppercase tracking-wide text-themed-muted">{{ $t('instance.detail.info.instanceId') }}</div>
              <div class="font-mono text-themed">{{ selectedTransfer.instanceId }}</div>
            </div>
          </div>

          <!-- 宿主机信息 -->
          <div class="rounded-lg border border-themed bg-themed-secondary p-3">
            <div class="mb-2 text-xs font-medium uppercase tracking-wide text-themed-muted">{{ $t('transfer.configModal.hostInfo') }}</div>
            <div class="flex items-center gap-2">
              <FlagIcon :code="selectedTransfer.snapshot?.hostCountryCode || 'us'" size="sm" />
              <span class="font-medium text-themed">{{ (selectedTransfer.snapshot?.hostName || '-').toUpperCase() }}</span>
              <span v-if="selectedTransfer.snapshot?.hostLocation" class="text-themed-muted">
                ({{ selectedTransfer.snapshot.hostLocation }})
              </span>
            </div>
          </div>

          <!-- 配置信息 -->
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="mb-1 text-xs font-medium uppercase tracking-wide text-themed-muted">CPU</div>
              <div class="font-mono text-themed">{{ selectedTransfer.snapshot?.cpu ?? '-' }}%</div>
            </div>
            <div>
              <div class="mb-1 text-xs font-medium uppercase tracking-wide text-themed-muted">{{ $t('instance.detail.info.memory') }}</div>
              <div class="font-mono text-themed">{{ selectedTransfer.snapshot?.memory ? formatMemory(selectedTransfer.snapshot.memory) : '-' }}</div>
            </div>
            <div>
              <div class="mb-1 text-xs font-medium uppercase tracking-wide text-themed-muted">{{ $t('instance.detail.info.disk') }}</div>
              <div class="font-mono text-themed">{{ selectedTransfer.snapshot?.disk ? formatDisk(selectedTransfer.snapshot.disk) : '-' }}</div>
            </div>
            <div>
              <div class="mb-1 text-xs font-medium uppercase tracking-wide text-themed-muted">{{ $t('transfer.configModal.networkMode') }}</div>
              <div class="text-themed">{{ getNetworkModeText(selectedTransfer.snapshot?.networkMode) }}</div>
            </div>
          </div>

          <!-- 网络信息 -->
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="mb-1 text-xs font-medium uppercase tracking-wide text-themed-muted">IPv4</div>
              <div class="font-mono text-xs text-themed">{{ selectedTransfer.snapshot?.ipv4 || '-' }}</div>
            </div>
            <div>
              <div class="mb-1 text-xs font-medium uppercase tracking-wide text-themed-muted">IPv6</div>
              <div class="truncate font-mono text-xs text-themed" :title="selectedTransfer.snapshot?.ipv6 || ''">
                {{ selectedTransfer.snapshot?.ipv6 || '-' }}
              </div>
            </div>
          </div>

          <!-- 套餐信息 -->
          <div v-if="selectedTransfer.snapshot?.packageName" class="text-sm">
            <div class="mb-1 text-xs font-medium uppercase tracking-wide text-themed-muted">{{ $t('transfer.configModal.package') }}</div>
            <div class="text-themed">{{ selectedTransfer.snapshot.packageName }}</div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showConfigModal = false">
            {{ $t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Nimbus in-page tabs: indigo underline with smooth colour/underline transition */
.nimbus-tabs {
  display: flex;
  gap: 1.5rem;
}

.nimbus-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-bottom: -1px;
  padding: 0.625rem 0.125rem;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  border-bottom-width: 2px;
  border-bottom-style: solid;
  transition: color 0.15s ease, border-color 0.15s ease;
}

/* Subtle lift on interactive cards */
.nimbus-lift {
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.nimbus-lift:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -8px rgba(15, 23, 42, 0.28);
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-tab,
  .nimbus-lift,
  .nimbus-lift:hover {
    transform: none;
    transition: none;
  }
}
</style>
