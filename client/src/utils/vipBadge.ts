export interface VipBadgeStyle {
  backgroundColor: string
  textColor: string
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

const DEFAULT_VIP_BADGE_STYLES: VipBadgeStyle[] = [
  { backgroundColor: '#FEF3C7', textColor: '#92400E' },
  { backgroundColor: '#D1FAE5', textColor: '#047857' },
  { backgroundColor: '#DBEAFE', textColor: '#1D4ED8' },
  { backgroundColor: '#EDE9FE', textColor: '#6D28D9' },
  { backgroundColor: '#FFEDD5', textColor: '#C2410C' },
  { backgroundColor: '#FCE7F3', textColor: '#BE185D' },
  { backgroundColor: '#FFE4E6', textColor: '#BE123C' },
  { backgroundColor: '#CFFAFE', textColor: '#0E7490' },
  { backgroundColor: '#FAE8FF', textColor: '#A21CAF' },
  { backgroundColor: '#FEF9C3', textColor: '#A16207' }
]

function normalizeLevel(level: unknown): number {
  const parsed = Number(level)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback
}

export function getDefaultVipBadgeStyle(level: unknown): VipBadgeStyle {
  const normalized = normalizeLevel(level)
  const style = DEFAULT_VIP_BADGE_STYLES[(normalized - 1) % DEFAULT_VIP_BADGE_STYLES.length]
  return { ...style }
}

export function normalizeVipBadgeStyle(style: unknown, level: unknown): VipBadgeStyle {
  const fallback = getDefaultVipBadgeStyle(level)
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return fallback
  }

  const record = style as Record<string, unknown>
  return {
    backgroundColor: normalizeHexColor(record.backgroundColor, fallback.backgroundColor),
    textColor: normalizeHexColor(record.textColor, fallback.textColor)
  }
}

export function getVipBadgeInlineStyle(style: VipBadgeStyle | null | undefined): Record<string, string> | undefined {
  if (!style) return undefined
  return {
    backgroundColor: style.backgroundColor,
    color: style.textColor,
    borderColor: style.backgroundColor
  }
}
