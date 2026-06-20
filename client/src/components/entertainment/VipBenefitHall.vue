<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api, {
  type VipBenefitClaim,
  type VipBenefitAmountSummary,
  type VipBenefitOverviewResponse,
  type VipBenefitReward,
  type VipBenefitRewardConfig
} from '@/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useToast } from '@/stores/toast'
import { translateError } from '@/utils/errorHandler'

const { t } = useI18n()
const toast = useToast()

const loading = ref(true)
const claimingIds = ref<number[]>([])
const bulkClaiming = ref(false)
const overview = ref<VipBenefitOverviewResponse | null>(null)

interface ClaimFeedback {
  id: number
  title: string
  detail: string
  typeLabel: string
  statusLabel: string
  status: VipBenefitClaim['status']
}

const claimFeedbacks = ref<ClaimFeedback[]>([])
let nextFeedbackId = 0

const currentLevelLabel = computed(() => {
  const level = overview.value?.currentLevel || 0
  return level > 0 ? `VIP${level}` : t('vipBenefits.commonMember')
})

const groupedRewards = computed(() => {
  const groups = new Map<number, VipBenefitReward[]>()
  for (let level = 1; level <= 10; level++) {
    const items = (overview.value?.rewards || [])
      .filter(reward => reward.level === level)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    if (items.length > 0) {
      groups.set(level, items)
    }
  }
  return Array.from(groups.entries()).map(([level, rewards]) => ({ level, rewards }))
})

const entitlementItems = computed(() => buildSummaryItems(overview.value?.summary.entitlement))
const remainingItems = computed(() => buildSummaryItems(overview.value?.summary.remaining))
const hasClaimableRewards = computed(() => (overview.value?.summary.claimableRewards || 0) > 0)

function formatCurrency(value: number): string {
  return `¥${Number(value || 0).toFixed(2)}`
}

function buildSummaryItems(summary?: VipBenefitAmountSummary) {
  if (!summary) return []
  const items: Array<{ key: string; label: string; value: string }> = []
  if (summary.balanceAmount > 0) {
    items.push({ key: 'balance', label: t('vipBenefits.types.balance'), value: formatCurrency(summary.balanceAmount) })
  }
  if (summary.pointsAmount > 0) {
    items.push({ key: 'points', label: t('vipBenefits.types.points'), value: summary.pointsAmount.toLocaleString() })
  }
  if (summary.instanceQuantity > 0) {
    items.push({ key: 'instance', label: t('vipBenefits.types.instance'), value: String(summary.instanceQuantity) })
  }
  return items
}

function formatRewardValue(type: VipBenefitReward['type'], config: VipBenefitRewardConfig): string {
  if (type === 'balance') {
    return formatCurrency(Number(config.amount || 0))
  }
  if (type === 'points') {
    return `${Number(config.amount || 0).toLocaleString()} ${t('vipBenefits.pointsUnit')}`
  }
  const quantity = Number(config.quantity || 1)
  const days = Number(config.days || 30)
  const plan = config.planName || t('vipBenefits.instanceReward')
  return t('vipBenefits.instanceValue', { plan, quantity, days })
}

function rewardValue(reward: VipBenefitReward): string {
  return formatRewardValue(reward.type, reward.config)
}

function isRewardType(value: unknown): value is VipBenefitReward['type'] {
  return value === 'balance' || value === 'points' || value === 'instance'
}

function snapshotConfig(claim: VipBenefitClaim): VipBenefitRewardConfig {
  const config = claim.snapshot?.config
  return config && typeof config === 'object' && !Array.isArray(config)
    ? config as VipBenefitRewardConfig
    : {}
}

function rewardStatusLabel(reward: VipBenefitReward): string {
  if (reward.claims?.some(claim => claim.status === 'pending')) {
    return t('vipBenefits.status.pending')
  }
  if (reward.state === 'claimed') return t('vipBenefits.status.claimed')
  if (reward.state === 'locked') return t('vipBenefits.status.locked')
  if (reward.state === 'blocked') return t('vipBenefits.status.blocked', { level: reward.blockedByLevel || 1 })
  return t('vipBenefits.status.claimable')
}

function rewardStatusClass(reward: VipBenefitReward): string {
  if (reward.state === 'claimable') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (reward.state === 'claimed') return 'border-gray-300 bg-themed-secondary text-themed-muted'
  if (reward.state === 'blocked') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return 'border-themed bg-themed-secondary text-themed-muted'
}

function claimButtonLabel(reward: VipBenefitReward): string {
  if (isRewardClaiming(reward)) return t('common.processing')
  if (reward.state === 'claimable') return t('vipBenefits.claim')
  if (reward.state === 'blocked') return t('vipBenefits.claimLowerFirst', { level: reward.blockedByLevel || 1 })
  if (reward.state === 'locked') return t('vipBenefits.upgradeRequired')
  if (reward.claims?.some(claim => claim.status === 'pending')) return t('vipBenefits.pendingDelivery')
  return t('vipBenefits.claimed')
}

function canClaim(reward: VipBenefitReward): boolean {
  return reward.state === 'claimable' && !bulkClaiming.value && !isRewardClaiming(reward)
}

function isRewardClaiming(reward: VipBenefitReward): boolean {
  return claimingIds.value.includes(reward.id)
}

function setRewardClaiming(rewardId: number, value: boolean): void {
  if (value) {
    if (!claimingIds.value.includes(rewardId)) {
      claimingIds.value = [...claimingIds.value, rewardId]
    }
    return
  }
  claimingIds.value = claimingIds.value.filter(id => id !== rewardId)
}

function claimFeedbackFromClaim(claim: VipBenefitClaim, reward?: VipBenefitReward): Omit<ClaimFeedback, 'id'> {
  const snapshot = claim.snapshot || {}
  const type = reward?.type || (isRewardType(snapshot.type) ? snapshot.type : 'balance')
  const title = reward?.title || (typeof snapshot.title === 'string' && snapshot.title.trim() ? snapshot.title : t('vipBenefits.rewardReceived'))
  const detail = reward ? rewardValue(reward) : formatRewardValue(type, snapshotConfig(claim))

  return {
    title,
    detail,
    typeLabel: t(`vipBenefits.types.${type}`),
    statusLabel: claim.status === 'pending' ? t('vipBenefits.feedback.pending') : t('vipBenefits.feedback.delivered'),
    status: claim.status
  }
}

function removeClaimFeedback(id: number): void {
  claimFeedbacks.value = claimFeedbacks.value.filter(item => item.id !== id)
}

function showClaimFeedback(feedback: Omit<ClaimFeedback, 'id'>, delay = 0): void {
  window.setTimeout(() => {
    const id = ++nextFeedbackId
    claimFeedbacks.value = [{ id, ...feedback }, ...claimFeedbacks.value].slice(0, 8)
    window.setTimeout(() => removeClaimFeedback(id), 4200)
  }, delay)
}

async function loadBenefits(): Promise<void> {
  loading.value = true
  try {
    overview.value = await api.vipBenefits.getMyOverview()
  } catch (error: any) {
    toast.error(translateError(error))
  } finally {
    loading.value = false
  }
}

async function claimReward(reward: VipBenefitReward): Promise<void> {
  if (!canClaim(reward)) return
  setRewardClaiming(reward.id, true)
  try {
    const response = await api.vipBenefits.claim(reward.id)
    overview.value = response.overview
    showClaimFeedback(claimFeedbackFromClaim(response.claim, reward))
  } catch (error: any) {
    toast.error(translateError(error))
    await loadBenefits()
  } finally {
    setRewardClaiming(reward.id, false)
  }
}

async function claimAllRewards(): Promise<void> {
  if (!hasClaimableRewards.value || bulkClaiming.value) {
    if (!hasClaimableRewards.value) {
      toast.info(t('vipBenefits.noClaimableReward'))
    }
    return
  }

  const rewardLookup = new Map((overview.value?.rewards || []).map(reward => [reward.id, reward]))
  bulkClaiming.value = true
  try {
    const response = await api.vipBenefits.claimAll()
    overview.value = response.overview

    if (response.claims.length === 0) {
      toast.info(t('vipBenefits.noClaimableReward'))
      return
    }

    response.claims.forEach((claim, index) => {
      const reward = rewardLookup.get(claim.rewardId)
      showClaimFeedback(claimFeedbackFromClaim(claim, reward), index * 120)
    })
  } catch (error: any) {
    toast.error(translateError(error))
    await loadBenefits()
  } finally {
    bulkClaiming.value = false
    claimingIds.value = []
  }
}

onMounted(() => {
  void loadBenefits()
})
</script>

<template>
  <div class="space-y-5">
    <TransitionGroup
      name="vip-claim-pop"
      tag="div"
      class="pointer-events-none fixed bottom-5 right-4 z-[80] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
    >
      <article
        v-for="feedback in claimFeedbacks"
        :key="feedback.id"
        class="pointer-events-none rounded-lg border border-themed bg-themed p-4 shadow-lg"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border border-themed bg-themed-secondary px-2.5 py-1 text-xs font-medium text-themed">
                {{ feedback.typeLabel }}
              </span>
              <span
                class="rounded-full border px-2.5 py-1 text-xs font-medium"
                :class="feedback.status === 'pending'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'"
              >
                {{ feedback.statusLabel }}
              </span>
            </div>
            <div class="mt-3 truncate text-sm font-semibold text-themed">{{ feedback.title }}</div>
            <div class="mt-1 text-sm text-themed-muted">{{ feedback.detail }}</div>
          </div>
        </div>
      </article>
    </TransitionGroup>

    <div v-if="loading" class="card p-6">
      <SkeletonLoader type="card" :rows="4" />
    </div>

    <template v-else-if="overview">
      <section class="card p-5 md:p-6">
        <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0">
            <div class="text-sm font-medium text-themed-muted">{{ t('vipBenefits.overviewLabel') }}</div>
            <h2 class="mt-2 text-2xl font-semibold tracking-normal text-themed">
              {{ t('vipBenefits.overviewTitle', { level: currentLevelLabel }) }}
            </h2>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-themed-muted">
              {{ overview.currentLevel > 0 ? t('vipBenefits.overviewDesc', { level: currentLevelLabel }) : t('vipBenefits.noVipDesc') }}
            </p>
          </div>
          <div
            class="inline-flex w-fit items-center rounded-full border px-3 py-1.5 text-sm font-semibold"
            :style="overview.userVipBadgeStyle ? { backgroundColor: overview.userVipBadgeStyle.backgroundColor, color: overview.userVipBadgeStyle.textColor, borderColor: overview.userVipBadgeStyle.backgroundColor } : undefined"
            :class="overview.userVipBadgeStyle ? '' : 'border-themed bg-themed-secondary text-themed'"
          >
            {{ currentLevelLabel }}
          </div>
        </div>

        <div class="mt-6 grid gap-3 md:grid-cols-4">
          <div class="rounded border border-themed p-4">
            <div class="text-xs text-themed-muted">{{ t('vipBenefits.summary.unlocked') }}</div>
            <div class="mt-2 text-2xl font-semibold text-themed">{{ overview.summary.unlockedRewards }}</div>
          </div>
          <div class="rounded border border-themed p-4">
            <div class="text-xs text-themed-muted">{{ t('vipBenefits.summary.claimable') }}</div>
            <div class="mt-2 text-2xl font-semibold text-themed">{{ overview.summary.claimableRewards }}</div>
          </div>
          <div class="rounded border border-themed p-4">
            <div class="text-xs text-themed-muted">{{ t('vipBenefits.summary.claimed') }}</div>
            <div class="mt-2 text-2xl font-semibold text-themed">{{ overview.summary.claimedRewards }}</div>
          </div>
          <div class="rounded border border-themed p-4">
            <div class="text-xs text-themed-muted">{{ t('vipBenefits.summary.pending') }}</div>
            <div class="mt-2 text-2xl font-semibold text-themed">{{ overview.summary.pendingRewards }}</div>
          </div>
        </div>

        <div class="mt-5 rounded border border-themed p-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div class="font-semibold text-themed">{{ t('vipBenefits.availableSummary') }}</div>
              <p class="mt-1 text-sm text-themed-muted">{{ t('vipBenefits.availableSummaryDesc') }}</p>
            </div>
            <div class="flex flex-col gap-3 md:items-end">
              <div class="flex flex-wrap gap-2 md:justify-end">
                <span
                  v-for="item in entitlementItems"
                  :key="item.key"
                  class="rounded-full border border-themed px-3 py-1 text-sm text-themed"
                >
                  {{ item.label }} {{ item.value }}
                </span>
                <span v-if="entitlementItems.length === 0" class="text-sm text-themed-muted">
                  {{ t('vipBenefits.noAvailableReward') }}
                </span>
              </div>
              <button
                class="btn w-full md:w-auto"
                :class="hasClaimableRewards ? 'btn-primary' : 'btn-secondary'"
                :disabled="!hasClaimableRewards || bulkClaiming"
                @click="claimAllRewards"
              >
                {{ bulkClaiming ? t('vipBenefits.claimingAll') : t('vipBenefits.claimAll') }}
              </button>
            </div>
          </div>

          <div v-if="remainingItems.length > 0" class="mt-4 flex flex-wrap gap-2 border-t border-themed pt-4 text-sm">
            <span class="text-themed-muted">{{ t('vipBenefits.remainingSummary') }}</span>
            <span v-for="item in remainingItems" :key="item.key" class="font-medium text-themed">
              {{ item.label }} {{ item.value }}
            </span>
          </div>
        </div>
      </section>

      <section v-if="groupedRewards.length === 0" class="card p-8 text-center text-sm text-themed-muted">
        {{ t('vipBenefits.empty') }}
      </section>

      <section v-else class="space-y-4">
        <div
          v-for="group in groupedRewards"
          :key="group.level"
          class="card overflow-hidden"
        >
          <div class="flex flex-col gap-2 border-b border-themed px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3">
              <span class="rounded-full border border-themed bg-themed-secondary px-3 py-1 text-sm font-semibold text-themed">
                VIP{{ group.level }}
              </span>
              <div>
                <div class="font-semibold text-themed">{{ t('vipBenefits.levelRewards', { level: group.level }) }}</div>
                <div class="text-xs text-themed-muted">
                  {{ group.level <= overview.currentLevel ? t('vipBenefits.levelUnlocked') : t('vipBenefits.levelLocked') }}
                </div>
              </div>
            </div>
            <div class="text-xs text-themed-muted">
              {{ t('vipBenefits.rewardCount', { count: group.rewards.length }) }}
            </div>
          </div>

          <div class="grid gap-3 p-5 lg:grid-cols-2 2xl:grid-cols-3">
            <article
              v-for="reward in group.rewards"
              :key="reward.id"
              class="flex min-h-40 flex-col rounded border border-themed p-4"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded-full border border-themed bg-themed-secondary px-2.5 py-1 text-xs font-medium text-themed">
                      {{ t(`vipBenefits.types.${reward.type}`) }}
                    </span>
                    <span
                      class="rounded-full border px-2.5 py-1 text-xs font-medium"
                      :class="rewardStatusClass(reward)"
                    >
                      {{ rewardStatusLabel(reward) }}
                    </span>
                  </div>
                  <h3 class="mt-3 text-base font-semibold text-themed">{{ reward.title }}</h3>
                  <p v-if="reward.description" class="mt-1 line-clamp-2 text-sm text-themed-muted">{{ reward.description }}</p>
                </div>
              </div>

              <div class="mt-4 grid gap-2 text-sm">
                <div class="flex items-center justify-between rounded border border-themed px-3 py-2">
                  <span class="text-themed-muted">{{ t('vipBenefits.rewardValue') }}</span>
                  <span class="font-medium text-themed">{{ rewardValue(reward) }}</span>
                </div>
                <div class="flex items-center justify-between rounded border border-themed px-3 py-2">
                  <span class="text-themed-muted">{{ t('vipBenefits.claimProgress') }}</span>
                  <span class="font-medium text-themed">{{ reward.claimedCount || 0 }}/{{ reward.claimLimit }}</span>
                </div>
              </div>

              <div class="mt-auto pt-4">
                <button
                  class="btn w-full"
                  :class="reward.state === 'claimable' ? 'btn-primary' : 'btn-secondary'"
                  :disabled="!canClaim(reward)"
                  @click="claimReward(reward)"
                >
                  {{ claimButtonLabel(reward) }}
                </button>
              </div>
            </article>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.vip-claim-pop-enter-active,
.vip-claim-pop-leave-active,
.vip-claim-pop-move {
  transition:
    opacity 0.28s ease,
    transform 0.28s ease;
}

.vip-claim-pop-enter-from {
  opacity: 0;
  transform: translateX(32px) translateY(12px) scale(0.96);
}

.vip-claim-pop-leave-to {
  opacity: 0;
  transform: translateX(36px) scale(0.96);
}
</style>
