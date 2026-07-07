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

const router = useRouter()
const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const brand = useBrand()

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
  <div class="kawaii-public-shell kawaii-auth-shell kawaii-user-auth min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-sm">
      <ThemeTemplateSlot
        slot-name="public.auth.aside"
        container-class="mb-6"
      />

      <!-- Logo -->
      <div class="text-center mb-8">
        <img
          :src="brand.brandLogoUrl"
          :alt="brand.brandName"
          class="w-16 h-16 mx-auto mb-2 rounded-xl"
        />
        <h2 
          class="text-lg font-semibold mb-1"
          :class="'text-themed'"
        >
          {{ $t('auth.forgotPassword.title') }}
        </h2>
        <p 
          class="text-sm"
          :class="'text-themed-muted'"
        >
          {{ $t('auth.forgotPassword.subtitle') }}
        </p>
      </div>

      <!-- 表单 -->
      <div class="card p-6">
        <!-- 步骤1：输入邮箱 -->
        <form v-if="step === 'email'" class="space-y-4" @submit.prevent="sendVerificationCode">
          <div>
            <label
              class="block text-sm mb-1.5"
              :class="'text-themed-muted'"
            >{{ $t('auth.email') }}</label>
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
            class="rounded-lg border p-3"
            :class="themeStore.isDark ? 'border-blue-500/30 bg-blue-900/20' : 'border-blue-200 bg-blue-50'"
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
          <div v-if="error" class="text-sm text-red-500">
            {{ error }}
          </div>

          <!-- 成功提示 -->
          <div v-if="success" class="text-sm text-green-500">
            {{ success }}
          </div>

          <button
            type="submit"
            :disabled="sendingCode"
            class="btn-primary w-full"
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
          <div>
            <label
              class="block text-sm mb-1.5"
              :class="'text-themed-muted'"
            >{{ $t('auth.email') }}</label>
            <input
              :value="email"
              type="email"
              class="input"
              disabled
            />
          </div>

          <div>
            <label
              class="block text-sm mb-1.5"
              :class="'text-themed-muted'"
            >{{ $t('auth.verificationCode') }}</label>
            <input
              v-model="code"
              type="text"
              maxlength="6"
              class="input"
              :placeholder="$t('auth.verificationCodePlaceholder')"
              autocomplete="one-time-code"
              required
            />
            <p class="text-xs mt-1" :class="'text-themed-muted'">
              {{ $t('auth.forgotPassword.codeHint') }}
            </p>
          </div>

          <div>
            <label
              class="block text-sm mb-1.5"
              :class="'text-themed-muted'"
            >{{ $t('auth.newPassword') }}</label>
            <input
              v-model="password"
              type="password"
              class="input"
              :placeholder="$t('auth.passwordHint')"
              autocomplete="new-password"
              required
            />
          </div>

          <div>
            <label
              class="block text-sm mb-1.5"
              :class="'text-themed-muted'"
            >{{ $t('auth.confirmPassword') }}</label>
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
            class="rounded-lg border p-3"
            :class="themeStore.isDark ? 'border-blue-500/30 bg-blue-900/20' : 'border-blue-200 bg-blue-50'"
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
          <div v-if="error" class="text-sm text-red-500">
            {{ error }}
          </div>

          <!-- 成功提示 -->
          <div v-if="success" class="text-sm text-green-500">
            {{ success }}
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="btn-primary w-full"
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

      <p class="mt-6 text-center text-sm" :class="'text-themed-muted'">
        {{ $t('auth.rememberPassword') }}
        <RouterLink 
          :to="loginPath()"
          class="transition-colors"
          :class="'text-themed-muted hover:text-themed'"
        >
          {{ $t('auth.login') }}
        </RouterLink>
      </p>
    </div>
  </div>
</template>
