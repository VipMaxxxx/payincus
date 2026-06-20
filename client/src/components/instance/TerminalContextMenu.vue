<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
    visible: boolean
    x: number
    y: number
    hasSelection: boolean
    canPaste: boolean
}>()

const emit = defineEmits<{
    (e: 'close'): void
    (e: 'copy'): void
    (e: 'paste'): void
    (e: 'selectAll'): void
    (e: 'clear'): void
}>()

const { t } = useI18n()
const menuRef = ref<HTMLElement | null>(null)

// 调整菜单位置，确保不超出屏幕
const adjustedX = ref(0)
const adjustedY = ref(0)

watch([() => props.visible, () => props.x, () => props.y], async () => {
    if (props.visible) {
        await nextTick()
        
        const menu = menuRef.value
        if (!menu) {
            adjustedX.value = props.x
            adjustedY.value = props.y
            return
        }
        
        const menuRect = menu.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        
        // 水平方向调整
        if (props.x + menuRect.width > viewportWidth - 8) {
            adjustedX.value = viewportWidth - menuRect.width - 8
        } else {
            adjustedX.value = props.x
        }
        
        // 垂直方向调整
        if (props.y + menuRect.height > viewportHeight - 8) {
            adjustedY.value = viewportHeight - menuRect.height - 8
        } else {
            adjustedY.value = props.y
        }
    }
}, { immediate: true })

// 点击外部关闭菜单
function handleClickOutside(e: MouseEvent) {
    if (props.visible && menuRef.value && !menuRef.value.contains(e.target as Node)) {
        emit('close')
    }
}

// 按 Escape 关闭菜单
function handleKeydown(e: KeyboardEvent) {
    if (props.visible && e.key === 'Escape') {
        emit('close')
    }
}

onMounted(() => {
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
    document.removeEventListener('mousedown', handleClickOutside)
    document.removeEventListener('keydown', handleKeydown)
})

function handleAction(action: 'copy' | 'paste' | 'selectAll' | 'clear') {
    switch (action) {
        case 'copy':
            emit('copy')
            break
        case 'paste':
            emit('paste')
            break
        case 'selectAll':
            emit('selectAll')
            break
        case 'clear':
            emit('clear')
            break
    }
    emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="context-menu">
      <div
        v-if="visible"
        ref="menuRef"
        class="fixed z-[100] min-w-[160px] py-1.5 rounded-lg shadow-xl border select-none
               bg-neutral-900 border-neutral-700"
        :style="{ left: adjustedX + 'px', top: adjustedY + 'px' }"
        @contextmenu.prevent
      >
        <!-- 复制 -->
        <button
          class="w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors"
          :class="hasSelection 
            ? 'text-neutral-200 hover:bg-neutral-800' 
            : 'text-neutral-500 cursor-not-allowed'"
          :disabled="!hasSelection"
          @click="handleAction('copy')"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span>{{ t('terminal.contextMenu.copy') }}</span>
          <span class="ml-auto text-xs text-neutral-500">Ctrl+Shift+C</span>
        </button>

        <!-- 粘贴 -->
        <button
          class="w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors"
          :class="canPaste 
            ? 'text-neutral-200 hover:bg-neutral-800' 
            : 'text-neutral-500 cursor-not-allowed'"
          :disabled="!canPaste"
          @click="handleAction('paste')"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span>{{ t('terminal.contextMenu.paste') }}</span>
          <span class="ml-auto text-xs text-neutral-500">Ctrl+Shift+V</span>
        </button>

        <!-- 全选 -->
        <button
          class="w-full flex items-center gap-3 px-3 py-2 text-sm text-left text-neutral-200 hover:bg-neutral-800 transition-colors"
          @click="handleAction('selectAll')"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <span>{{ t('terminal.contextMenu.selectAll') }}</span>
        </button>

        <!-- 分割线 -->
        <div class="my-1.5 border-t border-neutral-700" />

        <!-- 清空 -->
        <button
          class="w-full flex items-center gap-3 px-3 py-2 text-sm text-left text-neutral-200 hover:bg-neutral-800 transition-colors"
          @click="handleAction('clear')"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>{{ t('terminal.clear') }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.context-menu-enter-active {
  transition: all 0.1s ease-out;
}

.context-menu-leave-active {
  transition: all 0.075s ease-in;
}

.context-menu-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.context-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
