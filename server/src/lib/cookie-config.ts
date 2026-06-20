/**
 * Cookie 配置模块
 * SEC005: Cookie SameSite 属性统一配置
 * 
 * 集中管理所有 Cookie 相关配置，确保安全属性一致性
 */

import type { CookieSerializeOptions } from '@fastify/cookie'

/**
 * Cookie 安全配置
 * 根据环境变量和运行环境自动调整安全选项
 */
export interface CookieSecurityConfig {
  httpOnly: boolean
  secure: boolean
  sameSite: 'strict' | 'lax' | 'none'
  path: string
  maxAge: number
  domain?: string
}

/**
 * Cookie 类型配置
 */
export const COOKIE_CONFIG = {
  // Refresh Token Cookie 配置（简化版：延长到 30 天）
  REFRESH_TOKEN: {
    name: 'refreshToken',
    maxAge: 30 * 24 * 60 * 60,  // 30天（秒）
    path: '/',
  },
} as const

/**
 * 判断当前是否为生产环境
 */
export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * 获取 Cookie Secure 属性
 * 生产环境或显式配置时使用 HTTPS
 */
export function getCookieSecure(): boolean {
  return isProductionEnv() || process.env.COOKIE_SECURE === 'true'
}

/**
 * 获取 Cookie SameSite 属性
 * 
 * 策略说明：
 * - 生产环境：默认 'lax'（兼容跨站导航）
 * - 开发环境：默认 'strict'（最高安全性）
 * - 可通过 COOKIE_SAME_SITE 环境变量覆盖
 * 
 * SameSite 值说明：
 * - 'strict': 完全禁止跨站请求携带 Cookie（最安全，但可能影响 OAuth 回调）
 * - 'lax': 允许顶级导航携带 Cookie（推荐生产环境使用）
 * - 'none': 允许所有跨站请求（需配合 Secure=true，适用于跨域场景）
 */
export function getCookieSameSite(): 'strict' | 'lax' | 'none' {
  const isProduction = isProductionEnv()
  
  // 如果显式配置了 COOKIE_SAME_SITE，使用配置值
  if (process.env.COOKIE_SAME_SITE) {
    const value = process.env.COOKIE_SAME_SITE.toLowerCase()
    if (value === 'strict' || value === 'lax' || value === 'none') {
      // 验证：'none' 必须配合 secure=true
      if (value === 'none' && !getCookieSecure()) {
        console.warn('[Cookie Config] SameSite=none requires Secure=true, falling back to lax')
        return 'lax'
      }
      return value
    }
    console.warn(`[Cookie Config] Invalid COOKIE_SAME_SITE value: ${process.env.COOKIE_SAME_SITE}, using default`)
  }
  
  // 默认值：生产环境用 lax，开发环境用 strict
  return isProduction ? 'lax' : 'strict'
}

/**
 * 获取 Cookie Domain 属性
 * 用于跨子域名共享 Cookie 的场景
 */
export function getCookieDomain(): string | undefined {
  return process.env.COOKIE_DOMAIN || undefined
}

/**
 * 获取 Refresh Token Cookie 完整配置
 * 
 * @returns Fastify Cookie 序列化选项
 */
export function getRefreshTokenCookieOptions(): CookieSerializeOptions {
  const domain = getCookieDomain()
  
  return {
    httpOnly: true,          // 防止 XSS 攻击读取 Cookie
    secure: getCookieSecure(),
    sameSite: getCookieSameSite(),
    path: COOKIE_CONFIG.REFRESH_TOKEN.path,
    maxAge: COOKIE_CONFIG.REFRESH_TOKEN.maxAge,
    ...(domain ? { domain } : {}),
  }
}

/**
 * 获取清除 Cookie 的选项
 * 
 * @returns 清除 Cookie 所需的选项
 */
export function getClearCookieOptions(): { path: string; domain?: string } {
  const domain = getCookieDomain()
  return {
    path: '/',
    ...(domain ? { domain } : {}),
  }
}

/**
 * 在启动时打印 Cookie 配置（用于调试）
 */
export function logCookieConfig(): void {
  const config = getRefreshTokenCookieOptions()
  const maxAge = config.maxAge ?? COOKIE_CONFIG.REFRESH_TOKEN.maxAge
  console.log('[Cookie Config] Current settings:', {
    secure: config.secure,
    sameSite: config.sameSite,
    domain: config.domain || '(not set)',
    maxAge: `${maxAge}s (${Math.round(maxAge / 86400)} days)`,
    environment: isProductionEnv() ? 'production' : 'development',
  })
}
