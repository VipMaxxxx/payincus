import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import obfuscator from 'rollup-plugin-obfuscator'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'

  return {
    // 使用绝对路径根路径，在生产环境中静态资源需要从根路径加载
    base: '/',
    
    plugins: [
      vue(),
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
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    
    server: {
      port: 43173,
      proxy: {
        '/api': {
          target: 'http://localhost:8888',
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
      outDir: 'dist',
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
          manualChunks: {
            // 核心 Vue 库（基础库，缓存利用率高）
            'vue-core': ['vue', 'vue-router', 'pinia'],
            // 国际化库
            'vue-i18n': ['vue-i18n'],
            // 网络请求库
            'axios': ['axios'],
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
