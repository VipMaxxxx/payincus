# FX-002 规格：OAuth 开放重定向反斜杠绕过(P1 / D-002 / M01-01)

## 根因
server/src/lib/redirect-validator.ts 的 isValidRedirectUrl 只拒绝 '//' 前缀,不拒绝 '/\' 反斜杠。
浏览器按 WHATWG 把 Location 里 '/\evil.com' 的 '\' 归一化为 '/' → 实际跳到 https://evil.com/,
OAuth 登录回调会把一次性登录码拼到该 URL → 账号接管。

## 修法
### 后端 server/src/lib/redirect-validator.ts（isValidRedirectUrl）
在现有"必须以 / 开头"之后,把"不允许 // 开头"这一步强化为同时拒绝反斜杠与编码绕过:
- 拒绝第二个字符为 '/' 或 '\' 的(即 '//' 或 '/\' 开头);
- 拒绝 trimmed 中任意位置含反斜杠 '\';
- 拒绝编码变体:%5c/%5C(编码反斜杠)、以 '/%2f'、'/%5c' 开头(大小写不敏感)。
保留原有 javascript:/data:/vbscript:、换行/控制符、%0d/%0a 等所有既有检查不变。

### 前端 client/src/utils/validation.ts
grep 该文件里等价的重定向校验函数(getSafeRedirectUrl / isValidRedirect 之类),
用与后端**完全一致**的规则加固(反斜杠+编码变体),保证前后端口径一致。若前端在别处还有重复校验,一并对齐。

## 加守卫(钉死)
新建 server/scripts/test-redirect-validator-guards.ts:import isValidRedirectUrl,断言:
- 合法:'/dashboard'、'/a/b?x=1' → true
- 拒绝:'//evil.com'、'/\evil.com'、'/%5cevil.com'、'/%2f%2fevil.com'、'/\tevil'、'javascript:alert(1)'、'https://evil.com'、''、'/path\x' → false
并在 server/package.json 加一个 "test:redirect-validator-guards" 脚本,同时把它追加到大 "test" 链末尾(&& 连接)。

## 不许动
- 不改 oauth.ts / auth.ts 的业务流程(它们调用 isValidRedirectUrl,验证器修好即生效)。不做大重构。

## 验收
- pnpm --filter server type-check、pnpm --filter client type-check 通过;
- pnpm --filter server test:redirect-validator-guards 通过;
- pnpm --filter server test:oauth-provider-guards 通过。

## 交付
一段话说明:改了哪些文件、前端校验函数在哪、守卫结果。不要 commit。
