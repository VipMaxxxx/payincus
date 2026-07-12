<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import { validateIdentifier, containsDangerousChars } from '@/utils/validation'
import { translateError } from '@/utils/errorHandler'
import { focusTurnstileSection, readTurnstileToken } from '@/utils/turnstile'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import TermsOfServiceModal from '@/components/TermsOfServiceModal.vue'
import api from '@/api'
import { useBrand } from '@/composables/useBrand'
import { dashboardPath, loginPath } from '@/utils/app-paths'
import { useReveal } from '@/composables/useReveal'

const isAdminEntry = import.meta.env.VITE_APP_ENTRY === 'admin'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const brand = useBrand()

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)

interface RegisterForm {
  username: string
  email: string
  password: string
  confirmPassword: string
  inviteCode: string
  emailCode: string
}

const form = ref<RegisterForm>({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  inviteCode: (route.params.code as string) || '',
  emailCode: ''
})

const loading = ref<boolean>(false)
const error = ref<string>('')
const success = ref<boolean>(false)
const registrationEnabled = ref<boolean>(true)
const requireInviteCode = ref<boolean>(true)
const configLoading = ref<boolean>(true)

// Email verification
const emailVerificationEnabled = ref<boolean>(false)
const sendingCode = ref<boolean>(false)
const codeSent = ref<boolean>(false)
const codeCountdown = ref<number>(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null

// 组件卸载时清理定时器
onUnmounted(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
})

// Email domain whitelist
const emailDomainWhitelistEnabled = ref<boolean>(false)
const allowedEmailDomains = ref<string[]>([])
const emailUsername = ref<string>('')
const selectedEmailDomain = ref<string>('')

// 当白名单模式时，自动组合邮箱地址
watch([emailUsername, selectedEmailDomain], () => {
  if (emailDomainWhitelistEnabled.value && allowedEmailDomains.value.length > 0) {
    if (emailUsername.value && selectedEmailDomain.value) {
      form.value.email = `${emailUsername.value}@${selectedEmailDomain.value}`
    } else {
      form.value.email = ''
    }
  }
})

// Turnstile
const turnstileEnabled = ref<boolean>(false)
const turnstileSiteKey = ref<string>('')
const turnstileToken = ref<string>('')
const turnstileRef = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const turnstileSectionRef = ref<HTMLElement | null>(null)
void turnstileRef.value // 模板中通过 ref 使用
const isTurnstileChallengeAvailable = computed<boolean>(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))

// Terms of Service
const agreedToTerms = ref<boolean>(false)
const showTermsModal = ref<boolean>(false)

// Email confirmation modal
const showEmailConfirmModal = ref<boolean>(false)

function onTurnstileExpire() {
  turnstileToken.value = ''
}

function resetTurnstileChallenge(): void {
  if (!isTurnstileChallengeAvailable.value) return
  turnstileToken.value = ''
  turnstileRef.value?.reset?.()
}

function getRegisterTurnstileToken(): string | null | undefined {
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

// Show email confirmation before sending code
function handleSendCodeClick(): void {
  if (!registrationEnabled.value) {
    error.value = t('auth.registrationClosedMessage')
    return
  }

  if (!form.value.email) {
    error.value = t('auth.invalidEmail')
    return
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(form.value.email)) {
    error.value = t('auth.invalidEmail')
    return
  }

  // Check Turnstile if enabled
  if (getRegisterTurnstileToken() === null) return

  // Show confirmation modal
  showEmailConfirmModal.value = true
}

// Confirm and send verification code
function confirmSendCode(): void {
  showEmailConfirmModal.value = false
  sendVerificationCode()
}

// 加载系统配置
onMounted(async () => {
  try {
    const config = await api.systemConfig.getPublic()
    registrationEnabled.value = config.registrationEnabled ?? true
    requireInviteCode.value = config.requireInviteCode
    turnstileEnabled.value = config.turnstileEnabled || false
    turnstileSiteKey.value = config.turnstileSiteKey || ''
    emailVerificationEnabled.value = config.emailVerificationEnabled || false
    emailDomainWhitelistEnabled.value = config.emailDomainWhitelistEnabled || false
    allowedEmailDomains.value = config.allowedEmailDomains || []
    // 设置默认选中的域名
    if (allowedEmailDomains.value.length > 0) {
      selectedEmailDomain.value = allowedEmailDomains.value[0]
    }
  } catch {
    // 默认需要邀请码
    requireInviteCode.value = true
  } finally {
    configLoading.value = false
  }
})

// Send verification code (called after confirmation)
async function sendVerificationCode(): Promise<void> {
  if (!registrationEnabled.value) {
    error.value = t('auth.registrationClosedMessage')
    return
  }

  const verificationToken = getRegisterTurnstileToken()
  if (verificationToken === null) return

  sendingCode.value = true
  error.value = ''

  try {
    await api.auth.sendVerificationCode(
      form.value.email,
      verificationToken || undefined
    )
    codeSent.value = true
    // Start countdown
    codeCountdown.value = 60
    countdownTimer = setInterval(() => {
      codeCountdown.value--
      if (codeCountdown.value <= 0) {
        if (countdownTimer) {
          clearInterval(countdownTimer)
          countdownTimer = null
        }
      }
    }, 1000)
    // Token can only be used once. Keep the form and refresh only the challenge.
    resetTurnstileChallenge()
  } catch (err: any) {
    error.value = translateError(err)
    resetTurnstileChallenge()
  } finally {
    sendingCode.value = false
  }
}

async function handleRegister(): Promise<void> {
  if (!registrationEnabled.value) {
    error.value = t('auth.registrationClosedMessage')
    return
  }

  if (!form.value.username || !form.value.password || !form.value.email) {
    error.value = t('auth.fillAllRequired')
    return
  }

  // 如果需要邀请码但未填写
  if (requireInviteCode.value && !form.value.inviteCode) {
    error.value = t('auth.fillAllRequired')
    return
  }

  // 如果需要邮件验证码但未填写
  if (emailVerificationEnabled.value && !form.value.emailCode) {
    error.value = t('auth.emailCodeRequired')
    return
  }

  // 验证用户名（防止危险字符）
  const fieldName = t('auth.username')
  const usernameValidation = validateIdentifier(form.value.username, fieldName, 3, 32)
  if (!usernameValidation.valid) {
    error.value = usernameValidation.message || t('auth.fillAllRequired')
    return
  }

  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(form.value.email)) {
    error.value = t('auth.invalidEmail')
    return
  }

  // 检查邮箱是否包含危险字符
  const emailWithoutAllowed = form.value.email.replace(/@/g, '').replace(/\./g, '')
  if (containsDangerousChars(emailWithoutAllowed)) {
    error.value = t('auth.emailContainsIllegal')
    return
  }

  if (form.value.password !== form.value.confirmPassword) {
    error.value = t('auth.passwordMismatch')
    return
  }

  if (form.value.password.length < 8) {
    error.value = t('auth.passwordTooShort')
    return
  }

  // 密码复杂度检查
  if (!/[A-Z]/.test(form.value.password)) {
    error.value = t('auth.passwordNeedsUppercase')
    return
  }
  if (!/[a-z]/.test(form.value.password)) {
    error.value = t('auth.passwordNeedsLowercase')
    return
  }
  if (!/[0-9]/.test(form.value.password)) {
    error.value = t('auth.passwordNeedsNumber')
    return
  }

  // 检查 Turnstile 验证
  const verificationToken = getRegisterTurnstileToken()
  if (verificationToken === null) return

  // 检查是否同意服务条款
  if (!agreedToTerms.value) {
    error.value = t('auth.tos.mustAgree')
    return
  }

  loading.value = true
  error.value = ''

  try {
    const response = await api.auth.register({
      username: form.value.username,
      email: form.value.email,
      password: form.value.password,
      inviteCode: form.value.inviteCode,
      turnstileToken: verificationToken || undefined,
      emailCode: emailVerificationEnabled.value ? form.value.emailCode : undefined
    })
    localStorage.setItem('token', response.token)
    authStore.syncToken()
    await authStore.fetchCurrentUser()
    // Clean up countdown timer
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    if (isAdminEntry || authStore.isAdmin) {
      await authStore.logout()
      success.value = false
      error.value = '该入口不支持管理员注册'
      return
    }

    success.value = true
    await router.replace(dashboardPath())
  } catch (err: any) {
    error.value = translateError(err)
    resetTurnstileChallenge()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div ref="revealRoot" class="nimbus-auth kawaii-public-shell kawaii-auth-shell kawaii-user-auth min-h-screen flex items-center justify-center p-4 sm:p-6">
    <div class="nimbus-aurora" aria-hidden="true"></div>
    <div class="relative z-10 w-full max-w-lg">
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
        <p class="nimbus-subtitle">{{ $t('auth.createAccount') }}</p>
      </div>

      <!-- 注册成功 -->
      <div v-if="success" class="card nimbus-card nimbus-state" data-reveal>
        <div class="nimbus-state-icon nimbus-state-icon--ok">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p class="text-themed font-medium">{{ $t('auth.registerSuccess') }}</p>
      </div>

      <div v-else-if="configLoading" class="card nimbus-card nimbus-state" data-reveal>
        <div class="nimbus-spinner"></div>
        <p class="text-themed-muted">{{ $t('common.loading') }}...</p>
      </div>

      <div v-else-if="!registrationEnabled" class="card nimbus-card nimbus-state" data-reveal>
        <div class="nimbus-state-icon nimbus-state-icon--warn">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M12 9v3.75m0 3.75h.007v.008H12v-.008z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M10.34 3.94 1.82 18a1.875 1.875 0 0 0 1.604 2.812h17.152A1.875 1.875 0 0 0 22.18 18L13.66 3.94a1.875 1.875 0 0 0-3.32 0Z" />
          </svg>
        </div>
        <h3 class="text-base font-semibold text-themed">
          {{ $t('auth.registrationClosedTitle') }}
        </h3>
        <p class="text-sm leading-6 text-themed-muted">
          {{ $t('auth.registrationClosedMessage') }}
        </p>
        <button type="button" class="btn-primary w-full" @click="router.push(loginPath())">
          {{ $t('auth.backToLogin') }}
        </button>
      </div>

      <!-- 注册表单 -->
      <div v-else class="card nimbus-card" data-reveal>
        <form class="space-y-4" @submit.prevent="handleRegister">
          <div v-if="requireInviteCode" class="nimbus-field">
            <label class="nimbus-label">
              {{ $t('auth.inviteCode') }} <span class="nimbus-req">*</span>
            </label>
            <input v-model="form.inviteCode" type="text" class="input font-mono" :placeholder="$t('auth.inviteCodePlaceholder')" />
          </div>

          <div class="nimbus-field">
            <label class="nimbus-label">
              {{ $t('auth.username') }} <span class="nimbus-req">*</span>
            </label>
            <input v-model="form.username" type="text" class="input" :placeholder="$t('auth.usernameHint')" />
          </div>

          <div class="nimbus-field">
            <label class="nimbus-label">
              {{ $t('auth.email') }} <span class="nimbus-req">*</span>
            </label>
            <!-- 邮箱白名单模式：左边输入用户名，右边选择域名 -->
            <div v-if="emailDomainWhitelistEnabled && allowedEmailDomains.length > 0" class="flex items-center gap-2">
              <input
                v-model="emailUsername"
                type="text"
                class="input min-w-0 flex-1"
                :placeholder="$t('auth.emailUsernamePlaceholder')"
              />
              <div class="shrink-0 text-themed-muted">@</div>
              <select v-model="selectedEmailDomain" class="input w-32 max-w-[45%] shrink-0 sm:w-auto sm:min-w-[140px]">
                <option v-for="domain in allowedEmailDomains" :key="domain" :value="domain">
                  {{ domain }}
                </option>
              </select>
            </div>
            <!-- 普通模式：完整邮箱输入 -->
            <input v-else v-model="form.email" type="email" class="input" placeholder="your@email.com" />
          </div>

          <!-- Email Verification Code -->
          <div v-if="emailVerificationEnabled" class="nimbus-field">
            <label class="nimbus-label">
              {{ $t('auth.emailCode') }} <span class="nimbus-req">*</span>
            </label>
            <div class="flex flex-col gap-2 sm:flex-row">
              <input
                v-model="form.emailCode"
                type="text"
                class="input min-w-0 flex-1 font-mono tracking-[0.3em]"
                maxlength="6"
                :placeholder="$t('auth.emailCodePlaceholder')"
              />
              <button
                type="button"
                class="btn-secondary w-full whitespace-nowrap px-4 sm:w-auto"
                :disabled="sendingCode || codeCountdown > 0 || !form.email"
                :title="!form.email ? $t('auth.enterEmailFirst') : ''"
                @click="handleSendCodeClick"
              >
                <template v-if="sendingCode">
                  {{ $t('auth.sendingCode') }}
                </template>
                <template v-else-if="codeCountdown > 0">
                  {{ codeCountdown }}s
                </template>
                <template v-else>
                  {{ $t('auth.sendCode') }}
                </template>
              </button>
            </div>
            <p v-if="codeSent" class="nimbus-hint nimbus-hint--ok">
              {{ $t('auth.codeSentHint') }}
            </p>
          </div>

          <div class="nimbus-field">
            <label class="nimbus-label">
              {{ $t('auth.password') }} <span class="nimbus-req">*</span>
            </label>
            <input v-model="form.password" type="password" class="input" :placeholder="$t('auth.passwordHint')" />
          </div>

          <div class="nimbus-field">
            <label class="nimbus-label">
              {{ $t('auth.confirmPassword') }} <span class="nimbus-req">*</span>
            </label>
            <input v-model="form.confirmPassword" type="password" class="input" :placeholder="$t('auth.confirmPasswordPlaceholder')" />
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

          <!-- 服务条款 -->
          <div class="flex items-start gap-2.5">
            <input
              id="agree-terms"
              v-model="agreedToTerms"
              type="checkbox"
              class="nimbus-checkbox mt-0.5"
            />
            <label for="agree-terms" class="text-sm text-themed-muted leading-relaxed">
              {{ $t('auth.tos.agreePrefix') }}
              <button
                type="button"
                class="nimbus-textlink nimbus-textlink--accent"
                @click="showTermsModal = true"
              >
                {{ $t('auth.tos.termsLink') }}
              </button>
            </label>
          </div>

          <div v-if="error" class="nimbus-alert" role="alert">
            <svg class="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v3.75m0 3.75h.008M10.34 3.94l-8.52 14.06A1.875 1.875 0 003.424 20.9h17.152a1.875 1.875 0 001.604-2.9L13.66 3.94a1.875 1.875 0 00-3.32 0z" />
            </svg>
            <span>{{ error }}</span>
          </div>

          <button
            type="submit"
            :disabled="loading || (emailVerificationEnabled && !form.emailCode) || !agreedToTerms"
            class="btn-primary w-full nimbus-submit"
          >
            {{ loading ? $t('auth.creatingAccount') : $t('auth.createAccount') }}
          </button>
        </form>
      </div>

      <!-- 服务条款弹窗 -->
      <TermsOfServiceModal
        :show="showTermsModal"
        @close="showTermsModal = false"
      />

      <!-- 邮箱确认弹窗 -->
      <Teleport to="body">
        <Transition name="modal">
          <div v-if="showEmailConfirmModal" class="modal-overlay">
            <div class="modal-backdrop" @click="showEmailConfirmModal = false" />
            <div class="modal-content max-w-sm">
              <div class="modal-header">
                <h3 class="modal-title">{{ $t('auth.confirmEmail') }}</h3>
                <button
                  type="button"
                  class="p-1 rounded transition-colors hover:bg-themed-hover"
                  @click="showEmailConfirmModal = false"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body text-center">
                <p class="text-sm mb-4" :class="'text-themed-muted'">
                  {{ $t('auth.confirmEmailMessage') }}
                </p>
                <p class="text-lg font-medium break-all">
                  <span class="text-themed">{{ emailUsername || form.email.split('@')[0] }}</span>
                  <span class="text-red-500 font-bold">@{{ selectedEmailDomain || form.email.split('@')[1] }}</span>
                </p>
              </div>
              <div class="modal-footer">
                <button
                  type="button"
                  class="btn-secondary"
                  @click="showEmailConfirmModal = false"
                >
                  {{ $t('common.cancel') }}
                </button>
                <button
                  type="button"
                  class="btn-primary"
                  @click="confirmSendCode"
                >
                  {{ $t('auth.confirmAndSend') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <p class="mt-6 text-center text-sm text-themed-muted">
        {{ $t('auth.hasAccount') }}
        <RouterLink :to="loginPath()" class="nimbus-textlink nimbus-textlink--accent">
          {{ $t('auth.login') }}
        </RouterLink>
      </p>

      <!-- 主题切换 -->
      <button
        class="kawaii-header-icon fixed bottom-4 right-4 p-2 rounded-lg transition-colors"
        @click="themeStore.toggleTheme"
      >
        <svg v-if="themeStore.mode === 'dark'" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
        <svg v-else-if="themeStore.mode === 'light'" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </button>
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

/* ============ State cards ============ */
.nimbus-state {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.nimbus-state-icon {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  margin-bottom: 0.25rem;
}

.nimbus-state-icon svg {
  width: 26px;
  height: 26px;
}

.nimbus-state-icon--ok {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
}

.nimbus-state-icon--warn {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
}

.nimbus-spinner {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid var(--kawaii-line);
  border-top-color: var(--kawaii-primary);
  animation: nimbus-spin 0.8s linear infinite;
}

@keyframes nimbus-spin {
  to {
    transform: rotate(360deg);
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

.nimbus-req {
  color: var(--error);
}

.nimbus-hint {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: var(--kawaii-faint);
}

.nimbus-hint--ok {
  color: var(--success);
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

/* ============ Checkbox ============ */
.nimbus-checkbox {
  height: 1rem;
  width: 1rem;
  border-radius: 5px;
  border: 1px solid var(--kawaii-line-strong);
  background: var(--kawaii-surface);
  accent-color: var(--kawaii-primary);
  cursor: pointer;
}

.nimbus-checkbox:focus-visible {
  outline: 2px solid var(--kawaii-primary);
  outline-offset: 2px;
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
