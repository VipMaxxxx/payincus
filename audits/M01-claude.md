# M01 审计报告

## 结论摘要
认证/会话整体设计较为扎实（refresh token sha256 落库、OAuth state HMAC+nonce 防重放、操作二次验证原子领取、登出幂等且清 cookie，与守卫测试锁定的不变量一致）。但发现 1 个可组合成账号接管链的 P1 开放重定向绕过（反斜杠绕过 redirect 校验 → OAuth 登录码泄漏到攻击者域），以及若干 P2 级正确性/防爆破缺口。

## 发现清单

- [M01-01] P1 | 置信度 高 | server/src/lib/redirect-validator.ts:23-28 + server/src/routes/oauth.ts:281,393,575-576
  - 问题：`isValidRedirectUrl` 只拦 `//` 前缀，不拦 `/\`。`redirect=/\evil.com` 通过校验后，OAuth 登录回调把一次性登录码拼进该 URL 并 302 跳转；浏览器按 WHATWG 规则把 `Location: /\evil.com` 中的 `\` 归一化为 `/`，实际跳到 `https://evil.com/?oauth_code=...`。
  - 证据：redirect-validator.ts `if (!trimmed.startsWith('/')) return false; if (trimmed.startsWith('//')) return false`（未处理反斜杠）；oauth.ts 回调 `reply.redirect(\`${redirectUrl}${separator}oauth_code=${encodeURIComponent(loginCode)}\`)`。
  - 影响：攻击者构造 `/oauth/authorize/github?mode=login&redirect=/\attacker.com` 诱导受害者点击，登录成功后一次性登录码被送到攻击者域，60 秒内调用 `/oauth/exchange-code` 即可接管会话。
  - 修复建议：redirect 校验补充拒绝反斜杠（含 `\`、`%5c`）及任何 `/[/\\]` 起始，前后端 `getSafeRedirectUrl` 同步收紧。

- [M01-02] P2 | 置信度 高 | server/src/lib/security.ts:214,238-239
  - 问题：`DANGEROUS_CHARS_REGEX` 带全局 `g` 标志又用 `.test()` 复用同一实例，`lastIndex` 有状态，跨调用交替返回 true/false。
  - 证据：`const DANGEROUS_CHARS_REGEX = /.../g`；`containsDangerousChars` 直接 `DANGEROUS_CHARS_REGEX.test(input)`。注册/找回/发码路径多次调用。
  - 影响：含危险字符的用户名/邮箱有概率漏检通过（安全校验偶发失效），也可能误伤合法输入；行为不确定难复现。
  - 修复建议：去掉 `g` 标志（或每次重置 lastIndex），使检测无状态。

- [M01-03] P2 | 置信度 中 | server/src/lib/security.ts:730-782 + server/src/routes/auth.ts:834-851
  - 问题：`verifyRefreshToken` 用 try/catch 把任何异常（含数据库错误）吞成 `return null`，`/refresh` 依赖抛错才重试的逻辑永远进不去，直接清 cookie + 401 强制登出。
  - 证据：security.ts `} catch { return null }`；auth.ts `/refresh` 的 catch 重试块实际到不了。
  - 影响：数据库短暂抖动/连接池耗尽时用户被踢下线，与"防止数据库问题导致频繁登出"的注释意图相反。
  - 修复建议：区分"token 不存在/过期"（null）与"底层异常"（抛出），让重试与"网络错误不登出"策略生效。

- [M01-04] P2 | 置信度 高 | server/src/db/email-verification.ts:94-124
  - 问题：邮箱验证码只有"每小时最多 5 次发送"的发码限流，`verifyCode` 对单个验证码没有失败尝试次数上限，失败不消费不计数，可在 10 分钟有效期内高频撞库。
  - 证据：`verifyCode` 仅匹配成功时 deleteMany，失败 `return false` 无 attempts 累加；对比 operation-verification.ts 有 `maxAttempts: 5`。
  - 影响：6 位数字码空间仅 10^6，找回密码这一高危路径反而比操作二次验证更弱。
  - 修复建议：给 EmailVerificationCode 增加 attempts 字段与上限（如 5 次作废），与 operation-verification 对齐。

- [M01-05] P2 | 置信度 中 | server/src/routes/auth.ts:556-566 & 595-605
  - 问题：注册流程先 `verifyCode`（消费验证码）之后才查用户名/邮箱是否已存在，重名时验证码已被删，用户须重新收码。
  - 证据：先 `verifyCode(email, emailCode, 'register')` 再 `db.findUserByUsername(username)` 查重。
  - 影响：并发/重名注册白白消耗验证码，需重新等 60s 冷却。属正确性/顺序问题非安全漏洞。
  - 修复建议：把唯一性预检查移到 verifyCode 之前。

- [M01-06] P3 | 置信度 中 | server/src/routes/oauth-provider.ts:280-283 & 193-196
  - 问题：OAuth Provider 的 /token、/authorize、/authorize/confirm 把底层 error.message 原样回客户端。
  - 影响：泄漏内部校验细节便于探测（code 无效/已用/过期/redirect 不匹配），但为受控英文串，危害有限。
  - 修复建议：对外返回统一 OAuth 标准错误（如 invalid_grant），详情仅记服务端日志。

- [M01-07] P3 | 置信度 中 | server/src/routes/auth.ts:172-176,226-233
  - 问题：登录路由用 `request.log.debug` 打印 username、passwordLength、hashPrefix（password_hash 前 10 字符），违反"日志不得出现凭证"红线。
  - 影响：生产开 debug 时 bcrypt hash 前缀落日志，轻微削弱离线爆破成本、违反内部红线。
  - 修复建议：移除 hash 相关日志字段。

- [M01-08] P3 | 置信度 中 | server/src/routes/auth.ts:288-294
  - 问题：恢复码登录成功会写两条 LOGIN_SUCCESS 日志（recovery 分支一条 + 主流程一条）。
  - 影响：审计日志重复计数，安全统计/异常检测偏差。
  - 修复建议：恢复码使用记为独立事件类型或降级为 info。

- [M01-09] P3 | 置信度 低 | server/src/lib/security.ts:1032-1039
  - 问题：`getEncryptionKey` 非生产环境回退 JWT_SECRET 或字面量 `'default-encryption-key'` 派生 2FA 加密键，生产误配 NODE_ENV 且未设 ENCRYPTION_KEY 时用可预测密钥。
  - 修复建议：启动时校验生产必须存在独立 ENCRYPTION_KEY，去除字面量回退。

- [M01-10] P3 | 置信度 中 | server/src/lib/security.ts:30,1323,1572（内存态）
  - 问题：登录失败锁定、OAuth nonce/登录码去重、action ticket 均为单进程内存 Map，多实例部署下不跨进程共享。
  - 影响：多实例下暴力锁定可被 LB 打散绕过、OAuth 一次性码/state 重放防护弱化。单实例则无实际影响。
  - 修复建议：确认部署为单实例；若横向扩展需下沉到共享存储。

补充（良性设计，无需整改）：refresh token sha256 落库、OAuth state HMAC 签名+常量时间比较+nonce 去重、exchange-code 时才发 refresh 且复检封禁、登出幂等、封禁/改密/2FA 变更均 revokeAll+invalidate+closeSessions、操作二次验证 deleteMany 原子领取、OAuth provider 授权码/refresh hash 存储。均与守卫锁定的不变量一致。
