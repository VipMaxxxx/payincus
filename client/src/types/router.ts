/**
 * Router 类型定义
 */

import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresAdmin?: boolean
    requiresUser?: boolean  // 仅普通用户可访问（禁止管理员）
    guest?: boolean
    title?: string
    titleKey?: string
  }
}

