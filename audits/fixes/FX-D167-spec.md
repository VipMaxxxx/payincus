# D-167 规格：内存态 Map 多进程假设文档化(横切-H,resolution=文档化单实例假设)

## 裁决方向(DEFECTS.md:618)
"**内存态多进程假设文档化**"——架构为**单私有后端进程**(127.0.0.1:3001,无 Redis,用 PG advisory lock),内存 Map(登录锁/OAuth nonce/登录码去重/交割 finalize 去重/配置缓存)在单实例下正确;resolution 是**明确并守住单实例假设**,而非改成共享存储。

## 现状
`lib/security.ts:30`(登录锁/nonce/去重 Map)、`config-cache.ts:16`(配置缓存 Map)等用进程内 Map;多进程部署会各自为政。证据:lib/security.ts:30、config-cache.ts:16。

## 修法(只改 lib/security.ts + config-cache.ts + 其它内存态模块的注释/启动守卫 + OPERATIONS_HANDOFF 或设计文档 + 守卫;不改 schema/package;不改业务逻辑;不碰 pricing/plugin(并行))
1. 先只读:各内存态 Map 用途、后端是否已有"单实例"约束/启动逻辑、部署文档现状。
2. **文档化单实例假设**:
   - 在各内存态模块加**清晰注释**:"依赖单后端进程实例;多进程/水平扩展会失效——若未来扩容需下沉 PG/共享存储"。
   - 在 `OPERATIONS_HANDOFF.md` 或 `AGENTS.md` 加一节"**私有后端必须单实例运行**(内存态登录锁/nonce/去重/缓存依赖此假设)",列出受影响点。
3. **可选启动守卫(低风险)**:后端启动时若检测到明显多实例迹象(如同端口已占/环境标志)记 warning;或加一个显式配置断言"single instance"。不做复杂协调,只 fail-loud 文档级。
4. 不改任何业务逻辑/不下沉存储(除非 owner 要多进程)。

## 加守卫
`test:security-config` 或相关守卫追加:内存态模块含单实例假设注释 + handoff/AGENTS 有说明。不改 package.json。

## 不许动
不碰 pricing/plugin(并行)。不改 schema/package/业务逻辑。不 commit。

## 验收
type-check 通过;`test:security-config`、相关守卫通过。交付一段话:注释加在哪、handoff 说明、是否加启动守卫。
