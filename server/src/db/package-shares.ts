/**
 * 套餐共享数据库操作模块
 */

import { prisma } from './prisma.js'
import { getBlockerIdsForUser, isUserBlockedByHoster } from './hosting-blocks.js'

function normalizeGlobalMaxInstances(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : 1
}

// ==================== 类型定义 ====================

export interface PackageShareInfo {
    id: number
    packageId: number
    packageName: string
    ownerId: number
    ownerUsername: string
    sharedToId: number
    sharedToUsername: string
    sharedToAvatarStyle?: string | null
    sharedToAvatarBadgeId?: string | null
    quotaMultiplier: number | null  // 配额倍数限制，null 表示无限制
    maxInstances: number | null     // 最多实例数，null 表示无限制
    createdAt: Date
}

export interface SharedPackageInfo {
    id: number
    name: string
    description: string | null
    cpuMax: number
    memoryMax: number
    diskMax: number
    bandwidthMax: number | null
    networkMode: string
    instanceType: 'container' | 'vm'  // 实例类型
    portLimit: number
    snapshotLimit: number
    backupLimit: number
    siteLimit: number
    monthlyTrafficLimit: string | null
    hostIds: number[]
    nested: number  // 是否支持嵌套虚拟化
    privileged: number  // 是否是特权容器
    ownerId: number
    ownerUsername: string
    sharedAt: Date
    isGlobalShared?: boolean  // 是否是全局共享
    quotaMultiplier?: number | null  // 配额倍数（全局共享时使用）
    maxInstances?: number | null  // 最大实例数（全局共享时使用）
    requiredPackageId?: number | null
    requiredPackageName?: string | null
    allowInstanceDeletion?: boolean  // 是否允许用户删除实例
}

export interface HostingZoneInfo {
    id: number
    name: string
    ownerId: number
    ownerUsername: string
    logoUrl: string
    sortOrder: number
}

// ==================== 共享操作 ====================

/**
 * 共享套餐给好友
 * @param quotaMultiplier 配额倍数限制，如 0.5, 1.0, 1.5, 2.0，null 表示无限制
 * @param maxInstances 最多可开实例数，null 表示无限制
 */
export async function sharePackage(
    packageId: number,
    ownerId: number,
    sharedToId: number,
    quotaMultiplier?: number | null,
    maxInstances?: number | null
): Promise<number> {
    const share = await prisma.packageShare.create({
        data: {
            packageId,
            ownerId,
            sharedToId,
            quotaMultiplier: quotaMultiplier ?? null,
            maxInstances: maxInstances ?? null
        }
    })
    return share.id
}

/**
 * 更新共享配额限制
 * @param shareId 共享记录 ID
 * @param packageId 套餐 ID（用于验证归属）
 * @param quotaMultiplier 配额倍数
 * @param maxInstances 最大实例数
 * @returns 是否更新成功
 */
export async function updateShareQuota(
    shareId: number,
    packageId: number,
    quotaMultiplier?: number | null,
    maxInstances?: number | null
): Promise<boolean> {
    // 安全：确保 shareId 属于指定的 packageId
    const result = await prisma.packageShare.updateMany({
        where: {
            id: shareId,
            packageId: packageId  // 关键安全检查
        },
        data: {
            quotaMultiplier: quotaMultiplier,
            maxInstances: maxInstances
        }
    })
    return result.count > 0
}

/**
 * 获取用户使用某共享套餐已创建的实例统计
 * @param tx 可选的事务客户端，用于在事务中统计（防止并发问题）
 */
export async function getSharedPackageUsage(
    packageId: number, 
    userId: number,
    tx?: typeof prisma
): Promise<{
    instanceCount: number
    totalCpu: number
    totalMemory: number
}> {
    const client = tx || prisma
    // 只统计已成功创建的实例（running 或 stopped），排除 creating、deleted、error 状态
    // 这样可以确保配额统计的准确性，避免创建中的实例永久占用配额
    const instances = await client.instance.findMany({
        where: {
            userId,
            packageId,
            status: { in: ['running', 'stopped'] }
        },
        select: {
            cpu: true,
            memory: true
        }
    })

    return {
        instanceCount: instances.length,
        totalCpu: instances.reduce((sum, i) => sum + i.cpu, 0),
        totalMemory: instances.reduce((sum, i) => sum + i.memory, 0)
    }
}

/**
 * 获取共享记录（用于实例创建时的配额检查）
 * 返回公开套餐的配额信息
 * 注意：已移除好友共享机制
 * @param tx 可选的事务客户端，用于在事务中查询（防止并发问题）
 */
export async function getPackageShareForUser(
    packageId: number, 
    userId: number,
    tx?: typeof prisma
): Promise<{
    id: number
    quotaMultiplier: number | null
    maxInstances: number | null
    isGlobalShared: boolean  // 是否是公开套餐
} | null> {
    const client = tx || prisma

    // 检查是否是公开套餐
    const pkg = await client.package.findUnique({
        where: { id: packageId },
        select: {
            globalShared: true,
            globalQuotaMultiplier: true,
            globalMaxInstances: true,
            userId: true
        }
    })

    if (pkg && pkg.globalShared && pkg.userId !== userId) {
        if (await isUserBlockedByHoster(pkg.userId, userId, client)) {
            return null
        }

        return {
            id: packageId,  // 使用 packageId 作为标识
            quotaMultiplier: null,
            maxInstances: normalizeGlobalMaxInstances(pkg.globalMaxInstances),
            isGlobalShared: true
        }
    }

    if (pkg && pkg.userId !== userId) {
        if (await isUserBlockedByHoster(pkg.userId, userId, client)) {
            return null
        }

        const share = await client.packageShare.findUnique({
            where: {
                packageId_sharedToId: {
                    packageId,
                    sharedToId: userId
                }
            },
            select: {
                id: true,
                quotaMultiplier: true,
                maxInstances: true
            }
        })

        if (share) {
            return {
                id: share.id,
                quotaMultiplier: share.quotaMultiplier ? Number(share.quotaMultiplier) : null,
                maxInstances: share.maxInstances,
                isGlobalShared: false
            }
        }
    }

    return null
}

/**
 * 取消套餐共享
 */
export async function unsharePackage(packageId: number, sharedToId: number): Promise<boolean> {
    const result = await prisma.packageShare.deleteMany({
        where: {
            packageId,
            sharedToId
        }
    })
    return result.count > 0
}

/**
 * 取消套餐的所有共享
 */
export async function unsharePackageAll(packageId: number): Promise<number> {
    const result = await prisma.packageShare.deleteMany({
        where: { packageId }
    })
    return result.count
}

/**
 * 取消两个用户之间的所有套餐共享
 * 用于删除好友关系时自动清理共享
 */
export async function unsharePackageBetweenUsers(userId1: number, userId2: number): Promise<number> {
    // 删除 userId1 共享给 userId2 的套餐
    const result1 = await prisma.packageShare.deleteMany({
        where: {
            ownerId: userId1,
            sharedToId: userId2
        }
    })
    
    // 删除 userId2 共享给 userId1 的套餐
    const result2 = await prisma.packageShare.deleteMany({
        where: {
            ownerId: userId2,
            sharedToId: userId1
        }
    })
    
    return result1.count + result2.count
}

/**
 * 检查套餐是否已共享给某用户
 */
export async function isPackageSharedTo(packageId: number, userId: number): Promise<boolean> {
    const share = await prisma.packageShare.findUnique({
        where: {
            packageId_sharedToId: {
                packageId,
                sharedToId: userId
            }
        }
    })
    return !!share
}

// ==================== 查询操作 ====================

/**
 * 获取套餐的共享列表（套餐所有者查看）
 */
export async function getPackageShares(packageId: number): Promise<PackageShareInfo[]> {
    const shares = await prisma.packageShare.findMany({
        where: { packageId },
        include: {
            package: {
                select: { name: true }
            },
            owner: {
                select: { username: true }
            },
            sharedTo: {
                select: { username: true, avatarStyle: true, avatarBadgeId: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    return shares.map(s => ({
        id: s.id,
        packageId: s.packageId,
        packageName: s.package.name,
        ownerId: s.ownerId,
        ownerUsername: s.owner.username,
        sharedToId: s.sharedToId,
        sharedToUsername: s.sharedTo.username,
        sharedToAvatarStyle: s.sharedTo.avatarStyle,
        sharedToAvatarBadgeId: s.sharedTo.avatarBadgeId ?? null,
        quotaMultiplier: s.quotaMultiplier ? Number(s.quotaMultiplier) : null,
        maxInstances: s.maxInstances,
        createdAt: s.createdAt
    }))
}

/**
 * 获取用户共享出去的所有套餐
 */
export async function getSharedByUser(userId: number): Promise<PackageShareInfo[]> {
    const shares = await prisma.packageShare.findMany({
        where: { ownerId: userId },
        include: {
            package: {
                select: { name: true }
            },
            owner: {
                select: { username: true }
            },
            sharedTo: {
                select: { username: true, avatarStyle: true, avatarBadgeId: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    return shares.map(s => ({
        id: s.id,
        packageId: s.packageId,
        packageName: s.package.name,
        ownerId: s.ownerId,
        ownerUsername: s.owner.username,
        sharedToId: s.sharedToId,
        sharedToUsername: s.sharedTo.username,
        sharedToAvatarStyle: s.sharedTo.avatarStyle,
        sharedToAvatarBadgeId: s.sharedTo.avatarBadgeId ?? null,
        quotaMultiplier: s.quotaMultiplier ? Number(s.quotaMultiplier) : null,
        maxInstances: s.maxInstances,
        createdAt: s.createdAt
    }))
}

/**
 * 获取共享给用户的套餐列表（好友共享）
 * 通过 PackageShare 表查询好友共享的套餐
 */
export async function getSharedToUser(userId: number): Promise<SharedPackageInfo[]> {
    const blockerIds = await getBlockerIdsForUser(userId)
    const shares = await prisma.packageShare.findMany({
        where: {
            sharedToId: userId,
            ...(blockerIds.length > 0 ? { ownerId: { notIn: blockerIds } } : {})
        },
        include: {
            package: {
                include: {
                    packageHosts: {
                        select: { hostId: true }
                    },
                    user: {
                        select: { id: true, username: true }
                    },
                    requiredPackage: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    // 只返回启用的套餐
    return shares
        .filter(s => s.package.active)
        .map(s => ({
            id: s.package.id,
            name: s.package.name,
            description: s.package.description,
            cpuMax: s.package.cpuMax,
            memoryMax: s.package.memoryMax,
            diskMax: s.package.diskMax,
            bandwidthMax: s.package.bandwidthMax,
            networkMode: s.package.networkMode,
            instanceType: s.package.instanceType === 'vm' ? 'vm' : 'container',
            portLimit: s.package.portLimit,
            snapshotLimit: s.package.snapshotLimit,
            backupLimit: s.package.backupLimit,
            siteLimit: s.package.siteLimit,
            monthlyTrafficLimit: s.package.monthlyTrafficLimit?.toString() ?? null,
            nested: s.package.nested ? 1 : 0,
            privileged: s.package.privileged ? 1 : 0,
            allowInstanceDeletion: s.package.allowInstanceDeletion,
            hostIds: s.package.packageHosts.map(ph => ph.hostId),
            ownerId: s.package.user.id,
            ownerUsername: s.package.user.username,
            sharedAt: s.createdAt,
            isGlobalShared: false,
            quotaMultiplier: s.quotaMultiplier ? Number(s.quotaMultiplier) : null,
            maxInstances: s.maxInstances,
            requiredPackageId: s.package.requiredPackageId,
            requiredPackageName: s.package.requiredPackage?.name ?? null
        }))
}

/**
 * 获取托管市场的套餐列表（用户托管的公开套餐）
 * 非管理员创建的 globalShared=true 的套餐
 * 注意：现在包含用户自己的套餐（展示用），但创建实例时会校验
 */
export async function getActiveHostingZoneOwnerIds(): Promise<number[]> {
    const zones = await prisma.hostingZone.findMany({
        where: { active: true },
        select: { ownerId: true }
    })
    return zones.map(zone => zone.ownerId)
}

export async function getHostingZonesForViewer(viewerId?: number): Promise<HostingZoneInfo[]> {
    const blockerIds = viewerId ? await getBlockerIdsForUser(viewerId) : []
    const zones = await prisma.hostingZone.findMany({
        where: {
            active: true,
            ...(blockerIds.length > 0 ? { ownerId: { notIn: blockerIds } } : {})
        },
        include: {
            owner: {
                select: {
                    id: true,
                    username: true
                }
            }
        },
        orderBy: [
            { sortOrder: 'asc' },
            { id: 'asc' }
        ]
    })

    return zones.map(zone => ({
        id: zone.id,
        name: zone.name,
        ownerId: zone.ownerId,
        ownerUsername: zone.owner.username,
        logoUrl: zone.logoUrl,
        sortOrder: zone.sortOrder
    }))
}

export async function getActiveHostingZoneById(zoneId: number, viewerId?: number): Promise<HostingZoneInfo | null> {
    const zone = await prisma.hostingZone.findFirst({
        where: {
            id: zoneId,
            active: true
        },
        include: {
            owner: {
                select: {
                    id: true,
                    username: true
                }
            }
        }
    })

    if (!zone) return null
    if (viewerId && await isUserBlockedByHoster(zone.ownerId, viewerId)) return null

    return {
        id: zone.id,
        name: zone.name,
        ownerId: zone.ownerId,
        ownerUsername: zone.owner.username,
        logoUrl: zone.logoUrl,
        sortOrder: zone.sortOrder
    }
}

export async function getHostedMarketPackages(
    viewerId?: number,
    options: {
        ownerId?: number
        excludeOwnerIds?: number[]
    } = {}
): Promise<SharedPackageInfo[]> {
    const blockerIds = viewerId ? await getBlockerIdsForUser(viewerId) : []
    const excludedOwnerIds = Array.from(new Set([
        ...blockerIds,
        ...(options.excludeOwnerIds || [])
    ]))

    if (options.ownerId && excludedOwnerIds.includes(options.ownerId)) {
        return []
    }

    const packages = await prisma.package.findMany({
        where: {
            globalShared: true,
            active: true,
            ...(options.ownerId
                ? { userId: options.ownerId }
                : excludedOwnerIds.length > 0
                    ? { userId: { notIn: excludedOwnerIds } }
                    : {}),
            // 不再排除用户自己的套餐，允许展示
            user: {
                role: { not: 'admin' }  // 排除管理员创建的套餐（那是官方套餐）
            }
        },
        include: {
            packageHosts: {
                select: { hostId: true }
            },
            user: {
                select: { id: true, username: true }
            },
            requiredPackage: {
                select: {
                    id: true,
                    name: true
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    return packages.map(pkg => ({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        cpuMax: pkg.cpuMax,
        memoryMax: pkg.memoryMax,
        diskMax: pkg.diskMax,
        bandwidthMax: pkg.bandwidthMax,
        networkMode: pkg.networkMode,
        instanceType: pkg.instanceType === 'vm' ? 'vm' : 'container',
        portLimit: pkg.portLimit,
        snapshotLimit: pkg.snapshotLimit,
        backupLimit: pkg.backupLimit,
        siteLimit: pkg.siteLimit,
        monthlyTrafficLimit: pkg.monthlyTrafficLimit?.toString() ?? null,
        nested: pkg.nested ? 1 : 0,
        privileged: pkg.privileged ? 1 : 0,
        allowInstanceDeletion: pkg.allowInstanceDeletion,
        hostIds: pkg.packageHosts.map(ph => ph.hostId),
        ownerId: pkg.user.id,
        ownerUsername: pkg.user.username,
        sharedAt: pkg.createdAt,
        isGlobalShared: true,  // 托管市场也是全局共享类型
        quotaMultiplier: null,
        maxInstances: normalizeGlobalMaxInstances(pkg.globalMaxInstances),
        requiredPackageId: pkg.requiredPackageId,
        requiredPackageName: pkg.requiredPackage?.name ?? null
    }))
}

/**
 * 获取全局共享的套餐列表（仅管理员创建的官方套餐）
 * 注意：用户托管的套餐不在此列表中显示，将通过其他入口访问
 * 注意：现在包含用户自己的套餐（展示用），但创建实例时会校验
 */
export async function getGlobalSharedPackages(): Promise<SharedPackageInfo[]> {
    const packages = await prisma.package.findMany({
        where: {
            globalShared: true,
            active: true,
            // 不再排除用户自己的套餐，允许展示
            user: {
                role: 'admin'  // 只返回管理员创建的套餐（官方套餐）
            }
        },
        include: {
            packageHosts: {
                select: { hostId: true }
            },
            user: {
                select: { id: true, username: true }
            },
            requiredPackage: {
                select: {
                    id: true,
                    name: true
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    return packages.map(pkg => ({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        cpuMax: pkg.cpuMax,
        memoryMax: pkg.memoryMax,
        diskMax: pkg.diskMax,
        bandwidthMax: pkg.bandwidthMax,
        networkMode: pkg.networkMode,
        instanceType: pkg.instanceType === 'vm' ? 'vm' : 'container',
        portLimit: pkg.portLimit,
        snapshotLimit: pkg.snapshotLimit,
        backupLimit: pkg.backupLimit,
        siteLimit: pkg.siteLimit,
        monthlyTrafficLimit: pkg.monthlyTrafficLimit?.toString() ?? null,
        nested: pkg.nested ? 1 : 0,  // 嵌套虚拟化支持
        privileged: pkg.privileged ? 1 : 0,  // 特权容器
        allowInstanceDeletion: pkg.allowInstanceDeletion,  // 实例操作权限
        hostIds: pkg.packageHosts.map(ph => ph.hostId),
        ownerId: pkg.user.id,
        ownerUsername: pkg.user.username,
        sharedAt: pkg.createdAt,  // 使用套餐创建时间
        isGlobalShared: true,
        quotaMultiplier: null,
        maxInstances: normalizeGlobalMaxInstances(pkg.globalMaxInstances),
        requiredPackageId: pkg.requiredPackageId,
        requiredPackageName: pkg.requiredPackage?.name ?? null
    }))
}

/**
 * 获取用户可用的套餐ID列表（自己的 + 公开的）
 * 注意：已移除好友共享机制
 */
export async function getAccessiblePackageIds(userId: number): Promise<number[]> {
    const blockerIds = await getBlockerIdsForUser(userId)
    // 获取自己的套餐（管理员）
    const ownPackages = await prisma.package.findMany({
        where: { userId, active: true },
        select: { id: true }
    })

    // 获取公开的套餐（globalShared = true）
    const publicPackages = await prisma.package.findMany({
        where: { 
            globalShared: true,
            active: true,
            userId: {
                not: userId,
                ...(blockerIds.length > 0 ? { notIn: blockerIds } : {})
            }
        },
        select: { id: true }
    })

    const ownIds = ownPackages.map(p => p.id)
    const publicIds = publicPackages.map(p => p.id)

    return [...new Set([...ownIds, ...publicIds])]
}

/**
 * 检查用户是否有权使用某套餐
 * 支持以下场景：
 * - 套餐所有者（始终可访问）
 * - 公开套餐（globalShared = true）
 * - 好友共享套餐（通过 PackageShare 表）
 */
export async function canUserAccessPackage(userId: number, packageId: number): Promise<boolean> {
    const pkg = await prisma.package.findUnique({
        where: { id: packageId },
        select: {
            userId: true,
            active: true,
            globalShared: true
        }
    })
    
    if (!pkg) return false
    
    // 检查是否是自己的套餐（所有者始终可以访问，无论套餐是否启用）
    if (pkg.userId === userId) return true

    if (await isUserBlockedByHoster(pkg.userId, userId)) return false
    
    // 非所有者只能访问启用的套餐
    if (!pkg.active) return false
    
    // 检查是否是公开套餐（包括官方直营和托管市场）
    if (pkg.globalShared) return true

    // 检查是否是好友共享的套餐
    const share = await prisma.packageShare.findFirst({
        where: {
            packageId: packageId,
            sharedToId: userId
        }
    })
    if (share) return true

    // 不是所有者、不是公开套餐、也没有好友共享，无权访问
    return false
}
