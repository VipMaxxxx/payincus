<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type { GiftCardRecord, GiftCardStats, GiftCardStatus } from '@/types/api'

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
    toast.error('加载礼品卡失败：' + (err?.message || String(err)))
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
    toast.warning('请输入有效面值和数量')
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
      toast.success('礼品卡已生成')
    } else {
      const response = await api.giftCards.batch({ ...payload, count })
      batchResult.value = { batchId: response.batchId, codes: response.codes }
      toast.success(`已批量生成 ${response.count} 张礼品卡`)
    }
    await loadData()
  } catch (err: any) {
    toast.error('生成礼品卡失败：' + (err?.message || String(err)))
  } finally {
    saving.value = false
  }
}

async function updateCardStatus(card: GiftCardRecord): Promise<void> {
  try {
    if (card.status === 'disabled') {
      await api.giftCards.enable(card.id)
      toast.success('礼品卡已启用')
    } else {
      await api.giftCards.disable(card.id)
      toast.success('礼品卡已停用')
    }
    await loadData()
  } catch (err: any) {
    toast.error('更新状态失败：' + (err?.message || String(err)))
  }
}

async function deleteCard(card: GiftCardRecord): Promise<void> {
  if (!confirm(`确认删除礼品卡 ${card.codeMasked || card.code}？已兑换礼品卡不能删除。`)) return
  try {
    await api.giftCards.delete(card.id)
    toast.success('礼品卡已删除')
    await loadData()
  } catch (err: any) {
    toast.error('删除失败：' + (err?.message || String(err)))
  }
}

async function batchDisable(): Promise<void> {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return
  try {
    const response = await api.giftCards.batchDisable(ids)
    toast.success(`已停用 ${response.count} 张礼品卡`)
    await loadData()
  } catch (err: any) {
    toast.error('批量停用失败：' + (err?.message || String(err)))
  }
}

async function batchDelete(): Promise<void> {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0 || !confirm(`确认删除选中的 ${ids.length} 张礼品卡？`)) return
  try {
    const response = await api.giftCards.batchDelete(ids)
    toast.success(`已删除 ${response.count} 张礼品卡`)
    await loadData()
  } catch (err: any) {
    toast.error('批量删除失败：' + (err?.message || String(err)))
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
  toast.success('兑换码已复制')
}

onMounted(loadData)
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">礼品卡管理</h1>
        <p class="page-description">生成和管理可兑换到账户余额的礼品卡。生产环境需要配置 PAYINCUS_GIFT_CARD_ADMIN_IDS 后才能操作。</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadData">
        {{ loading ? '加载中...' : '刷新' }}
      </button>
    </div>

    <div v-if="stats" class="grid gap-4 md:grid-cols-4">
      <div class="card p-4">
        <div class="text-sm text-themed-muted">可用礼品卡</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.active }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">已兑换</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.used }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">未兑余额</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ formatMoney(stats.outstandingValue) }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">已兑金额</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ formatMoney(stats.totalRedeemedValue) }}</div>
      </div>
    </div>

    <section class="card p-6">
      <h2 class="text-base font-semibold text-themed">生成礼品卡</h2>
      <div class="mt-4 grid gap-3 lg:grid-cols-[140px_140px_120px_220px_minmax(0,1fr)_auto]">
        <input v-model.number="form.faceValue" class="input" type="number" min="0.01" max="10000" step="0.01" placeholder="面值" />
        <input v-model.number="form.balanceValue" class="input" type="number" min="0.01" max="10000" step="0.01" placeholder="到账金额" />
        <input v-model.number="form.count" class="input" type="number" min="1" max="500" step="1" placeholder="数量" />
        <input v-model="form.expiresAt" class="input" type="datetime-local" />
        <input v-model="form.remark" class="input" maxlength="200" placeholder="备注，可选" />
        <button class="btn-primary" :disabled="saving" @click="createCards">
          {{ saving ? '生成中...' : '生成' }}
        </button>
      </div>
    </section>

    <section v-if="batchResult" class="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
      <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div class="font-medium">本次生成的完整兑换码</div>
          <div v-if="batchResult.batchId" class="mt-1 text-xs">批次：{{ batchResult.batchId }}</div>
        </div>
        <button class="btn-secondary btn-sm" @click="copyCodes(batchResult.codes)">复制全部</button>
      </div>
      <pre class="mt-3 max-h-56 overflow-auto rounded bg-white/70 p-3 font-mono text-xs">{{ batchResult.codes.map(card => card.code).join('\n') }}</pre>
    </section>

    <section class="card p-6">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-col gap-3 sm:flex-row">
          <select v-model="statusFilter" class="input w-full sm:w-44" @change="loadData">
            <option value="">全部状态</option>
            <option value="active">可使用</option>
            <option value="used">已兑换</option>
            <option value="disabled">已停用</option>
            <option value="expired">已过期</option>
          </select>
          <label class="flex h-10 items-center gap-2 text-sm text-themed">
            <input v-model="revealCode" type="checkbox" class="h-4 w-4 rounded text-accent" @change="loadData" />
            显示完整兑换码
          </label>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" :disabled="selectedCount === 0" @click="batchDisable">批量停用</button>
          <button class="btn-ghost text-error" :disabled="selectedCount === 0" @click="batchDelete">批量删除</button>
        </div>
      </div>

      <div class="mt-5 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="border-b border-themed text-left text-themed-muted">
            <tr>
              <th class="py-3 pr-4"></th>
              <th class="py-3 pr-4">兑换码</th>
              <th class="py-3 pr-4">金额</th>
              <th class="py-3 pr-4">状态</th>
              <th class="py-3 pr-4">创建/使用</th>
              <th class="py-3 pr-4">有效期</th>
              <th class="py-3 pr-4">操作</th>
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
                <div class="text-xs text-themed-muted">面值 {{ formatMoney(card.faceValue) }}</div>
              </td>
              <td class="py-3 pr-4" :class="statusClass(card.status)">{{ statusLabel(card.status) }}</td>
              <td class="py-3 pr-4 text-xs text-themed-muted">
                <div>创建：{{ card.createdBy?.username || '-' }}</div>
                <div>持有：{{ card.owner?.username || '-' }}</div>
                <div>使用：{{ card.usedBy?.username || '-' }}</div>
              </td>
              <td class="py-3 pr-4 text-themed-muted">{{ formatDate(card.expiresAt) }}</td>
              <td class="py-3 pr-4">
                <div class="flex flex-wrap gap-2">
                  <button v-if="card.status === 'active' || card.status === 'disabled'" class="btn-secondary btn-sm" @click="updateCardStatus(card)">
                    {{ card.status === 'disabled' ? '启用' : '停用' }}
                  </button>
                  <button v-if="card.status !== 'used'" class="btn-ghost btn-sm text-error" @click="deleteCard(card)">删除</button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && records.length === 0">
              <td colspan="7" class="py-8 text-center text-themed-muted">暂无礼品卡。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
