import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const initSource = readRepoFile('server/src/db/init-prisma.ts')
const appSource = readRepoFile('server/src/app.ts')
const envExample = readRepoFile('.env.example')
const installPanel = readRepoFile('scripts/install-panel.sh')

const guardIndex = initSource.indexOf('function assertDatabaseResetAllowed(')
const resetIndex = initSource.indexOf('await resetDatabaseFast()')
const guardCallIndex = initSource.indexOf('assertDatabaseResetAllowed(shouldReset)')

assert.notEqual(guardIndex, -1, 'database initialization must define a production reset safety guard')
assert.notEqual(guardCallIndex, -1, 'database initialization must call the reset safety guard')
assert.notEqual(resetIndex, -1, 'database initialization must keep resetDatabaseFast explicit')
assert.ok(
  guardIndex < guardCallIndex && guardCallIndex < resetIndex,
  'production reset guard must run before resetDatabaseFast()'
)
assert.ok(
  initSource.includes("process.env.NODE_ENV !== 'production'") &&
    initSource.includes('ALLOW_PRODUCTION_DATABASE_RESET') &&
    initSource.includes("const productionResetConfirmation = 'RESET_PRODUCTION_DATABASE'") &&
    initSource.includes('RESET_DATABASE is disabled in production'),
  'production database reset must require an explicit second confirmation phrase'
)
assert.ok(
  appSource.includes("resetDatabase: process.env.RESET_DATABASE === 'true' || process.env.RESET_DATABASE === '1'"),
  'app startup must pass RESET_DATABASE intent through initPrismaDatabase for guarded handling'
)
assert.ok(
  !envExample.match(/^ALLOW_PRODUCTION_DATABASE_RESET=/m) &&
    !installPanel.match(/^ALLOW_PRODUCTION_DATABASE_RESET=/m),
  'production database reset confirmation must not be enabled by default in env templates or installer output'
)

assert.ok(
  initSource.includes('const minimumProductionAdminPasswordLength = 12') &&
    initSource.includes('const unsafeInitialAdminPasswordPatterns = [') &&
    initSource.includes('/change[_-]?me/i') &&
    initSource.includes('/replace/i') &&
    initSource.includes('/generate/i') &&
    initSource.includes('/placeholder/i') &&
    initSource.includes('function getUnsafeInitialAdminPasswordReason(password: string | undefined): string | null') &&
    initSource.includes('ADMIN_PASSWORD must be configured to a strong non-placeholder value in production'),
  'production initial admin password must reject missing, weak, default, and placeholder values'
)
assert.ok(
  envExample.includes('ADMIN_PASSWORD=change_me_admin_password') &&
    initSource.includes('change[_-]?me'),
  '.env.example admin password placeholder must be rejected by production initialization'
)

console.log('startup database safety checks passed')
