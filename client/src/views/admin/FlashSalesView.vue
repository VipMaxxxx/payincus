<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api/admin'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import type { FlashSaleCampaign, FlashSaleCampaignStatus, FlashSaleReservation, Package } from '@/types/api'

const toast = useToast()

interface FlashSaleFormItem {
  packagePlanId: number | null
  flashPrice: number
  totalStock: number
  perUserLimit: number
  allowCoupon: boolean
  allowAff: boolean
}

const loading = ref(true)
const saving = ref(false)
const campaigns = ref<FlashSaleCampaign[]>([])
const packages = ref<Package[]>([])
const plans = ref<Array<{ id: number; name: string; price: number; cpu: number; memory: number; disk: number; isActive: boolean; isSoldOut: boolean }>>([])
const selectedCampaignId = ref<number | null>(null)
const reservations = ref<FlashSaleReservation[]>([])
const reservationsLoading = ref(false)

const form = ref({
  name: '',
  description: '',
  status: 'draft' as FlashSaleCampaignStatus,
  startAt: '',
  endAt: '',
  packageId: null as number | null,
  items: [] as FlashSaleFormItem[],
  requireTurnstile: true,
  minAccountAgeHours: 0,
  requireEmail: false,
  blockRiskRestricted: true,
  notes: ''
})

const selectedCampaign = computed(() => campaigns.value.find(campaign => campaign.id === selectedCampaignId.value) || null)
const totalStock = computed(() => campaigns.value.reduce((sum, campaign) => sum + campaign.items.reduce((inner, item) => inner + item.totalStock, 0), 0))
const soldCount = computed(() => campaigns.value.reduce((sum, campaign) => sum + campaign.items.reduce((inner, item) => inner + item.soldCount, 0), 0))
const deliveredCount = computed(() => campaigns.value.reduce((sum, campaign) => sum + campaign.items.reduce((inner, item) => inner + item.deliveredCount, 0), 0))

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatMoneyCents(cents: number): string {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}

function statusClass(status: FlashSaleCampaignStatus): string {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700'
  if (status === 'paused') return 'bg-amber-100 text-amber-700'
  if (status === 'ended' || status === 'cancelled') return 'bg-gray-100 text-gray-600'
  return 'bg-blue-100 text-blue-700'
}

function defaultFlashSaleItem(): FlashSaleFormItem {
  return {
    packagePlanId: plans.value[0]?.id ?? null,
    flashPrice: 0,
    totalStock: 10,
    perUserLimit: 1,
    allowCoupon: false,
    allowAff: false
  }
}

function resetForm(): void {
  const start = new Date(Date.now() + 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  form.value = {
    name: '',
    description: '',
    status: 'draft',
    startAt: toLocalInputValue(start),
    endAt: toLocalInputValue(end),
    packageId: packages.value[0]?.id ?? null,
    items: [defaultFlashSaleItem()],
    requireTurnstile: true,
    minAccountAgeHours: 0,
    requireEmail: false,
    blockRiskRestricted: true,
    notes: ''
  }
}

async function loadCampaigns(): Promise<void> {
  const response = await api.flashSales.list({ page: 1, pageSize: 100 })
  campaigns.value = response.campaigns || []
  if (!selectedCampaignId.value && campaigns.value.length > 0) {
    selectedCampaignId.value = campaigns.value[0].id
  }
}

async function loadPackages(): Promise<void> {
  const response = await api.packages.list({ all: true })
  packages.value = response.packages || []
  if (!form.value.packageId && packages.value.length > 0) {
    form.value.packageId = packages.value[0].id
  }
}

async function loadPlans(packageId: number | null): Promise<void> {
  if (!packageId) {
    plans.value = []
    form.value.items = form.value.items.map(item => ({ ...item, packagePlanId: null }))
    return
  }
  const response = await api.packages.getPlans(packageId)
  plans.value = response.plans || []
  if (form.value.items.length === 0) {
    form.value.items = [defaultFlashSaleItem()]
    return
  }
  form.value.items = form.value.items.map(item => ({
    ...item,
    packagePlanId: plans.value.some(plan => plan.id === item.packagePlanId)
      ? item.packagePlanId
      : plans.value[0]?.id ?? null
  }))
}

async function loadAll(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([loadPackages(), loadCampaigns()])
    await loadPlans(form.value.packageId)
  } catch (err: any) {
    toast.error(`加载秒杀管理失败：${err?.message || String(err)}`)
  } finally {
    loading.value = false
  }
}

async function createCampaign(): Promise<void> {
  const validItems = form.value.items.filter(item => item.packagePlanId)
  if (!form.value.name.trim() || !form.value.startAt || !form.value.endAt || validItems.length === 0) {
    toast.warning('请填写活动名称、时间和至少一个秒杀商品')
    return
  }
  const invalidItem = validItems.some(item =>
    item.flashPrice < 0 ||
    item.totalStock < 1 ||
    item.perUserLimit < 1
  )
  if (invalidItem) {
    toast.warning('秒杀商品的价格、库存和限购配置无效')
    return
  }
  const duplicatePlan = new Set(validItems.map(item => item.packagePlanId)).size !== validItems.length
  if (duplicatePlan) {
    toast.warning('同一活动中不能重复添加相同方案')
    return
  }

  saving.value = true
  try {
    const campaignMaxPerUser = Math.max(1, ...validItems.map(item => Number(item.perUserLimit || 1)))
    const response = await api.flashSales.create({
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      status: form.value.status,
      startAt: new Date(form.value.startAt).toISOString(),
      endAt: new Date(form.value.endAt).toISOString(),
      requireTurnstile: form.value.requireTurnstile,
      minAccountAgeHours: Number(form.value.minAccountAgeHours || 0),
      requireEmail: form.value.requireEmail,
      blockRiskRestricted: form.value.blockRiskRestricted,
      maxPerUser: campaignMaxPerUser,
      notes: form.value.notes.trim() || null,
      items: validItems.map((item, index) => ({
        packagePlanId: item.packagePlanId!,
        flashPrice: Math.round(Number(item.flashPrice) * 100),
        totalStock: Number(item.totalStock),
        perUserLimit: Number(item.perUserLimit),
        allowCoupon: item.allowCoupon,
        allowAff: item.allowAff,
        sortOrder: index
      }))
    })
    toast.success('秒杀活动已创建')
    selectedCampaignId.value = response.campaign.id
    resetForm()
    await loadCampaigns()
  } catch (err: any) {
    toast.error(err?.message || '创建秒杀活动失败')
  } finally {
    saving.value = false
  }
}

function addFlashSaleItem(): void {
  form.value.items.push(defaultFlashSaleItem())
}

function removeFlashSaleItem(index: number): void {
  if (form.value.items.length <= 1) {
    toast.warning('至少保留一个秒杀商品')
    return
  }
  form.value.items.splice(index, 1)
}

async function changeStatus(campaign: FlashSaleCampaign, status: FlashSaleCampaignStatus): Promise<void> {
  try {
    await api.flashSales.setStatus(campaign.id, status)
    toast.success('活动状态已更新')
    await loadCampaigns()
  } catch (err: any) {
    toast.error(err?.message || '更新状态失败')
  }
}

async function adjustStock(itemId: number, currentStock: number): Promise<void> {
  const input = prompt('请输入新的总库存', String(currentStock))
  if (input === null) return
  const next = Number(input)
  if (!Number.isInteger(next) || next < 0) {
    toast.warning('库存必须是非负整数')
    return
  }
  try {
    await api.flashSales.adjustStock(itemId, next, '后台调整秒杀库存')
    toast.success('库存已更新')
    await loadCampaigns()
  } catch (err: any) {
    toast.error(err?.message || '调整库存失败')
  }
}

async function loadReservations(campaignId: number): Promise<void> {
  selectedCampaignId.value = campaignId
  reservationsLoading.value = true
  try {
    const response = await api.flashSales.reservations(campaignId, { page: 1, pageSize: 50 })
    reservations.value = response.reservations || []
  } catch (err: any) {
    toast.error(err?.message || '加载抢购记录失败')
  } finally {
    reservationsLoading.value = false
  }
}

watch(() => form.value.packageId, (packageId) => {
  void loadPlans(packageId)
})

onMounted(async () => {
  resetForm()
  await loadAll()
})
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">秒杀管理</h1>
        <p class="page-description">配置限时活动价、库存、限购、人机验证和风险账号拦截。</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadAll">刷新</button>
    </div>

    <SkeletonLoader v-if="loading" type="card" :count="4" />

    <template v-else>
      <section class="grid gap-4 md:grid-cols-3">
        <div class="card p-4">
          <div class="text-sm text-themed-muted">活动总库存</div>
          <div class="mt-2 text-2xl font-semibold text-themed">{{ totalStock }}</div>
        </div>
        <div class="card p-4">
          <div class="text-sm text-themed-muted">已售名额</div>
          <div class="mt-2 text-2xl font-semibold text-orange-500">{{ soldCount }}</div>
        </div>
        <div class="card p-4">
          <div class="text-sm text-themed-muted">已交付</div>
          <div class="mt-2 text-2xl font-semibold text-emerald-500">{{ deliveredCount }}</div>
        </div>
      </section>

      <section class="mt-6 rounded-lg border border-themed bg-themed-surface p-5">
        <h2 class="text-lg font-semibold text-themed">创建秒杀活动</h2>
        <div class="mt-4 grid gap-4 lg:grid-cols-4">
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">活动名称</span>
            <input v-model="form.name" class="input" placeholder="例如：香港入门款限时秒杀" />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">开始时间</span>
            <input v-model="form.startAt" type="datetime-local" class="input" />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">结束时间</span>
            <input v-model="form.endAt" type="datetime-local" class="input" />
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">初始状态</span>
            <select v-model="form.status" class="input">
              <option value="draft">草稿</option>
              <option value="scheduled">待开始</option>
              <option value="active">立即开始</option>
              <option value="paused">暂停</option>
            </select>
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">套餐</span>
            <select v-model.number="form.packageId" class="input">
              <option v-for="pkg in packages" :key="pkg.id" :value="pkg.id">{{ pkg.name }}</option>
            </select>
          </label>
          <label class="space-y-1">
            <span class="text-sm text-themed-muted">账号最小时长（小时）</span>
            <input v-model.number="form.minAccountAgeHours" type="number" min="0" step="1" class="input" />
          </label>
          <label class="flex items-center gap-2 pt-7 text-sm text-themed">
            <input v-model="form.requireTurnstile" type="checkbox" />
            强制人机验证
          </label>
          <label class="flex items-center gap-2 pt-7 text-sm text-themed">
            <input v-model="form.blockRiskRestricted" type="checkbox" />
            拦截风控限单账号
          </label>
          <label class="flex items-center gap-2 text-sm text-themed">
            <input v-model="form.requireEmail" type="checkbox" />
            必须绑定邮箱
          </label>
        </div>
        <div class="mt-5 rounded-lg border border-themed">
          <div class="flex items-center justify-between border-b border-themed px-4 py-3">
            <div>
              <h3 class="font-medium text-themed">秒杀商品</h3>
              <p class="mt-1 text-xs text-themed-muted">同一活动可配置多个方案；库存、限购和优惠/AFF 策略按商品独立生效。</p>
            </div>
            <button class="btn-secondary" type="button" @click="addFlashSaleItem">新增商品</button>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-themed text-sm">
              <thead class="text-left text-xs text-themed-muted">
                <tr>
                  <th class="px-4 py-3">方案</th>
                  <th class="px-4 py-3">秒杀价（元）</th>
                  <th class="px-4 py-3">库存</th>
                  <th class="px-4 py-3">每人限购</th>
                  <th class="px-4 py-3">优惠</th>
                  <th class="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-themed">
                <tr v-for="(item, index) in form.items" :key="index">
                  <td class="px-4 py-3">
                    <select v-model.number="item.packagePlanId" class="input min-w-56">
                      <option v-for="plan in plans" :key="plan.id" :value="plan.id">
                        {{ plan.name }} / {{ formatMoneyCents(plan.price) }}
                      </option>
                    </select>
                  </td>
                  <td class="px-4 py-3">
                    <input v-model.number="item.flashPrice" type="number" min="0" step="0.01" class="input w-32" />
                  </td>
                  <td class="px-4 py-3">
                    <input v-model.number="item.totalStock" type="number" min="1" step="1" class="input w-28" />
                  </td>
                  <td class="px-4 py-3">
                    <input v-model.number="item.perUserLimit" type="number" min="1" step="1" class="input w-28" />
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex flex-col gap-2">
                      <label class="inline-flex items-center gap-2 text-xs text-themed">
                        <input v-model="item.allowCoupon" type="checkbox" />
                        优惠码
                      </label>
                      <label class="inline-flex items-center gap-2 text-xs text-themed">
                        <input v-model="item.allowAff" type="checkbox" />
                        AFF 返利
                      </label>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button class="btn-secondary" type="button" @click="removeFlashSaleItem(index)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <textarea v-model="form.description" class="input mt-4 min-h-20" placeholder="活动说明，可选" />
        <div class="mt-4 flex justify-end">
          <button class="btn-primary" :disabled="saving" @click="createCampaign">{{ saving ? '创建中...' : '创建活动' }}</button>
        </div>
      </section>

      <section class="mt-6 rounded-lg border border-themed bg-themed-surface">
        <div class="border-b border-themed px-5 py-4">
          <h2 class="text-lg font-semibold text-themed">活动列表</h2>
        </div>
        <div class="divide-y divide-themed">
          <div v-if="campaigns.length === 0" class="px-5 py-8 text-center text-themed-muted">暂无活动</div>
          <article v-for="campaign in campaigns" :key="campaign.id" class="px-5 py-4">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="font-semibold text-themed">{{ campaign.name }}</h3>
                  <span class="rounded-full px-2 py-0.5 text-xs" :class="statusClass(campaign.status)">{{ campaign.status }}</span>
                </div>
                <p class="mt-1 text-sm text-themed-muted">{{ formatDate(campaign.startAt) }} - {{ formatDate(campaign.endAt) }}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button class="btn-secondary" @click="changeStatus(campaign, 'active')">开始/恢复</button>
                <button class="btn-secondary" @click="changeStatus(campaign, 'paused')">暂停</button>
                <button class="btn-secondary" @click="changeStatus(campaign, 'ended')">结束</button>
                <button class="btn-secondary" @click="loadReservations(campaign.id)">记录</button>
              </div>
            </div>
            <div class="mt-4 grid gap-3 lg:grid-cols-2">
              <div v-for="item in campaign.items" :key="item.id" class="rounded-lg border border-themed bg-themed p-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="font-medium text-themed">{{ item.plan.package.name }} / {{ item.plan.name }}</div>
                    <div class="mt-1 text-xs text-themed-muted">库存 {{ item.remainingStock }} / {{ item.totalStock }}，已售 {{ item.soldCount }}，失败 {{ item.failedCount }}</div>
                  </div>
                  <div class="text-right">
                    <div class="font-semibold text-orange-500">{{ formatMoneyCents(item.flashPrice) }}</div>
                    <button class="mt-2 text-xs text-blue-500" @click="adjustStock(item.id, item.totalStock)">调整库存</button>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section v-if="selectedCampaign" class="mt-6 rounded-lg border border-themed bg-themed-surface">
        <div class="flex items-center justify-between border-b border-themed px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold text-themed">抢购记录：{{ selectedCampaign.name }}</h2>
            <p class="mt-1 text-sm text-themed-muted">最近 50 条记录。</p>
          </div>
          <button class="btn-secondary" :disabled="reservationsLoading" @click="loadReservations(selectedCampaign.id)">刷新记录</button>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-themed text-sm">
            <thead class="text-left text-xs text-themed-muted">
              <tr>
                <th class="px-5 py-3">用户</th>
                <th class="px-5 py-3">套餐</th>
                <th class="px-5 py-3">实例</th>
                <th class="px-5 py-3">金额</th>
                <th class="px-5 py-3">状态</th>
                <th class="px-5 py-3">时间</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed">
              <tr v-if="reservations.length === 0">
                <td colspan="6" class="px-5 py-8 text-center text-themed-muted">暂无记录</td>
              </tr>
              <tr v-for="record in reservations" :key="record.id">
                <td class="px-5 py-3 text-themed">{{ record.user?.username || `UID ${record.userId}` }}</td>
                <td class="px-5 py-3 text-themed-muted">{{ record.packageName }} / {{ record.planName }}</td>
                <td class="px-5 py-3 text-themed-muted">{{ record.instance?.name || '-' }}</td>
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
