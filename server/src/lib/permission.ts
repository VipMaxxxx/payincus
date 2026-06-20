/**
 * 统一权限检查模块
 * 
 * 将分散在各路由中的权限检查逻辑集中管理
 * 提供一致的权限验证接口
 * 
 * 权限规则：
 * 1. 管理员 (admin): 拥有宿主机所有者的权限，可以查看和管理所有资源
 * 2. 实例所有者: 可以操作自己创建的实例
 * 3. 节点所有者: 可以管理其节点上的所有实例（有限制）
 * 4. 好友: 可以查看好友分享的资源
 * 
 * AUTH004: 节点所有者/管理员权限边界明确定义
 * 
 * 节点所有者/管理员可以：
 * - 启动/停止/重启节点上的实例
 * - 查看节点上所有实例的状态
 * - 创建/恢复节点上实例的快照
 * - 强制停止实例（维护场景）
 * - 查看实例日志和资源使用情况
 * - 删除节点上其他用户的实例（维护/清理场景）
 * 
 * 节点所有者/管理员不可以：
 * - 转移其他用户的实例所有权
 * - 修改其他用户实例的配额
 * - 下载其他用户的备份
 * - 访问其他用户实例的敏感数据（如SSH密钥）
 */

import * as db from '../db/index.js'
import type { FastifyReply } from 'fastify'
import { apiError, ErrorCode } from './errors.js'

/**
 * 用户信息类型
 */
export interface AuthUser {
    id: number
    role: 'admin' | 'user'
    username?: string
}

/**
 * 权限检查结果
 */
export interface PermissionResult {
    allowed: boolean
    reason?: string
    /** 权限类型：owner-所有者, hostOwner-节点所有者, admin-管理员 */
    permissionType?: 'owner' | 'hostOwner' | 'admin' | 'friend'
}

// ==================== 实例权限检查 ====================

/**
 * 检查用户对实例的操作权限
 * 
 * 权限规则：
 * 1. 管理员拥有宿主机所有者的权限，可以操作所有实例
 * 2. 实例所有者可以操作自己创建的实例
 * 3. 节点所有者可以操作其节点上的所有实例
 * 
 * @param user 当前用户
 * @param instance 实例信息（需包含 user_id 和 host_id）
 * @returns 权限检查结果
 */
export async function checkInstancePermission(
    user: AuthUser,
    instance: { user_id: number; host_id: number }
): Promise<PermissionResult> {
    // 1. 管理员拥有宿主机所有者的权限
    if (user.role === 'admin') {
        return { allowed: true, permissionType: 'admin' }
    }

    // 2. 实例所有者有权限
    if (instance.user_id === user.id) {
        return { allowed: true, permissionType: 'owner' }
    }

    // 3. 检查是否是节点所有者
    const host = await db.getHostById(instance.host_id)
    if (host && host.user_id === user.id) {
        return { allowed: true, permissionType: 'hostOwner' }
    }

    return { allowed: false, reason: 'No permission to operate this instance' }
}

/**
 * 检查用户对实例的查看权限
 * 与操作权限一致，管理员拥有宿主机所有者的权限
 */
export async function checkInstanceViewPermission(
    user: AuthUser,
    instance: { user_id: number; host_id: number }
): Promise<PermissionResult> {
    return checkInstancePermission(user, instance)
}

/**
 * 验证实例权限并自动发送错误响应
 * 便捷方法，用于路由处理器中
 * 
 * @returns 如果有权限返回 true，否则发送 403 响应并返回 false
 */
export async function requireInstancePermission(
    user: AuthUser,
    instance: { user_id: number; host_id: number },
    reply: FastifyReply
): Promise<boolean> {
    const result = await checkInstancePermission(user, instance)
    if (!result.allowed) {
        reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        return false
    }
    return true
}

/**
 * 验证实例查看权限并自动发送错误响应
 */
export async function requireInstanceViewPermission(
    user: AuthUser,
    instance: { user_id: number; host_id: number },
    reply: FastifyReply
): Promise<boolean> {
    const result = await checkInstanceViewPermission(user, instance)
    if (!result.allowed) {
        reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        return false
    }
    return true
}

// ==================== 节点权限检查 ====================

/**
 * 检查用户对节点的操作权限
 * 
 * 权限规则：
 * 1. 管理员可以管理所有宿主机
 * 2. 节点所有者可以管理自己的宿主机
 */
export async function checkHostPermission(
    user: AuthUser,
    host: { user_id: number }
): Promise<PermissionResult> {
    // 管理员可以管理所有宿主机
    if (user.role === 'admin') {
        return { allowed: true, permissionType: 'admin' }
    }

    // 节点所有者
    if (host.user_id === user.id) {
        return { allowed: true, permissionType: 'owner' }
    }

    return { allowed: false, reason: 'No permission to operate this host' }
}

/**
 * 验证节点权限并自动发送错误响应
 */
export async function requireHostPermission(
    user: AuthUser,
    host: { user_id: number },
    reply: FastifyReply
): Promise<boolean> {
    const result = await checkHostPermission(user, host)
    if (!result.allowed) {
        reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        return false
    }
    return true
}

// ==================== 备份/快照权限检查 ====================

/**
 * 检查用户对备份的操作权限
 * 权限继承自实例权限
 */
export async function checkBackupPermission(
    user: AuthUser,
    instanceId: number
): Promise<PermissionResult> {
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
        return { allowed: false, reason: 'Instance not found' }
    }

    return checkInstancePermission(user, instance)
}

/**
 * 检查用户对快照的操作权限
 * 权限继承自实例权限
 */
export async function checkSnapshotPermission(
    user: AuthUser,
    instanceId: number
): Promise<PermissionResult> {
    return checkBackupPermission(user, instanceId)
}

// ==================== AUTH004: 节点所有者细粒度权限 ====================

/**
 * 节点所有者允许的操作类型
 */
export type HostOwnerOperation = 
    | 'start'           // 启动实例
    | 'stop'            // 停止实例
    | 'restart'         // 重启实例
    | 'force_stop'      // 强制停止
    | 'view_status'     // 查看状态
    | 'view_logs'       // 查看日志
    | 'snapshot_create' // 创建快照
    | 'snapshot_restore'// 恢复快照
    | 'snapshot_delete' // 删除快照
    | 'delete'          // 删除实例（节点维护/清理场景）

/**
 * 节点所有者禁止的操作类型
 */
export type OwnerOnlyOperation = 
    | 'transfer'        // 转移实例
    | 'modify_quota'    // 修改配额
    | 'backup_download' // 下载备份
    | 'backup_upload'   // 上传备份
    | 'ssh_key_access'  // 访问SSH密钥
    | 'rebuild'         // 重装系统
    | 'port_mapping'    // 端口映射管理

/**
 * 检查节点所有者/管理员是否有权限执行特定操作
 * 
 * @param user 当前用户
 * @param instance 实例信息
 * @param operation 操作类型
 * @returns 权限检查结果
 */
export async function checkHostOwnerOperationPermission(
    user: AuthUser,
    instance: { user_id: number; host_id: number },
    operation: HostOwnerOperation | OwnerOnlyOperation
): Promise<PermissionResult> {
    // 实例所有者可以执行所有操作
    if (instance.user_id === user.id) {
        return { allowed: true, permissionType: 'owner' }
    }

    // 管理员拥有宿主机所有者的权限
    const isAdmin = user.role === 'admin'

    // 检查是否是节点所有者
    const host = await db.getHostById(instance.host_id)
    const isHostOwner = host && host.user_id === user.id

    if (!isAdmin && !isHostOwner) {
        return { allowed: false, reason: 'No permission to operate this instance' }
    }

    // 节点所有者/管理员禁止的操作
    const ownerOnlyOperations: OwnerOnlyOperation[] = [
        'transfer', 'modify_quota', 'backup_download', 
        'backup_upload', 'ssh_key_access', 'rebuild', 'port_mapping'
    ]

    if (ownerOnlyOperations.includes(operation as OwnerOnlyOperation)) {
        return { 
            allowed: false, 
            reason: `Host owner/admin cannot perform '${operation}' on other users' instances`,
            permissionType: isAdmin ? 'admin' : 'hostOwner'
        }
    }

    // 节点所有者/管理员允许的操作
    return { allowed: true, permissionType: isAdmin ? 'admin' : 'hostOwner' }
}

/**
 * 检查操作是否仅限实例所有者
 * 用于敏感操作的权限检查
 * 注意：管理员和宿主机所有者都不能执行仅实例所有者的操作
 */
export async function checkOwnerOnlyPermission(
    user: AuthUser,
    instance: { user_id: number; host_id: number }
): Promise<PermissionResult> {
    if (instance.user_id === user.id) {
        return { allowed: true, permissionType: 'owner' }
    }

    // 管理员也不能执行仅所有者的操作
    if (user.role === 'admin') {
        return { 
            allowed: false, 
            reason: 'This operation is only allowed for the instance owner, not admin',
            permissionType: 'admin'
        }
    }

    // 检查是否是节点所有者（用于返回更准确的错误信息）
    const host = await db.getHostById(instance.host_id)
    if (host && host.user_id === user.id) {
        return { 
            allowed: false, 
            reason: 'This operation is only allowed for the instance owner, not host owner',
            permissionType: 'hostOwner'
        }
    }

    return { allowed: false, reason: 'No permission to operate this instance' }
}

/**
 * 验证仅所有者权限并自动发送错误响应
 */
export async function requireOwnerOnlyPermission(
    user: AuthUser,
    instance: { user_id: number; host_id: number },
    reply: FastifyReply
): Promise<boolean> {
    const result = await checkOwnerOnlyPermission(user, instance)
    if (!result.allowed) {
        // 如果是管理员或节点所有者尝试执行仅限所有者的操作，返回更明确的错误
        if (result.permissionType === 'hostOwner' || result.permissionType === 'admin') {
            reply.code(403).send({
                error: 'HOST_OWNER_RESTRICTED',
                message: 'This operation is only allowed for the instance owner'
            })
        } else {
            reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }
        return false
    }
    return true
}

// ==================== 套餐权限检查 ====================

/**
 * 检查用户对套餐的操作权限
 * 
 * 权限规则：
 * 1. 套餐所有者可以操作自己的套餐
 * 2. 套餐操作仅限套餐所有者，管理员不参与
 */
export async function checkPackagePermission(
    user: AuthUser,
    pkg: { user_id: number }
): Promise<PermissionResult> {
    if (pkg.user_id === user.id) {
        return { allowed: true, permissionType: 'owner' }
    }

    return { allowed: false, reason: 'No permission to operate this package' }
}

// ==================== 用户资源权限检查 ====================

/**
 * 检查是否是资源所有者
 * 通用的所有权检查，管理员不参与业务资源操作
 */
export function checkOwnership(
    user: AuthUser,
    resourceOwnerId: number
): PermissionResult {
    if (user.id === resourceOwnerId) {
        return { allowed: true, permissionType: 'owner' }
    }

    return { allowed: false, reason: 'Not the resource owner' }
}

/**
 * 检查是否是资源所有者（不包含管理员）
 * 用于需要严格所有权验证的场景
 */
export function checkStrictOwnership(
    user: AuthUser,
    resourceOwnerId: number
): PermissionResult {
    if (user.id === resourceOwnerId) {
        return { allowed: true, permissionType: 'owner' }
    }

    return { allowed: false, reason: 'Not the resource owner' }
}

// ==================== 辅助函数 ====================

/**
 * 判断用户是否是管理员
 */
export function isAdmin(user: AuthUser): boolean {
    return user.role === 'admin'
}

/**
 * 判断用户是否是普通用户
 */
export function isRegularUser(user: AuthUser): boolean {
    return user.role === 'user'
}

/**
 * 获取实例并验证权限
 * 便捷方法，用于路由处理器中
 * 
 * @returns 实例对象，如果不存在或无权限返回 null
 */
export async function getInstanceWithPermission(
    user: AuthUser,
    instanceId: number,
    reply: FastifyReply,
    checkType: 'operate' | 'view' = 'operate'
): Promise<Awaited<ReturnType<typeof db.getInstanceById>> | null> {
    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
        reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
        return null
    }

    const hasPermission = checkType === 'view'
        ? await requireInstanceViewPermission(user, instance, reply)
        : await requireInstancePermission(user, instance, reply)

    if (!hasPermission) {
        return null
    }

    return instance
}
