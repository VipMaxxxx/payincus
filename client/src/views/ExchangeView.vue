<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api'
import SensitiveVerificationModal from '@/components/SensitiveVerificationModal.vue'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { formatBytes, formatDisk, formatMemory } from '@/utils/formatters'
import type {
  ExchangeDispute,
  ExchangeEligibilityResult,
  ExchangeInstanceSnapshot,
  ExchangeListing,
  ExchangeMarketPackageCategory,
  ExchangeOrder,
  ExchangePublicConfig,
  ExchangeWallet,
  ExchangeWalletLog,
  ExchangeWithdrawal,
  InstanceWithDetails,
  SshKey,
  SystemImage
} from '@/types/api'

defineOptions({ name: 'ExchangeView' })

type ExchangeTab = 'market' | 'sell' | 'listings' | 'buys' | 'sales' | 'wallet' | 'records' | 'disputes'
type ExchangeSensitiveOperation = 'exchange_purchase' | 'exchange_withdrawal' | 'exchange_balance_transfer'
type DeliveryProgressState = 'done' | 'current' | 'pending' | 'failed'

interface PendingSensitiveAction {
  operationType: ExchangeSensitiveOperation
  resourceId?: number
  retry: () => Promise<void>
}

interface ListingEditDraft {
  listing: ExchangeListing
  price: number
  description: string
  autoDelistAt: string
}

interface DisputeDraft {
  order: ExchangeOrder
  reason: string
}

const route = useRoute()
const toast = useToast()
const themeStore = useThemeStore()

const activeTab = ref<ExchangeTab>('market')
const tabs: Array<{ key: ExchangeTab; label: string }> = [
  { key: 'market', label: '市场' },
  { key: 'sell', label: '我要出售' },
  { key: 'listings', label: '我的挂牌' },
  { key: 'buys', label: '我的买入' },
  { key: 'sales', label: '我的卖出' },
  { key: 'wallet', label: '交易所余额' },
  { key: 'records', label: '交易记录' },
  { key: 'disputes', label: '争议记录' }
]

const market = ref<ExchangeListing[]>([])
const marketLoading = ref(false)
const marketPage = ref(1)
const marketTotal = ref(0)
const marketPackages = ref<ExchangeMarketPackageCategory[]>([])
const selectedMarketPackageId = ref<number | null>(null)
const selectedListing = ref<ExchangeListing | null>(null)
const listingDetailLoading = ref(false)
const purchaseOptionsLoading = ref(false)
const purchaseSubmitting = ref(false)
const availableImages = ref<SystemImage[]>([])
const sshKeys = ref<SshKey[]>([])
const exchangeConfig = ref<ExchangePublicConfig>({
  enabled: false,
  minRemainingDays: 7,
  expiringSoonDays: 7,
  minPrice: 0,
  maxPrice: null,
  maxMarkupPercent: 150,
  feePercent: 0,
  minFee: 0,
  maxFee: null,
  confirmationHours: 24,
  autoConfirmEnabled: true,
  allowBuyerImageSelection: false,
  allowBalanceTransfer: true,
  allowPublicIpTransfer: true,
  withdrawalMinAmount: 0,
  dailyWithdrawalLimit: null,
  dailyWithdrawalCountLimit: 3,
  maxActiveListingsPerUser: 5,
  maxPurchasesPerUserPerDay: 5,
  disputeTimeoutHours: 72
})
const purchaseForm = ref({
  imageAlias: '',
  sshKeyId: 0
})

const instances = ref<InstanceWithDetails[]>([])
const instancesLoading = ref(false)
const eligibilityMap = ref<Record<number, ExchangeEligibilityResult>>({})
const eligibilityLoading = ref<Record<number, boolean>>({})
const stopConfirmInstance = ref<InstanceWithDetails | null>(null)
const stopSubmittingId = ref<number | null>(null)

const myListings = ref<ExchangeListing[]>([])
const myListingsLoading = ref(false)
const myListingsPage = ref(1)
const myListingsTotal = ref(0)
const buys = ref<ExchangeOrder[]>([])
const buysLoading = ref(false)
const buysPage = ref(1)
const buysTotal = ref(0)
const sales = ref<ExchangeOrder[]>([])
const salesLoading = ref(false)
const salesPage = ref(1)
const salesTotal = ref(0)
const orderRefreshingId = ref<number | null>(null)
const wallet = ref<ExchangeWallet | null>(null)
const walletLogs = ref<ExchangeWalletLog[]>([])
const walletLogsPage = ref(1)
const walletLogsTotal = ref(0)
const withdrawals = ref<ExchangeWithdrawal[]>([])
const withdrawalsPage = ref(1)
const withdrawalsTotal = ref(0)
const walletLoading = ref(false)
const disputes = ref<ExchangeDispute[]>([])
const disputesLoading = ref(false)
const disputesPage = ref(1)
const disputesTotal = ref(0)

const listingForm = ref({
  instanceId: 0,
  price: 0,
  description: '',
  autoDelistAt: ''
})
const listingSubmitting = ref(false)
const showListingConfirm = ref(false)
const pendingPurchaseListing = ref<ExchangeListing | null>(null)
const pendingDelistListing = ref<ExchangeListing | null>(null)
const listingEditDraft = ref<ListingEditDraft | null>(null)
const listingActionSubmitting = ref(false)
const disputeDraft = ref<DisputeDraft | null>(null)
const disputeSubmitting = ref(false)
const withdrawalForm = ref({ amount: 0, method: '', account: '', remark: '' })
const transferAmount = ref(0)
const showTransferConfirm = ref(false)
const showWithdrawalConfirm = ref(false)
const walletActionLoading = ref('')
const verificationModalOpen = ref(false)
const pendingSensitiveAction = ref<PendingSensitiveAction | null>(null)

const pageSize = 12
const recordPageSize = 10
const marketTotalPages = computed(() => Math.max(1, Math.ceil(marketTotal.value / pageSize)))
const myListingsTotalPages = computed(() => Math.max(1, Math.ceil(myListingsTotal.value / recordPageSize)))
const buysTotalPages = computed(() => Math.max(1, Math.ceil(buysTotal.value / recordPageSize)))
const salesTotalPages = computed(() => Math.max(1, Math.ceil(salesTotal.value / recordPageSize)))
const walletLogsTotalPages = computed(() => Math.max(1, Math.ceil(walletLogsTotal.value / recordPageSize)))
const withdrawalsTotalPages = computed(() => Math.max(1, Math.ceil(withdrawalsTotal.value / recordPageSize)))
const disputesTotalPages = computed(() => Math.max(1, Math.ceil(disputesTotal.value / recordPageSize)))
const walletAvailableAmount = computed(() => Number(wallet.value?.availableAmount || 0))
const canTransferExchangeBalance = computed(() =>
  exchangeConfig.value.allowBalanceTransfer &&
  Number(transferAmount.value) > 0 &&
  Number(transferAmount.value) <= walletAvailableAmount.value
)
const canSubmitWithdrawal = computed(() =>
  Number(withdrawalForm.value.amount) >= exchangeConfig.value.withdrawalMinAmount &&
  Number(withdrawalForm.value.amount) > 0 &&
  Number(withdrawalForm.value.amount) <= walletAvailableAmount.value &&
  !!withdrawalForm.value.method.trim() &&
  !!withdrawalForm.value.account.trim()
)
const deliverySteps = [
  'escrow_paid',
  'lock_instance',
  'freeze_seller_access',
  'cleanup_ssh_keys',
  'cleanup_terminal_sessions',
  'cleanup_console_tokens',
  'cleanup_network_bindings',
  'cleanup_snapshots_and_backups',
  'reinstall',
  'transfer_owner',
  'rebuild_billing',
  'reset_traffic_baseline',
  'complete'
] as const
const deliveryStepLabels: Record<string, string> = {
  escrow_paid: '已支付并托管资金',
  lock_instance: '实例锁定',
  cleanup_access: '清理原访问权限',
  freeze_seller_access: '冻结卖家访问',
  cleanup_ssh_keys: '清理 SSH key',
  cleanup_terminal_sessions: '清理终端会话',
  cleanup_console_tokens: '清理控制台 token',
  cleanup_network_bindings: '清理端口和代理绑定',
  cleanup_snapshots_and_backups: '清理快照和备份策略',
  reinstall: '重装系统',
  reinstall_queued: '重装系统',
  transfer_owner: '转移实例归属',
  rebuild_billing: '重建账单和续费归属',
  reset_traffic_baseline: '重置流量基线',
  complete: '交割完成',
  manual_review: '人工审核'
}

const activeInstanceId = computed(() => Number(route.query.instanceId || 0))

function tabClass(tab: ExchangeTab): string {
  const active = activeTab.value === tab
  if (active) return 'bg-accent text-white border-accent'
  return themeStore.isDark
    ? 'border-gray-800 text-gray-300 hover:bg-gray-900'
    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
}

function pageSummary(total: number, page: number, size: number): string {
  if (total <= 0) return '共 0 条'
  const start = (page - 1) * size + 1
  const end = Math.min(total, page * size)
  return `第 ${start}-${end} 条 / 共 ${total} 条`
}

function cardClass(extra = ''): string {
  return ['card', extra].filter(Boolean).join(' ')
}

function money(value: number | null | undefined): string {
  return `¥${Number(value || 0).toFixed(2)}`
}

function formatDate(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function formatDateOnly(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString()
}

function bytesLabel(value?: string | null): string {
  if (!value) return '不限'
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return '不限'
  return formatBytes(numberValue)
}

function remainingDays(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const days = Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return days > 0 ? `${days} 天` : '已到期'
}

function bandwidthLabel(snapshot: ExchangeInstanceSnapshot): string {
  const ingress = snapshot.limitsIngress || ''
  const egress = snapshot.limitsEgress || ''
  if (ingress && egress && ingress !== egress) return `${ingress} / ${egress}`
  return ingress || egress || '带宽未设置'
}

function snapshotOf(item: ExchangeListing | ExchangeOrder): ExchangeInstanceSnapshot {
  return (item.instance || item.snapshot) as ExchangeInstanceSnapshot
}

function hostRegionLabel(snapshot: ExchangeInstanceSnapshot): string {
  return snapshot.host?.location || snapshot.host?.countryCode || '-'
}

function hostNodeLabel(snapshot: ExchangeInstanceSnapshot): string {
  return snapshot.host?.name || '-'
}

function packageLabel(snapshot: ExchangeInstanceSnapshot): string {
  return `${snapshot.package?.name || '-'} / ${snapshot.packagePlan?.name || '-'}`
}

function renewalPriceLabel(snapshot: ExchangeInstanceSnapshot): string {
  if (snapshot.billingPrice === null || snapshot.billingPrice === undefined) return '未设置'
  const cycle = snapshot.billingCycle && snapshot.billingCycle > 1 ? `/${snapshot.billingCycle}个月` : '/月'
  return `${money(snapshot.billingPrice)}${cycle}`
}

function marketPackageFilterClass(packageId: number | null): string {
  const active = selectedMarketPackageId.value === packageId
  if (active) return 'border-accent bg-accent text-white'
  return themeStore.isDark
    ? 'border-gray-800 text-gray-300 hover:bg-gray-900'
    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
}

function networkLabel(snapshot: ExchangeInstanceSnapshot): string {
  const mode = snapshot.networkMode || 'unknown'
  const labels: Record<string, string> = {
    nat: 'IPv4 NAT',
    nat_ipv6: 'IPv4 NAT + IPv6',
    nat_ipv6_nat: 'IPv4 NAT + IPv6 NAT',
    ipv6_only: 'IPv6 Only',
    ipv6_nat: 'IPv6 NAT',
    public_ipv4: '独立 IPv4',
    public_ipv4_ipv6: '独立 IPv4 + IPv6'
  }
  return labels[mode] || mode
}

function ipSummary(snapshot: ExchangeInstanceSnapshot): string {
  const parts: string[] = []
  if (snapshot.ipv4) parts.push(`IPv4 ${snapshot.ipv4}`)
  if (snapshot.ipv6) parts.push(`IPv6 ${snapshot.ipv6}`)
  return parts.length ? parts.join(' · ') : '无独立 IP'
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: '挂牌中',
    paused: '暂停挂牌中',
    locked: '交易锁定中',
    sold: '已售出',
    delisted: '已下架',
    force_delisted: '强制下架',
    delivery_failed: '交割失败',
    escrowed: '已托管',
    delivering: '交割中',
    delivered: '已交割',
    confirming: '确认期',
    completed: '已完成',
    cancelled: '已取消',
    refunded: '已退款',
    disputed: '争议中',
    manual_review: '人工审核',
    failed: '失败',
    escrow_hold: '托管入账',
    fee_charge: '手续费扣除',
    escrow_release: '托管放款',
    withdrawal_freeze: '提现冻结',
    withdrawal_complete: '提现完成',
    withdrawal_reject: '提现退回',
    balance_transfer: '划转到账户余额',
    dispute_freeze: '争议冻结',
    dispute_release: '争议释放',
    admin_adjust: '人工调整',
    pending: '待审核',
    approved: '已通过',
    paying: '打款中',
    rejected: '已拒绝',
    open: '处理中',
    processing: '处理中',
    redelivering: '重新交割',
    released: '已放款',
    closed: '已关闭',
    PENDING: '待处理',
    PROCESSING: '处理中',
    COMPLETED: '已完成',
    FAILED: '失败',
    CANCELLED: '已取消'
  }
  return labels[status] || status
}

function instanceStatusLabel(status?: string | null): string {
  const labels: Record<string, string> = {
    creating: '创建中',
    running: '运行中',
    stopped: '已暂停',
    suspended: '已封停',
    error: '异常',
    deleted: '已删除'
  }
  return labels[String(status || '').toLowerCase()] || status || '-'
}

function getDeliveryProgressValue(order: ExchangeOrder): { steps: string[]; current: string } {
  const progress = order.deliveryTask?.progress
  if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
    const record = progress as Record<string, unknown>
    const steps = Array.isArray(record.steps)
      ? record.steps.filter((step): step is string => typeof step === 'string')
      : []
    const current = typeof record.current === 'string' ? record.current : ''
    return {
      steps: steps.length > 0 ? steps : [...deliverySteps],
      current: current || order.deliveryTask?.step || order.status
    }
  }
  return {
    steps: [...deliverySteps],
    current: order.deliveryTask?.step || order.status
  }
}

function normalizeDeliveryCurrentStep(step: string): string {
  if (step === 'cleanup_access') return 'cleanup_ssh_keys'
  if (step === 'reinstall_queued') return 'reinstall'
  if (step === 'delivering' || step === 'escrowed') return 'lock_instance'
  if (step === 'delivered' || step === 'confirming' || step === 'completed') return 'complete'
  return step
}

function deliveryStepState(order: ExchangeOrder, step: string): DeliveryProgressState {
  if (order.deliveryTask?.status === 'FAILED' || order.status === 'manual_review' || order.status === 'failed') {
    const current = normalizeDeliveryCurrentStep(getDeliveryProgressValue(order).current)
    return normalizeDeliveryCurrentStep(step) === current ? 'failed' : 'pending'
  }
  if (['confirming', 'completed'].includes(order.status) || order.deliveryTask?.status === 'COMPLETED') {
    return 'done'
  }
  const progress = getDeliveryProgressValue(order)
  const current = normalizeDeliveryCurrentStep(progress.current)
  const normalizedStep = normalizeDeliveryCurrentStep(step)
  const steps = progress.steps.map(normalizeDeliveryCurrentStep)
  const currentIndex = steps.indexOf(current)
  const stepIndex = steps.indexOf(normalizedStep)
  if (currentIndex < 0 || stepIndex < 0) return 'pending'
  if (stepIndex < currentIndex) return 'done'
  if (stepIndex === currentIndex) return 'current'
  return 'pending'
}

function deliveryStepClass(order: ExchangeOrder, step: string): string {
  const state = deliveryStepState(order, step)
  const classes: Record<DeliveryProgressState, string> = {
    done: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
    current: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200',
    pending: 'border-themed bg-themed-secondary text-themed-muted',
    failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200'
  }
  return classes[state]
}

function deliveryStepMarker(order: ExchangeOrder, step: string): string {
  const state = deliveryStepState(order, step)
  if (state === 'done') return '✓'
  if (state === 'current') return '…'
  if (state === 'failed') return '!'
  return '○'
}

function deliveryProgressSteps(order: ExchangeOrder): string[] {
  return getDeliveryProgressValue(order).steps
}

function eligibilityBadge(result?: ExchangeEligibilityResult): { label: string; tone: string } {
  if (!result) return { label: '未检测', tone: 'bg-gray-100 text-gray-600' }
  if (result.status === 'can_list') return { label: '可上架', tone: 'bg-emerald-100 text-emerald-700' }
  if (result.status === 'must_stop_first') return { label: '需先暂停', tone: 'bg-amber-100 text-amber-700' }
  return { label: '不可上架', tone: 'bg-red-100 text-red-700' }
}

function instanceNeedsStopBeforeListing(instance: InstanceWithDetails): boolean {
  const eligibility = eligibilityMap.value[instance.id]
  return eligibility?.status === 'must_stop_first' || (!eligibility && instance.status?.toLowerCase() === 'running')
}

function canSelectListingInstance(instance: InstanceWithDetails): boolean {
  return eligibilityMap.value[instance.id]?.status === 'can_list'
}

function createIdempotencyKey(scope: string): string {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `exchange:${scope}:${randomPart}`
}

function needsExchangeVerification(err: any): boolean {
  return err?.code === 'EXCHANGE_OPERATION_VERIFICATION_REQUIRED'
}

function policyFeeSummary(): string {
  const maxFee = exchangeConfig.value.maxFee === null ? '不封顶' : `最高 ${money(exchangeConfig.value.maxFee)}`
  return `${exchangeConfig.value.feePercent}% 手续费，最低 ${money(exchangeConfig.value.minFee)}，${maxFee}`
}

function policyWithdrawalSummary(): string {
  const dailyLimit = exchangeConfig.value.dailyWithdrawalLimit === null
    ? '每日金额不限'
    : `每日金额上限 ${money(exchangeConfig.value.dailyWithdrawalLimit)}`
  return `最低 ${money(exchangeConfig.value.withdrawalMinAmount)}，每日最多 ${exchangeConfig.value.dailyWithdrawalCountLimit} 次，${dailyLimit}`
}

function openSensitiveVerification(action: PendingSensitiveAction): void {
  pendingSensitiveAction.value = action
  verificationModalOpen.value = true
}

function closeSensitiveVerification(): void {
  verificationModalOpen.value = false
  pendingSensitiveAction.value = null
}

async function handleSensitiveVerified(): Promise<void> {
  const action = pendingSensitiveAction.value
  if (!action) {
    closeSensitiveVerification()
    return
  }
  verificationModalOpen.value = false
  pendingSensitiveAction.value = null
  await action.retry()
}

async function loadMarket(): Promise<void> {
  marketLoading.value = true
  try {
    const res = await api.exchange.listMarket({
      page: marketPage.value,
      pageSize,
      packageId: selectedMarketPackageId.value
    })
    market.value = res.items || []
    marketTotal.value = res.total || 0
    marketPackages.value = res.packages || []
    marketPage.value = res.page || marketPage.value
  } catch (err: any) {
    toast.error(err?.message || '加载交易所市场失败')
  } finally {
    marketLoading.value = false
  }
}

async function selectMarketPackage(packageId: number | null): Promise<void> {
  if (selectedMarketPackageId.value === packageId) return
  selectedMarketPackageId.value = packageId
  marketPage.value = 1
  await loadMarket()
}

async function loadExchangeConfig(): Promise<void> {
  try {
    exchangeConfig.value = await api.exchange.getConfig()
  } catch (err: any) {
    toast.error(err?.message || '加载交易所配置失败')
  }
}

async function changeMarketPage(delta: number): Promise<void> {
  const next = Math.min(marketTotalPages.value, Math.max(1, marketPage.value + delta))
  if (next === marketPage.value) return
  marketPage.value = next
  await loadMarket()
}

async function loadInstances(): Promise<void> {
  instancesLoading.value = true
  try {
    const res = await api.instances.list({ page: 1, pageSize: 50 })
    instances.value = (res as any).items || (res as any).instances || []
    if (activeInstanceId.value) {
      const target = instances.value.find(item => item.id === activeInstanceId.value)
      if (target) await checkEligibility(target)
    }
  } catch (err: any) {
    toast.error(err?.message || '加载实例失败')
  } finally {
    instancesLoading.value = false
  }
}

async function checkEligibility(instance: InstanceWithDetails): Promise<void> {
  eligibilityLoading.value = { ...eligibilityLoading.value, [instance.id]: true }
  try {
    const res = await api.exchange.checkEligibility(instance.id)
    eligibilityMap.value = { ...eligibilityMap.value, [instance.id]: res }
    if (res.status === 'can_list') {
      listingForm.value.instanceId = instance.id
    }
  } catch (err: any) {
    toast.error(err?.message || '检测实例失败')
  } finally {
    eligibilityLoading.value = { ...eligibilityLoading.value, [instance.id]: false }
  }
}

function requestStopBeforeListing(instance: InstanceWithDetails): void {
  stopConfirmInstance.value = instance
}

function cancelStopBeforeListing(): void {
  if (stopSubmittingId.value) return
  stopConfirmInstance.value = null
}

async function confirmStopBeforeListing(): Promise<void> {
  const instance = stopConfirmInstance.value
  if (!instance) return
  stopSubmittingId.value = instance.id
  try {
    await api.exchange.stopForListing(instance.id)
    toast.success('暂停任务已提交，完成后请重新检测并挂牌')
    stopConfirmInstance.value = null
    await loadInstances()
  } catch (err: any) {
    toast.error(err?.message || '暂停实例失败')
  } finally {
    stopSubmittingId.value = null
  }
}

function requestCreateListing(): void {
  if (!listingForm.value.instanceId) {
    toast.warning('请先选择并检测一个可上架实例')
    return
  }
  const eligibility = eligibilityMap.value[listingForm.value.instanceId]
  if (!eligibility?.eligible) {
    toast.warning('实例未通过交易所检测，不能挂牌')
    return
  }
  showListingConfirm.value = true
}

function cancelCreateListing(): void {
  if (listingSubmitting.value) return
  showListingConfirm.value = false
}

async function createListing(): Promise<void> {
  if (!listingForm.value.instanceId) {
    toast.warning('请先选择并检测一个可上架实例')
    return
  }
  const eligibility = eligibilityMap.value[listingForm.value.instanceId]
  if (!eligibility?.eligible) {
    toast.warning('实例未通过交易所检测，不能挂牌')
    return
  }
  listingSubmitting.value = true
  try {
    await api.exchange.createListing({
      instanceId: listingForm.value.instanceId,
      price: Number(listingForm.value.price),
      description: listingForm.value.description || null,
      autoDelistAt: listingForm.value.autoDelistAt || null,
      idempotencyKey: createIdempotencyKey('listing')
    })
    toast.success('已上架交易所')
    showListingConfirm.value = false
    listingForm.value = { instanceId: 0, price: 0, description: '', autoDelistAt: '' }
    await Promise.all([loadMyListings(), loadMarket(), loadInstances()])
    activeTab.value = 'listings'
  } catch (err: any) {
    toast.error(err?.message || '上架失败')
  } finally {
    listingSubmitting.value = false
  }
}

function requestPurchaseListing(listing: ExchangeListing): void {
  pendingPurchaseListing.value = listing
}

function cancelPurchaseListing(): void {
  if (purchaseSubmitting.value) return
  pendingPurchaseListing.value = null
}

async function purchaseListing(listing: ExchangeListing): Promise<void> {
  pendingPurchaseListing.value = null
  await performPurchase(listing, createIdempotencyKey('purchase'))
}

function purchaseConfirmImageText(): string {
  if (!exchangeConfig.value.allowBuyerImageSelection) {
    return '当前交易所策略未开放买家自选镜像，平台会按默认/原实例镜像强制重装。'
  }
  const imageText = purchaseForm.value.imageAlias
    ? `所选重装镜像：${purchaseForm.value.imageAlias}。`
    : '未选择重装镜像时，平台会使用原实例镜像重新安装。'
  return imageText
}

function purchaseConfirmSshText(): string {
  const sshText = purchaseForm.value.sshKeyId
    ? '所选 SSH Key 会写入重装后的实例。'
    : '未选择 SSH Key 可能影响重装后首次登录，请确认你接受。'
  return sshText
}

async function performPurchase(listing: ExchangeListing, idempotencyKey: string): Promise<void> {
  purchaseSubmitting.value = true
  try {
    await api.exchange.purchase(listing.id, {
      idempotencyKey,
      imageAlias: exchangeConfig.value.allowBuyerImageSelection ? purchaseForm.value.imageAlias || null : null,
      sshKeyId: purchaseForm.value.sshKeyId > 0 ? purchaseForm.value.sshKeyId : null
    })
    toast.success('购买成功，资金已托管，交割任务已创建')
    selectedListing.value = null
    resetPurchaseForm()
    buysPage.value = 1
    walletLogsPage.value = 1
    await Promise.all([loadMarket(), loadBuys(), loadWallet()])
    activeTab.value = 'buys'
  } catch (err: any) {
    if (needsExchangeVerification(err)) {
      toast.info('购买前需要先完成二次验证')
      openSensitiveVerification({
        operationType: 'exchange_purchase',
        resourceId: listing.id,
        retry: () => performPurchase(listing, idempotencyKey)
      })
      return
    }
    toast.error(err?.message || '购买失败')
  } finally {
    purchaseSubmitting.value = false
  }
}

async function openListingDetail(listing: ExchangeListing): Promise<void> {
  selectedListing.value = listing
  listingDetailLoading.value = true
  resetPurchaseForm()
  void loadPurchaseOptions(listing)
  try {
    selectedListing.value = await api.exchange.getListing(listing.id)
    void loadPurchaseOptions(selectedListing.value)
  } catch (err: any) {
    toast.error(err?.message || '加载商品详情失败')
  } finally {
    listingDetailLoading.value = false
  }
}

function closeListingDetail(): void {
  selectedListing.value = null
  resetPurchaseForm()
}

function resetPurchaseForm(): void {
  purchaseForm.value = { imageAlias: '', sshKeyId: 0 }
  availableImages.value = []
  sshKeys.value = []
}

async function loadPurchaseOptions(listing: ExchangeListing): Promise<void> {
  const snapshot = snapshotOf(listing)
  purchaseOptionsLoading.value = true
  try {
    const [imagesRes, keysRes] = await Promise.all([
      exchangeConfig.value.allowBuyerImageSelection
        ? api.images.getSystemImages(undefined, snapshot.memory, snapshot.host.id)
        : Promise.resolve({ images: [] as SystemImage[] }),
      api.sshKeys.list()
    ])
    availableImages.value = exchangeConfig.value.allowBuyerImageSelection ? imagesRes.images || [] : []
    if (!exchangeConfig.value.allowBuyerImageSelection) {
      purchaseForm.value.imageAlias = ''
    }
    sshKeys.value = keysRes.keys || []
    purchaseForm.value.sshKeyId = sshKeys.value[0]?.id || 0
  } catch (err: any) {
    toast.error(err?.message || '加载交割设置失败')
  } finally {
    purchaseOptionsLoading.value = false
  }
}

async function loadMyListings(): Promise<void> {
  myListingsLoading.value = true
  try {
    const res = await api.exchange.myListings({ page: myListingsPage.value, pageSize: recordPageSize })
    myListings.value = res.items || []
    myListingsTotal.value = res.total || 0
    myListingsPage.value = res.page || myListingsPage.value
  } catch (err: any) {
    toast.error(err?.message || '加载我的挂牌失败')
  } finally {
    myListingsLoading.value = false
  }
}

async function changeMyListingsPage(delta: number): Promise<void> {
  const next = Math.min(myListingsTotalPages.value, Math.max(1, myListingsPage.value + delta))
  if (next === myListingsPage.value) return
  myListingsPage.value = next
  await loadMyListings()
}

function requestDelist(listing: ExchangeListing): void {
  pendingDelistListing.value = listing
}

function cancelDelist(): void {
  if (listingActionSubmitting.value) return
  pendingDelistListing.value = null
}

async function confirmDelist(): Promise<void> {
  const listing = pendingDelistListing.value
  if (!listing) return
  listingActionSubmitting.value = true
  try {
    await api.exchange.delistListing(listing.id)
    toast.success('已下架')
    pendingDelistListing.value = null
    marketPage.value = 1
    await Promise.all([loadMyListings(), loadMarket(), loadInstances()])
  } catch (err: any) {
    toast.error(err?.message || '下架失败')
  } finally {
    listingActionSubmitting.value = false
  }
}

function requestEditListing(listing: ExchangeListing): void {
  listingEditDraft.value = {
    listing,
    price: Number(listing.price),
    description: listing.description || '',
    autoDelistAt: listing.autoDelistAt ? listing.autoDelistAt.slice(0, 16) : ''
  }
}

function cancelEditListing(): void {
  if (listingActionSubmitting.value) return
  listingEditDraft.value = null
}

async function submitEditListing(): Promise<void> {
  const draft = listingEditDraft.value
  if (!draft) return
  const price = Number(draft.price)
  if (!Number.isFinite(price) || price <= 0) {
    toast.warning('出售价格无效')
    return
  }
  listingActionSubmitting.value = true
  try {
    await api.exchange.updateListing(draft.listing.id, {
      price,
      description: draft.description || null,
      autoDelistAt: draft.autoDelistAt || null
    })
    toast.success('挂牌信息已更新')
    listingEditDraft.value = null
    await Promise.all([loadMyListings(), loadMarket()])
  } catch (err: any) {
    toast.error(err?.message || '修改挂牌失败')
  } finally {
    listingActionSubmitting.value = false
  }
}


async function loadBuys(): Promise<void> {
  buysLoading.value = true
  try {
    const res = await api.exchange.myBuys({ page: buysPage.value, pageSize: recordPageSize })
    buys.value = res.items || []
    buysTotal.value = res.total || 0
    buysPage.value = res.page || buysPage.value
  } catch (err: any) {
    toast.error(err?.message || '加载买入订单失败')
  } finally {
    buysLoading.value = false
  }
}

async function changeBuysPage(delta: number): Promise<void> {
  const next = Math.min(buysTotalPages.value, Math.max(1, buysPage.value + delta))
  if (next === buysPage.value) return
  buysPage.value = next
  await loadBuys()
}

async function loadSales(): Promise<void> {
  salesLoading.value = true
  try {
    const res = await api.exchange.mySales({ page: salesPage.value, pageSize: recordPageSize })
    sales.value = res.items || []
    salesTotal.value = res.total || 0
    salesPage.value = res.page || salesPage.value
  } catch (err: any) {
    toast.error(err?.message || '加载卖出订单失败')
  } finally {
    salesLoading.value = false
  }
}

async function changeSalesPage(delta: number): Promise<void> {
  const next = Math.min(salesTotalPages.value, Math.max(1, salesPage.value + delta))
  if (next === salesPage.value) return
  salesPage.value = next
  await loadSales()
}

async function refreshOrderDetail(order: ExchangeOrder): Promise<void> {
  orderRefreshingId.value = order.id
  try {
    const res = await api.exchange.orderDetail(order.id)
    const nextOrder = res.order
    const replaceOrder = (items: ExchangeOrder[]) => items.map(item => item.id === nextOrder.id ? nextOrder : item)
    buys.value = replaceOrder(buys.value)
    sales.value = replaceOrder(sales.value)
    toast.success('交割进度已刷新')
  } catch (err: any) {
    toast.error(err?.message || '刷新交割进度失败')
  } finally {
    orderRefreshingId.value = null
  }
}

async function loadWallet(): Promise<void> {
  walletLoading.value = true
  try {
    const [walletRes, logsRes, withdrawalsRes] = await Promise.all([
      api.exchange.wallet(),
      api.exchange.walletLogs({ page: walletLogsPage.value, pageSize: recordPageSize }),
      api.exchange.withdrawals({ page: withdrawalsPage.value, pageSize: recordPageSize })
    ])
    wallet.value = walletRes
    walletLogs.value = logsRes.items || []
    walletLogsTotal.value = logsRes.total || 0
    walletLogsPage.value = logsRes.page || walletLogsPage.value
    withdrawals.value = withdrawalsRes.items || []
    withdrawalsTotal.value = withdrawalsRes.total || 0
    withdrawalsPage.value = withdrawalsRes.page || withdrawalsPage.value
  } catch (err: any) {
    toast.error(err?.message || '加载交易所余额失败')
  } finally {
    walletLoading.value = false
  }
}

async function changeWalletLogsPage(delta: number): Promise<void> {
  const next = Math.min(walletLogsTotalPages.value, Math.max(1, walletLogsPage.value + delta))
  if (next === walletLogsPage.value) return
  walletLogsPage.value = next
  await loadWallet()
}

async function changeWithdrawalsPage(delta: number): Promise<void> {
  const next = Math.min(withdrawalsTotalPages.value, Math.max(1, withdrawalsPage.value + delta))
  if (next === withdrawalsPage.value) return
  withdrawalsPage.value = next
  await loadWallet()
}

async function transferToBalance(): Promise<void> {
  if (!exchangeConfig.value.allowBalanceTransfer) {
    toast.warning('当前交易所策略不允许划转到账户余额')
    return
  }
  if (!Number.isFinite(Number(transferAmount.value)) || Number(transferAmount.value) <= 0) {
    toast.warning('请输入有效划转金额')
    return
  }
  if (Number(transferAmount.value) > walletAvailableAmount.value) {
    toast.warning('交易所可用余额不足')
    return
  }
  showTransferConfirm.value = true
}

function cancelTransferToBalance(): void {
  if (walletActionLoading.value === 'transfer') return
  showTransferConfirm.value = false
}

async function confirmTransferToBalance(): Promise<void> {
  showTransferConfirm.value = false
  await performTransferToBalance(Number(transferAmount.value), createIdempotencyKey('transfer'))
}

async function performTransferToBalance(amount: number, idempotencyKey: string): Promise<void> {
  walletActionLoading.value = 'transfer'
  try {
    await api.exchange.transferToBalance(amount, idempotencyKey)
    toast.success('已划转到账户余额')
    transferAmount.value = 0
    walletLogsPage.value = 1
    await loadWallet()
  } catch (err: any) {
    if (needsExchangeVerification(err)) {
      toast.info('划转前需要先完成二次验证')
      openSensitiveVerification({
        operationType: 'exchange_balance_transfer',
        retry: () => performTransferToBalance(amount, idempotencyKey)
      })
      return
    }
    toast.error(err?.message || '划转失败')
  } finally {
    walletActionLoading.value = ''
  }
}

async function createWithdrawal(): Promise<void> {
  if (!Number.isFinite(Number(withdrawalForm.value.amount)) || Number(withdrawalForm.value.amount) <= 0) {
    toast.warning('请输入有效提现金额')
    return
  }
  if (Number(withdrawalForm.value.amount) < exchangeConfig.value.withdrawalMinAmount) {
    toast.warning(`提现金额不能低于 ${money(exchangeConfig.value.withdrawalMinAmount)}`)
    return
  }
  if (Number(withdrawalForm.value.amount) > walletAvailableAmount.value) {
    toast.warning('交易所可用余额不足')
    return
  }
  if (!withdrawalForm.value.method.trim() || !withdrawalForm.value.account.trim()) {
    toast.warning('请填写提现方式和收款账号')
    return
  }
  showWithdrawalConfirm.value = true
}

function cancelCreateWithdrawal(): void {
  if (walletActionLoading.value === 'withdraw') return
  showWithdrawalConfirm.value = false
}

async function confirmCreateWithdrawal(): Promise<void> {
  showWithdrawalConfirm.value = false
  await performCreateWithdrawal({
    amount: Number(withdrawalForm.value.amount),
    method: withdrawalForm.value.method || null,
    accountSnapshot: { account: withdrawalForm.value.account },
    applicantRemark: withdrawalForm.value.remark || null,
    idempotencyKey: createIdempotencyKey('withdrawal')
  })
}

async function performCreateWithdrawal(data: {
  amount: number
  method: string | null
  accountSnapshot: Record<string, unknown>
  applicantRemark: string | null
  idempotencyKey: string
}): Promise<void> {
  walletActionLoading.value = 'withdraw'
  try {
    await api.exchange.createWithdrawal(data)
    toast.success('提现申请已提交，等待人工审核')
    withdrawalForm.value = { amount: 0, method: '', account: '', remark: '' }
    walletLogsPage.value = 1
    withdrawalsPage.value = 1
    await loadWallet()
  } catch (err: any) {
    if (needsExchangeVerification(err)) {
      toast.info('提现前需要先完成二次验证')
      openSensitiveVerification({
        operationType: 'exchange_withdrawal',
        retry: () => performCreateWithdrawal(data)
      })
      return
    }
    toast.error(err?.message || '提交提现失败')
  } finally {
    walletActionLoading.value = ''
  }
}

function requestCreateDispute(order: ExchangeOrder): void {
  disputeDraft.value = { order, reason: '' }
}

function cancelCreateDispute(): void {
  if (disputeSubmitting.value) return
  disputeDraft.value = null
}

async function submitCreateDispute(): Promise<void> {
  const draft = disputeDraft.value
  if (!draft) return
  const reason = draft.reason.trim()
  if (!reason) {
    toast.warning('请输入争议原因')
    return
  }
  disputeSubmitting.value = true
  try {
    await api.exchange.createDispute(draft.order.id, {
      reason,
      idempotencyKey: createIdempotencyKey('dispute')
    })
    toast.success('争议已提交，等待平台处理')
    disputeDraft.value = null
    disputesPage.value = 1
    await Promise.all([loadBuys(), loadSales(), loadDisputes()])
  } catch (err: any) {
    toast.error(err?.message || '提交争议失败')
  } finally {
    disputeSubmitting.value = false
  }
}

async function loadDisputes(): Promise<void> {
  disputesLoading.value = true
  try {
    const res = await api.exchange.disputes({ page: disputesPage.value, pageSize: recordPageSize })
    disputes.value = res.items || []
    disputesTotal.value = res.total || 0
    disputesPage.value = res.page || disputesPage.value
  } catch (err: any) {
    toast.error(err?.message || '加载争议记录失败')
  } finally {
    disputesLoading.value = false
  }
}

async function changeDisputesPage(delta: number): Promise<void> {
  const next = Math.min(disputesTotalPages.value, Math.max(1, disputesPage.value + delta))
  if (next === disputesPage.value) return
  disputesPage.value = next
  await loadDisputes()
}

function loadActiveTab(): void {
  if (activeTab.value === 'market') void loadMarket()
  if (activeTab.value === 'sell') void loadInstances()
  if (activeTab.value === 'listings') void loadMyListings()
  if (activeTab.value === 'buys') void loadBuys()
  if (activeTab.value === 'sales') void loadSales()
  if (activeTab.value === 'wallet') void loadWallet()
  if (activeTab.value === 'records') void loadWallet()
  if (activeTab.value === 'disputes') void loadDisputes()
}

watch(activeTab, loadActiveTab)

onMounted(async () => {
  if (activeInstanceId.value) activeTab.value = 'sell'
  await loadExchangeConfig()
  loadActiveTab()
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold text-themed">交易所</h1>
      <p class="mt-1 text-sm text-themed-muted">出售的是实例剩余使用权。成交后平台托管资金，并强制重装后匿名交割。</p>
    </div>

    <div class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
      上架前必须先暂停实例；成交后原系统和数据不可恢复。买卖双方互不可见，提现进入人工审核。
    </div>

    <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-lg border border-themed bg-themed-secondary p-4 text-sm">
        <div class="font-medium text-themed">交易费率</div>
        <p class="mt-1 text-themed-muted">{{ policyFeeSummary() }}</p>
      </div>
      <div class="rounded-lg border border-themed bg-themed-secondary p-4 text-sm">
        <div class="font-medium text-themed">交割确认</div>
        <p class="mt-1 text-themed-muted">
          确认期 {{ exchangeConfig.confirmationHours }} 小时，{{ exchangeConfig.autoConfirmEnabled ? '到期无争议自动放款' : '需平台人工确认放款' }}
        </p>
      </div>
      <div class="rounded-lg border border-themed bg-themed-secondary p-4 text-sm">
        <div class="font-medium text-themed">提现规则</div>
        <p class="mt-1 text-themed-muted">{{ policyWithdrawalSummary() }}</p>
      </div>
      <div class="rounded-lg border border-themed bg-themed-secondary p-4 text-sm">
        <div class="font-medium text-themed">交易限制</div>
        <p class="mt-1 text-themed-muted">
          每用户最多 {{ exchangeConfig.maxActiveListingsPerUser }} 个挂牌，每日最多购买 {{ exchangeConfig.maxPurchasesPerUserPerDay }} 次
        </p>
      </div>
      <div class="rounded-lg border border-themed bg-themed-secondary p-4 text-sm md:col-span-2 xl:col-span-4">
        <div class="font-medium text-themed">准入和交割策略</div>
        <p class="mt-1 text-themed-muted">
          最低剩余 {{ exchangeConfig.minRemainingDays }} 天，{{ exchangeConfig.expiringSoonDays }} 天内到期不可挂牌；最高溢价 {{ exchangeConfig.maxMarkupPercent }}%；独立 IP {{ exchangeConfig.allowPublicIpTransfer ? '允许随实例转让' : '不允许随实例转让' }}；买家自选镜像 {{ exchangeConfig.allowBuyerImageSelection ? '已开放' : '未开放' }}；争议超时 {{ exchangeConfig.disputeTimeoutHours }} 小时。
        </p>
      </div>
    </section>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="rounded-lg border px-3 py-2 text-sm transition-colors"
        :class="tabClass(tab.key)"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <section v-if="activeTab === 'market'" class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-sm text-themed-muted">共 {{ marketTotal }} 个匿名挂牌</div>
        <button class="btn btn-secondary" type="button" @click="loadMarket">刷新</button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm text-themed-muted">套餐分类</span>
        <button
          type="button"
          class="rounded-lg border px-3 py-1.5 text-sm transition-colors"
          :class="marketPackageFilterClass(null)"
          @click="selectMarketPackage(null)"
        >
          全部
        </button>
        <button
          v-for="pkg in marketPackages"
          :key="pkg.id"
          type="button"
          class="rounded-lg border px-3 py-1.5 text-sm transition-colors"
          :class="marketPackageFilterClass(pkg.id)"
          @click="selectMarketPackage(pkg.id)"
        >
          {{ pkg.name }} · {{ pkg.count }}
        </button>
      </div>
      <div v-if="marketLoading" class="card p-8 text-center text-themed-muted">加载中...</div>
      <div v-else-if="market.length === 0" class="card p-8 text-center text-themed-muted">暂无可购买挂牌。</div>
      <div v-else class="grid gap-4 xl:grid-cols-3 lg:grid-cols-2">
        <article v-for="listing in market" :key="listing.id" :class="cardClass('p-5 space-y-4')">
          <div class="flex items-start justify-between gap-3">
            <div>
	              <div class="text-lg font-semibold text-themed">{{ listing.publicCode }}</div>
	              <div class="mt-1 flex flex-wrap gap-1.5 text-xs">
	                <span class="rounded bg-amber-100 px-2 py-0.5 text-amber-700">{{ statusLabel(listing.status) }}</span>
	                <span class="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">暂停交割</span>
	                <span class="rounded bg-blue-100 px-2 py-0.5 text-blue-700">强制重装</span>
	                <span class="rounded bg-gray-100 px-2 py-0.5 text-gray-700">匿名交易</span>
              </div>
            </div>
            <div class="text-xl font-semibold text-orange-500">{{ money(listing.price) }}</div>
          </div>

          <dl class="grid grid-cols-[88px_minmax(0,1fr)] gap-y-2 text-sm">
            <dt class="font-medium text-themed">地区</dt>
            <dd class="text-themed-muted">{{ hostRegionLabel(snapshotOf(listing)) }}</dd>
            <dt class="font-medium text-themed">节点</dt>
            <dd class="text-themed-muted">{{ hostNodeLabel(snapshotOf(listing)) }}</dd>
            <dt class="font-medium text-themed">套餐</dt>
            <dd class="text-themed-muted">{{ packageLabel(snapshotOf(listing)) }}</dd>
            <dt class="font-medium text-themed">配置</dt>
            <dd class="text-themed-muted">{{ snapshotOf(listing).cpu }}% 核 {{ formatMemory(snapshotOf(listing).memory) }} {{ formatDisk(snapshotOf(listing).disk) }}</dd>
            <dt class="font-medium text-themed">网络</dt>
            <dd class="text-themed-muted">{{ networkLabel(snapshotOf(listing)) }} · {{ bandwidthLabel(snapshotOf(listing)) }}</dd>
            <dt class="font-medium text-themed">续费价格</dt>
            <dd class="text-themed-muted">{{ renewalPriceLabel(snapshotOf(listing)) }}</dd>
            <dt class="font-medium text-themed">IP</dt>
            <dd class="text-themed-muted">{{ ipSummary(snapshotOf(listing)) }}</dd>
            <dt class="font-medium text-themed">流量</dt>
            <dd class="text-themed-muted">{{ bytesLabel(snapshotOf(listing).monthlyTrafficUsed) }} / {{ bytesLabel(snapshotOf(listing).monthlyTrafficLimit) }}</dd>
            <dt class="font-medium text-themed">剩余有效期</dt>
            <dd class="text-themed-muted">{{ remainingDays(snapshotOf(listing).expiresAt) }}，到期 {{ formatDateOnly(snapshotOf(listing).expiresAt) }}</dd>
          </dl>

          <div class="rounded bg-themed-secondary p-3 text-xs text-themed-muted">
            购买后进入资金托管和交割任务。买家获得重装后的新实例，不包含卖家原数据。
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn btn-secondary w-full" type="button" @click="openListingDetail(listing)">查看详情</button>
            <button class="btn btn-primary w-full" type="button" @click="openListingDetail(listing)">查看并购买</button>
          </div>
        </article>
      </div>
      <div v-if="!marketLoading && marketTotal > 0" class="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span class="text-themed-muted">{{ pageSummary(marketTotal, marketPage, pageSize) }}</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary btn-sm" type="button" :disabled="marketPage <= 1" @click="changeMarketPage(-1)">上一页</button>
          <span class="text-themed-muted">第 {{ marketPage }} / {{ marketTotalPages }} 页</span>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="marketPage >= marketTotalPages" @click="changeMarketPage(1)">下一页</button>
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'sell'" class="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_420px]">
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-themed">实例检测</h2>
            <p class="text-sm text-themed-muted">只有暂停且通过风控、欠费、到期、任务、套餐和节点检测的实例可以上架。</p>
          </div>
          <button class="btn btn-secondary" type="button" @click="loadInstances">刷新</button>
        </div>
        <div v-if="instancesLoading" class="card p-8 text-center text-themed-muted">加载中...</div>
        <div v-else-if="instances.length === 0" class="card p-8 text-center text-themed-muted">暂无实例。</div>
        <div v-else class="space-y-3">
          <article v-for="instance in instances" :key="instance.id" :class="cardClass('p-4')">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-base font-semibold text-themed">{{ instance.name }}</span>
                  <span class="rounded px-2 py-0.5 text-xs" :class="eligibilityBadge(eligibilityMap[instance.id]).tone">
                    {{ eligibilityBadge(eligibilityMap[instance.id]).label }}
                  </span>
                  <span class="text-xs text-themed-muted">{{ instanceStatusLabel(instance.status) }}</span>
                </div>
                <div class="mt-2 text-sm text-themed-muted">
                  {{ instance.cpu }}% 核 · {{ formatMemory(instance.memory) }} · {{ formatDisk(instance.disk) }}
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button class="btn btn-secondary" type="button" :disabled="eligibilityLoading[instance.id]" @click="checkEligibility(instance)">
                  {{ eligibilityLoading[instance.id] ? '检测中...' : '检测' }}
                </button>
                <button v-if="instanceNeedsStopBeforeListing(instance)" class="btn btn-secondary" type="button" @click="requestStopBeforeListing(instance)">
                  先暂停实例
                </button>
                <button
                  class="btn btn-primary"
                  type="button"
                  :disabled="!canSelectListingInstance(instance)"
                  @click="listingForm.instanceId = instance.id"
                >
                  上架交易所
                </button>
              </div>
            </div>

            <div
              v-if="instanceNeedsStopBeforeListing(instance)"
              class="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200"
            >
              上架交易所前必须先暂停实例。暂停后实例将停止运行，挂牌期间保持暂停/锁定；成交后会强制重装并交割给买家，原数据不可恢复。
            </div>

            <div v-if="eligibilityMap[instance.id]" class="mt-4 grid gap-2 md:grid-cols-2">
              <div
                v-for="check in eligibilityMap[instance.id].checks"
                :key="check.key"
                class="rounded border px-3 py-2 text-xs"
                :class="check.passed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'"
              >
                <span class="font-medium">{{ check.label }}</span>：{{ check.message }}
              </div>
            </div>

            <div v-if="eligibilityMap[instance.id]" class="mt-3 rounded bg-themed-secondary p-3 text-xs text-themed-muted">
              交割时平台会清理 SSH key、终端会话、控制台 token、端口映射、代理站点、旧快照和备份策略，并重置流量基线。
            </div>
          </article>
        </div>
      </div>

      <form :class="cardClass('p-5 space-y-4')" @submit.prevent="requestCreateListing">
        <div>
          <h2 class="text-lg font-semibold text-themed">创建挂牌</h2>
          <p class="text-sm text-themed-muted">提交前会再次确认强制重装和数据不可恢复。</p>
        </div>
        <div class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          只有已暂停并通过检测的实例可以提交挂牌。运行中实例请先在左侧点击“先暂停实例”，暂停完成后重新检测。
        </div>
        <label class="block text-sm">
          <span class="text-themed">实例 ID</span>
          <input v-model.number="listingForm.instanceId" class="input mt-1 w-full" type="number" min="1" readonly>
        </label>
        <label class="block text-sm">
          <span class="text-themed">售价</span>
          <input v-model.number="listingForm.price" class="input mt-1 w-full" type="number" min="0" step="0.01" placeholder="例如 30.00">
        </label>
        <label class="block text-sm">
          <span class="text-themed">自动下架时间，可选</span>
          <input v-model="listingForm.autoDelistAt" class="input mt-1 w-full" type="datetime-local">
        </label>
        <label class="block text-sm">
          <span class="text-themed">说明，可选</span>
          <textarea v-model="listingForm.description" class="input mt-1 w-full" rows="4" placeholder="不允许填写联系方式或暴露身份信息"></textarea>
        </label>
        <div class="rounded bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-200">
          成交后实例会锁定并强制重装交割，原系统和数据不会交付给买家，也不可恢复。
        </div>
        <button class="btn btn-primary w-full" type="submit" :disabled="listingSubmitting || !listingForm.instanceId">
          {{ listingSubmitting ? '提交中...' : '确认挂牌' }}
        </button>
      </form>
    </section>

    <section v-else-if="activeTab === 'listings'" class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-themed">我的挂牌</h2>
        <button class="btn btn-secondary" type="button" @click="loadMyListings">刷新</button>
      </div>
      <div v-if="myListingsLoading" class="card p-8 text-center text-themed-muted">加载中...</div>
      <div v-else-if="myListings.length === 0" class="card p-8 text-center text-themed-muted">暂无挂牌。</div>
      <div v-else class="grid gap-4 lg:grid-cols-2">
        <article v-for="listing in myListings" :key="listing.id" :class="cardClass('p-5 space-y-3')">
          <div class="flex items-start justify-between">
            <div>
              <div class="font-semibold text-themed">{{ listing.publicCode }}</div>
              <div class="text-sm text-themed-muted">{{ snapshotOf(listing).name }} · {{ statusLabel(listing.status) }}</div>
            </div>
            <div class="text-lg font-semibold text-orange-500">{{ money(listing.price) }}</div>
          </div>
          <div class="text-sm text-themed-muted">卖家预计到账 {{ money(listing.sellerReceivesAmount) }}，手续费 {{ money(listing.feeAmount) }}</div>
          <div class="flex justify-end gap-2">
            <button v-if="listing.status === 'active'" class="btn btn-secondary" type="button" @click="requestEditListing(listing)">修改</button>
            <button v-if="['active', 'paused'].includes(listing.status)" class="btn btn-secondary" type="button" @click="requestDelist(listing)">下架</button>
          </div>
        </article>
      </div>
      <div v-if="!myListingsLoading && myListingsTotal > 0" class="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span class="text-themed-muted">{{ pageSummary(myListingsTotal, myListingsPage, recordPageSize) }}</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary btn-sm" type="button" :disabled="myListingsPage <= 1" @click="changeMyListingsPage(-1)">上一页</button>
          <span class="text-themed-muted">第 {{ myListingsPage }} / {{ myListingsTotalPages }} 页</span>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="myListingsPage >= myListingsTotalPages" @click="changeMyListingsPage(1)">下一页</button>
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'buys' || activeTab === 'sales'" class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-themed">{{ activeTab === 'buys' ? '我的买入' : '我的卖出' }}</h2>
        <button class="btn btn-secondary" type="button" @click="activeTab === 'buys' ? loadBuys() : loadSales()">刷新</button>
      </div>
      <div v-if="activeTab === 'buys' ? buysLoading : salesLoading" class="card p-8 text-center text-themed-muted">加载中...</div>
      <div v-else-if="(activeTab === 'buys' ? buys : sales).length === 0" class="card p-8 text-center text-themed-muted">暂无订单。</div>
      <div v-else class="space-y-3">
        <article v-for="order in (activeTab === 'buys' ? buys : sales)" :key="order.id" :class="cardClass('p-4')">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="font-semibold text-themed">{{ order.orderNo }}</div>
              <div class="mt-1 text-sm text-themed-muted">
                {{ packageLabel(snapshotOf(order)) }} · {{ statusLabel(order.status) }}
              </div>
              <div class="mt-2 text-xs text-themed-muted">交割任务：{{ order.deliveryTask ? statusLabel(order.deliveryTask.status) : '等待创建' }} / {{ statusLabel(order.deliveryTask?.step || order.status) }}</div>
              <div v-if="order.deliveryTask?.startedAt || order.deliveryTask?.finishedAt" class="mt-1 text-xs text-themed-muted">
                开始：{{ formatDate(order.deliveryTask.startedAt) }} · 完成：{{ formatDate(order.deliveryTask.finishedAt) }}
              </div>
              <div v-if="activeTab === 'buys' && order.deliveryTask" class="mt-1 text-xs text-themed-muted">
                重装镜像：{{ order.deliveryTask.imageAlias || '使用原实例镜像' }} · SSH Key：{{ order.deliveryTask.sshKeyId ? `#${order.deliveryTask.sshKeyId}` : '未指定' }}
              </div>
              <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span class="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">匿名交易</span>
                <span class="rounded bg-blue-100 px-2 py-0.5 text-blue-700">强制重装交割</span>
                <span class="rounded bg-amber-100 px-2 py-0.5 text-amber-700">资金托管</span>
              </div>
            </div>
            <div class="text-right">
              <div class="text-lg font-semibold text-orange-500">{{ money(order.price) }}</div>
              <div class="mt-2 flex flex-wrap justify-end gap-2">
                <button
                  class="btn btn-secondary"
                  type="button"
                  :disabled="orderRefreshingId === order.id"
                  @click="refreshOrderDetail(order)"
                >
                  {{ orderRefreshingId === order.id ? '刷新中...' : '刷新进度' }}
                </button>
                <button class="btn btn-secondary" type="button" @click="requestCreateDispute(order)">发起争议</button>
              </div>
            </div>
          </div>
          <div class="mt-3 grid gap-2 text-xs md:grid-cols-4 xl:grid-cols-7">
            <div
              v-for="step in deliveryProgressSteps(order)"
              :key="`${order.id}:${step}`"
              class="rounded border p-2"
              :class="deliveryStepClass(order, step)"
            >
              <div class="font-semibold">{{ deliveryStepMarker(order, step) }} {{ deliveryStepLabels[step] || step }}</div>
            </div>
          </div>
          <div
            v-if="order.deliveryTask?.error || order.failureReason"
            class="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
          >
            {{ order.deliveryTask?.error || order.failureReason }}
          </div>
          <div
            v-else-if="order.status === 'confirming'"
            class="mt-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
          >
            交割已完成，确认期截止 {{ formatDate(order.confirmationDueAt) }}。确认期结束后托管款扣除手续费进入卖家交易所余额。
          </div>
        </article>
      </div>
      <div
        v-if="!(activeTab === 'buys' ? buysLoading : salesLoading) && (activeTab === 'buys' ? buysTotal : salesTotal) > 0"
        class="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        <span class="text-themed-muted">
          {{ pageSummary(activeTab === 'buys' ? buysTotal : salesTotal, activeTab === 'buys' ? buysPage : salesPage, recordPageSize) }}
        </span>
        <div class="flex items-center gap-2">
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            :disabled="(activeTab === 'buys' ? buysPage : salesPage) <= 1"
            @click="activeTab === 'buys' ? changeBuysPage(-1) : changeSalesPage(-1)"
          >
            上一页
          </button>
          <span class="text-themed-muted">
            第 {{ activeTab === 'buys' ? buysPage : salesPage }} / {{ activeTab === 'buys' ? buysTotalPages : salesTotalPages }} 页
          </span>
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            :disabled="(activeTab === 'buys' ? buysPage >= buysTotalPages : salesPage >= salesTotalPages)"
            @click="activeTab === 'buys' ? changeBuysPage(1) : changeSalesPage(1)"
          >
            下一页
          </button>
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'wallet'" class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-themed">交易所余额</h2>
        <button class="btn btn-secondary" type="button" @click="loadWallet">刷新</button>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div :class="cardClass('p-5')">
          <div class="text-sm text-themed-muted">可用余额</div>
          <div class="mt-2 text-3xl font-semibold text-themed">{{ money(wallet?.availableAmount) }}</div>
        </div>
        <div :class="cardClass('p-5')">
          <div class="text-sm text-themed-muted">冻结金额</div>
          <div class="mt-2 text-3xl font-semibold text-themed">{{ money(wallet?.frozenAmount) }}</div>
        </div>
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        <form :class="cardClass('p-5 space-y-3')" @submit.prevent="transferToBalance">
          <h3 class="font-semibold text-themed">划转到账户余额</h3>
          <p class="text-xs text-themed-muted">
            {{ exchangeConfig.allowBalanceTransfer ? '划转会即时进入账户余额，但仍会先通过风控和二次验证。' : '当前交易所策略未开放划转到账户余额。' }}
          </p>
          <input
            v-model.number="transferAmount"
            class="input w-full"
            type="number"
            min="0"
            :max="walletAvailableAmount"
            step="0.01"
            placeholder="划转金额"
            :disabled="!exchangeConfig.allowBalanceTransfer"
          >
          <button
            class="btn btn-primary"
            type="submit"
            :disabled="walletActionLoading === 'transfer' || !canTransferExchangeBalance"
          >
            确认划转
          </button>
        </form>
        <form :class="cardClass('p-5 space-y-3')" @submit.prevent="createWithdrawal">
          <h3 class="font-semibold text-themed">申请提现</h3>
          <p class="text-xs text-themed-muted">
            提现必须人工审核，最低提现 {{ money(exchangeConfig.withdrawalMinAmount) }}；存在未完结争议或确认期未结束的成交时会被后台拒绝。
          </p>
          <input
            v-model.number="withdrawalForm.amount"
            class="input w-full"
            type="number"
            :min="exchangeConfig.withdrawalMinAmount"
            :max="walletAvailableAmount"
            step="0.01"
            placeholder="提现金额"
            required
          >
          <input v-model="withdrawalForm.method" class="input w-full" placeholder="提现方式" required>
          <input v-model="withdrawalForm.account" class="input w-full" placeholder="收款账号" required>
          <textarea v-model="withdrawalForm.remark" class="input w-full" rows="3" placeholder="备注，可选"></textarea>
          <button class="btn btn-primary" type="submit" :disabled="walletActionLoading === 'withdraw' || !canSubmitWithdrawal">提交人工审核</button>
        </form>
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        <div :class="cardClass('overflow-hidden')">
          <div class="border-b border-themed px-4 py-3 font-semibold text-themed">余额流水</div>
          <div v-if="walletLoading" class="p-6 text-center text-themed-muted">加载中...</div>
          <div v-else-if="walletLogs.length === 0" class="p-6 text-center text-themed-muted">暂无流水。</div>
          <div v-else class="divide-y divide-themed">
            <div v-for="log in walletLogs" :key="log.id" class="px-4 py-3 text-sm">
              <div class="flex justify-between gap-3">
                <span class="text-themed">{{ log.remark || statusLabel(log.type) }}</span>
                <span :class="log.amount >= 0 ? 'text-emerald-600' : 'text-red-500'">{{ money(log.amount) }}</span>
              </div>
              <div class="mt-1 text-xs text-themed-muted">{{ formatDate(log.createdAt) }}</div>
            </div>
          </div>
          <div v-if="!walletLoading && walletLogsTotal > 0" class="flex flex-wrap items-center justify-between gap-2 border-t border-themed px-4 py-3 text-xs">
            <span class="text-themed-muted">{{ pageSummary(walletLogsTotal, walletLogsPage, recordPageSize) }}</span>
            <div class="flex items-center gap-2">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="walletLogsPage <= 1" @click="changeWalletLogsPage(-1)">上一页</button>
              <span class="text-themed-muted">{{ walletLogsPage }} / {{ walletLogsTotalPages }}</span>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="walletLogsPage >= walletLogsTotalPages" @click="changeWalletLogsPage(1)">下一页</button>
            </div>
          </div>
        </div>
        <div :class="cardClass('overflow-hidden')">
          <div class="border-b border-themed px-4 py-3 font-semibold text-themed">提现记录</div>
          <div v-if="walletLoading" class="p-6 text-center text-themed-muted">加载中...</div>
          <div v-else-if="withdrawals.length === 0" class="p-6 text-center text-themed-muted">暂无提现。</div>
          <div v-else class="divide-y divide-themed">
            <div v-for="item in withdrawals" :key="item.id" class="px-4 py-3 text-sm">
              <div class="flex justify-between gap-3">
                <span class="text-themed">{{ item.withdrawalNo }} · {{ statusLabel(item.status) }}</span>
                <span class="text-themed">{{ money(item.amount) }}</span>
              </div>
              <div class="mt-1 text-xs text-themed-muted">{{ formatDate(item.createdAt) }}</div>
            </div>
          </div>
          <div v-if="!walletLoading && withdrawalsTotal > 0" class="flex flex-wrap items-center justify-between gap-2 border-t border-themed px-4 py-3 text-xs">
            <span class="text-themed-muted">{{ pageSummary(withdrawalsTotal, withdrawalsPage, recordPageSize) }}</span>
            <div class="flex items-center gap-2">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="withdrawalsPage <= 1" @click="changeWithdrawalsPage(-1)">上一页</button>
              <span class="text-themed-muted">{{ withdrawalsPage }} / {{ withdrawalsTotalPages }}</span>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="withdrawalsPage >= withdrawalsTotalPages" @click="changeWithdrawalsPage(1)">下一页</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'records'" class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-themed">交易记录</h2>
          <p class="text-sm text-themed-muted">记录托管入账、手续费扣除、放款、提现、划转和人工调整等交易所资金动作。</p>
        </div>
        <button class="btn btn-secondary" type="button" @click="loadWallet">刷新</button>
      </div>
      <div :class="cardClass('overflow-hidden')">
        <div v-if="walletLoading" class="p-6 text-center text-themed-muted">加载中...</div>
        <div v-else-if="walletLogs.length === 0" class="p-6 text-center text-themed-muted">暂无交易记录。</div>
        <div v-else class="divide-y divide-themed">
          <div v-for="log in walletLogs" :key="log.id" class="px-4 py-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="font-medium text-themed">{{ statusLabel(log.type) }}</div>
                <div class="mt-1 text-xs text-themed-muted">{{ log.remark || '-' }}</div>
              </div>
              <div class="text-right">
                <div :class="log.amount >= 0 ? 'text-emerald-600' : 'text-red-500'">{{ money(log.amount) }}</div>
                <div class="mt-1 text-xs text-themed-muted">{{ formatDate(log.createdAt) }}</div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="!walletLoading && walletLogsTotal > 0" class="flex flex-wrap items-center justify-between gap-2 border-t border-themed px-4 py-3 text-xs">
          <span class="text-themed-muted">{{ pageSummary(walletLogsTotal, walletLogsPage, recordPageSize) }}</span>
          <div class="flex items-center gap-2">
            <button class="btn btn-secondary btn-sm" type="button" :disabled="walletLogsPage <= 1" @click="changeWalletLogsPage(-1)">上一页</button>
            <span class="text-themed-muted">{{ walletLogsPage }} / {{ walletLogsTotalPages }}</span>
            <button class="btn btn-secondary btn-sm" type="button" :disabled="walletLogsPage >= walletLogsTotalPages" @click="changeWalletLogsPage(1)">下一页</button>
          </div>
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'disputes'" class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-themed">争议记录</h2>
        <button class="btn btn-secondary" type="button" @click="loadDisputes">刷新</button>
      </div>
      <div v-if="disputesLoading" class="card p-8 text-center text-themed-muted">加载中...</div>
      <div v-else-if="disputes.length === 0" class="card p-8 text-center text-themed-muted">暂无争议。</div>
      <div v-else class="space-y-3">
        <article v-for="item in disputes" :key="item.id" :class="cardClass('p-4')">
          <div class="flex flex-wrap justify-between gap-3">
            <div>
              <div class="font-semibold text-themed">{{ item.orderNo }} · {{ statusLabel(item.status) }}</div>
              <div class="mt-1 text-sm text-themed-muted">{{ item.reason }}</div>
            </div>
            <div class="text-sm text-themed-muted">{{ formatDate(item.createdAt) }}</div>
          </div>
          <div v-if="item.resolution" class="mt-3 rounded bg-themed-secondary p-3 text-sm text-themed-muted">{{ item.resolution }}</div>
        </article>
      </div>
      <div v-if="!disputesLoading && disputesTotal > 0" class="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span class="text-themed-muted">{{ pageSummary(disputesTotal, disputesPage, recordPageSize) }}</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary btn-sm" type="button" :disabled="disputesPage <= 1" @click="changeDisputesPage(-1)">上一页</button>
          <span class="text-themed-muted">第 {{ disputesPage }} / {{ disputesTotalPages }} 页</span>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="disputesPage >= disputesTotalPages" @click="changeDisputesPage(1)">下一页</button>
        </div>
      </div>
    </section>

    <div
      v-if="selectedListing"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
      @click.self="closeListingDetail"
    >
      <section class="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-themed bg-themed p-6 shadow-xl">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold text-themed">{{ selectedListing.publicCode }}</h2>
            <p class="mt-1 text-sm text-themed-muted">匿名交易的实例剩余使用权，成交后由平台强制重装交割。</p>
          </div>
          <button class="btn btn-secondary" type="button" @click="closeListingDetail">关闭</button>
        </div>

        <div v-if="listingDetailLoading" class="mt-6 rounded bg-themed-secondary p-6 text-center text-themed-muted">加载详情中...</div>
        <template v-else>
          <div class="mt-5 flex flex-wrap gap-2 text-xs">
            <span class="rounded bg-emerald-100 px-2 py-1 text-emerald-700">暂停锁定后交割</span>
            <span class="rounded bg-blue-100 px-2 py-1 text-blue-700">成交强制重装</span>
            <span class="rounded bg-gray-100 px-2 py-1 text-gray-700">匿名交易</span>
            <span class="rounded bg-orange-100 px-2 py-1 text-orange-700">平台资金托管</span>
          </div>

          <dl class="mt-5 grid gap-3 text-sm md:grid-cols-[120px_minmax(0,1fr)_120px_minmax(0,1fr)]">
            <dt class="font-medium text-themed">地区</dt>
            <dd class="text-themed-muted">{{ hostRegionLabel(snapshotOf(selectedListing)) }}</dd>
            <dt class="font-medium text-themed">节点</dt>
            <dd class="text-themed-muted">{{ hostNodeLabel(snapshotOf(selectedListing)) }}</dd>
            <dt class="font-medium text-themed">套餐</dt>
            <dd class="text-themed-muted">{{ packageLabel(snapshotOf(selectedListing)) }}</dd>
            <dt class="font-medium text-themed">配置</dt>
            <dd class="text-themed-muted">{{ snapshotOf(selectedListing).cpu }}% 核 {{ formatMemory(snapshotOf(selectedListing).memory) }} {{ formatDisk(snapshotOf(selectedListing).disk) }}</dd>
            <dt class="font-medium text-themed">网络类型</dt>
            <dd class="text-themed-muted">{{ networkLabel(snapshotOf(selectedListing)) }}</dd>
            <dt class="font-medium text-themed">独立 IP</dt>
            <dd class="text-themed-muted">{{ ipSummary(snapshotOf(selectedListing)) }}</dd>
            <dt class="font-medium text-themed">带宽</dt>
            <dd class="text-themed-muted">{{ bandwidthLabel(snapshotOf(selectedListing)) }}</dd>
            <dt class="font-medium text-themed">续费价格</dt>
            <dd class="text-themed-muted">{{ renewalPriceLabel(snapshotOf(selectedListing)) }}</dd>
            <dt class="font-medium text-themed">剩余流量</dt>
            <dd class="text-themed-muted">{{ bytesLabel(snapshotOf(selectedListing).monthlyTrafficUsed) }} / {{ bytesLabel(snapshotOf(selectedListing).monthlyTrafficLimit) }}</dd>
            <dt class="font-medium text-themed">剩余有效期</dt>
            <dd class="text-themed-muted">{{ remainingDays(snapshotOf(selectedListing).expiresAt) }}，到期 {{ formatDateOnly(snapshotOf(selectedListing).expiresAt) }}</dd>
            <dt class="font-medium text-themed">售价</dt>
            <dd class="text-orange-500">{{ money(selectedListing.price) }}</dd>
	            <dt class="font-medium text-themed">手续费</dt>
	            <dd class="text-themed-muted">平台手续费 {{ money(selectedListing.feeAmount) }}，卖家预计到账 {{ money(selectedListing.sellerReceivesAmount) }}</dd>
	            <dt class="font-medium text-themed">交易状态</dt>
	            <dd class="text-themed-muted">{{ statusLabel(selectedListing.status) }}，成交前实例保持暂停锁定</dd>
	            <dt class="font-medium text-themed">挂牌说明</dt>
	            <dd class="text-themed-muted">{{ selectedListing.description || '卖家未填写说明，平台仍会按强制重装交割。' }}</dd>
	          </dl>

          <div class="mt-5 space-y-2 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
            <p>购买后获得的是实例剩余使用权，不包含卖家原系统、原数据、账号信息或历史订单。</p>
            <p>付款后资金进入平台托管，实例会先清理访问权限、端口、代理站点、快照和凭据，再强制重装并转移给买家。</p>
            <p>买卖双方前台互不可见；如交割异常，可提交争议等待平台人工处理。</p>
          </div>

          <div class="mt-5 rounded border border-themed p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 class="font-semibold text-themed">交割设置</h3>
                <p class="mt-1 text-sm text-themed-muted">成交后平台会强制重装。镜像选择受后台交易所策略和节点镜像白名单限制。</p>
              </div>
              <span class="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700">重装后交割</span>
            </div>
            <div v-if="purchaseOptionsLoading" class="mt-4 rounded bg-themed-secondary p-4 text-sm text-themed-muted">加载交割设置中...</div>
            <div v-else class="mt-4 grid gap-3 md:grid-cols-2">
              <label v-if="exchangeConfig.allowBuyerImageSelection" class="block text-sm">
                <span class="text-themed">重装镜像</span>
                <select v-model="purchaseForm.imageAlias" class="input mt-1 w-full">
                  <option value="">使用原实例镜像重装</option>
                  <option v-for="image in availableImages" :key="image.id" :value="image.remoteAlias">
                    {{ image.name }}（{{ image.remoteAlias }}）
                  </option>
                </select>
                <span class="mt-1 block text-xs text-themed-muted">所选镜像仍会经过节点镜像白名单、类型和内存兼容性校验。</span>
              </label>
              <div v-else class="rounded border border-themed bg-themed-secondary p-3 text-sm">
                <div class="font-medium text-themed">重装镜像</div>
                <p class="mt-1 text-xs text-themed-muted">当前交易所策略未开放买家自选镜像，成交后平台会按默认/原实例镜像强制重装。</p>
              </div>
              <label class="block text-sm">
                <span class="text-themed">SSH Key</span>
                <select v-model.number="purchaseForm.sshKeyId" class="input mt-1 w-full">
                  <option :value="0">不注入 SSH Key</option>
                  <option v-for="key in sshKeys" :key="key.id" :value="key.id">
                    {{ key.name }}{{ key.fingerprint ? ` · ${key.fingerprint}` : '' }}
                  </option>
                </select>
                <span class="mt-1 block text-xs" :class="sshKeys.length ? 'text-themed-muted' : 'text-amber-600'">
                  {{ sshKeys.length ? '建议选择一个 SSH Key，便于重装后登录。' : '当前账号没有 SSH Key，购买前建议先到个人资料添加。' }}
                </span>
              </label>
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <button class="btn btn-secondary" type="button" @click="closeListingDetail">再看看</button>
            <button
              class="btn btn-primary"
              type="button"
              :disabled="purchaseSubmitting || purchaseOptionsLoading"
              @click="requestPurchaseListing(selectedListing)"
            >
              {{ purchaseSubmitting ? '提交中...' : '确认购买并托管' }}
            </button>
          </div>
        </template>
      </section>
    </div>
    <div
      v-if="showListingConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      @click.self="cancelCreateListing"
    >
      <section :class="cardClass('w-full max-w-lg p-5 shadow-xl')">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">确认上架交易所</h2>
            <p class="mt-1 text-sm text-themed-muted">实例 ID {{ listingForm.instanceId }} 将进入交易所挂牌流程。</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="listingSubmitting" @click="cancelCreateListing">取消</button>
        </div>
        <div class="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-200">
          成交后实例会被锁定并强制重装交割，原系统和数据不会交付给买家，也不可恢复。挂牌期间实例保持暂停/交易锁定，只允许改价、改说明、下架或查看交易状态。
        </div>
        <div class="mt-4 grid gap-2 text-sm text-themed-muted">
          <div>售价：<span class="text-orange-500">{{ money(Number(listingForm.price)) }}</span></div>
          <div>自动下架：{{ listingForm.autoDelistAt || '未设置' }}</div>
          <div>说明：{{ listingForm.description || '未填写' }}</div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" type="button" :disabled="listingSubmitting" @click="cancelCreateListing">取消</button>
          <button class="btn btn-primary" type="button" :disabled="listingSubmitting" @click="createListing">
            {{ listingSubmitting ? '提交中...' : '确认挂牌' }}
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="pendingPurchaseListing"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      @click.self="cancelPurchaseListing"
    >
      <section :class="cardClass('w-full max-w-lg p-5 shadow-xl')">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">确认购买交易所实例</h2>
            <p class="mt-1 text-sm text-themed-muted">{{ pendingPurchaseListing.publicCode }} · {{ money(pendingPurchaseListing.price) }}</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="purchaseSubmitting" @click="cancelPurchaseListing">取消</button>
        </div>
        <div class="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          该实例成交后会由平台强制重装交割。你购买的是剩余使用权，不包含卖家原数据或原系统环境；买卖双方互不可见。
        </div>
        <div class="mt-4 grid gap-2 text-sm text-themed-muted">
          <div>{{ purchaseConfirmImageText() }}</div>
          <div>{{ purchaseConfirmSshText() }}</div>
          <div>支付后账户余额会进入平台托管，交割完成并满足确认规则后再结算给卖家。</div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" type="button" :disabled="purchaseSubmitting" @click="cancelPurchaseListing">取消</button>
          <button class="btn btn-primary" type="button" :disabled="purchaseSubmitting" @click="purchaseListing(pendingPurchaseListing)">
            {{ purchaseSubmitting ? '提交中...' : '确认购买并托管' }}
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="listingEditDraft"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      @click.self="cancelEditListing"
    >
      <section :class="cardClass('w-full max-w-lg p-5 shadow-xl')">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">修改挂牌信息</h2>
            <p class="mt-1 text-sm text-themed-muted">
              {{ listingEditDraft.listing.publicCode }} 仍会保持暂停/交易锁定状态。
            </p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="listingActionSubmitting" @click="cancelEditListing">取消</button>
        </div>
        <div class="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          只允许修改售价、说明和自动下架时间，不能更换挂牌实例。成交后仍会强制重装交割，原系统和数据不会交付给买家。
        </div>
        <div class="mt-4 space-y-3">
          <label class="block text-sm">
            <span class="text-themed">售价</span>
            <input v-model.number="listingEditDraft.price" class="input mt-1 w-full" type="number" min="0" step="0.01">
          </label>
          <label class="block text-sm">
            <span class="text-themed">自动下架时间，可选</span>
            <input v-model="listingEditDraft.autoDelistAt" class="input mt-1 w-full" type="datetime-local">
          </label>
          <label class="block text-sm">
            <span class="text-themed">说明，可选</span>
            <textarea v-model="listingEditDraft.description" class="input mt-1 w-full" rows="4" placeholder="不允许填写联系方式或可识别身份的信息"></textarea>
          </label>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" type="button" :disabled="listingActionSubmitting" @click="cancelEditListing">取消</button>
          <button class="btn btn-primary" type="button" :disabled="listingActionSubmitting" @click="submitEditListing">
            {{ listingActionSubmitting ? '保存中...' : '保存修改' }}
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="pendingDelistListing"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      @click.self="cancelDelist"
    >
      <section :class="cardClass('w-full max-w-lg p-5 shadow-xl')">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">确认下架交易所</h2>
            <p class="mt-1 text-sm text-themed-muted">
              {{ pendingDelistListing.publicCode }} 下架后会解除交易锁定。
            </p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="listingActionSubmitting" @click="cancelDelist">取消</button>
        </div>
        <div class="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          下架只会移出交易所并解除交易锁定，实例仍保持暂停状态。是否启动实例由你之后自行决定；下架不会恢复成交流程。
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" type="button" :disabled="listingActionSubmitting" @click="cancelDelist">取消</button>
          <button class="btn btn-primary" type="button" :disabled="listingActionSubmitting" @click="confirmDelist">
            {{ listingActionSubmitting ? '处理中...' : '确认下架' }}
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="disputeDraft"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      @click.self="cancelCreateDispute"
    >
      <section :class="cardClass('w-full max-w-lg p-5 shadow-xl')">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">发起交易争议</h2>
            <p class="mt-1 text-sm text-themed-muted">
              订单 {{ disputeDraft.order.orderNo }} 将进入平台人工处理。
            </p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="disputeSubmitting" @click="cancelCreateDispute">取消</button>
        </div>
        <div class="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          争议提交后，平台会冻结/暂停自动结算并核对交割记录。请只填写问题说明，不要填写联系方式或对方身份信息。
        </div>
        <label class="mt-4 block text-sm">
          <span class="text-themed">争议原因</span>
          <textarea v-model="disputeDraft.reason" class="input mt-1 w-full" rows="5" placeholder="例如：交割后无法登录、配置与挂牌不一致、流量基线异常等"></textarea>
        </label>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" type="button" :disabled="disputeSubmitting" @click="cancelCreateDispute">取消</button>
          <button class="btn btn-primary" type="button" :disabled="disputeSubmitting" @click="submitCreateDispute">
            {{ disputeSubmitting ? '提交中...' : '提交争议' }}
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="showTransferConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      @click.self="cancelTransferToBalance"
    >
      <section :class="cardClass('w-full max-w-lg p-5 shadow-xl')">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">确认划转到账户余额</h2>
            <p class="mt-1 text-sm text-themed-muted">划转金额 {{ money(Number(transferAmount)) }}</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="walletActionLoading === 'transfer'" @click="cancelTransferToBalance">取消</button>
        </div>
        <div class="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          划转会从交易所可用余额进入账户余额，并写入完整资金流水。划转完成后不能作为提现申请自动撤回。
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" type="button" :disabled="walletActionLoading === 'transfer'" @click="cancelTransferToBalance">取消</button>
          <button class="btn btn-primary" type="button" :disabled="walletActionLoading === 'transfer'" @click="confirmTransferToBalance">
            {{ walletActionLoading === 'transfer' ? '处理中...' : '确认划转' }}
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="showWithdrawalConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      @click.self="cancelCreateWithdrawal"
    >
      <section :class="cardClass('w-full max-w-lg p-5 shadow-xl')">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">确认提交提现审核</h2>
            <p class="mt-1 text-sm text-themed-muted">提现金额 {{ money(Number(withdrawalForm.amount)) }}</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="walletActionLoading === 'withdraw'" @click="cancelCreateWithdrawal">取消</button>
        </div>
        <div class="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          提交后会冻结对应交易所余额，并进入平台人工审核。审核通过后仍需要管理员线下打款并标记完成。
        </div>
        <dl class="mt-4 grid grid-cols-[96px_minmax(0,1fr)] gap-y-2 text-sm">
          <dt class="font-medium text-themed">提现方式</dt>
          <dd class="break-all text-themed-muted">{{ withdrawalForm.method }}</dd>
          <dt class="font-medium text-themed">收款账号</dt>
          <dd class="break-all text-themed-muted">{{ withdrawalForm.account }}</dd>
          <dt class="font-medium text-themed">备注</dt>
          <dd class="break-all text-themed-muted">{{ withdrawalForm.remark || '未填写' }}</dd>
        </dl>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" type="button" :disabled="walletActionLoading === 'withdraw'" @click="cancelCreateWithdrawal">取消</button>
          <button class="btn btn-primary" type="button" :disabled="walletActionLoading === 'withdraw'" @click="confirmCreateWithdrawal">
            {{ walletActionLoading === 'withdraw' ? '提交中...' : '提交人工审核' }}
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="stopConfirmInstance"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      @click.self="cancelStopBeforeListing"
    >
      <section :class="cardClass('w-full max-w-lg p-5 shadow-xl')">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">先暂停实例</h2>
            <p class="mt-1 text-sm text-themed-muted">
              {{ stopConfirmInstance.name }} 需要先暂停后才能上架交易所。
            </p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="!!stopSubmittingId" @click="cancelStopBeforeListing">取消</button>
        </div>
        <div class="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          上架交易所前必须先暂停实例。暂停后实例将停止运行，挂牌期间保持暂停/交易锁定；成交后系统会强制重装并交割给买家，原系统和数据不可恢复。
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" type="button" :disabled="!!stopSubmittingId" @click="cancelStopBeforeListing">取消</button>
          <button class="btn btn-primary" type="button" :disabled="!!stopSubmittingId" @click="confirmStopBeforeListing">
            {{ stopSubmittingId ? '提交中...' : '先暂停实例' }}
          </button>
        </div>
      </section>
    </div>
    <SensitiveVerificationModal
      :show="verificationModalOpen"
      :operation-type="pendingSensitiveAction?.operationType || 'exchange_purchase'"
      :resource-id="pendingSensitiveAction?.resourceId"
      @close="closeSensitiveVerification"
      @verified="handleSensitiveVerified"
    />
  </div>
</template>
