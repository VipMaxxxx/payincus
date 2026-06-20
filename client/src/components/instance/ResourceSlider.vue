<script setup lang="ts">
/**
 * 资源滑块组件
 * 支持滑块拖动、数字输入、快捷按钮
 */
import { computed, ref, watch } from 'vue'
import { useThemeStore } from '@/stores/theme'

interface Props {
  modelValue: number
  min: number
  max: number
  step: number
  label: string
  unit?: string
  /** 显示格式化函数 */
  formatValue?: (value: number) => string
  /** 副标题（如 ~1 核心） */
  subtitle?: string
  /** 快捷按钮配置：值数组或预设比例 */
  presets?: number[] | 'percentage'
  /** 图标 */
  icon?: string
}

const props = withDefaults(defineProps<Props>(), {
  unit: '',
  presets: 'percentage'
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const themeStore = useThemeStore()

// 输入框临时值
const inputValue = ref<string>('')
const isInputFocused = ref(false)

// 计算填充百分比
const fillPercentage = computed(() => {
  if (props.max <= props.min) return 0
  return ((props.modelValue - props.min) / (props.max - props.min)) * 100
})

// 格式化显示值
const displayValue = computed(() => {
  if (props.formatValue) {
    return props.formatValue(props.modelValue)
  }
  return `${props.modelValue}${props.unit}`
})

// 快捷按钮
const presetButtons = computed(() => {
  if (Array.isArray(props.presets)) {
    return props.presets.map(v => ({
      label: props.formatValue ? props.formatValue(v) : `${v}${props.unit}`,
      value: v
    }))
  }
  // 默认使用百分比预设
  const range = props.max - props.min
  return [
    { label: 'MIN', value: props.min },
    { label: '25%', value: normalizeToStep(props.min + range * 0.25) },
    { label: '50%', value: normalizeToStep(props.min + range * 0.5) },
    { label: '75%', value: normalizeToStep(props.min + range * 0.75) },
    { label: 'MAX', value: props.max }
  ]
})

// 将值规范到步长
function normalizeToStep(value: number): number {
  const stepped = Math.round(value / props.step) * props.step
  return Math.max(props.min, Math.min(props.max, stepped))
}

// 处理滑块输入
function handleSliderInput(event: Event) {
  const target = event.target as HTMLInputElement
  const value = normalizeToStep(Number(target.value))
  emit('update:modelValue', value)
}

// 处理输入框聚焦
function handleInputFocus() {
  isInputFocused.value = true
  inputValue.value = String(props.modelValue)
}

// 处理输入框失焦
function handleInputBlur() {
  isInputFocused.value = false
  const parsed = parseFloat(inputValue.value)
  if (!isNaN(parsed)) {
    const normalized = normalizeToStep(parsed)
    emit('update:modelValue', normalized)
  }
}

// 处理输入框回车
function handleInputEnter() {
  const parsed = parseFloat(inputValue.value)
  if (!isNaN(parsed)) {
    const normalized = normalizeToStep(parsed)
    emit('update:modelValue', normalized)
  }
  isInputFocused.value = false
}

// 处理快捷按钮点击
function handlePresetClick(value: number) {
  emit('update:modelValue', value)
}

// 同步外部值变化到输入框
watch(() => props.modelValue, (newVal) => {
  if (!isInputFocused.value) {
    inputValue.value = String(newVal)
  }
}, { immediate: true })
</script>

<template>
  <div class="resource-slider">
    <!-- 标题行 -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <!-- 图标 -->
        <div 
          v-if="icon"
          class="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
          :class="themeStore.isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600'"
        >
          <span v-html="icon"></span>
        </div>
        <div>
          <div 
            class="text-sm font-medium"
            :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'"
          >
            {{ label }}
          </div>
          <div 
            v-if="subtitle"
            class="text-xs"
            :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
          >
            {{ subtitle }}
          </div>
        </div>
      </div>
      
      <!-- 数值显示/输入 -->
      <div class="flex items-center gap-2">
        <input
          v-if="isInputFocused"
          v-model="inputValue"
          type="text"
          class="w-24 h-9 px-3 text-right text-sm font-mono rounded-lg border-2 outline-none transition-colors"
          :class="themeStore.isDark 
            ? 'bg-gray-800 border-blue-500 text-white' 
            : 'bg-white border-blue-500 text-gray-900'"
          autofocus
          @blur="handleInputBlur"
          @keydown.enter="handleInputEnter"
        />
        <div
          v-else
          class="w-24 h-9 px-3 flex items-center justify-end text-sm font-mono rounded-lg cursor-text transition-colors"
          :class="themeStore.isDark 
            ? 'bg-gray-800 hover:bg-gray-750 text-white' 
            : 'bg-gray-100 hover:bg-gray-200 text-gray-900'"
          @click="handleInputFocus"
        >
          {{ displayValue }}
        </div>
      </div>
    </div>
    
    <!-- 滑块轨道 -->
    <div class="slider-track-container relative h-2 mb-3">
      <!-- 背景轨道 -->
      <div 
        class="absolute inset-0 rounded-full"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-200'"
      ></div>
      <!-- 填充轨道（到圆心位置） -->
      <div 
        class="absolute inset-y-0 left-0 rounded-full transition-all duration-150"
        :class="themeStore.isDark ? 'bg-blue-500' : 'bg-blue-600'"
        :style="{ width: `calc(${fillPercentage}% * (100% - 16px) / 100% + 8px)` }"
      ></div>
      <!-- 原生滑块（透明覆盖层） -->
      <input
        type="range"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        class="slider-input absolute inset-0 w-full h-full cursor-pointer"
        @input="handleSliderInput"
      />
      <!-- 滑块手柄 -->
      <div 
        class="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-md pointer-events-none transition-all duration-150"
        :class="themeStore.isDark ? 'bg-white' : 'bg-white border-2 border-blue-600'"
        :style="{ left: `calc(${fillPercentage}% * (100% - 16px) / 100%)` }"
      ></div>
    </div>
    
    <!-- 范围标签 + 快捷按钮 -->
    <div class="flex items-center justify-between">
      <div 
        class="text-xs font-mono"
        :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
      >
        {{ formatValue ? formatValue(min) : `${min}${unit}` }}
      </div>
      
      <!-- 快捷按钮 -->
      <div class="flex items-center gap-0.5">
        <button
          v-for="preset in presetButtons"
          :key="preset.label"
          type="button"
          class="px-1.5 py-0.5 text-2xs font-medium transition-colors"
          :class="[
            modelValue === preset.value
              ? (themeStore.isDark ? 'text-blue-400' : 'text-blue-600')
              : (themeStore.isDark ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-600')
          ]"
          @click="handlePresetClick(preset.value)"
        >
          {{ preset.label }}
        </button>
      </div>
      
      <div 
        class="text-xs font-mono"
        :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
      >
        {{ formatValue ? formatValue(max) : `${max}${unit}` }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 滑块输入样式 */
.slider-input {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  margin: 0;
  opacity: 0;
}

.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.slider-input::-moz-range-thumb {
  width: 16px;
  height: 16px;
  cursor: pointer;
  border: none;
  background: transparent;
}

/* 确保轨道容器有圆角 */
.slider-track-container {
  border-radius: 9999px;
}
</style>
