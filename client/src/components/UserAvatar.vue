<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useAuthStore } from '@/stores/auth'
import BadgeImage from '@/components/BadgeImage.vue'

const props = withDefaults(defineProps<{
  username: string
  email?: string | null
  avatarStyle?: string
  badgeId?: string | null
  preferBadge?: boolean
  size?: number
}>(), {
  email: null,
  avatarStyle: '',
  badgeId: null,
  preferBadge: true,
  size: 32
})

const configStore = useConfigStore()
const authStore = useAuthStore()

// 确保配置已加载
onMounted(() => {
  configStore.loadPublicConfig()
})

// 风格名称映射：camelCase -> kebab-case (DiceBear API 格式)
const styleNameMap: Record<string, string> = {
  adventurer: 'adventurer',
  adventurerNeutral: 'adventurer-neutral',
  avataaars: 'avataaars',
  avataaarsNeutral: 'avataaars-neutral',
  bigEars: 'big-ears',
  bigEarsNeutral: 'big-ears-neutral',
  bigSmile: 'big-smile',
  bottts: 'bottts',
  botttsNeutral: 'bottts-neutral',
  croodles: 'croodles',
  croodlesNeutral: 'croodles-neutral',
  dylan: 'dylan',
  funEmoji: 'fun-emoji',
  glass: 'glass',
  icons: 'icons',
  identicon: 'identicon',
  initials: 'initials',
  lorelei: 'lorelei',
  loreleiNeutral: 'lorelei-neutral',
  micah: 'micah',
  miniavs: 'miniavs',
  notionists: 'notionists',
  notionistsNeutral: 'notionists-neutral',
  openPeeps: 'open-peeps',
  personas: 'personas',
  pixelArt: 'pixel-art',
  pixelArtNeutral: 'pixel-art-neutral',
  rings: 'rings',
  shapes: 'shapes',
  thumbs: 'thumbs'
}

const styleKeys = Object.keys(styleNameMap)

// 根据用户名生成一个稳定的随机索引
function getStableRandomIndex(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % styleKeys.length
}

const avatarUrl = computed(() => {
  if (!props.username) return ''
  
  // 如果没有指定风格或风格无效，根据用户名随机选择
  let styleKey = props.avatarStyle
  if (!styleKey || !styleNameMap[styleKey]) {
    const idx = getStableRandomIndex(props.username)
    styleKey = styleKeys[idx]
  }
  
  const styleName = styleNameMap[styleKey]
  // 优先使用邮箱作为 seed，没有邮箱时降级使用用户名
  const seed = encodeURIComponent(props.email || props.username)
  const apiBase = configStore.avatarApiBase
  return `${apiBase}/${styleName}/svg?seed=${seed}&size=${props.size}`
})

const effectiveBadgeId = computed(() => {
  if (!props.preferBadge) return null
  if (props.badgeId) return props.badgeId
  if (authStore.user?.username === props.username) {
    return authStore.user.avatarBadgeId || null
  }
  return null
})

const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`
}))
</script>

<template>
  <BadgeImage
    v-if="effectiveBadgeId"
    :badge-id="effectiveBadgeId"
    :alt="username"
    :size="size"
    variant="avatar"
  />
  <img 
    v-else-if="avatarUrl"
    :src="avatarUrl" 
    :alt="username"
    class="rounded-full"
    :style="sizeStyle"
    loading="lazy"
  />
  <div 
    v-else
    class="rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-medium"
    :style="sizeStyle"
  >
    {{ username?.charAt(0).toUpperCase() }}
  </div>
</template>
