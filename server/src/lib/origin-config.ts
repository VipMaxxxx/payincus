function parseOriginList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
}

export function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin
  } catch {
    return null
  }
}

export function getConfiguredOrigins(): string[] {
  return Array.from(new Set(
    parseOriginList(process.env.CORS_ORIGINS || process.env.FRONTEND_URL)
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin))
  ))
}

export function getCorsOrigins(): string[] | false {
  const configuredOrigins = getConfiguredOrigins()

  if (process.env.NODE_ENV === 'production') {
    return configuredOrigins.length > 0 ? configuredOrigins : false
  }

  return Array.from(new Set([
    ...configuredOrigins,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]))
}

export function getAllowedWebSocketOrigins(): string[] {
  const configuredOrigins = getConfiguredOrigins()

  if (process.env.NODE_ENV === 'production') {
    return configuredOrigins
  }

  return Array.from(new Set([
    ...configuredOrigins,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001'
  ]))
}
