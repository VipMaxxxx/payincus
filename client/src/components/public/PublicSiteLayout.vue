<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import PublicSiteFooter from '@/components/public/PublicSiteFooter.vue'
import PublicSiteHeader from '@/components/public/PublicSiteHeader.vue'

const route = useRoute()
const themeStore = useThemeStore()

const authRouteNames = new Set(['login', 'register', 'forgot-password'])

const isAuthPage = computed(() => authRouteNames.has(String(route.name || '')))
</script>

<template>
  <div
    class="flex min-h-screen flex-col"
    :class="themeStore.isDark
      ? 'bg-[#111418] text-[#e3e2e6] selection:bg-[#a8c7fa]/30'
      : 'bg-[#fcfcfd] text-[#1a1b20] selection:bg-[#d3e3fd]'"
  >
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-[34rem]"
      :class="themeStore.isDark
        ? 'bg-[linear-gradient(180deg,rgba(26,44,82,0.55)_0%,rgba(26,44,82,0.25)_45%,rgba(17,20,24,0)_100%)]'
        : 'bg-[linear-gradient(180deg,rgba(211,227,253,0.7)_0%,rgba(223,235,254,0.35)_45%,rgba(252,252,253,0)_100%)]'"
    ></div>

    <PublicSiteHeader />

    <main class="relative flex flex-1 flex-col">
      <div
        v-if="isAuthPage"
        class="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
      >
        <slot />
      </div>
      <slot v-else />
    </main>

    <PublicSiteFooter v-if="!isAuthPage" />
  </div>
</template>
