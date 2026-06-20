import { Prisma } from '@prisma/client'

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const DEFAULT_BACKOFF_MS = parsePositiveInt(process.env.DB_WORKER_BACKOFF_MS, 15000)

export function isTransientDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const prismaError = error as Error & { code?: string }
  if (
    prismaError instanceof Prisma.PrismaClientKnownRequestError &&
    (prismaError.code === 'P2028' || prismaError.code === 'P2034' || prismaError.code === 'P1001')
  ) {
    return true
  }

  const message = error.message.toLowerCase()
  return (
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('unable to start a transaction in the given time') ||
    message.includes('too many clients') ||
    message.includes('remaining connection slots are reserved') ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('terminating connection due to administrator command')
  )
}

export function createWorkerDbBackoff(label: string, backoffMs: number = DEFAULT_BACKOFF_MS) {
  let backoffUntil = 0

  return {
    shouldSkip(): boolean {
      return Date.now() < backoffUntil
    },
    arm(error: unknown): void {
      if (!isTransientDatabaseError(error)) return
      backoffUntil = Date.now() + backoffMs
      console.warn(`[${label}] Database backoff armed for ${backoffMs}ms`)
    },
    reset(): void {
      backoffUntil = 0
    }
  }
}
