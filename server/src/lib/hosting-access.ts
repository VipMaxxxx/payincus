/**
 * 托管准入校验模块
 * 
 * 准入条件：
 * - 至少拥有过1台实例（不论免费/付费，不论官方直营/托管）
 */

import { prisma } from '../db/index.js'
import { getSystemConfigBoolean } from '../db/system-config.js'

// 准入配置常量
const HOSTING_ACCESS_CONFIG = {
  // 最低实例数量（不限类型）
  minInstances: 1
}

export interface HostingAccessResult {
  allowed: boolean
  reason?: string
  details?: {
    instanceCount: number
    hasCreatedHostBefore: boolean
    featureEnabled: boolean
    hiddenBySystemSetting: boolean
  }
}

interface CheckHostingAccessOptions {
  enforceFeatureVisibility?: boolean
}

interface HostingFeatureState {
  role: 'admin' | 'user'
  hasCreatedHostBefore: boolean
  featureEnabled: boolean
}

async function getHostingFeatureState(userId: number): Promise<HostingFeatureState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      hasCreatedHostBefore: true
    }
  })

  if (!user) {
    return null
  }

  const featureEnabled = await getSystemConfigBoolean('hosting_feature_enabled', true)

  return {
    role: user.role,
    hasCreatedHostBefore: user.hasCreatedHostBefore,
    featureEnabled
  }
}

export async function getUserHostingFeatureStatus(userId: number): Promise<{
  canAccessHostingFeature: boolean
  hasCreatedHostBefore: boolean
  featureEnabled: boolean
}> {
  const state = await getHostingFeatureState(userId)
  if (!state) {
    return {
      canAccessHostingFeature: false,
      hasCreatedHostBefore: false,
      featureEnabled: false
    }
  }

  if (state.role === 'admin') {
    return {
      canAccessHostingFeature: true,
      hasCreatedHostBefore: state.hasCreatedHostBefore,
      featureEnabled: true
    }
  }

  return {
    canAccessHostingFeature: state.featureEnabled || state.hasCreatedHostBefore,
    hasCreatedHostBefore: state.hasCreatedHostBefore,
    featureEnabled: state.featureEnabled
  }
}

/**
 * 检查用户是否满足托管准入条件
 */
export async function checkHostingAccess(
  userId: number,
  options: CheckHostingAccessOptions = {}
): Promise<HostingAccessResult> {
  const { enforceFeatureVisibility = true } = options
  const state = await getHostingFeatureState(userId)
  if (!state) {
    return { allowed: false, reason: '用户不存在' }
  }

  // 管理员直接放行
  if (state.role === 'admin') {
    return { allowed: true }
  }

  // 查询用户拥有过的实例数量（不限类型，包含免费/付费、官方直营/托管）
  const instanceCount = await prisma.instance.count({
    where: { userId }
  })

  const details = {
    instanceCount,
    hasCreatedHostBefore: state.hasCreatedHostBefore,
    featureEnabled: state.featureEnabled,
    hiddenBySystemSetting: !state.featureEnabled && !state.hasCreatedHostBefore
  }

  if (enforceFeatureVisibility && details.hiddenBySystemSetting) {
    return {
      allowed: false,
      reason: '托管功能暂未向未创建过节点的用户开放',
      details
    }
  }

  if (instanceCount >= HOSTING_ACCESS_CONFIG.minInstances) {
    return { allowed: true, details }
  }

  return {
    allowed: false,
    reason: `不满足托管准入条件：需要至少拥有过 ${HOSTING_ACCESS_CONFIG.minInstances} 台实例（当前 ${instanceCount} 台）`,
    details
  }
}

/**
 * 判断节点是否为用户托管节点（非管理员节点）
 */
export async function isUserHostedNode(hostId: number): Promise<boolean> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: {
      user: {
        select: {
          role: true
        }
      }
    }
  })
  return host?.user.role === 'user'
}

/**
 * 获取节点所有者ID
 */
export async function getHostOwnerId(hostId: number): Promise<number | null> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { userId: true }
  })
  return host?.userId ?? null
}
