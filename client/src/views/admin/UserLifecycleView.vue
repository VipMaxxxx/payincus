<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type {
  UserLifecycleListUser,
  UserLifecycleOverview,
  UserLifecycleTagDefinition,
  UserLifecycleUserSummary
} from '@/types/api'

const toast = useToast()
const { t } = useI18n()

const loading = ref(false)
const overviewLoading = ref(false)
const actionLoading = ref(false)
const overview = ref<UserLifecycleOverview | null>(null)
const users = ref<UserLifecycleListUser[]>([])
const selectedUserIds = ref<number[]>([])
const selectedUser = ref<UserLifecycleUserSummary | null>(null)
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const totalPages = ref(1)

const filters = ref({
  search: '',
  tag: '',
  segment: '',
  minRecharge: '',
  maxRecharge: '',
  minInstances: '',
  maxInstances: '',
  activeState: ''
})

const tagForm = ref({ tagKey: 'new_user', note: '' })
const codeForm = ref({ hostId: '', codeType: 't', codeValue: '10', expiresInDays: '14', remark: '' })
const reminderForm = ref({ title: t('userLifecycle.reminder.defaultTitle'), content: t('userLifecycle.reminder.defaultContent'), confirm: false })

const tagDefinitions = computed<UserLifecycleTagDefinition[]>(() => overview.value?.tags || [])
const segments = computed(() => overview.value?.segments || [])
const hasSelectedUsers = computed(() => selectedUserIds.value.length > 0)

function formatMoney(value: number | undefined): string {
  return `¥${Number(value || 0).toFixed(2)}`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function getTagLabel(key: string): string {
  return tagDefinitions.value.find(tag => tag.key === key)?.label || key
}

function getCodeUnit(type: string): string {
  return type === 'c' ? '%' : type === 'r' || type === 'd' ? 'MB' : 'GB'
}

function normalizeNumeric(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function loadOverview() {
  overviewLoading.value = true
  try {
    overview.value = await api.userLifecycle.overview()
  } catch (error: any) {
    toast.error(t('userLifecycle.messages.overviewLoadFailed', { error: error.message }))
  } finally {
    overviewLoading.value = false
  }
}

async function loadUsers() {
  loading.value = true
  try {
    const response = await api.userLifecycle.users({
      page: page.value,
      pageSize: pageSize.value,
      search: filters.value.search || undefined,
      tag: filters.value.tag || undefined,
      segment: filters.value.segment || undefined,
      minRecharge: normalizeNumeric(filters.value.minRecharge),
      maxRecharge: normalizeNumeric(filters.value.maxRecharge),
      minInstances: normalizeNumeric(filters.value.minInstances),
      maxInstances: normalizeNumeric(filters.value.maxInstances),
      activeState: filters.value.activeState || undefined
    })
    users.value = response.users || []
    total.value = response.total || 0
    totalPages.value = response.totalPages || 1
    selectedUserIds.value = selectedUserIds.value.filter(id => users.value.some(user => user.id === id))
  } catch (error: any) {
    toast.error(t('userLifecycle.messages.usersLoadFailed', { error: error.message }))
  } finally {
    loading.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadOverview(), loadUsers()])
}

async function refreshSegments() {
  actionLoading.value = true
  try {
    await api.userLifecycle.refreshSegments()
    toast.success(t('userLifecycle.messages.segmentsRefreshed'))
    await refreshAll()
  } catch (error: any) {
    toast.error(t('userLifecycle.messages.segmentsRefreshFailed', { error: error.message }))
  } finally {
    actionLoading.value = false
  }
}

async function syncEvents() {
  actionLoading.value = true
  try {
    const result = await api.userLifecycle.syncEvents()
    toast.success(t('userLifecycle.messages.eventsSynced', { count: result.synced }))
    await loadSelectedUser()
  } catch (error: any) {
    toast.error(t('userLifecycle.messages.eventsSyncFailed', { error: error.message }))
  } finally {
    actionLoading.value = false
  }
}

async function openUser(user: UserLifecycleListUser) {
  selectedUser.value = null
  try {
    selectedUser.value = await api.userLifecycle.summary(user.id)
    tagForm.value = { tagKey: 'new_user', note: '' }
  } catch (error: any) {
    toast.error(t('userLifecycle.messages.summaryLoadFailed', { error: error.message }))
  }
}

async function loadSelectedUser() {
  if (!selectedUser.value) return
  selectedUser.value = await api.userLifecycle.summary(selectedUser.value.id)
}

function toggleSelect(userId: number) {
  selectedUserIds.value = selectedUserIds.value.includes(userId)
    ? selectedUserIds.value.filter(id => id !== userId)
    : [...selectedUserIds.value, userId]
}

async function addTag() {
  if (!selectedUser.value) return
  actionLoading.value = true
  try {
    await api.userLifecycle.addTag(selectedUser.value.id, {
      tagKey: tagForm.value.tagKey,
      note: tagForm.value.note || undefined
    })
    toast.success(t('userLifecycle.messages.tagAdded'))
    await Promise.all([loadSelectedUser(), loadOverview(), loadUsers()])
  } catch (error: any) {
    toast.error(t('userLifecycle.messages.tagAddFailed', { error: error.message }))
  } finally {
    actionLoading.value = false
  }
}

async function removeTag(tagKey: string) {
  if (!selectedUser.value) return
  actionLoading.value = true
  try {
    await api.userLifecycle.removeTag(selectedUser.value.id, tagKey)
    toast.success(t('userLifecycle.messages.tagRemoved'))
    await Promise.all([loadSelectedUser(), loadOverview(), loadUsers()])
  } catch (error: any) {
    toast.error(t('userLifecycle.messages.tagRemoveFailed', { error: error.message }))
  } finally {
    actionLoading.value = false
  }
}

async function issueRedeemCode() {
  if (!selectedUser.value) return
  const hostId = Number(codeForm.value.hostId)
  const codeValue = Number(codeForm.value.codeValue)
  const expiresInDays = Number(codeForm.value.expiresInDays)
  if (!Number.isSafeInteger(hostId) || hostId <= 0 || !Number.isSafeInteger(codeValue) || codeValue <= 0 || !Number.isSafeInteger(expiresInDays)) {
    toast.error(t('userLifecycle.messages.invalidRedeemCode'))
    return
  }
  actionLoading.value = true
  try {
    const result = await api.userLifecycle.issueRedeemCode(selectedUser.value.id, {
      hostId,
      codeType: codeForm.value.codeType as 'c' | 'r' | 'd' | 't',
      codeValue,
      expiresInDays,
      remark: codeForm.value.remark || undefined
    })
    toast.success(t('userLifecycle.messages.redeemCodeIssued', { code: result.code.code }))
    await loadSelectedUser()
  } catch (error: any) {
    toast.error(t('userLifecycle.messages.redeemCodeIssueFailed', { error: error.message }))
  } finally {
    actionLoading.value = false
  }
}

async function sendReminder() {
  if (!hasSelectedUsers.value || !reminderForm.value.confirm) {
    toast.error(t('userLifecycle.messages.selectAndConfirm'))
    return
  }
  actionLoading.value = true
  try {
    const result = await api.userLifecycle.sendReminder({
      userIds: selectedUserIds.value,
      title: reminderForm.value.title,
      content: reminderForm.value.content,
      confirm: reminderForm.value.confirm
    })
    toast.success(t('userLifecycle.messages.remindersSent', { count: result.sent }))
    reminderForm.value.confirm = false
  } catch (error: any) {
    toast.error(t('userLifecycle.messages.reminderSendFailed', { error: error.message }))
  } finally {
    actionLoading.value = false
  }
}

function resetFilters() {
  filters.value = {
    search: '',
    tag: '',
    segment: '',
    minRecharge: '',
    maxRecharge: '',
    minInstances: '',
    maxInstances: '',
    activeState: ''
  }
  page.value = 1
  loadUsers()
}

onMounted(refreshAll)
</script>

<template>
  <div class="kawaii-page nimbus-view space-y-6 p-6 animate-fade-in">
    <header class="flex flex-col gap-4 border-b border-themed pb-5 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex items-start gap-3">
        <span class="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500 sm:flex">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        </span>
        <div>
          <h1 class="text-xl font-semibold text-themed sm:text-2xl">{{ t('userLifecycle.title') }}</h1>
          <p class="mt-1 text-sm text-themed-muted">{{ t('userLifecycle.description') }}</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary" :disabled="actionLoading" @click="syncEvents">{{ t('userLifecycle.syncEvents') }}</button>
        <button class="btn-secondary" :disabled="actionLoading" @click="refreshSegments">{{ t('userLifecycle.refreshSegments') }}</button>
        <button class="btn-primary" :disabled="overviewLoading || loading" @click="refreshAll">{{ t('common.refresh') }}</button>
      </div>
    </header>

    <section class="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <div class="nimbus-stat rounded-xl border border-themed bg-themed-surface p-5">
        <div class="text-xs font-medium uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.metrics.totalUsers') }}</div>
        <div class="mt-2 font-mono text-2xl font-semibold tabular-nums text-themed">{{ overview?.totalUsers ?? '-' }}</div>
      </div>
      <div class="nimbus-stat rounded-xl border border-themed bg-themed-surface p-5">
        <div class="text-xs font-medium uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.metrics.activeUsers') }}</div>
        <div class="mt-2 font-mono text-2xl font-semibold tabular-nums text-themed">{{ overview?.activeUsers ?? '-' }}</div>
      </div>
      <div class="nimbus-stat rounded-xl border border-themed bg-themed-surface p-5">
        <div class="text-xs font-medium uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.metrics.expiringInstances') }}</div>
        <div class="mt-2 font-mono text-2xl font-semibold tabular-nums text-themed">{{ overview?.expiringInstances ?? '-' }}</div>
      </div>
      <div class="nimbus-stat rounded-xl border border-primary-500/30 bg-primary-500/5 p-5">
        <div class="text-xs font-medium uppercase tracking-wide text-primary-600 dark:text-primary-300">{{ t('userLifecycle.metrics.selectedUsers') }}</div>
        <div class="mt-2 font-mono text-2xl font-semibold tabular-nums text-primary-600 dark:text-primary-300">{{ selectedUserIds.length }}</div>
      </div>
    </section>

    <section class="rounded-xl border border-themed bg-themed-surface p-4">
      <div class="text-sm font-medium text-themed">{{ t('userLifecycle.filters.title') }}</div>
      <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input v-model="filters.search" class="input" :placeholder="t('userLifecycle.filters.searchPlaceholder')" />
        <select v-model="filters.tag" class="input">
          <option value="">{{ t('userLifecycle.filters.allTags') }}</option>
          <option v-for="tag in tagDefinitions" :key="tag.key" :value="tag.key">{{ tag.label }}（{{ tag.count || 0 }}）</option>
        </select>
        <select v-model="filters.segment" class="input">
          <option value="">{{ t('userLifecycle.filters.allSegments') }}</option>
          <option v-for="segment in segments" :key="segment.key" :value="segment.key">{{ segment.name }}（{{ segment.count || 0 }}）</option>
        </select>
        <select v-model="filters.activeState" class="input">
          <option value="">{{ t('userLifecycle.filters.allActivityStates') }}</option>
          <option value="active">{{ t('userLifecycle.filters.active') }}</option>
          <option value="inactive">{{ t('userLifecycle.filters.inactive') }}</option>
        </select>
        <input v-model="filters.minRecharge" class="input font-mono tabular-nums" :placeholder="t('userLifecycle.filters.minRecharge')" />
        <input v-model="filters.maxRecharge" class="input font-mono tabular-nums" :placeholder="t('userLifecycle.filters.maxRecharge')" />
        <input v-model="filters.minInstances" class="input font-mono tabular-nums" :placeholder="t('userLifecycle.filters.minInstances')" />
        <input v-model="filters.maxInstances" class="input font-mono tabular-nums" :placeholder="t('userLifecycle.filters.maxInstances')" />
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="btn-primary" @click="page = 1; loadUsers()">{{ t('common.search') }}</button>
        <button class="btn-secondary" @click="resetFilters">{{ t('common.reset') }}</button>
      </div>
    </section>

    <section class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div class="rounded-xl border border-themed bg-themed-surface p-4">
        <div class="text-sm font-medium text-themed">{{ t('userLifecycle.userList') }}</div>
        <div class="mt-3 space-y-2 transition-opacity" :class="loading ? 'opacity-50' : ''">
          <button
            v-for="user in users"
            :key="user.id"
            type="button"
            class="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors"
            :class="selectedUser?.id === user.id ? 'border-primary-500 bg-primary-500/5' : 'border-themed hover:bg-themed-hover'"
            @click="openUser(user)"
          >
            <input :checked="selectedUserIds.includes(user.id)" type="checkbox" class="mt-1 h-4 w-4 shrink-0 rounded accent-primary-500" @click.stop="toggleSelect(user.id)" />
            <div class="min-w-0 flex-1">
              <div class="font-medium text-themed"><span class="font-mono">#{{ user.id }}</span> {{ user.username }}</div>
              <div class="mt-0.5 text-xs text-themed-muted">{{ user.emailMasked || '-' }}</div>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <span v-for="tag in user.tags" :key="tag.tagKey" class="rounded-full bg-primary-500/10 px-2 py-0.5 text-2xs font-medium text-primary-600 dark:text-primary-300">{{ getTagLabel(tag.tagKey) }}</span>
                <span v-for="segment in user.segments" :key="segment.key" class="rounded-full bg-themed-secondary px-2 py-0.5 text-2xs text-themed-muted">{{ segment.name }}</span>
              </div>
            </div>
            <div class="shrink-0 space-y-0.5 text-right text-xs">
              <div class="font-mono font-semibold tabular-nums text-themed">{{ formatMoney(user.metrics?.totalRecharge) }}</div>
              <div class="text-themed-muted">{{ t('userLifecycle.instanceCount', { count: user.metrics?.instanceCount || 0 }) }}</div>
              <div class="text-themed-muted">{{ t('userLifecycle.expiringCount', { count: user.metrics?.expiringSoonInstances || 0 }) }}</div>
            </div>
          </button>
          <div v-if="users.length === 0" class="rounded-xl border border-dashed border-themed p-10 text-center text-sm text-themed-muted">
            <span class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </span>
            {{ t('userLifecycle.noMatchingUsers') }}
          </div>
        </div>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-themed pt-3 text-xs text-themed-muted">
          <span class="font-mono tabular-nums">{{ t('userLifecycle.pagination', { total, page, totalPages }) }}</span>
          <div class="flex gap-2">
            <button class="btn-secondary btn-sm" :disabled="page <= 1" @click="page--; loadUsers()">{{ t('common.prevPage') }}</button>
            <button class="btn-secondary btn-sm" :disabled="page >= totalPages" @click="page++; loadUsers()">{{ t('common.nextPage') }}</button>
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-themed bg-themed-surface p-4">
        <template v-if="selectedUser">
          <div class="text-sm font-medium text-themed">{{ t('userLifecycle.summary.title') }}</div>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div class="rounded-lg border border-themed p-3">
              <span class="text-2xs uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.summary.user') }}</span>
              <strong class="mt-1 block font-medium text-themed"><span class="font-mono">#{{ selectedUser.id }}</span> {{ selectedUser.username }}</strong>
            </div>
            <div class="rounded-lg border border-themed p-3">
              <span class="text-2xs uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.summary.email') }}</span>
              <strong class="mt-1 block font-medium text-themed">{{ selectedUser.emailMasked || '-' }}</strong>
            </div>
            <div class="rounded-lg border border-themed p-3">
              <span class="text-2xs uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.summary.totalRecharge') }}</span>
              <strong class="mt-1 block font-mono font-semibold tabular-nums text-themed">{{ formatMoney(selectedUser.metrics?.totalRecharge) }}</strong>
            </div>
            <div class="rounded-lg border border-themed p-3">
              <span class="text-2xs uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.summary.totalConsume') }}</span>
              <strong class="mt-1 block font-mono font-semibold tabular-nums text-themed">{{ formatMoney(selectedUser.metrics?.totalConsume) }}</strong>
            </div>
            <div class="rounded-lg border border-themed p-3">
              <span class="text-2xs uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.summary.instances') }}</span>
              <strong class="mt-1 block font-medium text-themed">{{ t('userLifecycle.summary.instanceValue', { total: selectedUser.metrics?.instanceCount || 0, running: selectedUser.metrics?.runningInstances || 0 }) }}</strong>
            </div>
            <div class="rounded-lg border border-themed p-3">
              <span class="text-2xs uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.summary.earliestExpiry') }}</span>
              <strong class="mt-1 block font-mono text-xs tabular-nums text-themed">{{ formatDate(selectedUser.metrics?.earliestExpiry) }}</strong>
            </div>
            <div class="rounded-lg border border-themed p-3">
              <span class="text-2xs uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.summary.tickets') }}</span>
              <strong class="mt-1 block font-medium text-themed">{{ t('userLifecycle.summary.ticketValue', { total: selectedUser.tickets.total, open: selectedUser.tickets.open }) }}</strong>
            </div>
            <div class="rounded-lg border border-themed p-3">
              <span class="text-2xs uppercase tracking-wide text-themed-muted">{{ t('userLifecycle.summary.lastLogin') }}</span>
              <strong class="mt-1 block font-mono text-xs tabular-nums text-themed">{{ formatDate(selectedUser.metrics?.lastLoginAt) }}</strong>
            </div>
          </div>

          <div class="mt-6 text-sm font-medium text-themed">{{ t('userLifecycle.tags') }}</div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <span v-for="tag in selectedUser.tags.filter(item => item.active !== false)" :key="tag.tagKey" class="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-0.5 text-xs font-medium text-primary-600 dark:text-primary-300">
              {{ getTagLabel(tag.tagKey) }}
              <button type="button" class="text-primary-500/70 transition-colors hover:text-primary-500" @click="removeTag(tag.tagKey)">
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </span>
          </div>
          <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select v-model="tagForm.tagKey" class="input sm:w-40">
              <option v-for="tag in tagDefinitions" :key="tag.key" :value="tag.key">{{ tag.label }}</option>
            </select>
            <input v-model="tagForm.note" class="input flex-1" :placeholder="t('userLifecycle.optionalNote')" />
            <button class="btn-primary btn-sm shrink-0" :disabled="actionLoading" @click="addTag">{{ t('userLifecycle.addTag') }}</button>
          </div>

          <div class="mt-6 text-sm font-medium text-themed">{{ t('userLifecycle.redeemCode.title') }}</div>
          <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input v-model="codeForm.hostId" class="input font-mono tabular-nums" :placeholder="t('userLifecycle.redeemCode.hostId')" />
            <select v-model="codeForm.codeType" class="input">
              <option value="c">CPU</option>
              <option value="r">{{ t('userLifecycle.redeemCode.memory') }}</option>
              <option value="d">{{ t('userLifecycle.redeemCode.disk') }}</option>
              <option value="t">{{ t('userLifecycle.redeemCode.traffic') }}</option>
            </select>
            <input v-model="codeForm.codeValue" class="input font-mono tabular-nums" :placeholder="t('userLifecycle.redeemCode.value', { unit: getCodeUnit(codeForm.codeType) })" />
            <input v-model="codeForm.expiresInDays" class="input font-mono tabular-nums" :placeholder="t('userLifecycle.redeemCode.validDays')" />
            <input v-model="codeForm.remark" class="input" :placeholder="t('userLifecycle.optionalNote')" />
            <button class="btn-primary btn-sm" :disabled="actionLoading" @click="issueRedeemCode">{{ t('userLifecycle.redeemCode.issue') }}</button>
          </div>
          <div class="mt-3 space-y-2">
            <div v-for="offer in selectedUser.offers" :key="offer.id" class="rounded-lg border border-themed p-3 text-sm">
              <strong class="block font-mono font-semibold text-themed">{{ offer.code }}</strong>
              <span class="mt-1 block text-xs text-themed-muted">{{ offer.host.name }} · {{ offer.codeType }} +{{ offer.codeValue }}{{ getCodeUnit(offer.codeType) }}</span>
              <span class="mt-1 block text-xs text-themed-muted">{{ offer.used ? t('userLifecycle.used') : t('userLifecycle.unused') }} · {{ formatDate(offer.expiresAt) }}</span>
            </div>
          </div>

          <div class="mt-6 text-sm font-medium text-themed">{{ t('userLifecycle.lifecycle') }}</div>
          <div class="mt-3 space-y-2">
            <div v-for="event in selectedUser.events" :key="event.id" class="flex items-center justify-between gap-3 rounded-lg border border-themed p-3 text-sm">
              <strong class="font-medium text-themed">{{ event.eventType }}</strong>
              <span class="font-mono text-xs tabular-nums text-themed-muted">{{ formatDate(event.occurredAt) }}</span>
            </div>
          </div>

          <div class="mt-6 text-sm font-medium text-themed">{{ t('userLifecycle.operations') }}</div>
          <div class="mt-3 space-y-2">
            <div v-for="action in selectedUser.actions" :key="action.id" class="rounded-lg border border-themed p-3 text-sm">
              <strong class="block font-medium text-themed">{{ action.actionType }} · {{ action.status }}</strong>
              <span class="mt-1 block text-xs text-themed-muted">{{ action.actorUsername }} · {{ formatDate(action.createdAt) }}</span>
              <p v-if="action.message" class="mt-1 text-xs text-themed-secondary">{{ action.message }}</p>
            </div>
          </div>
        </template>
        <div v-else class="flex min-h-[220px] flex-col items-center justify-center text-center text-sm text-themed-muted">
          <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-themed-secondary text-themed-faint">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
            </svg>
          </span>
          {{ t('userLifecycle.selectUserHint') }}
        </div>
      </div>
    </section>

    <section class="rounded-xl border border-themed bg-themed-surface p-4">
      <div class="text-sm font-medium text-themed">{{ t('userLifecycle.reminder.title') }}</div>
      <div class="mt-3 grid grid-cols-1 gap-3">
        <input v-model="reminderForm.title" class="input" :placeholder="t('userLifecycle.reminder.titlePlaceholder')" />
        <textarea v-model="reminderForm.content" class="input min-h-[80px] resize-y" :placeholder="t('userLifecycle.reminder.contentPlaceholder')"></textarea>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label class="flex items-center gap-2 text-sm text-themed-secondary">
            <input v-model="reminderForm.confirm" type="checkbox" class="h-4 w-4 rounded accent-primary-500" />
            {{ t('userLifecycle.reminder.confirm', { count: selectedUserIds.length }) }}
          </label>
          <button class="btn-primary shrink-0" :disabled="!hasSelectedUsers || actionLoading" @click="sendReminder">{{ t('userLifecycle.reminder.send') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nimbus-stat {
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-view *,
  .nimbus-view *::before,
  .nimbus-view *::after {
    transition-duration: 0.001ms !important;
    animation-duration: 0.001ms !important;
  }
}
</style>
