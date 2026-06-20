<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import type { Instance, Snapshot } from '@/types/api'

const { t } = useI18n()

interface RemainingQuota {
  port: number
  snapshot: number
}

interface Props {
  instance: Instance
  portMappingsCount: number
  snapshots: Snapshot[]
  quotaForm: {
    portLimit: number | null
    snapshotLimit: number | null
  }
  quotaSaving: boolean
  quotaError: string
  remainingQuota: RemainingQuota // 用户账户剩余额度
}

interface Emits {
  (e: 'update:quota-form', form: { portLimit: number | null; snapshotLimit: number | null }): void
  (e: 'save'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const themeStore = useThemeStore()

const localForm = ref({ ...props.quotaForm })

// 监听表单变化，同步到父组件
watch(localForm, (newVal) => {
  emit('update:quota-form', { ...newVal })
}, { deep: true })
</script>

<template>
  <div class="space-y-4">
    <div class="card p-5">
      <h2 
        class="text-sm font-medium mb-4"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ t('instance.detail.quotaTab.title') }}
      </h2>
      
      <div class="space-y-4">
        <!-- NAT 端口配额 -->
        <div>
          <label class="block text-sm mb-2" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
            {{ t('instance.detail.quotaTab.portLimit') }}
          </label>
          <div class="flex items-center gap-2">
            <input 
              v-model.number="localForm.portLimit" 
              type="number"
              class="input flex-1" 
              :min="Math.max(1, portMappingsCount)" 
              :max="1000"
              :placeholder="t('instance.detail.quotaTab.placeholder')"
            />
          </div>
          <div class="mt-2 text-xs" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'">
            <div>{{ t('instance.detail.quotaTab.currentUsage') }}: {{ portMappingsCount }} {{ t('instance.detail.quotaTab.portMappings') }}</div>
            <div v-if="instance.port_limit !== null && instance.port_limit !== undefined">
              {{ t('instance.detail.quotaTab.quotaLimit') }}: {{ instance.port_limit }} {{ t('instance.detail.quotaTab.unit') }}
              <span :class="portMappingsCount >= instance.port_limit ? 'text-red-500' : 'text-green-500'">
                ({{ portMappingsCount >= instance.port_limit ? t('instance.detail.quotaTab.full') : `${t('instance.detail.quotaTab.remaining')} ${instance.port_limit - portMappingsCount}` }})
              </span>
            </div>
          </div>
        </div>

        <!-- 快照配额 -->
        <div>
          <label class="block text-sm mb-2" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
            {{ t('instance.detail.quotaTab.snapshotLimit') }}
          </label>
          <div class="flex items-center gap-2">
            <input 
              v-model.number="localForm.snapshotLimit" 
              type="number"
              class="input flex-1" 
              :min="Math.max(1, snapshots.length)" 
              :max="1000"
              :placeholder="t('instance.detail.quotaTab.placeholder')"
            />
          </div>
          <div class="mt-2 text-xs" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'">
            <div>{{ t('instance.detail.quotaTab.currentUsage') }}: {{ snapshots.length }} {{ t('instance.detail.quotaTab.snapshots') }}</div>
            <div v-if="instance.snapshot_limit !== null && instance.snapshot_limit !== undefined">
              {{ t('instance.detail.quotaTab.quotaLimit') }}: {{ instance.snapshot_limit }} {{ t('instance.detail.quotaTab.unit') }}
              <span :class="snapshots.length >= instance.snapshot_limit ? 'text-red-500' : 'text-green-500'">
                ({{ snapshots.length >= instance.snapshot_limit ? t('instance.detail.quotaTab.full') : `${t('instance.detail.quotaTab.remaining')} ${instance.snapshot_limit - snapshots.length}` }})
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 统一保存按钮 -->
      <div class="mt-6 flex justify-end">
        <button 
          :disabled="quotaSaving" 
          class="btn-primary"
          @click="emit('save')"
        >
          {{ quotaSaving ? t('instance.detail.quotaTab.saving') : t('instance.detail.quotaTab.save') }}
        </button>
      </div>

      <div v-if="quotaError" class="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-500">
        {{ quotaError }}
      </div>
    </div>
  </div>
</template>

