<script setup lang="ts">
import { computed } from 'vue'
import {
  siAlmalinux,
  siAlpinelinux,
  siArchlinux,
  siCentos,
  siDebian,
  siFedora,
  siGentoo,
  siKalilinux,
  siLinux,
  siLinuxmint,
  siOpensuse,
  siRedhat,
  siRockylinux,
  siSuse,
  siUbuntu,
  siVoidlinux
} from 'simple-icons'

interface Props {
  distro: string
  size?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 24
})

// 发行版到 simple-icons 图标的映射
const distroIconMap: Record<string, { path: string; hex: string }> = {
  almalinux: { path: siAlmalinux.path, hex: siAlmalinux.hex },
  alma: { path: siAlmalinux.path, hex: siAlmalinux.hex },
  alpine: { path: siAlpinelinux.path, hex: siAlpinelinux.hex },
  arch: { path: siArchlinux.path, hex: siArchlinux.hex },
  centos: { path: siCentos.path, hex: siCentos.hex },
  debian: { path: siDebian.path, hex: siDebian.hex },
  fedora: { path: siFedora.path, hex: siFedora.hex },
  gentoo: { path: siGentoo.path, hex: siGentoo.hex },
  kali: { path: siKalilinux.path, hex: siKalilinux.hex },
  mint: { path: siLinuxmint.path, hex: siLinuxmint.hex },
  opensuse: { path: siOpensuse.path, hex: siOpensuse.hex },
  suse: { path: siSuse.path, hex: siSuse.hex },
  oracle: { path: siRedhat.path, hex: 'F80000' }, // Oracle Linux 使用 Red Hat 图标，自定义颜色
  redhat: { path: siRedhat.path, hex: siRedhat.hex },
  rhel: { path: siRedhat.path, hex: siRedhat.hex },
  rockylinux: { path: siRockylinux.path, hex: siRockylinux.hex },
  rocky: { path: siRockylinux.path, hex: siRockylinux.hex },
  ubuntu: { path: siUbuntu.path, hex: siUbuntu.hex },
  void: { path: siVoidlinux.path, hex: siVoidlinux.hex },
  linux: { path: siLinux.path, hex: siLinux.hex }
}

function getDistroKey(distro: string): string {
  const lower = distro.toLowerCase()
  // 按优先级匹配（更具体的先匹配）
  const priorities = [
    'almalinux', 'alma',
    'alpine',
    'arch',
    'centos',
    'debian',
    'fedora',
    'gentoo',
    'kali',
    'mint',
    'opensuse', 'suse',
    'oracle',
    'redhat', 'rhel',
    'rockylinux', 'rocky',
    'ubuntu',
    'void'
  ]
  for (const key of priorities) {
    if (lower.includes(key)) return key
  }
  return 'linux'
}

const distroKey = computed(() => getDistroKey(props.distro))
const iconData = computed(() => distroIconMap[distroKey.value] || distroIconMap.linux)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
  >
    <path :d="iconData.path" :fill="'#' + iconData.hex" />
  </svg>
</template>
