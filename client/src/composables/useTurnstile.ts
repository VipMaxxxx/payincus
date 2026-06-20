/**
 * Turnstile 隐式验证 Composable
 * 用于在后台自动获取验证 token
 */
import { ref, onMounted, onUnmounted } from 'vue'
import api from '@/api'

// 扩展 Window 类型以支持 Turnstile API
interface TurnstileAPI {
    render: (container: HTMLElement | string, options: {
        sitekey: string
        action?: string
        size?: 'normal' | 'compact' | 'flexible'
        theme?: 'light' | 'dark' | 'auto'
        callback?: (token: string) => void
        'error-callback'?: () => void
        'expired-callback'?: () => void
    }) => string
    reset: (widgetId: string) => void
    remove: (widgetId: string) => void
    getResponse: (widgetId: string) => string | undefined
}

declare const window: Window & { turnstile?: TurnstileAPI }

// 全局配置缓存
let cachedConfig: { enabled: boolean; siteKey: string | null } | null = null
let configPromise: Promise<{ enabled: boolean; siteKey: string | null }> | null = null

// Turnstile 脚本加载状态
let scriptLoaded = false
let scriptLoading = false
let scriptLoadPromise: Promise<void> | null = null

/**
 * 加载 Turnstile 配置
 */
async function loadTurnstileConfig(): Promise<{ enabled: boolean; siteKey: string | null }> {
    if (cachedConfig) {
        return cachedConfig
    }

    if (configPromise) {
        return configPromise
    }

    configPromise = (async () => {
        try {
            const response = await api.systemConfig.getPublic()
            cachedConfig = {
                enabled: response.turnstileEnabled || false,
                siteKey: response.turnstileSiteKey || null
            }
            return cachedConfig
        } catch (error) {
            console.error('Failed to load Turnstile config:', error)
            cachedConfig = { enabled: false, siteKey: null }
            return cachedConfig
        }
    })()

    return configPromise
}

/**
 * 加载 Turnstile 脚本
 */
function loadTurnstileScript(): Promise<void> {
    // 如果已加载或 window.turnstile 已存在（可能由 vue-turnstile 加载）
    if (scriptLoaded || window.turnstile) {
        scriptLoaded = true
        return Promise.resolve()
    }

    // 如果正在加载，返回现有的 Promise
    if (scriptLoading && scriptLoadPromise) {
        return scriptLoadPromise
    }

    scriptLoading = true
    scriptLoadPromise = new Promise((resolve, reject) => {
        // 再次检查，防止竞态条件
        if (window.turnstile) {
            scriptLoaded = true
            scriptLoading = false
            resolve()
            return
        }

        // 检查是否已有脚本标签（可能由其他组件添加）
        const existingScript = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')
        if (existingScript) {
            // 等待脚本加载完成
            const checkInterval = setInterval(() => {
                if (window.turnstile) {
                    clearInterval(checkInterval)
                    scriptLoaded = true
                    scriptLoading = false
                    resolve()
                }
            }, 100)
            // 设置超时
            setTimeout(() => {
                clearInterval(checkInterval)
                if (!window.turnstile) {
                    scriptLoading = false
                    reject(new Error('Turnstile script load timeout'))
                }
            }, 10000)
            return
        }

        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true

        script.onload = () => {
            // 等待 turnstile 对象可用
            const checkInterval = setInterval(() => {
                if (window.turnstile) {
                    clearInterval(checkInterval)
                    scriptLoaded = true
                    scriptLoading = false
                    resolve()
                }
            }, 50)
            // 设置超时
            setTimeout(() => {
                clearInterval(checkInterval)
                if (!window.turnstile) {
                    scriptLoading = false
                    reject(new Error('Turnstile API not available after script load'))
                }
            }, 5000)
        }

        script.onerror = () => {
            scriptLoading = false
            reject(new Error('Failed to load Turnstile script'))
        }

        document.head.appendChild(script)
    })

    return scriptLoadPromise
}

/**
 * 清除配置缓存（用于管理员更新配置后刷新）
 */
export function clearTurnstileConfigCache() {
    cachedConfig = null
    configPromise = null
}

/**
 * Turnstile 隐式验证 Composable
 */
export function useTurnstile(action?: string) {
    const token = ref<string>('')
    const isReady = ref(false)
    const isEnabled = ref(false)
    const siteKey = ref<string | null>(null)
    const error = ref<string | null>(null)
    const widgetId = ref<string | null>(null)
    const containerId = ref<string>(`turnstile-${Math.random().toString(36).substring(7)}`)

    // 初始化
    async function init() {
        try {
            const config = await loadTurnstileConfig()
            isEnabled.value = config.enabled
            siteKey.value = config.siteKey

            if (!config.enabled || !config.siteKey) {
                isReady.value = true
                return
            }

            await loadTurnstileScript()
            isReady.value = true
        } catch (err) {
            error.value = err instanceof Error ? err.message : String(err)
            isReady.value = true
        }
    }

    // 执行隐式验证
    async function execute(): Promise<string> {
        if (!isEnabled.value || !siteKey.value) {
            return ''
        }

        if (!isReady.value) {
            await init()
        }

        // 再次检查，init 可能因为配置问题而跳过
        if (!isEnabled.value || !siteKey.value) {
            return ''
        }

        return new Promise((resolve, reject) => {
            if (!window.turnstile) {
                reject(new Error('Turnstile not loaded'))
                return
            }

            // 设置超时
            const timeout = setTimeout(() => {
                reject(new Error('Turnstile verification timeout'))
            }, 30000) // 30秒超时

            // 创建隐藏容器
            // 注意：不能使用 display:none 或 visibility:hidden，否则 Turnstile 无法正常渲染
            // 使用 position:fixed + 移出可视区域 + opacity:0 的方式隐藏
            let container = document.getElementById(containerId.value)
            if (!container) {
                container = document.createElement('div')
                container.id = containerId.value
                container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;'
                document.body.appendChild(container)
            }

            // 如果已有 widget，先移除
            if (widgetId.value) {
                try {
                    window.turnstile.remove(widgetId.value)
                    widgetId.value = null
                } catch {
                    // 忽略移除错误
                }
            }

            try {
                // 渲染新的 widget
                // 注意：Turnstile 不支持 'invisible' size，使用 'compact' 配合隐藏容器实现隐式验证
                // 实际的隐式/非交互模式需要在 Cloudflare Dashboard 中配置 widget 类型
                widgetId.value = window.turnstile.render(container, {
                    sitekey: siteKey.value!,
                    action: action,
                    size: 'compact',
                    callback: (response: string) => {
                        clearTimeout(timeout)
                        token.value = response
                        resolve(response)
                    },
                    'error-callback': () => {
                        clearTimeout(timeout)
                        reject(new Error('Turnstile verification failed'))
                    },
                    'expired-callback': () => {
                        token.value = ''
                    }
                })
            } catch (err) {
                clearTimeout(timeout)
                reject(err instanceof Error ? err : new Error(String(err)))
            }
        })
    }

    // 重置
    function reset() {
        token.value = ''
        if (widgetId.value && window.turnstile) {
            try {
                window.turnstile.reset(widgetId.value)
            } catch {
                // 忽略重置错误
            }
        }
    }

    // 清理
    function cleanup() {
        if (widgetId.value && window.turnstile) {
            try {
                window.turnstile.remove(widgetId.value)
            } catch {
                // 忽略移除错误
            }
        }
        const container = document.getElementById(containerId.value)
        if (container) {
            container.remove()
        }
    }

    onMounted(() => {
        init()
    })

    onUnmounted(() => {
        cleanup()
    })

    return {
        token,
        isReady,
        isEnabled,
        siteKey,
        error,
        execute,
        reset,
        cleanup
    }
}

export default useTurnstile
