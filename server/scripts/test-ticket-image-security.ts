import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ticketsSource = readFileSync(resolve(__dirname, '../src/routes/tickets.ts'), 'utf8')
const lskySource = readFileSync(resolve(__dirname, '../src/lib/lsky.ts'), 'utf8')

assert.ok(
  ticketsSource.includes('function normalizeAllowedImageMimeType'),
  'ticket attachment proxy must normalize MIME types through an image allowlist'
)
assert.ok(
  ticketsSource.includes("redirect: 'manual'"),
  'ticket attachment proxy must not automatically follow redirects after URL validation'
)
assert.ok(
  ticketsSource.includes("reply.header('X-Content-Type-Options', 'nosniff')"),
  'ticket attachment proxy must prevent browser MIME sniffing'
)
assert.ok(
  ticketsSource.includes('const responseMimeType = upstreamMimeType ?? storedMimeType'),
  'ticket attachment proxy must only serve allowed upstream or stored image MIME types'
)
assert.ok(
  ticketsSource.includes("Attachment image type is not allowed"),
  'ticket attachment proxy must reject legacy/stored attachments with unsafe MIME types'
)

assert.ok(
  lskySource.includes('const ALLOWED_LSKY_IMAGE_MIME_TYPES = new Set'),
  'Lsky upload results must be normalized through an image MIME allowlist'
)
assert.ok(
  lskySource.includes('function normalizeAllowedImageMimeType'),
  'Lsky upload result MIME types must be normalized before persistence'
)
assert.ok(
  lskySource.includes('function pickProviderFileId') &&
    lskySource.includes("typeof value === 'number' && Number.isFinite(value)") &&
    lskySource.includes('pickProviderFileId(data?.id, data?.key, data?.hash, data?.pathname, data?.path)') &&
    lskySource.includes('pickProviderFileId(data?.key, data?.id, data?.hash, data?.pathname, data?.path)'),
  'Lsky upload results must preserve numeric IDs and pathname/path fallback identifiers so uploaded images can be cleaned up'
)
assert.ok(
  lskySource.includes('function parseProviderNumericId') &&
    lskySource.includes("const deleteUrl = apiVersion === 'v2'") &&
    lskySource.includes('`${apiBase}/user/photos`') &&
    lskySource.includes("'Content-Type': 'application/json'") &&
    lskySource.includes('JSON.stringify([numericId])'),
  'Lsky v2 delete must call the batch /user/photos endpoint with a JSON numeric ID array'
)
assert.ok(
  lskySource.includes("console.warn('[Lsky] Delete did not confirm success'") &&
    lskySource.includes('payload?.status === false') &&
    lskySource.includes('providerFileIdLength: providerFileId.length') &&
    lskySource.includes('bodyPreview: sanitizeResponsePreview(responseText)') &&
    lskySource.includes("console.warn('[Lsky] Delete request failed'") &&
    lskySource.includes('errorMessage: sanitizeTokensInString'),
  'Lsky delete failures must log non-sensitive status/body/error diagnostics and must not treat status:false as success'
)
assert.equal(
  (lskySource.match(/redirect: 'manual'/g) ?? []).length,
  3,
  'Lsky group, upload, and delete fetches must not automatically follow redirects'
)
assert.ok(
  lskySource.includes("throw new Error('Lsky upload returned unsupported image MIME type')"),
  'Lsky upload must reject unsupported image MIME types before storing attachment metadata'
)

console.log('ticket image security tests passed')
