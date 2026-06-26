import { emitPluginEvent } from './plugin-event-emitter.js'
import { dispatchPluginEvent } from './plugin-runtime.js'
import type { PluginRuntimeActor } from './plugin-runtime.js'
import {
  dispatchPluginServiceExtension,
  listEnabledServiceExtensionTargets
} from './plugin-extension-dispatch.js'
import { prisma } from '../db/prisma.js'
import type { PluginServiceExtensionHook } from './plugin-manifest.js'

export type PluginLifecycleEventName =
  | 'plugin.installed'
  | 'plugin.enabled'
  | 'plugin.disabled'
  | 'plugin.uninstalled'

export interface PluginLifecycleEventInput {
  event: PluginLifecycleEventName
  pluginId: string
  version?: string | null
  sourceType?: string | null
  sourceRepo?: string | null
  actor?: PluginRuntimeActor
  dedupeKey?: string | null
}

export async function dispatchPluginLifecycleEvent(input: PluginLifecycleEventInput): Promise<void> {
  await dispatchPluginEvent(input.event, {
    pluginId: input.pluginId,
    version: input.version ?? null,
    sourceType: input.sourceType ?? null,
    sourceRepo: input.sourceRepo ?? null,
    occurredAt: new Date().toISOString(),
    metadata: input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}
  }, input.actor || { id: null, role: 'system' }, { dedupeKey: input.dedupeKey })
}

export type ServicePluginEventName =
  | 'service.provisioned'
  | 'service.suspended'
  | 'service.unsuspended'
  | 'service.deleted'

export type ServiceTaskPluginEventName =
  | 'service.task.queued'
  | 'service.task.cancelled'
  | 'service.task.completed'
  | 'service.task.failed'

export type ServiceResourceRollbackPluginEventName =
  | 'service.resource.rollback.completed'
  | 'service.resource.rollback.failed'

export interface ServicePluginEventInput {
  event: ServicePluginEventName
  instanceId: number
  userId: number
  hostId: number | null
  instanceName: string
  status?: string | null
  incusId?: string | null
  reason?: string | null
  source: string
  actor?: PluginRuntimeActor
  dedupeKey?: string | null
  metadata?: Record<string, unknown>
}

const SERVICE_EVENT_EXTENSION_HOOKS: Partial<Record<ServicePluginEventName, PluginServiceExtensionHook>> = {
  'service.provisioned': 'provision',
  'service.suspended': 'suspend',
  'service.unsuspended': 'unsuspend',
  'service.deleted': 'terminate'
}

export interface ServiceTaskPluginEventInput {
  event: ServiceTaskPluginEventName
  instanceId: number
  userId: number
  hostId: number | null
  instanceName: string
  taskId: number
  taskType: string
  taskStatus: string
  source: string
  actor?: PluginRuntimeActor
  dedupeKey?: string | null
  metadata?: Record<string, unknown>
}

export interface ServiceResourceRollbackPluginEventInput {
  event: ServiceResourceRollbackPluginEventName
  instanceId: number
  userId: number
  hostId: number | null
  instanceName: string
  source: string
  reason: string
  cpu: number
  memory: number
  disk: number
  portCount: number
  actor?: PluginRuntimeActor
  dedupeKey?: string | null
  metadata?: Record<string, unknown>
}

export type UserPluginEventName =
  | 'user.registered'
  | 'user.login'
  | 'user.profile.updated'
  | 'user.status.changed'

export interface UserPluginEventInput {
  event: UserPluginEventName
  userId: number
  username: string
  role: string
  status?: string | null
  source: string
  actor?: PluginRuntimeActor
  dedupeKey?: string | null
  metadata?: Record<string, unknown>
}

export function emitServicePluginEvent(input: ServicePluginEventInput): void {
  emitPluginEvent(input.event, {
    instanceId: input.instanceId,
    userId: input.userId,
    hostId: input.hostId,
    instanceName: input.instanceName,
    status: input.status ?? null,
    incusId: input.incusId ?? null,
    reason: input.reason ?? null,
    source: input.source,
    metadata: input.dedupeKey ? { ...(input.metadata ?? {}), dedupeKey: input.dedupeKey } : input.metadata ?? {},
    occurredAt: new Date().toISOString()
  }, input.actor || { id: null, role: 'system' }, { dedupeKey: input.dedupeKey })

  void dispatchServiceLifecycleExtensionHooks(input).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[PluginServiceExtension] lifecycle dispatch failed for ${input.event}:${input.instanceId}: ${message}`)
  })
}

async function dispatchServiceLifecycleExtensionHooks(input: ServicePluginEventInput): Promise<void> {
  const hook = SERVICE_EVENT_EXTENSION_HOOKS[input.event]
  if (!hook) return

  const instance = await prisma.instance.findUnique({
    where: { id: input.instanceId },
    select: { packageId: true }
  })
  const productId = instance?.packageId ? String(instance.packageId) : null
  const targets = await listEnabledServiceExtensionTargets(hook, productId)
  if (targets.length === 0) return

  const payload = {
    lifecycleEvent: input.event,
    instanceId: input.instanceId,
    userId: input.userId,
    hostId: input.hostId,
    instanceName: input.instanceName,
    status: input.status ?? null,
    incusId: input.incusId ?? null,
    productId,
    reason: input.reason ?? null,
    source: input.source,
    metadata: input.metadata ?? {},
    occurredAt: new Date().toISOString()
  }
  const actor = input.actor || { id: null, role: 'system' as const }
  const idempotencyBase = input.dedupeKey || `${input.event}:${input.instanceId}:${input.source}`

  for (const target of targets) {
    try {
      await dispatchPluginServiceExtension({
        pluginId: target.pluginId,
        hook,
        serviceExtensionKey: target.serviceExtensionKey,
        payload,
        idempotencyKey: `service-lifecycle:${idempotencyBase}:${target.pluginId}:${target.serviceExtensionKey}`,
        actor
      })
    } catch {
      // dispatchPluginServiceExtension records the failed plugin event; lifecycle state is never rolled back here.
    }
  }
}

export function emitServiceTaskPluginEvent(input: ServiceTaskPluginEventInput): void {
  emitPluginEvent(input.event, {
    instanceId: input.instanceId,
    userId: input.userId,
    hostId: input.hostId,
    instanceName: input.instanceName,
    taskId: input.taskId,
    taskType: input.taskType,
    taskStatus: input.taskStatus,
    source: input.source,
    metadata: input.dedupeKey ? { ...(input.metadata ?? {}), dedupeKey: input.dedupeKey } : input.metadata ?? {},
    occurredAt: new Date().toISOString()
  }, input.actor || { id: input.userId, role: 'user' }, { dedupeKey: input.dedupeKey })
}

export function emitServiceResourceRollbackPluginEvent(input: ServiceResourceRollbackPluginEventInput): void {
  emitPluginEvent(input.event, {
    instanceId: input.instanceId,
    userId: input.userId,
    hostId: input.hostId,
    instanceName: input.instanceName,
    reason: input.reason,
    source: input.source,
    resources: {
      cpu: input.cpu,
      memory: input.memory,
      disk: input.disk,
      portCount: input.portCount
    },
    metadata: input.dedupeKey ? { ...(input.metadata ?? {}), dedupeKey: input.dedupeKey } : input.metadata ?? {},
    occurredAt: new Date().toISOString()
  }, input.actor || { id: null, role: 'system' }, { dedupeKey: input.dedupeKey })
}

export function emitUserPluginEvent(input: UserPluginEventInput): void {
  emitPluginEvent(input.event, {
    userId: input.userId,
    username: input.username,
    role: input.role,
    status: input.status ?? null,
    source: input.source,
    metadata: input.dedupeKey ? { ...(input.metadata ?? {}), dedupeKey: input.dedupeKey } : input.metadata ?? {},
    occurredAt: new Date().toISOString()
  }, input.actor || { id: input.userId, role: 'user', username: input.username }, { dedupeKey: input.dedupeKey })
}

export function emitNotificationSentPluginEvent(input: {
  userId: number
  eventType: string
  sent: number
  failed: number
  channelCount: number
  dedupeKey?: string | null
}): void {
  emitPluginEvent('notification.sent', {
    userId: input.userId,
    eventType: input.eventType,
    sent: input.sent,
    failed: input.failed,
    channelCount: input.channelCount,
    dedupeKey: input.dedupeKey ?? null,
    occurredAt: new Date().toISOString()
  }, { id: input.userId, role: 'user' }, { dedupeKey: input.dedupeKey })
}
