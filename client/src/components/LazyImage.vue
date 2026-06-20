<script setup lang="ts">
/**
 * 懒加载图片组件
 * 使用 IntersectionObserver 实现真正的懒加载
 * 支持占位符、加载状态和错误处理
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'

interface Props {
  src: string
  alt?: string
  placeholder?: string  // 占位符图片或 base64
  width?: number | string
  height?: number | string
  class?: string
  rootMargin?: string  // 预加载距离
}

const props = withDefaults(defineProps<Props>(), {
  alt: '',
  placeholder: '',
  rootMargin: '200px'  // 提前 200px 开始加载
})

const imgRef = ref<HTMLImageElement | null>(null)
const isLoaded = ref(false)
const hasError = ref(false)
const isVisible = ref(false)

let observer: IntersectionObserver | null = null

function handleLoad() {
  isLoaded.value = true
}

function handleError() {
  hasError.value = true
}

function setupObserver() {
  if (!imgRef.value || typeof IntersectionObserver === 'undefined') {
    // 不支持 IntersectionObserver 时直接加载
    isVisible.value = true
    return
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        isVisible.value = true
        observer?.disconnect()
      }
    },
    { rootMargin: props.rootMargin }
  )

  observer.observe(imgRef.value)
}

onMounted(() => {
  setupObserver()
})

onUnmounted(() => {
  observer?.disconnect()
})

// 当 src 变化时重置状态
watch(() => props.src, () => {
  isLoaded.value = false
  hasError.value = false
})
</script>

<template>
  <img
    ref="imgRef"
    :src="isVisible ? src : placeholder"
    :alt="alt"
    :width="width"
    :height="height"
    :class="[
      props.class,
      {
        'opacity-0': !isLoaded && isVisible,
        'transition-opacity duration-300': true
      }
    ]"
    @load="handleLoad"
    @error="handleError"
  />
</template>
