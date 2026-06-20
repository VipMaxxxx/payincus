/**
 * incus-config-generator.ts
 * Incus 配置生成器入口
 * 根据实例类型路由到对应的生成器
 */

import { generateContainerConfig, generateRandomPassword as containerGenerateRandomPassword } from './incus-config-container.js'
import type { IncusConfigParams, IncusConfigResult, IncusConfigMetaData } from './incus-config-container.js'
import { generateVmConfig } from './incus-config-vm.js'
import type { IncusConfigParams as VmConfigParams } from './incus-config-vm.js'

// 重新导出类型（保持兼容）
export type { IncusConfigParams, IncusConfigResult, IncusConfigMetaData }

// 重新导出工具函数（保持兼容）
export const generateRandomPassword = containerGenerateRandomPassword

// SSH 端口固定为 22
const SSH_PORT = 22

/**
 * 生成 Incus 实例配置
 * 根据 type 参数自动路由到容器或 VM 配置生成器
 * 
 * @param params 配置参数
 * @returns 配置结果
 */
export function generateIncusConfig(params: IncusConfigParams): IncusConfigResult {
  // VM 路由
  if (params.type === 'virtual-machine') {
    const vmParams: VmConfigParams = {
      instanceName: params.instanceName,
      imageAlias: params.imageAlias,
      rootPassword: params.rootPassword,
      sshKey: params.sshKey,
      network: params.network,
      extraShellCommands: params.extraShellCommands,
      networkMode: params.networkMode
    }
    const vmResult = generateVmConfig(vmParams)
    return {
      configPayload: vmResult.configPayload,
      metaData: {
        sshPort: SSH_PORT,
        rootPassword: params.rootPassword,
        osFamily: 'linux',
        imageAlias: params.imageAlias,
        instanceType: 'virtual-machine',
        ipAddress: params.network?.ipAddress || 'dhcp'
      }
    }
  }
  
  // 容器路由
  return generateContainerConfig(params)
}
