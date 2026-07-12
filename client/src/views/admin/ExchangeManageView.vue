<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'

defineOptions({ name: 'ExchangeManageView' })

type TabKey = 'listings' | 'orders' | 'delivery' | 'wallets' | 'withdrawals' | 'disputes' | 'risk' | 'config' | 'audit'
type ListTabKey = Exclude<TabKey, 'config'>

interface ListState {
  page: number
  total: number
  status: string
}

type AdminActionKind =
  | 'forceDelist'
  | 'retryDelivery'
  | 'rollbackDelivery'
  | 'manualTakeoverDelivery'
  | 'completeDelivery'
  | 'refundOrder'
  | 'freezeOrder'
  | 'releaseOrder'
  | 'cancelOrder'
  | 'rejectDispute'
  | 'refundDispute'
  | 'releaseDispute'
  | 'approveWithdrawal'
  | 'completeWithdrawal'
  | 'rejectWithdrawal'
  | 'freezeWallet'
  | 'unfreezeWallet'
  | 'adjustWallet'

interface AdminActionDialog {
  kind: AdminActionKind
  title: string
  message: string
  target: any
  confirmText: string
  danger?: boolean
  reason: string
  reasonLabel?: string
  reasonPlaceholder?: string
  requiresReason?: boolean
  amount: number | null
  amountLabel?: string
  amountHelp?: string
  requiresAmount?: boolean
  proofUrl: string
  proofUrlLabel?: string
  requiresProofUrl?: boolean
}

const toast = useToast()

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'listings', label: '挂牌管理' },
  { key: 'orders', label: '订单管理' },
  { key: 'delivery', label: '交割任务' },
  { key: 'wallets', label: '交易所余额' },
  { key: 'withdrawals', label: '提现审核' },
  { key: 'disputes', label: '争议管理' },
  { key: 'risk', label: '风控记录' },
  { key: 'config', label: '配置中心' },
  { key: 'audit', label: '审计日志' }
]

const activeTab = ref<TabKey>('listings')
const loading = ref(false)
const overview = ref({
  activeListings: 0,
  lockedListings: 0,
  deliveringOrders: 0,
  disputedOrders: 0,
  pendingWithdrawals: 0,
  openDisputes: 0,
  pendingDeliveryTasks: 0
})

const listings = ref<any[]>([])
const orders = ref<any[]>([])
const deliveryTasks = ref<any[]>([])
const wallets = ref<any[]>([])
const withdrawals = ref<any[]>([])
const disputes = ref<any[]>([])
const riskRecords = ref<any[]>([])
const auditLogs = ref<any[]>([])
const policy = ref<Record<string, any>>({})
const adminActionDialog = ref<AdminActionDialog | null>(null)
const adminActionSubmitting = ref(false)

const pageSize = 20
const listState = ref<Record<ListTabKey, ListState>>({
  listings: { page: 1, total: 0, status: '' },
  orders: { page: 1, total: 0, status: '' },
  delivery: { page: 1, total: 0, status: '' },
  wallets: { page: 1, total: 0, status: '' },
  withdrawals: { page: 1, total: 0, status: '' },
  disputes: { page: 1, total: 0, status: '' },
  risk: { page: 1, total: 0, status: '' },
  audit: { page: 1, total: 0, status: '' }
})
const statusOptions: Record<ListTabKey, Array<{ value: string; label: string }>> = {
  listings: [
    { value: '', label: '全部挂牌' },
    { value: 'active', label: '挂牌中' },
    { value: 'locked', label: '交易锁定' },
    { value: 'delivery_failed', label: '交割异常' },
    { value: 'sold', label: '已售出' },
    { value: 'delisted', label: '已下架' },
    { value: 'force_delisted', label: '强制下架' }
  ],
  orders: [
    { value: '', label: '全部订单' },
    { value: 'escrowed', label: '已托管' },
    { value: 'delivering', label: '交割中' },
    { value: 'confirming', label: '确认期' },
    { value: 'completed', label: '已完成' },
    { value: 'manual_review', label: '人工审核' },
    { value: 'disputed', label: '争议中' },
    { value: 'refunded', label: '已退款' },
    { value: 'cancelled', label: '已取消' }
  ],
  delivery: [
    { value: '', label: '全部任务' },
    { value: 'PENDING', label: '待处理' },
    { value: 'PROCESSING', label: '处理中' },
    { value: 'COMPLETED', label: '已完成' },
    { value: 'FAILED', label: '失败' },
    { value: 'CANCELLED', label: '已取消' }
  ],
  wallets: [],
  withdrawals: [
    { value: '', label: '全部提现' },
    { value: 'pending', label: '待审核' },
    { value: 'approved', label: '已通过' },
    { value: 'paying', label: '打款中' },
    { value: 'completed', label: '已完成' },
    { value: 'rejected', label: '已拒绝' }
  ],
  disputes: [
    { value: '', label: '全部争议' },
    { value: 'open', label: '待处理' },
    { value: 'processing', label: '处理中' },
    { value: 'refunded', label: '已退款' },
    { value: 'released', label: '已放款' },
    { value: 'closed', label: '已关闭' }
  ],
  risk: [
    { value: '', label: '全部风控' },
    { value: 'normal', label: '正常' },
    { value: 'qos_limited', label: 'QoS 限速' },
    { value: 'suspended', label: '已暂停' },
    { value: 'manual_review', label: '人工审核' }
  ],
  audit: []
}

function money(value: unknown): string {
  return `¥${Number(value || 0).toFixed(2)}`
}

function formatDate(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    active: '挂牌中',
    locked: '交易锁定',
    sold: '已售出',
    delisted: '已下架',
    force_delisted: '强制下架',
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
    PENDING: '待处理',
    PROCESSING: '处理中',
    COMPLETED: '已完成',
    FAILED: '失败',
    pending: '待审核',
    approved: '已通过',
    paying: '打款中',
    rejected: '已拒绝',
    open: '待处理',
    processing: '处理中',
    redelivering: '重新交割',
    released: '已放款',
    closed: '已关闭',
    admin_adjust: '人工调整',
    withdrawal_freeze: '提现冻结',
    withdrawal_complete: '提现完成',
    withdrawal_reject: '提现退回',
    balance_transfer: '余额划转',
    escrow_hold: '托管入账',
    fee_charge: '手续费扣除',
    escrow_release: '托管放款',
    dispute_freeze: '争议冻结',
    dispute_release: '争议释放'
  }
  return labels[value] || value
}

const activeDisputeStatuses = ['open', 'processing', 'redelivering']

function instanceTradeState(item: any): { label: string; className: string } {
  const status = item.instance?.status || item.snapshot?.status || item.eligibilitySnapshot?.instance?.status
  if (item.status === 'active' && status === 'stopped') {
    return { label: '已暂停，可交易', className: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700' }
  }
  if (item.status === 'active' && status && status !== 'stopped') {
    return { label: '非暂停，需处理', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20' }
  }
  if (item.status === 'locked') {
    return { label: '已挂牌，暂停锁定中', className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20' }
  }
  if (item.status === 'delivery_failed') {
    return { label: '交割异常', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20' }
  }
  if (item.status === 'sold') {
    return { label: '交割完成/等待结算', className: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700' }
  }
  return { label: status ? `实例状态 ${status}` : '状态未知', className: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700' }
}

function listingLockLabel(item: any): string {
  if (item.status === 'active') return '挂牌锁定，禁止启动/变更'
  if (item.status === 'locked') return '订单锁定，交割中'
  if (item.status === 'delivery_failed') return '异常锁定，等待重试/退款/人工接管'
  if (['delisted', 'force_delisted'].includes(item.status)) return '已解除交易锁定'
  return statusLabel(item.status)
}

function listingReasonText(item: any): string {
  const reasons = Array.isArray(item.eligibilitySnapshot?.reasons) ? item.eligibilitySnapshot.reasons : []
  if (reasons.length > 0) return reasons.join('；')
  const currentStatus = item.instance?.status
  if (item.status === 'active' && currentStatus && currentStatus !== 'stopped') {
    return `当前实例不是暂停状态：${currentStatus}`
  }
  if (item.status === 'active') return '已暂停且通过上架检测'
  if (item.status === 'locked') return '买家已付款，订单交割中'
  if (item.status === 'delivery_failed') return '交割失败，需要重试、退款或人工接管'
  return '-'
}

function orderEscrowText(item: any): string {
  if (['escrowed', 'delivering', 'delivered', 'confirming', 'disputed', 'manual_review'].includes(item.status)) {
    return `托管中 ${money(item.escrowAmount)}`
  }
  if (item.status === 'completed') return '已放款'
  if (['refunded', 'cancelled'].includes(item.status)) return '已退回买家'
  return item.escrowAmount ? `托管 ${money(item.escrowAmount)}` : '-'
}

function deliveryStepText(item: any): string {
  const progress = item.progress
  if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
    const current = (progress as Record<string, unknown>).current
    if (typeof current === 'string' && current) return current
    const step = (progress as Record<string, unknown>).step
    if (typeof step === 'string' && step) return step
  }
  return item.step || '-'
}

function idListToText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map(item => Number(item)).filter(item => Number.isSafeInteger(item) && item > 0).join(',')
}

function textToIdList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(item => Number(item)).filter(item => Number.isSafeInteger(item) && item > 0)
  }
  if (typeof value !== 'string') return []
  return value
    .split(/[\s,，]+/)
    .map(item => Number(item.trim()))
    .filter(item => Number.isSafeInteger(item) && item > 0)
}

function tabClass(tab: TabKey): string {
  return activeTab.value === tab ? 'border-accent text-accent' : 'border-transparent text-themed-muted hover:text-themed'
}

const isListTab = computed(() => activeTab.value !== 'config')
const activeListState = computed(() => isListTab.value ? listState.value[activeTab.value as ListTabKey] : null)
const activeStatusOptions = computed(() => isListTab.value ? statusOptions[activeTab.value as ListTabKey] : [])
const activeTotalPages = computed(() => {
  const state = activeListState.value
  if (!state) return 1
  return Math.max(1, Math.ceil(state.total / pageSize))
})

function queryFor(tab: ListTabKey): { page: number; pageSize: number; status?: string } {
  const state = listState.value[tab]
  return {
    page: state.page,
    pageSize,
    ...(state.status ? { status: state.status } : {})
  }
}

function setListResult(tab: ListTabKey, result: { total?: number; page?: number }): void {
  const state = listState.value[tab]
  state.total = Number(result.total || 0)
  state.page = Number(result.page || state.page || 1)
}

async function changeActiveStatus(): Promise<void> {
  const state = activeListState.value
  if (!state) return
  state.page = 1
  await loadActive()
}

async function changePage(delta: number): Promise<void> {
  const state = activeListState.value
  if (!state) return
  const next = Math.min(activeTotalPages.value, Math.max(1, state.page + delta))
  if (next === state.page) return
  state.page = next
  await loadActive()
}

async function loadOverview(): Promise<void> {
  const res = await api.exchange.overview()
  overview.value = res.counters
}

async function loadListings(): Promise<void> {
  const res = await api.exchange.listListings(queryFor('listings'))
  listings.value = res.items
  setListResult('listings', res)
}

async function loadOrders(): Promise<void> {
  const res = await api.exchange.listOrders(queryFor('orders'))
  orders.value = res.items
  setListResult('orders', res)
}

async function loadDeliveryTasks(): Promise<void> {
  const res = await api.exchange.listDeliveryTasks(queryFor('delivery'))
  deliveryTasks.value = res.items
  setListResult('delivery', res)
}

async function loadWallets(): Promise<void> {
  const res = await api.exchange.listWallets({ page: listState.value.wallets.page, pageSize })
  wallets.value = res.items
  setListResult('wallets', res)
}

async function loadWithdrawals(): Promise<void> {
  const res = await api.exchange.listWithdrawals(queryFor('withdrawals'))
  withdrawals.value = res.items
  setListResult('withdrawals', res)
}

async function loadDisputes(): Promise<void> {
  const res = await api.exchange.listDisputes(queryFor('disputes'))
  disputes.value = res.items
  setListResult('disputes', res)
}

async function loadRiskRecords(): Promise<void> {
  const res = await api.exchange.listRiskRecords(queryFor('risk'))
  riskRecords.value = res.items
  setListResult('risk', res)
}

async function loadAuditLogs(): Promise<void> {
  const res = await api.exchange.listAuditLogs({ page: listState.value.audit.page, pageSize })
  auditLogs.value = res.items
  setListResult('audit', res)
}

async function loadConfig(): Promise<void> {
  const res = await api.exchange.getConfig()
  policy.value = {
    ...res.policy,
    packageAllowlistText: idListToText(res.policy.packageAllowlist),
    hostAllowlistText: idListToText(res.policy.hostAllowlist)
  }
}

async function loadActive(): Promise<void> {
  loading.value = true
  try {
    await loadOverview()
    if (activeTab.value === 'listings') await loadListings()
    if (activeTab.value === 'orders') await loadOrders()
    if (activeTab.value === 'delivery') await loadDeliveryTasks()
    if (activeTab.value === 'wallets') await loadWallets()
    if (activeTab.value === 'withdrawals') await loadWithdrawals()
    if (activeTab.value === 'disputes') await loadDisputes()
    if (activeTab.value === 'risk') await loadRiskRecords()
    if (activeTab.value === 'config') await loadConfig()
    if (activeTab.value === 'audit') await loadAuditLogs()
  } catch (error: any) {
    toast.error(`加载交易所管理失败：${error?.message || error}`)
  } finally {
    loading.value = false
  }
}

async function switchTab(tab: TabKey): Promise<void> {
  activeTab.value = tab
  await loadActive()
}

function openAdminAction(dialog: Omit<AdminActionDialog, 'reason' | 'amount' | 'proofUrl'> & Partial<Pick<AdminActionDialog, 'reason' | 'amount' | 'proofUrl'>>): void {
  adminActionDialog.value = {
    reason: '',
    amount: null,
    proofUrl: '',
    ...dialog
  }
}

function closeAdminAction(): void {
  if (adminActionSubmitting.value) return
  adminActionDialog.value = null
}

function forceDelist(listing: any): void {
  openAdminAction({
    kind: 'forceDelist',
    title: '强制下架挂牌',
    message: `挂牌 #${listing.id} 会被强制下架。仅允许对未进入锁定成交的挂牌执行，操作会写入审计日志。`,
    target: listing,
    confirmText: '确认强制下架',
    reason: '管理员强制下架',
    reasonLabel: '下架原因',
    requiresReason: true,
    danger: true
  })
}

function retryDelivery(task: any): void {
  openAdminAction({
    kind: 'retryDelivery',
    title: '重新排队交割任务',
    message: `交割任务 #${task.id} 将重新排队执行。请先确认失败原因已经处理，避免重复重装或重复转移。`,
    target: task,
    confirmText: '确认重试'
  })
}

function rollbackDelivery(task: any): void {
  openAdminAction({
    kind: 'rollbackDelivery',
    title: '回滚交割任务',
    message: '系统会停止自动交割，订单进入人工审核。如已发生重装或归属转移，需要管理员人工核对后再处理。',
    target: task,
    confirmText: '确认回滚',
    reason: '交割异常，停止自动流程并进入人工审核',
    reasonLabel: '回滚原因',
    requiresReason: true,
    danger: true
  })
}

function manualTakeoverDelivery(task: any): void {
  openAdminAction({
    kind: 'manualTakeoverDelivery',
    title: '人工接管交割',
    message: '自动交割会停止，后续需要管理员重试、退款或人工完成。该操作适用于交割异常且需要人工核验的订单。',
    target: task,
    confirmText: '确认接管',
    reason: '管理员人工接管交割',
    reasonLabel: '接管原因',
    requiresReason: true,
    danger: true
  })
}

function completeDelivery(task: any): void {
  openAdminAction({
    kind: 'completeDelivery',
    title: '人工确认交割完成',
    message: '仅在管理员已线下核验实例完成重装、访问权限清理、owner 转移、匿名重命名、账单归属，并确认已用流量和剩余额度原样保留后使用。后台会再次校验买家归属和匿名标识，确认后订单进入确认期。',
    target: task,
    confirmText: '确认交割完成',
    reasonLabel: '完成说明',
    reasonPlaceholder: '填写线下核验依据，例如已确认实例 owner、重装凭据、账单归属和流量用量保留',
    requiresReason: true
  })
}

function refundOrder(order: any): void {
  openAdminAction({
    kind: 'refundOrder',
    title: '退款订单',
    message: `订单 ${order.orderNo} 会退款到买家账户余额，并取消未完成交割。`,
    target: order,
    confirmText: '确认退款',
    reasonLabel: '退款原因',
    requiresReason: true,
    danger: true
  })
}

function freezeOrder(order: any): void {
  openAdminAction({
    kind: 'freezeOrder',
    title: '冻结订单',
    message: `订单 ${order.orderNo} 会进入人工审核，交割和自动结算会暂停。`,
    target: order,
    confirmText: '确认冻结',
    reasonLabel: '冻结原因',
    requiresReason: true
  })
}

function releaseOrder(order: any): void {
  openAdminAction({
    kind: 'releaseOrder',
    title: '人工放款订单',
    message: `订单 ${order.orderNo} 会跳过剩余确认期，扣除手续费后把托管款结算到卖家交易所余额。若存在未完结争议，请改走争议管理的放款结案。`,
    target: order,
    confirmText: '确认人工放款',
    reasonLabel: '放款原因',
    reasonPlaceholder: '填写人工确认依据，例如买家确认无争议、交割证据已核验、运营审批编号',
    requiresReason: true
  })
}

function cancelOrder(order: any): void {
  openAdminAction({
    kind: 'cancelOrder',
    title: '取消交易',
    message: `订单 ${order.orderNo} 会取消交易并退回买家余额。`,
    target: order,
    confirmText: '确认取消交易',
    reasonLabel: '取消原因',
    requiresReason: true,
    danger: true
  })
}

function runDisputeAction(item: any, action: 'reject' | 'refund' | 'release'): void {
  const map = {
    reject: {
      kind: 'rejectDispute' as const,
      title: '拒绝争议',
      message: '争议会被关闭，订单维持原处理结果。请填写处理说明，便于用户和审计追踪。',
      confirmText: '确认拒绝'
    },
    refund: {
      kind: 'refundDispute' as const,
      title: '争议退款',
      message: '系统会按争议处理结果退款买家，并写入资金流水和审计日志。',
      confirmText: '确认退款',
      danger: true
    },
    release: {
      kind: 'releaseDispute' as const,
      title: '放款结案',
      message: '争议会以卖家胜诉/维持交易结果处理；订单继续按确认期或人工放款路径结算给卖家交易所余额。请确认实例交割、证据和资金状态无误。',
      confirmText: '确认放款结案'
    }
  }
  openAdminAction({
    ...map[action],
    target: item,
    reasonLabel: '处理说明',
    requiresReason: true
  })
}

function approveWithdrawal(item: any): void {
  openAdminAction({
    kind: 'approveWithdrawal',
    title: '审核通过提现',
    message: `提现单 ${item.withdrawalNo} 将进入已通过/待打款状态，资金仍保持冻结直到标记完成。`,
    target: item,
    confirmText: '确认通过',
    reason: '人工审核通过',
    reasonLabel: '审核备注'
  })
}

function completeWithdrawal(item: any): void {
  openAdminAction({
    kind: 'completeWithdrawal',
    title: '标记提现完成',
    message: `提现单 ${item.withdrawalNo} 会记录为已完成，并写入提现完成流水。请确认线下打款已经完成。`,
    target: item,
    confirmText: '确认完成',
    reason: '人工打款完成',
    reasonLabel: '完成备注',
    proofUrlLabel: '打款凭证 URL 或流水号',
    requiresProofUrl: true
  })
}

function rejectWithdrawal(item: any): void {
  openAdminAction({
    kind: 'rejectWithdrawal',
    title: '拒绝提现',
    message: `提现单 ${item.withdrawalNo} 会被拒绝，冻结金额退回交易所可用余额。`,
    target: item,
    confirmText: '确认拒绝',
    reasonLabel: '拒绝原因',
    requiresReason: true,
    danger: true
  })
}

function freezeWallet(item: any): void {
  openAdminAction({
    kind: 'freezeWallet',
    title: '冻结交易所余额',
    message: `用户 #${item.userId} 的交易所余额会按输入金额冻结。`,
    target: item,
    confirmText: '确认冻结',
    reason: '管理员冻结交易所余额',
    reasonLabel: '冻结原因',
    requiresReason: true,
    amountLabel: '冻结金额',
    amountHelp: `当前可用 ${money(item.availableAmount)}`,
    requiresAmount: true
  })
}

function unfreezeWallet(item: any): void {
  openAdminAction({
    kind: 'unfreezeWallet',
    title: '解冻交易所余额',
    message: `用户 #${item.userId} 的冻结余额会按输入金额退回可用余额。`,
    target: item,
    confirmText: '确认解冻',
    reason: '管理员解冻交易所余额',
    reasonLabel: '解冻原因',
    requiresReason: true,
    amountLabel: '解冻金额',
    amountHelp: `当前冻结 ${money(item.frozenAmount)}`,
    requiresAmount: true
  })
}

function adjustWallet(item: any): void {
  openAdminAction({
    kind: 'adjustWallet',
    title: '人工调整交易所余额',
    message: `用户 #${item.userId} 的交易所可用余额会被人工调整。增加填正数，扣减填负数。`,
    target: item,
    confirmText: '确认调整',
    reasonLabel: '调整原因',
    requiresReason: true,
    amountLabel: '调整金额',
    amountHelp: '增加填正数，扣减填负数，不能为 0',
    requiresAmount: true,
    danger: true
  })
}

async function submitAdminAction(): Promise<void> {
  const dialog = adminActionDialog.value
  if (!dialog) return
  const reason = dialog.reason.trim()
  const amount = Number(dialog.amount)
  if (dialog.requiresReason && !reason) {
    toast.warning(dialog.reasonLabel ? `请输入${dialog.reasonLabel}` : '请输入操作原因')
    return
  }
  if (dialog.requiresAmount && (!Number.isFinite(amount) || amount <= 0)) {
    if (dialog.kind === 'adjustWallet' && Number.isFinite(amount) && amount !== 0) {
      // 人工调整允许负数。
    } else {
      toast.warning(dialog.amountLabel ? `${dialog.amountLabel}无效` : '金额无效')
      return
    }
  }
  if (dialog.requiresProofUrl && !dialog.proofUrl.trim()) {
    toast.warning(dialog.proofUrlLabel ? `请输入${dialog.proofUrlLabel}` : '请输入打款凭证')
    return
  }
  adminActionSubmitting.value = true
  try {
    const target = dialog.target
    switch (dialog.kind) {
      case 'forceDelist':
        await api.exchange.forceDelist(target.id, reason)
        toast.success('已强制下架')
        break
      case 'retryDelivery':
        await api.exchange.retryDeliveryTask(target.id)
        toast.success('已重新排队')
        break
      case 'rollbackDelivery':
        await api.exchange.rollbackDeliveryTask(target.id, reason)
        toast.success('交割已回滚到人工审核')
        break
      case 'manualTakeoverDelivery':
        await api.exchange.manualTakeoverDeliveryTask(target.id, reason)
        toast.success('交割已进入人工接管')
        break
      case 'completeDelivery':
        await api.exchange.completeDeliveryTask(target.id, reason)
        toast.success('已人工确认交割完成，订单进入确认期')
        break
      case 'refundOrder':
        await api.exchange.refundOrder(target.id, reason)
        toast.success('订单已退款')
        break
      case 'freezeOrder':
        await api.exchange.freezeOrder(target.id, reason)
        toast.success('订单已冻结并进入人工审核')
        break
      case 'releaseOrder':
        await api.exchange.releaseOrder(target.id, reason)
        toast.success('订单已人工放款')
        break
      case 'cancelOrder':
        await api.exchange.cancelOrder(target.id, reason)
        toast.success('交易已取消并退款')
        break
      case 'rejectDispute':
        await api.exchange.rejectDispute(target.id, reason)
        toast.success('争议已拒绝')
        break
      case 'refundDispute':
        await api.exchange.refundDispute(target.id, reason)
        toast.success('争议已退款')
        break
      case 'releaseDispute':
        await api.exchange.releaseDispute(target.id, reason)
        toast.success('争议已放款结案')
        break
      case 'approveWithdrawal':
        await api.exchange.approveWithdrawal(target.id, reason)
        toast.success('提现已审核通过')
        break
      case 'completeWithdrawal':
        await api.exchange.completeWithdrawal(target.id, { proofUrl: dialog.proofUrl.trim(), remark: reason || '人工打款完成' })
        toast.success('提现已标记完成')
        break
      case 'rejectWithdrawal':
        await api.exchange.rejectWithdrawal(target.id, reason)
        toast.success('提现已拒绝并退回冻结金额')
        break
      case 'freezeWallet':
        await api.exchange.freezeWallet(target.userId, { amount, remark: reason })
        toast.success('交易所余额已冻结')
        break
      case 'unfreezeWallet':
        await api.exchange.unfreezeWallet(target.userId, { amount, remark: reason })
        toast.success('交易所余额已解冻')
        break
      case 'adjustWallet':
        await api.exchange.adjustWallet(target.userId, { amount, remark: reason })
        toast.success('交易所余额已调整')
        break
    }
    adminActionDialog.value = null
    await loadActive()
  } catch (error: any) {
    toast.error(`操作失败：${error?.message || error}`)
  } finally {
    adminActionSubmitting.value = false
  }
}

async function saveConfig(): Promise<void> {
  try {
    const payload = {
      ...policy.value,
      packageAllowlist: textToIdList(policy.value.packageAllowlistText ?? policy.value.packageAllowlist),
      hostAllowlist: textToIdList(policy.value.hostAllowlistText ?? policy.value.hostAllowlist)
    }
    const res = await api.exchange.updateConfig(payload)
    policy.value = { ...res.policy }
    toast.success('交易所配置已保存')
    await loadOverview()
  } catch (error: any) {
    toast.error(`保存失败：${error?.message || error}`)
  }
}

onMounted(loadActive)
</script>

<template>
  <div class="kawaii-page space-y-6 animate-fade-in">
    <div class="page-header">
      <div class="flex items-center gap-3">
        <span class="nimbus-title-icon">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5M16.5 3 21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        </span>
        <div>
          <h1 class="page-title">交易所管理</h1>
          <p class="page-description">管理匿名挂牌、托管订单、重装交割、提现审核、争议和策略配置。</p>
        </div>
      </div>
      <button class="btn btn-secondary" type="button" @click="loadActive">
        <svg class="h-4 w-4" :class="{ 'animate-spin': loading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 4v5h.58m15.36 2A8 8 0 0 0 5.07 8.11M20 20v-5h-.58m0 0A8 8 0 0 1 4.06 12.03" />
        </svg>
        刷新
      </button>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="card nimbus-stat p-4">
        <div class="nimbus-stat-label">挂牌中</div>
        <div class="nimbus-stat-value">{{ overview.activeListings }}</div>
      </div>
      <div class="card nimbus-stat p-4">
        <div class="nimbus-stat-label">交易锁定</div>
        <div class="nimbus-stat-value">{{ overview.lockedListings }}</div>
      </div>
      <div class="card nimbus-stat p-4">
        <div class="nimbus-stat-label">交割订单</div>
        <div class="nimbus-stat-value">{{ overview.deliveringOrders }}</div>
      </div>
      <div class="card nimbus-stat p-4">
        <div class="nimbus-stat-label">争议订单</div>
        <div class="nimbus-stat-value">{{ overview.disputedOrders }}</div>
      </div>
      <div class="card nimbus-stat p-4">
        <div class="nimbus-stat-label">待审提现</div>
        <div class="nimbus-stat-value">{{ overview.pendingWithdrawals }}</div>
      </div>
      <div class="card nimbus-stat p-4">
        <div class="nimbus-stat-label">开放争议</div>
        <div class="nimbus-stat-value">{{ overview.openDisputes }}</div>
      </div>
      <div class="card nimbus-stat p-4">
        <div class="nimbus-stat-label">待交割</div>
        <div class="nimbus-stat-value">{{ overview.pendingDeliveryTasks }}</div>
      </div>
    </div>

    <div class="border-b border-themed">
      <div class="flex flex-wrap gap-1">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
          :class="tabClass(tab.key)"
          type="button"
          @click="switchTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card p-8 text-center text-themed-muted">加载中...</div>

    <div
      v-else-if="activeListState"
      class="card flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
    >
      <div class="flex flex-wrap items-center gap-3">
        <select
          v-if="activeStatusOptions.length"
          v-model="activeListState.status"
          class="input h-9 w-full sm:w-52"
          @change="changeActiveStatus"
        >
          <option v-for="option in activeStatusOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <span class="text-themed-muted">
          共 {{ activeListState.total }} 条记录 · 每页 {{ pageSize }} 条
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          :disabled="activeListState.page <= 1"
          @click="changePage(-1)"
        >
          上一页
        </button>
        <span class="text-themed-muted">第 {{ activeListState.page }} / {{ activeTotalPages }} 页</span>
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          :disabled="activeListState.page >= activeTotalPages"
          @click="changePage(1)"
        >
          下一页
        </button>
      </div>
    </div>

    <section v-if="!loading && activeTab === 'listings'" class="card overflow-hidden">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-themed">
            <th class="nimbus-th w-[12%]">挂牌</th>
            <th class="nimbus-th w-[22%]">实例状态</th>
            <th class="nimbus-th w-[16%]">卖家</th>
            <th class="nimbus-th w-[12%]">价格</th>
            <th class="nimbus-th w-[24%]">锁定/不可交易原因</th>
            <th class="nimbus-th w-[14%] text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in listings" :key="item.id" class="nimbus-row border-b border-themed align-top">
            <td class="px-4 py-3">
              <div class="font-medium text-themed">#{{ item.id }}</div>
              <div class="mt-1"><span class="nimbus-pill" :class="['active','sold','completed','COMPLETED','approved','released','delivered'].includes(item.status) ? 'text-green-600 dark:text-green-400' : ['force_delisted','disputed','failed','FAILED','rejected'].includes(item.status) ? 'text-rose-600 dark:text-rose-400' : ['locked','escrowed','delivering','confirming','manual_review','PENDING','PROCESSING','pending','paying','open','processing','redelivering'].includes(item.status) ? 'text-amber-600 dark:text-amber-400' : 'text-themed-muted'"><span class="dot"></span>{{ statusLabel(item.status) }}</span></div>
            </td>
            <td class="px-4 py-3">
              <div class="break-words font-medium text-themed">{{ item.instance?.name || item.instanceId }}</div>
              <div class="mt-1">
                <span class="inline-flex rounded border px-2 py-0.5 text-xs" :class="instanceTradeState(item).className">{{ instanceTradeState(item).label }}</span>
              </div>
              <div class="mt-1 text-xs text-themed-muted">当前实例：{{ item.instance?.status || item.snapshot?.status || '-' }}</div>
            </td>
            <td class="px-4 py-3 break-words text-themed">{{ item.seller?.username }} / #{{ item.seller?.id }}</td>
            <td class="px-4 py-3 font-medium tabular-nums text-themed">{{ money(item.price) }}</td>
            <td class="px-4 py-3">
              <div class="text-sm text-themed">{{ listingLockLabel(item) }}</div>
              <div class="mt-1 text-xs text-themed-muted">{{ listingReasonText(item) }}</div>
            </td>
            <td class="px-4 py-3 text-right">
              <button class="btn btn-secondary btn-sm" type="button" @click="forceDelist(item)">强制下架</button>
            </td>
          </tr>
          <tr v-if="listings.length === 0"><td class="px-4 py-8 text-center text-themed-muted" colspan="6">暂无挂牌。</td></tr>
        </tbody>
      </table>
    </section>

    <section v-else-if="activeTab === 'orders'" class="card overflow-hidden">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-themed">
            <th class="nimbus-th w-[12%]">订单</th>
            <th class="nimbus-th w-[14%]">实例</th>
            <th class="nimbus-th w-[13%]">买家</th>
            <th class="nimbus-th w-[13%]">卖家</th>
            <th class="nimbus-th w-[15%]">金额/托管</th>
            <th class="nimbus-th w-[19%]">交割任务</th>
            <th class="nimbus-th w-[14%] text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in orders" :key="item.id" class="nimbus-row border-b border-themed align-top">
            <td class="px-4 py-3 break-words font-medium text-themed">{{ item.orderNo }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.instance?.name || item.instanceId }} <span class="text-themed-muted">({{ item.instance?.status || '-' }})</span></td>
            <td class="px-4 py-3 break-words text-themed">{{ item.buyer?.username }} / #{{ item.buyer?.id }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.seller?.username }} / #{{ item.seller?.id }}</td>
            <td class="px-4 py-3">
              <div class="font-medium tabular-nums text-themed">{{ money(item.price) }}</div>
              <div class="mt-1 text-xs text-themed-muted">{{ orderEscrowText(item) }}</div>
              <div class="mt-1 text-xs text-themed-muted">手续费 {{ money(item.feeAmount) }}</div>
            </td>
            <td class="px-4 py-3">
              <div><span class="nimbus-pill" :class="['active','sold','completed','COMPLETED','approved','released','delivered'].includes(item.status) ? 'text-green-600 dark:text-green-400' : ['force_delisted','disputed','failed','FAILED','rejected'].includes(item.status) ? 'text-rose-600 dark:text-rose-400' : ['locked','escrowed','delivering','confirming','manual_review','PENDING','PROCESSING','pending','paying','open','processing','redelivering'].includes(item.status) ? 'text-amber-600 dark:text-amber-400' : 'text-themed-muted'"><span class="dot"></span>{{ statusLabel(item.status) }}</span></div>
              <div class="mt-1 text-xs text-themed-muted">任务：{{ item.deliveryTasks?.[0] ? statusLabel(item.deliveryTasks[0].status) : '等待创建' }} / {{ item.deliveryTasks?.[0] ? deliveryStepText(item.deliveryTasks[0]) : '-' }}</div>
              <div v-if="item.failureReason" class="mt-1 text-xs text-rose-600 dark:text-rose-400">{{ item.failureReason }}</div>
            </td>
            <td class="px-4 py-3 text-right">
              <div class="flex flex-wrap justify-end gap-2">
              <button
                v-if="!['completed', 'refunded', 'cancelled', 'manual_review'].includes(item.status)"
                class="btn btn-secondary btn-sm"
                type="button"
                @click="freezeOrder(item)"
              >
                冻结
              </button>
              <button
                v-if="['confirming', 'delivered', 'manual_review'].includes(item.status)"
                class="btn btn-secondary btn-sm"
                type="button"
                @click="releaseOrder(item)"
              >
                放款
              </button>
              <button
                v-if="!['completed', 'refunded', 'cancelled'].includes(item.status)"
                class="btn btn-secondary btn-sm"
                type="button"
                @click="cancelOrder(item)"
              >
                取消
              </button>
              <button
                v-if="!['completed', 'refunded', 'cancelled'].includes(item.status)"
                class="btn btn-danger btn-sm"
                type="button"
                @click="refundOrder(item)"
              >
                退款
              </button>
              </div>
            </td>
          </tr>
          <tr v-if="orders.length === 0"><td class="px-4 py-8 text-center text-themed-muted" colspan="7">暂无订单。</td></tr>
        </tbody>
      </table>
    </section>

    <section v-else-if="activeTab === 'delivery'" class="card overflow-hidden">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-themed">
            <th class="nimbus-th w-[8%]">任务</th>
            <th class="nimbus-th w-[16%]">订单</th>
            <th class="nimbus-th w-[14%]">实例</th>
            <th class="nimbus-th w-[22%]">交割步骤</th>
            <th class="nimbus-th w-[22%]">状态/托管</th>
            <th class="nimbus-th w-[18%] text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in deliveryTasks" :key="item.id" class="nimbus-row border-b border-themed align-top">
            <td class="px-4 py-3 font-medium text-themed">#{{ item.id }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.order?.orderNo || item.orderId }} <span class="text-themed-muted">({{ statusLabel(item.order?.status || '-') }})</span></td>
            <td class="px-4 py-3 break-words text-themed">{{ item.instance?.name || item.instanceId }} <span class="text-themed-muted">({{ item.instance?.status || '-' }})</span></td>
            <td class="px-4 py-3">
              <div class="text-themed">{{ deliveryStepText(item) }}</div>
              <div class="mt-1 text-xs text-themed-muted">重试 {{ item.retryCount || 0 }} 次</div>
              <div class="mt-1 text-xs text-themed-muted">开始 {{ formatDate(item.startedAt) }} / 完成 {{ formatDate(item.finishedAt) }}</div>
            </td>
            <td class="px-4 py-3">
              <div><span class="nimbus-pill" :class="['active','sold','completed','COMPLETED','approved','released','delivered'].includes(item.status) ? 'text-green-600 dark:text-green-400' : ['force_delisted','disputed','failed','FAILED','rejected'].includes(item.status) ? 'text-rose-600 dark:text-rose-400' : ['locked','escrowed','delivering','confirming','manual_review','PENDING','PROCESSING','pending','paying','open','processing','redelivering'].includes(item.status) ? 'text-amber-600 dark:text-amber-400' : 'text-themed-muted'"><span class="dot"></span>{{ statusLabel(item.status) }}</span></div>
              <div class="mt-1 text-xs text-themed-muted">订单资金：{{ item.order ? orderEscrowText(item.order) : '-' }}</div>
              <div v-if="item.order" class="mt-1 text-xs text-themed-muted">订单金额：{{ money(item.order.price) }} / 手续费 {{ money(item.order.feeAmount) }}</div>
              <div v-if="item.error" class="mt-1 text-xs text-rose-600 dark:text-rose-400">{{ item.error }}</div>
            </td>
            <td class="px-4 py-3 text-right">
              <div class="flex flex-wrap justify-end gap-2">
                <button class="btn btn-secondary btn-sm" type="button" @click="retryDelivery(item)">重试</button>
                <button class="btn btn-secondary btn-sm" type="button" @click="rollbackDelivery(item)">回滚</button>
                <button
                  v-if="item.status !== 'COMPLETED' && !['completed', 'refunded', 'cancelled'].includes(item.order?.status)"
                  class="btn btn-secondary btn-sm"
                  type="button"
                  @click="completeDelivery(item)"
                >
                  人工完成
                </button>
                <button class="btn btn-danger btn-sm" type="button" @click="manualTakeoverDelivery(item)">人工接管</button>
              </div>
            </td>
          </tr>
          <tr v-if="deliveryTasks.length === 0"><td class="px-4 py-8 text-center text-themed-muted" colspan="6">暂无交割任务。</td></tr>
        </tbody>
      </table>
    </section>

    <section v-else-if="activeTab === 'wallets'" class="card overflow-hidden">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-themed">
            <th class="nimbus-th w-[24%]">用户</th>
            <th class="nimbus-th w-[16%]">可用余额</th>
            <th class="nimbus-th w-[16%]">冻结金额</th>
            <th class="nimbus-th w-[20%]">更新时间</th>
            <th class="nimbus-th w-[24%] text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in wallets" :key="item.id" class="nimbus-row border-b border-themed align-top">
            <td class="px-4 py-3 break-words text-themed">{{ item.user?.username || '-' }} / #{{ item.userId }}</td>
            <td class="px-4 py-3 font-medium tabular-nums text-themed">{{ money(item.availableAmount) }}</td>
            <td class="px-4 py-3 tabular-nums text-themed-muted">{{ money(item.frozenAmount) }}</td>
            <td class="px-4 py-3 text-themed-muted">{{ formatDate(item.updatedAt) }}</td>
            <td class="px-4 py-3 text-right">
              <div class="flex flex-wrap justify-end gap-2">
              <button class="btn btn-secondary btn-sm" type="button" @click="freezeWallet(item)">冻结</button>
              <button class="btn btn-secondary btn-sm" type="button" @click="unfreezeWallet(item)">解冻</button>
              <button class="btn btn-danger btn-sm" type="button" @click="adjustWallet(item)">人工调整</button>
              </div>
            </td>
          </tr>
          <tr v-if="wallets.length === 0"><td class="px-4 py-8 text-center text-themed-muted" colspan="5">暂无交易所余额。</td></tr>
        </tbody>
      </table>
    </section>

    <section v-else-if="activeTab === 'withdrawals'" class="card overflow-hidden">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-themed">
            <th class="nimbus-th w-[18%]">提现单</th>
            <th class="nimbus-th w-[20%]">用户</th>
            <th class="nimbus-th w-[12%]">金额</th>
            <th class="nimbus-th w-[14%]">方式</th>
            <th class="nimbus-th w-[14%]">状态</th>
            <th class="nimbus-th w-[22%] text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in withdrawals" :key="item.id" class="nimbus-row border-b border-themed align-top">
            <td class="px-4 py-3 break-words font-medium text-themed">{{ item.withdrawalNo }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.user?.username }} / #{{ item.user?.id }}</td>
            <td class="px-4 py-3 font-medium tabular-nums text-themed">{{ money(item.amount) }}</td>
            <td class="px-4 py-3 break-words text-themed-muted">{{ item.method || '-' }}</td>
            <td class="px-4 py-3"><span class="nimbus-pill" :class="['active','sold','completed','COMPLETED','approved','released','delivered'].includes(item.status) ? 'text-green-600 dark:text-green-400' : ['force_delisted','disputed','failed','FAILED','rejected'].includes(item.status) ? 'text-rose-600 dark:text-rose-400' : ['locked','escrowed','delivering','confirming','manual_review','PENDING','PROCESSING','pending','paying','open','processing','redelivering'].includes(item.status) ? 'text-amber-600 dark:text-amber-400' : 'text-themed-muted'"><span class="dot"></span>{{ statusLabel(item.status) }}</span></td>
            <td class="px-4 py-3 text-right">
              <div class="flex flex-wrap items-center justify-end gap-2">
              <button v-if="item.status === 'pending'" class="btn btn-secondary btn-sm" type="button" @click="approveWithdrawal(item)">通过</button>
              <button v-if="['approved', 'paying'].includes(item.status)" class="btn btn-secondary btn-sm" type="button" @click="completeWithdrawal(item)">完成</button>
              <button v-if="['pending', 'approved'].includes(item.status)" class="btn btn-danger btn-sm" type="button" @click="rejectWithdrawal(item)">拒绝</button>
              <span v-if="!['pending', 'approved', 'paying'].includes(item.status)" class="text-xs text-themed-muted">无可用操作</span>
              </div>
            </td>
          </tr>
          <tr v-if="withdrawals.length === 0"><td class="px-4 py-8 text-center text-themed-muted" colspan="6">暂无提现。</td></tr>
        </tbody>
      </table>
    </section>

    <section v-else-if="activeTab === 'disputes'" class="card overflow-hidden">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-themed">
            <th class="nimbus-th w-[8%]">争议</th>
            <th class="nimbus-th w-[14%]">订单</th>
            <th class="nimbus-th w-[16%]">提交人</th>
            <th class="nimbus-th w-[22%]">原因</th>
            <th class="nimbus-th w-[12%]">状态</th>
            <th class="nimbus-th w-[14%]">时间</th>
            <th class="nimbus-th w-[14%] text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in disputes" :key="item.id" class="nimbus-row border-b border-themed align-top">
            <td class="px-4 py-3 font-medium text-themed">#{{ item.id }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.order?.orderNo || item.orderId }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.creator?.username }} / #{{ item.creator?.id }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.reason }}</td>
            <td class="px-4 py-3"><span class="nimbus-pill" :class="['active','sold','completed','COMPLETED','approved','released','delivered'].includes(item.status) ? 'text-green-600 dark:text-green-400' : ['force_delisted','disputed','failed','FAILED','rejected'].includes(item.status) ? 'text-rose-600 dark:text-rose-400' : ['locked','escrowed','delivering','confirming','manual_review','PENDING','PROCESSING','pending','paying','open','processing','redelivering'].includes(item.status) ? 'text-amber-600 dark:text-amber-400' : 'text-themed-muted'"><span class="dot"></span>{{ statusLabel(item.status) }}</span></td>
            <td class="px-4 py-3 text-themed-muted">{{ formatDate(item.createdAt) }}</td>
            <td class="px-4 py-3 text-right">
              <div class="flex flex-wrap justify-end gap-2">
              <button v-if="activeDisputeStatuses.includes(item.status)" class="btn btn-secondary btn-sm" type="button" @click="runDisputeAction(item, 'reject')">拒绝</button>
              <button v-if="activeDisputeStatuses.includes(item.status)" class="btn btn-danger btn-sm" type="button" @click="runDisputeAction(item, 'refund')">退款</button>
              <button v-if="activeDisputeStatuses.includes(item.status)" class="btn btn-secondary btn-sm" type="button" @click="runDisputeAction(item, 'release')">放款结案</button>
              </div>
            </td>
          </tr>
          <tr v-if="disputes.length === 0"><td class="px-4 py-8 text-center text-themed-muted" colspan="7">暂无争议。</td></tr>
        </tbody>
      </table>
    </section>

    <section v-else-if="activeTab === 'risk'" class="card overflow-hidden">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-themed">
            <th class="nimbus-th w-[16%]">实例</th>
            <th class="nimbus-th w-[14%]">用户</th>
            <th class="nimbus-th w-[12%]">节点</th>
            <th class="nimbus-th w-[10%]">评分</th>
            <th class="nimbus-th w-[14%]">状态</th>
            <th class="nimbus-th w-[20%]">原因</th>
            <th class="nimbus-th w-[14%]">更新时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in riskRecords" :key="item.id" class="nimbus-row border-b border-themed align-top">
            <td class="px-4 py-3 break-words text-themed">{{ item.instance?.name || item.instanceId }} <span class="text-themed-muted">({{ item.instance?.status || '-' }})</span></td>
            <td class="px-4 py-3 break-words text-themed">{{ item.user?.username || '-' }} / #{{ item.userId }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.host?.name || item.hostId }}</td>
            <td class="px-4 py-3 tabular-nums text-themed">{{ item.score }} / {{ item.level }}</td>
            <td class="px-4 py-3">
              <span class="nimbus-pill" :class="item.status === 'normal' ? 'text-green-600 dark:text-green-400' : item.status === 'suspended' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'"><span class="dot"></span>{{ item.status }}</span>
              <span v-if="item.currentBandwidthLimit" class="mt-1 block text-xs text-themed-muted">· {{ item.currentBandwidthLimit }}</span>
            </td>
            <td class="px-4 py-3 text-themed-muted"><span class="block break-words">{{ item.reason || '-' }}</span></td>
            <td class="px-4 py-3 text-themed-muted">{{ formatDate(item.updatedAt) }}</td>
          </tr>
          <tr v-if="riskRecords.length === 0"><td class="px-4 py-8 text-center text-themed-muted" colspan="7">暂无风控记录。</td></tr>
        </tbody>
      </table>
    </section>

    <section v-else-if="activeTab === 'config'" class="card p-6">
      <form class="grid gap-4 md:grid-cols-3" @submit.prevent="saveConfig">
        <label class="flex items-center gap-3 rounded-lg border border-themed bg-themed-surface p-3 md:col-span-3">
          <input v-model="policy.enabled" type="checkbox" class="h-4 w-4 rounded text-accent">
          <span class="text-sm font-medium text-themed">启用交易所</span>
        </label>
        <div class="nimbus-note md:col-span-3">
          <div class="font-medium text-themed">强制暂停状态上架：固定开启，不可关闭</div>
          <div class="mt-1 text-themed-muted">所有挂牌必须先暂停实例；挂牌后实例保持暂停/交易锁定，成交后强制重装交割。</div>
        </div>
        <div class="nimbus-note md:col-span-3">
          <div class="font-medium text-themed">自动确认规则：可配置</div>
          <div class="mt-1 text-themed-muted">交割完成进入确认期；启用自动放款时，超过确认期且无未完结争议后结算到卖家交易所余额。</div>
        </div>
        <label class="space-y-1.5"><span class="nimbus-field-label">最低剩余有效期</span><input v-model.number="policy.minRemainingDays" class="input w-full" type="number" min="1"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">即将到期阈值</span><input v-model.number="policy.expiringSoonDays" class="input w-full" type="number" min="1"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">最低售价</span><input v-model.number="policy.minPrice" class="input w-full" type="number" min="0" step="0.01"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">最高售价</span><input v-model.number="policy.maxPrice" class="input w-full" type="number" min="0" step="0.01"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">最大溢价 %</span><input v-model.number="policy.maxMarkupPercent" class="input w-full" type="number" min="0"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">手续费 %</span><input v-model.number="policy.feePercent" class="input w-full" type="number" min="0" step="0.01"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">最低手续费</span><input v-model.number="policy.minFee" class="input w-full" type="number" min="0" step="0.01"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">最高手续费</span><input v-model.number="policy.maxFee" class="input w-full" type="number" min="0" step="0.01"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">确认期小时</span><input v-model.number="policy.confirmationHours" class="input w-full" type="number" min="1"></label>
        <label class="flex items-center gap-2 rounded-lg border border-themed bg-themed-surface p-3"><input v-model="policy.autoConfirmEnabled" type="checkbox" class="h-4 w-4 rounded text-accent"><span class="text-sm text-themed">确认期结束自动放款</span></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">最低提现金额</span><input v-model.number="policy.minWithdrawalAmount" class="input w-full" type="number" min="0" step="0.01"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">每日提现上限</span><input v-model.number="policy.dailyWithdrawalLimit" class="input w-full" type="number" min="0" step="0.01"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">每日提现次数</span><input v-model.number="policy.dailyWithdrawalCountLimit" class="input w-full" type="number" min="1"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">最大挂牌数</span><input v-model.number="policy.maxActiveListingsPerUser" class="input w-full" type="number" min="1"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">每日购买数</span><input v-model.number="policy.maxPurchasesPerUserPerDay" class="input w-full" type="number" min="1"></label>
        <label class="space-y-1.5"><span class="nimbus-field-label">争议超时小时</span><input v-model.number="policy.disputeTimeoutHours" class="input w-full" type="number" min="1"></label>
        <label class="flex items-center gap-2 rounded-lg border border-themed bg-themed-surface p-3"><input v-model="policy.allowBalanceTransfer" type="checkbox" class="h-4 w-4 rounded text-accent"><span class="text-sm text-themed">允许划转余额</span></label>
        <label class="flex items-center gap-2 rounded-lg border border-themed bg-themed-surface p-3"><input v-model="policy.allowPublicIpTransfer" type="checkbox" class="h-4 w-4 rounded text-accent"><span class="text-sm text-themed">允许独立 IP 跟随</span></label>
        <label class="flex items-center gap-2 rounded-lg border border-themed bg-themed-surface p-3"><input v-model="policy.allowBuyerImageSelection" type="checkbox" class="h-4 w-4 rounded text-accent"><span class="text-sm text-themed">允许买家选镜像</span></label>
        <label class="space-y-1.5 md:col-span-3">
          <span class="nimbus-field-label">允许交易的套餐 ID</span>
          <textarea v-model="policy.packageAllowlistText" class="input w-full" rows="2" placeholder="留空表示全部允许；多个 ID 用逗号或空格分隔"></textarea>
        </label>
        <label class="space-y-1.5 md:col-span-3">
          <span class="nimbus-field-label">允许交易的节点 ID</span>
          <textarea v-model="policy.hostAllowlistText" class="input w-full" rows="2" placeholder="留空表示全部允许；多个 ID 用逗号或空格分隔"></textarea>
        </label>
        <div class="nimbus-warn md:col-span-3">
          “强制暂停状态上架”为固定规则，不能关闭。白名单为空时表示全部套餐/节点允许进入交易所。
        </div>
        <div class="md:col-span-3">
          <button class="btn btn-primary" type="submit">保存配置</button>
        </div>
      </form>
    </section>

    <section v-else-if="activeTab === 'audit'" class="card overflow-hidden">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-themed">
            <th class="nimbus-th w-[18%]">动作</th>
            <th class="nimbus-th w-[16%]">对象</th>
            <th class="nimbus-th w-[16%]">操作人</th>
            <th class="nimbus-th w-[32%]">详情</th>
            <th class="nimbus-th w-[18%]">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in auditLogs" :key="item.id" class="nimbus-row border-b border-themed align-top">
            <td class="px-4 py-3 break-words font-medium text-themed">{{ item.action }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.targetType }} #{{ item.targetId || '-' }}</td>
            <td class="px-4 py-3 break-words text-themed">{{ item.actor?.username || '-' }}</td>
            <td class="px-4 py-3 text-themed-muted"><span class="block truncate font-mono text-xs">{{ JSON.stringify(item.detail || {}) }}</span></td>
            <td class="px-4 py-3 text-themed-muted">{{ formatDate(item.createdAt) }}</td>
          </tr>
          <tr v-if="auditLogs.length === 0"><td class="px-4 py-8 text-center text-themed-muted" colspan="5">暂无审计日志。</td></tr>
        </tbody>
      </table>
    </section>

    <div
      v-if="adminActionDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      @click.self="closeAdminAction"
    >
      <section class="card w-full max-w-xl p-6 shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-themed pb-4">
          <div class="flex items-start gap-3">
            <span class="nimbus-title-icon shrink-0" :class="adminActionDialog.danger ? 'nimbus-title-icon--danger' : ''">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M12 9v3.75m0 3.75h.008M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.58 0Z" />
              </svg>
            </span>
            <div>
              <h2 class="text-lg font-semibold text-themed">{{ adminActionDialog.title }}</h2>
              <p class="mt-1 text-sm text-themed-muted">{{ adminActionDialog.message }}</p>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm shrink-0" type="button" :disabled="adminActionSubmitting" @click="closeAdminAction">关闭</button>
        </div>

        <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          该操作会写入交易所审计日志。涉及退款、提现、交割回滚、余额调整时，请确认线下证据和当前订单状态后再执行。
        </div>

        <div class="mt-4 space-y-3">
          <label v-if="adminActionDialog.requiresAmount" class="block text-sm">
            <span class="nimbus-field-label">{{ adminActionDialog.amountLabel || '金额' }}</span>
            <input v-model.number="adminActionDialog.amount" class="input mt-1 w-full" type="number" step="0.01">
            <span v-if="adminActionDialog.amountHelp" class="mt-1 block text-xs text-themed-muted">{{ adminActionDialog.amountHelp }}</span>
          </label>
          <label v-if="adminActionDialog.proofUrlLabel" class="block text-sm">
            <span class="nimbus-field-label">{{ adminActionDialog.proofUrlLabel }}</span>
            <input v-model="adminActionDialog.proofUrl" class="input mt-1 w-full" placeholder="https://...">
          </label>
          <label class="block text-sm">
            <span class="nimbus-field-label">{{ adminActionDialog.reasonLabel || '操作备注' }}</span>
            <textarea
              v-model="adminActionDialog.reason"
              class="input mt-1 w-full"
              rows="4"
              :placeholder="adminActionDialog.reasonPlaceholder || '填写本次操作原因、处理依据或备注'"
            ></textarea>
          </label>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" type="button" :disabled="adminActionSubmitting" @click="closeAdminAction">取消</button>
          <button
            class="btn"
            :class="adminActionDialog.danger ? 'btn-danger' : 'btn-primary'"
            type="button"
            :disabled="adminActionSubmitting"
            @click="submitAdminAction"
          >
            {{ adminActionSubmitting ? '处理中...' : adminActionDialog.confirmText }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Nimbus admin kit */
.nimbus-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kawaii-primary) 28%, transparent);
}

.nimbus-title-icon--danger {
  color: #dc2626;
  background: color-mix(in srgb, #dc2626 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #dc2626 28%, transparent);
}

:global(.dark) .nimbus-title-icon--danger {
  color: #f87171;
}

.nimbus-stat {
  position: relative;
  overflow: hidden;
}

.nimbus-stat::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 2.25rem;
  height: 2px;
  background: var(--kawaii-primary);
  border-radius: 0 0 2px 0;
}

.nimbus-stat-label {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
}

.nimbus-stat-value {
  margin-top: 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.1;
  color: var(--kawaii-text);
  font-variant-numeric: tabular-nums;
}

.nimbus-th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
  vertical-align: bottom;
}

.nimbus-row {
  transition: background-color 0.12s ease;
}

.nimbus-row:hover {
  background: color-mix(in srgb, var(--kawaii-primary) 5%, transparent);
}

.nimbus-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.nimbus-pill .dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: currentColor;
}

.nimbus-field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--kawaii-muted);
}

.nimbus-note {
  border-radius: 0.5rem;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface-soft);
  padding: 0.75rem 0.875rem;
  font-size: 0.8125rem;
}

.nimbus-warn {
  border-radius: 0.5rem;
  border: 1px solid color-mix(in srgb, #d97706 40%, transparent);
  background: color-mix(in srgb, #d97706 8%, transparent);
  padding: 0.75rem 0.875rem;
  font-size: 0.75rem;
  line-height: 1.6;
  color: #92400e;
}

:global(.dark) .nimbus-warn {
  color: #fcd34d;
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-row {
    transition: none;
  }
}
</style>
