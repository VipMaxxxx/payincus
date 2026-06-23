<script setup lang="ts">
defineProps<{
  show: boolean
  instance?: unknown
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'success'): void
}>()
</script>

<template>
  <span v-if="false" aria-hidden="true" />
</template>
