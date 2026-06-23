import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

type TextFile = {
  path: string
  content: string
}

type RegexRule = {
  label: string
  pattern: RegExp
}

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt'])

function collectTextFiles(root: string): TextFile[] {
  assert.ok(existsSync(root), `missing frontend build directory: ${relative(repoRoot, root)}; run pnpm --filter client build first`)

  const files: TextFile[] = []

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = resolve(dir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        walk(fullPath)
        continue
      }

      if (!stat.isFile() || !textExtensions.has(extname(fullPath))) {
        continue
      }

      files.push({
        path: relative(repoRoot, fullPath),
        content: readFileSync(fullPath, 'utf8')
      })
    }
  }

  walk(root)
  return files
}

function assertNoFixedMarkers(scope: string, files: TextFile[], markers: string[]): void {
  const failures: string[] = []

  for (const file of files) {
    for (const marker of markers) {
      if (file.content.includes(marker)) {
        failures.push(`${file.path}: ${marker}`)
      }
    }
  }

  assert.deepEqual(failures, [], `${scope} build contains forbidden fixed markers:\n${failures.join('\n')}`)
}

function assertNoRegexMarkers(scope: string, files: TextFile[], rules: RegexRule[]): void {
  const failures: string[] = []

  for (const file of files) {
    for (const rule of rules) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`)
      const matches = Array.from(file.content.matchAll(pattern)).map(match => match[0])

      for (const match of matches) {
        failures.push(`${file.path}: ${rule.label}: ${match}`)
      }
    }
  }

  assert.deepEqual(failures, [], `${scope} build contains forbidden regex markers:\n${failures.join('\n')}`)
}

const userBuildFiles = collectTextFiles(resolve(repoRoot, 'client/dist/user'))
const adminBuildFiles = collectTextFiles(resolve(repoRoot, 'client/dist/admin'))

assert.ok(userBuildFiles.length > 0, 'customer build output must contain text files')
assert.ok(adminBuildFiles.length > 0, 'admin build output must contain text files')

assertNoFixedMarkers('customer', userBuildFiles, [
  '/api/admin',
  '/admin/login',
  '/admin/users',
  '/admin/settings',
  '/admin/billing',
  '/admin/recharge',
  '/admin/notification-channels',
  '/oauth/configs',
  '/traffic/collect',
  '/traffic/sync-package-limits',
  '/mail/admin',
  '/help/admin',
  '/images/admin',
  '/inbox/admin',
  '/aff/admin',
  '/balance/admin',
  '/telegram/admin',
  'adminCreateInstance',
  'adminNotificationChannels',
  'confirmDemoteAdmin',
  'confirmPromoteAdmin',
  'demoteAdmin',
  'onlyActiveCanBeAdmin',
  'promoteAdmin',
  'userDemotedAdmin',
  'userPromotedAdmin',
  '后台管理系统',
  '管理员创建实例',
  '该入口仅限管理员登录'
])

assertNoRegexMarkers('customer', userBuildFiles, [
  { label: 'admin user password reset endpoint', pattern: /\/users\/[^"'`\s]+\/reset-password/g },
  { label: 'admin user disable 2FA endpoint', pattern: /\/users\/[^"'`\s]+\/disable-2fa/g },
  { label: 'admin user OAuth endpoint', pattern: /\/users\/[^"'`\s]+\/oauth\//g },
  { label: 'admin user login records endpoint', pattern: /\/users\/[^"'`\s]+\/login-records/g }
])

assertNoFixedMarkers('admin', adminBuildFiles, [
  '/balance/me',
  '/checkin',
  '/friends',
  '/hosting/access-check',
  '/packages/hosting-zones',
  '/packages/my-shares',
  '/packages/public',
  '/recharge/providers',
  '/resource-pool',
  '/transfers',
  '/user-invites',
  'ForgotPasswordView',
  'MarketView',
  'PortalView',
  'RegisterView',
  'allFriendsShared',
  'confirmRemoveShare',
  'editQuotaFor',
  'historyRequests',
  'pendingRequests',
  'shareToFriend',
  'sharesList',
  'showEditQuotaModal',
  'showShareModal',
  'showSharesModal',
  '客户面板'
])

assertNoRegexMarkers('admin', adminBuildFiles, [
  { label: 'customer package share endpoint', pattern: /\/packages\/[^"'`\s]+\/share/g }
])

console.log('frontend dist boundary guard tests passed')
