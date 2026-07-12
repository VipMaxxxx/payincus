<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import { getSafeRedirectUrl } from '@/utils/validation'
import { focusTurnstileSection, readTurnstileToken } from '@/utils/turnstile'
import api from '@/api'
import { useBrand } from '@/composables/useBrand'
import { buildApiUrl } from '@/utils/api-url'
import { forgotPasswordPath, registerPath } from '@/utils/app-paths'
import { getDemoLoginAccount } from '@/utils/demo-login'
import { useReveal } from '@/composables/useReveal'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const brand = useBrand()

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)

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
const turnstileSectionRef = ref<HTMLElement | null>(null)
void turnstileRef.value // 模板中通过 ref 使用
const footerContactEmail = ref<string | null>(null)
const registrationEnabled = ref<boolean>(true)
const isTurnstileChallengeAvailable = computed<boolean>(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))

const contactEmailHref = computed(() => {
  const email = footerContactEmail.value?.trim()
  if (!email) return null
  return email.startsWith('mailto:') ? email : `mailto:${email}`
})
const demoAccount = computed(() => getDemoLoginAccount('user'))

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

  if (route.query.adminOnly === '1') {
    error.value = '管理员账号请使用独立管理后台登录'
  }
  
  // 检查 OAuth 回调错误
  checkOAuthErrors()
})

function onTurnstileExpire() {
  turnstileToken.value = ''
}

function getLoginTurnstileToken(): string | null | undefined {
  if (!isTurnstileChallengeAvailable.value) return undefined

  const token = readTurnstileToken(turnstileRef.value, turnstileToken.value)
  if (token) {
    turnstileToken.value = token
    return token
  }

  focusTurnstileSection(turnstileSectionRef.value)
  error.value = t('auth.turnstileRequired')
  return null
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
  const verificationToken = getLoginTurnstileToken()
  if (verificationToken === null) return

  loading.value = true
  error.value = ''

  try {
    // 始终发送2FA代码（如果有），后端会根据用户是否启用2FA来决定是否验证
    await authStore.login(
      username.value,
      password.value,
      !useRecoveryCode.value && totpCode.value ? totpCode.value : undefined,
      useRecoveryCode.value && recoveryCode.value ? recoveryCode.value : undefined,
      verificationToken || undefined
    )
    
    if (authStore.isAdmin) {
      await authStore.logout()
      error.value = '管理员账号请使用独立管理后台登录'
      return
    }

    // 安全改进：验证 redirect 参数防止开放重定向漏洞
    const safeRedirect = getSafeRedirectUrl(route.query.redirect as string, '/dashboard')
    await router.replace(safeRedirect)
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

async function loginWithDemoAccount(): Promise<void> {
  const account = demoAccount.value
  if (!account) return
  username.value = account.username
  password.value = account.password
  totpCode.value = ''
  recoveryCode.value = ''
  useRecoveryCode.value = false
  await handleLogin()
}

function loginWithOAuth(provider: string): void {
  // 安全改进：验证 redirect 参数防止开放重定向漏洞
  const safeRedirect = getSafeRedirectUrl(route.query.redirect as string, '/dashboard')
  window.location.href = buildApiUrl(`/oauth/authorize/${provider}?mode=login&redirect=${encodeURIComponent(safeRedirect)}`)
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
  <div ref="revealRoot" class="nimbus-auth kawaii-public-shell kawaii-auth-shell kawaii-user-auth min-h-screen flex items-center justify-center p-4 sm:p-6">
    <div class="nimbus-aurora" aria-hidden="true"></div>
    <div class="relative z-10 w-full max-w-md">
      <ThemeTemplateSlot
        slot-name="public.auth.aside"
        container-class="mb-6"
      />

      <!-- Logo lockup -->
      <div class="nimbus-lockup" data-reveal>
        <div class="nimbus-logo-tile">
          <img :src="brand.brandLogoUrl" :alt="brand.brandName" />
        </div>
        <h1 class="nimbus-title">{{ brand.brandName }}</h1>
        <p class="nimbus-subtitle">{{ $t('auth.loginTo') }}</p>
      </div>

      <!-- 登录表单 -->
      <div class="card nimbus-card" data-reveal>
        <form class="space-y-4" @submit.prevent="handleLogin">
          <div class="nimbus-field">
            <label class="nimbus-label">{{ $t('auth.usernameOrEmail') }}</label>
            <input
              v-model="username"
              type="text"
              class="input"
              :placeholder="$t('auth.usernameOrEmailPlaceholder')"
              autocomplete="username"
            />
          </div>

          <div class="nimbus-field">
            <label class="nimbus-label">{{ $t('auth.password') }}</label>
            <input
              v-model="password"
              type="password"
              class="input"
              :placeholder="$t('auth.passwordPlaceholder')"
              autocomplete="current-password"
            />
          </div>

          <!-- 2FA 验证码输入（始终显示，可选） -->
          <div class="nimbus-field">
            <!-- TOTP 验证码 -->
            <div v-if="!useRecoveryCode">
              <label class="nimbus-label flex items-center gap-2">
                <span>{{ $t('auth.twoFactorCode') }}</span>
                <span class="nimbus-chip">{{ $t('auth.twoFactorOptional') }}</span>
              </label>
              <input
                v-model="totpCode"
                type="text"
                maxlength="6"
                class="input font-mono tracking-[0.3em]"
                :placeholder="$t('auth.twoFactorCodePlaceholder')"
                autocomplete="one-time-code"
              />
              <p class="nimbus-hint">
                {{ $t('auth.twoFactorOptionalHint') }}
              </p>
            </div>
            <!-- 恢复码 -->
            <div v-else>
              <label class="nimbus-label">{{ $t('auth.recoveryCode') }}</label>
              <input
                v-model="recoveryCode"
                type="text"
                class="input font-mono"
                :placeholder="$t('auth.recoveryCodePlaceholder')"
              />
              <p class="nimbus-hint">
                {{ $t('auth.recoveryCodeHint') }}
              </p>
            </div>
            <!-- 切换按钮 -->
            <button
              type="button"
              class="nimbus-textlink mt-2.5"
              @click="useRecoveryCode = !useRecoveryCode; totpCode = ''; recoveryCode = ''"
            >
              {{ useRecoveryCode ? $t('auth.useTotpCode') : $t('auth.useRecoveryCode') }}
            </button>
          </div>

          <!-- Turnstile 验证 -->
          <div
            v-if="isTurnstileChallengeAvailable"
            ref="turnstileSectionRef"
            tabindex="-1"
            class="nimbus-turnstile"
          >
            <TurnstileWidget
              ref="turnstileRef"
              v-model="turnstileToken"
              :site-key="turnstileSiteKey"
              :theme="themeStore.isDark ? 'dark' : 'light'"
              @expire="onTurnstileExpire"
            />
          </div>

          <!-- 错误提示 -->
          <div v-if="error" class="nimbus-alert" role="alert">
            <svg class="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v3.75m0 3.75h.008M10.34 3.94l-8.52 14.06A1.875 1.875 0 003.424 20.9h17.152a1.875 1.875 0 001.604-2.9L13.66 3.94a1.875 1.875 0 00-3.32 0z" />
            </svg>
            <span>{{ error }}</span>
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="btn-primary w-full nimbus-submit"
          >
            {{ loading ? $t('auth.loggingIn') : $t('auth.continue') }}
          </button>

          <div v-if="demoAccount" class="nimbus-demo">
            <div class="nimbus-demo-head">
              <span class="nimbus-demo-title">{{ demoAccount.label }}</span>
              <button
                type="button"
                :disabled="loading"
                class="nimbus-demo-btn"
                @click="loginWithDemoAccount"
              >
                一键登录
              </button>
            </div>
            <div class="nimbus-demo-grid">
              <span class="nimbus-demo-key">账号</span>
              <span>{{ demoAccount.username }}</span>
              <span class="nimbus-demo-key">邮箱</span>
              <span>{{ demoAccount.email }}</span>
              <span class="nimbus-demo-key">密码</span>
              <span>{{ demoAccount.password }}</span>
            </div>
          </div>
        </form>

        <!-- OAuth Quick Login -->
        <div v-if="oauthProviders.length > 0" class="mt-6">
          <div class="nimbus-divider">
            <span>{{ $t('auth.orUse') }}</span>
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

          <p class="mt-3 text-xs text-center text-themed-muted">
            {{ $t('auth.oauthBindHint') }}
          </p>
        </div>
      </div>

      <div class="mt-6 space-y-2 text-center text-sm">
        <p v-if="registrationEnabled" class="text-themed-muted">
          {{ $t('auth.noAccount') }}
          <RouterLink :to="registerPath()" class="nimbus-textlink nimbus-textlink--accent">
            {{ $t('auth.register') }}
          </RouterLink>
        </p>
        <p v-else class="text-themed-muted">
          {{ $t('auth.registrationClosedShort') }}
        </p>
        <p class="text-themed-muted">
          <RouterLink :to="forgotPasswordPath()" class="nimbus-textlink">
            {{ $t('auth.forgotPasswordLink') }}
          </RouterLink>
        </p>
      </div>

      <!-- 右下角操作按钮 -->
      <div class="fixed bottom-4 right-4 z-10 flex items-center gap-2">
        <a
          v-if="contactEmailHref"
          :href="contactEmailHref"
          class="kawaii-header-icon p-2 rounded-lg transition-colors"
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
          class="kawaii-header-icon p-2 rounded-lg transition-colors"
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

<style scoped>
/* ============ Nimbus 认证画布 ============ */
.nimbus-auth {
  position: relative;
  overflow: hidden;
}

.nimbus-aurora {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.nimbus-aurora::before {
  content: '';
  position: absolute;
  top: -22%;
  left: 50%;
  width: min(760px, 128vw);
  height: min(760px, 128vw);
  transform: translateX(-50%);
  background: radial-gradient(circle, color-mix(in srgb, var(--kawaii-primary) 24%, transparent), transparent 62%);
  opacity: 0.55;
}

.nimbus-aurora::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(color-mix(in srgb, var(--kawaii-text) 9%, transparent) 1px, transparent 1px);
  background-size: 26px 26px;
  -webkit-mask-image: radial-gradient(ellipse 78% 52% at 50% 0%, #000 0%, transparent 70%);
  mask-image: radial-gradient(ellipse 78% 52% at 50% 0%, #000 0%, transparent 70%);
  opacity: 0.5;
}

/* ============ Logo lockup ============ */
.nimbus-lockup {
  text-align: center;
  margin-bottom: 1.75rem;
}

.nimbus-logo-tile {
  width: 58px;
  height: 58px;
  margin: 0 auto 0.9rem;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: var(--kawaii-surface);
  border: 1px solid var(--kawaii-line);
  box-shadow: 0 1px 2px rgb(16 24 40 / 0.06), 0 10px 26px rgb(79 70 229 / 0.12);
}

.nimbus-logo-tile img {
  width: 34px;
  height: 34px;
  border-radius: 10px;
}

.nimbus-title {
  font-size: 1.4rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--kawaii-text);
  line-height: 1.2;
}

.nimbus-subtitle {
  margin-top: 0.35rem;
  font-size: 0.875rem;
  color: var(--kawaii-muted);
}

/* ============ Card ============ */
.nimbus-card {
  border-radius: 16px;
  padding: 1.75rem;
}

@media (min-width: 640px) {
  .nimbus-card {
    padding: 2rem;
  }
}

/* ============ Fields ============ */
.nimbus-label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--kawaii-muted);
}

.nimbus-hint {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: var(--kawaii-faint);
}

.nimbus-chip {
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 0.05rem 0.45rem;
  border-radius: 9999px;
  color: var(--kawaii-muted);
  background: var(--kawaii-surface-soft);
  border: 1px solid var(--kawaii-line);
}

.nimbus-textlink {
  font-size: 0.8125rem;
  color: var(--kawaii-muted);
  transition: color 0.15s ease;
}

.nimbus-textlink:hover {
  color: var(--kawaii-text);
}

.nimbus-textlink--accent {
  color: var(--kawaii-primary);
  font-weight: 500;
}

.nimbus-textlink--accent:hover {
  color: var(--kawaii-primary-strong);
}

/* ============ Turnstile shell ============ */
.nimbus-turnstile {
  border-radius: 12px;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface-soft);
  padding: 0.75rem;
}

.nimbus-turnstile:focus-visible {
  outline: 2px solid var(--kawaii-primary);
  outline-offset: 2px;
}

/* ============ Alert ============ */
.nimbus-alert {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--error);
  background: color-mix(in srgb, var(--error) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--error) 26%, transparent);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
}

.nimbus-submit {
  margin-top: 0.25rem;
}

/* ============ Demo panel ============ */
.nimbus-demo {
  border-radius: 12px;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface-soft);
  padding: 0.85rem;
}

.nimbus-demo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
}

.nimbus-demo-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--kawaii-text);
}

.nimbus-demo-btn {
  padding: 0.35rem 0.75rem;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #fff;
  background: var(--kawaii-primary);
  transition: background-color 0.15s ease, transform 0.1s ease;
}

.nimbus-demo-btn:hover:not(:disabled) {
  background: var(--kawaii-primary-strong);
}

.nimbus-demo-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.nimbus-demo-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.nimbus-demo-grid {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 0.28rem 0.6rem;
  font-family: var(--font-mono, 'JetBrains Mono Variable', monospace);
  font-size: 0.75rem;
  color: var(--kawaii-text);
  word-break: break-all;
}

.nimbus-demo-key {
  color: var(--kawaii-faint);
}

/* ============ OAuth divider ============ */
.nimbus-divider {
  position: relative;
  text-align: center;
}

.nimbus-divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--kawaii-line);
}

.nimbus-divider span {
  position: relative;
  padding: 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--kawaii-muted);
  background: var(--kawaii-surface);
}

/* ============ Entrance motion ============ */
@media (prefers-reduced-motion: no-preference) {
  .nimbus-logo-tile {
    animation: nimbus-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}

@keyframes nimbus-pop {
  from {
    opacity: 0;
    transform: scale(0.9) translateY(6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
