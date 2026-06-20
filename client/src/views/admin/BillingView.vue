<script setup lang="ts">
import { ref, onMounted, computed, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import BillingOverviewIcon from '@/components/admin/BillingOverviewIcon.vue'
import { calculateDiscountedPrice } from '@/utils/billing'

const PaymentProvidersView = defineAsyncComponent(() => import('@/views/admin/PaymentProvidersView.vue'))
const AffReviewView = defineAsyncComponent(() => import('@/views/admin/AffReviewView.vue'))

type BatchPriceUpdateItemStatus = 'ready' | 'unchanged' | 'failed'

interface BatchPriceUpdatePreview {
  summary: {
    selectedCount: number
    validCount: number
    changedCount: number
    unchangedCount: number
    failedCount: number
    totalCharge: number
    totalRefund: number
    netAmount: number
  }
  canSubmit: boolean
  items: Array<{
    id: number
    name: string | null
    user: { id: number; username: string; balance: number } | null
    oldPrice: number | null
    newPrice: number
    billingCycle: number | null
    remainingDays: number
    priceDiff: number
    discountRate: number
    instanceVersion?: number
    status: BatchPriceUpdateItemStatus
    error?: string
  }>
  userImpacts: Array<{
    userId: number
    username: string
    balanceBefore: number
    balanceAfter: number
    totalCharge: number
    totalRefund: number
    netDiff: number
    insufficientBalance: boolean
  }>
}

const router = useRouter()
const route = useRoute()

const { t } = useI18n()
const toast = useToast()

// Tab 切换
type BillingTab = 'overview' | 'instances' | 'records' | 'rechargeRecords' | 'affConversions' | 'paymentProviders'
const billingTabs: BillingTab[] = ['overview', 'instances', 'records', 'rechargeRecords', 'affConversions', 'paymentProviders']
function normalizeTab(tab: unknown): BillingTab {
  return typeof tab === 'string' && billingTabs.includes(tab as BillingTab)
    ? tab as BillingTab
    : 'overview'
}

const activeTab = ref<BillingTab>(normalizeTab(route.query.tab))
const hasVisitedPaymentProviders = ref(activeTab.value === 'paymentProviders')
const hasVisitedAffConversions = ref(activeTab.value === 'affConversions')

// 分页大小选项
const pageSizeOptions = [10, 20, 50, 100]

// 宿主机列表（用于筛选）
const hosts = ref<Array<{ id: number; name: string }>>([])

type OverviewIconName = 'wallet' | 'chart' | 'store' | 'cloud' | 'server' | 'pulse' | 'ban' | 'clock' | 'sparkles'

interface BillingRevenueBucket {
  totalAmount: number
  thisMonthAmount: number
  todayAmount: number
}

interface BillingOverview {
  totalRevenue: number
  thisMonthRevenue: number
  lastMonthRevenue: number
  todayRevenue: number
  totalRefunds: number
  netRevenue: number
  paidInstancesCount: number
  activePaidInstancesCount: number
  suspendedCount: number
  expiringCount: number
  revenueMix: {
    direct: BillingRevenueBucket
    hosted: BillingRevenueBucket
  }
  recharge: {
    totalAmount: number
    totalCount: number
    thisMonthAmount: number
    thisMonthCount: number
    todayAmount: number
    todayCount: number
  }
  aff: {
    totalCommission: number
    totalOrders: number
    thisMonthCommission: number
    totalConverted: number
    pendingConvertCount: number
  }
}

interface PeriodComparisonCard {
  key: string
  label: string
  revenueAmount: number
  rechargeAmount: number
  rechargeCount: number
  badgeClass: string
  iconClass: string
}

interface RevenueMixRow {
  key: string
  label: string
  directAmount: number
  hostedAmount: number
  directRatio: number
  hostedRatio: number
}

interface MetricCard {
  key: string
  label: string
  value: number
  format: 'money' | 'count'
  icon: OverviewIconName
  toneClass: string
  surfaceClass: string
  progress?: number
}

// 概览数据
const overview = ref<BillingOverview | null>(null)
const overviewLoading = ref(true)

// 付费实例列表
const instances = ref<any[]>([])
const instancesLoading = ref(false)
const instancesPage = ref(1)
const instancesPageSize = ref(100)
const instancesTotal = ref(0)
const instancesFilter = ref('')
const instancesHostFilter = ref<number | ''>('')
const instancesSearch = ref('')
const showExpiring = ref(false)
const showDateColumns = ref(false)  // 默认隐藏购买日期和到期时间列
const selectedInstanceIds = ref<number[]>([])

// 扣费记录
const records = ref<any[]>([])
const recordsLoading = ref(false)
const recordsPage = ref(1)
const recordsPageSize = ref(100)
const recordsTotal = ref(0)

// 充值记录
const rechargeRecords = ref<any[]>([])
const rechargeRecordsLoading = ref(false)
const rechargeRecordsPage = ref(1)
const rechargeRecordsPageSize = ref(100)
const rechargeRecordsTotal = ref(0)
const rechargeRecordsFilter = ref('')
const syncingRecordId = ref<number | null>(null)

// 操作弹窗
const showActionModal = ref(false)
const actionType = ref<'suspend' | 'unsuspend' | 'extend' | 'deleteRefund' | 'deleteRefundDatabaseOnly' | 'applyDiscount'>('suspend')
const actionTarget = ref<any>(null)
const actionLoading = ref(false)
const actionForm = ref({
  reason: '',
  days: 7,
  freeExtend: false,
  amount: 0,
  refundType: 'remaining' as 'remaining' | 'full',
  affCode: ''
})

// 修改价格弹窗
const showPriceModal = ref(false)
const priceTarget = ref<any>(null)
const priceLoading = ref(false)
const pricePreviewLoading = ref(false)
const pricePreview = ref<{
  oldPrice: number
  newPrice: number
  billingCycle: number
  remainingDays: number
  priceDiff: number
  discountRate: number
  userBalance: number
  instanceVersion: number
} | null>(null)
const priceForm = ref({
  newPrice: 0,
  settleBalance: true
})

// 批量修改价格弹窗
const showBatchPriceModal = ref(false)
const batchPriceLoading = ref(false)
const batchPricePreviewLoading = ref(false)
const batchPricePreview = ref<BatchPriceUpdatePreview | null>(null)
const batchPriceForm = ref({
  newPrice: 0,
  settleBalance: true
})

function isValidPriceInput(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

// 计算实际续费价格（应用 AFF 折扣后）
const actualRenewPrice = computed(() => {
  if (!priceTarget.value) return { old: 0, new: 0 }
  const inst = priceTarget.value
  const discountRate = inst.affDiscountRate || 0
  const oldPrice = inst.billingPrice || 0
  const newPrice = priceForm.value.newPrice
  
  return {
    old: calculateDiscountedPrice(oldPrice, discountRate),
    new: calculateDiscountedPrice(newPrice, discountRate)
  }
})

// 计算价格差价（使用公共方法，确保与后端一致）
const priceDiff = computed(() => {
  return pricePreview.value?.priceDiff || 0
})

// 切换方案弹窗
const showUpgradeModal = ref(false)
const upgradeTarget = ref<any>(null)
const upgradeLoading = ref(false)
const upgradeSubmitting = ref(false)
const upgradeData = ref<{
  currentPlan: {
    id: number
    name: string
    price: number
    billingCycle: number
    monthlyPrice: number
    cpu: number
    memory: number
    disk: number
  } | null
  remainingDays: number
  availablePlans: Array<{
    id: number
    name: string
    description: string | null
    price: number
    billingCycle: number
    monthlyPrice: number
    priceDiff: number
    cpu: number
    memory: number
    disk: number
  }>
  userBalance: number
}>({
  currentPlan: null,
  remainingDays: 0,
  availablePlans: [],
  userBalance: 0
})
const selectedPlanId = ref<number | null>(null)

// 计算选中方案的补差价
const upgradePriceDiff = computed(() => {
  if (!upgradeData.value.currentPlan || !selectedPlanId.value) return 0
  const newPlan = upgradeData.value.availablePlans.find(p => p.id === selectedPlanId.value)
  if (!newPlan) return 0
  return newPlan.priceDiff
})

const selectedInstanceIdSet = computed(() => new Set(selectedInstanceIds.value))

const selectableInstances = computed(() => {
  return instances.value.filter(inst => inst.status !== 'deleted')
})

const selectedInstances = computed(() => {
  const selectedIds = selectedInstanceIdSet.value
  return instances.value.filter(inst => selectedIds.has(inst.id))
})

const selectedInstancesCount = computed(() => selectedInstanceIds.value.length)

const allCurrentPageSelected = computed(() => {
  return selectableInstances.value.length > 0 &&
    selectableInstances.value.every(inst => selectedInstanceIdSet.value.has(inst.id))
})

const someCurrentPageSelected = computed(() => {
  return selectableInstances.value.some(inst => selectedInstanceIdSet.value.has(inst.id))
})

const selectedPriceBaseline = computed(() => {
  if (selectedInstances.value.length === 0) return 0
  const firstSelected = selectedInstances.value.find(inst => typeof inst.billingPrice === 'number')
  return firstSelected?.billingPrice || 0
})

const batchPriceExpectations = computed(() => {
  return batchPricePreview.value?.items
    .filter(item => typeof item.instanceVersion === 'number')
    .map(item => ({ instanceId: item.id, version: item.instanceVersion! })) || []
})

const batchPricePreviewHasVersionSnapshot = computed(() => {
  if (!batchPricePreview.value) return false
  return batchPricePreview.value.items.every(item => item.status === 'failed' || typeof item.instanceVersion === 'number')
})

const periodComparisonCards = computed<PeriodComparisonCard[]>(() => {
  if (!overview.value) return []

  return [
    {
      key: 'total',
      label: t('admin.billing.overviewPeriods.total'),
      revenueAmount: overview.value.totalRevenue,
      rechargeAmount: overview.value.recharge.totalAmount,
      rechargeCount: overview.value.recharge.totalCount,
      badgeClass: 'bg-themed-tertiary text-themed',
      iconClass: 'text-slate-600 dark:text-slate-300'
    },
    {
      key: 'thisMonth',
      label: t('admin.billing.overviewPeriods.thisMonth'),
      revenueAmount: overview.value.thisMonthRevenue,
      rechargeAmount: overview.value.recharge.thisMonthAmount,
      rechargeCount: overview.value.recharge.thisMonthCount,
      badgeClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      iconClass: 'text-emerald-600 dark:text-emerald-300'
    },
    {
      key: 'today',
      label: t('admin.billing.overviewPeriods.today'),
      revenueAmount: overview.value.todayRevenue,
      rechargeAmount: overview.value.recharge.todayAmount,
      rechargeCount: overview.value.recharge.todayCount,
      badgeClass: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
      iconClass: 'text-cyan-600 dark:text-cyan-300'
    }
  ]
})

const revenueMixRows = computed<RevenueMixRow[]>(() => {
  if (!overview.value) return []

  const direct = overview.value.revenueMix.direct
  const hosted = overview.value.revenueMix.hosted

  return [
    {
      key: 'total',
      label: t('admin.billing.overviewPeriods.total'),
      directAmount: direct.totalAmount,
      hostedAmount: hosted.totalAmount,
      directRatio: calculateRatio(direct.totalAmount, direct.totalAmount + hosted.totalAmount),
      hostedRatio: calculateRatio(hosted.totalAmount, direct.totalAmount + hosted.totalAmount)
    },
    {
      key: 'thisMonth',
      label: t('admin.billing.overviewPeriods.thisMonth'),
      directAmount: direct.thisMonthAmount,
      hostedAmount: hosted.thisMonthAmount,
      directRatio: calculateRatio(direct.thisMonthAmount, direct.thisMonthAmount + hosted.thisMonthAmount),
      hostedRatio: calculateRatio(hosted.thisMonthAmount, direct.thisMonthAmount + hosted.thisMonthAmount)
    },
    {
      key: 'today',
      label: t('admin.billing.overviewPeriods.today'),
      directAmount: direct.todayAmount,
      hostedAmount: hosted.todayAmount,
      directRatio: calculateRatio(direct.todayAmount, direct.todayAmount + hosted.todayAmount),
      hostedRatio: calculateRatio(hosted.todayAmount, direct.todayAmount + hosted.todayAmount)
    }
  ]
})

const instanceStatusCards = computed<MetricCard[]>(() => {
  if (!overview.value) return []

  return [
    {
      key: 'active',
      label: t('admin.billing.activeInstances'),
      value: overview.value.activePaidInstancesCount,
      format: 'count',
      icon: 'pulse',
      toneClass: 'text-emerald-600 dark:text-emerald-300',
      surfaceClass: 'bg-emerald-500/10 ring-1 ring-emerald-500/20',
      progress: calculateRatio(overview.value.activePaidInstancesCount, overview.value.paidInstancesCount)
    },
    {
      key: 'suspended',
      label: t('admin.billing.suspendedInstances'),
      value: overview.value.suspendedCount,
      format: 'count',
      icon: 'ban',
      toneClass: 'text-rose-600 dark:text-rose-300',
      surfaceClass: 'bg-rose-500/10 ring-1 ring-rose-500/20',
      progress: calculateRatio(overview.value.suspendedCount, overview.value.paidInstancesCount)
    },
    {
      key: 'expiring',
      label: t('admin.billing.expiringInstances'),
      value: overview.value.expiringCount,
      format: 'count',
      icon: 'clock',
      toneClass: 'text-amber-600 dark:text-amber-300',
      surfaceClass: 'bg-amber-500/10 ring-1 ring-amber-500/20',
      progress: calculateRatio(overview.value.expiringCount, overview.value.paidInstancesCount)
    }
  ]
})

const affCards = computed<MetricCard[]>(() => {
  if (!overview.value) return []

  return [
    {
      key: 'aff-total',
      label: t('admin.billing.totalAffCommission'),
      value: overview.value.aff.totalCommission,
      format: 'money',
      icon: 'sparkles',
      toneClass: 'text-sky-600 dark:text-sky-300',
      surfaceClass: 'bg-sky-500/10 ring-1 ring-sky-500/20'
    },
    {
      key: 'aff-month',
      label: t('admin.billing.thisMonthAff'),
      value: overview.value.aff.thisMonthCommission,
      format: 'money',
      icon: 'sparkles',
      toneClass: 'text-emerald-600 dark:text-emerald-300',
      surfaceClass: 'bg-emerald-500/10 ring-1 ring-emerald-500/20'
    },
    {
      key: 'aff-converted',
      label: t('admin.billing.affConverted'),
      value: overview.value.aff.totalConverted,
      format: 'money',
      icon: 'wallet',
      toneClass: 'text-slate-700 dark:text-slate-200',
      surfaceClass: 'bg-slate-500/10 ring-1 ring-slate-500/20'
    },
    {
      key: 'aff-pending',
      label: t('admin.billing.affPendingConvert'),
      value: overview.value.aff.pendingConvertCount,
      format: 'count',
      icon: 'clock',
      toneClass: 'text-amber-600 dark:text-amber-300',
      surfaceClass: 'bg-amber-500/10 ring-1 ring-amber-500/20'
    }
  ]
})

const refundRate = computed(() => {
  if (!overview.value) return 0
  return calculateRatio(overview.value.totalRefunds, overview.value.totalRevenue)
})

const hostedRevenueShare = computed(() => {
  if (!overview.value) return 0
  return calculateRatio(overview.value.revenueMix.hosted.totalAmount, overview.value.totalRevenue)
})

const activeInstanceShare = computed(() => {
  if (!overview.value) return 0
  return calculateRatio(overview.value.activePaidInstancesCount, overview.value.paidInstancesCount)
})

const monthlyRevenueChange = computed(() => {
  if (!overview.value) return null
  return calculateChange(overview.value.thisMonthRevenue, overview.value.lastMonthRevenue)
})

function loadTabData(tab: BillingTab) {
  if (tab === 'overview' && !overview.value) {
    loadOverview()
  }
  if (tab === 'instances' && instances.value.length === 0) {
    loadInstances()
  }
  if (tab === 'records' && records.value.length === 0) {
    loadRecords()
  }
  if (tab === 'rechargeRecords' && rechargeRecords.value.length === 0) {
    loadRechargeRecords()
  }
}

onMounted(() => {
  loadTabData(activeTab.value)
})

async function loadOverview() {
  overviewLoading.value = true
  try {
    const res = await api.admin.getBillingOverview()
    overview.value = res.overview
  } catch (err: any) {
    toast.error(t('admin.billing.loadFailed') + ': ' + err.message)
  } finally {
    overviewLoading.value = false
  }
}

async function loadInstances() {
  instancesLoading.value = true
  try {
    const res = await api.admin.getBillingInstances({
      page: instancesPage.value,
      pageSize: instancesPageSize.value,
      status: instancesFilter.value || undefined,
      expiring: showExpiring.value || undefined,
      hostId: instancesHostFilter.value || undefined,
      search: instancesSearch.value.trim() || undefined
    })
    instances.value = res.instances || []
    instancesTotal.value = res.total
    const currentPageSelectableIds = new Set(instances.value.filter(inst => inst.status !== 'deleted').map(inst => inst.id))
    selectedInstanceIds.value = selectedInstanceIds.value.filter(id => currentPageSelectableIds.has(id))
    // 从返回中获取有付费实例的节点列表
    if (res.hosts) {
      hosts.value = res.hosts
    }
  } catch (err: any) {
    toast.error(t('admin.billing.loadInstancesFailed') + ': ' + err.message)
  } finally {
    instancesLoading.value = false
  }
}

async function loadRecords() {
  recordsLoading.value = true
  try {
    const res = await api.admin.getBillingRecords({
      page: recordsPage.value,
      pageSize: recordsPageSize.value
    })
    records.value = res.records || []
    recordsTotal.value = res.total
  } catch (err: any) {
    toast.error(t('admin.billing.loadRecordsFailed') + ': ' + err.message)
  } finally {
    recordsLoading.value = false
  }
}

async function loadRechargeRecords() {
  rechargeRecordsLoading.value = true
  try {
    const res = await api.admin.getRechargeRecords({
      page: rechargeRecordsPage.value,
      pageSize: rechargeRecordsPageSize.value,
      status: rechargeRecordsFilter.value || undefined
    })
    rechargeRecords.value = res.records || []
    rechargeRecordsTotal.value = res.total
  } catch (err: any) {
    toast.error(t('admin.billing.loadRechargeRecordsFailed') + ': ' + err.message)
  } finally {
    rechargeRecordsLoading.value = false
  }
}

async function syncRechargeRecord(record: any) {
  if (syncingRecordId.value) return
  
  syncingRecordId.value = record.id
  try {
    const res = await api.admin.syncRechargeRecord(record.id)
    if (res.synced) {
      toast.success(t('admin.billing.syncSuccess'))
      // 并行刷新充值记录和概览
      await Promise.all([loadRechargeRecords(), loadOverview()])
    } else {
      toast.info(res.message)
    }
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    syncingRecordId.value = null
  }
}

function switchTab(tab: BillingTab) {
  activeTab.value = tab
  if (tab === 'paymentProviders') {
    hasVisitedPaymentProviders.value = true
  }
  if (tab === 'affConversions') {
    hasVisitedAffConversions.value = true
  }
  router.replace({
    path: route.path,
    query: tab === 'overview'
      ? { ...route.query, tab: undefined }
      : { ...route.query, tab }
  })
  loadTabData(tab)
}

watch(
  () => route.query.tab,
  (tab) => {
    const nextTab = normalizeTab(tab)
    if (nextTab !== activeTab.value) {
      switchTab(nextTab)
    }
  }
)

function openActionModal(type: 'suspend' | 'unsuspend' | 'extend' | 'deleteRefund' | 'deleteRefundDatabaseOnly' | 'applyDiscount', instance: any) {
  actionType.value = type
  actionTarget.value = instance
  actionForm.value = {
    reason: '',
    days: 7,
    freeExtend: false,
    amount: 0,
    refundType: 'remaining',
    affCode: ''
  }
  showActionModal.value = true
}

async function executeAction() {
  if (!actionTarget.value) return
  
  actionLoading.value = true
  try {
    const id = actionTarget.value.id
    
    switch (actionType.value) {
      case 'suspend':
        await api.admin.suspendInstance(id, actionForm.value.reason)
        toast.success(t('admin.billing.suspendSuccess'))
        break
      case 'unsuspend':
        await api.admin.unsuspendInstance(id)
        toast.success(t('admin.billing.unsuspendSuccess'))
        break
      case 'extend':
        await api.admin.extendInstance(id, actionForm.value.days, actionForm.value.reason, actionForm.value.freeExtend)
        toast.success(t('admin.billing.extendSuccess'))
        break
      case 'deleteRefund':
        if (!actionForm.value.reason.trim()) {
          toast.error(t('admin.billing.deleteRefundReasonRequired'))
          actionLoading.value = false
          return
        }
        {
          const result = await api.admin.deleteAndRefundInstance(id, actionForm.value.refundType, actionForm.value.reason)
          toast.success(result.message || t('admin.billing.deleteRefundSuccess'))
        }
        break
      case 'deleteRefundDatabaseOnly':
        if (!actionForm.value.reason.trim()) {
          toast.error(t('admin.billing.deleteRefundReasonRequired'))
          actionLoading.value = false
          return
        }
        {
          const result = await api.admin.deleteAndRefundInstance(id, actionForm.value.refundType, actionForm.value.reason, true)
          toast.success(result.message || t('admin.billing.deleteRefundDatabaseOnlySuccess'))
        }
        break
      case 'applyDiscount':
        if (!actionForm.value.affCode.trim()) {
          toast.error(t('admin.billing.affCodeRequired'))
          actionLoading.value = false
          return
        }
        await api.admin.applyAffCode(id, actionForm.value.affCode.trim())
        toast.success(t('admin.billing.applyDiscountSuccess'))
        break
    }
    
    showActionModal.value = false
    // 并行刷新实例列表和概览
    await Promise.all([loadInstances(), loadOverview()])
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    actionLoading.value = false
  }
}

// 打开修改价格弹窗
function openPriceModal(instance: any) {
  priceTarget.value = instance
  pricePreviewRequestId += 1
  priceForm.value = {
    newPrice: instance.billingPrice || 0,
    settleBalance: true
  }
  pricePreview.value = null
  showPriceModal.value = true
}

let pricePreviewTimer: ReturnType<typeof setTimeout> | null = null
let pricePreviewRequestId = 0

async function loadPricePreview() {
  if (!showPriceModal.value || !priceTarget.value) return
  if (!isValidPriceInput(priceForm.value.newPrice)) {
    pricePreviewRequestId += 1
    pricePreview.value = null
    pricePreviewLoading.value = false
    return
  }

  const requestId = ++pricePreviewRequestId
  pricePreviewLoading.value = true
  try {
    const res = await api.admin.previewInstancePriceUpdate(
      priceTarget.value.id,
      priceForm.value.newPrice,
      priceForm.value.settleBalance
    )
    if (requestId !== pricePreviewRequestId) return
    pricePreview.value = res
  } catch (err: any) {
    if (requestId !== pricePreviewRequestId) return
    pricePreview.value = null
    toast.error(err.message)
  } finally {
    if (requestId === pricePreviewRequestId) {
      pricePreviewLoading.value = false
    }
  }
}

watch(
  () => [showPriceModal.value, priceTarget.value?.id, priceForm.value.newPrice, priceForm.value.settleBalance],
  ([visible]) => {
    if (pricePreviewTimer) {
      clearTimeout(pricePreviewTimer)
      pricePreviewTimer = null
    }

    if (!visible || !priceTarget.value) {
      if (!visible) {
        pricePreviewRequestId += 1
        pricePreviewLoading.value = false
      }
      if (!visible) {
        pricePreview.value = null
      }
      return
    }

    pricePreviewTimer = setTimeout(() => {
      loadPricePreview()
    }, 150)
  }
)

function toggleSelectAllCurrentPage() {
  const selected = new Set(selectedInstanceIds.value)
  if (allCurrentPageSelected.value) {
    for (const inst of selectableInstances.value) {
      selected.delete(inst.id)
    }
  } else {
    for (const inst of selectableInstances.value) {
      selected.add(inst.id)
    }
  }
  selectedInstanceIds.value = Array.from(selected)
}

function openBatchPriceModal() {
  if (selectedInstanceIds.value.length === 0) {
    toast.warning(t('admin.billing.batchPriceNoSelection'))
    return
  }

  batchPricePreviewRequestId += 1
  batchPriceForm.value = {
    newPrice: selectedPriceBaseline.value,
    settleBalance: true
  }
  batchPricePreview.value = null
  showBatchPriceModal.value = true
}

let batchPricePreviewTimer: ReturnType<typeof setTimeout> | null = null
let batchPricePreviewRequestId = 0

async function loadBatchPricePreview() {
  if (!showBatchPriceModal.value || selectedInstanceIds.value.length === 0) return
  if (!isValidPriceInput(batchPriceForm.value.newPrice)) {
    batchPricePreviewRequestId += 1
    batchPricePreview.value = null
    batchPricePreviewLoading.value = false
    return
  }

  const requestId = ++batchPricePreviewRequestId
  batchPricePreviewLoading.value = true
  try {
    const res = await api.admin.previewBatchInstancePriceUpdate(
      selectedInstanceIds.value,
      batchPriceForm.value.newPrice,
      batchPriceForm.value.settleBalance
    )
    if (requestId !== batchPricePreviewRequestId) return
    batchPricePreview.value = res
  } catch (err: any) {
    if (requestId !== batchPricePreviewRequestId) return
    batchPricePreview.value = err?.preview || null
    toast.error(err.message)
  } finally {
    if (requestId === batchPricePreviewRequestId) {
      batchPricePreviewLoading.value = false
    }
  }
}

watch(
  () => [showBatchPriceModal.value, selectedInstanceIds.value.join(','), batchPriceForm.value.newPrice, batchPriceForm.value.settleBalance],
  ([visible]) => {
    if (batchPricePreviewTimer) {
      clearTimeout(batchPricePreviewTimer)
      batchPricePreviewTimer = null
    }

    if (!visible || selectedInstanceIds.value.length === 0) {
      if (!visible) {
        batchPricePreviewRequestId += 1
        batchPricePreviewLoading.value = false
      }
      if (!visible) {
        batchPricePreview.value = null
      }
      return
    }

    batchPricePreviewTimer = setTimeout(() => {
      loadBatchPricePreview()
    }, 150)
  }
)

async function submitBatchUpdatePrice() {
  if (selectedInstanceIds.value.length === 0) return

  batchPriceLoading.value = true
  try {
    const res = await api.admin.updateBatchInstancePrice(
      selectedInstanceIds.value,
      batchPriceForm.value.newPrice,
      batchPriceForm.value.settleBalance,
      batchPriceExpectations.value
    )
    toast.success(res.message)
    batchPricePreview.value = res.preview
    showBatchPriceModal.value = false
    selectedInstanceIds.value = []
    await Promise.all([loadInstances(), loadOverview()])
  } catch (err: any) {
    batchPricePreview.value = err?.preview || batchPricePreview.value
    toast.error(err.message)
  } finally {
    batchPriceLoading.value = false
  }
}

// 提交修改价格
async function submitUpdatePrice() {
  if (!priceTarget.value) return
  
  priceLoading.value = true
  try {
    const res = await api.admin.updateInstancePrice(
      priceTarget.value.id,
      priceForm.value.newPrice,
      priceForm.value.settleBalance,
      pricePreview.value?.instanceVersion
    )
    toast.success(res.message)
    showPriceModal.value = false
    // 并行刷新实例列表和概览
    await Promise.all([loadInstances(), loadOverview()])
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    priceLoading.value = false
  }
}

// 打开切换方案弹窗
async function openUpgradeModal(instance: any) {
  upgradeTarget.value = instance
  selectedPlanId.value = null
  upgradeData.value = { currentPlan: null, remainingDays: 0, availablePlans: [], userBalance: 0 }
  showUpgradeModal.value = true
  upgradeLoading.value = true
  
  try {
    const res = await api.admin.getAvailablePlans(instance.id)
    upgradeData.value = res
  } catch (err: any) {
    toast.error(err.message)
    showUpgradeModal.value = false
  } finally {
    upgradeLoading.value = false
  }
}

// 执行升级
async function executeUpgrade() {
  if (!upgradeTarget.value || !selectedPlanId.value) return
  
  upgradeSubmitting.value = true
  try {
    const res = await api.admin.upgradePlan(upgradeTarget.value.id, selectedPlanId.value)
    toast.success(res.message)
    showUpgradeModal.value = false
    // 并行刷新实例列表和概览
    await Promise.all([loadInstances(), loadOverview()])
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    upgradeSubmitting.value = false
  }
}

// 格式化计费周期
function formatBillingCycle(cycle: number): string {
  const map: Record<number, string> = {
    1: t('admin.billing.monthly'),
    3: t('admin.billing.quarterly'),
    6: t('admin.billing.semiAnnual'),
    12: t('admin.billing.yearly')
  }
  return map[cycle] || `${cycle} ${t('admin.billing.months')}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const countFormatter = new Intl.NumberFormat('zh-CN')

function formatMoney(amount: number): string {
  return `¥${currencyFormatter.format(amount || 0)}`
}

function formatCount(value: number): string {
  return countFormatter.format(value || 0)
}

function formatPercent(value: number): string {
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${rounded}%`
}

function formatSignedPercent(value: number | null): string {
  if (value === null) return '--'
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${value > 0 ? '+' : ''}${rounded}%`
}

function calculateRatio(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (part / total) * 100))
}

function calculateChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null
  }
  return ((current - previous) / previous) * 100
}

// 获取扣费记录类型标签
function getRecordTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    newPurchase: t('admin.billing.recordTypes.newPurchase'),
    renew: t('admin.billing.recordTypes.renew'),
    upgrade: t('admin.billing.recordTypes.upgrade'),
    downgrade: t('admin.billing.recordTypes.downgrade'),
    refund: t('admin.billing.recordTypes.refund'),
    transfer_fee: t('admin.billing.recordTypes.transfer_fee')
  }
  return labels[type] || type
}

function getStatusBadge(status: string) {
  const map: Record<string, string> = {
    running: 'badge-success',
    stopped: 'badge-warning',
    suspended: 'badge-error',
    creating: 'badge-info'
  }
  return map[status] || ''
}

function getBatchPriceItemStatusClass(status: BatchPriceUpdateItemStatus): string {
  const map: Record<BatchPriceUpdateItemStatus, string> = {
    ready: 'text-blue-600 dark:text-blue-400',
    unchanged: 'text-themed-muted',
    failed: 'text-red-600 dark:text-red-400'
  }
  return map[status]
}

function getBatchPriceItemStatusLabel(status: BatchPriceUpdateItemStatus): string {
  const map: Record<BatchPriceUpdateItemStatus, string> = {
    ready: t('admin.billing.batchPriceStatusReady'),
    unchanged: t('admin.billing.batchPriceStatusUnchanged'),
    failed: t('admin.billing.batchPriceStatusFailed')
  }
  return map[status]
}

function formatPriceDiff(value: number): string {
  if (value > 0) return `+${formatMoney(value)}`
  if (value < 0) return `-${formatMoney(Math.abs(value))}`
  return formatMoney(0)
}

const instancesTotalPages = computed(() => Math.ceil(instancesTotal.value / instancesPageSize.value))
const recordsTotalPages = computed(() => Math.ceil(recordsTotal.value / recordsPageSize.value))
const rechargeRecordsTotalPages = computed(() => Math.ceil(rechargeRecordsTotal.value / rechargeRecordsPageSize.value))

function getRechargeStatusBadge(status: string) {
  const map: Record<string, string> = {
    pending: 'badge-warning',
    completed: 'badge-success',
    cancelled: 'badge-ghost',
    failed: 'badge-error'
  }
  return map[status] || ''
}

// 获取支付渠道显示文本（渠道名 - 支付方式）
function getPayChannelDisplay(rec: any): string {
  const providerName = rec.provider?.displayName || rec.provider?.name || ''
  const methodCode = rec.payMethod || ''
  const methodKey = methodCode ? `wallet.paymentMethods.${methodCode}` : ''
  const methodLabel = methodKey ? t(methodKey) : ''
  // 如果翻译不存在（返回原 key），则使用原始值
  const method = methodLabel === methodKey ? methodCode : methodLabel
  
  if (providerName && method) {
    return `${method} - ${providerName}`
  } else if (providerName) {
    return providerName
  } else if (method) {
    return method
  }
  return '-'
}

function getRechargePaymentDetailsDisplay(rec: any): string {
  if (rec.actualPaymentMethod) {
    const methodKey = `wallet.paymentMethods.${rec.actualPaymentMethod}`
    const translated = t(methodKey)
    return translated === methodKey ? rec.actualPaymentMethod : translated
  }
  return '-'
}

function getRechargeCreditLabelKey(status: string): string {
  return status === 'completed' ? 'admin.billing.actualAmount' : 'admin.billing.estimatedAmount'
}

function getRechargeGatewayStatusText(rec: any): string {
  return rec.status === 'pending' && rec.gatewayStatusDescription ? rec.gatewayStatusDescription : ''
}

function copyToClipboard(text: string) {
  window.navigator.clipboard.writeText(text)
  toast.success(t('common.copied'))
}
</script>

<template>
  <div class="animate-fade-in">
    <!-- 页面头部 -->
    <div class="page-header">
      <h1 class="page-title">{{ $t('admin.billing.title') }}</h1>
      <p class="text-sm text-themed-muted mt-1">{{ $t('admin.billing.description') }}</p>
    </div>

    <!-- Tab 切换 -->
    <div class="mb-6 overflow-x-auto border-b border-themed">
      <nav class="flex min-w-max gap-5">
        <button
          v-for="tab in billingTabs"
          :key="tab"
          class="border-b-2 px-1 pb-3 text-sm font-medium transition-colors"
          :class="activeTab === tab
            ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
            : 'border-transparent text-themed-muted hover:text-themed'"
          @click="switchTab(tab)"
        >
          {{ $t(`admin.billing.tabs.${tab}`) }}
        </button>
      </nav>
    </div>

    <!-- 概览 Tab -->
    <div v-show="activeTab === 'overview'">
      <div v-if="overviewLoading" class="space-y-5">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div v-for="i in 4" :key="`overview-kpi-${i}`" class="card h-36 animate-pulse p-5">
            <div class="h-4 w-20 rounded bg-themed-secondary"></div>
            <div class="mt-5 h-8 w-36 rounded bg-themed-secondary"></div>
            <div class="mt-4 h-3 w-28 rounded bg-themed-secondary"></div>
          </div>
        </div>
        <div class="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div class="card h-80 animate-pulse p-5">
            <div class="h-5 w-28 rounded bg-themed-secondary"></div>
            <div class="mt-6 space-y-5">
              <div v-for="i in 3" :key="`overview-mix-${i}`" class="h-16 rounded bg-themed-secondary"></div>
            </div>
          </div>
          <div class="card h-80 animate-pulse p-5">
            <div class="h-5 w-28 rounded bg-themed-secondary"></div>
            <div class="mt-6 h-24 rounded bg-themed-secondary"></div>
            <div class="mt-5 space-y-3">
              <div v-for="i in 3" :key="`overview-health-${i}`" class="h-12 rounded bg-themed-secondary"></div>
            </div>
          </div>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div v-for="i in 4" :key="`overview-aff-${i}`" class="card h-28 animate-pulse p-5">
            <div class="h-4 w-24 rounded bg-themed-secondary"></div>
            <div class="mt-5 h-7 w-32 rounded bg-themed-secondary"></div>
          </div>
        </div>
      </div>

      <template v-else-if="overview">
        <div class="space-y-6">
          <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article class="card min-w-0 p-5 sm:p-6 xl:col-span-2">
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-themed-muted">{{ $t('admin.billing.netRevenueLabel') }}</p>
                  <p class="mt-3 break-words text-3xl font-semibold leading-tight tracking-normal text-themed md:text-4xl">
                    {{ formatMoney(overview.netRevenue) }}
                  </p>
                </div>
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <BillingOverviewIcon name="wallet" class="h-5 w-5" />
                </div>
              </div>

              <div class="mt-6 grid gap-4 sm:grid-cols-2">
                <div class="min-w-0 border-l-2 border-sky-500/40 pl-3">
                  <p class="text-xs text-themed-muted">{{ $t('admin.billing.todayRevenue') }}</p>
                  <p class="mt-1 break-words text-xl font-semibold text-themed">{{ formatMoney(overview.todayRevenue) }}</p>
                  <p class="mt-1 text-xs text-themed-muted">{{ $t('admin.billing.todayRecharge') }} {{ formatMoney(overview.recharge.todayAmount) }}</p>
                </div>
                <div class="min-w-0 border-l-2 border-emerald-500/40 pl-3">
                  <p class="text-xs text-themed-muted">{{ $t('admin.billing.thisMonthRevenue') }}</p>
                  <p class="mt-1 break-words text-xl font-semibold text-themed">{{ formatMoney(overview.thisMonthRevenue) }}</p>
                  <p class="mt-1 text-xs" :class="monthlyRevenueChange !== null && monthlyRevenueChange < 0 ? 'text-rose-500 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'">
                    {{ $t('admin.billing.thisMonthVsLastMonth') }} {{ formatSignedPercent(monthlyRevenueChange) }}
                  </p>
                </div>
              </div>
            </article>

            <article class="card min-w-0 p-5">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm text-themed-muted">{{ $t('admin.billing.totalRevenue') }}</p>
                  <p class="mt-2 break-words text-2xl font-semibold text-themed">{{ formatMoney(overview.totalRevenue) }}</p>
                </div>
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <BillingOverviewIcon name="chart" class="h-5 w-5" />
                </div>
              </div>
              <p class="mt-3 text-xs text-themed-muted">{{ $t('admin.billing.todayRevenue') }} {{ formatMoney(overview.todayRevenue) }}</p>
            </article>

            <article class="card min-w-0 p-5">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm text-themed-muted">{{ $t('admin.billing.totalRecharge') }}</p>
                  <p class="mt-2 break-words text-2xl font-semibold text-themed">{{ formatMoney(overview.recharge.totalAmount) }}</p>
                </div>
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                  <BillingOverviewIcon name="wallet" class="h-5 w-5" />
                </div>
              </div>
              <p class="mt-3 text-xs text-themed-muted">{{ formatCount(overview.recharge.totalCount) }} {{ $t('admin.billing.orders') }}</p>
            </article>

            <article class="card min-w-0 p-5">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm text-themed-muted">{{ $t('admin.billing.hostedRevenueShare') }}</p>
                  <p class="mt-2 break-words text-2xl font-semibold text-themed">{{ formatPercent(hostedRevenueShare) }}</p>
                </div>
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300">
                  <BillingOverviewIcon name="cloud" class="h-5 w-5" />
                </div>
              </div>
              <p class="mt-3 text-xs text-themed-muted">{{ formatMoney(overview.revenueMix.hosted.totalAmount) }}</p>
            </article>

            <article class="card min-w-0 p-5">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm text-themed-muted">{{ $t('admin.billing.totalRefunds') }}</p>
                  <p class="mt-2 break-words text-2xl font-semibold text-themed">{{ formatMoney(overview.totalRefunds) }}</p>
                </div>
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-300">
                  <BillingOverviewIcon name="ban" class="h-5 w-5" />
                </div>
              </div>
              <p class="mt-3 text-xs text-themed-muted">{{ formatPercent(refundRate) }}</p>
            </article>
          </section>

          <section>
            <div class="mb-3 flex items-center justify-between gap-4">
              <div>
                <h2 class="text-base font-semibold text-themed">{{ $t('admin.billing.rechargeLabel') }} / {{ $t('admin.billing.revenueLabel') }}</h2>
                <p class="mt-1 text-sm text-themed-muted">{{ $t('admin.billing.overviewPeriods.total') }} · {{ $t('admin.billing.overviewPeriods.thisMonth') }} · {{ $t('admin.billing.overviewPeriods.today') }}</p>
              </div>
            </div>

            <div class="grid gap-4 lg:grid-cols-3">
              <article
                v-for="period in periodComparisonCards"
                :key="period.key"
                class="card min-w-0 p-5"
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <span class="inline-flex rounded-md px-2.5 py-1 text-xs font-medium" :class="period.badgeClass">
                      {{ period.label }}
                    </span>
                    <p class="mt-3 text-xs text-themed-muted">{{ $t('admin.billing.rechargeLabel') }} / {{ $t('admin.billing.revenueLabel') }}</p>
                  </div>
                  <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-themed-tertiary" :class="period.iconClass">
                    <BillingOverviewIcon name="wallet" class="h-5 w-5" />
                  </div>
                </div>

                <dl class="mt-5 divide-y divide-themed">
                  <div class="flex items-center justify-between gap-4 pb-3">
                    <dt class="text-sm text-themed-muted">{{ $t('admin.billing.rechargeLabel') }}</dt>
                    <dd class="min-w-0 text-right">
                      <div class="break-words text-lg font-semibold text-themed">{{ formatMoney(period.rechargeAmount) }}</div>
                      <div class="mt-1 text-xs text-themed-muted">{{ formatCount(period.rechargeCount) }} {{ $t('admin.billing.orders') }}</div>
                    </dd>
                  </div>
                  <div class="flex items-center justify-between gap-4 pt-3">
                    <dt class="text-sm text-themed-muted">{{ $t('admin.billing.revenueLabel') }}</dt>
                    <dd class="min-w-0 break-words text-right text-lg font-semibold text-themed">{{ formatMoney(period.revenueAmount) }}</dd>
                  </div>
                </dl>
              </article>
            </div>
          </section>

          <div class="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
            <section class="card min-w-0 p-5">
              <div class="flex flex-col gap-3 border-b border-themed pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <h2 class="text-base font-semibold text-themed">{{ $t('admin.billing.revenueBreakdownTitle') }}</h2>
                  <p class="mt-1 text-sm text-themed-muted">{{ $t('admin.billing.directRevenue') }} / {{ $t('admin.billing.hostedRevenue') }}</p>
                </div>
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <BillingOverviewIcon name="chart" class="h-5 w-5" />
                </div>
              </div>

              <div class="mt-5 grid gap-4 sm:grid-cols-2">
                <div class="min-w-0 border-l-2 border-sky-500 pl-3">
                  <p class="text-sm text-themed-muted">{{ $t('admin.billing.directRevenue') }}</p>
                  <p class="mt-1 break-words text-2xl font-semibold text-themed">{{ formatMoney(overview.revenueMix.direct.totalAmount) }}</p>
                  <p class="mt-1 text-xs text-themed-muted">{{ formatPercent(revenueMixRows[0]?.directRatio || 0) }}</p>
                </div>
                <div class="min-w-0 border-l-2 border-amber-500 pl-3">
                  <p class="text-sm text-themed-muted">{{ $t('admin.billing.hostedRevenue') }}</p>
                  <p class="mt-1 break-words text-2xl font-semibold text-themed">{{ formatMoney(overview.revenueMix.hosted.totalAmount) }}</p>
                  <p class="mt-1 text-xs text-themed-muted">{{ formatPercent(revenueMixRows[0]?.hostedRatio || 0) }}</p>
                </div>
              </div>

              <div class="mt-5 h-2.5 overflow-hidden rounded-full bg-themed-tertiary">
                <div class="flex h-full w-full">
                  <div class="bg-sky-500" :style="{ width: `${revenueMixRows[0]?.directRatio || 0}%` }"></div>
                  <div class="bg-amber-500" :style="{ width: `${revenueMixRows[0]?.hostedRatio || 0}%` }"></div>
                </div>
              </div>

              <div class="mt-5 divide-y divide-themed">
                <div v-for="row in revenueMixRows" :key="row.key" class="py-4 first:pt-0 last:pb-0">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0">
                      <p class="font-medium text-themed">{{ row.label }}</p>
                      <p class="mt-1 text-xs text-themed-muted">{{ $t('admin.billing.revenueLabel') }} {{ formatMoney(row.directAmount + row.hostedAmount) }}</p>
                    </div>
                    <div class="flex flex-wrap gap-2 text-xs">
                      <span class="inline-flex items-center gap-2 rounded-md bg-sky-500/10 px-2.5 py-1 font-medium text-sky-600 dark:text-sky-300">
                        <span class="h-2 w-2 rounded-full bg-sky-500"></span>
                        {{ formatPercent(row.directRatio) }}
                      </span>
                      <span class="inline-flex items-center gap-2 rounded-md bg-amber-500/10 px-2.5 py-1 font-medium text-amber-600 dark:text-amber-300">
                        <span class="h-2 w-2 rounded-full bg-amber-500"></span>
                        {{ formatPercent(row.hostedRatio) }}
                      </span>
                    </div>
                  </div>

                  <div class="mt-3 grid gap-3 sm:grid-cols-2">
                    <div class="min-w-0">
                      <div class="flex items-center justify-between gap-3 text-sm">
                        <span class="text-themed-muted">{{ $t('admin.billing.directRevenue') }}</span>
                        <span class="break-words text-right font-semibold text-themed">{{ formatMoney(row.directAmount) }}</span>
                      </div>
                    </div>
                    <div class="min-w-0">
                      <div class="flex items-center justify-between gap-3 text-sm">
                        <span class="text-themed-muted">{{ $t('admin.billing.hostedRevenue') }}</span>
                        <span class="break-words text-right font-semibold text-themed">{{ formatMoney(row.hostedAmount) }}</span>
                      </div>
                    </div>
                  </div>

                  <div class="mt-3 h-2 overflow-hidden rounded-full bg-themed-tertiary">
                    <div class="flex h-full w-full">
                      <div class="bg-sky-500" :style="{ width: `${row.directRatio}%` }"></div>
                      <div class="bg-amber-500" :style="{ width: `${row.hostedRatio}%` }"></div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="card min-w-0 p-5">
              <div class="flex items-start justify-between gap-4 border-b border-themed pb-4">
                <div class="min-w-0">
                  <h2 class="text-base font-semibold text-themed">{{ $t('admin.billing.instanceHealthTitle') }}</h2>
                  <p class="mt-1 text-sm text-themed-muted">{{ formatCount(overview.activePaidInstancesCount) }} / {{ formatCount(overview.paidInstancesCount) }}</p>
                </div>
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                  <BillingOverviewIcon name="server" class="h-5 w-5" />
                </div>
              </div>

              <div class="mt-5">
                <div class="flex items-end justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm text-themed-muted">{{ $t('admin.billing.paidInstances') }}</p>
                    <p class="mt-1 break-words text-3xl font-semibold text-themed">{{ formatCount(overview.paidInstancesCount) }}</p>
                  </div>
                  <div class="rounded-md bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-600 dark:text-emerald-300">
                    {{ formatPercent(activeInstanceShare) }}
                  </div>
                </div>

                <div class="mt-4 h-2.5 overflow-hidden rounded-full bg-themed-tertiary">
                  <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${activeInstanceShare}%` }"></div>
                </div>
              </div>

              <div class="mt-5 divide-y divide-themed">
                <div
                  v-for="card in instanceStatusCards"
                  :key="card.key"
                  class="py-4 first:pt-0 last:pb-0"
                >
                  <div class="flex items-center justify-between gap-4">
                    <div class="flex min-w-0 items-center gap-3">
                      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" :class="card.surfaceClass">
                        <BillingOverviewIcon :name="card.icon" class="h-4 w-4" :class="card.toneClass" />
                      </div>
                      <div class="min-w-0">
                        <p class="text-sm font-medium text-themed">{{ card.label }}</p>
                        <p class="mt-1 text-xs text-themed-muted">{{ formatPercent(card.progress || 0) }}</p>
                      </div>
                    </div>
                    <div class="shrink-0 text-xl font-semibold text-themed">{{ formatCount(card.value) }}</div>
                  </div>
                  <div class="mt-3 h-2 overflow-hidden rounded-full bg-themed-tertiary">
                    <div class="h-full rounded-full bg-current" :class="card.toneClass" :style="{ width: `${card.progress || 0}%` }"></div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section>
            <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 class="text-base font-semibold text-themed">{{ $t('admin.billing.affOverviewTitle') }}</h2>
                <p class="mt-1 text-sm text-themed-muted">{{ formatCount(overview.aff.totalOrders) }} {{ $t('admin.billing.orders') }}</p>
              </div>
            </div>

            <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <article
                v-for="card in affCards"
                :key="card.key"
                class="card min-w-0 p-5"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm text-themed-muted">{{ card.label }}</p>
                    <p class="mt-2 break-words text-2xl font-semibold text-themed">
                      {{ card.format === 'money' ? formatMoney(card.value) : formatCount(card.value) }}
                    </p>
                  </div>
                  <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" :class="card.surfaceClass">
                    <BillingOverviewIcon :name="card.icon" class="h-5 w-5" :class="card.toneClass" />
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>
      </template>

      <div v-else class="card p-8 text-center text-sm text-themed-muted">
        {{ $t('common.noData') }}
      </div>
    </div>

    <!-- 实例 Tab -->
    <div v-show="activeTab === 'instances'">
      <!-- 筛选 -->
      <div class="card mb-4 p-4 md:p-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="text-sm font-medium text-themed">{{ $t('admin.billing.tabs.instances') }}</div>
            <div class="mt-1 text-xs text-themed-muted">{{ $t('admin.billing.totalCount', { count: instancesTotal }) }}</div>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <select v-model="instancesFilter" class="input w-40" @change="instancesPage = 1; loadInstances()">
              <option value="">{{ $t('admin.billing.allStatus') }}</option>
              <option value="running">{{ $t('instance.status.running') }}</option>
              <option value="stopped">{{ $t('instance.status.stopped') }}</option>
              <option value="suspended">{{ $t('instance.status.suspended') }}</option>
            </select>
            <select v-model="instancesHostFilter" class="input w-48" @change="instancesPage = 1; loadInstances()">
              <option value="">{{ $t('admin.billing.allHosts') }}</option>
              <option v-for="host in hosts" :key="host.id" :value="host.id">{{ host.name }}</option>
            </select>
            <label class="inline-flex items-center gap-2 rounded-xl bg-themed-tertiary px-3 py-2 text-sm">
              <input v-model="showExpiring" type="checkbox" class="checkbox" @change="instancesPage = 1; loadInstances()" />
              {{ $t('admin.billing.showExpiring') }}
            </label>
            <label class="inline-flex items-center gap-2 rounded-xl bg-themed-tertiary px-3 py-2 text-sm">
              <input v-model="showDateColumns" type="checkbox" class="checkbox" />
              {{ $t('admin.billing.showDateColumns') }}
            </label>
          </div>
        </div>

        <div class="mt-4 flex flex-col gap-3 sm:flex-row">
          <div class="flex-1">
            <input
              v-model="instancesSearch"
              type="text"
              class="input w-full"
              :placeholder="$t('admin.billing.searchPlaceholder')"
              @keyup.enter="instancesPage = 1; loadInstances()"
            />
          </div>
          <button
            class="btn btn-primary sm:w-auto"
            @click="instancesPage = 1; loadInstances()"
          >
            {{ $t('common.search') }}
          </button>
        </div>
      </div>

      <SkeletonLoader v-if="instancesLoading" :count="3" />

      <div v-else-if="instances.length > 0" class="card overflow-hidden">
        <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div class="text-sm font-medium text-themed">{{ $t('admin.billing.tabs.instances') }}</div>
            <div class="mt-1 text-xs text-themed-muted">{{ $t('admin.billing.totalCount', { count: instancesTotal }) }}</div>
          </div>
          <div class="flex flex-wrap items-center gap-3 sm:justify-end">
            <div class="hidden rounded-xl bg-themed-secondary px-3 py-2 text-xs text-themed-muted md:block">
              {{ selectedInstancesCount > 0 ? $t('admin.billing.batchSelectedCount', { count: selectedInstancesCount }) : (showExpiring ? $t('admin.billing.showExpiring') : $t('admin.billing.allStatus')) }}
            </div>
            <button
              class="btn btn-primary btn-sm"
              :disabled="selectedInstancesCount === 0"
              @click="openBatchPriceModal"
            >
              {{ $t('admin.billing.batchUpdatePrice') }}
            </button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-themed-secondary/80">
              <tr>
                <th class="w-11 p-3 whitespace-nowrap">
                  <input
                    type="checkbox"
                    class="checkbox"
                    :checked="allCurrentPageSelected"
                    :indeterminate="someCurrentPageSelected && !allCurrentPageSelected"
                    :disabled="selectableInstances.length === 0"
                    :aria-label="$t('admin.billing.selectAllCurrentPage')"
                    @change="toggleSelectAllCurrentPage"
                  />
                </th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.hostingType') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.instanceType') }}</th>
                <th class="text-left p-3 whitespace-nowrap">ID</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.instanceName') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.instanceStatus') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.user') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.package') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.plan') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.host') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.price') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.cycle') }}</th>
                <th v-if="showDateColumns" class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.purchaseDate') }}</th>
                <th v-if="showDateColumns" class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.expiresAt') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.remainingDays') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="inst in instances" :key="inst.id" class="border-t border-themed hover:bg-themed-secondary/50 transition-colors">
                <td class="p-3 whitespace-nowrap">
                  <input
                    v-model="selectedInstanceIds"
                    type="checkbox"
                    class="checkbox"
                    :value="inst.id"
                    :disabled="inst.status === 'deleted'"
                    :aria-label="$t('admin.billing.selectInstance')"
                  />
                </td>
                <!-- 托管类型 -->
                <td class="p-3 whitespace-nowrap">
                  <span 
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                    :class="inst.isHostedInstance 
                      ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300' 
                      : 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'"
                  >
                    {{ inst.isHostedInstance ? $t('admin.billing.hosted') : $t('admin.billing.direct') }}
                  </span>
                </td>
                <!-- 实例类型图标 -->
                <td class="p-3 whitespace-nowrap">
                  <span 
                    class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium cursor-pointer"
                    :class="inst.instanceTypeLabel === 'PRIME' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'"
                    @click="router.push(`/instances/${inst.id}`)"
                  >
                    <svg v-if="inst.instanceTypeLabel === 'PRIME'" class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <svg v-else class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd" />
                    </svg>
                    {{ inst.instanceTypeLabel }}
                  </span>
                </td>
                <!-- ID -->
                <td class="p-3 whitespace-nowrap">
                  <div class="flex flex-col gap-0.5">
                    <span 
                      class="text-blue-500 hover:text-blue-600 cursor-pointer font-mono text-xs"
                      @click="router.push(`/instances/${inst.id}`)"
                    >#{{ inst.id }}</span>
                    <span class="text-themed-muted font-mono text-xs" :title="inst.incusId">{{ inst.incusId?.slice(0, 8) }}</span>
                  </div>
                </td>
                <!-- 实例名 -->
                <td class="p-3">
                  <span 
                    class="text-themed font-medium hover:text-blue-500 cursor-pointer"
                    @click="router.push(`/instances/${inst.id}`)"
                  >{{ inst.name }}</span>
                </td>
                <!-- 状态 -->
                <td class="p-3 whitespace-nowrap">
                  <span :class="['badge', getStatusBadge(inst.status)]">{{ $t('instance.status.' + inst.status) }}</span>
                  <span v-if="inst.autoRenew" class="badge badge-info ml-1">{{ $t('admin.billing.autoRenew') }}</span>
                </td>
                <!-- 用户 -->
                <td class="p-3 whitespace-nowrap">
                  <div class="flex items-center gap-2">
                    <UserAvatar :username="inst.user?.username || ''" :avatar-style="inst.user?.avatarStyle || 'bottts'" :badge-id="inst.user?.avatarBadgeId || null" :size="28" />
                    <div class="flex flex-col">
                      <span class="text-themed font-medium">{{ inst.user?.username || '-' }}</span>
                      <div class="flex items-center gap-1 text-xs text-themed-muted">
                        <span>#{{ inst.user?.id }}</span>
                        <span v-if="inst.user?.email" class="truncate max-w-32" :title="inst.user.email">{{ inst.user.email }}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <!-- 套餐名 -->
                <td class="p-3 whitespace-nowrap">{{ inst.package?.name || '-' }}</td>
                <!-- 方案名 -->
                <td class="p-3 whitespace-nowrap">{{ inst.packagePlan?.name || '-' }}</td>
                <!-- 宿主机名 -->
                <td class="p-3 whitespace-nowrap">{{ inst.host?.name || '-' }}</td>
                <!-- 价格（可点击修改） -->
                <td class="p-3 whitespace-nowrap">
                  <button
                    v-if="inst.billingPrice"
                    class="text-blue-500 hover:text-blue-600 hover:underline cursor-pointer font-medium"
                    @click="openPriceModal(inst)"
                  >
                    {{ formatMoney(inst.billingPrice) }}
                  </button>
                  <span v-else>-</span>
                </td>
                <!-- 周期 -->
                <td class="p-3 whitespace-nowrap">{{ inst.billingCycle ? $t('admin.billing.cycleMonths', { months: inst.billingCycle }) : '-' }}</td>
                <!-- 购买日期 -->
                <td v-if="showDateColumns" class="p-3 whitespace-nowrap text-themed-muted">{{ formatDate(inst.createdAt) }}</td>
                <!-- 到期时间 -->
                <td v-if="showDateColumns" class="p-3 whitespace-nowrap text-themed-muted">{{ formatDate(inst.expiresAt) }}</td>
                <!-- 剩余天数 -->
                <td class="p-3 whitespace-nowrap">
                  <span 
                    v-if="inst.remainingDays !== null"
                    :class="[
                      'font-medium',
                      inst.remainingDays <= 0 ? 'text-red-500' : 
                      inst.remainingDays <= 7 ? 'text-yellow-500' : 'text-green-500'
                    ]"
                  >
                    {{ inst.remainingDays <= 0 ? $t('admin.billing.expired') : inst.remainingDays + ' ' + $t('admin.billing.days') }}
                  </span>
                  <span v-else>-</span>
                </td>
                <!-- 操作 -->
                <td class="p-3 whitespace-nowrap">
                  <div class="flex items-center gap-1">
                    <button
                      v-if="inst.status === 'suspended'"
                      class="btn btn-xs btn-ghost text-green-500"
                      @click="openActionModal('unsuspend', inst)"
                    >
                      {{ $t('admin.billing.unsuspend') }}
                    </button>
                    <button class="btn btn-xs btn-ghost" @click="openActionModal('extend', inst)">
                      {{ $t('admin.billing.extend') }}
                    </button>
                    <button 
                      v-if="inst.remainingDays > 0" 
                      class="btn btn-xs btn-ghost text-blue-500" 
                      @click="openUpgradeModal(inst)"
                    >
                      {{ $t('admin.billing.upgradePlan') }}
                    </button>
                    <button
                      v-if="!inst.hasAffBinding"
                      class="btn btn-xs btn-ghost text-purple-500"
                      @click="openActionModal('applyDiscount', inst)"
                    >
                      {{ $t('admin.billing.applyDiscount') }}
                    </button>
                    <button class="btn btn-xs btn-ghost text-red-500" @click="openActionModal('deleteRefund', inst)">
                      {{ $t('admin.billing.deleteRefund') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else class="card p-10 text-center">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
          <BillingOverviewIcon name="server" class="h-7 w-7" />
        </div>
        <div class="mt-4 text-base font-medium text-themed">{{ $t('admin.billing.noInstances') }}</div>
        <div class="mt-1 text-sm text-themed-muted">{{ $t('admin.billing.searchPlaceholder') }}</div>
      </div>

      <!-- 分页 -->
      <div v-if="instances.length > 0" class="card mt-4 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <!-- 每页条数选择器 -->
        <div class="flex items-center gap-2 text-sm text-themed-muted">
          <span>{{ $t('admin.billing.perPage') }}</span>
          <select
            :value="instancesPageSize"
            class="input w-20 py-1"
            @change="instancesPageSize = Number(($event.target as HTMLSelectElement).value); instancesPage = 1; loadInstances()"
          >
            <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
          </select>
          <span>{{ $t('admin.billing.totalCount', { count: instancesTotal }) }}</span>
        </div>
        <!-- 分页导航 -->
        <div v-if="instancesTotalPages > 1" class="flex items-center gap-2">
          <button
            class="btn btn-sm btn-ghost"
            :disabled="instancesPage <= 1"
            @click="instancesPage--; loadInstances()"
          >
            {{ $t('common.prevPage') }}
          </button>
          <span class="text-sm text-themed-muted">
            {{ instancesPage }} / {{ instancesTotalPages }}
          </span>
          <button
            class="btn btn-sm btn-ghost"
            :disabled="instancesPage >= instancesTotalPages"
            @click="instancesPage++; loadInstances()"
          >
            {{ $t('common.nextPage') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 记录 Tab -->
    <div v-show="activeTab === 'records'">
      <SkeletonLoader v-if="recordsLoading" :count="5" />

      <div v-else-if="records.length > 0" class="card overflow-hidden">
        <div class="flex items-center justify-between gap-4 border-b border-themed px-5 py-4">
          <div>
            <div class="text-sm font-medium text-themed">{{ $t('admin.billing.tabs.records') }}</div>
            <div class="mt-1 text-xs text-themed-muted">{{ $t('admin.billing.totalCount', { count: recordsTotal }) }}</div>
          </div>
          <div class="hidden rounded-xl bg-themed-secondary px-3 py-2 text-xs text-themed-muted md:block">
            {{ $t('admin.billing.recordType') }} / {{ $t('admin.billing.amount') }}
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-themed-secondary/80">
              <tr>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.recordType') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.amount') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.instance') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.user') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.remark') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.time') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rec in records" :key="rec.id" class="border-t border-themed hover:bg-themed-secondary/40 transition-colors">
                <td class="p-3 whitespace-nowrap">{{ getRecordTypeLabel(rec.type) }}</td>
                <td class="p-3 whitespace-nowrap" :class="rec.amount >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ formatMoney(rec.amount) }}
                </td>
                <td class="p-3 whitespace-nowrap">{{ rec.instance?.name || '-' }}</td>
                <td class="p-3 whitespace-nowrap">{{ rec.user?.username || '-' }}</td>
                <td class="p-3 text-themed-muted max-w-xs truncate">{{ rec.remark || '-' }}</td>
                <td class="p-3 text-themed-muted whitespace-nowrap">{{ formatDate(rec.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else class="card p-10 text-center">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
          <BillingOverviewIcon name="chart" class="h-7 w-7" />
        </div>
        <div class="mt-4 text-base font-medium text-themed">{{ $t('admin.billing.noRecords') }}</div>
        <div class="mt-1 text-sm text-themed-muted">{{ $t('admin.billing.tabs.records') }}</div>
      </div>

      <!-- 分页 -->
      <div v-if="records.length > 0" class="card mt-4 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <!-- 每页条数选择器 -->
        <div class="flex items-center gap-2 text-sm text-themed-muted">
          <span>{{ $t('admin.billing.perPage') }}</span>
          <select
            :value="recordsPageSize"
            class="input w-20 py-1"
            @change="recordsPageSize = Number(($event.target as HTMLSelectElement).value); recordsPage = 1; loadRecords()"
          >
            <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
          </select>
          <span>{{ $t('admin.billing.totalCount', { count: recordsTotal }) }}</span>
        </div>
        <!-- 分页导航 -->
        <div v-if="recordsTotalPages > 1" class="flex items-center gap-2">
          <button
            class="btn btn-sm btn-ghost"
            :disabled="recordsPage <= 1"
            @click="recordsPage--; loadRecords()"
          >
            {{ $t('common.prevPage') }}
          </button>
          <span class="text-sm text-themed-muted">
            {{ recordsPage }} / {{ recordsTotalPages }}
          </span>
          <button
            class="btn btn-sm btn-ghost"
            :disabled="recordsPage >= recordsTotalPages"
            @click="recordsPage++; loadRecords()"
          >
            {{ $t('common.nextPage') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 充值记录 Tab -->
    <div v-show="activeTab === 'rechargeRecords'">
      <!-- 筛选 -->
      <div class="card mb-4 p-4 md:p-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div class="text-sm font-medium text-themed">{{ $t('admin.billing.tabs.rechargeRecords') }}</div>
            <div class="mt-1 text-xs text-themed-muted">{{ $t('admin.billing.totalCount', { count: rechargeRecordsTotal }) }}</div>
          </div>
          <div class="flex items-center gap-3">
            <select v-model="rechargeRecordsFilter" class="input w-44" @change="rechargeRecordsPage = 1; loadRechargeRecords()">
              <option value="">{{ $t('admin.billing.allStatus') }}</option>
              <option value="pending">{{ $t('admin.billing.rechargeStatus.pending') }}</option>
              <option value="completed">{{ $t('admin.billing.rechargeStatus.completed') }}</option>
              <option value="cancelled">{{ $t('admin.billing.rechargeStatus.cancelled') }}</option>
              <option value="failed">{{ $t('admin.billing.rechargeStatus.failed') }}</option>
            </select>
          </div>
        </div>
      </div>

      <SkeletonLoader v-if="rechargeRecordsLoading" :count="5" />

      <div v-else-if="rechargeRecords.length > 0" class="card overflow-hidden">
        <div class="flex items-center justify-between gap-4 border-b border-themed px-5 py-4">
          <div>
            <div class="text-sm font-medium text-themed">{{ $t('admin.billing.tabs.rechargeRecords') }}</div>
            <div class="mt-1 text-xs text-themed-muted">{{ $t('admin.billing.totalCount', { count: rechargeRecordsTotal }) }}</div>
          </div>
          <div class="hidden rounded-xl bg-themed-secondary px-3 py-2 text-xs text-themed-muted md:block">
            {{ rechargeRecordsFilter ? $t(`admin.billing.rechargeStatus.${rechargeRecordsFilter}`) : $t('admin.billing.allStatus') }}
          </div>
        </div>
        <div class="divide-y divide-themed md:hidden">
          <div v-for="rec in rechargeRecords" :key="rec.id" class="space-y-3 px-5 py-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate font-mono text-xs text-themed">
                  <span class="cursor-pointer hover:text-blue-500" @click="copyToClipboard(rec.orderNo)">{{ rec.orderNo }}</span>
                </div>
                <div class="mt-1 text-sm text-themed">{{ rec.user?.username || '-' }}</div>
                <div class="mt-1 text-xs text-themed-muted">{{ formatDate(rec.createdAt) }}</div>
              </div>
              <span :class="['badge', getRechargeStatusBadge(rec.status)]">{{ $t(`admin.billing.rechargeStatus.${rec.status}`) }}</span>
            </div>

            <div class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div class="text-xs uppercase tracking-wide text-themed-muted">{{ $t('admin.billing.amount') }}</div>
                <div class="mt-1 text-themed">{{ formatMoney(rec.amount) }}</div>
              </div>
              <div>
                <div class="text-xs uppercase tracking-wide text-themed-muted">{{ $t('admin.billing.creditAmount') }}</div>
                <div class="mt-1 text-themed">{{ rec.actualAmount !== null ? formatMoney(rec.actualAmount) : '-' }}</div>
                <div v-if="rec.actualAmount !== null" class="mt-1 text-xs text-themed-muted">
                  {{ $t(getRechargeCreditLabelKey(rec.status)) }}
                </div>
              </div>
            </div>

            <div class="space-y-1 text-xs text-themed-muted">
              <div>{{ $t('admin.billing.payChannel') }}: {{ getPayChannelDisplay(rec) }}</div>
              <div>{{ $t('admin.billing.paymentDetails') }}: {{ getRechargePaymentDetailsDisplay(rec) }}</div>
              <div v-if="getRechargeGatewayStatusText(rec)">{{ getRechargeGatewayStatusText(rec) }}</div>
              <div v-if="rec.paymentUuid" class="truncate font-mono" :title="rec.paymentUuid">
                {{ $t('admin.billing.paymentUuid') }} {{ rec.paymentUuid }}
              </div>
              <div v-if="rec.paymentTxid" class="truncate font-mono" :title="rec.paymentTxid">
                {{ $t('admin.billing.paymentTxid') }} {{ rec.paymentTxid }}
              </div>
              <div v-if="rec.tradeNo" class="truncate font-mono" :title="rec.tradeNo">
                {{ $t('admin.billing.tradeNo') }} {{ rec.tradeNo }}
              </div>
            </div>

            <div class="flex justify-end">
              <button
                v-if="rec.status === 'pending'"
                class="btn btn-sm btn-ghost text-blue-500"
                :disabled="syncingRecordId === rec.id"
                @click="syncRechargeRecord(rec)"
              >
                {{ syncingRecordId === rec.id ? $t('common.syncing') : $t('admin.billing.sync') }}
              </button>
            </div>
          </div>
        </div>

        <div class="hidden overflow-x-auto md:block">
          <table class="w-full text-sm">
            <thead class="bg-themed-secondary/80">
              <tr>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.rechargeOrderNo') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.user') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.amount') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.creditAmount') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.payChannel') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.paymentDetails') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.rechargeStatusLabel') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.tradeNo') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('admin.billing.time') }}</th>
                <th class="text-left p-3 whitespace-nowrap">{{ $t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rec in rechargeRecords" :key="rec.id" class="border-t border-themed hover:bg-themed-secondary/40 transition-colors">
                <td class="p-3 font-mono text-xs whitespace-nowrap">
                  <span class="cursor-pointer hover:text-blue-500" @click="copyToClipboard(rec.orderNo)">{{ rec.orderNo }}</span>
                </td>
                <td class="p-3 whitespace-nowrap">{{ rec.user?.username || '-' }}</td>
                <td class="p-3 whitespace-nowrap">{{ formatMoney(rec.amount) }}</td>
                <td class="p-3 whitespace-nowrap">
                  <div>{{ rec.actualAmount !== null ? formatMoney(rec.actualAmount) : '-' }}</div>
                  <div v-if="rec.actualAmount !== null" class="mt-1 text-xs text-themed-muted">
                    {{ $t(getRechargeCreditLabelKey(rec.status)) }}
                  </div>
                </td>
                <td class="p-3 whitespace-nowrap">{{ getPayChannelDisplay(rec) }}</td>
                <td class="p-3 text-xs text-themed-muted max-w-[220px]">
                  <div>{{ getRechargePaymentDetailsDisplay(rec) }}</div>
                  <div v-if="getRechargeGatewayStatusText(rec)" class="mt-1">{{ getRechargeGatewayStatusText(rec) }}</div>
                  <div v-if="rec.paymentUuid" class="mt-1 truncate font-mono" :title="rec.paymentUuid">
                    {{ $t('admin.billing.paymentUuid') }} {{ rec.paymentUuid }}
                  </div>
                  <div v-if="rec.paymentTxid" class="mt-1 truncate font-mono" :title="rec.paymentTxid">
                    {{ $t('admin.billing.paymentTxid') }} {{ rec.paymentTxid }}
                  </div>
                </td>
                <td class="p-3 whitespace-nowrap">
                  <span :class="['badge', getRechargeStatusBadge(rec.status)]">{{ $t(`admin.billing.rechargeStatus.${rec.status}`) }}</span>
                </td>
                <td class="p-3 font-mono text-xs whitespace-nowrap text-themed-muted max-w-[150px] truncate" :title="rec.tradeNo || ''">
                  <span 
                    v-if="rec.tradeNo" 
                    class="cursor-pointer hover:text-blue-500" 
                    @click="copyToClipboard(rec.tradeNo)"
                  >{{ rec.tradeNo }}</span>
                  <span v-else>-</span>
                </td>
                <td class="p-3 text-themed-muted whitespace-nowrap">{{ formatDate(rec.createdAt) }}</td>
                <td class="p-3 whitespace-nowrap">
                  <button
                    v-if="rec.status === 'pending'"
                    class="btn btn-sm btn-ghost text-blue-500"
                    :disabled="syncingRecordId === rec.id"
                    @click="syncRechargeRecord(rec)"
                  >
                    {{ syncingRecordId === rec.id ? $t('common.syncing') : $t('admin.billing.sync') }}
                  </button>
                  <span v-else class="text-themed-muted">-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else class="card p-10 text-center">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
          <BillingOverviewIcon name="wallet" class="h-7 w-7" />
        </div>
        <div class="mt-4 text-base font-medium text-themed">{{ $t('admin.billing.noRechargeRecords') }}</div>
        <div class="mt-1 text-sm text-themed-muted">{{ $t('admin.billing.tabs.rechargeRecords') }}</div>
      </div>

      <!-- 分页 -->
      <div v-if="rechargeRecords.length > 0" class="card mt-4 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <!-- 每页条数选择器 -->
        <div class="flex items-center gap-2 text-sm text-themed-muted">
          <span>{{ $t('admin.billing.perPage') }}</span>
          <select
            :value="rechargeRecordsPageSize"
            class="input w-20 py-1"
            @change="rechargeRecordsPageSize = Number(($event.target as HTMLSelectElement).value); rechargeRecordsPage = 1; loadRechargeRecords()"
          >
            <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
          </select>
          <span>{{ $t('admin.billing.totalCount', { count: rechargeRecordsTotal }) }}</span>
        </div>
        <!-- 分页导航 -->
        <div v-if="rechargeRecordsTotalPages > 1" class="flex items-center gap-2">
          <button
            class="btn btn-sm btn-ghost"
            :disabled="rechargeRecordsPage <= 1"
            @click="rechargeRecordsPage--; loadRechargeRecords()"
          >
            {{ $t('common.prevPage') }}
          </button>
          <span class="text-sm text-themed-muted">
            {{ rechargeRecordsPage }} / {{ rechargeRecordsTotalPages }}
          </span>
          <button
            class="btn btn-sm btn-ghost"
            :disabled="rechargeRecordsPage >= rechargeRecordsTotalPages"
            @click="rechargeRecordsPage++; loadRechargeRecords()"
          >
            {{ $t('common.nextPage') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 支付渠道 Tab -->
    <div v-show="activeTab === 'paymentProviders'">
      <PaymentProvidersView v-if="hasVisitedPaymentProviders" embedded />
    </div>

    <!-- AFF 转化 Tab -->
    <div v-show="activeTab === 'affConversions'">
      <AffReviewView v-if="hasVisitedAffConversions" embedded />
    </div>

    <!-- 操作弹窗 -->
    <Teleport to="body">
      <div v-if="showActionModal" class="modal-overlay" @click.self="showActionModal = false">
        <div class="modal-content max-w-md">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t(`admin.billing.${actionType}Title`) }}</h3>
            <button class="btn btn-ghost btn-sm" @click="showActionModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body space-y-4">
            <p class="text-themed-secondary">
              {{ $t('admin.billing.targetInstance') }}: <strong>{{ actionTarget?.name }}</strong>
            </p>

            <!-- 封停/解封 -->
            <template v-if="actionType === 'suspend'">
              <div>
                <label class="label">{{ $t('admin.billing.reason') }}</label>
                <textarea v-model="actionForm.reason" class="input w-full" rows="3" :placeholder="$t('admin.billing.reasonPlaceholder')"></textarea>
              </div>
            </template>

            <!-- 延期 -->
            <template v-if="actionType === 'extend'">
              <div>
                <label class="label">{{ $t('admin.billing.extendDays') }}</label>
                <input v-model.number="actionForm.days" type="number" class="input w-full" min="1" max="365" />
              </div>
              <label class="flex items-center gap-2">
                <input v-model="actionForm.freeExtend" type="checkbox" class="checkbox" />
                {{ $t('admin.billing.freeExtend') }}
              </label>
              <div>
                <label class="label">{{ $t('admin.billing.reason') }}</label>
                <input v-model="actionForm.reason" type="text" class="input w-full" />
              </div>
            </template>

            <!-- 删除并退款 -->
            <template v-if="actionType === 'deleteRefund'">
              <div class="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <p class="text-sm text-red-600 dark:text-red-400">
                  {{ $t('admin.billing.deleteRefundWarning') }}
                </p>
              </div>
              <div>
                <label class="label">{{ $t('admin.billing.refundTypeLabel') }} *</label>
                <div class="flex flex-col gap-2">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input v-model="actionForm.refundType" type="radio" value="remaining" class="radio" />
                    <span>{{ $t('admin.billing.refundTypeRemaining') }}</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input v-model="actionForm.refundType" type="radio" value="full" class="radio" />
                    <span>{{ $t('admin.billing.refundTypeFull') }}</span>
                  </label>
                </div>
              </div>
              <div>
                <label class="label">{{ $t('admin.billing.reason') }} *</label>
                <textarea v-model="actionForm.reason" class="input w-full" rows="3" :placeholder="$t('admin.billing.deleteRefundReasonPlaceholder')"></textarea>
              </div>
            </template>

            <!-- 应用折扣 -->
            <template v-if="actionType === 'applyDiscount'">
              <div class="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                <p class="text-sm text-purple-600 dark:text-purple-400">
                  {{ $t('admin.billing.applyDiscountHint') }}
                </p>
              </div>
              <div>
                <label class="label">{{ $t('admin.billing.affCodeLabel') }} *</label>
                <input 
                  v-model="actionForm.affCode" 
                  type="text" 
                  class="input w-full uppercase" 
                  :placeholder="$t('admin.billing.affCodePlaceholder')"
                />
              </div>
            </template>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showActionModal = false">{{ $t('common.cancel') }}</button>
            <!-- 删除并退款模式下显示仅数据库删除按钮 -->
            <button
              v-if="actionType === 'deleteRefund'"
              class="btn btn-warning"
              :disabled="actionLoading"
              @click="actionType = 'deleteRefundDatabaseOnly'; executeAction()"
            >
              {{ actionLoading ? $t('common.processing') : $t('admin.billing.databaseOnlyDelete') }}
            </button>
            <button
              class="btn"
              :class="actionType === 'suspend' || actionType === 'deleteRefund' || actionType === 'deleteRefundDatabaseOnly' ? 'btn-error' : 'btn-primary'"
              :disabled="actionLoading"
              @click="executeAction"
            >
              {{ actionLoading ? $t('common.processing') : $t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 批量修改价格弹窗 -->
    <Teleport to="body">
      <div v-if="showBatchPriceModal" class="modal-overlay" @click.self="showBatchPriceModal = false">
        <div class="modal-content max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('admin.billing.batchUpdatePrice') }}</h3>
            <button class="btn btn-ghost btn-sm" @click="showBatchPriceModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="modal-body space-y-4 overflow-y-auto flex-1">
            <div class="grid gap-3 sm:grid-cols-3">
              <div class="rounded-lg bg-themed-secondary p-3">
                <div class="text-xs text-themed-muted">{{ $t('admin.billing.batchSelected') }}</div>
                <div class="mt-1 text-lg font-semibold text-themed">{{ selectedInstancesCount }}</div>
              </div>
              <div class="rounded-lg bg-themed-secondary p-3">
                <div class="text-xs text-themed-muted">{{ $t('admin.billing.batchPreviewChanged') }}</div>
                <div class="mt-1 text-lg font-semibold text-themed">{{ batchPricePreview?.summary.changedCount || 0 }}</div>
              </div>
              <div class="rounded-lg bg-themed-secondary p-3">
                <div class="text-xs text-themed-muted">{{ $t('admin.billing.batchPreviewFailed') }}</div>
                <div class="mt-1 text-lg font-semibold" :class="(batchPricePreview?.summary.failedCount || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-themed'">
                  {{ batchPricePreview?.summary.failedCount || 0 }}
                </div>
              </div>
            </div>

            <div>
              <label class="label">{{ $t('admin.billing.newPrice') }} *</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-themed-muted">¥</span>
                <input
                  v-model.number="batchPriceForm.newPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  class="input input-bordered w-full pl-7"
                  :placeholder="$t('admin.billing.enterNewPrice')"
                />
              </div>
              <p class="text-xs text-themed-muted mt-1">{{ $t('admin.billing.batchPriceHint') }}</p>
            </div>

            <div class="flex items-center gap-3">
              <input
                id="batchSettleBalance"
                v-model="batchPriceForm.settleBalance"
                type="checkbox"
                class="checkbox"
              />
              <label for="batchSettleBalance" class="text-sm cursor-pointer">
                {{ $t('admin.billing.settleBalance') }}
              </label>
            </div>

            <div v-if="batchPricePreviewLoading" class="p-3 rounded-lg border bg-gray-50 dark:bg-gray-800 border-themed text-sm text-themed-muted">
              {{ $t('common.loading') }}
            </div>

            <template v-else-if="batchPricePreview">
              <div
                class="rounded-lg border p-3"
                :class="batchPricePreview.canSubmit ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'"
              >
                <div class="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div class="text-xs text-themed-muted">{{ $t('admin.billing.batchTotalCharge') }}</div>
                    <div class="mt-1 text-base font-semibold text-red-600 dark:text-red-400">{{ formatMoney(batchPricePreview.summary.totalCharge) }}</div>
                  </div>
                  <div>
                    <div class="text-xs text-themed-muted">{{ $t('admin.billing.batchTotalRefund') }}</div>
                    <div class="mt-1 text-base font-semibold text-green-600 dark:text-green-400">{{ formatMoney(batchPricePreview.summary.totalRefund) }}</div>
                  </div>
                  <div>
                    <div class="text-xs text-themed-muted">{{ $t('admin.billing.batchNetAmount') }}</div>
                    <div class="mt-1 text-base font-semibold text-themed">{{ formatPriceDiff(batchPricePreview.summary.netAmount) }}</div>
                  </div>
                </div>
                <p v-if="!batchPricePreview.canSubmit" class="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
                  {{ $t('admin.billing.batchPreviewBlocked') }}
                </p>
              </div>

              <div v-if="batchPricePreview.userImpacts.length > 0" class="rounded-lg border border-themed overflow-hidden">
                <div class="bg-themed-secondary px-3 py-2 text-sm font-medium text-themed">{{ $t('admin.billing.batchUserImpact') }}</div>
                <div class="max-h-40 overflow-auto">
                  <div
                    v-for="impact in batchPricePreview.userImpacts"
                    :key="impact.userId"
                    class="grid min-w-[520px] grid-cols-4 gap-2 border-t border-themed px-3 py-2 text-sm"
                  >
                    <div class="font-medium text-themed">{{ impact.username }}</div>
                    <div class="text-themed-muted">{{ formatMoney(impact.balanceBefore) }}</div>
                    <div :class="impact.netDiff > 0 ? 'text-red-600 dark:text-red-400' : impact.netDiff < 0 ? 'text-green-600 dark:text-green-400' : 'text-themed-muted'">{{ formatPriceDiff(impact.netDiff) }}</div>
                    <div :class="impact.insufficientBalance ? 'text-red-600 dark:text-red-400 font-medium' : 'text-themed'">{{ formatMoney(impact.balanceAfter) }}</div>
                  </div>
                </div>
              </div>

              <div class="rounded-lg border border-themed overflow-hidden">
                <div class="bg-themed-secondary px-3 py-2 text-sm font-medium text-themed">{{ $t('admin.billing.batchPreviewDetails') }}</div>
                <div class="max-h-64 overflow-auto">
                  <table class="w-full min-w-[720px] text-sm">
                    <thead class="bg-themed-secondary/60">
                      <tr>
                        <th class="text-left p-2">{{ $t('admin.billing.instance') }}</th>
                        <th class="text-left p-2">{{ $t('admin.billing.user') }}</th>
                        <th class="text-right p-2">{{ $t('admin.billing.currentPrice') }}</th>
                        <th class="text-right p-2">{{ $t('admin.billing.newPrice') }}</th>
                        <th class="text-right p-2">{{ $t('admin.billing.priceDifference') }}</th>
                        <th class="text-left p-2">{{ $t('admin.billing.result') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="item in batchPricePreview.items" :key="item.id" class="border-t border-themed">
                        <td class="p-2">
                          <div class="font-medium text-themed">{{ item.name || '-' }}</div>
                          <div class="text-xs text-themed-muted">#{{ item.id }}</div>
                        </td>
                        <td class="p-2 text-themed-muted">{{ item.user?.username || '-' }}</td>
                        <td class="p-2 text-right">{{ item.oldPrice !== null ? formatMoney(item.oldPrice) : '-' }}</td>
                        <td class="p-2 text-right">{{ formatMoney(item.newPrice) }}</td>
                        <td class="p-2 text-right" :class="item.priceDiff > 0 ? 'text-red-600 dark:text-red-400' : item.priceDiff < 0 ? 'text-green-600 dark:text-green-400' : 'text-themed-muted'">
                          {{ formatPriceDiff(item.priceDiff) }}
                        </td>
                        <td class="p-2">
                          <span :class="getBatchPriceItemStatusClass(item.status)">{{ item.error || getBatchPriceItemStatusLabel(item.status) }}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>

            <div v-else class="p-3 rounded-lg border border-themed text-sm text-themed-muted">
              {{ $t('admin.billing.batchPreviewWaiting') }}
            </div>

            <div v-if="!batchPriceForm.settleBalance" class="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <p class="text-sm text-yellow-700 dark:text-yellow-300">
                {{ $t('admin.billing.noSettleHint') }}
              </p>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-ghost" :disabled="batchPriceLoading" @click="showBatchPriceModal = false">{{ $t('common.cancel') }}</button>
            <button
              class="btn btn-primary"
              :disabled="batchPriceLoading || batchPricePreviewLoading || !isValidPriceInput(batchPriceForm.newPrice) || !batchPricePreview?.canSubmit || !batchPricePreviewHasVersionSnapshot"
              @click="submitBatchUpdatePrice"
            >
              {{ batchPriceLoading ? $t('common.processing') : $t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 修改价格弹窗 -->
    <Teleport to="body">
      <div v-if="showPriceModal" class="modal-overlay" @click.self="showPriceModal = false">
        <div class="modal-content max-w-md">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('admin.billing.updatePrice') }}</h3>
            <button class="btn btn-ghost btn-sm" @click="showPriceModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body space-y-4">
            <!-- 实例信息 -->
            <div class="p-3 bg-themed-secondary rounded-lg space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ $t('admin.billing.instanceName') }}:</span>
                <span class="font-medium">{{ priceTarget?.name }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ $t('admin.billing.owner') }}:</span>
                <span>{{ priceTarget?.user?.username }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ $t('admin.billing.currentPrice') }}:</span>
                <span class="font-medium text-blue-500">¥{{ (priceTarget?.billingPrice || 0).toFixed(2) }}</span>
              </div>
              <!-- 优惠码状态 -->
              <div v-if="priceTarget?.hasAffBinding && priceTarget?.affDiscountRate > 0" class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ $t('admin.billing.affDiscount') }}:</span>
                <span class="text-green-500 font-medium">-{{ (priceTarget.affDiscountRate * 100).toFixed(0) }}%</span>
              </div>
              <!-- 实际续费价（如果有折扣） -->
              <div v-if="priceTarget?.hasAffBinding && priceTarget?.affDiscountRate > 0" class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ $t('admin.billing.actualRenewPrice') }}:</span>
                <span class="font-medium text-green-600 dark:text-green-400">¥{{ actualRenewPrice.old.toFixed(2) }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ $t('admin.billing.cycle') }}:</span>
                <span>{{ formatBillingCycle(priceTarget?.billingCycle || 1) }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ $t('admin.billing.remainingDays') }}:</span>
                <span :class="priceTarget?.remainingDays <= 7 ? 'text-yellow-500' : ''">
                  {{ Math.ceil(pricePreview?.remainingDays || priceTarget?.remainingDays || 0) }} {{ $t('admin.billing.days') }}
                </span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-themed-muted">{{ $t('admin.billing.userBalance') }}:</span>
                <span>¥{{ (priceTarget?.user?.balance || 0).toFixed(2) }}</span>
              </div>
            </div>
            
            <!-- 优惠码提示 -->
            <div v-if="priceTarget?.hasAffBinding && priceTarget?.affDiscountRate > 0" class="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <p class="text-sm text-green-700 dark:text-green-300">
                🎁 {{ $t('admin.billing.affAppliedHint', { discount: (priceTarget.affDiscountRate * 100).toFixed(0) }) }}
              </p>
            </div>
            
            <!-- 新价格输入 -->
            <div>
              <label class="label">{{ $t('admin.billing.newPrice') }} *</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-themed-muted">¥</span>
                <input 
                  v-model.number="priceForm.newPrice" 
                  type="number" 
                  step="0.01"
                  min="0"
                  class="input input-bordered w-full pl-7"
                  :placeholder="$t('admin.billing.enterNewPrice')"
                />
              </div>
              <p class="text-xs text-themed-muted mt-1">{{ $t('admin.billing.priceHint') }}</p>
              <!-- 新价格的实际续费价（如果有折扣） -->
              <p v-if="priceTarget?.hasAffBinding && priceTarget?.affDiscountRate > 0 && priceForm.newPrice > 0" class="text-xs text-green-600 dark:text-green-400 mt-1">
                → {{ $t('admin.billing.newActualPrice') }}: ¥{{ actualRenewPrice.new.toFixed(2) }}
              </p>
            </div>
            
            <!-- 是否结算差价 -->
            <div class="flex items-center gap-3">
              <input 
                id="settleBalance" 
                v-model="priceForm.settleBalance" 
                type="checkbox"
                class="checkbox"
              />
              <label for="settleBalance" class="text-sm cursor-pointer">
                {{ $t('admin.billing.settleBalance') }}
              </label>
            </div>
            
            <!-- 差价计算结果 -->
            <div v-if="pricePreviewLoading" class="p-3 rounded-lg border bg-gray-50 dark:bg-gray-800 border-themed text-sm text-themed-muted">
              {{ $t('common.loading') }}
            </div>

            <div v-else-if="priceForm.settleBalance && (pricePreview?.remainingDays || 0) > 0 && priceForm.newPrice !== priceTarget?.billingPrice" class="p-3 rounded-lg border" :class="priceDiff > 0 && priceDiff > (pricePreview?.userBalance || priceTarget?.user?.balance || 0) ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'">
              <div class="flex justify-between items-center">
                <span class="text-sm" :class="priceDiff > 0 && priceDiff > (pricePreview?.userBalance || priceTarget?.user?.balance || 0) ? 'text-red-700 dark:text-red-300' : 'text-blue-700 dark:text-blue-300'">
                  {{ priceDiff > 0 ? $t('admin.billing.needPay') : $t('admin.billing.willRefund') }}:
                </span>
                <span class="text-xl font-bold" :class="priceDiff > 0 && priceDiff > (pricePreview?.userBalance || priceTarget?.user?.balance || 0) ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'">
                  ¥{{ Math.abs(priceDiff).toFixed(2) }}
                </span>
              </div>
              <p v-if="priceDiff > 0 && priceDiff > (pricePreview?.userBalance || priceTarget?.user?.balance || 0)" class="text-xs text-red-600 dark:text-red-400 mt-2 font-medium">
                ⚠️ {{ $t('admin.billing.insufficientBalance') }}
              </p>
              <p v-else class="text-xs mt-1" :class="priceDiff > 0 && priceDiff > (pricePreview?.userBalance || priceTarget?.user?.balance || 0) ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'">
                {{ $t('admin.billing.priceDiffHint', { days: Math.ceil(pricePreview?.remainingDays || 0) }) }}
              </p>
            </div>
            
            <!-- 不结算差价提示 -->
            <div v-if="!priceForm.settleBalance" class="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <p class="text-sm text-yellow-700 dark:text-yellow-300">
                ⚠️ {{ $t('admin.billing.noSettleHint') }}
              </p>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showPriceModal = false">{{ $t('common.cancel') }}</button>
            <button
              class="btn btn-primary"
              :disabled="priceLoading || pricePreviewLoading || !isValidPriceInput(priceForm.newPrice) || (priceForm.settleBalance && priceDiff > 0 && priceDiff > (pricePreview?.userBalance || priceTarget?.user?.balance || 0))"
              @click="submitUpdatePrice"
            >
              {{ priceLoading ? $t('common.processing') : $t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 切换方案弹窗 -->
    <Teleport to="body">
      <div v-if="showUpgradeModal" class="modal-overlay" @click.self="showUpgradeModal = false">
        <div class="modal-content max-w-lg">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('admin.billing.upgradePlanTitle') }}</h3>
            <button class="btn btn-ghost btn-sm" @click="showUpgradeModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body space-y-4">
            <p class="text-themed-secondary">
              {{ $t('admin.billing.targetInstance') }}: <strong>{{ upgradeTarget?.name }}</strong>
            </p>

            <!-- 加载中 -->
            <div v-if="upgradeLoading" class="py-8 text-center">
              <LoadingSpinner size="xl" color="primary" class="mx-auto" />
              <p class="mt-2 text-themed-muted">{{ $t('common.loading') }}</p>
            </div>

            <template v-else-if="upgradeData.currentPlan">
              <!-- 当前方案信息 -->
              <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <h4 class="text-sm font-medium text-themed-secondary mb-2">{{ $t('admin.billing.currentPlan') }}</h4>
                <div class="grid grid-cols-2 gap-2 text-sm">
                  <div>{{ $t('admin.billing.planName') }}: <strong>{{ upgradeData.currentPlan.name }}</strong></div>
                  <div>{{ $t('admin.billing.monthlyPrice') }}: <strong>¥{{ upgradeData.currentPlan.monthlyPrice.toFixed(2) }}</strong></div>
                  <div>CPU: <strong>{{ upgradeData.currentPlan.cpu }}%</strong></div>
                  <div>{{ $t('admin.billing.memoryLabel') }}: <strong>{{ upgradeData.currentPlan.memory }}MB</strong></div>
                  <div>{{ $t('admin.billing.diskLabel') }}: <strong>{{ upgradeData.currentPlan.disk }}MB</strong></div>
                  <div>{{ $t('admin.billing.remainingDays') }}: <strong>{{ Math.ceil(upgradeData.remainingDays) }} {{ $t('admin.billing.days') }}</strong></div>
                </div>
              </div>

              <!-- 可升级方案列表 -->
              <div v-if="upgradeData.availablePlans.length > 0">
                <label class="label">{{ $t('admin.billing.selectNewPlan') }} *</label>
                <div class="space-y-2 max-h-48 overflow-y-auto">
                  <label 
                    v-for="plan in upgradeData.availablePlans" 
                    :key="plan.id"
                    class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                    :class="selectedPlanId === plan.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-themed hover:bg-gray-50 dark:hover:bg-gray-800'"
                  >
                    <input v-model="selectedPlanId" type="radio" :value="plan.id" class="radio mt-1" />
                    <div class="flex-1">
                      <div class="font-medium">{{ plan.name }}</div>
                      <div class="text-sm text-themed-muted">
                        ¥{{ plan.price.toFixed(2) }} / {{ formatBillingCycle(plan.billingCycle) }}
                        (¥{{ plan.monthlyPrice.toFixed(2) }}/{{ $t('admin.billing.month') }})
                      </div>
                      <div class="text-xs text-themed-muted mt-1">
                        CPU {{ plan.cpu }}% | {{ plan.memory }}MB RAM | {{ plan.disk }}MB {{ $t('admin.billing.diskLabel') }}
                      </div>
                    </div>
                  </label>
                </div>
              </div>
              <div v-else class="p-4 text-center text-themed-muted bg-gray-50 dark:bg-gray-800 rounded-lg">
                {{ $t('admin.billing.noAvailablePlans') }}
              </div>

              <!-- 差价计算结果 -->
              <div v-if="selectedPlanId" class="p-3 rounded-lg border" :class="upgradePriceDiff > upgradeData.userBalance ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'">
                <div class="flex justify-between items-center">
                  <span :class="upgradePriceDiff > upgradeData.userBalance ? 'text-red-700 dark:text-red-300' : 'text-blue-700 dark:text-blue-300'">{{ $t('admin.billing.priceDifference') }}:</span>
                  <span class="text-xl font-bold" :class="upgradePriceDiff > upgradeData.userBalance ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'">¥{{ upgradePriceDiff.toFixed(2) }}</span>
                </div>
                <div class="flex justify-between items-center mt-1">
                  <span :class="upgradePriceDiff > upgradeData.userBalance ? 'text-red-700 dark:text-red-300' : 'text-blue-700 dark:text-blue-300'" class="text-sm">{{ $t('admin.billing.userBalance') }}:</span>
                  <span class="font-medium" :class="upgradePriceDiff > upgradeData.userBalance ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'">¥{{ upgradeData.userBalance.toFixed(2) }}</span>
                </div>
                <p v-if="upgradePriceDiff > upgradeData.userBalance" class="text-xs text-red-600 dark:text-red-400 mt-2 font-medium">
                  ⚠️ {{ $t('admin.billing.insufficientBalance') }}
                </p>
                <p v-else class="text-xs mt-1" :class="upgradePriceDiff > upgradeData.userBalance ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'">
                  {{ $t('admin.billing.priceDifferenceHint') }}
                </p>
              </div>
            </template>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showUpgradeModal = false">{{ $t('common.cancel') }}</button>
            <button
              class="btn btn-primary"
              :disabled="upgradeSubmitting || !selectedPlanId || upgradeData.availablePlans.length === 0"
              @click="executeUpgrade"
            >
              {{ upgradeSubmitting ? $t('common.processing') : $t('admin.billing.confirmUpgrade') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
