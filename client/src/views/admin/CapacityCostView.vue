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
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">容量与成本</h1>
        <p class="page-description">查看可售库存、Host 压力、套餐毛利和低余量风险。</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadOverview">
        刷新
      </button>
    </div>

    <SkeletonLoader v-if="loading && !overview" type="card" :count="4" />

    <template v-else-if="overview">
      <section class="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div v-for="card in summaryCards" :key="card.label" class="rounded-lg border border-themed bg-themed-surface p-5">
          <div class="text-sm text-themed-muted">{{ card.label }}</div>
          <div class="mt-2 text-2xl font-semibold text-themed">{{ card.value }}</div>
          <div class="mt-2 text-xs text-themed-muted">{{ card.caption }}</div>
        </div>
      </section>

      <section class="mt-6 rounded-lg border border-themed bg-themed-surface">
        <div class="flex items-center justify-between border-b border-themed px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">容量预警</h2>
            <p class="mt-1 text-sm text-themed-muted">只做运营提示，不自动停售或修改套餐。</p>
          </div>
          <span class="rounded-full bg-themed-muted px-3 py-1 text-xs text-themed-muted">
            {{ criticalAlerts.length }} 严重 / {{ warningAlerts.length }} 预警
          </span>
        </div>
        <div class="divide-y divide-themed">
          <div v-if="overview.alerts.length === 0" class="px-5 py-8 text-center text-sm text-themed-muted">
            暂无容量或毛利风险
          </div>
          <div v-for="alert in overview.alerts" :key="alert.key" class="flex items-start justify-between gap-4 px-5 py-4">
            <div>
              <div class="font-medium text-themed">{{ alert.title }}</div>
              <div class="mt-1 text-sm text-themed-muted">{{ alert.message }}</div>
            </div>
            <span
              class="rounded-full px-3 py-1 text-xs font-medium"
              :class="alert.severity === 'critical' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'"
            >
              {{ alert.severity === 'critical' ? '严重' : '预警' }}
            </span>
          </div>
        </div>
      </section>

      <section class="mt-6 rounded-lg border border-themed bg-themed-surface">
        <div class="border-b border-themed px-5 py-4">
          <h2 class="text-lg font-semibold text-themed">Host 库存与成本</h2>
          <p class="mt-1 text-sm text-themed-muted">成本仅用于后台毛利估算，不参与实例创建、扣费或自动停售。</p>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-themed text-sm">
            <thead class="bg-themed-muted/40 text-left text-xs uppercase text-themed-muted">
              <tr>
                <th class="px-5 py-3">Host</th>
                <th class="px-5 py-3">资源水位</th>
                <th class="px-5 py-3">实例 / 流量</th>
                <th class="px-5 py-3">月成本</th>
                <th class="px-5 py-3">IPv4 / TB 成本</th>
                <th class="px-5 py-3">备注</th>
                <th class="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed">
              <tr v-for="host in overview.hosts" :key="host.id" class="align-top">
                <td class="px-5 py-4">
                  <div class="font-medium text-themed">{{ host.name }}</div>
                  <div class="mt-1 text-xs text-themed-muted">{{ host.location || '-' }} · {{ host.status }} · {{ host.instanceType }}</div>
                </td>
                <td class="px-5 py-4">
                  <div class="space-y-2 min-w-[220px]">
                    <div
                      v-for="item in [
                        { label: 'CPU', ratio: host.capacity.cpuUsageRatio, text: `${formatNumber(host.capacity.cpuUsed)} / ${formatNumber(host.capacity.cpuTotal)}%` },
                        { label: '内存', ratio: host.capacity.memoryUsageRatio, text: `${formatMb(host.capacity.memoryUsed)} / ${formatMb(host.capacity.memoryTotal)}` },
                        { label: '磁盘', ratio: host.capacity.diskUsageRatio, text: `${formatMb(host.capacity.diskUsed)} / ${formatMb(host.capacity.diskTotal)}` },
                        { label: '端口', ratio: host.capacity.natPortUsageRatio, text: `${formatNumber(host.capacity.natPortUsed)} / ${formatNumber(host.capacity.natPortTotal)}` }
                      ]"
                      :key="item.label"
                    >
                      <div class="flex justify-between text-xs text-themed-muted">
                        <span>{{ item.label }}</span>
                        <span>{{ item.text }} · {{ formatPercent(item.ratio) }}</span>
                      </div>
                      <div class="h-1.5 rounded bg-themed-muted">
                        <div
                          class="h-1.5 rounded"
                          :class="usageBarClass(item.ratio)"
                          :style="{ width: `${Math.min(item.ratio * 100, 100)}%` }"
                        />
                      </div>
                    </div>
                  </div>
                </td>
                <td class="px-5 py-4 text-themed">
                  <div>{{ formatNumber(host.capacity.instanceCount) }} 个实例</div>
                  <div class="mt-1 text-xs text-themed-muted">{{ formatTraffic(host.capacity.trafficUsedBytes) }}</div>
                </td>
                <td class="px-5 py-4">
                  <input v-model.number="costForms[host.id].monthlyCost" type="number" min="0" step="0.01" class="input w-28" />
                </td>
                <td class="px-5 py-4">
                  <div class="flex gap-2">
                    <input v-model.number="costForms[host.id].ipv4MonthlyCost" type="number" min="0" step="0.01" class="input w-24" />
                    <input v-model.number="costForms[host.id].trafficTbCost" type="number" min="0" step="0.01" class="input w-24" />
                  </div>
                  <div class="mt-1 text-xs text-themed-muted">IPv4 / 每 TB</div>
                </td>
                <td class="px-5 py-4">
                  <input v-model="costForms[host.id].notes" maxlength="500" class="input w-48" placeholder="供应商、账期或成本口径" />
                </td>
                <td class="px-5 py-4 text-right">
                  <button class="btn-primary" :disabled="savingHostId === host.id" @click="saveCostProfile(host)">
                    {{ savingHostId === host.id ? '保存中' : '保存' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mt-6 rounded-lg border border-themed bg-themed-surface">
        <div class="border-b border-themed px-5 py-4">
          <h2 class="text-lg font-semibold text-themed">套餐毛利估算</h2>
          <p class="mt-1 text-sm text-themed-muted">按绑定 Host 的平均成本估算，价格不会因此自动变化。</p>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-themed text-sm">
            <thead class="bg-themed-muted/40 text-left text-xs uppercase text-themed-muted">
              <tr>
                <th class="px-5 py-3">套餐 / 方案</th>
                <th class="px-5 py-3">月收入</th>
                <th class="px-5 py-3">预计成本</th>
                <th class="px-5 py-3">预计毛利</th>
                <th class="px-5 py-3">毛利率</th>
                <th class="px-5 py-3">已售 / 可售</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed">
              <tr v-if="marginPlans.length === 0">
                <td colspan="6" class="px-5 py-8 text-center text-themed-muted">暂无已绑定 Host 的启用方案</td>
              </tr>
              <tr v-for="plan in marginPlans" :key="plan.planId">
                <td class="px-5 py-4">
                  <div class="font-medium text-themed">{{ plan.packageName }}</div>
                  <div class="mt-1 text-xs text-themed-muted">{{ plan.planName }}</div>
                </td>
                <td class="px-5 py-4 text-themed">{{ formatMoney(plan.revenueMonthly) }}</td>
                <td class="px-5 py-4 text-themed">{{ formatMoney(plan.estimatedCostMonthly) }}</td>
                <td class="px-5 py-4" :class="plan.estimatedMarginMonthly < 0 ? 'text-rose-600' : 'text-emerald-600'">
                  {{ formatMoney(plan.estimatedMarginMonthly) }}
                </td>
                <td class="px-5 py-4 text-themed">{{ formatPercent(plan.marginRatio) }}</td>
                <td class="px-5 py-4 text-themed">{{ formatNumber(plan.soldCount) }} / {{ formatNumber(plan.availableSlots) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
