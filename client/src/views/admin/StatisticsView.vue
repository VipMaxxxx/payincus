<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
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
      return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
    case 'amber':
      return 'text-amber-500 bg-amber-500/10 border-amber-500/20'
    case 'rose':
      return 'text-rose-500 bg-rose-500/10 border-rose-500/20'
    default:
      return 'text-blue-500 bg-blue-500/10 border-blue-500/20'
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
</script>

<template>
  <div class="animate-fade-in">
    <div class="page-header flex items-center justify-between gap-4">
      <div>
        <h1 class="page-title">{{ t('admin.statistics.title') }}</h1>
        <p class="text-sm text-themed-muted mt-1">
          {{ t('admin.statistics.description') }}
          <span v-if="stats" class="ml-2">{{ t('admin.statistics.timezone', { timezone: stats.meta.timezone }) }}</span>
        </p>
      </div>
      <button class="btn btn-secondary" :disabled="loading" @click="loadStatistics">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <div class="inline-flex rounded-lg border border-themed p-1 bg-themed-tertiary">
        <button
          v-for="tab in tabItems"
          :key="tab.value"
          class="px-4 py-2 text-sm font-medium rounded-md transition-colors"
          :class="activeTab === tab.value ? 'bg-themed text-themed shadow-sm' : 'text-themed-muted hover:text-themed hover:bg-themed-hover'"
          @click="activeTab = tab.value"
        >
          {{ t(tab.labelKey) }}
        </button>
      </div>

      <section v-if="activeTab === 'users'" class="space-y-5">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div v-for="card in userCards" :key="card.label" class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm text-themed-muted">{{ card.label }}</p>
                <p class="mt-2 text-2xl font-semibold text-themed">{{ formatValue(card.value, card.type) }}</p>
                <p class="mt-1 text-xs text-themed-faint">{{ card.caption }}</p>
              </div>
              <div :class="['w-10 h-10 rounded-lg border flex items-center justify-center', cardToneClass(card.tone)]">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 19.13a9.38 9.38 0 0 0 2.63.37 9.34 9.34 0 0 0 4.12-.95 4.13 4.13 0 0 0-7.54-2.5M15 19.13v.1A12.32 12.32 0 0 1 8.62 21a12.32 12.32 0 0 1-6.37-1.77v-.1a6.38 6.38 0 0 1 11.96-3.08M12 6.38a3.38 3.38 0 1 1-6.75 0 3.38 3.38 0 0 1 6.75 0Zm8.25 2.25a2.63 2.63 0 1 1-5.25 0 2.63 2.63 0 0 1 5.25 0Z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="card p-5">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 class="text-base font-semibold text-themed">{{ t('admin.statistics.sections.newUsers') }}</h2>
              <p class="text-sm text-themed-muted mt-1">
                {{ userPeriod === 'daily' ? t('admin.statistics.ranges.last30Days') : t('admin.statistics.ranges.last12Months') }}
              </p>
            </div>
            <div class="inline-flex rounded-lg border border-themed p-1 bg-themed-tertiary">
              <button
                v-for="period in periodItems"
                :key="period.value"
                class="px-3 py-1.5 text-sm rounded-md transition-colors"
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
          <div v-for="card in instanceCards" :key="card.label" class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm text-themed-muted">{{ card.label }}</p>
                <p class="mt-2 text-2xl font-semibold text-themed">{{ formatValue(card.value, card.type) }}</p>
                <p class="mt-1 text-xs text-themed-faint">{{ card.caption }}</p>
              </div>
              <div :class="['w-10 h-10 rounded-lg border flex items-center justify-center', cardToneClass(card.tone)]">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 7.5h14M5 12h14M5 16.5h14M6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4Z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <div class="card p-5">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 class="text-base font-semibold text-themed">{{ t('admin.statistics.sections.createdInstances') }}</h2>
                <p class="text-sm text-themed-muted mt-1">
                  {{ instancePeriod === 'daily' ? t('admin.statistics.ranges.last30Days') : t('admin.statistics.ranges.last12Months') }}
                </p>
              </div>
              <div class="inline-flex rounded-lg border border-themed p-1 bg-themed-tertiary">
                <button
                  v-for="period in periodItems"
                  :key="period.value"
                  class="px-3 py-1.5 text-sm rounded-md transition-colors"
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
            <h2 class="text-base font-semibold text-themed">{{ t('admin.statistics.sections.paidFreeInstances') }}</h2>
            <p class="text-sm text-themed-muted mt-1">{{ t('admin.statistics.sections.paidFreeDescription') }}</p>

            <div class="mt-8">
              <div class="h-3 rounded-full overflow-hidden bg-themed-tertiary flex">
                <div class="bg-blue-500" :style="{ width: `${paidPercent}%` }"></div>
                <div class="bg-emerald-500" :style="{ width: `${freePercent}%` }"></div>
              </div>

              <div class="mt-6 space-y-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    <span class="text-sm text-themed-secondary">{{ t('admin.statistics.labels.paidInstances') }}</span>
                  </div>
                  <div class="text-right">
                    <p class="text-sm font-medium text-themed">{{ formatValue(stats.instances.paid, 'number') }}</p>
                    <p class="text-xs text-themed-muted">{{ paidPercent }}%</p>
                  </div>
                </div>

                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    <span class="text-sm text-themed-secondary">{{ t('admin.statistics.labels.freeInstances') }}</span>
                  </div>
                  <div class="text-right">
                    <p class="text-sm font-medium text-themed">{{ formatValue(stats.instances.free, 'number') }}</p>
                    <p class="text-xs text-themed-muted">{{ freePercent }}%</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="space-y-5">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div v-for="card in billingCards" :key="card.label" class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm text-themed-muted">{{ card.label }}</p>
                <p class="mt-2 text-2xl font-semibold text-themed">{{ formatCompactValue(card.value, card.type) }}</p>
                <p class="mt-1 text-xs text-themed-faint">{{ card.caption }}</p>
              </div>
              <div :class="['w-10 h-10 rounded-lg border flex items-center justify-center', cardToneClass(card.tone)]">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5V9h-2.5a3.5 3.5 0 1 0 0 7H19v.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 3 16.5v-9Z" />
                  <circle cx="16.5" cy="12.5" r="0.75" fill="currentColor" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="card p-5">
          <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div>
              <h2 class="text-base font-semibold text-themed">
                {{ t('admin.statistics.sections.metricTrend', { metric: t(currentBillingMetric.labelKey) }) }}
              </h2>
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
                  class="px-3 py-1.5 text-sm rounded-md transition-colors"
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
                  class="px-3 py-1.5 text-sm rounded-md transition-colors"
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
  transition: height 0.25s ease, opacity 0.15s ease;
}

.chart-column:hover .chart-bar {
  opacity: 0.78;
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
</style>
