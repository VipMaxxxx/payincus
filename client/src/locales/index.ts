import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import zhTW from './zh-TW'
import en from './en'

export type MessageSchema = typeof zhCN
export type Locale = 'zh-CN' | 'zh-TW' | 'en'

// 支援的語言列表
const supportedLocales: { code: Locale; name: string }[] = [
    { code: 'zh-CN', name: '简体中文' },
    { code: 'zh-TW', name: '繁體中文' },
    { code: 'en', name: 'English' },
]

// 檢測瀏覽器語言
function detectBrowserLocale(): Locale {
    const browserLang = navigator.language || (navigator as { userLanguage?: string }).userLanguage || ''

    // 中文區分簡體/繁體
    if (browserLang.startsWith('zh')) {
        // zh-TW, zh-HK, zh-Hant 等使用繁體
        if (browserLang.includes('TW') || browserLang.includes('HK') || browserLang.includes('Hant')) {
            return 'zh-TW'
        }
        // 其他中文默認簡體
        return 'zh-CN'
    }

    // 其他語言默認英文
    return 'en'
}

// 取得儲存的語言或檢測瀏覽器語言
function getInitialLocale(): Locale {
    const saved = localStorage.getItem('locale') as Locale | null
    if (saved && supportedLocales.some(l => l.code === saved)) {
        return saved
    }
    return detectBrowserLocale()
}

// 匯出支援的語言列表
export { supportedLocales }

const i18n = createI18n({
    legacy: false, // 使用 Composition API 模式
    locale: getInitialLocale(),
    fallbackLocale: 'en',
    messages: {
        'zh-CN': zhCN,
        'zh-TW': zhTW,
        'en': en,
    },
})

// 切換語言並儲存
export function setLocale(newLocale: Locale): void {
     
    ; (i18n.global.locale as any).value = newLocale
    localStorage.setItem('locale', newLocale)
    // 設定 HTML lang 屬性
    document.documentElement.lang = newLocale
}

// 取得目前語言
export function getLocale(): Locale {
     
    return (i18n.global.locale as any).value as Locale
}

// 取得目前語言的簡寫
// 用於顯示在 UI 上（如語言切換按鈕）
export function getCurrentLocaleShort(): string {
    const locale = getLocale()
    switch (locale) {
        case 'zh-CN':
            return '简'
        case 'zh-TW':
            return '繁'
        case 'en':
            return 'EN'
        default:
            return 'EN'
    }
}

export default i18n
