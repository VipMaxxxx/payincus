import { defineStore } from 'pinia'
import { ref, computed, type Ref } from 'vue'
import api from '@/api'
import type { AuthUser } from '@/types/store.js'
import type { RegisterRequest } from '@/types/api.js'

export const useAuthStore = defineStore('auth', () => {
  const user: Ref<AuthUser | null> = ref(null)
  const token: Ref<string | null> = ref(localStorage.getItem('token') || null)
  const quota = ref<any>(null)

  // 同步 token 的方法（用于 token 刷新后同步）
  function syncToken() {
    token.value = localStorage.getItem('token')
  }

  // 监听 localStorage 变化（跨窗口同步）
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === 'token') {
        token.value = e.newValue
      }
    })
  }

  const isAuthenticated = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  function applyAuthUser(rawUser: any) {
    user.value = {
      id: rawUser.id,
      username: rawUser.username,
      email: rawUser.email || '',
      role: rawUser.role,
      avatarStyle: rawUser.avatarStyle || 'bigSmile',
      avatarBadgeId: rawUser.avatarBadgeId || null,
      hasCreatedHostBefore: rawUser.hasCreatedHostBefore || false,
      canAccessHostingFeature: rawUser.canAccessHostingFeature ?? true
    }
  }

  async function login(username: string, password: string, totpCode?: string, recoveryCode?: string, turnstileToken?: string) {
    const response = await api.auth.login(username, password, totpCode, recoveryCode, turnstileToken)

    token.value = response.token
    applyAuthUser(response.user)
    localStorage.setItem('token', response.token)
    return response
  }

  async function register(data: RegisterRequest) {
    const response = await api.auth.register(data)

    // 注册成功后自动登录
    token.value = response.token
    applyAuthUser(response.user)
    localStorage.setItem('token', response.token)

    return response
  }

  async function fetchCurrentUser(): Promise<AuthUser | null> {
    if (!token.value) return null
    try {
      const response = await api.auth.me()
      applyAuthUser(response.user)
      // 保存配额信息
      quota.value = (response.user as any).quota || null
      return user.value
    } catch (error: any) {
      if (error?.code === 'UNAUTHORIZED' || error?.response?.status === 401) {
        // 只清除本地状态，不调用后端logout（因为token可能已经无效）
        clearLocalAuth()
      }
      throw error
    }
  }

  // 清除本地认证状态（不调用后端API）
  function clearLocalAuth() {
    token.value = null
    user.value = null
    quota.value = null
    localStorage.removeItem('token')
  }

  async function logout() {
    // 先调用后端登出 API（清除服务端会话和记录日志）
    // 必须在清除本地状态之前调用，否则请求拦截器无法获取 token
    if (token.value) {
      try {
        await api.auth.logout()
      } catch (error) {
        // 后端调用失败不影响本地登出
        console.warn('登出 API 调用失败:', error)
      }
    }

    // 最后清除本地状态
    clearLocalAuth()
  }

  // 初始化：如果存在 token 则获取用户信息
  // 使用 setTimeout 延迟执行，避免在 store 初始化时立即触发请求
  if (token.value && typeof window !== 'undefined') {
    setTimeout(() => {
      fetchCurrentUser().catch(() => {
        // 初始化时静默失败，如果 token 无效会自动清除
      })
    }, 0)
  }

  // 检查会话是否有效（用于页面可见性变化时检查）
  async function checkSession(): Promise<boolean> {
    if (!token.value) {
      return false
    }
    try {
      const response = await api.auth.me()
      applyAuthUser(response.user)
      quota.value = (response.user as any).quota || null
      return true
    } catch (error: any) {
      // 如果是401，说明会话已过期
      if (error?.code === 'UNAUTHORIZED' || error?.response?.status === 401) {
        clearLocalAuth()
        return false
      }
      // 其他错误（如网络错误），不清除状态
      return true
    }
  }

  return {
    user,
    token,
    quota,
    isAuthenticated,
    isAdmin,
    login,
    register,
    fetchCurrentUser,
    logout,
    syncToken,
    clearLocalAuth,
    checkSession
  }
})

