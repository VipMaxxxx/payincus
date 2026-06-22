<script setup lang="ts">
import BadgeImage from '@/components/BadgeImage.vue'
import type { BadgeOwnership } from '@/types/api'

withDefaults(defineProps<{
  visible: boolean
  badges: BadgeOwnership[]
  title: string
  subtitle?: string | null
  confirmLabel?: string | null
  primaryActionLabel?: string | null
  primaryActionDisabled?: boolean
}>(), {
  subtitle: null,
  confirmLabel: null,
  primaryActionLabel: null,
  primaryActionDisabled: false
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'primary-action'): void
}>()
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="emit('close')"
      >
        <div class="modal-content !max-w-6xl w-full max-h-[calc(100vh-2rem)] overflow-hidden animate-scale-in flex flex-col">
          <div class="modal-header relative border-b-0 pb-2">
            <div>
              <h3 class="text-lg font-semibold text-themed">{{ title }}</h3>
              <p v-if="subtitle" class="mt-1 text-sm text-themed-muted">
                {{ subtitle }}
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

          <div class="modal-body pt-2 flex-1 overflow-y-auto">
            <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              <article
                v-for="ownership in badges"
                :key="ownership.id"
                class="rounded-2xl border border-themed bg-themed-tertiary p-3"
              >
                <div class="flex h-full flex-col items-center text-center">
                  <div class="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-transparent p-2.5">
                    <BadgeImage :badge-id="ownership.badgeId" :alt="ownership.badgeLabel" :size="58" variant="icon" />
                  </div>
                  <div class="mt-3 w-full text-[11px] uppercase tracking-[0.16em] text-themed-faint truncate">
                    {{ ownership.seriesTitle }}
                  </div>
                  <div class="mt-1 w-full text-sm font-semibold text-themed truncate">
                    {{ ownership.badgeName }}
                  </div>
                  <div class="mt-1 w-full text-xs text-themed-muted line-clamp-2">
                    {{ ownership.badgeLabel }}
                  </div>
                </div>
              </article>
            </div>
          </div>

          <div class="modal-header border-b-0 border-t border-themed pt-4">
            <div />
            <div class="flex flex-col-reverse gap-3 sm:flex-row">
              <button class="btn btn-secondary" @click="emit('close')">
                {{ confirmLabel }}
              </button>
              <button
                v-if="primaryActionLabel"
                class="btn btn-primary"
                :disabled="primaryActionDisabled"
                @click="emit('primary-action')"
              >
                {{ primaryActionLabel }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
