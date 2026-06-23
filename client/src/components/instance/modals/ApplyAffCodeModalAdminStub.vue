<script setup lang="ts">
defineOptions({ inheritAttrs: false })
defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'success'): void
}>()
</script>

<template>
  <span v-if="false" aria-hidden="true" />
</template>
