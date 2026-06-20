<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import api from '@/api'
import { useToast } from '@/stores/toast'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import type { Log } from '@/types/api'

const props = defineProps<{
  instanceId: number
  instanceName: string
}>()

const { t, locale } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

// 数据
const logs = ref<Log[]>([])
const loading = ref<boolean>(true)
const refreshing = ref<boolean>(false)

// 分页
const page = ref<number>(1)
const pageSize = ref<number>(10)
const total = ref<number>(0)
const totalPages = ref<number>(0)

// 筛选
const searchQuery = ref<string>('')

// 展开的内容行
const expandedRows = ref<Set<number>>(new Set())

// 加载日志
async function loadLogs(silent = false): Promise<void> {
  if (!silent) loading.value = true
  else refreshing.value = true
  try {
    const params: { page: number; pageSize: number; instanceId: number; search?: string } = {
      page: page.value,
      pageSize: pageSize.value,
      instanceId: props.instanceId
    }
    if (searchQuery.value) {
      params.search = searchQuery.value
    }
    
    const response = await api.logs.list(params)
    const data = response as { logs?: Log[]; total?: number; totalPages?: number }
    logs.value = data.logs || []
    total.value = data.total || 0
    totalPages.value = data.totalPages || 0
  } catch (err: any) {
    toast.error(t('logs.loadFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

// 搜索
function handleSearch(): void {
  page.value = 1
  loadLogs(true)
}

// 重置筛选
function resetFilters(): void {
  searchQuery.value = ''
  page.value = 1
  loadLogs(true)
}

// 修改每页数量
function handlePageSizeChange(): void {
  page.value = 1
  loadLogs(true)
}

// 格式化日期
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  const date = new Date(dateString)
  const localeMap: Record<string, string> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'en': 'en-US'
  }
  const localeCode = localeMap[locale.value] || 'en-US'
  return date.toLocaleString(localeCode, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// 格式化日期（移动端简短版）
function formatDateShort(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  const date = new Date(dateString)
  const localeMap: Record<string, string> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'en': 'en-US'
  }
  const localeCode = localeMap[locale.value] || 'en-US'
  return date.toLocaleString(localeCode, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 获取结果徽章类名
function getResultClass(result: string): string {
  if (result === 'success') {
    return 'badge-success'
  } else if (result === 'failed') {
    return 'badge-error'
  } else {
    return 'badge-warning'
  }
}

// 切换内容展开/收起
function toggleContent(logId: number): void {
  if (expandedRows.value.has(logId)) {
    expandedRows.value.delete(logId)
  } else {
    expandedRows.value.add(logId)
  }
}

// 检查内容是否需要截断
function isContentLong(content: string): boolean {
  return !!content && content.length > 40
}

// 监听实例变化或重命名
watch(() => [props.instanceId, props.instanceName] as const, () => {
  page.value = 1
  loadLogs()
})

onMounted(async () => {
  await loadLogs()
})
</script>

<template>
  <div class="space-y-4">
    <!-- Filters -->
    <div class="card p-3 sm:p-4">
      <div class="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
        <!-- Search -->
        <div class="flex-1">
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('logs.search') }}</label>
          <div class="flex gap-2">
            <input 
              v-model="searchQuery" 
              type="text"
              class="input flex-1 text-sm" 
              :placeholder="$t('logs.searchPlaceholder')" 
              @keyup.enter="handleSearch"
            />
            <button class="btn-secondary h-[38px] text-sm px-3" @click="handleSearch">
              <svg class="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span class="hidden sm:inline">{{ $t('logs.search') }}</span>
            </button>
            <button class="btn-secondary h-[38px] text-sm px-3" @click="resetFilters">
              <svg class="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span class="hidden sm:inline">{{ $t('logs.reset') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Logs Table -->
    <SkeletonLoader v-if="loading" type="table" />

    <!-- Desktop Table View -->
    <div v-else class="card overflow-hidden hidden sm:block">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[600px]">
          <thead>
            <tr class="border-b border-themed">
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.time') }}</th>
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.action') }}</th>
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.content') }}</th>
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.result') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="logs.length === 0" class="border-b border-themed">
              <td colspan="4" class="py-8 text-center text-themed-secondary">
                {{ $t('logs.noLogs') }}
              </td>
            </tr>
            <tr 
              v-for="log in logs" 
              :key="log.id"
              class="border-b border-themed hover:bg-themed/5 transition-colors"
            >
              <td class="py-3 px-4 text-sm text-themed-secondary whitespace-nowrap">
                {{ formatDate(log.created_at) }}
              </td>
              <td class="py-3 px-4 text-sm text-themed whitespace-nowrap">
                {{ log.action }}
              </td>
              <td class="py-3 px-4 text-sm">
                <div class="max-w-xs lg:max-w-md">
                  <!-- 短内容直接显示 -->
                  <span v-if="!isContentLong(log.content)" class="text-themed-secondary">
                    {{ log.content }}
                  </span>
                  <!-- 长内容可展开 -->
                  <template v-else>
                    <div v-if="!expandedRows.has(log.id)" class="flex items-center gap-1.5">
                      <span class="text-themed-secondary truncate flex-1">{{ log.content.slice(0, 40) }}...</span>
                      <button
                        class="flex-shrink-0 p-1 rounded transition-colors"
                        :class="themeStore.isDark ? 'hover:bg-gray-700 text-blue-400' : 'hover:bg-gray-100 text-blue-500'"
                        :title="$t('logs.expand')"
                        @click="toggleContent(log.id)"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    <div v-else class="space-y-2">
                      <p class="text-themed-secondary whitespace-pre-wrap break-words">{{ log.content }}</p>
                      <button
                        class="text-xs flex items-center gap-1 transition-colors"
                        :class="themeStore.isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-500 hover:text-blue-600'"
                        @click="toggleContent(log.id)"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                        </svg>
                        {{ $t('logs.collapse') }}
                      </button>
                    </div>
                  </template>
                </div>
              </td>
              <td class="py-3 px-4 whitespace-nowrap">
                <span :class="['badge whitespace-nowrap', getResultClass(log.result)]">
                  {{ log.result }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination (Desktop) -->
      <div 
        v-if="total > 0" 
        class="flex items-center justify-between gap-2 px-4 py-3 border-t border-themed"
      >
        <div class="flex items-center gap-3">
          <span class="text-sm text-themed-secondary">
            {{ $t('logs.totalRecords', { total, page, totalPages }) }}
          </span>
          <select
            v-model="pageSize"
            class="text-sm rounded-md border-0 py-1 pl-2 pr-7 ring-1 ring-inset focus:ring-2 focus:ring-primary cursor-pointer"
            :class="themeStore.isDark 
              ? 'bg-gray-800 text-gray-300 ring-gray-700' 
              : 'bg-gray-50 text-gray-700 ring-gray-200'"
            @change="handlePageSizeChange"
          >
            <option :value="10">10 / {{ $t('common.page') }}</option>
            <option :value="30">30 / {{ $t('common.page') }}</option>
            <option :value="50">50 / {{ $t('common.page') }}</option>
          </select>
        </div>
        <div v-if="totalPages > 1" class="flex items-center gap-1">
          <button
            :disabled="page === 1 || refreshing"
            class="inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-colors"
            :class="[
              page === 1 
                ? 'opacity-40 cursor-not-allowed' 
                : themeStore.isDark 
                  ? 'hover:bg-gray-800 text-gray-400' 
                  : 'hover:bg-gray-100 text-gray-600'
            ]"
            @click="page = Math.max(1, page - 1); loadLogs(true)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div 
            class="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium"
            :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
          >
            <span>{{ page }}</span>
            <span :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'">/</span>
            <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">{{ totalPages }}</span>
          </div>
          <button
            :disabled="page === totalPages || refreshing"
            class="inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-colors"
            :class="[
              page === totalPages 
                ? 'opacity-40 cursor-not-allowed' 
                : themeStore.isDark 
                  ? 'hover:bg-gray-800 text-gray-400' 
                  : 'hover:bg-gray-100 text-gray-600'
            ]"
            @click="page = Math.min(totalPages, page + 1); loadLogs(true)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile Card View -->
    <div v-if="!loading" class="space-y-3 sm:hidden">
      <!-- Empty State -->
      <div v-if="logs.length === 0" class="card p-6 text-center text-themed-secondary">
        {{ $t('logs.noLogs') }}
      </div>
      
      <!-- Log Cards -->
      <div 
        v-for="log in logs" 
        :key="log.id"
        class="card p-3 space-y-2"
      >
        <!-- Header: Time + Result -->
        <div class="flex items-center justify-between">
          <span class="text-xs text-themed-muted">{{ formatDateShort(log.created_at) }}</span>
          <span :class="['badge text-xs', getResultClass(log.result)]">
            {{ log.result }}
          </span>
        </div>
        
        <!-- Action -->
        <div class="text-sm font-medium text-themed">
          {{ log.action }}
        </div>
        
        <!-- Content -->
        <div class="text-sm text-themed-secondary">
          <template v-if="!isContentLong(log.content)">
            {{ log.content }}
          </template>
          <template v-else>
            <div v-if="!expandedRows.has(log.id)">
              <span>{{ log.content.slice(0, 60) }}...</span>
              <button
                class="ml-1 text-xs"
                :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-500'"
                @click="toggleContent(log.id)"
              >
                {{ $t('logs.expand') }}
              </button>
            </div>
            <div v-else>
              <p class="whitespace-pre-wrap break-words">{{ log.content }}</p>
              <button
                class="mt-1 text-xs"
                :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-500'"
                @click="toggleContent(log.id)"
              >
                {{ $t('logs.collapse') }}
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- Pagination (Mobile) -->
      <div 
        v-if="total > 0" 
        class="card p-3"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs text-themed-muted">
            {{ page }} / {{ totalPages }}
          </span>
          <div class="flex items-center gap-2">
            <button
              :disabled="page === 1 || refreshing"
              class="btn-secondary btn-sm px-3"
              @click="page = Math.max(1, page - 1); loadLogs(true)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              :disabled="page === totalPages || refreshing"
              class="btn-secondary btn-sm px-3"
              @click="page = Math.min(totalPages, page + 1); loadLogs(true)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
