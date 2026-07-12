<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import type { TelegramAdminBinding, TelegramAdminBindingsResponse } from '@/types/api'
import { systemSettingsNavigationItems } from '@/constants/adminSettings'
import { buildPublicApiUrl, getFrontendOrigin } from '@/utils/api-url'

const route = useRoute()
const toast = useToast()
const { t } = useI18n()

const loading = ref(true)
const savingTelegramBot = ref(false)
const savingFooterTelegramLink = ref(false)
const settingTelegramWebhook = ref(false)
const checkingTelegramWebhook = ref(false)
const deletingTelegramWebhook = ref(false)

interface ConfigItem {
  id: number
  key: string
  value: string
  type: string
  label: string | null
  description: string | null
}

interface TelegramWebhookInfoView {
  url: string
  pending_update_count?: number
  last_error_date?: number
  last_error_message?: string
  max_connections?: number
  allowed_updates?: string[]
}

interface GlobalChannel {
  id: number
  name: string
  type: string
  enabled: boolean
  boundPackages: number
  configPreview: string
  createdAt: string
}

const configs = ref<ConfigItem[]>([])
const telegramWebhookInfo = ref<TelegramWebhookInfoView | null>(null)
const globalChannels = ref<GlobalChannel[]>([])
const channelLoading = ref(false)
const savingChannel = ref(false)
const deletingChannelId = ref<number | null>(null)
const testingChannelId = ref<number | null>(null)
const showChannelForm = ref(false)
const editingChannel = ref<{ id: number; name: string; botToken: string; chatId: string; enabled: boolean } | null>(null)
const channelFormError = ref('')
const channelForm = ref({ name: '', botToken: '', chatId: '', enabled: true })
const bindingLoading = ref(false)
const bindingSearch = ref('')
const telegramBindings = ref<TelegramAdminBinding[]>([])
const telegramBindingsTotal = ref(0)
const telegramBindingsPage = ref(1)
const telegramBindingsPageSize = ref(5)
const unlinkingBindingId = ref<number | null>(null)
const telegramBindingGroup = ref<TelegramAdminBindingsResponse['group'] | null>(null)
const telegramBindingVipGroup = ref<TelegramAdminBindingsResponse['vipGroup'] | null>(null)

const form = ref({
  footer_telegram_link: 'https://t.me/incudal_com',
  telegram_bot_enabled: false,
  telegram_bot_username: '',
  telegram_bot_token: '',
  telegram_webhook_secret: '',
  telegram_group_join_enabled: false,
  telegram_group_chat_id: '',
  telegram_group_join_mode: 'any',
  telegram_group_min_recharge: 0,
  telegram_group_min_consume: 0,
  telegram_group_invite_expire_minutes: 30,
  telegram_vip_group_join_enabled: false,
  telegram_vip_group_chat_id: '',
  telegram_vip_group_join_mode: 'all',
  telegram_vip_group_min_recharge: 0,
  telegram_vip_group_min_consume: 0,
  telegram_vip_group_invite_expire_minutes: 30
})

const numericConfigKeys = ['telegram_group_invite_expire_minutes', 'telegram_vip_group_invite_expire_minutes']
const floatConfigKeys = ['telegram_group_min_recharge', 'telegram_group_min_consume', 'telegram_vip_group_min_recharge', 'telegram_vip_group_min_consume']
const booleanConfigKeys = ['telegram_bot_enabled', 'telegram_group_join_enabled', 'telegram_vip_group_join_enabled']
const stringConfigKeys = [
  'footer_telegram_link',
  'telegram_bot_username',
  'telegram_bot_token',
  'telegram_webhook_secret',
  'telegram_group_chat_id',
  'telegram_group_join_mode',
  'telegram_vip_group_chat_id',
  'telegram_vip_group_join_mode'
]

const telegramBotKeys = [
  'telegram_bot_enabled',
  'telegram_bot_username',
  'telegram_bot_token',
  'telegram_webhook_secret',
  'telegram_group_join_enabled',
  'telegram_group_chat_id',
  'telegram_group_join_mode',
  'telegram_group_min_recharge',
  'telegram_group_min_consume',
  'telegram_group_invite_expire_minutes',
  'telegram_vip_group_join_enabled',
  'telegram_vip_group_chat_id',
  'telegram_vip_group_join_mode',
  'telegram_vip_group_min_recharge',
  'telegram_vip_group_min_consume',
  'telegram_vip_group_invite_expire_minutes'
]
const footerTelegramLinkKeys = ['footer_telegram_link']

const maskedSecretPlaceholder = '********'
const telegramWebhookSecretPattern = /^[A-Za-z0-9_-]{1,256}$/

const telegramWebhookUrl = computed(() => buildPublicApiUrl('/telegram/webhook'))

const telegramWebhookSecretError = computed(() => {
  const value = form.value.telegram_webhook_secret
  if (!value || value === maskedSecretPlaceholder) {
    return ''
  }
  return telegramWebhookSecretPattern.test(value)
    ? ''
    : t('telegramConfig.secretInvalid')
})

const hasTelegramBotChanges = computed(() => {
  return telegramBotKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

const canManageTelegramWebhook = computed(() => {
  return Boolean(form.value.telegram_bot_token && form.value.telegram_webhook_secret && !telegramWebhookSecretError.value)
})

const hasFooterTelegramLinkChanges = computed(() => {
  return footerTelegramLinkKeys.some(key => {
    const config = configs.value.find(c => c.key === key)
    if (!config) return false
    return String((form.value as any)[key]) !== config.value
  })
})

const telegramBindingsTotalPages = computed(() => {
  return Math.max(1, Math.ceil(telegramBindingsTotal.value / telegramBindingsPageSize.value))
})

onMounted(async () => {
  await Promise.all([loadConfigs(), loadChannels(), loadTelegramBindings()])
})

async function loadConfigs() {
  loading.value = true
  try {
    const response = await api.systemConfig.list()
    configs.value = Array.isArray(response.configs) ? response.configs : []

    for (const config of configs.value) {
      if (!(config.key in form.value)) continue

      if (numericConfigKeys.includes(config.key)) {
        ;(form.value as any)[config.key] = parseInt(config.value, 10) || 0
      } else if (floatConfigKeys.includes(config.key)) {
        ;(form.value as any)[config.key] = parseFloat(config.value) || 0
      } else if (booleanConfigKeys.includes(config.key)) {
        ;(form.value as any)[config.key] = config.value === 'true'
      } else if (stringConfigKeys.includes(config.key)) {
        ;(form.value as any)[config.key] = config.value || ''
      }
    }
  } catch (err: any) {
    toast.error(t('telegramConfig.messages.configLoadFailed', { error: err?.message || String(err) }))
    configs.value = []
  } finally {
    loading.value = false
  }
}

async function saveConfigGroup(keys: string[], savingRef: { value: boolean }) {
  savingRef.value = true
  try {
    const configsToUpdate = keys.map(key => ({
      key,
      value: typeof (form.value as any)[key] === 'boolean'
        ? ((form.value as any)[key] ? 'true' : 'false')
        : String((form.value as any)[key])
    }))

    await api.systemConfig.update(configsToUpdate)
    toast.success(t('telegramConfig.messages.saveSuccess'))
    await loadConfigs()
  } catch (err: any) {
    toast.error(t('telegramConfig.messages.saveFailed', { error: err?.message || String(err) }))
  } finally {
    savingRef.value = false
  }
}

async function saveTelegramBot() {
  if (telegramWebhookSecretError.value) {
    toast.error(telegramWebhookSecretError.value)
    return
  }
  if (!['any', 'all'].includes(form.value.telegram_group_join_mode)) {
    toast.error(t('telegramConfig.messages.groupModeInvalid'))
    return
  }
  if (!['any', 'all'].includes(form.value.telegram_vip_group_join_mode)) {
    toast.error(t('telegramConfig.messages.vipGroupModeInvalid'))
    return
  }
  if (form.value.telegram_group_invite_expire_minutes < 1 || form.value.telegram_group_invite_expire_minutes > 10080) {
    toast.error(t('telegramConfig.messages.groupExpiryInvalid'))
    return
  }
  if (form.value.telegram_vip_group_invite_expire_minutes < 1 || form.value.telegram_vip_group_invite_expire_minutes > 10080) {
    toast.error(t('telegramConfig.messages.vipGroupExpiryInvalid'))
    return
  }
  await saveConfigGroup(telegramBotKeys, savingTelegramBot)
}

async function saveFooterTelegramLink() {
  await saveConfigGroup(footerTelegramLinkKeys, savingFooterTelegramLink)
}

function generateTelegramWebhookSecret() {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) {
    toast.error(t('telegramConfig.messages.randomUnsupported'))
    return
  }

  const bytes = new Uint8Array(32)
  cryptoApi.getRandomValues(bytes)
  form.value.telegram_webhook_secret = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  toast.success(t('telegramConfig.messages.secretGenerated'))
}

function getApiErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const apiError = err as { error?: unknown; message?: unknown; description?: unknown }
    if (apiError.error) return String(apiError.error)
    if (apiError.message) return String(apiError.message)
    if (apiError.description) return String(apiError.description)
  }
  return String(err)
}

function formatTelegramWebhookDate(value?: number): string {
  if (!value) return ''
  return new Date(value * 1000).toLocaleString()
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function formatMoney(value: number): string {
  return Number(value || 0).toFixed(2)
}

function formatTelegramName(binding: TelegramAdminBinding): string {
  if (binding.telegramUsername) return `@${binding.telegramUsername}`
  const fullName = [binding.firstName, binding.lastName].filter(Boolean).join(' ')
  return fullName || `ID ${binding.telegramUserId}`
}

function eligibilityLabel(status: TelegramAdminBinding['eligibility']['status']): string {
  switch (status) {
    case 'eligible':
      return t('telegramConfig.eligibility.eligible')
    case 'ineligible':
      return t('telegramConfig.eligibility.ineligible')
    case 'disabled':
      return t('telegramConfig.eligibility.disabled')
    case 'unconfigured':
      return t('telegramConfig.eligibility.unconfigured')
    default:
      return t('telegramConfig.eligibility.unknown')
  }
}

function eligibilityClass(status: TelegramAdminBinding['eligibility']['status']): string {
  switch (status) {
    case 'eligible':
      return 'bg-green-500/20 text-green-400'
    case 'ineligible':
      return 'bg-amber-500/20 text-amber-400'
    default:
      return 'bg-gray-500/20 text-gray-400'
  }
}

function formatGroupRule(group: TelegramAdminBindingsResponse['group'] | null): string {
  if (!group) return t('common.loading')
  if (!group.enabled) return t('telegramConfig.eligibility.disabled')
  if (!group.configured) return t('telegramConfig.groupRule.chatIdMissing')

  const thresholds = [
    group.minRecharge > 0 ? t('telegramConfig.groupRule.recharge', { amount: formatMoney(group.minRecharge) }) : null,
    group.minConsume > 0 ? t('telegramConfig.groupRule.consume', { amount: formatMoney(group.minConsume) }) : null
  ].filter(Boolean)

  if (thresholds.length === 0) {
    return t('telegramConfig.groupRule.noThreshold')
  }

  return t(group.joinMode === 'all' ? 'telegramConfig.groupRule.all' : 'telegramConfig.groupRule.any', { thresholds: thresholds.join(t('telegramConfig.groupRule.separator')) })
}

async function setupTelegramWebhook() {
  settingTelegramWebhook.value = true
  try {
    const response = await api.telegram.setupWebhook({
      baseUrl: getFrontendOrigin()
    })
    toast.success(response.commandsSynced ? t('telegramConfig.messages.webhookCommandsSet') : t('telegramConfig.messages.webhookSet'))
    telegramWebhookInfo.value = {
      ...(telegramWebhookInfo.value || { url: '' }),
      url: response.webhookUrl
    }
    await checkTelegramWebhook(false)
  } catch (err: any) {
    toast.error(t('telegramConfig.messages.webhookSetFailed', { error: getApiErrorMessage(err) }))
  } finally {
    settingTelegramWebhook.value = false
  }
}

async function checkTelegramWebhook(showSuccess = true) {
  checkingTelegramWebhook.value = true
  try {
    const response = await api.telegram.getWebhookInfo()
    telegramWebhookInfo.value = response.info
    if (showSuccess) {
      toast.success(t('telegramConfig.messages.webhookUpdated'))
    }
  } catch (err: any) {
    toast.error(t('telegramConfig.messages.webhookCheckFailed', { error: getApiErrorMessage(err) }))
  } finally {
    checkingTelegramWebhook.value = false
  }
}

async function deleteTelegramWebhook() {
  if (!confirm(t('telegramConfig.messages.webhookDeleteConfirm'))) return

  deletingTelegramWebhook.value = true
  try {
    await api.telegram.deleteWebhook()
    telegramWebhookInfo.value = { url: '' }
    toast.success(t('telegramConfig.messages.webhookDeleted'))
  } catch (err: any) {
    toast.error(t('telegramConfig.messages.webhookDeleteFailed', { error: getApiErrorMessage(err) }))
  } finally {
    deletingTelegramWebhook.value = false
  }
}

async function loadTelegramBindings(page = telegramBindingsPage.value) {
  bindingLoading.value = true
  try {
    const response = await api.telegram.listBindings({
      page,
      pageSize: telegramBindingsPageSize.value,
      search: bindingSearch.value.trim() || undefined
    })
    telegramBindings.value = response.bindings
    telegramBindingsTotal.value = response.total
    telegramBindingsPage.value = response.page
    telegramBindingsPageSize.value = response.pageSize
    telegramBindingGroup.value = response.group
    telegramBindingVipGroup.value = response.vipGroup
  } catch (err: any) {
    toast.error(t('telegramConfig.messages.bindingsLoadFailed', { error: err?.message || String(err) }))
    telegramBindings.value = []
    telegramBindingsTotal.value = 0
    telegramBindingGroup.value = null
    telegramBindingVipGroup.value = null
  } finally {
    bindingLoading.value = false
  }
}

async function searchTelegramBindings() {
  telegramBindingsPage.value = 1
  await loadTelegramBindings(1)
}

async function resetTelegramBindingSearch() {
  bindingSearch.value = ''
  telegramBindingsPage.value = 1
  await loadTelegramBindings(1)
}

async function goTelegramBindingsPage(page: number) {
  if (page < 1 || page > telegramBindingsTotalPages.value || page === telegramBindingsPage.value) return
  await loadTelegramBindings(page)
}

async function unlinkTelegramBinding(binding: TelegramAdminBinding) {
  const userLabel = binding.user?.username || t('telegramConfig.userNumber', { id: binding.userId })
  if (!confirm(t('telegramConfig.messages.unlinkConfirm', { user: userLabel }))) return

  unlinkingBindingId.value = binding.id
  try {
    await api.telegram.unlinkAdminBinding(binding.id)
    toast.success(t('telegramConfig.messages.unlinked'))
    await loadTelegramBindings()
  } catch (err: any) {
    toast.error(t('telegramConfig.messages.unlinkFailed', { error: err?.message || String(err) }))
  } finally {
    unlinkingBindingId.value = null
  }
}

async function loadChannels() {
  channelLoading.value = true
  try {
    const response = await api.adminNotificationChannels.list()
    globalChannels.value = response.channels || []
  } catch {
    globalChannels.value = []
  } finally {
    channelLoading.value = false
  }
}

function openCreateChannelForm() {
  editingChannel.value = null
  channelForm.value = { name: '', botToken: '', chatId: '', enabled: true }
  channelFormError.value = ''
  showChannelForm.value = true
}

async function openEditChannelForm(ch: GlobalChannel) {
  channelFormError.value = ''
  try {
    const response = await api.adminNotificationChannels.get(ch.id)
    const channel = response.channel as any
    const config = channel.config || {}
    const botToken = typeof config.botToken === 'string' ? config.botToken : ''
    const chatId = typeof config.chatId === 'string' ? config.chatId : ''

    editingChannel.value = {
      id: channel.id,
      name: channel.name,
      botToken,
      chatId,
      enabled: channel.enabled
    }
    channelForm.value = {
      name: channel.name,
      botToken,
      chatId,
      enabled: channel.enabled
    }
    showChannelForm.value = true
  } catch {
    toast.error(t('telegramConfig.messages.channelLoadFailed'))
  }
}

async function saveChannel() {
  channelFormError.value = ''
  if (!channelForm.value.name || !channelForm.value.chatId) {
    channelFormError.value = t('telegramConfig.messages.channelFieldsRequired')
    return
  }
  if (!editingChannel.value && !channelForm.value.botToken) {
    channelFormError.value = t('telegramConfig.messages.botTokenRequired')
    return
  }

  savingChannel.value = true
  try {
    if (editingChannel.value) {
      await api.adminNotificationChannels.update(editingChannel.value.id, {
        name: channelForm.value.name,
        chatId: channelForm.value.chatId,
        enabled: channelForm.value.enabled,
        ...(channelForm.value.botToken && !channelForm.value.botToken.includes('...') ? { botToken: channelForm.value.botToken } : {})
      })
      toast.success(t('telegramConfig.messages.channelUpdated'))
    } else {
      await api.adminNotificationChannels.create(channelForm.value)
      toast.success(t('telegramConfig.messages.channelCreated'))
    }
    showChannelForm.value = false
    await loadChannels()
  } catch (err: any) {
    channelFormError.value = err?.message || t('telegramConfig.messages.saveFailedShort')
  } finally {
    savingChannel.value = false
  }
}

async function deleteChannel(id: number) {
  if (!confirm(t('telegramConfig.messages.channelDeleteConfirm'))) return

  deletingChannelId.value = id
  try {
    await api.adminNotificationChannels.delete(id)
    toast.success(t('common.deleteSuccess'))
    await loadChannels()
  } catch (err: any) {
    toast.error(t('telegramConfig.messages.channelDeleteFailed', { error: err?.message || '' }))
  } finally {
    deletingChannelId.value = null
  }
}

async function testChannel(id: number) {
  testingChannelId.value = id
  try {
    await api.adminNotificationChannels.test(id)
    toast.success(t('telegramConfig.messages.testSuccess'))
  } catch (err: any) {
    toast.error(t('telegramConfig.messages.testFailed', { error: err?.message || '' }))
  } finally {
    testingChannelId.value = null
  }
}
</script>

<template>
  <div class="kawaii-page space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('telegramConfig.title') }}</h1>
        <p class="page-description">{{ t('telegramConfig.description') }}</p>
      </div>
    </div>

    <div class="flex gap-1 overflow-x-auto border-b border-themed-border">
      <router-link
        v-for="item in systemSettingsNavigationItems"
        :key="item.path"
        :to="item.path"
        class="shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors duration-150"
        :class="route.path === item.path
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-themed-muted hover:text-themed'"
      >
        {{ t(item.labelKey) }}
      </router-link>
    </div>

    <div v-if="loading" class="card p-6 animate-pulse">
      <div class="h-6 bg-themed-secondary rounded w-1/4 mb-6"></div>
      <div class="space-y-4">
        <div v-for="i in 5" :key="i" class="h-12 bg-themed-secondary rounded"></div>
      </div>
    </div>

    <div v-else class="space-y-6">
      <div class="card p-6">
        <div class="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-themed-border pb-4">
          <div>
            <h3 class="text-sm font-semibold text-themed">{{ t('telegramConfig.footer.title') }}</h3>
            <p class="mt-1 text-sm text-themed-muted">
              {{ t('telegramConfig.footer.description') }}
            </p>
          </div>
          <button
            type="button"
            class="btn-primary btn-sm shrink-0"
            :disabled="!hasFooterTelegramLinkChanges || savingFooterTelegramLink"
            @click="saveFooterTelegramLink"
          >
            {{ savingFooterTelegramLink ? t('common.saving') : t('common.save') }}
          </button>
        </div>
        <div class="max-w-xl space-y-2">
          <label class="block text-sm text-themed-secondary">
            {{ t('telegramConfig.footer.link') }}
          </label>
          <input
            v-model="form.footer_telegram_link"
            type="text"
            class="input"
            placeholder="https://t.me/your_group"
          />
          <p class="text-xs text-themed-muted">
          {{ t('telegramConfig.footer.hint') }}
          </p>
        </div>
      </div>

      <div class="card p-6">
        <div class="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-themed-border pb-4">
          <div>
            <h3 class="text-sm font-semibold text-themed">{{ t('telegramConfig.bot.title') }}</h3>
            <p class="mt-1 text-sm text-themed-muted">
              {{ t('telegramConfig.bot.description') }}
            </p>
          </div>
          <button
            type="button"
            class="btn-primary btn-sm shrink-0"
            :disabled="!hasTelegramBotChanges || savingTelegramBot"
            @click="saveTelegramBot"
          >
            {{ savingTelegramBot ? t('common.saving') : t('common.save') }}
          </button>
        </div>

        <div class="mb-6 flex items-center justify-between gap-4 rounded-xl border border-themed-border bg-themed-secondary/30 p-4">
          <div class="flex-1">
              <label class="text-sm font-medium text-themed">{{ t('telegramConfig.bot.enableBinding') }}</label>
            <p class="text-xs text-themed-muted mt-1">
                {{ t('telegramConfig.bot.disabledHint') }}
            </p>
          </div>
          <div class="flex items-center gap-3 ml-4">
            <span class="text-xs" :class="form.telegram_bot_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
              {{ t('common.close') }}
            </span>
            <button
              type="button"
              role="switch"
              :aria-checked="form.telegram_bot_enabled"
              class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
              :class="[
                form.telegram_bot_enabled
                  ? 'bg-accent focus:ring-accent'
                  : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
              ]"
              @click="form.telegram_bot_enabled = !form.telegram_bot_enabled"
            >
              <span
                class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                :class="form.telegram_bot_enabled ? 'translate-x-5' : 'translate-x-0'"
              />
            </button>
            <span class="text-xs" :class="form.telegram_bot_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
              {{ t('telegramConfig.enabled') }}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-2">
            <label class="block text-sm text-themed-secondary">
              {{ t('telegramConfig.bot.username') }}
            </label>
            <input
              v-model="form.telegram_bot_username"
              type="text"
              class="input"
              placeholder="your_bot_username"
            />
            <p class="text-xs text-themed-muted">{{ t('telegramConfig.bot.usernameHint') }}</p>
          </div>
          <div class="space-y-2">
            <label class="block text-sm text-themed-secondary">
              Bot Token
            </label>
            <input
              v-model="form.telegram_bot_token"
              type="password"
              class="input font-mono"
              placeholder="********"
            />
            <p class="text-xs text-themed-muted">{{ t('telegramConfig.bot.tokenHint') }}</p>
          </div>
          <div class="space-y-2 md:col-span-2">
            <label class="block text-sm text-themed-secondary">
              Webhook Secret
            </label>
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                v-model="form.telegram_webhook_secret"
                type="password"
                class="input flex-1 font-mono"
                placeholder="********"
              />
              <button
                type="button"
                class="btn-secondary btn-sm whitespace-nowrap"
                @click="generateTelegramWebhookSecret"
              >
                {{ t('telegramConfig.bot.generateSecret') }}
              </button>
            </div>
            <p v-if="telegramWebhookSecretError" class="text-xs text-error">
              {{ telegramWebhookSecretError }}
            </p>
            <p class="text-xs text-themed-muted">
              {{ t('telegramConfig.bot.secretHint') }}
            </p>
          </div>
        </div>

        <div class="mt-5 rounded-xl border border-themed-border bg-themed-secondary/30 p-4">
          <p class="text-sm text-themed-muted">
              {{ t('telegramConfig.webhook.address') }}<code class="rounded bg-themed-tertiary px-1.5 py-0.5 font-mono text-xs text-themed">{{ telegramWebhookUrl }}</code>
          </p>
          <p class="text-xs text-themed-muted mt-1">
              {{ t('telegramConfig.webhook.addressHint') }}
          </p>
        </div>

        <div class="mt-4 rounded-xl border border-themed-border bg-themed-secondary/30 p-4">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div>
              <h4 class="text-sm font-medium text-themed">{{ t('telegramConfig.webhook.title') }}</h4>
              <p class="text-xs text-themed-muted mt-1">
                {{ t('telegramConfig.webhook.description') }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn-secondary btn-sm"
                :disabled="!canManageTelegramWebhook || settingTelegramWebhook"
                @click="setupTelegramWebhook"
              >
                {{ settingTelegramWebhook ? t('telegramConfig.webhook.setting') : t('telegramConfig.webhook.setup') }}
              </button>
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="!form.telegram_bot_token || checkingTelegramWebhook"
                @click="() => checkTelegramWebhook()"
              >
                {{ checkingTelegramWebhook ? t('telegramConfig.webhook.checking') : t('telegramConfig.webhook.check') }}
              </button>
              <button
                type="button"
                class="btn-ghost btn-sm text-error"
                :disabled="!form.telegram_bot_token || deletingTelegramWebhook"
                @click="deleteTelegramWebhook"
              >
                {{ deletingTelegramWebhook ? t('common.deleting') : t('telegramConfig.webhook.delete') }}
              </button>
            </div>
          </div>

          <div v-if="telegramWebhookInfo" class="space-y-2 text-xs text-themed-muted">
            <p>
                {{ t('telegramConfig.webhook.currentAddress') }}
                <span class="text-themed break-all font-mono">{{ telegramWebhookInfo.url || t('common.notSet') }}</span>
            </p>
              <p>{{ t('telegramConfig.webhook.pendingUpdates', { count: telegramWebhookInfo.pending_update_count ?? 0 }) }}</p>
            <p v-if="telegramWebhookInfo.max_connections">
                {{ t('telegramConfig.webhook.maxConnections', { count: telegramWebhookInfo.max_connections }) }}
            </p>
            <p v-if="telegramWebhookInfo.allowed_updates?.length">
                {{ t('telegramConfig.webhook.allowedUpdates', { updates: telegramWebhookInfo.allowed_updates.join(', ') }) }}
            </p>
            <p v-if="telegramWebhookInfo.last_error_message" class="text-error">
                {{ t('telegramConfig.webhook.lastError', { error: telegramWebhookInfo.last_error_message }) }}
              <span v-if="telegramWebhookInfo.last_error_date">
                （{{ formatTelegramWebhookDate(telegramWebhookInfo.last_error_date) }}）
              </span>
            </p>
          </div>
        </div>

        <div class="mt-4 rounded-xl border border-themed-border bg-themed-secondary/30 p-4">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div>
              <h4 class="text-sm font-medium text-themed">{{ t('telegramConfig.group.title') }}</h4>
              <p class="text-xs text-themed-muted mt-1">
                {{ t('telegramConfig.group.description') }}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs" :class="form.telegram_group_join_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                {{ t('common.close') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.telegram_group_join_enabled"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.telegram_group_join_enabled
                    ? 'bg-accent focus:ring-accent'
                    : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                ]"
                @click="form.telegram_group_join_enabled = !form.telegram_group_join_enabled"
              >
                <span
                  class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                  :class="form.telegram_group_join_enabled ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
              <span class="text-xs" :class="form.telegram_group_join_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                {{ t('telegramConfig.enabled') }}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.group.chatId') }}
              </label>
              <input
                v-model="form.telegram_group_chat_id"
                type="text"
                class="input font-mono"
                placeholder="-1001234567890"
              />
              <p class="text-xs text-themed-muted">
                {{ t('telegramConfig.group.chatIdHint') }}
              </p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.group.thresholdMode') }}
              </label>
              <select v-model="form.telegram_group_join_mode" class="input">
                <option value="any">{{ t('telegramConfig.group.modeAny') }}</option>
                <option value="all">{{ t('telegramConfig.group.modeAll') }}</option>
              </select>
              <p class="text-xs text-themed-muted">
                {{ t('telegramConfig.group.thresholdHint') }}
              </p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.group.rechargeThreshold') }}
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                <input
                  v-model.number="form.telegram_group_min_recharge"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input pl-8 tabular-nums"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.group.consumeThreshold') }}
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                <input
                  v-model.number="form.telegram_group_min_consume"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input pl-8 tabular-nums"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div class="space-y-2 md:col-span-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.group.inviteExpiry') }}
              </label>
              <div class="relative max-w-xs">
                <input
                  v-model.number="form.telegram_group_invite_expire_minutes"
                  type="number"
                  min="1"
                  max="10080"
                  step="1"
                  class="input pr-16 tabular-nums"
                  placeholder="30"
                />
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">
                  {{ t('telegramConfig.minutes') }}
                </span>
              </div>
              <p class="text-xs text-themed-muted">
                {{ t('telegramConfig.group.inviteHint') }}
              </p>
            </div>
          </div>
        </div>

        <div class="mt-4 rounded-xl border border-themed-border bg-themed-secondary/30 p-4">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div>
              <h4 class="text-sm font-medium text-themed">{{ t('telegramConfig.vipGroup.title') }}</h4>
              <p class="text-xs text-themed-muted mt-1">
                {{ t('telegramConfig.vipGroup.description') }}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs" :class="form.telegram_vip_group_join_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                {{ t('common.close') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.telegram_vip_group_join_enabled"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.telegram_vip_group_join_enabled
                    ? 'bg-accent focus:ring-accent'
                    : 'bg-gray-400 dark:bg-gray-500 focus:ring-gray-400'
                ]"
                @click="form.telegram_vip_group_join_enabled = !form.telegram_vip_group_join_enabled"
              >
                <span
                  class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                  :class="form.telegram_vip_group_join_enabled ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
              <span class="text-xs" :class="form.telegram_vip_group_join_enabled ? 'text-themed font-medium' : 'text-themed-muted'">
                {{ t('telegramConfig.enabled') }}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.vipGroup.chatId') }}
              </label>
              <input
                v-model="form.telegram_vip_group_chat_id"
                type="text"
                class="input font-mono"
                placeholder="-1001234567890"
              />
              <p class="text-xs text-themed-muted">
                {{ t('telegramConfig.vipGroup.chatIdHint') }}
              </p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.group.thresholdMode') }}
              </label>
              <select v-model="form.telegram_vip_group_join_mode" class="input">
                <option value="any">{{ t('telegramConfig.group.modeAny') }}</option>
                <option value="all">{{ t('telegramConfig.group.modeAll') }}</option>
              </select>
              <p class="text-xs text-themed-muted">
                {{ t('telegramConfig.vipGroup.thresholdHint') }}
              </p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.group.rechargeThreshold') }}
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                <input
                  v-model.number="form.telegram_vip_group_min_recharge"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input pl-8 tabular-nums"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.group.consumeThreshold') }}
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                <input
                  v-model.number="form.telegram_vip_group_min_consume"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input pl-8 tabular-nums"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div class="space-y-2 md:col-span-2">
              <label class="block text-sm text-themed-secondary">
                {{ t('telegramConfig.group.inviteExpiry') }}
              </label>
              <div class="relative max-w-xs">
                <input
                  v-model.number="form.telegram_vip_group_invite_expire_minutes"
                  type="number"
                  min="1"
                  max="10080"
                  step="1"
                  class="input pr-16 tabular-nums"
                  placeholder="30"
                />
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">
                  {{ t('telegramConfig.minutes') }}
                </span>
              </div>
              <p class="text-xs text-themed-muted">
                {{ t('telegramConfig.vipGroup.inviteHint') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="card p-4">
        <div class="flex flex-col gap-3 border-b border-themed-border pb-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 class="text-sm font-semibold text-themed">{{ t('telegramConfig.bindings.title') }}</h3>
            <p class="text-sm text-themed-muted mt-1">
              {{ t('telegramConfig.bindings.description') }}
            </p>
          </div>
          <button
            type="button"
            class="btn-secondary btn-sm shrink-0"
            :disabled="bindingLoading"
            @click="() => loadTelegramBindings()"
          >
            {{ bindingLoading ? t('telegramConfig.bindings.refreshing') : t('telegramConfig.bindings.refresh') }}
          </button>
        </div>

        <div class="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            v-model="bindingSearch"
            type="search"
            class="input flex-1 text-sm"
            :placeholder="t('telegramConfig.bindings.searchPlaceholder')"
            @keyup.enter="searchTelegramBindings"
          />
          <button
            type="button"
            class="btn-primary btn-sm"
            :disabled="bindingLoading"
            @click="searchTelegramBindings"
          >
            {{ t('common.search') }}
          </button>
          <button
            type="button"
            class="btn-ghost btn-sm"
            :disabled="bindingLoading || !bindingSearch"
            @click="resetTelegramBindingSearch"
          >
            {{ t('telegramConfig.bindings.clear') }}
          </button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3 text-xs">
          <div class="p-3 rounded-lg bg-themed-secondary/30 border border-themed-border">
            <div class="text-themed font-medium">{{ t('telegramConfig.bindings.groupThreshold') }}</div>
            <div class="text-themed-muted mt-1">{{ formatGroupRule(telegramBindingGroup) }}</div>
          </div>
          <div class="p-3 rounded-lg bg-themed-secondary/30 border border-themed-border">
            <div class="text-themed font-medium">{{ t('telegramConfig.bindings.vipGroupThreshold') }}</div>
            <div class="text-themed-muted mt-1">{{ formatGroupRule(telegramBindingVipGroup) }}</div>
          </div>
        </div>

        <div v-if="bindingLoading" class="text-sm text-themed-muted p-3 rounded-lg bg-themed-secondary/30">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="telegramBindings.length === 0" class="flex flex-col items-center gap-2 rounded-lg bg-themed-secondary/30 px-4 py-8 text-center">
          <span class="flex h-10 w-10 items-center justify-center rounded-full bg-themed-tertiary text-themed-muted">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
            </svg>
          </span>
          <p class="text-sm text-themed-muted">{{ t('telegramConfig.bindings.empty') }}</p>
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="binding in telegramBindings"
            :key="binding.id"
            class="p-3 rounded-lg bg-themed-secondary/30 border border-themed-border"
          >
            <div class="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium text-themed">
                    {{ binding.user?.username || t('telegramConfig.userNumber', { id: binding.userId }) }}
                  </span>
                  <span
                    v-if="binding.user"
                    class="text-xs px-1.5 py-0.5 rounded-full"
                    :class="binding.user.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-rose-500/20 text-rose-400'"
                  >
                    {{ binding.user.status === 'active' ? t('telegramConfig.bindings.active') : t('telegramConfig.bindings.banned') }}
                  </span>
                  <span class="text-xs text-themed-muted">{{ t('telegramConfig.bindings.userId', { id: binding.userId }) }}</span>
                  <span class="text-xs text-themed-muted font-mono">Telegram {{ formatTelegramName(binding) }}</span>
                  <span class="text-xs text-themed-muted font-mono">ID {{ binding.telegramUserId }}</span>
                </div>
                <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-themed-muted">
                  <span v-if="binding.user?.email" class="break-all">{{ binding.user.email }}</span>
                  <span class="tabular-nums">{{ t('telegramConfig.bindings.recharge', { amount: formatMoney(binding.stats.totalRecharge) }) }}</span>
                  <span class="tabular-nums">{{ t('telegramConfig.bindings.consume', { amount: formatMoney(binding.stats.totalConsume) }) }}</span>
                  <span>{{ t('telegramConfig.bindings.boundAt', { time: formatDate(binding.boundAt) }) }}</span>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2 xl:ml-4 xl:justify-end">
                <span
                  class="text-xs px-2 py-1 rounded-full"
                  :class="eligibilityClass(binding.eligibility.status)"
                >
                  {{ t('telegramConfig.bindings.normal') }}{{ eligibilityLabel(binding.eligibility.status) }}
                </span>
                <span
                  class="text-xs px-2 py-1 rounded-full"
                  :class="eligibilityClass(binding.vipEligibility.status)"
                >
                  {{ t('telegramConfig.bindings.vip') }}{{ eligibilityLabel(binding.vipEligibility.status) }}
                </span>
                <button
                  type="button"
                  class="text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
                  :disabled="unlinkingBindingId === binding.id"
                  @click="unlinkTelegramBinding(binding)"
                >
                  {{ unlinkingBindingId === binding.id ? t('telegramConfig.bindings.unlinking') : t('telegramConfig.bindings.unlink') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="telegramBindingsTotal > 0"
          class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-themed-muted"
        >
          <span>
            {{ t('telegramConfig.bindings.pagination', { total: telegramBindingsTotal, page: telegramBindingsPage, totalPages: telegramBindingsTotalPages }) }}
          </span>
          <div class="flex gap-2">
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="bindingLoading || telegramBindingsPage <= 1"
              @click="goTelegramBindingsPage(telegramBindingsPage - 1)"
            >
              {{ t('common.prevPage') }}
            </button>
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="bindingLoading || telegramBindingsPage >= telegramBindingsTotalPages"
              @click="goTelegramBindingsPage(telegramBindingsPage + 1)"
            >
              {{ t('common.nextPage') }}
            </button>
          </div>
        </div>
      </div>

      <div class="card p-6">
        <div class="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-themed-border pb-4">
          <div>
            <h3 class="text-sm font-semibold text-themed">{{ t('telegramConfig.channels.title') }}</h3>
            <p class="mt-1 text-sm text-themed-muted">{{ t('telegramConfig.channels.description') }}</p>
          </div>
          <button type="button" class="btn-primary btn-sm shrink-0" @click="openCreateChannelForm">{{ t('telegramConfig.channels.add') }}</button>
        </div>

        <div v-if="channelLoading" class="text-sm text-themed-muted">{{ t('common.loading') }}</div>
        <div v-else-if="globalChannels.length === 0" class="flex flex-col items-center gap-2 rounded-lg bg-themed-secondary/30 px-4 py-8 text-center">
          <span class="flex h-10 w-10 items-center justify-center rounded-full bg-themed-tertiary text-themed-muted">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
          </span>
          <p class="text-sm text-themed-muted">{{ t('telegramConfig.channels.empty') }}</p>
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="ch in globalChannels"
            :key="ch.id"
            class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-3 rounded-lg bg-themed-secondary/30 border border-themed-border"
          >
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-sm text-themed">{{ ch.name }}</span>
                <span
                  class="text-xs px-1.5 py-0.5 rounded-full"
                  :class="ch.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'"
                >
                  {{ ch.enabled ? t('telegramConfig.channels.enabled') : t('telegramConfig.channels.disabled') }}
                </span>
                <span class="text-xs text-themed-muted">{{ t('telegramConfig.channels.boundPackages', { count: ch.boundPackages }) }}</span>
              </div>
              <p class="text-xs text-themed-muted mt-0.5 font-mono">{{ ch.configPreview }}</p>
            </div>
            <div class="flex items-center gap-2 md:ml-4">
              <button
                type="button"
                class="text-xs text-themed-muted hover:text-themed"
                :disabled="testingChannelId === ch.id"
                @click="testChannel(ch.id)"
              >
                {{ testingChannelId === ch.id ? t('common.sending') : t('telegramConfig.channels.test') }}
              </button>
              <button type="button" class="text-xs text-themed-muted hover:text-themed" @click="openEditChannelForm(ch)">{{ t('common.edit') }}</button>
              <button
                type="button"
                class="text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
                :disabled="deletingChannelId === ch.id"
                @click="deleteChannel(ch.id)"
              >
                {{ deletingChannelId === ch.id ? t('common.deleting') : t('common.delete') }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="showChannelForm" class="mt-4 p-4 rounded-lg border border-themed-border bg-themed-secondary/20 space-y-3">
          <h4 class="font-medium text-sm text-themed">{{ editingChannel ? t('telegramConfig.channels.edit') : t('telegramConfig.channels.new') }}</h4>
          <div v-if="channelFormError" class="text-xs text-rose-600 dark:text-rose-400">{{ channelFormError }}</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="block text-xs text-themed-muted">{{ t('telegramConfig.channels.name') }} *</label>
              <input v-model="channelForm.name" type="text" class="input" :placeholder="t('telegramConfig.channels.namePlaceholder')" />
            </div>
            <div class="space-y-1">
              <label class="block text-xs text-themed-muted">Chat ID *</label>
              <input v-model="channelForm.chatId" type="text" class="input font-mono" :placeholder="t('telegramConfig.channels.chatIdPlaceholder')" />
              <p class="text-xs text-themed-muted">{{ t('telegramConfig.channels.chatIdHint') }}</p>
            </div>
            <div class="md:col-span-2 space-y-1">
              <label class="block text-xs text-themed-muted">Bot Token {{ editingChannel ? t('telegramConfig.channels.keepUnchanged') : '*' }}</label>
              <input v-model="channelForm.botToken" type="password" class="input font-mono" :placeholder="t('telegramConfig.channels.tokenPlaceholder')" />
            </div>
            <div class="md:col-span-2 flex items-center gap-2">
              <input id="telegramChannelEnabled" v-model="channelForm.enabled" type="checkbox" class="w-4 h-4 rounded" />
              <label for="telegramChannelEnabled" class="text-sm text-themed-secondary">{{ t('telegramConfig.channels.enable') }}</label>
            </div>
          </div>
          <div class="flex gap-2 justify-end">
            <button type="button" class="btn-secondary text-sm" @click="showChannelForm = false">{{ t('common.cancel') }}</button>
            <button type="button" class="btn-primary text-sm" :disabled="savingChannel" @click="saveChannel">
              {{ savingChannel ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </div>

        <div class="mt-4 p-3 rounded-lg bg-themed-secondary/30 border border-themed-border">
          <p class="text-sm text-themed-muted">
            {{ t('telegramConfig.channels.needToken') }}
            <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" class="underline hover:text-themed">@BotFather</a>
            {{ t('telegramConfig.channels.botFatherHint') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  transition: border-color 0.15s ease-out, box-shadow 0.15s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .card {
    transition: none;
  }

  .animate-fade-in {
    animation: none;
  }
}
</style>
