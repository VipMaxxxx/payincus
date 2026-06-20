<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import api from '@/api'
import BadgeImage from '@/components/BadgeImage.vue'
import BadgeBatchRewardModal from '@/components/entertainment/BadgeBatchRewardModal.vue'
import BadgeRewardModal from '@/components/entertainment/BadgeRewardModal.vue'
import InstanceSelector from '@/components/InstanceSelector.vue'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import type { BadgeOverview, BadgeOwnership } from '@/types/api'
import { translateError } from '@/utils/errorHandler'

const props = withDefaults(defineProps<{
  initialTab?: 'draw' | 'my'
}>(), {
  initialTab: 'draw'
})

const emit = defineEmits<{
  (e: 'points-updated'): void
}>()

const { t } = useI18n()
const authStore = useAuthStore()
const toast = useToast()

type BadgeRewardModalState = {
  visible: boolean
  mode: 'draw' | 'select'
  ownership: BadgeOwnership | null
  remainingPoints: number | null
}

const loading = ref(true)
const actionLoading = ref(false)
const activeTab = ref<'draw' | 'my'>(props.initialTab)
const selectedBadgeId = ref<string | null>(null)
const selectedSeriesId = ref<'all' | string>('all')
const overview = ref<BadgeOverview | null>(null)
const instanceSelectionMap = ref<Record<number, number | null>>({})
const badgeRewardModal = ref<BadgeRewardModalState>({
  visible: false,
  mode: 'draw',
  ownership: null,
  remainingPoints: null
})
const badgeMultiDrawRewards = ref<BadgeOwnership[]>([])
const showBadgeMultiDrawModal = ref(false)

const badgeTypeOptions = computed(() => {
  const groups = new Map<string, { id: string; title: string }>()
  for (const badge of overview.value?.catalog || []) {
    if (!groups.has(badge.seriesId)) {
      groups.set(badge.seriesId, {
        id: badge.seriesId,
        title: badge.seriesNameZh || badge.seriesTitle
      })
    }
  }
  return Array.from(groups.values())
})

const groupedCatalog = computed(() => {
  const groups = new Map<string, {
    id: string
    title: string
    description: string
    items: BadgeOverview['catalog']
  }>()

  for (const badge of overview.value?.catalog || []) {
    if (selectedSeriesId.value !== 'all' && badge.seriesId !== selectedSeriesId.value) {
      continue
    }

    const existing = groups.get(badge.seriesId)
    if (existing) {
      existing.items.push(badge)
      continue
    }

    groups.set(badge.seriesId, {
      id: badge.seriesId,
      title: badge.seriesNameZh || badge.seriesTitle,
      description: badge.seriesDescription,
      items: [badge]
    })
  }

  return Array.from(groups.values())
})

const availableOwnerships = computed(() =>
  (overview.value?.ownerships || []).filter(item => {
    const sameSeries = selectedSeriesId.value === 'all' || item.seriesId === selectedSeriesId.value
    return sameSeries && !item.applicationTarget
  })
)

const appliedOwnerships = computed(() =>
  (overview.value?.ownerships || []).filter(item => {
    const sameSeries = selectedSeriesId.value === 'all' || item.seriesId === selectedSeriesId.value
    return sameSeries && !!item.applicationTarget
  })
)

const ownershipCards = computed(() => [...appliedOwnerships.value, ...availableOwnerships.value])

const targetInstances = computed(() => overview.value?.instances || [])

const canDrawAgainFromRewardModal = computed(() => {
  if (badgeRewardModal.value.mode !== 'draw' || !overview.value) return false
  const remainingPoints = badgeRewardModal.value.remainingPoints ?? overview.value.currentPoints
  return remainingPoints >= overview.value.costs.randomDraw
})

const canDrawMulti = computed(() => {
  if (!overview.value) return false
  return overview.value.currentPoints >= overview.value.costs.randomDraw * 10
})

function getOwnedCount(badgeId: string): number {
  return (overview.value?.ownerships || []).filter(item => item.badgeId === badgeId).length
}

function formatDate(value: string | null): string {
  if (!value) return t('common.none')
  return new Date(value).toLocaleString()
}

function getBadgeSelectionClass(badgeId: string): string {
  return selectedBadgeId.value === badgeId
    ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10'
    : 'border-themed hover:border-blue-500/40 hover:bg-themed-hover'
}

function getOwnershipStatusText(target: 'avatar' | 'instance' | null): string {
  if (target === 'avatar') return t('entertainment.badges.statusAvatar')
  if (target === 'instance') return t('entertainment.badges.statusInstance')
  return t('entertainment.badges.statusUnused')
}

function getOwnershipStatusClass(target: 'avatar' | 'instance' | null): string {
  if (target === 'avatar') return 'border-blue-500/30 bg-blue-500/10 text-blue-500'
  if (target === 'instance') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
  return 'border-themed bg-themed-tertiary text-themed-secondary'
}

function getOwnershipCardClass(target: 'avatar' | 'instance' | null): string {
  if (target === 'avatar') {
    return 'border-blue-500/30 bg-themed bg-gradient-to-br from-blue-500/10 via-transparent to-transparent shadow-lg shadow-blue-500/5'
  }
  if (target === 'instance') {
    return 'border-emerald-500/30 bg-themed bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent shadow-lg shadow-emerald-500/5'
  }
  return 'border-themed bg-themed shadow-sm'
}

function getOwnershipGlowClass(target: 'avatar' | 'instance' | null): string {
  if (target === 'avatar') return 'bg-blue-500/20'
  if (target === 'instance') return 'bg-emerald-500/20'
  return 'bg-slate-400/10'
}

function getSourceText(source: string): string {
  if (source === 'select') return t('entertainment.badges.sourceSelect')
  if (source === 'lottery') return t('entertainment.badges.sourceLottery')
  if (source === 'admin_grant') return t('entertainment.badges.sourceAdminGrant')
  return t('entertainment.badges.sourceDraw')
}

function openBadgeRewardModal(mode: 'draw' | 'select', ownership: BadgeOwnership, remainingPoints: number) {
  badgeRewardModal.value = {
    visible: true,
    mode,
    ownership,
    remainingPoints
  }
}

function closeBadgeRewardModal() {
  badgeRewardModal.value.visible = false
}

function jumpToMyBadges() {
  activeTab.value = 'my'
  closeBadgeRewardModal()
}

async function drawRandomBadgeFromRewardModal() {
  if (!canDrawAgainFromRewardModal.value || actionLoading.value) return
  await drawRandomBadge()
}

async function loadOverview() {
  loading.value = true
  try {
    overview.value = await api.entertainment.getBadgeOverview()
    if (authStore.user) {
      authStore.user.avatarBadgeId = overview.value.avatarBadgeId
    }

    if (!selectedBadgeId.value && overview.value.catalog.length > 0) {
      selectedBadgeId.value = overview.value.catalog[0].id
    }
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    loading.value = false
  }
}

async function drawRandomBadge() {
  if (!overview.value) return
  actionLoading.value = true
  try {
    const result = await api.entertainment.drawBadgeRandom()
    openBadgeRewardModal('draw', result.ownership, result.currentPoints)
    await loadOverview()
    emit('points-updated')
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    actionLoading.value = false
  }
}

async function drawRandomBadgeMulti() {
  if (!overview.value) return
  const totalCost = overview.value.costs.randomDraw * 10
  if (overview.value.currentPoints < totalCost) {
    toast.warning(t('entertainment.notEnoughPointsForMulti', {
      required: totalCost,
      current: overview.value.currentPoints
    }))
    return
  }

  actionLoading.value = true
  try {
    const result = await api.entertainment.drawBadgeRandomMulti()
    badgeMultiDrawRewards.value = result.ownerships || []
    showBadgeMultiDrawModal.value = badgeMultiDrawRewards.value.length > 0
    await loadOverview()
    emit('points-updated')
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    actionLoading.value = false
  }
}

async function selectBadge() {
  if (!selectedBadgeId.value) {
    toast.warning(t('entertainment.badges.selectRequired'))
    return
  }

  actionLoading.value = true
  try {
    const result = await api.entertainment.drawBadgeSelect(selectedBadgeId.value)
    openBadgeRewardModal('select', result.ownership, result.currentPoints)
    await loadOverview()
    emit('points-updated')
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    actionLoading.value = false
  }
}

async function applyToAvatar(ownershipId: number) {
  actionLoading.value = true
  try {
    await api.entertainment.applyBadgeToAvatar(ownershipId)
    toast.success(t('entertainment.badges.applyAvatarSuccess'))
    await loadOverview()
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    actionLoading.value = false
  }
}

async function applyToInstance(ownershipId: number) {
  const instanceId = instanceSelectionMap.value[ownershipId]
  if (!instanceId) {
    toast.warning(t('entertainment.badges.instanceRequired'))
    return
  }

  actionLoading.value = true
  try {
    await api.entertainment.applyBadgeToInstance(ownershipId, instanceId)
    toast.success(t('entertainment.badges.applyInstanceSuccess'))
    await loadOverview()
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    actionLoading.value = false
  }
}

async function unapplyOwnership(ownershipId: number) {
  actionLoading.value = true
  try {
    await api.entertainment.unapplyBadge(ownershipId)
    toast.success(t('entertainment.badges.unapplySuccess'))
    await loadOverview()
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    actionLoading.value = false
  }
}

function closeBadgeMultiDrawModal() {
  showBadgeMultiDrawModal.value = false
  badgeMultiDrawRewards.value = []
}

onMounted(() => {
  loadOverview()
})

watch(groupedCatalog, groups => {
  const visibleBadgeIds = groups.flatMap(group => group.items.map(item => item.id))
  if (visibleBadgeIds.length === 0) {
    selectedBadgeId.value = null
    return
  }

  if (!selectedBadgeId.value || !visibleBadgeIds.includes(selectedBadgeId.value)) {
    selectedBadgeId.value = visibleBadgeIds[0]
  }
})

watch(() => props.initialTab, value => {
  activeTab.value = value
})
</script>

<template>
  <div class="space-y-6">
    <div v-if="loading" class="card p-8 text-center text-themed-muted">
      {{ t('common.loading') }}...
    </div>

    <template v-else-if="overview">
      <div class="grid gap-4 md:grid-cols-4">
        <div class="card p-4">
          <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('entertainment.currentPoints') }}</div>
          <div class="mt-2 text-2xl font-semibold text-themed">{{ overview.currentPoints }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('entertainment.badges.randomTitle') }}</div>
          <div class="mt-2 text-2xl font-semibold text-themed">{{ overview.costs.randomDraw }}</div>
          <div class="mt-1 text-xs text-themed-muted">{{ t('entertainment.badges.randomHint') }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('entertainment.badges.selectTitle') }}</div>
          <div class="mt-2 text-2xl font-semibold text-themed">{{ overview.costs.select }}</div>
          <div class="mt-1 text-xs text-themed-muted">{{ t('entertainment.badges.selectHint') }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('entertainment.badges.myTitle') }}</div>
          <div class="mt-2 text-2xl font-semibold text-themed">{{ overview.ownerships.length }}</div>
          <div class="mt-1 text-xs text-themed-muted">
            {{ t('entertainment.badges.summary', { available: availableOwnerships.length, applied: appliedOwnerships.length }) }}
          </div>
        </div>
      </div>

      <div class="card p-2">
        <div class="flex flex-wrap gap-2">
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            :class="selectedSeriesId === 'all' ? 'bg-themed text-themed shadow-sm border border-themed' : 'text-themed-muted hover:text-themed hover:bg-themed-hover border border-transparent'"
            @click="selectedSeriesId = 'all'"
          >
            {{ t('entertainment.badges.filterAll') }}
          </button>
          <button
            v-for="option in badgeTypeOptions"
            :key="option.id"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            :class="selectedSeriesId === option.id ? 'bg-themed text-themed shadow-sm border border-themed' : 'text-themed-muted hover:text-themed hover:bg-themed-hover border border-transparent'"
            @click="selectedSeriesId = option.id"
          >
            {{ option.title }}
          </button>
        </div>
      </div>

      <div class="card p-2">
        <div class="flex flex-wrap gap-2">
          <button
            class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            :class="activeTab === 'draw' ? 'bg-blue-500 text-white' : 'text-themed-muted hover:text-themed hover:bg-themed-hover'"
            @click="activeTab = 'draw'"
          >
            {{ t('entertainment.badges.drawTab') }}
          </button>
          <button
            class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            :class="activeTab === 'my' ? 'bg-blue-500 text-white' : 'text-themed-muted hover:text-themed hover:bg-themed-hover'"
            @click="activeTab = 'my'"
          >
            {{ t('entertainment.badges.myTab') }}
          </button>
        </div>
      </div>

      <div v-if="activeTab === 'draw'" class="space-y-6">
        <div class="grid gap-6 xl:grid-cols-[360px,1fr]">
          <div class="xl:sticky xl:top-24 self-start">
            <div class="card p-5 space-y-5">
              <div>
                <h3 class="text-lg font-semibold text-themed">{{ t('entertainment.badges.randomTitle') }}</h3>
                <p class="text-sm text-themed-muted mt-1">{{ t('entertainment.badges.randomDescription', { points: overview.costs.randomDraw }) }}</p>
              </div>
              <div class="space-y-3">
                <button
                  class="btn btn-primary w-full"
                  :disabled="actionLoading || overview.currentPoints < overview.costs.randomDraw"
                  @click="drawRandomBadge"
                >
                  {{ actionLoading ? t('common.processing') : t('entertainment.badges.randomButton', { points: overview.costs.randomDraw }) }}
                </button>
                <button
                  class="btn btn-secondary w-full"
                  :disabled="actionLoading || !canDrawMulti"
                  @click="drawRandomBadgeMulti"
                >
                  {{ actionLoading ? t('common.processing') : t('entertainment.badges.randomMultiButton', { points: overview.costs.randomDraw * 10 }) }}
                </button>
              </div>

              <div class="border-t border-themed pt-5">
                <h3 class="text-lg font-semibold text-themed">{{ t('entertainment.badges.selectTitle') }}</h3>
                <p class="text-sm text-themed-muted mt-1">{{ t('entertainment.badges.selectDescription', { points: overview.costs.select }) }}</p>
                <button
                  class="btn btn-secondary w-full mt-4"
                  :disabled="actionLoading || !selectedBadgeId || overview.currentPoints < overview.costs.select"
                  @click="selectBadge"
                >
                  {{ actionLoading ? t('common.processing') : t('entertainment.badges.selectButton', { points: overview.costs.select }) }}
                </button>
              </div>
            </div>
          </div>

          <div class="space-y-5">
            <section
              v-for="group in groupedCatalog"
              :key="group.id"
              class="card p-5"
            >
              <div class="mb-4">
                <h3 class="text-base font-semibold text-themed">{{ group.title }}</h3>
                <p class="text-sm text-themed-muted mt-1">{{ group.description }}</p>
              </div>

              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                <button
                  v-for="badge in group.items"
                  :key="badge.id"
                  class="rounded-2xl border p-4 text-left transition-all"
                  :class="getBadgeSelectionClass(badge.id)"
                  @click="selectedBadgeId = badge.id"
                >
                  <div class="flex items-center gap-3">
                    <BadgeImage :badge-id="badge.id" :alt="badge.fullLabel" :size="68" variant="icon" />
                    <div class="min-w-0">
                      <div class="font-medium text-themed">{{ badge.name }}</div>
                      <div class="text-xs text-themed-muted mt-1">{{ badge.fullLabel }}</div>
                      <div class="text-xs text-blue-500 mt-2">{{ t('entertainment.badges.ownedCount', { count: getOwnedCount(badge.id) }) }}</div>
                    </div>
                  </div>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div v-else class="space-y-4">
        <div v-if="ownershipCards.length === 0" class="card p-8 text-center text-themed-muted">
          {{ t('entertainment.badges.empty') }}
        </div>

        <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <article
            v-for="ownership in ownershipCards"
            :key="ownership.id"
            class="relative overflow-visible rounded-[24px] border p-4"
            :class="getOwnershipCardClass(ownership.applicationTarget)"
          >
            <div class="absolute inset-x-0 top-0 h-20 blur-3xl opacity-70" :class="getOwnershipGlowClass(ownership.applicationTarget)" />

            <div class="relative flex h-full flex-col gap-3">
              <div class="flex items-start justify-between gap-2.5">
                <span
                  class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium"
                  :class="getOwnershipStatusClass(ownership.applicationTarget)"
                >
                  {{ getOwnershipStatusText(ownership.applicationTarget) }}
                </span>

                <div class="text-right text-[11px] text-themed-muted">
                  <div class="text-themed-faint">{{ t('entertainment.badges.obtainedAt') }}</div>
                  <div class="mt-1 text-themed-secondary">{{ formatDate(ownership.createdAt) }}</div>
                </div>
              </div>

              <div class="flex items-center gap-3 min-w-0">
                <div class="rounded-[18px] border border-themed bg-themed-tertiary p-2.5 shadow-inner">
                  <BadgeImage :badge-id="ownership.badgeId" :alt="ownership.badgeLabel" :size="72" variant="icon" />
                </div>

                <div class="min-w-0 flex-1">
                  <h3 class="text-base font-semibold text-themed truncate">{{ ownership.badgeName }}</h3>
                  <p class="mt-1 text-xs text-themed-muted line-clamp-2">{{ ownership.badgeLabel }}</p>
                  <p class="mt-2 text-[11px] uppercase tracking-[0.16em] text-themed-faint">{{ ownership.seriesTitle }}</p>
                </div>
              </div>

              <div class="rounded-2xl border border-themed bg-themed-tertiary p-3 text-xs text-themed-secondary space-y-2">
                <div class="flex items-center justify-between gap-3">
                  <span>{{ t('entertainment.badges.sourceLabel') }}</span>
                  <span class="text-themed">{{ getSourceText(ownership.source) }}</span>
                </div>

                <div v-if="ownership.applicationTarget === 'instance' && ownership.appliedInstanceName" class="flex items-center justify-between gap-3">
                  <span>{{ t('entertainment.badges.currentInstance') }}</span>
                  <span class="truncate text-right text-blue-500">{{ ownership.appliedInstanceName }}</span>
                </div>
              </div>

              <div class="mt-auto space-y-2.5">
                <button
                  class="btn btn-primary w-full"
                  :disabled="actionLoading"
                  @click="applyToAvatar(ownership.id)"
                >
                  {{ t('entertainment.badges.applyAvatar') }}
                </button>

                <div class="rounded-2xl border border-themed bg-themed-tertiary p-3">
                  <div class="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-themed-faint">
                    {{ t('entertainment.badges.applyInstance') }}
                  </div>
                  <InstanceSelector
                    v-model="instanceSelectionMap[ownership.id]"
                    :instances="targetInstances"
                    :placeholder="t('entertainment.badges.selectInstance')"
                  />
                  <button
                    class="btn btn-secondary w-full mt-2.5"
                    :disabled="actionLoading || !instanceSelectionMap[ownership.id]"
                    @click="applyToInstance(ownership.id)"
                  >
                    {{ t('entertainment.badges.applyInstanceButton') }}
                  </button>
                </div>

                <button
                  v-if="ownership.applicationTarget"
                  class="btn btn-ghost w-full"
                  :disabled="actionLoading"
                  @click="unapplyOwnership(ownership.id)"
                >
                  {{ t('entertainment.badges.unapply') }}
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </template>
  </div>

  <BadgeRewardModal
    :visible="badgeRewardModal.visible"
    :mode="badgeRewardModal.mode"
    :ownership="badgeRewardModal.ownership"
    :remaining-points="badgeRewardModal.remainingPoints ?? overview?.currentPoints ?? null"
    :show-primary-action="badgeRewardModal.mode === 'draw'"
    :primary-action-label="actionLoading ? t('common.processing') : t('entertainment.badges.rewardDrawAgain')"
    :primary-action-disabled="actionLoading || !canDrawAgainFromRewardModal"
    @close="closeBadgeRewardModal"
    @view-mine="jumpToMyBadges"
    @primary-action="drawRandomBadgeFromRewardModal"
  />

  <BadgeBatchRewardModal
    :visible="showBadgeMultiDrawModal"
    :badges="badgeMultiDrawRewards"
    :title="t('entertainment.badges.multiDrawTitle')"
    :subtitle="t('entertainment.badges.multiDrawSubtitle', { count: badgeMultiDrawRewards.length })"
    :confirm-label="t('common.gotIt')"
    :primary-action-label="t('entertainment.multiDrawAgain')"
    :primary-action-disabled="actionLoading || !canDrawMulti"
    @close="closeBadgeMultiDrawModal"
    @primary-action="drawRandomBadgeMulti"
  />
</template>
