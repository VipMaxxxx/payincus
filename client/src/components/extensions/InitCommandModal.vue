<script setup lang="ts">
/**
 * InitCommandModal - 初始化命令新增/编辑弹窗
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import DistroIcon from '@/components/icons/DistroIcon.vue'

interface InitCommand {
  id: number
  name: string
  command?: string
  commandPreview?: string
  commandLineCount?: number
  distros: string[]
  description: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface Distro {
  id: string
  name: string
  icon: string
}

const props = defineProps<{
  command: InitCommand | null  // null 表示新增模式
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save'): void
}>()

const { t } = useI18n()
const toast = useToast()

// 表单数据
const form = ref({
  name: '',
  command: '',
  distros: [] as string[],
  description: ''
})

// 发行版选项
const distroOptions = ref<Distro[]>([])
const loadingDistros = ref(false)

// 表单状态
const saving = ref(false)
const loadingDetail = ref(false)

// 是否为编辑模式
const isEdit = computed(() => props.command !== null)

// 表单验证
const isValid = computed(() => {
  return form.value.name.trim().length > 0 
    && form.value.command.trim().length > 0 
    && form.value.distros.length > 0
})

// 加载发行版选项
async function loadDistros(): Promise<void> {
  loadingDistros.value = true
  try {
    const response = await api.initCommands.getDistros()
    // 后端只返回 id 和 icon，前端负责翻译 name
    distroOptions.value = response.distros.map(d => ({
      id: d.id,
      name: t(`extensions.initCommands.distroNames.${d.id}`),
      icon: d.icon
    }))
  } catch (error) {
    console.error('Failed to load distros:', error)
    // 使用翻译键生成默认列表
    distroOptions.value = [
      { id: 'ubuntu', name: t('extensions.initCommands.distroNames.ubuntu'), icon: 'ubuntu' },
      { id: 'debian', name: t('extensions.initCommands.distroNames.debian'), icon: 'debian' },
      { id: 'rhel', name: t('extensions.initCommands.distroNames.rhel'), icon: 'almalinux' },
      { id: 'alpine', name: t('extensions.initCommands.distroNames.alpine'), icon: 'alpine' },
      { id: 'arch', name: t('extensions.initCommands.distroNames.arch'), icon: 'arch' },
      { id: 'suse', name: t('extensions.initCommands.distroNames.suse'), icon: 'opensuse' },
      { id: 'all', name: t('extensions.initCommands.distroNames.all'), icon: 'linux' }
    ]
  } finally {
    loadingDistros.value = false
  }
}

// 加载命令详情（编辑模式）
async function loadCommandDetail(): Promise<void> {
  if (!props.command) return
  
  loadingDetail.value = true
  try {
    const response = await api.initCommands.get(props.command.id)
    const cmd = response.command
    form.value.name = cmd.name
    form.value.command = cmd.command
    form.value.distros = [...cmd.distros]
    form.value.description = cmd.description || ''
  } catch (error: any) {
    toast.error(t('extensions.initCommands.loadDetailFailed') + ': ' + (error?.message || String(error)))
    emit('close')
  } finally {
    loadingDetail.value = false
  }
}

// 切换发行版选择
function toggleDistro(distroId: string): void {
  const idx = form.value.distros.indexOf(distroId)
  if (idx >= 0) {
    form.value.distros.splice(idx, 1)
  } else {
    // 如果选择了"通用"，则取消其他所有选择
    if (distroId === 'all') {
      form.value.distros = ['all']
    } else {
      // 如果选择了具体发行版，则取消"通用"
      const allIdx = form.value.distros.indexOf('all')
      if (allIdx >= 0) {
        form.value.distros.splice(allIdx, 1)
      }
      form.value.distros.push(distroId)
    }
  }
}

// 保存
async function save(): Promise<void> {
  if (!isValid.value) return
  
  saving.value = true
  try {
    if (isEdit.value && props.command) {
      // 更新
      await api.initCommands.update(props.command.id, {
        name: form.value.name.trim(),
        command: form.value.command,
        distros: form.value.distros,
        description: form.value.description.trim() || null
      })
      toast.success(t('extensions.initCommands.updateSuccess'))
    } else {
      // 新增
      await api.initCommands.create({
        name: form.value.name.trim(),
        command: form.value.command,
        distros: form.value.distros,
        description: form.value.description.trim() || undefined
      })
      toast.success(t('extensions.initCommands.createSuccess'))
    }
    emit('save')
  } catch (error: any) {
    const msg = isEdit.value 
      ? t('extensions.initCommands.updateFailed') 
      : t('extensions.initCommands.createFailed')
    toast.error(msg + ': ' + (error?.message || String(error)))
  } finally {
    saving.value = false
  }
}

// 弹窗可见性（用于过渡动画）
const visible = ref(true)

// 关闭
function close(): void {
  visible.value = false
  setTimeout(() => emit('close'), 200)
}

// 初始化
onMounted(() => {
  loadDistros()
  if (props.command) {
    loadCommandDetail()
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay">
        <div class="modal-backdrop" @click="close"></div>
        <div class="modal-content max-w-2xl">
          <!-- 头部 -->
          <div class="modal-header">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center">
                <svg class="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 class="modal-title">
                  {{ isEdit ? $t('extensions.initCommands.editTitle') : $t('extensions.initCommands.addTitle') }}
                </h3>
                <p class="text-xs text-themed-muted mt-0.5">
                  {{ $t('extensions.initCommands.modalDesc') }}
                </p>
              </div>
            </div>
            <button class="text-themed-muted hover:text-themed" @click="close">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 内容 -->
          <div class="modal-body space-y-4">
            <!-- 加载中 -->
            <div v-if="loadingDetail" class="text-center py-8">
              <div class="inline-flex items-center gap-2 text-themed-muted">
                <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{{ $t('common.loading') }}</span>
              </div>
            </div>

            <template v-else>
              <!-- 名称 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">
                  {{ $t('extensions.initCommands.name') }} <span class="text-red-500">*</span>
                </label>
                <input 
                  v-model="form.name" 
                  type="text" 
                  class="input" 
                  maxlength="100"
                  :placeholder="$t('extensions.initCommands.namePlaceholder')" 
                />
              </div>

              <!-- 命令内容 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">
                  {{ $t('extensions.initCommands.command') }} <span class="text-red-500">*</span>
                </label>
                <textarea 
                  v-model="form.command" 
                  class="input font-mono text-xs min-h-[200px] resize-y"
                  :placeholder="$t('extensions.initCommands.commandPlaceholder')"
                ></textarea>
                <p class="text-xs text-themed-faint mt-1">
                  {{ $t('extensions.initCommands.commandHint') }}
                </p>
              </div>

              <!-- 适配系统 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">
                  {{ $t('extensions.initCommands.distros') }} <span class="text-red-500">*</span>
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="distro in distroOptions"
                    :key="distro.id"
                    type="button"
                    class="inline-flex items-center gap-2 px-3 py-2 text-xs rounded-lg border-2 transition-all font-medium"
                    :class="form.distros.includes(distro.id) 
                      ? 'bg-gray-900 dark:bg-primary-500/20 border-gray-900 dark:border-primary-500 text-white dark:text-primary-300 shadow-md' 
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'"
                    @click="toggleDistro(distro.id)"
                  >
                    <DistroIcon :distro="distro.icon" :size="16" />
                    {{ distro.name }}
                  </button>
                </div>
                <p class="text-xs text-themed-faint mt-1">
                  {{ $t('extensions.initCommands.distrosHint') }}
                </p>
              </div>

              <!-- 备注 -->
              <div>
                <label class="block text-xs text-themed-muted mb-1.5">
                  {{ $t('extensions.initCommands.remark') }}
                </label>
                <input 
                  v-model="form.description" 
                  type="text" 
                  class="input" 
                  maxlength="500"
                  :placeholder="$t('extensions.initCommands.remarkPlaceholder')" 
                />
              </div>
            </template>
          </div>

          <!-- 底部 -->
          <div class="modal-footer">
            <button class="btn-ghost btn-sm" :disabled="saving" @click="close">
              {{ $t('common.cancel') }}
            </button>
            <button 
              class="btn-primary btn-sm" 
              :disabled="!isValid || saving || loadingDetail" 
              @click="save"
            >
              <svg v-if="saving" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ isEdit ? $t('common.save') : $t('common.create') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
