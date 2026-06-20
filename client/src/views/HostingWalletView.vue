<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useConfigStore } from '@/stores/config'
import UserAvatar from '@/components/UserAvatar.vue'
import { getVipBadgeInlineStyle, normalizeVipBadgeStyle, type VipBadgeStyle } from '@/utils/vipBadge'

defineOptions({ name: 'HostingWalletView' })

const { t } = useI18n()
const toast = useToast()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const configStore = useConfigStore()

interface HostingBalance {
  available: number
  frozen: number
  pendingWithdrawal: number
  totalIncome: number
  totalWithdrawn: number
}

interface HostingConfig {
  minWithdrawalAmount: number
  feeRateBalance: number
}

interface HostingLog {
  id: number
  type: string
  actionType: string | null
  amount: number
  frozen: boolean
  unfreezeAt: string | null
  relatedId: number | null
  remark: string | null
  createdAt: string
  instance: {
    id: number
    name: string
    deleted?: boolean
    buyer: {
      id: number
      username: string
      email: string | null
      avatarStyle: string
      avatarBadgeId?: string | null
    }
    host: {
      id: number
      name: string
    }
    package: {
      id: number
      name: string
    } | null
    plan: {
      id: number
      name: string
    } | null
  } | null
}

interface Withdrawal {
  id: number
  amount: number
  feeRate: number
  feeAmount: number
  actualAmount: number
  target: string
  status: string
  rejectReason: string | null
  processedAt: string | null
  createdAt: string
}

interface HostingBlock {
  id: number
  blockedUserId: number
  username: string
  email: string | null
  avatarStyle: string
  avatarBadgeId?: string | null
  remark: string | null
  createdAt: string
}

interface HostingBlockCandidate {
  id: number
  username: string
  email: string | null
  avatarStyle: string
  avatarBadgeId?: string | null
  blocked: boolean
}

interface HostingStats {
  myHostsCount: number
  instancesOnMyHosts: number
  uniqueCustomersCount: number
  monthIncome: number
  vipLevel: number
  vipBadgeStyle?: VipBadgeStyle | null
}

type WalletTab = 'overview' | 'logs' | 'withdrawals' | 'blocks'
type LogFilter = 'all' | 'purchase' | 'renew' | 'destroy'
type MetricTone = 'default' | 'success' | 'warning' | 'info'

// 状态
const loading = ref(true)
const balance = ref<HostingBalance | null>(null)
const config = ref<HostingConfig | null>(null)
const logs = ref<HostingLog[]>([])
const withdrawals = ref<Withdrawal[]>([])
const stats = ref<HostingStats | null>(null)
const activeTab = ref<WalletTab>('overview')

// 提现表单
const showWithdrawModal = ref(false)
const withdrawForm = ref({
  amount: 10
})
const withdrawing = ref(false)

// 分页 - 收支明细
const logsPage = ref(1)
const logsTotal = ref(0)
const logsPageSize = ref(30)
const logsSearch = ref('')
const logsSearchInput = ref('')
const logsLoading = ref(false)
const logsFilter = ref<LogFilter>('all')

// 分页 - 提现记录
const withdrawalsPage = ref(1)
const withdrawalsTotal = ref(0)
const withdrawalsPageSize = ref(30)
const withdrawalsLoading = ref(false)
const blocks = ref<HostingBlock[]>([])
const blocksLoading = ref(false)
const blockSearch = ref('')
const blockCandidates = ref<HostingBlockCandidate[]>([])
const blockSearching = ref(false)
const blockActionLoading = ref<number | null>(null)

// 每页条数选项
const pageSizeOptions = [10, 30, 50, 100]

// 计算属性
const canWithdraw = computed(() => {
  if (!balance.value || !config.value) return false
  return balance.value.available >= config.value.minWithdrawalAmount
})

const logsTotalPages = computed(() => Math.ceil(logsTotal.value / logsPageSize.value))
const withdrawalsTotalPages = computed(() => Math.ceil(withdrawalsTotal.value / withdrawalsPageSize.value))

const estimatedAmount = computed(() => {
  if (!config.value) return 0
  const fee = withdrawForm.value.amount * config.value.feeRateBalance
  return withdrawForm.value.amount - fee
})

const tabs = computed((): Array<{ key: WalletTab; label: string }> => [
  { key: 'overview', label: t('hostingWallet.tabs.overview') },
  { key: 'logs', label: t('hostingWallet.tabs.logs') },
  { key: 'withdrawals', label: t('hostingWallet.tabs.withdrawals') },
  { key: 'blocks', label: t('hostingWallet.tabs.blocks') }
])

const headerStats = computed((): Array<{ key: string; label: string; value: string; tone: MetricTone }> => [
  {
    key: 'frozen',
    label: t('hostingWallet.balance.frozen'),
    value: formatMoney(balance.value?.frozen || 0),
    tone: 'warning'
  },
  {
    key: 'monthIncome',
    label: t('hostingWallet.stats.monthIncome'),
    value: formatMoney(stats.value?.monthIncome || 0),
    tone: 'success'
  },
  {
    key: 'totalIncome',
    label: t('hostingWallet.balance.totalIncome'),
    value: formatMoney(balance.value?.totalIncome || 0),
    tone: 'info'
  },
  {
    key: 'customers',
    label: t('hostingWallet.stats.uniqueCustomersCount'),
    value: String(stats.value?.uniqueCustomersCount || 0),
    tone: 'default'
  }
])

const logSummaryStats = computed((): Array<{ key: string; label: string; value: string; tone: MetricTone }> => [
  {
    key: 'available',
    label: t('hostingWallet.balance.available'),
    value: formatMoney(balance.value?.available || 0),
    tone: 'default'
  },
  {
    key: 'frozen',
    label: t('hostingWallet.balance.frozen'),
    value: formatMoney(balance.value?.frozen || 0),
    tone: 'warning'
  },
  {
    key: 'totalIncome',
    label: t('hostingWallet.balance.totalIncome'),
    value: formatMoney(balance.value?.totalIncome || 0),
    tone: 'info'
  }
])

const withdrawalSummaryStats = computed((): Array<{ key: string; label: string; value: string; tone: MetricTone }> => [
  {
    key: 'available',
    label: t('hostingWallet.balance.available'),
    value: formatMoney(balance.value?.available || 0),
    tone: 'default'
  },
  {
    key: 'monthIncome',
    label: t('hostingWallet.stats.monthIncome'),
    value: formatMoney(stats.value?.monthIncome || 0),
    tone: 'success'
  },
  {
    key: 'frozen',
    label: t('hostingWallet.balance.frozen'),
    value: formatMoney(balance.value?.frozen || 0),
    tone: 'warning'
  }
])

const hostMetaStats = computed((): Array<{ key: string; label: string; value: number }> => [
  {
    key: 'hosts',
    label: t('hostingWallet.stats.myHostsCount'),
    value: stats.value?.myHostsCount || 0
  },
  {
    key: 'instances',
    label: t('hostingWallet.stats.instancesOnMyHosts'),
    value: stats.value?.instancesOnMyHosts || 0
  }
])

const flowSteps = computed((): Array<{ key: string; title: string; desc: string }> => [
  {
    key: 'purchase',
    title: t('hostingWallet.overview.step1Title'),
    desc: t('hostingWallet.overview.step1Desc')
  },
  {
    key: 'freeze',
    title: t('hostingWallet.overview.step2Title'),
    desc: t('hostingWallet.overview.step2Desc')
  },
  {
    key: 'withdraw',
    title: t('hostingWallet.overview.step3Title'),
    desc: t('hostingWallet.overview.step3Desc')
  }
])

const overviewRules = computed((): Array<{ key: string; title: string; desc: string }> => [
  {
    key: 'minimum',
    title: t('hostingWallet.overview.minAmountTitle'),
    desc: t('hostingWallet.overview.minAmount', { amount: formatMoney(config.value?.minWithdrawalAmount || 10) })
  },
  {
    key: 'fee',
    title: t('hostingWallet.overview.feeTitle'),
    desc: t('hostingWallet.overview.feeDescNew')
  },
  {
    key: 'method',
    title: t('hostingWallet.overview.withdrawMethodTitle'),
    desc: t('hostingWallet.overview.withdrawMethodDesc')
  }
])

const logFilterOptions = computed((): Array<{ key: LogFilter; label: string }> => [
  { key: 'all', label: t('hostingWallet.logs.filterAll') },
  { key: 'purchase', label: t('hostingWallet.logs.actionTypes.purchase') },
  { key: 'renew', label: t('hostingWallet.logs.actionTypes.renew') },
  { key: 'destroy', label: t('hostingWallet.logs.actionTypes.destroy') }
])

const withdrawalHint = computed(() =>
  canWithdraw.value
    ? t('hostingWallet.modal.availableNote', { amount: formatMoney(balance.value?.available || 0) })
    : t('hostingWallet.withdraw.minAmountNote', { amount: formatMoney(config.value?.minWithdrawalAmount || 10) })
)

const hostingNotice = computed(() => configStore.hostingNotice?.trim() || '')

// logsFilter 改为后端参数，过滤通过 type 参数传给 API

// 加载数据
async function loadBalance() {
  try {
    const res = await api.hosting.getBalance()
    balance.value = res.balance
    config.value = res.config
  } catch (err) {
    console.error('Failed to load hosting balance:', err)
  }
}

async function loadStats() {
  try {
    const res = await api.hosting.getStats()
    stats.value = res.stats
  } catch (err) {
    console.error('Failed to load hosting stats:', err)
  }
}

async function loadLogs(page = 1) {
  logsLoading.value = true
  try {
    const res = await api.hosting.getLogs({ 
      page, 
      pageSize: logsPageSize.value,
      search: logsSearch.value || undefined,
      actionType: logsFilter.value !== 'all' ? logsFilter.value : undefined
    })
    logs.value = res.logs
    logsTotal.value = res.total
    logsPage.value = page
  } catch (err) {
    console.error('Failed to load hosting logs:', err)
  } finally {
    logsLoading.value = false
  }
}

async function loadWithdrawals(page = 1) {
  withdrawalsLoading.value = true
  try {
    const res = await api.hosting.getWithdrawals({ 
      page, 
      pageSize: withdrawalsPageSize.value
    })
    withdrawals.value = res.records
    withdrawalsTotal.value = res.total
    withdrawalsPage.value = page
  } catch (err) {
    console.error('Failed to load withdrawals:', err)
  } finally {
    withdrawalsLoading.value = false
  }
}

async function loadBlocks() {
  blocksLoading.value = true
  try {
    const res = await api.hosting.getBlocks()
    blocks.value = res.blocks || []
  } catch (err) {
    console.error('Failed to load hosting blocks:', err)
  } finally {
    blocksLoading.value = false
  }
}

async function searchBlockCandidates() {
  const keyword = blockSearch.value.trim()
  if (keyword.length < 2) {
    blockCandidates.value = []
    return
  }

  blockSearching.value = true
  try {
    const res = await api.hosting.searchBlockUsers(keyword)
    blockCandidates.value = res.users || []
  } catch (err: any) {
    toast.error(err?.message || t('common.loadFailed'))
  } finally {
    blockSearching.value = false
  }
}

// 搜索
function handleLogsSearch() {
  logsSearch.value = logsSearchInput.value
  loadLogs(1)
}

// 分页
function handleLogsPageSizeChange() {
  loadLogs(1)
}

function handleWithdrawalsPageSizeChange() {
  loadWithdrawals(1)
}

function handleTabChange(tab: WalletTab) {
  activeTab.value = tab

  if (tab === 'logs') {
    loadLogs()
  } else if (tab === 'withdrawals') {
    loadWithdrawals()
  } else if (tab === 'blocks') {
    loadBlocks()
  }
}

function handleLogsFilterChange(filter: LogFilter) {
  logsFilter.value = filter
  loadLogs(1)
}

// 提现
async function submitWithdraw() {
  if (!config.value) return
  
  if (withdrawForm.value.amount < config.value.minWithdrawalAmount) {
    toast.error(t('hostingWallet.errors.minAmount', { amount: formatMoney(config.value.minWithdrawalAmount) }))
    return
  }
  
  if (balance.value && withdrawForm.value.amount > balance.value.available) {
    toast.error(t('hostingWallet.errors.exceedBalance'))
    return
  }
  
  withdrawing.value = true
  try {
    const res = await api.hosting.withdraw({
      amount: withdrawForm.value.amount
    })
    toast.success(res.message)
    showWithdrawModal.value = false
    await Promise.all([loadBalance(), loadLogs(), loadWithdrawals()])
  } catch (err: any) {
    toast.error(err?.message || t('common.error'))
  } finally {
    withdrawing.value = false
  }
}

async function blockUser(userId: number) {
  blockActionLoading.value = userId
  try {
    await api.hosting.blockUser({ userId })
    toast.success(t('hostingWallet.blocks.blockSuccess'))
    blockCandidates.value = blockCandidates.value.map(user => user.id === userId ? { ...user, blocked: true } : user)
    await loadBlocks()
  } catch (err: any) {
    toast.error(err?.message || t('common.error'))
  } finally {
    blockActionLoading.value = null
  }
}

async function unblockUser(userId: number) {
  blockActionLoading.value = userId
  try {
    await api.hosting.unblockUser(userId)
    toast.success(t('hostingWallet.blocks.unblockSuccess'))
    blocks.value = blocks.value.filter(block => block.blockedUserId !== userId)
    blockCandidates.value = blockCandidates.value.map(user => user.id === userId ? { ...user, blocked: false } : user)
  } catch (err: any) {
    toast.error(err?.message || t('common.error'))
  } finally {
    blockActionLoading.value = null
  }
}

// 格式化函数
function formatMoney(amount: number): string {
  return `¥${amount.toFixed(2)}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

function getActionTypeLabel(actionType: string | null): string {
  if (!actionType) return '-'
  const key = `hostingWallet.logs.actionTypes.${actionType}`
  const label = t(key)
  return label === key ? actionType : label
}

function getStatusLabel(status: string): string {
  const key = `hostingWallet.withdrawals.status.${status}`
  const label = t(key)
  return label === key ? status : label
}

function getStatusClass(status: string): string {
  const classes: Record<string, string> = {
    pending: 'text-yellow-700 bg-yellow-100 dark:text-yellow-300 dark:bg-yellow-900/30',
    approved: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30',
    rejected: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/30',
    completed: 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30'
  }
  return classes[status] || 'text-gray-600 bg-gray-100'
}

function getActionTypeBadgeClass(actionType: string | null): string {
  const classes: Record<string, string> = {
    purchase: 'badge-success',
    renew: 'badge-info',
    upgrade: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    destroy: 'badge-error',
    unfreeze: 'badge-warning',
    withdraw: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    admin_adjust: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
  }
  return classes[actionType || ''] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
}

function getMetricCardClass(tone: MetricTone): string {
  const classes: Record<MetricTone, string> = {
    default: 'border-themed bg-themed-tertiary',
    success: 'border-emerald-500/15 bg-emerald-500/[0.06]',
    warning: 'border-amber-500/15 bg-amber-500/[0.06]',
    info: 'border-blue-500/15 bg-blue-500/[0.06]'
  }

  return classes[tone]
}

function getMetricValueClass(tone: MetricTone): string {
  const classes: Record<MetricTone, string> = {
    default: 'text-themed',
    success: 'text-emerald-600 dark:text-emerald-300',
    warning: 'text-amber-600 dark:text-amber-300',
    info: 'text-blue-600 dark:text-blue-300'
  }

  return classes[tone]
}

function getFlowCardClass(index: number): string {
  const classes = [
    'border-blue-500/15 bg-blue-500/[0.04]',
    'border-amber-500/15 bg-amber-500/[0.04]',
    'border-emerald-500/15 bg-emerald-500/[0.04]'
  ]

  return classes[index] || 'border-themed bg-themed-tertiary'
}

function getFlowIndexClass(index: number): string {
  const classes = [
    'bg-blue-600 text-white dark:bg-blue-500',
    'bg-amber-500 text-white',
    'bg-emerald-600 text-white dark:bg-emerald-500'
  ]

  return classes[index] || 'bg-themed-secondary text-themed'
}

onMounted(async () => {
  loading.value = true
  await Promise.all([loadBalance(), loadStats(), loadLogs(), loadWithdrawals(), configStore.loadPublicConfig()])
  loading.value = false
})
</script>

<template>
  <div class="animate-fade-in">
    <!-- 顶部胶囊 Tabs -->
    <div class="mb-4 flex justify-center sm:mb-5">
      <div
        class="inline-flex max-w-full overflow-x-auto p-1 rounded-full"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
      >
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="px-4 py-2 text-sm font-medium rounded-full transition-all duration-300 whitespace-nowrap sm:px-5"
          :class="activeTab === tab.key
            ? themeStore.isDark
              ? 'bg-white text-gray-900 shadow-lg'
              : 'bg-gray-900 text-white shadow-lg'
            : themeStore.isDark
              ? 'text-gray-400 hover:text-gray-200'
              : 'text-gray-600 hover:text-gray-900'"
          @click="handleTabChange(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>
    
    <!-- 骨架屏加载态 -->
    <div v-if="loading" class="space-y-6">
      <div class="card p-6 animate-pulse">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div class="flex-1">
            <div class="h-4 bg-themed-secondary rounded w-24 mb-3"></div>
            <div class="h-10 bg-themed-secondary rounded w-48"></div>
          </div>
          <div class="grid grid-cols-4 gap-3">
            <div v-for="i in 4" :key="i" class="h-16 bg-themed-secondary rounded-lg"></div>
          </div>
        </div>
      </div>
      <div class="card p-6 animate-pulse">
        <div class="h-6 bg-themed-secondary rounded w-32 mb-4"></div>
        <div class="space-y-3">
          <div v-for="i in 5" :key="i" class="h-12 bg-themed-secondary rounded-lg"></div>
        </div>
      </div>
    </div>
    
    <template v-else>
      <!-- 头部统计区 -->
      <div v-if="activeTab === 'overview'" class="card rounded-2xl p-4 sm:p-6 lg:p-7 mb-6">
        <div class="flex flex-col gap-5 xl:flex-row xl:items-stretch xl:justify-between">
          <div class="min-w-0 flex-1">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0 flex items-center gap-4">
                <div class="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border border-themed bg-themed-tertiary p-1.5 shadow-sm">
                  <UserAvatar
                    :username="authStore.user?.username || ''"
                    :email="authStore.user?.email"
                    :avatar-style="authStore.user?.avatarStyle || 'adventurer'"
                    :size="54"
                  />
                </div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="badge badge-default">{{ t('hostingWallet.hostingMember') }}</span>
                    <span
                      v-if="stats && stats.vipLevel > 0"
                      class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium"
                      :style="getVipBadgeInlineStyle(normalizeVipBadgeStyle(stats.vipBadgeStyle, stats.vipLevel))"
                    >
                      VIP{{ stats.vipLevel }}
                    </span>
                  </div>
                  <div class="mt-2 truncate text-lg font-semibold text-themed">{{ authStore.user?.username || '--' }}</div>
                  <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-themed-muted sm:text-sm">
                    <span v-for="item in hostMetaStats" :key="item.key">
                      {{ item.label }} {{ item.value }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap gap-2 sm:justify-end">
                <button
                  class="wallet-withdraw-btn wallet-withdraw-btn--hero"
                  :disabled="!canWithdraw"
                  @click="showWithdrawModal = true"
                >
                  <span class="wallet-withdraw-btn__icon">
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9l-5 5-5-5m10 6H7" />
                    </svg>
                  </span>
                  <span>{{ t('hostingWallet.withdraw.button') }}</span>
                </button>
                <button
                  class="btn btn-secondary"
                  @click="handleTabChange('withdrawals')"
                >
                  {{ t('hostingWallet.tabs.withdrawals') }}
                </button>
              </div>
            </div>

            <div class="mt-5 rounded-2xl border border-themed bg-themed-tertiary p-5 sm:p-6">
              <div class="text-xs font-medium uppercase tracking-[0.24em] text-themed-muted">
                {{ t('hostingWallet.balance.available') }}
              </div>
              <div class="mt-3 text-4xl font-semibold text-themed font-mono tabular-nums sm:text-5xl lg:text-6xl">
                {{ formatMoney(balance?.available || 0) }}
              </div>
              <div class="mt-4 flex flex-wrap items-center gap-2 text-sm text-themed-muted">
                <span class="inline-flex items-center rounded-full border border-themed bg-themed px-3 py-1 text-xs font-medium text-themed-secondary">
                  {{ t('hostingWallet.balance.frozenNote') }}
                </span>
                <span>{{ withdrawalHint }}</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 xl:w-[22rem]">
            <div
              v-for="item in headerStats"
              :key="item.key"
              :class="['rounded-2xl border p-4 sm:p-5', getMetricCardClass(item.tone)]"
            >
              <div class="text-xs font-medium uppercase tracking-[0.18em] text-themed-muted">
                {{ item.label }}
              </div>
              <div :class="['mt-3 text-xl font-semibold font-mono tabular-nums sm:text-2xl', getMetricValueClass(item.tone)]">
                {{ item.value }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'logs'" class="card rounded-2xl p-4 sm:p-5 mb-4">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-themed">{{ t('hostingWallet.tabs.logs') }}</div>
            <div class="mt-1 text-sm text-themed-muted">{{ t('hostingWallet.balance.frozenNote') }}</div>
          </div>
          <div class="grid grid-cols-3 gap-2 sm:gap-3 lg:w-auto">
            <div
              v-for="item in logSummaryStats"
              :key="item.key"
              :class="['rounded-xl border p-3 sm:p-4', getMetricCardClass(item.tone)]"
            >
              <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-themed-muted">
                {{ item.label }}
              </div>
              <div :class="['mt-2 text-base font-semibold font-mono tabular-nums sm:text-lg', getMetricValueClass(item.tone)]">
                {{ item.value }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'withdrawals'" class="card rounded-2xl p-4 sm:p-5 mb-4">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-themed">{{ t('hostingWallet.tabs.withdrawals') }}</div>
            <div class="mt-1 text-sm text-themed-muted">{{ withdrawalHint }}</div>
          </div>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div class="grid grid-cols-3 gap-2 sm:gap-3">
              <div
                v-for="item in withdrawalSummaryStats"
                :key="item.key"
                :class="['rounded-xl border p-3 sm:p-4', getMetricCardClass(item.tone)]"
              >
                <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-themed-muted">
                  {{ item.label }}
                </div>
                <div :class="['mt-2 text-base font-semibold font-mono tabular-nums sm:text-lg', getMetricValueClass(item.tone)]">
                  {{ item.value }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'blocks'" class="card rounded-2xl p-4 sm:p-5 mb-4">
        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="text-sm font-semibold text-themed">{{ t('hostingWallet.blocks.title') }}</div>
            <div class="mt-1 text-sm text-themed-muted">{{ t('hostingWallet.blocks.description') }}</div>
          </div>
          <div class="rounded-xl border border-themed bg-themed-tertiary px-4 py-3 text-sm text-themed-secondary">
            {{ t('hostingWallet.blocks.total', { count: blocks.length }) }}
          </div>
        </div>
      </div>

      <!-- 概览内容 -->
      <div v-if="activeTab === 'overview'" class="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.95fr)]">
        <div class="card rounded-2xl p-5 sm:p-6">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 class="text-base font-semibold text-themed">{{ t('hostingWallet.overview.howItWorks') }}</h3>
              <p class="mt-1 text-sm text-themed-muted">{{ t('hostingWallet.description') }}</p>
            </div>
            <span class="inline-flex w-fit items-center rounded-full border border-themed bg-themed-tertiary px-3 py-1 text-xs font-medium text-themed-secondary">
              {{ t('hostingWallet.balance.frozenNote') }}
            </span>
          </div>

          <div class="mt-5 grid gap-3 md:grid-cols-3">
            <div
              v-for="(step, index) in flowSteps"
              :key="step.key"
              :class="['rounded-2xl border p-4 sm:p-5', getFlowCardClass(index)]"
            >
              <div class="flex items-start gap-3">
                <div :class="['flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold', getFlowIndexClass(index)]">
                  {{ index + 1 }}
                </div>
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-themed">{{ step.title }}</div>
                  <div class="mt-1 text-sm leading-6 text-themed-muted">{{ step.desc }}</div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="hostingNotice"
            class="mt-5 rounded-2xl border border-sky-200/70 bg-sky-50/70 p-4 shadow-sm shadow-sky-100/40 dark:border-sky-900/30 dark:bg-sky-500/[0.06] dark:shadow-none sm:p-5"
          >
            <div class="flex items-center gap-2 text-sky-700 dark:text-sky-200">
              <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-white/90 shadow-sm dark:bg-white/[0.06]">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
                </svg>
              </div>
              <div class="text-sm font-semibold text-themed">{{ t('hostingWallet.notice.title') }}</div>
            </div>

            <div class="mt-3 rounded-xl border border-white/80 bg-white/85 p-4 shadow-sm shadow-sky-100/40 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none sm:p-5">
              <div class="whitespace-pre-line break-words text-sm leading-7 text-themed-secondary">
                {{ hostingNotice }}
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <div class="card rounded-2xl p-5 sm:p-6">
            <h3 class="text-base font-semibold text-themed">{{ t('hostingWallet.overview.title') }}</h3>
            <div class="mt-4 divide-y divide-themed">
              <div
                v-for="rule in overviewRules"
                :key="rule.key"
                class="py-4 first:pt-0 last:pb-0"
              >
                <div class="text-sm font-medium text-themed">{{ rule.title }}</div>
                <div class="mt-1 text-sm leading-6 text-themed-muted">{{ rule.desc }}</div>
              </div>
            </div>
          </div>

          <div :class="['rounded-2xl border p-5 sm:p-6', canWithdraw ? 'border-emerald-500/20 bg-emerald-500/[0.06]' : 'border-themed bg-themed-tertiary']">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-themed">{{ t('hostingWallet.withdraw.button') }}</div>
                <div class="mt-1 text-sm leading-6 text-themed-muted">{{ withdrawalHint }}</div>
              </div>
              <button
                class="wallet-withdraw-btn wallet-withdraw-btn--hero shrink-0"
                :disabled="!canWithdraw"
                @click="showWithdrawModal = true"
              >
                <span class="wallet-withdraw-btn__icon">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9l-5 5-5-5m10 6H7" />
                  </svg>
                </span>
                <span>{{ t('hostingWallet.withdraw.button') }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 收支明细 -->
      <div v-if="activeTab === 'logs'" class="card rounded-2xl">
        <!-- 搜索和筛选 -->
        <div class="border-b border-themed p-4 sm:p-5">
          <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div class="flex w-full items-center gap-2 xl:max-w-xl">
              <div class="relative flex-1">
                <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  v-model="logsSearchInput"
                  type="text"
                  :placeholder="t('hostingWallet.logs.searchPlaceholder')"
                  class="input h-12 rounded-xl bg-themed pl-9"
                  @keyup.enter="handleLogsSearch"
                />
              </div>
              <button
                class="btn btn-secondary h-12 shrink-0 whitespace-nowrap px-4 sm:px-5"
                @click="handleLogsSearch"
              >
                {{ t('common.search') }}
              </button>
            </div>

            <div class="flex flex-col gap-3 lg:flex-row lg:items-center xl:justify-end">
              <div class="w-full lg:w-auto">
                <div class="flex w-full min-w-0 gap-1 rounded-2xl border border-themed bg-themed-tertiary p-1 lg:inline-flex lg:min-w-max">
                  <button
                    v-for="filter in logFilterOptions"
                    :key="filter.key"
                    class="min-w-0 flex-1 whitespace-nowrap rounded-xl px-2.5 py-2 text-sm font-medium transition-all lg:flex-none lg:px-4"
                    :class="logsFilter === filter.key
                      ? 'bg-themed text-themed shadow-sm border border-themed'
                      : 'text-themed-muted hover:bg-themed-hover hover:text-themed'"
                    @click="handleLogsFilterChange(filter.key)"
                  >
                    {{ filter.label }}
                  </button>
                </div>
              </div>

              <select
                v-model="logsPageSize"
                class="input w-full rounded-xl bg-themed lg:w-auto"
                @change="handleLogsPageSizeChange"
              >
                <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }} {{ t('hostingWallet.perPage') }}</option>
              </select>
            </div>
          </div>
        </div>
        
        <!-- 骨架屏加载态 -->
        <div v-if="logsLoading" class="p-4 space-y-3">
          <div v-for="i in 5" :key="i" class="animate-pulse">
            <div class="flex items-center gap-4 p-4 bg-themed-secondary rounded-lg">
              <div class="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
              <div class="flex-1 space-y-2">
                <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
              </div>
              <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
            </div>
          </div>
        </div>
        
        <!-- 空状态 -->
        <div v-else-if="logs.length === 0" class="p-12 text-center">
          <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-themed-secondary flex items-center justify-center">
            <svg class="w-8 h-8 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div class="text-base font-medium text-themed">{{ logsSearch ? t('common.noSearchResults') : t('hostingWallet.logs.noRecords') }}</div>
          <div class="text-sm text-themed-muted mt-1">{{ t('hostingWallet.logs.emptyHint') }}</div>
        </div>
        
        <template v-else>
          <!-- PC端表格 -->
          <div class="hidden md:block overflow-x-auto">
            <table class="w-full">
              <thead class="bg-themed-secondary">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.logs.columns.type') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.logs.columns.amount') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.logs.columns.status') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.logs.columns.buyer') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.logs.columns.instance') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.logs.columns.time') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-themed">
                <tr v-for="log in logs" :key="log.id" :class="['hover:bg-themed-secondary transition-colors', { 'opacity-60': log.instance?.deleted }]">
                  <td class="px-4 py-3">
                    <span :class="['badge', getActionTypeBadgeClass(log.actionType)]">
                      {{ getActionTypeLabel(log.actionType) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span :class="['font-mono font-semibold', log.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
                      {{ log.amount >= 0 ? '+' : '' }}{{ formatMoney(log.amount) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span v-if="log.frozen" class="inline-flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400 text-sm">
                      <span class="w-2 h-2 bg-yellow-500 rounded-full"></span>
                      {{ t('hostingWallet.logs.status.frozen') }}
                    </span>
                    <span v-else class="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                      <span class="w-2 h-2 bg-green-500 rounded-full"></span>
                      {{ t('hostingWallet.logs.status.unfrozen') }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <div v-if="log.instance" class="flex items-center gap-2">
                      <UserAvatar :username="log.instance.buyer.username" :avatar-style="log.instance.buyer.avatarStyle" :badge-id="log.instance.buyer.avatarBadgeId || null" :size="28" class="shrink-0" />
                      <span class="text-sm text-themed truncate max-w-[120px]">{{ log.instance.buyer.username || t('hostingWallet.logs.unknownUser') }}</span>
                    </div>
                    <span v-else class="text-themed-muted">-</span>
                  </td>
                  <td class="px-4 py-3">
                    <template v-if="log.instance">
                      <div class="text-sm text-themed">
                        <RouterLink
                          :to="{ name: 'instance-detail', params: { id: log.instance.id } }"
                          class="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:underline font-mono"
                        >
                          {{ log.instance.id }}
                        </RouterLink>
                        <span class="mx-1">{{ log.instance.name }}</span>
                        <span v-if="log.instance.deleted" class="text-xs text-themed-muted">({{ t('common.deleted') }})</span>
                      </div>
                      <div class="text-xs text-themed-muted">
                        <RouterLink
                          :to="{ name: 'my-host-detail', params: { id: log.instance.host.id } }"
                          class="hover:text-blue-500 dark:hover:text-blue-400 hover:underline"
                        >
                          {{ log.instance.host.name }}
                        </RouterLink>
                      </div>
                    </template>
                    <span v-else class="text-sm text-themed-muted">-</span>
                  </td>
                  <td class="px-4 py-3 text-sm text-themed-muted whitespace-nowrap">{{ formatShortDate(log.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <!-- 移动端卡片 -->
          <div class="md:hidden p-4 space-y-2">
            <div
              v-for="log in logs"
              :key="log.id"
              :class="['rounded-lg border border-themed', { 'opacity-60': log.instance?.deleted }]"
            >
              <!-- 无实例信息的紧凑卡片（提现、扣余额等） -->
              <div v-if="!log.instance" class="flex items-center justify-between gap-2 px-4 py-3">
                <div class="flex items-center gap-2">
                  <span :class="['badge', getActionTypeBadgeClass(log.actionType)]">
                    {{ getActionTypeLabel(log.actionType) }}
                  </span>
                  <span :class="['font-mono font-semibold text-sm', log.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
                    {{ log.amount >= 0 ? '+' : '' }}{{ formatMoney(log.amount) }}
                  </span>
                </div>
                <span class="text-xs text-themed-muted whitespace-nowrap">{{ formatShortDate(log.createdAt) }}</span>
              </div>

              <!-- 有实例信息的详细卡片 -->
              <template v-else>
                <div class="px-4 pt-3 pb-2">
                  <!-- 第一行：类型 + 金额 -->
                  <div class="flex items-center justify-between gap-2 mb-2">
                    <span :class="['badge', getActionTypeBadgeClass(log.actionType)]">
                      {{ getActionTypeLabel(log.actionType) }}
                    </span>
                    <span :class="['font-mono font-semibold text-sm', log.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
                      {{ log.amount >= 0 ? '+' : '' }}{{ formatMoney(log.amount) }}
                    </span>
                  </div>
                  <!-- 第二行：购买者 -->
                  <div class="flex items-center gap-2">
                    <UserAvatar :username="log.instance.buyer.username" :avatar-style="log.instance.buyer.avatarStyle" :badge-id="log.instance.buyer.avatarBadgeId || null" :size="20" class="shrink-0" />
                    <span class="text-sm text-themed truncate">{{ log.instance.buyer.username }}</span>
                  </div>
                </div>
                <!-- 底栏：实例信息 + 时间 -->
                <div class="flex items-center justify-between gap-2 px-4 py-2 border-t border-themed text-xs text-themed-muted">
                  <span class="truncate">
                    <RouterLink
                      :to="{ name: 'instance-detail', params: { id: log.instance.id } }"
                      class="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:underline font-mono"
                    >{{ log.instance.id }}</RouterLink>
                    <span class="mx-0.5">{{ log.instance.name }}</span>
                    <span v-if="log.instance.deleted" class="text-themed-muted">({{ t('common.deleted') }})</span>
                    <span class="mx-0.5">·</span>
                    <RouterLink
                      :to="{ name: 'my-host-detail', params: { id: log.instance.host.id } }"
                      class="hover:text-blue-500 dark:hover:text-blue-400 hover:underline"
                    >{{ log.instance.host.name }}</RouterLink>
                  </span>
                  <span class="whitespace-nowrap">{{ formatShortDate(log.createdAt) }}</span>
                </div>
              </template>
            </div>
          </div>
        </template>
        
        <!-- 分页 -->
        <div v-if="logsTotalPages > 1" class="p-4 border-t border-themed flex items-center justify-between">
          <span class="text-sm text-themed-muted">{{ t('common.total') }} {{ logsTotal }} {{ t('common.items') }}</span>
          <div class="flex items-center gap-2">
            <button
              :disabled="logsPage === 1"
              class="btn btn-sm btn-ghost"
              @click="loadLogs(logsPage - 1)"
            >
              {{ t('hostingWallet.prevPage') }}
            </button>
            <span class="text-sm text-themed-muted px-2">{{ logsPage }} / {{ logsTotalPages }}</span>
            <button
              :disabled="logsPage >= logsTotalPages"
              class="btn btn-sm btn-ghost"
              @click="loadLogs(logsPage + 1)"
            >
              {{ t('hostingWallet.nextPage') }}
            </button>
          </div>
        </div>
      </div>
      
      <!-- 提现记录 -->
      <div v-if="activeTab === 'withdrawals'" class="card rounded-2xl">
        <!-- 分页控制 -->
        <div class="border-b border-themed p-4 sm:p-5">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div class="text-sm font-medium text-themed">{{ t('hostingWallet.tabs.withdrawals') }}</div>
              <div class="mt-1 text-sm text-themed-muted">{{ t('common.total') }} {{ withdrawalsTotal }} {{ t('common.items') }}</div>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                v-model="withdrawalsPageSize"
                class="input w-full rounded-xl bg-themed sm:w-auto"
                @change="handleWithdrawalsPageSizeChange"
              >
                <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }} {{ t('hostingWallet.perPage') }}</option>
              </select>
            </div>
          </div>
        </div>
        
        <!-- 骨架屏加载态 -->
        <div v-if="withdrawalsLoading" class="p-4 space-y-3">
          <div v-for="i in 3" :key="i" class="animate-pulse">
            <div class="flex items-center gap-4 p-4 bg-themed-secondary rounded-lg">
              <div class="flex-1 space-y-2">
                <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
              </div>
              <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
            </div>
          </div>
        </div>
        
        <!-- 空状态 -->
        <div v-else-if="withdrawals.length === 0" class="p-12 text-center">
          <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-themed-secondary flex items-center justify-center">
            <svg class="w-8 h-8 text-themed-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 12V8H6a2 2 0 01-2-2c0-1.1.9-2 2-2h12v4M4 6v12a2 2 0 002 2h14v-4M18 12a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
          </div>
          <div class="text-base font-medium text-themed">{{ t('hostingWallet.withdrawals.emptyTitle') }}</div>
          <div class="text-sm text-themed-muted mt-1">{{ t('hostingWallet.withdrawals.emptyHint') }}</div>
          <button
            v-if="canWithdraw"
            class="wallet-withdraw-btn wallet-withdraw-btn--hero mt-4"
            @click="showWithdrawModal = true"
          >
            <span class="wallet-withdraw-btn__icon">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9l-5 5-5-5m10 6H7" />
              </svg>
            </span>
            <span>{{ t('hostingWallet.withdrawals.startEarning') }}</span>
          </button>
        </div>
        
        <template v-else>
          <!-- PC端表格 -->
          <div class="hidden md:block overflow-x-auto">
            <table class="w-full">
              <thead class="bg-themed-secondary">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.withdrawals.columns.amount') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.withdrawals.columns.actualAmount') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.withdrawals.columns.target') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.withdrawals.columns.status') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-themed-muted uppercase">{{ t('hostingWallet.withdrawals.columns.time') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-themed">
                <tr v-for="w in withdrawals" :key="w.id" class="hover:bg-themed-secondary transition-colors">
                  <td class="px-4 py-3 font-mono text-sm text-themed">{{ formatMoney(w.amount) }}</td>
                  <td class="px-4 py-3 font-mono text-sm font-semibold text-green-600 dark:text-green-400">{{ formatMoney(w.actualAmount) }}</td>
                  <td class="px-4 py-3 text-sm text-themed">{{ t('hostingWallet.withdrawals.target.balance') }}</td>
                  <td class="px-4 py-3">
                    <span :class="['badge', getStatusClass(w.status)]">
                      {{ getStatusLabel(w.status) }}
                    </span>
                    <div v-if="w.rejectReason" class="text-xs text-red-500 mt-1">{{ w.rejectReason }}</div>
                  </td>
                  <td class="px-4 py-3 text-sm text-themed-muted whitespace-nowrap">{{ formatDate(w.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <!-- 移动端卡片 -->
          <div class="md:hidden p-4 space-y-3">
            <div v-for="w in withdrawals" :key="w.id" class="p-4 bg-themed-secondary rounded-lg">
              <div class="flex items-center justify-between mb-2">
                <span class="font-mono font-semibold text-lg text-themed">{{ formatMoney(w.amount) }}</span>
                <span :class="['badge', getStatusClass(w.status)]">
                  {{ getStatusLabel(w.status) }}
                </span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-themed-muted">{{ t('hostingWallet.withdrawals.columns.actualAmount') }}</span>
                <span class="font-mono font-semibold text-green-600 dark:text-green-400">{{ formatMoney(w.actualAmount) }}</span>
              </div>
              <div class="flex items-center justify-between text-sm mt-1">
                <span class="text-themed-muted">{{ t('hostingWallet.withdrawals.columns.time') }}</span>
                <span class="text-themed">{{ formatShortDate(w.createdAt) }}</span>
              </div>
              <div v-if="w.rejectReason" class="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{{ w.rejectReason }}</div>
            </div>
          </div>
        </template>
        
        <!-- 分页 -->
        <div v-if="withdrawalsTotalPages > 1" class="p-4 border-t border-themed flex justify-center">
          <div class="flex items-center gap-2">
            <button
              :disabled="withdrawalsPage === 1"
              class="btn btn-sm btn-ghost"
              @click="loadWithdrawals(withdrawalsPage - 1)"
            >
              {{ t('hostingWallet.prevPage') }}
            </button>
            <span class="text-sm text-themed-muted px-2">{{ withdrawalsPage }} / {{ withdrawalsTotalPages }}</span>
            <button
              :disabled="withdrawalsPage >= withdrawalsTotalPages"
              class="btn btn-sm btn-ghost"
              @click="loadWithdrawals(withdrawalsPage + 1)"
            >
              {{ t('hostingWallet.nextPage') }}
            </button>
          </div>
        </div>
      </div>

      <!-- 黑名单 -->
      <div v-if="activeTab === 'blocks'" class="space-y-4">
        <div class="card rounded-2xl p-4 sm:p-5">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div class="flex-1">
              <label class="mb-2 block text-sm font-medium text-themed">{{ t('hostingWallet.blocks.searchLabel') }}</label>
              <input
                v-model="blockSearch"
                type="text"
                class="input h-12 rounded-xl bg-themed"
                :placeholder="t('hostingWallet.blocks.searchPlaceholder')"
                @keyup.enter="searchBlockCandidates"
              />
            </div>
            <button
              class="btn btn-primary h-12 px-5"
              :disabled="blockSearching"
              @click="searchBlockCandidates"
            >
              {{ blockSearching ? t('common.loading') : t('common.search') }}
            </button>
          </div>

          <div v-if="blockCandidates.length > 0" class="mt-4 divide-y divide-themed rounded-xl border border-themed">
            <div
              v-for="candidate in blockCandidates"
              :key="candidate.id"
              class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex min-w-0 items-center gap-3">
                <UserAvatar
                  :username="candidate.username"
                  :email="candidate.email"
                  :avatar-style="candidate.avatarStyle"
                  :badge-id="candidate.avatarBadgeId || null"
                  :size="36"
                />
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-themed">{{ candidate.username }}</div>
                  <div class="truncate text-xs text-themed-muted">UID {{ candidate.id }} · {{ candidate.email || t('common.notSet') }}</div>
                </div>
              </div>
              <button
                v-if="candidate.blocked"
                class="btn btn-secondary btn-sm"
                :disabled="blockActionLoading === candidate.id"
                @click="unblockUser(candidate.id)"
              >
                {{ t('hostingWallet.blocks.unblock') }}
              </button>
              <button
                v-else
                class="btn btn-danger btn-sm"
                :disabled="blockActionLoading === candidate.id"
                @click="blockUser(candidate.id)"
              >
                {{ t('hostingWallet.blocks.block') }}
              </button>
            </div>
          </div>
          <div v-else-if="blockSearch.trim().length >= 2 && !blockSearching" class="mt-4 rounded-xl border border-themed p-4 text-sm text-themed-muted">
            {{ t('hostingWallet.blocks.noSearchResults') }}
          </div>
        </div>

        <div class="card rounded-2xl">
          <div class="border-b border-themed p-4 sm:p-5">
            <div class="text-sm font-medium text-themed">{{ t('hostingWallet.blocks.blockedUsers') }}</div>
            <div class="mt-1 text-sm text-themed-muted">{{ t('hostingWallet.blocks.effectHint') }}</div>
          </div>

          <div v-if="blocksLoading" class="p-8 text-center text-themed-muted">
            {{ t('common.loading') }}
          </div>
          <div v-else-if="blocks.length === 0" class="p-12 text-center">
            <div class="text-base font-medium text-themed">{{ t('hostingWallet.blocks.emptyTitle') }}</div>
            <div class="mt-1 text-sm text-themed-muted">{{ t('hostingWallet.blocks.emptyHint') }}</div>
          </div>
          <div v-else class="divide-y divide-themed">
            <div
              v-for="block in blocks"
              :key="block.id"
              class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex min-w-0 items-center gap-3">
                <UserAvatar
                  :username="block.username"
                  :email="block.email"
                  :avatar-style="block.avatarStyle"
                  :badge-id="block.avatarBadgeId || null"
                  :size="38"
                />
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-themed">{{ block.username }}</div>
                  <div class="truncate text-xs text-themed-muted">
                    UID {{ block.blockedUserId }} · {{ block.email || t('common.notSet') }} · {{ formatShortDate(block.createdAt) }}
                  </div>
                </div>
              </div>
              <button
                class="btn btn-secondary btn-sm"
                :disabled="blockActionLoading === block.blockedUserId"
                @click="unblockUser(block.blockedUserId)"
              >
                {{ t('hostingWallet.blocks.unblock') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
    
    <!-- 提现弹窗 -->
    <Teleport to="body">
      <div v-if="showWithdrawModal" class="modal-overlay">
        <div class="modal-backdrop" @click="showWithdrawModal = false"></div>
        <div class="modal-content max-w-md">
          <div class="modal-header">
            <h3 class="modal-title">{{ t('hostingWallet.modal.title') }}</h3>
            <button class="btn btn-ghost btn-sm" @click="showWithdrawModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body space-y-4">
            <div>
              <label class="label">{{ t('hostingWallet.modal.amount') }}</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-themed-muted font-medium">¥</span>
                <input
                  v-model.number="withdrawForm.amount"
                  type="number"
                  :min="config?.minWithdrawalAmount || 10"
                  :max="balance?.available || 0"
                  class="input w-full pl-7 font-mono"
                />
              </div>
              <div class="text-xs text-themed-muted mt-2">{{ t('hostingWallet.modal.availableNote', { amount: formatMoney(balance?.available || 0) }) }}</div>
            </div>
            
            <div class="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div class="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                <span class="text-sm font-medium">{{ t('hostingWallet.modal.targetBalance', { rate: ((config?.feeRateBalance || 0.05) * 100).toFixed(0) }) }}</span>
              </div>
              <div class="text-xs text-blue-600 dark:text-blue-400 mt-2">
                {{ t('hostingWallet.modal.manualWithdrawNote') }}
              </div>
            </div>
            
            <div class="bg-themed-secondary rounded-lg p-4 space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ t('hostingWallet.modal.summary.amount') }}</span>
                <span class="font-mono text-themed">{{ formatMoney(withdrawForm.amount) }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ t('hostingWallet.modal.summary.fee') }}</span>
                <span class="font-mono text-red-500">-{{ formatMoney(withdrawForm.amount - estimatedAmount) }}</span>
              </div>
              <div class="flex justify-between text-base pt-2 border-t border-themed">
                <span class="font-medium text-themed">{{ t('hostingWallet.modal.summary.actual') }}</span>
                <span class="font-mono font-bold text-green-600 dark:text-green-400">{{ formatMoney(estimatedAmount) }}</span>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showWithdrawModal = false">
              {{ t('hostingWallet.modal.cancel') }}
            </button>
            <button
              :disabled="withdrawing"
              class="btn btn-primary"
              @click="submitWithdraw"
            >
              <span v-if="withdrawing" class="loading loading-spinner loading-sm mr-2"></span>
              {{ withdrawing ? t('hostingWallet.modal.submitting') : t('hostingWallet.modal.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 类型标签样式 */
.badge-success {
  @apply bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400;
}
.badge-warning {
  @apply bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400;
}
.badge-error {
  @apply bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400;
}
.badge-info {
  @apply bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400;
}

.wallet-withdraw-btn {
  @apply inline-flex items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none;
}

.wallet-withdraw-btn--hero {
  @apply h-11 px-4;
}

.wallet-withdraw-btn--compact {
  @apply h-12 px-4;
}

.wallet-withdraw-btn__icon {
  @apply flex h-8 w-8 items-center justify-center rounded-xl transition-colors duration-200;
}

.light .wallet-withdraw-btn {
  @apply border-gray-900 bg-gray-900 text-white shadow-sm hover:border-gray-800 hover:bg-gray-800;
  --tw-ring-offset-color: #ffffff;
}

.dark .wallet-withdraw-btn {
  @apply border-white bg-white text-gray-900 shadow-sm hover:bg-gray-100;
  --tw-ring-offset-color: #0a0a0a;
}

.light .wallet-withdraw-btn__icon {
  @apply bg-white/10 text-white;
}

.dark .wallet-withdraw-btn__icon {
  @apply bg-gray-900/10 text-gray-900;
}

.light .wallet-withdraw-btn:disabled {
  @apply border-gray-200 bg-gray-100 text-gray-400 shadow-none;
}

.dark .wallet-withdraw-btn:disabled {
  @apply border-gray-800 bg-gray-900 text-gray-500 shadow-none;
}

.light .wallet-withdraw-btn:disabled .wallet-withdraw-btn__icon {
  @apply bg-gray-200 text-gray-400;
}

.dark .wallet-withdraw-btn:disabled .wallet-withdraw-btn__icon {
  @apply bg-white/5 text-gray-500;
}
</style>
