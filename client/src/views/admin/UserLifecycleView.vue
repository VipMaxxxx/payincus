<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type {
  UserLifecycleListUser,
  UserLifecycleOverview,
  UserLifecycleTagDefinition,
  UserLifecycleUserSummary
} from '@/types/api'

const toast = useToast()

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
const reminderForm = ref({ title: '续费提醒', content: '您的服务即将到期，请及时查看实例并完成续费。', confirm: false })

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
    toast.error(`加载生命周期总览失败：${error.message}`)
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
    toast.error(`加载生命周期用户失败：${error.message}`)
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
    toast.success('分群已刷新')
    await refreshAll()
  } catch (error: any) {
    toast.error(`刷新分群失败：${error.message}`)
  } finally {
    actionLoading.value = false
  }
}

async function syncEvents() {
  actionLoading.value = true
  try {
    const result = await api.userLifecycle.syncEvents()
    toast.success(`生命周期事件已同步：${result.synced} 条`)
    await loadSelectedUser()
  } catch (error: any) {
    toast.error(`同步事件失败：${error.message}`)
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
    toast.error(`加载用户摘要失败：${error.message}`)
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
    toast.success('标签已添加')
    await Promise.all([loadSelectedUser(), loadOverview(), loadUsers()])
  } catch (error: any) {
    toast.error(`添加标签失败：${error.message}`)
  } finally {
    actionLoading.value = false
  }
}

async function removeTag(tagKey: string) {
  if (!selectedUser.value) return
  actionLoading.value = true
  try {
    await api.userLifecycle.removeTag(selectedUser.value.id, tagKey)
    toast.success('标签已移除')
    await Promise.all([loadSelectedUser(), loadOverview(), loadUsers()])
  } catch (error: any) {
    toast.error(`移除标签失败：${error.message}`)
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
    toast.error('请填写有效的节点 ID、数值和有效期')
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
    toast.success(`已发放兑换码：${result.code.code}`)
    await loadSelectedUser()
  } catch (error: any) {
    toast.error(`发放兑换码失败：${error.message}`)
  } finally {
    actionLoading.value = false
  }
}

async function sendReminder() {
  if (!hasSelectedUsers.value || !reminderForm.value.confirm) {
    toast.error('请选择用户并勾选确认')
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
    toast.success(`已发送 ${result.sent} 条提醒`)
    reminderForm.value.confirm = false
  } catch (error: any) {
    toast.error(`发送提醒失败：${error.message}`)
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
  <div class="lifecycle-page">
    <div class="page-header">
      <div>
        <h1>用户生命周期</h1>
        <p>围绕注册、首购、续费、到期、流失风险和召回做运营动作。</p>
      </div>
      <div class="header-actions">
        <button class="btn secondary" :disabled="actionLoading" @click="syncEvents">同步事件</button>
        <button class="btn secondary" :disabled="actionLoading" @click="refreshSegments">刷新分群</button>
        <button class="btn primary" :disabled="overviewLoading || loading" @click="refreshAll">刷新</button>
      </div>
    </div>

    <section class="overview-grid">
      <div class="metric">
        <span>用户总数</span>
        <strong>{{ overview?.totalUsers ?? '-' }}</strong>
      </div>
      <div class="metric">
        <span>活跃用户</span>
        <strong>{{ overview?.activeUsers ?? '-' }}</strong>
      </div>
      <div class="metric">
        <span>即将到期实例</span>
        <strong>{{ overview?.expiringInstances ?? '-' }}</strong>
      </div>
      <div class="metric">
        <span>已选用户</span>
        <strong>{{ selectedUserIds.length }}</strong>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">筛选</div>
      <div class="filter-grid">
        <input v-model="filters.search" placeholder="搜索用户名、邮箱、用户 ID" />
        <select v-model="filters.tag">
          <option value="">全部标签</option>
          <option v-for="tag in tagDefinitions" :key="tag.key" :value="tag.key">{{ tag.label }}（{{ tag.count || 0 }}）</option>
        </select>
        <select v-model="filters.segment">
          <option value="">全部分群</option>
          <option v-for="segment in segments" :key="segment.key" :value="segment.key">{{ segment.name }}（{{ segment.count || 0 }}）</option>
        </select>
        <select v-model="filters.activeState">
          <option value="">全部活跃状态</option>
          <option value="active">活跃</option>
          <option value="inactive">不活跃</option>
        </select>
        <input v-model="filters.minRecharge" placeholder="最低累计充值" />
        <input v-model="filters.maxRecharge" placeholder="最高累计充值" />
        <input v-model="filters.minInstances" placeholder="最低实例数" />
        <input v-model="filters.maxInstances" placeholder="最高实例数" />
      </div>
      <div class="panel-actions">
        <button class="btn primary" @click="page = 1; loadUsers()">搜索</button>
        <button class="btn secondary" @click="resetFilters">重置</button>
      </div>
    </section>

    <section class="workspace">
      <div class="panel users-panel">
        <div class="panel-title">用户列表</div>
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
              <span>{{ user.metrics?.instanceCount || 0 }} 个实例</span>
              <span>{{ user.metrics?.expiringSoonInstances || 0 }} 个即将到期</span>
            </div>
          </button>
          <div v-if="users.length === 0" class="empty">暂无匹配用户</div>
        </div>
        <div class="pagination">
          <span>共 {{ total }} 条，第 {{ page }}/{{ totalPages }} 页</span>
          <button class="btn secondary" :disabled="page <= 1" @click="page--; loadUsers()">上一页</button>
          <button class="btn secondary" :disabled="page >= totalPages" @click="page++; loadUsers()">下一页</button>
        </div>
      </div>

      <div class="panel detail-panel">
        <template v-if="selectedUser">
          <div class="panel-title">用户摘要</div>
          <div class="summary-grid">
            <div><span>用户</span><strong>#{{ selectedUser.id }} {{ selectedUser.username }}</strong></div>
            <div><span>邮箱</span><strong>{{ selectedUser.emailMasked || '-' }}</strong></div>
            <div><span>累计充值</span><strong>{{ formatMoney(selectedUser.metrics?.totalRecharge) }}</strong></div>
            <div><span>累计消费</span><strong>{{ formatMoney(selectedUser.metrics?.totalConsume) }}</strong></div>
            <div><span>实例</span><strong>{{ selectedUser.metrics?.instanceCount || 0 }} / 运行 {{ selectedUser.metrics?.runningInstances || 0 }}</strong></div>
            <div><span>最早到期</span><strong>{{ formatDate(selectedUser.metrics?.earliestExpiry) }}</strong></div>
            <div><span>工单</span><strong>{{ selectedUser.tickets.total }} / 未结 {{ selectedUser.tickets.open }}</strong></div>
            <div><span>最后登录</span><strong>{{ formatDate(selectedUser.metrics?.lastLoginAt) }}</strong></div>
          </div>

          <div class="section-title">标签</div>
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
            <input v-model="tagForm.note" placeholder="备注，可选" />
            <button class="btn primary" :disabled="actionLoading" @click="addTag">添加标签</button>
          </div>

          <div class="section-title">定向资源兑换码</div>
          <div class="inline-form code-form">
            <input v-model="codeForm.hostId" placeholder="节点 ID" />
            <select v-model="codeForm.codeType">
              <option value="c">CPU</option>
              <option value="r">内存</option>
              <option value="d">磁盘</option>
              <option value="t">流量</option>
            </select>
            <input v-model="codeForm.codeValue" :placeholder="`数值（${getCodeUnit(codeForm.codeType)}）`" />
            <input v-model="codeForm.expiresInDays" placeholder="有效天数" />
            <input v-model="codeForm.remark" placeholder="备注，可选" />
            <button class="btn primary" :disabled="actionLoading" @click="issueRedeemCode">发放</button>
          </div>
          <div class="offer-list">
            <div v-for="offer in selectedUser.offers" :key="offer.id" class="offer-item">
              <strong>{{ offer.code }}</strong>
              <span>{{ offer.host.name }} · {{ offer.codeType }} +{{ offer.codeValue }}{{ getCodeUnit(offer.codeType) }}</span>
              <span>{{ offer.used ? '已使用' : '未使用' }} · {{ formatDate(offer.expiresAt) }}</span>
            </div>
          </div>

          <div class="section-title">生命周期</div>
          <div class="timeline">
            <div v-for="event in selectedUser.events" :key="event.id" class="timeline-item">
              <strong>{{ event.eventType }}</strong>
              <span>{{ formatDate(event.occurredAt) }}</span>
            </div>
          </div>

          <div class="section-title">运营动作</div>
          <div class="timeline">
            <div v-for="action in selectedUser.actions" :key="action.id" class="timeline-item">
              <strong>{{ action.actionType }} · {{ action.status }}</strong>
              <span>{{ action.actorUsername }} · {{ formatDate(action.createdAt) }}</span>
              <p v-if="action.message">{{ action.message }}</p>
            </div>
          </div>
        </template>
        <div v-else class="empty detail-empty">选择一个用户查看商业摘要和运营动作。</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">批量提醒</div>
      <div class="reminder-grid">
        <input v-model="reminderForm.title" placeholder="提醒标题" />
        <textarea v-model="reminderForm.content" placeholder="提醒内容"></textarea>
        <label class="confirm-line">
          <input v-model="reminderForm.confirm" type="checkbox" />
          确认向已选 {{ selectedUserIds.length }} 个用户发送站内提醒
        </label>
        <button class="btn primary" :disabled="!hasSelectedUsers || actionLoading" @click="sendReminder">发送提醒</button>
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
  background: #e8f7ef;
  color: #0f7a3b;
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
  grid-template-columns: 90px 90px 110px 110px minmax(0, 1fr) auto;
  display: grid;
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
  grid-template-columns: minmax(220px, 0.4fr) minmax(360px, 1fr) minmax(220px, 0.5fr) auto;
  gap: 10px;
  align-items: start;
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
