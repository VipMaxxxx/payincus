<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import api from '@/api'
import { useToast } from '@/stores/toast'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

interface Props {
  show: boolean
  operationType: string
  resourceId?: number
  onSuccess?: () => void
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'verified'): void
}>()

// 状态
const step = ref<'request' | 'verify'>('request')
const loading = ref(false)
const verificationCode = ref('')
const channel = ref<'email' | 'telegram' | 'discord' | 'webhook' | null>(null)
const target = ref<string | null>(null)
const expiresAt = ref<string | null>(null)
const countdown = ref(0)
const error = ref('')

let countdownTimer: ReturnType<typeof setInterval> | null = null

// 操作类型显示名称
const operationName = computed(() => {
  const names: Record<string, string> = {
    delete_instance: t('sensitiveVerification.operationTypes.delete_instance'),
    reinstall_instance: t('sensitiveVerification.operationTypes.reinstall_instance'),
    transfer_instance: t('sensitiveVerification.operationTypes.transfer_instance'),
    delete_snapshot: t('sensitiveVerification.operationTypes.delete_snapshot'),
    delete_backup: t('sensitiveVerification.operationTypes.delete_backup'),
    change_password: t('sensitiveVerification.operationTypes.change_password'),
    disable_2fa: t('sensitiveVerification.operationTypes.disable_2fa'),
    change_email: t('sensitiveVerification.operationTypes.change_email'),
    delete_account: t('sensitiveVerification.operationTypes.delete_account')
  }
  return names[props.operationType] || props.operationType
})

// 渠道显示名称
const channelName = computed(() => {
  if (!channel.value) return ''
  const names: Record<string, string> = {
    email: t('sensitiveVerification.channels.email'),
    telegram: 'Telegram',
    discord: 'Discord',
    webhook: 'Webhook'
  }
  return names[channel.value] || channel.value
})

// 重置状态
function resetState() {
  step.value = 'request'
  verificationCode.value = ''
  channel.value = null
  target.value = null
  expiresAt.value = null
  countdown.value = 0
  error.value = ''
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

// 监听弹窗显示状态
watch(() => props.show, (newVal) => {
  if (newVal) {
    resetState()
  }
})

// 请求验证码
async function requestCode() {
  loading.value = true
  error.value = ''
  
  try {
    const response = await api.verification.request(props.operationType, props.resourceId)
    channel.value = response.channel
    target.value = response.maskedTarget || response.target || null
    expiresAt.value = response.expiresAt ?? null
    step.value = 'verify'
    
    // 启动倒计时 (60秒后可重发)
    countdown.value = 60
    countdownTimer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) {
        if (countdownTimer) {
          clearInterval(countdownTimer)
          countdownTimer = null
        }
      }
    }, 1000)
    
    toast.success(t('sensitiveVerification.codeSent'))
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

// 验证
async function verify() {
  if (verificationCode.value.length !== 6) {
    error.value = t('sensitiveVerification.invalidCode')
    return
  }
  
  loading.value = true
  error.value = ''
  
  try {
    await api.verification.verify(props.operationType, verificationCode.value, props.resourceId)
    toast.success(t('sensitiveVerification.verifySuccess'))
    emit('verified')
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

// 关闭弹窗
function close() {
  resetState()
  emit('close')
}

// 组件卸载时清理定时器
onUnmounted(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay">
        <div class="modal-backdrop" @click="close" />
        <div class="modal-content max-w-md">
          <div class="modal-header">
            <h3 class="modal-title">{{ t('sensitiveVerification.title') }}</h3>
            <button
              type="button"
              class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              @click="close"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body">
            <!-- 步骤 1: 请求验证码 -->
            <div v-if="step === 'request'" class="space-y-4">
              <div class="p-4 rounded-lg" :class="themeStore.isDark ? 'bg-yellow-900/20 border border-yellow-500/30' : 'bg-yellow-50 border border-yellow-200'">
                <div class="flex items-start gap-3">
                  <svg class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-yellow-400' : 'text-yellow-800'">
                      {{ t('sensitiveVerification.description') }}
                    </p>
                    <p class="text-sm mt-1" :class="themeStore.isDark ? 'text-yellow-500/80' : 'text-yellow-700'">
                      {{ t('sensitiveVerification.operationLabel') }}: <strong>{{ operationName }}</strong>
                    </p>
                  </div>
                </div>
              </div>
              
              <p class="text-sm text-themed-secondary">
                {{ t('sensitiveVerification.requestHint') }}
              </p>
              
              <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
            </div>
            
            <!-- 步骤 2: 输入验证码 -->
            <div v-else class="space-y-4">
              <div class="text-center">
                <p class="text-sm text-themed-secondary mb-2">
                  {{ t('sensitiveVerification.codeSentTo', { channel: channelName }) }}
                </p>
                <p v-if="target" class="text-sm font-medium text-themed">{{ target }}</p>
              </div>
              
              <div>
                <label class="block text-sm text-themed-secondary mb-1.5">
                  {{ t('sensitiveVerification.enterCode') }}
                </label>
                <input
                  v-model="verificationCode"
                  type="text"
                  maxlength="6"
                  class="input text-center text-2xl tracking-widest font-mono"
                  :placeholder="t('sensitiveVerification.codePlaceholder')"
                  @keyup.enter="verify"
                />
              </div>
              
              <div class="flex items-center justify-between text-sm">
                <button
                  v-if="countdown > 0"
                  type="button"
                  class="text-themed-muted cursor-not-allowed"
                  disabled
                >
                  {{ t('sensitiveVerification.resendIn', { seconds: countdown }) }}
                </button>
                <button
                  v-else
                  type="button"
                  class="text-blue-500 hover:text-blue-400"
                  :disabled="loading"
                  @click="requestCode"
                >
                  {{ t('sensitiveVerification.resendCode') }}
                </button>
              </div>
              
              <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn-secondary" @click="close">{{ t('common.cancel') }}</button>
            <button
              v-if="step === 'request'"
              class="btn-primary"
              :disabled="loading"
              @click="requestCode"
            >
              {{ loading ? t('sensitiveVerification.sendingCode') : t('sensitiveVerification.sendCode') }}
            </button>
            <button
              v-else
              class="btn-primary"
              :disabled="loading || verificationCode.length !== 6"
              @click="verify"
            >
              {{ loading ? t('sensitiveVerification.verifying') : t('sensitiveVerification.verify') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
