<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import type { InviteCostOption, UserInvite, UserInviteSummary } from '@/types/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { dashboardPath } from '@/utils/app-paths'
import UserAvatar from '@/components/UserAvatar.vue'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'

defineOptions({ name: 'InvitesView' })

const toast = useToast()
const { t } = useI18n()
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
    toast.success(t('invites.generateSuccess'))
    page.value = 1
    await Promise.all([loadSummary(), loadInvites()])
  } catch (err: any) {
    toast.error(err?.message || t('invites.generateFailed'))
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
  if (resource === 'points') return t('invites.pointsBalance', { points: summary.value.balances.points })
  return '-'
}

function getStatus(invite: UserInvite): { label: string; className: string } {
  if (invite.usedBy) {
    return { label: t('invites.status.used'), className: 'badge-success' }
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return { label: t('invites.status.expired'), className: 'badge-error' }
  }
  return { label: t('invites.status.unused'), className: 'badge-warning' }
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
    toast.error(t('common.copyFailed'))
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
  <div class="kawaii-page space-y-6 animate-fade-in">
    <div class="page-header flex-col gap-4 sm:flex-row sm:gap-0">
      <div>
        <h1 class="page-title">{{ t('invites.title') }}</h1>
        <p class="page-description">{{ t('invites.description') }}</p>
      </div>
      <RouterLink :to="dashboardPath()" class="btn-ghost w-full justify-center sm:w-auto">
        {{ t('invites.backToOverview') }}
      </RouterLink>
    </div>

    <ThemeTemplateSlot slot-name="user.invites.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />

    <div v-if="loading" class="card p-6 animate-pulse">
      <div class="h-6 w-1/4 rounded bg-themed-secondary mb-5"></div>
      <div class="grid gap-3 md:grid-cols-3">
        <div v-for="i in 3" :key="i" class="h-24 rounded-lg bg-themed-secondary"></div>
      </div>
    </div>

    <template v-else>
      <div class="grid gap-3 md:grid-cols-3">
        <div class="card p-5">
          <p class="text-sm text-themed-muted">{{ t('invites.stats.generated') }}</p>
          <p class="mt-2 text-3xl font-bold text-themed">{{ summary?.stats.total || 0 }}</p>
        </div>
        <div class="card p-5">
          <p class="text-sm text-themed-muted">{{ t('invites.stats.used') }}</p>
          <p class="mt-2 text-3xl font-bold text-themed">{{ summary?.stats.used || 0 }}</p>
        </div>
        <div class="card p-5">
          <p class="text-sm text-themed-muted">{{ t('invites.stats.usageRate') }}</p>
          <p class="mt-2 text-3xl font-bold text-themed">{{ summary?.stats.usageRate || 0 }}%</p>
        </div>
      </div>

      <div class="card p-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="min-w-0 flex-1">
            <h2 class="text-base font-semibold text-themed">{{ t('invites.generateTitle') }}</h2>
            <p class="mt-1 text-sm text-themed-muted">{{ t('invites.generateDescription') }}</p>

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
              {{ t('invites.noCostOptions') }}
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
            <span>{{ generating ? t('invites.generating') : t('invites.generate') }}</span>
          </button>
        </div>

        <div v-if="generatedInvites.length > 0" class="mt-5 rounded-lg border border-themed bg-themed-secondary/40 p-4">
          <p class="text-sm font-medium text-themed">{{ t('invites.justGenerated') }}</p>
          <div class="mt-3 space-y-2">
            <div v-for="invite in generatedInvites" :key="invite.id" class="flex flex-col gap-2 rounded-lg bg-themed p-3 sm:flex-row sm:items-center sm:justify-between">
              <code class="text-sm text-themed-secondary">{{ invite.code }}</code>
              <div class="flex gap-2">
                <button class="btn-ghost btn-sm" @click="copyText(invite.code, t('invites.codeCopied'))">{{ t('invites.copyCode') }}</button>
                <button class="btn-secondary btn-sm" @click="copyText(getInviteLink(invite), t('invites.linkCopied'))">{{ t('invites.copyLink') }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-base font-semibold text-themed">{{ t('invites.myInvites') }}</h2>
            <p class="text-sm text-themed-muted">{{ t('invites.myInvitesDescription') }}</p>
          </div>
          <button class="btn-ghost btn-sm" :disabled="listLoading" @click="loadInvites">{{ t('common.refresh') }}</button>
        </div>

        <div v-if="listLoading" class="p-8 text-center text-themed-muted">{{ t('common.loading') }}</div>
        <div v-else-if="invites.length === 0" class="p-8 text-center text-themed-muted">
          {{ t('invites.empty') }}
        </div>
        <div v-else class="space-y-3 p-4 lg:hidden">
          <div
            v-for="invite in invites"
            :key="invite.id"
            class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <code class="block truncate text-sm font-semibold text-themed-secondary" :title="invite.code">
                  {{ invite.code }}
                </code>
                <div class="mt-1 text-xs text-themed-muted">
                  {{ invite.costSnapshot?.displayAmount || t('invites.adminGenerated') }}
                </div>
              </div>
              <span class="badge shrink-0 whitespace-nowrap" :class="getStatus(invite).className">
                {{ getStatus(invite).label }}
              </span>
            </div>

            <div class="mt-4 rounded-lg bg-themed-secondary px-3 py-2">
              <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ t('invites.usedBy') }}</div>
              <div v-if="invite.usedByUser" class="flex min-w-0 items-center gap-2">
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
            </div>

            <div class="mt-3 rounded-lg bg-themed-secondary px-3 py-2 text-sm text-themed-muted">
              <div>{{ t('invites.time.generated', { time: formatDate(invite.createdAt) }) }}</div>
              <div v-if="invite.usedAt">{{ t('invites.time.used', { time: formatDate(invite.usedAt) }) }}</div>
              <div v-else-if="invite.expiresAt">{{ t('invites.time.expires', { time: formatDate(invite.expiresAt) }) }}</div>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-2">
              <button class="btn-ghost btn-sm justify-center" @click="copyText(invite.code, t('invites.codeCopied'))">{{ t('invites.copyCode') }}</button>
              <button class="btn-secondary btn-sm justify-center" @click="copyText(getInviteLink(invite), t('invites.linkCopied'))">{{ t('invites.copyLink') }}</button>
            </div>
          </div>
        </div>
        <div v-if="invites.length > 0" class="hidden overflow-hidden lg:block">
          <table class="w-full table-fixed divide-y divide-themed">
            <thead>
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">{{ t('invites.columns.code') }}</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">{{ t('common.status') }}</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">{{ t('invites.usedBy') }}</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">{{ t('invites.columns.cost') }}</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-themed-muted">{{ t('invites.columns.time') }}</th>
                <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-themed-muted">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed">
              <tr v-for="invite in invites" :key="invite.id" class="hover:bg-themed-hover">
                <td class="px-4 py-3">
                  <code class="block truncate text-sm text-themed-secondary" :title="invite.code">{{ invite.code }}</code>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span class="badge" :class="getStatus(invite).className">{{ getStatus(invite).label }}</span>
                </td>
                <td class="px-4 py-3">
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
                <td class="px-4 py-3 text-sm text-themed-muted">
                  <div class="truncate">{{ invite.costSnapshot?.displayAmount || t('invites.adminGenerated') }}</div>
                </td>
                <td class="px-4 py-3 text-sm text-themed-muted">
                  <div>{{ t('invites.time.generated', { time: formatDate(invite.createdAt) }) }}</div>
                  <div v-if="invite.usedAt">{{ t('invites.time.used', { time: formatDate(invite.usedAt) }) }}</div>
                  <div v-else-if="invite.expiresAt">{{ t('invites.time.expires', { time: formatDate(invite.expiresAt) }) }}</div>
                </td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <div class="inline-flex justify-end gap-2">
                    <button class="btn-ghost btn-sm" @click="copyText(invite.code, t('invites.codeCopied'))">{{ t('invites.copyCode') }}</button>
                    <button class="btn-secondary btn-sm" @click="copyText(getInviteLink(invite), t('invites.linkCopied'))">{{ t('invites.copyLink') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="total > 0" class="flex flex-col gap-3 border-t border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-themed-muted">{{ t('invites.total', { total }) }}</p>
          <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
            <button class="btn-ghost btn-sm justify-center" :disabled="page <= 1" @click="previousPage">{{ t('common.prevPage') }}</button>
            <span class="min-w-[72px] text-center text-sm text-themed-muted">{{ page }} / {{ totalPages }}</span>
            <button class="btn-ghost btn-sm justify-center" :disabled="page >= totalPages" @click="nextPage">{{ t('common.nextPage') }}</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
