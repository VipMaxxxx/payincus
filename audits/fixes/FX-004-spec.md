# FX-004 规格：trustProxy 全链信任致 request.ip 可伪造(P1 横切 / D-057，含 D-046 IP 伪造根因)

## 根因
server/src/lib/trust-proxy-config.ts 的 getTrustProxyEnabled 返回布尔;app.ts:136 trustProxy: getTrustProxyEnabled()。
TRUST_PROXY=true 时 Fastify trustProxy=true → 信任整条代理链 → request.ip 取 X-Forwarded-For 最左值(客户端完全可控/可伪造)。
下游全部受害:限流 keyGenerator(app.ts:318-324 用 request.ip)可被伪造 IP 绕过(D-046 根因)、登录风控异地判定、支付回调 IP 白名单等。

## 修法（改 server/src/lib/trust-proxy-config.ts + server/src/app.ts:136 + 更新现有守卫 test-trust-proxy-config.ts;不碰 package.json）
1. 先 grep 全仓 getTrustProxyEnabled 的调用点(预计仅 app.ts)。
2. 在 trust-proxy-config.ts 新增 getTrustProxyConfig(): boolean | number | string[]:
   - TRUST_PROXY 空 / false/0/no/off → 返回 false(不信任);
   - TRUST_PROXY 为纯数字(如 "2")→ 返回该跳数(number);
   - TRUST_PROXY 为逗号分隔的 IP/CIDR 列表(如 "127.0.0.1,10.0.0.0/8")→ 返回该字符串数组(受信代理地址);
   - TRUST_PROXY 为 true/1/yes/on(旧"开启"语义)→ **返回固定跳数,默认 1**(=前置单层 nginx),可用 TRUST_PROXY_HOPS 覆盖(解析为正整数,失败回退 1);**绝不返回 true(信任全部跳)**。
   - 非法值 → console.warn + 返回 false。
   保留 getTrustProxyEnabled(布尔)供仍需"是否开启"判断的地方;若仅 app.ts 用到取值处,改用 getTrustProxyConfig。
3. app.ts:136 改为 trustProxy: getTrustProxyConfig()。
4. 说明:限流 keyGenerator 继续用 request.ip 即可——一旦 trustProxy 收敛为固定跳数/受信网段,request.ip 变为真实客户端 IP、不再可伪造,D-046 的"伪造 IP 绕过限流"根因随之消除(Public API 按 token 精细限流属后续增强,不在本条)。

## 更新守卫（现有 server/scripts/test-trust-proxy-config.ts,勿动 package.json）
调整/追加断言:TRUST_PROXY=true/1/yes/on → getTrustProxyConfig() 返回有限跳数(===1 默认)且**不为布尔 true**;=数字 → 返回该数;=CIDR 列表 → 返回数组;=off/空 → false;app.ts 使用 getTrustProxyConfig()。保证守卫仍通过。

## 不许动
- 不改限流规则数值、不改 geoip/回调白名单逻辑本身。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:trust-proxy-config 通过;pnpm --filter server test:security-config、test:cors-origin-config 通过(确认未误伤)。

## 交付
一段话:getTrustProxyConfig 的取值矩阵、调用点改动、守卫结果。不要 commit。
