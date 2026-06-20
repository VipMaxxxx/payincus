/**
 * 数据库操作主入口
 * 导出所有数据库操作函数
 * 
 * 已迁移到 Prisma ORM + PostgreSQL
 */

// 导出 Prisma 客户端和初始化函数
export { prisma } from './prisma.js'
export { initPrismaDatabase } from './init-prisma.js'
export { resetDatabase, resetDatabaseFast } from './reset-database.js'

// 导出用户相关操作
export * from './users.js'

// 导出配额操作
export * from './quota-operations.js'

// 导出日志操作
export * from './logs.js'

// 导出邀请码相关操作
export * from './invite-codes.js'

// 导出套餐相关操作
export * from './packages.js'

// 导出主机相关操作
export * from './hosts.js'
export * from './host-addresses.js'

// 导出实例相关操作
export * from './instances.js'

// 导出端口映射相关操作
export * from './port-mappings.js'

// 导出快照相关操作
export * from './snapshots.js'

// 导出备份相关操作
export * from './backups.js'

// 导出 SSH 密钥相关操作
export * from './ssh-keys.js'

// 导出通知相关操作
export * from './notifications.js'

// 导出节点组相关操作

// 导出 OAuth 相关操作
export * from './oauth.js'

// 导出帮助文档相关操作
export * from './help.js'

// 导出镜像相关操作
export * from './images.js'

// 导出分页查询函数
export * from './pagination.js'

// 导出系统配置相关操作
export * from './system-config.js'

// 导出流量统计相关操作
export * from './traffic.js'

// 导出恢复任务相关操作
export * from './restore-tasks.js'

// 导出远程存储配置相关操作
export * from './storage-configs.js'

// 导出备份上传任务相关操作
export * from './backup-upload-tasks.js'

// 导出实例转移相关操作
export * from './transfers.js'

// 导出好友关系相关操作
export * from './friendships.js'

// 导出套餐共享相关操作
export * from './package-shares.js'

// 导出 IP 地址相关操作
export * from './ip-addresses.js'

// 导出存储池相关操作
export * from './storage-pools.js'

// 导出实例操作任务相关操作
export * from './instance-tasks.js'

// 导出登录记录相关操作
export * from './login-records.js'

// 导出签到系统相关操作
export * from './checkin.js'

// 导出用户资源池相关操作
export * from './resource-pool.js'

// 导出系统兑换码相关操作
export * from './redeem-codes.js'

// 导出用户自定义初始化命令相关操作
export * from './custom-init-commands.js'

// 导出套餐方案相关操作
export * from './package-plans.js'

// 导出余额管理相关操作
export * from './balance.js'

// 导出计费记录相关操作
export * from './billing-records.js'

// 导出徽章相关操作
export * from './badges.js'

// 导出实例封停/解封相关操作（重命名以避免冲突）
export {
  suspendInstanceByExpiry,
  suspendInstanceManually,
  isInstanceSuspended,
  isExpiredSuspension,
  isManualSuspension,
  getSuspendInfo,
  updateExpiryNotifiedAt,
  getAutoRenewInstances,
  updateAutoRenewAttempt,
  resetAutoRenewAttempts,
  getSuspendedInstancesOlderThan
} from './instance-suspend.js'

// 导出计费业务操作（排除与 package-plans.js 冲突的 calculateMonthlyPrice）
export {
  calculateCreateBilling,
  calculateRenewBilling,
  calculatePlanChange,
  calculateInstancePriceAdjustmentQuote,
  previewRenewPrices,
  performRenewal,
  performPlanChange,
  updateAutoRenew,
  getInstanceBillingInfo,
  isFreeInstance,
  isPaidInstance,
  isExpired,
  getRemainingDays,
  calculateInstanceRemainingRefundQuote,
  calculateInstanceRefund,
  // 托管余额相关
  isUserHostedNode,
  getHostOwnerId,
  recordHostingIncome,
  processHostingIncome,
  deductHostingBalance
} from './billing-operations.js'

// 导出支付渠道相关操作
export * from './payment-providers.js'

// 导出充值记录相关操作
export * from './recharge-records.js'

// 导出 AFF 推荐计划相关操作
export * from './aff.js'

// 导出积分系统相关操作
export * from './points.js'

// 导出抽奖系统相关操作
export * from './lottery.js'

// 导出域名邮箱模块操作
export * from './mail.js'

// 导出宿主机通知邮件队列相关操作
export * from './host-notification-email-tasks.js'

// 导出托管拉黑相关操作
export * from './hosting-blocks.js'
