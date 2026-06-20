import flagCountryMetadata from 'flag-icons/country.json'

interface FlagCountryMeta {
  code: string
  name: string
}

type TranslateCountryName = (key: string, fallback: string) => string

const flagCountryCodePattern = /^[a-z]{2}$/
const intlRegionCodePattern = /^([a-z]{2}|\d{3})$/i
const flagCountries = (flagCountryMetadata as FlagCountryMeta[])
  .filter(country => flagCountryCodePattern.test(country.code))
  .map(country => ({
    code: country.code.toLowerCase(),
    englishName: country.name
  }))

const englishCountryNameMap = new Map(
  flagCountries.map(country => [country.code, country.englishName])
)

const regionDisplayNameCache = new Map<string, Intl.DisplayNames | null>()

const specialCountryNames: Record<string, Record<string, string>> = {
  'zh-cn': {
    pc: '太平洋共同体',
    xx: '未知地区'
  },
  'zh-tw': {
    pc: '太平洋共同體',
    xx: '未知地區'
  },
  en: {
    pc: 'Pacific Community',
    xx: 'Unknown'
  }
}

function getLocaleBucket(locale: string): keyof typeof specialCountryNames {
  const normalizedLocale = locale.toLowerCase()
  if (normalizedLocale.startsWith('zh-cn')) return 'zh-cn'
  if (normalizedLocale.startsWith('zh-tw')) return 'zh-tw'
  return 'en'
}

function getRegionDisplayNames(locale: string): Intl.DisplayNames | null {
  const cacheKey = locale.toLowerCase()
  const cached = regionDisplayNameCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  if (typeof Intl.DisplayNames !== 'function') {
    regionDisplayNameCache.set(cacheKey, null)
    return null
  }

  const displayNames = new Intl.DisplayNames([locale], { type: 'region' })
  regionDisplayNameCache.set(cacheKey, displayNames)
  return displayNames
}

export const availableFlagCountryCodes = flagCountries
  .map(country => country.code)
  .filter(code => code !== 'cn')

export function normalizeCountryCodeForFlag(code: string): string {
  return code.toLowerCase()
}

export function getLocalizedCountryName(
  code: string,
  locale: string,
  translate?: TranslateCountryName
): string {
  const normalizedCode = code.trim().toLowerCase()
  if (!normalizedCode) {
    return ''
  }

  const uppercaseCode = normalizedCode.toUpperCase()

  if (translate) {
    const translatedName = translate(`common.countries.${normalizedCode}`, uppercaseCode)
    if (translatedName !== uppercaseCode) {
      return translatedName
    }
  }

  if (intlRegionCodePattern.test(normalizedCode)) {
    const displayName = getRegionDisplayNames(locale)?.of(uppercaseCode)
    if (displayName && displayName !== uppercaseCode) {
      return displayName
    }
  }

  const localeBucket = getLocaleBucket(locale)
  const specialName = specialCountryNames[localeBucket][normalizedCode]
  if (specialName) {
    return specialName
  }

  return englishCountryNameMap.get(normalizedCode) || uppercaseCode
}

export function normalizeCountryName(
  country: string | null | undefined,
  localizedNames: { mainlandChina: string; hongKong: string; macau: string; taiwan: string }
): string | null {
  if (!country) return null

  const normalized = country.trim()

  if (normalized === 'China' || normalized === 'China Mainland' || normalized === 'Mainland China') {
    return localizedNames.mainlandChina
  }

  if (normalized === 'Taiwan' || normalized === 'China Taiwan') {
    return localizedNames.taiwan
  }

  if (normalized === 'Hong Kong' || normalized === 'China Hong Kong') {
    return localizedNames.hongKong
  }

  if (normalized === 'Macau' || normalized === 'China Macau') {
    return localizedNames.macau
  }

  return country
}
