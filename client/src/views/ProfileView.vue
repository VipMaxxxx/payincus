<script setup lang="ts">
/**
 * ProfileView - 用户设置页面
 * 
 * 已拆分为以下子组件：
 * - AccountSection: 账户信息和配额显示、API Keys
 * - PasswordSection: 密码修改
 * - TwoFactorSection: 双因素认证 (2FA)
 * - OAuthSection: OAuth 账号绑定
 * - TelegramBindingSection: Telegram 绑定
 * - SSHKeysSection: SSH 公钥管理（仅普通用户）
 * - NotificationSection: 通知渠道管理
 * - LoginHistorySection: 登录历史记录
 * 
 * 注意：账户余额已移至独立的 WalletView 页面
 */
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useReveal } from '@/composables/useReveal'
import AccountSection from '@/components/profile/AccountSection.vue'
import PasswordSection from '@/components/profile/PasswordSection.vue'
import TwoFactorSection from '@/components/profile/TwoFactorSection.vue'
import OAuthSection from '@/components/profile/OAuthSection.vue'
import TelegramBindingSection from '@/components/profile/TelegramBindingSection.vue'
import SSHKeysSection from '@/components/profile/SSHKeysSection.vue'
import NotificationSection from '@/components/profile/NotificationSection.vue'
import LoginHistorySection from '@/components/profile/LoginHistorySection.vue'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'

// 为 KeepAlive include 匹配定义组件名称（必须在所有 import 之后）
defineOptions({ name: 'ProfileView' })

const authStore = useAuthStore()

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)
</script>

<template>
  <div ref="revealRoot" class="kawaii-page nimbus-settings animate-fade-in">
    <div data-reveal class="nimbus-settings-head">
      <h1 class="nimbus-settings-title">{{ $t('nav.settings') }}</h1>
    </div>

    <div class="nimbus-settings-stack">
      <ThemeTemplateSlot slot-name="user.profile.banner" container-class="overflow-hidden rounded-2xl border border-themed bg-themed-surface" />

      <!-- 账户信息和配额 -->
      <AccountSection data-reveal />

      <!-- 修改密码 -->
      <PasswordSection data-reveal />

      <!-- 双因素认证 -->
      <TwoFactorSection />

      <!-- OAuth 账号绑定 -->
      <OAuthSection />

      <!-- Telegram 绑定 -->
      <TelegramBindingSection />

      <!-- SSH 公钥（仅普通用户） -->
      <SSHKeysSection v-if="!authStore.isAdmin" />

      <!-- 通知渠道 -->
      <NotificationSection />

      <!-- 登录历史记录 -->
      <LoginHistorySection />
    </div>
  </div>
</template>

<style scoped>
.nimbus-settings {
  max-width: 52rem;
  margin: 0 auto;
}

.nimbus-settings-head {
  padding-bottom: 1.25rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--kawaii-line);
}

.nimbus-settings-title {
  font-size: 1.35rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--kawaii-text);
  line-height: 1.2;
}

.nimbus-settings-stack {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
</style>
