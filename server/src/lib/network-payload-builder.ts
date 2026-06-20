/**
 * network-payload-builder.ts
 * IPv6 Routed 模式的 Payload 生成器
 * 
 * 核心职责:
 * 1. 生成 Incus devices 配置 (双网卡: eth0 bridged + eth1 routed)
 * 2. 生成 cloud-init network-config YAML (Guest OS 网络配置)
 * 3. 同步实例网络配置 (添加/删除 IP)
 */

import type { IncusClient } from './incus/incus-client.js'
import { getInstance, restartInstance } from './incus/incus-instances.js'
import { IPV4_CONFIG } from './ip-calculator.js'
import type { VmNicMacs } from './vm-network-identifiers.js'
import { generateVmNicMacs } from './vm-network-identifiers.js'

// ==================== 类型定义 ====================

export type NetworkMode = 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'

/**
 * IPv6 配置结构
 */
export interface IPv6Config {
  /** 主 IP (必须) */
  primaryIp: string
  /** 额外 IP 列表 */
  extraIps?: string[]
  /** 网段 CIDR (如 "2a01:4f9:c012:e7:aaaa::/112") */
  subnet?: string
}

/**
 * 网络设备构建选项
 */
export interface BuildNetworkDevicesOptions {
  /** 网络模式 */
  networkMode: NetworkMode
  /** 宿主机物理网卡名 (用于 routed 模式) */
  hostInterface: string
  /** IPv6 配置 (nat_ipv6 模式必须) */
  ipv6Config?: IPv6Config | null
  /** 入站带宽限制 */
  limitsIngress?: string | null
  /** 出站带宽限制 */
  limitsEgress?: string | null
  /** NAT 网桥名称 */
  natBridge?: string
  /** 内网 IPv4 地址 (新增: 固定内网 IP) */
  ipv4Address?: string | null
  /** VM 主网卡 MAC */
  eth0Hwaddr?: string | null
  /** VM IPv6 网卡 MAC */
  eth1Hwaddr?: string | null
}

// ==================== 设备配置生成 ====================

/**
 * 构建 Incus 网络设备配置
 * 
 * 双网卡架构:
 * - eth0: bridged (incusbr0), 仅 IPv4 NAT
 * - eth1: routed (宿主机物理网卡), IPv6 直连
 */
export function buildNetworkDevices(options: BuildNetworkDevicesOptions): Record<string, Record<string, string>> {
  const {
    networkMode,
    hostInterface,
    ipv6Config,
    limitsIngress,
    limitsEgress,
    natBridge = 'incusbr0',
    ipv4Address,
    eth0Hwaddr,
    eth1Hwaddr
  } = options

  const devices: Record<string, Record<string, string>> = {}

  // eth0: IPv4 NAT (所有模式都需要)
  const eth0Device: Record<string, string> = {
    type: 'nic',
    nictype: 'bridged',
    parent: natBridge,
    name: 'eth0'
  }

  // 固定内网 IPv4 地址 (DHCP 静态租约)
  if (ipv4Address) {
    eth0Device['ipv4.address'] = ipv4Address
  }
  if (eth0Hwaddr) {
    eth0Device.hwaddr = eth0Hwaddr
  }

  // 带宽限制应用到 eth0 (NAT 出口)
  if (limitsIngress) {
    eth0Device['limits.ingress'] = limitsIngress
  }
  if (limitsEgress) {
    eth0Device['limits.egress'] = limitsEgress
  }

  devices['eth0'] = eth0Device

  // eth1: IPv6 Routed (仅 nat_ipv6 和 ipv6_only 模式需要独立 IPv6 地址)
  const hasRoutedIpv6 = networkMode === 'nat_ipv6' || networkMode === 'ipv6_only'

  if (hasRoutedIpv6 && ipv6Config) {
    // 构建 IP 地址列表
    const allIps = [ipv6Config.primaryIp]
    if (ipv6Config.extraIps && ipv6Config.extraIps.length > 0) {
      allIps.push(...ipv6Config.extraIps)
    }

    const eth1Device: Record<string, string> = {
      type: 'nic',
      nictype: 'routed',
      parent: hostInterface,
      name: 'eth1',
      // 所有 IPv6 地址，逗号分隔
      'ipv6.address': allIps.join(',')
      // 注意: security.ipv6_filtering 和 security.mac_filtering 只支持 bridged 模式，routed 模式不支持
    }
    if (eth1Hwaddr) {
      eth1Device.hwaddr = eth1Hwaddr
    }

    // 如果有网段分配，添加 ipv6.routes
    if (ipv6Config.subnet) {
      eth1Device['ipv6.routes'] = ipv6Config.subnet
    }

    devices['eth1'] = eth1Device
  }

  return devices
}

// ==================== Cloud-init 网络配置生成 ====================

/**
 * Cloud-init 网络配置选项
 */
export interface CloudInitNetworkOptions {
  /** 内网 IPv4 地址 (必须) */
  ipv4Address: string
  /** IPv6 地址列表 (可选) */
  ipv6List?: string[]
  /** 网卡 MAC 地址（优先使用，避免依赖来宾接口命名） */
  nicMacs?: Partial<VmNicMacs>
}



function getVmNicMacsForInstanceName(instanceName: string): VmNicMacs {
  return generateVmNicMacs(instanceName)
}

/**
 * 生成 cloud-init network-config v2 YAML
 * 
 * 配置说明:
 * - eth0: 静态 IPv4 (固定内网 IP)
 *   在 routed IPv6 双网卡架构下，必须显式关闭 eth0 的 DHCPv6/RA，
 *   否则 guest 会从 incusbr0 再拿到一个 NAT IPv6，并把默认 IPv6 路由跑偏到宿主机出口。
 * - eth1: 静态 IPv6 配置 (如果有)
 */
export function generateCloudInitNetworkConfig(options: CloudInitNetworkOptions): string {
  const { ipv4Address, ipv6List } = options
  const { gateway } = IPV4_CONFIG

  // eth0: 静态 IPv4 配置
  let config = `version: 2
ethernets:
  eth0:
    dhcp4: false
    dhcp6: false
    accept-ra: false
    addresses:
      - ${ipv4Address}/22
    routes:
      - to: 0.0.0.0/0
        via: ${gateway}
    nameservers:
      addresses:
        - 10.10.0.1
`

  // eth1: 静态 IPv6 配置 (如果有)
  if (ipv6List && ipv6List.length > 0) {
    // 格式化 IPv6 地址 (添加 /128 掩码)
    const formattedAddresses = ipv6List
      .filter(ip => ip && ip.trim())
      .map(ip => {
        const trimmed = ip.trim()
        return trimmed.includes('/') ? trimmed : `${trimmed}/128`
      })

    const addressesYaml = formattedAddresses
      .map(addr => `      - ${addr}`)
      .join('\n')

    config += `  eth1:
    dhcp4: false
    dhcp6: false
    accept-ra: false
    addresses:
${addressesYaml}
    gateway6: fe80::1
    nameservers:
      addresses:
        - 10.10.0.1
`
  }

  return config
}

/**
 * 生成 cloud-init network-config v2 YAML (仅 IPv6，向后兼容)
 * @deprecated 使用 generateCloudInitNetworkConfig 替代
 */
export function generateCloudInitNetworkConfigLegacy(ipv6List: string[]): string {
  if (!ipv6List || ipv6List.length === 0) {
    // 无 IPv6，仅配置 eth0 DHCP
    return `version: 2
ethernets:
  eth0:
    dhcp4: true
`
  }

  // 格式化 IPv6 地址 (添加 /128 掩码)
  const formattedAddresses = ipv6List
    .filter(ip => ip && ip.trim())
    .map(ip => {
      const trimmed = ip.trim()
      // 如果已有掩码则不添加
      return trimmed.includes('/') ? trimmed : `${trimmed}/128`
    })

  const addressesYaml = formattedAddresses
    .map(addr => `      - ${addr}`)
    .join('\n')

  return `version: 2
ethernets:
  eth0:
    dhcp4: true
  eth1:
    dhcp4: false
    dhcp6: false
    addresses:
${addressesYaml}
    gateway6: fe80::1
`
}

// ==================== 网络同步 ====================

/**
 * 同步实例的 IPv6 网络配置
 * 
 * 流程:
 * 1. 获取当前实例配置
 * 2. 更新 eth1 设备的 ipv6.address 和 ipv6.routes
 * 3. 更新 cloud-init network-config
 * 4. 重启实例使配置生效
 */
export async function syncInstanceNetwork(
  client: IncusClient,
  instanceName: string,
  ipv6Config: IPv6Config,
  hostInterface: string,
  restart: boolean = true
): Promise<void> {
  // 1. 获取当前配置
  const current = await getInstance(client, instanceName) as unknown as {
    config: Record<string, string>
    devices: Record<string, Record<string, string>>
    profiles: string[]
    description?: string
  }

  // 2. 获取当前实例的 IPv4 地址
  const currentIpv4 = current.devices?.eth0?.['ipv4.address'] || '10.10.1.1'

  // 3. 构建新的 IPv6 地址列表
  const allIps = [ipv6Config.primaryIp]
  if (ipv6Config.extraIps && ipv6Config.extraIps.length > 0) {
    allIps.push(...ipv6Config.extraIps)
  }

  // 4. 更新 eth1 设备配置
  const devices = { ...current.devices }

  if (devices['eth1']) {
    // 更新现有 eth1
    devices['eth1'] = {
      ...devices['eth1'],
      'ipv6.address': allIps.join(',')
    }

    // 更新网段路由
    if (ipv6Config.subnet) {
      devices['eth1']['ipv6.routes'] = ipv6Config.subnet
    } else {
      delete devices['eth1']['ipv6.routes']
    }
  } else {
    const generatedNicMacs = getVmNicMacsForInstanceName(instanceName)
    // 创建新的 eth1
    devices['eth1'] = {
      type: 'nic',
      nictype: 'routed',
      parent: hostInterface,
      name: 'eth1',
      hwaddr: generatedNicMacs.eth1,
      'ipv6.address': allIps.join(',')
      // 注意: security.ipv6_filtering 和 security.mac_filtering 只支持 bridged 模式
    }

    if (ipv6Config.subnet) {
      devices['eth1']['ipv6.routes'] = ipv6Config.subnet
    }
  }

  // 5. 更新 cloud-init network-config
  const config = { ...current.config }
  const nicMacs = {
    eth0: current.devices?.eth0?.hwaddr || getVmNicMacsForInstanceName(instanceName).eth0,
    eth1: devices['eth1']?.hwaddr || current.devices?.eth1?.hwaddr || getVmNicMacsForInstanceName(instanceName).eth1
  }
  config['user.network-config'] = generateCloudInitNetworkConfig({
    ipv4Address: currentIpv4,
    ipv6List: allIps,
    nicMacs
  })

  // 6. 发送更新请求 (PUT 全量替换)
  await client.request('PUT', `/1.0/instances/${instanceName}`, {
    config,
    devices,
    profiles: current.profiles,
    description: current.description || ''
  })

  // 7. 重启实例使配置生效
  if (restart) {
    try {
      await restartInstance(client, instanceName, false)
    } catch (err) {
      console.warn(`[syncInstanceNetwork] 重启实例 ${instanceName} 失败:`, err)
    }
  }
}

/**
 * 移除实例的 eth1 网卡 (用于从 IPv6 模式切换到纯 NAT)
 */
export async function removeInstanceIpv6(
  client: IncusClient,
  instanceName: string,
  restart: boolean = true
): Promise<void> {
  const current = await getInstance(client, instanceName) as unknown as {
    config: Record<string, string>
    devices: Record<string, Record<string, string>>
    profiles: string[]
    description?: string
  }

  // 获取当前实例的 IPv4 地址
  const currentIpv4 = current.devices?.eth0?.['ipv4.address'] || '10.10.1.1'

  // 移除 eth1
  const devices = { ...current.devices }
  delete devices['eth1']

  // 更新 network-config，保留 IPv4 配置，移除 IPv6
  const config = { ...current.config }
  const nicMacs = {
    eth0: current.devices?.eth0?.hwaddr || getVmNicMacsForInstanceName(instanceName).eth0
  }
  config['user.network-config'] = generateCloudInitNetworkConfig({
    ipv4Address: currentIpv4,
    nicMacs
    // 不传 ipv6List，仅生成 eth0 配置
  })

  await client.request('PUT', `/1.0/instances/${instanceName}`, {
    config,
    devices,
    profiles: current.profiles,
    description: current.description || ''
  })

  if (restart) {
    try {
      await restartInstance(client, instanceName, false)
    } catch (err) {
      console.warn(`[removeInstanceIpv6] 重启实例 ${instanceName} 失败:`, err)
    }
  }
}

// ==================== 辅助函数 ====================

/**
 * 判断网络模式是否需要独立 IPv6 地址（Routed 模式）
 */
export function hasIpv6Support(networkMode: NetworkMode): boolean {
  return networkMode === 'nat_ipv6' || networkMode === 'ipv6_only'
}

/**
 * 验证 IPv6 地址格式
 */
export function isValidIpv6(address: string): boolean {
  // 简单的 IPv6 格式验证
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/
  const trimmed = address.trim().split('/')[0] // 移除掩码
  return ipv6Regex.test(trimmed) || /^::1$/.test(trimmed) || /^::$/.test(trimmed)
}

/**
 * 验证 IPv6 网段格式
 */
export function isValidIpv6Subnet(cidr: string): boolean {
  const parts = cidr.split('/')
  if (parts.length !== 2) return false

  const [addr, prefix] = parts
  const prefixNum = parseInt(prefix, 10)

  if (isNaN(prefixNum) || prefixNum < 48 || prefixNum > 128) return false

  return isValidIpv6(addr)
}
