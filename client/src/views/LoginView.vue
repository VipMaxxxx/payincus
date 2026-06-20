<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import { getSafeRedirectUrl } from '@/utils/validation'
import api from '@/api'
import { useBrand } from '@/composables/useBrand'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const brand = useBrand()

const username = ref<string>('')
const password = ref<string>('')
const totpCode = ref<string>('')
const recoveryCode = ref<string>('')
const useRecoveryCode = ref<boolean>(false)
const loading = ref<boolean>(false)
const error = ref<string>('')

// Turnstile 验证
const turnstileEnabled = ref<boolean>(false)
const turnstileSiteKey = ref<string>('')
const turnstileToken = ref<string>('')
const turnstileRef = ref<InstanceType<typeof TurnstileWidget> | null>(null)
void turnstileRef.value // 模板中通过 ref 使用
const footerContactEmail = ref<string | null>(null)
const registrationEnabled = ref<boolean>(true)

const contactEmailHref = computed(() => {
  const email = footerContactEmail.value?.trim()
  if (!email) return null
  return email.startsWith('mailto:') ? email : `mailto:${email}`
})

// OAuth 提供商
const oauthProviders = ref<string[]>([])

onMounted(async (): Promise<void> => {
  // 加载 Turnstile 配置和 OAuth 提供商
  try {
    const [configResponse, oauthResponse] = await Promise.all([
      api.systemConfig.getPublic(),
      api.oauth.getProviders()
    ])
    
    registrationEnabled.value = configResponse.registrationEnabled ?? true
    turnstileEnabled.value = configResponse.turnstileEnabled || false
    turnstileSiteKey.value = configResponse.turnstileSiteKey || ''
    footerContactEmail.value = configResponse.footerContactEmail || null
    oauthProviders.value = (oauthResponse as { providers?: string[] }).providers || []
  } catch (e) {
    console.error('Failed to load config:', e)
  }
  
  // 检查 OAuth 回调错误
  checkOAuthErrors()
})

function onTurnstileExpire() {
  turnstileToken.value = ''
}

function checkOAuthErrors(): void {
  const urlError = route.query.error as string | undefined
  const provider = route.query.provider as string | undefined
  
  if (urlError) {
    const errorMessages: Record<string, string> = {
      'not_bound': t('auth.oauthNotBound', { provider: (provider || '').toUpperCase() }),
      'user_not_found': t('auth.oauthUserNotFound'),
      'account_banned': t('auth.oauthAccountBanned'),
      'provider_disabled': t('auth.oauthProviderDisabled'),
      'token_error': t('auth.oauthTokenError'),
      'oauth_error': t('auth.oauthError')
    }
    error.value = errorMessages[urlError] || t('auth.loginFailed') + ': ' + urlError
    
    // 清除 URL 参数
    router.replace({ query: {} })
  }
}

async function handleLogin(): Promise<void> {
  if (!username.value || !password.value) {
    error.value = t('auth.enterUsernameOrEmailPassword')
    return
  }

  // 检查 Turnstile 验证
  if (turnstileEnabled.value && !turnstileToken.value) {
    error.value = t('auth.turnstileRequired')
    return
  }

  loading.value = true
  error.value = ''

  try {
    // 始终发送2FA代码（如果有），后端会根据用户是否启用2FA来决定是否验证
    await authStore.login(
      username.value, 
      password.value, 
      !useRecoveryCode.value && totpCode.value ? totpCode.value : undefined,
      useRecoveryCode.value && recoveryCode.value ? recoveryCode.value : undefined,
      turnstileEnabled.value ? turnstileToken.value : undefined
    )
    
    // 根据用户角色决定跳转目标
    // 安全改进：验证 redirect 参数防止开放重定向漏洞
    const defaultRedirect = authStore.isAdmin ? '/admin/users' : '/'
    const safeRedirect = getSafeRedirectUrl(route.query.redirect as string, defaultRedirect)
    router.push(safeRedirect)
  } catch (err: any) {
    error.value = err?.message || String(err)
    // 如果验证码错误，清空验证码让用户重新输入
    if (useRecoveryCode.value) {
      recoveryCode.value = ''
    } else {
      totpCode.value = ''
    }
    // Reset turnstile on any error (token can only be used once)
    if (turnstileRef.value) {
      turnstileRef.value.reset?.()
    }
    turnstileToken.value = ''
  } finally {
    loading.value = false
  }
}

function loginWithOAuth(provider: string): void {
  // 安全改进：验证 redirect 参数防止开放重定向漏洞
  // 默认跳转到根路径，路由守卫会根据用户角色自动跳转
  const defaultRedirect = '/'
  const safeRedirect = getSafeRedirectUrl(route.query.redirect as string, defaultRedirect)
  window.location.href = `/api/oauth/authorize/${provider}?mode=login&redirect=${encodeURIComponent(safeRedirect)}`
}

interface ProviderInfo {
  name: string
  bgClass: string
  textClass: string
  icon: string
}

function getProviderInfo(provider: string): ProviderInfo {
  const info: Record<string, ProviderInfo> = {
    github: {
      name: 'GitHub',
      bgClass: 'bg-[#24292e] hover:bg-[#2f363d]',
      textClass: 'text-white',
      icon: `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"></path></svg>`
    },
    google: {
      name: 'Google',
      bgClass: 'bg-white hover:bg-gray-50 border border-gray-300',
      textClass: 'text-gray-700',
      icon: `<svg class="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"></path><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"></path><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path></svg>`
    }
  }
  return info[provider] || { name: provider, bgClass: 'bg-gray-700 hover:bg-gray-600', textClass: 'text-white', icon: '' }
}
</script>

<template>
  <div 
    class="min-h-screen flex items-center justify-center p-4"
    :class="themeStore.isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'"
  >
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-8">
        <img
          :src="brand.brandLogoUrl"
          :alt="brand.brandName"
          class="w-16 h-16 mx-auto mb-2 rounded-xl"
        />
        <h2 
          class="text-lg font-semibold mb-1"
          :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
        >
          {{ brand.brandName }}
        </h2>
        <p 
          class="text-sm"
          :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-600'"
        >
          {{ $t('auth.loginTo') }}
        </p>
      </div>

      <!-- 登录表单 -->
      <div class="card p-6">
        <form class="space-y-4" @submit.prevent="handleLogin">
          <div>
            <label 
              class="block text-sm mb-1.5"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >{{ $t('auth.usernameOrEmail') }}</label>
            <input
              v-model="username"
              type="text"
              class="input"
              :placeholder="$t('auth.usernameOrEmailPlaceholder')"
              autocomplete="username"
            />
          </div>

          <div>
            <label 
              class="block text-sm mb-1.5"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >{{ $t('auth.password') }}</label>
            <input
              v-model="password"
              type="password"
              class="input"
              :placeholder="$t('auth.passwordPlaceholder')"
              autocomplete="current-password"
            />
          </div>

          <!-- 2FA 验证码输入（始终显示，可选） -->
          <div>
            <!-- TOTP 验证码 -->
            <div v-if="!useRecoveryCode">
              <label 
                class="block text-sm mb-1.5"
                :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
              >
                {{ $t('auth.twoFactorCode') }}
                <span class="ml-2 text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                  ({{ $t('auth.twoFactorOptional') }})
                </span>
              </label>
              <input
                v-model="totpCode"
                type="text"
                maxlength="6"
                class="input"
                :placeholder="$t('auth.twoFactorCodePlaceholder')"
                autocomplete="one-time-code"
              />
              <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ $t('auth.twoFactorOptionalHint') }}
              </p>
            </div>
            <!-- 恢复码 -->
            <div v-else>
              <label 
                class="block text-sm mb-1.5"
                :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
              >{{ $t('auth.recoveryCode') }}</label>
              <input
                v-model="recoveryCode"
                type="text"
                class="input"
                :placeholder="$t('auth.recoveryCodePlaceholder')"
              />
              <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ $t('auth.recoveryCodeHint') }}
              </p>
            </div>
            <!-- 切换按钮 -->
            <button
              type="button"
              class="text-xs mt-2 transition-colors"
              :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'"
              @click="useRecoveryCode = !useRecoveryCode; totpCode = ''; recoveryCode = ''"
            >
              {{ useRecoveryCode ? $t('auth.useTotpCode') : $t('auth.useRecoveryCode') }}
            </button>
          </div>

          <!-- Turnstile 验证 -->
          <TurnstileWidget
            v-if="turnstileEnabled && turnstileSiteKey"
            ref="turnstileRef"
            v-model="turnstileToken"
            :site-key="turnstileSiteKey"
            :theme="themeStore.isDark ? 'dark' : 'light'"
            @expire="onTurnstileExpire"
          />

          <!-- 错误提示 -->
          <div v-if="error" class="text-sm text-red-500">
            {{ error }}
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="btn-primary w-full"
          >
            {{ loading ? $t('auth.loggingIn') : $t('auth.continue') }}
          </button>
        </form>

        <!-- OAuth Quick Login -->
        <div v-if="oauthProviders.length > 0" class="mt-6">
          <div class="relative">
            <div class="absolute inset-0 flex items-center">
              <div 
                class="w-full border-t"
                :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
              ></div>
            </div>
            <div class="relative flex justify-center text-sm">
              <span 
                class="px-2"
                :class="themeStore.isDark ? 'bg-gray-900 text-gray-500' : 'bg-white text-gray-500'"
              >{{ $t('auth.orUse') }}</span>
            </div>
          </div>

          <div class="mt-4 grid gap-3" :class="oauthProviders.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
            <button
              v-for="provider in oauthProviders"
              :key="provider"
              :class="[
                'flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                getProviderInfo(provider).bgClass,
                getProviderInfo(provider).textClass
              ]"
              @click="loginWithOAuth(provider)"
            >
              <span v-html="getProviderInfo(provider).icon"></span>
              {{ getProviderInfo(provider).name }}
            </button>
          </div>
          
          <p 
            class="mt-3 text-xs text-center"
            :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
          >
            {{ $t('auth.oauthBindHint') }}
          </p>
        </div>
      </div>

      <div class="mt-6 space-y-2 text-center text-sm">
        <p v-if="registrationEnabled" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'">
          {{ $t('auth.noAccount') }}
          <RouterLink 
            to="/register" 
            class="transition-colors"
            :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-700 hover:text-gray-900'"
          >
            {{ $t('auth.register') }}
          </RouterLink>
        </p>
        <p v-else :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'">
          {{ $t('auth.registrationClosedShort') }}
        </p>
        <p :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'">
          <RouterLink 
            to="/forgot-password" 
            class="transition-colors"
            :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-700 hover:text-gray-900'"
          >
            {{ $t('auth.forgotPasswordLink') }}
          </RouterLink>
        </p>
      </div>

      <!-- 右下角操作按钮 -->
      <div class="fixed bottom-4 right-4 z-10 flex items-center gap-2">
        <a
          v-if="contactEmailHref"
          :href="contactEmailHref"
          class="p-2 rounded-lg transition-colors"
          :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'"
          :title="$t('auth.contactEmail')"
          :aria-label="$t('auth.contactEmail')"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
        </a>

        <button
          class="p-2 rounded-lg transition-colors"
          :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'"
          :title="themeStore.mode === 'dark' ? $t('theme.dark') : themeStore.mode === 'light' ? $t('theme.light') : $t('theme.system')"
          @click="themeStore.toggleTheme"
        >
          <!-- 深色图标 -->
          <svg v-if="themeStore.mode === 'dark'" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
          <!-- 浅色图标 -->
          <svg v-else-if="themeStore.mode === 'light'" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <!-- 系统图标 -->
          <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
