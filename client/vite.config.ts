import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import obfuscator from 'rollup-plugin-obfuscator'
import { fileURLToPath, URL } from 'node:url'

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) quote = null
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function removeLocaleObjectProperty(source: string, key: string, indent: number, start = 0, end = source.length): string {
  const spaces = ' '.repeat(indent)
  const propertyPattern = new RegExp(`^${spaces}${key}:\\s*`, 'm')
  const segment = source.slice(start, end)
  const match = propertyPattern.exec(segment)
  if (!match || match.index === undefined) return source

  const propertyStart = start + match.index
  const valueStart = start + match.index + match[0].length
  const lineEnd = source.indexOf('\n', valueStart)
  const propertyLineEnd = lineEnd === -1 || lineEnd > end ? end : lineEnd
  let firstValueChar = valueStart
  while (firstValueChar < propertyLineEnd && /\s/.test(source[firstValueChar])) firstValueChar += 1

  if (source[firstValueChar] !== '{') {
    const removeEnd = propertyLineEnd < source.length ? propertyLineEnd + 1 : propertyLineEnd
    return source.slice(0, propertyStart) + source.slice(removeEnd)
  }

  const objectStart = firstValueChar
  const objectEnd = findMatchingBrace(source, objectStart)
  if (objectEnd === -1 || objectEnd >= end) return source

  let removeEnd = objectEnd + 1
  if (source[removeEnd] === ',') removeEnd += 1
  if (source[removeEnd] === '\r' && source[removeEnd + 1] === '\n') removeEnd += 2
  else if (source[removeEnd] === '\n') removeEnd += 1

  return source.slice(0, propertyStart) + source.slice(removeEnd)
}

function findLocaleObjectRange(source: string, key: string, indent: number, start = 0, end = source.length): [number, number] | null {
  const spaces = ' '.repeat(indent)
  const propertyPattern = new RegExp(`^${spaces}${key}:\\s*`, 'm')
  const segment = source.slice(start, end)
  const match = propertyPattern.exec(segment)
  if (!match || match.index === undefined) return null

  const valueStart = start + match.index + match[0].length
  const objectStart = source.indexOf('{', valueStart)
  if (objectStart === -1 || objectStart >= end) return null
  const objectEnd = findMatchingBrace(source, objectStart)
  if (objectEnd === -1 || objectEnd >= end) return null
  return [objectStart, objectEnd + 1]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keepLocaleObjectProperties(source: string, key: string, indent: number, keepKeys: string[], start = 0, end = source.length): string {
  const range = findLocaleObjectRange(source, key, indent, start, end)
  if (!range) return source

  const contentStart = range[0] + 1
  const contentEnd = range[1] - 1
  const content = source.slice(contentStart, contentEnd)
  const spaces = ' '.repeat(indent + 4)
  const keptProperties = keepKeys
    .map(keepKey => {
      const propertyPattern = new RegExp(`^${spaces}${escapeRegExp(keepKey)}:\\s*[^\\n]+\\n`, 'm')
      return propertyPattern.exec(content)?.[0] ?? ''
    })
    .filter(Boolean)
    .join('')

  if (!keptProperties) return source
  return `${source.slice(0, contentStart)}\n${keptProperties}${source.slice(contentEnd)}`
}

function stripAdminOnlyLocaleMessages(source: string): string {
  let stripped = source
  const userOnlyTopLevelKeys = [
    'freeSite',
    'publicSite',
    'wallet',
    'aff',
    'vipBenefits',
    'hostingWallet',
    'friends',
    'transfers',
    'transfer',
    'checkin'
  ]

  for (const key of userOnlyTopLevelKeys) {
    stripped = removeLocaleObjectProperty(stripped, key, 4)
  }

  const adminEntertainmentRemovedKeys = [
    'title',
    'description',
    'currentPoints',
    'convertPoints',
    'noPointsToConvert',
    'convertSuccess',
    'convertFailed',
    'pointsUnit',
    'tabs',
    'mainTabs',
    'comingSoon',
    'blindbox',
    'checkinSection',
    'spin',
    'spinCost',
    'spinFailed',
    'selectLottery',
    'notEnoughPoints',
    'noActiveLotteries',
    'prizeList',
    'probability',
    'remaining',
    'multiDraw',
    'multiDrawAgain',
    'multiDrawFailed',
    'multiDrawResults',
    'multiDrawStopped',
    'notEnoughPointsForMulti',
    'totalDraws',
    'totalPointsSpent',
    'badgeUnit',
    'instanceUnit',
    'multiDrawBadgesTitle',
    'multiDrawBadgesSubtitle',
    'continueToMultiResults',
    'congratulations',
    'betterLuckNextTime',
    'wonPoints',
    'wonBalance',
    'wonBadge',
    'wonCpu',
    'wonMemory',
    'wonDisk',
    'wonTraffic',
    'lotteryName',
    'prize',
    'prizeType',
    'value',
    'noRecords',
    'loadRecordsFailed',
    'loadLotteriesFailed',
    'pointsLogType',
    'pointsChange',
    'pointsAfter',
    'remark',
    'noPointsLogs',
    'loadPointsLogsFailed',
    'pointsLogTypes',
    'badges'
  ]

  for (const key of adminEntertainmentRemovedKeys) {
    const latestEntertainmentRange = findLocaleObjectRange(stripped, 'entertainment', 4)
    if (!latestEntertainmentRange) break
    stripped = removeLocaleObjectProperty(stripped, key, 8, latestEntertainmentRange[0], latestEntertainmentRange[1])
  }

  const resourcesRange = findLocaleObjectRange(stripped, 'resources', 4)
  if (!resourcesRange) return stripped
  const packagesRange = findLocaleObjectRange(stripped, 'packages', 8, resourcesRange[0], resourcesRange[1])
  if (!packagesRange) return stripped

  const disabledPackageShareKeys = [
    'share',
    'viewShares',
    'selectFriend',
    'selectFriendPlaceholder',
    'noFriends',
    'shareSuccess',
    'shareFailed',
    'confirmUnshare',
    'unshareSuccess',
    'unshareFailed',
    'sharesList',
    'sharesCount',
    'noShares',
    'noSharesHint',
    'sharedAt',
    'unshare',
    'searchFriend',
    'noAvailableFriends',
    'selectToShare',
    'quotaSettings',
    'quotaMultiplier',
    'quotaMultiplierHint',
    'maxInstances',
    'maxInstancesHint',
    'noLimit',
    'instanceUnit',
    'quotaDisplay',
    'usageDisplay',
    'updateQuota',
    'updateQuotaSuccess',
    'updateQuotaFailed',
    'shareToFriend',
    'noFriendsHint',
    'allFriendsShared',
    'confirmShare',
    'editQuota',
    'editQuotaFor',
    'quotaUpdated',
    'quotaUpdateFailed',
    'usageStatus',
    'instanceCount',
    'currentUsage',
    'currentUsageInfo',
    'addShare'
  ]

  for (const key of disabledPackageShareKeys) {
    const latestResourcesRange = findLocaleObjectRange(stripped, 'resources', 4)
    if (!latestResourcesRange) break
    const latestPackagesRange = findLocaleObjectRange(stripped, 'packages', 8, latestResourcesRange[0], latestResourcesRange[1])
    if (!latestPackagesRange) break
    stripped = removeLocaleObjectProperty(stripped, key, 12, latestPackagesRange[0], latestPackagesRange[1])
  }

  return stripped
}

function stripUserOnlyLocaleMessages(source: string): string {
  let stripped = source
  const adminOnlyTopLevelKeys = [
    'statistics',
    'hosting',
    'vipRules',
    'vipBenefits',
    'mail',
    'broadcast',
    'system',
    'oauth',
    'paymentProviders',
    'billingManage',
    'helpManage'
  ]
  const adminOnlyNavKeys = [
    'admin',
    'users',
    'statistics',
    'images',
    'helpManage',
    'oauth',
    'broadcast',
    'paymentProviders',
    'billing',
    'withdrawals',
    'telegramSettings',
    'adminCreateInstance',
    'capacityCost',
    'productionProof'
  ]

  for (const key of adminOnlyTopLevelKeys) {
    const latestAdminRange = findLocaleObjectRange(stripped, 'admin', 4)
    if (!latestAdminRange) return stripped
    stripped = removeLocaleObjectProperty(stripped, key, 8, latestAdminRange[0], latestAdminRange[1])
  }

  for (const key of adminOnlyNavKeys) {
    const latestNavRange = findLocaleObjectRange(stripped, 'nav', 4)
    if (!latestNavRange) break
    stripped = removeLocaleObjectProperty(stripped, key, 8, latestNavRange[0], latestNavRange[1])
  }

  const entertainmentRange = findLocaleObjectRange(stripped, 'entertainment', 4)
  if (entertainmentRange) {
    stripped = removeLocaleObjectProperty(stripped, 'admin', 8, entertainmentRange[0], entertainmentRange[1])
  }

  const adminRange = findLocaleObjectRange(stripped, 'admin', 4)
  if (!adminRange) return stripped

  const sharedUserKeys = [
    'active',
    'banned',
    'totalRecords'
  ]
  stripped = keepLocaleObjectProperties(stripped, 'users', 8, sharedUserKeys, adminRange[0], adminRange[1])

  return stripped
}

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'
  const devPort = Number(process.env.VITE_DEV_PORT || 3000)
  const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:3001'
  const appEntry = process.env.VITE_APP_ENTRY === 'admin' ? 'admin' : 'user'
  const entryScript = appEntry === 'admin' ? '/src/admin/main.ts' : '/src/main.ts'
  const apiClientEntry = appEntry === 'admin' ? './src/api/admin.ts' : './src/api/index.ts'
  const appPathsEntry = appEntry === 'admin' ? './src/utils/app-paths-admin.ts' : './src/utils/app-paths-user.ts'
  const sideNavItemsEntry = appEntry === 'admin'
    ? './src/config/side-nav-items-admin.ts'
    : './src/config/side-nav-items-user.ts'
  const transferModalEntry = appEntry === 'admin'
    ? './src/components/instance/modals/TransferModalAdminStub.vue'
    : './src/components/instance/modals/TransferModal.vue'
  const renewModalEntry = appEntry === 'admin'
    ? './src/components/instance/modals/RenewModalAdminStub.vue'
    : './src/components/instance/modals/RenewModal.vue'
  const applyAffCodeModalEntry = appEntry === 'admin'
    ? './src/components/instance/modals/ApplyAffCodeModalAdminStub.vue'
    : './src/components/instance/modals/ApplyAffCodeModal.vue'
  const changePlanModalEntry = appEntry === 'admin'
    ? './src/components/instance/modals/ChangePlanModalAdminStub.vue'
    : './src/components/instance/modals/ChangePlanModal.vue'
  const destroyInstanceModalEntry = appEntry === 'admin'
    ? './src/components/instance/modals/DestroyInstanceModalAdminStub.vue'
    : './src/components/instance/modals/DestroyInstanceModal.vue'
  const instanceBadgeModalEntry = appEntry === 'admin'
    ? './src/components/instance/InstanceBadgeModalAdminStub.vue'
    : './src/components/instance/InstanceBadgeModal.vue'

  return {
    envDir: '..',
    // 使用绝对路径根路径，在生产环境中静态资源需要从根路径加载
    base: '/',
    
    plugins: [
      vue(),
      {
        name: 'payincus-split-entry',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            return html.replace('/src/main.ts', entryScript)
          }
        }
      },
      appEntry === 'admin' && {
        name: 'payincus-admin-locale-prune',
        enforce: 'pre',
        transform(code, id) {
          const normalizedId = id.replace(/\\/g, '/')
          if (!normalizedId.match(/\/src\/locales\/(zh-CN|zh-TW|en)\.ts(?:\?|$)/)) return null
          return {
            code: stripAdminOnlyLocaleMessages(code),
            map: null
          }
        }
      },
      appEntry === 'user' && {
        name: 'payincus-user-locale-prune',
        enforce: 'pre',
        transform(code, id) {
          const normalizedId = id.replace(/\\/g, '/')
          if (!normalizedId.match(/\/src\/locales\/(zh-CN|zh-TW|en)\.ts(?:\?|$)/)) return null
          return {
            code: stripUserOnlyLocaleMessages(code),
            map: null
          }
        }
      },
      // 代码混淆器（仅生产环境）
      // 注意：如果遇到白屏问题，可能是混淆配置过于严格
      // 临时禁用混淆以排查问题，确认问题后再启用
      // isProd && obfuscator({
      //   include: ['src/**/*.{js,ts,vue}'],
      //   exclude: [/node_modules/, /\.html$/],
      //   options: {
      //     compact: true,
      //     controlFlowFlattening: true,
      //     controlFlowFlatteningThreshold: 0.3,
      //     identifierNamesGenerator: 'hexadecimal',
      //     stringArray: true,
      //     stringArrayEncoding: ['base64'],
      //     stringArrayThreshold: 0.5,
      //     debugProtection: false,
      //     debugProtectionInterval: 0,
      //     disableConsoleOutput: true,
      //   }
      // }),
    ].filter(Boolean),
    
    resolve: {
      alias: [
        {
          find: /^@\/api$/,
          replacement: fileURLToPath(new URL(apiClientEntry, import.meta.url))
        },
        {
          find: /^@\/utils\/app-paths$/,
          replacement: fileURLToPath(new URL(appPathsEntry, import.meta.url))
        },
        {
          find: /^@\/config\/side-nav-items$/,
          replacement: fileURLToPath(new URL(sideNavItemsEntry, import.meta.url))
        },
        {
          find: /^@\/components\/instance\/modals\/TransferModal\.vue$/,
          replacement: fileURLToPath(new URL(transferModalEntry, import.meta.url))
        },
        {
          find: /^@\/components\/instance\/modals\/RenewModal\.vue$/,
          replacement: fileURLToPath(new URL(renewModalEntry, import.meta.url))
        },
        {
          find: /^@\/components\/instance\/modals\/ApplyAffCodeModal\.vue$/,
          replacement: fileURLToPath(new URL(applyAffCodeModalEntry, import.meta.url))
        },
        {
          find: /^@\/components\/instance\/modals\/ChangePlanModal\.vue$/,
          replacement: fileURLToPath(new URL(changePlanModalEntry, import.meta.url))
        },
        {
          find: /^@\/components\/instance\/modals\/DestroyInstanceModal\.vue$/,
          replacement: fileURLToPath(new URL(destroyInstanceModalEntry, import.meta.url))
        },
        {
          find: /^@\/components\/instance\/InstanceBadgeModal\.vue$/,
          replacement: fileURLToPath(new URL(instanceBadgeModalEntry, import.meta.url))
        },
        {
          find: '@',
          replacement: fileURLToPath(new URL('./src', import.meta.url))
        }
      ]
    },
    
    server: {
      port: devPort,
      proxy: {
        '/api': {
          target: devProxyTarget,
          changeOrigin: true,
          ws: true,
          timeout: 10000,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, res) => {
              // Handle proxy errors gracefully
              if (res && !res.headersSent) {
                res.writeHead(500, {
                  'Content-Type': 'application/json'
                })
                res.end(JSON.stringify({ error: 'Proxy error: Backend server may not be ready yet' }))
              }
            })
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              // Log proxy requests in development
              if (process.env.NODE_ENV === 'development') {
                console.log(`[Proxy] ${req.method} ${req.url} -> ${proxyReq.path}`)
              }
            })
          }
        }
      }
    },
    
    build: {
      outDir: `dist/${appEntry}`,
      sourcemap: false,
      assetsDir: 'assets',
      // 优化代码分割，提升加载性能
      rollupOptions: {
        output: {
          // 使用纯哈希命名，不包含文件名，提高安全性
          chunkFileNames: 'assets/[hash].js',
          entryFileNames: 'assets/[hash].js',
          assetFileNames: 'assets/[hash].[ext]',
          // 手动分割代码块，优化缓存和加载
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/')

            if (normalizedId.includes('/node_modules/vue/') ||
              normalizedId.includes('/node_modules/vue-router/') ||
              normalizedId.includes('/node_modules/pinia/')) {
              return 'vue-core'
            }
            if (normalizedId.includes('/node_modules/vue-i18n/')) {
              return 'vue-i18n'
            }
            if (normalizedId.includes('/node_modules/axios/')) {
              return 'axios'
            }
            if (normalizedId.includes('/node_modules/@xterm/xterm/')) {
              return 'xterm-core'
            }
            if (normalizedId.includes('/node_modules/@xterm/addon-')) {
              return 'xterm-addons'
            }
            if (normalizedId.includes('/src/api/index.ts') || normalizedId.includes('/src/api/admin.ts')) {
              return 'api-client'
            }
            if (normalizedId.includes('/src/locales/zh-CN.ts')) {
              return 'locale-zh-cn'
            }
            if (normalizedId.includes('/src/locales/zh-TW.ts')) {
              return 'locale-zh-tw'
            }
            if (normalizedId.includes('/src/locales/en.ts')) {
              return 'locale-en'
            }
          },
        },
        onwarn(warning, warn) {
          // 忽略 sourcemap 相关警告
          if (warning.message?.includes('sourcemap')) return
          warn(warning)
        }
      },
      minify: 'terser',
      terserOptions: {
        compress: {
          // 临时保留 console.error 和 console.warn，方便调试白屏问题
          drop_console: false,  // 临时禁用，方便调试
          pure_funcs: ['console.log', 'console.debug', 'console.info'],  // 只移除这些
          drop_debugger: true,
        },
      },
    },
  }
})
