<script setup lang="ts">
/**
 * 实例创建页面
 * 已拆分为以下子组件：
 * - RegionSelector: 地区选择
 * - PackageSelector: 套餐选择
 * - ResourceSliders: 资源配置滑块
 * - HostSelector: 宝主机选择
 * - ImageSelector: 镜像选择
 * - SSHKeySelector: SSH密钥选择
 */

// 为 KeepAlive exclude 匹配定义组件名称
defineOptions({
  name: 'InstanceCreateView'
})

import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { useConfigStore } from '@/stores/config'
import RegionSelector from '@/components/instance/RegionSelector.vue'
import type { Region } from '@/components/instance/RegionSelector.vue'
import PackageSelector from '@/components/instance/PackageSelector.vue'
import PlanSelector from '@/components/instance/PlanSelector.vue'
import ResourceSliders from '@/components/instance/ResourceSliders.vue'
import HostSelector from '@/components/instance/HostSelector.vue'
import ImageSelector from '@/components/instance/ImageSelector.vue'
import SSHKeySelector from '@/components/instance/SSHKeySelector.vue'
import InitCommandSelector from '@/components/extensions/InitCommandSelector.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import type { Package, UserQuota, SshKey, AvailableHost, CreateInstanceRequest } from '@/types/api'
import { normalizePackageSourceQuery, toPackageSourceRequest, type PackageSource } from '@/utils/publicCatalog'
import { validateName as validateInstanceName } from '@/utils/validation'
import { translateError } from '@/utils/errorHandler'
import { freeSiteCopy, getFreeSiteBillingCycleLabel } from '@/utils/freeSiteFun'
import { getVipBadgeInlineStyle, normalizeVipBadgeStyle, type VipBadgeStyle } from '@/utils/vipBadge'

interface ImageOption {
  value: string
  label: string
  icon: string | null
}

interface PackagePlan {
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
  monthlyPrice: number
  isActive: boolean
  isSoldOut: boolean
  sortOrder: number
  slaGuarantee: number | null
}

type HostingZoneTab = Awaited<ReturnType<typeof api.packages.getHostingZones>>['zones'][number]

interface SourceTab {
  key: PackageSource
  type: 'official' | 'market' | 'zone'
  label: string
  logoUrl?: string
}

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const authStore = useAuthStore()
const toast = useToast()
const themeStore = useThemeStore()
const configStore = useConfigStore()

// 右栏滚动容器 ref（选套餐后滚回顶部）
const rightPanelScrollRef = ref<HTMLElement | null>(null)

// 当前选中的套餐来源
const packageSource = ref<PackageSource>('official')
const sourceLoading = ref<boolean>(false)
const hostingZones = ref<HostingZoneTab[]>([])

// 数据加载状态
// 地区选择
const regions = ref<Region[]>([])
const selectedRegion = ref<string | null>(null)
const regionsLoading = ref<boolean>(false)

const packages = ref<Package[]>([])
const userQuota = ref<UserQuota | null>(null)
const sshKeys = ref<SshKey[]>([])
const availableHosts = ref<AvailableHost[]>([])
const availableImages = ref<ImageOption[]>([])
const packagePlans = ref<PackagePlan[]>([])
const imagesLoading = ref<boolean>(false)
const hostsLoading = ref<boolean>(false)
const plansLoading = ref<boolean>(false)
const loading = ref<boolean>(true)
const submitting = ref<boolean>(false)
const error = ref<string>('')

// 表单数据
interface InstanceForm {
  name: string
  packageId: number | null
  planId: number | null  // 付费方案ID
  hostId: number | null
  image: string
  cpu: number
  memory: number
  disk: number
  sshKeyId: number | null
  customInitCommandIds: number[]  // 用户自定义初始化命令
  promoCode: string  // 优惠码
}

const form = ref<InstanceForm>({
  name: '',
  packageId: null,
  planId: null,
  hostId: null,
  image: '',
  cpu: 15,
  memory: 128,
  disk: 512,
  sshKeyId: null,
  customInitCommandIds: [],
  promoCode: ''
})

// 优惠码验证状态
const promoCodeVerifying = ref(false)
const promoCodeValid = ref<boolean | null>(null)
const promoCodeDiscount = ref<number>(0)
const promoCodeCommissionRate = ref<number>(0)  // 返利率
const promoCodeError = ref('')

// 托管者信息弹窗
const showHostOwnerModal = ref(false)
const hostOwnerLoading = ref(false)
const hostOwnerInfo = ref<{
  id: number
  username: string
  email: string
  avatarStyle: string
  avatarBadgeId?: string | null
  hostCount: number
  instanceCount: number
  registeredDays: number
  vipLevel: number
  vipBadgeStyle?: VipBadgeStyle | null
} | null>(null)

// 是否为付费套餐（有方案）
const isPaidPackage = computed<boolean>(() => packagePlans.value.length > 0)

// 是否是用户自己的付费套餐（不允许自己开通）
const isOwnPaidPackage = computed<boolean>(() => {
  if (!selectedPackage.value || !isPaidPackage.value) return false
  return selectedPackage.value.ownerId === authStore.user?.id
})

const showDestroyTrafficNotice = computed<boolean>(() => {
  return isPaidPackage.value
    && form.value.planId !== null
    && !isOwnPaidPackage.value
})

// 根据选中地区过滤的套餐列表
const filteredPackages = computed<Package[]>(() => {
  let result: Package[]
  
  if (selectedRegion.value === null) {
    // "全部"选项：返回所有套餐
    result = packages.value
  } else {
    // 根据地区过滤：查找选中地区包含的套餐 ID
    const region = regions.value.find(r => r.code === selectedRegion.value)
    if (!region) {
      result = packages.value
    } else {
      result = packages.value.filter(pkg => region.packageIds.includes(pkg.id))
    }
  }
  
  // 售罄的套餐排在最后
  return [...result].sort((a, b) => {
    if (a.soldOut === b.soldOut) return 0
    return a.soldOut ? 1 : -1
  })
})

// 当前选中的套餐
const selectedPackage = computed<Package | undefined>(() => packages.value.find(p => p.id === form.value.packageId))

// 当前选中的方案
const selectedPlan = computed<PackagePlan | undefined>(() => packagePlans.value.find(p => p.id === form.value.planId))

const prerequisitePackageName = computed<string | null>(() => {
  if (!selectedPackage.value?.required_package_id) return null
  return selectedPackage.value.required_package_name || `#${selectedPackage.value.required_package_id}`
})

const prerequisiteMissing = computed<boolean>(() => {
  return !!selectedPackage.value?.required_package_id
    && (selectedPackage.value as Package & { has_required_package_instance?: boolean }).has_required_package_instance !== true
})

const prerequisiteMessage = computed<string>(() => {
  return t('instance.createPage.packagePrerequisiteRequired', {
    package: prerequisitePackageName.value || ''
  })
})

// 流量格式化
function formatTraffic(bytes: string): string {
  const b = BigInt(bytes || '0')
  if (b === BigInt(0)) return t('common.unlimited')
  if (b >= BigInt(1024 * 1024 * 1024 * 1024)) {
    return (Number(b) / (1024 * 1024 * 1024 * 1024)).toFixed(1) + ' TB'
  }
  if (b >= BigInt(1024 * 1024 * 1024)) {
    return (Number(b) / (1024 * 1024 * 1024)).toFixed(0) + ' GB'
  }
  return (Number(b) / (1024 * 1024)).toFixed(0) + ' MB'
}

// 计费周期标签
function getBillingCycleLabel(months: number): string {
  if (configStore.freeSiteMode) return getFreeSiteBillingCycleLabel(months)
  switch (months) {
    case 1: return t('billing.cycle.monthly')
    case 3: return t('billing.cycle.quarterly')
    case 6: return t('billing.cycle.semiAnnual')
    case 12: return t('billing.cycle.annual')
    default: return `${months} ${t('billing.cycle.months')}`
  }
}

// 方案价格计算（注意：数据库存储为分，需要转换为元）
const planPriceInfo = computed(() => {
  if (!selectedPlan.value) return null
  const plan = selectedPlan.value
  // 价格单位转换：分 -> 元
  const planPriceYuan = plan.price / 100
  const originalPrice = planPriceYuan
  const discount = promoCodeValid.value ? promoCodeDiscount.value : 0
  const discountAmount = Number((planPriceYuan * discount).toFixed(2))
  const finalPrice = Number((originalPrice - discountAmount).toFixed(2))
  return {
    originalPrice,
    planPrice: planPriceYuan,
    discountAmount,
    finalPrice,
    discountRate: discount
  }
})

// 内存格式化（MB -> GB/MB）
function formatMemory(mb: number): string {
  if (mb >= 1024) {
    return (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1) + ' GB'
  }
  return mb + ' MB'
}

// 硬盘格式化（MB -> GB，使用1024进制）
function formatDisk(mb: number): string {
  if (mb >= 1024) {
    return (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1) + ' GB'
  }
  return mb + ' MB'
}

// 从镜像名称提取发行版标识（用于 DistroIcon 组件）
function getDistroFromName(name: string): string {
  const lowerName = (name || '').toLowerCase()
  const distros = ['almalinux', 'alma', 'alpine', 'arch', 'centos', 'debian', 'fedora', 'gentoo', 'kali', 'mint', 'opensuse', 'suse', 'oracle', 'redhat', 'rhel', 'rockylinux', 'rocky', 'ubuntu', 'void']
  for (const distro of distros) {
    if (lowerName.includes(distro)) return distro
  }
  return 'linux'
}

// 获取当前选中镜像的发行版标识
const selectedImageDistro = computed(() => {
  const img = availableImages.value.find(i => i.value === form.value.image)
  return img?.icon || 'linux'
})

// 配额检查
interface QuotaCheckResult {
  valid: boolean
  errors: string[]
}

const quotaCheck = computed<QuotaCheckResult>(() => {
  if (!userQuota.value) {
    return { valid: true, errors: [] }
  }
  
  // 注意：不再限制实例配额，用户可以创建无限数量的实例
  // CPU/内存/磁盘限制由套餐包控制
  const errors: string[] = []
  
  return { valid: errors.length === 0, errors }
})

// 资源限制检查（基于套餐配额信息）
const resourceLimitCheck = computed<QuotaCheckResult>(() => {
  const errors: string[] = []
  const quotaInfo = selectedPackage.value?.quotaInfo
  
  if (!quotaInfo) {
    // 如果没有配额信息，允许提交（可能是自己的套餐，无限制）
    return { valid: true, errors: [] }
  }
  
  // 检查实例个数限制：实例个数 = 0 时禁止创建
  if (quotaInfo.remainingInstances !== null && quotaInfo.remainingInstances <= 0) {
    errors.push(t('instance.createPage.resourceLimit.noInstances'))
  }
  
  // 检查内存限制：内存 < 128MB 时禁止创建
  if (quotaInfo.remainingMemory !== null && quotaInfo.remainingMemory < 128) {
    errors.push(t('instance.createPage.resourceLimit.insufficientMemory'))
  }
  
  // 检查CPU限制：CPU < 15% 时禁止创建
  if (quotaInfo.remainingCpu !== null && quotaInfo.remainingCpu < 15) {
    errors.push(t('instance.createPage.resourceLimit.insufficientCpu'))
  }
  
  return { valid: errors.length === 0, errors }
})

const canSubmit = computed<boolean>(() => {
  // 售罄套餐不允许创建
  if (selectedPackage.value?.soldOut) {
    return false
  }

  if (prerequisiteMissing.value) {
    return false
  }
  
  const baseChecks = !!form.value.name &&
         form.value.packageId !== null &&
         form.value.hostId !== null &&
         !!form.value.image &&
         availableImages.value.length > 0 &&
         sshKeys.value.length > 0 &&
         form.value.sshKeyId !== null &&
         quotaCheck.value.valid &&
         resourceLimitCheck.value.valid &&
         !submitting.value &&
         !isOwnPaidPackage.value  // 不允许使用自己的付费套餐
  
  // 付费套餐需要选择方案
  if (isPaidPackage.value) {
    return baseChecks && form.value.planId !== null && !!selectedPlan.value && !selectedPlan.value.isSoldOut
  }
  
  return baseChecks
})

// 检测资源不足的情况
const hostsInsufficient = computed<boolean>(() => {
  // 付费套餐未选方案时，不显示资源不足警告（因为还没加载宿主机）
  if (isPaidPackage.value && form.value.planId === null) {
    return false
  }
  // 套餐绑定了宿主机但没有可用的，且不在加载中
  return !hostsLoading.value &&
         selectedPackage.value !== undefined &&
         !!selectedPackage.value.host_ids &&
         selectedPackage.value.host_ids.length > 0 &&
         availableHosts.value.length === 0
})

const createPageTextPrefix = computed(() => configStore.freeSiteMode ? 'instance.createPage.fun' : 'instance.selector')
const packageCountLabelKey = computed(() => `${createPageTextPrefix.value}.packageCount`)

function getCreatePageText(key: string): string {
  return t(`${createPageTextPrefix.value}.${key}`)
}

function getPackageSourceLabel(source: 'official' | 'market'): string {
  if (configStore.freeSiteMode) {
    return t(`instance.createPage.source.${source}`)
  }

  return t(`publicSite.market.${source}`)
}

const sourceTabs = computed<SourceTab[]>(() => {
  const tabs: SourceTab[] = [
    {
      key: 'official',
      type: 'official',
      label: getPackageSourceLabel('official')
    }
  ]

  if (configStore.hostingMarketEntryEnabled) {
    tabs.push(
      ...hostingZones.value.map(zone => ({
        key: `zone:${zone.id}` as PackageSource,
        type: 'zone' as const,
        label: zone.name,
        logoUrl: zone.logoUrl
      })),
      {
        key: 'market',
        type: 'market',
        label: getPackageSourceLabel('market')
      }
    )
  }

  return tabs
})

function isPackageSourceSelectable(source: PackageSource): boolean {
  return source === 'official' || sourceTabs.value.some(tab => tab.key === source)
}

function getSelectablePackageSource(source: PackageSource): PackageSource {
  return isPackageSourceSelectable(source) ? source : 'official'
}

const selectedHostingZone = computed<HostingZoneTab | null>(() => {
  if (!String(packageSource.value).startsWith('zone:')) return null
  const zoneId = Number(String(packageSource.value).slice('zone:'.length))
  if (!Number.isInteger(zoneId) || zoneId <= 0) return null
  return hostingZones.value.find(zone => zone.id === zoneId) || null
})

onMounted(async (): Promise<void> => {
  await configStore.loadPublicConfig(true)

  // 检查 URL 参数（分享链接）
  const packageParam = route.query.package as string | undefined
  const planParam = route.query.plan as string | undefined
  const targetPackageId = packageParam ? Number(packageParam) : null
  const targetPlanId = planParam ? Number(planParam) : null
  
  // 确定初始加载的套餐来源
  const initialSource = normalizePackageSourceQuery(route.query.source, route.query.zoneId)
  
  try {
    const [zonesRes, userRes, keysRes] = await Promise.all([
      configStore.hostingMarketEntryEnabled ? api.packages.getHostingZones() : Promise.resolve({ zones: [] as HostingZoneTab[] }),
      api.users.get(authStore.user!.id),
      api.sshKeys.list()
    ])
    hostingZones.value = configStore.hostingMarketEntryEnabled ? (zonesRes.zones || []) : []

    const effectiveInitialSource = getSelectablePackageSource(initialSource)
    const initialSourceRequest = toPackageSourceRequest(effectiveInitialSource)

    const [packagesRes, regionsRes] = await Promise.all([
      api.packages.list(initialSourceRequest),
      api.packages.getRegions(initialSourceRequest)
    ])
    
    packages.value = ((packagesRes as { packages?: Package[] }).packages || []).filter(p => p.active === 1)
    const userData = userRes as { user?: { quota?: UserQuota } }
    userQuota.value = userData.user?.quota || null
    sshKeys.value = keysRes.keys || []
    regions.value = regionsRes.regions || []
    
    // 如果有 URL 参数指定的来源，更新状态
    if (effectiveInitialSource !== 'official') {
      packageSource.value = effectiveInitialSource as PackageSource
    }
    
    // 处理分享链接参数：自动选择地区和套餐
    if (targetPackageId) {
      // 查找包含该套餐的地区
      const targetRegion = regions.value.find(r => r.packageIds.includes(targetPackageId))
      if (targetRegion) {
        selectedRegion.value = targetRegion.code
      }
      
      // 选择套餐
      const targetPkg = packages.value.find(p => p.id === targetPackageId)
      if (targetPkg) {
        await selectPackage(targetPkg, targetPlanId)
      } else {
        // 套餐不存在，提示用户并选择第一个
        toast.warning(t('instance.createPage.sharedPackageNotFound'))
        if (filteredPackages.value.length > 0) {
          selectPackage(filteredPackages.value[0])
        }
      }
    } else {
      // 没有分享链接参数，默认选中第一个套餐
      if (filteredPackages.value.length > 0) {
        selectPackage(filteredPackages.value[0])
      }
    }
    
    if (sshKeys.value.length > 0) {
      form.value.sshKeyId = sshKeys.value[0].id
    }
  } catch (err: any) {
    error.value = t('instance.createPage.loadFailed') + ': ' + (err?.message || String(err))
  } finally {
    loading.value = false
  }
})

/**
 * 切换套餐来源
 */
async function switchPackageSource(source: PackageSource): Promise<void> {
  if (!isPackageSourceSelectable(source)) return
  if (source === packageSource.value || sourceLoading.value) return
  
  sourceLoading.value = true
  packageSource.value = source
  
  // 重置选择状态
  form.value.packageId = null
  form.value.planId = null
  form.value.hostId = null
  form.value.image = ''
  packagePlans.value = []
  availableHosts.value = []
  availableImages.value = []
  selectedRegion.value = null
  
  try {
    const sourceRequest = toPackageSourceRequest(source)
    // 并行加载套餐和地区数据
    const [packagesRes, regionsRes] = await Promise.all([
      api.packages.list(sourceRequest),
      api.packages.getRegions(sourceRequest)
    ])
    
    packages.value = ((packagesRes as { packages?: Package[] }).packages || []).filter(p => p.active === 1)
    regions.value = regionsRes.regions || []
    
    // 如果有套餐，默认选中第一个
    if (filteredPackages.value.length > 0) {
      selectPackage(filteredPackages.value[0])
    }
  } catch (err: any) {
    toast.error(t('common.loadFailed'))
    console.error('Failed to load packages:', err)
  } finally {
    sourceLoading.value = false
  }
}

/**
 * 判断当前选中的套餐是否来自托管市场
 */
const isHostedMarketPackage = computed<boolean>(() => {
  if (!selectedPackage.value) return false
  return selectedPackage.value?.sourceType === 'market' || selectedPackage.value?.sourceType === 'zone'
})

// 是否正在切换套餐（用于防止 watch 意外触发 loadAvailableHosts）
const isSwitchingPackage = ref(false)

/**
 * 选择地区
 */
function selectRegion(regionCode: string | null): void {
  selectedRegion.value = regionCode
  // 重置套餐选择
  form.value.packageId = null
  form.value.planId = null
  form.value.hostId = null
  form.value.image = ''
  packagePlans.value = []
  availableHosts.value = []
  availableImages.value = []
  
  // 如果过滤后有套餐，自动选中第一个
  if (filteredPackages.value.length > 0) {
    selectPackage(filteredPackages.value[0])
  }
}

async function selectPackage(pkg: Package, preferredPlanId?: number | null): Promise<void> {
  isSwitchingPackage.value = true  // 开始切换套餐
  
  form.value.packageId = pkg.id
  form.value.hostId = null
  form.value.image = ''
  form.value.planId = null  // 重置方案选择
  packagePlans.value = []   // 清空方案列表
  availableHosts.value = [] // 清空宿主机列表，避免显示旧数据
  availableImages.value = []
  resetPromoCode()          // 重置优惠码状态
  
  // 先加载套餐方案（这样才能正确判断是否是付费套餐）
  await loadPackagePlans(pkg.id)

  if (packagePlans.value.length > 0 && preferredPlanId) {
    const matchedPlan = packagePlans.value.find(plan => plan.id === preferredPlanId)
    if (matchedPlan && !matchedPlan.isSoldOut) {
      selectPlan(matchedPlan)
    }
  }
  
  // 如果是免费套餐（没有方案），设置默认资源值
  if (packagePlans.value.length === 0) {
    // CPU：最小15%，步长5%，确保不超过套餐最大值
    const cpuMax = Math.max(15, pkg.cpu_max) // 确保套餐最大值至少为15%
    const cpuHalf = Math.ceil(cpuMax / 2)
    form.value.cpu = Math.max(15, Math.min(Math.floor(cpuHalf / 5) * 5, cpuMax))
    
    // 内存：最小128MB，步长64MB，确保不超过套餐最大值
    const memoryMax = Math.max(128, pkg.memory_max) // 确保套餐最大值至少为128MB
    const memoryHalf = Math.ceil(memoryMax / 2)
    form.value.memory = Math.max(128, Math.min(Math.floor(memoryHalf / 64) * 64, memoryMax))
    
    // 硬盘：最小512MB，步长0.1GB (102MB)，确保不超过套餐最大值
    const diskMax = Math.max(512, pkg.disk_max) // 确保套餐最大值至少为512MB
    const diskHalf = Math.ceil(diskMax / 2)
    form.value.disk = Math.max(512, Math.min(Math.floor(diskHalf / 102) * 102, diskMax))
  }
  
  isSwitchingPackage.value = false  // 结束切换套餐

  // 选套餐后右栏滚回顶部
  if (rightPanelScrollRef.value) {
    rightPanelScrollRef.value.scrollTop = 0
  }
  
  // 加载套餐详情以获取quotaInfo（仅在套餐信息中还没有quotaInfo时加载）
  const currentPkg = packages.value.find(p => p.id === pkg.id)
  if (!currentPkg?.quotaInfo) {
    try {
      const detailRes = await api.packages.get(pkg.id) as any
      const detailPkg = detailRes.package || detailRes
      // 更新packages数组中的套餐信息，包含quotaInfo
      const index = packages.value.findIndex(p => p.id === pkg.id)
      if (index !== -1) {
        packages.value[index] = { 
          ...packages.value[index], 
          quotaInfo: detailPkg.quotaInfo || null,
          required_package_id: detailPkg.required_package_id ?? packages.value[index].required_package_id ?? null,
          required_package_name: detailPkg.required_package_name ?? packages.value[index].required_package_name ?? null,
          has_required_package_instance: detailPkg.has_required_package_instance ?? (packages.value[index] as any).has_required_package_instance ?? true
        }
      }
    } catch (err) {
      // 静默失败，不影响其他功能
      console.warn('Failed to load package quota info:', err)
    }
  }
  
  // 检查套餐是否绑定了宿主机
  if (!pkg.host_ids || pkg.host_ids.length === 0) {
    availableHosts.value = []
    availableImages.value = []
    form.value.image = ''
    toast.warning(t('instance.createPage.packageNoHosts'))
  } else {
    // 免费套餐需要加载宿主机，付费套餐由方案选择时加载
    if (!isPaidPackage.value) {
      loadAvailableHosts()
    }
  }
  
  previousMemoryIsLow = form.value.memory <= 128
}

/**
 * 加载套餐方案列表
 */
async function loadPackagePlans(packageId: number): Promise<void> {
  plansLoading.value = true
  try {
    const res = await api.packages.getPlans(packageId, { activeOnly: true })
    packagePlans.value = res.plans || []
  } catch (err) {
    console.warn('Failed to load package plans:', err)
    packagePlans.value = []
  } finally {
    plansLoading.value = false
  }
}

/**
 * 选择付费方案
 */
function selectPlan(plan: PackagePlan): void {
  if (plan.isSoldOut || !plan.isActive) {
    return
  }

  form.value.planId = plan.id
  // 使用方案的固定资源配置
  form.value.cpu = plan.cpu
  form.value.memory = plan.memory
  form.value.disk = plan.disk
  // 重置优惠码状态
  resetPromoCode()
  // 加载可用宿主机
  loadAvailableHosts()
}

/**
 * 重置优惠码状态
 */
function resetPromoCode(): void {
  form.value.promoCode = ''
  promoCodeValid.value = null
  promoCodeDiscount.value = 0
  promoCodeCommissionRate.value = 0
  promoCodeError.value = ''
}

/**
 * 验证优惠码
 */
async function verifyPromoCode(): Promise<void> {
  if (!form.value.promoCode.trim() || !form.value.planId) {
    resetPromoCode()
    return
  }
  
  promoCodeVerifying.value = true
  promoCodeError.value = ''
  
  try {
    const res = await api.aff.validateCode(form.value.promoCode.trim(), form.value.planId)
    if ((res as any).valid) {
      promoCodeValid.value = true
      promoCodeDiscount.value = parseFloat((res as any).discountRate) || 0
      // 从验证响应中获取返利率（如果有的话）
      const commissionRate = parseFloat((res as any).commissionRate) || 0
      promoCodeCommissionRate.value = commissionRate
    } else {
      promoCodeValid.value = false
      promoCodeError.value = (res as any).error || t('aff.promoCodeInvalid')
    }
  } catch (err: any) {
    promoCodeValid.value = false
    promoCodeError.value = err.message || t('aff.promoCodeInvalid')
  } finally {
    promoCodeVerifying.value = false
  }
}

/**
 * 加载托管者信息（点击 UID 标签时触发）
 */
async function loadHostOwnerInfo(packageId: number): Promise<void> {
  hostOwnerLoading.value = true
  hostOwnerInfo.value = null
  showHostOwnerModal.value = true
  
  try {
    const res = await api.packages.getOwnerInfo(packageId)
    hostOwnerInfo.value = res
  } catch (err: any) {
    toast.error(err.message || t('common.loadFailed'))
    showHostOwnerModal.value = false
  } finally {
    hostOwnerLoading.value = false
  }
}

async function loadAvailableHosts(): Promise<void> {
  if (!form.value.packageId) {
    availableHosts.value = []
    form.value.hostId = null
    availableImages.value = []
    form.value.image = ''
    return
  }
  
  // 如果套餐没有绑定宿主机，不发起 API 请求
  if (!selectedPackage.value?.host_ids || selectedPackage.value.host_ids.length === 0) {
    availableHosts.value = []
    form.value.hostId = null
    availableImages.value = []
    form.value.image = ''
    return
  }
  
  hostsLoading.value = true
  try {
    const res = await api.instances.getAvailableHosts({
      packageId: form.value.packageId,
      planId: form.value.planId || undefined,
      cpu: form.value.cpu,
      memory: form.value.memory,
      disk: form.value.disk
    })
    availableHosts.value = (res as { hosts?: AvailableHost[] }).hosts || []

    if (availableHosts.value.length === 0) {
      form.value.hostId = null
      availableImages.value = []
      form.value.image = ''
      return
    }

    const currentExists = availableHosts.value.some(host => host.id === form.value.hostId)
    if (!currentExists) {
      form.value.hostId = availableHosts.value[0].id
    }
  } catch (err: any) {
    availableHosts.value = []
    form.value.hostId = null
    availableImages.value = []
    form.value.image = ''
    
    // 如果是套餐没有绑定宿主机的错误，显示友好提示
    if (err?.response?.data?.code === 'PACKAGE_NO_HOSTS' || err?.message?.includes('bind at least one host')) {
      toast.error(t('instance.createPage.packageNoHosts'))
    }
  } finally {
    hostsLoading.value = false
  }
}

watch(() => form.value.packageId, () => {
  if (selectedPackage.value) {
    // 确保CPU值符合最小值和步长要求（15%起步，步长5%）
    const cpuMax = Math.max(15, selectedPackage.value.cpu_max)
    const normalizedCpu = Math.max(15, Math.min(Math.floor(form.value.cpu / 5) * 5, cpuMax))
    form.value.cpu = normalizedCpu
    // 确保内存和硬盘值符合最小值和步长要求
    const memoryMax = Math.max(128, selectedPackage.value.memory_max)
    const normalizedMemory = Math.max(128, Math.min(Math.floor(form.value.memory / 64) * 64, memoryMax))
    const diskMax = Math.max(512, selectedPackage.value.disk_max)
    const normalizedDisk = Math.max(512, Math.min(Math.floor(form.value.disk / 102) * 102, diskMax))
    form.value.memory = normalizedMemory
    form.value.disk = normalizedDisk
  }
})

watch([() => form.value.cpu, () => form.value.memory, () => form.value.disk], () => {
  // 付费套餐不需要监听资源变化（配置固定）
  // 切换套餐时也不触发（避免用旧资源值查询）
  if (form.value.packageId && !isPaidPackage.value && !isSwitchingPackage.value) {
    loadAvailableHosts()
  }
}, { immediate: false })

watch(() => form.value.hostId, (newHostId) => {
  if (!selectedPackage.value || isSwitchingPackage.value) return

  if (!newHostId) {
    availableImages.value = []
    form.value.image = ''
    return
  }

  loadAvailableImages(
    selectedPackage.value.instance_type as 'container' | 'vm' | undefined,
    form.value.memory,
    newHostId
  )
}, { immediate: false })

// 内存变化时重新加载镜像（128MB 限制只能选 Alpine/Debian）
let previousMemoryIsLow = false
watch(() => form.value.memory, (newMemory) => {
  if (!selectedPackage.value || isSwitchingPackage.value) return
  
  const currentIsLow = newMemory <= 128
  // 只有在跨越 128MB 阈值时才重新加载镜像
  if (currentIsLow !== previousMemoryIsLow) {
    previousMemoryIsLow = currentIsLow
    loadAvailableImages(
      selectedPackage.value.instance_type as 'container' | 'vm' | undefined,
      newMemory,
      form.value.hostId || undefined
    )
  }
}, { immediate: false })

async function loadAvailableImages(instanceType?: 'container' | 'vm', memory?: number, hostId?: number): Promise<void> {
  if (!hostId) {
    availableImages.value = []
    form.value.image = ''
    return
  }

  imagesLoading.value = true
  try {
    const res = await api.images.getSystemImages(instanceType, memory, hostId)
    availableImages.value = (res.images || []).map(img => ({
      value: img.remoteAlias,
      label: img.name,
      icon: img.icon || getDistroFromName(img.name)
    }))
    
    if (availableImages.value.length > 0) {
      const currentExists = availableImages.value.some((img) => img.value === form.value.image)
      if (!currentExists) {
        form.value.image = availableImages.value[0].value
      }
    } else {
      form.value.image = ''
    }
  } catch (_err) {
    availableImages.value = []
    form.value.image = ''
  } finally {
    imagesLoading.value = false
  }
}

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) return
  
  error.value = ''
  submitting.value = true
  
  try {
    if (form.value.packageId === null) throw new Error(t('instance.createPage.selectPackage'))
    if (form.value.hostId === null) throw new Error(getCreatePageText('selectHost'))
    if (form.value.sshKeyId === null) throw new Error(getCreatePageText('selectSshKey'))
    
    // 验证实例名称
    const nameValidation = validateInstanceName(form.value.name)
    if (!nameValidation.valid) {
      throw new Error(nameValidation.message)
    }

    await api.instances.create({
      name: form.value.name,
      packageId: form.value.packageId,
      planId: form.value.planId || undefined,
      hostId: form.value.hostId,
      image: form.value.image,
      cpu: form.value.cpu,
      memory: form.value.memory,
      disk: form.value.disk,
      sshKeyId: form.value.sshKeyId,
      customInitCommandIds: form.value.customInitCommandIds.length > 0 ? form.value.customInitCommandIds : undefined,
      promoCode: (isPaidPackage.value && promoCodeValid.value && form.value.promoCode.trim()) ? form.value.promoCode.trim() : undefined
    } as CreateInstanceRequest & { promoCode?: string })
    
    toast.success(t('instance.createPage.createSuccess'))
    router.push('/instances')
  } catch (err: any) {
    error.value = translateError(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="animate-fade-in lg:h-full lg:flex lg:flex-col">
    <!-- 套餐来源切换器 -->
    <div v-if="!loading" class="flex justify-center mb-4 lg:mb-3 shrink-0">
      <div
        class="inline-flex max-w-full overflow-x-auto p-1 rounded-full scrollbar-hide"
        :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
      >
        <button
          v-for="source in sourceTabs"
          :key="source.key"
          type="button"
          :disabled="sourceLoading"
          class="relative shrink-0 px-4 py-2 text-sm font-medium rounded-full transition-all duration-300"
          :class="[
            packageSource === source.key
              ? themeStore.isDark
                ? 'bg-white text-gray-900 shadow-lg'
                : 'bg-gray-900 text-white shadow-lg'
              : themeStore.isDark
                ? 'text-gray-400 hover:text-gray-200'
                : 'text-gray-600 hover:text-gray-900',
            sourceLoading ? 'cursor-not-allowed opacity-50' : ''
          ]"
          @click="switchPackageSource(source.key)"
        >
          <span class="relative z-10 flex items-center gap-1.5">
            <!-- 加载中 -->
            <svg 
              v-if="sourceLoading && packageSource === source.key"
              class="w-4 h-4 animate-spin" 
              fill="none" viewBox="0 0 24 24"
            >
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <!-- 图标 -->
            <template v-else>
              <svg v-if="source.type === 'official'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <img
                v-else-if="source.type === 'zone'"
                :src="source.logoUrl"
                :alt="source.label"
                class="w-5 h-5 rounded-full object-cover"
              />
              <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </template>
            {{ source.label }}
          </span>
        </button>
      </div>
    </div>

    <div v-if="loading" class="card p-8 text-center text-themed-muted">
      <svg class="w-8 h-8 mx-auto mb-2 animate-spin icon-themed-muted" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      {{ $t('common.loading') }}
    </div>

    <form v-else class="lg:flex-1 lg:min-h-0 lg:flex lg:flex-col" @submit.prevent="handleSubmit">
      <div class="lg:flex lg:flex-1 lg:min-h-0 lg:gap-6">
        <!-- LEFT: 选择区（独立滚动）-->
        <div class="space-y-4 mb-4 lg:mb-0 lg:flex-[3] lg:overflow-y-auto lg:pr-1 lg:pb-4 scrollbar-hide">
          <div
            v-if="selectedHostingZone"
            class="rounded-lg border border-themed bg-themed-tertiary px-5 py-3 text-center"
          >
            <p class="text-sm font-medium leading-6 text-themed-secondary">
              {{ $t('instance.createPage.zoneNotice.content', { uid: selectedHostingZone.ownerId, username: selectedHostingZone.ownerUsername }) }}
            </p>
          </div>
          <RegionSelector
            v-if="regions.length > 0"
            :regions="regions"
            :selected-region="selectedRegion"
            :loading="regionsLoading"
            :title="getCreatePageText('selectRegion')"
            :package-count-label-key="packageCountLabelKey"
            @select="selectRegion"
          />
          <PackageSelector
            :packages="filteredPackages"
            :selected-package-id="form.packageId"
            :step-number="regions.length > 0 ? 2 : 1"
            :title="getCreatePageText('selectPackage')"
            :empty-message="getCreatePageText('noPackages')"
            :sold-out-label="getCreatePageText('planSoldOut')"
            @select="selectPackage"
            @show-owner-info="(packageId) => loadHostOwnerInfo(packageId)"
          />
        </div>
        <!-- RIGHT: 配置区（独立滚动）-->
        <div class="lg:flex-[2] lg:overflow-y-auto lg:pb-4 scrollbar-hide">
          <div ref="rightPanelScrollRef" class="space-y-4">
            <PlanSelector
              v-if="isPaidPackage"
              :plans="packagePlans"
              :selected-plan-id="form.planId"
              :instance-type="(selectedPackage?.instance_type === 'vm' ? 'vm' : 'container')"
              :loading="plansLoading"
              :step-number="regions.length > 0 ? 3 : 2"
              :prerequisite-message="prerequisiteMissing ? prerequisiteMessage : null"
              :free-site-mode="configStore.freeSiteMode"
              :title="getCreatePageText('selectPlan')"
              :description="getCreatePageText('planDesc')"
              :empty-message="getCreatePageText('noPlans')"
              :sold-out-label="getCreatePageText('planSoldOut')"
              :custom-plan-hint="getCreatePageText('customPlanHint')"
              @select="selectPlan"
            />
            <div
              v-else-if="prerequisiteMissing"
              class="rounded-lg border px-4 py-3 text-sm"
              :class="themeStore.isDark ? 'border-amber-500/30 bg-amber-900/20 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-700'"
            >
              {{ prerequisiteMessage }}
            </div>
            <ResourceSliders
              v-else
              :selected-package="selectedPackage || null"
              :user-quota="userQuota"
              :cpu="form.cpu"
              :memory="form.memory"
              :disk="form.disk"
              :step-number="regions.length > 0 ? 3 : 2"
              @update:cpu="form.cpu = $event"
              @update:memory="form.memory = $event"
              @update:disk="form.disk = $event"
            />
            <HostSelector
              :available-hosts="availableHosts"
              :selected-host-id="form.hostId"
              :hosts-loading="hostsLoading"
              :hosts-insufficient="hostsInsufficient"
              :cpu="form.cpu"
              :memory="form.memory"
              :selected-package="selectedPackage || null"
              :show-deduction="!isPaidPackage || form.planId !== null"
              :title="getCreatePageText('selectHost')"
              :auto-selected-label="getCreatePageText('hostAutoSelected')"
              @update:selected-host-id="form.hostId = $event"
            />
            <ImageSelector
              :available-images="availableImages"
              :selected-image="form.image"
              :images-loading="imagesLoading"
              :step-number="regions.length > 0 ? 4 : 3"
              :title="getCreatePageText('selectSystem')"
              :empty-message="getCreatePageText('noImages')"
              @update:selected-image="form.image = $event"
            />
            <div v-if="form.image" class="card p-5">
              <InitCommandSelector v-model="form.customInitCommandIds" :distro="selectedImageDistro" />
            </div>
            <SSHKeySelector
              :ssh-keys="sshKeys"
              :selected-key-id="form.sshKeyId"
              :step-number="regions.length > 0 ? 5 : 4"
              :title="getCreatePageText('selectSshKey')"
              @update:selected-key-id="form.sshKeyId = $event"
            />
            <!-- 订单概览 -->
            <div v-if="isPaidPackage && form.planId && selectedPlan" class="card p-5">
              <div class="flex items-center gap-3 mb-5">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" :class="themeStore.isDark ? 'bg-blue-500/20' : 'bg-blue-100'">
                  <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                </div>
                <div>
                  <h3 class="font-semibold text-themed">{{ configStore.freeSiteMode ? freeSiteCopy.createOrderSummary : $t('instance.createPage.orderSummary') }}</h3>
                  <p class="text-xs text-themed-muted">{{ selectedPackage?.name }} - {{ selectedPlan.name }}</p>
                </div>
              </div>
              <div class="space-y-4">
                <div class="p-4 rounded-xl border-2" :class="themeStore.isDark ? 'border-blue-500/30 bg-blue-500/5' : 'border-blue-200 bg-blue-50/50'">
                  <div class="flex items-center justify-between mb-3">
                    <span class="px-2.5 py-1 rounded-full text-xs font-medium" :class="themeStore.isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700'">{{ getBillingCycleLabel(selectedPlan.billingCycle) }}</span>
                    <span v-if="selectedPlan.slaGuarantee" class="flex items-center gap-1 text-xs text-green-500">
                      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>
                      SLA {{ selectedPlan.slaGuarantee }}%
                    </span>
                  </div>
                  <div class="grid grid-cols-4 gap-3 text-center">
                    <div><div class="text-lg font-bold" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ selectedPlan.cpu }}%</div><div class="text-xs text-themed-muted">CPU</div></div>
                    <div>
                      <div class="text-lg font-bold" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ formatMemory(selectedPlan.memory) }}</div>
                      <div class="text-xs text-themed-muted leading-tight">
                        <div>{{ $t('instance.memory') }}</div>
                        <div v-if="selectedPackage?.instance_type !== 'vm' && selectedPlan.swapSize > 0" class="opacity-60">SWAP ✅</div>
                      </div>
                    </div>
                    <div><div class="text-lg font-bold" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ formatDisk(selectedPlan.disk) }}</div><div class="text-xs text-themed-muted">{{ $t('instance.disk') }}</div></div>
                    <div><div class="text-lg font-bold" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">{{ formatTraffic(selectedPlan.trafficLimit) }}</div><div class="text-xs text-themed-muted">{{ $t('billing.traffic') }} <span class="opacity-60">({{ $t('billing.trafficBidirectional') }})</span></div></div>
                  </div>
                  <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-3 pt-3 border-t text-xs" :class="themeStore.isDark ? 'border-blue-500/20' : 'border-blue-200'">
                    <span class="text-themed-muted"><span class="opacity-75">{{ $t('instance.ports') }}:</span> {{ selectedPlan.portLimit }}</span>
                    <span class="text-themed-muted"><span class="opacity-75">{{ $t('instance.snapshots') }}:</span> {{ selectedPlan.snapshotLimit }}</span>
                  </div>
                </div>
                <!-- 优惠码 -->
                <div class="space-y-3">
                  <div>
                    <label class="label text-xs uppercase tracking-wide text-themed-muted mb-2">{{ configStore.freeSiteMode ? freeSiteCopy.createPromoCode : $t('aff.promoCode') }}</label>
                    <div class="relative">
                      <input v-model="form.promoCode" type="text" class="input w-full pr-10" :placeholder="isHostedMarketPackage ? (configStore.freeSiteMode ? freeSiteCopy.createPromoHostedDisabled : $t('aff.promoCodeHostedDisabled')) : (configStore.freeSiteMode ? freeSiteCopy.createPromoPlaceholder : $t('aff.promoCodePlaceholder'))" :disabled="promoCodeVerifying || isHostedMarketPackage" @blur="verifyPromoCode" @keyup.enter="verifyPromoCode" />
                      <div v-if="promoCodeVerifying" class="absolute right-3 top-1/2 -translate-y-1/2"><svg class="w-5 h-5 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>
                      <div v-else-if="promoCodeValid === true" class="absolute right-3 top-1/2 -translate-y-1/2"><svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></div>
                      <div v-else-if="promoCodeValid === false" class="absolute right-3 top-1/2 -translate-y-1/2"><svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></div>
                    </div>
                    <p v-if="promoCodeValid === true" class="text-xs text-green-500 mt-1.5 flex items-center gap-1"><svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>{{ configStore.freeSiteMode ? freeSiteCopy.createPromoValid.replace('{rate}', (promoCodeDiscount * 100).toFixed(0) + '%') : $t('aff.promoCodeValid', { rate: (promoCodeDiscount * 100).toFixed(0) + '%' }) }}</p>
                    <p v-else-if="promoCodeError" class="text-xs text-red-500 mt-1.5">{{ promoCodeError }}</p>
                  </div>
                  <div v-if="promoCodeValid === true" class="p-3 rounded-lg text-sm" :class="themeStore.isDark ? 'bg-blue-900/20 border border-blue-800/30 text-blue-300' : 'bg-blue-50 border border-blue-200 text-blue-700'">
                    <div class="flex items-start gap-2">
                      <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>
                      <div>
                        <p class="font-medium">{{ configStore.freeSiteMode ? freeSiteCopy.createPromoUsing : $t('aff.usingPromoCode') }}</p>
                        <p class="text-xs mt-1 opacity-80">{{ configStore.freeSiteMode ? freeSiteCopy.createPromoBenefit : $t('aff.promoCodeBenefit', { discount: (promoCodeDiscount * 100).toFixed(0) + '%', commission: (promoCodeCommissionRate * 100).toFixed(0) }) }}</p>
                        <p v-if="planPriceInfo && selectedPlan" class="text-xs mt-1 opacity-80">{{ configStore.freeSiteMode ? freeSiteCopy.createCommissionEstimate.replace('{amount}', (planPriceInfo.planPrice * promoCodeCommissionRate).toFixed(2)) : $t('aff.commissionEstimate', { amount: (planPriceInfo.planPrice * promoCodeCommissionRate).toFixed(2) }) }}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- 价格明细 -->
                <div v-if="planPriceInfo" class="space-y-3">
                  <div v-if="promoCodeValid && planPriceInfo.discountAmount > 0" class="p-4 rounded-xl space-y-2" :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-100'">
                    <div class="flex justify-between text-sm"><span class="text-themed-muted">{{ configStore.freeSiteMode ? freeSiteCopy.createPlanFee : $t('instance.createPage.planFee') }}</span><span class="text-themed font-medium">¥{{ planPriceInfo.planPrice.toFixed(2) }}</span></div>
                    <div v-if="promoCodeValid && planPriceInfo.discountAmount > 0" class="flex justify-between text-sm pt-1 border-t border-themed/20">
                      <span class="text-green-500 flex items-center gap-1"><svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm2.5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6.207.293a1 1 0 00-1.414 0l-6 6a1 1 0 101.414 1.414l6-6a1 1 0 000-1.414zM12.5 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" clip-rule="evenodd" /></svg>{{ $t('aff.discountAmount') }} (-{{ (planPriceInfo.discountRate * 100).toFixed(0) }}%)</span>
                      <span class="text-green-600 dark:text-green-400 font-medium">-¥{{ planPriceInfo.discountAmount.toFixed(2) }}</span>
                    </div>
                  </div>
                  <div class="rounded-xl overflow-hidden" :class="themeStore.isDark ? 'border border-blue-800/50' : 'border border-blue-200'">
                    <div class="p-5 flex items-center justify-between" :class="themeStore.isDark ? 'bg-gradient-to-r from-blue-900/50 to-indigo-900/50' : 'bg-gradient-to-r from-blue-50 to-indigo-50'">
                      <div>
                        <div class="text-sm font-medium" :class="themeStore.isDark ? 'text-blue-300' : 'text-blue-700'">{{ configStore.freeSiteMode ? freeSiteCopy.finalPrice : $t('aff.finalPrice') }}</div>
                        <div v-if="selectedPlan.billingCycle > 1" class="text-xs mt-1">
                          <span :class="themeStore.isDark ? 'text-blue-400/70' : 'text-blue-600/70'">{{ configStore.freeSiteMode ? freeSiteCopy.createMonthlyEquivalent : `≈ ¥${(planPriceInfo.finalPrice / selectedPlan.billingCycle).toFixed(2)}/${$t('instance.createPage.month')}` }}</span>
                        </div>
                      </div>
                      <div class="text-3xl font-bold" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">¥{{ planPriceInfo.finalPrice.toFixed(2) }}</div>
                    </div>
                    <div v-if="isHostedMarketPackage" class="px-4 py-3 flex items-center gap-2" :class="themeStore.isDark ? 'bg-amber-900/20 border-t border-amber-500/20' : 'bg-amber-50/80 border-t border-amber-200'">
                      <svg class="w-4 h-4 flex-shrink-0" :class="themeStore.isDark ? 'text-amber-400' : 'text-amber-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      <p class="text-xs" :class="themeStore.isDark ? 'text-amber-300/90' : 'text-amber-700'"><span class="font-medium">{{ $t('instance.createPage.hostedDisclaimer.title') }}</span> {{ $t('instance.createPage.hostedDisclaimer.content', { uid: selectedPackage?.ownerId }) }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div><!-- end scrollable -->

          <!-- 吸底提交区 -->
          <div class="card p-4 mt-4 space-y-3">
            <div>
              <label class="block text-sm text-themed-secondary mb-1.5">{{ $t('instance.createPage.instanceName') }}</label>
              <p v-if="showDestroyTrafficNotice" class="mb-2 text-xs leading-relaxed flex items-start gap-1.5" :class="themeStore.isDark ? 'text-amber-300' : 'text-amber-700'">
                <svg class="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M12 3a9 9 0 110 18 9 9 0 010-18z" />
                </svg>
                <span>{{ $t('instance.createPage.destroyTrafficNotice') }}</span>
              </p>
              <input v-model="form.name" type="text" class="input w-full" :placeholder="$t('instance.createPage.instanceNamePlaceholder')" required />
            </div>
            <div v-if="sshKeys.length === 0" class="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-400 dark:border-yellow-500/30 rounded-lg">
              <p class="text-sm text-yellow-800 dark:text-yellow-300 font-medium mb-1">⚠️ {{ $t('instance.createPage.missingSshKey') }}</p>
              <p class="text-xs text-yellow-700 dark:text-yellow-400">{{ $t('instance.createPage.missingSshKeyDesc') }} <router-link to="/profile" class="underline hover:text-yellow-900 dark:hover:text-yellow-200 font-medium">{{ $t('instance.createPage.profileSettings') }}</router-link> {{ $t('instance.createPage.addSshKey') }}</p>
            </div>
            <div v-if="!quotaCheck.valid" class="p-3 rounded-lg border" :class="themeStore.isDark ? 'bg-red-900/20 border-red-500/30' : 'bg-red-50 border-red-200'">
              <p class="text-sm font-medium mb-2" :class="themeStore.isDark ? 'text-red-400' : 'text-red-700'">{{ $t('instance.createPage.quotaInsufficient') }}</p>
              <ul class="text-xs space-y-1" :class="themeStore.isDark ? 'text-red-300' : 'text-red-600'"><li v-for="(err, idx) in quotaCheck.errors" :key="idx">• {{ err }}</li></ul>
            </div>
            <div v-if="!resourceLimitCheck.valid" class="p-3 rounded-lg border" :class="themeStore.isDark ? 'bg-red-900/20 border-red-500/30' : 'bg-red-50 border-red-200'">
              <p class="text-sm font-medium mb-2" :class="themeStore.isDark ? 'text-red-400' : 'text-red-700'">{{ $t('instance.createPage.resourceLimit.title') }}</p>
              <ul class="text-xs space-y-1" :class="themeStore.isDark ? 'text-red-300' : 'text-red-600'"><li v-for="(err, idx) in resourceLimitCheck.errors" :key="idx">• {{ err }}</li></ul>
            </div>
            <div v-if="isOwnPaidPackage" class="p-3 rounded-lg border" :class="themeStore.isDark ? 'bg-amber-900/20 border-amber-500/30' : 'bg-amber-50 border-amber-200'">
              <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-amber-400' : 'text-amber-700'">{{ $t('instance.createPage.ownPaidPackageWarning') }}</p>
            </div>
            <div v-if="prerequisiteMissing" class="p-3 rounded-lg border" :class="themeStore.isDark ? 'bg-amber-900/20 border-amber-500/30' : 'bg-amber-50 border-amber-200'">
              <p class="text-sm font-medium" :class="themeStore.isDark ? 'text-amber-400' : 'text-amber-700'">{{ prerequisiteMessage }}</p>
            </div>
            <div v-if="error" class="p-3 rounded-lg border text-sm" :class="themeStore.isDark ? 'bg-red-900/20 border-red-500/30 text-red-400' : 'bg-red-50 border-red-200 text-red-700'">{{ error }}</div>
            <button type="submit" :disabled="!canSubmit" class="btn-primary w-full">{{ submitting ? $t('instance.createPage.creating') : $t('instance.create') }}</button>
          </div>
        </div><!-- end right col -->
      </div><!-- end grid -->
    </form>
  </div>

  <!-- 托管者信息弹窗 -->
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="showHostOwnerModal" class="modal-overlay">
        <div class="modal-backdrop" @click="showHostOwnerModal = false"></div>
        <div class="modal-content max-w-sm">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('instance.detail.info.hostOwnerTitle') }}</h3>
            <button type="button" class="text-themed-muted hover:text-themed" @click="showHostOwnerModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="modal-body">
            <!-- 加载状态 -->
            <div v-if="hostOwnerLoading" class="flex justify-center py-8">
              <svg class="w-8 h-8 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <!-- 托管者信息 -->
            <template v-else-if="hostOwnerInfo">
              <!-- 用户头像区域 -->
              <div class="flex items-center gap-4 mb-6">
                <UserAvatar
                  :username="hostOwnerInfo.username"
                  :email="hostOwnerInfo.email"
                  :avatar-style="hostOwnerInfo.avatarStyle"
                  :badge-id="hostOwnerInfo.avatarBadgeId || null"
                  :size="56"
                />
                <div class="flex-1">
                  <p class="font-medium text-themed">{{ hostOwnerInfo.username }}</p>
                  <p class="text-sm text-themed-muted">UID: {{ hostOwnerInfo.id }}</p>
                </div>
                <!-- VIP徽章 -->
                <div 
                  v-if="hostOwnerInfo.vipLevel > 0"
                  class="px-3 py-1.5 rounded-full border text-xs font-bold flex items-center gap-1.5 shadow-sm"
                  :style="getVipBadgeInlineStyle(normalizeVipBadgeStyle(hostOwnerInfo.vipBadgeStyle, hostOwnerInfo.vipLevel))"
                >
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                  </svg>
                  VIP{{ hostOwnerInfo.vipLevel }}
                </div>
              </div>
              <!-- 详细信息 -->
              <div class="space-y-3">
                <div 
                  class="flex items-center justify-between p-3 rounded-lg"
                  :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
                >
                  <span class="text-sm text-themed-muted flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                    </svg>
                    {{ $t('instance.detail.info.hostOwnerHostCount') }}
                  </span>
                  <span class="text-sm font-semibold" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'">
                    {{ hostOwnerInfo.hostCount }}
                  </span>
                </div>
                <div 
                  class="flex items-center justify-between p-3 rounded-lg"
                  :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
                >
                  <span class="text-sm text-themed-muted flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    {{ $t('instance.detail.info.hostOwnerInstanceCount') }}
                  </span>
                  <span class="text-sm font-semibold" :class="themeStore.isDark ? 'text-green-400' : 'text-green-600'">
                    {{ hostOwnerInfo.instanceCount }}
                  </span>
                </div>
                <div 
                  class="flex items-center justify-between p-3 rounded-lg"
                  :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
                >
                  <span class="text-sm text-themed-muted flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {{ $t('instance.detail.info.hostOwnerRegisteredDays') }}
                  </span>
                  <span class="text-sm font-semibold" :class="themeStore.isDark ? 'text-purple-400' : 'text-purple-600'">
                    {{ hostOwnerInfo.registeredDays }} {{ $t('common.days') }}
                  </span>
                </div>
              </div>
            </template>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-primary" @click="showHostOwnerModal = false">
              {{ $t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
