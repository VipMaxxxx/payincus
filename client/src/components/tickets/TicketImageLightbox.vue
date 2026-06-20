<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

interface LightboxImage {
  id: number
  src: string
  alt: string
}

const props = defineProps<{
  show: boolean
  images: LightboxImage[]
  startIndex: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
const currentIndex = ref(0)
const zoom = ref(1)
const touchStartX = ref<number | null>(null)

const currentImage = computed(() => props.images[currentIndex.value] ?? null)

function resetZoom(): void {
  zoom.value = 1
}

function closeLightbox(): void {
  emit('close')
}

function goTo(index: number): void {
  if (props.images.length === 0) return
  const wrappedIndex = (index + props.images.length) % props.images.length
  currentIndex.value = wrappedIndex
  resetZoom()
}

function goNext(): void {
  goTo(currentIndex.value + 1)
}

function goPrevious(): void {
  goTo(currentIndex.value - 1)
}

function zoomIn(): void {
  zoom.value = Math.min(zoom.value + 0.25, 4)
}

function zoomOut(): void {
  zoom.value = Math.max(zoom.value - 0.25, 1)
}

function handleWheel(event: WheelEvent): void {
  if (event.deltaY < 0) {
    zoomIn()
  } else {
    zoomOut()
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.show) return

  if (event.key === 'Escape') {
    closeLightbox()
  } else if (event.key === 'ArrowRight') {
    goNext()
  } else if (event.key === 'ArrowLeft') {
    goPrevious()
  } else if (event.key === '+') {
    zoomIn()
  } else if (event.key === '-') {
    zoomOut()
  }
}

function handleTouchStart(event: TouchEvent): void {
  touchStartX.value = event.changedTouches[0]?.clientX ?? null
}

function handleTouchEnd(event: TouchEvent): void {
  const endX = event.changedTouches[0]?.clientX ?? null
  if (touchStartX.value === null || endX === null) {
    touchStartX.value = null
    return
  }

  const deltaX = endX - touchStartX.value
  if (Math.abs(deltaX) > 50) {
    if (deltaX < 0) {
      goNext()
    } else {
      goPrevious()
    }
  }
  touchStartX.value = null
}

watch(() => props.show, show => {
  if (show) {
    currentIndex.value = Math.min(Math.max(props.startIndex, 0), Math.max(props.images.length - 1, 0))
    resetZoom()
    window.addEventListener('keydown', handleKeydown)
    return
  }

  window.removeEventListener('keydown', handleKeydown)
})

watch(() => props.startIndex, value => {
  if (props.show) {
    currentIndex.value = Math.min(Math.max(value, 0), Math.max(props.images.length - 1, 0))
    resetZoom()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Transition name="modal">
    <div
      v-if="show"
      class="fixed inset-0 z-[80] flex flex-col bg-black/90"
      @click.self="closeLightbox"
    >
      <div class="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div class="text-sm">
          {{ currentIndex + 1 }} / {{ images.length }}
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20" :title="t('tickets.images.zoomOut')" @click="zoomOut">
            -
          </button>
          <button type="button" class="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20" :title="t('tickets.images.resetZoom')" @click="resetZoom">
            100%
          </button>
          <button type="button" class="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20" :title="t('tickets.images.zoomIn')" @click="zoomIn">
            +
          </button>
          <button type="button" class="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20" :title="t('common.close')" @click="closeLightbox">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div class="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-4" @wheel.prevent="handleWheel">
        <button
          v-if="images.length > 1"
          type="button"
          class="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
          :title="t('common.previous')"
          @click.stop="goPrevious"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div
          class="flex h-full w-full items-center justify-center overflow-hidden"
          @touchstart.passive="handleTouchStart"
          @touchend.passive="handleTouchEnd"
        >
          <img
            v-if="currentImage"
            :src="currentImage.src"
            :alt="currentImage.alt"
            class="max-h-full max-w-full select-none object-contain transition-transform duration-200"
            :style="{ transform: `scale(${zoom})` }"
            draggable="false"
          >
        </div>

        <button
          v-if="images.length > 1"
          type="button"
          class="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
          :title="t('common.next')"
          @click.stop="goNext"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div v-if="images.length > 1" class="flex gap-2 overflow-x-auto px-4 pb-4">
        <button
          v-for="(image, index) in images"
          :key="image.id"
          type="button"
          class="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-colors"
          :class="index === currentIndex ? 'border-white' : 'border-transparent opacity-70'"
          @click="goTo(index)"
        >
          <img :src="image.src" :alt="image.alt" class="h-full w-full object-cover">
        </button>
      </div>
    </div>
  </Transition>
</template>
