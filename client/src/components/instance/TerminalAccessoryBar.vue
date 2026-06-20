<script setup lang="ts">
/**
 * 移动端终端快捷工具栏
 * 
 * 提供虚拟键盘缺失的控制键和常用符号，解决移动端终端操作痛点
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  connected: boolean
}>()

const emit = defineEmits<{
  (e: 'send', data: string): void
  (e: 'paste'): void
  (e: 'hideKeyboard'): void
  (e: 'savedCommands'): void
}>()

const { t } = useI18n()

// Ctrl 修饰键状态
const ctrlActive = ref(false)

// 控制字符映射
const CTRL_CODES: Record<string, number> = {
  'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5, 'f': 6, 'g': 7, 'h': 8,
  'i': 9, 'j': 10, 'k': 11, 'l': 12, 'm': 13, 'n': 14, 'o': 15, 'p': 16,
  'q': 17, 'r': 18, 's': 19, 't': 20, 'u': 21, 'v': 22, 'w': 23, 'x': 24,
  'y': 25, 'z': 26
}

// 方向键 ANSI 转义序列
const ARROW_CODES = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D'
}

// 发送数据
function send(data: string) {
  if (!props.connected) return
  emit('send', data)
}

// 发送控制字符
function sendControl(char: string) {
  if (!props.connected) return
  
  if (char === 'esc') {
    send('\x1b')
  } else if (char === 'tab') {
    send('\t')
  } else if (char === 'ctrlc') {
    send('\x03')
  } else if (char === 'ctrld') {
    send('\x04')
  }
}

// 发送方向键
function sendArrow(direction: 'up' | 'down' | 'left' | 'right') {
  if (!props.connected) return
  send(ARROW_CODES[direction])
}

// 发送符号
function sendSymbol(symbol: string) {
  if (!props.connected) return
  send(symbol)
}

// 切换 Ctrl 修饰键状态
function toggleCtrl() {
  ctrlActive.value = !ctrlActive.value
}

// 监听键盘输入（当 Ctrl 激活时拦截）
function handleKeyPress(event: KeyboardEvent) {
  if (!ctrlActive.value || !props.connected) return
  
  const key = event.key.toLowerCase()
  if (CTRL_CODES[key]) {
    event.preventDefault()
    send(String.fromCharCode(CTRL_CODES[key]))
    ctrlActive.value = false
  }
}

// 粘贴
function handlePaste() {
  if (!props.connected) return
  emit('paste')
}

// 收起键盘
function hideKeyboard() {
  emit('hideKeyboard')
}

function openSavedCommands() {
  emit('savedCommands')
}

// 按钮禁用状态
const isDisabled = computed(() => !props.connected)

// 暴露方法供父组件使用
defineExpose({
  handleKeyPress,
  ctrlActive
})
</script>

<template>
  <div class="terminal-accessory-bar flex items-center h-11 bg-neutral-900/95 border-t border-neutral-800 backdrop-blur-sm">
    <!-- 固定区域 - 核心控制键 -->
    <div class="flex items-center gap-0.5 px-1.5 border-r border-neutral-700/50">
      <!-- Esc -->
      <button
        class="accessory-btn"
        :class="{ 'opacity-50': isDisabled }"
        :disabled="isDisabled"
        @click="sendControl('esc')"
      >
        <span class="text-[10px] font-medium">Esc</span>
      </button>
      
      <!-- Tab -->
      <button
        class="accessory-btn"
        :class="{ 'opacity-50': isDisabled }"
        :disabled="isDisabled"
        @click="sendControl('tab')"
      >
        <span class="text-[10px] font-medium">Tab</span>
      </button>
      
      <!-- Ctrl (修饰键) -->
      <button
        class="accessory-btn"
        :class="[
          ctrlActive ? 'bg-blue-600 text-white' : '',
          { 'opacity-50': isDisabled }
        ]"
        :disabled="isDisabled"
        @click="toggleCtrl"
      >
        <span class="text-[10px] font-medium">Ctrl</span>
      </button>
      
      <!-- Ctrl+C (救命键) -->
      <button
        class="accessory-btn bg-red-600/20 text-red-400 hover:bg-red-600/30"
        :class="{ 'opacity-50': isDisabled }"
        :disabled="isDisabled"
        @click="sendControl('ctrlc')"
      >
        <span class="text-[10px] font-medium">⌃C</span>
      </button>
    </div>
    
    <!-- 滑动区域 -->
    <div class="flex-1 overflow-x-auto scrollbar-hide">
      <div class="flex items-center gap-0.5 px-1.5 min-w-max">
        <!-- 高频符号 -->
        <button
          v-for="symbol in ['/', '-', '|', '~', ':']"
          :key="symbol"
          class="accessory-btn"
          :class="{ 'opacity-50': isDisabled }"
          :disabled="isDisabled"
          @click="sendSymbol(symbol)"
        >
          <span class="text-sm font-mono">{{ symbol }}</span>
        </button>
        
        <!-- 分隔 -->
        <div class="w-px h-5 bg-neutral-700/50 mx-1" />
        
        <!-- 方向键 -->
        <button
          class="accessory-btn"
          :class="{ 'opacity-50': isDisabled }"
          :disabled="isDisabled"
          @click="sendArrow('up')"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          class="accessory-btn"
          :class="{ 'opacity-50': isDisabled }"
          :disabled="isDisabled"
          @click="sendArrow('down')"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          class="accessory-btn"
          :class="{ 'opacity-50': isDisabled }"
          :disabled="isDisabled"
          @click="sendArrow('left')"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          class="accessory-btn"
          :class="{ 'opacity-50': isDisabled }"
          :disabled="isDisabled"
          @click="sendArrow('right')"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        
        <!-- 分隔 -->
        <div class="w-px h-5 bg-neutral-700/50 mx-1" />
        
        <!-- Ctrl+D -->
        <button
          class="accessory-btn"
          :class="{ 'opacity-50': isDisabled }"
          :disabled="isDisabled"
          @click="sendControl('ctrld')"
        >
          <span class="text-[10px] font-medium">⌃D</span>
        </button>
        
        <!-- 粘贴 -->
        <button
          class="accessory-btn"
          :class="{ 'opacity-50': isDisabled }"
          :disabled="isDisabled"
          :title="t('terminal.paste')"
          @click="handlePaste"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </button>

        <!-- 快捷命令 -->
        <button
          class="accessory-btn"
          :title="t('terminal.savedCommands.open')"
          @click="openSavedCommands"
        >
          <span class="text-[10px] font-medium">{{ t('terminal.savedCommands.short') }}</span>
        </button>
        
        <!-- 收起键盘 -->
        <button
          class="accessory-btn"
          :title="t('terminal.hideKeyboard')"
          @click="hideKeyboard"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5h14" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.accessory-btn {
  @apply flex items-center justify-center min-w-[40px] h-8 px-2 
         text-neutral-300 bg-neutral-800 rounded-md
         active:bg-neutral-700 transition-colors
         touch-manipulation select-none;
}

.accessory-btn:disabled {
  @apply cursor-not-allowed;
}

/* 隐藏滚动条但保留滚动功能 */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
</style>
