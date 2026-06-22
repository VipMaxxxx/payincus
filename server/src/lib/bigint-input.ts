export const POSTGRES_BIGINT_MAX = 9223372036854775807n

export function parseNullablePostgresBigIntInput(value: unknown): bigint | null | undefined {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    return undefined
  }

  const parsed = BigInt(trimmed)
  return parsed <= POSTGRES_BIGINT_MAX ? parsed : undefined
}

export function parseRequiredPostgresBigIntInput(value: unknown): bigint | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    return undefined
  }

  const parsed = BigInt(trimmed)
  return parsed <= POSTGRES_BIGINT_MAX ? parsed : undefined
}
