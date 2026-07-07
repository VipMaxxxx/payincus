<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import api, {
  type IntegrationHealthHistoryResponse,
  type IntegrationHealthItem,
  type IntegrationHealthStatus
} from '@/api/admin'
import { useToast } from '@/stores/toast'

type ConfigItem = {
  key: string
  value: string
}

type IntegrationTone = 'success' | 'warning' | 'danger' | 'neutral'

type IntegrationItem = {
  key: string
  title: string
  status: string
  tone: IntegrationTone
  description: string
  detail: string
  route: string
  action: string
}

const toast = useToast()
const loading = ref(true)
const healthLoading = ref(false)
const configs = ref<Record<string, string>>({})
const globalNotificationChannels = ref<Array<{ id: number; name: string; type: string; enabled: boolean }>>([])
const storageConfigs = ref<Array<{ id: number; name: string; type: string; isDefault: boolean }>>([])
const paymentProviders = ref<Array<{ id: number; name: string; type: string; status: string }>>([])
const telegramWebhook = ref<{ url?: string; pending_update_count?: number; last_error_message?: string } | null>(null)
const healthItems = ref<IntegrationHealthItem[]>([])
const healthHistory = ref<IntegrationHealthHistoryResponse | null>(null)

function configValue(key: string): string {
  return configs.value[key] || ''
}

function configEnabled(key: string): boolean {
  return configValue(key) === 'true'
}

function hasValue(key: string): boolean {
  return configValue(key).trim().length > 0
}

function boolStatus(enabled: boolean, enabledLabel = '已启用', disabledLabel = '未启用'): string {
  return enabled ? enabledLabel : disabledLabel
}

function badgeClass(tone: IntegrationTone): string {
  if (tone === 'success') return 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300'
  if (tone === 'warning') return 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300'
  if (tone === 'danger') return 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}

function healthBadgeClass(status: IntegrationHealthStatus): string {
  if (status === 'ok') return 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300'
  if (status === 'warning') return 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300'
  if (status === 'error') return 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}

function healthStatusLabel(status: IntegrationHealthStatus): string {
  if (status === 'ok') return '检测正常'
  if (status === 'warning') return '需要复核'
  if (status === 'error') return '检测失败'
  return '未检测'
}

function toneFromHealthStatus(status: IntegrationHealthStatus | undefined): IntegrationTone {
  if (status === 'ok') return 'success'
  if (status === 'warning') return 'warning'
  if (status === 'error') return 'danger'
  return 'neutral'
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function formatCheckedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatSuccessRate(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`
}

const enabledGlobalChannels = computed(() => globalNotificationChannels.value.filter(channel => channel.enabled).length)
const defaultStorage = computed(() => storageConfigs.value.find(item => item.isDefault) || null)
const activePaymentProviders = computed(() => paymentProviders.value.filter(provider => provider.status === 'active').length)
const healthByKey = computed<Record<string, IntegrationHealthItem>>(() => Object.fromEntries(
  healthItems.value.map(item => [item.key, item])
))
const healthSummaryByKey = computed(() => Object.fromEntries(
  (healthHistory.value?.summaries || []).map(item => [item.key, item])
))
const recentIntegrationFailures = computed(() => healthHistory.value?.recentFailures || [])

const integrationItems = computed<IntegrationItem[]>(() => {
  const smtpConfigured = configEnabled('smtp_enabled') && hasValue('smtp_host') && hasValue('smtp_from_email')
  const lskyConfigured = hasValue('ticket_image_lsky_base_url') && hasValue('ticket_image_lsky_token')
  const telegramConfigured = configEnabled('telegram_bot_enabled') && hasValue('telegram_bot_token')
  const telegramWebhookOk = Boolean(telegramWebhook.value?.url) && !telegramWebhook.value?.last_error_message
  const pluginMarketConfigured = hasValue('plugin_market_index_url') && hasValue('plugin_market_trusted_hosts')
  const themeMarketConfigured = hasValue('theme_market_index_url') && hasValue('theme_market_trusted_hosts')

  return [
    {
      key: 'smtp',
      title: 'SMTP 邮件',
      status: boolStatus(smtpConfigured, '已配置', '未完整配置'),
      tone: smtpConfigured ? 'success' : 'warning',
      description: '注册验证、登录提醒、账务和工单邮件依赖 SMTP。',
      detail: smtpConfigured ? `${configValue('smtp_host')} / ${configValue('smtp_from_email')}` : '需要启用 SMTP，并填写 host 与发件邮箱。',
      route: '/admin/settings/mail',
      action: '配置邮件'
    },
    {
      key: 'lsky',
      title: 'Lsky 工单附件',
      status: boolStatus(lskyConfigured, '已配置', '未完整配置'),
      tone: lskyConfigured ? 'success' : 'warning',
      description: '工单图片上传依赖 Lsky base URL、token 和 API 版本。',
      detail: lskyConfigured ? `${configValue('ticket_image_lsky_api_version') || 'v1'} / ${configValue('ticket_image_lsky_base_url')}` : '需要配置 base URL 与 token。',
      route: '/admin/settings/tickets',
      action: '配置附件'
    },
    {
      key: 'telegram',
      title: 'Telegram Bot',
      status: telegramConfigured ? (telegramWebhookOk ? 'Webhook 正常' : 'Bot 已配置') : '未完整配置',
      tone: telegramConfigured ? (telegramWebhookOk ? 'success' : 'warning') : 'neutral',
      description: '用户 Telegram 绑定、群准入和 Telegram 通知依赖 Bot 与 Webhook。',
      detail: telegramWebhook.value?.last_error_message || telegramWebhook.value?.url || '未读取到 Webhook URL。',
      route: '/admin/settings/telegram',
      action: '配置 Telegram'
    },
    {
      key: 'payment-providers',
      title: '充值支付渠道',
      status: activePaymentProviders.value > 0 ? `${activePaymentProviders.value} 个已启用` : '未启用',
      tone: activePaymentProviders.value > 0 ? 'success' : 'warning',
      description: '用户余额充值、人工充值和插件支付网关依赖已启用支付渠道。',
      detail: paymentProviders.value.length > 0 ? `共 ${paymentProviders.value.length} 个渠道` : '暂无支付渠道。',
      route: '/admin/payment-providers',
      action: '管理支付'
    },
    {
      key: 'notification-channels',
      title: '全局通知渠道',
      status: enabledGlobalChannels.value > 0 ? `${enabledGlobalChannels.value} 个已启用` : '未启用',
      tone: enabledGlobalChannels.value > 0 ? 'success' : 'warning',
      description: '托管套餐新购、销毁和运营通知依赖全局通知渠道。',
      detail: globalNotificationChannels.value.length > 0 ? `共 ${globalNotificationChannels.value.length} 个渠道` : '暂无全局通知渠道。',
      route: '/admin/settings/telegram',
      action: '管理渠道'
    },
    {
      key: 'remote-storage',
      title: '远程存储',
      status: storageConfigs.value.length > 0 ? `${storageConfigs.value.length} 个配置` : '未配置',
      tone: storageConfigs.value.length > 0 ? 'success' : 'neutral',
      description: '用户备份、远程存储和后续外部归档可复用存储配置。',
      detail: defaultStorage.value ? `默认：${defaultStorage.value.name} (${defaultStorage.value.type})` : '暂无默认远程存储。',
      route: '/admin/profile',
      action: '查看存储'
    },
    {
      key: 'host-agent',
      title: 'Agent / Incus 节点',
      status: healthByKey.value['host-agent'] ? healthStatusLabel(healthByKey.value['host-agent'].status) : '按健康检测判断',
      tone: toneFromHealthStatus(healthByKey.value['host-agent']?.status),
      description: '节点交付、实例操作、资源采集和风控采样依赖 Host Agent 与 Incus 可用性。',
      detail: healthByKey.value['host-agent']?.message || '运行一键检测后会显示 Agent 心跳和已安装节点状态。',
      route: '/admin/resources/hosts',
      action: '查看节点'
    },
    {
      key: 'ota-release',
      title: 'OTA 更新源',
      status: healthByKey.value['ota-release'] ? healthStatusLabel(healthByKey.value['ota-release'].status) : '按健康检测判断',
      tone: toneFromHealthStatus(healthByKey.value['ota-release']?.status),
      description: '后台版本更新依赖 Git release tag、OTA manifest 与可下载 artifact。',
      detail: healthByKey.value['ota-release']?.message || '运行一键检测后会显示当前版本与最新 release。',
      route: '/admin/system-update',
      action: '查看更新'
    },
    {
      key: 'plugin-market',
      title: '扩展市场源',
      status: boolStatus(pluginMarketConfigured, '已配置', '未完整配置'),
      tone: pluginMarketConfigured ? 'success' : 'warning',
      description: '扩展中心市场页实时读取稳定 index.json，并校验可信下载域。',
      detail: configValue('plugin_market_index_url') || '未配置扩展市场 index URL。',
      route: '/admin/settings/operations',
      action: '配置市场'
    },
    {
      key: 'theme-market',
      title: '主题市场源',
      status: boolStatus(themeMarketConfigured, '已配置', '未完整配置'),
      tone: themeMarketConfigured ? 'success' : 'warning',
      description: '主题中心读取在线主题市场，并只安装 listed 且 SHA256 固定的主题。',
      detail: configValue('theme_market_index_url') || '未配置主题市场 index URL。',
      route: '/admin/settings/operations',
      action: '配置主题市场'
    }
  ]
})

const summary = computed(() => {
  const items = integrationItems.value
  return {
    total: items.length,
    success: items.filter(item => item.tone === 'success').length,
    warning: items.filter(item => item.tone === 'warning').length,
    danger: items.filter(item => item.tone === 'danger').length
  }
})

async function loadIntegrations(): Promise<void> {
  loading.value = true
  try {
    const [configResponse, channelsResponse, storageResponse, paymentProvidersResponse, historyResponse] = await Promise.allSettled([
      api.systemConfig.list(),
      api.adminNotificationChannels.list(),
      api.storageConfigs.list(),
      api.admin.getPaymentProviders(),
      api.integrations.history()
    ])

    if (configResponse.status === 'fulfilled') {
      configs.value = Object.fromEntries(
        configResponse.value.configs.map((item: ConfigItem) => [item.key, item.value])
      )
    }
    if (channelsResponse.status === 'fulfilled') {
      globalNotificationChannels.value = channelsResponse.value.channels
    }
    if (storageResponse.status === 'fulfilled') {
      storageConfigs.value = storageResponse.value
    }
    if (paymentProvidersResponse.status === 'fulfilled') {
      paymentProviders.value = paymentProvidersResponse.value.providers
    }
    if (historyResponse.status === 'fulfilled') {
      healthHistory.value = historyResponse.value
    }

    if (configEnabled('telegram_bot_enabled') && hasValue('telegram_bot_token')) {
      try {
        const response = await api.telegram.getWebhookInfo()
        telegramWebhook.value = response.info
      } catch {
        telegramWebhook.value = { last_error_message: 'Webhook 状态读取失败，请进入 Telegram 配置页复核。' }
      }
    } else {
      telegramWebhook.value = null
    }

    const failed = [configResponse, channelsResponse, storageResponse, paymentProvidersResponse, historyResponse].filter(result => result.status === 'rejected').length
    if (failed > 0) {
      toast.warning(`集成中心有 ${failed} 个状态源读取失败，请进入对应配置页复核。`)
    }
  } catch (error: any) {
    toast.error(`加载集成中心失败：${error?.message || error}`)
  } finally {
    loading.value = false
  }
}

async function runHealthCheck(): Promise<void> {
  healthLoading.value = true
  try {
    const response = await api.integrations.health()
    healthItems.value = response.items
    healthHistory.value = response.history
    const failed = response.items.filter(item => item.status === 'error').length
    const warnings = response.items.filter(item => item.status === 'warning').length
    if (failed > 0) {
      toast.error(`集成健康检测完成：${failed} 项失败，${warnings} 项需复核。`)
    } else if (warnings > 0) {
      toast.warning(`集成健康检测完成：${warnings} 项需复核。`)
    } else {
      toast.success('集成健康检测通过')
    }
  } catch (error: any) {
    toast.error(`集成健康检测失败：${error?.message || error}`)
  } finally {
    healthLoading.value = false
  }
}

onMounted(loadIntegrations)
</script>

<template>
  <div class="kawaii-page page-container animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">集成中心</h1>
        <p class="mt-1 text-sm text-themed-muted">统一检查邮件、图床、Telegram、通知渠道、远程存储和市场源配置与健康状态。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary" :disabled="loading" @click="loadIntegrations">
          {{ loading ? '刷新中' : '刷新配置' }}
        </button>
        <button class="btn-primary" :disabled="healthLoading" @click="runHealthCheck">
          {{ healthLoading ? '检测中' : '一键检测' }}
        </button>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-4">
      <div class="card p-4">
        <div class="text-sm text-themed-muted">集成项</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ summary.total }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">正常</div>
        <div class="mt-2 text-2xl font-semibold text-green-600 dark:text-green-300">{{ summary.success }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">需复核</div>
        <div class="mt-2 text-2xl font-semibold text-yellow-600 dark:text-yellow-300">{{ summary.warning }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">异常</div>
        <div class="mt-2 text-2xl font-semibold text-red-600 dark:text-red-300">{{ summary.danger }}</div>
      </div>
    </div>

    <div class="mt-6 grid gap-4 lg:grid-cols-2">
      <div v-for="item in integrationItems" :key="item.key" class="card p-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-base font-semibold text-themed">{{ item.title }}</h2>
            <p class="mt-1 text-sm text-themed-muted">{{ item.description }}</p>
          </div>
          <span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="badgeClass(item.tone)">
            {{ item.status }}
          </span>
        </div>
        <div class="mt-4 rounded-lg border border-themed bg-themed-muted/30 p-3 text-sm text-themed-secondary break-all">
          {{ item.detail }}
        </div>
        <div
          v-if="healthSummaryByKey[item.key]"
          class="mt-3 grid gap-2 rounded-lg border border-themed bg-themed-muted/20 p-3 text-xs text-themed-muted sm:grid-cols-2"
        >
          <div>
            <span>7 天成功率</span>
            <div class="mt-1 text-sm font-medium text-themed">
              {{ formatSuccessRate(healthSummaryByKey[item.key].successRate) }}
              <span class="text-xs font-normal text-themed-muted">/ {{ healthSummaryByKey[item.key].total }} 次</span>
            </div>
          </div>
          <div>
            <span>最近检测</span>
            <div class="mt-1 flex items-center gap-2">
              <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="healthBadgeClass(healthSummaryByKey[item.key].lastStatus)">
                {{ healthStatusLabel(healthSummaryByKey[item.key].lastStatus) }}
              </span>
              <span>{{ formatCheckedAt(healthSummaryByKey[item.key].lastCheckedAt) }}</span>
            </div>
          </div>
        </div>
        <div
          v-if="healthByKey[item.key]"
          class="mt-3 rounded-lg border border-themed bg-themed-muted/20 p-3 text-sm"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-medium text-themed">健康检测</span>
            <span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="healthBadgeClass(healthByKey[item.key].status)">
              {{ healthStatusLabel(healthByKey[item.key].status) }}
            </span>
          </div>
          <p class="mt-2 text-themed-secondary">{{ healthByKey[item.key].message }}</p>
          <p v-if="healthByKey[item.key].detail" class="mt-1 break-all text-xs text-themed-muted">{{ healthByKey[item.key].detail }}</p>
          <p class="mt-1 text-xs text-themed-muted">耗时 {{ formatDuration(healthByKey[item.key].durationMs) }}</p>
        </div>
        <div class="mt-4 flex justify-end">
          <RouterLink class="btn-secondary px-3 py-1.5 text-sm" :to="item.route">
            {{ item.action }}
          </RouterLink>
        </div>
      </div>
    </div>

    <div class="mt-6 card p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-themed">最近异常</h2>
          <p class="mt-1 text-sm text-themed-muted">展示最近 {{ recentIntegrationFailures.length }} 条 warning / error 健康检测记录。</p>
        </div>
        <button class="btn-secondary px-3 py-1.5 text-sm" :disabled="loading" @click="loadIntegrations">
          刷新历史
        </button>
      </div>
      <div v-if="recentIntegrationFailures.length === 0" class="mt-4 rounded-lg border border-themed bg-themed-muted/20 p-4 text-sm text-themed-muted">
        暂无异常记录。
      </div>
      <template v-else>
        <div class="mt-4 space-y-3 lg:hidden">
          <div
            v-for="record in recentIntegrationFailures"
            :key="record.id"
            class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate font-medium text-themed">{{ record.title }}</div>
                <div class="mt-1 text-xs text-themed-muted">{{ formatCheckedAt(record.checkedAt) }}</div>
              </div>
              <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium" :class="healthBadgeClass(record.status)">
                {{ healthStatusLabel(record.status) }}
              </span>
            </div>
            <div class="mt-3 text-sm text-themed-secondary">{{ record.message }}</div>
            <div v-if="record.detail" class="mt-1 break-all text-xs text-themed-muted">{{ record.detail }}</div>
            <div class="mt-3 text-xs text-themed-muted">耗时 {{ formatDuration(record.durationMs) }}</div>
          </div>
        </div>
        <div class="mt-4 hidden overflow-hidden lg:block">
          <table class="w-full table-fixed text-sm">
            <thead class="text-left text-themed-muted">
              <tr>
                <th class="w-[18%] px-3 py-2 font-medium">时间</th>
                <th class="w-[18%] px-3 py-2 font-medium">集成项</th>
                <th class="w-[12%] px-3 py-2 font-medium">状态</th>
                <th class="w-[42%] px-3 py-2 font-medium">结果</th>
                <th class="w-[10%] px-3 py-2 font-medium">耗时</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed">
              <tr v-for="record in recentIntegrationFailures" :key="record.id">
                <td class="truncate px-3 py-3 text-themed-muted">{{ formatCheckedAt(record.checkedAt) }}</td>
                <td class="truncate px-3 py-3 font-medium text-themed">{{ record.title }}</td>
                <td class="px-3 py-3">
                  <span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="healthBadgeClass(record.status)">
                    {{ healthStatusLabel(record.status) }}
                  </span>
                </td>
                <td class="px-3 py-3 text-themed-secondary">
                  <div class="truncate">{{ record.message }}</div>
                  <div v-if="record.detail" class="mt-1 truncate text-xs text-themed-muted">{{ record.detail }}</div>
                </td>
                <td class="truncate px-3 py-3 text-themed-muted">{{ formatDuration(record.durationMs) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>
