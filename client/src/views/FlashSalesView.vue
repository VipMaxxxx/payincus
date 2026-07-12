<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import { instanceCreatePath } from '@/utils/app-paths'
import type { FlashSaleCampaign, FlashSaleItem, FlashSaleReservation } from '@/types/api'

const router = useRouter()
const toast = useToast()
const { t } = useI18n()

const loading = ref(true)
const reservationsLoading = ref(false)
const campaigns = ref<FlashSaleCampaign[]>([])
const reservations = ref<FlashSaleReservation[]>([])

const activeCampaigns = computed(() => campaigns.value.filter(campaign => campaign.effectiveStatus === 'active'))
const upcomingCampaigns = computed(() => campaigns.value.filter(campaign => campaign.effectiveStatus === 'scheduled'))
const pausedCampaigns = computed(() => campaigns.value.filter(campaign => campaign.effectiveStatus === 'paused'))

function formatMoneyCents(cents: number): string {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

function formatDisk(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

function stockPercent(item: FlashSaleItem): number {
  if (item.totalStock <= 0) return 0
  return Math.min(100, Math.round((item.soldCount / item.totalStock) * 100))
}

function itemStatus(item: FlashSaleItem, campaign: FlashSaleCampaign): { label: string; disabled: boolean } {
  if (campaign.effectiveStatus === 'scheduled') return { label: t('flashSales.status.notStarted'), disabled: true }
  if (campaign.effectiveStatus === 'paused') return { label: t('flashSales.status.paused'), disabled: true }
  if (campaign.effectiveStatus !== 'active') return { label: t('flashSales.status.ended'), disabled: true }
  if (item.remainingStock <= 0) return { label: t('flashSales.status.soldOut'), disabled: true }
  if (!item.plan.isActive || item.plan.isSoldOut) return { label: t('flashSales.status.planUnavailable'), disabled: true }
  return { label: t('flashSales.buyNow'), disabled: false }
}

async function loadData(): Promise<void> {
  loading.value = true
  try {
    const [saleResponse, reservationResponse] = await Promise.all([
      api.flashSales.list(),
      api.flashSales.myReservations({ page: 1, pageSize: 20 }).catch(() => ({ reservations: [] as FlashSaleReservation[], total: 0, page: 1, pageSize: 20 }))
    ])
    campaigns.value = saleResponse.campaigns || []
    reservations.value = reservationResponse.reservations || []
  } catch (err: any) {
    toast.error(t('flashSales.loadFailed', { error: err?.message || String(err) }))
  } finally {
    loading.value = false
  }
}

async function loadReservations(): Promise<void> {
  reservationsLoading.value = true
  try {
    const response = await api.flashSales.myReservations({ page: 1, pageSize: 20 })
    reservations.value = response.reservations || []
  } catch (err: any) {
    toast.error(t('flashSales.reservationsLoadFailed', { error: err?.message || String(err) }))
  } finally {
    reservationsLoading.value = false
  }
}

function buy(item: FlashSaleItem): void {
  void router.push({
    path: instanceCreatePath(),
    query: {
      source: item.plan.package.sourceType,
      package: String(item.plan.package.id),
      plan: String(item.packagePlanId),
      flashSaleItem: String(item.id)
    }
  })
}

onMounted(loadData)
</script>

<template>
  <div class="kawaii-page page-container animate-fade-in">
    <header class="mb-6 flex flex-col gap-4 border-b border-themed pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight text-themed">{{ t('flashSales.title') }}</h1>
        <p class="mt-1.5 text-sm text-themed-muted">{{ t('flashSales.description') }}</p>
      </div>
      <div class="flex flex-shrink-0 flex-wrap items-center gap-2">
        <button class="btn-secondary" :disabled="loading" @click="loadData">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          {{ t('common.refresh') }}
        </button>
      </div>
    </header>

    <SkeletonLoader v-if="loading" type="card" :count="4" />

    <template v-else>
      <section v-if="activeCampaigns.length === 0 && upcomingCampaigns.length === 0 && pausedCampaigns.length === 0" class="rounded-xl border border-themed bg-themed-surface p-12 text-center shadow-sm">
        <svg class="mx-auto h-10 w-10 text-themed-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
        <div class="mt-3 text-lg font-semibold text-themed">{{ t('flashSales.empty') }}</div>
        <p class="mt-2 text-sm text-themed-muted">{{ t('flashSales.emptyHint') }}</p>
      </section>

      <section v-for="campaign in [...activeCampaigns, ...upcomingCampaigns, ...pausedCampaigns]" :key="campaign.id" class="mb-6 overflow-hidden rounded-xl border border-themed bg-themed-surface shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-4 border-b border-themed bg-themed-tertiary px-5 py-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg font-semibold text-themed">{{ campaign.name }}</h2>
              <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium" :class="campaign.effectiveStatus === 'active' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : campaign.effectiveStatus === 'scheduled' ? 'bg-themed-secondary text-themed-muted' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'">
                <span class="h-1.5 w-1.5 rounded-full bg-current opacity-80"></span>
                {{ campaign.effectiveStatus === 'active' ? t('flashSales.status.active') : campaign.effectiveStatus === 'scheduled' ? t('flashSales.status.upcoming') : t('flashSales.status.paused') }}
              </span>
            </div>
            <p v-if="campaign.description" class="mt-1.5 text-sm text-themed-muted">{{ campaign.description }}</p>
            <p class="mt-2 font-mono text-xs tabular-nums text-themed-faint">{{ formatDate(campaign.startAt) }} — {{ formatDate(campaign.endAt) }}</p>
          </div>
          <div class="rounded-lg border border-themed bg-themed-surface px-3 py-1.5 text-xs text-themed-muted">{{ t('flashSales.perUserLimit', { count: campaign.maxPerUser }) }}</div>
        </div>

        <div class="grid gap-4 p-5 lg:grid-cols-2">
          <article v-for="item in campaign.items" :key="item.id" class="nimbus-lift rounded-xl border border-themed bg-themed-surface p-5 shadow-sm">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <h3 class="text-base font-semibold text-themed">{{ item.plan.package.name }} / {{ item.plan.name }}</h3>
                <p class="mt-1 text-sm text-themed-muted">
                  {{ t('flashSales.planResources', { cpu: item.plan.cpu, memory: formatMemory(item.plan.memory), disk: formatDisk(item.plan.disk) }) }}
                </p>
              </div>
              <div class="shrink-0 text-right">
                <div class="font-mono text-xl font-semibold tabular-nums text-themed">{{ formatMoneyCents(item.flashPrice) }}</div>
                <div class="font-mono text-xs tabular-nums text-themed-faint line-through">{{ formatMoneyCents(item.originalPriceSnapshot) }}</div>
                <div class="mt-1 max-w-48 text-xs text-amber-600 dark:text-amber-400">{{ t('flashSales.firstTermOnly') }}</div>
              </div>
            </div>

            <div class="mt-4">
              <div class="mb-1.5 flex items-center justify-between text-xs text-themed-muted">
                <span>{{ t('flashSales.stock', { remaining: item.remainingStock, total: item.totalStock }) }}</span>
                <span class="font-mono tabular-nums">{{ t('flashSales.soldPercent', { percent: stockPercent(item) }) }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-themed-secondary">
                <div class="nimbus-bar h-full rounded-full bg-primary-500" :style="{ width: `${stockPercent(item)}%` }" />
              </div>
            </div>

            <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-themed pt-4">
              <div class="inline-flex items-center gap-1.5 text-xs text-themed-muted">
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" /></svg>
                {{ item.plan.trafficLimitSpeed }} · {{ item.plan.package.networkMode }}
              </div>
              <button
                class="btn-primary btn-sm"
                :disabled="itemStatus(item, campaign).disabled"
                @click="buy(item)"
              >
                {{ itemStatus(item, campaign).label }}
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="overflow-hidden rounded-xl border border-themed bg-themed-surface shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-themed px-5 py-4">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-themed">{{ t('flashSales.myReservations') }}</h2>
            <p class="mt-1 text-sm text-themed-muted">{{ t('flashSales.reservationsDescription') }}</p>
          </div>
          <button class="btn-secondary btn-sm" :disabled="reservationsLoading" @click="loadReservations">{{ t('flashSales.refreshReservations') }}</button>
        </div>
        <div v-if="reservations.length === 0" class="px-5 py-12 text-center text-sm text-themed-muted">{{ t('flashSales.noReservations') }}</div>
        <div v-else class="space-y-3 p-4 lg:hidden">
          <div
            v-for="record in reservations"
            :key="record.id"
            class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-themed" :title="record.campaignName">{{ record.campaignName }}</div>
                <div class="mt-1 truncate text-xs text-themed-muted" :title="`${record.packageName} / ${record.planName}`">
                  {{ record.packageName }} / {{ record.planName }}
                </div>
              </div>
              <div class="shrink-0 text-right">
                <div class="font-mono font-semibold tabular-nums text-themed">¥{{ record.amount.toFixed(2) }}</div>
                <span class="mt-1 inline-flex items-center rounded-full bg-themed-secondary px-2 py-0.5 text-xs font-medium text-themed-muted">{{ record.status }}</span>
              </div>
            </div>
            <div class="mt-3 flex items-center gap-1.5 rounded-lg bg-themed-tertiary px-3 py-2 font-mono text-xs tabular-nums text-themed-muted">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              {{ formatDate(record.createdAt) }}
            </div>
          </div>
        </div>
        <div v-if="reservations.length > 0" class="hidden overflow-hidden lg:block">
          <table class="w-full table-fixed divide-y divide-themed">
            <thead>
              <tr class="bg-themed-tertiary text-left text-2xs font-medium uppercase tracking-wider text-themed-muted">
                <th class="w-[24%] px-5 py-3">{{ t('flashSales.columns.campaign') }}</th>
                <th class="w-[28%] px-5 py-3">{{ t('flashSales.columns.package') }}</th>
                <th class="w-[12%] px-5 py-3">{{ t('flashSales.columns.amount') }}</th>
                <th class="w-[14%] px-5 py-3">{{ t('flashSales.columns.status') }}</th>
                <th class="w-[22%] px-5 py-3">{{ t('flashSales.columns.time') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed text-sm">
              <tr v-for="record in reservations" :key="record.id" class="transition-colors hover:bg-themed-tertiary">
                <td class="px-5 py-3 font-medium text-themed">
                  <div class="truncate" :title="record.campaignName">{{ record.campaignName }}</div>
                </td>
                <td class="px-5 py-3 text-themed-muted">
                  <div class="truncate" :title="`${record.packageName} / ${record.planName}`">{{ record.packageName }} / {{ record.planName }}</div>
                </td>
                <td class="whitespace-nowrap px-5 py-3 font-mono tabular-nums text-themed">¥{{ record.amount.toFixed(2) }}</td>
                <td class="px-5 py-3 text-themed-muted">
                  <span class="inline-flex max-w-full items-center truncate rounded-full bg-themed-secondary px-2 py-0.5 text-xs font-medium text-themed-muted" :title="record.status">{{ record.status }}</span>
                </td>
                <td class="whitespace-nowrap px-5 py-3 font-mono text-xs tabular-nums text-themed-muted">{{ formatDate(record.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.nimbus-lift {
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.nimbus-lift:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px -8px rgb(16 24 40 / .18);
}
.nimbus-bar {
  position: relative;
  overflow: hidden;
  background-image: linear-gradient(90deg, var(--kawaii-primary), color-mix(in srgb, var(--kawaii-primary) 74%, #fff));
  transition: width .5s cubic-bezier(.22, 1, .36, 1);
}
.nimbus-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / .38), transparent);
  transform: translateX(-100%);
  animation: nimbus-bar-shimmer 2.6s ease-in-out infinite;
}
@keyframes nimbus-bar-shimmer {
  0% { transform: translateX(-100%); }
  60%, 100% { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .nimbus-lift,
  .nimbus-lift:hover {
    transition: none;
    transform: none;
  }
  .nimbus-bar {
    transition: none;
  }
  .nimbus-bar::after {
    animation: none;
    display: none;
  }
}
</style>
