// 确保环境变量被加载（必须在最前面）
import './config/env.js'

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// 导入数据库
import { initPrismaDatabase } from './db/init-prisma.js'
import { closePrismaDatabase, prisma } from './db/prisma.js'

// 导入安全工具
import { checkJwtConfig, isAccessTokenInvalidated } from './lib/security.js'

// 导入日志敏感信息过滤器
import { logSerializers } from './lib/log-sanitizer.js'
import { getTrustProxyEnabled } from './lib/trust-proxy-config.js'
import { getCorsOrigins } from './lib/origin-config.js'

// 导入速率限制配置
import {
  globalRateLimit,
  findRateLimitRule,
  isWhitelisted,
  printRateLimitSummary
} from './config/rate-limit.js'

// 导入路由
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import instanceRoutes from './routes/instances.js'
import hostRoutes from './routes/hosts.js'
import packageRoutes from './routes/packages.js'
import snapshotRoutes from './routes/snapshots.js'
import backupRoutes from './routes/backups.js'
import sshKeyRoutes from './routes/ssh-keys.js'
import notificationRoutes from './routes/notifications.js'
import storageConfigRoutes from './routes/storage-configs.js'
import oauthRoutes from './routes/oauth.js'
import helpRoutes from './routes/help.js'
import imageRoutes from './routes/images.js'
import logRoutes from './routes/logs.js'
import systemConfigRoutes from './routes/system-config.js'
import trafficRoutes from './routes/traffic.js'
import transferRoutes from './routes/transfers.js'
import friendsRoutes from './routes/friends.js'
import ipAddressRoutes from './routes/ip-addresses.js'
import verificationRoutes from './routes/verification.js'
import proxySitesRoutes from './routes/proxy-sites.js'
import inboxRoutes from './routes/inbox.js'
import terminalRoutes from './routes/terminal.js'
import terminalSavedCommandRoutes from './routes/terminal-saved-commands.js'
import announcementsRoutes from './routes/announcements.js'
import ticketsRoutes from './routes/tickets.js'
import checkinRoutes from './routes/checkin.js'
import resourcePoolRoutes from './routes/resource-pool.js'
import redeemCodesRoutes from './routes/redeem-codes.js'
import customInitCommandRoutes from './routes/custom-init-commands.js'
import batchConfigRoutes from './routes/batch-config.js'
import balanceRoutes from './routes/balance.js'
import hostingRoutes from './routes/hosting.js'
import instanceBillingRoutes from './routes/instance-billing.js'
import instanceDestroyRoutes from './routes/instance-destroy.js'
import rechargeRoutes from './routes/recharge.js'
import adminBillingRoutes from './routes/admin-billing.js'
import adminStatisticsRoutes from './routes/admin-statistics.js'
import adminHostingRoutes from './routes/admin-hosting.js'
import affRoutes from './routes/aff.js'
import entertainmentRoutes from './routes/entertainment.js'
import adminEntertainmentRoutes from './routes/admin-entertainment.js'
import mailRoutes from './routes/mail.js'
import adminNotificationChannelsRoutes from './routes/admin-notification-channels.js'
import telegramRoutes from './routes/telegram.js'
import agentRoutes from './routes/agent.js'
import userInviteRoutes from './routes/user-invites.js'
import vipLevelRoutes from './routes/vip-levels.js'
import vipBenefitRoutes from './routes/vip-benefits.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 创建 Fastify 实例
// 日志级别: fatal, error, warn, info, debug, trace
// 开发环境使用 'info' 减少噪音，可通过 LOG_LEVEL 环境变量覆盖
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'info'),
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined,
    // 安全改进：使用序列化器过滤敏感信息
    serializers: logSerializers
  },
  // 关闭请求/响应日志，减少噪音
  disableRequestLogging: process.env.DISABLE_REQUEST_LOG !== 'false',
  // 信任代理：仅在后端位于可信 Nginx/内网代理之后时显式开启
  trustProxy: getTrustProxyEnabled(),
  // 请求大小限制（防止 DoS 攻击）
  bodyLimit: parseInt(process.env.BODY_LIMIT || '10485760', 10), // 默认 10MB
  // 参数长度限制（使用新的 routerOptions 格式）
  routerOptions: {
    maxParamLength: 500
  },
  // 服务器超时设置（默认为120秒，以支持长时间运行的操作）
  requestTimeout: 125000, // 125秒，比操作超时稍长
  keepAliveTimeout: 125000, // 125秒，保持连接时间
  forceCloseConnections: false
})

// 自定义 schema 验证错误处理，返回友好的错误信息
import type { FastifyError } from 'fastify'

fastify.setErrorHandler((error: FastifyError, _request, reply) => {
  if ((error as FastifyError & { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
    return reply.code(413).send({
      error: 'Uploaded file is too large',
      code: 'FILE_TOO_LARGE'
    })
  }

  // 处理 schema 验证错误
  if (error.validation) {
    const messages: string[] = []
    for (const err of error.validation) {
      const field = err.instancePath?.replace('/', '') || (err.params as Record<string, string>)?.missingProperty || 'field'
      if (err.keyword === 'minLength') {
        if (field === 'password') {
          messages.push('Password must be at least 8 characters')
        } else if (field === 'username') {
          messages.push('Username must be at least 3 characters')
        } else {
          messages.push(`${field} is too short`)
        }
      } else if (err.keyword === 'maxLength') {
        messages.push(`${field} is too long`)
      } else if (err.keyword === 'pattern') {
        if (field === 'username') {
          messages.push('Username must start with a letter and contain only letters, numbers, underscores, and hyphens')
        } else {
          messages.push(`${field} format is invalid`)
        }
      } else if (err.keyword === 'format') {
        if ((err.params as Record<string, string>)?.format === 'email') {
          messages.push('Please enter a valid email address')
        } else {
          messages.push(`${field} format is invalid`)
        }
      } else if (err.keyword === 'required') {
        messages.push(`${field} is required`)
      } else {
        messages.push(err.message || `${field} is invalid`)
      }
    }
    return reply.code(400).send({
      error: messages[0] || 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: messages.length > 1 ? messages : undefined
    })
  }

  // 其他错误：生产环境不回显 5xx 内部错误细节
  const statusCode = error.statusCode || 500
  const publicMessage = process.env.NODE_ENV === 'production' && statusCode >= 500
    ? 'Internal server error'
    : (error.message || 'Internal server error')
  return reply.code(statusCode).send({ error: publicMessage })
})

// 注册插件
await fastify.register(cors, {
  origin: getCorsOrigins(),
  credentials: true
})

// 安全头 - 使用 @fastify/helmet
await fastify.register(helmet, {
  // Content Security Policy - 生产环境启用
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",  // Vue 需要
        'https://challenges.cloudflare.com',  // Turnstile
        'https://static.cloudflareinsights.com',  // Cloudflare Analytics
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",  // Vue 和 Tailwind 需要
        'https://fonts.googleapis.com',
      ],
      fontSrc: [
        "'self'",
        'https://fonts.gstatic.com',
        'data:',
      ],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'http:',
        'https:',
        'https://kkksr.com',  // 帮助文档图片
        'https://api.dicebear.com',  // 头像服务
        'https://dicebear.incudal.com',  // 自建头像服务
        'https://*.githubusercontent.com',  // GitHub 头像
        'https://avatars.githubusercontent.com',
        'https://lh3.googleusercontent.com',  // Google 头像
      ],
      connectSrc: [
        "'self'",
        'ws:',   // HTTP-only intranet WebSocket validation
        'wss:',  // WebSocket 连接
        'https://challenges.cloudflare.com',  // Turnstile API
        'https://cloudflareinsights.com',  // Cloudflare Analytics
        'https://api.dicebear.com',  // 头像 API
        'https://dicebear.incudal.com',  // 自建头像服务
      ],
      frameSrc: [
        "'self'",
        'https://challenges.cloudflare.com',  // Turnstile iframe
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],  // 防止点击劫持
      upgradeInsecureRequests: null, // 必须显式为 null，否则 helmet 默认会加上该策略强制升级 HTTPS 引发白屏
    },
  } : false,
  // 跨域嵌入策略 - 允许加载外部资源
  crossOriginEmbedderPolicy: false,
  // 跨域资源策略
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS - 纯 HTTP 部署需禁用
  hsts: false,
  // 禁止 MIME 类型嗅探
  noSniff: true,
  // 防止点击劫持
  frameguard: { action: 'deny' },
  // XSS 过滤
  xssFilter: true,
  // 隐藏 X-Powered-By
  hidePoweredBy: true,
  // Referrer Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
})

await fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'dev-secret-change-in-production'
})

await fastify.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET || 'cookie-secret-change-in-production',
  parseOptions: {}
})

await fastify.register(fastifyMultipart, {
  attachFieldsToBody: false,
  limits: {
    files: 6,
    fileSize: 50 * 1024 * 1024,
    parts: 30
  }
})

// WebSocket 插件注册（安全增强：连接数限制）
await fastify.register(fastifyWebsocket, {
  options: {
    maxPayload: 1048576, // 1MB 最大消息大小
    // 安全增强：单 IP 最大连接数限制在路由层实现
  }
})

// 全局速率限制 (配置来自 config/rate-limit.ts)
await fastify.register(rateLimit, {
  global: true,
  max: globalRateLimit.max,
  timeWindow: globalRateLimit.timeWindow,
  keyGenerator: (request) => {
    // 使用 IP + 路径作为限制键，实现接口级别限制
    const rule = findRateLimitRule(request.url, request.method)
    if (rule) {
      return `${request.ip}:${rule.path}`
    }
    return request.ip
  },
  errorResponseBuilder: (_request, context) => ({
    error: 'Too many requests, please try again later',
    retryAfter: context.after
  }),
  // 跳过白名单路径和非 API 请求
  allowList: (request) => {
    if (!request.url.startsWith('/api/')) {
      return true
    }
    return isWhitelisted(request.url)
  }
})

// 应用接口级别的速率限制配置
fastify.addHook('onRoute', (routeOptions) => {
  const rule = findRateLimitRule(routeOptions.url, routeOptions.method as string)
  if (rule) {
    routeOptions.config = {
      ...routeOptions.config,
      rateLimit: {
        max: rule.max,
        timeWindow: rule.timeWindow
      }
    }
  }
})

// JWT 认证装饰器（简化版：移除 Token 失效检查）
async function ensureActiveAccessToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const user = request.user as { id?: number; username?: string; role?: string; status?: string; sid?: string; iat?: number }

  if (!user?.id || !user.iat) {
    reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return false
  }

  const invalidated = await isAccessTokenInvalidated(user.id, user.iat, user.sid)
  if (invalidated) {
    reply.code(401).send({ error: 'Session expired', code: 'SESSION_INVALIDATED' })
    return false
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      username: true,
      role: true,
      status: true
    }
  })

  if (!currentUser) {
    reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return false
  }

  if (currentUser.status !== 'active') {
    reply.code(401).send({ error: 'Account banned', code: 'ACCOUNT_BANNED' })
    return false
  }

  user.username = currentUser.username
  user.role = currentUser.role
  user.status = currentUser.status

  return true
}

async function ensureCurrentAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const currentUser = request.user as { id?: number; role?: string; status?: string }
  if (!currentUser?.id || currentUser.role !== 'admin' || currentUser.status !== 'active') {
    reply.code(403).send({ error: 'Admin privileges required', code: 'ADMIN_REQUIRED' })
    return false
  }

  return true
}

fastify.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify()
    if (!(await ensureActiveAccessToken(request, reply))) {
      return
    }
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

// 管理员权限检查 (作为 preHandler 使用)
fastify.decorate('requireAdmin', async function (request, reply) {
  // 必须先通过 authenticate，确保 request.user 存在
  if (!request.user) {
    return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
  }
  if (!(await ensureCurrentAdmin(request, reply))) {
    return
  }
})

// 组合认证+管理员检查的便捷 preHandler（简化版）
fastify.decorate('authenticateAdmin', async function (request, reply) {
  try {
    await request.jwtVerify()
    if (!(await ensureActiveAccessToken(request, reply))) {
      return
    }
    if (!(await ensureCurrentAdmin(request, reply))) {
      return
    }
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
})

// 组合认证+普通用户检查（禁止管理员访问）（简化版）
fastify.decorate('authenticateUser', async function (request, reply) {
  try {
    await request.jwtVerify()
    if (!(await ensureActiveAccessToken(request, reply))) {
      return
    }
    const user = request.user as { id: number; role?: string }
    // 禁止管理员访问普通用户专属功能
    if (user.role === 'admin') {
      return reply.code(403).send({ error: 'This feature is for regular users only', code: 'USER_ONLY' })
    }
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
})

// 注意: 安全响应头已由 @fastify/helmet 处理
// 包括: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, 
// Referrer-Policy, HSTS, CSP 等

// 健康检查
fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// 注册 API 路由
await fastify.register(authRoutes, { prefix: '/api/auth' })
await fastify.register(userRoutes, { prefix: '/api/users' })
await fastify.register(instanceRoutes, { prefix: '/api/instances' })
await fastify.register(hostRoutes, { prefix: '/api/hosts' })
await fastify.register(packageRoutes, { prefix: '/api/packages' })
await fastify.register(snapshotRoutes, { prefix: '/api/instances' })
await fastify.register(backupRoutes, { prefix: '/api/instances' })
await fastify.register(sshKeyRoutes, { prefix: '/api/ssh-keys' })
await fastify.register(notificationRoutes, { prefix: '/api/notifications' })
await fastify.register(storageConfigRoutes, { prefix: '/api/storage-configs' })
await fastify.register(oauthRoutes, { prefix: '/api/oauth' })
await fastify.register(helpRoutes, { prefix: '/api/help' })
await fastify.register(imageRoutes, { prefix: '/api/images' })
await fastify.register(logRoutes, { prefix: '/api/logs' })
await fastify.register(systemConfigRoutes, { prefix: '/api/system-config' })
await fastify.register(trafficRoutes, { prefix: '/api' })
await fastify.register(transferRoutes, { prefix: '/api/transfers' })
await fastify.register(friendsRoutes, { prefix: '/api/friends' })
await fastify.register(ipAddressRoutes, { prefix: '/api' })
await fastify.register(verificationRoutes, { prefix: '/api/verification' })
await fastify.register(proxySitesRoutes, { prefix: '/api' })
await fastify.register(inboxRoutes, { prefix: '/api/inbox' })
await fastify.register(terminalRoutes, { prefix: '/api/ws/instances' })
await fastify.register(terminalSavedCommandRoutes, { prefix: '/api/terminal-saved-commands' })
await fastify.register(announcementsRoutes, { prefix: '/api/announcements' })
await fastify.register(ticketsRoutes, { prefix: '/api/tickets' })
await fastify.register(checkinRoutes, { prefix: '/api/checkin' })
  await fastify.register(resourcePoolRoutes, { prefix: '/api/resource-pool' })
await fastify.register(redeemCodesRoutes, { prefix: '/api' })
await fastify.register(customInitCommandRoutes, { prefix: '/api/init-commands' })
await fastify.register(batchConfigRoutes, { prefix: '/api/hosts' })
await fastify.register(balanceRoutes, { prefix: '/api/balance' })
await fastify.register(hostingRoutes, { prefix: '/api/hosting' })
await fastify.register(instanceBillingRoutes, { prefix: '/api/instances' })
await fastify.register(instanceDestroyRoutes, { prefix: '/api/instances' })
await fastify.register(rechargeRoutes)
await fastify.register(adminBillingRoutes)
await fastify.register(adminStatisticsRoutes)
await fastify.register(adminHostingRoutes)
await fastify.register(affRoutes, { prefix: '/api/aff' })
await fastify.register(entertainmentRoutes, { prefix: '/api/entertainment' })
await fastify.register(adminEntertainmentRoutes, { prefix: '/api/admin/entertainment' })
await fastify.register(mailRoutes, { prefix: '/api/mail' })
await fastify.register(adminNotificationChannelsRoutes, { prefix: '/api/admin/notification-channels' })
await fastify.register(telegramRoutes, { prefix: '/api/telegram' })
await fastify.register(agentRoutes, { prefix: '/api/agent' })
await fastify.register(userInviteRoutes, { prefix: '/api/user-invites' })
await fastify.register(vipLevelRoutes)
await fastify.register(vipBenefitRoutes)

const shouldServeStaticClient = process.env.NODE_ENV === 'production' && process.env.SERVE_STATIC_CLIENT !== 'false'

// 生产环境：默认托管前端静态文件；前后端分离部署时可设置 SERVE_STATIC_CLIENT=false
if (shouldServeStaticClient) {
  const clientDistPath = join(__dirname, '../../client/dist')
  const indexHtmlPath = join(clientDistPath, 'index.html')
  let indexHtmlCache: string | null = null
  let previewBotSafeIndexHtmlCache: string | null = null
  const linkPreviewBotPatterns = [
    /telegrambot/i,
    /discordbot/i,
    /slackbot/i,
    /twitterbot/i,
    /linkedinbot/i,
    /facebookexternalhit/i,
    /facebot/i,
    /skypeuripreview/i,
    /teamsbot/i
  ]

  function isLinkPreviewBotRequest(request: FastifyRequest): boolean {
    const userAgentHeader = request.headers['user-agent']
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader.join(' ') : (userAgentHeader || '')
    return linkPreviewBotPatterns.some(pattern => pattern.test(userAgent))
  }

  function buildPreviewBotSafeIndexHtml(html: string): string {
    return html
      .replace(/^\s*<meta name="description"[^>]*>\s*$/gim, '')
      .replace(/^\s*<meta property="og:[^"]+"[^>]*>\s*$/gim, '')
      .replace(/^\s*<meta name="twitter:[^"]+"[^>]*>\s*$/gim, '')
      .replace(
        /<meta name="robots" content="[^"]*">/i,
        '<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">'
      )
  }

  async function getIndexHtml(): Promise<string> {
    if (indexHtmlCache === null) {
      indexHtmlCache = await readFile(indexHtmlPath, 'utf8')
    }
    return indexHtmlCache
  }

  async function getPreviewBotSafeIndexHtml(): Promise<string> {
    if (previewBotSafeIndexHtmlCache === null) {
      previewBotSafeIndexHtmlCache = buildPreviewBotSafeIndexHtml(await getIndexHtml())
    }
    return previewBotSafeIndexHtmlCache
  }

  async function sendAppIndex(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (isLinkPreviewBotRequest(request)) {
      reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-store, must-revalidate')
        .header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
        .send(await getPreviewBotSafeIndexHtml())
      return
    }

    await reply.sendFile('index.html', clientDistPath)
  }

  // 忽略 Cloudflare 的特殊路径（在 onRequest hook 中处理）
  // 注意：这个 hook 必须在静态文件服务之前执行
  fastify.addHook('onRequest', async (request, reply) => {
    // 如果请求 Cloudflare 的 RUM 端点，直接返回 204 并跳过后续处理
    if (request.url.startsWith('/cdn-cgi/')) {
      reply.code(204)
      reply.send()
      return reply  // 明确返回，确保后续处理器不会执行
    }
  })

  // 显式处理根路径，返回 index.html
  // 必须在静态文件服务之前注册，确保优先匹配
  fastify.get('/', async (request, reply) => {
    await sendAppIndex(request, reply)
  })

  // 注册静态文件服务
  // 注意：静态文件服务在 API 路由之后注册，Fastify 会按注册顺序匹配路由
  // 由于 API 路由都有 /api 前缀，静态文件服务不会拦截它们
  // 显式的 fastify.get('/') 路由会优先于静态文件服务的通配符匹配
  await fastify.register(fastifyStatic, {
    root: clientDistPath,
    prefix: '/',
    // 设置正确的MIME类型和缓存策略
    setHeaders: (res, pathName) => {
      // 注意：在 setHeaders 回调中，响应头尚未发送，所以不需要检查 headersSent
      // 使用 try-catch 防止可能的错误
      try {
        // 确保JavaScript和CSS文件有正确的Content-Type
        if (pathName.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        } else if (pathName.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css; charset=utf-8')
        } else if (pathName.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          // HTML 文件不缓存，确保总是获取最新版本
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        }
        // 静态资源缓存（JS/CSS/图片等）
        if (!pathName.endsWith('.html')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      } catch (error) {
        // 忽略设置响应头时的错误（例如响应头已发送）
        // 这不应该发生，但作为安全措施
      }
    },
    // 禁用目录列表
    list: false,
    // 不自动处理 index.html（由显式路由和 404 handler 处理）
    index: false,
    // 允许访问所有文件类型
    wildcard: true
  })

  // 404 处理器必须在静态文件服务之后注册
  // 注意：这个处理器会捕获所有未匹配的路由
  fastify.setNotFoundHandler(async (request, reply) => {
    // 忽略 Cloudflare 的特殊路径
    if (request.url.startsWith('/cdn-cgi/')) {
      return reply.code(204).send()
    }

    // API 路由返回 JSON 错误
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'API 路由不存在' })
    }

    // 对于前端路由（非 API、非静态资源），返回 index.html
    // 这样 Vue Router 的 history 模式可以正常工作
    // 检查是否是静态资源请求（已有文件扩展名）
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(request.url.split('?')[0])
    if (hasExtension) {
      // 有扩展名的请求，返回 404
      return reply.code(404).send({ error: '文件不存在' })
    }

    // 没有扩展名的请求，返回 index.html（前端路由）
    await sendAppIndex(request, reply)
  })
}

// 启动服务器
const start = async (): Promise<void> => {
  try {
    // 安全配置检查
    const jwtCheck = checkJwtConfig()
    if (!jwtCheck.valid) {
      console.error('❌ 安全配置错误:')
      jwtCheck.warnings.forEach(w => console.error(`   - ${w}`))
      process.exit(1)
    }
    if (jwtCheck.warnings.length > 0) {
      console.warn('⚠️  安全配置警告:')
      jwtCheck.warnings.forEach(w => console.warn(`   - ${w}`))
    }

    // 初始化 Prisma 数据库
    // 支持通过环境变量 RESET_DATABASE=true 清空数据库
    await initPrismaDatabase({
      resetDatabase: process.env.RESET_DATABASE === 'true' || process.env.RESET_DATABASE === '1'
    })

    const { cleanupStaleCreatingBackups } = await import('./db/backups.js')
    const staleCreatingBackups = await cleanupStaleCreatingBackups()
    if (staleCreatingBackups > 0) {
      console.log(`📦 清理了 ${staleCreatingBackups} 个长时间停留在创建中的备份记录`)
    }

    const port = parseInt(process.env.PORT || '3001', 10)
    const host = process.env.HOST || '127.0.0.1'

    await fastify.listen({ port, host })
    console.log(`🚀 Incudal 服务已启动: http://localhost:${port}`)

    // 启动流量调度器
    const { startTrafficScheduler } = await import('./services/traffic-scheduler.js')
    startTrafficScheduler()

    // 启动自动快照/备份调度器
    const { startAutoPolicyScheduler } = await import('./services/auto-policy-scheduler.js')
    startAutoPolicyScheduler()

    // 启动计费调度器（自动续费、到期封停、到期删除、到期提醒）
    const { startBillingScheduler } = await import('./services/billing-scheduler.js')
    startBillingScheduler()

    // 启动邮箱订阅过期检查调度器
    const { startMailExpiryScheduler } = await import('./services/mail-expiry-scheduler.js')
    startMailExpiryScheduler()

    // 启动托管余额调度器（解冻）
    const { startHostingScheduler } = await import('./services/hosting-scheduler.js')
    startHostingScheduler()

    // 启动实例状态同步调度器
    const { startStatusScheduler } = await import('./services/status-scheduler.js')
    startStatusScheduler()

    // 启动实例操作任务调度器
    const { cleanupStaleTasks: cleanupStaleInstanceTasks, startInstanceTaskWorker } = await import('./workers/instanceTaskWorker.js')
    await cleanupStaleInstanceTasks()
    startInstanceTaskWorker()
    console.log('⚙️ 实例操作任务调度器已启动')

    // 启动备份恢复和远程上传队列 Worker
    const {
      cleanupStaleTasks: cleanupStaleRestoreTasks,
      startRestoreWorker,
      stopRestoreWorker
    } = await import('./workers/restoreTaskWorker.js')
    const {
      cleanupStaleUploadTasks,
      startBackupUploadWorker,
      stopBackupUploadWorker
    } = await import('./workers/backupUploadWorker.js')
    await cleanupStaleRestoreTasks()
    await cleanupStaleUploadTasks()
    startRestoreWorker()
    startBackupUploadWorker()
    console.log('📦 备份恢复和远程上传队列已启动')

    // 启动宿主机通知邮件队列 Worker
    const {
      cleanupStaleHostNotificationEmailTasks,
      startHostNotificationEmailWorker,
      stopHostNotificationEmailWorker
    } = await import('./workers/hostNotificationEmailWorker.js')
    const staleHostNotificationEmailTasks = await cleanupStaleHostNotificationEmailTasks()
    if (staleHostNotificationEmailTasks > 0) {
      console.log(`📧 重新入队了 ${staleHostNotificationEmailTasks} 个宿主机通知邮件任务`)
    }
    startHostNotificationEmailWorker()
    console.log('📧 宿主机通知邮件队列已启动')

    // 启动终端会话清理任务
    const { startSessionCleanup, stopSessionCleanup } = await import('./lib/terminal-proxy.js')
    startSessionCleanup()
    console.log('🖥️ 终端会话清理任务已启动')

    // 优雅关闭处理
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n🛑 收到 ${signal} 信号，开始优雅关闭...`)
      
      // 停止终端会话清理定时器
      stopSessionCleanup()
      stopHostNotificationEmailWorker()
      stopRestoreWorker()
      stopBackupUploadWorker()
      
      // 清理所有活跃终端会话
      const { closeAllSessions } = await import('./lib/terminal-proxy.js')
      const closedSessions = closeAllSessions('Server shutdown')
      if (closedSessions > 0) {
        console.log(`🖥️ 关闭了 ${closedSessions} 个终端会话`)
      }
      
      // 关闭 Fastify 服务器
      try {
        await fastify.close()
        await closePrismaDatabase()
        console.log('✅ 服务器已关闭')
        process.exit(0)
      } catch (err) {
        console.error('❌ 关闭服务器失败:', err)
        process.exit(1)
      }
    }
    
    // 监听进程信号
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))

    // 清理卡住的转移 processing 状态
    const { cleanupStaleTransfers, cleanupTimeoutTransfers } = await import('./db/transfers.js')
    const staleTransfers = await cleanupStaleTransfers()
    if (staleTransfers > 0) {
        console.log(`🔄 清理了 ${staleTransfers} 个卡住的转移请求`)
    }
    // 定期检查超时的 processing 状态（每5分钟）
    setInterval(async () => {
        try {
            const count = await cleanupTimeoutTransfers()
            if (count > 0) {
                console.log(`🔄 清理了 ${count} 个超时的转移请求`)
            }
        } catch (err) {
            console.error('转移超时清理失败:', err)
        }
    }, 5 * 60 * 1000) // 5分钟

    // 启动创建超时清理任务（清理10分钟仍处于创建中的实例）
    const { getStuckCreatingInstances, getHostById, compensateFailedInstancePurchase } = await import('./db/index.js')
    const { getIncusClient, deleteInstance } = await import('./lib/incus/index.js')
    const { createLog } = await import('./db/logs.js')
    const CREATE_TIMEOUT_MS = 10 * 60 * 1000 // 10分钟
    const CREATE_TIMEOUT_CHECK_INTERVAL = 2 * 60 * 1000 // 每2分钟检查一次
    
    const instanceCreationReservesPorts = (networkMode: string) =>
      ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(networkMode)

    const runCreateTimeoutCleanup = async () => {
      try {
        const stuckInstances = await getStuckCreatingInstances(CREATE_TIMEOUT_MS)
        
        for (const instance of stuckInstances) {
          console.log(`[CreateTimeout] 清理超时创建实例: ${instance.name} (ID: ${instance.id})`)
          
          // 使用原子操作更新状态，防止与 createInstanceAsync 的失败回滚竞争
          // 只有状态仍为 'creating' 时才执行清理
          const { prisma } = await import('./db/prisma.js')
          const updateResult = await prisma.instance.updateMany({
            where: {
              id: instance.id,
              status: 'creating' // 原子条件：只有状态仍为 creating 时才更新
            },
            data: {
              status: 'error'
            }
          })
          
          // 如果没有更新任何记录，说明状态已被其他进程修改（如 createInstanceAsync 失败回滚）
          if (updateResult.count === 0) {
            console.log(`[CreateTimeout] 实例 ${instance.name} 状态已被其他进程修改，跳过清理`)
            continue
          }
          
          // 状态更新成功，执行资源回滚
          // 2. 回滚资源
          try {
            const { rollbackResources } = await import('./db/index.js')
            await rollbackResources({
              hostId: instance.host_id,
              cpu: instance.cpu,
              memory: instance.memory,
              disk: instance.disk,
              portCount: instanceCreationReservesPorts(instance.network_mode) ? (instance.port_limit || 0) : 0
            })
            console.log(`[CreateTimeout] 实例 ${instance.name} 资源已回滚`)
          } catch (rollbackErr) {
            console.error(`[CreateTimeout] 资源回滚失败:`, rollbackErr)
          }

          try {
            const compensation = await compensateFailedInstancePurchase(instance.id, instance.user_id, instance.host_id)
            if (compensation.refunded) {
              console.log(`[CreateTimeout] 实例 ${instance.name} 创建超时已自动退款 ¥${compensation.refundAmount.toFixed(2)}`)
            } else if (compensation.reason !== 'not_paid_purchase') {
              console.log(`[CreateTimeout] 实例 ${instance.name} 创建超时无需退款: ${compensation.reason || 'unknown'}`)
            }
          } catch (compensationErr) {
            console.error(`[CreateTimeout] 实例 ${instance.name} 创建超时后的账务补偿失败:`, compensationErr)
          }
          
          // 3. 尝试清理 Incus 残留
          try {
            const host = await getHostById(instance.host_id)
            if (host) {
              const client = await getIncusClient(host)
              await deleteInstance(client, instance.incus_id)
              console.log(`[CreateTimeout] 残留容器 ${instance.incus_id} 已清理`)
            }
          } catch (cleanupErr) {
            // 清理失败不影响流程（容器可能不存在或已被删除）
            console.log(`[CreateTimeout] 清理残留容器失败 (可能不存在)`)
          }
          
          // 4. 发送用户通知
          try {
            const { sendNotification } = await import('./lib/notifier.js')
            const host = await getHostById(instance.host_id)
            await sendNotification(instance.user_id, 'instance_create_timeout', {
              instanceName: instance.name,
              hostName: host?.name || undefined
            })
          } catch (notifyErr) {
            console.error(`[CreateTimeout] 发送通知失败:`, notifyErr)
          }
          
          // 5. 记录日志
          await createLog(
            instance.user_id,
            'instance',
            'instance.create_timeout',
            `Instance "${instance.name}" creation timed out after 10 minutes`,
            'failed',
            { instanceId: instance.id }
          )
        }
        
        if (stuckInstances.length > 0) {
          console.log(`[CreateTimeout] 清理了 ${stuckInstances.length} 个超时创建实例`)
        }
      } catch (err) {
        console.error('[CreateTimeout] 清理失败:', err)
      }
    }
    // 每2分钟检查一次
    setInterval(runCreateTimeoutCleanup, CREATE_TIMEOUT_CHECK_INTERVAL)
    // 启动时也执行一次
    runCreateTimeoutCleanup()
    console.log('⏱️ 创建超时清理任务已启动（10分钟超时）')

    // 启动实例任务清理定时任务（清理7天前的已完成任务）
    const { cleanupOldTasks } = await import('./db/instance-tasks.js')
    const runInstanceTaskCleanup = async () => {
      try {
        const deleted = await cleanupOldTasks()
        if (deleted > 0) {
          console.log(`⚙️ 实例任务清理完成，删除 ${deleted} 条过期任务`)
        }
      } catch (err) {
        console.error('实例任务清理失败:', err)
      }
    }
    // 每天执行一次清理
    setInterval(runInstanceTaskCleanup, 24 * 60 * 60 * 1000)
    // 启动时也执行一次
    runInstanceTaskCleanup()

    // 启动站内信清理定时任务（30 天前的消息）
    const { cleanupOldMessages } = await import('./db/inbox.js')
    const runInboxCleanup = async () => {
      try {
        const deleted = await cleanupOldMessages(30)
        if (deleted > 0) {
          console.log(`📨 站内信清理完成，删除 ${deleted} 条过期消息`)
        }
      } catch (err) {
        console.error('站内信清理失败:', err)
      }
    }
    // 每天24小时执行一次清理
    setInterval(runInboxCleanup, 24 * 60 * 60 * 1000)
    // 启动时也执行一次
    runInboxCleanup()

    // 启动系统健康监控
    const { startSystemMonitor } = await import('./services/system-monitor.js')
    startSystemMonitor()

    // 启动工单自动关闭调度器
    const { startTicketAutoCloseScheduler } = await import('./services/ticket-auto-close-scheduler.js')
    startTicketAutoCloseScheduler()

    // 启动节点连接地址监控（启动即回填，之后每 30 分钟轮训域名型地址）
    const { startHostAddressMonitor } = await import('./services/host-address-monitor.js')
    startHostAddressMonitor()

    console.log(`🔒 安全模式: ${process.env.NODE_ENV === 'production' ? '生产环境' : '开发环境'}`)
    printRateLimitSummary()

    if (process.env.RESET_DATABASE === 'true' || process.env.RESET_DATABASE === '1') {
      console.log('⚠️  注意：数据库已在启动时清空，请在生产环境中移除 RESET_DATABASE 环境变量')
    }
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
