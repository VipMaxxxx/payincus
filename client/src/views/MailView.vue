<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useConfigStore } from '@/stores/config'
import { translateError } from '@/utils/errorHandler'
import FlagIcon from '@/components/FlagIcon.vue'
import { freeSiteCopy } from '@/utils/freeSiteFun'

const { t } = useI18n()
const router = useRouter()
const toast = useToast()
const configStore = useConfigStore()
void configStore.loadPublicConfig()

// TAB 状态
const activeTab = ref<'my' | 'buy'>('my')

// 加载状态
const loading = ref(true)
const buyLoading = ref(false)

// 订阅数据
const subscription = ref<any>(null)

// 购买相关
const sources = ref<any[]>([])
const selectedSourceId = ref<number | null>(null)
const selectedPlanId = ref<number | null>(null)

// 优惠码相关
const affCode = ref('')
const affCodeValid = ref<boolean | null>(null)
const affCodeDiscount = ref(0)
const affCodeCommissionRate = ref(0)
const affCodeError = ref('')
const affCodeVerifying = ref(false)

// 计算属性
const selectedSource = computed(() => sources.value.find(s => s.id === selectedSourceId.value))
const selectedPlan = computed(() => selectedSource.value?.plans.find((p: any) => p.id === selectedPlanId.value))
const checkoutPriceInfo = computed(() => {
  if (!selectedPlan.value) {
    return null
  }

  const originalPrice = Number(selectedPlan.value.price)
  const discountAmount = affCodeValid.value
    ? Number((originalPrice * affCodeDiscount.value).toFixed(2))
    : 0
  const finalPrice = Number((originalPrice - discountAmount).toFixed(2))

  return {
    originalPrice,
    discountAmount,
    finalPrice
  }
})

// 检查选中地区是否已有订阅
const hasSubscriptionInSelectedRegion = computed(() => {
  if (!subscription.value || !selectedSourceId.value) return false
  return subscription.value.source.id === selectedSourceId.value
})

// 域名添加弹窗
const showAddDomainModal = ref(false)
const addDomainLoading = ref(false)
const newDomain = ref('')

// 续费弹窗
const showRenewModal = ref(false)
const renewLoading = ref(false)
const renewMonths = ref(1)

onMounted(async () => {
  await loadData()
})

async function loadData() {
  loading.value = true
  try {
    const [subRes, srcRes] = await Promise.all([
      api.mail.getSubscription(),
      api.mail.getSources()
    ])
    subscription.value = subRes.subscription
    sources.value = srcRes.sources
    
    // 默认选择第一个源和方案
    if (sources.value.length > 0 && !selectedSourceId.value) {
      selectedSourceId.value = sources.value[0].id
      if (sources.value[0].plans.length > 0) {
        selectedPlanId.value = sources.value[0].plans[0].id
      }
    }
    
    // 如果没有订阅，自动切换到购买 TAB
    if (!subscription.value) {
      activeTab.value = 'buy'
    }
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    loading.value = false
  }
}

function selectSource(id: number) {
  selectedSourceId.value = id
  const source = sources.value.find(s => s.id === id)
  if (source?.plans.length > 0) {
    selectedPlanId.value = source.plans[0].id
  } else {
    selectedPlanId.value = null
  }
}

function selectPlan(id: number) {
  selectedPlanId.value = id
  // 重置优惠码状态
  resetAffCode()
}

function resetAffCode() {
  affCode.value = ''
  affCodeValid.value = null
  affCodeDiscount.value = 0
  affCodeCommissionRate.value = 0
  affCodeError.value = ''
}

async function verifyAffCode() {
  if (!affCode.value.trim()) {
    resetAffCode()
    return
  }
  
  affCodeVerifying.value = true
  affCodeError.value = ''
  
  try {
    const res = await api.mail.validateAffCode(affCode.value.trim())
    if (res.valid) {
      affCodeValid.value = true
      affCodeDiscount.value = res.discountRate || 0
      affCodeCommissionRate.value = res.commissionRate || 0
    } else {
      affCodeValid.value = false
      affCodeError.value = res.error || t('aff.promoCodeInvalid')
    }
  } catch (err: any) {
    affCodeValid.value = false
    affCodeError.value = err.message || t('aff.promoCodeInvalid')
  } finally {
    affCodeVerifying.value = false
  }
}

async function purchaseSubscription() {
  if (!selectedPlanId.value) {
    toast.error(t('mail.selectPlanFirst'))
    return
  }
  
  buyLoading.value = true
  try {
    await api.mail.purchaseSubscription(
      selectedPlanId.value,
      affCodeValid.value ? affCode.value.trim() : undefined
    )
    toast.success(t('mail.purchaseSuccess'))
    resetAffCode()
    await loadData()
    activeTab.value = 'my'
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    buyLoading.value = false
  }
}

// 添加域名
function openAddDomainModal() {
  newDomain.value = ''
  showAddDomainModal.value = true
}

async function addDomain() {
  if (!newDomain.value.trim()) {
    toast.error(t('mail.domainRequired'))
    return
  }
  
  addDomainLoading.value = true
  try {
    await api.mail.addDomain(newDomain.value.trim())
    toast.success(t('mail.domainAdded'))
    showAddDomainModal.value = false
    await loadData()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    addDomainLoading.value = false
  }
}

function goToDomain(id: number) {
  router.push(`/mail/domains/${id}`)
}

// 续费相关
function openRenewModal() {
  // 根据计费周期设置默认值
  if (subscription.value?.plan?.billingCycle === 'yearly') {
    renewMonths.value = 12
  } else {
    renewMonths.value = 1
  }
  showRenewModal.value = true
}

const renewMonthlyPrice = computed(() => {
  if (!subscription.value?.plan) return 0
  const plan = subscription.value.plan
  return plan.billingCycle === 'monthly' 
    ? Number(plan.price) 
    : Number(plan.price) / 12
})

const renewOriginalPrice = computed(() => {
  return Math.round(renewMonthlyPrice.value * renewMonths.value * 100) / 100
})

const renewDiscountRate = computed(() => {
  return subscription.value?.affBinding?.affCode?.discountRate || 0
})

const renewDiscountAmount = computed(() => {
  return Math.round(renewOriginalPrice.value * renewDiscountRate.value * 100) / 100
})

const renewFinalPrice = computed(() => {
  return renewOriginalPrice.value - renewDiscountAmount.value
})

async function renewSubscription() {
  renewLoading.value = true
  try {
    await api.mail.renewSubscription(renewMonths.value)
    toast.success(t('mail.renewSuccess'))
    showRenewModal.value = false
    await loadData()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    renewLoading.value = false
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'verified': return 'badge-success'
    case 'pending': return 'badge-warning'
    case 'suspended': return 'badge-error'
    default: return 'badge-ghost'
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString()
}

function formatPrice(price: number | string | null | undefined) {
  if (configStore.freeSiteMode) return freeSiteCopy.mailPrice
  const num = Number(price) || 0
  return `¥${num.toFixed(2)}`
}

function getBillingCycleLabel(cycle: string | null | undefined) {
  if (configStore.freeSiteMode) return freeSiteCopy.mailBillingCycle
  return cycle === 'monthly' ? t('mail.monthly') : t('mail.yearly')
}

function getBillingCycleSuffix(cycle: string | null | undefined) {
  if (configStore.freeSiteMode) return ''
  return `/${cycle === 'monthly' ? t('mail.month') : t('mail.year')}`
}
</script>

<template>
  <div class="animate-fade-in">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1 class="page-title">{{ t('mail.title') }}</h1>
      <p class="text-sm text-themed-muted mt-1">{{ t('mail.description') }}</p>
    </div>

    <!-- TAB 切换 -->
    <div class="flex border-b border-themed mb-6">
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
        :class="activeTab === 'my' 
          ? 'border-blue-500 text-blue-500' 
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="activeTab = 'my'"
      >
        {{ t('mail.tabs.my') }}
      </button>
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
        :class="activeTab === 'buy' 
          ? 'border-blue-500 text-blue-500' 
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="activeTab = 'buy'"
      >
        {{ t('mail.tabs.buy') }}
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <!-- 我的域名邮箱 TAB -->
    <div v-else-if="activeTab === 'my'" class="space-y-6">
      <!-- 无订阅状态 -->
      <div v-if="!subscription" class="card p-12 text-center">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-themed-secondary flex items-center justify-center">
          <svg class="w-8 h-8 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
          </svg>
        </div>
        <h3 class="text-lg font-medium text-themed mb-2">{{ t('mail.noSubscription') }}</h3>
        <p class="text-sm text-themed-muted mb-6">{{ t('mail.buyNowHint') }}</p>
        <button class="btn btn-primary" @click="activeTab = 'buy'">
          {{ t('mail.buyNow') }}
        </button>
      </div>

      <!-- 有订阅状态 -->
      <template v-else>
        <!-- 订阅概览卡片 -->
        <div class="card p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-medium text-themed">{{ t('mail.subscriptionOverview') }}</h3>
            <span :class="['badge', getStatusBadge(subscription.status)]">
              {{ t('mail.status.' + subscription.status) }}
            </span>
          </div>
          
          <div class="grid grid-cols-3 gap-4 mb-4">
            <div class="bg-themed-secondary rounded-lg p-3">
              <div class="text-xs text-themed-muted mb-1">{{ t('mail.expiresAt') }}</div>
              <div class="text-sm font-medium text-themed">{{ formatDate(subscription.expiresAt) }}</div>
            </div>
            <div class="bg-themed-secondary rounded-lg p-3">
              <div class="text-xs text-themed-muted mb-1">{{ t('mail.domainsUsed') }}</div>
              <div class="text-sm font-medium text-themed">{{ subscription.usage.domainCount }}/{{ subscription.plan.domainLimit }}</div>
            </div>
            <div class="bg-themed-secondary rounded-lg p-3">
              <div class="text-xs text-themed-muted mb-1">{{ t('mail.totalSpace') }}</div>
              <div class="text-sm font-medium text-themed">{{ subscription.plan.diskLimitGb }} GB</div>
            </div>
          </div>
          
          <div class="flex items-center justify-between text-sm">
            <span class="text-themed-muted">
              {{ t('mail.plan') }}：{{ subscription.plan.name }} ({{ subscription.source.name }}) · 
              {{ subscription.plan.domainLimit }} {{ t('mail.domains') }} / {{ subscription.plan.diskLimitGb }}GB · 
              {{ formatPrice(subscription.plan.price) }}{{ getBillingCycleSuffix(subscription.plan.billingCycle) }}
            </span>
            <button class="btn btn-sm btn-outline" @click="openRenewModal">
              {{ t('mail.renew') }}
            </button>
          </div>
        </div>

        <!-- 我的域名 -->
        <div class="card">
          <div class="flex items-center justify-between p-4 border-b border-themed">
            <h3 class="text-base font-medium text-themed">{{ t('mail.myDomains') }}</h3>
            <button 
              class="btn btn-sm btn-primary"
              :disabled="subscription.usage.domainCount >= subscription.plan.domainLimit"
              @click="openAddDomainModal"
            >
              + {{ t('mail.addDomain') }}
            </button>
          </div>
          
          <div v-if="subscription.domains.length === 0" class="p-8 text-center text-themed-muted">
            {{ t('mail.noDomains') }}
          </div>
          
          <div v-else class="divide-y divide-themed">
            <div 
              v-for="domain in subscription.domains" 
              :key="domain.id"
              class="p-4 hover:bg-themed-secondary cursor-pointer transition-colors"
              @click="goToDomain(domain.id)"
            >
              <div class="flex items-center justify-between">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-themed">{{ domain.domain }}</span>
                    <span :class="['badge badge-sm', getStatusBadge(domain.status)]">
                      {{ t('mail.domainStatus.' + domain.status) }}
                    </span>
                  </div>
                </div>
                <svg class="w-5 h-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 购买域名邮箱 TAB -->
    <div v-else-if="activeTab === 'buy'" class="lg:flex lg:gap-8">
      <!-- 左侧主内容区域 -->
      <div class="flex-1 min-w-0 space-y-6">
        <!-- Step 1: 选择服务地区 -->
        <div class="card p-5">
          <div class="flex items-center gap-2.5 mb-4">
            <span class="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">1</span>
            <h3 class="text-sm font-semibold text-themed">{{ t('mail.selectRegion') }}</h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              v-for="source in sources"
              :key="source.id"
              :class="[
                'relative p-4 rounded-xl border-2 transition-all cursor-pointer group',
                selectedSourceId === source.id 
                  ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20' 
                  : 'border-themed hover:border-blue-300 dark:hover:border-blue-800'
              ]"
              @click="selectSource(source.id)"
            >
              <div class="flex items-center gap-3">
                <!-- 国旗 -->
                <div class="w-10 h-10 rounded-lg bg-themed-secondary flex items-center justify-center overflow-hidden">
                  <FlagIcon :code="source.code" size="lg" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-themed">{{ source.name }}</div>
                  <div class="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5">{{ t('mail.nodeStatus.limited') }}</div>
                </div>
                <!-- 选中指示器 -->
                <div 
                  :class="[
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                    selectedSourceId === source.id 
                      ? 'border-blue-500 bg-blue-500' 
                      : 'border-gray-300 dark:border-gray-600 group-hover:border-blue-400'
                  ]"
                >
                  <svg v-if="selectedSourceId === source.id" class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 已购买该地区提示 -->
        <div v-if="hasSubscriptionInSelectedRegion" class="card p-5 border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20">
          <div class="flex items-start gap-3">
            <svg class="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <div>
              <h4 class="font-medium text-amber-800 dark:text-amber-200">{{ t('mail.alreadyPurchased') }}</h4>
              <p class="text-sm text-amber-600 dark:text-amber-300/80 mt-1">{{ t('mail.alreadyPurchasedDesc') }}</p>
              <button 
                class="btn btn-sm btn-ghost mt-3 text-amber-700 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                @click="activeTab = 'my'"
              >
                {{ t('mail.viewMySubscription') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Step 2: 方案配置详情 -->
        <div v-if="selectedSource && !hasSubscriptionInSelectedRegion" class="card p-5">
          <div class="flex items-center gap-2.5 mb-4">
            <span class="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">2</span>
            <h3 class="text-sm font-semibold text-themed">{{ t('mail.planDetails') }}</h3>
          </div>
          
          <div v-for="plan in selectedSource.plans" :key="plan.id" class="mb-4 last:mb-0">
            <div
              :class="[
                'relative p-5 rounded-xl border-2 transition-all cursor-pointer',
                selectedPlanId === plan.id 
                  ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10' 
                  : 'border-themed hover:border-blue-300 dark:hover:border-blue-800'
              ]"
              @click="selectPlan(plan.id)"
            >
              <!-- 方案标题和价格 -->
              <div class="flex items-start justify-between mb-4">
                <div class="flex-1 min-w-0">
                  <h4 class="text-lg font-semibold text-themed">{{ plan.name }}</h4>
                  <!-- 方案描述（从后端获取）-->
                  <p v-if="plan.description" class="text-sm text-themed-muted mt-1">{{ plan.description }}</p>
                </div>
                <div class="text-right flex-shrink-0 ml-4">
                  <div class="text-2xl font-bold text-themed">{{ formatPrice(plan.price) }}<span class="text-sm font-normal text-themed-muted">{{ getBillingCycleSuffix(plan.billingCycle) }}</span></div>
                </div>
              </div>
              
              <!-- 配额信息 + 功能特性 -->
              <div class="grid grid-cols-2 gap-3 pt-4 border-t border-themed">
                <div class="flex items-center gap-2.5 text-sm text-themed-muted">
                  <svg class="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  <span>{{ t('mail.feature.domainStorage', { count: plan.domainLimit, storage: plan.diskLimitGb }) }}</span>
                </div>
                <div class="flex items-center gap-2.5 text-sm text-themed-muted">
                  <svg class="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span>{{ t('mail.feature.unlimitedAliases') }}</span>
                </div>
                <div class="flex items-center gap-2.5 text-sm text-themed-muted">
                  <svg class="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span>{{ t('mail.feature.unlimitedMailboxes') }}</span>
                </div>
                <div class="flex items-center gap-2.5 text-sm text-themed-muted">
                  <svg class="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>{{ t('mail.feature.emailLimit') }}</span>
                </div>
                <div class="flex items-center gap-2.5 text-sm text-themed-muted">
                  <svg class="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                  </svg>
                  <span>{{ t('mail.feature.emClientPro') }}</span>
                </div>
                <div class="flex items-center gap-2.5 text-sm text-themed-muted">
                  <svg class="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  <span>{{ t('mail.feature.catchAll') }}</span>
                </div>
              </div>
              
              <!-- 选中指示器 -->
              <div 
                v-if="selectedPlanId === plan.id"
                class="absolute bottom-4 right-4 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center"
              >
                <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 3: 其他选项 (优惠码) -->
        <div v-if="selectedPlan && !hasSubscriptionInSelectedRegion" class="card p-5">
          <div class="flex items-center gap-2.5 mb-4">
            <span class="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">3</span>
            <h3 class="text-sm font-semibold text-themed">{{ t('mail.otherOptions') }}</h3>
          </div>
          
          <div>
            <label class="text-xs font-medium text-themed-muted mb-2 block">{{ t('aff.promoCodeOptional') }}</label>
            <div class="flex gap-2">
              <input 
                v-model="affCode" 
                type="text" 
                class="input flex-1" 
                :placeholder="t('aff.promoCodeInputPlaceholder')"
                :disabled="affCodeVerifying"
                @keyup.enter="verifyAffCode"
              />
              <button 
                class="btn btn-outline px-4"
                :disabled="affCodeVerifying || !affCode.trim()"
                @click="verifyAffCode"
              >
                <span v-if="affCodeVerifying" class="loading loading-spinner loading-sm"></span>
                <span v-else>{{ t('mail.verify') }}</span>
              </button>
            </div>
            <p v-if="affCodeValid === true" class="text-xs text-green-500 mt-2 flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
              {{ t('aff.promoCodeValid', { rate: (affCodeDiscount * 100).toFixed(0) + '%' }) }}
            </p>
            <p v-else-if="affCodeValid === false" class="text-xs text-red-500 mt-2">
              {{ affCodeError }}
            </p>
          </div>
        </div>
        
        <!-- 移动端结算汇总（仅在小屏幕显示） -->
        <div v-if="selectedPlan && !hasSubscriptionInSelectedRegion" class="lg:hidden card p-5">
          <div class="flex items-center gap-2 mb-4">
            <svg class="w-5 h-5 text-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <h3 class="text-sm font-semibold text-themed">{{ configStore.freeSiteMode ? freeSiteCopy.mailCheckoutTitle : t('mail.checkout.title') }}</h3>
          </div>
          
          <div class="space-y-3 text-sm">
            <div class="flex justify-between">
              <span class="text-themed-muted">{{ t('mail.checkout.region') }}</span>
              <span class="text-themed font-medium">{{ selectedSource?.name }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-themed-muted">{{ configStore.freeSiteMode ? freeSiteCopy.mailBillingCycle : t('mail.billingCycle') }}</span>
              <span class="text-blue-500 font-medium">{{ getBillingCycleLabel(selectedPlan.billingCycle) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-themed-muted">{{ t('mail.checkout.serviceStatus') }}</span>
              <span class="text-green-500 font-medium">{{ t('mail.checkout.instant') }}</span>
            </div>
            
            <div class="border-t border-themed pt-3 mt-3">
              <div v-if="affCodeValid && checkoutPriceInfo" class="flex justify-between text-themed-muted mb-2">
                <span>{{ t('aff.originalPrice') }}</span>
                <span>¥{{ checkoutPriceInfo.originalPrice.toFixed(2) }}</span>
              </div>
              <div v-if="affCodeValid && checkoutPriceInfo" class="flex justify-between text-green-500 mb-2">
                <span>{{ t('aff.discountAmount') }}</span>
                <span>-¥{{ checkoutPriceInfo.discountAmount.toFixed(2) }}</span>
              </div>
              <div class="flex justify-between items-baseline">
                <span class="text-themed-muted">{{ configStore.freeSiteMode ? freeSiteCopy.mailCheckoutAmount : t('mail.checkout.amount') }}</span>
                <span class="text-2xl font-bold text-themed">{{ formatPrice(checkoutPriceInfo?.finalPrice ?? selectedPlan.price) }}</span>
              </div>
            </div>
          </div>
          
          <button 
            class="btn btn-primary w-full mt-5" 
            :disabled="buyLoading"
            @click="purchaseSubscription"
          >
            <span v-if="buyLoading" class="loading loading-spinner loading-sm mr-2"></span>
            {{ configStore.freeSiteMode ? freeSiteCopy.mailCheckoutConfirm : t('mail.checkout.confirm') }}
          </button>
          
          <p class="text-xs text-themed-muted text-center mt-3 flex items-center justify-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {{ configStore.freeSiteMode ? freeSiteCopy.mailBalanceRequired : t('mail.checkout.balanceRequired') }}
          </p>
        </div>
      </div>
      
      <!-- 右侧结算汇总卡片（大屏幕显示） -->
      <div v-if="selectedPlan && !hasSubscriptionInSelectedRegion" class="hidden lg:block w-80 flex-shrink-0">
        <div class="sticky top-6">
          <div class="card p-5">
            <div class="flex items-center gap-2 mb-5 pb-4 border-b border-themed">
              <svg class="w-5 h-5 text-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h3 class="text-sm font-semibold text-themed">{{ configStore.freeSiteMode ? freeSiteCopy.mailCheckoutTitle : t('mail.checkout.title') }}</h3>
            </div>
            
            <div class="space-y-3 text-sm">
              <div class="flex justify-between">
                <span class="text-themed-muted">{{ t('mail.checkout.region') }}</span>
                <span class="text-themed font-medium">{{ selectedSource?.name }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-themed-muted">{{ configStore.freeSiteMode ? freeSiteCopy.mailBillingCycle : t('mail.billingCycle') }}</span>
                <span class="text-blue-500 font-medium">{{ getBillingCycleLabel(selectedPlan.billingCycle) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-themed-muted">{{ t('mail.checkout.serviceStatus') }}</span>
                <span class="text-green-500 font-medium">{{ t('mail.checkout.instant') }}</span>
              </div>
              
              <div class="border-t border-themed pt-4 mt-4">
                <div v-if="affCodeValid && checkoutPriceInfo" class="flex justify-between text-themed-muted mb-2">
                  <span>{{ t('aff.originalPrice') }}</span>
                  <span>¥{{ checkoutPriceInfo.originalPrice.toFixed(2) }}</span>
                </div>
                <div v-if="affCodeValid && checkoutPriceInfo" class="flex justify-between text-green-500 mb-2">
                  <span>{{ t('aff.discountAmount') }}</span>
                  <span>-¥{{ checkoutPriceInfo.discountAmount.toFixed(2) }}</span>
                </div>
                <div class="flex justify-between items-baseline">
                  <span class="text-themed-muted">{{ configStore.freeSiteMode ? freeSiteCopy.mailCheckoutAmount : t('mail.checkout.amount') }}</span>
                  <span class="text-2xl font-bold text-themed">{{ formatPrice(checkoutPriceInfo?.finalPrice ?? selectedPlan.price) }}</span>
                </div>
              </div>
            </div>
            
            <button 
              class="btn btn-primary w-full mt-5" 
              :disabled="buyLoading"
              @click="purchaseSubscription"
            >
              <span v-if="buyLoading" class="loading loading-spinner loading-sm mr-2"></span>
              {{ configStore.freeSiteMode ? freeSiteCopy.mailCheckoutConfirm : t('mail.checkout.confirm') }}
              <svg class="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            
            <p class="text-xs text-themed-muted text-center mt-3 flex items-center justify-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {{ configStore.freeSiteMode ? freeSiteCopy.mailBalanceRequired : t('mail.checkout.balanceRequired') }}
            </p>
          </div>
          
          <!-- 帮助提示 -->
          <div class="card p-4 mt-4 bg-themed-secondary">
            <div class="flex items-start gap-3">
              <svg class="w-5 h-5 text-themed-muted flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 class="text-sm font-medium text-themed">{{ t('mail.help.title') }}</h4>
                <p class="text-xs text-themed-muted mt-1">{{ t('mail.help.desc') }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加域名弹窗 -->
    <Teleport to="body">
      <div v-if="showAddDomainModal" class="modal-overlay">
        <div class="modal-backdrop" @click="showAddDomainModal = false"></div>
        <div class="modal-content max-w-md">
          <div class="modal-header">
            <h3 class="modal-title">{{ t('mail.addDomain') }}</h3>
            <button class="btn btn-ghost btn-sm" @click="showAddDomainModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="modal-body">
            <div>
              <label class="label">{{ t('mail.domainName') }}</label>
              <input 
                v-model="newDomain"
                type="text" 
                :placeholder="t('mail.domainPlaceholder')"
                class="input w-full"
                @keyup.enter="addDomain"
              />
              <p class="text-xs text-themed-muted mt-1">{{ t('mail.domainHint') }}</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showAddDomainModal = false">{{ t('common.cancel') }}</button>
            <button 
              class="btn btn-primary" 
              :disabled="addDomainLoading || !newDomain.trim()"
              @click="addDomain"
            >
              <span v-if="addDomainLoading" class="loading-spinner w-4 h-4 mr-2"></span>
              {{ t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 续费弹窗 -->
    <Teleport to="body">
      <div v-if="showRenewModal" class="modal-overlay">
        <div class="modal-backdrop" @click="showRenewModal = false"></div>
        <div class="modal-content max-w-sm">
          <div class="modal-header">
            <h3 class="modal-title">{{ t('mail.renewSubscription') }}</h3>
            <button class="btn btn-ghost btn-sm" @click="showRenewModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="modal-body space-y-4">
            <!-- 续费时长选择 -->
            <div>
              <label class="label">{{ t('mail.renewDuration') }}</label>
              <!-- 按年计费：只能续费1年 -->
              <div v-if="subscription?.plan?.billingCycle === 'yearly'" class="input w-full bg-themed-secondary flex items-center">
                1 {{ t('mail.year') }}
              </div>
              <!-- 按月计费：可选择1/3/6/12个月 -->
              <select v-else v-model="renewMonths" class="input w-full">
                <option :value="1">1 {{ t('mail.month') }}</option>
                <option :value="3">3 {{ t('mail.months') }}</option>
                <option :value="6">6 {{ t('mail.months') }}</option>
                <option :value="12">12 {{ t('mail.months') }}</option>
              </select>
            </div>
            
            <!-- 费用明细 -->
            <div class="bg-themed-secondary rounded-lg p-4 space-y-2">
              <!-- 按年计费 -->
              <template v-if="subscription?.plan?.billingCycle === 'yearly'">
                <div class="flex justify-between text-sm">
                  <span class="text-themed-muted">{{ t('mail.yearlyPrice') }}</span>
                  <span class="text-themed">¥{{ Number(subscription.plan.price).toFixed(2) }}/{{ t('mail.year') }}</span>
                </div>
              </template>
              <!-- 按月计费 -->
              <template v-else>
                <div class="flex justify-between text-sm">
                  <span class="text-themed-muted">{{ t('mail.monthlyPrice') }}</span>
                  <span class="text-themed">¥{{ renewMonthlyPrice.toFixed(2) }}/{{ t('mail.month') }}</span>
                </div>
                <div class="flex justify-between text-sm">
                  <span class="text-themed-muted">{{ t('mail.renewDuration') }}</span>
                  <span class="text-themed">{{ renewMonths }} {{ renewMonths > 1 ? t('mail.months') : t('mail.month') }}</span>
                </div>
              </template>
              <div v-if="renewDiscountRate > 0" class="flex justify-between text-sm text-green-500">
                <span>{{ t('aff.promoDiscount') }} ({{ (renewDiscountRate * 100).toFixed(0) }}%)</span>
                <span>-¥{{ renewDiscountAmount.toFixed(2) }}</span>
              </div>
              <div class="border-t border-themed pt-2 flex justify-between font-medium">
                <span class="text-themed-muted">{{ t('mail.totalPrice') }}</span>
                <span class="text-themed text-lg">¥{{ renewFinalPrice.toFixed(2) }}</span>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showRenewModal = false">{{ t('common.cancel') }}</button>
            <button 
              class="btn btn-primary" 
              :disabled="renewLoading"
              @click="renewSubscription"
            >
              <span v-if="renewLoading" class="loading-spinner w-4 h-4 mr-2"></span>
              {{ t('mail.confirmRenew') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
