import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

export type ThemeMarketSubmissionReviewStatus = 'pending' | 'listed' | 'rejected' | 'delisted'
export type ThemeMarketSubmissionRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface CreateThemeMarketSubmissionInput {
  themeId: string
  version: string
  name: string
  repoUrl: string
  releaseUrl: string
  manifestUrl: string
  packageUrl: string
  sha256: string
  developerName: string
  developerHomepage?: string | null
  developerGithub?: string | null
  contactEmail: string
  compatibility: Record<string, unknown>
  tokens: string[]
  layoutSlots: string[]
  notes?: string | null
  submittedByUserId: number
}

export interface SerializedThemeMarketSubmission {
  id: number
  themeId: string
  version: string
  name: string
  repoUrl: string
  releaseUrl: string
  manifestUrl: string
  packageUrl: string
  sha256: string
  developerName: string
  developerHomepage: string | null
  developerGithub: string | null
  contactEmail: string
  compatibility: unknown
  tokens: unknown
  layoutSlots: unknown
  notes: string | null
  reviewStatus: string
  riskLevel: string
  reviewNotes: string | null
  scanStatus: string
  scanResult: unknown
  scannedAt: string | null
  submittedByUserId: number
  submittedByUsername: string | null
  reviewedByUserId: number | null
  reviewedByUsername: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

type ThemeMarketSubmissionWithUsers = Prisma.ThemeMarketSubmissionGetPayload<{}> & {
  submittedBy?: { username: string } | null
  reviewedBy?: { username: string } | null
}

export function serializeThemeMarketSubmission(submission: ThemeMarketSubmissionWithUsers): SerializedThemeMarketSubmission {
  return {
    id: submission.id,
    themeId: submission.themeId,
    version: submission.version,
    name: submission.name,
    repoUrl: submission.repoUrl,
    releaseUrl: submission.releaseUrl,
    manifestUrl: submission.manifestUrl,
    packageUrl: submission.packageUrl,
    sha256: submission.sha256,
    developerName: submission.developerName,
    developerHomepage: submission.developerHomepage,
    developerGithub: submission.developerGithub,
    contactEmail: submission.contactEmail,
    compatibility: submission.compatibility,
    tokens: submission.tokens,
    layoutSlots: submission.layoutSlots,
    notes: submission.notes,
    reviewStatus: submission.reviewStatus,
    riskLevel: submission.riskLevel,
    reviewNotes: submission.reviewNotes,
    scanStatus: submission.scanStatus,
    scanResult: submission.scanResult,
    scannedAt: submission.scannedAt?.toISOString() ?? null,
    submittedByUserId: submission.submittedByUserId,
    submittedByUsername: submission.submittedBy?.username ?? null,
    reviewedByUserId: submission.reviewedByUserId,
    reviewedByUsername: submission.reviewedBy?.username ?? null,
    reviewedAt: submission.reviewedAt?.toISOString() ?? null,
    createdAt: submission.createdAt.toISOString(),
    updatedAt: submission.updatedAt.toISOString()
  }
}

export async function createThemeMarketSubmission(input: CreateThemeMarketSubmissionInput) {
  return prisma.themeMarketSubmission.create({
    data: {
      themeId: input.themeId,
      version: input.version,
      name: input.name,
      repoUrl: input.repoUrl,
      releaseUrl: input.releaseUrl,
      manifestUrl: input.manifestUrl,
      packageUrl: input.packageUrl,
      sha256: input.sha256,
      developerName: input.developerName,
      developerHomepage: input.developerHomepage ?? null,
      developerGithub: input.developerGithub ?? null,
      contactEmail: input.contactEmail,
      compatibility: input.compatibility as Prisma.InputJsonObject,
      tokens: input.tokens as Prisma.InputJsonArray,
      layoutSlots: input.layoutSlots as Prisma.InputJsonArray,
      notes: input.notes ?? null,
      submittedByUserId: input.submittedByUserId
    },
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}

export async function listMyThemeMarketSubmissions(userId: number) {
  return prisma.themeMarketSubmission.findMany({
    where: { submittedByUserId: userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}

export async function listThemeMarketSubmissions(options: {
  reviewStatus?: ThemeMarketSubmissionReviewStatus
  limit?: number
}) {
  return prisma.themeMarketSubmission.findMany({
    where: options.reviewStatus ? { reviewStatus: options.reviewStatus } : {},
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(options.limit ?? 100, 1), 200),
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}

export async function getThemeMarketSubmissionForReview(id: number) {
  return prisma.themeMarketSubmission.findUnique({
    where: { id },
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}

export async function updateThemeMarketSubmissionScan(input: {
  id: number
  scanStatus: string
  scanResult: Record<string, unknown>
  riskLevel: ThemeMarketSubmissionRiskLevel
}) {
  return prisma.themeMarketSubmission.update({
    where: { id: input.id },
    data: {
      scanStatus: input.scanStatus,
      scanResult: input.scanResult as Prisma.InputJsonObject,
      scannedAt: new Date(),
      riskLevel: input.riskLevel
    },
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}

export async function reviewThemeMarketSubmission(input: {
  id: number
  reviewStatus: ThemeMarketSubmissionReviewStatus
  riskLevel: ThemeMarketSubmissionRiskLevel
  reviewNotes?: string | null
  reviewedByUserId: number
}) {
  return prisma.themeMarketSubmission.update({
    where: { id: input.id },
    data: {
      reviewStatus: input.reviewStatus,
      riskLevel: input.riskLevel,
      reviewNotes: input.reviewNotes ?? null,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: new Date()
    },
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}
