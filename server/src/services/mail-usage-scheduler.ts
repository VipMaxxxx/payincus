/**
 * 邮箱上游实际用量同步任务。
 */

import { schedule } from 'node-cron'
import { prisma } from '../db/prisma.js'
import * as mailDb from '../db/mail.js'
import { sanitizeTokensInString } from '../lib/log-sanitizer.js'
import * as craneMailService from './cranemail.js'
import * as smarterMailService from './smartermail.js'

const MAIL_USAGE_CRON = '17 3 * * *' // 每天 03:17，避开整点任务
let schedulerStarted = false
let usageSyncRunning = false

function safeErrorMessage(error: unknown): string {
  return sanitizeTokensInString(error instanceof Error ? error.message : String(error))
}

async function syncDomainUsage(domainId: number): Promise<void> {
  const domain = await mailDb.getMailDomainById(domainId)
  if (!domain || domain.subscription.status !== 'active' || !domain.source.enabled) {
    return
  }

  try {
    const usage = await craneMailService.getDomainUsage(domain.source, domain.domain)
    if (usage) {
      await prisma.mailDomain.updateMany({
        where: {
          id: domain.id,
          subscription: { status: 'active' }
        },
        data: { diskUsedMb: usage.diskUsedMb }
      })
    }
  } catch (error) {
    console.error(`[MailUsage] CraneMail usage sync failed for domain ${domain.id}: ${safeErrorMessage(error)}`)
  }

  if (!domain.adminUsername || !domain.adminPassword) {
    console.warn(`[MailUsage] Skipping account usage for domain ${domain.id}: admin credentials unavailable`)
    return
  }

  try {
    const upstreamAccounts = await smarterMailService.listAccountUsage(
      domain.source,
      domain.domain,
      domain.adminUsername,
      domain.adminPassword
    )
    const localAccounts = new Map(domain.accounts.map(account => [account.username.toLowerCase(), account]))

    for (const upstreamAccount of upstreamAccounts) {
      const localAccount = localAccounts.get(upstreamAccount.username.toLowerCase())
      if (!localAccount) continue

      try {
        await prisma.mailAccount.updateMany({
          where: {
            id: localAccount.id,
            domain: { subscription: { status: 'active' } }
          },
          data: { diskUsedMb: upstreamAccount.diskUsedMb }
        })
      } catch (error) {
        console.error(`[MailUsage] Account usage update failed for account ${localAccount.id}: ${safeErrorMessage(error)}`)
      }
    }
  } catch (error) {
    console.error(`[MailUsage] SmarterMail usage sync failed for domain ${domain.id}: ${safeErrorMessage(error)}`)
  }
}

export async function syncMailUsage(): Promise<void> {
  if (usageSyncRunning) {
    console.log('[MailUsage] Previous usage sync is still running, skipping')
    return
  }

  usageSyncRunning = true
  try {
    const domains = await prisma.mailDomain.findMany({
      where: {
        subscription: { status: 'active' },
        source: { enabled: true },
        status: { not: 'suspended' }
      },
      select: { id: true },
      orderBy: { id: 'asc' }
    })

    for (const domain of domains) {
      try {
        await syncDomainUsage(domain.id)
      } catch (error) {
        console.error(`[MailUsage] Usage sync failed for domain ${domain.id}: ${safeErrorMessage(error)}`)
      }
    }
  } finally {
    usageSyncRunning = false
  }
}

export function startMailUsageScheduler(): void {
  if (schedulerStarted) {
    return
  }

  schedulerStarted = true

  schedule(MAIL_USAGE_CRON, () => {
    syncMailUsage().catch(error => {
      console.error(`[MailUsage] Scheduled usage sync failed: ${safeErrorMessage(error)}`)
    })
  })

  console.log('[MailUsage] Scheduler started (daily at 03:17)')
}
