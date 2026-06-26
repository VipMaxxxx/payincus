<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import PluginFrame from '@/components/plugins/PluginFrame.vue'
import type { PluginClientExtension } from '@/types/api'

const props = defineProps<{
  slotName: string
  surface?: 'user' | 'admin'
  frameClass?: string
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
  <div v-if="!loading && visibleExtensions.length > 0" class="grid gap-4 md:grid-cols-2">
    <section
      v-for="extension in visibleExtensions"
      :key="`${extension.pluginId}:${extension.slot}:${extension.url}`"
      class="rounded-lg border border-themed bg-themed-surface p-3"
    >
      <div class="mb-3 min-w-0">
        <h2 class="truncate text-sm font-semibold text-themed">{{ extension.title }}</h2>
        <p class="mt-0.5 truncate text-xs text-themed-muted">{{ extension.pluginName }} · {{ extension.version || '-' }}</p>
      </div>
      <PluginFrame :title="extension.title" :url="extension.url" :frame-class="frameClass || 'min-h-[240px]'" />
    </section>
  </div>
</template>
