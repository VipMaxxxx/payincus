/**
 * 站内信辅助工具
 * 提供消息类型映射、分类、跳转逻辑
 */

import type { InboxMessage } from '@/types/api'

/**
 * 消息类别
 */
export type MessageCategory = 
  | 'instance'   // 实例相关
  | 'snapshot'   // 快照相关
  | 'social'     // 社交互动（好友）
  | 'transfer'   // 实例转移
  | 'package'    // 套餐共享
  | 'security'   // 安全账户
  | 'quota'      // 配额资源
  | 'ticket'     // 工单相关
  | 'system'     // 系统通知

/**
 * 消息类别配置
 */
interface CategoryConfig {
  label: string      // i18n key
  icon: string       // 图标名称（用于前端渲染）
  color: string      // 颜色类名
}

/**
 * 事件类型到类别的映射
 */
const EVENT_TYPE_CATEGORY_MAP: Record<string, MessageCategory> = {
  // 实例相关
  instance_created: 'instance',
  instance_started: 'instance',
  instance_stopped: 'instance',
  instance_restarted: 'instance',
  instance_rebuilt: 'instance',
  instance_cloned: 'instance',
  instance_deleted: 'instance',
  instance_task_failed: 'instance',
  instance_unexpected_stop: 'instance',
  
  // 快照相关
  snapshot_created: 'snapshot',
  snapshot_restored: 'snapshot',
  snapshot_deleted: 'snapshot',
  snapshot_failed: 'snapshot',
  auto_snapshot: 'snapshot',
  auto_snapshot_rotated: 'snapshot',
  
  // 历史备份消息归并到实例类，不再单独显示备份分类
  backup_created: 'instance',
  backup_failed: 'instance',
  backup_deleted: 'instance',
  backup_restored: 'instance',
  backup_uploaded: 'instance',
  auto_backup: 'instance',
  auto_backup_rotated: 'instance',
  
  // 社交互动
  friend_request: 'social',
  friend_accepted: 'social',
  friend_rejected: 'social',
  friend_removed: 'social',
  
  // 套餐共享
  package_shared: 'package',
  package_share_revoked: 'package',
  
  // 实例转移
  transfer_received: 'transfer',
  transfer_accepted: 'transfer',
  transfer_rejected: 'transfer',
  transfer_cancelled: 'transfer',
  
  // 安全账户
  login_new_device: 'security',
  password_changed: 'security',
  '2fa_enabled': 'security',
  '2fa_disabled': 'security',
  
  // 配额资源
  quota_warning: 'quota',
  
  // 工单相关
  ticket_created: 'ticket',
  ticket_replied: 'ticket',
  ticket_status_changed: 'ticket',
  ticket_closed: 'ticket',
  
  // 系统公告
  system_announcement: 'system',
  host_announcement: 'system',
  admin_message: 'system',
  host_message: 'system',

  // AFF 推荐计划
  aff_convert_approved: 'system',
  aff_convert_rejected: 'system'
}

/**
 * 类别配置
 */
const CATEGORY_CONFIG: Record<MessageCategory, CategoryConfig> = {
  instance: {
    label: 'inbox.categories.instance',
    icon: 'server',
    color: 'blue'
  },
  snapshot: {
    label: 'inbox.categories.snapshot',
    icon: 'camera',
    color: 'purple'
  },
  social: {
    label: 'inbox.categories.social',
    icon: 'users',
    color: 'pink'
  },
  transfer: {
    label: 'inbox.categories.transfer',
    icon: 'arrow-right',
    color: 'orange'
  },
  package: {
    label: 'inbox.categories.package',
    icon: 'gift',
    color: 'cyan'
  },
  security: {
    label: 'inbox.categories.security',
    icon: 'shield',
    color: 'red'
  },
  quota: {
    label: 'inbox.categories.quota',
    icon: 'chart',
    color: 'yellow'
  },
  ticket: {
    label: 'inbox.categories.ticket',
    icon: 'ticket',
    color: 'indigo'
  },
  system: {
    label: 'inbox.categories.system',
    icon: 'bell',
    color: 'gray'
  }
}

/**
 * 获取消息类别
 */
export function getMessageCategory(eventType: string): MessageCategory {
  return EVENT_TYPE_CATEGORY_MAP[eventType] || 'system'
}

/**
 * 获取类别配置
 */
export function getCategoryConfig(category: MessageCategory): CategoryConfig {
  return CATEGORY_CONFIG[category]
}

/**
 * 获取所有类别列表
 */
export function getAllCategories(): { key: MessageCategory; config: CategoryConfig }[] {
  return Object.entries(CATEGORY_CONFIG).map(([key, config]) => ({
    key: key as MessageCategory,
    config
  }))
}

/**
 * 获取类别对应的 CSS 颜色类
 */
export function getCategoryColorClass(category: MessageCategory, isDark: boolean): string {
  const colorMap: Record<string, { light: string; dark: string }> = {
    blue: { light: 'bg-blue-100 text-blue-700', dark: 'bg-blue-900/50 text-blue-300' },
    purple: { light: 'bg-purple-100 text-purple-700', dark: 'bg-purple-900/50 text-purple-300' },
    green: { light: 'bg-green-100 text-green-700', dark: 'bg-green-900/50 text-green-300' },
    pink: { light: 'bg-pink-100 text-pink-700', dark: 'bg-pink-900/50 text-pink-300' },
    orange: { light: 'bg-orange-100 text-orange-700', dark: 'bg-orange-900/50 text-orange-300' },
    cyan: { light: 'bg-cyan-100 text-cyan-700', dark: 'bg-cyan-900/50 text-cyan-300' },
    red: { light: 'bg-red-100 text-red-700', dark: 'bg-red-900/50 text-red-300' },
    yellow: { light: 'bg-yellow-100 text-yellow-700', dark: 'bg-yellow-900/50 text-yellow-300' },
    indigo: { light: 'bg-indigo-100 text-indigo-700', dark: 'bg-indigo-900/50 text-indigo-300' },
    gray: { light: 'bg-gray-100 text-gray-700', dark: 'bg-gray-700 text-gray-300' }
  }
  
  const config = getCategoryConfig(category)
  const colors = colorMap[config.color] || colorMap.gray
  return isDark ? colors.dark : colors.light
}

/**
 * 根据消息数据生成跳转路由
 * 返回 null 表示不支持跳转
 */
export function getMessageRoute(message: InboxMessage): string | null {
  const { eventType, data } = message
  
  if (!data) return null
  
  const category = getMessageCategory(eventType)
  
  switch (category) {
    case 'instance':
    case 'snapshot':
      // 实例/快照相关 - 跳转到实例详情
      if (data.instanceId) {
        return `/instances/${data.instanceId}`
      }
      break
      
    case 'social':
      // 好友功能已禁用，不进行跳转
      return null
      
    case 'transfer':
      // 转移相关 - 跳转到转移页面
      return '/transfers'
      
    case 'package':
      // 套餐共享 - 跳转到套餐页面
      if (data.packageId) {
        return `/resources/packages/${data.packageId}`
      }
      return '/resources/packages'
      
    case 'security':
      // 安全相关 - 跳转到个人设置
      return '/profile'
      
    case 'quota':
      // 配额相关 - 跳转到概览
      return '/dashboard'
      
    case 'ticket':
      // 工单相关 - 跳转到工单页面
      if (data.ticketId) {
        return `/tickets?id=${data.ticketId}`
      }
      return '/tickets'
  }
  
  return null
}

/**
 * 判断消息是否支持跳转
 */
export function canNavigate(message: InboxMessage): boolean {
  return getMessageRoute(message) !== null
}
