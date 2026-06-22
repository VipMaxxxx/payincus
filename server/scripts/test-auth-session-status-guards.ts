import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const appSource = readFileSync(resolve(__dirname, '../src/app.ts'), 'utf8')
const authRouteSource = readFileSync(resolve(__dirname, '../src/routes/auth.ts'), 'utf8')
const usersRouteSource = readFileSync(resolve(__dirname, '../src/routes/users.ts'), 'utf8')
const oauthRouteSource = readFileSync(resolve(__dirname, '../src/routes/oauth.ts'), 'utf8')
const loginRecordsDbSource = readFileSync(resolve(__dirname, '../src/db/login-records.ts'), 'utf8')
const adminUsersViewSource = readFileSync(resolve(__dirname, '../../client/src/views/admin/UsersView.vue'), 'utf8')
const apiSource = readFileSync(resolve(__dirname, '../../client/src/api/index.ts'), 'utf8')

function routeSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing route marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing route end marker: ${endMarker}`)
  return source.slice(start, end)
}

const adminResetPasswordRoute = routeSection(
  usersRouteSource,
  "}>('/:id/reset-password'",
  "  // 管理员取消用户的 2FA"
)
const adminDisable2FARoute = routeSection(
  usersRouteSource,
  "}>('/:id/disable-2fa'",
  "  // 管理员解除用户的 OAuth 绑定"
)
const adminUnbindOAuthRoute = routeSection(
  usersRouteSource,
  "}>('/:id/oauth/:provider'",
  "  // 管理员获取用户登录记录"
)
const selfUnbindOAuthRoute = routeSection(
  oauthRouteSource,
  "}>('/bindings/:provider'",
  "  // ==================== OAuth 登录码交换 ===================="
)
const selfEnable2FARoute = routeSection(
  authRouteSource,
  "}>('/2fa/enable'",
  "  // 禁用 2FA"
)
const selfDisable2FARoute = routeSection(
  authRouteSource,
  "}>('/2fa/disable'",
  "  // 获取剩余恢复码数量"
)
const logoutRoute = routeSection(
  authRouteSource,
  "fastify.post('/logout'",
  "  // 刷新 Access Token"
)
const refreshRoute = routeSection(
  authRouteSource,
  "fastify.post('/refresh'",
  "  // 生成邀请码 (管理员)"
)
const check2FARoute = routeSection(
  authRouteSource,
  "fastify.post<{ Body: { username: string } }>('/check-2fa'",
  "  // 用户登录 (支持 2FA)"
)
const loginRoute = routeSection(
  authRouteSource,
  "fastify.post<{ Body: LoginWith2FARequest }>('/login'",
  "  // 发送邮件验证码"
)
const loginHistoryRoute = routeSection(
  authRouteSource,
  "}>('/login-history'",
  '\n}'
)
const forgotPasswordSendCodeRoute = routeSection(
  authRouteSource,
  "}>('/forgot-password/send-code'",
  "  // 重置密码"
)
const forgotPasswordResetRoute = routeSection(
  authRouteSource,
  "}>('/forgot-password/reset'",
  "  // 获取用户登录历史记录"
)

assert.ok(
  appSource.includes('async function ensureActiveAccessToken(') &&
    appSource.includes('await isAccessTokenInvalidated(user.id, user.iat, user.sid)'),
  'global authentication must reject invalidated access tokens'
)

assert.ok(
  appSource.includes('const currentUser = await prisma.user.findUnique({') &&
    appSource.includes('status: true') &&
    appSource.includes("if (currentUser.status !== 'active')") &&
    appSource.includes("code: 'ACCOUNT_BANNED'"),
  'global authentication must re-check current user status and reject banned users'
)

assert.ok(
  appSource.includes("fastify.decorate('authenticate', async function") &&
    appSource.includes('await request.jwtVerify()') &&
    appSource.includes('await ensureActiveAccessToken(request, reply)'),
  'authenticate decorator must run JWT verification and current-session status checks'
)

assert.ok(
  appSource.includes("fastify.decorate('authenticateAdmin', async function") &&
    appSource.includes('await ensureCurrentAdmin(request, reply)'),
  'admin authentication must require an active current admin after token validation'
)

assert.ok(
  authRouteSource.includes('const LOGIN_IDENTIFIER_MAX_LENGTH = 254') &&
    check2FARoute.includes('maxLength: LOGIN_IDENTIFIER_MAX_LENGTH') &&
    loginRoute.includes('maxLength: LOGIN_IDENTIFIER_MAX_LENGTH'),
  'email-capable login and 2FA precheck identifiers must allow normal email lengths'
)
const check2FAUserMissingIndex = check2FARoute.indexOf('if (!user)')
const check2FABannedIndex = check2FARoute.indexOf("if (user.status === 'banned')")
const check2FAEnabledIndex = check2FARoute.indexOf('const twoFAEnabled = await db.is2FAEnabled(user.id)')
assert.notEqual(check2FAUserMissingIndex, -1, 'check-2fa must handle missing users without disclosure')
assert.notEqual(check2FABannedIndex, -1, 'check-2fa must handle banned users without 2FA disclosure')
assert.notEqual(check2FAEnabledIndex, -1, 'check-2fa must query 2FA state for eligible users')
assert.ok(
  check2FAUserMissingIndex < check2FABannedIndex && check2FABannedIndex < check2FAEnabledIndex,
  'check-2fa must not reveal 2FA status for banned accounts'
)
assert.ok(
  loginRoute.includes('findUserByUsernameOrEmail(username)') &&
    !loginRoute.includes("username: { type: 'string', minLength: 3, maxLength: 32 }"),
  'login schema must not cap username-or-email identifiers at the registration username length'
)

assert.ok(
  !logoutRoute.includes('onRequest: [fastify.authenticate]') &&
    logoutRoute.includes('await request.jwtVerify()') &&
    logoutRoute.includes('Logout must still clear the HttpOnly refresh cookie when the access token is expired or invalid.') &&
    logoutRoute.includes('const tokenData = await verifyRefreshToken(refreshToken)') &&
    logoutRoute.includes('await revokeRefreshToken(refreshToken)') &&
    logoutRoute.includes("reply.clearCookie('refreshToken', getClearCookieOptions())"),
  'logout must be idempotent and clear/revoke the refresh cookie even when the access token is expired or invalid'
)

assert.ok(
  logoutRoute.includes('await invalidateSessionAccessToken(userId, sessionId)') &&
    logoutRoute.includes('revokeActionTicketsForSession(sessionId)') &&
    logoutRoute.includes("closeSessionTerminalSessions(sessionId, 'Session logged out')"),
  'logout must invalidate access tokens, action tickets, and terminal sessions when a user/session can be identified'
)

assert.ok(
  refreshRoute.includes('const user = await db.findUserById(tokenData.userId)') &&
    refreshRoute.includes("if (!user || user.status === 'banned')") &&
    refreshRoute.includes('await revokeRefreshToken(refreshToken)') &&
    refreshRoute.includes("reply.clearCookie('refreshToken', getClearCookieOptions())") &&
    refreshRoute.includes('role: user.role'),
  'refresh must re-check current user status, clear banned sessions, and sign new tokens with the current database role'
)

const forgotSendUserLookupIndex = forgotPasswordSendCodeRoute.indexOf('const user = await db.findUserByEmail(email)')
const forgotSendStatusCheckIndex = forgotPasswordSendCodeRoute.indexOf("if (user.status === 'banned')")
const forgotSendCreateCodeIndex = forgotPasswordSendCodeRoute.indexOf("const result = await createVerificationCode(email, 'password_reset')")
assert.notEqual(forgotSendUserLookupIndex, -1, 'forgot-password send-code must look up the user before creating reset codes')
assert.notEqual(forgotSendStatusCheckIndex, -1, 'forgot-password send-code must check banned status')
assert.notEqual(forgotSendCreateCodeIndex, -1, 'forgot-password send-code verification creation call not found')
assert.ok(
  forgotSendUserLookupIndex < forgotSendStatusCheckIndex && forgotSendStatusCheckIndex < forgotSendCreateCodeIndex,
  'forgot-password send-code must reject banned accounts before creating or sending reset codes'
)

const forgotResetUserLookupIndex = forgotPasswordResetRoute.indexOf('const user = await db.findUserByEmail(email)')
const forgotResetStatusCheckIndex = forgotPasswordResetRoute.indexOf("if (user.status === 'banned')")
const forgotResetVerifyCodeIndex = forgotPasswordResetRoute.indexOf("const isValid = await verifyCode(email, code, 'password_reset')")
assert.notEqual(forgotResetUserLookupIndex, -1, 'forgot-password reset must look up the user before consuming reset codes')
assert.notEqual(forgotResetStatusCheckIndex, -1, 'forgot-password reset must check banned status')
assert.notEqual(forgotResetVerifyCodeIndex, -1, 'forgot-password reset verification call not found')
assert.ok(
  forgotResetUserLookupIndex < forgotResetStatusCheckIndex && forgotResetStatusCheckIndex < forgotResetVerifyCodeIndex,
  'forgot-password reset must reject banned accounts before consuming reset codes'
)

assert.ok(
  usersRouteSource.includes("}>('/:id/status', {") &&
    usersRouteSource.includes('await revokeAllUserRefreshTokens(userId)') &&
    usersRouteSource.includes('await invalidateUserAccessTokens(userId)') &&
    usersRouteSource.includes("closeUserSessions(userId, 'User account banned')"),
  'banning a user must revoke refresh tokens, invalidate access tokens, and close terminal sessions'
)

assert.ok(
  usersRouteSource.includes('if (password) {') &&
    usersRouteSource.includes("closeUserSessions(userId, 'Password updated')"),
  'password updates must revoke refresh tokens, invalidate access tokens, and close terminal sessions'
)

assert.ok(
  usersRouteSource.includes("request.user.role === 'admin' && request.user.id !== userId") &&
    usersRouteSource.includes("await logAdminAction(request.user.id, 'user.profile.update'") &&
    usersRouteSource.includes('metadata: { fields: updateActions }'),
  'admin profile updates for another user must write an admin audit log with field names only'
)

assert.ok(
  !usersRouteSource.includes('metadata: { fields: updateActions, email') &&
    !usersRouteSource.includes('metadata: { fields: updateActions, password') &&
    !usersRouteSource.includes('metadata: { fields: updateActions, avatarStyle'),
  'admin profile update audit metadata must not include new email, password, password hash, or avatar values'
)

assert.ok(
  adminResetPasswordRoute.includes('Body: { password: string }') &&
    adminResetPasswordRoute.includes("required: ['password']") &&
    adminResetPasswordRoute.includes('const passwordCheck = validatePassword(request.body.password)') &&
    adminResetPasswordRoute.includes('await bcrypt.hash(request.body.password, 12)') &&
    adminResetPasswordRoute.includes("message: 'Password reset successfully'") &&
    !adminResetPasswordRoute.includes('generateRandomPassword') &&
    !adminResetPasswordRoute.includes('newPassword'),
  'admin password reset must accept an admin-provided password and never generate or return plaintext credentials'
)

assert.ok(
  apiSource.includes('resetPassword: (id: number, password: string): Promise<{ message: string; username: string }>') &&
    apiSource.includes("http.post(`/users/${id}/reset-password`, { password })"),
  'frontend API wrapper must send admin-provided reset passwords and not type a returned plaintext password'
)

assert.ok(
  adminUsersViewSource.includes("const resetPasswordForm = ref({ password: '', confirmPassword: '' })") &&
    adminUsersViewSource.includes('await api.users.resetPassword(resetPasswordUser.value.id, resetPasswordForm.value.password)') &&
    adminUsersViewSource.includes("toast.success(t('admin.users.passwordResetSuccess'))") &&
    !adminUsersViewSource.includes('generatedPassword') &&
    !adminUsersViewSource.includes('showResetPasswordResultModal') &&
    !adminUsersViewSource.includes('copyGeneratedPassword'),
  'admin users UI must not display or copy server-generated plaintext reset passwords'
)

for (const [name, route] of [
  ['admin password reset', adminResetPasswordRoute],
  ['admin 2FA disable', adminDisable2FARoute],
  ['admin OAuth unbind', adminUnbindOAuthRoute]
] as const) {
  assert.ok(
    route.includes('if (request.user.id === userId)') &&
      route.includes('ErrorCode.CANNOT_MODIFY_SELF'),
    `${name} route must reject self-service bypass through admin APIs`
  )
}

for (const [name, route] of [
  ['admin 2FA disable', adminDisable2FARoute],
  ['admin OAuth unbind', adminUnbindOAuthRoute]
] as const) {
  assert.ok(
    route.includes('await revokeAllUserRefreshTokens(userId)') &&
      route.includes('await invalidateUserAccessTokens(userId)') &&
      route.includes('closeUserSessions(userId,'),
    `${name} route must revoke refresh tokens, invalidate access tokens, and close terminal sessions`
  )
}

assert.ok(
  selfUnbindOAuthRoute.includes('await db.deleteOAuthBinding(request.user.id, provider)') &&
    selfUnbindOAuthRoute.includes('await revokeAllUserRefreshTokens(request.user.id)') &&
    selfUnbindOAuthRoute.includes('await invalidateUserAccessTokens(request.user.id)') &&
    selfUnbindOAuthRoute.includes('closeUserSessions(request.user.id,') &&
    selfUnbindOAuthRoute.includes("'oauth.unbind'"),
  'self-service OAuth unbind must revoke sessions and write a security log'
)

for (const [name, route, stateChange] of [
  ['self-service 2FA enable', selfEnable2FARoute, 'await db.enable2FA(request.user.id)'],
  ['self-service 2FA disable', selfDisable2FARoute, 'await db.disable2FAComplete(request.user.id)']
] as const) {
  assert.ok(
    route.includes(stateChange) &&
      route.includes('await revokeAllUserRefreshTokens(request.user.id)') &&
      route.includes('await invalidateUserAccessTokens(request.user.id)') &&
      route.includes('closeUserSessions(request.user.id,'),
    `${name} route must revoke refresh tokens, invalidate access tokens, and close terminal sessions`
  )
}

assert.ok(
    loginRecordsDbSource.includes('const safePage = Number.isInteger(page) && page > 0 ? page : 1') &&
    loginRecordsDbSource.includes('const safePageSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 50) : 20') &&
    loginRecordsDbSource.includes('const skip = (safePage - 1) * safePageSize') &&
    loginRecordsDbSource.includes('skip,') &&
    loginRecordsDbSource.includes('take: safePageSize') &&
    loginRecordsDbSource.includes('totalPages: Math.ceil(total / safePageSize)'),
  'login record pagination must clamp invalid or excessive page/pageSize before querying'
)

assert.ok(
  loginHistoryRoute.includes('const page = parsePositiveInteger(request.query.page, 1)') &&
    loginHistoryRoute.includes('const pageSize = Math.min(parsePositiveInteger(request.query.pageSize, 20), 50)') &&
    loginHistoryRoute.includes('const loginRecordsResult = await getUserLoginRecords(request.user.id, page, pageSize)') &&
    loginHistoryRoute.includes('page: loginRecordsResult.page') &&
    loginHistoryRoute.includes('pageSize: loginRecordsResult.pageSize') &&
    usersRouteSource.includes('const loginRecordsResult = await db.getUserLoginRecords(userId, page, pageSize)') &&
    usersRouteSource.includes('page: loginRecordsResult.page') &&
    usersRouteSource.includes('pageSize: loginRecordsResult.pageSize'),
  'login history routes must return the sanitized pagination values used by the database query'
)

for (const forbiddenPattern of [
  "parseInt(request.query.page || '1', 10)",
  "parseInt(request.query.pageSize || '20', 10)"
] as const) {
  assert.ok(
    !loginHistoryRoute.includes(forbiddenPattern),
    `user login-history route must not use loose pagination parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  loginRecordsDbSource.includes('const LINKED_ACCOUNT_DEFAULT_GROUP_LIMIT = 50') &&
    loginRecordsDbSource.includes('const LINKED_ACCOUNT_MAX_GROUP_LIMIT = 100') &&
    loginRecordsDbSource.includes('const LINKED_ACCOUNT_MAX_USERS_PER_GROUP = 20') &&
    loginRecordsDbSource.match(/slice\(0, safeGroupLimit\)/g)?.length === 3 &&
    loginRecordsDbSource.match(/slice\(0, safeMaxUsersPerGroup\)/g)?.length === 3,
  'linked-account detection helpers must cap returned groups and users per group'
)

assert.ok(
  usersRouteSource.includes("Querystring: { days?: string; limit?: string }") &&
    usersRouteSource.includes('const days = parseClampedPositiveIntegerQuery(request.query.days, 90, 365)') &&
    usersRouteSource.includes('const limit = parseClampedPositiveIntegerQuery(request.query.limit, 50, 100)') &&
    usersRouteSource.includes('const maxUsersPerGroup = 20') &&
    usersRouteSource.includes('db.getSharedIPGroups(days, 2, limit, maxUsersPerGroup)') &&
    usersRouteSource.includes('db.getSimilarEmailGroups(limit, maxUsersPerGroup)') &&
    usersRouteSource.includes('db.getSimilarUsernameGroups(limit, maxUsersPerGroup)'),
  'linked-account detection route must clamp result limits before running detection'
)

console.log('auth session status guard checks passed')
