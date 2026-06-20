/**
 * Service Worker - 静态资源缓存
 * 提升二次加载速度，支持离线访问静态资源
 */

const CACHE_NAME = 'incudal-cache-v2'

// 需要缓存的静态资源类型
const CACHEABLE_EXTENSIONS = ['.js', '.css', '.woff', '.woff2', '.ttf', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico']

// 需要始终从网络获取的路径（不缓存）
const NETWORK_ONLY_PATTERNS = [
  '/api/',           // API 请求
  '/auth/',          // 认证请求
  '/oauth/',         // OAuth 请求
  '/__vite_ping',    // Vite HMR
  '/sw.js'           // Service Worker 自身
]

// 安装事件
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...')
  // 跳过等待，立即激活
  event.waitUntil(self.skipWaiting())
})

// 激活事件
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...')
  event.waitUntil(
    Promise.all([
      // 清理旧版本缓存
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => cacheName !== CACHE_NAME)
            .map(cacheName => {
              console.log('[SW] Deleting old cache:', cacheName)
              return caches.delete(cacheName)
            })
        )
      }),
      // 立即接管所有客户端
      self.clients.claim()
    ])
  )
})

// 判断是否应该缓存该请求
function shouldCache(url) {
  // 检查是否是网络优先的路径
  for (const pattern of NETWORK_ONLY_PATTERNS) {
    if (url.pathname.includes(pattern)) {
      return false
    }
  }

  // 只缓存同源请求
  if (url.origin !== self.location.origin) {
    return false
  }

  // 检查文件扩展名
  const pathname = url.pathname.toLowerCase()
  return CACHEABLE_EXTENSIONS.some(ext => pathname.endsWith(ext))
}

// 拦截请求
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // 只处理 GET 请求
  if (event.request.method !== 'GET') {
    return
  }

  // 页面导航请求不做离线接管：
  // 当前策略不缓存 HTML，如果这里兜底到缓存首页，会把瞬时网络抖动放大成“离线状态”。
  if (event.request.mode === 'navigate') {
    return
  }

  // 可缓存的静态资源 - 缓存优先策略（Stale While Revalidate）
  if (shouldCache(url)) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          // 返回缓存，同时在后台更新
          event.waitUntil(
            fetch(event.request)
              .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                  return caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, networkResponse.clone())
                  })
                }
              })
              .catch(() => {
                // 后台更新失败，忽略
              })
          )
          return cachedResponse
        }

        // 没有缓存，从网络获取并缓存
        return fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone()
            event.waitUntil(
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache)
              })
            )
          }
          return networkResponse
        })
      })
    )
    return
  }

  // 其他请求直接走网络
})

// 监听消息（用于手动清除缓存等操作）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        console.log('[SW] Cache cleared')
        // 通知客户端
        if (event.source && event.source.postMessage) {
          event.source.postMessage({ type: 'CACHE_CLEARED' })
        }
      })
    )
  }
})
