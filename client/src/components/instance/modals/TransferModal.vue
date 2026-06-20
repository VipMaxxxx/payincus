<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { useConfigStore } from '@/stores/config'
import { translateError } from '@/utils/errorHandler'

const props = defineProps<{
  show: boolean
  instance: {
    id: number
    name: string
    cpu: number
    memory: number
    disk: number
  }
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success'): void
}>()

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const configStore = useConfigStore()

// 表单状态
const targetUsername = ref('')
const remark = ref('')
const searchLoading = ref(false)
const transferLoading = ref(false)
const searchError = ref('')

// 用户余额
const userBalance = ref<number>(0)
const loadingBalance = ref(false)

// 目标用户信息
interface TargetUser {
  id: number
  username: string
  status: string
}
const targetUser = ref<TargetUser | null>(null)



// 转移手续费（从配置获取）
const transferFee = computed(() => configStore.transferFee || 0)

// 余额是否足够
const hasEnoughBalance = computed(() => {
  if (transferFee.value <= 0) return true
  return userBalance.value >= transferFee.value
})

// 用户状态检查（用户存在且未被封禁且余额足够）
const canTransfer = computed(() => {
  return targetUser.value !== null && targetUser.value.status === 'active' && hasEnoughBalance.value
})

// 弹窗打开时加载余额
watch(() => props.show, async (show) => {
  if (show) {
    // 加载用户余额
    if (transferFee.value > 0) {
      loadingBalance.value = true
      try {
        const res = await api.billing.getUserBalance()
        userBalance.value = res.balance.balance
      } catch {
        userBalance.value = 0
      } finally {
        loadingBalance.value = false
      }
    }
  } else {
    // 关闭时重置
    targetUsername.value = ''
    remark.value = ''
    targetUser.value = null
    searchError.value = ''
    userBalance.value = 0
  }
})

async function searchUser() {
  if (!targetUsername.value.trim()) return
  
  searchLoading.value = true
  searchError.value = ''
  targetUser.value = null
  
  try {
    const response = await api.transfers.searchUser(targetUsername.value.trim())
    targetUser.value = response.user
  } catch (error: any) {
    if (error?.code === 'USER_NOT_FOUND') {
      searchError.value = t('transfer.modal.userNotFound')
    } else if (error?.code === 'TRANSFER_TO_SELF') {
      searchError.value = t('transfer.modal.cannotTransferToSelf')
    } else if (error?.code === 'TRANSFER_TO_BANNED') {
      searchError.value = t('transfer.modal.userBanned')
    } else {
      searchError.value = error?.message || t('common.error')
    }
  } finally {
    searchLoading.value = false
  }
}

async function handleTransfer() {
  if (!targetUser.value || !canTransfer.value) return
  
  transferLoading.value = true
  try {
    await api.transfers.create(props.instance.id, targetUser.value.username, remark.value || undefined)
    toast.success(t('transfer.messages.transferSuccess'))
    emit('success')
    emit('close')
  } catch (error: any) {
    toast.error(translateError(error))
  } finally {
    transferLoading.value = false
  }
}


function formatMemory(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

// 硬盘格式化（1024进制）
function formatDisk(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}
</script>

<template>
  <div 
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @click.self="emit('close')"
  >
    <div 
      class="w-full max-w-lg p-6 rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
      :class="themeStore.isDark ? 'bg-gray-900' : 'bg-white'"
    >
      <h3 class="text-lg font-medium mb-4">{{ $t('transfer.modal.title') }}</h3>
      
      <div class="space-y-4">
        <!-- Instance Info -->
        <div 
          class="p-3 rounded-lg"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
        >
          <div class="font-medium">{{ instance.name }}</div>
          <div class="text-sm text-gray-500 mt-1">
            {{ instance.cpu }}% CPU · {{ formatMemory(instance.memory) }} · {{ formatDisk(instance.disk) }}
          </div>
        </div>

        <!-- Target User Search -->
        <div>
          <label class="block text-sm font-medium mb-1">{{ $t('transfer.modal.targetUser') }}</label>
          <div class="flex gap-2">
            <input
              v-model="targetUsername"
              type="text"
              class="input flex-1"
              :placeholder="$t('transfer.modal.targetUserPlaceholder')"
              @keyup.enter="searchUser"
            />
            <button 
              class="btn-secondary"
              :disabled="searchLoading || !targetUsername.trim()"
              @click="searchUser"
            >
              {{ searchLoading ? '...' : $t('transfer.modal.searchUser') }}
            </button>
          </div>
          <p v-if="searchError" class="text-sm text-red-500 mt-1">{{ searchError }}</p>
        </div>

        <!-- Target User Info -->
        <div 
          v-if="targetUser"
          class="p-4 rounded-lg border"
          :class="themeStore.isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'"
        >
          <div class="flex items-center justify-between mb-2">
            <div class="font-medium">{{ targetUser.username }}</div>
            <span 
              :class="[
                'badge',
                targetUser.status === 'active' ? 'badge-success' : 'badge-danger'
              ]"
            >
              {{ targetUser.status === 'active' ? t('admin.users.active') : t('admin.users.banned') }}
            </span>
          </div>

          <!-- User Status Check -->
          <div 
            v-if="canTransfer"
            class="mt-2 p-2 rounded text-sm"
            :class="themeStore.isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700'"
          >
            {{ $t('transfer.modal.canTransfer') }}
          </div>
        </div>

        <!-- Remark -->
        <div>
          <label class="block text-sm font-medium mb-1">{{ $t('transfer.modal.remark') }}</label>
          <textarea
            v-model="remark"
            class="input w-full h-20 resize-none"
            :placeholder="$t('transfer.modal.remarkPlaceholder')"
          ></textarea>
        </div>

        <!-- Transfer Fee Info -->
        <div 
          v-if="transferFee > 0"
          class="p-3 rounded-lg text-sm space-y-2"
          :class="themeStore.isDark ? 'bg-blue-900/20 border border-blue-800' : 'bg-blue-50 border border-blue-200'"
        >
          <div class="flex items-center justify-between">
            <span :class="themeStore.isDark ? 'text-blue-300' : 'text-blue-700'">
              {{ $t('transfer.modal.feeLabel') }}
            </span>
            <span class="font-medium" :class="themeStore.isDark ? 'text-blue-200' : 'text-blue-800'">
              ¥{{ transferFee.toFixed(2) }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span :class="themeStore.isDark ? 'text-blue-300' : 'text-blue-700'">
              {{ $t('transfer.modal.balanceLabel') }}
            </span>
            <span 
              class="font-medium"
              :class="hasEnoughBalance 
                ? (themeStore.isDark ? 'text-green-400' : 'text-green-600')
                : (themeStore.isDark ? 'text-red-400' : 'text-red-600')"
            >
              <template v-if="loadingBalance">...</template>
              <template v-else>¥{{ userBalance.toFixed(2) }}</template>
            </span>
          </div>
          <!-- Insufficient Balance Warning -->
          <div 
            v-if="!hasEnoughBalance && !loadingBalance"
            class="pt-2 border-t"
            :class="themeStore.isDark ? 'border-red-800' : 'border-red-200'"
          >
            <p class="text-red-500">{{ $t('transfer.modal.insufficientBalance') }}</p>
          </div>
          <!-- Fee Refund Hint -->
          <p 
            class="text-xs"
            :class="themeStore.isDark ? 'text-blue-400/70' : 'text-blue-600/70'"
          >
            {{ $t('transfer.modal.feeRefundHint') }}
          </p>
        </div>

        <!-- Warning -->
        <div 
          class="p-3 rounded-lg text-sm"
          :class="themeStore.isDark ? 'bg-yellow-900/30 text-yellow-300' : 'bg-yellow-50 text-yellow-800'"
        >
          <div class="flex items-start gap-2">
            <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{{ $t('transfer.modal.deleteWarning') }}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 pt-2">
          <button class="btn-ghost" @click="emit('close')">
            {{ $t('common.cancel') }}
          </button>
          <button 
            class="btn-primary"
            :disabled="!targetUser || !canTransfer || transferLoading"
            @click="handleTransfer"
          >
            {{ transferLoading ? $t('transfer.modal.transferring') : $t('transfer.modal.confirmTransfer') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
