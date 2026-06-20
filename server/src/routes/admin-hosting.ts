/**
 * 管理员托管管理路由
 */

import { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { buildHostingVipSql, calculateVipLevel, getVipBadgeStyleForLevel, getVipRules, type NormalizedVipRule } from '../services/vip-levels.js'

interface HostingOwnerRow {
  id: number
  username: string
  email: string | null
  status: string
  avatarStyle: string
  avatarBadgeId: string | null
  hostingBalance: unknown
  createdAt: Date
  hostCount: number
  listedPackageCount: number
  instanceCount: number
  frozenBalance: unknown
  totalHostingIncome: unknown
  hostingZoneId: number | null
}

interface CountRow {
  total: number
}

interface SummaryRow {
  totalHosts: number
  totalListedPackages: number
  totalInstances: number
  totalAvailableBalance: unknown
  totalFrozenBalance: unknown
  totalHostingIncome: unknown
}

interface HostingZonePayload {
  name?: string
  ownerId?: number
  logoUrl?: string
}

const MAX_LOGO_URL_LENGTH = 2048
const HOSTING_OWNER_SORT_FIELDS = [
  'vipLevel',
  'hostingBalance',
  'frozenBalance',
  'totalIncome',
  'hostCount',
  'packageCount',
  'instanceCount'
] as const

type HostingOwnerSortBy = typeof HOSTING_OWNER_SORT_FIELDS[number]
type SortOrder = 'asc' | 'desc'

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return Number.parseFloat(String(value)) || 0
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeHostingOwnerSortBy(value: string | undefined): HostingOwnerSortBy {
  return HOSTING_OWNER_SORT_FIELDS.includes(value as HostingOwnerSortBy)
    ? value as HostingOwnerSortBy
    : 'totalIncome'
}

function normalizeSortOrder(value: string | undefined): SortOrder {
  return value === 'asc' ? 'asc' : 'desc'
}

function buildHostingOwnerOrderSql(sortBy: HostingOwnerSortBy, sortOrder: SortOrder, vipRules: NormalizedVipRule[]): Prisma.Sql {
  const direction = Prisma.raw(sortOrder === 'asc' ? 'ASC' : 'DESC')
  const expression = (() => {
    switch (sortBy) {
      case 'vipLevel':
        return buildHostingVipSql(vipRules)
      case 'hostingBalance':
        return Prisma.sql`"hostingBalance"`
      case 'frozenBalance':
        return Prisma.sql`"frozenBalance"`
      case 'hostCount':
        return Prisma.sql`"hostCount"`
      case 'packageCount':
        return Prisma.sql`"listedPackageCount"`
      case 'instanceCount':
        return Prisma.sql`"instanceCount"`
      case 'totalIncome':
      default:
        return Prisma.sql`"totalHostingIncome"`
    }
  })()

  return Prisma.sql`ORDER BY ${expression} ${direction}, id ASC`
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, char => `\\${char}`)
}

function normalizeZoneName(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40)
}

function validateLogoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_LOGO_URL_LENGTH || /\s/.test(trimmed)) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname || url.username || url.password) return null

  url.hash = ''
  return url.toString()
}

function buildSearchSql(search: string): Prisma.Sql {
  const keyword = search.trim()
  if (!keyword) {
    return Prisma.empty
  }

  const pattern = `%${escapeLike(keyword)}%`
  const numericId = /^\d+$/.test(keyword) ? Number(keyword) : null
  const idCondition = numericId !== null && Number.isSafeInteger(numericId)
    ? Prisma.sql`u.id = ${numericId}`
    : Prisma.sql`false`

  return Prisma.sql`
    AND (
      ${idCondition}
      OR u.username ILIKE ${pattern} ESCAPE '\\'
      OR u.email ILIKE ${pattern} ESCAPE '\\'
    )
  `
}

function buildQualifiedOwnersCte(searchSql: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH host_stats AS (
      SELECT user_id, COUNT(*)::int AS host_count
      FROM hosts
      GROUP BY user_id
    ),
    listed_package_stats AS (
      SELECT p.user_id, COUNT(DISTINCT p.id)::int AS listed_package_count
      FROM packages p
      WHERE p.active = true
        AND p.global_shared = true
        AND EXISTS (
          SELECT 1
          FROM package_hosts ph
          JOIN hosts package_host ON package_host.id = ph.host_id
          WHERE ph.package_id = p.id
            AND package_host.user_id = p.user_id
        )
      GROUP BY p.user_id
    ),
    instance_stats AS (
      SELECT h.user_id, COUNT(i.id)::int AS instance_count
      FROM hosts h
      LEFT JOIN instances i ON i.host_id = h.id AND i.status <> 'deleted'
      GROUP BY h.user_id
    ),
    frozen_stats AS (
      SELECT user_id, COALESCE(SUM(amount), 0)::numeric AS frozen_balance
      FROM hosting_balance_logs
      WHERE frozen = true
        AND type = 'income'
      GROUP BY user_id
    ),
    income_stats AS (
      SELECT user_id, COALESCE(SUM(amount), 0)::numeric AS total_hosting_income
      FROM hosting_balance_logs
      WHERE type = 'income'
      GROUP BY user_id
    ),
    qualified_owners AS (
      SELECT
        u.id,
        u.username,
        u.email,
        u.status::text AS status,
        u.avatar_style AS "avatarStyle",
        u.avatar_badge_id AS "avatarBadgeId",
        u.hosting_balance AS "hostingBalance",
        u.created_at AS "createdAt",
        hs.host_count AS "hostCount",
        lps.listed_package_count AS "listedPackageCount",
        COALESCE(ins.instance_count, 0)::int AS "instanceCount",
        COALESCE(fs.frozen_balance, 0)::numeric AS "frozenBalance",
        COALESCE(inc.total_hosting_income, 0)::numeric AS "totalHostingIncome",
        hz.id AS "hostingZoneId"
      FROM users u
      JOIN host_stats hs ON hs.user_id = u.id AND hs.host_count > 0
      JOIN listed_package_stats lps ON lps.user_id = u.id AND lps.listed_package_count > 0
      JOIN income_stats inc ON inc.user_id = u.id AND inc.total_hosting_income <> 0
      LEFT JOIN instance_stats ins ON ins.user_id = u.id
      LEFT JOIN frozen_stats fs ON fs.user_id = u.id
      LEFT JOIN hosting_zones hz ON hz.owner_id = u.id
      WHERE u.role <> 'admin'
      ${searchSql}
    )
  `
}

async function getQualifiedOwner(ownerId: number): Promise<HostingOwnerRow | null> {
  const qualifiedOwnersCte = buildQualifiedOwnersCte(Prisma.sql`AND u.id = ${ownerId}`)
  const owners = await prisma.$queryRaw<HostingOwnerRow[]>(Prisma.sql`
    ${qualifiedOwnersCte}
    SELECT *
    FROM qualified_owners
    LIMIT 1
  `)
  return owners[0] || null
}

function formatZone(zone: any) {
  return {
    id: zone.id,
    name: zone.name,
    logoUrl: zone.logoUrl,
    active: zone.active,
    sortOrder: zone.sortOrder,
    createdAt: zone.createdAt.toISOString(),
    updatedAt: zone.updatedAt.toISOString(),
    owner: {
      id: zone.owner.id,
      username: zone.owner.username,
      email: zone.owner.email,
      avatarStyle: zone.owner.avatarStyle,
      avatarBadgeId: zone.owner.avatarBadgeId ?? null
    },
    listedPackageCount: zone.listedPackageCount || 0,
    hostCount: zone.hostCount || 0
  }
}

async function attachZoneStats(zones: any[]) {
  if (zones.length === 0) return []

  const ownerIds = zones.map(zone => zone.ownerId)
  const [packageRows, hostRows] = await Promise.all([
    prisma.package.groupBy({
      by: ['userId'],
      where: {
        userId: { in: ownerIds },
        active: true,
        globalShared: true
      },
      _count: { _all: true }
    }),
    prisma.host.groupBy({
      by: ['userId'],
      where: {
        userId: { in: ownerIds }
      },
      _count: { _all: true }
    })
  ])

  const packageCounts = new Map(packageRows.map(row => [row.userId, row._count._all]))
  const hostCounts = new Map(hostRows.map(row => [row.userId, row._count._all]))

  return zones.map(zone => ({
    ...zone,
    listedPackageCount: packageCounts.get(zone.ownerId) || 0,
    hostCount: hostCounts.get(zone.ownerId) || 0
  }))
}

export default async function adminHostingRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/hosting/owners - 托管机主用户列表
  app.get<{
    Querystring: {
      page?: string
      pageSize?: string
      search?: string
      sortBy?: string
      sortOrder?: string
    }
  }>('/api/admin/hosting/owners', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const page = parseBoundedInt(request.query.page, 1, 1, 100000)
      const pageSize = parseBoundedInt(request.query.pageSize, 50, 10, 100)
      const skip = (page - 1) * pageSize
      const search = (request.query.search || '').trim().slice(0, 100)
      const sortBy = normalizeHostingOwnerSortBy(request.query.sortBy)
      const sortOrder = normalizeSortOrder(request.query.sortOrder)
      const searchSql = buildSearchSql(search)
      const qualifiedOwnersCte = buildQualifiedOwnersCte(searchSql)
      const vipRules = await getVipRules('hosting')
      const orderSql = buildHostingOwnerOrderSql(sortBy, sortOrder, vipRules)

      const [owners, countRows, summaryRows] = await Promise.all([
        prisma.$queryRaw<HostingOwnerRow[]>(Prisma.sql`
          ${qualifiedOwnersCte}
          SELECT *
          FROM qualified_owners
          ${orderSql}
          LIMIT ${pageSize}
          OFFSET ${skip}
        `),
        prisma.$queryRaw<CountRow[]>(Prisma.sql`
          ${qualifiedOwnersCte}
          SELECT COUNT(*)::int AS total
          FROM qualified_owners
        `),
        prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
          ${qualifiedOwnersCte}
          SELECT
            COALESCE(SUM("hostCount"), 0)::int AS "totalHosts",
            COALESCE(SUM("listedPackageCount"), 0)::int AS "totalListedPackages",
            COALESCE(SUM("instanceCount"), 0)::int AS "totalInstances",
            COALESCE(SUM("hostingBalance"), 0)::numeric AS "totalAvailableBalance",
            COALESCE(SUM("frozenBalance"), 0)::numeric AS "totalFrozenBalance",
            COALESCE(SUM("totalHostingIncome"), 0)::numeric AS "totalHostingIncome"
          FROM qualified_owners
        `)
      ])

      const total = countRows[0]?.total || 0
      const summary = summaryRows[0]

      return {
        owners: owners.map(owner => {
          const availableBalance = roundMoney(toNumber(owner.hostingBalance))
          const frozenBalance = roundMoney(toNumber(owner.frozenBalance))
          const totalHostingIncome = roundMoney(toNumber(owner.totalHostingIncome))
          const instanceCount = Number(owner.instanceCount || 0)

          const vipLevel = calculateVipLevel('hosting', vipRules, {
            totalHostingIncome,
            instanceCount
          })

          return {
            id: owner.id,
            username: owner.username,
            email: owner.email,
            status: owner.status,
            avatarStyle: owner.avatarStyle,
            avatarBadgeId: owner.avatarBadgeId,
            vipLevel,
            vipBadgeStyle: getVipBadgeStyleForLevel(vipRules, 'hosting', vipLevel),
            hostingBalance: {
              available: availableBalance,
              frozen: frozenBalance,
              total: roundMoney(availableBalance + frozenBalance),
              historicalTotal: totalHostingIncome
            },
            hostCount: Number(owner.hostCount || 0),
            listedPackageCount: Number(owner.listedPackageCount || 0),
            instanceCount,
            createdAt: owner.createdAt.toISOString(),
            hostingZoneId: owner.hostingZoneId
          }
        }),
        summary: {
          totalHosts: Number(summary?.totalHosts || 0),
          totalListedPackages: Number(summary?.totalListedPackages || 0),
          totalInstances: Number(summary?.totalInstances || 0),
          totalAvailableBalance: roundMoney(toNumber(summary?.totalAvailableBalance)),
          totalFrozenBalance: roundMoney(toNumber(summary?.totalFrozenBalance)),
          totalHostingIncome: roundMoney(toNumber(summary?.totalHostingIncome))
        },
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    } catch (error) {
      request.log.error(error, '获取托管机主列表失败')
      return reply.status(500).send({ error: '获取托管机主列表失败' })
    }
  })

  // GET /api/admin/hosting/zones - 托管专区列表
  app.get('/api/admin/hosting/zones', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (_request, reply) => {
    try {
      const zones = await prisma.hostingZone.findMany({
        include: {
          owner: {
            select: {
              id: true,
              username: true,
              email: true,
              avatarStyle: true,
              avatarBadgeId: true
            }
          }
        },
        orderBy: [
          { sortOrder: 'asc' },
          { id: 'asc' }
        ]
      })

      const zonesWithStats = await attachZoneStats(zones)
      return { zones: zonesWithStats.map(formatZone) }
    } catch (error) {
      app.log.error(error, '获取托管专区列表失败')
      return reply.status(500).send({ error: '获取托管专区列表失败' })
    }
  })

  // POST /api/admin/hosting/zones - 创建托管专区
  app.post<{
    Body: HostingZonePayload
  }>('/api/admin/hosting/zones', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const name = normalizeZoneName(request.body?.name)
    const ownerId = Number(request.body?.ownerId)
    const logoUrl = validateLogoUrl(request.body?.logoUrl)

    if (!name) {
      return reply.status(400).send({ error: '专区名不能为空' })
    }
    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      return reply.status(400).send({ error: '请选择有效的托管机主' })
    }
    if (!logoUrl) {
      return reply.status(400).send({ error: '请填写有效的 http 或 https LOGO 图片链接' })
    }

    try {
      const owner = await getQualifiedOwner(ownerId)
      if (!owner) {
        return reply.status(400).send({ error: '该用户不符合托管机主条件' })
      }
      if (owner.hostingZoneId) {
        return reply.status(400).send({ error: '该托管机主已设置专区' })
      }

      const maxSortRow = await prisma.hostingZone.aggregate({
        _max: { sortOrder: true }
      })
      const zone = await prisma.hostingZone.create({
        data: {
          name,
          ownerId,
          logoUrl,
          sortOrder: (maxSortRow._max.sortOrder ?? 0) + 10
        },
        include: {
          owner: {
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

      await createLog(
        request.user.id,
        'admin',
        'hosting.zone.create',
        `Created hosting zone "${name}" for user #${ownerId}`,
        'success'
      )

      const [zoneWithStats] = await attachZoneStats([zone])
      return { zone: formatZone(zoneWithStats), message: '托管专区创建成功' }
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return reply.status(400).send({ error: '该托管机主已设置专区' })
      }
      request.log.error(error, '创建托管专区失败')
      return reply.status(500).send({ error: '创建托管专区失败' })
    }
  })

  // DELETE /api/admin/hosting/zones/:id - 删除托管专区
  app.delete<{
    Params: { id: string }
  }>('/api/admin/hosting/zones/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const zoneId = Number(request.params.id)
    if (!Number.isInteger(zoneId) || zoneId <= 0) {
      return reply.status(400).send({ error: '无效的专区 ID' })
    }

    try {
      const zone = await prisma.hostingZone.findUnique({
        where: { id: zoneId },
        select: { id: true, name: true, ownerId: true }
      })
      if (!zone) {
        return reply.status(404).send({ error: '托管专区不存在' })
      }

      await prisma.hostingZone.delete({
        where: { id: zoneId }
      })

      await createLog(
        request.user.id,
        'admin',
        'hosting.zone.delete',
        `Deleted hosting zone "${zone.name}" for user #${zone.ownerId}`,
        'success'
      )

      return { message: '托管专区已删除' }
    } catch (error) {
      request.log.error(error, '删除托管专区失败')
      return reply.status(500).send({ error: '删除托管专区失败' })
    }
  })
}
