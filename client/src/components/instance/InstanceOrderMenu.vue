<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

type InstanceOrderAction = 'top' | 'up' | 'down' | 'bottom'

const props = withDefaults(defineProps<{
  actions: InstanceOrderAction[]
  labels: Record<InstanceOrderAction, string>
  label: string
  disabledActions?: Partial<Record<InstanceOrderAction, boolean>>
  loading?: boolean
  dark?: boolean
  align?: 'left' | 'right'
}>(), {
  disabledActions: () => ({}),
  loading: false,
  dark: false,
  align: 'right'
})

const emit = defineEmits<{
  reorder: [action: InstanceOrderAction]
}>()

const rootRef = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const isHovering = ref(false)
const supportsHover = ref(false)

const hasEnabledAction = computed(() => props.actions.some(action => !props.disabledActions[action]))
const isExpanded = computed(() => isOpen.value || (supportsHover.value && isHovering.value && hasEnabledAction.value && !props.loading))

let hoverMediaQuery: MediaQueryList | null = null

function getIconPath(action: InstanceOrderAction): string {
  if (action === 'top') return 'M5 4h14M17 15l-5-5-5 5'
  if (action === 'up') return 'M6 15l6-6 6 6'
  if (action === 'down') return 'M6 9l6 6 6-6'
  return 'M5 20h14M17 9l-5 5-5-5'
}

function toggleOpen(): void {
  if (props.loading || !hasEnabledAction.value) return
  if (isOpen.value) {
    close()
    blurActiveElement()
    return
  }
  isOpen.value = true
}

function close(): void {
  isOpen.value = false
}

function handlePointerEnter(): void {
  isHovering.value = true
}

function handlePointerLeave(): void {
  isHovering.value = false
}

function blurActiveElement(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}

function handleAction(action: InstanceOrderAction): void {
  if (props.loading || props.disabledActions[action]) return
  emit('reorder', action)
  close()
  blurActiveElement()
}

function handleOutsidePointerDown(event: PointerEvent): void {
  if (!rootRef.value || rootRef.value.contains(event.target as Node)) return
  if (isOpen.value || rootRef.value.contains(document.activeElement)) {
    close()
    blurActiveElement()
  }
}

function handleEscape(): void {
  close()
  blurActiveElement()
}

function handleFocusOut(event: FocusEvent): void {
  const nextTarget = event.relatedTarget as Node | null
  if (!rootRef.value || (nextTarget && rootRef.value.contains(nextTarget))) return
  close()
}

function handleHoverMediaChange(event: MediaQueryListEvent): void {
  supportsHover.value = event.matches
}

function addHoverMediaListener(query: MediaQueryList): void {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handleHoverMediaChange)
    return
  }
  query.addListener(handleHoverMediaChange)
}

function removeHoverMediaListener(query: MediaQueryList): void {
  if (typeof query.removeEventListener === 'function') {
    query.removeEventListener('change', handleHoverMediaChange)
    return
  }
  query.removeListener(handleHoverMediaChange)
}

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsidePointerDown, true)
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    hoverMediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
    supportsHover.value = hoverMediaQuery.matches
    addHoverMediaListener(hoverMediaQuery)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  if (hoverMediaQuery) {
    removeHoverMediaListener(hoverMediaQuery)
  }
})
</script>

<template>
  <div
    ref="rootRef"
    class="instance-order-menu"
    :class="[
      dark ? 'is-dark' : '',
      isOpen ? 'is-open' : '',
      hasEnabledAction ? 'has-enabled' : '',
      align === 'left' ? 'align-left' : 'align-right'
    ]"
    @keydown.esc.stop="handleEscape"
    @focusout="handleFocusOut"
    @pointerenter="handlePointerEnter"
    @pointerleave="handlePointerLeave"
  >
    <button
      type="button"
      class="instance-order-trigger"
      :disabled="loading || !hasEnabledAction"
      :title="label"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="isExpanded"
      @click.stop="toggleOpen"
    >
      <svg
        v-if="loading"
        class="h-3.5 w-3.5 animate-spin"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <svg
        v-else
        class="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9" d="M8 6h8M8 12h8M8 18h8" />
      </svg>
    </button>

    <div class="instance-order-panel" role="menu" :aria-hidden="!isExpanded" @click.stop>
      <button
        v-for="action in actions"
        :key="action"
        type="button"
        class="instance-order-action"
        role="menuitem"
        :disabled="loading || disabledActions[action]"
        :tabindex="isExpanded ? 0 : -1"
        :title="labels[action]"
        :aria-label="labels[action]"
        @click.stop="handleAction(action)"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" :d="getIconPath(action)" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.instance-order-menu {
  position: relative;
  z-index: 20;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  --order-menu-gap: 0.625rem;
}

.instance-order-menu.is-open::before {
  content: '';
  position: absolute;
  top: 50%;
  width: var(--order-menu-gap);
  height: 2rem;
  transform: translateY(-50%);
}

.instance-order-menu.align-right::before {
  right: 100%;
}

.instance-order-menu.align-left::before {
  left: 100%;
}

.instance-order-trigger,
.instance-order-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(229 231 235);
  background: rgb(249 250 251 / 0.9);
  color: rgb(75 85 99);
  transition:
    color 190ms ease,
    background-color 190ms ease,
    border-color 190ms ease,
    box-shadow 240ms ease,
    transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.instance-order-trigger {
  height: 2rem;
  width: 2rem;
  border-radius: 0.625rem;
}

.instance-order-action {
  height: 1.75rem;
  width: 1.75rem;
  border-radius: 0.5rem;
  background: transparent;
  border-color: transparent;
}

.instance-order-trigger:hover,
.instance-order-trigger:focus-visible,
.instance-order-action:hover,
.instance-order-action:focus-visible {
  border-color: rgb(209 213 219);
  background: rgb(255 255 255);
  color: rgb(17 24 39);
  box-shadow: 0 6px 18px rgb(15 23 42 / 0.08);
  outline: none;
}

.instance-order-trigger:active,
.instance-order-action:active {
  transform: scale(0.96);
}

.instance-order-trigger:disabled,
.instance-order-action:disabled {
  cursor: not-allowed;
  opacity: 0.36;
  box-shadow: none;
}

.instance-order-panel {
  position: absolute;
  top: 50%;
  z-index: 30;
  display: flex;
  width: 0;
  height: 2rem;
  align-items: center;
  gap: 0.25rem;
  overflow: hidden;
  border: 1px solid rgb(229 231 235);
  border-radius: 0.75rem;
  background: rgb(255 255 255 / 0.96);
  box-shadow: 0 10px 26px rgb(15 23 42 / 0.1);
  opacity: 0;
  padding: 0.125rem 0;
  pointer-events: none;
  transform: translateY(-50%) scale(0.98);
  transition:
    width 320ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 240ms ease,
    padding 320ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 320ms cubic-bezier(0.16, 1, 0.3, 1);
}

.align-right .instance-order-panel {
  right: calc(100% + var(--order-menu-gap));
  transform-origin: right center;
}

.align-left .instance-order-panel {
  left: calc(100% + var(--order-menu-gap));
  transform-origin: left center;
}

.instance-order-menu.is-open .instance-order-panel {
  width: 8rem;
  opacity: 1;
  padding-left: 0.125rem;
  padding-right: 0.125rem;
  pointer-events: auto;
  transform: translateY(-50%) scale(1);
}

@media (hover: hover) and (pointer: fine) {
  .instance-order-menu.has-enabled:hover::before {
    content: '';
    position: absolute;
    top: 50%;
    width: var(--order-menu-gap);
    height: 2rem;
    transform: translateY(-50%);
  }

  .instance-order-menu.has-enabled:hover .instance-order-panel {
    width: 8rem;
    opacity: 1;
    padding-left: 0.125rem;
    padding-right: 0.125rem;
    pointer-events: auto;
    transform: translateY(-50%) scale(1);
  }
}

@media (max-width: 639px) {
  .instance-order-menu.is-open::before {
    display: none;
  }

  .instance-order-panel {
    top: auto;
    bottom: calc(100% + 0.375rem);
    flex-direction: column;
    width: 2rem;
    height: 0;
    padding: 0;
    transform: translateX(-50%) translateY(0.25rem) scale(0.98);
  }

  .align-right .instance-order-panel,
  .align-left .instance-order-panel {
    right: auto;
    left: 50%;
    transform-origin: center bottom;
  }

  .instance-order-menu.is-open .instance-order-panel {
    width: 2rem;
    height: 8rem;
    padding-top: 0.125rem;
    padding-bottom: 0.125rem;
    transform: translateX(-50%) translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .instance-order-trigger,
  .instance-order-action,
  .instance-order-panel {
    transition-duration: 1ms;
  }
}

.instance-order-menu.is-dark .instance-order-trigger,
.instance-order-menu.is-dark .instance-order-action {
  border-color: rgb(31 41 55);
  background: rgb(17 24 39 / 0.86);
  color: rgb(209 213 219);
}

.instance-order-menu.is-dark .instance-order-action {
  background: transparent;
  border-color: transparent;
}

.instance-order-menu.is-dark .instance-order-panel {
  border-color: rgb(31 41 55);
  background: rgb(17 24 39 / 0.96);
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.28);
}

.instance-order-menu.is-dark .instance-order-trigger:hover,
.instance-order-menu.is-dark .instance-order-trigger:focus-visible,
.instance-order-menu.is-dark .instance-order-action:hover,
.instance-order-menu.is-dark .instance-order-action:focus-visible {
  border-color: rgb(55 65 81);
  background: rgb(31 41 55);
  color: rgb(243 244 246);
}
</style>
