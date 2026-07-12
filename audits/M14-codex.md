# M14 审计报告
## 结论摘要
实例归属在票据签发和 WebSocket 建连阶段均有复核，未发现直接越权访问他人实例的路径。但 WebSocket 初始化、Incus 重连和审计日志处理存在高风险生命周期问题，可造成用户看到“连接失败”、僵尸会话或后端连接泄漏；现有守卫只覆盖路由 ID 与快捷命令归属，不覆盖这些场景。遵照要求，本次仅静态阅读代码，未运行构建或测试。

## 发现清单
- [M14-01] P1 | 置信度 高 | server/src/lib/terminal-proxy.ts:501
  - 问题:初次连接 Incus 期间尚未安装客户端 WebSocket 的 `close/error` 监听；如果浏览器在异步建连完成前退出，关闭事件会被永久错过，随后仍会创建活跃会话。
  - 证据:`await createIncusConsoleConnection(...)` 位于 501-506 行；客户端 `close/error` 监听直到 602-610 行才注册，而心跳定时器和 `activeSessions.set(...)` 又在 622-668 行执行。
  - 影响:快速关闭终端、切页或网络中断后，服务端可能保留最长约 12 小时的僵尸会话和 Incus WebSocket，并占用每用户/实例连接额度，导致用户随后看到连接数超限或终端报错。
  - 修复建议:在任何异步建连前监听客户端关闭并维护取消状态，建连完成后再次确认客户端仍为 OPEN，否则立即关闭新建的 Incus 连接且不得登记会话。

- [M14-02] P1 | 置信度 高 | server/src/lib/terminal-proxy.ts:283
  - 问题:Incus 重连退避及建连期间没有再次确认会话仍存在，已关闭的会话仍可在后台完成重连并产生无人管理的连接。
  - 证据:重连先在 283-284 行等待，再于 286-300 行创建并绑定新 WebSocket；期间没有重新查询 `activeSessions`。与此同时，`closeTerminalSession()` 会在 695-721 行清除定时器、连接并直接删除该会话。
  - 影响:用户在重连提示期间关闭终端后，异步任务仍可能新建 Incus exec/console WebSocket；这些连接不在 `activeSessions` 中，无法被正常清理或统计。
  - 修复建议:为重连引入可取消的代次标识，并在退避后及建连完成后复核会话和客户端状态，失效时立即销毁新连接。

- [M14-03] P1 | 置信度 高 | server/src/routes/terminal.ts:418
  - 问题:成功建立终端后同步等待审计日志写入，日志失败会被当成终端连接失败并主动关闭正常会话。
  - 证据:`createTerminalSession(...)` 在 397-406 行已经成功返回，但随后 `await createLog(...)` 位于同一个 `try` 中；其异常会进入 440-453 行，向用户发送 `CONNECTION_FAILED` 并关闭 WebSocket。
  - 影响:日志表故障、数据库瞬时抖动或日志写入超时都会让实际已连通的终端显示“Failed to connect”，与 owner 反馈的终端报错现象直接吻合。
  - 修复建议:将审计日志失败与核心连接生命周期隔离，记录日志异常但不要关闭已经成功建立的终端。

- [M14-04] P2 | 置信度 高 | server/src/routes/terminal.ts:428
  - 问题:断开审计使用未捕获异常的异步 EventEmitter 回调。
  - 证据:`socket.on('close', async () => { await createLog(...) })` 没有 `try/catch`，WebSocket 事件系统不会自动消费该异步函数返回的 rejected Promise。
  - 影响:断开连接时若日志写入失败，会产生未处理 Promise rejection；取决于 Node 运行参数，可能污染日志、触发进程级异常甚至导致服务退出。
  - 修复建议:在关闭回调内部显式捕获日志异常，或调用一个自身保证不抛出的审计记录函数。

- [M14-05] P2 | 置信度 高 | server/src/routes/terminal.ts:363
  - 问题:连接上限采用“读取统计后再创建”的非原子检查，所谓最终检查仍未预留名额，多个并发请求可同时通过。
  - 证据:363-385 行只读取 `activeSessions` 统计；实际会话直到 `terminal-proxy.ts` 668 行才加入 `activeSessions`，中间还要异步创建 Incus 连接。并发请求因此能看到相同的旧计数。
  - 影响:同一用户可并发提交多个有效票据，突破每用户 5 个、每实例 3 个的限制，集中创建 Incus 操作和 WebSocket，放大资源消耗及僵尸连接问题。
  - 修复建议:在进入异步建连前原子预留连接名额，并确保所有失败、关闭和取消路径都释放预留。

- [M14-06] P2 | 置信度 高 | server/src/db/terminal-saved-commands.ts:150
  - 问题:每用户最多 100 条快捷命令的限制存在并发竞态。
  - 证据:150-162 行先单独执行 `COUNT(*)`，164-189 行再执行 `INSERT`，两者没有事务锁或数据库约束。
  - 影响:用户并发创建命令时，多个请求可以同时观察到数量未达上限并全部插入，使数据超过产品声明的 100 条限制。
  - 修复建议:通过事务级用户锁、原子插入条件或数据库约束实现并发安全的数量限制。

- [M14-07] P3 | 置信度 高 | client/src/views/TerminalView.vue:559
  - 问题:主要终端错误路径绕过 i18n，并直接展示异常或服务端英文消息；`TerminalModal.vue` 502-605 行和 `useTerminal.ts` 166-286 行存在相同模式。
  - 证据:代码直接赋值 `err instanceof Error ? err.message : 'Failed to connect'`，并硬编码 `Authentication required`、`Connection error`、`Connection lost`、`Unknown error`；服务端控制消息还会在 619 行原样写入 xterm。
  - 影响:中文界面会出现英文错误；底层 HTTP 异常文本可能过于技术化，用户难以判断是实例状态、权限、连接限制还是网络故障。
  - 修复建议:按稳定错误码映射 i18n 文案，仅将经过白名单处理的用户可见信息写入终端。
