import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SerializeAddon } from '@xterm/addon-serialize'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { buildApiWebSocketUrl } from '@/utils/api-url'

export interface TerminalControlMessage {
  type: string
  sessionId?: string
  message?: string
  reason?: string
  mode?: 'exec' | 'console'
}

export interface TerminalRuntime {
  terminal: Terminal
  fitAddon: FitAddon
  searchAddon: SearchAddon
  unicodeAddon: Unicode11Addon
  webglAddon: WebglAddon | null
  serializeAddon: SerializeAddon
  clipboardAddon: ClipboardAddon
  isWebGLEnabled: boolean
}

export interface TerminalRuntimeTarget {
  terminal: Terminal | null
  fitAddon: FitAddon | null
  searchAddon: SearchAddon | null
  unicodeAddon: Unicode11Addon | null
  webglAddon: WebglAddon | null
  serializeAddon: SerializeAddon | null
  clipboardAddon: ClipboardAddon | null
  eventsBound: boolean
  isWebGLEnabled: boolean
}

export const TERMINAL_MAX_RECONNECT_ATTEMPTS = 10

const NON_RETRYABLE_CLOSE_CODES = new Set([1000, 1001, 4000, 4001, 4002, 4003, 4004])

export function shouldRetryTerminalClose(code: number): boolean {
  return !NON_RETRYABLE_CLOSE_CODES.has(code)
}

export function buildTerminalWebSocketUrl(instanceId: number, ticket: string): string {
  return buildApiWebSocketUrl(`/ws/instances/${instanceId}/terminal?ticket=${encodeURIComponent(ticket)}`)
}

export function isTerminalControlMessage(parsed: unknown): parsed is TerminalControlMessage {
  return typeof parsed === 'object' && parsed !== null && 'type' in parsed && typeof (parsed as Record<string, unknown>).type === 'string'
}

export function handleTerminalSocketPayload(
  data: string | ArrayBuffer | Blob,
  getTerminal: () => Terminal | null,
  onControlMessage: (message: TerminalControlMessage) => void
): void {
  if (typeof data === 'string') {
    try {
      const message = JSON.parse(data)
      if (isTerminalControlMessage(message)) {
        onControlMessage(message)
        return
      }
    } catch {
      // ignore
    }

    getTerminal()?.write(data)
    return
  }

  if (data instanceof ArrayBuffer) {
    getTerminal()?.write(new Uint8Array(data))
    return
  }

  if (data instanceof Blob) {
    void data.arrayBuffer().then(buffer => {
      getTerminal()?.write(new Uint8Array(buffer))
    }).catch(() => {
      // ignore
    })
  }
}

export function createTerminalRuntime(options: {
  container: HTMLElement
  fontSize: number
  fontFamily: string
  theme: Record<string, string>
  isMobileDevice: boolean
  enableWebgl?: boolean
  onBell?: () => void
  onSelectionCopy?: (selection: string) => void
  onLinkHover?: (event: MouseEvent, uri: string) => void
  onLinkLeave?: () => void
}): TerminalRuntime {
  const terminal = new Terminal({
    fontSize: options.fontSize,
    fontFamily: options.fontFamily,
    cursorBlink: true,
    cursorStyle: 'bar',
    theme: options.theme,
    allowTransparency: false,
    scrollback: 10000,
    tabStopWidth: 4,
    convertEol: false,
    screenReaderMode: false,
    macOptionIsMeta: true,
    altClickMovesCursor: true,
    allowProposedApi: true
  })

  const fitAddon = new FitAddon()
  const webLinksAddon = new WebLinksAddon(
    (_event, uri) => {
      window.open(uri, '_blank', 'noopener,noreferrer')
    },
    {
      hover: (event, uri) => {
        options.onLinkHover?.(event, uri)
      },
      leave: () => {
        options.onLinkLeave?.()
      }
    }
  )
  const searchAddon = new SearchAddon()
  const unicodeAddon = new Unicode11Addon()
  const serializeAddon = new SerializeAddon()
  const clipboardAddon = new ClipboardAddon()

  terminal.loadAddon(fitAddon)
  terminal.loadAddon(webLinksAddon)
  terminal.loadAddon(searchAddon)
  terminal.loadAddon(unicodeAddon)
  terminal.loadAddon(serializeAddon)
  terminal.loadAddon(clipboardAddon)
  terminal.unicode.activeVersion = '11'
  terminal.open(options.container)

  let webglAddon: WebglAddon | null = null
  let isWebGLEnabled = false

  if (options.enableWebgl !== false && !options.isMobileDevice) {
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
      })
      terminal.loadAddon(webgl)
      webglAddon = webgl
      isWebGLEnabled = true
    } catch {
      webglAddon = null
      isWebGLEnabled = false
    }
  }

  if (options.onBell) {
    terminal.onBell(options.onBell)
  }

  if (options.onSelectionCopy) {
    terminal.onSelectionChange(() => {
      if (!terminal.hasSelection()) return
      const selection = terminal.getSelection()
      if (selection) {
        options.onSelectionCopy?.(selection)
      }
    })
  }

  setTimeout(() => fitAddon.fit(), 0)

  return {
    terminal,
    fitAddon,
    searchAddon,
    unicodeAddon,
    webglAddon,
    serializeAddon,
    clipboardAddon,
    isWebGLEnabled
  }
}

export function disposeTerminalRuntime(target: TerminalRuntimeTarget): void {
  if (target.webglAddon) {
    target.webglAddon.dispose()
    target.webglAddon = null
  }

  target.fitAddon = null
  target.searchAddon = null
  target.unicodeAddon = null
  target.serializeAddon = null
  target.clipboardAddon = null

  if (target.terminal) {
    target.terminal.dispose()
    target.terminal = null
  }

  target.eventsBound = false
  target.isWebGLEnabled = false
}
