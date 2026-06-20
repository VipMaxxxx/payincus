<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
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
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'host_broadcast':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'admin_message':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
    case 'host_message':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
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
  <div class="space-y-6">
    <!-- 页面标题 -->
    <div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
        {{ t('admin.broadcast.title') }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('admin.broadcast.description') }}
      </p>
    </div>

    <!-- 发送表单 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <form class="space-y-4" @submit.prevent="sendBroadcast">
        <!-- 标题 -->
        <div>
          <label for="title" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ t('admin.broadcast.messageTitle') }}
          </label>
          <input
            id="title"
            v-model="title"
            type="text"
            maxlength="200"
            :placeholder="t('admin.broadcast.titlePlaceholder')"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md 
                   bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                   focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent"
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ title.length }}/200
          </p>
        </div>

        <!-- 内容 -->
        <div>
          <label for="content" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ t('admin.broadcast.messageContent') }}
          </label>
          <textarea
            id="content"
            v-model="content"
            rows="8"
            maxlength="5000"
            :placeholder="t('admin.broadcast.contentPlaceholder')"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md 
                   bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                   focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent
                   resize-none"
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ content.length }}/5000
          </p>
        </div>

        <!-- 发送按钮 -->
        <div class="flex justify-end">
          <button
            type="submit"
            :disabled="sending || !title.trim() || !content.trim()"
            class="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-md
                   hover:bg-gray-800 dark:hover:bg-gray-200
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors duration-200"
          >
            <span v-if="sending">{{ t('common.sending') }}</span>
            <span v-else>{{ t('admin.broadcast.send') }}</span>
          </button>
        </div>
      </form>
    </div>

    <!-- 提示信息 -->
    <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
      <div class="flex">
        <svg class="w-5 h-5 text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
        </svg>
        <div class="ml-3">
          <p class="text-sm text-blue-700 dark:text-blue-300">
            {{ t('admin.broadcast.hint') }}
          </p>
        </div>
      </div>
    </div>

    <!-- 历史记录 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow">
      <!-- 标题栏 -->
      <button
        type="button"
        class="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        @click="toggleHistory"
      >
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="font-medium text-gray-900 dark:text-white">{{ t('admin.broadcast.history') }}</span>
          <span v-if="historyTotal > 0" class="text-sm text-gray-500 dark:text-gray-400">({{ historyTotal }})</span>
        </div>
        <svg
          class="w-5 h-5 text-gray-400 transition-transform duration-200"
          :class="{ 'rotate-180': showHistory }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <!-- 列表内容 -->
      <div v-if="showHistory" class="border-t border-gray-200 dark:border-gray-700">
        <!-- 加载中 -->
        <div v-if="historyLoading" class="p-8 flex justify-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
        </div>

        <!-- 空状态 -->
        <div v-else-if="historyList.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400">
          {{ t('admin.broadcast.noHistory') }}
        </div>

        <!-- 列表 -->
        <div v-else>
          <div class="divide-y divide-gray-200 dark:divide-gray-700">
            <div
              v-for="item in historyList"
              :key="item.id"
              class="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
              @click="viewDetail(item)"
            >
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                      :class="getTypeBadgeClass(item.type)"
                    >
                      {{ t(`admin.broadcast.types.${item.type}`) }}
                    </span>
                    <h4 class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ item.title }}</h4>
                  </div>
                  <p class="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">{{ item.content }}</p>
                </div>
                <div class="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 shrink-0">
                  <span>{{ t('admin.broadcast.recipients', { count: item.recipientCount }) }}</span>
                  <span class="hidden sm:inline">{{ d(new Date(item.createdAt), 'short') }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 分页 -->
          <div v-if="historyTotalPages > 1" class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <button
              type="button"
              :disabled="historyPage <= 1"
              class="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md
                     text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
                     disabled:opacity-50 disabled:cursor-not-allowed"
              @click="loadHistory(historyPage - 1)"
            >
              {{ t('common.previous') }}
            </button>
            <span class="text-sm text-gray-500 dark:text-gray-400">
              {{ historyPage }} / {{ historyTotalPages }}
            </span>
            <button
              type="button"
              :disabled="historyPage >= historyTotalPages"
              class="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md
                     text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
                     disabled:opacity-50 disabled:cursor-not-allowed"
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
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        @click.self="closeDetail"
      >
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
          <!-- 弹窗头部 -->
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                :class="getTypeBadgeClass(selectedAnnouncement.type)"
              >
                {{ t(`admin.broadcast.types.${selectedAnnouncement.type}`) }}
              </span>
              <h3 class="text-lg font-medium text-gray-900 dark:text-white">{{ selectedAnnouncement.title }}</h3>
            </div>
            <button
              type="button"
              class="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
              @click="closeDetail"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 弹窗内容 -->
          <div class="px-6 py-4 overflow-y-auto max-h-[60vh]">
            <div class="mb-4 flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400">
              <span>{{ t('admin.broadcast.sender') }}: {{ selectedAnnouncement.sender.username }}</span>
              <span>{{ t('admin.broadcast.recipients', { count: selectedAnnouncement.recipientCount }) }}</span>
              <span>{{ d(new Date(selectedAnnouncement.createdAt), 'long') }}</span>
            </div>
            <div class="prose dark:prose-invert max-w-none">
              <pre class="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-normal">{{ selectedAnnouncement.content }}</pre>
            </div>
          </div>

          <!-- 弹窗底部 -->
          <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
            <button
              type="button"
              class="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md
                     hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
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
