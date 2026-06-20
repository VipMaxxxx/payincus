<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import api from '@/api'
import { translateError } from '@/utils/errorHandler'

interface Props {
  show: boolean
  instanceId: number
  instanceName: string
  renewPrice: number
  billingCycleLabel: string
}

interface ApplyAffResult {
  success: boolean
  message: string
  discountRate: number
  discountPercent: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:show': [value: boolean]
  'success': [result: ApplyAffResult]
}>()

const { t } = useI18n()
const themeStore = useThemeStore()

const affCode = ref('')
const submitting = ref(false)
const error = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const normalizedAffCode = computed(() => affCode.value.trim().toUpperCase())
const canSubmit = computed(() => normalizedAffCode.value.length >= 3 && !submitting.value)
const formattedRenewPrice = computed(() => props.renewPrice.toFixed(2))

watch(() => props.show, async (show) => {
  if (show) {
    affCode.value = ''
    error.value = ''
    await nextTick()
    inputRef.value?.focus()
  } else {
    submitting.value = false
  }
})

function handleClose(): void {
  if (submitting.value) return
  emit('update:show', false)
}

function handleInput(): void {
  if (error.value) error.value = ''
}

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) return

  submitting.value = true
  error.value = ''

  try {
    const result = await api.billing.applyAffCodeToInstance(props.instanceId, normalizedAffCode.value)
    emit('success', result)
    emit('update:show', false)
  } catch (err) {
    error.value = translateError(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="handleClose">
        <div class="modal-backdrop" @click="handleClose"></div>

        <form class="modal-content max-w-md" @submit.prevent="handleSubmit">
          <div class="modal-header">
            <h3 class="modal-title">
              {{ t('instance.subscription.applyAffTitle') }}
            </h3>
            <button
              type="button"
              class="rounded-lg p-1 transition-colors hover:bg-gray-500/10"
              :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-100' : 'text-gray-500 hover:text-gray-900'"
              @click="handleClose"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="modal-body">
            <div
              class="rounded-lg border p-3"
              :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/70' : 'border-gray-200 bg-gray-50'"
            >
              <div class="text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                {{ t('instance.subscription.applyAffInstance') }}
              </div>
              <div class="mt-1 truncate text-sm font-medium" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                {{ instanceName }}
              </div>
              <div class="mt-3 flex items-end justify-between gap-3">
                <span class="text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                  {{ t('instance.subscription.applyAffCurrentRenewPrice') }}
                </span>
                <span class="text-sm font-semibold" :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'">
                  ¥{{ formattedRenewPrice }}{{ billingCycleLabel }}
                </span>
              </div>
            </div>

            <div>
              <label
                for="apply-aff-code-input"
                class="mb-1.5 block text-sm font-medium"
                :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-700'"
              >
                {{ t('instance.subscription.applyAffCodeLabel') }}
              </label>
              <input
                id="apply-aff-code-input"
                ref="inputRef"
                v-model="affCode"
                type="text"
                autocomplete="off"
                class="input w-full font-mono uppercase"
                :placeholder="t('instance.subscription.applyAffCodePlaceholder')"
                @input="handleInput"
              />
            </div>

            <div
              v-if="error"
              class="rounded-lg px-3 py-2 text-sm"
              :class="themeStore.isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-700'"
            >
              {{ error }}
            </div>

            <div
              class="rounded-lg border px-3 py-2.5 text-xs leading-5"
              :class="themeStore.isDark ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800'"
            >
              <p>{{ t('instance.subscription.applyAffEffectHint') }}</p>
              <p class="mt-1">{{ t('instance.subscription.applyAffNoRefundHint') }}</p>
              <p class="mt-1">{{ t('instance.subscription.applyAffOwnCodeHint') }}</p>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn-secondary" @click="handleClose">
              {{ t('common.cancel') }}
            </button>
            <button type="submit" class="btn-primary" :disabled="!canSubmit">
              <span
                v-if="submitting"
                class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white align-[-2px]"
              ></span>
              {{ submitting ? t('instance.subscription.applyAffSubmitting') : t('instance.subscription.applyAffSubmit') }}
            </button>
          </div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>
