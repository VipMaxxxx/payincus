<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { translateError } from '@/utils/errorHandler'
import FlagIcon from '@/components/FlagIcon.vue'
import UserAvatar from '@/components/UserAvatar.vue'

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

// TAB 状态
const activeTab = ref<'sources' | 'plans' | 'subscriptions' | 'domains'>('sources')

// 加载状态
const loading = ref(true)
const actionLoading = ref('')

// 数据
const sources = ref<any[]>([])
const plans = ref<any[]>([])
const subscriptions = ref<any[]>([])
const domains = ref<any[]>([])

// 邮箱源弹窗
const showSourceModal = ref(false)
const editingSource = ref<any>(null)
const sourceForm = ref({
  name: '',
  code: 'us',
  apiUrl: '',
  apiKey: '',
  smarterMailUrl: ''
})

// 方案弹窗
const showPlanModal = ref(false)
const editingPlan = ref<any>(null)
const planForm = ref({
  sourceId: 0,
  name: '',
  description: '',
  domainLimit: 1,
  diskLimitGb: 10,
  price: 0,
  billingCycle: 'monthly' as 'monthly' | 'yearly'
})

// 分页
const subscriptionsPage = ref(1)
const domainsPage = ref(1)
const pageSize = ref(20)
const totalSubscriptions = ref(0)
const totalDomains = ref(0)

// 搜索
const subscriptionsSearch = ref('')
const domainsSearch = ref('')

// 分页计算属性
const subscriptionsTotalPages = computed(() => Math.ceil(totalSubscriptions.value / pageSize.value))
const domainsTotalPages = computed(() => Math.ceil(totalDomains.value / pageSize.value))

onMounted(async () => {
  await loadSources()
})

async function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab
  if (tab === 'sources' && sources.value.length === 0) {
    await loadSources()
  } else if (tab === 'plans' && plans.value.length === 0) {
    await loadPlans()
  } else if (tab === 'subscriptions') {
    subscriptionsPage.value = 1
    subscriptionsSearch.value = '' // 重置搜索条件
    await loadSubscriptions()
  } else if (tab === 'domains') {
    domainsPage.value = 1
    domainsSearch.value = '' // 重置搜索条件
    await loadDomains()
  }
}

// ===== 邮箱源管理 =====
async function loadSources() {
  loading.value = true
  try {
    const res = await api.mail.adminGetSources()
    sources.value = res.sources || []
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    loading.value = false
  }
}

function openCreateSourceModal() {
  editingSource.value = null
  sourceForm.value = {
    name: '',
    code: 'us',
    apiUrl: '',
    apiKey: '',
    smarterMailUrl: ''
  }
  showSourceModal.value = true
}

function openEditSourceModal(source: any) {
  editingSource.value = source
  sourceForm.value = {
    name: source.name,
    code: source.code,
    apiUrl: source.apiUrl || '',
    apiKey: '',
    smarterMailUrl: source.smarterMailUrl || ''
  }
  showSourceModal.value = true
}

async function saveSource() {
  if (!sourceForm.value.name || !sourceForm.value.apiUrl || (!editingSource.value && !sourceForm.value.apiKey)) {
    toast.error(t('admin.mail.fillRequired'))
    return
  }

  actionLoading.value = 'save-source'
  try {
    if (editingSource.value) {
      const payload = { ...sourceForm.value }
      if (!payload.apiKey) {
        delete (payload as Partial<typeof sourceForm.value>).apiKey
      }
      await api.mail.adminUpdateSource(editingSource.value.id, payload)
      toast.success(t('admin.mail.sourceUpdated'))
    } else {
      await api.mail.adminCreateSource(sourceForm.value)
      toast.success(t('admin.mail.sourceCreated'))
    }
    showSourceModal.value = false
    await loadSources()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    actionLoading.value = ''
  }
}

async function deleteSource(source: any) {
  if (!confirm(t('admin.mail.confirmDeleteSource', { name: source.name }))) return

  actionLoading.value = `delete-source-${source.id}`
  try {
    await api.mail.adminDeleteSource(source.id)
    toast.success(t('admin.mail.sourceDeleted'))
    await loadSources()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    actionLoading.value = ''
  }
}

// ===== 方案管理 =====
async function loadPlans() {
  loading.value = true
  try {
    const res = await api.mail.adminGetPlans()
    plans.value = res.plans || []
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    loading.value = false
  }
}

function openCreatePlanModal() {
  if (sources.value.length === 0) {
    toast.error(t('admin.mail.createSourceFirst'))
    return
  }
  editingPlan.value = null
  planForm.value = {
    sourceId: sources.value[0]?.id || 0,
    name: '',
    description: '',
    domainLimit: 1,
    diskLimitGb: 10,
    price: 0,
    billingCycle: 'monthly'
  }
  showPlanModal.value = true
}

function openEditPlanModal(plan: any) {
  editingPlan.value = plan
  planForm.value = {
    sourceId: plan.sourceId,
    name: plan.name,
    description: plan.description || '',
    domainLimit: plan.domainLimit,
    diskLimitGb: plan.diskLimitGb,
    price: plan.price,
    billingCycle: plan.billingCycle
  }
  showPlanModal.value = true
}

async function savePlan() {
  if (!planForm.value.name || !planForm.value.sourceId || planForm.value.price <= 0) {
    toast.error(t('admin.mail.fillRequired'))
    return
  }

  actionLoading.value = 'save-plan'
  try {
    if (editingPlan.value) {
      await api.mail.adminUpdatePlan(editingPlan.value.id, planForm.value)
      toast.success(t('admin.mail.planUpdated'))
    } else {
      await api.mail.adminCreatePlan(planForm.value)
      toast.success(t('admin.mail.planCreated'))
    }
    showPlanModal.value = false
    await loadPlans()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    actionLoading.value = ''
  }
}

async function deletePlan(plan: any) {
  if (!confirm(t('admin.mail.confirmDeletePlan', { name: plan.name }))) return

  actionLoading.value = `delete-plan-${plan.id}`
  try {
    await api.mail.adminDeletePlan(plan.id)
    toast.success(t('admin.mail.planDeleted'))
    await loadPlans()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    actionLoading.value = ''
  }
}

// ===== 订阅管理 =====
async function loadSubscriptions() {
  loading.value = true
  try {
    const res = await api.mail.adminGetSubscriptions({ 
      page: subscriptionsPage.value, 
      pageSize: pageSize.value,
      search: subscriptionsSearch.value || undefined
    })
    subscriptions.value = res.subscriptions || []
    totalSubscriptions.value = res.total || 0
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    loading.value = false
  }
}

function searchSubscriptions() {
  subscriptionsPage.value = 1
  loadSubscriptions()
}

function goToSubscriptionsPage(newPage: number) {
  if (newPage >= 1 && newPage <= subscriptionsTotalPages.value) {
    subscriptionsPage.value = newPage
    loadSubscriptions()
  }
}

// ===== 域名管理 =====
async function loadDomains() {
  loading.value = true
  try {
    const res = await api.mail.adminGetDomains({ 
      page: domainsPage.value, 
      pageSize: pageSize.value,
      search: domainsSearch.value || undefined
    })
    domains.value = res.domains || []
    totalDomains.value = res.total || 0
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    loading.value = false
  }
}

function searchDomains() {
  domainsPage.value = 1
  loadDomains()
}

function goToDomainsPage(newPage: number) {
  if (newPage >= 1 && newPage <= domainsTotalPages.value) {
    domainsPage.value = newPage
    loadDomains()
  }
}

// ===== 退订管理 =====
const showUnsubModal = ref(false)
const unsubTarget = ref<any>(null)
const unsubForm = ref({
  refundType: 'none' as 'none' | 'full' | 'remaining',
  reason: ''
})

function openUnsubModal(sub: any) {
  unsubTarget.value = sub
  unsubForm.value = { refundType: 'none', reason: '' }
  showUnsubModal.value = true
}

async function handleUnsubscribe() {
  if (!unsubTarget.value) return
  if (unsubForm.value.refundType !== 'none' && !unsubForm.value.reason.trim()) {
    toast.error(t('admin.mail.unsub.reasonRequired'))
    return
  }

  actionLoading.value = 'unsub'
  try {
    const result = await api.mail.adminCancelSubscription(unsubTarget.value.id, {
      refundType: unsubForm.value.refundType,
      reason: unsubForm.value.refundType !== 'none' ? unsubForm.value.reason.trim() : undefined
    })
    if (result.refundAmount > 0) {
      toast.success(t('admin.mail.unsub.successWithRefund', { amount: result.refundAmount.toFixed(2) }))
    } else {
      toast.success(t('admin.mail.unsub.success'))
    }
    showUnsubModal.value = false
    await loadSubscriptions()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    actionLoading.value = ''
  }
}

function formatPrice(price: number | string | null | undefined) {
  const num = Number(price) || 0
  return `¥${num.toFixed(2)}`
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString()
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'active':
    case 'verified': return 'badge-success'
    case 'pending': return 'badge-warning'
    case 'expired':
    case 'suspended': return 'badge-error'
    default: return 'badge-ghost'
  }
}

const regionOptions = [
  { code: 'us', name: '美国' },
  { code: 'nl', name: '荷兰' }
]
</script>

<template>
  <div class="kawaii-page space-y-6 animate-fade-in">
    <!-- Header -->
    <div class="page-header">
      <div class="flex items-center gap-3">
        <span class="nimbus-title-icon">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M3 8.25V18a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5V8.25m-18 0A1.5 1.5 0 0 1 4.5 6.75h15A1.5 1.5 0 0 1 21 8.25m-18 0 8.303 5.19a1.5 1.5 0 0 0 1.594 0L21 8.25" />
          </svg>
        </span>
        <div>
          <h1 class="page-title">{{ t('admin.mail.title') }}</h1>
          <p class="page-description">{{ t('admin.mail.description') }}</p>
        </div>
      </div>
    </div>

    <!-- TAB 切换 -->
    <div class="flex flex-wrap gap-1 border-b border-themed">
      <button
        class="-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
        :class="activeTab === 'sources'
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('sources')"
      >
        {{ t('admin.mail.tabs.sources') }}
      </button>
      <button
        class="-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
        :class="activeTab === 'plans'
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('plans')"
      >
        {{ t('admin.mail.tabs.plans') }}
      </button>
      <button
        class="-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
        :class="activeTab === 'subscriptions'
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('subscriptions')"
      >
        {{ t('admin.mail.tabs.subscriptions') }}
      </button>
      <button
        class="-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
        :class="activeTab === 'domains'
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('domains')"
      >
        {{ t('admin.mail.tabs.domains') }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card p-12 text-center">
      <div class="loading-spinner w-8 h-8 mx-auto"></div>
      <p class="text-themed-muted mt-4">{{ t('common.loading') }}</p>
    </div>

    <!-- 邮箱源 TAB -->
    <div v-else-if="activeTab === 'sources'" class="space-y-4">
      <div class="flex justify-end">
        <button class="btn btn-primary btn-sm" @click="openCreateSourceModal">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {{ t('admin.mail.createSource') }}
        </button>
      </div>

      <div v-if="sources.length === 0" class="card p-8 text-center text-themed-muted">
        {{ t('admin.mail.noSources') }}
      </div>

      <template v-else>
        <div class="space-y-3 lg:hidden">
          <div v-for="source in sources" :key="source.id" class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2">
                <FlagIcon :code="source.code" class="w-5 h-5 shrink-0" />
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-themed">{{ source.name }}</div>
                  <div class="text-xs uppercase text-themed-muted">{{ source.code }}</div>
                </div>
              </div>
              <div class="shrink-0 text-right text-sm text-themed">
                {{ source.planCount || 0 }} {{ t('admin.mail.plans') }}
              </div>
            </div>
            <div class="mt-3 break-all font-mono text-xs text-themed-muted">{{ source.apiUrl }}</div>
            <div class="mt-4 flex justify-end gap-2 border-t border-themed pt-3">
              <button class="btn btn-ghost btn-xs" @click="openEditSourceModal(source)">
                {{ t('common.edit') }}
              </button>
              <button
                class="btn btn-ghost btn-xs text-error"
                :disabled="actionLoading === `delete-source-${source.id}`"
                @click="deleteSource(source)"
              >
                <span v-if="actionLoading === `delete-source-${source.id}`" class="loading loading-spinner loading-xs"></span>
                <span v-else>{{ t('common.delete') }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="card hidden overflow-hidden lg:block">
          <table class="w-full table-fixed">
          <thead>
            <tr class="border-b border-themed">
              <th class="nimbus-th w-[12%]">{{ t('admin.mail.region') }}</th>
              <th class="nimbus-th w-[22%]">{{ t('common.name') }}</th>
              <th class="nimbus-th w-[38%]">{{ t('admin.mail.apiEndpoint') }}</th>
              <th class="nimbus-th w-[12%]">{{ t('admin.mail.plans') }}</th>
              <th class="nimbus-th nimbus-th-right w-[16%]">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="source in sources" :key="source.id" class="nimbus-row border-b border-themed">
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <FlagIcon :code="source.code" class="w-5 h-5" />
                  <span class="text-sm font-medium text-themed">{{ source.code.toUpperCase() }}</span>
                </div>
              </td>
              <td class="px-4 py-3 text-sm text-themed truncate">{{ source.name }}</td>
              <td class="px-4 py-3 font-mono text-xs text-themed-muted truncate" :title="source.apiUrl">{{ source.apiUrl }}</td>
              <td class="px-4 py-3 text-sm text-themed tabular-nums">{{ source.planCount || 0 }}</td>
              <td class="px-4 py-3 text-right">
                <button class="btn btn-ghost btn-xs" @click="openEditSourceModal(source)">
                  {{ t('common.edit') }}
                </button>
                <button
                  class="btn btn-ghost btn-xs text-error"
                  :disabled="actionLoading === `delete-source-${source.id}`"
                  @click="deleteSource(source)"
                >
                  <span v-if="actionLoading === `delete-source-${source.id}`" class="loading loading-spinner loading-xs"></span>
                  <span v-else>{{ t('common.delete') }}</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </template>
    </div>

    <!-- 方案 TAB -->
    <div v-else-if="activeTab === 'plans'" class="space-y-4">
      <div class="flex justify-end">
        <button class="btn btn-primary btn-sm" @click="openCreatePlanModal">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {{ t('admin.mail.createPlan') }}
        </button>
      </div>

      <div v-if="plans.length === 0" class="card p-8 text-center text-themed-muted">
        {{ t('admin.mail.noPlans') }}
      </div>

      <template v-else>
        <div class="space-y-3 lg:hidden">
          <div v-for="plan in plans" :key="plan.id" class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-themed">{{ plan.name }}</div>
                <div v-if="plan.description" class="mt-1 line-clamp-2 text-xs text-themed-muted">{{ plan.description }}</div>
              </div>
              <div class="shrink-0 text-right text-sm font-medium text-themed">
                {{ formatPrice(plan.price) }}/{{ plan.billingCycle === 'monthly' ? t('mail.month') : t('mail.year') }}
              </div>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div class="text-xs text-themed-muted">{{ t('admin.mail.source') }}</div>
                <div class="mt-1 truncate text-themed">{{ plan.source?.name || '-' }}</div>
              </div>
              <div>
                <div class="text-xs text-themed-muted">{{ t('admin.mail.domainLimit') }}</div>
                <div class="mt-1 text-themed">{{ plan.domainLimit }}</div>
              </div>
              <div>
                <div class="text-xs text-themed-muted">{{ t('admin.mail.diskLimit') }}</div>
                <div class="mt-1 text-themed">{{ plan.diskLimitGb }} GB</div>
              </div>
            </div>
            <div class="mt-4 flex justify-end gap-2 border-t border-themed pt-3">
              <button class="btn btn-ghost btn-xs" @click="openEditPlanModal(plan)">
                {{ t('common.edit') }}
              </button>
              <button
                class="btn btn-ghost btn-xs text-error"
                :disabled="actionLoading === `delete-plan-${plan.id}`"
                @click="deletePlan(plan)"
              >
                <span v-if="actionLoading === `delete-plan-${plan.id}`" class="loading loading-spinner loading-xs"></span>
                <span v-else>{{ t('common.delete') }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="card hidden overflow-hidden lg:block">
          <table class="w-full table-fixed">
          <thead>
            <tr class="border-b border-themed">
              <th class="nimbus-th w-[26%]">{{ t('common.name') }}</th>
              <th class="nimbus-th w-[18%]">{{ t('admin.mail.source') }}</th>
              <th class="nimbus-th w-[14%]">{{ t('admin.mail.domainLimit') }}</th>
              <th class="nimbus-th w-[14%]">{{ t('admin.mail.diskLimit') }}</th>
              <th class="nimbus-th w-[14%]">{{ t('admin.mail.price') }}</th>
              <th class="nimbus-th nimbus-th-right w-[14%]">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.id" class="nimbus-row border-b border-themed">
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-themed">{{ plan.name }}</div>
                <div v-if="plan.description" class="text-xs text-themed-muted truncate">{{ plan.description }}</div>
              </td>
              <td class="px-4 py-3 text-sm text-themed truncate">{{ plan.source?.name || '-' }}</td>
              <td class="px-4 py-3 text-sm text-themed tabular-nums">{{ plan.domainLimit }}</td>
              <td class="px-4 py-3 text-sm text-themed tabular-nums">{{ plan.diskLimitGb }} GB</td>
              <td class="px-4 py-3 text-sm font-medium text-themed tabular-nums">
                {{ formatPrice(plan.price) }}/{{ plan.billingCycle === 'monthly' ? t('mail.month') : t('mail.year') }}
              </td>
              <td class="px-4 py-3 text-right">
                <button class="btn btn-ghost btn-xs" @click="openEditPlanModal(plan)">
                  {{ t('common.edit') }}
                </button>
                <button
                  class="btn btn-ghost btn-xs text-error"
                  :disabled="actionLoading === `delete-plan-${plan.id}`"
                  @click="deletePlan(plan)"
                >
                  <span v-if="actionLoading === `delete-plan-${plan.id}`" class="loading loading-spinner loading-xs"></span>
                  <span v-else>{{ t('common.delete') }}</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </template>
    </div>

    <!-- 订阅 TAB -->
    <div v-else-if="activeTab === 'subscriptions'" class="space-y-4">
      <!-- 搜索框 -->
      <div class="flex items-center gap-3">
        <div class="relative flex-1 max-w-sm">
          <input 
            v-model="subscriptionsSearch" 
            type="text" 
            class="input w-full pl-10" 
            :placeholder="t('admin.mail.searchSubscriptions')"
            @keyup.enter="searchSubscriptions"
          />
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <button class="btn btn-primary btn-sm" @click="searchSubscriptions">
          {{ t('common.search') }}
        </button>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="card p-8 text-center text-themed-muted">
        {{ t('common.loading') }}
      </div>

      <!-- 无数据/搜索无结果 -->
      <div v-else-if="subscriptions.length === 0" class="card p-8 text-center text-themed-muted">
        {{ subscriptionsSearch ? t('common.noSearchResults') : t('admin.mail.noSubscriptions') }}
      </div>

      <template v-else>
        <div class="space-y-3 lg:hidden">
          <div v-for="sub in subscriptions" :key="sub.id" class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 items-center gap-3">
                <UserAvatar :username="sub.user?.username || ''" :email="sub.user?.email" :avatar-style="sub.user?.avatarStyle" :badge-id="sub.user?.avatarBadgeId || null" :size="32" />
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-themed">{{ sub.user?.username || '-' }}</div>
                  <div class="truncate text-xs text-themed-muted">ID: {{ sub.user?.id || '-' }} · {{ sub.user?.email || '-' }}</div>
                </div>
              </div>
              <span :class="['badge badge-sm shrink-0', getStatusBadge(sub.status)]">
                {{ t('mail.status.' + sub.status) }}
              </span>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div class="text-xs text-themed-muted">{{ t('admin.mail.plan') }}</div>
                <div class="mt-1 truncate text-themed">{{ sub.plan?.name || '-' }}</div>
              </div>
              <div>
                <div class="text-xs text-themed-muted">{{ t('admin.mail.expiresAt') }}</div>
                <div class="mt-1 text-themed">{{ formatDate(sub.expiresAt) }}</div>
              </div>
              <div>
                <div class="text-xs text-themed-muted">{{ t('common.createdAt') }}</div>
                <div class="mt-1 text-themed-muted">{{ formatDate(sub.createdAt) }}</div>
              </div>
            </div>
            <div class="mt-4 flex justify-end border-t border-themed pt-3">
              <button
                class="btn btn-ghost btn-xs text-error"
                :disabled="actionLoading === 'unsub'"
                @click="openUnsubModal(sub)"
              >
                {{ t('admin.mail.unsub.button') }}
              </button>
            </div>
          </div>
        </div>

        <div class="card hidden overflow-hidden lg:block">
          <table class="w-full table-fixed">
          <thead>
            <tr class="border-b border-themed">
              <th class="nimbus-th w-[30%]">{{ t('admin.mail.user') }}</th>
              <th class="nimbus-th w-[18%]">{{ t('admin.mail.plan') }}</th>
              <th class="nimbus-th w-[12%]">{{ t('common.status') }}</th>
              <th class="nimbus-th w-[16%]">{{ t('admin.mail.expiresAt') }}</th>
              <th class="nimbus-th w-[14%]">{{ t('common.createdAt') }}</th>
              <th class="nimbus-th nimbus-th-right w-[10%]">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sub in subscriptions" :key="sub.id" class="nimbus-row border-b border-themed">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <UserAvatar :username="sub.user?.username || ''" :email="sub.user?.email" :avatar-style="sub.user?.avatarStyle" :badge-id="sub.user?.avatarBadgeId || null" :size="32" />
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-themed">{{ sub.user?.username || '-' }}</div>
                    <div class="truncate text-xs text-themed-muted">ID: {{ sub.user?.id || '-' }} · {{ sub.user?.email || '-' }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 text-sm text-themed truncate">{{ sub.plan?.name || '-' }}</td>
              <td class="px-4 py-3">
                <span :class="['badge badge-sm', getStatusBadge(sub.status)]">
                  {{ t('mail.status.' + sub.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-themed tabular-nums">{{ formatDate(sub.expiresAt) }}</td>
              <td class="px-4 py-3 text-sm text-themed-muted tabular-nums">{{ formatDate(sub.createdAt) }}</td>
              <td class="px-4 py-3 text-right">
                <button
                  class="btn btn-ghost btn-xs text-error"
                  :disabled="actionLoading === 'unsub'"
                  @click="openUnsubModal(sub)"
                >
                  {{ t('admin.mail.unsub.button') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </template>

      <!-- 订阅分页 -->
      <div v-if="totalSubscriptions > 0" class="flex items-center justify-between text-sm text-themed-muted">
        <span>{{ t('common.totalRecords', { count: totalSubscriptions }) }}</span>
        <div v-if="subscriptionsTotalPages > 1" class="flex items-center gap-2">
          <button 
            class="btn btn-sm btn-ghost" 
            :disabled="subscriptionsPage <= 1"
            @click="goToSubscriptionsPage(subscriptionsPage - 1)"
          >
            {{ t('common.prevPage') }}
          </button>
          <span>{{ subscriptionsPage }} / {{ subscriptionsTotalPages }}</span>
          <button 
            class="btn btn-sm btn-ghost" 
            :disabled="subscriptionsPage >= subscriptionsTotalPages"
            @click="goToSubscriptionsPage(subscriptionsPage + 1)"
          >
            {{ t('common.nextPage') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 域名 TAB -->
    <div v-else-if="activeTab === 'domains'" class="space-y-4">
      <!-- 搜索框 -->
      <div class="flex items-center gap-3">
        <div class="relative flex-1 max-w-sm">
          <input 
            v-model="domainsSearch" 
            type="text" 
            class="input w-full pl-10" 
            :placeholder="t('admin.mail.searchDomains')"
            @keyup.enter="searchDomains"
          />
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <button class="btn btn-primary btn-sm" @click="searchDomains">
          {{ t('common.search') }}
        </button>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="card p-8 text-center text-themed-muted">
        {{ t('common.loading') }}
      </div>

      <!-- 无数据/搜索无结果 -->
      <div v-else-if="domains.length === 0" class="card p-8 text-center text-themed-muted">
        {{ domainsSearch ? t('common.noSearchResults') : t('admin.mail.noDomains') }}
      </div>

      <template v-else>
        <div class="space-y-3 lg:hidden">
          <div v-for="domain in domains" :key="domain.id" class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="break-all text-sm font-medium text-themed">{{ domain.domain }}</div>
                <div class="mt-1 text-xs text-themed-muted">{{ t('common.createdAt') }}: {{ formatDate(domain.createdAt) }}</div>
              </div>
              <span :class="['badge badge-sm shrink-0', getStatusBadge(domain.status)]">
                {{ t('mail.domainStatus.' + domain.status) }}
              </span>
            </div>
            <div class="mt-4 flex items-center gap-3">
              <UserAvatar :username="domain.subscription?.user?.username || ''" :email="domain.subscription?.user?.email" :avatar-style="domain.subscription?.user?.avatarStyle" :badge-id="domain.subscription?.user?.avatarBadgeId || null" :size="32" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-themed">{{ domain.subscription?.user?.username || '-' }}</div>
                <div class="truncate text-xs text-themed-muted">ID: {{ domain.subscription?.user?.id || '-' }} · {{ domain.subscription?.user?.email || '-' }}</div>
              </div>
              <div class="shrink-0 text-right text-sm text-themed">
                {{ domain._count?.accounts || 0 }} {{ t('admin.mail.accounts') }}
              </div>
            </div>
          </div>
        </div>

        <div class="card hidden overflow-hidden lg:block">
          <table class="w-full table-fixed">
          <thead>
            <tr class="border-b border-themed">
              <th class="nimbus-th w-[26%]">{{ t('admin.mail.domain') }}</th>
              <th class="nimbus-th w-[32%]">{{ t('admin.mail.user') }}</th>
              <th class="nimbus-th w-[14%]">{{ t('common.status') }}</th>
              <th class="nimbus-th w-[12%]">{{ t('admin.mail.accounts') }}</th>
              <th class="nimbus-th w-[16%]">{{ t('common.createdAt') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="domain in domains" :key="domain.id" class="nimbus-row border-b border-themed">
              <td class="px-4 py-3 font-mono text-sm font-medium text-themed truncate" :title="domain.domain">{{ domain.domain }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <UserAvatar :username="domain.subscription?.user?.username || ''" :email="domain.subscription?.user?.email" :avatar-style="domain.subscription?.user?.avatarStyle" :badge-id="domain.subscription?.user?.avatarBadgeId || null" :size="32" />
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-themed">{{ domain.subscription?.user?.username || '-' }}</div>
                    <div class="truncate text-xs text-themed-muted">ID: {{ domain.subscription?.user?.id || '-' }} · {{ domain.subscription?.user?.email || '-' }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3">
                <span :class="['badge badge-sm', getStatusBadge(domain.status)]">
                  {{ t('mail.domainStatus.' + domain.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-themed tabular-nums">{{ domain._count?.accounts || 0 }}</td>
              <td class="px-4 py-3 text-sm text-themed-muted tabular-nums">{{ formatDate(domain.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </template>

      <!-- 域名分页 -->
      <div v-if="totalDomains > 0" class="flex items-center justify-between text-sm text-themed-muted">
        <span>{{ t('common.totalRecords', { count: totalDomains }) }}</span>
        <div v-if="domainsTotalPages > 1" class="flex items-center gap-2">
          <button 
            class="btn btn-sm btn-ghost" 
            :disabled="domainsPage <= 1"
            @click="goToDomainsPage(domainsPage - 1)"
          >
            {{ t('common.prevPage') }}
          </button>
          <span>{{ domainsPage }} / {{ domainsTotalPages }}</span>
          <button 
            class="btn btn-sm btn-ghost" 
            :disabled="domainsPage >= domainsTotalPages"
            @click="goToDomainsPage(domainsPage + 1)"
          >
            {{ t('common.nextPage') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 邮箱源弹窗 -->
    <Teleport to="body">
      <div v-if="showSourceModal" class="modal-overlay">
        <div class="modal-backdrop" @click="showSourceModal = false"></div>
        <div class="modal-content max-w-lg">
          <div class="modal-header">
            <h3 class="modal-title flex items-center gap-2">
              <svg class="h-5 w-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M3 8.25V18a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5V8.25m-18 0A1.5 1.5 0 0 1 4.5 6.75h15A1.5 1.5 0 0 1 21 8.25m-18 0 8.303 5.19a1.5 1.5 0 0 0 1.594 0L21 8.25" />
              </svg>
              {{ editingSource ? t('admin.mail.editSource') : t('admin.mail.createSource') }}
            </h3>
            <button class="btn btn-ghost btn-sm" @click="showSourceModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="modal-body space-y-4">
            <label class="block space-y-1.5">
              <span class="nimbus-field-label">{{ t('common.name') }} *</span>
              <input v-model="sourceForm.name" type="text" class="input w-full" :placeholder="t('admin.mail.sourcePlaceholder')" />
            </label>
            <label class="block space-y-1.5">
              <span class="nimbus-field-label">{{ t('admin.mail.region') }} *</span>
              <select v-model="sourceForm.code" class="input w-full">
                <option v-for="opt in regionOptions" :key="opt.code" :value="opt.code">
                  {{ opt.name }} ({{ opt.code.toUpperCase() }})
                </option>
              </select>
            </label>
            <label class="block space-y-1.5">
              <span class="nimbus-field-label">{{ t('admin.mail.apiEndpoint') }} *</span>
              <input v-model="sourceForm.apiUrl" type="text" class="input w-full" placeholder="https://api.cranemail.com" />
            </label>
            <label class="block space-y-1.5">
              <span class="nimbus-field-label">{{ t('admin.mail.apiKey') }}</span>
              <input
                v-model="sourceForm.apiKey"
                type="password"
                class="input w-full"
                :placeholder="editingSource ? '留空表示不更改 API Key' : ''"
              />
            </label>
            <label class="block space-y-1.5">
              <span class="nimbus-field-label">{{ t('admin.mail.webmailUrl') }}</span>
              <input v-model="sourceForm.smarterMailUrl" type="text" class="input w-full" placeholder="https://smartermail.example.com" />
            </label>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showSourceModal = false">{{ t('common.cancel') }}</button>
            <button 
              class="btn btn-primary" 
              :disabled="actionLoading === 'save-source'"
              @click="saveSource"
            >
              <span v-if="actionLoading === 'save-source'" class="loading-spinner w-4 h-4 mr-2"></span>
              {{ t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 方案弹窗 -->
    <Teleport to="body">
      <div v-if="showPlanModal" class="modal-overlay">
        <div class="modal-backdrop" @click="showPlanModal = false"></div>
        <div class="modal-content max-w-lg">
          <div class="modal-header">
            <h3 class="modal-title flex items-center gap-2">
              <svg class="h-5 w-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" />
              </svg>
              {{ editingPlan ? t('admin.mail.editPlan') : t('admin.mail.createPlan') }}
            </h3>
            <button class="btn btn-ghost btn-sm" @click="showPlanModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="modal-body space-y-4">
            <label class="block space-y-1.5">
              <span class="nimbus-field-label">{{ t('admin.mail.source') }} *</span>
              <select v-model="planForm.sourceId" class="input w-full">
                <option v-for="source in sources" :key="source.id" :value="source.id">
                  {{ source.name }}
                </option>
              </select>
            </label>
            <label class="block space-y-1.5">
              <span class="nimbus-field-label">{{ t('common.name') }} *</span>
              <input v-model="planForm.name" type="text" class="input w-full" :placeholder="t('admin.mail.planPlaceholder')" />
            </label>
            <label class="block space-y-1.5">
              <span class="nimbus-field-label">{{ t('common.description') }}</span>
              <textarea v-model="planForm.description" class="input w-full" rows="2"></textarea>
            </label>
            <div class="grid grid-cols-2 gap-4">
              <label class="block space-y-1.5">
                <span class="nimbus-field-label">{{ t('admin.mail.domainLimit') }} *</span>
                <input v-model.number="planForm.domainLimit" type="number" min="1" class="input w-full" />
              </label>
              <label class="block space-y-1.5">
                <span class="nimbus-field-label">{{ t('admin.mail.diskLimitGb') }} *</span>
                <input v-model.number="planForm.diskLimitGb" type="number" min="1" class="input w-full" />
              </label>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <label class="block space-y-1.5">
                <span class="nimbus-field-label">{{ t('admin.mail.price') }} (¥) *</span>
                <input v-model.number="planForm.price" type="number" min="0" step="0.01" class="input w-full" />
              </label>
              <label class="block space-y-1.5">
                <span class="nimbus-field-label">{{ t('admin.mail.billingCycle') }} *</span>
                <select v-model="planForm.billingCycle" class="input w-full">
                  <option value="monthly">{{ t('mail.monthly') }}</option>
                  <option value="yearly">{{ t('mail.yearly') }}</option>
                </select>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showPlanModal = false">{{ t('common.cancel') }}</button>
            <button 
              class="btn btn-primary" 
              :disabled="actionLoading === 'save-plan'"
              @click="savePlan"
            >
              <span v-if="actionLoading === 'save-plan'" class="loading-spinner w-4 h-4 mr-2"></span>
              {{ t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 退订弹窗 -->
    <Teleport to="body">
      <div v-if="showUnsubModal" class="modal-overlay">
        <div class="modal-backdrop" @click="showUnsubModal = false"></div>
        <div class="modal-content max-w-lg">
          <div class="modal-header">
            <h3 class="modal-title flex items-center gap-2">
              <svg class="h-5 w-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              {{ t('admin.mail.unsub.title') }}
            </h3>
            <button class="btn btn-ghost btn-sm" @click="showUnsubModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div v-if="unsubTarget" class="modal-body">
            <!-- 订阅信息 -->
            <div class="rounded-lg p-3 mb-4" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
              <div class="text-sm space-y-1">
                <div class="flex justify-between">
                  <span class="text-themed-muted">{{ t('admin.mail.user') }}</span>
                  <span class="text-themed font-medium">{{ unsubTarget.user?.username }} (ID: {{ unsubTarget.user?.id }})</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-themed-muted">{{ t('admin.mail.plan') }}</span>
                  <span class="text-themed">{{ unsubTarget.plan?.name }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-themed-muted">{{ t('admin.mail.price') }}</span>
                  <span class="text-themed">{{ formatPrice(unsubTarget.plan?.price) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-themed-muted">{{ t('admin.mail.expiresAt') }}</span>
                  <span class="text-themed">{{ formatDate(unsubTarget.expiresAt) }}</span>
                </div>
              </div>
            </div>

            <!-- 退款方式 -->
            <div class="mb-4">
              <span class="nimbus-field-label mb-2 block">{{ t('admin.mail.unsub.refundType') }}</span>
              <div class="space-y-2">
                <label class="flex items-center gap-3 p-2 rounded-lg cursor-pointer" :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'">
                  <input v-model="unsubForm.refundType" type="radio" value="none" class="radio radio-sm" />
                  <div>
                    <div class="text-sm font-medium text-themed">{{ t('admin.mail.unsub.refundNone') }}</div>
                    <div class="text-xs text-themed-muted">{{ t('admin.mail.unsub.refundNoneDesc') }}</div>
                  </div>
                </label>
                <label class="flex items-center gap-3 p-2 rounded-lg cursor-pointer" :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'">
                  <input v-model="unsubForm.refundType" type="radio" value="full" class="radio radio-sm" />
                  <div>
                    <div class="text-sm font-medium text-themed">{{ t('admin.mail.unsub.refundFull') }}</div>
                    <div class="text-xs text-themed-muted">{{ t('admin.mail.unsub.refundFullDesc', { amount: formatPrice(unsubTarget.plan?.price) }) }}</div>
                  </div>
                </label>
                <label class="flex items-center gap-3 p-2 rounded-lg cursor-pointer" :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'">
                  <input v-model="unsubForm.refundType" type="radio" value="remaining" class="radio radio-sm" />
                  <div>
                    <div class="text-sm font-medium text-themed">{{ t('admin.mail.unsub.refundRemaining') }}</div>
                    <div class="text-xs text-themed-muted">{{ t('admin.mail.unsub.refundRemainingDesc') }}</div>
                  </div>
                </label>
              </div>
            </div>

            <!-- 退款原因 -->
            <div v-if="unsubForm.refundType !== 'none'">
              <span class="nimbus-field-label mb-2 block">{{ t('admin.mail.unsub.reason') }} *</span>
              <textarea
                v-model="unsubForm.reason" 
                class="input w-full" 
                rows="3" 
                :placeholder="t('admin.mail.unsub.reasonPlaceholder')"
              ></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showUnsubModal = false">{{ t('common.cancel') }}</button>
            <button 
              class="btn btn-error" 
              :disabled="actionLoading === 'unsub'"
              @click="handleUnsubscribe"
            >
              <span v-if="actionLoading === 'unsub'" class="loading-spinner w-4 h-4 mr-2"></span>
              {{ t('admin.mail.unsub.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
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

.nimbus-th-right {
  text-align: right;
}

.nimbus-row {
  transition: background-color 0.12s ease;
}

.nimbus-row:hover {
  background: color-mix(in srgb, var(--kawaii-primary) 5%, transparent);
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
