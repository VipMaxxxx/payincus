<script setup lang="ts">
import { ref, onMounted, onActivated, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import type { Package } from '@/types/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { translateError } from '@/utils/errorHandler'

// 为 KeepAlive include 匹配定义组件名称（必须在所有 import 之后）
defineOptions({ name: 'FriendsView' })

// 记录是否已经首次加载
let hasInitialLoad = false

// 类型定义
interface Friend {
  id: number  // 好友的用户ID
  friendshipId?: number  // friendship 记录的ID
  friendId?: number  // 好友的用户ID（与 id 相同，为了向后兼容）
  username: string
  email?: string
  avatarStyle: string
  avatarBadgeId?: string | null
  status?: string
  createdAt: string
  acceptedAt?: string | null
  initiatedByMe?: boolean
  hostCount?: number
  instanceCount?: number
}

interface PendingRequest {
  id: number
  userId: number
  username: string
  email?: string
  avatarStyle: string
  avatarBadgeId?: string | null
  remark: string | null
  createdAt: string
}

interface HistoryRecord {
  id: number
  userId: number
  username: string
  email?: string
  avatarStyle: string
  avatarBadgeId?: string | null
  remark: string | null
  status: 'accepted' | 'rejected' | 'removed'
  createdAt: string
  acceptedAt: string | null
  rejectedAt: string | null
  initiatedByMe: boolean  // 是否是我发起的请求
}

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

// 当前激活的 Tab
const activeTab = ref('friends')

// 好友列表
const friends = ref<Friend[]>([])
const friendsLoading = ref(true)

// 好友列表分页（3行 x 3列 = 9条/页）
const friendsPage = ref(1)
const friendsPageSize = 9

// 待处理请求
const pendingRequests = ref<PendingRequest[]>([])
const pendingLoading = ref(true)

// 待处理请求分页（3行 x 3列 = 9条/页）
const pendingPage = ref(1)
const pendingPageSize = 9
const pendingTotalPages = computed(() => Math.max(1, Math.ceil(pendingRequests.value.length / pendingPageSize)))
const paginatedPendingRequests = computed(() => {
  const start = (pendingPage.value - 1) * pendingPageSize
  return pendingRequests.value.slice(start, start + pendingPageSize)
})

// 添加好友弹窗
const showAddFriendModal = ref(false)
const friendUsername = ref('')
const friendRemark = ref('')
const addFriendLoading = ref(false)

// 历史记录
const historyRecords = ref<HistoryRecord[]>([])
const historyLoading = ref(true)
const historyFilter = ref<'all' | 'accepted' | 'rejected' | 'removed'>('all')

// 历史记录分页（10条/页）
const historyPage = ref(1)
const historyPageSize = 10
const historySearch = ref('')

// 搜索和筛选后的历史记录
const filteredHistoryRecords = computed(() => {
  if (!historySearch.value.trim()) return historyRecords.value
  const keyword = historySearch.value.toLowerCase()
  return historyRecords.value.filter(r =>
    r.username.toLowerCase().includes(keyword) ||
    (r.email && r.email.toLowerCase().includes(keyword)) ||
    (r.remark && r.remark.toLowerCase().includes(keyword))
  )
})

const historyTotalPages = computed(() => Math.max(1, Math.ceil(filteredHistoryRecords.value.length / historyPageSize)))
const paginatedHistoryRecords = computed(() => {
  const start = (historyPage.value - 1) * historyPageSize
  return filteredHistoryRecords.value.slice(start, start + historyPageSize)
})

// 好友列表搜索
const friendsSearch = ref('')
const filteredFriends = computed(() => {
  if (!friendsSearch.value.trim()) return friends.value
  const keyword = friendsSearch.value.toLowerCase()
  return friends.value.filter(f =>
    f.username.toLowerCase().includes(keyword) ||
    (f.email && f.email.toLowerCase().includes(keyword))
  )
})

const filteredFriendsTotalPages = computed(() => Math.max(1, Math.ceil(filteredFriends.value.length / friendsPageSize)))
const paginatedFilteredFriends = computed(() => {
  const start = (friendsPage.value - 1) * friendsPageSize
  return filteredFriends.value.slice(start, start + friendsPageSize)
})

// 待处理数量
const pendingCount = computed(() => pendingRequests.value.length)

// ========== 套餐共享相关 ==========
interface PackageShare {
  id: number
  packageId: number
  packageName: string
  ownerId: number
  ownerUsername: string
  sharedToId: number
  sharedToUsername: string
  quotaMultiplier: number | null
  maxInstances: number | null
  usage?: {
    instanceCount: number
    totalCpu: number
    totalMemory: number
  }
  createdAt: string
}

// 选中的好友
const selectedFriend = ref<Friend | null>(null)

// 我的套餐列表
const myPackages = ref<Package[]>([])
const myPackagesLoading = ref(false)

// 好友已获得的共享套餐
const friendShares = ref<PackageShare[]>([])
const friendSharesLoading = ref(false)

// 共享操作
const shareLoading = ref(false)
const unshareLoading = ref<number | null>(null)

// 编辑配额弹窗
const showEditQuotaModal = ref(false)
const editingShare = ref<PackageShare | null>(null)
const editQuotaMultiplier = ref<number | null>(null)
const editMaxInstances = ref<number | null>(null)
const editQuotaLoading = ref(false)

// 添加共享弹窗
const showAddShareModal = ref(false)
const selectedPackageId = ref<number | null>(null)
const newQuotaMultiplier = ref<number | null>(null)
const newMaxInstances = ref<number | null>(null)
const addShareLoading = ref(false)

// 可共享套餐搜索
const packageSearch = ref('')

// 选中好友
function selectFriend(friend: Friend) {
  selectedFriend.value = friend
  loadFriendShares()
}

// 取消选中
function deselectFriend() {
  selectedFriend.value = null
  friendShares.value = []
}

// 加载我的套餐
async function loadMyPackages() {
  myPackagesLoading.value = true
  try {
    const res = await api.packages.list()
    // 服务端返回 { packages: [...], total: ... }，需要提取 packages 数组
    myPackages.value = res.packages || []
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    myPackagesLoading.value = false
  }
}

// 加载共享给当前好友的套餐
async function loadFriendShares() {
  if (!selectedFriend.value) return
  
  friendSharesLoading.value = true
  try {
    // 获取我共享出去的所有套餐，然后过滤出共享给当前好友的
    const res = await api.packages.getShared()
    friendShares.value = (res.shares || []).filter(
      s => s.sharedToId === selectedFriend.value?.id
    )
  } catch (err) {
    console.error('加载共享列表失败:', err)
    friendShares.value = []
  } finally {
    friendSharesLoading.value = false
  }
}

// 打开添加共享弹窗
function openAddShareModal(packageId?: number) {
  // 从套餐卡片点击时传入 packageId，自动选中
  // 从“添加共享”按钮点击时不传参数，清空选择
  selectedPackageId.value = packageId ?? null
  newQuotaMultiplier.value = null
  newMaxInstances.value = null
  showAddShareModal.value = true
}

// 可以共享的套餐（只返回用户自己拥有的套餐，排除已共享给当前好友的）
const availablePackages = computed(() => {
  const sharedIds = new Set(friendShares.value.map(s => s.packageId))
  // 只返回用户自己拥有的套餐（isOwn === true），排除共享给自己的套餐
  return myPackages.value.filter(p => 
    (p.isOwn === true) && !sharedIds.has(p.id)
  )
})

// 搜索过滤后的可共享套餐
const filteredAvailablePackages = computed(() => {
  if (!packageSearch.value.trim()) return availablePackages.value
  const keyword = packageSearch.value.toLowerCase()
  return availablePackages.value.filter(p =>
    p.name.toLowerCase().includes(keyword) ||
    (p.description && p.description.toLowerCase().includes(keyword))
  )
})

// 刷新套餐共享数据
async function refreshShareData() {
  await Promise.all([
    loadMyPackages(),
    selectedFriend.value ? loadFriendShares() : Promise.resolve()
  ])
  toast.success(t('common.refresh') + ' ' + t('common.success'))
}

// 添加共享
async function addShare() {
  if (!selectedFriend.value || !selectedPackageId.value) return
  
  // 处理 NaN 值（用户清空输入框时）
  const quotaMultiplier = Number.isNaN(newQuotaMultiplier.value) ? null : newQuotaMultiplier.value
  const maxInstances = Number.isNaN(newMaxInstances.value) ? null : newMaxInstances.value
  
  addShareLoading.value = true
  try {
    await api.packages.share(
      selectedPackageId.value,
      selectedFriend.value.id,
      quotaMultiplier,
      maxInstances
    )
    toast.success(t('friends.shareAdded'))
    showAddShareModal.value = false
    loadFriendShares()
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    addShareLoading.value = false
  }
}

// 取消共享
async function removeShare(share: PackageShare) {
  if (!selectedFriend.value) return
  if (!confirm(t('friends.confirmRemoveShare', { package: share.packageName }))) return
  
  unshareLoading.value = share.id
  try {
    await api.packages.unshare(share.packageId, selectedFriend.value.id)
    toast.success(t('friends.shareRemoved'))
    loadFriendShares()
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    unshareLoading.value = null
  }
}

// 打开编辑配额弹窗
function openEditQuotaModal(share: PackageShare) {
  editingShare.value = share
  editQuotaMultiplier.value = share.quotaMultiplier
  editMaxInstances.value = share.maxInstances
  showEditQuotaModal.value = true
}

// 保存配额编辑
async function saveQuotaEdit() {
  if (!editingShare.value) return
  
  // 处理 NaN 值（用户清空输入框时）
  const quotaMultiplier = Number.isNaN(editQuotaMultiplier.value) ? null : editQuotaMultiplier.value
  const maxInstances = Number.isNaN(editMaxInstances.value) ? null : editMaxInstances.value
  
  editQuotaLoading.value = true
  try {
    await api.packages.updateShareQuota(
      editingShare.value.packageId,
      editingShare.value.id,
      quotaMultiplier,
      maxInstances
    )
    toast.success(t('friends.quotaUpdated'))
    showEditQuotaModal.value = false
    loadFriendShares()
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    editQuotaLoading.value = false
  }
}

// 格式化内存
function formatMemory(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb} MB`
}

// 加载好友列表
async function loadFriends() {
  friendsLoading.value = true
  try {
    const res = await api.friends.list()
    friends.value = res.friends || []
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    friendsLoading.value = false
  }
}

// 加载待处理请求
async function loadPendingRequests() {
  pendingLoading.value = true
  try {
    const res = await api.friends.getPendingRequests()
    pendingRequests.value = res.requests || []
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    pendingLoading.value = false
  }
}

// 加载历史记录
async function loadHistoryRecords() {
  historyLoading.value = true
  try {
    const res = await api.friends.getHistory(historyFilter.value)
    historyRecords.value = res.history || []
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    historyLoading.value = false
  }
}

// 发送好友请求
async function sendFriendRequest() {
  if (!friendUsername.value.trim()) return
  
  addFriendLoading.value = true
  try {
    await api.friends.sendRequest(friendUsername.value.trim(), friendRemark.value.trim() || undefined)
    toast.success(t('friends.requestSent'))
    showAddFriendModal.value = false
    friendUsername.value = ''
    friendRemark.value = ''
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    addFriendLoading.value = false
  }
}

// 接受好友请求
async function acceptRequest(request: PendingRequest) {
  try {
    await api.friends.accept(request.id)
    toast.success(t('friends.requestAccepted'))
    pendingRequests.value = pendingRequests.value.filter(r => r.id !== request.id)
    loadFriends()
  } catch (err) {
    toast.error(translateError(err))
  }
}

// 拒绝好友请求
async function rejectRequest(request: PendingRequest) {
  try {
    await api.friends.reject(request.id)
    toast.success(t('friends.requestRejected'))
    pendingRequests.value = pendingRequests.value.filter(r => r.id !== request.id)
    // 刷新历史记录
    loadHistoryRecords()
  } catch (err) {
    toast.error(translateError(err))
  }
}

// 删除好友
async function removeFriend(friend: Friend) {
  if (!confirm(t('friends.confirmRemove', { name: friend.username }))) return
  
  try {
    // 必须使用 friendshipId（friendship 记录的ID），而不是 friend.id（好友的用户ID）
    const friendshipId = friend.friendshipId || friend.id
    await api.friends.remove(friendshipId)
    toast.success(t('friends.friendRemoved'))
    friends.value = friends.value.filter(f => f.id !== friend.id)
    // 如果删除的是当前选中的好友，清空选中状态
    if (selectedFriend.value?.id === friend.id) {
      deselectFriend()
    }
  } catch (err) {
    toast.error(translateError(err))
  }
}

// 格式化时间
function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString()
}

// 切换tab时加载数据
function switchTab(tab: string) {
  activeTab.value = tab
}

onMounted(async () => {
  // 并行加载所有初始数据
  await Promise.all([loadFriends(), loadPendingRequests(), loadHistoryRecords(), loadMyPackages()])
  hasInitialLoad = true
})

// 当组件从 KeepAlive 缓存中激活时，重新加载数据
onActivated(async () => {
  if (hasInitialLoad) {
    // 并行刷新所有数据
    await Promise.all([loadFriends(), loadPendingRequests(), loadMyPackages()])
  }
})
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('friends.title') }}</h1>
        <p class="page-description">{{ t('friends.description') }}</p>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div
      class="flex items-center gap-1 p-1 rounded-lg w-full sm:w-fit overflow-x-auto"
      :class="themeStore.isDark ? 'bg-gray-900/50' : 'bg-gray-100'"
    >
      <button
        :class="[
          'px-3 sm:px-4 py-2 text-sm rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none',
          activeTab === 'friends'
            ? (themeStore.isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900 shadow')
            : 'text-themed-muted hover:text-themed-secondary'
        ]"
        @click="switchTab('friends')"
      >
        {{ t('friends.friendsList') }}
        <span class="ml-1.5 text-xs text-themed-muted">{{ friends.length }}</span>
      </button>
      <button
        :class="[
          'px-3 sm:px-4 py-2 text-sm rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none',
          activeTab === 'pending'
            ? (themeStore.isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900 shadow')
            : 'text-themed-muted hover:text-themed-secondary'
        ]"
        @click="switchTab('pending')"
      >
        {{ t('friends.pendingRequests') }}
        <span
          v-if="pendingCount > 0"
          class="ml-1.5 text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
        >{{ pendingCount }}</span>
      </button>
      <button
        :class="[
          'px-3 sm:px-4 py-2 text-sm rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none',
          activeTab === 'history'
            ? (themeStore.isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900 shadow')
            : 'text-themed-muted hover:text-themed-secondary'
        ]"
        @click="switchTab('history')"
      >
        {{ t('friends.historyRequests') }}
      </button>
    </div>

    <!-- Tab Content with Transition -->
    <Transition name="tab" mode="out-in">
      <div :key="activeTab">
        <!-- 好友列表 Tab - 双栏布局 -->
        <div v-if="activeTab === 'friends'" class="space-y-4">
          <!-- 工具栏 -->
          <div class="flex items-center justify-between gap-4">
            <div class="relative w-full lg:w-80 xl:w-96">
              <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                v-model="friendsSearch"
                type="text"
                class="input pl-9 py-1.5 text-sm"
                :placeholder="t('common.searchPlaceholder')"
                @input="friendsPage = 1"
              />
            </div>
            <button class="btn-primary" @click="showAddFriendModal = true">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              {{ t('friends.addFriend') }}
            </button>
          </div>

          <SkeletonLoader v-if="friendsLoading" type="list" />

          <div v-else-if="friends.length === 0" class="card p-12 text-center">
            <svg
              class="w-12 h-12 mx-auto mb-4"
              :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p class="text-themed-secondary">{{ t('friends.noFriends') }}</p>
            <p class="text-xs text-themed-muted mt-2">{{ t('friends.noFriendsHint') }}</p>
          </div>

          <div v-else-if="filteredFriends.length === 0" class="card p-12 text-center">
            <svg
              class="w-12 h-12 mx-auto mb-4"
              :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p class="text-themed-secondary">{{ t('friends.noSearchResult') }}</p>
          </div>

          <!-- 双栏布局 -->
          <template v-else>
            <div class="flex flex-col lg:flex-row gap-6">
              <!-- 左侧: 好友列表 -->
              <div class="lg:w-80 xl:w-96 flex-shrink-0">
                <div class="space-y-2">
                  <div
                    v-for="friend in paginatedFilteredFriends"
                    :key="friend.id"
                    class="card p-3 cursor-pointer transition-all"
                    :class="[
                      selectedFriend?.id === friend.id
                        ? (themeStore.isDark ? 'border-blue-500 bg-blue-900/20' : 'border-blue-500 bg-blue-50')
                        : (themeStore.isDark ? 'hover:border-gray-700' : 'hover:border-gray-300')
                    ]"
                    @click="selectFriend(friend)"
                  >
                    <div class="flex items-center gap-3">
                      <UserAvatar
                        :username="friend.username || ''"
                        :email="friend.email"
                        :avatar-style="friend.avatarStyle || ''"
                        :badge-id="friend.avatarBadgeId || null"
                        :size="36"
                        class="flex-shrink-0"
                      />
                      <div class="flex-1 min-w-0">
                        <div
                          class="font-medium truncate text-sm"
                          :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'"
                        >
                          {{ friend.username }}
                        </div>
                        <div class="text-xs text-themed-muted truncate">
                          {{ friend.email || t('friends.addedOn') + ' ' + formatDate(friend.createdAt) }}
                        </div>
                      </div>
                      <svg
                        v-if="selectedFriend?.id === friend.id"
                        class="w-5 h-5 text-blue-500 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                      </svg>
                    </div>
                  </div>
                </div>

                <!-- 好友列表分页控件 -->
                <div v-if="filteredFriendsTotalPages > 1" class="flex items-center justify-between text-xs text-themed-muted mt-3 pt-3 border-t border-themed">
                  <span>{{ filteredFriends.length }} {{ t('common.items') }}</span>
                  <div class="flex items-center gap-1">
                    <button :disabled="friendsPage <= 1" class="btn-ghost btn-xs" @click="friendsPage--">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span>{{ friendsPage }}/{{ filteredFriendsTotalPages }}</span>
                    <button :disabled="friendsPage >= filteredFriendsTotalPages" class="btn-ghost btn-xs" @click="friendsPage++">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <!-- 右侧: 套餐管理面板 -->
              <div class="flex-1 min-w-0">
                <!-- 未选择好友 -->
                <div v-if="!selectedFriend" class="card p-12 text-center">
                  <svg
                    class="w-12 h-12 mx-auto mb-4"
                    :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                  <p class="text-themed-secondary">{{ t('friends.selectFriendHint') }}</p>
                  <p class="text-xs text-themed-muted mt-2">{{ t('friends.selectFriendDesc') }}</p>
                </div>

                <!-- 已选择好友 -->
                <template v-else>
                  <!-- 好友信息头部 -->
                  <div class="card p-4 mb-4">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-3">
                        <UserAvatar
                          :username="selectedFriend.username || ''"
                          :email="selectedFriend.email"
                          :avatar-style="selectedFriend.avatarStyle || ''"
                          :badge-id="selectedFriend.avatarBadgeId || null"
                          :size="48"
                        />
                        <div>
                          <div class="font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                            {{ selectedFriend.username }}
                          </div>
                          <div v-if="selectedFriend.email" class="text-sm text-themed-muted">{{ selectedFriend.email }}</div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                        <button
                          class="btn-ghost btn-xs sm:btn-sm p-1.5 sm:p-2"
                          :title="t('common.refresh')"
                          @click="refreshShareData"
                        >
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                        <button
                          class="btn-ghost btn-xs sm:btn-sm p-1.5 sm:p-2 text-error"
                          :title="t('friends.removeFriend')"
                          @click="removeFriend(selectedFriend)"
                        >
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                        <button class="btn-ghost btn-xs sm:btn-sm p-1.5 sm:p-2 lg:hidden" @click="deselectFriend">
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 已分配的套餐 -->
                  <div class="mb-4">
                    <div class="flex items-center justify-between mb-3">
                      <h3 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                        {{ t('friends.sharedPackages') }}
                        <span class="text-themed-muted font-normal">({{ friendShares.length }})</span>
                      </h3>
                      <button
                        v-if="availablePackages.length > 0"
                        class="btn-primary btn-sm"
                        @click="openAddShareModal()"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                        </svg>
                        {{ t('friends.addShare') }}
                      </button>
                    </div>

                    <SkeletonLoader v-if="friendSharesLoading" type="card" />

                    <div v-else-if="friendShares.length === 0" class="card p-8 text-center">
                      <svg
                        class="w-10 h-10 mx-auto mb-3"
                        :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      <p class="text-sm text-themed-secondary">{{ t('friends.noSharedPackages') }}</p>
                      <button
                        v-if="availablePackages.length > 0"
                        class="btn-primary btn-sm mt-3"
                        @click="openAddShareModal()"
                      >
                        {{ t('friends.addFirstShare') }}
                      </button>
                    </div>

                    <div v-else class="space-y-2">
                      <div
                        v-for="share in friendShares"
                        :key="share.id"
                        class="card p-4"
                      >
                        <div class="flex items-start justify-between gap-4">
                          <div class="flex-1 min-w-0">
                            <div class="font-medium text-sm" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                              {{ share.packageName }}
                            </div>
                            <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-themed-muted">
                              <span v-if="share.quotaMultiplier !== null">
                                {{ t('friends.quotaMultiplier') }}: {{ share.quotaMultiplier }}x
                              </span>
                              <span v-if="share.maxInstances !== null">
                                {{ t('friends.maxInstances') }}: {{ share.maxInstances }}
                              </span>
                              <span v-if="share.usage">
                                {{ t('friends.currentUsage') }}: {{ share.usage.instanceCount }} {{ t('friends.instances') }}
                              </span>
                            </div>
                          </div>
                          <div class="flex items-center gap-1 flex-shrink-0">
                            <button
                              class="btn-ghost btn-sm"
                              :title="t('friends.editQuota')"
                              @click="openEditQuotaModal(share)"
                            >
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              class="btn-ghost btn-sm text-error"
                              :disabled="unshareLoading === share.id"
                              :title="t('friends.removeShare')"
                              @click="removeShare(share)"
                            >
                              <span v-if="unshareLoading === share.id" class="loading-spinner w-4 h-4"></span>
                              <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 可分配的套餐 -->
                  <div v-if="availablePackages.length > 0">
                    <div class="flex items-center justify-between mb-3">
                      <h3 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                        {{ t('friends.availablePackages') }}
                        <span class="text-themed-muted font-normal">({{ filteredAvailablePackages.length }})</span>
                      </h3>
                      <!-- 套餐搜索框 -->
                      <div v-if="availablePackages.length > 3" class="relative">
                        <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                          v-model="packageSearch"
                          type="text"
                          class="input pl-8 py-1 text-xs w-32"
                          :placeholder="t('common.searchPlaceholder')"
                        />
                      </div>
                    </div>

                    <!-- 搜索无结果 -->
                    <div v-if="filteredAvailablePackages.length === 0" class="card p-4 text-center">
                      <p class="text-sm text-themed-muted">{{ t('friends.noPackageSearchResult') }}</p>
                    </div>

                    <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div
                        v-for="pkg in filteredAvailablePackages"
                        :key="pkg.id"
                        class="card p-3 flex items-center justify-between gap-3"
                      >
                        <div class="flex-1 min-w-0">
                          <div class="font-medium text-sm truncate" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                            {{ pkg.name }}
                          </div>
                          <div class="text-xs text-themed-muted">
                            {{ pkg.cpu_max }}%CPU · {{ formatMemory(pkg.memory_max) }}
                          </div>
                        </div>
                        <button
                          class="btn-secondary btn-sm flex-shrink-0"
                          :disabled="shareLoading"
                          @click="openAddShareModal(pkg.id)"
                        >
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 用户没有套餐时的提示 -->
                  <div v-else-if="myPackages.length === 0 && friendShares.length === 0" class="card p-6 text-center">
                    <svg
                      class="w-10 h-10 mx-auto mb-3"
                      :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <p class="text-sm text-themed-secondary">{{ t('friends.noPackagesToShare') }}</p>
                    <p class="text-xs text-themed-muted mt-1">{{ t('friends.createPackageFirst') }}</p>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>

        <!-- 待处理请求 Tab -->
        <div v-if="activeTab === 'pending'" class="space-y-4">
          <SkeletonLoader v-if="pendingLoading" type="list" />

          <div v-else-if="pendingRequests.length === 0" class="card p-12 text-center">
            <svg
              class="w-12 h-12 mx-auto mb-4"
              :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p class="text-themed-secondary">{{ t('friends.noPendingRequests') }}</p>
          </div>

          <template v-else>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div
                v-for="request in paginatedPendingRequests"
                :key="request.id"
                class="card p-4"
              >
                <div class="flex items-start gap-3">
                  <UserAvatar
                    :username="request.username || ''"
                    :email="request.email"
                    :avatar-style="request.avatarStyle || ''"
                    :badge-id="request.avatarBadgeId || null"
                    :size="40"
                    class="flex-shrink-0"
                  />
                  <div class="flex-1 min-w-0">
                    <div
                      class="font-medium truncate"
                      :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'"
                    >
                      {{ request.username }}
                    </div>
                    <div v-if="request.email" class="text-xs text-themed-secondary truncate">{{ request.email }}</div>
                    <div class="text-xs text-themed-muted">
                      {{ t('friends.requestedOn') }} {{ formatDate(request.createdAt) }}
                    </div>
                    <div v-if="request.remark" class="text-xs mt-1 truncate" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                      {{ t('friends.remark') }}: {{ request.remark }}
                    </div>
                    <div class="flex items-center gap-2 mt-3">
                      <button
                        class="btn-primary btn-sm"
                        @click="acceptRequest(request)"
                      >
                        {{ t('friends.accept') }}
                      </button>
                      <button
                        class="btn-secondary btn-sm"
                        @click="rejectRequest(request)"
                      >
                        {{ t('friends.reject') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- 待处理请求分页控件 -->
          <div v-if="pendingTotalPages > 1" class="flex items-center justify-between text-sm text-themed-muted">
            <span>{{ t('common.total') }} {{ pendingRequests.length }} {{ t('common.items') }}</span>
            <div class="flex items-center gap-2">
              <button :disabled="pendingPage <= 1" class="btn-ghost btn-sm" @click="pendingPage--">{{ t('instance.prevPage') }}</button>
              <span>{{ pendingPage }} / {{ pendingTotalPages }}</span>
              <button :disabled="pendingPage >= pendingTotalPages" class="btn-ghost btn-sm" @click="pendingPage++">{{ t('instance.nextPage') }}</button>
            </div>
          </div>
        </div>

        <!-- 历史记录 Tab -->
        <div v-if="activeTab === 'history'" class="space-y-4">
          <!-- 搜索和筛选工具栏 -->
          <div class="flex items-center justify-between gap-4">
            <div class="relative flex-1 max-w-xs">
              <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                v-model="historySearch"
                type="text"
                class="input pl-9 py-1.5 text-sm"
                :placeholder="t('common.searchPlaceholder')"
                @input="historyPage = 1"
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm text-themed-muted">{{ t('common.filter') }}:</span>
              <select
                v-model="historyFilter"
                class="input py-1.5 px-3 text-sm w-auto"
                @change="loadHistoryRecords(); historyPage = 1"
              >
                <option value="all">{{ t('friends.filterAll') }}</option>
                <option value="accepted">{{ t('friends.filterAccepted') }}</option>
                <option value="rejected">{{ t('friends.filterRejected') }}</option>
              </select>
            </div>
          </div>

          <SkeletonLoader v-if="historyLoading" type="list" />

          <div v-else-if="historyRecords.length === 0" class="card p-12 text-center">
            <svg
              class="w-12 h-12 mx-auto mb-4"
              :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p class="text-themed-secondary">{{ t('friends.noHistoryRecords') }}</p>
            <p class="text-xs text-themed-muted mt-2">{{ t('friends.noHistoryRecordsHint') }}</p>
          </div>

          <div v-else-if="filteredHistoryRecords.length === 0" class="card p-12 text-center">
            <svg
              class="w-12 h-12 mx-auto mb-4"
              :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p class="text-themed-secondary">{{ t('friends.noHistorySearchResult') }}</p>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="record in paginatedHistoryRecords"
              :key="record.id"
              class="card p-4"
            >
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div class="flex items-start gap-3 min-w-0 flex-1">
                  <UserAvatar
                    :username="record.username || ''"
                    :email="record.email"
                    :avatar-style="record.avatarStyle || ''"
                    :badge-id="record.avatarBadgeId || null"
                    :size="40"
                    class="flex-shrink-0"
                  />
                  <div class="min-w-0 flex-1">
                    <div
                      class="font-medium truncate"
                      :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'"
                    >
                      {{ record.initiatedByMe ? t('friends.sentTo', { username: record.username }) : record.username }}
                    </div>
                    <div v-if="record.email" class="text-xs text-themed-secondary truncate">{{ record.email }}</div>
                    <div class="text-xs text-themed-muted">
                      {{ record.initiatedByMe ? t('friends.sentOn') : t('friends.requestedOn') }} {{ formatDate(record.createdAt) }}
                    </div>
                    <div v-if="record.remark" class="text-xs mt-1 truncate" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                      {{ t('friends.remark') }}: {{ record.remark }}
                    </div>
                  </div>
                </div>
                <div class="flex flex-row sm:flex-col items-center sm:items-end gap-1 flex-shrink-0">
                  <span
                    class="text-xs px-2 py-1 rounded-full whitespace-nowrap"
                    :class="record.status === 'accepted'
                      ? (themeStore.isDark ? 'bg-green-900/50 text-green-400' : 'bg-green-100 text-green-700')
                      : (themeStore.isDark ? 'bg-red-900/50 text-red-400' : 'bg-red-100 text-red-700')
                    "
                  >
                    {{ record.status === 'accepted' ? t('friends.statusAccepted') : t('friends.statusRejected') }}
                  </span>
                  <span class="text-xs text-themed-muted whitespace-nowrap">
                    {{ t('friends.processedOn') }} {{ formatDate(record.status === 'accepted' ? record.acceptedAt : record.rejectedAt) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 历史记录分页控件 -->
          <div v-if="historyTotalPages > 1" class="flex items-center justify-between text-sm text-themed-muted">
            <span>{{ t('common.total') }} {{ filteredHistoryRecords.length }} {{ t('common.items') }}</span>
            <div class="flex items-center gap-2">
              <button :disabled="historyPage <= 1" class="btn-ghost btn-sm" @click="historyPage--">{{ t('instance.prevPage') }}</button>
              <span>{{ historyPage }} / {{ historyTotalPages }}</span>
              <button :disabled="historyPage >= historyTotalPages" class="btn-ghost btn-sm" @click="historyPage++">{{ t('instance.nextPage') }}</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 添加好友弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddFriendModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showAddFriendModal = false"></div>
          <div class="modal-content max-w-sm">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('friends.addFriend') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showAddFriendModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body space-y-4" @submit.prevent="sendFriendRequest">
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('friends.username') }} <span class="text-error">*</span></label>
                <input
                  v-model="friendUsername"
                  type="text"
                  class="input"
                  :placeholder="t('friends.usernamePlaceholder')"
                  required
                />
                <p class="text-xs text-themed-muted mt-1.5">{{ t('friends.usernameHint') }}</p>
              </div>
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('friends.remark') }}</label>
                <textarea
                  v-model="friendRemark"
                  class="input"
                  rows="3"
                  :placeholder="t('friends.remarkPlaceholder')"
                ></textarea>
                <p class="text-xs text-themed-muted mt-1.5">{{ t('friends.remarkHint') }}</p>
              </div>
            </form>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showAddFriendModal = false">{{ t('common.cancel') }}</button>
              <button
                :disabled="!friendUsername.trim() || addFriendLoading"
                class="btn-primary"
                @click="sendFriendRequest"
              >
                <span v-if="addFriendLoading" class="loading-spinner w-4 h-4"></span>
                <span v-else>{{ t('friends.sendRequest') }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 添加共享弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddShareModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showAddShareModal = false"></div>
          <div class="modal-content max-w-md">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('friends.addShareTitle') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showAddShareModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body space-y-4">
              <!-- 目标好友 -->
              <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
                <div class="flex items-center gap-3">
                  <UserAvatar
                    v-if="selectedFriend"
                    :username="selectedFriend.username || ''"
                    :email="selectedFriend.email"
                    :avatar-style="selectedFriend.avatarStyle || ''"
                    :badge-id="selectedFriend.avatarBadgeId || null"
                    :size="36"
                  />
                  <div>
                    <div class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                      {{ selectedFriend?.username }}
                    </div>
                    <div class="text-xs text-themed-muted">{{ t('friends.shareToFriend') }}</div>
                  </div>
                </div>
              </div>

              <!-- 选择套餐 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('friends.selectPackage') }} <span class="text-error">*</span></label>
                <select v-model="selectedPackageId" class="input">
                  <option :value="null" disabled>{{ t('friends.selectPackagePlaceholder') }}</option>
                  <option v-for="pkg in availablePackages" :key="pkg.id" :value="pkg.id">
                    {{ pkg.name }} ({{ pkg.cpu_max }} CPU, {{ formatMemory(pkg.memory_max) }})
                  </option>
                </select>
              </div>

              <!-- 配额限制 -->
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('friends.quotaMultiplier') }}</label>
                  <div class="relative">
                    <input
                      v-model.number="newQuotaMultiplier"
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="10"
                      class="input pr-8"
                      :placeholder="t('friends.noLimit')"
                    />
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-themed-muted text-sm">×</span>
                  </div>
                  <p class="text-xs text-themed-muted mt-1">{{ t('friends.quotaMultiplierHint') }}</p>
                </div>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('friends.maxInstances') }}</label>
                  <input
                    v-model.number="newMaxInstances"
                    type="number"
                    min="0"
                    class="input"
                    :placeholder="t('friends.noLimit')"
                  />
                  <p class="text-xs text-themed-muted mt-1">{{ t('friends.maxInstancesHint') }}</p>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showAddShareModal = false">{{ t('common.cancel') }}</button>
              <button
                :disabled="!selectedPackageId || addShareLoading"
                class="btn-primary"
                @click="addShare"
              >
                <span v-if="addShareLoading" class="loading-spinner w-4 h-4"></span>
                <span v-else>{{ t('friends.confirmShare') }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 编辑配额弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showEditQuotaModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showEditQuotaModal = false"></div>
          <div class="modal-content max-w-md">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('friends.editQuotaTitle') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showEditQuotaModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body space-y-4">
              <!-- 套餐信息 -->
              <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
                <div class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                  {{ editingShare?.packageName }}
                </div>
                <div class="text-xs text-themed-muted mt-1">
                  {{ t('friends.sharedTo') }}: {{ selectedFriend?.username }}
                </div>
              </div>

              <!-- 配额限制 -->
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('friends.quotaMultiplier') }}</label>
                  <div class="relative">
                    <input
                      v-model.number="editQuotaMultiplier"
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="10"
                      class="input pr-8"
                      :placeholder="t('friends.noLimit')"
                    />
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-themed-muted text-sm">×</span>
                  </div>
                  <p class="text-xs text-themed-muted mt-1">{{ t('friends.quotaMultiplierHint') }}</p>
                </div>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('friends.maxInstances') }}</label>
                  <input
                    v-model.number="editMaxInstances"
                    type="number"
                    min="0"
                    class="input"
                    :placeholder="t('friends.noLimit')"
                  />
                  <p class="text-xs text-themed-muted mt-1">{{ t('friends.maxInstancesHint') }}</p>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showEditQuotaModal = false">{{ t('common.cancel') }}</button>
              <button
                :disabled="editQuotaLoading"
                class="btn-primary"
                @click="saveQuotaEdit"
              >
                <span v-if="editQuotaLoading" class="loading-spinner w-4 h-4"></span>
                <span v-else>{{ t('common.save') }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
