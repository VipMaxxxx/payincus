<script setup lang="ts">
withDefaults(defineProps<{
  name: 'wallet' | 'chart' | 'store' | 'cloud' | 'server' | 'pulse' | 'ban' | 'clock' | 'sparkles'
  strokeWidth?: number
}>(), {
  strokeWidth: 1.8
})
</script>

<template>
  <svg
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    aria-hidden="true"
  >
    <template v-if="name === 'wallet'">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5V9h-2.5a3.5 3.5 0 1 0 0 7H19v.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 3 16.5v-9Z"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M19 9h-2.5a3.5 3.5 0 0 0 0 7H19V9Z"
      />
      <circle cx="16.5" cy="12.5" r="0.75" fill="currentColor" />
    </template>

    <template v-else-if="name === 'chart'">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M4 19h16"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M7 15.5V10"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M12 15.5V6"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M17 15.5v-3"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M6 7.5 10 10l4-5 4 2"
      />
    </template>

    <template v-else-if="name === 'store'">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M4 10.5V8.8c0-.6.2-1.1.6-1.6l1.9-2.4c.4-.5 1-.8 1.6-.8h8c.6 0 1.2.3 1.6.8l1.9 2.4c.4.4.6 1 .6 1.6v1.7"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M5 10.5c0 1.4 1.1 2.5 2.5 2.5S10 11.9 10 10.5c0 1.4 1.1 2.5 2.5 2.5S15 11.9 15 10.5c0 1.4 1.1 2.5 2.5 2.5S20 11.9 20 10.5"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M6 13v6h12v-6"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M10 19v-3.5c0-.6.4-1 1-1h2c.6 0 1 .4 1 1V19"
      />
    </template>

    <template v-else-if="name === 'cloud'">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M7.5 18h8.75a3.75 3.75 0 0 0 .5-7.47A5.5 5.5 0 0 0 6.18 8.6 4.25 4.25 0 0 0 7.5 18Z"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="m10 12 2-2 2 2"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M12 10v6"
      />
    </template>

    <template v-else-if="name === 'server'">
      <rect x="4" y="4" width="16" height="6" rx="2" :stroke-width="strokeWidth" />
      <rect x="4" y="14" width="16" height="6" rx="2" :stroke-width="strokeWidth" />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M8 7h.01M8 17h.01M12 7h6M12 17h6"
      />
    </template>

    <template v-else-if="name === 'pulse'">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M3 12h4l2.2-5 3.6 10 2.2-5H21"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M4.5 18h15"
      />
    </template>

    <template v-else-if="name === 'ban'">
      <circle cx="12" cy="12" r="8" :stroke-width="strokeWidth" />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="m8.5 8.5 7 7"
      />
    </template>

    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="8" :stroke-width="strokeWidth" />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="M12 8v4l2.5 1.5"
      />
    </template>

    <template v-else-if="name === 'sparkles'">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="m12 3 1.4 3.9L17 8.3l-3.6 1.3L12 13.5l-1.4-3.9L7 8.3l3.6-1.4L12 3Z"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="m18.5 13 1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-width="strokeWidth"
        d="m5.5 14 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"
      />
    </template>
  </svg>
</template>
