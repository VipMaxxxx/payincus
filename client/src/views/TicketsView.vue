<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import InstanceDisplayIcon from '@/components/InstanceDisplayIcon.vue'
import InstanceSelector from '@/components/InstanceSelector.vue'
import TicketImageLightbox from '@/components/tickets/TicketImageLightbox.vue'
import TicketImageUploader from '@/components/tickets/TicketImageUploader.vue'
import TicketInstanceOwnerCard from '@/components/tickets/TicketInstanceOwnerCard.vue'
import { ticketsPath } from '@/utils/app-paths'
import { buildApiUrl } from '@/utils/api-url'
import { useReveal } from '@/composables/useReveal'
import type {
  Ticket,
  TicketMessage,
  TicketMessageAttachment,
  TicketStatus,
  TicketPriority,
  TicketCategory,
  TicketObjectLinkType,
  TicketSupportContext,
  TicketAiDraftResponse,
  TicketAiReplyResponse,
  InstanceWithDetails
} from '@/types/api'

const { t } = useI18n()
const toast = useToast()
const authStore = useAuthStore()
const configStore = useConfigStore()
const route = useRoute()
const router = useRouter()

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)

// Tab state
type TabType = 'my' | 'host'
const activeTab = ref<TabType>('my')

// View state
type ViewMode = 'list' | 'detail' | 'create'
const viewMode = ref<ViewMode>('list')

// List data
const tickets = ref<Ticket[]>([])
const loading = ref(true)
const refreshing = ref(false)
const pendingCount = ref({ userTickets: 0, hostTickets: 0, total: 0, isHostOwner: false })

// Pagination
const page = ref(1)
const pageSize = ref(100)
const pageSizeOptions = [10, 20, 50, 100]
const total = ref(0)
const totalPages = computed(() => Math.ceil(total.value / pageSize.value))

// Search
const searchQuery = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

// Filters - 默认筛选活跃工单（排除已关闭）
type StatusFilterType = TicketStatus | 'active' | 'all'
type HostTicketSourceType = 'all' | 'user' | 'official' | 'hosted'
type TicketQueueFilter = 'all' | 'pending' | 'due_soon' | 'overdue' | 'waiting_user' | 'waiting_internal'
const statusFilter = ref<StatusFilterType>('active')
const hostFilter = ref<number | ''>('')
const hostTicketSourceFilter = ref<HostTicketSourceType>('all')
const queueFilter = ref<TicketQueueFilter>('all')

// Detail data
const selectedTicket = ref<Ticket | null>(null)
const messages = ref<TicketMessage[]>([])
const messagesLoading = ref(false)
const isOwner = ref(false)
const isCreator = ref(false)
const supportContext = ref<TicketSupportContext | null>(null)
const supportContextLoading = ref(false)
const internalNoteContent = ref('')
const internalNoteSubmitting = ref(false)
const notifyContent = ref('')
const notifySubmitting = ref(false)
const aiDraftLoading = ref(false)
const aiReplyLoading = ref(false)
const linkForm = ref({
  objectType: 'instance' as TicketObjectLinkType,
  objectId: ''
})
const linkSubmitting = ref(false)

// Messages pagination
const messagesPage = ref(1)
const messagesPageSize = ref(100)
const messagesTotal = ref(0)
const messagesTotalPages = computed(() => Math.ceil(messagesTotal.value / messagesPageSize.value))
const messagesLoadingMore = ref(false)

// Reply
const replyContent = ref('')
const replying = ref(false)
const replyAttachments = ref<File[]>([])

// Create form
const createForm = ref({
  instanceId: null as number | null,
  subject: '',
  category: 'general' as TicketCategory,
  priority: 'normal' as TicketPriority,
  content: ''
})
const creating = ref(false)
const createAttachments = ref<File[]>([])
const availableInstances = ref<InstanceWithDetails[]>([])
const instancesLoading = ref(false)
const attachmentObjectUrls = ref<Record<number, string>>({})
const attachmentLoadingIds = ref<Record<number, boolean>>({})
const lightboxOpen = ref(false)
const lightboxStartIndex = ref(0)

// 将实例列表转换为 InstanceSelector 组件需要的格式
const formattedInstances = computed(() => {
  return availableInstances.value.map(inst => ({
    id: inst.id,
    name: inst.name,
    status: inst.status,
    instanceType: (inst.instanceType || 'container') as 'vm' | 'container',
    host: {
      id: inst.host?.id ?? 0,
      name: inst.host?.name ?? '',
      location: inst.host?.location ?? null,
      countryCode: inst.host?.country_code ?? 'us'
    }
  }))
})

// Statuses and priorities
const statuses: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed']
const priorities: TicketPriority[] = ['low', 'normal', 'high', 'urgent']
const categories: TicketCategory[] = ['general', 'billing', 'technical', 'abuse']

// Status colors
const statusColors: Record<TicketStatus, string> = {
  open: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  closed: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

const priorityColors: Record<TicketPriority, string> = {
  low: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  normal: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  high: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  urgent: 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
}

const slaStatusColors = {
  waiting_first_response: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  waiting_user: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  waiting_internal: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  due_soon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  met: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  closed: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}

const ticketLinkTypes: TicketObjectLinkType[] = ['recharge_record', 'order_operation_case', 'instance', 'host', 'delivery_case', 'sla_alert', 'plugin_task']

const lightboxImages = computed(() => {
  return messages.value.flatMap(message =>
    message.attachments
      .map(attachment => {
        const src = attachmentObjectUrls.value[attachment.id]
        if (!src) return null
        return {
          id: attachment.id,
          src,
          alt: attachment.originalName || attachment.filename
        }
      })
      .filter((item): item is { id: number; src: string; alt: string } => item !== null)
  )
})

function revokeAttachmentUrls(): void {
  for (const url of Object.values(attachmentObjectUrls.value)) {
    URL.revokeObjectURL(url)
  }
  attachmentObjectUrls.value = {}
  attachmentLoadingIds.value = {}
}

async function ensureAttachmentObjectUrl(attachment: TicketMessageAttachment): Promise<void> {
  if (attachmentObjectUrls.value[attachment.id] || attachmentLoadingIds.value[attachment.id]) {
    return
  }

  attachmentLoadingIds.value = {
    ...attachmentLoadingIds.value,
    [attachment.id]: true
  }

  try {
    const blob = await api.tickets.getAttachmentContent(attachment.id)
    attachmentObjectUrls.value = {
      ...attachmentObjectUrls.value,
      [attachment.id]: URL.createObjectURL(blob)
    }
  } catch (error) {
    console.error('Failed to load ticket attachment:', error)
  } finally {
    const nextLoadingIds = { ...attachmentLoadingIds.value }
    delete nextLoadingIds[attachment.id]
    attachmentLoadingIds.value = nextLoadingIds
  }
}

async function ensureMessageAttachmentUrls(messageList: TicketMessage[]): Promise<void> {
  await Promise.all(messageList.flatMap(message => message.attachments.map(attachment => ensureAttachmentObjectUrl(attachment))))
}

function openAttachmentLightbox(attachmentId: number): void {
  const index = lightboxImages.value.findIndex(image => image.id === attachmentId)
  if (index === -1) return
  lightboxStartIndex.value = index
  lightboxOpen.value = true
}

onBeforeUnmount(() => {
  revokeAttachmentUrls()
})

// 管理员或拥有节点的用户可以查看收到的工单
const isHostOwner = computed(() => authStore.isAdmin || pendingCount.value.isHostOwner)

type TicketAiAction = 'draft' | 'reply'

async function postTicketAiAction<T>(ticketId: number, action: TicketAiAction, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(buildApiUrl(`/tickets/${ticketId}/ai/${action}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {})
    },
    body: JSON.stringify(body)
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || response.statusText) as Error & { code?: string }
    error.code = payload?.code
    throw error
  }

  return payload as T
}

async function requestAiDraft(ticketId: number): Promise<TicketAiDraftResponse> {
  return postTicketAiAction<TicketAiDraftResponse>(ticketId, 'draft')
}

async function requestAiReply(ticketId: number, reviewedBody: string): Promise<TicketAiReplyResponse> {
  return postTicketAiAction<TicketAiReplyResponse>(ticketId, 'reply', { reviewedBody })
}

const hostEmptyState = computed(() => {
  if (activeTab.value !== 'host') {
    return {
      title: t('tickets.noTickets'),
      hint: t('tickets.noTicketsHint')
    }
  }

  if (!authStore.isAdmin) {
    return {
      title: t('tickets.noHostTickets'),
      hint: t('tickets.noHostTicketsHint')
    }
  }

  switch (hostTicketSourceFilter.value) {
    case 'user':
      return {
        title: t('tickets.noUserTickets'),
        hint: t('tickets.noUserTicketsHint')
      }
    case 'official':
      return {
        title: t('tickets.noOfficialTickets'),
        hint: t('tickets.noOfficialTicketsHint')
      }
    case 'hosted':
      return {
        title: t('tickets.noHostedTickets'),
        hint: t('tickets.noHostedTicketsHint')
      }
    default:
      return {
        title: t('tickets.noHostTickets'),
        hint: t('tickets.noHostTicketsHint')
      }
  }
})

const routeStateReady = ref(false)

function getDefaultTab(): TabType {
  return authStore.isAdmin ? 'host' : 'my'
}

function normalizeTab(tab: unknown): TabType {
  return tab === 'host' && isHostOwner.value ? 'host' : 'my'
}

function buildTicketsQuery(options: {
  tab?: TabType
  ticketId?: number | null
  compose?: boolean
}) {
  const query: Record<string, string> = {}
  const targetTab = options.tab ?? activeTab.value

  if (targetTab !== getDefaultTab()) {
    query.tab = targetTab
  }

  if (options.ticketId) {
    query.ticket = String(options.ticketId)
  }

  if (options.compose) {
    query.compose = '1'
  }

  return query
}

function resetDetailState() {
  selectedTicket.value = null
  messages.value = []
  replyContent.value = ''
  replyAttachments.value = []
  messagesPage.value = 1
  messagesTotal.value = 0
  isOwner.value = false
  isCreator.value = false
  supportContext.value = null
  supportContextLoading.value = false
  internalNoteContent.value = ''
  notifyContent.value = ''
  aiDraftLoading.value = false
  aiReplyLoading.value = false
  linkForm.value = {
    objectType: 'instance',
    objectId: ''
  }
  lightboxOpen.value = false
  revokeAttachmentUrls()
}

function resetCreateForm() {
  createForm.value = {
    instanceId: null,
    subject: '',
    category: 'general',
    priority: 'normal',
    content: ''
  }
  createAttachments.value = []
}

async function navigateToList(replace = false): Promise<void> {
  const location = {
    path: ticketsPath(),
    query: buildTicketsQuery({ tab: activeTab.value })
  }

  if (replace) {
    await router.replace(location)
  } else {
    await router.push(location)
  }
}

async function openTicketDetail(ticketId: number): Promise<void> {
  viewMode.value = 'detail'
  messagesLoading.value = true
  supportContext.value = null
  messagesPage.value = 1
  revokeAttachmentUrls()
  messages.value = []
  selectedTicket.value = selectedTicket.value?.id === ticketId ? selectedTicket.value : ({ id: ticketId } as Ticket)

  try {
    const [detailRes, messagesRes] = await Promise.all([
      api.tickets.get(ticketId),
      api.tickets.getMessages(ticketId, { page: 1, pageSize: messagesPageSize.value })
    ])
    selectedTicket.value = detailRes.ticket
    isOwner.value = detailRes.isOwner
    isCreator.value = detailRes.isCreator
    messages.value = messagesRes.messages
    messagesTotal.value = messagesRes.total
    await ensureMessageAttachmentUrls(messagesRes.messages)
    if (authStore.isAdmin) {
      await loadSupportContext(ticketId)
    }
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
    await navigateToList(true)
  } finally {
    messagesLoading.value = false
  }
}

async function loadSupportContext(ticketId = selectedTicket.value?.id): Promise<void> {
  if (!authStore.isAdmin || !ticketId) return
  supportContextLoading.value = true
  try {
    supportContext.value = await api.tickets.getSupportContext(ticketId)
    selectedTicket.value = supportContext.value.ticket
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    supportContextLoading.value = false
  }
}

async function generateAiDraft(): Promise<void> {
  if (!authStore.isAdmin || !selectedTicket.value) return
  aiDraftLoading.value = true
  try {
    const result = await requestAiDraft(selectedTicket.value.id)
    replyContent.value = result.draft
    toast.success(t('tickets.support.aiDraftReady'))
    await nextTick()
    const textarea = document.getElementById('ticket-reply-textarea')
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.focus()
    }
  } catch (error: any) {
    const code = error?.code
    if (code === 'AI_TICKET_PLUGIN_DISABLED') {
      toast.error(t('tickets.support.aiPluginDisabled'))
    } else if (code === 'AI_TICKET_AGENT_MODEL_NOT_CONFIGURED') {
      toast.error(t('tickets.support.aiModelNotConfigured'))
    } else if (code === 'AI_TICKET_DRAFT_BLOCKED') {
      toast.error(t('tickets.support.aiDraftBlocked'))
    } else {
      toast.error(error?.message || t('common.error'))
    }
  } finally {
    aiDraftLoading.value = false
  }
}

async function sendAiReply(): Promise<void> {
  if (!authStore.isAdmin || !selectedTicket.value || aiReplyLoading.value) return
  const reviewedBody = replyContent.value.trim()
  if (!reviewedBody) return
  if (!window.confirm(t('tickets.support.aiReplyConfirm'))) return

  aiReplyLoading.value = true
  try {
    const result = await requestAiReply(selectedTicket.value.id, reviewedBody)
    messages.value.push(result.data)
    messagesTotal.value++
    await ensureMessageAttachmentUrls([result.data])
    replyContent.value = ''
    toast.success(t('tickets.support.aiReplySent'))
    await loadSupportContext()
    await nextTick()
    const container = document.getElementById('messages-container')
    if (container) container.scrollTop = container.scrollHeight
  } catch (error: any) {
    const code = error?.code
    if (code === 'AI_TICKET_PLUGIN_DISABLED' || code === 'AI_TICKET_PLUGIN_PERMISSION_MISSING') {
      toast.error(t('tickets.support.aiPluginDisabled'))
    } else if (code === 'AI_TICKET_AGENT_MODEL_NOT_CONFIGURED') {
      toast.error(t('tickets.support.aiModelNotConfigured'))
    } else if (code === 'AI_TICKET_AGENT_REPLY_MODE_DISABLED') {
      toast.error(t('tickets.support.aiReplyModeDisabled'))
    } else if (code === 'AI_TICKET_REPLY_HANDOFF_REQUIRED') {
      toast.error(t('tickets.support.aiReplyHandoffRequired'))
    } else if (code === 'AI_TICKET_REPLY_BLOCKED') {
      toast.error(t('tickets.support.aiReplyBlocked'))
    } else {
      toast.error(error?.message || t('common.error'))
    }
  } finally {
    aiReplyLoading.value = false
  }
}

async function openCreateView(): Promise<void> {
  viewMode.value = 'create'
  resetCreateForm()
  if (availableInstances.value.length === 0) {
    await loadAvailableInstances()
  }
}

async function syncViewFromRoute(): Promise<void> {
  const targetTab = normalizeTab(route.query.tab ?? getDefaultTab())
  if (activeTab.value !== targetTab) {
    activeTab.value = targetTab
    await loadTickets(true)
  }

  const ticketIdParam = route.query.ticket
  const compose = route.query.compose === '1'
  const ticketId = typeof ticketIdParam === 'string' ? Number(ticketIdParam) : NaN

  if (Number.isInteger(ticketId) && ticketId > 0) {
    if (viewMode.value !== 'detail' || selectedTicket.value?.id !== ticketId) {
      await openTicketDetail(ticketId)
    }
    return
  }

  if (compose && !authStore.isAdmin) {
    if (viewMode.value !== 'create') {
      await openCreateView()
    }
    return
  }

  if (viewMode.value !== 'list') {
    viewMode.value = 'list'
    resetDetailState()
  }
}

// 管理员默认显示"收到的工单"标签，拥有节点的普通用户也显示但默认显示"我的工单"
onMounted(async () => {
  await loadPendingCount()
  activeTab.value = normalizeTab(route.query.tab ?? getDefaultTab())
  await loadTickets()
  routeStateReady.value = true
  await syncViewFromRoute()
})

watch(
  () => [route.query.tab, route.query.ticket, route.query.compose],
  async () => {
    if (!routeStateReady.value) return
    await syncViewFromRoute()
  }
)

async function loadTickets(silent = false) {
  if (!silent) loading.value = true
  else refreshing.value = true
  
  try {
    const params: Record<string, unknown> = {
      page: page.value,
      pageSize: pageSize.value
    }
    
    // 状态筛选：'active' 传递给后端处理，'all' 不传 status
    if (statusFilter.value === 'active') {
      params.status = 'active'
    } else if (statusFilter.value !== 'all') {
      params.status = statusFilter.value
    }
    
    // 搜索
    if (searchQuery.value.trim()) {
      params.search = searchQuery.value.trim()
    }
    
    if (hostFilter.value) params.hostId = hostFilter.value
    if (activeTab.value === 'host' && authStore.isAdmin && hostTicketSourceFilter.value !== 'all') {
      params.sourceType = hostTicketSourceFilter.value
    }
    if (activeTab.value === 'host' && authStore.isAdmin && queueFilter.value !== 'all') {
      params.queue = queueFilter.value
    }
    
    let response
    if (activeTab.value === 'my') {
      response = await api.tickets.list(params as { status?: TicketStatus | 'active'; search?: string; page?: number; pageSize?: number })
    } else {
      response = await api.tickets.getMyHostTickets(params as { status?: TicketStatus | 'active'; hostId?: number; search?: string; page?: number; pageSize?: number })
    }
    
    tickets.value = response.tickets
    total.value = response.total
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

// 搜索防抖处理
function handleSearchInput() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
  }
  searchDebounceTimer = setTimeout(() => {
    page.value = 1
    loadTickets(true)
  }, 300)
}

// 分页大小变更
function handlePageSizeChange(newSize: number) {
  pageSize.value = newSize
  page.value = 1
  loadTickets(true)
}

async function loadPendingCount() {
  try {
    pendingCount.value = await api.tickets.getPendingCount()
  } catch (error) {
    console.error('Failed to load pending count:', error)
  }
}

async function switchTab(tab: TabType) {
  page.value = 1
  statusFilter.value = 'active'
  hostFilter.value = ''
  hostTicketSourceFilter.value = 'all'
  queueFilter.value = 'all'
  searchQuery.value = ''
  await router.replace({
    path: ticketsPath(),
    query: buildTicketsQuery({ tab })
  })
}

function handlePageChange(newPage: number) {
  page.value = newPage
  loadTickets(true)
}

watch([statusFilter, hostFilter, hostTicketSourceFilter, queueFilter], () => {
  page.value = 1
  loadTickets(true)
})

watch(hostTicketSourceFilter, (value) => {
  if (value === 'user' && hostFilter.value) {
    hostFilter.value = ''
  }
})

// Detail view
async function viewTicket(ticket: Ticket) {
  await router.push({
    path: ticketsPath(),
    query: buildTicketsQuery({ tab: activeTab.value, ticketId: ticket.id })
  })
}

// Load more messages
async function loadMoreMessages() {
  if (!selectedTicket.value || messagesLoadingMore.value) return
  if (messagesPage.value >= messagesTotalPages.value) return
  
  messagesLoadingMore.value = true
  try {
    messagesPage.value++
    const res = await api.tickets.getMessages(selectedTicket.value.id, {
      page: messagesPage.value,
      pageSize: messagesPageSize.value
    })
    messages.value.push(...res.messages)
    await ensureMessageAttachmentUrls(res.messages)
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
    messagesPage.value--
  } finally {
    messagesLoadingMore.value = false
  }
}

async function backToList() {
  await navigateToList()
}

// Reply
async function handleReply() {
  if (!selectedTicket.value) return
  if (!replyContent.value.trim() && replyAttachments.value.length === 0) return
  
  replying.value = true
  try {
    const res = await api.tickets.reply(selectedTicket.value.id, replyContent.value.trim(), replyAttachments.value)
    messages.value.push(res.data)
    messagesTotal.value++
    await ensureMessageAttachmentUrls([res.data])
    replyContent.value = ''
    replyAttachments.value = []
    toast.success(t('tickets.replySuccess'))
    if (authStore.isAdmin) {
      await loadSupportContext()
    }
    // Scroll to bottom
    await nextTick()
    const container = document.getElementById('messages-container')
    if (container) container.scrollTop = container.scrollHeight
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    replying.value = false
  }
}

// Status update
async function updateStatus(status: TicketStatus) {
  if (!selectedTicket.value) return
  
  try {
    await api.tickets.updateStatus(selectedTicket.value.id, status)
    selectedTicket.value.status = status
    toast.success(t('tickets.statusUpdated'))
    loadPendingCount()
    loadTickets(true)
    if (authStore.isAdmin) {
      await loadSupportContext()
    }
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  }
}

// Close ticket
async function closeTicket() {
  if (!selectedTicket.value) return
  if (!confirm(t('tickets.confirmCloseHint'))) return
  
  try {
    await api.tickets.close(selectedTicket.value.id)
    selectedTicket.value.status = 'closed'
    toast.success(t('tickets.closeSuccess'))
    loadPendingCount()
    loadTickets(true)
    if (authStore.isAdmin) {
      await loadSupportContext()
    }
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  }
}

// Reopen own closed ticket
async function reopenTicket() {
  if (!selectedTicket.value || !isCreator.value || selectedTicket.value.status !== 'closed') return

  try {
    await api.tickets.updateStatus(selectedTicket.value.id, 'open')
    selectedTicket.value.status = 'open'
    toast.success(t('tickets.reopenSuccess'))
    loadPendingCount()
    loadTickets(true)
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  }
}

// Delete message (仅管理员)
async function confirmDeleteMessage(message: TicketMessage) {
  if (!selectedTicket.value) return
  if (!confirm(t('tickets.confirmDeleteMessage'))) return
  
  try {
    await api.tickets.deleteMessage(selectedTicket.value.id, message.id)
    // 从列表中移除已删除的消息
    messages.value = messages.value.filter(m => m.id !== message.id)
    messagesTotal.value--
    toast.success(t('tickets.deleteMessageSuccess'))
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  }
}

async function submitInternalNote() {
  if (!selectedTicket.value || !internalNoteContent.value.trim()) return
  internalNoteSubmitting.value = true
  try {
    await api.tickets.createInternalNote(selectedTicket.value.id, internalNoteContent.value.trim())
    internalNoteContent.value = ''
    toast.success(t('tickets.support.noteSaved'))
    await loadSupportContext()
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    internalNoteSubmitting.value = false
  }
}

async function submitNotifyUser() {
  if (!selectedTicket.value || !notifyContent.value.trim()) return
  notifySubmitting.value = true
  try {
    await api.tickets.notifyUser(selectedTicket.value.id, notifyContent.value.trim())
    notifyContent.value = ''
    toast.success(t('tickets.support.noticeSent'))
    await loadSupportContext()
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    notifySubmitting.value = false
  }
}

async function submitLinkObject() {
  if (!selectedTicket.value) return
  const objectId = Number(linkForm.value.objectId)
  if (!Number.isInteger(objectId) || objectId <= 0) {
    toast.error(t('tickets.support.invalidObjectId'))
    return
  }
  linkSubmitting.value = true
  try {
    await api.tickets.linkObject(selectedTicket.value.id, linkForm.value.objectType, objectId)
    linkForm.value.objectId = ''
    toast.success(t('tickets.support.linkSaved'))
    await loadSupportContext()
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    linkSubmitting.value = false
  }
}

function openAdminPath(path: string | null) {
  if (!path) return
  router.push(path)
}

function displayValue(item: Record<string, unknown>, key: string, fallback = '-'): string {
  const value = item[key]
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function displayDateValue(item: Record<string, unknown>, key: string): string {
  const value = item[key]
  return typeof value === 'string' && value ? formatDateShort(value) : '-'
}

// Create ticket
function openCreateForm() {
  if (!configStore.ticketEnabled) return
  router.push({
    path: ticketsPath(),
    query: buildTicketsQuery({ tab: activeTab.value, compose: true })
  })
}

async function loadAvailableInstances() {
  instancesLoading.value = true
  try {
    const response = await api.instances.list({ pageSize: 100 }) as unknown as { instances: InstanceWithDetails[] }
    availableInstances.value = response.instances || []
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    instancesLoading.value = false
  }
}

async function submitCreate() {
  if (!configStore.ticketEnabled) return
  if (createForm.value.subject.trim().length < 2) {
    toast.error(t('tickets.subject') + ' ' + t('common.error'))
    return
  }
  if (createAttachments.value.length === 0 && createForm.value.content.trim().length < 10) {
    toast.error(t('tickets.contentTooShort'))
    return
  }
  
  creating.value = true
  try {
    const res = await api.tickets.create({
      instanceId: createForm.value.instanceId || undefined,
      subject: createForm.value.subject.trim(),
      category: createForm.value.category,
      priority: createForm.value.priority,
      content: createForm.value.content.trim(),
      attachments: createAttachments.value
    })
    toast.success(t('tickets.createSuccess'))
    activeTab.value = 'my'
    await Promise.all([loadTickets(), loadPendingCount()])
    await router.replace({
      path: ticketsPath(),
      query: buildTicketsQuery({ tab: 'my', ticketId: res.ticket.id })
    })
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
  } finally {
    creating.value = false
  }
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleString()
}

function formatDateShort(dateString: string) {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  
  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (days < 7) {
    return t('inbox.daysAgo', { n: days })
  } else {
    return date.toLocaleDateString()
  }
}
</script>

<template>
  <div ref="revealRoot" class="kawaii-page min-h-screen animate-fade-in">
    <div class="space-y-6 py-6">
      <!-- Header -->
      <div data-reveal class="page-header">
        <div class="flex min-w-0 items-center gap-3">
          <button v-if="viewMode !== 'list'" class="btn btn-secondary btn-sm shrink-0" @click="backToList">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div class="min-w-0">
            <h1 class="page-title">
              {{ viewMode === 'detail' ? t('tickets.ticketDetails') : viewMode === 'create' ? t('tickets.newTicket') : t('tickets.title') }}
            </h1>
            <p class="page-description">{{ t('tickets.subtitle') }}</p>
          </div>
        </div>
        
        <!-- 管理员不显示"创建工单"按钮 -->
        <button v-if="viewMode === 'list' && !authStore.isAdmin && configStore.ticketEnabled" class="btn btn-primary shrink-0" @click="openCreateForm">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('tickets.createTicket') }}
        </button>
      </div>

      <ThemeTemplateSlot slot-name="user.tickets.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />
      
      <!-- List View -->
      <template v-if="viewMode === 'list'">
        <!-- Tabs -->
        <div data-reveal class="mb-6 flex items-center gap-6 overflow-x-auto border-b border-themed">
          <!-- 普通用户显示"我的工单"标签，管理员不显示 -->
          <button
            v-if="!authStore.isAdmin"
            class="relative -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition-colors"
            :class="activeTab === 'my' ? 'border-primary-500 text-themed' : 'border-transparent text-themed-muted hover:text-themed'"
            @click="switchTab('my')"
          >
            {{ t('tickets.myTickets') }}
            <span v-if="pendingCount.userTickets > 0" class="count-badge has-count">{{ pendingCount.userTickets }}</span>
          </button>
          <button
            v-if="isHostOwner"
            class="relative -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition-colors"
            :class="activeTab === 'host' ? 'border-primary-500 text-themed' : 'border-transparent text-themed-muted hover:text-themed'"
            @click="switchTab('host')"
          >
            {{ t('tickets.hostTickets') }}
            <span v-if="pendingCount.hostTickets > 0" class="count-badge">{{ pendingCount.hostTickets }}</span>
          </button>
        </div>
        
        <!-- Filters & Search Row -->
        <div data-reveal class="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-4 mb-4">
          <!-- Status Filter - 分段按钮组 -->
          <div class="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 flex-shrink-0">
            <div class="inline-flex items-center gap-1 p-1 bg-themed-secondary rounded-lg">
              <button
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap',
                  statusFilter === 'active'
                    ? 'bg-themed-surface text-themed shadow-sm'
                    : 'text-themed-muted hover:text-themed'
                ]"
                @click="statusFilter = 'active'"
              >
                {{ t('tickets.activeStatus') }}
              </button>
              <button
                v-for="status in statuses"
                :key="status"
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap',
                  statusFilter === status
                    ? 'bg-themed-surface text-themed shadow-sm'
                    : 'text-themed-muted hover:text-themed'
                ]"
                @click="statusFilter = status"
              >
                {{ t(`tickets.status.${status}`) }}
              </button>
              <button
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap',
                  statusFilter === 'all'
                    ? 'bg-themed-surface text-themed shadow-sm'
                    : 'text-themed-muted hover:text-themed'
                ]"
                @click="statusFilter = 'all'"
              >
                {{ t('tickets.allStatus') }}
              </button>
            </div>
          </div>

          <div v-if="activeTab === 'host' && authStore.isAdmin" class="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 flex-shrink-0">
            <div class="inline-flex items-center gap-1 p-1 bg-themed-secondary rounded-lg">
              <button
                v-for="sourceType in ['all', 'user', 'official', 'hosted']"
                :key="sourceType"
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap',
                  hostTicketSourceFilter === sourceType
                    ? 'bg-themed-surface text-themed shadow-sm'
                    : 'text-themed-muted hover:text-themed'
                ]"
                @click="hostTicketSourceFilter = sourceType as HostTicketSourceType"
              >
                {{ t(`tickets.sourceFilter.${sourceType}`) }}
              </button>
            </div>
          </div>

          <div v-if="activeTab === 'host' && authStore.isAdmin" class="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 flex-shrink-0">
            <div class="inline-flex items-center gap-1 p-1 bg-themed-secondary rounded-lg">
              <button
                v-for="queue in ['all', 'pending', 'due_soon', 'overdue', 'waiting_user', 'waiting_internal']"
                :key="queue"
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap',
                  queueFilter === queue
                    ? 'bg-themed-surface text-themed shadow-sm'
                    : 'text-themed-muted hover:text-themed'
                ]"
                @click="queueFilter = queue as TicketQueueFilter"
              >
                {{ t(`tickets.support.queue.${queue}`) }}
              </button>
            </div>
          </div>
          
          <!-- Search Box -->
          <div class="flex-1 max-w-xs">
            <div class="relative">
              <svg class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="t('tickets.searchPlaceholder')"
                class="input pl-10 pr-9"
                @input="handleSearchInput"
              />
              <button
                v-if="searchQuery"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-themed-muted hover:text-themed"
                @click="searchQuery = ''; handleSearchInput()"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        
        <!-- Loading -->
        <template v-if="loading">
          <SkeletonLoader type="list" :count="5" />
        </template>
        
        <!-- Empty State -->
        <template v-else-if="tickets.length === 0">
          <div class="text-center py-16">
            <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-themed-secondary">
              <svg class="h-7 w-7 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 class="text-lg font-medium text-themed mb-2">
              {{ activeTab === 'my' ? t('tickets.noTickets') : hostEmptyState.title }}
            </h3>
            <p class="text-themed-muted">
              {{ activeTab === 'my' ? t('tickets.noTicketsHint') : hostEmptyState.hint }}
            </p>
          </div>
        </template>
        
        <!-- Ticket List -->
        <template v-else>
          <div class="space-y-3">
            <div v-for="ticket in tickets" :key="ticket.id" class="card-interactive p-4 cursor-pointer" :class="ticket.needsReply ? 'ticket-needs-reply' : ''" @click="viewTicket(ticket)">
              <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                <!-- User avatar (for host tab) -->
                <UserAvatar
                  v-if="activeTab === 'host' && ticket.user"
                  :username="ticket.user.username"
                  :avatar-style="ticket.user.avatarStyle"
                  :badge-id="ticket.user.avatarBadgeId || null"
                  :size="32"
                  class="shrink-0"
                />
                
                <!-- Content -->
                <div class="flex-1 min-w-0">
                  <div class="flex flex-wrap items-center gap-2 mb-1">
                    <!-- 需要回复标记 -->
                    <span v-if="ticket.needsReply" class="nimbus-pill bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                      {{ t('tickets.needsReply') }}
                    </span>
                    <span class="nimbus-pill font-mono" :class="statusColors[ticket.status]">
                      <span class="nimbus-dot"></span>{{ t(`tickets.status.${ticket.status}`) }}
                    </span>
                    <span class="nimbus-pill font-mono" :class="priorityColors[ticket.priority]">
                      <span class="nimbus-dot"></span>{{ t(`tickets.priority.${ticket.priority}`) }}
                    </span>
                    <span v-if="authStore.isAdmin && ticket.slaStatus" class="nimbus-pill font-mono" :class="slaStatusColors[ticket.slaStatus]">
                      <span class="nimbus-dot"></span>{{ t(`tickets.support.slaStatus.${ticket.slaStatus}`) }}
                    </span>
                    <span class="text-xs text-themed-muted font-mono">
                      #{{ ticket.id }}
                    </span>
                  </div>
                  <h3 class="font-medium text-themed truncate">
                    {{ ticket.subject }}
                  </h3>
                  <div class="flex flex-wrap items-center gap-2 mt-1 text-sm text-themed-muted">
                    <span v-if="activeTab === 'host' && ticket.user">
                      {{ t('tickets.from') }}: {{ ticket.user.username }}
                    </span>
                    <span v-if="ticket.host">
                      {{ ticket.host.name }}
                    </span>
                    <span v-if="ticket.instance" class="inline-flex items-center gap-1.5 text-xs bg-themed-secondary text-themed-muted px-2 py-0.5 rounded">
                      <InstanceDisplayIcon
                        v-if="ticket.instance.iconBadgeId"
                        :badge-id="ticket.instance.iconBadgeId"
                        :alt="ticket.instance.name"
                        :size="18"
                      />
                      {{ ticket.instance.name }}
                    </span>
                  </div>
                </div>
                
                <!-- Meta -->
                <div class="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-1 text-sm text-themed-muted">
                  <span class="font-mono">{{ formatDateShort(ticket.createdAt) }}</span>
                  <span v-if="ticket.messageCount" class="flex items-center gap-1 font-mono">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    {{ ticket.messageCount }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Pagination -->
          <div class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6">
            <!-- Page Size Selector -->
            <div class="flex items-center gap-2 text-sm text-themed-muted">
              <span>{{ t('tickets.perPage') }}</span>
              <select
                :value="pageSize"
                class="input w-auto py-1"
                @change="handlePageSizeChange(Number(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="size in pageSizeOptions" :key="size" :value="size">
                  {{ size }}
                </option>
              </select>
              <span>{{ t('tickets.totalCount', { count: total }) }}</span>
            </div>
            
            <!-- Page Navigation -->
            <nav v-if="totalPages > 1" class="flex items-center gap-1">
              <button :disabled="page === 1" class="btn btn-secondary btn-sm" @click="handlePageChange(page - 1)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span class="px-4 py-2 text-sm text-themed-muted font-mono">
                {{ page }} / {{ totalPages }}
              </span>
              <button :disabled="page === totalPages" class="btn btn-secondary btn-sm" @click="handlePageChange(page + 1)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </nav>
          </div>
        </template>
      </template>
      
      <!-- Detail View -->
      <template v-else-if="viewMode === 'detail' && selectedTicket">
        <div class="card overflow-hidden">
          <!-- Header -->
          <div class="p-4 sm:p-6 border-b border-themed">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="nimbus-pill font-mono" :class="statusColors[selectedTicket.status]">
                <span class="nimbus-dot"></span>{{ t(`tickets.status.${selectedTicket.status}`) }}
              </span>
              <span class="nimbus-pill font-mono" :class="priorityColors[selectedTicket.priority]">
                <span class="nimbus-dot"></span>{{ t(`tickets.priority.${selectedTicket.priority}`) }}
              </span>
              <span class="nimbus-pill font-mono bg-themed-secondary text-themed-muted">
                <span class="nimbus-dot"></span>{{ t(`tickets.category.${selectedTicket.category}`) }}
              </span>
              <span v-if="authStore.isAdmin && selectedTicket.slaStatus" class="nimbus-pill font-mono" :class="slaStatusColors[selectedTicket.slaStatus]">
                <span class="nimbus-dot"></span>{{ t(`tickets.support.slaStatus.${selectedTicket.slaStatus}`) }}
              </span>
            </div>
            <div class="flex items-center gap-3 mb-3">
              <h2 class="text-xl font-semibold text-themed">
                {{ selectedTicket.subject }}
              </h2>
              <span class="text-sm text-themed-muted font-mono">#{{ selectedTicket.id }}</span>
            </div>
            <div class="flex flex-wrap gap-4 text-sm text-themed-muted">
              <span v-if="selectedTicket.user" class="inline-flex items-center gap-2">
                <span>{{ t('tickets.from') }}:</span>
                <UserAvatar
                  :username="selectedTicket.user.username"
                  :avatar-style="selectedTicket.user.avatarStyle"
                  :badge-id="selectedTicket.user.avatarBadgeId || null"
                  :size="24"
                />
                <span class="text-themed">{{ selectedTicket.user.username }}</span>
              </span>
              <span v-if="selectedTicket.host">
                {{ t('tickets.host') }}: <span class="text-themed">{{ selectedTicket.host.name }}</span>
              </span>
              <span v-if="selectedTicket.instance" class="inline-flex items-center gap-2">
                <span>{{ t('tickets.instance') }}:</span>
                <InstanceDisplayIcon
                  v-if="selectedTicket.instance.iconBadgeId"
                  :badge-id="selectedTicket.instance.iconBadgeId"
                  :alt="selectedTicket.instance.name"
                  :size="24"
                />
                <span class="text-themed">{{ selectedTicket.instance.name }}</span>
              </span>
              <span>
                {{ t('tickets.createdAt') }}: <span class="font-mono">{{ formatDate(selectedTicket.createdAt) }}</span>
              </span>
              <span v-if="authStore.isAdmin && selectedTicket.firstResponseDueAt">
                {{ t('tickets.support.firstResponseDue') }}: <span class="font-mono">{{ formatDate(selectedTicket.firstResponseDueAt) }}</span>
              </span>
              <span v-if="authStore.isAdmin && selectedTicket.resolutionDueAt">
                {{ t('tickets.support.resolutionDue') }}: <span class="font-mono">{{ formatDate(selectedTicket.resolutionDueAt) }}</span>
              </span>
            </div>
            
            <TicketInstanceOwnerCard
              v-if="isOwner && selectedTicket.instance"
              :instance-summary="selectedTicket.instance"
            />
            
            <!-- Owner Actions -->
            <div v-if="isOwner && selectedTicket.status !== 'closed'" class="flex flex-wrap gap-2 mt-4">
              <button v-if="selectedTicket.status === 'open'" class="btn btn-secondary btn-sm" @click="updateStatus('in_progress')">
                {{ t('tickets.markInProgress') }}
              </button>
              <button v-if="selectedTicket.status !== 'resolved'" class="btn btn-secondary btn-sm" @click="updateStatus('resolved')">
                {{ t('tickets.markResolved') }}
              </button>
              <button class="btn btn-secondary btn-sm" @click="closeTicket">
                {{ t('tickets.close') }}
              </button>
            </div>
            <div v-else-if="isCreator && selectedTicket.status !== 'closed'" class="mt-4">
              <button class="btn btn-secondary btn-sm" @click="closeTicket">
                {{ t('tickets.close') }}
              </button>
            </div>
            <div v-else-if="isCreator && selectedTicket.status === 'closed'" class="mt-4">
              <button class="btn btn-secondary btn-sm" @click="reopenTicket">
                {{ t('tickets.reopen') }}
              </button>
            </div>
          </div>

          <div v-if="authStore.isAdmin" class="p-4 sm:p-6 border-b border-themed bg-themed-secondary">
            <div v-if="supportContextLoading" class="py-4">
              <SkeletonLoader type="list" :count="2" />
            </div>
            <div v-else-if="supportContext" class="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <section class="card p-4">
                <div class="flex items-center justify-between gap-3 mb-3">
                  <h3 class="font-semibold text-themed">{{ t('tickets.support.userContext') }}</h3>
                  <button class="text-sm text-primary-500 hover:underline" @click="openAdminPath(supportContext.quickActions.userPath)">
                    {{ t('tickets.support.openUser') }}
                  </button>
                </div>
                <div v-if="supportContext.userContext" class="grid gap-3 sm:grid-cols-2 text-sm">
                  <div>
                    <p class="text-themed-muted">{{ t('tickets.support.account') }}</p>
                    <p class="font-medium text-themed">{{ supportContext.userContext.username }} · {{ supportContext.userContext.status }}</p>
                    <p class="text-themed-muted">{{ supportContext.userContext.emailMasked || '-' }}</p>
                  </div>
                  <div>
                    <p class="text-themed-muted">{{ t('tickets.support.balance') }}</p>
                    <p class="font-medium text-themed font-mono">¥{{ supportContext.userContext.balance || '0.00' }}</p>
                    <p class="text-themed-muted">{{ t('tickets.support.registeredAt') }} <span class="font-mono">{{ formatDateShort(supportContext.userContext.createdAt) }}</span></p>
                  </div>
                  <div class="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div class="rounded-lg bg-themed-secondary p-2">
                      <p class="text-xs text-themed-muted">{{ t('tickets.support.instances') }}</p>
                      <p class="font-semibold font-mono text-themed">{{ supportContext.userContext.counts.instances }}</p>
                    </div>
                    <div class="rounded-lg bg-themed-secondary p-2">
                      <p class="text-xs text-themed-muted">{{ t('tickets.support.tickets') }}</p>
                      <p class="font-semibold font-mono text-themed">{{ supportContext.userContext.counts.ticketsCreated }}</p>
                    </div>
                    <div class="rounded-lg bg-themed-secondary p-2">
                      <p class="text-xs text-themed-muted">{{ t('tickets.support.orders') }}</p>
                      <p class="font-semibold font-mono text-themed">{{ supportContext.userContext.counts.rechargeRecords }}</p>
                    </div>
                    <div class="rounded-lg bg-themed-secondary p-2">
                      <p class="text-xs text-themed-muted">{{ t('tickets.support.ledger') }}</p>
                      <p class="font-semibold font-mono text-themed">{{ supportContext.userContext.counts.balanceLogs }}</p>
                    </div>
                  </div>
                </div>
                <div class="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <h4 class="text-sm font-medium text-themed mb-2">{{ t('tickets.support.recentOrders') }}</h4>
                    <div class="space-y-2">
                      <div v-for="order in supportContext.recentOrders" :key="displayValue(order, 'id')" class="rounded-lg border border-themed p-2 text-sm">
                        <div class="flex justify-between gap-2">
                          <span class="font-medium text-themed font-mono">{{ displayValue(order, 'orderNo') }}</span>
                          <span class="text-themed-muted">{{ displayValue(order, 'status') }}</span>
                        </div>
                        <p class="text-themed-muted"><span class="font-mono">¥{{ displayValue(order, 'amount') }}</span> · <span class="font-mono">{{ displayDateValue(order, 'createdAt') }}</span></p>
                      </div>
                      <p v-if="supportContext.recentOrders.length === 0" class="text-sm text-themed-muted">{{ t('common.noData') }}</p>
                    </div>
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-themed mb-2">{{ t('tickets.support.recentInstances') }}</h4>
                    <div class="space-y-2">
                      <div v-for="instance in supportContext.recentInstances" :key="displayValue(instance, 'id')" class="rounded-lg border border-themed p-2 text-sm">
                        <div class="flex justify-between gap-2">
                          <span class="font-medium text-themed">{{ displayValue(instance, 'name') }}</span>
                          <span class="text-themed-muted">{{ displayValue(instance, 'status') }}</span>
                        </div>
                        <p class="text-themed-muted"><span class="font-mono">#{{ displayValue(instance, 'id') }}</span> · <span class="font-mono">{{ displayDateValue(instance, 'createdAt') }}</span></p>
                      </div>
                      <p v-if="supportContext.recentInstances.length === 0" class="text-sm text-themed-muted">{{ t('common.noData') }}</p>
                    </div>
                  </div>
                </div>
              </section>

              <section class="space-y-4">
                <div class="card p-4">
                  <h3 class="font-semibold text-themed mb-3">{{ t('tickets.support.quickActions') }}</h3>
                  <div class="grid grid-cols-2 gap-2">
                    <button class="btn btn-secondary btn-sm" :disabled="aiDraftLoading || aiReplyLoading || !selectedTicket" @click="generateAiDraft">
                      {{ aiDraftLoading ? t('tickets.support.aiDraftGenerating') : t('tickets.support.generateAiDraft') }}
                    </button>
                    <button class="btn btn-secondary btn-sm" :disabled="aiDraftLoading || aiReplyLoading || !selectedTicket || !replyContent.trim()" @click="sendAiReply">
                      {{ aiReplyLoading ? t('tickets.support.aiReplySending') : t('tickets.support.sendAiReply') }}
                    </button>
                    <button class="btn btn-secondary btn-sm" @click="openAdminPath(supportContext.quickActions.balanceAdjustmentPath)">
                      {{ t('tickets.support.adjustment') }}
                    </button>
                    <button class="btn btn-secondary btn-sm" @click="openAdminPath(supportContext.quickActions.deliveryCenterPath)">
                      {{ t('tickets.support.delivery') }}
                    </button>
                    <button :disabled="!supportContext.quickActions.instancePath" class="btn btn-secondary btn-sm" @click="openAdminPath(supportContext.quickActions.instancePath)">
                      {{ t('tickets.support.openInstance') }}
                    </button>
                    <button :disabled="!supportContext.quickActions.hostPath" class="btn btn-secondary btn-sm" @click="openAdminPath(supportContext.quickActions.hostPath)">
                      {{ t('tickets.support.openHost') }}
                    </button>
                  </div>
                  <div class="mt-3 space-y-2">
                    <textarea v-model="notifyContent" rows="2" :placeholder="t('tickets.support.notifyPlaceholder')" class="input resize-none" />
                    <button :disabled="notifySubmitting || !notifyContent.trim()" class="btn btn-primary btn-sm w-full" @click="submitNotifyUser">
                      {{ notifySubmitting ? t('common.sending') : t('tickets.support.sendNotice') }}
                    </button>
                  </div>
                </div>

                <div class="card p-4">
                  <h3 class="font-semibold text-themed mb-3">{{ t('tickets.support.linkedObjects') }}</h3>
                  <div class="flex gap-2">
                    <select v-model="linkForm.objectType" class="input w-40">
                      <option v-for="type in ticketLinkTypes" :key="type" :value="type">{{ t(`tickets.support.linkType.${type}`) }}</option>
                    </select>
                    <input v-model="linkForm.objectId" type="number" min="1" class="input flex-1" :placeholder="t('tickets.support.objectId')" />
                    <button :disabled="linkSubmitting" class="btn btn-primary btn-sm" @click="submitLinkObject">
                      {{ t('tickets.support.addLink') }}
                    </button>
                  </div>
                  <div class="mt-3 space-y-2">
                    <div v-for="link in supportContext.links" :key="link.id" class="rounded-lg bg-themed-secondary px-3 py-2 text-sm">
                      <span class="font-medium text-themed">{{ t(`tickets.support.linkType.${link.objectType}`) }}</span>
                      <span class="text-themed-muted"> · {{ link.objectLabel || `#${link.objectId}` }}</span>
                    </div>
                    <p v-if="supportContext.links.length === 0" class="text-sm text-themed-muted">{{ t('common.noData') }}</p>
                  </div>
                </div>
              </section>

              <section class="card p-4 lg:col-span-2">
                <div class="grid gap-4 lg:grid-cols-3">
                  <div>
                    <h3 class="font-semibold text-themed mb-3">{{ t('tickets.support.knowledge') }}</h3>
                    <div class="space-y-3">
                      <div v-for="item in supportContext.knowledgeSuggestions" :key="item.title" class="rounded-lg bg-themed-secondary p-3 text-sm">
                        <p class="font-medium text-themed">{{ item.title }}</p>
                        <ul class="mt-2 space-y-1 text-themed-muted">
                          <li v-for="step in item.steps" :key="step">- {{ step }}</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 class="font-semibold text-themed mb-3">{{ t('tickets.support.internalNotes') }}</h3>
                    <textarea v-model="internalNoteContent" rows="3" :placeholder="t('tickets.support.notePlaceholder')" class="input resize-none" />
                    <button :disabled="internalNoteSubmitting || !internalNoteContent.trim()" class="btn btn-primary btn-sm mt-2 w-full" @click="submitInternalNote">
                      {{ internalNoteSubmitting ? t('common.saving') : t('tickets.support.saveNote') }}
                    </button>
                    <div class="mt-3 max-h-48 overflow-y-auto space-y-2">
                      <div v-for="note in supportContext.internalNotes" :key="note.id" class="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-2 text-sm">
                        <p class="text-themed whitespace-pre-wrap">{{ note.content }}</p>
                        <p class="mt-1 text-xs text-themed-muted">{{ note.actorUsername }} · <span class="font-mono">{{ formatDateShort(note.createdAt) }}</span></p>
                      </div>
                      <p v-if="supportContext.internalNotes.length === 0" class="text-sm text-themed-muted">{{ t('common.noData') }}</p>
                    </div>
                  </div>
                  <div>
                    <h3 class="font-semibold text-themed mb-3">{{ t('tickets.support.timeline') }}</h3>
                    <div class="max-h-80 overflow-y-auto space-y-2">
                      <div v-for="item in supportContext.timeline" :key="`${item.type}-${item.id}-${item.createdAt}`" class="rounded-lg border border-themed p-2 text-sm">
                        <div class="flex justify-between gap-2">
                          <span class="font-medium text-themed">{{ item.title }}</span>
                          <span class="text-xs text-themed-muted font-mono">{{ formatDateShort(item.createdAt) }}</span>
                        </div>
                        <p class="text-xs text-themed-muted">{{ item.actor }}</p>
                        <p class="mt-1 text-themed-secondary line-clamp-2">{{ item.content }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
          
          <!-- Messages -->
          <div id="messages-container" class="max-h-96 overflow-y-auto p-4 sm:p-6 space-y-4">
            <!-- Load More Button (at top) -->
            <div v-if="messagesTotalPages > 1 && messagesPage < messagesTotalPages" class="flex justify-center">
              <button :disabled="messagesLoadingMore" class="btn btn-secondary btn-sm" @click="loadMoreMessages">
                <span v-if="messagesLoadingMore" class="flex items-center gap-2">
                  <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {{ t('common.loading') }}
                </span>
                <span v-else>{{ t('tickets.loadMoreMessages') }} ({{ messagesTotal - messages.length }} {{ t('tickets.remaining') }})</span>
              </button>
            </div>
            
            <template v-if="messagesLoading">
              <SkeletonLoader type="list" :count="3" />
            </template>
            <template v-else>
              <div v-for="message in messages" :key="message.id" :class="['flex gap-3', message.senderId === authStore.user?.id ? 'flex-row-reverse' : '']">
                <UserAvatar :username="message.sender?.username || ''" :avatar-style="message.sender?.avatarStyle" :badge-id="message.sender?.avatarBadgeId || null" :size="32" />
                <div :class="['flex-1 max-w-[80%]', message.senderId === authStore.user?.id ? 'text-right' : '']">
                  <div class="flex items-center gap-2 mb-1" :class="message.senderId === authStore.user?.id ? 'justify-end' : ''">
                    <span class="font-medium text-sm text-themed">
                      {{ message.sender?.username }}
                    </span>
                    <span v-if="message.isFromOwner" class="text-xs text-primary-500">
                      {{ t('tickets.ownerReply') }}
                    </span>
                    <span class="text-xs text-themed-muted font-mono">
                      {{ formatDate(message.createdAt) }}
                    </span>
                    <!-- 管理员删除按钮 -->
                    <button
                      v-if="authStore.isAdmin"
                      class="p-1 text-themed-faint hover:text-red-500 transition-colors"
                      :title="t('tickets.deleteMessage')"
                      @click="confirmDeleteMessage(message)"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <div :class="['inline-block max-w-full rounded-2xl px-3.5 py-2.5 text-sm', message.senderId === authStore.user?.id ? 'bg-primary-600 text-white' : 'bg-themed-secondary text-themed']">
                    <p v-if="message.content" class="whitespace-pre-wrap text-left">{{ message.content }}</p>
                    <div v-if="message.attachments.length > 0" :class="['grid gap-2', message.content ? 'mt-3' : '', message.attachments.length === 1 ? 'grid-cols-1 max-w-xs' : 'grid-cols-2']">
                      <button
                        v-for="attachment in message.attachments"
                        :key="attachment.id"
                        type="button"
                        class="relative overflow-hidden rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5"
                        :title="attachment.originalName"
                        @click="openAttachmentLightbox(attachment.id)"
                      >
                        <img
                          v-if="attachmentObjectUrls[attachment.id]"
                          :src="attachmentObjectUrls[attachment.id]"
                          :alt="attachment.originalName"
                          class="h-32 w-full object-cover"
                        >
                        <div v-else class="flex h-32 w-full items-center justify-center text-xs text-themed-muted">
                          {{ attachmentLoadingIds[attachment.id] ? t('common.loading') : t('tickets.images.loadFailed') }}
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
          
          <!-- Reply Box -->
          <div class="p-4 sm:p-6 border-t border-themed">
            <template v-if="selectedTicket.status === 'closed'">
              <p class="text-center text-themed-muted">
                {{ t('tickets.ticketClosed') }}
              </p>
            </template>
            <template v-else>
              <div class="flex gap-3">
                <textarea id="ticket-reply-textarea" v-model="replyContent" :placeholder="t('tickets.replyPlaceholder')" rows="3" class="input flex-1 resize-none" />
              </div>
              <div class="mt-4">
                <TicketImageUploader v-model="replyAttachments" :disabled="replying" />
              </div>
              <div class="flex justify-end mt-3">
                <button :disabled="replying || (!replyContent.trim() && replyAttachments.length === 0)" class="btn btn-primary" @click="handleReply">
                  {{ replying ? t('common.sending') : t('tickets.reply') }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </template>
      
      <!-- Create View -->
      <template v-else-if="viewMode === 'create'">
        <div class="card p-4 sm:p-6">
          <form class="space-y-6" @submit.prevent="submitCreate">
            <!-- Instance -->
            <div>
              <label class="block text-sm font-medium text-themed mb-2">
                {{ t('tickets.selectInstance') }}
              </label>
              <InstanceSelector
                v-model="createForm.instanceId"
                :instances="formattedInstances"
                :placeholder="t('tickets.selectInstanceHint')"
              />
              <p v-if="availableInstances.length === 0 && !instancesLoading" class="mt-2 text-sm text-themed-muted">
                {{ t('tickets.noInstancesHint') }}
              </p>
            </div>
            
            <!-- Subject -->
            <div>
              <label class="block text-sm font-medium text-themed mb-2">
                {{ t('tickets.subject') }} *
              </label>
              <input v-model="createForm.subject" type="text" required minlength="2" maxlength="200" :placeholder="t('tickets.subjectPlaceholder')" class="input" />
            </div>
            
            <!-- Category & Priority -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-themed mb-2">
                  {{ t('tickets.selectCategory') }}
                </label>
                <select v-model="createForm.category" class="input">
                  <option v-for="cat in categories" :key="cat" :value="cat">
                    {{ t(`tickets.category.${cat}`) }}
                  </option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-2">
                  {{ t('tickets.selectPriority') }}
                </label>
                <select v-model="createForm.priority" class="input">
                  <option v-for="p in priorities" :key="p" :value="p">
                    {{ t(`tickets.priority.${p}`) }}
                  </option>
                </select>
              </div>
            </div>
            
            <!-- Content -->
            <div>
              <label class="block text-sm font-medium text-themed mb-2">
                {{ t('tickets.content') }}
              </label>
              <textarea v-model="createForm.content" maxlength="5000" rows="6" :placeholder="t('tickets.contentPlaceholder')" class="input resize-none" />
            </div>

            <TicketImageUploader v-model="createAttachments" :disabled="creating" />
            
            <!-- 托管实例提示 -->
            <div class="flex items-start gap-3 p-4 rounded-xl bg-themed-secondary border border-themed">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-themed-tertiary">
                <svg class="w-4 h-4 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-themed">
                  {{ t('tickets.hostedInstanceHintTitle') }}
                </p>
                <p class="text-xs mt-0.5 text-themed-muted">
                  {{ t('tickets.hostedInstanceHint') }}
                </p>
              </div>
            </div>
            
            <!-- Submit -->
            <div class="flex justify-end gap-3">
              <button type="button" class="btn btn-ghost" @click="backToList">
                {{ t('common.cancel') }}
              </button>
              <button type="submit" :disabled="creating" class="btn btn-primary">
                {{ creating ? t('common.processing') : t('tickets.createTicket') }}
              </button>
            </div>
          </form>
        </div>
      </template>
    </div>
    <TicketImageLightbox
      :show="lightboxOpen"
      :images="lightboxImages"
      :start-index="lightboxStartIndex"
      @close="lightboxOpen = false"
    />
  </div>
</template>

<style scoped>
.nimbus-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.1rem;
  letter-spacing: 0.01em;
}

.nimbus-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: currentColor;
  opacity: 0.7;
  flex: none;
}

.card-interactive.ticket-needs-reply {
  border-color: rgb(245 158 11 / 0.6);
  box-shadow: inset 0 0 0 1px rgb(245 158 11 / 0.25);
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
  }
}
</style>
