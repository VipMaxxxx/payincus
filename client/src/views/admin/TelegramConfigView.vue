<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import type { TelegramAdminBinding, TelegramAdminBindingsResponse } from '@/types/api'
import { systemSettingsNavigationItems } from '@/constants/adminSettings'

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

const currentSiteOrigin = computed(() => {
  if (typeof window === 'undefined') {
    return ''
  }
  return window.location.origin
})

const telegramWebhookUrl = computed(() => {
  if (!currentSiteOrigin.value) {
    return '/api/telegram/webhook'
  }
  return `${currentSiteOrigin.value}/api/telegram/webhook`
})

const telegramWebhookSecretError = computed(() => {
  const value = form.value.telegram_webhook_secret
  if (!value || value === maskedSecretPlaceholder) {
    return ''
  }
  return telegramWebhookSecretPattern.test(value)
    ? ''
    : 'Webhook Secret 只能包含字母、数字、下划线和连字符，长度 1-256。'
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
    toast.error('加载 Telegram 配置失败: ' + (err?.message || String(err)))
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
    toast.success('保存成功')
    await loadConfigs()
  } catch (err: any) {
    toast.error('保存失败: ' + (err?.message || String(err)))
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
    toast.error('普通群入群门槛模式无效')
    return
  }
  if (!['any', 'all'].includes(form.value.telegram_vip_group_join_mode)) {
    toast.error('高级群入群门槛模式无效')
    return
  }
  if (form.value.telegram_group_invite_expire_minutes < 1 || form.value.telegram_group_invite_expire_minutes > 10080) {
    toast.error('普通群邀请链接有效期必须在 1 到 10080 分钟之间')
    return
  }
  if (form.value.telegram_vip_group_invite_expire_minutes < 1 || form.value.telegram_vip_group_invite_expire_minutes > 10080) {
    toast.error('高级群邀请链接有效期必须在 1 到 10080 分钟之间')
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
    toast.error('当前浏览器不支持安全随机数生成，请使用 openssl rand -hex 32 手动生成。')
    return
  }

  const bytes = new Uint8Array(32)
  cryptoApi.getRandomValues(bytes)
  form.value.telegram_webhook_secret = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  toast.success('Webhook Secret 已生成，请保存 Telegram 配置。')
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
  return new Date(value * 1000).toLocaleString('zh-CN')
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
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
      return '已达标'
    case 'ineligible':
      return '未达标'
    case 'disabled':
      return '未启用'
    case 'unconfigured':
      return '未配置'
    default:
      return '未知'
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
  if (!group) return '加载中'
  if (!group.enabled) return '未启用'
  if (!group.configured) return '未配置 Chat ID'

  const thresholds = [
    group.minRecharge > 0 ? `累计充值 ¥${formatMoney(group.minRecharge)}` : null,
    group.minConsume > 0 ? `累计消费 ¥${formatMoney(group.minConsume)}` : null
  ].filter(Boolean)

  if (thresholds.length === 0) {
    return '无金额门槛'
  }

  return `${group.joinMode === 'all' ? '同时满足' : '满足任一'}：${thresholds.join('；')}`
}

async function setupTelegramWebhook() {
  settingTelegramWebhook.value = true
  try {
    const response = await api.telegram.setupWebhook({
      baseUrl: currentSiteOrigin.value || undefined
    })
    toast.success(response.commandsSynced ? 'Telegram Webhook 和机器人指令已设置' : 'Telegram Webhook 已设置')
    telegramWebhookInfo.value = {
      ...(telegramWebhookInfo.value || { url: '' }),
      url: response.webhookUrl
    }
    await checkTelegramWebhook(false)
  } catch (err: any) {
    toast.error('设置 Telegram Webhook 失败: ' + getApiErrorMessage(err))
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
      toast.success('Telegram Webhook 状态已更新')
    }
  } catch (err: any) {
    toast.error('检查 Telegram Webhook 失败: ' + getApiErrorMessage(err))
  } finally {
    checkingTelegramWebhook.value = false
  }
}

async function deleteTelegramWebhook() {
  if (!confirm('确定删除 Telegram Webhook？删除后机器人将不再把消息回调到本站。')) return

  deletingTelegramWebhook.value = true
  try {
    await api.telegram.deleteWebhook()
    telegramWebhookInfo.value = { url: '' }
    toast.success('Telegram Webhook 已删除')
  } catch (err: any) {
    toast.error('删除 Telegram Webhook 失败: ' + getApiErrorMessage(err))
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
    toast.error('加载 Telegram 绑定用户失败: ' + (err?.message || String(err)))
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
  const userLabel = binding.user?.username || `用户 #${binding.userId}`
  if (!confirm(`确定解除 ${userLabel} 的 Telegram 绑定？解除后该用户需要重新绑定后才能申请入群。`)) return

  unlinkingBindingId.value = binding.id
  try {
    await api.telegram.unlinkAdminBinding(binding.id)
    toast.success('Telegram 绑定已解除')
    await loadTelegramBindings()
  } catch (err: any) {
    toast.error('解除绑定失败: ' + (err?.message || String(err)))
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
    toast.error('加载渠道失败')
  }
}

async function saveChannel() {
  channelFormError.value = ''
  if (!channelForm.value.name || !channelForm.value.chatId) {
    channelFormError.value = '请填写渠道名称和 Chat ID'
    return
  }
  if (!editingChannel.value && !channelForm.value.botToken) {
    channelFormError.value = '请填写 Bot Token'
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
      toast.success('渠道已更新')
    } else {
      await api.adminNotificationChannels.create(channelForm.value)
      toast.success('渠道已创建')
    }
    showChannelForm.value = false
    await loadChannels()
  } catch (err: any) {
    channelFormError.value = err?.message || '保存失败'
  } finally {
    savingChannel.value = false
  }
}

async function deleteChannel(id: number) {
  if (!confirm('确定删除该渠道？将同时解绑所有绑定此渠道的套餐。')) return

  deletingChannelId.value = id
  try {
    await api.adminNotificationChannels.delete(id)
    toast.success('删除成功')
    await loadChannels()
  } catch (err: any) {
    toast.error('删除失败: ' + (err?.message || ''))
  } finally {
    deletingChannelId.value = null
  }
}

async function testChannel(id: number) {
  testingChannelId.value = id
  try {
    await api.adminNotificationChannels.test(id)
    toast.success('测试消息发送成功')
  } catch (err: any) {
    toast.error('测试失败: ' + (err?.message || ''))
  } finally {
    testingChannelId.value = null
  }
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">Telegram 设置</h1>
        <p class="page-description">集中管理网站专用机器人、Webhook、入群申请和全局通知渠道。</p>
      </div>
    </div>

    <div class="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
      <router-link
        v-for="item in systemSettingsNavigationItems"
        :key="item.path"
        :to="item.path"
        class="shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors"
        :class="route.path === item.path
          ? 'border-black dark:border-white text-gray-900 dark:text-white'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
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
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-themed font-medium">站点 Telegram 入口</h3>
          <button
            type="button"
            class="btn-primary text-sm px-4 py-1.5"
            :disabled="!hasFooterTelegramLinkChanges || savingFooterTelegramLink"
            @click="saveFooterTelegramLink"
          >
            {{ savingFooterTelegramLink ? '保存中...' : '保存' }}
          </button>
        </div>
        <p class="text-sm text-themed-muted mb-6">
          配置侧边栏底部 Telegram 群按钮。留空后隐藏该按钮。
        </p>
        <div class="space-y-2">
          <label class="block text-sm text-themed-secondary">
            Telegram 群链接
          </label>
          <input
            v-model="form.footer_telegram_link"
            type="text"
            class="input"
            placeholder="https://t.me/your_group"
          />
          <p class="text-xs text-themed-muted">
            这是网站展示入口，不影响机器人绑定、Webhook 或入群申请逻辑。
          </p>
        </div>
      </div>

      <div class="card p-6">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-themed font-medium">Telegram 专用机器人</h3>
          <button
            type="button"
            class="btn-primary text-sm px-4 py-1.5"
            :disabled="!hasTelegramBotChanges || savingTelegramBot"
            @click="saveTelegramBot"
          >
            {{ savingTelegramBot ? '保存中...' : '保存' }}
          </button>
        </div>
        <p class="text-sm text-themed-muted mb-6">
          配置网站配套 Bot，用于用户 Telegram 账号绑定和后续私有群准入。
        </p>

        <div class="flex items-center justify-between p-4 rounded-lg bg-themed-secondary/50 mb-6">
          <div class="flex-1">
            <label class="text-sm font-medium text-themed">启用绑定机器人</label>
            <p class="text-xs text-themed-muted mt-1">
              关闭后用户个人设置页会显示未启用，不允许生成绑定链接。
            </p>
          </div>
          <div class="flex items-center gap-3 ml-4">
            <span class="text-xs" :class="form.telegram_bot_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
              关闭
            </span>
            <button
              type="button"
              role="switch"
              :aria-checked="form.telegram_bot_enabled"
              class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
              :class="[
                form.telegram_bot_enabled
                  ? 'bg-green-500 focus:ring-green-500'
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
              启用
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-2">
            <label class="block text-sm text-themed-secondary">
              Bot 用户名
            </label>
            <input
              v-model="form.telegram_bot_username"
              type="text"
              class="input"
              placeholder="your_bot_username"
            />
            <p class="text-xs text-themed-muted">不需要填写 @，用于生成 https://t.me/... 绑定链接。</p>
          </div>
          <div class="space-y-2">
            <label class="block text-sm text-themed-secondary">
              Bot Token
            </label>
            <input
              v-model="form.telegram_bot_token"
              type="password"
              class="input"
              placeholder="********"
            />
            <p class="text-xs text-themed-muted">由 BotFather 分配，保存后只会显示为占位符。</p>
          </div>
          <div class="space-y-2 md:col-span-2">
            <label class="block text-sm text-themed-secondary">
              Webhook Secret
            </label>
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                v-model="form.telegram_webhook_secret"
                type="password"
                class="input flex-1"
                placeholder="********"
              />
              <button
                type="button"
                class="btn-secondary text-sm px-4 py-2 whitespace-nowrap"
                @click="generateTelegramWebhookSecret"
              >
                自动生成 Secret
              </button>
            </div>
            <p v-if="telegramWebhookSecretError" class="text-xs text-error">
              {{ telegramWebhookSecretError }}
            </p>
            <p class="text-xs text-themed-muted">
              必填。自动生成会覆盖当前输入，保存配置后生效；也可用 openssl rand -hex 32 手动生成。
            </p>
          </div>
        </div>

        <div class="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p class="text-sm text-blue-400">
            Webhook 地址：<code class="px-1 py-0.5 rounded bg-black/20">{{ telegramWebhookUrl }}</code>
          </p>
          <p class="text-xs text-blue-400/80 mt-1">
            按当前访问域名动态生成；点击“设置 Webhook”时会使用该地址。
          </p>
        </div>

        <div class="mt-4 p-4 rounded-lg bg-themed-secondary/40 border border-themed">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div>
              <h4 class="text-sm font-medium text-themed">Webhook 管理</h4>
              <p class="text-xs text-themed-muted mt-1">
                保存 Bot Token 和 Webhook Secret 后，可由系统自动设置回调并同步机器人指令菜单。
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn-secondary text-sm px-3 py-1.5"
                :disabled="!canManageTelegramWebhook || settingTelegramWebhook"
                @click="setupTelegramWebhook"
              >
                {{ settingTelegramWebhook ? '设置中' : '设置 Webhook' }}
              </button>
              <button
                type="button"
                class="btn-ghost text-sm px-3 py-1.5"
                :disabled="!form.telegram_bot_token || checkingTelegramWebhook"
                @click="() => checkTelegramWebhook()"
              >
                {{ checkingTelegramWebhook ? '检查中' : '检查 Webhook' }}
              </button>
              <button
                type="button"
                class="btn-ghost text-sm px-3 py-1.5 text-error"
                :disabled="!form.telegram_bot_token || deletingTelegramWebhook"
                @click="deleteTelegramWebhook"
              >
                {{ deletingTelegramWebhook ? '删除中' : '删除 Webhook' }}
              </button>
            </div>
          </div>

          <div v-if="telegramWebhookInfo" class="space-y-2 text-xs text-themed-muted">
            <p>
              当前地址：
              <span class="text-themed break-all">{{ telegramWebhookInfo.url || '未设置' }}</span>
            </p>
            <p>待处理更新：{{ telegramWebhookInfo.pending_update_count ?? 0 }}</p>
            <p v-if="telegramWebhookInfo.max_connections">
              最大连接数：{{ telegramWebhookInfo.max_connections }}
            </p>
            <p v-if="telegramWebhookInfo.allowed_updates?.length">
              允许更新：{{ telegramWebhookInfo.allowed_updates.join(', ') }}
            </p>
            <p v-if="telegramWebhookInfo.last_error_message" class="text-error">
              最近错误：{{ telegramWebhookInfo.last_error_message }}
              <span v-if="telegramWebhookInfo.last_error_date">
                （{{ formatTelegramWebhookDate(telegramWebhookInfo.last_error_date) }}）
              </span>
            </p>
          </div>
        </div>

        <div class="mt-4 p-4 rounded-lg bg-themed-secondary/40 border border-themed">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div>
              <h4 class="text-sm font-medium text-themed">普通用户群入群申请</h4>
              <p class="text-xs text-themed-muted mt-1">
                用户绑定 Telegram 后，私聊机器人发送 /join。达标时机器人返回普通群一次性邀请链接。
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs" :class="form.telegram_group_join_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                关闭
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.telegram_group_join_enabled"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.telegram_group_join_enabled
                    ? 'bg-green-500 focus:ring-green-500'
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
                启用
              </span>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                普通群 Chat ID
              </label>
              <input
                v-model="form.telegram_group_chat_id"
                type="text"
                class="input"
                placeholder="-1001234567890"
              />
              <p class="text-xs text-themed-muted">
                Bot 必须是该私有群管理员，并拥有创建邀请链接权限。
              </p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                门槛模式
              </label>
              <select v-model="form.telegram_group_join_mode" class="input">
                <option value="any">累计充值或累计消费，任一达标</option>
                <option value="all">累计充值和累计消费，同时达标</option>
              </select>
              <p class="text-xs text-themed-muted">
                门槛为 0 表示该项不参与判断。
              </p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                累计充值门槛
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                <input
                  v-model.number="form.telegram_group_min_recharge"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input pl-8"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                累计消费门槛
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                <input
                  v-model.number="form.telegram_group_min_consume"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input pl-8"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div class="space-y-2 md:col-span-2">
              <label class="block text-sm text-themed-secondary">
                邀请链接有效期
              </label>
              <div class="relative max-w-xs">
                <input
                  v-model.number="form.telegram_group_invite_expire_minutes"
                  type="number"
                  min="1"
                  max="10080"
                  step="1"
                  class="input pr-16"
                  placeholder="30"
                />
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">
                  分钟
                </span>
              </div>
              <p class="text-xs text-themed-muted">
                每次申请生成一个 member_limit=1 的一次性邀请链接。
              </p>
            </div>
          </div>
        </div>

        <div class="mt-4 p-4 rounded-lg bg-themed-secondary/40 border border-themed">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div>
              <h4 class="text-sm font-medium text-themed">高级用户群入群申请</h4>
              <p class="text-xs text-themed-muted mt-1">
                用户绑定 Telegram 后，私聊机器人发送 /join_vip。达标时机器人返回高级群一次性邀请链接。
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs" :class="form.telegram_vip_group_join_enabled ? 'text-themed-muted' : 'text-themed font-medium'">
                关闭
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.telegram_vip_group_join_enabled"
                class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="[
                  form.telegram_vip_group_join_enabled
                    ? 'bg-green-500 focus:ring-green-500'
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
                启用
              </span>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                高级群 Chat ID
              </label>
              <input
                v-model="form.telegram_vip_group_chat_id"
                type="text"
                class="input"
                placeholder="-1001234567890"
              />
              <p class="text-xs text-themed-muted">
                可以和普通群不同；Bot 必须是该群管理员，并拥有创建邀请链接权限。
              </p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                门槛模式
              </label>
              <select v-model="form.telegram_vip_group_join_mode" class="input">
                <option value="any">累计充值或累计消费，任一达标</option>
                <option value="all">累计充值和累计消费，同时达标</option>
              </select>
              <p class="text-xs text-themed-muted">
                高级群默认建议使用更高门槛，门槛为 0 表示该项不参与判断。
              </p>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                累计充值门槛
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                <input
                  v-model.number="form.telegram_vip_group_min_recharge"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input pl-8"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div class="space-y-2">
              <label class="block text-sm text-themed-secondary">
                累计消费门槛
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">¥</span>
                <input
                  v-model.number="form.telegram_vip_group_min_consume"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input pl-8"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div class="space-y-2 md:col-span-2">
              <label class="block text-sm text-themed-secondary">
                邀请链接有效期
              </label>
              <div class="relative max-w-xs">
                <input
                  v-model.number="form.telegram_vip_group_invite_expire_minutes"
                  type="number"
                  min="1"
                  max="10080"
                  step="1"
                  class="input pr-16"
                  placeholder="30"
                />
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-themed-muted">
                  分钟
                </span>
              </div>
              <p class="text-xs text-themed-muted">
                每次申请生成一个 member_limit=1 的高级群一次性邀请链接。
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="card p-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-3">
          <div>
            <h3 class="text-themed font-medium">绑定用户与入群资格</h3>
            <p class="text-sm text-themed-muted mt-1">
              查看已绑定 Telegram 的站内用户、累计充值/消费和当前入群资格，可人工解除异常绑定。
            </p>
          </div>
          <button
            type="button"
            class="btn-secondary text-xs px-3 py-1.5"
            :disabled="bindingLoading"
            @click="() => loadTelegramBindings()"
          >
            {{ bindingLoading ? '刷新中...' : '刷新列表' }}
          </button>
        </div>

        <div class="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            v-model="bindingSearch"
            type="search"
            class="input flex-1 text-sm"
            placeholder="搜索站内用户名、邮箱、用户 ID、Telegram ID 或用户名"
            @keyup.enter="searchTelegramBindings"
          />
          <button
            type="button"
            class="btn-primary text-xs px-3 py-2"
            :disabled="bindingLoading"
            @click="searchTelegramBindings"
          >
            搜索
          </button>
          <button
            type="button"
            class="btn-ghost text-xs px-3 py-2"
            :disabled="bindingLoading || !bindingSearch"
            @click="resetTelegramBindingSearch"
          >
            清空
          </button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3 text-xs">
          <div class="p-3 rounded-lg bg-themed-secondary/30 border border-themed-border">
            <div class="text-themed font-medium">普通群门槛</div>
            <div class="text-themed-muted mt-1">{{ formatGroupRule(telegramBindingGroup) }}</div>
          </div>
          <div class="p-3 rounded-lg bg-themed-secondary/30 border border-themed-border">
            <div class="text-themed font-medium">高级群门槛</div>
            <div class="text-themed-muted mt-1">{{ formatGroupRule(telegramBindingVipGroup) }}</div>
          </div>
        </div>

        <div v-if="bindingLoading" class="text-sm text-themed-muted p-3 rounded-lg bg-themed-secondary/30">
          加载中...
        </div>
        <div v-else-if="telegramBindings.length === 0" class="text-sm text-themed-muted p-3 rounded-lg bg-themed-secondary/30">
          暂无 Telegram 绑定用户。
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
                    {{ binding.user?.username || `用户 #${binding.userId}` }}
                  </span>
                  <span
                    v-if="binding.user"
                    class="text-xs px-1.5 py-0.5 rounded-full"
                    :class="binding.user.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'"
                  >
                    {{ binding.user.status === 'active' ? '正常' : '已封禁' }}
                  </span>
                  <span class="text-xs text-themed-muted">用户 ID {{ binding.userId }}</span>
                  <span class="text-xs text-themed-muted">Telegram {{ formatTelegramName(binding) }}</span>
                  <span class="text-xs text-themed-muted">ID {{ binding.telegramUserId }}</span>
                </div>
                <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-themed-muted">
                  <span v-if="binding.user?.email" class="break-all">{{ binding.user.email }}</span>
                  <span>充值 ¥{{ formatMoney(binding.stats.totalRecharge) }}</span>
                  <span>消费 ¥{{ formatMoney(binding.stats.totalConsume) }}</span>
                  <span>绑定 {{ formatDate(binding.boundAt) }}</span>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2 xl:ml-4 xl:justify-end">
                <span
                  class="text-xs px-2 py-1 rounded-full"
                  :class="eligibilityClass(binding.eligibility.status)"
                >
                  普通：{{ eligibilityLabel(binding.eligibility.status) }}
                </span>
                <span
                  class="text-xs px-2 py-1 rounded-full"
                  :class="eligibilityClass(binding.vipEligibility.status)"
                >
                  高级：{{ eligibilityLabel(binding.vipEligibility.status) }}
                </span>
                <button
                  type="button"
                  class="text-xs text-red-400 hover:text-red-300"
                  :disabled="unlinkingBindingId === binding.id"
                  @click="unlinkTelegramBinding(binding)"
                >
                  {{ unlinkingBindingId === binding.id ? '解绑中...' : '解除绑定' }}
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
            共 {{ telegramBindingsTotal }} 条，当前第 {{ telegramBindingsPage }} / {{ telegramBindingsTotalPages }} 页
          </span>
          <div class="flex gap-2">
            <button
              type="button"
              class="btn-ghost text-xs px-3 py-1.5"
              :disabled="bindingLoading || telegramBindingsPage <= 1"
              @click="goTelegramBindingsPage(telegramBindingsPage - 1)"
            >
              上一页
            </button>
            <button
              type="button"
              class="btn-ghost text-xs px-3 py-1.5"
              :disabled="bindingLoading || telegramBindingsPage >= telegramBindingsTotalPages"
              @click="goTelegramBindingsPage(telegramBindingsPage + 1)"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      <div class="card p-6">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-themed font-medium">全局 Telegram 通知渠道</h3>
          <button type="button" class="btn-primary text-sm px-4 py-1.5" @click="openCreateChannelForm">+ 添加渠道</button>
        </div>
        <p class="text-sm text-themed-muted mb-4">创建全局 Telegram 通知渠道后，托管用户可在套餐设置中绑定，当有用户新购或销毁实例时自动发送通知。</p>

        <div v-if="channelLoading" class="text-sm text-themed-muted">加载中...</div>
        <div v-else-if="globalChannels.length === 0" class="text-sm text-themed-muted p-3 rounded-lg bg-themed-secondary/30">
          暂无全局通知渠道，点击右上角「添加渠道」创建。
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
                  {{ ch.enabled ? '已启用' : '已停用' }}
                </span>
                <span class="text-xs text-themed-muted">绑定 {{ ch.boundPackages }} 个套餐</span>
              </div>
              <p class="text-xs text-themed-muted mt-0.5">{{ ch.configPreview }}</p>
            </div>
            <div class="flex items-center gap-2 md:ml-4">
              <button
                type="button"
                class="text-xs text-blue-400 hover:text-blue-300"
                :disabled="testingChannelId === ch.id"
                @click="testChannel(ch.id)"
              >
                {{ testingChannelId === ch.id ? '发送中...' : '测试' }}
              </button>
              <button type="button" class="text-xs text-themed-muted hover:text-themed" @click="openEditChannelForm(ch)">编辑</button>
              <button
                type="button"
                class="text-xs text-red-400 hover:text-red-300"
                :disabled="deletingChannelId === ch.id"
                @click="deleteChannel(ch.id)"
              >
                {{ deletingChannelId === ch.id ? '删除中...' : '删除' }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="showChannelForm" class="mt-4 p-4 rounded-lg border border-themed-border bg-themed-secondary/20 space-y-3">
          <h4 class="font-medium text-sm text-themed">{{ editingChannel ? '编辑渠道' : '新建渠道' }}</h4>
          <div v-if="channelFormError" class="text-xs text-red-400">{{ channelFormError }}</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="block text-xs text-themed-muted">渠道名称 *</label>
              <input v-model="channelForm.name" type="text" class="input" placeholder="例：新购通知频道" />
            </div>
            <div class="space-y-1">
              <label class="block text-xs text-themed-muted">Chat ID *</label>
              <input v-model="channelForm.chatId" type="text" class="input" placeholder="例：-1001234567890" />
              <p class="text-xs text-themed-muted">负数为群组/频道，正数为用户。</p>
            </div>
            <div class="md:col-span-2 space-y-1">
              <label class="block text-xs text-themed-muted">Bot Token {{ editingChannel ? '（留空保持不变）' : '*' }}</label>
              <input v-model="channelForm.botToken" type="password" class="input" placeholder="例：123456:ABC-DEF..." />
            </div>
            <div class="md:col-span-2 flex items-center gap-2">
              <input id="telegramChannelEnabled" v-model="channelForm.enabled" type="checkbox" class="w-4 h-4 rounded" />
              <label for="telegramChannelEnabled" class="text-sm text-themed-secondary">启用此渠道</label>
            </div>
          </div>
          <div class="flex gap-2 justify-end">
            <button type="button" class="btn-secondary text-sm" @click="showChannelForm = false">取消</button>
            <button type="button" class="btn-primary text-sm" :disabled="savingChannel" @click="saveChannel">
              {{ savingChannel ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>

        <div class="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p class="text-sm text-blue-400">
            需要 Telegram Bot Token？去
            <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" class="underline hover:text-blue-300">@BotFather</a>
            创建机器人，并将机器人添加为群组/频道管理员。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
