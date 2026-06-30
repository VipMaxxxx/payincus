<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import type { FlashSaleCampaign, FlashSaleItem, FlashSaleReservation } from '@/types/api'

const router = useRouter()
const toast = useToast()

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
  return new Date(value).toLocaleString('zh-CN')
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
  if (campaign.effectiveStatus === 'scheduled') return { label: '未开始', disabled: true }
  if (campaign.effectiveStatus === 'paused') return { label: '已暂停', disabled: true }
  if (campaign.effectiveStatus !== 'active') return { label: '已结束', disabled: true }
  if (item.remainingStock <= 0) return { label: '已抢完', disabled: true }
  if (!item.plan.isActive || item.plan.isSoldOut) return { label: '方案不可用', disabled: true }
  return { label: '立即抢购', disabled: false }
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
    toast.error(`加载秒杀活动失败：${err?.message || String(err)}`)
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
    toast.error(`加载抢购记录失败：${err?.message || String(err)}`)
  } finally {
    reservationsLoading.value = false
  }
}

function buy(item: FlashSaleItem): void {
  void router.push({
    path: '/instances/create',
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
        <h1 class="page-title">秒杀</h1>
        <p class="page-description">限时活动套餐，库存和交付以实时资源校验为准。</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadData">刷新</button>
    </div>

    <SkeletonLoader v-if="loading" type="card" :count="4" />

    <template v-else>
      <section v-if="activeCampaigns.length === 0 && upcomingCampaigns.length === 0 && pausedCampaigns.length === 0" class="card p-10 text-center">
        <div class="text-lg font-semibold text-themed">暂无秒杀活动</div>
        <p class="mt-2 text-sm text-themed-muted">有新活动时会在这里展示。</p>
      </section>

      <section v-for="campaign in [...activeCampaigns, ...upcomingCampaigns, ...pausedCampaigns]" :key="campaign.id" class="mb-6 rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-wrap items-start justify-between gap-4 border-b border-themed px-5 py-4">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg font-semibold text-themed">{{ campaign.name }}</h2>
              <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="campaign.effectiveStatus === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'">
                {{ campaign.effectiveStatus === 'active' ? '进行中' : campaign.effectiveStatus === 'scheduled' ? '即将开始' : '已暂停' }}
              </span>
            </div>
            <p v-if="campaign.description" class="mt-1 text-sm text-themed-muted">{{ campaign.description }}</p>
            <p class="mt-2 text-xs text-themed-muted">{{ formatDate(campaign.startAt) }} - {{ formatDate(campaign.endAt) }}</p>
          </div>
          <div class="text-sm text-themed-muted">每人限购 {{ campaign.maxPerUser }} 台</div>
        </div>

        <div class="grid gap-4 p-5 lg:grid-cols-2">
          <article v-for="item in campaign.items" :key="item.id" class="rounded-lg border border-themed bg-themed p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-base font-semibold text-themed">{{ item.plan.package.name }} / {{ item.plan.name }}</h3>
                <p class="mt-1 text-sm text-themed-muted">
                  {{ item.plan.cpu }}% 核 {{ formatMemory(item.plan.memory) }} {{ formatDisk(item.plan.disk) }}
                </p>
              </div>
              <div class="text-right">
                <div class="text-xl font-semibold text-orange-500">{{ formatMoneyCents(item.flashPrice) }}</div>
                <div class="text-xs text-themed-muted line-through">{{ formatMoneyCents(item.originalPriceSnapshot) }}</div>
              </div>
            </div>

            <div class="mt-4">
              <div class="mb-1 flex items-center justify-between text-xs text-themed-muted">
                <span>库存 {{ item.remainingStock }} / {{ item.totalStock }}</span>
                <span>已售 {{ stockPercent(item) }}%</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-themed-muted">
                <div class="h-full rounded-full bg-orange-500" :style="{ width: `${stockPercent(item)}%` }" />
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
            <h2 class="text-lg font-semibold text-themed">我的抢购记录</h2>
            <p class="mt-1 text-sm text-themed-muted">显示最近 20 条秒杀购买和交付结果。</p>
          </div>
          <button class="btn-secondary" :disabled="reservationsLoading" @click="loadReservations">刷新记录</button>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-themed">
            <thead>
              <tr class="text-left text-xs text-themed-muted">
                <th class="px-5 py-3">活动</th>
                <th class="px-5 py-3">套餐</th>
                <th class="px-5 py-3">金额</th>
                <th class="px-5 py-3">状态</th>
                <th class="px-5 py-3">时间</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed text-sm">
              <tr v-if="reservations.length === 0">
                <td colspan="5" class="px-5 py-8 text-center text-themed-muted">暂无抢购记录</td>
              </tr>
              <tr v-for="record in reservations" :key="record.id">
                <td class="px-5 py-3 text-themed">{{ record.campaignName }}</td>
                <td class="px-5 py-3 text-themed-muted">{{ record.packageName }} / {{ record.planName }}</td>
                <td class="px-5 py-3 text-orange-500">¥{{ record.amount.toFixed(2) }}</td>
                <td class="px-5 py-3 text-themed-muted">{{ record.status }}</td>
                <td class="px-5 py-3 text-themed-muted">{{ formatDate(record.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
