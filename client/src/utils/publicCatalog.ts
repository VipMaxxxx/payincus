export type PackageSource = 'official' | 'market' | `zone:${number}`
export type PackageSourceRequest = {
  source: 'official' | 'market' | 'zone'
  zoneId?: number
}

export interface PublicPackagePlan {
  id: number
  name: string
  description: string | null
  cpu: number
  memory: number
  disk: number
  portLimit: number
  snapshotLimit: number
  backupLimit: number
  siteLimit: number
  swapSize: number
  trafficLimit: string
  trafficLimitSpeed: string
  price: number
  billingCycle: number
  setupFee: number
  slaGuarantee: number | null
  isSoldOut: boolean
  monthlyPrice: number
}

export interface PublicPackage {
  id: number
  name: string
  description: string | null
  cpu_max: number
  memory_max: number
  disk_max: number
  monthly_traffic_limit: string | null
  network_mode: string
  instance_type: string
  host_ids: number[]
  privileged: number
  nested: number
  sourceType: 'official' | 'market'
  soldOut: boolean
  isPaid: boolean
  plans: PublicPackagePlan[]
}

export interface PublicRegion {
  code: string
  name: string
  packageIds: number[]
  hostCount: number
}

function getQueryString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined
  }
  return typeof value === 'string' ? value : undefined
}

export function normalizePackageSourceQuery(value: unknown, zoneIdValue?: unknown): PackageSource {
  const query = getQueryString(value)
  if (query === 'market') return 'market'
  if (query === 'zone') {
    const zoneId = parsePackageIdQuery(zoneIdValue)
    return zoneId ? `zone:${zoneId}` : 'official'
  }
  if (query?.startsWith('zone:')) {
    const zoneId = Number(query.slice('zone:'.length))
    return Number.isInteger(zoneId) && zoneId > 0 ? `zone:${zoneId}` : 'official'
  }
  return 'official'
}

export function toPackageSourceRequest(source: PackageSource): PackageSourceRequest {
  if (source.startsWith('zone:')) {
    const zoneId = Number(source.slice('zone:'.length))
    return { source: 'zone', zoneId }
  }
  return { source: source === 'market' ? 'market' : 'official' }
}

export function parsePackageIdQuery(value: unknown): number | null {
  const query = getQueryString(value)
  if (!query) {
    return null
  }

  const parsed = Number(query)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseTextQuery(value: unknown): string {
  return getQueryString(value)?.trim() || ''
}

export function formatPublicTraffic(bytes: string | null, unlimitedLabel: string): string {
  if (!bytes || bytes === '0') {
    return unlimitedLabel
  }

  const value = BigInt(bytes)
  const tb = BigInt(1024 * 1024 * 1024 * 1024)
  const gb = BigInt(1024 * 1024 * 1024)

  if (value >= tb) {
    return `${(Number(value) / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`
  }

  if (value >= gb) {
    return `${(Number(value) / (1024 * 1024 * 1024)).toFixed(0)} GB`
  }

  return `${(Number(value) / (1024 * 1024)).toFixed(0)} MB`
}

export function formatPublicPrice(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function getStartingMonthlyPrice(pkg: Pick<PublicPackage, 'isPaid' | 'plans'>): number | null {
  if (!pkg.isPaid || pkg.plans.length === 0) {
    return null
  }

  const availablePlans = pkg.plans.filter(plan => !plan.isSoldOut)
  const pricePlans = availablePlans.length > 0 ? availablePlans : pkg.plans

  return pricePlans.reduce((minPrice, plan) => {
    if (plan.monthlyPrice < minPrice) {
      return plan.monthlyPrice
    }
    return minPrice
  }, pricePlans[0].monthlyPrice)
}
