import '../config/env.js'

import crypto from 'node:crypto'

import { closePrismaDatabase, prisma } from '../db/prisma.js'
import { deleteTicketImageFromLsky, getTicketImageLskyConfig, uploadTicketImageToLsky } from '../lib/lsky.js'
import { sanitizeTokensInString } from '../lib/log-sanitizer.js'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
)

const proofStartedAt = new Date()
const proofId = `lsky-upload-delete-proof-${proofStartedAt.toISOString()}`
const commit = process.env.LSKY_PROOF_COMMIT === '1'
const cleanupDb = process.env.LSKY_PROOF_KEEP_DB !== '1'
const LSKY_COMMIT_PROOF_ABILITIES = ['upload:write', 'user:photo:read', 'user:photo:write'] as const

function sanitizePreview(value: unknown): string {
  return sanitizeTokensInString(String(value ?? ''))
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[A-Za-z0-9_.-]{24,}/g, '[redacted]')
    .slice(0, 240)
}

function summarizeProviderFileId(value: string | null | undefined): {
  present: boolean
  length: number
  numeric: boolean
} {
  if (!value) {
    return {
      present: false,
      length: 0,
      numeric: false
    }
  }

  return {
    present: true,
    length: value.length,
    numeric: /^[1-9][0-9]*$/.test(value)
  }
}

function parseJsonObject(value: string): any | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function summarizeTokenAbilities(payload: any): {
  present: boolean
  count: number
  wildcard: boolean
  hasUploadWrite: boolean
  hasPhotoRead: boolean
  hasPhotoWrite: boolean
  missingForCommitProof: string[]
} {
  const abilities = Array.isArray(payload?.data?.abilities)
    ? payload.data.abilities.filter((value: unknown): value is string => typeof value === 'string')
    : []
  const wildcard = abilities.includes('*')
  const hasAbility = (ability: string) => wildcard || abilities.includes(ability)

  return {
    present: abilities.length > 0,
    count: abilities.length,
    wildcard,
    hasUploadWrite: hasAbility('upload:write'),
    hasPhotoRead: hasAbility('user:photo:read'),
    hasPhotoWrite: hasAbility('user:photo:write'),
    missingForCommitProof: wildcard
      ? []
      : LSKY_COMMIT_PROOF_ABILITIES.filter(ability => !abilities.includes(ability))
  }
}

async function probeLskyEndpoint(pathname: string): Promise<{
  ok: boolean
  status?: number
  contentType?: string | null
  bodyPreview?: string
  tokenAbilities?: ReturnType<typeof summarizeTokenAbilities>
  errorName?: string
  errorMessage?: string
}> {
  const config = await getTicketImageLskyConfig()
  if (!config) {
    return {
      ok: false,
      errorMessage: 'Lsky image bed is not configured'
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}${pathname}`, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.token}`
      }
    })
    const responseText = await response.text()
    const payload = parseJsonObject(responseText)

    const isTokenPermissionsProbe = pathname === '/api/v2/user/tokens/permissions'

    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type'),
      bodyPreview: isTokenPermissionsProbe ? '[token-permissions-summary]' : sanitizePreview(responseText),
      tokenAbilities: isTokenPermissionsProbe && payload
        ? summarizeTokenAbilities(payload)
        : undefined
    }
  } catch (error) {
    return {
      ok: false,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: sanitizePreview(error instanceof Error ? error.message : String(error))
    }
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const config = await getTicketImageLskyConfig()
  const existingAttachmentCount = await prisma.ticketMessageAttachment.count({
    where: {
      provider: 'lsky'
    }
  })

  const preflight = {
    configPresent: Boolean(config),
    apiVersion: config?.apiVersion ?? null,
    baseHost: config ? new URL(config.baseUrl).host : null,
    targetIdPresent: Boolean(config?.targetId),
    existingAttachmentCount,
    group: config?.apiVersion === 'v2' ? await probeLskyEndpoint('/api/v2/group') : null,
    tokenPermissions: config?.apiVersion === 'v2' ? await probeLskyEndpoint('/api/v2/user/tokens/permissions') : null,
    userPhotos: config?.apiVersion === 'v2' ? await probeLskyEndpoint('/api/v2/user/photos?page=1&per_page=1') : null
  }

  if (!commit) {
    console.log(JSON.stringify({
      proofId,
      mode: 'preflight',
      startedAt: proofStartedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      preflight,
      nextStep: 'Set LSKY_PROOF_COMMIT=1 only after the configured token can list/delete user photos.'
    }, null, 2))
    return
  }

  if (!config) {
    throw new Error('Lsky image bed is not configured')
  }

  if (config.apiVersion !== 'v2') {
    throw new Error('This production proof script only supports Lsky v2 cleanup proof')
  }

  if (preflight.userPhotos?.status === 403) {
    throw new Error('Configured Lsky token cannot access /api/v2/user/photos; refusing to create another proof upload')
  }

  const tokenAbilities = preflight.tokenPermissions?.tokenAbilities
  if (!tokenAbilities || tokenAbilities.missingForCommitProof.length > 0) {
    throw new Error('Configured Lsky token is missing commit proof abilities; refusing to create another proof upload')
  }

  const suffix = crypto.randomBytes(4).toString('hex')
  const username = `pproof-lsky-${suffix}`
  const createdIds: {
    userId?: number
    ticketId?: number
    messageId?: number
    attachmentId?: number
  } = {}
  let providerFileId: string | null = null
  let cleanupDeleted = false

  try {
    const user = await prisma.user.create({
      data: {
        username,
        email: null,
        passwordHash: `disabled-${crypto.randomUUID()}`,
        status: 'banned',
        banReason: 'production Lsky proof containment'
      },
      select: {
        id: true
      }
    })
    createdIds.userId = user.id

    const ticket = await prisma.ticket.create({
      data: {
        userId: user.id,
        subject: `Production Lsky proof ${suffix}`,
        category: 'technical',
        priority: 'normal',
        status: 'closed',
        closedAt: new Date()
      },
      select: {
        id: true
      }
    })
    createdIds.ticketId = ticket.id

    const message = await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: user.id,
        content: `Production Lsky upload/delete proof ${proofId}`,
        isFromOwner: false
      },
      select: {
        id: true
      }
    })
    createdIds.messageId = message.id

    const upload = await uploadTicketImageToLsky({
      buffer: ONE_PIXEL_PNG,
      filename: `payincus-lsky-proof-${suffix}.png`,
      contentType: 'image/png',
      sizeBytes: ONE_PIXEL_PNG.length
    })
    providerFileId = upload.providerFileId

    const attachment = await prisma.ticketMessageAttachment.create({
      data: {
        ticketId: ticket.id,
        messageId: message.id,
        uploaderId: user.id,
        provider: upload.provider,
        providerVersion: upload.providerVersion,
        providerFileId: upload.providerFileId,
        filename: upload.filename,
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        width: upload.width,
        height: upload.height,
        url: upload.url,
        thumbnailUrl: upload.thumbnailUrl
      },
      select: {
        id: true
      }
    })
    createdIds.attachmentId = attachment.id

    cleanupDeleted = await deleteTicketImageFromLsky(upload.providerVersion, upload.providerFileId)

    console.log(JSON.stringify({
      proofId,
      mode: 'commit',
      startedAt: proofStartedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      preflight,
      createdIds,
      provider: upload.provider,
      providerVersion: upload.providerVersion,
      providerFileId: summarizeProviderFileId(upload.providerFileId),
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      imageHost: new URL(upload.url).host,
      cleanupDeleted,
      dbCleanupPlanned: cleanupDb
    }, null, 2))

    if (!cleanupDeleted) {
      throw new Error('Lsky delete did not confirm success')
    }
  } finally {
    if (cleanupDb) {
      if (createdIds.attachmentId) {
        await prisma.ticketMessageAttachment.deleteMany({ where: { id: createdIds.attachmentId } })
      }
      if (createdIds.messageId) {
        await prisma.ticketMessage.deleteMany({ where: { id: createdIds.messageId } })
      }
      if (createdIds.ticketId) {
        await prisma.ticket.deleteMany({ where: { id: createdIds.ticketId } })
      }
      if (createdIds.userId) {
        await prisma.user.deleteMany({ where: { id: createdIds.userId } })
      }
    }

    if (providerFileId && !cleanupDeleted) {
      await deleteTicketImageFromLsky('v2', providerFileId)
    }
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      proofId,
      mode: commit ? 'commit' : 'preflight',
      failedAt: new Date().toISOString(),
      errorMessage: sanitizePreview(error instanceof Error ? error.message : String(error))
    }, null, 2))
    process.exitCode = 1
  })
  .finally(async () => {
    await closePrismaDatabase()
  })
