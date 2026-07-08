<script setup lang="ts">
/**
 * Cloudflare Turnstile 验证组件
 * 使用 vue-turnstile 库
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Turnstile from 'vue-turnstile'

const props = withDefaults(defineProps<{
  siteKey: string
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact'
  language?: string
  action?: string
  appearance?: 'always' | 'execute' | 'interaction-only'
}>(), {
  theme: 'auto',
  size: 'normal',
  appearance: 'always'
})

const emit = defineEmits<{
  (e: 'update:modelValue', token: string): void
  (e: 'verify', token: string): void
  (e: 'expire'): void
  (e: 'error', error: string): void
}>()

const { t } = useI18n()

// v-model 支持
const modelValue = defineModel<string>({ default: '' })

const token = ref<string>('')
const verificationState = ref<'pending' | 'verified' | 'expired' | 'error'>('pending')
const turnstileRef = ref<InstanceType<typeof Turnstile> | null>(null)

const statusLabel = computed(() => {
  if (verificationState.value === 'verified') return t('common.turnstileVerified')
  if (verificationState.value === 'expired') return t('common.turnstileExpired')
  if (verificationState.value === 'error') return t('common.turnstileError')
  return t('common.turnstileUnverified')
})

const statusClass = computed(() => ({
  'turnstile-status--verified': verificationState.value === 'verified',
  'turnstile-status--pending': verificationState.value === 'pending',
  'turnstile-status--expired': verificationState.value === 'expired',
  'turnstile-status--error': verificationState.value === 'error'
}))

// 监听内部 token 变化，同步到 modelValue
watch(token, (newToken) => {
  if (newToken !== modelValue.value) {
    modelValue.value = newToken
    emit('update:modelValue', newToken)
  }
  if (newToken) {
    verificationState.value = 'verified'
    emit('verify', newToken)
  }
})

function onVerify(response: string) {
  token.value = response
  modelValue.value = response
  verificationState.value = 'verified'
  emit('update:modelValue', response)
  emit('verify', response)
}

function onExpire() {
  token.value = ''
  modelValue.value = ''
  verificationState.value = 'expired'
  emit('update:modelValue', '')
  emit('expire')
}

function onError(error: string) {
  token.value = ''
  modelValue.value = ''
  verificationState.value = 'error'
  emit('update:modelValue', '')
  emit('error', error)
}

// 暴露方法供父组件调用
function reset() {
  token.value = ''
  modelValue.value = ''
  verificationState.value = 'pending'
  emit('update:modelValue', '')
  turnstileRef.value?.reset?.()
}

function getToken(): string {
  return token.value || modelValue.value
}

defineExpose({
  reset,
  getToken,
  token
})

// 确保 props 被使用
void props.action
void props.language
</script>

<template>
  <div class="turnstile-widget">
    <div class="turnstile-status-row" aria-live="polite">
      <span class="turnstile-status-title">{{ t('common.turnstileStatusTitle') }}</span>
      <span class="turnstile-status-pill" :class="statusClass">
        <span class="turnstile-status-dot"></span>
        {{ statusLabel }}
      </span>
    </div>
    <Turnstile
      ref="turnstileRef"
      v-model="token"
      :site-key="siteKey"
      :theme="theme"
      :size="size"
      :language="language"
      :action="action"
      :appearance="appearance"
      @update:model-value="onVerify"
      @expired="onExpire"
      @error="onError"
      @unsupported="onError('unsupported')"
    />
  </div>
</template>

<style scoped>
.turnstile-widget {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
  justify-content: center;
  margin: 0.5rem 0;
}

.turnstile-status-row {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.turnstile-status-title {
  color: var(--text-muted, #64748b);
  font-size: 0.8125rem;
  font-weight: 600;
}

.turnstile-status-pill {
  display: inline-flex;
  min-width: 5.5rem;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
}

.turnstile-status-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: currentColor;
}

.turnstile-status--pending {
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(148, 163, 184, 0.12);
  color: #64748b;
}

.turnstile-status--verified {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.12);
  color: #15803d;
}

.turnstile-status--expired {
  border-color: rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}

.turnstile-status--error {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
}
</style>
