<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import DistroIcon from '@/components/icons/DistroIcon.vue'

const { t } = useI18n()

interface ImageOption {
  value: string
  label: string
  icon: string | null
}

interface Props {
  availableImages: ImageOption[]
  selectedImage: string
  imagesLoading: boolean
  stepNumber?: number  // 步骤编号，默认 3
  title?: string
  emptyMessage?: string
}

const props = withDefaults(defineProps<Props>(), {
  stepNumber: 3,
  title: undefined,
  emptyMessage: undefined
})
const emit = defineEmits<{
  'update:selectedImage': [value: string]
}>()

const themeStore = useThemeStore()
const isOpen = ref(false)
const searchQuery = ref('')

const selectedImageData = computed(() => {
  return props.availableImages.find(img => img.value === props.selectedImage)
})

const filteredImages = computed(() => {
  if (!searchQuery.value) return props.availableImages
  const query = searchQuery.value.toLowerCase()
  return props.availableImages.filter(img => 
    img.label.toLowerCase().includes(query)
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

function selectImage(value: string) {
  emit('update:selectedImage', value)
  isOpen.value = false
  searchQuery.value = ''
}

function toggleDropdown() {
  isOpen.value = !isOpen.value
  if (!isOpen.value) searchQuery.value = ''
}

// 点击外部关闭
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.image-selector-container')) {
    isOpen.value = false
    searchQuery.value = ''
  }
}

// 监听点击事件
if (typeof window !== 'undefined') {
  document.addEventListener('click', handleClickOutside)
}
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center gap-2 mb-4">
      <span 
        class="w-6 h-6 rounded-full text-sm font-bold flex items-center justify-center"
        :class="themeStore.isDark ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'"
      >{{ props.stepNumber }}</span>
      <h2 
        class="text-sm font-medium"
        :class="themeStore.isDark ? 'text-gray-300' : 'text-gray-700'"
      >
        {{ props.title || t('instance.selector.selectSystem') }}
      </h2>
    </div>
    
    <!-- Loading state -->
    <div v-if="imagesLoading" class="flex items-center justify-center py-8">
      <svg class="w-5 h-5 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
    </div>
    
    <!-- No images available -->
    <div 
      v-else-if="availableImages.length === 0" 
      class="text-center py-8"
    >
      <div class="text-4xl mb-3">💿</div>
      <p class="text-sm text-gray-500 mb-2">
        {{ props.emptyMessage || t('instance.selector.noImages') }}
      </p>
    </div>
    
    <!-- Custom dropdown -->
    <div v-else class="image-selector-container relative">
      <!-- Trigger button -->
      <button
        type="button"
        class="w-full flex items-center gap-3 p-3 rounded-lg border transition-colors"
        :class="[
          themeStore.isDark 
            ? 'border-gray-700 bg-gray-900 hover:border-gray-600' 
            : 'border-gray-200 bg-white hover:border-gray-300',
          isOpen ? (themeStore.isDark ? 'border-blue-500' : 'border-blue-500') : ''
        ]"
        @click.stop="toggleDropdown"
      >
        <DistroIcon
          v-if="selectedImageData"
          :distro="selectedImageData.icon || selectedImageData.label"
          :size="28"
          class="flex-shrink-0"
        />
        <span 
          class="flex-1 text-left text-sm"
          :class="themeStore.isDark ? 'text-gray-200' : 'text-gray-900'"
        >
          {{ selectedImageData?.label || props.title || t('instance.selector.selectSystem') }}
        </span>
        <svg 
          class="w-4 h-4 flex-shrink-0 transition-transform"
          :class="[
            themeStore.isDark ? 'text-gray-500' : 'text-gray-400',
            isOpen ? 'rotate-180' : ''
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
        v-show="isOpen"
        class="absolute z-50 w-full mt-2 rounded-lg border shadow-lg overflow-hidden"
        :class="themeStore.isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-200 bg-white'"
      >
        <!-- Search input -->
        <div class="p-2 border-b" :class="themeStore.isDark ? 'border-gray-700' : 'border-gray-100'">
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('common.search')"
            class="w-full px-3 py-2 text-sm rounded-md border outline-none"
            :class="themeStore.isDark 
              ? 'bg-gray-800 border-gray-700 text-gray-200 placeholder-gray-500 focus:border-blue-500' 
              : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-500'"
            @click.stop
          />
        </div>
        
        <!-- Options list -->
        <div class="max-h-72 overflow-y-auto">
          <template v-for="(images, distro) in groupedImages" :key="distro">
            <!-- Group header -->
            <div 
              class="px-3 py-1.5 text-xs font-medium uppercase tracking-wider sticky top-0"
              :class="themeStore.isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-50 text-gray-500'"
            >
              {{ distro }}
            </div>
            <!-- Group items -->
            <button
              v-for="img in images"
              :key="img.value"
              type="button"
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
              :class="[
                themeStore.isDark 
                  ? 'hover:bg-gray-800' 
                  : 'hover:bg-gray-50',
                selectedImage === img.value 
                  ? (themeStore.isDark ? 'bg-blue-900/30' : 'bg-blue-50') 
                  : ''
              ]"
              @click.stop="selectImage(img.value)"
            >
              <DistroIcon
                :distro="img.icon || img.label"
                :size="24"
                class="flex-shrink-0"
              />
              <span 
                class="text-sm"
                :class="[
                  themeStore.isDark ? 'text-gray-200' : 'text-gray-900',
                  selectedImage === img.value ? 'font-medium' : ''
                ]"
              >
                {{ img.label }}
              </span>
              <!-- Check mark for selected -->
              <svg 
                v-if="selectedImage === img.value"
                class="w-4 h-4 ml-auto text-blue-500" 
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
</template>
