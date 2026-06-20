<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import api from '@/api'
import type { InviteCostOption, UserInvite, UserInviteSummary } from '@/types/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import UserAvatar from '@/components/UserAvatar.vue'

defineOptions({ name: 'InvitesView' })

const toast = useToast()
const themeStore = useThemeStore()

const loading = ref(true)
const listLoading = ref(false)
const generating = ref(false)
const summary = ref<UserInviteSummary | null>(null)
const invites = ref<UserInvite[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const totalPages = ref(1)
const selectedCostResource = ref('')
const generatedInvites = ref<UserInvite[]>([])

const enabledCostOptions = computed(() => {
  return (summary.value?.costOptions || []).filter(option => option.enabled)
})

const selectedCostOption = computed(() => {
  return enabledCostOptions.value.find(option => option.resource === selectedCostResource.value) || null
})

const canGenerate = computed(() => {
  const option = selectedCostOption.value
  if (!option || generating.value) return false
  return hasEnoughResource(option)
})

onMounted(loadPage)

async function loadPage(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([loadSummary(), loadInvites()])
  } finally {
    loading.value = false
  }
}

async function loadSummary(): Promise<void> {
  summary.value = await api.userInvites.summary()
  if (!selectedCostResource.value && enabledCostOptions.value.length > 0) {
    selectedCostResource.value = enabledCostOptions.value[0].resource
  }
  if (selectedCostResource.value && !enabledCostOptions.value.some(option => option.resource === selectedCostResource.value)) {
    selectedCostResource.value = enabledCostOptions.value[0]?.resource || ''
  }
}

async function loadInvites(): Promise<void> {
  listLoading.value = true
  try {
    const res = await api.userInvites.list({ page: page.value, pageSize: pageSize.value })
    invites.value = res.invites || []
    total.value = res.total || 0
    totalPages.value = res.totalPages || 1
    if (page.value > totalPages.value && totalPages.value > 0) {
      page.value = totalPages.value
      await loadInvites()
    }
  } finally {
    listLoading.value = false
  }
}

async function generateInvite(): Promise<void> {
  if (!selectedCostResource.value || !canGenerate.value) return

  generating.value = true
  try {
    const res = await api.userInvites.generate({ costResource: selectedCostResource.value })
    generatedInvites.value = res.invites || []
    toast.success('邀请码已生成')
    page.value = 1
    await Promise.all([loadSummary(), loadInvites()])
  } catch (err: any) {
    toast.error(err?.message || '生成邀请码失败')
  } finally {
    generating.value = false
  }
}

function hasEnoughResource(option: InviteCostOption): boolean {
  if (!summary.value) return false
  if (option.amount <= 0) return true
  if (option.resource === 'balance') return summary.value.balances.balance >= option.amount
  if (option.resource === 'points') return summary.value.balances.points >= option.amount
  return false
}

function getBalanceLabel(resource: string): string {
  if (!summary.value) return '-'
  if (resource === 'balance') return `¥${summary.value.balances.balance.toFixed(2)}`
  if (resource === 'points') return `${summary.value.balances.points} 积分`
  return '-'
}

function getStatus(invite: UserInvite): { label: string; className: string } {
  if (invite.usedBy) {
    return { label: '已使用', className: 'badge-success' }
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return { label: '已过期', className: 'badge-error' }
  }
  return { label: '未使用', className: 'badge-warning' }
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function getInviteLink(invite: UserInvite): string {
  const origin = window.location.origin
  return `${origin}${invite.registerUrl}`
}

async function copyText(text: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.error('复制失败')
  }
}

function previousPage(): void {
  if (page.value <= 1) return
  page.value -= 1
  loadInvites()
}

function nextPage(): void {
  if (page.value >= totalPages.value) return
  page.value += 1
  loadInvites()
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header flex-col gap-4 sm:flex-row sm:gap-0">
      <div>
        <h1 class="page-title">邀请码管理</h1>
        <p class="page-description">生成新的注册链接，并查看每个邀请码的使用情况。</p>
      </div>
      <RouterLink to="/dashboard" class="btn-ghost w-full justify-center sm:w-auto">
        返回概览
      </RouterLink>
    </div>

    <div v-if="loading" class="card p-6 animate-pulse">
      <div class="h-6 w-1/4 rounded bg-themed-secondary mb-5"></div>
      <div class="grid gap-3 md:grid-cols-3">
        <div v-for="i in 3" :key="i" class="h-24 rounded-lg bg-themed-secondary"></div>
      </div>
    </div>

    <template v-else>
      <div class="grid gap-3 md:grid-cols-3">
        <div class="card p-5">
          <p class="text-sm text-themed-muted">已生成</p>
          <p class="mt-2 text-3xl font-bold text-themed">{{ summary?.stats.total || 0 }}</p>
        </div>
        <div class="card p-5">
          <p class="text-sm text-themed-muted">已使用</p>
          <p class="mt-2 text-3xl font-bold text-emerald-500">{{ summary?.stats.used || 0 }}</p>
        </div>
        <div class="card p-5">
          <p class="text-sm text-themed-muted">使用率</p>
          <p class="mt-2 text-3xl font-bold text-sky-500">{{ summary?.stats.usageRate || 0 }}%</p>
        </div>
      </div>

      <div class="card p-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="min-w-0 flex-1">
            <h2 class="text-base font-semibold text-themed">生成邀请码</h2>
            <p class="mt-1 text-sm text-themed-muted">选择一种管理员配置的成本方式，生成成功后可复制注册链接给新用户。</p>

            <div v-if="enabledCostOptions.length > 0" class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <button
                v-for="option in enabledCostOptions"
                :key="option.resource"
                type="button"
                class="rounded-lg border p-4 text-left transition-all"
                :class="selectedCostResource === option.resource
                  ? (themeStore.isDark ? 'border-white bg-white/5' : 'border-gray-900 bg-gray-50')
                  : (themeStore.isDark ? 'border-gray-800 hover:border-gray-600' : 'border-gray-200 hover:border-gray-300')"
                @click="selectedCostResource = option.resource"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-themed">{{ option.label }}</p>
                    <p class="mt-1 text-2xl font-bold text-themed">{{ option.displayAmount }}</p>
                  </div>
                  <span
                    class="badge"
                    :class="hasEnoughResource(option) ? 'badge-success' : 'badge-error'"
                  >
                    {{ getBalanceLabel(option.resource) }}
                  </span>
                </div>
              </button>
            </div>

            <div v-else class="mt-4 rounded-lg border border-themed bg-themed-secondary/40 p-4 text-sm text-themed-muted">
              管理员尚未开启用户生成邀请码的价格选项。
            </div>
          </div>

          <button
            type="button"
            class="btn-primary w-full justify-center lg:w-auto"
            :disabled="!canGenerate"
            @click="generateInvite"
          >
            <svg v-if="generating" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span>{{ generating ? '生成中' : '生成邀请码' }}</span>
          </button>
        </div>

        <div v-if="generatedInvites.length > 0" class="mt-5 rounded-lg border border-themed bg-themed-secondary/40 p-4">
          <p class="text-sm font-medium text-themed">刚刚生成</p>
          <div class="mt-3 space-y-2">
            <div v-for="invite in generatedInvites" :key="invite.id" class="flex flex-col gap-2 rounded-lg bg-themed p-3 sm:flex-row sm:items-center sm:justify-between">
              <code class="text-sm text-themed-secondary">{{ invite.code }}</code>
              <div class="flex gap-2">
                <button class="btn-ghost btn-sm" @click="copyText(invite.code, '邀请码已复制')">复制码</button>
                <button class="btn-secondary btn-sm" @click="copyText(getInviteLink(invite), '邀请链接已复制')">复制链接</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-base font-semibold text-themed">我的邀请码</h2>
            <p class="text-sm text-themed-muted">可查看是否已被注册使用，以及注册用户的用户名和邮箱。</p>
          </div>
          <button class="btn-ghost btn-sm" :disabled="listLoading" @click="loadInvites">刷新</button>
        </div>

        <div v-if="listLoading" class="p-8 text-center text-themed-muted">加载中...</div>
        <div v-else-if="invites.length === 0" class="p-8 text-center text-themed-muted">
          暂无邀请码
        </div>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-themed">
            <thead>
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">邀请码</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">状态</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">使用人</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">生成成本</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">时间</th>
                <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-themed-muted">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed">
              <tr v-for="invite in invites" :key="invite.id" class="hover:bg-themed-hover">
                <td class="px-4 py-3 whitespace-nowrap">
                  <code class="text-sm text-themed-secondary">{{ invite.code }}</code>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span class="badge" :class="getStatus(invite).className">{{ getStatus(invite).label }}</span>
                </td>
                <td class="px-4 py-3 min-w-[220px]">
                  <div v-if="invite.usedByUser" class="flex items-center gap-2">
                    <UserAvatar
                      :username="invite.usedByUser.username"
                      :email="invite.usedByUser.email"
                      :avatar-style="invite.usedByUser.avatarStyle"
                      :badge-id="invite.usedByUser.avatarBadgeId"
                      :size="32"
                    />
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-themed">{{ invite.usedByUser.username }}</p>
                      <p class="truncate text-xs text-themed-muted">{{ invite.usedByUser.email || '-' }}</p>
                    </div>
                  </div>
                  <span v-else class="text-sm text-themed-muted">-</span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-themed-muted">
                  {{ invite.costSnapshot?.displayAmount || '管理员生成' }}
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-themed-muted">
                  <div>生成 {{ formatDate(invite.createdAt) }}</div>
                  <div v-if="invite.usedAt">使用 {{ formatDate(invite.usedAt) }}</div>
                  <div v-else-if="invite.expiresAt">过期 {{ formatDate(invite.expiresAt) }}</div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-right">
                  <div class="inline-flex gap-2">
                    <button class="btn-ghost btn-sm" @click="copyText(invite.code, '邀请码已复制')">复制码</button>
                    <button class="btn-secondary btn-sm" @click="copyText(getInviteLink(invite), '邀请链接已复制')">复制链接</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="total > 0" class="flex flex-col gap-3 border-t border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-themed-muted">共 {{ total }} 条</p>
          <div class="flex items-center gap-2">
            <button class="btn-ghost btn-sm" :disabled="page <= 1" @click="previousPage">上一页</button>
            <span class="text-sm text-themed-muted">{{ page }} / {{ totalPages }}</span>
            <button class="btn-ghost btn-sm" :disabled="page >= totalPages" @click="nextPage">下一页</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
