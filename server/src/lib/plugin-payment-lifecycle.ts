import { createHash } from 'crypto'
import {
  dispatchPluginGatewayExtension,
  listEnabledGatewayExtensionTargets
} from './plugin-extension-dispatch.js'
import type { PluginGatewayExtensionHook } from './plugin-manifest.js'
import type { PluginRuntimeActor } from './plugin-runtime.js'

const PAYMENT_DETAILS_SUMMARY_KEYS = new Set([
  'kind',
  'currency',
  'network',
  'token',
  'paymentMethod',
  'feeMode',
  'payableAmount',
  'invoiceAmount'
])

export interface GatewayPaymentLifecycleInput {
  hook: PluginGatewayExtensionHook
  providerCode?: string | null
  providerId: number
  orderNo: string
  rechargeId?: number | null
  userId: number
  amount: number
  payableAmount?: number | null
  actualAmount?: number | null
  fee?: number | null
  status: string
  paymentMethod?: string | null
  source: string
  tradeNo?: string | null
  payUrl?: string | null
  failureReason?: string | null
  paymentDetails?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  actor?: PluginRuntimeActor
}

function normalizeScalar(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return null
}

function normalizeMoney(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Math.round(value * 100) / 100
}

function normalizeProviderCode(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

function maskExternalReference(value: string | null | undefined): Record<string, string> | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null
  return {
    sha256: createHash('sha256').update(trimmed).digest('hex'),
    suffix: trimmed.slice(-8)
  }
}

function buildPaymentDetailsSummary(details: Record<string, unknown> | null | undefined): Record<string, string | number | boolean | null> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {}
  const summary: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(details)) {
    if (!PAYMENT_DETAILS_SUMMARY_KEYS.has(key)) continue
    const scalar = normalizeScalar(value)
    if (scalar !== null) summary[key] = scalar
  }
  return summary
}

function buildGatewayPaymentLifecyclePayload(input: GatewayPaymentLifecycleInput): Record<string, unknown> {
  const providerCode = normalizeProviderCode(input.providerCode)
  return {
    lifecycleEvent: `payment.${input.hook}`,
    providerId: input.providerId,
    providerCode,
    orderNo: input.orderNo,
    rechargeId: input.rechargeId ?? null,
    userId: input.userId,
    amount: normalizeMoney(input.amount),
    payableAmount: normalizeMoney(input.payableAmount),
    actualAmount: normalizeMoney(input.actualAmount),
    fee: normalizeMoney(input.fee),
    status: input.status,
    paymentMethod: input.paymentMethod ?? null,
    source: input.source,
    externalReference: maskExternalReference(input.tradeNo),
    payUrl: input.payUrl ?? null,
    failureReason: input.failureReason ?? null,
    paymentDetails: buildPaymentDetailsSummary(input.paymentDetails),
    metadata: input.metadata ?? {},
    occurredAt: new Date().toISOString()
  }
}

export function dispatchGatewayPaymentLifecycle(input: GatewayPaymentLifecycleInput): void {
  void dispatchGatewayPaymentLifecycleHooks(input).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[PluginGatewayExtension] lifecycle dispatch failed for ${input.hook}:${input.orderNo}: ${message}`)
  })
}

async function dispatchGatewayPaymentLifecycleHooks(input: GatewayPaymentLifecycleInput): Promise<void> {
  const providerCode = normalizeProviderCode(input.providerCode)
  const targets = await listEnabledGatewayExtensionTargets(input.hook, providerCode)
  if (targets.length === 0) return

  const payload = buildGatewayPaymentLifecyclePayload(input)
  const actor = input.actor || { id: null, role: 'system' as const }
  const idempotencyBase = `${input.orderNo}:${input.hook}:${input.source}:${input.status}`

  for (const target of targets) {
    try {
      await dispatchPluginGatewayExtension({
        pluginId: target.pluginId,
        hook: input.hook,
        gatewayExtensionKey: target.gatewayExtensionKey,
        payload,
        idempotencyKey: `gateway-lifecycle:${idempotencyBase}:${target.pluginId}:${target.gatewayExtensionKey}`,
        actor
      })
    } catch {
      // dispatchPluginGatewayExtension records the failed plugin event; payment state is never rolled back here.
    }
  }
}
