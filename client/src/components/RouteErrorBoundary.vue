<script setup lang="ts">
import { onErrorCaptured, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { isStaleAssetLoadError } from '@/utils/staleAssetRecovery'

const { t } = useI18n()
const route = useRoute()

const failed = ref(false)

onErrorCaptured((err) => {
  // 陈旧静态资源错误必须继续上抛：上层的 staleAssetRecovery 会自动刷新一次拿到新 chunk，
  // 在这里兜底反而会把用户永久困在错误界面。
  if (isStaleAssetLoadError(err)) return true

  console.error('页面渲染出错，已显示兜底界面：', err)
  failed.value = true
  return false
})

// 切到别的路由时清掉错误态，否则会一直卡在兜底界面上。
watch(() => route.fullPath, () => {
  failed.value = false
})

// v-if 切回来时子树是全新挂载的实例（出错的那个已经被卸载），因此会重新走一遍加载逻辑。
function retry() {
  failed.value = false
}

function reload() {
  window.location.reload()
}
</script>

<template>
  <div v-if="failed" class="card flex flex-col items-center justify-center gap-3 p-10 text-center">
    <p class="text-base font-semibold">{{ t('common.loadFailed') }}</p>
    <p class="text-themed-muted text-sm">{{ t('error.pageErrorDesc') }}</p>
    <div class="flex gap-2">
      <button type="button" class="btn-primary btn-sm" @click="retry">{{ t('common.retry') }}</button>
      <button type="button" class="btn-secondary btn-sm" @click="reload">{{ t('common.refresh') }}</button>
    </div>
  </div>
  <slot v-else />
</template>
