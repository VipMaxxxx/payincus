<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { usePageSeo } from '@/composables/usePageSeo'
import { useBrand } from '@/composables/useBrand'
import FlagIcon from '@/components/FlagIcon.vue'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { getLocalizedCountryName } from '@/utils/countryDisplay'
import {
  formatPublicPrice,
  formatPublicTraffic,
  getStartingMonthlyPrice,
  normalizePackageSourceQuery,
  parsePackageIdQuery,
  parseTextQuery,
  type PublicPackage,
  type PublicRegion
} from '@/utils/publicCatalog'
import { freeSiteCopy, getFreeSiteBillingCycleLabel } from '@/utils/freeSiteFun'
import { instanceCreatePath, loginPath } from '@/utils/app-paths'

defineOptions({
  name: 'MarketView'
})

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const authStore = useAuthStore()
const configStore = useConfigStore()
const brand = useBrand()
void configStore.loadPublicConfig()

type PublicPackageSource = 'official' | 'market'

function normalizePublicPackageSource(value: unknown): PublicPackageSource {
  return normalizePackageSourceQuery(value) === 'market' ? 'market' : 'official'
}

const packageSource = ref<PublicPackageSource>(normalizePublicPackageSource(route.query.source))
const selectedRegion = ref<string | null>(parseTextQuery(route.query.region) || null)
const selectedPackageId = ref<number | null>(parsePackageIdQuery(route.query.package))
const selectedPlanId = ref<number | null>(parsePackageIdQuery(route.query.plan))
const searchQuery = ref(parseTextQuery(route.query.q))
const packages = ref<PublicPackage[]>([])
const regions = ref<PublicRegion[]>([])
const loading = ref(true)
const loadError = ref('')

let searchTimer: number | null = null

function getRegionLabel(code: string): string {
  return getLocalizedCountryName(code, locale.value, (key, fallback) => t(key, fallback))
}

const filteredPackages = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  let result = packages.value

  if (selectedRegion.value) {
    const region = regions.value.find(item => item.code === selectedRegion.value)
    if (region) {
      result = result.filter(pkg => region.packageIds.includes(pkg.id))
    } else {
      result = []
    }
  }

  if (query) {
    result = result.filter(pkg => {
      const text = [
        pkg.name,
        pkg.description || '',
        pkg.instance_type === 'vm' ? 'kvm' : 'lxc'
      ].join(' ').toLowerCase()
      return text.includes(query)
    })
  }

  return [...result].sort((left, right) => {
    if (left.soldOut !== right.soldOut) {
      return left.soldOut ? 1 : -1
    }

    const leftPrice = getStartingMonthlyPrice(left)
    const rightPrice = getStartingMonthlyPrice(right)

    if (leftPrice !== null && rightPrice !== null && leftPrice !== rightPrice) {
      return leftPrice - rightPrice
    }

    if (leftPrice === null && rightPrice !== null) {
      return -1
    }

    if (leftPrice !== null && rightPrice === null) {
      return 1
    }

    return left.name.localeCompare(right.name, 'zh')
  })
})

const selectedPackage = computed(() => {
  if (!selectedPackageId.value) {
    return null
  }

  return filteredPackages.value.find(pkg => pkg.id === selectedPackageId.value)
    || packages.value.find(pkg => pkg.id === selectedPackageId.value)
    || null
})

const selectedPlan = computed(() => {
  if (!selectedPackage.value || !selectedPlanId.value) {
    return null
  }

  return selectedPackage.value.plans.find(plan => plan.id === selectedPlanId.value && !plan.isSoldOut) || null
})

const ui = {
  body: 'text-themed-muted',
  title: 'text-themed',
  badge: 'kawaii-chip',
  badgeDot: 'kawaii-source-dot official',
  infoBanner: 'kawaii-market-notice',
  summaryCard: 'kawaii-stat-tile',
  summaryLabel: 'text-themed-muted',
  summaryValue: 'text-themed',
  filterWrap: 'kawaii-browse-wrap',
  chipActive: 'kawaii-market-pill active',
  chipIdle: 'kawaii-market-pill',
  searchInput: 'border-themed bg-themed text-themed placeholder:text-themed-muted focus:border-accent',
  searchClear: 'text-themed-muted hover:bg-themed-hover hover:text-themed',
  errorBanner: 'bg-red-500/10 text-red-500 border border-red-500/20',
  skeleton: 'kawaii-skeleton',
  emptyState: 'kawaii-empty-state',
  emptyStateTitle: 'text-themed',
  emptyStateButton: 'kawaii-primary-button',
  packageCard: 'kawaii-package-card text-themed',
  packageCardSelected: 'kawaii-package-card selected text-themed',
  packageCardMuted: 'text-themed-muted',
  chipKvm: 'kawaii-instance-chip vm',
  chipLxc: 'kawaii-instance-chip lxc',
  chipInStock: 'kawaii-market-status in-stock',
  chipSoldOut: 'kawaii-market-status sold-out',
  chipOfficial: 'kawaii-source-chip official',
  chipMarket: 'kawaii-source-chip market',
  statChip: 'border border-themed text-themed-muted',
  statDivider: 'border-themed',
  statBlockLabel: 'text-themed-muted',
  detailCard: 'kawaii-market-detail',
  detailSummaryCard: 'kawaii-stat-tile text-themed',
  detailSummaryLabel: 'text-themed-muted',
  detailSummaryIcon: 'text-accent',
  planIdle: 'kawaii-market-plan text-themed',
  planSelected: 'kawaii-market-plan selected text-themed',
  radioIdle: 'border-themed',
  radioActive: 'border-accent bg-accent',
  infoCard: 'kawaii-market-info',
  ctaButton: 'kawaii-primary-button'
}

const summaryCards = computed(() => [
  { label: t('publicSite.market.summary.total'), value: String(packages.value.length) },
  { label: t('publicSite.market.summary.available'), value: String(packages.value.filter(pkg => !pkg.soldOut).length) },
  { label: t('publicSite.market.summary.regions'), value: String(regions.value.length) },
  { label: t('publicSite.market.summary.source'), value: packageSource.value === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }
])

usePageSeo(() => {
  const selected = selectedPackage.value
  const plan = selectedPlan.value
  const origin = window.location.origin
  const canonical = selected
    ? `${origin}/market?source=${selected.sourceType}&package=${selected.id}${plan ? `&plan=${plan.id}` : ''}`
    : packageSource.value === 'market'
      ? `${origin}/market?source=market`
      : `${origin}/market`

  if (selected) {
    return {
      title: t('publicSite.seo.marketPackageTitle', { name: selected.name }).replace(/Incudal/g, brand.brandName),
      description: t('publicSite.seo.marketPackageDescription', {
        name: selected.name,
        type: selected.instance_type === 'vm' ? 'KVM' : 'LXC',
        traffic: formatTraffic(selected.monthly_traffic_limit)
      }),
      canonical,
      keywords: t('publicSite.seo.keywords').replace(/Incudal/g, brand.brandName)
    }
  }

  return {
    title: t('publicSite.seo.marketTitle').replace(/Incudal/g, brand.brandName),
    description: t('publicSite.seo.marketDescription'),
    canonical,
    keywords: t('publicSite.seo.keywords').replace(/Incudal/g, brand.brandName)
  }
})

const infoBannerText = computed(() => {
  if (!authStore.isAuthenticated && parsePackageIdQuery(route.query.package)) {
    return t('publicSite.market.buyLinkNotice')
  }

  return t('publicSite.market.publicNotice')
})

function formatTraffic(bytes: string | null): string {
  return formatPublicTraffic(bytes, t('common.unlimited'))
}

function formatMemory(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`
  }

  return `${mb} MB`
}

function formatDisk(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`
  }

  return `${mb} MB`
}

function getNetworkLabel(pkg: PublicPackage): string {
  return t(`common.networkMode.${pkg.network_mode}`)
}

function getPackagePriceLabel(pkg: PublicPackage): string {
  if (configStore.freeSiteMode) {
    return freeSiteCopy.marketPriceFree
  }

  const startPrice = getStartingMonthlyPrice(pkg)
  if (startPrice === null) {
    return t('publicSite.market.free')
  }

  return t('publicSite.market.fromMonthly', { price: formatPublicPrice(startPrice) })
}

function getPlanLabel(pkg: PublicPackage): string {
  if (!pkg.isPaid || pkg.plans.length === 0) {
    return t('publicSite.market.free')
  }

  if (configStore.freeSiteMode) {
    return freeSiteCopy.marketPlanCount.replace('{count}', String(pkg.plans.length))
  }

  return t('publicSite.market.planCount', { count: pkg.plans.length })
}

function getMarketPlanCycleLabel(months: number): string {
  return configStore.freeSiteMode ? getFreeSiteBillingCycleLabel(months) : t('publicSite.market.planCycle', { months })
}

function getMarketMonthlyPriceLabel(price: number): string {
  return configStore.freeSiteMode ? freeSiteCopy.marketMonthlyPrice : `≈ ¥${formatPublicPrice(price)}/${t('common.month')}`
}

function getMarketCtaText(pkg: PublicPackage): string {
  if (pkg.soldOut) return t('publicSite.market.soldOut')
  if (configStore.freeSiteMode) {
    return authStore.isAuthenticated ? freeSiteCopy.marketCreateNow : freeSiteCopy.marketLoginToOrder
  }
  return authStore.isAuthenticated ? t('publicSite.market.createNow') : t('publicSite.market.loginToOrder')
}

function getPackageRegions(pkg: PublicPackage): PublicRegion[] {
  return regions.value.filter(region => region.packageIds.includes(pkg.id)).slice(0, 3)
}

function getRouteSignatureFromState(): string {
  return JSON.stringify({
    source: packageSource.value,
    region: selectedRegion.value || '',
    packageId: selectedPackageId.value || '',
    planId: selectedPlanId.value || '',
    q: searchQuery.value.trim()
  })
}

function getRouteSignatureFromQuery(): string {
  return JSON.stringify({
    source: normalizePublicPackageSource(route.query.source),
    region: parseTextQuery(route.query.region),
    packageId: parsePackageIdQuery(route.query.package) || '',
    planId: parsePackageIdQuery(route.query.plan) || '',
    q: parseTextQuery(route.query.q)
  })
}

function syncRouteQuery(): void {
  if (getRouteSignatureFromState() === getRouteSignatureFromQuery()) {
    return
  }

  const nextQuery: Record<string, string> = {}

  if (packageSource.value !== 'official') {
    nextQuery.source = packageSource.value
  }

  if (selectedRegion.value) {
    nextQuery.region = selectedRegion.value
  }

  if (selectedPackageId.value) {
    nextQuery.package = String(selectedPackageId.value)
  }

  if (selectedPlanId.value) {
    nextQuery.plan = String(selectedPlanId.value)
  }

  const trimmedSearch = searchQuery.value.trim()
  if (trimmedSearch) {
    nextQuery.q = trimmedSearch
  }

  void router.replace({
    name: 'market',
    query: nextQuery
  })
}

function ensureSelectedPackage(
  preferredPackageId: number | null = selectedPackageId.value,
  options: { syncRegionWithPackage?: boolean } = {}
): void {
  const { syncRegionWithPackage = true } = options

  if (selectedRegion.value && !regions.value.some(region => region.code === selectedRegion.value)) {
    selectedRegion.value = null
  }

  if (preferredPackageId && syncRegionWithPackage) {
    const preferredPackage = packages.value.find(pkg => pkg.id === preferredPackageId)
    if (preferredPackage) {
      const currentRegion = selectedRegion.value
        ? regions.value.find(region => region.code === selectedRegion.value)
        : null

      if (currentRegion && !currentRegion.packageIds.includes(preferredPackage.id)) {
        const preferredRegion = regions.value.find(region => region.packageIds.includes(preferredPackage.id))
        if (preferredRegion) {
          selectedRegion.value = preferredRegion.code
        }
      }
    }
  }

  if (filteredPackages.value.length === 0 && selectedRegion.value !== null) {
    selectedRegion.value = null
  }

  if (filteredPackages.value.length === 0) {
    selectedPackageId.value = null
    return
  }

  if (!selectedPackageId.value || !filteredPackages.value.some(pkg => pkg.id === selectedPackageId.value)) {
    selectedPackageId.value = filteredPackages.value[0].id
  }
}

function ensureSelectedPlan(preferredPlanId: number | null = selectedPlanId.value): void {
  if (!selectedPackage.value || selectedPackage.value.plans.length === 0) {
    selectedPlanId.value = null
    return
  }

  const matchedPlan = preferredPlanId
    ? selectedPackage.value.plans.find(plan => plan.id === preferredPlanId && !plan.isSoldOut)
    : null

  const firstAvailablePlan = selectedPackage.value.plans.find(plan => !plan.isSoldOut)
  selectedPlanId.value = matchedPlan?.id || firstAvailablePlan?.id || null
}

async function loadData(
  preferredPackageId: number | null = selectedPackageId.value,
  preferredPlanId: number | null = selectedPlanId.value
): Promise<void> {
  loading.value = true
  loadError.value = ''

  try {
    const [packagesResponse, regionsResponse] = await Promise.all([
      api.packages.listPublic({ source: packageSource.value }),
      api.packages.getPublicRegions({ source: packageSource.value })
    ])

    packages.value = (packagesResponse.packages || []) as unknown as PublicPackage[]
    regions.value = regionsResponse.regions || []

    ensureSelectedPackage(preferredPackageId)
    ensureSelectedPlan(preferredPlanId)
    syncRouteQuery()
  } catch (error) {
    console.error('Failed to load public market:', error)
    packages.value = []
    regions.value = []
    loadError.value = t('common.loadFailed')
  } finally {
    loading.value = false
  }
}

async function syncFromRoute(): Promise<void> {
  const nextSource = normalizePublicPackageSource(route.query.source)
  const nextRegion = parseTextQuery(route.query.region) || null
  const nextPackageId = parsePackageIdQuery(route.query.package)
  const nextPlanId = parsePackageIdQuery(route.query.plan)
  const nextSearch = parseTextQuery(route.query.q)
  const sourceChanged = nextSource !== packageSource.value

  packageSource.value = nextSource
  selectedRegion.value = nextRegion
  selectedPackageId.value = nextPackageId
  selectedPlanId.value = nextPlanId
  searchQuery.value = nextSearch

  if (sourceChanged || packages.value.length === 0) {
    await loadData(nextPackageId, nextPlanId)
    return
  }

  ensureSelectedPackage(nextPackageId)
  ensureSelectedPlan(nextPlanId)
  syncRouteQuery()
}

async function switchSource(source: PublicPackageSource): Promise<void> {
  if (source === packageSource.value) {
    return
  }

  packageSource.value = source
  selectedRegion.value = null
  selectedPackageId.value = null
  selectedPlanId.value = null
  searchQuery.value = ''
  await loadData(null, null)
}

function selectRegion(code: string | null): void {
  const currentPackageId = selectedPackageId.value
  selectedRegion.value = code

  // 用户主动切换地区时，优先尊重新地区筛选；
  // 只有当前套餐仍在筛选结果内时才保留，避免把地区强行改回旧值。
  const preferredPackageId = currentPackageId !== null && filteredPackages.value.some(pkg => pkg.id === currentPackageId)
    ? currentPackageId
    : null

  if (preferredPackageId === null) {
    selectedPlanId.value = null
  }

  ensureSelectedPackage(preferredPackageId, { syncRegionWithPackage: false })
  ensureSelectedPlan(selectedPlanId.value)
  syncRouteQuery()
}

function selectPackage(pkg: PublicPackage): void {
  selectedPackageId.value = pkg.id
  ensureSelectedPlan(null)
  syncRouteQuery()
}

function selectPlan(planId: number): void {
  const plan = selectedPackage.value?.plans.find(item => item.id === planId)
  if (!plan || plan.isSoldOut) {
    return
  }

  selectedPlanId.value = planId
  syncRouteQuery()
}

function handleSearchInput(): void {
  ensureSelectedPackage(selectedPackageId.value)

  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
  }

  searchTimer = window.setTimeout(() => {
    syncRouteQuery()
    searchTimer = null
  }, 120)
}

function clearSearch(): void {
  searchQuery.value = ''
  ensureSelectedPackage(selectedPackageId.value)
  syncRouteQuery()
}

function createInstance(pkg: PublicPackage): void {
  const source = pkg.sourceType === 'official' ? 'official' : 'market'
  const query: Record<string, string> = {
    source,
    package: String(pkg.id)
  }

  if (selectedPlan.value) {
    query.plan = String(selectedPlan.value.id)
  }

  if (authStore.isAuthenticated) {
    void router.push({
      path: instanceCreatePath(),
      query
    })
    return
  }

  const redirect = `${instanceCreatePath()}?${new URLSearchParams(query).toString()}`
  void router.push({
    path: loginPath(),
    query: { redirect }
  })
}

watch(
  () => route.fullPath,
  () => {
    void syncFromRoute()
  }
)

onMounted(() => {
  void loadData(selectedPackageId.value)
})

onUnmounted(() => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
  }
})
</script>

<template>
  <div class="kawaii-page kawaii-market-page relative">
    <section class="kawaii-market-hero relative px-4 pb-10 pt-14 sm:px-6 lg:px-8">
      <div class="relative mx-auto max-w-7xl">
        <div class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)] lg:items-end">
          <div class="max-w-3xl">
            <div
              class="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium"
              :class="ui.badge"
            >
              <span class="h-1.5 w-1.5 rounded-full" :class="ui.badgeDot"></span>
              {{ t('publicSite.market.badge') }}
            </div>

            <h1 class="mt-6 text-4xl font-extrabold tracking-normal sm:text-5xl lg:text-[3.65rem] lg:leading-[1.05]" :class="ui.title">
              {{ t('publicSite.market.title') }}
            </h1>
            <p class="mt-5 max-w-2xl text-base leading-7 sm:text-lg sm:leading-8" :class="ui.body">
              {{ t('publicSite.market.description') }}
            </p>

            <div class="kawaii-market-hero-notice mt-8 flex items-start gap-3 px-4 py-3.5 text-sm leading-6" :class="ui.infoBanner">
              <svg class="mt-0.5 h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{{ infoBannerText }}</span>
            </div>
          </div>

          <div class="kawaii-market-summary-grid grid grid-cols-2 gap-3">
            <div
              v-for="card in summaryCards"
              :key="card.label"
              class="kawaii-market-summary-card"
              :class="ui.summaryCard"
            >
              <div class="text-xs font-semibold" :class="ui.summaryLabel">
                {{ card.label }}
              </div>
              <div class="mt-2 text-2xl font-extrabold tracking-normal" :class="ui.summaryValue">
                {{ card.value }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <ThemeTemplateSlot
      slot-name="public.market.banner"
      container-class="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8"
    />

    <section class="relative px-4 pb-20 sm:px-6 lg:px-8">
      <div class="mx-auto max-w-7xl">
        <div class="kawaii-market-filter-panel" :class="ui.filterWrap">
          <div class="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div class="min-w-0">
              <div class="inline-flex overflow-hidden rounded-full bg-themed-secondary p-1">
                <button
                  class="h-10 rounded-full px-5 text-sm font-semibold tracking-normal transition-colors duration-150"
                  :class="packageSource === 'official' ? ui.chipActive : ui.chipIdle"
                  @click="switchSource('official')"
                >
                  {{ t('publicSite.market.official') }}
                </button>
                <button
                  class="h-10 rounded-full px-5 text-sm font-semibold tracking-normal transition-colors duration-150"
                  :class="packageSource === 'market' ? ui.chipActive : ui.chipIdle"
                  @click="switchSource('market')"
                >
                  {{ t('publicSite.market.market') }}
                </button>
              </div>

              <div v-if="regions.length > 0" class="mt-4 flex flex-wrap gap-2">
                <button
                  class="inline-flex h-9 items-center rounded-xl px-3.5 text-sm font-semibold transition-colors duration-150"
                  :class="selectedRegion === null ? ui.chipActive : ui.chipIdle"
                  @click="selectRegion(null)"
                >
                  <svg v-if="selectedRegion === null" class="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                  {{ t('publicSite.market.allRegions') }}
                </button>

                <button
                  v-for="region in regions"
                  :key="region.code"
                  class="inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition-colors duration-150"
                  :class="selectedRegion === region.code ? ui.chipActive : ui.chipIdle"
                  @click="selectRegion(region.code)"
                >
                  <svg v-if="selectedRegion === region.code" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                  <FlagIcon :code="region.code" class="h-3 w-4" />
                  <span>{{ getRegionLabel(region.code) }}</span>
                </button>
              </div>
            </div>

            <div class="relative w-full xl:max-w-md">
              <svg class="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" :class="ui.searchClear" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 110-16 8 8 0 010 16z" />
              </svg>
              <input
                v-model="searchQuery"
                type="text"
                class="h-12 w-full rounded-full border pl-11 pr-12 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30"
                :class="ui.searchInput"
                :placeholder="t('publicSite.market.searchPlaceholder')"
                @input="handleSearchInput"
              />
              <button
                v-if="searchQuery"
                class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 transition-colors duration-150"
                :class="ui.searchClear"
                @click="clearSearch"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div v-if="loadError" class="mt-6 flex items-start gap-3 rounded-2xl px-4 py-4 text-sm leading-6" :class="ui.errorBanner">
          <svg class="mt-0.5 h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.73-3l-7.07-12a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z" />
          </svg>
          <span>{{ loadError }}</span>
        </div>

        <div v-else-if="loading" class="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)]">
          <div class="grid gap-4 md:grid-cols-2">
            <div
              v-for="index in 6"
              :key="index"
              class="h-60 animate-pulse rounded-3xl"
              :class="ui.skeleton"
            ></div>
          </div>
          <div class="h-[36rem] animate-pulse rounded-3xl" :class="ui.skeleton"></div>
        </div>

        <div v-else-if="packages.length === 0" class="mt-7 rounded-3xl border border-dashed px-6 py-16 text-center" :class="ui.emptyState">
          {{ t('publicSite.market.noPackages') }}
        </div>

        <div v-else class="kawaii-market-catalog-layout mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)]">
          <div class="min-w-0">
            <div v-if="filteredPackages.length === 0" class="rounded-3xl border border-dashed px-6 py-16 text-center" :class="ui.emptyState">
              <div class="text-base font-semibold" :class="ui.emptyStateTitle">
                {{ t('publicSite.market.noResults') }}
              </div>
              <button
                v-if="searchQuery || selectedRegion"
                class="mt-4 inline-flex h-10 items-center rounded-full px-6 text-sm font-semibold transition-colors duration-150"
                :class="ui.emptyStateButton"
                @click="searchQuery = ''; selectRegion(null)"
              >
                {{ t('common.reset') }}
              </button>
            </div>

            <div v-else class="kawaii-market-package-grid grid gap-4 md:grid-cols-2">
              <button
                v-for="pkg in filteredPackages"
                :key="pkg.id"
                class="kawaii-package-card rounded-3xl p-5 text-left transition-[background-color,box-shadow,transform,border-color] duration-150"
                :class="[
                  selectedPackage?.id === pkg.id ? 'selected' : '',
                  pkg.soldOut ? 'opacity-70' : ''
                ]"
                @click="selectPackage(pkg)"
              >
                <div class="flex min-w-0 items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-normal" :class="pkg.sourceType === 'official' ? ui.chipOfficial : ui.chipMarket">
                        {{ pkg.sourceType === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }}
                      </span>
                      <span class="rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-normal" :class="pkg.instance_type === 'vm' ? ui.chipKvm : ui.chipLxc">
                        {{ pkg.instance_type === 'vm' ? 'KVM' : 'LXC' }}
                      </span>
                      <span class="rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-normal" :class="pkg.soldOut ? ui.chipSoldOut : ui.chipInStock">
                        {{ pkg.soldOut ? t('publicSite.market.soldOut') : t('publicSite.market.inStock') }}
                      </span>
                    </div>

                    <div class="mt-4 line-clamp-2 text-xl font-extrabold tracking-normal">
                      {{ pkg.name }}
                    </div>
                  </div>

                  <div class="shrink-0 text-right">
                    <div class="text-sm font-extrabold text-accent">
                      {{ getPackagePriceLabel(pkg) }}
                    </div>
                    <div class="mt-1 text-xs" :class="selectedPackage?.id === pkg.id ? '' : ui.packageCardMuted">
                      {{ formatTraffic(pkg.monthly_traffic_limit) }}
                    </div>
                  </div>
                </div>

                <p class="mt-3 line-clamp-2 text-sm leading-6" :class="selectedPackage?.id === pkg.id ? '' : ui.packageCardMuted">
                  {{ pkg.description || t('publicSite.portal.packageFallback') }}
                </p>

                <div v-if="getPackageRegions(pkg).length > 0" class="mt-4 flex flex-wrap gap-2">
                  <span
                    v-for="region in getPackageRegions(pkg)"
                    :key="region.code"
                    class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold"
                    :class="ui.statChip"
                  >
                    <FlagIcon :code="region.code" class="h-3 w-4" />
                    {{ getRegionLabel(region.code) }}
                  </span>
                </div>

                <div class="mt-5 grid grid-cols-2 gap-3 border-t pt-4" :class="selectedPackage?.id === pkg.id ? 'border-accent/30' : ui.statDivider">
                  <div class="kawaii-market-card-stat">
                    <div class="text-[11px] font-semibold" :class="selectedPackage?.id === pkg.id ? 'opacity-70' : ui.statBlockLabel">{{ t('publicSite.market.labels.plans') }}</div>
                    <div class="mt-1 text-sm font-extrabold">{{ getPlanLabel(pkg) }}</div>
                  </div>
                  <div class="kawaii-market-card-stat">
                    <div class="text-[11px] font-semibold" :class="selectedPackage?.id === pkg.id ? 'opacity-70' : ui.statBlockLabel">{{ t('publicSite.market.labels.network') }}</div>
                    <div class="mt-1 text-sm font-extrabold leading-5">{{ getNetworkLabel(pkg) }}</div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <aside class="min-w-0 lg:self-start">
            <div class="kawaii-market-detail-shell rounded-3xl border p-5 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto sm:p-6" :class="ui.detailCard">
              <template v-if="selectedPackage">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-normal" :class="selectedPackage.sourceType === 'official' ? ui.chipOfficial : ui.chipMarket">
                    {{ selectedPackage.sourceType === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }}
                  </span>
                  <span class="rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-normal" :class="selectedPackage.instance_type === 'vm' ? ui.chipKvm : ui.chipLxc">
                    {{ selectedPackage.instance_type === 'vm' ? 'KVM' : 'LXC' }}
                  </span>
                  <span class="rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-normal" :class="selectedPackage.soldOut ? ui.chipSoldOut : ui.chipInStock">
                    {{ selectedPackage.soldOut ? t('publicSite.market.soldOut') : t('publicSite.market.inStock') }}
                  </span>
                </div>

                <h2 class="mt-4 text-2xl font-extrabold tracking-normal" :class="ui.title">
                  {{ selectedPackage.name }}
                </h2>
                <p class="mt-3 text-sm leading-6" :class="ui.body">
                  {{ selectedPackage.description || t('publicSite.portal.packageFallback') }}
                </p>

                <div v-if="getPackageRegions(selectedPackage).length > 0" class="mt-4 flex flex-wrap gap-2">
                  <span
                    v-for="region in getPackageRegions(selectedPackage)"
                    :key="region.code"
                    class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold"
                    :class="ui.statChip"
                  >
                    <FlagIcon :code="region.code" class="h-3 w-4" />
                    {{ getRegionLabel(region.code) }}
                  </span>
                </div>

                <div class="mt-6 grid grid-cols-2 gap-3">
                  <div class="kawaii-market-detail-metric rounded-2xl p-4" :class="ui.detailSummaryCard">
                    <div class="text-xs font-semibold" :class="ui.detailSummaryLabel">
                      {{ t('publicSite.market.labels.startingPrice') }}
                    </div>
                    <div class="mt-2 text-lg font-extrabold">{{ getPackagePriceLabel(selectedPackage) }}</div>
                  </div>
                  <div class="kawaii-market-detail-metric rounded-2xl p-4" :class="ui.detailSummaryCard">
                    <div class="text-xs font-semibold" :class="ui.detailSummaryLabel">
                      {{ t('publicSite.market.labels.traffic') }}
                    </div>
                    <div class="mt-2 text-lg font-extrabold">{{ formatTraffic(selectedPackage.monthly_traffic_limit) }}</div>
                  </div>
                </div>

                <div class="mt-6">
                  <div class="flex items-center justify-between gap-4">
                    <div class="text-sm font-extrabold" :class="ui.title">
                      {{ t('publicSite.market.plansTitle') }}
                    </div>
                    <div class="text-xs" :class="ui.statBlockLabel">
                      {{ getNetworkLabel(selectedPackage) }}
                    </div>
                  </div>

                  <div v-if="selectedPackage.isPaid && selectedPackage.plans.length > 0" class="mt-3 space-y-2">
                    <button
                      v-for="plan in selectedPackage.plans"
                      :key="plan.id"
                      class="kawaii-market-plan w-full rounded-2xl px-3 py-3 text-left transition-[background-color,border-color,transform] duration-150"
                      :class="[
                        selectedPlan?.id === plan.id ? 'selected text-themed' : 'text-themed',
                        plan.isSoldOut ? 'cursor-not-allowed opacity-60 hover:bg-inherit' : ''
                      ]"
                      :disabled="plan.isSoldOut"
                      @click="selectPlan(plan.id)"
                    >
                      <div class="flex items-start gap-3">
                        <div class="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2" :class="selectedPlan?.id === plan.id ? ui.radioActive : ui.radioIdle">
                          <div v-if="selectedPlan?.id === plan.id" class="h-1.5 w-1.5 rounded-full bg-accent"></div>
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <div class="truncate text-sm font-extrabold">
                                {{ plan.name }}
                              </div>
                              <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] opacity-70">
                                <span>{{ getMarketPlanCycleLabel(plan.billingCycle) }}</span>
                                <span v-if="plan.isSoldOut" class="rounded-full border px-1.5 py-0.5 opacity-100" :class="ui.chipSoldOut">
                                  {{ t('publicSite.market.soldOut') }}
                                </span>
                              </div>
                            </div>
                            <div class="shrink-0 text-right">
                              <div class="text-sm font-extrabold">
                                {{ configStore.freeSiteMode ? freeSiteCopy.moneyJustForShow : `¥${formatPublicPrice(plan.price)}` }}
                              </div>
                              <div class="mt-0.5 text-[11px] opacity-70">
                                {{ getMarketMonthlyPriceLabel(plan.monthlyPrice) }}
                              </div>
                            </div>
                          </div>

                          <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                            <span class="rounded-lg border px-2 py-0.5 font-semibold" :class="selectedPlan?.id === plan.id ? 'border-current' : ui.statChip">CPU {{ plan.cpu }}%</span>
                            <span class="rounded-lg border px-2 py-0.5 font-semibold" :class="selectedPlan?.id === plan.id ? 'border-current' : ui.statChip">{{ formatMemory(plan.memory) }}</span>
                            <span class="rounded-lg border px-2 py-0.5 font-semibold" :class="selectedPlan?.id === plan.id ? 'border-current' : ui.statChip">{{ formatDisk(plan.disk) }}</span>
                            <span class="rounded-lg border px-2 py-0.5 font-semibold" :class="selectedPlan?.id === plan.id ? 'border-current' : ui.statChip">{{ formatTraffic(plan.trafficLimit) }}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>

                  <div v-else class="mt-3 rounded-2xl p-4 text-sm leading-6" :class="ui.infoCard">
                    <div class="font-semibold" :class="ui.title">
                      {{ t('publicSite.market.customConfigTitle') }}
                    </div>
                    <p class="mt-2">
                      {{ t('publicSite.market.customConfigDescription') }}
                    </p>
                  </div>
                </div>

                <div v-if="selectedPlan" class="mt-5">
                  <div class="rounded-2xl px-4 py-4" :class="ui.detailSummaryCard">
                    <div class="flex items-start justify-between gap-4">
                      <div class="min-w-0">
                        <div class="text-xs font-semibold" :class="ui.statBlockLabel">
                          {{ t('publicSite.market.selectedPlanTitle') }}
                        </div>
                        <div class="mt-1 truncate text-base font-extrabold" :class="ui.title">
                          {{ selectedPlan.name }}
                        </div>
                        <div class="mt-1 text-xs" :class="ui.statBlockLabel">
                          {{ getMarketPlanCycleLabel(selectedPlan.billingCycle) }} · {{ getNetworkLabel(selectedPackage) }}
                        </div>
                      </div>
                      <div class="shrink-0 text-right">
                        <div class="text-xl font-extrabold tracking-normal" :class="ui.title">
                          {{ configStore.freeSiteMode ? freeSiteCopy.moneyJustForShow : `¥${formatPublicPrice(selectedPlan.price)}` }}
                        </div>
                        <div class="mt-0.5 text-[11px]" :class="ui.statBlockLabel">
                          {{ getMarketMonthlyPriceLabel(selectedPlan.monthlyPrice) }}
                        </div>
                      </div>
                    </div>

                    <div class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                      <span class="rounded-lg border border-current px-2 py-0.5 font-semibold opacity-90">CPU {{ selectedPlan.cpu }}%</span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-semibold opacity-90">{{ formatMemory(selectedPlan.memory) }}</span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-semibold opacity-90">{{ formatDisk(selectedPlan.disk) }}</span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-semibold opacity-90">{{ formatTraffic(selectedPlan.trafficLimit) }}</span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-semibold opacity-90">{{ t('publicSite.market.labels.hosts') }} {{ selectedPackage.host_ids.length }}</span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-semibold opacity-90">{{ t('publicSite.market.labels.nesting') }} {{ selectedPackage.nested ? t('common.yes') : t('common.no') }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="selectedPackage.checkoutExtensions?.length" class="mt-5 rounded-2xl p-4 text-sm leading-6" :class="ui.infoCard">
                  <div class="font-semibold" :class="ui.title">
                    {{ t('publicSite.market.checkoutExtensionTitle') }}
                  </div>
                  <p class="mt-2">
                    {{ t('publicSite.market.checkoutExtensionDescription') }}
                  </p>
                  <div class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span
                      v-for="extension in selectedPackage.checkoutExtensions"
                      :key="`${extension.pluginId}:${extension.serviceExtensionKey}`"
                      class="rounded-lg border px-2 py-0.5 font-semibold"
                      :class="ui.statChip"
                    >
                      {{ extension.name }}
                    </span>
                  </div>
                </div>

                <button
                  class="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-6 text-sm font-extrabold tracking-normal transition-[background-color,box-shadow,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-60"
                  :class="ui.ctaButton"
                  :disabled="selectedPackage.soldOut || (selectedPackage.isPaid && !selectedPlan)"
                  @click="createInstance(selectedPackage)"
                >
                  {{ getMarketCtaText(selectedPackage) }}
                </button>

                <p v-if="!authStore.isAuthenticated" class="mt-3 text-center text-xs leading-5" :class="ui.statBlockLabel">
                  {{ t('publicSite.market.loginHint') }}
                </p>
              </template>

              <template v-else>
                <div class="flex min-h-[20rem] items-center justify-center text-center text-sm" :class="ui.statBlockLabel">
                  {{ t('publicSite.market.choosePackage') }}
                </div>
              </template>
            </div>
          </aside>
        </div>
      </div>
    </section>
  </div>
</template>
