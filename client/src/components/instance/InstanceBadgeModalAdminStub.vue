<script setup lang="ts">
defineOptions({ inheritAttrs: false })
defineEmits<{
  (e: 'close'): void
  (e: 'updated'): void
}>()
</script>

<template>
  <span v-if="false" aria-hidden="true" />
</template>
