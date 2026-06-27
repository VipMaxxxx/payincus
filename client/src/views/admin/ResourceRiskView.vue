<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api, {
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

const toast = useToast()
const loading = ref(true)
const saving = ref(false)
const activeTab = ref<TabKey>('instances')
const overview = ref<{ totalStates: number; highRisk: number; activeRestrictions: number } | null>(null)
const instances = ref<ResourceRiskState[]>([])
const events = ref<ResourceRiskEvent[]>([])
const restrictions = ref<UserOrderRestrictionRecord[]>([])
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

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'instances', label: '实例风险' },
  { key: 'events', label: '事件流水' },
  { key: 'restrictions', label: '下单限制' },
  { key: 'policy', label: '策略配置' }
]

const highRiskCount = computed(() => overview.value?.highRisk || 0)
const activeRestrictionCount = computed(() => overview.value?.activeRestrictions || 0)

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function badgeClass(level: string): string {
  if (level === 'critical') return 'badge badge-error'
  if (level === 'high') return 'badge badge-warning'
  if (level === 'limited') return 'badge badge-info'
  if (level === 'watch') return 'badge badge-warning'
  return 'badge badge-success'
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
    const [overviewRes, policyRes, instancesRes, eventsRes, restrictionsRes] = await Promise.all([
      api.resourceRisk.overview(),
      api.resourceRisk.getPolicy(),
      api.resourceRisk.listInstances({ page: 1, pageSize: 50 }),
      api.resourceRisk.listEvents({ page: 1, pageSize: 50 }),
      api.resourceRisk.listRestrictions({ page: 1, pageSize: 50, status: 'active' })
    ])
    overview.value = overviewRes.counters
    syncPolicyForm(policyRes.policy)
    instances.value = instancesRes.items
    events.value = eventsRes.items
    restrictions.value = restrictionsRes.items
  } catch (error: any) {
    toast.error(`加载资源风控失败：${error?.message || error}`)
  } finally {
    loading.value = false
  }
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

async function manualQos(item: ResourceRiskState) {
  const bandwidthInput = window.prompt(`请输入 ${item.instance?.name || item.instanceId} 的人工限速 Mbps`, '30')
  if (!bandwidthInput) return
  const bandwidthMbps = Number(bandwidthInput)
  if (!Number.isFinite(bandwidthMbps) || bandwidthMbps <= 0) {
    toast.warning('限速 Mbps 必须大于 0')
    return
  }
  const reason = window.prompt('请输入人工限速原因', item.reason || '资源占用过高，人工限速')
  if (!reason?.trim()) return
  const restrictOrders = window.confirm('是否同时限制该账号继续下单？')
  try {
    await api.resourceRisk.manualQos(item.instanceId, {
      bandwidthMbps,
      reason,
      restrictOrders
    })
    toast.success('已人工限速')
    await loadAll()
  } catch (error: any) {
    toast.error(`人工限速失败：${error?.message || error}`)
  }
}

async function manualSuspend(item: ResourceRiskState) {
  const reason = window.prompt(`请输入封禁 ${item.instance?.name || item.instanceId} 的原因`, item.reason || '资源风控人工封禁')
  if (!reason?.trim()) return
  const restrictOrders = window.confirm('是否同时限制该账号继续下单？')
  const notifyUser = window.confirm('是否通知用户？')
  try {
    await api.resourceRisk.manualSuspend(item.instanceId, {
      reason,
      restrictOrders,
      notifyUser
    })
    toast.success('实例已人工封禁')
    await loadAll()
  } catch (error: any) {
    toast.error(`人工封禁失败：${error?.message || error}`)
  }
}

async function manualUnsuspend(item: ResourceRiskState) {
  const reason = window.prompt(`请输入解除 ${item.instance?.name || item.instanceId} 封禁的原因`, '人工审核通过')
  if (!reason?.trim()) return
  const notifyUser = window.confirm('是否通知用户？')
  try {
    await api.resourceRisk.manualUnsuspend(item.instanceId, {
      reason,
      notifyUser
    })
    toast.success('实例已解除封禁')
    await loadAll()
  } catch (error: any) {
    toast.error(`解除封禁失败：${error?.message || error}`)
  }
}

async function manualOrderRestrict(item: ResourceRiskState) {
  const reason = window.prompt(`请输入限制用户 ${item.user?.username || item.userId} 下单的原因`, '实例触发人工资源风控审核')
  if (!reason?.trim()) return
  try {
    await api.resourceRisk.manualOrderRestrict(item.instanceId, reason)
    toast.success('已限制账号下单')
    await loadAll()
  } catch (error: any) {
    toast.error(`限制下单失败：${error?.message || error}`)
  }
}

async function evaluateInstance(item: ResourceRiskState) {
  try {
    await api.resourceRisk.evaluateInstance(item.instanceId)
    toast.success('已重新评估实例风险')
    await loadAll()
  } catch (error: any) {
    toast.error(`评估失败：${error?.message || error}`)
  }
}

async function releaseInstance(item: ResourceRiskState) {
  const reason = window.prompt(`解除实例 ${item.instance?.name || item.instanceId} 的资源风控原因`, '人工审核通过')
  if (!reason) return
  try {
    await api.resourceRisk.releaseInstance(item.instanceId, reason)
    toast.success('实例风控已解除')
    await loadAll()
  } catch (error: any) {
    toast.error(`解除失败：${error?.message || error}`)
  }
}

async function releaseRestriction(item: UserOrderRestrictionRecord) {
  const reason = window.prompt(`解除用户 ${item.user?.username || item.userId} 的下单限制原因`, '工单人工审核通过')
  if (!reason) return
  try {
    await api.resourceRisk.releaseRestriction(item.id, {
      reason,
      ticketId: item.ticketId
    })
    toast.success('下单限制已解除')
    await loadAll()
  } catch (error: any) {
    toast.error(`解除失败：${error?.message || error}`)
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
          @click="activeTab = tab.key"
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
                    <button class="btn-secondary px-3 py-1 text-xs" @click="evaluateInstance(item)">评估</button>
                    <button class="btn-secondary px-3 py-1 text-xs" @click="manualQos(item)">限速</button>
                    <button class="btn-danger px-3 py-1 text-xs" @click="manualSuspend(item)">封禁</button>
                    <button class="btn-secondary px-3 py-1 text-xs" @click="manualUnsuspend(item)">解封</button>
                    <button class="btn-secondary px-3 py-1 text-xs" @click="manualOrderRestrict(item)">限单</button>
                    <button class="btn-primary px-3 py-1 text-xs" @click="releaseInstance(item)">解除风控</button>
                  </div>
                </td>
              </tr>
              <tr v-if="instances.length === 0">
                <td colspan="8" class="p-8 text-center text-themed-muted">暂无实例风险状态。</td>
              </tr>
            </tbody>
          </table>
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
  </div>
</template>
