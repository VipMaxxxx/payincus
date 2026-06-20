<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()

interface DestroyInfo {
  canDestroy: boolean
  cannotDestroyReason: string
  isFreeInstance: boolean
  isFirstTime: boolean
  rules: {
    feeRate: number
  }
  refund: {
    remainingDays: number
    remainingValue: number
    feeRate: number
    feeAmount: number
    refundAmount: number
    destroyCount: number
    maxRefundable: number
  }
  instance: {
    id: number
    name: string
    hostName: string
    planName: string | null
  }
}

interface Props {
  visible: boolean
  loading: boolean
  destroyInfo: DestroyInfo | null
}

interface Emits {
  (e: 'update:visible', value: boolean): void
  (e: 'destroy'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const confirmInput = ref('')
const rulesExpanded = ref(false)

// 确认输入是否正确
const isConfirmValid = computed(() => {
  if (!props.destroyInfo) return false
  return confirmInput.value === props.destroyInfo.instance.name
})

// 是否可以执行销毁
const canExecuteDestroy = computed(() => {
  if (!props.destroyInfo) return false
  return props.destroyInfo.canDestroy && isConfirmValid.value && !props.loading
})

// 重置状态
watch(() => props.visible, (visible) => {
  if (!visible) {
    confirmInput.value = ''
    rulesExpanded.value = false
  }
})

function close() {
  emit('update:visible', false)
}

function handleDestroy() {
  if (canExecuteDestroy.value) {
    emit('destroy')
  }
}

// 格式化货币
function formatCurrency(value: number): string {
  return `¥${value.toFixed(2)}`
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div 
        class="absolute inset-0 backdrop-blur-sm"
        :class="themeStore.isDark ? 'bg-black/60' : 'bg-black/30'"
        @click="close"
      ></div>
      
      <!-- Modal -->
      <div 
        class="relative w-full max-w-lg border rounded-xl shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto"
        :class="themeStore.isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'"
      >
        <!-- Header -->
        <div 
          class="flex items-center justify-between p-5 border-b sticky top-0 z-10"
          :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'"
        >
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg bg-red-500/10">
              <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 
              class="text-base font-medium"
              :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
            >
              {{ t('instance.destroy.title') }}
            </h3>
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
        
        <div class="p-5 space-y-4">
          <!-- Loading state -->
          <div v-if="!destroyInfo" class="flex items-center justify-center py-8">
            <svg class="w-8 h-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>

          <template v-else>
            <!-- Warning -->
            <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div class="flex items-start gap-2">
                <svg class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p class="text-sm text-red-500 font-medium">
                  {{ destroyInfo.isFreeInstance ? t('instance.destroy.warningFree') : t('instance.destroy.warning') }}
                </p>
              </div>
            </div>

            <!-- Cannot destroy reason -->
            <div 
              v-if="!destroyInfo.canDestroy" 
              class="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20"
            >
              <div class="flex items-start gap-2">
                <svg class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p 
                  class="text-sm font-medium"
                  :class="themeStore.isDark ? 'text-yellow-400' : 'text-yellow-600'"
                >
                  {{ destroyInfo.cannotDestroyReason || t('instance.destroy.cannotDestroy') }}
                </p>
              </div>
            </div>

            <!-- Rules (Collapsible) -->
            <div 
              class="rounded-lg border overflow-hidden"
              :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'"
            >
              <button
                class="w-full flex items-center justify-between p-3 text-left transition-colors"
                :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                @click="rulesExpanded = !rulesExpanded"
              >
                <div class="flex items-center gap-2">
                  <svg 
                    class="w-4 h-4"
                    :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-500'"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span 
                    class="text-sm font-medium"
                    :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'"
                  >
                    {{ t('instance.destroy.rulesTitle') }}
                  </span>
                </div>
                <svg 
                  class="w-4 h-4 transition-transform"
                  :class="[
                    themeStore.isDark ? 'text-gray-500' : 'text-gray-400',
                    rulesExpanded ? 'rotate-180' : ''
                  ]"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              <div 
                v-show="rulesExpanded"
                class="px-3 pb-3 space-y-2 border-t"
                :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'"
              >
                <div class="pt-3 space-y-2">
                  <!-- First free -->
                  <div class="flex items-start gap-2">
                    <svg class="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <div>
                      <p 
                        class="text-xs font-medium"
                        :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'"
                      >
                        {{ t('instance.destroy.ruleFirstFree') }}
                      </p>
                      <p 
                        class="text-xs"
                        :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
                      >
                        {{ t('instance.destroy.ruleFirstFreeDesc') }}
                      </p>
                    </div>
                  </div>
                  
                  <!-- Fee rate -->
                  <div class="flex items-start gap-2">
                    <svg class="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p 
                        class="text-xs font-medium"
                        :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'"
                      >
                        {{ t('instance.destroy.ruleFeeRate', { rate: destroyInfo.rules.feeRate * 100 }) }}
                      </p>
                      <p 
                        class="text-xs"
                        :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
                      >
                        {{ t('instance.destroy.ruleFeeRateDesc', { rate: destroyInfo.rules.feeRate * 100 }) }}
                      </p>
                    </div>
                  </div>

                  <!-- Paid traffic threshold -->
                  <div class="flex items-start gap-2">
                    <svg class="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-6h13M9 5v6h13M5 5v12" />
                    </svg>
                    <div>
                      <p 
                        class="text-xs font-medium"
                        :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'"
                      >
                        {{ t('instance.destroy.ruleTrafficThreshold') }}
                      </p>
                      <p 
                        class="text-xs"
                        :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
                      >
                        {{ t('instance.destroy.ruleTrafficThresholdDesc') }}
                      </p>
                    </div>
                  </div>
                  
                  <!-- Free instance -->
                  <div class="flex items-start gap-2">
                    <svg class="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div>
                      <p 
                        class="text-xs font-medium"
                        :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'"
                      >
                        {{ t('instance.destroy.ruleFreeInstance') }}
                      </p>
                      <p 
                        class="text-xs"
                        :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
                      >
                        {{ t('instance.destroy.ruleFreeInstanceDesc') }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Instance Info -->
            <div 
              class="rounded-lg p-3 space-y-2"
              :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
            >
              <p 
                class="text-xs font-medium mb-2"
                :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'"
              >
                {{ t('instance.destroy.instanceInfo') }}
              </p>
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.destroy.instanceName') }}
                  </span>
                </div>
                <div :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">
                  {{ destroyInfo.instance.name }}
                </div>
                <div>
                  <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.destroy.hostName') }}
                  </span>
                </div>
                <div :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">
                  {{ destroyInfo.instance.hostName }}
                </div>
                <div v-if="destroyInfo.instance.planName">
                  <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.destroy.planName') }}
                  </span>
                </div>
                <div v-if="destroyInfo.instance.planName" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">
                  {{ destroyInfo.instance.planName }}
                </div>
              </div>
            </div>

            <!-- Refund Info (only for paid instances) -->
            <div 
              v-if="!destroyInfo.isFreeInstance"
              class="rounded-lg p-3 space-y-2"
              :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
            >
              <p 
                class="text-xs font-medium mb-2"
                :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'"
              >
                {{ t('instance.destroy.refundInfo') }}
              </p>
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.destroy.remainingDays') }}
                  </span>
                </div>
                <div :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">
                  {{ destroyInfo.refund.remainingDays }} {{ t('instance.destroy.days') }}
                </div>
                <div>
                  <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.destroy.remainingValue') }}
                  </span>
                </div>
                <div :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">
                  {{ formatCurrency(destroyInfo.refund.remainingValue) }}
                </div>
                <template v-if="destroyInfo.refund.maxRefundable > 0">
                  <div>
                    <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                      {{ t('instance.destroy.maxRefundable') }}
                    </span>
                  </div>
                  <div class="text-orange-500">
                    {{ formatCurrency(destroyInfo.refund.maxRefundable) }}
                  </div>
                </template>
                <div>
                  <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.destroy.feeRate') }}
                  </span>
                </div>
                <div :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">
                  <template v-if="destroyInfo.isFirstTime">
                    <span class="text-green-500">{{ t('instance.destroy.firstTimeFree') }}</span>
                  </template>
                  <template v-else>
                    {{ (destroyInfo.refund.feeRate * 100).toFixed(0) }}%
                  </template>
                </div>
                <div>
                  <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                    {{ t('instance.destroy.feeAmount') }}
                  </span>
                </div>
                <div :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'">
                  {{ formatCurrency(destroyInfo.refund.feeAmount) }}
                </div>
                <div>
                  <span 
                    class="font-medium"
                    :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'"
                  >
                    {{ t('instance.destroy.refundAmount') }}
                  </span>
                </div>
                <div 
                  class="font-medium"
                  :class="themeStore.isDark ? 'text-green-400' : 'text-green-600'"
                >
                  {{ formatCurrency(destroyInfo.refund.refundAmount) }}
                </div>
              </div>
            </div>

            <!-- Free instance notice -->
            <div 
              v-else
              class="p-3 rounded-lg"
              :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
            >
              <p 
                class="text-xs"
                :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'"
              >
                {{ t('instance.destroy.freeInstanceNoRefund') }}
              </p>
            </div>

            <!-- Confirmation Input -->
            <div v-if="destroyInfo.canDestroy" class="space-y-2">
              <label 
                class="block text-xs"
                :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-500'"
              >
                {{ t('instance.destroy.confirmHint', { name: destroyInfo.instance.name }) }}
              </label>
              <input
                v-model="confirmInput"
                type="text"
                :placeholder="t('instance.destroy.confirmPlaceholder')"
                class="w-full px-3 py-2 text-sm rounded-lg border outline-none transition-colors"
                :class="[
                  themeStore.isDark 
                    ? 'bg-gray-800 border-gray-700 text-gray-200 placeholder-gray-500 focus:border-red-500' 
                    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-red-500',
                  isConfirmValid ? 'border-green-500' : ''
                ]"
              />
            </div>

            <!-- Action buttons -->
            <div class="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                class="btn-secondary"
                @click="close"
              >
                {{ t('instance.destroy.cancel') }}
              </button>
              <button 
                :disabled="!canExecuteDestroy"
                class="btn-danger"
                @click="handleDestroy"
              >
                <svg v-if="loading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {{ loading ? t('instance.destroy.destroying') : t('instance.destroy.confirmButton') }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
