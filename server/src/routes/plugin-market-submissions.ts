import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { createReadStream } from 'fs'
import { access, mkdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  createPluginMarketSubmission,
  getPluginMarketSubmissionForReview,
  listMyPluginMarketSubmissions,
  listPluginMarketSubmissions,
  reviewPluginMarketSubmission,
  serializePluginMarketSubmission,
  updatePluginMarketSubmissionScan,
  type PluginMarketSubmissionReviewStatus,
  type PluginMarketSubmissionRiskLevel
} from '../db/plugin-market-submissions.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { scanPluginMarketSubmission } from '../lib/plugin-market-submission-scan.js'
import { publishPluginMarketIndex } from '../lib/plugin-market-publisher.js'
import { prisma } from '../db/prisma.js'
import {
  getPluginDataDir,
  getPluginPackageMaxBytes,
  getPluginStagingDir,
  resolveInside,
  validateAndExtractPluginPackage
} from '../lib/plugin-package.js'
import {
  listPluginEventAlertPreferences,
  upsertPluginEventAlertPreference,
  type PluginEventAlertPreferenceInput
} from '../lib/plugin-event-alert-preferences.js'
import { getCombinedAdminIdAllowlist, getPluginSubmissionPublicBaseUrl } from '../lib/runtime-settings.js'

const REVIEW_STATUSES: PluginMarketSubmissionReviewStatus[] = ['pending', 'listed', 'rejected', 'delisted']
const RISK_LEVELS: PluginMarketSubmissionRiskLevel[] = ['low', 'medium', 'high', 'critical']
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

interface SubmissionBody {
  pluginId?: unknown
  version?: unknown
  name?: unknown
  repoUrl?: unknown
  releaseUrl?: unknown
  manifestUrl?: unknown
  packageUrl?: unknown
  sha256?: unknown
  developerName?: unknown
  developerHomepage?: unknown
  developerGithub?: unknown
  contactEmail?: unknown
  permissions?: unknown
  compatibility?: unknown
  pricing?: unknown
  notes?: unknown
}

interface ReviewBody {
  reviewStatus?: unknown
  riskLevel?: unknown
  reviewNotes?: unknown
}

interface ReviewParams {
  id: string
}

interface PluginIdParams {
  pluginId: string
}

interface UploadParams {
  filename: string
}

interface SubmissionQuery {
  reviewStatus?: string
  limit?: string
}

interface DeveloperPluginEventHealth {
  pluginId: string
  total: number
  success: number
  failed: number
  retryPending: number
  deadLetter: number
  deduped: number
  dueRetry: number
  lastEventAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  recentWindowHours: number
  recentTotal: number
  recentSuccess: number
  recentFailed: number
  recentRetryPending: number
  recentDeadLetter: number
  recentDeduped: number
  recentDueRetry: number
  recentSuccessRate: number | null
  trendWindowDays: number
  trend: DeveloperPluginEventHealthTrendPoint[]
  alerts: DeveloperPluginEventHealthAlert[]
  breakdown: DeveloperPluginEventHealthBreakdown[]
}

interface DeveloperPluginEventHealthAlert {
  level: 'warning' | 'critical'
  code: string
  message: string
  count: number
}

interface DeveloperPluginEventHealthTrendPoint {
  date: string
  total: number
  success: number
  failed: number
  retryPending: number
  deadLetter: number
  deduped: number
}

interface DeveloperPluginEventHealthBreakdown {
  eventName: string
  handler: string
  total: number
  success: number
  failed: number
  retryPending: number
  deadLetter: number
  deduped: number
  dueRetry: number
  lastEventAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  recentWindowHours: number
  recentTotal: number
  recentSuccess: number
  recentFailed: number
  recentRetryPending: number
  recentDeadLetter: number
  recentDeduped: number
  recentDueRetry: number
  recentSuccessRate: number | null
  alerts: DeveloperPluginEventHealthAlert[]
}

function getRequestUser(request: FastifyRequest): { id: number; username: string; role: 'admin' | 'user' } {
  return request.user as { id: number; username: string; role: 'admin' | 'user' }
}

async function canManagePluginMarketSubmissions(user: { id: number; username: string; role: 'admin' | 'user' }): Promise<boolean> {
  if (user.role !== 'admin') return false
  const { ids: allowedIds } = await getCombinedAdminIdAllowlist(
    'plugin_manager_allowed_admin_ids',
    ['PLUGIN_MANAGER_ALLOWED_ADMIN_IDS', 'SYSTEM_UPDATE_ALLOWED_ADMIN_IDS']
  )
  if (allowedIds.size > 0) return allowedIds.has(user.id)
  return user.username === 'admin'
}

async function requirePluginMarketReviewer(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = getRequestUser(request)
  if (!(await canManagePluginMarketSubmissions(user))) {
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'plugin.market_submission.review_denied',
      `Denied plugin market submission review access for ${user.username}`,
      LogResult.WARNING
    )
    reply.code(403).send({ error: 'Super administrator privileges required', code: 'SUPER_ADMIN_REQUIRED' })
    return false
  }
  return true
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return normalizeText(value, maxLength)
}

function normalizeHttpsUrl(value: unknown): string | null {
  const text = normalizeText(value, 2048)
  if (!text) return null
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function normalizeOptionalHttpsUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return normalizeHttpsUrl(value)
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeSubmissionBody(body: SubmissionBody) {
  const pluginId = normalizeText(body.pluginId, 120)
  const version = normalizeText(body.version, 64)
  const name = normalizeText(body.name, 120)
  const repoUrl = normalizeHttpsUrl(body.repoUrl)
  const releaseUrl = normalizeHttpsUrl(body.releaseUrl)
  const manifestUrl = normalizeHttpsUrl(body.manifestUrl)
  const packageUrl = normalizeHttpsUrl(body.packageUrl)
  const sha256 = normalizeText(body.sha256, 64)?.toLowerCase() ?? null
  const developerName = normalizeText(body.developerName, 120)
  const contactEmail = normalizeText(body.contactEmail, 254)
  const developerHomepage = normalizeOptionalHttpsUrl(body.developerHomepage)
  const developerGithub = normalizeOptionalHttpsUrl(body.developerGithub)
  const notes = normalizeOptionalText(body.notes, 5000)

  if (!pluginId || !PLUGIN_ID_PATTERN.test(pluginId)) throw new Error('Invalid plugin id')
  if (!version || !VERSION_PATTERN.test(version)) throw new Error('Invalid plugin version')
  if (!name) throw new Error('Invalid plugin name')
  if (!repoUrl || !releaseUrl || !manifestUrl || !packageUrl) throw new Error('Submission URLs must be HTTPS')
  if (!sha256 || !SHA256_PATTERN.test(sha256)) throw new Error('Invalid package SHA256')
  if (!developerName) throw new Error('Invalid developer name')
  if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('Invalid contact email')

  return {
    pluginId,
    version,
    name,
    repoUrl,
    releaseUrl,
    manifestUrl,
    packageUrl,
    sha256,
    developerName,
    developerHomepage,
    developerGithub,
    contactEmail,
    permissions: normalizeJsonRecord(body.permissions),
    compatibility: normalizeJsonRecord(body.compatibility),
    pricing: normalizeJsonRecord(body.pricing),
    notes
  }
}

function parsePositiveId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseLimit(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 100
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.min(parsed, 200) : 100
}

function normalizeReviewStatus(value: unknown): PluginMarketSubmissionReviewStatus | null {
  return typeof value === 'string' && REVIEW_STATUSES.includes(value as PluginMarketSubmissionReviewStatus)
    ? value as PluginMarketSubmissionReviewStatus
    : null
}

function getPluginSubmissionUploadDir(): string {
  return join(getPluginDataDir(), 'submission-uploads', 'plugins')
}

function getPluginSubmissionUploadTempDir(): string {
  return join(getPluginStagingDir(), 'submission-uploads')
}

function normalizeUploadFilename(value: string): string | null {
  const trimmed = value.trim()
  return /^[a-z][a-z0-9.-]{2,180}\.(?:tar\.gz|plugin\.json)$/.test(trimmed) ? trimmed : null
}

async function publicBaseUrlFromRequest(request: FastifyRequest): Promise<string> {
  return getPluginSubmissionPublicBaseUrl(`${request.protocol}://${request.hostname}`)
}

async function buildPublicUploadUrl(request: FastifyRequest, filename: string): Promise<string> {
  const publicBaseUrl = await publicBaseUrlFromRequest(request)
  return `${publicBaseUrl}/api/plugin-market-submissions/uploads/plugins/${encodeURIComponent(filename)}`
}

function submissionUploadTaskId(): number {
  return Math.floor(Date.now() % 1_000_000_000) * 1000 + Math.floor(Math.random() * 1000)
}

async function receiveUploadedPluginPackage(request: FastifyRequest): Promise<{ packagePath: string; sourceName: string }> {
  const multipartRequest = request as FastifyRequest & {
    parts: () => AsyncIterable<any>
  }
  const uploadTempDir = getPluginSubmissionUploadTempDir()
  await mkdir(uploadTempDir, { recursive: true })
  const maxBytes = getPluginPackageMaxBytes()

  for await (const part of multipartRequest.parts()) {
    if (part.type !== 'file') continue
    if (part.fieldname !== 'package') {
      await part.toBuffer()
      continue
    }
    const sourceName = String(part.filename || 'plugin.tar.gz')
    if (!sourceName.endsWith('.tar.gz')) {
      throw new Error('Plugin package must be a .tar.gz file')
    }
    const buffer = await part.toBuffer()
    if (buffer.length === 0) throw new Error('Plugin package is empty')
    if (buffer.length > maxBytes) throw new Error(`Plugin package exceeds ${Math.round(maxBytes / 1024 / 1024)}MB`)
    const packagePath = join(uploadTempDir, `${Date.now()}-${randomUUID()}.tar.gz`)
    await writeFile(packagePath, buffer, { mode: 0o600 })
    return { packagePath, sourceName }
  }

  throw new Error('Missing plugin package file')
}

function normalizeRiskLevel(value: unknown): PluginMarketSubmissionRiskLevel | null {
  return typeof value === 'string' && RISK_LEVELS.includes(value as PluginMarketSubmissionRiskLevel)
    ? value as PluginMarketSubmissionRiskLevel
    : null
}

function calculateSuccessRate(success: number, total: number): number | null {
  if (total <= 0) return null
  return Math.round((success / total) * 1000) / 10
}

function buildDeveloperEventTrend(logs: Array<{ result: string; createdAt: Date; lastAttemptAt: Date | null }>, now: Date, days: number): DeveloperPluginEventHealthTrendPoint[] {
  const dayMs = 24 * 60 * 60 * 1000
  const points = Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getTime() - (days - index - 1) * dayMs).toISOString().slice(0, 10)
    return { date, total: 0, success: 0, failed: 0, retryPending: 0, deadLetter: 0, deduped: 0 }
  })
  const byDate = new Map(points.map(point => [point.date, point]))
  for (const log of logs) {
    const date = (log.lastAttemptAt || log.createdAt).toISOString().slice(0, 10)
    const point = byDate.get(date)
    if (!point) continue
    point.total += 1
    if (log.result === 'success') point.success += 1
    if (log.result === 'failed') point.failed += 1
    if (log.result === 'retry_pending') point.retryPending += 1
    if (log.result === 'dead_letter') point.deadLetter += 1
    if (log.result === 'duplicate_skipped') point.deduped += 1
  }
  return points
}

function buildDeveloperEventAlerts(input: {
  deadLetter: number
  dueRetry: number
  recentTotal: number
  recentFailed: number
  recentRetryPending: number
  recentDeadLetter: number
  recentSuccessRate: number | null
}): DeveloperPluginEventHealthAlert[] {
  const alerts: DeveloperPluginEventHealthAlert[] = []
  if (input.deadLetter > 0) {
    alerts.push({
      level: 'critical',
      code: 'dead_letter',
      message: 'Event deliveries have reached dead letter state.',
      count: input.deadLetter
    })
  }
  if (input.dueRetry > 0) {
    alerts.push({
      level: 'critical',
      code: 'due_retry',
      message: 'Event deliveries are due for retry.',
      count: input.dueRetry
    })
  }
  if (input.recentDeadLetter > 0) {
    alerts.push({
      level: 'critical',
      code: 'recent_dead_letter',
      message: 'Dead letter events occurred in the recent window.',
      count: input.recentDeadLetter
    })
  }
  if (input.recentRetryPending > 0) {
    alerts.push({
      level: 'warning',
      code: 'recent_retry_pending',
      message: 'Recent event deliveries are waiting for retry.',
      count: input.recentRetryPending
    })
  }
  if (input.recentFailed > 0) {
    alerts.push({
      level: 'warning',
      code: 'recent_failed',
      message: 'Recent event deliveries failed before retry handling.',
      count: input.recentFailed
    })
  }
  if (input.recentTotal >= 10 && input.recentSuccessRate !== null && input.recentSuccessRate < 95) {
    alerts.push({
      level: 'warning',
      code: 'recent_success_rate_low',
      message: 'Recent event delivery success rate is below 95%.',
      count: input.recentTotal
    })
  }
  return alerts.slice(0, 8)
}

async function buildDeveloperPluginEventHealth(userId: number): Promise<DeveloperPluginEventHealth[]> {
  const submissions = await prisma.pluginMarketSubmission.findMany({
    where: { submittedByUserId: userId },
    select: { pluginId: true },
    distinct: ['pluginId'],
    orderBy: { pluginId: 'asc' }
  })
  const pluginIds = submissions.map(submission => submission.pluginId)
  if (pluginIds.length === 0) return []
  const now = new Date()
  const recentWindowHours = 24
  const recentSince = new Date(now.getTime() - recentWindowHours * 60 * 60 * 1000)
  const trendWindowDays = 7
  const trendSince = new Date(now.getTime() - trendWindowDays * 24 * 60 * 60 * 1000)

  return await Promise.all(pluginIds.map(async pluginId => {
    const baseWhere = { pluginId, action: 'plugin.event.dispatch' }
    const recentWhere = {
      ...baseWhere,
      OR: [
        { lastAttemptAt: { gte: recentSince } },
        { lastAttemptAt: null, createdAt: { gte: recentSince } }
      ]
    }
    const [
      total,
      success,
      failed,
      retryPending,
      deadLetter,
      deduped,
      dueRetry,
      recentTotal,
      recentSuccess,
      recentFailed,
      recentRetryPending,
      recentDeadLetter,
      recentDeduped,
      recentDueRetry,
      trendLogs,
      latest,
      latestSuccess,
      latestFailure
    ] = await Promise.all([
      prisma.pluginEventLog.count({ where: baseWhere }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'success' } }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'failed' } }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'retry_pending' } }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'dead_letter' } }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'duplicate_skipped' } }),
      prisma.pluginEventLog.count({ where: { ...baseWhere, result: 'retry_pending', deadLetterAt: null, nextRetryAt: { lte: now } } }),
      prisma.pluginEventLog.count({ where: recentWhere }),
      prisma.pluginEventLog.count({ where: { ...recentWhere, result: 'success' } }),
      prisma.pluginEventLog.count({ where: { ...recentWhere, result: 'failed' } }),
      prisma.pluginEventLog.count({ where: { ...recentWhere, result: 'retry_pending' } }),
      prisma.pluginEventLog.count({ where: { ...recentWhere, result: 'dead_letter' } }),
      prisma.pluginEventLog.count({ where: { ...recentWhere, result: 'duplicate_skipped' } }),
      prisma.pluginEventLog.count({ where: { ...recentWhere, result: 'retry_pending', deadLetterAt: null, nextRetryAt: { lte: now } } }),
      prisma.pluginEventLog.findMany({
        where: {
          ...baseWhere,
          OR: [
            { lastAttemptAt: { gte: trendSince } },
            { lastAttemptAt: null, createdAt: { gte: trendSince } }
          ]
        },
        select: { result: true, createdAt: true, lastAttemptAt: true }
      }),
      prisma.pluginEventLog.findFirst({ where: baseWhere, orderBy: [{ lastAttemptAt: 'desc' }, { createdAt: 'desc' }] }),
      prisma.pluginEventLog.findFirst({ where: { ...baseWhere, result: 'success' }, orderBy: [{ lastAttemptAt: 'desc' }, { createdAt: 'desc' }] }),
      prisma.pluginEventLog.findFirst({ where: { ...baseWhere, result: { in: ['failed', 'retry_pending', 'dead_letter'] } }, orderBy: [{ lastAttemptAt: 'desc' }, { createdAt: 'desc' }] })
    ])
    const pairs = await prisma.pluginEventLog.findMany({
      where: {
        ...baseWhere,
        eventName: { not: null },
        handler: { not: null }
      },
      distinct: ['eventName', 'handler'],
      select: { eventName: true, handler: true },
      orderBy: [{ eventName: 'asc' }, { handler: 'asc' }]
    })
    const breakdown = await Promise.all(pairs.slice(0, 50).map(async pair => {
      const eventName = pair.eventName || ''
      const handler = pair.handler || ''
      const scopedWhere = { ...baseWhere, eventName, handler }
      const scopedRecentWhere = { ...recentWhere, eventName, handler }
      const [
        itemTotal,
        itemSuccess,
        itemFailed,
        itemRetryPending,
        itemDeadLetter,
        itemDeduped,
        itemDueRetry,
        itemRecentTotal,
        itemRecentSuccess,
        itemRecentFailed,
        itemRecentRetryPending,
        itemRecentDeadLetter,
        itemRecentDeduped,
        itemRecentDueRetry,
        itemLatest,
        itemLatestSuccess,
        itemLatestFailure
      ] = await Promise.all([
        prisma.pluginEventLog.count({ where: scopedWhere }),
        prisma.pluginEventLog.count({ where: { ...scopedWhere, result: 'success' } }),
        prisma.pluginEventLog.count({ where: { ...scopedWhere, result: 'failed' } }),
        prisma.pluginEventLog.count({ where: { ...scopedWhere, result: 'retry_pending' } }),
        prisma.pluginEventLog.count({ where: { ...scopedWhere, result: 'dead_letter' } }),
        prisma.pluginEventLog.count({ where: { ...scopedWhere, result: 'duplicate_skipped' } }),
        prisma.pluginEventLog.count({ where: { ...scopedWhere, result: 'retry_pending', deadLetterAt: null, nextRetryAt: { lte: now } } }),
        prisma.pluginEventLog.count({ where: scopedRecentWhere }),
        prisma.pluginEventLog.count({ where: { ...scopedRecentWhere, result: 'success' } }),
        prisma.pluginEventLog.count({ where: { ...scopedRecentWhere, result: 'failed' } }),
        prisma.pluginEventLog.count({ where: { ...scopedRecentWhere, result: 'retry_pending' } }),
        prisma.pluginEventLog.count({ where: { ...scopedRecentWhere, result: 'dead_letter' } }),
        prisma.pluginEventLog.count({ where: { ...scopedRecentWhere, result: 'duplicate_skipped' } }),
        prisma.pluginEventLog.count({ where: { ...scopedRecentWhere, result: 'retry_pending', deadLetterAt: null, nextRetryAt: { lte: now } } }),
        prisma.pluginEventLog.findFirst({ where: scopedWhere, orderBy: [{ lastAttemptAt: 'desc' }, { createdAt: 'desc' }] }),
        prisma.pluginEventLog.findFirst({ where: { ...scopedWhere, result: 'success' }, orderBy: [{ lastAttemptAt: 'desc' }, { createdAt: 'desc' }] }),
        prisma.pluginEventLog.findFirst({ where: { ...scopedWhere, result: { in: ['failed', 'retry_pending', 'dead_letter'] } }, orderBy: [{ lastAttemptAt: 'desc' }, { createdAt: 'desc' }] })
      ])
      const itemRecentSuccessRate = calculateSuccessRate(itemRecentSuccess, itemRecentTotal)

      return {
        eventName,
        handler,
        total: itemTotal,
        success: itemSuccess,
        failed: itemFailed,
        retryPending: itemRetryPending,
        deadLetter: itemDeadLetter,
        deduped: itemDeduped,
        dueRetry: itemDueRetry,
        lastEventAt: (itemLatest?.lastAttemptAt || itemLatest?.createdAt)?.toISOString() || null,
        lastSuccessAt: (itemLatestSuccess?.lastAttemptAt || itemLatestSuccess?.createdAt)?.toISOString() || null,
        lastFailureAt: (itemLatestFailure?.lastAttemptAt || itemLatestFailure?.createdAt)?.toISOString() || null,
        lastError: itemLatestFailure?.lastError || itemLatestFailure?.message || null,
        recentWindowHours,
        recentTotal: itemRecentTotal,
        recentSuccess: itemRecentSuccess,
        recentFailed: itemRecentFailed,
        recentRetryPending: itemRecentRetryPending,
        recentDeadLetter: itemRecentDeadLetter,
        recentDeduped: itemRecentDeduped,
        recentDueRetry: itemRecentDueRetry,
        recentSuccessRate: itemRecentSuccessRate,
        alerts: buildDeveloperEventAlerts({
          deadLetter: itemDeadLetter,
          dueRetry: itemDueRetry,
          recentTotal: itemRecentTotal,
          recentFailed: itemRecentFailed,
          recentRetryPending: itemRecentRetryPending,
          recentDeadLetter: itemRecentDeadLetter,
          recentSuccessRate: itemRecentSuccessRate
        })
      }
    }))
    const recentSuccessRate = calculateSuccessRate(recentSuccess, recentTotal)

    return {
      pluginId,
      total,
      success,
      failed,
      retryPending,
      deadLetter,
      deduped,
      dueRetry,
      lastEventAt: (latest?.lastAttemptAt || latest?.createdAt)?.toISOString() || null,
      lastSuccessAt: (latestSuccess?.lastAttemptAt || latestSuccess?.createdAt)?.toISOString() || null,
      lastFailureAt: (latestFailure?.lastAttemptAt || latestFailure?.createdAt)?.toISOString() || null,
      lastError: latestFailure?.lastError || latestFailure?.message || null,
      recentWindowHours,
      recentTotal,
      recentSuccess,
      recentFailed,
      recentRetryPending,
      recentDeadLetter,
      recentDeduped,
      recentDueRetry,
      recentSuccessRate,
      trendWindowDays,
      trend: buildDeveloperEventTrend(trendLogs, now, trendWindowDays),
      alerts: buildDeveloperEventAlerts({
        deadLetter,
        dueRetry,
        recentTotal,
        recentFailed,
        recentRetryPending,
        recentDeadLetter,
        recentSuccessRate
      }),
      breakdown
    }
  }))
}

async function listSubmittedPluginIds(userId: number): Promise<string[]> {
  const submissions = await prisma.pluginMarketSubmission.findMany({
    where: { submittedByUserId: userId },
    select: { pluginId: true },
    distinct: ['pluginId'],
    orderBy: { pluginId: 'asc' }
  })
  return submissions.map(submission => submission.pluginId)
}

export default async function pluginMarketSubmissionRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Params: UploadParams
  }>('/uploads/plugins/:filename', async (request, reply) => {
    const filename = normalizeUploadFilename(request.params.filename)
    if (!filename) return reply.code(404).send({ error: 'Upload not found', code: 'PLUGIN_UPLOAD_NOT_FOUND' })
    const uploadDir = getPluginSubmissionUploadDir()
    const filePath = resolveInside(uploadDir, filename)
    try {
      await access(filePath)
    } catch {
      return reply.code(404).send({ error: 'Upload not found', code: 'PLUGIN_UPLOAD_NOT_FOUND' })
    }
    if (filename.endsWith('.tar.gz')) {
      reply.header('Content-Type', 'application/gzip')
      reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    } else {
      reply.header('Content-Type', 'application/json; charset=utf-8')
    }
    reply.header('X-Content-Type-Options', 'nosniff')
    return reply.send(createReadStream(filePath))
  })

  fastify.post('/upload-package', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = getRequestUser(request)
    let packagePath: string | null = null
    let stagingDir: string | null = null
    try {
      const upload = await receiveUploadedPluginPackage(request)
      packagePath = upload.packagePath
      const validated = await validateAndExtractPluginPackage(packagePath, submissionUploadTaskId())
      stagingDir = validated.stagingDir

      const suffix = `${validated.sha256.slice(0, 12)}-${randomUUID().slice(0, 8)}`
      const baseName = `${validated.manifest.id}-${validated.manifest.version}-${suffix}`
      const packageFilename = `${baseName}.tar.gz`
      const manifestFilename = `${baseName}.plugin.json`
      const uploadDir = getPluginSubmissionUploadDir()
      await mkdir(uploadDir, { recursive: true })
      const finalPackagePath = resolveInside(uploadDir, packageFilename)
      const finalManifestPath = resolveInside(uploadDir, manifestFilename)
      await rename(packagePath, finalPackagePath)
      packagePath = null
      await writeFile(finalManifestPath, `${JSON.stringify(validated.manifest, null, 2)}\n`, { mode: 0o644 })

      await createLog(
        user.id,
        LogModule.PLUGIN,
        'plugin.market_submission.upload_package',
        `Uploaded plugin market package ${validated.manifest.id}@${validated.manifest.version} (${validated.sha256})`,
        LogResult.SUCCESS
      )

      return reply.code(201).send({
        upload: {
          pluginId: validated.manifest.id,
          version: validated.manifest.version,
          name: validated.manifest.name,
          packageUrl: await buildPublicUploadUrl(request, packageFilename),
          manifestUrl: await buildPublicUploadUrl(request, manifestFilename),
          sha256: validated.sha256,
          permissions: {
            manifest: validated.manifest.permissions || [],
            events: (validated.manifest.capabilities?.events || []).map(event => event.event),
            actions: (validated.manifest.capabilities?.actions || []).map(action => action.name)
          },
          compatibility: { payincus: validated.manifest.payincus },
          sourceName: upload.sourceName
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'plugin.market_submission.upload_failed',
        `Plugin market package upload failed: ${message}`,
        LogResult.WARNING
      ).catch(() => undefined)
      return reply.code(400).send({ error: message, code: 'PLUGIN_SUBMISSION_UPLOAD_INVALID' })
    } finally {
      if (packagePath) await rm(packagePath, { force: true }).catch(() => undefined)
      if (stagingDir) await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  fastify.post<{
    Body: SubmissionBody
  }>('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = getRequestUser(request)

    try {
      const normalized = normalizeSubmissionBody(request.body || {})
      const submission = await createPluginMarketSubmission({
        ...normalized,
        submittedByUserId: user.id
      })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'plugin.market_submission.create',
        `Submitted plugin market review ${normalized.pluginId}@${normalized.version}`,
        LogResult.SUCCESS
      )
      return reply.code(201).send({ submission: serializePluginMarketSubmission(submission) })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ error: 'Plugin version is already submitted', code: 'PLUGIN_SUBMISSION_EXISTS' })
      }
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'PLUGIN_SUBMISSION_INVALID' })
    }
  })

  fastify.get('/mine', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = getRequestUser(request)
    const submissions = await listMyPluginMarketSubmissions(user.id)
    return { submissions: submissions.map(serializePluginMarketSubmission) }
  })

  fastify.get('/mine/event-health', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = getRequestUser(request)
    return {
      plugins: await buildDeveloperPluginEventHealth(user.id),
      updatedAt: new Date().toISOString()
    }
  })

  fastify.get('/mine/event-alert-preferences', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = getRequestUser(request)
    const pluginIds = await listSubmittedPluginIds(user.id)
    return {
      preferences: await listPluginEventAlertPreferences(user.id, pluginIds),
      updatedAt: new Date().toISOString()
    }
  })

  fastify.patch<{
    Params: PluginIdParams
    Body: PluginEventAlertPreferenceInput
  }>('/mine/event-alert-preferences/:pluginId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = getRequestUser(request)
    const pluginId = normalizeText(request.params.pluginId, 120)
    if (!pluginId || !PLUGIN_ID_PATTERN.test(pluginId)) {
      return reply.code(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' })
    }
    const submitted = await prisma.pluginMarketSubmission.findFirst({
      where: { submittedByUserId: user.id, pluginId },
      select: { id: true }
    })
    if (!submitted) {
      return reply.code(404).send({ error: 'Plugin submission not found', code: 'PLUGIN_SUBMISSION_NOT_FOUND' })
    }
    const preference = await upsertPluginEventAlertPreference(user.id, pluginId, request.body || {})
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'plugin.event.alert_preference_update',
      `Updated plugin event alert preference for ${pluginId}`,
      LogResult.SUCCESS
    )
    return { preference }
  })

  fastify.get<{
    Querystring: SubmissionQuery
  }>('/admin', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginMarketReviewer(request, reply))) return
    let reviewStatus: PluginMarketSubmissionReviewStatus | undefined
    if (request.query.reviewStatus) {
      const normalizedReviewStatus = normalizeReviewStatus(request.query.reviewStatus)
      if (!normalizedReviewStatus) {
        return reply.code(400).send({ error: 'Invalid review status', code: 'INVALID_REVIEW_STATUS' })
      }
      reviewStatus = normalizedReviewStatus
    }
    if (request.query.reviewStatus && !reviewStatus) {
      return reply.code(400).send({ error: 'Invalid review status', code: 'INVALID_REVIEW_STATUS' })
    }
    const submissions = await listPluginMarketSubmissions({
      reviewStatus,
      limit: parseLimit(request.query.limit)
    })
    return { submissions: submissions.map(serializePluginMarketSubmission) }
  })

  fastify.patch<{
    Params: ReviewParams
    Body: ReviewBody
  }>('/admin/:id/review', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginMarketReviewer(request, reply))) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid submission id', code: 'INVALID_SUBMISSION_ID' })

    const reviewStatus = normalizeReviewStatus(request.body?.reviewStatus)
    const riskLevel = normalizeRiskLevel(request.body?.riskLevel) ?? 'medium'
    const reviewNotes = normalizeOptionalText(request.body?.reviewNotes, 5000)
    if (!reviewStatus) {
      return reply.code(400).send({ error: 'Invalid review status', code: 'INVALID_REVIEW_STATUS' })
    }

    try {
      const user = getRequestUser(request)
      const submission = await reviewPluginMarketSubmission({
        id,
        reviewStatus,
        riskLevel,
        reviewNotes,
        reviewedByUserId: user.id
      })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'plugin.market_submission.review',
        `Reviewed plugin market submission ${submission.pluginId}@${submission.version}: ${reviewStatus}/${riskLevel}`,
        LogResult.SUCCESS
      )
      return { submission: serializePluginMarketSubmission(submission) }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ error: 'Submission not found', code: 'PLUGIN_SUBMISSION_NOT_FOUND' })
      }
      throw error
    }
  })

  fastify.post<{
    Params: ReviewParams
  }>('/admin/:id/scan', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginMarketReviewer(request, reply))) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid submission id', code: 'INVALID_SUBMISSION_ID' })

    const submission = await getPluginMarketSubmissionForReview(id)
    if (!submission) {
      return reply.code(404).send({ error: 'Submission not found', code: 'PLUGIN_SUBMISSION_NOT_FOUND' })
    }

    const result = await scanPluginMarketSubmission({
      id: submission.id,
      pluginId: submission.pluginId,
      version: submission.version,
      name: submission.name,
      manifestUrl: submission.manifestUrl,
      packageUrl: submission.packageUrl,
      sha256: submission.sha256,
      permissions: submission.permissions,
      compatibility: submission.compatibility,
      pricing: submission.pricing
    })

    const updated = await updatePluginMarketSubmissionScan({
      id: submission.id,
      scanStatus: result.status,
      scanResult: result as unknown as Record<string, unknown>,
      riskLevel: result.riskLevel
    })

    const user = getRequestUser(request)
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'plugin.market_submission.scan',
      `Scanned plugin market submission ${submission.pluginId}@${submission.version}: ${result.status}/${result.riskLevel}`,
      result.status === 'failed' ? LogResult.WARNING : LogResult.SUCCESS
    )

    return { submission: serializePluginMarketSubmission(updated), scan: result }
  })

  fastify.post('/admin/publish-market-index', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requirePluginMarketReviewer(request, reply))) return
    const result = await publishPluginMarketIndex()
    const user = getRequestUser(request)
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'plugin.market_submission.publish_index',
      `Published plugin market index to ${result.indexPath}: ${result.publishedEntries}/${result.totalEntries}`,
      LogResult.SUCCESS
    )
    return { result }
  })
}
