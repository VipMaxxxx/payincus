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
  <div ref="portalRoot" class="kawaii-page kawaii-home-page nimbus-home relative">
    <ThemeTemplateSlot
      slot-name="public.home.hero"
      container-class="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8"
    />

    <!-- 1. HERO -->
    <section class="nimbus-hero relative overflow-hidden">
      <div class="nimbus-hero-bg" aria-hidden="true"></div>
      <div class="relative mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:px-8 lg:pb-24 lg:pt-28">
        <div class="mx-auto flex max-w-3xl flex-col items-center text-center" data-reveal>
          <div class="nimbus-eyebrow">
            <span class="nimbus-eyebrow-dot"></span>
            {{ t('publicSite.portal.badge') }}
          </div>

          <h1 class="nimbus-hero-title mt-6">
            <span class="block">{{ heroTitlePrimary }}</span>
            <span class="block">{{ heroTitlePrefix }}<span class="nimbus-grad">{{ heroTitleAccent }}</span></span>
          </h1>

          <p class="nimbus-hero-sub">{{ t('publicSite.portal.description') }}</p>

          <div class="nimbus-hero-actions">
            <button class="kawaii-primary-button nimbus-btn nimbus-btn-primary" @click="browseCatalog()">
              <span>{{ t('publicSite.actions.browseProducts') }}</span>
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13.5 4.5l6 6m0 0l-6 6m6-6h-15" />
              </svg>
            </button>

            <button class="kawaii-secondary-button nimbus-btn nimbus-btn-ghost" @click="goToConsole">
              <span class="sm:hidden">{{ consoleActionCompactLabel }}</span>
              <span class="hidden sm:inline">{{ consoleActionLabel }}</span>
            </button>
          </div>

          <div class="nimbus-hero-trust">
            <span class="nimbus-trust-chip">Direct / Hosted</span>
            <span class="nimbus-trust-chip">LXC / KVM</span>
            <span class="nimbus-trust-chip">IPv4 NAT / BGP</span>
          </div>
        </div>
      </div>
    </section>

    <ThemeTemplateSlot
      slot-name="public.home.sections"
      container-class="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8"
    />

    <!-- 2. STAT STRIP -->
    <section class="nimbus-section nimbus-stat-section">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="nimbus-stat-strip" data-reveal>
          <div class="nimbus-stat">
            <div class="nimbus-stat-value">{{ packages.length }}</div>
            <div class="nimbus-stat-label">{{ t('publicSite.portal.stats.packages') }}</div>
          </div>
          <div class="nimbus-stat">
            <div class="nimbus-stat-value">{{ packages.filter((item) => item.sourceType === 'official').length }}</div>
            <div class="nimbus-stat-label">{{ t('publicSite.portal.stats.official') }}</div>
          </div>
          <div class="nimbus-stat">
            <div class="nimbus-stat-value">{{ packages.filter((item) => item.sourceType === 'market').length }}</div>
            <div class="nimbus-stat-label">{{ t('publicSite.portal.stats.market') }}</div>
          </div>
          <div class="nimbus-stat">
            <div class="nimbus-stat-value">8+</div>
            <div class="nimbus-stat-label">{{ t('publicSite.portal.stats.regions') }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 3. DUAL SELECTOR: 官方直营 / 托管市场 -->
    <section class="nimbus-section">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="nimbus-section-head" data-reveal>
          <div class="nimbus-kicker">{{ t('publicSite.portal.catalogLabel') }}</div>
          <h2 class="nimbus-h2">{{ t('publicSite.portal.catalogTitle') }}</h2>
          <p class="nimbus-lead">{{ t('publicSite.portal.catalogDescription') }}</p>
        </div>

        <div class="nimbus-choice-grid" data-reveal @mouseleave="setActiveProductLine('all')">
          <article
            v-for="line in ecosystemCards"
            :key="line.key"
            class="nimbus-choice-card nimbus-lift"
            :class="[line.source, { 'is-active': activeProductLine === line.source }]"
            tabindex="0"
            @mouseenter="setActiveProductLine(line.source)"
            @focusin="setActiveProductLine(line.source)"
            @click="browseCatalog(line.source)"
          >
            <div class="nimbus-choice-top">
              <div class="nimbus-icon-tile">
                <svg v-if="line.source === 'official'" class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M12 3l7 3v5c0 4.5-2.9 8.4-7 9.8C7.9 19.4 5 15.5 5 11V6l7-3z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M9.3 12l1.9 1.9 3.8-4.1" />
                </svg>
                <svg v-else class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
                </svg>
              </div>
              <div class="nimbus-choice-tags">
                <span
                  class="rounded-lg px-2.5 py-1 text-[11px] font-semibold tracking-normal"
                  :class="getSourceChipClass(line.source)"
                >
                  {{ line.source === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }}
                </span>
                <span class="nimbus-choice-badge">
                  {{ line.source === 'official' ? t('publicSite.portal.stableSupply') : t('publicSite.portal.moreChoices') }}
                </span>
              </div>
            </div>

            <h3 class="nimbus-choice-title">{{ line.title }}</h3>
            <p class="nimbus-choice-desc">{{ line.description }}</p>

            <ul class="nimbus-choice-points">
              <li v-for="point in line.points.slice(0, 3)" :key="point">
                <span class="nimbus-point-dot" :class="getSourceDotClass(line.source)"></span>
                <span>{{ point }}</span>
              </li>
            </ul>

            <button
              type="button"
              class="nimbus-choice-action"
              @click.stop="browseCatalog(line.source)"
            >
              {{ line.source === 'official' ? t('publicSite.actions.browseOfficial') : t('publicSite.actions.browseMarket') }}
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13.5 4.5l6 6m0 0l-6 6m6-6h-15" />
              </svg>
            </button>
          </article>
        </div>
      </div>
    </section>

    <!-- 4. FEATURE HIGHLIGHTS -->
    <section class="nimbus-section">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="nimbus-section-head" data-reveal>
          <div class="nimbus-kicker">{{ t('publicSite.portal.previewLabel') }}</div>
          <h2 class="nimbus-h2">{{ t('publicSite.portal.title') }}</h2>
          <p class="nimbus-lead">{{ t('publicSite.portal.previewDescription') }}</p>
        </div>

        <div class="nimbus-feature-grid" data-reveal>
          <article
            v-for="feature in heroFeatureCards"
            :key="feature.title"
            class="nimbus-feature-card nimbus-lift"
          >
            <div class="nimbus-icon-tile">
              <svg v-if="feature.icon === 'network'" class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M4 16.5A4.5 4.5 0 018.5 12H9a6 6 0 1111.31 3.73A3.5 3.5 0 0117.5 21h-10A3.5 3.5 0 014 16.5z" />
              </svg>
              <svg v-else-if="feature.icon === 'compute'" class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M7 8h10M7 12h10M7 16h6M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
              </svg>
              <svg v-else-if="feature.icon === 'secure'" class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M12 3l7 3v5c0 4.5-2.9 8.4-7 9.8C7.9 19.4 5 15.5 5 11V6l7-3z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M9.5 12l1.7 1.7 3.8-4" />
              </svg>
              <svg v-else class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M12 3v3m0 12v3M4.64 5.64l2.12 2.12m10.48 10.48l2.12 2.12M3 12h3m12 0h3M4.64 18.36l2.12-2.12M17.24 7.76l2.12-2.12" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M9 12a3 3 0 106 0 3 3 0 00-6 0z" />
              </svg>
            </div>
            <h3 class="nimbus-feature-title">{{ feature.title }}</h3>
            <p class="nimbus-feature-desc">{{ feature.description }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- 5. PACKAGE SPOTLIGHT -->
    <section class="nimbus-section">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="nimbus-plan-head" data-reveal>
          <div class="max-w-2xl">
            <div class="nimbus-kicker">{{ t('publicSite.portal.browseLabel') }}</div>
            <h2 class="nimbus-h2">{{ t('publicSite.portal.browseTitle') }}</h2>
            <p class="nimbus-lead">{{ t('publicSite.portal.browseDescription') }}</p>
          </div>

          <button class="kawaii-secondary-button nimbus-btn nimbus-btn-ghost nimbus-plan-head-btn" @click="browseCatalog()">
            {{ t('publicSite.actions.browseProducts') }}
          </button>
        </div>

        <div class="nimbus-plan-grid" data-reveal>
          <template v-if="loading">
            <div
              v-for="index in 4"
              :key="index"
              class="nimbus-plan-skeleton animate-pulse"
              :class="ui.skeleton"
            ></div>
          </template>

          <template v-else-if="spotlightPackages.length > 0">
            <button
              v-for="pkg in spotlightPackages"
              :key="pkg.id"
              class="nimbus-plan-card nimbus-lift"
              :class="getPackageCardClass(pkg.sourceType)"
              @click="openPackage(pkg)"
            >
              <div class="nimbus-plan-card-head">
                <span
                  class="rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-normal"
                  :class="getSourceChipClass(pkg.sourceType)"
                >
                  {{ pkg.sourceType === 'official' ? t('publicSite.market.official') : t('publicSite.market.market') }}
                </span>
                <span
                  class="rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-normal"
                  :class="getInstanceChipClass(pkg.instance_type)"
                >
                  {{ pkg.instance_type === 'vm' ? 'KVM' : 'LXC' }}
                </span>
              </div>

              <div class="nimbus-plan-name">{{ pkg.name }}</div>
              <p class="nimbus-plan-desc">{{ pkg.description || t('publicSite.portal.packageFallback') }}</p>

              <div class="nimbus-plan-foot">
                <span class="nimbus-plan-price" :class="getPriceTextClass(pkg.sourceType)">
                  {{ getPriceLabel(pkg) }}
                </span>
                <span class="nimbus-plan-traffic">{{ formatTraffic(pkg.monthly_traffic_limit) }}</span>
              </div>
            </button>
          </template>

          <div v-else class="nimbus-empty" :class="ui.emptyState">
            {{ t('publicSite.portal.emptyPackages') }}
          </div>
        </div>
      </div>
    </section>

    <!-- 6. CLOSING CTA BAND -->
    <section class="nimbus-section nimbus-cta-section">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="nimbus-cta-band" data-reveal>
          <div class="nimbus-cta-grid" aria-hidden="true"></div>
          <div class="nimbus-cta-inner">
            <h2 class="nimbus-cta-title">
              {{ heroTitlePrefix }}<span>{{ heroTitleAccent }}</span>
            </h2>
            <p class="nimbus-cta-sub">{{ t('publicSite.portal.authPanelDescription') }}</p>
            <div class="nimbus-cta-actions">
              <button class="nimbus-btn nimbus-cta-primary" @click="browseCatalog()">
                {{ t('publicSite.actions.browseProducts') }}
              </button>
              <button class="nimbus-btn nimbus-cta-ghost" @click="goToConsole">
                <span class="sm:hidden">{{ consoleActionCompactLabel }}</span>
                <span class="hidden sm:inline">{{ consoleActionLabel }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ══════════════════════════════════════════════════════════════
   Nimbus landing — white-primary + indigo, FAANG-grade rebuild.
   Uses --kawaii-* token layer (indigo/white) so light & dark both hold.
   ══════════════════════════════════════════════════════════════ */

/* 清掉遗留门面装饰（斜线/透视网格/发光），保持干净 */
.kawaii-page::before,
.kawaii-home-page::before,
.kawaii-home-page::after {
  content: none !important;
  background: none !important;
}

.nimbus-home {
  background: var(--kawaii-bg);
}

/* ── 状态色中和：源/实例徽章在首页统一为 墨/靛，不出现绿/琥珀 ── */
.kawaii-source-chip.market {
  background: var(--kawaii-primary) !important;
  color: #fff !important;
}
.kawaii-price-text.market {
  color: var(--kawaii-text) !important;
}
.kawaii-source-dot.market {
  background: var(--kawaii-primary) !important;
}
.kawaii-instance-chip.vm,
.kawaii-instance-chip.lxc {
  color: var(--kawaii-text) !important;
}

/* ── 通用节奏 ── */
.nimbus-section {
  padding-block: clamp(3rem, 6vw, 5.5rem);
}
.nimbus-stat-section {
  padding-top: clamp(1.5rem, 3vw, 2.5rem);
}
.nimbus-cta-section {
  padding-bottom: clamp(3.5rem, 7vw, 6rem);
}

/* ── 段落标题簇 ── */
.nimbus-kicker {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--kawaii-primary-strong);
}
.nimbus-section-head {
  max-width: 44rem;
}
.nimbus-h2 {
  margin-top: 0.85rem;
  font-size: clamp(1.75rem, 3vw + 0.5rem, 2.75rem);
  line-height: 1.08;
  letter-spacing: -0.02em;
  font-weight: 800;
  color: var(--kawaii-text);
  text-wrap: balance;
}
.nimbus-lead {
  margin-top: 1rem;
  max-width: 52ch;
  font-size: clamp(0.98rem, 1.4vw, 1.075rem);
  line-height: 1.7;
  color: var(--kawaii-muted);
}

/* ── HERO ── */
.nimbus-hero {
  position: relative;
  isolation: isolate;
}
.nimbus-hero-bg {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image:
    radial-gradient(60% 55% at 50% -6%, color-mix(in srgb, var(--kawaii-primary) 16%, transparent), transparent 72%),
    linear-gradient(var(--kawaii-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--kawaii-line) 1px, transparent 1px);
  background-size: 100% 100%, 48px 48px, 48px 48px;
  opacity: 0.55;
  -webkit-mask-image: radial-gradient(75% 62% at 50% 0%, #000 30%, transparent 82%);
  mask-image: radial-gradient(75% 62% at 50% 0%, #000 30%, transparent 82%);
}
.nimbus-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--kawaii-primary) 30%, var(--kawaii-line));
  background: color-mix(in srgb, var(--kawaii-primary) 8%, var(--kawaii-surface));
  color: var(--kawaii-primary-strong);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.03em;
}
.nimbus-eyebrow-dot {
  position: relative;
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--kawaii-primary);
}
.nimbus-eyebrow-dot::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 999px;
  border: 1px solid var(--kawaii-primary);
  opacity: 0;
  animation: nimbus-eyebrow-ping 2.6s ease-out infinite;
}
@keyframes nimbus-eyebrow-ping {
  0% { transform: scale(0.55); opacity: 0.6; }
  100% { transform: scale(1.75); opacity: 0; }
}
.nimbus-hero-title {
  font-size: clamp(2.375rem, 5vw + 1rem, 3.75rem);
  line-height: 1.04;
  letter-spacing: -0.03em;
  font-weight: 800;
  color: var(--kawaii-text);
  text-wrap: balance;
}
.nimbus-grad {
  background: linear-gradient(120deg, var(--kawaii-primary), var(--kawaii-primary-strong));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.nimbus-hero-sub {
  margin-top: 1.35rem;
  max-width: 46ch;
  font-size: clamp(1rem, 1.5vw, 1.15rem);
  line-height: 1.7;
  color: var(--kawaii-muted);
}
.nimbus-hero-actions {
  margin-top: 2rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
}
.nimbus-hero-trust {
  margin-top: 2.25rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}
.nimbus-trust-chip {
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface);
  color: var(--kawaii-muted);
  font-size: 0.75rem;
  font-weight: 600;
  font-family: var(--font-mono, ui-monospace, monospace);
  letter-spacing: 0.01em;
}

/* ── 按钮 ── */
.nimbus-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 2.85rem;
  padding: 0 1.6rem;
  border-radius: 12px;
  font-size: 0.9rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: transform 180ms ease, box-shadow 200ms ease, filter 200ms ease, background-color 200ms ease, border-color 200ms ease;
}
.nimbus-btn:focus-visible {
  outline: 2px solid var(--kawaii-primary);
  outline-offset: 2px;
}
.nimbus-btn-ghost {
  color: var(--kawaii-text);
}

/* ── 悬浮抬升（卡片通用） ── */
.nimbus-lift {
  transition: transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1), box-shadow 300ms ease, border-color 300ms ease;
}
.nimbus-lift:hover {
  transform: translateY(-4px);
}

/* ── 数据条 ── */
.nimbus-stat-strip {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  border: 1px solid var(--kawaii-line);
  border-radius: 18px;
  overflow: hidden;
  background: var(--kawaii-line);
}
.nimbus-stat {
  background: var(--kawaii-surface);
  padding: 1.5rem 1rem;
  text-align: center;
}
.nimbus-stat-value {
  font-size: clamp(1.6rem, 3.4vw, 2.25rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--kawaii-text);
  font-variant-numeric: tabular-nums;
}
.nimbus-stat-label {
  margin-top: 0.35rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--kawaii-muted);
}

/* ── 双选卡：官方直营 / 托管市场 ── */
.nimbus-choice-grid {
  margin-top: 2.25rem;
  display: grid;
  gap: 1.25rem;
  grid-template-columns: 1fr;
}
.nimbus-choice-card {
  display: flex;
  flex-direction: column;
  padding: 1.75rem;
  border-radius: 20px;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface);
  box-shadow: var(--kawaii-shadow);
  cursor: pointer;
  outline: none;
}
.nimbus-choice-card:hover,
.nimbus-choice-card:focus-visible,
.nimbus-choice-card.is-active {
  border-color: color-mix(in srgb, var(--kawaii-primary) 42%, var(--kawaii-line));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--kawaii-primary) 28%, transparent),
    0 22px 46px -22px color-mix(in srgb, var(--kawaii-primary) 55%, transparent);
}
.nimbus-choice-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.nimbus-choice-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}
.nimbus-choice-badge {
  padding: 0.3rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface-soft);
  color: var(--kawaii-muted);
  font-size: 0.7rem;
  font-weight: 600;
}
.nimbus-choice-title {
  margin-top: 1.25rem;
  font-size: 1.3rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--kawaii-text);
}
.nimbus-choice-desc {
  margin-top: 0.6rem;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--kawaii-muted);
}
.nimbus-choice-points {
  margin-top: 1.15rem;
  display: grid;
  gap: 0.6rem;
  list-style: none;
  padding: 0;
}
.nimbus-choice-points li {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--kawaii-text);
}
.nimbus-point-dot {
  margin-top: 0.45rem;
  width: 0.4rem;
  height: 0.4rem;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--kawaii-primary);
}
.nimbus-choice-action {
  margin-top: 1.5rem;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1.1rem;
  border-radius: 10px;
  background: var(--kawaii-primary);
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: filter 180ms ease, transform 180ms ease;
}
.nimbus-choice-action:hover {
  filter: brightness(1.05);
  transform: translateX(2px);
}
.nimbus-choice-action:focus-visible {
  outline: 2px solid var(--kawaii-primary);
  outline-offset: 2px;
}

/* ── 图标底片（靛蓝浅底） ── */
.nimbus-icon-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--kawaii-primary) 22%, transparent);
  background: color-mix(in srgb, var(--kawaii-primary) 12%, var(--kawaii-surface));
  color: var(--kawaii-primary);
  flex-shrink: 0;
}

/* ── 能力 bento ── */
.nimbus-feature-grid {
  margin-top: 2.25rem;
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.nimbus-feature-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  border-radius: 16px;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface);
}
.nimbus-feature-card:hover {
  border-color: color-mix(in srgb, var(--kawaii-primary) 35%, var(--kawaii-line));
  box-shadow: 0 18px 38px -24px color-mix(in srgb, var(--kawaii-primary) 45%, transparent);
}
.nimbus-feature-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--kawaii-text);
}
.nimbus-feature-desc {
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--kawaii-muted);
}

/* ── 套餐聚焦 ── */
.nimbus-plan-head {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.nimbus-plan-head-btn {
  align-self: flex-start;
}
.nimbus-plan-grid {
  margin-top: 2.25rem;
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.nimbus-plan-skeleton {
  height: 11rem;
  border-radius: 16px;
}
.nimbus-plan-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-height: 11rem;
  padding: 1.5rem;
  border-radius: 16px !important;
  border: 1px solid var(--kawaii-line) !important;
  background: var(--kawaii-surface) !important;
  box-shadow: none !important;
  text-align: left;
  cursor: pointer;
}
/* 中和 kawaii-package-card 遗留斜线/角标装饰 */
.nimbus-plan-card::before,
.nimbus-plan-card::after {
  content: none !important;
}
.nimbus-plan-card:hover {
  border-color: color-mix(in srgb, var(--kawaii-primary) 40%, var(--kawaii-line)) !important;
  box-shadow: 0 20px 42px -24px color-mix(in srgb, var(--kawaii-primary) 55%, transparent) !important;
}
.nimbus-plan-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.nimbus-plan-name {
  margin-top: 0.3rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--kawaii-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nimbus-plan-desc {
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--kawaii-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nimbus-plan-foot {
  margin-top: auto;
  padding-top: 0.75rem;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  border-top: 1px solid var(--kawaii-line);
}
.nimbus-plan-price {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--kawaii-text);
}
.nimbus-plan-traffic {
  font-size: 0.78rem;
  color: var(--kawaii-muted);
}
.nimbus-empty {
  grid-column: 1 / -1;
  padding: 2.5rem 1rem;
  border-radius: 16px;
  border: 1px dashed var(--kawaii-line-strong);
  text-align: center;
  font-size: 0.9rem;
  color: var(--kawaii-muted);
}

/* ── 收尾 CTA 靛蓝渐变带 ── */
.nimbus-cta-band {
  position: relative;
  overflow: hidden;
  border-radius: 24px;
  padding: clamp(2.5rem, 6vw, 4.5rem) clamp(1.5rem, 5vw, 4rem);
  /* 固定深靛蓝，双主题下白字对比稳定 */
  background: linear-gradient(135deg, #4f46e5 0%, #4338ca 52%, #3730a3 100%);
  color: #fff;
  text-align: center;
}
.nimbus-cta-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.09) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.09) 1px, transparent 1px);
  background-size: 46px 46px;
  -webkit-mask-image: radial-gradient(circle at 50% 38%, #000, transparent 78%);
  mask-image: radial-gradient(circle at 50% 38%, #000, transparent 78%);
}
.nimbus-cta-inner {
  position: relative;
  z-index: 1;
}
.nimbus-cta-title {
  font-size: clamp(1.75rem, 4vw, 2.75rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #fff;
  text-wrap: balance;
}
.nimbus-cta-title span {
  color: #c7c8fb;
}
.nimbus-cta-sub {
  margin: 1rem auto 0;
  max-width: 52ch;
  font-size: clamp(0.95rem, 1.4vw, 1.075rem);
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.82);
}
.nimbus-cta-actions {
  margin-top: 2rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
}
.nimbus-cta-primary {
  background: #fff;
  color: #3730a3;
}
.nimbus-cta-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px -12px rgba(0, 0, 0, 0.4);
}
.nimbus-cta-ghost {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.5);
}
.nimbus-cta-ghost:hover {
  background: rgba(255, 255, 255, 0.2);
}
.nimbus-cta-primary:focus-visible,
.nimbus-cta-ghost:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

/* ── 响应式 ── */
@media (min-width: 640px) {
  .nimbus-feature-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 768px) {
  .nimbus-stat-strip {
    grid-template-columns: repeat(4, 1fr);
  }
}
@media (min-width: 1024px) {
  .nimbus-choice-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .nimbus-feature-grid {
    grid-template-columns: repeat(4, 1fr);
  }
  .nimbus-plan-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .nimbus-plan-head {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
  }
}

/* ── 尊重减少动态偏好 ── */
@media (prefers-reduced-motion: reduce) {
  .nimbus-lift,
  .nimbus-btn,
  .nimbus-choice-action {
    transition: none;
  }
  .nimbus-lift:hover,
  .nimbus-choice-action:hover,
  .nimbus-cta-primary:hover {
    transform: none;
  }
}
</style>
