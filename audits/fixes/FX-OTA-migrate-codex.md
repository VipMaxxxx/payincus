已按规格完成最小改动，仅涉及：

- [run-system-update-task.ts](C:/Users/Administrator/Desktop/payinces/server/src/scripts/run-system-update-task.ts:172)
- [test-system-update-guards.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-system-update-guards.ts:182)

迁移插入在新 release 切换完成后、后端 restart 前；先用 `.env` 的 `DATABASE_URL` 调用 `pg_dump`，原子生成 `backupDir/db-pre-migrate-<ver>-<ts>.sql`，备份失败则不启动迁移并中止 OTA。随后在新 release 执行 `pnpm --filter server exec prisma migrate deploy`；迁移或健康检查失败沿用既有代码回滚，保留 SQL 备份并明确告警 DB 不会自动回滚、需手工恢复。`requiredCommands` 已加入 `pg_dump`。

验证结果：

- `pnpm --filter server type-check`：通过
- `pnpm --filter server test:system-update-guards`：通过
- `git diff --check`：通过

未 commit、push、发版、执行 OTA或接触生产。
