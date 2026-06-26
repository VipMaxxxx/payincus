import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import {
  createThemeMarketSubmission,
  getThemeMarketSubmissionForReview,
  listMyThemeMarketSubmissions,
  listThemeMarketSubmissions,
  reviewThemeMarketSubmission,
  serializeThemeMarketSubmission,
  updateThemeMarketSubmissionScan,
  type ThemeMarketSubmissionReviewStatus,
  type ThemeMarketSubmissionRiskLevel
} from '../db/theme-market-submissions.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import { scanThemeMarketSubmission } from '../lib/theme-market-submission-scan.js'
import { publishThemeMarketIndex } from '../lib/theme-market-publisher.js'
import { getCombinedAdminIdAllowlist } from '../lib/runtime-settings.js'

const REVIEW_STATUSES: ThemeMarketSubmissionReviewStatus[] = ['pending', 'listed', 'rejected', 'delisted']
const RISK_LEVELS: ThemeMarketSubmissionRiskLevel[] = ['low', 'medium', 'high', 'critical']
const THEME_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

interface SubmissionBody {
  themeId?: unknown
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
  compatibility?: unknown
  tokens?: unknown
  layoutSlots?: unknown
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

interface SubmissionQuery {
  reviewStatus?: string
  limit?: string
}

function getRequestUser(request: FastifyRequest): { id: number; username: string; role: 'admin' | 'user' } {
  return request.user as { id: number; username: string; role: 'admin' | 'user' }
}

async function canManageThemeMarketSubmissions(user: { id: number; username: string; role: 'admin' | 'user' }): Promise<boolean> {
  if (user.role !== 'admin') return false
  const themeAllowlist = await getCombinedAdminIdAllowlist(
    'theme_manager_allowed_admin_ids',
    'THEME_MANAGER_ALLOWED_ADMIN_IDS'
  )
  const pluginAllowlist = await getCombinedAdminIdAllowlist(
    'plugin_manager_allowed_admin_ids',
    ['PLUGIN_MANAGER_ALLOWED_ADMIN_IDS', 'SYSTEM_UPDATE_ALLOWED_ADMIN_IDS']
  )
  const allowedIds = new Set([...themeAllowlist.ids, ...pluginAllowlist.ids])
  if (allowedIds.size > 0) return allowedIds.has(user.id)
  return user.username === 'admin'
}

async function requireThemeMarketReviewer(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = getRequestUser(request)
  if (!(await canManageThemeMarketSubmissions(user))) {
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'theme.market_submission.review_denied',
      `Denied theme market submission review access for ${user.username}`,
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

function normalizeStringArray(value: unknown, maxItems = 80, maxLength = 120): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .slice(0, maxItems)
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(item => item && item.length <= maxLength)
  ))
}

function normalizeSubmissionBody(body: SubmissionBody) {
  const themeId = normalizeText(body.themeId, 120)
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

  if (!themeId || !THEME_ID_PATTERN.test(themeId)) throw new Error('Invalid theme id')
  if (!version || !VERSION_PATTERN.test(version)) throw new Error('Invalid theme version')
  if (!name) throw new Error('Invalid theme name')
  if (!repoUrl || !releaseUrl || !manifestUrl || !packageUrl) throw new Error('Submission URLs must be HTTPS')
  if (!sha256 || !SHA256_PATTERN.test(sha256)) throw new Error('Invalid package SHA256')
  if (!developerName) throw new Error('Invalid developer name')
  if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('Invalid contact email')

  return {
    themeId,
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
    compatibility: normalizeJsonRecord(body.compatibility),
    tokens: normalizeStringArray(body.tokens),
    layoutSlots: normalizeStringArray(body.layoutSlots),
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

function normalizeReviewStatus(value: unknown): ThemeMarketSubmissionReviewStatus | null {
  return typeof value === 'string' && REVIEW_STATUSES.includes(value as ThemeMarketSubmissionReviewStatus)
    ? value as ThemeMarketSubmissionReviewStatus
    : null
}

function normalizeRiskLevel(value: unknown): ThemeMarketSubmissionRiskLevel | null {
  return typeof value === 'string' && RISK_LEVELS.includes(value as ThemeMarketSubmissionRiskLevel)
    ? value as ThemeMarketSubmissionRiskLevel
    : null
}

export default async function themeMarketSubmissionRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: SubmissionBody }>('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = getRequestUser(request)

    try {
      const normalized = normalizeSubmissionBody(request.body || {})
      const submission = await createThemeMarketSubmission({
        ...normalized,
        submittedByUserId: user.id
      })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'theme.market_submission.create',
        `Submitted theme market review ${normalized.themeId}@${normalized.version}`,
        LogResult.SUCCESS
      )
      return reply.code(201).send({ submission: serializeThemeMarketSubmission(submission) })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ error: 'Theme version is already submitted', code: 'THEME_SUBMISSION_EXISTS' })
      }
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message, code: 'THEME_SUBMISSION_INVALID' })
    }
  })

  fastify.get('/mine', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = getRequestUser(request)
    const submissions = await listMyThemeMarketSubmissions(user.id)
    return { submissions: submissions.map(serializeThemeMarketSubmission) }
  })

  fastify.get<{ Querystring: SubmissionQuery }>('/admin', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeMarketReviewer(request, reply))) return
    let reviewStatus: ThemeMarketSubmissionReviewStatus | undefined
    if (request.query.reviewStatus) {
      const normalizedReviewStatus = normalizeReviewStatus(request.query.reviewStatus)
      if (!normalizedReviewStatus) return reply.code(400).send({ error: 'Invalid review status', code: 'INVALID_REVIEW_STATUS' })
      reviewStatus = normalizedReviewStatus
    }
    const submissions = await listThemeMarketSubmissions({
      reviewStatus,
      limit: parseLimit(request.query.limit)
    })
    return { submissions: submissions.map(serializeThemeMarketSubmission) }
  })

  fastify.patch<{ Params: ReviewParams; Body: ReviewBody }>('/admin/:id/review', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeMarketReviewer(request, reply))) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid submission id', code: 'INVALID_SUBMISSION_ID' })

    const reviewStatus = normalizeReviewStatus(request.body?.reviewStatus)
    const riskLevel = normalizeRiskLevel(request.body?.riskLevel) ?? 'medium'
    const reviewNotes = normalizeOptionalText(request.body?.reviewNotes, 5000)
    if (!reviewStatus) return reply.code(400).send({ error: 'Invalid review status', code: 'INVALID_REVIEW_STATUS' })

    try {
      const user = getRequestUser(request)
      const submission = await reviewThemeMarketSubmission({
        id,
        reviewStatus,
        riskLevel,
        reviewNotes,
        reviewedByUserId: user.id
      })
      await createLog(
        user.id,
        LogModule.PLUGIN,
        'theme.market_submission.review',
        `Reviewed theme market submission ${submission.themeId}@${submission.version}: ${reviewStatus}/${riskLevel}`,
        LogResult.SUCCESS
      )
      return { submission: serializeThemeMarketSubmission(submission) }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ error: 'Submission not found', code: 'THEME_SUBMISSION_NOT_FOUND' })
      }
      throw error
    }
  })

  fastify.post<{ Params: ReviewParams }>('/admin/:id/scan', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeMarketReviewer(request, reply))) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid submission id', code: 'INVALID_SUBMISSION_ID' })

    const submission = await getThemeMarketSubmissionForReview(id)
    if (!submission) return reply.code(404).send({ error: 'Submission not found', code: 'THEME_SUBMISSION_NOT_FOUND' })

    const result = await scanThemeMarketSubmission({
      id: submission.id,
      themeId: submission.themeId,
      version: submission.version,
      name: submission.name,
      manifestUrl: submission.manifestUrl,
      packageUrl: submission.packageUrl,
      sha256: submission.sha256,
      compatibility: submission.compatibility,
      tokens: submission.tokens,
      layoutSlots: submission.layoutSlots
    })

    const updated = await updateThemeMarketSubmissionScan({
      id: submission.id,
      scanStatus: result.status,
      scanResult: result as unknown as Record<string, unknown>,
      riskLevel: result.riskLevel
    })

    const user = getRequestUser(request)
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'theme.market_submission.scan',
      `Scanned theme market submission ${submission.themeId}@${submission.version}: ${result.status}/${result.riskLevel}`,
      result.status === 'failed' ? LogResult.WARNING : LogResult.SUCCESS
    )

    return { submission: serializeThemeMarketSubmission(updated), scan: result }
  })

  fastify.post('/admin/publish-market-index', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request, reply) => {
    if (!(await requireThemeMarketReviewer(request, reply))) return
    const result = await publishThemeMarketIndex()
    const user = getRequestUser(request)
    await createLog(
      user.id,
      LogModule.PLUGIN,
      'theme.market_submission.publish_index',
      `Published theme market index to ${result.indexPath}: ${result.publishedEntries}/${result.totalEntries}`,
      LogResult.SUCCESS
    )
    return { result }
  })
}
