<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

interface Props {
  type?: 'line' | 'circle' | 'card' | 'table' | 'text'
  width?: string
  height?: string
  size?: string
  rows?: number
  lines?: number
}

const props = withDefaults(defineProps<Props>(), {
  type: 'line',
  width: '100%',
  height: '16px',
  size: '40px',
  rows: 5,
  lines: 3
})
</script>

<template>
  <!-- 线条骨架屏 -->
  <div 
    v-if="props.type === 'line'" 
    :class="['skeleton-line', themeStore.isDark ? 'skeleton-dark' : 'skeleton-light']"
    :style="{ width: props.width, height: props.height }"
  ></div>

  <!-- 圆形骨架屏 -->
  <div 
    v-else-if="props.type === 'circle'" 
    :class="['skeleton-circle', themeStore.isDark ? 'skeleton-dark' : 'skeleton-light']"
    :style="{ width: props.size, height: props.size }"
  ></div>

  <!-- 卡片骨架屏 -->
  <div 
    v-else-if="props.type === 'card'" 
    class="card p-5 animate-pulse"
  >
    <div class="flex items-center justify-between mb-4">
      <div class="h-5 rounded w-1/3" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"></div>
      <div class="h-5 rounded w-14" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"></div>
    </div>
    <div class="h-3 rounded w-3/4 mb-4" :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-200/50'"></div>
    <div class="grid grid-cols-2 gap-3">
      <div v-for="j in 4" :key="j" class="space-y-1">
        <div class="h-3 rounded w-1/2" :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-200/50'"></div>
        <div class="h-4 rounded w-2/3" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"></div>
      </div>
    </div>
  </div>

  <!-- 表格骨架屏 -->
  <div 
    v-else-if="props.type === 'table'" 
    class="animate-pulse"
  >
    <div 
      class="h-10 rounded-t-lg mb-px"
      :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
    ></div>
    <div 
      v-for="i in props.rows" 
      :key="i" 
      class="h-14 border-b flex items-center px-4 gap-4"
      :class="themeStore.isDark ? 'bg-gray-900/50 border-gray-800/50' : 'bg-gray-50 border-gray-100'"
    >
      <div 
        class="w-8 h-8 rounded"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
      ></div>
      <div class="flex-1 space-y-1">
        <div 
          class="h-3 rounded w-1/4"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div 
          class="h-2 rounded w-1/6"
          :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
        ></div>
      </div>
      <div 
        class="h-6 rounded w-16"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
      ></div>
      <div 
        class="h-4 rounded w-20"
        :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
      ></div>
    </div>
  </div>

  <!-- 文本骨架屏 -->
  <div 
    v-else-if="props.type === 'text'" 
    class="space-y-2 animate-pulse"
  >
    <div 
      v-for="i in props.lines" 
      :key="i" 
      class="h-4 rounded"
      :class="[
        themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200',
        i === props.lines ? 'w-3/4' : 'w-full'
      ]"
    ></div>
  </div>
</template>

<style scoped>
.skeleton-line {
  @apply rounded animate-pulse;
}

.skeleton-circle {
  @apply rounded-full animate-pulse;
}

.skeleton-dark {
  @apply bg-gray-800;
}

.skeleton-light {
  @apply bg-gray-200;
}
</style>
