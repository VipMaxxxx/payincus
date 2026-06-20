<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useBadgeStore } from '@/stores/badges'
import type { BadgeCatalogItem, BadgeSeriesItem } from '@/types/api'

const { t } = useI18n()
const toast = useToast()
const badgeStore = useBadgeStore()

// 当前 TAB
const activeTab = ref<'lotteries' | 'records' | 'users' | 'badges'>('lotteries')

// 抽奖列表
const lotteries = ref<any[]>([])
const lotteriesLoading = ref(false)
const lotteriesPage = ref(1)
const lotteriesPageSize = ref(100)
const lotteriesTotal = ref(0)

// 中奖记录
const records = ref<any[]>([])
const recordsLoading = ref(false)
const recordsPage = ref(1)
const recordsPageSize = ref(100)
const recordsTotal = ref(0)
const recordsSearch = ref('')
const recordsPrizeType = ref('')

// 用户积分列表
const users = ref<any[]>([])
const usersLoading = ref(false)
const usersPage = ref(1)
const usersPageSize = ref(100)
const usersTotal = ref(0)

// 创建/编辑抽奖弹窗
const showLotteryModal = ref(false)
const editingLottery = ref<any>(null)
const lotteryForm = ref({
  name: '',
  description: '',
  costPoints: 100,
  isActive: true,
  startAt: '',
  endAt: ''
})
const savingLottery = ref(false)

// 奖品管理弹窗
const showPrizesModal = ref(false)
const editingPrizes = ref<any>(null)
const prizes = ref<any[]>([])
const savingPrizes = ref(false)

// 删除确认
const deleteConfirmId = ref<number | null>(null)
const deleting = ref(false)

// 通知配置弹窗
const showNotificationModal = ref(false)
const editingNotification = ref<any>(null)
const notificationForm = ref({
  enabled: true,
  type: 'telegram' as 'telegram' | 'discord' | 'webhook',
  notifyBalance: true,
  notifyInstance: true,
  // Telegram 配置
  telegramBotToken: '',
  telegramChatId: '',
  // Discord 配置
  discordWebhookUrl: '',
  // Webhook 配置
  webhookUrl: '',
  webhookSecret: ''
})
const savingNotification = ref(false)

// 徽章目录
const badgeSeries = ref<BadgeSeriesItem[]>([])
const badges = ref<BadgeCatalogItem[]>([])
const badgesLoading = ref(false)
const selectedBadgeSeriesId = ref<string>('all')
const showSeriesModal = ref(false)
const showBadgeModal = ref(false)
const editingSeries = ref<BadgeSeriesItem | null>(null)
const editingBadge = ref<BadgeCatalogItem | null>(null)
const deletingSeriesId = ref<string | null>(null)
const deletingBadgeId = ref<string | null>(null)
const savingSeries = ref(false)
const savingBadge = ref(false)
const seriesForm = ref({
  id: '',
  title: '',
  nameZh: '',
  nameEn: '',
  description: '',
  sourceId: '',
  sourceLabel: '',
  displayOrder: 0,
  isActive: true
})
const badgeForm = ref({
  id: '',
  name: '',
  nameEn: '',
  fullLabel: '',
  seriesId: '',
  sourceId: '',
  sourceLabel: '',
  assetUrl: '',
  assetUrlDark: '',
  assetUrlLight: '',
  displayOrder: 0,
  isActive: true
})

const filteredBadges = computed(() => {
  if (selectedBadgeSeriesId.value === 'all') return badges.value
  return badges.value.filter(badge => badge.seriesId === selectedBadgeSeriesId.value)
})

onMounted(() => {
  loadLotteries()
})

async function loadLotteries() {
  lotteriesLoading.value = true
  try {
    const res = await api.entertainment.adminGetLotteries({
      page: lotteriesPage.value,
      pageSize: lotteriesPageSize.value
    })
    lotteries.value = res.lotteries || []
    lotteriesTotal.value = res.total
  } catch (err: any) {
    toast.error(t('entertainment.admin.loadLotteriesFailed') + ': ' + err.message)
  } finally {
    lotteriesLoading.value = false
  }
}

async function loadRecords() {
  recordsLoading.value = true
  try {
    const res = await api.entertainment.adminGetLotteryRecords({
      page: recordsPage.value,
      pageSize: recordsPageSize.value,
      prizeType: recordsPrizeType.value || undefined,
      search: recordsSearch.value || undefined
    })
    records.value = res.records || []
    recordsTotal.value = res.total
  } catch (err: any) {
    toast.error(t('entertainment.admin.loadRecordsFailed') + ': ' + err.message)
  } finally {
    recordsLoading.value = false
  }
}

function searchRecords() {
  recordsPage.value = 1
  loadRecords()
}

async function loadUsers() {
  usersLoading.value = true
  try {
    const res = await api.entertainment.adminGetUserPoints({
      page: usersPage.value,
      pageSize: usersPageSize.value
    })
    users.value = res.records || []
    usersTotal.value = res.total
  } catch (err: any) {
    toast.error(t('entertainment.admin.loadUsersFailed') + ': ' + err.message)
  } finally {
    usersLoading.value = false
  }
}

function switchTab(tab: 'lotteries' | 'records' | 'users' | 'badges') {
  activeTab.value = tab
  if (tab === 'records' && records.value.length === 0) {
    loadRecords()
  } else if (tab === 'users' && users.value.length === 0) {
    loadUsers()
  } else if (tab === 'badges' && badgeSeries.value.length === 0 && badges.value.length === 0) {
    loadBadgeCatalog()
  }
}

// 打开创建抽奖弹窗
function openCreateLotteryModal() {
  editingLottery.value = null
  lotteryForm.value = {
    name: '',
    description: '',
    costPoints: 100,
    isActive: true,
    startAt: '',
    endAt: ''
  }
  showLotteryModal.value = true
}

// 打开编辑抽奖弹窗
function openEditLotteryModal(lottery: any) {
  editingLottery.value = lottery
  lotteryForm.value = {
    name: lottery.name,
    description: lottery.description || '',
    costPoints: lottery.costPoints,
    isActive: lottery.isActive,
    startAt: lottery.startAt ? lottery.startAt.split('T')[0] : '',
    endAt: lottery.endAt ? lottery.endAt.split('T')[0] : ''
  }
  showLotteryModal.value = true
}

// 保存抽奖
async function saveLottery() {
  if (!lotteryForm.value.name.trim()) {
    toast.warning(t('entertainment.admin.enterName'))
    return
  }
  if (lotteryForm.value.costPoints <= 0) {
    toast.warning(t('entertainment.admin.invalidCostPoints'))
    return
  }

  savingLottery.value = true
  try {
    const data = {
      name: lotteryForm.value.name.trim(),
      description: lotteryForm.value.description.trim() || undefined,
      costPoints: lotteryForm.value.costPoints,
      isActive: lotteryForm.value.isActive,
      startAt: lotteryForm.value.startAt || undefined,
      endAt: lotteryForm.value.endAt || undefined
    }

    if (editingLottery.value) {
      await api.entertainment.adminUpdateLottery(editingLottery.value.id, data)
      toast.success(t('entertainment.admin.updateSuccess'))
    } else {
      await api.entertainment.adminCreateLottery(data)
      toast.success(t('entertainment.admin.createSuccess'))
    }
    showLotteryModal.value = false
    loadLotteries()
  } catch (err: any) {
    toast.error(t('entertainment.admin.saveFailed') + ': ' + err.message)
  } finally {
    savingLottery.value = false
  }
}

// 删除抽奖
async function deleteLottery(id: number) {
  deleting.value = true
  try {
    await api.entertainment.adminDeleteLottery(id)
    toast.success(t('entertainment.admin.deleteSuccess'))
    deleteConfirmId.value = null
    loadLotteries()
  } catch (err: any) {
    toast.error(t('entertainment.admin.deleteFailed') + ': ' + err.message)
  } finally {
    deleting.value = false
  }
}

// 打开奖品管理弹窗
async function openPrizesModal(lottery: any) {
  editingPrizes.value = lottery
  prizes.value = lottery.prizes?.map((p: any) => ({ ...p, replenishAmount: 0 })) || []
  showPrizesModal.value = true
}

// 添加奖品
function addPrize() {
  prizes.value.push({
    id: 0, // 0 表示新奖品
    name: '',
    type: 'nothing',
    value: 0,
    probability: 10,
    totalQuantity: null,
    displayOrder: prizes.value.length,
    instanceDesc: ''
  })
}

// 删除奖品
function removePrize(index: number) {
  prizes.value.splice(index, 1)
}

// 保存奖品
async function savePrizes() {
  // 验证
  for (const prize of prizes.value) {
    if (!prize.name.trim()) {
      toast.warning(t('entertainment.admin.enterPrizeName'))
      return
    }
    if (prize.probability <= 0) {
      toast.warning(t('entertainment.admin.invalidProbability'))
      return
    }
  }

  savingPrizes.value = true
  try {
    const lotteryId = editingPrizes.value.id
    const existingPrizes = editingPrizes.value.prizes || []
    const existingIds = existingPrizes.map((p: any) => p.id)
    const newPrizeIds = prizes.value.filter(p => p.id).map(p => p.id)
    
    // 删除不在新列表中的奖品
    for (const existingId of existingIds) {
      if (!newPrizeIds.includes(existingId)) {
        await api.entertainment.adminDeletePrize(existingId)
      }
    }
    
    // 更新或创建奖品
    for (let i = 0; i < prizes.value.length; i++) {
      const prize = prizes.value[i]
      // 计算新的剩余数量（如果有补充）
      let newRemainQuantity = prize.remainQuantity
      if (prize.replenishAmount && prize.replenishAmount > 0) {
        newRemainQuantity = (prize.remainQuantity || 0) + prize.replenishAmount
      }
      
      const prizeData = {
        name: prize.name.trim(),
        type: prize.type,
        value: prize.value || 0,
        probability: prize.probability,
        totalQuantity: prize.totalQuantity || undefined,
        remainQuantity: newRemainQuantity,
        displayOrder: i,
        instanceDesc: prize.type === 'instance' ? prize.instanceDesc : undefined
      }
      
      if (prize.id && existingIds.includes(prize.id)) {
        // 更新现有奖品
        await api.entertainment.adminUpdatePrize(prize.id, prizeData)
      } else {
        // 创建新奖品
        await api.entertainment.adminCreatePrize(lotteryId, prizeData)
      }
    }
    
    toast.success(t('entertainment.admin.savePrizesSuccess'))
    showPrizesModal.value = false
    loadLotteries()
  } catch (err: any) {
    toast.error(t('entertainment.admin.savePrizesFailed') + ': ' + err.message)
  } finally {
    savingPrizes.value = false
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

function getPrizeTypeName(type: string): string {
  const map: Record<string, string> = {
    nothing: t('entertainment.prizeTypes.nothing'),
    points: t('entertainment.prizeTypes.points'),
    balance: t('entertainment.prizeTypes.balance'),
    badge: t('entertainment.prizeTypes.badge'),
    instance: t('entertainment.prizeTypes.instance'),
    cpu: t('entertainment.prizeTypes.cpu'),
    memory: t('entertainment.prizeTypes.memory'),
    disk: t('entertainment.prizeTypes.disk'),
    traffic: t('entertainment.prizeTypes.traffic')
  }
  return map[type] || type
}

const lotteriesTotalPages = computed(() => Math.ceil(lotteriesTotal.value / lotteriesPageSize.value))
const recordsTotalPages = computed(() => Math.ceil(recordsTotal.value / recordsPageSize.value))
const usersTotalPages = computed(() => Math.ceil(usersTotal.value / usersPageSize.value))

// 打开通知配置弹窗
function openNotificationModal(lottery: any) {
  editingNotification.value = lottery
  const config = lottery.notificationConfig
  if (config) {
    notificationForm.value = {
      enabled: config.enabled,
      type: config.type || 'telegram',
      notifyBalance: config.notifyBalance,
      notifyInstance: config.notifyInstance,
      telegramBotToken: config.config?.botToken || '',
      telegramChatId: config.config?.chatId || '',
      discordWebhookUrl: config.config?.webhookUrl || '',
      webhookUrl: config.config?.url || '',
      webhookSecret: config.config?.secret || ''
    }
  } else {
    notificationForm.value = {
      enabled: true,
      type: 'telegram',
      notifyBalance: true,
      notifyInstance: true,
      telegramBotToken: '',
      telegramChatId: '',
      discordWebhookUrl: '',
      webhookUrl: '',
      webhookSecret: ''
    }
  }
  showNotificationModal.value = true
}

// 保存通知配置
async function saveNotification() {
  const form = notificationForm.value
  
  // 根据类型构建配置
  let config: Record<string, string> = {}
  if (form.type === 'telegram') {
    if (!form.telegramBotToken || !form.telegramChatId) {
      toast.warning(t('entertainment.admin.notification.fillTelegram'))
      return
    }
    config = { botToken: form.telegramBotToken, chatId: form.telegramChatId }
  } else if (form.type === 'discord') {
    if (!form.discordWebhookUrl) {
      toast.warning(t('entertainment.admin.notification.fillDiscord'))
      return
    }
    config = { webhookUrl: form.discordWebhookUrl }
  } else if (form.type === 'webhook') {
    if (!form.webhookUrl) {
      toast.warning(t('entertainment.admin.notification.fillWebhook'))
      return
    }
    config = { url: form.webhookUrl, secret: form.webhookSecret }
  }
  
  savingNotification.value = true
  try {
    await api.entertainment.adminUpdateNotification(editingNotification.value.id, {
      enabled: form.enabled,
      type: form.type,
      config,
      notifyBalance: form.notifyBalance,
      notifyInstance: form.notifyInstance
    })
    toast.success(t('entertainment.admin.notification.saveSuccess'))
    showNotificationModal.value = false
    loadLotteries()
  } catch (err: any) {
    toast.error(t('entertainment.admin.notification.saveFailed') + ': ' + err.message)
  } finally {
    savingNotification.value = false
  }
}

async function loadBadgeCatalog() {
  badgesLoading.value = true
  try {
    const res = await api.entertainment.adminGetBadgeCatalog()
    badgeSeries.value = res.series || []
    badges.value = res.badges || []
  } catch (err: any) {
    toast.error(t('entertainment.admin.badgeCatalog.loadFailed') + ': ' + err.message)
  } finally {
    badgesLoading.value = false
  }
}

function openCreateSeriesModal() {
  editingSeries.value = null
  seriesForm.value = {
    id: '',
    title: '',
    nameZh: '',
    nameEn: '',
    description: '',
    sourceId: '',
    sourceLabel: '',
    displayOrder: (badgeSeries.value.length + 1) * 100,
    isActive: true
  }
  showSeriesModal.value = true
}

function openEditSeriesModal(series: BadgeSeriesItem) {
  editingSeries.value = series
  seriesForm.value = {
    id: series.id,
    title: series.title,
    nameZh: series.nameZh,
    nameEn: series.nameEn || '',
    description: series.description,
    sourceId: series.sourceId || '',
    sourceLabel: series.sourceLabel || '',
    displayOrder: series.displayOrder,
    isActive: series.isActive
  }
  showSeriesModal.value = true
}

async function saveSeries() {
  const form = seriesForm.value
  if (!form.id.trim() || !form.title.trim() || !form.nameZh.trim() || !form.description.trim()) {
    toast.warning(t('entertainment.admin.badgeCatalog.fillSeriesRequired'))
    return
  }

  savingSeries.value = true
  try {
    const data = {
      title: form.title.trim(),
      nameZh: form.nameZh.trim(),
      nameEn: form.nameEn.trim() || null,
      description: form.description.trim(),
      sourceId: form.sourceId.trim() || null,
      sourceLabel: form.sourceLabel.trim() || null,
      displayOrder: Number(form.displayOrder) || 0,
      isActive: form.isActive
    }
    if (editingSeries.value) {
      await api.entertainment.adminUpdateBadgeSeries(editingSeries.value.id, data)
      toast.success(t('entertainment.admin.badgeCatalog.seriesUpdated'))
    } else {
      await api.entertainment.adminCreateBadgeSeries({ id: form.id.trim(), ...data })
      toast.success(t('entertainment.admin.badgeCatalog.seriesCreated'))
    }
    showSeriesModal.value = false
    await loadBadgeCatalog()
    await badgeStore.loadCatalog(true)
  } catch (err: any) {
    toast.error(t('entertainment.admin.badgeCatalog.saveSeriesFailed') + ': ' + err.message)
  } finally {
    savingSeries.value = false
  }
}

async function deleteSeries(id: string) {
  try {
    await api.entertainment.adminDeleteBadgeSeries(id)
    toast.success(t('entertainment.admin.badgeCatalog.seriesDeleted'))
    deletingSeriesId.value = null
    if (selectedBadgeSeriesId.value === id) selectedBadgeSeriesId.value = 'all'
    await loadBadgeCatalog()
    await badgeStore.loadCatalog(true)
  } catch (err: any) {
    toast.error(t('entertainment.admin.badgeCatalog.deleteSeriesFailed') + ': ' + err.message)
  }
}

function openCreateBadgeModal(seriesId?: string) {
  editingBadge.value = null
  const targetSeriesId = seriesId && seriesId !== 'all'
    ? seriesId
    : badgeSeries.value[0]?.id || ''
  badgeForm.value = {
    id: '',
    name: '',
    nameEn: '',
    fullLabel: '',
    seriesId: targetSeriesId,
    sourceId: '',
    sourceLabel: '',
    assetUrl: '',
    assetUrlDark: '',
    assetUrlLight: '',
    displayOrder: (badges.value.filter(badge => badge.seriesId === targetSeriesId).length + 1) * 10,
    isActive: true
  }
  showBadgeModal.value = true
}

function openEditBadgeModal(badge: BadgeCatalogItem) {
  editingBadge.value = badge
  badgeForm.value = {
    id: badge.id,
    name: badge.name,
    nameEn: badge.nameEn || '',
    fullLabel: badge.fullLabel,
    seriesId: badge.seriesId,
    sourceId: badge.sourceId || '',
    sourceLabel: badge.sourceLabel || '',
    assetUrl: badge.assetUrl,
    assetUrlDark: badge.assetUrlDark || '',
    assetUrlLight: badge.assetUrlLight || '',
    displayOrder: badge.displayOrder || 0,
    isActive: badge.isActive ?? true
  }
  showBadgeModal.value = true
}

async function saveBadge() {
  const form = badgeForm.value
  if (!form.id.trim() || !form.name.trim() || !form.fullLabel.trim() || !form.seriesId.trim() || !form.assetUrl.trim()) {
    toast.warning(t('entertainment.admin.badgeCatalog.fillBadgeRequired'))
    return
  }

  savingBadge.value = true
  try {
    const data = {
      name: form.name.trim(),
      nameEn: form.nameEn.trim() || null,
      fullLabel: form.fullLabel.trim(),
      seriesId: form.seriesId.trim(),
      sourceId: form.sourceId.trim() || null,
      sourceLabel: form.sourceLabel.trim() || null,
      assetUrl: form.assetUrl.trim(),
      assetUrlDark: form.assetUrlDark.trim() || null,
      assetUrlLight: form.assetUrlLight.trim() || null,
      displayOrder: Number(form.displayOrder) || 0,
      isActive: form.isActive
    }
    if (editingBadge.value) {
      await api.entertainment.adminUpdateBadge(editingBadge.value.id, data)
      toast.success(t('entertainment.admin.badgeCatalog.badgeUpdated'))
    } else {
      await api.entertainment.adminCreateBadge({ id: form.id.trim(), ...data })
      toast.success(t('entertainment.admin.badgeCatalog.badgeCreated'))
    }
    showBadgeModal.value = false
    await loadBadgeCatalog()
    await badgeStore.loadCatalog(true)
  } catch (err: any) {
    toast.error(t('entertainment.admin.badgeCatalog.saveBadgeFailed') + ': ' + err.message)
  } finally {
    savingBadge.value = false
  }
}

async function deleteBadge(id: string) {
  try {
    await api.entertainment.adminDeleteBadge(id)
    toast.success(t('entertainment.admin.badgeCatalog.badgeDeleted'))
    deletingBadgeId.value = null
    await loadBadgeCatalog()
    await badgeStore.loadCatalog(true)
  } catch (err: any) {
    toast.error(t('entertainment.admin.badgeCatalog.deleteBadgeFailed') + ': ' + err.message)
  }
}

function getSeriesTitle(seriesId: string): string {
  return badgeSeries.value.find(series => series.id === seriesId)?.title || seriesId
}
</script>

<template>
  <div class="animate-fade-in">
    <!-- 页面标题 -->
    <div class="page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="page-title">{{ $t('entertainment.admin.title') }}</h1>
        <p class="text-sm text-themed-muted mt-1">{{ $t('entertainment.admin.description') }}</p>
      </div>
      <button v-if="activeTab === 'lotteries'" class="btn btn-primary" @click="openCreateLotteryModal">
        <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ $t('entertainment.admin.createLottery') }}
      </button>
      <div v-else-if="activeTab === 'badges'" class="flex gap-2">
        <button class="btn btn-ghost" @click="openCreateSeriesModal">
          {{ $t('entertainment.admin.badgeCatalog.addSeries') }}
        </button>
        <button class="btn btn-primary" :disabled="badgeSeries.length === 0" @click="openCreateBadgeModal(selectedBadgeSeriesId)">
          {{ $t('entertainment.admin.badgeCatalog.addBadge') }}
        </button>
      </div>
    </div>

    <!-- TAB 切换 -->
    <div class="flex border-b border-themed mb-6">
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
        :class="activeTab === 'lotteries' 
          ? 'border-blue-500 text-blue-500' 
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('lotteries')"
      >
        {{ $t('entertainment.admin.tabs.lotteries') }}
      </button>
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
        :class="activeTab === 'records' 
          ? 'border-blue-500 text-blue-500' 
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('records')"
      >
        {{ $t('entertainment.admin.tabs.records') }}
      </button>
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
        :class="activeTab === 'users' 
          ? 'border-blue-500 text-blue-500' 
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('users')"
      >
        {{ $t('entertainment.admin.tabs.users') }}
      </button>
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
        :class="activeTab === 'badges'
          ? 'border-blue-500 text-blue-500'
          : 'border-transparent text-themed-muted hover:text-themed'"
        @click="switchTab('badges')"
      >
        {{ $t('entertainment.admin.tabs.badges') }}
      </button>
    </div>

    <!-- 抽奖活动 TAB -->
    <div v-show="activeTab === 'lotteries'" class="card">
      <div v-if="lotteriesLoading" class="p-8 text-center text-themed-muted">
        {{ $t('common.loading') }}...
      </div>
      <div v-else-if="lotteries.length === 0" class="p-8 text-center text-themed-muted">
        {{ $t('entertainment.admin.noLotteries') }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-themed text-left text-sm text-themed-muted">
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.lotteryName') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.costPoints') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.prizes') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.totalDraws') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.status') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr v-for="lottery in lotteries" :key="lottery.id" class="hover:bg-themed-hover">
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-themed">{{ lottery.name }}</div>
                <div v-if="lottery.description" class="text-xs text-themed-muted truncate max-w-xs">
                  {{ lottery.description }}
                </div>
              </td>
              <td class="px-4 py-3 text-sm text-themed">{{ lottery.costPoints }}</td>
              <td class="px-4 py-3 text-sm text-themed">{{ lottery.prizesCount || lottery.prizes?.length || 0 }}</td>
              <td class="px-4 py-3 text-sm text-themed">{{ lottery.totalDraws }}</td>
              <td class="px-4 py-3">
                <span :class="['badge badge-sm', lottery.isActive ? 'badge-success' : 'badge-ghost']">
                  {{ lottery.isActive ? $t('entertainment.admin.active') : $t('entertainment.admin.inactive') }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-1">
                  <button class="btn btn-xs btn-ghost" :title="$t('entertainment.admin.managePrizes')" @click="openPrizesModal(lottery)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H4.5a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21" />
                    </svg>
                  </button>
                  <button 
                    class="btn btn-xs btn-ghost" 
                    :class="{ 'text-green-500': lottery.notificationConfig?.enabled }"
                    :title="$t('entertainment.admin.notification.title')" 
                    @click="openNotificationModal(lottery)"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </button>
                  <button class="btn btn-xs btn-ghost" @click="openEditLotteryModal(lottery)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button 
                    v-if="deleteConfirmId !== lottery.id"
                    class="btn btn-xs btn-ghost text-red-500" 
                    @click="deleteConfirmId = lottery.id"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  <template v-else>
                    <button 
                      class="btn btn-xs btn-error"
                      :disabled="deleting"
                      @click="deleteLottery(lottery.id)"
                    >
                      {{ $t('common.confirm') }}
                    </button>
                    <button 
                      class="btn btn-xs btn-ghost"
                      @click="deleteConfirmId = null"
                    >
                      {{ $t('common.cancel') }}
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        
        <!-- 分页 -->
        <div v-if="lotteriesTotalPages > 1" class="flex justify-center items-center gap-2 p-4 border-t border-themed">
          <button
            class="btn btn-sm btn-ghost"
            :disabled="lotteriesPage <= 1"
            @click="lotteriesPage--; loadLotteries()"
          >
            {{ $t('common.prevPage') }}
          </button>
          <span class="text-sm text-themed-muted">{{ lotteriesPage }} / {{ lotteriesTotalPages }}</span>
          <button
            class="btn btn-sm btn-ghost"
            :disabled="lotteriesPage >= lotteriesTotalPages"
            @click="lotteriesPage++; loadLotteries()"
          >
            {{ $t('common.nextPage') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 中奖记录 TAB -->
    <div v-show="activeTab === 'records'" class="card">
      <!-- 搜索和筛选 -->
      <div class="p-4 border-b border-themed flex flex-wrap gap-3 items-center">
        <!-- 用户名搜索 -->
        <div class="flex items-center gap-2">
          <input
            v-model="recordsSearch"
            type="text"
            class="input input-sm w-40"
            :placeholder="$t('entertainment.admin.searchUser')"
            @keyup.enter="searchRecords"
          />
          <button class="btn btn-sm btn-primary" @click="searchRecords">
            {{ $t('common.search') }}
          </button>
        </div>
        <!-- 奖品类型筛选 -->
        <div class="flex items-center gap-2">
          <span class="text-sm text-themed-muted">{{ $t('entertainment.admin.prizeType') }}:</span>
          <select v-model="recordsPrizeType" class="input input-sm" @change="searchRecords">
            <option value="">{{ $t('common.all') }}</option>
            <option value="nothing">{{ $t('entertainment.prizeTypes.nothing') }}</option>
            <option value="points">{{ $t('entertainment.prizeTypes.points') }}</option>
            <option value="balance">{{ $t('entertainment.prizeTypes.balance') }}</option>
            <option value="badge">{{ $t('entertainment.prizeTypes.badge') }}</option>
            <option value="instance">{{ $t('entertainment.prizeTypes.instance') }}</option>
            <option value="cpu">{{ $t('entertainment.prizeTypes.cpu') }}</option>
            <option value="memory">{{ $t('entertainment.prizeTypes.memory') }}</option>
            <option value="disk">{{ $t('entertainment.prizeTypes.disk') }}</option>
            <option value="traffic">{{ $t('entertainment.prizeTypes.traffic') }}</option>
          </select>
        </div>
      </div>
      
      <div v-if="recordsLoading" class="p-8 text-center text-themed-muted">
        {{ $t('common.loading') }}...
      </div>
      <div v-else-if="records.length === 0" class="p-8 text-center text-themed-muted">
        {{ $t('entertainment.admin.noRecords') }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-themed text-left text-sm text-themed-muted">
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.user') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.lotteryName') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.prize') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.prizeType') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.value') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.time') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr v-for="rec in records" :key="rec.id" class="hover:bg-themed-hover">
              <td class="px-4 py-3 text-sm text-themed">{{ rec.username || rec.userId }}</td>
              <td class="px-4 py-3 text-sm text-themed">{{ rec.lotteryName || '-' }}</td>
              <td class="px-4 py-3 text-sm text-themed">{{ rec.prizeName || '-' }}</td>
              <td class="px-4 py-3 text-sm">
                <span class="badge badge-sm">{{ getPrizeTypeName(rec.prizeType) }}</span>
              </td>
              <td class="px-4 py-3 text-sm text-themed">
                <template v-if="rec.prizeType === 'points'">+{{ rec.prizeValue }}</template>
                <template v-else-if="rec.prizeType === 'balance'">+¥{{ (rec.prizeValue / 100).toFixed(2) }}</template>
                <template v-else-if="rec.prizeType === 'badge'">{{ rec.prizeName || $t('entertainment.prizeTypes.badge') }}</template>
                <template v-else-if="rec.prizeType === 'instance'">{{ rec.instanceDesc || $t('entertainment.wonInstance') }}</template>
                <template v-else-if="rec.prizeType === 'cpu'">+{{ rec.prizeValue }}%</template>
                <template v-else-if="rec.prizeType === 'memory'">+{{ rec.prizeValue }}MB</template>
                <template v-else-if="rec.prizeType === 'disk'">+{{ rec.prizeValue }}MB</template>
                <template v-else-if="rec.prizeType === 'traffic'">+{{ rec.prizeValue }}GB</template>
                <template v-else>-</template>
              </td>
              <td class="px-4 py-3 text-sm text-themed-muted">{{ formatDate(rec.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
        
        <!-- 分页 -->
        <div class="flex justify-between items-center p-4 border-t border-themed">
          <!-- 每页数量 -->
          <div class="flex items-center gap-2">
            <span class="text-sm text-themed-muted">{{ $t('common.perPage') }}:</span>
            <select 
              v-model.number="recordsPageSize" 
              class="input input-sm w-20"
              @change="recordsPage = 1; loadRecords()"
            >
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </div>
          <!-- 分页按钮 -->
          <div class="flex items-center gap-2">
            <button
              class="btn btn-sm btn-ghost"
              :disabled="recordsPage <= 1"
              @click="recordsPage--; loadRecords()"
            >
              {{ $t('common.prevPage') }}
            </button>
            <span class="text-sm text-themed-muted">{{ recordsPage }} / {{ recordsTotalPages || 1 }}</span>
            <button
              class="btn btn-sm btn-ghost"
              :disabled="recordsPage >= recordsTotalPages"
              @click="recordsPage++; loadRecords()"
            >
              {{ $t('common.nextPage') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 用户积分 TAB -->
    <div v-show="activeTab === 'users'" class="card">
      <div v-if="usersLoading" class="p-8 text-center text-themed-muted">
        {{ $t('common.loading') }}...
      </div>
      <div v-else-if="users.length === 0" class="p-8 text-center text-themed-muted">
        {{ $t('entertainment.admin.noUsers') }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-themed text-left text-sm text-themed-muted">
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.user') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.currentPoints') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.totalEarned') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.totalSpent') }}</th>
              <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.lastConvertedAt') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr v-for="user in users" :key="user.userId" class="hover:bg-themed-hover">
              <td class="px-4 py-3 text-sm text-themed">{{ user.username || user.userId }}</td>
              <td class="px-4 py-3 text-sm font-medium text-amber-500">{{ user.points?.toLocaleString() }}</td>
              <td class="px-4 py-3 text-sm text-green-500">+{{ user.totalEarned?.toLocaleString() }}</td>
              <td class="px-4 py-3 text-sm text-red-500">-{{ user.totalSpent?.toLocaleString() }}</td>
              <td class="px-4 py-3 text-sm text-themed-muted">
                {{ user.lastConvertedAt ? formatDate(user.lastConvertedAt) : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
        
        <!-- 分页 -->
        <div v-if="usersTotalPages > 1" class="flex justify-center items-center gap-2 p-4 border-t border-themed">
          <button
            class="btn btn-sm btn-ghost"
            :disabled="usersPage <= 1"
            @click="usersPage--; loadUsers()"
          >
            {{ $t('common.prevPage') }}
          </button>
          <span class="text-sm text-themed-muted">{{ usersPage }} / {{ usersTotalPages }}</span>
          <button
            class="btn btn-sm btn-ghost"
            :disabled="usersPage >= usersTotalPages"
            @click="usersPage++; loadUsers()"
          >
            {{ $t('common.nextPage') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 徽章管理 TAB -->
    <div v-show="activeTab === 'badges'" class="space-y-6">
      <div v-if="badgesLoading" class="card p-8 text-center text-themed-muted">
        {{ $t('common.loading') }}...
      </div>
      <template v-else>
        <div class="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
          <div class="card">
            <div class="p-4 border-b border-themed flex items-center justify-between">
              <div>
                <div class="text-base font-semibold text-themed">{{ $t('entertainment.admin.badgeCatalog.series.title') }}</div>
                <div class="text-xs text-themed-muted mt-1">{{ $t('entertainment.admin.badgeCatalog.series.description') }}</div>
              </div>
              <button class="btn btn-sm btn-primary" @click="openCreateSeriesModal">{{ $t('entertainment.admin.badgeCatalog.series.add') }}</button>
            </div>
            <div class="divide-y divide-themed">
              <button
                class="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-themed-hover"
                :class="selectedBadgeSeriesId === 'all' ? 'bg-themed-secondary' : ''"
                @click="selectedBadgeSeriesId = 'all'"
              >
                <span class="text-sm font-medium text-themed">{{ $t('entertainment.admin.badgeCatalog.series.all') }}</span>
                <span class="badge badge-sm">{{ badges.length }}</span>
              </button>
              <div v-for="series in badgeSeries" :key="series.id" class="p-4 hover:bg-themed-hover">
                <div class="flex items-start justify-between gap-3">
                  <button class="min-w-0 text-left flex-1" @click="selectedBadgeSeriesId = series.id">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-themed truncate">{{ series.nameZh }}</span>
                      <span :class="['badge badge-sm', series.isActive ? 'badge-success' : 'badge-ghost']">
                        {{ series.isActive ? $t('common.active') : $t('common.inactive') }}
                      </span>
                    </div>
                    <div class="text-xs text-themed-muted mt-1 truncate">{{ series.title }}</div>
                    <div class="text-xs text-themed-faint mt-1">
                      {{ $t('entertainment.admin.badgeCatalog.series.enabledCount', { active: series.activeBadgeCount || 0, total: series.badgeCount || 0 }) }}
                    </div>
                  </button>
                  <div class="flex gap-1">
                    <button class="btn btn-xs btn-ghost" @click="openEditSeriesModal(series)">{{ $t('common.edit') }}</button>
                    <template v-if="deletingSeriesId === series.id">
                      <button class="btn btn-xs btn-error" @click="deleteSeries(series.id)">{{ $t('common.confirm') }}</button>
                      <button class="btn btn-xs btn-ghost" @click="deletingSeriesId = null">{{ $t('common.cancel') }}</button>
                    </template>
                    <button v-else class="btn btn-xs btn-ghost text-red-500" @click="deletingSeriesId = series.id">{{ $t('common.delete') }}</button>
                  </div>
                </div>
              </div>
              <div v-if="badgeSeries.length === 0" class="p-6 text-center text-themed-muted">
                {{ $t('entertainment.admin.badgeCatalog.series.empty') }}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="p-4 border-b border-themed flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div class="text-base font-semibold text-themed">{{ $t('entertainment.admin.badgeCatalog.badges.title') }}</div>
                <div class="text-xs text-themed-muted mt-1">
                  {{ $t('entertainment.admin.badgeCatalog.badges.currentFilter', { name: selectedBadgeSeriesId === 'all' ? $t('entertainment.admin.badgeCatalog.series.all') : getSeriesTitle(selectedBadgeSeriesId) }) }}
                </div>
              </div>
              <button class="btn btn-sm btn-primary" :disabled="badgeSeries.length === 0" @click="openCreateBadgeModal(selectedBadgeSeriesId)">
                {{ $t('entertainment.admin.badgeCatalog.addBadge') }}
              </button>
            </div>
            <div v-if="filteredBadges.length === 0" class="p-8 text-center text-themed-muted">
              {{ $t('entertainment.admin.badgeCatalog.badges.empty') }}
            </div>
            <div v-else class="overflow-x-auto">
              <table class="w-full">
                <thead>
                  <tr class="border-b border-themed text-left text-sm text-themed-muted">
                    <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.badgeCatalog.badges.tableBadge') }}</th>
                    <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.badgeCatalog.badges.tableSeries') }}</th>
                    <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.badgeCatalog.badges.tableAssetUrl') }}</th>
                    <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.badgeCatalog.badges.tableStatus') }}</th>
                    <th class="px-4 py-3 font-medium">{{ $t('entertainment.admin.badgeCatalog.badges.tableUsage') }}</th>
                    <th class="px-4 py-3 font-medium">{{ $t('common.actions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-themed">
                  <tr v-for="badge in filteredBadges" :key="badge.id" class="hover:bg-themed-hover">
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-3">
                        <img :src="badge.assetUrlLight || badge.assetUrl" :alt="badge.fullLabel" class="w-10 h-10 object-contain rounded-lg" loading="lazy" />
                        <div class="min-w-0">
                          <div class="text-sm font-semibold text-themed">{{ badge.name }}</div>
                          <div class="text-xs text-themed-muted truncate max-w-52">{{ badge.fullLabel }}</div>
                          <div class="text-xs text-themed-faint">{{ badge.id }}</div>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-3 text-sm text-themed">{{ badge.seriesNameZh || badge.seriesTitle }}</td>
                    <td class="px-4 py-3 text-xs text-themed-muted max-w-64 truncate">{{ badge.assetUrl }}</td>
                    <td class="px-4 py-3">
                      <span :class="['badge badge-sm', badge.isActive && badge.seriesIsActive ? 'badge-success' : 'badge-ghost']">
                        {{ badge.isActive && badge.seriesIsActive ? $t('entertainment.admin.badgeCatalog.badges.drawable') : $t('entertainment.admin.badgeCatalog.badges.notDrawable') }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-xs text-themed-muted">
                      {{ $t('entertainment.admin.badgeCatalog.badges.usage', { ownership: badge.ownershipCount || 0, avatar: badge.avatarUseCount || 0, instance: badge.instanceUseCount || 0 }) }}
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex gap-1">
                        <button class="btn btn-xs btn-ghost" @click="openEditBadgeModal(badge)">{{ $t('common.edit') }}</button>
                        <template v-if="deletingBadgeId === badge.id">
                          <button class="btn btn-xs btn-error" @click="deleteBadge(badge.id)">{{ $t('common.confirm') }}</button>
                          <button class="btn btn-xs btn-ghost" @click="deletingBadgeId = null">{{ $t('common.cancel') }}</button>
                        </template>
                        <button v-else class="btn btn-xs btn-ghost text-red-500" @click="deletingBadgeId = badge.id">{{ $t('common.delete') }}</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 创建/编辑抽奖弹窗 -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div 
          v-if="showLotteryModal" 
          class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          @click.self="showLotteryModal = false"
        >
          <div class="card p-6 w-full max-w-md">
            <h3 class="text-lg font-medium text-themed mb-4">
              {{ editingLottery ? $t('entertainment.admin.editLottery') : $t('entertainment.admin.createLottery') }}
            </h3>
            
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.lotteryName') }}</label>
                <input 
                  v-model="lotteryForm.name"
                  type="text" 
                  class="input w-full"
                  :placeholder="$t('entertainment.admin.enterLotteryName')"
                />
              </div>
              
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.lotteryDesc') }}</label>
                <textarea 
                  v-model="lotteryForm.description"
                  class="input w-full h-20 resize-none"
                  :placeholder="$t('entertainment.admin.enterDescription')"
                ></textarea>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.costPoints') }}</label>
                <input 
                  v-model.number="lotteryForm.costPoints"
                  type="number" 
                  class="input w-full"
                  min="1"
                />
              </div>
              
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.startAt') }}</label>
                  <input 
                    v-model="lotteryForm.startAt"
                    type="date" 
                    class="input w-full"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.endAt') }}</label>
                  <input 
                    v-model="lotteryForm.endAt"
                    type="date" 
                    class="input w-full"
                  />
                </div>
              </div>
              
              <div class="flex items-center gap-2">
                <input 
                  id="isActive"
                  v-model="lotteryForm.isActive" 
                  type="checkbox"
                  class="checkbox"
                />
                <label for="isActive" class="text-sm text-themed">{{ $t('entertainment.admin.isActive') }}</label>
              </div>
            </div>
            
            <div class="flex justify-end gap-2 mt-6">
              <button class="btn btn-ghost" @click="showLotteryModal = false">{{ $t('common.cancel') }}</button>
              <button class="btn btn-primary" :disabled="savingLottery" @click="saveLottery">
                {{ savingLottery ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 奖品管理弹窗 -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div 
          v-if="showPrizesModal" 
          class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto"
          @click.self="showPrizesModal = false"
        >
          <div class="card p-6 w-full max-w-2xl my-8">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-medium text-themed">
                {{ $t('entertainment.admin.managePrizes') }} - {{ editingPrizes?.name }}
              </h3>
              <button class="btn btn-sm btn-primary" @click="addPrize">
                <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                {{ $t('entertainment.admin.addPrize') }}
              </button>
            </div>
            
            <div class="space-y-3 max-h-96 overflow-y-auto">
              <div 
                v-for="(prize, index) in prizes" 
                :key="index"
                class="p-3 border border-themed rounded-lg"
              >
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                  <div>
                    <label class="block text-xs text-themed-muted mb-1">{{ $t('entertainment.admin.prizeName') }}</label>
                    <input v-model="prize.name" type="text" class="input input-sm w-full" />
                  </div>
                  <div>
                    <label class="block text-xs text-themed-muted mb-1">{{ $t('entertainment.admin.prizeType') }}</label>
                    <select v-model="prize.type" class="input input-sm w-full">
                      <option value="nothing">{{ $t('entertainment.prizeTypes.nothing') }}</option>
                      <option value="points">{{ $t('entertainment.prizeTypes.points') }}</option>
                      <option value="balance">{{ $t('entertainment.prizeTypes.balance') }}</option>
                      <option value="badge">{{ $t('entertainment.prizeTypes.badge') }}</option>
                      <option value="instance">{{ $t('entertainment.prizeTypes.instance') }}</option>
                      <option value="cpu">{{ $t('entertainment.prizeTypes.cpu') }}</option>
                      <option value="memory">{{ $t('entertainment.prizeTypes.memory') }}</option>
                      <option value="disk">{{ $t('entertainment.prizeTypes.disk') }}</option>
                      <option value="traffic">{{ $t('entertainment.prizeTypes.traffic') }}</option>
                    </select>
                  </div>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div v-if="prize.type !== 'nothing' && prize.type !== 'badge'">
                    <label class="block text-xs text-themed-muted mb-1">
                      {{ prize.type === 'balance' ? $t('entertainment.admin.balanceValue') : $t('entertainment.admin.prizeValue') }}
                      <span v-if="prize.type === 'cpu'" class="text-orange-500">(%)</span>
                      <span v-else-if="prize.type === 'memory' || prize.type === 'disk'" class="text-orange-500">(MB)</span>
                      <span v-else-if="prize.type === 'traffic'" class="text-orange-500">(GB)</span>
                    </label>
                    <input 
                      v-model.number="prize.value" 
                      type="number" 
                      class="input input-sm w-full"
                      :placeholder="prize.type === 'balance' ? $t('entertainment.admin.balanceCents') : 
                        prize.type === 'cpu' ? $t('entertainment.admin.cpuPercent') :
                        prize.type === 'memory' ? $t('entertainment.admin.memoryMB') :
                        prize.type === 'disk' ? $t('entertainment.admin.diskMB') :
                        prize.type === 'traffic' ? $t('entertainment.admin.trafficGB') : ''"
                    />
                  </div>
                  <div>
                    <label class="block text-xs text-themed-muted mb-1">{{ $t('entertainment.admin.probability') }}</label>
                    <input v-model.number="prize.probability" type="number" class="input input-sm w-full" min="0.01" step="0.01" />
                  </div>
                  <div>
                    <label class="block text-xs text-themed-muted mb-1">{{ $t('entertainment.admin.quantity') }}</label>
                    <input 
                      v-model.number="prize.totalQuantity" 
                      type="number" 
                      class="input input-sm w-full" 
                      :placeholder="$t('entertainment.admin.unlimited')"
                      :disabled="prize.type === 'points' || prize.type === 'nothing'"
                      :title="(prize.type === 'points' || prize.type === 'nothing') ? $t('entertainment.admin.noQuantityForType') : ''"
                    />
                  </div>
                  <!-- 补充库存（仅对有数量限制的非 points/nothing 奖品显示） -->
                  <div v-if="prize.id && prize.type !== 'points' && prize.type !== 'nothing' && prize.totalQuantity">
                    <label class="block text-xs text-themed-muted mb-1">
                      {{ $t('entertainment.admin.replenish') }}
                      <span class="text-orange-500">({{ $t('entertainment.admin.remaining') }}: {{ prize.remainQuantity ?? 0 }})</span>
                    </label>
                    <input 
                      v-model.number="prize.replenishAmount" 
                      type="number" 
                      class="input input-sm w-full" 
                      min="0"
                      :placeholder="$t('entertainment.admin.replenishPlaceholder')"
                    />
                  </div>
                </div>
                <div v-if="prize.type === 'instance'" class="mt-2">
                  <label class="block text-xs text-themed-muted mb-1">{{ $t('entertainment.admin.instanceDesc') }}</label>
                  <input v-model="prize.instanceDesc" type="text" class="input input-sm w-full" :placeholder="$t('entertainment.admin.instanceDescPlaceholder')" />
                </div>
                <div class="flex justify-end mt-2">
                  <button class="btn btn-xs btn-ghost text-red-500" @click="removePrize(index)">
                    {{ $t('common.delete') }}
                  </button>
                </div>
              </div>
              
              <div v-if="prizes.length === 0" class="text-center text-themed-muted py-4">
                {{ $t('entertainment.admin.noPrizes') }}
              </div>
            </div>
            
            <div class="flex justify-end gap-2 mt-6">
              <button class="btn btn-ghost" @click="showPrizesModal = false">{{ $t('common.cancel') }}</button>
              <button class="btn btn-primary" :disabled="savingPrizes" @click="savePrizes">
                {{ savingPrizes ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 通知配置弹窗 -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div 
          v-if="showNotificationModal" 
          class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          @click.self="showNotificationModal = false"
        >
          <div class="card p-6 w-full max-w-md">
            <h3 class="text-lg font-medium text-themed mb-4">
              {{ $t('entertainment.admin.notification.title') }} - {{ editingNotification?.name }}
            </h3>
            
            <div class="space-y-4">
              <!-- 启用开关 -->
              <div class="flex items-center justify-between">
                <label class="text-sm font-medium text-themed">{{ $t('entertainment.admin.notification.enabled') }}</label>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input v-model="notificationForm.enabled" type="checkbox" class="sr-only peer">
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                </label>
              </div>
              
              <!-- 通知方式选择 -->
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.notification.type') }}</label>
                <select v-model="notificationForm.type" class="input w-full">
                  <option value="telegram">Telegram</option>
                  <option value="discord">Discord</option>
                  <option value="webhook">Webhook</option>
                </select>
              </div>
              
              <!-- Telegram 配置 -->
              <template v-if="notificationForm.type === 'telegram'">
                <div>
                  <label class="block text-sm font-medium text-themed mb-1">Bot Token</label>
                  <input 
                    v-model="notificationForm.telegramBotToken"
                    type="text" 
                    class="input w-full"
                    placeholder="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-themed mb-1">Chat ID</label>
                  <input 
                    v-model="notificationForm.telegramChatId"
                    type="text" 
                    class="input w-full"
                    placeholder="-1001234567890"
                  />
                </div>
              </template>
              
              <!-- Discord 配置 -->
              <template v-if="notificationForm.type === 'discord'">
                <div>
                  <label class="block text-sm font-medium text-themed mb-1">Webhook URL</label>
                  <input 
                    v-model="notificationForm.discordWebhookUrl"
                    type="text" 
                    class="input w-full"
                    placeholder="https://discord.com/api/webhooks/..."
                  />
                </div>
              </template>
              
              <!-- Webhook 配置 -->
              <template v-if="notificationForm.type === 'webhook'">
                <div>
                  <label class="block text-sm font-medium text-themed mb-1">Webhook URL</label>
                  <input 
                    v-model="notificationForm.webhookUrl"
                    type="text" 
                    class="input w-full"
                    placeholder="https://your-server.com/webhook"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.notification.secret') }}</label>
                  <input 
                    v-model="notificationForm.webhookSecret"
                    type="text" 
                    class="input w-full"
                    :placeholder="$t('entertainment.admin.notification.secretPlaceholder')"
                  />
                </div>
              </template>
              
              <!-- 通知条件 -->
              <div class="border-t border-themed pt-4">
                <label class="block text-sm font-medium text-themed mb-2">{{ $t('entertainment.admin.notification.conditions') }}</label>
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <input 
                      id="notifyBalance"
                      v-model="notificationForm.notifyBalance" 
                      type="checkbox"
                      class="checkbox"
                    />
                    <label for="notifyBalance" class="text-sm text-themed">{{ $t('entertainment.admin.notification.notifyBalance') }}</label>
                  </div>
                  <div class="flex items-center gap-2">
                    <input 
                      id="notifyInstance"
                      v-model="notificationForm.notifyInstance" 
                      type="checkbox"
                      class="checkbox"
                    />
                    <label for="notifyInstance" class="text-sm text-themed">{{ $t('entertainment.admin.notification.notifyInstance') }}</label>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="flex justify-end gap-2 mt-6">
              <button class="btn btn-ghost" @click="showNotificationModal = false">{{ $t('common.cancel') }}</button>
              <button class="btn btn-primary" :disabled="savingNotification" @click="saveNotification">
                {{ savingNotification ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 系列编辑弹窗 -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showSeriesModal"
          class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto"
          @click.self="showSeriesModal = false"
        >
          <div class="card p-6 w-full max-w-2xl my-8">
            <h3 class="text-lg font-medium text-themed mb-4">
              {{ editingSeries ? $t('entertainment.admin.badgeCatalog.series.editTitle') : $t('entertainment.admin.badgeCatalog.series.createTitle') }}
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.series.id') }}</label>
                <input v-model="seriesForm.id" type="text" class="input w-full" :disabled="!!editingSeries" placeholder="supreme" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.series.sort') }}</label>
                <input v-model.number="seriesForm.displayOrder" type="number" class="input w-full" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.series.nameZh') }}</label>
                <input v-model="seriesForm.nameZh" type="text" class="input w-full" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.series.nameEn') }}</label>
                <input v-model="seriesForm.nameEn" type="text" class="input w-full" />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.series.titleLabel') }}</label>
                <input v-model="seriesForm.title" type="text" class="input w-full" :placeholder="$t('entertainment.admin.badgeCatalog.series.titlePlaceholder')" />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.series.descriptionLabel') }}</label>
                <textarea v-model="seriesForm.description" class="input w-full h-20 resize-none"></textarea>
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.series.sourceId') }}</label>
                <input v-model="seriesForm.sourceId" type="text" class="input w-full" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.series.sourceLabel') }}</label>
                <input v-model="seriesForm.sourceLabel" type="text" class="input w-full" />
              </div>
              <label class="flex items-center gap-2 sm:col-span-2 text-sm text-themed">
                <input v-model="seriesForm.isActive" type="checkbox" class="checkbox" />
                {{ $t('entertainment.admin.badgeCatalog.series.enable') }}
              </label>
            </div>
            <div class="flex justify-end gap-2 mt-6">
              <button class="btn btn-ghost" @click="showSeriesModal = false">{{ $t('common.cancel') }}</button>
              <button class="btn btn-primary" :disabled="savingSeries" @click="saveSeries">
                {{ savingSeries ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 徽章编辑弹窗 -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showBadgeModal"
          class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto"
          @click.self="showBadgeModal = false"
        >
          <div class="card p-6 w-full max-w-3xl my-8">
            <h3 class="text-lg font-medium text-themed mb-4">
              {{ editingBadge ? $t('entertainment.admin.badgeCatalog.badges.editTitle') : $t('entertainment.admin.badgeCatalog.badges.createTitle') }}
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.id') }}</label>
                <input v-model="badgeForm.id" type="text" class="input w-full" :disabled="!!editingBadge" placeholder="elite" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.series') }}</label>
                <select v-model="badgeForm.seriesId" class="input w-full">
                  <option v-for="series in badgeSeries" :key="series.id" :value="series.id">
                    {{ series.nameZh }} · {{ series.id }}
                  </option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.name') }}</label>
                <input v-model="badgeForm.name" type="text" class="input w-full" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.nameEn') }}</label>
                <input v-model="badgeForm.nameEn" type="text" class="input w-full" />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.fullLabel') }}</label>
                <input v-model="badgeForm.fullLabel" type="text" class="input w-full" :placeholder="$t('entertainment.admin.badgeCatalog.badges.fullLabelPlaceholder')" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.sourceId') }}</label>
                <input v-model="badgeForm.sourceId" type="text" class="input w-full" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.sourceLabel') }}</label>
                <input v-model="badgeForm.sourceLabel" type="text" class="input w-full" />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.assetUrl') }}</label>
                <input v-model="badgeForm.assetUrl" type="text" class="input w-full" :placeholder="$t('entertainment.admin.badgeCatalog.badges.assetUrlPlaceholder')" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.assetUrlDark') }}</label>
                <input v-model="badgeForm.assetUrlDark" type="text" class="input w-full" placeholder="/badges/dark/elite.svg" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.assetUrlLight') }}</label>
                <input v-model="badgeForm.assetUrlLight" type="text" class="input w-full" placeholder="/badges/light/elite.svg" />
              </div>
              <div>
                <label class="block text-sm font-medium text-themed mb-1">{{ $t('entertainment.admin.badgeCatalog.badges.sort') }}</label>
                <input v-model.number="badgeForm.displayOrder" type="number" class="input w-full" />
              </div>
              <label class="flex items-center gap-2 text-sm text-themed self-end pb-3">
                <input v-model="badgeForm.isActive" type="checkbox" class="checkbox" />
                {{ $t('entertainment.admin.badgeCatalog.badges.enable') }}
              </label>
            </div>
            <div class="mt-5 rounded-lg border border-themed p-4">
              <div class="text-sm font-medium text-themed mb-3">{{ $t('entertainment.admin.badgeCatalog.badges.preview') }}</div>
              <div class="flex items-center gap-4">
                <img
                  v-if="badgeForm.assetUrl"
                  :src="badgeForm.assetUrlLight || badgeForm.assetUrl"
                  :alt="badgeForm.fullLabel || badgeForm.id"
                  class="w-16 h-16 object-contain rounded-xl"
                  loading="lazy"
                />
                <div>
                  <div class="text-base font-semibold text-themed">{{ badgeForm.name || $t('entertainment.admin.badgeCatalog.badges.previewName') }}</div>
                  <div class="text-sm text-themed-muted">{{ badgeForm.fullLabel || $t('entertainment.admin.badgeCatalog.badges.previewLabel') }}</div>
                  <div class="text-xs text-themed-faint mt-1">{{ badgeForm.id || 'badge-id' }}</div>
                </div>
              </div>
            </div>
            <div class="flex justify-end gap-2 mt-6">
              <button class="btn btn-ghost" @click="showBadgeModal = false">{{ $t('common.cancel') }}</button>
              <button class="btn btn-primary" :disabled="savingBadge" @click="saveBadge">
                {{ savingBadge ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
