/**
 * 站内信状态管理
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export const useInboxStore = defineStore('inbox', () => {
  // 未读消息数量
  const unreadCount = ref(0)
  
  // 轮询定时器
  let pollTimer: number | null = null
  
  // 是否已初始化
  const initialized = ref(false)

  /**
   * 获取未读消息数量
   */
  async function fetchUnreadCount(): Promise<void> {
    try {
      const res = await api.inbox.getUnreadCount()
      unreadCount.value = res.count
    } catch {
      // 静默失败，不影响用户体验
    }
  }

  /**
   * 启动轮询（登录后调用）
   */
  function startPolling(): void {
    if (initialized.value) return
    
    initialized.value = true
    fetchUnreadCount() // 立即获取一次
    
    // 每 15 秒轮询一次
    pollTimer = window.setInterval(fetchUnreadCount, 15000)
    
    // 监听页面可见性变化
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  /**
   * 停止轮询（登出时调用）
   */
  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    initialized.value = false
    unreadCount.value = 0
  }

  /**
   * 主动刷新（用户操作后调用）
   */
  function refresh(): void {
    fetchUnreadCount()
  }

  /**
   * 页面可见性变化时刷新
   */
  function handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      refresh()
    }
  }

  /**
   * 减少未读数量（标记已读后调用）
   */
  function decrementUnread(count: number = 1): void {
    unreadCount.value = Math.max(0, unreadCount.value - count)
  }

  /**
   * 清零未读数量（全部标记已读后调用）
   */
  function clearUnread(): void {
    unreadCount.value = 0
  }

  return {
    unreadCount,
    initialized,
    fetchUnreadCount,
    startPolling,
    stopPolling,
    refresh,
    decrementUnread,
    clearUnread
  }
})
