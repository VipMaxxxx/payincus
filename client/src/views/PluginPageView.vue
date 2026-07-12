<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import api from '@/api'
import PluginFrame from '@/components/plugins/PluginFrame.vue'
import type { PluginClientExtension } from '@/types/api'
import { dashboardPath } from '@/utils/app-paths'

const route = useRoute()
const loading = ref(true)
const extensions = ref<PluginClientExtension[]>([])

const currentExtension = computed(() => {
  const path = route.path
  return extensions.value.find(extension => extension.path === path) || null
})

onMounted(async () => {
  try {
    const response = await api.plugins.getEnabledClientExtensions()
    extensions.value = response.extensions
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="kawaii-page space-y-6 animate-fade-in">
    <div v-if="loading" class="py-16 text-center text-themed-muted">加载中...</div>

    <template v-else-if="currentExtension">
      <div class="kawaii-dashboard-hero page-header rounded-2xl p-5">
        <div>
          <h1 class="page-title text-lg sm:text-xl">{{ currentExtension.title }}</h1>
          <p class="page-description">{{ currentExtension.pluginName }} · {{ currentExtension.version || '-' }}</p>
        </div>
      </div>
      <PluginFrame :title="currentExtension.title" :url="currentExtension.url" />
    </template>

    <div v-else class="card mx-auto max-w-md p-8 text-center">
      <span class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-themed-secondary text-themed-faint">
        <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 7h5a2 2 0 0 1 2 2v5" /><path d="M10 21H5a2 2 0 0 1-2-2v-5" /><path d="M3 10V5a2 2 0 0 1 2-2h4" /><path d="m3 3 18 18" /></svg>
      </span>
      <h1 class="text-xl font-semibold text-themed">插件不可用</h1>
      <p class="mt-2 text-sm text-themed-muted">该插件页面未启用，或当前账号无权访问。</p>
      <RouterLink :to="dashboardPath()" class="btn-primary mt-5 inline-flex">返回控制台</RouterLink>
    </div>
  </div>
</template>
