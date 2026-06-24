/**
 * 管理员统计路由
 */

import { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { BUSINESS_TIMEZONE, getDateStringInTimezone, getMonthStringInTimezone } from '../lib/timezone.js'

const BUSINESS_TZ_OFFSET_MINUTES = 8 * 60
const DAY_MS = 24 * 60 * 60 * 1000
const DAILY_DAYS = 30
const MONTHLY_MONTHS = 12
const AGENT_STALE_MINUTES = 30
const TASK_LOOKBACK_DAYS = 1
const RISK_LOOKBACK_DAYS = 7

interface BucketRow {
  bucket: string
  value: unknown
}

interface ScalarRow {
  value: unknown
}

interface SeriesPoint {
  label: string
  value: number
}

type OperationRiskSeverity = 'info' | 'warning' | 'critical'

interface OperationRisk {
  key: string
  severity: OperationRiskSeverity
  count: number
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return Number.parseFloat(String(value)) || 0
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function parseYearMonth(label: string): { year: number; month: number } {
  const [year, month] = label.split('-').map(Number)
  return { year, month }
}

function getBusinessDayStartUtc(date: Date = new Date()): Date {
  const label = getDateStringInTimezone(date, BUSINESS_TIMEZONE)
  const [year, month, day] = label.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
  start.setMinutes(start.getMinutes() - BUSINESS_TZ_OFFSET_MINUTES)
  return start
}

function getBusinessMonthStartUtc(year: number, month: number): Date {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  start.setMinutes(start.getMinutes() - BUSINESS_TZ_OFFSET_MINUTES)
  return start
}

function formatBusinessDateFromStart(startUtc: Date): string {
  return new Date(startUtc.getTime() + BUSINESS_TZ_OFFSET_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

function formatBusinessMonthFromStart(startUtc: Date): string {
  return new Date(startUtc.getTime() + BUSINESS_TZ_OFFSET_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 7)
}

function getDailyWindow(days: number): { start: Date; end: Date; labels: string[] } {
  const todayStart = getBusinessDayStartUtc()
  const start = new Date(todayStart.getTime() - (days - 1) * DAY_MS)
  const end = new Date(todayStart.getTime() + DAY_MS)
  const labels = Array.from({ length: days }, (_, index) =>
    formatBusinessDateFromStart(new Date(start.getTime() + index * DAY_MS))
  )

  return { start, end, labels }
}

function getBusinessDayRange(offsetDays = 0): { start: Date; end: Date } {
  const todayStart = getBusinessDayStartUtc()
  const start = new Date(todayStart.getTime() + offsetDays * DAY_MS)
  const end = new Date(start.getTime() + DAY_MS)
  return { start, end }
}

function getBusinessRollingRange(days: number): { start: Date; end: Date } {
  const todayStart = getBusinessDayStartUtc()
  return {
    start: new Date(todayStart.getTime() - (days - 1) * DAY_MS),
    end: new Date(todayStart.getTime() + DAY_MS)
  }
}

function getMonthlyWindow(months: number): { start: Date; end: Date; labels: string[] } {
  const currentMonth = getMonthStringInTimezone(new Date(), BUSINESS_TIMEZONE)
  const { year, month } = parseYearMonth(currentMonth)
  const start = getBusinessMonthStartUtc(year, month - months + 1)
  const end = getBusinessMonthStartUtc(year, month + 1)
  const labels = Array.from({ length: months }, (_, index) =>
    formatBusinessMonthFromStart(getBusinessMonthStartUtc(year, month - months + 1 + index))
  )

  return { start, end, labels }
}

function fillSeries(rows: BucketRow[], labels: string[], money = false): SeriesPoint[] {
  const rowMap = new Map(rows.map(row => [row.bucket, toNumber(row.value)]))
  return labels.map(label => {
    const value = rowMap.get(label) || 0
    return {
      label,
      value: money ? roundMoney(value) : value
    }
  })
}

function scalarValue(rows: ScalarRow[], money = false): number {
  const value = toNumber(rows[0]?.value)
  return money ? roundMoney(value) : value
}

function addRisk(risks: OperationRisk[], condition: boolean, key: string, severity: OperationRiskSeverity, count = 0): void {
  if (condition) {
    risks.push({ key, severity, count })
  }
}

export default async function adminStatisticsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/statistics/overview - 管理员统计概览
  app.get('/api/admin/statistics/overview', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const dailyWindow = getDailyWindow(DAILY_DAYS)
      const monthlyWindow = getMonthlyWindow(MONTHLY_MONTHS)
      const todayRange = getBusinessDayRange(0)
      const yesterdayRange = getBusinessDayRange(-1)
      const last7DaysRange = getBusinessRollingRange(7)
      const last30DaysRange = getBusinessRollingRange(30)
      const now = new Date()
      const agentFreshAfter = new Date(now.getTime() - AGENT_STALE_MINUTES * 60 * 1000)
      const taskLookbackAfter = new Date(now.getTime() - TASK_LOOKBACK_DAYS * DAY_MS)
      const riskLookbackAfter = new Date(now.getTime() - RISK_LOOKBACK_DAYS * DAY_MS)

      const [
        totalUsers,
        totalInstances,
        activeInstances,
        paidInstances,
        freeInstances,
        totalRechargeRows,
        totalConsumeRows,
        totalAffRows,
        totalDestroyFeeRows,
        dailyUsers,
        monthlyUsers,
        dailyInstances,
        monthlyInstances,
        dailyRecharge,
        monthlyRecharge,
        dailyConsume,
        monthlyConsume,
        dailyAff,
        monthlyAff,
        dailyDestroyFee,
        monthlyDestroyFee,
        todayRevenueRows,
        yesterdayRevenueRows,
        last7DaysRevenueRows,
        last30DaysRevenueRows,
        todayOrders,
        todaySuccessfulOrders,
        todayFailedOrders,
        todayPendingOrders,
        attentionOrders,
        todayNewUsers,
        todayActiveUsersRows,
        paidUsersRows,
        todayNewInstances,
        runningInstances,
        abnormalInstances,
        expiringInstances,
        pendingDeliveryTasks,
        failedDeliveryTasks,
        totalHosts,
        onlineHosts,
        onlineAgents,
        staleAgents,
        openTickets,
        unreadInboxMessages,
        failedNotificationLogs,
        failedEmailTasks,
        activePaymentProviders,
        enabledNotificationChannels,
        smtpEnabledConfigs,
        failedUpdateTasks,
        diskUpdateErrorTasks
      ] = await Promise.all([
        prisma.user.count(),
        prisma.instance.count({ where: { status: { not: 'deleted' } } }),
        prisma.instance.count({ where: { status: { notIn: ['deleted', 'suspended'] } } }),
        prisma.instance.count({
          where: {
            status: { not: 'deleted' },
            packagePlanId: { not: null }
          }
        }),
        prisma.instance.count({
          where: {
            status: { not: 'deleted' },
            packagePlanId: null
          }
        }),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
        `),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(ABS(amount)), 0)::numeric AS value
          FROM balance_logs
          WHERE type IN ('consume', 'transfer_fee')
        `),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(amount), 0)::numeric AS value
          FROM aff_logs
          WHERE type IN ('new_purchase', 'renew')
        `),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(fee_amount), 0)::numeric AS value
          FROM user_destroy_records
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(created_at + interval '8 hours', 'YYYY-MM-DD') AS bucket, COUNT(*)::int AS value
          FROM users
          WHERE created_at >= ${dailyWindow.start} AND created_at < ${dailyWindow.end}
          GROUP BY to_char(created_at + interval '8 hours', 'YYYY-MM-DD')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(created_at + interval '8 hours', 'YYYY-MM') AS bucket, COUNT(*)::int AS value
          FROM users
          WHERE created_at >= ${monthlyWindow.start} AND created_at < ${monthlyWindow.end}
          GROUP BY to_char(created_at + interval '8 hours', 'YYYY-MM')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(created_at + interval '8 hours', 'YYYY-MM-DD') AS bucket, COUNT(*)::int AS value
          FROM instances
          WHERE created_at >= ${dailyWindow.start} AND created_at < ${dailyWindow.end}
          GROUP BY to_char(created_at + interval '8 hours', 'YYYY-MM-DD')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(created_at + interval '8 hours', 'YYYY-MM') AS bucket, COUNT(*)::int AS value
          FROM instances
          WHERE created_at >= ${monthlyWindow.start} AND created_at < ${monthlyWindow.end}
          GROUP BY to_char(created_at + interval '8 hours', 'YYYY-MM')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(COALESCE(completed_at, created_at) + interval '8 hours', 'YYYY-MM-DD') AS bucket,
                 COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
            AND COALESCE(completed_at, created_at) >= ${dailyWindow.start}
            AND COALESCE(completed_at, created_at) < ${dailyWindow.end}
          GROUP BY to_char(COALESCE(completed_at, created_at) + interval '8 hours', 'YYYY-MM-DD')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(COALESCE(completed_at, created_at) + interval '8 hours', 'YYYY-MM') AS bucket,
                 COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
            AND COALESCE(completed_at, created_at) >= ${monthlyWindow.start}
            AND COALESCE(completed_at, created_at) < ${monthlyWindow.end}
          GROUP BY to_char(COALESCE(completed_at, created_at) + interval '8 hours', 'YYYY-MM')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(created_at + interval '8 hours', 'YYYY-MM-DD') AS bucket,
                 COALESCE(SUM(ABS(amount)), 0)::numeric AS value
          FROM balance_logs
          WHERE type IN ('consume', 'transfer_fee')
            AND created_at >= ${dailyWindow.start}
            AND created_at < ${dailyWindow.end}
          GROUP BY to_char(created_at + interval '8 hours', 'YYYY-MM-DD')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(created_at + interval '8 hours', 'YYYY-MM') AS bucket,
                 COALESCE(SUM(ABS(amount)), 0)::numeric AS value
          FROM balance_logs
          WHERE type IN ('consume', 'transfer_fee')
            AND created_at >= ${monthlyWindow.start}
            AND created_at < ${monthlyWindow.end}
          GROUP BY to_char(created_at + interval '8 hours', 'YYYY-MM')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(created_at + interval '8 hours', 'YYYY-MM-DD') AS bucket,
                 COALESCE(SUM(amount), 0)::numeric AS value
          FROM aff_logs
          WHERE type IN ('new_purchase', 'renew')
            AND created_at >= ${dailyWindow.start}
            AND created_at < ${dailyWindow.end}
          GROUP BY to_char(created_at + interval '8 hours', 'YYYY-MM-DD')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(created_at + interval '8 hours', 'YYYY-MM') AS bucket,
                 COALESCE(SUM(amount), 0)::numeric AS value
          FROM aff_logs
          WHERE type IN ('new_purchase', 'renew')
            AND created_at >= ${monthlyWindow.start}
            AND created_at < ${monthlyWindow.end}
          GROUP BY to_char(created_at + interval '8 hours', 'YYYY-MM')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(destroyed_at + interval '8 hours', 'YYYY-MM-DD') AS bucket,
                 COALESCE(SUM(fee_amount), 0)::numeric AS value
          FROM user_destroy_records
          WHERE destroyed_at >= ${dailyWindow.start}
            AND destroyed_at < ${dailyWindow.end}
          GROUP BY to_char(destroyed_at + interval '8 hours', 'YYYY-MM-DD')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(destroyed_at + interval '8 hours', 'YYYY-MM') AS bucket,
                 COALESCE(SUM(fee_amount), 0)::numeric AS value
          FROM user_destroy_records
          WHERE destroyed_at >= ${monthlyWindow.start}
            AND destroyed_at < ${monthlyWindow.end}
          GROUP BY to_char(destroyed_at + interval '8 hours', 'YYYY-MM')
          ORDER BY bucket
        `),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
            AND COALESCE(completed_at, created_at) >= ${todayRange.start}
            AND COALESCE(completed_at, created_at) < ${todayRange.end}
        `),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
            AND COALESCE(completed_at, created_at) >= ${yesterdayRange.start}
            AND COALESCE(completed_at, created_at) < ${yesterdayRange.end}
        `),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
            AND COALESCE(completed_at, created_at) >= ${last7DaysRange.start}
            AND COALESCE(completed_at, created_at) < ${last7DaysRange.end}
        `),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COALESCE(SUM(COALESCE(actual_amount, amount)), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
            AND COALESCE(completed_at, created_at) >= ${last30DaysRange.start}
            AND COALESCE(completed_at, created_at) < ${last30DaysRange.end}
        `),
        prisma.rechargeRecord.count({ where: { createdAt: { gte: todayRange.start, lt: todayRange.end } } }),
        prisma.rechargeRecord.count({ where: { status: 'completed', createdAt: { gte: todayRange.start, lt: todayRange.end } } }),
        prisma.rechargeRecord.count({ where: { status: { in: ['failed', 'cancelled', 'refunded'] }, createdAt: { gte: todayRange.start, lt: todayRange.end } } }),
        prisma.rechargeRecord.count({ where: { status: { in: ['pending', 'paid'] }, createdAt: { gte: todayRange.start, lt: todayRange.end } } }),
        prisma.rechargeRecord.count({ where: { status: { in: ['paid', 'failed'] }, updatedAt: { gte: riskLookbackAfter } } }),
        prisma.user.count({ where: { createdAt: { gte: todayRange.start, lt: todayRange.end } } }),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COUNT(DISTINCT user_id)::int AS value
          FROM login_records
          WHERE created_at >= ${todayRange.start}
            AND created_at < ${todayRange.end}
        `),
        prisma.$queryRaw<ScalarRow[]>(Prisma.sql`
          SELECT COUNT(DISTINCT user_id)::int AS value
          FROM recharge_records
          WHERE status = 'completed'
        `),
        prisma.instance.count({ where: { createdAt: { gte: todayRange.start, lt: todayRange.end } } }),
        prisma.instance.count({ where: { status: 'running' } }),
        prisma.instance.count({ where: { status: 'error' } }),
        prisma.instance.count({
          where: {
            status: { not: 'deleted' },
            expiresAt: { gte: now, lt: new Date(now.getTime() + RISK_LOOKBACK_DAYS * DAY_MS) }
          }
        }),
        prisma.instanceTask.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
        prisma.instanceTask.count({ where: { status: 'FAILED', createdAt: { gte: taskLookbackAfter } } }),
        prisma.host.count(),
        prisma.host.count({ where: { status: 'online' } }),
        prisma.hostAgent.count({ where: { enabled: true, status: 'online', lastSeenAt: { gte: agentFreshAfter } } }),
        prisma.hostAgent.count({
          where: {
            enabled: true,
            OR: [
              { status: { not: 'online' } },
              { lastSeenAt: null },
              { lastSeenAt: { lt: agentFreshAfter } }
            ]
          }
        }),
        prisma.ticket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
        prisma.inboxMessage.count({ where: { isRead: false } }),
        prisma.notificationLog.count({ where: { status: 'failed', createdAt: { gte: taskLookbackAfter } } }),
        prisma.hostNotificationEmailTask.count({ where: { status: 'FAILED', createdAt: { gte: taskLookbackAfter } } }),
        prisma.paymentProvider.count({ where: { status: 'active' } }),
        prisma.notificationChannel.count({ where: { enabled: true } }),
        prisma.systemConfig.count({
          where: {
            key: 'smtp_enabled',
            value: { in: ['true', '1', 'yes', 'on'] }
          }
        }),
        prisma.systemUpdateTask.count({ where: { status: 'failed', createdAt: { gte: riskLookbackAfter } } }),
        prisma.systemUpdateTask.count({
          where: {
            createdAt: { gte: riskLookbackAfter },
            OR: [
              { errorMessage: { contains: 'No space left' } },
              { errorMessage: { contains: '磁盘空间不足' } },
              { errorMessage: { contains: '磁碟空間不足' } }
            ]
          }
        })
      ])

      const operationRisks: OperationRisk[] = []
      addRisk(operationRisks, activePaymentProviders === 0, 'payment_provider_missing', 'critical', activePaymentProviders)
      addRisk(operationRisks, smtpEnabledConfigs === 0, 'smtp_missing', 'warning', smtpEnabledConfigs)
      addRisk(operationRisks, enabledNotificationChannels === 0, 'notification_channel_missing', 'warning', enabledNotificationChannels)
      addRisk(operationRisks, totalHosts > 0 && onlineHosts < totalHosts, 'host_offline', 'critical', totalHosts - onlineHosts)
      addRisk(operationRisks, staleAgents > 0, 'agent_stale', 'critical', staleAgents)
      addRisk(operationRisks, failedDeliveryTasks > 0, 'delivery_failed', 'critical', failedDeliveryTasks)
      addRisk(operationRisks, attentionOrders > 0, 'payment_attention', 'warning', attentionOrders)
      addRisk(operationRisks, failedUpdateTasks > 0, 'ota_failed', 'critical', failedUpdateTasks)
      addRisk(operationRisks, diskUpdateErrorTasks > 0, 'disk_update_error', 'critical', diskUpdateErrorTasks)

      return {
        meta: {
          timezone: BUSINESS_TIMEZONE,
          dailyDays: DAILY_DAYS,
          monthlyMonths: MONTHLY_MONTHS
        },
        users: {
          total: totalUsers,
          dailyNewUsers: fillSeries(dailyUsers, dailyWindow.labels),
          monthlyNewUsers: fillSeries(monthlyUsers, monthlyWindow.labels)
        },
        instances: {
          total: totalInstances,
          active: activeInstances,
          paid: paidInstances,
          free: freeInstances,
          dailyCreatedInstances: fillSeries(dailyInstances, dailyWindow.labels),
          monthlyCreatedInstances: fillSeries(monthlyInstances, monthlyWindow.labels)
        },
        billing: {
          totals: {
            recharge: scalarValue(totalRechargeRows, true),
            consume: scalarValue(totalConsumeRows, true),
            aff: scalarValue(totalAffRows, true),
            destroyFee: scalarValue(totalDestroyFeeRows, true)
          },
          dailyRecharge: fillSeries(dailyRecharge, dailyWindow.labels, true),
          monthlyRecharge: fillSeries(monthlyRecharge, monthlyWindow.labels, true),
          dailyConsume: fillSeries(dailyConsume, dailyWindow.labels, true),
          monthlyConsume: fillSeries(monthlyConsume, monthlyWindow.labels, true),
          dailyAff: fillSeries(dailyAff, dailyWindow.labels, true),
          monthlyAff: fillSeries(monthlyAff, monthlyWindow.labels, true),
          dailyDestroyFee: fillSeries(dailyDestroyFee, dailyWindow.labels, true),
          monthlyDestroyFee: fillSeries(monthlyDestroyFee, monthlyWindow.labels, true)
        },
        operations: {
          revenue: {
            today: scalarValue(todayRevenueRows, true),
            yesterday: scalarValue(yesterdayRevenueRows, true),
            last7Days: scalarValue(last7DaysRevenueRows, true),
            last30Days: scalarValue(last30DaysRevenueRows, true)
          },
          orders: {
            todayTotal: todayOrders,
            todaySuccess: todaySuccessfulOrders,
            todayFailed: todayFailedOrders,
            todayPending: todayPendingOrders,
            needsAttention: attentionOrders
          },
          users: {
            newToday: todayNewUsers,
            activeToday: scalarValue(todayActiveUsersRows),
            paidTotal: scalarValue(paidUsersRows)
          },
          instances: {
            newToday: todayNewInstances,
            running: runningInstances,
            abnormal: abnormalInstances,
            expiringSoon: expiringInstances
          },
          delivery: {
            pendingTasks: pendingDeliveryTasks,
            failedTasks24h: failedDeliveryTasks
          },
          infrastructure: {
            hostsTotal: totalHosts,
            hostsOnline: onlineHosts,
            agentsOnline: onlineAgents,
            agentsStale: staleAgents
          },
          support: {
            openTickets,
            unreadInboxMessages,
            failedNotifications24h: failedNotificationLogs,
            failedEmails24h: failedEmailTasks
          },
          risks: operationRisks
        }
      }
    } catch (error) {
      request.log.error(error, '获取统计数据失败')
      return reply.status(500).send({ error: '获取统计数据失败' })
    }
  })
}
