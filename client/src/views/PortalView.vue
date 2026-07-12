<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import { usePageSeo } from '@/composables/usePageSeo'
import { useAuthStore } from '@/stores/auth'
import { useBrand } from '@/composables/useBrand'
import {
  formatPublicPrice,
  formatPublicTraffic,
  getStartingMonthlyPrice,
  type PackageSource,
  type PublicPackage
} from '@/utils/publicCatalog'
import { dashboardPath, loginPath, marketPath } from '@/utils/app-paths'
import { useReveal } from '@/composables/useReveal'

defineOptions({
  name: 'PortalView'
})

const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const brand = useBrand()

// 门面首页滚动揭示（GSAP + IntersectionObserver，渐进增强、内容默认可见）
const portalRoot = ref<HTMLElement | null>(null)
useReveal(portalRoot)

const packages = ref<PublicPackage[]>([])
const loading = ref(true)
type ProductLineKey = PackageSource | 'all'
const activeProductLine = ref<ProductLineKey>('all')

const heroTitlePrimary = computed(() => t('publicSite.portal.heroTitlePrimary'))
const heroTitlePrefix = computed(() => t('publicSite.portal.heroTitlePrefix'))
const heroTitleAccent = computed(() => t('publicSite.portal.heroTitleAccent'))

const spotlightPackages = computed(() => {
  const allPackages = [...packages.value].sort((left, right) => {
    if (left.soldOut !== right.soldOut) {
      return left.soldOut ? 1 : -1
    }

    const leftPrice = getStartingMonthlyPrice(left)
    const rightPrice = getStartingMonthlyPrice(right)

    if (leftPrice !== null && rightPrice !== null && leftPrice !== rightPrice) {
      return leftPrice - rightPrice
    }

    return left.name.localeCompare(right.name, 'zh')
  })

  return allPackages.slice(0, 4)
})

const heroFeatureCards = computed(() => [
  {
    icon: 'network',
    title: t('publicSite.portal.experienceNoLoginTitle'),
    description: t('publicSite.portal.experienceNoLoginDescription')
  },
  {
    icon: 'compute',
    title: t('publicSite.portal.experienceRoutingTitle'),
    description: t('publicSite.portal.experienceRoutingDescription')
  },
  {
    icon: 'secure',
    title: t('publicSite.portal.officialTitle'),
    description: t('publicSite.portal.officialPoint2')
  },
  {
    icon: 'ops',
    title: t('publicSite.portal.previewTitle'),
    description: t('publicSite.portal.previewDescription')
  }
])

const ecosystemCards = computed(() => [
  {
    key: 'official',
    source: 'official' as PackageSource,
    title: t('publicSite.portal.officialTitle'),
    description: t('publicSite.portal.officialDescription'),
    points: [
      t('publicSite.portal.officialPoint1'),
      t('publicSite.portal.officialPoint2'),
      t('publicSite.portal.officialPoint3')
    ]
  },
  {
    key: 'market',
    source: 'market' as PackageSource,
    title: t('publicSite.portal.marketTitle'),
    description: t('publicSite.portal.marketDescription'),
    points: [
      t('publicSite.portal.marketPoint1'),
      t('publicSite.portal.marketPoint2'),
      t('publicSite.portal.marketPoint3')
    ]
  }
])

const consoleActionLabel = computed(() => (
  authStore.isAuthenticated ? t('publicSite.actions.console') : t('publicSite.actions.signIn')
))

const consoleActionCompactLabel = computed(() => (
  authStore.isAuthenticated ? t('publicSite.actions.consoleCompact') : t('publicSite.actions.signIn')
))

const ui = {
  badge: 'kawaii-chip',
  body: 'text-themed-muted',
  primaryButton: 'kawaii-primary-button',
  statValue: 'text-themed',
  statLabel: 'text-themed-muted',
  platformTitle: 'text-themed',
  sectionLabel: 'text-themed-faint',
  sectionBody: 'text-themed-muted',
  ecosystemOfficialBody: 'text-themed-muted',
  ecosystemMarketBody: 'text-themed-muted',
  ecosystemOfficialList: 'text-themed',
  ecosystemMarketList: 'text-themed',
  ecosystemOfficialButton: 'kawaii-primary-button',
  ecosystemMarketButton: 'kawaii-secondary-button',
  browseWrap: 'kawaii-browse-wrap',
  browseCard: '',
  emptyState: 'kawaii-empty-state',
  skeleton: 'kawaii-skeleton'
}

usePageSeo(() => ({
  title: `${brand.brandName} - ${brand.brandSubtitle}`,
  description: brand.brandSubtitle,
  canonical: `${window.location.origin}/`,
  keywords: t('publicSite.seo.keywords').replace(/Incudal/g, brand.brandName)
}))

function formatTraffic(bytes: string | null): string {
  return formatPublicTraffic(bytes, t('common.unlimited'))
}

function getPriceLabel(pkg: PublicPackage): string {
  const startPrice = getStartingMonthlyPrice(pkg)
  if (startPrice === null) {
    return t('publicSite.market.free')
  }

  return t('publicSite.market.fromMonthly', { price: formatPublicPrice(startPrice) })
}

function getSourceChipClass(source: PackageSource): string {
  return `kawaii-source-chip ${source === 'official' ? 'official' : 'market'}`
}

function getSourceDotClass(source: PackageSource): string {
  return `kawaii-source-dot ${source === 'official' ? 'official' : 'market'}`
}

function getInstanceChipClass(instanceType: string): string {
  return `kawaii-instance-chip ${instanceType === 'vm' ? 'vm' : 'lxc'}`
}

function getPackageCardClass(source: PackageSource): string {
  return `kawaii-package-card ${source === 'official' ? 'official' : 'market'}`
}

function getPriceTextClass(source: PackageSource): string {
  return `kawaii-price-text ${source === 'official' ? 'official' : 'market'}`
}

function setActiveProductLine(source: ProductLineKey): void {
  activeProductLine.value = source
}

function browseCatalog(source?: PackageSource): void {
  void router.push({
    path: marketPath(),
    query: source ? { source } : undefined
  })
}

function openPackage(pkg: PublicPackage): void {
  void router.push({
    path: marketPath(),
    query: {
      source: pkg.sourceType,
      package: String(pkg.id)
    }
  })
}

function goToConsole(): void {
  if (authStore.isAuthenticated) {
    void router.push(dashboardPath())
    return
  }

  void router.push(loginPath())
}

async function loadCatalog(): Promise<void> {
  loading.value = true

  try {
    const packagesResponse = await api.packages.listPublic()
    packages.value = (packagesResponse.packages || []) as unknown as PublicPackage[]
  } catch (error) {
    console.error('Failed to load public catalog:', error)
    packages.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadCatalog()
})
</script>

<template>
  <div ref="portalRoot" class="kawaii-page kawaii-home-page relative">
    <ThemeTemplateSlot
      slot-name="public.home.hero"
      container-class="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8"
    />

    <section class="kawaii-hero-section relative overflow-hidden px-4 pb-10 pt-8 sm:px-6 lg:px-8">
      <div class="kawaii-hero-shell relative mx-auto max-w-7xl px-1 pb-2 pt-8 sm:px-3 sm:pt-10 lg:px-4">
        <div class="relative z-10">
          <div class="kawaii-hero-copy relative z-20 max-w-2xl" data-reveal>
            <div
              class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium"
              :class="ui.badge"
            >
              <span class="kawaii-source-dot official h-1.5 w-1.5 rounded-full"></span>
              {{ t('publicSite.portal.badge') }}
            </div>

            <h1 class="kawaii-hero-heading mt-6 text-4xl font-extrabold sm:text-5xl lg:text-[4rem] lg:leading-[1.05]">
              <span>{{ heroTitlePrimary }}</span>
              <span>
                {{ heroTitlePrefix }}<span class="kawaii-hero-accent">{{ heroTitleAccent }}</span>
              </span>
            </h1>
            <p class="mt-6 max-w-2xl text-base leading-7 sm:text-lg sm:leading-8" :class="ui.body">
              {{ t('publicSite.portal.description') }}
            </p>

            <div class="kawaii-hero-actions mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                class="kawaii-primary-button inline-flex h-11 items-center justify-center gap-2 rounded-xl px-7 text-sm font-semibold transition-[background-color,box-shadow,transform,filter] duration-150 focus-visible:outline-none focus-visible:ring-4"
                @click="browseCatalog()"
              >
                <span>{{ t('publicSite.actions.browseProducts') }}</span>
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 4.5l6 6m0 0l-6 6m6-6h-15" />
                </svg>
              </button>

              <button
                class="kawaii-secondary-button inline-flex h-11 items-center justify-center gap-2 rounded-xl px-7 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4"
                @click="goToConsole"
              >
                <span class="sm:hidden">{{ consoleActionCompactLabel }}</span>
                <span class="hidden sm:inline">{{ consoleActionLabel }}</span>
              </button>
            </div>

          </div>
        </div>

        <div class="kawaii-hero-feature-strip relative z-10 mt-8 grid gap-3 lg:!mt-8 lg:grid-cols-4" data-reveal>
          <div
            v-for="feature in heroFeatureCards"
            :key="feature.title"
            class="kawaii-hero-feature-card rounded-lg p-4"
          >
            <div class="flex items-start gap-3">
              <div class="kawaii-hero-feature-icon">
                <svg v-if="feature.icon === 'network'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 16.5A4.5 4.5 0 018.5 12H9a6 6 0 1111.31 3.73A3.5 3.5 0 0117.5 21h-10A3.5 3.5 0 014 16.5z" />
                </svg>
                <svg v-else-if="feature.icon === 'compute'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 8h10M7 12h10M7 16h6M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
                </svg>
                <svg v-else-if="feature.icon === 'secure'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 3l7 3v5c0 4.5-2.9 8.4-7 9.8C7.9 19.4 5 15.5 5 11V6l7-3z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.5 12l1.7 1.7 3.8-4" />
                </svg>
                <svg v-else class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 3v3m0 12v3M4.64 5.64l2.12 2.12m10.48 10.48l2.12 2.12M3 12h3m12 0h3M4.64 18.36l2.12-2.12M17.24 7.76l2.12-2.12" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12a3 3 0 106 0 3 3 0 00-6 0z" />
                </svg>
              </div>
              <div>
                <div class="text-sm font-semibold text-themed">{{ feature.title }}</div>
                <p class="mt-2 text-xs leading-5 text-themed-muted">{{ feature.description }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <ThemeTemplateSlot
      slot-name="public.home.sections"
      container-class="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8"
    />

    <section class="kawaii-product-section relative overflow-hidden px-4 py-16 sm:px-6 lg:px-8">
      <div class="mx-auto max-w-7xl">
        <div
          class="kawaii-product-showcase"
          :class="`is-active-${activeProductLine}`"
          @mouseleave="setActiveProductLine('all')"
        >
          <div class="kawaii-product-copy">
            <div class="text-xs font-semibold uppercase tracking-[0.22em]" :class="ui.sectionLabel">
              {{ t('publicSite.portal.catalogLabel') }}
            </div>
            <h2 class="mt-5 max-w-xl text-4xl font-extrabold tracking-normal text-themed sm:text-[3.25rem] sm:leading-[1.04]">
              {{ t('publicSite.portal.catalogTitle') }}
            </h2>
            <p class="mt-5 max-w-2xl text-base leading-8" :class="ui.sectionBody">
              {{ t('publicSite.portal.catalogDescription') }}
            </p>

            <div class="kawaii-product-tags mt-8">
              <span>Direct / Hosted</span>
              <span>LXC / KVM</span>
              <span>IPv4 NAT / BGP</span>
            </div>
          </div>

          <div class="kawaii-product-selector">
            <article
              v-for="line in ecosystemCards"
              :key="line.key"
              class="kawaii-product-choice-card"
              :class="[line.source, { 'is-active': activeProductLine === line.source }]"
              tabindex="0"
              @mouseenter="setActiveProductLine(line.source)"
              @focusin="setActiveProductLine(line.source)"
              @click="browseCatalog(line.source)"
            >
              <div class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="rounded-lg px-2.5 py-1 text-[11px] font-semibold tracking-normal"
                      :class="getSourceChipClass(line.source)"
                    >
                      {{ line.source === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }}
                    </span>
                    <span class="kawaii-product-line-badge">
                      {{ line.source === 'official' ? t('publicSite.portal.stableSupply') : t('publicSite.portal.moreChoices') }}
                    </span>
                  </div>

                  <h3 class="mt-4 text-xl font-extrabold tracking-normal text-themed">
                    {{ line.title }}
                  </h3>
                  <p class="mt-3 text-sm leading-6" :class="line.source === 'official' ? ui.ecosystemOfficialBody : ui.ecosystemMarketBody">
                    {{ line.description }}
                  </p>
                </div>

                <div class="kawaii-product-choice-meta" :class="line.source">
                  <span>{{ line.source === 'official' ? 'Direct' : 'Hosted' }}</span>
                  <strong>{{ line.source === 'official' ? 'CN2 / BGP' : 'Multi' }}</strong>
                </div>
              </div>

              <div class="mt-5 grid gap-2 text-sm sm:grid-cols-2" :class="line.source === 'official' ? ui.ecosystemOfficialList : ui.ecosystemMarketList">
                <div v-for="point in line.points.slice(0, 2)" :key="point" class="flex items-start gap-2">
                  <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" :class="getSourceDotClass(line.source)"></span>
                  <span>{{ point }}</span>
                </div>
              </div>

              <div class="mt-5">
                <button
                  type="button"
                  class="kawaii-product-choice-action"
                  :class="line.source"
                  @click.stop="browseCatalog(line.source)"
                >
                  {{ line.source === 'official' ? t('publicSite.actions.browseOfficial') : t('publicSite.actions.browseMarket') }}
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 4.5l6 6m0 0l-6 6m6-6h-15" />
                  </svg>
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section class="kawaii-plan-section px-4 pb-20 sm:px-6 lg:px-8">
      <div
        class="mx-auto max-w-7xl rounded-lg px-6 py-9 sm:px-10"
        :class="ui.browseWrap"
      >
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="max-w-2xl">
            <div class="text-xs font-semibold uppercase tracking-[0.18em]" :class="ui.sectionLabel">
              {{ t('publicSite.portal.browseLabel') }}
            </div>
            <h2 class="mt-4 text-3xl font-extrabold tracking-normal text-themed sm:text-[2.25rem] sm:leading-[1.12]">
              {{ t('publicSite.portal.browseTitle') }}
            </h2>
            <p class="mt-4 text-base leading-7" :class="ui.sectionBody">
              {{ t('publicSite.portal.browseDescription') }}
            </p>
          </div>

          <button
            class="inline-flex h-10 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium tracking-normal transition-[background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-4"
            :class="ui.primaryButton"
            @click="browseCatalog()"
          >
            {{ t('publicSite.actions.browseProducts') }}
          </button>
        </div>

        <div class="mt-8 grid gap-4 lg:grid-cols-2">
          <template v-if="loading">
            <div
              v-for="index in 4"
              :key="index"
              class="h-36 animate-pulse rounded-lg"
              :class="ui.skeleton"
            ></div>
          </template>

          <template v-else-if="spotlightPackages.length > 0">
            <button
              v-for="pkg in spotlightPackages"
              :key="pkg.id"
              class="kawaii-spotlight-package flex min-h-36 flex-col gap-4 rounded-lg p-5 text-left transition-[border-color,box-shadow,transform] duration-150 sm:flex-row sm:items-stretch sm:justify-between"
              :class="[ui.browseCard, getPackageCardClass(pkg.sourceType)]"
              @click="openPackage(pkg)"
            >
              <div class="min-w-0 sm:max-w-[68%]">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="rounded-lg px-2 py-0.5 text-[11px] font-medium tracking-normal"
                    :class="getSourceChipClass(pkg.sourceType)"
                  >
                    {{ pkg.sourceType === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }}
                  </span>
                  <span
                    class="rounded-lg px-2 py-0.5 text-[11px] font-medium tracking-normal"
                    :class="getInstanceChipClass(pkg.instance_type)"
                  >
                    {{ pkg.instance_type === 'vm' ? 'KVM' : 'LXC' }}
                  </span>
                </div>
                <div class="mt-3 truncate text-lg font-medium" :class="ui.platformTitle">
                  {{ pkg.name }}
                </div>
                <div class="mt-2 line-clamp-2 text-sm leading-5" :class="ui.sectionBody">
                  {{ pkg.description || t('publicSite.portal.packageFallback') }}
                </div>
              </div>

              <div class="kawaii-package-side sm:shrink-0 sm:text-right">
                <div class="text-sm font-extrabold" :class="getPriceTextClass(pkg.sourceType)">
                  {{ getPriceLabel(pkg) }}
                </div>
                <div class="mt-1 text-xs" :class="ui.statLabel">
                  {{ formatTraffic(pkg.monthly_traffic_limit) }}
                </div>
              </div>
            </button>
          </template>

          <div
            v-else
            class="rounded-lg border border-dashed px-4 py-8 text-center text-sm"
            :class="ui.emptyState"
          >
            {{ t('publicSite.portal.emptyPackages') }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ── 首页门面：清掉遗留斜线/透视网格装饰，纯黑白 Apple ── */
.kawaii-page::before,
.kawaii-hero-shell::before,
.kawaii-hero-section::before,
.kawaii-hero-section::after,
.kawaii-product-section::before,
.kawaii-product-showcase::before,
.kawaii-product-stage::after {
  content: none !important;
  background: none !important;
}

/* 产品区外层面板：去掉斜向色渐变，改为干净描边卡 */
.kawaii-product-showcase {
  background: var(--kawaii-surface) !important;
  border-color: var(--kawaii-line) !important;
  box-shadow: var(--kawaii-shadow) !important;
}

/* ── 去掉绿色：所有 .market 变体中和为墨/灰 ── */
.kawaii-source-chip.market {
  background: var(--kawaii-primary) !important;
  color: var(--kawaii-bg) !important;
}
.kawaii-price-text.market {
  color: var(--kawaii-text) !important;
}
.kawaii-source-dot.market {
  background: var(--kawaii-text) !important;
}

/* ── 直营卡 = 墨黑实心（主推），内容整体反色 ── */
.kawaii-product-choice-card.official,
.kawaii-product-choice-card.official:hover,
.kawaii-product-choice-card.official:focus-visible,
.kawaii-product-choice-card.official.is-active {
  background: var(--kawaii-primary) !important;
  border-color: var(--kawaii-primary) !important;
  color: var(--kawaii-bg) !important;
}
.kawaii-product-choice-card.official :where(h3, p, span, strong) {
  color: var(--kawaii-bg) !important;
}
.kawaii-product-choice-card.official .kawaii-source-chip.official,
.kawaii-product-choice-card.official .kawaii-product-line-badge {
  background: color-mix(in srgb, var(--kawaii-bg) 16%, transparent) !important;
  border-color: transparent !important;
  color: var(--kawaii-bg) !important;
}
.kawaii-product-choice-card.official .kawaii-source-dot {
  background: var(--kawaii-bg) !important;
}
.kawaii-product-choice-card.official .kawaii-product-choice-meta {
  background: color-mix(in srgb, var(--kawaii-bg) 12%, transparent) !important;
  border-color: transparent !important;
}
.kawaii-product-choice-card.official .kawaii-product-choice-action {
  background: var(--kawaii-bg) !important;
  color: var(--kawaii-primary) !important;
  border-color: transparent !important;
}

/* ── 托管卡 = 白/描边（次级） ── */
.kawaii-product-choice-card.market,
.kawaii-product-choice-card.market.is-active {
  background: var(--kawaii-surface) !important;
  border-color: var(--kawaii-line) !important;
}
.kawaii-product-choice-card.market:hover,
.kawaii-product-choice-card.market:focus-visible {
  border-color: var(--kawaii-primary) !important;
}
.kawaii-product-choice-card.market .kawaii-product-choice-meta.market {
  border-color: var(--kawaii-line) !important;
}
.kawaii-product-choice-card.market .kawaii-product-choice-meta.market strong {
  color: var(--kawaii-text) !important;
}
.kawaii-product-choice-card.market .kawaii-product-choice-action.market {
  background: var(--kawaii-primary) !important;
  color: var(--kawaii-bg) !important;
  border-color: transparent !important;
}
</style>
