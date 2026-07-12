# FX-081 规格：Web 终端"审计日志失败被当连接失败"关掉正常终端 + 断开回调未捕获(P1 / M14-03 / M14-04)【owner 最初报的"终端报错"根因】

## 根因(owner 反馈的"终端报错")
server/src/routes/terminal.ts:418:createTerminalSession 已成功返回、终端已连通,但随后 `await createLog(...)` 在同一个 try 内;
其异常进入 440-453 的 catch,向用户发 CONNECTION_FAILED 并关闭 WebSocket → 日志表故障/DB 抖动/写入超时都会让实际已连通的终端显示"Failed to connect"。
另 terminal.ts:428:断开审计 `socket.on('close', async () => { await createLog(...) })` 无 try/catch → 日志写失败产生未处理 Promise rejection(可能进程级异常)。

## 修法（只改 server/src/routes/terminal.ts;不碰 package.json)
1. **审计日志与连接生命周期隔离**(M14-03):把连接成功后的 `await createLog(...)` 移出"决定连接成败"的 try(或用不抛出的安全记录:try/catch 包住,失败只 console.error/告警,**绝不关闭已成功建立的终端**)。即:终端已连通就保持连通,审计日志失败不影响连接。
2. **断开回调捕获**(M14-04):`socket.on('close', async () => {...})` 内的 `await createLog(...)` 用 try/catch 包住(或调一个自身保证不抛的审计函数),消除未处理 rejection。
3. 不改终端鉴权/建连/proxy 逻辑本身。

## 加守卫
在现有 server/scripts/test-terminal-route-id-guards.ts 追加断言:连接成功后的审计日志失败不关闭终端(隔离)、close 回调审计已 try/catch。不改 package.json。

## 不许动
- 不改 terminal-proxy.ts 的会话/重连(=FX-082 另做);不改鉴权。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:terminal-route-id-guards、test:terminal-saved-command-route-id-guards 通过。

## 交付
一段话:审计如何隔离、close 回调如何捕获、守卫结果。不要 commit。
