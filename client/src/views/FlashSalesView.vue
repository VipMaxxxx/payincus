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
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('flashSales.title') }}</h1>
        <p class="page-description">{{ t('flashSales.description') }}</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadData">{{ t('common.refresh') }}</button>
    </div>

    <SkeletonLoader v-if="loading" type="card" :count="4" />

    <template v-else>
      <section v-if="activeCampaigns.length === 0 && upcomingCampaigns.length === 0 && pausedCampaigns.length === 0" class="card p-10 text-center">
        <div class="text-lg font-semibold text-themed">{{ t('flashSales.empty') }}</div>
        <p class="mt-2 text-sm text-themed-muted">{{ t('flashSales.emptyHint') }}</p>
      </section>

      <section v-for="campaign in [...activeCampaigns, ...upcomingCampaigns, ...pausedCampaigns]" :key="campaign.id" class="mb-6 rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-wrap items-start justify-between gap-4 border-b border-themed px-5 py-4">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg font-semibold text-themed">{{ campaign.name }}</h2>
              <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="campaign.effectiveStatus === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : campaign.effectiveStatus === 'scheduled' ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'">
                {{ campaign.effectiveStatus === 'active' ? t('flashSales.status.active') : campaign.effectiveStatus === 'scheduled' ? t('flashSales.status.upcoming') : t('flashSales.status.paused') }}
              </span>
            </div>
            <p v-if="campaign.description" class="mt-1 text-sm text-themed-muted">{{ campaign.description }}</p>
            <p class="mt-2 text-xs text-themed-muted">{{ formatDate(campaign.startAt) }} - {{ formatDate(campaign.endAt) }}</p>
          </div>
          <div class="text-sm text-themed-muted">{{ t('flashSales.perUserLimit', { count: campaign.maxPerUser }) }}</div>
        </div>

        <div class="grid gap-4 p-5 lg:grid-cols-2">
          <article v-for="item in campaign.items" :key="item.id" class="rounded-lg border border-themed bg-themed p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-base font-semibold text-themed">{{ item.plan.package.name }} / {{ item.plan.name }}</h3>
                <p class="mt-1 text-sm text-themed-muted">
                  {{ t('flashSales.planResources', { cpu: item.plan.cpu, memory: formatMemory(item.plan.memory), disk: formatDisk(item.plan.disk) }) }}
                </p>
              </div>
              <div class="text-right">
                <div class="text-xl font-semibold text-themed">{{ formatMoneyCents(item.flashPrice) }}</div>
                <div class="text-xs text-themed-muted line-through">{{ formatMoneyCents(item.originalPriceSnapshot) }}</div>
                <div class="mt-1 max-w-48 text-xs text-amber-700 dark:text-amber-300">{{ t('flashSales.firstTermOnly') }}</div>
              </div>
            </div>

            <div class="mt-4">
              <div class="mb-1 flex items-center justify-between text-xs text-themed-muted">
                <span>{{ t('flashSales.stock', { remaining: item.remainingStock, total: item.totalStock }) }}</span>
                <span>{{ t('flashSales.soldPercent', { percent: stockPercent(item) }) }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-themed-secondary">
                <div class="h-full rounded-full bg-accent" :style="{ width: `${stockPercent(item)}%` }" />
              </div>
            </div>

            <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div class="text-xs text-themed-muted">
                {{ item.plan.trafficLimitSpeed }} · {{ item.plan.package.networkMode }}
              </div>
              <button
                class="btn-primary"
                :disabled="itemStatus(item, campaign).disabled"
                @click="buy(item)"
              >
                {{ itemStatus(item, campaign).label }}
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="rounded-lg border border-themed bg-themed-surface">
        <div class="flex items-center justify-between border-b border-themed px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">{{ t('flashSales.myReservations') }}</h2>
            <p class="mt-1 text-sm text-themed-muted">{{ t('flashSales.reservationsDescription') }}</p>
          </div>
          <button class="btn-secondary" :disabled="reservationsLoading" @click="loadReservations">{{ t('flashSales.refreshReservations') }}</button>
        </div>
        <div v-if="reservations.length === 0" class="px-5 py-8 text-center text-themed-muted">{{ t('flashSales.noReservations') }}</div>
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
                <div class="font-semibold text-themed">¥{{ record.amount.toFixed(2) }}</div>
                <div class="mt-1 text-xs text-themed-muted">{{ record.status }}</div>
              </div>
            </div>
            <div class="mt-3 rounded-lg bg-themed-secondary px-3 py-2 text-xs text-themed-muted">
              {{ formatDate(record.createdAt) }}
            </div>
          </div>
        </div>
        <div v-if="reservations.length > 0" class="hidden overflow-hidden lg:block">
          <table class="w-full table-fixed divide-y divide-themed">
            <thead>
              <tr class="text-left text-xs text-themed-muted">
                <th class="w-[24%] px-5 py-3">{{ t('flashSales.columns.campaign') }}</th>
                <th class="w-[28%] px-5 py-3">{{ t('flashSales.columns.package') }}</th>
                <th class="w-[12%] px-5 py-3">{{ t('flashSales.columns.amount') }}</th>
                <th class="w-[14%] px-5 py-3">{{ t('flashSales.columns.status') }}</th>
                <th class="w-[22%] px-5 py-3">{{ t('flashSales.columns.time') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed text-sm">
              <tr v-for="record in reservations" :key="record.id">
                <td class="px-5 py-3 text-themed">
                  <div class="truncate" :title="record.campaignName">{{ record.campaignName }}</div>
                </td>
                <td class="px-5 py-3 text-themed-muted">
                  <div class="truncate" :title="`${record.packageName} / ${record.planName}`">{{ record.packageName }} / {{ record.planName }}</div>
                </td>
                <td class="px-5 py-3 text-themed whitespace-nowrap">¥{{ record.amount.toFixed(2) }}</td>
                <td class="px-5 py-3 text-themed-muted">
                  <div class="truncate" :title="record.status">{{ record.status }}</div>
                </td>
                <td class="px-5 py-3 text-themed-muted whitespace-nowrap">{{ formatDate(record.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
