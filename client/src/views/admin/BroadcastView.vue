<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'

const { t, d } = useI18n()
const toast = useToast()

const title = ref('')
const content = ref('')
const sending = ref(false)

// 历史记录
interface AnnouncementItem {
  id: number
  type: 'system_broadcast' | 'host_broadcast' | 'admin_message' | 'host_message'
  title: string
  content: string
  recipientCount: number
  createdAt: string
  sender: { id: number; username: string }
}

const historyList = ref<AnnouncementItem[]>([])
const historyLoading = ref(false)
const historyPage = ref(1)
const historyTotal = ref(0)
const historyTotalPages = ref(0)
const pageSize = 100

// 展开/收起历史记录
const showHistory = ref(false)

// 查看详情弹窗
const selectedAnnouncement = ref<AnnouncementItem | null>(null)

// 获取公告类型标签样式
const getTypeBadgeClass = (type: string) => {
  switch (type) {
    case 'system_broadcast':
      return 'bg-gray-100 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
    case 'host_broadcast':
      return 'bg-gray-100 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
    case 'admin_message':
      return 'bg-gray-100 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
    case 'host_message':
      return 'bg-gray-100 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
    default:
      return 'bg-gray-100 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
  }
}

async function loadHistory(page = 1) {
  historyLoading.value = true
  try {
    const result = await api.announcements.list({ page, pageSize })
    historyList.value = result.items
    historyPage.value = result.page
    historyTotal.value = result.total
    historyTotalPages.value = result.totalPages
  } catch (_err: any) {
    toast.error(t('common.loadFailed'))
  } finally {
    historyLoading.value = false
  }
}

function toggleHistory() {
  showHistory.value = !showHistory.value
  if (showHistory.value && historyList.value.length === 0) {
    loadHistory()
  }
}

function viewDetail(item: AnnouncementItem) {
  selectedAnnouncement.value = item
}

function closeDetail() {
  selectedAnnouncement.value = null
}

async function sendBroadcast() {
  if (!title.value.trim()) {
    toast.error(t('admin.broadcast.titleRequired'))
    return
  }
  if (!content.value.trim()) {
    toast.error(t('admin.broadcast.contentRequired'))
    return
  }
  if (title.value.length > 200) {
    toast.error(t('admin.broadcast.titleTooLong'))
    return
  }
  if (content.value.length > 5000) {
    toast.error(t('admin.broadcast.contentTooLong'))
    return
  }

  sending.value = true
  try {
    const result = await api.inbox.broadcast({
      title: title.value.trim(),
      content: content.value.trim()
    })
    toast.success(t('admin.broadcast.sendSuccess', { count: result.count }))
    // 清空表单
    title.value = ''
    content.value = ''
    // 刷新历史列表
    if (showHistory.value) {
      loadHistory(1)
    }
  } catch (err: any) {
    toast.error(t('admin.broadcast.sendFailed') + ': ' + (err?.message || String(err)))
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="kawaii-page nimbus-view space-y-6 animate-fade-in">
    <!-- 页面标题 -->
    <header class="flex flex-col gap-4 border-b border-themed pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex items-start gap-3">
        <span class="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500 sm:flex">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        </span>
        <div>
          <h1 class="text-xl font-semibold text-themed sm:text-2xl">{{ t('admin.broadcast.title') }}</h1>
          <p class="mt-1 text-sm text-themed-muted">{{ t('admin.broadcast.description') }}</p>
        </div>
      </div>
    </header>

    <!-- 发送表单 -->
    <div class="nimbus-card rounded-xl border border-themed bg-themed-surface p-5 sm:p-6">
      <form class="space-y-5" @submit.prevent="sendBroadcast">
        <!-- 标题 -->
        <div>
          <label for="title" class="mb-1.5 block text-sm font-medium text-themed">
            {{ t('admin.broadcast.messageTitle') }}
          </label>
          <input
            id="title"
            v-model="title"
            type="text"
            maxlength="200"
            :placeholder="t('admin.broadcast.titlePlaceholder')"
            class="input"
          />
          <p class="mt-1 text-right font-mono text-2xs tabular-nums text-themed-muted">
            {{ title.length }}/200
          </p>
        </div>

        <!-- 内容 -->
        <div>
          <label for="content" class="mb-1.5 block text-sm font-medium text-themed">
            {{ t('admin.broadcast.messageContent') }}
          </label>
          <textarea
            id="content"
            v-model="content"
            rows="8"
            maxlength="5000"
            :placeholder="t('admin.broadcast.contentPlaceholder')"
            class="input resize-none"
          />
          <p class="mt-1 text-right font-mono text-2xs tabular-nums text-themed-muted">
            {{ content.length }}/5000
          </p>
        </div>

        <!-- 发送按钮 -->
        <div class="flex justify-end">
          <button
            type="submit"
            :disabled="sending || !title.trim() || !content.trim()"
            class="btn-primary"
          >
            <span v-if="sending" class="loading-spinner h-4 w-4"></span>
            {{ sending ? t('common.sending') : t('admin.broadcast.send') }}
          </button>
        </div>
      </form>
    </div>

    <!-- 提示信息 -->
    <div class="flex gap-3 rounded-xl border border-primary-500/20 bg-primary-500/5 p-4">
      <svg class="mt-0.5 h-5 w-5 shrink-0 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm text-themed-secondary">{{ t('admin.broadcast.hint') }}</p>
    </div>

    <!-- 历史记录 -->
    <div class="overflow-hidden rounded-xl border border-themed bg-themed-surface">
      <!-- 标题栏 -->
      <button
        type="button"
        class="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-themed-hover"
        @click="toggleHistory"
      >
        <div class="flex items-center gap-2">
          <svg class="h-5 w-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="font-medium text-themed">{{ t('admin.broadcast.history') }}</span>
          <span v-if="historyTotal > 0" class="font-mono text-xs tabular-nums text-themed-muted">({{ historyTotal }})</span>
        </div>
        <svg
          class="h-5 w-5 text-themed-muted transition-transform duration-200"
          :class="{ 'rotate-180': showHistory }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <!-- 列表内容 -->
      <div v-if="showHistory" class="border-t border-themed">
        <!-- 加载中 -->
        <div v-if="historyLoading" class="flex justify-center p-8">
          <div class="loading-spinner h-8 w-8 text-primary-500"></div>
        </div>

        <!-- 空状态 -->
        <div v-else-if="historyList.length === 0" class="p-10 text-center text-sm text-themed-muted">
          <span class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
          </span>
          {{ t('admin.broadcast.noHistory') }}
        </div>

        <!-- 列表 -->
        <div v-else>
          <div class="divide-y divide-themed">
            <div
              v-for="item in historyList"
              :key="item.id"
              class="cursor-pointer px-5 py-4 transition-colors hover:bg-themed-hover"
              @click="viewDetail(item)"
            >
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium"
                      :class="getTypeBadgeClass(item.type)"
                    >
                      {{ t(`admin.broadcast.types.${item.type}`) }}
                    </span>
                    <h4 class="truncate text-sm font-medium text-themed">{{ item.title }}</h4>
                  </div>
                  <p class="mt-1 truncate text-sm text-themed-muted">{{ item.content }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-4 text-xs text-themed-muted">
                  <span class="font-mono tabular-nums">{{ t('admin.broadcast.recipients', { count: item.recipientCount }) }}</span>
                  <span class="hidden font-mono tabular-nums sm:inline">{{ d(new Date(item.createdAt), 'short') }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 分页 -->
          <div v-if="historyTotalPages > 1" class="flex items-center justify-between border-t border-themed px-5 py-4">
            <button
              type="button"
              :disabled="historyPage <= 1"
              class="btn-secondary btn-sm"
              @click="loadHistory(historyPage - 1)"
            >
              {{ t('common.previous') }}
            </button>
            <span class="font-mono text-xs tabular-nums text-themed-muted">
              {{ historyPage }} / {{ historyTotalPages }}
            </span>
            <button
              type="button"
              :disabled="historyPage >= historyTotalPages"
              class="btn-secondary btn-sm"
              @click="loadHistory(historyPage + 1)"
            >
              {{ t('common.next') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <Teleport to="body">
      <div
        v-if="selectedAnnouncement"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="closeDetail"
      >
        <div class="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-themed bg-themed-surface shadow-2xl">
          <!-- 弹窗头部 -->
          <div class="flex items-center justify-between gap-3 border-b border-themed px-6 py-4">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium"
                :class="getTypeBadgeClass(selectedAnnouncement.type)"
              >
                {{ t(`admin.broadcast.types.${selectedAnnouncement.type}`) }}
              </span>
              <h3 class="truncate text-base font-semibold text-themed">{{ selectedAnnouncement.title }}</h3>
            </div>
            <button
              type="button"
              class="btn-ghost btn-sm -mr-2 p-1.5"
              @click="closeDetail"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 弹窗内容 -->
          <div class="overflow-y-auto px-6 py-4">
            <div class="mb-4 flex flex-wrap gap-4 text-xs text-themed-muted">
              <span>{{ t('admin.broadcast.sender') }}: {{ selectedAnnouncement.sender.username }}</span>
              <span class="font-mono tabular-nums">{{ t('admin.broadcast.recipients', { count: selectedAnnouncement.recipientCount }) }}</span>
              <span class="font-mono tabular-nums">{{ d(new Date(selectedAnnouncement.createdAt), 'long') }}</span>
            </div>
            <pre class="whitespace-pre-wrap break-words font-sans text-sm text-themed-secondary">{{ selectedAnnouncement.content }}</pre>
          </div>

          <!-- 弹窗底部 -->
          <div class="flex justify-end border-t border-themed px-6 py-4">
            <button
              type="button"
              class="btn-secondary"
              @click="closeDetail"
            >
              {{ t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.nimbus-card {
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-view *,
  .nimbus-view *::before,
  .nimbus-view *::after {
    transition-duration: 0.001ms !important;
    animation-duration: 0.001ms !important;
  }
}
</style>
