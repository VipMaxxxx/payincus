<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import { focusTurnstileSection, readTurnstileToken } from '@/utils/turnstile'
import { translateError } from '@/utils/errorHandler'
import api from '@/api'
import { useBrand } from '@/composables/useBrand'
import { loginPath } from '@/utils/app-paths'
import { useReveal } from '@/composables/useReveal'

const router = useRouter()
const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const brand = useBrand()

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)

const email = ref<string>('')
const code = ref<string>('')
const password = ref<string>('')
const confirmPassword = ref<string>('')
const loading = ref<boolean>(false)
const sendingCode = ref<boolean>(false)
const error = ref<string>('')
const success = ref<string>('')
const step = ref<'email' | 'verify'>('email')

// Turnstile 验证
const turnstileEnabled = ref<boolean>(false)
const turnstileSiteKey = ref<string>('')
const turnstileToken = ref<string>('')
const turnstileRef = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const turnstileSectionRef = ref<HTMLElement | null>(null)
const isTurnstileChallengeAvailable = computed<boolean>(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))

onMounted(async (): Promise<void> => {
  try {
    const configResponse = await api.systemConfig.getPublic()
    turnstileEnabled.value = configResponse.turnstileEnabled || false
    turnstileSiteKey.value = configResponse.turnstileSiteKey || ''
  } catch (e) {
    console.error('Failed to load config:', e)
  }
})

function onTurnstileExpire() {
  turnstileToken.value = ''
}

function getForgotPasswordTurnstileToken(): string | null | undefined {
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

async function sendVerificationCode(): Promise<void> {
  if (!email.value || !email.value.includes('@')) {
    error.value = t('auth.invalidEmail')
    return
  }

  const verificationToken = getForgotPasswordTurnstileToken()
  if (verificationToken === null) return

  sendingCode.value = true
  error.value = ''
  success.value = ''

  try {
    await api.auth.sendForgotPasswordCode(email.value, verificationToken || undefined)
    success.value = t('auth.forgotPassword.codeSent')
    step.value = 'verify'
    // Reset turnstile
    if (turnstileRef.value) {
      turnstileRef.value.reset?.()
    }
    turnstileToken.value = ''
  } catch (err: any) {
    error.value = translateError(err)
    // Reset turnstile on error
    if (turnstileRef.value) {
      turnstileRef.value.reset?.()
    }
    turnstileToken.value = ''
  } finally {
    sendingCode.value = false
  }
}

async function resetPassword(): Promise<void> {
  if (!code.value || code.value.length !== 6) {
    error.value = t('auth.invalidCode')
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = t('auth.passwordMismatch')
    return
  }

  if (password.value.length < 8) {
    error.value = t('auth.passwordTooShort')
    return
  }

  if (!/[A-Z]/.test(password.value)) {
    error.value = t('auth.passwordNeedsUppercase')
    return
  }

  if (!/[a-z]/.test(password.value)) {
    error.value = t('auth.passwordNeedsLowercase')
    return
  }

  if (!/[0-9]/.test(password.value)) {
    error.value = t('auth.passwordNeedsNumber')
    return
  }

  const verificationToken = getForgotPasswordTurnstileToken()
  if (verificationToken === null) return

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    const response = await api.auth.resetPassword(
      email.value,
      code.value,
      password.value,
      verificationToken || undefined
    )
    
    toast.success(t('auth.forgotPassword.resetSuccess'))
    
    // 如果取消了2FA，显示提示
    if (response.twoFactorDisabled) {
      toast.info(t('auth.forgotPassword.twoFactorDisabled'))
    }
    
    // 跳转到登录页面
    setTimeout(() => {
      router.push(loginPath())
    }, 2000)
  } catch (err: any) {
    error.value = translateError(err)
    // Reset turnstile on error
    if (turnstileRef.value) {
      turnstileRef.value.reset?.()
    }
    turnstileToken.value = ''
  } finally {
    loading.value = false
  }
}

function backToEmail() {
  step.value = 'email'
  code.value = ''
  password.value = ''
  confirmPassword.value = ''
  error.value = ''
  success.value = ''
  if (turnstileRef.value) {
    turnstileRef.value.reset?.()
  }
  turnstileToken.value = ''
}
</script>

<template>
  <div ref="revealRoot" class="nimbus-auth kawaii-public-shell kawaii-auth-shell kawaii-user-auth min-h-screen flex items-center justify-center p-4 sm:p-6">
    <div class="nimbus-aurora" aria-hidden="true"></div>
    <div class="relative z-10 w-full max-w-sm">
      <ThemeTemplateSlot
        slot-name="public.auth.aside"
        container-class="mb-6"
      />

      <!-- Logo lockup -->
      <div class="nimbus-lockup" data-reveal>
        <div class="nimbus-logo-tile">
          <img :src="brand.brandLogoUrl" :alt="brand.brandName" />
        </div>
        <h1 class="nimbus-title">{{ $t('auth.forgotPassword.title') }}</h1>
        <p class="nimbus-subtitle">{{ $t('auth.forgotPassword.subtitle') }}</p>
      </div>

      <!-- 步骤指示 -->
      <div class="nimbus-steps" data-reveal>
        <div class="nimbus-step" :class="{ 'is-active': step === 'email', 'is-done': step === 'verify' }">
          <span class="nimbus-step-dot">
            <svg v-if="step === 'verify'" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            </svg>
            <template v-else>1</template>
          </span>
          <span class="nimbus-step-label">{{ $t('auth.email') }}</span>
        </div>
        <span class="nimbus-step-line" :class="{ 'is-active': step === 'verify' }"></span>
        <div class="nimbus-step" :class="{ 'is-active': step === 'verify' }">
          <span class="nimbus-step-dot">2</span>
          <span class="nimbus-step-label">{{ $t('auth.verificationCode') }}</span>
        </div>
      </div>

      <!-- 表单 -->
      <div class="card nimbus-card" data-reveal>
        <!-- 步骤1：输入邮箱 -->
        <form v-if="step === 'email'" class="space-y-4" @submit.prevent="sendVerificationCode">
          <div class="nimbus-field">
            <label class="nimbus-label">{{ $t('auth.email') }}</label>
            <input
              v-model="email"
              type="email"
              class="input"
              :placeholder="$t('auth.emailPlaceholder')"
              autocomplete="email"
              required
            />
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

          <!-- 成功提示 -->
          <div v-if="success" class="nimbus-note" role="status">
            {{ success }}
          </div>

          <button
            type="submit"
            :disabled="sendingCode"
            class="btn-primary w-full nimbus-submit"
          >
            {{ sendingCode ? $t('common.sending') : $t('auth.forgotPassword.sendCode') }}
          </button>

          <button
            type="button"
            class="btn-ghost w-full"
            @click="router.push(loginPath())"
          >
            {{ $t('common.back') }}
          </button>
        </form>

        <!-- 步骤2：验证码验证 -->
        <form v-else class="space-y-4" @submit.prevent="resetPassword">
          <div class="nimbus-field">
            <label class="nimbus-label">{{ $t('auth.email') }}</label>
            <input
              :value="email"
              type="email"
              class="input"
              disabled
            />
          </div>

          <div class="nimbus-field">
            <label class="nimbus-label">{{ $t('auth.verificationCode') }}</label>
            <input
              v-model="code"
              type="text"
              maxlength="6"
              class="input font-mono tracking-[0.3em]"
              :placeholder="$t('auth.verificationCodePlaceholder')"
              autocomplete="one-time-code"
              required
            />
            <p class="nimbus-hint">
              {{ $t('auth.forgotPassword.codeHint') }}
            </p>
          </div>

          <div class="nimbus-field">
            <label class="nimbus-label">{{ $t('auth.newPassword') }}</label>
            <input
              v-model="password"
              type="password"
              class="input"
              :placeholder="$t('auth.passwordHint')"
              autocomplete="new-password"
              required
            />
          </div>

          <div class="nimbus-field">
            <label class="nimbus-label">{{ $t('auth.confirmPassword') }}</label>
            <input
              v-model="confirmPassword"
              type="password"
              class="input"
              :placeholder="$t('auth.confirmPasswordPlaceholder')"
              autocomplete="new-password"
              required
            />
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

          <!-- 成功提示 -->
          <div v-if="success" class="nimbus-note" role="status">
            {{ success }}
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="btn-primary w-full nimbus-submit"
          >
            {{ loading ? $t('common.processing') : $t('auth.forgotPassword.resetPassword') }}
          </button>

          <button
            type="button"
            class="btn-ghost w-full"
            @click="backToEmail"
          >
            {{ $t('common.back') }}
          </button>
        </form>
      </div>

      <p class="mt-6 text-center text-sm text-themed-muted">
        {{ $t('auth.rememberPassword') }}
        <RouterLink :to="loginPath()" class="nimbus-textlink nimbus-textlink--accent">
          {{ $t('auth.login') }}
        </RouterLink>
      </p>
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
  margin-bottom: 1.5rem;
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

/* ============ Step indicator ============ */
.nimbus-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.nimbus-step {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--kawaii-faint);
  transition: color 0.2s ease;
}

.nimbus-step.is-active,
.nimbus-step.is-done {
  color: var(--kawaii-text);
}

.nimbus-step-dot {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid var(--kawaii-line-strong);
  background: var(--kawaii-surface);
  color: var(--kawaii-faint);
  transition: all 0.2s ease;
}

.nimbus-step-dot svg {
  width: 14px;
  height: 14px;
}

.nimbus-step.is-active .nimbus-step-dot {
  border-color: var(--kawaii-primary);
  background: var(--kawaii-primary);
  color: #fff;
}

.nimbus-step.is-done .nimbus-step-dot {
  border-color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 14%, transparent);
  color: var(--kawaii-primary);
}

.nimbus-step-label {
  font-size: 0.8125rem;
  font-weight: 500;
}

.nimbus-step-line {
  width: 32px;
  height: 2px;
  border-radius: 2px;
  background: var(--kawaii-line-strong);
  transition: background 0.2s ease;
}

.nimbus-step-line.is-active {
  background: var(--kawaii-primary);
}

/* ============ Card ============ */
.nimbus-card {
  border-radius: 16px;
  padding: 1.75rem;
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

/* ============ Alerts / notes ============ */
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

.nimbus-note {
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 26%, transparent);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
}

.nimbus-submit {
  margin-top: 0.25rem;
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
