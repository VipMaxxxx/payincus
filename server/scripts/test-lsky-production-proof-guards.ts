import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const scriptSource = readFileSync(resolve(import.meta.dirname, '../src/scripts/lsky-production-proof.ts'), 'utf8')

assert.ok(
  scriptSource.includes("process.env.LSKY_PROOF_COMMIT === '1'") &&
    scriptSource.includes("mode: 'preflight'") &&
    scriptSource.includes("Set LSKY_PROOF_COMMIT=1"),
  'Lsky production proof script must default to read-only preflight mode'
)

assert.ok(
  scriptSource.includes("preflight.userPhotos?.status === 403") &&
    scriptSource.includes('tokenAbilities.missingForCommitProof.length > 0') &&
    scriptSource.includes('refusing to create another proof upload'),
  'Lsky production proof script must refuse uploads when user-photo permissions are missing'
)

assert.ok(
  scriptSource.includes('/api/v2/user/tokens/permissions') &&
    scriptSource.includes('summarizeTokenAbilities') &&
    scriptSource.includes("'[token-permissions-summary]'") &&
    scriptSource.includes('missingForCommitProof') &&
    scriptSource.includes("'upload:write', 'user:photo:read', 'user:photo:write'"),
  'Lsky production proof script must summarize current token abilities without printing raw token material'
)

assert.ok(
  scriptSource.includes('uploadTicketImageToLsky') &&
    scriptSource.includes('prisma.ticketMessageAttachment.create') &&
    scriptSource.includes('deleteTicketImageFromLsky(upload.providerVersion, upload.providerFileId)'),
  'Lsky production proof script must persist an uploaded attachment before proving provider deletion'
)

assert.ok(
  scriptSource.includes('summarizeProviderFileId') &&
    scriptSource.includes('providerFileId: summarizeProviderFileId(upload.providerFileId)') &&
    !scriptSource.includes('console.log(upload.url)') &&
    scriptSource.includes("imageHost: new URL(upload.url).host"),
  'Lsky production proof output must summarize provider IDs and avoid printing private image URLs'
)

assert.ok(
  scriptSource.includes("replace(/https?:\\/\\/\\S+/g, '[url]')") &&
    scriptSource.includes('sanitizeTokensInString'),
  'Lsky production proof script must sanitize URLs and token-like values before output'
)

assert.ok(
  scriptSource.includes('prisma.ticketMessageAttachment.deleteMany') &&
    scriptSource.includes('prisma.ticketMessage.deleteMany') &&
    scriptSource.includes('prisma.ticket.deleteMany') &&
    scriptSource.includes('prisma.user.deleteMany') &&
    scriptSource.includes('process.env.LSKY_PROOF_KEEP_DB'),
  'Lsky production proof script must clean temporary DB records by default with an explicit keep override'
)

assert.ok(
  scriptSource.includes("DELETE /api/v2/user/photos") ||
    scriptSource.includes('/api/v2/user/photos'),
  'Lsky production proof script must document or probe the Lsky v2 user photos deletion boundary'
)

console.log('lsky production proof guards passed')
