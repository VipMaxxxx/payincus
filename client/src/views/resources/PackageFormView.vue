<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import type { Host, HostWithDetails, Package, CreatePackageRequest, UpdatePackageRequest } from '@/types/api'
import { validateName, validateText } from '@/utils/validation'
import { translateError } from '@/utils/errorHandler'
import { packagesPath } from '@/utils/app-paths'

// 为 KeepAlive exclude 匹配定义组件名称
defineOptions({
  name: 'PackageFormView'
})

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()

// Mode: create or edit
const isEditMode = computed(() => !!route.params.id)
const packageId = computed(() => route.params.id ? Number(route.params.id) : null)
type PackageCreationMode = 'free' | 'paid'
const packageCreationMode = ref<PackageCreationMode>('free')
const showPackageLevelInstanceDefaults = computed(() => isEditMode.value || packageCreationMode.value === 'free')

// Loading states
const loading = ref(false)
const saving = ref(false)
type HostScope = 'official' | 'hosted'
type PackageHostOption = Host & {
  countryCode?: string
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  owner?: HostWithDetails['owner']
}

const hosts = ref<PackageHostOption[]>([])
const allKnownHosts = ref<PackageHostOption[]>([])
const hostsLoading = ref(false)
const hostScope = ref<HostScope>('official')
const hostSearchInput = ref('')
const hostSearchQuery = ref('')
const prerequisitePackages = ref<Package[]>([])
const currentPackageOwnerId = ref<number | null>(authStore.user?.id ?? null)

const prerequisitePackageOptions = computed(() => {
  const ownerId = currentPackageOwnerId.value ?? authStore.user?.id ?? null
  const currentPackageId = packageId.value
  const requiredPackageById = new Map(
    prerequisitePackages.value.map(pkg => [pkg.id, pkg.required_package_id ?? null])
  )
  const wouldCreateCycle = (candidateId: number): boolean => {
    if (!currentPackageId) return false

    let cursor = requiredPackageById.get(candidateId) ?? null
    const visited = new Set<number>()

    while (cursor !== null) {
      if (cursor === currentPackageId) return true
      if (visited.has(cursor)) return false
      visited.add(cursor)
      cursor = requiredPackageById.get(cursor) ?? null
    }

    return false
  }

  return prerequisitePackages.value.filter(pkg => {
    if (pkg.id === currentPackageId) return false
    if (wouldCreateCycle(pkg.id)) return false
    if (ownerId === null) return pkg.isOwn === true
    return pkg.ownerId === ownerId || pkg.owner?.id === ownerId
  })
})

interface HostStoragePoolOption {
  name: string
  driver: string
  description: string
  status: string
  purpose?: 'instance_data' | 'instance_storage' | null
}

const storagePoolsByHost = ref<Record<number, HostStoragePoolOption[]>>({})
const storagePoolsLoadingByHost = ref<Record<number, boolean>>({})



// Form data
interface PackageForm {
  name: string
  description: string
  cpuMax: number
  memoryMax: number
  diskMax: number
  hostIds: number[]
  hostStoragePools: Record<string, string>
  hostTrafficMultipliers: Record<string, number>
  networkMode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | 'public_ipv4' | 'public_ipv4_ipv6'
  instanceType: 'container' | 'vm'  // 实例类型
  privileged: boolean
  nested: boolean
  active: boolean
  monthlyTrafficLimitGB: string
  trafficResetPrice: number
  // 实例配额
  portLimit: number | null
  snapshotLimit: number | null
  siteLimit: number | null
  // Storage I/O
  ioLimitMode: 'throughput' | 'iops'
  limitsRead: string
  limitsReadUnit: string
  limitsWrite: string
  limitsWriteUnit: string
  limitsReadIops: number
  limitsWriteIops: number
  // Network
  limitsIngress: string
  limitsIngressUnit: string
  limitsEgress: string
  limitsEgressUnit: string
  // Process/CPU
  limitsProcesses: number
  limitsCpuPriority: number
  // Boot settings
  bootAutostart: boolean
  bootAutostartPriority: number
  bootAutostartDelay: number
  bootHostShutdownTimeout: number
  // Global sharing
  globalShared: boolean
  globalMaxInstances: number
  requiredPackageId: number | null
}

const form = ref<PackageForm>(getDefaultForm())
const formError = ref('')

// Storage units
const storageUnits = ['B', 'kB', 'MB', 'GB', 'TB', 'PB']
const networkUnits = ['Mbit']
const publicPackageMaxInstanceOptions = [1, 2, 3, 4, 5]
const MAX_TRAFFIC_RESET_PRICE = 999999.99

// 网络模式（旧 IPv6 NAT 模式仅保留历史数据兼容，不再作为新套餐选项）
const networkModes = [
  { value: 'nat', labelKey: 'common.networkMode.nat' },
  { value: 'nat_ipv6', labelKey: 'common.networkMode.nat_ipv6' },
  { value: 'ipv6_only', labelKey: 'common.networkMode.ipv6_only' },
  { value: 'public_ipv4', labelKey: 'common.networkMode.public_ipv4' },
  { value: 'public_ipv4_ipv6', labelKey: 'common.networkMode.public_ipv4_ipv6' }
]
const disallowedKvmNetworkModes = new Set(['nat_ipv6_nat', 'ipv6_nat'])
const availableNetworkModes = computed(() => {
  if (form.value.instanceType === 'vm') {
    return networkModes.filter(mode => !disallowedKvmNetworkModes.has(mode.value))
  }
  return networkModes
})

const selectedHostIdSet = computed(() => new Set(form.value.hostIds))
const selectedKnownHosts = computed(() => {
  return form.value.hostIds
    .map(id => getHostById(id))
    .filter((host): host is PackageHostOption => host !== null)
})
const selectedUnknownHostIds = computed(() => form.value.hostIds.filter(id => !getHostById(id)))
const displayedHosts = computed(() => {
  const query = hostSearchQuery.value.trim().toLowerCase()
  if (!query) return hosts.value

  return hosts.value.filter(host => {
    const fields = [
      host.name,
      host.location,
      host.url,
      getHostCountryCode(host),
      getHostOwnerLabel(host)
    ]
    return fields.some(value => String(value || '').toLowerCase().includes(query))
  })
})
const hasHostSearch = computed(() => hostSearchQuery.value.trim().length > 0)

watch(() => form.value.instanceType, (instanceType) => {
  if (instanceType === 'vm' && disallowedKvmNetworkModes.has(form.value.networkMode)) {
    form.value.networkMode = 'nat'
  }
}, { immediate: true })

function resetPackageLevelInstanceDefaults(): void {
  const defaults = getDefaultForm()
  form.value.cpuMax = defaults.cpuMax
  form.value.memoryMax = defaults.memoryMax
  form.value.diskMax = defaults.diskMax
  form.value.monthlyTrafficLimitGB = defaults.monthlyTrafficLimitGB
  form.value.portLimit = defaults.portLimit
  form.value.snapshotLimit = defaults.snapshotLimit
  form.value.siteLimit = defaults.siteLimit
  form.value.limitsIngress = defaults.limitsIngress
  form.value.limitsIngressUnit = defaults.limitsIngressUnit
  form.value.limitsEgress = defaults.limitsEgress
  form.value.limitsEgressUnit = defaults.limitsEgressUnit
}

watch(packageCreationMode, (mode) => {
  if (!isEditMode.value && mode === 'paid') {
    resetPackageLevelInstanceDefaults()
  }
})

watch(() => form.value.globalShared, (globalShared) => {
  if (globalShared) {
    const value = Number(form.value.globalMaxInstances)
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      form.value.globalMaxInstances = 1
    }
  }
})

function getDefaultForm(): PackageForm {
  return {
    name: '',
    description: '',
    cpuMax: 100,
    memoryMax: 4096,
    diskMax: 51200,
    hostIds: [],
    hostStoragePools: {},
    hostTrafficMultipliers: {},
    networkMode: 'nat',
    instanceType: 'container',
    privileged: false,
    nested: false,
    active: true,
    monthlyTrafficLimitGB: '',
    trafficResetPrice: 0,
    // 实例配额默认值
    portLimit: 20,
    snapshotLimit: 10,
    siteLimit: 10,
    // Storage I/O defaults
    ioLimitMode: 'throughput',
    limitsRead: '100',
    limitsReadUnit: 'MB',
    limitsWrite: '100',
    limitsWriteUnit: 'MB',
    limitsReadIops: 500,
    limitsWriteIops: 500,
    // Network defaults
    limitsIngress: '300',
    limitsIngressUnit: 'Mbit',
    limitsEgress: '300',
    limitsEgressUnit: 'Mbit',
    // Process/CPU defaults
    limitsProcesses: 500,
    limitsCpuPriority: 10,
    // Boot settings defaults
    bootAutostart: true,
    bootAutostartPriority: 20,
    bootAutostartDelay: 15,
    bootHostShutdownTimeout: 30,
    // Global sharing defaults
    globalShared: false,
    globalMaxInstances: 1,
    requiredPackageId: null
  }
}

// GB <-> Bytes conversion
const GB_TO_BYTES = BigInt(1024 * 1024 * 1024)

function bytesToGB(bytes: string | null | undefined): string {
  if (!bytes) return ''
  try {
    const b = BigInt(bytes)
    const gb = Number(b / GB_TO_BYTES)
    return gb.toString()
  } catch {
    return ''
  }
}

function gbToBytes(gb: string | number): string | null {
  if (gb === '' || gb === null || gb === undefined) return null
  const str = String(gb).trim()
  if (str === '') return null
  const num = parseFloat(str)
  if (isNaN(num) || num <= 0) return null
  return (BigInt(Math.round(num)) * GB_TO_BYTES).toString()
}

function normalizeTrafficMultiplier(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 1
  return Math.round(Math.min(Math.max(num, 0.001), 100) * 1000) / 1000
}

function normalizeMoneyYuan(value: unknown): number | null {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_TRAFFIC_RESET_PRICE) {
    return null
  }
  const rounded = Math.round(amount * 100) / 100
  if (Math.abs(amount - rounded) >= 1e-8) {
    return null
  }
  return rounded
}

// Parse storage value with unit (e.g., "100MB" -> { value: "100", unit: "MB" })
function parseStorageValue(value: string | null | undefined): { value: string; unit: string } {
  if (!value) return { value: '', unit: 'MB' }
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(B|kB|MB|GB|TB|PB)$/i)
  if (match) {
    return { value: match[1], unit: match[2] }
  }
  return { value: value, unit: 'MB' }
}

// Parse network value with unit (e.g., "300Mbit" -> { value: "300", unit: "Mbit" })
// Only Mbit is supported; legacy Gbit values are automatically converted (×1000).
function parseNetworkValue(value: string | null | undefined): { value: string; unit: string } {
  if (!value) return { value: '', unit: 'Mbit' }
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(Mbit|Gbit)$/i)
  if (match) {
    if (match[2].toLowerCase() === 'gbit') {
      // Convert Gbit → Mbit
      return { value: String(Math.round(Number(match[1]) * 1000)), unit: 'Mbit' }
    }
    return { value: match[1], unit: 'Mbit' }
  }
  return { value: value, unit: 'Mbit' }
}

// Combine value and unit
function combineStorageValue(value: string, unit: string): string {
  if (!value || value.trim() === '') return ''
  return `${value}${unit}`
}

function getSystemStoragePools(hostId: number): HostStoragePoolOption[] {
  return (storagePoolsByHost.value[hostId] || []).filter(pool => pool.purpose === 'instance_data')
}

function rememberHosts(nextHosts: PackageHostOption[]): void {
  const merged = new Map<number, PackageHostOption>()
  allKnownHosts.value.forEach(host => merged.set(host.id, host))
  nextHosts.forEach(host => merged.set(host.id, host))
  allKnownHosts.value = Array.from(merged.values())
}

function getHostById(hostId: number): PackageHostOption | null {
  return allKnownHosts.value.find(item => item.id === hostId) || hosts.value.find(item => item.id === hostId) || null
}

function getSelectedHostLabel(hostId: number): string {
  const host = getHostById(hostId)
  if (!host) return `Host #${hostId}`
  return host.location ? `${host.name} (${host.location})` : host.name
}

function getHostCountryCode(host: PackageHostOption | null): string {
  return host?.countryCode || host?.country_code || 'us'
}

function getHostStatusLabel(status: string | undefined): string {
  if (status === 'online') return t('resources.hosts.online')
  if (status === 'offline') return t('resources.hosts.offline')
  if (status === 'maintenance') return t('resources.hosts.maintenance')
  return status || '-'
}

function getHostStatusClass(status: string | undefined): string {
  if (status === 'online') {
    return themeStore.isDark ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  }
  if (status === 'maintenance') {
    return themeStore.isDark ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30' : 'bg-amber-50 text-amber-700 ring-amber-200'
  }
  return themeStore.isDark ? 'bg-gray-700 text-gray-300 ring-gray-600' : 'bg-gray-100 text-gray-600 ring-gray-200'
}

function getHostOwnerLabel(host: PackageHostOption | null): string {
  if (!host?.owner) return ''
  return `${host.owner.username} UID:${host.owner.id}`
}

function getHostSummary(host: PackageHostOption): string {
  return [
    host.location,
    host.architecture,
    host.instanceType || host.instance_type,
    getHostOwnerLabel(host)
  ].filter(Boolean).join(' · ')
}

function toggleHostSelection(hostId: number): void {
  const selected = new Set(form.value.hostIds)
  if (selected.has(hostId)) {
    selected.delete(hostId)
  } else {
    selected.add(hostId)
  }
  form.value.hostIds = Array.from(selected)
}

function applyHostSearch(): void {
  hostSearchQuery.value = hostSearchInput.value
}

function clearHostSearch(): void {
  hostSearchInput.value = ''
  hostSearchQuery.value = ''
}

async function switchHostScope(scope: HostScope): Promise<void> {
  if (hostScope.value === scope) return
  hostScope.value = scope
  clearHostSearch()
  await loadHosts()
}

async function loadHostStoragePools(hostId: number): Promise<void> {
  if (storagePoolsByHost.value[hostId] || storagePoolsLoadingByHost.value[hostId]) {
    return
  }

  storagePoolsLoadingByHost.value = {
    ...storagePoolsLoadingByHost.value,
    [hostId]: true
  }

  try {
    const response = await api.hosts.getStoragePools(hostId)
    storagePoolsByHost.value = {
      ...storagePoolsByHost.value,
      [hostId]: response.pools || []
    }
  } catch (err) {
    console.error(`Failed to load storage pools for host ${hostId}:`, err)
    storagePoolsByHost.value = {
      ...storagePoolsByHost.value,
      [hostId]: []
    }
  } finally {
    storagePoolsLoadingByHost.value = {
      ...storagePoolsLoadingByHost.value,
      [hostId]: false
    }
  }
}

async function syncHostStoragePoolSelections(hostIds: number[]): Promise<void> {
  const requestedHostIds = [...new Set(hostIds)]
  await Promise.all(requestedHostIds.map(hostId => loadHostStoragePools(hostId)))

  const uniqueHostIds = [...new Set(form.value.hostIds)]
  const nextSelections: Record<string, string> = {}
  for (const hostId of uniqueHostIds) {
    const key = String(hostId)
    const currentSelection = form.value.hostStoragePools[key] || ''
    const systemPools = getSystemStoragePools(hostId)
    const hasCurrentSelection = currentSelection
      ? systemPools.some(pool => pool.name === currentSelection)
      : false

    if (hasCurrentSelection) {
      nextSelections[key] = currentSelection
      continue
    }

    if (systemPools.length === 1) {
      nextSelections[key] = systemPools[0].name
      continue
    }

    nextSelections[key] = ''
  }

  form.value.hostStoragePools = nextSelections

  const nextMultipliers: Record<string, number> = {}
  for (const hostId of uniqueHostIds) {
    const key = String(hostId)
    nextMultipliers[key] = normalizeTrafficMultiplier(form.value.hostTrafficMultipliers[key])
  }
  form.value.hostTrafficMultipliers = nextMultipliers
}

onMounted(async () => {
  await Promise.all([
    loadHosts(),
    loadPrerequisitePackages()
  ])
  if (isEditMode.value && packageId.value) {
    await loadPackage(packageId.value)
  }
})

// 监听路由参数变化，重新加载套餐数据
watch(() => route.params.id, async (newId, oldId) => {
  if (newId !== oldId) {
    // 重置状态
    formError.value = ''
    saving.value = false
    if (newId) {
      loading.value = true
      form.value = getDefaultForm()
      await loadPrerequisitePackages()
      await loadPackage(Number(newId))
    } else {
      // 切换到创建模式
      form.value = getDefaultForm()
      packageCreationMode.value = 'free'
      currentPackageOwnerId.value = authStore.user?.id ?? null
      await loadPrerequisitePackages()
    }
  }
})

watch(() => form.value.hostIds.slice(), (hostIds) => {
  void syncHostStoragePoolSelections(hostIds)
})

async function loadHosts(): Promise<void> {
  hostsLoading.value = true
  try {
    // 管理员可以看到所有节点并绑定任意节点
    // 普通用户只能看到并绑定自己的节点
    const canBindAnyHost = authStore.isAdmin
    // 传递 pageSize 以获取所有宿主机，避免默认分页限制（默认只返回20条）
    const params = canBindAnyHost
      ? { pageSize: '1000', scope: hostScope.value }
      : { mine: 'true', pageSize: '1000' }
    const response = await api.hosts.list(params)
    hosts.value = ((response as { hosts?: PackageHostOption[] }).hosts || [])
    rememberHosts(hosts.value)
  } catch (err) {
    console.error('Failed to load hosts:', err)
  } finally {
    hostsLoading.value = false
  }
}

async function loadPrerequisitePackages(): Promise<void> {
  try {
    const response = await api.packages.list({ all: true })
    prerequisitePackages.value = (response as { packages?: Package[] }).packages || []
  } catch (err) {
    console.error('Failed to load prerequisite packages:', err)
    prerequisitePackages.value = []
  }
}

async function loadPackage(id: number): Promise<void> {
  loading.value = true
  try {
    const response = await api.packages.get(id) as any
    // API 返回 { package: {...} } 格式
    const pkg = response.package || response
    currentPackageOwnerId.value = pkg.ownerId ?? pkg.user_id ?? authStore.user?.id ?? null
    
    // Parse storage I/O values
    const readParsed = parseStorageValue(pkg.limits_read)
    const writeParsed = parseStorageValue(pkg.limits_write)
    const ingressParsed = parseNetworkValue(pkg.limits_ingress)
    const egressParsed = parseNetworkValue(pkg.limits_egress)
    
    form.value = {
      name: pkg.name || '',
      description: pkg.description || '',
      cpuMax: Number(pkg.cpu_max) || 100,
      memoryMax: Number(pkg.memory_max) || 4096,
      diskMax: Number(pkg.disk_max) || 51200,
      hostIds: pkg.host_ids || [],
      hostStoragePools: Object.fromEntries(
        Object.entries((pkg.host_storage_pools || {}) as Record<string, string | null>)
          .map(([hostId, poolName]) => [hostId, poolName || ''])
      ),
      hostTrafficMultipliers: Object.fromEntries(
        Object.entries((pkg.host_traffic_multipliers || {}) as Record<string, number>)
          .map(([hostId, multiplier]) => [hostId, normalizeTrafficMultiplier(multiplier)])
      ),
      networkMode: pkg.network_mode || 'nat',
      instanceType: (pkg.instance_type === 'vm' ? 'vm' : 'container') as 'container' | 'vm',
      // 处理布尔值：可能是 1/0 或 true/false
      privileged: pkg.privileged === 1 || pkg.privileged === true,
      nested: pkg.nested === 1 || pkg.nested === true,
      active: pkg.active === 1 || pkg.active === true,
      monthlyTrafficLimitGB: bytesToGB(pkg.monthly_traffic_limit),
      trafficResetPrice: Number(pkg.traffic_reset_price || 0),
      // 实例配额
      portLimit: pkg.port_limit ?? 20,
      snapshotLimit: pkg.snapshot_limit ?? 10,
      siteLimit: pkg.site_limit ?? 10,
      // Storage I/O
      ioLimitMode: (pkg.io_limit_mode === 'iops' ? 'iops' : 'throughput') as 'throughput' | 'iops',
      limitsRead: readParsed.value || '100',
      limitsReadUnit: readParsed.unit || 'MB',
      limitsWrite: writeParsed.value || '100',
      limitsWriteUnit: writeParsed.unit || 'MB',
      limitsReadIops: Number(pkg.limits_read_iops) || 500,
      limitsWriteIops: Number(pkg.limits_write_iops) || 500,
      // Network
      limitsIngress: ingressParsed.value || '300',
      limitsIngressUnit: ingressParsed.unit || 'Mbit',
      limitsEgress: egressParsed.value || '300',
      limitsEgressUnit: egressParsed.unit || 'Mbit',
      // Process/CPU
      limitsProcesses: Number(pkg.limits_processes) || 500,
      limitsCpuPriority: Number(pkg.limits_cpu_priority) || 10,
      // Boot settings
      bootAutostart: pkg.boot_autostart === 1 || pkg.boot_autostart === true || pkg.boot_autostart == null,
      bootAutostartPriority: Number(pkg.boot_autostart_priority) || 20,
      bootAutostartDelay: Number(pkg.boot_autostart_delay) || 15,
      bootHostShutdownTimeout: Number(pkg.boot_host_shutdown_timeout) || 30,
      // Global sharing
      globalShared: pkg.global_shared === true || pkg.global_shared === 1,
      globalMaxInstances: Number.isInteger(Number(pkg.global_max_instances)) && Number(pkg.global_max_instances) >= 1 && Number(pkg.global_max_instances) <= 5 ? Number(pkg.global_max_instances) : 1,
      requiredPackageId: pkg.required_package_id ?? null
    }
  } catch (_err: any) {
    toast.error(t('admin.packages.loadFailed') || 'Failed to load package')
    router.push(packagesPath())
  } finally {
    loading.value = false
  }
}

async function savePackage(): Promise<void> {
  formError.value = ''
  
  // Validation
  if (!form.value.name) {
    formError.value = t('admin.packages.enterName')
    return
  }

  const nameValidation = validateName(form.value.name, t('admin.packages.name'), 2, 64)
  if (!nameValidation.valid) {
    formError.value = nameValidation.message || t('admin.packages.enterName')
    return
  }

  if (form.value.description) {
    const descValidation = validateText(form.value.description, t('admin.packages.descLabel'), 500)
    if (!descValidation.valid) {
      formError.value = descValidation.message || ''
      return
    }
  }

  if (!form.value.hostIds || form.value.hostIds.length === 0) {
    formError.value = t('admin.packages.mustBindHost')
    return
  }

  // 确保数值字段有有效值（处理空字符串或 NaN 的情况）
  const cpuPriority = Number(form.value.limitsCpuPriority) || 10
  const bootPriority = Number(form.value.bootAutostartPriority) || 20
  const startupDelay = Number(form.value.bootAutostartDelay) || 15
  const shutdownTimeout = Number(form.value.bootHostShutdownTimeout) || 30

  // Validate CPU priority (0-10)
  if (cpuPriority < 0 || cpuPriority > 10) {
    formError.value = t('packageForm.validation.cpuPriorityRange')
    return
  }

  // Validate boot priority (0-100)
  if (bootPriority < 0 || bootPriority > 100) {
    formError.value = t('packageForm.validation.bootPriorityRange')
    return
  }

  // Validate startup delay (5-600)
  if (startupDelay < 5 || startupDelay > 600) {
    formError.value = t('packageForm.validation.startupDelayRange')
    return
  }

  // Validate shutdown timeout (30-600)
  if (shutdownTimeout < 30 || shutdownTimeout > 600) {
    formError.value = t('packageForm.validation.shutdownTimeoutRange')
    return
  }

  // Validate port limit (must be >= 1, cannot be 0)
  if (form.value.portLimit !== null && form.value.portLimit !== undefined) {
    if (form.value.portLimit < 1) {
      formError.value = t('packageForm.validation.portLimitMin')
      return
    }
  }

  const globalMaxInstances = Number(form.value.globalMaxInstances)
  if (form.value.globalShared && (!Number.isInteger(globalMaxInstances) || globalMaxInstances < 1 || globalMaxInstances > 5)) {
    formError.value = t('packageForm.validation.globalMaxInstancesRange')
    return
  }

  const trafficResetPriceYuan = normalizeMoneyYuan(form.value.trafficResetPrice)
  if (trafficResetPriceYuan === null) {
    formError.value = `流量重置价格必须在 0-${MAX_TRAFFIC_RESET_PRICE.toFixed(2)} 元之间，且最多两位小数`
    return
  }

  // 更新表单值为验证后的数值
  form.value.limitsCpuPriority = cpuPriority
  form.value.bootAutostartPriority = bootPriority
  form.value.bootAutostartDelay = startupDelay
  form.value.bootHostShutdownTimeout = shutdownTimeout

  saving.value = true

  try {
    const trafficLimitBytes = gbToBytes(form.value.monthlyTrafficLimitGB)
    const hostStoragePools = Object.fromEntries(
      form.value.hostIds.map(hostId => {
        const selectedPool = form.value.hostStoragePools[String(hostId)] || ''
        return [String(hostId), selectedPool.trim() || null]
      })
    )
    const hostTrafficMultipliers = Object.fromEntries(
      form.value.hostIds.map(hostId => [
        String(hostId),
        normalizeTrafficMultiplier(form.value.hostTrafficMultipliers[String(hostId)])
      ])
    )
    
    const data: CreatePackageRequest | UpdatePackageRequest = {
      name: form.value.name,
      description: form.value.description || undefined,
      cpuMax: form.value.cpuMax,
      memoryMax: form.value.memoryMax,
      diskMax: form.value.diskMax,
      hostIds: form.value.hostIds,
      hostStoragePools,
      hostTrafficMultipliers,
      networkMode: form.value.networkMode,
      instanceType: form.value.instanceType,
      privileged: form.value.privileged,
      nested: form.value.nested,
      active: form.value.active,
      monthlyTrafficLimit: trafficLimitBytes,
      trafficResetPrice: trafficResetPriceYuan,
      // 实例配额
      portLimit: form.value.portLimit ?? undefined,
      snapshotLimit: form.value.snapshotLimit ?? undefined,
      siteLimit: form.value.siteLimit ?? undefined,
      // Storage I/O
      ioLimitMode: form.value.ioLimitMode,
      limitsRead: combineStorageValue(form.value.limitsRead, form.value.limitsReadUnit) || undefined,
      limitsWrite: combineStorageValue(form.value.limitsWrite, form.value.limitsWriteUnit) || undefined,
      limitsReadIops: form.value.limitsReadIops,
      limitsWriteIops: form.value.limitsWriteIops,
      // Network
      limitsIngress: combineStorageValue(form.value.limitsIngress, form.value.limitsIngressUnit) || undefined,
      limitsEgress: combineStorageValue(form.value.limitsEgress, form.value.limitsEgressUnit) || undefined,
      // Process/CPU
      limitsProcesses: form.value.limitsProcesses,
      limitsCpuPriority: form.value.limitsCpuPriority,
      // Boot settings
      bootAutostart: form.value.bootAutostart,
      bootAutostartPriority: form.value.bootAutostartPriority,
      bootAutostartDelay: form.value.bootAutostartDelay,
      bootHostShutdownTimeout: form.value.bootHostShutdownTimeout,
      // Global sharing
      globalShared: form.value.globalShared,
      globalQuotaMultiplier: null,
      globalMaxInstances: form.value.globalShared ? globalMaxInstances : null,
      requiredPackageId: form.value.requiredPackageId
    }

    if (isEditMode.value && packageId.value) {
      await api.packages.update(packageId.value, data as UpdatePackageRequest)
      toast.success(t('admin.packages.packageUpdated'))
    } else {
      await api.packages.create(data as CreatePackageRequest)
      toast.success(t('admin.packages.packageCreated'))
    }

    router.push(packagesPath())
  } catch (err: any) {
    formError.value = translateError(err) || t('admin.packages.saveFailed')
  } finally {
    saving.value = false
  }
}

function goBack(): void {
  router.push(packagesPath())
}
</script>

<template>
  <div class="pkg-form space-y-6">
    <!-- Header -->
    <div class="page-header">
      <div class="flex items-center gap-4">
        <button
          class="p-2 rounded-lg transition-colors hover:bg-themed-hover"
          @click="goBack"
        >
          <svg class="w-5 h-5 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 class="page-title">
            {{ isEditMode ? t('packageForm.editTitle') : t('packageForm.createTitle') }}
          </h1>
          <p class="page-description">{{ t('packageForm.description') }}</p>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card p-12 text-center">
      <div class="loading-spinner w-8 h-8 mx-auto"></div>
      <p class="text-themed-muted mt-4">{{ t('common.loading') }}</p>
    </div>

    <!-- Form -->
    <form v-else class="space-y-5" novalidate @submit.prevent="savePackage">
      <!-- Error message -->
      <div v-if="formError" class="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-400">
        <svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <span>{{ formError }}</span>
      </div>

      <!-- Basic Info Section -->
      <section class="section-card card p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 9h8M8 13h5" />
            </svg>
          </div>
          <h2 class="font-semibold text-themed">{{ t('packageForm.sections.basicInfo') }}</h2>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('admin.packages.name') }} *</label>
            <input v-model="form.name" type="text" class="input" required />
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('admin.packages.descLabel') }}</label>
            <input v-model="form.description" type="text" class="input" />
            <p class="text-xs text-amber-600 dark:text-amber-400 mt-1">{{ t('common.noIncudalHint') }}</p>
          </div>
          <div v-if="!isEditMode" class="md:col-span-2">
            <label class="block text-sm font-medium text-themed-secondary mb-2">{{ t('packageForm.fields.packageCreationMode') }}</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                class="p-4 rounded-xl border transition-all text-left cursor-pointer"
                :class="[
                  packageCreationMode === 'free'
                    ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/30'
                    : 'border-themed bg-themed-secondary hover:border-themed-secondary'
                ]"
                @click="packageCreationMode = 'free'"
              >
                <div class="flex items-center gap-2 mb-2">
                  <svg class="w-5 h-5" :class="packageCreationMode === 'free' ? 'text-primary-600' : 'icon-themed-muted'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span class="text-sm font-semibold" :class="packageCreationMode === 'free' ? 'text-primary-600' : 'text-themed'">
                    {{ t('packageForm.creationModes.free.title') }}
                  </span>
                </div>
                <p class="text-xs leading-relaxed text-themed-muted">
                  {{ t('packageForm.creationModes.free.description') }}
                </p>
              </button>
              <button
                type="button"
                class="p-4 rounded-xl border transition-all text-left cursor-pointer"
                :class="[
                  packageCreationMode === 'paid'
                    ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/30'
                    : 'border-themed bg-themed-secondary hover:border-themed-secondary'
                ]"
                @click="packageCreationMode = 'paid'"
              >
                <div class="flex items-center gap-2 mb-2">
                  <svg class="w-5 h-5" :class="packageCreationMode === 'paid' ? 'text-primary-600' : 'icon-themed-muted'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <span class="text-sm font-semibold" :class="packageCreationMode === 'paid' ? 'text-primary-600' : 'text-themed'">
                    {{ t('packageForm.creationModes.paid.title') }}
                  </span>
                </div>
                <p class="text-xs leading-relaxed text-themed-muted">
                  {{ t('packageForm.creationModes.paid.description') }}
                </p>
              </button>
            </div>
            <div class="mt-3 rounded-lg border border-themed bg-themed-secondary px-3 py-3 text-sm text-themed-secondary">
              <div class="flex items-start gap-2">
                <svg class="w-4 h-4 mt-0.5 shrink-0 icon-themed-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                </svg>
                <p class="text-xs leading-relaxed">
                  {{ packageCreationMode === 'free' ? t('packageForm.hints.freePackageCreationMode') : t('packageForm.hints.paidPackageCreationMode') }}
                </p>
              </div>
            </div>
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.networkMode') }} *</label>
            <select v-model="form.networkMode" class="input">
              <option v-for="mode in availableNetworkModes" :key="mode.value" :value="mode.value">{{ t(mode.labelKey) }}</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.instanceType') }} *</label>
            <!-- 点击卡片选择实例类型 -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- 容器卡片 -->
              <button
                type="button"
                class="p-4 rounded-xl border transition-all text-left cursor-pointer"
                :class="[
                  form.instanceType === 'container'
                    ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/30'
                    : 'border-themed bg-themed-secondary hover:border-themed-secondary'
                ]"
                @click="form.instanceType = 'container'"
              >
                <div class="flex items-center gap-2 mb-2">
                  <svg class="w-5 h-5" :class="form.instanceType === 'container' ? 'text-primary-600' : 'icon-themed-muted'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <span class="text-sm font-semibold" :class="form.instanceType === 'container' ? 'text-primary-600' : 'text-themed'">{{ t('common.instanceType.container') }}</span>
                </div>
                <ul class="text-xs space-y-1 text-themed-muted">
                  <li>• {{ t('packageForm.typeHelp.containerFast') }}</li>
                  <li>• {{ t('packageForm.typeHelp.containerLight') }}</li>
                  <li>• {{ t('packageForm.typeHelp.containerDocker') }}</li>
                </ul>
              </button>
              <!-- VM卡片 -->
              <button
                type="button"
                class="p-4 rounded-xl border transition-all text-left cursor-pointer"
                :class="[
                  form.instanceType === 'vm'
                    ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/30'
                    : 'border-themed bg-themed-secondary hover:border-themed-secondary'
                ]"
                @click="form.instanceType = 'vm'"
              >
                <div class="flex items-center gap-2 mb-2">
                  <svg class="w-5 h-5" :class="form.instanceType === 'vm' ? 'text-primary-600' : 'icon-themed-muted'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                  <span class="text-sm font-semibold" :class="form.instanceType === 'vm' ? 'text-primary-600' : 'text-themed'">{{ t('common.instanceType.vm') }}</span>
                </div>
                <ul class="text-xs space-y-1 text-themed-muted">
                  <li>• {{ t('packageForm.typeHelp.vmIsolation') }}</li>
                  <li>• {{ t('packageForm.typeHelp.vmKernel') }}</li>
                  <li>• {{ t('packageForm.typeHelp.vmWindows') }}</li>
                </ul>
              </button>
            </div>
          </div>
          <div class="md:col-span-2">
            <div class="mb-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('admin.packages.boundHosts') }} *</label>
                <div class="text-xs text-themed-muted">
                  {{ t('packageForm.hostSelector.selectedCount', { count: form.hostIds.length }) }}
                </div>
              </div>
              <div v-if="authStore.isAdmin" class="inline-flex self-start rounded-lg bg-themed-secondary p-1">
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                  :class="hostScope === 'official'
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'text-themed-muted hover:text-themed'"
                  @click="switchHostScope('official')"
                >
                  {{ t('packageForm.hostSelector.official') }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                  :class="hostScope === 'hosted'
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'text-themed-muted hover:text-themed'"
                  @click="switchHostScope('hosted')"
                >
                  {{ t('resources.hosts.hosted') }}
                </button>
              </div>
            </div>
            <div class="rounded-lg border border-themed bg-themed-tertiary p-3">
              <div class="flex flex-col gap-2 sm:flex-row">
                <div class="relative flex-1">
                  <input
                    v-model="hostSearchInput"
                    type="text"
                    :placeholder="t('packageForm.hostSelector.searchPlaceholder')"
                    class="input pl-9 w-full"
                    @keyup.enter="applyHostSearch"
                  />
                  <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <button type="button" class="btn-secondary h-[38px] px-4 justify-center" @click="applyHostSearch">
                  {{ t('common.search') }}
                </button>
                <button
                  v-if="hasHostSearch"
                  type="button"
                  class="btn-ghost h-[38px] px-3 justify-center"
                  @click="clearHostSearch"
                >
                  {{ t('resources.packages.clearSearch') }}
                </button>
              </div>

              <div class="mt-3 max-h-72 overflow-y-auto pr-1">
                <div v-if="hostsLoading" class="py-8 text-center text-sm text-themed-muted">
                  {{ t('common.loading') }}
                </div>
                <div v-else-if="displayedHosts.length > 0" class="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  <button
                    v-for="host in displayedHosts"
                    :key="host.id"
                    type="button"
                    class="w-full rounded-lg border p-3 text-left transition-colors"
                    :class="selectedHostIdSet.has(host.id)
                      ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/40'
                      : 'border-themed bg-themed-surface hover:border-themed-secondary hover:bg-themed-hover'"
                    @click="toggleHostSelection(host.id)"
                  >
                    <div class="flex items-start gap-3">
                      <input
                        :checked="selectedHostIdSet.has(host.id)"
                        type="checkbox"
                        class="mt-1 w-4 h-4 rounded pointer-events-none text-primary-600 focus:ring-primary-500"
                        tabindex="-1"
                        readonly
                      />
                      <FlagIcon :code="getHostCountryCode(host)" size="sm" class="mt-0.5 shrink-0" />
                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="truncate text-sm font-medium text-themed">{{ host.name }}</span>
                          <span
                            class="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1"
                            :class="getHostStatusClass(host.status)"
                          >
                            {{ getHostStatusLabel(host.status) }}
                          </span>
                        </div>
                        <div class="mt-1 truncate text-xs text-themed-muted">
                          {{ getHostSummary(host) || host.url }}
                        </div>
                        <div v-if="host.owner" class="mt-1 text-xs text-themed-muted">
                          {{ t('resources.hosts.owner') }}: {{ host.owner.username }} · UID {{ host.owner.id }}
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
                <div v-else class="py-8 text-center text-sm text-themed-muted">
                  {{ hasHostSearch ? t('packageForm.hostSelector.noSearchResults') : t('admin.packages.noHostsAvailable') }}
                </div>
              </div>
            </div>
          </div>
          <div v-if="form.hostIds.length > 0" class="md:col-span-2">
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.hostStoragePools') }}</label>
            <div class="space-y-3 rounded-lg border border-themed bg-themed-tertiary p-3">
              <div
                v-for="host in selectedKnownHosts"
                :key="host.id"
                class="rounded-lg border border-themed bg-themed-surface p-3"
              >
                <div class="flex items-center justify-between gap-3 mb-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <FlagIcon :code="getHostCountryCode(host)" size="sm" class="shrink-0" />
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-themed">{{ getSelectedHostLabel(host.id) }}</div>
                      <div class="text-xs text-themed-muted font-mono tabular-nums">ID: {{ host.id }}</div>
                    </div>
                  </div>
                  <span v-if="storagePoolsLoadingByHost[host.id]" class="text-xs text-themed-muted">
                    {{ t('common.loading') }}
                  </span>
                </div>

                <template v-if="getSystemStoragePools(host.id).length > 0">
                  <select
                    v-model="form.hostStoragePools[String(host.id)]"
                    class="input w-full"
                  >
                    <option value="">{{ t('packageForm.placeholders.autoStoragePool') }}</option>
                    <option
                      v-for="pool in getSystemStoragePools(host.id)"
                      :key="pool.name"
                      :value="pool.name"
                    >
                      {{ pool.name }} ({{ pool.driver.toUpperCase() }})
                    </option>
                  </select>
                  <p class="text-xs text-themed-muted mt-1.5">
                    {{ t('packageForm.hints.hostStoragePools') }}
                  </p>
                </template>
                <p v-else-if="!storagePoolsLoadingByHost[host.id]" class="text-xs text-amber-600 dark:text-amber-400">
                  {{ t('packageForm.hints.noSystemStoragePools') }}
                </p>
                <div class="mt-3">
                  <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.hostTrafficMultiplier') }}</label>
                  <input
                    v-model.number="form.hostTrafficMultipliers[String(host.id)]"
                    type="number"
                    class="input w-full font-mono tabular-nums"
                    min="0.001"
                    max="100"
                    step="0.001"
                    placeholder="1"
                  />
                  <p class="text-xs text-themed-muted mt-1.5">
                    {{ t('packageForm.hints.hostTrafficMultiplier') }}
                  </p>
                </div>
              </div>
              <div
                v-for="hostId in selectedUnknownHostIds"
                :key="hostId"
                class="rounded-lg border border-themed bg-themed-surface p-3"
              >
                <div class="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <div class="text-sm font-medium text-themed">{{ getSelectedHostLabel(hostId) }}</div>
                    <div class="text-xs text-themed-muted font-mono tabular-nums">ID: {{ hostId }}</div>
                    <div class="mt-0.5 text-xs text-themed-muted">{{ t('packageForm.hostSelector.detailUnavailable') }}</div>
                  </div>
                  <span v-if="storagePoolsLoadingByHost[hostId]" class="text-xs text-themed-muted">
                    {{ t('common.loading') }}
                  </span>
                </div>

                <template v-if="getSystemStoragePools(hostId).length > 0">
                  <select
                    v-model="form.hostStoragePools[String(hostId)]"
                    class="input w-full"
                  >
                    <option value="">{{ t('packageForm.placeholders.autoStoragePool') }}</option>
                    <option
                      v-for="pool in getSystemStoragePools(hostId)"
                      :key="pool.name"
                      :value="pool.name"
                    >
                      {{ pool.name }} ({{ pool.driver.toUpperCase() }})
                    </option>
                  </select>
                  <p class="text-xs text-themed-muted mt-1.5">
                    {{ t('packageForm.hints.hostStoragePools') }}
                  </p>
                </template>
                <p v-else-if="!storagePoolsLoadingByHost[hostId]" class="text-xs text-amber-600 dark:text-amber-400">
                  {{ t('packageForm.hints.noSystemStoragePools') }}
                </p>
                <div class="mt-3">
                  <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.hostTrafficMultiplier') }}</label>
                  <input
                    v-model.number="form.hostTrafficMultipliers[String(hostId)]"
                    type="number"
                    class="input w-full font-mono tabular-nums"
                    min="0.001"
                    max="100"
                    step="0.001"
                    placeholder="1"
                  />
                  <p class="text-xs text-themed-muted mt-1.5">
                    {{ t('packageForm.hints.hostTrafficMultiplier') }}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div class="md:col-span-2 flex items-center gap-6">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="form.active" type="checkbox" class="h-4 w-4 rounded border-themed text-primary-600 focus:ring-primary-500" />
              <span class="text-sm text-themed">{{ t('admin.packages.activeLabel') }}</span>
            </label>
          </div>
        </div>
      </section>

      <!-- Resource Limits Section -->
      <section v-if="showPackageLevelInstanceDefaults" class="section-card card p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <h2 class="font-semibold text-themed">{{ t('packageForm.sections.resourceLimits') }}</h2>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">
              {{ t('admin.packages.cpu') }} (%)
              <span class="text-themed-muted font-normal">- {{ t('admin.packages.instanceMaxLimit') }}</span>
            </label>
            <input v-model.number="form.cpuMax" type="number" class="input font-mono tabular-nums" min="15" max="10000" step="5" />
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">
              {{ t('admin.packages.memory') }} (MB)
              <span class="text-themed-muted font-normal">- {{ t('admin.packages.instanceMaxLimit') }}</span>
            </label>
            <input v-model.number="form.memoryMax" type="number" class="input font-mono tabular-nums" min="128" step="64" />
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">
              {{ t('admin.packages.disk') }} (MB)
              <span class="text-themed-muted font-normal">- {{ t('admin.packages.instanceMaxLimit') }}</span>
            </label>
            <input v-model.number="form.diskMax" type="number" class="input font-mono tabular-nums" min="512" step="1024" />
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('admin.packages.trafficLimit') }} (GB)</label>
            <input
              v-model="form.monthlyTrafficLimitGB"
              type="text"
              class="input font-mono tabular-nums"
              :placeholder="t('admin.packages.unlimitedPlaceholder')"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">流量重置价格（元）</label>
            <input
              v-model.number="form.trafficResetPrice"
              type="number"
              class="input font-mono tabular-nums"
              min="0"
              :max="MAX_TRAFFIC_RESET_PRICE"
              step="0.01"
            />
            <p class="text-xs text-themed-muted mt-1">单位:元(如填 5 表示 5 元)；用户自助重置月流量时扣费，0 表示免费。</p>
          </div>
        </div>
      </section>

      <!-- Instance Quota Section -->
      <section v-if="showPackageLevelInstanceDefaults" class="section-card card p-5 sm:p-6">
        <div class="mb-4 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </div>
          <div>
            <h2 class="font-semibold text-themed">{{ t('packageForm.sections.instanceQuota') }}</h2>
            <p class="text-xs text-themed-muted">{{ t('packageForm.hints.instanceQuota') }}</p>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.portLimit') }}</label>
            <input v-model.number="form.portLimit" type="number" class="input font-mono tabular-nums" min="1" max="1000" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.portLimit') }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.snapshotLimit') }}</label>
            <input v-model.number="form.snapshotLimit" type="number" class="input font-mono tabular-nums" min="0" max="1000" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.snapshotLimit') }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.siteLimit') }}</label>
            <input v-model.number="form.siteLimit" type="number" class="input font-mono tabular-nums" min="0" max="1000" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.siteLimit') }}</p>
          </div>
        </div>
      </section>

      <!-- Storage I/O Section -->
      <section class="section-card card p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3-3.582-3-8-3-8 1.343-8 3z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3" />
            </svg>
          </div>
          <h2 class="font-semibold text-themed">{{ t('packageForm.sections.storageIO') }}</h2>
        </div>

        <!-- IO Limit Mode Toggle -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-themed-secondary mb-2">{{ t('packageForm.fields.ioLimitMode') }}</label>
          <div class="inline-flex w-full rounded-lg bg-themed-secondary p-1 sm:w-auto">
            <button
              type="button"
              class="flex-1 px-4 py-2 rounded-md transition-all text-sm font-medium cursor-pointer sm:flex-none"
              :class="[
                form.ioLimitMode === 'throughput'
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-themed-muted hover:text-themed'
              ]"
              @click="form.ioLimitMode = 'throughput'"
            >
              {{ t('packageForm.ioMode.throughput') }}
            </button>
            <button
              type="button"
              class="flex-1 px-4 py-2 rounded-md transition-all text-sm font-medium cursor-pointer sm:flex-none"
              :class="[
                form.ioLimitMode === 'iops'
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-themed-muted hover:text-themed'
              ]"
              @click="form.ioLimitMode = 'iops'"
            >
              {{ t('packageForm.ioMode.iops') }}
            </button>
          </div>
          <p class="text-xs text-themed-muted mt-1.5">{{ t('packageForm.hints.ioLimitMode') }}</p>
        </div>

        <!-- Throughput fields -->
        <div v-if="form.ioLimitMode === 'throughput'" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.limitsRead') }}</label>
            <div class="flex gap-2">
              <input v-model="form.limitsRead" type="text" class="input flex-1 font-mono tabular-nums" />
              <select v-model="form.limitsReadUnit" class="input w-24">
                <option v-for="unit in storageUnits" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.limitsWrite') }}</label>
            <div class="flex gap-2">
              <input v-model="form.limitsWrite" type="text" class="input flex-1 font-mono tabular-nums" />
              <select v-model="form.limitsWriteUnit" class="input w-24">
                <option v-for="unit in storageUnits" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- IOPS fields -->
        <div v-if="form.ioLimitMode === 'iops'" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.limitsReadIops') }}</label>
            <input v-model.number="form.limitsReadIops" type="number" class="input font-mono tabular-nums" min="0" />
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.limitsWriteIops') }}</label>
            <input v-model.number="form.limitsWriteIops" type="number" class="input font-mono tabular-nums" min="0" />
          </div>
        </div>
      </section>

      <!-- Network Limits Section -->
      <section v-if="showPackageLevelInstanceDefaults" class="section-card card p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" />
            </svg>
          </div>
          <h2 class="font-semibold text-themed">{{ t('packageForm.sections.networkLimits') }}</h2>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.limitsIngress') }}</label>
            <div class="flex gap-2">
              <input v-model="form.limitsIngress" type="text" class="input flex-1 font-mono tabular-nums" />
              <select v-model="form.limitsIngressUnit" class="input w-24">
                <option v-for="unit in networkUnits" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.limitsEgress') }}</label>
            <div class="flex gap-2">
              <input v-model="form.limitsEgress" type="text" class="input flex-1 font-mono tabular-nums" />
              <select v-model="form.limitsEgressUnit" class="input w-24">
                <option v-for="unit in networkUnits" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <!-- Process and CPU Scheduling Section -->
      <section class="section-card card p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 7h10v10H7V7z" />
            </svg>
          </div>
          <h2 class="font-semibold text-themed">{{ t('packageForm.sections.processScheduling') }}</h2>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.limitsProcesses') }}</label>
            <input v-model.number="form.limitsProcesses" type="number" class="input font-mono tabular-nums" min="1" />
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">
              {{ t('packageForm.fields.limitsCpuPriority') }}
              <span class="text-themed-muted font-normal">(0-10)</span>
            </label>
            <input v-model.number="form.limitsCpuPriority" type="number" class="input font-mono tabular-nums" min="0" max="10" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.cpuPriority') }}</p>
          </div>
        </div>
      </section>

      <!-- Boot Settings Section -->
      <section class="section-card card p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18.36 6.64A9 9 0 1120.77 15M12 2v10" />
            </svg>
          </div>
          <h2 class="font-semibold text-themed">{{ t('packageForm.sections.bootSettings') }}</h2>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="form.bootAutostart" type="checkbox" class="h-4 w-4 rounded border-themed text-primary-600 focus:ring-primary-500" />
              <span class="text-sm text-themed">{{ t('packageForm.fields.bootAutostart') }}</span>
            </label>
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">
              {{ t('packageForm.fields.bootAutostartPriority') }}
              <span class="text-themed-muted font-normal">(0-100)</span>
            </label>
            <input v-model.number="form.bootAutostartPriority" type="number" class="input font-mono tabular-nums" min="0" max="100" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.bootPriority') }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">
              {{ t('packageForm.fields.bootAutostartDelay') }}
              <span class="text-themed-muted font-normal">({{ t('packageForm.units.seconds') }})</span>
            </label>
            <input v-model.number="form.bootAutostartDelay" type="number" class="input font-mono tabular-nums" min="5" max="600" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.startupDelay') }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">
              {{ t('packageForm.fields.bootHostShutdownTimeout') }}
              <span class="text-themed-muted font-normal">({{ t('packageForm.units.seconds') }})</span>
            </label>
            <input v-model.number="form.bootHostShutdownTimeout" type="number" class="input font-mono tabular-nums" min="30" max="600" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.shutdownTimeout') }}</p>
          </div>
        </div>
      </section>

      <!-- Prerequisite Section -->
      <section class="section-card card p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 10-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <h2 class="font-semibold text-themed">{{ t('packageForm.sections.prerequisite') }}</h2>
        </div>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-themed-secondary mb-1.5">{{ t('packageForm.fields.requiredPackage') }}</label>
            <select v-model="form.requiredPackageId" class="input">
              <option :value="null">{{ t('packageForm.placeholders.noPrerequisite') }}</option>
              <option
                v-for="pkg in prerequisitePackageOptions"
                :key="pkg.id"
                :value="pkg.id"
              >
                {{ pkg.name }}
              </option>
            </select>
          </div>
          <p class="text-xs text-themed-muted">
            {{ t('packageForm.hints.requiredPackage') }}
          </p>
        </div>
      </section>

      <!-- Visibility Section -->
      <section class="section-card card p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 class="font-semibold text-themed">{{ t('packageForm.sections.visibility') }}</h2>
        </div>
        <div class="space-y-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.globalShared" type="checkbox" class="h-4 w-4 rounded border-themed text-primary-600 focus:ring-primary-500" />
            <span class="text-sm text-themed">{{ t('packageForm.fields.publicAccess') }}</span>
          </label>
          <p class="text-xs text-themed-muted">{{ t('packageForm.hints.publicAccess') }}</p>

          <div v-if="form.globalShared" class="mt-4 space-y-4 pl-6 border-l-2 border-themed">
            <div>
              <label class="block text-sm font-medium text-themed-secondary mb-1.5">
                {{ t('packageForm.fields.globalMaxInstances') }}
              </label>
              <select
                v-model.number="form.globalMaxInstances"
                required
                class="input font-mono tabular-nums"
              >
                <option v-for="count in publicPackageMaxInstanceOptions" :key="count" :value="count">
                  {{ count }}
                </option>
              </select>
              <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.globalMaxInstances') }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Advanced Options Section -->
      <section class="section-card card p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-themed-secondary">
            <svg class="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </div>
          <h2 class="font-semibold text-themed">{{ t('packageForm.sections.advancedOptions') }}</h2>
        </div>
        <div class="flex items-center gap-6">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.privileged" type="checkbox" class="h-4 w-4 rounded border-themed text-primary-600 focus:ring-primary-500" />
            <span class="text-sm text-themed">{{ t('admin.packages.privileged') }}</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.nested" type="checkbox" class="h-4 w-4 rounded border-themed text-primary-600 focus:ring-primary-500" />
            <span class="text-sm text-themed">{{ t('admin.packages.nested') }}</span>
          </label>
        </div>
      </section>

      <!-- Form Actions -->
      <div class="action-footer sticky bottom-0 z-10 flex items-center justify-end gap-3 rounded-xl border border-themed bg-themed-surface p-4 shadow-lg">
        <button type="button" class="btn-secondary" @click="goBack">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary" :disabled="saving || !form.name">
          <span v-if="saving" class="loading-spinner w-4 h-4"></span>
          <span v-else>{{ isEditMode ? t('common.save') : t('common.create') }}</span>
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
/* Nimbus: subtle sectioned-card entrance + hover polish */
.section-card {
  animation: nimbus-card-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

.section-card:nth-of-type(1) { animation-delay: 0.02s; }
.section-card:nth-of-type(2) { animation-delay: 0.06s; }
.section-card:nth-of-type(3) { animation-delay: 0.1s; }
.section-card:nth-of-type(4) { animation-delay: 0.14s; }
.section-card:nth-of-type(5) { animation-delay: 0.18s; }
.section-card:nth-of-type(6) { animation-delay: 0.22s; }
.section-card:nth-of-type(7) { animation-delay: 0.26s; }
.section-card:nth-of-type(8) { animation-delay: 0.3s; }

.section-card:hover {
  box-shadow: 0 6px 24px -12px rgba(79, 70, 229, 0.28);
}

@keyframes nimbus-card-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    transform: none !important;
  }
}
</style>
