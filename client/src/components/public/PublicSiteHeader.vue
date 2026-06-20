<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import { useBrand } from '@/composables/useBrand'
import { supportedLocales, setLocale, type Locale } from '@/locales'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()
const authStore = useAuthStore()
const configStore = useConfigStore()
const themeStore = useThemeStore()
const brand = useBrand()

const langMenuOpen = ref(false)
const langMenuRef = ref<HTMLElement | null>(null)

const navigation = computed(() => [
  { label: t('publicSite.nav.home'), compactLabel: t('publicSite.nav.overview'), to: '/' },
  { label: t('publicSite.nav.products'), compactLabel: t('publicSite.nav.products'), to: '/market' }
])

const isLoginRoute = computed(() => route.name === 'login')
const isRegisterRoute = computed(() => route.name === 'register')
const isForgotPasswordRoute = computed(() => route.name === 'forgot-password')
const consoleTarget = computed(() => (authStore.isAdmin ? '/admin/users' : '/dashboard'))

const primaryActionLabel = computed(() => {
  if (authStore.isAuthenticated) {
    return t('publicSite.actions.console')
  }

  if (isLoginRoute.value && configStore.registrationEnabled) {
    return t('auth.register')
  }

  if (isRegisterRoute.value || isForgotPasswordRoute.value) {
    return t('auth.login')
  }

  return t('publicSite.actions.signIn')
})

const primaryActionCompactLabel = computed(() => {
  if (authStore.isAuthenticated) {
    return t('publicSite.actions.consoleCompact')
  }

  if (isLoginRoute.value && configStore.registrationEnabled) {
    return t('auth.register')
  }

  if (isRegisterRoute.value || isForgotPasswordRoute.value) {
    return t('auth.login')
  }

  return t('publicSite.actions.signIn')
})

const scrolled = ref(false)

function onScroll(): void {
  scrolled.value = window.scrollY > 4
}

const ui = computed(() => themeStore.isDark
  ? {
      shell: scrolled.value
        ? 'bg-[#111418]/85 backdrop-blur-xl border-b border-[#2a2d33]'
        : 'bg-transparent border-b border-transparent',
      brandMark: 'bg-[#1a2c52]',
      brandText: 'text-[#e3e2e6]',
      brandSubtext: 'text-[#8e9199]',
      navRail: '',
      navActive: 'bg-[#1a2c52] text-[#d3e3fd]',
      navIdle: 'text-[#c3c6cf] hover:bg-[#272a2f] hover:text-[#e3e2e6]',
      iconButton: 'text-[#c3c6cf] hover:bg-[#272a2f]',
      menuPanel: 'border-[#43474e] bg-[#1d2024] shadow-[0_4px_8px_3px_rgba(0,0,0,0.15),0_1px_3px_rgba(0,0,0,0.3)]',
      menuActive: 'bg-[#1a2c52] text-[#d3e3fd]',
      menuIdle: 'text-[#c3c6cf] hover:bg-[#272a2f] hover:text-[#e3e2e6]',
      cta: 'bg-[#a8c7fa] text-[#062e6f] shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)] hover:bg-[#bdd3fb]',
      mobileActive: 'bg-[#1a2c52] text-[#d3e3fd]',
      mobileIdle: 'text-[#c3c6cf] hover:bg-[#272a2f] hover:text-[#e3e2e6]'
    }
  : {
      shell: scrolled.value
        ? 'bg-[#fcfcfd]/85 backdrop-blur-xl border-b border-[#e3e5ec]'
        : 'bg-transparent border-b border-transparent',
      brandMark: 'bg-[#d3e3fd]',
      brandText: 'text-[#1a1b20]',
      brandSubtext: 'text-[#74777f]',
      navRail: '',
      navActive: 'bg-[#d3e3fd] text-[#041e49]',
      navIdle: 'text-[#43474e] hover:bg-[#eef0f8] hover:text-[#1a1b20]',
      iconButton: 'text-[#43474e] hover:bg-[#eef0f8]',
      menuPanel: 'border-[#c3c6cf] bg-white shadow-[0_4px_8px_3px_rgba(15,23,42,0.08),0_1px_3px_rgba(15,23,42,0.06)]',
      menuActive: 'bg-[#d3e3fd] text-[#041e49]',
      menuIdle: 'text-[#43474e] hover:bg-[#eef0f8] hover:text-[#1a1b20]',
      cta: 'bg-[#0b57d0] text-white shadow-[0_1px_2px_rgba(11,87,208,0.3),0_1px_3px_1px_rgba(11,87,208,0.15)] hover:bg-[#0848ad]',
      mobileActive: 'bg-[#d3e3fd] text-[#041e49]',
      mobileIdle: 'text-[#43474e] hover:bg-[#eef0f8] hover:text-[#1a1b20]'
    }
)

function handleClickOutside(event: MouseEvent): void {
  if (langMenuRef.value && !langMenuRef.value.contains(event.target as Node)) {
    langMenuOpen.value = false
  }
}

function isActive(path: string): boolean {
  if (path === '/') {
    return route.path === '/'
  }

  return route.path.startsWith(path)
}

function toggleLangMenu(): void {
  langMenuOpen.value = !langMenuOpen.value
}

function changeLocale(nextLocale: Locale): void {
  setLocale(nextLocale)
  langMenuOpen.value = false
}

function getThemeTooltip(): string {
  switch (themeStore.mode) {
    case 'dark':
      return t('theme.dark')
    case 'light':
      return t('theme.light')
    default:
      return t('theme.system')
  }
}

function currentLocaleShort(): string {
  switch (locale.value) {
    case 'zh-CN':
      return '简'
    case 'zh-TW':
      return '繁'
    default:
      return 'EN'
  }
}

function handlePrimaryAction(): void {
  if (authStore.isAuthenticated) {
    void router.push(consoleTarget.value)
    return
  }

  if (isLoginRoute.value && configStore.registrationEnabled) {
    void router.push('/register')
    return
  }

  if (isRegisterRoute.value || isForgotPasswordRoute.value) {
    void router.push('/login')
    return
  }

  void router.push('/login')
}

onMounted(() => {
  void configStore.loadPublicConfig()
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <header
    class="sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-200"
    :class="ui.shell"
  >
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="flex h-16 items-center justify-between gap-3 sm:gap-4">
        <div class="flex min-w-0 items-center gap-3 sm:gap-6">
          <RouterLink to="/" class="flex items-center gap-2 sm:gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl"
              :class="ui.brandMark"
            >
              <img :src="brand.brandLogoUrl" :alt="brand.brandName" class="h-6 w-6 rounded-xl object-contain" />
            </div>
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold tracking-[-0.02em]" :class="ui.brandText">
                {{ brand.brandName }}
              </div>
              <div class="hidden truncate text-xs sm:block" :class="ui.brandSubtext">
                {{ brand.brandSubtitle }}
              </div>
            </div>
          </RouterLink>

          <nav class="hidden items-center gap-1 md:flex">
            <RouterLink
              v-for="item in navigation"
              :key="item.to"
              :to="item.to"
              class="rounded-full px-4 py-2 text-sm font-medium tracking-[-0.01em] transition-colors duration-150"
              :class="isActive(item.to)
                ? ui.navActive
                : ui.navIdle"
            >
              {{ item.label }}
            </RouterLink>
          </nav>
        </div>

        <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            class="group relative rounded-full p-2.5 transition-colors duration-150"
            :class="ui.iconButton"
            :title="getThemeTooltip()"
            :aria-label="t('nav.toggleTheme')"
            @click="themeStore.toggleTheme"
          >
            <svg v-if="themeStore.mode === 'dark'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <svg v-else-if="themeStore.mode === 'light'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>

          <div ref="langMenuRef" class="relative">
            <button
              class="rounded-full px-3 py-2 text-xs font-semibold transition-colors duration-150 sm:px-3.5"
              :class="ui.iconButton"
              :aria-label="t('nav.toggleLanguage')"
              @click.stop="toggleLangMenu"
            >
              {{ currentLocaleShort() }}
            </button>

            <Transition
              enter-active-class="transition ease-out duration-100"
              enter-from-class="transform opacity-0 scale-95"
              enter-to-class="transform opacity-100 scale-100"
              leave-active-class="transition ease-in duration-75"
              leave-from-class="transform opacity-100 scale-100"
              leave-to-class="transform opacity-0 scale-95"
            >
              <div
                v-if="langMenuOpen"
                class="absolute right-0 mt-2 w-36 overflow-hidden rounded-[24px] border p-1 shadow-xl"
                :class="ui.menuPanel"
              >
                <button
                  v-for="lang in supportedLocales"
                  :key="lang.code"
                  class="flex w-full items-center justify-between rounded-[18px] px-3 py-2 text-sm transition-[background-color,color]"
                  :class="locale === lang.code
                    ? ui.menuActive
                    : ui.menuIdle"
                  @click="changeLocale(lang.code)"
                >
                  <span>{{ lang.name }}</span>
                  <svg v-if="locale === lang.code" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </Transition>
          </div>

          <button
            class="inline-flex h-10 min-w-0 shrink-0 items-center gap-1.5 rounded-full px-5 text-sm font-medium tracking-[0.01em] transition-[background-color,box-shadow] duration-150 sm:gap-2"
            :class="ui.cta"
            @click="handlePrimaryAction"
          >
            <span class="sm:hidden">{{ primaryActionCompactLabel }}</span>
            <span class="hidden sm:inline">{{ primaryActionLabel }}</span>
            <svg class="hidden h-4 w-4 sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.5 4.5l6 6m0 0l-6 6m6-6h-15" />
            </svg>
          </button>
        </div>
      </div>

      <nav class="flex items-center gap-2 overflow-x-auto pb-3 md:hidden">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="inline-flex min-w-0 items-center rounded-full px-3.5 py-2 text-xs font-semibold transition-colors duration-150"
          :class="isActive(item.to)
            ? ui.mobileActive
            : ui.mobileIdle"
        >
          {{ item.compactLabel }}
        </RouterLink>
      </nav>
    </div>
  </header>
</template>
