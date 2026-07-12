<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import api from '@/api'
import PluginFrame from '@/components/plugins/PluginFrame.vue'
import type { PluginClientExtension } from '@/types/api'

const route = useRoute()
const loading = ref(true)
const extensions = ref<PluginClientExtension[]>([])

const currentExtension = computed(() => {
  const path = route.path
  return extensions.value.find(extension => {
    if (extension.path === path) return true
    if (!extension.path) return false
    try {
      return decodeURIComponent(extension.path) === path
    } catch {
      return false
    }
  }) || null
})

onMounted(async () => {
  try {
    const response = await api.plugins.getEnabledAdminClientExtensions()
    extensions.value = response.extensions
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="kawaii-page p-6 space-y-6 animate-fade-in">
    <div v-if="loading" class="flex items-center justify-center gap-2 py-16 text-sm text-themed-muted">
      <svg class="plugin-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      加载中...
    </div>

    <template v-else-if="currentExtension">
      <div>
        <h1 class="text-2xl font-semibold tracking-[-0.02em] text-themed">{{ currentExtension.title }}</h1>
        <p class="mt-1 text-sm tabular-nums text-themed-muted">{{ currentExtension.pluginName }} · {{ currentExtension.version || '-' }}</p>
      </div>
      <PluginFrame :title="currentExtension.title" :url="currentExtension.url" />
    </template>

    <div v-else class="card p-8 text-center">
      <span class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-themed-secondary text-themed-muted">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M12 9v3.75m0 3.75h.008M10.34 3.94 1.9 18.06A1.5 1.5 0 0 0 3.2 20.3h17.6a1.5 1.5 0 0 0 1.3-2.24L13.66 3.94a1.5 1.5 0 0 0-2.6 0Z" />
        </svg>
      </span>
      <h1 class="text-xl font-semibold tracking-[-0.01em] text-themed">扩展页面不可用</h1>
      <p class="mt-2 text-sm text-themed-muted">该后台扩展页面未启用，或当前账号无权访问。</p>
      <RouterLink to="/admin/plugins" class="btn-primary mt-5 inline-flex">返回扩展中心</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.plugin-spin {
  animation: pluginSpin 0.7s linear infinite;
}

@keyframes pluginSpin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .plugin-spin {
    animation: none;
  }
}
</style>
