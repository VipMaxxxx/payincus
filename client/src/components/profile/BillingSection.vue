<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import TermsOfServiceModal from '@/components/TermsOfServiceModal.vue'

const { t } = useI18n()
const toast = useToast()

// 余额数据
const balance = ref({
  balance: 0,
  frozen: 0,
  totalRecharge: 0,
  totalConsume: 0
})
const loading = ref(true)

// 余额日志
const logs = ref<any[]>([])
const logsLoading = ref(false)
const logsPage = ref(1)
const logsPageSize = ref(5)
const logsTotal = ref(0)
const showLogs = ref(false)

// 充值弹窗
const showRechargeModal = ref(false)
const rechargeLoading = ref(false)
const providers = ref<any[]>([])
const selectedProvider = ref<number | null>(null)
const rechargeAmount = ref(10)
const agreedToTerms = ref(false)
const showTermsModal = ref(false)
// 支付方式选择
const selectedPaymentMethod = ref<string>('')

// 充值记录
const rechargeRecords = ref<any[]>([])
const recordsLoading = ref(false)
const recordsPage = ref(1)
const recordsPageSize = ref(5)
const recordsTotal = ref(0)
const showRecords = ref(false)

onMounted(() => {
  loadBalance()
})

async function loadBalance() {
  loading.value = true
  try {
    const res = await api.billing.getUserBalance()
    balance.value = res.balance
  } catch (err: any) {
    console.error('Failed to load balance:', err)
  } finally {
    loading.value = false
  }
}

async function loadLogs() {
  logsLoading.value = true
  try {
    const res = await api.billing.getBalanceLogs({
      page: logsPage.value,
      pageSize: logsPageSize.value
    })
    logs.value = res.records || []
    logsTotal.value = res.total
  } catch (err: any) {
    toast.error(t('profile.billing.loadLogsFailed') + ': ' + err.message)
  } finally {
    logsLoading.value = false
  }
}

async function loadProviders() {
  try {
    const res = await api.billing.getPaymentProviders()
    providers.value = res.providers || []
    if (providers.value.length > 0) {
      selectedProvider.value = providers.value[0].id
      // 自动选中第一个支付方式
      updateDefaultPaymentMethod(providers.value[0])
    }
  } catch (err: any) {
    toast.error(t('profile.billing.loadProvidersFailed') + ': ' + err.message)
  }
}

// 更新默认支付方式
function updateDefaultPaymentMethod(provider: any) {
  if (provider?.type === 'heleket') {
    selectedPaymentMethod.value = ''
  } else if (provider && provider.methods && provider.methods.length > 0) {
    selectedPaymentMethod.value = provider.methods[0]
  } else {
    selectedPaymentMethod.value = ''
  }
}

// 监听支付渠道变化，自动更新默认支付方式
watch(selectedProvider, (newProviderId) => {
  if (newProviderId) {
    const provider = providers.value.find(p => p.id === newProviderId)
    updateDefaultPaymentMethod(provider)
  }
})

async function loadRecords() {
  recordsLoading.value = true
  try {
    const res = await api.billing.getRechargeOrders({
      page: recordsPage.value,
      pageSize: recordsPageSize.value
    })
    rechargeRecords.value = res.records || []
    recordsTotal.value = res.total
  } catch (err: any) {
    toast.error(t('profile.billing.loadRecordsFailed') + ': ' + err.message)
  } finally {
    recordsLoading.value = false
  }
}

function toggleLogs() {
  showLogs.value = !showLogs.value
  if (showLogs.value && logs.value.length === 0) {
    loadLogs()
  }
}

function toggleRecords() {
  showRecords.value = !showRecords.value
  if (showRecords.value && rechargeRecords.value.length === 0) {
    loadRecords()
  }
}

function openRechargeModal() {
  rechargeAmount.value = 10
  agreedToTerms.value = false
  loadProviders()
  showRechargeModal.value = true
}

async function createRechargeOrder() {
  if (!selectedProvider.value) {
    toast.error(t('profile.billing.selectProvider'))
    return
  }
  if (rechargeAmount.value <= 0) {
    toast.error(t('profile.billing.invalidAmount'))
    return
  }

  rechargeLoading.value = true
  try {
    // 获取选中的支付方式
    const provider = providers.value.find(p => p.id === selectedProvider.value)
    let paymentMethod = ''
    if (provider && provider.type !== 'heleket' && provider.methods && provider.methods.length > 0) {
      paymentMethod = selectedPaymentMethod.value || provider.methods[0]
    }
    
    const res = await api.billing.createRechargeOrder(selectedProvider.value, rechargeAmount.value, paymentMethod)
    
    // 如果有支付链接，跳转支付
    if (res.payUrl) {
      toast.success(t('profile.billing.redirecting'))
      showRechargeModal.value = false
      // 延迟跳转，让用户看到提示
      const payUrl = res.payUrl
      setTimeout(() => {
        window.location.href = payUrl
      }, 500)
      return
    }
    
    // 如果没有支付链接（如人工充值）
    toast.success(t('profile.billing.orderCreated'))
    showRechargeModal.value = false
    toast.info(`${t('profile.billing.orderNo')}: ${res.order.orderNo}`)
    
    // 刷新记录
    if (showRecords.value) {
      loadRecords()
    }
  } catch (err: any) {
    toast.error(t('profile.billing.createOrderFailed') + ': ' + err.message)
  } finally {
    rechargeLoading.value = false
  }
}

function formatMoney(amount: number): string {
  return `¥${amount.toFixed(2)}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

function getLogTypeName(type: string): string {
  const map: Record<string, string> = {
    recharge: t('profile.billing.logTypes.recharge'),
    consume: t('profile.billing.logTypes.consume'),
    refund: t('profile.billing.logTypes.refund'),
    admin_adjust: t('profile.billing.logTypes.adminAdjust'),
    gift: t('profile.billing.logTypes.gift')
  }
  return map[type] || type
}

function getStatusBadge(status: string): string {
  const map: Record<string, string> = {
    pending: 'badge-warning',
    paid: 'badge-info',
    completed: 'badge-success',
    failed: 'badge-error',
    cancelled: 'badge-ghost',
    refunded: 'badge-ghost'
  }
  return map[status] || ''
}

function getStatusName(status: string): string {
  const map: Record<string, string> = {
    pending: t('profile.billing.status.pending'),
    paid: t('profile.billing.status.paid'),
    completed: t('profile.billing.status.completed'),
    failed: t('profile.billing.status.failed'),
    cancelled: t('profile.billing.status.cancelled'),
    refunded: t('profile.billing.status.refunded')
  }
  return map[status] || status
}

function getPaymentMethodName(method: string): string {
  const key = `wallet.paymentMethods.${method}`
  const translated = t(key)
  if (translated !== key) {
    return translated
  }

  const normalized = method.trim()
  const matched = normalized.match(/^([A-Za-z0-9._-]+)\s*(?:[@:/]\s*([A-Za-z0-9._-]+))?$/)
  if (!matched) {
    return normalized || method
  }

  const currency = matched[1]?.toUpperCase() || normalized
  const network = matched[2]?.toUpperCase()
  return network ? `${currency} (${network})` : currency
}

function getRechargeMethodDisplay(rec: any): string {
  if (rec.actualPaymentMethod) {
    return getPaymentMethodName(rec.actualPaymentMethod)
  }
  if (rec.paymentMethod) {
    return getPaymentMethodName(rec.paymentMethod)
  }
  return ''
}

function getRechargeCreditLabelKey(status: string): string {
  return status === 'completed' ? 'wallet.actualAmount' : 'wallet.estimatedAmount'
}

function getRechargeGatewayStatusText(rec: any): string {
  return rec.status === 'pending' && rec.gatewayStatusDescription ? rec.gatewayStatusDescription : ''
}

const logsTotalPages = computed(() => Math.ceil(logsTotal.value / logsPageSize.value))
const recordsTotalPages = computed(() => Math.ceil(recordsTotal.value / recordsPageSize.value))
const selectedProviderInfo = computed(() => providers.value.find(p => p.id === selectedProvider.value))

function getSelectedPaymentMethodForProvider(provider: any): string {
  if (!provider || provider.type === 'heleket') return ''
  if (!provider.methods || provider.methods.length === 0) return ''
  return selectedPaymentMethod.value || provider.methods[0]
}

function getProviderFeeConfig(provider: any, method?: string): { feeRate: number; feeFixed: number } {
  const methodFee = provider?.type === 'yipay' && method && provider?.methodFees ? provider.methodFees[method] : null
  if (methodFee) {
    return {
      feeRate: Number(methodFee.feeRate || 0),
      feeFixed: Number(methodFee.feeFixed || 0)
    }
  }

  return {
    feeRate: Number(provider?.feeRate || 0),
    feeFixed: Number(provider?.feeFixed || 0)
  }
}

const selectedFeeConfig = computed(() => {
  const provider = selectedProviderInfo.value
  return getProviderFeeConfig(provider, getSelectedPaymentMethodForProvider(provider))
})

const selectedRechargeFee = computed(() => {
  const amount = Number(rechargeAmount.value || 0)
  const feeRate = selectedFeeConfig.value.feeRate
  const feeFixed = selectedFeeConfig.value.feeFixed
  return Math.max(0, Math.round((amount * feeRate + feeFixed) * 100) / 100)
})

const selectedFeeIsSurcharge = computed(() => selectedProviderInfo.value?.type === 'yipay')

const selectedPayableAmount = computed(() => {
  const amount = Number(rechargeAmount.value || 0)
  const total = selectedFeeIsSurcharge.value ? amount + selectedRechargeFee.value : amount
  return Math.max(0, Math.round(total * 100) / 100)
})

const selectedCreditAmount = computed(() => {
  const amount = Number(rechargeAmount.value || 0)
  const total = selectedFeeIsSurcharge.value ? amount : amount - selectedRechargeFee.value
  return Math.max(0, Math.round(total * 100) / 100)
})

// 格式化金额：限制两位小数
function formatAmount() {
  if (rechargeAmount.value) {
    rechargeAmount.value = Math.round(rechargeAmount.value * 100) / 100
  }
}
</script>

<template>
  <div id="billing" class="card p-5">
    <h2 class="text-sm font-medium text-themed-secondary mb-4">{{ $t('profile.billing.title') }}</h2>
    
    <!-- 余额显示 -->
    <div v-if="loading" class="animate-pulse">
      <div class="h-8 bg-themed-secondary rounded w-32"></div>
    </div>
    <div v-else class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-3xl font-bold text-themed">{{ formatMoney(balance.balance) }}</div>
          <div class="text-sm text-themed-muted mt-1">{{ $t('profile.billing.currentBalance') }}</div>
        </div>
        <button class="btn btn-primary" @click="openRechargeModal">
          {{ $t('profile.billing.recharge') }}
        </button>
      </div>

      <!-- 统计信息 -->
      <div class="grid grid-cols-2 gap-4 pt-4 border-t border-themed">
        <div>
          <div class="text-sm text-themed-muted">{{ $t('profile.billing.totalRecharge') }}</div>
          <div class="text-lg font-medium text-green-500">{{ formatMoney(balance.totalRecharge) }}</div>
        </div>
        <div>
          <div class="text-sm text-themed-muted">{{ $t('profile.billing.totalConsume') }}</div>
          <div class="text-lg font-medium text-red-500">{{ formatMoney(balance.totalConsume) }}</div>
        </div>
      </div>

      <!-- 展开区域 -->
      <div class="pt-4 border-t border-themed space-y-3">
        <!-- 余额日志 -->
        <div>
          <button
            class="w-full flex items-center justify-between text-left text-sm"
            @click="toggleLogs"
          >
            <span class="text-themed-muted">{{ $t('profile.billing.balanceLogs') }}</span>
            <svg
              class="w-4 h-4 text-themed-muted transition-transform"
              :class="{ 'rotate-180': showLogs }"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          <div v-show="showLogs" class="mt-3">
            <div v-if="logsLoading" class="text-center py-4 text-themed-muted">
              {{ $t('common.loading') }}...
            </div>
            <div v-else-if="logs.length > 0" class="space-y-2">
              <div
                v-for="log in logs"
                :key="log.id"
                class="flex items-center justify-between py-2 border-b border-themed last:border-0"
              >
                <div>
                  <div class="text-sm text-themed">{{ getLogTypeName(log.type) }}</div>
                  <div class="text-xs text-themed-muted">{{ formatDate(log.createdAt) }}</div>
                </div>
                <div :class="log.amount >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ log.amount >= 0 ? '+' : '' }}{{ formatMoney(log.amount) }}
                </div>
              </div>
              
              <!-- 分页 -->
              <div v-if="logsTotalPages > 1" class="flex justify-center gap-2 pt-2">
                <button
                  class="btn btn-xs btn-ghost"
                  :disabled="logsPage <= 1"
                  @click="logsPage--; loadLogs()"
                >
                  {{ $t('common.prev') }}
                </button>
                <span class="text-xs text-themed-muted self-center">{{ logsPage }}/{{ logsTotalPages }}</span>
                <button
                  class="btn btn-xs btn-ghost"
                  :disabled="logsPage >= logsTotalPages"
                  @click="logsPage++; loadLogs()"
                >
                  {{ $t('common.next') }}
                </button>
              </div>
            </div>
            <div v-else class="text-center py-4 text-themed-muted text-sm">
              {{ $t('profile.billing.noLogs') }}
            </div>
          </div>
        </div>

        <!-- 充值记录 -->
        <div>
          <button
            class="w-full flex items-center justify-between text-left text-sm"
            @click="toggleRecords"
          >
            <span class="text-themed-muted">{{ $t('profile.billing.rechargeRecords') }}</span>
            <svg
              class="w-4 h-4 text-themed-muted transition-transform"
              :class="{ 'rotate-180': showRecords }"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          <div v-show="showRecords" class="mt-3">
            <div v-if="recordsLoading" class="text-center py-4 text-themed-muted">
              {{ $t('common.loading') }}...
            </div>
            <div v-else-if="rechargeRecords.length > 0" class="space-y-2">
              <div
                v-for="rec in rechargeRecords"
                :key="rec.id"
                class="flex items-start justify-between gap-3 py-2 border-b border-themed last:border-0"
              >
                <div class="min-w-0">
                  <div class="text-sm text-themed">{{ formatMoney(rec.amount) }}</div>
                  <div class="text-xs text-themed-muted">{{ formatDate(rec.createdAt) }}</div>
                  <div v-if="rec.provider?.name || getRechargeMethodDisplay(rec)" class="text-xs text-themed-muted">
                    {{ rec.provider?.name || '-' }}<span v-if="getRechargeMethodDisplay(rec)"> · {{ getRechargeMethodDisplay(rec) }}</span>
                  </div>
                  <div v-if="rec.actualAmount !== null" class="text-xs text-themed-muted">
                    {{ $t(getRechargeCreditLabelKey(rec.status)) }} {{ formatMoney(rec.actualAmount) }}
                  </div>
                  <div v-if="getRechargeGatewayStatusText(rec)" class="text-xs text-themed-muted">
                    {{ getRechargeGatewayStatusText(rec) }}
                  </div>
                  <div v-if="rec.paymentUuid" class="truncate text-xs text-themed-muted" :title="rec.paymentUuid">
                    {{ $t('wallet.paymentUuid') }} {{ rec.paymentUuid }}
                  </div>
                  <div v-if="rec.paymentTxid" class="truncate text-xs text-themed-muted" :title="rec.paymentTxid">
                    {{ $t('wallet.paymentTxid') }} {{ rec.paymentTxid }}
                  </div>
                  <div v-if="rec.completedAt" class="text-xs text-themed-muted">
                    {{ $t('wallet.completedAt') }} {{ formatDate(rec.completedAt) }}
                  </div>
                </div>
                <span :class="['badge badge-sm', getStatusBadge(rec.status)]">
                  {{ getStatusName(rec.status) }}
                </span>
              </div>
              
              <!-- 分页 -->
              <div v-if="recordsTotalPages > 1" class="flex justify-center gap-2 pt-2">
                <button
                  class="btn btn-xs btn-ghost"
                  :disabled="recordsPage <= 1"
                  @click="recordsPage--; loadRecords()"
                >
                  {{ $t('common.prev') }}
                </button>
                <span class="text-xs text-themed-muted self-center">{{ recordsPage }}/{{ recordsTotalPages }}</span>
                <button
                  class="btn btn-xs btn-ghost"
                  :disabled="recordsPage >= recordsTotalPages"
                  @click="recordsPage++; loadRecords()"
                >
                  {{ $t('common.next') }}
                </button>
              </div>
            </div>
            <div v-else class="text-center py-4 text-themed-muted text-sm">
              {{ $t('profile.billing.noRecords') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 充值弹窗 -->
    <Teleport to="body">
      <div v-if="showRechargeModal" class="modal-overlay" @click.self="showRechargeModal = false">
        <div class="modal-content max-w-sm">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('profile.billing.recharge') }}</h3>
            <button class="btn btn-ghost btn-sm" @click="showRechargeModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="modal-body space-y-4">
            <!-- 支付渠道选择 -->
            <div>
              <label class="label">{{ $t('profile.billing.paymentMethod') }}</label>
              <div v-if="providers.length === 0" class="text-themed-muted text-sm">
                {{ $t('profile.billing.noProviders') }}
              </div>
              <div v-else class="grid grid-cols-2 gap-2">
                <button
                  v-for="p in providers"
                  :key="p.id"
                  class="p-3 rounded-lg border-2 text-sm transition-colors"
                  :class="selectedProvider === p.id 
                    ? 'border-blue-500 bg-blue-500/10' 
                    : 'border-themed hover:border-gray-400'"
                  @click="selectedProvider = p.id; selectedPaymentMethod = ''"
                >
                  {{ p.name }}
                </button>
              </div>
            </div>

            <!-- 支付方式选择（仅当渠道支持多种方式时显示） -->
            <div v-if="selectedProviderInfo && selectedProviderInfo.type !== 'heleket' && selectedProviderInfo.methods && selectedProviderInfo.methods.length > 1">
              <label class="label">{{ $t('wallet.paymentMethodType') }}</label>
              <div class="grid grid-cols-3 gap-2">
                <button
                  v-for="method in selectedProviderInfo.methods"
                  :key="method"
                  class="p-2 rounded-lg border-2 text-xs transition-colors flex items-center justify-center gap-1"
                  :class="selectedPaymentMethod === method || (!selectedPaymentMethod && selectedProviderInfo.methods[0] === method)
                    ? 'border-blue-500 bg-blue-500/10' 
                    : 'border-themed hover:border-gray-400'"
                  @click="selectedPaymentMethod = method"
                >
                  {{ getPaymentMethodName(method) }}
                </button>
              </div>
            </div>

            <div v-else-if="selectedProviderInfo?.type === 'heleket'" class="text-xs text-themed-muted rounded-lg bg-themed-secondary px-3 py-2">
              {{ $t('wallet.heleketSelectionHint') }}
            </div>

            <!-- 充值金额 -->
            <div>
              <label class="label">{{ $t('profile.billing.amount') }}</label>
              <div class="grid grid-cols-4 gap-2 mb-2">
                <button
                  v-for="amt in [10, 50, 100, 200]"
                  :key="amt"
                  class="btn btn-sm"
                  :class="rechargeAmount === amt ? 'btn-primary' : 'btn-ghost'"
                  @click="rechargeAmount = amt"
                >
                  ¥{{ amt }}
                </button>
              </div>
              <input
                v-model.number="rechargeAmount"
                type="number"
                class="input w-full"
                :min="selectedProviderInfo?.minAmount || 1"
                :max="selectedProviderInfo?.maxAmount || undefined"
                step="0.01"
                @blur="formatAmount"
              />
              <div v-if="selectedProviderInfo" class="text-xs text-themed-muted mt-1">
                {{ $t('profile.billing.amountRange') }}: 
                {{ selectedProviderInfo.minAmount.toFixed(2) }} - 
                {{ selectedProviderInfo.maxAmount ? selectedProviderInfo.maxAmount.toFixed(2) : $t('common.unlimited') }}
              </div>
            </div>

            <!-- 费用预览 -->
            <div v-if="selectedProviderInfo && selectedRechargeFee > 0" class="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              <div>
                {{ $t('profile.billing.feeNote') }}:
                <span v-if="selectedFeeConfig.feeRate > 0" class="font-medium">{{ (selectedFeeConfig.feeRate * 100).toFixed(2) }}%</span>
                <span v-if="selectedFeeConfig.feeRate > 0 && selectedFeeConfig.feeFixed > 0"> + </span>
                <span v-if="selectedFeeConfig.feeFixed > 0" class="font-medium">¥{{ selectedFeeConfig.feeFixed.toFixed(2) }}</span>
                <span class="font-medium"> = ¥{{ selectedRechargeFee.toFixed(2) }}</span>
              </div>
              <div class="mt-1">
                {{ $t('wallet.payableAmount') }}:
                <span class="font-semibold">¥{{ selectedPayableAmount.toFixed(2) }}</span>
                <span class="text-themed-muted"> / {{ $t('wallet.actualAmount') }} ¥{{ selectedCreditAmount.toFixed(2) }}</span>
              </div>
            </div>

            <!-- 服务条款勾选 -->
            <div class="flex items-start gap-2">
              <input
                id="agree-terms-billing"
                v-model="agreedToTerms"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 bg-transparent"
              />
              <label for="agree-terms-billing" class="text-xs text-themed-muted leading-relaxed">
                {{ $t('auth.tos.agreePrefix') }}
                <button
                  type="button"
                  class="text-blue-500 hover:text-blue-400 hover:underline"
                  @click="showTermsModal = true"
                >
                  {{ $t('auth.tos.termsLink') }}
                </button>
              </label>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showRechargeModal = false">{{ $t('common.cancel') }}</button>
            <button
              class="btn btn-primary"
              :disabled="rechargeLoading || !selectedProvider || rechargeAmount <= 0 || !agreedToTerms"
              @click="createRechargeOrder"
            >
              {{ rechargeLoading ? $t('common.processing') : $t('profile.billing.pay') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 服务条款弹窗 -->
    <TermsOfServiceModal
      :show="showTermsModal"
      @close="showTermsModal = false"
    />
  </div>
</template>
