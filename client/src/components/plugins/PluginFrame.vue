<script setup lang="ts">
interface Props {
  title: string
  url: string
}

defineProps<Props>()
</script>

<template>
  <iframe
    class="w-full min-h-[560px] rounded-lg border border-themed bg-themed-surface"
    :src="url"
    :title="title"
    sandbox="allow-forms allow-scripts allow-same-origin"
    referrerpolicy="same-origin"
  />
</template>
