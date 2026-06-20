<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import InstanceDisplayIcon from '@/components/InstanceDisplayIcon.vue'
import InstanceSelector from '@/components/InstanceSelector.vue'
import TicketImageLightbox from '@/components/tickets/TicketImageLightbox.vue'
import TicketImageUploader from '@/components/tickets/TicketImageUploader.vue'
import TicketInstanceOwnerCard from '@/components/tickets/TicketInstanceOwnerCard.vue'
import type { Ticket, TicketMessage, TicketMessageAttachment, TicketStatus, TicketPriority, TicketCategory, InstanceWithDetails } from '@/types/api'

const { t } = useI18n()
const toast = useToast()
const authStore = useAuthStore()
const configStore = useConfigStore()
const route = useRoute()
const router = useRouter()

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
const statusFilter = ref<StatusFilterType>('active')
const hostFilter = ref<number | ''>('')
const hostTicketSourceFilter = ref<HostTicketSourceType>('all')

// Detail data
const selectedTicket = ref<Ticket | null>(null)
const messages = ref<TicketMessage[]>([])
const messagesLoading = ref(false)
const isOwner = ref(false)
const isCreator = ref(false)

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
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
}

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
    name: 'tickets',
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
  } catch (error: any) {
    toast.error(error?.message || t('common.error'))
    await navigateToList(true)
  } finally {
    messagesLoading.value = false
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
  searchQuery.value = ''
  await router.replace({
    name: 'tickets',
    query: buildTicketsQuery({ tab })
  })
}

function handlePageChange(newPage: number) {
  page.value = newPage
  loadTickets(true)
}

watch([statusFilter, hostFilter, hostTicketSourceFilter], () => {
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
    name: 'tickets',
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

// Create ticket
function openCreateForm() {
  if (!configStore.ticketEnabled) return
  router.push({
    name: 'tickets',
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
    toast.error(t('tickets.content') + ' ' + t('common.error'))
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
      name: 'tickets',
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
  <div class="min-h-screen">
    <div class="py-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <div class="flex items-center gap-3 mb-4 sm:mb-0">
          <button v-if="viewMode !== 'list'" class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" @click="backToList">
            <svg class="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
            {{ viewMode === 'detail' ? t('tickets.ticketDetails') : viewMode === 'create' ? t('tickets.newTicket') : t('tickets.title') }}
          </h1>
        </div>
        
        <!-- 管理员不显示"创建工单"按钮 -->
        <button v-if="viewMode === 'list' && !authStore.isAdmin && configStore.ticketEnabled" class="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors text-sm font-medium" @click="openCreateForm">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('tickets.createTicket') }}
        </button>
      </div>
      
      <!-- List View -->
      <template v-if="viewMode === 'list'">
        <!-- Tabs -->
        <div class="flex border-b border-gray-200 dark:border-gray-700 mb-6">
          <!-- 普通用户显示"我的工单"标签，管理员不显示 -->
          <button v-if="!authStore.isAdmin" :class="['px-4 py-3 text-sm font-medium border-b-2 transition-colors', activeTab === 'my' ? 'border-black dark:border-white text-gray-900 dark:text-white' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300']" @click="switchTab('my')">
            {{ t('tickets.myTickets') }}
            <span v-if="pendingCount.userTickets > 0" class="ml-2 px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full">
              {{ pendingCount.userTickets }}
            </span>
          </button>
          <button v-if="isHostOwner" :class="['px-4 py-3 text-sm font-medium border-b-2 transition-colors', activeTab === 'host' ? 'border-black dark:border-white text-gray-900 dark:text-white' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300']" @click="switchTab('host')">
            {{ t('tickets.hostTickets') }}
            <span v-if="pendingCount.hostTickets > 0" class="ml-2 px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full">
              {{ pendingCount.hostTickets }}
            </span>
          </button>
        </div>
        
        <!-- Filters & Search Row -->
        <div class="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
          <!-- Status Filter - 分段按钮组 -->
          <div class="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 flex-shrink-0">
            <div class="inline-flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <button
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap',
                  statusFilter === 'active'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
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
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                ]"
                @click="statusFilter = status"
              >
                {{ t(`tickets.status.${status}`) }}
              </button>
              <button
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap',
                  statusFilter === 'all'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                ]"
                @click="statusFilter = 'all'"
              >
                {{ t('tickets.allStatus') }}
              </button>
            </div>
          </div>

          <div v-if="activeTab === 'host' && authStore.isAdmin" class="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 flex-shrink-0">
            <div class="inline-flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <button
                v-for="sourceType in ['all', 'user', 'official', 'hosted']"
                :key="sourceType"
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap',
                  hostTicketSourceFilter === sourceType
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                ]"
                @click="hostTicketSourceFilter = sourceType as HostTicketSourceType"
              >
                {{ t(`tickets.sourceFilter.${sourceType}`) }}
              </button>
            </div>
          </div>
          
          <!-- Search Box -->
          <div class="flex-1 max-w-xs">
            <div class="relative">
              <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="t('tickets.searchPlaceholder')"
                class="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent"
                @input="handleSearchInput"
              />
              <button
                v-if="searchQuery"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
            <svg class="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {{ activeTab === 'my' ? t('tickets.noTickets') : hostEmptyState.title }}
            </h3>
            <p class="text-gray-500 dark:text-gray-400">
              {{ activeTab === 'my' ? t('tickets.noTicketsHint') : hostEmptyState.hint }}
            </p>
          </div>
        </template>
        
        <!-- Ticket List -->
        <template v-else>
          <div class="space-y-3">
            <div v-for="ticket in tickets" :key="ticket.id" :class="['bg-white dark:bg-gray-800 rounded-xl border p-4 cursor-pointer transition-colors', ticket.needsReply ? 'border-orange-300 dark:border-orange-600 hover:border-orange-400 dark:hover:border-orange-500 ring-1 ring-orange-100 dark:ring-orange-900/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600']" @click="viewTicket(ticket)">
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
                    <span v-if="ticket.needsReply" class="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 flex items-center gap-1">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                      {{ t('tickets.needsReply') }}
                    </span>
                    <span :class="['px-2 py-0.5 text-xs font-medium rounded-full', statusColors[ticket.status]]">
                      {{ t(`tickets.status.${ticket.status}`) }}
                    </span>
                    <span :class="['px-2 py-0.5 text-xs rounded-full', priorityColors[ticket.priority]]">
                      {{ t(`tickets.priority.${ticket.priority}`) }}
                    </span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      #{{ ticket.id }}
                    </span>
                  </div>
                  <h3 class="font-medium text-gray-900 dark:text-white truncate">
                    {{ ticket.subject }}
                  </h3>
                  <div class="flex flex-wrap items-center gap-2 mt-1 text-sm text-gray-500 dark:text-gray-400">
                    <span v-if="activeTab === 'host' && ticket.user">
                      {{ t('tickets.from') }}: {{ ticket.user.username }}
                    </span>
                    <span v-if="ticket.host">
                      {{ ticket.host.name }}
                    </span>
                    <span v-if="ticket.instance" class="inline-flex items-center gap-1.5 text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
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
                <div class="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-1 text-sm text-gray-500 dark:text-gray-400">
                  <span>{{ formatDateShort(ticket.createdAt) }}</span>
                  <span v-if="ticket.messageCount" class="flex items-center gap-1">
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
            <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span>{{ t('tickets.perPage') }}</span>
              <select
                :value="pageSize"
                class="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent"
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
              <button :disabled="page === 1" class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700" @click="handlePageChange(page - 1)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                {{ page }} / {{ totalPages }}
              </span>
              <button :disabled="page === totalPages" class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700" @click="handlePageChange(page + 1)">
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
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <!-- Header -->
          <div class="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span :class="['px-2 py-0.5 text-xs font-medium rounded-full', statusColors[selectedTicket.status]]">
                {{ t(`tickets.status.${selectedTicket.status}`) }}
              </span>
              <span :class="['px-2 py-0.5 text-xs rounded-full', priorityColors[selectedTicket.priority]]">
                {{ t(`tickets.priority.${selectedTicket.priority}`) }}
              </span>
              <span class="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full">
                {{ t(`tickets.category.${selectedTicket.category}`) }}
              </span>
            </div>
            <div class="flex items-center gap-3 mb-3">
              <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
                {{ selectedTicket.subject }}
              </h2>
              <span class="text-sm text-gray-500 dark:text-gray-400 font-mono">#{{ selectedTicket.id }}</span>
            </div>
            <div class="flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400">
              <span v-if="selectedTicket.user" class="inline-flex items-center gap-2">
                <span>{{ t('tickets.from') }}:</span>
                <UserAvatar
                  :username="selectedTicket.user.username"
                  :avatar-style="selectedTicket.user.avatarStyle"
                  :badge-id="selectedTicket.user.avatarBadgeId || null"
                  :size="24"
                />
                <span class="text-gray-900 dark:text-white">{{ selectedTicket.user.username }}</span>
              </span>
              <span v-if="selectedTicket.host">
                {{ t('tickets.host') }}: <span class="text-gray-900 dark:text-white">{{ selectedTicket.host.name }}</span>
              </span>
              <span v-if="selectedTicket.instance" class="inline-flex items-center gap-2">
                <span>{{ t('tickets.instance') }}:</span>
                <InstanceDisplayIcon
                  v-if="selectedTicket.instance.iconBadgeId"
                  :badge-id="selectedTicket.instance.iconBadgeId"
                  :alt="selectedTicket.instance.name"
                  :size="24"
                />
                <span class="text-gray-900 dark:text-white">{{ selectedTicket.instance.name }}</span>
              </span>
              <span>
                {{ t('tickets.createdAt') }}: {{ formatDate(selectedTicket.createdAt) }}
              </span>
            </div>
            
            <TicketInstanceOwnerCard
              v-if="isOwner && selectedTicket.instance"
              :instance-summary="selectedTicket.instance"
            />
            
            <!-- Owner Actions -->
            <div v-if="isOwner && selectedTicket.status !== 'closed'" class="flex flex-wrap gap-2 mt-4">
              <button v-if="selectedTicket.status === 'open'" class="px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors" @click="updateStatus('in_progress')">
                {{ t('tickets.markInProgress') }}
              </button>
              <button v-if="selectedTicket.status !== 'resolved'" class="px-3 py-1.5 text-sm bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors" @click="updateStatus('resolved')">
                {{ t('tickets.markResolved') }}
              </button>
              <button class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" @click="closeTicket">
                {{ t('tickets.close') }}
              </button>
            </div>
            <div v-else-if="isCreator && selectedTicket.status !== 'closed'" class="mt-4">
              <button class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" @click="closeTicket">
                {{ t('tickets.close') }}
              </button>
            </div>
          </div>
          
          <!-- Messages -->
          <div id="messages-container" class="max-h-96 overflow-y-auto p-4 sm:p-6 space-y-4">
            <!-- Load More Button (at top) -->
            <div v-if="messagesTotalPages > 1 && messagesPage < messagesTotalPages" class="flex justify-center">
              <button :disabled="messagesLoadingMore" class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors" @click="loadMoreMessages">
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
                    <span class="font-medium text-sm text-gray-900 dark:text-white">
                      {{ message.sender?.username }}
                    </span>
                    <span v-if="message.isFromOwner" class="text-xs text-blue-600 dark:text-blue-400">
                      {{ t('tickets.ownerReply') }}
                    </span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{ formatDate(message.createdAt) }}
                    </span>
                    <!-- 管理员删除按钮 -->
                    <button
                      v-if="authStore.isAdmin"
                      class="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
                      :title="t('tickets.deleteMessage')"
                      @click="confirmDeleteMessage(message)"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <div :class="['inline-block max-w-full p-3 rounded-lg text-sm', message.senderId === authStore.user?.id ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100' : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white']">
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
                        <div v-else class="flex h-32 w-full items-center justify-center text-xs text-gray-500 dark:text-gray-400">
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
          <div class="p-4 sm:p-6 border-t border-gray-200 dark:border-gray-700">
            <template v-if="selectedTicket.status === 'closed'">
              <p class="text-center text-gray-500 dark:text-gray-400">
                {{ t('tickets.ticketClosed') }}
              </p>
            </template>
            <template v-else>
              <div class="flex gap-3">
                <textarea v-model="replyContent" :placeholder="t('tickets.replyPlaceholder')" rows="3" class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent resize-none" />
              </div>
              <div class="mt-4">
                <TicketImageUploader v-model="replyAttachments" :disabled="replying" />
              </div>
              <div class="flex justify-end mt-3">
                <button :disabled="replying || (!replyContent.trim() && replyAttachments.length === 0)" class="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium" @click="handleReply">
                  {{ replying ? t('common.sending') : t('tickets.reply') }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </template>
      
      <!-- Create View -->
      <template v-else-if="viewMode === 'create'">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
          <form class="space-y-6" @submit.prevent="submitCreate">
            <!-- Instance -->
            <div>
              <label class="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                {{ t('tickets.selectInstance') }}
              </label>
              <InstanceSelector
                v-model="createForm.instanceId"
                :instances="formattedInstances"
                :placeholder="t('tickets.selectInstanceHint')"
              />
              <p v-if="availableInstances.length === 0 && !instancesLoading" class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {{ t('tickets.noInstancesHint') }}
              </p>
            </div>
            
            <!-- Subject -->
            <div>
              <label class="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                {{ t('tickets.subject') }} *
              </label>
              <input v-model="createForm.subject" type="text" required minlength="2" maxlength="200" :placeholder="t('tickets.subjectPlaceholder')" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent" />
            </div>
            
            <!-- Category & Priority -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                  {{ t('tickets.selectCategory') }}
                </label>
                <select v-model="createForm.category" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent">
                  <option v-for="cat in categories" :key="cat" :value="cat">
                    {{ t(`tickets.category.${cat}`) }}
                  </option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                  {{ t('tickets.selectPriority') }}
                </label>
                <select v-model="createForm.priority" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent">
                  <option v-for="p in priorities" :key="p" :value="p">
                    {{ t(`tickets.priority.${p}`) }}
                  </option>
                </select>
              </div>
            </div>
            
            <!-- Content -->
            <div>
              <label class="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                {{ t('tickets.content') }}
              </label>
              <textarea v-model="createForm.content" maxlength="5000" rows="6" :placeholder="t('tickets.contentPlaceholder')" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent resize-none" />
            </div>

            <TicketImageUploader v-model="createAttachments" :disabled="creating" />
            
            <!-- 托管实例提示 -->
            <div class="flex items-start gap-3 p-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800/50">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-100 dark:bg-blue-900/50">
                <svg class="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-blue-800 dark:text-blue-300">
                  {{ t('tickets.hostedInstanceHintTitle') }}
                </p>
                <p class="text-xs mt-0.5 text-blue-700/80 dark:text-blue-400/80">
                  {{ t('tickets.hostedInstanceHint') }}
                </p>
              </div>
            </div>
            
            <!-- Submit -->
            <div class="flex justify-end gap-3">
              <button type="button" class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors" @click="backToList">
                {{ t('common.cancel') }}
              </button>
              <button type="submit" :disabled="creating" class="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium">
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
