# FX-006 规格：apiError 泄漏内部异常原文(P2 横切 / D-118)

## 根因
server/src/lib/errors.ts:700 apiError(code, details) 把 details 原样放进响应。
大量路由在 catch 里 apiError(ErrorCode.INTERNAL_ERROR, err.message)/String(error) → 内部异常原文(Prisma/约束/字段/栈信息)泄漏给客户端。

## 修法(只改 server/src/lib/errors.ts + 加守卫;本次只做根因,per-route 直接 send({error:err.message}) 的散点不在本条)
1. apiError 改造:
   - 对**内部错误码**(至少 ErrorCode.INTERNAL_ERROR;若 ErrorMessages 里还有明显的"服务器内部/未知错误"类 5xx 码,一并纳入一个内部码集合 INTERNAL_ERROR_CODES),**不把 details 放进响应**(只返回 {error, code})。
   - 对其它码:保留 details,但**统一经 sanitizeTokensInString(从 ./log-sanitizer.js 引入)脱敏 + 截断到 256 字符**,作为纵深防御(防止调用方无意带入 token/长栈)。
   - 保持函数签名不变(details 仍可选传);调用方无需改动。
   - 注意:errors.ts import log-sanitizer 无循环依赖(log-sanitizer 不引 errors)。
2. 语义:内部错误对外只暴露稳定 code + 通用文案(ErrorMessages[code]),真实 details 由调用方各自的 server 端日志承担(不在本条内改调用方)。

## 加守卫
新建 server/scripts/test-error-response-guards.ts:
- 断言 apiError(ErrorCode.INTERNAL_ERROR, 'Prisma: column x does not exist').details === undefined(内部错误不回原文);
- 断言 apiError(ErrorCode.INTERNAL_ERROR, 'x') 仍含 code==='INTERNAL_ERROR' 与通用 error 文案;
- 断言 apiError(某非内部码, 'Bearer abc.def+gh/i==') 的 details 里 token 已被脱敏;
- 断言超长 details 被截断到 ≤256。
在 server/package.json 加 "test:error-response-guards" 脚本并追加到根 test 链。

## 不许动
- 不改任何路由/调用方(本条只做根因)。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:error-response-guards 通过。

## 交付
一段话:INTERNAL_ERROR_CODES 纳入了哪些码、脱敏与截断如何做、守卫结果。不要 commit。
