<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { translateError } from '@/utils/errorHandler'

interface Props {
  show: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'updated', email: string): void
}>()

const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const toast = useToast()

type Step = 'verifyCurrent' | 'verifyNew'

const step = ref<Step>('verifyCurrent')
const currentEmailCode = ref('')
const currentTarget = ref('')
const currentStepError = ref('')
const currentCodeSent = ref(false)
const sendingCurrentCode = ref(false)
const verifyingCurrentCode = ref(false)
const currentCountdown = ref(0)

const newEmail = ref('')
const newEmailCode = ref('')
const newStepError = ref('')
const newCodeSent = ref(false)
const sendingNewCode = ref(false)
const submitting = ref(false)
const newCountdown = ref(0)

let currentCountdownTimer: ReturnType<typeof setInterval> | null = null
let newCountdownTimer: ReturnType<typeof setInterval> | null = null

const hasCurrentEmail = computed(() => !!authStore.user?.email)
const normalizedNewEmail = computed(() => newEmail.value.trim().toLowerCase())
const modalTitle = computed(() => (
  hasCurrentEmail.value
    ? t('profile.account.emailDialog.titleChange')
    : t('profile.account.emailDialog.titleBind')
))
const maskedCurrentEmail = computed(() => maskEmail(authStore.user?.email || ''))

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email
  const [localPart, domain] = email.split('@')
  if (localPart.length <= 2) return `${localPart[0] || ''}***@${domain}`
  return `${localPart.slice(0, 2)}***@${domain}`
}

function clearCurrentCountdown(): void {
  if (currentCountdownTimer) {
    clearInterval(currentCountdownTimer)
    currentCountdownTimer = null
  }
  currentCountdown.value = 0
}

function clearNewCountdown(): void {
  if (newCountdownTimer) {
    clearInterval(newCountdownTimer)
    newCountdownTimer = null
  }
  newCountdown.value = 0
}

function startCurrentCountdown(seconds: number = 120): void {
  clearCurrentCountdown()
  currentCountdown.value = seconds
  currentCountdownTimer = setInterval(() => {
    currentCountdown.value -= 1
    if (currentCountdown.value <= 0) {
      clearCurrentCountdown()
    }
  }, 1000)
}

function startNewCountdown(seconds: number = 60): void {
  clearNewCountdown()
  newCountdown.value = seconds
  newCountdownTimer = setInterval(() => {
    newCountdown.value -= 1
    if (newCountdown.value <= 0) {
      clearNewCountdown()
    }
  }, 1000)
}

function resetState(): void {
  step.value = hasCurrentEmail.value ? 'verifyCurrent' : 'verifyNew'
  currentEmailCode.value = ''
  currentTarget.value = ''
  currentStepError.value = ''
  currentCodeSent.value = false
  sendingCurrentCode.value = false
  verifyingCurrentCode.value = false
  clearCurrentCountdown()

  newEmail.value = ''
  newEmailCode.value = ''
  newStepError.value = ''
  newCodeSent.value = false
  sendingNewCode.value = false
  submitting.value = false
  clearNewCountdown()
}

function closeModal(): void {
  if (sendingCurrentCode.value || verifyingCurrentCode.value || sendingNewCode.value || submitting.value) {
    return
  }
  resetState()
  emit('close')
}

function validateNewEmailInput(): string | null {
  if (!normalizedNewEmail.value) {
    return t('profile.account.emailDialog.newEmailRequired')
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailPattern.test(normalizedNewEmail.value)) {
    return t('profile.account.emailDialog.newEmailInvalid')
  }

  if (hasCurrentEmail.value && normalizedNewEmail.value === (authStore.user?.email || '').trim().toLowerCase()) {
    return t('profile.account.emailDialog.newEmailSame')
  }

  return null
}

function handleVerificationExpired(error: unknown): boolean {
  const apiError = error as { code?: string; message?: string }
  if (apiError?.code !== 'VERIFICATION_REQUIRED') {
    return false
  }

  if (hasCurrentEmail.value) {
    step.value = 'verifyCurrent'
    currentStepError.value = t('profile.account.emailDialog.currentVerificationExpired')
    currentCodeSent.value = false
    currentEmailCode.value = ''
    clearCurrentCountdown()
  }

  return true
}

async function sendCurrentCode(): Promise<void> {
  currentStepError.value = ''
  sendingCurrentCode.value = true

  try {
    const response = await api.verification.request('change_email')
    currentTarget.value = response.maskedTarget || response.target || maskedCurrentEmail.value
    currentCodeSent.value = true
    startCurrentCountdown(120)
    toast.success(t('profile.account.emailDialog.currentCodeSent'))
  } catch (error) {
    currentStepError.value = translateError(error)
  } finally {
    sendingCurrentCode.value = false
  }
}

async function verifyCurrentCode(): Promise<void> {
  if (currentEmailCode.value.length !== 6) {
    currentStepError.value = t('profile.account.emailDialog.currentCodeRequired')
    return
  }

  currentStepError.value = ''
  verifyingCurrentCode.value = true

  try {
    await api.verification.verify('change_email', currentEmailCode.value)
    step.value = 'verifyNew'
    currentStepError.value = ''
    toast.success(t('profile.account.emailDialog.currentVerifiedSuccess'))
  } catch (error) {
    currentStepError.value = translateError(error)
  } finally {
    verifyingCurrentCode.value = false
  }
}

async function sendNewEmailCode(): Promise<void> {
  const validationError = validateNewEmailInput()
  if (validationError) {
    newStepError.value = validationError
    return
  }

  newStepError.value = ''
  sendingNewCode.value = true

  try {
    await api.users.sendChangeEmailCode(authStore.user!.id, normalizedNewEmail.value)
    newCodeSent.value = true
    startNewCountdown(60)
    toast.success(t('profile.account.emailDialog.newCodeSent'))
  } catch (error) {
    if (!handleVerificationExpired(error)) {
      newStepError.value = translateError(error)
    }
  } finally {
    sendingNewCode.value = false
  }
}

async function submitEmailChange(): Promise<void> {
  const validationError = validateNewEmailInput()
  if (validationError) {
    newStepError.value = validationError
    return
  }

  if (!newEmailCode.value.trim()) {
    newStepError.value = t('profile.account.emailDialog.newCodeRequired')
    return
  }

  newStepError.value = ''
  submitting.value = true

  try {
    await api.users.update(authStore.user!.id, {
      email: normalizedNewEmail.value,
      emailCode: newEmailCode.value.trim()
    })

    if (authStore.user) {
      authStore.user.email = normalizedNewEmail.value
    }

    toast.success(t('profile.account.emailDialog.updateSuccess'))
    emit('updated', normalizedNewEmail.value)
    resetState()
    emit('close')
  } catch (error) {
    if (!handleVerificationExpired(error)) {
      newStepError.value = translateError(error)
    }
  } finally {
    submitting.value = false
  }
}

watch(() => props.show, (show) => {
  if (show) {
    resetState()
  }
})

watch(normalizedNewEmail, (value, oldValue) => {
  if (value === oldValue) return
  newEmailCode.value = ''
  newCodeSent.value = false
  clearNewCountdown()
  newStepError.value = ''
})

onUnmounted(() => {
  clearCurrentCountdown()
  clearNewCountdown()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay">
        <div class="modal-backdrop" @click="closeModal" />
        <div class="modal-content max-w-xl">
          <div class="modal-header">
            <h3 class="modal-title">{{ modalTitle }}</h3>
            <button
              type="button"
              class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              @click="closeModal"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="modal-body space-y-5">
            <div class="grid gap-3 sm:grid-cols-2">
              <div
                class="rounded-xl border px-4 py-3"
                :class="step === 'verifyCurrent'
                  ? (themeStore.isDark ? 'border-blue-500/40 bg-blue-500/10' : 'border-blue-200 bg-blue-50')
                  : (themeStore.isDark ? 'border-gray-700 bg-gray-800/80' : 'border-gray-200 bg-gray-50')"
              >
                <span
                  class="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold"
                  :class="themeStore.isDark ? 'bg-gray-800 text-gray-200' : 'bg-white text-gray-700 border border-gray-200'"
                >
                  1
                </span>
                <p class="mt-1 text-sm font-medium text-themed">
                  {{ hasCurrentEmail ? t('profile.account.emailDialog.stepCurrent') : t('profile.account.emailDialog.stepCurrentSkipped') }}
                </p>
                <p class="mt-1 text-xs leading-5 text-themed-muted">
                  {{ hasCurrentEmail ? t('profile.account.emailDialog.stepCurrentHint') : t('profile.account.emailDialog.noCurrentEmailHint') }}
                </p>
              </div>
              <div
                class="rounded-xl border px-4 py-3"
                :class="step === 'verifyNew'
                  ? (themeStore.isDark ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50')
                  : (themeStore.isDark ? 'border-gray-700 bg-gray-800/80' : 'border-gray-200 bg-gray-50')"
              >
                <span
                  class="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold"
                  :class="themeStore.isDark ? 'bg-gray-800 text-gray-200' : 'bg-white text-gray-700 border border-gray-200'"
                >
                  2
                </span>
                <p class="mt-1 text-sm font-medium text-themed">{{ t('profile.account.emailDialog.stepNew') }}</p>
                <p class="mt-1 text-xs leading-5 text-themed-muted">{{ t('profile.account.emailDialog.stepNewHint') }}</p>
              </div>
            </div>

            <div
              v-if="step === 'verifyCurrent'"
              class="rounded-2xl border p-4 space-y-4"
              :class="themeStore.isDark ? 'border-gray-700 bg-gray-900/70' : 'border-gray-200 bg-white'"
            >
              <div class="rounded-xl border px-4 py-3" :class="themeStore.isDark ? 'border-yellow-500/30 bg-yellow-500/10' : 'border-yellow-200 bg-yellow-50'">
                <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-yellow-200' : 'text-yellow-900'">
                  {{ t('profile.account.emailDialog.verifyCurrentTitle') }}
                </p>
                <p class="mt-1 text-xs leading-5" :class="themeStore.isDark ? 'text-yellow-300/80' : 'text-yellow-700'">
                  {{ t('profile.account.emailDialog.verifyCurrentDesc', { email: currentTarget || maskedCurrentEmail }) }}
                </p>
              </div>

              <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div class="flex-1">
                  <label class="block text-sm font-medium text-themed-secondary mb-1">
                    {{ t('profile.account.emailDialog.currentCode') }}
                  </label>
                  <input
                    v-model="currentEmailCode"
                    type="text"
                    maxlength="6"
                    class="input w-full"
                    :placeholder="t('profile.account.emailDialog.currentCodePlaceholder')"
                  />
                </div>
                <button
                  type="button"
                  class="btn-secondary whitespace-nowrap"
                  :disabled="sendingCurrentCode || currentCountdown > 0"
                  @click="sendCurrentCode"
                >
                  {{
                    currentCountdown > 0
                      ? t('profile.account.emailDialog.resendIn', { seconds: currentCountdown })
                      : (currentCodeSent ? t('profile.account.emailDialog.resendCurrentCode') : t('profile.account.emailDialog.sendCurrentCode'))
                  }}
                </button>
              </div>

              <div v-if="currentStepError" class="text-sm text-red-500">{{ currentStepError }}</div>
            </div>

            <div
              v-else
              class="rounded-2xl border p-4 space-y-4"
              :class="themeStore.isDark ? 'border-gray-700 bg-gray-900/70' : 'border-gray-200 bg-white'"
            >
              <div class="rounded-xl border px-4 py-3" :class="themeStore.isDark ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50'">
                <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-emerald-200' : 'text-emerald-900'">
                  {{ t('profile.account.emailDialog.verifyNewTitle') }}
                </p>
                <p class="mt-1 text-xs leading-5" :class="themeStore.isDark ? 'text-emerald-300/80' : 'text-emerald-700'">
                  {{
                    hasCurrentEmail
                      ? t('profile.account.emailDialog.verifyNewDesc')
                      : t('profile.account.emailDialog.bindEmailDesc')
                  }}
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-themed-secondary mb-1">
                  {{ t('profile.account.emailDialog.newEmail') }}
                </label>
                <input
                  v-model="newEmail"
                  type="email"
                  class="input w-full"
                  :placeholder="t('profile.account.emailDialog.newEmailPlaceholder')"
                  autocomplete="email"
                />
              </div>

              <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div class="flex-1">
                  <label class="block text-sm font-medium text-themed-secondary mb-1">
                    {{ t('profile.account.emailDialog.newCode') }}
                  </label>
                  <input
                    v-model="newEmailCode"
                    type="text"
                    maxlength="6"
                    class="input w-full"
                    :placeholder="t('profile.account.emailDialog.newCodePlaceholder')"
                  />
                </div>
                <button
                  type="button"
                  class="btn-secondary whitespace-nowrap"
                  :disabled="sendingNewCode || newCountdown > 0"
                  @click="sendNewEmailCode"
                >
                  {{
                    newCountdown > 0
                      ? t('profile.account.emailDialog.resendIn', { seconds: newCountdown })
                      : (newCodeSent ? t('profile.account.emailDialog.resendNewCode') : t('profile.account.emailDialog.sendNewCode'))
                  }}
                </button>
              </div>

              <div v-if="newStepError" class="text-sm text-red-500">{{ newStepError }}</div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-secondary" @click="closeModal">{{ t('common.cancel') }}</button>
            <button
              v-if="step === 'verifyCurrent'"
              class="btn-primary"
              :disabled="verifyingCurrentCode || currentEmailCode.length !== 6"
              @click="verifyCurrentCode"
            >
              {{ verifyingCurrentCode ? t('profile.account.emailDialog.verifying') : t('profile.account.emailDialog.verifyCurrentAction') }}
            </button>
            <button
              v-else
              class="btn-primary"
              :disabled="submitting || !normalizedNewEmail || newEmailCode.length !== 6"
              @click="submitEmailChange"
            >
              {{ submitting ? t('profile.account.emailDialog.submitting') : t('profile.account.emailDialog.confirmAction') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
