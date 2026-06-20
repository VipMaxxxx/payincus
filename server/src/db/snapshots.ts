/**
 * 快照相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { Snapshot } from '../types/database.js'

/**
 * 获取实例的快照列表
 */
export async function getSnapshotsByInstanceId(instanceId: number): Promise<Snapshot[]> {
  const snapshots = await prisma.snapshot.findMany({
    where: { instanceId },
    orderBy: {
      createdAt: 'desc'
    }
  })
  
  return snapshots.map(s => ({
    id: s.id,
    instance_id: s.instanceId,
    incus_name: s.incusName,
    name: s.name,
    description: s.description,
    stateful: s.stateful ? 1 : 0,
    size: s.size,
    created_at: s.createdAt.toISOString()
  }))
}

/**
 * 根据 ID 获取快照
 */
export async function getSnapshotById(id: number): Promise<Snapshot | null> {
  const snapshot = await prisma.snapshot.findUnique({
    where: { id }
  })
  
  if (!snapshot) return null
  
  return {
    id: snapshot.id,
    instance_id: snapshot.instanceId,
    incus_name: snapshot.incusName,
    name: snapshot.name,
    description: snapshot.description,
    stateful: snapshot.stateful ? 1 : 0,
    size: snapshot.size,
    created_at: snapshot.createdAt.toISOString()
  }
}

/**
 * 创建快照
 */
export async function createSnapshot(data: {
  instanceId: number
  incusName: string
  name: string
  description?: string | null
  stateful?: boolean
}): Promise<number> {
  const snapshot = await prisma.snapshot.create({
    data: {
      instanceId: data.instanceId,
      incusName: data.incusName,
      name: data.name,
      description: data.description ?? null,
      stateful: data.stateful ?? false
    }
  })
  
  return snapshot.id
}

/**
 * 更新快照大小
 */
export async function updateSnapshotSize(id: number, size: number): Promise<void> {
  await prisma.snapshot.update({
    where: { id },
    data: { size }
  })
}

/**
 * 删除快照
 */
export async function deleteSnapshot(id: number): Promise<void> {
  await prisma.snapshot.delete({
    where: { id }
  })
}

/**
 * 获取快照策略
 */
export async function getSnapshotPolicy(instanceId: number): Promise<unknown | null> {
  const policy = await prisma.snapshotPolicy.findUnique({
    where: { instanceId }
  })
  
  return policy as unknown || null
}

/**
 * 创建或更新快照策略
 */
export async function upsertSnapshotPolicy(instanceId: number, data: {
  enabled: boolean
  intervalMinutes: number
}): Promise<void> {
  const nextRunAt = new Date()
  nextRunAt.setMinutes(nextRunAt.getMinutes() + data.intervalMinutes)
  
  await prisma.snapshotPolicy.upsert({
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
 * 更新快照策略最后运行时间
 */
export async function updateSnapshotPolicyLastRun(instanceId: number): Promise<void> {
  const policy = await prisma.snapshotPolicy.findUnique({
    where: { instanceId },
    select: {
      intervalMinutes: true
    }
  })
  
  if (!policy) return
  
  const now = new Date()
  const nextRunAt = new Date()
  nextRunAt.setMinutes(nextRunAt.getMinutes() + policy.intervalMinutes)
  
  await prisma.snapshotPolicy.update({
    where: { instanceId },
    data: {
      lastRunAt: now,
      nextRunAt
    }
  })
}

/**
 * 获取待执行的快照策略
 */
export async function getPendingSnapshotPolicies(): Promise<unknown[]> {
  const now = new Date()
  
  const policies = await prisma.snapshotPolicy.findMany({
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
