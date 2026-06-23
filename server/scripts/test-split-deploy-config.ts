import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function readTextFilesRecursively(root: string, extensions: Set<string>): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = []
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...readTextFilesRecursively(fullPath, extensions))
      continue
    }
    if (stat.isFile() && extensions.has(extname(entry))) {
      files.push({ path: fullPath, content: readFileSync(fullPath, 'utf8') })
    }
  }
  return files
}

function listRepoFilesRecursively(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root)) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'dist') {
      continue
    }

    const fullPath = join(root, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...listRepoFilesRecursively(fullPath))
      continue
    }
    if (stat.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

function assertIncludesAll(source: string, expected: string[], message: string): void {
  const missing = expected.filter(value => !source.includes(value))
  assert.deepEqual(missing, [], message)
}

const envExample = readRepoFile('.env.example')
const readme = readRepoFile('README.md')
const nginxExample = readRepoFile('deploy/nginx-split-intranet.conf.example')
const backendServiceExample = readRepoFile('deploy/incudal-backend.service.example')
const installPanel = readRepoFile('scripts/install-panel.sh')
const initEnv = readRepoFile('scripts/init-env.sh')
const verifySplitHost = readRepoFile('scripts/verify-split-host.sh')
const verifyProductionReadiness = readRepoFile('scripts/verify-production-readiness.sh')
const verifyLogHeaderExposure = readRepoFile('scripts/verify-log-header-exposure.sh')
const verifyLiveAcceptance = readRepoFile('scripts/verify-live-acceptance.sh')
const rootPackage = readRepoFile('package.json')
const serverPackage = readRepoFile('server/package.json')
const serverEnvConfig = readRepoFile('server/src/config/env.ts')
const originConfig = readRepoFile('server/src/lib/origin-config.ts')
const prismaConfig = readRepoFile('server/prisma.config.ts')
const verifyProductionDbReadiness = readRepoFile('server/src/scripts/verify-production-db-readiness.ts')
const releaseWorkflow = readRepoFile('.github/workflows/release.yml')
const splitAuthSmoke = readRepoFile('server/scripts/smoke-split-auth.ts')
const agentReleaseSmoke = readRepoFile('server/scripts/smoke-agent-release.ts')
const localNginxSplitSmoke = readRepoFile('scripts/smoke-local-nginx-split.sh')
const serverApp = readRepoFile('server/src/app.ts')
const viteConfig = readRepoFile('client/vite.config.ts')
const clientApi = readRepoFile('client/src/api/index.ts')
const clientApiUrl = readRepoFile('client/src/utils/api-url.ts')
const clientApp = readRepoFile('client/src/App.vue')
const terminalCore = readRepoFile('client/src/lib/terminal-core.ts')
const clientDistPath = resolve(repoRoot, 'client/dist')

function assertWebSocketProxyConfig(name: string, source: string, backendTarget: string): void {
  assert.ok(source.includes('location /api/ws/'), `${name} must define a dedicated /api/ws/ location`)
  assert.ok(source.includes(`proxy_pass ${backendTarget}`), `${name} WebSocket proxy must target the backend`)
  assert.ok(source.includes('proxy_http_version 1.1;'), `${name} WebSocket proxy must use HTTP/1.1`)
  assert.ok(source.includes('proxy_set_header Upgrade'), `${name} WebSocket proxy must forward Upgrade header`)
  assert.ok(source.includes('proxy_set_header Connection'), `${name} WebSocket proxy must forward Connection upgrade header`)
  assert.ok(source.includes('proxy_read_timeout 3600s;'), `${name} WebSocket proxy must use long read timeout`)
  assert.ok(source.includes('proxy_send_timeout 3600s;'), `${name} WebSocket proxy must use long send timeout`)
  assert.ok(source.includes('proxy_buffering off;'), `${name} WebSocket proxy must disable proxy buffering`)
}

function assertForwardedProxyHeaderConfig(name: string, source: string): void {
  assert.ok(source.includes('incudal_forwarded_proto'), `${name} must preserve forwarded proto through split Nginx`)
  assert.ok(source.includes('incudal_forwarded_host'), `${name} must preserve forwarded host through split Nginx`)
  assert.ok(source.includes('proxy_set_header X-Forwarded-Host'), `${name} must forward X-Forwarded-Host`)
  assert.ok(source.includes('proxy_set_header X-Forwarded-Proto') && source.includes('incudal_forwarded_proto'), `${name} must forward normalized X-Forwarded-Proto`)
}

function countOccurrences(source: string, pattern: string): number {
  return source.split(pattern).length - 1
}

function assertBalancedNginxBraces(name: string, source: string): void {
  let depth = 0
  for (const char of source) {
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    assert.ok(depth >= 0, `${name} must not close more Nginx blocks than it opens`)
  }
  assert.equal(depth, 0, `${name} must have balanced Nginx block braces`)
}

function assertSingleNginxSiteShape(name: string, source: string): void {
  assertBalancedNginxBraces(name, source)
  assert.equal(countOccurrences(source, 'server {'), 1, `${name} must define exactly one server block`)
  assert.equal(countOccurrences(source, 'location = /healthz {'), 1, `${name} must define exactly one /healthz location`)
  assert.equal(countOccurrences(source, 'location /api/ws/ {'), 1, `${name} must define exactly one /api/ws/ location`)
  assert.equal(countOccurrences(source, 'location /api/ {'), 1, `${name} must define exactly one /api/ location`)
  assert.equal(countOccurrences(source, 'location / {'), 1, `${name} must define exactly one SPA fallback location`)
  assert.equal(countOccurrences(source, 'add_header Content-Security-Policy'), 1, `${name} must define exactly one CSP header`)
  assert.equal(countOccurrences(source, 'add_header X-Content-Type-Options'), 1, `${name} must define exactly one nosniff header`)
  assert.equal(countOccurrences(source, 'add_header X-Frame-Options'), 1, `${name} must define exactly one frame-options header`)
  assert.equal(countOccurrences(source, 'add_header Referrer-Policy'), 1, `${name} must define exactly one referrer-policy header`)
  assert.equal(countOccurrences(source, 'add_header Strict-Transport-Security'), 1, `${name} must define exactly one HSTS header`)
}

function extractHeredoc(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing heredoc start: ${startMarker}`)
  const bodyStart = source.indexOf('\n', start)
  assert.notEqual(bodyStart, -1, `missing heredoc body: ${startMarker}`)
  const end = source.indexOf(endMarker, bodyStart + 1)
  assert.notEqual(end, -1, `missing heredoc end: ${endMarker}`)
  return source.slice(bodyStart + 1, end)
}

assert.match(envExample, /^PORT=3001$/m, '.env.example must default backend PORT to 3001')
assert.match(envExample, /^SERVE_STATIC_CLIENT=false$/m, '.env.example must default backend static serving off for split deployment')
assert.match(envExample, /^VITE_API_BASE_URL=\/api$/m, '.env.example must default frontend API base to same-origin /api')
assert.match(envExample, /^ADMIN_FRONTEND_URL=https:\/\/admin\.payincus\.com$/m, '.env.example must define the separate admin frontend origin')
assert.match(envExample, /^VITE_CUSTOMER_BASE_URL=https:\/\/pay\.payincus\.com$/m, '.env.example must define the customer frontend origin for admin-generated customer links')
assert.match(envExample, /^VITE_ADMIN_BASE_URL=https:\/\/admin\.payincus\.com$/m, '.env.example must define the user frontend admin redirect origin')
assert.match(envExample, /^PAYMENT_CALLBACK_BASE_URL=https:\/\/pay\.payincus\.com$/m, '.env.example must default payment callbacks to the public customer frontend origin')
assert.match(envExample, /^COOKIE_SAME_SITE=$/m, '.env.example must leave SameSite unset for HTTPS same-origin proxy deployments')
assert.match(envExample, /^COOKIE_SECURE=$/m, '.env.example must leave secure-cookie auto mode enabled by default')
assert.match(envExample, /^COOKIE_DOMAIN=$/m, '.env.example must not set a cookie domain by default')
assert.ok(
  envExample.includes('Customer/admin subdomains must not share refresh cookies') &&
    readme.includes('`COOKIE_DOMAIN` 必须保持空值') &&
    installPanel.includes('COOKIE_DOMAIN must stay empty so customer/admin subdomains do not share refresh cookies'),
  'split deployment docs must require COOKIE_DOMAIN to stay empty for customer/admin cookie isolation'
)
assert.ok(serverApp.includes("parseInt(process.env.PORT || '3001', 10)"), 'backend runtime must fall back to split backend port 3001 when PORT is missing')
assert.ok(
  serverApp.includes("const shouldServeStaticClient = process.env.NODE_ENV === 'production' && process.env.SERVE_STATIC_CLIENT !== 'false'"),
  'backend runtime must honor SERVE_STATIC_CLIENT=false before registering static frontend routes'
)
assert.match(installPanel, /^readonly DEFAULT_PORT=3001$/m, 'install script must default backend port to 3001')
assert.ok(initEnv.includes('set_env_if_missing "PORT" "3001" "后端监听端口"'), 'init-env script must default backend PORT to 3001')
assert.ok(initEnv.includes('set_env_if_missing "SERVE_STATIC_CLIENT" "false" "后端静态文件服务开关"'), 'init-env script must default SERVE_STATIC_CLIENT=false')
assert.ok(initEnv.includes('set_env_if_missing "VITE_API_BASE_URL" "/api" "前端 API 基础路径"'), 'init-env script must default VITE_API_BASE_URL=/api')
assert.ok(initEnv.includes('set_env_if_missing "VITE_CUSTOMER_BASE_URL" "" "管理后台生成客户链接的前端地址"'), 'init-env script must preserve the customer frontend URL for admin-generated customer links')
assert.ok(initEnv.includes('set_env_if_missing "VITE_ADMIN_BASE_URL" "" "客户前端管理后台地址"'), 'init-env script must preserve the admin frontend URL for customer admin redirects')
assert.ok(initEnv.includes('set_env_if_missing "INCUDAL_AGENT_RELEASE_DIR" "" "Agent 本地 Release 目录"'), 'init-env script must expose the local Agent release directory setting')
assert.ok(
  installPanel.includes('set_env_if_value()') &&
    installPanel.includes('set_env_if_value "PORT" "3000" "${DEFAULT_PORT}" "后端监听端口（迁移旧版前端端口）"'),
  'install script must migrate existing old PORT=3000 env files to the backend split port 3001'
)
assert.ok(installPanel.includes('set_env_if_missing "SERVE_STATIC_CLIENT" "false" "后端静态文件服务开关"'), 'install script must preserve split backend static-off mode')
assert.ok(installPanel.includes('set_env_if_missing "VITE_API_BASE_URL" "/api" "前端 API 基础路径"'), 'install script must preserve same-origin /api frontend build mode')
assert.ok(installPanel.includes('set_env_if_missing "VITE_CUSTOMER_BASE_URL" "" "管理后台生成客户链接的前端地址"'), 'install script must preserve the customer frontend URL for admin-generated customer links')
assert.ok(installPanel.includes('set_env_if_missing "VITE_ADMIN_BASE_URL" "" "客户前端管理后台地址"'), 'install script must preserve the admin frontend URL for customer admin redirects')
assert.ok(installPanel.includes('set_env_if_missing "INCUDAL_AGENT_RELEASE_DIR" "" "Agent 本地 Release 目录"'), 'install script must preserve the local Agent release directory setting')
assert.ok(installPanel.includes('SERVE_STATIC_CLIENT=false'), 'generated production env must disable backend static serving')
assert.ok(installPanel.includes('VITE_API_BASE_URL=/api'), 'generated production env must keep frontend API traffic under /api')
assert.ok(installPanel.includes('ADMIN_FRONTEND_URL=') && installPanel.includes('VITE_CUSTOMER_BASE_URL=') && installPanel.includes('VITE_ADMIN_BASE_URL='), 'generated production env must include split user/admin frontend URL settings')
assert.ok(installPanel.includes('INCUDAL_AGENT_RELEASE_DIR='), 'generated production env must include the local Agent release directory setting')
assert.ok(
  verifySplitHost.includes('BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"'),
  'split verify script must default backend URL to port 3001'
)
assert.ok(rootPackage.includes('"smoke:split:auth": "pnpm --filter server smoke:split:auth"'), 'root package must expose split auth smoke script')
assert.ok(
  rootPackage.includes('VITE_APP_ENTRY=admin VITE_CUSTOMER_BASE_URL=http://127.0.0.1:3000 VITE_DEV_PORT=3002'),
  'root dev scripts must point admin-generated customer links at the local user frontend'
)
assert.ok(serverPackage.includes('"smoke:split:auth": "node --import tsx scripts/smoke-split-auth.ts"'), 'server package must expose split auth smoke script')
assert.ok(splitAuthSmoke.includes('frontend proxied /api/health'), 'split auth smoke must verify frontend /api proxy')
assert.ok(splitAuthSmoke.includes('/api/auth/refresh'), 'split auth smoke must verify refresh token cookie flow')
assert.ok(splitAuthSmoke.includes('anonymous admin boundary'), 'split auth smoke must verify anonymous admin boundary')
assert.ok(rootPackage.includes('"smoke:agent-release": "pnpm --filter server smoke:agent-release"'), 'root package must expose Agent release smoke script')
assert.ok(serverPackage.includes('"smoke:agent-release": "node --import tsx scripts/smoke-agent-release.ts"'), 'server package must expose Agent release smoke script')
assert.ok(localNginxSplitSmoke.includes('RUN_AGENT_RELEASE_SMOKE') && localNginxSplitSmoke.includes('pnpm --filter server smoke:agent-release'), 'local nginx split smoke must run the Agent release smoke by default')
assert.ok(
  localNginxSplitSmoke.includes('ADMIN_LOCAL_NGINX_PORT="${ADMIN_LOCAL_NGINX_PORT:-$((LOCAL_NGINX_PORT + 1))}"') &&
    localNginxSplitSmoke.includes('ADMIN_CLIENT_DIST="${ADMIN_CLIENT_DIST:-$(pwd)/client/dist/admin}"') &&
    localNginxSplitSmoke.includes('ADMIN_FRONTEND_URL="http://127.0.0.1:${ADMIN_LOCAL_NGINX_PORT}"') &&
    localNginxSplitSmoke.includes('ADMIN_FRONTEND_URL="$ADMIN_FRONTEND_URL" BACKEND_URL="$BACKEND_URL" bash scripts/verify-split-host.sh'),
  'local nginx split smoke must mount and verify a separate admin frontend'
)
assert.ok(
  agentReleaseSmoke.includes('/api/agent/install.sh') &&
    agentReleaseSmoke.includes('/api/agent/binary/incudal-agent-linux-amd64?v=v0.0.1') &&
    agentReleaseSmoke.includes('AGENT_BINARY_QUERY_INCOMPLETE') &&
    agentReleaseSmoke.includes('INVALID_AGENT_BINARY_NAME'),
  'Agent release smoke must cover install script serving and deterministic binary download rejection paths'
)
assert.ok(readme.includes('INCUDAL_AGENT_RELEASE_REPOSITORY=VipMaxxxx/payincus'), 'README must document the current Agent release repository')
assert.ok(backendServiceExample.includes('Documentation=https://github.com/VipMaxxxx/payincus'), 'systemd backend example must point documentation to the current repository')
assert.ok(
  installPanel.includes('readonly GITHUB_REPO="VipMaxxxx/payincus"') &&
    installPanel.includes('# 项目地址: https://github.com/VipMaxxxx/payincus'),
  'install script must download panel releases from the current repository'
)
assert.ok(verifySplitHost.includes('fetch_url "frontend proxied API" "$FRONTEND_URL/api/health"'), 'split verify script must verify frontend /api proxy')
assert.ok(
  verifySplitHost.includes('fetch_websocket_probe "frontend proxied WebSocket" "$FRONTEND_URL/api/ws/instances/1/terminal?ticket=invalid"') &&
    verifySplitHost.includes("grep -Eq '^HTTP/[0-9.]+ 101 '") &&
    verifySplitHost.includes("grep -Eiq '^upgrade:[[:space:]]*websocket'"),
  'split verify script must verify frontend /api/ws WebSocket upgrade proxy'
)
assert.ok(
  verifySplitHost.includes('assert_no_frontend_backend_origin_leaks "$tmp_dir/frontend.html" "frontend index"') &&
    verifySplitHost.includes('fetch_static_asset "$asset_path" "$asset_output"') &&
    verifySplitHost.includes('https?://(localhost|127\\.0\\.0\\.1):(3001|8888|43173)\\b|VITE_API_BASE_URL'),
  'split verify script must scan live frontend index and built assets for hardcoded backend/dev API origins'
)
assert.ok(
  verifySplitHost.includes('fetch_url_with_headers "admin frontend index" "$ADMIN_FRONTEND_URL/"') &&
    verifySplitHost.includes('fetch_url "admin static asset ${asset_path}" "${ADMIN_FRONTEND_URL}${asset_path}"') &&
    verifySplitHost.includes('fetch_websocket_probe "admin frontend proxied WebSocket" "$ADMIN_FRONTEND_URL/api/ws/instances/1/terminal?ticket=invalid"'),
  'split verify script must scan admin frontend assets and verify admin /api/ws proxy'
)
assert.ok(
    backendServiceExample.includes('Environment=NPM_CONFIG_CACHE=/opt/incudal/.npm') &&
    backendServiceExample.includes('Environment=XDG_CACHE_HOME=/opt/incudal/.cache') &&
    backendServiceExample.includes('WorkingDirectory=/opt/incudal/current') &&
    backendServiceExample.includes('NoNewPrivileges=false') &&
    backendServiceExample.includes('pnpm exec prisma migrate deploy') &&
    !backendServiceExample.includes('npx prisma'),
  'systemd backend example must keep runtime cache paths writable, allow restricted online-update sudo, and run locked local Prisma migrations under ProtectSystem=strict'
)
assertIncludesAll(
  backendServiceExample,
  [
    'ReadWritePaths=',
    '/opt/incudal',
    '/opt/incudal/current',
    '/opt/incudal/releases',
    '/opt/incudal/server/certs',
    '/opt/incudal/plugins',
    '/opt/incudal/plugin-data',
    '/opt/incudal/plugin-logs',
    '/opt/incudal/plugin-staging',
    '/opt/incudal/.npm',
    '/opt/incudal/.cache',
    '/opt/incudal/.git',
    '/opt/incudal/update-logs'
  ],
  'systemd backend example must keep all runtime, cache, git, update and plugin paths writable'
)
assert.ok(
    installPanel.includes('Environment=NPM_CONFIG_CACHE=${INSTALL_DIR}/.npm') &&
    installPanel.includes('Environment=XDG_CACHE_HOME=${INSTALL_DIR}/.cache') &&
    installPanel.includes('app_dir="${INSTALL_DIR}/current"') &&
    installPanel.includes('NoNewPrivileges=false') &&
    installPanel.includes('pnpm exec prisma migrate deploy') &&
    !installPanel.includes('npx prisma'),
  'install script systemd service must keep runtime cache paths writable, allow restricted online-update sudo, and run locked local Prisma migrations under ProtectSystem=strict'
)
assertIncludesAll(
  installPanel,
  [
    'ReadWritePaths=',
    '${INSTALL_DIR}',
    '${INSTALL_DIR}/current',
    '${INSTALL_DIR}/releases',
    '${INSTALL_DIR}/server/certs',
    '${INSTALL_DIR}/plugins',
    '${INSTALL_DIR}/plugin-data',
    '${INSTALL_DIR}/plugin-logs',
    '${INSTALL_DIR}/plugin-staging',
    '${INSTALL_DIR}/.npm',
    '${INSTALL_DIR}/.cache',
    '${INSTALL_DIR}/.git',
    '${INSTALL_DIR}/update-logs'
  ],
  'install script systemd service must keep all runtime, cache, git, update and plugin paths writable'
)

assert.ok(viteConfig.includes('const devPort = Number(process.env.VITE_DEV_PORT || 3000)'), 'Vite dev server must default frontend port to 3000')
assert.ok(viteConfig.includes("const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:3001'"), 'Vite dev proxy must default to backend port 3001')
assert.ok(viteConfig.includes("const appEntry = process.env.VITE_APP_ENTRY === 'admin' ? 'admin' : 'user'"), 'Vite config must select the frontend app entry from VITE_APP_ENTRY')
assert.ok(viteConfig.includes("const entryScript = appEntry === 'admin' ? '/src/admin/main.ts' : '/src/main.ts'"), 'Vite config must switch index.html between user and admin entry scripts')
assert.ok(viteConfig.includes("const apiClientEntry = appEntry === 'admin' ? './src/api/admin.ts' : './src/api/index.ts'"), 'Vite config must select the API client from VITE_APP_ENTRY')
assert.ok(viteConfig.includes("const appPathsEntry = appEntry === 'admin' ? './src/utils/app-paths-admin.ts' : './src/utils/app-paths-user.ts'"), 'Vite config must select the URL path helper from VITE_APP_ENTRY')
assert.ok(
  viteConfig.includes("const sideNavItemsEntry = appEntry === 'admin'") &&
    viteConfig.includes("'./src/config/side-nav-items-admin.ts'") &&
    viteConfig.includes("'./src/config/side-nav-items-user.ts'"),
  'Vite config must select the SideNav menu table from VITE_APP_ENTRY'
)
assert.ok(
  viteConfig.includes('find: /^@\\/api$/') &&
    viteConfig.includes('replacement: fileURLToPath(new URL(apiClientEntry, import.meta.url))'),
  'Vite config must exact-alias shared @/api imports to the current entry API client'
)
assert.ok(
  viteConfig.includes('find: /^@\\/utils\\/app-paths$/') &&
    viteConfig.includes('replacement: fileURLToPath(new URL(appPathsEntry, import.meta.url))'),
  'Vite config must exact-alias shared app path helpers to the current entry path table'
)
assert.ok(
  viteConfig.includes('find: /^@\\/config\\/side-nav-items$/') &&
    viteConfig.includes('replacement: fileURLToPath(new URL(sideNavItemsEntry, import.meta.url))'),
  'Vite config must exact-alias SideNav menu items to the current entry menu table'
)
assert.ok(viteConfig.includes("order: 'pre'"), 'Vite split entry transform must run before index.html entry scanning')
assert.ok(viteConfig.includes('outDir: `dist/${appEntry}`'), 'Vite config must build user and admin frontends into separate dist directories')
assert.ok(viteConfig.includes("'/api':") && viteConfig.includes('ws: true'), 'Vite dev proxy must proxy /api including WebSocket traffic')
assert.ok(
  viteConfig.includes("return 'api-client'") &&
    viteConfig.includes("normalizedId.includes('/src/api/admin.ts')") &&
    viteConfig.includes("return 'locale-zh-cn'") &&
    viteConfig.includes("return 'locale-zh-tw'") &&
    viteConfig.includes("return 'locale-en'") &&
    viteConfig.includes("return 'xterm-core'") &&
    viteConfig.includes("return 'xterm-addons'"),
  'Vite production build must keep large API, locale, and xterm dependencies split into stable chunks'
)
assert.ok(
  rootPackage.includes('"pnpm"') &&
    rootPackage.includes('"overrides"') &&
    rootPackage.includes('"caniuse-lite": "^1.0.30001799"') &&
    rootPackage.includes('"baseline-browser-mapping": "^2.10.38"'),
  'root package must pin current Browserslist data through pnpm overrides so production builds do not emit stale browser-data warnings'
)
assert.ok(rootPackage.includes('"verify:production": "bash scripts/verify-production-readiness.sh"'), 'root package must expose production readiness verification')
assert.ok(rootPackage.includes('"verify:log-header": "bash scripts/verify-log-header-exposure.sh"'), 'root package must expose production log/header exposure verification')
assert.ok(rootPackage.includes('"verify:live-acceptance": "bash scripts/verify-live-acceptance.sh"'), 'root package must expose live acceptance verification')
assert.ok(
  rootPackage.includes('"verify:final-acceptance": "FINAL_ACCEPTANCE_MODE=1 RUN_PRODUCTION_PREFLIGHT=1 RUN_SPLIT_AUTH_SMOKE=1 RUN_AGENT_RELEASE_SMOKE=1 RUN_LOG_HEADER_CHECK=1 REQUIRE_LIVE_PROOF_REFS=1 bash scripts/verify-live-acceptance.sh"'),
  'root package must expose strict final acceptance verification'
)
assert.ok(
  serverPackage.includes('"verify:production-db": "node dist/scripts/verify-production-db-readiness.js"'),
  'server package must run production DB readiness from compiled dist output so release installs do not need tsx/dev sources'
)
assert.ok(
  serverPackage.includes('"prisma": "^7.1.0"') &&
    serverPackage.indexOf('"prisma": "^7.1.0"') < serverPackage.indexOf('"devDependencies"'),
  'server package must keep the Prisma CLI in production dependencies because release startup/migration uses prisma migrate deploy'
)
assert.ok(
  releaseWorkflow.includes('cp pnpm-lock.yaml release/') &&
    releaseWorkflow.includes('pnpm install --prod --frozen-lockfile --ignore-scripts --filter server') &&
    releaseWorkflow.includes('pnpm --filter server exec prisma generate') &&
    !releaseWorkflow.includes('npm install --omit=dev') &&
    !releaseWorkflow.includes('npx prisma') &&
    releaseWorkflow.includes('cp scripts/verify-production-readiness.sh release/scripts/') &&
    releaseWorkflow.includes('cp scripts/verify-log-header-exposure.sh release/scripts/') &&
    releaseWorkflow.includes('cp scripts/verify-live-acceptance.sh release/scripts/') &&
    releaseWorkflow.includes('cp scripts/verify-split-host.sh release/scripts/'),
  'release workflow must package production verification scripts and install server production dependencies through the pnpm lockfile'
)
assert.ok(
  readme.includes('pnpm verify:production') &&
    readme.includes('RUN_LIVE_CHECKS=0 pnpm verify:production') &&
    readme.includes('pnpm verify:final-acceptance') &&
    readme.includes('REQUIRE_LIVE_PROOF_REFS=1') &&
    readme.includes('强制开启生产预检') &&
    readme.includes('登录/权限 smoke') &&
    readme.includes('占位文字必须替换') &&
    readme.includes('LIVE_PAYMENT_PROOF_REF') &&
    readme.includes('LIVE_LOG_HEADER_PROOF_REF'),
  'README must document production readiness verification, config-only mode, live acceptance wrapper, and live proof references'
)
assert.ok(
  serverEnvConfig.includes("process.env.ENV_FILE ? resolve(process.env.ENV_FILE) : ''") &&
    serverEnvConfig.includes('candidateEnvFiles.filter(Boolean)'),
  'server env loader must honor ENV_FILE so production DB readiness can read the same env file as shell preflight'
)
assert.ok(
  !prismaConfig.includes('./src/') &&
    prismaConfig.includes('process.env.ENV_FILE ? resolve(process.env.ENV_FILE) : ""') &&
    prismaConfig.includes('resolve(process.cwd(), "../.env")') &&
    prismaConfig.includes('loadEnv({ path: envPath, override: false, quiet: true })'),
  'Prisma config must load env files without depending on server/src so release packages can run prisma generate/migrate from compiled artifacts only'
)
assert.ok(
  verifyProductionReadiness.includes('require_equals NODE_ENV "$NODE_ENV_VALUE" production') &&
    verifyProductionReadiness.includes('require_equals PORT "$PORT_VALUE" 3001') &&
    verifyProductionReadiness.includes('require_equals SERVE_STATIC_CLIENT "$SERVE_STATIC_CLIENT_VALUE" false') &&
    verifyProductionReadiness.includes('require_equals VITE_API_BASE_URL "$VITE_API_BASE_URL_VALUE" /api') &&
    verifyProductionReadiness.includes('require_equals TRUST_PROXY "$TRUST_PROXY_VALUE" true') &&
    verifyProductionReadiness.includes('require_equals PAYMENT_CALLBACK_SKIP_IP_WHITELIST "$PAYMENT_CALLBACK_SKIP_IP_WHITELIST_VALUE" false'),
  'production readiness verifier must enforce split production environment invariants'
)
assert.ok(
  verifyProductionReadiness.includes('validate_ip_whitelist "$PAYMENT_CALLBACK_IP_WHITELIST_VALUE"') &&
    verifyProductionReadiness.includes('PAYMENT_CALLBACK_IP_WHITELIST contains an invalid IP') &&
    verifyProductionReadiness.includes('PAYMENT_CALLBACK_IP_WHITELIST is empty; provider-specific defaults apply only where the backend implements them'),
  'production readiness verifier must reject malformed payment callback IP whitelist config and warn when it is empty'
)
assert.ok(
  verifyProductionReadiness.includes('validate_https_public_url FRONTEND_URL "$FRONTEND_URL_VALUE"') &&
    verifyProductionReadiness.includes('validate_https_public_url ADMIN_FRONTEND_URL "$ADMIN_FRONTEND_URL_VALUE"') &&
    verifyProductionReadiness.includes('validate_https_public_url SITE_URL "$SITE_URL_VALUE"') &&
    verifyProductionReadiness.includes('validate_https_public_url PAYMENT_CALLBACK_BASE_URL "$PAYMENT_CALLBACK_BASE_URL_VALUE"'),
  'production readiness verifier must require public HTTPS frontend/admin/site/payment callback URLs'
)
assert.ok(
  verifyProductionReadiness.includes('ADMIN_FRONTEND_URL must be a separate admin frontend origin') &&
    verifyProductionReadiness.includes('COOKIE_DOMAIN_VALUE="$(config_value COOKIE_DOMAIN)"') &&
    verifyProductionReadiness.includes('COOKIE_DOMAIN must stay empty so customer and admin subdomains do not share refresh cookies') &&
    verifyProductionReadiness.includes('ADMIN_FRONTEND_URL="$ADMIN_FRONTEND_URL_VALUE"'),
  'production readiness verifier must require and verify a separate admin frontend origin'
)
assert.ok(
  verifyProductionReadiness.includes('AGENT_RELEASE_DIR_VALUE="$(config_value INCUDAL_AGENT_RELEASE_DIR)"') &&
    verifyProductionReadiness.includes('INCUDAL_AGENT_RELEASE_DIR must be an absolute path') &&
    verifyProductionReadiness.includes('INCUDAL_AGENT_RELEASE_REPOSITORY or INCUDAL_AGENT_RELEASE_DIR is required unless INCUDAL_AGENT_BINARY_URL and INCUDAL_AGENT_BINARY_SHA256 are configured') &&
    verifyProductionReadiness.includes('require_sha256 INCUDAL_AGENT_BINARY_SHA256 "$AGENT_BINARY_SHA256_VALUE"'),
  'production readiness verifier must require a GitHub Agent release path, local release directory, or checksum-pinned custom binary'
)
assert.ok(
  verifyProductionReadiness.includes('FRONTEND_URL="$FRONTEND_URL_VALUE" ADMIN_FRONTEND_URL="$ADMIN_FRONTEND_URL_VALUE" BACKEND_URL="$BACKEND_URL_VALUE" bash scripts/verify-split-host.sh') &&
    verifyProductionReadiness.includes('/api/agent/manifest.json') &&
    verifyProductionReadiness.includes('Agent manifest must include ${platform} name and sha256') &&
    verifyProductionReadiness.includes('ALLOW_MISSING_AGENT_RELEASE=true'),
  'production readiness verifier must run split host checks and verify Agent manifest availability unless explicitly waived'
)
assert.ok(
  verifyProductionReadiness.includes('RUN_DB_CHECKS="${RUN_DB_CHECKS:-$RUN_LIVE_CHECKS}"') &&
    verifyProductionReadiness.includes('ENV_FILE="$ENV_FILE" pnpm --filter server verify:production-db'),
  'production readiness verifier must run DB readiness checks by default in full mode while allowing config-only skips'
)
assert.ok(
  verifyLogHeaderExposure.includes('assert_header "$tmp_dir/frontend.headers" "content-security-policy"') &&
    verifyLogHeaderExposure.includes('x-content-type-options') &&
    verifyLogHeaderExposure.includes('x-frame-options') &&
    verifyLogHeaderExposure.includes('referrer-policy'),
  'log/header exposure verifier must check production frontend security headers'
)
assert.ok(
  verifyLogHeaderExposure.includes('backend root served frontend HTML') &&
    verifyLogHeaderExposure.includes('SERVE_STATIC_CLIENT may be enabled'),
  'log/header exposure verifier must fail if the backend serves the frontend HTML'
)
assert.ok(
  verifyLogHeaderExposure.includes('SECRET_SCAN_KEYS') &&
    verifyLogHeaderExposure.includes('log output contains the current value of ${key}') &&
    verifyLogHeaderExposure.includes('refreshToken=') &&
    verifyLogHeaderExposure.includes('DATABASE_URL=postgresql://'),
  'log/header exposure verifier must scan logs for configured secret values and sensitive token patterns without printing values'
)
assert.ok(
  verifyLiveAcceptance.includes('RUN_SPLIT_AUTH_SMOKE="${RUN_SPLIT_AUTH_SMOKE:-0}"') &&
  verifyLiveAcceptance.includes('RUN_RECHARGE_CALLBACK_SMOKE="${RUN_RECHARGE_CALLBACK_SMOKE:-0}"') &&
    verifyLiveAcceptance.includes('RUN_AGENT_HEARTBEAT_SMOKE="${RUN_AGENT_HEARTBEAT_SMOKE:-0}"') &&
    verifyLiveAcceptance.includes('RUN_AGENT_RELEASE_SMOKE="${RUN_AGENT_RELEASE_SMOKE:-1}"'),
  'live acceptance wrapper must default mutating smoke checks off while keeping non-mutating Agent release smoke on'
)
assert.ok(
  verifyLiveAcceptance.includes('pnpm verify:production') &&
    verifyLiveAcceptance.includes('pnpm verify:log-header') &&
    verifyLiveAcceptance.includes('pnpm smoke:split:auth') &&
    verifyLiveAcceptance.includes('pnpm smoke:agent-release') &&
    verifyLiveAcceptance.includes('LIVE_ACCEPTANCE_REPORT') &&
    verifyLiveAcceptance.includes('## Run Configuration') &&
    verifyLiveAcceptance.includes('FINAL_ACCEPTANCE_MODE="${FINAL_ACCEPTANCE_MODE:-0}"') &&
    verifyLiveAcceptance.includes('FINAL_ACCEPTANCE_MODE: ${FINAL_ACCEPTANCE_MODE}') &&
    verifyLiveAcceptance.includes('RUN_PRODUCTION_PREFLIGHT: ${RUN_PRODUCTION_PREFLIGHT}') &&
    verifyLiveAcceptance.includes('RUN_SPLIT_AUTH_SMOKE: ${RUN_SPLIT_AUTH_SMOKE}') &&
    verifyLiveAcceptance.includes('RUN_LOG_HEADER_CHECK: ${RUN_LOG_HEADER_CHECK}') &&
    verifyLiveAcceptance.includes('REQUIRE_LIVE_PROOF_REFS="${REQUIRE_LIVE_PROOF_REFS:-0}"') &&
    verifyLiveAcceptance.includes('REQUIRE_LIVE_PROOF_REFS: ${REQUIRE_LIVE_PROOF_REFS}') &&
    verifyLiveAcceptance.includes('LIVE_ACCEPTANCE_REPORT is required when REQUIRE_LIVE_PROOF_REFS=1') &&
    verifyLiveAcceptance.includes('RUN_PRODUCTION_PREFLIGHT must be 1 when FINAL_ACCEPTANCE_MODE=1') &&
    verifyLiveAcceptance.includes('RUN_SPLIT_AUTH_SMOKE must be 1 when FINAL_ACCEPTANCE_MODE=1') &&
    verifyLiveAcceptance.includes('RUN_AGENT_RELEASE_SMOKE must be 1 when FINAL_ACCEPTANCE_MODE=1') &&
    verifyLiveAcceptance.includes('RUN_LOG_HEADER_CHECK must be 1 when FINAL_ACCEPTANCE_MODE=1') &&
    verifyLiveAcceptance.includes('REQUIRE_LIVE_PROOF_REFS must be 1 when FINAL_ACCEPTANCE_MODE=1') &&
    verifyLiveAcceptance.includes('is_live_proof_placeholder()') &&
    verifyLiveAcceptance.includes('append_report "- ${key}: placeholder"') &&
    verifyLiveAcceptance.includes('REPORT_FRONTEND_URL="${FRONTEND_URL_VALUE:-<missing>}"') &&
    verifyLiveAcceptance.includes('ACCEPTED_WARNINGS_NOTE="${ACCEPTED_WARNINGS_NOTE:-}"') &&
    verifyLiveAcceptance.includes('ACCEPTED_WARNINGS_OWNER is required when ACCEPTED_WARNINGS_NOTE is set') &&
    verifyLiveAcceptance.includes('ACCEPTED_WARNINGS_DATE must use YYYY-MM-DD') &&
    verifyLiveAcceptance.includes('## Accepted Warnings') &&
    verifyLiveAcceptance.includes('LIVE_PAYMENT_PROOF_REF="${LIVE_PAYMENT_PROOF_REF:-}"') &&
    verifyLiveAcceptance.includes('## Live Proof References') &&
    verifyLiveAcceptance.includes('final_go_status: pending_live_proof') &&
    verifyLiveAcceptance.includes('final_go_status: live_proof_references_documented') &&
    verifyLiveAcceptance.includes('Live proof references are required when REQUIRE_LIVE_PROOF_REFS=1') &&
    verifyLiveAcceptance.includes('ADMIN_PASSWORD_VALUE="$(config_value ADMIN_PASSWORD)"') &&
    verifyLiveAcceptance.includes('[[ -z "${SMOKE_ADMIN_PASSWORD:-}" && -z "$ADMIN_PASSWORD_VALUE" ]]') &&
    verifyLiveAcceptance.includes('log_header_exposure_check: passed') &&
    verifyLiveAcceptance.includes('trap finalize_report_on_exit EXIT') &&
    verifyLiveAcceptance.includes('status: failed_or_interrupted') &&
    verifyLiveAcceptance.includes('Manual proof still required before final Go'),
  'live acceptance wrapper must orchestrate automated checks, support success/failure evidence reporting, and print the remaining manual proof list'
)
assert.ok(
  verifyLiveAcceptance.indexOf('REPORT_INITIALIZED=1') < verifyLiveAcceptance.indexOf('ACCEPTED_WARNINGS_OWNER is required when ACCEPTED_WARNINGS_NOTE is set'),
  'live acceptance wrapper must initialize the evidence report before accepted-warning validation can fail'
)
assert.ok(
  verifyLiveAcceptance.indexOf('REPORT_INITIALIZED=1') < verifyLiveAcceptance.indexOf('FRONTEND_URL is required'),
  'live acceptance wrapper must initialize the evidence report before missing FRONTEND_URL validation can fail'
)
assert.ok(
  verifyProductionDbReadiness.includes('await checkDatabaseConnectivity()') &&
    verifyProductionDbReadiness.includes('await checkPaymentProviders()') &&
    verifyProductionDbReadiness.includes('await checkSmtpConfig()') &&
    verifyProductionDbReadiness.includes('await checkLskyConfig()') &&
    verifyProductionDbReadiness.includes('await checkResourceDeliveryConfig()'),
  'production DB readiness must cover DB connectivity, active payment providers, SMTP, Lsky, and resource delivery configuration'
)
assert.ok(
  verifyProductionDbReadiness.includes('getAllPaymentProviders()') &&
    verifyProductionDbReadiness.includes('No active payment providers are configured') &&
    verifyProductionDbReadiness.includes('uses unsupported provider type for recharge') &&
    verifyProductionDbReadiness.includes('apiurl is not a safe outbound HTTP(S) URL'),
  'production DB readiness must inspect active payment provider availability and outbound API URL safety'
)
assert.ok(
  verifyProductionDbReadiness.includes("smtp_enabled=true but smtp_host is empty") &&
    verifyProductionDbReadiness.includes('Lsky ticket image upload is not configured') &&
    verifyProductionDbReadiness.includes('ticket_image_lsky_api_version must be v1 or v2'),
  'production DB readiness must identify incomplete SMTP and Lsky configuration'
)
assert.ok(
  verifyProductionDbReadiness.includes('No online hosts are configured') &&
    verifyProductionDbReadiness.includes('No visible system images are configured') &&
    verifyProductionDbReadiness.includes('No active global-shared packages are configured') &&
    verifyProductionDbReadiness.includes('is active but not bound to any host') &&
    verifyProductionDbReadiness.includes('has no compatible visible image on its online bound hosts'),
  'production DB readiness must identify resource delivery prerequisites for hosts, images, and public packages'
)
assert.ok(
  verifyProductionDbReadiness.includes('is online but isInstalled=false') &&
    verifyProductionDbReadiness.includes('Incus API enableApi=false') &&
    verifyProductionDbReadiness.includes('has no Agent credentials') &&
    verifyProductionDbReadiness.includes('Agent is disabled') &&
    verifyProductionDbReadiness.includes('Agent heartbeat is older than 5 minutes') &&
    verifyProductionDbReadiness.includes('Agent lastReport.resources is empty') &&
    verifyProductionDbReadiness.includes('Running instances on online hosts are missing traffic snapshots') &&
    verifyProductionDbReadiness.includes('Running instances exist on hosts without a fresh online Agent heartbeat'),
  'production DB readiness must identify online host install/API/Agent heartbeat/reporting and traffic-baseline readiness issues'
)
assert.ok(clientApi.includes("const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'"), 'client axios base URL must default to same-origin /api')
assert.ok(clientApi.includes('withCredentials: true'), 'client axios must include credentials so cross-site API refresh cookies can be stored and sent')
assert.equal(
  clientApi.match(/fetch\(buildApiUrl\('\/auth\/refresh'\), \{[\s\S]*?credentials: 'include'/g)?.length ?? 0,
  2,
  'client refresh-token fetch calls in API interceptors must include credentials'
)
assert.ok(
  clientApp.includes("fetch(buildApiUrl('/auth/refresh'), {") &&
    clientApp.includes("credentials: 'include'"),
  'client scheduled refresh-token fetch must include credentials'
)
assert.ok(clientApiUrl.includes("const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'"), 'client API URL helper must default to same-origin /api')
assert.ok(clientApiUrl.includes('export function buildApiWebSocketUrl') && clientApiUrl.includes("const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'"), 'client WebSocket URLs must derive from API base URL and current origin')
assert.ok(terminalCore.includes("buildApiWebSocketUrl(`/ws/instances/${instanceId}/terminal?ticket=${encodeURIComponent(ticket)}`)"), 'terminal WebSocket path must stay under /api/ws via buildApiWebSocketUrl')

assert.ok(
  readme.includes('用户浏览器') &&
    readme.includes('管理员浏览器') &&
    readme.includes('/api, /api/ws -> http://10.0.0.12:3001'),
  'README architecture must document separate user/admin frontends and backend port 3001'
)
assert.ok(readme.includes('ADMIN_FRONTEND_URL=https://admin.payincus.com') && readme.includes('/opt/incudal/current/client/dist/admin'), 'README architecture must document the separate admin frontend')
assert.ok(readme.includes('VITE_CUSTOMER_BASE_URL=https://pay.payincus.com'), 'README env example must document admin-generated customer links')
assert.ok(readme.includes('PORT=3001'), 'README env example must use backend port 3001')
assert.ok(
  readme.includes('PORT=3001') &&
    readme.includes('SERVE_STATIC_CLIENT=false') &&
    readme.includes('node server/dist/app.js'),
  'README production start command must use backend port 3001'
)
assert.ok(readme.includes('BACKEND_URL=http://10.0.0.12:3001'), 'README split verification command must use backend port 3001')

assert.ok(nginxExample.includes('10.0.0.12:3001'), 'Nginx split example must document backend port 3001')
assert.ok(nginxExample.includes('server_name pay.payincus.com') && nginxExample.includes('server_name admin.payincus.com'), 'Nginx split example must define customer and admin frontend server names')
assert.ok(nginxExample.includes('root /opt/incudal/current/client/dist/user') && nginxExample.includes('root /opt/incudal/current/client/dist/admin'), 'Nginx split example must serve separate user and admin build outputs from the active release')
assert.ok(nginxExample.includes("connect-src 'self' ws: wss:"), 'Nginx split example CSP must allow HTTP and HTTPS WebSocket terminals')
assertBalancedNginxBraces('Nginx split example', nginxExample)
assert.equal(countOccurrences(nginxExample, 'server {'), 2, 'Nginx split example must define customer and admin server blocks')
assert.equal(countOccurrences(nginxExample, 'location = /healthz {'), 2, 'Nginx split example must define /healthz for both frontends')
assert.equal(countOccurrences(nginxExample, 'location /api/ws/ {'), 2, 'Nginx split example must define /api/ws for both frontends')
assert.equal(countOccurrences(nginxExample, 'location /api/ {'), 2, 'Nginx split example must define /api for both frontends')
assert.equal(countOccurrences(nginxExample, 'location / {'), 2, 'Nginx split example must define SPA fallback for both frontends')
assertWebSocketProxyConfig('Nginx split example', nginxExample, 'http://10.0.0.12:3001/api/ws/;')
assertWebSocketProxyConfig('install script Nginx template', installPanel, 'http://127.0.0.1:${DEFAULT_PORT};')
assert.ok(installPanel.includes("connect-src 'self' ws: wss:"), 'install script Nginx CSP must allow HTTP and HTTPS WebSocket terminals')
assertForwardedProxyHeaderConfig('Nginx split example', nginxExample)
assertForwardedProxyHeaderConfig('install script Nginx template', installPanel)
assert.ok(nginxExample.includes('proxy_pass http://10.0.0.12:3001/api/'), 'Nginx API proxy must target backend port 3001')
assert.ok(
    installPanel.includes('脚本会在本机配置 Nginx 托管前端并反代 /api 到后端') &&
    installPanel.includes('resolve_static_dist_dir "client/dist/user"') &&
    installPanel.includes('resolve_static_dist_dir "client/dist/admin"') &&
    installPanel.includes('${INSTALL_DIR}/current/${relative_dist}') &&
    installPanel.includes('write_nginx_split_server_block "$server_name" "$client_dist" "default"') &&
    installPanel.includes('write_nginx_split_server_block "$ADMIN_DOMAIN" "$admin_client_dist"') &&
    installPanel.includes('proxy_pass http://127.0.0.1:${DEFAULT_PORT};') &&
    installPanel.includes('systemctl enable nginx'),
  'Cloudflare Tunnel install path must configure local Nginx static user/admin frontends and /api proxy'
)
assert.ok(
  installPanel.includes('Cloudflare Tunnel 生产部署必须配置浏览器访问域名') &&
    installPanel.includes('FRONTEND_URL/SITE_URL/PAYMENT_CALLBACK_BASE_URL 会用于 WebSocket Origin、OAuth 和支付回调') &&
    installPanel.includes('set_env_value "FRONTEND_URL" "https://${DOMAIN}" "前端公网地址"') &&
    installPanel.includes('set_env_value "ADMIN_FRONTEND_URL" "https://${ADMIN_DOMAIN}" "管理后台公网地址"') &&
    installPanel.includes('set_env_value "SITE_URL" "https://${DOMAIN}" "站点公网地址"') &&
    installPanel.includes('set_env_value "PAYMENT_CALLBACK_BASE_URL" "https://${DOMAIN}" "支付回调公网地址"') &&
    installPanel.includes('set_env_value "VITE_CUSTOMER_BASE_URL" "https://${DOMAIN}" "管理后台生成客户链接的前端地址"') &&
    installPanel.includes('set_env_value "VITE_ADMIN_BASE_URL" "https://${ADMIN_DOMAIN}" "前端管理后台地址"') &&
    installPanel.includes('local server_name="${DOMAIN}"') &&
    !installPanel.includes('local server_name="${DOMAIN:-_}"'),
  'Cloudflare Tunnel install path must require and persist the public frontend domain'
)
assert.ok(
  originConfig.includes('process.env.ADMIN_FRONTEND_URL') &&
    originConfig.includes("'http://127.0.0.1:3002'"),
  'backend origin config must include the admin frontend origin and local admin dev port'
)

assert.ok(!nginxExample.includes('10.0.0.12:3000'), 'Nginx split example must not point backend traffic at frontend port 3000')
assert.ok(!readme.includes('10.0.0.12:3000'), 'README production split docs must not point backend traffic at frontend port 3000')
assert.ok(!readme.includes('127.0.0.1:3000` 即可'), 'README same-host backend proxy example must not point to frontend port 3000')

const retiredDockerDeploymentFiles = [
  '.dockerignore',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.dev.yml',
  '.github/workflows/docker.yml'
]
const repoFiles = new Set(listRepoFilesRecursively(repoRoot).map(file => file.slice(repoRoot.length + 1)))
for (const file of retiredDockerDeploymentFiles) {
  assert.ok(!repoFiles.has(file), `${file} must stay removed from the host-process split deployment`)
}

for (const [name, source] of [
  ['client API', clientApi],
  ['client API URL helper', clientApiUrl],
  ['terminal core', terminalCore]
] as const) {
  assert.ok(!source.includes('43173') && !source.includes('8888'), `${name} must not contain retired local ports`)
  assert.ok(!source.includes('127.0.0.1:3001') && !source.includes('localhost:3001'), `${name} must not hardcode the backend origin`)
}

const clientSourceFiles = readTextFilesRecursively(resolve(repoRoot, 'client/src'), new Set(['.ts', '.vue']))
const forbiddenClientSourceStrings = [
  '127.0.0.1:3001',
  'localhost:3001',
  '127.0.0.1:8888',
  'localhost:8888',
  '127.0.0.1:43173',
  'localhost:43173'
]
const allowedClientNetworkPrimitiveLines = new Map<string, string[]>([
  ['client/src/App.vue', ["fetch(buildApiUrl('/auth/refresh'), {"]],
  ['client/src/admin/AdminApp.vue', ["fetch(buildApiUrl('/auth/refresh'), {"]],
  ['client/src/api/index.ts', ["fetch(buildApiUrl('/auth/refresh'), {"]],
  ['client/src/api/admin.ts', ["fetch(buildApiUrl('/auth/refresh'), {"]],
  ['client/src/components/TermsOfServiceModal.vue', ['fetch(`/tos/${lang}.md`)']],
  ['client/src/components/instance/TerminalModal.vue', ['new WebSocket(wsUrl)']],
  ['client/src/composables/useTerminal.ts', ['new WebSocket(wsUrl)']],
  ['client/src/views/TerminalView.vue', ['new WebSocket(wsUrl)']]
])

for (const file of clientSourceFiles) {
  const relativePath = file.path.slice(repoRoot.length + 1)
  for (const forbidden of forbiddenClientSourceStrings) {
    assert.ok(!file.content.includes(forbidden), `client source must not hardcode ${forbidden}: ${relativePath}`)
  }

  file.content.split('\n').forEach((line, index) => {
    if (!/\b(fetch|XMLHttpRequest|EventSource)\s*\(|new WebSocket/.test(line)) {
      return
    }

    const allowedLines = allowedClientNetworkPrimitiveLines.get(relativePath) ?? []
    assert.ok(
      allowedLines.some(allowed => line.includes(allowed)),
      `client source network primitive must go through the API/WebSocket helpers or be explicitly reviewed: ${relativePath}:${index + 1}`
    )
  })
}

if (existsSync(clientDistPath)) {
  const builtFiles = readTextFilesRecursively(clientDistPath, new Set(['.html', '.js', '.css']))
  const forbiddenBuiltStrings = [
    '127.0.0.1:3001',
    'localhost:3001',
    '127.0.0.1:8888',
    'localhost:8888',
    '127.0.0.1:43173',
    'localhost:43173',
    'VITE_API_BASE_URL'
  ]

  assert.ok(builtFiles.length > 0, 'client/dist must contain built frontend text assets when present')
  for (const file of builtFiles) {
    for (const forbidden of forbiddenBuiltStrings) {
      assert.ok(!file.content.includes(forbidden), `built frontend asset must not contain ${forbidden}: ${file.path}`)
    }
  }
}

console.log('split deployment config tests passed')
