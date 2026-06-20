<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import VipLevelRulesEditor from '@/components/admin/VipLevelRulesEditor.vue'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { getVipBadgeInlineStyle, normalizeVipBadgeStyle } from '@/utils/vipBadge'

type HostingOwnersResponse = Awaited<ReturnType<typeof api.admin.getHostingOwners>>
type HostingOwner = HostingOwnersResponse['owners'][number]
type HostingZonesResponse = Awaited<ReturnType<typeof api.admin.getHostingZones>>
type HostingZone = HostingZonesResponse['zones'][number]
type HostingOwnerSortBy = 'vipLevel' | 'hostingBalance' | 'frozenBalance' | 'totalIncome' | 'hostCount' | 'packageCount' | 'instanceCount'
type SortOrder = 'asc' | 'desc'

const { t, locale } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

const activeTab = ref<'owners' | 'zones' | 'hostingVipLevels'>('owners')
const owners = ref<HostingOwner[]>([])
const zones = ref<HostingZone[]>([])
const summary = ref<HostingOwnersResponse['summary'] | null>(null)
const loading = ref(true)
const zonesLoading = ref(false)
const creatingZone = ref(false)
const deletingZoneId = ref<number | null>(null)
const search = ref('')
const zoneOwnerSearch = ref('')
const page = ref(1)
const pageSize = ref(50)
const total = ref(0)
const totalPages = ref(1)
const sortBy = ref<HostingOwnerSortBy>('totalIncome')
const sortOrder = ref<SortOrder>('desc')
const zoneForm = ref({
  name: '',
  ownerId: null as number | null,
  logoUrl: ''
})
let searchTimer: ReturnType<typeof setTimeout> | null = null
let zoneOwnerSearchTimer: ReturnType<typeof setTimeout> | null = null
let requestSeq = 0
let zonesRequestSeq = 0

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))
const moneyFormatter = computed(() =>
  new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2
  })
)
const dateTimeFormatter = computed(() =>
  new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
)

const summaryCards = computed(() => [
  {
    key: 'owners',
    label: t('admin.hosting.cards.owners'),
    value: numberFormatter.value.format(total.value),
    caption: t('admin.hosting.cards.ownersCaption')
  },
  {
    key: 'hosts',
    label: t('admin.hosting.cards.hosts'),
    value: numberFormatter.value.format(summary.value?.totalHosts || 0),
    caption: t('admin.hosting.cards.hostsCaption')
  },
  {
    key: 'instances',
    label: t('admin.hosting.cards.instances'),
    value: numberFormatter.value.format(summary.value?.totalInstances || 0),
    caption: t('admin.hosting.cards.instancesCaption')
  },
  {
    key: 'income',
    label: t('admin.hosting.cards.totalIncome'),
    value: formatMoney(summary.value?.totalHostingIncome || 0),
    caption: t('admin.hosting.cards.totalIncomeCaption')
  }
])

const sortableOwnerColumns: Array<{
  key: HostingOwnerSortBy
  labelKey: string
  align: 'left' | 'right'
}> = [
  { key: 'vipLevel', labelKey: 'admin.hosting.owners.vipLevel', align: 'left' },
  { key: 'hostingBalance', labelKey: 'admin.hosting.owners.hostingBalance', align: 'right' },
  { key: 'frozenBalance', labelKey: 'admin.hosting.owners.frozenBalance', align: 'right' },
  { key: 'totalIncome', labelKey: 'admin.hosting.owners.totalIncome', align: 'right' },
  { key: 'hostCount', labelKey: 'admin.hosting.owners.hostCount', align: 'right' },
  { key: 'packageCount', labelKey: 'admin.hosting.owners.packageCount', align: 'right' },
  { key: 'instanceCount', labelKey: 'admin.hosting.owners.instanceCount', align: 'right' }
]

onMounted(() => {
  void loadOwners()
  void loadZones()
})

onBeforeUnmount(() => {
  requestSeq += 1
  zonesRequestSeq += 1
  if (searchTimer) clearTimeout(searchTimer)
  if (zoneOwnerSearchTimer) clearTimeout(zoneOwnerSearchTimer)
})

watch(search, () => {
  if (activeTab.value !== 'owners') return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    void loadOwners()
  }, 300)
})

watch(zoneOwnerSearch, () => {
  if (activeTab.value !== 'zones') return
  if (zoneOwnerSearchTimer) clearTimeout(zoneOwnerSearchTimer)
  zoneOwnerSearchTimer = setTimeout(() => {
    page.value = 1
    void loadOwners()
  }, 300)
})

const availableZoneOwners = computed(() => owners.value.filter(owner => !owner.hostingZoneId || owner.id === zoneForm.value.ownerId))

async function loadOwners() {
  const currentRequest = ++requestSeq
  loading.value = true
  try {
    const response = await api.admin.getHostingOwners({
      page: page.value,
      pageSize: pageSize.value,
      search: (activeTab.value === 'zones' ? zoneOwnerSearch.value.trim() : search.value.trim()) || undefined,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value
    })
    if (currentRequest !== requestSeq) return
    owners.value = response.owners || []
    summary.value = response.summary
    total.value = response.total || 0
    totalPages.value = response.totalPages || 1
  } catch (error: any) {
    if (currentRequest !== requestSeq) return
    toast.error(t('admin.hosting.loadFailed', { message: error?.message || t('admin.hosting.unknownError') }))
  } finally {
    if (currentRequest === requestSeq) {
      loading.value = false
    }
  }
}

async function loadZones() {
  const currentRequest = ++zonesRequestSeq
  zonesLoading.value = true
  try {
    const response = await api.admin.getHostingZones()
    if (currentRequest !== zonesRequestSeq) return
    zones.value = response.zones || []
  } catch (error: any) {
    if (currentRequest !== zonesRequestSeq) return
    toast.error(t('admin.hosting.zones.loadFailed', { message: error?.message || t('admin.hosting.unknownError') }))
  } finally {
    if (currentRequest === zonesRequestSeq) {
      zonesLoading.value = false
    }
  }
}

async function switchTab(tab: 'owners' | 'zones' | 'hostingVipLevels') {
  activeTab.value = tab
  if (tab === 'owners') {
    await loadOwners()
  } else if (tab === 'zones') {
    page.value = 1
    await Promise.all([loadOwners(), loadZones()])
  }
}

async function refreshActiveTab() {
  if (activeTab.value === 'zones') {
    await Promise.all([loadOwners(), loadZones()])
  } else if (activeTab.value === 'owners') {
    await loadOwners()
  }
}

function changePage(nextPage: number) {
  const normalizedPage = Math.min(Math.max(1, nextPage), totalPages.value)
  if (normalizedPage === page.value) return
  page.value = normalizedPage
  void loadOwners()
}

function changePageSize() {
  page.value = 1
  void loadOwners()
}

function toggleOwnerSort(column: HostingOwnerSortBy) {
  if (sortBy.value === column) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = column
    sortOrder.value = 'desc'
  }
  page.value = 1
  void loadOwners()
}

function getSortAria(column: HostingOwnerSortBy): 'ascending' | 'descending' | 'none' {
  if (sortBy.value !== column) return 'none'
  return sortOrder.value === 'asc' ? 'ascending' : 'descending'
}

function isValidLogoUrl(value: string): boolean {
  if (!value || value.length > 2048 || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}

async function createZone() {
  const name = zoneForm.value.name.trim()
  const ownerId = zoneForm.value.ownerId
  const logoUrl = zoneForm.value.logoUrl.trim()

  if (!name || !ownerId || !logoUrl) {
    toast.error(t('admin.hosting.zones.formRequired'))
    return
  }
  if (!isValidLogoUrl(logoUrl)) {
    toast.error(t('admin.hosting.zones.logoInvalid'))
    return
  }

  creatingZone.value = true
  try {
    await api.admin.createHostingZone({ name, ownerId, logoUrl })
    toast.success(t('admin.hosting.zones.createSuccess'))
    zoneForm.value = { name: '', ownerId: null, logoUrl: '' }
    await Promise.all([loadOwners(), loadZones()])
  } catch (error: any) {
    toast.error(error?.message || t('admin.hosting.zones.createFailed'))
  } finally {
    creatingZone.value = false
  }
}

async function deleteZone(zone: HostingZone) {
  if (!window.confirm(t('admin.hosting.zones.deleteConfirm', { name: zone.name }))) return
  deletingZoneId.value = zone.id
  try {
    await api.admin.deleteHostingZone(zone.id)
    toast.success(t('admin.hosting.zones.deleteSuccess'))
    await Promise.all([loadOwners(), loadZones()])
  } catch (error: any) {
    toast.error(error?.message || t('admin.hosting.zones.deleteFailed'))
  } finally {
    deletingZoneId.value = null
  }
}

function formatMoney(value: number): string {
  return moneyFormatter.value.format(value || 0)
}

function formatDate(value: string): string {
  if (!value) return '-'
  return dateTimeFormatter.value.format(new Date(value))
}
</script>

<template>
  <div class="animate-fade-in">
    <div class="page-header flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="page-title">{{ t('admin.hosting.title') }}</h1>
        <p class="text-sm text-themed-muted mt-1">{{ t('admin.hosting.description') }}</p>
      </div>
      <button
        v-if="activeTab !== 'hostingVipLevels'"
        class="btn btn-secondary self-start lg:self-auto"
        :disabled="loading || zonesLoading"
        @click="refreshActiveTab"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 4v5h.58m15.36 2A8 8 0 0 0 5.07 8.11M20 20v-5h-.58m0 0A8 8 0 0 1 4.06 12.03" />
        </svg>
        {{ t('common.refresh') }}
      </button>
    </div>

    <div class="border-b border-themed mb-6 overflow-x-auto whitespace-nowrap">
      <button
        class="px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeTab === 'owners'
          ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('owners')"
      >
        {{ t('admin.hosting.tabs.owners') }}
      </button>
      <button
        class="px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeTab === 'zones'
          ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('zones')"
      >
        {{ t('admin.hosting.tabs.zones') }}
      </button>
      <button
        class="px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeTab === 'hostingVipLevels'
          ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('hostingVipLevels')"
      >
        {{ t('admin.hosting.tabs.hostingVipLevels') }}
      </button>
    </div>

    <div v-if="activeTab === 'owners' && loading && owners.length === 0" class="space-y-6">
      <SkeletonLoader type="stats" />
      <SkeletonLoader type="table" />
    </div>

    <div v-else-if="activeTab === 'owners'" class="space-y-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div v-for="card in summaryCards" :key="card.key" class="card p-4">
          <p class="text-sm text-themed-muted">{{ card.label }}</p>
          <p class="mt-2 text-2xl font-semibold text-themed">{{ card.value }}</p>
          <p class="mt-1 text-xs text-themed-faint">{{ card.caption }}</p>
        </div>
      </div>

      <section class="card overflow-hidden">
        <div class="p-4 border-b border-themed flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-base font-semibold text-themed">{{ t('admin.hosting.owners.title') }}</h2>
            <p class="text-sm text-themed-muted mt-1">{{ t('admin.hosting.owners.description') }}</p>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div class="relative sm:w-72">
              <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
              </svg>
              <input
                v-model="search"
                type="text"
                class="input pl-9"
                :placeholder="t('admin.hosting.owners.searchPlaceholder')"
              />
            </div>
            <select v-model.number="pageSize" class="input sm:w-28" @change="changePageSize">
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </div>
        </div>

        <div v-if="loading" class="p-6">
          <SkeletonLoader type="table" />
        </div>

        <div v-else-if="owners.length === 0" class="p-12 text-center">
          <p class="text-themed-secondary">{{ t('admin.hosting.owners.empty') }}</p>
          <p class="text-sm text-themed-muted mt-2">{{ t('admin.hosting.owners.emptyHint') }}</p>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[1040px]">
            <thead class="bg-themed-secondary border-b border-themed">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-themed-muted uppercase tracking-wider">{{ t('admin.hosting.owners.user') }}</th>
                <th
                  v-for="column in sortableOwnerColumns"
                  :key="column.key"
                  class="px-4 py-3 text-xs font-medium text-themed-muted uppercase tracking-wider"
                  :class="column.align === 'right' ? 'text-right' : 'text-left'"
                  :aria-sort="getSortAria(column.key)"
                >
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded px-1.5 py-1 -mx-1.5 -my-1 transition-colors hover:bg-themed-hover hover:text-themed"
                    :class="[
                      column.align === 'right' ? 'justify-end' : 'justify-start',
                      sortBy === column.key ? 'text-themed' : ''
                    ]"
                    @click="toggleOwnerSort(column.key)"
                  >
                    <span>{{ t(column.labelKey) }}</span>
                    <span class="inline-flex w-3 justify-center text-[10px] leading-none text-themed-muted">
                      <template v-if="sortBy === column.key">{{ sortOrder === 'asc' ? '↑' : '↓' }}</template>
                      <template v-else>↕</template>
                    </span>
                  </button>
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-themed-muted uppercase tracking-wider">{{ t('admin.hosting.owners.createdAt') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed">
              <tr v-for="owner in owners" :key="owner.id" class="hover:bg-themed-hover">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      :username="owner.username"
                      :email="owner.email"
                      :avatar-style="owner.avatarStyle"
                      :badge-id="owner.avatarBadgeId"
                      :size="36"
                    />
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-medium text-themed truncate">{{ owner.username }}</span>
                        <span class="text-xs text-themed-muted">#{{ owner.id }}</span>
                      </div>
                      <div class="text-xs text-themed-muted truncate">{{ owner.email || t('admin.hosting.owners.noEmail') }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span
                    class="badge border"
                    :class="owner.vipLevel > 0 ? '' : 'badge-default'"
                    :style="owner.vipLevel > 0 ? getVipBadgeInlineStyle(normalizeVipBadgeStyle(owner.vipBadgeStyle, owner.vipLevel)) : undefined"
                  >
                    VIP {{ owner.vipLevel }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right font-mono text-sm text-themed whitespace-nowrap">
                  {{ formatMoney(owner.hostingBalance.available) }}
                </td>
                <td class="px-4 py-3 text-right font-mono text-sm text-amber-600 dark:text-amber-400 whitespace-nowrap">
                  {{ formatMoney(owner.hostingBalance.frozen) }}
                </td>
                <td class="px-4 py-3 text-right font-mono text-sm text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                  {{ formatMoney(owner.hostingBalance.historicalTotal) }}
                </td>
                <td class="px-4 py-3 text-right text-sm text-themed whitespace-nowrap">{{ numberFormatter.format(owner.hostCount) }}</td>
                <td class="px-4 py-3 text-right text-sm text-themed whitespace-nowrap">{{ numberFormatter.format(owner.listedPackageCount) }}</td>
                <td class="px-4 py-3 text-right text-sm text-themed whitespace-nowrap">{{ numberFormatter.format(owner.instanceCount) }}</td>
                <td class="px-4 py-3 text-sm text-themed-muted whitespace-nowrap">{{ formatDate(owner.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="px-4 py-3 border-t border-themed flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span class="text-sm text-themed-muted">
            {{ t('common.total') }} {{ numberFormatter.format(total) }} {{ t('common.items') }}
          </span>
          <div class="flex items-center gap-2">
            <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="changePage(page - 1)">
              {{ t('common.prevPage') }}
            </button>
            <span class="text-sm text-themed-muted">{{ page }} / {{ totalPages }}</span>
            <button class="btn btn-ghost btn-sm" :disabled="page >= totalPages" @click="changePage(page + 1)">
              {{ t('common.nextPage') }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <div v-else-if="activeTab === 'zones'" class="space-y-6">
      <section class="card p-4">
        <div class="mb-4">
          <h2 class="text-base font-semibold text-themed">{{ t('admin.hosting.zones.createTitle') }}</h2>
          <p class="text-sm text-themed-muted mt-1">{{ t('admin.hosting.zones.createDescription') }}</p>
        </div>

        <div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label class="block text-sm font-medium text-themed mb-2">{{ t('admin.hosting.zones.name') }}</label>
              <input
                v-model="zoneForm.name"
                type="text"
                maxlength="40"
                class="input"
                :placeholder="t('admin.hosting.zones.namePlaceholder')"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-themed mb-2">{{ t('admin.hosting.zones.logo') }}</label>
              <input
                v-model.trim="zoneForm.logoUrl"
                type="url"
                maxlength="2048"
                class="input"
                :placeholder="t('admin.hosting.zones.logoPlaceholder')"
              />
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosting.zones.logoHint') }}</p>
            </div>

            <div class="lg:col-span-2">
              <label class="block text-sm font-medium text-themed mb-2">{{ t('admin.hosting.zones.owner') }}</label>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <input
                  v-model="zoneOwnerSearch"
                  type="text"
                  class="input"
                  :placeholder="t('admin.hosting.zones.ownerSearchPlaceholder')"
                />
                <select v-model.number="zoneForm.ownerId" class="input">
                  <option value="">{{ t('admin.hosting.zones.selectOwner') }}</option>
                  <option
                    v-for="owner in availableZoneOwners"
                    :key="owner.id"
                    :value="owner.id"
                  >
                    {{ owner.username }} #{{ owner.id }} · {{ owner.email || t('admin.hosting.owners.noEmail') }}
                  </option>
                </select>
              </div>
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosting.zones.ownerHint') }}</p>
            </div>
          </div>

          <div class="rounded-md border border-themed bg-themed-secondary p-4 flex flex-col gap-4">
            <div class="flex items-center gap-3">
              <div class="w-14 h-14 rounded-full bg-themed-secondary border border-themed overflow-hidden flex shrink-0 items-center justify-center">
                <img
                  v-if="isValidLogoUrl(zoneForm.logoUrl)"
                  :src="zoneForm.logoUrl"
                  :alt="t('admin.hosting.zones.logoPreview')"
                  class="w-full h-full object-cover"
                />
                <span v-else class="text-xs text-themed-muted">{{ t('admin.hosting.zones.noLogo') }}</span>
              </div>
              <div class="min-w-0">
                <div class="text-sm font-medium text-themed truncate">
                  {{ zoneForm.name || t('admin.hosting.zones.previewName') }}
                </div>
                <div class="text-xs text-themed-muted mt-1">{{ t('admin.hosting.zones.previewHint') }}</div>
              </div>
            </div>
            <button class="btn btn-primary w-full justify-center" :disabled="creatingZone" @click="createZone">
              {{ creatingZone ? t('common.processing') : t('admin.hosting.zones.create') }}
            </button>
          </div>
        </div>
      </section>

      <section class="card overflow-hidden">
        <div class="p-4 border-b border-themed flex flex-col gap-1">
          <h2 class="text-base font-semibold text-themed">{{ t('admin.hosting.zones.title') }}</h2>
          <p class="text-sm text-themed-muted">{{ t('admin.hosting.zones.description') }}</p>
        </div>

        <div v-if="zonesLoading" class="p-6">
          <SkeletonLoader type="table" />
        </div>

        <div v-else-if="zones.length === 0" class="p-12 text-center">
          <p class="text-themed-secondary">{{ t('admin.hosting.zones.empty') }}</p>
          <p class="text-sm text-themed-muted mt-2">{{ t('admin.hosting.zones.emptyHint') }}</p>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[820px]">
            <thead class="bg-themed-secondary border-b border-themed">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-themed-muted uppercase tracking-wider">{{ t('admin.hosting.zones.zone') }}</th>
                <th class="text-left px-4 py-3 text-xs font-medium text-themed-muted uppercase tracking-wider">{{ t('admin.hosting.zones.owner') }}</th>
                <th class="text-right px-4 py-3 text-xs font-medium text-themed-muted uppercase tracking-wider">{{ t('admin.hosting.owners.hostCount') }}</th>
                <th class="text-right px-4 py-3 text-xs font-medium text-themed-muted uppercase tracking-wider">{{ t('admin.hosting.owners.packageCount') }}</th>
                <th class="text-left px-4 py-3 text-xs font-medium text-themed-muted uppercase tracking-wider">{{ t('admin.hosting.owners.createdAt') }}</th>
                <th class="text-right px-4 py-3 text-xs font-medium text-themed-muted uppercase tracking-wider">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed">
              <tr v-for="zone in zones" :key="zone.id" class="hover:bg-themed-hover">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <img :src="zone.logoUrl" :alt="zone.name" class="w-10 h-10 rounded-full object-cover border border-themed" />
                    <div class="min-w-0">
                      <div class="font-medium text-themed truncate">{{ zone.name }}</div>
                      <div class="text-xs text-themed-muted">#{{ zone.id }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      :username="zone.owner.username"
                      :email="zone.owner.email"
                      :avatar-style="zone.owner.avatarStyle"
                      :badge-id="zone.owner.avatarBadgeId"
                      :size="32"
                    />
                    <div class="min-w-0">
                      <div class="font-medium text-themed truncate">{{ zone.owner.username }} <span class="text-xs text-themed-muted">#{{ zone.owner.id }}</span></div>
                      <div class="text-xs text-themed-muted truncate">{{ zone.owner.email || t('admin.hosting.owners.noEmail') }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-right text-sm text-themed whitespace-nowrap">{{ numberFormatter.format(zone.hostCount) }}</td>
                <td class="px-4 py-3 text-right text-sm text-themed whitespace-nowrap">{{ numberFormatter.format(zone.listedPackageCount) }}</td>
                <td class="px-4 py-3 text-sm text-themed-muted whitespace-nowrap">{{ formatDate(zone.createdAt) }}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button class="btn btn-ghost btn-sm text-red-600 dark:text-red-400" :disabled="deletingZoneId === zone.id" @click="deleteZone(zone)">
                    {{ deletingZoneId === zone.id ? t('common.processing') : t('common.delete') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <VipLevelRulesEditor v-else-if="activeTab === 'hostingVipLevels'" type="hosting" />
  </div>
</template>
