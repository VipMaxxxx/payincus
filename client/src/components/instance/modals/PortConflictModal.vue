<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()

interface Conflict {
  publicPort: number
  suggestedPort: number | null
}

interface Props {
  visible: boolean
  loading: boolean
  conflicts: Conflict[]
  portRangeStart?: number | null
  portRangeEnd?: number | null
}

interface Emits {
  (e: 'update:visible', value: boolean): void
  (e: 'confirm', resolvedPorts: Array<{ original: number; resolved: number }>): void
  (e: 'cancel'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const themeStore = useThemeStore()

// 用户输入的解决端口
const resolvedPorts = ref<Record<number, string>>({})

// 初始化解决端口为建议值
watch(() => props.visible, (newVal) => {
  if (newVal) {
    const ports: Record<number, string> = {}
    props.conflicts.forEach(c => {
      ports[c.publicPort] = c.suggestedPort?.toString() || ''
    })
    resolvedPorts.value = ports
  } else {
    resolvedPorts.value = {}
  }
}, { immediate: true })

// 验证单个端口
function validatePort(value: string): boolean {
  if (!value.trim()) return false
  const port = parseInt(value, 10)
  if (isNaN(port) || port < 1 || port > 65535) return false
  if (props.portRangeStart && props.portRangeEnd) {
    if (port < props.portRangeStart || port > props.portRangeEnd) return false
  }
  return true
}

// 检查是否有重复端口
const duplicatePorts = computed(() => {
  const values = Object.values(resolvedPorts.value).filter(v => v.trim())
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  values.forEach(v => {
    if (seen.has(v)) {
      duplicates.add(v)
    }
    seen.add(v)
  })
  return duplicates
})

// 检查所有端口是否有效
const allValid = computed(() => {
  return props.conflicts.every(c => {
    const value = resolvedPorts.value[c.publicPort]
    if (!validatePort(value)) return false
    if (duplicatePorts.value.has(value)) return false
    return true
  })
})

// 使用所有建议端口
function useSuggested() {
  const ports: Record<number, string> = {}
  props.conflicts.forEach(c => {
    ports[c.publicPort] = c.suggestedPort?.toString() || ''
  })
  resolvedPorts.value = ports
}

function handleConfirm() {
  const result = props.conflicts.map(c => ({
    original: c.publicPort,
    resolved: parseInt(resolvedPorts.value[c.publicPort], 10)
  }))
  emit('confirm', result)
}

function close() {
  emit('cancel')
  emit('update:visible', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div 
          class="absolute inset-0 backdrop-blur-sm"
          :class="themeStore.isDark ? 'bg-black/60' : 'bg-black/30'"
          @click="close"
        ></div>
        
        <div 
          class="modal-content relative w-full max-w-lg border rounded-xl shadow-2xl"
          :class="themeStore.isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'"
        >
          <!-- Header -->
          <div 
            class="flex items-center justify-between p-5 border-b"
            :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
          >
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-lg bg-amber-500/10">
                <svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 
                  class="text-base font-medium"
                  :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
                >
                  {{ t('portConflict.title') }}
                </h3>
                <p class="text-xs text-gray-500 mt-0.5">
                  {{ t('portConflict.subtitle', { count: conflicts.length }) }}
                </p>
              </div>
            </div>
            <button 
              :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'" 
              @click="close"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="p-5">
            <!-- 说明 -->
            <p 
              class="text-sm mb-4"
              :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
            >
              {{ t('portConflict.description') }}
            </p>

            <!-- 冲突列表 -->
            <div class="space-y-3 max-h-64 overflow-y-auto">
              <div 
                v-for="conflict in conflicts" 
                :key="conflict.publicPort"
                class="flex items-center gap-3 p-3 rounded-lg"
                :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-50'"
              >
                <!-- 原端口 -->
                <div class="flex-shrink-0 w-24">
                  <div class="text-xs text-gray-500 mb-1">{{ t('portConflict.originalPort') }}</div>
                  <div class="flex items-center gap-1.5">
                    <span 
                      class="font-mono text-sm"
                      :class="themeStore.isDark ? 'text-red-400' : 'text-red-600'"
                    >
                      {{ conflict.publicPort }}
                    </span>
                    <span class="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
                      {{ t('portConflict.occupied') }}
                    </span>
                  </div>
                </div>

                <!-- 箭头 -->
                <div class="flex-shrink-0">
                  <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </div>

                <!-- 新端口输入 -->
                <div class="flex-1">
                  <div class="text-xs text-gray-500 mb-1">{{ t('portConflict.newPort') }}</div>
                  <input
                    v-model="resolvedPorts[conflict.publicPort]"
                    type="text"
                    class="input text-sm h-9"
                    :class="{
                      'border-red-500 focus:ring-red-500': !validatePort(resolvedPorts[conflict.publicPort]) || duplicatePorts.has(resolvedPorts[conflict.publicPort])
                    }"
                    :placeholder="conflict.suggestedPort?.toString() || ''"
                  />
                </div>

                <!-- 建议标签 -->
                <div 
                  v-if="conflict.suggestedPort && resolvedPorts[conflict.publicPort] === conflict.suggestedPort.toString()"
                  class="flex-shrink-0"
                >
                  <span class="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">
                    {{ t('portConflict.suggested') }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 端口范围提示 -->
            <p 
              v-if="portRangeStart && portRangeEnd" 
              class="text-xs mt-3"
              :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
            >
              {{ t('portConflict.rangeHint', { start: portRangeStart, end: portRangeEnd }) }}
            </p>
          </div>

          <!-- Footer -->
          <div 
            class="flex items-center justify-between p-5 border-t"
            :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
          >
            <button 
              type="button" 
              class="text-sm transition-colors"
              :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'"
              @click="useSuggested"
            >
              {{ t('portConflict.useSuggested') }}
            </button>
            
            <div class="flex gap-3">
              <button type="button" class="btn-secondary" @click="close">
                {{ t('portConflict.cancel') }}
              </button>
              <button 
                type="button" 
                class="btn-primary" 
                :disabled="!allValid || loading"
                @click="handleConfirm"
              >
                <svg v-if="loading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {{ t('portConflict.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
