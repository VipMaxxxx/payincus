<script setup lang="ts">
/**
 * 虚拟滚动列表组件
 * 用于高效渲染大量数据，只渲染可见区域的项目
 * 
 * 使用示例：
 * <VirtualList :items="items" :item-height="60" v-slot="{ item }">
 *   <div>{{ item.name }}</div>
 * </VirtualList>
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

interface Props {
  items: any[]
  itemHeight: number  // 每项固定高度
  bufferSize?: number // 缓冲区大小（上下各渲染多少额外项）
  containerClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  bufferSize: 5,
  containerClass: ''
})

const containerRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const containerHeight = ref(0)

// 总高度
const totalHeight = computed(() => props.items.length * props.itemHeight)

// 计算可见范围
const visibleRange = computed(() => {
  const start = Math.floor(scrollTop.value / props.itemHeight)
  const visibleCount = Math.ceil(containerHeight.value / props.itemHeight)
  
  const startIndex = Math.max(0, start - props.bufferSize)
  const endIndex = Math.min(props.items.length, start + visibleCount + props.bufferSize)
  
  return { startIndex, endIndex }
})

// 可见项
const visibleItems = computed(() => {
  const { startIndex, endIndex } = visibleRange.value
  return props.items.slice(startIndex, endIndex).map((item, index) => ({
    item,
    index: startIndex + index,
    style: {
      position: 'absolute' as const,
      top: `${(startIndex + index) * props.itemHeight}px`,
      height: `${props.itemHeight}px`,
      width: '100%'
    }
  }))
})

// 偏移量样式
const spacerStyle = computed(() => ({
  height: `${totalHeight.value}px`,
  position: 'relative' as const
}))

function handleScroll(e: Event) {
  const target = e.target as HTMLElement
  scrollTop.value = target.scrollTop
}

function updateContainerHeight() {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  updateContainerHeight()
  
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(updateContainerHeight)
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

// 当 items 变化时重置滚动位置
watch(() => props.items.length, () => {
  if (containerRef.value) {
    containerRef.value.scrollTop = 0
    scrollTop.value = 0
  }
})

// 暴露方法供外部调用
defineExpose({
  scrollToIndex(index: number) {
    if (containerRef.value) {
      containerRef.value.scrollTop = index * props.itemHeight
    }
  },
  scrollToTop() {
    if (containerRef.value) {
      containerRef.value.scrollTop = 0
    }
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="overflow-auto"
    :class="containerClass"
    @scroll="handleScroll"
  >
    <div :style="spacerStyle">
      <div
        v-for="{ item, index, style } in visibleItems"
        :key="index"
        :style="style"
      >
        <slot :item="item" :index="index" />
      </div>
    </div>
  </div>
</template>
