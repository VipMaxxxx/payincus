<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BadgeImage from '@/components/BadgeImage.vue'
import type { BadgeOwnership } from '@/types/api'

const props = withDefaults(defineProps<{
  visible: boolean
  mode: 'draw' | 'select'
  ownership: BadgeOwnership | null
  remainingPoints?: number | null
  showViewMine?: boolean
  showPrimaryAction?: boolean
  primaryActionLabel?: string | null
  primaryActionDisabled?: boolean
}>(), {
  remainingPoints: null,
  showViewMine: true,
  showPrimaryAction: false,
  primaryActionLabel: null,
  primaryActionDisabled: false
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'view-mine'): void
  (e: 'primary-action'): void
}>()

const { t } = useI18n()

const rewardTitle = computed(() =>
  t(
    props.mode === 'draw'
      ? 'entertainment.badges.rewardTitleDraw'
      : 'entertainment.badges.rewardTitleSelect'
  )
)

const primaryActionLabel = computed(() =>
  props.primaryActionLabel || t('entertainment.badges.rewardDrawAgain')
)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible && ownership" class="modal-overlay">
        <div class="modal-backdrop" @click="emit('close')" />

        <div class="modal-content max-w-lg overflow-hidden">
          <div class="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-blue-500/20 via-cyan-500/10 to-transparent pointer-events-none" />

          <div class="modal-header relative border-b-0 pb-0">
            <div>
              <div class="text-xs uppercase tracking-[0.28em] text-blue-500">
                {{ mode === 'draw' ? t('entertainment.badges.randomTitle') : t('entertainment.badges.selectTitle') }}
              </div>
              <h3 class="mt-2 text-xl font-semibold text-themed">{{ rewardTitle }}</h3>
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

          <div class="modal-body relative pt-4">
            <div class="rounded-[32px] border border-themed bg-themed-tertiary p-6 text-center">
              <div class="mx-auto flex h-32 w-32 items-center justify-center rounded-[28px] border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-transparent shadow-[0_0_40px_rgba(59,130,246,0.16)]">
                <BadgeImage
                  :badge-id="ownership.badgeId"
                  :alt="ownership.badgeLabel"
                  :size="120"
                  variant="icon"
                />
              </div>

              <div class="mt-5 text-xs uppercase tracking-[0.24em] text-themed-faint">
                {{ ownership.seriesTitle }}
              </div>
              <div class="mt-2 text-2xl font-semibold text-themed">{{ ownership.badgeName }}</div>
              <div class="mt-2 text-sm text-themed-muted">{{ ownership.badgeLabel }}</div>
              <p class="mt-5 text-sm leading-6 text-themed-secondary">
                {{ t('entertainment.badges.rewardSubtitle') }}
              </p>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div class="rounded-2xl border border-themed bg-themed-tertiary p-4">
                <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('entertainment.badges.rewardSeriesLabel') }}</div>
                <div class="mt-2 text-base font-medium text-themed">{{ ownership.seriesTitle }}</div>
              </div>

              <div class="rounded-2xl border border-themed bg-themed-tertiary p-4">
                <div class="text-xs uppercase tracking-wide text-themed-muted">{{ t('entertainment.badges.rewardRemainingPoints') }}</div>
                <div class="mt-2 text-base font-medium text-themed">{{ remainingPoints ?? '--' }}</div>
              </div>
            </div>

            <div class="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button class="btn btn-ghost" @click="emit('close')">
                {{ t('common.gotIt') }}
              </button>

              <button
                v-if="showPrimaryAction"
                class="btn btn-primary"
                :disabled="primaryActionDisabled"
                @click="emit('primary-action')"
              >
                {{ primaryActionLabel }}
              </button>

              <button v-if="showViewMine" class="btn btn-secondary" @click="emit('view-mine')">
                {{ t('entertainment.badges.rewardViewMine') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
