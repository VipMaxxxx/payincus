/**
 * 用户自定义初始化命令相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'

// 最大命令模板数量
const MAX_COMMANDS_PER_USER = 50
// 命令内容最大大小 (64KB)
const MAX_COMMAND_SIZE = 64 * 1024

export interface CustomInitCommandData {
  id: number
  userId: number
  name: string
  command: string
  distros: string[] // 解析后的数组
  description: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/**
 * 获取用户的所有自定义初始化命令
 */
export async function getCustomInitCommandsByUserId(userId: number): Promise<CustomInitCommandData[]> {
  const commands = await prisma.customInitCommand.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  })

  return commands.map(cmd => ({
    id: cmd.id,
    userId: cmd.userId,
    name: cmd.name,
    command: cmd.command,
    distros: JSON.parse(cmd.distros) as string[],
    description: cmd.description,
    enabled: cmd.enabled,
    createdAt: cmd.createdAt.toISOString(),
    updatedAt: cmd.updatedAt.toISOString()
  }))
}

/**
 * 获取用户的启用状态的自定义初始化命令（按发行版筛选）
 */
export async function getEnabledCommandsByDistro(userId: number, distro: string): Promise<CustomInitCommandData[]> {
  const commands = await prisma.customInitCommand.findMany({
    where: {
      userId,
      enabled: true
    },
    orderBy: { createdAt: 'desc' }
  })

  // 筛选适配当前发行版的命令（包括 "all" 通用命令）
  const filtered = commands.filter(cmd => {
    const distros = JSON.parse(cmd.distros) as string[]
    return distros.includes('all') || distros.includes(distro)
  })

  return filtered.map(cmd => ({
    id: cmd.id,
    userId: cmd.userId,
    name: cmd.name,
    command: cmd.command,
    distros: JSON.parse(cmd.distros) as string[],
    description: cmd.description,
    enabled: cmd.enabled,
    createdAt: cmd.createdAt.toISOString(),
    updatedAt: cmd.updatedAt.toISOString()
  }))
}

/**
 * 根据 ID 获取自定义初始化命令
 */
export async function getCustomInitCommandById(id: number): Promise<CustomInitCommandData | null> {
  const cmd = await prisma.customInitCommand.findUnique({
    where: { id }
  })

  if (!cmd) return null

  return {
    id: cmd.id,
    userId: cmd.userId,
    name: cmd.name,
    command: cmd.command,
    distros: JSON.parse(cmd.distros) as string[],
    description: cmd.description,
    enabled: cmd.enabled,
    createdAt: cmd.createdAt.toISOString(),
    updatedAt: cmd.updatedAt.toISOString()
  }
}

/**
 * 根据 ID 列表批量获取自定义初始化命令
 */
export async function getCustomInitCommandsByIds(ids: number[]): Promise<CustomInitCommandData[]> {
  if (ids.length === 0) return []

  const commands = await prisma.customInitCommand.findMany({
    where: {
      id: { in: ids }
    }
  })

  return commands.map(cmd => ({
    id: cmd.id,
    userId: cmd.userId,
    name: cmd.name,
    command: cmd.command,
    distros: JSON.parse(cmd.distros) as string[],
    description: cmd.description,
    enabled: cmd.enabled,
    createdAt: cmd.createdAt.toISOString(),
    updatedAt: cmd.updatedAt.toISOString()
  }))
}

/**
 * 获取用户命令数量
 */
export async function getCustomInitCommandCount(userId: number): Promise<number> {
  return prisma.customInitCommand.count({
    where: { userId }
  })
}

/**
 * 创建自定义初始化命令
 */
export async function createCustomInitCommand(data: {
  userId: number
  name: string
  command: string
  distros: string[]
  description?: string
}): Promise<{ success: true; id: number } | { success: false; error: string }> {
  // 验证命令内容大小
  if (Buffer.byteLength(data.command, 'utf-8') > MAX_COMMAND_SIZE) {
    return { success: false, error: 'COMMAND_TOO_LARGE' }
  }

  // 检查用户命令数量是否已达上限
  const count = await getCustomInitCommandCount(data.userId)
  if (count >= MAX_COMMANDS_PER_USER) {
    return { success: false, error: 'MAX_COMMANDS_REACHED' }
  }

  // 验证发行版列表
  const validDistros = ['ubuntu', 'debian', 'rhel', 'alpine', 'arch', 'suse', 'all']
  const invalidDistros = data.distros.filter(d => !validDistros.includes(d))
  if (invalidDistros.length > 0) {
    return { success: false, error: 'INVALID_DISTROS' }
  }

  const cmd = await prisma.customInitCommand.create({
    data: {
      userId: data.userId,
      name: data.name.trim(),
      command: data.command,
      distros: JSON.stringify(data.distros),
      description: data.description?.trim() || null
    }
  })

  return { success: true, id: cmd.id }
}

/**
 * 更新自定义初始化命令
 */
export async function updateCustomInitCommand(
  id: number,
  userId: number,
  data: {
    name?: string
    command?: string
    distros?: string[]
    description?: string | null
    enabled?: boolean
  }
): Promise<{ success: true } | { success: false; error: string }> {
  // 先验证命令属于该用户
  const existing = await prisma.customInitCommand.findFirst({
    where: { id, userId }
  })

  if (!existing) {
    return { success: false, error: 'NOT_FOUND' }
  }

  // 验证命令内容大小
  if (data.command && Buffer.byteLength(data.command, 'utf-8') > MAX_COMMAND_SIZE) {
    return { success: false, error: 'COMMAND_TOO_LARGE' }
  }

  // 验证发行版列表
  if (data.distros) {
    const validDistros = ['ubuntu', 'debian', 'rhel', 'alpine', 'arch', 'suse', 'all']
    const invalidDistros = data.distros.filter(d => !validDistros.includes(d))
    if (invalidDistros.length > 0) {
      return { success: false, error: 'INVALID_DISTROS' }
    }
  }

  const updateData: Record<string, unknown> = {}
  if (data.name !== undefined) updateData.name = data.name.trim()
  if (data.command !== undefined) updateData.command = data.command
  if (data.distros !== undefined) updateData.distros = JSON.stringify(data.distros)
  if (data.description !== undefined) updateData.description = data.description?.trim() || null
  if (data.enabled !== undefined) updateData.enabled = data.enabled

  await prisma.customInitCommand.update({
    where: { id },
    data: updateData
  })

  return { success: true }
}

/**
 * 删除自定义初始化命令
 */
export async function deleteCustomInitCommand(id: number, userId: number): Promise<boolean> {
  const result = await prisma.customInitCommand.deleteMany({
    where: { id, userId }
  })

  return result.count > 0
}

/**
 * 验证命令列表是否属于用户且处于启用状态
 */
export async function validateCommandsOwnership(
  commandIds: number[],
  userId: number
): Promise<{ valid: true; commands: CustomInitCommandData[] } | { valid: false; error: string }> {
  if (commandIds.length === 0) {
    return { valid: true, commands: [] }
  }

  const commands = await prisma.customInitCommand.findMany({
    where: {
      id: { in: commandIds },
      userId,
      enabled: true
    }
  })

  if (commands.length !== commandIds.length) {
    return { valid: false, error: 'INVALID_COMMAND_IDS' }
  }

  return {
    valid: true,
    commands: commands.map(cmd => ({
      id: cmd.id,
      userId: cmd.userId,
      name: cmd.name,
      command: cmd.command,
      distros: JSON.parse(cmd.distros) as string[],
      description: cmd.description,
      enabled: cmd.enabled,
      createdAt: cmd.createdAt.toISOString(),
      updatedAt: cmd.updatedAt.toISOString()
    }))
  }
}

/**
 * 合并多个命令模板的命令内容
 * 返回用于注入到 cloud-init 的完整命令文本
 */
export function mergeCommandContents(commands: CustomInitCommandData[]): string {
  if (commands.length === 0) return ''

  // 按 ID 顺序（保持用户选择顺序）合并命令内容
  return commands.map(cmd => cmd.command).join('\n')
}

/**
 * 根据 ID 列表获取命令（别名，与 getCustomInitCommandsByIds 等价）
 */
export const getCommandsByIds = getCustomInitCommandsByIds

/**
 * 根据镜像别名解析出发行版标识
 * 返回: ubuntu, debian, rhel, alpine, arch, suse, other
 */
export function getImageDistroFromAlias(imageAlias: string): string {
  const alias = imageAlias.toLowerCase()

  if (alias.includes('ubuntu')) return 'ubuntu'
  if (alias.includes('debian') || alias.includes('kali')) return 'debian'
  if (alias.includes('alpine')) return 'alpine'
  if (alias.includes('arch')) return 'arch'
  if (alias.includes('opensuse') || alias.includes('suse') || alias.includes('tumbleweed') || alias.includes('leap')) return 'suse'
  if (alias.includes('alma') || alias.includes('rocky') || alias.includes('oracle') || alias.includes('centos') || alias.includes('rhel') || alias.includes('fedora')) return 'rhel'

  return 'other'
}
