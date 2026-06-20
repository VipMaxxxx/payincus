<script setup lang="ts">
import { computed } from 'vue'
import { normalizeCountryCodeForFlag } from '@/utils/countryDisplay'

/**
 * 国旗图标组件
 * 使用 flag-icons 库，本地 SVG 国旗，无需网络请求
 */

interface Props {
  code: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'sm'
})

// 尺寸映射
const sizeClasses = {
  xs: 'w-4 h-3',
  sm: 'w-5 h-4',
  md: 'w-6 h-4',
  lg: 'w-8 h-6'
}

// 生成 flag-icons 类名
const resolvedCode = computed(() => normalizeCountryCodeForFlag(props.code))
const flagClass = computed(() => `fi fi-${resolvedCode.value}`)
</script>

<template>
  <span 
    :class="[flagClass, sizeClasses[size], 'inline-block bg-cover bg-center rounded-sm']"
    :title="resolvedCode.toUpperCase()"
  ></span>
</template>
