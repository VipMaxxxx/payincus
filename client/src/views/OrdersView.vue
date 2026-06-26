<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'

type OrderSourceType = 'recharge' | 'instance_billing'

interface OrderItem {
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
  provider: { id: number; name: string; type: string } | null
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
}

const orders = ref<OrderItem[]>([])
const selectedOrder = ref<OrderItem | null>(null)
const loading = ref(false)
const detailLoading = ref(false)
const error = ref('')
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const type = ref('')
const status = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

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

function formatMoney(value: number | null | undefined): string {
  return `¥${Number(value || 0).toFixed(2)}`
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function statusLabel(order: OrderItem): string {
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

function sourceLabel(sourceType: OrderSourceType): string {
  return sourceType === 'recharge' ? '充值订单' : '实例账单'
}

function instanceName(order: OrderItem): string {
  if (!order.instance) return '-'
  return order.instance.displayName || order.instance.name
}

async function loadOrders() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.orders.list({
      page: page.value,
      pageSize: pageSize.value,
      type: type.value || undefined,
      status: status.value || undefined
    })
    orders.value = res.orders as OrderItem[]
    total.value = res.total
  } catch (err: any) {
    error.value = err?.message || '订单加载失败'
  } finally {
    loading.value = false
  }
}

async function openDetail(order: OrderItem) {
  selectedOrder.value = order
  detailLoading.value = true
  try {
    const res = await api.orders.detail(order.sourceType, order.sourceId)
    selectedOrder.value = res.order as OrderItem
  } finally {
    detailLoading.value = false
  }
}

function applyFilters() {
  page.value = 1
  void loadOrders()
}

function clearFilters() {
  type.value = ''
  status.value = ''
  applyFilters()
}

function goPage(nextPage: number) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  void loadOrders()
}

onMounted(loadOrders)
</script>

<template>
  <div class="space-y-5">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-themed">订单中心</h1>
        <p class="mt-1 text-sm text-themed-muted">查看充值订单、实例新购、续费和退款账单。</p>
      </div>
      <button class="btn btn-outline" :disabled="loading" @click="loadOrders">刷新</button>
    </header>

    <ThemeTemplateSlot slot-name="user.orders.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />

    <section class="rounded-lg border border-themed bg-themed-secondary p-4">
      <div class="grid gap-3 md:grid-cols-[180px_180px_auto]">
        <select v-model="type" class="input" @change="status = ''; applyFilters()">
          <option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <select v-model="status" class="input" @change="applyFilters">
          <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
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
              <td class="px-4 py-3 text-themed-muted">{{ sourceLabel(order.sourceType) }}</td>
              <td class="px-4 py-3 font-medium text-themed">{{ formatMoney(order.amount) }}</td>
              <td class="px-4 py-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs', statusClass(order.status)]">{{ statusLabel(order) }}</span>
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
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">状态</dt><dd class="col-span-2 text-themed">{{ statusLabel(selectedOrder) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">金额</dt><dd class="col-span-2 text-themed">{{ formatMoney(selectedOrder.amount) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">实际到账</dt><dd class="col-span-2 text-themed">{{ selectedOrder.actualAmount === null ? '-' : formatMoney(selectedOrder.actualAmount) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">手续费</dt><dd class="col-span-2 text-themed">{{ formatMoney(selectedOrder.fee) }}</dd></div>
          <div class="grid grid-cols-3 gap-3"><dt class="text-themed-muted">支付渠道</dt><dd class="col-span-2 text-themed">{{ selectedOrder.provider?.name || selectedOrder.paymentMethod || '-' }}</dd></div>
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
      </aside>
    </div>
  </div>
</template>
