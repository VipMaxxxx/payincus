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
  networkMode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  instanceType: 'container' | 'vm'  // 实例类型
  privileged: boolean
  nested: boolean
  active: boolean
  monthlyTrafficLimitGB: string
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

// 网络模式（场景化 5 种选项，与节点创建页一致）
const networkModes = [
  { value: 'nat', labelKey: 'common.networkMode.nat' },
  { value: 'nat_ipv6', labelKey: 'common.networkMode.nat_ipv6' },
  { value: 'nat_ipv6_nat', labelKey: 'common.networkMode.nat_ipv6_nat' },
  { value: 'ipv6_only', labelKey: 'common.networkMode.ipv6_only' },
  { value: 'ipv6_nat', labelKey: 'common.networkMode.ipv6_nat' }
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
    router.push({ name: 'my-packages' })
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

    router.push({ name: 'my-packages' })
  } catch (err: any) {
    formError.value = translateError(err) || t('admin.packages.saveFailed')
  } finally {
    saving.value = false
  }
}

function goBack(): void {
  router.push({ name: 'my-packages' })
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <!-- Header -->
    <div class="page-header">
      <div class="flex items-center gap-4">
        <button
          class="p-2 rounded-lg transition-colors"
          :class="themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'"
          @click="goBack"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    <form v-else class="space-y-6" novalidate @submit.prevent="savePackage">
      <!-- Error message -->
      <div v-if="formError" class="p-4 rounded-lg bg-red-500/10 text-error text-sm">
        {{ formError }}
      </div>

      <!-- Basic Info Section -->
      <div class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.basicInfo') }}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.packages.name') }} *</label>
            <input v-model="form.name" type="text" class="input" required />
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.packages.descLabel') }}</label>
            <input v-model="form.description" type="text" class="input" />
            <p class="text-xs text-orange-500 dark:text-orange-400 mt-1">{{ t('common.noIncudalHint') }}</p>
          </div>
          <div v-if="!isEditMode" class="md:col-span-2">
            <label class="block text-xs text-themed-muted mb-2">{{ t('packageForm.fields.packageCreationMode') }}</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                class="p-4 rounded-lg border-2 transition-all text-left cursor-pointer"
                :class="[
                  packageCreationMode === 'free'
                    ? (themeStore.isDark ? 'border-teal-500 bg-teal-900/20 ring-2 ring-teal-500/30' : 'border-teal-500 bg-teal-50 ring-2 ring-teal-200')
                    : (themeStore.isDark ? 'border-gray-700 bg-gray-900/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300')
                ]"
                @click="packageCreationMode = 'free'"
              >
                <div class="flex items-center gap-2 mb-2">
                  <svg class="w-5 h-5" :class="packageCreationMode === 'free' ? 'text-teal-500' : 'text-themed-muted'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span class="text-sm font-medium" :class="packageCreationMode === 'free' ? (themeStore.isDark ? 'text-teal-400' : 'text-teal-700') : 'text-themed'">
                    {{ t('packageForm.creationModes.free.title') }}
                  </span>
                </div>
                <p class="text-xs leading-relaxed" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                  {{ t('packageForm.creationModes.free.description') }}
                </p>
              </button>
              <button
                type="button"
                class="p-4 rounded-lg border-2 transition-all text-left cursor-pointer"
                :class="[
                  packageCreationMode === 'paid'
                    ? (themeStore.isDark ? 'border-amber-500 bg-amber-900/20 ring-2 ring-amber-500/30' : 'border-amber-500 bg-amber-50 ring-2 ring-amber-200')
                    : (themeStore.isDark ? 'border-gray-700 bg-gray-900/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300')
                ]"
                @click="packageCreationMode = 'paid'"
              >
                <div class="flex items-center gap-2 mb-2">
                  <svg class="w-5 h-5" :class="packageCreationMode === 'paid' ? 'text-amber-500' : 'text-themed-muted'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <span class="text-sm font-medium" :class="packageCreationMode === 'paid' ? (themeStore.isDark ? 'text-amber-400' : 'text-amber-700') : 'text-themed'">
                    {{ t('packageForm.creationModes.paid.title') }}
                  </span>
                </div>
                <p class="text-xs leading-relaxed" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                  {{ t('packageForm.creationModes.paid.description') }}
                </p>
              </button>
            </div>
            <div
              class="mt-3 rounded-lg border px-3 py-3 text-sm"
              :class="packageCreationMode === 'free'
                ? (themeStore.isDark ? 'border-teal-700/70 bg-teal-950/30 text-teal-100' : 'border-teal-200 bg-teal-50 text-teal-900')
                : (themeStore.isDark ? 'border-amber-700/70 bg-amber-950/30 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-900')"
            >
              <div class="flex items-start gap-2">
                <svg class="w-4 h-4 mt-0.5 shrink-0" :class="packageCreationMode === 'free' ? 'text-teal-500' : 'text-amber-500'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                </svg>
                <p class="text-xs leading-relaxed">
                  {{ packageCreationMode === 'free' ? t('packageForm.hints.freePackageCreationMode') : t('packageForm.hints.paidPackageCreationMode') }}
                </p>
              </div>
            </div>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.networkMode') }} *</label>
            <select v-model="form.networkMode" class="input">
              <option v-for="mode in availableNetworkModes" :key="mode.value" :value="mode.value">{{ t(mode.labelKey) }}</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.instanceType') }} *</label>
            <!-- 点击卡片选择实例类型 -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- 容器卡片 -->
              <button 
                type="button"
                class="p-4 rounded-xl border-2 transition-all text-left cursor-pointer"
                :class="[
                  form.instanceType === 'container' 
                    ? (themeStore.isDark ? 'border-teal-500 bg-teal-900/20 ring-2 ring-teal-500/30' : 'border-teal-500 bg-teal-50 ring-2 ring-teal-200')
                    : (themeStore.isDark ? 'border-gray-700 bg-gray-900/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300')
                ]"
                @click="form.instanceType = 'container'"
              >
                <div class="flex items-center gap-2 mb-2">
                  <svg class="w-5 h-5" :class="form.instanceType === 'container' ? 'text-teal-500' : 'text-themed-muted'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <span class="text-sm font-medium" :class="form.instanceType === 'container' ? (themeStore.isDark ? 'text-teal-400' : 'text-teal-700') : 'text-themed'">{{ t('common.instanceType.container') }}</span>
                </div>
                <ul class="text-xs space-y-1" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
                  <li>• {{ t('packageForm.typeHelp.containerFast') }}</li>
                  <li>• {{ t('packageForm.typeHelp.containerLight') }}</li>
                  <li>• {{ t('packageForm.typeHelp.containerDocker') }}</li>
                </ul>
              </button>
              <!-- VM卡片 -->
              <button 
                type="button"
                class="p-4 rounded-xl border-2 transition-all text-left cursor-pointer"
                :class="[
                  form.instanceType === 'vm' 
                    ? (themeStore.isDark ? 'border-amber-500 bg-amber-900/20 ring-2 ring-amber-500/30' : 'border-amber-500 bg-amber-50 ring-2 ring-amber-200')
                    : (themeStore.isDark ? 'border-gray-700 bg-gray-900/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300')
                ]"
                @click="form.instanceType = 'vm'"
              >
                <div class="flex items-center gap-2 mb-2">
                  <svg class="w-5 h-5" :class="form.instanceType === 'vm' ? 'text-amber-500' : 'text-themed-muted'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                  <span class="text-sm font-medium" :class="form.instanceType === 'vm' ? (themeStore.isDark ? 'text-amber-400' : 'text-amber-700') : 'text-themed'">{{ t('common.instanceType.vm') }}</span>
                </div>
                <ul class="text-xs space-y-1" :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'">
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
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.packages.boundHosts') }} *</label>
                <div class="text-xs text-themed-muted">
                  {{ t('packageForm.hostSelector.selectedCount', { count: form.hostIds.length }) }}
                </div>
              </div>
              <div v-if="authStore.isAdmin" class="inline-flex self-start rounded-lg p-1" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                  :class="hostScope === 'official'
                    ? (themeStore.isDark ? 'bg-gray-700 text-white' : 'bg-white text-gray-900 shadow-sm')
                    : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')"
                  @click="switchHostScope('official')"
                >
                  {{ t('packageForm.hostSelector.official') }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                  :class="hostScope === 'hosted'
                    ? (themeStore.isDark ? 'bg-gray-700 text-white' : 'bg-white text-gray-900 shadow-sm')
                    : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')"
                  @click="switchHostScope('hosted')"
                >
                  {{ t('resources.hosts.hosted') }}
                </button>
              </div>
            </div>
            <div class="rounded-lg border p-3" :class="themeStore.isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'">
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
                      ? (themeStore.isDark ? 'border-teal-500 bg-teal-500/10 ring-1 ring-teal-500/40' : 'border-teal-400 bg-teal-50 ring-1 ring-teal-300')
                      : (themeStore.isDark ? 'border-gray-800 bg-gray-950/40 hover:border-gray-700 hover:bg-gray-900/70' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50')"
                    @click="toggleHostSelection(host.id)"
                  >
                    <div class="flex items-start gap-3">
                      <input
                        :checked="selectedHostIdSet.has(host.id)"
                        type="checkbox"
                        class="mt-1 w-4 h-4 rounded pointer-events-none"
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
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.hostStoragePools') }}</label>
            <div
              class="space-y-3 border rounded-lg p-3"
              :class="themeStore.isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'"
            >
              <div
                v-for="host in selectedKnownHosts"
                :key="host.id"
                class="rounded-lg border p-3"
                :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/40' : 'border-gray-200 bg-white'"
              >
                <div class="flex items-center justify-between gap-3 mb-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <FlagIcon :code="getHostCountryCode(host)" size="sm" class="shrink-0" />
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-themed">{{ getSelectedHostLabel(host.id) }}</div>
                      <div class="text-xs text-themed-muted">ID: {{ host.id }}</div>
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
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.hostTrafficMultiplier') }}</label>
                  <input
                    v-model.number="form.hostTrafficMultipliers[String(host.id)]"
                    type="number"
                    class="input w-full"
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
                class="rounded-lg border p-3"
                :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/40' : 'border-gray-200 bg-white'"
              >
                <div class="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <div class="text-sm font-medium text-themed">{{ getSelectedHostLabel(hostId) }}</div>
                    <div class="text-xs text-themed-muted">ID: {{ hostId }}</div>
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
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.hostTrafficMultiplier') }}</label>
                  <input
                    v-model.number="form.hostTrafficMultipliers[String(hostId)]"
                    type="number"
                    class="input w-full"
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
              <input v-model="form.active" type="checkbox" class="w-4 h-4 rounded" />
              <span class="text-sm text-themed-secondary">{{ t('admin.packages.activeLabel') }}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Resource Limits Section -->
      <div v-if="showPackageLevelInstanceDefaults" class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.resourceLimits') }}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">
              {{ t('admin.packages.cpu') }} (%)
              <span class="text-themed-muted font-normal">- {{ t('admin.packages.instanceMaxLimit') }}</span>
            </label>
            <input v-model.number="form.cpuMax" type="number" class="input" min="15" max="10000" step="5" />
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">
              {{ t('admin.packages.memory') }} (MB)
              <span class="text-themed-muted font-normal">- {{ t('admin.packages.instanceMaxLimit') }}</span>
            </label>
            <input v-model.number="form.memoryMax" type="number" class="input" min="128" step="64" />
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">
              {{ t('admin.packages.disk') }} (MB)
              <span class="text-themed-muted font-normal">- {{ t('admin.packages.instanceMaxLimit') }}</span>
            </label>
            <input v-model.number="form.diskMax" type="number" class="input" min="512" step="1024" />
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.packages.trafficLimit') }} (GB)</label>
            <input 
              v-model="form.monthlyTrafficLimitGB" 
              type="text" 
              class="input" 
              :placeholder="t('admin.packages.unlimitedPlaceholder')" 
            />
          </div>
        </div>
      </div>

      <!-- Instance Quota Section -->
      <div v-if="showPackageLevelInstanceDefaults" class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.instanceQuota') }}
        </h2>
        <p class="text-sm text-themed-muted mb-4">{{ t('packageForm.hints.instanceQuota') }}</p>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.portLimit') }}</label>
            <input v-model.number="form.portLimit" type="number" class="input" min="1" max="1000" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.portLimit') }}</p>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.snapshotLimit') }}</label>
            <input v-model.number="form.snapshotLimit" type="number" class="input" min="0" max="1000" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.snapshotLimit') }}</p>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.siteLimit') }}</label>
            <input v-model.number="form.siteLimit" type="number" class="input" min="0" max="1000" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.siteLimit') }}</p>
          </div>
        </div>
      </div>

      <!-- Storage I/O Section -->
      <div class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.storageIO') }}
        </h2>

        <!-- IO Limit Mode Toggle -->
        <div class="mb-4">
          <label class="block text-xs text-themed-muted mb-2">{{ t('packageForm.fields.ioLimitMode') }}</label>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium cursor-pointer"
              :class="[
                form.ioLimitMode === 'throughput'
                  ? (themeStore.isDark ? 'border-teal-500 bg-teal-900/20 text-teal-400 ring-1 ring-teal-500/30' : 'border-teal-500 bg-teal-50 text-teal-700 ring-1 ring-teal-200')
                  : (themeStore.isDark ? 'border-gray-700 bg-gray-900/30 text-gray-400 hover:border-gray-600' : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300')
              ]"
              @click="form.ioLimitMode = 'throughput'"
            >
              {{ t('packageForm.ioMode.throughput') }}
            </button>
            <button
              type="button"
              class="flex-1 px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium cursor-pointer"
              :class="[
                form.ioLimitMode === 'iops'
                  ? (themeStore.isDark ? 'border-amber-500 bg-amber-900/20 text-amber-400 ring-1 ring-amber-500/30' : 'border-amber-500 bg-amber-50 text-amber-700 ring-1 ring-amber-200')
                  : (themeStore.isDark ? 'border-gray-700 bg-gray-900/30 text-gray-400 hover:border-gray-600' : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300')
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
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.limitsRead') }}</label>
            <div class="flex gap-2">
              <input v-model="form.limitsRead" type="text" class="input flex-1" />
              <select v-model="form.limitsReadUnit" class="input w-24">
                <option v-for="unit in storageUnits" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.limitsWrite') }}</label>
            <div class="flex gap-2">
              <input v-model="form.limitsWrite" type="text" class="input flex-1" />
              <select v-model="form.limitsWriteUnit" class="input w-24">
                <option v-for="unit in storageUnits" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- IOPS fields -->
        <div v-if="form.ioLimitMode === 'iops'" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.limitsReadIops') }}</label>
            <input v-model.number="form.limitsReadIops" type="number" class="input" min="0" />
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.limitsWriteIops') }}</label>
            <input v-model.number="form.limitsWriteIops" type="number" class="input" min="0" />
          </div>
        </div>
      </div>

      <!-- Network Limits Section -->
      <div v-if="showPackageLevelInstanceDefaults" class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.networkLimits') }}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.limitsIngress') }}</label>
            <div class="flex gap-2">
              <input v-model="form.limitsIngress" type="text" class="input flex-1" />
              <select v-model="form.limitsIngressUnit" class="input w-24">
                <option v-for="unit in networkUnits" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.limitsEgress') }}</label>
            <div class="flex gap-2">
              <input v-model="form.limitsEgress" type="text" class="input flex-1" />
              <select v-model="form.limitsEgressUnit" class="input w-24">
                <option v-for="unit in networkUnits" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Process and CPU Scheduling Section -->
      <div class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.processScheduling') }}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.limitsProcesses') }}</label>
            <input v-model.number="form.limitsProcesses" type="number" class="input" min="1" />
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">
              {{ t('packageForm.fields.limitsCpuPriority') }}
              <span class="text-themed-muted font-normal">(0-10)</span>
            </label>
            <input v-model.number="form.limitsCpuPriority" type="number" class="input" min="0" max="10" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.cpuPriority') }}</p>
          </div>
        </div>
      </div>

      <!-- Boot Settings Section -->
      <div class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.bootSettings') }}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="form.bootAutostart" type="checkbox" class="w-4 h-4 rounded" />
              <span class="text-sm text-themed-secondary">{{ t('packageForm.fields.bootAutostart') }}</span>
            </label>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">
              {{ t('packageForm.fields.bootAutostartPriority') }}
              <span class="text-themed-muted font-normal">(0-100)</span>
            </label>
            <input v-model.number="form.bootAutostartPriority" type="number" class="input" min="0" max="100" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.bootPriority') }}</p>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">
              {{ t('packageForm.fields.bootAutostartDelay') }}
              <span class="text-themed-muted font-normal">({{ t('packageForm.units.seconds') }})</span>
            </label>
            <input v-model.number="form.bootAutostartDelay" type="number" class="input" min="5" max="600" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.startupDelay') }}</p>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">
              {{ t('packageForm.fields.bootHostShutdownTimeout') }}
              <span class="text-themed-muted font-normal">({{ t('packageForm.units.seconds') }})</span>
            </label>
            <input v-model.number="form.bootHostShutdownTimeout" type="number" class="input" min="30" max="600" />
            <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.shutdownTimeout') }}</p>
          </div>
        </div>
      </div>

      <!-- Prerequisite Section -->
      <div class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.prerequisite') }}
        </h2>
        <div class="space-y-3">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('packageForm.fields.requiredPackage') }}</label>
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
      </div>

      <!-- Visibility Section -->
      <div class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.visibility') }}
        </h2>
        <div class="space-y-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.globalShared" type="checkbox" class="w-4 h-4 rounded" />
            <span class="text-sm text-themed-secondary">{{ t('packageForm.fields.publicAccess') }}</span>
          </label>
          <p class="text-xs text-themed-muted">{{ t('packageForm.hints.publicAccess') }}</p>
          
          <div v-if="form.globalShared" class="mt-4 space-y-4 pl-6 border-l-2" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
            <div>
              <label class="block text-xs text-themed-muted mb-1.5">
                {{ t('packageForm.fields.globalMaxInstances') }}
              </label>
              <select
                v-model.number="form.globalMaxInstances"
                required
                class="input"
              >
                <option v-for="count in publicPackageMaxInstanceOptions" :key="count" :value="count">
                  {{ count }}
                </option>
              </select>
              <p class="text-xs text-themed-muted mt-1">{{ t('packageForm.hints.globalMaxInstances') }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Advanced Options Section -->
      <div class="card p-6">
        <h2 class="text-lg font-medium mb-4" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
          {{ t('packageForm.sections.advancedOptions') }}
        </h2>
        <div class="flex items-center gap-6">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.privileged" type="checkbox" class="w-4 h-4 rounded" />
            <span class="text-sm text-themed-secondary">{{ t('admin.packages.privileged') }}</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.nested" type="checkbox" class="w-4 h-4 rounded" />
            <span class="text-sm text-themed-secondary">{{ t('admin.packages.nested') }}</span>
          </label>
        </div>
      </div>

      <!-- Form Actions -->
      <div class="flex items-center justify-end gap-4">
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
