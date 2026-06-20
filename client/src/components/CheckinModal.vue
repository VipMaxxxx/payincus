<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { translateError } from '@/utils/errorHandler'
import FlagIcon from '@/components/FlagIcon.vue'

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

interface Props {
  show: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

// 当前选中的 Tab
const activeTab = ref<'checkin' | 'redeem' | 'records'>('checkin')

// 规则说明展开状态
const showRules = ref(false)

// 加载状态
const loading = ref(false)
const checkinLoading = ref(false)
const redeemLoading = ref(false)

// 抽奖动画状态
const lotteryPhase = ref<'idle' | 'shaking' | 'opening' | 'revealing' | 'done'>('idle')
const revealedReward = ref<{ type: string; value: number; bonusPoints: number } | null>(null)
const confettiParticles = ref<Array<{ id: number; x: number; delay: number; color: string; size: number }>>([]);

// 签到状态
const checkinStatus = ref<{
  hasCheckedIn: boolean
  hasInstances: boolean
  selfOnlyMode: boolean
  consecutiveOthersUse: number
} | null>(null)

// 兑换码输入
const redeemCodeInput = ref('')
const selectedInstanceId = ref<number | null>(null)

// 可用实例列表
const instances = ref<Array<{
  id: number
  name: string
  status: string
  cpu: number
  memory: number
  disk: number
  monthlyTrafficLimit: string | null
  package: {
    id: number
    name: string
    cpuMax: number
    memoryMax: number
    diskMax: number
    monthlyTrafficLimit: string | null
  } | null
  host: {
    id: number
    name: string
    location: string | null
    countryCode: string
  }
}>>([])

// 签到记录
const checkinRecords = ref<Array<{
  id: number
  redeemCode: string
  codeType: string
  codeValue: number
  expiresAt: string
  usedAt: string | null
  usedBy: { id: number; username: string } | null
  usedFor: { id: number; name: string } | null
  createdAt: string
}>>([])

// 兑换记录
const redeemRecords = ref<Array<{
  id: number
  redeemCode: string
  codeType: string
  codeValue: number
  owner: { id: number; username: string }
  usedFor: { id: number; name: string } | null
  usedAt: string | null
  isSystemCode?: boolean
}>>([])

// 资源类型名称和单位
const getResourceTypeName = (type: string) => {
  const map: Record<string, string> = {
    c: t('checkin.cpu'),
    r: t('checkin.memory'),
    d: t('checkin.disk'),
    t: t('checkin.traffic'),
    p: t('checkin.points')
  }
  return map[type] || type.toUpperCase()
}

const getResourceUnit = (type: string) => {
  const map: Record<string, string> = {
    c: t('checkin.percent'),
    r: t('checkin.mb'),
    d: t('checkin.mb'),
    t: t('checkin.gb'),
    p: ''  // 积分无单位
  }
  return map[type] || ''
}

// 资源类型对应的颜色
const getResourceColor = (type: string) => {
  const map: Record<string, string> = {
    c: 'text-blue-500',
    r: 'text-purple-500',
    d: 'text-amber-500',
    t: 'text-emerald-500',
    p: 'text-yellow-500'  // 积分使用金色
  }
  return map[type] || 'text-gray-500'
}

const getResourceBgColor = (type: string) => {
  const map: Record<string, string> = {
    c: 'bg-blue-500/10',
    r: 'bg-purple-500/10',
    d: 'bg-amber-500/10',
    t: 'bg-emerald-500/10',
    p: 'bg-yellow-500/10'  // 积分使用金色背景
  }
  return map[type] || 'bg-gray-500/10'
}

// 资源类型图标
const getResourceIcon = (type: string) => {
  return {
    c: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z', // CPU
    r: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', // Memory
    d: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4', // Disk
    t: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12', // Traffic
    p: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' // Points (Star)
  }[type] || 'M13 10V3L4 14h7v7l9-11h-7z'
}

// 生成彩色纸屑粒子
const generateConfetti = () => {
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff', '#5f27cd']
  const particles: typeof confettiParticles.value = []
  for (let i = 0; i < 50; i++) {
    particles.push({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 0.5,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 4
    })
  }
  confettiParticles.value = particles
}

// 加载签到状态
const loadCheckinStatus = async () => {
  try {
    loading.value = true
    checkinStatus.value = await api.checkin.getStatus()
  } catch (err: any) {
    console.error('Failed to load checkin status:', err)
  } finally {
    loading.value = false
  }
}

// 加载实例列表
const loadInstances = async () => {
  try {
    const res = await api.checkin.getInstances()
    instances.value = res.instances
    // 如果当前选中的实例不在新列表中，重置选择
    if (selectedInstanceId.value && !res.instances.some(i => i.id === selectedInstanceId.value)) {
      selectedInstanceId.value = null
    }
  } catch (err: any) {
    console.error('Failed to load instances:', err)
  }
}

// 记录总数（用于显示提示）
const checkinTotal = ref(0)
const redeemTotal = ref(0)

// 加载签到记录（只取最近5条）
const loadCheckinRecords = async () => {
  try {
    const res = await api.checkin.getRecords({ limit: 5 })
    checkinRecords.value = res.records
    checkinTotal.value = res.total
  } catch (err: any) {
    console.error('Failed to load checkin records:', err)
  }
}

// 加载兑换记录（只取最近5条）
const loadRedeemRecords = async () => {
  try {
    const res = await api.checkin.getRedeems({ limit: 5 })
    redeemRecords.value = res.records
    redeemTotal.value = res.total
  } catch (err: any) {
    console.error('Failed to load redeem records:', err)
  }
}

// 执行签到（带动画）
const doCheckin = async () => {
  try {
    checkinLoading.value = true
    lotteryPhase.value = 'shaking'
    
    // 摇晃动画 1.2秒
    await new Promise(resolve => setTimeout(resolve, 1200))
    
    // 打开礼盒
    lotteryPhase.value = 'opening'
    await new Promise(resolve => setTimeout(resolve, 600))
    
    // 调用API
    const result = await api.checkin.checkin()
    
    // 揭晓奖励
    lotteryPhase.value = 'revealing'
    revealedReward.value = {
      type: result.codeType,
      value: result.codeValue,
      bonusPoints: result.bonusPoints
    }
    generateConfetti()
    
    await new Promise(resolve => setTimeout(resolve, 100))
    await nextTick()
    
    // 完成
    lotteryPhase.value = 'done'
    
    // 重新加载状态
    await loadCheckinStatus()
    await loadCheckinRecords()
    
    // 3秒后清除彩色纸屑
    setTimeout(() => {
      confettiParticles.value = []
    }, 3000)
  } catch (err: unknown) {
    toast.error(translateError(err))
    lotteryPhase.value = 'idle'
    revealedReward.value = null
  } finally {
    checkinLoading.value = false
  }
}

// 兑换兑换码
const doRedeem = async () => {
  if (!redeemCodeInput.value.trim()) {
    toast.error(t('checkin.inputCode'))
    return
  }
  if (!selectedInstanceId.value) {
    toast.error(t('checkin.selectInstance'))
    return
  }
  
  try {
    redeemLoading.value = true
    const result = await api.checkin.redeem(redeemCodeInput.value.trim(), selectedInstanceId.value)
    
    // 检查是否发生了截断（实际增量 < 兑换码面值）
    const actualAdded = result.actualAdded ?? result.codeValue
    if (actualAdded < result.codeValue) {
      // 部分应用，提示用户
      toast.success(`${t('checkin.redeemSuccess')}: ${getResourceTypeName(result.codeType)} +${actualAdded}${getResourceUnit(result.codeType)} (${t('checkin.cappedFromPackageLimit')})`)
    } else {
      toast.success(`${t('checkin.redeemSuccess')}: ${getResourceTypeName(result.codeType)} +${result.codeValue}${getResourceUnit(result.codeType)}`)
    }
    
    // 清空输入
    redeemCodeInput.value = ''
    selectedInstanceId.value = null
    
    // 重新加载
    await loadCheckinStatus()
    await loadRedeemRecords()
  } catch (err: unknown) {
    toast.error(translateError(err))
  } finally {
    redeemLoading.value = false
  }
}

// 格式化日期
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleString()
}

// 监听弹窗显示
watch(() => props.show, async (newVal) => {
  if (newVal) {
    activeTab.value = 'checkin'
    await loadCheckinStatus()
    await loadInstances()
  }
})

// 监听 Tab 切换
watch(activeTab, async (newTab) => {
  if (newTab === 'records') {
    await Promise.all([loadCheckinRecords(), loadRedeemRecords()])
  }
})

// 关闭弹窗
const close = () => {
  emit('update:show', false)
  // 重置状态
  setTimeout(() => {
    lotteryPhase.value = 'idle'
    revealedReward.value = null
    confettiParticles.value = []
    showRules.value = false
    // 重置兑换表单
    redeemCodeInput.value = ''
    selectedInstanceId.value = null
  }, 300)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay">
        <div class="modal-backdrop" @click="close" />
        <div class="modal-content max-w-xl">
          <div class="modal-header">
            <div class="flex items-center gap-2">
              <h3 class="modal-title">{{ t('checkin.title') }}</h3>
              <button
                type="button"
                class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                :class="showRules ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-500' : 'text-gray-400'"
                :title="t('checkin.rulesTitle')"
                @click="showRules = !showRules"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              @click="close"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <!-- 规则说明面板 -->
          <Transition
            enter-active-class="transition-all duration-200 ease-out"
            enter-from-class="opacity-0 -translate-y-2 max-h-0"
            enter-to-class="opacity-100 translate-y-0 max-h-96"
            leave-active-class="transition-all duration-150 ease-in"
            leave-from-class="opacity-100 translate-y-0 max-h-96"
            leave-to-class="opacity-0 -translate-y-2 max-h-0"
          >
            <div v-if="showRules" class="overflow-hidden">
              <div class="px-4 py-3 text-sm" :class="themeStore.isDark ? 'bg-gray-800/50' : 'bg-gray-50'">
                <div class="space-y-3">
                  <!-- 签到规则 -->
                  <div>
                    <h4 class="font-medium text-themed mb-1.5">{{ t('checkin.rulesCheckin') }}</h4>
                    <ul class="space-y-1 text-themed-secondary text-xs">
                      <li class="flex items-start gap-1.5">
                        <span class="text-blue-500 mt-0.5">•</span>
                        <span>{{ t('checkin.rulesCheckin1') }}</span>
                      </li>
                      <li class="flex items-start gap-1.5">
                        <span class="text-blue-500 mt-0.5">•</span>
                        <span>{{ t('checkin.rulesCheckin2') }}</span>
                      </li>
                      <li class="flex items-start gap-1.5">
                        <span class="text-blue-500 mt-0.5">•</span>
                        <span>{{ t('checkin.rulesCheckin3') }}</span>
                      </li>
                    </ul>
                  </div>
                  <!-- 兑换规则 -->
                  <div>
                    <h4 class="font-medium text-themed mb-1.5">{{ t('checkin.rulesRedeem') }}</h4>
                    <ul class="space-y-1 text-themed-secondary text-xs">
                      <li class="flex items-start gap-1.5">
                        <span class="text-purple-500 mt-0.5">•</span>
                        <span>{{ t('checkin.rulesRedeem1') }}</span>
                      </li>
                      <li class="flex items-start gap-1.5">
                        <span class="text-purple-500 mt-0.5">•</span>
                        <span>{{ t('checkin.rulesRedeem2') }}</span>
                      </li>
                      <li class="flex items-start gap-1.5">
                        <span class="text-purple-500 mt-0.5">•</span>
                        <span>{{ t('checkin.rulesRedeem3') }}</span>
                      </li>
                    </ul>
                  </div>
                  <!-- 分享规则 -->
                  <div>
                    <h4 class="font-medium text-themed mb-1.5">{{ t('checkin.rulesShare') }}</h4>
                    <ul class="space-y-1 text-themed-secondary text-xs">
                      <li class="flex items-start gap-1.5">
                        <span class="text-emerald-500 mt-0.5">•</span>
                        <span>{{ t('checkin.rulesShare1') }}</span>
                      </li>
                      <li class="flex items-start gap-1.5">
                        <span class="text-emerald-500 mt-0.5">•</span>
                        <span>{{ t('checkin.rulesShare2') }}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
          
          <!-- Tabs -->
          <div class="border-b border-gray-200 dark:border-gray-700">
            <nav class="flex -mb-px">
              <button
                v-for="tab in ['checkin', 'redeem', 'records'] as const"
                :key="tab"
                :class="[
                  'py-3 px-4 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                ]"
                @click="activeTab = tab"
              >
                {{ t(`checkin.${tab}Tab`) }}
              </button>
            </nav>
          </div>
          
          <div class="modal-body min-h-[300px] relative overflow-hidden">
            <!-- 彩色纸屑效果 -->
            <div v-if="confettiParticles.length > 0" class="absolute inset-0 pointer-events-none overflow-hidden z-10">
              <div
                v-for="p in confettiParticles"
                :key="p.id"
                class="confetti-particle absolute"
                :style="{
                  left: `${p.x}%`,
                  animationDelay: `${p.delay}s`,
                  backgroundColor: p.color,
                  width: `${p.size}px`,
                  height: `${p.size}px`
                }"
              />
            </div>
            
            <!-- 签到 Tab -->
            <div v-if="activeTab === 'checkin'" class="space-y-4">
              <!-- 加载中 -->
              <div v-if="loading" class="flex items-center justify-center py-12">
                <div class="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full"></div>
              </div>
              
              <!-- 已签到 - 资源已存入资源池 -->
              <template v-else-if="checkinStatus?.hasCheckedIn">
                <div class="text-center py-8">
                  <div class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-green-500/10">
                    <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p class="text-lg font-medium text-themed mb-2">{{ t('checkin.alreadyCheckedIn') }}</p>
                  <p class="text-sm text-themed-muted">{{ t('checkin.savedToPool') }}</p>
                </div>
              </template>
              
              <!-- 未签到 - 抽奖界面 -->
              <template v-else-if="checkinStatus">
                <div class="flex flex-col items-center justify-center py-6">
                  <!-- 礼盒动画区域 -->
                  <div class="relative w-32 h-32 sm:w-40 sm:h-40 mb-6">
                    <!-- 光晕背景 -->
                    <div 
                      class="absolute inset-0 rounded-full transition-all duration-500"
                      :class="[
                        lotteryPhase === 'idle' ? 'opacity-0 scale-90' : 'opacity-100 scale-100',
                        lotteryPhase === 'shaking' ? 'animate-pulse bg-gradient-to-br from-amber-200/50 to-orange-300/50 dark:from-amber-500/20 dark:to-orange-600/20' : '',
                        lotteryPhase === 'opening' || lotteryPhase === 'revealing' || lotteryPhase === 'done' ? 'bg-gradient-to-br from-amber-200/30 to-orange-300/30 dark:from-amber-500/10 dark:to-orange-600/10' : ''
                      ]"
                    />
                    
                    <!-- 礼盒图标 -->
                    <div 
                      class="gift-box absolute inset-0 flex items-center justify-center cursor-pointer select-none"
                      :class="{
                        'gift-shake': lotteryPhase === 'shaking',
                        'gift-open': lotteryPhase === 'opening' || lotteryPhase === 'revealing' || lotteryPhase === 'done',
                        'hover:scale-105 active:scale-95': lotteryPhase === 'idle' && checkinStatus.hasInstances && !checkinLoading
                      }"
                      @click="lotteryPhase === 'idle' && checkinStatus.hasInstances && !checkinLoading && doCheckin()"
                    >
                      <!-- 礼盒本体 -->
                      <div v-if="lotteryPhase !== 'revealing' && lotteryPhase !== 'done'" class="relative">
                        <div class="text-6xl sm:text-7xl transition-transform duration-300">
                          🎁
                        </div>
                        <!-- 闪光效果 -->
                        <div v-if="lotteryPhase === 'idle'" class="absolute -top-1 -right-1">
                          <div class="w-3 h-3 bg-yellow-400 rounded-full animate-ping"></div>
                          <div class="absolute inset-0 w-3 h-3 bg-yellow-400 rounded-full"></div>
                        </div>
                      </div>
                      
                      <!-- 开奖结果 -->
                      <Transition
                        enter-active-class="transition-all duration-500 ease-out"
                        enter-from-class="opacity-0 scale-0 rotate-180"
                        enter-to-class="opacity-100 scale-100 rotate-0"
                      >
                        <div 
                          v-if="(lotteryPhase === 'revealing' || lotteryPhase === 'done') && revealedReward" 
                          class="reward-card flex gap-3"
                        >
                          <!-- 资源奖励 -->
                          <div 
                            class="flex flex-col items-center justify-center p-3 rounded-xl flex-1"
                            :class="getResourceBgColor(revealedReward.type)"
                          >
                            <svg class="w-8 h-8 mb-1" :class="getResourceColor(revealedReward.type)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="getResourceIcon(revealedReward.type)" />
                            </svg>
                            <div class="text-xs font-medium" :class="getResourceColor(revealedReward.type)">
                              {{ getResourceTypeName(revealedReward.type) }}
                            </div>
                            <div class="text-xl font-bold" :class="getResourceColor(revealedReward.type)">
                              +{{ revealedReward.value }}{{ getResourceUnit(revealedReward.type) }}
                            </div>
                          </div>
                          <!-- 积分奖励 -->
                          <div 
                            class="flex flex-col items-center justify-center p-3 rounded-xl flex-1 bg-yellow-500/10"
                          >
                            <svg class="w-8 h-8 mb-1 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="getResourceIcon('p')" />
                            </svg>
                            <div class="text-xs font-medium text-yellow-500">
                              {{ t('checkin.points') }}
                            </div>
                            <div class="text-xl font-bold text-yellow-500">
                              +{{ revealedReward.bonusPoints }}
                            </div>
                          </div>
                        </div>
                      </Transition>
                    </div>
                  </div>
                  
                  <!-- 状态文字 -->
                  <div class="text-center">
                    <p v-if="lotteryPhase === 'idle'" class="text-base sm:text-lg text-themed-secondary mb-4">
                      {{ checkinStatus.hasInstances ? t('checkin.clickToOpen') : t('checkin.noInstance') }}
                    </p>
                    <p v-else-if="lotteryPhase === 'shaking'" class="text-base sm:text-lg text-amber-500 animate-pulse">
                      {{ t('checkin.opening') }}...
                    </p>
                    <p v-else-if="lotteryPhase === 'opening'" class="text-base sm:text-lg text-amber-500">
                      {{ t('checkin.revealing') }}...
                    </p>
                    <p v-else-if="lotteryPhase === 'revealing' || lotteryPhase === 'done'" class="text-base sm:text-lg font-medium text-themed">
                      {{ t('checkin.congratulations') }}
                    </p>
                  </div>
                  
                  <!-- 签到按钮（仅在 idle 状态且有实例时显示） -->
                  <button
                    v-if="lotteryPhase === 'idle' && checkinStatus.hasInstances"
                    class="mt-4 btn-primary px-8 py-3 text-base sm:text-lg rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
                    :disabled="checkinLoading"
                    @click="doCheckin"
                  >
                    <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                    </svg>
                    {{ t('checkin.checkinButton') }}
                  </button>
                  
                  <!-- 无实例提示 -->
                  <p v-if="!checkinStatus.hasInstances" class="mt-4 text-sm text-red-500">
                    {{ t('checkin.noInstance') }}
                  </p>
                </div>
              </template>
            </div>
            
            <!-- 兑换 Tab -->
            <div v-else-if="activeTab === 'redeem'" class="space-y-4">
              <!-- 兑换码输入 -->
              <div>
                <label class="block text-sm text-themed-secondary mb-1.5">{{ $t('checkin.redeemCode') }}</label>
                <input
                  v-model="redeemCodeInput"
                  type="text"
                  class="input font-mono"
                  :placeholder="$t('checkin.inputCode')"
                />
                <p class="text-xs text-themed-muted mt-1">{{ $t('checkin.redeemHint') }}</p>
              </div>
              
              <!-- 实例选择 -->
              <div>
                <label class="block text-sm text-themed-secondary mb-1.5">{{ $t('checkin.selectInstance') }}</label>
                <!-- 无可用免费实例提示 -->
                <div v-if="instances.length === 0" class="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50">
                  <div class="flex items-center gap-2">
                    <svg class="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span class="text-sm text-amber-700 dark:text-amber-400">{{ $t('checkin.noInstancesForRedeem') }}</span>
                  </div>
                </div>
                <!-- 实例下拉选择 -->
                <select
                  v-else
                  v-model="selectedInstanceId"
                  class="input"
                >
                  <option :value="null">{{ $t('checkin.selectInstanceHint') }}</option>
                  <option v-for="inst in instances" :key="inst.id" :value="inst.id">
                    {{ inst.name }} ({{ inst.host.name }})
                  </option>
                </select>
              </div>
              
              <!-- 选中实例的信息 -->
              <div v-if="selectedInstanceId" class="p-3 rounded-lg" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
                <template v-for="inst in instances.filter(i => i.id === selectedInstanceId)" :key="inst.id">
                  <div class="flex items-center gap-2 mb-2">
                    <FlagIcon :code="inst.host.countryCode" class="w-4 h-3" />
                    <span class="text-sm text-themed">{{ inst.host.name }}</span>
                  </div>
                  <div class="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span class="text-themed-muted">CPU</span>
                      <p class="text-themed">{{ inst.cpu }}%<span v-if="inst.package" class="text-themed-muted"> / {{ inst.package.cpuMax }}%</span></p>
                    </div>
                    <div>
                      <span class="text-themed-muted">{{ $t('checkin.memory') }}</span>
                      <p class="text-themed">{{ inst.memory }}MB<span v-if="inst.package" class="text-themed-muted"> / {{ inst.package.memoryMax }}MB</span></p>
                    </div>
                    <div>
                      <span class="text-themed-muted">{{ $t('checkin.disk') }}</span>
                      <p class="text-themed">{{ inst.disk }}MB<span v-if="inst.package" class="text-themed-muted"> / {{ inst.package.diskMax }}MB</span></p>
                    </div>
                  </div>
                </template>
              </div>
              
              <button
                class="btn-primary w-full"
                :disabled="redeemLoading || !redeemCodeInput.trim() || !selectedInstanceId"
                @click="doRedeem"
              >
                <svg v-if="redeemLoading" class="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ $t('checkin.redeemButton') }}
              </button>
            </div>
            
            <!-- 记录 Tab -->
            <div v-else-if="activeTab === 'records'" class="space-y-6">
              <!-- 签到记录 -->
              <div>
                <div class="flex items-center justify-between mb-3">
                  <h4 class="text-sm font-medium text-themed">{{ t('checkin.checkinRecords') }}</h4>
                  <span v-if="checkinTotal > 5" class="text-xs text-themed-muted">{{ t('checkin.showingRecent', { count: 5, total: checkinTotal }) }}</span>
                </div>
                <div v-if="checkinRecords.length === 0" class="text-center py-4 text-themed-secondary text-sm">
                  {{ t('checkin.noRecords') }}
                </div>
                <div v-else class="space-y-2 max-h-48 overflow-y-auto">
                  <div
                    v-for="record in checkinRecords"
                    :key="record.id"
                    class="p-3 rounded-lg text-sm"
                    :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
                  >
                    <div class="flex items-center justify-between mb-2">
                      <code class="font-mono text-xs">{{ record.redeemCode }}</code>
                      <span class="text-xs text-themed-muted">{{ formatDate(record.createdAt) }}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-themed">{{ getResourceTypeName(record.codeType) }} +{{ record.codeValue }}{{ getResourceUnit(record.codeType) }}</span>
                      <span v-if="record.usedAt" class="text-xs text-green-500">
                        {{ record.usedBy ? record.usedBy.username : t('checkin.self') }}
                      </span>
                      <span v-else-if="new Date(record.expiresAt) < new Date()" class="text-xs text-red-500">
                        {{ t('checkin.codeExpired') }}
                      </span>
                      <span v-else class="text-xs text-orange-500">
                        {{ t('checkin.unused') }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- 兑换记录 -->
              <div>
                <div class="flex items-center justify-between mb-3">
                  <h4 class="text-sm font-medium text-themed">{{ t('checkin.redeemRecords') }}</h4>
                  <span v-if="redeemTotal > 5" class="text-xs text-themed-muted">{{ t('checkin.showingRecent', { count: 5, total: redeemTotal }) }}</span>
                </div>
                <div v-if="redeemRecords.length === 0" class="text-center py-4 text-themed-secondary text-sm">
                  {{ t('checkin.noRecords') }}
                </div>
                <div v-else class="space-y-2 max-h-48 overflow-y-auto">
                  <div
                    v-for="record in redeemRecords"
                    :key="record.id"
                    class="p-3 rounded-lg text-sm"
                    :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'"
                  >
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-2">
                        <code class="font-mono text-xs">{{ record.redeemCode }}</code>
                        <span 
                          v-if="record.isSystemCode" 
                          class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                        >
                          → {{ record.owner.username }}
                        </span>
                      </div>
                      <span class="text-xs text-themed-muted">{{ record.usedAt ? formatDate(record.usedAt) : '' }}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-themed">{{ getResourceTypeName(record.codeType) }} +{{ record.codeValue }}{{ getResourceUnit(record.codeType) }}</span>
                      <span v-if="record.usedFor" class="text-xs text-blue-500">
                        → {{ record.usedFor.name }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn-secondary" @click="close">{{ t('common.close') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 礼盒摇晃动画 */
.gift-shake {
  animation: shake 0.15s ease-in-out infinite;
}

@keyframes shake {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  25% { transform: translateX(-5px) rotate(-5deg); }
  75% { transform: translateX(5px) rotate(5deg); }
}

/* 礼盒打开动画 */
.gift-open {
  animation: bounce-out 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards;
}

@keyframes bounce-out {
  0% { transform: scale(1); }
  40% { transform: scale(1.2); }
  100% { transform: scale(0); opacity: 0; }
}

/* 奖励卡片动画 */
.reward-card {
  animation: reward-appear 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes reward-appear {
  0% { transform: scale(0) rotate(180deg); opacity: 0; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}

/* 彩色纸屑动画 */
.confetti-particle {
  border-radius: 2px;
  animation: confetti-fall 3s ease-out forwards;
  top: -10px;
}

@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotate(0deg) scale(1);
    opacity: 1;
  }
  100% {
    transform: translateY(350px) rotate(720deg) scale(0.5);
    opacity: 0;
  }
}

/* Q弹效果 */
.gift-box {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
</style>
