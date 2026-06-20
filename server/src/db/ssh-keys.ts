/**
 * SSH 密钥相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { SshKey } from '../types/database.js'

/**
 * 获取用户的所有 SSH 密钥
 */
export async function getSSHKeysByUserId(userId: number): Promise<SshKey[]> {
  const sshKeys = await prisma.sshKey.findMany({
    where: { userId },
    orderBy: {
      createdAt: 'desc'
    }
  })
  
  return sshKeys.map(key => ({
    id: key.id,
    user_id: key.userId,
    name: key.name,
    public_key: key.publicKey,
    fingerprint: key.fingerprint,
    created_at: key.createdAt.toISOString()
  }))
}

/**
 * 根据 ID 获取 SSH 密钥
 */
export async function getSSHKeyById(id: number): Promise<SshKey | null> {
  const sshKey = await prisma.sshKey.findUnique({
    where: { id }
  })
  
  if (!sshKey) return null
  
  return {
    id: sshKey.id,
    user_id: sshKey.userId,
    name: sshKey.name,
    public_key: sshKey.publicKey,
    fingerprint: sshKey.fingerprint,
    created_at: sshKey.createdAt.toISOString()
  }
}

/**
 * 创建 SSH 密钥
 */
export async function createSSHKey(data: {
  userId: number
  name: string
  publicKey: string
  fingerprint: string
}): Promise<number> {
  const sshKey = await prisma.sshKey.create({
    data: {
      userId: data.userId,
      name: data.name,
      publicKey: data.publicKey,
      fingerprint: data.fingerprint
    }
  })
  
  return sshKey.id
}

/**
 * 删除 SSH 密钥
 */
export async function deleteSSHKey(id: number): Promise<void> {
  await prisma.sshKey.delete({
    where: { id }
  })
}
