<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import PluginFrameSlot from '@/components/plugins/PluginFrameSlot.vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import { useToast } from '@/stores/toast'

type StatisticsOverview = Awaited<ReturnType<typeof api.admin.getStatisticsOverview>>
type TabKey = 'users' | 'instances' | 'billing'
type PeriodKey = 'daily' | 'monthly'
type BillingMetricKey = 'recharge' | 'consume' | 'aff' | 'destroyFee'
type ChartValueType = 'number' | 'money'
type Tone = 'blue' | 'emerald' | 'amber' | 'rose'

interface StatPoint {
  label: string
  value: number
}

interface SummaryCard {
  label: string
  value: number
  type: ChartValueType
  caption: string
  tone: Tone
}

interface OperationCard extends SummaryCard {
  detail?: string
}

const toast = useToast()
const { t, locale } = useI18n()
const loading = ref(true)
const stats = ref<StatisticsOverview | null>(null)
const activeTab = ref<TabKey>('users')
const userPeriod = ref<PeriodKey>('daily')
const instancePeriod = ref<PeriodKey>('daily')
const billingPeriod = ref<PeriodKey>('daily')
const billingMetric = ref<BillingMetricKey>('recharge')

const tabItems: Array<{ value: TabKey; labelKey: string }> = [
  { value: 'users', labelKey: 'admin.statistics.tabs.users' },
  { value: 'instances', labelKey: 'admin.statistics.tabs.instances' },
  { value: 'billing', labelKey: 'admin.statistics.tabs.billing' }
]

const periodItems: Array<{ value: PeriodKey; labelKey: string }> = [
  { value: 'daily', labelKey: 'admin.statistics.periods.daily' },
  { value: 'monthly', labelKey: 'admin.statistics.periods.monthly' }
]

const billingMetricItems: Array<{ value: BillingMetricKey; labelKey: string; tone: Tone }> = [
  { value: 'recharge', labelKey: 'admin.statistics.billingMetrics.recharge', tone: 'blue' },
  { value: 'consume', labelKey: 'admin.statistics.billingMetrics.consume', tone: 'emerald' },
  { value: 'aff', labelKey: 'admin.statistics.billingMetrics.aff', tone: 'amber' },
  { value: 'destroyFee', labelKey: 'admin.statistics.billingMetrics.destroyFee', tone: 'rose' }
]

const moneyFormatter = computed(() =>
  new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2
  })
)
const compactMoneyFormatter = computed(() =>
  new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: 'CNY',
    notation: 'compact',
    maximumFractionDigits: 1
  })
)
const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))
const compactNumberFormatter = computed(() =>
  new Intl.NumberFormat(locale.value, {
    notation: 'compact',
    maximumFractionDigits: 1
  })
)

const userSeries = computed<StatPoint[]>(() => {
  if (!stats.value) return []
  return userPeriod.value === 'daily'
    ? stats.value.users.dailyNewUsers
    : stats.value.users.monthlyNewUsers
})

const instanceSeries = computed<StatPoint[]>(() => {
  if (!stats.value) return []
  return instancePeriod.value === 'daily'
    ? stats.value.instances.dailyCreatedInstances
    : stats.value.instances.monthlyCreatedInstances
})

const currentBillingMetric = computed(() =>
  billingMetricItems.find(item => item.value === billingMetric.value) || billingMetricItems[0]
)

const billingSeries = computed<StatPoint[]>(() => {
  if (!stats.value) return []

  if (billingMetric.value === 'consume') {
    return billingPeriod.value === 'daily'
      ? stats.value.billing.dailyConsume
      : stats.value.billing.monthlyConsume
  }

  if (billingMetric.value === 'aff') {
    return billingPeriod.value === 'daily'
      ? stats.value.billing.dailyAff
      : stats.value.billing.monthlyAff
  }

  if (billingMetric.value === 'destroyFee') {
    return billingPeriod.value === 'daily'
      ? stats.value.billing.dailyDestroyFee
      : stats.value.billing.monthlyDestroyFee
  }

  return billingPeriod.value === 'daily'
    ? stats.value.billing.dailyRecharge
    : stats.value.billing.monthlyRecharge
})

const userCards = computed<SummaryCard[]>(() => [
  {
    label: t('admin.statistics.cards.totalUsers'),
    value: stats.value?.users.total || 0,
    type: 'number',
    caption: t('admin.statistics.captions.currentTotal'),
    tone: 'blue'
  },
  {
    label: userPeriod.value === 'daily'
      ? t('admin.statistics.cards.recentDailyNewUsers')
      : t('admin.statistics.cards.recentMonthlyNewUsers'),
    value: sumSeries(userSeries.value),
    type: 'number',
    caption: userPeriod.value === 'daily'
      ? t('admin.statistics.captions.dailyAggregate')
      : t('admin.statistics.captions.monthlyAggregate'),
    tone: 'emerald'
  },
  {
    label: t('admin.statistics.cards.averageNewUsers'),
    value: averageSeries(userSeries.value),
    type: 'number',
    caption: userPeriod.value === 'daily'
      ? t('admin.statistics.captions.dailyAverage')
      : t('admin.statistics.captions.monthlyAverage'),
    tone: 'amber'
  }
])

const instanceCards = computed<SummaryCard[]>(() => [
  {
    label: t('admin.statistics.cards.totalInstances'),
    value: stats.value?.instances.total || 0,
    type: 'number',
    caption: t('admin.statistics.captions.nonDeletedInstances'),
    tone: 'blue'
  },
  {
    label: t('admin.statistics.cards.availableInstances'),
    value: stats.value?.instances.active || 0,
    type: 'number',
    caption: t('admin.statistics.captions.notDeletedOrSuspended'),
    tone: 'emerald'
  },
  {
    label: instancePeriod.value === 'daily'
      ? t('admin.statistics.cards.recentDailyCreatedInstances')
      : t('admin.statistics.cards.recentMonthlyCreatedInstances'),
    value: sumSeries(instanceSeries.value),
    type: 'number',
    caption: instancePeriod.value === 'daily'
      ? t('admin.statistics.captions.dailyAggregate')
      : t('admin.statistics.captions.monthlyAggregate'),
    tone: 'amber'
  }
])

const billingCards = computed<SummaryCard[]>(() => [
  {
    label: t('admin.statistics.cards.totalRecharge'),
    value: stats.value?.billing.totals.recharge || 0,
    type: 'money',
    caption: t('admin.statistics.captions.completedOrders'),
    tone: 'blue'
  },
  {
    label: t('admin.statistics.cards.totalConsume'),
    value: stats.value?.billing.totals.consume || 0,
    type: 'money',
    caption: t('admin.statistics.captions.totalScope'),
    tone: 'emerald'
  },
  {
    label: t('admin.statistics.cards.totalAff'),
    value: stats.value?.billing.totals.aff || 0,
    type: 'money',
    caption: t('admin.statistics.captions.affCommission'),
    tone: 'amber'
  },
  {
    label: t('admin.statistics.cards.totalDestroyFee'),
    value: stats.value?.billing.totals.destroyFee || 0,
    type: 'money',
    caption: t('admin.statistics.captions.userDestroyFee'),
    tone: 'rose'
  }
])

const operationCards = computed<OperationCard[]>(() => [
  {
    label: t('admin.statistics.operations.cards.todayRevenue'),
    value: stats.value?.operations.revenue.today || 0,
    type: 'money',
    caption: t('admin.statistics.operations.captions.yesterday', {
      value: formatCompactValue(stats.value?.operations.revenue.yesterday || 0, 'money')
    }),
    detail: t('admin.statistics.operations.captions.last30Days', {
      value: formatCompactValue(stats.value?.operations.revenue.last30Days || 0, 'money')
    }),
    tone: 'blue'
  },
  {
    label: t('admin.statistics.operations.cards.last7DaysRevenue'),
    value: stats.value?.operations.revenue.last7Days || 0,
    type: 'money',
    caption: t('admin.statistics.operations.captions.completedRevenue'),
    tone: 'emerald'
  },
  {
    label: t('admin.statistics.operations.cards.todayOrders'),
    value: stats.value?.operations.orders.todayTotal || 0,
    type: 'number',
    caption: t('admin.statistics.operations.captions.orderBreakdown', {
      success: stats.value?.operations.orders.todaySuccess || 0,
      failed: stats.value?.operations.orders.todayFailed || 0,
      pending: stats.value?.operations.orders.todayPending || 0
    }),
    tone: 'amber'
  },
  {
    label: t('admin.statistics.operations.cards.runningInstances'),
    value: stats.value?.operations.instances.running || 0,
    type: 'number',
    caption: t('admin.statistics.operations.captions.instanceBreakdown', {
      abnormal: stats.value?.operations.instances.abnormal || 0,
      expiring: stats.value?.operations.instances.expiringSoon || 0
    }),
    tone: (stats.value?.operations.instances.abnormal || 0) > 0 ? 'rose' : 'emerald'
  },
  {
    label: t('admin.statistics.operations.cards.onlineHosts'),
    value: stats.value?.operations.infrastructure.hostsOnline || 0,
    type: 'number',
    caption: t('admin.statistics.operations.captions.hostBreakdown', {
      total: stats.value?.operations.infrastructure.hostsTotal || 0,
      agents: stats.value?.operations.infrastructure.agentsOnline || 0
    }),
    tone: (stats.value?.operations.infrastructure.agentsStale || 0) > 0 ? 'rose' : 'blue'
  },
  {
    label: t('admin.statistics.operations.cards.openTickets'),
    value: stats.value?.operations.support.openTickets || 0,
    type: 'number',
    caption: t('admin.statistics.operations.captions.supportBreakdown', {
      unread: stats.value?.operations.support.unreadInboxMessages || 0,
      failed: (stats.value?.operations.support.failedNotifications24h || 0) + (stats.value?.operations.support.failedEmails24h || 0)
    }),
    tone: (stats.value?.operations.support.openTickets || 0) > 0 ? 'amber' : 'emerald'
  }
])

const operationFacts = computed(() => [
  {
    label: t('admin.statistics.operations.facts.newUsers'),
    value: formatValue(stats.value?.operations.users.newToday || 0, 'number')
  },
  {
    label: t('admin.statistics.operations.facts.activeUsers'),
    value: formatValue(stats.value?.operations.users.activeToday || 0, 'number')
  },
  {
    label: t('admin.statistics.operations.facts.paidUsers'),
    value: formatValue(stats.value?.operations.users.paidTotal || 0, 'number')
  },
  {
    label: t('admin.statistics.operations.facts.newInstances'),
    value: formatValue(stats.value?.operations.instances.newToday || 0, 'number')
  },
  {
    label: t('admin.statistics.operations.facts.pendingDelivery'),
    value: formatValue(stats.value?.operations.delivery.pendingTasks || 0, 'number')
  },
  {
    label: t('admin.statistics.operations.facts.failedDelivery'),
    value: formatValue(stats.value?.operations.delivery.failedTasks24h || 0, 'number')
  }
])

const operationRisks = computed(() => stats.value?.operations.risks || [])

const paidFreeTotal = computed(() =>
  (stats.value?.instances.paid || 0) + (stats.value?.instances.free || 0)
)

const paidPercent = computed(() => getPercent(stats.value?.instances.paid || 0, paidFreeTotal.value))
const freePercent = computed(() => getPercent(stats.value?.instances.free || 0, paidFreeTotal.value))

onMounted(() => {
  void loadStatistics()
})

async function loadStatistics() {
  loading.value = true
  try {
    stats.value = await api.admin.getStatisticsOverview()
  } catch (error: any) {
    toast.error(t('admin.statistics.loadFailed', {
      message: error?.message || t('admin.statistics.unknownError')
    }))
  } finally {
    loading.value = false
  }
}

function sumSeries(points: StatPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0)
}

function averageSeries(points: StatPoint[]): number {
  if (points.length === 0) return 0
  return Number((sumSeries(points) / points.length).toFixed(2))
}

function maxSeries(points: StatPoint[]): number {
  return Math.max(0, ...points.map(point => point.value))
}

function barHeight(point: StatPoint, points: StatPoint[]): number {
  const max = maxSeries(points)
  if (max <= 0) return 0
  return Math.max((point.value / max) * 100, point.value > 0 ? 3 : 0)
}

function shouldShowTick(index: number, length: number): boolean {
  if (length <= 12) return true
  return index === 0 || index === length - 1 || index % 5 === 0
}

function formatTick(label: string): string {
  return label.length === 10 ? label.slice(5) : label
}

function formatValue(value: number, type: ChartValueType): string {
  if (type === 'money') return moneyFormatter.value.format(value)
  return numberFormatter.value.format(value)
}

function formatCompactValue(value: number, type: ChartValueType): string {
  if (type === 'money') return Math.abs(value) >= 10000
    ? compactMoneyFormatter.value.format(value)
    : moneyFormatter.value.format(value)
  return Math.abs(value) >= 10000
    ? compactNumberFormatter.value.format(value)
    : numberFormatter.value.format(value)
}

function getPercent(value: number, total: number): number {
  if (total <= 0) return 0
  return Number(((value / total) * 100).toFixed(1))
}

function cardToneClass(tone: Tone): string {
  switch (tone) {
    case 'emerald':
      return 'text-themed bg-themed-secondary border-themed'
    case 'amber':
      return 'text-themed bg-themed-secondary border-themed'
    case 'rose':
      return 'text-themed bg-themed-secondary border-themed'
    default:
      return 'text-themed bg-themed-secondary border-themed'
  }
}

function barToneClass(tone: Tone): string {
  switch (tone) {
    case 'emerald':
      return 'chart-bar-emerald'
    case 'amber':
      return 'chart-bar-amber'
    case 'rose':
      return 'chart-bar-rose'
    default:
      return 'chart-bar-blue'
  }
}

function riskToneClass(severity: string): string {
  if (severity === 'critical') return 'text-rose-600 bg-rose-500/10 border-rose-500/25'
  if (severity === 'warning') return 'text-amber-600 bg-amber-500/10 border-amber-500/25'
  return 'text-themed-muted bg-themed-secondary border-themed'
}
</script>

<template>
  <div class="kawaii-page animate-fade-in">
    <div class="page-header flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="page-title">{{ t('admin.statistics.title') }}</h1>
        <p class="page-description">
          {{ t('admin.statistics.description') }}
          <span v-if="stats" class="ml-2">{{ t('admin.statistics.timezone', { timezone: stats.meta.timezone }) }}</span>
        </p>
      </div>
      <button class="btn btn-secondary btn-sm" :disabled="loading" @click="loadStatistics">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 4v5h.58m15.36 2A8 8 0 0 0 5.07 8.11M20 20v-5h-.58m0 0A8 8 0 0 1 4.06 12.03" />
        </svg>
        {{ t('admin.statistics.refresh') }}
      </button>
    </div>

    <div v-if="loading" class="space-y-6">
      <SkeletonLoader type="stats" />
      <SkeletonLoader type="card" />
    </div>

    <div v-else-if="stats" class="space-y-6">
      <ThemeTemplateSlot slot-name="admin.dashboard.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />

      <section class="space-y-5">
        <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold tracking-tight text-themed">{{ t('admin.statistics.operations.title') }}</h2>
            <p class="text-sm text-themed-muted mt-1">{{ t('admin.statistics.operations.description') }}</p>
          </div>
          <div class="text-xs font-mono text-themed-faint">
            {{ t('admin.statistics.operations.agentFreshness', { minutes: 30 }) }}
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div v-for="card in operationCards" :key="card.label" class="card p-4 sm:p-5">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border" :class="cardToneClass(card.tone)">
                <svg class="h-5 w-5 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 19V5m4 14v-7m4 7V8m4 11v-4m4 4H3" />
                </svg>
              </div>
              <p class="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-themed-faint">{{ card.label }}</p>
            </div>
            <p class="mt-3 font-mono text-2xl font-semibold tabular-nums text-themed">{{ formatCompactValue(card.value, card.type) }}</p>
            <p class="mt-1 text-xs text-themed-faint">{{ card.caption }}</p>
            <p v-if="card.detail" class="mt-1 text-xs text-themed-faint">{{ card.detail }}</p>
          </div>
        </div>

        <PluginFrameSlot slot-name="admin.dashboard.widgets" surface="admin" frame-class="min-h-[240px]" />

        <ThemeTemplateSlot slot-name="admin.dashboard.widgets" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />

        <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5">
          <div class="card p-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-base font-semibold tracking-tight text-themed">{{ t('admin.statistics.operations.riskTitle') }}</h3>
                <p class="text-sm text-themed-muted mt-1">{{ t('admin.statistics.operations.riskDescription') }}</p>
              </div>
              <span :class="['px-2.5 py-1 rounded-full text-xs font-medium border', operationRisks.length ? 'text-amber-600 bg-amber-500/10 border-amber-500/25' : 'text-emerald-600 bg-emerald-500/10 border-emerald-500/25']">
                {{ operationRisks.length ? t('admin.statistics.operations.riskCount', { count: operationRisks.length }) : t('admin.statistics.operations.noRisk') }}
              </span>
            </div>

            <div v-if="operationRisks.length" class="mt-5 space-y-3">
              <div
                v-for="risk in operationRisks"
                :key="risk.key"
                :class="['border rounded-lg p-3', riskToneClass(risk.severity)]"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-sm font-medium">{{ t(`admin.statistics.operations.risks.${risk.key}.title`, { count: risk.count }) }}</p>
                    <p class="text-xs mt-1 opacity-80">{{ t(`admin.statistics.operations.risks.${risk.key}.description`, { count: risk.count }) }}</p>
                  </div>
                  <span class="text-xs font-medium uppercase">{{ t(`admin.statistics.operations.severity.${risk.severity}`) }}</span>
                </div>
              </div>
            </div>

            <div v-else class="mt-5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-5">
              <p class="text-sm font-medium text-emerald-600">{{ t('admin.statistics.operations.healthyTitle') }}</p>
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.statistics.operations.healthyDescription') }}</p>
            </div>
          </div>

          <div class="card p-5">
            <h3 class="text-base font-semibold tracking-tight text-themed">{{ t('admin.statistics.operations.todayTitle') }}</h3>
            <p class="text-sm text-themed-muted mt-1">{{ t('admin.statistics.operations.todayDescription') }}</p>
            <div class="mt-5 divide-y divide-themed">
              <div v-for="fact in operationFacts" :key="fact.label" class="flex items-center justify-between gap-4 py-3">
                <span class="text-sm text-themed-muted">{{ fact.label }}</span>
                <span class="font-mono text-sm font-semibold tabular-nums text-themed">{{ fact.value }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="border-b border-themed">
        <div class="-mb-px flex gap-1 overflow-x-auto">
          <button
            v-for="tab in tabItems"
            :key="tab.value"
            class="border-b-2 -mb-px whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors"
            :class="activeTab === tab.value ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400' : 'border-transparent text-themed-muted hover:text-themed'"
            @click="activeTab = tab.value"
          >
            {{ t(tab.labelKey) }}
          </button>
        </div>
      </div>

      <section v-if="activeTab === 'users'" class="space-y-5">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div v-for="card in userCards" :key="card.label" class="card p-4 sm:p-5">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border" :class="cardToneClass(card.tone)">
                <svg class="h-5 w-5 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 19.13a9.38 9.38 0 0 0 2.63.37 9.34 9.34 0 0 0 4.12-.95 4.13 4.13 0 0 0-7.54-2.5M15 19.13v.1A12.32 12.32 0 0 1 8.62 21a12.32 12.32 0 0 1-6.37-1.77v-.1a6.38 6.38 0 0 1 11.96-3.08M12 6.38a3.38 3.38 0 1 1-6.75 0 3.38 3.38 0 0 1 6.75 0Zm8.25 2.25a2.63 2.63 0 1 1-5.25 0 2.63 2.63 0 0 1 5.25 0Z" />
                </svg>
              </div>
              <p class="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-themed-faint">{{ card.label }}</p>
            </div>
            <p class="mt-3 font-mono text-2xl font-semibold tabular-nums text-themed">{{ formatValue(card.value, card.type) }}</p>
            <p class="mt-1 text-xs text-themed-faint">{{ card.caption }}</p>
          </div>
        </div>

        <div class="card p-5">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <span class="chart-swatch chart-bar-blue"></span>
                <h2 class="text-base font-semibold tracking-tight text-themed">{{ t('admin.statistics.sections.newUsers') }}</h2>
              </div>
              <p class="text-sm text-themed-muted mt-1">
                {{ userPeriod === 'daily' ? t('admin.statistics.ranges.last30Days') : t('admin.statistics.ranges.last12Months') }}
              </p>
            </div>
            <div class="inline-flex rounded-lg border border-themed p-1 bg-themed-tertiary">
              <button
                v-for="period in periodItems"
                :key="period.value"
                class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                :class="userPeriod === period.value ? 'bg-themed text-themed shadow-sm' : 'text-themed-muted hover:text-themed'"
                @click="userPeriod = period.value"
              >
                {{ t(period.labelKey) }}
              </button>
            </div>
          </div>

          <div class="chart-area mt-6">
            <div v-for="(point, index) in userSeries" :key="point.label" class="chart-column group">
              <div class="chart-value" :title="`${point.label}: ${formatValue(point.value, 'number')}`">
                <span class="chart-tooltip">{{ t('admin.statistics.tooltip', { label: point.label, value: formatValue(point.value, 'number') }) }}</span>
                <div
                  :class="['chart-bar', barToneClass('blue')]"
                  :style="{ height: `${barHeight(point, userSeries)}%` }"
                ></div>
              </div>
              <span class="chart-tick">{{ shouldShowTick(index, userSeries.length) ? formatTick(point.label) : '' }}</span>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'instances'" class="space-y-5">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div v-for="card in instanceCards" :key="card.label" class="card p-4 sm:p-5">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border" :class="cardToneClass(card.tone)">
                <svg class="h-5 w-5 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 7.5h14M5 12h14M5 16.5h14M6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4Z" />
                </svg>
              </div>
              <p class="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-themed-faint">{{ card.label }}</p>
            </div>
            <p class="mt-3 font-mono text-2xl font-semibold tabular-nums text-themed">{{ formatValue(card.value, card.type) }}</p>
            <p class="mt-1 text-xs text-themed-faint">{{ card.caption }}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <div class="card p-5">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div class="flex items-center gap-2">
                  <span class="chart-swatch chart-bar-emerald"></span>
                  <h2 class="text-base font-semibold tracking-tight text-themed">{{ t('admin.statistics.sections.createdInstances') }}</h2>
                </div>
                <p class="text-sm text-themed-muted mt-1">
                  {{ instancePeriod === 'daily' ? t('admin.statistics.ranges.last30Days') : t('admin.statistics.ranges.last12Months') }}
                </p>
              </div>
              <div class="inline-flex rounded-lg border border-themed p-1 bg-themed-tertiary">
                <button
                  v-for="period in periodItems"
                  :key="period.value"
                  class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                  :class="instancePeriod === period.value ? 'bg-themed text-themed shadow-sm' : 'text-themed-muted hover:text-themed'"
                  @click="instancePeriod = period.value"
                >
                  {{ t(period.labelKey) }}
                </button>
              </div>
            </div>

            <div class="chart-area mt-6">
              <div v-for="(point, index) in instanceSeries" :key="point.label" class="chart-column group">
                <div class="chart-value" :title="`${point.label}: ${formatValue(point.value, 'number')}`">
                  <span class="chart-tooltip">{{ t('admin.statistics.tooltip', { label: point.label, value: formatValue(point.value, 'number') }) }}</span>
                  <div
                    :class="['chart-bar', barToneClass('emerald')]"
                    :style="{ height: `${barHeight(point, instanceSeries)}%` }"
                  ></div>
                </div>
                <span class="chart-tick">{{ shouldShowTick(index, instanceSeries.length) ? formatTick(point.label) : '' }}</span>
              </div>
            </div>
          </div>

          <div class="card p-5">
            <h2 class="text-base font-semibold tracking-tight text-themed">{{ t('admin.statistics.sections.paidFreeInstances') }}</h2>
            <p class="text-sm text-themed-muted mt-1">{{ t('admin.statistics.sections.paidFreeDescription') }}</p>

            <div class="mt-8">
              <div class="h-3 rounded-full overflow-hidden bg-themed-tertiary flex">
                <div class="stat-split-seg bg-blue-500" :style="{ width: `${paidPercent}%` }"></div>
                <div class="stat-split-seg bg-emerald-500" :style="{ width: `${freePercent}%` }"></div>
              </div>

              <div class="mt-6 space-y-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    <span class="text-sm text-themed-secondary">{{ t('admin.statistics.labels.paidInstances') }}</span>
                  </div>
                  <div class="text-right">
                    <p class="font-mono text-sm font-semibold tabular-nums text-themed">{{ formatValue(stats.instances.paid, 'number') }}</p>
                    <p class="font-mono text-xs tabular-nums text-themed-muted">{{ paidPercent }}%</p>
                  </div>
                </div>

                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    <span class="text-sm text-themed-secondary">{{ t('admin.statistics.labels.freeInstances') }}</span>
                  </div>
                  <div class="text-right">
                    <p class="font-mono text-sm font-semibold tabular-nums text-themed">{{ formatValue(stats.instances.free, 'number') }}</p>
                    <p class="font-mono text-xs tabular-nums text-themed-muted">{{ freePercent }}%</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="space-y-5">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div v-for="card in billingCards" :key="card.label" class="card p-4 sm:p-5">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border" :class="cardToneClass(card.tone)">
                <svg class="h-5 w-5 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5V9h-2.5a3.5 3.5 0 1 0 0 7H19v.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 3 16.5v-9Z" />
                  <circle cx="16.5" cy="12.5" r="0.75" fill="currentColor" />
                </svg>
              </div>
              <p class="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-themed-faint">{{ card.label }}</p>
            </div>
            <p class="mt-3 font-mono text-2xl font-semibold tabular-nums text-themed">{{ formatCompactValue(card.value, card.type) }}</p>
            <p class="mt-1 text-xs text-themed-faint">{{ card.caption }}</p>
          </div>
        </div>

        <div class="card p-5">
          <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <span class="chart-swatch" :class="barToneClass(currentBillingMetric.tone)"></span>
                <h2 class="text-base font-semibold tracking-tight text-themed">
                  {{ t('admin.statistics.sections.metricTrend', { metric: t(currentBillingMetric.labelKey) }) }}
                </h2>
              </div>
              <p class="text-sm text-themed-muted mt-1">
                {{ t('admin.statistics.sections.billingScope', {
                  range: billingPeriod === 'daily' ? t('admin.statistics.ranges.last30Days') : t('admin.statistics.ranges.last12Months')
                }) }}
              </p>
            </div>

            <div class="flex flex-col sm:flex-row gap-3">
              <div class="flex flex-wrap rounded-lg border border-themed p-1 bg-themed-tertiary">
                <button
                  v-for="metric in billingMetricItems"
                  :key="metric.value"
                  class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                  :class="billingMetric === metric.value ? 'bg-themed text-themed shadow-sm' : 'text-themed-muted hover:text-themed'"
                  @click="billingMetric = metric.value"
                >
                  {{ t(metric.labelKey) }}
                </button>
              </div>

              <div class="inline-flex rounded-lg border border-themed p-1 bg-themed-tertiary">
                <button
                  v-for="period in periodItems"
                  :key="period.value"
                  class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                  :class="billingPeriod === period.value ? 'bg-themed text-themed shadow-sm' : 'text-themed-muted hover:text-themed'"
                  @click="billingPeriod = period.value"
                >
                  {{ t(period.labelKey) }}
                </button>
              </div>
            </div>
          </div>

          <div class="chart-area mt-6">
            <div v-for="(point, index) in billingSeries" :key="point.label" class="chart-column group">
              <div class="chart-value" :title="`${point.label}: ${formatValue(point.value, 'money')}`">
                <span class="chart-tooltip">{{ t('admin.statistics.tooltip', { label: point.label, value: formatCompactValue(point.value, 'money') }) }}</span>
                <div
                  :class="['chart-bar', barToneClass(currentBillingMetric.tone)]"
                  :style="{ height: `${barHeight(point, billingSeries)}%` }"
                ></div>
              </div>
              <span class="chart-tick">{{ shouldShowTick(index, billingSeries.length) ? formatTick(point.label) : '' }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="card p-12 text-center">
      <p class="text-themed-muted">{{ t('admin.statistics.noData') }}</p>
      <button class="btn btn-primary mt-4" @click="loadStatistics">{{ t('admin.statistics.reload') }}</button>
    </div>
  </div>
</template>

<style scoped>
.chart-area {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(26px, 1fr);
  align-items: end;
  gap: 0.5rem;
  min-height: 18rem;
  overflow-x: auto;
  padding: 2.75rem 0.25rem 1.25rem;
  scrollbar-gutter: stable;
}

.chart-column {
  min-width: 26px;
}

.chart-value {
  position: relative;
  display: flex;
  align-items: end;
  justify-content: center;
  height: 15rem;
  border-bottom: 1px solid var(--border-color);
}

.chart-bar {
  width: min(70%, 1.6rem);
  min-height: 0;
  border-radius: 0.45rem 0.45rem 0 0;
  background-image: linear-gradient(180deg, rgb(255 255 255 / 0.18), rgb(255 255 255 / 0));
  transform-origin: bottom;
  transition: height 0.25s ease, opacity 0.15s ease;
  animation: chart-grow 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.chart-column:hover .chart-bar {
  opacity: 0.78;
}

@keyframes chart-grow {
  from { transform: scaleY(0); opacity: 0.5; }
  to { transform: scaleY(1); opacity: 1; }
}

.stat-split-seg {
  background-image: linear-gradient(180deg, rgb(255 255 255 / 0.22), rgb(255 255 255 / 0));
  transform-origin: left;
  animation: stat-split-grow 0.85s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

@keyframes stat-split-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

.chart-bar-blue {
  background-color: #2563eb;
}

.chart-bar-emerald {
  background-color: #059669;
}

.chart-bar-amber {
  background-color: #d97706;
}

.chart-bar-rose {
  background-color: #e11d48;
}

:global(.dark) .chart-bar-blue {
  background-color: #60a5fa;
}

:global(.dark) .chart-bar-emerald {
  background-color: #34d399;
}

:global(.dark) .chart-bar-amber {
  background-color: #fbbf24;
}

:global(.dark) .chart-bar-rose {
  background-color: #fb7185;
}

.chart-tooltip {
  position: absolute;
  top: -2.25rem;
  left: 50%;
  z-index: 10;
  transform: translateX(-50%);
  white-space: nowrap;
  border-radius: 0.375rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
}

.chart-column:hover .chart-tooltip {
  opacity: 1;
}

.chart-tick {
  display: block;
  width: max-content;
  min-height: 1rem;
  margin: 0.5rem auto 0;
  text-align: center;
  font-size: 0.68rem;
  line-height: 1rem;
  white-space: nowrap;
  word-break: keep-all;
  overflow-wrap: normal;
  color: var(--text-tertiary);
}

/* Nimbus legend swatch — reuses .chart-bar-* background colors to echo each series */
.chart-swatch {
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
  flex-shrink: 0;
  border-radius: 0.1875rem;
}

@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
</style>
