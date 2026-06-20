<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import type { SshKey } from '@/types/api'

const { t } = useI18n()

interface Props {
  sshKeys: SshKey[]
  selectedKeyId: number | null
  stepNumber?: number  // 步骤编号，默认 4
  title?: string
}

const props = withDefaults(defineProps<Props>(), {
  stepNumber: 4,
  title: undefined
})
const emit = defineEmits<{
  'update:selectedKeyId': [value: number | null]
}>()

const themeStore = useThemeStore()

// 分页相关
const currentPage = ref<number>(1)
const pageSize = 5

const totalPages = computed(() => Math.ceil(props.sshKeys.length / pageSize))

const paginatedKeys = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  const end = start + pageSize
  return props.sshKeys.slice(start, end)
})

// 当 sshKeys 数据变化时，确保 currentPage 在有效范围内
watch(() => props.sshKeys.length, () => {
  if (currentPage.value > totalPages.value && totalPages.value > 0) {
    currentPage.value = totalPages.value
  } else if (totalPages.value === 0) {
    currentPage.value = 1
  }
})

function goToPrevPage(): void {
  if (currentPage.value > 1) {
    currentPage.value--
  }
}

function goToNextPage(): void {
  if (currentPage.value < totalPages.value) {
    currentPage.value++
  }
}
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center gap-2 mb-4">
      <span 
        class="w-6 h-6 rounded-full text-sm font-bold flex items-center justify-center"
        :class="themeStore.isDark ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'"
      >{{ props.stepNumber }}</span>
      <h2 
        class="text-sm font-medium"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ props.title || t('instance.selector.selectSshKey') }}
      </h2>
    </div>

    <div v-if="sshKeys.length === 0" class="text-center py-8">
      <div class="text-4xl mb-3">🔑</div>
      <p class="text-sm text-gray-500 mb-2">
        {{ t('instance.selector.noSshKeys') }}
      </p>
      <p class="text-2xs text-gray-600">
        {{ t('instance.selector.addSshKeyHint') }}
      </p>
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="key in paginatedKeys"
        :key="key.id"
        :class="[
          'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
          selectedKeyId === key.id 
            ? (themeStore.isDark ? 'border-white bg-gray-900' : 'border-gray-900 bg-gray-50')
            : (themeStore.isDark ? 'border-gray-800 hover:border-gray-700' : 'border-gray-200 hover:border-gray-300')
        ]"
        @click="emit('update:selectedKeyId', key.id)"
      >
        <div class="w-8 h-8 rounded bg-themed-secondary flex items-center justify-center">
          <svg class="w-4 h-4 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-themed-secondary">{{ key.name }}</div>
          <div class="text-xs text-themed-faint font-mono truncate">{{ key.fingerprint }}</div>
        </div>
        <div 
          v-if="selectedKeyId === key.id" 
          class="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
          :class="themeStore.isDark ? 'bg-white' : 'bg-gray-900'"
        >
          <svg 
            class="w-2.5 h-2.5" 
            :class="themeStore.isDark ? 'text-gray-900' : 'text-white'"
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
        </div>
      </div>

      <!-- 分页控件 -->
      <div v-if="totalPages > 1" class="flex items-center justify-between mt-3 pt-3 border-t border-themed">
        <span class="text-xs text-themed-muted">
          {{ t('instance.selector.pageInfo', { current: currentPage, total: totalPages, count: sshKeys.length }) }}
        </span>
        <div class="flex items-center gap-2">
          <button 
            class="btn-ghost btn-sm" 
            :disabled="currentPage <= 1" 
            @click="goToPrevPage"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            {{ t('instance.selector.prevPage') }}
          </button>
          <button 
            class="btn-ghost btn-sm" 
            :disabled="currentPage >= totalPages" 
            @click="goToNextPage"
          >
            {{ t('instance.selector.nextPage') }}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
