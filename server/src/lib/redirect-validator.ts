/**
 * 重定向 URL 验证工具
 * 用于防止开放重定向漏洞 (Open Redirect Vulnerability)
 */

/**
 * 验证重定向 URL 是否安全
 * 只允许相对路径，不允许外部 URL 或 JavaScript 协议
 */
export function isValidRedirectUrl(url: string | undefined | null): boolean {
    if (!url || typeof url !== 'string') {
        return false
    }

    const trimmed = url.trim()

    // 空字符串不允许
    if (trimmed.length === 0) {
        return false
    }

    // 必须以 / 开头（相对路径）
    if (!trimmed.startsWith('/')) {
        return false
    }

    // 不允许 // 或 /\ 开头（浏览器会把反斜杠归一化为正斜杠）
    if (trimmed[1] === '/' || trimmed[1] === '\\') {
        return false
    }

    // 不允许任何反斜杠，避免 WHATWG URL 归一化绕过
    if (trimmed.includes('\\')) {
        return false
    }

    // 不允许 javascript: 协议（包括各种变体）
    const lowerUrl = trimmed.toLowerCase()
    if (lowerUrl.includes('%5c') || lowerUrl.startsWith('/%2f') || lowerUrl.startsWith('/%5c')) {
        return false
    }

    if (lowerUrl.includes('javascript:') || lowerUrl.includes('data:') || lowerUrl.includes('vbscript:')) {
        return false
    }

    // 不允许包含换行符或其他特殊控制字符
    if (/[\r\n\t]/.test(trimmed)) {
        return false
    }

    // 不允许 URL 编码的换行符
    if (/%0[dD]|%0[aA]/.test(trimmed)) {
        return false
    }

    return true
}

/**
 * 获取安全的重定向 URL
 * 如果 URL 不安全，返回默认值
 */
export function getSafeRedirectUrl(url: string | undefined | null, defaultUrl: string = '/'): string {
    if (isValidRedirectUrl(url)) {
        return url!.trim()
    }
    return defaultUrl
}
