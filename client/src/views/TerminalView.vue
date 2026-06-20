<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SerializeAddon } from '@xterm/addon-serialize'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useTerminalStore } from '@/stores/terminal'
import TerminalSavedCommandsSidebar from '@/components/terminal/TerminalSavedCommandsSidebar.vue'
import TerminalContextMenu from '@/components/instance/TerminalContextMenu.vue'
import TerminalAccessoryBar from '@/components/instance/TerminalAccessoryBar.vue'
import FlagIcon from '@/components/FlagIcon.vue'
import {
    buildTerminalWebSocketUrl,
    createTerminalRuntime,
    disposeTerminalRuntime,
    handleTerminalSocketPayload,
    shouldRetryTerminalClose,
    TERMINAL_MAX_RECONNECT_ATTEMPTS
} from '@/lib/terminal-core'
import api from '@/api'
import type { InstanceWithDetails } from '@/types/api'
import '@xterm/xterm/css/xterm.css'

const MAX_TABS = 5  // 集中式终端页面允许更多标签

interface InstanceOption {
    id: number
    name: string
    status: string
    imageName: string
    hostCountryCode: string
    hostName?: string
    packageName?: string
}

interface TerminalTab {
    id: string
    instanceId: number
    instanceName: string
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

const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const terminalStore = useTerminalStore()

// 实例列表
const instances = ref<InstanceOption[]>([])
const loadingInstances = ref(false)

// 标签管理
const tabs = ref<TerminalTab[]>([])
const activeTabId = ref<string>('')
const containerRefs = ref<Map<string, HTMLElement>>(new Map())

// 实例选择器弹窗
const showInstanceSelector = ref(false)
const selectedInstanceId = ref<number | null>(null)
const instanceSearchQuery = ref('')
const instancePage = ref(1)
const instancePageSize = 3

// 过滤后的运行中实例
const filteredRunningInstances = computed(() => {
  const query = instanceSearchQuery.value.toLowerCase().trim()
  if (!query) return runningInstances.value
  return runningInstances.value.filter(i => 
    i.name.toLowerCase().includes(query) || 
    i.imageName.toLowerCase().includes(query)
  )
})

const selectedInstance = computed(() => {
  if (!selectedInstanceId.value) return null
  return runningInstances.value.find(instance => instance.id === selectedInstanceId.value) || null
})

// 分页后的实例列表
const paginatedInstances = computed(() => {
  const start = (instancePage.value - 1) * instancePageSize
  return filteredRunningInstances.value.slice(start, start + instancePageSize)
})

// 总页数
const instanceTotalPages = computed(() => 
  Math.ceil(filteredRunningInstances.value.length / instancePageSize) || 1
)

// 搜索状态
const searchInputRef = ref<HTMLInputElement | null>(null)
const showSearch = ref(false)
const searchText = ref('')

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

// 网络延迟检测
const networkLatency = ref<Map<string, number>>(new Map())

// 链接预览 tooltip
const linkTooltip = reactive({
    visible: false,
    x: 0,
    y: 0,
    url: ''
})

// Cloud-init 状态检查（每个标签独立）
const cloudInitStatus = ref<Map<string, 'idle' | 'checking' | 'not_ready' | 'ready' | 'skipped'>>(new Map())
const cloudInitChecking = ref<Map<string, boolean>>(new Map())

// 重连配置（更激进的保活策略）
const reconnectAttempts = ref<Map<string, number>>(new Map())
const reconnectTimers = ref<Map<string, ReturnType<typeof setTimeout>>>(new Map())

// 计算属性
const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value))
const runningInstances = computed(() => instances.value.filter(i => i.status.toLowerCase() === 'running'))

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

// 加载用户实例列表
async function loadInstances() {
    loadingInstances.value = true
    try {
        const response = await api.instances.list({ limit: 100 })
        const data = response as { instances?: Array<InstanceWithDetails & { imageName?: string; hostCountryCode?: string }>; total?: number }
        instances.value = (data.instances || []).map((i) => ({
            id: i.id,
            name: i.name || `${t('instance.title')} #${i.id}`,
            status: i.status,
            imageName: i.imageName || i.image || '',
            hostCountryCode: i.hostCountryCode || 'us',
            hostName: i.host?.name,
            packageName: i.package?.name
        }))
    } catch (err) {
        console.error('Failed to load instances:', err)
    } finally {
        loadingInstances.value = false
    }
}

// 生成唯一标签 ID
function generateTabId(): string {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
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

// 打开实例选择器
function openInstanceSelector() {
    if (tabs.value.length >= MAX_TABS) return
    selectedInstanceId.value = null
    instanceSearchQuery.value = ''
    instancePage.value = 1
    showInstanceSelector.value = true
}

// 实例搜索时重置分页
function handleInstanceSearch(query: string) {
    instanceSearchQuery.value = query
    instancePage.value = 1
    // 如果当前选中的实例不在过滤结果中，清除选择
    if (selectedInstanceId.value && !filteredRunningInstances.value.find(i => i.id === selectedInstanceId.value)) {
        selectedInstanceId.value = null
    }
}

// 确认添加实例终端
function confirmAddInstance() {
    if (!selectedInstanceId.value) return
    const instance = instances.value.find(i => i.id === selectedInstanceId.value)
    if (!instance) return
    
    showInstanceSelector.value = false
    addInstanceTab(instance.id, instance.name)
}

// 添加实例终端标签
function addInstanceTab(instanceId: number, instanceName: string) {
    if (tabs.value.length >= MAX_TABS) return
    
    const id = generateTabId()
    const tab: TerminalTab = {
        id,
        instanceId,
        instanceName,
        label: instanceName,
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
    
    tabs.value.push(tab)
    activeTabId.value = id
    
    nextTick(() => {
        initTabTerminal(id)
    })
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
    
    // 输出欢迎信息
    printWelcomeBanner(runtime.terminal, tab.instanceName)
    
    // 检查 Cloud-init 状态后再连接
    checkCloudInitAndConnect(tabId)
}

// 检查 Cloud-init 状态并连接
async function checkCloudInitAndConnect(tabId: string) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    
    // 如果已经检查过且结果是 ready 或 skipped，直接连接
    const status = cloudInitStatus.value.get(tabId)
    if (status === 'ready' || status === 'skipped') {
        connectTab(tabId)
        return
    }
    
    cloudInitStatus.value.set(tabId, 'checking')
    cloudInitChecking.value.set(tabId, true)
    
    try {
        const result = await api.instances.checkCloudInitStatus(tab.instanceId)
        if (result.ready) {
            cloudInitStatus.value.set(tabId, 'ready')
            connectTab(tabId)
        } else {
            cloudInitStatus.value.set(tabId, 'not_ready')
            // 终端显示提示信息
            if (tab.terminal) {
                tab.terminal.writeln('')
                tab.terminal.writeln('\x1b[33m⚠ ' + t('terminal.cloudInitInProgress') + '\x1b[0m')
                tab.terminal.writeln('\x1b[90m' + t('terminal.cloudInitInProgressHint') + '\x1b[0m')
                tab.terminal.writeln('')
            }
        }
    } catch (err) {
        console.error('[CloudInit] Check failed:', err)
        // 检查失败时允许继续连接
        cloudInitStatus.value.set(tabId, 'ready')
        connectTab(tabId)
    } finally {
        cloudInitChecking.value.set(tabId, false)
    }
}

// 重新检查 Cloud-init 状态
async function retryCloudInitCheck(tabId: string) {
    await checkCloudInitAndConnect(tabId)
}

// 跳过 Cloud-init 检查并连接
function skipCloudInitAndConnect(tabId: string) {
    cloudInitStatus.value.set(tabId, 'skipped')
    connectTab(tabId)
}

// 连接标签到终端服务器
async function connectTab(tabId: string) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    
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
        const ticketResponse = await api.instances.createTerminalTicket(tab.instanceId)
        const currentTab = tabs.value.find(t => t.id === tabId)
        if (!currentTab || currentTab.connectAttempt !== connectAttempt) {
            return
        }

        const wsUrl = buildTerminalWebSocketUrl(currentTab.instanceId, ticketResponse.ticket)
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
                // 检查标签是否仍然存在，防止在异步操作期间被销毁
                if (tabs.value.find(t => t.id === tabId)) {
                    sendResize(tabId, cols, rows)
                }
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

// 带重连提示的连接函数
function reconnectTab(tabId: string) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    
    if (tab.status === 'connecting' || tab.status === 'reconnecting') return
    
    if (tab.terminal) {
        printReconnectMessage(tab.terminal)
    }
    
    void connectTab(tabId)
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
                // 检查终端是否仍然存在，防止在异步操作期间被销毁
                if (tab.terminal) {
                    sendResize(tabId, tab.terminal.cols, tab.terminal.rows)
                }
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
    
    // 清理 Cloud-init 状态
    cloudInitStatus.value.delete(tabId)
    cloudInitChecking.value.delete(tabId)
    
    // 如果关闭的是当前标签，切换到其他标签
    if (activeTabId.value === tabId && tabs.value.length > 0) {
        activeTabId.value = tabs.value[Math.min(index, tabs.value.length - 1)].id
        nextTick(() => {
            const newTab = activeTab.value
            if (newTab?.terminal && newTab.fitAddon) {
                newTab.fitAddon.fit()
                newTab.terminal.refresh(0, newTab.terminal.rows - 1)
                newTab.terminal.focus()
            }
        })
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

// 清空终端
function clearTerminal() {
    const tab = activeTab.value
    if (tab?.terminal) {
        tab.terminal.clear()
    }
}

// 处理右键菜单
function handleContextMenu(event: MouseEvent) {
    event.preventDefault()
    contextMenu.x = event.clientX
    contextMenu.y = event.clientY
    contextMenu.visible = true
}

function closeContextMenu() {
    contextMenu.visible = false
}

// 复制粘贴
async function handleCopy() {
    const tab = activeTab.value
    if (!tab?.terminal) {
        closeContextMenu()
        return
    }
    
    const selection = tab.terminal.getSelection()
    if (!selection) {
        closeContextMenu()
        return
    }
    
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
    closeContextMenu()
}

async function handlePaste() {
    const tab = activeTab.value
    if (!tab?.ws || tab.ws.readyState !== WebSocket.OPEN) {
        closeContextMenu()
        return
    }
    
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
        // Clipboard API may fail due to permissions
    }
    closeContextMenu()
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

// 移动端快捷工具栏 - 粘贴（不关闭右键菜单）
async function handleAccessoryPaste() {
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
        // Clipboard API may fail due to permissions
    }
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

function handleSelectAll() {
    const tab = activeTab.value
    if (tab?.terminal) {
        tab.terminal.selectAll()
    }
    closeContextMenu()
}

// 搜索功能
function openSearch() {
    showSearch.value = true
    nextTick(() => searchInputRef.value?.focus())
}

function closeSearch() {
    showSearch.value = false
    searchText.value = ''
}

function handleSearch() {
    const tab = activeTab.value
    if (tab?.searchAddon && searchText.value) {
        tab.searchAddon.findNext(searchText.value)
    }
}

function handleSearchPrevious() {
    const tab = activeTab.value
    if (tab?.searchAddon && searchText.value) {
        tab.searchAddon.findPrevious(searchText.value)
    }
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
        a.download = `terminal-${tab.instanceName}-${Date.now()}.log`
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

// 更新字体大小
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

// 键盘快捷键
function handleKeydown(event: KeyboardEvent) {
    // Ctrl+Shift+F 搜索
    if (event.ctrlKey && event.shiftKey && event.key === 'F') {
        event.preventDefault()
        if (showSearch.value) {
            closeSearch()
        } else {
            openSearch()
        }
        return
    }
    // Ctrl+Shift+C 复制
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        handleCopy()
        return
    }
    // Ctrl+Shift+V 粘贴
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        handlePaste()
        return
    }
    // Ctrl+= 或 Ctrl++ 增大字体
    if (event.ctrlKey && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        increaseFontSize()
        return
    }
    // Ctrl+- 减小字体
    if (event.ctrlKey && event.key === '-') {
        event.preventDefault()
        decreaseFontSize()
        return
    }
    // Ctrl+0 重置字体
    if (event.ctrlKey && event.key === '0') {
        event.preventDefault()
        resetFontSize()
        return
    }
    // Ctrl+Shift+S 导出日志
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        exportTerminalLog()
        return
    }
    // Escape 关闭搜索
    if (event.key === 'Escape' && showSearch.value) {
        closeSearch()
    }
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

// 窗口大小变化
function handleResize() {
    const tab = activeTab.value
    if (tab?.fitAddon) {
        tab.fitAddon.fit()
    }
}

// 设置容器引用
function setContainerRef(tabId: string, el: HTMLElement | null) {
    if (el) {
        containerRefs.value.set(tabId, el)
    }
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
    
    // 清理 Cloud-init 状态
    cloudInitStatus.value.clear()
    cloudInitChecking.value.clear()
}

onMounted(() => {
    loadInstances()
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

// 页面可见性变化时自动重连
function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
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
  <div class="space-y-6 animate-fade-in">
    <!-- 页面头部 -->
    <div class="page-header flex-col sm:flex-row gap-4 sm:gap-0">
      <div>
        <h1 class="page-title text-lg sm:text-xl">{{ t('nav.terminal') }}</h1>
        <p class="page-description">{{ t('terminalPage.description') }}</p>
      </div>
      <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <button 
          v-if="tabs.length < MAX_TABS"
          class="btn-primary w-full sm:w-auto justify-center"
          @click="openInstanceSelector"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('terminalPage.newConnection') }}
        </button>
        <button
          v-if="isMobileDevice"
          class="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
          @click="showSavedCommandsMobile = true"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {{ t('terminal.savedCommands.title') }}
        </button>
      </div>
    </div>

    <!-- 终端窗口 -->
    <div class="rounded-lg overflow-hidden border border-neutral-800 shadow-2xl">
      <!-- 工具栏（有标签时才显示） -->
      <div 
        v-if="tabs.length > 0"
        class="flex items-center justify-between h-10 px-3 bg-[#0a0a0a] border-b border-neutral-800"
      >
        <!-- 左侧：标签栏 -->
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
            <span class="truncate max-w-[120px]">{{ tab.label }}</span>
            <!-- 关闭按钮 -->
            <button
              class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-neutral-700 transition-opacity"
              @click.stop="closeTab(tab.id)"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </button>
          
          <!-- 新建标签按钮（工具栏内） -->
          <button
            v-if="tabs.length > 0 && tabs.length < MAX_TABS"
            class="flex items-center justify-center w-6 h-6 text-neutral-500 hover:text-white hover:bg-neutral-800 rounded transition-colors"
            :title="t('terminalPage.newConnection')"
            @click="openInstanceSelector"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        <!-- 右侧工具 -->
        <div v-if="tabs.length > 0" class="flex items-center gap-1 sm:gap-1.5 ml-2 flex-shrink-0">
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

          <!-- 字体大小（移动端隐藏，可用手势缩放） -->
          <select
            :value="fontSize"
            class="hidden sm:block h-6 px-1.5 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-300 cursor-pointer hover:border-neutral-500 transition-colors"
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

          <!-- 导出日志（移动端隐藏） -->
          <button
            class="hidden sm:block p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
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

          <!-- 帮助（移动端隐藏） -->
          <button
            class="hidden sm:block p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
            :title="t('terminal.help')"
            @click="showHelp = true"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
        </div>
      </div>

      <!-- 终端区域 -->
      <div class="terminal-area group/terminal-workspace relative flex overflow-hidden">
        <div class="relative min-w-0 flex-1 overflow-hidden">
          <!-- 空状态 -->
          <div
            v-if="tabs.length === 0"
            class="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]"
          >
            <div class="text-center px-6">
              <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
                <svg class="w-8 h-8 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p class="text-neutral-400 mb-4">{{ t('terminalPage.noConnections') }}</p>
              <div class="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <button
                  class="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-neutral-200 transition-colors"
                  @click="openInstanceSelector"
                >
                  {{ t('terminalPage.newConnection') }}
                </button>
                <button
                  v-if="isMobileDevice"
                  class="px-4 py-2 rounded-lg text-sm font-medium border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800 transition-colors"
                  @click="showSavedCommandsMobile = true"
                >
                  {{ t('terminal.savedCommands.title') }}
                </button>
              </div>
            </div>
          </div>

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
            class="terminal-container bg-[#0a0a0a]"
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
              v-if="activeTab && cloudInitStatus.get(activeTab.id) === 'checking'"
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
              v-if="activeTab && cloudInitStatus.get(activeTab.id) === 'not_ready'"
              class="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/95"
            >
              <div class="flex flex-col items-center gap-4 text-center px-6 max-w-md">
                <div class="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center">
                  <svg class="w-6 h-6 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p class="text-white font-medium">{{ t('terminal.cloudInitInProgress') }}</p>
                  <p class="text-sm text-neutral-400 mt-1">{{ t('terminal.cloudInitInProgressHint') }}</p>
                </div>
                <div class="flex gap-3">
                  <button
                    class="px-4 py-2 text-sm font-medium bg-white text-black rounded-lg hover:bg-neutral-200 transition-colors"
                    :disabled="cloudInitChecking.get(activeTab.id)"
                    @click="retryCloudInitCheck(activeTab.id)"
                  >
                    <span v-if="cloudInitChecking.get(activeTab.id)" class="flex items-center gap-2">
                      <div class="w-3 h-3 border border-black border-t-transparent rounded-full animate-spin" />
                      {{ t('terminal.cloudInitChecking') }}
                    </span>
                    <span v-else>{{ t('terminal.cloudInitRetry') }}</span>
                  </button>
                  <button
                    class="px-4 py-2 text-sm font-medium bg-neutral-800 text-neutral-300 rounded-lg hover:bg-neutral-700 transition-colors"
                    @click="skipCloudInitAndConnect(activeTab.id)"
                  >
                    {{ t('terminal.cloudInitSkip') }}
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
        @paste="handleAccessoryPaste"
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

    <!-- 实例选择弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showInstanceSelector" class="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
          <div
            class="absolute inset-0 backdrop-blur-sm"
            :class="themeStore.isDark
              ? 'bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.08),transparent_28%),radial-gradient(circle_at_bottom,rgba(59,130,246,0.12),transparent_32%),rgba(3,7,18,0.74)]'
              : 'bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.10),transparent_30%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.08),transparent_34%),rgba(244,246,249,0.82)]'"
            @click="showInstanceSelector = false"
          />
          <div
            class="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-[28px] max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100vh-2rem)]"
            :class="themeStore.isDark
              ? 'border border-white/10 bg-[linear-gradient(180deg,rgba(38,38,41,0.98),rgba(26,26,29,0.98))] shadow-[0_28px_90px_rgba(0,0,0,0.58)]'
              : 'border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,248,251,0.98))] shadow-[0_28px_90px_rgba(15,23,42,0.18)]'"
          >
            <div
              class="relative overflow-hidden px-4 py-4 sm:p-6"
              :class="themeStore.isDark
                ? 'border-b border-white/8 bg-gradient-to-br from-stone-800 via-neutral-800 to-slate-900'
                : 'border-b border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.97)_58%,rgba(241,245,249,0.96)_100%)]'"
            >
              <div
                class="absolute inset-x-0 top-0 h-24"
                :class="themeStore.isDark
                  ? 'bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_55%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_50%)]'
                  : 'bg-[radial-gradient(circle_at_top_left,rgba(148,163,184,0.16),transparent_52%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_48%)]'"
              />
              <div class="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div class="space-y-3">
                  <div
                    class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
                    :class="themeStore.isDark
                      ? 'border border-emerald-400/25 bg-emerald-300/10 text-emerald-200'
                      : 'border border-emerald-500/20 bg-emerald-50 text-emerald-700'"
                  >
                    <span class="h-2 w-2 rounded-full bg-emerald-400" />
                    {{ t('terminalPage.runningCount', { count: runningInstances.length }) }}
                  </div>
                  <div>
                    <h3
                      class="text-xl font-semibold sm:text-2xl"
                      :class="themeStore.isDark ? 'text-white' : 'text-slate-900'"
                    >
                      {{ t('terminalPage.selectInstance') }}
                    </h3>
                    <p class="mt-1 text-sm" :class="themeStore.isDark ? 'text-neutral-300/90' : 'text-slate-600'">
                      {{ t('terminalPage.selectionHint') }}
                    </p>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:min-w-[360px]">
                  <div
                    class="rounded-2xl p-3 shadow-inner backdrop-blur-sm"
                    :class="themeStore.isDark
                      ? 'border border-white/10 bg-white/[0.06] shadow-black/10'
                      : 'border border-slate-200 bg-white/90 shadow-slate-200/70'"
                  >
                    <div class="text-[11px] uppercase tracking-[0.2em]" :class="themeStore.isDark ? 'text-neutral-400' : 'text-slate-500'">
                      {{ t('terminalPage.selectedInstance') }}
                    </div>
                    <div class="mt-2 truncate text-sm font-medium" :class="themeStore.isDark ? 'text-white' : 'text-slate-900'">
                      {{ selectedInstance?.name || t('common.notSet') }}
                    </div>
                    <div class="mt-1 truncate text-xs" :class="themeStore.isDark ? 'text-neutral-300/75' : 'text-slate-500'">
                      {{ selectedInstance?.imageName || t('terminalPage.selectInstance') }}
                    </div>
                  </div>
                  <div
                    class="rounded-2xl p-3 shadow-inner backdrop-blur-sm"
                    :class="themeStore.isDark
                      ? 'border border-white/10 bg-white/[0.06] shadow-black/10'
                      : 'border border-slate-200 bg-white/90 shadow-slate-200/70'"
                  >
                    <div class="text-[11px] uppercase tracking-[0.2em]" :class="themeStore.isDark ? 'text-neutral-400' : 'text-slate-500'">
                      {{ t('terminalPage.connect') }}
                    </div>
                    <div class="mt-2 text-sm font-medium" :class="themeStore.isDark ? 'text-white' : 'text-slate-900'">
                      {{ t('terminalPage.directShell') }}
                    </div>
                    <div class="mt-1 text-xs" :class="themeStore.isDark ? 'text-neutral-300/75' : 'text-slate-500'">
                      {{ t('terminalPage.directShellHint') }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="relative mt-4 sm:mt-5">
                <svg
                  class="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                  :class="themeStore.isDark ? 'text-neutral-400' : 'text-slate-400'"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  :value="instanceSearchQuery"
                  :placeholder="t('terminalPage.searchInstances')"
                  class="w-full rounded-2xl py-3 pl-11 pr-10 text-sm transition-all focus:outline-none focus:ring-2"
                  :class="themeStore.isDark
                    ? 'border border-white/10 bg-white/[0.07] text-white placeholder:text-neutral-400 focus:border-emerald-400/60 focus:ring-emerald-400/20'
                    : 'border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-emerald-500/50 focus:ring-emerald-500/15'"
                  @input="handleInstanceSearch(($event.target as HTMLInputElement).value)"
                >
                <button
                  v-if="instanceSearchQuery"
                  class="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 transition-colors"
                  :class="themeStore.isDark
                    ? 'text-neutral-400 hover:bg-white/10 hover:text-neutral-100'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'"
                  @click="handleInstanceSearch('')"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr),280px]">
              <div class="min-h-0 overflow-y-auto px-4 py-4 sm:p-5">
                <div v-if="loadingInstances" class="flex items-center justify-center py-20">
                  <div
                    class="h-8 w-8 rounded-full border-2 border-t-emerald-400 animate-spin"
                    :class="themeStore.isDark ? 'border-neutral-700' : 'border-slate-300'"
                  />
                </div>
                <div v-else-if="runningInstances.length === 0" class="flex h-full flex-col items-center justify-center text-center px-6 py-20">
                  <div
                    class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
                    :class="themeStore.isDark ? 'border border-white/10 bg-white/[0.05]' : 'border border-slate-200 bg-slate-50'"
                  >
                    <svg class="h-8 w-8" :class="themeStore.isDark ? 'text-neutral-500' : 'text-slate-400'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </div>
                  <p class="text-base font-medium" :class="themeStore.isDark ? 'text-white' : 'text-slate-900'">{{ t('terminalPage.noRunningInstances') }}</p>
                  <p class="mt-2 text-sm" :class="themeStore.isDark ? 'text-neutral-400' : 'text-slate-500'">{{ t('terminalPage.noRunningInstancesHint') }}</p>
                </div>
                <div v-else-if="filteredRunningInstances.length === 0" class="flex h-full flex-col items-center justify-center text-center px-6 py-20">
                  <div
                    class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
                    :class="themeStore.isDark ? 'border border-white/10 bg-white/[0.05]' : 'border border-slate-200 bg-slate-50'"
                  >
                    <svg class="h-8 w-8" :class="themeStore.isDark ? 'text-neutral-500' : 'text-slate-400'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <p class="text-base font-medium" :class="themeStore.isDark ? 'text-white' : 'text-slate-900'">{{ t('terminalPage.noMatchingInstances') }}</p>
                  <p class="mt-2 text-sm" :class="themeStore.isDark ? 'text-neutral-400' : 'text-slate-500'">{{ t('terminalPage.noMatchingInstancesHint') }}</p>
                </div>
                <div v-else class="space-y-2.5 sm:space-y-3">
                  <button
                    v-for="instance in paginatedInstances"
                    :key="instance.id"
                    type="button"
                    class="group w-full rounded-2xl border p-3 sm:p-4 text-left transition-all duration-200 shadow-sm"
                    :class="selectedInstanceId === instance.id
                      ? (themeStore.isDark
                        ? 'border-emerald-400/70 bg-emerald-400/10 ring-1 ring-emerald-400/35'
                        : 'border-emerald-500/40 bg-emerald-50 ring-1 ring-emerald-500/20')
                      : (themeStore.isDark
                        ? 'border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.08]'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50')"
                    @click="selectedInstanceId = instance.id"
                  >
                    <div class="flex items-start gap-3 sm:gap-4">
                      <div class="relative flex-shrink-0">
                        <div
                          class="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl sm:rounded-2xl"
                          :class="themeStore.isDark ? 'border border-white/10 bg-white/[0.05]' : 'border border-slate-200 bg-slate-50'"
                        >
                          <FlagIcon :code="instance.hostCountryCode" class="h-3.5 w-5 sm:h-4 sm:w-6" />
                        </div>
                        <span
                          class="absolute -bottom-1 -right-1 h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full border-2 bg-emerald-400"
                          :class="themeStore.isDark ? 'border-[#1f2024]' : 'border-white'"
                        />
                      </div>

                      <div class="min-w-0 flex-1">
                        <div class="flex items-start justify-between gap-2">
                          <div class="min-w-0">
                            <div class="flex items-center gap-1.5 sm:gap-2">
                              <span class="truncate text-sm font-semibold" :class="themeStore.isDark ? 'text-white' : 'text-slate-900'">{{ instance.name }}</span>
                              <span
                                class="rounded-full px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] uppercase tracking-[0.14em] sm:tracking-[0.18em]"
                                :class="themeStore.isDark
                                  ? 'border border-white/10 bg-white/[0.04] text-neutral-300'
                                  : 'border border-slate-200 bg-slate-50 text-slate-500'"
                              >
                                #{{ instance.id }}
                              </span>
                            </div>
                            <div class="mt-0.5 sm:mt-1 truncate text-xs sm:text-sm" :class="themeStore.isDark ? 'text-neutral-300/75' : 'text-slate-500'">{{ instance.imageName }}</div>
                          </div>
                          <div
                            class="mt-0.5 flex h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0 items-center justify-center rounded-full border transition-colors"
                            :class="selectedInstanceId === instance.id
                              ? (themeStore.isDark
                                ? 'border-emerald-400 bg-emerald-400 text-[#09130d]'
                                : 'border-emerald-500 bg-emerald-500 text-white')
                              : (themeStore.isDark ? 'border-white/15 text-transparent' : 'border-slate-300 text-transparent')"
                          >
                            <svg class="h-3 w-3 sm:h-3.5 sm:w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>

                        <div class="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                          <span
                            v-if="instance.hostName"
                            class="rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs leading-5"
                            :class="themeStore.isDark
                              ? 'border border-sky-400/20 bg-sky-400/10 text-sky-200'
                              : 'border border-sky-200 bg-sky-50 text-sky-700'"
                          >
                            {{ t('terminalPage.host') }}: {{ instance.hostName }}
                          </span>
                          <span
                            v-if="instance.packageName"
                            class="rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs leading-5"
                            :class="themeStore.isDark
                              ? 'border border-violet-400/20 bg-violet-400/10 text-violet-200'
                              : 'border border-violet-200 bg-violet-50 text-violet-700'"
                          >
                            {{ t('terminalPage.package') }}: {{ instance.packageName }}
                          </span>
                          <span
                            class="rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs leading-5"
                            :class="themeStore.isDark
                              ? 'border border-white/10 bg-white/[0.04] text-neutral-300/80'
                              : 'border border-slate-200 bg-slate-50 text-slate-600'"
                          >
                            {{ t('terminalPage.statusRunning') }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>

                <div
                  v-if="filteredRunningInstances.length > instancePageSize"
                  class="mt-4 flex items-center justify-between rounded-2xl border px-3.5 sm:px-4 py-2.5 sm:py-3"
                  :class="themeStore.isDark ? 'border-white/10 bg-white/[0.04]' : 'border-slate-200 bg-slate-50/90'"
                >
                  <span class="text-xs" :class="themeStore.isDark ? 'text-neutral-500' : 'text-slate-500'">
                    {{ (instancePage - 1) * instancePageSize + 1 }}-{{ Math.min(instancePage * instancePageSize, filteredRunningInstances.length) }} / {{ filteredRunningInstances.length }}
                  </span>
                  <div class="flex items-center gap-2">
                    <button
                      class="rounded-xl border px-3 py-1.5 text-xs transition-colors"
                      :class="instancePage <= 1
                        ? (themeStore.isDark
                          ? 'border-white/5 text-neutral-600 cursor-not-allowed'
                          : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed')
                        : (themeStore.isDark
                          ? 'border-white/10 text-neutral-200 hover:border-white/20 hover:bg-white/[0.05]'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100')"
                      :disabled="instancePage <= 1"
                      @click="instancePage--"
                    >
                      {{ t('common.prevPage') }}
                    </button>
                    <span class="text-sm" :class="themeStore.isDark ? 'text-white' : 'text-slate-900'">{{ instancePage }} / {{ instanceTotalPages }}</span>
                    <button
                      class="rounded-xl border px-3 py-1.5 text-xs transition-colors"
                      :class="instancePage >= instanceTotalPages
                        ? (themeStore.isDark
                          ? 'border-white/5 text-neutral-600 cursor-not-allowed'
                          : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed')
                        : (themeStore.isDark
                          ? 'border-white/10 text-neutral-200 hover:border-white/20 hover:bg-white/[0.05]'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100')"
                      :disabled="instancePage >= instanceTotalPages"
                      @click="instancePage++"
                    >
                      {{ t('common.nextPage') }}
                    </button>
                  </div>
                </div>
              </div>

              <div
                class="hidden min-h-0 overflow-y-auto p-5 lg:block"
                :class="themeStore.isDark ? 'border-l border-white/8 bg-white/[0.03]' : 'border-l border-slate-200 bg-slate-50/80'"
              >
                <div
                  class="rounded-2xl p-4"
                  :class="themeStore.isDark ? 'border border-white/10 bg-white/[0.05]' : 'border border-slate-200 bg-white'"
                >
                  <div class="text-[11px] uppercase tracking-[0.2em]" :class="themeStore.isDark ? 'text-neutral-500' : 'text-slate-500'">{{ t('terminalPage.selectedInstance') }}</div>
                  <template v-if="selectedInstance">
                    <div class="mt-4 flex items-start gap-3">
                      <div
                        class="flex h-11 w-11 items-center justify-center rounded-2xl"
                        :class="themeStore.isDark ? 'border border-white/10 bg-white/[0.05]' : 'border border-slate-200 bg-slate-50'"
                      >
                        <FlagIcon :code="selectedInstance.hostCountryCode" class="h-4 w-6" />
                      </div>
                      <div class="min-w-0">
                        <div class="truncate text-sm font-semibold" :class="themeStore.isDark ? 'text-white' : 'text-slate-900'">{{ selectedInstance.name }}</div>
                        <div class="mt-1 text-xs" :class="themeStore.isDark ? 'text-neutral-300/75' : 'text-slate-500'">{{ selectedInstance.imageName }}</div>
                      </div>
                    </div>
                    <div class="mt-4 space-y-2 text-sm">
                      <div class="flex items-center justify-between gap-3">
                        <span :class="themeStore.isDark ? 'text-neutral-500' : 'text-slate-500'">{{ t('terminalPage.host') }}</span>
                        <span class="truncate text-right" :class="themeStore.isDark ? 'text-neutral-200' : 'text-slate-900'">{{ selectedInstance.hostName || '-' }}</span>
                      </div>
                      <div class="flex items-center justify-between gap-3">
                        <span :class="themeStore.isDark ? 'text-neutral-500' : 'text-slate-500'">{{ t('terminalPage.package') }}</span>
                        <span class="truncate text-right" :class="themeStore.isDark ? 'text-neutral-200' : 'text-slate-900'">{{ selectedInstance.packageName || '-' }}</span>
                      </div>
                      <div class="flex items-center justify-between gap-3">
                        <span :class="themeStore.isDark ? 'text-neutral-500' : 'text-slate-500'">{{ t('terminalPage.instanceId') }}</span>
                        <span :class="themeStore.isDark ? 'text-neutral-200' : 'text-slate-900'">#{{ selectedInstance.id }}</span>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="mt-4 rounded-2xl border border-dashed px-4 py-10 text-center text-sm"
                      :class="themeStore.isDark ? 'border-white/10 text-neutral-500' : 'border-slate-200 text-slate-500'"
                    >
                      {{ t('terminalPage.selectionHint') }}
                    </div>
                  </template>
                </div>

                <div
                  class="mt-4 rounded-2xl p-4 text-sm"
                  :class="themeStore.isDark ? 'border border-white/10 bg-white/[0.04] text-neutral-300/80' : 'border border-slate-200 bg-white text-slate-600'"
                >
                  <div class="font-medium" :class="themeStore.isDark ? 'text-neutral-200' : 'text-slate-900'">{{ t('terminalPage.directShell') }}</div>
                  <p class="mt-2 leading-6">{{ t('terminalPage.directShellHint') }}</p>
                </div>
              </div>
            </div>

            <div
              class="flex shrink-0 flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              :class="themeStore.isDark
                ? 'border-t border-white/8 bg-[linear-gradient(180deg,rgba(29,29,32,0.96),rgba(20,20,23,0.98))]'
                : 'border-t border-slate-200 bg-[linear-gradient(180deg,rgba(250,250,251,0.98),rgba(244,246,249,0.98))]'"
            >
              <div class="text-xs" :class="themeStore.isDark ? 'text-neutral-400' : 'text-slate-500'">
                {{ t('terminalPage.runningCount', { count: filteredRunningInstances.length }) }}
              </div>
              <div class="flex gap-3 sm:justify-end">
                <button
                  class="flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition-colors sm:flex-none"
                  :class="themeStore.isDark
                    ? 'border-white/12 bg-white/[0.04] text-neutral-100 hover:border-white/20 hover:bg-white/[0.08]'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'"
                  @click="showInstanceSelector = false"
                >
                  {{ t('common.cancel') }}
                </button>
                <button
                  class="flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                  :class="themeStore.isDark
                    ? 'bg-white text-neutral-900 hover:bg-neutral-100'
                    : 'bg-slate-900 text-white hover:bg-slate-800'"
                  :disabled="!selectedInstanceId"
                  @click="confirmAddInstance"
                >
                  {{ t('terminalPage.connect') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 帮助弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="showHelp"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          @click.self="showHelp = false"
        >
          <div class="bg-themed border border-themed rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-medium text-themed">{{ t('terminal.helpTitle') }}</h3>
              <button
                class="p-1 text-themed-muted hover:text-themed rounded transition-colors"
                @click="showHelp = false"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <!-- 快捷键 -->
            <div class="mb-4">
              <h4 class="text-sm font-medium text-themed mb-2">{{ t('terminal.helpShortcuts') }}</h4>
              <div class="space-y-1.5 text-sm">
                <div class="flex justify-between"><span class="text-themed-muted">{{ t('terminal.helpShortcutSearch') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded text-themed-muted text-xs">Ctrl+Shift+F</kbd></div>
                <div class="flex justify-between"><span class="text-themed-muted">{{ t('terminal.helpShortcutCopy') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded text-themed-muted text-xs">Ctrl+Shift+C</kbd></div>
                <div class="flex justify-between"><span class="text-themed-muted">{{ t('terminal.helpShortcutPaste') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded text-themed-muted text-xs">Ctrl+Shift+V</kbd></div>
                <div class="flex justify-between"><span class="text-themed-muted">{{ t('terminal.helpShortcutFontIncrease') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded text-themed-muted text-xs">Ctrl++</kbd></div>
                <div class="flex justify-between"><span class="text-themed-muted">{{ t('terminal.helpShortcutFontDecrease') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded text-themed-muted text-xs">Ctrl+-</kbd></div>
                <div class="flex justify-between"><span class="text-themed-muted">{{ t('terminal.helpShortcutFontReset') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded text-themed-muted text-xs">Ctrl+0</kbd></div>
                <div class="flex justify-between"><span class="text-themed-muted">{{ t('terminal.helpShortcutExport') }}</span><kbd class="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded text-themed-muted text-xs">Ctrl+Shift+S</kbd></div>
              </div>
            </div>

            <!-- 鼠标操作 -->
            <div class="mb-4">
              <h4 class="text-sm font-medium text-themed mb-2">{{ t('terminal.helpMouseOps') }}</h4>
              <ul class="space-y-1 text-sm text-themed-muted">
                <li>• {{ t('terminal.helpMouseSelect') }}</li>
                <li>• {{ t('terminal.helpMouseCopy') }}</li>
                <li>• {{ t('terminal.helpMouseScroll') }}</li>
              </ul>
            </div>

            <!-- 触控操作 -->
            <div class="mb-4">
              <h4 class="text-sm font-medium text-themed mb-2">{{ t('terminal.helpTouchOps') }}</h4>
              <ul class="space-y-1 text-sm text-themed-muted">
                <li>• {{ t('terminal.helpTouchPinchZoom') }}</li>
                <li>• {{ t('terminal.helpTouchSwipeScroll') }}</li>
              </ul>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

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

    <!-- 设置弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="showSettings"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          @click.self="showSettings = false"
        >
          <div class="bg-themed border border-themed rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-medium text-themed">{{ t('terminal.settings') }}</h3>
              <button
                class="p-1 text-themed-muted hover:text-themed rounded transition-colors"
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
                  <div class="text-sm font-medium text-themed">{{ t('terminal.settingBell') }}</div>
                  <div class="text-xs text-themed-muted">{{ t('terminal.settingBellDesc') }}</div>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-colors"
                  :class="terminalStore.bellEnabled ? 'bg-blue-600' : 'bg-neutral-400 dark:bg-neutral-700'"
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
                  <div class="text-sm font-medium text-themed">{{ t('terminal.settingAutoCopy') }}</div>
                  <div class="text-xs text-themed-muted">{{ t('terminal.settingAutoCopyDesc') }}</div>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-colors"
                  :class="terminalStore.autoCopyOnSelect ? 'bg-blue-600' : 'bg-neutral-400 dark:bg-neutral-700'"
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
                  <div class="text-sm font-medium text-themed">{{ t('terminal.settingLinkPreview') }}</div>
                  <div class="text-xs text-themed-muted">{{ t('terminal.settingLinkPreviewDesc') }}</div>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-colors"
                  :class="terminalStore.linkPreview ? 'bg-blue-600' : 'bg-neutral-400 dark:bg-neutral-700'"
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
                  <div class="text-sm font-medium text-themed">{{ t('terminal.settingTouch') }}</div>
                  <div class="text-xs text-themed-muted">{{ t('terminal.settingTouchDesc') }}</div>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-colors"
                  :class="terminalStore.touchEnabled ? 'bg-blue-600' : 'bg-neutral-400 dark:bg-neutral-700'"
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
                  <div class="text-sm font-medium text-themed">{{ t('terminal.settingTheme') }}</div>
                  <div class="text-xs text-themed-muted">{{ t('terminal.settingThemeDesc') }}</div>
                </div>
                <select
                  :value="terminalStore.theme"
                  class="px-2 py-1 text-sm bg-themed border border-themed rounded text-themed"
                  @change="handleThemeChange($event)"
                >
                  <option value="dark">{{ t('terminal.themeDark') }}</option>
                  <option value="light">{{ t('terminal.themeLight') }}</option>
                  <option value="highContrast">{{ t('terminal.themeHighContrast') }}</option>
                </select>
              </div>

              <!-- 当前状态 -->
              <div class="pt-4 border-t border-themed">
                <div class="text-xs text-themed-secondary mb-2">{{ t('terminal.currentStatus') }}</div>
                <div class="flex items-center gap-4 text-xs text-themed">
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
    </Teleport>
  </div>
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

.terminal-area {
  background-color: #0a0a0a;
  /* 移动端使用较小的高度，避免超出可视区域 */
  height: calc(100vh - 200px);
  height: calc(100dvh - 200px);
  min-height: 300px;
}

/* 桌面端使用更大的高度 */
@media (min-width: 640px) {
  .terminal-area {
    height: calc(100vh - 280px);
    height: calc(100dvh - 280px);
    min-height: 400px;
  }
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
