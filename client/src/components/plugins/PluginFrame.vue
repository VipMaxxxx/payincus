<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { requestPluginAssetToken } from '@/utils/plugin-assets'

interface Props {
  title: string
  url: string
}

const props = defineProps<Props>()
const frameUrl = ref(props.url)

function parsePluginAssetUrl(url: string): { pluginId: string; assetPath: string } | null {
  if (!url.startsWith('/api/plugins/assets/')) return null
  const parsed = new URL(url, window.location.origin)
  const prefix = '/api/plugins/assets/'
  if (!parsed.pathname.startsWith(prefix)) return null

  const rest = parsed.pathname.slice(prefix.length)
  const slashIndex = rest.indexOf('/')
  if (slashIndex <= 0) return null

  return {
    pluginId: decodeURIComponent(rest.slice(0, slashIndex)),
    assetPath: rest.slice(slashIndex + 1)
  }
}

async function refreshFrameUrl(): Promise<void> {
  frameUrl.value = props.url
  const asset = parsePluginAssetUrl(props.url)
  if (!asset) return

  const data = await requestPluginAssetToken(asset)
  if (!data?.assetToken) return

  const separator = props.url.includes('?') ? '&' : '?'
  frameUrl.value = `${props.url}${separator}assetToken=${encodeURIComponent(data.assetToken)}`
}

watch(() => props.url, () => {
  void refreshFrameUrl()
})

onMounted(() => {
  void refreshFrameUrl()
})
</script>

<template>
  <iframe
    class="w-full min-h-[560px] rounded-lg border border-themed bg-themed-surface"
    :src="frameUrl"
    :title="title"
    sandbox="allow-forms allow-scripts allow-same-origin"
    referrerpolicy="same-origin"
  />
</template>
