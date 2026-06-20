<script setup lang="ts">
/**
 * Cloudflare Turnstile 验证组件
 * 使用 vue-turnstile 库
 */
import { ref, watch } from 'vue'
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
  (e: 'verify', token: string): void
  (e: 'expire'): void
  (e: 'error', error: string): void
}>()

// v-model 支持
const modelValue = defineModel<string>({ default: '' })

const token = ref<string>('')
const turnstileRef = ref<InstanceType<typeof Turnstile> | null>(null)

// 监听内部 token 变化，同步到 modelValue
watch(token, (newToken) => {
  if (newToken && newToken !== modelValue.value) {
    modelValue.value = newToken
    emit('verify', newToken)
  }
})

function onVerify(response: string) {
  token.value = response
  modelValue.value = response
  emit('verify', response)
}

function onExpire() {
  token.value = ''
  modelValue.value = ''
  emit('expire')
}

function onError(error: string) {
  token.value = ''
  modelValue.value = ''
  emit('error', error)
}

// 暴露方法供父组件调用
function reset() {
  token.value = ''
  modelValue.value = ''
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
    <Turnstile
      ref="turnstileRef"
      v-model="token"
      :site-key="siteKey"
      :theme="theme"
      :size="size"
      :language="language"
      :action="action"
      :appearance="appearance"
      @verify="onVerify"
      @expire="onExpire"
      @error="onError"
    />
  </div>
</template>

<style scoped>
.turnstile-widget {
  display: flex;
  justify-content: center;
  margin: 0.5rem 0;
}
</style>
