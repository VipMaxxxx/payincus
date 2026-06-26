import type { FastifyRequest } from 'fastify'
import type * as ticketDb from '../db/tickets.js'
import { deleteTicketImageFromLsky, uploadTicketImageToLsky } from './lsky.js'

export const MAX_TICKET_IMAGES = 6
export const MAX_TICKET_IMAGE_SIZE = 50 * 1024 * 1024
export const TICKET_UPLOAD_BODY_LIMIT = (MAX_TICKET_IMAGES * MAX_TICKET_IMAGE_SIZE) + (4 * 1024 * 1024)
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
])

export interface ParsedTicketPayload {
  fields: Record<string, string>
  images: Array<{
    buffer: Buffer
    filename: string
    contentType: string
    sizeBytes: number
  }>
}

export function isMultipartRequest(request: FastifyRequest): boolean {
  return typeof (request as FastifyRequest & { isMultipart?: () => boolean }).isMultipart === 'function'
    && (request as FastifyRequest & { isMultipart: () => boolean }).isMultipart()
}

export async function readTicketPayload(request: FastifyRequest): Promise<ParsedTicketPayload> {
  if (!isMultipartRequest(request)) {
    const body = (request.body ?? {}) as Record<string, unknown>
    const fields: Record<string, string> = {}

    for (const [key, value] of Object.entries(body)) {
      if (value !== null && value !== undefined) {
        fields[key] = String(value)
      }
    }

    return { fields, images: [] }
  }

  const multipartRequest = request as FastifyRequest & {
    parts: () => AsyncIterable<any>
  }
  const fields: Record<string, string> = {}
  const images: ParsedTicketPayload['images'] = []

  for await (const part of multipartRequest.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'images') {
        await part.toBuffer()
        continue
      }

      if (!part.mimetype || !ALLOWED_IMAGE_MIME_TYPES.has(part.mimetype)) {
        throw new Error('Only JPG, PNG, WebP, GIF and AVIF images are supported')
      }

      if (images.length >= MAX_TICKET_IMAGES) {
        throw new Error(`A ticket message can contain at most ${MAX_TICKET_IMAGES} images`)
      }

      const buffer = await part.toBuffer()
      if (buffer.length === 0) {
        continue
      }

      if (buffer.length > MAX_TICKET_IMAGE_SIZE) {
        throw new Error(`Each image must be no larger than ${MAX_TICKET_IMAGE_SIZE / (1024 * 1024)}MB`)
      }

      images.push({
        buffer,
        filename: part.filename || `ticket-image-${Date.now()}`,
        contentType: part.mimetype,
        sizeBytes: buffer.length
      })
      continue
    }

    fields[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value ?? '')
  }

  return { fields, images }
}

export async function uploadTicketImages(
  images: ParsedTicketPayload['images']
): Promise<ticketDb.CreateTicketMessageAttachmentData[]> {
  const uploaded: ticketDb.CreateTicketMessageAttachmentData[] = []

  try {
    for (const image of images) {
      const result = await uploadTicketImageToLsky(image)
      uploaded.push({
        provider: result.provider,
        providerVersion: result.providerVersion,
        providerFileId: result.providerFileId,
        filename: result.filename,
        originalName: result.originalName,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        width: result.width,
        height: result.height,
        url: result.url,
        thumbnailUrl: result.thumbnailUrl
      })
    }
  } catch (error) {
    if (uploaded.length > 0) {
      await cleanupUploadedTicketImages(uploaded)
    }
    throw error
  }

  return uploaded
}

export async function cleanupUploadedTicketImages(
  attachments: Array<{ providerVersion: string; providerFileId?: string | null }>
): Promise<void> {
  await Promise.allSettled(
    attachments.map(attachment => deleteTicketImageFromLsky(attachment.providerVersion, attachment.providerFileId ?? null))
  )
}

export function normalizeAllowedImageMimeType(value: string | null | undefined): string | null {
  const normalized = value?.split(';')[0]?.trim().toLowerCase()
  return normalized && ALLOWED_IMAGE_MIME_TYPES.has(normalized) ? normalized : null
}

export function isHandledTicketPayloadError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false
  }

  return [
    'Only JPG',
    'A ticket message can contain at most',
    'Each image must be no larger than',
    'Lsky',
    'image bed',
    'Cannot reply to a closed ticket',
    'must use http or https',
    'Private or',
    'Unable to resolve hostname',
    'Targets resolving'
  ].some(fragment => error.message.includes(fragment))
}
