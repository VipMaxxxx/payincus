import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { ErrorCode, type ErrorCodeType } from './errors.js'
import { addDevice, removeDevice } from './incus/incus-instances.js'
import { getIncusClient } from './incus/index.js'
import { selectBindableIpv4ListenAddress } from './network-address.js'
import { ProxyStrategyFactory } from './proxy/index.js'
import { networkModeAllowsPortMapping } from './network-modes.js'
import { isInstanceAutoRemotePortEnabled } from '../db/system-config.js'
import { resolveRemotePrivatePort } from './remote-port.js'
export { resolveRemotePrivatePort, REMOTE_PORT_SSH, REMOTE_PORT_RDP } from './remote-port.js'

export type PortMappingProtocol = 'tcp' | 'udp'

/**
 * 创建实例时自动下发一条远程端口映射：Linux → 22(SSH)，Windows → 3389(RDP)。
 *
 * 三条约束（owner 拍板）：
 *  - 不计入用户端口配额（systemManaged=true，见 checkPortQuota）；
 *  - 只对新建实例生效，不回填存量实例；
 *  - 受全局开关 instance_auto_remote_port 与创建实例时的勾选共同控制，任一关闭都不下发。
 *
 * 实例创建有两条独立路径（用户自建 createInstanceAsync、托管 provisionManagedInstanceAsync），
 * 两条都必须调用这里，否则会漏掉一半实例。
 *
 * 失败绝不能影响实例创建结果 —— 实例已经跑起来了，用户随时可以自己手动加一条。
 */
export async function provisionAutoRemotePort(input: {
  instanceId: number
  image: string
  networkMode: string
  autoRemotePort?: boolean
}): Promise<void> {
  try {
    if (input.autoRemotePort === false) return
    if (!networkModeAllowsPortMapping(input.networkMode)) return
    if (!(await isInstanceAutoRemotePortEnabled())) return

    const instance = await db.getInstanceById(input.instanceId)
    if (!instance) return

    const host = await db.getHostById(instance.host_id)
    if (!host) return

    const privatePort = resolveRemotePrivatePort(input.image)
    const result = await addInstancePortMapping({
      instance,
      host,
      protocol: 'tcp',
      privatePort,
      systemManaged: true
    })

    if (result.ok) {
      console.log(`[AutoRemotePort] instance ${input.instanceId}: ${result.mapping.publicPort} -> ${privatePort}`)
    } else {
      console.warn(`[AutoRemotePort] skipped for instance ${input.instanceId}: ${result.code}`)
    }
  } catch (error) {
    console.warn(`[AutoRemotePort] failed for instance ${input.instanceId}:`, error)
  }
}

export interface AddPortMappingInput {
  instance: {
    id: number
    host_id: number
    incus_id: string
    network_mode: string
    package_id?: number | null
  }
  host: Awaited<ReturnType<typeof db.getHostById>>
  protocol: PortMappingProtocol
  privatePort: number
  publicPort?: number
  remark?: string | null
  // 创建实例时系统自动下发的远程端口。这条不计入用户端口配额（见 checkPortQuota）。
  systemManaged?: boolean
}

export type AddPortMappingResult =
  | {
      ok: true
      mapping: { id: number; protocol: PortMappingProtocol; publicPort: number; privatePort: number; remark: string | null }
    }
  | { ok: false; code: ErrorCodeType; detail?: string; message?: string }

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002')
}

/**
 * 给实例添加一条端口映射。
 *
 * 这里是端口映射下发的唯一实现 —— 用户手动添加的路由和创建实例时的自动下发都走这里，避免两份
 * 安全逻辑各自漂移。必须保持的安全序列（有守卫 test-port-mapping-safety 钉住）：
 *   1. 先 checkPortInUse 确认端口没被占用，再落 DB 预留；
 *   2. 下发设备失败时，只移除本次真正创建出来的设备名，绝不按通用名去删（可能属于别的请求）；
 *   3. 回滚时把 DB 预留一并删掉，不留悬空映射。
 *
 * 注意：调用方负责持有该实例的端口映射锁，以及（对用户手动添加而言）配额校验。
 */
export async function addInstancePortMapping(input: AddPortMappingInput): Promise<AddPortMappingResult> {
  const { instance, host, protocol, privatePort, remark, systemManaged = false } = input

  if (!host) {
    return { ok: false, code: ErrorCode.HOST_NOT_FOUND }
  }
  if (instance.network_mode === 'ipv6_only') {
    return { ok: false, code: ErrorCode.INVALID_PARAMS, detail: 'IPv6 Only instances do not require port mappings' }
  }

  let allocatedPort = input.publicPort
  if (!allocatedPort) {
    const port = await db.allocatePort(instance.host_id, protocol)
    if (!port) {
      return { ok: false, code: ErrorCode.PORT_NO_AVAILABLE }
    }
    allocatedPort = port
  } else if (host.nat_port_start && host.nat_port_end) {
    if (allocatedPort < host.nat_port_start || allocatedPort > host.nat_port_end) {
      return { ok: false, code: ErrorCode.PORT_RANGE_INVALID, detail: `${host.nat_port_start}-${host.nat_port_end}` }
    }
  }

  const existingPort = await db.checkPortInUse(instance.host_id, allocatedPort, protocol)
  if (existingPort) {
    return { ok: false, code: ErrorCode.PORT_IN_USE }
  }

  const createdDeviceNames: string[] = []
  let reservedMappingId: number | null = null

  try {
    const client = await getIncusClient(host)
    const deviceName = `proxy-${protocol}-${allocatedPort}`

    // 实例真实类别以套餐为准（params.type 不保证同步）
    let isVM = false
    if (instance.package_id) {
      const pkg = await prisma.package.findUnique({ where: { id: instance.package_id } })
      isVM = !!pkg && (('instance_type' in pkg && (pkg as Record<string, unknown>).instance_type === 'vm') ||
        ('instanceType' in pkg && (pkg as Record<string, unknown>).instanceType === 'vm'))
    }
    const actualInstanceType = isVM ? 'virtual-machine' : 'container'

    let explicitIpv6 = (host as unknown as Record<string, unknown>).nat_bind_ipv6 as string | null ||
      host.nat_public_ipv6 || host.ipv6_gateway || (host.ip_address?.includes(':') ? host.ip_address : null)
    if (!explicitIpv6) {
      try {
        const ipv6Alias = await prisma.hostAddressAlias.findFirst({
          where: { hostId: host.id, kind: 'ipv6' },
          select: { address: true }
        })
        if (ipv6Alias?.address) explicitIpv6 = ipv6Alias.address
      } catch { /* 没有别名就用上面的保底值 */ }
    }

    const proxyStrategy = ProxyStrategyFactory.getStrategy(actualInstanceType)
    const bindableIpv4 = selectBindableIpv4ListenAddress(
      (host as unknown as Record<string, unknown>).nat_bind_ip as string | null || null,
      host.nat_public_ip || null,
      host.url,
      host.ip_address || null
    )
    const proxyDeviceRes = proxyStrategy.createProxyDevice(
      bindableIpv4, explicitIpv6, instance.network_mode, protocol, allocatedPort, privatePort
    )

    const deviceConfigs = proxyDeviceRes.deviceConfigs
      || (proxyDeviceRes.deviceConfig ? [{ deviceConfig: proxyDeviceRes.deviceConfig }] : [])

    if (!proxyDeviceRes.success || deviceConfigs.length === 0) {
      return {
        ok: false,
        code: ErrorCode.INVALID_PARAMS,
        detail: proxyDeviceRes.errorMessage || '底层代理生成异常被工厂截断'
      }
    }

    reservedMappingId = await db.createPortMapping({
      instanceId: instance.id,
      hostId: instance.host_id,
      protocol,
      publicPort: allocatedPort,
      privatePort,
      remark: remark?.trim() || undefined,
      systemManaged
    })

    for (const deviceEntry of deviceConfigs) {
      const resolvedDeviceName = `${deviceName}${deviceEntry.nameSuffix || ''}`
      await addDevice(client, instance.incus_id, resolvedDeviceName, deviceEntry.deviceConfig as Record<string, string>)
      createdDeviceNames.push(resolvedDeviceName)
    }

    return {
      ok: true,
      mapping: {
        id: reservedMappingId,
        protocol,
        publicPort: allocatedPort,
        privatePort,
        remark: remark?.trim() || null
      }
    }
  } catch (error) {
    // 只回滚本次真正创建出来的设备名，并撤销 DB 预留，绝不留悬空映射。
    try {
      const rollbackHost = await db.getHostById(instance.host_id)
      if (rollbackHost) {
        const client = await getIncusClient(rollbackHost)
        for (const createdDeviceName of createdDeviceNames) {
          await removeDevice(client, instance.incus_id, createdDeviceName)
        }
      }
      if (reservedMappingId !== null) {
        await db.deletePortMapping(reservedMappingId)
      }
    } catch { /* 忽略回滚失败，保留原始错误 */ }

    if (isUniqueConstraintError(error)) {
      return { ok: false, code: ErrorCode.PORT_IN_USE }
    }
    return {
      ok: false,
      code: ErrorCode.INTERNAL_ERROR,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
