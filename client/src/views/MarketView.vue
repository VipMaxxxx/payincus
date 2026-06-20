<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { usePageSeo } from '@/composables/usePageSeo'
import { useBrand } from '@/composables/useBrand'
import FlagIcon from '@/components/FlagIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
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

defineOptions({
  name: 'MarketView'
})

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const authStore = useAuthStore()
const configStore = useConfigStore()
const themeStore = useThemeStore()
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
const detailColumnRef = ref<HTMLElement | null>(null)
const detailCardRef = ref<HTMLElement | null>(null)
const detailColumnStyle = ref<Record<string, string>>({})
const detailCardStyle = ref<Record<string, string>>({})

let searchTimer: number | null = null
let detailCardFrame: number | null = null

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

const ui = computed(() => themeStore.isDark
  ? {
      heroTint: 'bg-[linear-gradient(180deg,rgba(26,44,82,0.55)_0%,rgba(26,44,82,0.25)_45%,rgba(17,20,24,0)_100%)]',
      body: 'text-[#c3c6cf]',
      title: 'text-[#e3e2e6]',
      badge: 'border-[#284777] bg-[#1a2c52] text-[#d3e3fd]',
      badgeDot: 'bg-[#a8c7fa]',
      infoBanner: 'bg-[#1a2c52] text-[#d3e3fd]',
      summaryCard: 'border-[#43474e] bg-[#1d2024]',
      summaryLabel: 'text-[#8e9199]',
      summaryValue: 'text-[#e3e2e6]',
      filterWrap: 'border-[#43474e] bg-[#1d2024]',
      chipActive: 'bg-[#a8c7fa] text-[#062e6f]',
      chipIdle: 'bg-[#272a2f] text-[#c3c6cf] hover:bg-[#313438]',
      searchInput: 'border-[#43474e] bg-[#111418] text-[#e3e2e6] placeholder:text-[#8e9199] focus:border-[#a8c7fa]',
      searchClear: 'text-[#8e9199] hover:bg-[#272a2f] hover:text-[#e3e2e6]',
      errorBanner: 'bg-[#3a1618] text-[#ffb4ab] border border-[#5a2a2d]',
      skeleton: 'bg-[#272a2f]',
      emptyState: 'border-[#43474e] bg-[#1d2024] text-[#8e9199]',
      emptyStateTitle: 'text-[#e3e2e6]',
      emptyStateButton: 'bg-[#d3e3fd] text-[#041e49] hover:bg-[#c1d6fc] dark:bg-[#284777] dark:text-[#d3e3fd] dark:hover:bg-[#304f81]',
      packageCard: 'bg-[#1d2024] shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)] hover:bg-[#22252a] hover:shadow-[0_1px_3px_rgba(0,0,0,0.3),0_4px_8px_3px_rgba(0,0,0,0.15)]',
      packageCardSelected: 'bg-[#1a2c52] text-[#d3e3fd] shadow-[0_1px_3px_rgba(0,0,0,0.3),0_4px_8px_3px_rgba(0,0,0,0.2)]',
      packageCardMuted: 'text-[#8e9199]',
      chipKvm: 'border border-[#ffdfa6]/60 text-[#ffdfa6]',
      chipLxc: 'border border-[#8e9199]/60 text-[#c3c6cf]',
      chipInStock: 'border border-[#a1cdb3]/60 text-[#a1cdb3]',
      chipSoldOut: 'border border-[#ffb4ab]/60 text-[#ffb4ab]',
      chipOfficial: 'border border-[#a8c7fa]/70 text-[#a8c7fa]',
      chipMarket: 'border border-[#a1cdb3]/70 text-[#a1cdb3]',
      statChip: 'border border-[#43474e] text-[#c3c6cf]',
      statDivider: 'border-[#43474e]',
      statBlockLabel: 'text-[#8e9199]',
      detailCard: 'border-[#43474e] bg-[#1d2024] shadow-[0_4px_8px_3px_rgba(0,0,0,0.15),0_1px_3px_rgba(0,0,0,0.3)]',
      detailSummaryCard: 'bg-[#1a2c52] text-[#d3e3fd]',
      detailSummaryLabel: 'text-[#a8c7fa]',
      detailSummaryIcon: 'text-[#a8c7fa]',
      planIdle: 'bg-[#272a2f] text-[#e3e2e6] hover:bg-[#303339]',
      planSelected: 'bg-[#1a2c52] text-[#d3e3fd]',
      radioIdle: 'border-[#8e9199]',
      radioActive: 'border-[#a8c7fa] bg-[#a8c7fa]',
      infoCard: 'bg-[#272a2f] text-[#c3c6cf]',
      ctaButton: 'bg-[#a8c7fa] text-[#062e6f] shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)] hover:bg-[#bdd3fb]'
    }
  : {
      heroTint: 'bg-[linear-gradient(180deg,rgba(211,227,253,0.7)_0%,rgba(223,235,254,0.35)_45%,rgba(252,252,253,0)_100%)]',
      body: 'text-[#43474e]',
      title: 'text-[#1a1b20]',
      badge: 'border-[#aac7fa]/60 bg-[#d3e3fd] text-[#041e49]',
      badgeDot: 'bg-[#0b57d0]',
      infoBanner: 'bg-[#d3e3fd] text-[#041e49]',
      summaryCard: 'bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_1px_3px_1px_rgba(15,23,42,0.06)]',
      summaryLabel: 'text-[#74777f]',
      summaryValue: 'text-[#1a1b20]',
      filterWrap: 'bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_1px_3px_1px_rgba(15,23,42,0.06)]',
      chipActive: 'bg-[#0b57d0] text-white',
      chipIdle: 'bg-[#eef0f8] text-[#1a1b20] hover:bg-[#e1e5f1]',
      searchInput: 'border-[#c3c6cf] bg-white text-[#1a1b20] placeholder:text-[#74777f] focus:border-[#0b57d0]',
      searchClear: 'text-[#74777f] hover:bg-[#eef0f8] hover:text-[#1a1b20]',
      errorBanner: 'bg-[#ffedea] text-[#93000a] border border-[#ffb4ab]',
      skeleton: 'bg-[#e2e4ed]',
      emptyState: 'border-[#c3c6cf] bg-white text-[#74777f]',
      emptyStateTitle: 'text-[#1a1b20]',
      emptyStateButton: 'bg-[#d3e3fd] text-[#041e49] hover:bg-[#c1d6fc]',
      packageCard: 'bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_1px_3px_1px_rgba(15,23,42,0.06)] hover:bg-[#f8f9fc] hover:shadow-[0_1px_3px_rgba(15,23,42,0.1),0_4px_8px_3px_rgba(15,23,42,0.08)]',
      packageCardSelected: 'bg-[#d3e3fd] text-[#041e49] shadow-[0_1px_3px_rgba(11,87,208,0.15),0_4px_8px_3px_rgba(11,87,208,0.1)]',
      packageCardMuted: 'text-[#74777f]',
      chipKvm: 'border border-[#7a5900]/40 text-[#7a5900]',
      chipLxc: 'border border-[#74777f]/40 text-[#43474e]',
      chipInStock: 'border border-[#3a6a49]/40 text-[#3a6a49]',
      chipSoldOut: 'border border-[#ba1a1a]/40 text-[#ba1a1a]',
      chipOfficial: 'border border-[#0b57d0]/40 text-[#0b57d0]',
      chipMarket: 'border border-[#3a6a49]/40 text-[#3a6a49]',
      statChip: 'border border-[#c3c6cf] text-[#43474e]',
      statDivider: 'border-[#e3e5ec]',
      statBlockLabel: 'text-[#74777f]',
      detailCard: 'border-[#c3c6cf] bg-white shadow-[0_4px_8px_3px_rgba(15,23,42,0.08),0_1px_3px_rgba(15,23,42,0.06)]',
      detailSummaryCard: 'bg-[#d3e3fd] text-[#041e49]',
      detailSummaryLabel: 'text-[#1a4191]',
      detailSummaryIcon: 'text-[#0b57d0]',
      planIdle: 'bg-[#eef0f8] text-[#1a1b20] hover:bg-[#e1e5f1]',
      planSelected: 'bg-[#d3e3fd] text-[#041e49]',
      radioIdle: 'border-[#74777f]',
      radioActive: 'border-[#0b57d0] bg-[#0b57d0]',
      infoCard: 'bg-[#eef0f8] text-[#43474e]',
      ctaButton: 'bg-[#0b57d0] text-white shadow-[0_1px_2px_rgba(11,87,208,0.3),0_1px_3px_1px_rgba(11,87,208,0.15)] hover:bg-[#0848ad]'
    }
)

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
      path: '/instances/create',
      query
    })
    return
  }

  const redirect = `/instances/create?${new URLSearchParams(query).toString()}`
  void router.push({
    path: '/login',
    query: { redirect }
  })
}

function resetFloatingDetailCard(): void {
  detailColumnStyle.value = {}
  detailCardStyle.value = {}
}

// 右侧详情卡需要跨过当前 section 和页脚区域持续停驻，
// 单纯依赖 sticky 会在左列过短时提前失效，所以这里改为手动计算 fixed 位置。
function updateFloatingDetailCard(): void {
  if (typeof window === 'undefined') {
    return
  }

  const detailColumn = detailColumnRef.value
  const detailCard = detailCardRef.value

  if (!detailColumn || !detailCard || window.innerWidth < 1024) {
    resetFloatingDetailCard()
    return
  }

  const header = document.querySelector('header')
  const footer = document.querySelector('footer')
  const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 64
  const topOffset = Math.round(headerHeight + 32)
  const bottomGap = 24
  const columnRect = detailColumn.getBoundingClientRect()

  if (columnRect.top > topOffset) {
    resetFloatingDetailCard()
    return
  }

  const footerTop = footer instanceof HTMLElement ? footer.getBoundingClientRect().top : window.innerHeight
  const naturalCardHeight = detailCard.scrollHeight
  const maxCardHeight = Math.max(0, window.innerHeight - topOffset - bottomGap)
  const renderedCardHeight = Math.min(naturalCardHeight, maxCardHeight)
  const footerCollisionOffset = Math.max(0, topOffset + renderedCardHeight + bottomGap - footerTop)

  detailColumnStyle.value = {
    height: `${renderedCardHeight}px`
  }

  detailCardStyle.value = {
    position: 'fixed',
    // 页脚进入碰撞区后，让卡片继续固定，但被 footer 顶着向上移动。
    top: `${topOffset - footerCollisionOffset}px`,
    width: `${columnRect.width}px`,
    maxHeight: `${maxCardHeight}px`,
    overflowY: 'auto',
    zIndex: '30'
  }
}

function scheduleFloatingDetailCardUpdate(): void {
  if (typeof window === 'undefined') {
    return
  }

  if (detailCardFrame !== null) {
    window.cancelAnimationFrame(detailCardFrame)
  }

  detailCardFrame = window.requestAnimationFrame(() => {
    detailCardFrame = null
    updateFloatingDetailCard()
  })
}

watch(
  () => route.fullPath,
  () => {
    void syncFromRoute()
  }
)

watch(
  [
    loading,
    packageSource,
    selectedRegion,
    selectedPackageId,
    selectedPlanId,
    searchQuery,
    () => filteredPackages.value.length
  ],
  async () => {
    await nextTick()
    scheduleFloatingDetailCardUpdate()
  }
)

onMounted(() => {
  window.addEventListener('scroll', scheduleFloatingDetailCardUpdate, { passive: true })
  window.addEventListener('resize', scheduleFloatingDetailCardUpdate, { passive: true })
  void loadData(selectedPackageId.value)
  void nextTick(() => {
    scheduleFloatingDetailCardUpdate()
  })
})

onUnmounted(() => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
  }

  if (detailCardFrame !== null) {
    window.cancelAnimationFrame(detailCardFrame)
  }

  window.removeEventListener('scroll', scheduleFloatingDetailCardUpdate)
  window.removeEventListener('resize', scheduleFloatingDetailCardUpdate)
})
</script>

<template>
  <div class="relative">
    <section class="relative px-4 pb-10 pt-14 sm:px-6 lg:px-8">
      <div class="relative mx-auto max-w-7xl">
        <div class="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div class="max-w-3xl">
            <div
              class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium"
              :class="ui.badge"
            >
              <span class="h-1.5 w-1.5 rounded-full" :class="ui.badgeDot"></span>
              {{ t('publicSite.market.badge') }}
            </div>

            <h1 class="mt-6 text-4xl font-normal tracking-[-0.02em] sm:text-5xl lg:text-[3.5rem] lg:leading-[1.1]" :class="ui.title">
              {{ t('publicSite.market.title') }}
            </h1>
            <p class="mt-5 max-w-2xl text-base leading-7 sm:text-lg sm:leading-8" :class="ui.body">
              {{ t('publicSite.market.description') }}
            </p>

            <div class="mt-8 flex items-start gap-3 rounded-2xl px-4 py-3.5 text-sm leading-6" :class="ui.infoBanner">
              <svg class="mt-0.5 h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{{ infoBannerText }}</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div
              v-for="card in summaryCards"
              :key="card.label"
              class="rounded-2xl p-4 sm:p-5"
              :class="ui.summaryCard"
            >
              <div class="text-xs font-medium" :class="ui.summaryLabel">
                {{ card.label }}
              </div>
              <div class="mt-2 text-2xl font-normal tracking-[-0.02em]" :class="ui.summaryValue">
                {{ card.value }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="relative px-4 pb-20 sm:px-6 lg:px-8">
      <div class="mx-auto max-w-7xl">
        <div
          class="rounded-3xl p-5 sm:p-6"
          :class="ui.filterWrap"
        >
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div
              class="inline-flex overflow-hidden rounded-full p-1 self-start"
              :class="themeStore.isDark ? 'bg-[#272a2f]' : 'bg-[#eef0f8]'"
            >
              <button
                class="h-9 rounded-full px-5 text-sm font-medium tracking-[0.01em] transition-colors duration-150"
                :class="packageSource === 'official' ? ui.chipActive : 'text-[#43474e] hover:bg-black/5 dark:text-[#c3c6cf] dark:hover:bg-white/5'"
                @click="switchSource('official')"
              >
                {{ t('publicSite.market.official') }}
              </button>
              <button
                class="h-9 rounded-full px-5 text-sm font-medium tracking-[0.01em] transition-colors duration-150"
                :class="packageSource === 'market' ? ui.chipActive : 'text-[#43474e] hover:bg-black/5 dark:text-[#c3c6cf] dark:hover:bg-white/5'"
                @click="switchSource('market')"
              >
                {{ t('publicSite.market.market') }}
              </button>
            </div>

            <div class="relative w-full lg:max-w-sm">
              <svg class="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" :class="ui.searchClear" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 110-16 8 8 0 010 16z" />
              </svg>
              <input
                v-model="searchQuery"
                type="text"
                class="h-12 w-full rounded-full border pl-11 pr-12 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/30 dark:focus:ring-[#a8c7fa]/30"
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

          <div v-if="regions.length > 0" class="mt-5 flex flex-wrap gap-2">
            <button
              class="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150"
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
              class="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-150"
              :class="selectedRegion === region.code ? ui.chipActive : ui.chipIdle"
              @click="selectRegion(region.code)"
            >
              <svg v-if="selectedRegion === region.code" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
              </svg>
              <FlagIcon :code="region.code" class="w-4 h-3" />
              <span>{{ getRegionLabel(region.code) }}</span>
            </button>
          </div>
        </div>

        <div v-if="loadError" class="mt-6 flex items-start gap-3 rounded-2xl px-4 py-4 text-sm leading-6" :class="ui.errorBanner">
          <svg class="mt-0.5 h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.73-3l-7.07-12a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z" />
          </svg>
          <span>{{ loadError }}</span>
        </div>

        <div v-else-if="loading" class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
          <div class="grid gap-4 md:grid-cols-2">
            <div
              v-for="index in 6"
              :key="index"
              class="h-52 animate-pulse rounded-2xl"
              :class="ui.skeleton"
            ></div>
          </div>
          <div
            class="h-[32rem] animate-pulse rounded-3xl"
            :class="ui.skeleton"
          ></div>
        </div>

        <div
          v-else-if="packages.length === 0"
          class="mt-6 rounded-3xl border border-dashed px-6 py-16 text-center"
          :class="ui.emptyState"
        >
          {{ t('publicSite.market.noPackages') }}
        </div>

        <div v-else class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
          <div class="min-w-0 lg:pr-2">
            <div v-if="filteredPackages.length === 0" class="rounded-3xl border border-dashed px-6 py-16 text-center" :class="ui.emptyState">
              <div class="text-base font-medium" :class="ui.emptyStateTitle">
                {{ t('publicSite.market.noResults') }}
              </div>
              <button
                v-if="searchQuery || selectedRegion"
                class="mt-4 inline-flex h-10 items-center rounded-full px-6 text-sm font-medium transition-colors duration-150"
                :class="ui.emptyStateButton"
                @click="searchQuery = ''; selectRegion(null)"
              >
                {{ t('common.reset') }}
              </button>
            </div>

            <div v-else class="grid gap-4 md:grid-cols-2">
              <button
                v-for="pkg in filteredPackages"
                :key="pkg.id"
                class="rounded-3xl p-5 text-left transition-[background-color,box-shadow] duration-150"
                :class="[
                  selectedPackage?.id === pkg.id ? ui.packageCardSelected : ui.packageCard,
                  pkg.soldOut ? 'opacity-70' : ''
                ]"
                @click="selectPackage(pkg)"
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        class="rounded-lg px-2 py-0.5 text-[11px] font-medium tracking-[0.02em]"
                        :class="pkg.instance_type === 'vm' ? ui.chipKvm : ui.chipLxc"
                      >
                        {{ pkg.instance_type === 'vm' ? 'KVM' : 'LXC' }}
                      </span>
                      <span
                        class="rounded-lg px-2 py-0.5 text-[11px] font-medium tracking-[0.02em]"
                        :class="pkg.soldOut ? ui.chipSoldOut : ui.chipInStock"
                      >
                        {{ pkg.soldOut ? t('publicSite.market.soldOut') : t('publicSite.market.inStock') }}
                      </span>
                    </div>

                    <div class="mt-4 truncate text-lg font-medium tracking-[-0.01em]">
                      {{ pkg.name }}
                    </div>
                    <p class="mt-2 line-clamp-2 text-sm leading-5" :class="selectedPackage?.id === pkg.id ? '' : ui.packageCardMuted">
                      {{ pkg.description || t('publicSite.portal.packageFallback') }}
                    </p>
                  </div>

                  <div class="shrink-0 text-right">
                    <div class="text-sm font-medium">
                      {{ getPackagePriceLabel(pkg) }}
                    </div>
                    <div class="mt-1 text-xs" :class="selectedPackage?.id === pkg.id ? '' : ui.packageCardMuted">
                      {{ formatTraffic(pkg.monthly_traffic_limit) }}
                    </div>
                  </div>
                </div>

                <div class="mt-5 grid grid-cols-2 gap-6 border-t pt-4" :class="selectedPackage?.id === pkg.id ? 'border-[#0b57d0]/20 dark:border-[#a8c7fa]/20' : ui.statDivider">
                  <div>
                    <div class="text-[11px] font-medium" :class="selectedPackage?.id === pkg.id ? 'opacity-70' : ui.statBlockLabel">{{ t('publicSite.market.labels.plans') }}</div>
                    <div class="mt-1 text-sm font-medium">{{ getPlanLabel(pkg) }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-medium" :class="selectedPackage?.id === pkg.id ? 'opacity-70' : ui.statBlockLabel">{{ t('publicSite.market.labels.network') }}</div>
                    <div class="mt-1 text-sm font-medium leading-5">{{ getNetworkLabel(pkg) }}</div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div
            ref="detailColumnRef"
            class="min-w-0 lg:self-start"
            :style="detailColumnStyle"
          >
            <div
              ref="detailCardRef"
              class="rounded-3xl border p-6"
              :class="ui.detailCard"
              :style="detailCardStyle"
            >
              <template v-if="selectedPackage">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="rounded-lg px-2 py-0.5 text-[11px] font-medium tracking-[0.02em]"
                    :class="selectedPackage.sourceType === 'official' ? ui.chipOfficial : ui.chipMarket"
                  >
                    {{ selectedPackage.sourceType === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }}
                  </span>
                  <span
                    class="rounded-lg px-2 py-0.5 text-[11px] font-medium tracking-[0.02em]"
                    :class="selectedPackage.instance_type === 'vm' ? ui.chipKvm : ui.chipLxc"
                  >
                    {{ selectedPackage.instance_type === 'vm' ? 'KVM' : 'LXC' }}
                  </span>
                </div>

                <h2 class="mt-4 text-2xl font-normal tracking-[-0.02em]" :class="ui.title">
                  {{ selectedPackage.name }}
                </h2>
                <p class="mt-3 text-sm leading-6" :class="ui.body">
                  {{ selectedPackage.description || t('publicSite.portal.packageFallback') }}
                </p>

                <div class="mt-6 grid grid-cols-2 gap-3">
                  <div class="rounded-2xl p-4" :class="ui.detailSummaryCard">
                    <div class="flex items-center gap-2">
                      <svg class="h-4 w-4" :class="ui.detailSummaryIcon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div class="text-xs font-medium" :class="ui.detailSummaryLabel">
                        {{ t('publicSite.market.labels.startingPrice') }}
                      </div>
                    </div>
                    <div class="mt-2 text-lg font-medium">{{ getPackagePriceLabel(selectedPackage) }}</div>
                  </div>
                  <div class="rounded-2xl p-4" :class="ui.detailSummaryCard">
                    <div class="flex items-center gap-2">
                      <svg class="h-4 w-4" :class="ui.detailSummaryIcon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <div class="text-xs font-medium" :class="ui.detailSummaryLabel">
                        {{ t('publicSite.market.labels.traffic') }}
                      </div>
                    </div>
                    <div class="mt-2 text-lg font-medium">{{ formatTraffic(selectedPackage.monthly_traffic_limit) }}</div>
                  </div>
                </div>

                <div class="mt-6 space-y-3">
                  <div class="text-sm font-medium" :class="ui.title">
                    {{ t('publicSite.market.plansTitle') }}
                  </div>
                  <div v-if="selectedPackage.isPaid && selectedPackage.plans.length > 0" class="space-y-2 lg:max-h-72 lg:overflow-y-auto lg:pr-1">
                    <button
                      v-for="plan in selectedPackage.plans"
                      :key="plan.id"
                      class="w-full rounded-2xl px-3 py-3 text-left transition-colors duration-150"
                      :class="[
                        selectedPlan?.id === plan.id ? ui.planSelected : ui.planIdle,
                        plan.isSoldOut ? 'cursor-not-allowed opacity-60 hover:bg-inherit' : ''
                      ]"
                      :disabled="plan.isSoldOut"
                      @click="selectPlan(plan.id)"
                    >
                      <div class="flex items-start gap-3">
                        <div
                          class="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2"
                          :class="selectedPlan?.id === plan.id ? ui.radioActive : ui.radioIdle"
                        >
                          <div v-if="selectedPlan?.id === plan.id" class="h-1.5 w-1.5 rounded-full" :class="themeStore.isDark ? 'bg-[#062e6f]' : 'bg-white'"></div>
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <div class="truncate text-sm font-medium">
                                {{ plan.name }}
                              </div>
                              <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] opacity-70">
                                <span>{{ getMarketPlanCycleLabel(plan.billingCycle) }}</span>
                                <span
                                  v-if="plan.isSoldOut"
                                  class="rounded-full border px-1.5 py-0.5 opacity-100"
                                  :class="ui.chipSoldOut"
                                >
                                  {{ t('publicSite.market.soldOut') }}
                                </span>
                              </div>
                            </div>
                            <div class="shrink-0 text-right">
                              <div class="text-sm font-medium">
                                {{ configStore.freeSiteMode ? freeSiteCopy.moneyJustForShow : `¥${formatPublicPrice(plan.price)}` }}
                              </div>
                              <div class="mt-0.5 text-[11px] opacity-70">
                                {{ getMarketMonthlyPriceLabel(plan.monthlyPrice) }}
                              </div>
                            </div>
                          </div>

                          <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                            <span class="rounded-lg border px-2 py-0.5 font-medium" :class="selectedPlan?.id === plan.id ? 'border-current' : ui.statChip">
                              CPU {{ plan.cpu }}%
                            </span>
                            <span class="rounded-lg border px-2 py-0.5 font-medium" :class="selectedPlan?.id === plan.id ? 'border-current' : ui.statChip">
                              {{ formatMemory(plan.memory) }}
                            </span>
                            <span class="rounded-lg border px-2 py-0.5 font-medium" :class="selectedPlan?.id === plan.id ? 'border-current' : ui.statChip">
                              {{ formatDisk(plan.disk) }}
                            </span>
                            <span class="rounded-lg border px-2 py-0.5 font-medium" :class="selectedPlan?.id === plan.id ? 'border-current' : ui.statChip">
                              {{ formatTraffic(plan.trafficLimit) }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                  <div
                    v-else
                    class="rounded-2xl p-4 text-sm leading-6"
                    :class="ui.infoCard"
                  >
                    <div class="font-medium" :class="ui.title">
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
                        <div class="text-xs font-medium" :class="ui.statBlockLabel">
                          {{ t('publicSite.market.selectedPlanTitle') }}
                        </div>
                        <div class="mt-1 truncate text-base font-medium" :class="ui.title">
                          {{ selectedPlan.name }}
                        </div>
                        <div class="mt-1 text-xs" :class="ui.statBlockLabel">
                          {{ getMarketPlanCycleLabel(selectedPlan.billingCycle) }} · {{ getNetworkLabel(selectedPackage) }}
                        </div>
                      </div>
                      <div class="shrink-0 text-right">
                        <div class="text-xl font-normal tracking-[-0.02em]" :class="ui.title">
                          {{ configStore.freeSiteMode ? freeSiteCopy.moneyJustForShow : `¥${formatPublicPrice(selectedPlan.price)}` }}
                        </div>
                        <div class="mt-0.5 text-[11px]" :class="ui.statBlockLabel">
                          {{ getMarketMonthlyPriceLabel(selectedPlan.monthlyPrice) }}
                        </div>
                      </div>
                    </div>

                    <div class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                      <span class="rounded-lg border border-current px-2 py-0.5 font-medium opacity-90">
                        CPU {{ selectedPlan.cpu }}%
                      </span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-medium opacity-90">
                        {{ formatMemory(selectedPlan.memory) }}
                      </span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-medium opacity-90">
                        {{ formatDisk(selectedPlan.disk) }}
                      </span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-medium opacity-90">
                        {{ formatTraffic(selectedPlan.trafficLimit) }}
                      </span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-medium opacity-90">
                        {{ t('publicSite.market.labels.hosts') }} {{ selectedPackage.host_ids.length }}
                      </span>
                      <span class="rounded-lg border border-current px-2 py-0.5 font-medium opacity-90">
                        {{ t('publicSite.market.labels.nesting') }} {{ selectedPackage.nested ? t('common.yes') : t('common.no') }}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  class="mt-8 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full px-6 text-sm font-medium tracking-[0.01em] transition-[background-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-60"
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
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
