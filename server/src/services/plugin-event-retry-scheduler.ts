import { processDuePluginEventRetries } from '../lib/plugin-runtime.js'
import { sendNotification } from '../lib/notifier.js'
import { prisma } from '../db/prisma.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { getAllAdminUserIds } from '../db/users.js'
import { getPluginEventAlertPreference, type PluginEventAlertPreference } from '../lib/plugin-event-alert-preferences.js'

const PLUGIN_EVENT_RETRY_INTERVAL_MS = 60_000
const PLUGIN_EVENT_ALERT_SCAN_LIMIT = 100
const PLUGIN_EVENT_ADMIN_ESCALATION_COOLDOWN_MINUTES = 360

let schedulerStarted = false

interface PluginEventAlertMetrics {
  pluginId: string
  deadLetterCount: number
  dueRetryCount: number
  recentFailedCount: number
  recentSuccessRate: number | null
  latestFailure?: {
    eventName: string | null
    handler: string | null
  } | null
}

function shouldNotifyPluginEventAlert(input: {
  preference: PluginEventAlertPreference
  deadLetterCount: number
  dueRetryCount: number
  recentTotal: number
  recentSuccessRate: number | null
}): { shouldNotify: boolean; level: 'warning' | 'critical'; reasons: string[] } {
  if (!input.preference.enabled) return { shouldNotify: false, level: 'warning', reasons: [] }
  const reasons: string[] = []
  let level: 'warning' | 'critical' = 'warning'

  if (input.preference.notifyOnDeadLetter && input.deadLetterCount > 0) {
    reasons.push('dead_letter')
    level = 'critical'
  }
  if (input.preference.notifyOnDueRetry && input.dueRetryCount > 0) {
    reasons.push('due_retry')
    level = 'critical'
  }
  if (
    input.preference.notifyOnSuccessRateBelow &&
    input.recentTotal >= 10 &&
    input.recentSuccessRate !== null &&
    input.recentSuccessRate < input.preference.successRateThreshold
  ) {
    reasons.push('success_rate_low')
  }
  if (input.preference.minimumLevel === 'critical' && level !== 'critical') {
    return { shouldNotify: false, level, reasons: [] }
  }
  return { shouldNotify: reasons.length > 0, level, reasons }
}

function buildPluginEventAlertNotificationData(metrics: PluginEventAlertMetrics) {
  return {
    pluginEventPluginId: metrics.pluginId,
    pluginEventDeadLetterCount: metrics.deadLetterCount,
    pluginEventDueRetryCount: metrics.dueRetryCount,
    pluginEventRecentFailedCount: metrics.recentFailedCount,
    pluginEventLatestEventName: metrics.latestFailure?.eventName ?? undefined,
    pluginEventLatestHandler: metrics.latestFailure?.handler ?? undefined
  }
}

async function collectPluginEventAlertMetrics(
  pluginId: string,
  now: Date,
  recentWindowHours: number
): Promise<PluginEventAlertMetrics & { recentTotal: number }> {
  const recentSince = new Date(now.getTime() - recentWindowHours * 60 * 60 * 1000)
  const [deadLetterCount, dueRetryCount, recentTotal, recentSuccess, recentFailedCount, latestFailure] = await Promise.all([
    prisma.pluginEventLog.count({
      where: { pluginId, action: 'plugin.event.dispatch', result: 'dead_letter' }
    }),
    prisma.pluginEventLog.count({
      where: { pluginId, action: 'plugin.event.dispatch', result: 'retry_pending', deadLetterAt: null, nextRetryAt: { lte: now } }
    }),
    prisma.pluginEventLog.count({
      where: {
        pluginId,
        action: 'plugin.event.dispatch',
        OR: [
          { lastAttemptAt: { gte: recentSince } },
          { lastAttemptAt: null, createdAt: { gte: recentSince } }
        ]
      }
    }),
    prisma.pluginEventLog.count({
      where: {
        pluginId,
        action: 'plugin.event.dispatch',
        result: 'success',
        OR: [
          { lastAttemptAt: { gte: recentSince } },
          { lastAttemptAt: null, createdAt: { gte: recentSince } }
        ]
      }
    }),
    prisma.pluginEventLog.count({
      where: {
        pluginId,
        action: 'plugin.event.dispatch',
        result: { in: ['retry_pending', 'dead_letter'] },
        OR: [
          { lastAttemptAt: { gte: recentSince } },
          { lastAttemptAt: null, createdAt: { gte: recentSince } }
        ]
      }
    }),
    prisma.pluginEventLog.findFirst({
      where: {
        pluginId,
        action: 'plugin.event.dispatch',
        result: { in: ['retry_pending', 'dead_letter'] }
      },
      orderBy: [{ lastAttemptAt: 'desc' }, { createdAt: 'desc' }],
      select: { eventName: true, handler: true }
    })
  ])
  return {
    pluginId,
    deadLetterCount,
    dueRetryCount,
    recentTotal,
    recentFailedCount,
    recentSuccessRate: recentTotal > 0 ? Math.round((recentSuccess / recentTotal) * 1000) / 10 : null,
    latestFailure
  }
}

async function notifyAdminPluginEventDeliveryEscalation(
  metrics: PluginEventAlertMetrics,
  now: Date
): Promise<number> {
  if (metrics.deadLetterCount === 0 && metrics.dueRetryCount === 0) return 0

  const adminUserIds = await getAllAdminUserIds()
  if (adminUserIds.length === 0) return 0

  const cooldownSince = new Date(now.getTime() - PLUGIN_EVENT_ADMIN_ESCALATION_COOLDOWN_MINUTES * 60 * 1000)
  let escalated = 0

  for (const adminUserId of adminUserIds) {
    const existingEscalation = await prisma.log.findFirst({
      where: {
        userId: adminUserId,
        module: LogModule.PLUGIN,
        action: 'plugin.event.alert_escalate',
        content: { contains: `plugin ${metrics.pluginId}` },
        createdAt: { gte: cooldownSince }
      },
      orderBy: { createdAt: 'desc' }
    })
    if (existingEscalation) continue

    await sendNotification(adminUserId, 'plugin_event_delivery_alert', buildPluginEventAlertNotificationData(metrics))
    await createLog(
      adminUserId,
      LogModule.PLUGIN,
      'plugin.event.alert_escalate',
      `Critical plugin event alert escalated for plugin ${metrics.pluginId}: ${metrics.deadLetterCount} dead-letter, ${metrics.dueRetryCount} due retries, recent success rate ${metrics.recentSuccessRate ?? 'n/a'}%`,
      LogResult.WARNING
    )
    escalated += 1
  }

  return escalated
}

export async function notifyDeveloperPluginEventDeliveryAlerts(now = new Date()): Promise<{ scanned: number; notified: number; skipped: number; escalated: number }> {
  const problemLogs = await prisma.pluginEventLog.findMany({
    where: {
      action: 'plugin.event.dispatch',
      OR: [
        { result: 'dead_letter' },
        { result: 'retry_pending' }
      ]
    },
    select: { pluginId: true },
    distinct: ['pluginId'],
    orderBy: { pluginId: 'asc' },
    take: PLUGIN_EVENT_ALERT_SCAN_LIMIT
  })
  const pluginIds = problemLogs.map(log => log.pluginId)
  if (pluginIds.length === 0) return { scanned: 0, notified: 0, skipped: 0, escalated: 0 }

  const submissions = await prisma.pluginMarketSubmission.findMany({
    where: { pluginId: { in: pluginIds } },
    select: { pluginId: true, submittedByUserId: true },
    orderBy: { updatedAt: 'desc' }
  })
  const submitterByPluginId = new Map<string, number>()
  for (const submission of submissions) {
    if (!submitterByPluginId.has(submission.pluginId)) {
      submitterByPluginId.set(submission.pluginId, submission.submittedByUserId)
    }
  }

  let notified = 0
  let skipped = 0
  let escalated = 0

  for (const pluginId of pluginIds) {
    const adminMetrics = await collectPluginEventAlertMetrics(pluginId, now, 24)
    escalated += await notifyAdminPluginEventDeliveryEscalation(adminMetrics, now)

    const userId = submitterByPluginId.get(pluginId)
    if (!userId) {
      skipped += 1
      continue
    }

    const preference = await getPluginEventAlertPreference(userId, pluginId)
    const developerMetrics = preference.recentWindowHours === 24
      ? adminMetrics
      : await collectPluginEventAlertMetrics(pluginId, now, preference.recentWindowHours)
    const developerCooldownSince = new Date(now.getTime() - preference.cooldownMinutes * 60 * 1000)
    const existingAlert = await prisma.log.findFirst({
      where: {
        userId,
        module: LogModule.PLUGIN,
        action: 'plugin.event.alert_notify',
        content: { contains: `plugin ${pluginId}` },
        createdAt: { gte: developerCooldownSince }
      },
      orderBy: { createdAt: 'desc' }
    })
    if (existingAlert) {
      skipped += 1
      continue
    }

    const decision = shouldNotifyPluginEventAlert({
      preference,
      deadLetterCount: developerMetrics.deadLetterCount,
      dueRetryCount: developerMetrics.dueRetryCount,
      recentTotal: developerMetrics.recentTotal,
      recentSuccessRate: developerMetrics.recentSuccessRate
    })
    if (!decision.shouldNotify) {
      skipped += 1
      continue
    }

    await sendNotification(userId, 'plugin_event_delivery_alert', buildPluginEventAlertNotificationData(developerMetrics))
    await createLog(
      userId,
      LogModule.PLUGIN,
      'plugin.event.alert_notify',
      `Plugin event alert sent for plugin ${pluginId}: ${decision.reasons.join(', ') || decision.level}; ${developerMetrics.deadLetterCount} dead-letter, ${developerMetrics.dueRetryCount} due retries, recent success rate ${developerMetrics.recentSuccessRate ?? 'n/a'}%`,
      decision.level === 'critical' ? LogResult.WARNING : LogResult.SUCCESS
    )
    notified += 1
  }

  return { scanned: pluginIds.length, notified, skipped, escalated }
}

export function startPluginEventRetryScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true
  console.log('[PluginEventRetry] Starting plugin event retry scheduler')

  setInterval(() => {
    processDuePluginEventRetries()
      .then(() => notifyDeveloperPluginEventDeliveryAlerts())
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[PluginEventRetry] Failed to process due retries: ${message}`)
      })
  }, PLUGIN_EVENT_RETRY_INTERVAL_MS)
}
