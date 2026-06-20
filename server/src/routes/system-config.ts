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

function isHttpImageUrl(value: string): boolean {
    try {
        const imageUrl = new URL(value)
        return ['http:', 'https:'].includes(imageUrl.protocol)
    } catch {
        return false
    }
}

export default async function systemConfigRoutes(fastify: FastifyInstance) {
    // 获取公开的系统配置 (无需登录)
    fastify.get('/public', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (_request: FastifyRequest, _reply: FastifyReply) => {
        const [registrationEnabled, requireInviteCode, ticketEnabled, freeSiteMode, mailAvailable, turnstileEnabled, turnstileSiteKey, avatarApiBase, smtpEnabled, emailDomainWhitelistEnabled, emailAllowedDomains, transferFee, footerContactEmail, footerTelegramLink, hostingMarketEntryEnabled, hostingNotice, brandName, brandSubtitle, brandLogoUrl, popupAnnouncementConfig, popupPromoImageUrlConfig, popupPromoPackageIdConfig] = await Promise.all([
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
            const packageId = Number(popupPromoPackageId)
            if (Number.isInteger(packageId) && packageId > 0) {
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
            ticketEnabled,
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
            'ticket_image_lsky_target_id'
        ]

        // 布尔类型配置键
        const booleanKeys = ['registration_enabled', 'require_invite_code', 'hosting_feature_enabled', 'hosting_market_entry_enabled', 'ticket_enabled', 'free_site_mode', 'free_site_register_gift_enabled', 'turnstile_enabled', 'telegram_bot_enabled', 'telegram_group_join_enabled', 'telegram_vip_group_join_enabled', 'smtp_enabled', 'smtp_secure', 'email_domain_whitelist_enabled']
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
            'ticket_image_lsky_target_id'
        ]
        const jsonKeys = ['invite_generation_costs']
        // 数字类型配置键（包括配额配置）
        const numberKeys = ['smtp_port', 'default_quota_host', 'default_quota_friend', 'default_quota_package', 'free_site_register_gift_points', 'invite_default_expire_days', 'telegram_group_invite_expire_minutes', 'telegram_vip_group_invite_expire_minutes']
        const decimalKeys = ['free_site_register_gift_balance', 'telegram_group_min_recharge', 'telegram_group_min_consume', 'telegram_vip_group_min_recharge', 'telegram_vip_group_min_consume']

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
                    const packageId = Number(config.value)
                    if (!Number.isInteger(packageId) || packageId <= 0) {
                        return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                    }
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
                        const amount = Number((item as { amount?: unknown }).amount)
                        if (!Number.isFinite(amount) || amount < 0) {
                            return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                        }
                        if (resource === 'balance' && amount > maxRegisterGiftBalance) {
                            return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                        }
                        if (resource === 'points' && (!Number.isInteger(amount) || amount > maxRegisterGiftPoints)) {
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
                const num = Number(config.value)
                if (isNaN(num) || num < 0) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if (config.key === 'free_site_register_gift_balance' && num > maxRegisterGiftBalance) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                config.value = (Math.round(num * 100) / 100).toString()
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
                const num = Number(config.value)
                if (!Number.isInteger(num) || num < 0) {
                    return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
                }
                if (config.key === 'free_site_register_gift_points' && num > maxRegisterGiftPoints) {
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
            const num = parseInt(config.value, 10)
            if (isNaN(num) || num < 0) {
                return reply.code(400).send(apiError(ErrorCode.CONFIG_INVALID_VALUE, config.key))
            }
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
            await createLog(
                request.user.id,
                'system',
                'smtp.send_test',
                `Test email sent to ${to}`,
                'success'
            )
            return { success: true, message: `Test email sent to ${to}` }
        } else {
            await createLog(
                request.user.id,
                'system',
                'smtp.send_test',
                `Failed to send test email to ${to}: ${result.error}`,
                'failed'
            )
            return reply.code(400).send({ success: false, error: result.error })
        }
    })
}
