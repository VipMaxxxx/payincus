import { useConfigStore } from '@/stores/config'

export function useBrand() {
  const configStore = useConfigStore()

  return {
    get brandName() {
      return configStore.brandName?.trim() || 'Incudal'
    },
    get brandSubtitle() {
      return configStore.brandSubtitle?.trim() || '基于 Incus 的低价 NAT VPS'
    },
    get brandLogoUrl() {
      return configStore.brandLogoUrl?.trim() || '/incudal_logo.webp'
    }
  }
}
