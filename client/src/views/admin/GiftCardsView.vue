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
    active: 'text-green-600 dark:text-green-400',
    used: 'text-themed-muted',
    disabled: 'text-gray-400 dark:text-gray-500',
    expired: 'text-rose-600 dark:text-rose-400'
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
  <div class="kawaii-page space-y-6 animate-fade-in">
    <div class="page-header">
      <div class="flex items-center gap-3">
        <span class="gc-title-icon">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12M4.5 7.5h15a1.5 1.5 0 0 1 1.5 1.5v1.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 10.5V9a1.5 1.5 0 0 1 1.5-1.5Zm3.75 3.75v9.75m7.5-9.75v9.75" />
          </svg>
        </span>
        <div>
          <h1 class="page-title">{{ t('giftCardsAdmin.title') }}</h1>
          <p class="page-description">{{ t('giftCardsAdmin.description') }}</p>
        </div>
      </div>
      <button class="btn btn-secondary" :disabled="loading" @click="loadData">
        <svg class="h-4 w-4" :class="{ 'animate-spin': loading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 4v5h.58m15.36 2A8 8 0 0 0 5.07 8.11M20 20v-5h-.58m0 0A8 8 0 0 1 4.06 12.03" />
        </svg>
        {{ loading ? t('giftCards.loading') : t('giftCards.refresh') }}
      </button>
    </div>

    <div v-if="stats" class="grid gap-4 md:grid-cols-4">
      <div class="card gc-stat p-4">
        <div class="gc-stat-label">{{ t('giftCardsAdmin.stats.active') }}</div>
        <div class="gc-stat-value">{{ stats.active }}</div>
      </div>
      <div class="card gc-stat p-4">
        <div class="gc-stat-label">{{ t('giftCardsAdmin.stats.used') }}</div>
        <div class="gc-stat-value">{{ stats.used }}</div>
      </div>
      <div class="card gc-stat p-4">
        <div class="gc-stat-label">{{ t('giftCardsAdmin.stats.outstanding') }}</div>
        <div class="gc-stat-value">{{ formatMoney(stats.outstandingValue) }}</div>
      </div>
      <div class="card gc-stat p-4">
        <div class="gc-stat-label">{{ t('giftCardsAdmin.stats.redeemed') }}</div>
        <div class="gc-stat-value">{{ formatMoney(stats.totalRedeemedValue) }}</div>
      </div>
    </div>

    <section class="card p-6">
      <div class="mb-4 flex items-center gap-2 border-b border-themed pb-4">
        <svg class="h-4 w-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <h2 class="text-base font-semibold text-themed">{{ t('giftCardsAdmin.generateTitle') }}</h2>
      </div>
      <div class="grid gap-4 lg:grid-cols-6">
        <label class="space-y-1.5">
          <span class="gc-field-label">{{ t('giftCardsAdmin.faceValueLabel') }}</span>
          <input v-model.number="form.faceValue" class="input" type="number" min="0.01" max="10000" step="0.01" :placeholder="t('giftCardsAdmin.faceValuePlaceholder')" />
        </label>
        <label class="space-y-1.5">
          <span class="gc-field-label">{{ t('giftCardsAdmin.balanceValueLabel') }}</span>
          <input v-model.number="form.balanceValue" class="input" type="number" min="0.01" max="10000" step="0.01" :placeholder="t('giftCardsAdmin.balanceValuePlaceholder')" />
        </label>
        <label class="space-y-1.5">
          <span class="gc-field-label">{{ t('giftCardsAdmin.countLabel') }}</span>
          <input v-model.number="form.count" class="input" type="number" min="1" max="500" step="1" :placeholder="t('giftCardsAdmin.countPlaceholder')" />
        </label>
        <label class="space-y-1.5 lg:col-span-2">
          <span class="gc-field-label">{{ t('giftCardsAdmin.expiresAtLabel') }}</span>
          <input v-model="form.expiresAt" class="input" type="datetime-local" />
        </label>
        <label class="space-y-1.5 lg:col-span-5">
          <span class="gc-field-label">{{ t('giftCardsAdmin.remarkLabel') }}</span>
          <input v-model="form.remark" class="input" maxlength="200" :placeholder="t('giftCards.remarkPlaceholder')" />
        </label>
        <div class="flex items-end">
          <button class="btn btn-primary w-full" :disabled="saving" @click="createCards">
            {{ saving ? t('giftCards.generating') : t('giftCards.generate') }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="batchResult" class="gc-result">
      <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div class="flex items-center gap-2 font-medium text-themed">
            <svg class="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            {{ t('giftCardsAdmin.batchResultTitle') }}
          </div>
          <div v-if="batchResult.batchId" class="mt-1 font-mono text-xs text-themed-muted">{{ t('giftCardsAdmin.batchId', { batchId: batchResult.batchId }) }}</div>
        </div>
        <button class="btn btn-secondary btn-sm" @click="copyCodes(batchResult.codes)">{{ t('giftCardsAdmin.copyAll') }}</button>
      </div>
      <pre class="gc-code-block">{{ batchResult.codes.map(card => card.code).join('\n') }}</pre>
    </section>

    <section class="card overflow-hidden">
      <div class="flex flex-col gap-3 border-b border-themed p-4 lg:flex-row lg:items-center lg:justify-between">
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
          <button class="btn btn-secondary btn-sm" :disabled="selectedCount === 0" @click="batchDisable">{{ t('giftCardsAdmin.batchDisable') }}</button>
          <button class="btn btn-sm text-rose-600 hover:bg-rose-500/10 dark:text-rose-400" :disabled="selectedCount === 0" @click="batchDelete">{{ t('giftCardsAdmin.batchDelete') }}</button>
        </div>
      </div>

      <div class="space-y-3 p-4 lg:hidden">
        <div v-for="card in records" :key="card.id" class="rounded-lg border border-themed bg-themed-surface p-4">
          <div class="flex items-start gap-3">
            <input type="checkbox" class="mt-1 h-4 w-4 rounded text-accent" :checked="selectedIds.has(card.id)" @change="toggleSelected(card.id, ($event.target as HTMLInputElement).checked)" />
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-3">
                <code class="break-all font-mono text-xs text-themed">{{ card.code }}</code>
                <span class="gc-pill shrink-0" :class="statusClass(card.status)"><span class="gc-dot"></span>{{ statusLabel(card.status) }}</span>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div class="gc-cell-label">{{ t('giftCards.amount') }}</div>
                  <div class="font-medium tabular-nums text-themed">{{ formatMoney(card.balanceValue) }}</div>
                  <div class="text-xs text-themed-muted">{{ t('giftCardsAdmin.faceValue', { amount: formatMoney(card.faceValue) }) }}</div>
                </div>
                <div>
                  <div class="gc-cell-label">{{ t('giftCards.expiresAt') }}</div>
                  <div class="text-themed">{{ formatDate(card.expiresAt) }}</div>
                </div>
              </div>
              <div class="mt-3 space-y-1 text-xs text-themed-muted">
                <div>{{ t('giftCardsAdmin.createdBy', { user: card.createdBy?.username || '-' }) }}</div>
                <div>{{ t('giftCardsAdmin.owner', { user: card.owner?.username || '-' }) }}</div>
                <div>{{ t('giftCardsAdmin.usedBy', { user: card.usedBy?.username || '-' }) }}</div>
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                <button v-if="card.status === 'active' || card.status === 'disabled'" class="btn btn-secondary btn-sm" @click="updateCardStatus(card)">
                  {{ card.status === 'disabled' ? t('giftCardsAdmin.enable') : t('giftCardsAdmin.disable') }}
                </button>
                <button v-if="card.status !== 'used'" class="btn btn-danger btn-sm" @click="deleteCard(card)">{{ t('giftCardsAdmin.delete') }}</button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="!loading && records.length === 0" class="py-8 text-center text-themed-muted">{{ t('giftCards.empty') }}</div>
      </div>

      <div class="hidden overflow-hidden lg:block">
        <table class="w-full table-fixed text-sm">
          <thead>
            <tr class="border-b border-themed">
              <th class="w-[4%] px-4 py-3"></th>
              <th class="gc-th w-[28%]">{{ t('giftCards.code') }}</th>
              <th class="gc-th w-[14%]">{{ t('giftCards.amount') }}</th>
              <th class="gc-th w-[12%]">{{ t('giftCards.statusTitle') }}</th>
              <th class="gc-th w-[20%]">{{ t('giftCardsAdmin.createdAndUsed') }}</th>
              <th class="gc-th w-[12%]">{{ t('giftCards.expiresAt') }}</th>
              <th class="gc-th w-[10%]">{{ t('giftCards.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in records" :key="card.id" class="gc-row border-b border-themed">
              <td class="px-4 py-3">
                <input type="checkbox" class="h-4 w-4 rounded text-accent" :checked="selectedIds.has(card.id)" @change="toggleSelected(card.id, ($event.target as HTMLInputElement).checked)" />
              </td>
              <td class="px-4 py-3 font-mono text-xs text-themed">
                <span class="block truncate">{{ card.code }}</span>
              </td>
              <td class="px-4 py-3 text-themed">
                <div class="font-medium tabular-nums">{{ formatMoney(card.balanceValue) }}</div>
                <div class="text-xs text-themed-muted">{{ t('giftCardsAdmin.faceValue', { amount: formatMoney(card.faceValue) }) }}</div>
              </td>
              <td class="px-4 py-3">
                <span class="gc-pill" :class="statusClass(card.status)"><span class="gc-dot"></span>{{ statusLabel(card.status) }}</span>
              </td>
              <td class="px-4 py-3 text-xs text-themed-muted">
                <div class="truncate">{{ t('giftCardsAdmin.createdBy', { user: card.createdBy?.username || '-' }) }}</div>
                <div class="truncate">{{ t('giftCardsAdmin.owner', { user: card.owner?.username || '-' }) }}</div>
                <div class="truncate">{{ t('giftCardsAdmin.usedBy', { user: card.usedBy?.username || '-' }) }}</div>
              </td>
              <td class="px-4 py-3 text-themed-muted">{{ formatDate(card.expiresAt) }}</td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-2">
                  <button v-if="card.status === 'active' || card.status === 'disabled'" class="btn btn-secondary btn-sm" @click="updateCardStatus(card)">
                    {{ card.status === 'disabled' ? t('giftCardsAdmin.enable') : t('giftCardsAdmin.disable') }}
                  </button>
                  <button v-if="card.status !== 'used'" class="btn btn-danger btn-sm" @click="deleteCard(card)">{{ t('giftCardsAdmin.delete') }}</button>
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

<style scoped>
.gc-title-icon {
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

.gc-stat {
  position: relative;
  overflow: hidden;
}

.gc-stat::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 2.25rem;
  height: 2px;
  background: var(--kawaii-primary);
  border-radius: 0 0 2px 0;
}

.gc-stat-label {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
}

.gc-stat-value {
  margin-top: 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.1;
  color: var(--kawaii-text);
  font-variant-numeric: tabular-nums;
}

.gc-field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--kawaii-muted);
}

.gc-cell-label {
  font-size: 0.6875rem;
  color: var(--kawaii-faint);
}

.gc-result {
  border-radius: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--kawaii-primary) 28%, var(--kawaii-line));
  background: color-mix(in srgb, var(--kawaii-primary) 7%, var(--kawaii-surface));
  padding: 1rem;
  font-size: 0.875rem;
  color: var(--kawaii-text);
}

.gc-code-block {
  margin-top: 0.75rem;
  max-height: 14rem;
  overflow: auto;
  border-radius: 0.5rem;
  border: 1px solid var(--kawaii-line);
  background: var(--kawaii-surface);
  padding: 0.75rem;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--kawaii-muted);
}

.gc-th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--kawaii-faint);
}

.gc-row {
  transition: background-color 0.12s ease;
}

.gc-row:hover {
  background: color-mix(in srgb, var(--kawaii-primary) 5%, transparent);
}

.gc-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.gc-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: currentColor;
}

@media (prefers-reduced-motion: reduce) {
  .gc-row {
    transition: none;
  }
}
</style>
