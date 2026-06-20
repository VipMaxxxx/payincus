/**
 * 邮箱域名白名单验证模块
 */

import { getSystemConfig, getSystemConfigBoolean } from '../db/system-config.js'

// 默认允许的邮箱域名列表
export const DEFAULT_ALLOWED_DOMAINS = [
    // Gmail
    'gmail.com',
    // Outlook/Microsoft
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    // iCloud/Apple
    'icloud.com',
    'me.com',
    'mac.com',
    // Yahoo
    'yahoo.com',
    // Zoho
    'zoho.com',
    // Proton
    'proton.me',
    'pm.me',
    'protonmail.com',
    'protonmail.ch',
    // Fastmail
    'fastmail.com',
    // Tuta (Tutanota)
    'tuta.com',
    'tutanota.com',
    'tuta.io',
    'keemail.me',
    // Posteo
    'posteo.de',
    'posteo.net',
    // Disroot
    'disroot.org',
    // Riseup
    'riseup.net'
]

/**
 * 检查邮箱域名白名单是否启用
 */
export async function isEmailDomainWhitelistEnabled(): Promise<boolean> {
    return getSystemConfigBoolean('email_domain_whitelist_enabled', false)
}

/**
 * 获取允许的邮箱域名列表
 */
export async function getAllowedEmailDomains(): Promise<string[]> {
    const domainsStr = await getSystemConfig('email_allowed_domains')
    if (!domainsStr) {
        return DEFAULT_ALLOWED_DOMAINS
    }

    // 解析逗号分隔的域名列表
    return domainsStr
        .split(',')
        .map(d => d.trim().toLowerCase())
        .filter(d => d.length > 0)
}

/**
 * 从邮箱地址提取域名
 */
export function extractEmailDomain(email: string): string | null {
    const atIndex = email.lastIndexOf('@')
    if (atIndex === -1 || atIndex === email.length - 1) {
        return null
    }
    return email.substring(atIndex + 1).toLowerCase()
}

/**
 * 验证邮箱域名是否在白名单中
 * @returns { valid: boolean, domain?: string, allowedDomains?: string[] }
 */
export async function validateEmailDomain(email: string): Promise<{
    valid: boolean
    domain?: string
    allowedDomains?: string[]
}> {
    // 检查是否启用白名单
    const whitelistEnabled = await isEmailDomainWhitelistEnabled()
    if (!whitelistEnabled) {
        return { valid: true }
    }

    // 提取域名
    const domain = extractEmailDomain(email)
    if (!domain) {
        return { valid: false, domain: undefined }
    }

    // 获取允许的域名列表
    const allowedDomains = await getAllowedEmailDomains()

    // 检查域名是否在白名单中
    const isAllowed = allowedDomains.includes(domain)

    return {
        valid: isAllowed,
        domain,
        allowedDomains: isAllowed ? undefined : allowedDomains
    }
}
