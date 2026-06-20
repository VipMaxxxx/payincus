/**
 * 套餐与宿主机绑定相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'

/**
 * 获取套餐绑定的宿主机ID列表
 */
export async function getPackageHostIds(packageId: number): Promise<number[]> {
  const packageHosts = await prisma.packageHost.findMany({
    where: { packageId },
    select: { hostId: true }
  })
  return packageHosts.map(ph => ph.hostId)
}

/**
 * 获取套餐绑定的宿主机列表（包含详细信息）
 */
export async function getPackageHosts(packageId: number): Promise<Array<{
  id: number
  name: string
  location: string | null
  status: string
}>> {
  const packageHosts = await prisma.packageHost.findMany({
    where: { packageId },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          location: true,
          status: true
        }
      }
    }
  })
  return packageHosts.map(ph => ({
    id: ph.host.id,
    name: ph.host.name,
    location: ph.host.location,
    status: ph.host.status
  }))
}

/**
 * 设置套餐绑定的宿主机（替换所有绑定）
 * 注意：必须至少绑定一个宿主机
 */
export async function setPackageHosts(packageId: number, hostIds: number[]): Promise<void> {
  if (hostIds.length === 0) {
    throw new Error('Package must have at least one host bound')
  }

  // 先删除所有现有绑定
  await prisma.packageHost.deleteMany({
    where: { packageId }
  })

  // 创建新绑定
  await prisma.packageHost.createMany({
    data: hostIds.map(hostId => ({
      packageId,
      hostId
    })),
    skipDuplicates: true
  })
}

/**
 * 添加套餐绑定的宿主机
 */
export async function addPackageHost(packageId: number, hostId: number): Promise<void> {
  await prisma.packageHost.upsert({
    where: {
      packageId_hostId: {
        packageId,
        hostId
      }
    },
    create: {
      packageId,
      hostId
    },
    update: {}
  })
}

/**
 * 删除套餐绑定的宿主机
 * 注意：删除后必须至少保留一个宿主机
 */
export async function removePackageHost(packageId: number, hostId: number): Promise<void> {
  const currentCount = await prisma.packageHost.count({
    where: { packageId }
  })

  if (currentCount <= 1) {
    throw new Error('Package must have at least one host bound')
  }

  await prisma.packageHost.delete({
    where: {
      packageId_hostId: {
        packageId,
        hostId
      }
    }
  })
}

/**
 * 检查套餐是否绑定了宿主机
 */
export async function hasPackageHosts(packageId: number): Promise<boolean> {
  const count = await prisma.packageHost.count({
    where: { packageId }
  })
  return count > 0
}

/**
 * 获取宿主机被哪些套餐绑定
 */
export async function getHostPackages(hostId: number): Promise<number[]> {
  const packageHosts = await prisma.packageHost.findMany({
    where: { hostId },
    select: { packageId: true }
  })
  return packageHosts.map(ph => ph.packageId)
}

