import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

type PopupPromoPackage = {
    id: number
    name: string
    description: string | null
    source: 'official' | 'market'
    plans: Array<{
        id: number
        name: string
        description: string | null
        cpu: number
        memory: number
        disk: number
        trafficLimit: string
        price: number
        billingCycle: number
        isSoldOut: boolean
    }>
}

export const useConfigStore = defineStore('config', () => {
    const avatarApiBase = ref('https://api.dicebear.com/9.x')
    const brandName = ref('Incudal')
    const brandSubtitle = ref('基于 Incus 的低价 NAT VPS')
    const brandLogoUrl = ref('/incudal_logo.webp')
    const registrationEnabled = ref(true)
    const requireInviteCode = ref(true)
    const ticketEnabled = ref(true)
    const freeSiteMode = ref(false)
    const mailAvailable = ref(true)
    const turnstileEnabled = ref(false)
    const turnstileSiteKey = ref<string | null>(null)
    const transferFee = ref(0)
    const footerContactEmail = ref<string | null>('incudal@sent.com')
    const footerTelegramLink = ref<string | null>('https://t.me/incudal_com')
    const hostingMarketEntryEnabled = ref(true)
    const hostingNotice = ref<string | null>(null)
    const popupAnnouncement = ref<string | null>(null)
    const popupAnnouncementUpdatedAt = ref<string | null>(null)
    const popupPromoImageUrl = ref<string | null>(null)
    const popupPromoPackage = ref<PopupPromoPackage | null>(null)
    const popupPromoUpdatedAt = ref<string | null>(null)
    const loaded = ref(false)

    async function loadPublicConfig(force = false) {
        if (loaded.value && !force) return
        try {
            const config = await api.systemConfig.getPublic()
            registrationEnabled.value = config.registrationEnabled ?? true
            requireInviteCode.value = config.requireInviteCode
            ticketEnabled.value = config.ticketEnabled ?? true
            freeSiteMode.value = config.freeSiteMode ?? false
            mailAvailable.value = config.mailAvailable ?? true
            turnstileEnabled.value = config.turnstileEnabled || false
            turnstileSiteKey.value = config.turnstileSiteKey || null
            avatarApiBase.value = config.avatarApiBase || 'https://api.dicebear.com/9.x'
            brandName.value = config.brandName?.trim() || 'Incudal'
            brandSubtitle.value = config.brandSubtitle?.trim() || '基于 Incus 的低价 NAT VPS'
            brandLogoUrl.value = config.brandLogoUrl?.trim() || '/incudal_logo.webp'
            transferFee.value = config.transferFee || 0
            footerContactEmail.value = config.footerContactEmail ?? null
            footerTelegramLink.value = config.footerTelegramLink ?? null
            hostingMarketEntryEnabled.value = config.hostingMarketEntryEnabled ?? true
            hostingNotice.value = config.hostingNotice ?? null
            popupAnnouncement.value = config.popupAnnouncement ?? null
            popupAnnouncementUpdatedAt.value = config.popupAnnouncementUpdatedAt ?? null
            popupPromoImageUrl.value = config.popupPromoImageUrl ?? null
            popupPromoPackage.value = config.popupPromoPackage ?? null
            popupPromoUpdatedAt.value = config.popupPromoUpdatedAt ?? null
            loaded.value = true
        } catch (error) {
            console.error('Failed to load public config:', error)
        }
    }

    return {
        avatarApiBase,
        brandName,
        brandSubtitle,
        brandLogoUrl,
        registrationEnabled,
        requireInviteCode,
        ticketEnabled,
        freeSiteMode,
        mailAvailable,
        turnstileEnabled,
        turnstileSiteKey,
        transferFee,
        footerContactEmail,
        footerTelegramLink,
        hostingMarketEntryEnabled,
        hostingNotice,
        popupAnnouncement,
        popupAnnouncementUpdatedAt,
        popupPromoImageUrl,
        popupPromoPackage,
        popupPromoUpdatedAt,
        loaded,
        loadPublicConfig
    }
})
