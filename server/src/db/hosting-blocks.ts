import { prisma } from './prisma.js'

export interface HostingUserBlockInfo {
  id: number
  blockedUserId: number
  username: string
  email: string | null
  avatarStyle: string
  avatarBadgeId: string | null
  remark: string | null
  createdAt: string
}

export async function isUserBlockedByHoster(blockerId: number, blockedUserId: number, tx?: typeof prisma): Promise<boolean> {
  if (blockerId === blockedUserId) {
    return false
  }

  const client = tx || prisma
  const block = await client.hostingUserBlock.findUnique({
    where: {
      blockerId_blockedUserId: {
        blockerId,
        blockedUserId
      }
    },
    select: { id: true }
  })

  return !!block
}

export async function isUserBlockedFromPackage(userId: number, packageId: number, tx?: typeof prisma): Promise<boolean> {
  const client = tx || prisma
  const pkg = await client.package.findUnique({
    where: { id: packageId },
    select: { userId: true }
  })

  if (!pkg || pkg.userId === userId) {
    return false
  }

  return isUserBlockedByHoster(pkg.userId, userId, client)
}

export async function getBlockerIdsForUser(userId: number): Promise<number[]> {
  const blocks = await prisma.hostingUserBlock.findMany({
    where: { blockedUserId: userId },
    select: { blockerId: true }
  })

  return blocks.map(block => block.blockerId)
}

export async function listHostingUserBlocks(blockerId: number): Promise<HostingUserBlockInfo[]> {
  const blocks = await prisma.hostingUserBlock.findMany({
    where: { blockerId },
    include: {
      blockedUser: {
        select: {
          id: true,
          username: true,
          email: true,
          avatarStyle: true,
          avatarBadgeId: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  })

  return blocks.map(block => ({
    id: block.id,
    blockedUserId: block.blockedUserId,
    username: block.blockedUser.username,
    email: block.blockedUser.email,
    avatarStyle: block.blockedUser.avatarStyle,
    avatarBadgeId: block.blockedUser.avatarBadgeId ?? null,
    remark: block.remark,
    createdAt: block.createdAt.toISOString()
  }))
}

export async function createHostingUserBlock(blockerId: number, blockedUserId: number, remark?: string | null): Promise<HostingUserBlockInfo> {
  const block = await prisma.hostingUserBlock.upsert({
    where: {
      blockerId_blockedUserId: {
        blockerId,
        blockedUserId
      }
    },
    create: {
      blockerId,
      blockedUserId,
      remark: remark?.trim() || null
    },
    update: {
      remark: remark?.trim() || null
    },
    include: {
      blockedUser: {
        select: {
          id: true,
          username: true,
          email: true,
          avatarStyle: true,
          avatarBadgeId: true
        }
      }
    }
  })

  return {
    id: block.id,
    blockedUserId: block.blockedUserId,
    username: block.blockedUser.username,
    email: block.blockedUser.email,
    avatarStyle: block.blockedUser.avatarStyle,
    avatarBadgeId: block.blockedUser.avatarBadgeId ?? null,
    remark: block.remark,
    createdAt: block.createdAt.toISOString()
  }
}

export async function removeHostingUserBlock(blockerId: number, blockedUserId: number): Promise<boolean> {
  const result = await prisma.hostingUserBlock.deleteMany({
    where: {
      blockerId,
      blockedUserId
    }
  })

  return result.count > 0
}
