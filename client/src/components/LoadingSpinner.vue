<template>
  <svg
    :class="[
      'animate-spin',
      sizeClass,
      colorClass
    ]"
    fill="none"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      class="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      stroke-width="4"
    />
    <path
      class="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  color?: 'primary' | 'white' | 'muted' | 'current'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  color: 'current'
})

const sizeClass = computed(() => {
  const sizes: Record<string, string> = {
    xs: 'w-3 h-3',
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
    xl: 'w-8 h-8'
  }
  return sizes[props.size]
})

const colorClass = computed(() => {
  const colors: Record<string, string> = {
    primary: 'text-primary',
    white: 'text-white',
    muted: 'text-themed-muted',
    current: ''  // 继承父元素颜色
  }
  return colors[props.color]
})
</script>
