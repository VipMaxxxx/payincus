<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import type { GiftCardRecord, GiftCardStatus } from '@/types/api'

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
const turnstileEnabled = ref(false)
const turnstileSiteKey = ref('')
const turnstileToken = ref('')
const turnstileRef = ref<InstanceType<typeof TurnstileWidget> | null>(null)

const statusOptions: Array<{ value: GiftCardStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '可使用' },
  { value: 'used', label: '已兑换' },
  { value: 'disabled', label: '已停用' },
  { value: 'expired', label: '已过期' }
]

const totalActiveValue = computed(() =>
  cards.value
    .filter(card => card.status === 'active')
    .reduce((sum, card) => sum + card.balanceValue, 0)
)

function formatMoney(value: number): string {
  return `¥${Number(value || 0).toFixed(2)}`
}

function formatDate(value?: string | null): string {
  if (!value) return '永久有效'
  return new Date(value).toLocaleString('zh-CN')
}

function statusLabel(status: GiftCardStatus): string {
  return {
    active: '可使用',
    used: '已兑换',
    disabled: '已停用',
    expired: '已过期'
  }[status]
}

function statusClass(status: GiftCardStatus): string {
  return {
    active: 'text-green-500',
    used: 'text-themed-muted',
    disabled: 'text-yellow-500',
    expired: 'text-red-500'
  }[status]
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
  } catch (err: any) {
    toast.error('加载礼品卡失败：' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

function getTurnstileToken(): string | undefined {
  if (!turnstileEnabled.value) return undefined
  return turnstileToken.value || undefined
}

function resetTurnstile(): void {
  turnstileToken.value = ''
  turnstileRef.value?.reset?.()
}

function requireTurnstileToken(): string | undefined | null {
  const token = getTurnstileToken()
  if (turnstileEnabled.value && !token) {
    toast.warning('请先完成人机验证')
    return null
  }
  return token
}

function onTurnstileExpire(): void {
  turnstileToken.value = ''
}

function onTurnstileError(): void {
  turnstileToken.value = ''
  toast.error('人机验证失败，请重试')
}

async function redeemGiftCard(): Promise<void> {
  const code = redeemCode.value.trim()
  if (!code) {
    toast.warning('请输入礼品卡兑换码')
    return
  }
  redeeming.value = true
  try {
    const token = requireTurnstileToken()
    if (token === null) return
    const response = await api.giftCards.redeem(code, token)
    toast.success(`兑换成功，余额增加 ${formatMoney(response.amount)}`)
    redeemCode.value = ''
    await loadCards()
  } catch (err: any) {
    toast.error('兑换失败：' + (err?.message || String(err)))
  } finally {
    resetTurnstile()
    redeeming.value = false
  }
}

async function generateGiftCard(): Promise<void> {
  const amount = Number(generateAmount.value)
  if (!Number.isFinite(amount) || amount <= 0) {
    toast.warning('请输入有效金额')
    return
  }
  generating.value = true
  try {
    const token = requireTurnstileToken()
    if (token === null) return
    const response = await api.giftCards.generate(amount, generateRemark.value.trim() || undefined, token)
    lastGeneratedCode.value = response.giftCard.code
    toast.success(`礼品卡已生成，当前余额 ${formatMoney(response.newBalance)}`)
    generateAmount.value = null
    generateRemark.value = ''
    await loadCards()
  } catch (err: any) {
    toast.error('生成礼品卡失败：' + (err?.message || String(err)))
  } finally {
    resetTurnstile()
    generating.value = false
  }
}

async function copyCode(code: string): Promise<void> {
  await navigator.clipboard.writeText(code)
  toast.success('兑换码已复制')
}

onMounted(async () => {
  await Promise.all([loadTurnstileConfig(), loadCards()])
})
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">礼品卡</h1>
        <p class="page-description">兑换礼品卡到账户余额，或用自己的余额生成礼品卡赠送给其他用户。</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadCards">
        {{ loading ? '加载中...' : '刷新' }}
      </button>
    </div>

    <div v-if="lastGeneratedCode" class="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
      <div class="font-medium">新礼品卡兑换码只在此处完整展示一次</div>
      <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code class="min-w-0 flex-1 break-all rounded bg-white/70 p-2 font-mono text-xs">{{ lastGeneratedCode }}</code>
        <button class="btn-secondary btn-sm" @click="copyCode(lastGeneratedCode)">复制</button>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <section v-if="turnstileEnabled && turnstileSiteKey" class="card p-6 lg:col-span-2">
        <h2 class="text-base font-semibold text-themed">人机验证</h2>
        <p class="mt-1 text-sm text-themed-muted">兑换或生成礼品卡前需要完成验证。</p>
        <div class="mt-4">
          <TurnstileWidget
            ref="turnstileRef"
            v-model="turnstileToken"
            :site-key="turnstileSiteKey"
            :theme="themeStore.isDark ? 'dark' : 'light'"
            action="gift_card"
            @expire="onTurnstileExpire"
            @error="onTurnstileError"
          />
        </div>
      </section>

      <section class="card p-6">
        <h2 class="text-base font-semibold text-themed">兑换礼品卡</h2>
        <div class="mt-4 flex flex-col gap-3 sm:flex-row">
          <input v-model="redeemCode" class="input flex-1 font-mono" placeholder="gc-..." />
          <button class="btn-primary" :disabled="redeeming || !redeemCode.trim()" @click="redeemGiftCard">
            {{ redeeming ? '兑换中...' : '兑换' }}
          </button>
        </div>
      </section>

      <section class="card p-6">
        <h2 class="text-base font-semibold text-themed">用余额生成礼品卡</h2>
        <div class="mt-4 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
          <input v-model.number="generateAmount" class="input" type="number" min="0.01" max="10000" step="0.01" placeholder="金额" />
          <input v-model="generateRemark" class="input" maxlength="200" placeholder="备注，可选" />
          <button class="btn-primary" :disabled="generating || !generateAmount" @click="generateGiftCard">
            {{ generating ? '生成中...' : '生成' }}
          </button>
        </div>
      </section>
    </div>

    <section class="card p-6">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 class="text-base font-semibold text-themed">我的礼品卡</h2>
          <p class="mt-1 text-sm text-themed-muted">当前列表可用余额合计 {{ formatMoney(totalActiveValue) }}</p>
        </div>
        <select v-model="statusFilter" class="input w-full md:w-44" @change="loadCards">
          <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <div class="mt-5 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="border-b border-themed text-left text-themed-muted">
            <tr>
              <th class="py-3 pr-4">兑换码</th>
              <th class="py-3 pr-4">金额</th>
              <th class="py-3 pr-4">状态</th>
              <th class="py-3 pr-4">有效期</th>
              <th class="py-3 pr-4">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in cards" :key="card.id" class="border-b border-themed">
              <td class="max-w-[360px] py-3 pr-4 font-mono text-xs text-themed">
                <span class="break-all">{{ card.code }}</span>
              </td>
              <td class="py-3 pr-4 text-themed">{{ formatMoney(card.balanceValue) }}</td>
              <td class="py-3 pr-4" :class="statusClass(card.status)">{{ statusLabel(card.status) }}</td>
              <td class="py-3 pr-4 text-themed-muted">{{ formatDate(card.expiresAt) }}</td>
              <td class="py-3 pr-4">
                <button class="btn-secondary btn-sm" @click="copyCode(card.code)">复制</button>
              </td>
            </tr>
            <tr v-if="!loading && cards.length === 0">
              <td colspan="5" class="py-8 text-center text-themed-muted">暂无礼品卡。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
