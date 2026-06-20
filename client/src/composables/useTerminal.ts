/**
 * 终端连接 Composable
 * 
 * 管理 WebSocket 连接、xterm.js 终端实例和生命周期
 * 
 * 功能特性：
 * - WebGL 硬件加速渲染（带 Canvas 回退）
 * - Unicode 11 宽字符支持（中文、Emoji）
 * - 终端内图片显示支持
 * - 内容序列化导出
 * - 搜索功能
 * - 可点击链接
 * - 剪贴板增强
 * - 快捷键支持
 */

import { ref, shallowRef, onMounted, onUnmounted, watch, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SerializeAddon } from '@xterm/addon-serialize'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import {
    buildTerminalWebSocketUrl,
    createTerminalRuntime,
    disposeTerminalRuntime,
    handleTerminalSocketPayload,
    shouldRetryTerminalClose,
    TERMINAL_MAX_RECONNECT_ATTEMPTS
} from '@/lib/terminal-core'

// Vercel 极简风格 - 纯黑背景
const TERMINAL_THEME = {
    background: '#0a0a0a',
    foreground: '#ededed',
    cursor: '#ffffff',
    cursorAccent: '#0a0a0a',
    selectionBackground: '#444444',
    selectionForeground: '#ffffff',
    black: '#0a0a0a',
    red: '#ff6369',
    green: '#52c41a',
    yellow: '#faad14',
    blue: '#1890ff',
    magenta: '#eb2f96',
    cyan: '#13c2c2',
    white: '#ededed',
    brightBlack: '#666666',
    brightRed: '#ff8a8a',
    brightGreen: '#73d13d',
    brightYellow: '#ffc53d',
    brightBlue: '#40a9ff',
    brightMagenta: '#f759ab',
    brightCyan: '#36cfc9',
    brightWhite: '#ffffff'
}

// 连接状态
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

// 终端配置
export interface TerminalOptions {
    fontSize?: number
    fontFamily?: string
    cursorBlink?: boolean
    cursorStyle?: 'block' | 'underline' | 'bar'
    enableWebGL?: boolean      // 是否启用 WebGL 渲染
    enableImages?: boolean     // 是否启用图片支持
    scrollback?: number        // 回滚行数
}

// WebSocket 消息类型
interface TerminalMessage {
    type: 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'data'
    sessionId?: string
    message?: string
    code?: string
    reason?: string
}

export function useTerminal(instanceId: Ref<number | null>, options: TerminalOptions = {}) {
    const authStore = useAuthStore()
    
    // 移动端检测（用于禁用 WebGL 等）
    // 注意：新版 iPadOS 在桌面模式下 User-Agent 不包含 "iPad"，需结合 maxTouchPoints 检测
    const isMobileDevice = (() => {
        const ua = navigator.userAgent
        // 传统移动端 UA 检测
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
            return true
        }
        // iPadOS 桌面模式检测：UA 显示为 Mac，但支持触摸
        if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
            return true
        }
        // 通用触摸设备检测（作为补充）
        if (navigator.maxTouchPoints > 0 && /Mac|Windows/i.test(navigator.platform) === false) {
            return true
        }
        return false
    })()

    // 状态
    const status = ref<ConnectionStatus>('disconnected')
    const error = ref<string | null>(null)
    const sessionId = ref<string | null>(null)

    // 终端实例（使用 shallowRef 避免响应式代理）
    const terminal = shallowRef<Terminal | null>(null)
    const fitAddon = shallowRef<FitAddon | null>(null)
    const searchAddon = shallowRef<SearchAddon | null>(null)
    const unicodeAddon = shallowRef<Unicode11Addon | null>(null)
    const webglAddon = shallowRef<WebglAddon | null>(null)
    const serializeAddon = shallowRef<SerializeAddon | null>(null)
    const clipboardAddon = shallowRef<ClipboardAddon | null>(null)
    
    // 渲染状态
    const isWebGLEnabled = ref(false)

    // WebSocket
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0
    // 更激进的重连策略，后台时也能保持连接
    let terminalEventsBound = false  // 防止重复绑定事件

    // 配置
    const fontSize = ref(options.fontSize || 14)
    const fontFamily = options.fontFamily || "'JetBrains Mono', 'Fira Code', 'Consolas', monospace"

    /**
     * 初始化终端
     */
    function initTerminal(container: HTMLElement): Terminal {
        const runtime = createTerminalRuntime({
            container,
            fontSize: fontSize.value,
            fontFamily,
            theme: TERMINAL_THEME,
            isMobileDevice,
            enableWebgl: options.enableWebGL,
            onSelectionCopy: () => undefined
        })

        terminal.value = runtime.terminal
        fitAddon.value = runtime.fitAddon
        searchAddon.value = runtime.searchAddon
        unicodeAddon.value = runtime.unicodeAddon
        webglAddon.value = runtime.webglAddon
        serializeAddon.value = runtime.serializeAddon
        clipboardAddon.value = runtime.clipboardAddon
        isWebGLEnabled.value = runtime.isWebGLEnabled

        return runtime.terminal
    }

    /**
     * 连接到终端
     */
    async function connect() {
        if (!instanceId.value) {
            error.value = 'Instance ID is required'
            return
        }

        // 检查认证状态
        const token = authStore.token
        if (!token) {
            error.value = 'Authentication required'
            status.value = 'error'
            return
        }

        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return
        }

        status.value = reconnectAttempts > 0 ? 'reconnecting' : 'connecting'
        error.value = null

        try {
            const ticketResponse = await api.instances.createTerminalTicket(instanceId.value)
            const wsUrl = buildTerminalWebSocketUrl(instanceId.value, ticketResponse.ticket)
            ws = new WebSocket(wsUrl)
            // 使用 arraybuffer 确保二进制数据按顺序处理（避免 Blob 异步导致的乱序）
            ws.binaryType = 'arraybuffer'

            ws.onopen = () => {
                console.log('[Terminal] WebSocket connected')
                reconnectAttempts = 0
            }

            ws.onmessage = (event) => {
                handleTerminalSocketPayload(event.data, () => terminal.value, (message) => {
                    handleControlMessage(message as TerminalMessage)
                })
            }

            ws.onerror = (event) => {
                console.error('[Terminal] WebSocket error:', event)
                error.value = 'Connection error'
            }

            ws.onclose = (event) => {
                console.log('[Terminal] WebSocket closed:', event.code, event.reason)

                if (shouldRetryTerminalClose(event.code) && (status.value === 'connected' || status.value === 'connecting' || status.value === 'reconnecting')) {
                    // 意外断开，尝试重连
                    if (reconnectAttempts < TERMINAL_MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++
                        status.value = 'reconnecting'
                        // 线性退避：1秒, 3秒, 5秒... 最多 15秒
                        const delay = Math.min(1000 + (reconnectAttempts - 1) * 2000, 15000)
                        reconnectTimer = setTimeout(() => {
                            void connect()
                        }, delay)
                    } else {
                        status.value = 'disconnected'
                        error.value = 'Connection lost'
                    }
                } else {
                    status.value = 'disconnected'
                }
            }

            // 绑定终端输入（只绑定一次）
            if (terminal.value && !terminalEventsBound) {
                terminalEventsBound = true
                
                terminal.value.onData((data) => {
                    // 使用当前的 ws 引用，而不是闭包捕获的
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(data)
                        } catch {
                            // WebSocket 可能在发送时已关闭，忽略错误
                        }
                    }
                })

                // 监听终端大小变化
                terminal.value.onResize(({ cols, rows }) => {
                    sendResize(cols, rows)
                })
            }
        } catch (err) {
            console.error('[Terminal] Failed to create WebSocket:', err)
            status.value = 'error'
            error.value = err instanceof Error ? err.message : 'Failed to connect'
        }
    }

    /**
     * 处理控制消息
     */
    function handleControlMessage(message: TerminalMessage) {
        switch (message.type) {
            case 'connected':
                status.value = 'connected'
                sessionId.value = message.sessionId || null
                error.value = null
                // 连接成功后发送初始大小
                if (terminal.value && fitAddon.value) {
                    fitAddon.value.fit()
                    sendResize(terminal.value.cols, terminal.value.rows)
                }
                break

            case 'reconnecting':
                status.value = 'reconnecting'
                error.value = message.reason || null
                break

            case 'disconnected':
                status.value = 'disconnected'
                error.value = message.reason || null
                sessionId.value = null
                break

            case 'error':
                status.value = 'error'
                error.value = message.message || 'Unknown error'
                if (terminal.value) {
                    terminal.value.write(`\r\n\x1b[31mError: ${message.message}\x1b[0m\r\n`)
                }
                break
        }
    }

    /**
     * 发送调整大小命令
     */
    function sendResize(cols: number, rows: number) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: 'resize',
                    cols,
                    rows
                }))
            } catch {
                // WebSocket 可能在发送时已关闭，忽略错误
            }
        }
    }

    /**
     * 断开连接
     */
    function disconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer)
            reconnectTimer = null
        }

        // 先关闭 WebSocket，然后重置重连计数
        if (ws) {
            // 临时设置为最大值以阻止 onclose 中的自动重连
            reconnectAttempts = TERMINAL_MAX_RECONNECT_ATTEMPTS
            ws.close(1000, 'User disconnect')
            ws = null
        }

        // 重置重连计数，以便用户可以手动重连
        reconnectAttempts = 0

        status.value = 'disconnected'
        sessionId.value = null
    }

    /**
     * 调整终端大小
     */
    function fit() {
        if (fitAddon.value && terminal.value) {
            fitAddon.value.fit()
        }
    }

    /**
     * 清空终端
     */
    function clear() {
        if (terminal.value) {
            terminal.value.clear()
        }
    }

    /**
     * 搜索文本
     */
    function search(text: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) {
        if (searchAddon.value) {
            return searchAddon.value.findNext(text, {
                caseSensitive: options?.caseSensitive,
                wholeWord: options?.wholeWord,
                regex: options?.regex
            })
        }
        return false
    }

    /**
     * 搜索上一个
     */
    function searchPrevious(text: string) {
        if (searchAddon.value) {
            return searchAddon.value.findPrevious(text)
        }
        return false
    }

    /**
     * 更改字体大小
     */
    function setFontSize(size: number) {
        fontSize.value = size
        if (terminal.value) {
            terminal.value.options.fontSize = size
            fit()
        }
    }

    /**
     * 聚焦终端
     */
    function focus() {
        if (terminal.value) {
            terminal.value.focus()
        }
    }

    /**
     * 写入文本
     */
    function write(text: string) {
        if (terminal.value) {
            terminal.value.write(text)
        }
    }

    /**
     * 复制选中的文本
     */
    async function copySelection(): Promise<boolean> {
        if (!terminal.value) return false
        const selection = terminal.value.getSelection()
        if (!selection) return false
        
        try {
            await navigator.clipboard.writeText(selection)
            return true
        } catch {
            // 回退到 execCommand
            try {
                const textarea = document.createElement('textarea')
                textarea.value = selection
                textarea.style.position = 'fixed'
                textarea.style.opacity = '0'
                document.body.appendChild(textarea)
                textarea.select()
                document.execCommand('copy')
                document.body.removeChild(textarea)
                return true
            } catch {
                return false
            }
        }
    }

    /**
     * 获取选中的文本
     */
    function getSelection(): string {
        return terminal.value?.getSelection() || ''
    }

    /**
     * 是否有选中文本
     */
    function hasSelection(): boolean {
        return !!terminal.value?.hasSelection()
    }

    /**
     * 粘贴文本到终端
     */
    async function paste(): Promise<boolean> {
        try {
            const text = await navigator.clipboard.readText()
            if (text && ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(text)
                    return true
                } catch {
                    return false
                }
            }
            return false
        } catch {
            return false
        }
    }

    /**
     * 粘贴指定文本到终端
     */
    function pasteText(text: string): boolean {
        if (text && ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(text)
                return true
            } catch {
                return false
            }
        }
        return false
    }

    /**
     * 去除 ANSI 转义序列（颜色控制码等）
     * 这些在纯文本编辑器中会显示为方框
     */
    function stripAnsiSequences(text: string): string {
        // 匹配所有 ANSI 转义序列：ESC [ ... 字母
        // 包括颜色、光标移动、清屏等控制码
        // 使用 RegExp 构造函数避免 ESLint 报错
        const ansiRegex = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[a-zA-Z]', 'g')
        return text.replace(ansiRegex, '')
    }

    /**
     * 导出终端内容
     * @param format 'text' 返回纯文本（去除颜色码），'html' 返回带样式的 HTML
     */
    function exportContent(format: 'text' | 'html' = 'text'): string {
        if (!serializeAddon.value) return ''
        try {
            if (format === 'html') {
                return serializeAddon.value.serializeAsHTML()
            }
            // 纯文本格式：去除 ANSI 转义序列
            const raw = serializeAddon.value.serialize()
            return stripAnsiSequences(raw)
        } catch (err) {
            console.error('[Terminal] Failed to export content:', err)
            return ''
        }
    }

    /**
     * 下载终端日志
     */
    function downloadLog(filename?: string): boolean {
        const content = exportContent('text')
        if (!content) return false
        
        try {
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename || `terminal-${Date.now()}.log`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
            return true
        } catch (err) {
            console.error('[Terminal] Failed to download log:', err)
            return false
        }
    }

    /**
     * 增大字体
     */
    function increaseFontSize(): void {
        const newSize = Math.min(fontSize.value + 2, 32)
        setFontSize(newSize)
    }

    /**
     * 减小字体
     */
    function decreaseFontSize(): void {
        const newSize = Math.max(fontSize.value - 2, 8)
        setFontSize(newSize)
    }

    /**
     * 重置字体大小
     */
    function resetFontSize(): void {
        setFontSize(options.fontSize || 14)
    }

    /**
     * 滚动到底部
     */
    function scrollToBottom(): void {
        terminal.value?.scrollToBottom()
    }

    /**
     * 滚动到顶部
     */
    function scrollToTop(): void {
        terminal.value?.scrollToTop()
    }

    /**
     * 获取渲染器类型
     */
    function getRendererType(): 'webgl' | 'canvas' {
        return isWebGLEnabled.value ? 'webgl' : 'canvas'
    }

    /**
     * 销毁终端
     */
    function dispose() {
        // 1. 先断开 WebSocket 连接
        disconnect()

        disposeTerminalRuntime({
            terminal: terminal.value,
            fitAddon: fitAddon.value,
            searchAddon: searchAddon.value,
            unicodeAddon: unicodeAddon.value,
            webglAddon: webglAddon.value,
            serializeAddon: serializeAddon.value,
            clipboardAddon: clipboardAddon.value,
            eventsBound: terminalEventsBound,
            isWebGLEnabled: isWebGLEnabled.value
        })

        terminal.value = null
        fitAddon.value = null
        searchAddon.value = null
        unicodeAddon.value = null
        webglAddon.value = null
        serializeAddon.value = null
        clipboardAddon.value = null
        isWebGLEnabled.value = false
        terminalEventsBound = false
    }

    // 监听实例 ID 变化，切换实例时断开旧连接
    watch(instanceId, (newId, oldId) => {
        if (newId !== oldId && oldId !== null) {
            disconnect()
        }
    })

    // 移动端 visualViewport 变化处理（软键盘弹出/收起）
    const handleViewportResize = () => {
        setTimeout(() => {
            if (fitAddon.value && terminal.value) {
                fitAddon.value.fit()
                terminal.value.refresh(0, terminal.value.rows - 1)
            }
        }, 100)
    }

    // 页面可见性变化时自动重连
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && status.value === 'disconnected' && instanceId.value) {
            // 用户回来了，如果已断开则自动重连
            console.log('[Terminal] Page visible, auto reconnecting...')
            reconnectAttempts = 0 // 重置重连计数
            connect()
        }
    }

    // 组件挂载时添加监听
    onMounted(() => {
        document.addEventListener('visibilitychange', handleVisibilityChange)
        
        // 移动端：监听 visualViewport 变化（软键盘弹出/收起）
        if (isMobileDevice && window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleViewportResize)
        }
    })

    // 组件卸载时清理
    onUnmounted(() => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        
        // 移动端：移除 visualViewport 监听
        if (isMobileDevice && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', handleViewportResize)
        }
        
        dispose()
    })

    return {
        // 状态
        status,
        error,
        sessionId,
        terminal,
        fontSize,
        isWebGLEnabled,

        // 方法
        initTerminal,
        connect,
        disconnect,
        fit,
        clear,
        search,
        searchPrevious,
        setFontSize,
        increaseFontSize,
        decreaseFontSize,
        resetFontSize,
        focus,
        write,
        dispose,
        
        // 复制粘贴
        copySelection,
        getSelection,
        hasSelection,
        paste,
        pasteText,
        
        // 导出
        exportContent,
        downloadLog,
        
        // 滚动
        scrollToBottom,
        scrollToTop,
        
        // 渲染器
        getRendererType
    }
}
