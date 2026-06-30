<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { useBadgeStore } from '@/stores/badges'

const props = withDefaults(defineProps<{
  badgeId: string
  size?: number
  alt?: string
  variant?: 'avatar' | 'icon' | 'plain'
}>(), {
  size: 32,
  alt: '',
  variant: 'icon'
})

const themeStore = useThemeStore()
const badgeStore = useBadgeStore()
const imageErrored = ref(false)

onMounted(() => {
  badgeStore.ensureBadge(props.badgeId)
})

watch(() => props.badgeId, (badgeId) => {
  imageErrored.value = false
  badgeStore.ensureBadge(badgeId)
})

watch(() => themeStore.isDark, () => {
  imageErrored.value = false
})

const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`
}))

const roundedClass = computed(() => {
  if (props.variant === 'avatar') return 'rounded-full'
  if (props.variant === 'icon') return 'rounded-xl'
  return ''
})

const badgeUrl = computed(() => {
  if (imageErrored.value) {
    return `/badges/${themeStore.isDark ? 'dark' : 'light'}/ignition.svg`
  }

  const badge = badgeStore.getBadge(props.badgeId)
  if (badge) {
    if (themeStore.isDark) {
      return badge.assetUrlDark || badge.assetUrl || `/badges/dark/${props.badgeId}.svg`
    }
    return badge.assetUrlLight || badge.assetUrl || `/badges/light/${props.badgeId}.svg`
  }

  return `/badges/${themeStore.isDark ? 'dark' : 'light'}/${props.badgeId}.svg`
})
</script>

<template>
  <img
    :src="badgeUrl"
    :alt="alt || badgeId"
    loading="lazy"
    class="object-contain shrink-0"
    :class="roundedClass"
    :style="sizeStyle"
    @error="imageErrored = true"
  />
</template>
