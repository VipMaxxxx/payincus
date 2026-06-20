<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import { formatDisk, formatMemory } from '@/utils/formatters'

const FOREVER_KEY = 'incudal.popupAnnouncement.dismissedForever'
const TODAY_KEY = 'incudal.popupAnnouncement.dismissedToday'

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const configStore = useConfigStore()
const themeStore = useThemeStore()
const visible = ref(false)
const promoImageFailed = ref(false)
const promoLightboxOpen = ref(false)

const announcementText = computed(() => configStore.popupAnnouncement?.trim() || '')
const promoImageUrl = computed(() => configStore.popupPromoImageUrl?.trim() || '')
const promoPackage = computed(() => configStore.popupPromoPackage)
const hasPromo = computed(() => Boolean(promoImageUrl.value && promoPackage.value))
const promoPlans = computed(() => promoPackage.value?.plans || [])
const promoAvailablePlans = computed(() => promoPlans.value.filter(plan => !plan.isSoldOut))
const promoDisplayPlans = computed(() => {
  const plans = promoAvailablePlans.value.length > 0 ? promoAvailablePlans.value : promoPlans.value
  return plans.slice(0, 3)
})
const announcementId = computed(() => {
  if (hasPromo.value && promoPackage.value) {
    const payload = `${promoImageUrl.value}:${promoPackage.value.id}:${promoPackage.value.name}`
    return `promo:${configStore.popupPromoUpdatedAt || createFallbackHash(payload)}`
  }
  if (!announcementText.value) return ''
  return `text:${configStore.popupAnnouncementUpdatedAt || createFallbackHash(announcementText.value)}`
})
const legacyTextAnnouncementId = computed(() => {
  if (hasPromo.value || !announcementText.value) return ''
  return configStore.popupAnnouncementUpdatedAt || createFallbackHash(announcementText.value)
})

function createFallbackHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return `${value.length}-${Math.abs(hash).toString(36)}`
}

function todayString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage failures. The modal can still be dismissed for this session.
  }
}

function formatPromoPrice(cents: number): string {
  return (cents / 100).toFixed(2)
}

function formatPromoTraffic(bytes: string): string {
  if (!bytes || bytes === '0') return t('common.unlimited')
  const value = BigInt(bytes)
  const tb = BigInt(1024 * 1024 * 1024 * 1024)
  const gb = BigInt(1024 * 1024 * 1024)
  if (value >= tb) {
    return `${(Number(value) / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`
  }
  if (value >= gb) {
    return `${(Number(value) / (1024 * 1024 * 1024)).toFixed(0)} GB`
  }
  return `${(Number(value) / (1024 * 1024)).toFixed(0)} MB`
}

function getPromoBillingCycleLabel(months: number): string {
  if (months === 1) return t('billing.cycle.monthly')
  if (months === 3) return t('billing.cycle.quarterly')
  if (months === 6) return t('billing.cycle.semiAnnual')
  if (months === 12) return t('billing.cycle.annual')
  return `${months} ${t('billing.cycle.months')}`
}

function shouldShowAnnouncement(): boolean {
  const currentId = announcementId.value
  if (
    !authStore.isAuthenticated ||
    !authStore.user ||
    !configStore.loaded ||
    (!hasPromo.value && !announcementText.value) ||
    !currentId
  ) {
    return false
  }

  if (readStorage(FOREVER_KEY) === currentId) {
    return false
  }

  if (readStorage(TODAY_KEY) === `${currentId}:${todayString()}`) {
    return false
  }

  const legacyId = legacyTextAnnouncementId.value
  if (legacyId && (readStorage(FOREVER_KEY) === legacyId || readStorage(TODAY_KEY) === `${legacyId}:${todayString()}`)) {
    return false
  }

  return true
}

function refreshVisibility(): void {
  visible.value = shouldShowAnnouncement()
}

function dismissToday(): void {
  if (announcementId.value) {
    writeStorage(TODAY_KEY, `${announcementId.value}:${todayString()}`)
  }
  visible.value = false
  promoLightboxOpen.value = false
}

function dismissForever(): void {
  if (announcementId.value) {
    writeStorage(FOREVER_KEY, announcementId.value)
  }
  visible.value = false
  promoLightboxOpen.value = false
}

async function buyPromoPackage(): Promise<void> {
  if (!authStore.isAuthenticated || !authStore.user || !promoPackage.value) {
    visible.value = false
    return
  }
  dismissToday()
  await router.push({
    name: 'instance-create',
    query: {
      source: promoPackage.value.source,
      package: String(promoPackage.value.id)
    }
  })
}

onMounted(() => {
  void configStore.loadPublicConfig()
})

watch(
  [
    announcementText,
    promoImageUrl,
    promoPackage,
    announcementId,
    () => configStore.loaded,
    () => authStore.isAuthenticated,
    () => authStore.user?.id
  ],
  refreshVisibility,
  { immediate: true }
)

watch(promoImageUrl, () => {
  promoImageFailed.value = false
  promoLightboxOpen.value = false
})

watch(visible, (isVisible) => {
  if (!isVisible) {
    promoLightboxOpen.value = false
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="visible"
        class="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto px-4 py-4 sm:py-6"
        role="dialog"
        aria-modal="true"
        :aria-label="t('popupAnnouncement.title')"
      >
        <div class="absolute inset-0 bg-black/45 backdrop-blur-sm"></div>

        <div
          class="relative w-full max-w-[min(92vw,720px)] overflow-hidden rounded-lg border shadow-2xl md:w-auto md:max-w-[min(92vw,980px)]"
          :class="themeStore.isDark
            ? 'border-gray-800 bg-gray-950 text-gray-100'
            : 'border-gray-200 bg-white text-gray-900'"
        >
          <template v-if="hasPromo && promoPackage">
            <button
              type="button"
              class="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition"
              :class="themeStore.isDark
                ? 'border-white/10 bg-gray-950/80 text-gray-200 hover:bg-gray-900'
                : 'border-black/10 bg-white/90 text-gray-700 hover:bg-white'"
              :aria-label="t('common.close')"
              @click="dismissToday"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div class="flex flex-col md:flex-row md:items-stretch">
              <div
                class="relative flex max-h-[62vh] min-h-[120px] items-center justify-center overflow-hidden bg-gray-900 md:max-h-[78vh] md:min-h-0 md:shrink-0 md:bg-transparent"
              >
                <button
                  v-if="!promoImageFailed"
                  type="button"
                  class="flex max-h-[62vh] w-full cursor-zoom-in items-center justify-center md:max-h-[78vh] md:w-auto"
                  :aria-label="t('popupAnnouncement.viewImage')"
                  :title="t('popupAnnouncement.viewImage')"
                  @click="promoLightboxOpen = true"
                >
                  <img
                    :src="promoImageUrl"
                    :alt="promoPackage.name"
                    class="block max-h-[62vh] max-w-full object-contain md:max-h-[78vh] md:max-w-[min(58vw,560px)]"
                    @error="promoImageFailed = true"
                  />
                </button>
                <div
                  v-else
                  class="flex min-h-[220px] w-full items-center justify-center px-8 text-center md:min-h-[420px] md:w-[360px]"
                  :class="themeStore.isDark ? 'bg-gray-900 text-gray-200' : 'bg-gray-100 text-gray-700'"
                >
                  <div>
                    <p class="text-sm font-medium">{{ t('popupAnnouncement.promoLabel') }}</p>
                    <p class="mt-2 text-xl font-semibold">{{ promoPackage.name }}</p>
                  </div>
                </div>
              </div>

              <div
                class="flex min-w-0 flex-col justify-between px-5 pb-5 pt-4 sm:px-6 sm:pb-6 md:w-[360px] md:border-l md:pt-12"
                :class="themeStore.isDark ? 'md:border-gray-800' : 'md:border-gray-200'"
              >
                <div class="min-h-0 min-w-0 md:max-h-[56vh] md:overflow-y-auto md:pr-1">
                  <div class="min-w-0">
                    <p class="text-xs font-medium uppercase tracking-wide" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                      {{ t('popupAnnouncement.promoLabel') }}
                    </p>
                    <h2 class="mt-1 break-words text-lg font-semibold leading-6 sm:text-xl">{{ promoPackage.name }}</h2>
                    <p
                      v-if="promoPackage.description"
                      class="mt-3 hidden whitespace-pre-line break-words text-sm leading-6 md:block"
                      :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'"
                    >
                      {{ promoPackage.description }}
                    </p>
                  </div>

                  <div v-if="promoDisplayPlans.length > 0" class="mt-5 hidden space-y-2 md:block">
                    <div class="flex items-center justify-between gap-3">
                      <p class="text-xs font-medium uppercase tracking-wide" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                        {{ t('popupAnnouncement.promoPlans') }}
                      </p>
                    </div>

                    <div
                      v-for="plan in promoDisplayPlans"
                      :key="plan.id"
                      class="rounded-lg border p-3"
                      :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/70' : 'border-gray-200 bg-gray-50'"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="truncate text-sm font-medium">{{ plan.name }}</div>
                          <div class="mt-1 text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                            {{ plan.cpu }}% CPU · {{ formatMemory(plan.memory) }} · {{ formatDisk(plan.disk) }}
                          </div>
                        </div>
                        <div class="shrink-0 text-right">
                          <div class="text-sm font-semibold" :class="themeStore.isDark ? 'text-emerald-300' : 'text-emerald-700'">
                            ¥{{ formatPromoPrice(plan.price) }}
                          </div>
                          <div class="text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                            {{ getPromoBillingCycleLabel(plan.billingCycle) }}
                          </div>
                        </div>
                      </div>
                      <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        <span class="rounded-full px-2 py-0.5" :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-600'">
                          {{ formatPromoTraffic(plan.trafficLimit) }}
                        </span>
                        <span v-if="plan.isSoldOut" class="rounded-full px-2 py-0.5" :class="themeStore.isDark ? 'bg-red-500/15 text-red-300' : 'bg-red-50 text-red-600'">
                          {{ t('popupAnnouncement.soldOut') }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto] md:grid-cols-1">
                  <button type="button" class="btn-primary min-w-0 w-full justify-center whitespace-normal break-words text-center leading-5 sm:col-span-1 md:col-span-auto" @click="buyPromoPackage">
                    {{ t('popupAnnouncement.buyNow', { name: promoPackage.name }) }}
                  </button>
                  <button type="button" class="btn-secondary w-full sm:w-auto md:w-full" @click="dismissToday">
                    {{ t('popupAnnouncement.dismissToday') }}
                  </button>
                  <button type="button" class="btn-secondary w-full sm:w-auto md:w-full" @click="dismissForever">
                    {{ t('popupAnnouncement.dismissForever') }}
                  </button>
                </div>
              </div>
            </div>
          </template>

          <template v-else>
            <div
              class="flex items-center gap-3 border-b px-5 py-4"
              :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
            >
              <div
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                :class="themeStore.isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-600'"
              >
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 01-6 0" />
                </svg>
              </div>
              <div class="min-w-0">
                <h2 class="text-base font-semibold">{{ t('popupAnnouncement.title') }}</h2>
                <p class="mt-0.5 text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                  {{ t('popupAnnouncement.subtitle') }}
                </p>
              </div>
            </div>

            <div class="max-h-[55vh] overflow-y-auto px-5 py-5">
              <div
                class="whitespace-pre-wrap break-words text-sm leading-6"
                :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'"
              >
                {{ announcementText }}
              </div>
            </div>

            <div
              class="flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end"
              :class="themeStore.isDark ? 'border-gray-800 bg-gray-950' : 'border-gray-200 bg-gray-50'"
            >
              <button type="button" class="btn-secondary w-full sm:w-auto" @click="dismissForever">
                {{ t('popupAnnouncement.dismissForever') }}
              </button>
              <button type="button" class="btn-primary w-full sm:w-auto" @click="dismissToday">
                {{ t('popupAnnouncement.dismissToday') }}
              </button>
            </div>
          </template>
        </div>

        <div
          v-if="promoLightboxOpen && hasPromo && promoPackage && !promoImageFailed"
          class="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          :aria-label="t('popupAnnouncement.viewImage')"
          @click.self="promoLightboxOpen = false"
        >
          <button
            type="button"
            class="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            :aria-label="t('common.close')"
            @click="promoLightboxOpen = false"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            :src="promoImageUrl"
            :alt="promoPackage.name"
            class="max-h-[88vh] max-w-[94vw] object-contain shadow-2xl"
            @click.stop
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
