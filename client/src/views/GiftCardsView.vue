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
const isTurnstileChallengeAvailable = computed<boolean>(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))

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
    disabled: 'text-gray-400 dark:text-gray-500',
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
  if (!isTurnstileChallengeAvailable.value) return undefined
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
  if (isTurnstileChallengeAvailable.value && !token) {
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
  <div class="kawaii-page space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('nav.giftCards') }}</h1>
        <p class="page-description">{{ t('giftCards.description') }}</p>
      </div>
      <button class="btn btn-secondary" :disabled="loading" @click="loadCards">
        <svg class="h-4 w-4" :class="{ 'animate-spin': loading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
        {{ loading ? t('giftCards.loading') : t('giftCards.refresh') }}
      </button>
    </div>

    <div v-if="lastGeneratedCode" class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
      <div class="flex items-center gap-2 text-sm font-semibold">
        <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
        {{ t('giftCards.lastCodeNotice') }}
      </div>
      <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code class="min-w-0 flex-1 break-all rounded-lg bg-white/70 p-2.5 font-mono text-xs tabular-nums dark:bg-black/30">{{ lastGeneratedCode }}</code>
        <button class="btn btn-sm btn-secondary shrink-0" @click="copyCode(lastGeneratedCode)">{{ t('giftCards.copy') }}</button>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <section v-if="isTurnstileChallengeAvailable" class="rounded-xl border border-themed bg-themed-surface p-6 lg:col-span-2">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
          </span>
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-themed">{{ t('giftCards.turnstileTitle') }}</h2>
            <p class="mt-1 text-sm text-themed-muted">{{ t('giftCards.turnstileDescription') }}</p>
          </div>
        </div>
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

      <section class="nimbus-lift rounded-xl border border-themed bg-themed-surface p-6 shadow-sm">
        <div class="flex items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
          </span>
          <h2 class="text-base font-semibold text-themed">{{ t('giftCards.redeemTitle') }}</h2>
        </div>
        <div class="mt-4 flex flex-col gap-3 sm:flex-row">
          <input v-model="redeemCode" class="input flex-1 font-mono" :placeholder="t('giftCards.redeemPlaceholder')" />
          <button class="btn btn-primary shrink-0" :disabled="redeeming || !redeemCode.trim()" @click="redeemGiftCard">
            {{ redeeming ? t('giftCards.redeeming') : t('giftCards.redeem') }}
          </button>
        </div>
      </section>

      <section class="nimbus-lift rounded-xl border border-themed bg-themed-surface p-6 shadow-sm">
        <div class="flex items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <h2 class="text-base font-semibold text-themed">{{ t('giftCards.generateTitle') }}</h2>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
          <input v-model.number="generateAmount" class="input font-mono tabular-nums" type="number" min="0.01" max="10000" step="0.01" :placeholder="t('giftCards.amountPlaceholder')" />
          <input v-model="generateRemark" class="input" maxlength="200" :placeholder="t('giftCards.remarkPlaceholder')" />
          <button class="btn btn-primary shrink-0" :disabled="generating || !generateAmount" @click="generateGiftCard">
            {{ generating ? t('giftCards.generating') : t('giftCards.generate') }}
          </button>
        </div>
      </section>
    </div>

    <section class="rounded-xl border border-themed bg-themed-surface p-6 shadow-sm">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 class="text-base font-semibold text-themed">{{ t('giftCards.mineTitle') }}</h2>
          <p class="mt-1 text-sm font-mono tabular-nums text-themed-muted">{{ t('giftCards.activeTotal', { amount: formatMoney(totalActiveValue) }) }}</p>
        </div>
        <select v-model="statusFilter" class="input w-full md:w-44" @change="loadCards">
          <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <div class="mt-5 space-y-3 lg:hidden">
        <div v-for="card in cards" :key="card.id" class="nimbus-lift rounded-xl border border-themed bg-themed p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('giftCards.code') }}</div>
              <code class="mt-1 block break-all font-mono text-xs text-themed">{{ displayCardCode(card) }}</code>
            </div>
            <span class="shrink-0 text-sm font-medium" :class="statusClass(card.status)">{{ statusLabel(card.status) }}</span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('giftCards.amount') }}</div>
              <div class="font-mono font-semibold tabular-nums text-themed">{{ formatMoney(card.balanceValue) }}</div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('giftCards.expiresAt') }}</div>
              <div class="text-themed">{{ formatDate(card.expiresAt) }}</div>
            </div>
          </div>
          <div class="mt-4 flex gap-2">
            <button class="btn btn-sm btn-secondary flex-1" @click="toggleCodeReveal(card)">
              {{ isCodeRevealed(card) ? t('giftCards.hideCode') : t('giftCards.showCode') }}
            </button>
            <button class="btn btn-sm btn-secondary flex-1" @click="copyCode(card.code)">{{ t('giftCards.copy') }}</button>
          </div>
        </div>
        <div v-if="!loading && cards.length === 0" class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-themed py-12 text-center">
          <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-themed-secondary text-themed-faint">
            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
          </span>
          <p class="text-sm text-themed-muted">{{ t('giftCards.empty') }}</p>
        </div>
      </div>

      <div class="mt-5 hidden overflow-hidden lg:block">
        <table class="w-full table-fixed text-sm">
          <colgroup>
            <col style="width: 28%" />
            <col style="width: 16%" />
            <col style="width: 14%" />
            <col style="width: 24%" />
            <col style="width: 18%" />
          </colgroup>
          <thead class="border-b border-themed text-left text-xs uppercase tracking-wide text-themed-muted">
            <tr>
              <th class="py-3 pr-4 font-medium">{{ t('giftCards.code') }}</th>
              <th class="py-3 pr-4 font-medium">{{ t('giftCards.amount') }}</th>
              <th class="py-3 pr-4 font-medium">{{ t('giftCards.statusTitle') }}</th>
              <th class="py-3 pr-4 font-medium">{{ t('giftCards.expiresAt') }}</th>
              <th class="py-3 pr-4 font-medium">{{ t('giftCards.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in cards" :key="card.id" class="border-b border-themed transition-colors hover:bg-themed-hover">
              <td class="py-3 pr-4 font-mono text-xs text-themed">
                <span class="block truncate">{{ displayCardCode(card) }}</span>
              </td>
              <td class="py-3 pr-4 font-mono tabular-nums text-themed">{{ formatMoney(card.balanceValue) }}</td>
              <td class="py-3 pr-4 font-medium" :class="statusClass(card.status)">{{ statusLabel(card.status) }}</td>
              <td class="py-3 pr-4 text-themed-muted">{{ formatDate(card.expiresAt) }}</td>
              <td class="py-3 pr-4 whitespace-nowrap">
                <div class="flex gap-2">
                  <button class="btn btn-sm btn-secondary" @click="toggleCodeReveal(card)">
                    {{ isCodeRevealed(card) ? t('giftCards.hideCode') : t('giftCards.showCode') }}
                  </button>
                  <button class="btn btn-sm btn-secondary" @click="copyCode(card.code)">{{ t('giftCards.copy') }}</button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && cards.length === 0">
              <td colspan="5" class="py-12 text-center">
                <div class="flex flex-col items-center gap-3">
                  <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-themed-secondary text-themed-faint">
                    <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
                  </span>
                  <p class="text-sm text-themed-muted">{{ t('giftCards.empty') }}</p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nimbus-lift {
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.nimbus-lift:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px -8px rgb(16 24 40 / 0.18);
}
@media (prefers-reduced-motion: reduce) {
  .nimbus-lift,
  .nimbus-lift:hover {
    transition: none;
    transform: none;
  }
}
</style>
