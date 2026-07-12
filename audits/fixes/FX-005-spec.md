# FX-005 规格：日志脱敏覆盖不足(P1 / D-053 / M25-02)

## 根因
server/src/lib/log-sanitizer.ts 的 TOKEN_PATTERNS 只匹配 JWT 与窄 Bearer([A-Za-z0-9_-]),
识别不了:裸 pat_/poa_(Public API token)、Basic 认证、URL 查询串里的密钥、含特殊字符的 Bearer;
且 sanitizeObject 递归 depth>10 时原样返回 obj(可能把深层未脱敏对象整体漏出)。

## 修法（只改 server/src/lib/log-sanitizer.ts）
1. 扩展 TOKEN_PATTERNS(sanitizeTokensInString 用),新增覆盖:
   - PayIncus API token:pat_ / poa_ 开头。先 grep 本仓库 token 生成处(找 api-tokens/public-api 里生成 pat_/poa_ 的代码)确认字符集与长度,按其实际格式写正则(如 /\b(?:pat|poa)_[A-Za-z0-9]{16,}\b/g);拿不准就用安全宽匹配 /\b(?:pat|poa)_[A-Za-z0-9_-]{12,}\b/g。
   - Basic 认证:/Basic\s+[A-Za-z0-9+/=]{8,}/gi。
   - 放宽 Bearer 字符集含 . + / = ~ :(覆盖不透明 token 与 JWT):/Bearer\s+[A-Za-z0-9._~+/=:-]+/gi。
   - URL 查询串密钥值:对敏感 query key(token、secret、key、sign、signature、access_token、refresh_token、api_key、apikey、apiKey、password、pwd、assetToken、agentSecret、code)脱敏其值:形如 /([?&](?:token|secret|...大小写不敏感...)=)[^&#\s]+/gi → 替换成 '$1[REDACTED]'。
   保留原 JWT 规则不变。
2. sanitizeObject depth>10:不再 `return obj`,改为返回脱敏占位(如 '[REDACTED_TRUNCATED]' as unknown as T),避免深层原样漏出。
3. 可顺带给 SENSITIVE_FIELDS 补几个明显漏项:'assetToken'、'agentSecret'、'pat'、'poa'(仅补字段名,不改结构)。

## 加守卫（改现有 server/scripts/test-log-sanitizer.ts,勿动 package.json）
新增断言:sanitizeTokensInString 能脱敏 'pat_'+长串、'poa_'+长串、'Basic dXNlcjpwYXNz'、'Bearer a.b+c/d=='、'https://x/cb?token=SECRET123&x=1'(token 值被替换);sanitizeObject 在 depth>10 不返回原始密钥。

## 不许动
- 不改 logSerializers/createSafeLogger 的调用方与 Fastify 配置。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:log-sanitizer 通过。

## 交付
一段话:改了哪些正则/分支、pat_/poa_ 实际格式来源、守卫结果。不要 commit。
