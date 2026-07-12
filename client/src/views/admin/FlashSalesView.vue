<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api/admin'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import type { FlashSaleCampaign, FlashSaleCampaignStatus, FlashSaleItem, FlashSaleReservation, Package } from '@/types/api'

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
const editingCampaignId = ref<number | null>(null)
const editingItemId = ref<number | null>(null)
const editSaving = ref(false)

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
const timeForm = ref({
  name: '',
  description: '',
  startAt: '',
  endAt: '',
  requireTurnstile: true,
  minAccountAgeHours: 0,
  requireEmail: false,
  blockRiskRestricted: true,
  maxPerUser: 1,
  notes: ''
})
const itemForm = ref({
  flashPrice: 0,
  totalStock: 0,
  perUserLimit: 1,
  allowCoupon: false,
  allowAff: false
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

function isValidFlashPrice(flashPriceYuan: number, originalPriceCents: number): boolean {
  const flashPriceCents = Math.round(Number(flashPriceYuan) * 100)
  return Number.isFinite(flashPriceYuan) && flashPriceCents > 0 && flashPriceCents < Number(originalPriceCents)
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}

function statusClass(status: FlashSaleCampaignStatus): string {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  if (status === 'paused') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
  if (status === 'ended' || status === 'cancelled') return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
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
    !isValidFlashPrice(item.flashPrice, plans.value.find(plan => plan.id === item.packagePlanId)?.price ?? 0) ||
    item.totalStock < 1 ||
    item.perUserLimit < 1
  )
  if (invalidItem) {
    toast.warning('秒杀价必须大于 0 且低于方案原价，库存和限购也必须有效')
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

function beginEditCampaign(campaign: FlashSaleCampaign): void {
  editingCampaignId.value = campaign.id
  timeForm.value = {
    name: campaign.name,
    description: campaign.description || '',
    startAt: toLocalInputValue(new Date(campaign.startAt)),
    endAt: toLocalInputValue(new Date(campaign.endAt)),
    requireTurnstile: campaign.requireTurnstile,
    minAccountAgeHours: campaign.minAccountAgeHours,
    requireEmail: campaign.requireEmail,
    blockRiskRestricted: campaign.blockRiskRestricted,
    maxPerUser: campaign.maxPerUser,
    notes: campaign.notes || ''
  }
}

function cancelEditCampaign(): void {
  editingCampaignId.value = null
  timeForm.value = {
    name: '',
    description: '',
    startAt: '',
    endAt: '',
    requireTurnstile: true,
    minAccountAgeHours: 0,
    requireEmail: false,
    blockRiskRestricted: true,
    maxPerUser: 1,
    notes: ''
  }
}

async function saveCampaignContent(campaign: FlashSaleCampaign): Promise<void> {
  if (!timeForm.value.name.trim() || !timeForm.value.startAt || !timeForm.value.endAt) {
    toast.warning('请填写活动名称、开始时间和结束时间')
    return
  }
  const startAt = new Date(timeForm.value.startAt)
  const endAt = new Date(timeForm.value.endAt)
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
    toast.warning('活动时间格式无效')
    return
  }
  if (endAt <= startAt) {
    toast.warning('结束时间必须晚于开始时间')
    return
  }
  if (!Number.isInteger(Number(timeForm.value.minAccountAgeHours)) || Number(timeForm.value.minAccountAgeHours) < 0) {
    toast.warning('账号最小时长不能小于 0')
    return
  }
  if (!Number.isInteger(Number(timeForm.value.maxPerUser)) || Number(timeForm.value.maxPerUser) < 1) {
    toast.warning('活动总限购必须大于 0')
    return
  }

  editSaving.value = true
  try {
    await api.flashSales.update(campaign.id, {
      name: timeForm.value.name.trim(),
      description: timeForm.value.description.trim() || null,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      requireTurnstile: timeForm.value.requireTurnstile,
      minAccountAgeHours: Number(timeForm.value.minAccountAgeHours),
      requireEmail: timeForm.value.requireEmail,
      blockRiskRestricted: timeForm.value.blockRiskRestricted,
      maxPerUser: Number(timeForm.value.maxPerUser),
      notes: timeForm.value.notes.trim() || null
    })
    toast.success('活动内容已更新')
    cancelEditCampaign()
    await loadCampaigns()
  } catch (err: any) {
    toast.error(err?.message || '更新活动内容失败')
  } finally {
    editSaving.value = false
  }
}

function beginEditItem(item: FlashSaleItem): void {
  editingItemId.value = item.id
  itemForm.value = {
    flashPrice: Number((item.flashPrice / 100).toFixed(2)),
    totalStock: item.totalStock,
    perUserLimit: item.perUserLimit,
    allowCoupon: item.allowCoupon,
    allowAff: item.allowAff
  }
}

function cancelEditItem(): void {
  editingItemId.value = null
  itemForm.value = {
    flashPrice: 0,
    totalStock: 0,
    perUserLimit: 1,
    allowCoupon: false,
    allowAff: false
  }
}

async function saveItemContent(item: FlashSaleItem): Promise<void> {
  if (!isValidFlashPrice(itemForm.value.flashPrice, item.originalPriceSnapshot) || !Number.isInteger(Number(itemForm.value.totalStock)) || itemForm.value.totalStock < 0 || !Number.isInteger(Number(itemForm.value.perUserLimit)) || itemForm.value.perUserLimit < 1) {
    toast.warning('秒杀价必须大于 0 且低于原价，库存和限购也必须有效')
    return
  }
  if (itemForm.value.totalStock < item.soldCount + item.reservedCount) {
    toast.warning('库存不能小于已售和锁定数量')
    return
  }

  editSaving.value = true
  try {
    await api.flashSales.updateItem(item.id, {
      flashPrice: Math.round(Number(itemForm.value.flashPrice) * 100),
      totalStock: Number(itemForm.value.totalStock),
      perUserLimit: Number(itemForm.value.perUserLimit),
      allowCoupon: itemForm.value.allowCoupon,
      allowAff: itemForm.value.allowAff,
      reason: '后台编辑秒杀商品'
    })
    toast.success('秒杀商品已更新')
    cancelEditItem()
    await loadCampaigns()
  } catch (err: any) {
    toast.error(err?.message || '更新秒杀商品失败')
  } finally {
    editSaving.value = false
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
  <div class="kawaii-page page-container animate-fade-in">
    <div class="page-header">
      <div class="flex items-center gap-3">
        <span class="nimbus-title-icon">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </span>
        <div>
          <h1 class="page-title">秒杀管理</h1>
          <p class="page-description">配置限时活动价、库存、限购、人机验证和风险账号拦截。</p>
        </div>
      </div>
      <button class="btn btn-secondary" :disabled="loading" @click="loadAll">
        <svg class="h-4 w-4" :class="{ 'animate-spin': loading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 4v5h.58m15.36 2A8 8 0 0 0 5.07 8.11M20 20v-5h-.58m0 0A8 8 0 0 1 4.06 12.03" />
        </svg>
        刷新
      </button>
    </div>

    <SkeletonLoader v-if="loading" type="card" :count="4" />

    <template v-else>
      <section class="grid gap-4 md:grid-cols-3">
        <div class="card nimbus-stat p-4">
          <div class="nimbus-stat-label">活动总库存</div>
          <div class="nimbus-stat-value">{{ totalStock }}</div>
        </div>
        <div class="card nimbus-stat p-4">
          <div class="nimbus-stat-label">已售名额</div>
          <div class="nimbus-stat-value">{{ soldCount }}</div>
        </div>
        <div class="card nimbus-stat p-4">
          <div class="nimbus-stat-label">已交付</div>
          <div class="nimbus-stat-value">{{ deliveredCount }}</div>
        </div>
      </section>

      <section class="card mt-6 p-6">
        <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
          <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <h2 class="text-base font-semibold text-themed">创建秒杀活动</h2>
        </div>
        <div class="grid gap-4 lg:grid-cols-4">
          <label class="space-y-1.5">
            <span class="nimbus-field-label">活动名称</span>
            <input v-model="form.name" class="input" placeholder="例如：香港入门款限时秒杀" />
          </label>
          <label class="space-y-1.5">
            <span class="nimbus-field-label">开始时间</span>
            <input v-model="form.startAt" type="datetime-local" class="input" />
          </label>
          <label class="space-y-1.5">
            <span class="nimbus-field-label">结束时间</span>
            <input v-model="form.endAt" type="datetime-local" class="input" />
          </label>
          <label class="space-y-1.5">
            <span class="nimbus-field-label">初始状态</span>
            <select v-model="form.status" class="input">
              <option value="draft">草稿</option>
              <option value="scheduled">待开始</option>
              <option value="active">立即开始</option>
              <option value="paused">暂停</option>
            </select>
          </label>
          <label class="space-y-1.5">
            <span class="nimbus-field-label">套餐</span>
            <select v-model.number="form.packageId" class="input">
              <option v-for="pkg in packages" :key="pkg.id" :value="pkg.id">{{ pkg.name }}</option>
            </select>
          </label>
          <label class="space-y-1.5">
            <span class="nimbus-field-label">账号最小时长（小时）</span>
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
            <div class="flex items-center gap-2">
              <svg class="h-4 w-4 shrink-0 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3.75 5.25h16.5m-16.5 6h16.5m-16.5 6h16.5" />
              </svg>
              <div>
                <h3 class="font-medium text-themed">秒杀商品</h3>
                <p class="mt-1 text-xs text-themed-muted">同一活动可配置多个方案；库存、限购和优惠/AFF 策略按商品独立生效。</p>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" type="button" @click="addFlashSaleItem">新增商品</button>
          </div>
          <div class="space-y-3 p-4 lg:hidden">
            <div
              v-for="(item, index) in form.items"
              :key="index"
              class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="text-sm font-medium text-themed">商品 #{{ index + 1 }}</div>
                <button class="btn btn-secondary btn-sm" type="button" @click="removeFlashSaleItem(index)">删除</button>
              </div>
              <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="space-y-1 sm:col-span-2">
                  <span class="nimbus-field-label">方案</span>
                  <select v-model.number="item.packagePlanId" class="input w-full">
                    <option v-for="plan in plans" :key="plan.id" :value="plan.id">
                      {{ plan.name }} / {{ formatMoneyCents(plan.price) }}
                    </option>
                  </select>
                </label>
                <label class="space-y-1">
                  <span class="nimbus-field-label">秒杀价（元）</span>
                  <input v-model.number="item.flashPrice" type="number" min="0.01" step="0.01" class="input w-full" />
                </label>
                <label class="space-y-1">
                  <span class="nimbus-field-label">库存</span>
                  <input v-model.number="item.totalStock" type="number" min="1" step="1" class="input w-full" />
                </label>
                <label class="space-y-1">
                  <span class="nimbus-field-label">每人限购</span>
                  <input v-model.number="item.perUserLimit" type="number" min="1" step="1" class="input w-full" />
                </label>
                <div class="flex flex-wrap items-center gap-4 pt-6">
                  <label class="inline-flex items-center gap-2 text-xs text-themed">
                    <input v-model="item.allowCoupon" type="checkbox" />
                    优惠码
                  </label>
                  <label class="inline-flex items-center gap-2 text-xs text-themed">
                    <input v-model="item.allowAff" type="checkbox" />
                    AFF 返利
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div class="hidden overflow-hidden lg:block">
            <table class="w-full table-fixed text-sm">
              <thead>
                <tr class="border-b border-themed">
                  <th class="nimbus-th w-[32%]">方案</th>
                  <th class="nimbus-th w-[14%]">秒杀价（元）</th>
                  <th class="nimbus-th w-[12%]">库存</th>
                  <th class="nimbus-th w-[12%]">每人限购</th>
                  <th class="nimbus-th w-[16%]">优惠</th>
                  <th class="nimbus-th w-[14%] text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, index) in form.items" :key="index" class="nimbus-row border-b border-themed">
                  <td class="px-4 py-3">
                    <select v-model.number="item.packagePlanId" class="input w-full">
                      <option v-for="plan in plans" :key="plan.id" :value="plan.id">
                        {{ plan.name }} / {{ formatMoneyCents(plan.price) }}
                      </option>
                    </select>
                  </td>
                  <td class="px-4 py-3">
                    <input v-model.number="item.flashPrice" type="number" min="0.01" step="0.01" class="input w-full" />
                  </td>
                  <td class="px-4 py-3">
                    <input v-model.number="item.totalStock" type="number" min="1" step="1" class="input w-full" />
                  </td>
                  <td class="px-4 py-3">
                    <input v-model.number="item.perUserLimit" type="number" min="1" step="1" class="input w-full" />
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
                    <button class="btn btn-secondary btn-sm" type="button" @click="removeFlashSaleItem(index)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <textarea v-model="form.description" class="input mt-4 min-h-20" placeholder="活动说明，可选" />
        <div class="mt-4 flex justify-end">
          <button class="btn btn-primary" :disabled="saving" @click="createCampaign">{{ saving ? '创建中...' : '创建活动' }}</button>
        </div>
      </section>

      <section class="card mt-6 overflow-hidden">
        <div class="flex items-center gap-2 border-b border-themed px-5 py-4">
          <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.008v.008H3.75V6.75Zm0 5.25h.008v.008H3.75V12Zm0 5.25h.008v.008H3.75v-.008Z" />
          </svg>
          <h2 class="text-base font-semibold text-themed">活动列表</h2>
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
                <button class="btn btn-secondary btn-sm" @click="beginEditCampaign(campaign)">编辑内容</button>
                <button class="btn btn-secondary btn-sm" @click="changeStatus(campaign, 'active')">开始/恢复</button>
                <button class="btn btn-secondary btn-sm" @click="changeStatus(campaign, 'paused')">暂停</button>
                <button class="btn btn-secondary btn-sm" @click="changeStatus(campaign, 'ended')">结束</button>
                <button class="btn btn-secondary btn-sm" @click="loadReservations(campaign.id)">记录</button>
              </div>
            </div>
            <div v-if="editingCampaignId === campaign.id" class="mt-4 rounded-lg border border-themed bg-themed p-4">
              <div class="grid gap-4 lg:grid-cols-4">
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">活动名称</span>
                  <input v-model="timeForm.name" class="input" />
                </label>
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">开始时间</span>
                  <input v-model="timeForm.startAt" type="datetime-local" class="input" />
                </label>
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">结束时间</span>
                  <input v-model="timeForm.endAt" type="datetime-local" class="input" />
                </label>
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">活动总限购</span>
                  <input v-model.number="timeForm.maxPerUser" type="number" min="1" step="1" class="input" />
                </label>
                <label class="space-y-1.5">
                  <span class="nimbus-field-label">账号最小时长（小时）</span>
                  <input v-model.number="timeForm.minAccountAgeHours" type="number" min="0" step="1" class="input" />
                </label>
                <label class="flex items-center gap-2 pt-7 text-sm text-themed">
                  <input v-model="timeForm.requireTurnstile" type="checkbox" />
                  强制人机验证
                </label>
                <label class="flex items-center gap-2 pt-7 text-sm text-themed">
                  <input v-model="timeForm.requireEmail" type="checkbox" />
                  必须绑定邮箱
                </label>
                <label class="flex items-center gap-2 pt-7 text-sm text-themed">
                  <input v-model="timeForm.blockRiskRestricted" type="checkbox" />
                  拦截风控限单
                </label>
              </div>
              <textarea v-model="timeForm.description" class="input mt-4 min-h-20" placeholder="活动说明，可选" />
              <textarea v-model="timeForm.notes" class="input mt-3 min-h-16" placeholder="内部备注，可选" />
              <div class="mt-4 flex justify-end gap-2">
                <button class="btn btn-primary" :disabled="editSaving" @click="saveCampaignContent(campaign)">
                  {{ editSaving ? '保存中...' : '保存内容' }}
                </button>
                <button class="btn btn-secondary" :disabled="editSaving" @click="cancelEditCampaign">取消</button>
              </div>
              <p class="mt-2 text-xs text-themed-muted">已开始的活动可以修改内容和时间；已有订单记录不回改，后续购买按新配置执行。</p>
            </div>
            <div class="mt-4 grid gap-3 lg:grid-cols-2">
              <div v-for="item in campaign.items" :key="item.id" class="rounded-lg border border-themed bg-themed p-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="font-medium text-themed">{{ item.plan.package.name }} / {{ item.plan.name }}</div>
                    <div class="mt-1 text-xs text-themed-muted">库存 {{ item.remainingStock }} / {{ item.totalStock }}，已售 {{ item.soldCount }}，失败 {{ item.failedCount }}，限购 {{ item.perUserLimit }}</div>
                  </div>
                  <div class="text-right">
                    <div class="font-semibold tabular-nums text-themed">{{ formatMoneyCents(item.flashPrice) }}</div>
                    <button class="mt-2 text-xs font-medium text-primary-600 hover:underline dark:text-primary-400" @click="beginEditItem(item)">编辑商品</button>
                  </div>
                </div>
                <div v-if="editingItemId === item.id" class="mt-4 rounded-lg border border-themed bg-themed-surface p-3">
                  <div class="grid gap-3 md:grid-cols-3">
                    <label class="space-y-1">
                      <span class="nimbus-field-label">秒杀价（元）</span>
                      <input v-model.number="itemForm.flashPrice" type="number" min="0.01" :max="Math.max(0.01, item.originalPriceSnapshot / 100 - 0.01)" step="0.01" class="input" />
                    </label>
                    <label class="space-y-1">
                      <span class="nimbus-field-label">总库存</span>
                      <input v-model.number="itemForm.totalStock" type="number" min="0" step="1" class="input" />
                    </label>
                    <label class="space-y-1">
                      <span class="nimbus-field-label">每人限购</span>
                      <input v-model.number="itemForm.perUserLimit" type="number" min="1" step="1" class="input" />
                    </label>
                  </div>
                  <div class="mt-3 flex flex-wrap items-center gap-4 text-sm text-themed">
                    <label class="inline-flex items-center gap-2">
                      <input v-model="itemForm.allowCoupon" type="checkbox" />
                      允许优惠码
                    </label>
                    <label class="inline-flex items-center gap-2">
                      <input v-model="itemForm.allowAff" type="checkbox" />
                      允许 AFF
                    </label>
                  </div>
                  <div class="mt-3 flex justify-end gap-2">
                    <button class="btn btn-primary" :disabled="editSaving" @click="saveItemContent(item)">
                      {{ editSaving ? '保存中...' : '保存商品' }}
                    </button>
                    <button class="btn btn-secondary" :disabled="editSaving" @click="cancelEditItem">取消</button>
                  </div>
                  <p class="mt-2 text-xs text-themed-muted">库存不能低于已售和锁定数量；价格修改只影响后续购买。</p>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section v-if="selectedCampaign" class="card mt-6 overflow-hidden">
        <div class="flex items-center justify-between border-b border-themed px-5 py-4">
          <div class="flex items-center gap-2">
            <svg class="h-4 w-4 shrink-0 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12h6m-6 4h6m4 5H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" />
            </svg>
            <div>
              <h2 class="text-base font-semibold text-themed">抢购记录：{{ selectedCampaign.name }}</h2>
              <p class="mt-1 text-sm text-themed-muted">最近 50 条记录。</p>
            </div>
          </div>
          <button class="btn btn-secondary" :disabled="reservationsLoading" @click="loadReservations(selectedCampaign.id)">刷新记录</button>
        </div>
        <div v-if="reservations.length === 0" class="px-5 py-8 text-center text-themed-muted">暂无记录</div>
        <template v-else>
          <div class="space-y-3 p-4 lg:hidden">
            <div
              v-for="record in reservations"
              :key="record.id"
              class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate font-medium text-themed">{{ record.user?.username || `UID ${record.userId}` }}</div>
                  <div class="mt-1 truncate text-xs text-themed-muted">{{ record.packageName }} / {{ record.planName }}</div>
                </div>
                <div class="shrink-0 text-sm font-semibold tabular-nums text-themed">¥{{ record.amount.toFixed(2) }}</div>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div class="text-themed-muted">实例</div>
                  <div class="mt-1 truncate font-medium text-themed">{{ record.instance?.name || '-' }}</div>
                </div>
                <div>
                  <div class="text-themed-muted">状态</div>
                  <div class="mt-1"><span class="nimbus-pill text-themed-muted"><span class="dot"></span>{{ record.status }}</span></div>
                </div>
                <div class="col-span-2">
                  <div class="text-themed-muted">时间</div>
                  <div class="mt-1 font-medium text-themed">{{ formatDate(record.createdAt) }}</div>
                </div>
              </div>
            </div>
          </div>
          <div class="hidden overflow-hidden lg:block">
            <table class="w-full table-fixed text-sm">
              <thead>
                <tr class="border-b border-themed">
                  <th class="nimbus-th w-[16%]">用户</th>
                  <th class="nimbus-th w-[24%]">套餐</th>
                  <th class="nimbus-th w-[18%]">实例</th>
                  <th class="nimbus-th w-[12%]">金额</th>
                  <th class="nimbus-th w-[12%]">状态</th>
                  <th class="nimbus-th w-[18%]">时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in reservations" :key="record.id" class="nimbus-row border-b border-themed">
                  <td class="truncate px-5 py-3 text-themed">{{ record.user?.username || `UID ${record.userId}` }}</td>
                  <td class="truncate px-5 py-3 text-themed-muted">{{ record.packageName }} / {{ record.planName }}</td>
                  <td class="truncate px-5 py-3 text-themed-muted">{{ record.instance?.name || '-' }}</td>
                  <td class="px-5 py-3 tabular-nums text-themed">¥{{ record.amount.toFixed(2) }}</td>
                  <td class="px-5 py-3"><span class="nimbus-pill text-themed-muted"><span class="dot"></span>{{ record.status }}</span></td>
                  <td class="truncate px-5 py-3 text-themed-muted">{{ formatDate(record.createdAt) }}</td>
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
.nimbus-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kawaii-primary) 28%, transparent);
}

.nimbus-stat {
  position: relative;
  overflow: hidden;
}

.nimbus-stat::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 2.25rem;
  height: 2px;
  background: var(--kawaii-primary);
  border-radius: 0 0 2px 0;
}

.nimbus-stat-label {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
}

.nimbus-stat-value {
  margin-top: 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.1;
  color: var(--kawaii-text);
  font-variant-numeric: tabular-nums;
}

.nimbus-th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
  white-space: nowrap;
}

.nimbus-row {
  transition: background-color 0.12s ease;
}

.nimbus-row:hover {
  background: color-mix(in srgb, var(--kawaii-primary) 5%, transparent);
}

.nimbus-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.nimbus-pill .dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: currentColor;
}

.nimbus-field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--kawaii-muted);
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-row {
    transition: none;
  }
}
</style>
