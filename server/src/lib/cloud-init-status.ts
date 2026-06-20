import { prisma } from '../db/prisma.js'
import type { IncusClient } from './incus/incus-client.js'

export type CloudInitState =
  | 'manual'
  | 'done'
  | 'done_with_errors'
  | 'running'
  | 'disabled'
  | 'unsupported'
  | 'agent_unavailable'
  | 'unknown'

export type CloudInitSource = 'manual' | 'status_json' | 'boot_finished' | 'image' | 'unknown'

export interface CloudInitStatusResponse {
  ready: boolean
  state: CloudInitState
  source: CloudInitSource
  manualOverride: boolean
  message: string
  detectedAt: string
}

interface InstanceCloudInitRecord {
  id: number
  image: string
  cloud_init_state?: string | null
  cloud_init_source?: string | null
  cloud_init_last_checked_at?: string | null
  cloud_init_completed_at?: string | null
  cloud_init_manual_completed_at?: string | null
  cloud_init_manual_completed_by?: number | null
}

const STATUS_JSON_PATHS = [
  '/run/cloud-init/status.json',
  '/var/lib/cloud/data/status.json'
]

const BOOT_FINISHED_PATH = '/var/lib/cloud/instance/boot-finished'

const READY_STATES = new Set<CloudInitState>([
  'manual',
  'done',
  'done_with_errors',
  'disabled',
  'unsupported'
])

const CACHEABLE_STATES = new Set<CloudInitState>([
  'manual',
  'done',
  'done_with_errors',
  'disabled',
  'unsupported'
])

function buildResponse(
  state: CloudInitState,
  source: CloudInitSource,
  message: string,
  detectedAt: Date,
  manualOverride: boolean = state === 'manual'
): CloudInitStatusResponse {
  return {
    ready: READY_STATES.has(state),
    state,
    source,
    manualOverride,
    message,
    detectedAt: detectedAt.toISOString()
  }
}

function isCloudImageAlias(imageAlias: string): boolean {
  return imageAlias.toLowerCase().includes('/cloud')
}

function getNestedValue(source: unknown, path: string[]): unknown {
  let current: unknown = source
  for (const segment of path) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function getNestedString(source: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const value = getNestedValue(source, path)
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return null
}

function hasIssues(value: unknown): boolean {
  if (!value) return false

  if (Array.isArray(value)) {
    return value.some(item => hasIssues(item))
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  if (typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  for (const [key, nested] of Object.entries(record)) {
    if (key === 'errors' || key === '_errors' || key === 'recoverable_errors' || key === 'recoverableErrors') {
      if (hasIssues(nested)) {
        return true
      }
      continue
    }

    if (nested && typeof nested === 'object' && hasIssues(nested)) {
      return true
    }
  }

  return false
}

function parseStatusPayload(rawContent: string): { state: CloudInitState; message: string } | null {
  if (!rawContent.trim()) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent) as unknown
  } catch {
    return null
  }

  const rawStatus = getNestedString(parsed, [
    ['extended_status'],
    ['status'],
    ['v1', 'extended_status'],
    ['v1', 'status'],
    ['v1', 'stage'],
    ['stage']
  ])?.toLowerCase() || ''

  const hasErrors = hasIssues(parsed)

  if (rawStatus.includes('disabled')) {
    return { state: 'disabled', message: 'Cloud-init is disabled for this instance' }
  }

  if (rawStatus.includes('done') || rawStatus.includes('finished') || rawStatus.includes('final')) {
    if (hasErrors || rawStatus.includes('error') || rawStatus.includes('degraded')) {
      return { state: 'done_with_errors', message: 'Cloud-init completed with warnings' }
    }
    return { state: 'done', message: 'Cloud-init completed' }
  }

  if (rawStatus.includes('running') || rawStatus.includes('init') || rawStatus.includes('modules') || rawStatus.includes('not started') || rawStatus.includes('not run')) {
    return { state: 'running', message: 'Cloud-init is still running' }
  }

  if (rawStatus.includes('error') || rawStatus.includes('degraded')) {
    return { state: 'running', message: 'Cloud-init reported issues before completion' }
  }

  return null
}

async function readInstanceFile(
  client: IncusClient,
  instanceName: string,
  filePath: string
): Promise<{ statusCode: number; content: string }> {
  const encodedPath = encodeURIComponent(filePath)
  return client.readFile(`/1.0/instances/${instanceName}/files?path=${encodedPath}`)
}

export function getCachedCloudInitStatus(instance: InstanceCloudInitRecord): CloudInitStatusResponse | null {
  const detectedAt = instance.cloud_init_last_checked_at
    || instance.cloud_init_manual_completed_at
    || instance.cloud_init_completed_at

  if (!detectedAt) return null

  const state = instance.cloud_init_state as CloudInitState | null
  const source = (instance.cloud_init_source as CloudInitSource | null) || 'unknown'

  if (!state || !CACHEABLE_STATES.has(state)) {
    return null
  }

  const message = state === 'manual'
    ? 'Cloud-init marked complete manually'
    : state === 'done'
      ? 'Cloud-init completed'
      : state === 'done_with_errors'
        ? 'Cloud-init completed with warnings'
        : state === 'disabled'
          ? 'Cloud-init is disabled for this instance'
          : 'Image does not appear to use cloud-init'

  return buildResponse(state, source, message, new Date(detectedAt), state === 'manual')
}

export async function persistCloudInitStatus(
  instanceId: number,
  result: CloudInitStatusResponse,
  manualCompletedBy?: number | null
): Promise<void> {
  const detectedAt = new Date(result.detectedAt)

  await prisma.instance.update({
    where: { id: instanceId },
    data: {
      cloudInitState: result.state,
      cloudInitSource: result.source,
      cloudInitLastCheckedAt: detectedAt,
      cloudInitCompletedAt: result.ready ? detectedAt : null,
      cloudInitManualCompletedAt: result.state === 'manual' ? detectedAt : null,
      cloudInitManualCompletedBy: result.state === 'manual' ? (manualCompletedBy ?? null) : null
    }
  })
}

export async function resetInstanceCloudInitState(instanceId: number): Promise<void> {
  await prisma.instance.update({
    where: { id: instanceId },
    data: {
      cloudInitState: null,
      cloudInitSource: null,
      cloudInitLastCheckedAt: null,
      cloudInitCompletedAt: null,
      cloudInitManualCompletedAt: null,
      cloudInitManualCompletedBy: null
    }
  })
}

export async function detectCloudInitStatus(
  client: IncusClient,
  instance: Pick<InstanceCloudInitRecord, 'id' | 'image'> & { incus_id: string }
): Promise<CloudInitStatusResponse> {
  const detectedAt = new Date()

  if (!isCloudImageAlias(instance.image)) {
    return buildResponse('unsupported', 'image', 'Image does not appear to use cloud-init', detectedAt)
  }

  let sawAgentError = false

  for (const filePath of STATUS_JSON_PATHS) {
    const result = await readInstanceFile(client, instance.incus_id, filePath)

    if (result.statusCode === 200) {
      const parsed = parseStatusPayload(result.content)
      if (parsed) {
        return buildResponse(parsed.state, 'status_json', parsed.message, detectedAt)
      }
      break
    }

    if (result.statusCode >= 500 || result.statusCode === 403) {
      sawAgentError = true
    }
  }

  const bootFinishedResult = await readInstanceFile(client, instance.incus_id, BOOT_FINISHED_PATH)
  if (bootFinishedResult.statusCode === 200) {
    return buildResponse('done', 'boot_finished', 'Cloud-init completed', detectedAt)
  }

  if (bootFinishedResult.statusCode >= 500 || bootFinishedResult.statusCode === 403) {
    sawAgentError = true
  }

  if (sawAgentError) {
    return buildResponse('agent_unavailable', 'unknown', 'Guest agent is not ready for cloud-init inspection', detectedAt)
  }

  if (bootFinishedResult.statusCode === 404) {
    return buildResponse('running', 'boot_finished', 'Cloud-init is still running', detectedAt)
  }

  return buildResponse('unknown', 'unknown', 'Unable to determine cloud-init status', detectedAt)
}
