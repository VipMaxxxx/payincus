/**
 * Incus 流量管理
 * 负责获取容器网络流量计数器和应用带宽限速
 */

import type { IncusClient } from './incus-client.js'
import { getInstance, updateInstance } from './incus-instances.js'
import { generateVmNicMacs } from '../vm-network-identifiers.js'

/**
 * 网络流量计数器
 */
export interface NetworkCounters {
    rxBytes: bigint
    txBytes: bigint
}

/**
 * 实例状态中的网络信息
 */
export interface InstanceStateNetwork {
    addresses?: Array<{
        family: string
        address: string
    }>
    hwaddr?: string
    counters?: {
        bytes_received?: number | string
        bytes_sent?: number | string
        packets_received?: number
        packets_sent?: number
    }
    state?: string
}

export interface InstanceTrafficState {
    status?: string
    network?: Record<string, InstanceStateNetwork>
}

function normalizeMac(value: unknown): string | null {
    return typeof value === 'string' && value.trim()
        ? value.trim().toLowerCase()
        : null
}

function getBillableVmMacs(instanceName: string): Set<string> {
    // VM guest interface names are distro-dependent (for example enp5s0),
    // so match the deterministic MACs we assign when creating VM NICs.
    const macs = generateVmNicMacs(instanceName)
    return new Set([macs.eth0.toLowerCase(), macs.eth1.toLowerCase()])
}

function isBillableNetworkInterface(
    ifName: string,
    ifData: InstanceStateNetwork,
    billableVmMacs: Set<string>
): boolean {
    if (ifName === 'lo') return false

    // Incudal-created LXC NICs are eth0 (IPv4/NAT) and optionally eth1 (routed IPv6).
    // Do not count guest-created bridges/veth/docker/tunnel interfaces; those can
    // reflect the same packet again and inflate quota usage.
    if (ifName === 'eth0' || ifName === 'eth1') {
        return true
    }

    const hwaddr = normalizeMac(ifData.hwaddr)
    return hwaddr !== null && billableVmMacs.has(hwaddr)
}

function isLikelyExternalGuestInterface(ifName: string): boolean {
    const normalized = ifName.toLowerCase()
    return /^eth[0-9]+$/.test(normalized) || /^en(?:o|p|s|x)[a-z0-9]+$/.test(normalized)
}

function counterToBigInt(value: number | string | undefined): bigint {
    if (typeof value === 'string') {
        return /^\d+$/.test(value) ? BigInt(value) : 0n
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0n
    }
    return BigInt(Math.floor(value))
}

function addCounters(
    totals: NetworkCounters,
    counters: InstanceStateNetwork['counters'] | undefined
): void {
    if (!counters) return
    totals.rxBytes += counterToBigInt(counters.bytes_received)
    totals.txBytes += counterToBigInt(counters.bytes_sent)
}

/**
 * 获取实例网络流量计数器
 * 只统计 Incudal 创建的外联网卡，避免 Docker/veth/隧道等 guest 内部接口重复计量
 */
export async function getTrafficCounters(
    client: IncusClient,
    instanceName: string
): Promise<NetworkCounters> {
    const state = await client.request<InstanceTrafficState>('GET', `/1.0/instances/${instanceName}/state`)
    return getTrafficCountersFromState(instanceName, state)
}

export function getTrafficCountersFromState(
    instanceName: string,
    state: InstanceTrafficState
): NetworkCounters {
    const billableVmMacs = getBillableVmMacs(instanceName)

    const totals: NetworkCounters = { rxBytes: 0n, txBytes: 0n }
    const fallbackInterfaces: Array<[string, InstanceStateNetwork]> = []
    let hasStrictBillableInterface = false

    if (state.network) {
        for (const [ifName, ifData] of Object.entries(state.network)) {
            if (isBillableNetworkInterface(ifName, ifData, billableVmMacs)) {
                hasStrictBillableInterface = true
                addCounters(totals, ifData.counters)

                if (process.env.DEBUG_TRAFFIC === 'true' && ifData.counters) {
                    console.log(`[Traffic Debug] ${instanceName} - ${ifName}: rx=${ifData.counters.bytes_received}, tx=${ifData.counters.bytes_sent}`)
                }
                continue
            }

            if (isLikelyExternalGuestInterface(ifName)) {
                fallbackInterfaces.push([ifName, ifData])
                continue
            }

            if (process.env.DEBUG_TRAFFIC === 'true' && ifData.counters) {
                console.log(`[Traffic Debug] ${instanceName} - ${ifName}: skipped non-billable interface`)
            }
        }

        if (!hasStrictBillableInterface && fallbackInterfaces.length > 0) {
            for (const [ifName, ifData] of fallbackInterfaces) {
                addCounters(totals, ifData.counters)

                if (process.env.DEBUG_TRAFFIC === 'true') {
                    console.log(`[Traffic Debug] ${instanceName} - ${ifName}: fallback rx=${ifData.counters?.bytes_received || 0}, tx=${ifData.counters?.bytes_sent || 0}`)
                }
            }
        }
    }

    return totals
}

/**
 * 限速带宽值 (1Mbit)
 */
export const THROTTLE_BANDWIDTH = '1Mbit'

/**
 * 应用带宽限速
 * 设置 limits.ingress 和 limits.egress 为 1Mbit
 */
export async function applyThrottle(
    client: IncusClient,
    instanceName: string
): Promise<void> {
    const instance = await getInstance(client, instanceName)
    const devices = instance.devices || {}

    // 找到网络设备并应用限速
    for (const [deviceName, device] of Object.entries(devices)) {
        if (device.type === 'nic') {
            devices[deviceName] = {
                ...device,
                'limits.ingress': THROTTLE_BANDWIDTH,
                'limits.egress': THROTTLE_BANDWIDTH
            }
        }
    }

    await updateInstance(client, instanceName, { devices })
}

/**
 * 恢复原始带宽
 * 根据实例/套餐的原始带宽配置恢复，或移除限制
 */
export async function restoreBandwidth(
    client: IncusClient,
    instanceName: string,
    limitsIngress: string | null,
    limitsEgress: string | null
): Promise<void> {
    const instance = await getInstance(client, instanceName)
    const devices = instance.devices || {}

    for (const [deviceName, device] of Object.entries(devices)) {
        if (device.type === 'nic') {
            const updatedDevice = { ...device }

            if (limitsIngress) {
                updatedDevice['limits.ingress'] = limitsIngress
            } else {
                delete updatedDevice['limits.ingress']
            }

            if (limitsEgress) {
                updatedDevice['limits.egress'] = limitsEgress
            } else {
                delete updatedDevice['limits.egress']
            }

            devices[deviceName] = updatedDevice
        }
    }

    await updateInstance(client, instanceName, { devices })
}

/**
 * 检查实例是否已被限速
 */
export async function isThrottled(
    client: IncusClient,
    instanceName: string
): Promise<boolean> {
    const instance = await getInstance(client, instanceName)
    const devices = instance.devices || {}

    for (const device of Object.values(devices)) {
        if (device.type === 'nic') {
            const ingress = device['limits.ingress'] as string | undefined
            if (ingress === THROTTLE_BANDWIDTH) {
                return true
            }
        }
    }

    return false
}
