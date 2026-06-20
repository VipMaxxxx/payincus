<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import { useBrand } from '@/composables/useBrand'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const configStore = useConfigStore()
const themeStore = useThemeStore()
const brand = useBrand()

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

const ui = computed(() => themeStore.isDark
  ? {
      secondaryButton: 'border-[#35507a] bg-[#1d365c] text-[#d3e3fd] hover:bg-[#274577]',
      primaryButton: 'bg-[#a8c7fa] text-[#062e6f] shadow-[0_14px_30px_-16px_rgba(96,146,211,0.48)] hover:bg-[#bed7ff]'
    }
  : {
      secondaryButton: 'border-[#c6d7f8] bg-[#d3e3fd] text-[#041e49] hover:bg-[#e8f0fe]',
      primaryButton: 'bg-[#0b57d0] text-white shadow-[0_14px_30px_-16px_rgba(11,87,208,0.3)] hover:bg-[#0842a0]'
    }
)

const secondaryAction = computed(() => (
  route.name === 'market'
    ? { to: '/', label: t('publicSite.nav.overview') }
    : { to: '/market', label: t('publicSite.actions.browseProducts') }
))

const accountLinks = computed(() => {
  if (authStore.isAuthenticated) {
    return [{ label: t('publicSite.actions.consoleCompact'), to: consoleTarget.value }]
  }

  return [
    { label: t('auth.login'), to: '/login' },
    ...(configStore.registrationEnabled ? [{ label: t('auth.register'), to: '/register' }] : []),
    { label: t('auth.forgotPasswordLink'), to: '/forgot-password' }
  ]
})

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

void configStore.loadPublicConfig()
</script>

<template>
  <footer class="relative border-t" :class="themeStore.isDark ? 'border-white/10' : 'border-black/10'">
    <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div
        class="rounded-[32px] border p-6 shadow-sm sm:p-8"
        :class="themeStore.isDark ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-white/90'"
      >
        <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div class="max-w-2xl">
            <div class="flex items-center gap-3">
              <div
                class="flex h-11 w-11 items-center justify-center rounded-2xl border"
                :class="themeStore.isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-white'"
              >
                <img :src="brand.brandLogoUrl" :alt="brand.brandName" class="h-6 w-6 rounded-xl object-contain" />
              </div>
              <div>
                <div class="text-sm font-semibold" :class="themeStore.isDark ? 'text-white' : 'text-zinc-950'">{{ brand.brandName }}</div>
                <div class="text-xs" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-500'">{{ brand.brandSubtitle }}</div>
              </div>
            </div>

            <p class="mt-4 max-w-2xl text-sm leading-7" :class="themeStore.isDark ? 'text-zinc-400' : 'text-zinc-600'">
              {{ t('publicSite.footer.description') }}
            </p>
          </div>

          <div class="flex flex-col gap-3 sm:flex-row">
            <RouterLink
              class="inline-flex items-center justify-center rounded-full border px-5 py-3 text-sm font-semibold transition-colors"
              :class="ui.secondaryButton"
              :to="secondaryAction.to"
            >
              {{ secondaryAction.label }}
            </RouterLink>
            <button
              class="inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition-colors"
              :class="ui.primaryButton"
              @click="handlePrimaryAction"
            >
              {{ primaryActionLabel }}
            </button>
          </div>
        </div>
      </div>

      <div class="mt-10 grid gap-8 sm:grid-cols-2">
        <div class="space-y-3">
          <div class="text-xs font-semibold uppercase tracking-[0.2em]" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-500'">
            {{ t('publicSite.footer.explore') }}
          </div>
          <div class="flex flex-col gap-2 text-sm">
            <RouterLink class="transition-colors" :class="themeStore.isDark ? 'text-zinc-300 hover:text-white' : 'text-zinc-700 hover:text-zinc-950'" to="/">
              {{ t('publicSite.nav.home') }}
            </RouterLink>
            <RouterLink class="transition-colors" :class="themeStore.isDark ? 'text-zinc-300 hover:text-white' : 'text-zinc-700 hover:text-zinc-950'" to="/market">
              {{ t('publicSite.nav.products') }}
            </RouterLink>
          </div>
        </div>

        <div class="space-y-3">
          <div class="text-xs font-semibold uppercase tracking-[0.2em]" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-500'">
            {{ t('publicSite.footer.account') }}
          </div>
          <div class="flex flex-col gap-2 text-sm">
            <RouterLink
              v-for="link in accountLinks"
              :key="link.to"
              class="transition-colors"
              :class="themeStore.isDark ? 'text-zinc-300 hover:text-white' : 'text-zinc-700 hover:text-zinc-950'"
              :to="link.to"
            >
              {{ link.label }}
            </RouterLink>
          </div>
          <p class="text-xs leading-6" :class="themeStore.isDark ? 'text-zinc-500' : 'text-zinc-500'">
            {{ t('publicSite.footer.purchaseHint') }}
          </p>
        </div>
      </div>
    </div>
  </footer>
</template>
