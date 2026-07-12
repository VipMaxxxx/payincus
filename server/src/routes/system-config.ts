/**
 * 系统配置路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { hasAvailableMailOffering } from '../db/mail.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { testSmtpConnection, sendTestEmail, clearTransporterCache } from '../lib/mailer.js'
import { logAdminAction } from '../lib/security.js'
import { isSupportedInviteCostResource, serializeInviteCostOptions, type InviteCostOption } from '../lib/invite-pricing.js'
import { assertSafeHttpUrl } from '../lib/outbound-security.js'
import {
    DEFAULT_VIP_BENEFITS_CONFIG_JSON,
    VIP_BENEFITS_CONFIG_KEY,
    normalizeVipBenefitsConfig
} from '../services/vip-benefits.js'

interface UpdateConfigsBody {
    configs: Array<{ key: string; value: string }>
}

interface PublicPromoPackagePlan {
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
}

interface PublicPromoPackage {
    id: number
    name: string
    description: string | null
    source: 'official' | 'market'
    plans: PublicPromoPackagePlan[]
}

const MASKED_SECRET_PLACEHOLDER = '********'
const telegramWebhookSecretPattern = /^[A-Za-z0-9_-]{1,256}$/
const telegramGroupJoinModes = new Set(['any', 'all'])
const maxRegisterGiftBalance = 99999999.99
const maxRegisterGiftPoints = 2147483647
const maxTransferFee = 100
const decimalMoneyPattern = /^\d+(?:\.\d{1,2})?$/
const positiveIntegerConfigPattern = /^[1-9]\d*$/
const nonNegativeIntegerConfigPattern = /^(?:0|[1-9]\d*)$/
const rateConfigPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/
const adminIdCsvPattern = /^(?:\s*[1-9]\d*\s*)(?:,\s*[1-9]\d*\s*)*$/
const trustedHostPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
const trafficBandwidthPattern = /^(\d+(?:\.\d+)?)\s*(?:Mbit|Gbit)$/i
const TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY = 'traffic_overage_throttle_speed'
const DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED = '1Mbit'
const TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY = 'ticket_auto_close_enabled'
const TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY = 'ticket_auto_close_hours'
const DEFAULT_TICKET_AUTO_CLOSE_HOURS = 24
const AFF_COMMISSION_RATE_CONFIG_KEY = 'aff_commission_rate'
const AFF_DISCOUNT_RATE_CONFIG_KEY = 'aff_discount_rate'
const DEFAULT_AFF_RATE = 0.05
const MAX_AFF_COMMISSION_RATE = 0.5
const MAX_AFF_DISCOUNT_RATE = 0.95
const HIGH_RISK_ADMIN_ID_KEYS = new Set([
    'system_update_allowed_admin_ids',
    'payincus_gift_card_admin_ids',
    'plugin_manager_allowed_admin_ids',
    'theme_manager_allowed_admin_ids'
])

function getEmailDomainForAudit(email: string): string {
    const domain = email.split('@').pop()?.trim().toLowerCase() || 'unknown'
    return domain.replace(/[^a-z0-9.-]/g, '').slice(0, 120) || 'unknown'
}

function isHttpImageUrl(value: string): boolean {
    try {
        const imageUrl = new URL(value)
        return ['http:', 'https:'].includes(imageUrl.protocol)
    } catch {
        return false
    }
}

function parsePositiveConfigInteger(value: string, max = Number.MAX_SAFE_INTEGER): number | null {
    const trimmed = value.trim()
    if (!positiveIntegerConfigPattern.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null
}

function parseNonNegativeConfigInteger(value: string, max = Number.MAX_SAFE_INTEGER): number | null {
    const trimmed = value.trim()
    if (!nonNegativeIntegerConfigPattern.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null
}

function parseDecimalMoneyConfig(value: string, max: number): number | null {
    const trimmed = value.trim()
    if (!decimalMoneyPattern.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null
}

function parseRateConfig(value: string, max: number): number | null {
    const trimmed = value.trim()
    if (!rateConfigPattern.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null
}

function normalizeAdminIdCsv(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (!adminIdCsvPattern.test(trimmed)) return null
    const ids = Array.from(new Set(trimmed.split(',').map(item => Number(item.trim()))))
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) return null
    return ids.join(',')
}

function normalizeTrustedHostsCsv(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) return ''
    const hosts = Array.from(new Set(
        trimmed
            .split(',')
            .map(item => item.trim().toLowerCase())
            .filter(Boolean)
    ))
    if (hosts.length > 50) return null
    if (hosts.some(host => host.length > 253 || !trustedHostPattern.test(host))) return null
    return hosts.join(',')
}

async function normalizeOptionalSafeHttpsUrl(value: string, label: string, maxLength = 1000): Promise<string | null> {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (trimmed.length > maxLength) return null
    try {
        const url = await assertSafeHttpUrl(trimmed, label)
        if (url.protocol !== 'https:') return null
        return url.toString().replace(/\/+$/, '')
    } catch {
        return null
    }
}

export default async function systemConfigRoutes(fastify: FastifyInstance) {
    // 获取公开的系统配置 (无需登录)
    fastify.get('/public', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (_request: FastifyRequest, _reply: FastifyReply) => {
        const [registrationEnabled, requireInviteCode, ticketCreationEnabled, freeSiteMode, mailAvailable, turnstileEnabled, turnstileSiteKey, avatarApiBase, smtpEnabled, emailDomainWhitelistEnabled, emailAllowedDomains, transferFee, footerContactEmail, footerTelegramLink, hostingMarketEntryEnabled, hostingNotice, brandName, brandSubtitle, brandLogoUrl, popupAnnouncementConfig, popupPromoImageUrlConfig, popupPromoPackageIdConfig] = await Promise.all([
            db.isRegistrationEnabled(),
            db.isInviteCodeRequired(),
            db.getSystemConfigBoolean('ticket_enabled', true),
            db.getSystemConfigBoolean('free_site_mode', false),
            hasAvailableMailOffering(),
            db.getSystemConfigBoolean('turnstile_enabled', false),
            db.getSystemConfig('turnstile_site_key'),
            db.getSystemConfig('avatar_api_base'),
            db.getSystemConfigBoolean('smtp_enabled', false),
            db.getSystemConfigBoolean('email_domain_whitelist_enabled', false),
            db.getSystemConfig('email_allowed_domains'),
            db.getSystemConfigFloat('transfer_fee', 0),
            db.getSystemConfig('footer_contact_email'),
            db.getSystemConfig('footer_telegram_link'),
            db.getSystemConfigBoolean('hosting_market_entry_enabled', true),
            db.getSystemConfig('hosting_notice'),
            db.getSystemConfig('brand_name'),
            db.getSystemConfig('brand_subtitle'),
            db.getSystemConfig('brand_logo_url'),
            db.getSystemConfigValueWithUpdatedAt('popup_announcement'),
            db.getSystemConfigValueWithUpdatedAt('popup_promo_image_url'),
            db.getSystemConfigValueWithUpdatedAt('popup_promo_package_id')
        ])

        // 解析允许的邮箱域名列表
        let allowedDomains: string[] | null = null
        if (emailDomainWhitelistEnabled) {
            const { DEFAULT_ALLOWED_DOMAINS } = await import('../lib/email-domain.js')
            if (emailAllowedDomains) {
                allowedDomains = emailAllowedDomains.split(',').map(d => d.trim().toLowerCase()).filter(d => d.length > 0)
            } else {
                allowedDomains = DEFAULT_ALLOWED_DOMAINS
            }
        }

        const popupAnnouncement = popupAnnouncementConfig.value?.trim()
        const popupPromoImageUrl = popupPromoImageUrlConfig.value?.trim()
        const popupPromoPackageId = popupPromoPackageIdConfig.value?.trim()
        let popupPromoPackage: PublicPromoPackage | null = null

        if (popupPromoImageUrl && isHttpImageUrl(popupPromoImageUrl) && popupPromoPackageId) {
            const packageId = parsePositiveConfigInteger(popupPromoPackageId, 2147483647)
            if (packageId) {
                const pkg = await db.prisma.package.findFirst({
                    where: {
                        id: packageId,
                        active: true,
                        globalShared: true
                    },
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        user: {
                            select: {
                                role: true
                            }
                        },
                        plans: {
                            where: { isActive: true },
                            select: {
                                id: true,
                                name: true,
                                description: true,
                                cpu: true,
                                memory: true,
                                disk: true,
                                trafficLimit: true,
                                price: true,
                                billingCycle: true,
                                isSoldOut: true
                            },
                            orderBy: [
                                { isSoldOut: 'asc' },
                                { sortOrder: 'asc' },
                                { id: 'asc' }
                            ],
                            take: 3
                        }
                    }
                })
                if (pkg) {
                    popupPromoPackage = {
                        id: pkg.id,
                        name: pkg.name,
                        description: pkg.description,
                        source: pkg.user.role === 'admin' ? 'official' : 'market',
                        plans: pkg.plans.map(plan => ({
                            id: plan.id,
                            name: plan.name,
                            description: plan.description,
                            cpu: plan.cpu,
                            memory: plan.memory,
                            disk: plan.disk,
                            trafficLimit: plan.trafficLimit.toString(),
                            price: Number(plan.price),
                            billingCycle: plan.billingCycle,
                            isSoldOut: plan.isSoldOut
                        }))
                    }
                }
            }
        }

        return {
            registrationEnabled,
            requireInviteCode,
            // ticket_enabled 仅控制新建入口；已有工单仍可查看、回复、关闭和重开。
            ticketEnabled: ticketCreationEnabled,
            freeSiteMode,
            mailAvailable,
            turnstileEnabled,
            turnstileSiteKey: turnstileEnabled ? turnstileSiteKey : null,
            avatarApiBase: avatarApiBase || 'https://api.dicebear.com/9.x',
            emailVerificationEnabled: smtpEnabled,
            emailDomainWhitelistEnabled,
            allowedEmailDomains: allowedDomains,
            transferFee,
            footerContactEmail,
            footerTelegramLink,
            hostingMarketEntryEnabled,
            hostingNotice,
            brandName: brandName || 'Incudal',
            brandSubtitle: brandSubtitle || '基于 Incus 的低价 NAT VPS',
            brandLogoUrl: brandLogoUrl || '/incudal_logo.webp',
            popupAnnouncement: popupAnnouncement ? popupAnnouncementConfig.value : null,
            popupAnnouncementUpdatedAt: popupAnnouncement ? popupAnnouncementConfig.updatedAt : null,
            popupPromoImageUrl: popupPromoPackage ? popupPromoImageUrl : null,
            popupPromoPackage,
            popupPromoUpdatedAt: popupPromoPackage
                ? [popupPromoImageUrlConfig.updatedAt, popupPromoPackageIdConfig.updatedAt].filter(Boolean).sort().pop() || null
                : null
        }
    })

    // 获取所有系统配置 (管理员)
    fastify.get('/', {
        onRequest: [fastify.authenticateAdmin]
    }, async (_request: FastifyRequest, _reply: FastifyReply) => {
        const configs = await db.getAllSystemConfigs()
        
        // 如果 email_allowed_domains 为空，填充默认白名单域名
        // 这样管理员可以看到实际生效的默认配置
        const { DEFAULT_ALLOWED_DOMAINS } = await import('../lib/email-domain.js')
        const processedConfigs = configs.map(c => {
            if (c.key === 'email_allowed_domains' && !c.value) {
                return { ...c, value: DEFAULT_ALLOWED_DOMAINS.join(',') }
            }
            return c
        })
        if (!processedConfigs.some(config => config.key === TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY)) {
            processedConfigs.push({
                id: 0,
                key: TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY,
                value: DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED,
                type: 'string',
                label: '流量超量限速',
                description: '实例流量超量后应用的独立带宽限制；套餐 trafficLimitSpeed 表示正常线速',
                created_at: '',
                updated_at: ''
            })
        }
        if (!processedConfigs.some(config => config.key === TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY)) {
            processedConfigs.push({
                id: 0,
                key: TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY,
                value: 'true',
                type: 'boolean',
                label: '工单自动关闭',
                description: '自动关闭超过等待时限且最后公开消息来自处理方的已解决工单',
                created_at: '',
                updated_at: ''
            })
        }
        if (!processedConfigs.some(config => config.key === TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY)) {
            processedConfigs.push({
                id: 0,
                key: TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY,
                value: DEFAULT_TICKET_AUTO_CLOSE_HOURS.toString(),
                type: 'number',
                label: '工单自动关闭等待时间',
                description: '从最后一条公开消息开始计算，单位为小时',
                created_at: '',
                updated_at: ''
            })
        }
        if (!processedConfigs.some(config => config.key === AFF_COMMISSION_RATE_CONFIG_KEY)) {
            processedConfigs.push({
                id: 0,
                key: AFF_COMMISSION_RATE_CONFIG_KEY,
                value: DEFAULT_AFF_RATE.toString(),
                type: 'number',
                label: 'AFF 佣金率',
                description: '新生成 AFF 码的佣金比例，如 0.05 = 5%',
                created_at: '',
                updated_at: ''
            })
        }
        if (!processedConfigs.some(config => config.key === AFF_DISCOUNT_RATE_CONFIG_KEY)) {
            processedConfigs.push({
                id: 0,
                key: AFF_DISCOUNT_RATE_CONFIG_KEY,
                value: DEFAULT_AFF_RATE.toString(),
                type: 'number',
                label: 'AFF 折扣率',
                description: '新生成 AFF 码的折扣比例，如 0.05 = 5%',
                created_at: '',
                updated_at: ''
            })
        }
        if (!processedConfigs.some(config => config.key === VIP_BENEFITS_CONFIG_KEY)) {
            processedConfigs.push({
                id: 0,
                key: VIP_BENEFITS_CONFIG_KEY,
                value: DEFAULT_VIP_BENEFITS_CONFIG_JSON,
                type: 'json',
                label: 'VIP 持续权益',
                description: '按 VIP 等级配置新购/续费折扣、额外流量和资源池加成百分比',
                created_at: '',
                updated_at: ''
            })
        }
        
        return { configs: processedConfigs }
    })

    // 获取默认配额配置 (管理员)
    fastify.get('/default-quota', {
        onRequest: [fastify.authenticateAdmin]
    }, async (_request: FastifyRequest, _reply: FastifyReply) => {
        const quota = await db.getDefaultQuotaConfig()
        return { quota }
    })

    // 批量更新配置 (管理员)
    fastify.put<{ Body: UpdateConfigsBody }>('/', {
        onRequest: [fastify.authenticateAdmin],
        schema: {
            body: {
                type: 'object',
                required: ['configs'],
                properties: {
                    configs: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['key', 'value'],
                            properties: {
                                key: { type: 'string' },
                                value: { type: 'string' }
                            }
                        }
                    }
                }
            }
        }
    }, async (request: FastifyRequest<{ Body: UpdateConfigsBody }>, reply: FastifyReply) => {
        const { configs } = request.body

        if (configs.some(config => HIGH_RISK_ADMIN_ID_KEYS.has(config.key)) && request.user.username !== 'admin') {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        const requestConfigMap = new Map(configs.map(config => [config.key, config]))

        // 验证配置键是否合法
        const validKeys = [
            'default_quota_host',
            'default_quota_friend',
            'default_quota_package',
            'registration_enabled',
            'require_invite_code',
            'invite_generation_costs',
            'invite_default_expire_days',
            'hosting_feature_enabled',
            'hosting_market_entry_enabled',
            'hosting_notice',
            'ticket_enabled',
            TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY,
            TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY,
            AFF_COMMISSION_RATE_CONFIG_KEY,
            AFF_DISCOUNT_RATE_CONFIG_KEY,
            VIP_BENEFITS_CONFIG_KEY,
            'free_site_mode',
            'free_site_register_gift_enabled',
            'free_site_register_gift_balance',
            'free_site_register_gift_points',
            'brand_name',
            'brand_subtitle',
            'brand_logo_url',
            'popup_announcement',
            'popup_promo_image_url',
            'popup_promo_package_id',
            'turnstile_enabled',
            'turnstile_site_key',
            'turnstile_secret_key',
            'avatar_api_base',
            'footer_contact_email',
            'footer_telegram_link',
            // Telegram bot binding
            'telegram_bot_enabled',
            'telegram_bot_username',
            'telegram_bot_token',
            'telegram_webhook_secret',
            'telegram_group_join_enabled',
            'telegram_group_chat_id',
            'telegram_group_join_mode',
            'telegram_group_min_recharge',
            'telegram_group_min_consume',
            'telegram_group_invite_expire_minutes',
            'telegram_vip_group_join_enabled',
            'telegram_vip_group_chat_id',
            'telegram_vip_group_join_mode',
            'telegram_vip_group_min_recharge',
            'telegram_vip_group_min_consume',
            'telegram_vip_group_invite_expire_minutes',
            // SMTP configuration
            'smtp_enabled',
            'smtp_host',
            'smtp_port',
            'smtp_secure',
            'smtp_username',
            'smtp_password',
            'smtp_from_email',
            'smtp_from_name',
            // Email domain whitelist
            'email_domain_whitelist_enabled',
            'email_allowed_domains',
            // Transfer fee
            'transfer_fee',
            // Ticket image Lsky config
            'ticket_image_lsky_base_url',
            'ticket_image_lsky_token',
            'ticket_image_lsky_api_version',
            'ticket_image_lsky_target_id',
            // Platform operation config
            'system_update_allowed_admin_ids',
            'payincus_gift_card_admin_ids',
            'plugin_manager_allowed_admin_ids',
            'theme_manager_allowed_admin_ids',
            'plugin_market_index_url',
            'plugin_market_trusted_hosts',
            'plugin_market_public_base_url',
            'theme_market_index_url',
            'theme_market_trusted_hosts',
            'theme_market_public_base_url',
            'plugin_submission_public_base_url',
            'plugin_storage_backup_schedule_enabled',
            'plugin_storage_backup_interval_hours',
            'plugin_storage_backup_retention_count',
            TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY
        ]

        // 布尔类型配置键
        const booleanKeys = ['registration_enabled', 'require_invite_code', 'hosting_feature_enabled', 'hosting_market_entry_enabled', 'ticket_enabled', TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY, 'free_site_mode', 'free_site_register_gift_enabled', 'turnstile_enabled', 'telegram_bot_enabled', 'telegram_group_join_enabled', 'telegram_vip_group_join_enabled', 'smtp_enabled', 'smtp_secure', 'email_domain_whitelist_enabled', 'plugin_storage_backup_schedule_enabled']
        // 字符串类型配置键
        const stringKeys = [
            'turnstile_site_key',
            'turnstile_secret_key',
            'avatar_api_base',
            'footer_contact_email',
            'footer_telegram_link',
            'brand_name',
            'brand_subtitle',
            'brand_logo_url',
            'telegram_bot_username',
            'telegram_bot_token',
            'telegram_webhook_secret',
            'telegram_group_chat_id',
            'telegram_group_join_mode',
            'telegram_vip_group_chat_id',
            'telegram_vip_group_join_mode',
            'hosting_notice',
            'popup_announcement',
            'popup_promo_image_url',
            'popup_promo_package_id',
            'smtp_host',
            'smtp_username',
            'smtp_password',
            'smtp_from_email',
            'smtp_from_name',
            'email_allowed_domains',
            'ticket_image_lsky_base_url',
            'ticket_image_lsky_token',
            'ticket_image_lsky_api_version',
            'ticket_image_lsky_target_id',
            'system_update_allowed_admin_ids',
            'payincus_gift_card_admin_ids',
            'plugin_manager_allowed_admin_ids',
            'theme_manager_allowed_admin_ids',
            'plugin_market_index_url',
            'plugin_market_trusted_hosts',
            'plugin_market_public_base_url',
            'theme_market_index_url',
            'theme_market_trusted_hosts',
            'theme_market_public_base_url',
            'plugin_submission_public_base_url',
            TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY
        ]
        const jsonKeys = ['invite_generation_costs', VIP_BENEFITS_CONFIG_KEY]
        // 数字类型配置键（包括配额配置）
        const numberKeys = ['smtp_port', 'default_quota_host', 'default_quota_friend', 'default_quota_package', 'free_site_register_gift_points', 'invite_default_expire_days', 'telegram_group_invite_expire_minutes', 'telegram_vip_group_invite_expire_minutes', 'plugin_storage_backup_interval_hours', 'plugin_storage_backup_retention_count', TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY]
        const decimalKeys = ['free_site_register_gift_balance', 'telegram_group_min_recharge', 'telegram_group_min_consume', 'telegram_vip_group_min_recharge', 'telegram_vip_group_min_consume']
        const rateKeys = [AFF_COMMISSION_RATE_CONFIG_KEY, AFF_DISCOUNT_RATE_CONFIG_KEY]

        for (const config of configs) {
            if (!validKeys.includes(config.key)) {
                return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_KEY, config.key))
            }
            // 布尔类型配置
            if (booleanKeys.includes(config.key)) {
                if (config.value !== 'true' && config.value !== 'false') {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                continue
            }
            // 字符串类型配置（允许空值）
            if (stringKeys.includes(config.key)) {
                if (config.key === TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY) {
                    config.value = config.value.trim()
                    const bandwidthMatch = config.value.match(trafficBandwidthPattern)
                    if (!bandwidthMatch || Number(bandwidthMatch[1]) <= 0) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                }
                if (config.key === 'popup_announcement' && config.value.length > 5000) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if (config.key === 'brand_name') {
                    config.value = config.value.trim()
                    if (config.value.length > 200) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                }
                if (config.key === 'brand_subtitle') {
                    config.value = config.value.trim()
                    if (config.value.length > 300) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                }
                if (config.key === 'brand_logo_url') {
                    config.value = config.value.trim()
                    if (config.value && config.value.length > 1000) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                    if (config.value && !isHttpImageUrl(config.value) && !config.value.startsWith('/')) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                }
                if (config.key === 'popup_promo_image_url') {
                    config.value = config.value.trim()
                    if (config.value && config.value.length > 1000) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                    if (config.value && !isHttpImageUrl(config.value)) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                }
                if (config.key === 'popup_promo_package_id') {
                    config.value = config.value.trim()
                }
                if (config.key === 'popup_promo_package_id' && config.value) {
                    const packageId = parsePositiveConfigInteger(config.value, 2147483647)
                    if (!packageId) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                    config.value = packageId.toString()
                    const pkg = await db.prisma.package.findFirst({
                        where: { id: packageId, active: true, globalShared: true },
                        select: { id: true }
                    })
                    if (!pkg) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                }
                if (config.key === 'ticket_image_lsky_api_version' && !['v1', 'v2'].includes(config.value)) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if (config.key === 'ticket_image_lsky_base_url') {
                    config.value = config.value.trim()
                    if (config.value && config.value.length > 1000) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                    if (config.value) {
                        try {
                            await assertSafeHttpUrl(config.value, 'Lsky base URL')
                        } catch {
                            return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                        }
                    }
                }
                if ([
                    'system_update_allowed_admin_ids',
                    'payincus_gift_card_admin_ids',
                    'plugin_manager_allowed_admin_ids',
                    'theme_manager_allowed_admin_ids'
                ].includes(config.key)) {
                    const normalized = normalizeAdminIdCsv(config.value)
                    if (normalized === null) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                    config.value = normalized
                }
                if (config.key === 'plugin_market_trusted_hosts' || config.key === 'theme_market_trusted_hosts') {
                    const normalized = normalizeTrustedHostsCsv(config.value)
                    if (normalized === null) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                    config.value = normalized
                }
                if (config.key === 'plugin_market_index_url' || config.key === 'theme_market_index_url' || config.key === 'plugin_market_public_base_url' || config.key === 'theme_market_public_base_url' || config.key === 'plugin_submission_public_base_url') {
                    const normalized = await normalizeOptionalSafeHttpsUrl(config.value, config.key)
                    if (normalized === null) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                    config.value = normalized
                }
                if ((config.key === 'telegram_group_join_mode' || config.key === 'telegram_vip_group_join_mode') && !telegramGroupJoinModes.has(config.value)) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if (
                    config.key === 'telegram_webhook_secret' &&
                    config.value &&
                    config.value !== MASKED_SECRET_PLACEHOLDER &&
                    !telegramWebhookSecretPattern.test(config.value)
                ) {
                    return reply.code(400).send({
                        error: 'Telegram webhook secret can only contain letters, numbers, underscores, and hyphens',
                        code: 'TELEGRAM_WEBHOOK_SECRET_INVALID'
                    })
                }
                continue
            }
            if (jsonKeys.includes(config.key)) {
                if (config.key === VIP_BENEFITS_CONFIG_KEY) {
                    try {
                        const parsed = JSON.parse(config.value)
                        config.value = JSON.stringify(normalizeVipBenefitsConfig(parsed))
                    } catch {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
                }
                if (config.key === 'invite_generation_costs') {
                    let parsed: unknown
                    try {
                        parsed = JSON.parse(config.value)
                    } catch {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }

                    if (!Array.isArray(parsed)) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }

                    const options: InviteCostOption[] = []
                    for (const item of parsed) {
                        if (!item || typeof item !== 'object') {
                            return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                        }
                        const resource = String((item as { resource?: unknown }).resource || '').trim()
                        if (!isSupportedInviteCostResource(resource)) {
                            return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                        }
                        const amount = (item as { amount?: unknown }).amount
                        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
                            return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                        }
                        if (resource === 'balance' && amount > maxRegisterGiftBalance) {
                            return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                        }
                        if (resource === 'points' && (!Number.isSafeInteger(amount) || amount > maxRegisterGiftPoints)) {
                            return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                        }
                        options.push({
                            resource,
                            amount,
                            enabled: (item as { enabled?: unknown }).enabled === true
                        })
                    }

                    config.value = serializeInviteCostOptions(options)
                }
                continue
            }
            if (decimalKeys.includes(config.key)) {
                const num = parseDecimalMoneyConfig(config.value, maxRegisterGiftBalance)
                if (num === null) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                config.value = (Math.round(num * 100) / 100).toString()
                continue
            }
            if (rateKeys.includes(config.key)) {
                const max = config.key === AFF_COMMISSION_RATE_CONFIG_KEY
                    ? MAX_AFF_COMMISSION_RATE
                    : MAX_AFF_DISCOUNT_RATE
                const rate = parseRateConfig(config.value, max)
                if (rate === null) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                config.value = rate.toString()
                continue
            }
            // 转移手续费特殊验证（0-100，支持两位小数）
            if (config.key === 'transfer_fee') {
                const value = config.value.trim()
                const num = Number(value)
                if (!decimalMoneyPattern.test(value) || !Number.isFinite(num) || num < 0 || num > maxTransferFee) {
                    return reply.code(400).send(apiError(
                        ErrorCode.CONFIG_INVALID_VALUE,
                        `转移手续费必须在 0-${maxTransferFee} 元之间，最多支持两位小数`
                    ))
                }
                config.value = (Math.round(num * 100) / 100).toString()
                continue
            }
            // 数字类型配置（smtp_port 等）
            if (numberKeys.includes(config.key)) {
                const max = config.key === 'free_site_register_gift_points'
                    ? maxRegisterGiftPoints
                    : config.key === 'smtp_port'
                        ? 65535
                        : config.key === 'plugin_storage_backup_interval_hours'
                            ? 24 * 30
                            : config.key === 'plugin_storage_backup_retention_count'
                                ? 365
                                : Number.MAX_SAFE_INTEGER
                const num = parseNonNegativeConfigInteger(config.value, max)
                if (num === null) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if (config.key === 'plugin_storage_backup_interval_hours' && num < 1) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if (config.key === 'plugin_storage_backup_retention_count' && num < 1) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if (config.key === TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY && num < 1) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if ((config.key === 'telegram_group_invite_expire_minutes' || config.key === 'telegram_vip_group_invite_expire_minutes') && (num < 1 || num > 10080)) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if (config.key === 'invite_default_expire_days' && num > 3650) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                config.value = num.toString()
                continue
            }
            // 验证数值类型（默认配额等）
            const num = parseNonNegativeConfigInteger(config.value)
            if (num === null) {
                return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
            }
            config.value = num.toString()
        }

        const freeSiteConfig = requestConfigMap.get('free_site_mode')
        const nextFreeSiteMode = freeSiteConfig
            ? freeSiteConfig.value === 'true'
            : await db.getSystemConfigBoolean('free_site_mode', false)
        const ensureConfigValue = (key: string, value: string) => {
            const existing = requestConfigMap.get(key)
            if (existing) {
                existing.value = value
            } else {
                const config = { key, value }
                configs.push(config)
                requestConfigMap.set(key, config)
            }
        }

        if (!nextFreeSiteMode) {
            ensureConfigValue('free_site_register_gift_enabled', 'false')
            ensureConfigValue('free_site_register_gift_balance', '0')
            ensureConfigValue('free_site_register_gift_points', '0')
        } else {
            const giftEnabledConfig = requestConfigMap.get('free_site_register_gift_enabled')
            const nextGiftEnabled = giftEnabledConfig
                ? giftEnabledConfig.value === 'true'
                : await db.getSystemConfigBoolean('free_site_register_gift_enabled', false)
            if (!nextGiftEnabled) {
                ensureConfigValue('free_site_register_gift_balance', '0')
                ensureConfigValue('free_site_register_gift_points', '0')
            }
        }

        if (requestConfigMap.has(TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY)) {
            await db.prisma.systemConfig.upsert({
                where: { key: TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY },
                update: {},
                create: {
                    key: TRAFFIC_OVERAGE_THROTTLE_CONFIG_KEY,
                    value: DEFAULT_TRAFFIC_OVERAGE_THROTTLE_SPEED,
                    type: 'string',
                    label: '流量超量限速',
                    description: '实例流量超量后应用的独立带宽限制；套餐 trafficLimitSpeed 表示正常线速'
                }
            })
        }
        if (requestConfigMap.has(TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY)) {
            await db.prisma.systemConfig.upsert({
                where: { key: TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY },
                update: {},
                create: {
                    key: TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY,
                    value: 'true',
                    type: 'boolean',
                    label: '工单自动关闭',
                    description: '自动关闭超过等待时限且最后公开消息来自处理方的已解决工单'
                }
            })
        }
        if (requestConfigMap.has(TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY)) {
            await db.prisma.systemConfig.upsert({
                where: { key: TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY },
                update: {},
                create: {
                    key: TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY,
                    value: DEFAULT_TICKET_AUTO_CLOSE_HOURS.toString(),
                    type: 'number',
                    label: '工单自动关闭等待时间',
                    description: '从最后一条公开消息开始计算，单位为小时'
                }
            })
        }
        if (requestConfigMap.has(VIP_BENEFITS_CONFIG_KEY)) {
            await db.prisma.systemConfig.upsert({
                where: { key: VIP_BENEFITS_CONFIG_KEY },
                update: {},
                create: {
                    key: VIP_BENEFITS_CONFIG_KEY,
                    value: DEFAULT_VIP_BENEFITS_CONFIG_JSON,
                    type: 'json',
                    label: 'VIP 持续权益',
                    description: '按 VIP 等级配置新购/续费折扣、额外流量和资源池加成百分比'
                }
            })
        }
        await db.updateSystemConfigs(configs)

        // Clear SMTP transporter cache if SMTP configs changed
        const smtpConfigKeys = ['smtp_enabled', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name']
        if (configs.some(c => smtpConfigKeys.includes(c.key))) {
            clearTransporterCache()
        }

        await createLog(
            request.user.id,
            'system',
            'system.config_update',
            `Updated ${configs.length} system configurations`,
            'success'
        )

        // AUTH003: 管理员操作审计日志 - 系统配置是敏感操作
        // 过滤敏感字段，不记录密码和密钥
        const sensitiveKeys = [
            'turnstile_secret_key',
            'smtp_password',
            'ticket_image_lsky_token',
            'telegram_bot_token',
            'telegram_group_chat_id',
            'telegram_vip_group_chat_id',
            'telegram_webhook_secret'
        ]
        const safeConfigs = configs.map(c => ({
            key: c.key,
            value: sensitiveKeys.includes(c.key) ? '***REDACTED***' : c.value
        }))
        await logAdminAction(request.user.id, 'system.config_update', {
            ip: request.ip,
            userAgent: request.headers['user-agent'],
            resourceType: 'system_config',
            newValue: safeConfigs,
            metadata: { configCount: configs.length }
        })

        return { message: 'Config updated' }
    })

    // Test SMTP connection (admin)
    fastify.post('/smtp/test', {
        onRequest: [fastify.authenticateAdmin]
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const result = await testSmtpConnection()

        if (result.success) {
            await createLog(
                request.user.id,
                'system',
                'smtp.test',
                'SMTP connection test successful',
                'success'
            )
            return { success: true, message: 'SMTP connection successful' }
        } else {
            await createLog(
                request.user.id,
                'system',
                'smtp.test',
                `SMTP connection test failed: ${result.error}`,
                'failed'
            )
            return reply.code(400).send({ success: false, error: result.error })
        }
    })

    // Send test email (admin)
    fastify.post<{ Body: { to: string } }>('/smtp/send-test', {
        onRequest: [fastify.authenticateAdmin],
        schema: {
            body: {
                type: 'object',
                required: ['to'],
                properties: {
                    to: { type: 'string', format: 'email' }
                }
            }
        }
    }, async (request: FastifyRequest<{ Body: { to: string } }>, reply: FastifyReply) => {
        const { to } = request.body
        const result = await sendTestEmail(to)

        if (result.success) {
            const recipientDomain = getEmailDomainForAudit(to)
            const providerReference = result.providerMessageId
                ? ` providerMessageId=${result.providerMessageId}`
                : ''
            await createLog(
                request.user.id,
                'system',
                'smtp.send_test',
                `SMTP test email accepted for recipient domain ${recipientDomain}; accepted=${result.acceptedRecipientCount}; rejected=${result.rejectedRecipientCount}; pending=${result.pendingRecipientCount};${providerReference}`,
                'success'
            )
            return {
                success: true,
                message: `Test email accepted for recipient domain ${recipientDomain}`,
                providerMessageId: result.providerMessageId,
                acceptedRecipientCount: result.acceptedRecipientCount,
                rejectedRecipientCount: result.rejectedRecipientCount,
                pendingRecipientCount: result.pendingRecipientCount,
                providerResponse: result.providerResponse
            }
        } else {
            const recipientDomain = getEmailDomainForAudit(to)
            await createLog(
                request.user.id,
                'system',
                'smtp.send_test',
                `Failed to send SMTP test email for recipient domain ${recipientDomain}: ${result.error}`,
                'failed'
            )
            return reply.code(400).send({ success: false, error: result.error })
        }
    })
}
