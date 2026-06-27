<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api, {
  type ResourceRiskEvidenceDetail,
  type ResourceRiskEvent,
  type ResourceRiskPolicy,
  type ResourceRiskState,
  type UserOrderRestrictionRecord
} from '@/api/admin'
import { useToast } from '@/stores/toast'

type TabKey = 'instances' | 'events' | 'restrictions' | 'policy'
interface QosTierForm {
  level: number
  bandwidthMbps: number
  score: number
}

interface PageState {
  page: number
  pageSize: number
  total: number
}

interface ManualRestrictionContext {
  id: number
  userId?: number
  ticketId: number | null
  sourceInstanceId: number | null
  user?: { id: number; username: string }
  sourceInstance?: { id: number; name: string; status: string } | null
}

type ManualActionType =
  | 'qos'
  | 'suspend'
  | 'unsuspend'
  | 'order-restrict'
  | 'release-state-restriction'
  | 'release-instance'
  | 'release-restriction'

interface ManualActionContext {
  type: ManualActionType
  title: string
  description: string
  confirmLabel: string
  reasonPlaceholder: string
  defaultReason: string
  item?: ResourceRiskState
  restriction?: ManualRestrictionContext
  bandwidthMbps?: number
  restrictOrders?: boolean
  notifyUser?: boolean
  danger?: boolean
}

const toast = useToast()
const loading = ref(true)
const saving = ref(false)
const manualSubmitting = ref(false)
const activeTab = ref<TabKey>('instances')
const overview = ref<{ totalStates: number; highRisk: number; activeRestrictions: number } | null>(null)
const instances = ref<ResourceRiskState[]>([])
const events = ref<ResourceRiskEvent[]>([])
const restrictions = ref<UserOrderRestrictionRecord[]>([])
const instancesPage = ref<PageState>({ page: 1, pageSize: 10, total: 0 })
const eventsPage = ref<PageState>({ page: 1, pageSize: 10, total: 0 })
const restrictionsPage = ref<PageState>({ page: 1, pageSize: 10, total: 0 })
const policy = ref<ResourceRiskPolicy | null>(null)
const policyForm = ref({
  enabled: true,
  bandwidthWindowMinutes: 60,
  bandwidthActiveMinutes: 45,
  bandwidthThresholdMbps: 100,
  cpuWindowMinutes: 60,
  cpuActiveMinutes: 45,
  cpuThresholdPercent: 90,
  ppsThreshold: 20000,
  orderRestrictScore: 70,
  autoSuspendScore: 90,
  autoSuspendEnabled: false,
  accountOrderRestrictEnabled: true,
  qosTiers: [
    { level: 1, bandwidthMbps: 50, score: 50 },
    { level: 2, bandwidthMbps: 30, score: 65 },
    { level: 3, bandwidthMbps: 10, score: 80 }
  ] as QosTierForm[]
})
const manualAction = ref<ManualActionContext | null>(null)
const evidenceDetail = ref<ResourceRiskEvidenceDetail | null>(null)
const evidenceLoading = ref(false)
const manualReason = ref('')
const manualBandwidthMbps = ref<number | null>(null)
const manualRestrictOrders = ref(true)
const manualNotifyUser = ref(false)
const manualConfirmChecked = ref(false)

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'instances', label: '实例风险' },
  { key: 'events', label: '事件流水' },
  { key: 'restrictions', label: '下单限制' },
  { key: 'policy', label: '策略配置' }
]

const highRiskCount = computed(() => overview.value?.highRisk || 0)
const activeRestrictionCount = computed(() => overview.value?.activeRestrictions || 0)
const manualActionTargetLabel = computed(() => {
  const context = manualAction.value
  if (!context) return '-'
  if (context.item) {
    const instance = context.item.instance?.name || `实例 #${context.item.instanceId}`
    const user = context.item.user?.username || `用户 #${context.item.userId}`
    return `${instance} / ${user}`
  }
  if (context.restriction) {
    const user = context.restriction.user?.username || (context.restriction.userId ? `用户 #${context.restriction.userId}` : '未知用户')
    const instance = context.restriction.sourceInstance?.name || (context.restriction.sourceInstanceId ? `实例 #${context.restriction.sourceInstanceId}` : '未知来源实例')
    return `${user} / ${instance}`
  }
  return '-'
})
const canSubmitManualAction = computed(() => {
  const context = manualAction.value
  if (!context || manualSubmitting.value || !manualConfirmChecked.value || !manualReason.value.trim()) return false
  if (context.type === 'qos') {
    return Number.isFinite(Number(manualBandwidthMbps.value)) && Number(manualBandwidthMbps.value) > 0
  }
  return true
})
const manualReasonTemplates = computed(() => {
  switch (manualAction.value?.type) {
    case 'qos':
      return [
        '持续带宽占用超过当前策略阈值，先执行人工限速并继续观察。',
        '短时间内 PPS 或小包比例异常，先限制带宽并要求用户说明用途。',
        '节点资源压力较高，临时限速该实例以保护同节点其他实例。'
      ]
    case 'suspend':
      return [
        '疑似扫描或异常发包，先暂停实例并同步限制账号下单，等待工单审核。',
        '长期 CPU 或带宽高占用且影响节点稳定，先暂停实例进行人工复核。',
        '多次触发高风险风控事件，先封禁实例并通知用户提交用途说明。'
      ]
    case 'unsuspend':
    case 'release-instance':
      return [
        '用户已通过工单说明用途，风险已排除，解除实例风控处置。',
        '近期指标恢复正常，人工复核通过，恢复实例正常状态。',
        '误判复核成立，解除限制并保留本次审计记录。'
      ]
    case 'order-restrict':
      return [
        '当前实例触发高风险资源风控，限制账号继续下单并要求工单审核。',
        '同一账号实例存在异常发包风险，暂停新购实例直到人工复核完成。',
        '疑似规避资源限制或安全风险，先限制下单并通知用户说明用途。'
      ]
    case 'release-state-restriction':
    case 'release-restriction':
      return [
        '工单人工审核通过，当前来源实例风险已处理，解除下单限制。',
        '用户已整改异常行为，观察期内未再次触发风险，解除下单限制。',
        '限单来源确认误判，解除限制并保留复核记录。'
      ]
    default:
      return []
  }
})

function totalPages(pageState: PageState): number {
  return Math.max(1, Math.ceil(pageState.total / pageState.pageSize))
}

function pageSummary(pageState: PageState): string {
  if (pageState.total === 0) return '共 0 条'
  const start = (pageState.page - 1) * pageState.pageSize + 1
  const end = Math.min(pageState.total, pageState.page * pageState.pageSize)
  return `第 ${start}-${end} 条 / 共 ${pageState.total} 条`
}

function isSuspendedRisk(item: ResourceRiskState): boolean {
  return item.status === 'manual_suspended' || item.instance?.status === 'suspended'
}

function hasActiveOrderRestriction(item: ResourceRiskState): boolean {
  return item.activeOrderRestriction?.status === 'active'
}

function hasOtherActiveOrderRestriction(item: ResourceRiskState): boolean {
  return !hasActiveOrderRestriction(item) && item.activeAccountOrderRestriction?.status === 'active'
}

function isNormalRisk(item: ResourceRiskState): boolean {
  return item.status === 'normal' && item.level === 'normal' && item.score === 0 && !item.currentBandwidthLimit
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatTrendBucket(value: string | null | undefined, granularity: 'hour' | 'day'): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  if (granularity === 'day') return date.toLocaleDateString()
  return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function badgeClass(level: string): string {
  if (level === 'critical') return 'badge badge-error'
  if (level === 'high') return 'badge badge-warning'
  if (level === 'limited') return 'badge badge-info'
  if (level === 'watch') return 'badge badge-warning'
  return 'badge badge-success'
}

function formatMetric(value: number | null | undefined, unit = ''): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return `${Number(value).toFixed(2)}${unit}`
}

function formatBytes(value: string | number | null | undefined): string {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = numeric
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

function stringifyEvidence(value: unknown): string {
  if (!value || (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)) return '-'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'instance'
}

function applyManualReasonTemplate(template: string) {
  manualReason.value = template
}

function exportEvidenceDetail() {
  const detail = evidenceDetail.value
  if (!detail) return

  const instanceName = safeFileName(detail.state.instance?.name || `instance-${detail.state.instanceId}`)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `resource-risk-${instanceName}-${timestamp}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  toast.success('已导出风险证据 JSON')
}

function normalizeQosTiers(): QosTierForm[] | null {
  const levels = new Set<number>()
  const scores = new Set<number>()
  const tiers: QosTierForm[] = []

  for (const row of policyForm.value.qosTiers) {
    const level = Number(row.level)
    const bandwidthMbps = Number(row.bandwidthMbps)
    const score = Number(row.score)
    if (!Number.isInteger(level) || level <= 0) {
      toast.warning('QoS 档位必须是正整数')
      return null
    }
    if (!Number.isFinite(bandwidthMbps) || bandwidthMbps <= 0) {
      toast.warning('QoS 限速 Mbps 必须大于 0')
      return null
    }
    if (!Number.isInteger(score) || score < 1 || score > 100) {
      toast.warning('QoS 触发分数必须在 1-100 之间')
      return null
    }
    if (levels.has(level)) {
      toast.warning(`QoS 档位 ${level} 重复`)
      return null
    }
    if (scores.has(score)) {
      toast.warning(`QoS 触发分数 ${score} 重复`)
      return null
    }
    levels.add(level)
    scores.add(score)
    tiers.push({ level, bandwidthMbps: Math.round(bandwidthMbps), score })
  }

  if (tiers.length === 0) {
    toast.warning('至少需要配置一个 QoS 档位')
    return null
  }

  return tiers.sort((a, b) => a.score - b.score)
}

function addQosTier() {
  const last = [...policyForm.value.qosTiers].sort((a, b) => a.level - b.level).at(-1)
  policyForm.value.qosTiers.push({
    level: (last?.level || 0) + 1,
    bandwidthMbps: Math.max(1, Math.round((last?.bandwidthMbps || 50) / 2)),
    score: Math.min(100, (last?.score || 50) + 10)
  })
}

function removeQosTier(index: number) {
  if (policyForm.value.qosTiers.length <= 1) {
    toast.warning('至少保留一个 QoS 档位')
    return
  }
  policyForm.value.qosTiers.splice(index, 1)
}

function syncPolicyForm(nextPolicy: ResourceRiskPolicy) {
  policy.value = nextPolicy
  policyForm.value = {
    enabled: nextPolicy.enabled,
    bandwidthWindowMinutes: nextPolicy.bandwidthWindowMinutes,
    bandwidthActiveMinutes: nextPolicy.bandwidthActiveMinutes,
    bandwidthThresholdMbps: nextPolicy.bandwidthThresholdMbps,
    cpuWindowMinutes: nextPolicy.cpuWindowMinutes,
    cpuActiveMinutes: nextPolicy.cpuActiveMinutes,
    cpuThresholdPercent: nextPolicy.cpuThresholdPercent,
    ppsThreshold: nextPolicy.ppsThreshold,
    orderRestrictScore: nextPolicy.orderRestrictScore,
    autoSuspendScore: nextPolicy.autoSuspendScore,
    autoSuspendEnabled: nextPolicy.autoSuspendEnabled,
    accountOrderRestrictEnabled: nextPolicy.accountOrderRestrictEnabled,
    qosTiers: (nextPolicy.qosTiers?.length ? nextPolicy.qosTiers : [
      { level: 1, bandwidthMbps: 50, score: 50 },
      { level: 2, bandwidthMbps: 30, score: 65 },
      { level: 3, bandwidthMbps: 10, score: 80 }
    ]).map(item => ({
      level: item.level,
      bandwidthMbps: item.bandwidthMbps,
      score: item.score
    }))
  }
}

async function loadAll() {
  loading.value = true
  try {
    const [overviewRes, policyRes] = await Promise.all([
      api.resourceRisk.overview(),
      api.resourceRisk.getPolicy()
    ])
    overview.value = overviewRes.counters
    syncPolicyForm(policyRes.policy)
    await Promise.all([
      loadInstances(instancesPage.value.page),
      loadEvents(eventsPage.value.page),
      loadRestrictions(restrictionsPage.value.page)
    ])
  } catch (error: any) {
    toast.error(`加载资源风控失败：${error?.message || error}`)
  } finally {
    loading.value = false
  }
}

async function loadOverview() {
  const overviewRes = await api.resourceRisk.overview()
  overview.value = overviewRes.counters
}

async function loadInstances(page = instancesPage.value.page) {
  const res = await api.resourceRisk.listInstances({ page, pageSize: instancesPage.value.pageSize })
  const nextTotalPages = Math.max(1, Math.ceil(res.total / res.pageSize))
  if (res.total > 0 && res.items.length === 0 && res.page > nextTotalPages) {
    await loadInstances(nextTotalPages)
    return
  }
  instances.value = res.items
  instancesPage.value = { page: res.page, pageSize: res.pageSize, total: res.total }
}

async function loadEvents(page = eventsPage.value.page) {
  const res = await api.resourceRisk.listEvents({ page, pageSize: eventsPage.value.pageSize })
  const nextTotalPages = Math.max(1, Math.ceil(res.total / res.pageSize))
  if (res.total > 0 && res.items.length === 0 && res.page > nextTotalPages) {
    await loadEvents(nextTotalPages)
    return
  }
  events.value = res.items
  eventsPage.value = { page: res.page, pageSize: res.pageSize, total: res.total }
}

async function loadRestrictions(page = restrictionsPage.value.page) {
  const res = await api.resourceRisk.listRestrictions({ page, pageSize: restrictionsPage.value.pageSize, status: 'active' })
  const nextTotalPages = Math.max(1, Math.ceil(res.total / res.pageSize))
  if (res.total > 0 && res.items.length === 0 && res.page > nextTotalPages) {
    await loadRestrictions(nextTotalPages)
    return
  }
  restrictions.value = res.items
  restrictionsPage.value = { page: res.page, pageSize: res.pageSize, total: res.total }
}

async function reloadOperationalLists() {
  await Promise.all([
    loadOverview(),
    loadInstances(instancesPage.value.page),
    loadRestrictions(restrictionsPage.value.page),
    loadEvents(eventsPage.value.page)
  ])
}

async function changeInstancesPage(page: number) {
  if (page < 1 || page > totalPages(instancesPage.value) || page === instancesPage.value.page) return
  await loadInstances(page)
}

async function changeEventsPage(page: number) {
  if (page < 1 || page > totalPages(eventsPage.value) || page === eventsPage.value.page) return
  await loadEvents(page)
}

async function changeRestrictionsPage(page: number) {
  if (page < 1 || page > totalPages(restrictionsPage.value) || page === restrictionsPage.value.page) return
  await loadRestrictions(page)
}

function setActiveTab(tab: TabKey) {
  activeTab.value = tab
}

async function savePolicy() {
  const qosTiers = normalizeQosTiers()
  if (!qosTiers) return

  saving.value = true
  try {
    const res = await api.resourceRisk.updatePolicy({
      enabled: policyForm.value.enabled,
      bandwidthWindowMinutes: policyForm.value.bandwidthWindowMinutes,
      bandwidthActiveMinutes: policyForm.value.bandwidthActiveMinutes,
      bandwidthThresholdMbps: policyForm.value.bandwidthThresholdMbps,
      cpuWindowMinutes: policyForm.value.cpuWindowMinutes,
      cpuActiveMinutes: policyForm.value.cpuActiveMinutes,
      cpuThresholdPercent: policyForm.value.cpuThresholdPercent,
      ppsThreshold: policyForm.value.ppsThreshold,
      orderRestrictScore: policyForm.value.orderRestrictScore,
      autoSuspendScore: policyForm.value.autoSuspendScore,
      autoSuspendEnabled: policyForm.value.autoSuspendEnabled,
      accountOrderRestrictEnabled: policyForm.value.accountOrderRestrictEnabled,
      qosTiers
    })
    syncPolicyForm(res.policy)
    toast.success('资源风控策略已保存')
  } catch (error: any) {
    toast.error(`保存失败：${error?.message || error}`)
  } finally {
    saving.value = false
  }
}

function openManualAction(context: ManualActionContext) {
  manualAction.value = context
  manualReason.value = context.defaultReason
  manualBandwidthMbps.value = context.bandwidthMbps ?? null
  manualRestrictOrders.value = context.restrictOrders ?? true
  manualNotifyUser.value = context.notifyUser ?? false
  manualConfirmChecked.value = false
}

function closeManualAction(force = false) {
  if (manualSubmitting.value && !force) return
  manualAction.value = null
  manualReason.value = ''
  manualBandwidthMbps.value = null
  manualRestrictOrders.value = true
  manualNotifyUser.value = false
  manualConfirmChecked.value = false
}

function manualQos(item: ResourceRiskState) {
  openManualAction({
    type: 'qos',
    title: '人工限速',
    description: '将当前实例带宽降到指定 Mbps，可同时限制关联账号继续下单。',
    confirmLabel: '确认限速',
    reasonPlaceholder: '例如：持续占用带宽超过策略阈值，先人工限速观察',
    defaultReason: item.reason || '资源占用过高，人工限速',
    bandwidthMbps: Number(item.currentBandwidthLimit) > 0 ? Number(item.currentBandwidthLimit) : 30,
    restrictOrders: true,
    item
  })
}

function manualSuspend(item: ResourceRiskState) {
  openManualAction({
    type: 'suspend',
    title: '人工封禁实例',
    description: '暂停该实例并记录资源风控事件，可同时限制关联账号继续下单。',
    confirmLabel: '确认封禁',
    reasonPlaceholder: '例如：疑似扫描、发包异常或长期高占用，需工单审核',
    defaultReason: item.reason || '资源风控人工封禁',
    restrictOrders: true,
    notifyUser: true,
    danger: true,
    item
  })
}

function manualUnsuspend(item: ResourceRiskState) {
  openManualAction({
    type: 'unsuspend',
    title: '解除实例封禁',
    description: '恢复该实例的人工封禁状态，并保留本次人工审核结论。',
    confirmLabel: '确认解除',
    reasonPlaceholder: '例如：用户已说明用途，风险已排除',
    defaultReason: '人工审核通过',
    notifyUser: true,
    item
  })
}

function manualOrderRestrict(item: ResourceRiskState) {
  openManualAction({
    type: 'order-restrict',
    title: '限制账号下单',
    description: '以当前实例作为来源限制关联账号继续购买新实例。',
    confirmLabel: '确认限单',
    reasonPlaceholder: '例如：该实例触发高风险资源风控，需工单人工审核',
    defaultReason: '实例触发人工资源风控审核',
    danger: true,
    item
  })
}

function releaseOrderRestrictionFromState(item: ResourceRiskState) {
  const restriction = item.activeOrderRestriction
  if (!restriction) return
  openManualAction({
    type: 'release-state-restriction',
    title: '解除当前实例限单',
    description: '只释放当前来源实例创建的 active 限单；同账号其他实例触发的限单不会被释放。',
    confirmLabel: '确认解除限单',
    reasonPlaceholder: '例如：工单审核通过，当前来源实例风险已处理',
    defaultReason: '工单人工审核通过',
    item,
    restriction
  })
}

async function evaluateInstance(item: ResourceRiskState) {
  try {
    await api.resourceRisk.evaluateInstance(item.instanceId)
    toast.success('已重新评估实例风险')
    await reloadOperationalLists()
  } catch (error: any) {
    toast.error(`评估失败：${error?.message || error}`)
  }
}

async function openEvidence(item: ResourceRiskState) {
  evidenceLoading.value = true
  evidenceDetail.value = null
  try {
    evidenceDetail.value = await api.resourceRisk.evidence(item.instanceId)
  } catch (error: any) {
    toast.error(`加载证据失败：${error?.message || error}`)
  } finally {
    evidenceLoading.value = false
  }
}

function closeEvidence() {
  evidenceDetail.value = null
}

function releaseInstance(item: ResourceRiskState) {
  openManualAction({
    type: 'release-instance',
    title: '解除实例风控',
    description: '清理当前实例的风控处置状态，保留事件和审计记录。',
    confirmLabel: '确认解除风控',
    reasonPlaceholder: '例如：指标恢复正常，人工复核通过',
    defaultReason: '人工审核通过',
    item
  })
}

function releaseRestriction(item: UserOrderRestrictionRecord) {
  openManualAction({
    type: 'release-restriction',
    title: '解除下单限制',
    description: '释放这条下单限制记录；如果同账号仍有其他 active 限制，账号仍不能下单。',
    confirmLabel: '确认解除限单',
    reasonPlaceholder: '例如：工单审核通过，来源实例风险已处理',
    defaultReason: '工单人工审核通过',
    restriction: item
  })
}

async function submitManualAction() {
  const context = manualAction.value
  if (!context || !canSubmitManualAction.value) return

  const reason = manualReason.value.trim()
  manualSubmitting.value = true
  try {
    if (context.type === 'qos' && context.item) {
      await api.resourceRisk.manualQos(context.item.instanceId, {
        bandwidthMbps: Math.round(Number(manualBandwidthMbps.value)),
        reason,
        restrictOrders: manualRestrictOrders.value
      })
      toast.success('已人工限速')
    } else if (context.type === 'suspend' && context.item) {
      await api.resourceRisk.manualSuspend(context.item.instanceId, {
        reason,
        restrictOrders: manualRestrictOrders.value,
        notifyUser: manualNotifyUser.value
      })
      toast.success('实例已人工封禁')
    } else if (context.type === 'unsuspend' && context.item) {
      await api.resourceRisk.manualUnsuspend(context.item.instanceId, {
        reason,
        notifyUser: manualNotifyUser.value
      })
      toast.success('实例已解除封禁')
    } else if (context.type === 'order-restrict' && context.item) {
      await api.resourceRisk.manualOrderRestrict(context.item.instanceId, reason)
      toast.success('已限制账号下单')
    } else if (context.type === 'release-instance' && context.item) {
      await api.resourceRisk.releaseInstance(context.item.instanceId, reason)
      toast.success('实例风控已解除')
    } else if ((context.type === 'release-state-restriction' || context.type === 'release-restriction') && context.restriction) {
      await api.resourceRisk.releaseRestriction(context.restriction.id, {
        reason,
        ticketId: context.restriction.ticketId
      })
      toast.success('下单限制已解除')
    }
    await reloadOperationalLists()
    closeManualAction(true)
  } catch (error: any) {
    toast.error(`操作失败：${error?.message || error}`)
  } finally {
    manualSubmitting.value = false
  }
}

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <div class="space-y-6 p-6">
    <header class="flex flex-col gap-4 border-b border-themed pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="page-title">资源风控</h1>
        <p class="mt-1 text-sm text-themed-muted">实例级评分、QoS 降档、CPU/发包监控与账号下单审核。</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadAll">刷新</button>
    </header>

    <div v-if="loading" class="py-16 text-center text-themed-muted">加载中...</div>

    <template v-else>
      <section class="grid gap-3 md:grid-cols-3">
        <div class="card p-4">
          <div class="text-xs text-themed-muted">纳入评分实例</div>
          <div class="mt-2 text-2xl font-semibold text-themed">{{ overview?.totalStates || 0 }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-themed-muted">高风险实例</div>
          <div class="mt-2 text-2xl font-semibold text-amber-600">{{ highRiskCount }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-themed-muted">限制下单账号</div>
          <div class="mt-2 text-2xl font-semibold text-red-600">{{ activeRestrictionCount }}</div>
        </div>
      </section>

      <nav class="flex flex-wrap gap-2 border-b border-themed">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="[
            'px-3 py-2 text-sm font-medium',
            activeTab === tab.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-themed-muted hover:text-themed'
          ]"
          @click="setActiveTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <section v-if="activeTab === 'instances'" class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-themed-secondary text-themed-muted">
              <tr>
                <th class="p-3 text-left">实例</th>
                <th class="p-3 text-left">用户</th>
                <th class="p-3 text-left">节点</th>
                <th class="p-3 text-left">评分</th>
                <th class="p-3 text-left">状态</th>
                <th class="p-3 text-left">限速</th>
                <th class="p-3 text-left">原因</th>
                <th class="p-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in instances" :key="item.id" class="border-t border-themed">
                <td class="p-3 font-medium text-themed">{{ item.instance?.name || item.instanceId }}</td>
                <td class="p-3 text-themed-secondary">{{ item.user?.username || item.userId }}</td>
                <td class="p-3 text-themed-secondary">{{ item.host?.name || item.hostId }}</td>
                <td class="p-3">
                  <span :class="badgeClass(item.level)">{{ item.score }}</span>
                </td>
                <td class="p-3 text-themed-secondary">{{ item.status }}</td>
                <td class="p-3 text-themed-secondary">{{ item.currentBandwidthLimit || '-' }}</td>
                <td class="max-w-sm truncate p-3 text-themed-muted">{{ item.reason || '-' }}</td>
                <td class="p-3">
                  <div class="flex flex-wrap justify-end gap-2">
                    <button class="btn-secondary px-3 py-1 text-xs" @click="openEvidence(item)">证据</button>
                    <button class="btn-secondary px-3 py-1 text-xs" @click="evaluateInstance(item)">评估</button>
                    <button
                      v-if="!isSuspendedRisk(item)"
                      class="btn-secondary px-3 py-1 text-xs"
                      @click="manualQos(item)"
                    >
                      限速
                    </button>
                    <button
                      v-if="isSuspendedRisk(item)"
                      class="btn-primary px-3 py-1 text-xs"
                      @click="manualUnsuspend(item)"
                    >
                      解除封禁
                    </button>
                    <button
                      v-else
                      class="btn-danger px-3 py-1 text-xs"
                      @click="manualSuspend(item)"
                    >
                      封禁
                    </button>
                    <button
                      v-if="hasActiveOrderRestriction(item)"
                      class="btn-primary px-3 py-1 text-xs"
                      @click="releaseOrderRestrictionFromState(item)"
                    >
                      解除限单
                    </button>
                    <button
                      v-else-if="hasOtherActiveOrderRestriction(item)"
                      class="btn-secondary px-3 py-1 text-xs"
                      disabled
                      title="该账号存在其他实例触发的下单限制，请到下单限制列表按来源实例处理"
                    >
                      账号已限单
                    </button>
                    <button
                      v-else
                      class="btn-secondary px-3 py-1 text-xs"
                      @click="manualOrderRestrict(item)"
                    >
                      限单
                    </button>
                    <button
                      class="btn-secondary px-3 py-1 text-xs"
                      :disabled="isNormalRisk(item)"
                      @click="releaseInstance(item)"
                    >
                      解除风控
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="instances.length === 0">
                <td colspan="8" class="p-8 text-center text-themed-muted">暂无实例风险状态。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-col gap-3 border-t border-themed px-4 py-3 text-sm text-themed-muted md:flex-row md:items-center md:justify-between">
          <span>{{ pageSummary(instancesPage) }}</span>
          <div class="flex items-center gap-2">
            <button
              class="btn-secondary px-3 py-1 text-xs"
              :disabled="instancesPage.page <= 1"
              @click="changeInstancesPage(instancesPage.page - 1)"
            >
              上一页
            </button>
            <span>第 {{ instancesPage.page }} / {{ totalPages(instancesPage) }} 页</span>
            <button
              class="btn-secondary px-3 py-1 text-xs"
              :disabled="instancesPage.page >= totalPages(instancesPage)"
              @click="changeInstancesPage(instancesPage.page + 1)"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'events'" class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-themed-secondary text-themed-muted">
              <tr>
                <th class="p-3 text-left">时间</th>
                <th class="p-3 text-left">实例</th>
                <th class="p-3 text-left">类型</th>
                <th class="p-3 text-left">等级</th>
                <th class="p-3 text-left">评分</th>
                <th class="p-3 text-left">动作</th>
                <th class="p-3 text-left">说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in events" :key="event.id" class="border-t border-themed">
                <td class="p-3 text-themed-muted">{{ formatDate(event.createdAt) }}</td>
                <td class="p-3 text-themed">{{ event.instance?.name || event.instanceId }}</td>
                <td class="p-3 text-themed-secondary">{{ event.type }}</td>
                <td class="p-3"><span :class="badgeClass(event.severity)">{{ event.severity }}</span></td>
                <td class="p-3 text-themed-secondary">{{ event.scoreAfter }} / {{ event.scoreDelta >= 0 ? '+' : '' }}{{ event.scoreDelta }}</td>
                <td class="p-3 text-themed-secondary">{{ event.actionTaken || '-' }}</td>
                <td class="max-w-lg truncate p-3 text-themed-muted">{{ event.message }}</td>
              </tr>
              <tr v-if="events.length === 0">
                <td colspan="7" class="p-8 text-center text-themed-muted">暂无风险事件。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-col gap-3 border-t border-themed px-4 py-3 text-sm text-themed-muted md:flex-row md:items-center md:justify-between">
          <span>{{ pageSummary(eventsPage) }}</span>
          <div class="flex items-center gap-2">
            <button
              class="btn-secondary px-3 py-1 text-xs"
              :disabled="eventsPage.page <= 1"
              @click="changeEventsPage(eventsPage.page - 1)"
            >
              上一页
            </button>
            <span>第 {{ eventsPage.page }} / {{ totalPages(eventsPage) }} 页</span>
            <button
              class="btn-secondary px-3 py-1 text-xs"
              :disabled="eventsPage.page >= totalPages(eventsPage)"
              @click="changeEventsPage(eventsPage.page + 1)"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'restrictions'" class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-themed-secondary text-themed-muted">
              <tr>
                <th class="p-3 text-left">用户</th>
                <th class="p-3 text-left">来源实例</th>
                <th class="p-3 text-left">状态</th>
                <th class="p-3 text-left">工单</th>
                <th class="p-3 text-left">原因</th>
                <th class="p-3 text-left">创建时间</th>
                <th class="p-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in restrictions" :key="item.id" class="border-t border-themed">
                <td class="p-3 font-medium text-themed">{{ item.user?.username || item.userId }}</td>
                <td class="p-3 text-themed-secondary">{{ item.sourceInstance?.name || item.sourceInstanceId || '-' }}</td>
                <td class="p-3"><span :class="item.status === 'active' ? 'badge badge-error' : 'badge badge-success'">{{ item.status }}</span></td>
                <td class="p-3 text-themed-secondary">{{ item.ticketId ? `#${item.ticketId}` : '-' }}</td>
                <td class="max-w-lg truncate p-3 text-themed-muted">{{ item.reason }}</td>
                <td class="p-3 text-themed-muted">{{ formatDate(item.createdAt) }}</td>
                <td class="p-3 text-right">
                  <button class="btn-primary px-3 py-1 text-xs" :disabled="item.status !== 'active'" @click="releaseRestriction(item)">解除</button>
                </td>
              </tr>
              <tr v-if="restrictions.length === 0">
                <td colspan="7" class="p-8 text-center text-themed-muted">暂无下单限制。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-col gap-3 border-t border-themed px-4 py-3 text-sm text-themed-muted md:flex-row md:items-center md:justify-between">
          <span>{{ pageSummary(restrictionsPage) }}</span>
          <div class="flex items-center gap-2">
            <button
              class="btn-secondary px-3 py-1 text-xs"
              :disabled="restrictionsPage.page <= 1"
              @click="changeRestrictionsPage(restrictionsPage.page - 1)"
            >
              上一页
            </button>
            <span>第 {{ restrictionsPage.page }} / {{ totalPages(restrictionsPage) }} 页</span>
            <button
              class="btn-secondary px-3 py-1 text-xs"
              :disabled="restrictionsPage.page >= totalPages(restrictionsPage)"
              @click="changeRestrictionsPage(restrictionsPage.page + 1)"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <section v-else class="rounded-lg border border-themed bg-themed-surface p-5">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label class="flex items-center gap-2 text-sm text-themed">
            <input v-model="policyForm.enabled" type="checkbox" />
            启用资源风控
          </label>
          <label class="flex items-center gap-2 text-sm text-themed">
            <input v-model="policyForm.accountOrderRestrictEnabled" type="checkbox" />
            高风险后限制账号下单
          </label>
          <label class="flex items-center gap-2 text-sm text-themed">
            <input v-model="policyForm.autoSuspendEnabled" type="checkbox" />
            达严重分自动暂停实例
          </label>

          <label class="space-y-1">
            <span class="label">带宽观察窗口（分钟）</span>
            <input v-model.number="policyForm.bandwidthWindowMinutes" class="input w-full" type="number" min="5" />
          </label>
          <label class="space-y-1">
            <span class="label">带宽触发分钟</span>
            <input v-model.number="policyForm.bandwidthActiveMinutes" class="input w-full" type="number" min="1" />
          </label>
          <label class="space-y-1">
            <span class="label">带宽阈值 Mbps</span>
            <input v-model.number="policyForm.bandwidthThresholdMbps" class="input w-full" type="number" min="1" />
          </label>
          <label class="space-y-1">
            <span class="label">CPU 观察窗口（分钟）</span>
            <input v-model.number="policyForm.cpuWindowMinutes" class="input w-full" type="number" min="5" />
          </label>
          <label class="space-y-1">
            <span class="label">CPU 触发分钟</span>
            <input v-model.number="policyForm.cpuActiveMinutes" class="input w-full" type="number" min="1" />
          </label>
          <label class="space-y-1">
            <span class="label">CPU 阈值 %</span>
            <input v-model.number="policyForm.cpuThresholdPercent" class="input w-full" type="number" min="1" />
          </label>
          <label class="space-y-1">
            <span class="label">PPS 阈值</span>
            <input v-model.number="policyForm.ppsThreshold" class="input w-full" type="number" min="1" />
          </label>
          <label class="space-y-1">
            <span class="label">限制下单分数</span>
            <input v-model.number="policyForm.orderRestrictScore" class="input w-full" type="number" min="1" max="100" />
          </label>
          <label class="space-y-1">
            <span class="label">自动暂停分数</span>
            <input v-model.number="policyForm.autoSuspendScore" class="input w-full" type="number" min="1" max="100" />
          </label>
        </div>

        <div class="mt-5 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-themed">QoS 档位</h2>
              <p class="mt-1 text-xs text-themed-muted">每一行都是独立档位，触发分数越高限制越严格。</p>
            </div>
            <button class="btn-secondary px-3 py-1 text-xs" type="button" @click="addQosTier">新增档位</button>
          </div>

          <div class="overflow-x-auto rounded-lg border border-themed">
            <table class="min-w-full text-sm">
              <thead class="bg-themed-secondary text-themed-muted">
                <tr>
                  <th class="p-3 text-left">档位</th>
                  <th class="p-3 text-left">限速 Mbps</th>
                  <th class="p-3 text-left">触发分数</th>
                  <th class="p-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(tier, index) in policyForm.qosTiers" :key="index" class="border-t border-themed">
                  <td class="p-3">
                    <input v-model.number="tier.level" class="input w-28" type="number" min="1" />
                  </td>
                  <td class="p-3">
                    <input v-model.number="tier.bandwidthMbps" class="input w-36" type="number" min="1" />
                  </td>
                  <td class="p-3">
                    <input v-model.number="tier.score" class="input w-32" type="number" min="1" max="100" />
                  </td>
                  <td class="p-3 text-right">
                    <button class="btn-secondary px-3 py-1 text-xs" type="button" @click="removeQosTier(index)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="mt-5 flex justify-end">
          <button class="btn-primary" :disabled="saving" @click="savePolicy">
            {{ saving ? '保存中...' : '保存策略' }}
          </button>
        </div>
      </section>
    </template>

    <div
      v-if="manualAction"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="() => closeManualAction()"
    >
      <form
        class="w-full max-w-xl rounded-lg border border-themed bg-themed-surface shadow-xl"
        @submit.prevent="submitManualAction"
      >
        <div class="border-b border-themed px-5 py-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-themed">{{ manualAction.title }}</h2>
              <p class="mt-1 text-sm text-themed-muted">{{ manualAction.description }}</p>
            </div>
            <button class="btn-secondary px-2 py-1 text-xs" type="button" :disabled="manualSubmitting" @click="() => closeManualAction()">
              关闭
            </button>
          </div>
        </div>

        <div class="space-y-4 px-5 py-4">
          <div class="rounded-lg border border-themed bg-themed-muted/30 p-3 text-sm">
            <div class="text-xs text-themed-muted">处置对象</div>
            <div class="mt-1 font-medium text-themed">{{ manualActionTargetLabel }}</div>
          </div>

          <label v-if="manualAction.type === 'qos'" class="block space-y-1">
            <span class="label">人工限速 Mbps</span>
            <input v-model.number="manualBandwidthMbps" class="input w-full" type="number" min="1" required />
          </label>

          <label
            v-if="manualAction.type === 'qos' || manualAction.type === 'suspend'"
            class="flex items-center gap-2 text-sm text-themed"
          >
            <input v-model="manualRestrictOrders" type="checkbox" />
            同时限制该账号继续下单
          </label>

          <label
            v-if="manualAction.type === 'suspend' || manualAction.type === 'unsuspend'"
            class="flex items-center gap-2 text-sm text-themed"
          >
            <input v-model="manualNotifyUser" type="checkbox" />
            同步通知用户
          </label>

          <label class="block space-y-1">
            <span class="label">操作原因</span>
            <textarea
              v-model="manualReason"
              class="input min-h-[96px] w-full"
              :placeholder="manualAction.reasonPlaceholder"
              required
            />
          </label>

          <div v-if="manualReasonTemplates.length" class="space-y-2">
            <div class="text-xs text-themed-muted">原因模板</div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="template in manualReasonTemplates"
                :key="template"
                class="btn-secondary px-3 py-1 text-xs"
                type="button"
                @click="applyManualReasonTemplate(template)"
              >
                {{ template }}
              </button>
            </div>
          </div>

          <label class="flex items-start gap-2 rounded-lg border border-themed bg-themed-muted/30 p-3 text-sm text-themed">
            <input v-model="manualConfirmChecked" class="mt-1" type="checkbox" />
            <span>确认本次操作会写入资源风控事件和后台审计，且已核对来源实例、账号和工单审核结论。</span>
          </label>
        </div>

        <div class="flex justify-end gap-2 border-t border-themed px-5 py-4">
          <button class="btn-secondary" type="button" :disabled="manualSubmitting" @click="() => closeManualAction()">取消</button>
          <button
            :class="manualAction.danger ? 'btn-danger' : 'btn-primary'"
            type="submit"
            :disabled="!canSubmitManualAction"
          >
            {{ manualSubmitting ? '处理中...' : manualAction.confirmLabel }}
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="evidenceLoading || evidenceDetail"
      class="fixed inset-0 z-[80] flex justify-end bg-black/50 backdrop-blur-[1px]"
      @click.self="closeEvidence"
    >
      <aside class="h-full w-full max-w-4xl overflow-y-auto border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">
        <div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-950">
          <div>
            <h2 class="text-lg font-semibold text-themed">风险证据详情</h2>
            <p class="mt-1 text-sm text-themed-muted">
              {{ evidenceDetail?.state.instance?.name || (evidenceLoading ? '加载中...' : '-') }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="evidenceDetail"
              class="btn-secondary px-3 py-1 text-xs"
              type="button"
              @click="exportEvidenceDetail"
            >
              导出 JSON
            </button>
            <button class="btn-secondary px-3 py-1 text-xs" type="button" @click="closeEvidence">关闭</button>
          </div>
        </div>

        <div v-if="evidenceLoading" class="p-8 text-center text-themed-muted">加载证据中...</div>

        <div v-else-if="evidenceDetail" class="space-y-5 p-5">
          <section class="grid gap-3 md:grid-cols-4">
            <div class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div class="text-xs text-themed-muted">当前评分</div>
              <div class="mt-1 text-2xl font-semibold text-themed">{{ evidenceDetail.state.score }}</div>
            </div>
            <div class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div class="text-xs text-themed-muted">风险等级</div>
              <div class="mt-2"><span :class="badgeClass(evidenceDetail.state.level)">{{ evidenceDetail.state.level }}</span></div>
            </div>
            <div class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div class="text-xs text-themed-muted">当前状态</div>
              <div class="mt-1 text-themed">{{ evidenceDetail.state.status }}</div>
            </div>
            <div class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div class="text-xs text-themed-muted">限速</div>
              <div class="mt-1 text-themed">{{ evidenceDetail.state.currentBandwidthLimit || '-' }}</div>
            </div>
          </section>

          <section class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div class="border-b border-themed px-4 py-3">
              <h3 class="font-semibold text-themed">当前证据快照</h3>
            </div>
            <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words bg-gray-50 p-4 text-xs text-themed-muted dark:bg-gray-950">{{ stringifyEvidence(evidenceDetail.state.evidence) }}</pre>
          </section>

          <section class="grid gap-4 xl:grid-cols-2">
            <div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div class="border-b border-themed px-4 py-3">
                <h3 class="font-semibold text-themed">24 小时趋势</h3>
              </div>
              <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                  <thead class="bg-gray-50 text-themed-muted dark:bg-gray-950">
                    <tr>
                      <th class="p-3 text-left">时间</th>
                      <th class="p-3 text-left">平均/峰值带宽</th>
                      <th class="p-3 text-left">平均/峰值 PPS</th>
                      <th class="p-3 text-left">平均/峰值 CPU</th>
                      <th class="p-3 text-left">流量</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="bucket in evidenceDetail.trends.hourly24h.slice(-12)" :key="bucket.bucketStart" class="border-t border-themed">
                      <td class="p-3 text-themed-muted">{{ formatTrendBucket(bucket.bucketStart, 'hour') }}</td>
                      <td class="p-3 text-themed">{{ formatMetric(bucket.avgTotalMbps, ' Mbps') }} / {{ formatMetric(bucket.maxTotalMbps, ' Mbps') }}</td>
                      <td class="p-3 text-themed">{{ formatMetric(bucket.avgPps) }} / {{ formatMetric(bucket.maxPps) }}</td>
                      <td class="p-3 text-themed">{{ bucket.avgCpuPercent === null ? '-' : formatMetric(bucket.avgCpuPercent, '%') }} / {{ bucket.maxCpuPercent === null ? '-' : formatMetric(bucket.maxCpuPercent, '%') }}</td>
                      <td class="p-3 text-themed-muted">{{ formatBytes(bucket.totalBytes) }}</td>
                    </tr>
                    <tr v-if="evidenceDetail.trends.hourly24h.length === 0">
                      <td colspan="5" class="p-6 text-center text-themed-muted">暂无 24 小时趋势。</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div class="border-b border-themed px-4 py-3">
                <h3 class="font-semibold text-themed">7 天趋势</h3>
              </div>
              <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                  <thead class="bg-gray-50 text-themed-muted dark:bg-gray-950">
                    <tr>
                      <th class="p-3 text-left">日期</th>
                      <th class="p-3 text-left">平均/峰值带宽</th>
                      <th class="p-3 text-left">平均/峰值 PPS</th>
                      <th class="p-3 text-left">平均/峰值 CPU</th>
                      <th class="p-3 text-left">流量</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="bucket in evidenceDetail.trends.daily7d" :key="bucket.bucketStart" class="border-t border-themed">
                      <td class="p-3 text-themed-muted">{{ formatTrendBucket(bucket.bucketStart, 'day') }}</td>
                      <td class="p-3 text-themed">{{ formatMetric(bucket.avgTotalMbps, ' Mbps') }} / {{ formatMetric(bucket.maxTotalMbps, ' Mbps') }}</td>
                      <td class="p-3 text-themed">{{ formatMetric(bucket.avgPps) }} / {{ formatMetric(bucket.maxPps) }}</td>
                      <td class="p-3 text-themed">{{ bucket.avgCpuPercent === null ? '-' : formatMetric(bucket.avgCpuPercent, '%') }} / {{ bucket.maxCpuPercent === null ? '-' : formatMetric(bucket.maxCpuPercent, '%') }}</td>
                      <td class="p-3 text-themed-muted">{{ formatBytes(bucket.totalBytes) }}</td>
                    </tr>
                    <tr v-if="evidenceDetail.trends.daily7d.length === 0">
                      <td colspan="5" class="p-6 text-center text-themed-muted">暂无 7 天趋势。</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div class="border-b border-themed px-4 py-3">
              <h3 class="font-semibold text-themed">最近资源样本</h3>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full text-sm">
                <thead class="bg-gray-50 text-themed-muted dark:bg-gray-950">
                  <tr>
                    <th class="p-3 text-left">采样时间</th>
                    <th class="p-3 text-left">带宽</th>
                    <th class="p-3 text-left">PPS</th>
                    <th class="p-3 text-left">CPU</th>
                    <th class="p-3 text-left">流量增量</th>
                    <th class="p-3 text-left">来源</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="sample in evidenceDetail.samples.slice(0, 12)" :key="sample.id" class="border-t border-themed">
                    <td class="p-3 text-themed-muted">{{ formatDate(sample.sampledAt) }}</td>
                    <td class="p-3 text-themed">{{ formatMetric(sample.totalMbps, ' Mbps') }}</td>
                    <td class="p-3 text-themed">{{ formatMetric(sample.pps) }}</td>
                    <td class="p-3 text-themed">{{ sample.cpuPercent === null ? '-' : formatMetric(sample.cpuPercent, '%') }}</td>
                    <td class="p-3 text-themed-muted">{{ formatBytes(sample.totalBytesDelta) }}</td>
                    <td class="p-3 text-themed-muted">{{ sample.source }}</td>
                  </tr>
                  <tr v-if="evidenceDetail.samples.length === 0">
                    <td colspan="6" class="p-6 text-center text-themed-muted">暂无资源样本。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="grid gap-4 lg:grid-cols-2">
            <div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div class="border-b border-themed px-4 py-3">
                <h3 class="font-semibold text-themed">风险事件时间线</h3>
              </div>
              <div class="max-h-96 overflow-y-auto divide-y divide-themed">
                <div v-for="event in evidenceDetail.events" :key="event.id" class="p-4">
                  <div class="flex items-center justify-between gap-3">
                    <span :class="badgeClass(event.severity)">{{ event.severity }}</span>
                    <span class="text-xs text-themed-muted">{{ formatDate(event.createdAt) }}</span>
                  </div>
                  <div class="mt-2 text-sm font-medium text-themed">{{ event.type }} · {{ event.scoreAfter }} / {{ event.scoreDelta >= 0 ? '+' : '' }}{{ event.scoreDelta }}</div>
                  <p class="mt-1 text-sm text-themed-muted">{{ event.message }}</p>
                  <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs text-themed-muted dark:bg-gray-950">{{ stringifyEvidence(event.evidence) }}</pre>
                </div>
                <div v-if="evidenceDetail.events.length === 0" class="p-6 text-center text-themed-muted">暂无事件。</div>
              </div>
            </div>

            <div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div class="border-b border-themed px-4 py-3">
                <h3 class="font-semibold text-themed">处置审计</h3>
              </div>
              <div class="max-h-96 overflow-y-auto divide-y divide-themed">
                <div v-for="log in evidenceDetail.auditLogs" :key="log.id" class="p-4">
                  <div class="flex items-center justify-between gap-3">
                    <span class="font-mono text-xs text-themed">{{ log.action }}</span>
                    <span class="text-xs text-themed-muted">{{ formatDate(log.createdAt) }}</span>
                  </div>
                  <div class="mt-1 text-xs text-themed-muted">操作人：{{ log.actor?.username || '-' }} · 结果：{{ log.result }}</div>
                  <p class="mt-2 text-sm text-themed-muted">{{ log.content }}</p>
                </div>
                <div v-if="evidenceDetail.auditLogs.length === 0" class="p-6 text-center text-themed-muted">暂无风控审计日志。</div>
              </div>
            </div>
          </section>

          <section class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div class="border-b border-themed px-4 py-3">
              <h3 class="font-semibold text-themed">关联下单限制</h3>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full text-sm">
                <thead class="bg-gray-50 text-themed-muted dark:bg-gray-950">
                  <tr>
                    <th class="p-3 text-left">ID</th>
                    <th class="p-3 text-left">状态</th>
                    <th class="p-3 text-left">工单</th>
                    <th class="p-3 text-left">原因</th>
                    <th class="p-3 text-left">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="restriction in evidenceDetail.restrictions" :key="restriction.id" class="border-t border-themed">
                    <td class="p-3 text-themed">#{{ restriction.id }}</td>
                    <td class="p-3"><span :class="restriction.status === 'active' ? 'badge badge-error' : 'badge badge-success'">{{ restriction.status }}</span></td>
                    <td class="p-3 text-themed-muted">{{ restriction.ticketId ? `#${restriction.ticketId}` : '-' }}</td>
                    <td class="max-w-lg p-3 text-themed-muted">{{ restriction.reason }}</td>
                    <td class="p-3 text-themed-muted">{{ formatDate(restriction.createdAt) }}</td>
                  </tr>
                  <tr v-if="evidenceDetail.restrictions.length === 0">
                    <td colspan="5" class="p-6 text-center text-themed-muted">暂无关联限单。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>
