<script setup lang="ts">
import { useM3Auth } from '@/composables/useM3Auth'
import { useBrand } from '@/composables/useBrand'

defineProps<{
  title: string
  subtitle?: string
  tone?: 'primary' | 'tertiary' | 'secondary'
}>()

const { ui } = useM3Auth()
const brand = useBrand()
</script>

<template>
  <div class="mx-auto flex w-full max-w-lg flex-col items-center">
    <section class="w-full">
      <div class="mb-8 text-center">
        <img
          :src="brand.brandLogoUrl"
          :alt="brand.brandName"
          class="mx-auto h-14 w-14 rounded-2xl"
        />
        <h1
          class="mt-5 text-3xl font-normal tracking-[-0.02em] sm:text-[2rem] sm:leading-[1.15]"
          :class="ui.title"
        >
          {{ title }}
        </h1>
      </div>

      <slot />

      <div v-if="$slots.after" class="mt-6 text-center">
        <slot name="after" />
      </div>
    </section>
  </div>
</template>
