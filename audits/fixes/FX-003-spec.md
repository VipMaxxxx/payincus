# FX-003 规格：外呼 SSRF / DNS rebinding(P1 横切 / D-056)

## 根因
server/src/lib/outbound-security.ts 有 safeOutboundDispatcher(undici Agent,connect 期 revalidatingLookup 复校解析 IP,防 DNS rebinding),
但各调用点只 await assertSafeHttpUrl(url) 做**校验期**检查,随后 fetch(url,...) **未传 { dispatcher: safeOutboundDispatcher }** →
校验时域名解析到公网 IP、连接时可解析到内网 IP(TOCTOU rebinding),内网 SSRF 未被拦。

## 修法（改 outbound-security.ts 加 safeFetch + 迁移 fetch 调用点 + 加守卫）
1. outbound-security.ts 新增:
   export async function safeFetch(url: string, init?: Parameters<typeof fetch>[1], label = 'URL'): Promise<Response> {
     await assertSafeHttpUrl(url, label)
     return fetch(url, { ...(init ?? {}), dispatcher: safeOutboundDispatcher as any })
   }
   (dispatcher 传法参照文件内注释 line 188-191 的既有用法;类型不匹配用 as any 兜。)
2. 迁移调用点:grep server/src 全部 assertSafeHttpUrl / assertSafeWebhookUrl 的使用处。对每个"校验后紧跟 fetch(url,...) 且未传 dispatcher"的点:
   - 优先改为 safeFetch(url, init, label)(它已含校验,原来的 assertSafe*Url 那行可删或保留——若保留会重复校验,建议删掉那行改用 safeFetch);
   - 或最小改动:给该 fetch 的 options 补 `dispatcher: safeOutboundDispatcher`(需 import)。
   **只加 dispatcher / 换 safeFetch,严禁改动 URL、method、headers、body、超时、业务逻辑。**
   逐一记录改了哪些文件与函数。
3. 特例:若某外呼用的是非 undici 客户端(nodemailer / axios / 自建 mail 客户端如 cranemail/smartermail),undici dispatcher 对其无效 → **不要硬改**,在交付报告里列出这些"非 fetch 外呼点"作为后续单独治理项(不在本条)。本条只覆盖基于全局 fetch/undici 的外呼。

## 加守卫
新建 server/scripts/test-safe-outbound-fetch-guards.ts:断言 outbound-security.ts 导出 safeFetch 且其体内同时含 assertSafeHttpUrl 与 safeOutboundDispatcher;并抽查若干已迁移文件确含 safeFetch 或 `dispatcher: safeOutboundDispatcher`。加 "test:safe-outbound-fetch-guards" 脚本到 server/package.json 并接根 test 链。

## 不许动
- 不改 app.ts(留给并行的 FX-004);不改任何外呼的业务参数。不做大重构。

## 验收
- pnpm --filter server type-check 通过;
- pnpm --filter server test:safe-outbound-fetch-guards 通过;
- 相关既有外呼守卫仍绿:test:payment-provider-outbound-guard、test:storage-outbound-guards、test:mail-source-outbound-guard、test:oauth-outbound-guard。

## 交付
逐点列出:迁移了哪些 fetch 调用点(文件:函数)、哪些是非 fetch 外呼(留待后续)、守卫结果。不要 commit。
