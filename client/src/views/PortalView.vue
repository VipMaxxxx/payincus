<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { usePageSeo } from '@/composables/usePageSeo'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useBrand } from '@/composables/useBrand'
import {
  formatPublicPrice,
  formatPublicTraffic,
  getStartingMonthlyPrice,
  type PackageSource,
  type PublicPackage,
  type PublicRegion
} from '@/utils/publicCatalog'

defineOptions({
  name: 'PortalView'
})

const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const brand = useBrand()

const packages = ref<PublicPackage[]>([])
const regions = ref<PublicRegion[]>([])
const loading = ref(true)

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

const statCards = computed(() => [
  { label: t('publicSite.portal.stats.packages'), value: String(packages.value.length) },
  { label: t('publicSite.portal.stats.regions'), value: String(regions.value.length) },
  { label: t('publicSite.portal.stats.official'), value: String(packages.value.filter(pkg => pkg.sourceType === 'official').length) },
  { label: t('publicSite.portal.stats.market'), value: String(packages.value.filter(pkg => pkg.sourceType === 'market').length) }
])

const platformCards = computed(() => [
  {
    title: t('publicSite.portal.experienceNoLoginTitle'),
    description: t('publicSite.portal.experienceNoLoginDescription')
  },
  {
    title: t('publicSite.portal.experienceRoutingTitle'),
    description: t('publicSite.portal.experienceRoutingDescription')
  },
  {
    title: t('publicSite.portal.experienceThemeTitle'),
    description: t('publicSite.portal.experienceThemeDescription')
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

// Material 3 baseline tokens
// Light: primary #0b57d0, on-primary #fff, primary-container #d3e3fd, on-primary-container #041e49
//        surface #faf9fd, surface-container #eef0f8, surface-container-high #e8eaf2, outline-variant #c3c6cf
// Dark:  primary #a8c7fa, on-primary #062e6f, primary-container #284777, on-primary-container #d3e3fd
//        surface #111418, surface-container #1d2024, surface-container-high #272a2f, outline-variant #43474e
const ui = computed(() => themeStore.isDark
  ? {
      badge: 'border-[#284777] bg-[#1a2c52] text-[#d3e3fd]',
      body: 'text-[#c3c6cf]',
      primaryButton: 'bg-[#a8c7fa] text-[#062e6f] shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)] hover:bg-[#bdd3fb] hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_2px_6px_2px_rgba(0,0,0,0.15)] focus-visible:ring-[#a8c7fa]/40',
      secondaryButton: 'bg-[#284777] text-[#d3e3fd] hover:bg-[#304f81] focus-visible:ring-[#a8c7fa]/40',
      statCard: 'border-[#43474e] bg-[#1d2024]',
      statValue: 'text-[#e3e2e6]',
      statLabel: 'text-[#8e9199]',
      heroTint: 'bg-[linear-gradient(180deg,rgba(26,44,82,0.55)_0%,rgba(26,44,82,0.25)_45%,rgba(17,20,24,0)_100%)]',
      previewCard: 'bg-[#1a2c52] text-[#d3e3fd] shadow-[0_4px_8px_3px_rgba(0,0,0,0.15),0_1px_3px_rgba(0,0,0,0.3)]',
      previewLabel: 'text-[#a8c7fa]',
      previewTitle: 'text-[#eaf1ff]',
      previewButton: 'bg-[#a8c7fa] text-[#062e6f] hover:bg-[#bdd3fb]',
      previewBody: 'text-[#c3dafd]',
      terminalCard: 'bg-[#0b1422] text-[#d3e3fd]',
      terminalMeta: 'text-[#89a2cf]',
      platformCard: 'bg-[#1f3159] text-[#eaf1ff]',
      platformTitle: 'text-[#eaf1ff]',
      platformBody: 'text-[#b8cbe8]',
      sectionLabel: 'text-[#8e9199]',
      sectionBody: 'text-[#c3c6cf]',
      ecosystemOfficialCard: 'bg-[#1a2c52] text-[#d3e3fd]',
      ecosystemMarketCard: 'bg-[#223527] text-[#c8e6c9]',
      ecosystemOfficialBody: 'text-[#c3dafd]',
      ecosystemMarketBody: 'text-[#b7d3b7]',
      ecosystemOfficialList: 'text-[#eaf1ff]',
      ecosystemMarketList: 'text-[#dbeadb]',
      ecosystemOfficialButton: 'bg-[#a8c7fa] text-[#062e6f] hover:bg-[#bdd3fb]',
      ecosystemMarketButton: 'bg-[#a0cfa2] text-[#0c3810] hover:bg-[#b4d9b5]',
      browseWrap: 'border-[#43474e] bg-[#1d2024]',
      browseCard: 'shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)] hover:shadow-[0_1px_3px_rgba(0,0,0,0.3),0_4px_8px_3px_rgba(0,0,0,0.15)]',
      emptyState: 'border-[#43474e] bg-[#1d2024] text-[#8e9199]',
      skeleton: 'bg-[#272a2f]'
    }
  : {
      badge: 'border-[#aac7fa]/60 bg-[#d3e3fd] text-[#041e49]',
      body: 'text-[#43474e]',
      primaryButton: 'bg-[#0b57d0] text-white shadow-[0_1px_2px_rgba(11,87,208,0.3),0_1px_3px_1px_rgba(11,87,208,0.15)] hover:bg-[#0848ad] hover:shadow-[0_1px_2px_rgba(11,87,208,0.3),0_2px_6px_2px_rgba(11,87,208,0.15)] focus-visible:ring-[#0b57d0]/30',
      secondaryButton: 'bg-[#d3e3fd] text-[#041e49] hover:bg-[#c1d6fc] focus-visible:ring-[#0b57d0]/30',
      statCard: 'bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_1px_3px_1px_rgba(15,23,42,0.06)]',
      statValue: 'text-[#1a1b20]',
      statLabel: 'text-[#74777f]',
      heroTint: 'bg-[linear-gradient(180deg,rgba(211,227,253,0.7)_0%,rgba(223,235,254,0.35)_45%,rgba(252,252,253,0)_100%)]',
      previewCard: 'bg-[#d3e3fd] text-[#041e49] shadow-[0_1px_3px_rgba(11,87,208,0.1),0_4px_8px_3px_rgba(11,87,208,0.08)]',
      previewLabel: 'text-[#1a4191]',
      previewTitle: 'text-[#041e49]',
      previewButton: 'bg-[#0b57d0] text-white hover:bg-[#0848ad]',
      previewBody: 'text-[#24366e]',
      terminalCard: 'bg-[#1b273e] text-[#e3ebff]',
      terminalMeta: 'text-[#a8bce6]',
      platformCard: 'bg-white/80 text-[#041e49]',
      platformTitle: 'text-[#041e49]',
      platformBody: 'text-[#3b4a73]',
      sectionLabel: 'text-[#74777f]',
      sectionBody: 'text-[#43474e]',
      ecosystemOfficialCard: 'bg-[#d3e3fd] text-[#041e49]',
      ecosystemMarketCard: 'bg-[#d7edd9] text-[#0c3810]',
      ecosystemOfficialBody: 'text-[#24366e]',
      ecosystemMarketBody: 'text-[#295330]',
      ecosystemOfficialList: 'text-[#041e49]',
      ecosystemMarketList: 'text-[#0c3810]',
      ecosystemOfficialButton: 'bg-[#0b57d0] text-white hover:bg-[#0848ad]',
      ecosystemMarketButton: 'bg-[#3a6a49] text-white hover:bg-[#2c5238]',
      browseWrap: 'bg-[#eef0f8]',
      browseCard: 'shadow-[0_1px_2px_rgba(15,23,42,0.08),0_1px_3px_1px_rgba(15,23,42,0.06)] hover:shadow-[0_1px_3px_rgba(15,23,42,0.1),0_4px_8px_3px_rgba(15,23,42,0.08)]',
      emptyState: 'border-[#c3c6cf] bg-white text-[#74777f]',
      skeleton: 'bg-[#e2e4ed]'
    }
)

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
  if (source === 'official') {
    return themeStore.isDark
      ? 'border border-[#a8c7fa]/70 text-[#a8c7fa]'
      : 'border border-[#0b57d0]/40 text-[#0b57d0]'
  }

  return themeStore.isDark
    ? 'border border-[#a1cdb3]/70 text-[#a1cdb3]'
    : 'border border-[#3a6a49]/40 text-[#3a6a49]'
}

function getSourceDotClass(source: PackageSource): string {
  if (source === 'official') {
    return themeStore.isDark ? 'bg-[#a8c7fa]' : 'bg-[#0b57d0]'
  }

  return themeStore.isDark ? 'bg-[#a1cdb3]' : 'bg-[#3a6a49]'
}

function getInstanceChipClass(instanceType: string): string {
  if (instanceType === 'vm') {
    return themeStore.isDark
      ? 'border border-[#ffdfa6]/60 text-[#ffdfa6]'
      : 'border border-[#7a5900]/40 text-[#7a5900]'
  }

  return themeStore.isDark
    ? 'border border-[#8e9199]/60 text-[#c3c6cf]'
    : 'border border-[#74777f]/40 text-[#43474e]'
}

function getEcosystemCardClass(source: PackageSource): string {
  if (source === 'official') {
    return themeStore.isDark ? ui.value.ecosystemOfficialCard : ui.value.ecosystemOfficialCard
  }
  return themeStore.isDark ? ui.value.ecosystemMarketCard : ui.value.ecosystemMarketCard
}

function getPackageCardClass(_source: PackageSource): string {
  return themeStore.isDark
    ? 'bg-[#272a2f] hover:bg-[#2d3136]'
    : 'bg-white hover:bg-[#f8f9fc]'
}

function getPriceTextClass(source: PackageSource): string {
  if (source === 'official') {
    return themeStore.isDark ? 'text-[#a8c7fa]' : 'text-[#0b57d0]'
  }
  return themeStore.isDark ? 'text-[#a1cdb3]' : 'text-[#3a6a49]'
}

function browseCatalog(source?: PackageSource): void {
  void router.push({
    path: '/market',
    query: source ? { source } : undefined
  })
}

function openPackage(pkg: PublicPackage): void {
  void router.push({
    path: '/market',
    query: {
      source: pkg.sourceType,
      package: String(pkg.id)
    }
  })
}

function goToConsole(): void {
  if (authStore.isAuthenticated) {
    const target = authStore.isAdmin ? '/admin/users' : '/dashboard'
    void router.push(target)
    return
  }

  void router.push('/login')
}

async function loadCatalog(): Promise<void> {
  loading.value = true

  try {
    const [packagesResponse, regionsResponse] = await Promise.all([
      api.packages.listPublic(),
      api.packages.getPublicRegions()
    ])

    packages.value = (packagesResponse.packages || []) as unknown as PublicPackage[]
    regions.value = regionsResponse.regions || []
  } catch (error) {
    console.error('Failed to load public catalog:', error)
    packages.value = []
    regions.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadCatalog()
})
</script>

<template>
  <div class="relative">
    <section class="relative px-4 pb-20 pt-14 sm:px-6 lg:px-8">
      <div class="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div class="max-w-3xl">
          <div
            class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium"
            :class="ui.badge"
          >
            <span class="h-1.5 w-1.5 rounded-full" :class="themeStore.isDark ? 'bg-[#a8c7fa]' : 'bg-[#0b57d0]'"></span>
            {{ t('publicSite.portal.badge') }}
          </div>

          <h1 class="mt-6 text-4xl font-normal tracking-[-0.02em] sm:text-5xl lg:text-[3.5rem] lg:leading-[1.1]">
            {{ t('publicSite.portal.title') }}
          </h1>
          <p class="mt-6 max-w-2xl text-base leading-7 sm:text-lg sm:leading-8" :class="ui.body">
            {{ t('publicSite.portal.description') }}
          </p>

          <div class="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              class="inline-flex h-10 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium tracking-[0.01em] transition-[background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-4"
              :class="ui.primaryButton"
              @click="browseCatalog()"
            >
              <span>{{ t('publicSite.actions.browseProducts') }}</span>
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 4.5l6 6m0 0l-6 6m6-6h-15" />
              </svg>
            </button>

            <button
              class="inline-flex h-10 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium tracking-[0.01em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4"
              :class="ui.secondaryButton"
              @click="goToConsole"
            >
              <span class="sm:hidden">{{ consoleActionCompactLabel }}</span>
              <span class="hidden sm:inline">{{ consoleActionLabel }}</span>
            </button>
          </div>

          <div class="mt-10 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div
              v-for="item in statCards"
              :key="item.label"
              class="rounded-2xl px-4 py-4 transition-shadow duration-150"
              :class="ui.statCard"
            >
              <div class="text-xs font-medium" :class="ui.statLabel">
                {{ item.label }}
              </div>
              <div class="mt-2 text-2xl font-normal tracking-[-0.02em]" :class="ui.statValue">
                {{ item.value }}
              </div>
            </div>
          </div>
        </div>

        <div class="relative">
          <div
            class="relative overflow-hidden rounded-[28px] p-6"
            :class="ui.previewCard"
          >
            <div class="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class="text-xs font-medium" :class="ui.previewLabel">
                  {{ t('publicSite.portal.previewLabel') }}
                </div>
                <div class="mt-2 text-2xl font-normal tracking-[-0.02em]" :class="ui.previewTitle">
                  {{ t('publicSite.portal.previewTitle') }}
                </div>
              </div>

              <button
                class="h-10 rounded-full px-5 text-sm font-medium transition-colors duration-150"
                :class="ui.previewButton"
                @click="browseCatalog()"
              >
                {{ t('publicSite.actions.viewCatalog') }}
              </button>
            </div>

            <p class="mt-4 text-sm leading-6" :class="ui.previewBody">
              {{ t('publicSite.portal.previewDescription') }}
            </p>

            <div class="mt-6 rounded-2xl p-5 font-mono text-xs leading-6" :class="ui.terminalCard">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span>root@incudal</span>
                <span :class="ui.terminalMeta">incus console</span>
              </div>
              <div class="mt-4 space-y-1">
                <div>{{ t('publicSite.portal.controlPoint1') }}</div>
                <div>{{ t('publicSite.portal.controlPoint2') }}</div>
                <div>{{ t('publicSite.portal.controlPoint3') }}</div>
              </div>
            </div>

            <div class="mt-6 grid gap-3 sm:grid-cols-3">
              <div
                v-for="card in platformCards"
                :key="card.title"
                class="rounded-2xl p-4 transition-colors duration-150"
                :class="ui.platformCard"
              >
                <div class="text-sm font-medium" :class="ui.platformTitle">
                  {{ card.title }}
                </div>
                <p class="mt-2 text-xs leading-5" :class="ui.platformBody">
                  {{ card.description }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="px-4 py-20 sm:px-6 lg:px-8">
      <div class="mx-auto max-w-7xl">
        <div class="max-w-2xl">
          <div class="text-xs font-medium" :class="ui.sectionLabel">
            {{ t('publicSite.portal.catalogLabel') }}
          </div>
          <h2 class="mt-4 text-3xl font-normal tracking-[-0.02em] sm:text-[2.25rem] sm:leading-[1.15]">
            {{ t('publicSite.portal.catalogTitle') }}
          </h2>
          <p class="mt-4 text-base leading-7" :class="ui.sectionBody">
            {{ t('publicSite.portal.catalogDescription') }}
          </p>
        </div>

        <div class="mt-10 grid gap-6 lg:grid-cols-2">
          <article
            v-for="line in ecosystemCards"
            :key="line.key"
            class="rounded-[28px] p-7 transition-shadow duration-150"
            :class="getEcosystemCardClass(line.source)"
          >
            <div class="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 class="text-2xl font-normal tracking-[-0.02em]">
                  {{ line.title }}
                </h3>
                <p class="mt-3 text-sm leading-6" :class="line.source === 'official' ? ui.ecosystemOfficialBody : ui.ecosystemMarketBody">
                  {{ line.description }}
                </p>
              </div>
              <span
                class="rounded-lg px-2.5 py-1 text-[11px] font-medium tracking-[0.02em]"
                :class="getSourceChipClass(line.source)"
              >
                {{ line.source === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }}
              </span>
            </div>

            <div class="mt-6 space-y-3 text-sm" :class="line.source === 'official' ? ui.ecosystemOfficialList : ui.ecosystemMarketList">
              <div v-for="point in line.points" :key="point" class="flex items-start gap-3">
                <span class="mt-1.5 h-1.5 w-1.5 rounded-full" :class="getSourceDotClass(line.source)"></span>
                <span>{{ point }}</span>
              </div>
            </div>

            <div class="mt-6">
              <button
                class="inline-flex h-10 items-center gap-2 rounded-full px-6 text-sm font-medium transition-colors duration-150"
                :class="line.source === 'official' ? ui.ecosystemOfficialButton : ui.ecosystemMarketButton"
                @click="browseCatalog(line.source)"
              >
                {{ line.source === 'official' ? t('publicSite.actions.browseOfficial') : t('publicSite.actions.browseMarket') }}
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="px-4 pb-20 sm:px-6 lg:px-8">
      <div
        class="mx-auto max-w-7xl rounded-[28px] px-6 py-10 sm:px-10"
        :class="ui.browseWrap"
      >
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="max-w-2xl">
            <div class="text-xs font-medium" :class="ui.sectionLabel">
              {{ t('publicSite.portal.browseLabel') }}
            </div>
            <h2 class="mt-4 text-3xl font-normal tracking-[-0.02em] sm:text-[2.25rem] sm:leading-[1.15]">
              {{ t('publicSite.portal.browseTitle') }}
            </h2>
            <p class="mt-4 text-base leading-7" :class="ui.sectionBody">
              {{ t('publicSite.portal.browseDescription') }}
            </p>
          </div>

          <button
            class="inline-flex h-10 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium tracking-[0.01em] transition-[background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-4"
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
              class="h-40 animate-pulse rounded-xl"
              :class="ui.skeleton"
            ></div>
          </template>

          <template v-else-if="spotlightPackages.length > 0">
            <button
              v-for="pkg in spotlightPackages"
              :key="pkg.id"
              class="flex flex-col gap-4 rounded-2xl p-5 text-left transition-[background-color,box-shadow] duration-150 sm:flex-row sm:items-start sm:justify-between"
              :class="[ui.browseCard, getPackageCardClass(pkg.sourceType)]"
              @click="openPackage(pkg)"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="rounded-lg px-2 py-0.5 text-[11px] font-medium tracking-[0.02em]"
                    :class="getSourceChipClass(pkg.sourceType)"
                  >
                    {{ pkg.sourceType === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }}
                  </span>
                  <span
                    class="rounded-lg px-2 py-0.5 text-[11px] font-medium tracking-[0.02em]"
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

              <div class="sm:shrink-0 sm:text-right">
                <div class="text-sm font-medium" :class="getPriceTextClass(pkg.sourceType)">
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
            class="rounded-2xl border border-dashed px-4 py-8 text-center text-sm"
            :class="ui.emptyState"
          >
            {{ t('publicSite.portal.emptyPackages') }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
