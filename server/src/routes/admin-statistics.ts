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

export default async function adminStatisticsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/statistics/overview - 管理员统计概览
  app.get('/api/admin/statistics/overview', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const dailyWindow = getDailyWindow(DAILY_DAYS)
      const monthlyWindow = getMonthlyWindow(MONTHLY_MONTHS)

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
        monthlyDestroyFee
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
          SELECT COALESCE(SUM(amount), 0)::numeric AS value
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
                 COALESCE(SUM(amount), 0)::numeric AS value
          FROM recharge_records
          WHERE status = 'completed'
            AND COALESCE(completed_at, created_at) >= ${dailyWindow.start}
            AND COALESCE(completed_at, created_at) < ${dailyWindow.end}
          GROUP BY to_char(COALESCE(completed_at, created_at) + interval '8 hours', 'YYYY-MM-DD')
          ORDER BY bucket
        `),
        prisma.$queryRaw<BucketRow[]>(Prisma.sql`
          SELECT to_char(COALESCE(completed_at, created_at) + interval '8 hours', 'YYYY-MM') AS bucket,
                 COALESCE(SUM(amount), 0)::numeric AS value
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
        `)
      ])

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
        }
      }
    } catch (error) {
      request.log.error(error, '获取统计数据失败')
      return reply.status(500).send({ error: '获取统计数据失败' })
    }
  })
}
