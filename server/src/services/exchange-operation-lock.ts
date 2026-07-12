import { prisma } from '../db/prisma.js'

const listingLockedStatuses = ['active', 'locked', 'delivery_failed'] as const
const orderLockedStatuses = ['delivering', 'confirming', 'disputed', 'manual_review', 'failed'] as const
const buyerDeliveredAccessStatuses = ['confirming', 'disputed'] as const

export interface ExchangeOperationLock {
  locked: boolean
  code?: 'EXCHANGE_LISTING_ACTIVE' | 'EXCHANGE_ORDER_ACTIVE'
  message?: string
  listingId?: number
  orderId?: number
}

export async function getExchangeOperationLock(instanceId: number): Promise<ExchangeOperationLock> {
  const listing = await prisma.exchangeListing.findFirst({
    where: {
      instanceId,
      status: { in: [...listingLockedStatuses] }
    },
    select: { id: true, status: true }
  })
  if (listing) {
    return {
      locked: true,
      code: 'EXCHANGE_LISTING_ACTIVE',
      message: listing.status === 'locked' || listing.status === 'delivery_failed'
        ? '实例处于交易锁定或交割中，不能执行该操作'
        : '实例已上架交易所，不能执行该操作；请先下架交易所',
      listingId: listing.id
    }
  }

  const order = await prisma.exchangeOrder.findFirst({
    where: {
      instanceId,
      status: { in: [...orderLockedStatuses] }
    },
    select: { id: true, status: true }
  })
  if (order) {
    return {
      locked: true,
      code: 'EXCHANGE_ORDER_ACTIVE',
      message: '实例存在未完成的交易所订单，不能执行该操作',
      orderId: order.id
    }
  }

  return { locked: false }
}

export async function getExchangeSensitiveAccessLock(
  instanceId: number,
  viewer: { id: number; role?: string },
  instanceOwnerId?: number | null
): Promise<ExchangeOperationLock> {
  if (viewer.role === 'admin') return { locked: false }

  const listing = await prisma.exchangeListing.findFirst({
    where: {
      instanceId,
      status: { in: [...listingLockedStatuses] }
    },
    select: { id: true, status: true }
  })
  if (listing) {
    return {
      locked: true,
      code: 'EXCHANGE_LISTING_ACTIVE',
      message: listing.status === 'locked' || listing.status === 'delivery_failed'
        ? '实例处于交易锁定或交割异常处理中，不能查看密码或连接终端'
        : '实例已上架交易所，不能查看密码或连接终端；请先下架交易所',
      listingId: listing.id
    }
  }

  const order = await prisma.exchangeOrder.findFirst({
    where: {
      instanceId,
      status: { in: [...orderLockedStatuses] }
    },
    select: { id: true, status: true, buyerUserId: true }
  })
  if (!order) return { locked: false }

  const viewerIsDeliveredBuyer = (
    instanceOwnerId === order.buyerUserId &&
    viewer.id === order.buyerUserId &&
    (buyerDeliveredAccessStatuses as readonly string[]).includes(order.status)
  )
  if (viewerIsDeliveredBuyer) return { locked: false }

  return {
    locked: true,
    code: 'EXCHANGE_ORDER_ACTIVE',
    message: '实例存在未完成的交易所订单，不能查看密码或连接终端',
    orderId: order.id
  }
}
