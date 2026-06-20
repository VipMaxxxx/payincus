<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/stores/toast'

const props = withDefaults(defineProps<{
  modelValue: File[]
  disabled?: boolean
  maxFiles?: number
}>(), {
  disabled: false,
  maxFiles: 6
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: File[]): void
}>()

const { t } = useI18n()
const toast = useToast()
const inputRef = ref<HTMLInputElement | null>(null)
const previewUrls = ref<string[]>([])

const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
])
const MAX_FILE_SIZE = 50 * 1024 * 1024

function revokePreviewUrls(): void {
  for (const url of previewUrls.value) {
    URL.revokeObjectURL(url)
  }
  previewUrls.value = []
}

watch(() => props.modelValue, files => {
  revokePreviewUrls()
  previewUrls.value = files.map(file => URL.createObjectURL(file))
}, { immediate: true })

onBeforeUnmount(() => {
  revokePreviewUrls()
})

const remainingSlots = computed(() => Math.max(props.maxFiles - props.modelValue.length, 0))

function openPicker(): void {
  inputRef.value?.click()
}

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function removeFile(index: number): void {
  const nextFiles = [...props.modelValue]
  nextFiles.splice(index, 1)
  emit('update:modelValue', nextFiles)
}

function handleFileChange(event: Event): void {
  const target = event.target as HTMLInputElement
  const selectedFiles = Array.from(target.files || [])
  if (selectedFiles.length === 0) {
    return
  }

  const nextFiles = [...props.modelValue]

  for (const file of selectedFiles) {
    if (nextFiles.length >= props.maxFiles) {
      toast.error(t('tickets.images.maxReached', { count: props.maxFiles }))
      break
    }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      toast.error(t('tickets.images.invalidType'))
      continue
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t('tickets.images.fileTooLarge', { size: 50 }))
      continue
    }
    nextFiles.push(file)
  }

  emit('update:modelValue', nextFiles)
  target.value = ''
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <div>
        <p class="text-sm font-medium text-gray-900 dark:text-white">
          {{ t('tickets.images.label') }}
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ t('tickets.images.hint', { count: props.maxFiles, size: 50 }) }}
        </p>
      </div>
      <button
        type="button"
        class="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        :disabled="props.disabled || remainingSlots === 0"
        @click="openPicker"
      >
        {{ t('tickets.images.add') }}
      </button>
      <input
        ref="inputRef"
        type="file"
        hidden
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        :disabled="props.disabled"
        @change="handleFileChange"
      >
    </div>

    <div v-if="props.modelValue.length > 0" class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div
        v-for="(file, index) in props.modelValue"
        :key="`${file.name}-${file.size}-${index}`"
        class="group relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
      >
        <img
          :src="previewUrls[index]"
          :alt="file.name"
          class="h-32 w-full object-cover"
        >
        <button
          type="button"
          class="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
          :title="t('tickets.images.remove')"
          @click="removeFile(index)"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div class="space-y-1 p-2">
          <p class="truncate text-xs font-medium text-gray-900 dark:text-white">
            {{ file.name }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ formatFileSize(file.size) }}
          </p>
        </div>
      </div>
    </div>

    <p v-if="props.modelValue.length > 0" class="text-xs text-gray-500 dark:text-gray-400">
      {{ t('tickets.images.selected', { count: props.modelValue.length, max: props.maxFiles }) }}
    </p>
  </div>
</template>
