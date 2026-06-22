/**
 * IPv6 地址计算器 (IPAM)
 * 基于子网和偏移量计算静态 IPv6 地址
 */
import { Address6 } from 'ip-address'
import { randomBytes } from 'crypto'

// ==================== IPv4 分配 (固定网段 10.10.0.0/22) ====================

/**
 * 内网 IPv4 网段配置
 * 所有宿主机都使用统一的内网网段
 */
export const IPV4_CONFIG = {
  subnet: '10.10.0.0/22',
  gateway: '10.10.0.1',
  // 可分配范围: 10.10.1.1 - 10.10.3.254
  // 10.10.0.x 保留给网关和基础设施
  rangeStart: [10, 10, 1, 1],
  rangeEnd: [10, 10, 3, 254],
  dns: ['8.8.8.8', '1.1.1.1']
}

/**
 * 将 IPv4 地址转换为整数
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

/**
 * 将整数转换为 IPv4 地址
 */
function intToIpv4(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.')
}

/**
 * 随机生成一个内网 IPv4 地址
 * 范围: 10.10.1.1 - 10.10.3.254 (约 766 个地址)
 * @returns 随机生成的 IPv4 地址字符串
 */
export function generateRandomIPv4(): string {
  const start = ipv4ToInt('10.10.1.1')
  const end = ipv4ToInt('10.10.3.254')
  const range = end - start + 1
  
  const randomOffset = Math.floor(Math.random() * range)
  return intToIpv4(start + randomOffset)
}

/**
 * 验证 IPv4 地址是否在可分配范围内
 * @param address IPv4 地址
 * @returns 是否在范围内
 */
export function isIpv4InRange(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false
  }
  
  const num = ipv4ToInt(address)
  const start = ipv4ToInt('10.10.1.1')
  const end = ipv4ToInt('10.10.3.254')
  
  return num >= start && num <= end
}

// ==================== IPv6 分配 ====================

/**
 * 计算 IPv6 地址
 * @param subnetStr 子网 CIDR (如 2a0a:51c1:9:13b:1::/80)
 * @param offset 偏移量 (通常传入数据库自增 ID)
 * @returns 计算后的 IPv6 地址字符串
 */
export function calculateIPv6(subnetStr: string, offset: number): string {
    if (!Address6.isValid(subnetStr)) {
        throw new Error(`Invalid IPv6 subnet: ${subnetStr}`)
    }

    const subnet = new Address6(subnetStr)

    // 获取子网起始地址的 BigInt 值
    const startBigInt = subnet.startAddress().bigInt()

    // 偏移策略：
    // +2 是为了跳过:
    // ::0 (Subnet Router Anycast)
    // ::1 (预留给网关)
    const targetBigInt = startBigInt + BigInt(offset) + BigInt(2)

    // 转换回标准 IPv6 字符串并压缩
    return Address6.fromBigInt(targetBigInt).correctForm()
}

/**
 * 验证 IPv6 子网格式是否有效
 * @param subnetStr 子网 CIDR
 */
export function isValidIPv6Subnet(subnetStr: string): boolean {
    return Address6.isValid(subnetStr)
}

/**
 * 从 IPv6 地址反推偏移量
 * @param subnetStr 子网 CIDR
 * @param address IPv6 地址
 * @returns 偏移量
 */
export function getIPv6Offset(subnetStr: string, address: string): number {
    if (!Address6.isValid(subnetStr) || !Address6.isValid(address)) {
        throw new Error('Invalid subnet or address')
    }

    const subnet = new Address6(subnetStr)
    const addr = new Address6(address)

    const startBigInt = subnet.startAddress().bigInt()
    const addrBigInt = addr.bigInt()

    // 减去起始地址和预留的 2 个地址
    return Number(addrBigInt - startBigInt - BigInt(2))
}

/**
 * 在网段内随机生成一个 IPv6 地址
 * @param subnetStr 子网 CIDR (如 2a0a:51c1:9:13b:1::/80)
 * @returns 随机生成的 IPv6 地址字符串
 */
export function generateRandomIPv6(subnetStr: string): string {
    if (!Address6.isValid(subnetStr)) {
        throw new Error(`Invalid IPv6 subnet: ${subnetStr}`)
    }

    const subnet = new Address6(subnetStr)

    // 获取子网起始和结束地址的 BigInt 值
    const startBigInt = subnet.startAddress().bigInt()
    const endBigInt = subnet.endAddress().bigInt()

    // 跳过 ::0 (Subnet Router Anycast) 和 ::1 (预留给网关)
    const minAddress = startBigInt + BigInt(2)
    const maxAddress = endBigInt

    // 计算可用地址范围
    const addressRange = maxAddress - minAddress

    // 如果范围太大（超过 Number.MAX_SAFE_INTEGER），使用安全的随机方法
    // 对于 /80 子网，范围是 2^48 - 2，约为 281万亿，需要使用 BigInt 处理
    if (addressRange > BigInt(Number.MAX_SAFE_INTEGER)) {
        // 生成随机 BigInt
        // 使用 crypto.randomBytes 生成随机数，然后转换为 BigInt
        const bytes = randomBytes(8) // 8 字节 = 64 位
        const randomBigInt = BigInt('0x' + bytes.toString('hex'))
        
        // 将随机数映射到地址范围内
        const randomOffset = randomBigInt % (addressRange + BigInt(1))
        const targetBigInt = minAddress + randomOffset
        
        return Address6.fromBigInt(targetBigInt).correctForm()
    } else {
        // 范围在安全整数范围内，使用 Math.random
        const randomOffset = BigInt(Math.floor(Math.random() * Number(addressRange + BigInt(1))))
        const targetBigInt = minAddress + randomOffset
        
        return Address6.fromBigInt(targetBigInt).correctForm()
    }
}

/**
 * 从宿主机子网中生成一个指定前缀长度的子网段
 * @param hostSubnet 宿主机子网 CIDR (如 2a0a:51c1:9:13b::/64)
 * @param prefix 目标前缀长度 (112, 120, 124)
 * @returns 随机生成的子网段 CIDR
 */
export function generateRandomSubnet(hostSubnet: string, prefix: number): string {
    if (!Address6.isValid(hostSubnet)) {
        throw new Error(`Invalid IPv6 subnet: ${hostSubnet}`)
    }

    const subnet = new Address6(hostSubnet)
    const hostPrefix = subnet.subnetMask

    // 目标前缀必须大于宿主机前缀
    if (prefix <= hostPrefix) {
        throw new Error(`Target prefix /${prefix} must be greater than host prefix /${hostPrefix}`)
    }

    // 计算可分配的子网数量
    const subnetBits = prefix - hostPrefix
    const maxSubnets = BigInt(1) << BigInt(subnetBits)

    // 随机选择一个子网索引
    let subnetIndex: bigint
    if (maxSubnets > BigInt(Number.MAX_SAFE_INTEGER)) {
        const bytes = randomBytes(8)
        subnetIndex = BigInt('0x' + bytes.toString('hex')) % maxSubnets
    } else {
        subnetIndex = BigInt(Math.floor(Math.random() * Number(maxSubnets)))
    }

    // 计算子网起始地址
    const hostStart = subnet.startAddress().bigInt()
    // 每个子网的大小
    const subnetSize = BigInt(1) << BigInt(128 - prefix)
    const subnetStart = hostStart + subnetIndex * subnetSize

    const subnetAddress = Address6.fromBigInt(subnetStart).correctForm()
    return `${subnetAddress}/${prefix}`
}

/**
 * 验证 IPv6 地址是否在指定子网范围内
 * @param address IPv6 地址
 * @param subnetStr 子网 CIDR (如 2a0a:51c1:9:13b::/64)
 * @returns 是否在子网范围内
 */
export function isIpv6InSubnet(address: string, subnetStr: string): boolean {
    try {
        if (!Address6.isValid(address) || !Address6.isValid(subnetStr)) {
            return false
        }

        const addr = new Address6(address)
        const subnet = new Address6(subnetStr)

        const addrBigInt = addr.bigInt()
        const subnetStart = subnet.startAddress().bigInt()
        const subnetEnd = subnet.endAddress().bigInt()

        return addrBigInt >= subnetStart && addrBigInt <= subnetEnd
    } catch {
        return false
    }
}

/**
 * 验证一个 IPv6 CIDR 是否完全包含在另一个 IPv6 CIDR 内
 * @param candidateSubnetStr 待分配的 IPv6 子网 CIDR
 * @param parentSubnetStr 宿主机授权的 IPv6 子网 CIDR
 */
export function isIpv6SubnetWithinSubnet(candidateSubnetStr: string, parentSubnetStr: string): boolean {
    try {
        if (!Address6.isValid(candidateSubnetStr) || !Address6.isValid(parentSubnetStr)) {
            return false
        }

        const candidate = new Address6(candidateSubnetStr)
        const parent = new Address6(parentSubnetStr)

        const candidateStart = candidate.startAddress().bigInt()
        const candidateEnd = candidate.endAddress().bigInt()
        const parentStart = parent.startAddress().bigInt()
        const parentEnd = parent.endAddress().bigInt()

        return candidateStart >= parentStart && candidateEnd <= parentEnd
    } catch {
        return false
    }
}

/**
 * 严格验证 IPv6 地址格式
 * 使用 ip-address 库进行精确验证
 */
export function isStrictValidIpv6(address: string): boolean {
    try {
        const trimmed = address.trim().split('/')[0]
        return Address6.isValid(trimmed)
    } catch {
        return false
    }
}
