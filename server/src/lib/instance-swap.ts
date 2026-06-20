function normalizeConfiguredSwapSize(sizeMb: number | null | undefined): number | null {
  if (sizeMb === null || sizeMb === undefined) {
    return null
  }

  return Math.max(0, Math.floor(sizeMb))
}

export function resolveEffectiveSwapSize(
  instanceSizeMb: number | null | undefined,
  planSizeMb: number | null | undefined
): number {
  const normalizedInstanceSize = normalizeConfiguredSwapSize(instanceSizeMb)
  if (normalizedInstanceSize !== null) {
    return normalizedInstanceSize
  }

  return normalizeConfiguredSwapSize(planSizeMb) ?? 0
}

export function shouldSyncInstanceSwapSizeWithPlan(
  instanceSizeMb: number | null | undefined,
  previousPlanSizeMb: number | null | undefined
): boolean {
  const normalizedInstanceSize = normalizeConfiguredSwapSize(instanceSizeMb)
  if (normalizedInstanceSize === null) {
    return true
  }

  return normalizedInstanceSize === (normalizeConfiguredSwapSize(previousPlanSizeMb) ?? 0)
}

export function formatIncusSwapLimit(sizeMb: number): string {
  return `${Math.max(0, Math.floor(sizeMb))}MiB`
}

export function resolveIncusSwapValue(enabled: boolean, sizeMb: number | null | undefined): string {
  if (!enabled || !sizeMb || sizeMb <= 0) {
    return 'false'
  }

  return formatIncusSwapLimit(sizeMb)
}
