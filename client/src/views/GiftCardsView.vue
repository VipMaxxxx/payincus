<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import type { GiftCardRecord, GiftCardStatus } from '@/types/api'

const { t, locale } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

const redeemCode = ref('')
const generateAmount = ref<number | null>(null)
const generateRemark = ref('')
const cards = ref<GiftCardRecord[]>([])
const loading = ref(false)
const redeeming = ref(false)
const generating = ref(false)
const statusFilter = ref<GiftCardStatus | ''>('')
const lastGeneratedCode = ref('')
const revealedCodeIds = ref<Set<number>>(new Set())
const turnstileEnabled = ref(false)
const turnstileSiteKey = ref('')
const turnstileToken = ref('')
const turnstileRef = ref<InstanceType<typeof TurnstileWidget> | null>(null)

const statusOptions = computed<Array<{ value: GiftCardStatus | ''; label: string }>>(() => [
  { value: '', label: t('giftCards.status.all') },
  { value: 'active', label: t('giftCards.status.active') },
  { value: 'used', label: t('giftCards.status.used') },
  { value: 'disabled', label: t('giftCards.status.disabled') },
  { value: 'expired', label: t('giftCards.status.expired') }
])

const totalActiveValue = computed(() =>
  cards.value
    .filter(card => card.status === 'active')
    .reduce((sum, card) => sum + card.balanceValue, 0)
)

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

function maskGiftCardCode(code: string): string {
  if (!code) return ''
  if (code.length <= 12) return `${code.slice(0, 3)}...`
  return `${code.slice(0, 6)}...${code.slice(-4)}`
}

function isCodeRevealed(card: GiftCardRecord): boolean {
  return revealedCodeIds.value.has(card.id)
}

function displayCardCode(card: GiftCardRecord): string {
  return isCodeRevealed(card) ? card.code : (card.codeMasked || maskGiftCardCode(card.code))
}

function toggleCodeReveal(card: GiftCardRecord): void {
  const next = new Set(revealedCodeIds.value)
  if (next.has(card.id)) {
    next.delete(card.id)
  } else {
    next.add(card.id)
  }
  revealedCodeIds.value = next
}

async function loadTurnstileConfig(): Promise<void> {
  try {
    const config = await api.systemConfig.getPublic()
    turnstileEnabled.value = config.turnstileEnabled || false
    turnstileSiteKey.value = config.turnstileSiteKey || ''
  } catch (err) {
    console.error('[GiftCardsView] Failed to load Turnstile config:', err)
    turnstileEnabled.value = false
    turnstileSiteKey.value = ''
  }
}

async function loadCards(): Promise<void> {
  loading.value = true
  try {
    const response = await api.giftCards.mine({
      page: 1,
      pageSize: 100,
      status: statusFilter.value || undefined
    })
    cards.value = response.records
    revealedCodeIds.value = new Set()
  } catch (err: any) {
    toast.error(t('giftCards.toast.loadFailed', { message: err?.message || String(err) }))
  } finally {
    loading.value = false
  }
}

function getTurnstileToken(): string | undefined {
  if (!turnstileEnabled.value) return undefined
  const widgetToken = turnstileRef.value?.getToken?.()
  if (widgetToken) {
    turnstileToken.value = widgetToken
    return widgetToken
  }

  if (turnstileToken.value) return turnstileToken.value

  const domToken = document
    .querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')
    ?.value
    ?.trim()
  if (domToken) {
    turnstileToken.value = domToken
    return domToken
  }

  return undefined
}

function resetTurnstile(): void {
  turnstileToken.value = ''
  turnstileRef.value?.reset?.()
}

function requireTurnstileToken(): string | undefined | null {
  const token = getTurnstileToken()
  if (turnstileEnabled.value && !token) {
    toast.warning(t('giftCards.toast.turnstileRequired'))
    return null
  }
  return token
}

function onTurnstileExpire(): void {
  turnstileToken.value = ''
}

function onTurnstileError(): void {
  turnstileToken.value = ''
  toast.error(t('giftCards.toast.turnstileFailed'))
}

function onTurnstileVerify(token: string): void {
  turnstileToken.value = token
}

async function redeemGiftCard(): Promise<void> {
  const code = redeemCode.value.trim()
  if (!code) {
    toast.warning(t('giftCards.toast.redeemCodeRequired'))
    return
  }
  redeeming.value = true
  try {
    const token = requireTurnstileToken()
    if (token === null) return
    const response = await api.giftCards.redeem(code, token)
    toast.success(t('giftCards.toast.redeemSuccess', { amount: formatMoney(response.amount) }))
    redeemCode.value = ''
    await loadCards()
  } catch (err: any) {
    toast.error(t('giftCards.toast.redeemFailed', { message: err?.message || String(err) }))
  } finally {
    resetTurnstile()
    redeeming.value = false
  }
}

async function generateGiftCard(): Promise<void> {
  const amount = Number(generateAmount.value)
  if (!Number.isFinite(amount) || amount <= 0) {
    toast.warning(t('giftCards.toast.generateAmountRequired'))
    return
  }
  generating.value = true
  try {
    const token = requireTurnstileToken()
    if (token === null) return
    const response = await api.giftCards.generate(amount, generateRemark.value.trim() || undefined, token)
    lastGeneratedCode.value = response.giftCard.code
    toast.success(t('giftCards.toast.generateSuccess', { balance: formatMoney(response.newBalance) }))
    generateAmount.value = null
    generateRemark.value = ''
    await loadCards()
  } catch (err: any) {
    toast.error(t('giftCards.toast.generateFailed', { message: err?.message || String(err) }))
  } finally {
    resetTurnstile()
    generating.value = false
  }
}

async function copyCode(code: string): Promise<void> {
  await navigator.clipboard.writeText(code)
  toast.success(t('giftCards.toast.copied'))
}

onMounted(async () => {
  await Promise.all([loadTurnstileConfig(), loadCards()])
})
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('nav.giftCards') }}</h1>
        <p class="page-description">{{ t('giftCards.description') }}</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadCards">
        {{ loading ? t('giftCards.loading') : t('giftCards.refresh') }}
      </button>
    </div>

    <div v-if="lastGeneratedCode" class="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
      <div class="font-medium">{{ t('giftCards.lastCodeNotice') }}</div>
      <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code class="min-w-0 flex-1 break-all rounded bg-white/70 p-2 font-mono text-xs">{{ lastGeneratedCode }}</code>
        <button class="btn-secondary btn-sm" @click="copyCode(lastGeneratedCode)">{{ t('giftCards.copy') }}</button>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <section v-if="turnstileEnabled && turnstileSiteKey" class="card p-6 lg:col-span-2">
        <h2 class="text-base font-semibold text-themed">{{ t('giftCards.turnstileTitle') }}</h2>
        <p class="mt-1 text-sm text-themed-muted">{{ t('giftCards.turnstileDescription') }}</p>
        <div class="mt-4">
          <TurnstileWidget
            ref="turnstileRef"
            v-model="turnstileToken"
            :site-key="turnstileSiteKey"
            :theme="themeStore.isDark ? 'dark' : 'light'"
            action="gift_card"
            @verify="onTurnstileVerify"
            @expire="onTurnstileExpire"
            @error="onTurnstileError"
          />
        </div>
      </section>

      <section class="card p-6">
        <h2 class="text-base font-semibold text-themed">{{ t('giftCards.redeemTitle') }}</h2>
        <div class="mt-4 flex flex-col gap-3 sm:flex-row">
          <input v-model="redeemCode" class="input flex-1 font-mono" :placeholder="t('giftCards.redeemPlaceholder')" />
          <button class="btn-primary" :disabled="redeeming || !redeemCode.trim()" @click="redeemGiftCard">
            {{ redeeming ? t('giftCards.redeeming') : t('giftCards.redeem') }}
          </button>
        </div>
      </section>

      <section class="card p-6">
        <h2 class="text-base font-semibold text-themed">{{ t('giftCards.generateTitle') }}</h2>
        <div class="mt-4 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
          <input v-model.number="generateAmount" class="input" type="number" min="0.01" max="10000" step="0.01" :placeholder="t('giftCards.amountPlaceholder')" />
          <input v-model="generateRemark" class="input" maxlength="200" :placeholder="t('giftCards.remarkPlaceholder')" />
          <button class="btn-primary" :disabled="generating || !generateAmount" @click="generateGiftCard">
            {{ generating ? t('giftCards.generating') : t('giftCards.generate') }}
          </button>
        </div>
      </section>
    </div>

    <section class="card p-6">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 class="text-base font-semibold text-themed">{{ t('giftCards.mineTitle') }}</h2>
          <p class="mt-1 text-sm text-themed-muted">{{ t('giftCards.activeTotal', { amount: formatMoney(totalActiveValue) }) }}</p>
        </div>
        <select v-model="statusFilter" class="input w-full md:w-44" @change="loadCards">
          <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <div class="mt-5 space-y-3 md:hidden">
        <div v-for="card in cards" :key="card.id" class="rounded-lg border border-themed bg-themed-surface p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs text-themed-muted">{{ t('giftCards.code') }}</div>
              <code class="mt-1 block break-all font-mono text-xs text-themed">{{ displayCardCode(card) }}</code>
            </div>
            <span class="shrink-0 text-sm" :class="statusClass(card.status)">{{ statusLabel(card.status) }}</span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-xs text-themed-muted">{{ t('giftCards.amount') }}</div>
              <div class="font-medium text-themed">{{ formatMoney(card.balanceValue) }}</div>
            </div>
            <div>
              <div class="text-xs text-themed-muted">{{ t('giftCards.expiresAt') }}</div>
              <div class="text-themed">{{ formatDate(card.expiresAt) }}</div>
            </div>
          </div>
          <div class="mt-4 flex gap-2">
            <button class="btn-secondary btn-sm flex-1" @click="toggleCodeReveal(card)">
              {{ isCodeRevealed(card) ? t('giftCards.hideCode') : t('giftCards.showCode') }}
            </button>
            <button class="btn-secondary btn-sm flex-1" @click="copyCode(card.code)">{{ t('giftCards.copy') }}</button>
          </div>
        </div>
        <div v-if="!loading && cards.length === 0" class="py-8 text-center text-themed-muted">{{ t('giftCards.empty') }}</div>
      </div>

      <div class="mt-5 hidden overflow-x-auto md:block">
        <table class="min-w-full text-sm">
          <thead class="border-b border-themed text-left text-themed-muted">
            <tr>
              <th class="py-3 pr-4">{{ t('giftCards.code') }}</th>
              <th class="py-3 pr-4">{{ t('giftCards.amount') }}</th>
              <th class="py-3 pr-4">{{ t('giftCards.statusTitle') }}</th>
              <th class="py-3 pr-4">{{ t('giftCards.expiresAt') }}</th>
              <th class="py-3 pr-4">{{ t('giftCards.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in cards" :key="card.id" class="border-b border-themed">
              <td class="max-w-[360px] py-3 pr-4 font-mono text-xs text-themed">
                <span class="break-all">{{ displayCardCode(card) }}</span>
              </td>
              <td class="py-3 pr-4 text-themed">{{ formatMoney(card.balanceValue) }}</td>
              <td class="py-3 pr-4" :class="statusClass(card.status)">{{ statusLabel(card.status) }}</td>
              <td class="py-3 pr-4 text-themed-muted">{{ formatDate(card.expiresAt) }}</td>
              <td class="py-3 pr-4">
                <div class="flex flex-wrap gap-2">
                  <button class="btn-secondary btn-sm" @click="toggleCodeReveal(card)">
                    {{ isCodeRevealed(card) ? t('giftCards.hideCode') : t('giftCards.showCode') }}
                  </button>
                  <button class="btn-secondary btn-sm" @click="copyCode(card.code)">{{ t('giftCards.copy') }}</button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && cards.length === 0">
              <td colspan="5" class="py-8 text-center text-themed-muted">{{ t('giftCards.empty') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
