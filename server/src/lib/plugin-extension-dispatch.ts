import { createPluginEvent, getPlugin } from '../db/plugins.js'
import { prisma } from '../db/prisma.js'
import { executePluginAction, type PluginActionExecutionResult, type PluginRuntimeActor } from './plugin-runtime.js'
import {
  buildPluginGatewayExtensionContractPayload,
  buildPluginServiceExtensionContractPayload,
  normalizePluginExtensionContractResult,
  type PluginExtensionContractResult
} from './plugin-extension-contracts.js'
import {
  PLUGIN_GATEWAY_EXTENSION_HOOKS,
  PLUGIN_SERVICE_EXTENSION_HOOKS,
  type PayIncusPluginManifest,
  type PluginGatewayExtensionHook,
  type PluginGatewayExtensionManifest,
  type PluginServiceExtensionHook,
  type PluginServiceExtensionManifest
} from './plugin-manifest.js'

export class PluginExtensionDispatchError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'PluginExtensionDispatchError'
  }
}

export interface PluginServiceExtensionTarget {
  pluginId: string
  serviceExtensionKey: string
  name: string
  productId: string | null
  hook: PluginServiceExtensionHook
}

export interface PluginGatewayExtensionTarget {
  pluginId: string
  gatewayExtensionKey: string
  name: string
  providerCode: string | null
  hook: PluginGatewayExtensionHook
}

export interface PluginServiceExtensionDispatchInput {
  pluginId: string
  hook: PluginServiceExtensionHook
  serviceExtensionKey?: string
  payload?: unknown
  idempotencyKey?: string | null
  actor: PluginRuntimeActor
}

export interface PluginGatewayExtensionDispatchInput {
  pluginId: string
  hook: PluginGatewayExtensionHook
  gatewayExtensionKey?: string
  payload?: unknown
  idempotencyKey?: string | null
  actor: PluginRuntimeActor
}

export interface PluginServiceExtensionDispatchResult {
  pluginId: string
  serviceExtensionKey: string
  hook: PluginServiceExtensionHook
  action: PluginActionExecutionResult
  contract: PluginExtensionContractResult
}

export interface PluginGatewayExtensionDispatchResult {
  pluginId: string
  gatewayExtensionKey: string
  hook: PluginGatewayExtensionHook
  action: PluginActionExecutionResult
  contract: PluginExtensionContractResult
}

function latestManifest(plugin: NonNullable<Awaited<ReturnType<typeof getPlugin>>>): PayIncusPluginManifest | null {
  const latest = plugin.versions?.[0]
  return latest ? latest.manifest as unknown as PayIncusPluginManifest : null
}

async function loadEnabledPluginManifest(pluginId: string): Promise<PayIncusPluginManifest> {
  const plugin = await getPlugin(pluginId)
  if (!plugin || !plugin.enabled || plugin.status !== 'enabled') {
    throw new PluginExtensionDispatchError(404, 'PLUGIN_NOT_FOUND', 'Plugin not found')
  }
  const manifest = latestManifest(plugin)
  if (!manifest) throw new PluginExtensionDispatchError(404, 'PLUGIN_NOT_FOUND', 'Plugin not found')
  return manifest
}

function resolveServiceExtensionAction(
  manifest: PayIncusPluginManifest,
  hook: PluginServiceExtensionHook,
  serviceExtensionKey?: string
): { extension: PluginServiceExtensionManifest; actionName: string } {
  const extensions = manifest.capabilities?.serviceExtensions || []
  if (extensions.length === 0) {
    throw new PluginExtensionDispatchError(403, 'PLUGIN_SERVICE_EXTENSION_NOT_DECLARED', 'Plugin service extension is not declared in manifest capabilities')
  }

  const matched = extensions.filter(extension => {
    if (serviceExtensionKey && extension.key !== serviceExtensionKey) return false
    return typeof extension.hooks[hook] === 'string'
  })
  if (matched.length === 0) {
    throw new PluginExtensionDispatchError(404, 'PLUGIN_SERVICE_EXTENSION_HOOK_NOT_FOUND', 'Plugin service extension hook is not declared')
  }
  if (!serviceExtensionKey && matched.length > 1) {
    throw new PluginExtensionDispatchError(409, 'PLUGIN_SERVICE_EXTENSION_AMBIGUOUS', 'serviceExtensionKey is required when multiple service extensions declare this hook')
  }

  const extension = matched[0]
  const actionName = extension.hooks[hook]
  if (!actionName) {
    throw new PluginExtensionDispatchError(404, 'PLUGIN_SERVICE_EXTENSION_HOOK_NOT_FOUND', 'Plugin service extension hook is not declared')
  }
  return { extension, actionName }
}

function resolveGatewayExtensionAction(
  manifest: PayIncusPluginManifest,
  hook: PluginGatewayExtensionHook,
  gatewayExtensionKey?: string
): { extension: PluginGatewayExtensionManifest; actionName: string } {
  const extensions = manifest.capabilities?.gatewayExtensions || []
  if (extensions.length === 0) {
    throw new PluginExtensionDispatchError(403, 'PLUGIN_GATEWAY_EXTENSION_NOT_DECLARED', 'Plugin gateway extension is not declared in manifest capabilities')
  }

  const matched = extensions.filter(extension => {
    if (gatewayExtensionKey && extension.key !== gatewayExtensionKey) return false
    return typeof extension.hooks[hook] === 'string'
  })
  if (matched.length === 0) {
    throw new PluginExtensionDispatchError(404, 'PLUGIN_GATEWAY_EXTENSION_HOOK_NOT_FOUND', 'Plugin gateway extension hook is not declared')
  }
  if (!gatewayExtensionKey && matched.length > 1) {
    throw new PluginExtensionDispatchError(409, 'PLUGIN_GATEWAY_EXTENSION_AMBIGUOUS', 'gatewayExtensionKey is required when multiple gateway extensions declare this hook')
  }

  const extension = matched[0]
  const actionName = extension.hooks[hook]
  if (!actionName) {
    throw new PluginExtensionDispatchError(404, 'PLUGIN_GATEWAY_EXTENSION_HOOK_NOT_FOUND', 'Plugin gateway extension hook is not declared')
  }
  return { extension, actionName }
}

export async function listEnabledServiceExtensionTargets(
  hook: PluginServiceExtensionHook,
  productId?: string | null
): Promise<PluginServiceExtensionTarget[]> {
  if (!PLUGIN_SERVICE_EXTENSION_HOOKS.includes(hook)) return []
  const plugins = await prisma.plugin.findMany({
    where: { enabled: true, status: 'enabled' },
    include: { versions: { orderBy: { installedAt: 'desc' }, take: 1 } }
  })

  return plugins.flatMap(plugin => {
    const manifest = plugin.versions[0]?.manifest as unknown as PayIncusPluginManifest | undefined
    return (manifest?.capabilities?.serviceExtensions || [])
      .filter(extension => typeof extension.hooks[hook] === 'string')
      .filter(extension => !productId || !extension.productId || extension.productId === productId)
      .map(extension => ({
        pluginId: plugin.pluginId,
        serviceExtensionKey: extension.key,
        name: extension.name,
        productId: extension.productId ?? null,
        hook
      }))
  })
}

export async function listEnabledGatewayExtensionTargets(
  hook: PluginGatewayExtensionHook,
  providerCode?: string | null
): Promise<PluginGatewayExtensionTarget[]> {
  if (!PLUGIN_GATEWAY_EXTENSION_HOOKS.includes(hook)) return []
  const plugins = await prisma.plugin.findMany({
    where: { enabled: true, status: 'enabled' },
    include: { versions: { orderBy: { installedAt: 'desc' }, take: 1 } }
  })

  return plugins.flatMap(plugin => {
    const manifest = plugin.versions[0]?.manifest as unknown as PayIncusPluginManifest | undefined
    return (manifest?.capabilities?.gatewayExtensions || [])
      .filter(extension => typeof extension.hooks[hook] === 'string')
      .filter(extension => !providerCode || !extension.providerCode || extension.providerCode === providerCode)
      .map(extension => ({
        pluginId: plugin.pluginId,
        gatewayExtensionKey: extension.key,
        name: extension.name,
        providerCode: extension.providerCode ?? null,
        hook
      }))
  })
}

export async function dispatchPluginServiceExtension(input: PluginServiceExtensionDispatchInput): Promise<PluginServiceExtensionDispatchResult> {
  const manifest = await loadEnabledPluginManifest(input.pluginId)
  const resolved = resolveServiceExtensionAction(manifest, input.hook, input.serviceExtensionKey)
  await createPluginEvent(input.pluginId, input.actor.id, 'plugin.service-extension.dispatch', 'pending', `${input.hook} -> ${resolved.actionName}`)
  try {
    const action = await executePluginAction({
      pluginId: input.pluginId,
      manifest,
      actionName: resolved.actionName,
      actor: input.actor,
      payload: buildPluginServiceExtensionContractPayload({
        hook: input.hook,
        serviceExtensionKey: resolved.extension.key,
        productId: resolved.extension.productId ?? null,
        payload: input.payload ?? null
      }),
      source: 'system',
      idempotencyKey: input.idempotencyKey ?? null
    })
    const contract = normalizePluginExtensionContractResult(action.result)
    await createPluginEvent(
      input.pluginId,
      input.actor.id,
      'plugin.service-extension.dispatch',
      contract.accepted ? 'success' : 'failed',
      `${input.hook} request ${action.requestId}: ${contract.status}${contract.message ? ` - ${contract.message}` : ''}`
    )
    return {
      pluginId: input.pluginId,
      serviceExtensionKey: resolved.extension.key,
      hook: input.hook,
      action,
      contract
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await createPluginEvent(input.pluginId, input.actor.id, 'plugin.service-extension.dispatch', 'failed', `${input.hook}: ${message}`)
    throw new PluginExtensionDispatchError(400, 'PLUGIN_SERVICE_ACTION_FAILED', message)
  }
}

export async function dispatchPluginGatewayExtension(input: PluginGatewayExtensionDispatchInput): Promise<PluginGatewayExtensionDispatchResult> {
  const manifest = await loadEnabledPluginManifest(input.pluginId)
  const resolved = resolveGatewayExtensionAction(manifest, input.hook, input.gatewayExtensionKey)
  await createPluginEvent(input.pluginId, input.actor.id, 'plugin.gateway-extension.dispatch', 'pending', `${input.hook} -> ${resolved.actionName}`)
  try {
    const action = await executePluginAction({
      pluginId: input.pluginId,
      manifest,
      actionName: resolved.actionName,
      actor: input.actor,
      payload: buildPluginGatewayExtensionContractPayload({
        hook: input.hook,
        gatewayExtensionKey: resolved.extension.key,
        providerCode: resolved.extension.providerCode ?? null,
        payload: input.payload ?? null
      }),
      source: 'system',
      idempotencyKey: input.idempotencyKey ?? null
    })
    const contract = normalizePluginExtensionContractResult(action.result)
    await createPluginEvent(
      input.pluginId,
      input.actor.id,
      'plugin.gateway-extension.dispatch',
      contract.accepted ? 'success' : 'failed',
      `${input.hook} request ${action.requestId}: ${contract.status}${contract.message ? ` - ${contract.message}` : ''}`
    )
    return {
      pluginId: input.pluginId,
      gatewayExtensionKey: resolved.extension.key,
      hook: input.hook,
      action,
      contract
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await createPluginEvent(input.pluginId, input.actor.id, 'plugin.gateway-extension.dispatch', 'failed', `${input.hook}: ${message}`)
    throw new PluginExtensionDispatchError(400, 'PLUGIN_GATEWAY_ACTION_FAILED', message)
  }
}
