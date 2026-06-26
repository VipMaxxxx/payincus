import type { PluginMarketSubmission } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

export type PluginMarketSubmissionReviewStatus = 'pending' | 'listed' | 'rejected' | 'delisted'
export type PluginMarketSubmissionRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface CreatePluginMarketSubmissionInput {
  pluginId: string
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
  permissions: Record<string, unknown>
  compatibility: Record<string, unknown>
  pricing: Record<string, unknown>
  notes?: string | null
  submittedByUserId: number
}

export interface SerializedPluginMarketSubmission {
  id: number
  pluginId: string
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
  permissions: unknown
  compatibility: unknown
  pricing: unknown
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

type PluginMarketSubmissionWithUsers = PluginMarketSubmission & {
  submittedBy?: { username: string } | null
  reviewedBy?: { username: string } | null
}

export function serializePluginMarketSubmission(submission: PluginMarketSubmissionWithUsers): SerializedPluginMarketSubmission {
  return {
    id: submission.id,
    pluginId: submission.pluginId,
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
    permissions: submission.permissions,
    compatibility: submission.compatibility,
    pricing: submission.pricing,
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

export async function createPluginMarketSubmission(input: CreatePluginMarketSubmissionInput) {
  return prisma.pluginMarketSubmission.create({
    data: {
      pluginId: input.pluginId,
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
      permissions: input.permissions as Prisma.InputJsonObject,
      compatibility: input.compatibility as Prisma.InputJsonObject,
      pricing: input.pricing as Prisma.InputJsonObject,
      notes: input.notes ?? null,
      submittedByUserId: input.submittedByUserId
    },
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}

export async function listMyPluginMarketSubmissions(userId: number) {
  return prisma.pluginMarketSubmission.findMany({
    where: { submittedByUserId: userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}

export async function listPluginMarketSubmissions(options: {
  reviewStatus?: PluginMarketSubmissionReviewStatus
  limit?: number
}) {
  return prisma.pluginMarketSubmission.findMany({
    where: options.reviewStatus ? { reviewStatus: options.reviewStatus } : {},
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(options.limit ?? 100, 1), 200),
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}

export async function getPluginMarketSubmissionForReview(id: number) {
  return prisma.pluginMarketSubmission.findUnique({
    where: { id },
    include: {
      submittedBy: { select: { username: true } },
      reviewedBy: { select: { username: true } }
    }
  })
}

export async function updatePluginMarketSubmissionScan(input: {
  id: number
  scanStatus: string
  scanResult: Record<string, unknown>
  riskLevel: PluginMarketSubmissionRiskLevel
}) {
  return prisma.pluginMarketSubmission.update({
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

export async function reviewPluginMarketSubmission(input: {
  id: number
  reviewStatus: PluginMarketSubmissionReviewStatus
  riskLevel: PluginMarketSubmissionRiskLevel
  reviewNotes?: string | null
  reviewedByUserId: number
}) {
  return prisma.pluginMarketSubmission.update({
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
