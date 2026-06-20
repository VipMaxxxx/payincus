<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { validateIdentifier, containsDangerousChars } from '@/utils/validation'
import { translateError } from '@/utils/errorHandler'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import TermsOfServiceModal from '@/components/TermsOfServiceModal.vue'
import api from '@/api'
import { useBrand } from '@/composables/useBrand'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const brand = useBrand()

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
void turnstileRef.value // 模板中通过 ref 使用

// Terms of Service
const agreedToTerms = ref<boolean>(false)
const showTermsModal = ref<boolean>(false)

// Email confirmation modal
const showEmailConfirmModal = ref<boolean>(false)

function onTurnstileExpire() {
  turnstileToken.value = ''
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
  if (turnstileEnabled.value && !turnstileToken.value) {
    error.value = t('auth.turnstileRequired')
    return
  }

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

  sendingCode.value = true
  error.value = ''

  try {
    await api.auth.sendVerificationCode(
      form.value.email,
      turnstileEnabled.value ? turnstileToken.value : undefined
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
    // Reset turnstile after successful send (token can only be used once)
    if (turnstileRef.value) {
      turnstileRef.value.reset?.()
    }
    turnstileToken.value = ''
  } catch (err: any) {
    error.value = translateError(err)
    // Reset turnstile if failed
    if (turnstileRef.value) {
      turnstileRef.value.reset?.()
    }
    turnstileToken.value = ''
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
  if (turnstileEnabled.value && !turnstileToken.value) {
    error.value = t('auth.turnstileRequired')
    return
  }

  // 检查是否同意服务条款
  if (!agreedToTerms.value) {
    error.value = t('auth.tos.mustAgree')
    return
  }

  loading.value = true
  error.value = ''

  try {
    await authStore.register({
      username: form.value.username,
      email: form.value.email,
      password: form.value.password,
      inviteCode: form.value.inviteCode,
      turnstileToken: turnstileEnabled.value ? turnstileToken.value : undefined,
      emailCode: emailVerificationEnabled.value ? form.value.emailCode : undefined
    })
    success.value = true
    // Clean up countdown timer
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    // 注册成功后自动登录并跳转到后台
    // 管理员跳转到用户管理页面，普通用户跳转到 dashboard
    // 优化：减少延迟时间从 1.5 秒到 0.5 秒
    const targetRoute = authStore.isAdmin ? '/admin/users' : '/'
    setTimeout(() => router.push(targetRoute), 500)
  } catch (err: any) {
    error.value = translateError(err)
  } finally {
    loading.value = false
  }
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
          {{ $t('auth.createAccount') }}
        </p>
      </div>

      <!-- 注册成功 -->
      <div v-if="success" class="card p-6 text-center">
        <svg class="w-12 h-12 mx-auto mb-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ $t('auth.registerSuccess') }}</p>
      </div>

      <div v-else-if="configLoading" class="card p-6 text-center">
        <p :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">{{ $t('common.loading') }}...</p>
      </div>

      <div v-else-if="!registrationEnabled" class="card p-6 text-center">
        <svg class="w-12 h-12 mx-auto mb-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3.75m0 3.75h.007v.008H12v-.008z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.34 3.94 1.82 18a1.875 1.875 0 0 0 1.604 2.812h17.152A1.875 1.875 0 0 0 22.18 18L13.66 3.94a1.875 1.875 0 0 0-3.32 0Z" />
        </svg>
        <h3 class="text-base font-semibold mb-2" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
          {{ $t('auth.registrationClosedTitle') }}
        </h3>
        <p class="text-sm leading-6 mb-5" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
          {{ $t('auth.registrationClosedMessage') }}
        </p>
        <button type="button" class="btn-primary w-full" @click="router.push('/login')">
          {{ $t('auth.backToLogin') }}
        </button>
      </div>

      <!-- 注册表单 -->
      <div v-else class="card p-6">
        <form class="space-y-4" @submit.prevent="handleRegister">
          <div v-if="requireInviteCode">
            <label 
              class="block text-sm mb-1.5"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >
              {{ $t('auth.inviteCode') }} <span class="text-red-500">*</span>
            </label>
            <input v-model="form.inviteCode" type="text" class="input" :placeholder="$t('auth.inviteCodePlaceholder')" />
          </div>

          <div>
            <label 
              class="block text-sm mb-1.5"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >
              {{ $t('auth.username') }} <span class="text-red-500">*</span>
            </label>
            <input v-model="form.username" type="text" class="input" :placeholder="$t('auth.usernameHint')" />
          </div>

          <div>
            <label 
              class="block text-sm mb-1.5"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >
              {{ $t('auth.email') }} <span class="text-red-500">*</span>
            </label>
            <!-- 邮箱白名单模式：左边输入用户名，右边选择域名 -->
            <div v-if="emailDomainWhitelistEnabled && allowedEmailDomains.length > 0" class="flex gap-2">
              <input 
                v-model="emailUsername" 
                type="text" 
                class="input flex-1" 
                :placeholder="$t('auth.emailUsernamePlaceholder')" 
              />
              <div class="flex items-center text-themed-muted">@</div>
              <select v-model="selectedEmailDomain" class="input w-auto min-w-[140px]">
                <option v-for="domain in allowedEmailDomains" :key="domain" :value="domain">
                  {{ domain }}
                </option>
              </select>
            </div>
            <!-- 普通模式：完整邮箱输入 -->
            <input v-else v-model="form.email" type="email" class="input" placeholder="your@email.com" />
          </div>

          <!-- Email Verification Code -->
          <div v-if="emailVerificationEnabled">
            <label 
              class="block text-sm mb-1.5"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >
              {{ $t('auth.emailCode') }} <span class="text-red-500">*</span>
            </label>
            <div class="flex gap-2">
              <input 
                v-model="form.emailCode" 
                type="text" 
                class="input flex-1" 
                maxlength="6"
                :placeholder="$t('auth.emailCodePlaceholder')" 
              />
              <button
                type="button"
                class="btn-secondary whitespace-nowrap px-4"
                :disabled="sendingCode || codeCountdown > 0 || !form.email || (turnstileEnabled && !turnstileToken)"
                :title="!form.email ? $t('auth.enterEmailFirst') : (turnstileEnabled && !turnstileToken) ? $t('auth.turnstileRequired') : ''"
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
            <p 
              v-if="codeSent" 
              class="text-xs mt-1"
              :class="themeStore.isDark ? 'text-green-400' : 'text-green-600'"
            >
              {{ $t('auth.codeSentHint') }}
            </p>
          </div>

          <div>
            <label 
              class="block text-sm mb-1.5"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >
              {{ $t('auth.password') }} <span class="text-red-500">*</span>
            </label>
            <input v-model="form.password" type="password" class="input" :placeholder="$t('auth.passwordHint')" />
          </div>

          <div>
            <label 
              class="block text-sm mb-1.5"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >
              {{ $t('auth.confirmPassword') }} <span class="text-red-500">*</span>
            </label>
            <input v-model="form.confirmPassword" type="password" class="input" :placeholder="$t('auth.confirmPasswordPlaceholder')" />
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

          <!-- 服务条款 -->
          <div class="flex items-start gap-2">
            <input
              id="agree-terms"
              v-model="agreedToTerms"
              type="checkbox"
              class="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              :class="themeStore.isDark ? 'bg-gray-800 border-gray-600' : ''"
            />
            <label 
              for="agree-terms" 
              class="text-sm"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >
              {{ $t('auth.tos.agreePrefix') }}
              <button
                type="button"
                class="text-blue-500 hover:text-blue-400 hover:underline"
                @click="showTermsModal = true"
              >
                {{ $t('auth.tos.termsLink') }}
              </button>
            </label>
          </div>

          <div v-if="error" class="text-sm text-red-500">{{ error }}</div>

          <button 
            type="submit" 
            :disabled="loading || (emailVerificationEnabled && !form.emailCode) || !agreedToTerms" 
            class="btn-primary w-full"
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
                  class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  @click="showEmailConfirmModal = false"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="modal-body text-center">
                <p class="text-sm mb-4" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                  {{ $t('auth.confirmEmailMessage') }}
                </p>
                <p class="text-lg font-medium break-all">
                  <span :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'">{{ emailUsername || form.email.split('@')[0] }}</span>
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

      <p class="mt-6 text-center text-sm" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'">
        {{ $t('auth.hasAccount') }}
        <RouterLink 
          to="/login" 
          class="transition-colors"
          :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-700 hover:text-gray-900'"
        >
          {{ $t('auth.login') }}
        </RouterLink>
      </p>

      <!-- 主题切换 -->
      <button
        class="fixed bottom-4 right-4 p-2 rounded-lg transition-colors"
        :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'"
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
