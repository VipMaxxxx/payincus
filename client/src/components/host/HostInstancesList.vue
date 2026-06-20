<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { InstanceConfigResponse } from '@/types/api'
import UserAvatar from '@/components/UserAvatar.vue'
import InstanceDisplayIcon from '@/components/InstanceDisplayIcon.vue'

interface TrafficData { monthlyUsed: string; monthlyUsedFormatted: string; monthlyLimit: string | null; monthlyLimitFormatted: string | null; percentage: number }
interface Instance {
  id: number
  name: string
  incusId?: string
  incus_id?: string
  status: string
  image: string
  imageName?: string | null
  ipv4?: string | null
  ipv6?: string | null
  network_mode?: string
  networkMode?: string
  cpu: number
  memory: number
  disk: number
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
  username?: string | null
  userEmail?: string | null
  userAvatarStyle?: string | null
  userAvatarBadgeId?: string | null
  ssh_port?: number | null
  port_limit?: number | null
  snapshot_limit?: number | null
  backup_limit?: number | null
  site_limit?: number | null
  swapSize?: number | null
  packagePlanId?: number | null
  instanceType?: 'container' | 'vm'
  billingPrice?: number | null
  expiresAt?: string | null
  expires_at?: string | null
  suspendReason?: string | null
  suspend_reason?: string | null
  autoRenew?: boolean
  trafficData?: TrafficData | null
  iconBadgeId?: string | null
}
interface StatusInfo { label: string; class: string; dot: string }

const props = defineProps<{
  instances: Instance[]
  selectedIds: Set<number>
  isAllSelected: boolean
  isPartialSelected: boolean
  expandedInstanceId: number | null
  detailConfigs: Record<number, InstanceConfigResponse | null>
  detailConfigErrors: Record<number, string>
  detailLoadingIds: Set<number>
  syncingInstanceIds: Set<number>
  swapActionLoadingIds: Set<number>
  resettingTrafficId: number | null
  recreateLoading: boolean
  recreateTargetId: number | null
  isDark: boolean
  getPaidIconType: (instance: any) => 'pro' | 'prime' | null
  getStatusInfo: (status: string) => StatusInfo
  formatMemory: (mb: number) => string
  formatDisk: (mb: number) => string
  getDisplayIp: (instance: any) => { ipv4: string | null; ipv6: string | null }
  canRecreateInstance: (instance: any) => boolean
  isInstanceExpanded: (id: number) => boolean
  isDetailLoading: (id: number) => boolean
  isInstanceSyncing: (id: number) => boolean
  isSwapActionLoading: (id: number) => boolean
  getDetailConfig: (id: number) => InstanceConfigResponse | null
  formatMoney: (value?: number | null) => string
  formatDateTime: (value?: string | null) => string
  formatBoolean: (value?: boolean | null) => string
  formatBandwidth: (value?: string | null) => string
  formatSwapSize: (sizeMb?: number | null) => string
  getInstanceTypeLabel: (instance: any) => string
  getNetworkModeLabel: (instance: any) => string | null
  getExpiryValue: (instance: any) => string | null
  getSuspendReason: (instance: any) => string | null
  getTrafficSummary: (instance: any) => string
  getTrafficPercentage: (instance: any) => number
  getTrafficBarClass: (instance: any) => string
  getSummaryMeta: (instance: any) => string[]
  getQuotaItems: (instance: any) => Array<{ label: string; value: string | number | null | undefined }>
  formatQuotaValue: (value: string | number | null | undefined) => string
  canToggleSwap: (instance: any) => boolean
  getSwapDisplay: (instance: any) => string
  getExpirySummary: (instance: any) => string
}>()

const emit = defineEmits<{
  (e: 'toggle-select', id: number): void
  (e: 'toggle-select-all'): void
  (e: 'toggle-expand', instance: any): void
  (e: 'retry-detail', instanceId: number): void
  (e: 'sync-instance', instance: any): void
  (e: 'toggle-swap', instance: any): void
  (e: 'open-single-config', instanceId: number): void
  (e: 'open-price', instance: any): void
  (e: 'open-reset-traffic', instance: any): void
  (e: 'open-recreate', instance: any): void
  (e: 'open-delete', instanceId: number): void
  (e: 'open-detail', instanceId: number): void
}>()

const { t } = useI18n()

const itemShell = (selected: boolean, expanded: boolean) => [
  props.isDark ? 'border-gray-800 bg-[#0d0d0f] hover:border-gray-700' : 'border-gray-200 bg-white hover:border-gray-300',
  selected ? (props.isDark ? 'ring-1 ring-blue-500/40' : 'ring-1 ring-blue-500/30') : '',
  expanded ? (props.isDark ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.02)]' : 'shadow-sm') : ''
]
const shellClass = (dark: boolean) => dark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-white'
const chipClass = (dark: boolean) => dark ? 'bg-gray-900 text-gray-300' : 'bg-gray-50 text-gray-700'
const statClass = (dark: boolean) => dark ? 'border-gray-800 bg-black/20' : 'border-gray-100 bg-gray-50'
const textMuted = (dark: boolean) => dark ? 'text-gray-500' : 'text-gray-500'
const textStrong = (dark: boolean) => dark ? 'text-gray-100' : 'text-gray-900'

function isSelected(id: number): boolean { return props.selectedIds.has(id) }
function getDetailError(id: number): string { return props.detailConfigErrors[id] || '' }
</script>

<template>
  <div class="card p-3 sm:p-4">
    <div class="mb-3 flex items-center justify-between">
      <div class="text-xs font-semibold uppercase tracking-[0.24em]" :class="textMuted(props.isDark)">{{ t('nav.instances') }}</div>
      <button
        class="inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors"
        :class="props.isDark ? 'border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800' : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'"
        @click="emit('toggle-select-all')"
      >
        <span class="relative flex h-4 w-4 items-center justify-center rounded border" :class="props.isDark ? 'border-gray-600 bg-gray-950' : 'border-gray-300 bg-white'">
          <span v-if="props.isAllSelected" class="h-2 w-2 rounded-sm bg-current"></span>
          <span v-else-if="props.isPartialSelected" class="h-0.5 w-2 rounded-full bg-current"></span>
        </span>
        {{ props.selectedIds.size }}/{{ props.instances.length }}
      </button>
    </div>

    <div class="space-y-3">
      <div
        v-for="instance in props.instances"
        :key="instance.id"
        class="overflow-hidden rounded-2xl border transition-all duration-200"
        :class="itemShell(isSelected(instance.id), props.isInstanceExpanded(instance.id))"
      >
        <div class="px-4 py-4 sm:px-5">
          <div class="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-3">
                <div class="flex items-center gap-2 pt-1" @click.stop>
                  <input
                    type="checkbox"
                    class="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                    :checked="isSelected(instance.id)"
                    @change="emit('toggle-select', instance.id)"
                  />
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-colors"
                    :class="props.isDark ? 'border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800' : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'"
                    :title="props.isInstanceExpanded(instance.id) ? t('common.collapse') : t('common.expand')"
                    @click="emit('toggle-expand', instance)"
                  >
                    <svg class="w-4 h-4 transition-transform" :class="props.isInstanceExpanded(instance.id) ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <InstanceDisplayIcon
                      v-if="instance.iconBadgeId || props.getPaidIconType(instance)"
                      :badge-id="instance.iconBadgeId"
                      :fallback-icon="props.getPaidIconType(instance)"
                      :alt="instance.name"
                      :size="40"
                    />
                    <button class="text-left text-sm font-semibold transition-colors" :class="props.isDark ? 'text-gray-100 hover:text-white' : 'text-gray-900 hover:text-black'" @click="emit('open-detail', instance.id)">
                      {{ instance.name }}
                    </button>
                    <span :class="['badge whitespace-nowrap', props.getStatusInfo(instance.status).class]">{{ props.getStatusInfo(instance.status).label }}</span>
                    <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium" :class="props.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'">{{ props.getInstanceTypeLabel(instance) }}</span>
                    <span v-if="instance.packagePlanId" class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium" :class="props.isDark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700'">{{ props.formatMoney(instance.billingPrice) }}</span>
                  </div>

                  <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" :class="textMuted(props.isDark)">
                    <span>#{{ instance.id }}</span>
                    <span>Incus {{ instance.incusId || instance.incus_id || '-' }}</span>
                    <span>{{ instance.imageName || instance.image?.replace(/^images:/, '') || '-' }}</span>
                    <span>{{ props.formatDateTime(instance.createdAt || instance.created_at || null) }}</span>
                  </div>

                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <span v-for="meta in props.getSummaryMeta(instance)" :key="meta" class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" :class="chipClass(props.isDark)">{{ meta }}</span>
                    <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" :class="chipClass(props.isDark)">{{ props.getNetworkModeLabel(instance) }}</span>
                  </div>

                  <div v-if="instance.username" class="mt-3 flex items-center gap-3">
                    <UserAvatar :username="instance.username" :email="instance.userEmail" :avatar-style="instance.userAvatarStyle || ''" :badge-id="instance.userAvatarBadgeId || null" :size="28" />
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium" :class="props.isDark ? 'text-gray-200' : 'text-gray-900'">{{ instance.username }}</div>
                      <div v-if="instance.userEmail" class="truncate text-xs" :class="textMuted(props.isDark)">{{ instance.userEmail }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="w-full shrink-0 2xl:w-[360px]">
              <div class="rounded-2xl border p-3" :class="props.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50/80'">
                <div class="flex items-center justify-between text-xs" :class="textMuted(props.isDark)">
                  <span>{{ t('admin.hosts.trafficUsage') }}</span>
                  <span>{{ props.getTrafficSummary(instance) }}</span>
                </div>
                <div class="mt-2 h-2 overflow-hidden rounded-full" :class="props.isDark ? 'bg-gray-800' : 'bg-gray-200'">
                  <div class="h-full rounded-full transition-all" :class="props.getTrafficBarClass(instance)" :style="{ width: `${props.getTrafficPercentage(instance)}%` }"></div>
                </div>

                <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div class="rounded-xl border px-3 py-2" :class="props.isDark ? 'border-gray-800 bg-black/30' : 'border-gray-200 bg-white/80'">
                    <div class="text-[11px] uppercase tracking-wide" :class="textMuted(props.isDark)">{{ t('billing.renewPrice') }}</div>
                    <div class="mt-1 text-sm font-semibold" :class="textStrong(props.isDark)">{{ instance.packagePlanId ? props.formatMoney(instance.billingPrice) : '-' }}</div>
                  </div>
                  <div class="rounded-xl border px-3 py-2" :class="props.isDark ? 'border-gray-800 bg-black/30' : 'border-gray-200 bg-white/80'">
                    <div class="text-[11px] uppercase tracking-wide" :class="textMuted(props.isDark)">{{ t('billing.expiresAt') }}</div>
                    <div class="mt-1 truncate text-sm font-semibold" :class="textStrong(props.isDark)">{{ props.getExpirySummary(instance) }}</div>
                  </div>
                </div>

                <div class="mt-3 flex flex-wrap justify-end gap-2" @click.stop>
                  <button class="btn-ghost btn-sm" :disabled="props.isInstanceSyncing(instance.id)" :title="t('admin.hosts.batchSyncStatus')" @click="emit('sync-instance', instance)">
                    <svg v-if="props.isInstanceSyncing(instance.id)" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                    <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                  <button v-if="instance.packagePlanId" class="btn-ghost btn-sm" :title="t('host.price.editPrice')" @click="emit('open-price', instance)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </button>
                  <button class="btn-secondary btn-sm" @click="emit('open-single-config', instance.id)">{{ t('host.batchConfig.button') }}</button>
                  <button class="btn-primary btn-sm" @click="emit('open-detail', instance.id)">{{ t('common.details') }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="props.isInstanceExpanded(instance.id)" class="border-t px-4 py-4 sm:px-5" :class="props.isDark ? 'border-gray-800 bg-black/10' : 'border-gray-200 bg-gray-50/40'">
          <div v-if="props.isDetailLoading(instance.id)" class="flex items-center gap-3 rounded-2xl border px-4 py-5" :class="props.isDark ? 'border-gray-800 bg-gray-950/60 text-gray-400' : 'border-gray-200 bg-white text-gray-500'">
            <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            <span class="text-sm">{{ t('common.loading') }}</span>
          </div>

          <div v-else-if="getDetailError(instance.id)" class="flex flex-col gap-3 rounded-2xl border px-4 py-4 sm:flex-row sm:items-center sm:justify-between" :class="props.isDark ? 'border-red-500/20 bg-red-500/10' : 'border-red-200 bg-red-50'">
            <div class="min-w-0">
              <div class="text-sm font-medium text-red-500">{{ t('common.loadFailed') }}</div>
              <div class="mt-1 text-xs break-all" :class="props.isDark ? 'text-red-300/80' : 'text-red-700/80'">{{ getDetailError(instance.id) }}</div>
            </div>
            <button class="btn-secondary btn-sm" @click="emit('retry-detail', instance.id)">{{ t('common.retry') }}</button>
          </div>

          <div v-else class="grid gap-3 xl:grid-cols-3">
            <div class="rounded-2xl border p-4" :class="shellClass(props.isDark)">
              <div class="mb-4 text-xs font-semibold uppercase tracking-[0.2em]" :class="textMuted(props.isDark)">{{ t('common.details') }}</div>
              <dl class="space-y-3 text-sm">
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('instance.detail.info.instanceId') }}</dt><dd class="font-mono text-right text-themed">{{ instance.id }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">Incus ID</dt><dd class="font-mono text-right text-themed break-all">{{ instance.incusId || instance.incus_id || '-' }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.networkMode') }}</dt><dd class="text-right text-themed">{{ props.getNetworkModeLabel(instance) }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.instanceType') }}</dt><dd class="text-right text-themed">{{ props.getInstanceTypeLabel(instance) }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('instance.user') }}</dt><dd class="text-right text-themed">{{ instance.username || '-' }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('instance.createdAt') }}</dt><dd class="text-right text-themed">{{ props.formatDateTime(instance.createdAt || instance.created_at || null) }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('common.updatedAt') }}</dt><dd class="text-right text-themed">{{ props.formatDateTime(instance.updatedAt || instance.updated_at || null) }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('billing.expiresAt') }}</dt><dd class="text-right text-themed">{{ props.formatDateTime(props.getExpiryValue(instance)) }}</dd></div>
                <div v-if="props.getSuspendReason(instance)" class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('admin.hosts.suspendReason') }}</dt><dd class="text-right text-themed break-all">{{ props.getSuspendReason(instance) }}</dd></div>
              </dl>
            </div>

            <div class="rounded-2xl border p-4" :class="shellClass(props.isDark)">
              <div class="mb-4 text-xs font-semibold uppercase tracking-[0.2em]" :class="textMuted(props.isDark)">{{ t('admin.hosts.resources') }}</div>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div class="rounded-xl border px-3 py-2" :class="statClass(props.isDark)"><div class="text-[11px]" :class="textMuted(props.isDark)">{{ t('admin.hosts.resources') }}</div><div class="mt-1 space-y-1 text-sm text-themed"><div>CPU {{ instance.cpu }}%</div><div>{{ props.formatMemory(instance.memory) }}</div><div>{{ props.formatDisk(instance.disk) }}</div><div>SWAP {{ props.getSwapDisplay(instance) }}</div></div></div>
                <div class="rounded-xl border px-3 py-2" :class="statClass(props.isDark)"><div class="text-[11px]" :class="textMuted(props.isDark)">{{ t('admin.hosts.trafficUsage') }}</div><div class="mt-1 space-y-1 text-sm text-themed"><div>{{ props.getTrafficSummary(instance) }}</div><div>{{ props.formatBandwidth(props.getDetailConfig(instance.id)?.config.limits_ingress) }}</div><div>{{ props.formatBandwidth(props.getDetailConfig(instance.id)?.config.limits_egress) }}</div></div></div>
                <div v-for="item in props.getQuotaItems(instance)" :key="item.label" class="rounded-xl border px-3 py-2" :class="statClass(props.isDark)"><div class="text-[11px]" :class="textMuted(props.isDark)">{{ item.label }}</div><div class="mt-1 text-sm font-medium text-themed">{{ props.formatQuotaValue(item.value) }}</div></div>
                <div class="rounded-xl border px-3 py-2" :class="statClass(props.isDark)"><div class="text-[11px]" :class="textMuted(props.isDark)">IP</div><div class="mt-1 space-y-1 text-sm font-mono text-themed"><div>{{ props.getDisplayIp(instance).ipv4 || '-' }}</div><div class="truncate" :title="props.getDisplayIp(instance).ipv6 || ''">{{ props.getDisplayIp(instance).ipv6 || '-' }}</div></div></div>
              </div>
            </div>

            <div class="rounded-2xl border p-4" :class="shellClass(props.isDark)">
              <div class="mb-4 text-xs font-semibold uppercase tracking-[0.2em]" :class="textMuted(props.isDark)">{{ t('instanceConfig.title') }}</div>
              <dl class="space-y-3 text-sm">
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">SWAP</dt><dd class="text-right text-themed">{{ props.getSwapDisplay(instance) }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.ioLimitMode') }}</dt><dd class="text-right text-themed">{{ props.getDetailConfig(instance.id)?.ioLimitMode === 'iops' ? t('packageForm.ioMode.iops') : t('packageForm.ioMode.throughput') }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.limitsRead') }}</dt><dd class="text-right text-themed">{{ props.getDetailConfig(instance.id)?.ioLimitMode === 'iops' ? `${props.getDetailConfig(instance.id)?.config.limits_read_iops ?? '-'} IOPS` : (props.getDetailConfig(instance.id)?.config.limits_read || '-') }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.limitsWrite') }}</dt><dd class="text-right text-themed">{{ props.getDetailConfig(instance.id)?.ioLimitMode === 'iops' ? `${props.getDetailConfig(instance.id)?.config.limits_write_iops ?? '-'} IOPS` : (props.getDetailConfig(instance.id)?.config.limits_write || '-') }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.limitsIngress') }}</dt><dd class="text-right text-themed">{{ props.formatBandwidth(props.getDetailConfig(instance.id)?.config.limits_ingress) }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.limitsEgress') }}</dt><dd class="text-right text-themed">{{ props.formatBandwidth(props.getDetailConfig(instance.id)?.config.limits_egress) }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.limitsProcesses') }}</dt><dd class="text-right text-themed">{{ props.getDetailConfig(instance.id)?.config.limits_processes ?? '-' }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.limitsCpuPriority') }}</dt><dd class="text-right text-themed">{{ props.getDetailConfig(instance.id)?.config.limits_cpu_priority ?? '-' }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.bootAutostart') }}</dt><dd class="text-right text-themed">{{ props.formatBoolean(props.getDetailConfig(instance.id)?.config.boot_autostart) }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.bootAutostartPriority') }}</dt><dd class="text-right text-themed">{{ props.getDetailConfig(instance.id)?.config.boot_autostart_priority ?? '-' }}</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.bootAutostartDelay') }}</dt><dd class="text-right text-themed">{{ props.getDetailConfig(instance.id)?.config.boot_autostart_delay ?? '-' }}s</dd></div>
                <div class="flex items-start justify-between gap-4"><dt class="text-themed-muted">{{ t('packageForm.fields.bootHostShutdownTimeout') }}</dt><dd class="text-right text-themed">{{ props.getDetailConfig(instance.id)?.config.boot_host_shutdown_timeout ?? '-' }}s</dd></div>
              </dl>
            </div>

            <div class="rounded-2xl border p-4 xl:col-span-3" :class="shellClass(props.isDark)">
              <div class="mb-4 text-xs font-semibold uppercase tracking-[0.2em]" :class="textMuted(props.isDark)">{{ t('common.actions') }}</div>
              <div class="flex flex-wrap gap-2" @click.stop>
                <button class="btn-secondary btn-sm" @click="emit('open-single-config', instance.id)">{{ t('host.batchConfig.button') }}</button>
                <button class="btn-secondary btn-sm" :disabled="props.isInstanceSyncing(instance.id)" @click="emit('sync-instance', instance)">{{ props.isInstanceSyncing(instance.id) ? t('common.syncing') : t('admin.hosts.batchSyncStatus') }}</button>
                <button v-if="props.getDetailConfig(instance.id)?.swap.available && props.canToggleSwap(instance)" class="btn-secondary btn-sm" :disabled="props.isSwapActionLoading(instance.id)" @click="emit('toggle-swap', instance)">{{ props.isSwapActionLoading(instance.id) ? t('common.processing') : (props.getDetailConfig(instance.id)?.swap.enabled ? t('instanceConfig.swap.disableButton') : t('instanceConfig.swap.enableButton')) }}</button>
                <button v-if="instance.trafficData && Number(instance.trafficData.monthlyUsed) > 0" class="btn-secondary btn-sm" :disabled="props.resettingTrafficId === instance.id" @click="emit('open-reset-traffic', instance)">{{ t('admin.hosts.resetTraffic') }}</button>
                <button v-if="instance.packagePlanId" class="btn-secondary btn-sm" @click="emit('open-price', instance)">{{ t('host.price.editPrice') }}</button>
                <button v-if="props.canRecreateInstance(instance)" class="btn-secondary btn-sm" :disabled="props.recreateLoading" @click="emit('open-recreate', instance)">{{ props.recreateLoading && props.recreateTargetId === instance.id ? t('common.processing') : t('instance.detail.recreate.title') }}</button>
                <button class="btn-danger btn-sm" @click="emit('open-delete', instance.id)">{{ t('common.delete') }}</button>
                <button class="btn-primary btn-sm" @click="emit('open-detail', instance.id)">{{ t('common.details') }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
