<script setup lang="ts">
defineOptions({ inheritAttrs: false })
defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'destroy'): void
}>()
</script>

<template>
  <span v-if="false" aria-hidden="true" />
</template>
