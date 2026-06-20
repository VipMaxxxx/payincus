/**
 * 清空数据库所有表的数据
 * 注意：此操作不可逆，请谨慎使用
 */

import { prisma } from './prisma.js'
import { Pool } from 'pg'

/**
 * 清空所有表的数据（保留表结构）
 * 按照外键依赖顺序删除，避免约束冲突
 */
export async function resetDatabase(): Promise<void> {
  console.log('🗑️  开始清空数据库...')

  try {
    // 按照外键依赖顺序删除（从子表到父表）
    // 注意：Prisma 不支持直接 TRUNCATE，使用 deleteMany

    // 1. 删除所有子表数据（有外键依赖的表）
    console.log('  删除日志数据...')
    await prisma.log.deleteMany({})

    console.log('  删除通知日志...')
    await prisma.notificationLog.deleteMany({})

    console.log('  删除通知渠道...')
    await prisma.notificationChannel.deleteMany({})

    console.log('  删除用户 OAuth 绑定...')
    await prisma.userOAuthBinding.deleteMany({})

    console.log('  删除 OAuth 配置...')
    await prisma.oAuthConfig.deleteMany({})

    console.log('  删除帮助文档...')
    await prisma.helpArticle.deleteMany({})

    console.log('  删除 SSH 密钥...')
    await prisma.sshKey.deleteMany({})

    console.log('  删除端口映射...')
    await prisma.portMapping.deleteMany({})

    console.log('  删除快照策略...')
    await prisma.snapshotPolicy.deleteMany({})

    console.log('  删除备份策略...')
    await prisma.backupPolicy.deleteMany({})

    console.log('  删除快照...')
    await prisma.snapshot.deleteMany({})

    console.log('  删除备份...')
    await prisma.backup.deleteMany({})

    console.log('  删除实例...')
    await prisma.instance.deleteMany({})

    console.log('  删除邀请码...')
    await prisma.inviteCode.deleteMany({})

    console.log('  删除用户配额...')
    await prisma.userQuota.deleteMany({})

    console.log('  删除用户...')
    await prisma.user.deleteMany({})

    console.log('  删除主机...')
    await prisma.host.deleteMany({})

    console.log('  删除套餐...')
    await prisma.package.deleteMany({})

    console.log('✅ 数据库已清空')
  } catch (error: any) {
    console.error('❌ 清空数据库失败:', error.message)
    throw error
  }
}

/**
 * 使用 SQL TRUNCATE 快速清空所有表（更快，但需要直接执行 SQL）
 * 注意：这会重置自增 ID
 */
export async function resetDatabaseFast(): Promise<void> {
  console.log('🗑️  快速清空数据库（使用 TRUNCATE）...')

  // 直接使用 pg 连接池执行 TRUNCATE，绕过 Prisma 适配器的限制
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  try {
    const tables = [
      'logs',
      'notification_logs',
      'notification_channels',
      'user_oauth_bindings',
      'oauth_configs',
      'help_articles',
      'ssh_keys',
      'port_mappings',
      'snapshot_policies',
      'backup_policies',
      'snapshots',
      'backups',
      'restore_tasks',
      'traffic_snapshots',
      'daily_traffic',
      'backup_upload_tasks',
      'storage_configs',
      'instance_transfers',
      'instances',
      'invite_codes',
      'user_quotas',
      'users',
      'package_hosts',
      'hosts',
      'packages',
      'system_configs'
    ]

    for (const table of tables) {
      try {
        await pool.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`)
      } catch {
        // 表可能不存在，忽略错误
      }
    }

    console.log('✅ 数据库已快速清空')
  } catch (error: any) {
    console.error('❌ 快速清空数据库失败:', error.message)
    // 如果 TRUNCATE 失败，回退到 deleteMany
    console.log('⚠️  回退到 deleteMany 方法...')
    await resetDatabase()
  } finally {
    await pool.end()
  }
}

