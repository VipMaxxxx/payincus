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
  <div class="p-6 space-y-6">
    <div v-if="loading" class="py-16 text-center text-themed-muted">加载中...</div>

    <template v-else-if="currentExtension">
      <div>
        <h1 class="text-2xl font-semibold text-themed">{{ currentExtension.title }}</h1>
        <p class="mt-1 text-sm text-themed-muted">{{ currentExtension.pluginName }} · {{ currentExtension.version || '-' }}</p>
      </div>
      <PluginFrame :title="currentExtension.title" :url="currentExtension.url" />
    </template>

    <div v-else class="card p-8 text-center">
      <h1 class="text-xl font-semibold text-themed">插件不可用</h1>
      <p class="mt-2 text-sm text-themed-muted">该插件页面未启用，或当前账号无权访问。</p>
      <RouterLink to="/dashboard" class="btn-primary mt-5 inline-flex">返回控制台</RouterLink>
    </div>
  </div>
</template>
