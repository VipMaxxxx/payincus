const STALE_ASSET_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'dynamically imported module',
  'Loading chunk',
  'ChunkLoadError'
]

let reloadScheduled = false

function describeError(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.trim()
  }
  if (typeof error === 'object') {
    const maybeError = error as { name?: unknown; message?: unknown; reason?: unknown }
    const parts = [
      typeof maybeError.name === 'string' ? maybeError.name : '',
      typeof maybeError.message === 'string' ? maybeError.message : '',
      describeError(maybeError.reason)
    ].filter(Boolean)
    if (parts.length > 0) return parts.join(' ')
  }
  return String(error)
}

export function isStaleAssetLoadError(error: unknown): boolean {
  const description = describeError(error)
  return STALE_ASSET_ERROR_PATTERNS.some(pattern => description.includes(pattern))
}

async function clearIncudalStaticCaches(): Promise<void> {
  if (!('caches' in window)) return
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter(cacheName => cacheName.startsWith('incudal-cache-'))
      .map(cacheName => caches.delete(cacheName))
  )
}

export function scheduleStaleAssetReload(reason: string, error?: unknown): void {
  if (reloadScheduled) return
  reloadScheduled = true
  console.warn('检测到前端静态资源版本不一致，正在刷新页面', { reason, error })

  void clearIncudalStaticCaches().finally(() => {
    window.setTimeout(() => {
      window.location.reload()
    }, 250)
  })
}

export function installStaleAssetRecovery(): void {
  window.addEventListener('vite:preloadError', event => {
    event.preventDefault()
    scheduleStaleAssetReload('vite:preloadError', (event as Event & { payload?: unknown }).payload)
  })

  window.addEventListener('unhandledrejection', event => {
    if (!isStaleAssetLoadError(event.reason)) return
    event.preventDefault()
    scheduleStaleAssetReload('unhandledrejection', event.reason)
  })

  window.addEventListener('error', event => {
    const error = event.error || event.message
    if (!isStaleAssetLoadError(error)) return
    event.preventDefault()
    scheduleStaleAssetReload('window.error', error)
  })
}
