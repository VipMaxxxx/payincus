<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import FlagIcon from '@/components/FlagIcon.vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{
  visible: boolean
  packageId: number
  packageName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success'): void
}>()

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

// 数据
interface HostDetail {
  id: number
  name: string
  countryCode: string
  cpuAllowanceMax: number
  memoryMax: number
  cpuUsed: number
  memoryUsed: number
}

interface GlobalChannel {
  id: number
  name: string
  type: string
}

const hosts = ref<HostDetail[]>([])
const globalChannel = ref<GlobalChannel | null>(null)
const packageCpuMax = ref(0)
const packageMemoryMax = ref(0)
const loading = ref(false)
const submitting = ref(false)

// 选中的宿主机
const selectedHostIds = ref<number[]>([])

// 是否发送通知复选框
const notifyEnabled = ref(true)

// CPU和内存增量
const cpuAddInput = ref(50)
const memoryAddInput = ref(64)

// 快捷选项
const cpuPresets = [50, 100, 200, 400]
const memoryPresets = [64, 128, 256, 512]

// 格式化内存
function formatMemory(mb: number): string {
  if (!mb) return '0 MB'
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return mb + ' MB'
}

// 加载数据
async function loadData() {
  if (!props.packageId) return
  loading.value = true
  try {
    const [detailRes, channelsRes] = await Promise.all([
      api.packages.getHostsDetail(props.packageId),
      api.notifications.getGlobalChannels()
    ])
    
    hosts.value = detailRes.hosts || []
    packageCpuMax.value = detailRes.cpuMax
    packageMemoryMax.value = detailRes.memoryMax
    // 获取全局通知渠道（取第一个）
    const channels = channelsRes.channels || []
    globalChannel.value = channels.length > 0 ? channels[0] : null
    // 如果有全局渠道，默认勾选"发送通知"
    notifyEnabled.value = !!globalChannel.value
    
    // 默认全选所有宿主机
    selectedHostIds.value = hosts.value.map(h => h.id)
  } catch (err: any) {
    toast.error(err.message || t('quotaRelease.loadFailed'))
  } finally {
    loading.value = false
  }
}

// 切换宿主机选中状态
function toggleHost(hostId: number) {
  const index = selectedHostIds.value.indexOf(hostId)
  if (index === -1) {
    selectedHostIds.value.push(hostId)
  } else {
    selectedHostIds.value.splice(index, 1)
  }
}

// 全选/取消全选
function toggleAll() {
  if (selectedHostIds.value.length === hosts.value.length) {
    selectedHostIds.value = []
  } else {
    selectedHostIds.value = hosts.value.map(h => h.id)
  }
}

// 释放配额
async function releaseQuota() {
  if (selectedHostIds.value.length === 0) {
    toast.error(t('quotaRelease.selectHost'))
    return
  }
  if (cpuAddInput.value <= 0 && memoryAddInput.value <= 0) {
    toast.error(t('quotaRelease.enterQuota'))
    return
  }
  
  submitting.value = true
  try {
    const res = await api.packages.releaseQuota(props.packageId, {
      hostIds: selectedHostIds.value,
      cpuAdd: cpuAddInput.value,
      memoryAdd: memoryAddInput.value,
      notify: notifyEnabled.value && !!globalChannel.value
    })
    
    toast.success(t('quotaRelease.success', { count: res.results.length }))
    emit('success')
    emit('close')
  } catch (err: any) {
    toast.error(err.message || t('quotaRelease.failed'))
  } finally {
    submitting.value = false
  }
}

// 监听弹窗显示
watch(() => props.visible, (val) => {
  if (val) {
    loadData()
  } else {
    // 重置状态
    selectedHostIds.value = []
    cpuAddInput.value = 50
    memoryAddInput.value = 64
    notifyEnabled.value = true
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay">
        <div class="modal-backdrop" @click="emit('close')"></div>
        <div class="modal-content max-w-2xl">
          <div class="modal-header">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-teal-500/20' : 'bg-teal-100'">
                <svg class="w-5 h-5" :class="themeStore.isDark ? 'text-teal-400' : 'text-teal-600'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <div>
                <h3 class="modal-title">{{ t('quotaRelease.title') }}</h3>
                <p class="text-xs text-themed-muted mt-0.5">{{ packageName }}</p>
              </div>
            </div>
            <button class="p-1.5 rounded-lg transition-colors" :class="themeStore.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'" @click="emit('close')">
              <svg class="w-5 h-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="modal-body">
            <SkeletonLoader v-if="loading" type="card" />
            
            <template v-else>
              <!-- 套餐配额信息 -->
              <div class="mb-4 p-3 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-50'">
                <div class="flex items-center justify-between text-sm">
                  <span class="text-themed-muted">{{ t('quotaRelease.packageQuota') }}</span>
                  <span class="font-mono" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-600'">
                    {{ packageCpuMax }}% CPU · {{ formatMemory(packageMemoryMax) }}
                  </span>
                </div>
              </div>

              <!-- 无宿主机 -->
              <div v-if="hosts.length === 0" class="text-center py-10">
                <div class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'">
                  <svg class="w-8 h-8" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                  </svg>
                </div>
                <p class="text-themed-secondary font-medium">{{ t('quotaRelease.noHosts') }}</p>
                <p class="text-xs text-themed-muted mt-1">{{ t('quotaRelease.noHostsHint') }}</p>
              </div>

              <template v-else>
                <!-- 选择宿主机 -->
                <div class="mb-4">
                  <div class="flex items-center justify-between mb-2">
                    <label class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                      {{ t('quotaRelease.selectHosts') }}
                    </label>
                    <button 
                      type="button"
                      class="text-xs px-2 py-1 rounded transition-colors"
                      :class="themeStore.isDark ? 'text-blue-400 hover:bg-gray-800' : 'text-blue-600 hover:bg-gray-100'"
                      @click="toggleAll"
                    >
                      {{ selectedHostIds.length === hosts.length ? t('quotaRelease.deselectAll') : t('quotaRelease.selectAll') }}
                    </button>
                  </div>
                  
                  <div class="space-y-2 max-h-48 overflow-y-auto">
                    <button
                      v-for="host in hosts"
                      :key="host.id"
                      type="button"
                      class="w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left"
                      :class="[
                        selectedHostIds.includes(host.id)
                          ? themeStore.isDark
                            ? 'border-teal-500 bg-teal-500/10 ring-1 ring-teal-500/30'
                            : 'border-teal-500 bg-teal-50 ring-1 ring-teal-200'
                          : themeStore.isDark
                            ? 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      ]"
                      @click="toggleHost(host.id)"
                    >
                      <!-- 复选框 -->
                      <div
                        class="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                        :class="[
                          selectedHostIds.includes(host.id)
                            ? 'border-teal-500 bg-teal-500'
                            : themeStore.isDark
                              ? 'border-gray-600'
                              : 'border-gray-300'
                        ]"
                      >
                        <svg v-if="selectedHostIds.includes(host.id)" class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                      </div>
                      
                      <!-- 国旗 -->
                      <FlagIcon :code="host.countryCode" size="sm" />
                      
                      <!-- 宿主机信息 -->
                      <div class="flex-1 min-w-0">
                        <div class="font-medium truncate" :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'">
                          {{ host.name }}
                        </div>
                        <div class="text-xs text-themed-muted">
                          {{ t('quotaRelease.available') }}: {{ host.cpuAllowanceMax - host.cpuUsed }}% CPU · {{ formatMemory(host.memoryMax - host.memoryUsed) }}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                <!-- 增量配置 -->
                <div class="mb-4 p-4 rounded-xl border" :class="themeStore.isDark ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50/50'">
                  <h4 class="text-sm font-medium mb-3" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                    {{ t('quotaRelease.quotaToAdd') }}
                  </h4>
                  
                  <div class="grid grid-cols-2 gap-4">
                    <!-- CPU -->
                    <div>
                      <label class="block text-xs text-themed-muted mb-1.5">CPU (%)</label>
                      <input 
                        v-model.number="cpuAddInput" 
                        type="number" 
                        class="input text-sm w-full mb-2"
                        min="10"
                        step="5"
                      />
                      <div class="flex flex-wrap gap-1">
                        <button
                          v-for="preset in cpuPresets"
                          :key="preset"
                          type="button"
                          class="px-2 py-1 text-xs rounded transition-colors"
                          :class="[
                            cpuAddInput === preset
                              ? themeStore.isDark ? 'bg-teal-500/20 text-teal-400' : 'bg-teal-100 text-teal-600'
                              : themeStore.isDark ? 'bg-gray-700 text-gray-400 hover:bg-gray-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                          ]"
                          @click="cpuAddInput = preset"
                        >
                          +{{ preset }}%
                        </button>
                      </div>
                    </div>
                    
                    <!-- 内存 -->
                    <div>
                      <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.packages.memory') }} (MB)</label>
                      <input 
                        v-model.number="memoryAddInput" 
                        type="number" 
                        class="input text-sm w-full mb-2"
                        min="32"
                        step="32"
                      />
                      <div class="flex flex-wrap gap-1">
                        <button
                          v-for="preset in memoryPresets"
                          :key="preset"
                          type="button"
                          class="px-2 py-1 text-xs rounded transition-colors"
                          :class="[
                            memoryAddInput === preset
                              ? themeStore.isDark ? 'bg-teal-500/20 text-teal-400' : 'bg-teal-100 text-teal-600'
                              : themeStore.isDark ? 'bg-gray-700 text-gray-400 hover:bg-gray-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                          ]"
                          @click="memoryAddInput = preset"
                        >
                          +{{ formatMemory(preset) }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 预览 -->
                  <div v-if="selectedHostIds.length > 0" class="mt-4 pt-3 border-t" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-200'">
                    <div class="text-xs text-themed-muted">
                      {{ t('quotaRelease.preview', { count: selectedHostIds.length, cpu: cpuAddInput, memory: formatMemory(memoryAddInput) }) }}
                    </div>
                  </div>
                </div>
              </template>

              <!-- 通知设置 -->
              <div class="p-4 rounded-xl border" :class="[themeStore.isDark ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50/50', hosts.length === 0 ? 'mt-4' : '']">
                <div class="flex items-center gap-2 mb-3">
                  <svg class="w-4 h-4" :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <h4 class="text-sm font-medium" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                    {{ t('quotaRelease.notificationChannel') }}
                  </h4>
                </div>
                
                <template v-if="globalChannel">
                  <!-- 是否发送通知复选框 -->
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input 
                      v-model="notifyEnabled" 
                      type="checkbox" 
                      class="w-4 h-4 rounded border-2 transition-colors"
                      :class="[
                        notifyEnabled
                          ? 'border-teal-500 bg-teal-500 text-white'
                          : themeStore.isDark
                            ? 'border-gray-600 bg-transparent'
                            : 'border-gray-300 bg-transparent'
                      ]"
                    />
                    <span class="text-sm" :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'">
                      {{ t('quotaRelease.sendNotification') }}
                    </span>
                    <span class="text-xs text-themed-muted">
                      ({{ globalChannel.name }})
                    </span>
                  </label>
                </template>
                <template v-else>
                  <div class="text-sm py-2 px-3 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'">
                    {{ t('quotaRelease.noGlobalChannel') }}
                  </div>
                  <p class="text-xs text-themed-muted mt-1.5">{{ t('quotaRelease.noGlobalChannelHint') }}</p>
                </template>
              </div>
            </template>
          </div>

          <div class="modal-footer">
            <button class="btn-secondary" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button
              :disabled="submitting || hosts.length === 0 || selectedHostIds.length === 0"
              class="btn-primary"
              @click="releaseQuota"
            >
              <span v-if="submitting" class="loading-spinner w-4 h-4"></span>
              <template v-else>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                {{ t('quotaRelease.confirm') }}
              </template>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
