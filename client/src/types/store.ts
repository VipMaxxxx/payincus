/**
 * Store 类型定义
 */

export interface AuthUser {
  id: number
  username: string
  email: string
  role: 'admin' | 'user'
  avatarStyle: string
  avatarBadgeId?: string | null
  hasCreatedHostBefore?: boolean
  canAccessHostingFeature?: boolean
}

export interface ThemeMode {
  mode: 'light' | 'dark' | 'system'
  resolvedTheme: 'light' | 'dark'
  isDark: boolean
}

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  duration: number
  visible: boolean
}

