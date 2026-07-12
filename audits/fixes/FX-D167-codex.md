D-167 已按“文档化单实例假设”完成，未改业务逻辑、schema/package，也未碰 pricing/plugin。

改动：

- [security.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/security.ts:9)：注明登录锁、OAuth nonce、登录码防重放、导出任务均依赖单后端进程。
- [config-cache.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/config-cache.ts:6)：注明配置缓存及失效机制的单实例约束。
- [exchangeDeliveryWorker.ts](C:/Users/Administrator/Desktop/payinces/server/src/workers/exchangeDeliveryWorker.ts:18)：注明交割 finalize 内存去重依赖单实例。
- [OPERATIONS_HANDOFF.md](C:/Users/Administrator/Desktop/payinces/OPERATIONS_HANDOFF.md:30) 和 [AGENTS.md](C:/Users/Administrator/Desktop/payinces/AGENTS.md:24)：明确私有后端只能运行一个 Node.js 进程，并列出受影响点及未来扩容前的共享存储要求。
- [test-security-config.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-security-config.ts:143)：增加源码注释和两份架构文档守卫。

验证：

- `test:security-config`：通过
- `test:exchange-lifecycle-guards`：通过
- 目标文件 `git diff --check`：通过
- server type-check：被并行 plugin 工作阻塞，错误全部来自 `plugin-trade` 与当前 Prisma Client 不匹配。
- `test:exchange-marketplace-guards`：被并行交割改动的既有结构断言阻塞，与本次注释改动无关。

未加启动守卫：同机重复监听 `127.0.0.1:3001` 已会启动失败；新增环境配置断言会超出本次纯文档化范围。未 commit、未触碰生产。
