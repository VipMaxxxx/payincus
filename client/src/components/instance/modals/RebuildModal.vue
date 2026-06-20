<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import DistroIcon from '@/components/icons/DistroIcon.vue'
import InitCommandSelector from '@/components/extensions/InitCommandSelector.vue'

const { t } = useI18n()

interface ImageOption {
  incusAlias: string
  name: string
  description: string | null
  icon?: string | null
}

interface SshKeyOption {
  id: number
  name: string
}

interface Props {
  visible: boolean
  loading: boolean
  availableImages: ImageOption[]
  sshKeys: SshKeyOption[]
}

interface Emits {
  (e: 'update:visible', value: boolean): void
  (e: 'submit', data: { image: string; sshKeyId: number; customInitCommandIds?: number[] }): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const themeStore = useThemeStore()

const selectedImage = ref<string>('')
const selectedSshKeyId = ref<number | null>(null)
const customInitCommandIds = ref<number[]>([])
const isImageDropdownOpen = ref(false)
const imageSearchQuery = ref('')

// 当前选中的镜像数据
const selectedImageData = computed(() => {
  return props.availableImages.find(img => img.incusAlias === selectedImage.value)
})

// 获取当前选中镜像的发行版标识
const selectedImageDistro = computed(() => {
  return selectedImageData.value?.icon || 'linux'
})

// 过滤后的镜像列表
const filteredImages = computed(() => {
  if (!imageSearchQuery.value) return props.availableImages
  const query = imageSearchQuery.value.toLowerCase()
  return props.availableImages.filter(img => 
    img.name.toLowerCase().includes(query)
  )
})

// 按发行版分组
const groupedImages = computed(() => {
  const groups: Record<string, ImageOption[]> = {}
  for (const img of filteredImages.value) {
    const distro = img.icon || 'other'
    if (!groups[distro]) groups[distro] = []
    groups[distro].push(img)
  }
  return groups
})

// 当弹窗打开或数据变化时，初始化选中的值
watch(
  [() => props.visible, () => props.availableImages, () => props.sshKeys],
  ([visible, images, keys]) => {
    if (visible) {
      // 设置默认镜像
      if (images.length > 0 && !selectedImage.value) {
        selectedImage.value = images[0].incusAlias
      }
      // 设置默认 SSH 密钥
      if (keys.length > 0 && !selectedSshKeyId.value) {
        selectedSshKeyId.value = keys[0].id
      }
    } else {
      // 弹窗关闭时重置
      selectedImage.value = ''
      selectedSshKeyId.value = null
      customInitCommandIds.value = []
      isImageDropdownOpen.value = false
      imageSearchQuery.value = ''
    }
  },
  { immediate: true }
)

function selectImage(alias: string) {
  selectedImage.value = alias
  isImageDropdownOpen.value = false
  imageSearchQuery.value = ''
}

function toggleImageDropdown() {
  isImageDropdownOpen.value = !isImageDropdownOpen.value
  if (!isImageDropdownOpen.value) imageSearchQuery.value = ''
}

function handleSubmit(): void {
  if (selectedImage.value && selectedSshKeyId.value) {
    emit('submit', { 
      image: selectedImage.value, 
      sshKeyId: selectedSshKeyId.value,
      customInitCommandIds: customInitCommandIds.value.length > 0 ? customInitCommandIds.value : undefined
    })
  }
}

function close(): void {
  emit('update:visible', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        class="absolute inset-0 backdrop-blur-sm"
        :class="themeStore.isDark ? 'bg-black/60' : 'bg-black/30'"
        @click="close"
      ></div>
      
      <div 
        class="relative w-full max-w-md border rounded-xl shadow-2xl animate-fade-in"
        :class="themeStore.isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'"
      >
        <div 
          class="flex items-center justify-between p-5 border-b"
          :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'"
        >
          <h3 
            class="text-base font-medium"
            :class="themeStore.isDark ? 'text-gray-100' : 'text-gray-900'"
          >
            {{ t('rebuildModal.title') }}
          </h3>
          <button 
            :class="themeStore.isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'" 
            @click="close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div class="p-5 space-y-4">
          <!-- Info: preserved settings + password hint -->
          <div 
            class="p-3 rounded-lg"
            :class="themeStore.isDark ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-blue-50 border border-blue-200'"
          >
            <div 
              class="text-xs space-y-1"
              :class="themeStore.isDark ? 'text-blue-400' : 'text-blue-600'"
            >
              <p>{{ t('rebuildModal.preserveInfo') }}</p>
              <p>{{ t('rebuildModal.passwordHint') }}</p>
            </div>
          </div>

          <!-- Image selection -->
          <div>
            <label class="block text-xs text-gray-500 mb-1.5">{{ t('rebuildModal.selectImage') }}</label>
            <div class="image-selector-container relative">
              <!-- Trigger button -->
              <button
                type="button"
                class="w-full flex items-center gap-3 p-3 rounded-lg border transition-colors"
                :class="[
                  themeStore.isDark 
                    ? 'border-gray-700 bg-gray-800 hover:border-gray-600' 
                    : 'border-gray-200 bg-white hover:border-gray-300',
                  isImageDropdownOpen ? 'border-blue-500' : ''
                ]"
                @click.stop="toggleImageDropdown"
              >
                <DistroIcon
                  v-if="selectedImageData"
                  :distro="selectedImageData.icon || selectedImageData.name"
                  :size="24"
                  class="flex-shrink-0"
                />
                <span 
                  class="flex-1 text-left text-sm truncate"
                  :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'"
                >
                  {{ selectedImageData?.name || t('rebuildModal.selectImage') }}
                </span>
                <svg 
                  class="w-4 h-4 flex-shrink-0 transition-transform"
                  :class="[
                    themeStore.isDark ? 'text-gray-500' : 'text-gray-400',
                    isImageDropdownOpen ? 'rotate-180' : ''
                  ]"
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              <!-- Dropdown panel -->
              <div 
                v-show="isImageDropdownOpen"
                class="absolute z-50 w-full mt-2 rounded-lg border shadow-lg overflow-hidden"
                :class="themeStore.isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'"
              >
                <!-- Search input -->
                <div class="p-2 border-b" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-100'">
                  <input
                    v-model="imageSearchQuery"
                    type="text"
                    :placeholder="t('common.search')"
                    class="w-full px-3 py-2 text-sm rounded-md border outline-none"
                    :class="themeStore.isDark 
                      ? 'bg-gray-900 border-gray-700 text-gray-200 placeholder-gray-500 focus:border-blue-500' 
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-500'"
                    @click.stop
                  />
                </div>
                
                <!-- Options list -->
                <div class="max-h-56 overflow-y-auto">
                  <template v-for="(images, distro) in groupedImages" :key="distro">
                    <!-- Group header -->
                    <div 
                      class="px-3 py-1.5 text-xs font-medium uppercase tracking-wider sticky top-0"
                      :class="themeStore.isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-50 text-gray-500'"
                    >
                      {{ distro }}
                    </div>
                    <!-- Group items -->
                    <button
                      v-for="img in images"
                      :key="img.incusAlias"
                      type="button"
                      class="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                      :class="[
                        themeStore.isDark 
                          ? 'hover:bg-gray-700' 
                          : 'hover:bg-gray-50',
                        selectedImage === img.incusAlias 
                          ? (themeStore.isDark ? 'bg-blue-900/30' : 'bg-blue-50') 
                          : ''
                      ]"
                      @click.stop="selectImage(img.incusAlias)"
                    >
                      <DistroIcon
                        :distro="img.icon || img.name"
                        :size="20"
                        class="flex-shrink-0"
                      />
                      <span 
                        class="text-sm truncate"
                        :class="[
                          themeStore.isDark ? 'text-gray-200' : 'text-gray-900',
                          selectedImage === img.incusAlias ? 'font-medium' : ''
                        ]"
                      >
                        {{ img.name }}
                      </span>
                      <!-- Check mark for selected -->
                      <svg 
                        v-if="selectedImage === img.incusAlias"
                        class="w-4 h-4 ml-auto text-blue-500 flex-shrink-0" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                  </template>
                  
                  <!-- No results -->
                  <div 
                    v-if="Object.keys(groupedImages).length === 0"
                    class="px-3 py-6 text-center text-sm"
                    :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-400'"
                  >
                    {{ t('common.noResults') }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- SSH key selection -->
          <div>
            <label class="block text-xs text-gray-500 mb-1.5">{{ t('rebuildModal.selectSshKey') }}</label>
            <select v-model="selectedSshKeyId" class="input" :disabled="sshKeys.length === 0">
              <option v-if="sshKeys.length === 0" :value="null">{{ t('rebuildModal.noSshKey') }}</option>
              <option v-for="key in sshKeys" :key="key.id" :value="key.id">
                {{ key.name }}
              </option>
            </select>
            <p 
              v-if="sshKeys.length === 0"
              class="text-xs mt-1.5 text-red-500"
            >
              {{ t('rebuildModal.addSshKeyHint') }}
            </p>
          </div>

          <!-- 初始化命令选择 -->
          <div v-if="selectedImage">
            <InitCommandSelector
              v-model="customInitCommandIds"
              :distro="selectedImageDistro"
            />
          </div>

          <!-- Manual start hint -->
          <div 
            class="p-3 rounded-lg"
            :class="themeStore.isDark ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-yellow-50 border border-yellow-200'"
          >
            <p 
              class="text-xs"
              :class="themeStore.isDark ? 'text-yellow-400' : 'text-yellow-700'"
            >
              <svg class="w-4 h-4 inline-block mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {{ t('rebuildModal.manualStartHint') }}
            </p>
          </div>

          <!-- Action buttons -->
          <div class="flex justify-end gap-3 pt-2">
            <button type="button" class="btn-secondary" @click="close">{{ t('rebuildModal.cancel') }}</button>
            <button 
              :disabled="loading || !selectedImage || !selectedSshKeyId || sshKeys.length === 0" 
              class="btn-danger" 
              @click="handleSubmit"
            >
              <svg v-if="loading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {{ loading ? t('rebuildModal.rebuilding') : t('rebuildModal.confirmRebuild') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
