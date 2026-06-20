<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'

const { t } = useI18n()
const loading = ref(false)
const enabled = ref(false)
const setupMode = ref(false)
const disableMode = ref(false)
const regenerateMode = ref(false)

// 设置数据
const qrCode = ref('')
const secret = ref('')
const recoveryCodes = ref<string[]>([])
const verifyCode = ref('')

// 禁用数据
const disablePassword = ref('')
const disableCode = ref('')

// 恢复码状态
const recoveryCodesStatus = ref<{ total: number; remaining: number; used: number } | null>(null)

// 重新生成数据
const regeneratePassword = ref('')
const regenerateCode = ref('')
const newRecoveryCodes = ref<string[]>([])

const error = ref('')
const success = ref('')

async function loadStatus() {
  try {
    const res = await api.auth.get2FAStatus()
    enabled.value = res.enabled
    if (res.enabled) {
      await loadRecoveryCodesStatus()
    }
  } catch (e: any) {
    error.value = e.message || t('profile.twoFactorAuth.getStatusFailed')
  }
}

async function loadRecoveryCodesStatus() {
  try {
    recoveryCodesStatus.value = await api.auth.getRecoveryCodes()
  } catch {
    // 静默失败
  }
}

async function startSetup() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.auth.setup2FA()
    qrCode.value = res.qrCode
    secret.value = res.secret
    recoveryCodes.value = res.recoveryCodes
    setupMode.value = true
  } catch (e: any) {
    error.value = e.message || t('profile.twoFactorAuth.initFailed')
  } finally {
    loading.value = false
  }
}

async function confirmEnable() {
  if (!verifyCode.value || verifyCode.value.length !== 6) {
    error.value = t('profile.twoFactorAuth.enterCodeError')
    return
  }
  loading.value = true
  error.value = ''
  try {
    await api.auth.enable2FA(verifyCode.value)
    enabled.value = true
    setupMode.value = false
    success.value = t('profile.twoFactorAuth.enabledSuccess')
    setTimeout(() => success.value = '', 3000)
  } catch (e: any) {
    error.value = e.message || t('profile.twoFactorAuth.verifyFailed')
  } finally {
    loading.value = false
  }
}

async function confirmDisable() {
  if (!disablePassword.value || !disableCode.value) {
    error.value = t('profile.twoFactorAuth.fillPasswordAndCode')
    return
  }
  loading.value = true
  error.value = ''
  try {
    await api.auth.disable2FA(disablePassword.value, disableCode.value)
    enabled.value = false
    disableMode.value = false
    disablePassword.value = ''
    disableCode.value = ''
    recoveryCodesStatus.value = null
    success.value = t('profile.twoFactorAuth.disabledSuccess')
    setTimeout(() => success.value = '', 3000)
  } catch (e: any) {
    error.value = e.message || t('profile.twoFactorAuth.disableFailed')
  } finally {
    loading.value = false
  }
}

async function confirmRegenerate() {
  if (!regeneratePassword.value || !regenerateCode.value) {
    error.value = t('profile.twoFactorAuth.fillPasswordAndCode')
    return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await api.auth.regenerateRecoveryCodes(regeneratePassword.value, regenerateCode.value)
    newRecoveryCodes.value = res.recoveryCodes
    await loadRecoveryCodesStatus()
    success.value = t('profile.twoFactorAuth.codesRegenerated')
    setTimeout(() => success.value = '', 5000)
  } catch (e: any) {
    error.value = e.message || t('profile.twoFactorAuth.regenerateFailed')
  } finally {
    loading.value = false
  }
}

function cancelRegenerate() {
  regenerateMode.value = false
  regeneratePassword.value = ''
  regenerateCode.value = ''
  newRecoveryCodes.value = []
  error.value = ''
}

function cancelSetup() {
  setupMode.value = false
  qrCode.value = ''
  secret.value = ''
  recoveryCodes.value = []
  verifyCode.value = ''
  error.value = ''
}

function cancelDisable() {
  disableMode.value = false
  disablePassword.value = ''
  disableCode.value = ''
  error.value = ''
}

onMounted(loadStatus)
</script>

<template>
  <div class="card p-5">
    <h2 class="text-sm font-medium text-themed-secondary mb-4">{{ $t('profile.twoFactorAuth.title') }}</h2>
    
    <!-- Status display -->
    <div v-if="!setupMode && !disableMode && !regenerateMode" class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-sm text-themed-primary">{{ $t('profile.twoFactorAuth.status') }}：</span>
          <span :class="enabled ? 'text-green-400' : 'text-yellow-400'" class="text-sm font-medium">
            {{ enabled ? $t('profile.twoFactorAuth.enabled') : $t('profile.twoFactorAuth.notEnabled') }}
          </span>
        </div>
        <button 
          v-if="!enabled"
          :disabled="loading"
          class="btn-primary text-sm"
          @click="startSetup"
        >
          {{ loading ? $t('profile.twoFactorAuth.loading') : $t('profile.twoFactorAuth.enable') }}
        </button>
        <button 
          v-else
          class="btn-secondary text-sm"
          @click="disableMode = true"
        >
          {{ $t('profile.twoFactorAuth.disable') }}
        </button>
      </div>
      <p class="text-xs text-themed-muted">
        {{ $t('profile.twoFactorAuth.description') }}
      </p>

      <!-- Recovery codes status -->
      <div v-if="enabled && recoveryCodesStatus" class="mt-4 p-3 bg-themed-tertiary rounded">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm text-themed-primary">{{ $t('profile.twoFactorAuth.recoveryCodesStatus') }}</span>
          <button 
            class="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            @click="regenerateMode = true"
          >
            {{ $t('profile.twoFactorAuth.regenerate') }}
          </button>
        </div>
        <div class="flex items-center space-x-4 text-xs">
          <span class="text-themed-muted">
            {{ $t('profile.twoFactorAuth.remaining') }}: <span class="text-themed-primary font-medium">{{ recoveryCodesStatus.remaining }}</span> / {{ recoveryCodesStatus.total }}
          </span>
          <span v-if="recoveryCodesStatus.used > 0" class="text-yellow-400">
            {{ $t('profile.twoFactorAuth.used') }}: {{ recoveryCodesStatus.used }}
          </span>
        </div>
        <p v-if="recoveryCodesStatus.remaining <= 2" class="text-xs text-red-400 mt-2">
          ⚠️ {{ $t('profile.twoFactorAuth.lowCodesWarning') }}
        </p>
      </div>
    </div>

    <!-- Setup mode -->
    <div v-if="setupMode" class="space-y-4">
      <div class="text-sm text-themed-primary mb-2">{{ $t('profile.twoFactorAuth.setup') }}</div>
      
      <div class="flex flex-col items-center space-y-3">
        <p class="text-xs text-themed-muted text-center">
          {{ $t('profile.twoFactorAuth.scanQrCode') }}
        </p>
        <img v-if="qrCode" :src="qrCode" alt="2FA QR Code" class="w-48 h-48 bg-white p-2 rounded" />
        <div class="text-xs text-themed-muted">
          {{ $t('profile.twoFactorAuth.manualEntry') }}：<code class="bg-themed-tertiary px-2 py-1 rounded text-themed-primary">{{ secret }}</code>
        </div>
      </div>

      <div v-if="recoveryCodes.length" class="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
        <p class="text-xs text-yellow-400 mb-2">⚠️ {{ $t('profile.twoFactorAuth.saveRecoveryCodes') }}：</p>
        <div class="grid grid-cols-2 gap-1">
          <code v-for="code in recoveryCodes" :key="code" class="text-xs text-themed-primary bg-themed-tertiary px-2 py-1 rounded">
            {{ code }}
          </code>
        </div>
      </div>

      <div class="mt-4">
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.enterCode') }}</label>
        <input 
          v-model="verifyCode"
          type="text"
          maxlength="6"
          class="input"
          :placeholder="$t('profile.twoFactorAuth.codePlaceholder')"
        />
      </div>

      <div class="flex space-x-3">
        <button :disabled="loading" class="btn-primary" @click="confirmEnable">
          {{ loading ? $t('profile.twoFactorAuth.verifying') : $t('profile.twoFactorAuth.confirmEnable') }}
        </button>
        <button class="btn-secondary" @click="cancelSetup">{{ $t('profile.twoFactorAuth.cancel') }}</button>
      </div>
    </div>

    <!-- Disable mode -->
    <div v-if="disableMode" class="space-y-4">
      <div class="text-sm text-themed-primary mb-2">{{ $t('profile.twoFactorAuth.disableTitle') }}</div>
      <p class="text-xs text-themed-muted">{{ $t('profile.twoFactorAuth.disableDesc') }}</p>
      
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.password') }}</label>
        <input 
          v-model="disablePassword"
          type="password"
          class="input"
          :placeholder="$t('profile.twoFactorAuth.passwordPlaceholder')"
        />
      </div>
      <div>
        <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.verificationCode') }}</label>
        <input 
          v-model="disableCode"
          type="text"
          maxlength="6"
          class="input"
          :placeholder="$t('profile.twoFactorAuth.codePlaceholder')"
        />
      </div>

      <div class="flex space-x-3">
        <button :disabled="loading" class="btn-danger" @click="confirmDisable">
          {{ loading ? $t('profile.twoFactorAuth.processing') : $t('profile.twoFactorAuth.confirmDisable') }}
        </button>
        <button class="btn-secondary" @click="cancelDisable">{{ $t('profile.twoFactorAuth.cancel') }}</button>
      </div>
    </div>

    <!-- Regenerate recovery codes mode -->
    <div v-if="regenerateMode" class="space-y-4">
      <div class="text-sm text-themed-primary mb-2">{{ $t('profile.twoFactorAuth.regenerateTitle') }}</div>
      <p class="text-xs text-themed-muted">{{ $t('profile.twoFactorAuth.regenerateDesc') }}</p>
      
      <!-- Show new codes if generated -->
      <div v-if="newRecoveryCodes.length" class="p-3 bg-green-500/10 border border-green-500/30 rounded">
        <p class="text-xs text-green-400 mb-2">✓ {{ $t('profile.twoFactorAuth.newCodesGenerated') }}：</p>
        <div class="grid grid-cols-2 gap-1">
          <code v-for="code in newRecoveryCodes" :key="code" class="text-xs text-themed-primary bg-themed-tertiary px-2 py-1 rounded">
            {{ code }}
          </code>
        </div>
        <button class="btn-primary text-sm mt-3" @click="cancelRegenerate">{{ $t('profile.twoFactorAuth.done') }}</button>
      </div>

      <!-- Input form -->
      <template v-else>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.password') }}</label>
          <input 
            v-model="regeneratePassword"
            type="password"
            class="input"
            :placeholder="$t('profile.twoFactorAuth.passwordPlaceholder')"
          />
        </div>
        <div>
          <label class="block text-xs text-themed-muted mb-1.5">{{ $t('profile.twoFactorAuth.verificationCode') }}</label>
          <input 
            v-model="regenerateCode"
            type="text"
            maxlength="6"
            class="input"
            :placeholder="$t('profile.twoFactorAuth.codePlaceholder')"
          />
        </div>

        <div class="flex space-x-3">
          <button :disabled="loading" class="btn-primary" @click="confirmRegenerate">
            {{ loading ? $t('profile.twoFactorAuth.generating') : $t('profile.twoFactorAuth.confirmGenerate') }}
          </button>
          <button class="btn-secondary" @click="cancelRegenerate">{{ $t('profile.twoFactorAuth.cancel') }}</button>
        </div>
      </template>
    </div>

    <!-- Messages -->
    <div v-if="error" class="mt-3 text-sm text-red-400">{{ error }}</div>
    <div v-if="success" class="mt-3 text-sm text-green-400">{{ success }}</div>
  </div>
</template>
