<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import api from '@/api'
import { useConfigStore } from '@/stores/config'
import { useToast } from '@/stores/toast'
import type { Package } from '@/types/api'
import { translateError } from '@/utils/errorHandler'
import {
  systemSettingsNavigationItems,
  systemSettingsSections,
  type SystemSettingsSectionKey
} from '@/constants/adminSettings'

const { t } = useI18n()
const toast = useToast()
const route = useRoute()
const configStore = useConfigStore()

const loading = ref(true)
// 每个卡片独立的 saving 状态
const savingRegistration = ref(false)
const savingInvitePricing = ref(false)
const savingPopupAnnouncement = ref(false)
const savingPopupPromo = ref(false)
const savingHostingFeature = ref(false)
const savingQuota = ref(false)
const savingTurnstile = ref(false)
const savingAvatar = ref(false)
const savingSmtp = ref(false)
const savingEmailDomain = ref(false)
const savingTransfer = ref(false)
const savingFooterLinks = ref(false)
const savingBrand = ref(false)
const savingTicket = ref(false)
const savingFreeSite = ref(false)
const savingTicketImages = ref(false)
const testingSmtp = ref(false)
const sendingTestEmail = ref(false)
const testEmailTo = ref('')
const popupPromoPackages = ref<Package[]>([])
const popupPromoPackagesLoading = ref(false)
const popupPromoPackagesLoaded = ref(false)
const MAX_TRANSFER_FEE = 100

interface ConfigItem {
  id: number
  key: string
  value: string
  type: string
  label: string | null
  description: string | null
}

const configs = ref<ConfigItem[]>([])

// 表单数据
const form = ref({
  default_quota_host: 0,
  default_quota_friend: 0,
  default_quota_package: 0,
  registration_enabled: true,
  require_invite_code: true,
  invite_generation_costs: [
    { resource: 'balance', amount: 0, enabled: false },
    { resource: 'points', amount: 0, enabled: false }
  ],
  invite_default_expire_days: 0,
  popup_announcement: '',
  popup_promo_image_url: '',
  popup_promo_package_id: '',
  hosting_feature_enabled: true,
  hosting_market_entry_enabled: true,
  hosting_notice: '',
  ticket_enabled: true,
  free_site_mode: false,
  free_site_register_gift_enabled: false,
  free_site_register_gift_balance: 0,
  free_site_register_gift_points: 0,
  // Turnstile 配置
  turnstile_enabled: false,
  turnstile_site_key: '',
  turnstile_secret_key: '',
  // 头像 API 配置
  avatar_api_base: 'https://api.dicebear.com/9.x',
  // SMTP 邮件配置
  smtp_enabled: false,
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_username: '',
  smtp_password: '',
  smtp_from_email: '',
  smtp_from_name: 'Incudal',
  brand_name: 'Incudal',
  brand_subtitle: '基于 Incus 的低价 NAT VPS',
  brand_logo_url: '/incudal_logo.webp',
  // 邮箱域名白名单配置
  email_domain_whitelist_enabled: false,
  email_allowed_domains: '',
  // 转移手续费配置
  transfer_fee: 0,
  // 侧边栏底部联系方式
  footer_contact_email: 'incudal@sent.com',
  // 工单图片 Lsky 配置
  ticket_image_lsky_base_url: '',
  ticket_image_lsky_token: '',
  ticket_image_lsky_api_version: 'v1',
  ticket_image_lsky_target_id: ''
})

// Config metadata - computed to support i18n
// 注意：好友配额已禁用，不再显示 default_quota_friend
const configMeta = computed(() => {
  try {
    return {
      default_quota_host: {
        label: t('admin.system.quotaHost') || '默认宿主机配额',
        unit: t('admin.system.unitCount') || '个',
        description: t('admin.system.quotaHostDesc') || '新用户默认可创建宿主机数量'
      },
      default_quota_package: {
        label: t('admin.system.quotaPackage') || '默认套餐配额',
        unit: t('admin.system.unitCount') || '个',
        description: t('admin.system.quotaPackageDesc') || '新用户默认可创建套餐数量（0 = 未授权）'
      }
    }
  } catch (err) {
    console.error('Config metadata computation failed:', err)
    // 返回默认值，确保组件能正常渲染
    return {
      default_quota_host: { label: '默认宿主机配额', unit: '个', description: '新用户默认可创建宿主机数量（0 = 未授权）' },
      default_quota_package: { label: '默认套餐配额', unit: '个', description: '新用户默认可创建套餐数量（0 = 未授权）' }
    }
  }
})

// 数字类型的配置键
// 注意：不再限制实例配额，已删除 default_quota_instance
const numericConfigKeys = ['default_quota_host', 'default_quota_friend', 'default_quota_package', 'smtp_port', 'free_site_register_gift_points', 'invite_default_expire_days']

// 浮点数类型的配置键
const floatConfigKeys = ['transfer_fee', 'free_site_register_gift_balance']

// 布尔类型的配置键
const booleanConfigKeys = ['registration_enabled', 'require_invite_code', 'hosting_feature_enabled', 'hosting_market_entry_enabled', 'ticket_enabled', 'free_site_mode', 'free_site_register_gift_enabled', 'turnstile_enabled', 'smtp_enabled', 'smtp_secure', 'email_domain_whitelist_enabled']

// 字符串类型的配置键
const stringConfigKeys = ['turnstile_site_key', 'turnstile_secret_key', 'avatar_api_base', 'smtp_host', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name', 'email_allowed_domains', 'footer_contact_email', 'brand_name', 'brand_subtitle', 'brand_logo_url', 'hosting_notice']
stringConfigKeys.push('popup_announcement', 'popup_promo_image_url', 'popup_promo_package_id', 'ticket_image_lsky_base_url', 'ticket_image_lsky_token', 'ticket_image_lsky_api_version', 'ticket_image_lsky_target_id')

const jsonConfigKeys = ['invite_generation_costs']

const currentSectionKey = computed<SystemSettingsSectionKey>(() => {
  return systemSettingsSections.find(section => section.path === route.path)?.key || 'access'
})

const currentSection = computed(() =>
  systemSettingsSections.find(section => section.key === currentSectionKey.value) || systemSettingsSections[0]
)

const isAccessSection = computed(() => currentSectionKey.value === 'access')
const isHostingSection = computed(() => currentSectionKey.value === 'hosting')
const isBrandSection = computed(() => currentSectionKey.value === 'brand')
const isSecuritySection = computed(() => currentSectionKey.value === 'security')
const isMailSection = computed(() => currentSectionKey.value === 'mail')
const isTicketSection = computed(() => currentSectionKey.value === 'tickets')
const isPopupAnnouncementTab = computed(() => currentSectionKey.value === 'popup')

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const cents = value * 100
  return Math.abs(cents - Math.round(cents)) < 1e-8
}

function getConfigSaveErrorMessage(err: any): string {
  const details = typeof err?.details === 'string' ? err.details : ''
  if (details && !Object.prototype.hasOwnProperty.call(form.value, details)) {
    return details
  }
  return translateError({ ...err, details: null })
}

onMounted(async () => {
  try {
    const tasks: Promise<void>[] = [loadConfigs()]
    if (isPopupAnnouncementTab.value) {
      tasks.push(loadPopupPromoPackages())
    }
    await Promise.all(tasks)
  } catch (err: unknown) {
    console.error('[SystemConfigView] Failed to load configs:', err)
    const errorMessage = (err && typeof err === 'object' && 'message' in err)
      ? String(err.message)
      : String(err)
    try {
      toast.error((t('admin.system.loadFailed') || '加载配置失败') + ': ' + errorMessage)
    } catch (toastErr) {
      console.error('[SystemConfigView] Failed to show toast:', toastErr)
    }
    // 即使加载失败，也要确保页面能够显示
    loading.value = false
  }
})

watch(isPopupAnnouncementTab, (active) => {
  if (active) {
    void loadPopupPromoPackages()
  }
})

async function loadConfigs() {
  loading.value = true
  try {
    const response = await api.systemConfig.list()

    if (!response || typeof response !== 'object') {
      console.warn('[SystemConfigView] Invalid response format:', response)
      configs.value = []
      return
    }

    configs.value = Array.isArray(response.configs) ? response.configs : []

    // 填充表单
    if (Array.isArray(response.configs)) {
      for (const config of response.configs) {
        if (config && typeof config === 'object' && config.key && config.key in form.value) {
          try {
            if (numericConfigKeys.includes(config.key)) {
              (form.value as any)[config.key] = parseInt(config.value, 10) || 0
            } else if (floatConfigKeys.includes(config.key)) {
              (form.value as any)[config.key] = parseFloat(config.value) || 0
            } else if (booleanConfigKeys.includes(config.key)) {
              (form.value as any)[config.key] = config.value === 'true'
            } else if (stringConfigKeys.includes(config.key)) {
              (form.value as any)[config.key] = config.value || ''
            } else if (jsonConfigKeys.includes(config.key)) {
              try {
                (form.value as any)[config.key] = JSON.parse(config.value || '[]')
              } catch {
                (form.value as any)[config.key] = []
              }
            }
          } catch (configErr) {
            console.error(`[SystemConfigView] Failed to process config key "${config.key}":`, configErr)
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[SystemConfigView] Error loading configs:', err)
    try {
      toast.error((t('admin.system.loadFailed') || '加载配置失败') + ': ' + (err?.message || String(err)))
    } catch (toastErr) {
      console.error('[SystemConfigView] Failed to show toast:', toastErr)
    }
    // 确保configs是一个空数组，避免后续代码出错
    configs.value = []
  } finally {
    loading.value = false
  }
}

async function loadPopupPromoPackages() {
  if (popupPromoPackagesLoading.value || popupPromoPackagesLoaded.value) {
    return
  }
  popupPromoPackagesLoading.value = true
  try {
    const [officialResponse, marketResponse] = await Promise.all([
      api.packages.list({ source: 'official' }),
      api.packages.list({ source: 'market' })
    ])
    popupPromoPackages.value = [
      ...(officialResponse.packages || []),
      ...(marketResponse.packages || [])
    ].filter(pkg => pkg.active === 1)
    popupPromoPackagesLoaded.value = true
  } catch (err) {
    console.error('[SystemConfigView] Failed to load promo packages:', err)
    popupPromoPackages.value = []
  } finally {
    popupPromoPackagesLoading.value = false
  }
}

// 通用保存函数
async function saveConfigGroup(keys: string[], savingRef: { value: boolean }) {
  savingRef.value = true
  try {
    const configsToUpdate = keys.map(key => ({
      key,
      value: jsonConfigKeys.includes(key)
        ? JSON.stringify((form.value as any)[key] || [])
        : typeof (form.value as any)[key] === 'boolean'
          ? ((form.value as any)[key] ? 'true' : 'false')
          : String((form.value as any)[key])
    }))

    await api.systemConfig.update(configsToUpdate)
    toast.success(t('admin.system.saveSuccess'))
    await loadConfigs()
  } catch (err: any) {
    toast.error(t('admin.system.saveFailed') + ': ' + getConfigSaveErrorMessage(err))
  } finally {
    savingRef.value = false
  }
}

// 注册设置保存
const registrationKeys = ['registration_enabled', 'require_invite_code']
async function saveRegistration() {
  await saveConfigGroup(registrationKeys, savingRegistration)
}
const hasRegistrationChanges = computed(() => {
  return registrationKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

function normalizeInviteCostOptions() {
  const options = Array.isArray(form.value.invite_generation_costs)
    ? form.value.invite_generation_costs
    : []
  const optionMap = new Map(options.map((option: any) => [option.resource, option]))
  for (const resource of ['balance', 'points']) {
    if (!optionMap.has(resource)) {
      optionMap.set(resource, { resource, amount: 0, enabled: false })
    }
  }
  form.value.invite_generation_costs = Array.from(optionMap.values()).map((option: any) => ({
    resource: option.resource,
    amount: option.resource === 'points'
      ? Math.max(0, Math.floor(Number(option.amount) || 0))
      : Math.max(0, Math.round((Number(option.amount) || 0) * 100) / 100),
    enabled: option.enabled === true
  }))
}

const invitePricingKeys = ['invite_generation_costs', 'invite_default_expire_days']
async function saveInvitePricing() {
  normalizeInviteCostOptions()
  await saveConfigGroup(invitePricingKeys, savingInvitePricing)
}
const hasInvitePricingChanges = computed(() => {
  return invitePricingKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    const currentValue = jsonConfigKeys.includes(key)
      ? JSON.stringify((form.value as any)[key] || [])
      : String((form.value as any)[key])
    return currentValue !== config.value
  })
})

const popupAnnouncementKeys = ['popup_announcement']
async function savePopupAnnouncement() {
  await saveConfigGroup(popupAnnouncementKeys, savingPopupAnnouncement)
  await configStore.loadPublicConfig(true)
}
const hasPopupAnnouncementChanges = computed(() => {
  return popupAnnouncementKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

const popupPromoKeys = ['popup_promo_image_url', 'popup_promo_package_id']
async function savePopupPromo() {
  await saveConfigGroup(popupPromoKeys, savingPopupPromo)
  await configStore.loadPublicConfig(true)
}
const hasPopupPromoChanges = computed(() => {
  return popupPromoKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})
const selectedPopupPromoPackage = computed(() => {
  const packageId = Number(form.value.popup_promo_package_id)
  if (!Number.isInteger(packageId) || packageId <= 0) return null
  return popupPromoPackages.value.find(pkg => pkg.id === packageId) || null
})

// 转移设置保存
const transferKeys = ['transfer_fee']
async function saveTransfer() {
  const fee = Number(form.value.transfer_fee)
  if (!Number.isFinite(fee) || fee < 0 || fee > MAX_TRANSFER_FEE || !hasAtMostTwoDecimalPlaces(fee)) {
    toast.error(t('admin.system.transfer.feeRangeError', { max: MAX_TRANSFER_FEE.toFixed(2) }))
    return
  }
  form.value.transfer_fee = Math.round(fee * 100) / 100
  await saveConfigGroup(transferKeys, savingTransfer)
  await configStore.loadPublicConfig(true)
}
const hasTransferChanges = computed(() => {
  return transferKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

const hostingFeatureKeys = ['hosting_feature_enabled', 'hosting_market_entry_enabled', 'hosting_notice']
async function saveHostingFeature() {
  await saveConfigGroup(hostingFeatureKeys, savingHostingFeature)
  await configStore.loadPublicConfig(true)
}
const hasHostingFeatureChanges = computed(() => {
  return hostingFeatureKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

const footerLinkKeys = ['footer_contact_email']
async function saveFooterLinks() {
  await saveConfigGroup(footerLinkKeys, savingFooterLinks)
}
const hasFooterLinkChanges = computed(() => {
  return footerLinkKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

const brandKeys = ['brand_name', 'brand_subtitle', 'brand_logo_url']
async function saveBrand() {
  await saveConfigGroup(brandKeys, savingBrand)
  await configStore.loadPublicConfig(true)
}
const hasBrandChanges = computed(() => {
  return brandKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

const ticketKeys = ['ticket_enabled']
async function saveTicket() {
  await saveConfigGroup(ticketKeys, savingTicket)
  await configStore.loadPublicConfig(true)
}
const hasTicketChanges = computed(() => {
  return ticketKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

const freeSiteKeys = ['free_site_mode', 'free_site_register_gift_enabled', 'free_site_register_gift_balance', 'free_site_register_gift_points']
async function saveFreeSite() {
  await saveConfigGroup(freeSiteKeys, savingFreeSite)
  await configStore.loadPublicConfig(true)
}
function toggleFreeSiteMode() {
  form.value.free_site_mode = !form.value.free_site_mode
  if (!form.value.free_site_mode) {
    form.value.free_site_register_gift_enabled = false
    form.value.free_site_register_gift_balance = 0
    form.value.free_site_register_gift_points = 0
  }
}
function toggleFreeSiteRegisterGift() {
  if (!form.value.free_site_mode) return
  form.value.free_site_register_gift_enabled = !form.value.free_site_register_gift_enabled
  if (!form.value.free_site_register_gift_enabled) {
    form.value.free_site_register_gift_balance = 0
    form.value.free_site_register_gift_points = 0
  }
}
const hasFreeSiteChanges = computed(() => {
  return freeSiteKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

const ticketImageKeys = ['ticket_image_lsky_base_url', 'ticket_image_lsky_token', 'ticket_image_lsky_api_version', 'ticket_image_lsky_target_id']
async function saveTicketImages() {
  await saveConfigGroup(ticketImageKeys, savingTicketImages)
}
const hasTicketImageChanges = computed(() => {
  return ticketImageKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

// 用户默认配额保存
// 注意：不再限制实例配额，已删除 default_quota_instance
// 注意：好友配额已禁用，保留 default_quota_friend 以确保旧数据兼容
const quotaKeys = ['default_quota_host', 'default_quota_friend', 'default_quota_package']
async function saveQuota() {
  await saveConfigGroup(quotaKeys, savingQuota)
}
const hasQuotaChanges = computed(() => {
  return quotaKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

// Turnstile 保存
const turnstileKeys = ['turnstile_enabled', 'turnstile_site_key', 'turnstile_secret_key']
async function saveTurnstile() {
  await saveConfigGroup(turnstileKeys, savingTurnstile)
}
const hasTurnstileChanges = computed(() => {
  return turnstileKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

// 头像 API 保存
const avatarKeys = ['avatar_api_base']
async function saveAvatar() {
  await saveConfigGroup(avatarKeys, savingAvatar)
}
const hasAvatarChanges = computed(() => {
  return avatarKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

// SMTP 保存
const smtpKeys = ['smtp_enabled', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name']
async function saveSmtp() {
  await saveConfigGroup(smtpKeys, savingSmtp)
}
const hasSmtpChanges = computed(() => {
  return smtpKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

// 邮箱域名白名单保存
const emailDomainKeys = ['email_domain_whitelist_enabled', 'email_allowed_domains']
async function saveEmailDomain() {
  await saveConfigGroup(emailDomainKeys, savingEmailDomain)
}
const hasEmailDomainChanges = computed(() => {
  return emailDomainKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

async function testSmtpConnection() {
  testingSmtp.value = true
  try {
    const result = await api.systemConfig.testSmtp()
    if (result.success) {
      toast.success(t('admin.system.smtp.testSuccess'))
    } else {
      toast.error(t('admin.system.smtp.testFailed') + ': ' + (result.error || 'Unknown error'))
    }
  } catch (err: any) {
    toast.error(t('admin.system.smtp.testFailed') + ': ' + (err?.message || String(err)))
  } finally {
    testingSmtp.value = false
  }
}

async function sendTestEmail() {
  if (!testEmailTo.value || !testEmailTo.value.includes('@')) {
    toast.error(t('admin.system.smtp.invalidEmail'))
    return
  }

  sendingTestEmail.value = true
  try {
    const result = await api.systemConfig.sendTestEmail(testEmailTo.value)
    if (result.success) {
      toast.success(t('admin.system.smtp.testEmailSent', { email: testEmailTo.value }))
      testEmailTo.value = ''
    } else {
      toast.error(t('admin.system.smtp.testEmailFailed') + ': ' + (result.error || 'Unknown error'))
    }
  } catch (err: any) {
    toast.error(t('admin.system.smtp.testEmailFailed') + ': ' + (err?.message || String(err)))
  } finally {
    sendingTestEmail.value = false
  }
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('admin.system.title') || '系统设置' }}</h1>
        <p class="page-description">{{ t(currentSection.descriptionKey) || t('admin.system.description') }}</p>
      </div>
    </div>

    <div class="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
      <router-link
        v-for="item in systemSettingsNavigationItems"
        :key="item.path"
        :to="item.path"
        class="shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors"
        :class="route.path === item.path
          ? 'border-black dark:border-white text-gray-900 dark:text-white'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
      >
        {{ t(item.labelKey) }}
      </router-link>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card p-6 animate-pulse">
      <div class="h-6 bg-themed-secondary rounded w-1/4 mb-6"></div>
      <div class="space-y-4">
        <div v-for="i in 7" :key="i" class="h-12 bg-themed-secondary rounded"></div>
      </div>
    </div>

    <!-- Config Form -->
    <div v-else class="space-y-6">
      <div v-if="isPopupAnnouncementTab" class="card p-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-2">
          <div>
            <h3 class="text-themed font-medium">{{ t('admin.system.popupAnnouncement.title') }}</h3>
            <p class="text-sm text-themed-muted mt-1">{{ t('admin.system.popupAnnouncement.description') }}</p>
          </div>
          <button
            type="button"
            class="btn-primary text-sm px-4 py-1.5"
            :disabled="!hasPopupAnnouncementChanges || savingPopupAnnouncement || form.popup_announcement.length > 5000"
            @click="savePopupAnnouncement"
          >
            {{ savingPopupAnnouncement ? t('admin.system.saving') : t('admin.system.save') }}
          </button>
        </div>

        <div class="mt-6 space-y-2">
          <label class="block text-sm text-themed-secondary">
            {{ t('admin.system.popupAnnouncement.content') }}
          </label>
          <textarea
            v-model="form.popup_announcement"
            rows="8"
            maxlength="5000"
            class="input min-h-[180px] resize-y"
            :placeholder="t('admin.system.popupAnnouncement.placeholder')"
          />
          <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-xs text-themed-muted">{{ t('admin.system.popupAnnouncement.hint') }}</p>
            <p class="text-xs" :class="form.popup_announcement.length > 5000 ? 'text-red-500' : 'text-themed-muted'">
              {{ form.popup_announcement.length }}/5000
            </p>
          </div>
        </div>
      </div>

      <div v-if="isPopupAnnouncementTab" class="card p-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-2">
          <div>
            <h3 class="text-themed font-medium">{{ t('admin.system.popupAnnouncement.promoTitle') }}</h3>
            <p class="text-sm text-themed-muted mt-1">{{ t('admin.system.popupAnnouncement.promoDescription') }}</p>
          </div>
          <button
            type="button"
            class="btn-primary text-sm px-4 py-1.5"
            :disabled="!hasPopupPromoChanges || savingPopupPromo || form.popup_promo_image_url.length > 1000"
            @click="savePopupPromo"
          >
            {{ savingPopupPromo ? t('admin.system.saving') : t('admin.system.save') }}
          </button>
        </div>

        <div class="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-themed-secondary mb-1.5">
                {{ t('admin.system.popupAnnouncement.promoImageUrl') }}
              </label>
              <input
                v-model="form.popup_promo_image_url"
                type="url"
                maxlength="1000"
                class="input w-full"
                :placeholder="t('admin.system.popupAnnouncement.promoImagePlaceholder')"
              />
              <div class="mt-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs text-themed-muted">{{ t('admin.system.popupAnnouncement.promoImageHint') }}</p>
                <p class="text-xs" :class="form.popup_promo_image_url.length > 1000 ? 'text-red-500' : 'text-themed-muted'">
                  {{ form.popup_promo_image_url.length }}/1000
                </p>
              </div>
            </div>

            <div>
              <label class="block text-sm text-themed-secondary mb-1.5">
                {{ t('admin.system.popupAnnouncement.promoPackage') }}
              </label>
              <select
                v-model="form.popup_promo_package_id"
                class="input w-full"
                :disabled="popupPromoPackagesLoading"
              >
                <option value="">
                  {{ popupPromoPackagesLoading ? t('admin.system.popupAnnouncement.promoPackageLoading') : t('admin.system.popupAnnouncement.promoPackagePlaceholder') }}
                </option>
                <option v-if="!popupPromoPackagesLoading && popupPromoPackages.length === 0" value="" disabled>
                  {{ t('admin.system.popupAnnouncement.promoPackageEmpty') }}
                </option>
                <option v-for="pkg in popupPromoPackages" :key="pkg.id" :value="String(pkg.id)">
                  #{{ pkg.id }} · {{ pkg.name }}
                </option>
              </select>
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.popupAnnouncement.promoPackageHint') }}</p>
            </div>
          </div>

          <div class="rounded-lg border border-themed overflow-hidden bg-themed-secondary/30">
            <div class="max-h-[360px] min-h-[160px] bg-themed-secondary flex items-center justify-center overflow-hidden">
              <img
                v-if="form.popup_promo_image_url"
                :src="form.popup_promo_image_url"
                :alt="selectedPopupPromoPackage?.name || t('admin.system.popupAnnouncement.promoPreview')"
                class="max-h-[360px] max-w-full object-contain"
              />
              <div v-else class="px-6 text-center text-sm text-themed-muted">
                {{ t('admin.system.popupAnnouncement.promoPreviewEmpty') }}
              </div>
            </div>
            <div class="p-4">
              <p class="text-xs text-themed-muted">{{ t('admin.system.popupAnnouncement.promoPreview') }}</p>
              <p class="mt-1 text-sm font-medium text-themed truncate">
                {{ selectedPopupPromoPackage?.name || t('admin.system.popupAnnouncement.promoNoPackage') }}
              </p>
              <button type="button" class="btn-primary w-full mt-3 text-sm" disabled>
                {{ t('popupAnnouncement.buyNow', { name: selectedPopupPromoPackage?.name || t('admin.system.popupAnnouncement.promoPackageFallback') }) }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <template v-else>
        <!-- Registration settings -->
        <div v-if="isAccessSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.registration') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasRegistrationChanges || savingRegistration"
              @click="saveRegistration"
            >
              {{ savingRegistration ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.registrationDesc') }}</p>

          <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50 mb-4">
            <div class="flex-1">
              <label class="text-sm font-medium text-themed">{{ t('admin.system.registrationEnabled') }}</label>
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.registrationEnabledDesc') }}</p>
            </div>
            <div class="flex items-center gap-3 ml-4">
              <span class="text-xs" :class="form.registration_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                {{ t('admin.system.registrationClosed') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.registration_enabled"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.registration_enabled
                    ? 'bg-green-500 focus:ring-green-500'
                    : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                ]"
                @click="form.registration_enabled = !form.registration_enabled"
              >
                <span
                  class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                  :class="form.registration_enabled ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
              <span class="text-xs" :class="form.registration_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                {{ t('admin.system.registrationOpen') }}
              </span>
            </div>
          </div>

          <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50">
            <div class="flex-1">
              <label class="text-sm font-medium text-themed">{{ t('admin.system.requireInviteCode') }}</label>
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.requireInviteCodeDesc') }}</p>
            </div>
            <div class="flex items-center gap-3 ml-4">
              <span class="text-xs" :class="form.require_invite_code ? 'text-themed-muted' : 'text-themed font-medium'">
                {{ t('admin.system.openRegistration') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.require_invite_code"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.require_invite_code
                    ? 'bg-green-500 focus:ring-green-500'
                    : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                ]"
                @click="form.require_invite_code = !form.require_invite_code"
              >
                <span
                  class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                  :class="form.require_invite_code ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
              <span class="text-xs" :class="form.require_invite_code ? 'text-themed font-medium' : 'text-themed-muted'">
                {{ t('admin.system.inviteOnly') }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="isAccessSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">邀请码生成定价</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasInvitePricingChanges || savingInvitePricing"
              @click="saveInvitePricing"
            >
              {{ savingInvitePricing ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">配置普通用户生成一个邀请码需要消耗的资源。当前支持余额和积分，价格保存为可扩展的成本项列表。</p>

          <div class="grid gap-4 lg:grid-cols-2">
            <div
              v-for="option in form.invite_generation_costs"
              :key="option.resource"
              class="rounded-lg bg-themed-secondary/50 p-4"
            >
              <div class="flex items-center justify-between gap-4">
                <div>
                  <label class="text-sm font-medium text-themed">
                    {{ option.resource === 'balance' ? '余额生成' : option.resource === 'points' ? '积分生成' : option.resource }}
                  </label>
                  <p class="mt-1 text-xs text-themed-muted">
                    {{ option.resource === 'balance' ? '用户每生成 1 个邀请码扣除账户余额' : '用户每生成 1 个邀请码扣除积分' }}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="option.enabled"
                  class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                  :class="option.enabled ? 'bg-green-500 focus:ring-green-500' : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'"
                  @click="option.enabled = !option.enabled"
                >
                  <span
                    class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                    :class="option.enabled ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
              </div>

              <div class="mt-4">
                <label class="block text-xs text-themed-muted mb-1.5">
                  {{ option.resource === 'balance' ? '单个价格（元）' : '单个价格（积分）' }}
                </label>
                <div class="relative max-w-xs">
                  <span v-if="option.resource === 'balance'" class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                  <input
                    v-model.number="option.amount"
                    type="number"
                    min="0"
                    :step="option.resource === 'balance' ? '0.01' : '1'"
                    class="input"
                    :class="option.resource === 'balance' ? 'pl-8' : ''"
                  />
                </div>
              </div>
            </div>
          </div>

          <div class="mt-5 space-y-2">
            <label class="block text-sm text-themed-secondary">默认有效期</label>
            <div class="relative max-w-xs">
              <input
                v-model.number="form.invite_default_expire_days"
                type="number"
                min="0"
                max="3650"
                step="1"
                class="input pr-12"
              />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">天</span>
            </div>
            <p class="text-xs text-themed-muted">0 表示用户生成的邀请码永不过期。</p>
          </div>
        </div>

        <div v-if="isHostingSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.hostingFeature.title') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasHostingFeatureChanges || savingHostingFeature"
              @click="saveHostingFeature"
            >
              {{ savingHostingFeature ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.hostingFeature.description') }}</p>

          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50">
              <div class="flex-1">
                <label class="text-sm font-medium text-themed">{{ t('admin.system.hostingFeature.enable') }}</label>
                <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.hostingFeature.enableDesc') }}</p>
              </div>
              <div class="flex items-center gap-3 ml-4">
                <span class="text-xs" :class="form.hosting_feature_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                  {{ t('admin.system.hostingFeature.hiddenForNewUsers') }}
                </span>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="form.hosting_feature_enabled"
                  class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                  :class="[
                    form.hosting_feature_enabled
                      ? 'bg-green-500 focus:ring-green-500'
                      : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                  ]"
                  @click="form.hosting_feature_enabled = !form.hosting_feature_enabled"
                >
                  <span
                    class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                    :class="form.hosting_feature_enabled ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
                <span class="text-xs" :class="form.hosting_feature_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                  {{ t('admin.system.hostingFeature.visibleToAll') }}
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50">
              <div class="flex-1">
                <label class="text-sm font-medium text-themed">{{ t('admin.system.hostingFeature.marketEntry') }}</label>
                <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.hostingFeature.marketEntryDesc') }}</p>
              </div>
              <div class="flex items-center gap-3 ml-4">
                <span class="text-xs" :class="form.hosting_market_entry_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                  {{ t('admin.system.hostingFeature.marketEntryHidden') }}
                </span>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="form.hosting_market_entry_enabled"
                  class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                  :class="[
                    form.hosting_market_entry_enabled
                      ? 'bg-green-500 focus:ring-green-500'
                      : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                  ]"
                  @click="form.hosting_market_entry_enabled = !form.hosting_market_entry_enabled"
                >
                  <span
                    class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                    :class="form.hosting_market_entry_enabled ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
                <span class="text-xs" :class="form.hosting_market_entry_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                  {{ t('admin.system.hostingFeature.marketEntryVisible') }}
                </span>
              </div>
            </div>

            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.hostingFeature.notice') }}
              </label>
              <textarea
                v-model="form.hosting_notice"
                rows="5"
                class="input min-h-[120px] resize-y"
                :placeholder="t('admin.system.hostingFeature.noticePlaceholder')"
              />
              <p class="text-xs text-themed-muted">{{ t('admin.system.hostingFeature.noticeHint') }}</p>
            </div>
          </div>
        </div>

        <!-- Transfer Settings -->
        <div v-if="isAccessSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.transfer.title') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasTransferChanges || savingTransfer"
              @click="saveTransfer"
            >
              {{ savingTransfer ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.transfer.description') }}</p>

          <div class="space-y-2">
            <label class="block text-sm text-themed-secondary">
              {{ t('admin.system.transfer.feeLabel') }}
            </label>
            <div class="relative max-w-xs">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
              <input
                v-model.number="form.transfer_fee"
                type="number"
                min="0"
                :max="MAX_TRANSFER_FEE"
                step="0.01"
                class="input pl-8 pr-12"
                placeholder="0.00"
              />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">
                {{ t('admin.system.transfer.feeUnit') }}
              </span>
            </div>
            <p class="text-xs text-themed-muted">{{ t('admin.system.transfer.feeDesc') }}</p>
          </div>
        </div>

        <!-- Footer Contact Settings -->
        <div v-if="isBrandSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.footerLinks.title') || '底部联系方式' }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasFooterLinkChanges || savingFooterLinks"
              @click="saveFooterLinks"
            >
              {{ savingFooterLinks ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.footerLinks.description') || '配置侧边栏底部的邮箱按钮' }}</p>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.footerLinks.email') || '联系邮箱' }}
              </label>
              <input
                v-model="form.footer_contact_email"
                type="text"
                class="input"
                :placeholder="t('admin.system.footerLinks.emailPlaceholder') || 'support@example.com 或 mailto:support@example.com'"
              />
              <p class="text-xs text-themed-muted">{{ t('admin.system.footerLinks.emailDesc') || '留空则隐藏邮箱按钮；支持填写邮箱地址或完整 mailto: 链接。' }}</p>
            </div>
          </div>
        </div>

        <!-- Brand Settings -->
        <div v-if="isBrandSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.brand.title') || '品牌设置' }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasBrandChanges || savingBrand"
              @click="saveBrand"
            >
              {{ savingBrand ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.brand.description') || '配置站点顶部、登录页、SEO 等位置使用的系统名称与 Logo。留空则使用默认值。' }}</p>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.brand.name') || '系统名称' }}
              </label>
              <input
                v-model="form.brand_name"
                type="text"
                class="input"
                placeholder="Incudal"
              />
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.brand.subtitle') || '网站副标题' }}
              </label>
              <input
                v-model="form.brand_subtitle"
                type="text"
                class="input"
                :placeholder="t('admin.system.brand.subtitlePlaceholder') || '基于 Incus 的低价 NAT VPS'"
              />
              <p class="text-xs text-themed-muted">{{ t('admin.system.brand.subtitleDesc') || '显示在公开站头部/底部、浏览器默认标题和 SEO 默认描述中。' }}</p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.brand.logo') || 'Logo 地址' }}
              </label>
              <input
                v-model="form.brand_logo_url"
                type="text"
                class="input"
                placeholder="/incudal_logo.webp"
              />
              <p class="text-xs text-themed-muted">{{ t('admin.system.brand.logoDesc') || '支持 http(s) 图片地址或站点内绝对路径。' }}</p>
            </div>
          </div>
        </div>

        <!-- Free Site Settings -->
        <div v-if="isHostingSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.freeSite.title') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasFreeSiteChanges || savingFreeSite"
              @click="saveFreeSite"
            >
              {{ savingFreeSite ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.freeSite.description') }}</p>

          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50">
              <div class="flex-1">
                <label class="text-sm font-medium text-themed">{{ t('admin.system.freeSite.enable') }}</label>
                <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.freeSite.enableDesc') }}</p>
              </div>
              <div class="flex items-center gap-3 ml-4">
                <span class="text-xs" :class="form.free_site_mode ? 'text-themed-muted' : 'text-themed font-medium'">
                  {{ t('admin.system.freeSite.disabled') }}
                </span>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="form.free_site_mode"
                  class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                  :class="[
                    form.free_site_mode
                      ? 'bg-green-500 focus:ring-green-500'
                      : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                  ]"
                  @click="toggleFreeSiteMode"
                >
                  <span
                    class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                    :class="form.free_site_mode ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
                <span class="text-xs" :class="form.free_site_mode ? 'text-themed font-medium' : 'text-themed-muted'">
                  {{ t('admin.system.freeSite.enabled') }}
                </span>
              </div>
            </div>

            <div
              class="space-y-4 p-4 rounded-lg bg-themed-secondary/50 transition-opacity"
              :class="form.free_site_mode ? 'opacity-100' : 'opacity-60'"
            >
              <div class="flex items-center justify-between">
                <div class="flex-1">
                  <label class="text-sm font-medium text-themed">{{ t('admin.system.freeSite.registerGift') }}</label>
                  <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.freeSite.registerGiftDesc') }}</p>
                </div>
                <div class="flex items-center gap-3 ml-4">
                  <span class="text-xs" :class="form.free_site_register_gift_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                    {{ t('admin.system.freeSite.giftDisabled') }}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="form.free_site_register_gift_enabled && form.free_site_mode"
                    :disabled="!form.free_site_mode"
                    class="relative inline-flex h-7 w-12 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed"
                    :class="[
                      form.free_site_mode && form.free_site_register_gift_enabled
                        ? 'bg-green-500 focus:ring-green-500 cursor-pointer'
                        : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400',
                      form.free_site_mode ? 'cursor-pointer' : 'cursor-not-allowed'
                    ]"
                    @click="toggleFreeSiteRegisterGift"
                  >
                    <span
                      class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                      :class="form.free_site_mode && form.free_site_register_gift_enabled ? 'translate-x-5' : 'translate-x-0'"
                    />
                  </button>
                  <span class="text-xs" :class="form.free_site_mode && form.free_site_register_gift_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                    {{ t('admin.system.freeSite.giftEnabled') }}
                  </span>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div class="space-y-2">
                  <label class="block text-sm text-themed-secondary">
                    {{ t('admin.system.freeSite.giftBalance') }}
                  </label>
                  <div class="relative">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                    <input
                      v-model.number="form.free_site_register_gift_balance"
                      type="number"
                      min="0"
                      step="0.01"
                      class="input pl-8"
                      placeholder="0.00"
                      :disabled="!form.free_site_mode || !form.free_site_register_gift_enabled"
                    />
                  </div>
                  <p class="text-xs text-themed-muted">{{ t('admin.system.freeSite.giftBalanceDesc') }}</p>
                </div>

                <div class="space-y-2">
                  <label class="block text-sm text-themed-secondary">
                    {{ t('admin.system.freeSite.giftPoints') }}
                  </label>
                  <input
                    v-model.number="form.free_site_register_gift_points"
                    type="number"
                    min="0"
                    step="1"
                    class="input"
                    placeholder="0"
                    :disabled="!form.free_site_mode || !form.free_site_register_gift_enabled"
                  />
                  <p class="text-xs text-themed-muted">{{ t('admin.system.freeSite.giftPointsDesc') }}</p>
                </div>
              </div>

              <p v-if="!form.free_site_mode" class="text-xs text-themed-muted">
                {{ t('admin.system.freeSite.giftRequiresFreeSite') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Ticket Settings -->
        <div v-if="isTicketSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.ticket.title') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasTicketChanges || savingTicket"
              @click="saveTicket"
            >
              {{ savingTicket ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.ticket.description') }}</p>

          <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50">
            <div class="flex-1">
              <label class="text-sm font-medium text-themed">{{ t('admin.system.ticket.enable') }}</label>
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.ticket.enableDesc') }}</p>
            </div>
            <div class="flex items-center gap-3 ml-4">
              <span class="text-xs" :class="form.ticket_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                {{ t('admin.system.ticket.disabled') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.ticket_enabled"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.ticket_enabled
                    ? 'bg-green-500 focus:ring-green-500'
                    : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                ]"
                @click="form.ticket_enabled = !form.ticket_enabled"
              >
                <span
                  class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                  :class="form.ticket_enabled ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
              <span class="text-xs" :class="form.ticket_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                {{ t('admin.system.ticket.enabled') }}
              </span>
            </div>
          </div>
        </div>

        <!-- Ticket Image Settings -->
        <div v-if="isTicketSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.ticketImages.title') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasTicketImageChanges || savingTicketImages"
              @click="saveTicketImages"
            >
              {{ savingTicketImages ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.ticketImages.description') }}</p>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.ticketImages.baseUrl') }}
              </label>
              <input
                v-model="form.ticket_image_lsky_base_url"
                type="text"
                class="input"
                :placeholder="t('admin.system.ticketImages.baseUrlPlaceholder')"
              />
              <p class="text-xs text-themed-muted">{{ t('admin.system.ticketImages.baseUrlDesc') }}</p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.ticketImages.token') }}
              </label>
              <input
                v-model="form.ticket_image_lsky_token"
                type="password"
                class="input"
                :placeholder="t('admin.system.ticketImages.tokenPlaceholder')"
              />
              <p class="text-xs text-themed-muted">{{ t('admin.system.ticketImages.tokenDesc') }}</p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.ticketImages.apiVersion') }}
              </label>
              <select v-model="form.ticket_image_lsky_api_version" class="input">
                <option value="v1">v1</option>
                <option value="v2">v2</option>
              </select>
              <p class="text-xs text-themed-muted">{{ t('admin.system.ticketImages.apiVersionDesc') }}</p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.ticketImages.targetId') }}
              </label>
              <input
                v-model="form.ticket_image_lsky_target_id"
                type="text"
                class="input"
                :placeholder="t('admin.system.ticketImages.targetIdPlaceholder')"
              />
              <p class="text-xs text-themed-muted">{{ t('admin.system.ticketImages.targetIdDesc') }}</p>
            </div>
          </div>
        </div>

        <!-- Default user quota -->
        <div v-if="isAccessSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.defaultQuota') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasQuotaChanges || savingQuota"
              @click="saveQuota"
            >
              {{ savingQuota ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.defaultQuotaDesc') }}</p>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div v-for="(meta, key) in configMeta" :key="key" class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ meta.label }}
              </label>
              <div class="relative">
                <input
                  v-model.number="(form as any)[key]"
                  type="number"
                  min="0"
                  class="input pr-12"
                  :placeholder="meta.label"
                />
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">
                  {{ meta.unit }}
                </span>
              </div>
              <p class="text-xs text-themed-muted">{{ meta.description }}</p>
            </div>
          </div>
        </div>

        <!-- Turnstile Settings -->
        <div v-if="isSecuritySection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.turnstile.title') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasTurnstileChanges || savingTurnstile"
              @click="saveTurnstile"
            >
              {{ savingTurnstile ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.turnstile.description') }}</p>

          <!-- Enable Toggle -->
          <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50 mb-6">
            <div class="flex-1">
              <label class="text-sm font-medium text-themed">{{ t('admin.system.turnstile.enable') }}</label>
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.turnstile.enableDesc') }}</p>
            </div>
            <div class="flex items-center gap-3 ml-4">
              <span class="text-xs" :class="form.turnstile_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                {{ t('admin.system.turnstile.disabled') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.turnstile_enabled"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.turnstile_enabled
                    ? 'bg-green-500 focus:ring-green-500'
                    : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                ]"
                @click="form.turnstile_enabled = !form.turnstile_enabled"
              >
                <span
                  class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                  :class="form.turnstile_enabled ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
              <span class="text-xs" :class="form.turnstile_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                {{ t('admin.system.turnstile.enabled') }}
              </span>
            </div>
          </div>

          <!-- Site Key & Secret Key -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.turnstile.siteKey') }}
              </label>
              <input
                v-model="form.turnstile_site_key"
                type="text"
                class="input"
                :placeholder="t('admin.system.turnstile.siteKeyPlaceholder')"
              />
              <p class="text-xs text-themed-muted">{{ t('admin.system.turnstile.siteKeyDesc') }}</p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.turnstile.secretKey') }}
              </label>
              <input
                v-model="form.turnstile_secret_key"
                type="password"
                class="input"
                :placeholder="t('admin.system.turnstile.secretKeyPlaceholder')"
              />
              <p class="text-xs text-themed-muted">{{ t('admin.system.turnstile.secretKeyDesc') }}</p>
            </div>
          </div>

          <!-- Help Link -->
          <div class="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p class="text-sm text-blue-400">
              💡 {{ t('admin.system.turnstile.helpText') }}
              <a
                href="https://dash.cloudflare.com/?to=/:account/turnstile"
                target="_blank"
                rel="noopener noreferrer"
                class="underline hover:text-blue-300"
              >
                Cloudflare Turnstile Dashboard
              </a>
            </p>
          </div>
        </div>

        <!-- Avatar API Settings -->
        <div v-if="isBrandSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.avatar.title') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasAvatarChanges || savingAvatar"
              @click="saveAvatar"
            >
              {{ savingAvatar ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.avatar.description') }}</p>

          <div class="space-y-2">
            <label class="block text-sm text-themed-secondary">
              {{ t('admin.system.avatar.apiBase') }}
            </label>
            <input
              v-model="form.avatar_api_base"
              type="text"
              class="input"
              placeholder="https://api.dicebear.com/9.x"
            />
            <p class="text-xs text-themed-muted">{{ t('admin.system.avatar.apiBaseDesc') }}</p>
          </div>

          <!-- Help Link -->
          <div class="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p class="text-sm text-blue-400">
              💡 {{ t('admin.system.avatar.helpText') }}
              <a
                href="https://www.dicebear.com/how-to-use/http-api"
                target="_blank"
                rel="noopener noreferrer"
                class="underline hover:text-blue-300"
              >
                DiceBear HTTP API
              </a>
            </p>
          </div>
        </div>

        <!-- SMTP Email Settings -->
        <div v-if="isMailSection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.smtp.title') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasSmtpChanges || savingSmtp"
              @click="saveSmtp"
            >
              {{ savingSmtp ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.smtp.description') }}</p>

          <!-- Enable Toggle -->
          <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50 mb-6">
            <div class="flex-1">
              <label class="text-sm font-medium text-themed">{{ t('admin.system.smtp.enable') }}</label>
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.smtp.enableDesc') }}</p>
            </div>
            <div class="flex items-center gap-3 ml-4">
              <span class="text-xs" :class="form.smtp_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                {{ t('admin.system.smtp.disabled') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.smtp_enabled"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.smtp_enabled
                    ? 'bg-green-500 focus:ring-green-500'
                    : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                ]"
                @click="form.smtp_enabled = !form.smtp_enabled"
              >
                <span
                  class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                  :class="form.smtp_enabled ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
              <span class="text-xs" :class="form.smtp_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                {{ t('admin.system.smtp.enabled') }}
              </span>
            </div>
          </div>

          <!-- SMTP Server Settings -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.smtp.host') }}
              </label>
              <input
                v-model="form.smtp_host"
                type="text"
                class="input"
                :placeholder="t('admin.system.smtp.hostPlaceholder')"
              />
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.smtp.port') }}
              </label>
              <input
                v-model.number="form.smtp_port"
                type="number"
                class="input"
                placeholder="587"
              />
            </div>
          </div>

          <!-- SSL/TLS Toggle -->
          <div class="flex items-center gap-3 mb-6 p-3 rounded-lg bg-themed-secondary/30">
            <input
              id="smtp_secure"
              v-model="form.smtp_secure"
              type="checkbox"
              class="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
            />
            <label for="smtp_secure" class="text-sm text-themed">
              {{ t('admin.system.smtp.secure') }}
            </label>
            <span class="text-xs text-themed-muted">{{ t('admin.system.smtp.secureHint') }}</span>
          </div>

          <!-- Auth Settings -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.smtp.username') }}
              </label>
              <input
                v-model="form.smtp_username"
                type="text"
                class="input"
                :placeholder="t('admin.system.smtp.usernamePlaceholder')"
              />
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.smtp.password') }}
              </label>
              <input
                v-model="form.smtp_password"
                type="password"
                class="input"
                :placeholder="t('admin.system.smtp.passwordPlaceholder')"
              />
            </div>
          </div>

          <!-- From Settings -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.smtp.fromEmail') }}
              </label>
              <input
                v-model="form.smtp_from_email"
                type="email"
                class="input"
                :placeholder="t('admin.system.smtp.fromEmailPlaceholder')"
              />
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('admin.system.smtp.fromName') }}
              </label>
              <input
                v-model="form.smtp_from_name"
                type="text"
                class="input"
                placeholder="Incudal"
              />
            </div>
          </div>

          <!-- Test Connection & Send Test Email -->
          <div class="space-y-4">
            <!-- Test Connection Button -->
            <div class="flex justify-end">
              <button
                type="button"
                class="btn-secondary"
                :disabled="testingSmtp || !form.smtp_host || !form.smtp_username"
                @click="testSmtpConnection"
              >
                {{ testingSmtp ? t('admin.system.smtp.testing') : t('admin.system.smtp.testConnection') }}
              </button>
            </div>

            <!-- Send Test Email -->
            <div class="p-4 rounded-lg bg-themed-secondary/30 border border-themed-border">
              <label class="block text-sm font-medium text-themed mb-2">
                {{ t('admin.system.smtp.sendTestEmail') }}
              </label>
              <p class="text-xs text-themed-muted mb-3">
                {{ t('admin.system.smtp.sendTestEmailDesc') }}
              </p>
              <div class="flex gap-2">
                <input
                  v-model="testEmailTo"
                  type="email"
                  class="input flex-1"
                  :placeholder="t('admin.system.smtp.testEmailPlaceholder')"
                  :disabled="sendingTestEmail"
                />
                <button
                  type="button"
                  class="btn-secondary whitespace-nowrap"
                  :disabled="sendingTestEmail || !testEmailTo || !form.smtp_host || !form.smtp_username"
                  @click="sendTestEmail"
                >
                  {{ sendingTestEmail ? t('admin.system.smtp.sending') : t('admin.system.smtp.send') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Help Link -->
          <div class="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p class="text-sm text-blue-400">
              💡 {{ t('admin.system.smtp.helpText') }}
            </p>
          </div>
        </div>

        <!-- Email Domain Whitelist Settings -->
        <div v-if="isSecuritySection" class="card p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-themed font-medium">{{ t('admin.system.emailDomain.title') }}</h3>
            <button
              type="button"
              class="btn-primary text-sm px-4 py-1.5"
              :disabled="!hasEmailDomainChanges || savingEmailDomain"
              @click="saveEmailDomain"
            >
              {{ savingEmailDomain ? t('admin.system.saving') : t('admin.system.save') }}
            </button>
          </div>
          <p class="text-sm text-themed-muted mb-6">{{ t('admin.system.emailDomain.description') }}</p>

          <!-- Enable Toggle -->
          <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50 mb-6">
            <div class="flex-1">
              <label class="text-sm font-medium text-themed">{{ t('admin.system.emailDomain.enable') }}</label>
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.system.emailDomain.enableDesc') }}</p>
            </div>
            <div class="flex items-center gap-3 ml-4">
              <span class="text-xs" :class="form.email_domain_whitelist_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                {{ t('admin.system.emailDomain.disabled') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.email_domain_whitelist_enabled"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.email_domain_whitelist_enabled
                    ? 'bg-green-500 focus:ring-green-500'
                    : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                ]"
                @click="form.email_domain_whitelist_enabled = !form.email_domain_whitelist_enabled"
              >
                <span
                  class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                  :class="form.email_domain_whitelist_enabled ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
              <span class="text-xs" :class="form.email_domain_whitelist_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                {{ t('admin.system.emailDomain.enabled') }}
              </span>
            </div>
          </div>

          <!-- Allowed Domains -->
          <div class="space-y-2">
            <label class="block text-sm text-themed-secondary">
              {{ t('admin.system.emailDomain.allowedDomains') }}
            </label>
            <textarea
              v-model="form.email_allowed_domains"
              class="input min-h-[120px] font-mono text-sm"
              :placeholder="t('admin.system.emailDomain.allowedDomainsPlaceholder')"
              :disabled="!form.email_domain_whitelist_enabled"
            />
            <p class="text-xs text-themed-muted">{{ t('admin.system.emailDomain.allowedDomainsDesc') }}</p>
          </div>

          <!-- Help Link -->
          <div class="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p class="text-sm text-blue-400">
              💡 {{ t('admin.system.emailDomain.helpText') }}
            </p>
          </div>
        </div>
      </template>
    </div>
    <!-- Notes -->
    <div v-if="isAccessSection" class="card p-6">
      <h3 class="text-themed font-medium mb-4">{{ t('admin.system.notes') }}</h3>
      <div class="space-y-2 text-sm text-themed-secondary">
        <p>• {{ t('admin.system.note1') }}</p>
        <p>• {{ t('admin.system.note2') }}</p>
        <p>• {{ t('admin.system.note3') }}</p>
        <p>• {{ t('admin.system.note4') }}</p>
      </div>
    </div>
  </div>
</template>
