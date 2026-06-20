<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SerializeAddon } from '@xterm/addon-serialize'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import { useTerminalStore } from '@/stores/terminal'
import type { CloudInitState, CloudInitStatusResponse } from '@/types/api'
import TerminalSavedCommandsSidebar from '@/components/terminal/TerminalSavedCommandsSidebar.vue'
import TerminalContextMenu from './TerminalContextMenu.vue'
import TerminalAccessoryBar from './TerminalAccessoryBar.vue'
import {
    buildTerminalWebSocketUrl,
    createTerminalRuntime,
    disposeTerminalRuntime,
    handleTerminalSocketPayload,
    shouldRetryTerminalClose,
    TERMINAL_MAX_RECONNECT_ATTEMPTS
} from '@/lib/terminal-core'
import api from '@/api'
import '@xterm/xterm/css/xterm.css'

const MAX_TABS = 3  // 与后端 TERMINAL_LIMITS.maxPerInstance 保持一致

interface TerminalTab {
    id: string
    label: string
    terminal: Terminal | null
    fitAddon: FitAddon | null
    searchAddon: SearchAddon | null
    unicodeAddon: Unicode11Addon | null
    webglAddon: WebglAddon | null
    serializeAddon: SerializeAddon | null
    clipboardAddon: ClipboardAddon | null
    ws: WebSocket | null
    status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
    connectionMode: 'exec' | 'console' | null
    error: string | null
    container: HTMLElement | null
    eventsBound: boolean
    isWebGLEnabled: boolean
    consoleWarningShown: boolean
    connectAttempt: number
}

const props = defineProps<{
    visible: boolean
    instanceId: number | null
    instanceName?: string
    forceDisconnect?: boolean
    allowManualCloudInitComplete?: boolean
}>()

const emit = defineEmits<{
    (e: 'update:visible', value: boolean): void
    (e: 'close'): void
    (e: 'update:connected', value: boolean): void
    (e: 'update:sessionActive', value: boolean): void
    (e: 'update:forceDisconnect', value: boolean): void
    (e: 'update:tabCount', value: number): void
    (e: 'cloud-init-manual-complete'): void
}>()

const { t } = useI18n()
const authStore = useAuthStore()
const toast = useToast()
const terminalStore = useTerminalStore()

// 标签管理
const tabs = ref<TerminalTab[]>([])
const activeTabId = ref<string>('')

// 终端容器引用映射
const containerRefs = ref<Map<string, HTMLElement>>(new Map())

// 搜索状态
const searchInputRef = ref<HTMLInputElement | null>(null)
const showSearch = ref(false)
const searchText = ref('')

// 全屏状态
const isFullscreen = ref(false)

// 帮助弹窗状态
const showHelp = ref(false)

// 设置弹窗状态
const showSettings = ref(false)
const showSavedCommandsMobile = ref(false)

// 右键菜单状态
const contextMenu = reactive({
    visible: false,
    x: 0,
    y: 0
})

// 字体大小（从 store 读取，已持久化）
const fontSize = computed(() => terminalStore.fontSize)
// 动态计算字体大小选项，确保当前值始终在列表中
const fontSizeOptions = computed(() => {
    const baseOptions = [12, 14, 16, 18, 20]
    const current = fontSize.value
    // 如果当前值不在基础列表中，添加进去并排序
    if (!baseOptions.includes(current)) {
        return [...baseOptions, current].sort((a, b) => a - b)
    }
    return baseOptions
})

// 网络延迟检测
const networkLatency = ref<Map<string, number>>(new Map())

// 链接预览 tooltip
const linkTooltip = reactive({
    visible: false,
    x: 0,
    y: 0,
    url: ''
})

// 触控手势状态
const touchState = reactive({
    initialDistance: 0,
    initialFontSize: 14,
    isZooming: false
})

// 移动端检测（用于禁用 WebGL 和显示快捷工具栏）
// 综合检测：UA + 触摸能力 + 屏幕宽度
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
    // 小屏幕 + 触摸能力 = 移动设备（覆盖 Windows 平板等情况）
    if (navigator.maxTouchPoints > 0 && window.innerWidth <= 1024) {
        return true
    }
    // 纯小屏幕检测（如开发者工具模拟移动端）
    if (window.innerWidth <= 768) {
        return true
    }
    return false
})()

// Cloud-init 状态检查
const cloudInitStatus = ref<'idle' | 'checking' | 'not_ready' | 'ready' | 'skipped'>('idle')
const cloudInitState = ref<CloudInitState | null>(null)
const cloudInitManualCompleting = ref(false)

const cloudInitPromptTitle = computed(() => {
    return cloudInitState.value === 'unknown' || cloudInitState.value === 'agent_unavailable'
        ? t('terminal.cloudInitUnknown')
        : t('terminal.cloudInitInProgress')
})

const cloudInitPromptHint = computed(() => {
    return cloudInitState.value === 'unknown' || cloudInitState.value === 'agent_unavailable'
        ? t('terminal.cloudInitUnknownHint')
        : t('terminal.cloudInitInProgressHint')
})

const showManualCloudInitComplete = computed(() => {
    return props.allowManualCloudInitComplete !== false
        && (cloudInitState.value === 'unknown' || cloudInitState.value === 'agent_unavailable')
})
const cloudInitChecking = ref(false)

// 重连配置（更激进的保活策略）
const reconnectAttempts = ref<Map<string, number>>(new Map())
const reconnectTimers = ref<Map<string, ReturnType<typeof setTimeout>>>(new Map())

// 获取当前活动的标签
const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value))

// 是否有任何连接的标签
const hasConnectedTab = computed(() => tabs.value.some(t => t.status === 'connected'))

// 状态文本
const statusText = computed(() => {
    const tab = activeTab.value
    if (!tab) return ''
    switch (tab.status) {
        case 'connecting': return t('terminal.connecting')
        case 'connected': return t('terminal.connected')
        case 'reconnecting': return t('terminal.reconnecting')
        case 'disconnected': return t('terminal.disconnected')
        case 'error': return tab.error || t('terminal.connectionFailed')
        default: return ''
    }
})

// 生成唯一标签 ID
function generateTabId(): string {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// 创建新标签
function createTab(): TerminalTab {
    const id = generateTabId()
    const tabNumber = tabs.value.length + 1
    return {
        id,
        label: `${t('terminal.tab')} ${tabNumber}`,
        terminal: null,
        fitAddon: null,
        searchAddon: null,
        unicodeAddon: null,
        webglAddon: null,
        serializeAddon: null,
        clipboardAddon: null,
        ws: null,
        status: 'disconnected',
        connectionMode: null,
        error: null,
        container: null,
        eventsBound: false,
        isWebGLEnabled: false,
        consoleWarningShown: false,
        connectAttempt: 0
    }
}

// 添加新标签
function addTab() {
    if (tabs.value.length >= MAX_TABS) return
    const tab = createTab()
    tabs.value.push(tab)
    activeTabId.value = tab.id
    emit('update:tabCount', tabs.value.length)
    
    // 等待 DOM 更新后初始化
    nextTick(() => {
        initTabTerminal(tab.id)
    })
}

// 关闭标签
function closeTab(tabId: string) {
    const index = tabs.value.findIndex(t => t.id === tabId)
    if (index === -1) return
    
    const tab = tabs.value[index]
    
    // 清理重连定时器
    const timer = reconnectTimers.value.get(tabId)
    if (timer) {
        clearTimeout(timer)
        reconnectTimers.value.delete(tabId)
    }
    reconnectAttempts.value.delete(tabId)
    
    // 清理资源（按顺序：WebSocket -> GPU Addons -> Terminal）
    // 1. 先关闭 WebSocket 连接
    if (tab.ws) {
        tab.ws.close(1000, 'Tab closed')
        tab.ws = null
    }
    // 2. 清理终端资源
    disposeTerminalRuntime(tab)
    
    // 移除标签
    tabs.value.splice(index, 1)
    containerRefs.value.delete(tabId)
    emit('update:tabCount', tabs.value.length)
    
    // 如果关闭的是当前标签，切换到其他标签
    if (activeTabId.value === tabId && tabs.value.length > 0) {
        activeTabId.value = tabs.value[Math.min(index, tabs.value.length - 1)].id
        // 确保新激活的标签正确显示
        nextTick(() => {
            const newTab = activeTab.value
            if (newTab?.terminal && newTab.fitAddon) {
                newTab.fitAddon.fit()
                newTab.terminal.refresh(0, newTab.terminal.rows - 1)
                newTab.terminal.focus()
            }
        })
    }
    
    // 如果没有标签了，关闭模态框
    if (tabs.value.length === 0) {
        closeModal()
    }
}

// 切换标签
function switchTab(tabId: string) {
    if (activeTabId.value === tabId) return
    activeTabId.value = tabId
    
    nextTick(() => {
        const tab = activeTab.value
        if (tab?.terminal && tab.fitAddon) {
            tab.fitAddon.fit()
            tab.terminal.refresh(0, tab.terminal.rows - 1)
            tab.terminal.focus()
        }
    })
}

// 生成酷炫的 Incudal 欢迎信息
function printWelcomeBanner(terminal: Terminal, instanceName: string) {
    const banner = [
        '',
        '\x1b[1;38;5;39m  ◆\x1b[38;5;44m INCUDAL\x1b[0m',
        '',
        '\x1b[38;5;245m  ─────────────────────\x1b[0m',
        `\x1b[38;5;250m  ${instanceName}\x1b[0m`,
        '\x1b[38;5;245m  ─────────────────────\x1b[0m',
        '',
    ]
    banner.forEach(line => terminal.writeln(line))
    
    // 移动端提示使用英文键盘
    if (isMobileDevice) {
        terminal.writeln(`\x1b[38;5;214m  ⚠ ${t('terminal.mobileKeyboardHint')}\x1b[0m`)
        terminal.writeln('')
    }
}

// 重连时的提示信息
function printReconnectMessage(terminal: Terminal) {
    terminal.write('\r\n\r\n\x1b[38;5;245m─── \x1b[38;5;214mReconnecting...\x1b[38;5;245m ───\x1b[0m\r\n\r\n')
}

function getConnectionModeLabel(mode: 'exec' | 'console' | null | undefined): string {
    if (mode === 'console') return t('terminal.modeConsole')
    if (mode === 'exec') return t('terminal.modeExec')
    return t('terminal.modeUnknown')
}

function maybePrintConsoleFallbackWarning(tab: TerminalTab) {
    if (!tab.terminal || tab.connectionMode !== 'console' || tab.consoleWarningShown) return

    tab.terminal.writeln('')
    tab.terminal.writeln(`\x1b[33m⚠ ${t('terminal.consoleFallback')}\x1b[0m`)
    tab.terminal.writeln(`\x1b[90m${t('terminal.consoleFallbackHint')}\x1b[0m`)
    tab.terminal.writeln('')
    tab.consoleWarningShown = true
}

// 带重连提示的连接函数（用于用户主动重连或自动重连）
function reconnectTab(tabId: string) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    
    // 如果已经在连接中，不重复操作
    if (tab.status === 'connecting' || tab.status === 'reconnecting') return
    
    // 输出重连提示
    if (tab.terminal) {
        printReconnectMessage(tab.terminal)
    }
    
    void connectTab(tabId)
}

// 初始化标签的终端
function initTabTerminal(tabId: string) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    
    const container = containerRefs.value.get(tabId)
    if (!container) return
    
    tab.container = container
    
    const runtime = createTerminalRuntime({
        container,
        fontSize: fontSize.value,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
        theme: terminalStore.currentTheme,
        isMobileDevice,
        enableWebgl: false,
        onBell: () => terminalStore.playBell(),
        onSelectionCopy: (selection) => {
            if (terminalStore.autoCopyOnSelect) {
                navigator.clipboard.writeText(selection).catch(() => {
                    // ignore
                })
            }
        },
        onLinkHover: (event, uri) => {
            if (terminalStore.linkPreview) {
                linkTooltip.visible = true
                linkTooltip.url = uri
                linkTooltip.x = event.clientX + 10
                linkTooltip.y = event.clientY + 10
            }
        },
        onLinkLeave: () => {
            linkTooltip.visible = false
        }
    })

    tab.terminal = runtime.terminal
    tab.fitAddon = runtime.fitAddon
    tab.searchAddon = runtime.searchAddon
    tab.unicodeAddon = runtime.unicodeAddon
    tab.webglAddon = runtime.webglAddon
    tab.serializeAddon = runtime.serializeAddon
    tab.clipboardAddon = runtime.clipboardAddon
    tab.isWebGLEnabled = runtime.isWebGLEnabled
    
    // 输出欢迎信息（首次创建时）
    printWelcomeBanner(runtime.terminal, props.instanceName || `Instance #${props.instanceId}`)
    
    // 检查 Cloud-init 状态后再连接
    checkCloudInitAndConnect(tabId)
}

// 检查 Cloud-init 状态并连接
async function checkCloudInitAndConnect(tabId: string) {
    if (!props.instanceId) return
    
    // 如果已经检查过且结果是 ready 或 skipped，直接连接
    if (cloudInitStatus.value === 'ready' || cloudInitStatus.value === 'skipped') {
        connectTab(tabId)
        return
    }
    
    cloudInitStatus.value = 'checking'
    cloudInitChecking.value = true
    
    try {
        const result = await api.instances.checkCloudInitStatus(props.instanceId) as CloudInitStatusResponse
        cloudInitState.value = result.state
        if (result.ready) {
            cloudInitStatus.value = 'ready'
            connectTab(tabId)
        } else {
            cloudInitStatus.value = 'not_ready'
            // 终端显示提示信息
            const tab = tabs.value.find(t => t.id === tabId)
            if (tab?.terminal) {
                tab.terminal.writeln('')
                tab.terminal.writeln('\x1b[33m⚠ ' + cloudInitPromptTitle.value + '\x1b[0m')
                tab.terminal.writeln('\x1b[90m' + cloudInitPromptHint.value + '\x1b[0m')
                tab.terminal.writeln('')
            }
        }
    } catch (err) {
        console.error('[CloudInit] Check failed:', err)
        cloudInitState.value = 'unknown'
        cloudInitStatus.value = 'not_ready'
    } finally {
        cloudInitChecking.value = false
    }
}

// 重新检查 Cloud-init 状态
async function retryCloudInitCheck() {
    if (!activeTabId.value) return
    await checkCloudInitAndConnect(activeTabId.value)
}

// 跳过 Cloud-init 检查并连接
function skipCloudInitAndConnect() {
    if (!activeTabId.value) return
    cloudInitStatus.value = 'skipped'
    connectTab(activeTabId.value)
}

async function manualCompleteCloudInitAndConnect() {
    if (!props.instanceId || !activeTabId.value) return

    cloudInitManualCompleting.value = true
    try {
        const result = await api.instances.manualCompleteCloudInit(props.instanceId) as CloudInitStatusResponse
        cloudInitState.value = result.state
        cloudInitStatus.value = 'ready'
        emit('cloud-init-manual-complete')
        toast.success(t('terminal.cloudInitManualCompleteSuccess'))
        connectTab(activeTabId.value)
    } catch (err: any) {
        toast.error(err?.message || t('common.operationFailed'))
    } finally {
        cloudInitManualCompleting.value = false
    }
}

// 连接标签到终端服务器
async function connectTab(tabId: string) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab || !props.instanceId) return
    
    const token = authStore.token
    if (!token) {
        tab.status = 'error'
        tab.error = 'Authentication required'
        return
    }
    
    if (tab.ws && (tab.ws.readyState === WebSocket.OPEN || tab.ws.readyState === WebSocket.CONNECTING)) {
        return
    }
    
    tab.status = 'connecting'
    tab.error = null
    tab.connectAttempt += 1
    const connectAttempt = tab.connectAttempt
    
    try {
        const ticketResponse = await api.instances.createTerminalTicket(props.instanceId)
        const currentTab = tabs.value.find(t => t.id === tabId)
        if (!currentTab || currentTab.connectAttempt !== connectAttempt) {
            return
        }

        const wsUrl = buildTerminalWebSocketUrl(props.instanceId, ticketResponse.ticket)
        const ws = new WebSocket(wsUrl)
        // 使用 arraybuffer 确保二进制数据按顺序处理（避免 Blob 异步导致的乱序）
        ws.binaryType = 'arraybuffer'
        currentTab.ws = ws
        
        ws.onopen = () => {
            console.log(`[Terminal Tab ${tabId}] WebSocket connected`)
        }
        
        ws.onmessage = (event) => {
            handleTerminalSocketPayload(event.data, () => tab.terminal, (message) => {
                handleControlMessage(tabId, message)
            })
        }
        
        ws.onerror = () => {
            currentTab.error = 'Connection error'
        }
        
        ws.onclose = (event) => {
            // 只有当这个 ws 仍然是当前标签的 ws 时才更新状态，避免快速重连时的竞态条件
            if (currentTab.ws !== ws) return

            console.log(`[Terminal Tab ${tabId}] WebSocket closed:`, event.code)

            // 意外断开时自动重连
            if (shouldRetryTerminalClose(event.code) && (currentTab.status === 'connected' || currentTab.status === 'connecting' || currentTab.status === 'reconnecting')) {
                const attempts = reconnectAttempts.value.get(tabId) || 0
                if (attempts < TERMINAL_MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts.value.set(tabId, attempts + 1)
                    currentTab.status = 'reconnecting'
                    // 线性退避：1秒, 3秒, 5秒... 最多 15秒
                    const delay = Math.min(1000 + attempts * 2000, 15000)
                    console.log(`[Terminal Tab ${tabId}] Auto reconnecting in ${delay}ms (attempt ${attempts + 1}/${TERMINAL_MAX_RECONNECT_ATTEMPTS})`)
                    const existingTimer = reconnectTimers.value.get(tabId)
                    if (existingTimer) {
                        clearTimeout(existingTimer)
                    }
                    const timer = setTimeout(() => {
                        reconnectTimers.value.delete(tabId)
                        if (currentTab.terminal) {
                            printReconnectMessage(currentTab.terminal)
                        }
                        void connectTab(tabId)
                    }, delay)
                    reconnectTimers.value.set(tabId, timer)
                } else {
                    currentTab.status = 'error'
                    currentTab.error = 'Connection lost'
                    reconnectAttempts.value.delete(tabId)
                }
            } else {
                currentTab.status = 'disconnected'
            }
        }
        
        // 绑定终端输入
        if (currentTab.terminal && !currentTab.eventsBound) {
            currentTab.eventsBound = true
            
            currentTab.terminal.onData((data) => {
                if (currentTab.ws && currentTab.ws.readyState === WebSocket.OPEN) {
                    try {
                        currentTab.ws.send(data)
                    } catch {
                        // WebSocket may be closed during send, ignore
                    }
                }
            })
            
            currentTab.terminal.onResize(({ cols, rows }) => {
                sendResize(tabId, cols, rows)
            })
        }
    } catch (err) {
        const currentTab = tabs.value.find(t => t.id === tabId)
        if (!currentTab || currentTab.connectAttempt !== connectAttempt) {
            return
        }

        currentTab.status = 'error'
        currentTab.error = err instanceof Error ? err.message : 'Failed to connect'
    }
}

// 处理控制消息
function handleControlMessage(tabId: string, message: { type: string; sessionId?: string; message?: string; reason?: string; mode?: 'exec' | 'console' }) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    
    switch (message.type) {
        case 'connected':
            tab.status = 'connected'
            tab.error = null
            if (message.mode) {
                tab.connectionMode = message.mode
                if (message.mode !== 'console') {
                    tab.consoleWarningShown = false
                }
            }
            // 连接成功，重置重连计数
            reconnectAttempts.value.delete(tabId)
            if (tab.terminal && tab.fitAddon) {
                tab.fitAddon.fit()
                sendResize(tabId, tab.terminal.cols, tab.terminal.rows)
            }
            maybePrintConsoleFallbackWarning(tab)
            break
        case 'reconnecting':
            tab.status = 'reconnecting'
            tab.error = message.reason || null
            if (message.mode) {
                tab.connectionMode = message.mode
            }
            break
        case 'disconnected':
            tab.status = 'disconnected'
            tab.error = message.reason || null
            break
        case 'error':
            tab.status = 'error'
            tab.error = message.message || 'Unknown error'
            if (tab.terminal) {
                tab.terminal.write(`\r\n\x1b[31mError: ${message.message}\x1b[0m\r\n`)
            }
            break
    }
}

// 发送调整大小命令
function sendResize(tabId: string, cols: number, rows: number) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab?.ws && tab.ws.readyState === WebSocket.OPEN) {
        try {
            tab.ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        } catch {
            // WebSocket may be closed during send, ignore
        }
    }
}

// 关闭模态框
function closeModal() {
    showSavedCommandsMobile.value = false
    emit('update:visible', false)
    emit('close')
    emit('update:connected', hasConnectedTab.value)
    emit('update:sessionActive', tabs.value.length > 0)
}

// 断开所有连接
function disconnectAll() {
    showSavedCommandsMobile.value = false
    // 清理所有重连定时器
    reconnectTimers.value.forEach(timer => clearTimeout(timer))
    reconnectTimers.value.clear()
    reconnectAttempts.value.clear()
    
    tabs.value.forEach(tab => {
        if (tab.ws) {
            tab.ws.close(1000, 'User disconnect')
            tab.ws = null
        }
        disposeTerminalRuntime(tab)
    })
    tabs.value = []
    containerRefs.value.clear()
    
    // 重置 Cloud-init 状态
    cloudInitStatus.value = 'idle'
    cloudInitState.value = null
    cloudInitChecking.value = false
    cloudInitManualCompleting.value = false
    
    emit('update:tabCount', 0)
}

// 切换全屏
function toggleFullscreen() {
    isFullscreen.value = !isFullscreen.value
    setTimeout(() => {
        const tab = activeTab.value
        if (tab?.fitAddon) {
            tab.fitAddon.fit()
            requestAnimationFrame(() => tab.fitAddon?.fit())
        }
    }, 50)
}

// 处理窗口大小变化
function handleResize() {
    if (props.visible) {
        const tab = activeTab.value
        if (tab?.fitAddon) {
            tab.fitAddon.fit()
        }
    }
}

// 设置字体大小
function updateFontSize(size: number) {
    terminalStore.setFontSize(size)
    tabs.value.forEach(tab => {
        if (tab.terminal) {
            tab.terminal.options.fontSize = size
            tab.fitAddon?.fit()
        }
    })
}

// 切换终端主题
function handleThemeChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value as 'dark' | 'light' | 'highContrast'
    terminalStore.setTheme(value)
    // 更新所有终端的主题
    tabs.value.forEach(tab => {
        if (tab.terminal) {
            tab.terminal.options.theme = terminalStore.currentTheme
        }
    })
}

// 清空当前终端
function clearTerminal() {
    activeTab.value?.terminal?.clear()
}

// 聚焦当前终端
function focusTerminal() {
    activeTab.value?.terminal?.focus()
}

// 搜索功能
function handleSearch() {
    if (searchText.value && activeTab.value?.searchAddon) {
        activeTab.value.searchAddon.findNext(searchText.value)
    }
}

function handleSearchPrevious() {
    if (searchText.value && activeTab.value?.searchAddon) {
        activeTab.value.searchAddon.findPrevious(searchText.value)
    }
}

function closeSearch() {
    showSearch.value = false
    searchText.value = ''
    focusTerminal()
}

// 右键菜单
function handleContextMenu(e: MouseEvent) {
    e.preventDefault()
    contextMenu.x = e.clientX
    contextMenu.y = e.clientY
    contextMenu.visible = true
}

function closeContextMenu() {
    contextMenu.visible = false
}

// 复制粘贴
async function handleCopy() {
    const tab = activeTab.value
    if (!tab?.terminal) return
    
    const selection = tab.terminal.getSelection()
    if (!selection) return
    
    try {
        await navigator.clipboard.writeText(selection)
    } catch {
        // 回退方案
        const textarea = document.createElement('textarea')
        textarea.value = selection
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
    }
}

async function handlePaste() {
    const tab = activeTab.value
    if (!tab?.ws || tab.ws.readyState !== WebSocket.OPEN) return
    
    try {
        const text = await navigator.clipboard.readText()
        if (text) {
            try {
                tab.ws.send(text)
            } catch {
                // WebSocket may be closed during send, ignore
            }
        }
    } catch {
        // Clipboard API may not be available, ignore
    }
}

function sendToActiveTerminal(data: string): boolean {
    const tab = activeTab.value
    if (!tab?.ws || tab.ws.readyState !== WebSocket.OPEN) return false

    try {
        tab.ws.send(data)
        return true
    } catch {
        return false
    }
}

// 移动端快捷工具栏 - 发送数据
function handleAccessorySend(data: string) {
    sendToActiveTerminal(data)
}

function executeSavedCommand(command: string) {
    const payload = command.endsWith('\n') || command.endsWith('\r')
        ? command
        : `${command}\r`
    sendToActiveTerminal(payload)
}

// 移动端快捷工具栏 - 收起键盘
function handleHideKeyboard() {
    // 尝试收起虚拟键盘
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
    }
    // 重新聚焦终端（但不弹出键盘）
    setTimeout(() => {
        activeTab.value?.terminal?.focus()
    }, 100)
}

// 全选终端内容
function handleSelectAll() {
    activeTab.value?.terminal?.selectAll()
}

// 去除 ANSI 转义序列（颜色控制码等）
// 使用 RegExp 构造函数避免 ESLint 报错
function stripAnsiSequences(text: string): string {
    const ansiRegex = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[a-zA-Z]', 'g')
    return text.replace(ansiRegex, '')
}

// 导出终端日志
function exportTerminalLog() {
    const tab = activeTab.value
    if (!tab?.serializeAddon) return
    
    try {
        const raw = tab.serializeAddon.serialize()
        if (!raw) return
        
        // 去除 ANSI 转义序列，避免在记事本中显示为方框
        const content = stripAnsiSequences(raw)
        
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `terminal-${props.instanceName || 'instance'}-${Date.now()}.log`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    } catch (err) {
        console.error('[Terminal] Failed to export log:', err)
    }
}

// 增大字体
function increaseFontSize() {
    const newSize = Math.min(fontSize.value + 2, 32)
    updateFontSize(newSize)
}

// 减小字体
function decreaseFontSize() {
    const newSize = Math.max(fontSize.value - 2, 8)
    updateFontSize(newSize)
}

// 重置字体大小
function resetFontSize() {
    updateFontSize(14)
}

// 触控手势处理
function handleTouchStart(event: TouchEvent) {
    if (!terminalStore.touchEnabled) return
    if (event.touches.length === 2) {
        event.preventDefault()
        touchState.isZooming = true
        touchState.initialDistance = getTouchDistance(event.touches)
        touchState.initialFontSize = terminalStore.fontSize
    }
}

function handleTouchMove(event: TouchEvent) {
    if (!terminalStore.touchEnabled || !touchState.isZooming) return
    if (event.touches.length === 2) {
        event.preventDefault()
        const currentDistance = getTouchDistance(event.touches)
        // 防止除以零
        if (touchState.initialDistance <= 0) return
        const scale = currentDistance / touchState.initialDistance
        const newSize = Math.round(touchState.initialFontSize * scale)
        const clampedSize = Math.max(8, Math.min(32, newSize))
        if (clampedSize !== terminalStore.fontSize) {
            updateFontSize(clampedSize)
        }
    }
}

function handleTouchEnd() {
    touchState.isZooming = false
}

function getTouchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
}

// 键盘快捷键
function handleKeydown(e: KeyboardEvent) {
    if (!props.visible) return
    
    // Ctrl+Shift+F 打开搜索
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        showSearch.value = true
        nextTick(() => searchInputRef.value?.focus())
        return
    }
    
    // Ctrl+Shift+C 复制
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        handleCopy()
        return
    }
    
    // Ctrl+Shift+V 粘贴
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        handlePaste()
        return
    }
    
    // Ctrl+Shift+T 新建标签
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        if (tabs.value.length < MAX_TABS) {
            addTab()
        }
        return
    }
    
    // Ctrl+Shift+W 关闭当前标签
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        if (activeTabId.value) {
            closeTab(activeTabId.value)
        }
        return
    }
    
    // Ctrl+= 或 Ctrl++ 增大字体
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        increaseFontSize()
        return
    }
    
    // Ctrl+- 减小字体
    if (e.ctrlKey && e.key === '-') {
        e.preventDefault()
        decreaseFontSize()
        return
    }
    
    // Ctrl+0 重置字体
    if (e.ctrlKey && e.key === '0') {
        e.preventDefault()
        resetFontSize()
        return
    }
    
    // Ctrl+Shift+S 导出日志
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        exportTerminalLog()
        return
    }
    
    // Escape 退出
    if (e.key === 'Escape') {
        if (contextMenu.visible) {
            closeContextMenu()
        } else if (showSearch.value) {
            closeSearch()
        } else if (isFullscreen.value) {
            isFullscreen.value = false
            setTimeout(() => activeTab.value?.fitAddon?.fit(), 50)
        } else {
            closeModal()
        }
    }
}

// 设置容器引用
function setContainerRef(tabId: string, el: HTMLElement | null) {
    if (el) {
        containerRefs.value.set(tabId, el)
    }
}

// 监听 visible 变化
watch(() => props.visible, async (visible) => {
    if (visible && props.instanceId) {
        // 重置 Cloud-init 状态（每次打开模态框时重新检查）
        cloudInitStatus.value = 'idle'
        cloudInitState.value = null
        cloudInitChecking.value = false
        cloudInitManualCompleting.value = false
        
        await nextTick()
        
        // 如果没有标签，创建第一个
        if (tabs.value.length === 0) {
            addTab()
        } else {
            // 刷新所有标签并自动重连断开的连接
            tabs.value.forEach(tab => {
                if (tab.terminal && tab.fitAddon) {
                    tab.fitAddon.fit()
                    tab.terminal.refresh(0, tab.terminal.rows - 1)
                }
                
                // 自动重连断开的连接
                if (tab.status === 'disconnected' || tab.status === 'error') {
                    reconnectTab(tab.id)
                }
            })
            
            // 聚焦当前标签
            setTimeout(() => {
                activeTab.value?.terminal?.focus()
            }, 50)
        }
    }
}, { immediate: true })

// 监听连接状态变化
watch(() => hasConnectedTab.value, (connected) => {
    emit('update:connected', connected)
})

// 监听强制断开
watch(() => props.forceDisconnect, (force) => {
    if (force) {
        disconnectAll()
        emit('update:forceDisconnect', false)
    }
})

onMounted(() => {
    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleKeydown)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // 移动端：监听 visualViewport 变化（软键盘弹出/收起）
    if (isMobileDevice && window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportResize)
    }
})

onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('keydown', handleKeydown)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    
    // 移动端：移除 visualViewport 监听
    if (isMobileDevice && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportResize)
    }
    
    disconnectAll()
})

// 移动端 visualViewport 变化处理（软键盘弹出/收起）
function handleViewportResize() {
    if (props.visible) {
        // 延迟执行 fit，等待视口稳定
        setTimeout(() => {
            const tab = activeTab.value
            if (tab?.fitAddon && tab.terminal) {
                tab.fitAddon.fit()
                // 刷新终端显示，确保光标正确渲染
                tab.terminal.refresh(0, tab.terminal.rows - 1)
            }
        }, 100)
    }
}

// 页面可见性变化时自动重连
function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && props.visible && props.instanceId) {
        // 用户回来了，自动重连断开的连接
        tabs.value.forEach(tab => {
            if (tab.status === 'disconnected' || tab.status === 'error') {
                console.log(`[Terminal Tab ${tab.id}] Page visible, auto reconnecting...`)
                reconnectTab(tab.id)
            }
        })
    }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-show="visible"
      class="fixed inset-0 z-50 flex items-center justify-center"
      :class="isFullscreen ? '' : 'p-4'"
    >
      <!-- 背景遮罩 -->
      <div
        class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        :class="visible ? 'opacity-100' : 'opacity-0'"
        @click="closeModal"
      />

      <!-- 终端容器 -->
      <div
        class="terminal-window group/terminal-workspace relative flex flex-col overflow-hidden"
        :class="[
          isFullscreen ? 'w-full h-full' : 'w-full max-w-7xl h-[85vh] rounded-lg',
          'bg-[#0a0a0a] border border-neutral-800 shadow-2xl'
        ]"
      >
        <!-- 标题栏 -->
        <div class="flex items-center justify-between h-10 px-3 bg-[#0a0a0a] border-b border-neutral-800">
          <!-- 标签栏 -->
          <div class="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="group flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap"
              :class="activeTabId === tab.id 
                ? 'bg-neutral-800 text-white' 
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'"
              @click="switchTab(tab.id)"
            >
              <!-- 状态指示点 -->
              <span
                class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                :class="{
                  'bg-emerald-400': tab.status === 'connected',
                  'bg-yellow-400 animate-pulse': tab.status === 'connecting' || tab.status === 'reconnecting',
                  'bg-red-400': tab.status === 'error',
                  'bg-orange-400': tab.status === 'disconnected'
                }"
              />
              <span class="truncate max-w-[80px]">{{ tab.label }}</span>
              <!-- 关闭按钮 -->
              <button
                v-if="tabs.length > 1"
                class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-neutral-700 transition-opacity"
                @click.stop="closeTab(tab.id)"
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </button>
            
            <!-- 新建标签按钮 -->
            <button
              v-if="tabs.length < MAX_TABS"
              class="flex items-center justify-center w-6 h-6 text-neutral-500 hover:text-white hover:bg-neutral-800 rounded transition-colors"
              :title="t('terminal.newTab')"
              @click="addTab"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <!-- 右侧工具按钮 -->
          <div class="flex items-center gap-1.5 ml-2">
            <!-- 状态 -->
            <span
              v-if="activeTab"
              class="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full"
              :class="{
                'bg-emerald-500/10 text-emerald-400': activeTab.status === 'connected',
                'bg-yellow-500/10 text-yellow-400': activeTab.status === 'connecting' || activeTab.status === 'reconnecting',
                'bg-red-500/10 text-red-400': activeTab.status === 'error',
                'bg-orange-500/10 text-orange-400 border border-orange-500/30': activeTab.status === 'disconnected'
              }"
            >
              <!-- 断开状态图标 -->
              <svg v-if="activeTab.status === 'disconnected'" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
              </svg>
              {{ statusText }}
            </span>
            <span
              v-if="activeTab?.connectionMode"
              class="hidden sm:inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-neutral-800 text-neutral-300"
            >
              {{ getConnectionModeLabel(activeTab.connectionMode) }}
            </span>

            <!-- 字体大小 -->
            <select
              :value="fontSize"
              class="h-6 px-1.5 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-300 cursor-pointer hover:border-neutral-500 transition-colors"
              @change="updateFontSize(Number(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="size in fontSizeOptions" :key="size" :value="size">{{ size }}px</option>
            </select>

            <!-- 清空 -->
            <button
              class="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
              :title="t('terminal.clear')"
              @click="clearTerminal"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>

            <!-- 导出日志 -->
            <button
              class="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
              :title="t('terminal.exportLog')"
              @click="exportTerminalLog"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>

            <!-- 设置 -->
            <button
              class="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
              :title="t('terminal.settings')"
              @click="showSettings = true"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <!-- 帮助 -->
            <button
              class="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
              :title="t('terminal.help')"
              @click="showHelp = true"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>

            <!-- 全屏 -->
            <button
              class="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
              :title="isFullscreen ? t('terminal.exitFullscreen') : t('terminal.fullscreen')"
              @click="toggleFullscreen"
            >
              <svg v-if="!isFullscreen" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
              </svg>
              <svg v-else class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            </button>

            <!-- 重连 -->
            <button
              v-if="activeTab && (activeTab.status === 'disconnected' || activeTab.status === 'error')"
              class="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
              :title="t('terminal.reconnect')"
              @click="reconnectTab(activeTabId)"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            <!-- 关闭 -->
            <button
              class="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
              :title="t('common.close')"
              @click="closeModal"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 终端区域 -->
        <div class="terminal-body group/terminal-workspace flex flex-1 overflow-hidden">
          <div class="relative min-w-0 flex-1 overflow-hidden">
            <!-- 搜索框 -->
            <Transition name="fade">
              <div
                v-if="showSearch"
                class="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl"
              >
                <input
                  ref="searchInputRef"
                  v-model="searchText"
                  type="text"
                  class="w-44 px-2 py-1 text-sm bg-neutral-800 border border-neutral-600 rounded text-white placeholder-neutral-500 focus:border-neutral-400 focus:outline-none"
                  :placeholder="t('terminal.searchPlaceholder')"
                  @keydown.enter.exact="handleSearch"
                  @keydown.shift.enter.exact="handleSearchPrevious"
                  @keydown.escape="closeSearch"
                >
                <button class="p-1.5 text-neutral-400 hover:text-white rounded transition-colors" @click="handleSearchPrevious">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
                </button>
                <button class="p-1.5 text-neutral-400 hover:text-white rounded transition-colors" @click="handleSearch">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                </button>
                <button class="p-1.5 text-neutral-400 hover:text-white rounded transition-colors" @click="closeSearch">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </Transition>

            <!-- 终端容器（每个标签一个） -->
            <div
              v-for="tab in tabs"
              :key="tab.id"
              :ref="(el) => setContainerRef(tab.id, el as HTMLElement)"
              class="terminal-container"
              :class="activeTabId === tab.id ? 'visible' : 'invisible absolute'"
              @contextmenu="handleContextMenu"
              @touchstart="handleTouchStart"
              @touchmove="handleTouchMove"
              @touchend="handleTouchEnd"
            />

            <!-- 连接中遮罩 -->
            <Transition name="fade">
              <div
                v-if="activeTab && (activeTab.status === 'connecting' || activeTab.status === 'reconnecting')"
                class="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/95"
              >
                <div class="flex flex-col items-center gap-4">
                  <div class="w-8 h-8 border-2 border-neutral-600 border-t-white rounded-full animate-spin" />
                  <span class="text-sm text-neutral-400">{{ statusText }}</span>
                </div>
              </div>
            </Transition>

            <!-- Cloud-init 检查中遮罩 -->
            <Transition name="fade">
              <div
                v-if="cloudInitStatus === 'checking'"
                class="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/95"
              >
                <div class="flex flex-col items-center gap-4">
                  <div class="w-8 h-8 border-2 border-neutral-600 border-t-white rounded-full animate-spin" />
                  <span class="text-sm text-neutral-400">{{ t('terminal.cloudInitChecking') }}</span>
                </div>
              </div>
            </Transition>

            <!-- Cloud-init 未完成提示 -->
            <Transition name="fade">
              <div
                v-if="cloudInitStatus === 'not_ready'"
                class="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/95"
              >
                <div class="flex flex-col items-center gap-4 text-center px-6 max-w-md">
                  <div class="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center">
                    <svg class="w-6 h-6 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p class="text-white font-medium">{{ cloudInitPromptTitle }}</p>
                    <p class="text-sm text-neutral-400 mt-1">{{ cloudInitPromptHint }}</p>
                  </div>
                  <div class="flex flex-wrap justify-center gap-3">
                    <button
                      class="px-4 py-2 text-sm font-medium bg-white text-black rounded-lg hover:bg-neutral-200 transition-colors"
                      :disabled="cloudInitChecking || cloudInitManualCompleting"
                      @click="retryCloudInitCheck"
                    >
                      <span v-if="cloudInitChecking" class="flex items-center gap-2">
                        <div class="w-3 h-3 border border-black border-t-transparent rounded-full animate-spin" />
                        {{ t('terminal.cloudInitChecking') }}
                      </span>
                      <span v-else>{{ t('terminal.cloudInitRetry') }}</span>
                    </button>
                    <button
                      class="px-4 py-2 text-sm font-medium bg-neutral-800 text-neutral-300 rounded-lg hover:bg-neutral-700 transition-colors"
                      :disabled="cloudInitManualCompleting"
                      @click="skipCloudInitAndConnect"
                    >
                      {{ t('terminal.cloudInitSkip') }}
                    </button>
                    <button
                      v-if="showManualCloudInitComplete"
                      class="px-4 py-2 text-sm font-medium bg-amber-700 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
                      :disabled="cloudInitChecking || cloudInitManualCompleting"
                      @click="manualCompleteCloudInitAndConnect"
                    >
                      <span v-if="cloudInitManualCompleting" class="flex items-center gap-2">
                        <div class="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                        {{ t('terminal.cloudInitManualComplete') }}
                      </span>
                      <span v-else>{{ t('terminal.cloudInitManualComplete') }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </Transition>

            <!-- 错误提示 -->
            <Transition name="fade">
              <div
                v-if="activeTab && activeTab.status === 'error'"
                class="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/95"
              >
                <div class="flex flex-col items-center gap-4 text-center px-6">
                  <div class="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                    <svg class="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <p class="text-white font-medium">{{ t('terminal.connectionFailed') }}</p>
                    <p class="text-sm text-neutral-400 mt-1">{{ activeTab.error }}</p>
                  </div>
                  <button
                    class="px-4 py-2 text-sm font-medium bg-white text-black rounded-lg hover:bg-neutral-200 transition-colors"
                    @click="reconnectTab(activeTabId)"
                  >
                    {{ t('terminal.reconnect') }}
                  </button>
                </div>
              </div>
            </Transition>
          </div>

          <TerminalSavedCommandsSidebar
            v-if="!isMobileDevice"
            :connected="activeTab?.status === 'connected'"
            @execute="executeSavedCommand"
          />
        </div>

        <!-- 移动端快捷工具栏 -->
        <TerminalAccessoryBar
          v-if="isMobileDevice && tabs.length > 0"
          :connected="activeTab?.status === 'connected'"
          @send="handleAccessorySend"
          @paste="handlePaste"
          @hide-keyboard="handleHideKeyboard"
          @saved-commands="showSavedCommandsMobile = true"
        />

        <TerminalSavedCommandsSidebar
          v-if="isMobileDevice"
          mobile
          :visible="showSavedCommandsMobile"
          :connected="activeTab?.status === 'connected'"
          @execute="executeSavedCommand"
          @close="showSavedCommandsMobile = false"
        />
      </div>

      <!-- 右键菜单 -->
      <TerminalContextMenu
        :visible="contextMenu.visible"
        :x="contextMenu.x"
        :y="contextMenu.y"
        :has-selection="!!activeTab?.terminal?.hasSelection()"
        :can-paste="activeTab?.status === 'connected'"
        @close="closeContextMenu"
        @copy="handleCopy"
        @paste="handlePaste"
        @select-all="handleSelectAll"
        @clear="clearTerminal"
      />

      <!-- 链接预览 Tooltip -->
      <Teleport to="body">
        <Transition name="fade">
          <div
            v-if="linkTooltip.visible"
            class="fixed z-[9999] px-2 py-1 text-xs bg-neutral-800 border border-neutral-600 rounded shadow-lg text-neutral-200 max-w-xs truncate pointer-events-none"
            :style="{ left: linkTooltip.x + 'px', top: linkTooltip.y + 'px' }"
          >
            {{ linkTooltip.url }}
          </div>
        </Transition>
      </Teleport>

      <!-- 帮助弹窗 -->
      <Transition name="fade">
        <div
          v-if="showHelp"
          class="absolute inset-0 z-50 flex items-center justify-center bg-black/80"
          @click.self="showHelp = false"
        >
          <div class="bg-neutral-900 border border-neutral-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-medium text-white">{{ t('terminal.helpTitle') }}</h3>
              <button
                class="p-1 text-neutral-400 hover:text-white rounded transition-colors"
                @click="showHelp = false"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <!-- 快捷键 -->
            <div class="mb-4">
              <h4 class="text-sm font-medium text-neutral-300 mb-2">{{ t('terminal.helpShortcuts') }}</h4>
              <div class="space-y-1.5 text-sm">
                <div class="flex justify-between"><span class="text-neutral-400">{{ t('terminal.helpShortcutSearch') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300 text-xs">Ctrl+Shift+F</kbd></div>
                <div class="flex justify-between"><span class="text-neutral-400">{{ t('terminal.helpShortcutCopy') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300 text-xs">Ctrl+Shift+C</kbd></div>
                <div class="flex justify-between"><span class="text-neutral-400">{{ t('terminal.helpShortcutPaste') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300 text-xs">Ctrl+Shift+V</kbd></div>
                <div class="flex justify-between"><span class="text-neutral-400">{{ t('terminal.helpShortcutFontIncrease') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300 text-xs">Ctrl++</kbd></div>
                <div class="flex justify-between"><span class="text-neutral-400">{{ t('terminal.helpShortcutFontDecrease') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300 text-xs">Ctrl+-</kbd></div>
                <div class="flex justify-between"><span class="text-neutral-400">{{ t('terminal.helpShortcutFontReset') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300 text-xs">Ctrl+0</kbd></div>
                <div class="flex justify-between"><span class="text-neutral-400">{{ t('terminal.helpShortcutExport') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300 text-xs">Ctrl+Shift+S</kbd></div>
                <div class="flex justify-between"><span class="text-neutral-400">{{ t('terminal.helpShortcutNewTab') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300 text-xs">Ctrl+Shift+T</kbd></div>
                <div class="flex justify-between"><span class="text-neutral-400">{{ t('terminal.helpShortcutCloseTab') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300 text-xs">Ctrl+Shift+W</kbd></div>
              </div>
            </div>

            <!-- 鼠标操作 -->
            <div class="mb-4">
              <h4 class="text-sm font-medium text-neutral-300 mb-2">{{ t('terminal.helpMouseOps') }}</h4>
              <ul class="space-y-1 text-sm text-neutral-400">
                <li>• {{ t('terminal.helpMouseSelect') }}</li>
                <li>• {{ t('terminal.helpMouseCopy') }}</li>
                <li>• {{ t('terminal.helpMouseScroll') }}</li>
              </ul>
            </div>

            <!-- 触控操作 -->
            <div class="mb-4">
              <h4 class="text-sm font-medium text-neutral-300 mb-2">{{ t('terminal.helpTouchOps') }}</h4>
              <ul class="space-y-1 text-sm text-neutral-400">
                <li>• {{ t('terminal.helpTouchPinchZoom') }}</li>
                <li>• {{ t('terminal.helpTouchSwipeScroll') }}</li>
              </ul>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 设置弹窗 -->
      <Transition name="fade">
        <div
          v-if="showSettings"
          class="absolute inset-0 z-50 flex items-center justify-center bg-black/80"
          @click.self="showSettings = false"
        >
          <div class="bg-neutral-900 border border-neutral-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-medium text-white">{{ t('terminal.settings') }}</h3>
              <button
                class="p-1 text-neutral-400 hover:text-white rounded transition-colors"
                @click="showSettings = false"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="space-y-4">
              <!-- 终端铃声 -->
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-medium text-neutral-200">{{ t('terminal.settingBell') }}</div>
                  <div class="text-xs text-neutral-500">{{ t('terminal.settingBellDesc') }}</div>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-colors"
                  :class="terminalStore.bellEnabled ? 'bg-blue-600' : 'bg-neutral-700'"
                  @click="terminalStore.toggleBell()"
                >
                  <span
                    class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
                    :class="terminalStore.bellEnabled ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
              </div>

              <!-- 选中自动复制 -->
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-medium text-neutral-200">{{ t('terminal.settingAutoCopy') }}</div>
                  <div class="text-xs text-neutral-500">{{ t('terminal.settingAutoCopyDesc') }}</div>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-colors"
                  :class="terminalStore.autoCopyOnSelect ? 'bg-blue-600' : 'bg-neutral-700'"
                  @click="terminalStore.toggleAutoCopy()"
                >
                  <span
                    class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
                    :class="terminalStore.autoCopyOnSelect ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
              </div>

              <!-- 链接预览 -->
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-medium text-neutral-200">{{ t('terminal.settingLinkPreview') }}</div>
                  <div class="text-xs text-neutral-500">{{ t('terminal.settingLinkPreviewDesc') }}</div>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-colors"
                  :class="terminalStore.linkPreview ? 'bg-blue-600' : 'bg-neutral-700'"
                  @click="terminalStore.linkPreview = !terminalStore.linkPreview"
                >
                  <span
                    class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
                    :class="terminalStore.linkPreview ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
              </div>

              <!-- 触控优化 -->
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-medium text-neutral-200">{{ t('terminal.settingTouch') }}</div>
                  <div class="text-xs text-neutral-500">{{ t('terminal.settingTouchDesc') }}</div>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-colors"
                  :class="terminalStore.touchEnabled ? 'bg-blue-600' : 'bg-neutral-700'"
                  @click="terminalStore.toggleTouch()"
                >
                  <span
                    class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform"
                    :class="terminalStore.touchEnabled ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
              </div>

              <!-- 终端主题 -->
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-medium text-neutral-200">{{ t('terminal.settingTheme') }}</div>
                  <div class="text-xs text-neutral-500">{{ t('terminal.settingThemeDesc') }}</div>
                </div>
                <select
                  :value="terminalStore.theme"
                  class="px-2 py-1 text-sm bg-neutral-800 border border-neutral-600 rounded text-neutral-300"
                  @change="handleThemeChange($event)"
                >
                  <option value="dark">{{ t('terminal.themeDark') }}</option>
                  <option value="light">{{ t('terminal.themeLight') }}</option>
                  <option value="highContrast">{{ t('terminal.themeHighContrast') }}</option>
                </select>
              </div>

              <!-- 当前状态 -->
              <div class="pt-4 border-t border-neutral-700">
                <div class="text-xs text-neutral-400 mb-2">{{ t('terminal.currentStatus') }}</div>
                <div class="flex items-center gap-4 text-xs text-neutral-300">
                  <span class="flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full" :class="activeTab?.isWebGLEnabled ? 'bg-emerald-400' : 'bg-yellow-400'" />
                    {{ activeTab?.isWebGLEnabled ? 'WebGL' : 'Canvas' }}
                  </span>
                  <span v-if="networkLatency.get(activeTabId)">
                    {{ t('terminal.latency') }}: {{ networkLatency.get(activeTabId) }}ms
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.1s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.terminal-container {
  position: absolute;
  inset: 0;
}

.terminal-container.visible {
  z-index: 1;
}

.terminal-container.invisible {
  z-index: 0;
  pointer-events: none;
}

:deep(.xterm) {
  height: 100%;
  padding: 0;
}

:deep(.xterm-viewport) {
  overflow-y: auto !important;
  background-color: #0a0a0a !important;
}

:deep(.xterm-screen) {
  height: 100%;
}

/* 移动端光标修复 */
:deep(.xterm-cursor-layer) {
  /* 确保光标层可见 */
  z-index: 10;
}

:deep(.xterm-cursor) {
  /* 确保光标可见度 */
  opacity: 1 !important;
}

/* 移动端触摸优化 */
@media (hover: none) and (pointer: coarse) {
  :deep(.xterm) {
    /* 禁止移动端的默认触摸行为干扰终端 */
    touch-action: manipulation;
    -webkit-touch-callout: none;
  }
  
  :deep(.xterm-viewport) {
    /* 移动端滚动优化 */
    -webkit-overflow-scrolling: touch;
  }
  
  :deep(.xterm-cursor) {
    /* 移动端光标加强显示 */
    box-shadow: 0 0 2px 1px rgba(255, 255, 255, 0.5);
  }
}
</style>
