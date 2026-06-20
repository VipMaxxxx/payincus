<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
</script>

<template>
  <div 
    class="min-h-screen flex items-center justify-center"
    :class="themeStore.isDark ? 'bg-[#0a0a0a]' : 'bg-white'"
  >
    <div class="text-center">
      <h1 
        class="text-8xl font-bold"
        :class="themeStore.isDark ? 'text-gray-800' : 'text-gray-200'"
      >
        404
      </h1>
      <p 
        class="mt-4"
        :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-600'"
      >
        {{ $t('error.notFound') }}
      </p>
      <RouterLink to="/" class="btn-secondary mt-6 inline-block">{{ $t('error.backHome') }}</RouterLink>
    </div>
  </div>
</template>
