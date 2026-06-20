<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { onClickOutside } from '@vueuse/core'
import { availableFlagCountryCodes, getLocalizedCountryName } from '@/utils/countryDisplay'
import { buildHostApiUrl, extractHostAddressFromUrl, validateIdentifier, validateName, validateHostAddress, validateIpAddress } from '@/utils/validation'
import api from '@/api'
import { useToast } from '@/stores/toast'
import FlagIcon from '@/components/FlagIcon.vue'

const { t, locale } = useI18n()
const themeStore = useThemeStore()
const authStore = useAuthStore()
const toast = useToast()

const isAdmin = computed(() => authStore.user?.role === 'admin')

// 节点名称前缀，仅普通用户需要
const hostNamePrefix = computed(() => `PEER${authStore.user?.id}-`)

interface Host {
  id: number
  name: string
  url: string
  location?: string
  countryCode: string
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  ipv6ParentInterface?: string
  ipv6Subnet?: string
  transferEnabled?: boolean
  trafficResetDay?: number
  notifyPurchase?: boolean
  notifyRenew?: boolean
  notifyDestroy?: boolean
  enableResourcePool?: boolean
  announcement?: string | null
  probeUrl?: string | null
  natConfig?: {
    publicIp: string | null
    publicIpv6?: string | null
    bindIp?: string | null
    bindIpv6?: string | null
    portRangeStart: number | null
    portRangeEnd: number | null
  }
}

interface Props {
  host: Host
}

interface Emits {
  (e: 'saved'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const saving = ref(false)

const form = ref({
  name: '',
  nameSuffix: '',
  hostAddress: '',
  apiPort: 8443,
  location: '',
  countryCode: 'us',
  cpuAllowanceMax: 0,
  memoryMax: 0,
  instanceType: 'container' as 'container' | 'vm' | 'both',
  ipv6ParentInterface: '',
  ipv6Subnet: '',
  transferEnabled: true,
  trafficResetDay: 1,
  notifyPurchase: true,
  notifyRenew: true,
  notifyDestroy: false,
  enableResourcePool: true,
  announcement: '',
  probeUrl: '',
  natConfig: {
    publicIp: '',
    publicIpv6: '',
    bindIp: '',
    bindIpv6: '',
    portRangeStart: null as number | null,
    portRangeEnd: null as number | null
  }
})

const showCountryDropdown = ref(false)
const countrySearch = ref('')
const countryDropdownRef = ref<HTMLElement | null>(null)
onClickOutside(countryDropdownRef, () => closeCountryDropdown())

const countries = computed(() => {
  return availableFlagCountryCodes
    .map(code => ({
      code,
      name: getLocalizedCountryName(code, locale.value, (key, fallback) => t(key, fallback))
    }))
    .sort((left, right) => left.name.localeCompare(right.name, locale.value))
})

const selectedCountry = computed(() => {
  return countries.value.find(country => country.code === form.value.countryCode) || {
    code: form.value.countryCode,
    name: getLocalizedCountryName(form.value.countryCode, locale.value, (key, fallback) => t(key, fallback))
  }
})

const filteredCountries = computed(() => {
  const keyword = countrySearch.value.trim().toLowerCase()
  if (!keyword) return countries.value

  return countries.value.filter(country =>
    country.name.toLowerCase().includes(keyword) ||
    country.code.toLowerCase().includes(keyword)
  )
})

function toggleCountryDropdown() {
  showCountryDropdown.value = !showCountryDropdown.value
  if (!showCountryDropdown.value) {
    countrySearch.value = ''
  }
}

function closeCountryDropdown() {
  showCountryDropdown.value = false
  countrySearch.value = ''
}

function selectCountry(code: string) {
  form.value.countryCode = code
  closeCountryDropdown()
}

const requiresIpv6ParentInterface = computed(() => {
  return Boolean(form.value.ipv6Subnet.trim() || props.host.ipv6Subnet?.trim())
})

// 从 URL 提取端口
function extractPortFromUrl(url: string): number {
  try {
    const port = new URL(url).port
    return port ? parseInt(port, 10) : 8443
  } catch {
    return 8443
  }
}

watch(() => props.host, (newHost) => {
  if (newHost) {
    const hostName = newHost.name || ''
    // 从节点名称中提取后缀
    let nameSuffix = ''
    if (!isAdmin.value && hostName.startsWith(hostNamePrefix.value)) {
      nameSuffix = hostName.slice(hostNamePrefix.value.length)
    }
    
    form.value = {
      name: hostName,
      nameSuffix: nameSuffix,
      hostAddress: extractHostAddressFromUrl(newHost.url || ''),
      apiPort: extractPortFromUrl(newHost.url || ''),
      location: newHost.location || '',
      countryCode: newHost.countryCode || 'us',
      cpuAllowanceMax: newHost.cpuAllowanceMax || 0,
      memoryMax: newHost.memoryMax || 0,
      instanceType: newHost.instanceType || 'container',
      ipv6ParentInterface: newHost.ipv6ParentInterface || '',
      ipv6Subnet: newHost.ipv6Subnet || '',
      transferEnabled: newHost.transferEnabled !== undefined ? newHost.transferEnabled : true,
      trafficResetDay: newHost.trafficResetDay || 1,
      notifyPurchase: newHost.notifyPurchase !== undefined ? newHost.notifyPurchase : true,
      notifyRenew: newHost.notifyRenew !== undefined ? newHost.notifyRenew : true,
      notifyDestroy: newHost.notifyDestroy !== undefined ? newHost.notifyDestroy : false,
      enableResourcePool: newHost.enableResourcePool !== undefined ? newHost.enableResourcePool : true,
      announcement: newHost.announcement || '',
      probeUrl: newHost.probeUrl || '',
      natConfig: {
        publicIp: newHost.natConfig?.publicIp || '',
        publicIpv6: newHost.natConfig?.publicIpv6 || '',
        bindIp: newHost.natConfig?.bindIp || '',
        bindIpv6: newHost.natConfig?.bindIpv6 || '',
        portRangeStart: newHost.natConfig?.portRangeStart || null,
        portRangeEnd: newHost.natConfig?.portRangeEnd || null
      }
    }
  }
}, { immediate: true })


async function saveConfig() {
  // 根据用户角色确定节点名称
  let fullName: string
  if (isAdmin.value) {
    // 管理员直接使用完整名称
    if (!form.value.name.trim()) {
      toast.error(t('admin.hosts.hostNameRequired'))
      return
    }
    fullName = form.value.name
  } else {
    // 普通用户使用前缀 + 后缀，前缀不可修改
    if (!form.value.nameSuffix.trim()) {
      toast.error(t('resources.hosts.nameSuffixRequired'))
      return
    }
    fullName = hostNamePrefix.value + form.value.nameSuffix
  }
  
  // 验证完整名称
  const nameValidation = validateIdentifier(fullName, t('admin.hosts.hostName'), 2, 64)
  if (!nameValidation.valid) {
    toast.error(nameValidation.message || t('admin.hosts.hostNameHint'))
    return
  }

  // 验证服务器地址
  if (!form.value.hostAddress) {
    toast.error(t('admin.hosts.ipAddressRequired'))
    return
  }
  const ipValidation = validateHostAddress(form.value.hostAddress, t('admin.hosts.ipAddress'))
  if (!ipValidation.valid) {
    toast.error(ipValidation.message || '')
    return
  }

  // 验证描述
  if (form.value.location) {
    const locationValidation = validateName(form.value.location, t('admin.hosts.hostDesc'), 1, 100)
    if (!locationValidation.valid) {
      toast.error(locationValidation.message || '')
      return
    }
  }

  if (requiresIpv6ParentInterface.value && !form.value.ipv6ParentInterface.trim()) {
    toast.error(t('admin.hosts.ipv6ParentInterfaceRequired'))
    return
  }

  // 验证 NAT 网卡 IP，支持 IPv4 / IPv6
  if (form.value.natConfig?.publicIp) {
    const natIpValidation = validateIpAddress(form.value.natConfig.publicIp, t('admin.hosts.natPublicIp'))
    if (!natIpValidation.valid) {
      toast.error(natIpValidation.message || '')
      return
    }
  }
  if (form.value.natConfig?.publicIpv6) {
    const publicIpv6Validation = validateIpAddress(form.value.natConfig.publicIpv6, t('admin.hosts.natPublicIpv6'))
    if (!publicIpv6Validation.valid || !(publicIpv6Validation.sanitized || form.value.natConfig.publicIpv6).includes(':')) {
      toast.error(t('admin.hosts.natPublicIpv6Invalid'))
      return
    }
  }
  if (form.value.natConfig?.bindIp) {
    const bindIpValidation = validateIpAddress(form.value.natConfig.bindIp, t('admin.hosts.natBindIpv4'))
    if (!bindIpValidation.valid) {
      toast.error(bindIpValidation.message || '')
      return
    }
  }
  if (form.value.natConfig?.bindIpv6) {
    const bindIpv6Validation = validateIpAddress(form.value.natConfig.bindIpv6, t('admin.hosts.natBindIpv6'))
    if (!bindIpv6Validation.valid || !(bindIpv6Validation.sanitized || form.value.natConfig.bindIpv6).includes(':')) {
      toast.error(t('admin.hosts.natBindIpv6Invalid'))
      return
    }
  }

  // 验证端口范围：结束端口不能小于起始端口
  if (form.value.natConfig?.portRangeStart != null && form.value.natConfig?.portRangeEnd != null) {
    if (form.value.natConfig.portRangeEnd < form.value.natConfig.portRangeStart) {
      toast.error(t('admin.hosts.portRangeEndMustBeGreater'))
      return
    }
  }

  saving.value = true
  try {
    const url = buildHostApiUrl(form.value.hostAddress, form.value.apiPort || 8443)
    
    const result = await api.hosts.update(props.host.id, {
      name: fullName,
      url: url,
      location: form.value.location || undefined,
      countryCode: form.value.countryCode,
      cpuAllowanceMax: form.value.cpuAllowanceMax || undefined,
      memoryMax: form.value.memoryMax || undefined,
      instanceType: form.value.instanceType,
      ipv6ParentInterface: form.value.ipv6ParentInterface.trim() || undefined,
      ipv6Subnet: form.value.ipv6Subnet.trim() || undefined,
      transferEnabled: form.value.transferEnabled,
      trafficResetDay: form.value.trafficResetDay,
      notifyPurchase: form.value.notifyPurchase,
      notifyRenew: form.value.notifyRenew,
      notifyDestroy: form.value.notifyDestroy,
      enableResourcePool: form.value.enableResourcePool,
      announcement: form.value.announcement || null,
      probeUrl: form.value.probeUrl || null,
      natConfig: (form.value.natConfig.publicIp || form.value.natConfig.publicIpv6 || form.value.natConfig.bindIp || form.value.natConfig.bindIpv6 || form.value.natConfig.portRangeStart || form.value.natConfig.portRangeEnd) ? form.value.natConfig : undefined
    })
    
    // 检查节点类型变更带来的套餐警告
    const response = result as { warnings?: Array<{ code: string; message: string; packages: Array<{ id: number; name: string; instanceType: string }> }> }
    if (response.warnings && response.warnings.length > 0) {
      const warning = response.warnings[0]
      if (warning.code === 'INCOMPATIBLE_PACKAGES') {
        const packageNames = warning.packages.map(p => p.name).join(', ')
        toast.warning(`${t('admin.hosts.typeChangeWarning') || '警告'}: ${warning.message}\n套餐: ${packageNames}`, 8000)
      }
    }
    
    toast.success(t('admin.hosts.hostUpdated'))
    emit('saved')
  } catch (err: any) {
    const errorCode = err?.code
    const errorMessage = errorCode ? t(`errors.${errorCode}`) : (err?.message || String(err))
    const details = err?.details ? ` (${err.details})` : ''
    toast.error(errorMessage + details)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="card p-6">
    <form class="space-y-6" @submit.prevent="saveConfig">
      <!-- 基本信息 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.hostName') }}</label>
          <!-- 管理员输入完整节点名称 -->
          <template v-if="isAdmin">
            <input 
              v-model="form.name" 
              type="text" 
              class="input" 
              placeholder="node-01" 
              required 
              pattern="^[a-zA-Z0-9_-]+$" 
              @input="form.name = form.name.replace(/[^a-zA-Z0-9_-]/g, '')" 
            />
            <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.hostNameHint') }}</p>
          </template>
          <!-- 普通用户输入节点名称后缀 -->
          <template v-else>
            <div class="flex">
              <span class="inline-flex items-center px-3 text-sm border border-r-0 rounded-l-lg" :class="themeStore.isDark ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-500'">{{ hostNamePrefix }}</span>
              <input 
                v-model="form.nameSuffix" 
                type="text" 
                class="input rounded-l-none flex-1" 
                placeholder="myhost" 
                required 
                pattern="^[a-zA-Z0-9_-]+$" 
                @input="form.nameSuffix = form.nameSuffix.replace(/[^a-zA-Z0-9_-]/g, '')" 
              />
            </div>
            <p class="text-xs text-themed-muted mt-1">{{ t('resources.hosts.nameHint') }}</p>
          </template>
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.hostDesc') }}</label>
          <input v-model="form.location" type="text" class="input" placeholder="Hong Kong DC1" />
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-4">
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.ipAddress') }}</label>
          <div class="flex gap-2">
            <input v-model="form.hostAddress" type="text" class="input flex-1" placeholder="10.0.0.1 / 2001:db8::1 / node.example.com" required />
          </div>
          <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ipAddressHint') }}</p>
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.apiPort') }}</label>
          <input v-model.number="form.apiPort" type="number" min="1" max="65535" class="input" placeholder="8443" required />
          <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.apiPortHint') }}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- 国家选择 -->
        <div ref="countryDropdownRef" class="relative">
          <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.country') }}</label>
          <button type="button" class="input w-full flex items-center justify-between" @click="toggleCountryDropdown">
            <span class="flex items-center gap-2"><FlagIcon :code="form.countryCode" size="sm" />{{ selectedCountry?.name }}</span>
            <svg class="w-4 h-4 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
          </button>
          <div v-if="showCountryDropdown" class="absolute z-50 w-full mt-1 overflow-hidden rounded-lg border shadow-xl" :class="themeStore.isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'">
            <div class="p-2 border-b" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-100'">
              <input
                v-model="countrySearch"
                type="search"
                class="input h-9 text-sm"
                :placeholder="t('common.searchPlaceholder')"
                autocomplete="off"
                autofocus
                @keydown.enter.prevent.stop
                @keydown.stop
              />
            </div>
            <div class="max-h-60 overflow-auto py-1">
              <button
                v-for="c in filteredCountries"
                :key="c.code"
                type="button"
                class="w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors"
                :class="[
                  themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100',
                  form.countryCode === c.code ? (themeStore.isDark ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900') : ''
                ]"
                @click="selectCountry(c.code)"
              >
                <FlagIcon :code="c.code" size="sm" />{{ c.name }}
              </button>
              <div v-if="filteredCountries.length === 0" class="px-3 py-6 text-center text-sm text-themed-muted">
                {{ t('common.noSearchResults') }}
              </div>
            </div>
          </div>
        </div>
        
        <!-- IPv6 父接口 -->
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">
            {{ t('admin.hosts.ipv6ParentInterface') }}
            <span v-if="requiresIpv6ParentInterface" class="text-red-500">*</span>
          </label>
          <input v-model="form.ipv6ParentInterface" type="text" class="input" placeholder="eth0" />
          <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ipv6ParentInterfaceHint') }}</p>
        </div>
      </div>

      <!-- IPv6 子网 -->
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.ipv6Subnet') }}</label>
        <input v-model="form.ipv6Subnet" type="text" class="input" placeholder="2001:db8::/48" />
        <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ipv6SubnetHint') }}</p>
      </div>

      <!-- 资源限制 -->
      <div class="border-t border-themed pt-6">
        <h3 class="text-sm font-medium text-themed mb-4">{{ t('admin.hosts.resourceLimits') }}</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.cpuAllowanceMax') }}</label>
            <input v-model.number="form.cpuAllowanceMax" type="number" class="input" placeholder="0" :min="0" step="5" />
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.memoryMax') }} (MB)</label>
            <input v-model.number="form.memoryMax" type="number" class="input" placeholder="0" :min="0" step="64" />
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.instanceTypeLabel') }}</label>
            <select v-model="form.instanceType" class="input">
              <option value="container">{{ t('admin.hosts.typeContainer') }}</option>
              <option value="vm">{{ t('admin.hosts.typeVm') }}</option>
              <option value="both">{{ t('admin.hosts.typeBoth') }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- NAT 配置 -->
      <div class="border-t border-themed pt-6">
        <h3 class="text-sm font-medium text-themed mb-4">{{ t('admin.hosts.natConfig') }}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.natPublicIpv4') }}</label>
            <input v-model="form.natConfig.publicIp" type="text" class="input" :placeholder="t('admin.hosts.natPublicIpv4Placeholder')" />
            <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.natPublicIpv4Desc') }}</p>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.natPublicIpv6') }}</label>
            <input v-model="form.natConfig.publicIpv6" type="text" class="input" :placeholder="t('admin.hosts.natPublicIpv6Placeholder')" />
            <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.natPublicIpv6Desc') }}</p>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.natBindIpv4') }}</label>
            <input v-model="form.natConfig.bindIp" type="text" class="input" :placeholder="t('admin.hosts.natBindIpv4Placeholder')" />
            <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.natBindIpv4Desc') }}</p>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.natBindIpv6') }}</label>
            <input v-model="form.natConfig.bindIpv6" type="text" class="input" :placeholder="t('admin.hosts.natBindIpv6Placeholder')" />
            <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.natBindIpv6Desc') }}</p>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.portRangeStart') }}</label>
            <input v-model.number="form.natConfig.portRangeStart" type="number" class="input" placeholder="10000" />
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.portRangeEnd') }}</label>
            <input v-model.number="form.natConfig.portRangeEnd" type="number" class="input" placeholder="60000" />
          </div>
        </div>
      </div>

      <!-- 转移控制 -->
      <div class="border-t border-themed pt-6">
        <h3 class="text-sm font-medium text-themed mb-4">{{ t('admin.hosts.transferControl') }}</h3>
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-themed">{{ t('admin.hosts.transferEnabled') }}</p>
            <p class="text-xs text-themed-muted mt-0.5">{{ t('admin.hosts.transferEnabledHint') }}</p>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            :class="form.transferEnabled ? 'bg-blue-600' : (themeStore.isDark ? 'bg-gray-600' : 'bg-gray-300')"
            @click="form.transferEnabled = !form.transferEnabled"
          >
            <span
              class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
              :class="form.transferEnabled ? 'translate-x-5' : 'translate-x-0'"
            />
          </button>
        </div>
      </div>

      <!-- 节点通知 -->
      <div v-if="!isAdmin" class="border-t border-themed pt-6">
        <h3 class="text-sm font-medium text-themed mb-2">{{ t('admin.hosts.notificationSettings') }}</h3>
        <p class="text-xs text-themed-muted mb-4">{{ t('admin.hosts.notificationSettingsHint') }}</p>
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm text-themed">{{ t('admin.hosts.notifyPurchase') }}</p>
              <p class="text-xs text-themed-muted mt-0.5">{{ t('admin.hosts.notifyPurchaseHint') }}</p>
            </div>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              :class="form.notifyPurchase ? 'bg-blue-600' : (themeStore.isDark ? 'bg-gray-600' : 'bg-gray-300')"
              @click="form.notifyPurchase = !form.notifyPurchase"
            >
              <span
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                :class="form.notifyPurchase ? 'translate-x-5' : 'translate-x-0'"
              />
            </button>
          </div>

          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm text-themed">{{ t('admin.hosts.notifyRenew') }}</p>
              <p class="text-xs text-themed-muted mt-0.5">{{ t('admin.hosts.notifyRenewHint') }}</p>
            </div>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              :class="form.notifyRenew ? 'bg-blue-600' : (themeStore.isDark ? 'bg-gray-600' : 'bg-gray-300')"
              @click="form.notifyRenew = !form.notifyRenew"
            >
              <span
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                :class="form.notifyRenew ? 'translate-x-5' : 'translate-x-0'"
              />
            </button>
          </div>

          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm text-themed">{{ t('admin.hosts.notifyDestroy') }}</p>
              <p class="text-xs text-themed-muted mt-0.5">{{ t('admin.hosts.notifyDestroyHint') }}</p>
            </div>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              :class="form.notifyDestroy ? 'bg-blue-600' : (themeStore.isDark ? 'bg-gray-600' : 'bg-gray-300')"
              @click="form.notifyDestroy = !form.notifyDestroy"
            >
              <span
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                :class="form.notifyDestroy ? 'translate-x-5' : 'translate-x-0'"
              />
            </button>
          </div>
        </div>
      </div>

      <!-- 额外配置 -->
      <div class="border-t border-themed pt-6">
        <h3 class="text-sm font-medium text-themed mb-4">{{ t('admin.hosts.extraConfig') }}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.trafficResetDay') }}</label>
            <input v-model.number="form.trafficResetDay" type="number" class="input" :min="1" :max="28" placeholder="1" />
            <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.trafficResetDayHint') }}</p>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.enableResourcePool') }}</label>
            <div class="flex items-center justify-between mt-2">
              <p class="text-xs text-themed-muted">{{ t('admin.hosts.enableResourcePoolHint') }}</p>
              <button
                type="button"
                class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                :class="form.enableResourcePool ? 'bg-blue-600' : (themeStore.isDark ? 'bg-gray-600' : 'bg-gray-300')"
                @click="form.enableResourcePool = !form.enableResourcePool"
              >
                <span
                  class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  :class="form.enableResourcePool ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 节点公告 -->
      <div class="border-t border-themed pt-6">
        <h3 class="text-sm font-medium text-themed mb-4">{{ t('admin.hosts.announcement') }}</h3>
        <div>
          <textarea 
            v-model="form.announcement" 
            class="input min-h-[100px] resize-y" 
            :placeholder="t('admin.hosts.announcementPlaceholder')"
            rows="3"
            maxlength="1000"
          />
          <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.announcementHint') }}</p>
        </div>
      </div>

      <!-- 探针地址 -->
      <div class="border-t border-themed pt-6">
        <h3 class="text-sm font-medium text-themed mb-4">{{ t('admin.hosts.probeUrl') }}</h3>
        <div>
          <input 
            v-model="form.probeUrl" 
            type="url" 
            class="input" 
            :placeholder="t('admin.hosts.probeUrlPlaceholder')"
            maxlength="500"
          />
          <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.probeUrlHint') }}</p>
        </div>
      </div>

      <!-- 按钮 -->
      <div class="flex items-center justify-end gap-3 pt-4 border-t border-themed">
        <button type="submit" class="btn-primary" :disabled="saving || !form.name || !form.hostAddress">
          <svg v-if="saving" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
          {{ t('common.save') }}
        </button>
      </div>
    </form>
  </div>
</template>
