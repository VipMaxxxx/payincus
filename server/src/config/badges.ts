import { badgeCatalogData } from './badges.generated.js'

export interface BadgeCatalogItem {
  id: string
  name: string
  nameEn: string | null
  fullLabel: string
  sourceId?: string
  sourceLabel?: string
  seriesId: string
  seriesTitle: string
  seriesNameZh?: string
  seriesNameEn?: string | null
  seriesDescription: string
  assetUrl: string
  assetUrlDark?: string
  assetUrlLight?: string
  displayOrder?: number
  isActive?: boolean
  seriesIsActive?: boolean
}

export const BADGE_RANDOM_DRAW_COST = 500
export const BADGE_SELECT_COST = 1500

export const DEFAULT_BADGE_CATALOG = badgeCatalogData as unknown as BadgeCatalogItem[]
