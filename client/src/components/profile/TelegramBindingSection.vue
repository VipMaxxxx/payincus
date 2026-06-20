<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import type { TelegramBindingStatus } from '@/types/api'

const { locale, t } = useI18n()
const toast = useToast()

const loading = ref(false)
const generating = ref(false)
const unlinking = ref(false)
const bindUrl = ref('')
const expiresAt = ref('')
const status = ref<TelegramBindingStatus>({
  enabled: false,
  configured: false,
  botUsername: null,
  binding: null
})

const isAvailable = computed(() => status.value.enabled && status.value.configured)
const binding = computed(() => status.value.binding)
const botLabel = computed(() => status.value.botUsername ? `@${status.value.botUsername}` : 'Telegram Bot')
const telegramDisplayName = computed(() => {
  const current = binding.value
  if (!current) return ''
  if (current.telegramUsername) return `@${current.telegramUsername}`
  const fullName = [current.firstName, current.lastName].filter(Boolean).join(' ')
  return fullName || `ID ${current.telegramUserId}`
})

function formatDate(value: string): string {
  const localeMap: Record<string, string> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    en: 'en-US'
  }

  return new Date(value).toLocaleString(localeMap[locale.value] || 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function loadBinding(): Promise<void> {
  loading.value = true
  try {
    status.value = await api.telegram.getBinding()
  } catch (error) {
    console.error('Failed to load Telegram binding:', error)
  } finally {
    loading.value = false
  }
}

async function createBindToken(): Promise<void> {
  generating.value = true
  try {
    const response = await api.telegram.createBindToken()
    bindUrl.value = response.bindUrl
    expiresAt.value = response.expiresAt
    toast.success(t('profile.telegramBinding.generated'))
  } catch (error: any) {
    toast.error(t('profile.telegramBinding.generateFailed', { error: error?.message || String(error) }))
  } finally {
    generating.value = false
  }
}

async function copyBindUrl(): Promise<void> {
  if (!bindUrl.value) return
  try {
    await navigator.clipboard.writeText(bindUrl.value)
    toast.success(t('profile.telegramBinding.copied'))
  } catch {
    toast.error(t('profile.telegramBinding.copyFailed'))
  }
}

async function unlinkTelegram(): Promise<void> {
  if (!confirm(t('profile.telegramBinding.confirmUnlink'))) return

  unlinking.value = true
  try {
    await api.telegram.unlink()
    bindUrl.value = ''
    expiresAt.value = ''
    toast.success(t('profile.telegramBinding.unlinked'))
    await loadBinding()
  } catch (error: any) {
    toast.error(t('profile.telegramBinding.unlinkFailed', { error: error?.message || String(error) }))
  } finally {
    unlinking.value = false
  }
}

onMounted(loadBinding)

defineExpose({ loadBinding })
</script>

<template>
  <div class="card p-5">
    <div class="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 class="text-sm font-medium text-themed-secondary">{{ t('profile.telegramBinding.title') }}</h2>
        <p class="text-xs text-themed-faint mt-0.5">
          {{ t('profile.telegramBinding.description') }}
        </p>
      </div>
      <button class="btn-ghost btn-sm" :disabled="loading" @click="loadBinding">
        {{ loading ? t('profile.telegramBinding.refreshing') : t('profile.telegramBinding.refresh') }}
      </button>
    </div>

    <div v-if="loading" class="p-4 bg-themed-tertiary border border-themed rounded-lg animate-pulse">
      <div class="h-4 bg-themed-secondary rounded w-1/3 mb-3"></div>
      <div class="h-3 bg-themed-secondary rounded w-2/3"></div>
    </div>

    <div v-else-if="!isAvailable" class="p-4 bg-themed-tertiary border border-themed rounded-lg">
      <div class="text-sm text-themed font-medium">{{ t('profile.telegramBinding.unavailableTitle') }}</div>
      <p class="text-xs text-themed-muted mt-1">
        {{ t('profile.telegramBinding.unavailableDescription') }}
      </p>
    </div>

    <div v-else-if="binding" class="p-4 bg-themed-tertiary border border-themed rounded-lg">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="text-sm text-themed font-medium">{{ t('profile.telegramBinding.boundTitle', { name: telegramDisplayName }) }}</div>
          <p class="text-xs text-themed-muted mt-1">
            {{ t('profile.telegramBinding.telegramId', { id: binding.telegramUserId }) }}
          </p>
          <p class="text-xs text-themed-muted mt-1">
            {{ t('profile.telegramBinding.boundAt', { date: formatDate(binding.boundAt) }) }}
          </p>
          <p class="text-xs text-themed-muted mt-1">
            {{ t('profile.telegramBinding.joinHint', { bot: botLabel }) }}
            <code class="px-1 py-0.5 rounded bg-themed-secondary">/join</code>
          </p>
        </div>
        <button class="btn-ghost btn-sm text-error" :disabled="unlinking" @click="unlinkTelegram">
          {{ unlinking ? t('profile.telegramBinding.unlinking') : t('profile.telegramBinding.unlink') }}
        </button>
      </div>
    </div>

    <div v-else class="space-y-4">
      <div class="p-4 bg-themed-tertiary border border-themed rounded-lg">
        <div class="text-sm text-themed font-medium">{{ t('profile.telegramBinding.unboundTitle') }}</div>
        <p class="text-xs text-themed-muted mt-1">
          {{ t('profile.telegramBinding.unboundDescription', { bot: botLabel }) }}
        </p>
      </div>

      <div class="flex flex-col sm:flex-row gap-2">
        <button class="btn-secondary btn-sm" :disabled="generating" @click="createBindToken">
          {{ generating ? t('profile.telegramBinding.generating') : t('profile.telegramBinding.generate') }}
        </button>
        <a
          v-if="bindUrl"
          class="btn-primary btn-sm text-center"
          :href="bindUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('profile.telegramBinding.openTelegram') }}
        </a>
        <button v-if="bindUrl" class="btn-ghost btn-sm" @click="copyBindUrl">
          {{ t('profile.telegramBinding.copyLink') }}
        </button>
      </div>

      <div v-if="bindUrl" class="p-3 rounded-lg bg-themed-secondary/50 border border-themed">
        <p class="text-xs text-themed-muted mb-2">
          {{ t('profile.telegramBinding.linkHint') }}
        </p>
        <p class="break-all text-xs text-themed">{{ bindUrl }}</p>
        <p v-if="expiresAt" class="text-xs text-themed-muted mt-2">
          {{ t('profile.telegramBinding.expiresAt', { date: formatDate(expiresAt) }) }}
        </p>
      </div>
    </div>
  </div>
</template>
