import '../src/config/env.js'

import { closePrismaDatabase, prisma } from '../src/db/prisma.js'
import { getInstanceBillingLineageIds, reassignInstanceBillingRecords } from '../src/db/billing-records.js'

type MigrationMessageData = {
  instanceId?: unknown
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

async function countBillingRecords(instanceId: number): Promise<number> {
  return prisma.instanceBillingRecord.count({
    where: { instanceId }
  })
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='))
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null

  if (limitArg && (!Number.isInteger(limit) || Number(limit) <= 0)) {
    throw new Error('参数 --limit 必须是正整数')
  }

  const migrationMessages = await prisma.inboxMessage.findMany({
    where: {
      eventType: 'instance_migrated'
    },
    orderBy: { createdAt: 'asc' },
    ...(limit ? { take: limit } : {})
  })

  let scanned = 0
  let eligible = 0
  let movedRecords = 0
  let unresolved = 0
  let skipped = 0
  const processedTargetIds = new Set<number>()

  console.log(`[FixMigratedInstanceBilling] mode=${apply ? 'apply' : 'dry-run'}, messages=${migrationMessages.length}`)

  for (const message of migrationMessages) {
    scanned += 1

    const data = (message.data || {}) as MigrationMessageData
    if (!isInteger(data.instanceId)) {
      skipped += 1
      console.log(`[Skip] inboxMessage=${message.id} 原始数据缺失 newInstanceId`)
      continue
    }

    if (processedTargetIds.has(data.instanceId)) {
      skipped += 1
      console.log(`[Skip] inboxMessage=${message.id} 目标实例 ${data.instanceId} 已处理过`)
      continue
    }

    const newInstance = await prisma.instance.findFirst({
      where: {
        id: data.instanceId,
        userId: message.userId
      },
      select: { id: true }
    })

    if (!newInstance) {
      skipped += 1
      console.log(`[Skip] inboxMessage=${message.id} 找不到目标实例 newInstanceId=${data.instanceId}`)
      continue
    }

    processedTargetIds.add(newInstance.id)

    const lineage = await getInstanceBillingLineageIds(newInstance.id)
    const sourceInstanceIds = lineage.slice(0, -1)

    if (sourceInstanceIds.length === 0) {
      unresolved += 1
      console.log(`[Unresolved] inboxMessage=${message.id} newInstance=${newInstance.id} 未解析到历史实例`)
      continue
    }

    const sourceSummaries = await Promise.all(sourceInstanceIds.map(async sourceInstanceId => ({
      sourceInstanceId,
      billingRecordCount: await countBillingRecords(sourceInstanceId)
    })))

    eligible += 1
    console.log(
      `[Match] inboxMessage=${message.id} lineage=${lineage.join(' -> ')} ` +
      `sources=${sourceSummaries.map(item => `${item.sourceInstanceId}(records=${item.billingRecordCount})`).join(', ')}`
    )

    if (!apply) {
      continue
    }

    const moved = await prisma.$transaction(async tx => {
      let totalMoved = 0
      for (const sourceInstanceId of sourceInstanceIds) {
        totalMoved += await reassignInstanceBillingRecords(sourceInstanceId, newInstance.id, tx)
      }
      return totalMoved
    })

    movedRecords += moved
  }

  console.log(`[Summary] scanned=${scanned}, eligible=${eligible}, movedRecords=${movedRecords}, unresolved=${unresolved}, skipped=${skipped}`)

  await closePrismaDatabase()
}

void main().catch(async error => {
  console.error('[FixMigratedInstanceBilling] failed:', error)
  await closePrismaDatabase()
  process.exit(1)
})
