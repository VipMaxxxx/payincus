import { getSystemConfig, getSystemConfigNumber } from '../db/system-config.js'

const DEFAULT_PLUGIN_MARKET_TRUSTED_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'payincus.com',
  'payincus.github.io'
]

function envFirst(keys: string | string[]): string {
  const envKeys = Array.isArray(keys) ? keys : [keys]
  for (const key of envKeys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

function splitCsv(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

export async function getRuntimeConfigString(
  configKey: string,
  envKeys: string | string[],
  fallback = ''
): Promise<string> {
  const dbValue = (await getSystemConfig(configKey))?.trim()
  if (dbValue) return dbValue
  return envFirst(envKeys) || fallback
}

export async function getRuntimeConfigBoolean(
  configKey: string,
  envKey: string,
  fallback = false
): Promise<boolean> {
  const dbValue = await getSystemConfig(configKey)
  if (dbValue === 'true' || dbValue === '1') return true
  if (dbValue === 'false' || dbValue === '0') return false
  const envValue = process.env[envKey]?.trim().toLowerCase()
  if (envValue === 'true' || envValue === '1' || envValue === 'yes') return true
  if (envValue === 'false' || envValue === '0' || envValue === 'no') return false
  return fallback
}

export async function getRuntimeConfigNumber(
  configKey: string,
  envKey: string,
  fallback: number,
  min: number,
  max: number
): Promise<number> {
  const dbValue = await getSystemConfigNumber(configKey, Number.NaN)
  if (Number.isInteger(dbValue) && dbValue >= min && dbValue <= max) return dbValue
  const envValue = Number(process.env[envKey])
  if (Number.isInteger(envValue) && envValue >= min && envValue <= max) return envValue
  return fallback
}

export async function getCombinedAdminIdAllowlist(
  configKey: string,
  envKeys: string | string[]
): Promise<{ ids: Set<number>; configured: boolean }> {
  const ids = new Set<number>()
  const rawValues = [
    await getSystemConfig(configKey),
    envFirst(envKeys)
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  for (const raw of rawValues) {
    for (const part of splitCsv(raw)) {
      const id = Number(part)
      if (Number.isSafeInteger(id) && id > 0) ids.add(id)
    }
  }

  return { ids, configured: rawValues.length > 0 }
}

export async function getPluginMarketIndexUrl(): Promise<string> {
  return getRuntimeConfigString(
    'plugin_market_index_url',
    'PLUGIN_MARKET_INDEX_URL',
    'https://payincus.com/plugin-market/index.json'
  )
}

export async function getThemeMarketIndexUrl(): Promise<string> {
  return getRuntimeConfigString(
    'theme_market_index_url',
    'THEME_MARKET_INDEX_URL',
    'https://payincus.com/theme-market/index.json'
  )
}

export async function getPluginMarketTrustedHosts(): Promise<Set<string>> {
  const configured = [
    ...splitCsv(await getSystemConfig('plugin_market_trusted_hosts')),
    ...splitCsv(envFirst('PLUGIN_MARKET_TRUSTED_HOSTS'))
  ].map(host => host.toLowerCase())
  return new Set([...DEFAULT_PLUGIN_MARKET_TRUSTED_HOSTS, ...configured])
}

export async function getThemeMarketTrustedHosts(): Promise<Set<string>> {
  const configured = [
    ...splitCsv(await getSystemConfig('theme_market_trusted_hosts')),
    ...splitCsv(envFirst('THEME_MARKET_TRUSTED_HOSTS')),
    ...splitCsv(await getSystemConfig('plugin_market_trusted_hosts')),
    ...splitCsv(envFirst('PLUGIN_MARKET_TRUSTED_HOSTS'))
  ].map(host => host.toLowerCase())
  return new Set([...DEFAULT_PLUGIN_MARKET_TRUSTED_HOSTS, ...configured])
}

export async function getPluginSubmissionPublicBaseUrl(requestFallback: string): Promise<string> {
  return (await getRuntimeConfigString(
    'plugin_submission_public_base_url',
    ['PLUGIN_SUBMISSION_PUBLIC_BASE_URL', 'SITE_URL', 'FRONTEND_URL'],
    requestFallback
  )).replace(/\/+$/, '')
}
