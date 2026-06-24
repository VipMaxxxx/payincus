import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const serverRoot = resolve(__dirname, '..')
const repoRoot = resolve(serverRoot, '..')

const demoSafetySource = readFileSync(resolve(serverRoot, 'src/lib/demo-safety.ts'), 'utf8')
const authSource = readFileSync(resolve(serverRoot, 'src/routes/auth.ts'), 'utf8')
const usersSource = readFileSync(resolve(serverRoot, 'src/routes/users.ts'), 'utf8')
const loginHistorySource = readFileSync(
  resolve(repoRoot, 'client/src/components/profile/LoginHistorySection.vue'),
  'utf8'
)
const demoLoginSource = readFileSync(resolve(repoRoot, 'client/src/utils/demo-login.ts'), 'utf8')

function assertBefore(source: string, before: string, after: string, message: string): void {
  const beforeIndex = source.indexOf(before)
  const afterIndex = source.indexOf(after)

  assert.notEqual(beforeIndex, -1, `${message}: missing before marker`)
  assert.notEqual(afterIndex, -1, `${message}: missing after marker`)
  assert.ok(beforeIndex < afterIndex, message)
}

assert.ok(
  demoSafetySource.includes("'demo.payincus.com'") &&
    demoSafetySource.includes("'demoadmin.payincus.com'") &&
    demoSafetySource.includes("'admin@payincus.com'") &&
    demoSafetySource.includes("'demo@payincus.com'") &&
    demoSafetySource.includes("export const DEMO_REDACTED_IP = '已隐藏'"),
  'demo safety helper must scope protections to the demo hosts and accounts'
)

assert.ok(
  demoLoginSource.includes("const DEFAULT_DEMO_ACCOUNTS") &&
    demoLoginSource.includes("username: 'demo'") &&
    demoLoginSource.includes("password: 'demo123'") &&
    demoLoginSource.includes("username: 'admin'") &&
    demoLoginSource.includes("password: 'admin123'") &&
    demoLoginSource.includes('DEFAULT_DEMO_ACCOUNTS[kind]'),
  'demo login helper must show default public demo accounts on demo hosts'
)

assert.ok(
  demoSafetySource.includes('ip: DEMO_REDACTED_IP') &&
    demoSafetySource.includes('country: null') &&
    demoSafetySource.includes('region: null') &&
    demoSafetySource.includes('city: null') &&
    demoSafetySource.includes('isp: null') &&
    demoSafetySource.includes('timezone: null') &&
    demoSafetySource.includes('userAgent: null'),
  'demo login record redaction must remove IP location and device data'
)

assertBefore(
  authSource,
  'const protectDemoAccount = shouldProtectDemoAccount(request, user)',
  'loginAlertInfo = await detectNewLoginLocation(user.id, clientIp, userAgent)',
  'demo logins must decide protection before new-location detection'
)

assert.ok(
  authSource.includes('if (user.email && !protectDemoAccount)'),
  'demo logins must skip new-location detection and alerts'
)

assertBefore(
  authSource,
  'ip: DEMO_REDACTED_IP',
  'getGeoIpInfo(clientIp).then(geoInfo =>',
  'demo login records must store a redacted IP before any GeoIP lookup path'
)

assert.ok(
  authSource.includes('loginRecordsResult.records.map(redactDemoLoginRecord)'),
  'user login-history API must redact demo login records'
)

assertBefore(
  usersSource,
  'if (password && shouldProtectDemoAccount(request, user))',
  'updates.passwordHash = await bcrypt.hash(password, 12)',
  'profile password changes must be blocked for demo accounts before hashing'
)

assertBefore(
  usersSource,
  'if (shouldProtectDemoAccount(request, user))',
  'await db.updateUser(userId, { passwordHash })',
  'admin password resets must be blocked for demo accounts before DB update'
)

assert.ok(
  usersSource.includes('? redactDemoLoginRecord(lastLoginMap.get(user.id)!)') &&
    usersSource.includes('loginRecordsResult.records.map(redactDemoLoginRecord)'),
  'admin user list and user login-records API must redact demo login records'
)

assert.ok(
  loginHistorySource.includes("const HIDDEN_LOGIN_VALUE = '已隐藏'") &&
    loginHistorySource.includes('function isHiddenRecord(record: LoginRecord): boolean') &&
    loginHistorySource.includes('v-if="!isHiddenRecord(record) && getCountryCode(record.country)"') &&
    loginHistorySource.includes('v-if="!isHiddenRecord(record)"'),
  'frontend login history must hide location and device fields for redacted demo records'
)

console.log('demo account safety guard tests passed')
