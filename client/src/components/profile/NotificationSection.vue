<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import type { NotificationChannel as ApiNotificationChannel } from '@/types/api'

const { t } = useI18n()
const toast = useToast()

interface NotificationChannel {
  id: number
  type: string
  name: string
  enabled: boolean
  config: Record<string, unknown>
  configPreview?: string
}

interface NotificationLog {
  id: number
  channelId: number
  channelName: string
  channelType: string
  eventType: string
  message: string
  status: string
  error: string | null
  createdAt: string
}

interface NotificationStats {
  total: number
  sent: number
  failed: number
  pending: number
}

const notificationChannels = ref<NotificationChannel[]>([])
const showAddNotification = ref<boolean>(false)
const showHistory = ref<boolean>(false)
const notificationLogs = ref<NotificationLog[]>([])
const notificationStats = ref<NotificationStats | null>(null)
const logsPage = ref(1)
const logsTotal = ref(0)
const logsPageSize = 10
const logsStatusFilter = ref<'all' | 'sent' | 'failed'>('all')
const logsLoading = ref(false)

interface NotificationForm {
  type: 'telegram' | 'discord' | 'webhook' | 'email'
  name: string
  config: Record<string, unknown>
}
const notificationForm = ref<NotificationForm>({
  type: 'telegram',
  name: '',
  config: {}
})
const notificationLoading = ref<boolean>(false)

const totalPages = computed(() => Math.ceil(logsTotal.value / logsPageSize))

async function loadNotificationChannels(): Promise<void> {
  try {
    const response = await api.notifications.list()
    const data = response as { channels?: ApiNotificationChannel[] }
    notificationChannels.value = (data.channels || []).map((ch: ApiNotificationChannel) => ({
      id: ch.id,
      type: ch.type,
      name: ch.name,
      enabled: Boolean(ch.enabled),
      config: typeof ch.config === 'string' ? JSON.parse(ch.config) : (ch.config ?? {}),
      configPreview: (ch as any).configPreview || ''
    }))
  } catch (error) {
    console.error('Failed to load notification channels:', error)
  }
}

async function loadNotificationLogs(): Promise<void> {
  logsLoading.value = true
  try {
    const params: { page: number; pageSize: number; status?: 'sent' | 'failed' } = {
      page: logsPage.value,
      pageSize: logsPageSize
    }
    if (logsStatusFilter.value !== 'all') {
      params.status = logsStatusFilter.value
    }
    const result = await api.notifications.getLogs(params)
    notificationLogs.value = result.logs
    logsTotal.value = result.total
  } catch (error) {
    console.error('Failed to load notification logs:', error)
  } finally {
    logsLoading.value = false
  }
}

async function loadNotificationStats(): Promise<void> {
  try {
    const result = await api.notifications.getStats()
    notificationStats.value = result.stats
  } catch (error) {
    console.error('Failed to load notification stats:', error)
  }
}

async function openHistory(): Promise<void> {
  showHistory.value = true
  logsPage.value = 1
  await Promise.all([loadNotificationLogs(), loadNotificationStats()])
}

function closeHistory(): void {
  showHistory.value = false
}

async function changeLogsPage(page: number): Promise<void> {
  logsPage.value = page
  await loadNotificationLogs()
}

async function changeLogsFilter(status: 'all' | 'sent' | 'failed'): Promise<void> {
  logsStatusFilter.value = status
  logsPage.value = 1
  await loadNotificationLogs()
}

async function addNotificationChannel(): Promise<void> {
  if (!notificationForm.value.name) return
  
  notificationLoading.value = true
  try {
    await api.notifications.create({
      type: notificationForm.value.type,
      name: notificationForm.value.name,
      config: notificationForm.value.config
    })
    toast.success(t('profile.notifications.addSuccess'))
    showAddNotification.value = false
    notificationForm.value = { type: 'telegram', name: '', config: {} }
    await loadNotificationChannels()
  } catch (error: any) {
    toast.error(t('profile.notifications.addFailed') + ': ' + (error?.message || String(error)))
  } finally {
    notificationLoading.value = false
  }
}

async function deleteNotificationChannel(channelId: number): Promise<void> {
  if (!confirm(t('profile.notifications.confirmDelete'))) return
  
  try {
    await api.notifications.delete(channelId)
    toast.success(t('profile.notifications.deleteSuccess'))
    await loadNotificationChannels()
  } catch (error: any) {
    toast.error(t('profile.notifications.deleteFailed') + ': ' + (error?.message || String(error)))
  }
}

async function toggleNotificationChannel(channel: NotificationChannel): Promise<void> {
  try {
    await api.notifications.toggle(channel.id)
    toast.success(channel.enabled ? t('profile.notifications.disabled') : t('profile.notifications.enabled'))
    await loadNotificationChannels()
  } catch (error: any) {
    toast.error(t('profile.notifications.toggleFailed') + ': ' + (error?.message || String(error)))
  }
}

async function testNotificationChannel(channelId: number): Promise<void> {
  try {
    await api.notifications.test(channelId)
    toast.success(t('profile.notifications.testSuccess'))
  } catch (error: any) {
    toast.error(t('profile.notifications.testFailed') + ': ' + (error?.message || String(error)))
  }
}

function getNotificationTypeLabel(type: string): string {
  const map: Record<string, string> = { telegram: 'Telegram', discord: 'Discord', webhook: 'Webhook', email: 'Email' }
  return map[type] || type
}

function getEventTypeLabel(eventType: string): string {
  const key = `profile.notifications.eventTypes.${eventType}`
  const label = t(key)
  return label === key ? eventType : label
}

function getLogStatusLabel(status: string): string {
  switch (status) {
    case 'sent':
      return t('profile.notifications.statusSent')
    case 'failed':
      return t('profile.notifications.statusFailed')
    default:
      return t('profile.notifications.statusPending')
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 挂载时加载
loadNotificationChannels()

defineExpose({ loadNotificationChannels })
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-sm font-medium text-themed-secondary">{{ $t('profile.notifications.title') }}</h2>
        <p class="text-xs text-themed-faint mt-0.5">{{ $t('profile.notifications.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn-ghost btn-sm" @click="openHistory">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {{ $t('profile.notifications.history') }}
        </button>
        <button class="btn-ghost btn-sm" @click="showAddNotification = true">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ $t('profile.notifications.add') }}
        </button>
      </div>
    </div>

    <!-- 添加通知渠道表单 -->
    <div v-if="showAddNotification" class="mb-4 p-4 bg-themed-tertiary border border-themed rounded-lg space-y-3">
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.notifications.type') }}</label>
        <select v-model="notificationForm.type" class="input" @change="notificationForm.config = {}">
          <option value="telegram">Telegram</option>
          <option value="discord">Discord</option>
          <option value="webhook">Webhook</option>
        </select>
      </div>
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.notifications.name') }}</label>
        <input v-model="notificationForm.name" type="text" class="input" :placeholder="$t('profile.notifications.namePlaceholder')" />
      </div>
      
      <!-- Telegram 配置 -->
      <template v-if="notificationForm.type === 'telegram'">
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.notifications.telegram.botToken') }}</label>
          <input v-model="notificationForm.config.botToken" type="text" class="input" :placeholder="$t('profile.notifications.telegram.botTokenPlaceholder')" />
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.notifications.telegram.chatId') }}</label>
          <input v-model="notificationForm.config.chatId" type="text" class="input" :placeholder="$t('profile.notifications.telegram.chatIdPlaceholder')" />
        </div>
      </template>
      
      <!-- Discord 配置 -->
      <template v-else-if="notificationForm.type === 'discord'">
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.notifications.discord.webhookUrl') }}</label>
          <input v-model="notificationForm.config.webhookUrl" type="text" class="input" :placeholder="$t('profile.notifications.discord.webhookUrlPlaceholder')" />
        </div>
      </template>
      
      <!-- Webhook 配置 -->
      <template v-else-if="notificationForm.type === 'webhook'">
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.notifications.webhook.url') }}</label>
          <input v-model="notificationForm.config.url" type="text" class="input" :placeholder="$t('profile.notifications.webhook.urlPlaceholder')" />
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.notifications.webhook.secret') }}</label>
          <input v-model="notificationForm.config.secret" type="text" class="input" :placeholder="$t('profile.notifications.webhook.secretPlaceholder')" />
        </div>
      </template>

      <div class="flex gap-2">
        <button :disabled="notificationLoading || !notificationForm.name" class="btn-primary btn-sm" @click="addNotificationChannel">
          {{ notificationLoading ? $t('profile.notifications.saving') : $t('profile.notifications.save') }}
        </button>
        <button class="btn-ghost btn-sm" @click="showAddNotification = false">{{ $t('profile.notifications.cancel') }}</button>
      </div>
    </div>

    <TransitionGroup v-if="notificationChannels.length" name="list" tag="div" class="space-y-2">
      <div v-for="channel in notificationChannels" :key="channel.id" class="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-themed-tertiary border border-themed rounded-lg hover:border-themed-secondary transition-colors">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <div class="w-8 h-8 rounded bg-themed-secondary flex items-center justify-center">
            <svg v-if="channel.type === 'telegram'" class="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.14.121.099.155.232.17.36.015.101.012.234-.004.36z" />
            </svg>
            <svg v-else-if="channel.type === 'discord'" class="w-4 h-4 text-indigo-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.369a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.249.077.077 0 00-.079-.037 19.736 19.736 0 00-4.885 1.515.069.069 0 00-.032.027C.533 9.045-.32 13.58.099 18.056a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.078-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 01.079.009c.12.098.245.198.373.293a.077.077 0 01-.007.128 12.299 12.299 0 01-1.873.891.077.077 0 00-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.029 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.056c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.028z" />
            </svg>
            <svg v-else class="w-4 h-4 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <div>
            <div class="text-sm text-themed-secondary flex items-center gap-2">
              {{ channel.name }}
              <span class="text-xs px-1.5 py-0.5 rounded badge-default">
                {{ getNotificationTypeLabel(channel.type) }}
              </span>
              <span v-if="!channel.enabled" class="text-xs text-themed-faint">{{ $t('profile.notifications.disabledSuffix') }}</span>
            </div>
            <div class="text-xs text-themed-faint">{{ channel.configPreview }}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button class="btn-ghost btn-sm" :title="$t('profile.notifications.test')" @click="testNotificationChannel(channel.id)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button class="btn-ghost btn-sm" @click="toggleNotificationChannel(channel)">
            {{ channel.enabled ? $t('profile.notifications.disable') : $t('profile.notifications.enable') }}
          </button>
          <button class="text-themed-faint hover:text-red-400" @click="deleteNotificationChannel(channel.id)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </TransitionGroup>
    <div v-else-if="!showAddNotification" class="text-sm text-themed-muted text-center py-6 border border-dashed border-themed rounded-lg">
      <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      {{ $t('profile.notifications.noChannels') }}
    </div>

    <!-- 通知历史弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showHistory" class="modal-overlay" @click.self="closeHistory">
          <div class="modal-backdrop" @click="closeHistory"></div>
          <div class="modal-content !max-w-2xl w-full max-h-[80vh] flex flex-col">
            <!-- 头部 -->
            <div class="flex items-center justify-between p-4 border-b border-themed">
              <div>
                <h3 class="text-sm font-medium text-themed-secondary">{{ $t('profile.notifications.historyTitle') }}</h3>
                <div v-if="notificationStats" class="text-xs text-themed-faint mt-1 flex gap-3">
                  <span>{{ $t('profile.notifications.statsTotal', { count: notificationStats.total }) }}</span>
                  <span class="text-green-500">{{ $t('profile.notifications.statsSent', { count: notificationStats.sent }) }}</span>
                  <span class="text-red-500">{{ $t('profile.notifications.statsFailed', { count: notificationStats.failed }) }}</span>
                </div>
              </div>
              <button class="text-themed-faint hover:text-themed-secondary" @click="closeHistory">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <!-- 筛选 -->
            <div class="px-4 py-2 border-b border-themed flex gap-2">
              <button
                :class="['px-3 py-1 text-xs rounded', logsStatusFilter === 'all' ? 'bg-themed-secondary text-themed-primary' : 'text-themed-muted hover:text-themed-secondary']"
                @click="changeLogsFilter('all')"
              >
                {{ $t('profile.notifications.filterAll') }}
              </button>
              <button
                :class="['px-3 py-1 text-xs rounded', logsStatusFilter === 'sent' ? 'bg-green-500/20 text-green-500' : 'text-themed-muted hover:text-themed-secondary']"
                @click="changeLogsFilter('sent')"
              >
                {{ $t('profile.notifications.filterSent') }}
              </button>
              <button
                :class="['px-3 py-1 text-xs rounded', logsStatusFilter === 'failed' ? 'bg-red-500/20 text-red-500' : 'text-themed-muted hover:text-themed-secondary']"
                @click="changeLogsFilter('failed')"
              >
                {{ $t('profile.notifications.filterFailed') }}
              </button>
            </div>

            <!-- 列表 -->
            <div class="flex-1 overflow-y-auto p-4">
              <div v-if="logsLoading" class="text-center py-8 text-themed-muted">
                {{ $t('profile.notifications.loadingLogs') }}
              </div>
              <div v-else-if="notificationLogs.length === 0" class="text-center py-8 text-themed-muted">
                {{ $t('profile.notifications.noLogs') }}
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="log in notificationLogs"
                  :key="log.id"
                  class="p-3 bg-themed-tertiary border border-themed rounded-lg"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 text-xs">
                        <span
                          :class="[
                            'px-1.5 py-0.5 rounded',
                            log.status === 'sent' ? 'bg-green-500/20 text-green-500' :
                            log.status === 'failed' ? 'bg-red-500/20 text-red-500' :
                            'bg-yellow-500/20 text-yellow-500'
                          ]"
                        >
                          {{ getLogStatusLabel(log.status) }}
                        </span>
                        <span class="text-themed-muted">{{ getEventTypeLabel(log.eventType) }}</span>
                        <span class="text-themed-faint">{{ log.channelName }} ({{ getNotificationTypeLabel(log.channelType) }})</span>
                      </div>
                      <p class="text-xs text-themed-secondary mt-1 line-clamp-2">{{ log.message }}</p>
                      <p v-if="log.error" class="text-xs text-red-400 mt-1">{{ $t('profile.notifications.errorPrefix', { error: log.error }) }}</p>
                    </div>
                    <span class="text-xs text-themed-faint whitespace-nowrap">{{ formatDate(log.createdAt) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 分页 -->
            <div v-if="totalPages > 1" class="px-4 py-3 border-t border-themed flex items-center justify-center gap-2">
              <button
                :disabled="logsPage <= 1"
                class="px-3 py-1 text-xs rounded border border-themed disabled:opacity-50"
                @click="changeLogsPage(logsPage - 1)"
              >
                {{ $t('common.prevPage') }}
              </button>
              <span class="text-xs text-themed-muted">{{ logsPage }} / {{ totalPages }}</span>
              <button
                :disabled="logsPage >= totalPages"
                class="px-3 py-1 text-xs rounded border border-themed disabled:opacity-50"
                @click="changeLogsPage(logsPage + 1)"
              >
                {{ $t('common.nextPage') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
