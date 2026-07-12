# FX-082 规格：Web 终端僵尸会话/无人管理连接(P1 / M14-01/02)

## 根因
server/src/lib/terminal-proxy.ts:
- M14-01(:501):初次连接 Incus 期间(`await createIncusConsoleConnection`)尚未安装客户端 WS 的 close/error 监听(监听在 602-610 才注册);浏览器在异步建连完成前退出→关闭事件被永久错过,随后仍 activeSessions.set 创建活跃会话+心跳(最长约12h 僵尸,占用每用户/实例连接额度)。
- M14-02(:283):Incus 重连退避及建连期不再确认会话仍存在;已被 closeTerminalSession 清除的会话,异步任务仍可能新建 Incus exec/console WS→不在 activeSessions、无法清理/统计。

## 修法（只改 server/src/lib/terminal-proxy.ts;不碰 package.json)
1. **M14-01**:在任何异步建连**之前**先监听客户端 close/error 并维护一个"已取消/客户端已断"标志;建连完成后**再次确认客户端仍为 OPEN 且会话未被取消**,否则**立即关闭新建的 Incus 连接、不 activeSessions.set、不起心跳**。
2. **M14-02**:为重连引入**可取消的代次标识(generation/epoch)**;退避 sleep 后与建连完成后都**复核会话仍在 activeSessions 且代次未过期**,失效则立即销毁新建连接、不接管。closeTerminalSession 时使当前代次失效。
3. 不改鉴权/审计(FX-081 已隔离审计);不改 terminal.ts。

## 加守卫
在现有 server/scripts/test-terminal-route-id-guards.ts 追加断言:建连前监听 client close、建连后复核 OPEN 否则关闭不登记;重连有可取消代次+复核。不改 package.json。

## 不许动
- 不改 terminal.ts(FX-081 已改);不改鉴权/连接上限(M14-05 另议)。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:terminal-route-id-guards 通过。

## 交付
一段话:早退如何防僵尸、重连代次如何做、守卫结果。不要 commit。
