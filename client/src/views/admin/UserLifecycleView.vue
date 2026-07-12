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
  <div class="kawaii-page lifecycle-page animate-fade-in">
    <div class="page-header">
      <div>
        <h1>{{ t('userLifecycle.title') }}</h1>
        <p>{{ t('userLifecycle.description') }}</p>
      </div>
      <div class="header-actions">
        <button class="btn secondary" :disabled="actionLoading" @click="syncEvents">{{ t('userLifecycle.syncEvents') }}</button>
        <button class="btn secondary" :disabled="actionLoading" @click="refreshSegments">{{ t('userLifecycle.refreshSegments') }}</button>
        <button class="btn primary" :disabled="overviewLoading || loading" @click="refreshAll">{{ t('common.refresh') }}</button>
      </div>
    </div>

    <section class="overview-grid">
      <div class="metric">
        <span>{{ t('userLifecycle.metrics.totalUsers') }}</span>
        <strong>{{ overview?.totalUsers ?? '-' }}</strong>
      </div>
      <div class="metric">
        <span>{{ t('userLifecycle.metrics.activeUsers') }}</span>
        <strong>{{ overview?.activeUsers ?? '-' }}</strong>
      </div>
      <div class="metric">
        <span>{{ t('userLifecycle.metrics.expiringInstances') }}</span>
        <strong>{{ overview?.expiringInstances ?? '-' }}</strong>
      </div>
      <div class="metric">
        <span>{{ t('userLifecycle.metrics.selectedUsers') }}</span>
        <strong>{{ selectedUserIds.length }}</strong>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">{{ t('userLifecycle.filters.title') }}</div>
      <div class="filter-grid">
        <input v-model="filters.search" :placeholder="t('userLifecycle.filters.searchPlaceholder')" />
        <select v-model="filters.tag">
          <option value="">{{ t('userLifecycle.filters.allTags') }}</option>
          <option v-for="tag in tagDefinitions" :key="tag.key" :value="tag.key">{{ tag.label }}（{{ tag.count || 0 }}）</option>
        </select>
        <select v-model="filters.segment">
          <option value="">{{ t('userLifecycle.filters.allSegments') }}</option>
          <option v-for="segment in segments" :key="segment.key" :value="segment.key">{{ segment.name }}（{{ segment.count || 0 }}）</option>
        </select>
        <select v-model="filters.activeState">
          <option value="">{{ t('userLifecycle.filters.allActivityStates') }}</option>
          <option value="active">{{ t('userLifecycle.filters.active') }}</option>
          <option value="inactive">{{ t('userLifecycle.filters.inactive') }}</option>
        </select>
        <input v-model="filters.minRecharge" :placeholder="t('userLifecycle.filters.minRecharge')" />
        <input v-model="filters.maxRecharge" :placeholder="t('userLifecycle.filters.maxRecharge')" />
        <input v-model="filters.minInstances" :placeholder="t('userLifecycle.filters.minInstances')" />
        <input v-model="filters.maxInstances" :placeholder="t('userLifecycle.filters.maxInstances')" />
      </div>
      <div class="panel-actions">
        <button class="btn primary" @click="page = 1; loadUsers()">{{ t('common.search') }}</button>
        <button class="btn secondary" @click="resetFilters">{{ t('common.reset') }}</button>
      </div>
    </section>

    <section class="workspace">
      <div class="panel users-panel">
        <div class="panel-title">{{ t('userLifecycle.userList') }}</div>
        <div class="user-list" :class="loading ? 'is-loading' : ''">
          <button
            v-for="user in users"
            :key="user.id"
            type="button"
            class="user-row"
            :class="selectedUser?.id === user.id ? 'is-active' : ''"
            @click="openUser(user)"
          >
            <input :checked="selectedUserIds.includes(user.id)" type="checkbox" @click.stop="toggleSelect(user.id)" />
            <div class="user-main">
              <strong>#{{ user.id }} {{ user.username }}</strong>
              <span>{{ user.emailMasked || '-' }}</span>
              <div class="chips">
                <span v-for="tag in user.tags" :key="tag.tagKey" class="chip">{{ getTagLabel(tag.tagKey) }}</span>
                <span v-for="segment in user.segments" :key="segment.key" class="chip muted">{{ segment.name }}</span>
              </div>
            </div>
            <div class="user-metrics">
              <span>{{ formatMoney(user.metrics?.totalRecharge) }}</span>
              <span>{{ t('userLifecycle.instanceCount', { count: user.metrics?.instanceCount || 0 }) }}</span>
              <span>{{ t('userLifecycle.expiringCount', { count: user.metrics?.expiringSoonInstances || 0 }) }}</span>
            </div>
          </button>
          <div v-if="users.length === 0" class="empty">{{ t('userLifecycle.noMatchingUsers') }}</div>
        </div>
        <div class="pagination">
          <span>{{ t('userLifecycle.pagination', { total, page, totalPages }) }}</span>
          <button class="btn secondary" :disabled="page <= 1" @click="page--; loadUsers()">{{ t('common.prevPage') }}</button>
          <button class="btn secondary" :disabled="page >= totalPages" @click="page++; loadUsers()">{{ t('common.nextPage') }}</button>
        </div>
      </div>

      <div class="panel detail-panel">
        <template v-if="selectedUser">
          <div class="panel-title">{{ t('userLifecycle.summary.title') }}</div>
          <div class="summary-grid">
            <div><span>{{ t('userLifecycle.summary.user') }}</span><strong>#{{ selectedUser.id }} {{ selectedUser.username }}</strong></div>
            <div><span>{{ t('userLifecycle.summary.email') }}</span><strong>{{ selectedUser.emailMasked || '-' }}</strong></div>
            <div><span>{{ t('userLifecycle.summary.totalRecharge') }}</span><strong>{{ formatMoney(selectedUser.metrics?.totalRecharge) }}</strong></div>
            <div><span>{{ t('userLifecycle.summary.totalConsume') }}</span><strong>{{ formatMoney(selectedUser.metrics?.totalConsume) }}</strong></div>
            <div><span>{{ t('userLifecycle.summary.instances') }}</span><strong>{{ t('userLifecycle.summary.instanceValue', { total: selectedUser.metrics?.instanceCount || 0, running: selectedUser.metrics?.runningInstances || 0 }) }}</strong></div>
            <div><span>{{ t('userLifecycle.summary.earliestExpiry') }}</span><strong>{{ formatDate(selectedUser.metrics?.earliestExpiry) }}</strong></div>
            <div><span>{{ t('userLifecycle.summary.tickets') }}</span><strong>{{ t('userLifecycle.summary.ticketValue', { total: selectedUser.tickets.total, open: selectedUser.tickets.open }) }}</strong></div>
            <div><span>{{ t('userLifecycle.summary.lastLogin') }}</span><strong>{{ formatDate(selectedUser.metrics?.lastLoginAt) }}</strong></div>
          </div>

          <div class="section-title">{{ t('userLifecycle.tags') }}</div>
          <div class="chips block">
            <span v-for="tag in selectedUser.tags.filter(item => item.active !== false)" :key="tag.tagKey" class="chip">
              {{ getTagLabel(tag.tagKey) }}
              <button type="button" @click="removeTag(tag.tagKey)">x</button>
            </span>
          </div>
          <div class="inline-form">
            <select v-model="tagForm.tagKey">
              <option v-for="tag in tagDefinitions" :key="tag.key" :value="tag.key">{{ tag.label }}</option>
            </select>
            <input v-model="tagForm.note" :placeholder="t('userLifecycle.optionalNote')" />
            <button class="btn primary" :disabled="actionLoading" @click="addTag">{{ t('userLifecycle.addTag') }}</button>
          </div>

          <div class="section-title">{{ t('userLifecycle.redeemCode.title') }}</div>
          <div class="inline-form code-form">
            <input v-model="codeForm.hostId" :placeholder="t('userLifecycle.redeemCode.hostId')" />
            <select v-model="codeForm.codeType">
              <option value="c">CPU</option>
              <option value="r">{{ t('userLifecycle.redeemCode.memory') }}</option>
              <option value="d">{{ t('userLifecycle.redeemCode.disk') }}</option>
              <option value="t">{{ t('userLifecycle.redeemCode.traffic') }}</option>
            </select>
            <input v-model="codeForm.codeValue" :placeholder="t('userLifecycle.redeemCode.value', { unit: getCodeUnit(codeForm.codeType) })" />
            <input v-model="codeForm.expiresInDays" :placeholder="t('userLifecycle.redeemCode.validDays')" />
            <input v-model="codeForm.remark" :placeholder="t('userLifecycle.optionalNote')" />
            <button class="btn primary" :disabled="actionLoading" @click="issueRedeemCode">{{ t('userLifecycle.redeemCode.issue') }}</button>
          </div>
          <div class="offer-list">
            <div v-for="offer in selectedUser.offers" :key="offer.id" class="offer-item">
              <strong>{{ offer.code }}</strong>
              <span>{{ offer.host.name }} · {{ offer.codeType }} +{{ offer.codeValue }}{{ getCodeUnit(offer.codeType) }}</span>
              <span>{{ offer.used ? t('userLifecycle.used') : t('userLifecycle.unused') }} · {{ formatDate(offer.expiresAt) }}</span>
            </div>
          </div>

          <div class="section-title">{{ t('userLifecycle.lifecycle') }}</div>
          <div class="timeline">
            <div v-for="event in selectedUser.events" :key="event.id" class="timeline-item">
              <strong>{{ event.eventType }}</strong>
              <span>{{ formatDate(event.occurredAt) }}</span>
            </div>
          </div>

          <div class="section-title">{{ t('userLifecycle.operations') }}</div>
          <div class="timeline">
            <div v-for="action in selectedUser.actions" :key="action.id" class="timeline-item">
              <strong>{{ action.actionType }} · {{ action.status }}</strong>
              <span>{{ action.actorUsername }} · {{ formatDate(action.createdAt) }}</span>
              <p v-if="action.message">{{ action.message }}</p>
            </div>
          </div>
        </template>
        <div v-else class="empty detail-empty">{{ t('userLifecycle.selectUserHint') }}</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">{{ t('userLifecycle.reminder.title') }}</div>
      <div class="reminder-grid">
        <input v-model="reminderForm.title" :placeholder="t('userLifecycle.reminder.titlePlaceholder')" />
        <textarea v-model="reminderForm.content" :placeholder="t('userLifecycle.reminder.contentPlaceholder')"></textarea>
        <label class="confirm-line">
          <input v-model="reminderForm.confirm" type="checkbox" />
          {{ t('userLifecycle.reminder.confirm', { count: selectedUserIds.length }) }}
        </label>
        <button class="btn primary" :disabled="!hasSelectedUsers || actionLoading" @click="sendReminder">{{ t('userLifecycle.reminder.send') }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lifecycle-page {
  padding: 28px;
  color: var(--text-primary);
}

.page-header,
.panel-actions,
.header-actions,
.pagination,
.inline-form,
.confirm-line {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-header {
  justify-content: space-between;
  margin-bottom: 22px;
}

h1 {
  margin: 0;
  font-size: 26px;
}

p {
  margin: 6px 0 0;
  color: var(--text-secondary);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.metric,
.panel {
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: 8px;
}

.metric {
  padding: 18px;
}

.metric span,
.summary-grid span,
.user-main span,
.user-metrics span,
.timeline-item span,
.offer-item span {
  color: var(--text-secondary);
  font-size: 13px;
}

.metric strong {
  display: block;
  margin-top: 8px;
  font-size: 26px;
}

.panel {
  padding: 18px;
  margin-bottom: 16px;
}

.panel-title,
.section-title {
  font-weight: 700;
  margin-bottom: 14px;
}

.section-title {
  margin-top: 22px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

input,
select,
textarea {
  width: 100%;
  min-height: 38px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 8px 10px;
  box-sizing: border-box;
}

textarea {
  min-height: 86px;
  resize: vertical;
}

.btn {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 9px 14px;
  cursor: pointer;
}

.btn.primary {
  background: #111;
  color: white;
  border-color: #111;
}

.btn.secondary {
  background: var(--bg-card);
  color: var(--text-primary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(420px, 0.9fr) minmax(520px, 1.1fr);
  gap: 16px;
}

.user-list {
  display: grid;
  gap: 10px;
}

.user-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 150px;
  gap: 12px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  border-radius: 8px;
  padding: 14px;
  color: var(--text-primary);
}

.user-row.is-active {
  border-color: #111;
}

.user-main,
.user-metrics,
.offer-item,
.timeline-item {
  display: grid;
  gap: 6px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chips.block {
  margin-bottom: 12px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  background: #f2f2f4;
  color: #3a3a40;
  font-size: 12px;
}

.chip.muted {
  background: #f3f4f6;
  color: #4b5563;
}

.chip button {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: inherit;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.summary-grid > div {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  display: grid;
  gap: 6px;
}

.code-form {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  display: grid;
  gap: 10px;
}

.offer-list,
.timeline {
  display: grid;
  gap: 8px;
}

.offer-item,
.timeline-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
}

.timeline-item p {
  margin: 0;
}

.reminder-grid {
  display: grid;
  grid-template-columns: minmax(220px, 0.6fr) minmax(220px, 1fr) auto;
  gap: 10px;
  align-items: start;
}

.reminder-grid textarea {
  grid-column: 1 / -1;
  min-height: 80px;
}

.empty {
  padding: 28px;
  text-align: center;
  color: var(--text-secondary);
}

@media (max-width: 1100px) {
  .overview-grid,
  .filter-grid,
  .workspace,
  .reminder-grid {
    grid-template-columns: 1fr;
  }

  .code-form {
    grid-template-columns: 1fr;
  }
}
</style>
