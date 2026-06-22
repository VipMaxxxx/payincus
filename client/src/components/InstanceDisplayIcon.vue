<script setup lang="ts">
import BadgeImage from '@/components/BadgeImage.vue'

withDefaults(defineProps<{
  badgeId?: string | null
  fallbackIcon?: 'pro' | 'prime' | 'peer' | null
  size?: number
  alt?: string
}>(), {
  badgeId: null,
  fallbackIcon: null,
  size: 32,
  alt: ''
})
</script>

<template>
  <BadgeImage
    v-if="badgeId"
    :badge-id="badgeId"
    :alt="alt || badgeId"
    :size="size"
    variant="icon"
  />
  <img
    v-else-if="fallbackIcon"
    :src="`/icons/${fallbackIcon}.svg`"
    :alt="alt || fallbackIcon"
    class="rounded-xl shrink-0"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>
