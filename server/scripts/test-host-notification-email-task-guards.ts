import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const source = readFileSync(resolve(__dirname, '../src/db/host-notification-email-tasks.ts'), 'utf8')

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const staleCleanupSection = sectionBetween(
  'export async function cleanupStaleHostNotificationEmailTasks(',
  'export async function cleanupTimeoutHostNotificationEmailTasks('
)

assert.ok(
  staleCleanupSection.includes('timeoutMs: number = HOST_NOTIFICATION_EMAIL_PROCESSING_TIMEOUT_MS') &&
    staleCleanupSection.includes('const timeoutThreshold = new Date(Date.now() - timeoutMs)'),
  'host notification startup cleanup must use the processing timeout threshold'
)
assert.ok(
  staleCleanupSection.includes("status: 'PROCESSING'") &&
    staleCleanupSection.includes('{ startedAt: null }') &&
    staleCleanupSection.includes('startedAt: { lt: timeoutThreshold }'),
  'host notification startup cleanup must only requeue timed-out or malformed processing tasks'
)
assert.ok(
  !staleCleanupSection.includes("where: { status: 'PROCESSING' }"),
  'host notification startup cleanup must not requeue every processing task during rolling starts'
)

const markSentSection = sectionBetween(
  'export async function markHostNotificationEmailTaskSent(',
  'export async function retryOrFailHostNotificationEmailTask('
)

assert.ok(
  markSentSection.includes('prisma.hostNotificationEmailTask.updateMany') &&
    markSentSection.includes('id: taskId') &&
    markSentSection.includes("status: 'PROCESSING'") &&
    markSentSection.includes("status: 'SENT'"),
  'host notification sent marker must conditionally update only still-processing tasks'
)
assert.ok(
  !markSentSection.includes('prisma.hostNotificationEmailTask.update({'),
  'host notification sent marker must not unconditionally overwrite a requeued task'
)

const retrySection = source.slice(source.indexOf('export async function retryOrFailHostNotificationEmailTask('))

assert.ok(
  retrySection.includes('prisma.hostNotificationEmailTask.updateMany') &&
    retrySection.includes('id: taskId') &&
    retrySection.includes("status: 'PROCESSING'") &&
    retrySection.includes('retryCount: currentRetryCount'),
  'host notification retry/fail updates must conditionally update the claimed processing task'
)
assert.ok(
  !retrySection.includes('prisma.hostNotificationEmailTask.update({'),
  'host notification retry/fail updates must not unconditionally overwrite a requeued task'
)

console.log('host notification email task guard tests passed')
