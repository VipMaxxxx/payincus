<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'

const { t } = useI18n()
const toast = useToast()

const props = withDefaults(defineProps<{
  embedded?: boolean
}>(), {
  embedded: false
})

// 转化申请列表
interface AffWithdrawal {
  id: number
  userId: number
  username: string
  userAffBalance: number
  amount: number
  status: string
  rejectReason: string | null
  reviewedBy: number | null
  createdAt: string
  reviewedAt: string | null
}

const withdrawals = ref<AffWithdrawal[]>([])
const loading = ref(true)
const page = ref(1)
const pageSize = ref(100)
const total = ref(0)
const statusFilter = ref('')

// 操作状态
const approveLoading = ref<number | null>(null)
const showRejectModal = ref(false)
const rejectTarget = ref<AffWithdrawal | null>(null)
const rejectReason = ref('')
const rejectLoading = ref(false)

onMounted(() => {
  loadWithdrawals()
})

async function loadWithdrawals() {
  loading.value = true
  try {
    const res = await api.aff.adminGetWithdrawals({
      page: page.value,
      pageSize: pageSize.value,
      status: statusFilter.value || undefined
    })
    withdrawals.value = (res as any).withdrawals || []
    total.value = (res as any).total || 0
  } catch (err: any) {
    toast.error(t('common.loadFailed') + ': ' + err.message)
  } finally {
    loading.value = false
  }
}

async function approveWithdrawal(w: AffWithdrawal) {
  approveLoading.value = w.id
  try {
    await api.aff.adminApprove(w.id)
    toast.success(t('aff.approveSuccess'))
    loadWithdrawals()
  } catch (err: any) {
    toast.error(t('aff.approveFailed') + ': ' + err.message)
  } finally {
    approveLoading.value = null
  }
}

function openRejectModal(w: AffWithdrawal) {
  rejectTarget.value = w
  rejectReason.value = ''
  showRejectModal.value = true
}

async function submitReject() {
  if (!rejectTarget.value || !rejectReason.value.trim()) {
    toast.error(t('aff.rejectReasonPlaceholder'))
    return
  }
  rejectLoading.value = true
  try {
    await api.aff.adminReject(rejectTarget.value.id, rejectReason.value.trim())
    toast.success(t('aff.rejectSuccess'))
    showRejectModal.value = false
    loadWithdrawals()
  } catch (err: any) {
    toast.error(t('aff.rejectFailed') + ': ' + err.message)
  } finally {
    rejectLoading.value = false
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

function formatMoney(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return `¥${num.toFixed(2)}`
}

function getStatusBadge(status: string): string {
  const map: Record<string, string> = {
    pending: 'badge-warning',
    approved: 'badge-success',
    rejected: 'badge-error'
  }
  return map[status] || ''
}

function getStatusName(status: string): string {
  const map: Record<string, string> = {
    pending: t('aff.withdrawalStatus.pending'),
    approved: t('aff.withdrawalStatus.approved'),
    rejected: t('aff.withdrawalStatus.rejected')
  }
  return map[status] || status
}

const totalPages = computed(() => Math.ceil(total.value / pageSize.value))
</script>

<template>
  <div :class="['animate-fade-in', props.embedded ? 'space-y-4' : '']">
    <!-- 页面头部 -->
    <div class="page-header">
      <h1 class="page-title">{{ $t('aff.adminTitle') }}</h1>
      <p class="text-sm text-themed-muted mt-1">{{ $t('aff.adminDescription') }}</p>
    </div>

    <!-- 筛选栏 -->
    <div class="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div class="flex items-center gap-2">
        <label class="text-sm text-themed-muted">{{ $t('aff.filterStatus') }}:</label>
        <select
          v-model="statusFilter"
          class="input min-w-32 px-3 py-1.5 text-sm"
          @change="page = 1; loadWithdrawals()"
        >
          <option value="">{{ $t('aff.all') }}</option>
          <option value="pending">{{ $t('aff.withdrawalStatus.pending') }}</option>
          <option value="approved">{{ $t('aff.withdrawalStatus.approved') }}</option>
          <option value="rejected">{{ $t('aff.withdrawalStatus.rejected') }}</option>
        </select>
      </div>
      <button class="btn btn-sm btn-ghost" @click="loadWithdrawals">
        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {{ $t('common.refresh') }}
      </button>
    </div>

    <!-- 列表 -->
    <div class="card">
      <div v-if="loading" class="p-8 text-center text-themed-muted">
        {{ $t('common.loading') }}...
      </div>
      <div v-else-if="withdrawals.length === 0" class="p-8 text-center text-themed-muted">
        {{ $t('aff.noRequests') }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[960px]">
          <thead>
            <tr class="border-b border-themed text-left text-sm text-themed-muted">
              <th class="px-4 py-3 font-medium">ID</th>
              <th class="px-4 py-3 font-medium">{{ $t('aff.user') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('aff.requestAmount') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('aff.userBalance') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('aff.status') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('aff.requestTime') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('aff.rejectReason') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr v-for="w in withdrawals" :key="w.id" class="hover:bg-themed-hover">
              <td class="px-4 py-3 text-sm text-themed font-mono">#{{ w.id }}</td>
              <td class="px-4 py-3">
                <div class="text-sm text-themed font-medium">{{ w.username }}</div>
                <div class="text-xs text-themed-muted">ID: {{ w.userId }}</div>
              </td>
              <td class="px-4 py-3 text-sm font-medium text-themed">{{ formatMoney(w.amount) }}</td>
              <td class="px-4 py-3 text-sm text-themed-muted">{{ formatMoney(w.userAffBalance) }}</td>
              <td class="px-4 py-3">
                <span :class="['badge badge-sm', getStatusBadge(w.status)]">
                  {{ getStatusName(w.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-themed-muted">{{ formatDate(w.createdAt) }}</td>
              <td class="px-4 py-3 text-sm text-themed-muted">{{ w.rejectReason || '-' }}</td>
              <td class="px-4 py-3">
                <template v-if="w.status === 'pending'">
                  <div class="flex flex-wrap gap-2">
                    <button
                      class="btn btn-xs btn-success"
                      :disabled="approveLoading === w.id"
                      @click="approveWithdrawal(w)"
                    >
                      {{ approveLoading === w.id ? $t('common.processing') : $t('aff.approve') }}
                    </button>
                    <button
                      class="btn btn-xs btn-ghost text-red-500 hover:bg-red-500/10"
                      @click="openRejectModal(w)"
                    >
                      {{ $t('aff.reject') }}
                    </button>
                  </div>
                </template>
                <template v-else>
                  <span class="text-themed-muted">-</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 分页 -->
        <div v-if="totalPages > 1" class="flex justify-center items-center gap-2 p-4 border-t border-themed">
          <button
            class="btn btn-sm btn-ghost"
            :disabled="page <= 1"
            @click="page--; loadWithdrawals()"
          >
            {{ $t('common.prevPage') }}
          </button>
          <span class="text-sm text-themed-muted">{{ page }} / {{ totalPages }}</span>
          <button
            class="btn btn-sm btn-ghost"
            :disabled="page >= totalPages"
            @click="page++; loadWithdrawals()"
          >
            {{ $t('common.nextPage') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 拒绝弹窗 -->
    <Teleport to="body">
      <div v-if="showRejectModal" class="modal-overlay" @click.self="showRejectModal = false">
        <div class="modal-content max-w-md">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('aff.reject') }}</h3>
            <button class="btn btn-ghost btn-sm rounded-full" @click="showRejectModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="modal-body space-y-4">
            <div v-if="rejectTarget" class="p-3 bg-themed-secondary rounded-lg">
              <div class="text-sm text-themed-muted">{{ $t('aff.user') }}: {{ rejectTarget.username }}</div>
              <div class="text-sm text-themed-muted">{{ $t('aff.requestAmount') }}: {{ formatMoney(rejectTarget.amount) }}</div>
            </div>
            
            <div>
              <label class="label text-sm mb-2">{{ $t('aff.rejectReason') }} *</label>
              <textarea
                v-model="rejectReason"
                class="input w-full h-24 resize-none"
                :placeholder="$t('aff.rejectReasonPlaceholder')"
              ></textarea>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showRejectModal = false">{{ $t('common.cancel') }}</button>
            <button
              class="btn btn-error"
              :disabled="rejectLoading || !rejectReason.trim()"
              @click="submitReject"
            >
              {{ rejectLoading ? $t('common.processing') : $t('aff.reject') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
