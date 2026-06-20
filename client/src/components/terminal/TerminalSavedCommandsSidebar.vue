<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import type { TerminalSavedCommand } from '@/types/api'

const props = withDefaults(defineProps<{
  connected: boolean
  mobile?: boolean
  visible?: boolean
}>(), {
  mobile: false,
  visible: true
})

const emit = defineEmits<{
  (e: 'execute', command: string): void
  (e: 'close'): void
}>()

const { t } = useI18n()
const toast = useToast()

const expanded = ref(true)
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const showEditor = ref(false)
const editingId = ref<number | null>(null)
const commands = ref<TerminalSavedCommand[]>([])
const selectedId = ref<number | null>(null)

const form = ref({
  name: '',
  command: '',
  description: ''
})

const selectedCommand = computed(() =>
  commands.value.find(command => command.id === selectedId.value) || null
)

const isEditing = computed(() => editingId.value !== null)
const canSubmit = computed(() => form.value.name.trim().length > 0 && form.value.command.trim().length > 0)
const commandCount = computed(() => commands.value.length)
const shouldRender = computed(() => !props.mobile || props.visible)

function sortCommands(list: TerminalSavedCommand[]): TerminalSavedCommand[] {
  return [...list].sort((a, b) => {
    const diff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    if (diff !== 0) return diff
    return b.id - a.id
  })
}

function getCommandPreview(command: string): string {
  const compact = command.replace(/\s+/g, ' ').trim()
  if (compact.length <= 84) return compact
  return `${compact.slice(0, 84)}...`
}

function ensureSelection() {
  if (commands.value.length === 0) {
    selectedId.value = null
    return
  }

  if (selectedId.value && commands.value.some(command => command.id === selectedId.value)) {
    return
  }

  selectedId.value = commands.value[0].id
}

function resetForm() {
  form.value = {
    name: '',
    command: '',
    description: ''
  }
  editingId.value = null
}

async function loadCommands() {
  loading.value = true
  try {
    const response = await api.terminalSavedCommands.list()
    commands.value = sortCommands(response.commands)
    ensureSelection()
  } catch (error: any) {
    toast.error(error?.message || t('terminal.savedCommands.loadFailed'))
  } finally {
    loading.value = false
  }
}

function openCreateEditor() {
  resetForm()
  showEditor.value = true
}

function openEditEditor() {
  if (!selectedCommand.value) return

  editingId.value = selectedCommand.value.id
  form.value = {
    name: selectedCommand.value.name,
    command: selectedCommand.value.command,
    description: selectedCommand.value.description || ''
  }
  showEditor.value = true
}

function cancelEditor() {
  showEditor.value = false
  resetForm()
}

async function saveCommand() {
  if (!canSubmit.value || saving.value) return

  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      command: form.value.command,
      description: form.value.description.trim() || null
    }

    if (editingId.value) {
      const response = await api.terminalSavedCommands.update(editingId.value, payload)
      commands.value = sortCommands(commands.value.map(command =>
        command.id === response.command.id ? response.command : command
      ))
      selectedId.value = response.command.id
      toast.success(t('terminal.savedCommands.updateSuccess'))
    } else {
      const response = await api.terminalSavedCommands.create(payload)
      commands.value = sortCommands([response.command, ...commands.value])
      selectedId.value = response.command.id
      toast.success(t('terminal.savedCommands.createSuccess'))
    }

    cancelEditor()
  } catch (error: any) {
    toast.error(error?.message || t('terminal.savedCommands.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function deleteSelectedCommand() {
  if (!selectedCommand.value || deleting.value) return

  const confirmed = window.confirm(
    t('terminal.savedCommands.deleteConfirm', { name: selectedCommand.value.name })
  )
  if (!confirmed) return

  deleting.value = true
  try {
    const targetId = selectedCommand.value.id
    await api.terminalSavedCommands.delete(targetId)
    commands.value = commands.value.filter(command => command.id !== targetId)
    ensureSelection()
    toast.success(t('terminal.savedCommands.deleteSuccess'))
  } catch (error: any) {
    toast.error(error?.message || t('terminal.savedCommands.deleteFailed'))
  } finally {
    deleting.value = false
  }
}

function executeSelectedCommand() {
  if (!props.connected || !selectedCommand.value) return
  emit('execute', selectedCommand.value.command)
  if (props.mobile) {
    emit('close')
  }
}

onMounted(() => {
  void loadCommands()
})
</script>

<template>
  <div
    v-if="shouldRender"
    class="relative h-full flex-shrink-0 overflow-visible transition-[width] duration-300 ease-out"
    :class="props.mobile ? 'fixed inset-0 z-[90] flex items-end justify-center p-0' : ''"
    :style="props.mobile ? undefined : { width: expanded ? '22rem' : '0px' }"
  >
    <div
      v-if="props.mobile"
      class="absolute inset-0 bg-black/60 backdrop-blur-sm"
      @click="emit('close')"
    />

    <button
      v-if="!props.mobile"
      type="button"
      class="absolute left-[-14px] top-1/2 z-20 flex h-11 w-7 -translate-y-1/2 items-center justify-center rounded-l-xl rounded-r-md border border-neutral-700 bg-neutral-900/95 text-neutral-300 shadow-lg transition-all duration-200 hover:bg-neutral-800 hover:text-white opacity-0 group-hover/terminal-workspace:opacity-100 focus:opacity-100"
      :title="expanded ? t('terminal.savedCommands.collapse') : t('terminal.savedCommands.expand')"
      @click="expanded = !expanded"
    >
      <svg class="h-4 w-4 transition-transform" :class="expanded ? '' : 'rotate-180'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 5l7 7-7 7" />
      </svg>
    </button>

    <div
      class="bg-[linear-gradient(180deg,rgba(17,17,19,0.98),rgba(10,10,11,0.98))]"
      :class="props.mobile
        ? 'relative h-[78vh] w-full max-w-xl rounded-t-[28px] border border-neutral-800 shadow-2xl'
        : ['h-full w-[22rem] border-l border-neutral-800 transition-all duration-300 ease-out', expanded ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none']"
    >
      <div class="flex h-full flex-col">
        <div class="border-b border-neutral-800 px-4 py-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                {{ t('terminal.savedCommands.cloud') }}
              </div>
              <h3 class="mt-1 text-sm font-semibold text-white">
                {{ t('terminal.savedCommands.title') }}
              </h3>
              <p class="mt-1 text-xs leading-5 text-neutral-400">
                {{ t('terminal.savedCommands.subtitle') }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white"
                @click="openCreateEditor"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                {{ t('terminal.savedCommands.add') }}
              </button>
              <button
                v-if="props.mobile"
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
                :title="t('common.close')"
                @click="emit('close')"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div class="mt-3 flex items-center gap-2 text-xs text-neutral-500">
            <span class="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-emerald-200">
              {{ t('terminal.savedCommands.synced') }}
            </span>
            <span class="inline-flex items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-sky-200">
              {{ t('terminal.savedCommands.encrypted') }}
            </span>
            <span>{{ t('terminal.savedCommands.count', { count: commandCount }) }}</span>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div
            v-if="showEditor"
            class="mb-4 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4"
          >
            <div class="mb-3 flex items-center justify-between gap-3">
              <div class="text-sm font-medium text-white">
                {{ isEditing ? t('terminal.savedCommands.edit') : t('terminal.savedCommands.new') }}
              </div>
              <button
                type="button"
                class="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
                :title="t('common.cancel')"
                @click="cancelEditor"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="space-y-3">
              <div>
                <label class="mb-1.5 block text-xs text-neutral-400">{{ t('terminal.savedCommands.name') }}</label>
                <input
                  v-model="form.name"
                  type="text"
                  maxlength="80"
                  class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
                  :placeholder="t('terminal.savedCommands.namePlaceholder')"
                >
              </div>

              <div>
                <label class="mb-1.5 block text-xs text-neutral-400">{{ t('terminal.savedCommands.command') }}</label>
                <textarea
                  v-model="form.command"
                  rows="6"
                  maxlength="16384"
                  class="w-full resize-y rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs leading-5 text-white placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
                  :placeholder="t('terminal.savedCommands.commandPlaceholder')"
                ></textarea>
              </div>

              <div>
                <label class="mb-1.5 block text-xs text-neutral-400">{{ t('terminal.savedCommands.description') }}</label>
                <input
                  v-model="form.description"
                  type="text"
                  maxlength="300"
                  class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
                  :placeholder="t('terminal.savedCommands.descriptionPlaceholder')"
                >
              </div>

              <div class="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  class="rounded-xl border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
                  @click="cancelEditor"
                >
                  {{ t('common.cancel') }}
                </button>
                <button
                  type="button"
                  class="rounded-xl bg-white px-3 py-2 text-xs font-medium text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!canSubmit || saving"
                  @click="saveCommand"
                >
                  {{ saving ? t('common.saving') : t('common.save') }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="loading" class="flex items-center justify-center py-12">
            <div class="flex items-center gap-2 text-sm text-neutral-400">
              <div class="h-4 w-4 rounded-full border border-neutral-600 border-t-white animate-spin" />
              {{ t('common.loading') }}
            </div>
          </div>

          <div
            v-else-if="commands.length === 0"
            class="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/50 px-4 py-12 text-center"
          >
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900 text-neutral-500">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div class="mt-4 text-sm font-medium text-white">{{ t('terminal.savedCommands.emptyTitle') }}</div>
            <p class="mt-2 text-xs leading-5 text-neutral-500">{{ t('terminal.savedCommands.emptyDescription') }}</p>
          </div>

          <div v-else class="space-y-2.5">
            <button
              v-for="command in commands"
              :key="command.id"
              type="button"
              class="w-full rounded-2xl border p-3 text-left transition-all"
              :class="selectedId === command.id
                ? 'border-sky-400/45 bg-sky-400/10'
                : 'border-neutral-800 bg-neutral-950/60 hover:border-neutral-700 hover:bg-neutral-900/80'"
              @click="selectedId = command.id"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="h-2 w-2 flex-shrink-0 rounded-full" :class="selectedId === command.id ? 'bg-sky-300' : 'bg-neutral-600'" />
                    <span class="truncate text-sm font-medium text-white">{{ command.name }}</span>
                  </div>
                  <p
                    v-if="command.description"
                    class="mt-2 line-clamp-2 text-xs leading-5 text-neutral-400"
                  >
                    {{ command.description }}
                  </p>
                  <div class="mt-2 overflow-hidden break-all rounded-xl border border-neutral-800 bg-black/30 px-2.5 py-2 font-mono text-[11px] leading-5 text-neutral-300">
                    {{ getCommandPreview(command.command) }}
                  </div>
                </div>
                <button
                  type="button"
                  class="rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
                  :title="t('common.edit')"
                  @click.stop="selectedId = command.id; openEditEditor()"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.586-7.414a2 2 0 112.828 2.828L11.828 16.242a4 4 0 01-1.414.943L7 18l.815-3.414a4 4 0 01.943-1.414l8.656-8.586z" />
                  </svg>
                </button>
              </div>
            </button>
          </div>
        </div>

        <div class="border-t border-neutral-800 px-4 py-4">
          <div class="mb-3 text-xs text-neutral-500">
            <template v-if="selectedCommand">
              {{ t('terminal.savedCommands.selected', { name: selectedCommand.name }) }}
            </template>
            <template v-else>
              {{ t('terminal.savedCommands.notSelected') }}
            </template>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1 rounded-xl bg-white px-3 py-2.5 text-xs font-medium text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!selectedCommand || !connected"
              @click="executeSelectedCommand"
            >
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-5.197-3.03A1 1 0 008 9v6a1 1 0 001.555.832l5.197-3.03a1 1 0 000-1.664z" />
              </svg>
              {{ t('terminal.savedCommands.execute') }}
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!selectedCommand || deleting"
              @click="deleteSelectedCommand"
            >
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {{ t('common.delete') }}
            </button>
          </div>

          <p class="mt-3 text-[11px] leading-5 text-neutral-500">
            {{ connected ? t('terminal.savedCommands.runHint') : t('terminal.savedCommands.disconnectedHint') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
