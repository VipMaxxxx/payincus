/**
 * IP 地址数据库操作
 */
import { prisma } from './prisma.js'
import type { IpType } from '@prisma/client'

export interface CreateIpAddressData {
    address: string
    type: IpType
    isPrimary: boolean
    isCustom?: boolean
    device: string
    hostId?: number
    instanceId: number
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

/**
 * 创建 IP 地址记录
 */
export async function createIpAddress(data: CreateIpAddressData) {
    const hostId = data.hostId ?? await resolveInstanceHostId(data.instanceId)

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
