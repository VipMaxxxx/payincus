<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import UserAvatar from '@/components/UserAvatar.vue'
import ChangeEmailModal from '@/components/profile/ChangeEmailModal.vue'
import type { User } from '@/types/api'

const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const toast = useToast()
const userDetails = ref<User | null>(null)
const loading = ref<boolean>(true)

// 头像风格相关 - 所有可用风格
const avatarStyles = [
  'adventurer', 'adventurerNeutral', 'avataaars', 'avataaarsNeutral',
  'bigEars', 'bigEarsNeutral', 'bigSmile', 'bottts', 'botttsNeutral',
  'croodles', 'croodlesNeutral', 'dylan', 'funEmoji', 'glass', 'icons',
  'identicon', 'initials', 'lorelei', 'loreleiNeutral', 'micah', 'miniavs',
  'notionists', 'notionistsNeutral', 'openPeeps', 'personas', 'pixelArt',
  'pixelArtNeutral', 'rings', 'shapes', 'thumbs'
] as const

const selectedAvatarStyle = ref<string>(authStore.user?.avatarStyle || '')
const savingAvatar = ref(false)
const avatarExpanded = ref(false)
const showChangeEmailModal = ref(false)

// 获取风格的国际化名称
function getStyleLabel(style: string): string {
  return t(`profile.avatar.styles.${style}`)
}

const hasAvatarChanged = computed(() => {
  return selectedAvatarStyle.value !== authStore.user?.avatarStyle
})

async function saveAvatarStyle(): Promise<void> {
  if (!hasAvatarChanged.value) return
  savingAvatar.value = true
  try {
    await api.users.update(authStore.user!.id, { avatarStyle: selectedAvatarStyle.value })
    // 更新本地 store
    if (authStore.user) {
      authStore.user.avatarStyle = selectedAvatarStyle.value
    }
    toast.success(t('profile.avatar.saveSuccess'))
  } catch (error) {
    console.error('Failed to save avatar style:', error)
    toast.error(t('profile.avatar.saveFailed'))
  } finally {
    savingAvatar.value = false
  }
}

async function loadUserDetails(): Promise<void> {
  try {
    const response = await api.users.get(authStore.user!.id)
    userDetails.value = (response as { user?: User }).user || null
  } catch (error) {
    console.error('Failed to load user details:', error)
  } finally {
    loading.value = false
  }
}

function handleEmailUpdated(email: string): void {
  if (authStore.user) {
    authStore.user.email = email
  }
  if (userDetails.value) {
    userDetails.value.email = email
  }
  showChangeEmailModal.value = false
}


// 挂载时加载
loadUserDetails()

defineExpose({ loadUserDetails })
</script>

<template>
  <!-- 账户信息 -->
  <div class="card p-5">
    <div class="flex items-start justify-between mb-4">
      <h2 class="text-sm font-medium text-themed-secondary">{{ $t('profile.account.title') }}</h2>
      <UserAvatar 
        :username="authStore.user?.username || ''" 
        :email="authStore.user?.email"
        :avatar-style="authStore.user?.avatarStyle || ''"
        :size="56"
      />
    </div>
    <dl class="space-y-0 text-sm">
      <div class="flex items-center justify-between py-3 border-b border-themed">
        <dt class="text-themed-muted">{{ $t('profile.account.username') }}</dt>
        <dd class="flex flex-wrap items-center justify-end gap-2 text-themed font-medium">
          <span>{{ authStore.user?.username }}</span>
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'"
          >
            {{ $t('profile.account.uid') }} {{ authStore.user?.id }}
          </span>
        </dd>
      </div>
      <div class="flex items-center justify-between py-3 border-b border-themed">
        <dt class="text-themed-muted">{{ $t('profile.account.role') }}</dt>
        <dd>
          <span :class="['badge', authStore.isAdmin ? 'badge-warning' : 'badge-success']">
            {{ authStore.isAdmin ? $t('profile.account.admin') : $t('profile.account.user') }}
          </span>
        </dd>
      </div>
      <div class="flex items-center justify-between py-3 border-b border-themed">
        <dt class="text-themed-muted">{{ $t('profile.account.email') }}</dt>
        <dd class="flex flex-wrap items-center justify-end gap-3">
          <span class="text-themed-secondary">{{ authStore.user?.email || $t('profile.account.notSet') }}</span>
          <button
            type="button"
            class="btn-secondary btn-sm"
            @click="showChangeEmailModal = true"
          >
            {{ authStore.user?.email ? $t('profile.account.changeEmail') : $t('profile.account.bindEmail') }}
          </button>
        </dd>
      </div>
      <!-- 头像风格入口 -->
      <div class="py-3">
        <button
          class="w-full flex items-center justify-between text-left"
          @click="avatarExpanded = !avatarExpanded"
        >
          <span class="text-themed-muted">{{ $t('profile.avatar.title') }}</span>
          <svg
            class="w-4 h-4 text-themed-muted transition-transform duration-200"
            :class="{ 'rotate-180': avatarExpanded }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <!-- 展开的头像选择区域 -->
        <div
          v-show="avatarExpanded"
          class="mt-4 pt-4 border-t border-themed"
        >
          <div class="flex flex-col sm:flex-row items-start gap-6 mb-4">
            <!-- 预览 -->
            <div class="flex-shrink-0 flex flex-col items-center gap-2">
              <UserAvatar 
                :username="authStore.user?.username || ''"
                :email="authStore.user?.email" 
                :avatar-style="selectedAvatarStyle"
                :prefer-badge="false"
                :size="96"
              />
              <span class="text-sm text-themed-secondary">{{ getStyleLabel(selectedAvatarStyle) }}</span>
            </div>
            <!-- 风格选择 -->
            <div class="flex-1 w-full">
              <div class="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                <button
                  v-for="style in avatarStyles"
                  :key="style"
                  class="flex flex-col items-center gap-1 p-1.5 rounded-lg border-2 transition-all"
                  :class="[
                    selectedAvatarStyle === style 
                      ? 'border-blue-500 bg-blue-500/10' 
                      : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                  ]"
                  :title="getStyleLabel(style)"
                  @click="selectedAvatarStyle = style"
                >
                  <UserAvatar 
                    :username="authStore.user?.username || ''"
                    :email="authStore.user?.email" 
                    :avatar-style="style"
                    :prefer-badge="false"
                    :size="32"
                  />
                </button>
              </div>
            </div>
          </div>
          <div class="flex justify-end">
            <button
              class="btn btn-primary text-sm"
              :disabled="!hasAvatarChanged || savingAvatar"
              @click="saveAvatarStyle"
            >
              {{ savingAvatar ? $t('common.saving') : $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </dl>
  </div>

  <ChangeEmailModal
    :show="showChangeEmailModal"
    @close="showChangeEmailModal = false"
    @updated="handleEmailUpdated"
  />
</template>
