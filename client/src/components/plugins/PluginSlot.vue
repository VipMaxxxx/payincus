<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import api from '@/api'
import type { PluginClientExtension } from '@/types/api'

const props = defineProps<{
  slotName: string
  collapsed?: boolean
  surface?: 'user' | 'admin'
}>()

const loading = ref(false)
const extensions = ref<PluginClientExtension[]>([])

const visibleExtensions = computed(() =>
  extensions.value.filter(extension => extension.slot === props.slotName)
)

onMounted(async () => {
  loading.value = true
  try {
    const response = props.surface === 'admin'
      ? await api.plugins.getEnabledAdminClientExtensions()
      : await api.plugins.getEnabledClientExtensions()
    extensions.value = response.extensions
  } catch {
    extensions.value = []
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div v-if="!loading && visibleExtensions.length > 0" class="space-y-0.5">
    <RouterLink
      v-for="extension in visibleExtensions"
      :key="`${extension.pluginId}:${extension.slot}:${extension.path || extension.url}`"
      :to="extension.path || `/plugins/${extension.pluginId}`"
      class="flex items-center rounded px-2 py-1.5 text-sm text-themed-muted hover:bg-gray-100 hover:text-themed dark:hover:bg-gray-900"
      :class="collapsed ? 'justify-center' : 'gap-2.5'"
    >
      <span class="h-4 w-4 rounded border border-themed text-[10px] leading-4 text-center">P</span>
      <span v-if="!collapsed">{{ extension.title }}</span>
    </RouterLink>
  </div>
</template>
