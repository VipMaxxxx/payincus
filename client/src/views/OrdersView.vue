<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import { useReveal } from '@/composables/useReveal'

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)

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
  if (statusValue === 'refunded') return 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
  if (statusValue === 'failed' || statusValue === 'cancelled') return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20'
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
  <div ref="revealRoot" class="space-y-5 animate-fade-in">
    <header data-reveal class="page-header flex-col gap-4 sm:flex-row sm:items-center sm:gap-0">
      <div>
        <h1 class="page-title">订单中心</h1>
        <p class="page-description">查看充值订单、实例新购、续费和退款账单。</p>
      </div>
      <button class="btn btn-secondary w-full justify-center gap-2 sm:w-auto" :disabled="loading" @click="loadOrders">
        <svg class="h-4 w-4" :class="{ 'animate-spin': loading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
        刷新
      </button>
    </header>

    <ThemeTemplateSlot slot-name="user.orders.banner" container-class="overflow-hidden rounded-xl border border-themed bg-themed-surface" />

    <section data-reveal class="nimbus-lift rounded-xl border border-themed bg-themed-surface p-4 shadow-sm">
      <div class="grid gap-3 md:grid-cols-[180px_180px_auto]">
        <select v-model="type" class="input" @change="status = ''; applyFilters()">
          <option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <select v-model="status" class="input" @change="applyFilters">
          <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <button class="btn btn-secondary justify-self-start" @click="clearFilters">重置</button>
      </div>
    </section>

    <div v-if="error" class="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
      <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{{ error }}</span>
    </div>

    <section data-reveal class="overflow-hidden rounded-xl border border-themed bg-themed-surface shadow-sm">
      <div v-if="loading" class="p-10 text-center text-sm text-themed-muted">正在加载订单...</div>
      <div v-else-if="orders.length === 0" class="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl border border-themed bg-themed-secondary text-themed-muted">
          <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 4h11l3 3v13H5z" />
            <path d="M9 12h6M9 16h6M9 8h3" />
          </svg>
        </div>
        <div class="text-sm text-themed-muted">暂无订单记录</div>
      </div>
      <div v-else class="space-y-3 p-4 lg:hidden">
        <div
          v-for="order in orders"
          :key="order.id"
          class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-themed" :title="order.title">{{ order.title }}</div>
              <div class="mt-1 truncate font-mono text-xs text-themed-muted" :title="order.orderNo">{{ order.orderNo }}</div>
            </div>
            <span :class="['inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium', statusClass(order.status)]">
              {{ statusLabel(order) }}
            </span>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">类型</div>
              <div class="mt-1 truncate text-themed">{{ sourceLabel(order.sourceType) }}</div>
            </div>
            <div class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">金额</div>
              <div class="mt-1 font-mono font-semibold tabular-nums text-themed">{{ formatMoney(order.amount) }}</div>
            </div>
            <div class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">关联实例</div>
              <div class="mt-1 truncate text-themed" :title="instanceName(order)">{{ instanceName(order) }}</div>
            </div>
            <div class="rounded-lg bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">时间</div>
              <div class="mt-1 text-xs text-themed">{{ formatTime(order.createdAt) }}</div>
            </div>
          </div>

          <div class="mt-4 flex justify-end">
            <button class="btn btn-sm btn-secondary" @click="openDetail(order)">详情</button>
          </div>
        </div>
      </div>
      <div v-if="orders.length > 0" class="hidden overflow-hidden lg:block">
        <table class="w-full table-fixed divide-y divide-themed">
          <thead class="bg-themed-tertiary">
            <tr class="text-left text-xs font-semibold uppercase tracking-wide text-themed-muted">
              <th class="w-[25%] px-4 py-3">订单</th>
              <th class="w-[12%] px-4 py-3">类型</th>
              <th class="w-[11%] px-4 py-3">金额</th>
              <th class="w-[11%] px-4 py-3">状态</th>
              <th class="w-[17%] px-4 py-3">关联实例</th>
              <th class="w-[16%] px-4 py-3">时间</th>
              <th class="w-[8%] px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr v-for="order in orders" :key="order.id" class="text-sm transition-colors hover:bg-themed-hover">
              <td class="px-4 py-3">
                <div class="truncate font-medium text-themed" :title="order.title">{{ order.title }}</div>
                <div class="truncate font-mono text-xs text-themed-muted" :title="order.orderNo">{{ order.orderNo }}</div>
              </td>
              <td class="px-4 py-3 text-themed-muted">
                <div class="truncate">{{ sourceLabel(order.sourceType) }}</div>
              </td>
              <td class="px-4 py-3 font-mono font-medium tabular-nums text-themed whitespace-nowrap">{{ formatMoney(order.amount) }}</td>
              <td class="px-4 py-3">
                <span :class="['inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs font-medium', statusClass(order.status)]">{{ statusLabel(order) }}</span>
              </td>
              <td class="px-4 py-3 text-themed-muted">
                <div class="truncate" :title="instanceName(order)">{{ instanceName(order) }}</div>
              </td>
              <td class="px-4 py-3 text-themed-muted whitespace-nowrap">{{ formatTime(order.createdAt) }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="btn btn-sm btn-secondary" @click="openDetail(order)">详情</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-col items-stretch justify-between gap-3 border-t border-themed px-4 py-3 text-sm text-themed-muted sm:flex-row sm:items-center">
        <span>共 <span class="font-mono tabular-nums text-themed">{{ total }}</span> 条记录</span>
        <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
          <button class="btn btn-sm btn-secondary justify-center" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <span class="min-w-[72px] text-center font-mono tabular-nums">{{ page }} / {{ totalPages }}</span>
          <button class="btn btn-sm btn-secondary justify-center" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
        </div>
      </div>
    </section>

    <div v-if="selectedOrder" class="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" @click.self="selectedOrder = null">
      <aside class="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-themed bg-themed-surface shadow-2xl">
        <div class="flex items-start justify-between gap-4 border-b border-themed bg-themed p-6">
          <div class="min-w-0">
            <h2 class="truncate text-xl font-semibold text-themed">{{ selectedOrder.title }}</h2>
            <p class="mt-1 truncate font-mono text-sm text-themed-muted">{{ selectedOrder.orderNo }}</p>
          </div>
          <button class="btn btn-sm btn-secondary gap-1.5" @click="selectedOrder = null">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            关闭
          </button>
        </div>

        <div v-if="detailLoading" class="p-6 text-sm text-themed-muted">正在加载详情...</div>
        <dl v-else class="grid gap-px bg-themed-secondary p-px text-sm">
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">状态</dt><dd class="col-span-2 text-themed"><span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', statusClass(selectedOrder.status)]">{{ statusLabel(selectedOrder) }}</span></dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">金额</dt><dd class="col-span-2 font-mono tabular-nums text-themed">{{ formatMoney(selectedOrder.amount) }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">实际到账</dt><dd class="col-span-2 font-mono tabular-nums text-themed">{{ selectedOrder.actualAmount === null ? '-' : formatMoney(selectedOrder.actualAmount) }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">手续费</dt><dd class="col-span-2 font-mono tabular-nums text-themed">{{ formatMoney(selectedOrder.fee) }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">支付渠道</dt><dd class="col-span-2 text-themed">{{ selectedOrder.provider?.name || selectedOrder.paymentMethod || '-' }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">交易号</dt><dd class="col-span-2 break-all font-mono text-themed">{{ selectedOrder.tradeNo || '-' }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">关联实例</dt><dd class="col-span-2 text-themed">{{ instanceName(selectedOrder) }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">账期</dt><dd class="col-span-2 text-themed">{{ selectedOrder.months ? `${selectedOrder.months} 个月` : '-' }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">开始时间</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.periodStart) }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">结束时间</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.periodEnd) }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">创建时间</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.createdAt) }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">完成时间</dt><dd class="col-span-2 text-themed">{{ formatTime(selectedOrder.completedAt) }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">失败原因</dt><dd class="col-span-2 text-themed">{{ selectedOrder.failReason || '-' }}</dd></div>
          <div class="grid grid-cols-3 gap-3 bg-themed-surface px-6 py-3"><dt class="text-themed-muted">备注</dt><dd class="col-span-2 text-themed">{{ selectedOrder.remark || '-' }}</dd></div>
        </dl>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.nimbus-lift {
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.nimbus-lift:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -8px rgba(15, 23, 42, 0.28);
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-lift,
  .nimbus-lift:hover {
    transform: none;
    transition: none;
  }
}
</style>
