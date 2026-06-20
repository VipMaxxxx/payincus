/**
 * 备份相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { Backup } from '../types/database.js'

/**
 * 获取实例的备份列表
 */
export async function getBackupsByInstanceId(instanceId: number): Promise<Backup[]> {
  const backups = await prisma.backup.findMany({
    where: {
      instanceId,
      status: { not: 'deleted' }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })
  
  return backups.map(b => ({
    id: b.id,
    instance_id: b.instanceId,
    incus_name: b.incusName,
    name: b.name,
    description: b.description,
    size: b.size,
    status: b.status,
    created_at: b.createdAt.toISOString(),
    expires_at: b.expiresAt?.toISOString() ?? null
  }))
}

/**
 * 根据 ID 获取备份
 */
export async function getBackupById(id: number): Promise<Backup | null> {
  const backup = await prisma.backup.findUnique({
    where: { id }
  })
  
  if (!backup) return null
  
  return {
    id: backup.id,
    instance_id: backup.instanceId,
    incus_name: backup.incusName,
    name: backup.name,
    description: backup.description,
    size: backup.size,
    status: backup.status,
    created_at: backup.createdAt.toISOString(),
    expires_at: backup.expiresAt?.toISOString() ?? null
  }
}

/**
 * 创建备份
 */
export async function createBackup(data: {
  instanceId: number
  incusName: string
  name: string
  description?: string | null
  expiresAt?: string | null
}): Promise<number> {
  const backup = await prisma.backup.create({
    data: {
      instanceId: data.instanceId,
      incusName: data.incusName,
      name: data.name,
      description: data.description ?? null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      status: 'creating'
    }
  })
  
  return backup.id
}

/**
 * 更新备份状态
 */
export async function updateBackupStatus(
  id: number,
  status: 'creating' | 'ready' | 'error' | 'deleted',
  _error: string | null = null
): Promise<void> {
  // Prisma 不支持在同一个模型中存储 error 字段（backups 表没有 error 字段）
  // 如果需要错误信息，应该存储在 description 或其他字段中
  // _error 参数保留以保持 API 兼容性，但当前不使用
  await prisma.backup.update({
    where: { id },
    data: { status }
  })
}

/**
 * 更新备份大小
 */
export async function updateBackupSize(id: number, size: number): Promise<void> {
  await prisma.backup.update({
    where: { id },
    data: { size }
  })
}

/**
 * 删除备份（软删除）
 */
export async function deleteBackup(id: number): Promise<void> {
  await prisma.backup.update({
    where: { id },
    data: { status: 'deleted' }
  })
}

/**
 * 获取备份策略
 */
export async function getBackupPolicy(instanceId: number): Promise<unknown | null> {
  const policy = await prisma.backupPolicy.findUnique({
    where: { instanceId }
  })
  
  return policy as unknown || null
}

/**
 * 创建或更新备份策略
 */
export async function upsertBackupPolicy(instanceId: number, data: {
  enabled: boolean
  intervalMinutes: number
}): Promise<void> {
  const nextRunAt = new Date()
  nextRunAt.setMinutes(nextRunAt.getMinutes() + data.intervalMinutes)
  
  await prisma.backupPolicy.upsert({
    where: { instanceId },
    create: {
      instanceId,
      enabled: data.enabled,
      intervalMinutes: data.intervalMinutes,
      nextRunAt
    },
    update: {
      enabled: data.enabled,
      intervalMinutes: data.intervalMinutes
    }
  })
}

/**
 * 更新备份策略最后运行时间
 */
export async function updateBackupPolicyLastRun(instanceId: number): Promise<void> {
  const policy = await prisma.backupPolicy.findUnique({
    where: { instanceId },
    select: {
      intervalMinutes: true
    }
  })
  
  if (!policy) return
  
  const now = new Date()
  const nextRunAt = new Date()
  nextRunAt.setMinutes(nextRunAt.getMinutes() + policy.intervalMinutes)
  
  await prisma.backupPolicy.update({
    where: { instanceId },
    data: {
      lastRunAt: now,
      nextRunAt
    }
  })
}

/**
 * 获取待执行的备份策略
 */
export async function getPendingBackupPolicies(): Promise<unknown[]> {
  const now = new Date()
  
  const policies = await prisma.backupPolicy.findMany({
    where: {
      enabled: true,
      OR: [
        { nextRunAt: null },
        { nextRunAt: { lte: now } }
      ]
    },
    orderBy: {
      nextRunAt: 'asc'
    }
  })
  
  return policies as unknown[]
}
