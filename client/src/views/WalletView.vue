<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { useConfigStore } from '@/stores/config'
import TermsOfServiceModal from '@/components/TermsOfServiceModal.vue'
import { freeSiteCopy } from '@/utils/freeSiteFun'

const { t } = useI18n()
const toast = useToast()
const router = useRouter()
const route = useRoute()
const themeStore = useThemeStore()
const configStore = useConfigStore()

type WalletTab = 'balance' | 'logs' | 'records' | 'aff'
type MetricTone = 'slate' | 'emerald' | 'rose' | 'amber' | 'blue' | 'violet'

interface WalletMetric {
  label: string
  value: string
  tone: MetricTone
}

// 当前 TAB
const activeTab = ref<WalletTab>('balance')
const walletTabs = computed((): Array<{ key: WalletTab; label: string }> => [
  { key: 'balance', label: configStore.freeSiteMode ? freeSiteCopy.walletBalanceTab : t('wallet.tabs.balance') },
  { key: 'logs', label: configStore.freeSiteMode ? freeSiteCopy.walletLogsTab : t('wallet.tabs.logs') },
  ...(
    configStore.freeSiteMode
      ? []
      : [
          { key: 'records' as WalletTab, label: t('wallet.tabs.records') },
          { key: 'aff' as WalletTab, label: t('aff.title') }
        ]
  )
])

// 余额数据
const balance = ref({
  balance: 0,
  totalRecharge: 0,
  totalConsume: 0,
  destroyedValue: 0
})
const loading = ref(true)

// 余额日志
const logs = ref<any[]>([])
const logsLoading = ref(false)
const logsPage = ref(1)
const logsPageSize = ref(10)
const logsTotal = ref(0)
const showLotteryGiftOnly = ref(false) // 抽奖赠送筛选：false=排除抽奖赠送, true=仅显示抽奖赠送

// 充值弹窗
const showRechargeModal = ref(false)
const rechargeLoading = ref(false)
const providers = ref<any[]>([])
const selectedProvider = ref<number | null>(null)
const rechargeAmount = ref(10)
// 新增：支付方式选择
const selectedPaymentMethod = ref<string>('')
// 服务条款勾选
const agreedToTerms = ref(false)
const showTermsModal = ref(false)
// 无退款确认
const agreedToNoRefund = ref(false)
const agreedToRechargeNotice = ref(false)

// 充值记录
const rechargeRecords = ref<any[]>([])
const recordsLoading = ref(false)
const recordsPage = ref(1)
const recordsPageSize = ref(10)
const recordsTotal = ref(0)

// 操作加载状态
const repayLoading = ref<string | null>(null)
const cancelLoading = ref<string | null>(null)

// AFF 推荐计划数据
interface AffStatus {
  activated: boolean
  totalEarnings: number
  totalConverted: number
  currentBalance: number
  totalCodes: number
  totalUsed: number
}
interface AffCode {
  id: number
  code: string
  packagePlanId: number | null
  planName: string | null
  packageName: string | null
  price: number | null
  discountRate: number
  commissionRate: number
  usedCount: number
  totalEarnings: number
  createdAt: string
  isGlobal: boolean
}
interface AffPlan {
  id: number
  name: string
  packageName: string
  price: string
  hasCode: boolean
}
interface AffLog {
  id: number
  type: string
  amount: number
  originalAmount: number | null
  balanceBefore: number
  balanceAfter: number
  instanceId: number | null
  affCodeId: number | null
  affCode: string | null
  remark: string | null
  createdAt: string
}
interface AffWithdrawal {
  id: number
  amount: number
  status: string
  rejectReason: string | null
  createdAt: string
  reviewedAt: string | null
}

const affStatus = ref<AffStatus | null>(null)
const affCodes = ref<AffCode[]>([])
const affPlans = ref<AffPlan[]>([])
const affLogs = ref<AffLog[]>([])
const affWithdrawals = ref<AffWithdrawal[]>([])
const affLoading = ref(false)
const affCodesLoading = ref(false)
const affPlansLoading = ref(false)
const affLogsLoading = ref(false)
const affWithdrawalsLoading = ref(false)
const affLogsPage = ref(1)
const affLogsPageSize = ref(10)
const affLogsTotal = ref(0)
const affWithdrawalsPage = ref(1)
const affWithdrawalsPageSize = ref(10)
const affWithdrawalsTotal = ref(0)

// 创建优惠码弹窗
const showCreateCodeModal = ref(false)
const createCodeLoading = ref(false)
const selectedPlanId = ref<number | null>(null)

// 删除优惠码
const deleteCodeLoading = ref<number | null>(null)

// 转化申请弹窗
const showConvertModal = ref(false)
const convertLoading = ref(false)
const convertAmount = ref<number>(0)

// AFF 榜单弹窗
interface LeaderboardEntry {
  rank: number
  username: string
  totalEarnings: number
  isCurrentUser: boolean
}
const showLeaderboardModal = ref(false)
const leaderboardLoading = ref(false)
const leaderboard = ref<LeaderboardEntry[]>([])

// 充值验证状态
const verifyingRecharge = ref(false)

onMounted(async () => {
  await configStore.loadPublicConfig()
  loadBalance()
  
  // 处理支付回调参数
  if (!configStore.freeSiteMode && route.query.recharge === 'success') {
    const orderNo = route.query.out_trade_no as string
    
    // 清除 URL 参数，避免刷新页面重复处理
    router.replace({ path: '/wallet' })
    
    // 切换到充值记录标签页
    switchTab('records')
    
    if (orderNo) {
      // 有订单号，主动查询易支付订单状态
      await verifyRechargeOrder(orderNo)
    } else {
      // 没有订单号，显示等待到账提示
      toast.info(t('wallet.verifyingPayment'))
      // 刷新余额和记录
      loadBalance()
      loadRecords()
    }
  }
})

// 验证充值订单状态
async function verifyRechargeOrder(orderNo: string) {
  verifyingRecharge.value = true
  try {
    toast.info(t('wallet.verifyingPayment'))
    
    const res = await api.billing.verifyRechargeOrder(orderNo)
    
    if (res.verified && res.status === 'completed') {
      // 支付成功，已到账
      toast.success(t('wallet.rechargeSuccess'))
      // 刷新余额
      loadBalance()
    } else if (res.status === 'pending') {
      // 订单待支付，可能回调还没到
      toast.info(t('wallet.paymentProcessing'))
    } else if (res.status === 'failed') {
      // 支付失败或金额异常
      toast.error(res.message || t('wallet.verifyFailed'))
    } else if (res.status === 'cancelled') {
      // 订单已取消
      toast.warning(t('wallet.orderCancelled'))
    } else if (res.message && res.message.includes('不匹配')) {
      // 金额不匹配
      toast.error(t('wallet.amountMismatch'))
    } else {
      // 其他状态
      toast.info(res.message || t('wallet.verifyingPayment'))
    }
    
    // 刷新充值记录
    loadRecords()
  } catch (err: any) {
    console.error('Verify recharge order failed:', err)
    toast.error(t('wallet.verifyFailed'))
    // 仍然刷新记录
    loadRecords()
  } finally {
    verifyingRecharge.value = false
  }
}

async function loadBalance() {
  loading.value = true
  try {
    const res = await api.billing.getUserBalance()
    balance.value = {
      ...balance.value,
      ...res.balance
    }
  } catch (err: any) {
    console.error('Failed to load balance:', err)
  } finally {
    loading.value = false
  }
}

async function loadLogs() {
  logsLoading.value = true
  try {
    const res = await api.billing.getBalanceLogs({
      page: logsPage.value,
      pageSize: logsPageSize.value,
      lotteryGift: showLotteryGiftOnly.value ? 'only' : 'exclude'
    })
    logs.value = res.records || []
    logsTotal.value = res.total
  } catch (err: any) {
    toast.error(t('wallet.loadLogsFailed') + ': ' + err.message)
  } finally {
    logsLoading.value = false
  }
}

async function loadProviders() {
  try {
    const res = await api.billing.getPaymentProviders()
    providers.value = res.providers || []
    if (providers.value.length > 0) {
      selectedProvider.value = providers.value[0].id
      // 自动选中第一个支付方式
      updateDefaultPaymentMethod(providers.value[0])
    }
  } catch (err: any) {
    toast.error(t('wallet.loadProvidersFailed') + ': ' + err.message)
  }
}

// 更新默认支付方式
function updateDefaultPaymentMethod(provider: any) {
  if (provider?.type === 'heleket') {
    selectedPaymentMethod.value = ''
  } else if (provider && provider.methods && provider.methods.length > 0) {
    selectedPaymentMethod.value = provider.methods[0]
  } else {
    selectedPaymentMethod.value = ''
  }
}

// 监听支付渠道变化，自动更新默认支付方式
watch(selectedProvider, (newProviderId) => {
  if (newProviderId) {
    const provider = providers.value.find(p => p.id === newProviderId)
    updateDefaultPaymentMethod(provider)
  }
})

async function loadRecords() {
  recordsLoading.value = true
  try {
    const res = await api.billing.getRechargeOrders({
      page: recordsPage.value,
      pageSize: recordsPageSize.value
    })
    rechargeRecords.value = res.records || []
    recordsTotal.value = res.total
  } catch (err: any) {
    toast.error(t('wallet.loadRecordsFailed') + ': ' + err.message)
  } finally {
    recordsLoading.value = false
  }
}

// 重新支付订单
async function repayOrder(orderNo: string) {
  repayLoading.value = orderNo
  try {
    const res = await api.billing.repayRechargeOrder(orderNo)
    if (res.payUrl) {
      toast.success(t('wallet.redirecting'))
      setTimeout(() => {
        window.location.href = res.payUrl
      }, 500)
    } else {
      toast.error(t('wallet.noPayUrl'))
    }
  } catch (err: any) {
    toast.error(t('wallet.repayFailed') + ': ' + err.message)
  } finally {
    repayLoading.value = null
  }
}

// 取消订单
async function cancelOrder(orderNo: string) {
  cancelLoading.value = orderNo
  try {
    await api.billing.cancelRechargeOrder(orderNo)
    toast.success(t('wallet.orderCancelled'))
    loadRecords()
  } catch (err: any) {
    toast.error(t('wallet.cancelFailed') + ': ' + err.message)
  } finally {
    cancelLoading.value = null
  }
}

function switchTab(tab: WalletTab) {
  if (configStore.freeSiteMode && (tab === 'records' || tab === 'aff')) {
    activeTab.value = 'balance'
    return
  }

  activeTab.value = tab
  if (tab === 'logs' && logs.value.length === 0) {
    loadLogs()
  } else if (tab === 'records' && rechargeRecords.value.length === 0) {
    loadRecords()
  } else if (tab === 'aff' && affStatus.value === null) {
    loadAffStatus()
  }
}

function openRechargeModal() {
  if (configStore.freeSiteMode) return
  rechargeAmount.value = 10
  agreedToTerms.value = false
  agreedToNoRefund.value = false
  agreedToRechargeNotice.value = false
  loadProviders()
  showRechargeModal.value = true
}

async function createRechargeOrder() {
  if (configStore.freeSiteMode) return

  if (!selectedProvider.value) {
    toast.error(t('wallet.selectProvider'))
    return
  }
  if (rechargeAmount.value <= 0) {
    toast.error(t('wallet.invalidAmount'))
    return
  }

  rechargeLoading.value = true
  try {
    // 获取选中的支付方式
    const provider = providers.value.find(p => p.id === selectedProvider.value)
    let paymentMethod = ''
    if (provider && provider.type !== 'heleket' && provider.methods && provider.methods.length > 0) {
      // 如果用户选择了特定支付方式，使用该方式；否则使用默认第一个
      paymentMethod = selectedPaymentMethod.value || provider.methods[0]
    }
    
    const res = await api.billing.createRechargeOrder(selectedProvider.value, rechargeAmount.value, paymentMethod)
    
    // 如果有支付链接，跳转支付
    if (res.payUrl) {
      toast.success(t('wallet.redirecting'))
      showRechargeModal.value = false
      const payUrl = res.payUrl
      setTimeout(() => {
        window.location.href = payUrl
      }, 500)
      return
    }
    
    // 如果没有支付链接（如人工充值）
    toast.success(t('wallet.orderCreated'))
    showRechargeModal.value = false
    toast.info(`${t('wallet.orderNo')}: ${res.order.orderNo}`)
    
    // 刷新记录
    if (activeTab.value === 'records') {
      loadRecords()
    }
  } catch (err: any) {
    toast.error(t('wallet.createOrderFailed') + ': ' + err.message)
  } finally {
    rechargeLoading.value = false
  }
}

function formatMoney(amount: number): string {
  return `¥${amount.toFixed(2)}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

function getLogTypeName(type: string): string {
  const map: Record<string, string> = {
    recharge: t('wallet.logTypes.recharge'),
    consume: t('wallet.logTypes.consume'),
    refund: t('wallet.logTypes.refund'),
    admin_adjust: t('wallet.logTypes.adminAdjust'),
    gift: t('wallet.logTypes.gift'),
    transfer_fee: t('wallet.logTypes.transferFee'),
    transfer_refund: t('wallet.logTypes.transferRefund'),
    hosting_withdraw: t('wallet.logTypes.hostingWithdraw'),
    hosting_deduction: t('wallet.logTypes.hostingDeduction'),
    invite_generate: '生成邀请码'
  }
  return map[type] || type
}

function getStatusName(status: string): string {
  const map: Record<string, string> = {
    pending: t('wallet.status.pending'),
    paid: t('wallet.status.paid'),
    completed: t('wallet.status.completed'),
    failed: t('wallet.status.failed'),
    cancelled: t('wallet.status.cancelled'),
    refunded: t('wallet.status.refunded')
  }
  return map[status] || status
}

function getPaymentMethodName(method: string): string {
  const map: Record<string, string> = {
    alipay: t('wallet.paymentMethods.alipay'),
    wxpay: t('wallet.paymentMethods.wxpay'),
    qqpay: t('wallet.paymentMethods.qqpay'),
    bank: t('wallet.paymentMethods.bank'),
    jdpay: t('wallet.paymentMethods.jdpay'),
  }
  if (map[method]) {
    return map[method]
  }

  const normalized = method.trim()
  const matched = normalized.match(/^([A-Za-z0-9._-]+)\s*(?:[@:/]\s*([A-Za-z0-9._-]+))?$/)
  if (!matched) {
    return normalized || method
  }

  const currency = matched[1]?.toUpperCase() || normalized
  const network = matched[2]?.toUpperCase()
  return network ? `${currency} (${network})` : currency
}

function getRechargeMethodDisplay(rec: any): string {
  if (rec.actualPaymentMethod) {
    return getPaymentMethodName(rec.actualPaymentMethod)
  }
  if (rec.paymentMethod) {
    return getPaymentMethodName(rec.paymentMethod)
  }
  return ''
}

function getRechargeCreditLabelKey(status: string): string {
  return status === 'completed' ? 'wallet.actualAmount' : 'wallet.estimatedAmount'
}

function getRechargeGatewayStatusText(rec: any): string {
  return rec.status === 'pending' && rec.gatewayStatusDescription ? rec.gatewayStatusDescription : ''
}

// 检查订单是否已过期
function isOrderExpired(expiredAt: string | null): boolean {
  if (!expiredAt) return false
  return new Date(expiredAt) < new Date()
}

function getTagClass(tone: MetricTone): string {
  const map: Record<MetricTone, string> = {
    slate: 'border-zinc-200/80 bg-white text-zinc-700 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300',
    emerald: 'border-emerald-200/80 bg-emerald-50/70 text-emerald-700 dark:border-emerald-500/15 dark:bg-emerald-500/[0.08] dark:text-emerald-200',
    rose: 'border-rose-200/80 bg-rose-50/70 text-rose-700 dark:border-rose-500/15 dark:bg-rose-500/[0.08] dark:text-rose-200',
    amber: 'border-amber-200/80 bg-amber-50/70 text-amber-700 dark:border-amber-500/15 dark:bg-amber-500/[0.08] dark:text-amber-200',
    blue: 'border-blue-200/80 bg-blue-50/70 text-blue-700 dark:border-blue-500/15 dark:bg-blue-500/[0.08] dark:text-blue-200',
    violet: 'border-violet-200/80 bg-violet-50/70 text-violet-700 dark:border-violet-500/15 dark:bg-violet-500/[0.08] dark:text-violet-200'
  }

  return map[tone]
}

function getMetricDotClass(tone: MetricTone): string {
  const map: Record<MetricTone, string> = {
    slate: 'bg-zinc-400 dark:bg-zinc-500',
    emerald: 'bg-emerald-500/70 dark:bg-emerald-400/80',
    rose: 'bg-rose-500/70 dark:bg-rose-400/80',
    amber: 'bg-amber-500/70 dark:bg-amber-400/80',
    blue: 'bg-blue-500/70 dark:bg-blue-400/80',
    violet: 'bg-violet-500/70 dark:bg-violet-400/80'
  }

  return map[tone]
}

function getAmountValueClass(amount: number): string {
  return amount >= 0
    ? 'text-emerald-700 dark:text-emerald-200'
    : 'text-zinc-950 dark:text-zinc-100'
}

function getLogTypeTagClass(type: string): string {
  const map: Record<string, MetricTone> = {
    recharge: 'emerald',
    refund: 'blue',
    admin_adjust: 'blue',
    gift: 'violet',
    transfer_refund: 'blue',
    consume: 'rose',
    transfer_fee: 'amber',
    hosting_withdraw: 'amber',
    hosting_deduction: 'rose',
    invite_generate: 'violet'
  }

  return getTagClass(map[type] || 'slate')
}

function getStatusTagClass(status: string): string {
  const map: Record<string, MetricTone> = {
    pending: 'amber',
    paid: 'blue',
    completed: 'emerald',
    failed: 'rose',
    cancelled: 'slate',
    refunded: 'violet'
  }

  return getTagClass(map[status] || 'slate')
}

function getAffLogTypeTagClass(type: string): string {
  const map: Record<string, MetricTone> = {
    new_purchase: 'emerald',
    renew: 'blue',
    convert: 'violet'
  }

  return getTagClass(map[type] || 'slate')
}

function getWithdrawalStatusTagClass(status: string): string {
  const map: Record<string, MetricTone> = {
    pending: 'amber',
    approved: 'emerald',
    rejected: 'rose'
  }

  return getTagClass(map[status] || 'slate')
}

const logsTotalPages = computed(() => Math.ceil(logsTotal.value / logsPageSize.value))
const recordsTotalPages = computed(() => Math.ceil(recordsTotal.value / recordsPageSize.value))
const selectedProviderInfo = computed(() => providers.value.find(p => p.id === selectedProvider.value))
function getSelectedPaymentMethodForProvider(provider: any): string {
  if (!provider || provider.type === 'heleket') return ''
  if (!provider.methods || provider.methods.length === 0) return ''
  return selectedPaymentMethod.value || provider.methods[0]
}

function getProviderFeeConfig(provider: any, method?: string): { feeRate: number; feeFixed: number } {
  const methodFee = provider?.type === 'yipay' && method && provider?.methodFees ? provider.methodFees[method] : null
  if (methodFee) {
    return {
      feeRate: Number(methodFee.feeRate || 0),
      feeFixed: Number(methodFee.feeFixed || 0)
    }
  }

  return {
    feeRate: Number(provider?.feeRate || 0),
    feeFixed: Number(provider?.feeFixed || 0)
  }
}

const selectedFeeConfig = computed(() => {
  const provider = selectedProviderInfo.value
  return getProviderFeeConfig(provider, getSelectedPaymentMethodForProvider(provider))
})

const selectedRechargeFee = computed(() => {
  const amount = Number(rechargeAmount.value || 0)
  const feeRate = selectedFeeConfig.value.feeRate
  const feeFixed = selectedFeeConfig.value.feeFixed
  return Math.max(0, Math.round((amount * feeRate + feeFixed) * 100) / 100)
})

const selectedFeeIsSurcharge = computed(() => selectedProviderInfo.value?.type === 'yipay')

const selectedPayableAmount = computed(() => {
  const amount = Number(rechargeAmount.value || 0)
  const total = selectedFeeIsSurcharge.value ? amount + selectedRechargeFee.value : amount
  return Math.max(0, Math.round(total * 100) / 100)
})

const selectedCreditAmount = computed(() => {
  const amount = Number(rechargeAmount.value || 0)
  const total = selectedFeeIsSurcharge.value ? amount : amount - selectedRechargeFee.value
  return Math.max(0, Math.round(total * 100) / 100)
})
const affLogsTotalPages = computed(() => Math.ceil(affLogsTotal.value / affLogsPageSize.value))
const affWithdrawalsTotalPages = computed(() => Math.ceil(affWithdrawalsTotal.value / affWithdrawalsPageSize.value))
const logsPositiveAmount = computed(() => logs.value.filter(log => log.amount > 0).reduce((sum, log) => sum + log.amount, 0))
const logsNegativeAmount = computed(() => logs.value.filter(log => log.amount < 0).reduce((sum, log) => sum + Math.abs(log.amount), 0))
const pendingRechargeCount = computed(() => rechargeRecords.value.filter(rec => rec.status === 'pending' && !isOrderExpired(rec.expiredAt)).length)
const completedRechargeCount = computed(() => rechargeRecords.value.filter(rec => ['paid', 'completed'].includes(rec.status)).length)
const expiredRechargeCount = computed(() => rechargeRecords.value.filter(rec => rec.status === 'pending' && isOrderExpired(rec.expiredAt)).length)
const affPendingWithdrawalCount = computed(() => affWithdrawals.value.filter(withdrawal => withdrawal.status === 'pending').length)
const balanceMetrics = computed<WalletMetric[]>(() => [
  { label: configStore.freeSiteMode ? freeSiteCopy.walletTotalRecharge : t('wallet.totalRecharge'), value: formatMoney(balance.value.totalRecharge), tone: 'emerald' },
  { label: configStore.freeSiteMode ? freeSiteCopy.walletTotalConsume : t('wallet.totalConsume'), value: formatMoney(balance.value.totalConsume), tone: 'rose' },
  { label: configStore.freeSiteMode ? freeSiteCopy.walletDestroyedValue : t('wallet.totalDestroyedValue'), value: formatMoney(balance.value.destroyedValue), tone: 'slate' }
])
const logMetrics = computed<WalletMetric[]>(() => [
  { label: configStore.freeSiteMode ? freeSiteCopy.walletTotalRecharge : t('wallet.totalRecharge'), value: formatMoney(logsPositiveAmount.value), tone: 'emerald' },
  { label: configStore.freeSiteMode ? freeSiteCopy.walletTotalConsume : t('wallet.totalConsume'), value: formatMoney(logsNegativeAmount.value), tone: 'rose' }
])
const recordMetrics = computed<WalletMetric[]>(() => [
  { label: t('wallet.status.pending'), value: pendingRechargeCount.value.toLocaleString(), tone: 'amber' },
  { label: t('wallet.status.completed'), value: completedRechargeCount.value.toLocaleString(), tone: 'emerald' },
  { label: t('wallet.orderExpired'), value: expiredRechargeCount.value.toLocaleString(), tone: 'slate' }
])
const affMetrics = computed<WalletMetric[]>(() => {
  if (!affStatus.value) return []
  return [
    { label: t('aff.totalEarnings'), value: formatMoney(affStatus.value.totalEarnings), tone: 'emerald' },
    { label: t('aff.myCodes'), value: affStatus.value.totalCodes.toLocaleString(), tone: 'blue' },
    { label: t('aff.usedCount'), value: affStatus.value.totalUsed.toLocaleString(), tone: 'amber' },
    { label: t('aff.withdrawalStatus.pending'), value: affPendingWithdrawalCount.value.toLocaleString(), tone: 'violet' }
  ]
})

// AFF 加载函数
async function loadAffStatus() {
  affLoading.value = true
  try {
    const res = await api.aff.getStatus()
    affStatus.value = res as AffStatus
    // 如果已激活，加载优惠码列表
    if (affStatus.value?.activated) {
      loadAffCodes()
      loadAffLogs()
      loadAffWithdrawals()
    }
  } catch (err: any) {
    console.error('Failed to load AFF status:', err)
  } finally {
    affLoading.value = false
  }
}

async function loadAffCodes() {
  affCodesLoading.value = true
  try {
    const res = await api.aff.getCodes()
    affCodes.value = (res as any).codes || []
  } catch (err: any) {
    console.error('Failed to load AFF codes:', err)
  } finally {
    affCodesLoading.value = false
  }
}

async function loadAffPlans() {
  affPlansLoading.value = true
  try {
    const res = await api.aff.getAvailablePlans()
    affPlans.value = (res as any).plans || []
  } catch (err: any) {
    console.error('Failed to load AFF plans:', err)
  } finally {
    affPlansLoading.value = false
  }
}

async function loadAffLogs() {
  affLogsLoading.value = true
  try {
    const res = await api.aff.getLogs({
      page: affLogsPage.value,
      pageSize: affLogsPageSize.value
    })
    affLogs.value = (res as any).logs || []
    affLogsTotal.value = (res as any).total || 0
  } catch (err: any) {
    console.error('Failed to load AFF logs:', err)
  } finally {
    affLogsLoading.value = false
  }
}

async function loadAffWithdrawals() {
  affWithdrawalsLoading.value = true
  try {
    const res = await api.aff.getWithdrawals({
      page: affWithdrawalsPage.value,
      pageSize: affWithdrawalsPageSize.value
    })
    affWithdrawals.value = (res as any).withdrawals || []
    affWithdrawalsTotal.value = (res as any).total || 0
  } catch (err: any) {
    console.error('Failed to load AFF withdrawals:', err)
  } finally {
    affWithdrawalsLoading.value = false
  }
}

// 打开创建优惠码弹窗
function openCreateCodeModal() {
  selectedPlanId.value = null
  loadAffPlans()
  showCreateCodeModal.value = true
}

// 创建优惠码
async function createAffCode() {
  if (selectedPlanId.value === null) return
  createCodeLoading.value = true
  try {
    // selectedPlanId = -1 表示全局码
    if (selectedPlanId.value === -1) {
      await api.aff.createCode(undefined)
    } else {
      await api.aff.createCode(selectedPlanId.value)
    }
    toast.success(t('aff.createSuccess'))
    showCreateCodeModal.value = false
    loadAffCodes()
    loadAffPlans() // 刷新全局码状态
  } catch (err: any) {
    toast.error(t('aff.createFailed') + ': ' + err.message)
  } finally {
    createCodeLoading.value = false
  }
}

// 打开转化申请弹窗
function openConvertModal() {
  convertAmount.value = affStatus.value?.currentBalance || 0
  showConvertModal.value = true
}

// 打开 AFF 榜单弹窗
async function openLeaderboardModal() {
  showLeaderboardModal.value = true
  leaderboardLoading.value = true
  try {
    const res = await api.aff.getLeaderboard()
    leaderboard.value = res.leaderboard
  } catch (err: any) {
    toast.error(t('aff.leaderboard.loadFailed') + ': ' + err.message)
  } finally {
    leaderboardLoading.value = false
  }
}

// 获取榜单排名样式
function getRankStyle(rank: number): string {
  if (rank === 1) return 'bg-gradient-to-r from-amber-400 to-yellow-300 text-amber-900'
  if (rank === 2) return 'bg-gradient-to-r from-gray-300 to-gray-200 text-gray-700'
  if (rank === 3) return 'bg-gradient-to-r from-amber-600 to-amber-500 text-amber-100'
  return 'bg-themed-secondary text-themed'
}

// 获取榜单排名 emoji
function getRankEmoji(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return ''
}

// 提交转化申请
async function submitConvert() {
  if (convertAmount.value < 0.1) {
    toast.error(t('aff.convertModal.invalidAmount'))
    return
  }
  convertLoading.value = true
  try {
    await api.aff.createConvert(convertAmount.value)
    toast.success(t('aff.convertModal.success'))
    showConvertModal.value = false
    // 刷新 AFF 状态和转化记录
    loadAffStatus()
    loadAffWithdrawals()
    // 刷新账户余额（转化成功后已转入主余额）
    loadBalance()
    // 切换到账户余额标签页，让用户看到更新后的余额
    switchTab('balance')
  } catch (err: any) {
    toast.error(t('aff.convertModal.failed') + ': ' + err.message)
  } finally {
    convertLoading.value = false
  }
}

// AFF 日志类型名称
function getAffLogTypeName(type: string): string {
  const map: Record<string, string> = {
    new_purchase: t('aff.logType.new_purchase'),
    renew: t('aff.logType.renew'),
    convert: t('aff.logType.convert')
  }
  return map[type] || type
}

// AFF 转化状态名称
function getWithdrawalStatusName(status: string): string {
  const map: Record<string, string> = {
    pending: t('aff.withdrawalStatus.pending'),
    approved: t('aff.withdrawalStatus.approved'),
    rejected: t('aff.withdrawalStatus.rejected')
  }
  return map[status] || status
}

// AFF 转化状态样式
// 复制优惠码
async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toast.success(t('common.copied'))
  } catch {
    toast.error(t('common.copyFailed'))
  }
}

// 删除优惠码
async function deleteAffCode(codeId: number, code: string) {
  if (!confirm(t('aff.deleteCodeConfirm', { code }))) {
    return
  }
  
  deleteCodeLoading.value = codeId
  try {
    await api.aff.deleteCode(codeId)
    toast.success(t('aff.deleteCodeSuccess'))
    loadAffCodes()
  } catch (err: any) {
    toast.error(t('aff.deleteCodeFailed') + ': ' + err.message)
  } finally {
    deleteCodeLoading.value = null
  }
}

// 格式化金额：限制两位小数
function formatAmount() {
  if (rechargeAmount.value) {
    rechargeAmount.value = Math.round(rechargeAmount.value * 100) / 100
  }
}
</script>

<template>
  <div class="animate-fade-in">
    <!-- 顶部胶囊 Tabs -->
    <div class="mb-4 flex justify-center overflow-x-auto pb-1 sm:mb-5">
      <div
        class="inline-flex max-w-full min-w-max rounded-full p-1"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
        role="tablist"
        :aria-label="$t('wallet.title')"
      >
        <button
          v-for="tab in walletTabs"
          :key="tab.key"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.key"
          class="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 focus-visible:outline-none sm:px-5"
          :class="activeTab === tab.key
            ? themeStore.isDark
              ? 'bg-white text-gray-900 shadow-lg'
              : 'bg-gray-900 text-white shadow-lg'
            : themeStore.isDark
              ? 'text-gray-400 hover:text-gray-200'
              : 'text-gray-600 hover:text-gray-900'"
          @click="switchTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- 账户余额 TAB -->
    <div v-show="activeTab === 'balance'" class="space-y-6">
      <div class="card rounded-[28px] border border-zinc-200/80 bg-white/95 p-6 shadow-[0_24px_80px_-56px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-zinc-950/60 sm:p-8">
        <div v-if="loading" class="animate-pulse space-y-6">
          <div class="h-3 w-24 rounded bg-themed-secondary"></div>
          <div class="h-16 w-64 rounded bg-themed-secondary"></div>
          <div class="grid gap-3 sm:grid-cols-3">
            <div v-for="i in 3" :key="i" class="h-32 rounded-3xl bg-themed-secondary"></div>
          </div>
        </div>
        <div v-else>
          <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div class="max-w-3xl">
              <div class="text-xs font-medium uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                {{ configStore.freeSiteMode ? freeSiteCopy.walletCurrentBalance : $t('wallet.currentBalance') }}
              </div>
              <div class="mt-4 text-5xl font-semibold tracking-[-0.05em] text-zinc-950 tabular-nums dark:text-zinc-50 sm:text-6xl">
                {{ formatMoney(balance.balance) }}
              </div>
              <p class="mt-4 max-w-2xl text-sm leading-6 text-themed-muted">
                {{ configStore.freeSiteMode ? freeSiteCopy.walletDescription : $t('wallet.description') }}
              </p>
              <div v-if="!configStore.freeSiteMode" class="mt-7 flex flex-wrap gap-3 lg:hidden">
                <button class="btn btn-primary btn-lg" @click="openRechargeModal">
                  <svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                  </svg>
                  {{ $t('wallet.recharge') }}
                </button>
              </div>
            </div>

            <div v-if="!configStore.freeSiteMode" class="hidden lg:flex lg:flex-shrink-0 lg:justify-end">
              <button class="btn btn-primary btn-lg" @click="openRechargeModal">
                <svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                {{ $t('wallet.recharge') }}
              </button>
            </div>
          </div>

          <div class="mt-8 grid gap-3 lg:grid-cols-3">
            <div
              v-for="metric in balanceMetrics"
              :key="metric.label"
              class="rounded-3xl border border-zinc-200/80 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full" :class="getMetricDotClass(metric.tone)"></span>
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                  {{ metric.label }}
                </div>
              </div>
              <div class="mt-4 text-[30px] font-semibold tracking-[-0.04em] text-zinc-950 tabular-nums dark:text-zinc-50">
                {{ metric.value }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 余额明细 TAB -->
    <div v-show="activeTab === 'logs'" class="space-y-6">
      <div class="card rounded-[28px] border border-zinc-200/80 bg-white/95 p-6 shadow-[0_24px_80px_-56px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-zinc-950/60 sm:p-7">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div class="text-xs font-medium uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                {{ configStore.freeSiteMode ? freeSiteCopy.walletLogsTab : $t('wallet.tabs.logs') }}
              </div>
              <div class="mt-4 text-4xl font-semibold tracking-[-0.04em] text-zinc-950 tabular-nums dark:text-zinc-50 sm:text-5xl">
                {{ logsTotal.toLocaleString() }}
              </div>
              <div class="mt-2 text-sm text-themed-muted">
                {{ $t('common.total') }} {{ logsTotal }} {{ $t('common.items') }}
              </div>
            </div>

            <button
              class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors"
              :class="showLotteryGiftOnly
                ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:text-zinc-950 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:text-white'"
              @click="showLotteryGiftOnly = !showLotteryGiftOnly; logsPage = 1; loadLogs()"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              {{ showLotteryGiftOnly ? $t('wallet.showingLotteryGift') : $t('wallet.showLotteryGift') }}
            </button>
          </div>

          <div class="grid gap-3 lg:grid-cols-2">
            <div
              v-for="metric in logMetrics"
              :key="metric.label"
              class="rounded-3xl border border-zinc-200/80 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full" :class="getMetricDotClass(metric.tone)"></span>
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                  {{ metric.label }}
                </div>
              </div>
              <div class="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-zinc-950 tabular-nums dark:text-zinc-50">
                {{ metric.value }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/95 dark:border-white/10 dark:bg-zinc-950/60">
        <div class="border-b border-themed px-5 py-5 sm:px-6">
          <div class="text-base font-semibold text-themed">{{ configStore.freeSiteMode ? freeSiteCopy.walletLogsTab : $t('wallet.tabs.logs') }}</div>
          <div class="mt-1 text-sm text-themed-muted">
            {{ showLotteryGiftOnly ? $t('wallet.showingLotteryGift') : (configStore.freeSiteMode ? freeSiteCopy.walletLogsDescription : $t('wallet.description')) }}
          </div>
        </div>

        <div v-if="logsLoading" class="p-8 text-center text-themed-muted">
          {{ $t('common.loading') }}...
        </div>
        <div v-else-if="logs.length === 0" class="p-8 text-center text-themed-muted">
          {{ $t('wallet.noLogs') }}
        </div>
        <div v-else>
          <div class="hidden grid-cols-[minmax(0,1fr)_128px_128px_196px] gap-5 border-b border-themed px-5 py-4 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:grid sm:px-6">
            <div>{{ $t('wallet.instanceOrRemark') }}</div>
            <div>{{ $t('wallet.amount') }}</div>
            <div>{{ $t('wallet.balanceAfter') }}</div>
            <div>{{ $t('wallet.time') }}</div>
          </div>

          <div class="divide-y divide-themed">
            <div
              v-for="log in logs"
              :key="log.id"
              class="grid gap-4 px-5 py-5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-white/[0.03] sm:px-6 lg:grid-cols-[minmax(0,1fr)_128px_128px_196px] lg:items-center lg:py-3.5"
            >
              <div class="min-w-0">
                <div class="lg:hidden">
                  <div class="flex flex-wrap items-center gap-2.5">
                    <span :class="['inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', getLogTypeTagClass(log.type)]">
                      {{ getLogTypeName(log.type) }}
                    </span>
                    <button
                      v-if="log.instanceId"
                      class="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline dark:text-blue-300 dark:hover:text-blue-200"
                      @click="router.push(`/instances/${log.instanceId}`)"
                    >
                      #{{ log.instanceId }}
                    </button>
                  </div>
                  <div class="mt-3 truncate text-[15px] leading-7 text-zinc-500 dark:text-zinc-400">
                    {{ log.remark || '-' }}
                  </div>
                </div>

                <div class="hidden min-w-0 items-center gap-3 lg:flex">
                  <span :class="['inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium', getLogTypeTagClass(log.type)]">
                    {{ getLogTypeName(log.type) }}
                  </span>
                  <button
                    v-if="log.instanceId"
                    class="shrink-0 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline dark:text-blue-300 dark:hover:text-blue-200"
                    @click="router.push(`/instances/${log.instanceId}`)"
                  >
                    #{{ log.instanceId }}
                  </button>
                  <span class="min-w-0 truncate text-[15px] leading-6 text-zinc-600 dark:text-zinc-400">
                    {{ log.remark || '-' }}
                  </span>
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 lg:block">
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                  {{ $t('wallet.amount') }}
                </div>
                <div class="text-[15px] font-semibold tracking-[-0.01em] tabular-nums" :class="getAmountValueClass(log.amount)">
                  {{ log.amount >= 0 ? '+' : '-' }}{{ formatMoney(Math.abs(log.amount)) }}
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 lg:block">
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                  {{ $t('wallet.balanceAfter') }}
                </div>
                <div class="text-[15px] font-medium tracking-[-0.01em] text-zinc-950 tabular-nums dark:text-zinc-50">
                  {{ formatMoney(log.balanceAfter) }}
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 lg:block">
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                  {{ $t('wallet.time') }}
                </div>
                <div class="text-[15px] leading-6 text-zinc-700 dark:text-zinc-300">
                  {{ formatDate(log.createdAt) }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="logsTotalPages > 1" class="flex flex-col gap-3 border-t border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span class="text-sm text-themed-muted">
              {{ $t('common.total') }} {{ logsTotal }} {{ $t('common.items') }}
            </span>
            <div class="flex items-center gap-2">
              <button
                class="btn btn-sm btn-ghost"
                :disabled="logsPage <= 1"
                @click="logsPage--; loadLogs()"
              >
                {{ $t('common.prevPage') }}
              </button>
              <span class="rounded-full border border-themed px-3 py-1.5 text-sm text-themed-muted">
                {{ logsPage }} / {{ logsTotalPages }}
              </span>
              <button
                class="btn btn-sm btn-ghost"
                :disabled="logsPage >= logsTotalPages"
                @click="logsPage++; loadLogs()"
              >
                {{ $t('common.nextPage') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 充值记录 TAB -->
    <div v-if="!configStore.freeSiteMode" v-show="activeTab === 'records'" class="space-y-6">
      <div class="card rounded-[28px] border border-zinc-200/80 bg-white/95 p-6 shadow-[0_24px_80px_-56px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-zinc-950/60 sm:p-7">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div class="text-xs font-medium uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                {{ $t('wallet.tabs.records') }}
              </div>
              <div class="mt-4 text-4xl font-semibold tracking-[-0.04em] text-zinc-950 tabular-nums dark:text-zinc-50 sm:text-5xl">
                {{ recordsTotal.toLocaleString() }}
              </div>
              <div class="mt-2 text-sm text-themed-muted">
                {{ $t('common.total') }} {{ recordsTotal }} {{ $t('common.items') }}
              </div>
              <div v-if="verifyingRecharge" :class="['mt-4 inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium', getTagClass('blue')]">
                {{ $t('wallet.verifyingPayment') }}
              </div>
            </div>

            <button class="btn btn-primary btn-lg" @click="openRechargeModal">
              <svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              {{ $t('wallet.recharge') }}
            </button>
          </div>

          <div class="grid gap-3 lg:grid-cols-3">
            <div
              v-for="metric in recordMetrics"
              :key="metric.label"
              class="rounded-3xl border border-zinc-200/80 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full" :class="getMetricDotClass(metric.tone)"></span>
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                  {{ metric.label }}
                </div>
              </div>
              <div class="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-zinc-950 tabular-nums dark:text-zinc-50">
                {{ metric.value }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/95 dark:border-white/10 dark:bg-zinc-950/60">
        <div class="border-b border-themed px-5 py-5 sm:px-6">
          <div class="text-base font-semibold text-themed">{{ $t('wallet.tabs.records') }}</div>
          <div class="mt-1 text-sm text-themed-muted">{{ $t('wallet.description') }}</div>
        </div>

        <div v-if="recordsLoading" class="p-8 text-center text-themed-muted">
          {{ $t('common.loading') }}...
        </div>
        <div v-else-if="rechargeRecords.length === 0" class="p-8 text-center text-themed-muted">
          {{ $t('wallet.noRecords') }}
        </div>
        <div v-else>
          <div class="hidden grid-cols-[minmax(0,1fr)_110px_150px_110px_188px_auto] gap-5 border-b border-themed px-5 py-4 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:grid sm:px-6">
            <div>{{ $t('wallet.orderNo') }}</div>
            <div>{{ $t('wallet.amount') }}</div>
            <div>{{ $t('wallet.paymentChannel') }}</div>
            <div>{{ $t('wallet.statusLabel') }}</div>
            <div>{{ $t('wallet.time') }}</div>
            <div>{{ $t('common.actions') }}</div>
          </div>

          <div class="divide-y divide-themed">
            <div
              v-for="rec in rechargeRecords"
              :key="rec.id"
              class="grid gap-4 px-5 py-5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-white/[0.03] sm:px-6 lg:grid-cols-[minmax(0,1fr)_110px_150px_110px_188px_auto] lg:items-center lg:py-3.5"
            >
              <div class="min-w-0">
                <div class="lg:hidden">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="truncate text-[15px] font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">{{ rec.orderNo }}</span>
                  </div>
                  <div class="mt-2 text-[15px] leading-7 text-zinc-500 dark:text-zinc-400">
                    {{ rec.provider?.name || '-' }}
                    <span v-if="getRechargeMethodDisplay(rec)">· {{ getRechargeMethodDisplay(rec) }}</span>
                  </div>
                  <div v-if="rec.paymentUuid || rec.paymentTxid || rec.completedAt" class="mt-1 break-all text-xs leading-6 text-zinc-500 dark:text-zinc-400">
                    <span v-if="rec.paymentUuid">{{ $t('wallet.paymentUuid') }} {{ rec.paymentUuid }}</span>
                    <span v-if="rec.paymentUuid && (rec.paymentTxid || rec.completedAt)"> · </span>
                    <span v-if="rec.paymentTxid">{{ $t('wallet.paymentTxid') }} {{ rec.paymentTxid }}</span>
                    <span v-if="rec.paymentTxid && rec.completedAt"> · </span>
                    <span v-if="rec.completedAt">{{ $t('wallet.completedAt') }} {{ formatDate(rec.completedAt) }}</span>
                  </div>
                </div>

                <div class="hidden lg:block">
                  <span class="block truncate text-[15px] font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">
                    {{ rec.orderNo }}
                  </span>
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 lg:block">
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                  {{ $t('wallet.amount') }}
                </div>
                <div class="text-[15px] font-medium tracking-[-0.01em] text-zinc-950 tabular-nums dark:text-zinc-50">
                  {{ formatMoney(rec.amount) }}
                </div>
                <div v-if="rec.actualAmount !== null" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {{ $t(getRechargeCreditLabelKey(rec.status)) }} {{ formatMoney(rec.actualAmount) }}
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 lg:block">
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                  {{ $t('wallet.paymentChannel') }}
                </div>
                <div class="text-[15px] leading-6 text-zinc-700 dark:text-zinc-300 lg:truncate">
                  {{ rec.provider?.name || '-' }}<span v-if="getRechargeMethodDisplay(rec)"> · {{ getRechargeMethodDisplay(rec) }}</span>
                </div>
                <div v-if="rec.paymentUuid" class="mt-1 hidden truncate text-xs text-zinc-500 dark:text-zinc-400 lg:block" :title="rec.paymentUuid">
                  {{ $t('wallet.paymentUuid') }} {{ rec.paymentUuid }}
                </div>
                <div v-if="rec.paymentTxid" class="mt-1 hidden truncate text-xs text-zinc-500 dark:text-zinc-400 lg:block" :title="rec.paymentTxid">
                  {{ $t('wallet.paymentTxid') }} {{ rec.paymentTxid }}
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 lg:block">
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                  {{ $t('wallet.statusLabel') }}
                </div>
                <span :class="['inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', getStatusTagClass(rec.status)]">
                  {{ getStatusName(rec.status) }}
                </span>
                <div v-if="getRechargeGatewayStatusText(rec)" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {{ getRechargeGatewayStatusText(rec) }}
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 lg:block">
                <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                  {{ $t('wallet.time') }}
                </div>
                <div class="text-[15px] leading-6 text-zinc-700 dark:text-zinc-300">
                  {{ formatDate(rec.createdAt) }}
                </div>
                <div v-if="rec.completedAt" class="mt-1 hidden text-xs text-zinc-500 dark:text-zinc-400 lg:block">
                  {{ $t('wallet.completedAt') }} {{ formatDate(rec.completedAt) }}
                </div>
              </div>

              <div class="flex flex-wrap gap-2 lg:justify-end">
                <template v-if="rec.status === 'pending' && !isOrderExpired(rec.expiredAt)">
                  <button
                    class="btn btn-sm btn-primary"
                    :disabled="repayLoading === rec.orderNo"
                    @click="repayOrder(rec.orderNo)"
                  >
                    {{ repayLoading === rec.orderNo ? $t('common.processing') : $t('wallet.pay') }}
                  </button>
                  <button
                    class="btn btn-sm btn-ghost text-red-500 hover:bg-red-500/10"
                    :disabled="cancelLoading === rec.orderNo"
                    @click="cancelOrder(rec.orderNo)"
                  >
                    {{ cancelLoading === rec.orderNo ? $t('common.processing') : $t('wallet.void') }}
                  </button>
                </template>
                <template v-else-if="rec.status === 'pending' && isOrderExpired(rec.expiredAt)">
                  <span :class="['inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium', getTagClass('rose')]">
                    {{ $t('wallet.orderExpired') }}
                  </span>
                </template>
                <template v-else>
                  <span class="text-sm text-themed-muted">-</span>
                </template>
              </div>
            </div>
          </div>

          <div v-if="recordsTotalPages > 1" class="flex flex-col gap-3 border-t border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span class="text-sm text-themed-muted">
              {{ $t('common.total') }} {{ recordsTotal }} {{ $t('common.items') }}
            </span>
            <div class="flex items-center gap-2">
              <button
                class="btn btn-sm btn-ghost"
                :disabled="recordsPage <= 1"
                @click="recordsPage--; loadRecords()"
              >
                {{ $t('common.prevPage') }}
              </button>
              <span class="rounded-full border border-themed px-3 py-1.5 text-sm text-themed-muted">
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
      </div>
    </div>

    <!-- 推荐计划 TAB -->
    <div v-if="!configStore.freeSiteMode" v-show="activeTab === 'aff'" class="space-y-6">
      <!-- 加载中 -->
      <div v-if="affLoading" class="card p-8 text-center text-themed-muted">
        {{ $t('common.loading') }}...
      </div>

      <div v-else-if="affStatus && !affStatus.activated" class="card rounded-[28px] border border-zinc-200/80 bg-white/95 p-8 text-center shadow-[0_24px_80px_-56px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-zinc-950/60 sm:p-10">
        <div>
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-200/80 bg-zinc-50 dark:border-white/10 dark:bg-white/[0.03]">
            <svg class="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 class="text-xl font-semibold text-themed">{{ $t('aff.notActivated') }}</h3>
          <p class="mx-auto mt-3 max-w-2xl text-sm leading-6 text-themed-muted">{{ $t('aff.activateHint') }}</p>
          <div class="mt-6 flex justify-center">
            <button class="btn btn-primary" @click="switchTab('balance'); openRechargeModal()">
              {{ $t('aff.goRecharge') }}
            </button>
          </div>
        </div>
      </div>

      <template v-else-if="affStatus && affStatus.activated">
        <div class="card rounded-[28px] border border-zinc-200/80 bg-white/95 p-6 shadow-[0_24px_80px_-56px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-zinc-950/60 sm:p-8">
          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0 flex-1">
                <div class="text-xs font-medium uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                  {{ $t('aff.affBalance') }}
                </div>
                <div class="mt-4 text-5xl font-semibold tracking-[-0.05em] text-zinc-950 tabular-nums dark:text-zinc-50 sm:text-6xl">
                  {{ formatMoney(affStatus.currentBalance) }}
                </div>
                <p class="mt-4 max-w-2xl text-sm leading-6 text-themed-muted">
                  {{ $t('aff.balanceHint') }}
                </p>
              </div>

              <div class="flex flex-wrap gap-2">
                <button class="btn btn-ghost" @click="openLeaderboardModal">
                  <svg class="mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  {{ $t('aff.leaderboard.title') }}
                </button>
                <button
                  class="btn btn-primary"
                  :disabled="affStatus.currentBalance < 0.1"
                  @click="openConvertModal"
                >
                  {{ $t('aff.convert') }}
                </button>
              </div>
            </div>

            <div class="grid gap-3 xl:grid-cols-4">
              <div
                v-for="metric in affMetrics"
                :key="metric.label"
                class="rounded-3xl border border-zinc-200/80 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div class="flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full" :class="getMetricDotClass(metric.tone)"></span>
                  <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {{ metric.label }}
                  </div>
                </div>
                <div class="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-zinc-950 tabular-nums dark:text-zinc-50">
                  {{ metric.value }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/95 dark:border-white/10 dark:bg-zinc-950/60">
          <div class="flex flex-col gap-4 border-b border-themed px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <div class="text-base font-semibold text-themed">{{ $t('aff.myCodes') }}</div>
              <div class="mt-1 text-sm text-themed-muted">
                {{ $t('common.total') }} {{ affStatus.totalCodes }} {{ $t('common.items') }}
              </div>
            </div>
            <button class="btn btn-sm btn-primary" @click="openCreateCodeModal">
              <svg class="mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              {{ $t('aff.createCode') }}
            </button>
          </div>
          
          <div v-if="affCodesLoading" class="p-8 text-center text-themed-muted">
            {{ $t('common.loading') }}...
          </div>
          <div v-else-if="affCodes.length === 0" class="p-8 text-center text-themed-muted">
            {{ $t('aff.noCodes') }}
          </div>
          <div v-else>
            <div class="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1.25fr)_150px_100px_120px_auto] gap-5 border-b border-themed px-5 py-4 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:grid sm:px-6">
              <div>{{ $t('aff.code') }}</div>
              <div>{{ $t('aff.plan') }}</div>
              <div>{{ $t('aff.discount') }}/{{ $t('aff.commission') }}</div>
              <div>{{ $t('aff.usedCount') }}</div>
              <div>{{ $t('aff.earnings') }}</div>
              <div></div>
            </div>

            <div class="divide-y divide-themed">
              <div
                v-for="code in affCodes"
                :key="code.id"
                class="grid gap-4 px-5 py-5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-white/[0.03] sm:px-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.25fr)_150px_100px_120px_auto] lg:items-center lg:py-3.5"
              >
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[15px] font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">{{ code.code }}</span>
                    <button class="text-themed-muted transition-colors hover:text-themed" @click="copyCode(code.code)">
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                    <span
                      v-if="code.isGlobal"
                      :class="['inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', getTagClass('blue')]"
                    >
                      {{ $t('aff.globalCodeBadge') }}
                    </span>
                  </div>
                </div>

                <div class="text-[15px] leading-6 text-zinc-700 dark:text-zinc-300 lg:truncate">
                  {{ code.isGlobal ? $t('aff.globalCode') : `${code.packageName} / ${code.planName}` }}
                </div>

                <div class="flex items-center justify-between gap-3 lg:block">
                  <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                    {{ $t('aff.discount') }}/{{ $t('aff.commission') }}
                  </div>
                  <div class="text-[15px] leading-6 text-zinc-700 dark:text-zinc-300">
                    {{ (code.discountRate * 100).toFixed(0) }}% / {{ (code.commissionRate * 100).toFixed(0) }}%
                  </div>
                </div>

                <div class="flex items-center justify-between gap-3 lg:block">
                  <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                    {{ $t('aff.usedCount') }}
                  </div>
                  <div class="text-[15px] font-medium tracking-[-0.01em] text-zinc-950 tabular-nums dark:text-zinc-50">
                    {{ code.usedCount.toLocaleString() }}
                  </div>
                </div>

                <div class="flex items-center justify-between gap-3 lg:block">
                  <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                    {{ $t('aff.earnings') }}
                  </div>
                  <div class="text-[15px] font-medium tracking-[-0.01em] text-zinc-950 tabular-nums dark:text-zinc-50">
                    {{ formatMoney(code.totalEarnings) }}
                  </div>
                </div>

                <div class="flex justify-start lg:justify-end">
                  <button
                    v-if="code.usedCount === 0"
                    class="rounded-full p-2 text-red-500 transition-colors hover:bg-red-500/10"
                    :disabled="deleteCodeLoading === code.id"
                    :title="$t('common.delete')"
                    @click="deleteAffCode(code.id, code.code)"
                  >
                    <svg v-if="deleteCodeLoading !== code.id" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <svg v-else class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.95fr)]">
          <div class="card overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/95 dark:border-white/10 dark:bg-zinc-950/60">
            <div class="border-b border-themed px-5 py-5 sm:px-6">
              <div class="text-base font-semibold text-themed">{{ $t('aff.earningsLog') }}</div>
              <div class="mt-1 text-sm text-themed-muted">{{ $t('common.total') }} {{ affLogsTotal }} {{ $t('common.items') }}</div>
            </div>
            
            <div v-if="affLogsLoading" class="p-8 text-center text-themed-muted">
              {{ $t('common.loading') }}...
            </div>
            <div v-else-if="affLogs.length === 0" class="p-8 text-center text-themed-muted">
              {{ $t('aff.noLogs') }}
            </div>
            <div v-else>
              <div class="hidden grid-cols-[minmax(0,1fr)_128px_128px_196px] gap-5 border-b border-themed px-5 py-4 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:grid sm:px-6">
                <div>{{ $t('wallet.instanceOrRemark') }}</div>
                <div>{{ $t('wallet.amount') }}</div>
                <div>{{ $t('wallet.balanceAfter') }}</div>
                <div>{{ $t('wallet.time') }}</div>
              </div>

              <div class="divide-y divide-themed">
                <div
                  v-for="log in affLogs"
                  :key="log.id"
                  class="grid gap-4 px-5 py-5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-white/[0.03] sm:px-6 lg:grid-cols-[minmax(0,1fr)_128px_128px_196px] lg:items-center lg:py-3.5"
                >
                  <div class="min-w-0">
                    <div class="lg:hidden">
                      <div class="flex flex-wrap items-center gap-2">
                        <span :class="['inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', getAffLogTypeTagClass(log.type)]">
                          {{ getAffLogTypeName(log.type) }}
                        </span>
                        <button
                          v-if="log.instanceId"
                          class="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline dark:text-blue-300 dark:hover:text-blue-200"
                          @click="router.push(`/instances/${log.instanceId}`)"
                        >
                          #{{ log.instanceId }}
                        </button>
                        <span v-else-if="log.affCode" class="text-sm text-zinc-500 dark:text-zinc-400">
                          {{ log.affCode }}
                        </span>
                      </div>
                      <div class="mt-3 truncate text-[15px] leading-7 text-zinc-500 dark:text-zinc-400">
                        {{ log.remark || '-' }}
                      </div>
                    </div>

                    <div class="hidden min-w-0 items-center gap-3 lg:flex">
                      <span :class="['inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium', getAffLogTypeTagClass(log.type)]">
                        {{ getAffLogTypeName(log.type) }}
                      </span>
                      <button
                        v-if="log.instanceId"
                        class="shrink-0 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline dark:text-blue-300 dark:hover:text-blue-200"
                        @click="router.push(`/instances/${log.instanceId}`)"
                      >
                        #{{ log.instanceId }}
                      </button>
                      <span v-else-if="log.affCode" class="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
                        {{ log.affCode }}
                      </span>
                      <span class="min-w-0 truncate text-[15px] leading-6 text-zinc-600 dark:text-zinc-400">
                        {{ log.remark || '-' }}
                      </span>
                    </div>
                  </div>

                  <div class="flex items-center justify-between gap-3 lg:block">
                    <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                      {{ $t('wallet.amount') }}
                    </div>
                    <div class="text-[15px] font-semibold tracking-[-0.01em] tabular-nums" :class="getAmountValueClass(log.amount)">
                      {{ log.amount >= 0 ? '+' : '-' }}{{ formatMoney(Math.abs(log.amount)) }}
                    </div>
                  </div>

                  <div class="flex items-center justify-between gap-3 lg:block">
                    <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                      {{ $t('wallet.balanceAfter') }}
                    </div>
                    <div class="text-[15px] font-medium tracking-[-0.01em] text-zinc-950 tabular-nums dark:text-zinc-50">
                      {{ formatMoney(log.balanceAfter) }}
                    </div>
                  </div>

                  <div class="flex items-center justify-between gap-3 lg:block">
                    <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                      {{ $t('wallet.time') }}
                    </div>
                    <div class="text-[15px] leading-6 text-zinc-700 dark:text-zinc-300">
                      {{ formatDate(log.createdAt) }}
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="affLogsTotalPages > 1" class="flex flex-col gap-3 border-t border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <span class="text-sm text-themed-muted">
                  {{ $t('common.total') }} {{ affLogsTotal }} {{ $t('common.items') }}
                </span>
                <div class="flex items-center gap-2">
                  <button
                    class="btn btn-sm btn-ghost"
                    :disabled="affLogsPage <= 1"
                    @click="affLogsPage--; loadAffLogs()"
                  >
                    {{ $t('common.prevPage') }}
                  </button>
                  <span class="rounded-full border border-themed px-3 py-1.5 text-sm text-themed-muted">
                    {{ affLogsPage }} / {{ affLogsTotalPages }}
                  </span>
                  <button
                    class="btn btn-sm btn-ghost"
                    :disabled="affLogsPage >= affLogsTotalPages"
                    @click="affLogsPage++; loadAffLogs()"
                  >
                    {{ $t('common.nextPage') }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="card overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/95 dark:border-white/10 dark:bg-zinc-950/60">
            <div class="border-b border-themed px-5 py-5 sm:px-6">
              <div class="text-base font-semibold text-themed">{{ $t('aff.withdrawals') }}</div>
              <div class="mt-1 text-sm text-themed-muted">{{ $t('common.total') }} {{ affWithdrawalsTotal }} {{ $t('common.items') }}</div>
            </div>
            
            <div v-if="affWithdrawalsLoading" class="p-8 text-center text-themed-muted">
              {{ $t('common.loading') }}...
            </div>
            <div v-else-if="affWithdrawals.length === 0" class="p-8 text-center text-themed-muted">
              {{ $t('aff.noWithdrawals') }}
            </div>
            <div v-else>
              <div class="hidden grid-cols-[120px_110px_180px_minmax(0,1fr)] gap-5 border-b border-themed px-5 py-4 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:grid sm:px-6">
                <div>{{ $t('wallet.amount') }}</div>
                <div>{{ $t('aff.status') }}</div>
                <div>{{ $t('aff.requestTime') }}</div>
                <div>{{ $t('aff.rejectReason') }}</div>
              </div>

              <div class="divide-y divide-themed">
                <div
                  v-for="w in affWithdrawals"
                  :key="w.id"
                  class="grid gap-4 px-5 py-5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-white/[0.03] sm:px-6 lg:grid-cols-[120px_110px_180px_minmax(0,1fr)] lg:items-center lg:py-3.5"
                >
                  <div class="flex items-center justify-between gap-3 lg:block">
                    <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                      {{ $t('wallet.amount') }}
                    </div>
                    <div class="text-[15px] font-medium tracking-[-0.01em] text-zinc-950 tabular-nums dark:text-zinc-50">
                      {{ formatMoney(w.amount) }}
                    </div>
                  </div>

                  <div class="flex items-center justify-between gap-3 lg:block">
                    <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                      {{ $t('aff.status') }}
                    </div>
                    <span :class="['inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', getWithdrawalStatusTagClass(w.status)]">
                      {{ getWithdrawalStatusName(w.status) }}
                    </span>
                  </div>

                  <div class="flex items-center justify-between gap-3 lg:block">
                    <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 lg:hidden">
                      {{ $t('aff.requestTime') }}
                    </div>
                    <div class="text-[15px] leading-6 text-zinc-700 dark:text-zinc-300">
                      {{ formatDate(w.createdAt) }}
                    </div>
                  </div>

                  <div class="text-[15px] leading-7 text-zinc-500 dark:text-zinc-400 lg:truncate lg:leading-6">
                    {{ w.rejectReason || '-' }}
                  </div>
                </div>
              </div>

              <div v-if="affWithdrawalsTotalPages > 1" class="flex flex-col gap-3 border-t border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <span class="text-sm text-themed-muted">
                  {{ $t('common.total') }} {{ affWithdrawalsTotal }} {{ $t('common.items') }}
                </span>
                <div class="flex items-center gap-2">
                  <button
                    class="btn btn-sm btn-ghost"
                    :disabled="affWithdrawalsPage <= 1"
                    @click="affWithdrawalsPage--; loadAffWithdrawals()"
                  >
                    {{ $t('common.prevPage') }}
                  </button>
                  <span class="rounded-full border border-themed px-3 py-1.5 text-sm text-themed-muted">
                    {{ affWithdrawalsPage }} / {{ affWithdrawalsTotalPages }}
                  </span>
                  <button
                    class="btn btn-sm btn-ghost"
                    :disabled="affWithdrawalsPage >= affWithdrawalsTotalPages"
                    @click="affWithdrawalsPage++; loadAffWithdrawals()"
                  >
                    {{ $t('common.nextPage') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 充值弹窗 -->
    <Teleport to="body">
      <div v-if="showRechargeModal && !configStore.freeSiteMode" class="modal-overlay" @click.self="showRechargeModal = false">
        <div class="modal-content max-w-md">
          <!-- 头部 -->
          <div class="modal-header border-b-0 pb-2">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-900 dark:bg-white">
                <svg class="w-5 h-5 text-white dark:text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 class="modal-title text-lg">{{ $t('wallet.recharge') }}</h3>
                <p class="text-xs text-themed-muted">{{ $t('wallet.description') }}</p>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm rounded-full" @click="showRechargeModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body space-y-5 pt-4">
            <!-- 支付渠道选择 -->
            <div>
              <label class="label text-xs uppercase tracking-wide text-themed-muted mb-2">{{ $t('wallet.paymentMethod') }}</label>
              <div v-if="providers.length === 0" class="text-themed-muted text-sm p-4 rounded-lg bg-themed-secondary text-center">
                {{ $t('wallet.noProviders') }}
              </div>
              <div v-else class="grid grid-cols-2 gap-3">
                <button
                  v-for="p in providers"
                  :key="p.id"
                  class="p-4 rounded-xl border-2 text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
                  :class="selectedProvider === p.id 
                    ? 'border-gray-900 dark:border-white bg-gray-900/5 dark:bg-white/10' 
                    : 'border-themed hover:border-gray-400 hover:bg-themed-hover'"
                  @click="selectedProvider = p.id; selectedPaymentMethod = ''"
                >
                  {{ p.name }}
                </button>
              </div>
            </div>

            <!-- 支付方式选择 (仅当所选渠道支持多种方式时显示) -->
            <div v-if="selectedProviderInfo && selectedProviderInfo.type !== 'heleket' && selectedProviderInfo.methods && selectedProviderInfo.methods.length > 1">
              <label class="label text-xs uppercase tracking-wide text-themed-muted mb-2">{{ $t('wallet.paymentMethodType') }}</label>
              <div class="grid grid-cols-2 gap-3">
                <button
                  v-for="method in selectedProviderInfo.methods"
                  :key="method"
                  class="p-3 rounded-xl border-2 text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2.5"
                  :class="[
                    selectedPaymentMethod === method || (!selectedPaymentMethod && selectedProviderInfo.methods[0] === method)
                      ? (method === 'alipay' 
                        ? 'border-blue-500 bg-blue-500/10 shadow-md shadow-blue-500/10' 
                        : method === 'wxpay' 
                          ? 'border-green-500 bg-green-500/10 shadow-md shadow-green-500/10'
                          : 'border-blue-500 bg-blue-500/10 shadow-md shadow-blue-500/10')
                      : 'border-themed hover:border-gray-400 hover:bg-themed-hover'
                  ]"
                  @click="selectedPaymentMethod = method"
                >
                  <!-- 支付宝图标 -->
                  <svg v-if="method === 'alipay'" class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" :class="selectedPaymentMethod === method || (!selectedPaymentMethod && selectedProviderInfo.methods[0] === method) ? 'text-blue-500' : 'text-blue-400'">
                    <path d="M21.422 15.358c-3.83-1.153-6.055-1.84-7.358-2.22a15.503 15.503 0 001.07-3.122h-4.067v-1.2h4.89V7.69h-4.89V5.5H9.333v2.19H4.5v1.126h4.833v1.2H5.266v1.124h7.09a12.14 12.14 0 01-.671 1.883c-1.627-.396-3.177-.586-4.384-.513-3.407.206-5.136 2.051-5.26 3.708-.153 2.038 1.57 3.728 4.49 3.782 2.448.045 4.793-1.083 6.51-3.058.756.39 1.603.831 2.542 1.323.939.492 1.97 1.033 3.114 1.632h5.25v-3.514c-.167-.053-.324-.095-.525-.025zM7.028 18.93c-1.86-.143-2.66-1.062-2.583-1.95.076-.882.973-1.712 2.526-1.806.984-.06 2.243.13 3.685.508a7.016 7.016 0 01-3.628 3.248z" />
                  </svg>
                  <!-- 微信支付图标 -->
                  <svg v-else-if="method === 'wxpay'" class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" :class="selectedPaymentMethod === method || (!selectedPaymentMethod && selectedProviderInfo.methods[0] === method) ? 'text-green-500' : 'text-green-400'">
                    <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.045c.133 0 .241-.108.241-.241 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 01-.023-.156.49.49 0 01.201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088l-.105-.001-.301-.033zm-2.746 2.769a.96.96 0 110 1.92.96.96 0 010-1.92zm4.93 0a.96.96 0 110 1.92.96.96 0 010-1.92z" />
                  </svg>
                  <!-- 其他支付方式 -->
                  <svg v-else class="w-5 h-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <span>{{ getPaymentMethodName(method) }}</span>
                </button>
              </div>
            </div>

            <div v-else-if="selectedProviderInfo?.type === 'heleket'" class="text-xs text-themed-muted rounded-lg bg-themed-secondary px-3 py-2">
              {{ $t('wallet.heleketSelectionHint') }}
            </div>

            <!-- 充值金额 -->
            <div>
              <label class="label text-xs uppercase tracking-wide text-themed-muted mb-2">{{ $t('wallet.amountLabel') }}</label>
              <div class="grid grid-cols-4 gap-2 mb-3">
                <button
                  v-for="amt in [10, 50, 100, 200]"
                  :key="amt"
                  class="py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
                  :class="rechargeAmount === amt 
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900' 
                    : 'bg-themed-secondary hover:bg-themed-hover text-themed'"
                  @click="rechargeAmount = amt"
                >
                  ¥{{ amt }}
                </button>
              </div>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-themed-muted font-medium">¥</span>
                <input
                  v-model.number="rechargeAmount"
                  type="number"
                  class="input w-full pl-8 text-lg font-semibold"
                  :min="selectedProviderInfo?.minAmount || 1"
                  :max="selectedProviderInfo?.maxAmount || undefined"
                  step="0.01"
                  placeholder="0"
                  @blur="formatAmount"
                />
              </div>
              <div v-if="selectedProviderInfo" class="text-xs text-themed-muted mt-2 flex items-center gap-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {{ $t('wallet.amountRange') }}: 
                {{ selectedProviderInfo.minAmount.toFixed(2) }} - 
                {{ selectedProviderInfo.maxAmount ? selectedProviderInfo.maxAmount.toFixed(2) : $t('common.unlimited') }}
              </div>
            </div>

            <!-- 费用预览 -->
            <div
              v-if="selectedProviderInfo && selectedRechargeFee > 0"
              class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm"
            >
              <div class="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div class="min-w-0 space-y-1">
                  <div>
                    {{ $t('wallet.feeNote') }}:
                    <span v-if="selectedFeeConfig.feeRate > 0" class="font-medium">{{ (selectedFeeConfig.feeRate * 100).toFixed(2) }}%</span>
                    <span v-if="selectedFeeConfig.feeRate > 0 && selectedFeeConfig.feeFixed > 0"> + </span>
                    <span v-if="selectedFeeConfig.feeFixed > 0" class="font-medium">¥{{ selectedFeeConfig.feeFixed.toFixed(2) }}</span>
                    <span class="font-medium"> = ¥{{ selectedRechargeFee.toFixed(2) }}</span>
                  </div>
                  <div>
                    {{ $t('wallet.payableAmount') }}:
                    <span class="font-semibold">¥{{ selectedPayableAmount.toFixed(2) }}</span>
                    <span class="text-themed-muted"> / {{ $t('wallet.actualAmount') }} ¥{{ selectedCreditAmount.toFixed(2) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 确认复选框组 -->
            <div class="space-y-2">
              <!-- 无退款确认 -->
              <label for="agree-no-refund" class="flex items-start gap-2 cursor-pointer">
                <input
                  id="agree-no-refund"
                  v-model="agreedToNoRefund"
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 bg-transparent"
                />
                <span class="text-xs text-red-500 leading-relaxed">
                  {{ $t('wallet.noRefundNotice') }}
                </span>
              </label>

              <!-- 充值须知确认 -->
              <label for="agree-recharge-notice" class="flex items-start gap-2 cursor-pointer">
                <input
                  id="agree-recharge-notice"
                  v-model="agreedToRechargeNotice"
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 bg-transparent"
                />
                <span class="text-xs text-red-500 leading-relaxed">
                  {{ $t('wallet.rechargeNotice') }}
                </span>
              </label>

              <!-- 服务条款勾选 -->
              <label for="agree-terms-recharge" class="flex items-start gap-2 cursor-pointer">
                <input
                  id="agree-terms-recharge"
                  v-model="agreedToTerms"
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 bg-transparent"
                />
                <span class="text-xs text-red-500 leading-relaxed">
                  {{ $t('auth.tos.agreePrefix') }}
                  <button
                    type="button"
                    class="text-red-600 hover:text-red-500 hover:underline font-medium"
                    @click.prevent="showTermsModal = true"
                  >
                    {{ $t('auth.tos.termsLink') }}
                  </button>
                </span>
              </label>
            </div>
          </div>
          
          <div class="modal-footer border-t-0 pt-2">
            <button class="btn btn-ghost" @click="showRechargeModal = false">{{ $t('common.cancel') }}</button>
            <button
              class="btn btn-primary min-w-[120px]"
              :disabled="rechargeLoading || !selectedProvider || rechargeAmount <= 0 || !agreedToNoRefund || !agreedToRechargeNotice || !agreedToTerms"
              @click="createRechargeOrder"
            >
              <svg v-if="!rechargeLoading" class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <svg v-else class="w-4 h-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ rechargeLoading ? $t('common.processing') : $t('wallet.pay') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 创建优惠码弹窗 -->
    <Teleport to="body">
      <div v-if="showCreateCodeModal" class="modal-overlay" @click.self="showCreateCodeModal = false">
        <div class="modal-content max-w-md">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('aff.createCode') }}</h3>
            <button class="btn btn-ghost btn-sm rounded-full" @click="showCreateCodeModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body space-y-4">
            <div>
              <label class="label text-sm mb-2">{{ $t('aff.selectPlan') }}</label>
              <p class="text-xs text-themed-muted mb-3">{{ $t('aff.selectPlanHint') }}</p>
              
              <div v-if="affPlansLoading" class="p-4 text-center text-themed-muted">
                {{ $t('common.loading') }}...
              </div>
              <div v-else-if="affPlans.length === 0" class="p-4 text-center text-themed-muted">
                {{ $t('aff.noCodes') }}
              </div>
              <div v-else class="space-y-2 max-h-64 overflow-y-auto">
                <!-- 全局优惠码选项 -->
                <label
                  class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                  :class="[
                    selectedPlanId === -1 
                      ? 'border-blue-500 bg-blue-500/10' 
                      : 'border-themed hover:border-gray-400 hover:bg-themed-hover'
                  ]"
                >
                  <input
                    v-model="selectedPlanId"
                    type="radio"
                    :value="-1"
                    class="w-4 h-4"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-themed">{{ $t('aff.globalCode') }}</span>
                      <span class="badge badge-xs badge-primary">{{ $t('aff.globalCodeBadge') }}</span>
                    </div>
                    <div class="text-xs text-themed-muted">{{ $t('aff.globalCodeHint') }}</div>
                  </div>
                </label>
                
                <!-- 分隔线 -->
                <div v-if="affPlans.length > 0" class="relative py-2">
                  <div class="absolute inset-0 flex items-center">
                    <div class="w-full border-t border-themed"></div>
                  </div>
                  <div class="relative flex justify-center text-xs">
                    <span class="px-2 bg-themed text-themed-muted">{{ $t('aff.orSelectPlan') }}</span>
                  </div>
                </div>
                
                <!-- 方案专有码选项 -->
                <label
                  v-for="plan in affPlans"
                  :key="plan.id"
                  class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                  :class="[
                    plan.hasCode 
                      ? 'border-themed bg-themed-secondary cursor-not-allowed opacity-50'
                      : selectedPlanId === plan.id 
                        ? 'border-blue-500 bg-blue-500/10' 
                        : 'border-themed hover:border-gray-400 hover:bg-themed-hover'
                  ]"
                >
                  <input
                    v-model="selectedPlanId"
                    type="radio"
                    :value="plan.id"
                    :disabled="plan.hasCode"
                    class="w-4 h-4"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-themed">{{ plan.name }}</span>
                      <span v-if="plan.hasCode" class="text-xs text-themed-muted">({{ $t('aff.alreadyCreated') }})</span>
                    </div>
                    <div class="text-xs text-themed-muted">{{ plan.packageName }} · ¥{{ (parseFloat(plan.price) / 100).toFixed(2) }}</div>
                  </div>
                </label>
              </div>
            </div>
            
            <!-- 固定折扣说明 -->
            <div class="mt-5 pt-4 border-t border-themed">
              <div class="flex items-center justify-between">
                <div>
                  <label class="text-sm font-medium text-themed">{{ $t('aff.fixedRate') }}</label>
                  <p class="text-xs text-themed-muted mt-0.5">{{ $t('aff.fixedRateHint') }}</p>
                </div>
                <div class="text-right">
                  <div class="text-2xl font-bold text-themed tabular-nums">5%</div>
                  <div class="text-xs text-themed-muted">{{ $t('aff.discount') }} 5% / {{ $t('aff.commission') }} 5%</div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showCreateCodeModal = false">{{ $t('common.cancel') }}</button>
            <button
              class="btn btn-primary"
              :disabled="createCodeLoading || selectedPlanId === null"
              @click="createAffCode"
            >
              {{ createCodeLoading ? $t('common.processing') : $t('common.create') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 转化申请弹窗 -->
    <Teleport to="body">
      <div v-if="showConvertModal" class="modal-overlay" @click.self="showConvertModal = false">
        <div class="modal-content max-w-md">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('aff.convertModal.title') }}</h3>
            <button class="btn btn-ghost btn-sm rounded-full" @click="showConvertModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body space-y-4">
            <div>
              <label class="label text-sm mb-1">{{ $t('aff.convertModal.currentBalance') }}</label>
              <div class="text-2xl font-bold text-themed">¥{{ affStatus?.currentBalance.toFixed(2) || '0.00' }}</div>
            </div>
            
            <div>
              <label class="label text-sm mb-2">{{ $t('aff.convertModal.amount') }}</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-themed-muted font-medium">¥</span>
                <input
                  v-model.number="convertAmount"
                  type="number"
                  class="input w-full pl-8"
                  :max="affStatus?.currentBalance || 0"
                  min="2"
                  step="0.01"
                />
              </div>
              <p class="text-xs text-themed-muted mt-1">{{ $t('aff.convertModal.minAmount') }}</p>
            </div>
            
            <div class="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <div class="flex items-start gap-2 text-amber-600 dark:text-amber-400 text-sm">
                <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{{ $t('aff.convertModal.hint') }}</span>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showConvertModal = false">{{ $t('common.cancel') }}</button>
            <button
              class="btn btn-primary"
              :disabled="convertLoading || convertAmount < 0.1 || convertAmount > (affStatus?.currentBalance || 0)"
              @click="submitConvert"
            >
              {{ convertLoading ? $t('common.processing') : $t('aff.convertModal.submit') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- AFF 榜单弹窗 -->
    <Teleport to="body">
      <div v-if="showLeaderboardModal" class="modal-overlay" @click.self="showLeaderboardModal = false">
        <div class="modal-content max-w-md">
          <div class="modal-header">
            <div class="flex items-center gap-2">
              <span class="text-xl">🏆</span>
              <h3 class="modal-title">{{ $t('aff.leaderboard.title') }}</h3>
            </div>
            <button class="btn btn-ghost btn-sm rounded-full" @click="showLeaderboardModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body p-0">
            <!-- 加载中 -->
            <div v-if="leaderboardLoading" class="p-8 text-center text-themed-muted">
              {{ $t('common.loading') }}...
            </div>
            
            <!-- 空状态 -->
            <div v-else-if="leaderboard.length === 0" class="p-8 text-center">
              <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-themed-secondary flex items-center justify-center">
                <svg class="w-8 h-8 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p class="text-themed-muted">{{ $t('aff.leaderboard.empty') }}</p>
            </div>
            
            <!-- 榜单列表 -->
            <div v-else class="divide-y divide-themed">
              <div 
                v-for="(entry, index) in leaderboard" 
                :key="entry.rank"
                class="flex items-center justify-between px-4 py-3 transition-all duration-300"
                :class="[
                  entry.isCurrentUser ? 'bg-blue-500/10 dark:bg-blue-500/20' : 'hover:bg-themed-hover',
                ]"
                :style="{ animationDelay: `${index * 50}ms` }"
              >
                <div class="flex items-center gap-3">
                  <!-- 排名 -->
                  <div 
                    class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                    :class="getRankStyle(entry.rank)"
                  >
                    <span v-if="entry.rank <= 3">{{ getRankEmoji(entry.rank) }}</span>
                    <span v-else>{{ entry.rank }}</span>
                  </div>
                  <!-- 用户名 -->
                  <div class="flex flex-col">
                    <span 
                      class="font-medium"
                      :class="entry.isCurrentUser ? 'text-blue-500' : 'text-themed'"
                    >
                      {{ entry.username }}
                    </span>
                    <span v-if="entry.isCurrentUser" class="text-xs text-blue-500">
                      {{ $t('aff.leaderboard.you') }}
                    </span>
                  </div>
                </div>
                <!-- 收益金额 -->
                <div class="text-right">
                  <span class="text-green-500 font-semibold">¥{{ entry.totalEarnings.toFixed(2) }}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div class="modal-footer border-t border-themed">
            <button class="btn btn-primary w-full" @click="showLeaderboardModal = false">
              {{ $t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 服务条款弹窗 -->
    <TermsOfServiceModal
      :show="showTermsModal"
      @close="showTermsModal = false"
    />
  </div>
</template>
