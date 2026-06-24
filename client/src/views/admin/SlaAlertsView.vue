<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type { SlaAlertEvent, SlaAlertOverview, SlaAlertRule, SlaAlertSeverity, SlaAlertStatus } from '@/types/api'

const toast = useToast()

const loading = ref(true)
const refreshing = ref(false)
const scanning = ref(false)
const actionLoading = ref<string | null>(null)
const overview = ref<SlaAlertOverview | null>(null)
const alerts = ref<SlaAlertEvent[]>([])
const rules = ref<SlaAlertRule[]>([])
const selectedAlertId = ref<number | null>(null)
const actionNote = ref('')
const silenceMinutes = ref(60)
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const totalPages = ref(1)
const statusFilter = ref<'all' | SlaAlertStatus>('all')
const severityFilter = ref<'all' | SlaAlertSeverity>('all')
const moduleFilter = ref('all')
const search = ref('')

const statusOptions: Array<{ value: 'all' | SlaAlertStatus; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'open', label: '未处理' },
  { value: 'investigating', label: '处理中' },
  { value: 'recovered', label: '已恢复' },
  { value: 'ignored', label: '已忽略' }
]

const severityOptions: Array<{ value: 'all' | SlaAlertSeverity; label: string }> = [
  { value: 'all', label: '全部等级' },
  { value: 'critical', label: '严重' },
  { value: 'warning', label: '警告' },
  { value: 'info', label: '提示' }
]

const moduleOptions = computed(() => {
  const modules = new Set(rules.value.map(rule => rule.module))
  alerts.value.forEach(alert => modules.add(alert.module))
  return ['all', ...Array.from(modules).sort()]
})

const summaryCards = computed(() => {
  const summary = overview.value?.summary
  if (!summary) return []
  return [
    { label: '严重告警', value: summary.critical, caption: '未处理或处理中', tone: summary.critical > 0 ? 'danger' : 'success' },
    { label: '待处理', value: summary.open, caption: '需要确认', tone: summary.open > 0 ? 'warning' : 'success' },
    { label: '处理中', value: summary.investigating, caption: '已被接管', tone: summary.investigating > 0 ? 'info' : 'neutral' },
    { label: '启用规则', value: summary.rulesEnabled, caption: '当前扫描规则', tone: 'neutral' }
  ]
})

const selectedAlert = computed(() =>
  alerts.value.find(alert => alert.id === selectedAlertId.value) ||
  overview.value?.recentAlerts.find(alert => alert.id === selectedAlertId.value) ||
  alerts.value[0] ||
  overview.value?.recentAlerts[0] ||
  null
)

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusLabel(status: SlaAlertStatus): string {
  const labels: Record<SlaAlertStatus, string> = {
    open: '未处理',
    investigating: '处理中',
    recovered: '已恢复',
    ignored: '已忽略'
  }
  return labels[status]
}

function severityLabel(severity: SlaAlertSeverity): string {
  const labels: Record<SlaAlertSeverity, string> = {
    critical: '严重',
    warning: '警告',
    info: '提示'
  }
  return labels[severity]
}

function moduleLabel(module: string): string {
  const labels: Record<string, string> = {
    host: '节点',
    agent: 'Agent',
    delivery: '交付',
    payment: '支付',
    notification: '通知',
    mail: '邮件',
    system_update: '版本更新'
  }
  return labels[module] || module
}

function statusClass(status: SlaAlertStatus): string {
  if (status === 'open') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'investigating') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'recovered') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-themed bg-themed-secondary text-themed-muted'
}

function severityClass(severity: SlaAlertSeverity): string {
  if (severity === 'critical') return 'border-red-200 bg-red-50 text-red-700'
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-blue-200 bg-blue-50 text-blue-700'
}

function toneClass(tone: string): string {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-700'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (tone === 'info') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-themed bg-themed-secondary text-themed'
}

function objectLink(alert: SlaAlertEvent): string | null {
  if (!alert.objectId) return null
  if (alert.objectType === 'host' || alert.objectType === 'agent') return `/admin/resources/hosts/${alert.detail?.hostId || alert.objectId}`
  if (alert.objectType === 'task') return `/admin/delivery?search=${alert.objectId}`
  if (alert.objectType === 'order') return `/admin/orders?search=${alert.objectId}`
  if (alert.objectType === 'system_update') return '/admin/system-update'
  if (alert.objectType === 'notification_channel' || alert.objectType === 'telegram' || alert.objectType === 'smtp') return '/admin/logs'
  return null
}

async function loadOverview() {
  overview.value = await api.slaAlerts.overview()
}

async function loadAlerts() {
  const response = await api.slaAlerts.alerts({
    page: page.value,
    pageSize: pageSize.value,
    status: statusFilter.value === 'all' ? undefined : statusFilter.value,
    severity: severityFilter.value === 'all' ? undefined : severityFilter.value,
    module: moduleFilter.value === 'all' ? undefined : moduleFilter.value,
    search: search.value.trim() || undefined
  })
  alerts.value = response.alerts
  total.value = response.total
  totalPages.value = response.totalPages || 1
  if (selectedAlertId.value && !alerts.value.some(alert => alert.id === selectedAlertId.value)) {
    selectedAlertId.value = null
  }
  if (!selectedAlertId.value && alerts.value.length > 0) {
    selectedAlertId.value = alerts.value[0].id
  }
}

async function loadRules() {
  const response = await api.slaAlerts.rules()
  rules.value = response.rules
}

async function refreshAll(silent = false) {
  if (silent) refreshing.value = true
  else loading.value = true
  try {
    await Promise.all([loadOverview(), loadAlerts(), loadRules()])
  } catch (err: any) {
    toast.error('加载 SLA 与告警失败：' + (err?.message || String(err)))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function runScan() {
  if (scanning.value) return
  scanning.value = true
  try {
    const result = await api.slaAlerts.scan()
    toast.success(`扫描完成：新增 ${result.created} 条，合并 ${result.merged} 条`)
    await refreshAll(true)
  } catch (err: any) {
    toast.error('告警扫描失败：' + (err?.message || String(err)))
  } finally {
    scanning.value = false
  }
}

async function runAlertAction(action: 'acknowledge' | 'recovered' | 'ignored' | 'silence') {
  const alert = selectedAlert.value
  if (!alert || actionLoading.value) return
  actionLoading.value = action
  try {
    let response: { alert: SlaAlertEvent }
    if (action === 'acknowledge') {
      response = await api.slaAlerts.acknowledge(alert.id, actionNote.value || null)
      toast.success('已认领告警')
    } else if (action === 'silence') {
      response = await api.slaAlerts.silence(alert.id, silenceMinutes.value, actionNote.value || null)
      toast.success('已静默告警')
    } else {
      response = await api.slaAlerts.resolve(alert.id, action, actionNote.value || null)
      toast.success(action === 'recovered' ? '已标记恢复' : '已忽略告警')
    }
    const index = alerts.value.findIndex(item => item.id === response.alert.id)
    if (index >= 0) alerts.value[index] = response.alert
    actionNote.value = ''
    await loadOverview()
  } catch (err: any) {
    toast.error('告警操作失败：' + (err?.message || String(err)))
  } finally {
    actionLoading.value = null
  }
}

async function toggleRule(rule: SlaAlertRule) {
  try {
    const response = await api.slaAlerts.updateRule(rule.code, { enabled: !rule.enabled })
    const index = rules.value.findIndex(item => item.code === rule.code)
    if (index >= 0) rules.value[index] = response.rule
    toast.success(response.rule.enabled ? '规则已启用' : '规则已停用')
    await loadOverview()
  } catch (err: any) {
    toast.error('更新规则失败：' + (err?.message || String(err)))
  }
}

function applyFilters() {
  page.value = 1
  void refreshAll()
}

function resetFilters() {
  statusFilter.value = 'all'
  severityFilter.value = 'all'
  moduleFilter.value = 'all'
  search.value = ''
  applyFilters()
}

function goPage(nextPage: number) {
  page.value = Math.min(Math.max(nextPage, 1), totalPages.value)
  void refreshAll()
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-themed">SLA 与告警</h1>
        <p class="mt-1 text-sm text-themed-muted">统一查看节点、Agent、交付、支付、通知和 OTA 异常。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-secondary" :disabled="refreshing || loading" @click="refreshAll(true)">
          {{ refreshing ? '刷新中' : '刷新' }}
        </button>
        <button class="btn btn-primary" :disabled="scanning" @click="runScan">
          {{ scanning ? '扫描中' : '立即扫描' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="rounded-lg border border-themed bg-themed-secondary p-8 text-center text-sm text-themed-muted">
      正在加载告警数据...
    </div>

    <template v-else>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div
          v-for="item in summaryCards"
          :key="item.label"
          class="rounded-lg border p-4"
          :class="toneClass(item.tone)"
        >
          <div class="text-sm">{{ item.label }}</div>
          <div class="mt-2 text-2xl font-semibold">{{ item.value }}</div>
          <div class="mt-1 text-xs opacity-80">{{ item.caption }}</div>
        </div>
      </div>

      <div class="rounded-lg border border-themed bg-themed-secondary p-4">
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-[160px_160px_160px_1fr_auto_auto]">
          <select v-model="statusFilter" class="form-select">
            <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
          <select v-model="severityFilter" class="form-select">
            <option v-for="item in severityOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
          <select v-model="moduleFilter" class="form-select">
            <option v-for="item in moduleOptions" :key="item" :value="item">
              {{ item === 'all' ? '全部模块' : moduleLabel(item) }}
            </option>
          </select>
          <input
            v-model="search"
            class="form-input"
            placeholder="搜索告警标题、对象、规则编号..."
            @keyup.enter="applyFilters"
          />
          <button class="btn btn-primary" @click="applyFilters">搜索</button>
          <button class="btn btn-secondary" @click="resetFilters">重置</button>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
        <section class="rounded-lg border border-themed bg-themed-secondary">
          <div class="border-b border-themed p-4">
            <div class="font-medium text-themed">告警事件</div>
            <div class="mt-1 text-xs text-themed-muted">共 {{ total }} 条记录</div>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-themed text-sm">
              <thead>
                <tr class="text-left text-xs text-themed-muted">
                  <th class="px-4 py-3 font-medium">等级</th>
                  <th class="px-4 py-3 font-medium">状态</th>
                  <th class="px-4 py-3 font-medium">模块</th>
                  <th class="px-4 py-3 font-medium">告警</th>
                  <th class="px-4 py-3 font-medium">次数</th>
                  <th class="px-4 py-3 font-medium">最近触发</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-themed">
                <tr
                  v-for="alert in alerts"
                  :key="alert.id"
                  class="cursor-pointer hover:bg-themed-tertiary"
                  :class="selectedAlertId === alert.id ? 'bg-themed-tertiary' : ''"
                  @click="selectedAlertId = alert.id"
                >
                  <td class="px-4 py-3">
                    <span class="rounded-full border px-2 py-0.5 text-xs" :class="severityClass(alert.severity)">
                      {{ severityLabel(alert.severity) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span class="rounded-full border px-2 py-0.5 text-xs" :class="statusClass(alert.status)">
                      {{ statusLabel(alert.status) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-themed-muted">{{ moduleLabel(alert.module) }}</td>
                  <td class="px-4 py-3">
                    <div class="font-medium text-themed">{{ alert.title }}</div>
                    <div class="mt-1 max-w-xl truncate text-xs text-themed-muted">{{ alert.message }}</div>
                  </td>
                  <td class="px-4 py-3 text-themed-muted">{{ alert.triggerCount }}</td>
                  <td class="px-4 py-3 text-themed-muted">{{ formatDate(alert.lastTriggeredAt) }}</td>
                </tr>
                <tr v-if="alerts.length === 0">
                  <td colspan="6" class="px-4 py-8 text-center text-sm text-themed-muted">暂无匹配告警</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="flex items-center justify-between border-t border-themed p-4 text-sm text-themed-muted">
            <span>第 {{ page }} / {{ totalPages }} 页</span>
            <div class="flex gap-2">
              <button class="btn btn-secondary" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
              <button class="btn btn-secondary" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
            </div>
          </div>
        </section>

        <aside class="space-y-4">
          <section class="rounded-lg border border-themed bg-themed-secondary p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-medium text-themed">告警详情</div>
                <div class="mt-1 text-xs text-themed-muted">最近扫描：{{ formatDate(overview?.summary.lastScanAt) }}</div>
              </div>
              <span
                v-if="selectedAlert"
                class="rounded-full border px-2 py-0.5 text-xs"
                :class="severityClass(selectedAlert.severity)"
              >
                {{ severityLabel(selectedAlert.severity) }}
              </span>
            </div>

            <div v-if="selectedAlert" class="mt-4 space-y-4">
              <div>
                <div class="text-lg font-semibold text-themed">{{ selectedAlert.title }}</div>
                <p class="mt-2 whitespace-pre-wrap text-sm text-themed-muted">{{ selectedAlert.message }}</p>
              </div>

              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-themed-muted">规则</dt>
                  <dd class="mt-1 text-themed">{{ selectedAlert.ruleCode }}</dd>
                </div>
                <div>
                  <dt class="text-themed-muted">状态</dt>
                  <dd class="mt-1 text-themed">{{ statusLabel(selectedAlert.status) }}</dd>
                </div>
                <div>
                  <dt class="text-themed-muted">关联对象</dt>
                  <dd class="mt-1 text-themed">{{ selectedAlert.objectLabel || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-themed-muted">触发次数</dt>
                  <dd class="mt-1 text-themed">{{ selectedAlert.triggerCount }}</dd>
                </div>
                <div>
                  <dt class="text-themed-muted">首次触发</dt>
                  <dd class="mt-1 text-themed">{{ formatDate(selectedAlert.firstTriggeredAt) }}</dd>
                </div>
                <div>
                  <dt class="text-themed-muted">最近触发</dt>
                  <dd class="mt-1 text-themed">{{ formatDate(selectedAlert.lastTriggeredAt) }}</dd>
                </div>
              </dl>

              <RouterLink
                v-if="objectLink(selectedAlert)"
                :to="objectLink(selectedAlert)!"
                class="btn btn-secondary w-full justify-center"
              >
                查看关联对象
              </RouterLink>

              <div class="space-y-3">
                <textarea v-model="actionNote" class="form-textarea min-h-20" placeholder="处理备注"></textarea>
                <div class="grid grid-cols-2 gap-2">
                  <button class="btn btn-secondary" :disabled="!!actionLoading" @click="runAlertAction('acknowledge')">
                    {{ actionLoading === 'acknowledge' ? '处理中' : '认领处理' }}
                  </button>
                  <button class="btn btn-secondary" :disabled="!!actionLoading" @click="runAlertAction('recovered')">
                    {{ actionLoading === 'recovered' ? '处理中' : '标记恢复' }}
                  </button>
                  <button class="btn btn-secondary" :disabled="!!actionLoading" @click="runAlertAction('ignored')">
                    {{ actionLoading === 'ignored' ? '处理中' : '忽略' }}
                  </button>
                  <div class="flex gap-2">
                    <input v-model.number="silenceMinutes" type="number" min="5" max="10080" class="form-input w-24" />
                    <button class="btn btn-secondary flex-1" :disabled="!!actionLoading" @click="runAlertAction('silence')">
                      {{ actionLoading === 'silence' ? '处理中' : '静默' }}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div class="mb-2 text-sm font-medium text-themed">处理记录</div>
                <div class="max-h-64 space-y-2 overflow-auto">
                  <div
                    v-for="action in selectedAlert.actions"
                    :key="action.id"
                    class="rounded border border-themed bg-themed-tertiary p-2 text-xs text-themed-muted"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span>{{ action.actionType }}</span>
                      <span>{{ formatDate(action.createdAt) }}</span>
                    </div>
                    <div v-if="action.actorUsername" class="mt-1">处理人：{{ action.actorUsername }}</div>
                    <div v-if="action.note" class="mt-1 whitespace-pre-wrap">{{ action.note }}</div>
                  </div>
                  <div v-if="selectedAlert.actions.length === 0" class="text-xs text-themed-muted">暂无处理记录</div>
                </div>
              </div>
            </div>

            <div v-else class="mt-4 rounded border border-themed bg-themed-tertiary p-4 text-sm text-themed-muted">
              请选择一条告警查看详情
            </div>
          </section>

          <section class="rounded-lg border border-themed bg-themed-secondary p-4">
            <div class="font-medium text-themed">告警规则</div>
            <div class="mt-3 space-y-2">
              <div
                v-for="rule in rules"
                :key="rule.code"
                class="flex items-center justify-between gap-3 rounded border border-themed bg-themed-tertiary p-3"
              >
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-themed">{{ rule.title }}</div>
                  <div class="mt-1 text-xs text-themed-muted">{{ moduleLabel(rule.module) }} · {{ rule.code }}</div>
                </div>
                <button class="btn btn-secondary shrink-0" @click="toggleRule(rule)">
                  {{ rule.enabled ? '停用' : '启用' }}
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>
