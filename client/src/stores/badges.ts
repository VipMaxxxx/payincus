import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import api from '@/api'
import type { BadgeCatalogItem, BadgeSeriesItem } from '@/types/api'

export const useBadgeStore = defineStore('badges', () => {
  const series = ref<BadgeSeriesItem[]>([])
  const badges = ref<BadgeCatalogItem[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const loadingPromise = shallowRef<Promise<void> | null>(null)
  const missingReloads = new Set<string>()

  const badgeMap = computed(() => new Map(badges.value.map(badge => [badge.id, badge])))

  async function loadCatalog(force = false) {
    if (loading.value && loadingPromise.value) return loadingPromise.value
    if (loaded.value && !force) return

    loading.value = true
    loadingPromise.value = (async () => {
      try {
        const res = await api.entertainment.getBadgeCatalog()
        series.value = res.series || []
        badges.value = res.badges || []
        loaded.value = true
      } catch (error) {
        console.warn('Failed to load badge catalog:', error)
      } finally {
        loading.value = false
        loadingPromise.value = null
      }
    })()

    return loadingPromise.value
  }

  function getBadge(id: string | null | undefined): BadgeCatalogItem | null {
    if (!id) return null
    return badgeMap.value.get(id) || null
  }

  async function ensureBadge(id: string | null | undefined) {
    if (!id) return
    await loadCatalog()
    if (!getBadge(id) && !missingReloads.has(id)) {
      missingReloads.add(id)
      await loadCatalog(true)
    }
  }

  return {
    series,
    badges,
    loaded,
    loading,
    badgeMap,
    loadCatalog,
    ensureBadge,
    getBadge
  }
})
