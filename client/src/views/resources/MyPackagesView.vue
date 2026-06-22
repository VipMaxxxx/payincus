<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import api from '@/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import PackageQuotaReleaseModal from '@/components/PackageQuotaReleaseModal.vue'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { translateError } from '@/utils/errorHandler'
import type { Package, Host } from '@/types/api'

// 为 KeepAlive include 匹配定义组件名称（必须在所有 import 之后）
defineOptions({ name: 'MyPackagesView' })

const { t } = useI18n()
const router = useRouter()
const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.user?.role === 'admin')
const MAX_PACKAGE_PLAN_PRICE_CENTS = 99999999
const MAX_PACKAGE_PLAN_PRICE = MAX_PACKAGE_PLAN_PRICE_CENTS / 100

// 管理员专用：套餐范围切换器
const scope = ref<'mine' | 'hosted'>('mine')
const filterUserId = ref('')  // 用于筛选特定用户的托管套餐

const packages = ref<Package[]>([])
const hosts = ref<Host[]>([])
const loading = ref<boolean>(true)

// 搜索
const searchQuery = ref('')

// 过滤后的套餐（按套餐名、节点名、描述搜索）
const filteredPackages = computed(() => {
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return packages.value
  return packages.value.filter(pkg => {
    // 按套餐名搜索
    if (pkg.name.toLowerCase().includes(query)) return true
    // 按描述搜索
    if (pkg.description && pkg.description.toLowerCase().includes(query)) return true
    // 按节点名搜索
    const hostNames = getHostNames(pkg as Package & { host_ids?: number[] }).toLowerCase()
    if (hostNames.includes(query)) return true
    return false
  })
})

// 分页配置
const packagesPage = ref(1)
const packagesPageSize = 100
const packagesTotalPages = computed(() => Math.max(1, Math.ceil(filteredPackages.value.length / packagesPageSize)))
const paginatedPackages = computed(() => {
  const start = (packagesPage.value - 1) * packagesPageSize
  return filteredPackages.value.slice(start, start + packagesPageSize)
})

// 计算可显示的页码列表
const packagesPageNumbers = computed(() => {
  const current = packagesPage.value
  const total = packagesTotalPages.value
  const pages: (number | string)[] = []
  
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current <= 3) {
      pages.push(2, 3, 4, 5, '...', total)
    } else if (current >= total - 2) {
      pages.push('...', total - 4, total - 3, total - 2, total - 1, total)
    } else {
      pages.push('...', current - 1, current, current + 1, '...', total)
    }
  }
  return pages
})

// 跳转到指定页码
function goToPackagesPage(p: number | string) {
  if (typeof p !== 'number') return
  if (p < 1 || p > packagesTotalPages.value) return
  packagesPage.value = p
}

// 监听总页数变化，防止页码越界
watch(packagesTotalPages, (newTotal) => {
  if (packagesPage.value > newTotal) {
    packagesPage.value = Math.max(1, newTotal)
  }
})

// 搜索时重置页码
function onSearchChange() {
  packagesPage.value = 1
}

// 清除搜索
function clearSearch() {
  searchQuery.value = ''
  packagesPage.value = 1
}

// 记录是否已经首次加载
let hasInitialLoad = false

// 套餐共享相关
interface Friend {
  id: number
  username: string
  email?: string
  avatarStyle: string
  avatarBadgeId?: string | null
}
const friends = ref<Friend[]>([])
const showShareModal = ref<boolean>(false)
const currentPackageId = ref<number | null>(null)
const selectedFriendId = ref<number | null>(null)
const shareLoading = ref<boolean>(false)
const showSharesModal = ref<boolean>(false)
const shares = ref<Array<{
  id: number
  packageId: number
  packageName: string
  ownerId: number
  ownerUsername: string
  sharedToId: number
  sharedToUsername: string
  sharedToAvatarStyle?: string | null
  sharedToAvatarBadgeId?: string | null
  quotaMultiplier: number | null
  maxInstances: number | null
  usage?: {
    instanceCount: number
    totalCpu: number
    totalMemory: number
  }
  createdAt: string
}>>([])
const sharesLoading = ref<boolean>(false)
const friendSearchQuery = ref<string>('')

// 共享配额限制
const quotaMultiplierOptions = computed(() => [
  { value: null, label: t('resources.packages.noLimit') },
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
])
const maxInstancesOptions = computed(() => [
  { value: null, label: t('resources.packages.noLimit') },
  { value: 1, label: t('resources.packages.instanceUnit', { n: 1 }) },
  { value: 2, label: t('resources.packages.instanceUnit', { n: 2 }) },
  { value: 3, label: t('resources.packages.instanceUnit', { n: 3 }) },
  { value: 5, label: t('resources.packages.instanceUnit', { n: 5 }) },
  { value: 10, label: t('resources.packages.instanceUnit', { n: 10 }) },
])
const selectedQuotaMultiplier = ref<number | null>(1)  // 默认 1x
const selectedMaxInstances = ref<number | null>(null)   // 默认无限制
const packageQuota = ref<{ cpuMax: number; memoryMax: number } | null>(null)
const currentPackage = ref<Package | null>(null)

// 配额释放相关
const showQuotaReleaseModal = ref<boolean>(false)
const quotaReleasePackage = ref<Package | null>(null)

function openQuotaReleaseModal(pkg: Package): void {
  quotaReleasePackage.value = pkg
  showQuotaReleaseModal.value = true
}

function handleQuotaReleaseSuccess(): void {
  // 可选：刷新套餐列表以显示最新配额
}

// 编辑配额相关
const showEditQuotaModal = ref<boolean>(false)
const editingShare = ref<typeof shares.value[0] | null>(null)
const editQuotaMultiplier = ref<number | null>(null)
const editMaxInstances = ref<number | null>(null)
const editQuotaLoading = ref<boolean>(false)

// 过滤已共享的好友，并支持搜索
const availableFriends = computed(() => {
  const sharedIds = new Set(shares.value.map(s => s.sharedToId))
  let filtered = friends.value.filter(f => !sharedIds.has(f.id))
  if (friendSearchQuery.value.trim()) {
    const query = friendSearchQuery.value.toLowerCase().trim()
    filtered = filtered.filter(f => f.username.toLowerCase().includes(query))
  }
  return filtered
})

function bytesToGB(bytes: string | null | undefined): number {
  if (!bytes) return 1
  try {
    const b = Number(bytes)
    if (isNaN(b) || b <= 0) return 1
    // 使用浮点运算支持小于1GB的值，保甙6位小数避免精度丢失
    const gb = b / (1024 * 1024 * 1024)
    // 四舍五入到6位小数，避免浮点精度问题
    const rounded = Math.round(gb * 1000000) / 1000000
    return rounded || 1
  } catch {
    return 1
  }
}

// 字节数转换为 Mbps（后端存储的是 bytes 但按 MB 计算为 Mbit）
function bytesToMbps(bytes: string | null | undefined): number {
  if (!bytes || bytes === '0') return 10
  try {
    const mbitMatch = bytes.match(/^(\d+(?:\.\d+)?)\s*Mbit$/i)
    if (mbitMatch) {
      return Math.round(Number(mbitMatch[1])) || 10
    }
    const gbitMatch = bytes.match(/^(\d+(?:\.\d+)?)\s*Gbit$/i)
    if (gbitMatch) {
      return Math.round(Number(gbitMatch[1]) * 1000) || 10
    }

    const b = Number(bytes)
    if (isNaN(b) || b <= 0) return 10
    // 后端计算: bytes / (1024 * 1024) = Mbit
    const mbps = b / (1024 * 1024)
    return Math.round(mbps) || 10
  } catch {
    return 10
  }
}

onMounted(async (): Promise<void> => {
  // 好友共享功能已禁用，不再加载好友列表
  await Promise.all([loadPackages(), loadHosts()])
  hasInitialLoad = true
})

// 当组件从 KeepAlive 缓存中激活时，重新加载数据
onActivated(async (): Promise<void> => {
  if (hasInitialLoad) {
    await Promise.all([loadPackages(), loadHosts()])
  }
})

async function loadPackages(): Promise<void> {
  loading.value = true
  try {
    if (isAdmin.value && scope.value === 'hosted') {
      // 管理员查看托管套餐
      const response = await api.packages.listHosted({
        ...(filterUserId.value ? { userId: parseInt(filterUserId.value, 10) } : {})
      })
      packages.value = (response as { packages?: Package[] }).packages || []
    } else if (isAdmin.value && scope.value === 'mine') {
      // 管理员查看自己的套餐（传 scope: 'mine'）
      const response = await api.packages.list({ all: true, scope: 'mine' })
      packages.value = (response as { packages?: Package[] }).packages || []
    } else {
      // 普通用户查看自己的套餐
      const response = await api.packages.list({ all: true })
      const allPackages = (response as { packages?: Package[] }).packages || []
      packages.value = allPackages.filter((p: any) => p.isOwn === true)
    }
  } finally {
    loading.value = false
  }
}

// 切换范围时重新加载
function switchScope(newScope: 'mine' | 'hosted'): void {
  scope.value = newScope
  filterUserId.value = ''
  packagesPage.value = 1
  loadPackages()
}

// 按用户ID筛选时重新加载
let filterTimer: ReturnType<typeof setTimeout> | null = null
watch(filterUserId, () => {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(() => {
    packagesPage.value = 1
    loadPackages()
  }, 300)
})

async function loadHosts(): Promise<void> {
  try {
    // 管理员加载所有节点（包括官方节点），普通用户只加载自己的节点
    // 传递 pageSize 以获取所有宿主机，避免默认分页限制（默认只返回20条）
    const response = await api.hosts.list(isAdmin.value ? { pageSize: '1000' } : { mine: 'true', pageSize: '1000' })
    hosts.value = (response as { hosts?: Host[] }).hosts || []
  } catch (err) {
    console.error('加载宿主机失败:', err)
  }
}

function getHostNames(pkg: Package & { host_ids?: number[] }): string {
  const hostIds = pkg.host_ids || []
  if (hostIds.length === 0) return t('admin.packages.noHostsBound')
  const hostNames = hostIds.map(id => {
    const host = hosts.value.find(h => h.id === id)
    return host ? host.name : `Host #${id}`
  })
  return hostNames.join(', ')
}

function getPackageNetworkModeLabel(pkg: Package): string {
  const mode = (pkg.network_mode || (pkg as { networkMode?: Package['network_mode'] }).networkMode || 'nat').toLowerCase()
  const key = `common.networkMode.${mode}`
  const translated = t(key)
  return translated === key ? mode : translated
}

function getPackageInstanceTypeLabel(pkg: Package): string {
  return pkg.instance_type === 'vm' ? t('common.instanceType.vm') : t('common.instanceType.container')
}

function formatTrafficMultiplier(value: unknown): string {
  const multiplier = Number(value ?? 1)
  if (!Number.isFinite(multiplier)) return '1x'
  return `${Math.round(multiplier * 1000) / 1000}x`
}

function getPackageTrafficMultiplierItems(pkg: Package & { host_ids?: number[] }): Array<{ hostName: string; multiplier: string }> {
  const hostIds = pkg.host_ids || []
  const multipliers = pkg.host_traffic_multipliers || {}

  if (hostIds.length === 0) {
    return [{ hostName: t('admin.packages.noHostsBound'), multiplier: formatTrafficMultiplier(1) }]
  }

  return hostIds.map(id => {
    const host = hosts.value.find(h => h.id === id)
    return {
      hostName: host ? host.name : `Host #${id}`,
      multiplier: formatTrafficMultiplier(multipliers[String(id)] ?? 1)
    }
  })
}

function getPackageTrafficMultiplierLabel(pkg: Package & { host_ids?: number[] }): string {
  const items = getPackageTrafficMultiplierItems(pkg)
  const uniqueMultipliers = [...new Set(items.map(item => item.multiplier))]
  return uniqueMultipliers.join(' / ')
}

function getPackageTrafficMultiplierTitle(pkg: Package & { host_ids?: number[] }): string {
  return getPackageTrafficMultiplierItems(pkg)
    .map(item => `${item.hostName}: ${item.multiplier}`)
    .join(', ')
}

function isPackagePublic(pkg: Package): boolean {
  const globalShared = (pkg as { global_shared?: unknown }).global_shared
  const active = (pkg as { active?: unknown }).active
  const isActive = active === true || active === 1
  return isActive && (globalShared === true || globalShared === 1 || pkg.isGlobalShared === true)
}

/**
 * 复制套餐分享链接
 * 链接格式: /instances/create?source=market|official&package=123
 */
function copyShareLink(pkg: Package): void {
  // 判断套餐来源：任一节点名以 PEER 开头 = 托管市场
  const hostNames = getHostNames(pkg)
  const isHostedPackage = hostNames.split(', ').some(name => name.toUpperCase().startsWith('PEER'))
  const source = isHostedPackage ? 'market' : 'official'
  const link = `${window.location.origin}/instances/create?source=${source}&package=${pkg.id}`
  
  navigator.clipboard.writeText(link).then(() => {
    toast.success(t('resources.packages.shareLinkCopied'))
  }).catch(() => {
    toast.error(t('common.copyFailed'))
  })
}

// 跳转到创建页面
async function openCreate(): Promise<void> {
  router.push({ name: 'my-package-create' })
}

function openEdit(pkg: Package): void {
  router.push({ name: 'my-package-edit', params: { id: pkg.id } })
}

async function deletePackage(pkg: Package): Promise<void> {
  if (!confirm(t('admin.packages.confirmDelete', { name: pkg.name }))) return

  try {
    await api.packages.delete(pkg.id)
    packages.value = packages.value.filter(p => p.id !== pkg.id)
    toast.success(t('admin.packages.packageDeleted'))
  } catch (err: any) {
    toast.error(t('admin.packages.deleteFailed') + ': ' + translateError(err))
  }
}

// 格式化内存
function formatMemory(mb: number): string {
  if (!mb) return '0'
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb % 1 === 0 ? gb.toFixed(0) + ' GB' : gb.toFixed(1) + ' GB'
  }
  return mb + ' MB'
}

// 格式化磁盘（1024进制）
function formatDisk(mb: number): string {
  if (!mb) return '0'
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb % 1 === 0 ? gb.toFixed(0) + ' GB' : gb.toFixed(1) + ' GB'
  }
  return mb + ' MB'
}

// 好友共享功能已禁用，以下函数保留但不使用
// @ts-ignore - 好友共享功能已禁用

// 打开共享弹窗
async function openShareModal(pkg: Package): Promise<void> {
  currentPackageId.value = pkg.id
  currentPackage.value = pkg
  selectedFriendId.value = null
  friendSearchQuery.value = ''
  selectedQuotaMultiplier.value = 1  // 重置为默认值
  selectedMaxInstances.value = null
  showShareModal.value = true
  // 预加载共享列表，用于过滤已共享的好友
  await loadShares(pkg.id)
}

// @ts-ignore - 好友共享功能已禁用
 
// 共享套餐给好友
async function sharePackage(): Promise<void> {
  if (!currentPackageId.value || !selectedFriendId.value) return

  shareLoading.value = true
  try {
    await api.packages.share(
      currentPackageId.value,
      selectedFriendId.value,
      selectedQuotaMultiplier.value,
      selectedMaxInstances.value
    )
    toast.success(t('resources.packages.shareSuccess'))
    showShareModal.value = false
    await loadShares(currentPackageId.value)
  } catch (err: any) {
    toast.error(err.message || t('resources.packages.shareFailed'))
  } finally {
    shareLoading.value = false
  }
}

// @ts-ignore - 好友共享功能已禁用
 
// 加载共享列表
async function loadShares(packageId: number): Promise<void> {
  sharesLoading.value = true
  try {
    const res = await api.packages.getShares(packageId)
    shares.value = res.shares || []
    packageQuota.value = res.packageQuota || null
  } catch (err) {
    console.error('加载共享列表失败:', err)
    shares.value = []
    packageQuota.value = null
  } finally {
    sharesLoading.value = false
  }
}

// @ts-ignore - 好友共享功能已禁用
 
// 取消共享
async function unsharePackage(sharedToId: number): Promise<void> {
  if (!currentPackageId.value) return
  if (!confirm(t('resources.packages.confirmUnshare'))) return

  try {
    await api.packages.unshare(currentPackageId.value, sharedToId)
    toast.success(t('resources.packages.unshareSuccess'))
    await loadShares(currentPackageId.value)
  } catch (err: any) {
    toast.error(err.message || t('resources.packages.unshareFailed'))
  }
}

// 格式化时间
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

// @ts-ignore - 好友共享功能已禁用
 
// 打开编辑配额弹窗
function openEditQuotaModal(share: typeof shares.value[0]): void {
  editingShare.value = share
  editQuotaMultiplier.value = share.quotaMultiplier
  editMaxInstances.value = share.maxInstances
  showEditQuotaModal.value = true
}

// @ts-ignore - 好友共享功能已禁用
 
// 保存编辑的配额
async function saveEditQuota(): Promise<void> {
  if (!currentPackageId.value || !editingShare.value) return

  editQuotaLoading.value = true
  try {
    await api.packages.updateShareQuota(
      currentPackageId.value,
      editingShare.value.id,
      editQuotaMultiplier.value,
      editMaxInstances.value
    )
    toast.success(t('resources.packages.quotaUpdated'))
    showEditQuotaModal.value = false
    await loadShares(currentPackageId.value)
  } catch (err: any) {
    toast.error(err.message || t('resources.packages.quotaUpdateFailed'))
  } finally {
    editQuotaLoading.value = false
  }
}

// @ts-ignore - 好友共享功能已禁用
 
// 计算使用量百分比
function getUsagePercent(share: typeof shares.value[0], type: 'cpu' | 'memory' | 'instances'): number {
  if (!share.usage || !packageQuota.value) return 0
  
  if (type === 'instances') {
    if (share.maxInstances === null) return 0
    return Math.min(100, (share.usage.instanceCount / share.maxInstances) * 100)
  }
  
  if (share.quotaMultiplier === null) return 0
  
  if (type === 'cpu') {
    const maxCpu = Math.floor(packageQuota.value.cpuMax * share.quotaMultiplier)
    return Math.min(100, (share.usage.totalCpu / maxCpu) * 100)
  }
  
  const maxMemory = Math.floor(packageQuota.value.memoryMax * share.quotaMultiplier)
  return Math.min(100, (share.usage.totalMemory / maxMemory) * 100)
}

// 方案管理相关
interface PackagePlan {
  id: number
  name: string
  description: string | null
  cpu: number
  memory: number
  disk: number
  portLimit: number
  snapshotLimit: number
  backupLimit: number
  siteLimit: number
  swapSize: number
  trafficLimit: string
  trafficLimitSpeed: string
  price: number
  billingCycle: number
  monthlyPrice: number
  isActive: boolean
  isSoldOut: boolean
  sortOrder: number
  slaGuarantee: number | null
}

type PackagePlanStatus = 'active' | 'soldOut' | 'inactive'

const showPlansModal = ref<boolean>(false)
const plansPackage = ref<Package | null>(null)
const plans = ref<PackagePlan[]>([])
const plansLoading = ref<boolean>(false)
const showPlanFormModal = ref<boolean>(false)
const editingPlan = ref<PackagePlan | null>(null)
const planFormLoading = ref<boolean>(false)

const planForm = ref({
  name: '',
  description: '',
  cpu: 100,
  memory: 512,
  disk: 5120,
  portLimit: 3,
  snapshotLimit: 3,
  swapSize: 0,
  siteLimit: 1,
  trafficLimit: 1,
  trafficLimitSpeed: 10, // Mbps
  price: 0,
  billingCycle: 1,  // 计费周期（月），默认月付
  status: 'active' as PackagePlanStatus,
  sortOrder: 0,
  slaGuarantee: null as number | null
})

const planStatusOptions = computed(() => [
  { value: 'active' as PackagePlanStatus, label: t('resources.plans.statusActive'), description: t('resources.plans.statusActiveHint') },
  { value: 'soldOut' as PackagePlanStatus, label: t('resources.plans.statusSoldOut'), description: t('resources.plans.statusSoldOutHint') },
  { value: 'inactive' as PackagePlanStatus, label: t('resources.plans.statusInactive'), description: t('resources.plans.statusInactiveHint') }
])

const selectedPlanStatusOption = computed(() =>
  planStatusOptions.value.find(option => option.value === planForm.value.status) || planStatusOptions.value[0]
)

function getPlanStatus(plan: PackagePlan): PackagePlanStatus {
  if (!plan.isActive) return 'inactive'
  if (plan.isSoldOut) return 'soldOut'
  return 'active'
}

function getPlanStatusLabel(plan: PackagePlan): string {
  const status = getPlanStatus(plan)
  if (status === 'soldOut') return t('resources.plans.statusSoldOut')
  if (status === 'inactive') return t('resources.plans.statusInactive')
  return t('resources.plans.statusActive')
}

function getPlanStatusBadgeClass(plan: PackagePlan): string {
  const status = getPlanStatus(plan)
  if (status === 'soldOut') {
    return themeStore.isDark ? 'bg-red-500/15 text-red-300' : 'bg-red-50 text-red-700'
  }
  if (status === 'inactive') {
    return themeStore.isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
  }
  return 'badge-success'
}

function getPlanStatusSegmentClass(status: PackagePlanStatus): string {
  const selected = planForm.value.status === status

  if (!selected) {
    return themeStore.isDark
      ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
      : 'text-gray-500 hover:bg-white hover:text-gray-900'
  }

  if (status === 'active') {
    return themeStore.isDark
      ? 'bg-emerald-500/15 text-emerald-300 shadow-sm ring-1 ring-emerald-500/30'
      : 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200'
  }

  if (status === 'soldOut') {
    return themeStore.isDark
      ? 'bg-amber-500/15 text-amber-300 shadow-sm ring-1 ring-amber-500/30'
      : 'bg-white text-amber-700 shadow-sm ring-1 ring-amber-200'
  }

  return themeStore.isDark
    ? 'bg-gray-700 text-gray-200 shadow-sm ring-1 ring-gray-600'
    : 'bg-white text-gray-700 shadow-sm ring-1 ring-gray-200'
}

function getPlanStatusDotClass(status: PackagePlanStatus): string {
  if (status === 'active') {
    return themeStore.isDark ? 'bg-emerald-300' : 'bg-emerald-500'
  }
  if (status === 'soldOut') {
    return themeStore.isDark ? 'bg-amber-300' : 'bg-amber-500'
  }
  return themeStore.isDark ? 'bg-gray-400' : 'bg-gray-500'
}

// 计费周期选项（单位：月）- 非管理员只能选择月付
const billingCycleOptions = computed(() => {
  // 非管理员只能选择月付
  if (!authStore.isAdmin) {
    return [{ value: 1, label: t('resources.plans.monthly') }]
  }
  // 管理员可以选择所有周期
  return [
    { value: 1, label: t('resources.plans.monthly') },
    { value: 3, label: t('resources.plans.quarterly') },
    { value: 6, label: t('resources.plans.semiAnnual') },
    { value: 12, label: t('resources.plans.yearly') }
  ]
})

function normalizePlanPriceCents(value: unknown): number | null {
  const price = Number(value)
  if (!Number.isFinite(price) || price < 0 || price > MAX_PACKAGE_PLAN_PRICE) {
    return null
  }

  const cents = price * 100
  if (Math.abs(cents - Math.round(cents)) >= 1e-8) {
    return null
  }

  const roundedCents = Math.round(cents)
  return roundedCents <= MAX_PACKAGE_PLAN_PRICE_CENTS ? roundedCents : null
}

async function openPlansModal(pkg: Package): Promise<void> {
  plansPackage.value = pkg
  showPlansModal.value = true
  await loadPlans(pkg.id)
}

async function loadPlans(packageId: number): Promise<void> {
  plansLoading.value = true
  try {
    const res = await api.packages.getPlans(packageId)
    plans.value = res.plans || []
  } catch (err) {
    console.error('加载方案列表失败:', err)
    plans.value = []
  } finally {
    plansLoading.value = false
  }
}

function openCreatePlanModal(): void {
  editingPlan.value = null
  planForm.value = {
    name: '',
    description: '',
    cpu: plansPackage.value?.cpu_max || 100,
    memory: plansPackage.value?.memory_max || 512,
    disk: plansPackage.value?.disk_max || 5120,
    portLimit: 3,
    snapshotLimit: 3,
    swapSize: 0,
    siteLimit: 1,
    trafficLimit: 1,
    trafficLimitSpeed: 10, // Mbps
    price: 0,
    billingCycle: 1,  // 默认月付
    status: 'active',
    sortOrder: plans.value.length,
    slaGuarantee: null
  }
  showPlanFormModal.value = true
}

function openEditPlanModal(plan: PackagePlan): void {
  editingPlan.value = plan
  planForm.value = {
    name: plan.name,
    description: plan.description || '',
    cpu: plan.cpu,
    memory: plan.memory,
    disk: plan.disk,
    portLimit: plan.portLimit,
    snapshotLimit: plan.snapshotLimit,
    swapSize: plan.swapSize,
    siteLimit: plan.siteLimit,
    trafficLimit: bytesToGB(plan.trafficLimit),
    trafficLimitSpeed: bytesToMbps(plan.trafficLimitSpeed),
    price: plan.price / 100,
    billingCycle: plan.billingCycle,
    status: getPlanStatus(plan),
    sortOrder: plan.sortOrder,
    slaGuarantee: plan.slaGuarantee
  }
  showPlanFormModal.value = true
}

function gbToBytes(gb: string | number): string {
  if (gb === '' || gb === null || gb === undefined) return ''
  try {
    const gbNum = typeof gb === 'string' ? parseFloat(gb) : gb
    if (isNaN(gbNum) || gbNum <= 0) return ''
    // 使用普通数学运算支持小数，然后转为BigInt字符串
    const bytes = Math.floor(gbNum * 1024 * 1024 * 1024)
    return bytes.toString()
  } catch {
    return ''
  }
}

// Mbps 转换为字节数（后端按 bytes / (1024*1024) = Mbit 计算）
function mbpsToBytes(mbps: string | number): string {
  if (mbps === '' || mbps === null || mbps === undefined) return ''
  try {
    const mbpsNum = typeof mbps === 'string' ? parseFloat(mbps) : mbps
    if (isNaN(mbpsNum) || mbpsNum <= 0) return ''
    // 后端计算: bytes / (1024 * 1024) = Mbit，所以 bytes = Mbit * 1024 * 1024
    const bytes = Math.floor(mbpsNum * 1024 * 1024)
    return bytes.toString()
  } catch {
    return ''
  }
}

async function savePlan(): Promise<void> {
  if (!plansPackage.value || !planForm.value.name.trim()) return

  const priceCents = normalizePlanPriceCents(planForm.value.price)
  if (priceCents === null) {
    toast.error(t('resources.plans.priceRangeError', { max: MAX_PACKAGE_PLAN_PRICE.toFixed(2) }))
    return
  }
  planForm.value.price = priceCents / 100

  planFormLoading.value = true
  try {
    const data = {
      name: planForm.value.name.trim(),
      description: planForm.value.description.trim() || undefined,
      cpu: planForm.value.cpu,
      memory: planForm.value.memory,
      disk: planForm.value.disk,
      portLimit: planForm.value.portLimit,
      snapshotLimit: planForm.value.snapshotLimit,
      backupLimit: 0,
      siteLimit: planForm.value.siteLimit,
      swapSize: planForm.value.swapSize,
      trafficLimit: gbToBytes(planForm.value.trafficLimit) || '0',
      trafficLimitSpeed: mbpsToBytes(planForm.value.trafficLimitSpeed) || '0',
      price: priceCents,
      billingCycle: planForm.value.billingCycle,
      isActive: planForm.value.status !== 'inactive',
      isSoldOut: planForm.value.status === 'soldOut',
      sortOrder: planForm.value.sortOrder,
      slaGuarantee: planForm.value.slaGuarantee ?? undefined
    }

    if (editingPlan.value) {
      await api.packages.updatePlan(plansPackage.value.id, editingPlan.value.id, data)
      toast.success(t('resources.plans.updateSuccess'))
    } else {
      await api.packages.createPlan(plansPackage.value.id, data)
      toast.success(t('resources.plans.createSuccess'))
    }
    showPlanFormModal.value = false
    await loadPlans(plansPackage.value.id)
  } catch (err: any) {
    toast.error(translateError(err) || t('resources.plans.saveFailed'))
  } finally {
    planFormLoading.value = false
  }
}

async function deletePlan(plan: PackagePlan): Promise<void> {
  if (!plansPackage.value) return
  if (!confirm(t('resources.plans.confirmDelete', { name: plan.name }))) return

  try {
    await api.packages.deletePlan(plansPackage.value.id, plan.id)
    toast.success(t('resources.plans.deleteSuccess'))
    await loadPlans(plansPackage.value.id)
  } catch (err: any) {
    toast.error(err.message || t('resources.plans.deleteFailed'))
  }
}

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2)
}

function getBillingCycleLabel(months: number): string {
  const opt = billingCycleOptions.value.find(o => o.value === months)
  return opt ? opt.label : `${months} ${t('resources.plans.months')}`
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('resources.packages.title') }}</h1>
        <p class="page-description">{{ t('resources.packages.description') }}</p>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
      <div class="flex items-center gap-3 flex-wrap">
        <!-- 搜索框 -->
        <div class="relative flex-1 sm:flex-none sm:w-48">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            class="input pl-10 pr-8 w-full"
            :placeholder="t('resources.packages.searchPlaceholder')"
            @input="onSearchChange"
          />
          <button
            v-if="searchQuery"
            class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors"
            :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'"
            @click="clearSearch"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <!-- 管理员专用：套餐范围切换器 -->
        <div v-if="isAdmin" class="inline-flex rounded-lg p-1" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
          <button
            class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            :class="scope === 'mine' 
              ? (themeStore.isDark ? 'bg-gray-700 text-white' : 'bg-white text-gray-900 shadow-sm') 
              : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')"
            @click="switchScope('mine')"
          >
            {{ t('resources.packages.mine') }}
          </button>
          <button
            class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            :class="scope === 'hosted' 
              ? (themeStore.isDark ? 'bg-gray-700 text-white' : 'bg-white text-gray-900 shadow-sm') 
              : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')"
            @click="switchScope('hosted')"
          >
            {{ t('resources.packages.hosted') }}
          </button>
        </div>
        <!-- 托管套餐用户ID筛选 -->
        <div v-if="isAdmin && scope === 'hosted'" class="relative sm:w-36">
          <input
            v-model="filterUserId"
            type="text"
            :placeholder="t('resources.packages.filterByUserId')"
            class="input pl-9 w-full"
          />
          <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
      </div>
      <button v-if="scope === 'mine'" class="btn-primary" @click="openCreate">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ t('resources.packages.create') }}
      </button>
    </div>

    <!-- 套餐列表 -->
    <SkeletonLoader v-if="loading" type="list" />

    <div v-else-if="filteredPackages.length === 0" class="card p-12 text-center">
      <svg
        class="w-12 h-12 mx-auto mb-4"
        :class="themeStore.isDark ? 'text-gray-700' : 'text-gray-300'"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
      <template v-if="searchQuery">
        <p class="text-themed-secondary">{{ t('resources.packages.noSearchResults') }}</p>
        <button class="text-xs text-primary hover:underline mt-2" @click="clearSearch">{{ t('resources.packages.clearSearch') }}</button>
      </template>
      <template v-else>
        <p class="text-themed-secondary">{{ t('resources.packages.noPackages') }}</p>
        <p class="text-xs text-themed-muted mt-2">{{ t('resources.packages.noPackagesHint') }}</p>
      </template>
    </div>

    <template v-else>
      <div class="card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr :class="themeStore.isDark ? 'bg-gray-800/50 border-b border-gray-700' : 'bg-gray-50 border-b border-gray-200'">
                <th class="text-left px-4 py-3 font-medium text-themed-muted whitespace-nowrap">{{ t('admin.packages.name') }}</th>
                <th v-if="isAdmin && scope === 'hosted'" class="text-left px-4 py-3 font-medium text-themed-muted whitespace-nowrap">{{ t('resources.packages.owner') }}</th>
                <th class="text-left px-4 py-3 font-medium text-themed-muted whitespace-nowrap">{{ t('admin.packages.status') }}</th>
                <th class="text-left px-4 py-3 font-medium text-themed-muted whitespace-nowrap">{{ t('resources.packages.networkModeColumn') }}</th>
                <th class="text-left px-4 py-3 font-medium text-themed-muted whitespace-nowrap">{{ t('resources.packages.instanceTypeColumn') }}</th>
                <th class="text-right px-4 py-3 font-medium text-themed-muted whitespace-nowrap">{{ t('resources.packages.trafficMultiplierColumn') }}</th>
                <th class="text-left px-4 py-3 font-medium text-themed-muted whitespace-nowrap">{{ t('resources.packages.hostColumn') }}</th>
                <th class="text-right px-4 py-3 font-medium text-themed-muted whitespace-nowrap">{{ t('resources.packages.instanceColumn') }}</th>
                <th v-if="scope === 'mine'" class="text-right px-4 py-3 font-medium text-themed-muted whitespace-nowrap">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="pkg in paginatedPackages"
                :key="pkg.id"
                class="border-b transition-colors"
                :class="[
                  themeStore.isDark ? 'border-gray-800 hover:bg-gray-800/30' : 'border-gray-100 hover:bg-gray-50',
                  pkg.active !== 1 ? 'opacity-60' : ''
                ]"
              >
                <!-- 套餐名称 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-medium truncate" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">{{ pkg.name }}</span>
                    <span
                      v-if="isPackagePublic(pkg)"
                      class="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30"
                    >
                      {{ t('resources.packages.publicBadge') }}
                    </span>
                  </div>
                  <div v-if="pkg.description" class="text-xs text-themed-muted mt-0.5 max-w-48 truncate">{{ pkg.description }}</div>
                </td>
                <!-- 托管套餐所有者信息 -->
                <td v-if="isAdmin && scope === 'hosted'" class="px-4 py-3 whitespace-nowrap">
                  <div v-if="pkg.owner" class="flex items-center gap-2">
                    <UserAvatar :avatar-style="pkg.owner.avatarStyle" :badge-id="pkg.owner.avatarBadgeId || null" :size="28" :username="pkg.owner.username" />
                    <div>
                      <div class="text-sm font-medium text-themed">{{ pkg.owner.username }}</div>
                      <div class="text-xs text-themed-muted">UID: {{ pkg.owner.id }}</div>
                    </div>
                  </div>
                  <span v-else class="text-themed-muted">-</span>
                </td>
                <!-- 状态 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <span v-if="pkg.active === 1" class="badge badge-success text-xs">{{ t('admin.packages.active') }}</span>
                  <span v-else class="badge badge-default text-xs" :title="t('admin.packages.archivedHint')">{{ t('admin.packages.inactive') }}</span>
                </td>
                <!-- 网络模式 -->
                <td class="px-4 py-3 whitespace-nowrap" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'">
                  {{ getPackageNetworkModeLabel(pkg) }}
                </td>
                <!-- 实例类型 -->
                <td class="px-4 py-3 whitespace-nowrap" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'">
                  {{ getPackageInstanceTypeLabel(pkg) }}
                </td>
                <!-- 流量倍率 -->
                <td
                  class="px-4 py-3 text-right font-mono whitespace-nowrap"
                  :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'"
                  :title="getPackageTrafficMultiplierTitle(pkg)"
                >
                  {{ getPackageTrafficMultiplierLabel(pkg) }}
                </td>
                <!-- 绑定宿主机 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <span class="text-xs text-themed-muted max-w-32 truncate block">{{ getHostNames(pkg) }}</span>
                </td>
                <!-- 套餐下实例数 -->
                <td class="px-4 py-3 text-right font-mono whitespace-nowrap" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'">
                  {{ pkg.instance_count || 0 }}
                </td>
                <!-- 操作 -->
                <td v-if="scope === 'mine'" class="px-4 py-3">
                  <div class="flex items-center justify-end gap-1">
                    <!-- 分享链接 -->
                    <button
                      type="button"
                      class="p-1.5 transition-colors rounded"
                      :class="themeStore.isDark ? 'text-gray-500 hover:text-blue-400 hover:bg-gray-800' : 'text-gray-400 hover:text-blue-600 hover:bg-gray-100'"
                      :title="t('resources.packages.copyShareLink')"
                      @click="copyShareLink(pkg)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    </button>
                    <button
                      class="p-1.5 transition-colors rounded"
                      :class="themeStore.isDark ? 'text-gray-500 hover:text-indigo-400 hover:bg-gray-800' : 'text-gray-400 hover:text-indigo-600 hover:bg-gray-100'"
                      :title="t('resources.plans.manage')"
                      @click="openPlansModal(pkg)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                      </svg>
                    </button>
                    <!-- 好友共享功能已禁用，移除共享按钮 -->
                    <button
                      class="p-1.5 transition-colors rounded"
                      :class="themeStore.isDark ? 'text-gray-500 hover:text-teal-400 hover:bg-gray-800' : 'text-gray-400 hover:text-teal-600 hover:bg-gray-100'"
                      :title="t('quotaRelease.title')"
                      @click="openQuotaReleaseModal(pkg)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </button>
                    <!-- 好友共享功能已禁用，移除查看共享列表按钮 -->
                    <button
                      class="p-1.5 transition-colors rounded"
                      :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'"
                      :title="t('common.edit')"
                      @click="openEdit(pkg)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      class="p-1.5 transition-colors rounded"
                      :class="themeStore.isDark ? 'text-gray-500 hover:text-error hover:bg-gray-800' : 'text-gray-400 hover:text-error hover:bg-gray-100'"
                      :title="t('common.delete')"
                      @click="deletePackage(pkg)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 分页控件 -->
        <div v-if="packagesTotalPages > 1" class="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 text-sm text-themed-muted border-t" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-100'">
          <span>{{ t('common.total') }} {{ filteredPackages.length }} {{ t('common.items') }}</span>
          <div class="flex items-center gap-1 flex-wrap justify-center">
            <button :disabled="packagesPage <= 1" class="btn-ghost btn-sm" :class="packagesPage <= 1 ? 'cursor-not-allowed' : ''" @click="goToPackagesPage(packagesPage - 1)">{{ t('instance.prevPage') }}</button>
            <template v-for="(p, idx) in packagesPageNumbers" :key="idx">
              <span v-if="p === '...'" class="px-2 py-1 text-themed-muted">…</span>
              <button
                v-else
                class="min-w-[32px] px-2 py-1 rounded transition-colors"
                :class="[
                  p === packagesPage
                    ? (themeStore.isDark ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white')
                    : (themeStore.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100')
                ]"
                @click="goToPackagesPage(p)"
              >
                {{ p }}
              </button>
            </template>
            <button :disabled="packagesPage >= packagesTotalPages" class="btn-ghost btn-sm" :class="packagesPage >= packagesTotalPages ? 'cursor-not-allowed' : ''" @click="goToPackagesPage(packagesPage + 1)">{{ t('instance.nextPage') }}</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 共享套餐弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showShareModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showShareModal = false"></div>
          <div class="modal-content max-w-lg">
            <div class="modal-header">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-blue-500/20' : 'bg-blue-100'">
                  <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </div>
                <div>
                  <h3 class="modal-title">{{ t('resources.packages.shareToFriend') }}</h3>
                  <p v-if="currentPackage" class="text-xs text-themed-muted mt-0.5">
                    {{ currentPackage.name }} · {{ currentPackage.cpu_max }}% CPU · {{ formatMemory(currentPackage.memory_max) }}
                  </p>
                </div>
              </div>
              <button class="p-1.5 rounded-lg transition-colors" :class="themeStore.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'" @click="showShareModal = false">
                <svg class="w-5 h-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="modal-body space-y-4">
              <!-- 搜索框 -->
              <div class="relative">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  v-model="friendSearchQuery"
                  type="text"
                  class="input pl-10"
                  :placeholder="t('resources.packages.searchFriend')"
                />
              </div>

              <!-- 好友列表 -->
              <div v-if="sharesLoading" class="py-8">
                <SkeletonLoader type="list" />
              </div>
              <div v-else-if="friends.length === 0" class="text-center py-10">
                <div class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                  <svg class="w-8 h-8" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p class="text-themed-secondary font-medium">{{ t('resources.packages.noFriends') }}</p>
                <p class="text-xs text-themed-muted mt-1">{{ t('resources.packages.noFriendsHint') }}</p>
              </div>
              <div v-else-if="availableFriends.length === 0" class="text-center py-10">
                <div class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-green-500/10' : 'bg-green-50'">
                  <svg class="w-8 h-8" :class="themeStore.isDark ? 'text-green-400' : 'text-green-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p class="text-themed-secondary font-medium">{{ t('resources.packages.allFriendsShared') }}</p>
                <p class="text-xs text-themed-muted mt-1">{{ t('resources.packages.noAvailableFriends') }}</p>
              </div>
              <div v-else class="space-y-2 max-h-56 overflow-y-auto">
                <p class="text-xs text-themed-muted mb-2">{{ t('resources.packages.selectToShare') }}</p>
                <button
                  v-for="friend in availableFriends"
                  :key="friend.id"
                  type="button"
                  class="w-full flex items-center gap-3 p-3 rounded-xl border transition-all"
                  :class="[
                    selectedFriendId === friend.id
                      ? themeStore.isDark
                        ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30'
                        : 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                      : themeStore.isDark
                        ? 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  ]"
                  @click="selectedFriendId = friend.id"
                >
                  <UserAvatar :username="friend.username" :email="friend.email" :avatar-style="friend.avatarStyle" :badge-id="friend.avatarBadgeId || null" :size="40" />
                  <div class="flex-1 text-left min-w-0">
                    <div class="font-medium truncate" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">{{ friend.username }}</div>
                    <div v-if="friend.email" class="text-xs text-themed-muted truncate">{{ friend.email }}</div>
                  </div>
                  <div
                    class="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                    :class="[
                      selectedFriendId === friend.id
                        ? 'border-blue-500 bg-blue-500'
                        : themeStore.isDark
                          ? 'border-gray-600'
                          : 'border-gray-300'
                    ]"
                  >
                    <svg v-if="selectedFriendId === friend.id" class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                  </div>
                </button>
              </div>

              <!-- 配额设置 -->
              <Transition name="fade">
                <div v-if="selectedFriendId" class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'">
                  <div class="flex items-center gap-2 mb-4">
                    <svg class="w-4 h-4" :class="themeStore.isDark ? 'text-amber-400' : 'text-amber-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <h4 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">
                      {{ t('resources.packages.quotaSettings') }}
                    </h4>
                  </div>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.packages.quotaMultiplier') }}</label>
                      <select v-model="selectedQuotaMultiplier" class="input text-sm w-full">
                        <option v-for="opt in quotaMultiplierOptions" :key="String(opt.value)" :value="opt.value">
                          {{ opt.label }}
                        </option>
                      </select>
                      <p class="text-xs text-themed-muted mt-1.5 leading-relaxed">{{ t('resources.packages.quotaMultiplierHint') }}</p>
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.packages.maxInstances') }}</label>
                      <select v-model="selectedMaxInstances" class="input text-sm w-full">
                        <option v-for="opt in maxInstancesOptions" :key="String(opt.value)" :value="opt.value">
                          {{ opt.label }}
                        </option>
                      </select>
                      <p class="text-xs text-themed-muted mt-1.5 leading-relaxed">{{ t('resources.packages.maxInstancesHint') }}</p>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>

            <div class="modal-footer">
              <button class="btn-secondary" @click="showShareModal = false">{{ t('common.cancel') }}</button>
              <button
                :disabled="!selectedFriendId || shareLoading || availableFriends.length === 0"
                class="btn-primary"
                @click="sharePackage"
              >
                <span v-if="shareLoading" class="loading-spinner w-4 h-4"></span>
                <template v-else>
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {{ t('resources.packages.confirmShare') }}
                </template>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 共享列表弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showSharesModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showSharesModal = false"></div>
          <div class="modal-content max-w-xl">
            <div class="modal-header">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-purple-500/20' : 'bg-purple-100'">
                  <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-purple-400' : 'text-purple-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <h3 class="modal-title">{{ t('resources.packages.sharesList') }}</h3>
                    <span v-if="shares.length > 0" class="text-xs px-2 py-0.5 rounded-full" :class="themeStore.isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'">
                      {{ shares.length }}
                    </span>
                  </div>
                  <p v-if="currentPackage" class="text-xs text-themed-muted mt-0.5">
                    {{ currentPackage.name }} · {{ currentPackage.cpu_max }}% CPU · {{ formatMemory(currentPackage.memory_max) }}
                  </p>
                </div>
              </div>
              <button class="p-1.5 rounded-lg transition-colors" :class="themeStore.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'" @click="showSharesModal = false">
                <svg class="w-5 h-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="modal-body">
              <SkeletonLoader v-if="sharesLoading" type="list" />
              <div v-else-if="shares.length === 0" class="text-center py-12">
                <div class="w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                  <svg class="w-10 h-10" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p class="text-themed-secondary font-medium">{{ t('resources.packages.noShares') }}</p>
                <p class="text-xs text-themed-muted mt-1">{{ t('resources.packages.noSharesHint') }}</p>
              </div>
              <div v-else class="space-y-3 max-h-96 overflow-y-auto">
                <div
                  v-for="share in shares"
                  :key="share.id"
                  class="rounded-xl border p-4 transition-colors"
                  :class="themeStore.isDark ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50/50'"
                >
                  <!-- 用户信息和操作按钮 -->
                  <div class="flex items-center gap-3 mb-3">
                    <UserAvatar :username="share.sharedToUsername" :avatar-style="share.sharedToAvatarStyle || ''" :badge-id="share.sharedToAvatarBadgeId || null" :size="44" />
                    <div class="flex-1 min-w-0">
                      <div class="font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                        {{ share.sharedToUsername }}
                      </div>
                      <div class="text-xs text-themed-muted flex items-center gap-1">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {{ formatDate(share.createdAt) }}
                      </div>
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        class="p-2 rounded-lg transition-colors"
                        :class="themeStore.isDark ? 'hover:bg-gray-700 text-gray-400 hover:text-blue-400' : 'hover:bg-gray-200 text-gray-500 hover:text-blue-600'"
                        :title="t('resources.packages.editQuota')"
                        @click="openEditQuotaModal(share)"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        class="p-2 rounded-lg transition-colors"
                        :class="themeStore.isDark ? 'hover:bg-red-500/20 text-gray-400 hover:text-red-400' : 'hover:bg-red-50 text-gray-500 hover:text-red-500'"
                        :title="t('resources.packages.unshare')"
                        @click="unsharePackage(share.sharedToId)"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <!-- 配额信息 -->
                  <div class="grid grid-cols-2 gap-3 mb-3">
                    <div class="rounded-lg px-3 py-2" :class="themeStore.isDark ? 'bg-gray-900/50' : 'bg-white'">
                      <div class="text-xs text-themed-muted mb-0.5">{{ t('resources.packages.quotaMultiplier') }}</div>
                      <div class="font-medium text-sm" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                        {{ share.quotaMultiplier !== null ? share.quotaMultiplier + 'x' : t('resources.packages.noLimit') }}
                      </div>
                    </div>
                    <div class="rounded-lg px-3 py-2" :class="themeStore.isDark ? 'bg-gray-900/50' : 'bg-white'">
                      <div class="text-xs text-themed-muted mb-0.5">{{ t('resources.packages.maxInstances') }}</div>
                      <div class="font-medium text-sm" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                        {{ share.maxInstances !== null ? t('resources.packages.instanceUnit', { n: share.maxInstances }) : t('resources.packages.noLimit') }}
                      </div>
                    </div>
                  </div>

                  <!-- 使用量进度条 -->
                  <div v-if="share.usage" class="space-y-2">
                    <div class="text-xs font-medium text-themed-muted">{{ t('resources.packages.usageStatus') }}</div>
                    
                    <!-- 实例数 -->
                    <div v-if="share.maxInstances !== null" class="space-y-1">
                      <div class="flex justify-between text-xs">
                        <span class="text-themed-muted">{{ t('resources.packages.instanceCount') }}</span>
                        <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'">{{ share.usage.instanceCount }} / {{ share.maxInstances }}</span>
                      </div>
                      <div class="h-1.5 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200'">
                        <div
                          class="h-full rounded-full transition-all"
                          :class="getUsagePercent(share, 'instances') > 80 ? 'bg-amber-500' : themeStore.isDark ? 'bg-blue-500' : 'bg-blue-500'"
                          :style="{ width: getUsagePercent(share, 'instances') + '%' }"
                        ></div>
                      </div>
                    </div>

                    <!-- CPU -->
                    <div v-if="share.quotaMultiplier !== null && packageQuota" class="space-y-1">
                      <div class="flex justify-between text-xs">
                        <span class="text-themed-muted">CPU</span>
                        <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'">{{ share.usage.totalCpu }}% / {{ Math.floor(packageQuota.cpuMax * share.quotaMultiplier) }}%</span>
                      </div>
                      <div class="h-1.5 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200'">
                        <div
                          class="h-full rounded-full transition-all"
                          :class="getUsagePercent(share, 'cpu') > 80 ? 'bg-amber-500' : themeStore.isDark ? 'bg-green-500' : 'bg-green-500'"
                          :style="{ width: getUsagePercent(share, 'cpu') + '%' }"
                        ></div>
                      </div>
                    </div>

                    <!-- 内存 -->
                    <div v-if="share.quotaMultiplier !== null && packageQuota" class="space-y-1">
                      <div class="flex justify-between text-xs">
                        <span class="text-themed-muted">{{ t('admin.packages.memory') }}</span>
                        <span :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'">{{ formatMemory(share.usage.totalMemory) }} / {{ formatMemory(Math.floor(packageQuota.memoryMax * share.quotaMultiplier)) }}</span>
                      </div>
                      <div class="h-1.5 rounded-full overflow-hidden" :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200'">
                        <div
                          class="h-full rounded-full transition-all"
                          :class="getUsagePercent(share, 'memory') > 80 ? 'bg-amber-500' : themeStore.isDark ? 'bg-purple-500' : 'bg-purple-500'"
                          :style="{ width: getUsagePercent(share, 'memory') + '%' }"
                        ></div>
                      </div>
                    </div>

                    <!-- 无限制时显示简单统计 -->
                    <div v-if="share.quotaMultiplier === null && share.maxInstances === null" class="text-xs text-themed-muted">
                      {{ t('resources.packages.currentUsage', { cpu: share.usage.totalCpu, memory: share.usage.totalMemory, instances: share.usage.instanceCount }) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn-primary" @click="openShareModal(currentPackage!)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                {{ t('resources.packages.addShare') }}
              </button>
              <button class="btn-secondary" @click="showSharesModal = false">{{ t('common.close') }}</button>
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
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-amber-500/20' : 'bg-amber-100'">
                  <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-amber-400' : 'text-amber-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div>
                  <h3 class="modal-title">{{ t('resources.packages.editQuota') }}</h3>
                  <p v-if="editingShare" class="text-xs text-themed-muted mt-0.5">
                    {{ t('resources.packages.editQuotaFor', { username: editingShare.sharedToUsername }) }}
                  </p>
                </div>
              </div>
              <button class="p-1.5 rounded-lg transition-colors" :class="themeStore.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'" @click="showEditQuotaModal = false">
                <svg class="w-5 h-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="modal-body">
              <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.packages.quotaMultiplier') }}</label>
                    <select v-model="editQuotaMultiplier" class="input text-sm w-full">
                      <option v-for="opt in quotaMultiplierOptions" :key="String(opt.value)" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <p class="text-xs text-themed-muted mt-1.5 leading-relaxed">{{ t('resources.packages.quotaMultiplierHint') }}</p>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.packages.maxInstances') }}</label>
                    <select v-model="editMaxInstances" class="input text-sm w-full">
                      <option v-for="opt in maxInstancesOptions" :key="String(opt.value)" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <p class="text-xs text-themed-muted mt-1.5 leading-relaxed">{{ t('resources.packages.maxInstancesHint') }}</p>
                  </div>
                </div>
              </div>

              <!-- 当前使用量提示 -->
              <div v-if="editingShare?.usage" class="mt-4 rounded-lg p-3" :class="themeStore.isDark ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-blue-50 border border-blue-200'">
                <div class="flex items-start gap-2">
                  <svg class="w-4 h-4 mt-0.5 flex-shrink-0" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div class="text-xs" :class="themeStore.isDark ? 'text-blue-300' : 'text-blue-700'">
                    {{ t('resources.packages.currentUsageInfo', { cpu: editingShare.usage.totalCpu, memory: editingShare.usage.totalMemory, instances: editingShare.usage.instanceCount }) }}
                  </div>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn-secondary" @click="showEditQuotaModal = false">{{ t('common.cancel') }}</button>
              <button :disabled="editQuotaLoading" class="btn-primary" @click="saveEditQuota">
                <span v-if="editQuotaLoading" class="loading-spinner w-4 h-4"></span>
                <template v-else>
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  {{ t('common.save') }}
                </template>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 配额释放弹窗 -->
    <PackageQuotaReleaseModal
      :visible="showQuotaReleaseModal"
      :package-id="quotaReleasePackage?.id || 0"
      :package-name="quotaReleasePackage?.name || ''"
      @close="showQuotaReleaseModal = false"
      @success="handleQuotaReleaseSuccess"
    />


    <!-- 方案管理弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showPlansModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showPlansModal = false"></div>
          <div class="modal-content max-w-3xl">
            <div class="modal-header">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-indigo-500/20' : 'bg-indigo-100'">
                  <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-indigo-400' : 'text-indigo-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <h3 class="modal-title">{{ t('resources.plans.title') }}</h3>
                    <span v-if="plans.length > 0" class="text-xs px-2 py-0.5 rounded-full" :class="themeStore.isDark ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'">
                      {{ plans.length }}
                    </span>
                  </div>
                  <p v-if="plansPackage" class="text-xs text-themed-muted mt-0.5">
                    {{ plansPackage.name }} · {{ plansPackage.cpu_max }}% CPU · {{ formatMemory(plansPackage.memory_max) }}
                  </p>
                </div>
              </div>
              <button class="p-1.5 rounded-lg transition-colors" :class="themeStore.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'" @click="showPlansModal = false">
                <svg class="w-5 h-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="modal-body">
              <SkeletonLoader v-if="plansLoading" type="list" />
              <div v-else-if="plans.length === 0" class="text-center py-12">
                <div class="w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                  <svg class="w-10 h-10" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p class="text-themed-secondary font-medium">{{ t('resources.plans.noPlans') }}</p>
                <p class="text-xs text-themed-muted mt-1">{{ t('resources.plans.noPlansHint') }}</p>
              </div>
              <div v-else class="space-y-3 max-h-96 overflow-y-auto">
                <div
                  v-for="plan in plans"
                  :key="plan.id"
                  class="rounded-xl border p-4 transition-colors"
                  :class="[
                    themeStore.isDark ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50/50',
                    getPlanStatus(plan) !== 'active' ? 'opacity-70' : ''
                  ]"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">{{ plan.name }}</span>
                        <span class="badge text-xs" :class="getPlanStatusBadgeClass(plan)">{{ getPlanStatusLabel(plan) }}</span>
                      </div>
                      <p v-if="plan.description" class="text-xs text-themed-muted mb-2">{{ plan.description }}</p>
                      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span class="text-themed-muted">{{ t('admin.packages.cpu') }}:</span>
                          <span class="ml-1 font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ plan.cpu }}%</span>
                        </div>
                        <div>
                          <span class="text-themed-muted">{{ t('admin.packages.memory') }}:</span>
                          <span class="ml-1 font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ formatMemory(plan.memory) }}</span>
                        </div>
                        <div>
                          <span class="text-themed-muted">{{ t('admin.packages.disk') }}:</span>
                          <span class="ml-1 font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ formatDisk(plan.disk) }}</span>
                        </div>
                        <div>
                          <span class="text-themed-muted">{{ t('resources.plans.price') }}:</span>
                          <span class="ml-1 font-medium" :class="themeStore.isDark ? 'text-green-400' : 'text-green-600'">¥{{ formatPrice(plan.price) }}/{{ getBillingCycleLabel(plan.billingCycle) }}</span>
                        </div>
                      </div>
                      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mt-2">
                        <div>
                          <span class="text-themed-muted">{{ t('resources.plans.portLimit') }}:</span>
                          <span class="ml-1 font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ plan.portLimit }}</span>
                        </div>
                        <div>
                          <span class="text-themed-muted">{{ t('resources.plans.snapshotLimit') }}:</span>
                          <span class="ml-1 font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ plan.snapshotLimit }}</span>
                        </div>
                        <div v-if="plansPackage?.instance_type !== 'vm'">
                          <span class="text-themed-muted">{{ t('resources.plans.swapSize') }}:</span>
                          <span class="ml-1 font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ plan.swapSize > 0 ? `${plan.swapSize} MB` : '-' }}</span>
                        </div>
                        <div>
                          <span class="text-themed-muted">{{ t('resources.plans.siteLimit') }}:</span>
                          <span class="ml-1 font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ plan.siteLimit }}</span>
                        </div>
                      </div>
                      <div v-if="plan.slaGuarantee !== null" class="mt-2 text-xs">
                        <span class="text-themed-muted">SLA保证:</span>
                        <span class="ml-1 font-medium" :class="themeStore.isDark ? 'text-green-400' : 'text-green-600'">{{ plan.slaGuarantee }}%</span>
                      </div>
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                      <button
                        class="p-2 rounded-lg transition-colors"
                        :class="themeStore.isDark ? 'hover:bg-gray-700 text-gray-400 hover:text-blue-400' : 'hover:bg-gray-200 text-gray-500 hover:text-blue-600'"
                        :title="t('common.edit')"
                        @click="openEditPlanModal(plan)"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        class="p-2 rounded-lg transition-colors"
                        :class="themeStore.isDark ? 'hover:bg-red-500/20 text-gray-400 hover:text-red-400' : 'hover:bg-red-50 text-gray-500 hover:text-red-500'"
                        :title="t('common.delete')"
                        @click="deletePlan(plan)"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn-primary" @click="openCreatePlanModal">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                {{ t('resources.plans.add') }}
              </button>
              <button class="btn-secondary" @click="showPlansModal = false">{{ t('common.close') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 方案表单弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showPlanFormModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showPlanFormModal = false"></div>
          <div class="modal-content max-w-2xl">
            <div class="modal-header">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-indigo-500/20' : 'bg-indigo-100'">
                  <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-indigo-400' : 'text-indigo-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div>
                  <h3 class="modal-title">{{ editingPlan ? t('resources.plans.edit') : t('resources.plans.create') }}</h3>
                  <p v-if="plansPackage" class="text-xs text-themed-muted mt-0.5">{{ plansPackage.name }}</p>
                </div>
              </div>
              <button class="p-1.5 rounded-lg transition-colors" :class="themeStore.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'" @click="showPlanFormModal = false">
                <svg class="w-5 h-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="modal-body space-y-4 max-h-[70vh] overflow-y-auto">
              <!-- 基本信息 -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.name') }} *</label>
                  <input v-model="planForm.name" type="text" class="input" :placeholder="t('resources.plans.namePlaceholder')" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.description') }}</label>
                  <input v-model="planForm.description" type="text" class="input" :placeholder="t('resources.plans.descriptionPlaceholder')" />
                </div>
              </div>
              <p class="text-xs text-orange-500 dark:text-orange-400 -mt-2">{{ t('common.noIncudalHint') }}</p>

              <!-- 资源配置 -->
              <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'">
                <h4 class="text-sm font-medium mb-3" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">{{ t('resources.plans.resourceConfig') }}</h4>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">CPU (%)</label>
                    <input v-model.number="planForm.cpu" type="number" min="15" max="10000" class="input" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('admin.packages.memory') }} (MB)</label>
                    <input v-model.number="planForm.memory" type="number" min="128" max="62144" class="input" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('admin.packages.disk') }} (MB)</label>
                    <input v-model.number="planForm.disk" type="number" min="512" max="104857600" class="input" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.portLimit') }}</label>
                    <input v-model.number="planForm.portLimit" type="number" min="0" class="input" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.snapshotLimit') }}</label>
                    <input v-model.number="planForm.snapshotLimit" type="number" min="0" class="input" />
                  </div>
                  <div v-if="plansPackage?.instance_type !== 'vm'">
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.swapSize') }} (MB)</label>
                    <input v-model.number="planForm.swapSize" type="number" min="0" max="1048576" step="128" class="input" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.siteLimit') }}</label>
                    <input v-model.number="planForm.siteLimit" type="number" min="0" class="input" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.trafficLimit') }} (GB) *</label>
                    <input v-model="planForm.trafficLimit" type="number" min="1" max="100000" step="1" class="input" required />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.trafficSpeed') }} (Mbps) *</label>
                    <input v-model.number="planForm.trafficLimitSpeed" type="number" min="1" max="10000" step="1" class="input" required />
                  </div>
                </div>
              </div>

              <!-- 计费配置 -->
              <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'">
                <h4 class="text-sm font-medium mb-3" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">{{ t('resources.plans.billingConfig') }}</h4>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.price') }} (元)</label>
                    <input v-model.number="planForm.price" type="number" min="0" :max="MAX_PACKAGE_PLAN_PRICE" step="0.01" class="input" />
                    <p class="mt-1 text-xs text-themed-muted">{{ t('resources.plans.priceRangeHint', { max: MAX_PACKAGE_PLAN_PRICE.toFixed(2) }) }}</p>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.billingCycle') }}</label>
                    <select v-model.number="planForm.billingCycle" class="input">
                      <option v-for="opt in billingCycleOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-themed-muted mb-1.5">SLA保证 (%)</label>
                    <input v-model.number="planForm.slaGuarantee" type="number" min="1" max="100" step="0.01" class="input" placeholder="如 99.9" />
                  </div>
                </div>
              </div>

              <!-- 其他设置 -->
              <div class="grid gap-4 sm:grid-cols-3 sm:items-start">
                <div class="min-w-0 sm:col-span-2">
                  <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.status') }}</label>
                  <div
                    class="h-10 rounded-lg border p-0.5"
                    :class="themeStore.isDark ? 'border-gray-700 bg-gray-900/60' : 'border-gray-200 bg-gray-100/70'"
                  >
                    <div class="grid h-full grid-cols-3 gap-0.5">
                      <button
                        v-for="option in planStatusOptions"
                        :key="option.value"
                        type="button"
                        class="flex h-full min-w-0 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium transition-all"
                        :class="getPlanStatusSegmentClass(option.value)"
                        :aria-pressed="planForm.status === option.value"
                        @click="planForm.status = option.value"
                      >
                        <span class="h-2 w-2 flex-shrink-0 rounded-full" :class="getPlanStatusDotClass(option.value)"></span>
                        <span class="truncate">{{ option.label }}</span>
                      </button>
                    </div>
                  </div>
                  <p class="mt-2 min-h-[2.5rem] text-xs leading-5 text-themed-muted">
                    {{ selectedPlanStatusOption.description }}
                  </p>
                </div>
                <div class="min-w-0">
                  <label class="block text-xs font-medium text-themed-muted mb-1.5">{{ t('resources.plans.sortOrder') }}</label>
                  <input v-model.number="planForm.sortOrder" type="number" min="0" class="input h-10 w-full text-center" />
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn-secondary" @click="showPlanFormModal = false">{{ t('common.cancel') }}</button>
              <button :disabled="!planForm.name.trim() || planFormLoading" class="btn-primary" @click="savePlan">
                <span v-if="planFormLoading" class="loading-spinner w-4 h-4"></span>
                <template v-else>
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  {{ t('common.save') }}
                </template>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
