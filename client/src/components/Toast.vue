<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  message: string
  type?: 'info' | 'success' | 'error' | 'warning'
  duration?: number
  visible: boolean
}

interface Emits {
  (e: 'close'): void
}

const props = withDefaults(defineProps<Props>(), {
  type: 'info',
  duration: 3000
})

const emit = defineEmits<Emits>()

const isVisible = ref<boolean>(props.visible)

watch(() => props.visible, (newVal: boolean) => {
  isVisible.value = newVal
  if (newVal && props.duration > 0) {
    setTimeout(() => {
      isVisible.value = false
      emit('close')
    }, props.duration)
  }
})

function close(): void {
  isVisible.value = false
  emit('close')
}

const icons: Record<string, string> = {
  success: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>`,
  error: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>`,
  warning: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>`,
  info: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`
}

const iconColors: Record<string, string> = {
  success: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400'
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div 
      v-if="isVisible"
      :class="['toast', `toast-${type}`]"
    >
      <svg 
        :class="['w-5 h-5 flex-shrink-0', iconColors[type]]" 
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
        v-html="icons[type]"
      ></svg>
      <span class="flex-1">{{ message }}</span>
      <button 
        class="text-themed-muted hover:text-themed transition-colors" 
        @click="close"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </Transition>
</template>

