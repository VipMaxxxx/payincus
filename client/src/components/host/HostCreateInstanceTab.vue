<script setup lang="ts">
/**
 * HostCreateInstanceTab
 * - self mode: existing host-owner free instance flow
 * - gift mode: host owner creates free instance or paid instance with free gifted days for another user
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import PackageSelector from '@/components/instance/PackageSelector.vue'
import ResourceSliders from '@/components/instance/ResourceSliders.vue'
import ImageSelector from '@/components/instance/ImageSelector.vue'
import SSHKeySelector from '@/components/instance/SSHKeySelector.vue'
import InitCommandSelector from '@/components/extensions/InitCommandSelector.vue'
import type { Package, SshKey, UserQuota } from '@/types/api'
import { validateName as validateInstanceName } from '@/utils/validation'
import { translateError } from '@/utils/errorHandler'

interface Props {
  hostId: number
  hostName: string
  instanceType?: 'container' | 'vm' | 'both'
}

interface ImageOption {
  value: string
  label: string
  icon: string | null
}

interface GiftPlan {
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

type CreateMode = 'self' | 'gift'
type GiftInstanceType = 'free' | 'paid'
type TargetLookupState = 'idle' | 'checking' | 'found' | 'not_found' | 'inactive' | 'no_ssh' | 'self'

const props = defineProps<Props>()

const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const toast = useToast()
const themeStore = useThemeStore()
const loadedUserId = ref<number | null>(null)
const loadedUserRole = ref<string | null>(null)
const currentUserId = computed(() => loadedUserId.value ?? authStore.user?.id ?? null)
const isAdmin = computed(() => (loadedUserRole.value ?? authStore.user?.role) === 'admin')

const packages = ref<Package[]>([])
const sshKeys = ref<SshKey[]>([])
const userQuota = ref<UserQuota | null>(null)
const availableImages = ref<ImageOption[]>([])
const plans = ref<GiftPlan[]>([])

const loading = ref(true)
const imagesLoading = ref(false)
const plansLoading = ref(false)
const submitting = ref(false)

const createMode = ref<CreateMode>(isAdmin.value ? 'gift' : 'self')
const giftInstanceType = ref<GiftInstanceType>('free')
const giftDays = ref(30)

const targetUsername = ref('')
const targetLookupState = ref<TargetLookupState>('idle')
const targetUser = ref<{ id: number; username: string } | null>(null)

const form = ref({
  name: '',
  packageId: null as number | null,
  image: '',
  cpu: 15,
  memory: 128,
  disk: 512,
  sshKeyId: null as number | null,
  customInitCommandIds: [] as number[]
})

const selectedPackage = computed<Package | undefined>(() =>
  packages.value.find(pkg => pkg.id === form.value.packageId)
)

const selectedPlan = computed<GiftPlan | undefined>(() =>
  plans.value.find(plan => plan.id === selectedPlanId.value)
)

const selectedPlanId = ref<number | null>(null)

const isGiftMode = computed(() => createMode.value === 'gift')
const showFreeResources = computed(() => !isGiftMode.value || giftInstanceType.value === 'free')
const isGiftPaid = computed(() => isGiftMode.value && giftInstanceType.value === 'paid')
const normalizedGiftDays = computed(() => {
  if (!Number.isFinite(giftDays.value)) return 30
  return Math.max(1, Math.min(365, Math.floor(giftDays.value)))
})
const isGiftDaysValid = computed(() => {
  if (!isGiftPaid.value) return true
  return Number.isFinite(giftDays.value) && giftDays.value >= 1 && giftDays.value <= 365
})

const billingInfo = computed(() => {
  if (!selectedPlan.value) return null
  const price = selectedPlan.value.price / 100
  return {
    price,
    totalPrice: price,
    billingCycle: selectedPlan.value.billingCycle
  }
})

const currentMemoryForImages = computed(() => {
  if (isGiftPaid.value && selectedPlan.value) {
    return selectedPlan.value.memory
  }
  return form.value.memory
})

const currentDistro = computed(() => {
  const image = availableImages.value.find(item => item.value === form.value.image)
  return image?.icon || 'debian'
})

const canSubmitSelf = computed(() => {
  return (
    form.value.name.trim().length >= 2 &&
    form.value.packageId !== null &&
    !!form.value.image &&
    form.value.sshKeyId !== null
  )
})

const canSubmitGift = computed(() => {
  const hasTarget = targetLookupState.value === 'found' && targetUser.value !== null
  const hasPlan = !isGiftPaid.value || (selectedPlanId.value !== null && !!selectedPlan.value && !selectedPlan.value.isSoldOut)
  return (
    form.value.name.trim().length >= 2 &&
    form.value.packageId !== null &&
    !!form.value.image &&
    hasTarget &&
    hasPlan &&
    isGiftDaysValid.value
  )
})

const canSubmit = computed(() => createMode.value === 'self' ? canSubmitSelf.value : canSubmitGift.value)

function getDistroFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('ubuntu')) return 'ubuntu'
  if (lower.includes('debian')) return 'debian'
  if (lower.includes('alpine')) return 'alpine'
  if (lower.includes('centos')) return 'centos'
  if (lower.includes('fedora')) return 'fedora'
  if (lower.includes('archlinux') || lower.includes('arch')) return 'archlinux'
  if (lower.includes('opensuse') || lower.includes('suse')) return 'opensuse'
  if (lower.includes('rocky')) return 'rocky'
  if (lower.includes('alma')) return 'alma'
  if (lower.includes('oracle')) return 'oracle'
  if (lower.includes('gentoo')) return 'gentoo'
  if (lower.includes('nixos')) return 'nixos'
  return 'debian'
}

async function loadPlans(packageId: number): Promise<void> {
  plansLoading.value = true
  selectedPlanId.value = null
  try {
    const res = await api.packages.getPlans(packageId)
    plans.value = (res.plans || []).filter(plan => plan.isActive)
    selectedPlanId.value = plans.value.find(plan => !plan.isSoldOut)?.id ?? null
  } catch {
    plans.value = []
  } finally {
    plansLoading.value = false
  }
}

async function loadAvailableImages(memory?: number): Promise<void> {
  if (!selectedPackage.value) {
    availableImages.value = []
    form.value.image = ''
    return
  }

  imagesLoading.value = true
  try {
    const res = await api.images.getSystemImages(
      selectedPackage.value.instance_type as 'container' | 'vm' | undefined,
      memory,
      props.hostId
    )

    availableImages.value = (res.images || []).map(img => ({
      value: img.remoteAlias,
      label: img.name,
      icon: img.icon || getDistroFromName(img.name)
    }))

    if (availableImages.value.length === 0) {
      form.value.image = ''
      return
    }

    const exists = availableImages.value.some(item => item.value === form.value.image)
    if (!exists) {
      form.value.image = availableImages.value[0].value
    }
  } catch {
    availableImages.value = []
    form.value.image = ''
  } finally {
    imagesLoading.value = false
  }
}

function resetResourceDefaults(pkg: Package): void {
  const cpuMax = Math.max(15, pkg.cpu_max)
  const cpuHalf = Math.ceil(cpuMax / 2)
  form.value.cpu = Math.max(15, Math.min(Math.floor(cpuHalf / 5) * 5, cpuMax))

  const memoryMax = Math.max(128, pkg.memory_max)
  const memoryHalf = Math.ceil(memoryMax / 2)
  form.value.memory = Math.max(128, Math.min(Math.floor(memoryHalf / 64) * 64, memoryMax))

  const diskMax = Math.max(512, pkg.disk_max)
  const diskHalf = Math.ceil(diskMax / 2)
  form.value.disk = Math.max(512, Math.min(Math.floor(diskHalf / 102) * 102, diskMax))
}

async function handlePackageSelect(pkg: Package): Promise<void> {
  form.value.packageId = pkg.id
  form.value.image = ''
  selectedPlanId.value = null
  plans.value = []
  resetResourceDefaults(pkg)
  await loadPlans(pkg.id)
  await loadAvailableImages(currentMemoryForImages.value)
}

async function loadData(): Promise<void> {
  loading.value = true
  try {
    const meRes = await api.auth.me()
    const currentUser = (meRes as { user?: { id?: number; role?: string; quota?: UserQuota } }).user
    loadedUserId.value = currentUser?.id ?? null
    loadedUserRole.value = currentUser?.role ?? null
    const currentIsAdmin = currentUser?.role === 'admin'
    const [packagesRes, keysRes] = await Promise.all([
      api.packages.list(),
      currentIsAdmin ? Promise.resolve({ keys: [] }) : api.sshKeys.list()
    ])

    packages.value = (packagesRes.packages || []).filter((pkg: Package) => {
      const isUsablePackage = currentIsAdmin || pkg.isOwn === true
      return isUsablePackage && pkg.host_ids?.includes(props.hostId)
    })

    sshKeys.value = keysRes.keys || []
    userQuota.value = currentUser?.quota || null

    if (packages.value.length > 0) {
      if (currentIsAdmin) {
        createMode.value = 'gift'
      }
      await handlePackageSelect(packages.value[0])
    }
  } catch (err: any) {
    toast.error(t('common.loadFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function checkTargetUser(): Promise<void> {
  const username = targetUsername.value.trim()
  if (!username) {
    targetLookupState.value = 'idle'
    targetUser.value = null
    return
  }

  targetLookupState.value = 'checking'
  try {
    const res = await api.hosts.lookupGiftTargetUser(props.hostId, username)
    if (res.user.id === currentUserId.value && !isAdmin.value) {
      targetLookupState.value = 'self'
      targetUser.value = null
      return
    }

    if (res.user.status !== 'active') {
      targetLookupState.value = 'inactive'
      targetUser.value = null
      return
    }

    if (!res.user.hasSshKey) {
      targetLookupState.value = 'no_ssh'
      targetUser.value = null
      return
    }

    targetLookupState.value = 'found'
    targetUser.value = {
      id: res.user.id,
      username: res.user.username
    }
  } catch {
    targetLookupState.value = 'not_found'
    targetUser.value = null
  }
}

const targetLookupMessage = computed(() => {
  switch (targetLookupState.value) {
    case 'found':
      return t('admin.instanceCreate.userFound', { id: targetUser.value?.id })
    case 'not_found':
      return t('admin.instanceCreate.userNotFound')
    case 'inactive':
      return t('host.createInstance.userInactive')
    case 'no_ssh':
      return t('admin.instanceCreate.noSshKey')
    case 'self':
      return t('host.createInstance.cannotGiftToSelf')
    default:
      return ''
  }
})

const targetLookupClass = computed(() => {
  return targetLookupState.value === 'found' ? 'text-green-500' : 'text-red-500'
})

watch(() => form.value.memory, (newMemory, oldMemory) => {
  if (!showFreeResources.value || !selectedPackage.value || newMemory === oldMemory) return
  const wasLow = (oldMemory ?? 128) <= 128
  const isLow = newMemory <= 128
  if (wasLow !== isLow) {
    void loadAvailableImages(newMemory)
  }
})

watch([createMode, giftInstanceType, selectedPlanId], () => {
  if (!selectedPackage.value) return

  if (isAdmin.value && createMode.value === 'self') {
    createMode.value = 'gift'
    return
  }

  if (createMode.value === 'self') {
    targetUsername.value = ''
    targetLookupState.value = 'idle'
    targetUser.value = null
    giftInstanceType.value = 'free'
    giftDays.value = 30
  }

  void loadAvailableImages(currentMemoryForImages.value)
})

onMounted(async () => {
  await loadData()
})

async function handleSelfSubmit(): Promise<void> {
  if (!canSubmitSelf.value) return

  const nameValidation = validateInstanceName(form.value.name, t('instance.name'), 2, 64)
  if (!nameValidation.valid) {
    toast.error(nameValidation.message || t('common.error'))
    return
  }

  if (form.value.packageId === null) {
    toast.error(t('instance.createPage.selectPackage'))
    return
  }

  if (form.value.sshKeyId === null) {
    toast.error(t('instance.createPage.selectSshKey'))
    return
  }

  const result = await api.instances.create({
    name: form.value.name.trim(),
    packageId: form.value.packageId,
    hostId: props.hostId,
    image: form.value.image,
    cpu: form.value.cpu,
    memory: form.value.memory,
    disk: form.value.disk,
    sshKeyId: form.value.sshKeyId,
    customInitCommandIds: form.value.customInitCommandIds
  })

  toast.success(t('host.createInstance.success'))

  if (result?.id) {
    router.push(`/instances/${result.id}`)
  }
}

async function handleGiftSubmit(): Promise<void> {
  if (!canSubmitGift.value || !targetUser.value || form.value.packageId === null) return

  const nameValidation = validateInstanceName(form.value.name, t('instance.name'), 2, 64)
  if (!nameValidation.valid) {
    toast.error(nameValidation.message || t('common.error'))
    return
  }

  const payload: {
    username: string
    name: string
    packageId: number
    image: string
    cpu?: number
    memory?: number
    disk?: number
    planId?: number
    giftDays?: number
  } = {
    username: targetUser.value.username,
    name: form.value.name.trim(),
    packageId: form.value.packageId,
    image: form.value.image
  }

  if (isGiftPaid.value && selectedPlanId.value) {
    payload.planId = selectedPlanId.value
    payload.giftDays = normalizedGiftDays.value
  } else {
    payload.cpu = form.value.cpu
    payload.memory = form.value.memory
    payload.disk = form.value.disk
  }

  await api.hosts.createInstanceForUser(props.hostId, payload)

  toast.success(t('host.createInstance.giftSuccess', { username: targetUser.value.username }))

  targetUsername.value = ''
  targetLookupState.value = 'idle'
  targetUser.value = null
  giftInstanceType.value = 'free'
  giftDays.value = 30
  form.value.name = ''
}

async function handleSubmit(): Promise<void> {
  if (submitting.value || !canSubmit.value) return

  submitting.value = true
  try {
    if (createMode.value === 'self') {
      await handleSelfSubmit()
    } else {
      await handleGiftSubmit()
    }
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <div class="card p-6">
      <div v-if="loading" class="flex items-center justify-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2" :class="themeStore.isDark ? 'border-white' : 'border-gray-900'"></div>
      </div>

      <div v-else-if="packages.length === 0" class="text-center py-12">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
          <svg class="w-8 h-8" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <h3 class="text-lg font-medium text-themed mb-2">{{ t('host.createInstance.noPackages') }}</h3>
        <p class="text-sm text-themed-muted">{{ t('host.createInstance.noPackagesHint') }}</p>
      </div>

      <form v-else class="space-y-6" @submit.prevent="handleSubmit">
        <div class="space-y-2">
          <h3 class="text-sm font-medium text-themed">{{ t('host.createInstance.title') }}</h3>
          <div class="flex flex-wrap gap-4">
            <label v-if="!isAdmin" class="flex items-center gap-2 cursor-pointer">
              <input v-model="createMode" type="radio" value="self" class="w-4 h-4 accent-blue-500" />
              <span class="text-themed">{{ t('host.createInstance.selfMode') }}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="createMode" type="radio" value="gift" class="w-4 h-4 accent-blue-500" />
              <span class="text-themed">{{ t('host.createInstance.giftMode') }}</span>
            </label>
          </div>
          <p class="text-xs text-themed-muted">
            {{ createMode === 'self' ? t('host.createInstance.selfModeHint') : t(isAdmin ? 'host.createInstance.adminModeHint' : 'host.createInstance.giftModeHint') }}
          </p>
        </div>

        <div v-if="isGiftMode" class="space-y-3">
          <h3 class="text-sm font-medium text-themed">{{ t('admin.instanceCreate.targetUser') }}</h3>
          <div class="flex gap-2">
            <input
              v-model="targetUsername"
              type="text"
              class="input flex-1"
              :placeholder="t('admin.instanceCreate.usernamePlaceholder')"
              @blur="checkTargetUser"
              @keyup.enter.prevent="checkTargetUser"
            />
            <button type="button" class="btn-secondary" :disabled="targetLookupState === 'checking'" @click="checkTargetUser">
              {{ targetLookupState === 'checking' ? t('admin.instanceCreate.checking') : t('admin.instanceCreate.checkUser') }}
            </button>
          </div>
          <p v-if="targetLookupState !== 'idle' && targetLookupState !== 'checking'" class="text-xs" :class="targetLookupClass">
            {{ targetLookupMessage }}
          </p>
          <p class="text-xs text-themed-muted">{{ t('admin.instanceCreate.userHint') }}</p>
        </div>

        <PackageSelector
          :packages="packages"
          :selected-package-id="form.packageId"
          @select="handlePackageSelect"
        />

        <div v-if="isGiftMode" class="space-y-4">
          <div class="space-y-2">
            <h3 class="text-sm font-medium text-themed">{{ t('admin.instanceCreate.instanceType') }}</h3>
            <div class="flex gap-4">
              <label class="flex items-center gap-2 cursor-pointer">
                <input v-model="giftInstanceType" type="radio" value="free" class="w-4 h-4 accent-blue-500" />
                <span class="text-themed">{{ t('admin.instanceCreate.freeInstance') }}</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer" :class="{ 'opacity-50': plans.length === 0 }">
                <input v-model="giftInstanceType" type="radio" value="paid" class="w-4 h-4 accent-blue-500" :disabled="plans.length === 0" />
                <span class="text-themed">{{ t('admin.instanceCreate.paidInstance') }}</span>
              </label>
            </div>
            <p v-if="plans.length === 0" class="text-xs text-themed-muted">{{ t('admin.instanceCreate.noPlanHint') }}</p>
          </div>

          <div v-if="isGiftPaid && plans.length > 0" class="space-y-3">
            <h3 class="text-sm font-medium text-themed">{{ t('admin.instanceCreate.selectPlan') }}</h3>
            <div v-if="plansLoading" class="text-sm text-themed-muted">{{ t('common.loading') }}</div>
            <div v-else class="space-y-3">
              <div
                v-for="plan in plans"
                :key="plan.id"
                class="p-4 rounded-lg border cursor-pointer transition-all"
                :class="[
                  plan.isSoldOut ? 'cursor-not-allowed opacity-60' : '',
                  selectedPlanId === plan.id && !plan.isSoldOut
                    ? 'border-blue-500 bg-blue-500/10'
                    : plan.isSoldOut
                      ? (themeStore.isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-gray-50')
                      : 'border-themed hover:border-blue-300'
                ]"
                @click="!plan.isSoldOut && (selectedPlanId = plan.id)"
              >
                <div class="flex justify-between items-start gap-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-themed">{{ plan.name }}</span>
                      <span
                        v-if="plan.isSoldOut"
                        class="text-xs px-2 py-0.5 rounded-full"
                        :class="themeStore.isDark ? 'bg-red-500/15 text-red-300' : 'bg-red-50 text-red-700'"
                      >
                        {{ t('instance.selector.planSoldOut') }}
                      </span>
                    </div>
                    <div class="text-sm text-themed-muted mt-1">
                      CPU {{ plan.cpu }}% |
                      {{ plan.memory >= 1024 ? `${(plan.memory / 1024).toFixed(1)} GB` : `${plan.memory} MB` }} |
                      {{ plan.disk >= 1024 ? `${(plan.disk / 1024).toFixed(0)} GB` : `${plan.disk} MB` }}
                    </div>
                  </div>
                  <div class="font-semibold text-blue-500">¥{{ (plan.price / 100).toFixed(2) }}/{{ plan.billingCycle }}m</div>
                </div>
              </div>

              <div class="space-y-2">
                <label class="block text-sm font-medium text-themed">{{ t('host.createInstance.giftDaysLabel') }}</label>
                <input
                  v-model.number="giftDays"
                  type="number"
                  min="1"
                  max="365"
                  class="input max-w-xs"
                />
                <p class="text-xs text-themed-muted">{{ t('host.createInstance.giftDaysHint') }}</p>
                <p class="text-xs text-themed-muted">{{ t('host.createInstance.giftDaysRange') }}</p>
              </div>

              <div v-if="billingInfo" class="p-4 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between">
                    <span class="text-themed-muted">{{ t('admin.instanceCreate.planPrice') }}</span>
                    <span class="text-themed">¥{{ billingInfo.price.toFixed(2) }}/{{ billingInfo.billingCycle }}m</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-themed-muted">{{ t('host.createInstance.giftDuration') }}</span>
                    <span class="text-green-500">{{ t('host.createInstance.giftDurationValue', { days: normalizedGiftDays }) }}</span>
                  </div>
                  <div class="flex justify-between font-medium pt-2 border-t border-themed">
                    <span class="text-themed">{{ t('admin.instanceCreate.totalCharge') }}</span>
                    <span class="text-green-500">¥0.00</span>
                  </div>
                </div>
                <p class="mt-2 text-xs text-themed-muted">{{ t('host.createInstance.giftOnlyFreeHint') }}</p>
              </div>
            </div>
          </div>
        </div>

        <ResourceSliders
          v-if="selectedPackage && showFreeResources"
          :selected-package="selectedPackage"
          :user-quota="createMode === 'self' ? userQuota : null"
          :cpu="form.cpu"
          :memory="form.memory"
          :disk="form.disk"
          @update:cpu="form.cpu = $event"
          @update:memory="form.memory = $event"
          @update:disk="form.disk = $event"
        />

        <ImageSelector
          v-if="selectedPackage"
          :available-images="availableImages"
          :selected-image="form.image"
          :images-loading="imagesLoading"
          @update:selected-image="form.image = $event"
        />

        <SSHKeySelector
          v-if="createMode === 'self' && selectedPackage"
          :ssh-keys="sshKeys"
          :selected-key-id="form.sshKeyId"
          @update:selected-key-id="form.sshKeyId = $event"
        />

        <div v-if="createMode === 'self' && selectedPackage && form.image" class="space-y-3">
          <InitCommandSelector
            v-model="form.customInitCommandIds"
            :distro="currentDistro"
          />
        </div>

        <div v-if="selectedPackage" class="space-y-3">
          <h3 class="text-sm font-medium text-themed">{{ t('host.createInstance.instanceName') }}</h3>
          <input
            v-model="form.name"
            type="text"
            class="input"
            :placeholder="t('instance.createPage.instanceNamePlaceholder')"
            maxlength="64"
            required
          />
        </div>

        <div v-if="selectedPackage" class="flex justify-end pt-4 border-t border-themed">
          <button type="submit" class="btn-primary flex items-center gap-2" :disabled="submitting || !canSubmit">
            <svg v-if="submitting" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            {{
              submitting
                ? t('host.createInstance.creating')
                : createMode === 'self'
                  ? t('instance.create')
                  : t('admin.instanceCreate.submit')
            }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
