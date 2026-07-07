<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useBrand } from '@/composables/useBrand'
import { dashboardPath, forgotPasswordPath, helpPath, loginPath, marketPath, registerPath } from '@/utils/app-paths'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const configStore = useConfigStore()
const brand = useBrand()

const isLoginRoute = computed(() => route.name === 'login')
const isRegisterRoute = computed(() => route.name === 'register')
const isForgotPasswordRoute = computed(() => route.name === 'forgot-password')
const consoleTarget = computed(() => dashboardPath())

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

const secondaryAction = computed(() => (
  route.name === 'market'
    ? { to: '/', label: t('publicSite.nav.overview') }
    : { to: marketPath(), label: t('publicSite.actions.browseProducts') }
))

const accountLinks = computed(() => {
  if (authStore.isAuthenticated) {
    return [{ label: t('publicSite.actions.consoleCompact'), to: consoleTarget.value }]
  }

  return [
    { label: t('auth.login'), to: loginPath() },
    ...(configStore.registrationEnabled ? [{ label: t('auth.register'), to: registerPath() }] : []),
    { label: t('auth.forgotPasswordLink'), to: forgotPasswordPath() }
  ]
})

function handlePrimaryAction(): void {
  if (authStore.isAuthenticated) {
    void router.push(consoleTarget.value)
    return
  }

  if (isLoginRoute.value && configStore.registrationEnabled) {
    void router.push(registerPath())
    return
  }

  if (isRegisterRoute.value || isForgotPasswordRoute.value) {
    void router.push(loginPath())
    return
  }

  void router.push(loginPath())
}

void configStore.loadPublicConfig()
</script>

<template>
  <footer class="kawaii-public-footer relative border-t">
    <ThemeTemplateSlot
      slot-name="shared.footer"
      container-class="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8"
    />

    <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div
        class="kawaii-footer-panel rounded-[32px] border p-6 shadow-sm sm:p-8"
      >
        <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div class="max-w-2xl">
            <div class="flex items-center gap-3">
              <div
                class="kawaii-footer-logo flex h-11 w-11 items-center justify-center rounded-2xl border"
              >
                <img :src="brand.brandLogoUrl" :alt="brand.brandName" class="h-6 w-6 rounded-xl object-contain" />
              </div>
              <div>
                <div class="text-sm font-semibold text-themed">{{ brand.brandName }}</div>
                <div class="text-xs text-themed-muted">{{ brand.brandSubtitle }}</div>
              </div>
            </div>

            <p class="mt-4 max-w-2xl text-sm leading-7 text-themed-muted">
              {{ t('publicSite.footer.description') }}
            </p>
          </div>

          <div class="flex flex-col gap-3 sm:flex-row">
            <RouterLink
              class="kawaii-secondary-button inline-flex items-center justify-center rounded-full border px-5 py-3 text-sm font-semibold transition-colors"
              :to="secondaryAction.to"
            >
              {{ secondaryAction.label }}
            </RouterLink>
            <button
              class="kawaii-primary-button inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition-colors"
              @click="handlePrimaryAction"
            >
              {{ primaryActionLabel }}
            </button>
          </div>
        </div>
      </div>

      <div class="mt-10 grid gap-8 sm:grid-cols-2">
        <div class="space-y-3">
          <div class="text-xs font-semibold uppercase tracking-[0.2em] text-themed-faint">
            {{ t('publicSite.footer.explore') }}
          </div>
          <div class="flex flex-col gap-2 text-sm">
            <RouterLink class="kawaii-footer-link transition-colors" to="/">
              {{ t('publicSite.nav.home') }}
            </RouterLink>
            <RouterLink class="kawaii-footer-link transition-colors" :to="marketPath()">
              {{ t('publicSite.nav.products') }}
            </RouterLink>
            <RouterLink class="kawaii-footer-link transition-colors" :to="helpPath()">
              {{ t('publicSite.nav.help') }}
            </RouterLink>
          </div>
        </div>

        <div class="space-y-3">
          <div class="text-xs font-semibold uppercase tracking-[0.2em] text-themed-faint">
            {{ t('publicSite.footer.account') }}
          </div>
          <div class="flex flex-col gap-2 text-sm">
            <RouterLink
              v-for="link in accountLinks"
              :key="link.to"
              class="kawaii-footer-link transition-colors"
              :to="link.to"
            >
              {{ link.label }}
            </RouterLink>
          </div>
          <p class="text-xs leading-6 text-themed-muted">
            {{ t('publicSite.footer.purchaseHint') }}
          </p>
        </div>
      </div>
    </div>
  </footer>
</template>
