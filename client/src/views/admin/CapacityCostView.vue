<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import api from '@/api/admin'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'

type CapacityCostOverview = Awaited<ReturnType<typeof api.admin.getCapacityCostOverview>>
type HostRow = CapacityCostOverview['hosts'][number]

const toast = useToast()
const loading = ref(true)
const savingHostId = ref<number | null>(null)
const overview = ref<CapacityCostOverview | null>(null)
const costForms = reactive<Record<number, {
  monthlyCost: number
  ipv4MonthlyCost: number
  trafficTbCost: number
  notes: string
}>>({})

const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 2
})
const numberFormatter = new Intl.NumberFormat('zh-CN')

const summaryCards = computed(() => {
  const totals = overview.value?.totals
  return [
    {
      label: 'CPU 可售余量',
      value: `${formatNumber(totals?.cpuAvailable || 0)}%`,
      caption: `已用 ${formatNumber(totals?.cpuUsed || 0)}% / 总量 ${formatNumber(totals?.cpuTotal || 0)}%`
    },
    {
      label: '内存可售余量',
      value: formatMb(totals?.memoryAvailable || 0),
      caption: `已用 ${formatMb(totals?.memoryUsed || 0)} / 总量 ${formatMb(totals?.memoryTotal || 0)}`
    },
    {
      label: '磁盘可售余量',
      value: formatMb(totals?.diskAvailable || 0),
      caption: `已用 ${formatMb(totals?.diskUsed || 0)} / 总量 ${formatMb(totals?.diskTotal || 0)}`
    },
    {
      label: '月度成本',
      value: formatMoney(totals?.monthlyCost || 0),
      caption: `${formatNumber(totals?.instanceCount || 0)} 个非删除实例`
    }
  ]
})

const criticalAlerts = computed(() => (overview.value?.alerts || []).filter(alert => alert.severity === 'critical'))
const warningAlerts = computed(() => (overview.value?.alerts || []).filter(alert => alert.severity === 'warning'))
const marginPlans = computed(() => (overview.value?.plans || []).slice(0, 12))

function formatMoney(value: number): string {
  return moneyFormatter.format(value || 0)
}

function formatNumber(value: number): string {
  return numberFormatter.format(value || 0)
}

function formatPercent(value: number): string {
  return `${Math.round((value || 0) * 1000) / 10}%`
}

function formatMb(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} TB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`
  return `${formatNumber(value)} MB`
}

function formatTraffic(bytes: string): string {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(2)} TB`
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`
  return `${(value / 1024 ** 2).toFixed(2)} MB`
}

function resetCostForms(data: CapacityCostOverview): void {
  for (const host of data.hosts) {
    costForms[host.id] = {
      monthlyCost: host.costProfile.monthlyCost,
      ipv4MonthlyCost: host.costProfile.ipv4MonthlyCost,
      trafficTbCost: host.costProfile.trafficTbCost,
      notes: host.costProfile.notes || ''
    }
  }
}

async function loadOverview(): Promise<void> {
  loading.value = true
  try {
    const data = await api.admin.getCapacityCostOverview()
    overview.value = data
    resetCostForms(data)
  } catch (error: any) {
    toast.error(`加载容量与成本失败：${error?.message || '未知错误'}`)
  } finally {
    loading.value = false
  }
}

async function saveCostProfile(host: HostRow): Promise<void> {
  const form = costForms[host.id]
  if (!form) return
  savingHostId.value = host.id
  try {
    await api.admin.updateHostCostProfile(host.id, {
      monthlyCost: form.monthlyCost,
      ipv4MonthlyCost: form.ipv4MonthlyCost,
      trafficTbCost: form.trafficTbCost,
      notes: form.notes || null
    })
    toast.success('成本配置已保存')
    await loadOverview()
  } catch (error: any) {
    toast.error(`保存成本配置失败：${error?.message || '未知错误'}`)
  } finally {
    savingHostId.value = null
  }
}

function usageBarClass(ratio: number): string {
  if (ratio >= 0.9) return 'bg-rose-500'
  if (ratio >= 0.75) return 'bg-amber-500'
  return 'bg-emerald-500'
}

onMounted(loadOverview)
</script>

<template>
  <div class="kawaii-page nimbus-view page-container animate-fade-in">
    <header class="flex flex-col gap-4 border-b border-themed pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-start gap-3">
        <span class="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500 sm:flex">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        </span>
        <div>
          <h1 class="text-xl font-semibold text-themed sm:text-2xl">容量与成本</h1>
          <p class="mt-1 text-sm text-themed-muted">查看可售库存、Host 压力、套餐毛利和低余量风险。</p>
        </div>
      </div>
      <button class="btn-secondary shrink-0" :disabled="loading" @click="loadOverview">
        <svg class="h-4 w-4" :class="loading ? 'animate-spin' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        刷新
      </button>
    </header>

    <SkeletonLoader v-if="loading && !overview" type="card" :count="4" />

    <template v-else-if="overview">
      <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div v-for="card in summaryCards" :key="card.label" class="nimbus-stat rounded-xl border border-themed bg-themed-surface p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs font-medium uppercase tracking-wide text-themed-muted">{{ card.label }}</span>
            <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 3v16h16M9 15l3-3 2 2 4-4" /></svg>
            </span>
          </div>
          <div class="mt-3 font-mono text-2xl font-semibold tabular-nums text-themed">{{ card.value }}</div>
          <div class="mt-2 text-xs text-themed-muted">{{ card.caption }}</div>
        </div>
      </section>

      <section class="mt-6 overflow-hidden rounded-xl border border-themed bg-themed-surface">
        <div class="flex items-center justify-between gap-3 border-b border-themed px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-themed">容量预警</h2>
            <p class="mt-1 text-sm text-themed-muted">只做运营提示，不自动停售或修改套餐。</p>
          </div>
          <span class="shrink-0 rounded-full border border-themed bg-themed-secondary px-3 py-1 font-mono text-2xs tabular-nums text-themed-muted">
            {{ criticalAlerts.length }} 严重 / {{ warningAlerts.length }} 预警
          </span>
        </div>
        <div class="divide-y divide-themed">
          <div v-if="overview.alerts.length === 0" class="px-5 py-12 text-center text-sm text-themed-muted">
            <span class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </span>
            暂无容量或毛利风险
          </div>
          <div v-for="alert in overview.alerts" :key="alert.key" class="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-themed-hover">
            <div class="flex items-start gap-3">
              <span
                class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                :class="alert.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'"
              ></span>
              <div>
                <div class="font-medium text-themed">{{ alert.title }}</div>
                <div class="mt-1 text-sm text-themed-muted">{{ alert.message }}</div>
              </div>
            </div>
            <span
              class="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
              :class="alert.severity === 'critical' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'"
            >
              {{ alert.severity === 'critical' ? '严重' : '预警' }}
            </span>
          </div>
        </div>
      </section>

      <section class="mt-6 overflow-hidden rounded-xl border border-themed bg-themed-surface">
        <div class="border-b border-themed px-5 py-4">
          <h2 class="text-base font-semibold text-themed">Host 库存与成本</h2>
          <p class="mt-1 text-sm text-themed-muted">成本仅用于后台毛利估算，不参与实例创建、扣费或自动停售。</p>
        </div>
        <div class="space-y-3 p-4 lg:hidden">
          <div
            v-for="host in overview.hosts"
            :key="host.id"
            class="rounded-xl border border-themed bg-themed-surface p-4"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate font-medium text-themed">{{ host.name }}</div>
                <div class="mt-1 text-xs text-themed-muted">{{ host.location || '-' }} · {{ host.status }} · {{ host.instanceType }}</div>
              </div>
              <div class="shrink-0 text-right text-xs text-themed-muted">
                <div class="font-mono tabular-nums">{{ formatNumber(host.capacity.instanceCount) }} 个实例</div>
                <div class="mt-1 font-mono tabular-nums">{{ formatTraffic(host.capacity.trafficUsedBytes) }}</div>
              </div>
            </div>
            <div class="mt-4 space-y-2">
              <div
                v-for="item in [
                  { label: 'CPU', ratio: host.capacity.cpuUsageRatio, text: `${formatNumber(host.capacity.cpuUsed)} / ${formatNumber(host.capacity.cpuTotal)}%` },
                  { label: '内存', ratio: host.capacity.memoryUsageRatio, text: `${formatMb(host.capacity.memoryUsed)} / ${formatMb(host.capacity.memoryTotal)}` },
                  { label: '磁盘', ratio: host.capacity.diskUsageRatio, text: `${formatMb(host.capacity.diskUsed)} / ${formatMb(host.capacity.diskTotal)}` },
                  { label: '端口', ratio: host.capacity.natPortUsageRatio, text: `${formatNumber(host.capacity.natPortUsed)} / ${formatNumber(host.capacity.natPortTotal)}` }
                ]"
                :key="item.label"
              >
                <div class="flex justify-between gap-3 text-xs text-themed-muted">
                  <span>{{ item.label }}</span>
                  <span class="text-right font-mono tabular-nums">{{ item.text }} · {{ formatPercent(item.ratio) }}</span>
                </div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-themed-secondary">
                  <div
                    class="h-1.5 rounded-full transition-all duration-500"
                    :class="usageBarClass(item.ratio)"
                    :style="{ width: `${Math.min(item.ratio * 100, 100)}%` }"
                  />
                </div>
              </div>
            </div>
            <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="text-2xs uppercase tracking-wide text-themed-muted">
                月成本
                <input v-model.number="costForms[host.id].monthlyCost" type="number" min="0" step="0.01" class="input mt-1 w-full font-mono tabular-nums" />
              </label>
              <label class="text-2xs uppercase tracking-wide text-themed-muted">
                IPv4 成本
                <input v-model.number="costForms[host.id].ipv4MonthlyCost" type="number" min="0" step="0.01" class="input mt-1 w-full font-mono tabular-nums" />
              </label>
              <label class="text-2xs uppercase tracking-wide text-themed-muted">
                每 TB 成本
                <input v-model.number="costForms[host.id].trafficTbCost" type="number" min="0" step="0.01" class="input mt-1 w-full font-mono tabular-nums" />
              </label>
              <label class="text-2xs uppercase tracking-wide text-themed-muted sm:col-span-2">
                备注
                <input v-model="costForms[host.id].notes" maxlength="500" class="input mt-1 w-full" placeholder="供应商、账期或成本口径" />
              </label>
            </div>
            <div class="mt-4 flex justify-end">
              <button class="btn-primary btn-sm" :disabled="savingHostId === host.id" @click="saveCostProfile(host)">
                {{ savingHostId === host.id ? '保存中' : '保存' }}
              </button>
            </div>
          </div>
        </div>
        <div class="hidden overflow-hidden lg:block">
          <table class="w-full table-fixed text-sm">
            <thead>
              <tr class="border-b border-themed text-left text-2xs font-medium uppercase tracking-wide text-themed-muted">
                <th class="w-[16%] px-5 py-3">Host</th>
                <th class="w-[24%] px-5 py-3">资源水位</th>
                <th class="w-[12%] px-5 py-3">实例 / 流量</th>
                <th class="w-[10%] px-5 py-3">月成本</th>
                <th class="w-[16%] px-5 py-3">IPv4 / TB 成本</th>
                <th class="w-[14%] px-5 py-3">备注</th>
                <th class="w-[8%] px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="host in overview.hosts" :key="host.id" class="border-b border-themed align-top transition-colors last:border-0 hover:bg-themed-hover">
                <td class="px-5 py-4">
                  <div class="truncate font-medium text-themed">{{ host.name }}</div>
                  <div class="mt-1 truncate text-xs text-themed-muted">{{ host.location || '-' }} · {{ host.status }} · {{ host.instanceType }}</div>
                </td>
                <td class="px-5 py-4">
                  <div class="space-y-2">
                    <div
                      v-for="item in [
                        { label: 'CPU', ratio: host.capacity.cpuUsageRatio, text: `${formatNumber(host.capacity.cpuUsed)} / ${formatNumber(host.capacity.cpuTotal)}%` },
                        { label: '内存', ratio: host.capacity.memoryUsageRatio, text: `${formatMb(host.capacity.memoryUsed)} / ${formatMb(host.capacity.memoryTotal)}` },
                        { label: '磁盘', ratio: host.capacity.diskUsageRatio, text: `${formatMb(host.capacity.diskUsed)} / ${formatMb(host.capacity.diskTotal)}` },
                        { label: '端口', ratio: host.capacity.natPortUsageRatio, text: `${formatNumber(host.capacity.natPortUsed)} / ${formatNumber(host.capacity.natPortTotal)}` }
                      ]"
                      :key="item.label"
                    >
                      <div class="flex justify-between gap-3 text-xs text-themed-muted">
                        <span>{{ item.label }}</span>
                        <span class="truncate text-right font-mono tabular-nums">{{ item.text }} · {{ formatPercent(item.ratio) }}</span>
                      </div>
                      <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-themed-secondary">
                        <div
                          class="h-1.5 rounded-full transition-all duration-500"
                          :class="usageBarClass(item.ratio)"
                          :style="{ width: `${Math.min(item.ratio * 100, 100)}%` }"
                        />
                      </div>
                    </div>
                  </div>
                </td>
                <td class="px-5 py-4 text-themed">
                  <div class="font-mono tabular-nums">{{ formatNumber(host.capacity.instanceCount) }} 个实例</div>
                  <div class="mt-1 truncate font-mono text-xs tabular-nums text-themed-muted">{{ formatTraffic(host.capacity.trafficUsedBytes) }}</div>
                </td>
                <td class="px-5 py-4">
                  <input v-model.number="costForms[host.id].monthlyCost" type="number" min="0" step="0.01" class="input w-full font-mono tabular-nums" />
                </td>
                <td class="px-5 py-4">
                  <div class="grid grid-cols-2 gap-2">
                    <input v-model.number="costForms[host.id].ipv4MonthlyCost" type="number" min="0" step="0.01" class="input w-full font-mono tabular-nums" />
                    <input v-model.number="costForms[host.id].trafficTbCost" type="number" min="0" step="0.01" class="input w-full font-mono tabular-nums" />
                  </div>
                  <div class="mt-1 text-2xs uppercase tracking-wide text-themed-muted">IPv4 / 每 TB</div>
                </td>
                <td class="px-5 py-4">
                  <input v-model="costForms[host.id].notes" maxlength="500" class="input w-full" placeholder="供应商、账期或成本口径" />
                </td>
                <td class="px-5 py-4 text-right">
                  <button class="btn-primary btn-sm" :disabled="savingHostId === host.id" @click="saveCostProfile(host)">
                    {{ savingHostId === host.id ? '保存中' : '保存' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mt-6 overflow-hidden rounded-xl border border-themed bg-themed-surface">
        <div class="border-b border-themed px-5 py-4">
          <h2 class="text-base font-semibold text-themed">套餐毛利估算</h2>
          <p class="mt-1 text-sm text-themed-muted">按绑定 Host 的平均成本估算，价格不会因此自动变化。</p>
        </div>
        <div v-if="marginPlans.length === 0" class="px-5 py-12 text-center text-sm text-themed-muted">
          <span class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 3v16.5A1.5 1.5 0 004.5 21H21M7.5 15l3-3 3 3 4.5-4.5" />
            </svg>
          </span>
          暂无已绑定 Host 的启用方案
        </div>
        <template v-else>
          <div class="space-y-3 p-4 lg:hidden">
            <div
              v-for="plan in marginPlans"
              :key="plan.planId"
              class="rounded-xl border border-themed bg-themed-surface p-4"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate font-medium text-themed">{{ plan.packageName }}</div>
                  <div class="mt-1 truncate text-xs text-themed-muted">{{ plan.planName }}</div>
                </div>
                <div class="shrink-0 text-right font-mono text-sm font-semibold tabular-nums" :class="plan.estimatedMarginMonthly < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'">
                  {{ formatMoney(plan.estimatedMarginMonthly) }}
                </div>
              </div>
              <div class="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div class="text-2xs uppercase tracking-wide text-themed-muted">月收入</div>
                  <div class="mt-1 font-mono font-medium tabular-nums text-themed">{{ formatMoney(plan.revenueMonthly) }}</div>
                </div>
                <div>
                  <div class="text-2xs uppercase tracking-wide text-themed-muted">预计成本</div>
                  <div class="mt-1 font-mono font-medium tabular-nums text-themed">{{ formatMoney(plan.estimatedCostMonthly) }}</div>
                </div>
                <div>
                  <div class="text-2xs uppercase tracking-wide text-themed-muted">毛利率</div>
                  <div class="mt-1 font-mono font-medium tabular-nums text-themed">{{ formatPercent(plan.marginRatio) }}</div>
                </div>
                <div>
                  <div class="text-2xs uppercase tracking-wide text-themed-muted">已售 / 可售</div>
                  <div class="mt-1 font-mono font-medium tabular-nums text-themed">{{ formatNumber(plan.soldCount) }} / {{ formatNumber(plan.availableSlots) }}</div>
                </div>
              </div>
            </div>
          </div>
          <div class="hidden overflow-hidden lg:block">
            <table class="w-full table-fixed text-sm">
              <thead>
                <tr class="border-b border-themed text-left text-2xs font-medium uppercase tracking-wide text-themed-muted">
                  <th class="w-[30%] px-5 py-3">套餐 / 方案</th>
                  <th class="w-[14%] px-5 py-3">月收入</th>
                  <th class="w-[14%] px-5 py-3">预计成本</th>
                  <th class="w-[14%] px-5 py-3">预计毛利</th>
                  <th class="w-[12%] px-5 py-3">毛利率</th>
                  <th class="w-[16%] px-5 py-3">已售 / 可售</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="plan in marginPlans" :key="plan.planId" class="border-b border-themed transition-colors last:border-0 hover:bg-themed-hover">
                  <td class="px-5 py-4">
                    <div class="truncate font-medium text-themed">{{ plan.packageName }}</div>
                    <div class="mt-1 truncate text-xs text-themed-muted">{{ plan.planName }}</div>
                  </td>
                  <td class="px-5 py-4 font-mono tabular-nums text-themed">{{ formatMoney(plan.revenueMonthly) }}</td>
                  <td class="px-5 py-4 font-mono tabular-nums text-themed">{{ formatMoney(plan.estimatedCostMonthly) }}</td>
                  <td class="px-5 py-4 font-mono font-semibold tabular-nums" :class="plan.estimatedMarginMonthly < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'">
                    {{ formatMoney(plan.estimatedMarginMonthly) }}
                  </td>
                  <td class="px-5 py-4 font-mono tabular-nums text-themed">{{ formatPercent(plan.marginRatio) }}</td>
                  <td class="px-5 py-4 font-mono tabular-nums text-themed">{{ formatNumber(plan.soldCount) }} / {{ formatNumber(plan.availableSlots) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.nimbus-stat {
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-view *,
  .nimbus-view *::before,
  .nimbus-view *::after {
    transition-duration: 0.001ms !important;
    animation-duration: 0.001ms !important;
  }
}
</style>
