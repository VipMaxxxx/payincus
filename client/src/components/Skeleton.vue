<script setup lang="ts">
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

const skeletonBlock = 'kawaii-skeleton'
const skeletonSoft = 'kawaii-skeleton opacity-70'
const skeletonPanel = 'kawaii-card-soft border-themed'
</script>

<template>
  <!-- 线条骨架屏 -->
  <div 
    v-if="props.type === 'line'" 
    :class="['skeleton-line', skeletonBlock]"
    :style="{ width: props.width, height: props.height }"
  ></div>

  <!-- 圆形骨架屏 -->
  <div 
    v-else-if="props.type === 'circle'" 
    :class="['skeleton-circle', skeletonBlock]"
    :style="{ width: props.size, height: props.size }"
  ></div>

  <!-- 卡片骨架屏 -->
  <div 
    v-else-if="props.type === 'card'" 
    class="card p-5 animate-pulse"
  >
    <div class="flex items-center justify-between mb-4">
      <div class="h-5 rounded w-1/3" :class="skeletonBlock"></div>
      <div class="h-5 rounded w-14" :class="skeletonBlock"></div>
    </div>
    <div class="h-3 rounded w-3/4 mb-4" :class="skeletonSoft"></div>
    <div class="grid grid-cols-2 gap-3">
      <div v-for="j in 4" :key="j" class="space-y-1">
        <div class="h-3 rounded w-1/2" :class="skeletonSoft"></div>
        <div class="h-4 rounded w-2/3" :class="skeletonBlock"></div>
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
      :class="skeletonSoft"
    ></div>
    <div 
      v-for="i in props.rows" 
      :key="i" 
      class="h-14 border-b flex items-center px-4 gap-4"
      :class="skeletonPanel"
    >
      <div 
        class="w-8 h-8 rounded"
        :class="skeletonBlock"
      ></div>
      <div class="flex-1 space-y-1">
        <div 
          class="h-3 rounded w-1/4"
          :class="skeletonBlock"
        ></div>
        <div 
          class="h-2 rounded w-1/6"
          :class="skeletonSoft"
        ></div>
      </div>
      <div 
        class="h-6 rounded w-16"
        :class="skeletonBlock"
      ></div>
      <div 
        class="h-4 rounded w-20"
        :class="skeletonSoft"
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
        skeletonBlock,
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

</style>
