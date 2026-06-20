<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import { useInboxStore } from '@/stores/inbox'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { formatRelativeTime } from '@/utils/formatters'
import {
  getMessageCategory,
  getCategoryColorClass,
  getMessageRoute,
  canNavigate,
  getAllCategories,
  type MessageCategory
} from '@/utils/inboxHelper'
import type { InboxMessage } from '@/types/api'
import api from '@/api'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const inboxStore = useInboxStore()
const toast = useToast()
const authStore = useAuthStore()

// 消息列表
const messages = ref<InboxMessage[]>([])
const loading = ref(false)
const loaded = ref(false)

// 分页
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const totalPages = computed(() => Math.ceil(total.value / pageSize.value))

// 筛选
const filter = ref<'all' | 'unread'>('all')
const categoryFilter = ref<MessageCategory | 'all'>('all')

// 所有类别（根据用户配额过滤）
const allCategories = getAllCategories()

// 根据用户配额过滤显示的类别
const categories = computed(() => {
  const quota = authStore.quota
  return allCategories.filter(cat => {
    // 好友功能已禁用，隐藏好友分类
    if (cat.key === 'social') {
      return false
    }
    // 如果套餐配额为0，隐藏套餐分类
    if (cat.key === 'package' && quota?.packageLimit === 0) {
      return false
    }
    // 如果套餐配额和节点配额都为0，隐藏配额分类（没有配额警告的意义）
    if (cat.key === 'quota' && quota?.packageLimit === 0 && quota?.hostLimit === 0) {
      return false
    }
    return true
  })
})

// 根据类别筛选后的消息
const filteredMessages = computed(() => {
  if (categoryFilter.value === 'all') return messages.value
  return messages.value.filter(m => getMessageCategory(m.eventType) === categoryFilter.value)
})

// 加载消息列表
async function loadMessages() {
  loading.value = true
  try {
    const res = await api.inbox.list({
      page: currentPage.value,
      pageSize: pageSize.value,
      isRead: filter.value === 'unread' ? false : undefined
    })
    messages.value = res.messages
    total.value = res.total
  } catch (err) {
    console.error('Failed to load inbox messages:', err)
    toast.error(t('common.error'))
  } finally {
    loading.value = false
    loaded.value = true
  }
}

// 标记单条已读
async function markAsRead(message: InboxMessage) {
  if (message.isRead) return
  try {
    await api.inbox.markAsRead(message.id)
    message.isRead = true
    inboxStore.decrementUnread()
  } catch {
    // 静默失败
  }
}

// 全部标记已读
async function markAllAsRead() {
  try {
    const res = await api.inbox.markAllAsRead()
    messages.value.forEach(m => m.isRead = true)
    inboxStore.clearUnread()
    toast.success(t('inbox.markedAllRead'))
    if (res.count > 0) {
      loadMessages()
    }
  } catch {
    toast.error(t('common.error'))
  }
}

// 删除单条消息
async function deleteMessage(message: InboxMessage) {
  if (!confirm(t('inbox.deleteConfirm'))) return
  try {
    await api.inbox.delete(message.id)
    messages.value = messages.value.filter(m => m.id !== message.id)
    total.value--
    if (!message.isRead) {
      inboxStore.decrementUnread()
    }
    toast.success(t('inbox.deleted'))
  } catch {
    toast.error(t('common.error'))
  }
}

// 清空已读
async function deleteReadMessages() {
  if (!confirm(t('inbox.clearConfirm'))) return
  try {
    await api.inbox.deleteRead()
    loadMessages()
    toast.success(t('inbox.cleared'))
  } catch {
    toast.error(t('common.error'))
  }
}

// 切换筛选
function setFilter(newFilter: 'all' | 'unread') {
  filter.value = newFilter
  currentPage.value = 1
  loadMessages()
}

// 切换类别筛选
function setCategoryFilter(category: MessageCategory | 'all') {
  categoryFilter.value = category
}

// 点击消息 - 标记已读并跳转
async function handleMessageClick(message: InboxMessage) {
  await markAsRead(message)
  const targetRoute = getMessageRoute(message)
  if (targetRoute) {
    router.push(targetRoute)
  }
}

// 获取消息的类别标签颜色
function getTagColorClass(message: InboxMessage): string {
  const category = getMessageCategory(message.eventType)
  return getCategoryColorClass(category, themeStore.isDark)
}

// 获取消息类别标签文本
function getCategoryLabel(message: InboxMessage): string {
  const category = getMessageCategory(message.eventType)
  return t(`inbox.categories.${category}`)
}

// 分页
function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadMessages()
}

// 格式化时间
function formatTime(dateStr: string): string {
  return formatRelativeTime(dateStr, t)
}

onMounted(() => {
  loadMessages()
})

// 路由变化时刷新
watch(() => route.path, () => {
  if (route.path === '/inbox') {
    inboxStore.refresh()
  }
})
</script>

<template>
  <div>
    <!-- Header -->
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('inbox.title') }}</h1>
        <p class="page-description">{{ t('inbox.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <!-- 清空已读 -->
        <button
          class="btn-secondary text-sm"
          @click="deleteReadMessages"
        >
          {{ t('inbox.clearRead') }}
        </button>
        <!-- 全部已读 -->
        <button
          class="btn-primary text-sm"
          @click="markAllAsRead"
        >
          {{ t('inbox.markAllRead') }}
        </button>
      </div>
    </div>

    <!-- 筛选标签 -->
    <div class="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:gap-2 mb-4">
      <!-- 已读/未读筛选 -->
      <div class="flex items-center gap-1 sm:mr-4">
        <button
          class="px-3 py-1.5 text-sm rounded-lg transition-colors"
          :class="filter === 'all' 
            ? (themeStore.isDark ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800')
            : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800')"
          @click="setFilter('all')"
        >
          {{ t('inbox.all') }}
        </button>
        <button
          class="px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5"
          :class="filter === 'unread'
            ? (themeStore.isDark ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800')
            : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800')"
          @click="setFilter('unread')"
        >
          {{ t('inbox.unread') }}
          <span
            v-if="inboxStore.unreadCount > 0"
            class="px-1.5 py-0.5 text-xs rounded-full bg-red-500 text-white"
          >
            {{ inboxStore.unreadCount }}
          </span>
        </button>
      </div>

      <!-- 分隔线 - 仅桌面端显示 -->
      <div class="hidden sm:block h-5 w-px" :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-300'"></div>

      <!-- 类别筛选 -->
      <div class="flex flex-wrap items-center gap-1.5 sm:ml-2">
        <button
          class="px-2 py-1 text-xs rounded transition-colors"
          :class="categoryFilter === 'all'
            ? (themeStore.isDark ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-800')
            : (themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700')"
          @click="setCategoryFilter('all')"
        >
          {{ t('inbox.allCategories') }}
        </button>
        <button
          v-for="cat in categories"
          :key="cat.key"
          class="px-2 py-1 text-xs rounded transition-colors"
          :class="categoryFilter === cat.key
            ? getCategoryColorClass(cat.key, themeStore.isDark)
            : (themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700')"
          @click="setCategoryFilter(cat.key)"
        >
          {{ t(cat.config.label) }}
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="card">
      <!-- 加载中 -->
      <div v-if="loading && !loaded" class="p-8 text-center">
        <svg class="animate-spin h-6 w-6 mx-auto" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="mt-2 text-sm text-themed-muted">{{ t('common.loading') }}</p>
      </div>

      <!-- 无消息 -->
      <div v-else-if="messages.length === 0" class="p-8 text-center">
        <svg class="w-12 h-12 mx-auto mb-3" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-300'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <p class="text-themed-muted">
          {{ filter === 'unread' ? t('inbox.noUnread') : t('inbox.noMessages') }}
        </p>
      </div>

      <!-- 消息列表 -->
      <div v-else class="divide-y" :class="themeStore.isDark ? 'divide-gray-700' : 'divide-gray-200'">
        <!-- 无筛选结果提示 -->
        <div v-if="filteredMessages.length === 0" class="p-6 text-center">
          <p class="text-sm text-themed-muted">{{ t('inbox.noCategoryMessages') }}</p>
        </div>

        <div
          v-for="message in filteredMessages"
          :key="message.id"
          class="px-4 py-2.5 flex items-start gap-3 transition-colors"
          :class="[
            !message.isRead ? (themeStore.isDark ? 'bg-gray-800/30' : 'bg-blue-50/50') : '',
            themeStore.isDark ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50',
            canNavigate(message) ? 'cursor-pointer' : ''
          ]"
        >
          <!-- 未读标记 -->
          <div class="flex-shrink-0 pt-1.5">
            <span
              v-if="!message.isRead"
              class="block w-1.5 h-1.5 rounded-full bg-blue-500"
            ></span>
            <span
              v-else
              class="block w-1.5 h-1.5"
            ></span>
          </div>

          <!-- 内容 -->
          <div class="flex-1 min-w-0" @click="handleMessageClick(message)">
            <div class="flex flex-wrap items-center gap-2">
              <!-- 类别标签 -->
              <span
                class="px-1.5 py-0.5 text-[10px] font-medium rounded"
                :class="getTagColorClass(message)"
              >
                {{ getCategoryLabel(message) }}
              </span>
              <h3 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'">
                {{ message.title }}
              </h3>
              <span class="text-xs" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
                {{ formatTime(message.createdAt) }}
              </span>
              <!-- 可跳转图标 -->
              <svg
                v-if="canNavigate(message)"
                class="w-3 h-3 flex-shrink-0"
                :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p class="text-sm whitespace-pre-line leading-relaxed mt-0.5" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
              {{ message.content }}
            </p>
          </div>

          <!-- 操作按钮 -->
          <div class="flex-shrink-0 flex items-center gap-1">
            <button
              v-if="!message.isRead"
              class="p-1 rounded transition-colors"
              :class="themeStore.isDark ? 'hover:bg-gray-700 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-200 text-gray-400 hover:text-gray-600'"
              :title="t('inbox.markRead')"
              @click.stop="markAsRead(message)"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              class="p-1 rounded transition-colors"
              :class="themeStore.isDark ? 'hover:bg-gray-700 text-gray-500 hover:text-red-400' : 'hover:bg-gray-200 text-gray-400 hover:text-red-500'"
              :title="t('common.delete')"
              @click.stop="deleteMessage(message)"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages > 1 && categoryFilter === 'all'" class="px-4 py-3 border-t flex items-center justify-between" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
        <div class="text-sm text-themed-muted">
          {{ t('common.total') }} {{ total }} {{ t('common.items') }}
        </div>
        <div class="flex items-center gap-1">
          <button
            class="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :class="themeStore.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'"
            :disabled="currentPage === 1"
            @click="goToPage(currentPage - 1)"
          >
            {{ t('common.previous') }}
          </button>
          <span class="px-3 py-1 text-sm" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
            {{ currentPage }} / {{ totalPages }}
          </span>
          <button
            class="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :class="themeStore.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'"
            :disabled="currentPage === totalPages"
            @click="goToPage(currentPage + 1)"
          >
            {{ t('common.next') }}
          </button>
        </div>
      </div>
      <!-- 类别筛选时显示当前页筛选结果数量 -->
      <div v-else-if="categoryFilter !== 'all'" class="px-4 py-3 border-t" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
        <div class="text-sm text-themed-muted">
          {{ t('inbox.currentPageFiltered', { count: filteredMessages.length }) }}
        </div>
      </div>
    </div>
  </div>
</template>
