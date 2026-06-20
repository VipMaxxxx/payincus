/**
 * 输入验证工具
 * 用于前端表单验证，防止危险字符输入
 */
import i18n from '@/locales'

type TranslateParams = Record<string, string | number>

function t(key: string, params?: TranslateParams): string {
    const translate = i18n.global.t as (key: string, params?: TranslateParams) => string
    return translate(key, params)
}

function validationField(key: string): string {
    return t(`validation.fields.${key}`)
}

function validationMessage(key: string, fieldName: string, params?: TranslateParams): string {
    return t(`validation.${key}`, { field: fieldName, ...(params || {}) })
}

/**
 * 危险字符正则表达式
 * 禁止: ' " \ / ? ] [ = + . < > ` ; : | ! @ # $ % ^ & * { } ~
 * 允许: ( ) 空格 , 
 */
const DANGEROUS_CHARS_REGEX = /['"\\/?[\]=+.<>`;:|!@#$%^&*{}~]/g

/**
 * 安全名称正则（只允许字母、数字、连字符、下划线、空格、逗号、圆括号和中文）
 */
const SAFE_NAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9\-_ ,()]+$/

/**
 * 严格名称正则（只允许字母、数字、连字符、下划线，必须以字母开头）
 */
const STRICT_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9\-_]*$/

/**
 * 验证结果接口
 */
export interface ValidationResult {
    valid: boolean
    message?: string
    sanitized?: string
}

/**
 * 危险字符列表（用于显示提示）
 */
export const DANGEROUS_CHARS_DISPLAY = `' " \\ / ? [ ] = + . < > \` ; : | ! @ # $ % ^ & * { } ~`

/**
 * 检查字符串是否包含危险字符
 */
export function containsDangerousChars(input: string): boolean {
    return DANGEROUS_CHARS_REGEX.test(input)
}

/**
 * 移除危险字符
 */
export function removeDangerousChars(input: string): string {
    return input.replace(DANGEROUS_CHARS_REGEX, '')
}

/**
 * 验证通用名称输入（允许中文、字母、数字、连字符、下划线、空格）
 * 适用于：实例名称、套餐名称、节点组名称等用户可见的名称
 */
export function validateName(
    name: string,
    fieldName: string = validationField('name'),
    minLength: number = 1,
    maxLength: number = 64
): ValidationResult {
    if (!name || typeof name !== 'string') {
        return { valid: false, message: validationMessage('required', fieldName) }
    }

    const trimmed = name.trim()

    if (trimmed.length < minLength) {
        return { valid: false, message: validationMessage('minLength', fieldName, { min: minLength }) }
    }

    if (trimmed.length > maxLength) {
        return { valid: false, message: validationMessage('maxLength', fieldName, { max: maxLength }) }
    }

    if (containsDangerousChars(trimmed)) {
        return { valid: false, message: validationMessage('illegalChars', fieldName) }
    }

    if (!SAFE_NAME_REGEX.test(trimmed)) {
        return { valid: false, message: validationMessage('safeNameChars', fieldName) }
    }

    return { valid: true, sanitized: trimmed }
}

/**
 * 验证技术标识符（只允许字母、数字、连字符、下划线，必须以字母或数字开头）
 * 适用于：用户名、实例技术ID、主机名等
 */
export function validateIdentifier(
    input: string,
    fieldName: string = validationField('identifier'),
    minLength: number = 2,
    maxLength: number = 64
): ValidationResult {
    if (!input || typeof input !== 'string') {
        return { valid: false, message: validationMessage('required', fieldName) }
    }

    const trimmed = input.trim()

    if (trimmed.length < minLength) {
        return { valid: false, message: validationMessage('minLength', fieldName, { min: minLength }) }
    }

    if (trimmed.length > maxLength) {
        return { valid: false, message: validationMessage('maxLength', fieldName, { max: maxLength }) }
    }

    if (!STRICT_NAME_REGEX.test(trimmed)) {
        return { valid: false, message: validationMessage('identifierChars', fieldName) }
    }

    return { valid: true, sanitized: trimmed }
}

/**
 * 验证通用文本输入（移除危险字符但允许更多内容）
 * 适用于：描述、备注等长文本
 */
export function validateText(
    text: string,
    fieldName: string = validationField('content'),
    maxLength: number = 1000
): ValidationResult {
    if (!text || typeof text !== 'string') {
        return { valid: true, sanitized: '' }
    }

    if (text.length > maxLength) {
        return { valid: false, message: validationMessage('maxLength', fieldName, { max: maxLength }) }
    }

    // 移除危险字符但保留其他内容
    const sanitized = removeDangerousChars(text).trim()

    return { valid: true, sanitized }
}

/**
 * 验证URL格式
 */
export function validateUrl(url: string, fieldName: string = 'URL'): ValidationResult {
    if (!url || typeof url !== 'string') {
        return { valid: false, message: validationMessage('required', fieldName) }
    }

    const trimmed = url.trim()

    // 基本URL格式验证
    try {
        new URL(trimmed)
    } catch {
        return { valid: false, message: validationMessage('invalidFormat', fieldName) }
    }

    // 只允许 http 和 https 协议
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return { valid: false, message: validationMessage('urlProtocol', fieldName) }
    }

    return { valid: true, sanitized: trimmed }
}

/**
 * 验证主机地址（IPv4、IPv6 或域名），适用于 Incus API 连接地址
 */
export function validateHostAddress(input: string, fieldName: string = validationField('serverAddress')): ValidationResult {
    if (!input || typeof input !== 'string') {
        return { valid: false, message: validationMessage('required', fieldName) }
    }
    const trimmed = input.trim()
    const normalized = normalizeHostAddress(input)
    if (trimmed.length === 0 || normalized.length === 0) { return { valid: false, message: validationMessage('required', fieldName) } }
    if (normalized.length > 253) { return { valid: false, message: validationMessage('maxLength', fieldName, { max: 253 }) } }
    // IPv4
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    if (ipv4Regex.test(normalized)) { return { valid: true, sanitized: normalized } }
    if (isValidIpv6Format(normalized)) { return { valid: true, sanitized: normalized } }
    // 域名
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
    if (domainRegex.test(normalized)) {
        const labels = normalized.split('.')
        for (const label of labels) {
            if (label.length > 63) { return { valid: false, message: validationMessage('invalidFormat', fieldName) } }
        }
        return { valid: true, sanitized: normalized }
    }
    return { valid: false, message: validationMessage('hostAddressInvalid', fieldName) }
}

/**
 * 验证IP地址格式（仅支持 IPv4 / IPv6，不支持域名）
 */
export function validateIpAddress(ip: string, fieldName: string = validationField('ipAddress')): ValidationResult {
    if (!ip || typeof ip !== 'string') {
        return { valid: false, message: validationMessage('required', fieldName) }
    }

    const normalized = normalizeHostAddress(ip)
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

    if (ipv4Regex.test(normalized) || isValidIpv6Format(normalized)) {
        return { valid: true, sanitized: normalized }
    }

    return { valid: false, message: validationMessage('ipAddressInvalid', fieldName) }
}

/**
 * 验证IPv4地址格式（仅支持IPv4，不支持域名）
 * 适用于：NAT 网卡 IP
 */
export function validateIpv4(input: string, fieldName: string = validationField('ipAddress')): ValidationResult {
    if (!input || typeof input !== 'string') {
        return { valid: false, message: validationMessage('required', fieldName) }
    }

    const trimmed = input.trim()
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    if (ipv4Regex.test(trimmed)) {
        return { valid: true, sanitized: trimmed }
    }

    return { valid: false, message: validationMessage('ipv4Invalid', fieldName) }
}

/**
 * 验证主机地址格式
 * 适用于：连接地址（支持 IPv4、IPv6 或域名）
 */
export function validateIpOrDomain(input: string, fieldName: string = validationField('ipOrDomain')): ValidationResult {
    return validateHostAddress(input, fieldName)
}

/**
 * 实时输入过滤器 - 用于 v-model 绑定时实时过滤危险字符
 */
export function filterDangerousInput(event: Event): void {
    const input = event.target as HTMLInputElement
    if (input && input.value) {
        const filtered = removeDangerousChars(input.value)
        if (filtered !== input.value) {
            input.value = filtered
            input.dispatchEvent(new Event('input', { bubbles: true }))
        }
    }
}

/**
 * 创建输入验证指令的处理函数
 */
export function createInputValidator(type: 'name' | 'identifier' | 'text' = 'name') {
    return (el: HTMLInputElement) => {
        el.addEventListener('input', () => {
            const value = el.value
            let result: ValidationResult

            switch (type) {
                case 'identifier':
                    result = validateIdentifier(value, '', 0, 1000)
                    break
                case 'text':
                    result = validateText(value, '', 10000)
                    break
                default:
                    result = validateName(value, '', 0, 1000)
            }

            if (!result.valid && result.sanitized !== undefined) {
                el.value = result.sanitized
                el.dispatchEvent(new Event('input', { bubbles: true }))
            }
        })
    }
}

/**
 * 验证重定向 URL 是否安全（防止开放重定向漏洞）
 */
export function isValidRedirectUrl(url: string | undefined | null): boolean {
    if (!url || typeof url !== 'string') {
        return false
    }

    const trimmed = url.trim()

    if (trimmed.length === 0) {
        return false
    }

    if (!trimmed.startsWith('/')) {
        return false
    }

    if (trimmed.startsWith('//')) {
        return false
    }

    const lowerUrl = trimmed.toLowerCase()
    if (lowerUrl.includes('javascript:') || lowerUrl.includes('data:') || lowerUrl.includes('vbscript:')) {
        return false
    }

    if (/[\r\n\t]/.test(trimmed)) {
        return false
    }

    if (/%0[dD]|%0[aA]/.test(trimmed)) {
        return false
    }

    return true
}

/**
 * 获取安全的重定向 URL
 */
export function getSafeRedirectUrl(url: string | undefined | null, defaultUrl: string = '/'): string {
    if (isValidRedirectUrl(url)) {
        return url!.trim()
    }
    return defaultUrl
}

/**
 * 验证 IPv6 地址格式是否有效
 */
export function isValidIpv6Format(address: string): boolean {
    if (!address || typeof address !== 'string') {
        return false
    }
    const normalized = normalizeHostAddress(address)
    if (!normalized || !normalized.includes(':') || normalized.includes('/')) {
        return false
    }

    try {
        new URL(`http://[${normalized}]/`)
        return true
    } catch {
        return false
    }
}

/**
 * 标准化主机地址输入，允许用户直接输入带方括号的 IPv6 地址
 */
export function normalizeHostAddress(input: string): string {
    const trimmed = input.trim()

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const inner = trimmed.slice(1, -1).trim()
        if (inner.includes(':')) {
            return inner
        }
    }

    return trimmed
}

/**
 * 判断主机地址是否为 IPv6
 */
export function isIpv6HostAddress(address: string): boolean {
    return isValidIpv6Format(normalizeHostAddress(address))
}

/**
 * 根据节点连接地址和端口拼接 Incus API URL
 */
export function buildHostApiUrl(address: string, port: number): string {
    const normalized = normalizeHostAddress(address)
    const host = isIpv6HostAddress(normalized) ? `[${normalized}]` : normalized
    return `https://${host}:${port}`
}

/**
 * 从节点 URL 中提取连接地址
 */
export function extractHostAddressFromUrl(url: string): string {
    try {
        return normalizeHostAddress(new URL(url).hostname)
    } catch {
        return ''
    }
}
