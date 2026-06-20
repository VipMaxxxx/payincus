<script setup lang="ts">
import { ref, onMounted, onUnmounted, onActivated, onDeactivated, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import { getLocalizedCountryName } from '@/utils/countryDisplay'
import { formatMemory, formatDisk, formatBytes, getStatusInfo } from '@/utils/formatters'
import { translateError } from '@/utils/errorHandler'
import type { Instance, UserBalance } from '@/types/api'
import FlagIcon from '@/components/FlagIcon.vue'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import InstanceDisplayIcon from '@/components/InstanceDisplayIcon.vue'
import InstanceOrderMenu from '@/components/instance/InstanceOrderMenu.vue'
import { freeSiteCopy, getFreeSiteBillingCycleLabel } from '@/utils/freeSiteFun'

// 为 KeepAlive include 匹配定义组件名称（必须在所有 import 之后）
defineOptions({ name: 'InstancesView' })

type InstanceLayoutMode = 'list' | 'card'
const INSTANCE_LAYOUT_STORAGE_KEY = 'incudal.instances.layout'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const authStore = useAuthStore()
const configStore = useConfigStore()
const themeStore = useThemeStore()
const toast = useToast()
void configStore.loadPublicConfig()

const instances = ref<Instance[]>([])
const loading = ref<boolean>(true)
const actionLoading = ref<Record<number, string>>({})
const orderLoading = ref<boolean>(false)
const recentlyOrderedInstanceId = ref<number | null>(null)
const batchActionLoading = ref<string>('')

// 搜索和分页
const search = ref<string>('')
const page = ref<number>(1)
const pageSize = ref<number>(30)
const total = ref<number>(0)
const totalPages = ref<number>(0)
const pageSizeOptions = [10, 20, 30, 50, 100]
const countryFilter = ref<string | null>(null)
const availableCountries = ref<string[]>([])
const userSelectedLayout = ref<InstanceLayoutMode | null>(null)
const isDesktopViewport = ref<boolean>(true)

// 批量选择
const selectedIds = ref<Set<number>>(new Set())

// 批量续费
const showBatchRenewModal = ref(false)
const batchRenewLoading = ref(false)
const batchRenewSubmitting = ref(false)
const batchRenewMonths = ref<number>(1)
const batchRenewBalance = ref<UserBalance>({ balance: 0, frozen: 0, totalRecharge: 0, totalConsume: 0 })
const batchRenewPreview = ref<Array<{
  id: number
  name: string
  canRenew: boolean
  autoRenew: boolean
  reason?: string
  isHostedInstance: boolean
  daysUntilExpire: number | null
  options: Array<{
    months: number
    price: number
    discountedPrice: number
    expiresAt: string
  }>
}>>([])

// 批量销毁
const showBatchDestroyModal = ref(false)
const batchDestroyLoading = ref(false)
const batchDestroySubmitting = ref(false)
const batchDestroyConfirm = ref('')
const batchDestroyPreview = ref<Array<{
  id: number
  name: string
  canDestroy: boolean
  cannotDestroyReason: string
  isFreeInstance: boolean
  isFirstTime: boolean
  feeWaiverEligible: boolean
  refund: {
    remainingDays: number
    remainingValue: number
    feeRate: number
    feeAmount: number
    refundAmount: number
    destroyCount: number
    maxRefundable: number
  }
  instance: {
    id: number
    name: string
    hostName: string
    planName: string | null
  }
}>>([])

// 筛选条件（从 URL 获取）
const filterUserId = ref<number | null>(null)
const filterUserName = ref<string>('')

const isAllSelected = computed(() => instances.value.length > 0 && selectedIds.value.size === instances.value.length)
const isPartialSelected = computed(() => selectedIds.value.size > 0 && selectedIds.value.size < instances.value.length)
const selectedCount = computed(() => selectedIds.value.size)
const selectedInstances = computed(() => instances.value.filter(instance => selectedIds.value.has(instance.id)))
const selectedRunningCount = computed(() => selectedInstances.value.filter(instance => instance.status?.toLowerCase() === 'running').length)
const selectedStoppedCount = computed(() => selectedInstances.value.filter(instance => instance.status?.toLowerCase() === 'stopped').length)
const selectedPaidCount = computed(() => selectedInstances.value.filter(instance => !!instance.packagePlanId).length)
const hasSelectedInstances = computed(() => selectedCount.value > 0)
const isViewingAnotherUsersInstances = computed(() => (
  isAdmin.value &&
  filterUserId.value !== null &&
  filterUserId.value !== (authStore.user?.id || null)
))
const countryFilterOptions = computed(() => availableCountries.value.map(code => code.toLowerCase()))
const instanceLayoutMode = computed<InstanceLayoutMode>(() => (
  isDesktopViewport.value
    ? (userSelectedLayout.value || 'list')
    : 'card'
))
const isCardLayout = computed<boolean>(() => instanceLayoutMode.value === 'card')

const batchRenewMonthOptions = computed(() => {
  const options = new Set<number>()
  for (const item of batchRenewPreview.value) {
    if (!item.canRenew) continue
    for (const option of item.options) {
      options.add(option.months)
    }
  }
  return Array.from(options).sort((a, b) => a - b)
})

const batchRenewEligibleItems = computed(() => {
  return batchRenewPreview.value
    .map(item => ({
      ...item,
      selectedOption: item.options.find(option => option.months === batchRenewMonths.value) || null
    }))
    .filter(item => item.selectedOption !== null)
})

const batchRenewIneligibleItems = computed(() => {
  return batchRenewPreview.value.filter(item => !item.canRenew || !item.options.some(option => option.months === batchRenewMonths.value))
})

const batchRenewTotal = computed(() => {
  return batchRenewEligibleItems.value.reduce((sum, item) => sum + Number(item.selectedOption?.discountedPrice || 0), 0)
})

const batchRenewInsufficientBalance = computed(() => batchRenewBalance.value.balance < batchRenewTotal.value)
const batchRenewBalanceAfter = computed(() => batchRenewBalance.value.balance - batchRenewTotal.value)
const batchRenewCanSubmit = computed(() => (
  batchRenewEligibleItems.value.length > 0 &&
  batchRenewMonthOptions.value.length > 0 &&
  !batchRenewInsufficientBalance.value &&
  !batchRenewSubmitting.value
))

const batchDestroyEligibleItems = computed(() => batchDestroyPreview.value.filter(item => item.canDestroy))
const batchDestroyIneligibleItems = computed(() => batchDestroyPreview.value.filter(item => !item.canDestroy))
const batchDestroyTotalRefund = computed(() => batchDestroyEligibleItems.value.reduce((sum, item) => sum + item.refund.refundAmount, 0))
const batchDestroyTotalFee = computed(() => batchDestroyEligibleItems.value.reduce((sum, item) => sum + item.refund.feeAmount, 0))
const batchDestroyCanSubmit = computed(() => batchDestroyEligibleItems.value.length > 0 && batchDestroyConfirm.value === 'DESTROY' && !batchDestroySubmitting.value)
const isInstanceOrderView = computed(() => search.value.trim() === '' && countryFilter.value === null)
const canReorderInstances = computed(() => (
  isInstanceOrderView.value &&
  (
    !isAdmin.value ||
    filterUserId.value === (authStore.user?.id || null)
  )
))

let refreshInterval: ReturnType<typeof setInterval> | null = null
let orderFeedbackTimer: ReturnType<typeof setTimeout> | null = null

// 监听搜索变化（防抖）
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadInstances()
  }, 300)
})

// 监听路由参数变化（管理员切换查看不同用户的实例）
watch(
  () => route.query.userId,
  async (newUserId, oldUserId) => {
    if (newUserId === oldUserId) return
    
    // 更新筛选条件
    if (newUserId) {
      filterUserId.value = parseInt(newUserId as string)
      // 获取用户名
      try {
        const res = await api.users.get(filterUserId.value)
        filterUserName.value = (res as { user?: { username?: string } }).user?.username || ''
      } catch {
        filterUserName.value = ''
      }
    } else {
      filterUserId.value = null
      filterUserName.value = ''
    }
    
    // 重置分页并重新加载
    page.value = 1
    loading.value = true
    await loadInstances()
  },
  { immediate: false }
)

// 判断是否为管理员
const isAdmin = computed<boolean>(() => authStore.user?.role === 'admin')

function updateViewportState(): void {
  if (typeof window === 'undefined') return
  isDesktopViewport.value = window.innerWidth >= 1024
}

function loadInstanceLayoutPreference(): void {
  if (typeof window === 'undefined') return
  try {
    const stored = localStorage.getItem(INSTANCE_LAYOUT_STORAGE_KEY)
    userSelectedLayout.value = stored === 'list' || stored === 'card' ? stored : null
  } catch {
    userSelectedLayout.value = null
  }
}

function setInstanceLayoutMode(mode: InstanceLayoutMode): void {
  userSelectedLayout.value = mode
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(INSTANCE_LAYOUT_STORAGE_KEY, mode)
  } catch {
    // ignore storage errors
  }
}

onMounted(async (): Promise<void> => {
  updateViewportState()
  loadInstanceLayoutPreference()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateViewportState)
  }

  // 从 URL 获取 userId 参数（首次加载）
  if (route.query.userId) {
    filterUserId.value = parseInt(route.query.userId as string)
    // 获取用户名
    try {
      const res = await api.users.get(filterUserId.value)
      filterUserName.value = (res as { user?: { username?: string } }).user?.username || ''
    } catch {
      // 忽略错误
    }
  } else {
    // 确保没有 userId 时清空筛选
    filterUserId.value = null
    filterUserName.value = ''
  }
  
  await loadInstances()
  // 每 15 秒自动刷新
  refreshInterval = setInterval(loadInstances, 15000)
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateViewportState)
  }
  if (refreshInterval) clearInterval(refreshInterval)
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  clearInstanceOrderFeedback()
})

// 当组件被 KeepAlive 停用时，暂停定时器
onDeactivated(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  clearInstanceOrderFeedback()
})

// 当组件从 KeepAlive 缓存中激活时，重新加载数据
onActivated(async () => {
  updateViewportState()
  // 恢复定时刷新
  if (!refreshInterval) {
    refreshInterval = setInterval(loadInstances, 15000)
  }
  
  // 检查路由参数是否与当前筛选一致
  const currentUserId = route.query.userId ? parseInt(route.query.userId as string) : null
  
  if (currentUserId !== filterUserId.value) {
    // 路由参数已变化，更新筛选并重新加载
    if (currentUserId) {
      filterUserId.value = currentUserId
      try {
        const res = await api.users.get(filterUserId.value)
        filterUserName.value = (res as { user?: { username?: string } }).user?.username || ''
      } catch {
        filterUserName.value = ''
      }
    } else {
      filterUserId.value = null
      filterUserName.value = ''
    }
    page.value = 1
  }
  
  // 总是重新加载数据以确保最新
  await loadInstances()
})

async function loadInstances(force = false): Promise<void> {
  // 如果有操作进行中，跳过刷新
  if (
    !force &&
    loading.value === false &&
    (
      Object.keys(actionLoading.value).length > 0 ||
      orderLoading.value ||
      batchActionLoading.value ||
      batchRenewSubmitting.value ||
      batchDestroySubmitting.value
    )
  ) return
  
  try {
    const params: { page: number; pageSize: number; search: string; userId?: number } = {
      page: page.value,
      pageSize: pageSize.value,
      search: search.value
    }
    
    if (filterUserId.value) {
      params.userId = filterUserId.value
    }

    if (countryFilter.value) {
      ;(params as typeof params & { countryCode?: string }).countryCode = countryFilter.value
    }
    
    const response = await api.instances.list(params)
    const data = response as { instances?: Instance[]; total?: number; totalPages?: number; availableCountries?: string[] }
    const nextInstances = data.instances || []
    instances.value = nextInstances
    total.value = data.total || 0
    totalPages.value = Math.max(1, data.totalPages || 1)
    availableCountries.value = (data.availableCountries || []).map(code => code.toLowerCase())

    if (page.value > totalPages.value) {
      page.value = totalPages.value
      return loadInstances(force)
    }

    const visibleIds = new Set(nextInstances.map(instance => instance.id))
    selectedIds.value = new Set([...selectedIds.value].filter(id => visibleIds.has(id)))
  } catch (error) {
    console.error('Failed to load instances:', error)
  } finally {
    loading.value = false
  }
}

function toggleSelectAll(): void {
  if (isAllSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(instances.value.map(instance => instance.id))
  }
}

function toggleSelect(id: number): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

function clearSelection(): void {
  selectedIds.value = new Set()
}

function setCountryFilter(code: string | null): void {
  if (countryFilter.value === code) return
  countryFilter.value = code
  page.value = 1
  clearSelection()
  void loadInstances()
}

function getCountryLabel(code: string): string {
  return getLocalizedCountryName(code, locale.value, (key, fallback) => t(key, fallback))
}

function handleCountryStripWheel(event: WheelEvent): void {
  const container = event.currentTarget as HTMLElement | null
  if (!container) return
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  container.scrollLeft += event.deltaY
  event.preventDefault()
}

function handlePageSizeChange(): void {
  page.value = 1
  clearSelection()
  void loadInstances()
}

function goToPage(nextPage: number): void {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  clearSelection()
  void loadInstances()
}

function formatCurrency(value: number | null | undefined): string {
  if (configStore.freeSiteMode) return freeSiteCopy.moneyJustForShow
  return `¥${Number(value || 0).toFixed(2)}`
}

function getBatchRenewMonthsLabel(months: number): string {
  return configStore.freeSiteMode ? getFreeSiteBillingCycleLabel(months) : t('billing.renewMonths', { months })
}

function getInstanceLayoutButtonClass(mode: InstanceLayoutMode): string {
  const active = instanceLayoutMode.value === mode
  if (active) {
    return themeStore.isDark
      ? 'bg-white text-gray-900 shadow-sm'
      : 'bg-gray-900 text-white shadow-sm'
  }
  return themeStore.isDark
    ? 'text-gray-400 hover:text-gray-100'
    : 'text-gray-500 hover:text-gray-900'
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return formatExpiryDate(date)
}

function clearUserFilter(): void {
  clearSelection()
  page.value = 1
  filterUserId.value = null
  filterUserName.value = ''
  router.replace({ query: {} })
  void loadInstances()
}

// 遮蔽 IPv4 地址后两位，例如：1.2.3.4 -> 1.2.*.*
function maskIpv4(ip: string | null | undefined): string | null {
  if (!ip) return null
  const parts = ip.split('.')
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`
  }
  return ip
}

function isIpv4Address(ip: string | null | undefined): boolean {
  if (!ip) return false
  return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip)
}

function getHostIpv6(instance: Instance): string | null {
  let hostIpv6 = instance.hostNatPublicIpv6 || null
  if (!hostIpv6 && instance.hostIpAddress && instance.hostIpAddress.includes(':')) {
    hostIpv6 = instance.hostIpAddress
  }
  if (!hostIpv6 && instance.hostIpv6Gateway) {
    hostIpv6 = instance.hostIpv6Gateway
  }
  return hostIpv6
}

function getIps(instance: Instance): Array<{ip: string, type: 'ipv4' | 'ipv6'}> {
  const mode = instance.networkMode || instance.network_mode
  const ips: Array<{ip: string, type: 'ipv4' | 'ipv6'}> = []

  const natPublicIp = instance.natPublicIp || instance.host?.nat_public_ip
  const maskedNatIp = isIpv4Address(natPublicIp) ? maskIpv4(natPublicIp) : null
  const maskedPrivateIp = maskIpv4(instance.ipv4)
  const hostIpv6 = getHostIpv6(instance)

  if (mode === 'nat') {
    if (maskedNatIp) ips.push({ ip: maskedNatIp, type: 'ipv4' })
    else if (maskedPrivateIp) ips.push({ ip: maskedPrivateIp, type: 'ipv4' })
  } else if (mode === 'nat_ipv6') {
    if (maskedNatIp) ips.push({ ip: maskedNatIp, type: 'ipv4' })
    else if (maskedPrivateIp) ips.push({ ip: maskedPrivateIp, type: 'ipv4' })
    if (instance.ipv6) ips.push({ ip: instance.ipv6, type: 'ipv6' })
  } else if (mode === 'nat_ipv6_nat') {
    if (maskedNatIp) ips.push({ ip: maskedNatIp, type: 'ipv4' })
    else if (maskedPrivateIp) ips.push({ ip: maskedPrivateIp, type: 'ipv4' })
    if (hostIpv6) ips.push({ ip: hostIpv6, type: 'ipv6' })
  } else if (mode === 'ipv6_nat') {
    if (hostIpv6) ips.push({ ip: hostIpv6, type: 'ipv6' })
  } else if (mode === 'ipv6_only') {
    if (instance.ipv6) ips.push({ ip: instance.ipv6, type: 'ipv6' })
  } else {
    if (maskedPrivateIp) ips.push({ ip: maskedPrivateIp, type: 'ipv4' })
    if (instance.ipv6) ips.push({ ip: instance.ipv6, type: 'ipv6' })
  }

  return ips
}

function getInstanceNetworkMode(instance: Instance): string {
  return String((instance as any).networkMode || instance.network_mode || 'nat')
}

function getInstanceNetworkModeClass(instance: Instance): string {
  switch (getInstanceNetworkMode(instance)) {
    case 'nat':
      return themeStore.isDark ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-50 text-yellow-700'
    case 'nat_ipv6':
      return themeStore.isDark ? 'bg-blue-900/50 text-blue-400' : 'bg-blue-100 text-blue-600'
    case 'nat_ipv6_nat':
      return themeStore.isDark ? 'bg-cyan-900/50 text-cyan-400' : 'bg-cyan-100 text-cyan-600'
    case 'ipv6_only':
      return themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-600'
    case 'ipv6_nat':
      return themeStore.isDark ? 'bg-teal-900/50 text-teal-400' : 'bg-teal-100 text-teal-600'
    default:
      return themeStore.isDark ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-50 text-yellow-700'
  }
}

function getInstanceTypeBadgeClass(instance: Instance): string {
  return (instance as any).instanceType === 'vm'
    ? (themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-600')
    : (themeStore.isDark ? 'bg-green-900/50 text-green-400' : 'bg-green-100 text-green-600')
}

function getInstanceTypeDisplayLabel(instance: Instance): string {
  return (instance as any).instanceType === 'vm' ? t('common.instanceType.vm') : t('common.instanceType.container')
}

function getInstanceHostName(instance: Instance): string {
  return (instance as any).host?.name || (instance as any).host || '-'
}

function getInstancePackageName(instance: Instance): string | null {
  return (instance as any).packageName || (instance as any).package?.name || null
}

function getCardActionButtonClass(variant: 'default' | 'danger' = 'default'): string {
  if (variant === 'danger') {
    return themeStore.isDark
      ? 'border-red-500/20 bg-red-500/5 text-red-300 hover:border-red-500/35 hover:bg-red-500/10'
      : 'border-red-200 bg-red-50/70 text-red-600 hover:border-red-300 hover:bg-red-100'
  }

  return themeStore.isDark
    ? 'border-gray-800 bg-gray-900/60 text-gray-300 hover:border-gray-700 hover:bg-gray-900'
    : 'border-gray-200 bg-gray-50/80 text-gray-600 hover:border-gray-300 hover:bg-gray-100'
}

// 从镜像名称提取发行版标识（用于 DistroIcon 组件）
function getDistroFromName(name: string): string {
  const lowerName = (name || '').toLowerCase()
  const distros = ['almalinux', 'alma', 'alpine', 'arch', 'centos', 'debian', 'fedora', 'gentoo', 'kali', 'mint', 'opensuse', 'suse', 'oracle', 'redhat', 'rhel', 'rockylinux', 'rocky', 'ubuntu', 'void']
  for (const distro of distros) {
    if (lowerName.includes(distro)) return distro
  }
  return 'linux'
}

// 获取付费实例的图标类型（根据节点名称判断）
// 返回 'pro' | 'prime' | 'peer' | null
function getPaidIconType(instance: Instance): 'pro' | 'prime' | 'peer' | null {
  // 只有付费实例才显示付费图标
  if (!instance.packagePlanId) return null
  
  // 如果节点名称以 PEER 开头（不区分大小写），则是托管实例，显示 peer 图标
  const hostName = instance.host?.name || ''
  if (/^PEER\d/i.test(hostName)) {
    return 'peer'
  }
  
  // 根据实例类型判断：虚拟机显示 prime，容器显示 pro
  return instance.instanceType === 'vm' ? 'prime' : 'pro'
}

// 格式化镜像名称：优先使用 imageName，否则去掉 images: 前缀
function formatImageName(image: string, imageName?: string | null): string {
  if (imageName) return imageName
  return image?.replace(/^images:/, '') || ''
}

interface InstanceExpiryInfo {
  dateText: string | null
  remainingText: string
  className: string
  title: string | null
}

function formatExpiryDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getInstanceExpiryInfo(instance: Instance): InstanceExpiryInfo {
  const expiresAt = instance.expires_at || (instance as any).expiresAt || null
  if (!expiresAt) {
    return {
      dateText: null,
      remainingText: t('instance.freeInstanceLabel'),
      className: 'text-green-500 dark:text-green-400',
      title: null
    }
  }

  const expires = new Date(expiresAt)
  if (Number.isNaN(expires.getTime())) {
    return {
      dateText: null,
      remainingText: t('instance.freeInstanceLabel'),
      className: 'text-green-500 dark:text-green-400',
      title: null
    }
  }

  const now = new Date()
  const diff = expires.getTime() - now.getTime()
  const remainingDays = Math.ceil(diff / (1000 * 60 * 60 * 24))
  const dateText = formatExpiryDate(expires)
  const autoRenew = (instance as any).autoRenew === true

  if (autoRenew) {
    return {
      dateText,
      remainingText: t('billing.autoRenewing'),
      className: 'text-green-500 dark:text-green-400',
      title: expires.toLocaleString()
    }
  }

  if (remainingDays <= 0) {
    return {
      dateText,
      remainingText: t('instance.expiredLabel'),
      className: 'text-red-500 dark:text-red-400',
      title: expires.toLocaleString()
    }
  }

  if (remainingDays <= 3) {
    return {
      dateText,
      remainingText: `${remainingDays} ${t('common.days')}`,
      className: 'text-red-500 dark:text-red-400',
      title: expires.toLocaleString()
    }
  }

  if (remainingDays <= 7) {
    return {
      dateText,
      remainingText: `${remainingDays} ${t('common.days')}`,
      className: 'text-yellow-500 dark:text-yellow-400',
      title: expires.toLocaleString()
    }
  }

  return {
    dateText,
    remainingText: `${remainingDays} ${t('common.days')}`,
    className: 'text-green-500 dark:text-green-400',
    title: expires.toLocaleString()
  }
}

type InstanceAction = 'start' | 'stop' | 'restart' | 'delete'
type BatchSimpleAction = 'start' | 'stop' | 'restart' | 'sync'
type InstanceOrderAction = 'top' | 'up' | 'down' | 'bottom'
const SIMPLE_BATCH_CONCURRENCY = 5
const INSTANCE_ORDER_ACTIONS: InstanceOrderAction[] = ['top', 'up', 'down', 'bottom']

const instanceOrderLabels = computed<Record<InstanceOrderAction, string>>(() => ({
  top: t('instance.order.top'),
  up: t('instance.order.up'),
  down: t('instance.order.down'),
  bottom: t('instance.order.bottom')
}))

function getInstanceIndex(instanceId: number): number {
  return instances.value.findIndex(instance => instance.id === instanceId)
}

function canMoveInstance(instanceId: number, action: InstanceOrderAction): boolean {
  if (orderLoading.value || !canReorderInstances.value || total.value <= 1) return false
  const index = getInstanceIndex(instanceId)
  if (index < 0) return false
  const globalIndex = (page.value - 1) * pageSize.value + index
  if (action === 'top' || action === 'up') return globalIndex > 0
  return globalIndex < total.value - 1
}

function getInstanceOrderDisabledActions(instanceId: number): Record<InstanceOrderAction, boolean> {
  return {
    top: !canMoveInstance(instanceId, 'top'),
    up: !canMoveInstance(instanceId, 'up'),
    down: !canMoveInstance(instanceId, 'down'),
    bottom: !canMoveInstance(instanceId, 'bottom')
  }
}

function clearInstanceOrderFeedback(): void {
  if (orderFeedbackTimer) {
    clearTimeout(orderFeedbackTimer)
    orderFeedbackTimer = null
  }
  recentlyOrderedInstanceId.value = null
}

function markInstanceOrderFeedback(instanceId: number): void {
  clearInstanceOrderFeedback()
  recentlyOrderedInstanceId.value = instanceId
  orderFeedbackTimer = setTimeout(() => {
    recentlyOrderedInstanceId.value = null
    orderFeedbackTimer = null
  }, 1100)
}

function getVisibleReorderTargetIndex(currentIndex: number, action: InstanceOrderAction): number | null {
  const pageStartIndex = (page.value - 1) * pageSize.value
  const globalIndex = pageStartIndex + currentIndex
  let targetGlobalIndex = globalIndex
  if (action === 'top') targetGlobalIndex = 0
  else if (action === 'up') targetGlobalIndex = globalIndex - 1
  else if (action === 'down') targetGlobalIndex = globalIndex + 1
  else targetGlobalIndex = total.value - 1

  const targetIndex = targetGlobalIndex - pageStartIndex
  if (targetIndex < 0 || targetIndex >= instances.value.length) {
    return null
  }
  return targetIndex
}

async function reorderInstance(instance: Instance, action: InstanceOrderAction): Promise<void> {
  if (!canMoveInstance(instance.id, action)) return

  const currentIndex = getInstanceIndex(instance.id)
  if (currentIndex < 0) return

  const nextInstances = [...instances.value]
  const targetIndex = getVisibleReorderTargetIndex(currentIndex, action)
  if (targetIndex !== null) {
    const [moved] = nextInstances.splice(currentIndex, 1)
    if (!moved) return
    nextInstances.splice(targetIndex, 0, moved)
  }

  try {
    orderLoading.value = true
    if (targetIndex !== null) {
      instances.value = nextInstances
      markInstanceOrderFeedback(instance.id)
    }
    await api.instances.updateOrder(instance.id, action)
    await loadInstances(true)
    toast.success(t('instance.order.updateSuccess'))
  } catch (error: any) {
    clearInstanceOrderFeedback()
    toast.error(t('instance.order.updateFailed') + ': ' + translateError(error))
    await loadInstances(true)
  } finally {
    orderLoading.value = false
  }
}

async function handleAction(instance: Instance, action: InstanceAction): Promise<void> {
  actionLoading.value[instance.id] = action
  
  try {
    if (action === 'start') {
      await api.instances.start(instance.id)
      toast.success(t('instance.startingInstance', { name: instance.name }))
      // 更新本地状态为启动中
      const idx = instances.value.findIndex(i => i.id === instance.id)
      if (idx !== -1) {
        (instances.value[idx] as any).status = 'starting'
      }
    }
    else if (action === 'stop') {
      await api.instances.stop(instance.id)
      toast.success(t('instance.stoppedInstance', { name: instance.name }))
      // 更新本地状态为已停止
      const idx = instances.value.findIndex(i => i.id === instance.id)
      if (idx !== -1) {
        instances.value[idx] = { ...instances.value[idx], status: 'stopped' }
      }
    }
    else if (action === 'restart') {
      await api.instances.restart(instance.id)
      toast.success(t('instance.restartingInstance', { name: instance.name }))
      // 更新本地状态为重启中
      const idx = instances.value.findIndex(i => i.id === instance.id)
      if (idx !== -1) {
        (instances.value[idx] as any).status = 'restarting'
      }
    }
    else if (action === 'delete') {
      if (!confirm(t('instance.confirmDelete', { name: instance.name }))) {
        delete actionLoading.value[instance.id]
        return
      }
      await api.instances.delete(instance.id)
      // 立即从本地列表移除，提供即时反馈
      instances.value = instances.value.filter(i => i.id !== instance.id)
      total.value = Math.max(0, total.value - 1)
      toast.success(t('instance.deletedInstance', { name: instance.name }))
    }
  } catch (error: any) {
    // 检查是否需要二次验证
    if (error?.code === 'VERIFICATION_REQUIRED' || error?.message?.includes('Sensitive operation requires verification')) {
      toast.error(t('instance.verificationRequiredHint'), 6000)
    } else {
      toast.error(`${t('instance.actionFailed')}: ${translateError(error)}`)
    }
    // 操作失败时重新加载以恢复正确状态
    await loadInstances(true)
  } finally {
    delete actionLoading.value[instance.id]
  }
}

function openInstanceDetail(instanceId: number): void {
  router.push(`/instances/${instanceId}`)
}

function getBatchTargets(action: BatchSimpleAction): Instance[] {
  if (action === 'start') {
    return selectedInstances.value.filter(instance => instance.status?.toLowerCase() === 'stopped')
  }
  if (action === 'stop' || action === 'restart') {
    return selectedInstances.value.filter(instance => instance.status?.toLowerCase() === 'running')
  }
  return selectedInstances.value
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let currentIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = currentIndex
      currentIndex += 1
      if (index >= items.length) break
      try {
        const value = await handler(items[index])
        results[index] = { status: 'fulfilled', value }
      } catch (error) {
        results[index] = { status: 'rejected', reason: error }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

function translateBatchReason(reason?: string): string {
  if (!reason) return t('instance.batch.unknownReason')
  if (reason === '实例不存在' || reason === '实例不存在或无权操作' || reason === '无权操作该实例') {
    return t('instance.batchReason.notFoundOrForbidden')
  }
  if (reason === '免费实例无需续费') {
    return t('instance.batchReason.freeNoRenew')
  }
  if (reason === '无法获取实例计费信息') {
    return t('instance.batchReason.billingUnavailable')
  }
  if (reason === '暂无可用续费选项') {
    return t('instance.batchReason.noRenewOptions')
  }
  if (reason === '该实例不支持当前续费时长') {
    return t('instance.batch.unsupportedPeriod')
  }
  if (reason === '免费实例不支持自动续费') {
    return t('instance.batchReason.freeNoAutoRenew')
  }
  if (reason === '已经开启自动续费') {
    return t('instance.batchReason.autoRenewAlreadyOn')
  }
  if (reason === '已经关闭自动续费') {
    return t('instance.batchReason.autoRenewAlreadyOff')
  }
  if (reason === '实例已删除') {
    return t('instance.batchReason.deleted')
  }
  if (reason === '实例正在创建中，无法销毁') {
    return t('instance.batchReason.creating')
  }
  if (reason === '实例已被封停，无法销毁，请先联系管理员解封') {
    return t('instance.batchReason.suspended')
  }
  if (reason === '当前月流量周期无法销毁，已用流量达到或超过 5G') {
    return t('instance.batchReason.destroyTrafficLimit')
  }
  if (reason === '续费失败') {
    return t('instance.batchReason.renewFailed')
  }
  if (reason === '自动续费设置失败') {
    return t('instance.batchReason.autoRenewFailed')
  }
  if (reason === '销毁实例失败') {
    return t('instance.batchReason.destroyFailed')
  }

  const renewWindowMatch = reason.match(/^仅可在到期前\s*(\d+)\s*天内续费$/)
  if (renewWindowMatch) {
    return t('instance.batchReason.renewWindow', { days: renewWindowMatch[1] })
  }

  return reason
}

async function handleBatchSimpleAction(action: BatchSimpleAction): Promise<void> {
  const targets = getBatchTargets(action)
  if (targets.length === 0) {
    toast.warning(t('instance.batch.noEligibleAction'))
    return
  }

  batchActionLoading.value = action
  try {
    const settled = await runWithConcurrency(
      targets,
      SIMPLE_BATCH_CONCURRENCY,
      async (instance) => {
        if (action === 'start') return api.instances.start(instance.id)
        if (action === 'stop') return api.instances.stop(instance.id)
        if (action === 'restart') return api.instances.restart(instance.id)
        return api.instances.syncStatus(instance.id)
      }
    )

    const successCount = settled.filter(item => item.status === 'fulfilled').length
    const failedCount = settled.length - successCount
    const skippedCount = selectedCount.value - targets.length

    if (failedCount > 0) {
      toast.warning(t('instance.batch.partialResult', { success: successCount, failed: failedCount, skipped: skippedCount }))
    } else {
      toast.success(t('instance.batch.successResult', { count: successCount }))
    }

    clearSelection()
    await loadInstances(true)
  } catch (error: any) {
    toast.error(t('instance.batch.actionFailed') + ': ' + translateError(error))
  } finally {
    batchActionLoading.value = ''
  }
}

async function handleBatchAutoRenew(autoRenew: boolean): Promise<void> {
  if (selectedCount.value === 0 || isViewingAnotherUsersInstances.value) return

  batchActionLoading.value = autoRenew ? 'autoRenewOn' : 'autoRenewOff'
  try {
    const result = await api.billing.setAutoRenewBatch(Array.from(selectedIds.value), autoRenew)
    if (result.failedCount > 0) {
      toast.warning(t('instance.batch.partialResult', {
        success: result.successCount,
        failed: result.failedCount,
        skipped: result.skippedCount
      }))
    } else {
      toast.success(t(autoRenew ? 'billing.autoRenewEnabled' : 'billing.autoRenewDisabled'))
    }
    clearSelection()
    await loadInstances(true)
  } catch (error: any) {
    toast.error(t('instance.batch.actionFailed') + ': ' + translateError(error))
  } finally {
    batchActionLoading.value = ''
  }
}

async function openBatchRenewModal(): Promise<void> {
  if (selectedCount.value === 0 || isViewingAnotherUsersInstances.value) return

  showBatchRenewModal.value = true
  batchRenewLoading.value = true
  batchRenewPreview.value = []
  batchRenewMonths.value = 1

  try {
    const [previewRes, balanceRes] = await Promise.all([
      api.billing.previewBatchRenew(Array.from(selectedIds.value)),
      api.billing.getUserBalance()
    ])
    batchRenewPreview.value = previewRes.items
    batchRenewBalance.value = balanceRes.balance
    batchRenewMonths.value = batchRenewMonthOptions.value.includes(1)
      ? 1
      : (batchRenewMonthOptions.value[0] || 1)
  } catch (error: any) {
    toast.error(t('instance.batch.previewFailed') + ': ' + translateError(error))
    showBatchRenewModal.value = false
  } finally {
    batchRenewLoading.value = false
  }
}

function closeBatchRenewModal(force = false): void {
  if (batchRenewSubmitting.value && !force) return
  showBatchRenewModal.value = false
  batchRenewPreview.value = []
  batchRenewMonths.value = 1
}

async function confirmBatchRenew(): Promise<void> {
  if (!batchRenewCanSubmit.value) return

  batchRenewSubmitting.value = true
  try {
    const result = await api.billing.renewInstancesBatch(Array.from(selectedIds.value), batchRenewMonths.value)
    if (result.failedCount > 0) {
      toast.warning(t('instance.batch.partialResult', {
        success: result.successCount,
        failed: result.failedCount,
        skipped: result.skippedCount
      }))
    } else {
      toast.success(t('instance.batch.successResult', { count: result.successCount }))
    }
    closeBatchRenewModal(true)
    clearSelection()
    await loadInstances(true)
  } catch (error: any) {
    toast.error(t('instance.batch.actionFailed') + ': ' + translateError(error))
  } finally {
    batchRenewSubmitting.value = false
  }
}

async function openBatchDestroyModal(): Promise<void> {
  if (selectedCount.value === 0 || isViewingAnotherUsersInstances.value) return

  showBatchDestroyModal.value = true
  batchDestroyLoading.value = true
  batchDestroyConfirm.value = ''
  batchDestroyPreview.value = []

  try {
    const result = await api.billing.getBatchDestroyInfo(Array.from(selectedIds.value))
    batchDestroyPreview.value = result.items
  } catch (error: any) {
    toast.error(t('instance.batch.previewFailed') + ': ' + translateError(error))
    showBatchDestroyModal.value = false
  } finally {
    batchDestroyLoading.value = false
  }
}

function closeBatchDestroyModal(force = false): void {
  if (batchDestroySubmitting.value && !force) return
  showBatchDestroyModal.value = false
  batchDestroyConfirm.value = ''
  batchDestroyPreview.value = []
}

async function confirmBatchDestroy(): Promise<void> {
  if (!batchDestroyCanSubmit.value) return

  batchDestroySubmitting.value = true
  try {
    const result = await api.billing.destroyInstancesBatch(Array.from(selectedIds.value))
    if (result.failedCount > 0) {
      toast.warning(t('instance.batch.partialResult', {
        success: result.successCount,
        failed: result.failedCount,
        skipped: result.skippedCount
      }))
    } else {
      toast.success(t('instance.batch.successResult', { count: result.successCount }))
    }
    closeBatchDestroyModal(true)
    clearSelection()
    await loadInstances(true)
  } catch (error: any) {
    toast.error(t('instance.batch.actionFailed') + ': ' + translateError(error))
  } finally {
    batchDestroySubmitting.value = false
  }
}

</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <!-- 页面头部 -->
    <div class="page-header flex-col sm:flex-row gap-4 sm:gap-0">
      <div>
        <h1 class="page-title text-lg sm:text-xl">{{ $t('instance.title') }}</h1>
        <p class="page-description">
          <template v-if="filterUserId && filterUserName">
            {{ $t('instance.userInstances', { name: filterUserName }) }}
            <button class="text-blue-500 hover:text-blue-400 ml-2 text-sm" @click="clearUserFilter">
              {{ $t('instance.clearFilter') }}
            </button>
          </template>
          <template v-else>
            {{ $t('instance.manageDesc') }}
          </template>
        </p>
      </div>
      <RouterLink to="/instances/create" class="btn-primary w-full sm:w-auto justify-center">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ configStore.freeSiteMode ? freeSiteCopy.instanceCreate : $t('instance.create') }}
      </RouterLink>
    </div>

    <!-- 搜索和筛选 -->
    <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div class="flex flex-col gap-3 flex-1 min-w-0 xl:flex-row xl:items-center">
        <div class="relative w-full xl:max-w-sm">
          <input
            v-model="search"
            type="text"
            :placeholder="$t('instance.searchPlaceholder')"
            class="input pl-9 w-full"
          />
          <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div
          v-if="countryFilterOptions.length > 0"
          class="hidden sm:flex items-center min-w-0 flex-1"
        >
          <div
            class="flex items-center gap-2 overflow-x-auto pb-1 pr-1 min-w-0 scrollbar-thin"
            @wheel="handleCountryStripWheel"
          >
            <button
              type="button"
              class="h-10 px-3 rounded-xl border text-xs font-semibold shrink-0 transition-colors"
              :class="countryFilter === null
                ? (themeStore.isDark ? 'border-blue-400 bg-blue-500/15 text-blue-300' : 'border-blue-500 bg-blue-50 text-blue-700')
                : (themeStore.isDark ? 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300')"
              @click="setCountryFilter(null)"
            >
              ALL
            </button>
            <button
              v-for="code in countryFilterOptions"
              :key="`desktop-country-${code}`"
              type="button"
              class="h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 transition-all"
              :class="countryFilter === code
                ? (themeStore.isDark ? 'border-blue-400 bg-blue-500/15 shadow-sm shadow-blue-500/10' : 'border-blue-500 bg-blue-50 shadow-sm shadow-blue-500/10')
                : (themeStore.isDark ? 'border-gray-700 bg-gray-900 hover:border-gray-600' : 'border-gray-200 bg-white hover:border-gray-300')"
              :title="getCountryLabel(code)"
              :aria-label="getCountryLabel(code)"
              @click="setCountryFilter(code)"
            >
              <FlagIcon :code="code" size="sm" />
            </button>
          </div>
        </div>
      </div>
      <div class="hidden sm:flex flex-wrap items-center gap-3 xl:justify-end">
        <div
          class="inline-flex items-center rounded-xl border p-0.5"
          :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/70' : 'border-gray-200 bg-gray-50/80'"
        >
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="getInstanceLayoutButtonClass('list')"
            :title="$t('instance.listLayout')"
            @click="setInstanceLayoutMode('list')"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span class="hidden sm:inline">{{ $t('instance.listLayout') }}</span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="getInstanceLayoutButtonClass('card')"
            :title="$t('instance.cardLayout')"
            @click="setInstanceLayoutMode('card')"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 5h6v6H5V5zm8 0h6v6h-6V5zM5 13h6v6H5v-6zm8 0h6v6h-6v-6z" />
            </svg>
            <span class="hidden sm:inline">{{ $t('instance.cardLayout') }}</span>
          </button>
        </div>
        <span class="text-sm text-themed-muted whitespace-nowrap">{{ $t('instance.totalCount', { count: total }) }}</span>
        <div class="inline-flex items-center gap-2 shrink-0">
          <span class="text-sm text-themed-muted whitespace-nowrap">{{ $t('common.perPage') }}</span>
          <div class="relative">
            <select
              v-model.number="pageSize"
              class="input h-10 min-w-[96px] appearance-none rounded-xl py-2 pl-3 pr-9 text-sm leading-none"
              @change="handlePageSizeChange"
            >
              <option v-for="size in pageSizeOptions" :key="size" :value="size">
                {{ size }}
              </option>
            </select>
            <svg
              class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-themed-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <div class="sm:hidden flex items-center justify-between gap-3">
      <span class="text-sm text-themed-muted whitespace-nowrap">{{ $t('instance.totalCount', { count: total }) }}</span>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-sm text-themed-muted whitespace-nowrap">{{ $t('common.perPage') }}</span>
        <div class="relative">
          <select
            v-model.number="pageSize"
            class="input h-10 min-w-[90px] appearance-none rounded-xl py-2 pl-3 pr-9 text-sm leading-none"
            @change="handlePageSizeChange"
          >
            <option v-for="size in pageSizeOptions" :key="size" :value="size">
              {{ size }}
            </option>
          </select>
          <svg
            class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-themed-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    </div>

    <div
      v-if="countryFilterOptions.length > 0"
      class="sm:hidden"
    >
      <div
        class="card p-3"
      >
        <div
          class="flex items-center gap-2 overflow-x-auto min-w-0 scrollbar-thin"
          @wheel="handleCountryStripWheel"
        >
          <button
            type="button"
            class="h-10 px-3 rounded-xl border text-xs font-semibold shrink-0 transition-colors"
            :class="countryFilter === null
              ? (themeStore.isDark ? 'border-blue-400 bg-blue-500/15 text-blue-300' : 'border-blue-500 bg-blue-50 text-blue-700')
              : (themeStore.isDark ? 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300')"
            @click="setCountryFilter(null)"
          >
            ALL
          </button>
          <button
            v-for="code in countryFilterOptions"
            :key="`mobile-country-${code}`"
            type="button"
            class="h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 transition-all"
            :class="countryFilter === code
              ? (themeStore.isDark ? 'border-blue-400 bg-blue-500/15 shadow-sm shadow-blue-500/10' : 'border-blue-500 bg-blue-50 shadow-sm shadow-blue-500/10')
              : (themeStore.isDark ? 'border-gray-700 bg-gray-900 hover:border-gray-600' : 'border-gray-200 bg-white hover:border-gray-300')"
            :title="getCountryLabel(code)"
            :aria-label="getCountryLabel(code)"
            @click="setCountryFilter(code)"
          >
            <FlagIcon :code="code" size="sm" />
          </button>
        </div>
      </div>
    </div>

    <!-- 批量操作条 -->
    <div
      v-if="hasSelectedInstances && !loading && instances.length > 0"
      class="card p-4 space-y-4"
    >
      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex flex-wrap items-center gap-3">
          <div
            class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium"
            :class="themeStore.isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-700'"
          >
            <span class="inline-flex h-2 w-2 rounded-full bg-current"></span>
            {{ $t('instance.batch.selectedCount', { count: selectedCount }) }}
          </div>
          <span class="text-sm text-themed-muted">{{ $t('instance.batch.currentPageOnly') }}</span>
          <button class="btn-ghost btn-sm" @click="clearSelection">
            {{ $t('instance.batch.clear') }}
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            class="btn-ghost btn-sm"
            :disabled="selectedStoppedCount === 0 || !!batchActionLoading || batchRenewSubmitting || batchDestroySubmitting"
            @click="handleBatchSimpleAction('start')"
          >
            <svg v-if="batchActionLoading === 'start'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ $t('instance.batch.start') }}
          </button>
          <button
            class="btn-ghost btn-sm"
            :disabled="selectedRunningCount === 0 || !!batchActionLoading || batchRenewSubmitting || batchDestroySubmitting"
            @click="handleBatchSimpleAction('stop')"
          >
            <svg v-if="batchActionLoading === 'stop'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ $t('instance.batch.stop') }}
          </button>
          <button
            class="btn-ghost btn-sm"
            :disabled="selectedRunningCount === 0 || !!batchActionLoading || batchRenewSubmitting || batchDestroySubmitting"
            @click="handleBatchSimpleAction('restart')"
          >
            <svg v-if="batchActionLoading === 'restart'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ $t('instance.batch.restart') }}
          </button>
          <button
            class="btn-ghost btn-sm"
            :disabled="!hasSelectedInstances || !!batchActionLoading || batchRenewSubmitting || batchDestroySubmitting"
            @click="handleBatchSimpleAction('sync')"
          >
            <svg v-if="batchActionLoading === 'sync'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ $t('instance.batch.sync') }}
          </button>
          <button
            class="btn-ghost btn-sm"
            :disabled="selectedPaidCount === 0 || isViewingAnotherUsersInstances || !!batchActionLoading || batchRenewSubmitting || batchDestroySubmitting"
            @click="handleBatchAutoRenew(true)"
          >
            <svg v-if="batchActionLoading === 'autoRenewOn'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ $t('instance.batch.autoRenewOn') }}
          </button>
          <button
            class="btn-ghost btn-sm"
            :disabled="selectedPaidCount === 0 || isViewingAnotherUsersInstances || !!batchActionLoading || batchRenewSubmitting || batchDestroySubmitting"
            @click="handleBatchAutoRenew(false)"
          >
            <svg v-if="batchActionLoading === 'autoRenewOff'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ $t('instance.batch.autoRenewOff') }}
          </button>
          <button
            class="btn-secondary btn-sm"
            :disabled="selectedPaidCount === 0 || isViewingAnotherUsersInstances || !!batchActionLoading || batchRenewSubmitting || batchDestroySubmitting"
            @click="openBatchRenewModal"
          >
            {{ configStore.freeSiteMode ? freeSiteCopy.instanceBatchRenewAction : $t('instance.batch.renew') }}
          </button>
          <button
            class="btn-danger btn-sm"
            :disabled="!hasSelectedInstances || isViewingAnotherUsersInstances || !!batchActionLoading || batchRenewSubmitting || batchDestroySubmitting"
            @click="openBatchDestroyModal"
          >
            {{ $t('instance.batch.destroy') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 加载骨架屏 -->
    <SkeletonLoader
      v-if="loading"
      :type="isCardLayout ? 'grid' : 'table'"
      :rows="isCardLayout ? 3 : 8"
      :cols="isDesktopViewport ? 3 : 1"
    />

    <!-- 空状态 -->
    <div v-else-if="instances.length === 0" class="card p-12 text-center">
      <svg 
        class="w-16 h-16 mx-auto mb-4" 
        :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
      </svg>
      <h3 
        class="text-lg font-medium mb-2"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ search ? $t('instance.noMatchingInstances') : $t('instance.noInstances') }}
      </h3>
      <p class="text-themed-muted mb-4">{{ search ? $t('instance.tryOtherKeywords') : $t('instance.createFirstInstance') }}</p>
      <RouterLink v-if="!search" to="/instances/create" class="btn-primary">{{ configStore.freeSiteMode ? freeSiteCopy.instanceCreateFirst : $t('instance.create') }}</RouterLink>
    </div>

    <!-- 实例列表 -->
    <template v-else>
      <!-- 列表布局 -->
      <div v-if="instanceLayoutMode === 'list'" class="hidden sm:block card overflow-x-auto">
        <table class="w-full min-w-[1180px]">
          <thead
            class="border-b"
            :class="themeStore.isDark ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200'"
          >
            <tr>
              <th class="px-4 py-3 w-12">
                <div class="flex items-center justify-center">
                  <button
                    type="button"
                    class="relative flex h-4 w-4 items-center justify-center rounded border transition-colors"
                    :class="themeStore.isDark ? 'border-gray-600 bg-gray-950 text-blue-400' : 'border-gray-300 bg-white text-blue-600'"
                    @click="toggleSelectAll"
                  >
                    <span v-if="isAllSelected" class="h-2 w-2 rounded-sm bg-current"></span>
                    <span v-else-if="isPartialSelected" class="h-0.5 w-2 rounded-full bg-current"></span>
                  </button>
                </div>
              </th>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3">{{ $t('instance.name') }}</th>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-3 py-3">{{ $t('instance.statusLabel') }}</th>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-3 py-3">{{ $t('instance.ip') }}</th>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-3 py-3">{{ $t('instance.modeLabel') }}</th>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-3 py-3">{{ $t('instance.config') }}</th>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-3 py-3">{{ $t('instance.quotaLabel') }}</th>
              <th v-if="isAdmin" class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-3 py-3">{{ $t('instance.user') }}</th>
              <th class="text-right text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <TransitionGroup
            tag="tbody"
            name="instance-table-order"
            :class="themeStore.isDark ? 'divide-y divide-gray-800' : 'divide-y divide-gray-100'"
          >
            <tr
              v-for="instance in instances"
              :key="instance.id"
              class="cursor-pointer"
              :class="[
                themeStore.isDark ? 'hover:bg-gray-900/30' : 'hover:bg-gray-50',
                selectedIds.has(instance.id) ? (themeStore.isDark ? 'bg-blue-500/10' : 'bg-blue-50/80') : '',
                recentlyOrderedInstanceId === instance.id ? (themeStore.isDark ? 'is-order-feedback-dark' : 'is-order-feedback-light') : '',
                instance.status?.toLowerCase() === 'creating' ? 'creating-row' : ''
              ]"
              @click="openInstanceDetail(instance.id)"
            >
              <td class="px-4 py-3" @click.stop>
                <div class="flex items-center justify-center">
                  <input
                    type="checkbox"
                    class="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                    :checked="selectedIds.has(instance.id)"
                    @change="toggleSelect(instance.id)"
                  />
                </div>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2.5">
                  <div
                    class="w-9 h-9 rounded flex items-center justify-center transition-colors flex-shrink-0 overflow-hidden"
                    :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
                  >
                    <InstanceDisplayIcon
                      v-if="instance.iconBadgeId || getPaidIconType(instance)"
                      :badge-id="instance.iconBadgeId"
                      :fallback-icon="getPaidIconType(instance)"
                      :alt="instance.name"
                      :size="36"
                    />
                    <DistroIcon
                      v-else
                      :distro="getDistroFromName(instance.image)"
                      :size="32"
                    />
                  </div>
                  <div class="min-w-0">
                    <div
                      class="font-medium text-sm truncate"
                      :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
                    >
                      {{ instance.name }}
                    </div>
                    <div
                      class="text-xs truncate"
                      :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'"
                    >
                      {{ formatImageName(instance.image, (instance as any).imageName) }}
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-3 py-3">
                <span :class="['badge inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs', getStatusInfo(instance.status, t).class]">
                  <span :class="['w-1.5 h-1.5 rounded-full', getStatusInfo(instance.status, t).dot]"></span>
                  {{ getStatusInfo(instance.status, t).label }}
                </span>
              </td>
              <td class="pl-4 pr-3 py-3">
                <div class="flex items-center gap-2">
                  <FlagIcon :code="(instance as any).host?.country_code || (instance as any).hostCountryCode || 'us'" size="xs" class="flex-shrink-0" />
                  <div class="space-y-0.5 min-w-0">
                    <template v-if="getIps(instance).length > 0">
                      <div
                        v-for="(ipObj, idx) in getIps(instance)"
                        :key="idx"
                        class="text-xs font-mono truncate"
                        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'"
                        :title="ipObj.ip"
                      >
                        {{ ipObj.type === 'ipv6' ? (ipObj.ip.length > 18 ? ipObj.ip.substring(0, 18) + '...' : ipObj.ip) : ipObj.ip }}
                      </div>
                    </template>
                    <span v-else class="text-themed-muted text-xs">-</span>
                  </div>
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-1.5">
                  <span
                    class="text-xs px-1.5 py-0.5 rounded"
                    :class="(instance as any).instanceType === 'vm'
                      ? (themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-600')
                      : (themeStore.isDark ? 'bg-green-900/50 text-green-400' : 'bg-green-100 text-green-600')"
                  >
                    {{ (instance as any).instanceType === 'vm' ? $t('common.instanceType.vm') : $t('common.instanceType.container') }}
                  </span>
                  <span
                    class="text-xs px-1.5 py-0.5 rounded"
                    :class="{
                      [themeStore.isDark ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-50 text-yellow-700']: ((instance as any).networkMode || instance.network_mode) === 'nat',
                      [themeStore.isDark ? 'bg-blue-900/50 text-blue-400' : 'bg-blue-100 text-blue-600']: ((instance as any).networkMode || instance.network_mode) === 'nat_ipv6',
                      [themeStore.isDark ? 'bg-cyan-900/50 text-cyan-400' : 'bg-cyan-100 text-cyan-600']: ((instance as any).networkMode || instance.network_mode) === 'nat_ipv6_nat',
                      [themeStore.isDark ? 'bg-purple-900/50 text-purple-400' : 'bg-purple-100 text-purple-600']: ((instance as any).networkMode || instance.network_mode) === 'ipv6_only',
                      [themeStore.isDark ? 'bg-teal-900/50 text-teal-400' : 'bg-teal-100 text-teal-600']: ((instance as any).networkMode || instance.network_mode) === 'ipv6_nat'
                    }"
                  >
                    {{ $t('common.networkMode.' + ((instance as any).networkMode || instance.network_mode || 'nat')) }}
                  </span>
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="space-y-0.5">
                  <div class="text-sm text-themed-muted">
                    {{ instance.cpu }}% / {{ formatMemory(instance.memory) }} / {{ formatDisk(instance.disk) }}
                  </div>
                  <div class="text-xs text-gray-400 dark:text-gray-500">
                    {{ formatBytes(Number((instance as any).monthlyTrafficUsed || 0)) }}
                    <span> / </span>
                    <template v-if="(instance as any).monthlyTrafficLimit">
                      {{ formatBytes(Number((instance as any).monthlyTrafficLimit)) }}
                    </template>
                    <template v-else>
                      {{ $t('instance.mobileCard.unlimited') }}
                    </template>
                  </div>
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="space-y-0.5">
                  <div class="text-sm text-themed-muted whitespace-nowrap">
                    {{ (instance as any).portLimit ?? '-' }} {{ $t('instance.mobileCard.ports') }}
                    <span class="mx-0.5">/</span>
                    {{ (instance as any).snapshotLimit ?? '-' }} {{ $t('instance.mobileCard.snapshots') }}
                    <span class="mx-0.5">/</span>
                    {{ (instance as any).siteLimit ?? '-' }} {{ $t('instance.mobileCard.sites') }}
                  </div>
                  <div class="text-xs">
                    <span class="text-themed-muted">{{ $t('instance.expireAt') }}:</span>
                    <span class="ml-1 text-themed-muted" :title="getInstanceExpiryInfo(instance).title || ''">
                      <template v-if="getInstanceExpiryInfo(instance).dateText">
                        {{ getInstanceExpiryInfo(instance).dateText }}
                        <span class="mx-1">|</span>
                      </template>
                      <span class="font-medium" :class="getInstanceExpiryInfo(instance).className">
                        {{ getInstanceExpiryInfo(instance).remainingText }}
                      </span>
                    </span>
                  </div>
                </div>
              </td>
              <td v-if="isAdmin" class="px-3 py-3">
                <span
                  class="text-xs truncate"
                  :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'"
                >{{ (instance as any).username || '-' }}</span>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1">
                  <InstanceOrderMenu
                    v-if="canReorderInstances"
                    class="mr-1"
                    :actions="INSTANCE_ORDER_ACTIONS"
                    :labels="instanceOrderLabels"
                    :label="$t('instance.order.label')"
                    :disabled-actions="getInstanceOrderDisabledActions(instance.id)"
                    :loading="orderLoading"
                    :dark="themeStore.isDark"
                    align="right"
                    @reorder="reorderInstance(instance, $event)"
                  />
                  <button
                    v-if="instance.status?.toLowerCase() === 'stopped'"
                    :disabled="!!actionLoading[instance.id]"
                    class="p-1.5 rounded hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500 transition-colors disabled:opacity-50"
                    :title="$t('instance.actions.start')"
                    @click.stop="handleAction(instance, 'start')"
                  >
                    <svg v-if="actionLoading[instance.id] === 'start'" class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <svg v-else class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                  <button
                    v-if="instance.status?.toLowerCase() === 'running'"
                    :disabled="!!actionLoading[instance.id]"
                    class="p-1.5 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-500 transition-colors disabled:opacity-50"
                    :title="$t('instance.actions.stop')"
                    @click.stop="handleAction(instance, 'stop')"
                  >
                    <svg v-if="actionLoading[instance.id] === 'stop'" class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <svg v-else class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 6h12v12H6z" />
                    </svg>
                  </button>
                  <button
                    v-if="instance.status?.toLowerCase() === 'running'"
                    :disabled="!!actionLoading[instance.id]"
                    class="p-1.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors disabled:opacity-50"
                    :title="$t('instance.actions.restart')"
                    @click.stop="handleAction(instance, 'restart')"
                  >
                    <svg v-if="actionLoading[instance.id] === 'restart'" class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <span
                    class="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-themed-muted transition-colors"
                    :title="$t('instance.details')"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </td>
            </tr>
          </TransitionGroup>
        </table>
      </div>

      <!-- 卡片布局 -->
      <div v-else>
        <TransitionGroup name="instance-stack-order" tag="div" class="space-y-3 sm:hidden">
          <div
            v-for="instance in instances"
            :key="instance.id"
            class="card overflow-hidden transition-all"
            :class="[
              instance.status?.toLowerCase() === 'creating' ? 'creating-card' : '',
              recentlyOrderedInstanceId === instance.id ? (themeStore.isDark ? 'is-order-feedback-dark' : 'is-order-feedback-light') : '',
              selectedIds.has(instance.id) ? (themeStore.isDark ? 'ring-1 ring-blue-500/40' : 'ring-1 ring-blue-500/30') : ''
            ]"
          >
            <div class="block p-4">
              <div class="flex items-start gap-3 mb-3">
                <div class="pt-1 shrink-0" @click.stop>
                  <input
                    type="checkbox"
                    class="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer touch-manipulation"
                    :checked="selectedIds.has(instance.id)"
                    @click.stop
                    @change.stop="toggleSelect(instance.id)"
                  />
                </div>
                <div
                  class="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
                  :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
                >
                  <InstanceDisplayIcon
                    v-if="instance.iconBadgeId || getPaidIconType(instance)"
                    :badge-id="instance.iconBadgeId"
                    :fallback-icon="getPaidIconType(instance)"
                    :alt="instance.name"
                    :size="44"
                  />
                  <DistroIcon
                    v-else
                    :distro="getDistroFromName(instance.image)"
                    :size="40"
                  />
                </div>
                <div class="flex-1 min-w-0 cursor-pointer" @click="openInstanceDetail(instance.id)">
                  <div class="flex items-center gap-2 mb-1">
                    <div
                      class="font-semibold truncate"
                      :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
                    >
                      {{ instance.name }}
                    </div>
                    <span :class="['badge badge-sm inline-flex items-center gap-1 flex-shrink-0', getStatusInfo(instance.status, t).class]">
                      <span :class="['w-1 h-1 rounded-full', getStatusInfo(instance.status, t).dot]"></span>
                      <span class="text-[10px]">{{ getStatusInfo(instance.status, t).label }}</span>
                    </span>
                  </div>
                  <div
                    class="text-xs truncate"
                    :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'"
                  >
                    {{ formatImageName(instance.image, (instance as any).imageName) }}
                  </div>
                </div>
                <div
                  v-if="(instance as any).packageName"
                  class="text-xs px-2 py-1 rounded truncate max-w-[130px]"
                  :class="themeStore.isDark ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'"
                  :title="(instance as any).packageName"
                  @click="openInstanceDetail(instance.id)"
                >
                  {{ (instance as any).packageName }}
                </div>
              </div>

              <div class="space-y-2 text-sm cursor-pointer" @click="openInstanceDetail(instance.id)">
                <div class="flex items-start justify-between">
                  <span class="text-themed-muted text-xs mt-0.5">{{ $t('instance.mobileCard.ipAddress') }}</span>
                  <div class="flex flex-col items-end gap-1">
                    <template v-if="getIps(instance).length > 0">
                      <span
                        v-for="(ipObj, idx) in getIps(instance)"
                        :key="idx"
                        class="font-mono text-xs max-w-[200px] truncate"
                        :class="[themeStore.isDark ? 'text-gray-300' : 'text-gray-700', ipObj.type === 'ipv6' ? 'opacity-75' : '']"
                        :title="ipObj.ip"
                      >
                        {{ ipObj.type === 'ipv6' ? (ipObj.ip.length > 18 ? ipObj.ip.substring(0, 18) + '...' : ipObj.ip) : ipObj.ip }}
                      </span>
                    </template>
                    <span v-else class="text-themed-muted text-xs">-</span>
                  </div>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-themed-muted text-xs">{{ $t('instance.mobileCard.config') }}</span>
                  <span
                    class="text-xs"
                    :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
                  >
                    {{ instance.cpu }}{{ $t('instance.mobileCard.cpuCore') }} / {{ formatMemory(instance.memory) }} / {{ formatDisk(instance.disk) }}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-themed-muted text-xs">{{ $t('instance.mobileCard.quota') }}</span>
                  <span
                    class="text-xs"
                    :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
                  >
                    {{ (instance as any).portLimit ?? '-' }} {{ $t('instance.mobileCard.ports') }} / {{ (instance as any).snapshotLimit ?? '-' }} {{ $t('instance.mobileCard.snapshots') }} / {{ (instance as any).siteLimit ?? '-' }} {{ $t('instance.mobileCard.sites') }}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-themed-muted text-xs">{{ $t('instance.mobileCard.traffic') }}</span>
                  <span
                    class="text-xs"
                    :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
                  >
                    <template v-if="(instance as any).monthlyTrafficLimit">
                      {{ formatBytes(Number((instance as any).monthlyTrafficUsed || 0)) }} / {{ formatBytes(Number((instance as any).monthlyTrafficLimit)) }}
                    </template>
                    <template v-else>
                      {{ formatBytes(Number((instance as any).monthlyTrafficUsed || 0)) }} / {{ $t('instance.mobileCard.unlimited') }}
                    </template>
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-themed-muted text-xs">{{ $t('instance.mobileCard.host') }}</span>
                  <span class="inline-flex items-center gap-1.5">
                    <FlagIcon :code="(instance as any).host?.country_code || (instance as any).hostCountryCode || 'us'" size="xs" />
                    <span
                      class="uppercase text-xs font-medium"
                      :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
                    >{{ (instance as any).host?.name || (instance as any).host || '-' }}</span>
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-themed-muted text-xs">{{ $t('instance.expireAt') }}</span>
                  <span class="text-xs text-right" :title="getInstanceExpiryInfo(instance).title || ''">
                    <template v-if="getInstanceExpiryInfo(instance).dateText">
                      <span class="text-themed-muted">{{ getInstanceExpiryInfo(instance).dateText }}</span>
                      <span class="mx-1 text-themed-muted">|</span>
                    </template>
                    <span class="font-medium" :class="getInstanceExpiryInfo(instance).className">
                      {{ getInstanceExpiryInfo(instance).remainingText }}
                    </span>
                  </span>
                </div>
                <div v-if="isAdmin" class="flex items-center justify-between">
                  <span class="text-themed-muted text-xs">{{ $t('instance.mobileCard.user') }}</span>
                  <span
                    class="text-xs"
                    :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
                  >
                    {{ (instance as any).username || '-' }}
                  </span>
                </div>
              </div>
            </div>

            <div
              class="flex items-center justify-center gap-2 px-4 py-3 border-t"
              :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/30' : 'border-gray-100 bg-gray-50'"
            >
              <InstanceOrderMenu
                v-if="canReorderInstances"
                :actions="INSTANCE_ORDER_ACTIONS"
                :labels="instanceOrderLabels"
                :label="$t('instance.order.label')"
                :disabled-actions="getInstanceOrderDisabledActions(instance.id)"
                :loading="orderLoading"
                :dark="themeStore.isDark"
                align="left"
                @reorder="reorderInstance(instance, $event)"
              />
              <button
                v-if="instance.status?.toLowerCase() === 'stopped'"
                :disabled="!!actionLoading[instance.id]"
                class="btn-ghost btn-sm flex-1"
                @click.stop="handleAction(instance, 'start')"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span class="text-xs">{{ actionLoading[instance.id] === 'start' ? '...' : $t('instance.actions.start') }}</span>
              </button>
              <button
                v-if="instance.status?.toLowerCase() === 'running'"
                :disabled="!!actionLoading[instance.id]"
                class="btn-ghost btn-sm flex-1"
                @click.stop="handleAction(instance, 'stop')"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                <span class="text-xs">{{ actionLoading[instance.id] === 'stop' ? '...' : $t('instance.actions.stop') }}</span>
              </button>
              <button
                v-if="instance.status?.toLowerCase() === 'running'"
                :disabled="!!actionLoading[instance.id]"
                class="btn-ghost btn-sm flex-1"
                @click.stop="handleAction(instance, 'restart')"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span class="text-xs">{{ actionLoading[instance.id] === 'restart' ? '...' : $t('instance.actions.restart') }}</span>
              </button>
              <button
                v-if="!instance.packagePlanId && (instance as any).allow_instance_deletion !== false"
                :disabled="!!actionLoading[instance.id]"
                class="btn-ghost btn-sm flex-1 text-red-500 hover:text-red-400"
                @click.stop="handleAction(instance, 'delete')"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span class="text-xs">{{ actionLoading[instance.id] === 'delete' ? '...' : $t('instance.actions.delete') }}</span>
              </button>
            </div>
          </div>
        </TransitionGroup>

        <TransitionGroup
          name="instance-card-order"
          tag="div"
          class="hidden sm:grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3"
        >
          <article
            v-for="instance in instances"
            :key="instance.id"
            class="group relative overflow-hidden rounded-2xl border transition-colors duration-200"
            :class="[
              instance.status?.toLowerCase() === 'creating' ? 'creating-card' : '',
              recentlyOrderedInstanceId === instance.id ? (themeStore.isDark ? 'is-order-feedback-dark' : 'is-order-feedback-light') : '',
              selectedIds.has(instance.id) ? (themeStore.isDark ? 'ring-1 ring-blue-500/40' : 'ring-1 ring-blue-500/30') : '',
              themeStore.isDark
                ? 'border-gray-800 bg-gray-950 hover:border-gray-700'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
            ]"
          >
            <div class="flex h-full flex-col p-3.5">
              <div class="flex items-start gap-2.5">
                <button
                  type="button"
                  class="group/avatar relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border transition-all duration-150"
                  :class="themeStore.isDark
                    ? 'border-gray-800 bg-gray-900 hover:border-gray-700'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300'"
                  :aria-pressed="selectedIds.has(instance.id)"
                  @click.stop="toggleSelect(instance.id)"
                >
                  <span
                    class="absolute inset-0 flex items-center justify-center transition-opacity duration-150"
                    :class="selectedIds.has(instance.id) ? 'opacity-0' : 'opacity-100 group-hover/avatar:opacity-0'"
                  >
                    <InstanceDisplayIcon
                      v-if="instance.iconBadgeId || getPaidIconType(instance)"
                      :badge-id="instance.iconBadgeId"
                      :fallback-icon="getPaidIconType(instance)"
                      :alt="instance.name"
                      :size="40"
                    />
                    <DistroIcon
                      v-else
                      :distro="getDistroFromName(instance.image)"
                      :size="34"
                    />
                  </span>
                  <span
                    class="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-150"
                    :class="selectedIds.has(instance.id) ? 'opacity-100' : 'opacity-0 group-hover/avatar:opacity-100'"
                  >
                    <span
                      class="flex h-5 w-5 items-center justify-center rounded-md border shadow-sm"
                      :class="selectedIds.has(instance.id)
                        ? 'border-blue-500 bg-blue-500 text-white'
                        : (themeStore.isDark ? 'border-gray-600 bg-gray-950 text-transparent' : 'border-gray-300 bg-white text-transparent')"
                    >
                      <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </span>
                </button>

                <div class="min-w-0 flex-1 cursor-pointer" @click="openInstanceDetail(instance.id)">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div
                        class="truncate text-[14px] font-semibold leading-5"
                        :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
                      >
                        {{ instance.name }}
                      </div>
                      <div
                        class="mt-0.5 truncate text-xs"
                        :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'"
                      >
                        {{ formatImageName(instance.image, (instance as any).imageName) }}
                      </div>
                    </div>
                    <span :class="['badge badge-sm inline-flex items-center gap-1.5 shrink-0', getStatusInfo(instance.status, t).class]">
                      <span :class="['w-1 h-1 rounded-full', getStatusInfo(instance.status, t).dot]"></span>
                      <span class="text-[10px]">{{ getStatusInfo(instance.status, t).label }}</span>
                    </span>
                  </div>

                  <div class="mt-1.5 flex flex-wrap items-center gap-1">
                    <span
                      class="inline-flex max-w-[9.5rem] items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:max-w-[11rem] sm:gap-1.5 sm:text-[11px]"
                      :class="themeStore.isDark ? 'bg-gray-900 text-gray-300 ring-1 ring-white/5' : 'bg-gray-50 text-gray-700 ring-1 ring-black/5'"
                    >
                      <FlagIcon :code="(instance as any).host?.country_code || (instance as any).hostCountryCode || 'us'" size="xs" />
                      <span class="truncate">{{ getInstanceHostName(instance) }}</span>
                    </span>
                    <span
                      v-if="getInstancePackageName(instance)"
                      class="max-w-[9.5rem] truncate rounded-full px-2 py-0.5 text-[10px] sm:max-w-[11rem] sm:text-[11px]"
                      :class="themeStore.isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700'"
                      :title="getInstancePackageName(instance) || ''"
                    >
                      {{ getInstancePackageName(instance) }}
                    </span>
                    <span
                      class="shrink-0 rounded-full px-2 py-0.5 text-[10px] sm:text-[11px] whitespace-nowrap"
                      :class="getInstanceTypeBadgeClass(instance)"
                    >
                      {{ getInstanceTypeDisplayLabel(instance) }}
                    </span>
                    <span
                      class="max-w-[9rem] truncate rounded-full px-2 py-0.5 text-[10px] sm:max-w-[10rem] sm:text-[11px]"
                      :class="getInstanceNetworkModeClass(instance)"
                    >
                      {{ $t('common.networkMode.' + getInstanceNetworkMode(instance)) }}
                    </span>
                    <span
                      v-if="isAdmin"
                      class="max-w-[8rem] truncate rounded-full px-2 py-0.5 text-[10px] sm:text-[11px]"
                      :class="themeStore.isDark ? 'bg-gray-900 text-gray-300 ring-1 ring-white/5' : 'bg-gray-50 text-gray-700 ring-1 ring-black/5'"
                    >
                      {{ (instance as any).username || '-' }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="mt-auto">
                <div
                  class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-2"
                  :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
                  @click="openInstanceDetail(instance.id)"
                >
                  <div class="min-w-0">
                    <div class="text-[11px] text-themed-muted">{{ $t('instance.mobileCard.config') }}</div>
                    <div class="mt-1 truncate text-[13px] font-medium sm:text-sm" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                      {{ instance.cpu }}% / {{ formatMemory(instance.memory) }} / {{ formatDisk(instance.disk) }}
                    </div>
                  </div>
                  <div class="min-w-0">
                    <div class="text-[11px] text-themed-muted">{{ $t('instance.mobileCard.quota') }}</div>
                    <div class="mt-1 truncate text-[13px] font-medium sm:text-sm" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                      {{ (instance as any).portLimit ?? '-' }} / {{ (instance as any).snapshotLimit ?? '-' }} / {{ (instance as any).siteLimit ?? '-' }}
                    </div>
                  </div>
                  <div class="min-w-0">
                    <div class="text-[11px] text-themed-muted">{{ $t('instance.mobileCard.traffic') }}</div>
                    <div class="mt-1 truncate text-[13px] font-medium sm:text-sm" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                      <template v-if="(instance as any).monthlyTrafficLimit">
                        {{ formatBytes(Number((instance as any).monthlyTrafficUsed || 0)) }} / {{ formatBytes(Number((instance as any).monthlyTrafficLimit)) }}
                      </template>
                      <template v-else>
                        {{ formatBytes(Number((instance as any).monthlyTrafficUsed || 0)) }} / {{ $t('instance.mobileCard.unlimited') }}
                      </template>
                    </div>
                  </div>
                  <div class="min-w-0">
                    <div class="text-[11px] text-themed-muted">{{ $t('instance.expireAt') }}</div>
                    <div class="mt-1 truncate text-[13px] font-medium sm:text-sm" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                      <span>{{ getInstanceExpiryInfo(instance).dateText || '-' }}</span>
                      <span class="mx-1 text-themed-muted">·</span>
                      <span :class="getInstanceExpiryInfo(instance).className" :title="getInstanceExpiryInfo(instance).title || ''">
                        {{ getInstanceExpiryInfo(instance).remainingText }}
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  class="mt-2 grid grid-cols-1 gap-2 border-t pt-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                  :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
                >
                  <div class="min-h-[36px] min-w-0 cursor-pointer" @click="openInstanceDetail(instance.id)">
                    <div class="mb-1 text-[11px] text-themed-muted">{{ $t('instance.mobileCard.ipAddress') }}</div>
                    <div class="space-y-1">
                      <template v-if="getIps(instance).length > 0">
                        <div
                          v-for="(ipObj, idx) in getIps(instance)"
                          :key="idx"
                          class="truncate font-mono text-xs"
                          :class="[themeStore.isDark ? 'text-gray-300' : 'text-gray-700', ipObj.type === 'ipv6' ? 'opacity-80' : '']"
                          :title="ipObj.ip"
                        >
                          {{ ipObj.ip }}
                        </div>
                      </template>
                      <span v-else class="text-themed-muted text-xs">-</span>
                    </div>
                  </div>

                  <div class="flex min-w-[9.5rem] flex-wrap items-center justify-end gap-1.5 sm:max-w-[18rem] sm:justify-self-end">
                    <InstanceOrderMenu
                      v-if="canReorderInstances"
                      :actions="INSTANCE_ORDER_ACTIONS"
                      :labels="instanceOrderLabels"
                      :label="$t('instance.order.label')"
                      :disabled-actions="getInstanceOrderDisabledActions(instance.id)"
                      :loading="orderLoading"
                      :dark="themeStore.isDark"
                      align="right"
                      @reorder="reorderInstance(instance, $event)"
                    />
                    <button
                      v-if="instance.status?.toLowerCase() === 'stopped'"
                      :disabled="!!actionLoading[instance.id]"
                      class="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
                      :class="getCardActionButtonClass()"
                      :title="$t('instance.actions.start')"
                      :aria-label="$t('instance.actions.start')"
                      @click.stop="handleAction(instance, 'start')"
                    >
                      <svg v-if="actionLoading[instance.id] === 'start'" class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      </svg>
                    </button>
                    <button
                      v-if="instance.status?.toLowerCase() === 'running'"
                      :disabled="!!actionLoading[instance.id]"
                      class="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
                      :class="getCardActionButtonClass()"
                      :title="$t('instance.actions.stop')"
                      :aria-label="$t('instance.actions.stop')"
                      @click.stop="handleAction(instance, 'stop')"
                    >
                      <svg v-if="actionLoading[instance.id] === 'stop'" class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <rect x="5" y="5" width="10" height="10" rx="1.8" />
                      </svg>
                    </button>

                    <button
                      v-if="instance.status?.toLowerCase() === 'running'"
                      :disabled="!!actionLoading[instance.id]"
                      class="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
                      :class="getCardActionButtonClass()"
                      :title="$t('instance.actions.restart')"
                      :aria-label="$t('instance.actions.restart')"
                      @click.stop="handleAction(instance, 'restart')"
                    >
                      <svg v-if="actionLoading[instance.id] === 'restart'" class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>

                    <button
                      v-if="!instance.packagePlanId && (instance as any).allow_instance_deletion !== false"
                      :disabled="!!actionLoading[instance.id]"
                      class="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
                      :class="getCardActionButtonClass('danger')"
                      :title="$t('instance.actions.delete')"
                      :aria-label="$t('instance.actions.delete')"
                      @click.stop="handleAction(instance, 'delete')"
                    >
                      <svg v-if="actionLoading[instance.id] === 'delete'" class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      class="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
                      :class="getCardActionButtonClass()"
                      :title="$t('instance.details')"
                      :aria-label="$t('instance.details')"
                      @click.stop="openInstanceDetail(instance.id)"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </TransitionGroup>
      </div>
    </template>

    <div v-if="!loading && instances.length > 0" class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-themed-muted">
      <span>{{ $t('instance.totalRecords', { count: total }) }} · {{ page }} / {{ totalPages }}</span>
      <div class="flex items-center gap-2">
        <button
          :disabled="page <= 1"
          class="btn-ghost btn-sm"
          @click="goToPage(page - 1)"
        >
          {{ $t('common.prevPage') }}
        </button>
        <span class="min-w-[84px] text-center">{{ page }} / {{ totalPages }}</span>
        <button
          :disabled="page >= totalPages"
          class="btn-ghost btn-sm"
          @click="goToPage(page + 1)"
        >
          {{ $t('common.nextPage') }}
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="showBatchRenewModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @click.self="closeBatchRenewModal()"
      >
        <div class="absolute inset-0 bg-black/60" @click="closeBatchRenewModal()"></div>
        <div
          class="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl flex flex-col"
          :class="themeStore.isDark ? 'bg-gray-900 border border-gray-800' : 'bg-white border border-gray-200'"
        >
          <div class="flex items-center justify-between px-5 py-4 border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
            <div>
              <h3 class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                {{ configStore.freeSiteMode ? freeSiteCopy.instanceBatchRenewTitle : $t('instance.batch.renewTitle') }}
              </h3>
              <p class="text-sm text-themed-muted mt-1">{{ configStore.freeSiteMode ? freeSiteCopy.instanceBatchRenewDescription : $t('instance.batch.renewDescription') }}</p>
            </div>
            <button class="p-1 rounded hover:bg-gray-500/20" @click="closeBatchRenewModal()">
              <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-5 space-y-4">
            <div v-if="batchRenewLoading" class="flex items-center justify-center py-12">
              <svg class="w-8 h-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>

            <template v-else>
              <div class="grid gap-3 md:grid-cols-4">
                <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50'">
                  <div class="text-xs uppercase tracking-wide text-themed-muted">{{ $t('instance.batch.selectedCount', { count: selectedCount }) }}</div>
                  <div class="mt-2 text-2xl font-semibold" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">{{ selectedCount }}</div>
                </div>
                <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50'">
                  <div class="text-xs uppercase tracking-wide text-themed-muted">{{ $t('instance.batch.eligibleCount') }}</div>
                  <div class="mt-2 text-2xl font-semibold text-emerald-500">{{ batchRenewEligibleItems.length }}</div>
                </div>
                <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50'">
                  <div class="text-xs uppercase tracking-wide text-themed-muted">{{ configStore.freeSiteMode ? freeSiteCopy.instanceBatchTotalAmount : $t('instance.batch.totalAmount') }}</div>
                  <div class="mt-2 text-2xl font-semibold" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">{{ formatCurrency(batchRenewTotal) }}</div>
                </div>
                <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50'">
                  <div class="text-xs uppercase tracking-wide text-themed-muted">{{ configStore.freeSiteMode ? freeSiteCopy.instanceBatchBalanceAfter : $t('billing.balanceAfterRenew') }}</div>
                  <div class="mt-2 text-2xl font-semibold" :class="batchRenewInsufficientBalance ? 'text-red-500' : 'text-blue-500'">{{ formatCurrency(batchRenewBalanceAfter) }}</div>
                </div>
              </div>

              <div v-if="batchRenewMonthOptions.length > 0" class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/50' : 'border-gray-200 bg-gray-50/80'">
                <div class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">{{ $t('instance.batch.selectedMonths') }}</div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    v-for="months in batchRenewMonthOptions"
                    :key="months"
                    class="px-3 py-2 rounded-lg border text-sm transition-colors"
                    :class="months === batchRenewMonths
                      ? 'border-blue-500 bg-blue-500/10 text-blue-500'
                      : themeStore.isDark
                        ? 'border-gray-700 text-gray-300 hover:border-gray-600'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300'"
                    @click="batchRenewMonths = months"
                  >
                    {{ getBatchRenewMonthsLabel(months) }}
                  </button>
                </div>
              </div>

              <div
                v-else
                class="rounded-xl border p-4 text-sm"
                :class="themeStore.isDark ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300' : 'border-yellow-200 bg-yellow-50 text-yellow-700'"
              >
                {{ $t('instance.batch.renewEmpty') }}
              </div>

              <div
                v-if="batchRenewInsufficientBalance"
                class="rounded-xl border p-4 text-sm"
                :class="themeStore.isDark ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-700'"
              >
                {{ $t('billing.insufficientBalance') }}
                <RouterLink to="/wallet" class="underline ml-1">{{ $t('billing.goRecharge') }}</RouterLink>
              </div>

              <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/50' : 'border-gray-200 bg-white'">
                <div class="flex items-center justify-between gap-3 mb-3">
                  <h4 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                    {{ $t('instance.batch.eligibleList', { count: batchRenewEligibleItems.length }) }}
                  </h4>
                  <span class="text-xs text-themed-muted">{{ configStore.freeSiteMode ? freeSiteCopy.instanceBatchCurrentBalance : $t('billing.currentBalance') }}: {{ formatCurrency(batchRenewBalance.balance) }}</span>
                </div>
                <div v-if="batchRenewEligibleItems.length > 0" class="space-y-3 max-h-64 overflow-y-auto pr-1">
                  <div
                    v-for="item in batchRenewEligibleItems"
                    :key="item.id"
                    class="rounded-xl border px-3 py-3"
                    :class="themeStore.isDark ? 'border-gray-800 bg-black/20' : 'border-gray-200 bg-gray-50/80'"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-sm font-medium truncate" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">{{ item.name }}</div>
                        <div class="mt-1 flex flex-wrap gap-2 text-xs">
                          <span class="inline-flex items-center rounded-full px-2 py-0.5" :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'">
                            {{ item.autoRenew ? $t('billing.autoRenewEnabled') : $t('billing.autoRenewDisabled') }}
                          </span>
                          <span
                            v-if="item.isHostedInstance"
                            class="inline-flex items-center rounded-full px-2 py-0.5"
                            :class="themeStore.isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700'"
                          >
                            {{ $t('instance.batch.hosted') }}
                          </span>
                        </div>
                      </div>
                      <div class="text-right shrink-0">
                        <div class="text-sm font-semibold text-emerald-500">{{ formatCurrency(item.selectedOption?.discountedPrice) }}</div>
                        <div class="text-xs text-themed-muted">{{ formatDate(item.selectedOption?.expiresAt) }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="text-sm text-themed-muted">{{ $t('instance.batch.renewEmpty') }}</div>
              </div>

              <div
                v-if="batchRenewIneligibleItems.length > 0"
                class="rounded-xl border p-4"
                :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/50' : 'border-gray-200 bg-white'"
              >
                <h4 class="text-sm font-medium mb-3" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                  {{ $t('instance.batch.skippedList', { count: batchRenewIneligibleItems.length }) }}
                </h4>
                <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
                  <div
                    v-for="item in batchRenewIneligibleItems"
                    :key="`renew-skip-${item.id}`"
                    class="rounded-lg border px-3 py-2"
                    :class="themeStore.isDark ? 'border-gray-800 bg-black/20' : 'border-gray-200 bg-gray-50/80'"
                  >
                    <div class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">{{ item.name }}</div>
                    <div class="mt-1 text-xs" :class="themeStore.isDark ? 'text-red-300' : 'text-red-600'">
                      {{ translateBatchReason(item.reason || (item.canRenew ? '该实例不支持当前续费时长' : undefined)) }}
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div class="flex items-center justify-between gap-3 px-5 py-4 border-t" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
            <span class="text-xs text-themed-muted">{{ $t('instance.batch.currentPageOnly') }}</span>
            <div class="flex items-center gap-2">
              <button class="btn-ghost btn-sm" :disabled="batchRenewSubmitting" @click="closeBatchRenewModal()">
                {{ $t('common.cancel') }}
              </button>
              <button class="btn-primary btn-sm" :disabled="!batchRenewCanSubmit" @click="confirmBatchRenew">
                <svg v-if="batchRenewSubmitting" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ configStore.freeSiteMode ? freeSiteCopy.instanceBatchRenewAction : $t('instance.batch.renew') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="showBatchDestroyModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @click.self="closeBatchDestroyModal()"
      >
        <div class="absolute inset-0 bg-black/60" @click="closeBatchDestroyModal()"></div>
        <div
          class="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl flex flex-col"
          :class="themeStore.isDark ? 'bg-gray-900 border border-gray-800' : 'bg-white border border-gray-200'"
        >
          <div class="flex items-center justify-between px-5 py-4 border-b" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
            <div>
              <h3 class="text-lg font-semibold" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                {{ $t('instance.batch.destroyTitle') }}
              </h3>
              <p class="text-sm text-themed-muted mt-1">{{ $t('instance.batch.destroyDescription') }}</p>
            </div>
            <button class="p-1 rounded hover:bg-gray-500/20" @click="closeBatchDestroyModal()">
              <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-5 space-y-4">
            <div v-if="batchDestroyLoading" class="flex items-center justify-center py-12">
              <svg class="w-8 h-8 animate-spin text-red-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>

            <template v-else>
              <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-red-500/20 bg-red-500/10' : 'border-red-200 bg-red-50'">
                <div class="flex items-start gap-3">
                  <svg class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-red-200' : 'text-red-700'">
                    {{ $t('instance.destroy.warning') }}
                  </p>
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-4">
                <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50'">
                  <div class="text-xs uppercase tracking-wide text-themed-muted">{{ $t('instance.batch.selectedCount', { count: selectedCount }) }}</div>
                  <div class="mt-2 text-2xl font-semibold" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">{{ selectedCount }}</div>
                </div>
                <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50'">
                  <div class="text-xs uppercase tracking-wide text-themed-muted">{{ $t('instance.batch.eligibleCount') }}</div>
                  <div class="mt-2 text-2xl font-semibold text-emerald-500">{{ batchDestroyEligibleItems.length }}</div>
                </div>
                <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50'">
                  <div class="text-xs uppercase tracking-wide text-themed-muted">{{ $t('instance.batch.refundTotal') }}</div>
                  <div class="mt-2 text-2xl font-semibold text-emerald-500">{{ formatCurrency(batchDestroyTotalRefund) }}</div>
                </div>
                <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50'">
                  <div class="text-xs uppercase tracking-wide text-themed-muted">{{ $t('instance.batch.feeTotal') }}</div>
                  <div class="mt-2 text-2xl font-semibold" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">{{ formatCurrency(batchDestroyTotalFee) }}</div>
                </div>
              </div>

              <div
                v-if="batchDestroyEligibleItems.length === 0"
                class="rounded-xl border p-4 text-sm"
                :class="themeStore.isDark ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300' : 'border-yellow-200 bg-yellow-50 text-yellow-700'"
              >
                {{ $t('instance.batch.destroyEmpty') }}
              </div>

              <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/50' : 'border-gray-200 bg-white'">
                <h4 class="text-sm font-medium mb-3" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                  {{ $t('instance.batch.eligibleList', { count: batchDestroyEligibleItems.length }) }}
                </h4>
                <div v-if="batchDestroyEligibleItems.length > 0" class="space-y-3 max-h-64 overflow-y-auto pr-1">
                  <div
                    v-for="item in batchDestroyEligibleItems"
                    :key="item.id"
                    class="rounded-xl border px-3 py-3"
                    :class="themeStore.isDark ? 'border-gray-800 bg-black/20' : 'border-gray-200 bg-gray-50/80'"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-sm font-medium truncate" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">{{ item.name }}</div>
                        <div class="mt-1 text-xs text-themed-muted">
                          {{ item.instance.hostName }} · {{ item.instance.planName || $t('billing.freeInstance') }}
                        </div>
                        <div class="mt-2 flex flex-wrap gap-2 text-xs">
                          <span class="inline-flex items-center rounded-full px-2 py-0.5" :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'">
                            {{ item.isFreeInstance ? $t('billing.freeInstance') : $t('billing.paidInstance') }}
                          </span>
                          <span
                            v-if="!item.isFreeInstance && item.isFirstTime"
                            class="inline-flex items-center rounded-full px-2 py-0.5"
                            :class="themeStore.isDark ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'"
                          >
                            {{ $t('instance.destroy.firstTimeFree') }}
                          </span>
                          <span
                            v-else-if="!item.isFreeInstance && item.feeWaiverEligible"
                            class="inline-flex items-center rounded-full px-2 py-0.5"
                            :class="themeStore.isDark ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'"
                          >
                            {{ $t('instance.batch.feeWaived') }}
                          </span>
                        </div>
                      </div>
                      <div class="text-right shrink-0">
                        <div class="text-sm font-semibold text-emerald-500">{{ formatCurrency(item.refund.refundAmount) }}</div>
                        <div class="text-xs text-themed-muted">{{ $t('instance.destroy.feeAmount') }} {{ formatCurrency(item.refund.feeAmount) }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="text-sm text-themed-muted">{{ $t('instance.batch.destroyEmpty') }}</div>
              </div>

              <div
                v-if="batchDestroyIneligibleItems.length > 0"
                class="rounded-xl border p-4"
                :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/50' : 'border-gray-200 bg-white'"
              >
                <h4 class="text-sm font-medium mb-3" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                  {{ $t('instance.batch.skippedList', { count: batchDestroyIneligibleItems.length }) }}
                </h4>
                <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
                  <div
                    v-for="item in batchDestroyIneligibleItems"
                    :key="`destroy-skip-${item.id}`"
                    class="rounded-lg border px-3 py-2"
                    :class="themeStore.isDark ? 'border-gray-800 bg-black/20' : 'border-gray-200 bg-gray-50/80'"
                  >
                    <div class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">{{ item.name }}</div>
                    <div class="mt-1 text-xs" :class="themeStore.isDark ? 'text-red-300' : 'text-red-600'">
                      {{ item.cannotDestroyReason ? translateBatchReason(item.cannotDestroyReason) : $t('instance.destroy.cannotDestroy') }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/50' : 'border-gray-200 bg-gray-50/80'">
                <label class="block text-sm font-medium mb-2" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                  {{ $t('instance.batch.confirmHint') }}
                </label>
                <input
                  v-model="batchDestroyConfirm"
                  type="text"
                  class="input w-full"
                  :placeholder="$t('instance.batch.confirmPlaceholder')"
                />
              </div>
            </template>
          </div>

          <div class="flex items-center justify-between gap-3 px-5 py-4 border-t" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
            <span class="text-xs text-themed-muted">{{ $t('instance.batch.currentPageOnly') }}</span>
            <div class="flex items-center gap-2">
              <button class="btn-ghost btn-sm" :disabled="batchDestroySubmitting" @click="closeBatchDestroyModal()">
                {{ $t('common.cancel') }}
              </button>
              <button
                class="btn-sm text-white"
                :class="themeStore.isDark ? 'bg-red-500/80 hover:bg-red-500 disabled:bg-red-500/40' : 'bg-red-500 hover:bg-red-600 disabled:bg-red-300'"
                :disabled="!batchDestroyCanSubmit"
                @click="confirmBatchDestroy"
              >
                <svg v-if="batchDestroySubmitting" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ $t('instance.batch.destroy') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.instance-table-order-move,
.instance-stack-order-move,
.instance-card-order-move {
  transition:
    transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 520ms cubic-bezier(0.2, 0.8, 0.2, 1),
    background-color 520ms ease,
    border-color 520ms ease;
}

.is-order-feedback-light {
  background-color: rgb(249 250 251);
  box-shadow: 0 10px 28px rgb(15 23 42 / 0.08);
}

.is-order-feedback-dark {
  background-color: rgb(17 24 39 / 0.82);
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.22);
}

@media (prefers-reduced-motion: reduce) {
  .instance-table-order-move,
  .instance-stack-order-move,
  .instance-card-order-move {
    transition-duration: 1ms;
  }
}
</style>
