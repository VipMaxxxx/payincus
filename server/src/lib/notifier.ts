/**
 * 通知发送服务
 * 支持 Telegram、Discord、Email、Webhook 等通知方式
 * 包含自动重试机制
 */

import * as db from '../db/index.js'
import { createInboxMessage } from '../db/inbox.js'
import { prisma } from '../db/prisma.js'
import { assertSafeWebhookUrl } from './outbound-security.js'
import { sanitizeTokensInString } from './log-sanitizer.js'

// 重试配置
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
const NOTIFICATION_FETCH_TIMEOUT_MS = 15_000
const NOTIFICATION_ERROR_PREVIEW_MAX_CHARS = 2_000

type EventType =
  | 'snapshot_created'
  | 'snapshot_restored'
  | 'snapshot_deleted'
  | 'snapshot_failed'
  | 'backup_created'
  | 'backup_failed'
  | 'backup_deleted'
  | 'backup_restored'
  | 'backup_uploaded'
  | 'instance_created'
  | 'instance_create_failed'
  | 'instance_create_timeout'
  | 'instance_started'
  | 'instance_stopped'
  | 'instance_restarted'
  | 'instance_rebuilt'
  | 'instance_cloned'
  | 'instance_host_changed'
  | 'instance_task_failed'
  | 'instance_unexpected_stop'
  | 'instance_deleted'
  | 'instance_deleted_by_host_owner'
  | 'instance_suspended'
  | 'instance_unsuspended'
  // 计费相关
  | 'instance_renewed'
  | 'instance_plan_changed'
  | 'instance_price_changed'
  | 'instance_expiring'
  | 'instance_extended'
  | 'instances_batch_extended'
  | 'auto_renew_failed'
  | 'refund_completed'
  | 'instance_deleted_refunded'
  | 'auto_snapshot'
  | 'auto_snapshot_rotated'
  | 'auto_backup'
  | 'auto_backup_rotated'
  // 社交互动类
  | 'friend_request'
  | 'friend_accepted'
  | 'friend_rejected'
  | 'friend_removed'
  // 套餐与共享类
  | 'package_shared'
  | 'package_share_revoked'
  // 实例转移类
  | 'transfer_received'
  | 'transfer_accepted'
  | 'transfer_rejected'
  | 'transfer_cancelled'
  // 安全与账户类
  | 'login_new_device'
  | 'password_changed'
  | '2fa_enabled'
  | '2fa_disabled'
  // 配额与资源类
  | 'quota_warning'
  // 工单类
  | 'ticket_created'
  | 'ticket_replied'
  | 'ticket_status_changed'
  | 'ticket_closed'
  | 'ticket_auto_closed'
  // 签到类
  | 'redeem_code_used'
  // AFF相关
  | 'aff_applied'
  // 托管节点价格调整
  | 'instance_renewal_price_updated'

interface EventData {
  instanceName?: string
  snapshotName?: string
  backupName?: string
  status?: string
  error?: string
  // 删除原因（宿主机所有者删除时）
  deleteReason?: string
  // 封停原因
  suspendReason?: string
  suspendedBy?: string
  // 实例详细信息
  hostName?: string           // 宿主机名称
  oldHostName?: string        // 原宿主机名称
  newHostName?: string        // 新宿主机名称
  hostLocation?: string       // 宿主机位置
  image?: string              // 镜像名称
  cpu?: number                // CPU 配置 (%)
  memory?: number             // 内存 (MB)
  disk?: number               // 磁盘 (MB)
  ipv4?: string               // IPv4 地址
  ipv6?: string               // IPv6 地址
  networkMode?: string        // 网络模式
  packageName?: string        // 套餐名称
  // 备份相关
  storageName?: string        // 存储配置名称
  fileName?: string           // 文件名
  backupSize?: string         // 备份大小
  // 自动策略轮换相关
  deletedName?: string        // 被删除的旧快照/备份名称
  quotaLimit?: number         // 配额上限
  // 时间相关
  createdAt?: string          // 创建时间
  // 社交互动相关
  fromUsername?: string       // 来源用户名
  toUsername?: string         // 目标用户名
  // 套餐共享相关
  ownerUsername?: string      // 套餐所有者
  // 实例转移相关
  senderUsername?: string     // 转出方用户名
  receiverUsername?: string   // 接收方用户名
  // 安全相关
  deviceInfo?: string         // 设备信息
  ipAddress?: string          // IP 地址
  loginTime?: string          // 登录时间
  // 配额相关
  quotaType?: string          // 配额类型
  currentUsed?: number        // 当前已用
  maxLimit?: number           // 最大限制
  usagePercent?: number       // 使用百分比
  // 工单相关
  username?: string           // 用户名（工单创建者）
  subject?: string            // 工单主题
  replyFrom?: string          // 回复者用户名
  newStatus?: string          // 新状态
  closedBy?: string           // 关闭者用户名
  // 计费相关
  renewMonths?: number        // 续费月数
  renewAmount?: number        // 续费金额
  newExpiresAt?: string       // 新到期时间
  oldPlanName?: string        // 原套餐方案名称
  newPlanName?: string        // 新套餐方案名称
  priceDiff?: number          // 价格差异（升降级）
  oldPrice?: number            // 原价格（续费价格修改）
  newPrice?: number            // 新价格（续费价格修改）
  isIncrease?: boolean         // 是否为升级（价格升降级）
  daysRemaining?: number      // 剩余天数
  days?: number               // 延期天数
  amount?: number             // 金额（通用）
  reason?: string             // 原因（通用）
  failReason?: string         // 失败原因
  refundAmount?: number       // 退款金额
  feeAmount?: number          // 手续费金额
  refundType?: string         // 退款方式
  discountPercent?: number    // 折扣百分比（如 5 表示 5%）
  [key: string]: unknown
  newImage?: string
  taskType?: string
}

interface EventTemplate {
  title: string
  message: (data: EventData) => string
}

interface NotificationResult {
  success: boolean
  error: string | null
}

interface SendResult {
  sent: number
  failed: number
}

interface TelegramConfig {
  botToken: string
  chatId: string
}

interface DiscordConfig {
  webhookUrl: string
}

interface WebhookConfig {
  url: string
  secret?: string
}

interface NotificationChannel {
  id: number
  type: 'telegram' | 'discord' | 'email' | 'webhook'
  config: string | Record<string, unknown>
}

/**
 * 格式化内存大小
 */
function formatMemory(mb: number | undefined): string {
  if (!mb) return '-'
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

/**
 * 格式化磁盘大小
 */
function formatDisk(mb: number | undefined): string {
  if (!mb) return '-'
  if (mb >= 1024) return `${(mb / 1024).toFixed(0)} GB`
  return `${mb} MB`
}

/**
 * 事件类型与消息模板
 * 美化版本：包含更多详细信息
 */
const EVENT_TEMPLATES: Record<EventType, EventTemplate> = {
  snapshot_created: {
    title: '✅ 快照创建成功',
    message: (data) => {
      let msg = `实例「${data.instanceName}」的快照「${data.snapshotName}」创建成功`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  snapshot_restored: {
    title: '🔄 快照恢复成功',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已从快照「${data.snapshotName}」恢复`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  snapshot_deleted: {
    title: '🗑️ 快照已删除',
    message: (data) => `实例「${data.instanceName}」的快照「${data.snapshotName}」已删除`
  },
  snapshot_failed: {
    title: '❌ 快照创建失败',
    message: (data) => {
      let msg = `实例「${data.instanceName}」的快照创建失败`
      if (data.error) msg += `\n错误: ${data.error}`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  backup_created: {
    title: '✅ 备份创建成功',
    message: (data) => {
      let msg = `实例「${data.instanceName}」的备份「${data.backupName}」创建成功`
      if (data.backupSize) msg += ` (${data.backupSize})`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  backup_failed: {
    title: '❌ 备份创建失败',
    message: (data) => {
      let msg = `实例「${data.instanceName}」的备份创建失败`
      if (data.error) msg += `\n错误: ${data.error}`
      return msg
    }
  },
  backup_deleted: {
    title: '🗑️ 备份已删除',
    message: (data) => `实例「${data.instanceName}」的备份「${data.backupName}」已删除`
  },
  backup_restored: {
    title: '🔄 备份恢复成功',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已从备份「${data.backupName}」恢复`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  backup_uploaded: {
    title: '☁️ 备份上传成功',
    message: (data) => {
      let msg = `实例「${data.instanceName}」的备份「${data.backupName}」已上传`
      if (data.storageName) msg += `\n存储: ${data.storageName}`
      if (data.fileName) msg += `\n文件: ${data.fileName}`
      return msg
    }
  },
  instance_created: {
    title: '🚀 实例创建成功',
    message: (data) => {
      let msg = `您的实例「${data.instanceName}」已创建成功！`
      if (data.hostName) {
        msg += `\n节点: ${data.hostName}`
        if (data.hostLocation) msg += ` (${data.hostLocation})`
      }
      if (data.image) msg += `\n镜像: ${data.image}`
      // 资源配置在一行显示
      const resources: string[] = []
      if (data.cpu) resources.push(`CPU ${data.cpu}%`)
      if (data.memory) resources.push(`内存 ${formatMemory(data.memory)}`)
      if (data.disk) resources.push(`磁盘 ${formatDisk(data.disk)}`)
      if (resources.length > 0) msg += `\n配置: ${resources.join(' | ')}`
      if (data.networkMode) msg += `\n网络: ${data.networkMode === 'nat_ipv6' ? 'NAT + IPv6' : data.networkMode === 'nat' ? 'NAT' : data.networkMode}`
      if (data.ipv4) msg += `\nIPv4: ${data.ipv4}`
      if (data.ipv6) msg += `\nIPv6: ${data.ipv6}`
      return msg
    }
  },
  instance_create_failed: {
    title: '❌ 实例创建失败',
    message: (data) => {
      let msg = `您的实例「${data.instanceName}」创建失败`
      if (data.error) msg += `\n错误: ${data.error}`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      msg += `\n资源已自动回滚，请稍后重试或联系管理员`
      return msg
    }
  },
  instance_create_timeout: {
    title: '⏰ 实例创建超时',
    message: (data) => {
      let msg = `您的实例「${data.instanceName}」创建超时（超过10分钟）`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      msg += `\n资源已自动回滚，请稍后重试`
      msg += `\n可能原因: 镜像下载缓慢 / 节点繁忙 / 网络问题`
      return msg
    }
  },
  instance_started: {
    title: '▶️ 实例已启动',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已成功启动`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      if (data.ipv4) msg += `\nIPv4: ${data.ipv4}`
      if (data.ipv6) msg += `\nIPv6: ${data.ipv6}`
      return msg
    }
  },
  instance_stopped: {
    title: '⏹️ 实例已停止',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已停止运行`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  instance_restarted: {
    title: '🔄 实例已重启',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已重启完成`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      if (data.ipv4) msg += `\nIPv4: ${data.ipv4}`
      if (data.ipv6) msg += `\nIPv6: ${data.ipv6}`
      return msg
    }
  },
  instance_rebuilt: {
    title: '🛠️ 实例已重装',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已成功重装系统`
      if (data.newImage) msg += `\n新镜像: ${data.newImage}`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  instance_cloned: {
    title: '📋 实例已克隆',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已成功克隆`
      if (data.newInstanceName) msg += `\n新实例: ${data.newInstanceName}`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  instance_host_changed: {
    title: '🔁 实例已改节点',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已成功迁移到新节点`
      if (data.oldHostName || data.newHostName) msg += `\n节点: ${data.oldHostName || '-'} -> ${data.newHostName || '-'}`
      if (data.ipv4) msg += `\nIPv4: ${data.ipv4}`
      if (data.ipv6) msg += `\nIPv6: ${data.ipv6}`
      return msg
    }
  },
  instance_task_failed: {
    title: '❌ 实例操作失败',
    message: (data) => {
      let msg = `实例「${data.instanceName}」的操作失败`
      if (data.taskType) msg += `\n操作: ${data.taskType}`
      if (data.error) msg += `\n错误: ${data.error}`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  instance_unexpected_stop: {
    title: '⚠️ 实例异常停止',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已异常停止运行`
      msg += `\n可能原因: 节点资源不足 / 实例崩溃 / 管理员操作`
      if (data.hostName) msg += `\n节点: ${data.hostName.toUpperCase()}`
      msg += `\n请前往面板检查实例状态`
      return msg
    }
  },
  instance_deleted: {
    title: '🗑️ 实例已删除',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已永久删除`
      if (data.hostName) msg += `\n原节点: ${data.hostName}`
      return msg
    }
  },
  instance_deleted_by_host_owner: {
    title: '⚠️ 您的实例已被删除',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已被删除`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      if (data.deleteReason) msg += `\n原因: ${data.deleteReason}`
      return msg
    }
  },
  instance_suspended: {
    title: '🚫 您的实例已被封停',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已被封停`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      if (data.suspendReason) msg += `\n原因: ${data.suspendReason}`
      msg += `\n封停期间，实例无法启动、重启、重装等操作`
      msg += `\n如有疑问，请发送工单`
      return msg
    }
  },
  instance_unsuspended: {
    title: '✅ 您的实例已解除封停',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已解除封停`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      msg += `\n您现在可以正常使用该实例`
      return msg
    }
  },
  auto_snapshot: {
    title: '📸 自动快照完成',
    message: (data) => {
      let msg = `实例「${data.instanceName}」自动快照完成`
      msg += `\n快照: ${data.snapshotName}`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  auto_snapshot_rotated: {
    title: '🔄 自动快照轮换',
    message: (data) => {
      let msg = `实例「${data.instanceName}」快照配额已满 (${data.quotaLimit} 个)`
      msg += `\n已删除: ${data.deletedName}`
      msg += `\n已创建: ${data.snapshotName}`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  auto_backup: {
    title: '💾 自动备份完成',
    message: (data) => {
      let msg = `实例「${data.instanceName}」自动备份完成`
      msg += `\n备份: ${data.backupName}`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  auto_backup_rotated: {
    title: '🔄 自动备份轮换',
    message: (data) => {
      let msg = `实例「${data.instanceName}」备份配额已满 (${data.quotaLimit} 个)`
      msg += `\n已删除: ${data.deletedName}`
      msg += `\n已创建: ${data.backupName}`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },

  // ==================== 社交互动类 ====================
  friend_request: {
    title: '👥 新的好友申请',
    message: (data) => `用户「${data.fromUsername}」向您发送了好友申请，请前往好友管理页面处理`
  },
  friend_accepted: {
    title: '✅ 好友申请已通过',
    message: (data) => `用户「${data.toUsername}」已接受您的好友申请，您们现在是好友了`
  },
  friend_rejected: {
    title: '❌ 好友申请被拒绝',
    message: (data) => `用户「${data.toUsername}」拒绝了您的好友申请`
  },
  friend_removed: {
    title: '💔 好友关系已解除',
    message: (data) => `用户「${data.fromUsername}」已将您从好友列表中移除`
  },

  // ==================== 套餐与共享类 ====================
  package_shared: {
    title: '🎁 收到套餐共享',
    message: (data) => `用户「${data.ownerUsername}」将套餐「${data.packageName}」共享给您，您现在可以使用该套餐创建实例`
  },
  package_share_revoked: {
    title: '🚫 套餐共享已撤销',
    message: (data) => `用户「${data.ownerUsername}」已撤销套餐「${data.packageName}」的共享`
  },

  // ==================== 实例转移类 ====================
  transfer_received: {
    title: '📨 收到实例转移请求',
    message: (data) => {
      let msg = `用户「${data.senderUsername}」希望将实例「${data.instanceName}」转移给您`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      msg += `\n请前往转移管理页面处理`
      return msg
    }
  },
  transfer_accepted: {
    title: '✅ 实例转移已接受',
    message: (data) => {
      let msg = `用户「${data.receiverUsername}」已接受实例「${data.instanceName}」的转移请求`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  transfer_rejected: {
    title: '❌ 实例转移被拒绝',
    message: (data) => `用户「${data.receiverUsername}」拒绝了实例「${data.instanceName}」的转移请求`
  },
  transfer_cancelled: {
    title: '🚫 实例转移已取消',
    message: (data) => `用户「${data.senderUsername}」取消了实例「${data.instanceName}」的转移请求`
  },

  // ==================== 安全与账户类 ====================
  login_new_device: {
    title: '🔐 新设备登录提醒',
    message: (data) => {
      let msg = `您的账户在新设备上登录`
      if (data.deviceInfo) msg += `\n设备: ${data.deviceInfo}`
      if (data.ipAddress) msg += `\nIP: ${data.ipAddress}`
      if (data.loginTime) msg += `\n时间: ${data.loginTime}`
      msg += `\n如非本人操作，请立即修改密码`
      return msg
    }
  },
  password_changed: {
    title: '🔑 密码已修改',
    message: (data) => {
      let msg = `您的账户密码已成功修改`
      if (data.ipAddress) msg += `\n操作 IP: ${data.ipAddress}`
      msg += `\n如非本人操作，请立即联系管理员`
      return msg
    }
  },
  '2fa_enabled': {
    title: '🛡️ 两步验证已启用',
    message: () => `您的账户已成功启用两步验证，账户安全性已提升`
  },
  '2fa_disabled': {
    title: '⚠️ 两步验证已禁用',
    message: () => `您的账户已禁用两步验证，建议重新启用以提高账户安全性`
  },

  // ==================== 配额与资源类 ====================
  quota_warning: {
    title: '⚠️ 配额即将用尽',
    message: (data) => {
      let msg = `您的${data.quotaType}配额即将用尽`
      msg += `\n使用: ${data.currentUsed} / ${data.maxLimit}`
      if (data.usagePercent) msg += ` (${data.usagePercent}%)`
      msg += `\n请前往个人设置添加配额`
      return msg
    }
  },

  // ==================== 工单类 ====================
  ticket_created: {
    title: '📩 收到新工单',
    message: (data) => {
      let msg = `用户「${data.username}」在节点「${data.hostName}」提交了新工单`
      msg += `\n主题: ${data.subject}`
      if (data.instanceName) msg += `\n相关实例: ${data.instanceName}`
      msg += `\n请前往工单管理页面处理`
      return msg
    }
  },
  ticket_replied: {
    title: '💬 工单有新回复',
    message: (data) => {
      let msg = `工单「${data.subject}」有新回复`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      if (data.replyFrom) msg += `\n来自: ${data.replyFrom}`
      msg += `\n请前往工单页面查看详情`
      return msg
    }
  },
  ticket_status_changed: {
    title: '📋 工单状态已更新',
    message: (data) => {
      const statusMap: Record<string, string> = {
        open: '待处理',
        in_progress: '处理中',
        resolved: '已解决',
        closed: '已关闭'
      }
      const statusText = statusMap[data.newStatus || ''] || data.newStatus
      let msg = `工单「${data.subject}」状态已更新为「${statusText}」`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  },
  ticket_closed: {
    title: '🔒 工单已关闭',
    message: (data) => {
      let msg = `工单「${data.subject}」已被关闭`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      if (data.closedBy) msg += `\n关闭者: ${data.closedBy}`
      return msg
    }
  },
  ticket_auto_closed: {
    title: '🔒 工单已自动关闭',
    message: (data) => {
      let msg = `工单「${data.subject}」已因超过24小时无新回复而自动关闭`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      msg += `\n如有新问题，请创建新工单`
      return msg
    }
  },
  redeem_code_used: {
    title: '🎁 您的兑换码已被使用',
    message: (data) => {
      return `用户 ${data.username} 使用了您的兑换码\n兑换码: ${data.redeemCode}\n资源类型: ${data.codeType} +${data.codeValue}${data.unit}`
    }
  },

  // ==================== 计费相关 ====================
  instance_renewed: {
    title: '✅ 实例续费成功',
    message: (data) => {
      let msg = `实例「${data.instanceName}」续费成功`
      if (data.renewMonths) msg += `\n续费时长: ${data.renewMonths} 个月`
      if (data.renewAmount !== undefined) msg += `\n扣费金额: ¥${Number(data.renewAmount).toFixed(2)}`
      if (data.newExpiresAt) msg += `\n新到期时间: ${data.newExpiresAt}`
      return msg
    }
  },
  instance_plan_changed: {
    title: '🔄 实例套餐已变更',
    message: (data) => {
      let msg = `实例「${data.instanceName}」套餐已变更`
      if (data.oldPlanName && data.newPlanName) {
        msg += `\n原套餐: ${data.oldPlanName}`
        msg += `\n新套餐: ${data.newPlanName}`
      }
      if (data.priceDiff !== undefined) {
        const diffText = data.priceDiff > 0 ? `补差价 ¥${Number(data.priceDiff).toFixed(2)}` : `退还 ¥${Math.abs(Number(data.priceDiff)).toFixed(2)}`
        msg += `\n费用: ${diffText}`
      }
      return msg
    }
  },
  instance_price_changed: {
    title: '💰 实例价格已调整',
    message: (data) => {
      let msg = `实例「${data.instanceName}」价格已调整`
      if (data.oldPrice !== undefined && data.newPrice !== undefined) {
        msg += `\n原价格: ¥${Number(data.oldPrice).toFixed(2)}`
        msg += `\n新价格: ¥${Number(data.newPrice).toFixed(2)}`
      }
      if (data.priceDiff !== undefined && data.priceDiff !== 0) {
        const diffText = data.isIncrease ? `已扣除 ¥${Number(data.priceDiff).toFixed(2)}` : `已退还 ¥${Number(data.priceDiff).toFixed(2)}`
        msg += `\n${diffText}`
      }
      return msg
    }
  },
  instance_expiring: {
    title: '⚠️ 实例即将到期',
    message: (data) => {
      let msg = `实例「${data.instanceName}」即将到期`
      if (data.daysRemaining !== undefined) {
        msg += `\n剩余时间: ${data.daysRemaining} 天`
      }
      if (data.newExpiresAt) {
        msg += `\n到期时间: ${data.newExpiresAt}`
      }
      msg += `\n请及时续费以避免实例被封停或删除`
      return msg
    }
  },
  auto_renew_failed: {
    title: '❌ 自动续费失败',
    message: (data) => {
      let msg = `实例「${data.instanceName}」自动续费失败`
      if (data.failReason) msg += `\n原因: ${data.failReason}`
      if (data.renewAmount !== undefined) msg += `\n所需金额: ¥${Number(data.renewAmount).toFixed(2)}`
      msg += `\n请确保余额充足或手动续费`
      return msg
    }
  },
  instance_extended: {
    title: '📅 实例已延期',
    message: (data) => {
      let msg = `实例「${data.instanceName}」已延期`
      if (data.days) msg += `\n延期时长: ${data.days} 天`
      if (data.amount !== undefined) msg += `\n费用: ¥${Number(data.amount).toFixed(2)}`
      if (data.newExpiresAt) msg += `\n新到期时间: ${data.newExpiresAt}`
      return msg
    }
  },
  instances_batch_extended: {
    title: '🎁 管理员已为您的实例赠送时长',
    message: (data) => {
      let msg = `您在节点「${data.hostName}」的付费实例已免费延期`
      if (data.days) msg += `\n延期时长: ${data.days} 天`
      msg += `\n请前往面板查看最新到期时间`
      return msg
    }
  },
  refund_completed: {
    title: '💰 退款已完成',
    message: (data) => {
      let msg = `实例「${data.instanceName}」的退款已完成`
      if (data.amount !== undefined) msg += `\n退款金额: ¥${Number(data.amount).toFixed(2)}`
      if (data.reason) msg += `\n原因: ${data.reason}`
      msg += `\n退款已到账至您的余额`
      return msg
    }
  },
  instance_deleted_refunded: {
    title: '🗑️ 实例已删除',
    message: (data) => {
      // 区分用户销毁和管理员删除
      const isUserDestroy = data.isFreeInstance !== undefined || data.feeAmount !== undefined
      let msg = isUserDestroy 
        ? `您的实例「${data.instanceName}」已成功销毁`
        : `您的实例「${data.instanceName}」已被管理员删除`
      if (data.reason) msg += `\n删除原因: ${data.reason}`
      if (data.refundAmount !== undefined && Number(data.refundAmount) > 0) {
        msg += `\n退款金额: ¥${Number(data.refundAmount).toFixed(2)}`
        if (data.feeAmount !== undefined && Number(data.feeAmount) > 0) {
          msg += `\n手续费: ¥${Number(data.feeAmount).toFixed(2)}`
        }
        if (data.refundType) msg += `\n退款方式: ${data.refundType}`
        msg += `\n退款已到账至您的余额`
      } else if (data.isFreeInstance) {
        msg += `\n免费实例无退款`
      }
      return msg
    }
  },
  aff_applied: {
    title: '🎁 已应用续费折扣',
    message: (data) => {
      let msg = `您的实例「${data.instanceName}」已应用推荐计划优惠`
      if (data.discountPercent) msg += `\n折扣优惠: ${data.discountPercent}% 续费折扣`
      msg += `\n后续续费时将自动享受折扣价格`
      return msg
    }
  },
  instance_renewal_price_updated: {
    title: '💰 实例续费价格已调整',
    message: (data) => {
      let msg = `实例「${data.instanceName}」的续费价格已调整`
      if (data.oldPrice !== undefined && data.newPrice !== undefined) {
        msg += `\n原价格: ¥${Number(data.oldPrice).toFixed(2)}/月`
        msg += `\n新价格: ¥${Number(data.newPrice).toFixed(2)}/月`
      }
      msg += `\n\n该价格将于下次续费时生效，本月不受影响。`
      if (data.hostName) msg += `\n节点: ${data.hostName}`
      return msg
    }
  }
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 带重试的通知发送
 */
async function sendWithRetry(
  sendFn: () => Promise<NotificationResult>,
  channelType: string
): Promise<NotificationResult> {
  let lastError: string | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await sendFn()

      if (result.success) {
        return result
      }

      // 某些错误不需要重试（配置错误等）
      if (isNonRetryableError(result.error)) {
        return result
      }

      lastError = result.error
      console.warn(`[Notifier] ${channelType} attempt ${attempt}/${MAX_RETRIES} failed: ${result.error}`)

      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt) // 递增延迟
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[Notifier] ${channelType} attempt ${attempt}/${MAX_RETRIES} error: ${lastError}`)

      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt)
      }
    }
  }

  return { success: false, error: `Failed after ${MAX_RETRIES} attempts: ${lastError}` }
}

/**
 * 判断是否为不可重试的错误
 */
function isNonRetryableError(error: string | null): boolean {
  if (!error) return false

  const nonRetryablePatterns = [
    'Missing botToken',
    'Missing chatId',
    'Missing webhookUrl',
    'Missing webhook URL',
    'Invalid Discord Webhook URL',
    'not yet implemented',
    'Unknown channel type',
    'Unsupported channel type',
    'chat not found',
    'bot was blocked',
    'CHAT_ID_INVALID',
    'BOT_TOKEN_INVALID',
    '401', // Unauthorized
    '403', // Forbidden
    '404', // Not Found
  ]

  return nonRetryablePatterns.some(pattern =>
    error.toLowerCase().includes(pattern.toLowerCase())
  )
}

async function readSafeNotificationError(response: Response): Promise<string> {
  const text = await response.text()
  const sanitized = sanitizeTokensInString(text)
  const preview = sanitized.slice(0, NOTIFICATION_ERROR_PREVIEW_MAX_CHARS)
  return preview || `HTTP ${response.status}`
}

/**
 * 发送通知到用户的所有启用渠道
 * 同时创建站内信
 */
export async function sendNotification(
  userId: number,
  eventType: EventType,
  data: EventData
): Promise<SendResult> {
  try {
    const template = EVENT_TEMPLATES[eventType]
    if (!template) {
      console.warn(`[Notifier] Unknown event type: ${eventType}`)
      return { sent: 0, failed: 0 }
    }

    const title = template.title
    const message = template.message(data)

    // 1. 创建站内信（始终创建）
    try {
      await createInboxMessage({
        userId,
        eventType,
        title,
        content: message,
        data: data as Record<string, unknown>
      })
    } catch (err) {
      console.error('[Notifier] Failed to create inbox message:', err)
    }

    // 2. 发送外部通知
    const channels = await db.getEnabledChannelsByUserId(userId)

    if (channels.length === 0) {
      return { sent: 0, failed: 0 }
    }

    let sent = 0
    let failed = 0

    for (const channel of channels) {
      try {
        const config = typeof channel.config === 'string'
          ? JSON.parse(channel.config)
          : channel.config

        // 创建日志记录
        const logId = await db.createNotificationLog({
          channelId: channel.id,
          eventType,
          message,
          status: 'pending'
        })

        // 根据渠道类型发送通知（带重试）
        let result: NotificationResult

        switch (channel.type) {
          case 'telegram':
            result = await sendWithRetry(
              () => sendTelegram(config as TelegramConfig, title, message),
              'Telegram'
            )
            break
          case 'discord':
            result = await sendWithRetry(
              () => sendDiscord(config as DiscordConfig, title, message),
              'Discord'
            )
            break
          case 'webhook':
            result = await sendWithRetry(
              () => sendWebhook(config as WebhookConfig, eventType, title, message, data),
              'Webhook'
            )
            break
          case 'email':
            result = { success: false, error: 'Email notifications not yet implemented' }
            break
          default:
            result = { success: false, error: `Unknown channel type: ${channel.type}` }
        }

        // 更新日志状态
        await db.updateNotificationLogStatus(logId, result.success ? 'sent' : 'failed', result.error)

        if (result.success) {
          sent++
        } else {
          failed++
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error(`[Notifier] Failed to send notification to channel ${channel.id}:`, error)
        failed++
      }
    }

    return { sent, failed }
  } catch (err) {
    console.error('[Notifier] sendNotification error:', err)
    return { sent: 0, failed: 0 }
  }
}

type HostManagedInstanceEventType = 'purchase' | 'renew' | 'destroy'

function buildHostManagedInstanceNotification(
  eventType: HostManagedInstanceEventType,
  data: {
    hostName: string
    username: string
    instanceName: string
    amount?: number
    refundAmount?: number
    feeAmount?: number
  }
): { title: string; message: string; webhookEvent: string } {
  switch (eventType) {
    case 'purchase':
      return {
        title: '💰 托管收入到账',
        message: [
          `有用户购买了您托管的实例，收入 ¥${Number(data.amount || 0).toFixed(2)}`,
          `节点: ${data.hostName}`,
          '该笔收入将冻结30天后可提现'
        ].join('\n'),
        webhookEvent: 'host.instance_purchase'
      }
    case 'renew':
      return {
        title: '💰 托管收入到账',
        message: [
          `有用户续费了您托管的实例，收入 ¥${Number(data.amount || 0).toFixed(2)}`,
          `节点: ${data.hostName}`,
          '该笔收入将冻结30天后可提现'
        ].join('\n'),
        webhookEvent: 'host.instance_renew'
      }
    case 'destroy':
      return {
        title: '🗑️ 托管实例销毁',
        message: [
          `有用户销毁了您托管的实例，实际退款 ¥${Number(data.refundAmount || 0).toFixed(2)}`,
          `节点: ${data.hostName}`,
          `手续费: ¥${Number(data.feeAmount || 0).toFixed(2)}`
        ].join('\n'),
        webhookEvent: 'host.instance_destroy'
      }
  }
}

export async function sendHostManagedInstanceNotification(
  hostId: number,
  eventType: HostManagedInstanceEventType,
  data: {
    username: string
    instanceName: string
    amount?: number
    refundAmount?: number
    feeAmount?: number
  }
): Promise<SendResult> {
  try {
    const host = await prisma.host.findUnique({
      where: { id: hostId },
      select: {
        userId: true,
        name: true,
        notifyPurchase: true,
        notifyRenew: true,
        notifyDestroy: true,
        user: {
          select: {
            role: true
          }
        }
      }
    })

    if (!host || host.user.role === 'admin') {
      return { sent: 0, failed: 0 }
    }

    const enabled = eventType === 'purchase'
      ? host.notifyPurchase
      : eventType === 'renew'
        ? host.notifyRenew
        : host.notifyDestroy

    if (!enabled) {
      return { sent: 0, failed: 0 }
    }

    const channels = (await db.getEnabledChannelsByUserId(host.userId))
      .filter(channel => ['telegram', 'discord', 'webhook'].includes(channel.type))

    if (channels.length === 0) {
      return { sent: 0, failed: 0 }
    }

    const payload = buildHostManagedInstanceNotification(eventType, {
      hostName: host.name,
      ...data
    })

    let sent = 0
    let failed = 0

    for (const channel of channels) {
      try {
        const config = typeof channel.config === 'string'
          ? JSON.parse(channel.config)
          : channel.config

        const logId = await db.createNotificationLog({
          channelId: channel.id,
          eventType: payload.webhookEvent,
          message: payload.message,
          status: 'pending'
        })

        let result: NotificationResult

        switch (channel.type) {
          case 'telegram':
            result = await sendWithRetry(
              () => sendTelegram(config as TelegramConfig, payload.title, payload.message),
              'Telegram'
            )
            break
          case 'discord':
            result = await sendWithRetry(
              () => sendDiscord(config as DiscordConfig, payload.title, payload.message),
              'Discord'
            )
            break
          case 'webhook':
            result = await sendWithRetry(
              () => sendWebhook(
                config as WebhookConfig,
                payload.webhookEvent,
                payload.title,
                payload.message,
                {
                  hostId,
                  hostName: host.name,
                  eventType,
                  ...data
                }
              ),
              'Webhook'
            )
            break
          default:
            result = { success: false, error: `Unsupported channel type: ${channel.type}` }
        }

        await db.updateNotificationLogStatus(logId, result.success ? 'sent' : 'failed', result.error)

        if (result.success) {
          sent++
        } else {
          failed++
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error(`[Notifier] Failed to send host managed instance notification to channel ${channel.id}:`, error)
        failed++
      }
    }

    return { sent, failed }
  } catch (err) {
    console.error('[Notifier] sendHostManagedInstanceNotification error:', err)
    return { sent: 0, failed: 0 }
  }
}

/**
 * 发送 Telegram 通知
 */
async function sendTelegram(
  config: TelegramConfig,
  title: string,
  message: string
): Promise<NotificationResult> {
  const { botToken, chatId } = config

  if (!botToken || !chatId) {
    return { success: false, error: 'Missing botToken or chatId' }
  }

  try {
    const text = `*${escapeMarkdown(title)}*\n\n${escapeMarkdown(message)}`

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2'
      })
    })

    const result = await response.json() as { ok: boolean; description?: string }

    if (!result.ok) {
      return { success: false, error: result.description || 'Unknown Telegram error' }
    }

    return { success: true, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { success: false, error }
  }
}

/**
 * 发送 Discord 通知
 */
async function sendDiscord(
  config: DiscordConfig,
  title: string,
  message: string
): Promise<NotificationResult> {
  const { webhookUrl } = config

  if (!webhookUrl) {
    return { success: false, error: 'Missing webhookUrl' }
  }

  try {
    // 根据标题选择颜色
    let color = 0x00ff00 // 默认绿色
    if (title.includes('失败') || title.includes('❌')) {
      color = 0xff0000 // 红色
    } else if (title.includes('删除') || title.includes('🗑️')) {
      color = 0x808080 // 灰色
    } else if (title.includes('恢复') || title.includes('🔄')) {
      color = 0x0099ff // 蓝色
    } else if (title.includes('自动') || title.includes('📸') || title.includes('💾')) {
      color = 0x9b59b6 // 紫色
    }

    const parsedUrl = await assertSafeWebhookUrl(webhookUrl)
    const response = await fetch(parsedUrl.toString(), {
      method: 'POST',
      signal: AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title,
          description: message,
          color,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'Incudal'
          }
        }]
      }),
      redirect: 'manual'
    })

    if (!response.ok) {
      return { success: false, error: await readSafeNotificationError(response) }
    }

    return { success: true, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { success: false, error }
  }
}

/**
 * 发送 Webhook 通知
 */
async function sendWebhook(
  config: WebhookConfig,
  eventType: string,
  title: string,
  message: string,
  data: EventData
): Promise<NotificationResult> {
  const { url, secret } = config

  if (!url) {
    return { success: false, error: 'Missing webhook URL' }
  }

  try {
    const parsedUrl = await assertSafeWebhookUrl(url)
    const payload = {
      event: eventType,
      title,
      message,
      data,
      timestamp: new Date().toISOString()
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    // 如果有 secret，添加签名
    if (secret) {
      const crypto = await import('crypto')
      const signature = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex')
      headers['X-Signature'] = signature
    }

    const response = await fetch(parsedUrl.toString(), {
      method: 'POST',
      signal: AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS),
      headers,
      body: JSON.stringify(payload),
      redirect: 'manual'
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    return { success: true, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { success: false, error }
  }
}

/**
 * 转义 Telegram MarkdownV2 特殊字符
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1')
}

/**
 * 测试通知渠道（带重试）
 */
export async function testNotificationChannel(channel: NotificationChannel): Promise<NotificationResult> {
  const config = typeof channel.config === 'string'
    ? JSON.parse(channel.config)
    : channel.config

  const testData: EventData = {
    instanceName: 'test-instance',
    snapshotName: 'test-snapshot'
  }

  let result: NotificationResult

  switch (channel.type) {
    case 'telegram':
      result = await sendWithRetry(
        () => sendTelegram(config as TelegramConfig, '🔔 测试通知', '这是一条来自 Incudal 的测试通知。\n如果您收到此消息，说明通知配置正确！'),
        'Telegram'
      )
      break
    case 'discord':
      result = await sendWithRetry(
        () => sendDiscord(config as DiscordConfig, '🔔 测试通知', '这是一条来自 Incudal 的测试通知。\n如果您收到此消息，说明通知配置正确！'),
        'Discord'
      )
      break
    case 'webhook':
      result = await sendWithRetry(
        () => sendWebhook(config as WebhookConfig, 'test' as EventType, '🔔 测试通知', '这是一条来自 Incudal 的测试通知。', testData),
        'Webhook'
      )
      break
    default:
      result = { success: false, error: `Unsupported channel type: ${channel.type}` }
  }

  return result
}

/**
 * 发送敏感操作验证码通知
 */
export async function sendVerificationNotification(
  userId: number,
  data: {
    operationName: string
    code: string
    expiresInMinutes: number
  }
): Promise<{ success: boolean; error?: string }> {
  // 获取用户的通知渠道
  const channels = await db.getEnabledChannelsByUserId(userId)
  
  if (!channels || channels.length === 0) {
    return { success: false, error: 'No notification channel configured' }
  }

  const title = '🔐 操作验证码'
  const message = `您正在执行「${data.operationName}」操作

验证码：${data.code}

此验证码将在 ${data.expiresInMinutes} 分钟后失效。
如非本人操作，请立即修改密码。`

  // 只发送给第一个启用的渠道
  const channel = channels[0]
  
  try {
    const config = typeof channel.config === 'string'
      ? JSON.parse(channel.config)
      : channel.config

    let result: NotificationResult

    switch (channel.type) {
      case 'telegram':
        result = await sendWithRetry(
          () => sendTelegram(config as TelegramConfig, title, message),
          'Telegram'
        )
        break
      case 'discord':
        result = await sendWithRetry(
          () => sendDiscord(config as DiscordConfig, title, message),
          'Discord'
        )
        break
      case 'webhook':
        result = await sendWithRetry(
          () => sendWebhook(
            config as WebhookConfig,
            'verification' as EventType,
            title,
            message,
            { instanceName: '', code: data.code, operationName: data.operationName }
          ),
          'Webhook'
        )
        break
      default:
        return { success: false, error: `Unsupported channel type: ${channel.type}` }
    }

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to send notification' }
    }

    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { success: false, error }
  }
}

/**
 * 发送自定义消息到指定的通知渠道
 * 用于套餐资源释放等自定义通知场景
 * 
 * 注意：该函数不检查 channel.enabled 状态，因为资源释放通知渠道
 * 就是专门设置为禁用状态的（只用于资源释放通知，不接收系统事件通知）
 * 
 * @param link 可选的超链接，Telegram 会渲染为可点击的内联链接，其他渠道渲染为纯文本
 */
export async function sendToChannel(
  channelId: number,
  title: string,
  message: string,
  link?: { label: string; url: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const channel = await db.getNotificationChannelById(channelId)
    if (!channel) {
      return { success: false, error: 'Channel not found' }
    }

    // 不检查 enabled 状态，因为资源释放通知渠道就是禁用状态的
    // 设计说明：禁用状态的渠道不会接收系统事件通知，但可以接收资源释放通知

    const config = typeof channel.config === 'string'
      ? JSON.parse(channel.config)
      : channel.config

    // 创建日志记录
    const logId = await db.createNotificationLog({
      channelId: channel.id,
      eventType: 'package.quota_release',
      message,
      status: 'pending'
    })

    let result: NotificationResult

    switch (channel.type) {
      case 'telegram': {
        // Telegram MarkdownV2: 主消息体先 escape，然后将超链接作为 [label](url)
        // 内联链接的 URL 部分不需要 escape，label 需要 escape
        // 这样确保 URL 中的 . ? = & 等字符不被转义，链接可以被 Telegram 正确解析为可点击链接
        const telegramConfig = config as TelegramConfig
        if (!telegramConfig.botToken || !telegramConfig.chatId) {
          result = { success: false, error: 'Missing botToken or chatId' }
          break
        }
        try {
          let text = `*${escapeMarkdown(title)}*\n\n${escapeMarkdown(message)}`
          if (link) {
            // [转义后的label](原始url) — URL 不转义，确保链接可点击
            text += `\n[${escapeMarkdown(link.label)}](${link.url})`
          }
          const response = await fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
            method: 'POST',
            redirect: 'manual',
            signal: AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramConfig.chatId,
              text,
              parse_mode: 'MarkdownV2'
            })
          })
          const json = await response.json() as { ok: boolean; description?: string }
          result = json.ok
            ? { success: true, error: null }
            : { success: false, error: json.description || 'Unknown Telegram error' }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : String(err) }
        }
        break
      }
      case 'discord': {
        // Discord: 直接拼接，Discord 会自动渲染 URL 为超链接
        const discordMessage = link ? `${message}\n${link.label}: ${link.url}` : message
        result = await sendWithRetry(
          () => sendDiscord(config as DiscordConfig, title, discordMessage),
          'Discord'
        )
        break
      }
      case 'webhook': {
        const webhookMessage = link ? `${message}\n${link.label}: ${link.url}` : message
        result = await sendWithRetry(
          () => sendWebhook(
            config as WebhookConfig,
            'package.quota_release' as unknown as EventType,
            title,
            webhookMessage,
            { instanceName: '', link }
          ),
          'Webhook'
        )
        break
      }
      default:
        result = { success: false, error: `Unsupported channel type: ${channel.type}` }
    }

    // 更新日志状态
    await db.updateNotificationLogStatus(logId, result.success ? 'sent' : 'failed', result.error)

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to send notification' }
    }

    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { success: false, error }
  }
}
