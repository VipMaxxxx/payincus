已按 FX-071 规格完成，未 commit：

- D-080：close 审计写入保留独立 `try/catch`，失败仅记录错误，不产生未处理 rejection。
- D-081：新增同步原子名额预留，同时检查 active + pending 的用户/实例上限；名额在断开、建连失败及成功登记 active session 后幂等释放。
- D-082：快捷命令创建改为事务级用户 advisory lock，在同一事务内完成 count、100 条上限判断及 insert，超限明确返回 `MAX_COMMANDS_REACHED`。
- 守卫已追加上述约束，FX-081/082 隔离与重连代次逻辑未回退。

验证结果：`git diff --check`、server type-check、`test:terminal-route-id-guards`、`test:terminal-saved-command-route-id-guards` 全部通过。仅改动指定的四个文件，未碰 schema/package、batch-config/hosts。
