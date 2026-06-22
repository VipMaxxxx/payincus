<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import SkeletonLoader from '@/components/SkeletonLoader.vue'

const props = withDefaults(defineProps<{
  embedded?: boolean
}>(), {
  embedded: false
})

const { t } = useI18n()
const toast = useToast()

// 支付渠道列表
const providers = ref<any[]>([])
const loading = ref(true)

// 编辑/创建弹窗
const showModal = ref(false)
const isEditing = ref(false)
const modalLoading = ref(false)
const formData = ref({
  id: 0,
  name: '',
  type: 'yipay',
  config: {
    apiurl: '',
    pid: '',
    platform_public_key: '',
    merchant_private_key: ''
  } as Record<string, unknown>,
  methods: [] as string[],
  minAmount: 1,
  maxAmount: null as number | null,
  feeRate: 0,
  feeFixed: 0,
  sortOrder: 0
})

const DEFAULT_YIPAY_METHODS = ['alipay', 'wxpay']
const YIPAY_METHODS = ['alipay', 'wxpay', 'qqpay']
const IMPLEMENTED_PROVIDER_TYPES = new Set(['yipay', 'heleket'])

function getConfigMethodFees(config: Record<string, unknown>): Record<string, { feeRate?: number; feeFixed?: number }> {
  const raw = (config as any).methodFees
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  return raw as Record<string, { feeRate?: number; feeFixed?: number }>
}

function getYipayMethodFeePercent(method: string): number {
  const methodFees = getConfigMethodFees(formData.value.config)
  const feeRate = methodFees[method]?.feeRate !== undefined
    ? Number(methodFees[method]?.feeRate || 0)
    : Number(formData.value.feeRate || 0) / 100
  return Number.isFinite(feeRate) ? Number((feeRate * 100).toFixed(2)) : 0
}

function setYipayMethodFeePercent(method: string, value: string | number) {
  const percent = Number(value)
  const feeRate = Number.isFinite(percent) && percent > 0 ? percent / 100 : 0
  const methodFees = {
    ...getConfigMethodFees(formData.value.config),
    [method]: {
      ...getConfigMethodFees(formData.value.config)[method],
      feeRate
    }
  }
  formData.value.config = {
    ...formData.value.config,
    methodFees
  }
}

function getProviderMethodFeePercent(provider: any, method: string): number {
  const methodFees = getConfigMethodFees(provider.config || {})
  const feeRate = methodFees[method]?.feeRate !== undefined
    ? Number(methodFees[method]?.feeRate || 0)
    : Number(provider.feeRate || 0)
  return Number.isFinite(feeRate) ? feeRate * 100 : 0
}

function getProviderMethodSummary(provider: any): string {
  const methods = provider.methods || []
  if (provider.type !== 'yipay' || methods.length === 0) {
    return methods.join(', ') || '-'
  }

  return methods.map((method: string) => {
    const percent = getProviderMethodFeePercent(provider, method)
    const name = t(`wallet.paymentMethods.${method}`)
    const label = name === `wallet.paymentMethods.${method}` ? method : name
    return percent > 0 ? `${label} (${percent.toFixed(2)}%)` : label
  }).join(', ')
}

function getSecretPlaceholder(key: string, fallback: string): string {
  return isEditing.value && (formData.value.config as any)[`${key}Configured`]
    ? t('admin.paymentProviders.config.secretKeepPlaceholder')
    : fallback
}

function getSecretHint(key: string, fallback: string): string {
  const configuredHint = isEditing.value && (formData.value.config as any)[`${key}Configured`]
    ? `${t('admin.paymentProviders.config.secretKeepHint')} `
    : ''
  return `${configuredHint}${fallback}`.trim()
}

// 支付渠道类型选项
const providerTypes = computed(() => [
  { value: 'yipay', label: t('admin.paymentProviders.providerTypes.yipay') },
  { value: 'heleket', label: t('admin.paymentProviders.providerTypes.heleket') },
  { value: 'stripe', label: t('admin.paymentProviders.providerTypes.stripe') },
  { value: 'alipay_direct', label: t('admin.paymentProviders.providerTypes.alipayDirect') },
  { value: 'wechat_direct', label: t('admin.paymentProviders.providerTypes.wechatDirect') },
  { value: 'manual', label: t('admin.paymentProviders.providerTypes.manual') }
].map(option => {
  const implemented = IMPLEMENTED_PROVIDER_TYPES.has(option.value)
  return {
    ...option,
    disabled: !implemented,
    label: implemented ? option.label : `${option.label} (${t('admin.paymentProviders.notImplemented')})`
  }
}))

// 状态选项
const statusOptions = computed(() => [
  { value: 'active', label: t('admin.paymentProviders.statusActive'), class: 'badge-success' },
  { value: 'disabled', label: t('admin.paymentProviders.statusDisabled'), class: 'badge-error' },
  { value: 'testing', label: t('admin.paymentProviders.statusTesting'), class: 'badge-warning' }
])

// 删除确认弹窗
const showDeleteModal = ref(false)
const deleteTarget = ref<any>(null)
const deleteLoading = ref(false)

onMounted(() => {
  loadProviders()
})

async function loadProviders() {
  loading.value = true
  try {
    const res = await api.admin.getPaymentProviders()
    providers.value = res.providers || []
  } catch (err: any) {
    toast.error(t('admin.paymentProviders.loadFailed') + ': ' + err.message)
  } finally {
    loading.value = false
  }
}

// 根据渠道类型获取默认配置
function getDefaultConfig(type: string, version?: string): Record<string, unknown> {
  switch (type) {
    case 'yipay':
      if (version === 'v1') {
        return {
          version: 'v1',
          apiurl: '',
          pid: '',
          key: '',
          methodFees: {}
        }
      }
      return {
        version: 'v2',
        apiurl: '',
        pid: '',
        platform_public_key: '',
        merchant_private_key: '',
        methodFees: {}
      }
    case 'heleket':
      return {
        apiurl: 'https://api.heleket.com',
        merchant_uuid: '',
        api_key: '',
        currency: 'CNY',
        lifetime: 3600
      }
    case 'stripe':
      return {
        publishable_key: '',
        secret_key: '',
        webhook_secret: ''
      }
    case 'alipay_direct':
      return {
        app_id: '',
        private_key: '',
        public_key: ''
      }
    case 'wechat_direct':
      return {
        app_id: '',
        mch_id: '',
        api_key: '',
        cert_path: '',
        key_path: ''
      }
    case 'manual':
      return {
        instructions: ''
      }
    default:
      return {}
  }
}

function getDefaultMethods(type: string): string[] {
  switch (type) {
    case 'yipay':
      return [...DEFAULT_YIPAY_METHODS]
    default:
      return []
  }
}

function handleProviderTypeChange(type: string) {
  formData.value.config = getDefaultConfig(type)
  formData.value.methods = getDefaultMethods(type)
}

function openCreateModal() {
  isEditing.value = false
  formData.value = {
    id: 0,
    name: '',
    type: 'yipay',
    config: getDefaultConfig('yipay', 'v2'),
    methods: getDefaultMethods('yipay'),
    minAmount: 1,
    maxAmount: null,
    feeRate: 0,
    feeFixed: 0,
    sortOrder: 0
  }
  showModal.value = true
}

function openEditModal(provider: any) {
  isEditing.value = true
  // 确保 config 字段有默认值
  const version = provider.config?.version || 'v2'
  const defaultConfig = getDefaultConfig(provider.type, version)
  const mergedConfig = { ...defaultConfig, ...(provider.config || {}) }
  
  formData.value = {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    config: mergedConfig,
    methods: provider.methods?.length ? provider.methods : getDefaultMethods(provider.type),
    minAmount: provider.minAmount,
    maxAmount: provider.maxAmount,
    feeRate: provider.feeRate * 100, // 转换为百分比显示
    feeFixed: provider.feeFixed,
    sortOrder: provider.sortOrder
  }
  showModal.value = true
}

function buildConfigForSave(): Record<string, unknown> {
  if (formData.value.type !== 'yipay') {
    return formData.value.config
  }

  const sourceFees = getConfigMethodFees(formData.value.config)
  const methodFees: Record<string, { feeRate: number; feeFixed: number }> = {}
  const globalFallbackRate = Number(formData.value.feeRate || 0) / 100
  const globalFallbackFixed = Number(formData.value.feeFixed || 0)
  for (const method of formData.value.methods) {
    const feeRate = sourceFees[method]?.feeRate !== undefined
      ? Number(sourceFees[method]?.feeRate || 0)
      : globalFallbackRate
    const feeFixed = sourceFees[method]?.feeFixed !== undefined
      ? Number(sourceFees[method]?.feeFixed || 0)
      : globalFallbackFixed
    methodFees[method] = {
      feeRate: Number.isFinite(feeRate) && feeRate > 0 ? feeRate : 0,
      feeFixed: Number.isFinite(feeFixed) && feeFixed > 0 ? feeFixed : 0
    }
  }

  return {
    ...formData.value.config,
    methodFees
  }
}

async function saveProvider() {
  if (!formData.value.name.trim()) {
    toast.error(t('admin.paymentProviders.nameRequired'))
    return
  }
  
  modalLoading.value = true
  try {
    const data = {
      name: formData.value.name.trim(),
      type: formData.value.type,
      config: buildConfigForSave(),
      methods: formData.value.methods,
      minAmount: formData.value.minAmount,
      maxAmount: formData.value.maxAmount,
      feeRate: formData.value.type === 'yipay' ? 0 : formData.value.feeRate / 100, // 转换回小数
      feeFixed: formData.value.type === 'yipay' ? 0 : formData.value.feeFixed,
      sortOrder: formData.value.sortOrder
    }
    
    if (isEditing.value) {
      await api.admin.updatePaymentProvider(formData.value.id, data)
      toast.success(t('admin.paymentProviders.updateSuccess'))
    } else {
      await api.admin.createPaymentProvider(data)
      toast.success(t('admin.paymentProviders.createSuccess'))
    }
    
    showModal.value = false
    await loadProviders()
  } catch (err: any) {
    toast.error((isEditing.value ? t('admin.paymentProviders.updateFailed') : t('admin.paymentProviders.createFailed')) + ': ' + err.message)
  } finally {
    modalLoading.value = false
  }
}

async function updateStatus(provider: any, newStatus: string) {
  try {
    await api.admin.updatePaymentProviderStatus(provider.id, newStatus)
    toast.success(t('admin.paymentProviders.statusUpdateSuccess'))
    await loadProviders()
  } catch (err: any) {
    toast.error(t('admin.paymentProviders.statusUpdateFailed') + ': ' + err.message)
  }
}

function confirmDelete(provider: any) {
  deleteTarget.value = provider
  showDeleteModal.value = true
}

async function deleteProvider() {
  if (!deleteTarget.value) return
  
  deleteLoading.value = true
  try {
    await api.admin.deletePaymentProvider(deleteTarget.value.id)
    toast.success(t('admin.paymentProviders.deleteSuccess'))
    showDeleteModal.value = false
    deleteTarget.value = null
    await loadProviders()
  } catch (err: any) {
    toast.error(t('admin.paymentProviders.deleteFailed') + ': ' + err.message)
  } finally {
    deleteLoading.value = false
  }
}

function getTypeName(type: string): string {
  return providerTypes.value.find(t => t.value === type)?.label || type
}

function getStatusInfo(status: string) {
  return statusOptions.value.find(s => s.value === status) || { label: status, class: '' }
}

function togglePaymentMethod(method: string) {
  const index = formData.value.methods.indexOf(method)
  if (index === -1) {
    formData.value.methods.push(method)
  } else {
    formData.value.methods.splice(index, 1)
  }
}
</script>

<template>
  <div :class="['animate-fade-in', props.embedded ? 'space-y-4' : '']">
    <!-- 页面头部 -->
    <div class="page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="page-title">{{ $t('admin.paymentProviders.title') }}</h1>
        <p class="text-sm text-themed-muted mt-1">{{ $t('admin.paymentProviders.description') }}</p>
      </div>
      <button class="btn btn-primary" @click="openCreateModal">
        <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ $t('admin.paymentProviders.add') }}
      </button>
    </div>

    <!-- 加载中 -->
    <SkeletonLoader v-if="loading" :count="3" />

    <!-- 支付渠道列表 -->
    <div v-else-if="providers.length > 0" class="space-y-4">
      <div
        v-for="provider in providers"
        :key="provider.id"
        class="card p-4"
      >
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-3">
              <h3 class="font-medium text-themed">{{ provider.name }}</h3>
              <span :class="['badge', getStatusInfo(provider.status).class]">
                {{ getStatusInfo(provider.status).label }}
              </span>
              <span class="badge badge-info">{{ getTypeName(provider.type) }}</span>
            </div>
            
            <div class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span class="text-themed-muted">{{ $t('admin.paymentProviders.minAmount') }}:</span>
                <span class="ml-1 text-themed">¥{{ provider.minAmount }}</span>
              </div>
              <div>
                <span class="text-themed-muted">{{ $t('admin.paymentProviders.maxAmount') }}:</span>
                <span class="ml-1 text-themed">{{ provider.maxAmount ? `¥${provider.maxAmount}` : $t('common.unlimited') }}</span>
              </div>
              <div>
                <span class="text-themed-muted">{{ $t('admin.paymentProviders.feeRate') }}:</span>
                <span class="ml-1 text-themed">{{ (provider.feeRate * 100).toFixed(2) }}%</span>
              </div>
              <div>
                <span class="text-themed-muted">{{ $t('admin.paymentProviders.feeFixed') }}:</span>
                <span class="ml-1 text-themed">¥{{ provider.feeFixed }}</span>
              </div>
            </div>
            
            <div class="mt-2 text-xs text-themed-muted">
              {{ $t('admin.paymentProviders.methods') }}: {{ getProviderMethodSummary(provider) }}
            </div>
          </div>
          
          <div class="flex flex-wrap items-center gap-2 lg:ml-4 lg:justify-end">
            <!-- 状态切换 -->
            <select
              :value="provider.status"
              class="input input-sm w-24"
              @change="(e) => updateStatus(provider, (e.target as HTMLSelectElement).value)"
            >
              <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
            
            <button class="btn btn-sm btn-ghost" @click="openEditModal(provider)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            
            <button class="btn btn-sm btn-ghost text-red-500" @click="confirmDelete(provider)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="card p-12 text-center">
      <svg class="w-16 h-16 mx-auto text-themed-muted opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
      <p class="mt-4 text-themed-muted">{{ $t('admin.paymentProviders.empty') }}</p>
      <button class="btn btn-primary mt-4" @click="openCreateModal">
        {{ $t('admin.paymentProviders.add') }}
      </button>
    </div>

    <!-- 创建/编辑弹窗 -->
    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
        <div class="modal-content max-w-lg">
          <div class="modal-header">
            <h3 class="modal-title">
              {{ isEditing ? $t('admin.paymentProviders.edit') : $t('admin.paymentProviders.add') }}
            </h3>
            <button class="btn btn-ghost btn-sm" @click="showModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body space-y-4">
            <div>
              <label class="label">{{ $t('admin.paymentProviders.name') }} *</label>
              <input v-model="formData.name" type="text" class="input w-full" :placeholder="$t('admin.paymentProviders.namePlaceholder')" />
            </div>
            
            <div>
              <label class="label">{{ $t('admin.paymentProviders.type') }}</label>
              <select v-model="formData.type" class="input w-full" :disabled="isEditing" @change="handleProviderTypeChange(formData.type)">
                <option v-for="opt in providerTypes" :key="opt.value" :value="opt.value" :disabled="opt.disabled">
                  {{ opt.label }}
                </option>
              </select>
            </div>
            
            <!-- 易支付配置 -->
            <template v-if="formData.type === 'yipay'">
              <!-- 版本选择 -->
              <div>
                <label class="label">{{ $t('admin.paymentProviders.config.sdkVersion') }} *</label>
                <select 
                  v-model="(formData.config as any).version" 
                  class="input w-full"
                  @change="formData.config = getDefaultConfig('yipay', (formData.config as any).version)"
                >
                  <option value="v1">{{ $t('admin.paymentProviders.config.yipayVersionV1') }}</option>
                  <option value="v2">{{ $t('admin.paymentProviders.config.yipayVersionV2') }}</option>
                </select>
                <p class="text-xs text-themed-muted mt-1">
                  {{ (formData.config as any).version === 'v1' 
                    ? $t('admin.paymentProviders.config.yipayVersionV1Hint')
                    : $t('admin.paymentProviders.config.yipayVersionV2Hint')
                  }}
                </p>
              </div>

              <div>
                <label class="label">{{ $t('admin.paymentProviders.config.apiurl') }} *</label>
                <input v-model="(formData.config as any).apiurl" type="text" class="input w-full" :placeholder="$t('admin.paymentProviders.config.yipayApiUrlPlaceholder')" />
                <p class="text-xs text-themed-muted mt-1">{{ $t('admin.paymentProviders.config.yipayApiUrlHint') }}</p>
              </div>
              <div>
                <label class="label">{{ $t('admin.paymentProviders.config.pid') }} *</label>
                <input v-model="(formData.config as any).pid" type="text" class="input w-full" :placeholder="$t('admin.paymentProviders.config.yipayPidPlaceholder')" />
              </div>

              <!-- V1 版本: MD5密钥 -->
              <template v-if="(formData.config as any).version === 'v1'">
                <div>
                  <label class="label">{{ $t('admin.paymentProviders.config.key') }} *</label>
                  <input v-model="(formData.config as any).key" type="password" class="input w-full font-mono" :placeholder="getSecretPlaceholder('key', $t('admin.paymentProviders.config.yipayKeyPlaceholder'))" />
                  <p class="text-xs text-themed-muted mt-1">{{ getSecretHint('key', $t('admin.paymentProviders.config.yipayKeyHint')) }}</p>
                </div>
              </template>

              <!-- V2 版本: RSA密钥对 -->
              <template v-else>
                <div>
                  <label class="label">{{ $t('admin.paymentProviders.config.platformPublicKey') }} *</label>
                  <textarea v-model="(formData.config as any).platform_public_key" class="input w-full h-24 resize-none font-mono text-xs" :placeholder="$t('admin.paymentProviders.config.platformPublicKeyPlaceholder')"></textarea>
                  <p class="text-xs text-themed-muted mt-1">{{ $t('admin.paymentProviders.config.platformPublicKeyHint') }}</p>
                </div>
                <div>
                  <label class="label">{{ $t('admin.paymentProviders.config.merchantPrivateKey') }} *</label>
                  <textarea v-model="(formData.config as any).merchant_private_key" class="input w-full h-24 resize-none font-mono text-xs" :placeholder="getSecretPlaceholder('merchant_private_key', $t('admin.paymentProviders.config.merchantPrivateKeyPlaceholder'))"></textarea>
                  <p class="text-xs text-themed-muted mt-1">{{ getSecretHint('merchant_private_key', $t('admin.paymentProviders.config.merchantPrivateKeyHint')) }}</p>
                </div>
              </template>

              <!-- 支付方式选择（V1/V2通用） -->
              <div>
                <label class="label">{{ $t('admin.paymentProviders.paymentMethods') }}</label>
                <div class="mt-2 space-y-2">
                  <div
                    v-for="method in YIPAY_METHODS"
                    :key="method"
                    class="rounded-lg border border-themed p-3"
                  >
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          :checked="formData.methods.includes(method)"
                          class="checkbox checkbox-primary"
                          @change="togglePaymentMethod(method)"
                        />
                        <span class="text-themed">{{ $t(`wallet.paymentMethods.${method}`) }}</span>
                      </label>
                      <div class="flex items-center gap-2 sm:w-44">
                        <span class="whitespace-nowrap text-xs text-themed-muted">{{ $t('admin.paymentProviders.feeRate') }}</span>
                        <input
                          :value="getYipayMethodFeePercent(method)"
                          type="number"
                          class="input w-full"
                          min="0"
                          max="100"
                          step="0.01"
                          :disabled="!formData.methods.includes(method)"
                          @input="setYipayMethodFeePercent(method, ($event.target as HTMLInputElement).value)"
                        />
                        <span class="text-sm text-themed-muted">%</span>
                      </div>
                    </div>
                  </div>
                </div>
                <p class="text-xs text-themed-muted mt-1">{{ $t('admin.paymentProviders.config.yipayMethodsHint') }}</p>
                <p class="text-xs text-themed-muted mt-1">{{ $t('admin.paymentProviders.config.yipayMethodFeeHint') }}</p>
              </div>
            </template>

            <!-- Heleket 配置 -->
            <template v-else-if="formData.type === 'heleket'">
              <div>
                <label class="label">{{ $t('admin.paymentProviders.config.apiurl') }} *</label>
                <input v-model="(formData.config as any).apiurl" type="text" class="input w-full" placeholder="https://api.heleket.com" />
                <p class="text-xs text-themed-muted mt-1">{{ $t('admin.paymentProviders.config.heleketApiUrlHint') }}</p>
              </div>
              <div>
                <label class="label">{{ $t('admin.paymentProviders.config.heleketMerchantUuid') }} *</label>
                <input v-model="(formData.config as any).merchant_uuid" type="text" class="input w-full font-mono" :placeholder="$t('admin.paymentProviders.config.heleketMerchantUuid')" />
              </div>
              <div>
                <label class="label">{{ $t('admin.paymentProviders.config.heleketApiKey') }} *</label>
                <input v-model="(formData.config as any).api_key" type="password" class="input w-full font-mono" :placeholder="getSecretPlaceholder('api_key', $t('admin.paymentProviders.config.heleketApiKey'))" />
                <p class="text-xs text-themed-muted mt-1">{{ getSecretHint('api_key', '') }}</p>
              </div>
              <div>
                <label class="label">{{ $t('admin.paymentProviders.config.heleketInvoiceCurrency') }}</label>
                <input v-model="(formData.config as any).currency" type="text" class="input w-full uppercase" placeholder="CNY" />
                <p class="text-xs text-themed-muted mt-1">{{ $t('admin.paymentProviders.config.heleketCurrencyHint') }}</p>
              </div>
              <div>
                <label class="label">{{ $t('admin.paymentProviders.config.heleketLifetime') }}</label>
                <input v-model.number="(formData.config as any).lifetime" type="number" class="input w-full" min="300" max="43200" step="1" placeholder="3600" />
                <p class="text-xs text-themed-muted mt-1">{{ $t('admin.paymentProviders.config.heleketLifetimeHint') }}</p>
              </div>
            </template>
            
            <!-- Stripe 配置 -->
            <template v-else-if="formData.type === 'stripe'">
              <div>
                <label class="label">Publishable Key *</label>
                <input v-model="(formData.config as any).publishable_key" type="text" class="input w-full" placeholder="pk_live_..." />
              </div>
              <div>
                <label class="label">Secret Key *</label>
                <input v-model="(formData.config as any).secret_key" type="password" class="input w-full" placeholder="sk_live_..." />
              </div>
              <div>
                <label class="label">Webhook Secret</label>
                <input v-model="(formData.config as any).webhook_secret" type="password" class="input w-full" placeholder="whsec_..." />
              </div>
            </template>
            
            <!-- 支付宝直连配置 -->
            <template v-else-if="formData.type === 'alipay_direct'">
              <div>
                <label class="label">App ID *</label>
                <input v-model="(formData.config as any).app_id" type="text" class="input w-full" />
              </div>
              <div>
                <label class="label">应用私钥 *</label>
                <textarea v-model="(formData.config as any).private_key" class="input w-full h-24 resize-none font-mono text-xs"></textarea>
              </div>
              <div>
                <label class="label">支付宝公钥 *</label>
                <textarea v-model="(formData.config as any).public_key" class="input w-full h-24 resize-none font-mono text-xs"></textarea>
              </div>
            </template>
            
            <!-- 微信直连配置 -->
            <template v-else-if="formData.type === 'wechat_direct'">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="label">App ID *</label>
                  <input v-model="(formData.config as any).app_id" type="text" class="input w-full" />
                </div>
                <div>
                  <label class="label">商户号 *</label>
                  <input v-model="(formData.config as any).mch_id" type="text" class="input w-full" />
                </div>
              </div>
              <div>
                <label class="label">API 密钥 *</label>
                <input v-model="(formData.config as any).api_key" type="password" class="input w-full" />
              </div>
            </template>
            
            <!-- 人工充值配置 -->
            <template v-else-if="formData.type === 'manual'">
              <div>
                <label class="label">{{ $t('admin.paymentProviders.config.instructions') }}</label>
                <textarea v-model="(formData.config as any).instructions" class="input w-full h-24 resize-none" :placeholder="$t('admin.paymentProviders.config.instructionsPlaceholder')"></textarea>
              </div>
            </template>
            
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="label">{{ $t('admin.paymentProviders.minAmount') }}</label>
                <input v-model.number="formData.minAmount" type="number" class="input w-full" min="0" step="0.01" />
              </div>
              <div>
                <label class="label">{{ $t('admin.paymentProviders.maxAmount') }}</label>
                <input v-model.number="formData.maxAmount" type="number" class="input w-full" min="0" step="0.01" :placeholder="$t('common.unlimited')" />
              </div>
            </div>
            
            <div v-if="formData.type !== 'yipay'" class="grid grid-cols-2 gap-4">
              <div>
                <label class="label">{{ $t('admin.paymentProviders.feeRate') }} (%)</label>
                <input v-model.number="formData.feeRate" type="number" class="input w-full" min="0" max="100" step="0.01" />
              </div>
              <div>
                <label class="label">{{ $t('admin.paymentProviders.feeFixed') }}</label>
                <input v-model.number="formData.feeFixed" type="number" class="input w-full" min="0" step="0.01" />
              </div>
            </div>
            <div v-else class="rounded-lg bg-themed-secondary px-3 py-2 text-xs text-themed-muted">
              {{ $t('admin.paymentProviders.config.yipayFeeFieldHint') }}
            </div>
            
            <div>
              <label class="label">{{ $t('admin.paymentProviders.sortOrder') }}</label>
              <input v-model.number="formData.sortOrder" type="number" class="input w-full" min="0" />
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showModal = false">{{ $t('common.cancel') }}</button>
            <button class="btn btn-primary" :disabled="modalLoading" @click="saveProvider">
              {{ modalLoading ? $t('common.saving') : $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
        <div class="modal-content max-w-sm">
          <div class="modal-header">
            <h3 class="modal-title text-red-500">{{ $t('admin.paymentProviders.deleteConfirm') }}</h3>
          </div>
          <div class="modal-body">
            <p class="text-themed-secondary">
              {{ $t('admin.paymentProviders.deleteWarning', { name: deleteTarget?.name }) }}
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showDeleteModal = false">{{ $t('common.cancel') }}</button>
            <button class="btn btn-error" :disabled="deleteLoading" @click="deleteProvider">
              {{ deleteLoading ? $t('common.deleting') : $t('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
