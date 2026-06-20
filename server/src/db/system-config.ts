/**
 * 系统配置数据库操作
 * PERF001: 添加缓存层减少数据库查询
 */

import { prisma } from './prisma.js'
import {
    getCachedConfig,
    setCachedConfig,
    invalidateCachedConfigs,
    invalidateAllConfigCache
} from '../lib/config-cache.js'

const SENSITIVE_CONFIG_KEYS = new Set([
    'smtp_password',
    'turnstile_secret_key',
    'ticket_image_lsky_token',
    'telegram_bot_token',
    'telegram_webhook_secret'
])
const MASKED_SECRET_PLACEHOLDER = '********'

// 默认配额配置（新配额系统）
// 注意：节点、套餐、好友功能默认不开放（默认值为 0），需要管理员授权
// 注意：不再限制实例配额，用户可以创建无限数量的实例
export const DEFAULT_QUOTA_CONFIG = {
    default_quota_host: 0,       // 宿主机数量上限（0 = 未授权，需管理员开启）
    default_quota_friend: 0,     // 好友数量上限（0 = 未授权，需管理员开启）
    default_quota_package: 0     // 套餐数量上限（0 = 未授权，需管理员开启）
}

export interface SystemConfigItem {
    id: number
    key: string
    value: string
    type: string
    label: string | null
    description: string | null
    created_at: string
    updated_at: string
}

export interface DefaultQuotaConfig {
    hostLimit: number      // 宿主机数量上限
    friendLimit: number    // 好友数量上限
    packageLimit: number   // 套餐数量上限
}

/**
 * 初始化系统配置（如果不存在则创建默认值）
 */
export async function initSystemConfig(): Promise<void> {
    const configs = [
        // 新配额系统
        // 注意：节点、套餐、好友功能默认不开放（默认值为 0），需要管理员授权
        // 注意：不再限制实例配额，用户可以创建无限数量的实例
        { key: 'default_quota_host', value: '0', type: 'number', label: '默认宿主机配额', description: '新用户默认可创建宿主机数量（0 = 未授权，需管理员开启）' },
        { key: 'default_quota_friend', value: '0', type: 'number', label: '默认好友配额', description: '新用户默认可添加好友数量（0 = 未授权，需管理员开启）' },
        { key: 'default_quota_package', value: '0', type: 'number', label: '默认套餐配额', description: '新用户默认可创建套餐数量（0 = 未授权，需管理员开启）' },
        { key: 'registration_enabled', value: 'true', type: 'boolean', label: '开放注册', description: '是否允许新用户注册账号' },
        { key: 'require_invite_code', value: 'true', type: 'boolean', label: '邀请码注册', description: '是否需要邀请码才能注册' },
        { key: 'invite_generation_costs', value: '[{"resource":"balance","amount":0,"enabled":false},{"resource":"points","amount":0,"enabled":false}]', type: 'json', label: '邀请码生成定价', description: '用户生成邀请码可选择的成本项，当前支持 balance 和 points' },
        { key: 'invite_default_expire_days', value: '0', type: 'number', label: '用户邀请码有效期', description: '用户生成邀请码的默认有效天数，0 表示永不过期' },
        { key: 'user_vip_metric', value: 'totalRecharge', type: 'string', label: '用户 VIP 统计口径', description: '用户 VIP 等级全局计算口径：totalRecharge=累计充值，totalConsume=累计消费' },
        { key: 'hosting_feature_enabled', value: 'true', type: 'boolean', label: '托管节点入口', description: '关闭后，仅对已经创建过节点的用户显示托管节点和收益入口' },
        { key: 'hosting_market_entry_enabled', value: 'true', type: 'boolean', label: '托管套餐购买入口', description: '控制开通实例页面是否显示托管专区和托管套餐购买入口' },
        { key: 'hosting_notice', value: '', type: 'string', label: '托管公告', description: '显示在托管收益页面的公告内容，留空则不显示' },
        { key: 'ticket_enabled', value: 'true', type: 'boolean', label: '工单开关', description: '关闭后，普通用户无法发起工单，用户端隐藏工单入口' },
        { key: 'free_site_mode', value: 'false', type: 'boolean', label: '白嫖站', description: '开启后，用户端隐藏充值入口、充值记录和推荐计划' },
        { key: 'free_site_register_gift_enabled', value: 'false', type: 'boolean', label: '注册自动赠送', description: '白嫖站开启后，新用户注册成功自动赠送余额和积分' },
        { key: 'free_site_register_gift_balance', value: '0', type: 'number', label: '注册赠送余额', description: '白嫖站注册自动赠送的账户余额（元）' },
        { key: 'free_site_register_gift_points', value: '0', type: 'number', label: '注册赠送积分', description: '白嫖站注册自动赠送的积分数量' },
        { key: 'brand_name', value: 'Incudal', type: 'string', label: '系统名称', description: '站点顶部、登录页、SEO 等位置展示的系统名称，留空则使用默认值' },
        { key: 'brand_subtitle', value: '基于 Incus 的低价 NAT VPS', type: 'string', label: '网站副标题', description: '站点顶部、公共页、SEO 默认描述等位置展示的品牌副标题，留空则使用默认值' },
        { key: 'brand_logo_url', value: '/incudal_logo.webp', type: 'string', label: '系统 Logo 地址', description: '站点顶部、登录页、SEO 等位置展示的 Logo 图片地址，留空则使用默认值' },
        { key: 'popup_announcement', value: '', type: 'string', label: '弹窗公告', description: '用户访问网站时弹出的公告内容，留空则不广播' },
        { key: 'popup_promo_image_url', value: '', type: 'string', label: '图片推广弹窗图片', description: '用户访问网站时弹出的套餐推广图片 URL，留空则不显示图片推广弹窗' },
        { key: 'popup_promo_package_id', value: '', type: 'string', label: '图片推广弹窗套餐', description: '图片推广弹窗的目标套餐 ID，需配合图片 URL 使用' },
        // Turnstile 配置
        { key: 'turnstile_enabled', value: 'false', type: 'boolean', label: 'Turnstile 验证', description: '是否启用 Cloudflare Turnstile 人机验证' },
        { key: 'turnstile_site_key', value: '', type: 'string', label: 'Turnstile Site Key', description: 'Cloudflare Turnstile 站点密钥（前端使用）' },
        { key: 'turnstile_secret_key', value: '', type: 'secret', label: 'Turnstile Secret Key', description: 'Cloudflare Turnstile 密钥（后端验证使用）' },
        // 头像 API 配置
        { key: 'avatar_api_base', value: 'https://api.dicebear.com/9.x', type: 'string', label: '头像 API 地址', description: 'DiceBear 头像 API 基础地址，可自建服务' },
        // 侧边栏底部联系方式
        { key: 'footer_contact_email', value: 'incudal@sent.com', type: 'string', label: '底部联系邮箱', description: '侧边栏底部邮箱按钮显示的邮箱地址或 mailto 链接' },
        { key: 'footer_telegram_link', value: 'https://t.me/incudal_com', type: 'string', label: '底部 Telegram 群链接', description: '侧边栏底部 Telegram 按钮跳转地址' },
        // Telegram 专用机器人配置
        { key: 'telegram_bot_enabled', value: 'false', type: 'boolean', label: 'Telegram 专用机器人', description: '是否启用 Telegram 账号绑定机器人' },
        { key: 'telegram_bot_username', value: '', type: 'string', label: 'Telegram Bot 用户名', description: '机器人用户名，不含 @，用于生成绑定链接' },
        { key: 'telegram_bot_token', value: '', type: 'secret', label: 'Telegram Bot Token', description: 'BotFather 分配的专用机器人 Token' },
        { key: 'telegram_webhook_secret', value: '', type: 'secret', label: 'Telegram Webhook Secret', description: 'Telegram webhook 请求头 X-Telegram-Bot-Api-Secret-Token 校验值' },
        { key: 'telegram_group_join_enabled', value: 'false', type: 'boolean', label: 'Telegram 入群申请', description: '是否允许绑定用户通过机器人申请私有群邀请链接' },
        { key: 'telegram_group_chat_id', value: '', type: 'string', label: 'Telegram 私有群 Chat ID', description: '用于 createChatInviteLink 的私有群或超级群 chat_id' },
        { key: 'telegram_group_join_mode', value: 'any', type: 'string', label: 'Telegram 入群门槛模式', description: 'any=充值或消费任一达标，all=充值和消费同时达标' },
        { key: 'telegram_group_min_recharge', value: '0', type: 'number', label: 'Telegram 入群累计充值门槛', description: '累计充值金额达到该值后可申请入群，0 表示不要求' },
        { key: 'telegram_group_min_consume', value: '0', type: 'number', label: 'Telegram 入群累计消费门槛', description: '累计消费金额达到该值后可申请入群，0 表示不要求' },
        { key: 'telegram_group_invite_expire_minutes', value: '30', type: 'number', label: 'Telegram 邀请链接有效期', description: '机器人生成的一次性邀请链接有效分钟数' },
        { key: 'telegram_vip_group_join_enabled', value: 'false', type: 'boolean', label: 'Telegram 高级群入群申请', description: '是否允许绑定用户通过机器人申请高级用户群邀请链接' },
        { key: 'telegram_vip_group_chat_id', value: '', type: 'string', label: 'Telegram 高级群 Chat ID', description: '用于 createChatInviteLink 的高级私有群或超级群 chat_id' },
        { key: 'telegram_vip_group_join_mode', value: 'all', type: 'string', label: 'Telegram 高级群门槛模式', description: 'any=充值或消费任一达标，all=充值和消费同时达标' },
        { key: 'telegram_vip_group_min_recharge', value: '0', type: 'number', label: 'Telegram 高级群累计充值门槛', description: '累计充值金额达到该值后可申请高级群，0 表示不要求' },
        { key: 'telegram_vip_group_min_consume', value: '0', type: 'number', label: 'Telegram 高级群累计消费门槛', description: '累计消费金额达到该值后可申请高级群，0 表示不要求' },
        { key: 'telegram_vip_group_invite_expire_minutes', value: '30', type: 'number', label: 'Telegram 高级群邀请链接有效期', description: '机器人生成的高级群一次性邀请链接有效分钟数' },
        // SMTP 邮件配置
        { key: 'smtp_enabled', value: 'false', type: 'boolean', label: 'SMTP 邮件验证', description: '是否启用邮件验证码' },
        { key: 'smtp_host', value: '', type: 'string', label: 'SMTP 服务器', description: 'SMTP 服务器地址' },
        { key: 'smtp_port', value: '587', type: 'number', label: 'SMTP 端口', description: 'SMTP 服务器端口' },
        { key: 'smtp_secure', value: 'false', type: 'boolean', label: 'SMTP SSL/TLS', description: '是否使用 SSL/TLS 加密（端口 465 通常启用）' },
        { key: 'smtp_username', value: '', type: 'string', label: 'SMTP 用户名', description: 'SMTP 认证用户名' },
        { key: 'smtp_password', value: '', type: 'secret', label: 'SMTP 密码', description: 'SMTP 认证密码' },
        { key: 'smtp_from_email', value: '', type: 'string', label: '发件人邮箱', description: '邮件发件人地址' },
        { key: 'smtp_from_name', value: 'Incudal', type: 'string', label: '发件人名称', description: '邮件发件人显示名称' },
        // 邮箱域名白名单配置
        { key: 'email_domain_whitelist_enabled', value: 'false', type: 'boolean', label: '邮箱域名白名单', description: '是否启用邮箱域名白名单限制' },
        { key: 'email_allowed_domains', value: '', type: 'string', label: '允许的邮箱域名', description: '允许注册的邮箱域名列表，逗号分隔' },
        // 转移手续费配置
        { key: 'transfer_fee', value: '0', type: 'number', label: '转移手续费', description: '实例转移手续费（元），0表示免费，发起时扣除，拒绝时退还' },
        // Lsky 工单图片配置
        { key: 'ticket_image_lsky_base_url', value: '', type: 'string', label: 'Lsky 地址', description: '兰空图床站点地址，例如 https://img.example.com' },
        { key: 'ticket_image_lsky_token', value: '', type: 'secret', label: 'Lsky Token', description: '兰空图床 API Token（仅后端使用）' },
        { key: 'ticket_image_lsky_api_version', value: 'v1', type: 'string', label: 'Lsky API 版本', description: '上传时使用的 API 版本：v1 或 v2' },
        { key: 'ticket_image_lsky_target_id', value: '', type: 'string', label: '策略/存储 ID', description: 'v1 填 strategy_id，v2 填 storage_id，可留空使用默认策略' }
    ]

    for (const config of configs) {
        await prisma.systemConfig.upsert({
            where: { key: config.key },
            update: {},
            create: config
        })
    }
}

/**
 * 获取布尔类型配置值
 */
export async function getSystemConfigBoolean(key: string, defaultValue: boolean): Promise<boolean> {
    const value = await getSystemConfig(key)
    if (value === null) return defaultValue
    return value === 'true' || value === '1'
}

/**
 * 检查是否需要邀请码注册
 */
export async function isInviteCodeRequired(): Promise<boolean> {
    return getSystemConfigBoolean('require_invite_code', true)
}

/**
 * 检查是否开放注册
 */
export async function isRegistrationEnabled(): Promise<boolean> {
    return getSystemConfigBoolean('registration_enabled', true)
}

/**
 * 获取所有系统配置
 */
export async function getAllSystemConfigs(): Promise<SystemConfigItem[]> {
    const configs = await prisma.systemConfig.findMany({
        orderBy: { id: 'asc' }
    })

    return configs.map(c => {
        const value = SENSITIVE_CONFIG_KEYS.has(c.key) && c.value
            ? MASKED_SECRET_PLACEHOLDER
            : c.value

        return {
            id: c.id,
            key: c.key,
            value,
            type: c.type,
            label: c.label,
            description: c.description,
            created_at: c.createdAt.toISOString(),
            updated_at: c.updatedAt.toISOString()
        }
    })
}

/**
 * 获取单个配置值
 * PERF001: 使用缓存减少数据库查询
 * @param decrypt 是否解密敏感数据（默认 true）
 */
export async function getSystemConfig(key: string, decrypt: boolean = true): Promise<string | null> {
    // PERF001: 先检查缓存（敏感数据不缓存）
    const isSensitive = SENSITIVE_CONFIG_KEYS.has(key)
    if (!isSensitive) {
        const cached = getCachedConfig(key)
        if (cached !== undefined) {
            return cached
        }
    }

    const config = await prisma.systemConfig.findUnique({
        where: { key }
    })
    if (!config?.value) {
        const result = config?.value ?? null
        // 缓存空值（避免重复查询）
        if (!isSensitive) {
            setCachedConfig(key, result)
        }
        return result
    }

    // 解密敏感数据
    if (decrypt && isSensitive) {
        // 检查是否是加密格式（iv:tag:encrypted）
        if (config.value.includes(':')) {
            try {
                const { decryptSensitiveData } = await import('../lib/security.js')
                return decryptSensitiveData(config.value)
            } catch (err) {
                console.error(`Failed to decrypt ${key}:`, err)
                return null
            }
        }
    }

    // PERF001: 缓存结果（敏感数据不缓存）
    if (!isSensitive) {
        setCachedConfig(key, config.value)
    }

    return config.value
}

/**
 * 获取数字类型配置值
 */
export async function getSystemConfigNumber(key: string, defaultValue: number): Promise<number> {
    const value = await getSystemConfig(key)
    if (value === null) return defaultValue
    const num = parseInt(value, 10)
    return isNaN(num) ? defaultValue : num
}

/**
 * 获取浮点数类型配置值
 */
export async function getSystemConfigFloat(key: string, defaultValue: number): Promise<number> {
    const value = await getSystemConfig(key)
    if (value === null) return defaultValue
    const num = parseFloat(value)
    return Number.isFinite(num) ? num : defaultValue
}

/**
 * 获取配置值和更新时间，用于前端判断当前公告版本
 */
export async function getSystemConfigValueWithUpdatedAt(key: string): Promise<{ value: string | null; updatedAt: string | null }> {
    const config = await prisma.systemConfig.findUnique({
        where: { key },
        select: { value: true, updatedAt: true }
    })

    if (!config) {
        return { value: null, updatedAt: null }
    }

    return {
        value: config.value,
        updatedAt: config.updatedAt.toISOString()
    }
}

/**
 * 更新配置值
 * PERF001: 更新后清除缓存
 */
export async function updateSystemConfig(key: string, value: string): Promise<void> {
    await prisma.systemConfig.update({
        where: { key },
        data: { value }
    })
    // PERF001: 清除缓存
    invalidateCachedConfigs([key])
}

/**
 * 批量更新配置
 * PERF001: 更新后清除缓存
 */
export async function updateSystemConfigs(configs: Array<{ key: string; value: string }>): Promise<void> {
    // Import encryption functions
    const { encryptSensitiveData } = await import('../lib/security.js')

    const updates: Array<{ key: string; value: string }> = []

    for (const config of configs) {
        let finalValue = config.value

        if (SENSITIVE_CONFIG_KEYS.has(config.key) && config.value === MASKED_SECRET_PLACEHOLDER) {
            continue
        }

        if (SENSITIVE_CONFIG_KEYS.has(config.key) && config.value) {
            if (!config.value.includes(':')) {
                finalValue = encryptSensitiveData(config.value)
            }
        }

        updates.push({ key: config.key, value: finalValue })
    }

    if (updates.length > 0) {
        await prisma.$transaction(updates.map(config => prisma.systemConfig.update({
            where: { key: config.key },
            data: { value: config.value }
        })))
    }

    // PERF001: 清除所有缓存（批量更新可能影响多个配置）
    invalidateAllConfigCache()
}

/**
 * 获取默认用户配额配置（新配额系统）
 */
export async function getDefaultQuotaConfig(): Promise<DefaultQuotaConfig> {
    const [host, friend, packageLimit] = await Promise.all([
        getSystemConfigNumber('default_quota_host', DEFAULT_QUOTA_CONFIG.default_quota_host),
        getSystemConfigNumber('default_quota_friend', DEFAULT_QUOTA_CONFIG.default_quota_friend),
        getSystemConfigNumber('default_quota_package', DEFAULT_QUOTA_CONFIG.default_quota_package)
    ])

    return {
        hostLimit: host,
        friendLimit: friend,
        packageLimit: packageLimit
    }
}
