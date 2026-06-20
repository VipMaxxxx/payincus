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
import { useAuthStore } from '@/stores/auth'
import AccountSection from '@/components/profile/AccountSection.vue'
import PasswordSection from '@/components/profile/PasswordSection.vue'
import TwoFactorSection from '@/components/profile/TwoFactorSection.vue'
import OAuthSection from '@/components/profile/OAuthSection.vue'
import TelegramBindingSection from '@/components/profile/TelegramBindingSection.vue'
import SSHKeysSection from '@/components/profile/SSHKeysSection.vue'
import NotificationSection from '@/components/profile/NotificationSection.vue'
import LoginHistorySection from '@/components/profile/LoginHistorySection.vue'

// 为 KeepAlive include 匹配定义组件名称（必须在所有 import 之后）
defineOptions({ name: 'ProfileView' })

const authStore = useAuthStore()
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header">
      <h1 class="page-title">{{ $t('nav.settings') }}</h1>
    </div>

    <!-- 账户信息和配额 -->
    <AccountSection />

    <!-- 修改密码 -->
    <PasswordSection />

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
</template>
