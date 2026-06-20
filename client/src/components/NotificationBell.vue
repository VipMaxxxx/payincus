<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useInboxStore } from '@/stores/inbox'
import { formatRelativeTime } from '@/utils/formatters'
import {
  getMessageCategory,
  getCategoryColorClass,
  getMessageRoute,
  canNavigate
} from '@/utils/inboxHelper'
import type { InboxMessage } from '@/types/api'
import api from '@/api'

const router = useRouter()
const { t } = useI18n()
const themeStore = useThemeStore()
const inboxStore = useInboxStore()

// 下拉面板状态
const isOpen = ref(false)
const panelRef = ref<HTMLElement | null>(null)

// 最近消息列表
const recentMessages = ref<InboxMessage[]>([])
const loading = ref(false)

// 未读数量
const unreadCount = computed(() => inboxStore.unreadCount)

// 打开/关闭下拉面板
function togglePanel() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    loadRecentMessages()
  }
}

// 加载最近消息
async function loadRecentMessages() {
  loading.value = true
  try {
    const res = await api.inbox.list({ page: 1, pageSize: 5 })
    recentMessages.value = res.messages
  } catch {
    // 静默失败
  } finally {
    loading.value = false
  }
}

// 点击消息
async function handleMessageClick(message: InboxMessage) {
  if (!message.isRead) {
    try {
      await api.inbox.markAsRead(message.id)
      message.isRead = true
      inboxStore.decrementUnread()
    } catch {
      // 静默失败
    }
  }
  isOpen.value = false
  
  // 根据消息类型跳转
  const targetRoute = getMessageRoute(message)
  if (targetRoute) {
    router.push(targetRoute)
  } else {
    router.push('/inbox')
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

// 全部标记已读
async function markAllAsRead() {
  try {
    await api.inbox.markAllAsRead()
    recentMessages.value.forEach(m => m.isRead = true)
    inboxStore.clearUnread()
  } catch {
    // 静默失败
  }
}

// 查看全部
function viewAll() {
  isOpen.value = false
  router.push('/inbox')
}

// 点击外部关闭
function handleClickOutside(event: MouseEvent) {
  if (panelRef.value && !panelRef.value.contains(event.target as Node)) {
    isOpen.value = false
  }
}

// 格式化时间
function formatTime(dateStr: string): string {
  return formatRelativeTime(dateStr, t)
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div ref="panelRef" class="relative">
    <!-- 铃铛按钮 -->
    <button
      class="relative p-1.5 rounded transition-colors touch-target"
      :class="themeStore.isDark ? 'hover:bg-gray-800 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
      :aria-label="t('inbox.notifications')"
      @click.stop="togglePanel"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      <!-- 未读红点 -->
      <span
        v-if="unreadCount > 0"
        class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-medium text-white bg-red-500 rounded-full animate-pulse"
      >
        {{ unreadCount > 99 ? '99+' : unreadCount }}
      </span>
    </button>

    <!-- 下拉面板 -->
    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div
        v-if="isOpen"
        class="fixed sm:absolute left-0 right-0 sm:left-auto sm:right-0 top-14 sm:top-auto sm:mt-2 sm:w-80 sm:rounded-lg shadow-xl py-2 z-50 border-y sm:border"
        :class="themeStore.isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'"
      >
        <!-- 标题栏 -->
        <div class="flex items-center justify-between px-4 pb-2 border-b" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
          <span class="font-medium text-sm" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'">
            {{ t('inbox.notifications') }}
          </span>
          <button
            v-if="unreadCount > 0"
            class="text-xs transition-colors"
            :class="themeStore.isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'"
            @click="markAllAsRead"
          >
            {{ t('inbox.markAllRead') }}
          </button>
        </div>

        <!-- 消息列表 -->
        <div class="max-h-80 overflow-y-auto">
          <!-- 加载中 -->
          <div v-if="loading" class="py-8 text-center">
            <svg class="animate-spin h-5 w-5 mx-auto" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>

          <!-- 无消息 -->
          <div v-else-if="recentMessages.length === 0" class="py-8 text-center">
            <svg class="w-10 h-10 mx-auto mb-2" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-300'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p class="text-sm" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'">
              {{ t('inbox.noMessages') }}
            </p>
          </div>

          <!-- 消息项 -->
          <template v-else>
            <button
              v-for="message in recentMessages"
              :key="message.id"
              class="w-full px-4 py-3 text-left transition-colors"
              :class="[
                themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50',
                !message.isRead ? (themeStore.isDark ? 'bg-gray-800/50' : 'bg-blue-50/50') : ''
              ]"
              @click="handleMessageClick(message)"
            >
              <div class="flex items-start gap-3">
                <!-- 未读标记 -->
                <div class="flex-shrink-0 mt-1.5">
                  <span
                    v-if="!message.isRead"
                    class="block w-2 h-2 rounded-full bg-blue-500"
                  ></span>
                  <span
                    v-else
                    class="block w-2 h-2"
                  ></span>
                </div>
                <!-- 内容 -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 mb-0.5">
                    <!-- 类别标签 -->
                    <span
                      class="px-1 py-0.5 text-[9px] font-medium rounded flex-shrink-0"
                      :class="getTagColorClass(message)"
                    >
                      {{ getCategoryLabel(message) }}
                    </span>
                  </div>
                  <p class="text-sm font-medium truncate" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-800'">
                    {{ message.title }}
                  </p>
                  <p class="text-xs truncate mt-0.5" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                    {{ message.content }}
                  </p>
                  <div class="flex items-center gap-1 mt-1">
                    <p class="text-xs" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'">
                      {{ formatTime(message.createdAt) }}
                    </p>
                    <!-- 可跳转标识 -->
                    <svg
                      v-if="canNavigate(message)"
                      class="w-3 h-3"
                      :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </button>
          </template>
        </div>

        <!-- 底部 -->
        <div class="pt-2 border-t" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
          <button
            class="w-full py-2 text-center text-sm transition-colors"
            :class="themeStore.isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'"
            @click="viewAll"
          >
            {{ t('inbox.viewAll') }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
