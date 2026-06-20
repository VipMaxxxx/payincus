<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import SensitiveVerificationModal from '@/components/SensitiveVerificationModal.vue'

const { t } = useI18n()
const authStore = useAuthStore()

interface PasswordForm {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const passwordForm = ref<PasswordForm>({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const passwordLoading = ref<boolean>(false)
const passwordError = ref<string>('')
const passwordSuccess = ref<boolean>(false)

// 验证模态框
const showVerificationModal = ref<boolean>(false)
const pendingPassword = ref<string>('')
const pendingCurrentPassword = ref<string>('')

async function updatePassword(): Promise<void> {
  passwordError.value = ''
  passwordSuccess.value = false

  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    passwordError.value = t('profile.password.mismatch')
    return
  }

  if (passwordForm.value.newPassword.length < 6) {
    passwordError.value = t('profile.password.tooShort')
    return
  }

  passwordLoading.value = true
  try {
    const response = await api.users.update(authStore.user!.id, {
      password: passwordForm.value.newPassword,
      currentPassword: passwordForm.value.currentPassword
    } as any)
    passwordSuccess.value = true
    passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    if (response.reauthRequired) {
      setTimeout(() => {
        authStore.clearLocalAuth()
        window.location.href = '/login'
      }, 1000)
      return
    }
    setTimeout(() => passwordSuccess.value = false, 3000)
  } catch (error: any) {
    // 检查是否需要验证
    if (error?.code === 'VERIFICATION_REQUIRED' || error?.message?.includes('Sensitive operation requires verification')) {
      // 保存待修改的密码和当前密码，等待验证成功后使用
      pendingPassword.value = passwordForm.value.newPassword
      pendingCurrentPassword.value = passwordForm.value.currentPassword
      showVerificationModal.value = true
      passwordLoading.value = false
      return
    }
    passwordError.value = error?.message || t('profile.password.updateFailed')
  } finally {
    passwordLoading.value = false
  }
}

// 验证成功后的处理
async function onVerificationSuccess(): Promise<void> {
  showVerificationModal.value = false
  
  // 验证成功后，重新执行密码修改
  if (pendingPassword.value && pendingCurrentPassword.value) {
    passwordLoading.value = true
    try {
      const response = await api.users.update(authStore.user!.id, {
        password: pendingPassword.value,
        currentPassword: pendingCurrentPassword.value
      } as any)
      passwordSuccess.value = true
      passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
      pendingPassword.value = ''
      pendingCurrentPassword.value = ''
      if (response.reauthRequired) {
        setTimeout(() => {
          authStore.clearLocalAuth()
          window.location.href = '/login'
        }, 1000)
        return
      }
      setTimeout(() => passwordSuccess.value = false, 3000)
    } catch (error: any) {
      passwordError.value = error?.message || t('profile.password.updateFailed')
      // 如果当前密码错误，清空待处理状态
      if (error?.code === 'INVALID_CREDENTIALS' || error?.message?.includes('Current password is incorrect')) {
        pendingPassword.value = ''
        pendingCurrentPassword.value = ''
      }
    } finally {
      passwordLoading.value = false
    }
  }
}
</script>

<template>
  <div class="card p-5">
    <h2 class="text-sm font-medium text-themed-secondary mb-4">{{ $t('profile.password.title') }}</h2>
    <form class="space-y-4" @submit.prevent="updatePassword">
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.password.current') }}</label>
        <input 
          v-model="passwordForm.currentPassword" 
          type="password" 
          class="input" 
          :placeholder="$t('profile.password.currentPlaceholder')"
          autocomplete="current-password"
        />
      </div>
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.password.new') }}</label>
        <input 
          v-model="passwordForm.newPassword" 
          type="password" 
          class="input" 
          :placeholder="$t('profile.password.newPlaceholder')"
          autocomplete="new-password"
        />
      </div>
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.password.confirm') }}</label>
        <input 
          v-model="passwordForm.confirmPassword" 
          type="password" 
          class="input" 
          :placeholder="$t('profile.password.confirmPlaceholder')"
          autocomplete="new-password"
        />
      </div>
      
      <div v-if="passwordError" class="text-sm text-red-400">{{ passwordError }}</div>
      <div v-if="passwordSuccess" class="text-sm text-green-400">{{ $t('profile.password.updated') }}</div>
      
      <button 
        type="submit" 
        :disabled="passwordLoading || !passwordForm.currentPassword || !passwordForm.newPassword"
        class="btn-secondary"
      >
        {{ passwordLoading ? $t('profile.password.updating') : $t('profile.password.update') }}
      </button>
    </form>

    <!-- 敏感操作验证弹窗 -->
    <SensitiveVerificationModal
      :show="showVerificationModal"
      operation-type="change_password"
      @close="showVerificationModal = false"
      @verified="onVerificationSuccess"
    />
  </div>
</template>
