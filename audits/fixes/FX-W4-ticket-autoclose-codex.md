已完成工单自动关闭可配置化：

- 新增 `ticket_auto_close_enabled`（默认 `true`）和 `ticket_auto_close_hours`（默认 `24`、最小 `1`）。
- 关闭开关时调度器在扫描前直接跳过；开启时按配置小时数计算 cutoff。
- 保留 BF-11-03：候选筛选及事务复核仍以最后公开消息时间为准。
- 管理端工单配置区已增加开关、小时输入和三语 i18n。
- 更新两份守卫，并处理配置项首次保存时的 upsert。

验证通过：server/client type-check、`ticket-auto-close-guards`、`system-config-value-guards`、`frontend-i18n-keys`、`frontend-route-guards`、`git diff --check`。双端构建受 Windows 脚本语法及沙箱读取 `vite.config.ts` 权限阻断，未完成 Vite 打包验证。

本工单未改 mail、schema、package、锁定表格，未 commit/push/发版。
