<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{
  slotName: string
  containerClass?: string
}>()

const themeStore = useThemeStore()
const html = ref('')
const loading = ref(false)
const failed = ref(false)
let controller: AbortController | null = null

const templateUrl = computed(() => themeStore.getActiveThemeTemplateUrl(props.slotName))
const shouldRender = computed(() => !!templateUrl.value && !!html.value && !failed.value)

async function loadTemplate(): Promise<void> {
  const url = templateUrl.value
  html.value = ''
  failed.value = false
  if (!url) return

  controller?.abort()
  controller = new AbortController()
  loading.value = true
  try {
    const response = await fetch(url, {
      headers: { Accept: 'text/html' },
      credentials: 'include',
      signal: controller.signal
    })
    if (!response.ok) {
      failed.value = true
      return
    }
    html.value = await response.text()
  } catch (error) {
    if ((error as Error).name !== 'AbortError') failed.value = true
  } finally {
    loading.value = false
  }
}

watch(templateUrl, () => {
  void loadTemplate()
})

onMounted(() => {
  void loadTemplate()
})

onUnmounted(() => {
  controller?.abort()
})
</script>

<template>
  <div
    v-if="shouldRender"
    :class="['theme-template-slot', containerClass]"
    :data-theme-slot="slotName"
    v-html="html"
  />
</template>
