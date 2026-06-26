<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import api from '@/api'
import { requestPluginAssetToken } from '@/utils/plugin-assets'

interface Props {
  title: string
  url: string
  frameClass?: string
}

const props = defineProps<Props>()
const frameUrl = ref(props.url)
const frameRef = ref<HTMLIFrameElement | null>(null)

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

function currentPluginAsset(): { pluginId: string; assetPath: string } | null {
  return parsePluginAssetUrl(props.url)
}

function postPluginConfig(pluginId: string, config: Record<string, unknown>): void {
  frameRef.value?.contentWindow?.postMessage({
    type: 'payincus:plugin-config',
    pluginId,
    config,
    updatedAt: new Date().toISOString()
  }, window.location.origin)
}

async function refreshPluginConfig(): Promise<void> {
  const asset = currentPluginAsset()
  if (!asset) return
  try {
    const response = await api.plugins.getPublicConfig(asset.pluginId)
    postPluginConfig(asset.pluginId, response.config)
  } catch {
    postPluginConfig(asset.pluginId, {})
  }
}

function handlePluginConfigRefresh(event: Event): void {
  const asset = currentPluginAsset()
  if (!asset) return
  const detail = (event as CustomEvent<{ pluginId?: string }>).detail
  if (detail?.pluginId && detail.pluginId !== asset.pluginId) return
  void refreshPluginConfig()
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
  void refreshPluginConfig()
})

onMounted(() => {
  void refreshFrameUrl()
  void refreshPluginConfig()
  window.addEventListener('payincus:plugin-config-refresh', handlePluginConfigRefresh)
})

onBeforeUnmount(() => {
  window.removeEventListener('payincus:plugin-config-refresh', handlePluginConfigRefresh)
})
</script>

<template>
  <iframe
    ref="frameRef"
    :class="['w-full rounded-lg border border-themed bg-themed-surface', frameClass || 'min-h-[560px]']"
    :src="frameUrl"
    :title="title"
    sandbox="allow-forms allow-scripts allow-same-origin"
    referrerpolicy="same-origin"
    @load="refreshPluginConfig"
  />
</template>
