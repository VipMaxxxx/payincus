/**
 * 终端设置 Store
 * 
 * 管理终端的所有可配置项，并持久化到 localStorage
 * 被 TerminalModal.vue 和 TerminalView.vue 共享
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

// 终端主题类型
export type TerminalThemeType = 'dark' | 'light' | 'highContrast'

// 终端主题定义
export const TERMINAL_THEMES = {
    // Vercel 极简风格 - 纯黑背景（默认）
    dark: {
        name: 'dark',
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
    },
    // 亮色主题
    light: {
        name: 'light',
        background: '#ffffff',
        foreground: '#1a1a1a',
        cursor: '#1a1a1a',
        cursorAccent: '#ffffff',
        selectionBackground: '#b4d7ff',
        selectionForeground: '#1a1a1a',
        black: '#1a1a1a',
        red: '#c41a16',
        green: '#007400',
        yellow: '#aa5500',
        blue: '#0451a5',
        magenta: '#bc05bc',
        cyan: '#0598bc',
        white: '#e0e0e0',
        brightBlack: '#666666',
        brightRed: '#ff6b6b',
        brightGreen: '#5cb85c',
        brightYellow: '#f0ad4e',
        brightBlue: '#5bc0de',
        brightMagenta: '#d63384',
        brightCyan: '#17a2b8',
        brightWhite: '#ffffff'
    },
    // 高对比度主题
    highContrast: {
        name: 'highContrast',
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#00ff00',
        cursorAccent: '#000000',
        selectionBackground: '#ffff00',
        selectionForeground: '#000000',
        black: '#000000',
        red: '#ff0000',
        green: '#00ff00',
        yellow: '#ffff00',
        blue: '#0080ff',
        magenta: '#ff00ff',
        cyan: '#00ffff',
        white: '#ffffff',
        brightBlack: '#808080',
        brightRed: '#ff8080',
        brightGreen: '#80ff80',
        brightYellow: '#ffff80',
        brightBlue: '#80c0ff',
        brightMagenta: '#ff80ff',
        brightCyan: '#80ffff',
        brightWhite: '#ffffff'
    }
} as const

// localStorage 存储键
const STORAGE_KEY = 'incudal_terminal_settings'

// 默认设置
const DEFAULT_SETTINGS = {
    fontSize: 14,
    theme: 'dark' as TerminalThemeType,
    bellEnabled: false,           // 终端铃声（默认关闭）
    autoCopyOnSelect: false,      // 选中自动复制（默认关闭）
    linkPreview: true,            // 链接预览（默认开启）
    touchEnabled: true,           // 触控优化（默认开启）
    commandHistory: [] as string[], // 命令历史
    commandHistoryLimit: 100,     // 历史命令数量限制
}

type TerminalSettings = typeof DEFAULT_SETTINGS

/**
 * 从 localStorage 读取设置
 */
function loadSettings(): TerminalSettings {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
            const parsed = JSON.parse(stored)
            // 合并默认值，确保新增字段有默认值
            return { ...DEFAULT_SETTINGS, ...parsed }
        }
    } catch (err) {
        console.warn('[Terminal Store] Failed to load settings:', err)
    }
    return { ...DEFAULT_SETTINGS }
}

/**
 * 保存设置到 localStorage
 */
function saveSettings(settings: TerminalSettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (err) {
        console.warn('[Terminal Store] Failed to save settings:', err)
    }
}

export const useTerminalStore = defineStore('terminal', () => {
    // 从 localStorage 加载初始设置
    const initialSettings = loadSettings()
    
    // 响应式设置
    const fontSize = ref(initialSettings.fontSize)
    const theme = ref<TerminalThemeType>(initialSettings.theme)
    const bellEnabled = ref(initialSettings.bellEnabled)
    const autoCopyOnSelect = ref(initialSettings.autoCopyOnSelect)
    const linkPreview = ref(initialSettings.linkPreview)
    const touchEnabled = ref(initialSettings.touchEnabled)
    const commandHistory = ref<string[]>(initialSettings.commandHistory)
    const commandHistoryLimit = ref(initialSettings.commandHistoryLimit)
    
    // 计算属性：当前主题配置
    const currentTheme = computed(() => TERMINAL_THEMES[theme.value])
    
    // 监听变化并自动保存
    watch(
        [fontSize, theme, bellEnabled, autoCopyOnSelect, linkPreview, touchEnabled, commandHistory, commandHistoryLimit],
        () => {
            saveSettings({
                fontSize: fontSize.value,
                theme: theme.value,
                bellEnabled: bellEnabled.value,
                autoCopyOnSelect: autoCopyOnSelect.value,
                linkPreview: linkPreview.value,
                touchEnabled: touchEnabled.value,
                commandHistory: commandHistory.value,
                commandHistoryLimit: commandHistoryLimit.value,
            })
        },
        { deep: true }
    )
    
    /**
     * 设置字体大小
     */
    function setFontSize(size: number) {
        fontSize.value = Math.max(8, Math.min(32, size))
    }
    
    /**
     * 增大字体
     */
    function increaseFontSize() {
        setFontSize(fontSize.value + 2)
    }
    
    /**
     * 减小字体
     */
    function decreaseFontSize() {
        setFontSize(fontSize.value - 2)
    }
    
    /**
     * 重置字体大小
     */
    function resetFontSize() {
        setFontSize(DEFAULT_SETTINGS.fontSize)
    }
    
    /**
     * 设置主题
     */
    function setTheme(newTheme: TerminalThemeType) {
        theme.value = newTheme
    }
    
    /**
     * 切换终端铃声
     */
    function toggleBell() {
        bellEnabled.value = !bellEnabled.value
    }
    
    /**
     * 切换选中自动复制
     */
    function toggleAutoCopy() {
        autoCopyOnSelect.value = !autoCopyOnSelect.value
    }
    
    /**
     * 切换触控优化
     */
    function toggleTouch() {
        touchEnabled.value = !touchEnabled.value
    }
    
    /**
     * 添加命令到历史
     */
    function addToHistory(command: string) {
        if (!command.trim()) return
        
        // 去除重复
        const index = commandHistory.value.indexOf(command)
        if (index !== -1) {
            commandHistory.value.splice(index, 1)
        }
        
        // 添加到开头
        commandHistory.value.unshift(command)
        
        // 限制数量
        if (commandHistory.value.length > commandHistoryLimit.value) {
            commandHistory.value = commandHistory.value.slice(0, commandHistoryLimit.value)
        }
    }
    
    /**
     * 清空命令历史
     */
    function clearHistory() {
        commandHistory.value = []
    }
    
    /**
     * 播放终端铃声
     */
    function playBell() {
        if (!bellEnabled.value) return
        
        try {
            // 使用 Web Audio API 生成简短的铃声
            const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
            const oscillator = audioContext.createOscillator()
            const gainNode = audioContext.createGain()
            
            oscillator.connect(gainNode)
            gainNode.connect(audioContext.destination)
            
            oscillator.frequency.value = 800 // Hz
            oscillator.type = 'sine'
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime)
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1)
            
            oscillator.start(audioContext.currentTime)
            oscillator.stop(audioContext.currentTime + 0.1)
            
            // 铃声结束后关闭 AudioContext 释放资源
            oscillator.onended = () => {
                audioContext.close().catch(() => {})
            }
        } catch {
            // 音频 API 不可用，静默失败
        }
    }
    
    /**
     * 重置所有设置
     */
    function resetAllSettings() {
        fontSize.value = DEFAULT_SETTINGS.fontSize
        theme.value = DEFAULT_SETTINGS.theme
        bellEnabled.value = DEFAULT_SETTINGS.bellEnabled
        autoCopyOnSelect.value = DEFAULT_SETTINGS.autoCopyOnSelect
        linkPreview.value = DEFAULT_SETTINGS.linkPreview
        touchEnabled.value = DEFAULT_SETTINGS.touchEnabled
        // 保留命令历史
    }
    
    return {
        // 状态
        fontSize,
        theme,
        bellEnabled,
        autoCopyOnSelect,
        linkPreview,
        touchEnabled,
        commandHistory,
        commandHistoryLimit,
        currentTheme,
        
        // 方法
        setFontSize,
        increaseFontSize,
        decreaseFontSize,
        resetFontSize,
        setTheme,
        toggleBell,
        toggleAutoCopy,
        toggleTouch,
        addToHistory,
        clearHistory,
        playBell,
        resetAllSettings,
    }
})
