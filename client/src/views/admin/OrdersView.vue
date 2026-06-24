<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api/admin'

type OrderSourceType = 'recharge' | 'instance_billing'
type OrderOperationStatus = 'pending_review' | 'confirmed' | 'compensated' | 'closed'

interface OrderOperationCase {
  id: number
  sourceType: OrderSourceType
  sourceId: number
  orderNo: string | null
  userId: number
  status: OrderOperationStatus
  reason: string
  result: string | null
  refundAmount: number | null
  providerSummary: Record<string, any> | null
  createdBy: { id: number; username: string } | null
  updatedBy: { id: number; username: string } | null
  balanceAdjustmentRequestId: number | null
  balanceAdjustmentRequest: BalanceAdjustmentRequest | null
  createdAt: string
  updatedAt: string
}

interface AdminOrderItem {
  id: string
  sourceType: OrderSourceType
  sourceId: number
  orderNo: string
  title: string
  status: string
  rawStatus: string
  amount: number
  actualAmount: number | null
  fee: number
  userId: number
  user: { id: number; username: string; email: string } | null
  provider: { id: number; name: string; type: string } | null
  providerStatusSummary: {
    provider: { id: number; name: string; type: string } | null
    rawStatus: string
    paymentMethod: string | null
    tradeNo: string | null
    callbackAt: string | null
  } | null
  paymentMethod: string | null
  tradeNo: string | null
  failReason: string | null
  instance: {
    id: number
    name: string
    displayName: string | null
    packagePlan?: { id: number; name: string; package?: { id: number; name: string } | null } | null
  } | null
  months: number | null
  periodStart: string | null
  periodEnd: string | null
  remark: string | null
  createdAt: string
  completedAt: string | null
  expiredAt: string | null
  operationCase: OrderOperationCase | null
}

interface BalanceAdjustmentRequest {
  id: number
  userId: number
  user: { id: number; username: string; email: string | null }
  requestedBy: { id: number; username: string }
  reviewedBy: { id: number; username: string } | null
  amount: number
  requestType: string
  status: string
  sourceType: string | null
  sourceId: number | null
  orderNo: string | null
  reason: string
  reviewRemark: string | null
  balanceLogId: number | null
  balanceLog: {
    id: number
    type: string
    amount: number
    balanceBefore: number
    balanceAfter: number
  } | null
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
}

const orders = ref<AdminOrderItem[]>([])
const selectedOrder = ref<AdminOrderItem | null>(null)
const adjustmentRequests = ref<BalanceAdjustmentRequest[]>([])
const loading = ref(false)
const requestLoading = ref(false)
const detailLoading = ref(false)
const error = ref('')
const requestError = ref('')
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const requestPage = ref(1)
const requestPageSize = 7
const requestTotal = ref(0)
const requestStatus = ref('pending')
const type = ref('')
const status = ref('')
const userId = ref('')
const keyword = ref('')
const createdFrom = ref('')
const createdTo = ref('')
const actionLoading = ref(false)
const reviewLoadingId = ref<number | null>(null)
const actionMessage = ref('')
const actionError = ref('')
const completeTradeNo = ref('')
const completeActualAmount = ref('')
const failReason = ref('')
const adjustmentAmount = ref('')
const adjustmentRemark = ref('')
const operationStatus = ref<OrderOperationStatus>('pending_review')
const operationReason = ref('')
const operationResult = ref('')
const operationRefundAmount = ref('')
const operationCreateRefundRequest = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const requestTotalPages = computed(() => Math.max(1, Math.ceil(requestTotal.value / requestPageSize)))

const typeOptions = [
  { value: '', label: '全部类型' },
  { value: 'recharge', label: '余额充值' },
  { value: 'instance_billing', label: '实例账单' }
]

const statusOptions = computed(() => {
  if (type.value === 'instance_billing') {
    return [
      { value: '', label: '全部状态' },
      { value: 'newPurchase', label: '新购' },
      { value: 'renew', label: '续费' },
      { value: 'upgrade', label: '升级' },
      { value: 'downgrade', label: '降级' },
      { value: 'refund', label: '退款' },
      { value: 'transfer_fee', label: '转移手续费' }
    ]
  }

  return [
    { value: '', label: '全部状态' },
    { value: 'pending', label: '待支付' },
    { value: 'paid', label: '处理中' },
    { value: 'completed', label: '已完成' },
    { value: 'failed', label: '失败' },
    { value: 'cancelled', label: '已取消' },
    { value: 'refunded', label: '已退款' }
  ]
})

const requestStatusOptions = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
  { value: '', label: '全部' }
]

const operationStatusOptions: Array<{ value: OrderOperationStatus; label: string }> = [
  { value: 'pending_review', label: '待核查' },
  { value: 'confirmed', label: '已确认' },
  { value: 'compensated', label: '已补偿' },
  { value: 'closed', label: '已关闭' }
]

function formatMoney(value: number | null | undefined): string {
  return `¥${Number(value || 0).toFixed(2)}`
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function statusLabel(order: AdminOrderItem): string {
  const labels: Record<string, string> = {
    completed: '已完成',
    pending: '待处理',
    failed: '失败',
    cancelled: '已取消',
    refunded: '已退款'
  }
  return labels[order.status] || order.rawStatus
}

function statusClass(statusValue: string): string {
  if (statusValue === 'completed') return 'bg-green-50 text-green-700 border-green-200'
  if (statusValue === 'pending') return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  if (statusValue === 'refunded') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (statusValue === 'failed' || statusValue === 'cancelled') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function operationStatusLabel(statusValue: string | null | undefined): string {
  const labels: Record<string, string> = {
    pending_review: '待核查',
    confirmed: '已确认',
    compensated: '已补偿',
    closed: '已关闭'
  }
  return statusValue ? labels[statusValue] || statusValue : '未登记'
}

function operationStatusClass(statusValue: string | null | undefined): string {
  if (statusValue === 'pending_review') return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  if (statusValue === 'confirmed') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (statusValue === 'compensated') return 'bg-green-50 text-green-700 border-green-200'
  if (statusValue === 'closed') return 'bg-gray-50 text-gray-700 border-gray-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function sourceLabel(sourceType: OrderSourceType): string {
  return sourceType === 'recharge' ? '充值订单' : '实例账单'
}

function adjustmentTypeLabel(requestType: string): string {
  return requestType === 'refund' ? '退款补偿' : '人工调账'
}

function adjustmentStatusLabel(statusValue: string): string {
  const labels: Record<string, string> = {
    pending: '待审核',
    approved: '已通过',
    rejected: '已驳回'
  }
  return labels[statusValue] || statusValue
}

function adjustmentStatusClass(statusValue: string): string {
  if (statusValue === 'approved') return 'bg-green-50 text-green-700 border-green-200'
  if (statusValue === 'pending') return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  if (statusValue === 'rejected') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

const canCompleteRecharge = computed(() => {
  return selectedOrder.value?.sourceType === 'recharge' && ['pending', 'paid'].includes(selectedOrder.value.rawStatus)
})

const canFailRecharge = computed(() => {
  return selectedOrder.value?.sourceType === 'recharge' && ['pending', 'paid'].includes(selectedOrder.value.rawStatus)
})

const canAdjustBalance = computed(() => {
  return Boolean(selectedOrder.value?.userId)
})

function instanceName(order: AdminOrderItem): string {
  if (!order.instance) return '-'
  return order.instance.displayName || order.instance.name
}

function parsedUserId(): number | undefined {
  const trimmed = userId.value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined
  return Number(trimmed)
}

function syncOperationForm(order: AdminOrderItem) {
  const operationCase = order.operationCase
  operationStatus.value = operationCase?.status || 'pending_review'
  operationReason.value = operationCase?.reason || (order.sourceType === 'recharge'
    ? `充值订单 ${order.orderNo} 待核查`
    : `实例账单 ${order.orderNo} 待核查`)
  operationResult.value = operationCase?.result || ''
  operationRefundAmount.value = operationCase?.refundAmount ? String(operationCase.refundAmount) : ''
  operationCreateRefundRequest.value = false
}

const hasPendingRefundRequest = computed(() => {
  const request = selectedOrder.value?.operationCase?.balanceAdjustmentRequest
  return request?.requestType === 'refund' && request.status === 'pending'
})

async function loadOrders() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.orders.list({
      page: page.value,
      pageSize: pageSize.value,
      type: type.value || undefined,
      status: status.value || undefined,
      userId: parsedUserId(),
      keyword: keyword.value.trim() || undefined,
      createdFrom: createdFrom.value || undefined,
      createdTo: createdTo.value || undefined
    })
    orders.value = res.orders as AdminOrderItem[]
    total.value = res.total
  } catch (err: any) {
    error.value = err?.message || '订单加载失败'
  } finally {
    loading.value = false
  }
}

async function loadAdjustmentRequests() {
  requestLoading.value = true
  requestError.value = ''
  try {
    const res = await api.admin.getBalanceAdjustmentRequests({
      page: requestPage.value,
      pageSize: requestPageSize,
      status: requestStatus.value || undefined
    })
    adjustmentRequests.value = res.requests as BalanceAdjustmentRequest[]
    requestTotal.value = res.total
  } catch (err: any) {
    requestError.value = err?.message || '调账审批任务加载失败'
  } finally {
    requestLoading.value = false
  }
}

async function openDetail(order: AdminOrderItem) {
  selectedOrder.value = order
  actionMessage.value = ''
  actionError.value = ''
  completeTradeNo.value = order.tradeNo || ''
  completeActualAmount.value = order.actualAmount ? String(order.actualAmount) : ''
  failReason.value = order.failReason || ''
  adjustmentAmount.value = ''
  adjustmentRemark.value = order.sourceType === 'recharge'
    ? `订单 ${order.orderNo} 人工处理`
    : `账单 ${order.orderNo} 人工处理`
  syncOperationForm(order)
  detailLoading.value = true
  try {
    const res = await api.orders.detail(order.sourceType, order.sourceId)
    selectedOrder.value = res.order as AdminOrderItem
    completeTradeNo.value = selectedOrder.value.tradeNo || ''
    completeActualAmount.value = selectedOrder.value.actualAmount ? String(selectedOrder.value.actualAmount) : ''
    syncOperationForm(selectedOrder.value)
  } finally {
    detailLoading.value = false
  }
}

function parseActionAmount(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null
}

function parseOptionalPositiveAmount(value: string): number | undefined | null {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function refreshSelectedOrder() {
  if (!selectedOrder.value) return
  const current = selectedOrder.value
  const res = await api.orders.detail(current.sourceType, current.sourceId)
  selectedOrder.value = res.order as AdminOrderItem
  await loadOrders()
}

async function completeRecharge() {
  if (!selectedOrder.value || !canCompleteRecharge.value) return
  const actualAmount = parseOptionalPositiveAmount(completeActualAmount.value)
  if (actualAmount === null) {
    actionError.value = '实际入账金额必须是大于 0 的金额，最多两位小数'
    return
  }

  actionLoading.value = true
  actionMessage.value = ''
  actionError.value = ''
  try {
    const result = await api.admin.completeRechargeOrder(
      selectedOrder.value.orderNo,
      completeTradeNo.value.trim() || undefined,
      actualAmount
    )
    actionMessage.value = result.message || '订单已手动完成'
    await refreshSelectedOrder()
  } catch (err: any) {
    actionError.value = err?.message || '手动完成失败'
  } finally {
    actionLoading.value = false
  }
}

async function failRecharge() {
  if (!selectedOrder.value || !canFailRecharge.value) return
  const reason = failReason.value.trim()
  if (!reason) {
    actionError.value = '请填写失败原因'
    return
  }

  actionLoading.value = true
  actionMessage.value = ''
  actionError.value = ''
  try {
    const result = await api.admin.failRechargeOrder(selectedOrder.value.orderNo, reason)
    actionMessage.value = result.message || '订单已标记失败'
    await refreshSelectedOrder()
  } catch (err: any) {
    actionError.value = err?.message || '标记失败失败'
  } finally {
    actionLoading.value = false
  }
}

async function adjustBalance() {
  if (!selectedOrder.value || !canAdjustBalance.value) return
  const amount = parseActionAmount(adjustmentAmount.value)
  const remark = adjustmentRemark.value.trim()
  if (amount === null) {
    actionError.value = '调账金额必须是非 0 金额，最多两位小数；退款/补款填正数，扣款填负数'
    return
  }
  if (!remark) {
    actionError.value = '请填写调账原因'
    return
  }

  actionLoading.value = true
  actionMessage.value = ''
  actionError.value = ''
  try {
    const result = await api.admin.createBalanceAdjustmentRequest(selectedOrder.value.userId, {
      amount,
      reason: remark,
      requestType: amount > 0 ? 'refund' : 'manual_adjust',
      sourceType: selectedOrder.value.sourceType,
      sourceId: selectedOrder.value.sourceId,
      orderNo: selectedOrder.value.orderNo
    })
    actionMessage.value = `${result.message}：#${result.request.id}`
    adjustmentAmount.value = ''
    requestStatus.value = 'pending'
    requestPage.value = 1
    await loadAdjustmentRequests()
    await refreshSelectedOrder()
  } catch (err: any) {
    actionError.value = err?.message || '调账申请提交失败'
  } finally {
    actionLoading.value = false
  }
}

async function saveOperationCase() {
  if (!selectedOrder.value) return
  const reason = operationReason.value.trim()
  const result = operationResult.value.trim()
  if (!reason) {
    actionError.value = '请填写运营处理原因'
    return
  }
  const refundAmount = parseOptionalPositiveAmount(operationRefundAmount.value)
  if (operationCreateRefundRequest.value && refundAmount === undefined) {
    actionError.value = '勾选退款登记时必须填写退款金额'
    return
  }
  if (refundAmount === null) {
    actionError.value = '退款金额必须是大于 0 的金额，最多两位小数'
    return
  }
  if (operationCreateRefundRequest.value && hasPendingRefundRequest.value) {
    actionError.value = '该订单已有待审核退款审批，不能重复登记'
    return
  }

  actionLoading.value = true
  actionMessage.value = ''
  actionError.value = ''
  try {
    const response = await api.orders.recordOperation(selectedOrder.value.sourceType, selectedOrder.value.sourceId, {
      status: operationStatus.value,
      reason,
      result: result || undefined,
      refundAmount,
      createRefundRequest: operationCreateRefundRequest.value
    })
    actionMessage.value = response.message || '订单运营处理记录已保存'
    operationCreateRefundRequest.value = false
    requestStatus.value = 'pending'
    requestPage.value = 1
    await loadAdjustmentRequests()
    await refreshSelectedOrder()
  } catch (err: any) {
    actionError.value = err?.message || '订单运营处理保存失败'
  } finally {
    actionLoading.value = false
  }
}

async function approveAdjustmentRequest(request: BalanceAdjustmentRequest) {
  if (request.status !== 'pending') return
  reviewLoadingId.value = request.id
  requestError.value = ''
  try {
    await api.admin.approveBalanceAdjustmentRequest(request.id, `订单中心审批通过 #${request.id}`)
    await loadAdjustmentRequests()
    await loadOrders()
  } catch (err: any) {
    requestError.value = err?.message || '审批通过失败'
  } finally {
    reviewLoadingId.value = null
  }
}

async function rejectAdjustmentRequest(request: BalanceAdjustmentRequest) {
  if (request.status !== 'pending') return
  reviewLoadingId.value = request.id
  requestError.value = ''
  try {
    await api.admin.rejectBalanceAdjustmentRequest(request.id, `订单中心驳回 #${request.id}`)
    await loadAdjustmentRequests()
  } catch (err: any) {
    requestError.value = err?.message || '驳回失败'
  } finally {
    reviewLoadingId.value = null
  }
}

function applyFilters() {
  page.value = 1
  void loadOrders()
}

function clearFilters() {
  type.value = ''
  status.value = ''
  userId.value = ''
  keyword.value = ''
  createdFrom.value = ''
  createdTo.value = ''
  applyFilters()
}

function goPage(nextPage: number) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  void loadOrders()
}

function applyRequestFilters() {
  requestPage.value = 1
  void loadAdjustmentRequests()
}

function goRequestPage(nextPage: number) {
  if (nextPage < 1 || nextPage > requestTotalPages.value || nextPage === requestPage.value) return
  requestPage.value = nextPage
  void loadAdjustmentRequests()
}

onMounted(() => {
  void loadOrders()
  void loadAdjustmentRequests()
})
</script>

<template>
  <div class="space-y-5">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-themed">订单中心</h1>
        <p class="mt-1 text-sm text-themed-muted">统一查看充值订单、实例新购、续费、升级和退款账单。</p>
      </div>
      <button class="btn btn-outline" :disabled="loading" @click="loadOrders">刷新</button>
    </header>

    <section class="rounded-lg border border-themed bg-themed-secondary p-4">
      <div class="grid gap-3 lg:grid-cols-[160px_160px_140px_minmax(220px,1fr)_150px_150px_auto]">
        <select v-model="type" class="input" @change="status = ''; applyFilters()">
          <option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <select v-model="status" class="input" @change="applyFilters">
          <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <input v-model="userId" class="input" placeholder="用户 ID" @keyup.enter="applyFilters" />
        <input v-model="keyword" class="input" placeholder="订单号、交易号、用户名、实例名" @keyup.enter="applyFilters" />
        <input v-model="createdFrom" class="input" type="date" title="开始日期" @change="applyFilters" />
        <input v-model="createdTo" class="input" type="date" title="结束日期" @change="applyFilters" />
        <button class="btn btn-outline justify-self-start" @click="clearFilters">重置</button>
      </div>
    </section>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</div>

    <section class="overflow-hidden rounded-lg border border-themed bg-themed-secondary">
      <div v-if="loading" class="p-8 text-center text-sm text-themed-muted">正在加载订单...</div>
      <div v-else-if="orders.length === 0" class="p-8 text-center text-sm text-themed-muted">暂无订单记录</div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-themed">
          <thead class="bg-themed-tertiary">
            <tr class="text-left text-xs font-medium text-themed-muted">
              <th class="px-4 py-3">订单</th>
              <th class="px-4 py-3">用户</th>
              <th class="px-4 py-3">类型</th>
              <th class="px-4 py-3">金额</th>
              <th class="px-4 py-3">状态</th>
              <th class="px-4 py-3">关联实例</th>
              <th class="px-4 py-3">时间</th>
              <th class="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr v-for="order in orders" :key="order.id" class="text-sm">
              <td class="px-4 py-3">
                <div class="font-medium text-themed">{{ order.title }}</div>
                <div class="text-xs text-themed-muted">{{ order.orderNo }}</div>
              </td>
              <td class="px-4 py-3">
                <div class="text-themed">{{ order.user?.username || `#${order.userId}` }}</div>
                <div class="text-xs text-themed-muted">{{ order.user?.email || '-' }}</div>
              </td>
              <td class="px-4 py-3 text-themed-muted">{{ sourceLabel(order.sourceType) }}</td>
              <td class="px-4 py-3 font-medium text-themed">{{ formatMoney(order.amount) }}</td>
              <td class="px-4 py-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs', statusClass(order.status)]">{{ statusLabel(order) }}</span>
                <span
                  v-if="order.operationCase"
                  :class="['ml-2 inline-flex rounded-full border px-2 py-0.5 text-xs', operationStatusClass(order.operationCase.status)]"
                >
                  {{ operationStatusLabel(order.operationCase.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-themed-muted">{{ instanceName(order) }}</td>
              <td class="px-4 py-3 text-themed-muted">{{ formatTime(order.createdAt) }}</td>
              <td class="px-4 py-3 text-right">
                <button class="btn btn-sm btn-outline" @click="openDetail(order)">详情</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between border-t border-themed px-4 py-3 text-sm text-themed-muted">
        <span>共 {{ total }} 条记录</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-sm btn-outline" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <span>{{ page }} / {{ totalPages }}</span>
          <button class="btn btn-sm btn-outline" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
        </div>
      </div>
    </section>

    <section class="overflow-hidden rounded-lg border border-themed bg-themed-secondary">
      <div class="flex flex-col gap-3 border-b border-themed p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-lg font-semibold text-themed">调账审批</h2>
          <p class="mt-1 text-sm text-themed-muted">订单退款、补款和扣款先进入审批任务，通过后才会写入余额日志。</p>
        </div>
        <div class="flex items-center gap-2">
          <select v-model="requestStatus" class="input w-32" @change="applyRequestFilters">
            <option v-for="item in requestStatusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
          <button class="btn btn-outline" :disabled="requestLoading" @click="loadAdjustmentRequests">刷新</button>
        </div>
      </div>

      <div v-if="requestError" class="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ requestError }}</div>
      <div v-if="requestLoading" class="p-6 text-center text-sm text-themed-muted">正在加载审批任务...</div>
      <div v-else-if="adjustmentRequests.length === 0" class="p-6 text-center text-sm text-themed-muted">暂无调账审批任务</div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-themed">
          <thead class="bg-themed-tertiary">
            <tr class="text-left text-xs font-medium text-themed-muted">
              <th class="px-4 py-3">申请</th>
              <th class="px-4 py-3">用户</th>
              <th class="px-4 py-3">金额</th>
              <th class="px-4 py-3">来源</th>
              <th class="px-4 py-3">状态</th>
              <th class="px-4 py-3">时间</th>
              <th class="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr v-for="request in adjustmentRequests" :key="request.id" class="text-sm">
              <td class="px-4 py-3">
                <div class="font-medium text-themed">#{{ request.id }} {{ adjustmentTypeLabel(request.requestType) }}</div>
                <div class="max-w-[260px] truncate text-xs text-themed-muted">{{ request.reason }}</div>
              </td>
              <td class="px-4 py-3">
                <div class="text-themed">{{ request.user.username }}</div>
                <div class="text-xs text-themed-muted">申请人 {{ request.requestedBy.username }}</div>
              </td>
              <td class="px-4 py-3 font-medium" :class="request.amount >= 0 ? 'text-green-700' : 'text-red-700'">
                {{ request.amount >= 0 ? '+' : '' }}{{ formatMoney(request.amount) }}
              </td>
              <td class="px-4 py-3 text-themed-muted">
                <div>{{ request.orderNo || '-' }}</div>
                <div class="text-xs">{{ request.sourceType || '-' }}</div>
              </td>
              <td class="px-4 py-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs', adjustmentStatusClass(request.status)]">
                  {{ adjustmentStatusLabel(request.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-themed-muted">{{ formatTime(request.createdAt) }}</td>
              <td class="px-4 py-3 text-right">
                <div v-if="request.status === 'pending'" class="flex justify-end gap-2">
                  <button class="btn btn-sm btn-outline text-red-600" :disabled="reviewLoadingId === request.id" @click="rejectAdjustmentRequest(request)">驳回</button>
                  <button class="btn btn-sm btn-primary" :disabled="reviewLoadingId === request.id" @click="approveAdjustmentRequest(request)">通过并执行</button>
                </div>
                <span v-else class="text-xs text-themed-muted">{{ request.reviewedBy?.username || '-' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between border-t border-themed px-4 py-3 text-sm text-themed-muted">
        <span>共 {{ requestTotal }} 条审批</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-sm btn-outline" :disabled="requestPage <= 1" @click="goRequestPage(requestPage - 1)">上一页</button>
          <span>{{ requestPage }} / {{ requestTotalPages }}</span>
          <button class="btn btn-sm btn-outline" :disabled="requestPage >= requestTotalPages" @click="goRequestPage(requestPage + 1)">下一页</button>
        </div>
      </div>
    </section>

    <div v-if="selectedOrder" class="fixed inset-0 z-50 flex justify-end bg-black/30" @click.self="selectedOrder = null">
      <aside class="h-full w-full max-w-xl overflow-y-auto bg-themed p-6 shadow-xl">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold text-themed">{{ selectedOrder.title }}</h2>
            <p class="mt-1 text-sm text-themed-muted">{{ selectedOrder.orderNo }}</p>
          </div>
          <button class="btn btn-sm btn-outline" @click="selectedOrder = null">关闭</button>
        </div>

        <div v-if="detailLoading" class="mt-6 text-sm text-themed-muted">正在加载详情...</div>
        <dl v-else class="mt-6 grid gap-4 text-sm">
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">用户</dt><dd class="col-span-2 text-themed">{{ selectedOrder.user?.username || `#${selectedOrder.userId}` }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">状态</dt><dd class="col-span-2 text-themed">{{ statusLabel(selectedOrder) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">金额</dt><dd class="col-span-2 text-themed">{{ formatMoney(selectedOrder.amount) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">实际到账</dt><dd class="col-span-2 text-themed">{{ selectedOrder.actualAmount === null ? '-' : formatMoney(selectedOrder.actualAmount) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">手续费</dt><dd class="col-span-2 text-themed">{{ formatMoney(selectedOrder.fee) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">支付渠道</dt><dd class="col-span-2 text-themed">{{ selectedOrder.provider?.name || selectedOrder.paymentMethod || '-' }}</dd></div>
          <div v-if="selectedOrder.providerStatusSummary" class="grid grid-cols-3 gap-3">
            <dt class="text-themed-muted">Provider 摘要</dt>
            <dd class="col-span-2 text-themed">
              <div>原始状态：{{ selectedOrder.providerStatusSummary.rawStatus }}</div>
              <div>交易号：{{ selectedOrder.providerStatusSummary.tradeNo || '-' }}</div>
              <div>回调时间：{{ formatTime(selectedOrder.providerStatusSummary.callbackAt) }}</div>
            </dd>
          </div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">交易号</dt><dd class="col-span-2 break-all text-themed">{{ selectedOrder.tradeNo || '-' }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">关联实例</dt><dd class="col-span-2 text-themed">{{ instanceName(selectedOrder) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">账期</dt><dd class="col-span-2 text-themed">{{ selectedOrder.months ? `${selectedOrder.months} 个月` : '-' }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">开始时间</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.periodStart) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">结束时间</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.periodEnd) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">创建时间</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.createdAt) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">完成时间</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.completedAt) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">失败原因</dt><dd class="col-span-2 text-themed">{{ selectedOrder.failReason || '-' }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">备注</dt><dd class="col-span-2 text-themed">{{ selectedOrder.remark || '-' }}</dd></div>
        </dl>

        <div v-if="actionMessage" class="mt-5 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{{ actionMessage }}</div>
        <div v-if="actionError" class="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ actionError }}</div>

        <section class="mt-6 border-t border-themed pt-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-base font-semibold text-themed">订单运营处理</h3>
              <p class="mt-1 text-sm text-themed-muted">登记争议状态和人工退款申请。退款登记只创建调账审批，不会直接修改余额。</p>
            </div>
            <span :class="['shrink-0 rounded-full border px-2 py-0.5 text-xs', operationStatusClass(selectedOrder.operationCase?.status)]">
              {{ operationStatusLabel(selectedOrder.operationCase?.status) }}
            </span>
          </div>

          <div v-if="selectedOrder.operationCase" class="mt-4 rounded-lg border border-themed bg-themed-secondary p-3 text-sm">
            <div class="grid gap-2 text-themed-muted">
              <div>最近处理：{{ selectedOrder.operationCase.updatedBy?.username || selectedOrder.operationCase.createdBy?.username || '-' }} · {{ formatTime(selectedOrder.operationCase.updatedAt) }}</div>
              <div>处理原因：<span class="text-themed">{{ selectedOrder.operationCase.reason }}</span></div>
              <div v-if="selectedOrder.operationCase.result">处理结果：<span class="text-themed">{{ selectedOrder.operationCase.result }}</span></div>
              <div v-if="selectedOrder.operationCase.balanceAdjustmentRequest">
                关联审批：
                <span class="text-themed">#{{ selectedOrder.operationCase.balanceAdjustmentRequest.id }} · {{ adjustmentTypeLabel(selectedOrder.operationCase.balanceAdjustmentRequest.requestType) }} · {{ adjustmentStatusLabel(selectedOrder.operationCase.balanceAdjustmentRequest.status) }}</span>
              </div>
            </div>
          </div>

          <div class="mt-4 grid gap-3">
            <label class="text-sm">
              <span class="mb-1 block text-themed-muted">争议状态</span>
              <select v-model="operationStatus" class="input" :disabled="actionLoading">
                <option v-for="item in operationStatusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label class="text-sm">
              <span class="mb-1 block text-themed-muted">处理原因</span>
              <textarea v-model="operationReason" class="input min-h-[84px]" placeholder="写明订单异常、核查依据或退款原因" :disabled="actionLoading" />
            </label>
            <label class="text-sm">
              <span class="mb-1 block text-themed-muted">处理结果</span>
              <textarea v-model="operationResult" class="input min-h-[72px]" placeholder="可选，例如已联系用户、等待 provider 对账、已补偿" :disabled="actionLoading" />
            </label>
            <label class="flex items-center gap-2 text-sm text-themed">
              <input v-model="operationCreateRefundRequest" type="checkbox" :disabled="actionLoading || hasPendingRefundRequest" />
              <span>同时登记退款审批</span>
            </label>
            <label class="text-sm">
              <span class="mb-1 block text-themed-muted">退款金额</span>
              <input v-model="operationRefundAmount" class="input" placeholder="勾选退款登记时必填，例如 10.00" :disabled="actionLoading || !operationCreateRefundRequest" />
            </label>
            <p v-if="hasPendingRefundRequest" class="text-sm text-yellow-700">该订单已有待审核退款审批，需处理完成后才能再次登记。</p>
            <button class="btn btn-primary justify-self-start" :disabled="actionLoading" @click="saveOperationCase">保存运营处理</button>
          </div>
        </section>

        <section v-if="selectedOrder.sourceType === 'recharge'" class="mt-6 border-t border-themed pt-5">
          <h3 class="text-base font-semibold text-themed">充值订单处理</h3>
          <p class="mt-1 text-sm text-themed-muted">仅待支付或处理中订单允许人工完成或标记失败，入账仍走原有充值完成逻辑。</p>
          <div class="mt-4 grid gap-3">
            <label class="text-sm">
              <span class="mb-1 block text-themed-muted">交易号</span>
              <input v-model="completeTradeNo" class="input" placeholder="可选，第三方交易号或线下凭证号" :disabled="!canCompleteRecharge || actionLoading" />
            </label>
            <label class="text-sm">
              <span class="mb-1 block text-themed-muted">实际入账金额</span>
              <input v-model="completeActualAmount" class="input" placeholder="留空则按订单金额入账" :disabled="!canCompleteRecharge || actionLoading" />
            </label>
            <div class="flex flex-wrap gap-2">
              <button class="btn btn-primary" :disabled="!canCompleteRecharge || actionLoading" @click="completeRecharge">手动完成并入账</button>
            </div>
            <label class="text-sm">
              <span class="mb-1 block text-themed-muted">失败原因</span>
              <textarea v-model="failReason" class="input min-h-[84px]" placeholder="标记失败时必须填写原因" :disabled="!canFailRecharge || actionLoading" />
            </label>
            <button class="btn btn-outline justify-self-start text-red-600" :disabled="!canFailRecharge || actionLoading" @click="failRecharge">标记失败</button>
          </div>
        </section>

        <section class="mt-6 border-t border-themed pt-5">
          <h3 class="text-base font-semibold text-themed">人工调账 / 退款审批</h3>
          <p class="mt-1 text-sm text-themed-muted">用于补款、退款或扣款。正数增加用户余额，负数扣减用户余额；提交后进入审批任务，通过后才会写入余额日志。</p>
          <div class="mt-4 grid gap-3">
            <label class="text-sm">
              <span class="mb-1 block text-themed-muted">调账金额</span>
              <input v-model="adjustmentAmount" class="input" placeholder="例如 10.00 或 -5.00" :disabled="actionLoading" />
            </label>
            <label class="text-sm">
              <span class="mb-1 block text-themed-muted">调账原因</span>
              <textarea v-model="adjustmentRemark" class="input min-h-[84px]" placeholder="必须写明订单、原因和处理结论" :disabled="actionLoading" />
            </label>
            <button class="btn btn-primary justify-self-start" :disabled="actionLoading" @click="adjustBalance">提交调账审批</button>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>
