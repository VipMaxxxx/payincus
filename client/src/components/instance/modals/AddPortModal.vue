<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()

interface Props {
  visible: boolean
  loading: boolean
  error: string
  portRangeStart?: number | null
  portRangeEnd?: number | null
  // 新增：配额信息
  portQuotaCurrent?: number
  portQuotaLimit?: number
  // 新增：网络模式
  networkMode?: string
}

interface Emits {
  (e: 'update:visible', value: boolean): void
  (e: 'submit', form: { 
    protocol: 'tcp' | 'udp' | 'both'
    privatePort: string
    publicPort: string
    remark: string
    // 新增：是否为范围输入
    isRange: boolean
    privatePortStart?: number
    privatePortEnd?: number
    publicPortStart?: number
    publicPortEnd?: number
  }): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const themeStore = useThemeStore()

const form = ref<{ protocol: 'tcp' | 'udp' | 'both'; publicPort: string; privatePort: string; remark: string }>({
  protocol: 'both',
  publicPort: '',
  privatePort: '',
  remark: ''
})

watch(() => props.visible, (newVal) => {
  if (!newVal) {
    form.value = { protocol: 'both', publicPort: '', privatePort: '', remark: '' }
  }
})

// 解析端口范围（支持 "80" 或 "80-85" 格式）
function parsePortRange(input: string): { start: number; end: number } | null {
  if (!input.trim()) return null
  
  const rangeMatch = input.match(/^(\d+)-(\d+)$/)
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10)
    const end = parseInt(rangeMatch[2], 10)
    if (start > 0 && end > 0 && start <= end && start <= 65535 && end <= 65535) {
      return { start, end }
    }
    return null
  }
  
  const singleMatch = input.match(/^(\d+)$/)
  if (singleMatch) {
    const port = parseInt(singleMatch[1], 10)
    if (port > 0 && port <= 65535) {
      return { start: port, end: port }
    }
  }
  
  return null
}

// 解析后的端口范围
const parsedPrivatePort = computed(() => parsePortRange(form.value.privatePort))
const parsedPublicPort = computed(() => parsePortRange(form.value.publicPort))

// 是否为范围输入
const isRangeInput = computed(() => {
  const priv = parsedPrivatePort.value
  return priv && priv.start !== priv.end
})

// 端口数量
const portCount = computed(() => {
  const priv = parsedPrivatePort.value
  if (!priv) return 0
  return priv.end - priv.start + 1
})

// 需要的配额数
const quotaNeeded = computed(() => {
  const count = portCount.value
  return form.value.protocol === 'both' ? count * 2 : count
})

// 剩余配额
const quotaRemaining = computed(() => {
  if (props.portQuotaLimit === undefined || props.portQuotaCurrent === undefined) return null
  return props.portQuotaLimit - props.portQuotaCurrent
})

// 配额是否足够
const quotaSufficient = computed(() => {
  const remaining = quotaRemaining.value
  if (remaining === null) return true
  return remaining >= quotaNeeded.value
})

// 输入验证
const validationError = computed(() => {
  if (!form.value.privatePort.trim()) return null
  
  if (!parsedPrivatePort.value) {
    return t('portModal.invalidPortFormat')
  }

  // 阻拦 IPv6 Only 模式映射内网 22 端口
  if (props.networkMode === 'ipv6_only') {
    const priv = parsedPrivatePort.value
    if (priv && priv.start <= 22 && priv.end >= 22) {
      return t('portModal.ipv6OnlySshPortHint')
    }
  }
  
  if (form.value.publicPort.trim() && !parsedPublicPort.value) {
    return t('portModal.invalidPortFormat')
  }
  
  // 检查内网和公网端口数量是否匹配
  if (form.value.publicPort.trim() && parsedPublicPort.value) {
    const priv = parsedPrivatePort.value!
    const pub = parsedPublicPort.value
    const privCount = priv.end - priv.start + 1
    const pubCount = pub.end - pub.start + 1
    // 如果两者都是范围，数量必须相同
    // 如果一个是范围一个是单端口，也不允许（除非两者都是单端口）
    if (privCount !== pubCount) {
      return t('portModal.rangeMismatch', { private: privCount, public: pubCount })
    }
  }
  
  // 检查公网端口范围
  if (form.value.publicPort.trim() && parsedPublicPort.value && props.portRangeStart && props.portRangeEnd) {
    const pub = parsedPublicPort.value
    if (pub.start < props.portRangeStart || pub.end > props.portRangeEnd) {
      return t('portModal.publicPortOutOfRange', { start: props.portRangeStart, end: props.portRangeEnd })
    }
  }
  
  // 检查配额
  if (!quotaSufficient.value) {
    return t('portModal.quotaInsufficient', { need: quotaNeeded.value, remain: quotaRemaining.value })
  }
  
  return null
})

// 是否可提交
const canSubmit = computed(() => {
  return form.value.privatePort.trim() && 
         parsedPrivatePort.value && 
         !validationError.value &&
         !props.loading
})

function handleSubmit(): void {
  const priv = parsedPrivatePort.value
  const pub = parsedPublicPort.value
  
  emit('submit', {
    ...form.value,
    isRange: isRangeInput.value || false,
    privatePortStart: priv?.start,
    privatePortEnd: priv?.end,
    publicPortStart: pub?.start,
    publicPortEnd: pub?.end
  })
}

function close(): void {
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
          class="modal-content relative w-full max-w-md border rounded-xl shadow-2xl"
          :class="themeStore.isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'"
        >
          <div 
            class="flex items-center justify-between p-5 border-b"
            :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
          >
            <h3 
              class="text-base font-medium"
              :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
            >
              {{ t('portModal.title') }}
            </h3>
            <button 
              :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'" 
              @click="close"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        
          <form class="p-5" @submit.prevent="handleSubmit">
            <div class="space-y-4">
              <div class="flex gap-3">
                <div class="flex-1">
                  <label class="block text-xs text-gray-500 mb-1.5">{{ t('portModal.protocol') }}</label>
                  <div class="flex gap-2">
                    <button 
                      type="button"
                      :class="[
                        'flex-1 px-3 py-2 text-sm rounded-lg border transition-colors',
                        form.protocol === 'both' 
                          ? (themeStore.isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-900 border-gray-900 text-white')
                          : (themeStore.isDark ? 'border-gray-800 text-gray-500 hover:border-gray-700' : 'border-gray-300 text-gray-600 hover:border-gray-400')
                      ]"
                      @click="form.protocol = 'both'"
                    >
                      Both
                    </button>
                    <button 
                      type="button"
                      :class="[
                        'flex-1 px-3 py-2 text-sm rounded-lg border transition-colors',
                        form.protocol === 'tcp' 
                          ? (themeStore.isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-900 border-gray-900 text-white')
                          : (themeStore.isDark ? 'border-gray-800 text-gray-500 hover:border-gray-700' : 'border-gray-300 text-gray-600 hover:border-gray-400')
                      ]"
                      @click="form.protocol = 'tcp'"
                    >
                      TCP
                    </button>
                    <button 
                      type="button"
                      :class="[
                        'flex-1 px-3 py-2 text-sm rounded-lg border transition-colors',
                        form.protocol === 'udp' 
                          ? (themeStore.isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-900 border-gray-900 text-white')
                          : (themeStore.isDark ? 'border-gray-800 text-gray-500 hover:border-gray-700' : 'border-gray-300 text-gray-600 hover:border-gray-400')
                      ]"
                      @click="form.protocol = 'udp'"
                    >
                      UDP
                    </button>
                  </div>
                  <p 
                    v-if="form.protocol === 'both'"
                    class="text-xs mt-1.5"
                    :class="themeStore.isDark ? 'text-amber-500/80' : 'text-amber-600'"
                  >
                    {{ t('portModal.bothHint') }}
                  </p>
                </div>
              </div>

              <div>
                <label class="block text-xs text-gray-500 mb-1.5">
                  {{ t('portModal.privatePort') }} 
                  <span class="text-red-500">{{ t('portModal.privatePortRequired') }}</span>
                </label>
                <input 
                  v-model="form.privatePort" 
                  type="text" 
                  class="input" 
                  :placeholder="t('portModal.privatePortPlaceholderRange')"
                />
                <p 
                  class="text-xs mt-1.5"
                  :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
                >
                  {{ t('portModal.rangeHint') }}
                </p>
              </div>

              <div>
                <label class="block text-xs text-gray-500 mb-1.5">
                  {{ t('portModal.publicPort') }} 
                  <span class="text-gray-400">{{ t('portModal.publicPortOptional') }}</span>
                </label>
                <input 
                  v-model="form.publicPort" 
                  type="text" 
                  class="input" 
                  :placeholder="t('portModal.publicPortPlaceholderRange')"
                />
                <p 
                  class="text-xs mt-1.5"
                  :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'"
                >
                  <template v-if="props.portRangeStart && props.portRangeEnd">
                    {{ t('portModal.publicPortHintWithRange', { start: props.portRangeStart, end: props.portRangeEnd }) }}
                  </template>
                  <template v-else>
                    {{ t('portModal.publicPortHint') }}
                  </template>
                </p>
              </div>

              <div>
                <label class="block text-xs text-gray-500 mb-1.5">{{ t('portModal.remark') }} <span class="text-gray-400">{{ t('portModal.remarkOptional') }}</span></label>
                <input 
                  v-model="form.remark" 
                  type="text" 
                  class="input" 
                  :placeholder="t('portModal.remarkPlaceholder')"
                  maxlength="100"
                />
              </div>

              <!-- 配额预览 -->
              <div 
                v-if="portCount > 0 && quotaRemaining !== null"
                class="p-3 rounded-lg"
                :class="quotaSufficient 
                  ? (themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-50') 
                  : (themeStore.isDark ? 'bg-red-500/10' : 'bg-red-50')"
              >
                <div class="flex items-center justify-between text-sm">
                  <span :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                    {{ t('portModal.quotaPreview', { count: quotaNeeded, quota: quotaNeeded }) }}
                  </span>
                  <span 
                    :class="quotaSufficient 
                      ? (themeStore.isDark ? 'text-gray-300' : 'text-gray-700')
                      : 'text-red-500'"
                  >
                    {{ t('portModal.quotaRemaining', { remain: quotaRemaining }) }}
                  </span>
                </div>
              </div>

              <!-- 验证错误 -->
              <div v-if="validationError" class="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p class="text-sm text-red-500">{{ validationError }}</p>
              </div>

              <!-- API 错误 -->
              <div v-if="error" class="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p class="text-sm text-red-500">{{ error }}</p>
              </div>
            </div>

            <div class="flex justify-end gap-3 mt-6">
              <button type="button" class="btn-secondary" @click="close">{{ t('portModal.cancel') }}</button>
              <button type="submit" :disabled="!canSubmit" class="btn-primary">
                <svg v-if="loading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {{ loading ? t('portModal.adding') : t('portModal.add') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </transition>
  </Teleport>
</template>
