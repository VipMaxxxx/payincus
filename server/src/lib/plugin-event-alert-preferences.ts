import { prisma } from '../db/prisma.js'

export type PluginEventAlertMinimumLevel = 'warning' | 'critical'

export interface PluginEventAlertPreference {
  pluginId: string
  enabled: boolean
  minimumLevel: PluginEventAlertMinimumLevel
  cooldownMinutes: number
  notifyOnDeadLetter: boolean
  notifyOnDueRetry: boolean
  notifyOnSuccessRateBelow: boolean
  successRateThreshold: number
  recentWindowHours: number
  updatedAt: string | null
}

export interface PluginEventAlertPreferenceInput {
  enabled?: unknown
  minimumLevel?: unknown
  cooldownMinutes?: unknown
  notifyOnDeadLetter?: unknown
  notifyOnDueRetry?: unknown
  notifyOnSuccessRateBelow?: unknown
  successRateThreshold?: unknown
  recentWindowHours?: unknown
}

export const DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE = {
  enabled: true,
  minimumLevel: 'warning' as PluginEventAlertMinimumLevel,
  cooldownMinutes: 360,
  notifyOnDeadLetter: true,
  notifyOnDueRetry: true,
  notifyOnSuccessRateBelow: true,
  successRateThreshold: 95,
  recentWindowHours: 24
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function normalizeInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (value < min || value > max) return undefined
  return value
}

function normalizeMinimumLevel(value: unknown): PluginEventAlertMinimumLevel | undefined {
  return value === 'warning' || value === 'critical' ? value : undefined
}

export function normalizePluginEventAlertPreferenceInput(input: PluginEventAlertPreferenceInput): typeof DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE {
  return {
    enabled: normalizeBoolean(input.enabled) ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.enabled,
    minimumLevel: normalizeMinimumLevel(input.minimumLevel) ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.minimumLevel,
    cooldownMinutes: normalizeInteger(input.cooldownMinutes, 15, 1440) ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.cooldownMinutes,
    notifyOnDeadLetter: normalizeBoolean(input.notifyOnDeadLetter) ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.notifyOnDeadLetter,
    notifyOnDueRetry: normalizeBoolean(input.notifyOnDueRetry) ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.notifyOnDueRetry,
    notifyOnSuccessRateBelow: normalizeBoolean(input.notifyOnSuccessRateBelow) ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.notifyOnSuccessRateBelow,
    successRateThreshold: normalizeInteger(input.successRateThreshold, 50, 100) ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.successRateThreshold,
    recentWindowHours: normalizeInteger(input.recentWindowHours, 1, 168) ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.recentWindowHours
  }
}

export function serializePluginEventAlertPreference(pluginId: string, preference?: {
  enabled: boolean
  minimumLevel: string
  cooldownMinutes: number
  notifyOnDeadLetter: boolean
  notifyOnDueRetry: boolean
  notifyOnSuccessRateBelow: boolean
  successRateThreshold: number
  recentWindowHours: number
  updatedAt: Date
} | null): PluginEventAlertPreference {
  return {
    pluginId,
    enabled: preference?.enabled ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.enabled,
    minimumLevel: normalizeMinimumLevel(preference?.minimumLevel) ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.minimumLevel,
    cooldownMinutes: preference?.cooldownMinutes ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.cooldownMinutes,
    notifyOnDeadLetter: preference?.notifyOnDeadLetter ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.notifyOnDeadLetter,
    notifyOnDueRetry: preference?.notifyOnDueRetry ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.notifyOnDueRetry,
    notifyOnSuccessRateBelow: preference?.notifyOnSuccessRateBelow ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.notifyOnSuccessRateBelow,
    successRateThreshold: preference?.successRateThreshold ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.successRateThreshold,
    recentWindowHours: preference?.recentWindowHours ?? DEFAULT_PLUGIN_EVENT_ALERT_PREFERENCE.recentWindowHours,
    updatedAt: preference?.updatedAt.toISOString() ?? null
  }
}

export async function listPluginEventAlertPreferences(userId: number, pluginIds: string[]): Promise<PluginEventAlertPreference[]> {
  if (pluginIds.length === 0) return []
  const preferences = await prisma.pluginEventAlertPreference.findMany({
    where: { userId, pluginId: { in: pluginIds } }
  })
  const byPluginId = new Map(preferences.map(preference => [preference.pluginId, preference]))
  return pluginIds.map(pluginId => serializePluginEventAlertPreference(pluginId, byPluginId.get(pluginId)))
}

export async function getPluginEventAlertPreference(userId: number, pluginId: string): Promise<PluginEventAlertPreference> {
  const preference = await prisma.pluginEventAlertPreference.findUnique({
    where: { userId_pluginId: { userId, pluginId } }
  })
  return serializePluginEventAlertPreference(pluginId, preference)
}

export async function upsertPluginEventAlertPreference(
  userId: number,
  pluginId: string,
  input: PluginEventAlertPreferenceInput
): Promise<PluginEventAlertPreference> {
  const normalized = normalizePluginEventAlertPreferenceInput(input)
  const preference = await prisma.pluginEventAlertPreference.upsert({
    where: { userId_pluginId: { userId, pluginId } },
    create: {
      userId,
      pluginId,
      ...normalized
    },
    update: normalized
  })
  return serializePluginEventAlertPreference(pluginId, preference)
}
