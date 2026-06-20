import {
  claimNextHostNotificationEmailTask,
  cleanupStaleHostNotificationEmailTasks,
  cleanupTimeoutHostNotificationEmailTasks,
  retryOrFailHostNotificationEmailTask,
  markHostNotificationEmailTaskSent
} from '../db/host-notification-email-tasks.js'
import { sendHostAnnouncementEmail } from '../lib/mailer.js'
import type { HostNotificationEmailTask } from '@prisma/client'
import { createWorkerDbBackoff } from './db-failure-backoff.js'

const POLL_INTERVAL = 5000
const TIMEOUT_CHECK_INTERVAL = 60 * 1000

let workerInterval: ReturnType<typeof setInterval> | null = null
let timeoutCheckInterval: ReturnType<typeof setInterval> | null = null
let isProcessing = false
const dbBackoff = createWorkerDbBackoff('HostNotifyEmailWorker')

async function processQueue(): Promise<void> {
  if (isProcessing) return
  if (dbBackoff.shouldSkip()) return
  isProcessing = true
  let currentTask: HostNotificationEmailTask | null = null

  try {
    currentTask = await claimNextHostNotificationEmailTask()
    if (!currentTask) return

    console.log(`[HostNotifyEmailWorker] Sending queued email task ${currentTask.id} to ${currentTask.email}`)

    const result = await sendHostAnnouncementEmail(currentTask.email, {
      username: currentTask.username,
      hostName: currentTask.hostName,
      title: currentTask.title,
      content: currentTask.content
    })

    if (result.success) {
      await markHostNotificationEmailTaskSent(currentTask.id)
      console.log(`[HostNotifyEmailWorker] Task ${currentTask.id} sent successfully`)
      return
    }

    const errorMessage = result.error || 'Unknown email error'
    await retryOrFailHostNotificationEmailTask(currentTask.id, currentTask.retryCount, errorMessage)
    console.error(`[HostNotifyEmailWorker] Task ${currentTask.id} failed: ${errorMessage}`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[HostNotifyEmailWorker] Queue processing error:', error)
    dbBackoff.arm(error)

    if (currentTask) {
      try {
        await retryOrFailHostNotificationEmailTask(currentTask.id, currentTask.retryCount, errorMessage)
      } catch (retryError) {
        console.error(`[HostNotifyEmailWorker] Failed to recover task ${currentTask.id}:`, retryError)
      }
    }
  } finally {
    isProcessing = false
  }
}

export {
  cleanupStaleHostNotificationEmailTasks,
  cleanupTimeoutHostNotificationEmailTasks
}

export function startHostNotificationEmailWorker(): void {
  if (workerInterval) {
    console.warn('[HostNotifyEmailWorker] Worker already running')
    return
  }

  console.log('[HostNotifyEmailWorker] Starting worker')
  workerInterval = setInterval(() => {
    processQueue().catch(err => {
      console.error('[HostNotifyEmailWorker] Worker tick failed:', err)
    })
  }, POLL_INTERVAL)
  timeoutCheckInterval = setInterval(() => {
    if (dbBackoff.shouldSkip()) return
    cleanupTimeoutHostNotificationEmailTasks().then(count => {
      if (count > 0) {
        console.warn(`[HostNotifyEmailWorker] Requeued ${count} timed-out task(s)`)
      }
    }).catch(err => {
      console.error('[HostNotifyEmailWorker] Timeout cleanup failed:', err)
      dbBackoff.arm(err)
    })
  }, TIMEOUT_CHECK_INTERVAL)

  processQueue().catch(err => {
    console.error('[HostNotifyEmailWorker] Initial queue processing failed:', err)
  })
}

export function stopHostNotificationEmailWorker(): void {
  if (!workerInterval) return

  clearInterval(workerInterval)
  workerInterval = null
  if (timeoutCheckInterval) {
    clearInterval(timeoutCheckInterval)
    timeoutCheckInterval = null
  }
  console.log('[HostNotifyEmailWorker] Worker stopped')
}
