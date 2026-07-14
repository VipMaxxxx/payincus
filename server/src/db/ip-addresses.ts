/**
 * IP 地址数据库操作
 */
import { prisma } from './prisma.js'
import type { IpAddress, IpType, Prisma } from '@prisma/client'
import {
    IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE,
    advisoryTransactionLockString
} from './advisory-locks.js'
import { listNatIpv4Pool } from '../lib/ip-calculator.js'

export interface CreateIpAddressData {
    address: string
    type: IpType
    isPrimary: boolean
    isCustom?: boolean
    device: string
    hostId?: number
    instanceId: number
}

export interface UpdateIpAddressAddressData {
    id: number
    address: string
    isCustom?: boolean
}

const IP_ADDRESS_ALREADY_EXISTS_ERROR = 'IP_ADDRESS_ALREADY_EXISTS'

export function isIpAddressAlreadyExistsError(error: unknown): boolean {
    return error instanceof Error && error.message === IP_ADDRESS_ALREADY_EXISTS_ERROR
}

async function resolveInstanceHostId(instanceId: number): Promise<number> {
    const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        select: { hostId: true }
    })

    if (!instance) {
        throw new Error(`Instance ${instanceId} not found while creating IP address record`)
    }

    return instance.hostId
}

async function assertIpAddressAvailable(
    tx: Prisma.TransactionClient,
    input: {
        address: string
        type: IpType
        instanceId: number
        isPrimary: boolean
        excludeIpAddressId?: number
    }
): Promise<void> {
    if (input.type !== 'inet6') {
        return
    }

    const existingIp = await tx.ipAddress.findFirst({
        where: {
            address: input.address,
            type: input.type,
            ...(input.excludeIpAddressId ? { id: { not: input.excludeIpAddressId } } : {}),
            instance: {
                status: { not: 'deleted' }
            }
        },
        select: { id: true }
    })
    if (existingIp) {
        throw new Error(IP_ADDRESS_ALREADY_EXISTS_ERROR)
    }

    const existingInstance = await tx.instance.findFirst({
        where: {
            ipv6: input.address,
            status: { not: 'deleted' },
            ...(input.isPrimary ? { id: { not: input.instanceId } } : {})
        },
        select: { id: true }
    })
    if (existingInstance) {
        throw new Error(IP_ADDRESS_ALREADY_EXISTS_ERROR)
    }
}

/**
 * 创建 IP 地址记录
 */
export async function createIpAddress(data: CreateIpAddressData): Promise<IpAddress> {
    const hostId = data.hostId ?? await resolveInstanceHostId(data.instanceId)

    if (data.type === 'inet6') {
        return prisma.$transaction(async (tx) => {
            await advisoryTransactionLockString(tx, IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE, data.address)
            await assertIpAddressAvailable(tx, {
                address: data.address,
                type: data.type,
                instanceId: data.instanceId,
                isPrimary: data.isPrimary
            })

            return tx.ipAddress.create({
                data: {
                    address: data.address,
                    type: data.type,
                    isPrimary: data.isPrimary,
                    isCustom: data.isCustom ?? false,
                    device: data.device,
                    host: {
                        connect: { id: hostId }
                    },
                    instance: {
                        connect: { id: data.instanceId }
                    }
                }
            })
        })
    }

    return prisma.ipAddress.create({
        data: {
            address: data.address,
            type: data.type,
            isPrimary: data.isPrimary,
            isCustom: data.isCustom ?? false,
            device: data.device,
            host: {
                connect: { id: hostId }
            },
            instance: {
                connect: { id: data.instanceId }
            }
        }
    })
}

/**
 * 更新 IP 地址。主 IPv6 地址必须同时同步 Instance.ipv6，避免列表字段和
 * ip_addresses 表出现不同步。
 */
export async function updateIpAddressAddress(data: UpdateIpAddressAddressData): Promise<IpAddress> {
    return prisma.$transaction(async (tx) => {
        const record = await tx.ipAddress.findUnique({
            where: { id: data.id },
            select: {
                id: true,
                type: true,
                instanceId: true,
                isPrimary: true
            }
        })

        if (!record) {
            throw new Error('IP_ADDRESS_NOT_FOUND')
        }

        if (record.type === 'inet6') {
            await advisoryTransactionLockString(tx, IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE, data.address)
            await assertIpAddressAvailable(tx, {
                address: data.address,
                type: record.type,
                instanceId: record.instanceId,
                isPrimary: record.isPrimary,
                excludeIpAddressId: record.id
            })
        }

        const updated = await tx.ipAddress.update({
            where: { id: data.id },
            data: {
                address: data.address,
                ...(data.isCustom !== undefined ? { isCustom: data.isCustom } : {})
            }
        })

        if (record.type === 'inet6' && record.isPrimary) {
            await tx.instance.update({
                where: { id: record.instanceId },
                data: { ipv6: data.address }
            })
        }

        return updated
    })
}

/**
 * 获取实例的所有 IP 地址
 */
export async function getIpAddressesByInstanceId(instanceId: number) {
    return prisma.ipAddress.findMany({
        where: { instanceId },
        orderBy: [
            { isPrimary: 'desc' },
            { createdAt: 'asc' }
        ]
    })
}

/**
 * 获取实例的主 IP 地址
 */
export async function getPrimaryIpAddress(instanceId: number, type: IpType) {
    return prisma.ipAddress.findFirst({
        where: {
            instanceId,
            type,
            isPrimary: true
        }
    })
}

/**
 * 根据 ID 获取 IP 地址
 */
export async function getIpAddressById(id: number) {
    return prisma.ipAddress.findUnique({
        where: { id },
        include: {
            instance: {
                include: {
                    host: true
                }
            }
        }
    })
}

/**
 * 删除 IP 地址
 */
export async function deleteIpAddress(id: number) {
    return prisma.ipAddress.delete({
        where: { id }
    })
}

/**
 * 获取实例下一个可用的网卡设备名
 */
export async function getNextDeviceName(instanceId: number): Promise<string> {
    const existingIps = await prisma.ipAddress.findMany({
        where: { instanceId },
        select: { device: true }
    })

    // 提取已使用的设备编号
    const usedIndices = existingIps
        .map((ip: { device: string }) => {
            const match = ip.device.match(/^eth(\d+)$/)
            return match ? parseInt(match[1], 10) : -1
        })
        .filter((idx: number) => idx >= 0)

    // 找到下一个可用编号
    let nextIndex = 0
    while (usedIndices.includes(nextIndex)) {
        nextIndex++
    }

    return `eth${nextIndex}`
}

/**
 * 检查 IP 地址是否已存在（全局检查）
 * 用于 IPv6 等公网地址的全局唯一性检查
 * 
 * 检查两个来源：
 * 1. IpAddress 表中的记录
 * 2. Instance 表的 ipv6 字段（防止数据不一致导致的冲突）
 * 
 * 注意：排除已删除状态的实例
 */
export async function isIpAddressExists(address: string): Promise<boolean> {
    // 1. 检查 IpAddress 表（排除已删除的实例）
    const existingInIpTable = await prisma.ipAddress.findFirst({
        where: {
            address,
            type: 'inet6',
            instance: {
                status: { not: 'deleted' }
            }
        }
    })
    if (existingInIpTable) {
        return true
    }

    // 2. 检查 Instance 表的 ipv6 字段（防止数据不一致）
    // 有些实例可能 ipv6 字段有值，但 IpAddress 表没有对应记录
    const existingInInstanceTable = await prisma.instance.findFirst({
        where: {
            ipv6: address,
            status: { not: 'deleted' }
        }
    })
    
    return !!existingInInstanceTable
}

/**
 * 检查 IP 地址在指定宿主机范围内是否已存在
 * 用于内网 IPv4 地址的按宿主机唯一性检查
 * （不同宿主机的内网是隔离的，可以使用相同的内网 IP）
 * 
 * 检查两个来源：
 * 1. IpAddress 表中的记录
 * 2. Instance 表的 ipv4 字段（防止数据不一致导致的冲突）
 * 
 * 注意：排除已删除状态的实例
 * 
 * @param address IP 地址
 * @param hostId 宿主机 ID
 * @returns 是否已存在
 */
export async function isIpAddressExistsOnHost(address: string, hostId: number): Promise<boolean> {
    // 1. 检查 IpAddress 表（排除已删除的实例）
    const existingInIpTable = await prisma.ipAddress.findFirst({
        where: {
            address,
            type: 'inet4',
            host: {
                is: { id: hostId }
            },
            instance: {
                status: { not: 'deleted' }
            }
        }
    })
    if (existingInIpTable) {
        return true
    }

    // 2. 检查 Instance 表的 ipv4 字段（防止数据不一致）
    // 有些实例可能 ipv4 字段有值，但 IpAddress 表没有对应记录
    const existingInInstanceTable = await prisma.instance.findFirst({
        where: {
            hostId,
            ipv4: address,
            status: { not: 'deleted' }
        }
    })
    
    return !!existingInInstanceTable
}

/**
 * 统计实例的 IP 数量
 */
export async function countIpAddresses(instanceId: number): Promise<number> {
    return prisma.ipAddress.count({
        where: { instanceId }
    })
}

/**
 * 分配一个宿主机内网 NAT IPv4，并在同一把锁内立即把它写进 instance.ipv4 完成「预留」。
 *
 * ── 为什么必须这样做 ──
 * 原来的做法散落在 7 处：generateRandomIPv4() 随机取一个 → isIpAddressExistsOnHost() 查重 →
 * 把 IP 只留在内存里 → 等实例交付完成（数分钟后）才写回 instance.ipv4 并建 ip_addresses 记录。
 *
 * 在这数分钟的窗口里，这个已被「分配」的 IP 对查重的两处（ip_addresses 表、instance.ipv4）
 * 都是隐形的。同一宿主机上并发创建的实例会分到同一个内网 IP —— 两个容器同 IP，端口转发随即
 * 打到错误的容器上。地址池只有 766 个，实例越多撞得越狠。DB 侧当时也没有唯一约束兜底。
 *
 * 因此：
 *   1. 分配全程在「每宿主机一把」的事务级 advisory lock 内，并发创建被串行化；
 *   2. 仍在锁内就把 IP 落库（instance.ipv4）——预留立刻对所有后续分配可见；
 *   3. 不再「随机试 N 次」，而是一次性算出空闲集合再挑：池子只有 766 个，随机重试在池子
 *      填满时会退化成试不出来。
 */
const NAT_IPV4_RESERVATION_TTL_MS = 60 * 60 * 1000

export async function allocateAndReserveNatIpv4(
    hostId: number,
    instanceId?: number
): Promise<string | null> {
    return await prisma.$transaction(async (tx) => {
        // 每宿主机一把锁：内网 IP 只需在同一宿主机内唯一，不同宿主机之间互不影响。
        await advisoryTransactionLockString(
            tx,
            IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE,
            `nat-ipv4:host:${hostId}`
        )

        const now = new Date()
        // 顺手清掉过期预留：交付失败的地址不该被永久占住。
        await tx.natIpv4Reservation.deleteMany({ where: { expiresAt: { lt: now } } })

        const [usedInIpTable, usedOnInstances, reserved] = await Promise.all([
            tx.ipAddress.findMany({
                where: {
                    hostId,
                    type: 'inet4',
                    instance: { status: { not: 'deleted' } }
                },
                select: { address: true }
            }),
            tx.instance.findMany({
                where: {
                    hostId,
                    ipv4: { not: null },
                    status: { not: 'deleted' }
                },
                select: { ipv4: true }
            }),
            tx.natIpv4Reservation.findMany({
                where: { hostId, expiresAt: { gte: now } },
                select: { address: true }
            })
        ])

        const used = new Set<string>()
        for (const row of usedInIpTable) used.add(row.address)
        for (const row of usedOnInstances) if (row.ipv4) used.add(row.ipv4)
        for (const row of reserved) used.add(row.address)

        const free = listNatIpv4Pool().filter(address => !used.has(address))
        if (free.length === 0) return null

        const candidate = free[Math.floor(Math.random() * free.length)]

        // 预留必须在锁内落库，否则窗口依旧存在。
        // 预留独立成行（而不是写在 instance.ipv4 上）：克隆流程在新实例入库之前就要确定 IP，
        // 那时还没有 instanceId；换节点时实例仍挂在旧宿主机下，写 instance.ipv4 对目标宿主机不可见。
        await tx.natIpv4Reservation.create({
            data: {
                hostId,
                address: candidate,
                expiresAt: new Date(now.getTime() + NAT_IPV4_RESERVATION_TTL_MS)
            }
        })

        // 实例已经存在且就在这台宿主机上时，顺带把 IP 写进 instance.ipv4，让面板立刻能看到。
        // 换节点场景（实例仍挂在旧宿主机）会被 hostId 条件挡掉，hostId 由换节点流程最后统一切换。
        if (instanceId) {
            await tx.instance.updateMany({
                where: { id: instanceId, hostId },
                data: { ipv4: candidate }
            })
        }

        return candidate
    })
}
