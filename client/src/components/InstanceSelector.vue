<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import FlagIcon from './FlagIcon.vue'
import InstanceDisplayIcon from './InstanceDisplayIcon.vue'

interface Instance {
  id: number
  name: string
  status: string
  iconBadgeId?: string | null
  instanceType: 'vm' | 'container'
  host: {
    id: number
    name: string
    location: string | null
    countryCode: string
  }
}

const props = defineProps<{
  modelValue: number | null
  instances: Instance[]
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
}>()

const { t } = useI18n()

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

// 当前选中的实例
const selectedInstance = computed(() => {
  if (props.modelValue === null) return null
  return props.instances.find(inst => inst.id === props.modelValue) || null
})

// 获取图标类型
function getIconType(instance: Instance): 'prime' | 'pro' | 'peer' {
  // 如果节点名称以 PEER 开头（不区分大小写），则是托管实例，显示 peer 图标
  const hostName = instance.host?.name || ''
  if (/^PEER\d/i.test(hostName)) {
    return 'peer'
  }
  return instance.instanceType === 'vm' ? 'prime' : 'pro'
}

// 选择实例
function selectInstance(instance: Instance | null) {
  emit('update:modelValue', instance?.id ?? null)
  isOpen.value = false
}

// 切换下拉状态
function toggleDropdown() {
  isOpen.value = !isOpen.value
}

// 点击外部关闭
function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div ref="dropdownRef" class="relative" :class="isOpen ? 'z-[90]' : 'z-10'">
    <!-- 触发器 -->
    <button
      type="button"
      class="input w-full flex items-center justify-between gap-2 text-left transition-all duration-200"
      :class="{ 'ring-2 ring-blue-500': isOpen }"
      @click="toggleDropdown"
    >
      <!-- 已选中状态 -->
      <div v-if="selectedInstance" class="flex items-center gap-2 min-w-0 flex-1">
        <InstanceDisplayIcon
          :badge-id="selectedInstance.iconBadgeId"
          :fallback-icon="getIconType(selectedInstance)"
          :alt="selectedInstance.name"
          :size="20"
        />
        <span class="truncate text-themed">{{ selectedInstance.name }}</span>
        <span class="text-themed-muted text-sm hidden sm:inline">·</span>
        <span class="text-themed-muted text-sm truncate hidden sm:inline">
          {{ selectedInstance.host.location || selectedInstance.host.name }}
        </span>
      </div>
      <!-- 未选中状态 -->
      <span v-else class="text-themed-muted">{{ placeholder || t('checkin.selectInstance') }}</span>
      <!-- 箭头图标 -->
      <svg 
        class="w-4 h-4 text-themed-muted flex-shrink-0 transition-transform duration-200"
        :class="{ 'rotate-180': isOpen }"
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- 下拉列表 -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 -translate-y-1"
    >
      <div 
        v-show="isOpen"
        class="absolute z-[100] mt-1 w-full bg-themed border border-themed rounded-lg shadow-2xl overflow-hidden"
      >
        <div class="max-h-80 overflow-y-auto">
          <!-- 空选项 -->
          <button
            type="button"
            class="w-full px-3 py-2.5 text-left text-themed-muted hover:bg-themed-hover transition-colors duration-150"
            @click="selectInstance(null)"
          >
            {{ placeholder || t('checkin.selectInstance') }}
          </button>
          
          <!-- 实例列表 -->
          <button
            v-for="instance in instances"
            :key="instance.id"
            type="button"
            class="w-full px-3 py-2.5 text-left transition-all duration-150 group"
            :class="[
              modelValue === instance.id 
                ? 'bg-blue-500/10 dark:bg-blue-500/20' 
                : 'hover:bg-themed-hover'
            ]"
            @click="selectInstance(instance)"
          >
            <div class="flex items-center gap-2.5">
              <!-- 图标 -->
              <div class="transition-transform duration-200 group-hover:scale-110">
                <InstanceDisplayIcon
                  :badge-id="instance.iconBadgeId"
                  :fallback-icon="getIconType(instance)"
                  :alt="instance.name"
                  :size="32"
                />
              </div>
              <!-- 信息 -->
              <div class="min-w-0 flex-1">
                <!-- 实例名称 -->
                <div 
                  class="font-medium truncate transition-colors duration-150"
                  :class="modelValue === instance.id ? 'text-blue-600 dark:text-blue-400' : 'text-themed'"
                >
                  {{ instance.name }}
                </div>
                <!-- 节点信息 -->
                <div class="flex items-center gap-1.5 text-xs text-themed-muted mt-0.5">
                  <FlagIcon :code="instance.host.countryCode" size="xs" />
                  <span class="truncate">{{ instance.host.location || instance.host.name }}</span>
                </div>
              </div>
              <!-- 选中标记 -->
              <svg 
                v-if="modelValue === instance.id"
                class="w-4 h-4 text-blue-500 flex-shrink-0"
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
