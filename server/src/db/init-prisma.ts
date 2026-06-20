/**
 * Prisma 数据库初始化
 */

// 确保环境变量被加载
import 'dotenv/config'

import { prisma } from './prisma.js'
// @ts-ignore - bcryptjs has its own types
import bcrypt from 'bcryptjs'
import { resetDatabaseFast } from './reset-database.js'
import { initSystemConfig } from './system-config.js'
import { seedDefaultBadges } from './badges.js'

function getInitialAdminPassword(): string {
  const configuredPassword = process.env.ADMIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD

  if (process.env.NODE_ENV === 'production') {
    if (!configuredPassword || configuredPassword === 'admin123') {
      throw new Error('ADMIN_PASSWORD must be configured to a non-default value in production')
    }
  }

  return configuredPassword || 'admin123'
}

/**
 * 初始化 Prisma 数据库
 * @param options 初始化选项
 */
export async function initPrismaDatabase(options: {
  resetDatabase?: boolean
} = {}) {
  // 测试连接
  await prisma.$connect()
  console.log('✅ Prisma 数据库连接成功')

  // 如果配置了清空数据库，先清空
  const shouldReset = options.resetDatabase ??
    (process.env.RESET_DATABASE === 'true' || process.env.RESET_DATABASE === '1')

  if (shouldReset) {
    console.log('⚠️  检测到 RESET_DATABASE=true，将清空数据库...')
    await resetDatabaseFast()
    console.log('✅ 数据库已清空')
  }

  // 创建默认数据
  await createDefaultAdmin()
  // 注释：管理员不再允许对套餐、节点等进行操作，因此不再自动创建默认套餐
  // await createDefaultPackages()
  await initDefaultSystemConfig()
  await seedDefaultBadges()

  console.log('📦 Prisma 数据库初始化完成')
  return prisma
}

/**
 * 创建默认管理员账户
 */
async function createDefaultAdmin() {
  const existing = await prisma.user.findUnique({
    where: { username: 'admin' },
    include: { quota: true }
  })

  if (!existing) {
    // 从环境变量读取管理员密码，默认值为 'admin123'（开发环境）
    const adminPassword = getInitialAdminPassword()
    const passwordHash = await bcrypt.hash(adminPassword, 12)

    await prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@incudal.local',
        passwordHash,
        role: 'admin',
        status: 'active',
        quota: {
          create: {
            // 新配额系统：管理员拥有超高配额
            // 注意：不再限制实例配额
            hostLimit: 1000,        // 宿主机数量上限
            friendLimit: 1000,      // 好友数量上限
            packageLimit: 1000      // 套餐数量上限
          }
        }
      }
    })

    // 如果使用环境变量配置的密码，不直接输出密码（安全考虑）
    const passwordDisplay = adminPassword === 'admin123'
      ? 'admin123'
      : '***（已从环境变量配置）'
    console.log(`✅ 默认管理员账户已创建: admin / ${passwordDisplay}`)
    console.log('   配额配置: 宿主机=1000, 好友=1000, 套餐=1000（实例无限制）')
  } else {
    // 如果管理员已存在，检查并更新配额（如果配额不存在或需要更新）
    if (!existing.quota) {
      await prisma.userQuota.create({
        data: {
          userId: existing.id,
          // 新配额系统：管理员拥有超高配额
          // 注意：不再限制实例配额
          hostLimit: 1000,
          friendLimit: 1000,
          packageLimit: 1000
        }
      })
      console.log('✅ 已为现有管理员账户创建配额')
    } else {
      // 可选：如果需要更新现有配额，取消下面的注释
      // await prisma.userQuota.update({
      //   where: { userId: existing.id },
      //   data: {
      //     hostLimit: 1000,
      //     friendLimit: 1000,
      //   }
      // })
      // console.log('✅ 已更新管理员账户配额')
    }
    console.log('ℹ️  管理员账户已存在，跳过创建')
  }
}

/**
 * 创建默认套餐
 * 注意：套餐必须绑定至少一个宿主机，如果没有宿主机则不创建
 * 
 * 已注释：管理员不再允许对套餐、节点等进行操作，因此不再自动创建默认套餐
 */
// @ts-ignore - 函数已禁用但保留以供将来参考
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createDefaultPackages() {
  const count = await prisma.package.count()

  if (count === 0) {
    // 获取管理员用户ID作为默认套餐的所有者
    const adminUser = await prisma.user.findFirst({
      where: { role: 'admin' },
      orderBy: { id: 'asc' }
    })

    if (!adminUser) {
      console.log('⚠️  没有管理员用户，跳过创建默认套餐')
      return
    }

    // 获取管理员的所有宿主机
    const adminHosts = await prisma.host.findMany({
      where: { userId: adminUser.id },
      select: { id: true }
    })

    if (adminHosts.length === 0) {
      console.log('⚠️  管理员没有宿主机，跳过创建默认套餐（套餐必须绑定至少一个宿主机）')
      return
    }

    const hostIds = adminHosts.map(h => h.id)

    // 创建套餐并绑定所有宿主机
    const packages = [
      {
        userId: adminUser.id,
        name: 'NAT基础款',
        description: '适合轻量应用',
        cpuMax: 50,        // 50% CPU
        memoryMax: 512,    // 512MB
        diskMax: 5120,     // 5GB = 5120MB
        bandwidthMax: 100,
        networkMode: 'nat' as const,
        privileged: true,  // 特权容器
        nested: true,      // 嵌套虚拟化
        active: true,      // 启用套餐
        portLimit: 20,
        hostIds
      },
      {
        userId: adminUser.id,
        name: '独立IPv6款',
        description: '适合中型应用',
        cpuMax: 150,       // 150% CPU
        memoryMax: 1024,   // 1GB = 1024MB
        diskMax: 15360,    // 15GB = 15360MB
        bandwidthMax: 200,
        networkMode: 'nat_ipv6' as const, // NAT & IPv6
        privileged: true,  // 特权容器
        nested: true,      // 嵌套虚拟化
        active: true,      // 启用套餐
        portLimit: 30,
        hostIds
      },
      {
        userId: adminUser.id,
        name: 'NAT+IPv6款',
        description: '适合高负载应用',
        cpuMax: 200,       // 200% CPU
        memoryMax: 2048,   // 2GB = 2048MB
        diskMax: 25600,    // 25GB = 25600MB
        bandwidthMax: 500,
        networkMode: 'nat_ipv6' as const, // NAT + IPv6
        privileged: true,  // 特权容器
        nested: true,      // 嵌套虚拟化
        active: true,      // 启用套餐
        portLimit: 50,
        hostIds
      }
    ]

    // 使用 createPackage 函数创建套餐（会自动处理宿主机绑定）
    const { createPackage } = await import('./packages.js')
    for (const pkg of packages) {
      await createPackage(pkg)
    }

    console.log('✅ 默认套餐已创建（已绑定所有宿主机）')
    console.log('   1. NAT基础款: 50%CPU, 512MB内存, 5GB硬盘')
    console.log('   2. 独立IPv6款: 150%CPU, 1GB内存, 15GB硬盘')
    console.log('   3. NAT+IPv6款: 200%CPU, 2GB内存, 25GB硬盘')
  } else {
    console.log('ℹ️  套餐已存在，跳过创建')
  }
}

/**
 * 初始化默认系统配置
 */
async function initDefaultSystemConfig() {
  await initSystemConfig()
  console.log('✅ 系统配置已初始化')
}
