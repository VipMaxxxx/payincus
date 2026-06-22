/**
 * 使用 nodemailer 的邮件发送模块
 * 
 * 邮件模板设计原则：
 * 1. 统一的视觉风格（简洁、专业、品牌一致）
 * 2. 内联CSS样式（避免邮件客户端过滤）
 * 3. 同时提供 HTML 和纯文本版本（提高送达率）
 * 4. 响应式设计（跨设备兼容）
 * 5. 避免垃圾邮件过滤器触发词
 */

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import {
    getSystemConfig,
    getSystemConfigBoolean,
    getSystemConfigNumber
} from '../db/system-config.js'
import { decryptSensitiveData } from './security.js'

// SMTP 配置接口
export interface SmtpConfig {
    enabled: boolean
    host: string
    port: number
    secure: boolean
    username: string
    password: string
    fromEmail: string
    fromName: string
    brandName: string
    brandLogoUrl: string
}

// 缓存 transporter 实例
let transporterCache: Transporter | null = null
let configCacheTime: number = 0
const CONFIG_CACHE_TTL = 60000 // 缓存时间：1 分钟
const DEFAULT_BRAND_NAME = 'Incudal'
const DEFAULT_BRAND_LOGO_URL = '/incudal_logo.webp'

async function getMailBrandName(): Promise<string> {
    const configuredName = await getSystemConfig('brand_name')
    const brandName = configuredName?.trim()
    return brandName || DEFAULT_BRAND_NAME
}

async function getMailBrandLogoUrl(): Promise<string> {
    const configuredLogoUrl = await getSystemConfig('brand_logo_url')
    const logoUrl = configuredLogoUrl?.trim()
    return logoUrl || DEFAULT_BRAND_LOGO_URL
}

function formatBrandSubject(brandName: string, subject: string): string {
    return `[${brandName}] ${subject}`
}

async function getMailContext(): Promise<{ config: SmtpConfig; brandName: string; brandLogoUrl: string }> {
    const config = await getSmtpConfig()
    return { config, brandName: config.brandName, brandLogoUrl: config.brandLogoUrl }
}

/**
 * 从系统配置获取 SMTP 配置
 */
export async function getSmtpConfig(): Promise<SmtpConfig> {
    const [
        enabled,
        host,
        port,
        secure,
        username,
        password,
        fromEmail,
        fromName,
        brandName,
        brandLogoUrl
    ] = await Promise.all([
        getSystemConfigBoolean('smtp_enabled', false),
        getSystemConfig('smtp_host'),
        getSystemConfigNumber('smtp_port', 587),
        getSystemConfigBoolean('smtp_secure', false),
        getSystemConfig('smtp_username'),
        getSystemConfig('smtp_password'),
        getSystemConfig('smtp_from_email'),
        getSystemConfig('smtp_from_name'),
        getMailBrandName(),
        getMailBrandLogoUrl()
    ])

    const normalizedFromName = fromName?.trim()
    const effectiveFromName = !normalizedFromName || normalizedFromName === DEFAULT_BRAND_NAME
        ? brandName
        : normalizedFromName

    // 如果密码已加密，则解密
    let decryptedPassword = password || ''
    if (decryptedPassword && decryptedPassword.includes(':')) {
        // 格式: iv:tag:encrypted - 尝试解密
        const decrypted = decryptSensitiveData(decryptedPassword)
        if (decrypted) {
            decryptedPassword = decrypted
        }
    }

    return {
        enabled,
        host: host || '',
        port,
        secure,
        username: username || '',
        password: decryptedPassword,
        fromEmail: fromEmail || '',
        fromName: effectiveFromName,
        brandName,
        brandLogoUrl
    }
}

/**
 * 检查 SMTP 是否已配置并启用
 */
export async function isSmtpEnabled(): Promise<boolean> {
    const config = await getSmtpConfig()
    return config.enabled && !!config.host && !!config.username && !!config.password
}

/**
 * 获取或创建 nodemailer transporter
 */
async function getTransporter(): Promise<Transporter | null> {
    const now = Date.now()

    // 如果缓存可用且未过期，使用缓存的 transporter
    if (transporterCache && (now - configCacheTime) < CONFIG_CACHE_TTL) {
        return transporterCache
    }

    const config = await getSmtpConfig()

    if (!config.enabled || !config.host || !config.username || !config.password) {
        return null
    }

    transporterCache = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.username,
            pass: config.password
        },
        // 超时设置，防止请求卡住
        connectionTimeout: 10000, // 连接超时 10 秒
        greetingTimeout: 10000,   // 问候超时 10 秒
        socketTimeout: 30000      // Socket 超时 30 秒
    })

    configCacheTime = now
    return transporterCache
}

/**
 * 清除 transporter 缓存（当 SMTP 配置更改时调用）
 */
export function clearTransporterCache(): void {
    transporterCache = null
    configCacheTime = 0
}

// ============================================================================
// 邮件模板工具函数
// ============================================================================

/**
 * HTML 转义，防止 XSS
 */
function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }
    return text.replace(/[&<>"']/g, (m) => map[m])
}

/**
 * 获取当前年份
 */
function getCurrentYear(): number {
    return new Date().getFullYear()
}

/**
 * 格式化时间为中文格式
 */
function formatDateTime(date: Date): string {
    return date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    })
}

function formatDate(date: Date): string {
    return date.toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    })
}

/**
 * 邮件信息项类型
 */
interface EmailInfoItem {
    label: string
    value: string
}

/**
 * 邮件内容类型
 */
type EmailAlertType = 'warning' | 'info' | 'success' | 'danger'

/**
 * 生成统一的邮件 HTML 模板
 * 
 * 设计说明：
 * - 使用内联样式，确保所有邮件客户端兼容
 * - 避免使用 border-radius、box-shadow 等可能被过滤的属性
 * - 使用表格布局确保 Outlook 兼容性
 * - 品牌色彩：黑色 #000000，灰色 #737373，背景 #f5f5f5
 */
function generateEmailHtml(options: {
    title: string           // 邮件标题（显示在页面内）
    greeting?: string       // 问候语（如"您好，XXX"）
    alertType?: EmailAlertType  // 提示框类型
    alertTitle?: string     // 提示框标题
    alertMessage?: string   // 提示框内容
    paragraphs?: string[]   // 正文段落
    code?: string           // 验证码（大字体展示）
    codeExpiry?: string     // 验证码有效期描述
    infoItems?: EmailInfoItem[]  // 信息列表
    infoTitle?: string      // 信息列表标题
    footerNote?: string     // 底部备注
    actionTip?: string      // 行动提示（如"如果不是您本人操作..."）
    brandName?: string      // 品牌名称
    brandLogoUrl?: string   // 品牌 Logo 地址
}): string {
    const year = getCurrentYear()
    const brandName = options.brandName?.trim() || DEFAULT_BRAND_NAME
    const brandLogoUrl = options.brandLogoUrl?.trim() || ''
    const canEmbedLogo = /^https?:\/\//i.test(brandLogoUrl)
    const brandHeaderHtml = canEmbedLogo
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td style="vertical-align: middle; padding: 0 12px 0 0;">
                                        <img src="${escapeHtml(brandLogoUrl)}" width="32" height="32" alt="${escapeHtml(brandName)}" style="display: block; width: 32px; height: 32px; object-fit: contain; border: 0;">
                                    </td>
                                    <td style="vertical-align: middle;">
                                        <p style="margin: 0; font-size: 18px; font-weight: 600; color: #000000; letter-spacing: -0.02em;">${escapeHtml(brandName)}</p>
                                    </td>
                                </tr>
                            </table>`
        : `<p style="margin: 0; font-size: 18px; font-weight: 600; color: #000000; letter-spacing: -0.02em;">${escapeHtml(brandName)}</p>`
    
    // 提示框颜色配置
    const alertColors: Record<EmailAlertType, { bg: string; border: string; text: string }> = {
        warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
        info: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
        success: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
        danger: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' }
    }

    // 生成提示框 HTML
    let alertHtml = ''
    if (options.alertType && options.alertTitle) {
        const colors = alertColors[options.alertType]
        alertHtml = `
            <tr>
                <td style="padding: 0 0 24px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${colors.bg}; border-left: 4px solid ${colors.border};">
                        <tr>
                            <td style="padding: 16px 20px;">
                                <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: ${colors.text};">${escapeHtml(options.alertTitle)}</p>
                                ${options.alertMessage ? `<p style="margin: 0; font-size: 13px; color: ${colors.text}; line-height: 1.5;">${escapeHtml(options.alertMessage)}</p>` : ''}
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>`
    }

    // 生成问候语 HTML
    let greetingHtml = ''
    if (options.greeting) {
        greetingHtml = `
            <tr>
                <td style="padding: 0 0 16px 0;">
                    <p style="margin: 0; font-size: 14px; color: #000000; line-height: 1.6;">${escapeHtml(options.greeting)}</p>
                </td>
            </tr>`
    }

    // 生成正文段落 HTML
    let paragraphsHtml = ''
    if (options.paragraphs && options.paragraphs.length > 0) {
        paragraphsHtml = options.paragraphs.map(p => `
            <tr>
                <td style="padding: 0 0 16px 0;">
                    <p style="margin: 0; font-size: 14px; color: #000000; line-height: 1.6;">${escapeHtml(p)}</p>
                </td>
            </tr>`
        ).join('')
    }

    // 生成验证码框 HTML
    let codeHtml = ''
    if (options.code) {
        codeHtml = `
            <tr>
                <td style="padding: 8px 0 24px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f5f5; border: 1px solid #e5e5e5;">
                        <tr>
                            <td style="padding: 28px 24px; text-align: center;">
                                <p style="margin: 0; font-size: 32px; font-weight: 600; letter-spacing: 8px; color: #000000; font-family: 'Consolas', 'Monaco', monospace;">${escapeHtml(options.code)}</p>
                                ${options.codeExpiry ? `<p style="margin: 16px 0 0 0; font-size: 13px; color: #737373;">${escapeHtml(options.codeExpiry)}</p>` : ''}
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>`
    }

    // 生成信息列表 HTML
    let infoHtml = ''
    if (options.infoItems && options.infoItems.length > 0) {
        const rows = options.infoItems.map((item, index) => {
            const isLast = index === options.infoItems!.length - 1
            return `
                <tr>
                    <td style="padding: 12px 0; border-bottom: ${isLast ? 'none' : '1px solid #e5e5e5'};">
                        <table width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                                <td style="font-size: 13px; color: #737373; width: 120px; vertical-align: top;">${escapeHtml(item.label)}</td>
                                <td style="font-size: 13px; color: #000000; font-weight: 500;">${escapeHtml(item.value)}</td>
                            </tr>
                        </table>
                    </td>
                </tr>`
        }).join('')

        infoHtml = `
            <tr>
                <td style="padding: 8px 0 24px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f5f5; border: 1px solid #e5e5e5;">
                        <tr>
                            <td style="padding: 20px;">
                                ${options.infoTitle ? `<p style="margin: 0 0 16px 0; font-size: 13px; font-weight: 600; color: #000000;">${escapeHtml(options.infoTitle)}</p>` : ''}
                                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                    ${rows}
                                </table>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>`
    }

    // 生成行动提示 HTML
    let actionTipHtml = ''
    if (options.actionTip) {
        actionTipHtml = `
            <tr>
                <td style="padding: 16px 0 0 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fafafa; border: 1px solid #e5e5e5;">
                        <tr>
                            <td style="padding: 14px 16px;">
                                <p style="margin: 0; font-size: 12px; color: #737373; line-height: 1.5;">${escapeHtml(options.actionTip)}</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>`
    }

    return `<!DOCTYPE html>
<html lang="zh-CN" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
    <title>${escapeHtml(options.title)}</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style type="text/css">
        body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
        a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
        @media only screen and (max-width: 600px) {
            .email-container { width: 100% !important; }
            .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #ffffff;">
        <tr>
            <td align="center" style="padding: 0;">
                <table role="presentation" class="email-container" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%;">
                    <!-- Header -->
                    <tr>
                        <td class="mobile-padding" style="padding: 40px 24px 32px 24px; border-bottom: 1px solid #e5e5e5;">
                            ${brandHeaderHtml}
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td class="mobile-padding" style="padding: 32px 24px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                ${alertHtml}
                                ${greetingHtml}
                                ${paragraphsHtml}
                                ${codeHtml}
                                ${infoHtml}
                                ${actionTipHtml}
                            </table>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td class="mobile-padding" style="padding: 24px; border-top: 1px solid #e5e5e5;">
                            <p style="margin: 0; font-size: 12px; color: #a3a3a3; line-height: 1.5;">© ${year} ${escapeHtml(brandName)}. 此邮件由系统自动发送，请勿回复。</p>
                            ${options.footerNote ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #a3a3a3;">${escapeHtml(options.footerNote)}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`
}

/**
 * 生成纯文本邮件内容
 * 纯文本版本对于提高邮件送达率至关重要
 */
function generateEmailText(options: {
    title: string
    greeting?: string
    alertTitle?: string
    alertMessage?: string
    paragraphs?: string[]
    code?: string
    codeExpiry?: string
    infoItems?: EmailInfoItem[]
    infoTitle?: string
    actionTip?: string
    brandName?: string
    brandLogoUrl?: string
}): string {
    const year = getCurrentYear()
    const brandName = options.brandName?.trim() || DEFAULT_BRAND_NAME
    let lines: string[] = []
    
    lines.push(brandName)
    lines.push('='.repeat(50))
    lines.push('')
    
    if (options.alertTitle) {
        lines.push(`[${options.alertTitle}]`)
        if (options.alertMessage) {
            lines.push(options.alertMessage)
        }
        lines.push('')
    }
    
    if (options.greeting) {
        lines.push(options.greeting)
        lines.push('')
    }
    
    if (options.paragraphs) {
        options.paragraphs.forEach(p => {
            lines.push(p)
            lines.push('')
        })
    }
    
    if (options.code) {
        lines.push('-'.repeat(30))
        lines.push(`验证码: ${options.code}`)
        if (options.codeExpiry) {
            lines.push(options.codeExpiry)
        }
        lines.push('-'.repeat(30))
        lines.push('')
    }
    
    if (options.infoItems && options.infoItems.length > 0) {
        if (options.infoTitle) {
            lines.push(options.infoTitle)
        }
        lines.push('-'.repeat(30))
        options.infoItems.forEach(item => {
            lines.push(`${item.label}: ${item.value}`)
        })
        lines.push('-'.repeat(30))
        lines.push('')
    }
    
    if (options.actionTip) {
        lines.push(`注意: ${options.actionTip}`)
        lines.push('')
    }
    
    lines.push('='.repeat(50))
    lines.push(`(C) ${year} ${brandName}. 此邮件由系统自动发送，请勿回复。`)
    
    return lines.join('\n')
}

// ============================================================================
// 邮件发送函数
// ============================================================================

/**
 * 验证码邮件用途
 */
export type VerificationPurpose = 'register' | 'reset_password' | 'change_email'

/**
 * 发送验证码邮件
 * @param email 收件人邮箱
 * @param code 验证码
 * @param expiresInMinutes 过期时间（分钟）
 * @param purpose 用途：register（注册）、reset_password（重置密码）或 change_email（修改邮箱）
 */
export async function sendVerificationEmail(
    email: string,
    code: string,
    expiresInMinutes: number = 10,
    purpose: VerificationPurpose = 'register'
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        // 根据用途生成不同的邮件内容
        let title: string
        let paragraph: string
        let actionTip: string

        if (purpose === 'reset_password') {
            title = '重置密码验证码'
            paragraph = `您正在重置 ${brandName} 账户密码。请使用以下验证码完成操作：`
            actionTip = '如果您没有请求重置密码，请忽略此邮件。如果您持续收到此类邮件，您的账户可能存在安全风险，建议尽快修改密码。'
        } else if (purpose === 'change_email') {
            title = '修改邮箱验证码'
            paragraph = `您正在修改 ${brandName} 账户邮箱地址。请使用以下验证码完成新邮箱验证：`
            actionTip = '如果您没有请求修改邮箱，请忽略此邮件，并检查您的账户安全。'
        } else {
            title = '注册验证码'
            paragraph = `您正在注册 ${brandName} 账户。请使用以下验证码完成操作：`
            actionTip = '如果您没有请求此验证码，请忽略此邮件。如果您持续收到此类邮件，建议检查您的账户安全。'
        }

        const htmlContent = generateEmailHtml({
            title: title,
            greeting: '您好，',
            paragraphs: [paragraph],
            code: code,
            codeExpiry: `此验证码将在 ${expiresInMinutes} 分钟后失效`,
            actionTip: actionTip,
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: title,
            greeting: '您好，',
            paragraphs: [paragraph],
            code: code,
            codeExpiry: `此验证码将在 ${expiresInMinutes} 分钟后失效`,
            actionTip: purpose === 'reset_password' 
                ? '如果您没有请求重置密码，请忽略此邮件。' 
                : purpose === 'change_email'
                    ? '如果您没有请求修改邮箱，请忽略此邮件。'
                : '如果您没有请求此验证码，请忽略此邮件。',
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `您的验证码：${code}`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send verification email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 测试 SMTP 连接
 * 此函数允许在 smtp_enabled 为 false 时进行测试，
 * 只要提供了配置信息即可
 */
export async function testSmtpConnection(): Promise<{ success: boolean; error?: string }> {
    try {
        const config = await getSmtpConfig()

        // 检查必需字段是否已提供（即使未启用）
        if (!config.host || !config.username || !config.password || !config.fromEmail) {
            return { success: false, error: 'SMTP configuration incomplete. Please fill in host, username, password, and sender email.' }
        }

        // 创建临时 transporter 用于测试（忽略启用状态）
        const testTransporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
                user: config.username,
                pass: config.password
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 30000
        })

        await testTransporter.verify()
        return { success: true }
    } catch (error: any) {
        console.error('SMTP connection test failed:', error)
        return { success: false, error: error.message || 'Connection failed' }
    }
}

/**
 * 发送测试邮件
 * 此函数允许在 smtp_enabled 为 false 时发送测试邮件，
 * 只要提供了配置信息即可
 */
export async function sendTestEmail(to: string): Promise<{ success: boolean; error?: string }> {
    try {
        const { config, brandName, brandLogoUrl } = await getMailContext()

        // 检查必需字段是否已提供（即使未启用）
        if (!config.host || !config.username || !config.password || !config.fromEmail) {
            return { success: false, error: 'SMTP configuration incomplete. Please fill in host, username, password, and sender email.' }
        }

        // 验证邮箱格式
        if (!to || !to.includes('@')) {
            return { success: false, error: 'Invalid recipient email address' }
        }

        // 创建临时 transporter 用于测试（忽略启用状态）
        const testTransporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
                user: config.username,
                pass: config.password
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 30000
        })

        const testTime = formatDateTime(new Date())

        const htmlContent = generateEmailHtml({
            title: 'SMTP 测试邮件',
            alertType: 'success',
            alertTitle: 'SMTP 配置测试',
            alertMessage: '如果您收到此邮件，说明您的 SMTP 设置工作正常。',
            greeting: '您好，',
            paragraphs: [`这是一封来自您的 ${brandName} SMTP 配置的测试邮件。`],
            infoTitle: '测试详情',
            infoItems: [
                { label: 'SMTP 服务器', value: config.host },
                { label: '端口', value: String(config.port) },
                { label: 'SSL/TLS', value: config.secure ? '已启用' : '未启用' },
                { label: '发件人', value: `${config.fromName} <${config.fromEmail}>` },
                { label: '测试时间', value: testTime }
            ],
            footerNote: '这是一封自动测试邮件。',
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: 'SMTP 测试邮件',
            alertTitle: 'SMTP 配置测试',
            alertMessage: '如果您收到此邮件，说明您的 SMTP 设置工作正常。',
            greeting: '您好，',
            paragraphs: [`这是一封来自您的 ${brandName} SMTP 配置的测试邮件。`],
            infoTitle: '测试详情',
            infoItems: [
                { label: 'SMTP 服务器', value: config.host },
                { label: '端口', value: String(config.port) },
                { label: 'SSL/TLS', value: config.secure ? '已启用' : '未启用' },
                { label: '发件人', value: `${config.fromName} <${config.fromEmail}>` },
                { label: '测试时间', value: testTime }
            ],
            brandName,
        brandLogoUrl
        })

        await testTransporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: to,
            subject: formatBrandSubject(brandName, 'SMTP 配置测试成功'),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send test email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送异地登录提醒邮件
 */
export async function sendLoginAlertEmail(
    email: string,
    data: {
        username: string
        ip: string
        userAgent: string
        loginTime: Date
        isNewIp: boolean
        isNewDevice: boolean
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        const loginTimeStr = formatDateTime(data.loginTime)
        
        // 截断过长的 UserAgent
        const truncatedUserAgent = data.userAgent.length > 80 
            ? data.userAgent.substring(0, 80) + '...' 
            : data.userAgent

        // 确定提醒类型
        let alertType = '新设备登录'
        let alertMessage = '您的账户刚刚在一个新的设备上登录。'
        if (data.isNewIp && data.isNewDevice) {
            alertType = '新设备和新 IP 地址登录'
            alertMessage = '您的账户刚刚在一个新的位置和新的设备上登录。'
        } else if (data.isNewIp) {
            alertType = '新 IP 地址登录'
            alertMessage = '您的账户刚刚在一个新的 IP 地址登录。'
        }

        const htmlContent = generateEmailHtml({
            title: '安全提醒',
            alertType: 'warning',
            alertTitle: alertType,
            alertMessage: alertMessage,
            greeting: `您好，${data.username}`,
            paragraphs: ['我们检测到您的账户有一次新的登录活动：'],
            infoTitle: '登录详情',
            infoItems: [
                { label: '登录时间', value: loginTimeStr },
                { label: 'IP 地址', value: data.ip },
                { label: '设备', value: truncatedUserAgent }
            ],
            actionTip: '如果这是您本人的操作，请忽略此邮件。如果这不是您本人的操作，请立即登录您的账户并修改密码。',
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '安全提醒',
            alertTitle: alertType,
            alertMessage: alertMessage,
            greeting: `您好，${data.username}`,
            paragraphs: ['我们检测到您的账户有一次新的登录活动：'],
            infoTitle: '登录详情',
            infoItems: [
                { label: '登录时间', value: loginTimeStr },
                { label: 'IP 地址', value: data.ip },
                { label: '设备', value: truncatedUserAgent }
            ],
            actionTip: '如果这不是您本人的操作，请立即修改密码。',
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `安全提醒：${alertType}`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send login alert email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送敏感操作验证码邮件
 */
export async function sendOperationVerificationEmail(
    email: string,
    data: {
        username: string
        operationName: string
        code: string
        expiresInMinutes: number
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        const htmlContent = generateEmailHtml({
            title: '操作验证码',
            alertType: 'warning',
            alertTitle: '敏感操作验证',
            alertMessage: `您正在尝试执行「${data.operationName}」操作。`,
            greeting: `您好，${data.username}`,
            paragraphs: ['请使用以下验证码完成操作确认：'],
            code: data.code,
            codeExpiry: `此验证码将在 ${data.expiresInMinutes} 分钟后失效`,
            actionTip: '如果这不是您本人的操作，请立即修改您的账户密码并检查账户安全。请勿将此验证码透露给任何人。',
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '操作验证码',
            alertTitle: '敏感操作验证',
            alertMessage: `您正在尝试执行「${data.operationName}」操作。`,
            greeting: `您好，${data.username}`,
            paragraphs: ['请使用以下验证码完成操作确认：'],
            code: data.code,
            codeExpiry: `此验证码将在 ${data.expiresInMinutes} 分钟后失效`,
            actionTip: '如果这不是您本人的操作，请立即修改密码。',
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `操作验证码：${data.code}`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send operation verification email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送充值成功通知邮件
 */
export async function sendRechargeSuccessEmail(
    email: string,
    data: {
        username: string
        amount: number
        orderNo: string
        tradeNo: string | null
        newBalance: number
        time: Date
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()
        const timeStr = formatDateTime(data.time)

        const htmlContent = generateEmailHtml({
            title: '充值成功通知',
            alertType: 'success',
            alertTitle: '充值已到账',
            alertMessage: `您的账户已成功充值 ¥${data.amount.toFixed(2)}`,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的充值已成功到账，以下是充值详情：'],
            infoTitle: '充值详情',
            infoItems: [
                { label: '充值金额', value: `¥${data.amount.toFixed(2)}` },
                { label: '订单号', value: data.orderNo },
                { label: '交易号', value: data.tradeNo || 'N/A' },
                { label: '到账时间', value: timeStr },
                { label: '当前余额', value: `¥${data.newBalance.toFixed(2)}` }
            ],
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '充值成功通知',
            alertTitle: '充值已到账',
            alertMessage: `您的账户已成功充值 ¥${data.amount.toFixed(2)}`,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的充值已成功到账，以下是充值详情：'],
            infoTitle: '充值详情',
            infoItems: [
                { label: '充值金额', value: `¥${data.amount.toFixed(2)}` },
                { label: '订单号', value: data.orderNo },
                { label: '交易号', value: data.tradeNo || 'N/A' },
                { label: '到账时间', value: timeStr },
                { label: '当前余额', value: `¥${data.newBalance.toFixed(2)}` }
            ],
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `充值成功 ¥${data.amount.toFixed(2)}`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send recharge success email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送实例创建成功通知邮件
 */
export async function sendInstanceCreatedEmail(
    email: string,
    data: {
        username: string
        instanceName: string
        hostName: string
        image: string
        cpu: number
        memory: number
        disk: number
        ipv4?: string
        ipv6?: string
        isPaid: boolean
        planName?: string
        amount?: number
        expiresAt?: Date
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        // 格式化资源
        const formatMemory = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
        const formatDisk = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`

        const infoItems: EmailInfoItem[] = [
            { label: '实例名称', value: data.instanceName },
            { label: '节点', value: data.hostName },
            { label: '镜像', value: data.image },
            { label: 'CPU', value: `${data.cpu}%` },
            { label: '内存', value: formatMemory(data.memory) },
            { label: '磁盘', value: formatDisk(data.disk) }
        ]

        if (data.ipv4) infoItems.push({ label: 'IPv4', value: data.ipv4 })
        if (data.ipv6) infoItems.push({ label: 'IPv6', value: data.ipv6 })

        if (data.isPaid && data.planName) {
            infoItems.push({ label: '方案', value: data.planName })
            if (data.amount !== undefined) {
                infoItems.push({ label: '扣费', value: `¥${data.amount.toFixed(2)}` })
            }
            if (data.expiresAt) {
                infoItems.push({ label: '到期时间', value: formatDate(data.expiresAt) })
            }
        }

        const alertMessage = data.isPaid
            ? `您的付费实例「${data.instanceName}」已创建成功`
            : `您的实例「${data.instanceName}」已创建成功`

        const htmlContent = generateEmailHtml({
            title: '实例创建成功',
            alertType: 'success',
            alertTitle: '实例已创建',
            alertMessage,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的实例已创建成功并正在启动，以下是实例详情：'],
            infoTitle: '实例详情',
            infoItems,
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '实例创建成功',
            alertTitle: '实例已创建',
            alertMessage,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的实例已创建成功并正在启动，以下是实例详情：'],
            infoTitle: '实例详情',
            infoItems,
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `实例「${data.instanceName}」创建成功`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send instance created email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送续费成功通知邮件
 */
export async function sendRenewSuccessEmail(
    email: string,
    data: {
        username: string
        instanceName: string
        amount: number
        months: number
        newExpiresAt: Date
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        const htmlContent = generateEmailHtml({
            title: '续费成功通知',
            alertType: 'success',
            alertTitle: '续费成功',
            alertMessage: `实例「${data.instanceName}」已成功续费 ${data.months} 个月`,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的实例续费已成功，以下是续费详情：'],
            infoTitle: '续费详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '续费时长', value: `${data.months} 个月` },
                { label: '续费金额', value: `¥${data.amount.toFixed(2)}` },
                { label: '新到期时间', value: formatDate(data.newExpiresAt) }
            ],
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '续费成功通知',
            alertTitle: '续费成功',
            alertMessage: `实例「${data.instanceName}」已成功续费 ${data.months} 个月`,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的实例续费已成功，以下是续费详情：'],
            infoTitle: '续费详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '续费时长', value: `${data.months} 个月` },
                { label: '续费金额', value: `¥${data.amount.toFixed(2)}` },
                { label: '新到期时间', value: formatDate(data.newExpiresAt) }
            ],
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `实例「${data.instanceName}」续费成功`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send renew success email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送管理员调整余额通知邮件
 */
export async function sendBalanceAdjustedEmail(
    email: string,
    data: {
        username: string
        amount: number
        remark: string
        newBalance: number
        time: Date
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()
        const timeStr = formatDateTime(data.time)
        const isIncrease = data.amount > 0
        const amountStr = isIncrease ? `+¥${data.amount.toFixed(2)}` : `-¥${Math.abs(data.amount).toFixed(2)}`

        const htmlContent = generateEmailHtml({
            title: '余额变动通知',
            alertType: isIncrease ? 'success' : 'warning',
            alertTitle: isIncrease ? '余额增加' : '余额扣除',
            alertMessage: `管理员已${isIncrease ? '增加' : '扣除'}您的账户余额 ${amountStr}`,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的账户余额已被管理员调整，以下是变动详情：'],
            infoTitle: '变动详情',
            infoItems: [
                { label: '变动金额', value: amountStr },
                { label: '变动原因', value: data.remark },
                { label: '变动时间', value: timeStr },
                { label: '当前余额', value: `¥${data.newBalance.toFixed(2)}` }
            ],
            actionTip: '如对此次余额变动有疑问，请联系管理员。',
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '余额变动通知',
            alertTitle: isIncrease ? '余额增加' : '余额扣除',
            alertMessage: `管理员已${isIncrease ? '增加' : '扣除'}您的账户余额 ${amountStr}`,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的账户余额已被管理员调整，以下是变动详情：'],
            infoTitle: '变动详情',
            infoItems: [
                { label: '变动金额', value: amountStr },
                { label: '变动原因', value: data.remark },
                { label: '变动时间', value: timeStr },
                { label: '当前余额', value: `¥${data.newBalance.toFixed(2)}` }
            ],
            actionTip: '如对此次余额变动有疑问，请联系管理员。',
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `余额变动通知 ${amountStr}`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send balance adjusted email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送白嫖站注册赠送通知邮件
 */
export async function sendFreeSiteRegisterGiftEmail(
    email: string,
    data: {
        username: string
        balanceAmount: number
        pointsAmount: number
        newBalance: number
        newPoints: number
        time: Date
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()
        const timeStr = formatDateTime(data.time)
        const giftItems: string[] = []
        if (data.balanceAmount > 0) {
            giftItems.push(`余额 +¥${data.balanceAmount.toFixed(2)}`)
        }
        if (data.pointsAmount > 0) {
            giftItems.push(`积分 +${data.pointsAmount}`)
        }
        const giftSummary = giftItems.join('，') || '白嫖券一张'

        const htmlContent = generateEmailHtml({
            title: '白嫖补给到账',
            alertType: 'success',
            alertTitle: '恭喜，白嫖小车已发车',
            alertMessage: `${giftSummary} 已经咣当一声掉进您的账户。`,
            greeting: `您好，${data.username}`,
            paragraphs: [
                '欢迎加入白嫖站！系统刚刚给您的新手背包塞了点启动资金和快乐积分。',
                '不用充值，不用许愿，到账就是这么朴实无华。'
            ],
            infoTitle: '到账详情',
            infoItems: [
                { label: '到账余额', value: data.balanceAmount > 0 ? `+¥${data.balanceAmount.toFixed(2)}` : '本次没有余额小红包' },
                { label: '到账积分', value: data.pointsAmount > 0 ? `+${data.pointsAmount}` : '本次没有积分薯条' },
                { label: '当前余额', value: `¥${data.newBalance.toFixed(2)}` },
                { label: '当前积分', value: `${data.newPoints}` },
                { label: '到账时间', value: timeStr }
            ],
            actionTip: '快去逛逛能兑换什么，白嫖虽好，也要记得优雅使用。',
            brandName,
            brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '白嫖补给到账',
            alertTitle: '恭喜，白嫖小车已发车',
            alertMessage: `${giftSummary} 已经咣当一声掉进您的账户。`,
            greeting: `您好，${data.username}`,
            paragraphs: [
                '欢迎加入白嫖站！系统刚刚给您的新手背包塞了点启动资金和快乐积分。',
                '不用充值，不用许愿，到账就是这么朴实无华。'
            ],
            infoTitle: '到账详情',
            infoItems: [
                { label: '到账余额', value: data.balanceAmount > 0 ? `+¥${data.balanceAmount.toFixed(2)}` : '本次没有余额小红包' },
                { label: '到账积分', value: data.pointsAmount > 0 ? `+${data.pointsAmount}` : '本次没有积分薯条' },
                { label: '当前余额', value: `¥${data.newBalance.toFixed(2)}` },
                { label: '当前积分', value: `${data.newPoints}` },
                { label: '到账时间', value: timeStr }
            ],
            actionTip: '快去逛逛能兑换什么，白嫖虽好，也要记得优雅使用。',
            brandName,
            brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `白嫖补给到账 ${giftSummary}`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send free site register gift email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送管理员创建实例通知邮件
 */
export async function sendAdminInstanceCreatedEmail(
    email: string,
    data: {
        username: string
        instanceName: string
        packageName: string
        planName?: string
        hostName: string
        cpu: number
        memory: number
        disk: number
        isPaid: boolean
        charged: boolean
        amount?: number
        expiresAt?: Date
        giftDays?: number
        creatorType?: 'admin' | 'host_owner'
        creatorName?: string
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        // 格式化资源
        const formatMemory = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
        const formatDisk = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`

        const infoItems: EmailInfoItem[] = [
            { label: '实例名称', value: data.instanceName },
            { label: '套餐', value: data.packageName },
            { label: '节点', value: data.hostName },
            { label: 'CPU', value: `${data.cpu}%` },
            { label: '内存', value: formatMemory(data.memory) },
            { label: '磁盘', value: formatDisk(data.disk) }
        ]

        if (data.isPaid && data.planName) {
            infoItems.push({ label: '方案', value: data.planName })
            if (data.charged && data.amount !== undefined) {
                infoItems.push({ label: '扣费', value: `¥${data.amount.toFixed(2)}` })
            } else if (!data.charged) {
                infoItems.push({
                    label: '费用',
                    value: data.giftDays && data.giftDays > 0
                        ? `免费赠送 ${data.giftDays} 天`
                        : '首月免费赠送'
                })
            }
            if (data.expiresAt) {
                infoItems.push({ label: '到期时间', value: formatDate(data.expiresAt) })
            }
        }

        let alertTitle: string
        let alertMessage: string
        const creatorLabel = data.creatorType === 'host_owner' ? '节点所有者' : '管理员'
        const creatorWithName = data.creatorName ? `${creatorLabel} ${data.creatorName}` : creatorLabel

        if (data.isPaid) {
            alertTitle = data.charged ? `${creatorLabel}为您开通了付费实例` : `收到${creatorLabel}赠送的付费实例`
            alertMessage = data.charged
                ? `付费实例「${data.instanceName}」已开通，已扣除费用 ¥${data.amount?.toFixed(2)}`
                : data.giftDays && data.giftDays > 0
                    ? `${creatorLabel}赠送的付费实例「${data.instanceName}」已开通，免费时长 ${data.giftDays} 天`
                    : `${creatorLabel}赠送的付费实例「${data.instanceName}」已开通，首月免费`
        } else {
            alertTitle = `收到${creatorLabel}赠送的实例`
            alertMessage = `实例「${data.instanceName}」已创建成功`
        }

        const htmlContent = generateEmailHtml({
            title: alertTitle,
            alertType: 'success',
            alertTitle,
            alertMessage,
            greeting: `您好，${data.username}`,
            paragraphs: [`${creatorWithName}为您创建了一台新实例，以下是实例详情：`],
            infoTitle: '实例详情',
            infoItems,
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: alertTitle,
            alertTitle,
            alertMessage,
            greeting: `您好，${data.username}`,
            paragraphs: [`${creatorWithName}为您创建了一台新实例，以下是实例详情：`],
            infoTitle: '实例详情',
            infoItems,
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, alertTitle),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send admin instance created email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送账户封禁通知邮件
 */
export async function sendBanNotificationEmail(
    email: string,
    data: {
        username: string
        reason: string
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        const htmlContent = generateEmailHtml({
            title: '账户已被禁用',
            alertType: 'danger',
            alertTitle: '账户已被禁用',
            alertMessage: '您的账户已被管理员禁用。',
            greeting: `您好，${data.username}`,
            paragraphs: [
                `您的 ${brandName} 账户已被管理员禁用，您将无法登录或使用该账户。`,
                '',
                `封禁原因：${data.reason}`
            ],
            actionTip: '如有疑问，请联系管理员。',
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '账户已被禁用',
            alertTitle: '账户已被禁用',
            alertMessage: '您的账户已被管理员禁用。',
            greeting: `您好，${data.username}`,
            paragraphs: [
                `您的 ${brandName} 账户已被管理员禁用，您将无法登录或使用该账户。`,
                '',
                `封禁原因：${data.reason}`
            ],
            actionTip: '如有疑问，请联系管理员。',
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, '账户已被禁用'),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send ban notification email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送宿主机通知邮件
 */
export async function sendHostAnnouncementEmail(
    email: string,
    data: {
        username: string
        hostName: string
        title: string
        content: string
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()
        const normalizedContent = data.content.replace(/\r\n/g, '\n').trim()
        const paragraphs = normalizedContent.split('\n')

        const htmlContent = generateEmailHtml({
            title: '宿主机通知',
            alertType: 'info',
            alertTitle: data.title,
            alertMessage: `您收到了来自节点「${data.hostName}」的一条通知。`,
            greeting: `您好，${data.username}`,
            paragraphs,
            infoTitle: '通知信息',
            infoItems: [
                { label: '节点', value: data.hostName },
                { label: '标题', value: data.title }
            ],
            actionTip: '如需处理该通知，请登录面板查看相关实例。',
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '宿主机通知',
            alertTitle: data.title,
            alertMessage: `您收到了来自节点「${data.hostName}」的一条通知。`,
            greeting: `您好，${data.username}`,
            paragraphs,
            infoTitle: '通知信息',
            infoItems: [
                { label: '节点', value: data.hostName },
                { label: '标题', value: data.title }
            ],
            actionTip: '如需处理该通知，请登录面板查看相关实例。',
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `节点通知：${data.title}`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send host announcement email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送实例到期提醒邮件
 */
export async function sendExpiryReminderEmail(
    email: string,
    data: {
        username: string
        instanceName: string
        daysRemaining: number
        expiresAt: Date
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        const expiresAtStr = formatDate(data.expiresAt)
        const alertType = data.daysRemaining <= 1 ? 'danger' : 'warning'
        const urgencyText = data.daysRemaining <= 1 
            ? '紧急！您的实例即将到期' 
            : `您的实例将在 ${data.daysRemaining} 天后到期`

        const htmlContent = generateEmailHtml({
            title: '实例到期提醒',
            alertType: alertType,
            alertTitle: urgencyText,
            alertMessage: `实例「${data.instanceName}」将于 ${expiresAtStr} 到期`,
            greeting: `您好，${data.username}`,
            paragraphs: [
                '为避免实例被封停，请及时续费。',
                '',
                '实例到期后将被封停，封停 3 天后将被永久删除，数据无法恢复。'
            ],
            infoTitle: '实例详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '到期时间', value: expiresAtStr },
                { label: '剩余天数', value: `${data.daysRemaining} 天` }
            ],
            actionTip: `请登录 ${brandName} 控制面板进行续费操作。`,
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '实例到期提醒',
            alertTitle: urgencyText,
            alertMessage: `实例「${data.instanceName}」将于 ${expiresAtStr} 到期`,
            greeting: `您好，${data.username}`,
            paragraphs: [
                '为避免实例被封停，请及时续费。',
                '',
                '实例到期后将被封停，封停 3 天后将被永久删除，数据无法恢复。'
            ],
            infoTitle: '实例详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '到期时间', value: expiresAtStr },
                { label: '剩余天数', value: `${data.daysRemaining} 天` }
            ],
            actionTip: `请登录 ${brandName} 控制面板进行续费操作。`,
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `实例「${data.instanceName}」将在 ${data.daysRemaining} 天后到期`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send expiry reminder email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送自动续费成功邮件
 */
export async function sendAutoRenewSuccessEmail(
    email: string,
    data: {
        username: string
        instanceName: string
        amount: number
        months: number
        newExpiresAt: Date
        newBalance: number
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        const newExpiresAtStr = formatDate(data.newExpiresAt)

        const htmlContent = generateEmailHtml({
            title: '自动续费成功',
            alertType: 'success',
            alertTitle: '自动续费成功',
            alertMessage: `实例「${data.instanceName}」已自动续费 ${data.months} 个月`,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的实例已自动续费成功，以下是续费详情：'],
            infoTitle: '续费详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '续费时长', value: `${data.months} 个月` },
                { label: '扣费金额', value: `￥${data.amount.toFixed(2)}` },
                { label: '新到期时间', value: newExpiresAtStr },
                { label: '剩余余额', value: `￥${data.newBalance.toFixed(2)}` }
            ],
            footerNote: '此邮件为自动续费通知，如有疑问请登录控制面板查看。',
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '自动续费成功',
            alertTitle: '自动续费成功',
            alertMessage: `实例「${data.instanceName}」已自动续费 ${data.months} 个月`,
            greeting: `您好，${data.username}`,
            paragraphs: ['您的实例已自动续费成功，以下是续费详情：'],
            infoTitle: '续费详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '续费时长', value: `${data.months} 个月` },
                { label: '扣费金额', value: `￥${data.amount.toFixed(2)}` },
                { label: '新到期时间', value: newExpiresAtStr },
                { label: '剩余余额', value: `￥${data.newBalance.toFixed(2)}` }
            ],
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `自动续费成功：实例「${data.instanceName}」`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send auto-renew success email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送自动续费失败邮件
 */
export async function sendAutoRenewFailedEmail(
    email: string,
    data: {
        username: string
        instanceName: string
        failReason: string
        currentAttempt: number
        maxAttempts: number
        expiresAt: Date
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        const expiresAtStr = formatDate(data.expiresAt)
        const remainingAttempts = data.maxAttempts - data.currentAttempt
        const isLastAttempt = remainingAttempts <= 0

        const alertType = isLastAttempt ? 'danger' : 'warning'
        const alertTitle = isLastAttempt 
            ? '自动续费已失败（无剩余尝试次数）' 
            : `自动续费失败（第 ${data.currentAttempt} 次尝试）`

        const attemptsInfo = isLastAttempt
            ? '已达到最大尝试次数，自动续费已关闭。请手动续费以避免实例被封停。'
            : `还剩 ${remainingAttempts} 次尝试机会，系统将在稍后自动重试。建议您尽快充值或手动续费。`

        const htmlContent = generateEmailHtml({
            title: '自动续费失败',
            alertType: alertType,
            alertTitle: alertTitle,
            alertMessage: `实例「${data.instanceName}」自动续费失败`,
            greeting: `您好，${data.username}`,
            paragraphs: [
                '您的实例自动续费失败，请查看详情：',
                '',
                attemptsInfo
            ],
            infoTitle: '失败详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '失败原因', value: data.failReason },
                { label: '当前尝试', value: `第 ${data.currentAttempt} 次 / 共 ${data.maxAttempts} 次` },
                { label: '到期时间', value: expiresAtStr }
            ],
            actionTip: `请尽快登录 ${brandName} 控制面板进行手动续费，避免实例到期后被封停。`,
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '自动续费失败',
            alertTitle: alertTitle,
            alertMessage: `实例「${data.instanceName}」自动续费失败`,
            greeting: `您好，${data.username}`,
            paragraphs: [
                '您的实例自动续费失败，请查看详情：',
                '',
                attemptsInfo
            ],
            infoTitle: '失败详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '失败原因', value: data.failReason },
                { label: '当前尝试', value: `第 ${data.currentAttempt} 次 / 共 ${data.maxAttempts} 次` },
                { label: '到期时间', value: expiresAtStr }
            ],
            actionTip: `请尽快登录 ${brandName} 控制面板进行手动续费。`,
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `自动续费失败：实例「${data.instanceName}」`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send auto-renew failed email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送实例续费价格变更提醒邮件
 */
export async function sendRenewalPriceUpdatedEmail(
    email: string,
    data: {
        username: string
        instanceName: string
        hostName: string
        oldPrice: number
        newPrice: number
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        const htmlContent = generateEmailHtml({
            title: '实例续费价格调整通知',
            alertType: 'info',
            alertTitle: '实例续费价格已调整',
            alertMessage: `实例「${data.instanceName}」的后续续费价格已更新`,
            greeting: `您好，${data.username}`,
            paragraphs: [
                '该价格将在您下一次续费时生效，当前计费周期不受影响。'
            ],
            infoTitle: '价格变更详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '节点', value: data.hostName },
                { label: '原价格', value: `¥${data.oldPrice.toFixed(2)}/月` },
                { label: '新价格', value: `¥${data.newPrice.toFixed(2)}/月` }
            ],
            actionTip: `如有疑问，请登录 ${brandName} 控制面板查看实例计费信息。`,
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title: '实例续费价格调整通知',
            alertTitle: '实例续费价格已调整',
            alertMessage: `实例「${data.instanceName}」的后续续费价格已更新`,
            greeting: `您好，${data.username}`,
            paragraphs: [
                '该价格将在您下一次续费时生效，当前计费周期不受影响。'
            ],
            infoTitle: '价格变更详情',
            infoItems: [
                { label: '实例名称', value: data.instanceName },
                { label: '节点', value: data.hostName },
                { label: '原价格', value: `¥${data.oldPrice.toFixed(2)}/月` },
                { label: '新价格', value: `¥${data.newPrice.toFixed(2)}/月` }
            ],
            actionTip: `如有疑问，请登录 ${brandName} 控制面板查看实例计费信息。`,
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `实例续费价格已调整：${data.instanceName}`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send renewal price updated email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}

/**
 * 发送实例销毁退款提醒邮件
 */
export async function sendInstanceDestroyRefundEmail(
    email: string,
    data: {
        username: string
        instanceName: string
        refundAmount: number
        feeAmount?: number
        refundType?: string
        reason?: string
        isUserDestroy: boolean
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const transporter = await getTransporter()

        if (!transporter) {
            return { success: false, error: 'SMTP not configured' }
        }

        const { config, brandName, brandLogoUrl } = await getMailContext()

        const title = data.isUserDestroy ? '实例销毁退款通知' : '实例删除退款通知'
        const alertMessage = data.isUserDestroy
            ? `实例「${data.instanceName}」已销毁，退款结果已生成`
            : `实例「${data.instanceName}」已被删除，退款结果已生成`

        const paragraphs = data.isUserDestroy
            ? ['您的实例销毁操作已完成，以下是退款处理结果。']
            : ['管理员已删除您的实例，以下是退款处理结果。']

        const infoItems: EmailInfoItem[] = [
            { label: '实例名称', value: data.instanceName },
            { label: '退款金额', value: `¥${data.refundAmount.toFixed(2)}` }
        ]

        if (data.feeAmount !== undefined) {
            infoItems.push({ label: '手续费', value: `¥${data.feeAmount.toFixed(2)}` })
        }
        if (data.refundType) {
            infoItems.push({ label: '退款方式', value: data.refundType })
        }
        if (data.reason) {
            infoItems.push({ label: '说明', value: data.reason })
        }

        const htmlContent = generateEmailHtml({
            title,
            alertType: 'success',
            alertTitle: '退款已处理',
            alertMessage,
            greeting: `您好，${data.username}`,
            paragraphs,
            infoTitle: '退款详情',
            infoItems,
            actionTip: '退款金额已发放至您的账户余额，请登录控制面板查看。',
            brandName,
        brandLogoUrl
        })

        const textContent = generateEmailText({
            title,
            alertTitle: '退款已处理',
            alertMessage,
            greeting: `您好，${data.username}`,
            paragraphs,
            infoTitle: '退款详情',
            infoItems,
            actionTip: '退款金额已发放至您的账户余额，请登录控制面板查看。',
            brandName,
        brandLogoUrl
        })

        await transporter.sendMail({
            from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
            to: email,
            subject: formatBrandSubject(brandName, `${title}：${data.instanceName}`),
            text: textContent,
            html: htmlContent
        })

        return { success: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('Failed to send instance destroy refund email:', errorMessage)
        return { success: false, error: errorMessage }
    }
}
