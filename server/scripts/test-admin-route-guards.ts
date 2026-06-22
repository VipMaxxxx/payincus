import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

type RouteInfo = {
  file: string
  line: number
  method: string
  path: string
  options: string
  handler: string
  fileHasAuthenticateHook: boolean
}

const routesDir = join(process.cwd(), 'src/routes')
const routeMethods = ['get', 'post', 'put', 'patch', 'delete']

function skipWhitespace(source: string, index: number): number {
  while (index < source.length && /\s/.test(source[index])) index += 1
  return index
}

function skipGenericBlock(source: string, index: number): number {
  index = skipWhitespace(source, index)
  if (source[index] !== '<') return index

  let depth = 0
  let quote: string | null = null
  for (let i = index; i < source.length; i += 1) {
    const char = source[i]
    const previous = source[i - 1]

    if (quote) {
      if (char === quote && previous !== '\\') quote = null
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }

    if (char === '<') depth += 1
    if (char === '>') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }

  return index
}

function findMatching(source: string, index: number, open: string, close: string): number {
  let depth = 0
  let quote: string | null = null

  for (let i = index; i < source.length; i += 1) {
    const char = source[i]
    const previous = source[i - 1]

    if (quote) {
      if (char === quote && previous !== '\\') quote = null
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }

    if (char === open) depth += 1
    if (char === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }

  return -1
}

function splitTopLevelArgs(source: string): string[] {
  const args: string[] = []
  let start = 0
  let parenDepth = 0
  let braceDepth = 0
  let bracketDepth = 0
  let angleDepth = 0
  let quote: string | null = null

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const previous = source[i - 1]

    if (quote) {
      if (char === quote && previous !== '\\') quote = null
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }

    if (char === '(') parenDepth += 1
    else if (char === ')') parenDepth -= 1
    else if (char === '{') braceDepth += 1
    else if (char === '}') braceDepth -= 1
    else if (char === '[') bracketDepth += 1
    else if (char === ']') bracketDepth -= 1
    else if (char === '<') angleDepth += 1
    else if (char === '>') angleDepth = Math.max(0, angleDepth - 1)
    else if (char === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && angleDepth === 0) {
      args.push(source.slice(start, i))
      start = i + 1
    }
  }

  args.push(source.slice(start))
  return args
}

function readStringLiteral(rawValue: string | undefined): string | null {
  const source = rawValue?.trim()
  if (!source) return null

  const quote = source[0]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null

  let value = ''
  for (let i = 1; i < source.length; i += 1) {
    if (source[i] === quote && source[i - 1] !== '\\') return value
    value += source[i]
  }

  return null
}

function matchRouteReceiver(source: string, index: number, method: string): number {
  for (const receiver of ['fastify', 'app']) {
    const prefix = `${receiver}.${method}`
    if (source.slice(index, index + prefix.length) === prefix) {
      return prefix.length
    }
  }
  return 0
}

function collectRoutes(): RouteInfo[] {
  const files = readdirSync(routesDir)
    .filter(file => file.endsWith('.ts'))
    .sort()
  const routes: RouteInfo[] = []

  for (const file of files) {
    const source = readFileSync(join(routesDir, file), 'utf8')
    const fileHasAuthenticateHook = /addHook\(\s*['"]onRequest['"]\s*,\s*(fastify|app)\.authenticate\b/.test(source)

    for (let index = 0; index < source.length; index += 1) {
      for (const method of routeMethods) {
        const receiverLength = matchRouteReceiver(source, index, method)
        if (receiverLength === 0) continue

        let cursor = skipGenericBlock(source, index + receiverLength)
        cursor = skipWhitespace(source, cursor)
        if (source[cursor] !== '(') continue

        const callEnd = findMatching(source, cursor, '(', ')')
        if (callEnd < 0) continue

        const args = splitTopLevelArgs(source.slice(cursor + 1, callEnd))
        const routePath = readStringLiteral(args[0])
        if (!routePath) {
          index = callEnd
          break
        }

        routes.push({
          file,
          line: source.slice(0, index).split('\n').length,
          method: method.toUpperCase(),
          path: routePath,
          options: args[1] ?? '',
          handler: args.slice(1).join('\n'),
          fileHasAuthenticateHook
        })

        index = callEnd
        break
      }
    }
  }

  return routes
}

function hasAdminGuard(route: RouteInfo): boolean {
  if (/authenticateAdmin|requireAdmin/.test(route.options)) {
    return true
  }

  return hasRouteProtection(route) && hasInlineAdminOnlyCheck(route)
}

function hasInlineAdminOnlyCheck(route: RouteInfo): boolean {
  return /if\s*\(\s*(?:request\.)?user\.role\s*!==\s*['"]admin['"]\s*\)/.test(route.handler)
}

function isAdminLikeRoute(route: RouteInfo): boolean {
  if (route.options.includes('authenticateAdmin') || route.options.includes('requireAdmin')) return true
  if (route.file.startsWith('admin-')) return true
  if (route.path.startsWith('/api/admin') || route.path.includes('/admin')) return true
  if (hasInlineAdminOnlyCheck(route)) return true

  if (route.file === 'oauth.ts') {
    return [
      '/configs',
      '/configs/:provider'
    ].includes(route.path)
  }

  if (route.file === 'system-config.ts') {
    return [
      '/',
      '/default-quota',
      '/smtp/test',
      '/smtp/send-test'
    ].includes(route.path)
  }

  if (route.file === 'users.ts') {
    return [
      '/',
      '/lookup',
      '/:id/role',
      '/:id/quota/recalculate',
      '/:id/status',
      '/:id/sessions',
      '/:id/revoke-sessions',
      '/:id/reset-password',
      '/:id/disable-2fa',
      '/:id/oauth/:provider',
      '/:id/login-records',
      '/detect-linked-accounts',
      '/:id/hosting-balance/logs',
      '/:id/hosting-balance/adjust'
    ].includes(route.path)
  }

  return false
}

function hasRouteProtection(route: RouteInfo): boolean {
  return /onRequest|preHandler|websocket/.test(route.options) || route.fileHasAuthenticateHook
}

function isAllowedPublicOrTokenRoute(route: RouteInfo): boolean {
  const { file, path } = route

  if (file === 'auth.ts') {
    return [
      '/check-2fa',
      '/login',
      '/send-verification-code',
      '/register',
      '/refresh',
      '/logout',
      '/forgot-password/send-code',
      '/forgot-password/reset'
    ].includes(path)
  }

  if (file === 'oauth.ts') {
    return path === '/providers'
      || path.startsWith('/authorize/')
      || path.startsWith('/callback/')
      || path === '/exchange-code'
  }

  if (file === 'system-config.ts') return path === '/public'
  if (file === 'packages.ts') return path === '/public' || path.startsWith('/public/')
  if (file === 'help.ts') return !path.startsWith('/admin')

  if (file === 'agent.ts') {
    return [
      '/install.sh',
      '/manifest.json',
      '/install-config/:token',
      '/heartbeat'
    ].includes(path) || path.startsWith('/binary/')
  }

  if (file === 'hosts.ts') {
    return [
      '/install.sh',
      '/install.sh/:token',
      '/cert/:token',
      '/caddy-script/:token'
    ].includes(path)
  }

  if (file === 'telegram.ts') return path === '/webhook'
  if (file === 'recharge.ts') return path.startsWith('/api/recharge/callback/')
  if (file === 'backups.ts') return path === '/:instanceId/backups/export/:taskId/download'
  if (file === 'terminal.ts') return path === '/:id/terminal'

  return false
}

const routes = collectRoutes()
const adminLikeRoutes = routes.filter(isAdminLikeRoute)
const adminGuardFailures = adminLikeRoutes.filter(route => !hasAdminGuard(route))
const unprotectedRoutes = routes.filter(route => !hasRouteProtection(route) && !isAllowedPublicOrTokenRoute(route))

if (routes.length < 500) {
  throw new Error(`route parser found too few routes: ${routes.length}`)
}

if (adminLikeRoutes.length < 120) {
  throw new Error(`admin-like route scan covered too few routes: ${adminLikeRoutes.length}`)
}

if (adminGuardFailures.length > 0) {
  throw new Error(`admin-like routes missing admin guard:\n${adminGuardFailures.map(route => `${route.file}:${route.line} ${route.method} ${route.path}`).join('\n')}`)
}

if (unprotectedRoutes.length > 0) {
  throw new Error(`routes missing authentication or explicit public/token whitelist:\n${unprotectedRoutes.map(route => `${route.file}:${route.line} ${route.method} ${route.path}`).join('\n')}`)
}

console.log(`admin route guard checks passed (${routes.length} routes, ${adminLikeRoutes.length} admin-like routes)`)
