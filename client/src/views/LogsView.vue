<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import api from '@/api'
import { useToast } from '@/stores/toast'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import type { Log } from '@/types/api'

// 为 KeepAlive include 匹配定义组件名称（必须在所有 import 之后）
defineOptions({ name: 'LogsView' })

const { t, locale } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

// 数据
const logs = ref<Log[]>([])
const loading = ref<boolean>(true)   // 首次加载
const refreshing = ref<boolean>(false)  // 后台刷新
const modules = ref<string[]>([])

// 分页
const page = ref<number>(1)
const pageSize = ref<number>(100)
const total = ref<number>(0)
const totalPages = ref<number>(0)

// 筛选
const selectedModule = ref<string>('')
const searchQuery = ref<string>('')

// 展开的内容行
const expandedRows = ref<Set<number>>(new Set())

// 加载日志
async function loadLogs(silent = false): Promise<void> {
  if (!silent) loading.value = true
  else refreshing.value = true
  try {
    const params: { page: number; pageSize: number; module?: string; search?: string } = {
      page: page.value,
      pageSize: pageSize.value
    }
    if (selectedModule.value) {
      params.module = selectedModule.value
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

// 加载模块
async function loadModules(): Promise<void> {
  try {
    const response = await api.logs.getModules()
    modules.value = (response as { modules?: string[] }).modules || []
  } catch {
    // 静默失败
  }
}

// 搜索
function handleSearch(): void {
  page.value = 1
  loadLogs(true)  // 静默刷新
}

// 重置筛选
function resetFilters(): void {
  selectedModule.value = ''
  searchQuery.value = ''
  page.value = 1
  loadLogs(true)  // 静默刷新
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
  // 支援 zh-CN, zh-TW, en 三種語言
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

// 格式化结果文本 - 直接显示原始值
function formatResult(result: string): string {
  return result
}

// 格式化模块文本 - 直接显示原始值
function formatModule(module: string): string {
  return module
}

// 格式化操作文本 - 直接显示原始值
function formatAction(action: string): string {
  return action
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
  return !!content && content.length > 60
}

onMounted(async () => {
  await Promise.all([loadModules(), loadLogs()])
})
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <h1 class="page-title">{{ $t('logs.title') }}</h1>
    </div>

    <!-- Filters -->
    <div class="card p-4">
      <div class="flex flex-wrap items-end gap-4">
        <!-- Module filter -->
        <div class="flex-1 min-w-[200px]">
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('logs.module') }}</label>
          <select 
            v-model="selectedModule" 
            class="input"
            @change="handleSearch"
          >
            <option value="">{{ $t('logs.allModules') }}</option>
            <option v-for="m in modules" :key="m" :value="m">{{ formatModule(m) }}</option>
          </select>
        </div>

        <!-- Search -->
        <div class="flex-1 min-w-[200px]">
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('logs.search') }}</label>
          <div class="flex gap-2">
            <input 
              v-model="searchQuery" 
              type="text"
              class="input flex-1" 
              :placeholder="$t('logs.searchPlaceholder')" 
              @keyup.enter="handleSearch"
            />
            <button class="btn-secondary h-[38px]" @click="handleSearch">{{ $t('logs.search') }}</button>
            <button class="btn-secondary h-[38px]" @click="resetFilters">{{ $t('logs.reset') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Logs Table -->
    <SkeletonLoader v-if="loading" type="table" />

    <div v-else class="card overflow-x-auto">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[800px]">
          <thead>
            <tr class="border-b border-themed">
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.time') }}</th>
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.user') }}</th>
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.module') }}</th>
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.action') }}</th>
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.content') }}</th>
              <th class="text-left py-3 px-4 text-xs font-medium text-themed-muted whitespace-nowrap">{{ $t('logs.result') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="logs.length === 0" class="border-b border-themed">
              <td colspan="6" class="py-8 text-center text-themed-secondary">
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
                {{ log.username || $t('logs.system') }}
              </td>
              <td class="py-3 px-4 text-sm text-themed whitespace-nowrap">
                <span class="badge badge-default whitespace-nowrap">{{ formatModule(log.module) }}</span>
              </td>
              <td class="py-3 px-4 text-sm text-themed whitespace-nowrap">
                {{ formatAction(log.action) }}
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
                      <span class="text-themed-secondary truncate flex-1">{{ log.content.slice(0, 50) }}...</span>
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
                  {{ formatResult(log.result) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div 
        v-if="total > 0" 
        class="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3 border-t border-themed"
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
            <option :value="100">100 / {{ $t('common.page') }}</option>
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
  </div>
</template>

