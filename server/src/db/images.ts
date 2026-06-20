/**
 * 镜像相关数据库操作
 * 包含系统镜像 CRUD、节点镜像白名单和使用检查
 */

import { prisma } from './prisma.js'
import type { SystemImage } from '@prisma/client'
import { normalizeArchitecture, type SupportedArchitecture } from '../lib/architecture.js'

type ImageType = 'container' | 'vm' | 'both'

export interface HostImageSelectionState {
  hostId: number
  hostName: string
  architecture: SupportedArchitecture
  instanceType: ImageType
  useDefault: boolean
  allowedImageIds: number[]
  images: SystemImage[]
}

export type ImageAvailabilityFailureReason =
  | 'host_not_found'
  | 'image_not_found'
  | 'architecture_mismatch'
  | 'host_instance_type_mismatch'
  | 'instance_type_mismatch'
  | 'memory_incompatible'
  | 'not_allowed'

export type HostImageAvailability =
  | {
      ok: true
      hostId: number
      imageId: number
      architecture: SupportedArchitecture
      useDefault: boolean
    }
  | {
      ok: false
      reason: ImageAvailabilityFailureReason
    }

// ==================== 系统镜像管理 ====================

/**
 * 获取所有系统镜像（排序）
 */
export async function getAllSystemImages(): Promise<SystemImage[]> {
  return prisma.systemImage.findMany({
    orderBy: [
      { sortOrder: 'asc' },
      { id: 'asc' }
    ]
  })
}

// 128MB 内存限制只能使用的发行版（轻量级系统）
const LOW_MEMORY_ALLOWED_DISTROS = ['alpine', 'debian']
const LOW_MEMORY_THRESHOLD = 128 // MB

function getImageInstanceType(image: Pick<SystemImage, 'instanceType'>): ImageType {
  return (image.instanceType || 'both') as ImageType
}

function getHostInstanceType(host: { instanceType: string | null }): ImageType {
  return (host.instanceType || 'container') as ImageType
}

function isImageCompatibleWithTargetType(imageType: ImageType, targetType: ImageType): boolean {
  if (targetType === 'both') {
    return true
  }

  return imageType === 'both' || imageType === targetType
}

function isImageCompatibleWithLowMemory(image: Pick<SystemImage, 'icon'>, memory?: number): boolean {
  if (memory === undefined || memory > LOW_MEMORY_THRESHOLD) {
    return true
  }

  const icon = image.icon?.toLowerCase() || ''
  return LOW_MEMORY_ALLOWED_DISTROS.includes(icon)
}

/**
 * 获取所有可见的系统镜像
 * @param instanceType 可选，按实例类型过滤 (container/vm)
 * @param memory 可选，内存大小(MB)，128MB 时只返回 Alpine/Debian
 * @param hostId 可选，按节点的架构和镜像白名单过滤
 */
export async function getVisibleSystemImages(
  instanceType?: 'container' | 'vm',
  memory?: number,
  hostId?: number
): Promise<SystemImage[]> {
  if (!hostId) {
    const where: { hidden: boolean; instanceType?: { in: string[] }; icon?: { in: string[] } } = { hidden: false }

    if (instanceType) {
      where.instanceType = { in: [instanceType, 'both'] }
    }

    if (memory !== undefined && memory <= LOW_MEMORY_THRESHOLD) {
      where.icon = { in: LOW_MEMORY_ALLOWED_DISTROS }
    }

    return prisma.systemImage.findMany({
      where,
      orderBy: [
        { sortOrder: 'asc' },
        { id: 'asc' }
      ]
    })
  }

  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: {
      architecture: true,
      instanceType: true,
      allowedImages: {
        select: {
          imageId: true
        }
      }
    }
  })

  if (!host) {
    return []
  }

  const hostArchitecture = normalizeArchitecture(host.architecture)
  const hostInstanceType = getHostInstanceType(host)
  const allowedImageIds = host.allowedImages.map(item => item.imageId)

  const where: {
    hidden: boolean
    architecture: string
    icon?: { in: string[] }
    id?: { in: number[] }
  } = {
    hidden: false,
    architecture: hostArchitecture
  }

  if (memory !== undefined && memory <= LOW_MEMORY_THRESHOLD) {
    where.icon = { in: LOW_MEMORY_ALLOWED_DISTROS }
  }

  if (allowedImageIds.length > 0) {
    where.id = { in: allowedImageIds }
  }

  const images = await prisma.systemImage.findMany({
    where,
    orderBy: [
      { sortOrder: 'asc' },
      { id: 'asc' }
    ]
  })

  return images.filter(image => {
    const imageType = getImageInstanceType(image)

    if (!isImageCompatibleWithTargetType(imageType, hostInstanceType)) {
      return false
    }

    if (instanceType && !isImageCompatibleWithTargetType(imageType, instanceType)) {
      return false
    }

    return true
  })
}

/**
 * 获取节点镜像白名单配置
 */
export async function getHostImageSelectionState(hostId: number): Promise<HostImageSelectionState | null> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: {
      id: true,
      name: true,
      architecture: true,
      instanceType: true,
      allowedImages: {
        select: {
          imageId: true
        }
      }
    }
  })

  if (!host) {
    return null
  }

  const hostArchitecture = normalizeArchitecture(host.architecture)
  const hostInstanceType = getHostInstanceType(host)
  const rawAllowedImageIds = host.allowedImages.map(item => item.imageId)

  const images = await prisma.systemImage.findMany({
    where: {
      hidden: false,
      architecture: hostArchitecture
    },
    orderBy: [
      { sortOrder: 'asc' },
      { id: 'asc' }
    ]
  })

  const compatibleImages = images.filter(image => isImageCompatibleWithTargetType(getImageInstanceType(image), hostInstanceType))
  const compatibleImageIds = new Set(compatibleImages.map(image => image.id))

  return {
    hostId: host.id,
    hostName: host.name,
    architecture: hostArchitecture,
    instanceType: hostInstanceType,
    useDefault: rawAllowedImageIds.length === 0,
    allowedImageIds: rawAllowedImageIds.filter(imageId => compatibleImageIds.has(imageId)),
    images: compatibleImages
  }
}

/**
 * 保存节点镜像白名单配置
 */
export async function saveHostAllowedImages(hostId: number, useDefault: boolean, imageIds: number[]): Promise<HostImageSelectionState | null> {
  const selectionState = await getHostImageSelectionState(hostId)

  if (!selectionState) {
    return null
  }

  const allowedCandidateIds = new Set(selectionState.images.map(image => image.id))
  const normalizedImageIds = [...new Set(imageIds)]

  for (const imageId of normalizedImageIds) {
    if (!allowedCandidateIds.has(imageId)) {
      throw new Error(`INVALID_IMAGE_FOR_HOST:${imageId}`)
    }
  }

  await prisma.$transaction(async tx => {
    await tx.hostAllowedImage.deleteMany({
      where: { hostId }
    })

    if (!useDefault && normalizedImageIds.length > 0) {
      await tx.hostAllowedImage.createMany({
        data: normalizedImageIds.map(imageId => ({
          hostId,
          imageId
        })),
        skipDuplicates: true
      })
    }
  })

  return getHostImageSelectionState(hostId)
}

/**
 * 检查镜像是否可用于指定节点
 */
export async function getSystemImageAvailabilityForHost(
  remoteAlias: string,
  hostId: number,
  options: {
    instanceType?: 'container' | 'vm'
    memory?: number
  } = {}
): Promise<HostImageAvailability> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: {
      id: true,
      architecture: true,
      instanceType: true,
      allowedImages: {
        select: {
          imageId: true
        }
      }
    }
  })

  if (!host) {
    return { ok: false, reason: 'host_not_found' }
  }

  const image = await prisma.systemImage.findUnique({
    where: { remoteAlias },
    select: {
      id: true,
      hidden: true,
      architecture: true,
      instanceType: true,
      icon: true
    }
  })

  if (!image || image.hidden) {
    return { ok: false, reason: 'image_not_found' }
  }

  const hostArchitecture = normalizeArchitecture(host.architecture)
  const imageArchitecture = normalizeArchitecture(image.architecture)
  if (imageArchitecture !== hostArchitecture) {
    return { ok: false, reason: 'architecture_mismatch' }
  }

  const hostInstanceType = getHostInstanceType(host)
  const imageType = getImageInstanceType(image)

  if (!isImageCompatibleWithTargetType(imageType, hostInstanceType)) {
    return { ok: false, reason: 'host_instance_type_mismatch' }
  }

  if (options.instanceType && !isImageCompatibleWithTargetType(imageType, options.instanceType)) {
    return { ok: false, reason: 'instance_type_mismatch' }
  }

  if (!isImageCompatibleWithLowMemory(image, options.memory)) {
    return { ok: false, reason: 'memory_incompatible' }
  }

  const allowedImageIds = host.allowedImages.map(item => item.imageId)
  if (allowedImageIds.length > 0 && !allowedImageIds.includes(image.id)) {
    return { ok: false, reason: 'not_allowed' }
  }

  return {
    ok: true,
    hostId: host.id,
    imageId: image.id,
    architecture: hostArchitecture,
    useDefault: allowedImageIds.length === 0
  }
}

/**
 * 根据 ID 获取系统镜像
 */
export async function getSystemImageById(id: number): Promise<SystemImage | null> {
  return prisma.systemImage.findUnique({
    where: { id }
  })
}

/**
 * 根据远程别名获取系统镜像
 */
export async function getSystemImageByRemoteAlias(remoteAlias: string): Promise<SystemImage | null> {
  return prisma.systemImage.findUnique({
    where: { remoteAlias }
  })
}

/**
 * 根据远程别名获取镜像显示名称
 * 同时支持带 images: 前缀和不带前缀的格式
 */
export async function getImageDisplayName(imageAlias: string): Promise<string | null> {
  const withoutPrefix = imageAlias.replace(/^images:/, '')

  const image = await prisma.systemImage.findFirst({
    where: {
      OR: [
        { remoteAlias: withoutPrefix },
        { remoteAlias: imageAlias }
      ]
    }
  })

  return image?.name || null
}

/**
 * 批量获取镜像显示名称
 * @param imageAliases 镜像别名数组（可能包含 images: 前缀）
 * @returns Map<原始别名, 显示名称>
 */
export async function getImageDisplayNames(imageAliases: string[]): Promise<Map<string, string>> {
  const uniqueAliases = [...new Set(imageAliases)]
  const allPossibleAliases: string[] = []

  for (const alias of uniqueAliases) {
    const withoutPrefix = alias.replace(/^images:/, '')
    allPossibleAliases.push(withoutPrefix)
    if (withoutPrefix !== alias) {
      allPossibleAliases.push(alias)
    }
  }

  const images = await prisma.systemImage.findMany({
    where: {
      remoteAlias: { in: allPossibleAliases }
    },
    select: {
      name: true,
      remoteAlias: true
    }
  })

  const result = new Map<string, string>()
  for (const alias of uniqueAliases) {
    const withoutPrefix = alias.replace(/^images:/, '')
    const image = images.find(item => item.remoteAlias === withoutPrefix || item.remoteAlias === alias)
    if (image) {
      result.set(alias, image.name)
    }
  }

  return result
}

/**
 * 创建系统镜像
 */
export async function createSystemImage(data: {
  name: string
  remoteAlias: string
  osType?: string
  architecture?: string
  instanceType?: 'container' | 'vm' | 'both'
  icon: string
  sortOrder?: number
  hidden?: boolean
}): Promise<SystemImage> {
  return prisma.systemImage.create({
    data: {
      name: data.name,
      remoteAlias: data.remoteAlias,
      osType: data.osType || 'Linux',
      architecture: normalizeArchitecture(data.architecture),
      instanceType: data.instanceType || 'both',
      icon: data.icon,
      sortOrder: data.sortOrder || 0,
      hidden: data.hidden || false
    }
  })
}

/**
 * 更新系统镜像
 */
export async function updateSystemImage(id: number, data: {
  name?: string
  remoteAlias?: string
  osType?: string
  architecture?: string
  instanceType?: 'container' | 'vm' | 'both'
  icon?: string
  sortOrder?: number
  hidden?: boolean
}): Promise<SystemImage> {
  return prisma.systemImage.update({
    where: { id },
    data: {
      ...data,
      ...(data.architecture !== undefined ? { architecture: normalizeArchitecture(data.architecture) } : {})
    }
  })
}

/**
 * 删除系统镜像
 */
export async function deleteSystemImage(id: number): Promise<SystemImage> {
  return prisma.systemImage.delete({
    where: { id }
  })
}

/**
 * 验证镜像是否在可用列表中（未隐藏）
 */
export async function isValidSystemImage(remoteAlias: string): Promise<boolean> {
  const image = await prisma.systemImage.findUnique({
    where: { remoteAlias }
  })

  return image !== null && !image.hidden
}

/**
 * 验证镜像是否与套餐类型兼容
 */
export async function isImageCompatibleWithInstanceType(remoteAlias: string, instanceType: 'container' | 'vm'): Promise<boolean> {
  const image = await prisma.systemImage.findUnique({
    where: { remoteAlias }
  })

  if (!image || image.hidden) {
    return false
  }

  return isImageCompatibleWithTargetType(getImageInstanceType(image), instanceType)
}

/**
 * 验证镜像是否与内存配置兼容
 */
export async function isImageCompatibleWithMemory(remoteAlias: string, memory: number): Promise<boolean> {
  const image = await prisma.systemImage.findUnique({
    where: { remoteAlias }
  })

  if (!image || image.hidden) {
    return false
  }

  return isImageCompatibleWithLowMemory(image, memory)
}

// ==================== 镜像使用检查 ====================

/**
 * 检查镜像是否被实例使用
 */
export async function checkImageInUse(hostId: number, remoteAlias: string): Promise<number> {
  const count = await prisma.instance.count({
    where: {
      hostId,
      status: { not: 'deleted' },
      image: remoteAlias
    }
  })

  return count
}
