/**
 * 资源释放通知
 * 当实例被销毁/删除/过期导致套餐下的节点资源释放时，
 * 向全局通知渠道发送通知。
 */

import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { sendToChannel } from './notifier.js'

/**
 * 格式化内存显示
 */
function formatMem(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb} MB`
}

/**
 * 获取第一个全局通知渠道
 */
async function getFirstGlobalChannel(): Promise<{ id: number; name: string; type: string } | null> {
  const channel = await prisma.notificationChannel.findFirst({
    where: { isGlobal: true },
    select: { id: true, name: true, type: true }
  })
  return channel
}

/**
 * 发送资源释放通知到全局通知渠道
 * @param params.packageId 套餐ID
 * @param params.cpu 释放的 CPU（%）
 * @param params.memory 释放的内存（MB）
 * @param params.source 来源说明，如 "用户销毁实例" / "实例过期自动删除" / "节点所有者删除实例"
 */
export async function sendReleaseNotification(params: {
  packageId: number
  cpu: number
  memory: number
  source: string
}): Promise<void> {
  const { packageId, cpu, memory, source: _source } = params

  try {
    const globalChannel = await getFirstGlobalChannel()
    if (!globalChannel) return

    const pkg = await db.getPackageById(packageId)
    if (!pkg) return

    // 获取套餐绑定的所有宿主机的当前可用配额
    const packageHostIds = pkg.host_ids || []
    const hostDetails: string[] = []
    for (const hostId of packageHostIds) {
      const h = await db.getHostById(hostId)
      if (h) {
        const cpuAvailable = (h.cpu_allowance_max || 0) - (h.cpu_used || 0)
        const memAvailable = (h.memory_max || 0) - (h.memory_used || 0)
        hostDetails.push(`• ${h.name.toUpperCase()}: CPU ${cpuAvailable}% | 内存 ${formatMem(memAvailable)}`)
      }
    }

    // 构建通知消息
    const notifyTitle = `⭕ 资源释放 - ${pkg.name}`

    // 判断套餐来源
    const pkgOwner = pkg.user_id
      ? await prisma.user.findUnique({ where: { id: pkg.user_id }, select: { role: true } })
      : null
    const pkgSource = pkgOwner?.role === 'admin' ? 'official' : 'market'
    const buyLink = process.env.SITE_URL
      ? { label: '🛒 立即开通', url: `${process.env.SITE_URL}/instances/create?source=${pkgSource}&package=${packageId}` }
      : undefined

    const notifyMessage = [
      `+${cpu}% CPU / +${formatMem(memory)} 内存`,
      '',
      '当前可用配额：',
      ...hostDetails,
      '',
      `⏰ ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
    ].join('\n')

    await sendToChannel(globalChannel.id, notifyTitle, notifyMessage, buyLink)
  } catch {
    // 通知发送失败不影响主流程
  }
}
