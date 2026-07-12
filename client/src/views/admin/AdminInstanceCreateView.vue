<script setup lang="ts">
/**
 * 管理员创建实例页面
 * 支持创建免费实例或付费实例
 */
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import PackageSelector from '@/components/instance/PackageSelector.vue'
import ResourceSliders from '@/components/instance/ResourceSliders.vue'
import HostSelector from '@/components/instance/HostSelector.vue'
import ImageSelector from '@/components/instance/ImageSelector.vue'
import type { Package, AvailableHost, PackagePlan } from '@/types/api'
import { validateName as validateInstanceName } from '@/utils/validation'
import { translateError } from '@/utils/errorHandler'

interface ImageOption {
  value: string
  label: string
  icon: string | null
}

type PackageScope = 'official' | 'hosted'

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

// 数据加载状态
const packages = ref<Package[]>([])
const availableHosts = ref<AvailableHost[]>([])
const availableImages = ref<ImageOption[]>([])
const imagesLoading = ref<boolean>(false)
const hostsLoading = ref<boolean>(false)
const loading = ref<boolean>(true)
const packagesLoading = ref<boolean>(false)
const submitting = ref<boolean>(false)
const error = ref<string>('')

// 用户名搜索
const usernameInput = ref('')
const usernameValid = ref<boolean | null>(null)
const usernameChecking = ref(false)
const targetUser = ref<{ id: number; username: string; balance?: number } | null>(null)

// 实例类型选择：免费/付费
const instanceType = ref<'free' | 'paid'>('free')
const packageScope = ref<PackageScope>('official')

// 付费方案相关
const plans = ref<PackagePlan[]>([])
const plansLoading = ref(false)
const selectedPlanId = ref<number | null>(null)
const chargeFirstMonth = ref(true)

let packageRequestSeq = 0
let plansRequestSeq = 0
let hostsRequestSeq = 0
let imagesRequestSeq = 0

// 表单数据
interface InstanceForm {
  name: string
  packageId: number | null
  hostId: number | null
  image: string
  cpu: number
  memory: number
  disk: number
}

const form = ref<InstanceForm>({
  name: '',
  packageId: null,
  hostId: null,
  image: '',
  cpu: 15,
  memory: 128,
  disk: 512
})

// 当前选中的套餐
const selectedPackage = computed<Package | undefined>(() => packages.value.find(p => p.id === form.value.packageId))

// 当前选中的方案
const selectedPlan = computed<PackagePlan | undefined>(() => plans.value.find(p => p.id === selectedPlanId.value))

// 计算费用（付费实例）
const billingInfo = computed(() => {
  if (!selectedPlan.value) return null
  const plan = selectedPlan.value
  const price = plan.price / 100  // 分转元
  return {
    price,
    totalPrice: price,
    billingCycle: plan.billingCycle
  }
})

// 检查用户余额是否充足
const isBalanceSufficient = computed(() => {
  if (instanceType.value === 'free') return true
  if (!chargeFirstMonth.value) return true
  if (!billingInfo.value || !targetUser.value) return true
  return (targetUser.value.balance ?? 0) >= billingInfo.value.totalPrice
})

// 从镜像名称提取发行版标识
function getDistroFromName(name: string): string {
  const lowerName = (name || '').toLowerCase()
  const distros = ['almalinux', 'alma', 'alpine', 'arch', 'centos', 'debian', 'fedora', 'gentoo', 'kali', 'mint', 'opensuse', 'suse', 'oracle', 'redhat', 'rhel', 'rockylinux', 'rocky', 'ubuntu', 'void']
  for (const distro of distros) {
    if (lowerName.includes(distro)) return distro
  }
  return 'linux'
}

const canSubmit = computed<boolean>(() => {
  // 基本条件
  const basic = !!form.value.name &&
         form.value.packageId !== null &&
         form.value.hostId !== null &&
         !!form.value.image &&
         availableImages.value.length > 0 &&
         usernameValid.value === true &&
         targetUser.value !== null &&
         !submitting.value
  
  // 付费实例需要选择方案且余额充足
  if (instanceType.value === 'paid') {
    return basic && selectedPlanId.value !== null && !!selectedPlan.value && !selectedPlan.value.isSoldOut && isBalanceSufficient.value
  }
  
  return basic
})

// 检测资源不足
const hostsInsufficient = computed<boolean>(() => {
  return !hostsLoading.value &&
         selectedPackage.value !== undefined &&
         !!selectedPackage.value.host_ids &&
         selectedPackage.value.host_ids.length > 0 &&
         availableHosts.value.length === 0
})

onMounted(async (): Promise<void> => {
  loading.value = true
  try {
    await loadPackagesForScope(packageScope.value)
  } catch (err: any) {
    error.value = t('instance.createPage.loadFailed') + ': ' + (err?.message || String(err))
  } finally {
    loading.value = false
  }
})

// 验证用户名
async function checkUsername(): Promise<void> {
  if (!usernameInput.value.trim()) {
    usernameValid.value = null
    targetUser.value = null
    return
  }

  usernameChecking.value = true
  try {
    // 使用精确查找接口，按用户名绝对匹配
    const res = await api.admin.lookupUser(usernameInput.value.trim()) as any
    usernameValid.value = true
    targetUser.value = { 
      id: res.user.id, 
      username: res.user.username,
      balance: res.user.balance ?? 0
    }
  } catch {
    usernameValid.value = false
    targetUser.value = null
  } finally {
    usernameChecking.value = false
  }
}

function sortPackagesForCreate(items: Package[]): Package[] {
  return [...items].sort((a, b) => {
    if (a.soldOut === b.soldOut) return 0
    return a.soldOut ? 1 : -1
  })
}

function resetPackageDependentState(): void {
  plansRequestSeq += 1
  hostsRequestSeq += 1
  imagesRequestSeq += 1
  form.value.packageId = null
  form.value.hostId = null
  form.value.image = ''
  availableHosts.value = []
  availableImages.value = []
  plans.value = []
  selectedPlanId.value = null
  plansLoading.value = false
  hostsLoading.value = false
  imagesLoading.value = false
}

function clearImages(): void {
  imagesRequestSeq += 1
  availableImages.value = []
  form.value.image = ''
  imagesLoading.value = false
}

async function loadPackagesForScope(scope: PackageScope): Promise<void> {
  const requestSeq = ++packageRequestSeq
  packagesLoading.value = true
  resetPackageDependentState()
  packages.value = []

  try {
    const packagesRes = await api.packages.list({ scope })
    if (requestSeq !== packageRequestSeq) return

    const allPackages = ((packagesRes as { packages?: Package[] }).packages || []).filter(p => p.active === 1)
    packages.value = sortPackagesForCreate(allPackages)

    if (packages.value.length > 0) {
      await selectPackage(packages.value[0])
    }
  } finally {
    if (requestSeq === packageRequestSeq) {
      packagesLoading.value = false
    }
  }
}

async function switchPackageScope(scope: PackageScope): Promise<void> {
  if (scope === packageScope.value || packagesLoading.value) return

  packageScope.value = scope
  error.value = ''

  try {
    await loadPackagesForScope(scope)
  } catch (err: any) {
    packages.value = []
    error.value = t('instance.createPage.loadFailed') + ': ' + (err?.message || String(err))
  }
}

// 加载套餐方案列表
async function loadPlans(packageId: number): Promise<void> {
  const requestSeq = ++plansRequestSeq
  plansLoading.value = true
  selectedPlanId.value = null
  try {
    const res = await api.packages.getPlans(packageId) as any
    if (requestSeq !== plansRequestSeq || form.value.packageId !== packageId) return

    plans.value = ((res.plans || []) as PackagePlan[]).filter(p => p.isActive)
    // 默认选中第一个方案
    selectedPlanId.value = plans.value.find(plan => !plan.isSoldOut)?.id ?? null
  } catch {
    if (requestSeq === plansRequestSeq) {
      plans.value = []
    }
  } finally {
    if (requestSeq === plansRequestSeq) {
      plansLoading.value = false
    }
  }
}

const isSwitchingPackage = ref(false)

async function selectPackage(pkg: Package): Promise<void> {
  plansRequestSeq += 1
  hostsRequestSeq += 1
  imagesRequestSeq += 1
  isSwitchingPackage.value = true

  form.value.packageId = pkg.id
  form.value.hostId = null
  form.value.image = ''
  availableHosts.value = []
  availableImages.value = []
  
  // 重置方案选择
  plans.value = []
  selectedPlanId.value = null

  // 设置默认资源配置（套餐最大值的一半）- 仅用于免费实例
  const cpuMax = Math.max(15, pkg.cpu_max || 15)
  const cpuHalf = Math.ceil(cpuMax / 2)
  form.value.cpu = Math.max(15, Math.min(Math.floor(cpuHalf / 5) * 5, cpuMax))

  const memoryMax = Math.max(128, pkg.memory_max || 128)
  const memoryHalf = Math.ceil(memoryMax / 2)
  form.value.memory = Math.max(128, Math.min(Math.floor(memoryHalf / 64) * 64, memoryMax))

  const diskMax = Math.max(512, pkg.disk_max || 512)
  const diskHalf = Math.ceil(diskMax / 2)
  form.value.disk = Math.max(512, Math.min(Math.floor(diskHalf / 102) * 102, diskMax))

  isSwitchingPackage.value = false

  if (!pkg.host_ids || pkg.host_ids.length === 0) {
    availableHosts.value = []
    availableImages.value = []
    form.value.image = ''
    toast.warning(t('instance.createPage.packageNoHosts'))
  } else {
    loadAvailableHosts()
  }

  previousMemoryIsLow = form.value.memory <= 128
  
  // 加载方案列表（用于付费实例）
  await loadPlans(pkg.id)
}

async function loadAvailableHosts(): Promise<void> {
  const requestSeq = ++hostsRequestSeq
  const packageId = form.value.packageId
  const planId = instanceType.value === 'paid' ? selectedPlanId.value || null : null

  if (!packageId) {
    availableHosts.value = []
    form.value.hostId = null
    hostsLoading.value = false
    clearImages()
    return
  }

  if (!selectedPackage.value?.host_ids || selectedPackage.value.host_ids.length === 0) {
    availableHosts.value = []
    form.value.hostId = null
    hostsLoading.value = false
    clearImages()
    return
  }

  // 确定资源配置：付费实例用方案配置，免费实例用自定义配置
  const cpu = instanceType.value === 'paid' && selectedPlan.value ? selectedPlan.value.cpu : form.value.cpu
  const memory = instanceType.value === 'paid' && selectedPlan.value ? selectedPlan.value.memory : form.value.memory
  const disk = instanceType.value === 'paid' && selectedPlan.value ? selectedPlan.value.disk : form.value.disk

  hostsLoading.value = true
  try {
    const res = await api.instances.getAvailableHosts({
      packageId,
      planId: planId || undefined,
      cpu,
      memory,
      disk
    })
    if (
      requestSeq !== hostsRequestSeq ||
      form.value.packageId !== packageId ||
      (instanceType.value === 'paid' ? (selectedPlanId.value || null) !== planId : planId !== null)
    ) {
      return
    }

    availableHosts.value = (res as { hosts?: AvailableHost[] }).hosts || []

    if (availableHosts.value.length === 0) {
      form.value.hostId = null
      clearImages()
      return
    }

    const currentExists = availableHosts.value.some(host => host.id === form.value.hostId)
    if (!currentExists) {
      form.value.hostId = availableHosts.value[0].id
    }
  } catch {
    if (requestSeq === hostsRequestSeq) {
      availableHosts.value = []
      form.value.hostId = null
      clearImages()
    }
  } finally {
    if (requestSeq === hostsRequestSeq) {
      hostsLoading.value = false
    }
  }
}

watch(() => form.value.packageId, () => {
  if (selectedPackage.value) {
    const cpuMax = Math.max(15, selectedPackage.value.cpu_max || 15)
    const normalizedCpu = Math.max(15, Math.min(Math.floor(form.value.cpu / 5) * 5, cpuMax))
    form.value.cpu = normalizedCpu
    const memoryMax = Math.max(128, selectedPackage.value.memory_max || 128)
    const normalizedMemory = Math.max(128, Math.min(Math.floor(form.value.memory / 64) * 64, memoryMax))
    const diskMax = Math.max(512, selectedPackage.value.disk_max || 512)
    const normalizedDisk = Math.max(512, Math.min(Math.floor(form.value.disk / 102) * 102, diskMax))
    form.value.memory = normalizedMemory
    form.value.disk = normalizedDisk
  }
})

watch([() => form.value.cpu, () => form.value.memory, () => form.value.disk], () => {
  // 免费实例资源变更时重新加载宿主机
  if (form.value.packageId && !isSwitchingPackage.value && instanceType.value === 'free') {
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

  const currentMemory = instanceType.value === 'paid' && selectedPlan.value ? selectedPlan.value.memory : form.value.memory
  loadAvailableImages(
    selectedPackage.value.instance_type as 'container' | 'vm' | undefined,
    currentMemory,
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

// 实例类型或方案变更时重新加载宿主机
watch([instanceType, selectedPlanId], async () => {
  if (form.value.packageId && !isSwitchingPackage.value) {
    await loadAvailableHosts()

    if (form.value.hostId && selectedPackage.value) {
      const currentMemory = instanceType.value === 'paid' && selectedPlan.value ? selectedPlan.value.memory : form.value.memory
      await loadAvailableImages(
        selectedPackage.value.instance_type as 'container' | 'vm' | undefined,
        currentMemory,
        form.value.hostId
      )
    }
  }
})

// 付费方案变化时重新加载镜像（根据方案内存过滤）
watch(selectedPlanId, (newPlanId) => {
  if (!newPlanId || !selectedPackage.value) return
  
  const plan = plans.value.find(p => p.id === newPlanId)
  if (!plan) return
  
  const planMemory = plan.memory
  const currentIsLow = planMemory <= 128
  
  // 只有在跨越 128MB 阈值时才重新加载镜像
  if (currentIsLow !== previousMemoryIsLow) {
    previousMemoryIsLow = currentIsLow
    loadAvailableImages(
      selectedPackage.value.instance_type as 'container' | 'vm' | undefined,
      planMemory,
      form.value.hostId || undefined
    )
  }
})

async function loadAvailableImages(pkgInstanceType?: 'container' | 'vm', memory?: number, hostId?: number): Promise<void> {
  const requestSeq = ++imagesRequestSeq
  if (!hostId) {
    availableImages.value = []
    form.value.image = ''
    imagesLoading.value = false
    return
  }

  imagesLoading.value = true
  try {
    const res = await api.images.getSystemImages(pkgInstanceType, memory, hostId)
    if (requestSeq !== imagesRequestSeq || form.value.hostId !== hostId) return

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
  } catch {
    if (requestSeq === imagesRequestSeq) {
      availableImages.value = []
      form.value.image = ''
    }
  } finally {
    if (requestSeq === imagesRequestSeq) {
      imagesLoading.value = false
    }
  }
}

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) return

  error.value = ''
  submitting.value = true

  try {
    if (form.value.packageId === null) throw new Error(t('instance.createPage.selectPackage'))
    if (form.value.hostId === null) throw new Error(t('instance.selector.selectHost'))
    if (!targetUser.value) throw new Error(t('admin.instanceCreate.selectUser'))

    const nameValidation = validateInstanceName(form.value.name)
    if (!nameValidation.valid) {
      throw new Error(nameValidation.message)
    }

    // 构建请求参数
    const params: any = {
      username: targetUser.value.username,
      name: form.value.name,
      packageId: form.value.packageId,
      hostId: form.value.hostId,
      image: form.value.image
    }

    // 付费实例参数
    if (instanceType.value === 'paid' && selectedPlanId.value) {
      params.planId = selectedPlanId.value
      params.chargeFirstMonth = chargeFirstMonth.value
    } else {
      // 免费实例使用自定义资源配置
      params.cpu = form.value.cpu
      params.memory = form.value.memory
      params.disk = form.value.disk
    }

    const res = await api.admin.createInstance(params)

    toast.success(t('admin.instanceCreate.success'))

    // 显示创建结果
    const instance = (res as any).instance
    if (instance?.rootPassword) {
      toast.info(`SSH Port: ${instance.sshPort}, Password: ${instance.rootPassword}`, 10000)
    }

    // 重置表单
    usernameInput.value = ''
    usernameValid.value = null
    targetUser.value = null
    form.value.name = ''
    instanceType.value = 'free'
    chargeFirstMonth.value = true
    // 重置套餐选择，触发资源和镜像重新加载
    if (packages.value.length > 0) {
      await selectPackage(packages.value[0])
    }
  } catch (err: any) {
    error.value = translateError(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="kawaii-page max-w-3xl mx-auto space-y-6 animate-fade-in">
    <div class="page-header">
      <div class="flex items-center gap-3">
        <span class="nimbus-title-icon">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z" />
          </svg>
        </span>
        <div>
          <h1 class="page-title">{{ $t('admin.instanceCreate.title') }}</h1>
          <p class="page-description">{{ $t('admin.instanceCreate.description') }}</p>
        </div>
      </div>
    </div>

    <div v-if="loading" class="card p-8 text-center text-themed-muted">
      <svg class="w-8 h-8 mx-auto mb-2 animate-spin icon-themed-muted" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      {{ $t('common.loading') }}
    </div>

    <form v-else class="space-y-6" @submit.prevent="handleSubmit">
      <!-- 目标用户 -->
      <section class="card p-6">
        <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
          <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
          <h2 class="text-base font-semibold text-themed">{{ $t('admin.instanceCreate.targetUser') }}</h2>
        </div>
        <div class="relative">
          <input
            v-model="usernameInput"
            type="text"
            class="input w-full pr-10"
            :placeholder="$t('admin.instanceCreate.usernamePlaceholder')"
            @blur="checkUsername"
            @keyup.enter="checkUsername"
          />
          <div v-if="usernameChecking" class="absolute right-3 top-1/2 -translate-y-1/2">
            <svg class="w-5 h-5 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
          <div v-else-if="usernameValid === true" class="absolute right-3 top-1/2 -translate-y-1/2">
            <svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div v-else-if="usernameValid === false" class="absolute right-3 top-1/2 -translate-y-1/2">
            <svg class="w-5 h-5 text-rose-600 dark:text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        </div>
        <p v-if="usernameValid === true && targetUser" class="text-xs text-green-500 mt-2">
          {{ $t('admin.instanceCreate.userFound', { id: targetUser.id }) }}
        </p>
        <p v-else-if="usernameValid === false" class="text-xs text-rose-600 dark:text-rose-400 mt-2">
          {{ $t('admin.instanceCreate.userNotFound') }}
        </p>
        <p class="text-xs text-themed-muted mt-2">
          {{ $t('admin.instanceCreate.userHint') }}
        </p>
      </section>

      <!-- 套餐选择 -->
      <PackageSelector
        :packages="packages"
        :selected-package-id="form.packageId"
        :loading="packagesLoading"
        @select="selectPackage"
      >
        <template #header-actions>
          <div class="inline-flex rounded-lg p-1" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
            <button
              type="button"
              class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              :class="packageScope === 'official'
                ? (themeStore.isDark ? 'bg-gray-700 text-white' : 'bg-white text-gray-900 shadow-sm')
                : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')"
              :disabled="packagesLoading"
              @click="switchPackageScope('official')"
            >
              {{ $t('admin.instanceCreate.packageScope.official') }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              :class="packageScope === 'hosted'
                ? (themeStore.isDark ? 'bg-gray-700 text-white' : 'bg-white text-gray-900 shadow-sm')
                : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')"
              :disabled="packagesLoading"
              @click="switchPackageScope('hosted')"
            >
              {{ $t('admin.instanceCreate.packageScope.hosted') }}
            </button>
          </div>
        </template>
      </PackageSelector>

      <!-- 实例类型选择 -->
      <section class="card p-6">
        <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
          <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
          </svg>
          <h2 class="text-base font-semibold text-themed">{{ $t('admin.instanceCreate.instanceType') }}</h2>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="nimbus-radio-card">
            <input v-model="instanceType" type="radio" value="free" class="w-4 h-4 accent-accent" />
            <span class="text-themed">{{ $t('admin.instanceCreate.freeInstance') }}</span>
          </label>
          <label class="nimbus-radio-card" :class="{ 'opacity-50': plans.length === 0 }">
            <input v-model="instanceType" type="radio" value="paid" class="w-4 h-4 accent-accent" :disabled="plans.length === 0" />
            <span class="text-themed">{{ $t('admin.instanceCreate.paidInstance') }}</span>
          </label>
        </div>
        <p v-if="plans.length === 0" class="text-xs text-themed-muted mt-2">
          {{ $t('admin.instanceCreate.noPlanHint') }}
        </p>
      </section>

      <!-- 付费方案选择（仅付费实例） -->
      <section v-if="instanceType === 'paid' && plans.length > 0" class="card p-6">
        <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
          <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 18.75 4.5H5.25A2.25 2.25 0 0 0 3 6.75v10.5A2.25 2.25 0 0 0 5.25 19.5Z" />
          </svg>
          <h2 class="text-base font-semibold text-themed">{{ $t('admin.instanceCreate.selectPlan') }}</h2>
        </div>
        
        <div v-if="plansLoading" class="text-center py-4 text-themed-muted">
          {{ $t('common.loading') }}
        </div>
        
        <div v-else class="space-y-3">
          <!-- 方案列表 -->
          <div
            v-for="plan in plans"
            :key="plan.id"
            class="nimbus-option p-4 rounded-lg border cursor-pointer transition-all"
            :class="[
              plan.isSoldOut ? 'cursor-not-allowed opacity-60' : '',
              selectedPlanId === plan.id && !plan.isSoldOut
                ? 'border-accent bg-themed-secondary'
                : plan.isSoldOut
                  ? (themeStore.isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-gray-50')
                  : 'border-themed hover:border-accent'
            ]"
            @click="!plan.isSoldOut && (selectedPlanId = plan.id)"
          >
            <div class="flex justify-between items-start">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-medium text-themed">{{ plan.name }}</span>
                  <span
                    v-if="plan.isSoldOut"
                    class="text-xs px-2 py-0.5 rounded-full"
                    :class="themeStore.isDark ? 'bg-rose-500/15 text-rose-300' : 'bg-rose-50 text-rose-700'"
                  >
                    {{ $t('instance.selector.planSoldOut') }}
                  </span>
                </div>
                <div class="nimbus-num text-sm text-themed-muted mt-1">
                  CPU {{ plan.cpu }}% | {{ plan.memory >= 1024 ? `${(plan.memory / 1024).toFixed(1)} GB` : `${plan.memory} MB` }} | {{ plan.disk >= 1024 ? `${(plan.disk / 1024).toFixed(0)} GB` : `${plan.disk} MB` }}
                </div>
              </div>
              <div class="text-right">
                <div class="nimbus-num font-semibold text-themed">¥{{ (plan.price / 100).toFixed(2) }}/{{ plan.billingCycle }}月</div>
              </div>
            </div>
          </div>
          
          <!-- 扣除首月费用选项 -->
          <div class="mt-4 pt-4 border-t border-themed">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="chargeFirstMonth" type="checkbox" class="w-4 h-4 accent-accent" />
              <span class="text-sm text-themed">{{ $t('admin.instanceCreate.chargeFirstMonth') }}</span>
            </label>
            <p class="text-xs text-themed-muted mt-2 ml-6">
              {{ chargeFirstMonth ? $t('admin.instanceCreate.chargeFirstMonthHint') : $t('admin.instanceCreate.noChargeFirstMonthHint') }}
            </p>
          </div>
          
          <!-- 费用摘要 -->
          <div v-if="billingInfo && targetUser" class="mt-4 p-4 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
            <div class="nimbus-num space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-themed-muted">{{ $t('admin.instanceCreate.planPrice') }}</span>
                <span class="text-themed">¥{{ billingInfo.price.toFixed(2) }}</span>
              </div>
              <div class="flex justify-between font-medium pt-2 border-t border-themed">
                <span class="text-themed">{{ chargeFirstMonth ? $t('admin.instanceCreate.totalCharge') : $t('admin.instanceCreate.freeFirstMonth') }}</span>
                <span :class="chargeFirstMonth ? 'text-themed' : 'text-green-500'">
                  {{ chargeFirstMonth ? `¥${billingInfo.totalPrice.toFixed(2)}` : '¥0.00' }}
                </span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-themed-muted">{{ $t('admin.instanceCreate.userBalance') }}</span>
                <span :class="isBalanceSufficient ? 'text-green-500' : 'text-rose-600 dark:text-rose-400'">
                  ¥{{ (targetUser.balance ?? 0).toFixed(2) }}
                  <span v-if="!isBalanceSufficient">(余额不足)</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 资源配置（仅免费实例） -->
      <ResourceSliders
        v-if="instanceType === 'free'"
        :selected-package="selectedPackage || null"
        :user-quota="null"
        :cpu="form.cpu"
        :memory="form.memory"
        :disk="form.disk"
        @update:cpu="form.cpu = $event"
        @update:memory="form.memory = $event"
        @update:disk="form.disk = $event"
      />

      <!-- 宿主机选择 -->
      <HostSelector
        :available-hosts="availableHosts"
        :selected-host-id="form.hostId"
        :hosts-loading="hostsLoading"
        :hosts-insufficient="hostsInsufficient"
        :cpu="instanceType === 'paid' && selectedPlan ? selectedPlan.cpu : form.cpu"
        :memory="instanceType === 'paid' && selectedPlan ? selectedPlan.memory : form.memory"
        :selected-package="selectedPackage || null"
        @update:selected-host-id="form.hostId = $event"
      />

      <!-- 镜像选择 -->
      <ImageSelector
        :available-images="availableImages"
        :selected-image="form.image"
        :images-loading="imagesLoading"
        @update:selected-image="form.image = $event"
      />

      <!-- 实例名称和提交 -->
      <section class="card p-6">
        <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
          <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 6h.008v.008H6V6Z" />
          </svg>
          <h2 class="text-base font-semibold text-themed">{{ $t('instance.createPage.instanceName') }}</h2>
        </div>
        <div class="space-y-4">
          <label class="block space-y-1.5">
            <span class="nimbus-field-label">{{ $t('instance.createPage.instanceName') }}</span>
            <input v-model="form.name" type="text" class="input" :placeholder="$t('instance.createPage.instanceNamePlaceholder')" required />
          </label>

          <div v-if="error" class="p-3 rounded-lg border text-sm" :class="themeStore.isDark ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-700'">
            {{ error }}
          </div>

          <button type="submit" :disabled="!canSubmit" class="btn btn-primary w-full">
            {{ submitting ? $t('instance.createPage.creating') : $t('admin.instanceCreate.submit') }}
          </button>
        </div>
      </section>
    </form>
  </div>
</template>

<style scoped>
/* Nimbus admin kit */
.nimbus-num {
  font-variant-numeric: tabular-nums;
}

.nimbus-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kawaii-primary) 28%, transparent);
}

.nimbus-field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--kawaii-muted);
}

.nimbus-radio-card {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  border-radius: 0.75rem;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface);
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

.nimbus-radio-card:hover {
  border-color: color-mix(in srgb, var(--kawaii-primary) 45%, var(--kawaii-line));
}

.nimbus-radio-card:has(input:checked) {
  border-color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 6%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--kawaii-primary) 45%, transparent);
}

.nimbus-option {
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

.nimbus-option.border-accent {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--kawaii-primary) 45%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-radio-card,
  .nimbus-option {
    transition: none;
  }
}
</style>
