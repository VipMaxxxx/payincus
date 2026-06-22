/**
 * IP 地址管理路由
 * 
 * 新双网卡架构:
 * - eth0: bridged (NAT IPv4)
 * - eth1: routed (IPv6)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getIncusClient } from '../lib/incus/index.js'
import { generateRandomIPv6, generateRandomSubnet, isIpv6InSubnet, isIpv6SubnetWithinSubnet, isStrictValidIpv6 } from '../lib/ip-calculator.js'
import { syncInstanceNetwork, isValidIpv6Subnet } from '../lib/network-payload-builder.js'
import type { IPv6Config } from '../types/incus.js'
import * as ipv6Subnets from '../db/ipv6-subnets.js'

// IP 地址记录类型
interface IpAddressRecord {
    id: number
    address: string
    type: string
    isPrimary: boolean
    isCustom?: boolean
    device: string
    createdAt: Date
}

// IPv6 网段记录类型
interface Ipv6SubnetRecord {
    id: number
    cidr: string
    primaryIp: string
    device: string
    instanceId: number
    createdAt: Date
}

const POSITIVE_INTEGER_ID_RE = /^[1-9]\d*$/

function parsePositiveId(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? value : null
    }

    if (typeof value !== 'string' || !POSITIVE_INTEGER_ID_RE.test(value)) {
        return null
    }

    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
}

export default async function ipAddressRoutes(fastify: FastifyInstance) {
    /**
     * 获取实例的所有 IP 地址
     */
    fastify.get<{ Params: { instanceId: string } }>(
        '/instances/:instanceId/ips',
        { onRequest: [fastify.authenticateUser] },
        async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
            const user = request.user!
            const instanceId = parsePositiveId(request.params.instanceId)

            if (instanceId === null) {
                return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))
            }

            // 验证实例权限：管理员、实例所有者、宿主机所有者
            const instance = await db.getInstanceById(instanceId)
            if (!instance) {
                return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
            }
            // 管理员拥有宿主机所有者的权限
            if (user.role !== 'admin' && instance.user_id !== user.id) {
                const host = await db.getHostById(instance.host_id)
                if (!host || host.user_id !== user.id) {
                    return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
                }
            }

            const ipAddresses = await db.getIpAddressesByInstanceId(instanceId)

            return {
                ipAddresses: ipAddresses.map((ip: IpAddressRecord) => ({
                    id: ip.id,
                    address: ip.address,
                    type: ip.type,
                    isPrimary: ip.isPrimary,
                    isCustom: ip.isCustom || false,
                    device: ip.device,
                    createdAt: ip.createdAt.toISOString()
                }))
            }
        }
    )

    /**
     * 为实例添加额外 IP
     * 支持两种模式:
     * 1. 随机生成：不传 customAddress 参数
     * 2. 自定义地址：传入 customAddress 参数，会先校验格式、子网范围和唯一性
     */
    fastify.post<{ Params: { instanceId: string }; Body: { customAddress?: string } }>(
        '/instances/:instanceId/ips',
        {
            onRequest: [fastify.authenticateUser],
            schema: {
                body: {
                    type: 'object',
                    properties: {
                        customAddress: { type: 'string' }
                    }
                }
            }
        },
        async (request: FastifyRequest<{ Params: { instanceId: string }; Body: { customAddress?: string } }>, reply: FastifyReply) => {
            const user = request.user!
            const instanceId = parsePositiveId(request.params.instanceId)
            const { customAddress } = request.body || {}

            if (instanceId === null) {
                return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))
            }

            // 验证实例权限：管理员、实例所有者、宿主机所有者
            const instance = await db.getInstanceById(instanceId)
            if (!instance) {
                return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
            }
            // 管理员拥有宿主机所有者的权限
            if (user.role !== 'admin' && instance.user_id !== user.id) {
                const hostCheck = await db.getHostById(instance.host_id)
                if (!hostCheck || hostCheck.user_id !== user.id) {
                    return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
                }
            }

            // 检查实例状态
            if (instance.status !== 'running' && instance.status !== 'stopped') {
                return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID))
            }

            // 检查网络模式
            if (instance.network_mode === 'nat') {
                return reply.code(400).send({ error: 'NAT mode does not support additional IPs' })
            }

            // 获取宿主机信息
            const host = await db.getHostById(instance.host_id)
            if (!host) {
                return reply.code(500).send({ error: 'Host not found' })
            }

            const hostWithIpv6 = host as typeof host & {
                ipv6_subnet?: string | null
                ipv6_gateway?: string | null
                ipv6_parent_interface?: string | null
            }

            if (!hostWithIpv6.ipv6_subnet) {
                return reply.code(400).send({ error: 'Host does not have IPv6 subnet configured' })
            }

            // ==================== 校验自定义地址（必须在创建记录之前） ====================
            let newIPv6: string
            let isCustom = false

            if (customAddress && customAddress.trim()) {
                const trimmedAddress = customAddress.trim()
                
                // 1. 验证格式
                if (!isStrictValidIpv6(trimmedAddress)) {
                    return reply.code(400).send({ 
                        error: 'Invalid IPv6 address format',
                        code: 'INVALID_IPV6_FORMAT'
                    })
                }
                
                // 2. 验证是否在宿主机子网范围内
                if (!isIpv6InSubnet(trimmedAddress, hostWithIpv6.ipv6_subnet)) {
                    return reply.code(400).send({ 
                        error: `IPv6 address must be within host subnet range (${hostWithIpv6.ipv6_subnet})`,
                        code: 'IPV6_NOT_IN_SUBNET'
                    })
                }
                
                // 3. 验证地址是否已被占用
                const exists = await db.isIpAddressExists(trimmedAddress)
                if (exists) {
                    return reply.code(409).send({ 
                        error: 'IPv6 address already in use',
                        code: 'IPV6_ALREADY_EXISTS'
                    })
                }
                
                newIPv6 = trimmedAddress
                isCustom = true
            } else {
                // 随机生成 IPv6 地址
                let attempts = 0
                const maxAttempts = 50

                do {
                    newIPv6 = generateRandomIPv6(hostWithIpv6.ipv6_subnet)
                    const exists = await db.isIpAddressExists(newIPv6)
                    
                    if (!exists) {
                        break
                    }
                    
                    attempts++
                    
                    if (attempts >= maxAttempts) {
                        return reply.code(409).send({ 
                            error: `无法找到可用的 IPv6 地址，已尝试 ${maxAttempts} 次随机生成`,
                            code: 'IPV6_POOL_EXHAUSTED'
                        })
                    }
                } while (true)
            }

            // 新架构: 使用 eth1 设备 (用于 IPv6 routed 模式)
            const deviceName = 'eth1'

            // 创建 IP 记录（校验已通过，可以安全创建）
            let ipRecord: Awaited<ReturnType<typeof db.createIpAddress>>
            try {
                ipRecord = await db.createIpAddress({
                    address: newIPv6,
                    type: 'inet6',
                    isPrimary: false,
                    device: deviceName,
                    instanceId,
                    isCustom
                })
            } catch (error) {
                if (db.isIpAddressAlreadyExistsError(error)) {
                    return reply.code(409).send({
                        error: 'IPv6 address already in use',
                        code: 'IPV6_ALREADY_EXISTS'
                    })
                }
                throw error
            }

            try {
                // 新架构: 使用 syncInstanceNetwork 同步 eth1 配置
                if (instance.status === 'running' || instance.status === 'stopped') {
                    const client = await getIncusClient(host)

                    // 获取实例所有 IPv6 地址
                    const allIpRecords = await db.getIpAddressesByInstanceId(instanceId) as IpAddressRecord[]
                    const ipv6Records = allIpRecords.filter((ip: IpAddressRecord) => ip.type === 'inet6')
                    
                    // 查找主 IP
                    const primaryIp = ipv6Records.find((ip: IpAddressRecord) => ip.isPrimary)
                    if (!primaryIp) {
                        throw new Error('未找到主 IPv6 地址')
                    }

                    // 构建 IPv6Config
                    const extraIps = ipv6Records
                        .filter((ip: IpAddressRecord) => !ip.isPrimary)
                        .map((ip: IpAddressRecord) => ip.address)

                    const ipv6Config: IPv6Config = {
                        primaryIp: primaryIp.address,
                        extraIps: extraIps.length > 0 ? extraIps : undefined
                    }

                    // 同步实例网络配置
                    await syncInstanceNetwork(
                        client,
                        instance.incus_id,
                        ipv6Config,
                        hostWithIpv6.ipv6_parent_interface || 'eth0',
                        instance.status === 'running' // 只有运行状态才重启
                    )
                }

                await createLog(
                    user.id,
                    'instance',
                    'ip.add',
                    `Added IP ${newIPv6} to instance "${instance.name}"`,
                    'success',
                    { instanceId }
                )

                return {
                    success: true,
                    ipAddress: {
                        id: ipRecord.id,
                        address: newIPv6,
                        type: 'inet6',
                        isPrimary: false,
                        device: deviceName
                    }
                }
            } catch (error) {
                // 回滚：删除 IP 记录
                await db.deleteIpAddress(ipRecord.id)
                throw error
            }
        }
    )

    /**
     * 删除实例的额外 IP
     */
    fastify.delete<{ Params: { instanceId: string; ipId: string } }>(
        '/instances/:instanceId/ips/:ipId',
        { onRequest: [fastify.authenticateUser] },
        async (
            request: FastifyRequest<{ Params: { instanceId: string; ipId: string } }>,
            reply: FastifyReply
        ) => {
            const user = request.user!
            const instanceId = parsePositiveId(request.params.instanceId)
            const ipId = parsePositiveId(request.params.ipId)

            if (instanceId === null || ipId === null) {
                return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))
            }

            // 获取 IP 记录
            const ipRecord = await db.getIpAddressById(ipId)
            if (!ipRecord) {
                return reply.code(404).send({ error: 'IP address not found' })
            }

            // 验证 IP 属于该实例
            if (ipRecord.instanceId !== instanceId) {
                return reply.code(400).send({ error: 'IP does not belong to this instance' })
            }

            // 验证实例权限：管理员、实例所有者、宿主机所有者
            const instance = ipRecord.instance
            // 管理员拥有宿主机所有者的权限
            if (user.role !== 'admin' && instance.userId !== user.id) {
                // 检查是否是宿主机所有者
                const host = await db.getHostById(instance.hostId)
                if (!host || host.user_id !== user.id) {
                    return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
                }
            }

            // 不能删除主 IP
            if (ipRecord.isPrimary) {
                return reply.code(400).send({ error: 'Cannot remove primary IP address' })
            }

            // 从 eth1 的 IP 列表中移除该 IP（无论实例是运行还是停止状态）
            // 如果实例是停止状态，配置会在下次启动时自动应用
            if (instance.status === 'running' || instance.status === 'stopped') {
                try {
                    const client = await getIncusClient(instance.host)
                    
                    // 获取实例所有 IPv6 地址（排除要删除的）
                    const allIpRecords = await db.getIpAddressesByInstanceId(instanceId) as IpAddressRecord[]
                    const ipv6Records = allIpRecords.filter((ip: IpAddressRecord) => ip.type === 'inet6' && ip.id !== ipId)
                    
                    // 查找主 IP
                    const primaryIp = ipv6Records.find((ip: IpAddressRecord) => ip.isPrimary)
                    if (!primaryIp) {
                        console.warn('未找到主 IPv6 地址，跳过 Incus 配置更新')
                    } else {
                        // 构建 IPv6Config
                        const extraIps = ipv6Records
                            .filter((ip: IpAddressRecord) => !ip.isPrimary)
                            .map((ip: IpAddressRecord) => ip.address)

                        const ipv6Config: IPv6Config = {
                            primaryIp: primaryIp.address,
                            extraIps: extraIps.length > 0 ? extraIps : undefined
                        }

                        // 获取宿主机配置
                        const hostWithIpv6 = instance.host as typeof instance.host & {
                            ipv6_parent_interface?: string | null
                        }

                        // 同步实例网络配置
                        await syncInstanceNetwork(
                            client,
                            instance.incusId,
                            ipv6Config,
                            hostWithIpv6.ipv6_parent_interface || 'eth0',
                            instance.status === 'running' // 只有运行状态才重启
                        )
                    }
                } catch (err) {
                    console.warn(`Failed to remove IP ${ipRecord.address} from eth1:`, err)
                    return reply.code(500).send({ error: 'Failed to remove IP from instance network', code: 'OPERATION_FAILED' })
                }
            }

            // 删除 IP 记录
            await db.deleteIpAddress(ipId)

            await createLog(
                user.id,
                'instance',
                'ip.remove',
                `Removed IP ${ipRecord.address} from instance "${instance.name}"`,
                'success',
                { instanceId }
            )

            return { success: true }
        }
    )

    /**
     * 设置自定义 IPv6 地址
     */
    fastify.put<{ Params: { instanceId: string; ipId: string }; Body: { address: string } }>(
        '/instances/:instanceId/ips/:ipId/custom',
        { onRequest: [fastify.authenticateUser] },
        async (
            request: FastifyRequest<{ Params: { instanceId: string; ipId: string }; Body: { address: string } }>,
            reply: FastifyReply
        ) => {
            const user = request.user!
            const instanceId = parsePositiveId(request.params.instanceId)
            const ipId = parsePositiveId(request.params.ipId)
            const address = request.body.address?.trim()

            if (instanceId === null || ipId === null) {
                return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))
            }

            if (!address || !isStrictValidIpv6(address)) {
                return reply.code(400).send({ 
                    error: 'Invalid IPv6 address format',
                    code: 'INVALID_IPV6_FORMAT'
                })
            }

            // 获取 IP 记录
            const ipRecord = await db.getIpAddressById(ipId)
            if (!ipRecord) {
                return reply.code(404).send({ error: 'IP address not found' })
            }

            // 验证 IP 属于该实例
            if (ipRecord.instanceId !== instanceId) {
                return reply.code(400).send({ error: 'IP does not belong to this instance' })
            }

            // 验证实例权限：管理员、实例所有者、宿主机所有者
            const instance = ipRecord.instance
            if (user.role !== 'admin' && instance.userId !== user.id) {
                // 检查是否是宿主机所有者
                const host = await db.getHostById(instance.hostId)
                if (!host || host.user_id !== user.id) {
                    return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
                }
            }

            // 获取宿主机 IPv6 子网配置
            const hostWithIpv6 = instance.host as typeof instance.host & {
                ipv6_subnet?: string | null
                ipv6_parent_interface?: string | null
            }

            // 验证地址是否在宿主机子网范围内
            if (!hostWithIpv6.ipv6_subnet) {
                return reply.code(400).send({ error: 'Host does not have IPv6 subnet configured' })
            }
            if (!isIpv6InSubnet(address, hostWithIpv6.ipv6_subnet)) {
                return reply.code(400).send({ 
                    error: `IPv6 address must be within host subnet range (${hostWithIpv6.ipv6_subnet})`,
                    code: 'IPV6_NOT_IN_SUBNET'
                })
            }

            // 检查地址是否已存在
            const exists = await db.isIpAddressExists(address)
            if (exists && address !== ipRecord.address) {
                return reply.code(409).send({ 
                    error: 'IPv6 address already exists',
                    code: 'IPV6_ALREADY_EXISTS'
                })
            }

            const oldAddress = ipRecord.address
            const oldIsCustom = ipRecord.isCustom || false

            // 先通过 DB 锁预留新地址，避免并发请求在 Incus 同步后才发现重复。
            try {
                await db.updateIpAddressAddress({
                    id: ipId,
                    address,
                    isCustom: true
                })
            } catch (error) {
                if (db.isIpAddressAlreadyExistsError(error)) {
                    return reply.code(409).send({
                        error: 'IPv6 address already exists',
                        code: 'IPV6_ALREADY_EXISTS'
                    })
                }
                throw error
            }

            // 同步到 Incus。失败时回滚 DB 预留，保持面板状态和真实网络一致。
            if (instance.status === 'running' || instance.status === 'stopped') {
                try {
                    const client = await getIncusClient(instance.host)

                    // 获取实例所有 IPv6 地址
                    const allIpRecords = await db.getIpAddressesByInstanceId(instanceId) as IpAddressRecord[]
                    const ipv6Records = allIpRecords
                        .filter((ip: IpAddressRecord) => ip.type === 'inet6')

                    const primaryIp = ipv6Records.find((ip: IpAddressRecord) => ip.isPrimary)
                    if (primaryIp) {
                        const extraIps = ipv6Records
                            .filter((ip: IpAddressRecord) => !ip.isPrimary)
                            .map((ip: IpAddressRecord) => ip.address)

                        const ipv6Config: IPv6Config = {
                            primaryIp: primaryIp.address,
                            extraIps: extraIps.length > 0 ? extraIps : undefined
                        }

                        const hostWithIpv6 = instance.host as typeof instance.host & {
                            ipv6_parent_interface?: string | null
                        }

                        await syncInstanceNetwork(
                            client,
                            instance.incusId,
                            ipv6Config,
                            hostWithIpv6.ipv6_parent_interface || 'eth0',
                            instance.status === 'running'
                        )
                    }
                } catch (err) {
                    console.warn(`Failed to update custom IP in Incus:`, err)
                    try {
                        await db.updateIpAddressAddress({
                            id: ipId,
                            address: oldAddress,
                            isCustom: oldIsCustom
                        })
                    } catch (rollbackError) {
                        request.log.error({ ipId, oldAddress, rollbackError }, '回滚自定义 IPv6 地址失败')
                    }
                    return reply.code(500).send({ error: 'Failed to update IP in instance network', code: 'OPERATION_FAILED' })
                }
            }

            await createLog(
                user.id,
                'instance',
                'ip.custom',
                `Set custom IPv6 ${address} (was ${oldAddress}) for instance "${instance.name}"`,
                'success',
                { instanceId }
            )

            return { success: true, address }
        }
    )

    /**
     * 为实例分配 IPv6 网段
     * 支持两种方式:
     * 1. 传入 cidr: 直接分配指定的网段
     * 2. 传入 prefix: 系统从宿主机子网中自动分配
     */
    fastify.post<{ Params: { instanceId: string }; Body: { cidr?: string; prefix?: number; primaryIp?: string } }>(
        '/instances/:instanceId/subnet',
        { onRequest: [fastify.authenticateUser] },
        async (
            request: FastifyRequest<{ Params: { instanceId: string }; Body: { cidr?: string; prefix?: number; primaryIp?: string } }>,
            reply: FastifyReply
        ) => {
            const user = request.user!
            const instanceId = parsePositiveId(request.params.instanceId)
            const { cidr: inputCidr, prefix, primaryIp } = request.body

            if (instanceId === null) {
                return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))
            }

            // 验证实例权限：管理员、实例所有者、宿主机所有者
            const instance = await db.getInstanceById(instanceId)
            if (!instance) {
                return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
            }
            if (user.role !== 'admin' && instance.user_id !== user.id) {
                const hostCheck = await db.getHostById(instance.host_id)
                if (!hostCheck || hostCheck.user_id !== user.id) {
                    return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
                }
            }

            // 检查网络模式
            if (instance.network_mode === 'nat') {
                return reply.code(400).send({ error: 'NAT mode does not support IPv6 subnet' })
            }

            // 获取宿主机信息
            const host = await db.getHostById(instance.host_id)
            if (!host) {
                return reply.code(500).send({ error: 'Host not found' })
            }

            const hostWithIpv6 = host as typeof host & {
                ipv6_subnet?: string | null
                ipv6_parent_interface?: string | null
            }

            // 确定要分配的 CIDR
            let cidr: string
            if (inputCidr) {
                // 直接使用用户提供的 CIDR
                if (!isValidIpv6Subnet(inputCidr)) {
                    return reply.code(400).send({ error: 'Invalid IPv6 subnet CIDR format' })
                }
                if (!hostWithIpv6.ipv6_subnet) {
                    return reply.code(400).send({ error: 'Host does not have IPv6 subnet configured' })
                }
                if (!isIpv6SubnetWithinSubnet(inputCidr, hostWithIpv6.ipv6_subnet)) {
                    return reply.code(400).send({
                        error: `IPv6 subnet must be within host subnet range (${hostWithIpv6.ipv6_subnet})`,
                        code: 'IPV6_SUBNET_NOT_IN_HOST_SUBNET'
                    })
                }
                cidr = inputCidr
            } else if (prefix) {
                // 根据 prefix 自动分配
                if (![112, 120, 124].includes(prefix)) {
                    return reply.code(400).send({ error: 'Prefix must be 112, 120, or 124' })
                }
                if (!hostWithIpv6.ipv6_subnet) {
                    return reply.code(400).send({ error: 'Host does not have IPv6 subnet configured' })
                }

                // 生成子网，最多重试 20 次确保不重复
                let attempts = 0
                const maxAttempts = 20
                do {
                    cidr = generateRandomSubnet(hostWithIpv6.ipv6_subnet, prefix)
                    const exists = await ipv6Subnets.isIpv6SubnetExists(cidr)
                    if (!exists) break
                    attempts++
                } while (attempts < maxAttempts)

                if (attempts >= maxAttempts) {
                    return reply.code(409).send({ error: 'Unable to allocate subnet, pool may be exhausted' })
                }
            } else {
                return reply.code(400).send({ error: 'Either cidr or prefix must be provided' })
            }

            // 检查网段是否已存在
            const exists = await ipv6Subnets.isIpv6SubnetExists(cidr)
            if (exists) {
                return reply.code(409).send({ error: 'IPv6 subnet already allocated' })
            }

            // 获取实例的主 IPv6
            const allIpRecords = await db.getIpAddressesByInstanceId(instanceId) as IpAddressRecord[]
            const ipv6Records = allIpRecords.filter((ip: IpAddressRecord) => ip.type === 'inet6')
            const primaryIpRecord = ipv6Records.find((ip: IpAddressRecord) => ip.isPrimary)
            
            if (!primaryIpRecord) {
                return reply.code(400).send({ error: 'Instance does not have a primary IPv6 address' })
            }

            // 网段内的主 IP（用户可指定，否则使用网段地址 + 1）
            const subnetPrimaryIp = primaryIp || cidr.split('/')[0]

            // 创建网段记录
            const subnet = await ipv6Subnets.createIpv6Subnet({
                cidr,
                primaryIp: subnetPrimaryIp,
                device: 'eth1',
                instanceId
            })

            // 同步到 Incus
            if (instance.status === 'running' || instance.status === 'stopped') {
                try {
                    const client = await getIncusClient(host)

                    const extraIps = ipv6Records
                        .filter((ip: IpAddressRecord) => !ip.isPrimary)
                        .map((ip: IpAddressRecord) => ip.address)

                    const ipv6Config: IPv6Config = {
                        primaryIp: primaryIpRecord.address,
                        extraIps: extraIps.length > 0 ? extraIps : undefined,
                        subnet: cidr
                    }

                    await syncInstanceNetwork(
                        client,
                        instance.incus_id,
                        ipv6Config,
                        hostWithIpv6.ipv6_parent_interface || 'eth0',
                        instance.status === 'running'
                    )
                } catch (err) {
                    // 回滚
                    await ipv6Subnets.deleteIpv6Subnet(subnet.id)
                    throw err
                }
            }

            await createLog(
                user.id,
                'instance',
                'subnet.allocate',
                `Allocated IPv6 subnet ${cidr} to instance "${instance.name}"`,
                'success',
                { instanceId }
            )

            return {
                success: true,
                subnet: {
                    id: subnet.id,
                    cidr: subnet.cidr,
                    primaryIp: subnet.primaryIp,
                    device: subnet.device
                }
            }
        }
    )

    /**
     * 删除实例的 IPv6 网段
     */
    fastify.delete<{ Params: { instanceId: string; subnetId: string } }>(
        '/instances/:instanceId/subnet/:subnetId',
        { onRequest: [fastify.authenticateUser] },
        async (
            request: FastifyRequest<{ Params: { instanceId: string; subnetId: string } }>,
            reply: FastifyReply
        ) => {
            const user = request.user!
            const instanceId = parsePositiveId(request.params.instanceId)
            const subnetId = parsePositiveId(request.params.subnetId)

            if (instanceId === null || subnetId === null) {
                return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))
            }

            // 验证实例权限：管理员、实例所有者、宿主机所有者
            const instance = await db.getInstanceById(instanceId)
            if (!instance) {
                return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
            }
            if (user.role !== 'admin' && instance.user_id !== user.id) {
                const hostCheck = await db.getHostById(instance.host_id)
                if (!hostCheck || hostCheck.user_id !== user.id) {
                    return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
                }
            }

            // 获取网段记录
            const subnets = await ipv6Subnets.getIpv6SubnetsByInstanceId(instanceId) as Ipv6SubnetRecord[]
            const subnet = subnets.find((s: Ipv6SubnetRecord) => s.id === subnetId)
            if (!subnet) {
                return reply.code(404).send({ error: 'Subnet not found' })
            }

            // 同步到 Incus (移除 ipv6.routes)
            const host = await db.getHostById(instance.host_id)
            if (host && (instance.status === 'running' || instance.status === 'stopped')) {
                try {
                    const client = await getIncusClient(host)

                    // 获取实例所有 IPv6 地址
                    const allIpRecords = await db.getIpAddressesByInstanceId(instanceId) as IpAddressRecord[]
                    const ipv6Records = allIpRecords.filter((ip: IpAddressRecord) => ip.type === 'inet6')
                    const primaryIpRecord = ipv6Records.find((ip: IpAddressRecord) => ip.isPrimary)

                    if (primaryIpRecord) {
                        const extraIps = ipv6Records
                            .filter((ip: IpAddressRecord) => !ip.isPrimary)
                            .map((ip: IpAddressRecord) => ip.address)

                        // 不包含 subnet，这样会移除 ipv6.routes
                        const ipv6Config: IPv6Config = {
                            primaryIp: primaryIpRecord.address,
                            extraIps: extraIps.length > 0 ? extraIps : undefined
                        }

                        const hostWithIpv6 = host as typeof host & {
                            ipv6_parent_interface?: string | null
                        }

                        await syncInstanceNetwork(
                            client,
                            instance.incus_id,
                            ipv6Config,
                            hostWithIpv6.ipv6_parent_interface || 'eth0',
                            instance.status === 'running'
                        )
                    }
                } catch (err) {
                    console.warn(`Failed to remove subnet from Incus:`, err)
                    return reply.code(500).send({ error: 'Failed to remove subnet from instance network', code: 'OPERATION_FAILED' })
                }
            }

            // 删除数据库记录
            await ipv6Subnets.deleteIpv6Subnet(subnetId)

            await createLog(
                user.id,
                'instance',
                'subnet.remove',
                `Removed IPv6 subnet ${subnet.cidr} from instance "${instance.name}"`,
                'success',
                { instanceId }
            )

            return { success: true }
        }
    )

    /**
     * 获取实例的 IPv6 网段列表
     */
    fastify.get<{ Params: { instanceId: string } }>(
        '/instances/:instanceId/subnets',
        { onRequest: [fastify.authenticateUser] },
        async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
            const user = request.user!
            const instanceId = parsePositiveId(request.params.instanceId)

            if (instanceId === null) {
                return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))
            }

            // 验证实例权限：管理员、实例所有者、宿主机所有者
            const instance = await db.getInstanceById(instanceId)
            if (!instance) {
                return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
            }
            if (user.role !== 'admin' && instance.user_id !== user.id) {
                const host = await db.getHostById(instance.host_id)
                if (!host || host.user_id !== user.id) {
                    return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
                }
            }

            const subnets = await ipv6Subnets.getIpv6SubnetsByInstanceId(instanceId) as Ipv6SubnetRecord[]

            return {
                subnets: subnets.map((s: Ipv6SubnetRecord) => ({
                    id: s.id,
                    cidr: s.cidr,
                    primaryIp: s.primaryIp,
                    device: s.device,
                    createdAt: s.createdAt.toISOString()
                }))
            }
        }
    )
}
