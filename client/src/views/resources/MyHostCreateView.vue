<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import { onClickOutside } from '@vueuse/core'
import { availableFlagCountryCodes, getLocalizedCountryName } from '@/utils/countryDisplay'
import { buildHostApiUrl, validateIdentifier, validateName, validateHostAddress, validateIpAddress } from '@/utils/validation'
import FlagIcon from '@/components/FlagIcon.vue'

const { t, locale } = useI18n()
const router = useRouter()
const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()

const isAdmin = computed(() => authStore.user?.role === 'admin')

// 节点名称前缀，仅普通用户需要
const hostNamePrefix = computed(() => `PEER${authStore.user?.id}-`)

const saving = ref(false)
const showInstallScript = ref(false)
const installCommand = ref('')


const hostId = ref<number>(0)
const installStatus = ref<'waiting' | 'verifying' | 'success' | 'error'>('waiting')
const verifyError = ref('')

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
  networkMode: 'nat' as 'nat' | 'nat_ipv6' | 'ipv6_only',
  ipv6Subnet: '',
  ipv6ParentInterface: '',
  natPublicIp: '',
  natPublicIpv6: '',
  natBindIp: '',
  natBindIpv6: '',
  portRangeStart: 10000 as number | null,
  portRangeEnd: 65000 as number | null
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

// 验证并连接宿主机
async function verifyHost() {
  if (!hostId.value) return
  installStatus.value = 'verifying'
  verifyError.value = ''
  
  try {
    const res = await api.hosts.verify(hostId.value)
    if (res.success) {
      installStatus.value = 'success'
      toast.success(t('admin.hosts.verifySuccess'))
    }
  } catch (err: any) {
    installStatus.value = 'error'
    verifyError.value = err?.message || String(err)
    toast.error(t('admin.hosts.verifyFailed') + ': ' + verifyError.value)
  }
}

async function createHost() {
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
    // 普通用户：前缀 + 后缀
    if (!form.value.nameSuffix.trim()) {
      toast.error(t('resources.hosts.nameSuffixRequired'))
      return
    }
    fullName = hostNamePrefix.value + form.value.nameSuffix
  }
  
  // 验证完整名称
  const nameValidation = validateIdentifier(fullName, t('admin.hosts.hostName'), 2, 64)
  if (!nameValidation.valid) { toast.error(nameValidation.message || t('admin.hosts.hostNameHint')); return }
  
  // 验证服务器地址
  if (!form.value.hostAddress) { toast.error(t('admin.hosts.ipAddressRequired')); return }
  const ipValidation = validateHostAddress(form.value.hostAddress, t('admin.hosts.ipAddress'))
  if (!ipValidation.valid) { toast.error(ipValidation.message || ''); return }
  
  // 验证描述（如果提供）
  if (form.value.location) {
    const locationValidation = validateName(form.value.location, t('admin.hosts.hostDesc'), 1, 100)
    if (!locationValidation.valid) { toast.error(locationValidation.message || ''); return }
  }
  
  // 网络模式场景映射：前端选项 -> 后端参数
  const networkModeMap: Record<string, { networkMode: string; ipv6Mode: number; needsIpv6Subnet: boolean; needsNatConfig: boolean }> = {
    'nat':          { networkMode: 'nat',      ipv6Mode: 3, needsIpv6Subnet: false, needsNatConfig: true },
    'nat_ipv6':     { networkMode: 'nat_ipv6', ipv6Mode: 1, needsIpv6Subnet: true,  needsNatConfig: true },
    'ipv6_only':    { networkMode: 'nat_ipv6', ipv6Mode: 1, needsIpv6Subnet: true,  needsNatConfig: false },
  }
  const modeConfig = networkModeMap[form.value.networkMode] || networkModeMap['nat']

  // 验证 IPv6 网段。支持先创建节点，执行脚本后再回来补充。
  if (modeConfig.needsIpv6Subnet) {
    const hasSubnet = form.value.ipv6Subnet && form.value.ipv6Subnet.trim()
    const hasInterface = form.value.ipv6ParentInterface && form.value.ipv6ParentInterface.trim()
    // 如果填了其中一个，则两个都必须填写
    if (hasSubnet && !hasInterface) {
      toast.error(t('admin.hosts.ipv6ParentInterfaceRequired'))
      return
    }
    if (!hasSubnet && hasInterface) {
      toast.error(t('admin.hosts.ipv6SubnetRequired'))
      return
    }
    // 如果填写了，校验格式
    if (hasSubnet && !form.value.ipv6Subnet.includes('/')) {
      toast.error(t('admin.hosts.ipv6SubnetInvalid'))
      return
    }
  }
  
  // 验证端口范围：结束端口不能小于起始端口
  if (form.value.portRangeStart != null && form.value.portRangeEnd != null) {
    if (form.value.portRangeEnd < form.value.portRangeStart) {
      toast.error(t('admin.hosts.portRangeEndMustBeGreater'))
      return
    }
  }

  // 验证 NAT 网卡 IP，支持 IPv4 / IPv6
  if (form.value.natPublicIp) {
    const natIpValidation = validateIpAddress(form.value.natPublicIp, t('admin.hosts.natPublicIp'))
    if (!natIpValidation.valid) {
      toast.error(natIpValidation.message || '')
      return
    }
  }
  if (form.value.natPublicIpv6) {
    const publicIpv6Validation = validateIpAddress(form.value.natPublicIpv6, t('admin.hosts.natPublicIpv6'))
    if (!publicIpv6Validation.valid || !(publicIpv6Validation.sanitized || form.value.natPublicIpv6).includes(':') ) {
      toast.error(t('admin.hosts.natPublicIpv6Invalid'))
      return
    }
  }
  if (form.value.natBindIp) {
    const bindIpValidation = validateIpAddress(form.value.natBindIp, t('admin.hosts.natBindIpv4'))
    if (!bindIpValidation.valid) {
      toast.error(bindIpValidation.message || '')
      return
    }
  }
  if (form.value.natBindIpv6) {
    const bindIpv6Validation = validateIpAddress(form.value.natBindIpv6, t('admin.hosts.natBindIpv6'))
    if (!bindIpv6Validation.valid || !(bindIpv6Validation.sanitized || form.value.natBindIpv6).includes(':') ) {
      toast.error(t('admin.hosts.natBindIpv6Invalid'))
      return
    }
  }

  saving.value = true
  try {
    const url = buildHostApiUrl(form.value.hostAddress, form.value.apiPort || 8443)
    
    const formData: any = {
      name: fullName,
      url: url,
      location: form.value.location || undefined,
      countryCode: form.value.countryCode,
      cpuAllowanceMax: form.value.cpuAllowanceMax || undefined,
      memoryMax: form.value.memoryMax || undefined,
      instanceType: form.value.instanceType,
      ipv6Mode: modeConfig.ipv6Mode,
      ipv6Subnet: modeConfig.needsIpv6Subnet ? form.value.ipv6Subnet.trim() : undefined,
      ipv6ParentInterface: modeConfig.needsIpv6Subnet ? form.value.ipv6ParentInterface.trim() : undefined,
      natConfig: modeConfig.needsNatConfig && (form.value.natPublicIp || form.value.natPublicIpv6 || form.value.natBindIp || form.value.natBindIpv6 || form.value.portRangeStart || form.value.portRangeEnd) ? {
        publicIp: form.value.natPublicIp || undefined,
        publicIpv6: form.value.natPublicIpv6 || undefined,
        bindIp: form.value.natBindIp || undefined,
        bindIpv6: form.value.natBindIpv6 || undefined,
        portRangeStart: form.value.portRangeStart || undefined,
        portRangeEnd: form.value.portRangeEnd || undefined
      } : undefined
    }

    const response = await api.hosts.create(formData)
    const command = (response as any).installCommand

    hostId.value = (response as any).host?.id
    toast.success(t('admin.hosts.hostAdded'))
    if (command) {
      installCommand.value = command
      showInstallScript.value = true
      installStatus.value = 'waiting'
    } else {
      router.push('/resources/hosts')
    }
  } catch (err: any) {
    const errorCode = err?.code
    const errorMessage = errorCode ? t(`errors.${errorCode}`) : (err?.message || String(err))
    const details = err?.details ? ` (${err.details})` : ''
    toast.error(`${t('admin.hosts.addFailed')}: ${errorMessage}${details}`)
  } finally {
    saving.value = false
  }
}

function copyCommand() {
  navigator.clipboard.writeText(installCommand.value)
  toast.success(t('common.copied'))
}

function closeAndGoBack() {
  showInstallScript.value = false
  router.push('/resources/hosts')
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <!-- 居中容器 -->
    <div class="flex justify-center">
      <div class="w-full max-w-3xl space-y-6">
        <!-- 页面头部 -->
        <div class="flex items-center gap-3">
          <RouterLink to="/resources/hosts" class="transition-colors" :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" /></svg>
          </RouterLink>
          <div>
            <h1 class="page-title">{{ t('resources.hosts.create') }}</h1>
            <p class="page-description">{{ t('resources.hosts.createDesc') }}</p>
          </div>
        </div>

        <!-- 表单卡片 -->
        <div class="card p-6">
          <!-- 节点部署说明 -->
          <div class="mb-6 p-4 rounded-lg border" :class="themeStore.isDark ? 'bg-blue-900/20 border-blue-800' : 'bg-blue-50 border-blue-200'">
            <div class="flex items-start gap-3">
              <svg class="w-5 h-5 flex-shrink-0 mt-0.5" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div class="text-sm space-y-1.5" :class="themeStore.isDark ? 'text-blue-300' : 'text-blue-700'">
                <p>{{ t('resources.hosts.ubuntuOnlyHint') }}</p>
                <p>{{ t('resources.hosts.installHintTitle') }}</p>
                <p class="text-xs opacity-80">{{ t('resources.hosts.installHintIpv6') }}</p>
              </div>
            </div>
          </div>

          <form class="space-y-6" @submit.prevent="createHost">
            <!-- 基本信息 -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.hostName') }}</label>
                <!-- 管理员输入完整节点名称 -->
                <template v-if="isAdmin">
                  <input v-model="form.name" type="text" class="input" placeholder="node-01" required pattern="^[a-zA-Z0-9_-]+$" @input="form.name = form.name.replace(/[^a-zA-Z0-9_-]/g, '')" />
                  <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.hostNameHint') }}</p>
                </template>
                <!-- 普通用户输入节点名称后缀 -->
                <template v-else>
                  <div class="flex">
                    <span class="inline-flex items-center px-3 text-sm border border-r-0 rounded-l-lg" :class="themeStore.isDark ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-500'">{{ hostNamePrefix }}</span>
                    <input v-model="form.nameSuffix" type="text" class="input rounded-l-none flex-1" placeholder="myhost" required pattern="^[a-zA-Z0-9_-]+$" @input="form.nameSuffix = form.nameSuffix.replace(/[^a-zA-Z0-9_-]/g, '')" />
                  </div>
                  <p class="text-xs text-themed-muted mt-1">{{ t('resources.hosts.nameHint') }}</p>
                </template>
                <p class="text-xs text-orange-500 dark:text-orange-400 mt-1">{{ t('common.noIncudalHint') }}</p>
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

              <!-- 网络模式选择 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.networkModeLabel') }}</label>
                <select v-model="form.networkMode" class="input">
                  <option value="nat">{{ t('admin.hosts.networkModeNat') }}</option>
                  <option value="nat_ipv6">{{ t('admin.hosts.networkModeNatIpv6') }}</option>
                  <option value="ipv6_only">{{ t('admin.hosts.networkModeIpv6Only') }}</option>
                </select>
              </div>
            </div>

            <!-- IPv6 网段输入框（仅在选择 nat_ipv6 时显示） -->
            <Transition name="fade">
              <div v-if="form.networkMode === 'nat_ipv6' || form.networkMode === 'ipv6_only'" class="space-y-4">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.ipv6Subnet') }}</label>
                  <input 
                    v-model="form.ipv6Subnet" 
                    type="text" 
                    class="input" 
                    placeholder="2001:db8::/48" 
                  />
                  <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ipv6SubnetHint') }}</p>
                </div>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.ipv6ParentInterface') }}</label>
                  <input 
                    v-model="form.ipv6ParentInterface" 
                    type="text" 
                    class="input" 
                    placeholder="eth0" 
                  />
                  <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ipv6ParentInterfaceHint') }}</p>
                </div>
                <p class="text-xs text-amber-500">{{ t('resources.hosts.ipv6OptionalHint') }}</p>
              </div>
            </Transition>

            <!-- NAT 端口映射配置，仅 IPv4 相关模式显示 -->
            <div v-if="form.networkMode !== 'ipv6_only'" class="border-t border-themed pt-6">
              <h3 class="text-sm font-medium text-themed mb-4">{{ t('admin.hosts.natConfig') }}</h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.natPublicIpv4') }}</label>
                  <input v-model="form.natPublicIp" type="text" class="input" :placeholder="t('admin.hosts.natPublicIpv4Placeholder')" />
                  <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.natPublicIpv4Desc') }}</p>
                </div>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.natPublicIpv6') }}</label>
                  <input v-model="form.natPublicIpv6" type="text" class="input" :placeholder="t('admin.hosts.natPublicIpv6Placeholder')" />
                  <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.natPublicIpv6Desc') }}</p>
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.natBindIpv4') }}</label>
                  <input v-model="form.natBindIp" type="text" class="input" :placeholder="t('admin.hosts.natBindIpv4Placeholder')" />
                  <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.natBindIpv4Desc') }}</p>
                </div>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.natBindIpv6') }}</label>
                  <input v-model="form.natBindIpv6" type="text" class="input" :placeholder="t('admin.hosts.natBindIpv6Placeholder')" />
                  <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.natBindIpv6Desc') }}</p>
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.portRangeStart') }}</label>
                  <input v-model.number="form.portRangeStart" type="number" class="input" placeholder="10000" />
                </div>
                <div>
                  <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.portRangeEnd') }}</label>
                  <input v-model.number="form.portRangeEnd" type="number" class="input" placeholder="65000" />
                </div>
              </div>
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


            <div
              class="rounded-lg border px-4 py-3"
              :class="themeStore.isDark ? 'border-blue-800 bg-blue-950/30 text-blue-100' : 'border-blue-200 bg-blue-50 text-blue-900'"
            >
              <div class="flex items-start gap-2">
                <svg class="w-4 h-4 mt-0.5 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                </svg>
                <p class="text-xs leading-relaxed">{{ t('resources.hosts.storagePoolAfterConnectHint') }}</p>
              </div>
            </div>

            <!-- 按钮 -->
            <div class="flex items-center justify-end gap-3 pt-4 border-t border-themed">
              <RouterLink to="/resources/hosts" class="btn-secondary">{{ t('common.cancel') }}</RouterLink>
              <button type="submit" class="btn-primary" :disabled="saving || (isAdmin ? !form.name : !form.nameSuffix) || !form.hostAddress">
                <svg v-if="saving" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                {{ t('common.create') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- 安装脚本弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showInstallScript" class="modal-overlay">
          <div class="modal-backdrop" @click="closeAndGoBack"></div>
          <div class="modal-content" style="max-width: 72rem; width: 95%;">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.hosts.installScript') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="closeAndGoBack">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div class="modal-body space-y-4">
              <!-- 步骤 1: 执行安装命令 -->
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <span class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium" :class="installStatus === 'success' ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'">1</span>
                  <span class="text-sm font-medium text-themed">{{ t('admin.hosts.step1RunScript') }}</span>
                </div>
                <p class="text-xs text-themed-muted ml-8">{{ t('admin.hosts.runOnHost') }}</p>
                <div class="bg-gray-900 rounded-lg p-4 ml-8 overflow-x-auto">
                  <code class="text-green-400 text-sm break-all whitespace-pre-wrap font-mono">{{ installCommand }}</code>
                </div>
                <div class="ml-8 mb-4">
                  <button class="btn-secondary btn-sm" @click="copyCommand">{{ t('admin.hosts.copyCommand') }}</button>
                </div>
              </div>

              <!-- 步骤 2：验证并连接 -->
              <div class="space-y-2 pt-4 border-t border-themed">
                <div class="flex items-center gap-2">
                  <span class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium" :class="installStatus === 'success' ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'">2</span>
                  <span class="text-sm font-medium text-themed">{{ t('admin.hosts.step2Verify') }}</span>
                </div>
                <p class="text-xs text-themed-muted ml-8">{{ t('admin.hosts.verifyHint') }}</p>
              
                <!-- 状态显示 -->
                <div class="ml-8 flex items-center gap-3">
                  <button 
                    class="btn-secondary btn-sm" 
                    :disabled="installStatus === 'verifying' || installStatus === 'success'"
                    @click="verifyHost"
                  >
                    <svg v-if="installStatus === 'verifying'" class="w-4 h-4 animate-spin mr-1" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    {{ installStatus === 'verifying' ? t('admin.hosts.verifying') : t('admin.hosts.verifyAndConnect') }}
                  </button>
                
                  <!-- 成功状态 -->
                  <div v-if="installStatus === 'success'" class="flex items-center gap-2 text-green-500">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span class="text-sm">{{ t('admin.hosts.verifySuccess') }}</span>
                  </div>
                </div>
              
                <!-- 错误提示 -->
                <div v-if="installStatus === 'error' && verifyError" class="ml-8 p-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
                  {{ verifyError }}
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="closeAndGoBack">{{ t('common.close') }}</button>
              <button v-if="installStatus === 'success'" class="btn-primary" @click="closeAndGoBack">{{ t('common.done') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
