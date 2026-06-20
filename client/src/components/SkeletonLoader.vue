<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

interface Props {
  type?: 'default' | 'card' | 'table' | 'list' | 'detail' | 'stats' | 'form' | 'grid'
  rows?: number
  cols?: number  // 用于 grid 类型
}

withDefaults(defineProps<Props>(), {
  type: 'default',
  rows: 3,
  cols: 3
})
</script>

<template>
  <!-- 默认骨架屏 -->
  <div v-if="type === 'default'" class="animate-pulse space-y-3">
    <div 
      class="h-4 rounded w-3/4"
      :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
    ></div>
    <div 
      class="h-4 rounded w-1/2"
      :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
    ></div>
    <div 
      class="h-4 rounded w-5/6"
      :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
    ></div>
  </div>

  <!-- 卡片骨架屏 -->
  <div v-else-if="type === 'card'" class="card p-5 animate-pulse">
    <div class="flex items-start justify-between mb-4">
      <div class="flex items-center gap-3">
        <div 
          class="w-10 h-10 rounded-lg"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div class="space-y-2">
          <div 
            class="h-4 rounded w-24"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
          ></div>
          <div 
            class="h-3 rounded w-16"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
          ></div>
        </div>
      </div>
      <div 
        class="h-6 rounded w-16"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
      ></div>
    </div>
    <div class="space-y-2">
      <div 
        class="h-3 rounded w-full"
        :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
      ></div>
      <div 
        class="h-3 rounded w-4/5"
        :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
      ></div>
    </div>
  </div>

  <!-- 表格骨架屏 -->
  <div v-else-if="type === 'table'" class="animate-pulse">
    <div 
      class="h-10 rounded-t-lg mb-px"
      :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
    ></div>
    <div 
      v-for="i in rows" 
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

  <!-- 列表骨架屏 -->
  <div v-else-if="type === 'list'" class="space-y-3 animate-pulse">
    <div 
      v-for="i in rows" 
      :key="i" 
      class="flex items-center gap-3 p-3 rounded-lg"
      :class="themeStore.isDark ? 'bg-gray-900/50' : 'bg-gray-50'"
    >
      <div 
        class="w-10 h-10 rounded-lg"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
      ></div>
      <div class="flex-1 space-y-2">
        <div 
          class="h-4 rounded w-1/3"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div 
          class="h-3 rounded w-1/4"
          :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
        ></div>
      </div>
      <div 
        class="h-8 rounded w-16"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
      ></div>
    </div>
  </div>

  <!-- 详情页骨架屏 -->
  <div v-else-if="type === 'detail'" class="animate-pulse space-y-6">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <div 
          class="w-12 h-12 rounded-xl"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div class="space-y-2">
          <div 
            class="h-6 rounded w-40"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
          ></div>
          <div 
            class="h-4 rounded w-24"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
          ></div>
        </div>
      </div>
      <div class="flex gap-2">
        <div 
          class="h-9 rounded w-20"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div 
          class="h-9 rounded w-20"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
      </div>
    </div>
    
    <!-- 内容卡片 -->
    <div class="grid grid-cols-3 gap-4">
      <div v-for="i in 3" :key="i" class="card p-5 space-y-3">
        <div 
          class="h-4 rounded w-1/3"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div 
          class="h-8 rounded w-2/3"
          :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
        ></div>
      </div>
    </div>
    
    <!-- 主要内容 -->
    <div class="grid grid-cols-2 gap-6">
      <div class="card p-5 space-y-4">
        <div 
          class="h-4 rounded w-1/4"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div v-for="i in 4" :key="i" class="flex justify-between">
          <div 
            class="h-3 rounded w-1/4"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
          ></div>
          <div 
            class="h-3 rounded w-1/3"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
          ></div>
        </div>
      </div>
      <div class="card p-5 space-y-4">
        <div 
          class="h-4 rounded w-1/4"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div v-for="i in 4" :key="i" class="flex justify-between">
          <div 
            class="h-3 rounded w-1/4"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
          ></div>
          <div 
            class="h-3 rounded w-1/3"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
          ></div>
        </div>
      </div>
    </div>
  </div>

  <!-- 统计卡片骨架屏 -->
  <div v-else-if="type === 'stats'" class="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 animate-pulse">
    <div 
      v-for="i in 4" 
      :key="i" 
      class="card p-4"
    >
      <div class="flex items-center gap-3">
        <div 
          class="w-10 h-10 rounded-lg"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div class="flex-1 space-y-2">
          <div 
            class="h-3 rounded w-16"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
          ></div>
          <div 
            class="h-6 rounded w-12"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
          ></div>
        </div>
      </div>
    </div>
  </div>

  <!-- 表单骨架屏 -->
  <div v-else-if="type === 'form'" class="card p-5 space-y-4 animate-pulse">
    <div v-for="i in rows" :key="i" class="space-y-2">
      <div 
        class="h-3 rounded w-24"
        :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
      ></div>
      <div 
        class="h-10 rounded w-full"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
      ></div>
    </div>
    <div class="flex justify-end gap-2 pt-4">
      <div 
        class="h-9 rounded w-20"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
      ></div>
      <div 
        class="h-9 rounded w-24"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
      ></div>
    </div>
  </div>

  <!-- 网格卡片骨架屏 -->
  <div v-else-if="type === 'grid'" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
    <div 
      v-for="i in (rows * cols)" 
      :key="i" 
      class="card p-4"
    >
      <div class="flex items-start gap-3">
        <div 
          class="w-10 h-10 rounded-full flex-shrink-0"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
        ></div>
        <div class="flex-1 space-y-2">
          <div 
            class="h-4 rounded w-2/3"
            :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
          ></div>
          <div 
            class="h-3 rounded w-1/2"
            :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
          ></div>
        </div>
      </div>
      <div class="flex gap-2 mt-4">
        <div 
          class="h-8 rounded flex-1"
          :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
        ></div>
        <div 
          class="h-8 rounded flex-1"
          :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'"
        ></div>
      </div>
    </div>
  </div>
</template>
