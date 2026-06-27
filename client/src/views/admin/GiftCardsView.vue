<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type { GiftCardRecord, GiftCardStats, GiftCardStatus } from '@/types/api'

const { t, locale } = useI18n()
const toast = useToast()

const records = ref<GiftCardRecord[]>([])
const stats = ref<GiftCardStats | null>(null)
const loading = ref(false)
const saving = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const statusFilter = ref<GiftCardStatus | ''>('')
const revealCode = ref(false)
const batchResult = ref<{ batchId: string; codes: GiftCardRecord[] } | null>(null)

const form = ref({
  faceValue: 10,
  balanceValue: null as number | null,
  count: 1,
  expiresAt: '',
  remark: ''
})

const selectedCount = computed(() => selectedIds.value.size)
const statusOptions = computed<Array<{ value: GiftCardStatus | ''; label: string }>>(() => [
  { value: '', label: t('giftCards.status.all') },
  { value: 'active', label: t('giftCards.status.active') },
  { value: 'used', label: t('giftCards.status.used') },
  { value: 'disabled', label: t('giftCards.status.disabled') },
  { value: 'expired', label: t('giftCards.status.expired') }
])

function formatMoney(value: number): string {
  return new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2
  }).format(value || 0)
}

function formatDate(value?: string | null): string {
  if (!value) return t('giftCards.neverExpires')
  return new Date(value).toLocaleString(locale.value)
}

function statusLabel(status: GiftCardStatus): string {
  return t(`giftCards.status.${status}`)
}

function statusClass(status: GiftCardStatus): string {
  return {
    active: 'text-green-500',
    used: 'text-themed-muted',
    disabled: 'text-yellow-500',
    expired: 'text-red-500'
  }[status]
}

async function loadData(): Promise<void> {
  loading.value = true
  try {
    const [listResponse, statsResponse] = await Promise.all([
      api.giftCards.list({
        page: 1,
        pageSize: 100,
        status: statusFilter.value || undefined,
        revealCode: revealCode.value
      }),
      api.giftCards.stats()
    ])
    records.value = listResponse.records
    stats.value = statsResponse
    selectedIds.value = new Set()
  } catch (err: any) {
    toast.error(t('giftCardsAdmin.toast.loadFailed', { message: err?.message || String(err) }))
  } finally {
    loading.value = false
  }
}

async function createCards(): Promise<void> {
  const count = Number(form.value.count)
  const faceValue = Number(form.value.faceValue)
  const balanceValue = form.value.balanceValue === null || form.value.balanceValue === undefined
    ? undefined
    : Number(form.value.balanceValue)
  if (!Number.isFinite(faceValue) || faceValue <= 0 || !Number.isSafeInteger(count) || count < 1) {
    toast.warning(t('giftCardsAdmin.toast.invalidCreateForm'))
    return
  }

  saving.value = true
  try {
    const payload = {
      faceValue,
      balanceValue,
      expiresAt: form.value.expiresAt || null,
      remark: form.value.remark.trim() || undefined
    }
    if (count === 1) {
      const response = await api.giftCards.generate(payload)
      batchResult.value = { batchId: '', codes: [response.giftCard] }
      toast.success(t('giftCardsAdmin.toast.created'))
    } else {
      const response = await api.giftCards.batch({ ...payload, count })
      batchResult.value = { batchId: response.batchId, codes: response.codes }
      toast.success(t('giftCardsAdmin.toast.batchCreated', { count: response.count }))
    }
    await loadData()
  } catch (err: any) {
    toast.error(t('giftCardsAdmin.toast.createFailed', { message: err?.message || String(err) }))
  } finally {
    saving.value = false
  }
}

async function updateCardStatus(card: GiftCardRecord): Promise<void> {
  try {
    if (card.status === 'disabled') {
      await api.giftCards.enable(card.id)
      toast.success(t('giftCardsAdmin.toast.enabled'))
    } else {
      await api.giftCards.disable(card.id)
      toast.success(t('giftCardsAdmin.toast.disabled'))
    }
    await loadData()
  } catch (err: any) {
    toast.error(t('giftCardsAdmin.toast.updateFailed', { message: err?.message || String(err) }))
  }
}

async function deleteCard(card: GiftCardRecord): Promise<void> {
  if (!confirm(t('giftCardsAdmin.confirm.deleteOne', { code: card.codeMasked || card.code }))) return
  try {
    await api.giftCards.delete(card.id)
    toast.success(t('giftCardsAdmin.toast.deleted'))
    await loadData()
  } catch (err: any) {
    toast.error(t('giftCardsAdmin.toast.deleteFailed', { message: err?.message || String(err) }))
  }
}

async function batchDisable(): Promise<void> {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0 || !confirm(t('giftCardsAdmin.confirm.disableSelected', { count: ids.length }))) return
  try {
    const response = await api.giftCards.batchDisable(ids)
    toast.success(t('giftCardsAdmin.toast.batchDisabled', { count: response.count }))
    await loadData()
  } catch (err: any) {
    toast.error(t('giftCardsAdmin.toast.batchDisableFailed', { message: err?.message || String(err) }))
  }
}

async function batchDelete(): Promise<void> {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0 || !confirm(t('giftCardsAdmin.confirm.deleteSelected', { count: ids.length }))) return
  try {
    const response = await api.giftCards.batchDelete(ids)
    toast.success(t('giftCardsAdmin.toast.batchDeleted', { count: response.count }))
    await loadData()
  } catch (err: any) {
    toast.error(t('giftCardsAdmin.toast.batchDeleteFailed', { message: err?.message || String(err) }))
  }
}

function toggleSelected(id: number, checked: boolean): void {
  const next = new Set(selectedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedIds.value = next
}

async function copyCodes(codes: GiftCardRecord[]): Promise<void> {
  await navigator.clipboard.writeText(codes.map(card => card.code).join('\n'))
  toast.success(t('giftCards.toast.copied'))
}

onMounted(loadData)
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('giftCardsAdmin.title') }}</h1>
        <p class="page-description">{{ t('giftCardsAdmin.description') }}</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadData">
        {{ loading ? t('giftCards.loading') : t('giftCards.refresh') }}
      </button>
    </div>

    <div v-if="stats" class="grid gap-4 md:grid-cols-4">
      <div class="card p-4">
        <div class="text-sm text-themed-muted">{{ t('giftCardsAdmin.stats.active') }}</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.active }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">{{ t('giftCardsAdmin.stats.used') }}</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.used }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">{{ t('giftCardsAdmin.stats.outstanding') }}</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ formatMoney(stats.outstandingValue) }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">{{ t('giftCardsAdmin.stats.redeemed') }}</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ formatMoney(stats.totalRedeemedValue) }}</div>
      </div>
    </div>

    <section class="card p-6">
      <h2 class="text-base font-semibold text-themed">{{ t('giftCardsAdmin.generateTitle') }}</h2>
      <div class="mt-4 grid gap-4 lg:grid-cols-6">
        <label class="space-y-1">
          <span class="text-xs font-medium text-themed-muted">{{ t('giftCardsAdmin.faceValueLabel') }}</span>
          <input v-model.number="form.faceValue" class="input" type="number" min="0.01" max="10000" step="0.01" :placeholder="t('giftCardsAdmin.faceValuePlaceholder')" />
        </label>
        <label class="space-y-1">
          <span class="text-xs font-medium text-themed-muted">{{ t('giftCardsAdmin.balanceValueLabel') }}</span>
          <input v-model.number="form.balanceValue" class="input" type="number" min="0.01" max="10000" step="0.01" :placeholder="t('giftCardsAdmin.balanceValuePlaceholder')" />
        </label>
        <label class="space-y-1">
          <span class="text-xs font-medium text-themed-muted">{{ t('giftCardsAdmin.countLabel') }}</span>
          <input v-model.number="form.count" class="input" type="number" min="1" max="500" step="1" :placeholder="t('giftCardsAdmin.countPlaceholder')" />
        </label>
        <label class="space-y-1 lg:col-span-2">
          <span class="text-xs font-medium text-themed-muted">{{ t('giftCardsAdmin.expiresAtLabel') }}</span>
          <input v-model="form.expiresAt" class="input" type="datetime-local" />
        </label>
        <label class="space-y-1 lg:col-span-5">
          <span class="text-xs font-medium text-themed-muted">{{ t('giftCardsAdmin.remarkLabel') }}</span>
          <input v-model="form.remark" class="input" maxlength="200" :placeholder="t('giftCards.remarkPlaceholder')" />
        </label>
        <div class="flex items-end">
          <button class="btn-primary w-full" :disabled="saving" @click="createCards">
            {{ saving ? t('giftCards.generating') : t('giftCards.generate') }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="batchResult" class="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
      <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div class="font-medium">{{ t('giftCardsAdmin.batchResultTitle') }}</div>
          <div v-if="batchResult.batchId" class="mt-1 text-xs">{{ t('giftCardsAdmin.batchId', { batchId: batchResult.batchId }) }}</div>
        </div>
        <button class="btn-secondary btn-sm" @click="copyCodes(batchResult.codes)">{{ t('giftCardsAdmin.copyAll') }}</button>
      </div>
      <pre class="mt-3 max-h-56 overflow-auto rounded bg-white/70 p-3 font-mono text-xs">{{ batchResult.codes.map(card => card.code).join('\n') }}</pre>
    </section>

    <section class="card p-6">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-col gap-3 sm:flex-row">
          <select v-model="statusFilter" class="input w-full sm:w-44" @change="loadData">
            <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
          <label class="flex h-10 items-center gap-2 text-sm text-themed">
            <input v-model="revealCode" type="checkbox" class="h-4 w-4 rounded text-accent" @change="loadData" />
            {{ t('giftCardsAdmin.revealCode') }}
          </label>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" :disabled="selectedCount === 0" @click="batchDisable">{{ t('giftCardsAdmin.batchDisable') }}</button>
          <button class="btn-ghost text-error" :disabled="selectedCount === 0" @click="batchDelete">{{ t('giftCardsAdmin.batchDelete') }}</button>
        </div>
      </div>

      <div class="mt-5 space-y-3 md:hidden">
        <div v-for="card in records" :key="card.id" class="rounded-lg border border-themed bg-themed-surface p-4">
          <div class="flex items-start gap-3">
            <input type="checkbox" class="mt-1 h-4 w-4 rounded text-accent" :checked="selectedIds.has(card.id)" @change="toggleSelected(card.id, ($event.target as HTMLInputElement).checked)" />
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-3">
                <code class="break-all font-mono text-xs text-themed">{{ card.code }}</code>
                <span class="shrink-0 text-sm" :class="statusClass(card.status)">{{ statusLabel(card.status) }}</span>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div class="text-xs text-themed-muted">{{ t('giftCards.amount') }}</div>
                  <div class="font-medium text-themed">{{ formatMoney(card.balanceValue) }}</div>
                  <div class="text-xs text-themed-muted">{{ t('giftCardsAdmin.faceValue', { amount: formatMoney(card.faceValue) }) }}</div>
                </div>
                <div>
                  <div class="text-xs text-themed-muted">{{ t('giftCards.expiresAt') }}</div>
                  <div class="text-themed">{{ formatDate(card.expiresAt) }}</div>
                </div>
              </div>
              <div class="mt-3 space-y-1 text-xs text-themed-muted">
                <div>{{ t('giftCardsAdmin.createdBy', { user: card.createdBy?.username || '-' }) }}</div>
                <div>{{ t('giftCardsAdmin.owner', { user: card.owner?.username || '-' }) }}</div>
                <div>{{ t('giftCardsAdmin.usedBy', { user: card.usedBy?.username || '-' }) }}</div>
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                <button v-if="card.status === 'active' || card.status === 'disabled'" class="btn-secondary btn-sm" @click="updateCardStatus(card)">
                  {{ card.status === 'disabled' ? t('giftCardsAdmin.enable') : t('giftCardsAdmin.disable') }}
                </button>
                <button v-if="card.status !== 'used'" class="btn-danger btn-sm" @click="deleteCard(card)">{{ t('giftCardsAdmin.delete') }}</button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="!loading && records.length === 0" class="py-8 text-center text-themed-muted">{{ t('giftCards.empty') }}</div>
      </div>

      <div class="mt-5 hidden overflow-x-auto md:block">
        <table class="min-w-full text-sm">
          <thead class="border-b border-themed text-left text-themed-muted">
            <tr>
              <th class="py-3 pr-4"></th>
              <th class="py-3 pr-4">{{ t('giftCards.code') }}</th>
              <th class="py-3 pr-4">{{ t('giftCards.amount') }}</th>
              <th class="py-3 pr-4">{{ t('giftCards.statusTitle') }}</th>
              <th class="py-3 pr-4">{{ t('giftCardsAdmin.createdAndUsed') }}</th>
              <th class="py-3 pr-4">{{ t('giftCards.expiresAt') }}</th>
              <th class="py-3 pr-4">{{ t('giftCards.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in records" :key="card.id" class="border-b border-themed">
              <td class="py-3 pr-4">
                <input type="checkbox" class="h-4 w-4 rounded text-accent" :checked="selectedIds.has(card.id)" @change="toggleSelected(card.id, ($event.target as HTMLInputElement).checked)" />
              </td>
              <td class="max-w-[320px] py-3 pr-4 font-mono text-xs text-themed">
                <span class="break-all">{{ card.code }}</span>
              </td>
              <td class="py-3 pr-4 text-themed">
                <div>{{ formatMoney(card.balanceValue) }}</div>
                <div class="text-xs text-themed-muted">{{ t('giftCardsAdmin.faceValue', { amount: formatMoney(card.faceValue) }) }}</div>
              </td>
              <td class="py-3 pr-4" :class="statusClass(card.status)">{{ statusLabel(card.status) }}</td>
              <td class="py-3 pr-4 text-xs text-themed-muted">
                <div>{{ t('giftCardsAdmin.createdBy', { user: card.createdBy?.username || '-' }) }}</div>
                <div>{{ t('giftCardsAdmin.owner', { user: card.owner?.username || '-' }) }}</div>
                <div>{{ t('giftCardsAdmin.usedBy', { user: card.usedBy?.username || '-' }) }}</div>
              </td>
              <td class="py-3 pr-4 text-themed-muted">{{ formatDate(card.expiresAt) }}</td>
              <td class="py-3 pr-4">
                <div class="flex flex-wrap gap-2">
                  <button v-if="card.status === 'active' || card.status === 'disabled'" class="btn-secondary btn-sm" @click="updateCardStatus(card)">
                    {{ card.status === 'disabled' ? t('giftCardsAdmin.enable') : t('giftCardsAdmin.disable') }}
                  </button>
                  <button v-if="card.status !== 'used'" class="btn-danger btn-sm" @click="deleteCard(card)">{{ t('giftCardsAdmin.delete') }}</button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && records.length === 0">
              <td colspan="7" class="py-8 text-center text-themed-muted">{{ t('giftCards.empty') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
