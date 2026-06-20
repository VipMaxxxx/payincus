<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import api from '@/api'
import BadgeImage from '@/components/BadgeImage.vue'
import InstanceDisplayIcon from '@/components/InstanceDisplayIcon.vue'
import { useToast } from '@/stores/toast'
import type { BadgeCatalogItem, BadgeOverview, BadgeOwnership } from '@/types/api'
import { translateError } from '@/utils/errorHandler'

const props = withDefaults(defineProps<{
  visible: boolean
  instanceId: number
  instanceName: string
  badgeId?: string | null
  fallbackIcon?: 'pro' | 'prime' | 'peer' | null
}>(), {
  badgeId: null,
  fallbackIcon: null
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'updated', badgeId: string | null): void
}>()

const { t } = useI18n()
const toast = useToast()

type BadgeModalTab = 'details' | 'owned'

const activeTab = ref<BadgeModalTab>('details')
const loading = ref(false)
const actionLoading = ref(false)
const overview = ref<BadgeOverview | null>(null)
const loadError = ref('')

const currentInstanceOption = computed(() =>
  overview.value?.instances.find(item => item.id === props.instanceId) ?? null
)

const canManageCurrentInstance = computed(() => !!currentInstanceOption.value)

const currentOwnership = computed(() =>
  overview.value?.ownerships.find(item => item.appliedInstanceId === props.instanceId) ?? null
)

const currentBadgeId = computed(() => currentOwnership.value?.badgeId ?? props.badgeId ?? null)

const currentBadgeCatalog = computed<BadgeCatalogItem | null>(() => {
  if (!currentBadgeId.value) return null
  return overview.value?.catalog.find(item => item.id === currentBadgeId.value) ?? null
})

const currentBadgeSeriesTitle = computed(() =>
  currentBadgeCatalog.value?.seriesNameZh
  || currentBadgeCatalog.value?.seriesTitle
  || currentOwnership.value?.seriesTitle
  || null
)

const currentBadgeOwnedCount = computed(() => {
  if (!currentBadgeId.value) return 0
  return (overview.value?.ownerships || []).filter(item => item.badgeId === currentBadgeId.value).length
})

const sortedOwnerships = computed(() => {
  const items = [...(overview.value?.ownerships || [])]

  const getPriority = (ownership: BadgeOwnership) => {
    if (ownership.appliedInstanceId === props.instanceId) return 0
    if (!ownership.applicationTarget) return 1
    if (ownership.applicationTarget === 'avatar') return 2
    return 3
  }

  return items.sort((left, right) => {
    const priorityDiff = getPriority(left) - getPriority(right)
    if (priorityDiff !== 0) return priorityDiff
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })
})

function formatDateTime(value: string | null): string {
  if (!value) return t('common.none')
  return new Date(value).toLocaleString()
}

function getSourceText(source: string): string {
  if (source === 'select') return t('entertainment.badges.sourceSelect')
  if (source === 'lottery') return t('entertainment.badges.sourceLottery')
  if (source === 'admin_grant') return t('entertainment.badges.sourceAdminGrant')
  return t('entertainment.badges.sourceDraw')
}

function getOwnershipStatusText(ownership: BadgeOwnership): string {
  if (ownership.appliedInstanceId === props.instanceId) {
    return t('instance.badgeModal.appliedHere')
  }
  if (ownership.applicationTarget === 'avatar') {
    return t('entertainment.badges.statusAvatar')
  }
  if (ownership.applicationTarget === 'instance') {
    return t('entertainment.badges.statusInstance')
  }
  return t('entertainment.badges.statusUnused')
}

function getOwnershipStatusClass(ownership: BadgeOwnership): string {
  if (ownership.appliedInstanceId === props.instanceId) {
    return 'border-blue-500/30 bg-blue-500/10 text-blue-500'
  }
  if (ownership.applicationTarget === 'avatar') {
    return 'border-violet-500/30 bg-violet-500/10 text-violet-500'
  }
  if (ownership.applicationTarget === 'instance') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
  }
  return 'border-themed bg-themed-tertiary text-themed-secondary'
}

function getOwnershipCardClass(ownership: BadgeOwnership): string {
  if (ownership.appliedInstanceId === props.instanceId) {
    return 'border-blue-500/30 bg-themed bg-gradient-to-br from-blue-500/10 via-transparent to-transparent shadow-lg shadow-blue-500/5'
  }
  if (!ownership.applicationTarget) {
    return 'border-themed bg-themed shadow-sm hover:border-themed-secondary'
  }
  if (ownership.applicationTarget === 'avatar') {
    return 'border-violet-500/20 bg-themed bg-gradient-to-br from-violet-500/10 via-transparent to-transparent'
  }
  return 'border-emerald-500/20 bg-themed bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent'
}

function getApplyButtonLabel(ownership: BadgeOwnership): string {
  if (ownership.appliedInstanceId === props.instanceId) {
    return t('instance.badgeModal.appliedHere')
  }
  if (!ownership.applicationTarget) {
    return currentOwnership.value
      ? t('instance.badgeModal.replaceCurrent')
      : t('instance.badgeModal.applyCurrent')
  }
  if (ownership.applicationTarget === 'avatar') {
    return t('instance.badgeModal.moveFromAvatar')
  }
  return t('instance.badgeModal.moveCurrent')
}

async function loadOverview() {
  loading.value = true
  loadError.value = ''

  try {
    overview.value = await api.entertainment.getBadgeOverview()
  } catch (error) {
    loadError.value = translateError(error)
    toast.error(loadError.value)
  } finally {
    loading.value = false
  }
}

async function handleApplyOwnership(ownership: BadgeOwnership) {
  if (!canManageCurrentInstance.value || ownership.appliedInstanceId === props.instanceId || actionLoading.value) return

  actionLoading.value = true
  try {
    await api.entertainment.applyBadgeToInstance(ownership.id, props.instanceId)
    await loadOverview()
    emit('updated', ownership.badgeId)
    toast.success(t('instance.badgeModal.updateSuccess'))
  } catch (error) {
    await loadOverview().catch(() => {})
    toast.error(translateError(error))
  } finally {
    actionLoading.value = false
  }
}

async function handleRemoveCurrentBadge() {
  if (!currentOwnership.value || actionLoading.value) return

  actionLoading.value = true
  try {
    await api.entertainment.unapplyBadge(currentOwnership.value.id)
    await loadOverview()
    emit('updated', null)
    toast.success(t('instance.badgeModal.removeSuccess'))
  } catch (error) {
    await loadOverview().catch(() => {})
    toast.error(translateError(error))
  } finally {
    actionLoading.value = false
  }
}

watch(
  () => props.visible,
  visible => {
    if (!visible) return
    activeTab.value = 'details'
    void loadOverview()
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="props.visible" class="modal-overlay">
        <div class="modal-backdrop" @click="emit('close')" />

        <div class="modal-content !max-w-5xl w-full max-h-[88vh] flex flex-col overflow-hidden">
          <div class="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-blue-500/16 via-cyan-500/8 to-transparent pointer-events-none" />

          <div class="modal-header relative">
            <div class="min-w-0">
              <div class="text-xs uppercase tracking-[0.28em] text-blue-500">
                {{ t('instance.badgeModal.kicker') }}
              </div>
              <h3 class="mt-2 text-xl font-semibold text-themed">
                {{ t('instance.badgeModal.title') }}
              </h3>
              <p class="mt-1 text-sm text-themed-muted truncate">
                {{ t('instance.badgeModal.subtitle', { name: props.instanceName }) }}
              </p>
            </div>

            <button
              type="button"
              class="rounded-full p-2 text-themed-muted hover:bg-themed-hover hover:text-themed transition-colors"
              @click="emit('close')"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="modal-body relative flex-1 overflow-y-auto space-y-5">
            <div class="flex flex-wrap gap-1.5 rounded-xl border border-themed bg-themed-secondary/60 p-1.5 sm:gap-2 sm:rounded-2xl sm:p-2">
              <button
                type="button"
                class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:rounded-xl sm:px-4 sm:py-2 sm:text-sm"
                :class="activeTab === 'details' ? 'bg-themed text-themed shadow-sm border border-themed' : 'text-themed-muted hover:bg-themed-hover hover:text-themed'"
                @click="activeTab = 'details'"
              >
                {{ t('instance.badgeModal.detailsTab') }}
              </button>
              <button
                type="button"
                class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:rounded-xl sm:px-4 sm:py-2 sm:text-sm"
                :class="activeTab === 'owned' ? 'bg-themed text-themed shadow-sm border border-themed' : 'text-themed-muted hover:bg-themed-hover hover:text-themed'"
                @click="activeTab = 'owned'"
              >
                {{ t('instance.badgeModal.ownedTab') }}
              </button>
            </div>

            <div v-if="loading" class="rounded-3xl border border-themed bg-themed-tertiary p-8 text-center text-themed-muted">
              {{ t('common.loading') }}...
            </div>

            <div v-else-if="loadError && !overview" class="rounded-3xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-500">
              {{ loadError }}
            </div>

            <template v-else>
              <div v-if="activeTab === 'details'" class="space-y-5">
                <div class="rounded-[28px] border border-themed bg-themed p-4 sm:rounded-[32px] sm:p-7">
                  <div class="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:items-center">
                    <div class="flex justify-center">
                      <div class="relative flex h-36 w-36 items-center justify-center sm:h-48 sm:w-48">
                        <div class="absolute inset-3 rounded-[1.5rem] bg-blue-500/10 blur-2xl sm:inset-4 sm:rounded-[2rem]" />
                        <div class="relative flex h-28 w-28 items-center justify-center rounded-[1.5rem] border border-themed bg-themed-tertiary shadow-xl sm:h-36 sm:w-36 sm:rounded-[2rem]">
                          <InstanceDisplayIcon
                            :badge-id="currentBadgeId"
                            :fallback-icon="props.fallbackIcon"
                            :alt="props.instanceName"
                            :size="88"
                          />
                        </div>
                      </div>
                    </div>

                    <div class="min-w-0">
                      <p class="text-xs uppercase tracking-[0.22em] text-themed-faint">
                        {{ currentBadgeSeriesTitle || t('instance.badgeModal.noBadgeSeries') }}
                      </p>
                      <h4 class="mt-2.5 text-xl font-semibold text-themed sm:mt-3 sm:text-2xl">
                        {{ currentOwnership?.badgeName || currentBadgeCatalog?.name || t('instance.badgeModal.noBadgeTitle') }}
                      </h4>
                      <p class="mt-1.5 text-sm text-themed-muted">
                        {{ currentOwnership?.badgeLabel || currentBadgeCatalog?.fullLabel || t('instance.badgeModal.noBadgeSummary') }}
                      </p>
                      <p class="mt-4 text-sm leading-6 text-themed-secondary sm:mt-5 sm:leading-7">
                        {{ currentBadgeCatalog?.seriesDescription || t('instance.badgeModal.noBadgeDescription') }}
                      </p>

                      <div class="mt-4 grid grid-cols-2 gap-2.5 sm:mt-6 sm:gap-3 xl:grid-cols-4">
                        <div class="rounded-xl border border-themed bg-themed-tertiary p-3 sm:rounded-2xl sm:p-4">
                          <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('instance.badgeModal.statusLabel') }}</div>
                          <div class="mt-1.5 text-sm font-medium text-themed sm:mt-2">
                            {{ currentOwnership ? t('instance.badgeModal.statusApplied') : t('instance.badgeModal.statusNotApplied') }}
                          </div>
                        </div>

                        <div class="rounded-xl border border-themed bg-themed-tertiary p-3 sm:rounded-2xl sm:p-4">
                          <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('instance.badgeModal.ownedCountLabel') }}</div>
                          <div class="mt-1.5 text-sm font-medium text-themed sm:mt-2">{{ currentBadgeOwnedCount }}</div>
                        </div>

                        <div class="rounded-xl border border-themed bg-themed-tertiary p-3 sm:rounded-2xl sm:p-4">
                          <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('entertainment.badges.sourceLabel') }}</div>
                          <div class="mt-1.5 text-sm font-medium text-themed sm:mt-2">
                            {{ currentOwnership ? getSourceText(currentOwnership.source) : t('common.none') }}
                          </div>
                        </div>

                        <div class="rounded-xl border border-themed bg-themed-tertiary p-3 sm:rounded-2xl sm:p-4">
                          <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('entertainment.badges.obtainedAt') }}</div>
                          <div class="mt-1.5 text-sm font-medium text-themed break-words leading-5 sm:mt-2">
                            {{ currentOwnership ? formatDateTime(currentOwnership.createdAt) : t('common.none') }}
                          </div>
                        </div>
                      </div>

                      <div class="mt-4 flex flex-col gap-2.5 sm:mt-6 sm:gap-3 sm:flex-row sm:flex-wrap">
                        <button
                          v-if="canManageCurrentInstance && currentOwnership"
                          type="button"
                          class="btn btn-danger w-full sm:w-auto"
                          :disabled="actionLoading"
                          @click="handleRemoveCurrentBadge"
                        >
                          {{ actionLoading ? t('common.processing') : t('instance.badgeModal.removeCurrent') }}
                        </button>

                        <button
                          v-if="canManageCurrentInstance"
                          type="button"
                          class="btn btn-secondary w-full sm:w-auto"
                          @click="activeTab = 'owned'"
                        >
                          {{ t('instance.badgeModal.openOwnedTab') }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  v-if="!canManageCurrentInstance"
                  class="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-600 dark:text-amber-300"
                >
                  {{ t('instance.badgeModal.manageUnavailable') }}
                </div>
              </div>

              <div v-else class="space-y-4">
                <div
                  v-if="!canManageCurrentInstance"
                  class="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-600 dark:text-amber-300"
                >
                  {{ t('instance.badgeModal.manageUnavailable') }}
                </div>

                <div
                  v-else-if="sortedOwnerships.length === 0"
                  class="rounded-3xl border border-dashed border-themed p-8 text-center"
                >
                  <div class="text-lg font-medium text-themed">{{ t('instance.badgeModal.emptyOwnedTitle') }}</div>
                  <p class="mt-2 text-sm text-themed-muted">{{ t('instance.badgeModal.emptyOwnedHint') }}</p>
                </div>

                <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <article
                    v-for="ownership in sortedOwnerships"
                    :key="ownership.id"
                    class="rounded-[20px] border p-3 sm:p-4 transition-colors"
                    :class="getOwnershipCardClass(ownership)"
                  >
                    <div class="flex h-full items-start gap-3">
                      <div class="shrink-0 rounded-[16px] border border-themed bg-themed-tertiary p-2 shadow-inner sm:rounded-[18px] sm:p-2.5">
                        <BadgeImage
                          :badge-id="ownership.badgeId"
                          :alt="ownership.badgeLabel"
                          :size="52"
                          variant="icon"
                        />
                      </div>

                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <h4 class="text-base font-semibold text-themed truncate">{{ ownership.badgeName }}</h4>
                          <span class="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium" :class="getOwnershipStatusClass(ownership)">
                            {{ getOwnershipStatusText(ownership) }}
                          </span>
                        </div>

                        <p class="mt-1 text-xs text-themed-muted line-clamp-1">{{ ownership.badgeLabel }}</p>
                        <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                          <span class="inline-flex max-w-full items-center rounded-full border border-themed bg-themed-tertiary px-2 py-1 text-themed-secondary truncate">
                            {{ ownership.seriesTitle }}
                          </span>
                          <span class="inline-flex max-w-full items-center rounded-full border border-themed bg-themed-tertiary px-2 py-1 text-themed-secondary">
                            {{ getSourceText(ownership.source) }}
                          </span>
                          <span
                            v-if="ownership.applicationTarget === 'instance' && ownership.appliedInstanceName"
                            class="inline-flex max-w-full items-center rounded-full border border-themed bg-themed-tertiary px-2 py-1 text-themed-secondary truncate"
                          >
                            {{ ownership.appliedInstanceName }}
                          </span>
                        </div>

                        <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                          <button
                            type="button"
                            class="btn btn-sm w-full text-xs leading-tight sm:w-auto"
                            :class="ownership.appliedInstanceId === props.instanceId ? 'btn-secondary' : 'btn-primary'"
                            :disabled="actionLoading || ownership.appliedInstanceId === props.instanceId"
                            @click="handleApplyOwnership(ownership)"
                          >
                            {{ actionLoading ? t('common.processing') : getApplyButtonLabel(ownership) }}
                          </button>

                          <button
                            v-if="ownership.appliedInstanceId === props.instanceId"
                            type="button"
                            class="btn btn-sm btn-ghost w-full text-xs sm:w-auto"
                            :disabled="actionLoading"
                            @click="handleRemoveCurrentBadge"
                          >
                            {{ t('entertainment.badges.unapply') }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
