<script setup lang="ts">
// 为 KeepAlive exclude 匹配定义组件名称
defineOptions({
  name: 'InstanceDetailView'
})

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import { useConfigStore } from '@/stores/config'
import InstanceInfoTab from '@/components/instance/InstanceInfoTab.vue'
import InstanceNetworkTab from '@/components/instance/InstanceNetworkTab.vue'
import InstanceQuotaTab from '@/components/instance/InstanceQuotaTab.vue'
import InstanceConfigTab from '@/components/instance/InstanceConfigTab.vue'
import InstanceSitesTab from '@/components/instance/InstanceSitesTab.vue'
import InstanceLogsTab from '@/components/instance/InstanceLogsTab.vue'
import SnapshotManager from '@/components/SnapshotManager.vue'
import TrafficStats from '@/components/instance/TrafficStats.vue'
import AddPortModal from '@/components/instance/modals/AddPortModal.vue'
import PortConflictModal from '@/components/instance/modals/PortConflictModal.vue'
import RebuildModal from '@/components/instance/modals/RebuildModal.vue'
import RecreateModal from '@/components/instance/modals/RecreateModal.vue'
import TransferModal from '@/components/instance/modals/TransferModal.vue'
import ConfigEditModal from '@/components/instance/modals/ConfigEditModal.vue'
import RenewModal from '@/components/instance/modals/RenewModal.vue'
import ApplyAffCodeModal from '@/components/instance/modals/ApplyAffCodeModal.vue'
import ChangePlanModal from '@/components/instance/modals/ChangePlanModal.vue'
import DestroyInstanceModal from '@/components/instance/modals/DestroyInstanceModal.vue'
import TerminalModal from '@/components/instance/TerminalModal.vue'
import InstanceDisplayIcon from '@/components/InstanceDisplayIcon.vue'
import InstanceBadgeModal from '@/components/instance/InstanceBadgeModal.vue'
import AnnouncementIcon from '@/components/icons/AnnouncementIcon.vue'
import { getStatusInfo } from '@/utils/formatters'
import { translateError } from '@/utils/errorHandler'
import { freeSiteCopy, getFreeSiteBillingCycleLabel, getFreeSiteBillingCycleShort } from '@/utils/freeSiteFun'
import type { Instance, InstanceWithDetails, Snapshot, UserQuota, UpdateInstanceRequest, Package, CloudInitState, CloudInitStatusResponse } from '@/types/api'

// 格式化镜像名称：优先使用 imageName，否则去掉 images: 前缀
function formatImageName(image: string, imageName?: string | null): string {
  if (imageName) return imageName
  return image?.replace(/^images:/, '') || ''
}

// 获取付费实例的图标类型
function getInstanceIconType(inst: { instanceType?: string; host?: { name?: string } } | null): 'pro' | 'prime' | 'peer' {
  if (!inst) return 'pro'
  
  // 如果节点名称以 PEER 开头（不区分大小写），则是托管实例，显示 peer 图标
  const hostName = inst.host?.name || ''
  if (/^PEER\d/i.test(hostName)) {
    return 'peer'
  }
  
  // 根据实例类型判断：虚拟机显示 prime，容器显示 pro
  return inst.instanceType === 'vm' ? 'prime' : 'pro'
}

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()
const configStore = useConfigStore()

// 获取返回路径：如果是从宿主机页面进入，则返回到宿主机页面
function getReturnPath(): string {
  const fromHost = route.query.fromHost as string | undefined
  if (fromHost) {
    // 验证 hostId 是否为有效数字
    const hostId = parseInt(fromHost, 10)
    if (!isNaN(hostId) && hostId > 0) {
      return `/resources/hosts/${hostId}`
    }
    // 如果 hostId 无效，返回实例列表
    return '/instances'
  }
  return '/instances'
}

// 标签页状态
type TabType = 'info' | 'network' | 'sites' | 'traffic' | 'snapshots' | 'quota' | 'config' | 'logs'
const activeTab = ref<TabType>('info')

// 实例数据
const instance = ref<InstanceWithDetails | null>(null)
const loading = ref<boolean>(true)
const actionLoading = ref<string>('')
const copied = ref<string>('')
const showPassword = ref<Record<string, boolean>>({})  // 用于控制密码显示/隐藏
const instancePassword = ref<Record<string, string | null>>({})  // 存储实例密码

// 资源统计
interface ResourceStats {
  memory: { usage: number; limit: number; usagePercent: number }
  disk: { usage: number; limit: number; usagePercent: number }
  network: { bytesReceived: number; bytesSent: number }
}
const stats = ref<ResourceStats>({
  memory: { usage: 0, limit: 0, usagePercent: 0 },
  disk: { usage: 0, limit: 0, usagePercent: 0 },
  network: { bytesReceived: 0, bytesSent: 0 }
})
const statsLoading = ref<boolean>(false)

// 流量数据
interface TrafficData {
  monthlyUsed: string
  monthlyUsedFormatted: string
  monthlyLimit: string | null
  monthlyLimitFormatted: string | null
  trafficStatus: 'NORMAL' | 'WARNING' | 'LIMITED'
  percentage: number
}
const trafficData = ref<TrafficData | null>(null)
const trafficLoading = ref<boolean>(false)

// 端口映射
const showAddPortModal = ref<boolean>(false)
const portLoading = ref<boolean>(false)
const portError = ref<string>('')
// 端口冲突解决
const showPortConflictModal = ref<boolean>(false)
const portConflicts = ref<Array<{ publicPort: number; suggestedPort: number | null }>>([])// 用于冲突解决后重新提交的原始数据
const pendingBatchPortData = ref<{
  protocol: 'tcp' | 'udp' | 'both'
  privatePortStart: number
  privatePortEnd: number
  publicPortStart?: number
  publicPortEnd?: number
  remark?: string
} | null>(null)

// 快照 - 现在使用 SnapshotManager 组件
const snapshots = ref<Snapshot[]>([]) // Still needed for quota tab

// 重命名
const showRenameModal = ref<boolean>(false)
const renameLoading = ref<boolean>(false)
const newInstanceName = ref<string>('')

// 重装
const showRebuildModal = ref<boolean>(false)
const rebuildLoading = ref<boolean>(false)

// 重建
const showRecreateModal = ref<boolean>(false)
const recreateLoading = ref<boolean>(false)

interface ImageOption {
  incusAlias: string
  name: string
  description: string | null
  icon?: string | null
}

// 转移
const showTransferModal = ref<boolean>(false)
const hasPendingTransfer = ref<boolean>(false)

// 续费弹窗
const showRenewModal = ref<boolean>(false)
const showApplyAffModal = ref<boolean>(false)

// 自动续费弹窗
const showAutoRenewModal = ref<boolean>(false)
const autoRenewLoading = ref<boolean>(false)

// 变更方案弹窗
const showChangePlanModal = ref<boolean>(false)

// 销毁弹窗
const showDestroyModal = ref<boolean>(false)
const destroyLoading = ref<boolean>(false)
const errorDestroyLoading = ref<boolean>(false)
const destroyInfo = ref<{
  canDestroy: boolean
  cannotDestroyReason: string
  isFreeInstance: boolean
  isFirstTime: boolean
  rules: { feeRate: number }
  refund: { remainingDays: number; remainingValue: number; feeRate: number; feeAmount: number; refundAmount: number; destroyCount: number; maxRefundable: number }
  instance: { id: number; name: string; hostName: string; planName: string | null }
} | null>(null)

// 复制
const showCloneModal = ref<boolean>(false)
const cloneLoading = ref<boolean>(false)
const showInstanceBadgeModal = ref<boolean>(false)

// 封停/解封
const suspendLoading = ref<boolean>(false)
const showSuspendModal = ref<boolean>(false)
const suspendReason = ref<string>('')

// 同步状态
const syncStatusLoading = ref<boolean>(false)

// 重新分配 IPv6
const reassignIpv6Loading = ref<boolean>(false)

const availableImages = ref<ImageOption[]>([])
interface SshKeyOption {
  id: number
  name: string
}
const sshKeys = ref<SshKeyOption[]>([])

// 实例配额
interface InstanceQuotaForm {
  portLimit: number | null
  snapshotLimit: number | null
}
const instanceQuotaForm = ref<InstanceQuotaForm>({
  portLimit: null,
  snapshotLimit: null
})
const quotaSaving = ref<boolean>(false)
const quotaError = ref<string>('')
const userQuota = ref<UserQuota | null>(null) // 用户配额信息
interface RemainingQuota {
  port: number
  snapshot: number
}
const remainingQuota = ref<RemainingQuota>({ // 剩余额度
  port: 0,
  snapshot: 0
})

// 配置编辑
const showConfigEditModal = ref<boolean>(false)
const configEditLoading = ref<boolean>(false)
const instancePackage = ref<Package | null>(null)

// 兑换资源
const showRedeemModal = ref<boolean>(false)
const redeemCodeInput = ref<string>('')
const redeemLoading = ref<boolean>(false)

// 检查是否可以删除实例（根据套餐设置和付费状态）
// 注意：宿主机拥有者不受套餐限制，可以删除其宿主机上的所有实例
const canDeleteInstance = computed<boolean>(() => {
  if (!instance.value) return false
  
  // 宿主机拥有者不受套餐限制
  const inst = instance.value as { isHostOwner?: boolean } | null
  if (inst?.isHostOwner === true) return true
  
  // 付费实例禁止删除（无论套餐是否允许）
  if (instance.value.packagePlanId) return false
  
  // 没有套餐时允许删除
  if (!instance.value.package_id) return true
  
  // 套餐信息未加载时不允许（避免误删）
  if (!instancePackage.value) return false
  
  // 只有明确设置为true时才允许删除
  return (instancePackage.value as any).allow_instance_deletion === true
})

// 敏感操作验证

// 终端模态框
const showTerminalModal = ref<boolean>(false)
const terminalConnected = ref<boolean>(false)
const terminalSessionActive = ref<boolean>(false)  // 终端会话是否存在（无论连接状态）
const terminalForceDisconnect = ref<boolean>(false)
const terminalTabCount = ref<number>(0)  // 终端标签数量

// 终端悄浮按钮拖动状态
const terminalFabY = ref<number | null>(null) // null 表示使用默认位置
const isDragging = ref(false)

// Cloud-init 初始化状态
const cloudInitReady = ref<boolean>(true) // 默认 true，只有检测到未完成时才显示提示
const cloudInitState = ref<CloudInitState | null>(null)
const cloudInitChecking = ref<boolean>(false)
const cloudInitManualCompleting = ref<boolean>(false)
let cloudInitRetryCount = 0 // 重试计数器
let cloudInitRetryTimer: ReturnType<typeof setTimeout> | null = null // 重试定时器
const CLOUD_INIT_AUTO_RETRY_DELAY_MS = 10000
const CLOUD_INIT_MAX_AUTO_RETRIES = 12
let dragStartY = 0
let dragStartFabY = 0

// 开始拖动（鼠标/触摸）
function startDrag(e: MouseEvent | TouchEvent) {
    isDragging.value = true
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    dragStartY = clientY
    // 如果还没有设置过位置，从当前位置计算
    if (terminalFabY.value === null) {
        dragStartFabY = window.innerHeight - 96 - 48 // bottom-24 (96px) + 按钮高度
    } else {
        dragStartFabY = terminalFabY.value
    }
    // 添加全局事件监听
    window.addEventListener('mousemove', onDrag)
    window.addEventListener('mouseup', endDrag)
    window.addEventListener('touchmove', onDrag, { passive: false })
    window.addEventListener('touchend', endDrag)
}

// 拖动中
function onDrag(e: MouseEvent | TouchEvent) {
    if (!isDragging.value) return
    e.preventDefault()
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const deltaY = clientY - dragStartY
    let newY = dragStartFabY + deltaY
    // 限制在屏幕范围内 (顶部 64px 到底部 32px)
    const minY = 64
    const maxY = window.innerHeight - 48 - 32
    newY = Math.max(minY, Math.min(maxY, newY))
    terminalFabY.value = newY
}

// 结束拖动
function endDrag() {
    isDragging.value = false
    window.removeEventListener('mousemove', onDrag)
    window.removeEventListener('mouseup', endDrag)
    window.removeEventListener('touchmove', onDrag)
    window.removeEventListener('touchend', endDrag)
}

let refreshInterval: ReturnType<typeof setInterval> | null = null
let statsInterval: ReturnType<typeof setInterval> | null = null
let isComponentMounted = ref<boolean>(true)  // 组件挂载状态标志

onMounted(async (): Promise<void> => {
  isComponentMounted.value = true
  await configStore.loadPublicConfig()
  await loadInstance()
  // 注意：loadInstance() 内部已经处理了 loadStats() 和 loadTrafficData() 的调用
  // 不需要在这里重复调用
  if (isComponentMounted.value) {
    refreshInterval = setInterval(loadInstance, 5000)
  }
})

onUnmounted(() => {
  isComponentMounted.value = false
  // 关闭终端模态框（确保断开连接）
  showTerminalModal.value = false
  terminalConnected.value = false
  terminalSessionActive.value = false
  terminalTabCount.value = 0
  // 清理拖动事件监听器（如果正在拖动时组件卸载）
  if (isDragging.value) {
    endDrag()
  }
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  if (statsInterval) {
    clearInterval(statsInterval)
    statsInterval = null
  }
  // 清理任务轮询
  if (taskPollingInterval) {
    clearInterval(taskPollingInterval)
    taskPollingInterval = null
  }
  // 清理 cloud-init 重试定时器
  if (cloudInitRetryTimer) {
    clearTimeout(cloudInitRetryTimer)
    cloudInitRetryTimer = null
  }
})

// 路由离开守卫 - 确保离开页面时断开终端连接
onBeforeRouteLeave(() => {
  // 关闭终端模态框，触发其内部的断开逻辑
  showTerminalModal.value = false
  terminalConnected.value = false
})

// 监听标签页变化以加载数据
watch(activeTab, async (tab: TabType) => {
  if (tab === 'quota') {
    // 并行加载配额相关数据，加快标签页加载速度
    await Promise.all([
      loadInstance(),
      loadSnapshotsForQuota(),
      loadUserQuota()
    ])
  }
  // 快照加载由 SnapshotManager 组件处理
})

const isRunning = computed<boolean>(() => {
  const s = instance.value?.status?.toLowerCase()
  return s === 'running'
})

const isStopped = computed<boolean>(() => {
  const s = instance.value?.status?.toLowerCase()
  return s === 'stopped'
})

const isSuspended = computed<boolean>(() => {
  const s = instance.value?.status?.toLowerCase()
  return s === 'suspended'
})

const canDestroyExpiredSuspendedPaidInstance = computed<boolean>(() => {
  if (!instance.value || !isSuspended.value) return false
  return instance.value.suspend_reason === 'expired'
    && !!instance.value.packagePlanId
    && !!instance.value.expires_at
    && new Date(instance.value.expires_at).getTime() <= Date.now()
})

const destroyButtonDisabled = computed<boolean>(() =>
  isSuspended.value && !canDestroyExpiredSuspendedPaidInstance.value
)

const subscriptionRemainingDays = computed<number>(() =>
  getRemainingDays(instance.value?.expires_at ?? null)
)

const subscriptionRemainingDisplay = computed(() =>
  getRemainingDaysDisplay(subscriptionRemainingDays.value, instance.value?.expires_at ?? null)
)

const subscriptionAutoRenewEnabled = computed<boolean>(() =>
  Boolean((instance.value as any)?.autoRenew)
)

const showPaidSubscriptionCard = computed<boolean>(() =>
  Boolean((instance.value as any)?.planName && instance.value?.expires_at)
)

const isError = computed<boolean>(() => {
  const s = instance.value?.status?.toLowerCase()
  return s === 'error'
})

// AUTH004: 节点所有者权限控制
// 节点所有者可以操作实例（启停/删除/快照），但不能执行仅所有者的操作
const isHostOwnerOnly = computed<boolean>(() => {
  // 仅当用户是节点所有者但不是实例所有者时，才限制某些操作
  // 后端返回 isHostOwner = true 表示是节点所有者
  // 后端返回 isInstanceOwner = true 表示同时也是实例所有者
  const inst = instance.value as { isHostOwner?: boolean; isInstanceOwner?: boolean } | null
  return inst?.isHostOwner === true && inst?.isInstanceOwner !== true
})

// 节点所有者禁止的操作：转移、重建、端口映射
const canTransfer = computed<boolean>(() => !isHostOwnerOnly.value)
const canRebuild = computed<boolean>(() => !isHostOwnerOnly.value)
const hasCloudInitManualPermission = computed<boolean>(() => !isHostOwnerOnly.value)
// 复制功能仅限宿主机所有者
const canClone = computed<boolean>(() => {
  const inst = instance.value as { isHostOwner?: boolean } | null
  return inst?.isHostOwner === true
})
// 封停/解封功能仅限宿主机所有者
const canSuspend = computed<boolean>(() => {
  const inst = instance.value as { isHostOwner?: boolean } | null
  return inst?.isHostOwner === true
})
const canSyncStatus = computed<boolean>(() => {
  const inst = instance.value
  return !!inst && (inst.isHostOwner === true || inst.isInstanceOwner === true)
})
const canManagePorts = computed<boolean>(() => !isHostOwnerOnly.value)

const instanceHostName = computed<string>(() => {
  const host = (instance.value as any)?.host
  if (typeof host === 'string') return host
  return host?.name || '-'
})

// 监听路由参数变化，重新加载实例数据
watch(() => route.params.id, async (newId, oldId) => {
  if (newId !== oldId) {
    // 如果路由参数从有效变为无效，或者路由名称变化，清除定时器
    if (!newId || route.name !== 'instance-detail') {
      if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
      }
      if (statsInterval) {
        clearInterval(statsInterval)
        statsInterval = null
      }
    } else {
      // 切换到新实例，先清除所有定时器
      if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
      }
      if (statsInterval) {
        clearInterval(statsInterval)
        statsInterval = null
      }
      if (taskPollingInterval) {
        clearInterval(taskPollingInterval)
        taskPollingInterval = null
      }
      if (cloudInitRetryTimer) {
        clearTimeout(cloudInitRetryTimer)
        cloudInitRetryTimer = null
      }
      cloudInitRetryCount = 0
      
      // 重置所有状态
      loading.value = true
      activeTab.value = 'info'
      instance.value = null
      actionLoading.value = ''
      copied.value = ''
      showPassword.value = {}
      instancePassword.value = {}
      stats.value = {
        memory: { usage: 0, limit: 0, usagePercent: 0 },
        disk: { usage: 0, limit: 0, usagePercent: 0 },
        network: { bytesReceived: 0, bytesSent: 0 }
      }
      trafficData.value = null
      snapshots.value = []
      hasPendingTransfer.value = false
      destroyInfo.value = null
      
      // 重置配额相关状态
      instanceQuotaForm.value = { portLimit: null, snapshotLimit: null }
      quotaError.value = ''
      userQuota.value = null
      remainingQuota.value = { port: 0, snapshot: 0 }
      instancePackage.value = null
      
      // 重置 cloud-init 状态
      cloudInitReady.value = true
      cloudInitState.value = null
      cloudInitChecking.value = false
      cloudInitManualCompleting.value = false
      
      // 重置终端状态
      terminalConnected.value = false
      terminalSessionActive.value = false
      terminalTabCount.value = 0
      
      // 关闭所有弹窗
      showAddPortModal.value = false
      showRenameModal.value = false
      showRebuildModal.value = false
      showRecreateModal.value = false
      showTransferModal.value = false
      showRenewModal.value = false
      showApplyAffModal.value = false
      showAutoRenewModal.value = false
      showChangePlanModal.value = false
      showDestroyModal.value = false
      showCloneModal.value = false
      showSuspendModal.value = false
      showTerminalModal.value = false
      showConfigEditModal.value = false
      
      // 加载新实例数据
      await loadInstance()
      
      // 重新启动定时刷新
      if (isComponentMounted.value) {
        refreshInterval = setInterval(loadInstance, 5000)
      }
    }
  }
})

// 监听实例状态变化，动态管理统计信息定时器
// 注意：必须在 isRunning 定义之后
watch(isRunning, (running: boolean) => {
  // 如果组件已卸载，不执行任何操作
  if (!isComponentMounted.value) return
  
  if (running) {
    // 实例启动时，启动统计信息定时刷新
    if (!statsInterval && instance.value?.id) {
      loadStats()
      if (isComponentMounted.value) {
        statsInterval = setInterval(loadStats, 3000)
      }
    }
    // 实例启动时，延迟检查 cloud-init 状态（等待实例完全就绪）
    cloudInitRetryCount = 0 // 重置重试计数器
    setTimeout(() => {
      if (isComponentMounted.value && isRunning.value) {
        checkCloudInitStatus()
      }
    }, 3000) // 延迟 3 秒再检测
  } else {
    // 实例停止时，停止统计信息定时刷新
    if (statsInterval) {
      clearInterval(statsInterval)
      statsInterval = null
    }
    // 实例停止时，重置 cloud-init 状态
    cloudInitReady.value = true
    cloudInitState.value = null
    // 清理重试定时器
    if (cloudInitRetryTimer) {
      clearTimeout(cloudInitRetryTimer)
      cloudInitRetryTimer = null
    }
  }
})

// 检查 Cloud-init 初始化状态
async function checkCloudInitStatus(): Promise<void> {
  if (!instance.value?.id || !isComponentMounted.value) return
  if (cloudInitChecking.value) return
  
  cloudInitChecking.value = true
  try {
    const result = await api.instances.checkCloudInitStatus(instance.value.id) as CloudInitStatusResponse
    cloudInitReady.value = result.ready
    cloudInitState.value = result.state

    if (result.ready) {
      cloudInitRetryCount = 0
      if (cloudInitRetryTimer) {
        clearTimeout(cloudInitRetryTimer)
        cloudInitRetryTimer = null
      }
      return
    }

    // 如果未就绪且重试次数未达上限，自动重试
    if (cloudInitRetryCount < CLOUD_INIT_MAX_AUTO_RETRIES && isComponentMounted.value && isRunning.value) {
      cloudInitRetryCount++
      console.log(`[CloudInit] 未就绪，${CLOUD_INIT_AUTO_RETRY_DELAY_MS / 1000}秒后重试 (${cloudInitRetryCount}/${CLOUD_INIT_MAX_AUTO_RETRIES})`)
      cloudInitRetryTimer = setTimeout(() => {
        if (isComponentMounted.value && isRunning.value) {
          checkCloudInitStatus()
        }
      }, CLOUD_INIT_AUTO_RETRY_DELAY_MS)
    }
  } catch (err) {
    // 检查失败时显示未知状态，允许用户选择重试或手动结束检测
    console.error('Failed to check cloud-init status:', err)
    cloudInitReady.value = false
    cloudInitState.value = 'unknown'
  } finally {
    cloudInitChecking.value = false
  }
}

const cloudInitNeedsManualAttention = computed<boolean>(() =>
  cloudInitState.value === 'unknown' || cloudInitState.value === 'agent_unavailable'
)

const cloudInitRetriesExhausted = computed<boolean>(() =>
  !cloudInitReady.value
  && cloudInitState.value === 'running'
  && cloudInitRetryCount >= CLOUD_INIT_MAX_AUTO_RETRIES
)

const canManualCompleteCloudInit = computed<boolean>(() =>
  hasCloudInitManualPermission.value && (cloudInitNeedsManualAttention.value || cloudInitRetriesExhausted.value)
)

const cloudInitBannerTitle = computed<string>(() =>
  cloudInitNeedsManualAttention.value
    ? t('instance.detail.cloudInit.statusUnknown')
    : cloudInitRetriesExhausted.value
      ? t('instance.detail.cloudInit.stalled')
    : t('instance.detail.cloudInit.initializing')
)

const cloudInitBannerShort = computed<string>(() =>
  cloudInitNeedsManualAttention.value
    ? t('instance.detail.cloudInit.shortUnknown')
    : cloudInitRetriesExhausted.value
      ? t('instance.detail.cloudInit.shortStalled')
    : t('instance.detail.cloudInit.short')
)

const cloudInitBannerRetryText = computed<string>(() =>
  cloudInitNeedsManualAttention.value
    ? t('instance.detail.cloudInit.retryUnknown')
    : cloudInitRetriesExhausted.value
      ? t('instance.detail.cloudInit.retryStalled')
    : t('instance.detail.cloudInit.retry')
)

const cloudInitBannerTooltip = computed<string>(() =>
  cloudInitNeedsManualAttention.value
    ? t('instance.detail.cloudInit.clickToRetryUnknown')
    : cloudInitRetriesExhausted.value
      ? t('instance.detail.cloudInit.clickToRetryStalled')
    : t('instance.detail.cloudInit.clickToRetry')
)

async function manualCompleteCloudInit(): Promise<void> {
  if (!instance.value?.id) return

  cloudInitManualCompleting.value = true
  try {
    const result = await api.instances.manualCompleteCloudInit(instance.value.id) as CloudInitStatusResponse
    cloudInitReady.value = result.ready
    cloudInitState.value = result.state
    if (cloudInitRetryTimer) {
      clearTimeout(cloudInitRetryTimer)
      cloudInitRetryTimer = null
    }
    cloudInitRetryCount = 0
    toast.success(t('instance.detail.cloudInit.manualCompleteSuccess'))
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    cloudInitManualCompleting.value = false
  }
}

function handleTerminalCloudInitManualComplete(): void {
  cloudInitReady.value = true
  cloudInitState.value = 'manual'
  if (cloudInitRetryTimer) {
    clearTimeout(cloudInitRetryTimer)
    cloudInitRetryTimer = null
  }
  cloudInitRetryCount = 0
}

// 分页数据 - 已移至子组件
const portMappingsCount = computed<number>(() => (instance.value as any)?.port_mappings?.length || 0)

// Tab definitions - config tab visible to all, quota tab only visible to host owners
interface DetailTab {
  key: TabType
  labelKey: string
  icon: string
}

const allTabs: DetailTab[] = [
  { key: 'info', labelKey: 'instance.detail.tabs.info', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'network', labelKey: 'instance.detail.tabs.network', icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' },
  { key: 'sites', labelKey: 'instance.sites.title', icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'traffic', labelKey: 'instance.detail.tabs.traffic', icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
  { key: 'quota', labelKey: 'instance.detail.tabs.quota', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { key: 'snapshots', labelKey: 'instance.detail.tabs.snapshots', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { key: 'logs', labelKey: 'instance.detail.tabs.logs', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { key: 'config', labelKey: 'instance.detail.tabs.config', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' }
]

function normalizeQuotaLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function getInstanceQuotaLimit(type: 'site' | 'snapshot'): number | null {
  const inst = instance.value as any
  if (!inst) return null

  const effectiveLimit = normalizeQuotaLimit(inst.effective_quota_limit?.[type])
  if (effectiveLimit !== null) return effectiveLimit

  if (type === 'site') {
    return normalizeQuotaLimit(inst.site_limit ?? inst.siteLimit)
  }

  return normalizeQuotaLimit(inst.snapshot_limit ?? inst.snapshotLimit)
}

const hasSiteQuota = computed<boolean>(() => getInstanceQuotaLimit('site') !== 0)
const hasSnapshotQuota = computed<boolean>(() => getInstanceQuotaLimit('snapshot') !== 0)

const visibleTabs = computed(() => {
  const tabs = allTabs.filter(tab => {
    if (tab.key === 'sites') return hasSiteQuota.value
    if (tab.key === 'snapshots') return hasSnapshotQuota.value
    return true
  })

  // Quota tab visible to host owners or admins
  // Config tab visible to all users (read-only for non-host owners)
  if (instance.value?.isHostOwner || authStore.isAdmin) {
    return tabs
  }
  return tabs.filter(tab => tab.key !== 'quota')
})

watch(visibleTabs, (tabs) => {
  if (tabs.some(tab => tab.key === activeTab.value)) return
  activeTab.value = tabs[0]?.key ?? 'info'
})

// 加载函数
async function loadInstance(): Promise<void> {
  // 如果组件已卸载，直接返回，不执行任何操作
  if (!isComponentMounted.value) {
    return
  }
  
  if (actionLoading.value) return
  
  try {
    // 检查当前路由是否仍然是实例详情页面
    if (!route.params.id || route.name !== 'instance-detail') {
      // 路由已经变化，清除定时器并返回
      if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
      }
      return
    }
    
    const instanceId = parseInt(route.params.id as string)
    
    // 验证 ID 是否为有效数字
    if (isNaN(instanceId) || instanceId <= 0) {
      // 如果组件仍然挂载，才显示错误并跳转
      if (isComponentMounted.value) {
        toast.error(t('instance.detail.invalidId'))
        router.replace(getReturnPath())
      }
      // 清除定时器
      if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
      }
      return
    }
    
    const response = await api.instances.get(instanceId)
    instance.value = (response as { instance?: Instance }).instance || null
    if (instance.value) {
      // 如果实例绑定了套餐，加载套餐信息以检查删除权限
      if (instance.value.package_id && instance.value.package_id > 0) {
        try {
          const pkgResponse = await api.packages.get(instance.value.package_id) as any
          instancePackage.value = pkgResponse.package || pkgResponse
        } catch (err) {
          console.error('Failed to load package:', err)
          instancePackage.value = null
        }
      } else {
        instancePackage.value = null
      }
      // 初始化配额表单
      instanceQuotaForm.value = {
        portLimit: (instance.value as any).portLimit ?? null,
        snapshotLimit: (instance.value as any).snapshotLimit ?? null
      }
      // 计算剩余额度（使用后端返回的实时数据）
      await calculateRemainingQuota()
      // 检查是否有待处理的转移（只在首次加载时检查，避免频繁请求）
      // 转移状态变化不频繁，不需要每5秒检查一次
      if (loading.value) {
        // 并行执行独立的检查请求，加快首次加载速度
        await Promise.all([
          checkPendingTransfer(),
          checkActiveTask()
        ])
        // 实例加载成功后，并行加载统计信息和流量数据
        if (instance.value.id && isComponentMounted.value) {
          const loadPromises: Promise<void>[] = []
          if (isRunning.value) {
            loadPromises.push(loadStats())
          }
          loadPromises.push(loadTrafficData())
          await Promise.all(loadPromises)
          
          // 启动统计信息定时刷新（只有运行时）
          if (!statsInterval && isRunning.value && isComponentMounted.value) {
            statsInterval = setInterval(loadStats, 3000)
          }
        }
      } else {
        // 非首次加载时也更新流量数据（但不需要等待）
        loadTrafficData().catch(() => {
          // 静默失败
        })
      }
    } else {
      // 响应成功但实例为空，跳转到实例列表
      toast.error(t('instance.detail.notExist'))
      router.replace(getReturnPath())
    }
  } catch (error: any) {
    console.error('Failed to load instance:', error)
    // 处理 404 或其他错误，跳转到实例列表
    const errorMsg = error?.message || t('instance.detail.loadFailed')
    if (errorMsg.includes('不存在') || errorMsg.includes('404') || errorMsg.includes('无权')) {
      toast.error(errorMsg)
      router.replace(getReturnPath())
    }
  } finally {
    loading.value = false
  }
}

async function loadStats(): Promise<void> {
  // 如果组件已卸载，直接返回
  if (!isComponentMounted.value) {
    return
  }
  
  if (!instance.value || statsLoading.value) return
  
  // 只有在实例正在运行时才加载统计信息
  // 停止、重启、创建、启动、停止中等状态都不需要监控
  const status = instance.value.status?.toLowerCase()
  if (status !== 'running') {
    return  // 只有 running 状态才监控统计信息
  }
  
  // 使用实例对象的 ID，而不是从路由参数获取（更可靠）
  const instanceId = instance.value.id
  if (!instanceId || instanceId <= 0) {
    return
  }
  
  // 只在首次加载时显示 loading 状态，后续静默刷新避免闪烁
  const isInitialLoad = stats.value.memory.limit === 0 && stats.value.disk.limit === 0
  if (isInitialLoad) {
    statsLoading.value = true
  }
  
  try {
    const response = await api.instances.getStats(instanceId)
    const newStats = (response as { stats?: ResourceStats; status?: string }).stats
    const newStatus = (response as { stats?: ResourceStats; status?: string }).status
    
    if (newStats) {
      // 确保完整更新stats对象，保持响应式
      stats.value = {
        memory: {
          usage: newStats.memory?.usage ?? 0,
          limit: newStats.memory?.limit ?? 0,
          usagePercent: newStats.memory?.usagePercent ?? 0
        },
        disk: {
          usage: newStats.disk?.usage ?? 0,
          limit: newStats.disk?.limit ?? 0,
          usagePercent: newStats.disk?.usagePercent ?? 0
        },
        network: {
          bytesReceived: newStats.network?.bytesReceived ?? 0,
          bytesSent: newStats.network?.bytesSent ?? 0
        }
      }
    }
    
    // 检查实例状态是否变化（被动同步更新）
    if (newStatus && instance.value) {
      const normalizedStatus = newStatus.toLowerCase()
      const currentStatus = instance.value.status?.toLowerCase()
      if (normalizedStatus !== currentStatus) {
        // 状态变化，立即更新实例状态
        instance.value.status = normalizedStatus as 'creating' | 'running' | 'stopped' | 'error' | 'deleted'
        
        // 如果实例不再运行，停止统计信息轮询
        if (normalizedStatus !== 'running' && statsInterval) {
          clearInterval(statsInterval)
          statsInterval = null
        }
      }
    }
  } catch (error) {
    console.error('Failed to load stats:', error)
    // 失败时保持上一次的值，不做任何改变
  } finally {
    if (isInitialLoad) {
      statsLoading.value = false
    }
  }
}

async function loadTrafficData(): Promise<void> {
  if (!instance.value || trafficLoading.value) return
  
  const instanceId = instance.value.id
  if (!instanceId || instanceId <= 0) {
    return
  }
  
  // 只在首次加载时显示 loading 状态，后续静默刷新避免闪烁
  const isInitialLoad = !trafficData.value
  if (isInitialLoad) {
    trafficLoading.value = true
  }
  
  try {
    const data = await api.traffic.getInstanceTraffic(instanceId)
    trafficData.value = data
  } catch (error) {
    console.error('Failed to load traffic data:', error)
    // 失败时保持上一次的值，不重置为 null，避免闪烁
  } finally {
    if (isInitialLoad) {
      trafficLoading.value = false
    }
  }
}

// 仅为配额标签页加载快照
async function loadSnapshotsForQuota(): Promise<void> {
  if (!instance.value) return
  try {
    // 使用实例对象的 ID，而不是从路由参数获取（更可靠）
    const instanceId = instance.value.id
    if (!instanceId || instanceId <= 0) {
      return
    }
    const response = await api.instances.getSnapshots(instanceId)
    snapshots.value = Array.isArray(response) ? response : []
  } catch (error) {
    console.error('Failed to load snapshots:', error)
  }
}

async function loadAvailableImages(): Promise<void> {
  try {
    const hostId = (instance.value as any)?.hostId || (instance.value as any)?.host_id
    if (!hostId) {
      toast.error(t('instance.detail.rebuild.noHostInfo'))
      return
    }

    // 根据实例类型和内存获取对应的系统镜像列表
    const instanceType = (instance.value as any)?.instanceType || (instance.value as any)?.instance_type || 'container'
    const imageType: 'container' | 'vm' = instanceType === 'vm' ? 'vm' : 'container'
    // 传递实例内存，128MB 只返回 Alpine/Debian
    const memory = instance.value?.memory
    
    const res = await api.images.getSystemImages(imageType, memory, hostId)
    const images = res.images || []
    
    availableImages.value = images.map((img: any) => ({
      incusAlias: img.remoteAlias,
      name: img.name,
      description: null,
      icon: img.icon || null
    }))
  } catch (err: any) {
    console.error('Failed to load available images:', err)
    toast.error(t('instance.detail.rebuild.loadImagesFailed') + ': ' + (err?.message || String(err)))
  }
}

// 重命名
function openRenameModal(): void {
  if (instance.value) {
    newInstanceName.value = instance.value.name
    showRenameModal.value = true
  }
}

async function doRename(): Promise<void> {
  if (!instance.value || !newInstanceName.value.trim()) return
  
  renameLoading.value = true
  try {
    await api.instances.rename(instance.value.id, newInstanceName.value.trim())
    toast.success(t('instance.renameModal.success'))
    showRenameModal.value = false
    await loadInstance()
  } catch (err: any) {
    toast.error(`${t('instance.renameModal.failed')}: ${translateError(err)}`)
  } finally {
    renameLoading.value = false
  }
}

// 复制实例
async function doClone(): Promise<void> {
  if (!instance.value) return
  
  cloneLoading.value = true
  try {
    await api.instances.clone(instance.value.id)
    toast.success(t('instance.detail.actions.cloneSuccess'))
    showCloneModal.value = false
    // 跳转到返回路径，让用户看到新复制的实例
    router.push(getReturnPath())
  } catch (err: any) {
    toast.error(`${t('instance.detail.actions.cloneFailed')}: ${translateError(err)}`)
  } finally {
    cloneLoading.value = false
  }
}

// 配置编辑
async function openConfigEditModal(): Promise<void> {
  if (!instance.value) return
  
  // 加载套餐信息（如果实例绑定了套餐）
  if (instance.value.package_id && instance.value.package_id > 0) {
    try {
      const response = await api.packages.get(instance.value.package_id) as any
      // API 返回 { package: {...} } 格式
      instancePackage.value = response.package || response
    } catch (err) {
      console.error('Failed to load package:', err)
      instancePackage.value = null
    }
  } else {
    // 如果没有绑定套餐，设置为 null
    instancePackage.value = null
  }
  
  // 加载用户配额
  await loadUserQuota()
  
  showConfigEditModal.value = true
}

async function handleConfigEdit(data: { cpu?: number; memory?: number; disk?: number; monthlyTrafficLimit?: string | null }): Promise<void> {
  if (!instance.value) return
  
  configEditLoading.value = true
  try {
    await api.instances.updateConfig(instance.value.id, data)
    toast.success(t('instance.configEdit.success'))
    showConfigEditModal.value = false
    // 并行刷新实例信息和用户配额
    await Promise.all([loadInstance(), loadUserQuota()])
  } catch (err: any) {
    toast.error(`${t('instance.configEdit.failed')}: ${translateError(err)}`)
  } finally {
    configEditLoading.value = false
  }
}

// 打开兑换资源模态框
function openRedeemModal(): void {
  redeemCodeInput.value = ''
  showRedeemModal.value = true
}

// 兑换系统兑换码到当前实例
async function handleRedeem(): Promise<void> {
  if (!instance.value || redeemLoading.value) return
  const code = redeemCodeInput.value.trim()
  if (!code) {
    toast.warning(t('checkin.enterCode'))
    return
  }
  
  redeemLoading.value = true
  try {
    const result = await api.checkin.redeem(code, instance.value.id)
    // 显示成功提示
    const typeMap: Record<string, string> = { c: t('checkin.cpu'), r: t('checkin.memory'), d: t('checkin.disk'), t: t('checkin.traffic') }
    const unitMap: Record<string, string> = { c: '%', r: 'MB', d: 'MB', t: 'GB' }
    const typeName = typeMap[result.codeType] || result.codeType
    const unit = unitMap[result.codeType] || ''
    toast.success(t('checkin.redeemToInstanceSuccess', { type: typeName, value: result.actualAdded, unit, instance: instance.value.name }))
    
    showRedeemModal.value = false
    redeemCodeInput.value = ''
    // 刷新实例信息
    await loadInstance()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    redeemLoading.value = false
  }
}

// 续费成功处理
async function handleRenewSuccess(): Promise<void> {
  toast.success(t('instance.subscription.renewSuccess'))
  await loadInstance()
}

// 绑定 AFF 优惠码成功处理
async function handleApplyAffSuccess(): Promise<void> {
  toast.success(t('instance.subscription.applyAffSuccess'))
  await loadInstance()
}

// 变更方案成功处理
async function handleChangePlanSuccess(): Promise<void> {
  toast.success(t('billing.changePlanSuccess'))
  await loadInstance()
}

// 设置自动续费
async function handleSetAutoRenew(autoRenew: boolean): Promise<void> {
  if (!instance.value) return
  autoRenewLoading.value = true
  try {
    await api.billing.setAutoRenew(instance.value.id, autoRenew)
    toast.success(autoRenew 
      ? t('instance.subscription.autoRenewEnabled') 
      : t('instance.subscription.autoRenewDisabled')
    )
    await loadInstance()
    showAutoRenewModal.value = false
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    autoRenewLoading.value = false
  }
}

// 加载销毁信息
async function loadDestroyInfo(): Promise<void> {
  if (!instance.value) return
  destroyInfo.value = null
  try {
    destroyInfo.value = await api.billing.getDestroyInfo(instance.value.id) as any
  } catch {
    toast.error(t('instance.destroy.loadFailed'))
    showDestroyModal.value = false
  }
}

// 执行销毁
async function handleDestroy(): Promise<void> {
  if (!instance.value || !destroyInfo.value?.canDestroy) return
  destroyLoading.value = true
  try {
    const result = await api.billing.destroyInstance(instance.value.id)
    if (result.isFreeInstance) {
      toast.success(t('instance.destroy.success'))
    } else {
      toast.success(t('instance.destroy.successWithRefund', { amount: result.refundAmount.toFixed(2) }))
    }
    showDestroyModal.value = false
    // 跳转到实例列表
    router.push({ name: 'instances' })
  } catch (err) {
    const apiErr = err as { code?: string }
    if (apiErr.code === 'INSTANCE_DESTROY_TRAFFIC_LIMIT_EXCEEDED') {
      await loadDestroyInfo()
    }
    toast.error(translateError(err))
  } finally {
    destroyLoading.value = false
  }
}

// 监听销毁弹窗打开，加载销毁信息
watch(showDestroyModal, async (visible) => {
  if (visible) {
    await loadDestroyInfo()
  } else {
    destroyInfo.value = null
  }
})

// 异常实例快速销毁（免手续费）
async function handleErrorDestroy(): Promise<void> {
  if (!instance.value) return
  if (!confirm(t('instance.errorBanner.confirmDestroy'))) return
  errorDestroyLoading.value = true
  try {
    const result = await api.billing.destroyInstance(instance.value.id, { feeWaiver: 'error' })
    if (result.isFreeInstance) {
      toast.success(t('instance.destroy.success'))
    } else {
      toast.success(t('instance.destroy.successWithRefund', { amount: result.refundAmount.toFixed(2) }))
    }
    router.push({ name: 'instances' })
  } catch (err) {
    toast.error(translateError(err))
  } finally {
    errorDestroyLoading.value = false
  }
}

// 任务状态轮询
const activeTask = ref<{
  id: number
  taskType: string
  status: string
  progress?: string | null
  error?: string | null
  queuePosition: number
} | null>(null)
let taskPollingInterval: ReturnType<typeof setInterval> | null = null

// 是否禁用所有操作按钮（有任务进行中、有待处理转移或实例被封停时）
// 注意：封停状态下，实例所有者禁止所有操作，仅宿主机所有者/管理员可以解封
const isOperationDisabled = computed<boolean>(() => {
  // 封停状态下，实例所有者禁止操作（仅节点所有者可解封）
  // isHostOwner = true 表示当前用户是节点所有者
  const inst = instance.value as { isHostOwner?: boolean } | null
  const isHostOwner = inst?.isHostOwner === true
  if (isSuspended.value && !isHostOwner) {
    return true
  }
  return !!actionLoading.value || !!activeTask.value || hasPendingTransfer.value
})

// 操作
type InstanceAction = 'start' | 'stop' | 'restart' | 'delete' | 'clone'

// 开始任务轮询
// 注：_taskId 参数保留用于未来扩展（如按 taskId 指定轮询）
function startTaskPolling(_taskId: number): void {
  // 清除旧的轮询
  if (taskPollingInterval) {
    clearInterval(taskPollingInterval)
  }
  
  const pollTask = async (): Promise<void> => {
    if (!instance.value || !isComponentMounted.value) {
      stopTaskPolling()
      return
    }
    
    try {
      const response = await api.instances.getActiveTask(instance.value.id)
      activeTask.value = response.task
      
      // 如果任务已完成或失败，停止轮询并刷新实例
      if (!response.task || response.task.status === 'COMPLETED' || response.task.status === 'FAILED') {
        stopTaskPolling()
        if (response.task?.status === 'FAILED' && response.task.error) {
          toast.error(`${t('instance.detail.actions.actionFailed')}: ${response.task.error}`)
        }
        await loadInstance()
      }
    } catch (err) {
      console.error('Failed to poll task status:', err)
      // 出错时也停止轮询
      stopTaskPolling()
    }
  }
  
  // 立即执行一次
  pollTask()
  // 每2秒轮询一次
  taskPollingInterval = setInterval(pollTask, 2000)
}

function stopTaskPolling(): void {
  if (taskPollingInterval) {
    clearInterval(taskPollingInterval)
    taskPollingInterval = null
  }
  activeTask.value = null
}

async function handleAction(action: InstanceAction): Promise<void> {
  if (!instance.value) return
  actionLoading.value = action
  try {
    if (action === 'start') {
      const response = await api.instances.start(instance.value.id)
      toast.success(t('instance.detail.actions.taskQueued'))
      // 开始轮询任务状态
      startTaskPolling(response.taskId)
    }
    else if (action === 'stop') {
      const response = await api.instances.stop(instance.value.id)
      toast.success(t('instance.detail.actions.taskQueued'))
      startTaskPolling(response.taskId)
    }
    else if (action === 'restart') {
      const response = await api.instances.restart(instance.value.id)
      toast.success(t('instance.detail.actions.taskQueued'))
      startTaskPolling(response.taskId)
    }
    else if (action === 'delete') {
      if (!confirm(t('instance.detail.actions.confirmDelete', { name: instance.value.name }))) {
        actionLoading.value = ''
        return
      }
      
      await api.instances.delete(instance.value.id)
      toast.success(t('instance.detail.actions.deleted'))
      router.push(getReturnPath())
      return
    }
    else if (action === 'clone') {
      // 显示确认模态框
      showCloneModal.value = true
      actionLoading.value = ''
      return
    }
  } catch (error: any) {
    // 检查是否有活跃任务
    if (error?.code === 'TASK_IN_PROGRESS') {
      toast.warning(t('instance.detail.actions.taskInProgress'))
      // 开始轮询现有任务
      if (error?.taskId) {
        startTaskPolling(error.taskId)
      }
      return
    }
    toast.error(`${t('instance.detail.actions.actionFailed')}: ${translateError(error)}`)
  } finally {
    actionLoading.value = ''
  }
}

// 重建系统
// 点击重建按钮时的处理：运行中提示需要先关机
function handleRebuildClick(): void {
  if (isRunning.value) {
    toast.warning(t('instance.detail.actions.stopRequired'))
    return
  }
  openRebuildModal()
}

async function openRebuildModal(): Promise<void> {
  await Promise.all([loadAvailableImages(), loadSshKeys()])
  showRebuildModal.value = true
}

async function loadSshKeys(): Promise<void> {
  try {
    const response = await api.sshKeys.list()
    const keys = response.keys || []
    sshKeys.value = keys.map((k) => ({ id: k.id, name: k.name }))
  } catch (err: any) {
    console.error('Failed to load SSH keys:', err)
    toast.error(t('instance.detail.rebuild.loadKeysFailed'))
  }
}

async function doRebuild(data: { image: string; sshKeyId: number; customInitCommandIds?: number[] }): Promise<void> {
  if (!data.image || !data.sshKeyId || !instance.value) {
    toast.error(t('instance.detail.actions.selectImageAndKey'))
    return
  }
  
  rebuildLoading.value = true
  try {
    const response = await api.instances.rebuild(instance.value.id, {
      image: data.image,
      sshKeyId: data.sshKeyId,
      customInitCommandIds: data.customInitCommandIds
    })
    toast.success(t('instance.detail.actions.taskQueued'))
    showRebuildModal.value = false
    startTaskPolling(response.taskId)
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    rebuildLoading.value = false
  }
}

async function doRecreate(data: { image: string; sshKeyId: number; customInitCommandIds?: number[] }): Promise<void> {
  if (!data.image || !data.sshKeyId || !instance.value) {
    toast.error(t('instance.detail.actions.selectImageAndKey'))
    return
  }
  
  recreateLoading.value = true
  try {
    const response = await api.instances.recreate(instance.value.id, {
      image: data.image,
      sshKeyId: data.sshKeyId,
      customInitCommandIds: data.customInitCommandIds
    })
    toast.success(t('instance.detail.actions.taskQueued'))
    showRecreateModal.value = false
    startTaskPolling(response.taskId)
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    recreateLoading.value = false
  }
}

// 端口映射 - addPort 函数已移至 handleAddPort

async function deletePort(portId: number): Promise<void> {
  if (!instance.value || !confirm(t('instance.detail.port.confirmDelete'))) return
  
  try {
    await api.instances.deletePort(instance.value.id, portId)
    // 立即从本地数据移除，提供即时反馈
    if ((instance.value as any).port_mappings) {
      (instance.value as any).port_mappings = (instance.value as any).port_mappings.filter(
        (m: any) => m.id !== portId
      )
    }
    toast.success(t('instance.detail.port.deleted'))
  } catch (err: any) {
    toast.error(t('instance.detail.port.deleteFailed') + ': ' + translateError(err))
    // 失败时重新加载以恢复正确状态
    await loadInstance()
  }
}

// 批量删除端口映射
const deletePortsLoading = ref<boolean>(false)

async function deletePorts(portIds: number[]): Promise<void> {
  if (!instance.value || portIds.length === 0) return
  if (!confirm(t('instance.detail.port.confirmBatchDelete', { count: portIds.length }))) return
  
  deletePortsLoading.value = true
  let successCount = 0
  let failCount = 0
  
  try {
    for (const portId of portIds) {
      try {
        await api.instances.deletePort(instance.value.id, portId)
        // 立即从本地数据移除
        if ((instance.value as any).port_mappings) {
          (instance.value as any).port_mappings = (instance.value as any).port_mappings.filter(
            (m: any) => m.id !== portId
          )
        }
        successCount++
      } catch {
        failCount++
      }
    }
    
    if (failCount === 0) {
      toast.success(t('instance.detail.port.batchDeleted', { count: successCount }))
    } else {
      toast.warning(t('instance.detail.port.batchDeletePartial', { success: successCount, fail: failCount }))
      // 部分失败时重新加载以确保状态一致
      await loadInstance()
    }
  } finally {
    deletePortsLoading.value = false
  }
}

// 快照操作现在由 SnapshotManager 组件处理

// 封停/解封操作（仅宿主机所有者可操作）
function handleSuspend(): void {
  if (!instance.value || !canSuspend.value) return
  suspendReason.value = ''
  showSuspendModal.value = true
}

async function confirmSuspend(): Promise<void> {
  if (!instance.value || !canSuspend.value) return
  
  suspendLoading.value = true
  try {
    await api.instances.suspend(instance.value.id, suspendReason.value.trim() || undefined)
    toast.success(t('instance.detail.actions.suspendSuccess'))
    showSuspendModal.value = false
    suspendReason.value = ''
    await loadInstance()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    suspendLoading.value = false
  }
}

async function handleUnsuspend(): Promise<void> {
  if (!instance.value || !canSuspend.value) return
  
  if (!confirm(t('instance.detail.actions.confirmUnsuspend', { name: instance.value.name }))) {
    return
  }
  
  suspendLoading.value = true
  try {
    await api.instances.unsuspend(instance.value.id)
    toast.success(t('instance.detail.actions.unsuspendSuccess'))
    await loadInstance()
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    suspendLoading.value = false
  }
}

// 同步实例状态
async function handleSyncStatus(): Promise<void> {
  if (!instance.value) return
  
  syncStatusLoading.value = true
  try {
    const result = await api.instances.syncStatus(instance.value.id)
    const messages: string[] = []

    // 状态变更
    if (result.statusChanged) {
      messages.push(t('instance.detail.actions.syncStatusChanged', {
        from: result.from,
        to: result.to
      }))
    }

    // IPv4 变更
    if (result.ipv4Changed) {
      messages.push(t('instance.detail.actions.syncIpv4Changed', {
        from: result.oldIpv4 || 'N/A',
        to: result.newIpv4 || 'N/A'
      }))
      // 如果有反代站点更新
      if (result.proxySitesUpdated && result.proxySitesUpdated > 0) {
        messages.push(t('instance.detail.actions.syncProxySitesUpdated', {
          count: result.proxySitesUpdated
        }))
      }
    }

    if (messages.length > 0) {
      toast.success(messages.join('\n'))
      await loadInstance()
    } else {
      toast.info(t('instance.detail.actions.syncStatusNoChange'))
    }
  } catch (err: any) {
    toast.error(translateError(err))
  } finally {
    syncStatusLoading.value = false
  }
}

// 重新分配 IPv6
async function handleReassignIpv6(): Promise<void> {
  if (!instance.value) return
  
  // 检查网络模式
  if (instance.value.network_mode !== 'nat_ipv6') {
    toast.error(t('instance.detail.network.reassignIpv6NotSupported'))
    return
  }
  
  // 检查实例状态
  if (instance.value.status !== 'stopped') {
    toast.warning(t('instance.detail.network.reassignIpv6StopRequired'))
    return
  }
  
  // 确认操作
  if (!confirm(t('instance.detail.network.reassignIpv6Confirm') + '\n\n' + t('instance.detail.network.reassignIpv6ConfirmHint'))) {
    return
  }
  
  reassignIpv6Loading.value = true
  try {
    const result = await api.instances.reassignIpv6(instance.value.id)
    console.log('IPv6 reassigned:', result.oldIpv6, '->', result.newIpv6)
    toast.success(t('instance.detail.network.reassignIpv6Success'))
    // 重新加载实例以获取新的 IPv6
    await loadInstance()
  } catch (err: any) {
    toast.error(`${t('instance.detail.network.reassignIpv6Failed')}: ${translateError(err)}`)
  } finally {
    reassignIpv6Loading.value = false
  }
}


// 加载用户配额
async function loadUserQuota(): Promise<void> {
  if (!instance.value) return
  
  try {
    // 先尝试获取当前用户信息
    const meResponse = await api.auth.me()
    const currentUser = (meResponse as { user?: { id: number; role: string; quota?: UserQuota } }).user
    
    // 获取实例的用户ID（可能是userId或user_id）
    const instanceUserId = (instance.value as any).userId || instance.value.user_id
    
    // 如果是管理员或者是自己的实例，可以获取配额
    if (currentUser && (currentUser.role === 'admin' || currentUser.id === instanceUserId)) {
      if (currentUser.id === instanceUserId) {
        // 自己的实例，使用当前用户配额
        userQuota.value = currentUser.quota || null
      } else {
        // 管理员查看其他用户的实例，通过users API获取
        const userResponse = await api.users.get(instanceUserId)
        userQuota.value = ((userResponse as { user?: { quota?: UserQuota } }).user?.quota) || null
      }
      
      if (userQuota.value) {
        await calculateRemainingQuota()
      }
    }
  } catch (err) {
    console.error('Failed to load user quota:', err)
  }
}

// 检查是否有待处理的转移
// 注意：转移状态变化不频繁，不需要频繁检查
// 只在页面首次加载时检查，或在用户执行相关操作时检查
async function checkPendingTransfer(): Promise<void> {
  if (!instance.value) return
  
  try {
    // 检查发送的转移
    const sentResponse = await api.transfers.list('sent', { status: 'pending', pageSize: 100 })
    const hasSentPending = sentResponse.transfers.some(t => t.instanceId === instance.value?.id)
    
    // 检查接收的转移
    const receivedResponse = await api.transfers.list('received', { status: 'pending', pageSize: 100 })
    const hasReceivedPending = receivedResponse.transfers.some(t => t.instanceId === instance.value?.id)
    
    hasPendingTransfer.value = hasSentPending || hasReceivedPending
  } catch (err) {
    console.error('Failed to check pending transfer:', err)
    hasPendingTransfer.value = false
  }
}

// 检查是否有活跃的实例操作任务
async function checkActiveTask(): Promise<void> {
  if (!instance.value) return
  
  try {
    const response = await api.instances.getActiveTask(instance.value.id)
    if (response.task && (response.task.status === 'PENDING' || response.task.status === 'PROCESSING')) {
      activeTask.value = response.task
      // 开始轮询
      startTaskPolling(response.task.id)
    }
  } catch (err) {
    console.error('Failed to check active task:', err)
  }
}

// 点击转移按钮时的处理：运行中提示需要先关机
function handleTransferBtnClick(): void {
  if (isRunning.value) {
    toast.warning(t('instance.detail.actions.stopRequired'))
    return
  }
  handleTransferClick()
}

// 处理转移按钮点击：在打开转移弹窗前检查转移状态
async function handleTransferClick(): Promise<void> {
  // 在执行转移操作前，先检查是否有待处理的转移
  await checkPendingTransfer()
  if (!hasPendingTransfer.value) {
    showTransferModal.value = true
  }
}

// 计算剩余额度
async function calculateRemainingQuota(): Promise<void> {
  if (!instance.value) return
  
  try {
    // 优先使用后端返回的实时剩余额度
    if ((instance.value as any).remainingQuota) {
      remainingQuota.value = {
        port: (instance.value as any).remainingQuota.port || 0,
        snapshot: (instance.value as any).remainingQuota.snapshot || 0
      }
      return
    }
    
    // 新配额系统：端口/快照配额是实例级别的（从套餐包继承）
    // 直接从实例数据获取配额和使用量
    const portLimit = (instance.value as any).portLimit || 0
    const portMappings = (instance.value as any).port_mappings || []
    const portUsed = portMappings.length
    
    const snapshotLimit = (instance.value as any).snapshotLimit || 0
    const snapshots = (instance.value as any).snapshots || []
    const snapshotUsed = snapshots.length
    
    remainingQuota.value = {
      port: Math.max(0, portLimit - portUsed),
      snapshot: Math.max(0, snapshotLimit - snapshotUsed)
    }
  } catch (err) {
    console.error('Failed to calculate remaining quota:', err)
  }
}

// 实例配额
async function saveInstanceQuota(): Promise<void> {
  if (!instance.value) return
  quotaSaving.value = true
  quotaError.value = ''
  
  try {
    // 处理输入值：null、undefined、NaN都转为null
    const portLimit = (instanceQuotaForm.value.portLimit === null || 
                       instanceQuotaForm.value.portLimit === undefined ||
                       isNaN(Number(instanceQuotaForm.value.portLimit)))
                      ? null 
                      : Number(instanceQuotaForm.value.portLimit)
    
    const snapshotLimit = (instanceQuotaForm.value.snapshotLimit === null || 
                           instanceQuotaForm.value.snapshotLimit === undefined ||
                           isNaN(Number(instanceQuotaForm.value.snapshotLimit)))
                          ? null 
                          : Number(instanceQuotaForm.value.snapshotLimit)
    
    // 验证：不能小于当前已使用量
    if (portLimit !== null && portLimit < portMappingsCount.value) {
      quotaError.value = t('instance.detail.quota.portExceedUsed', { used: portMappingsCount.value, input: portLimit })
      quotaSaving.value = false
      return
    }
    
    if (snapshotLimit !== null && snapshotLimit < snapshots.value.length) {
      quotaError.value = t('instance.detail.quota.snapshotExceedUsed', { used: snapshots.value.length, input: snapshotLimit })
      quotaSaving.value = false
      return
    }
    
    // 验证：端口数、快照数必须在 1-1000 范围内（null 表示不限制）
    if (portLimit !== null && (portLimit < 1 || portLimit > 1000)) {
      quotaError.value = t('instance.detail.quota.portOutOfRange')
      quotaSaving.value = false
      return
    }
    
    if (snapshotLimit !== null && (snapshotLimit < 1 || snapshotLimit > 1000)) {
      quotaError.value = t('instance.detail.quota.snapshotOutOfRange')
      quotaSaving.value = false
      return
    }
    
    const payload: UpdateInstanceRequest = {
      portLimit: portLimit ?? undefined,
      snapshotLimit: snapshotLimit ?? undefined
    }
    
    // 使用实例对象的 ID，而不是从路由参数获取（更可靠）
    if (!instance.value || !instance.value.id) {
      quotaError.value = t('instance.detail.invalidId')
      quotaSaving.value = false
      return
    }
    const instanceId = instance.value.id
    await api.instances.updateQuota(instanceId, payload)
    toast.success(t('instance.detail.quota.saved'))
    
    // 清除错误信息
    quotaError.value = ''
    
    // 并行重新加载所有相关数据
    await Promise.all([
      loadInstance(),
      loadSnapshotsForQuota(),
      loadUserQuota()
    ])
  } catch (err: any) {
    quotaError.value = translateError(err)
    toast.error(t('instance.detail.quota.saveFailed') + ': ' + translateError(err))
  } finally {
    quotaSaving.value = false
  }
}

// 实用函数
async function copyToClipboard(text: string, key?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    if (key) {
      copied.value = key
      setTimeout(() => copied.value = '', 2000)
    } else {
      toast.success(t('instance.detail.copy.success'))
    }
  } catch {
    toast.error(t('instance.detail.copy.failed'))
  }
}

async function handleAddPort(form: { 
  protocol: 'tcp' | 'udp' | 'both'
  privatePort: string
  publicPort: string
  remark: string
  isRange?: boolean
  privatePortStart?: number
  privatePortEnd?: number
  publicPortStart?: number
  publicPortEnd?: number
}): Promise<void> {
  if (!form.privatePort || !instance.value) {
    portError.value = t('instance.detail.port.fillPrivatePort')
    return
  }
  
  portLoading.value = true
  portError.value = ''
  
  try {
    // 判断是否为范围输入
    if (form.isRange && form.privatePortStart !== undefined && form.privatePortEnd !== undefined) {
      // 批量端口映射
      const batchData: {
        protocol: 'tcp' | 'udp' | 'both'
        privatePortStart: number
        privatePortEnd: number
        publicPortStart?: number
        publicPortEnd?: number
        remark?: string
      } = {
        protocol: form.protocol,
        privatePortStart: form.privatePortStart,
        privatePortEnd: form.privatePortEnd
      }
      
      if (form.publicPortStart !== undefined && form.publicPortEnd !== undefined) {
        batchData.publicPortStart = form.publicPortStart
        batchData.publicPortEnd = form.publicPortEnd
      }
      
      if (form.remark?.trim()) {
        batchData.remark = form.remark.trim()
      }
      
      const response = await api.instances.addPortBatch(instance.value.id, batchData)
      
      // 检查是否有冲突
      if ('conflicts' in response && response.conflicts) {
        // 保存原始数据用于重新提交
        pendingBatchPortData.value = batchData
        portConflicts.value = response.conflicts
        showPortConflictModal.value = true
        showAddPortModal.value = false
        return
      }
      
      // 成功
      if ('mappings' in response && response.mappings) {
        showAddPortModal.value = false
        toast.success(t('instance.detail.port.batchAdded', { count: response.count }))
        // 重新加载实例数据
        loadInstance().catch(() => {})
      }
    } else {
      // 单个端口映射（原有逻辑）
      if (form.protocol === 'both') {
        let sharedPublicPort: number | undefined = form.publicPort ? parseInt(form.publicPort) : undefined
        
        // 先创建 TCP 映射
        const tcpPayload: { protocol: 'tcp' | 'udp'; privatePort: number; publicPort?: number; remark?: string } = {
          protocol: 'tcp',
          privatePort: parseInt(form.privatePort)
        }
        if (sharedPublicPort) {
          tcpPayload.publicPort = sharedPublicPort
        }
        if (form.remark?.trim()) {
          tcpPayload.remark = form.remark.trim()
        }
        
        const tcpResponse = await api.instances.addPort(instance.value!.id, tcpPayload)
        // @ts-ignore - API response structure
        const tcpMapping = tcpResponse.mapping
        if (tcpMapping && instance.value) {
          if (!(instance.value as any).port_mappings) {
            (instance.value as any).port_mappings = []
          }
          (instance.value as any).port_mappings.push({
            id: tcpMapping.id,
            protocol: tcpMapping.protocol,
            publicPort: tcpMapping.publicPort,
            privatePort: tcpMapping.privatePort,
            remark: tcpMapping.remark
          })
          // 如果用户没有指定端口，使用 TCP 分配到的端口作为 UDP 的端口
          if (!sharedPublicPort) {
            sharedPublicPort = tcpMapping.publicPort
          }
        }
        
        // 再创建 UDP 映射，使用相同的公网端口
        const udpPayload: { protocol: 'tcp' | 'udp'; privatePort: number; publicPort?: number; remark?: string } = {
          protocol: 'udp',
          privatePort: parseInt(form.privatePort),
          publicPort: sharedPublicPort
        }
        if (form.remark?.trim()) {
          udpPayload.remark = form.remark.trim()
        }
        
        const udpResponse = await api.instances.addPort(instance.value!.id, udpPayload)
        // @ts-ignore - API response structure
        const udpMapping = udpResponse.mapping
        if (udpMapping && instance.value) {
          (instance.value as any).port_mappings.push({
            id: udpMapping.id,
            protocol: udpMapping.protocol,
            publicPort: udpMapping.publicPort,
            privatePort: udpMapping.privatePort,
            remark: udpMapping.remark
          })
        }
        
        showAddPortModal.value = false
        toast.success(t('instance.detail.port.addedBoth'))
      } else {
        // 单协议：原逻辑
        const payload: { protocol: 'tcp' | 'udp'; privatePort: number; publicPort?: number; remark?: string } = {
          protocol: form.protocol,
          privatePort: parseInt(form.privatePort)
        }
        
        if (form.publicPort) {
          payload.publicPort = parseInt(form.publicPort)
        }
        
        if (form.remark?.trim()) {
          payload.remark = form.remark.trim()
        }
        
        const response = await api.instances.addPort(instance.value.id, payload)
        // @ts-ignore - API response structure
        const newMapping = response.mapping
        if (newMapping && instance.value) {
          if (!(instance.value as any).port_mappings) {
            (instance.value as any).port_mappings = []
          }
          (instance.value as any).port_mappings.push({
            id: newMapping.id,
            protocol: newMapping.protocol,
            publicPort: newMapping.publicPort,
            privatePort: newMapping.privatePort,
            remark: newMapping.remark
          })
        }
        showAddPortModal.value = false
        toast.success(t('instance.detail.port.added'))
      }
      // 后台重新加载以确保数据同步
      loadInstance().catch(() => {})
    }
  } catch (err: any) {
    // 检查是否是端口冲突错误，如果是则显示冲突弹窗
    if ((err?.error === 'PORT_CONFLICT' || err?.message === 'PORT_CONFLICT') && err?.conflicts) {
      // 保存原始数据用于重新提交
      if (form.isRange && form.privatePortStart !== undefined && form.privatePortEnd !== undefined) {
        pendingBatchPortData.value = {
          protocol: form.protocol,
          privatePortStart: form.privatePortStart,
          privatePortEnd: form.privatePortEnd,
          publicPortStart: form.publicPortStart,
          publicPortEnd: form.publicPortEnd,
          remark: form.remark?.trim() || undefined
        }
      }
      portConflicts.value = err.conflicts
      showPortConflictModal.value = true
      showAddPortModal.value = false
      return
    }
    portError.value = err?.message || String(err)
  } finally {
    portLoading.value = false
  }
}

// 端口冲突解决后重新提交
async function handlePortConflictConfirm(resolvedPorts: Array<{ original: number; resolved: number }>): Promise<void> {
  if (!instance.value || !pendingBatchPortData.value) return
  
  portLoading.value = true
  
  try {
    const data = pendingBatchPortData.value
    const privatePortCount = data.privatePortEnd - data.privatePortStart + 1
    
    // 构建新的端口映射列表
    const portMappings: Array<{ privatePort: number; publicPort: number }> = []
    
    // 获取原始的公网端口列表
    const originalPublicPorts: number[] = []
    if (data.publicPortStart !== undefined && data.publicPortEnd !== undefined) {
      for (let i = 0; i < privatePortCount; i++) {
        originalPublicPorts.push(data.publicPortStart + i)
      }
    }
    
    // 替换冲突的端口
    const resolvedMap = new Map(resolvedPorts.map(r => [r.original, r.resolved]))
    
    for (let i = 0; i < privatePortCount; i++) {
      const privatePort = data.privatePortStart + i
      const originalPublic = originalPublicPorts[i]
      const resolvedPublic = resolvedMap.get(originalPublic) ?? originalPublic
      
      portMappings.push({
        privatePort,
        publicPort: resolvedPublic
      })
    }
    
    // 重新提交，带上修改后的端口映射
    const response = await api.instances.addPortBatch(instance.value.id, {
      protocol: data.protocol,
      privatePortStart: data.privatePortStart,
      privatePortEnd: data.privatePortEnd,
      remark: data.remark,
      portMappings
    })
    
    if ('mappings' in response && response.mappings) {
      showPortConflictModal.value = false
      pendingBatchPortData.value = null
      portConflicts.value = []
      toast.success(t('instance.detail.port.batchAdded', { count: response.count }))
      loadInstance().catch(() => {})
    } else if ('conflicts' in response && response.conflicts) {
      // 仍有冲突
      portConflicts.value = response.conflicts
      toast.error(t('instance.detail.port.stillConflict'))
    }
  } catch (err: any) {
    toast.error(err?.message || String(err))
  } finally {
    portLoading.value = false
  }
}

function handlePortConflictCancel(): void {
  showPortConflictModal.value = false
  pendingBatchPortData.value = null
  portConflicts.value = []
}

async function togglePasswordVisibility(instanceId: number): Promise<void> {
  const isCurrentlyVisible = showPassword.value[instanceId]
  
  if (!isCurrentlyVisible && !instancePassword.value[instanceId]) {
    // 如果密码未加载，先加载密码
    try {
      const response = await api.instances.getPassword(instanceId)
      instancePassword.value[instanceId] = (response as { rootPassword?: string | null }).rootPassword || null
    } catch (error: any) {
      toast.error(`${t('instance.detail.password.loadFailed')}: ${translateError(error)}`)
      return
    }
  }
  
  showPassword.value[instanceId] = !showPassword.value[instanceId]
}

// 计算剩余天数（向上取整，与后端保持一致）
function getRemainingDays(expiresAt: string | Date | null): number {
  if (!expiresAt) return 0
  const now = new Date()
  const expires = new Date(expiresAt)
  if (Number.isNaN(expires.getTime())) return 0
  const diff = expires.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

function getRemainingDaysDisplay(days: number, expiresAt: string | Date | null): { text: string; className: string } {
  if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
    return {
      text: t('instance.freeInstanceLabel'),
      className: themeStore.isDark ? 'text-green-400' : 'text-green-600'
    }
  }

  if (days <= 0) {
    return {
      text: t('instance.expiredLabel'),
      className: themeStore.isDark ? 'text-red-400' : 'text-red-600'
    }
  }

  if (days <= 3) {
    return {
      text: `${days} ${t('common.days')}`,
      className: themeStore.isDark ? 'text-red-400' : 'text-red-600'
    }
  }

  if (days <= 7) {
    return {
      text: `${days} ${t('common.days')}`,
      className: themeStore.isDark ? 'text-yellow-400' : 'text-yellow-600'
    }
  }

  return {
    text: `${days} ${t('common.days')}`,
    className: themeStore.isDark ? 'text-green-400' : 'text-green-600'
  }
}

// 获取续费价格（应用 AFF 折扣后的实际价格）
// 优先使用实例专属价格 billingPrice，如果没有则使用方案价格 planPrice
function getRenewPrice(inst: InstanceWithDetails | null): number {
  if (!inst) return 0
  const instAny = inst as any
  // 优先使用实例专属价格（管理员设置的价格）
  const originalPrice = instAny.billingPrice ?? instAny.planPrice
  if (originalPrice !== undefined && originalPrice !== null) {
    // 如果有 AFF 折扣率，应用折扣
    if (instAny.affDiscountRate && instAny.affDiscountRate > 0) {
      const discountAmount = originalPrice * instAny.affDiscountRate
      return Math.round((originalPrice - discountAmount) * 100) / 100
    }
    return originalPrice
  }
  return 0
}

// 检查实例是否有 AFF 折扣
function hasAffDiscount(inst: InstanceWithDetails | null): boolean {
  if (!inst) return false
  const instAny = inst as any
  return instAny.affDiscountRate && instAny.affDiscountRate > 0
}

function hasAffBinding(inst: InstanceWithDetails | null): boolean {
  if (!inst) return false
  const instAny = inst as any
  return instAny.hasAffBinding === true || hasAffDiscount(inst)
}

// 获取 AFF 折扣百分比文本
function getAffDiscountText(inst: InstanceWithDetails | null): string {
  if (!inst) return ''
  const instAny = inst as any
  if (instAny.affDiscountRate && instAny.affDiscountRate > 0) {
    return `-${(instAny.affDiscountRate * 100).toFixed(0)}%`
  }
  return ''
}

function isHostedInstanceForAff(inst: InstanceWithDetails | null): boolean {
  if (!inst) return false
  const instAny = inst as any
  const hostName = instAny.host?.name || ''
  return instAny.isHostedInstance === true || hostName.toLowerCase().startsWith('peer')
}

function canApplyAffCode(inst: InstanceWithDetails | null): boolean {
  if (!inst || isHostOwnerOnly.value) return false
  const instAny = inst as any
  return Boolean(instAny.packagePlanId && instAny.expires_at)
    && !hasAffBinding(inst)
    && !isHostedInstanceForAff(inst)
}

// 获取计费周期文本
function getBillingCycleText(cycle: number | null | undefined): string {
  if (!cycle) return '-'
  if (configStore.freeSiteMode) return getFreeSiteBillingCycleLabel(cycle)
  switch (cycle) {
    case 1: return t('instance.subscription.monthly')
    case 3: return t('instance.subscription.quarterly')
    case 6: return t('instance.subscription.semiAnnual')
    case 12: return t('instance.subscription.annual')
    default: return `${cycle} ${t('instance.subscription.months')}`
  }
}

// 获取计费周期简称（用于价格显示）
function getBillingCycleShort(cycle: number | null | undefined): string {
  if (!cycle) return ''
  if (configStore.freeSiteMode) return getFreeSiteBillingCycleShort(cycle)
  switch (cycle) {
    case 1: return t('instance.subscription.perMonth')
    case 3: return t('instance.subscription.perQuarter')
    case 6: return t('instance.subscription.perHalfYear')
    case 12: return t('instance.subscription.perYear')
    default: return `/${cycle}${t('instance.subscription.months')}`
  }
}

function handleInstanceBadgeUpdated(badgeId: string | null): void {
  if (!instance.value) return
  instance.value.iconBadgeId = badgeId
}

function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return '-'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 格式化函数现在在 @/utils/formatters 中
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div v-if="loading">
      <SkeletonLoader type="detail" />
    </div>

    <template v-else-if="instance">
      <!-- Header -->
      <div class="page-header flex-col lg:flex-row gap-4 lg:gap-0">
        <div class="flex items-center gap-3 sm:gap-4 min-w-0">
          <RouterLink 
            :to="getReturnPath()" 
            class="flex h-11 w-11 sm:h-12 sm:w-12 flex-shrink-0 items-center justify-center rounded-2xl border transition-all duration-200"
            :class="themeStore.isDark 
              ? 'border-gray-800 bg-gray-950 text-gray-500 hover:border-gray-700 hover:bg-gray-900 hover:text-gray-200' 
              : 'border-gray-200 bg-white text-gray-400 shadow-sm hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700'"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" />
            </svg>
          </RouterLink>

          <div class="relative flex-shrink-0">
            <div
              class="absolute inset-0 rounded-[1.4rem] blur-xl opacity-70"
              :class="themeStore.isDark ? 'bg-blue-500/15' : 'bg-blue-200/70'"
            />
            <button
              type="button"
              class="relative flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-[1.4rem] border shadow-sm transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
              :class="themeStore.isDark
                ? 'border-gray-800 bg-gradient-to-br from-gray-900 via-gray-950 to-black hover:border-gray-700 hover:shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                : 'border-gray-200 bg-gradient-to-br from-white via-gray-50 to-slate-100 hover:border-gray-300 hover:shadow-md'"
              :aria-label="$t('instance.badgeModal.open')"
              :title="$t('instance.badgeModal.open')"
              @click="showInstanceBadgeModal = true"
            >
              <InstanceDisplayIcon
                :badge-id="instance.iconBadgeId"
                :fallback-icon="getInstanceIconType(instance)"
                :alt="instance.name"
                :size="36"
              />
            </button>
            <div
              class="absolute -bottom-1 -right-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm"
              :class="themeStore.isDark
                ? 'border-gray-800 bg-gray-950 text-gray-300'
                : 'border-gray-200 bg-white text-gray-700'"
            >
              {{ $t(`common.instanceType.${instance.instanceType}`) }}
            </div>
          </div>

          <div class="min-w-0">
            <div class="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div :class="['w-2.5 h-2.5 rounded-full flex-shrink-0', getStatusInfo(instance.status, t).dot]"></div>
              <h1 class="page-title max-w-full truncate">{{ instance.name }}</h1>
              <span :class="['badge', getStatusInfo(instance.status, t).class]">
                {{ getStatusInfo(instance.status, t).label }}
              </span>
            </div>
            <p class="page-description mt-0.5">{{ formatImageName(instance.image, (instance as any).imageName) }} · <span class="uppercase">{{ (instance as any).host?.name || (instance as any).host || '-' }}</span></p>
          </div>
        </div>
        
        <div class="flex items-center gap-2 flex-wrap">
          <!-- Active Task Indicator -->
          <div 
            v-if="activeTask"
            class="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm"
            :class="themeStore.isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700'"
          >
            <svg class="w-4 h-4 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span class="hidden sm:inline">{{ $t(`instance.detail.task.${activeTask.taskType}`) }}</span>
          </div>
          <!-- Transfer Lock Warning -->
          <div 
            v-if="hasPendingTransfer"
            class="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm"
            :class="themeStore.isDark ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-100 text-yellow-700'"
          >
            <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="hidden sm:inline">{{ $t('transfer.messages.instanceLocked') }}</span>
          </div>
          <!-- Suspended Warning -->
          <div 
            v-if="isSuspended"
            class="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm"
            :class="themeStore.isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700'"
          >
            <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <span class="hidden sm:inline">{{ $t('instance.detail.info.suspended') }}</span>
          </div>
          <!-- Cloud-init Initializing -->
          <div
            v-if="isRunning && !cloudInitReady"
            class="flex items-center gap-2"
          >
            <button
              class="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all"
              :class="[
                themeStore.isDark ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-amber-50 text-amber-600 border border-amber-200',
                cloudInitChecking ? 'opacity-70 cursor-wait' : 'hover:opacity-80 cursor-pointer'
              ]"
              :disabled="cloudInitChecking || cloudInitManualCompleting"
              :title="cloudInitBannerTooltip"
              @click="checkCloudInitStatus"
            >
              <svg v-if="cloudInitChecking" class="w-4 h-4 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <svg v-else class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="sm:hidden">{{ cloudInitBannerShort }}</span>
              <span class="hidden sm:inline">{{ cloudInitBannerTitle }}</span>
              <span
                class="hidden sm:inline text-xs font-medium"
                :class="themeStore.isDark ? 'text-amber-300' : 'text-amber-700'"
              >
                · {{ cloudInitBannerRetryText }}
              </span>
            </button>
            <button
              v-if="canManualCompleteCloudInit"
              class="btn-secondary btn-sm sm:btn inline-flex"
              :disabled="cloudInitChecking || cloudInitManualCompleting"
              :title="$t('instance.detail.cloudInit.manualComplete')"
              @click="manualCompleteCloudInit"
            >
              <svg v-if="cloudInitManualCompleting" class="w-4 h-4 sm:hidden animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <span class="sm:hidden">{{ $t('instance.detail.cloudInit.manualShort') }}</span>
              <span class="hidden sm:inline">{{ $t('instance.detail.cloudInit.manualComplete') }}</span>
            </button>
          </div>
          <!-- Rename Button -->
          <button 
            :disabled="isOperationDisabled" 
            class="btn-ghost btn-sm sm:btn inline-flex" 
            :title="$t('instance.actions.rename')"
            @click="openRenameModal"
          >
            <svg class="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span class="hidden sm:inline">{{ $t('instance.actions.rename') }}</span>
          </button>
          <!-- Terminal Button -->
          <button 
            v-if="isRunning" 
            class="btn-sm sm:btn inline-flex rounded-lg"
            :class="themeStore.isDark ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-500 hover:bg-green-600 text-white'"
            :title="$t('terminal.title')"
            @click="showTerminalModal = true"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="hidden sm:inline ml-1">{{ $t('terminal.title') }}</span>
          </button>
          <!-- Terminal Button (Disabled when not running) -->
          <button 
            v-if="isStopped" 
            disabled
            class="btn-sm sm:btn inline-flex rounded-lg opacity-50 cursor-not-allowed"
            :class="themeStore.isDark ? 'bg-green-600/50 text-white' : 'bg-green-500/50 text-white'"
            :title="$t('terminal.requiresRunning')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="hidden sm:inline ml-1">{{ $t('terminal.title') }}</span>
          </button>
          <button v-if="isStopped" :disabled="isOperationDisabled" class="btn-secondary btn-sm sm:btn" @click="handleAction('start')">
            <svg v-if="actionLoading === 'start'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ $t('instance.actions.start') }}</span>
          </button>
          <button v-if="isRunning" :disabled="isOperationDisabled" class="btn-secondary btn-sm sm:btn" @click="handleAction('stop')">
            <svg v-if="actionLoading === 'stop'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ $t('instance.actions.stop') }}</span>
          </button>
          <button v-if="isRunning" :disabled="isOperationDisabled" class="btn-secondary btn-sm sm:btn" @click="handleAction('restart')">
            <svg v-if="actionLoading === 'restart'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ $t('instance.actions.restart') }}</span>
          </button>
          <!-- 复制按钮（特殊颜色标记，只在停机时可用） -->
          <button 
            v-if="isStopped && canClone" 
            :disabled="isOperationDisabled" 
            class="btn-sm sm:btn inline-flex rounded-lg"
            :class="themeStore.isDark ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-purple-500 hover:bg-purple-600 text-white'"
            :title="actionLoading === 'clone' ? '' : $t('instance.actions.clone')"
            @click="handleAction('clone')"
          >
            <svg v-if="actionLoading === 'clone'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span v-if="actionLoading !== 'clone'" class="hidden sm:inline ml-1">{{ $t('instance.actions.clone') }}</span>
          </button>
          <!-- 复制按钮（运行时显示但禁用，hover 提示） -->
          <button 
            v-if="isRunning && canClone" 
            disabled
            class="btn-sm sm:btn inline-flex rounded-lg opacity-50 cursor-not-allowed"
            :class="themeStore.isDark ? 'bg-purple-600/50 text-white' : 'bg-purple-500/50 text-white'"
            :title="$t('instance.detail.actions.stopRequiredHint')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span class="hidden sm:inline ml-1">{{ $t('instance.actions.clone') }}</span>
          </button>
          <!-- 重建按钮（始终可点击，运行时提示需要先关机） -->
          <button 
            v-if="canRebuild" 
            :disabled="isOperationDisabled"
            class="btn-secondary btn-sm sm:btn inline-flex"
            :title="$t('instance.detail.rebuild.title')"
            @click="handleRebuildClick"
          >
            <span class="sm:hidden">{{ $t('instance.detail.rebuild.title') }}</span>
            <span class="hidden sm:inline">{{ $t('instance.detail.rebuild.title') }}</span>
          </button>
          <!-- 同步状态按钮 -->
          <button
            v-if="canSyncStatus"
            :disabled="syncStatusLoading"
            class="btn-secondary btn-sm sm:btn inline-flex"
            :title="$t('instance.detail.actions.syncStatus')"
            @click="handleSyncStatus"
          >
            <svg v-if="syncStatusLoading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else class="sm:hidden">{{ $t('instance.detail.actions.syncStatus') }}</span>
            <span class="hidden sm:inline">{{ $t('instance.detail.actions.syncStatus') }}</span>
          </button>
          <button
            v-if="canTransfer && !showPaidSubscriptionCard"
            :disabled="isOperationDisabled"
            class="btn-secondary btn-sm sm:btn inline-flex"
            :title="$t('transfer.actions.transfer')"
            @click="handleTransferBtnClick"
          >
            <span class="sm:hidden">{{ $t('transfer.actions.transfer') }}</span>
            <span class="hidden sm:inline">{{ $t('transfer.actions.transfer') }}</span>
          </button>
          <!-- 帮助按钮 -->
          <RouterLink 
            to="/help"
            class="btn-secondary btn-sm sm:btn inline-flex items-center"
            :title="$t('instance.detail.actions.help')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="hidden sm:inline ml-1">{{ $t('instance.detail.actions.help') }}</span>
          </RouterLink>
          <!-- 封停按钮（仅宿主机所有者可见，实例未封停时） -->
          <button 
            v-if="canSuspend && !isSuspended" 
            :disabled="suspendLoading" 
            class="btn-sm sm:btn inline-flex rounded-lg"
            :class="themeStore.isDark ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-orange-500 hover:bg-orange-600 text-white'"
            :title="$t('instance.detail.actions.suspend')"
            @click="handleSuspend"
          >
            <svg v-if="suspendLoading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <span class="hidden sm:inline ml-1">{{ $t('instance.actions.suspend') }}</span>
          </button>
          <!-- 解封按钮（仅宿主机所有者可见，实例已封停时） -->
          <button 
            v-if="canSuspend && isSuspended" 
            :disabled="suspendLoading" 
            class="btn-sm sm:btn inline-flex rounded-lg"
            :class="themeStore.isDark ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-500 hover:bg-green-600 text-white'"
            :title="$t('instance.detail.actions.unsuspend')"
            @click="handleUnsuspend"
          >
            <svg v-if="suspendLoading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="hidden sm:inline ml-1">{{ $t('instance.actions.unsuspend') }}</span>
          </button>
          <button v-if="canDeleteInstance" :disabled="isOperationDisabled" class="btn-danger btn-sm sm:btn" @click="handleAction('delete')">
            <svg v-if="actionLoading === 'delete'" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span v-else>{{ $t('common.delete') }}</span>
          </button>
        </div>
      </div>

      <!-- Tab Navigation -->
      <div 
        class="flex gap-1 p-1 rounded-lg w-full sm:w-fit overflow-x-auto"
        :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-100'"
      >
        <button 
          v-for="tab in visibleTabs"
          :key="tab.key"
          :class="[
            'flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
            activeTab === tab.key 
              ? (themeStore.isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900 shadow-sm')
              : (themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900')
          ]"
          @click="activeTab = tab.key as TabType"
        >
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="tab.icon" />
          </svg>
          <span class="hidden sm:inline">{{ $t(tab.labelKey) }}</span>
        </button>
      </div>

      <!-- Error State Banner -->
      <div 
        v-if="instance && isError"
        class="rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4"
        :class="themeStore.isDark 
          ? 'bg-red-500/10 border border-red-500/30' 
          : 'bg-red-50 border border-red-200'"
      >
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <svg 
            class="w-5 h-5 flex-shrink-0 mt-0.5"
            :class="themeStore.isDark ? 'text-red-400' : 'text-red-600'"
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div class="min-w-0">
            <p 
              class="text-sm font-medium"
              :class="themeStore.isDark ? 'text-red-400' : 'text-red-700'"
            >
              {{ $t('instance.errorBanner.title') }}
            </p>
            <p 
              class="text-xs mt-0.5"
              :class="themeStore.isDark ? 'text-red-300/70' : 'text-red-600'"
            >
              {{ $t('instance.errorBanner.description') }}
            </p>
          </div>
        </div>
        <button
          class="flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-colors w-full sm:w-auto text-center"
          :class="themeStore.isDark 
            ? 'bg-red-600 hover:bg-red-700 text-white' 
            : 'bg-red-600 hover:bg-red-700 text-white'"
          :disabled="errorDestroyLoading"
          @click="handleErrorDestroy"
        >
          <span v-if="errorDestroyLoading" class="inline-flex items-center gap-2">
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ $t('common.processing') }}
          </span>
          <span v-else>{{ $t('instance.errorBanner.destroyNow') }}</span>
        </button>
      </div>

      <!-- Tab Content -->
      <Transition name="tab" mode="out-in">
        <div :key="activeTab">
          <!-- Info Tab -->
          <div v-if="activeTab === 'info' && instance" class="space-y-4">
            <!-- Host Announcement Banner -->
            <div 
              v-if="(instance as any).hostAnnouncement"
              class="relative overflow-hidden rounded-[1.4rem] border px-4 py-3.5 sm:px-5 sm:py-4"
              :class="themeStore.isDark
                ? 'border-slate-700/80 bg-gradient-to-br from-slate-900 via-[#0f141b] to-[#0a0a0a]'
                : 'border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100 shadow-sm'"
            >
              <div class="pointer-events-none absolute inset-0 overflow-hidden">
                <div
                  class="absolute -top-8 -right-8 h-24 w-24 rounded-full blur-3xl"
                  :class="themeStore.isDark ? 'bg-sky-500/10' : 'bg-sky-100/70'"
                />
                <div
                  class="absolute left-8 bottom-0 h-16 w-16 rounded-full blur-3xl"
                  :class="themeStore.isDark ? 'bg-slate-400/8' : 'bg-slate-200/80'"
                />
              </div>

              <div class="relative flex flex-col gap-3">
                <div class="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <div class="flex items-start gap-3 min-w-0">
                    <div
                      class="flex h-10 w-10 sm:h-11 sm:w-11 flex-shrink-0 items-center justify-center rounded-xl border shadow-sm"
                      :class="themeStore.isDark
                        ? 'border-slate-700 bg-gradient-to-br from-slate-800 via-slate-900 to-[#101722] text-sky-300'
                        : 'border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 text-sky-600'"
                    >
                      <AnnouncementIcon class="h-7 w-7 sm:h-[30px] sm:w-[30px]" />
                    </div>

                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <h3
                          class="text-sm sm:text-[15px] font-semibold"
                          :class="themeStore.isDark ? 'text-slate-100' : 'text-slate-900'"
                        >
                          {{ $t('instance.hostAnnouncement') }}
                        </h3>
                      </div>
                      <p
                        class="mt-0.5 text-[11px] sm:text-xs uppercase tracking-[0.16em]"
                        :class="themeStore.isDark ? 'text-slate-400' : 'text-slate-500'"
                      >
                        {{ instanceHostName }}
                      </p>
                    </div>
                  </div>

                  <div
                    class="hidden sm:flex h-9 items-center rounded-full border px-3 text-[10px] font-medium uppercase tracking-[0.18em]"
                    :class="themeStore.isDark
                      ? 'border-slate-700 bg-slate-900/70 text-slate-300'
                      : 'border-slate-200 bg-white/80 text-slate-600'"
                  >
                    {{ instanceHostName }}
                  </div>
                </div>

                <p
                  class="text-sm leading-6 sm:text-[15px] sm:leading-7 whitespace-pre-wrap break-words"
                  :class="themeStore.isDark ? 'text-slate-200/92' : 'text-slate-700'"
                >
                  {{ (instance as any).hostAnnouncement }}
                </p>
              </div>
            </div>

            <!-- Paid Subscription Card (only for paid instances) -->
            <div 
              v-if="showPaidSubscriptionCard"
              class="card p-4 sm:p-5"
            >
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        class="inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                        :class="themeStore.isDark ? 'border-gray-800 bg-gray-900 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-600'"
                      >
                        {{ $t('instance.subscription.premium') }}
                      </span>
                      <span
                        class="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                        :class="
                          subscriptionRemainingDays <= 0
                            ? (themeStore.isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600')
                            : subscriptionRemainingDays <= 7
                              ? (themeStore.isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-700')
                              : (themeStore.isDark ? 'bg-green-500/10 text-green-400' : 'bg-green-50 text-green-700')
                        "
                      >
                        {{ subscriptionRemainingDisplay.text }}
                      </span>
                      <span
                        class="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                        :class="subscriptionAutoRenewEnabled
                          ? (themeStore.isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700')
                          : (themeStore.isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600')"
                      >
                        {{ subscriptionAutoRenewEnabled ? $t('instance.subscription.autoRenewOn') : $t('instance.subscription.autoRenewOff') }}
                      </span>
                    </div>

                    <div class="mt-4 min-w-0">
                      <h3
                        class="text-lg sm:text-xl font-semibold truncate"
                        :class="themeStore.isDark ? 'text-white' : 'text-gray-900'"
                      >
                        {{ (instance as any).planName }}
                      </h3>
                      <p
                        class="mt-1 text-sm truncate"
                        :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
                      >
                        {{ (instance as any).packageName }}
                      </p>
                    </div>
                  </div>

                  <div
                    class="rounded-xl border px-4 py-3 lg:min-w-[220px]"
                    :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/80' : 'border-gray-200 bg-gray-50/80'"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-[11px]" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                          {{ configStore.freeSiteMode ? freeSiteCopy.renewPrice : $t('instance.subscription.renewPrice') }}
                        </div>
                        <div class="mt-1.5 flex items-end gap-1.5">
                          <span
                            class="text-3xl font-semibold leading-none"
                            :class="themeStore.isDark ? 'text-white' : 'text-gray-900'"
                          >
                            ¥{{ getRenewPrice(instance).toFixed(2) }}
                          </span>
                          <span
                            class="pb-0.5 text-xs"
                            :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'"
                          >
                            {{ getBillingCycleShort((instance as any).billingCycle) }}
                          </span>
                        </div>
                      </div>

                      <span
                        v-if="hasAffDiscount(instance)"
                        class="inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium"
                        :class="themeStore.isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700'"
                      >
                        {{ getAffDiscountText(instance) }}
                      </span>
                      <button
                        v-else-if="canApplyAffCode(instance)"
                        type="button"
                        class="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors"
                        :class="themeStore.isDark
                          ? 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'"
                        @click="showApplyAffModal = true"
                      >
                        {{ $t('instance.subscription.applyAffShort') }}
                      </button>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                  <div
                    class="min-h-[84px] rounded-xl border p-3"
                    :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50/80'"
                  >
                    <div class="text-[11px]" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                      {{ $t('instance.subscription.expiresAt') }}
                    </div>
                    <div class="mt-1.5 text-sm font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                      {{ formatShortDate(instance.expires_at) }}
                    </div>
                  </div>

                  <div
                    class="min-h-[84px] rounded-xl border p-3"
                    :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50/80'"
                  >
                    <div class="text-[11px]" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                      {{ $t('instance.subscription.expiresIn') }}
                    </div>
                    <div class="mt-1.5 text-sm font-medium" :class="subscriptionRemainingDisplay.className">
                      {{ subscriptionRemainingDisplay.text }}
                    </div>
                  </div>

                  <div
                    class="min-h-[84px] rounded-xl border p-3"
                    :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50/80'"
                  >
                    <div class="text-[11px]" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                      {{ configStore.freeSiteMode ? freeSiteCopy.billingCycle : $t('instance.subscription.billingCycle') }}
                    </div>
                    <div class="mt-1.5 text-sm font-medium" :class="themeStore.isDark ? 'text-white' : 'text-gray-900'">
                      {{ getBillingCycleText((instance as any).billingCycle) }}
                    </div>
                  </div>

                  <div
                    class="min-h-[84px] rounded-xl border p-3"
                    :class="themeStore.isDark ? 'border-gray-800 bg-gray-950/60' : 'border-gray-200 bg-gray-50/80'"
                  >
                    <div class="text-[11px]" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
                      {{ $t('instance.subscription.autoRenew') }}
                    </div>
                    <div
                      class="mt-1.5 text-sm font-medium"
                      :class="subscriptionAutoRenewEnabled
                        ? (themeStore.isDark ? 'text-emerald-400' : 'text-emerald-700')
                        : (themeStore.isDark ? 'text-gray-200' : 'text-gray-900')"
                    >
                      {{ subscriptionAutoRenewEnabled ? $t('instance.subscription.autoRenewEnabled') : $t('instance.subscription.autoRenewDisabled') }}
                    </div>
                  </div>
                </div>

                <div
                  v-if="!isHostOwnerOnly"
                  class="border-t pt-4"
                  :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
                >
                  <div class="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                    <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      <button
                        class="btn-secondary btn-sm w-full justify-center sm:w-auto sm:min-w-[110px]"
                        @click="showRenewModal = true"
                      >
                        {{ $t('instance.subscription.renew') }}
                      </button>

                      <button
                        class="btn-secondary btn-sm w-full justify-center sm:w-auto sm:min-w-[110px]"
                        @click="showAutoRenewModal = true"
                      >
                        {{ $t('instance.subscription.autoRenew') }}
                      </button>

                      <button
                        v-if="instance.package_id && (instance as any).planId"
                        class="btn-secondary btn-sm w-full justify-center sm:w-auto sm:min-w-[110px]"
                        @click="showChangePlanModal = true"
                      >
                        {{ $t('billing.changePlan') }}
                      </button>

                      <button
                        v-if="canTransfer"
                        :disabled="isOperationDisabled"
                        class="btn-secondary btn-sm w-full justify-center sm:w-auto sm:min-w-[110px]"
                        @click="handleTransferBtnClick"
                      >
                        {{ $t('transfer.actions.transfer') }}
                      </button>
                    </div>

                    <button
                      :disabled="destroyButtonDisabled"
                      class="btn-danger btn-sm w-full lg:w-auto lg:min-w-[110px]"
                      :class="destroyButtonDisabled ? 'opacity-50 cursor-not-allowed' : ''"
                      @click="showDestroyModal = true"
                    >
                      {{ $t('instance.destroy.button') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Original Info Tab Content -->
            <InstanceInfoTab
              :instance="instance"
              :stats="stats"
              :stats-loading="statsLoading"
              :traffic-data="trafficData"
              :traffic-loading="trafficLoading"
              :show-password="showPassword"
              :instance-password="instancePassword"
              :can-edit-config="instance.isHostOwner === true"
              :enable-resource-pool="(instance as any).enableResourcePool === true"
              @toggle-password="togglePasswordVisibility"
              @copy="copyToClipboard"
              @edit-config="openConfigEditModal"
              @redeem="openRedeemModal"
            />
          </div>

          <!-- Network Tab -->
          <InstanceNetworkTab
            v-if="activeTab === 'network' && instance"
            :instance="instance"
            :copied="copied"
            :can-manage-ports="canManagePorts"
            :is-instance-owner="!isHostOwnerOnly"
            :reassign-ipv6-loading="reassignIpv6Loading"
            :last-ipv6-reassign-at="(instance as any).last_ipv6_reassign_at"
            :delete-ports-loading="deletePortsLoading"
            @copy="copyToClipboard"
            @add-port="showAddPortModal = true"
            @delete-port="deletePort"
            @delete-ports="deletePorts"
            @reassign-ipv6="handleReassignIpv6"
          />

          <!-- Sites Tab -->
          <InstanceSitesTab
            v-if="activeTab === 'sites' && instance"
            :instance-id="instance.id"
          />

          <!-- Traffic Tab -->
          <TrafficStats
            v-if="activeTab === 'traffic' && instance"
            :instance-id="instance.id"
          />

          <!-- Snapshots Tab -->
          <SnapshotManager
            v-if="activeTab === 'snapshots' && instance"
            :instance-id="instance.id"
            :instance-name="instance.name"
            :instance-status="instance.status"
            :snapshot-limit="(instance as any).snapshot_limit"
          />

          <!-- Quota Tab -->
          <InstanceQuotaTab
            v-if="activeTab === 'quota' && instance"
            :instance="instance"
            :port-mappings-count="portMappingsCount"
            :snapshots="snapshots"
            :quota-form="instanceQuotaForm"
            :quota-saving="quotaSaving"
            :quota-error="quotaError"
            :remaining-quota="remainingQuota"
            @update:quota-form="instanceQuotaForm = $event"
            @save="saveInstanceQuota"
          />

          <!-- Config Tab -->
          <InstanceConfigTab
            v-if="activeTab === 'config' && instance"
            :instance-id="instance.id"
            :can-edit-config="instance.isHostOwner === true"
            :show-boot-settings="instance.isHostOwner === true"
            :instance-type="(instance as any).instanceType || 'container'"
            :instance-status="instance.status"
            :is-instance-owner="(instance as any).isInstanceOwner === true || authStore.isAdmin"
            @change-host-task="startTaskPolling"
          />

          <!-- Logs Tab -->
          <InstanceLogsTab
            v-if="activeTab === 'logs' && instance"
            :instance-id="instance.id"
            :instance-name="instance.name"
          />
        </div>
      </Transition>
    </template>

    <!-- Modals -->
    <AddPortModal
      v-model:visible="showAddPortModal"
      :loading="portLoading"
      :error="portError"
      :port-range-start="(instance as any)?.port_range_start"
      :port-range-end="(instance as any)?.port_range_end"
      :port-quota-current="(instance as any)?.port_mappings?.length || 0"
      :port-quota-limit="(instance as any)?.port_limit || 0"
      :network-mode="(instance as any)?.network_mode"
      @submit="handleAddPort"
    />

    <PortConflictModal
      v-model:visible="showPortConflictModal"
      :loading="portLoading"
      :conflicts="portConflicts"
      :port-range-start="(instance as any)?.port_range_start"
      :port-range-end="(instance as any)?.port_range_end"
      @confirm="handlePortConflictConfirm"
      @cancel="handlePortConflictCancel"
    />

    <RebuildModal
      v-model:visible="showRebuildModal"
      :loading="rebuildLoading"
      :available-images="availableImages"
      :ssh-keys="sshKeys"
      @submit="doRebuild"
    />

    <RecreateModal
      v-model:visible="showRecreateModal"
      :loading="recreateLoading"
      :available-images="availableImages"
      :ssh-keys="sshKeys"
      @submit="doRecreate"
    />

    <!-- Transfer Modal -->
    <TransferModal
      v-if="instance"
      :show="showTransferModal"
      :instance="{ id: instance.id, name: instance.name, cpu: instance.cpu, memory: instance.memory, disk: instance.disk }"
      @close="showTransferModal = false"
      @success="loadInstance"
    />

    <!-- Config Edit Modal -->
    <ConfigEditModal
      v-if="instance"
      :show="showConfigEditModal"
      :instance="instance"
      :pkg="instancePackage"
      :user-quota="userQuota"
      :stats="stats"
      :loading="configEditLoading"
      @update:show="showConfigEditModal = $event"
      @confirm="handleConfigEdit"
    />

    <!-- Redeem Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showRedeemModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showRedeemModal = false"></div>
          <div class="modal-content max-w-md">
            <div class="modal-header">
              <h3 class="modal-title">{{ $t('instance.detail.info.redeemTitle') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showRedeemModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body space-y-4">
              <div>
                <label class="block text-sm text-themed-muted mb-1">{{ $t('checkin.enterCode') }}</label>
                <input
                  v-model="redeemCodeInput"
                  type="text"
                  class="input w-full"
                  :placeholder="$t('checkin.systemCodePlaceholder')"
                  @keyup.enter="handleRedeem"
                />
              </div>
              <div v-if="instance" class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                <div class="flex items-center gap-2">
                  <span class="text-sm text-themed-muted">{{ $t('checkin.targetInstance') }}:</span>
                  <span class="text-sm font-medium text-themed">{{ instance.name }}</span>
                </div>
              </div>
              <div class="text-xs text-themed-muted p-3 rounded-lg bg-themed-secondary">
                <p>{{ $t('checkin.systemCodeHint') }}</p>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn" @click="showRedeemModal = false">{{ $t('common.cancel') }}</button>
              <button 
                class="btn btn-primary"
                :disabled="redeemLoading || !redeemCodeInput.trim()"
                @click="handleRedeem"
              >
                <svg v-if="redeemLoading" class="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ $t('checkin.redeemButton') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Renew Modal -->
    <RenewModal
      v-if="instance"
      v-model:show="showRenewModal"
      :instance-id="instance.id"
      :instance-name="instance.name"
      @success="handleRenewSuccess"
    />

    <!-- Apply AFF Code Modal -->
    <ApplyAffCodeModal
      v-if="instance"
      v-model:show="showApplyAffModal"
      :instance-id="instance.id"
      :instance-name="instance.name"
      :renew-price="getRenewPrice(instance)"
      :billing-cycle-label="getBillingCycleShort((instance as any).billingCycle)"
      @success="handleApplyAffSuccess"
    />

    <!-- Change Plan Modal -->
    <ChangePlanModal
      v-if="instance && instance.package_id && (instance as any).planId"
      v-model:show="showChangePlanModal"
      :instance-id="instance.id"
      :instance-name="instance.name"
      :package-id="instance.package_id"
      :current-plan-id="(instance as any).planId"
      :current-billing-price="(instance as any).billingPrice ?? null"
      :current-billing-cycle="(instance as any).billingCycle ?? null"
      :instance-type="(instance as any).instanceType || 'container'"
      @success="handleChangePlanSuccess"
    />

    <!-- Destroy Instance Modal -->
    <DestroyInstanceModal
      v-model:visible="showDestroyModal"
      :loading="destroyLoading"
      :destroy-info="destroyInfo"
      @destroy="handleDestroy"
    />

    <!-- Rename Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showRenameModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showRenameModal = false"></div>
          <div class="modal-content max-w-md">
            <div class="modal-header">
              <h3 class="modal-title">{{ $t('instance.renameModal.title') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showRenameModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <label class="block text-sm text-themed-secondary mb-1.5">{{ $t('instance.renameModal.name') }}</label>
              <input 
                v-model="newInstanceName" 
                type="text" 
                class="input" 
                :placeholder="$t('instance.renameModal.namePlaceholder')"
                @keyup.enter="doRename"
              />
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showRenameModal = false">{{ $t('instance.renameModal.cancel') }}</button>
              <button :disabled="renameLoading || !newInstanceName.trim()" class="btn-primary" @click="doRename">
                {{ renameLoading ? $t('instance.renameModal.renaming') : $t('instance.renameModal.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Clone Confirm Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCloneModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showCloneModal = false"></div>
          <div class="modal-content max-w-md">
            <div class="modal-header">
              <h3 class="modal-title">{{ $t('instance.detail.actions.clone') }}</h3>
              <button 
                class="text-themed-muted hover:text-themed" 
                :disabled="cloneLoading"
                @click="showCloneModal = false"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <p class="text-themed mb-4">{{ $t('instance.detail.actions.confirmClone', { name: instance?.name || '' }) }}</p>
              <div class="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 mb-4">
                <p class="text-sm text-blue-400">
                  {{ $t('instance.detail.actions.cloneNotice') }}
                </p>
              </div>
              <div v-if="cloneLoading" class="flex items-center justify-center py-4">
                <svg class="w-6 h-6 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <span class="ml-2 text-themed">{{ $t('instance.detail.actions.cloning') }}</span>
              </div>
            </div>
            <div class="modal-footer">
              <button 
                class="btn-secondary" 
                :disabled="cloneLoading"
                @click="showCloneModal = false"
              >
                {{ $t('common.cancel') }}
              </button>
              <button 
                :disabled="cloneLoading" 
                class="btn-primary"
                :class="themeStore.isDark ? 'bg-purple-600 hover:bg-purple-700' : 'bg-purple-500 hover:bg-purple-600'"
                @click="doClone"
              >
                {{ cloneLoading ? $t('instance.detail.actions.cloning') : $t('common.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Suspend Confirm Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showSuspendModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showSuspendModal = false"></div>
          <div class="modal-content max-w-md">
            <div class="modal-header">
              <h3 class="modal-title text-orange-500">{{ $t('instance.detail.actions.suspend') }}</h3>
              <button 
                class="text-themed-muted hover:text-themed" 
                :disabled="suspendLoading"
                @click="showSuspendModal = false"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body space-y-4">
              <p class="text-themed">{{ $t('instance.detail.actions.confirmSuspend', { name: instance?.name || '' }) }}</p>
              <div class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-orange-50 border border-orange-200'">
                <p class="text-sm" :class="themeStore.isDark ? 'text-orange-400' : 'text-orange-600'">
                  {{ $t('instance.detail.actions.confirmSuspendNotice') }}
                </p>
              </div>
              <div>
                <label class="block text-sm font-medium text-themed-secondary mb-1">{{ $t('instance.detail.actions.suspendReason') }}</label>
                <textarea
                  v-model="suspendReason"
                  rows="3"
                  maxlength="500"
                  :placeholder="$t('instance.detail.actions.suspendReasonPlaceholder')"
                  class="input w-full resize-none"
                />
                <p class="mt-1 text-xs text-themed-muted">{{ suspendReason.length }}/500</p>
              </div>
            </div>
            <div class="modal-footer">
              <button 
                class="btn-secondary" 
                :disabled="suspendLoading"
                @click="showSuspendModal = false"
              >
                {{ $t('common.cancel') }}
              </button>
              <button 
                :disabled="suspendLoading" 
                class="text-white"
                :class="themeStore.isDark ? 'bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg' : 'bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-lg'"
                @click="confirmSuspend"
              >
                <svg v-if="suspendLoading" class="w-4 h-4 mr-1 inline animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ suspendLoading ? $t('instance.detail.actions.suspending') : $t('instance.detail.actions.suspend') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Terminal Modal -->
    <TerminalModal
      v-model:visible="showTerminalModal"
      v-model:force-disconnect="terminalForceDisconnect"
      :instance-id="instance?.id || null"
      :instance-name="instance?.name"
      :allow-manual-cloud-init-complete="hasCloudInitManualPermission"
      @update:connected="terminalConnected = $event"
      @update:session-active="terminalSessionActive = $event"
      @update:tab-count="terminalTabCount = $event"
      @cloud-init-manual-complete="handleTerminalCloudInitManualComplete"
    />

    <!-- 终端悬浮按钮 - 当终端会话存在但模态框关闭时显示 -->
    <Transition name="slide-up">
      <div
        v-if="terminalSessionActive && !showTerminalModal && isRunning"
        class="fixed right-4 z-40 flex items-center gap-1 rounded-xl shadow-xl select-none"
        :class="[
          themeStore.isDark 
            ? 'bg-neutral-900/95 border border-neutral-700 backdrop-blur-sm' 
            : 'bg-white/95 border border-gray-200 backdrop-blur-sm shadow-lg',
          isDragging ? 'cursor-grabbing' : ''
        ]"
        :style="terminalFabY !== null ? { top: terminalFabY + 'px' } : { bottom: '96px' }"
      >
        <!-- 拖动手柄 -->
        <div
          class="flex items-center px-2 py-3 cursor-grab active:cursor-grabbing touch-none"
          :class="themeStore.isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-gray-400 hover:text-gray-600'"
          @mousedown="startDrag"
          @touchstart.prevent="startDrag"
        >
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 6a2 2 0 11-4 0 2 2 0 014 0zM8 12a2 2 0 11-4 0 2 2 0 014 0zM8 18a2 2 0 11-4 0 2 2 0 014 0zM14 6a2 2 0 11-4 0 2 2 0 014 0zM14 12a2 2 0 11-4 0 2 2 0 014 0zM14 18a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
        <!-- 分割线 -->
        <div class="w-px h-6" :class="themeStore.isDark ? 'bg-neutral-700' : 'bg-gray-200'" />
        <!-- 恢复按钮 -->
        <button
          class="flex items-center gap-2.5 px-3 py-2.5 transition-colors"
          :class="themeStore.isDark 
            ? 'hover:bg-neutral-800 text-white' 
            : 'hover:bg-gray-50 text-gray-900'"
          :title="$t('terminal.restore')"
          @click="showTerminalModal = true"
        >
          <!-- 连接状态指示器：绿色闪烁=连接中，灰色=断开 -->
          <span class="relative flex h-2 w-2">
            <span 
              v-if="terminalConnected" 
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
            ></span>
            <span 
              class="relative inline-flex rounded-full h-2 w-2" 
              :class="terminalConnected ? 'bg-emerald-500' : 'bg-neutral-400'"
            ></span>
          </span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span class="text-sm font-medium">{{ $t('terminal.title') }}</span>
          <!-- 标签数量徽章 -->
          <span 
            v-if="terminalTabCount > 1" 
            class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium rounded-full"
            :class="themeStore.isDark ? 'bg-neutral-700 text-neutral-300' : 'bg-gray-200 text-gray-600'"
          >
            {{ terminalTabCount }}
          </span>
        </button>
        <!-- 分割线 -->
        <div class="w-px h-6" :class="themeStore.isDark ? 'bg-neutral-700' : 'bg-gray-200'" />
        <!-- 断开连接按钮 -->
        <button
          class="p-2.5 rounded-r-xl transition-colors"
          :class="themeStore.isDark 
            ? 'text-neutral-400 hover:text-red-400 hover:bg-neutral-800' 
            : 'text-gray-400 hover:text-red-500 hover:bg-gray-50'"
          :title="$t('terminal.disconnect')"
          @click="terminalForceDisconnect = true; terminalSessionActive = false; terminalTabCount = 0"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </Transition>

    <!-- 自动续费设置弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showAutoRenewModal && instance"
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <!-- 背景遮罩 -->
          <div 
            class="absolute inset-0 bg-black/50" 
            @click="showAutoRenewModal = false"
          />
          <!-- 弹窗内容 -->
          <div 
            class="relative w-full max-w-md rounded-xl shadow-xl overflow-hidden"
            :class="themeStore.isDark ? 'bg-neutral-800' : 'bg-white'"
          >
            <!-- 标题 -->
            <div 
              class="px-6 py-4 border-b"
              :class="themeStore.isDark ? 'border-neutral-700' : 'border-gray-100'"
            >
              <h3 
                class="text-lg font-semibold"
                :class="themeStore.isDark ? 'text-white' : 'text-gray-900'"
              >
                {{ $t('instance.subscription.autoRenew') }}
              </h3>
            </div>
            <!-- 内容 -->
            <div class="px-6 py-5">
              <!-- 当前状态 -->
              <div 
                class="flex items-center justify-between p-4 rounded-lg mb-4"
                :class="themeStore.isDark ? 'bg-neutral-700/50' : 'bg-gray-50'"
              >
                <span :class="themeStore.isDark ? 'text-slate-300' : 'text-gray-600'">
                  {{ $t('instance.subscription.currentStatus') }}
                </span>
                <span 
                  class="font-medium"
                  :class="(instance as any).autoRenew 
                    ? (themeStore.isDark ? 'text-emerald-400' : 'text-emerald-600')
                    : (themeStore.isDark ? 'text-slate-400' : 'text-gray-500')"
                >
                  {{ (instance as any).autoRenew 
                    ? $t('instance.subscription.autoRenewEnabled') 
                    : $t('instance.subscription.autoRenewDisabled') }}
                </span>
              </div>
              <!-- 说明 -->
              <p 
                class="text-sm mb-4"
                :class="themeStore.isDark ? 'text-slate-400' : 'text-gray-500'"
              >
                {{ $t('instance.subscription.autoRenewDesc', { 
                  cycle: getBillingCycleText((instance as any).billingCycle),
                  price: getRenewPrice(instance).toFixed(2)
                }) }}
              </p>
              <!-- 提示 -->
              <div 
                class="flex items-start gap-2 p-3 rounded-lg text-sm"
                :class="themeStore.isDark ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'"
              >
                <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{{ $t('instance.subscription.autoRenewHint') }}</span>
              </div>
            </div>
            <!-- 操作按钮 -->
            <div 
              class="px-6 py-4 border-t flex gap-3"
              :class="themeStore.isDark ? 'border-neutral-700' : 'border-gray-100'"
            >
              <button
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                :class="themeStore.isDark 
                  ? 'bg-neutral-700 text-white hover:bg-neutral-600' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                @click="showAutoRenewModal = false"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                v-if="(instance as any).autoRenew"
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                :class="themeStore.isDark 
                  ? 'bg-red-600 hover:bg-red-700 text-white' 
                  : 'bg-red-500 hover:bg-red-600 text-white'"
                :disabled="autoRenewLoading"
                @click="handleSetAutoRenew(false)"
              >
                <span v-if="autoRenewLoading" class="flex items-center justify-center gap-2">
                  <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke-width="4" class="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke-width="4" class="opacity-75" />
                  </svg>
                  {{ $t('common.processing') }}
                </span>
                <span v-else>{{ $t('instance.subscription.disableAutoRenew') }}</span>
              </button>
              <button
                v-else
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                :class="themeStore.isDark 
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white' 
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'"
                :disabled="autoRenewLoading"
                @click="handleSetAutoRenew(true)"
              >
                <span v-if="autoRenewLoading" class="flex items-center justify-center gap-2">
                  <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke-width="4" class="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke-width="4" class="opacity-75" />
                  </svg>
                  {{ $t('common.processing') }}
                </span>
                <span v-else>{{ $t('instance.subscription.enableAutoRenew') }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <InstanceBadgeModal
      v-if="instance"
      :visible="showInstanceBadgeModal"
      :instance-id="instance.id"
      :instance-name="instance.name"
      :badge-id="instance.iconBadgeId"
      :fallback-icon="getInstanceIconType(instance)"
      @close="showInstanceBadgeModal = false"
      @updated="handleInstanceBadgeUpdated"
    />
  </div>
</template>
