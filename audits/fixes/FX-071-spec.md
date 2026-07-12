# FX-071 规格：终端断开审计 rejection + 连接上限非原子 + 快捷命令上限竞态(P2高 / D-080,D-081,D-082 / M14)

## 三个根因
- **D-080** `routes/terminal.ts:428`:断开(close 回调)审计日志写入是异步,未捕获异常 → 未处理 promise rejection(可致进程告警/不稳)。
- **D-081** `routes/terminal.ts:363`:终端连接上限**非原子检查**(先查计数再建连),并发可绕过上限。
- **D-082** `db/terminal-saved-commands.ts:150`:快捷命令 100 条上限**并发竞态**(先查 count 再插入),并发可超 100。

## 前置事实
FX-081/082 已对终端连接期审计/重连做过 try/catch 隔离与代次处理(见 terminal.ts/terminal-proxy.ts)。本修沿用同风格,勿回退它们。

## 修法(只改 routes/terminal.ts + db/terminal-saved-commands.ts + 守卫;不改 schema/package;不碰 batch-config/hosts(并行))
1. **D-080**:close 回调内的审计日志写入用 try/catch(或 `.catch()`)显式捕获,日志失败只记录不抛,不影响关闭流程、不产生未处理 rejection。与 FX-081 的隔离思路一致。
2. **D-081**:建连前**原子预留名额**——用与计数一致的原子手段(如 advisory lock 内 count+校验+登记,或原子计数器 claim),仅当未超上限才占坑并建连;任何失败/断开路径**释放名额**,避免占坑泄漏。上限判定与登记必须在同一原子区。
3. **D-082**:快捷命令插入用**事务级用户锁 + 同事务内 count 校验后插入**(或条件插入 where count<100),保证并发不超 100;失败返回明确错误。优先不改 schema(用事务/advisory lock);若能加轻量 DB 约束且不需迁移则可,但**不得改 schema/迁移**。
3. 保持终端正常连接/快捷命令正常增删不回归。

## 加守卫
`test:terminal-route-id-guards`/`test:terminal-saved-command-route-id-guards` 追加:close 审计捕获异常、连接上限原子预留+失败释放、快捷命令上限事务锁/原子。不改 package.json。

## 不许动
不碰 batch-config/hosts(并行)。不回退 FX-081/082。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:terminal-route-id-guards`、`test:terminal-saved-command-route-id-guards` 通过。交付一段话:三点各自改法、名额释放、守卫结果。
